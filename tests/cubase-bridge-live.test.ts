import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseService, RuntimeService } from '../apps/desktop/electron/services';
import { activitySchema, historySchema, runtimeStateSchema } from '../packages/shared-types/src';
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

  it('reads the session tracks over real MIDI', async () => {
    const state = await runtime.state();
    expect(state.project?.tracks.map((track) => track.name)).toEqual([
      'Kick',
      'Sub bass',
      'Analog keys',
    ]);
    expect(state.project?.tracks[0]).toMatchObject({ volume: 0.82, mute: false });
    // Mute state comes from the host callback, not from what the script wrote.
    expect(state.project?.tracks[2]).toMatchObject({ mute: true });
    expect(state.project?.tracksTruncated).toBe(false);
  }, 30000);

  it('applies an approved track write to the named track and no other', async () => {
    const before = (await runtime.state()).project!.tracks;
    const raw = await runtime.call(
      'track.set_volume',
      { trackId: 'track-1', volume: 0.25 },
      'live',
    );
    const activity = activitySchema.parse(
      JSON.parse((raw.content as { type: string; text: string }[])[0].text),
    );
    expect(activity.status).toBe('awaiting-approval');
    expect((await runtime.state()).project?.tracks[1].volume).toBe(before[1].volume);

    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    const call = [...peerLog()].reverse().find((entry) => entry.call === 'setProcessValue');
    expect(call).toMatchObject({ name: 'trackVolume1', value: 0.25 });
    const after = (await runtime.state()).project!.tracks;
    expect(after[1].volume).toBe(0.25);
    // The other tracks are untouched.
    expect(after[0].volume).toBe(before[0].volume);
    expect(after[2].volume).toBe(before[2].volume);
  }, 30000);

  it('refuses a write naming a track the session does not have', async () => {
    const raw = await runtime.call('track.set_mute', { trackId: 'track-12', mute: true }, 'live');
    const activity = activitySchema.parse(
      JSON.parse((raw.content as { type: string; text: string }[])[0].text),
    );
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    const settled = historySchema
      .parse(await db.execute({ type: 'history' }))
      .activities.find((candidate) => candidate.id === activity.id);
    expect(settled?.status).toBe('failed');
    // The bank is a window, so an unreachable track says which problem it is.
    expect(settled?.detail).toMatch(/not showing a track/);
  }, 30000);

  it('reads a plugin and its mapped quick controls over real MIDI', async () => {
    const tracks = (await runtime.state()).project!.tracks;
    expect(tracks[0].plugin ?? null).toBe(null);
    expect(tracks[1].plugin).toMatchObject({ name: 'Retrologue', bypassed: false });
    expect(tracks[1].plugin?.quickControls).toEqual([
      { index: 0, name: 'Cutoff', value: 0.62 },
      { index: 1, name: 'Resonance', value: 0.3 },
    ]);
  }, 30000);

  it('applies an approved quick control change and refuses an unmapped one', async () => {
    const raw = await runtime.call(
      'plugin.set_quick_control',
      { trackId: 'track-1', index: 0, value: 0.2 },
      'live',
    );
    const activity = activitySchema.parse(
      JSON.parse((raw.content as { type: string; text: string }[])[0].text),
    );
    expect(activity.status).toBe('awaiting-approval');
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    const call = [...peerLog()].reverse().find((entry) => entry.call === 'setProcessValue');
    expect(call).toMatchObject({ name: 'trackQuick1_0', value: 0.2 });
    const after = (await runtime.state()).project!.tracks[1];
    expect(after.plugin?.quickControls[0].value).toBe(0.2);
    // Resonance is untouched.
    expect(after.plugin?.quickControls[1].value).toBe(0.3);

    const unmapped = await runtime.call(
      'plugin.set_quick_control',
      { trackId: 'track-1', index: 6, value: 0.5 },
      'live',
    );
    const refused = activitySchema.parse(
      JSON.parse((unmapped.content as { type: string; text: string }[])[0].text),
    );
    await runtime.control({
      type: 'decision',
      decision: { id: refused.id, sessionId: refused.sessionId, approve: true },
    });
    const settled = historySchema
      .parse(await db.execute({ type: 'history' }))
      .activities.find((candidate) => candidate.id === refused.id);
    expect(settled?.status).toBe('failed');
    expect(settled?.detail).toMatch(/not mapped/);
  }, 30000);

  it('reads the selected channel and writes its EQ over real MIDI', async () => {
    const channel = (await runtime.state()).project!.selectedChannel;
    expect(channel).toMatchObject({ name: 'Kick' });
    expect(channel!.eq).toHaveLength(4);
    expect(channel!.inserts).toEqual([{ slot: 0, name: 'Compressor', on: true, bypassed: false }]);
    const raw = await runtime.call('channel.set_eq_band', { band: 2, gain: 0.3, on: true }, 'live');
    const activity = activitySchema.parse(
      JSON.parse((raw.content as { type: string; text: string }[])[0].text),
    );
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    // The bytes reached the driver and it drove the bound surface values.
    const writes = peerLog()
      .filter((entry) => entry.call === 'setProcessValue')
      .filter((entry) => String(entry.name).startsWith('selEq1'));
    expect(writes.map((entry) => [entry.name, entry.value])).toEqual([
      ['selEq1on', 1],
      ['selEq1gain', 0.3],
    ]);
    const after = (await runtime.state()).project!.selectedChannel!.eq.find(
      (band) => band.band === 2,
    );
    expect(after).toMatchObject({ on: true, gain: 0.3 });
  }, 30000);

  it('pages the mixer bank over real MIDI and reports the window', async () => {
    const raw = await runtime.call('mixer.page', { direction: 'next' }, 'live');
    const activity = activitySchema.parse(
      JSON.parse((raw.content as { type: string; text: string }[])[0].text),
    );
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    // The host's own bank action moved, and the reported window says where.
    expect(
      peerLog()
        .filter((entry) => entry.call === 'bank')
        .at(-1),
    ).toMatchObject({
      name: 'next',
    });
    expect((await runtime.state()).project?.bank).toMatchObject({ offset: 16, size: 16 });
    const back = await runtime.call('mixer.page', { direction: 'reset' }, 'live');
    const reset = activitySchema.parse(
      JSON.parse((back.content as { type: string; text: string }[])[0].text),
    );
    await runtime.control({
      type: 'decision',
      decision: { id: reset.id, sessionId: reset.sessionId, approve: true },
    });
    expect((await runtime.state()).project?.bank?.offset).toBe(0);
  }, 30000);

  it('runs an allowlisted command and refuses one outside it, over real MIDI', async () => {
    // Classified the same way on the live bridge as in the mock, so a command
    // can never be the one write that runs unattended.
    const capability = (await runtime.state()).capabilities.find(
      (entry) => entry.id === 'host.run_command',
    );
    expect(capability).toMatchObject({ risk: 'destructive', support: 'bridge' });
    const raw = await runtime.call('host.run_command', { command: 'save' }, 'live');
    const activity = activitySchema.parse(
      JSON.parse((raw.content as { type: string; text: string }[])[0].text),
    );
    // The approval names what the command will act on, since it takes no
    // arguments of its own.
    expect(activity.detail).toContain('"Kick"');
    await runtime.control({
      type: 'decision',
      decision: { id: activity.id, sessionId: activity.sessionId, approve: true },
    });
    const pressed = peerLog()
      .filter((entry) => entry.call === 'setProcessValue')
      .filter((entry) => entry.name === 'cmd_save');
    expect(pressed.map((entry) => entry.value)).toEqual([1, 0]);
    // A command outside the allowlist never becomes a request at all.
    const refused = await runtime.call('host.run_command', { command: 'quit' }, 'live');
    expect(refused.isError).toBe(true);
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
