import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../packages/orchestrator/src';
import { MockCubaseAdapter } from '../packages/adapters/cubase/src';
import { type Activity } from '../packages/shared-types/src';

function fixture(fail?: (a: Activity) => boolean) {
  const calls: Activity[] = [];
  const adapter = new MockCubaseAdapter();
  let time = 1000;
  const core = new Orchestrator(
    adapter,
    async (a) => {
      if (fail?.(a)) throw new Error('Disk unavailable');
      calls.push(a);
    },
    () => time,
  );
  return {
    core,
    adapter,
    calls,
    advance: () => {
      time += 300001;
    },
  };
}
describe('permission-controlled orchestration', () => {
  it('filters tools and rejects Ask writes even when invoked directly', async () => {
    const { core } = fixture();
    await core.connect();
    expect((await core.tools()).map((t) => t.id)).toEqual([
      'project.get_state',
      'project.get_tempo',
    ]);
    const result = await core.request('project.set_tempo', { tempo: 124 }, 'c');
    expect(result.status).toBe('denied');
    expect((await core.state()).project?.tempo).toBe(122);
  });
  it('persists intent, waits for approval, executes once, and rejects replay', async () => {
    const { core, calls } = fixture();
    await core.connect();
    await core.setMode('assist');
    const args = { tempo: 124 };
    const request = await core.request('project.set_tempo', args, 'c');
    args.tempo = 150;
    expect(request.status).toBe('awaiting-approval');
    expect((await core.state()).project?.tempo).toBe(122);
    expect((await core.decide(request.id, core.sessionId, true)).status).toBe('succeeded');
    expect((await core.state()).project?.tempo).toBe(124);
    expect(calls.filter((c) => c.id === request.id).map((c) => c.status)).toEqual([
      'requested',
      'awaiting-approval',
      'running',
      'succeeded',
    ]);
    expect((await core.decide(request.id, core.sessionId, true)).status).toBe('denied');
    expect((await core.state()).project?.revision).toBe(1);
  });
  it('rejects invalid input and unknown commands before execution', async () => {
    const { core } = fixture();
    await core.connect();
    await core.setMode('assist');
    for (const tempo of [NaN, Infinity, 301, 19, '124'])
      expect((await core.request('project.set_tempo', { tempo }, 'c')).status).toBe('failed');
    expect((await core.request('plugin.insert', {}, 'c')).status).toBe('failed');
    expect((await core.state()).project?.revision).toBe(0);
  });
  it('cancels, expires, and invalidates old-session approvals', async () => {
    const { core, advance } = fixture();
    await core.connect();
    await core.setMode('assist');
    const a = await core.request('transport.play', {}, 'c');
    expect((await core.decide(a.id, core.sessionId, false)).status).toBe('cancelled');
    const b = await core.request('transport.play', {}, 'c');
    advance();
    expect((await core.decide(b.id, core.sessionId, true)).status).toBe('denied');
    const c = await core.request('transport.play', {}, 'c');
    expect((await core.decide(c.id, 'different-session', true)).status).toBe('denied');
    await core.setMode('ask');
    await core.setMode('assist');
    expect((await core.decide(c.id, core.sessionId, true)).status).toBe('denied');
    const d = await core.request('transport.play', {}, 'c');
    await core.disconnect();
    expect((await core.decide(d.id, core.sessionId, true)).status).toBe('denied');
  });
  it('requires durable running intent before mutation', async () => {
    const { core, adapter } = fixture((a) => a.status === 'running');
    await core.connect();
    await core.setMode('assist');
    const a = await core.request('project.set_tempo', { tempo: 124 }, 'c');
    await expect(core.decide(a.id, core.sessionId, true)).rejects.toThrow('Disk unavailable');
    expect((await adapter.getProjectState()).tempo).toBe(122);
  });
  it('does not claim failure or replay after a result cannot be persisted', async () => {
    const { core, adapter } = fixture((a) => a.status === 'succeeded');
    await core.connect();
    await core.setMode('assist');
    const a = await core.request('project.set_tempo', { tempo: 124 }, 'c');
    await expect(core.decide(a.id, core.sessionId, true)).rejects.toThrow('Unknown outcome');
    expect((await adapter.getProjectState()).tempo).toBe(124);
    expect((await core.decide(a.id, core.sessionId, true)).status).toBe('denied');
  });
  it('serializes concurrent approvals and prevents stale undo', async () => {
    const { core } = fixture();
    await core.connect();
    await core.setMode('assist');
    const a = await core.request('project.set_tempo', { tempo: 124 }, 'c');
    await core.decide(a.id, core.sessionId, true);
    const undo = await core.undo(a.id, 'c');
    const b = await core.request('transport.play', {}, 'c');
    await core.decide(b.id, core.sessionId, true);
    expect((await core.decide(undo.id, core.sessionId, true)).detail).toContain('Undo conflict');
    const undoB = await core.undo(b.id, 'c');
    await core.decide(undoB.id, core.sessionId, true);
    expect((await core.state()).project?.playing).toBe(false);
    const c = await core.request('transport.play', {}, 'c');
    const results = await Promise.all([
      core.decide(c.id, core.sessionId, true),
      core.decide(c.id, core.sessionId, true),
    ]);
    expect(results.map((r) => r.status)).toEqual(['succeeded', 'denied']);
  });
  it('treats clip generation as a write: refused in Ask, approved in Assist, no undo', async () => {
    const written: Record<string, unknown>[] = [];
    const { core } = fixture();
    core.useArtifacts({
      createClip: async (input) => {
        written.push(input);
        return 'Saved as /tmp/clip.mid. Drop it onto a track; the session itself is unchanged.';
      },
    });
    await core.connect();
    // A file is still a write: Ask refuses it before anything is generated.
    const denied = await core.request('midi.create_clip', { kind: 'chords' }, 'c');
    expect(denied.status).toBe('denied');
    expect(written).toEqual([]);

    await core.setMode('assist');
    const proposed = await core.request('midi.create_clip', { kind: 'chords', bars: 4 }, 'c');
    expect(proposed.status).toBe('awaiting-approval');
    expect(written).toEqual([]);
    const done = await core.decide(proposed.id, proposed.sessionId, true);
    expect(done.status).toBe('succeeded');
    expect(written).toEqual([{ kind: 'chords', bars: 4 }]);
    // Nothing was changed in the session, so nothing is offered to undo.
    expect(done.undoable).toBe(false);
    expect(done.detail).toMatch(/session itself is unchanged/);
  });
  it('exposes clip generation only when generation is available', async () => {
    const { core } = fixture();
    await core.connect();
    await core.setMode('assist');
    expect((await core.tools()).some((tool) => tool.id === 'midi.create_clip')).toBe(false);
    core.useArtifacts({ createClip: async () => 'ok' });
    const tool = (await core.tools()).find((t) => t.id === 'midi.create_clip');
    expect(tool).toMatchObject({ risk: 'safe-write', requiresConfirmation: true });
  });
  it('rechecks adapter capability after approval', async () => {
    const { core, adapter } = fixture();
    await core.connect();
    await core.setMode('assist');
    const a = await core.request('transport.play', {}, 'c');
    await adapter.disconnect();
    expect((await core.decide(a.id, core.sessionId, true)).status).toBe('failed');
  });
});
