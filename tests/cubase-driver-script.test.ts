import { describe, expect, it, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeFrame, encodeFrame } from '../packages/adapters/cubase/src';

const require_ = createRequire(import.meta.url);
type SysexHandler = (device: unknown, sysex: number[]) => void;
interface StubQuickControl {
  mOnTitleChange: (d: unknown, m: unknown, objectTitle: string, valueTitle: string) => void;
  mOnProcessValueChange: (d: unknown, m: unknown, v: number) => void;
}
interface StubChannel {
  _quickControls: StubQuickControl[];
  mInstrumentPluginSlot: {
    mBypass: { mOnProcessValueChange: (d: unknown, m: unknown, v: number) => void };
    mOnTitleChange: (d: unknown, m: unknown, title: string) => void;
  };
  mValue: {
    mVolume: { mOnProcessValueChange: (d: unknown, m: unknown, v: number) => void };
    mMute: { mOnProcessValueChange: (d: unknown, m: unknown, v: number) => void };
    mSolo: { mOnProcessValueChange: (d: unknown, m: unknown, v: number) => void };
  };
  mOnTitleChange: (d: unknown, m: unknown, title: string) => void;
}
interface StubDriver {
  _channels: StubChannel[];
  _input: { name: string; mOnSysex: SysexHandler };
  _output: { name: string };
  _page: {
    mHostAccess: {
      mTransport: {
        mValue: {
          mStart: { mOnProcessValueChange: (d: unknown, m: unknown, v: number) => void };
        };
        mTimeDisplay: { mOnChangeTempoBPM: (d: unknown, m: unknown, bpm: number) => void };
      };
    };
    mOnActivate: (device: unknown, mapping: unknown) => void;
  };
}
const { makeApi } = require_('./fixtures/midiremote-api-stub.cjs') as {
  makeApi: () => { log: Record<string, unknown>[]; driver: StubDriver; makeDeviceDriver: unknown };
};

/**
 * Loads the shipped driver script the way Cubase does — with
 * `midiremote_api_v1` resolvable — so the Cubase-facing half of the script is
 * exercised, not just its protocol functions.
 */
async function loadInsideCubase() {
  const root = await mkdtemp(path.join(tmpdir(), 'orchestrai-driver-'));
  await copyFile(
    path.resolve('resources/cubase/orchestrai_bridge.js'),
    path.join(root, 'script.js'),
  );
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const moduleDirectory = path.join(root, 'node_modules', 'midiremote_api_v1');
  await mkdir(moduleDirectory, { recursive: true });
  const api = makeApi();
  (globalThis as Record<string, unknown>).__orchestraiApi = api;
  await writeFile(
    path.join(moduleDirectory, 'index.js'),
    'module.exports = globalThis.__orchestraiApi;',
  );
  await writeFile(
    path.join(moduleDirectory, 'package.json'),
    JSON.stringify({ name: 'midiremote_api_v1', main: 'index.js' }),
  );
  require_(path.join(root, 'script.js'));
  return api;
}
const request = (correlation: number, payload: unknown) => [
  ...encodeFrame({ kind: 'request', correlation, payload: JSON.stringify(payload) }),
];
const lastResponse = (api: { log: Record<string, unknown>[] }) => {
  const sent = [...api.log].reverse().find((entry) => entry.call === 'sendMidi');
  const decoded = decodeFrame(Uint8Array.from(sent!.message as number[]));
  if (!decoded.ok) throw new Error(`Unreadable response frame: ${decoded.reason}`);
  return JSON.parse(decoded.frame.payload);
};

describe('driver script inside a Cubase-shaped host', () => {
  let api: Awaited<ReturnType<typeof loadInsideCubase>>;
  beforeAll(async () => {
    api = await loadInsideCubase();
  });
  it('registers the device, ports, and transport bindings Cubase expects', () => {
    expect(api.log[0]).toMatchObject({ call: 'makeDeviceDriver', vendor: 'OrchestrAI' });
    expect(api.driver._input.name).toContain('OrchestrAI Bridge');
    expect(api.driver._output.name).toContain('OrchestrAI Bridge');
    // Host values expose only increment/decrement, so transport and mixer
    // values must be driven through bound surface values.
    const bindings = api.log.filter((entry) => entry.call === 'makeValueBinding');
    expect(bindings.filter((entry) => /^bridge/.test(String(entry.surfaceValue)))).toHaveLength(2);
    // One bank of sixteen channels, each with volume, mute, and solo.
    // One bank of sixteen: volume, mute, solo, bypass, and eight quick
    // controls per channel.
    expect(bindings.filter((entry) => /^track/.test(String(entry.surfaceValue)))).toHaveLength(
      16 * 12,
    );
    expect(typeof api.driver._input.mOnSysex).toBe('function');
  });
  it('answers a handshake over SysEx', () => {
    api.driver._input.mOnSysex({}, request(1, { op: 'hello', protocol: 1 }));
    expect(lastResponse(api)).toMatchObject({
      ok: true,
      result: { protocol: 1, daw: expect.stringContaining('Cubase') },
    });
  });
  it('refuses writes until Cubase activates the mapping page', () => {
    api.driver._input.mOnSysex(
      {},
      request(2, { op: 'execute', tool: 'project.set_tempo', arguments: { tempo: 124 } }),
    );
    expect(lastResponse(api)).toMatchObject({
      ok: false,
      error: expect.stringContaining('not active'),
    });
  });
  it('reports tempo and transport from Cubase callbacks, not from assumption', () => {
    const device = { id: 'device' };
    const mapping = { id: 'mapping' };
    api.driver._page.mOnActivate(device, mapping);
    const transport = api.driver._page.mHostAccess.mTransport;
    transport.mTimeDisplay.mOnChangeTempoBPM(device, mapping, 118);
    transport.mValue.mStart.mOnProcessValueChange(device, mapping, 1);
    api.driver._input.mOnSysex(device, request(3, { op: 'get_state' }));
    expect(lastResponse(api)).toMatchObject({
      ok: true,
      result: { project: { tempo: 118, playing: true, mock: false } },
    });
  });
  it('writes tempo through setTempoBPM with the active mapping', () => {
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(4, { op: 'execute', tool: 'project.set_tempo', arguments: { tempo: 124 } }),
    );
    const call = [...api.log].reverse().find((entry) => entry.call === 'setTempoBPM');
    expect(call).toMatchObject({ bpm: 124, mapping: { id: 'mapping' } });
    expect(lastResponse(api)).toMatchObject({ ok: true, result: { project: { tempo: 124 } } });
  });
  it('drives transport through the bound surface value as a press and release', () => {
    api.log.length = 0;
    api.driver._input.mOnSysex({ id: 'device' }, request(5, { op: 'transport.play' }));
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(6, { op: 'execute', tool: 'transport.play', arguments: {} }),
    );
    const presses = api.log.filter((entry) => entry.call === 'setProcessValue');
    expect(presses.map((entry) => entry.value)).toEqual([1, 0]);
    expect(presses[0]).toMatchObject({ name: 'bridgeStart' });
    expect(lastResponse(api)).toMatchObject({ ok: true, result: { project: { playing: true } } });
  });
  it('reports only the channels Cubase has filled, named as Cubase names them', () => {
    const device = { id: 'device' };
    const channels = api.driver._channels;
    // Cubase fills two channels of the bank and leaves the rest empty.
    channels[0].mOnTitleChange(device, {}, 'Kick');
    channels[0].mValue.mVolume.mOnProcessValueChange(device, {}, 0.82);
    channels[1].mOnTitleChange(device, {}, 'Sub bass');
    channels[1].mValue.mVolume.mOnProcessValueChange(device, {}, 0.6);
    channels[1].mValue.mMute.mOnProcessValueChange(device, {}, 1);
    api.driver._input.mOnSysex(device, request(20, { op: 'get_state' }));
    const project = (
      lastResponse(api) as { result: { project: { tracks: unknown[]; tracksTruncated: boolean } } }
    ).result.project;
    expect(project.tracks).toEqual([
      {
        id: 'track-0',
        name: 'Kick',
        type: 'audio',
        mute: false,
        solo: false,
        volume: 0.82,
        plugin: null,
      },
      {
        id: 'track-1',
        name: 'Sub bass',
        type: 'audio',
        mute: true,
        solo: false,
        volume: 0.6,
        plugin: null,
      },
    ]);
    expect(project.tracksTruncated).toBe(false);
  });
  it('follows a fader the producer moved in Cubase rather than what it last wrote', () => {
    const device = { id: 'device' };
    api.driver._channels[0].mValue.mVolume.mOnProcessValueChange(device, {}, 0.31);
    api.driver._input.mOnSysex(device, request(21, { op: 'get_state' }));
    const project = (lastResponse(api) as { result: { project: { tracks: { volume: number }[] } } })
      .result.project;
    expect(project.tracks[0].volume).toBe(0.31);
  });
  it('writes a track level through its bound surface value', () => {
    api.log.length = 0;
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(22, {
        op: 'execute',
        tool: 'track.set_volume',
        arguments: { trackId: 'track-0', volume: 0.5 },
      }),
    );
    const write = [...api.log].reverse().find((entry) => entry.call === 'setProcessValue');
    expect(write).toMatchObject({ name: 'trackVolume0', value: 0.5 });
    expect(lastResponse(api)).toMatchObject({ ok: true });
  });
  it('refuses a track the session does not have before sending anything', () => {
    api.log.length = 0;
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(23, {
        op: 'execute',
        tool: 'track.set_mute',
        arguments: { trackId: 'track-9', mute: true },
      }),
    );
    expect(lastResponse(api)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no track'),
    });
    expect(api.log.some((entry) => entry.call === 'setProcessValue')).toBe(false);
  });
  it('reports a plugin and only the quick controls the session has mapped', () => {
    const device = { id: 'device' };
    const channel = api.driver._channels[1];
    channel.mInstrumentPluginSlot.mOnTitleChange(device, {}, 'Retrologue');
    channel._quickControls[0].mOnTitleChange(device, {}, 'Filter', 'Cutoff');
    channel._quickControls[0].mOnProcessValueChange(device, {}, 0.62);
    // Mapped with no name is not a control anyone assigned.
    channel._quickControls[3].mOnProcessValueChange(device, {}, 0.4);
    api.driver._input.mOnSysex(device, request(30, { op: 'get_state' }));
    const tracks = (lastResponse(api) as { result: { project: { tracks: { plugin: unknown }[] } } })
      .result.project.tracks;
    expect(tracks[1].plugin).toEqual({
      name: 'Retrologue',
      bypassed: false,
      quickControls: [{ index: 0, name: 'Cutoff', value: 0.62 }],
    });
    // A track Cubase filled with no instrument reports no plugin at all.
    expect(tracks[0].plugin).toBe(null);
  });
  it('writes a quick control through its bound surface value', () => {
    api.log.length = 0;
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(31, {
        op: 'execute',
        tool: 'plugin.set_quick_control',
        arguments: { trackId: 'track-1', index: 0, value: 0.25 },
      }),
    );
    const write = [...api.log].reverse().find((entry) => entry.call === 'setProcessValue');
    expect(write).toMatchObject({ name: 'trackQuick1_0', value: 0.25 });
    expect(lastResponse(api)).toMatchObject({ ok: true });
  });
  it('refuses an unmapped control and a track with no plugin', () => {
    api.log.length = 0;
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(32, {
        op: 'execute',
        tool: 'plugin.set_quick_control',
        arguments: { trackId: 'track-1', index: 5, value: 0.5 },
      }),
    );
    expect(lastResponse(api)).toMatchObject({
      ok: false,
      error: expect.stringContaining('not mapped'),
    });
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(33, {
        op: 'execute',
        tool: 'plugin.set_bypass',
        arguments: { trackId: 'track-0', bypassed: true },
      }),
    );
    expect(lastResponse(api)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no plugin'),
    });
    expect(api.log.some((entry) => entry.call === 'setProcessValue')).toBe(false);
  });
  it('rejects an unsupported operation and a malformed payload', () => {
    api.driver._input.mOnSysex(
      { id: 'device' },
      request(7, { op: 'execute', tool: 'plugin.insert', arguments: {} }),
    );
    expect(lastResponse(api)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unsupported'),
    });
    api.driver._input.mOnSysex({ id: 'device' }, [
      ...encodeFrame({ kind: 'request', correlation: 8, payload: 'not json' }),
    ]);
    expect(lastResponse(api)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Malformed'),
    });
  });
});
