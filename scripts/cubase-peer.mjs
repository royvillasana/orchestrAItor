/**
 * Runs the shipped Cubase driver script outside Cubase, over real CoreMIDI.
 *
 * The script is loaded exactly as Cubase loads it — with `midiremote_api_v1`
 * resolvable — and its MIDI input/output are wired to real virtual MIDI
 * endpoints named "OrchestrAI Bridge". The desktop bridge then finds and opens
 * those endpoints like any other port pair.
 *
 * This exercises the whole path except Cubase's own handling of the API calls:
 * real ports, real SysEx bytes on the wire, and the real driver script.
 */
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
/** What a small session looks like once Cubase has filled the bank. */
export const DEFAULT_TRACKS = [
  { name: 'Kick', volume: 0.82, mute: false, solo: false, pan: 0.5, selected: true },
  {
    name: 'Sub bass',
    volume: 0.6,
    mute: false,
    solo: false,
    // An instrument with the controls a producer would have mapped.
    plugin: 'Retrologue',
    quickControls: [
      { index: 0, name: 'Cutoff', value: 0.62 },
      { index: 1, name: 'Resonance', value: 0.3 },
    ],
  },
  { name: 'Analog keys', volume: 0.55, mute: true, solo: false },
];
const PORT_NAME = process.env.ORCHESTRA_PEER_PORT ?? 'OrchestrAI Bridge';

export async function startCubasePeer({ tempo = 120, tracks = DEFAULT_TRACKS } = {}) {
  const midi = require_('@julusian/midi');
  const { makeApi } = require_('../tests/fixtures/midiremote-api-stub.cjs');
  const api = makeApi();

  const root = await mkdtemp(path.join(tmpdir(), 'orchestrai-peer-'));
  await copyFile(
    path.resolve('resources/cubase/orchestrai_bridge.js'),
    path.join(root, 'script.js'),
  );
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const moduleDirectory = path.join(root, 'node_modules', 'midiremote_api_v1');
  await mkdir(moduleDirectory, { recursive: true });
  globalThis.__orchestraiApi = api;
  await writeFile(
    path.join(moduleDirectory, 'index.js'),
    'module.exports = globalThis.__orchestraiApi;',
  );
  await writeFile(
    path.join(moduleDirectory, 'package.json'),
    JSON.stringify({ name: 'midiremote_api_v1', main: 'index.js' }),
  );
  require_(path.join(root, 'script.js'));

  // Cubase's own endpoints: a source the bridge reads and a destination it writes.
  const output = new midi.Output();
  const input = new midi.Input();
  output.openVirtualPort(PORT_NAME);
  input.ignoreTypes(false, true, true);
  input.openVirtualPort(PORT_NAME);

  const device = { id: 'peer-device' };
  const mapping = { id: 'peer-mapping' };
  // Stand in for Cubase activating the mapping page after pairing.
  api.driver._page.mOnActivate(device, mapping);
  const transport = api.driver._page.mHostAccess.mTransport;
  transport.mTimeDisplay.mOnChangeTempoBPM(device, mapping, tempo);
  // Cubase filling the first channels of the bank, as it would on a real project.
  const channels = api.driver._channels ?? [];
  tracks.forEach((track, index) => {
    const channel = channels[index];
    if (!channel) return;
    channel.mOnTitleChange(device, mapping, track.name);
    channel.mValue.mVolume.mOnProcessValueChange(device, mapping, track.volume);
    channel.mValue.mMute.mOnProcessValueChange(device, mapping, track.mute ? 1 : 0);
    channel.mValue.mSolo.mOnProcessValueChange(device, mapping, track.solo ? 1 : 0);
    channel.mValue.mPan.mOnProcessValueChange(device, mapping, track.pan ?? 0.5);
    channel.mValue.mRecordEnable.mOnProcessValueChange(device, mapping, track.armed ? 1 : 0);
    channel.mValue.mMonitorEnable.mOnProcessValueChange(device, mapping, track.monitoring ? 1 : 0);
    channel.mValue.mSelected.mOnProcessValueChange(device, mapping, track.selected ? 1 : 0);
    if (track.plugin) {
      channel.mInstrumentPluginSlot.mOnTitleChange(device, mapping, track.plugin);
      for (const control of track.quickControls ?? []) {
        const quick = channel.mQuickControls.getByIndex(control.index);
        quick.mOnTitleChange(device, mapping, control.name, control.name);
        quick.mOnProcessValueChange(device, mapping, control.value);
      }
    }
  });

  // Cubase reporting the selected channel's depth, as it does when a track is
  // selected: the EQ bands, sends and inserts the surface then addresses.
  const selectedTrack = tracks.find((track) => track.selected) ?? tracks[0];
  const selected = api.driver._selected;
  if (selectedTrack) {
    selected.mOnTitleChange(device, mapping, selectedTrack.name);
    for (const band of selectedTrack.eq ?? [{ band: 1, gain: 0.55, frequency: 0.2, on: true }]) {
      const host = selected.mChannelEQ[`mBand${band.band}`];
      host.mOn.mOnProcessValueChange(device, mapping, band.on ? 1 : 0);
      host.mGain.mOnProcessValueChange(device, mapping, band.gain ?? 0.5);
      host.mFreq.mOnProcessValueChange(device, mapping, band.frequency ?? 0.5);
      host.mQ.mOnProcessValueChange(device, mapping, band.q ?? 0.5);
    }
    const insert = api.driver._inserts[0];
    if (insert) {
      insert.mOnTitleChange(device, mapping, selectedTrack.insert ?? 'Compressor');
      insert.mOn.mOnProcessValueChange(device, mapping, 1);
    }
  }

  const sent = [];
  api.driver._output.sendMidi = (_device, message) => {
    sent.push(message);
    output.sendMessage(message);
  };
  input.on('message', (_delta, message) => api.driver._input.mOnSysex(device, message));

  return {
    api,
    sent,
    portName: PORT_NAME,
    /** Cubase's transport reporting back, as it would after a real edit. */
    reportTempo: (bpm) => transport.mTimeDisplay.mOnChangeTempoBPM(device, mapping, bpm),
    /** Cubase reporting a different track selected, as a producer's click would. */
    reportSelection: (name) => selected.mOnTitleChange(device, mapping, name),
    stop: () => {
      input.closePort();
      output.closePort();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const peer = await startCubasePeer();
  console.log(`Cubase peer listening on real MIDI ports named "${peer.portName}". Ctrl-C to stop.`);
  process.on('SIGINT', () => {
    peer.stop();
    process.exit(0);
  });
  setInterval(() => {}, 1 << 30);
}
