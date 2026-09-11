import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DatabaseService, RuntimeService } from '../apps/desktop/electron/services';
import { historySchema, activitySchema } from '../packages/shared-types/src';

const directory = path.resolve('apps/desktop/dist');
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
describe('real MCP/runtime process', () => {
  it('initializes the standard protocol and does not expose tools while disconnected', async () => {
    const client = new Client({ name: 'integration', version: '1.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(directory, 'runtime.cjs')],
    });
    cleanup.push(() => client.close());
    await client.connect(transport);
    // Sample tools answer from the local index, so they survive a disconnected
    // DAW; every tool that needs the DAW does not.
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools.filter((name) => !name.startsWith('samples.'))).toEqual([]);
    const result = await client.callTool({ name: 'transport.play', arguments: {} });
    expect(result.isError).toBe(true);
  });
  it('runs MCP writes through durable approval, preserves history, and restarts disconnected', async () => {
    const data = await mkdtemp(path.join(tmpdir(), 'orchestrai-runtime-'));
    const failures: string[] = [];
    const db = new DatabaseService(directory, data, (error) => failures.push(error));
    await db.ready;
    const runtime = new RuntimeService(
      directory,
      db,
      (error) => failures.push(error),
      () => {},
      () => {},
      () => {},
    );
    cleanup.push(async () => {
      await runtime.close();
      await db.close();
    });
    await runtime.start();
    await runtime.control({ type: 'connect' });
    await runtime.control({ type: 'mode', mode: 'assist' });
    const raw = await runtime.call('project.set_tempo', { tempo: 124 }, 'c');
    const content = raw.content as { type: string; text: string }[];
    const activity = activitySchema.parse(JSON.parse(content[0].text));
    expect(activity.status).toBe('awaiting-approval');
    expect((await runtime.state()).project?.tempo).toBe(122);
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    expect((await runtime.state()).project?.tempo).toBe(124);
    const invalid = await runtime.call('project.set_tempo', { tempo: 999 }, 'c');
    expect(invalid.isError).toBe(true);
    expect((await runtime.state()).project?.tempo).toBe(124);
    expect(historySchema.parse(await db.execute({ type: 'history' })).activities[0].status).toBe(
      'succeeded',
    );
    await runtime.close();
    await runtime.start();
    expect((await runtime.state()).connected).toBe(false);
    expect(failures).toEqual([]);
  });
  it('accepts a stored key over the control channel and falls back when it is removed', async () => {
    const data = await mkdtemp(path.join(tmpdir(), 'orchestrai-credential-'));
    const failures: string[] = [];
    const db = new DatabaseService(directory, data, (error) => failures.push(error));
    await db.ready;
    const runtime = new RuntimeService(
      directory,
      db,
      (error) => failures.push(error),
      () => {},
      () => {},
      () => {},
    );
    cleanup.push(async () => {
      await runtime.close();
      await db.close();
    });
    await runtime.start();
    // Without a key there is nothing to select: the runtime says so rather than
    // starting a session that would fail on its first request.
    await expect(runtime.control({ type: 'provider', provider: 'openai' })).rejects.toThrow(
      /API key/i,
    );
    await runtime.control({ type: 'credential', provider: 'openai', key: 'sk-test-key-1234' });
    await runtime.control({ type: 'provider', provider: 'openai' });
    expect((await runtime.state()).provider).toBe('openai');
    expect((await runtime.state()).providerLive).toBe(true);
    // Replacing a key keeps the session, and the next turn must carry the new
    // key rather than the one the transport was built with.
    await runtime.control({ type: 'credential', provider: 'openai', key: 'sk-test-key-5678' });
    expect((await runtime.state()).provider).toBe('openai');
    expect((await runtime.state()).providerLive).toBe(true);
    // Removing the key must not leave a session holding it.
    await runtime.control({ type: 'credential', provider: 'openai', key: null });
    expect((await runtime.state()).provider).toBe('demo');
    await expect(runtime.control({ type: 'provider', provider: 'openai' })).rejects.toThrow(
      /API key/i,
    );
    expect(failures).toEqual([]);
  });
});
