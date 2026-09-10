import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseService, RuntimeService } from '../apps/desktop/electron/services';
import { activitySchema, runtimeStateSchema } from '../packages/shared-types/src';
import { startCubasePeer } from '../scripts/cubase-peer.mjs';

const require_ = createRequire(import.meta.url);
const backendPresent = (() => {
  try {
    require_.resolve('@julusian/midi');
    return true;
  } catch {
    return false;
  }
})();

/**
 * Everything a real Cubase session exercises except Cubase's own handling of
 * the API calls: real CoreMIDI endpoints, real SysEx bytes on the wire, the
 * shipped driver script, the supervised runtime child, and the permission path.
 * Skipped where no MIDI backend is installed, since it is an optional package.
 */
describe.skipIf(!backendPresent)('live bridge over real MIDI', () => {
  const directory = path.resolve('apps/desktop/dist');
  let peer: Awaited<ReturnType<typeof startCubasePeer>>;
  const peerLog = () => peer.api.log;
  let runtime: RuntimeService;
  let db: DatabaseService;
  const failures: string[] = [];
  beforeAll(async () => {
    // Two peers publishing the same port name are indistinguishable to the
    // adapter, which would silently talk to the wrong one. Fail loudly instead.
    const midi = require_('@julusian/midi');
    const probe = new midi.Input();
    const existing = Array.from({ length: probe.getPortCount() }, (_, index) =>
      probe.getPortName(index),
    ).filter((name: string) => name.includes('OrchestrAI Bridge'));
    probe.closePort();
    if (existing.length > 0)
      throw new Error(
        `An "OrchestrAI Bridge" MIDI port is already published (${existing.join(', ')}). Stop any standalone peer (scripts/cubase-peer.mjs) before running this test.`,
      );
    peer = await startCubasePeer({ tempo: 120 });
    const data = await mkdtemp(path.join(tmpdir(), 'orchestrai-live-'));
    db = new DatabaseService(directory, data, (error) => failures.push(error));
    await db.ready;
    runtime = new RuntimeService(
      directory,
      db,
      (error) => failures.push(error),
      () => {},
      () => {},
      () => {},
    );
    await runtime.start();
  }, 60000);
  afterAll(async () => {
    await runtime?.close();
    await db?.close();
    peer?.stop();
  });

  it('finds the published port pair and completes the handshake', async () => {
    const state = runtimeStateSchema.parse(
      await runtime.control({ type: 'connect', adapter: 'bridge' }),
    );
    expect(state.connected).toBe(true);
    expect(state.adapter).toBe('bridge');
    expect(state.daw).toBe('Cubase (MIDI Remote)');
    // Live state must never be labelled as mock state.
    expect(state.project?.mock).toBe(false);
    expect(state.project?.tempo).toBe(120);
    expect(state.capabilities.filter((c) => c.support === 'bridge').map((c) => c.id)).toContain(
      'project.set_tempo',
    );
  }, 30000);

  it('refuses a write in Ask mode without reaching the driver script', async () => {
    await runtime.control({ type: 'mode', mode: 'ask' });
    const before = peerLog().filter((entry) => entry.call === 'setTempoBPM').length;
    const result = await runtime.call('project.set_tempo', { tempo: 130 }, 'live');
    expect(result.isError).toBe(true);
    expect(peerLog().filter((entry) => entry.call === 'setTempoBPM')).toHaveLength(before);
  }, 30000);

  it('applies an approved tempo write through real SysEx and reports it back', async () => {
    await runtime.control({ type: 'mode', mode: 'assist' });
    const raw = await runtime.call('project.set_tempo', { tempo: 124 }, 'live');
    const content = raw.content as { type: string; text: string }[];
    const activity = activitySchema.parse(JSON.parse(content[0].text));
    expect(activity.status).toBe('awaiting-approval');
    // Nothing may reach Cubase before the approval is granted.
    expect(peerLog().some((entry) => entry.bpm === 124)).toBe(false);

    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    const call = [...peerLog()].reverse().find((entry) => entry.call === 'setTempoBPM');
    expect(call).toMatchObject({ bpm: 124, mapping: { id: 'peer-mapping' } });
    const state = await runtime.state();
    expect(state.project?.tempo).toBe(124);
    expect(state.project?.mock).toBe(false);
  }, 30000);

  it('drives transport through the bound surface value and survives disconnect', async () => {
    await runtime.call('transport.play', {}, 'live');
    const activity = activitySchema.parse(
      JSON.parse(
        (
          (await runtime.call('transport.play', {}, 'live')).content as {
            type: string;
            text: string;
          }[]
        )[0].text,
      ),
    );
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    const presses = peerLog().filter((entry) => entry.call === 'setProcessValue');
    expect(presses.map((entry) => entry.value)).toContain(1);
    expect(presses.some((entry) => entry.name === 'bridgeStart')).toBe(true);
    expect((await runtime.state()).project?.playing).toBe(true);

    const disconnected = runtimeStateSchema.parse(await runtime.control({ type: 'disconnect' }));
    expect(disconnected.connected).toBe(false);
    expect(failures).toEqual([]);
  }, 30000);
});
