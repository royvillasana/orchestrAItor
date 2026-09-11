import { decodeFrame, encodeFrame } from './protocol';
import type { MidiTransport } from './transport';

/**
 * Drives the peer side of the bridge for verification. It owns no protocol
 * behavior of its own: the request handler and, optionally, the codec are
 * injected, so tests can run the adapter against the shipped Cubase driver
 * script rather than against a second implementation that could drift from it.
 */
export interface ScriptHostSurface {
  daw(): string;
  /** Cheap enough to poll: the caller reads state only when this changes. */
  revision(): number;
  readProject(): unknown;
  setTempo(tempo: number): void;
  setPlaying(playing: boolean): void;
}
export type ScriptHandler = (request: unknown) => unknown;
export interface PeerCodec {
  encodeFrame: (frame: {
    kind: 'response';
    correlation: number;
    payload: string;
  }) => Uint8Array | number[];
  decodeFrame: (
    bytes: Uint8Array | number[],
  ) =>
    | { ok: true; frame: { kind: string; correlation: number; payload: string } }
    | { ok: false; reason: string };
}
const hostCodec: PeerCodec = {
  encodeFrame,
  decodeFrame: (bytes) => decodeFrame(Uint8Array.from(bytes as Iterable<number>)),
};
export class SimulatedCubasePeer {
  private unsubscribe: (() => void) | null = null;
  /** Set to drop responses, standing in for a MIDI message that never arrives. */
  silent = false;
  /** Set to observe what the bridge actually asks for over the wire. */
  onRequest: ((request: unknown) => void) | null = null;
  constructor(
    private transport: MidiTransport,
    private handle: ScriptHandler,
    private codec: PeerCodec = hostCodec,
  ) {}
  async start() {
    await this.transport.open({ input: 'peer', output: 'peer' });
    this.unsubscribe = this.transport.onMessage((bytes) => void this.receive(bytes));
  }
  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.transport.close();
  }
  private async receive(bytes: Uint8Array) {
    const decoded = this.codec.decodeFrame(bytes);
    if (!decoded.ok || decoded.frame.kind !== 'request' || this.silent) return;
    let response: unknown;
    try {
      const request = JSON.parse(decoded.frame.payload);
      this.onRequest?.(request);
      response = this.handle(request);
    } catch {
      response = { ok: false, error: 'Malformed request payload.' };
    }
    const frame = this.codec.encodeFrame({
      kind: 'response',
      correlation: decoded.frame.correlation,
      payload: JSON.stringify(response),
    });
    await this.transport.send(Uint8Array.from(frame as Iterable<number>));
  }
}
/** In-memory stand-in for the Cubase session the driver script reads and writes. */
export function createFixtureScriptHost(
  daw = 'Cubase 14 (simulated)',
): ScriptHostSurface & { state: { tempo: number; playing: boolean; revision: number } } {
  const state = { tempo: 120, playing: false, revision: 0 };
  return {
    state,
    daw: () => daw,
    revision: () => state.revision,
    readProject: () => ({
      name: 'Live session',
      tempo: state.tempo,
      key: 'Unknown',
      timeSignature: '4/4',
      playing: state.playing,
      revision: state.revision,
      mock: false,
      tracks: [],
    }),
    setTempo: (tempo: number) => {
      state.tempo = tempo;
      state.revision++;
    },
    setPlaying: (playing: boolean) => {
      state.playing = playing;
      state.revision++;
    },
  };
}
