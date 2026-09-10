import { mkdtemp, mkdir, writeFile, chmod, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { candidatePaths, discoverAgents } from '../packages/agents/cli/src';
import { DemoProvider } from '../packages/agent-core/src';
import { OpenAIProvider } from '../packages/agents/openai/src';
import type { Conversation } from '../packages/shared-types/src';

describe('agent discovery', () => {
  it('handles platform paths, extensions, missing PATH, and excludes relative directories', () => {
    expect(
      candidatePaths(
        'codex',
        { PATH: 'C:\\bin;relative', PATHEXT: '.EXE;.CMD;.PS1' },
        'win32',
        'C:\\Users\\Producer',
      ),
    ).toContain('C:\\bin\\codex.cmd');
    expect(candidatePaths('codex', { PATH: 'relative' }, 'darwin', '/studio')).not.toContain(
      'relative/codex',
    );
    expect(candidatePaths('claude', {}, 'darwin', '/studio')).toContain(
      '/studio/.local/bin/claude',
    );
  });
  it('finds executable files in user locations without running them', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'orchestrai-discovery-'));
    const bin = path.join(home, '.local', 'bin');
    await mkdir(bin, { recursive: true });
    const candidate = path.join(bin, 'claude');
    await writeFile(candidate, '#!/bin/sh\nexit 99\n');
    await chmod(candidate, 0o700);
    await symlink(candidate, path.join(bin, 'codex'));
    const agents = await discoverAgents({ env: { PATH: bin }, home, platform: 'darwin' });
    const claude = agents.find((a) => a.id === 'claude-code')!;
    expect(claude.installed).toBe(true);
    expect(claude.executable).toBe(await realpath(candidate));
    expect(claude.status).toBe('detected');
    expect(claude.authentication).toBe('unverified');
    expect(agents.find((a) => a.id === 'codex')?.executable).toBe(await realpath(candidate));
  });
});
const conversation = (content: string): Conversation => ({
  id: 'c',
  title: 'Test',
  timestamp: 'now',
  messages: [
    { id: 'm', conversationId: 'c', timestamp: 'now', provider: 'You', role: 'user', content },
  ],
});
describe('provider contracts', () => {
  it('does not fabricate OpenAI output without a transport', async () => {
    const provider = new OpenAIProvider();
    await expect(provider.initialize()).rejects.toThrow('unavailable');
    await expect(provider.sendMessage(conversation('hello'), [])).rejects.toThrow('unavailable');
  });
  it('uses the injectable transport and validates output', async () => {
    const provider = new OpenAIProvider({
      initialize: async () => {},
      send: async () => ({ text: 'Transport response', commands: [] }),
    });
    await provider.initialize();
    expect((await provider.sendMessage(conversation('hello'), [])).text).toBe('Transport response');
  });
  it('produces only deterministic supported proposals and can cancel', async () => {
    const provider = new DemoProvider();
    expect((await provider.sendMessage(conversation('Set tempo to 124 BPM'), [])).commands).toEqual(
      [{ tool: 'project.set_tempo', arguments: { tempo: 124 } }],
    );
    expect((await provider.sendMessage(conversation('Generate a bassline'), [])).commands).toEqual(
      [],
    );
    const pending = provider.sendMessage(conversation('Inspect project'), []);
    await provider.cancel();
    await expect(pending).rejects.toThrow('cancelled');
  });
});
