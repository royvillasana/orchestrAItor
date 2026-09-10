import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  CubaseBridgeAdapter,
  LoopbackMidiPair,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  PlatformMidiTransport,
  SimulatedCubasePeer,
  createFixtureScriptHost,
  decodeFrame,
  encodeFrame,
  from7Bit,
  to7Bit,
} from '../packages/adapters/cubase/src';

const require_ = createRequire(import.meta.url);
// The shipped driver script itself, not a copy of it.
const script = require_(path.resolve('resources/cubase/orchestrai_bridge.js')) as {
  PROTOCOL_VERSION: number;
  OPERATIONS: string[];
  encodeFrame: (frame: { kind: string; correlation: number; payload: string }) => number[];
  decodeFrame: (
    bytes: number[] | Uint8Array,
  ) =>
    | { ok: true; frame: { protocol: number; kind: string; correlation: number; payload: string } }
    | { ok: false; reason: string };
  createHandler: (host: unknown) => (request: unknown) => unknown;
};

function connectedBridge(
  options: { timeoutMs?: number; daw?: string; operations?: string[] } = {},
) {
  const pair = new LoopbackMidiPair();
  const host = createFixtureScriptHost(options.daw ?? 'Cubase 14 (simulated)');
  let handle = script.createHandler(host);
  if (options.operations) {
    const inner = handle;
    handle = (request: unknown) => {
      const parsed = request as { op: string; tool?: string };
      if (parsed.op === 'hello')
        return {
          ok: true,
          result: { protocol: PROTOCOL_VERSION, daw: host.daw(), operations: options.operations },
        };
      if (parsed.op === 'execute' && !options.operations!.includes(parsed.tool ?? ''))
        return { ok: false, error: `Unsupported operation ${parsed.tool}.` };
      return inner(request);
    };
  }
  const peer = new SimulatedCubasePeer(pair.peer(), handle);
  const adapter = new CubaseBridgeAdapter(
    pair.host(),
    { input: 'host', output: 'host' },
    { timeoutMs: options.timeoutMs ?? 250 },
  );
  return { adapter, peer, host, pair };
}

describe('bridge protocol', () => {
  it('round-trips arbitrary UTF-8 through 7-bit MIDI encoding', () => {
    const text = 'tempo 124 · ünïcode ✓ 🎛';
    const bytes = new TextEncoder().encode(text);
    expect(new TextDecoder().decode(from7Bit(to7Bit(bytes))!)).toBe(text);
    const decoded = decodeFrame(encodeFrame({ kind: 'request', correlation: 9, payload: text }));
    expect(decoded.ok && decoded.frame.payload).toBe(text);
    expect(decoded.ok && decoded.frame.correlation).toBe(9);
  });
  it('rejects corrupt, foreign, and truncated frames instead of guessing', () => {
    const frame = encodeFrame({ kind: 'request', correlation: 1, payload: '{}' });
    const corrupted = Uint8Array.from(frame);
    corrupted[corrupted.length - 2] = (corrupted[corrupted.length - 2] + 1) & 0x7f;
    expect(decodeFrame(corrupted)).toEqual({ ok: false, reason: 'bad-checksum' });
    const foreign = Uint8Array.from(frame);
    foreign[1] = 0x41;
    expect(decodeFrame(foreign)).toEqual({ ok: false, reason: 'foreign-manufacturer' });
    expect(decodeFrame(frame.subarray(0, 6))).toEqual({ ok: false, reason: 'not-sysex' });
    expect(decodeFrame(Uint8Array.from([1, 2, 3]))).toEqual({ ok: false, reason: 'not-sysex' });
    const unknownKind = Uint8Array.from(
      encodeFrame({ kind: 'request', correlation: 1, payload: '{}' }),
    );
    unknownKind[3] = 5;
    unknownKind[unknownKind.length - 2] = unknownKind
      .subarray(2, unknownKind.length - 2)
      .reduce((sum, byte) => (sum + byte) & 0x7f, 0);
    expect(decodeFrame(unknownKind)).toEqual({ ok: false, reason: 'unknown-kind' });
  });
  it('refuses to transmit a payload above the ceiling', () => {
    expect(() =>
      encodeFrame({ kind: 'request', correlation: 1, payload: 'x'.repeat(MAX_PAYLOAD_BYTES) }),
    ).toThrow(/ceiling/);
  });
  it('matches the shipped Cubase driver script byte for byte', () => {
    const payload = JSON.stringify({
      op: 'execute',
      tool: 'project.set_tempo',
      arguments: { tempo: 124 },
    });
    const fromHost = encodeFrame({ kind: 'request', correlation: 12, payload });
    const fromScript = script.encodeFrame({ kind: 'request', correlation: 12, payload });
    expect([...fromHost]).toEqual(fromScript);
    expect(script.decodeFrame(fromHost)).toMatchObject({
      ok: true,
      frame: { payload, correlation: 12 },
    });
    const decoded = decodeFrame(Uint8Array.from(fromScript));
    expect(decoded.ok && decoded.frame.payload).toBe(payload);
    expect(script.PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });
});

describe('MIDI transport boundary', () => {
  it('reports a typed unavailable status when no backend is installed', async () => {
    const transport = new PlatformMidiTransport(() =>
      Promise.reject(new Error('Cannot find module')),
    );
    const status = await transport.status();
    expect(status.available).toBe(false);
    expect(status).toMatchObject({ reason: expect.stringContaining('is not installed') });
    // The reason must name the package, not this machine's directory layout.
    expect(status.available === false && status.reason).not.toContain('/Users/');
    expect(status.available === false && status.remedy).toContain('pnpm add');
    await expect(transport.listPorts()).rejects.toThrow();
    expect(transport.opened).toBe(false);
  });
  it('delivers only to the opposite endpoint and refuses to send while closed', async () => {
    const pair = new LoopbackMidiPair();
    const host = pair.host();
    const peer = pair.peer();
    await expect(host.send(Uint8Array.from([1]))).rejects.toThrow(/not open/);
    await host.open({ input: 'a', output: 'b' });
    await peer.open({ input: 'a', output: 'b' });
    const received: number[][] = [];
    peer.onMessage((bytes) => received.push([...bytes]));
    const echoed: number[][] = [];
    host.onMessage((bytes) => echoed.push([...bytes]));
    await host.send(Uint8Array.from([0xf0, 0x7d, 0xf7]));
    expect(received).toEqual([[0xf0, 0x7d, 0xf7]]);
    expect(echoed).toEqual([]);
    expect((await host.listPorts()).map((port) => port.direction)).toEqual(['input', 'output']);
    await host.close();
    expect(host.opened).toBe(false);
  });
});

describe('Cubase bridge adapter', () => {
  it('handshakes, reads live state, and applies an approved write', async () => {
    const { adapter, peer, host } = connectedBridge();
    await peer.start();
    await adapter.connect();
    expect(adapter.connectedDaw).toBe('Cubase 14 (simulated)');
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.every((capability) => capability.support === 'bridge')).toBe(true);
    expect(capabilities.find((c) => c.id === 'project.set_tempo')?.requiresConfirmation).toBe(true);
    const before = await adapter.getProjectState();
    expect(before).toMatchObject({ tempo: 120, mock: false });
    const after = await adapter.execute({ tool: 'project.set_tempo', arguments: { tempo: 124 } });
    expect(after.project.tempo).toBe(124);
    expect(after.project.mock).toBe(false);
    expect(after.project.revision).toBeGreaterThan(before.revision);
    expect(host.state.tempo).toBe(124);
    await adapter.disconnect();
    await peer.stop();
  });
  it('keeps published ports open across handshake retries until the window closes', async () => {
    const pair = new LoopbackMidiPair();
    const hostTransport = pair.host();
    let replies = 0;
    const peer = new SimulatedCubasePeer(pair.peer(), () => {
      replies++;
      return {
        ok: true,
        result: { protocol: PROTOCOL_VERSION, daw: 'Cubase 15', operations: ['project.get_state'] },
      };
    });
    await peer.start();
    // Cubase is not paired yet: the peer stays silent, and the transport must
    // remain open the whole time so its ports stay visible for pairing.
    peer.silent = true;
    const adapter = new CubaseBridgeAdapter(
      hostTransport,
      { input: 'h', output: 'h' },
      { timeoutMs: 60, handshakeTimeoutMs: 600 },
    );
    const connecting = adapter.connect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(hostTransport.opened).toBe(true);
    expect(replies).toBe(0);
    // The producer pairs the script partway through the window.
    peer.silent = false;
    await connecting;
    expect(adapter.connected).toBe(true);
    expect(adapter.connectedDaw).toBe('Cubase 15');
    await adapter.disconnect();
    expect(hostTransport.opened).toBe(false);
    await peer.stop();
  });
  it('closes the transport when the handshake window expires', async () => {
    const pair = new LoopbackMidiPair();
    const hostTransport = pair.host();
    const peer = new SimulatedCubasePeer(pair.peer(), () => ({ ok: true, result: {} }));
    await peer.start();
    peer.silent = true;
    const adapter = new CubaseBridgeAdapter(
      hostTransport,
      { input: 'h', output: 'h' },
      { timeoutMs: 40, handshakeTimeoutMs: 120 },
    );
    await expect(adapter.connect()).rejects.toThrow(/did not answer the bridge handshake within/);
    expect(adapter.connected).toBe(false);
    expect(hostTransport.opened).toBe(false);
    await peer.stop();
  });
  it('fails the connection when the script speaks another protocol version', async () => {
    const pair = new LoopbackMidiPair();
    const peer = new SimulatedCubasePeer(pair.peer(), () => ({
      ok: true,
      result: {
        protocol: PROTOCOL_VERSION + 1,
        daw: 'Cubase 99',
        operations: ['project.get_state'],
      },
    }));
    await peer.start();
    const adapter = new CubaseBridgeAdapter(
      pair.host(),
      { input: 'h', output: 'h' },
      { timeoutMs: 250 },
    );
    await expect(adapter.connect()).rejects.toThrow(
      new RegExp(`protocol ${PROTOCOL_VERSION + 1}.*speaks ${PROTOCOL_VERSION}`),
    );
    expect(adapter.connected).toBe(false);
    await expect(adapter.getProjectState()).rejects.toThrow(/disconnected/);
    await peer.stop();
  });
  it('exposes only handshake-reported operations and refuses the rest on direct call', async () => {
    const { adapter, peer } = connectedBridge({
      operations: ['project.get_state', 'transport.play'],
    });
    await peer.start();
    await adapter.connect();
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.find((c) => c.id === 'project.set_tempo')?.support).toBe('unsupported');
    expect(capabilities.find((c) => c.id === 'transport.play')?.support).toBe('bridge');
    await expect(
      adapter.execute({ tool: 'project.set_tempo', arguments: { tempo: 124 } }),
    ).rejects.toThrow(/does not support project.set_tempo/);
    await adapter.disconnect();
    await peer.stop();
  });
  it('times out a lost response, disconnects, and never reports the write as applied', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, peer, host } = connectedBridge({ timeoutMs: 100 });
      await peer.start();
      await adapter.connect();
      peer.silent = true;
      const pending = adapter.execute({ tool: 'project.set_tempo', arguments: { tempo: 130 } });
      const assertion = expect(pending).rejects.toThrow(/did not answer execute within 100 ms/);
      await vi.advanceTimersByTimeAsync(150);
      await assertion;
      expect(adapter.connected).toBe(false);
      expect(host.state.tempo).toBe(120);
      await expect(adapter.execute({ tool: 'transport.play', arguments: {} })).rejects.toThrow(
        /disconnected/,
      );
      await peer.stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it('validates arguments and rejects malformed or unmatched responses', async () => {
    const { adapter, peer } = connectedBridge();
    await peer.start();
    await adapter.connect();
    await expect(
      adapter.execute({ tool: 'project.set_tempo', arguments: { tempo: 999 } }),
    ).rejects.toThrow();
    // A response for a correlation nobody is waiting on must resolve nothing.
    const stray = encodeFrame({
      kind: 'response',
      correlation: 99,
      payload: '{"ok":true,"result":{}}',
    });
    await peer['transport'].send(stray);
    const state = await adapter.getProjectState();
    expect(state.tempo).toBe(120);
    await adapter.disconnect();
    await peer.stop();
  });
});
