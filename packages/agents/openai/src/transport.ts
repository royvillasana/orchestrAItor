import {
  agentResponseSchema,
  type AgentResponse,
  type Conversation,
  type ToolDefinition,
} from '@orchestrai/shared-types';
import type { OpenAITransport } from './index';

/**
 * A keyed session is an ordinary session: the same tools, the same registry,
 * the same approval. The key changes who answers, not what answering may do.
 */
export const DEFAULT_MODEL = 'gpt-4o-mini';
export const MAX_TOOL_ROUNDS = 6;
export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
/** A turn that never settles would wedge the chat, so it is given a deadline. */
export const TURN_TIMEOUT_MS = 180_000;

export interface ToolRunner {
  (name: string, args: Record<string, unknown>): Promise<string>;
}
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface HttpTransportOptions {
  /**
   * Resolved per request rather than captured: a key that was replaced or
   * removed must not keep being sent by a transport built before the change.
   */
  apiKey: string | (() => string | undefined);
  runTool: ToolRunner;
  model?: string;
  url?: string;
  fetchImpl?: typeof fetch;
  maxRounds?: number;
  timeoutMs?: number;
  /** Assistant text as it is assembled, for the same display path as a CLI. */
  onDelta?: (text: string) => void;
}
const systemPrompt = (tools: ToolDefinition[]) =>
  [
    'You are the music assistant inside OrchestrAI, a local-first production workspace.',
    tools.length
      ? `Use only these tools to inspect or change the session: ${tools.map((tool) => tool.name).join(', ')}.`
      : 'No session tools are available right now; say so rather than guessing.',
    'Writes require the producer to approve them in the app. If a tool reports that it is awaiting approval, say so plainly and stop; never claim a change was applied.',
    'Answer briefly and concretely for a musician, not a developer.',
  ].join('\n');

export class HttpOpenAITransport implements OpenAITransport {
  constructor(private options: HttpTransportOptions) {}
  private key(): string {
    const key =
      typeof this.options.apiKey === 'function' ? this.options.apiKey() : this.options.apiKey;
    if (!key) throw new Error('No API key is configured for OpenAI.');
    return key;
  }
  async initialize() {
    this.key();
  }
  /** A request aborted by the deadline is a timeout, not an opaque abort. */
  private async request(
    call: typeof fetch,
    stopped: () => void,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await call(this.options.url ?? OPENAI_URL, init);
    } catch (error) {
      stopped();
      throw error;
    }
  }
  async send(
    conversation: Conversation,
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<AgentResponse> {
    const call = this.options.fetchImpl ?? fetch;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(tools) },
      ...(conversation.messages ?? []).slice(-10).map((message) => ({
        role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      })),
    ];
    const functions = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name.replace(/\./g, '_'),
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    let text = '';
    const rounds = this.options.maxRounds ?? MAX_TOOL_ROUNDS;
    // One deadline for the whole turn, so a tool loop cannot extend it.
    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? TURN_TIMEOUT_MS);
    const turn = AbortSignal.any([signal, deadline]);
    const stopped = () => {
      if (deadline.aborted && !signal.aborted)
        throw new Error(
          `OpenAI did not respond within ${Math.round((this.options.timeoutMs ?? TURN_TIMEOUT_MS) / 1000)}s.`,
        );
      turn.throwIfAborted();
    };
    for (let round = 0; round < rounds; round++) {
      stopped();
      const response = await this.request(call, stopped, {
        method: 'POST',
        signal: turn,
        headers: {
          'Content-Type': 'application/json',
          // Read now, not at construction: a revoked key stops being sent.
          Authorization: `Bearer ${this.key()}`,
        },
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_MODEL,
          messages,
          ...(functions.length ? { tools: functions } : {}),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // The key itself is never echoed back into an error.
        throw new Error(
          response.status === 401
            ? 'OpenAI rejected the stored API key. Replace it in the connection screen.'
            : `OpenAI returned ${response.status}. ${detail.slice(0, 200)}`,
        );
      }
      const body = (await response.json()) as {
        choices?: { message?: ChatMessage; finish_reason?: string }[];
      };
      const message = body.choices?.[0]?.message;
      if (!message) throw new Error('OpenAI returned no message.');
      if (typeof message.content === 'string' && message.content) {
        text += (text ? '\n\n' : '') + message.content;
        this.options.onDelta?.(text);
      }
      const calls = message.tool_calls ?? [];
      if (calls.length === 0)
        return agentResponseSchema.parse({ text: text || 'No answer was returned.', commands: [] });
      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
      for (const toolCall of calls) {
        // A cancelled turn must not keep writing to the session: the calls a
        // model asked for in one round are not a transaction to finish.
        stopped();
        let result: string;
        try {
          const args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          // Underscores on the wire; the registry's own names have dots.
          result = await this.options.runTool(toolCall.function.name.replace(/_/, '.'), args);
        } catch (error) {
          if (turn.aborted) throw error;
          result = error instanceof Error ? error.message : String(error);
        }
        stopped();
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
      }
    }
    // Bounded rather than looping until something else stops it.
    return agentResponseSchema.parse({
      text:
        (text ? text + '\n\n' : '') +
        `Stopped after ${rounds} rounds of tool calls without a final answer.`,
      commands: [],
    });
  }
}
