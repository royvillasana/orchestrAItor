import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentResponseSchema,
  errorText,
  type AgentProvider,
  type AgentResponse,
  type Conversation,
  type ProviderId,
  type ToolDefinition,
} from '@orchestrai/shared-types';

export const MAX_TURNS = 8;
export const TURN_TIMEOUT_MS = 180000;
export const MCP_SERVER_NAME = 'orchestrai';
/**
 * Built-in tools a live agent must not have. The permission engine already
 * refuses unapproved writes and the adapter is the only route to Cubase, so
 * this is defence in depth — but a music assistant has no business reading or
 * editing files on the producer's machine.
 */
export const DENIED_BUILTIN_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
];

export interface LiveAgentOptions {
  id: ProviderId;
  name: string;
  executable: string;
  proxyEntry: string;
  nodeExecutable: string;
  channelAddress: string;
  channelToken: string;
  model?: string;
  /** Assistant text as the CLI emits it, for live display. */
  onDelta?: (text: string) => void;
  log?: (event: string, detail: string) => void;
  spawnProcess?: typeof spawn;
}
interface TurnEvents {
  text: string[];
  toolCalls: { name: string; input: unknown }[];
  model: string | null;
  error: string | null;
  /**
   * What to show while the turn runs. Assembled here so no consumer has to know
   * whether a CLI streams per token, per block, or once at the end. The stored
   * message is still built from `text`, which holds completed output only.
   */
  streamed: string;
}
/** Appends unless this text has already been streamed. */
export function streamText(events: TurnEvents, text: string, onDelta?: (text: string) => void) {
  if (!text || events.streamed.endsWith(text)) return;
  events.streamed +=
    events.streamed && !/\s$/.test(events.streamed) && !/^\s/.test(text) ? text : text;
  onDelta?.(events.streamed);
}
/** Parses one line of a CLI's event stream; unknown shapes are ignored. */
export function readClaudeEvent(
  line: string,
  events: TurnEvents,
  onDelta?: (text: string) => void,
) {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const type = parsed.type;
  // Partial messages: the text as the model writes it.
  if (type === 'stream_event') {
    const event = parsed.event as
      | { type?: string; delta?: { type?: string; text?: string } }
      | undefined;
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta')
      streamText(events, event.delta.text ?? '', onDelta);
    return;
  }
  if (type === 'system' && typeof parsed.model === 'string') events.model = parsed.model;
  if (type === 'assistant' || type === 'user') {
    const message = parsed.message as { content?: unknown; model?: unknown } | undefined;
    if (typeof message?.model === 'string') events.model = message.model;
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      const item = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (item.type === 'text' && typeof item.text === 'string' && type === 'assistant') {
        events.text.push(item.text);
        // Already streamed as deltas where the CLI sends them; appended here
        // where it does not. Compared rather than flagged, so a CLI that does
        // both still reads correctly.
        streamText(events, item.text, onDelta);
      }
      if (item.type === 'tool_use' && typeof item.name === 'string')
        events.toolCalls.push({ name: item.name, input: item.input });
    }
  }
  if (type === 'result') {
    if (parsed.is_error === true || typeof parsed.error === 'string')
      events.error =
        typeof parsed.error === 'string' ? parsed.error : 'The agent reported an error.';
    if (typeof parsed.result === 'string' && events.text.length === 0)
      events.text.push(parsed.result);
  }
}
export function readCodexEvent(line: string, events: TurnEvents, onDelta?: (text: string) => void) {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  // Codex has shipped two event shapes: older builds wrap the payload in `msg`
  // with a `message` field, current builds report `item.completed` carrying an
  // `item` with a `text` field. Both are read, since the installed CLI is the
  // producer's and this build does not get to choose its version.
  const item = parsed.item as Record<string, unknown> | undefined;
  const payload = (item ?? parsed.msg ?? parsed) as Record<string, unknown>;
  const type = payload.type;
  const body =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.message === 'string'
        ? payload.message
        : null;
  if (type === 'agent_message' && body) {
    events.text.push(body);
    streamText(events, body, onDelta);
  }
  if (type === 'mcp_tool_call_begin' || type === 'mcp_tool_call') {
    const invocation = (payload.invocation ?? payload) as {
      tool?: unknown;
      server?: unknown;
      arguments?: unknown;
    };
    if (typeof invocation.tool === 'string')
      events.toolCalls.push({ name: invocation.tool, input: invocation.arguments });
  }
  // A shortened-skill notice is Codex talking about its own configuration, not
  // a failed turn; only real errors end one.
  if (type === 'error' && body && !/skill descriptions were shortened/i.test(body))
    events.error = body;
  if (typeof payload.model === 'string') events.model = payload.model;
}

/**
 * Runs an installed agent CLI non-interactively with OrchestrAI's tools loaded
 * over MCP. The CLI uses its own existing login; no credential is read, stored,
 * or forwarded here.
 */
export class LiveAgentProvider implements AgentProvider {
  readonly id: ProviderId;
  readonly name: string;
  private child: ChildProcess | null = null;
  private cancelled = false;
  private workingDirectory: string | null = null;
  private log: (event: string, detail: string) => void;
  private spawnProcess: typeof spawn;
  lastModel: string | null = null;
  constructor(private options: LiveAgentOptions) {
    this.id = options.id;
    this.name = options.name;
    this.log = options.log ?? (() => {});
    this.spawnProcess = options.spawnProcess ?? spawn;
  }
  getCapabilities() {
    return { tools: true, streaming: false, local: false };
  }
  async initialize() {
    if (!this.workingDirectory)
      // An empty directory of its own: nothing of the producer's to reach.
      this.workingDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-agent-'));
  }
  async cancel() {
    this.cancelled = true;
    this.child?.kill('SIGTERM');
    this.child = null;
  }
  async dispose() {
    await this.cancel();
    if (this.workingDirectory) await rm(this.workingDirectory, { recursive: true, force: true });
    this.workingDirectory = null;
  }
  private mcpConfig() {
    return JSON.stringify({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: this.options.nodeExecutable,
          args: [this.options.proxyEntry],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            ORCHESTRA_AGENT_CHANNEL: this.options.channelAddress,
            ORCHESTRA_AGENT_TOKEN: this.options.channelToken,
          },
        },
      },
    });
  }
  private args(prompt: string) {
    if (this.id === 'codex')
      return [
        'exec',
        '--json',
        '--skip-git-repo-check',
        // Codex asks its own approval before calling a tool, and that prompt
        // cannot be answered in a non-interactive turn: without this every tool
        // call fails as "approval required". Its sandbox is scoped to the
        // working directory, which is the empty temporary one created for this
        // turn, and OrchestrAI's permission engine remains what guards the DAW.
        '--approve-for-me',
        '-c',
        `mcp_servers.${MCP_SERVER_NAME}.command=${JSON.stringify(this.options.nodeExecutable)}`,
        '-c',
        `mcp_servers.${MCP_SERVER_NAME}.args=[${JSON.stringify(this.options.proxyEntry)}]`,
        '-c',
        `mcp_servers.${MCP_SERVER_NAME}.env={ELECTRON_RUN_AS_NODE="1",ORCHESTRA_AGENT_CHANNEL=${JSON.stringify(this.options.channelAddress)},ORCHESTRA_AGENT_TOKEN=${JSON.stringify(this.options.channelToken)}}`,
        ...(this.options.model ? ['-m', this.options.model] : []),
        prompt,
      ];
    return [
      '--print',
      '--output-format',
      'stream-json',
      // Text as the model writes it, rather than when a block completes.
      '--include-partial-messages',
      '--verbose',
      '--mcp-config',
      this.mcpConfig(),
      '--strict-mcp-config',
      '--allowedTools',
      `mcp__${MCP_SERVER_NAME}__*`,
      '--disallowedTools',
      ...DENIED_BUILTIN_TOOLS,
      '--max-turns',
      String(MAX_TURNS),
      '--permission-mode',
      'dontAsk',
      ...(this.options.model ? ['--model', this.options.model] : []),
      prompt,
    ];
  }
  async sendMessage(
    conversation: Conversation,
    tools: ToolDefinition[],
    run?: RunContext,
  ): Promise<AgentResponse> {
    await this.initialize();
    this.cancelled = false;
    const prompt = buildPrompt(conversation, tools, run);
    const events: TurnEvents = {
      text: [],
      toolCalls: [],
      model: null,
      error: null,
      streamed: '',
    };
    const read = this.id === 'codex' ? readCodexEvent : readClaudeEvent;
    const child = this.spawnProcess(this.options.executable, this.args(prompt), {
      cwd: this.workingDirectory ?? undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ORCHESTRA_AGENT_TOKEN: undefined } as NodeJS.ProcessEnv,
    });
    this.child = child;
    let stderr = '';
    let buffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          read(line, events, this.options.onDelta);
        } catch {
          // A line this build does not understand is not a reason to fail a turn.
          this.log('agent.unparsed_event', line.slice(0, 200));
        }
      }
    });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${this.name} did not finish within ${TURN_TIMEOUT_MS / 1000}s.`));
        }, TURN_TIMEOUT_MS);
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(new Error(`${this.name} could not start: ${errorText(error)}`));
        });
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      },
    );
    this.child = null;
    this.lastModel = events.model;
    if (this.cancelled)
      return agentResponseSchema.parse({ text: `${this.name} turn cancelled.`, commands: [] });
    if (exit.code !== 0) {
      const detail = events.error ?? stderr.trim().split('\n').slice(-3).join(' ');
      throw new Error(
        /not logged in|unauthorized|authentication/i.test(detail)
          ? `${this.name} is not signed in. Sign in and verify it again.`
          : `${this.name} exited with code ${exit.code}${detail ? `: ${detail.slice(0, 300)}` : '.'}`,
      );
    }
    if (events.error) throw new Error(`${this.name}: ${events.error.slice(0, 300)}`);
    const text = events.text.join('\n\n').trim();
    return agentResponseSchema.parse({
      // The agent's tool calls already ran through the permission path over
      // MCP, so a turn returns text; it never replays commands afterwards.
      text: text || `${this.name} returned no output.`,
      commands: [],
    });
  }
}
export const PROMPT_HISTORY_TURNS = 10;
export interface RunContext {
  writesLeft: number;
  secondsLeft: number;
  withoutApproval: string[];
}
export function buildPrompt(
  conversation: Conversation,
  tools: ToolDefinition[],
  run?: RunContext,
): string {
  const names = tools.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool.name}`).join(', ');
  // The conversation's own messages are the request. The title is only what the
  // first message was called, so building from it answers the wrong question on
  // every turn after the first.
  const messages = conversation.messages ?? [];
  const recent = messages.slice(-PROMPT_HISTORY_TURNS);
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  const earlier = recent.filter((message) => message !== latest);
  return [
    'You are the music assistant inside OrchestrAI, a local-first production workspace.',
    names
      ? `Use only these tools to inspect or change the session: ${names}.`
      : 'No session tools are available right now; say so rather than guessing.',
    run
      ? `You are in an autonomous run. These tools apply immediately without asking: ${run.withoutApproval.join(', ')}. Anything else still waits for the producer's approval. You have ${run.writesLeft} change(s) and about ${Math.round(run.secondsLeft)} seconds left; when either runs out the run ends. Make only the changes the producer asked for, and say what you changed.`
      : 'Writes require the producer to approve them in the app. If a tool reports that it is awaiting approval, say so plainly and stop; never claim a change was applied.',
    'When asked about sounds, search the local sample library rather than guessing file names, and cite the paths the search returns.',
    'Answer briefly and concretely for a musician, not a developer.',
    ...(earlier.length
      ? [
          '',
          'Earlier in this conversation:',
          ...earlier.map(
            (message) =>
              `${message.role === 'user' ? 'Producer' : 'You'}: ${message.content.slice(0, 1000)}`,
          ),
        ]
      : []),
    '',
    `Request: ${latest?.content ?? conversation.title}`,
  ].join('\n');
}
