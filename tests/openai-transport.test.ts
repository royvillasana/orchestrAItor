import { describe, expect, it, vi } from 'vitest';
import {
  HttpOpenAITransport,
  MAX_TOOL_ROUNDS,
  OpenAIProvider,
} from '../packages/agents/openai/src';
import type { ToolDefinition } from '../packages/shared-types/src';

const conversation = {
  id: 'c',
  title: 'What tempo?',
  timestamp: '',
  messages: [
    {
      id: 'm1',
      conversationId: 'c',
      role: 'user' as const,
      content: 'What tempo is this project?',
      provider: 'You',
      timestamp: '',
    },
  ],
};
const tools: ToolDefinition[] = [
  { name: 'project.get_tempo', description: 'read tempo', inputSchema: { type: 'object' } },
];
const reply = (message: unknown) =>
  new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

describe('OpenAI transport', () => {
  it('sends the conversation and returns the answer', async () => {
    const calls: { body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('Authorization'),
      });
      return reply({ role: 'assistant', content: 'It is at 122 BPM.' });
    }) as unknown as typeof fetch;
    const transport = new HttpOpenAITransport({
      apiKey: 'sk-test-key',
      runTool: async () => '',
      fetchImpl,
    });
    const response = await transport.send(conversation, tools, new AbortController().signal);
    expect(response.text).toBe('It is at 122 BPM.');
    expect(calls[0].auth).toBe('Bearer sk-test-key');
    const body = calls[0].body as { messages: { role: string; content: string }[] };
    expect(body.messages[0].role).toBe('system');
    // The producer's question reaches the model; the approval rule travels too.
    expect(body.messages.at(-1)?.content).toBe('What tempo is this project?');
    expect(body.messages[0].content).toMatch(/never claim a change was applied/i);
  });

  it('runs a tool call through the caller and feeds the result back', async () => {
    const ran: { name: string; args: Record<string, unknown> }[] = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { role: string }[] };
      round++;
      if (round === 1)
        return reply({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'project_get_tempo', arguments: '{}' },
            },
          ],
        });
      // The tool result is in the transcript before the second request.
      expect(body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
      return reply({ role: 'assistant', content: 'It is at 122 BPM.' });
    }) as unknown as typeof fetch;
    const transport = new HttpOpenAITransport({
      apiKey: 'sk-test-key',
      fetchImpl,
      runTool: async (name, args) => {
        ran.push({ name, args });
        return 'project.get_tempo: succeeded. 122 BPM';
      },
    });
    const response = await transport.send(conversation, tools, new AbortController().signal);
    // Underscores on the wire, dots in the registry.
    expect(ran).toEqual([{ name: 'project.get_tempo', args: {} }]);
    expect(response.text).toBe('It is at 122 BPM.');
  });

  it('bounds the tool loop instead of running until something else stops it', async () => {
    let rounds = 0;
    const fetchImpl = (async () => {
      rounds++;
      return reply({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call_${rounds}`,
            type: 'function',
            function: { name: 'project_get_tempo', arguments: '{}' },
          },
        ],
      });
    }) as unknown as typeof fetch;
    const transport = new HttpOpenAITransport({
      apiKey: 'sk-test-key',
      fetchImpl,
      runTool: async () => 'ok',
      maxRounds: 3,
    });
    const response = await transport.send(conversation, tools, new AbortController().signal);
    expect(rounds).toBe(3);
    expect(response.text).toMatch(/Stopped after 3 rounds/);
    expect(MAX_TOOL_ROUNDS).toBeGreaterThan(0);
  });

  it('reports a rejected key as a key problem, without echoing the key', async () => {
    const fetchImpl = (async () =>
      new Response('{"error":{"message":"Incorrect API key provided: sk-test-key"}}', {
        status: 401,
      })) as unknown as typeof fetch;
    const transport = new HttpOpenAITransport({
      apiKey: 'sk-test-key',
      runTool: async () => '',
      fetchImpl,
    });
    await expect(transport.send(conversation, tools, new AbortController().signal)).rejects.toThrow(
      /rejected the stored API key/,
    );
    // The failure must not carry the credential back up.
    await transport.send(conversation, tools, new AbortController().signal).catch((error) => {
      expect(String(error.message)).not.toContain('sk-test-key');
    });
  });

  it('surfaces a tool failure to the model rather than ending the turn', async () => {
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      round++;
      if (round === 1)
        return reply({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'project_set_tempo', arguments: 'not json' },
            },
          ],
        });
      const body = JSON.parse(String(init.body)) as {
        messages: { role: string; content: string }[];
      };
      expect(body.messages.at(-1)?.role).toBe('tool');
      return reply({ role: 'assistant', content: 'That tool call was malformed.' });
    }) as unknown as typeof fetch;
    const transport = new HttpOpenAITransport({
      apiKey: 'k',
      fetchImpl,
      runTool: async () => 'unused',
    });
    const response = await transport.send(conversation, tools, new AbortController().signal);
    expect(response.text).toBe('That tool call was malformed.');
  });

  it('cancels a turn in flight', async () => {
    const controller = new AbortController();
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      controller.abort();
      init.signal?.throwIfAborted();
      return reply({ role: 'assistant', content: 'never' });
    }) as unknown as typeof fetch;
    const transport = new HttpOpenAITransport({ apiKey: 'k', runTool: async () => '', fetchImpl });
    await expect(transport.send(conversation, tools, controller.signal)).rejects.toThrow();
  });

  it('refuses to run without a key', async () => {
    const provider = new OpenAIProvider();
    await expect(provider.initialize()).rejects.toThrow(/not implemented|configure a transport/i);
    await expect(
      new HttpOpenAITransport({ apiKey: '', runTool: async () => '' }).initialize(),
    ).rejects.toThrow(/No API key/);
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });
});
