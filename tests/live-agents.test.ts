import { describe, expect, it, afterEach } from 'vitest';
import { writeFile, chmod, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import {
  AgentToolChannel,
  DENIED_BUILTIN_TOOLS,
  LiveAgentProvider,
  MAX_MESSAGE_BYTES,
  buildPrompt,
  readClaudeEvent,
  readCodexEvent,
  requestOverChannel,
} from '../packages/agents/live/src';
import { verifyAgent } from '../packages/agents/cli/src/verify';
import { runtimeEnvironment, FORWARDED_ENVIRONMENT } from '../apps/desktop/electron/services';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const raw = (address: string, line: string) =>
  new Promise<string>((resolve, reject) => {
    const socket = connect(address);
    let buffer = '';
    socket.on('error', reject);
    socket.on('connect', () => socket.write(line));
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes('\n')) {
        socket.destroy();
        resolve(buffer.trim());
      }
    });
    socket.on('close', () => resolve(buffer.trim()));
  });

describe('agent tool channel', () => {
  const start = async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const channel = new AgentToolChannel({
      list: async () => [{ name: 'project.get_tempo' }],
      call: async (tool, args) => {
        calls.push({ tool, args });
        return { status: 'awaiting-approval' };
      },
    });
    await channel.start();
    cleanup.push(() => channel.stop());
    return { channel, calls };
  };
  it('serves listing and calls to a caller holding the session token', async () => {
    const { channel, calls } = await start();
    expect(await requestOverChannel(channel.address, { op: 'list', token: channel.token })).toEqual(
      [{ name: 'project.get_tempo' }],
    );
    const result = await requestOverChannel(channel.address, {
      op: 'call',
      token: channel.token,
      tool: 'project.set_tempo',
      arguments: { tempo: 124 },
    });
    expect(result).toEqual({ status: 'awaiting-approval' });
    expect(calls).toEqual([{ tool: 'project.set_tempo', args: { tempo: 124 } }]);
  });
  it('rejects a wrong token without listing or executing anything', async () => {
    const { channel, calls } = await start();
    await expect(
      requestOverChannel(channel.address, { op: 'list', token: 'wrong-token' }),
    ).rejects.toThrow(/Unauthorized/);
    await expect(
      requestOverChannel(channel.address, {
        op: 'call',
        token: 'wrong-token',
        tool: 'project.set_tempo',
        arguments: { tempo: 124 },
      }),
    ).rejects.toThrow(/Unauthorized/);
    expect(calls).toEqual([]);
  });
  it('exposes no approval, adapter, provider, or persistence operation', async () => {
    const { channel, calls } = await start();
    for (const op of ['decision', 'connect', 'useAdapter', 'history', 'mode'])
      expect(await raw(channel.address, JSON.stringify({ op, token: channel.token }) + '\n')).toBe(
        JSON.stringify({ ok: false, error: 'Malformed request.' }),
      );
    expect(calls).toEqual([]);
  });
  it('rejects malformed and oversized messages', async () => {
    const { channel, calls } = await start();
    expect(await raw(channel.address, 'not json\n')).toContain('Malformed request');
    const oversized = JSON.stringify({
      op: 'call',
      token: channel.token,
      tool: 'project.set_tempo',
      arguments: { padding: 'x'.repeat(MAX_MESSAGE_BYTES) },
    });
    expect(await raw(channel.address, oversized + '\n')).toContain('too large');
    expect(calls).toEqual([]);
  });
  it('creates an owner-only endpoint and removes it on stop', async () => {
    const channel = new AgentToolChannel({ list: async () => [], call: async () => ({}) });
    await channel.start();
    expect((await stat(channel.address)).mode & 0o777).toBe(0o600);
    await channel.stop();
    await expect(stat(channel.address)).rejects.toThrow();
  });
});

describe('live provider', () => {
  const events = () => ({
    text: [] as string[],
    toolCalls: [] as { name: string; input: unknown }[],
    model: null as string | null,
    error: null as string | null,
  });
  it('reads assistant text, tool calls, and model from a Claude Code stream', () => {
    const state = events();
    readClaudeEvent(JSON.stringify({ type: 'system', model: 'claude-opus-5' }), state);
    readClaudeEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'The project is at 120 BPM.' }] },
      }),
      state,
    );
    readClaudeEvent(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'mcp__orchestrai__project.set_tempo', input: { tempo: 124 } },
          ],
        },
      }),
      state,
    );
    expect(state.text).toEqual(['The project is at 120 BPM.']);
    expect(state.toolCalls).toEqual([
      { name: 'mcp__orchestrai__project.set_tempo', input: { tempo: 124 } },
    ]);
    expect(state.model).toBe('claude-opus-5');
  });
  it('reads a Codex event stream and records reported errors', () => {
    const state = events();
    readCodexEvent(
      JSON.stringify({ msg: { type: 'agent_message', message: 'Tempo is 120.' } }),
      state,
    );
    readCodexEvent(
      JSON.stringify({
        msg: {
          type: 'mcp_tool_call_begin',
          invocation: { tool: 'project.get_tempo', arguments: {} },
        },
      }),
      state,
    );
    readCodexEvent(JSON.stringify({ msg: { type: 'error', message: 'usage limit' } }), state);
    expect(state.text).toEqual(['Tempo is 120.']);
    expect(state.toolCalls[0].name).toBe('project.get_tempo');
    expect(state.error).toBe('usage limit');
  });
  it('tells the agent that writes need approval and never to claim otherwise', () => {
    const prompt = buildPrompt(
      { id: 'c', title: 'Set tempo to 124', timestamp: '', messages: [] },
      [{ name: 'project.set_tempo', description: '', inputSchema: {} }],
    );
    expect(prompt).toContain('mcp__orchestrai__project.set_tempo');
    expect(prompt).toMatch(/never claim a change was applied/i);
  });
  it('reports assistant text as it arrives, so the transcript can show it live', () => {
    const state = events();
    const deltas: string[] = [];
    readClaudeEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Looking at the session…' }] },
      }),
      state,
      (text) => deltas.push(text),
    );
    readClaudeEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'mcp__orchestrai__project.get_tempo' }] },
      }),
      state,
      (text) => deltas.push(text),
    );
    readClaudeEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'It is at 120 BPM.' }] },
      }),
      state,
      (text) => deltas.push(text),
    );
    // Only assistant text streams; a tool call is activity, not prose.
    expect(deltas).toEqual(['Looking at the session…', 'It is at 120 BPM.']);
    const codexState = events();
    const codexDeltas: string[] = [];
    readCodexEvent(
      JSON.stringify({ msg: { type: 'agent_message', message: 'Tempo is 120.' } }),
      codexState,
      (text) => codexDeltas.push(text),
    );
    readCodexEvent(
      JSON.stringify({ msg: { type: 'error', message: 'nope' } }),
      codexState,
      (text) => codexDeltas.push(text),
    );
    expect(codexDeltas).toEqual(['Tempo is 120.']);
  });
  it('streams the same text it finally returns', async () => {
    const deltas: string[] = [];
    const { provider } = await stubProvider(
      `#!/bin/sh\necho '{"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}'\necho '{"type":"assistant","message":{"content":[{"type":"text","text":"second"}]}}'\n`,
    );
    (provider as unknown as { options: { onDelta?: (text: string) => void } }).options.onDelta = (
      text,
    ) => deltas.push(text);
    const response = await provider.sendMessage(conversation, tools);
    expect(deltas).toEqual(['first', 'second']);
    expect(response.text).toBe('first\n\nsecond');
  });
  it('asks the latest question, not the one the conversation was named after', () => {
    const message = (id: string, role: 'user' | 'assistant', content: string) => ({
      id,
      conversationId: 'c',
      role,
      content,
      provider: role === 'user' ? 'You' : 'Claude Code',
      timestamp: '',
    });
    const prompt = buildPrompt(
      {
        id: 'c',
        title: 'What tempo is this project',
        timestamp: '',
        messages: [
          message('m1', 'user', 'What tempo is this project'),
          message('m2', 'assistant', 'It is at 126 BPM.'),
          message('m3', 'user', 'Find me a kick sample'),
        ],
      },
      [{ name: 'samples.search', description: '', inputSchema: {} }],
    );
    expect(prompt).toMatch(/Request: Find me a kick sample/);
    // Earlier turns stay as context rather than becoming the request.
    expect(prompt).toContain('It is at 126 BPM.');
    expect(prompt).not.toMatch(/Request: What tempo/);
  });

  const stubProvider = async (script: string, id: 'claude' | 'codex' = 'claude') => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orchestrai-stub-'));
    const executable = path.join(directory, 'fake-cli');
    await writeFile(executable, script);
    await chmod(executable, 0o755);
    const seen: { args: string[]; cwd: string | undefined }[] = [];
    const provider = new LiveAgentProvider({
      id,
      name: id === 'claude' ? 'Claude Code' : 'Codex',
      executable,
      proxyEntry: '/tmp/agent-mcp.cjs',
      nodeExecutable: process.execPath,
      channelAddress: '/tmp/oai.sock',
      channelToken: 'token',
      spawnProcess: ((command: string, args: string[], options: { cwd?: string }) => {
        seen.push({ args, cwd: options.cwd });
        return spawn(command, args, options as never);
      }) as never,
    });
    cleanup.push(() => provider.dispose());
    return { provider, seen };
  };
  const conversation = { id: 'c', title: 'What tempo?', timestamp: '', messages: [] };
  const tools = [{ name: 'project.get_tempo' as const, description: '', inputSchema: {} }];

  it('confines the agent to OrchestrAI tools in an isolated directory', async () => {
    const { provider, seen } = await stubProvider(
      `#!/bin/sh\necho '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}'\n`,
    );
    const response = await provider.sendMessage(conversation, tools);
    expect(response.text).toBe('ok');
    // A live turn never replays commands: its tool calls already went through
    // the permission path over MCP.
    expect(response.commands).toEqual([]);
    const args = seen[0].args;
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('mcp__orchestrai__*');
    for (const denied of DENIED_BUILTIN_TOOLS) expect(args).toContain(denied);
    expect(seen[0].cwd).toMatch(/orchestrai-agent-/);
  });
  it('reports an unauthenticated CLI as a sign-in problem, not a crash', async () => {
    const { provider } = await stubProvider(`#!/bin/sh\necho "not logged in" >&2\nexit 1\n`);
    await expect(provider.sendMessage(conversation, tools)).rejects.toThrow(/not signed in/i);
  });
  it('reports a crashed CLI with its exit code', async () => {
    const { provider } = await stubProvider(`#!/bin/sh\necho "boom" >&2\nexit 3\n`);
    await expect(provider.sendMessage(conversation, tools)).rejects.toThrow(/exited with code 3/);
  });
  it('ignores events it does not understand instead of failing the turn', async () => {
    const { provider } = await stubProvider(
      `#!/bin/sh\necho 'not json at all'\necho '{"type":"future_event","shape":{}}'\necho '{"type":"assistant","message":{"content":[{"type":"text","text":"still fine"}]}}'\n`,
    );
    expect((await provider.sendMessage(conversation, tools)).text).toBe('still fine');
  });
  it('cancels a running turn without reporting a result', async () => {
    const { provider } = await stubProvider(`#!/bin/sh\nsleep 30\n`);
    const turn = provider.sendMessage(conversation, tools);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await provider.cancel();
    expect((await turn).text).toMatch(/cancelled/i);
  });
});

describe('agent verification', () => {
  const runner =
    (stdout: string, code = 0) =>
    async () => ({ code, stdout, stderr: '' });
  it('reports the signed-in account for Claude Code', async () => {
    const result = await verifyAgent(
      'claude',
      '/bin/claude',
      runner(JSON.stringify({ loggedIn: true, email: 'producer@example.com' })),
    );
    expect(result).toMatchObject({
      authentication: 'authenticated',
      account: 'producer@example.com',
    });
  });
  it('reports a signed-out CLI with the command that signs in', async () => {
    const result = await verifyAgent(
      'claude',
      '/bin/claude',
      runner(JSON.stringify({ loggedIn: false })),
    );
    expect(result.authentication).toBe('unauthenticated');
    expect(result.error).toMatch(/claude auth login/);
    const codex = await verifyAgent('codex', '/bin/codex', runner('Not logged in'));
    expect(codex.authentication).toBe('unauthenticated');
    expect(codex.error).toMatch(/codex login/);
  });
  it('reports unparseable output as a failure rather than a login state', async () => {
    const result = await verifyAgent('claude', '/bin/claude', runner('<html>proxy error</html>'));
    expect(result.authentication).toBe('failed');
    expect(result.error).toBeTruthy();
  });
});

describe('runtime environment', () => {
  it('forwards what a CLI needs to find its own login and nothing else', () => {
    const env = runtimeEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/producer',
      // macOS keeps CLI credentials in the Keychain, whose lookup needs USER.
      USER: 'producer',
      AWS_SECRET_ACCESS_KEY: 'secret',
      OPENAI_API_KEY: 'secret',
    });
    expect(env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin', USER: 'producer' });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(FORWARDED_ENVIRONMENT).toContain('USER');
  });
});
