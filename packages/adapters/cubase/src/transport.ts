/**
 * Narrow MIDI boundary. Cubase's MIDI Remote scripts have no network, file, or
 * process access, so System Exclusive over a MIDI port pair is the only channel
 * available. Keeping the surface this small lets the protocol and adapter run
 * against an in-process loopback in tests and against a real backend at runtime.
 */
export interface MidiPort {
  id: string;
  name: string;
  direction: 'input' | 'output';
}
export interface MidiTransport {
  listPorts(): Promise<MidiPort[]>;
  open(selection: { input: string; output: string }): Promise<void>;
  close(): Promise<void>;
  send(bytes: Uint8Array): Promise<void>;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  readonly opened: boolean;
}
export type BackendStatus =
  | { available: true }
  | { available: false; reason: string; remedy: string };

class Endpoint {
  private listeners = new Set<(bytes: Uint8Array) => void>();
  deliver(bytes: Uint8Array) {
    for (const listener of [...this.listeners]) listener(bytes.slice());
  }
  subscribe(listener: (bytes: Uint8Array) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
/**
 * Pairs two transports so that what one sends the other receives. Used by the
 * simulated Cubase peer and by every protocol test.
 */
export class LoopbackMidiPair {
  readonly hostInbox = new Endpoint();
  readonly peerInbox = new Endpoint();
  host(): MidiTransport {
    return new LoopbackMidiTransport(this.peerInbox, this.hostInbox, 'host');
  }
  peer(): MidiTransport {
    return new LoopbackMidiTransport(this.hostInbox, this.peerInbox, 'peer');
  }
}
class LoopbackMidiTransport implements MidiTransport {
  private isOpen = false;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(bytes: Uint8Array) => void>();
  constructor(
    private outbound: Endpoint,
    private inbound: Endpoint,
    private label: string,
  ) {}
  get opened() {
    return this.isOpen;
  }
  async listPorts(): Promise<MidiPort[]> {
    return [
      {
        id: `loopback-${this.label}-in`,
        name: `OrchestrAI Loopback ${this.label}`,
        direction: 'input',
      },
      {
        id: `loopback-${this.label}-out`,
        name: `OrchestrAI Loopback ${this.label}`,
        direction: 'output',
      },
    ];
  }
  async open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.unsubscribe = this.inbound.subscribe((bytes) => {
      for (const listener of [...this.listeners]) listener(bytes);
    });
  }
  async close() {
    this.isOpen = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
  async send(bytes: Uint8Array) {
    if (!this.isOpen) throw new Error('The MIDI transport is not open.');
    this.outbound.deliver(bytes);
  }
  onMessage(listener: (bytes: Uint8Array) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
/**
 * Loads a MIDI backend only when a bridge session is actually requested. The
 * backend is intentionally not an install dependency: Milestone 1 avoided
 * native modules so that installing the project never triggers an Electron ABI
 * rebuild, and a producer who only uses the mock should not pay that cost.
 */
export const midiBackendModule = '@julusian/midi';
/**
 * A port id of `virtual:<name>` makes this process publish its own CoreMIDI
 * endpoint under that name instead of opening an existing one. Cubase then sees
 * a normal port pair, so pairing needs no IAC bus configured by hand first.
 */
export const VIRTUAL_PORT_PREFIX = 'virtual:';
export const virtualPortId = (name: string) => `${VIRTUAL_PORT_PREFIX}${name}`;
type MidiBinding = {
  Input: new () => RawPort & {
    openPort(index: number): void;
    openVirtualPort(name: string): void;
    on(event: 'message', cb: (delta: number, message: number[]) => void): void;
    ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  };
  Output: new () => RawPort & {
    openPort(index: number): void;
    openVirtualPort(name: string): void;
    sendMessage(message: number[]): void;
  };
};
interface RawPort {
  getPortCount(): number;
  getPortName(index: number): string;
  closePort(): void;
}
export class PlatformMidiTransport implements MidiTransport {
  private binding: MidiBinding | null = null;
  private input: InstanceType<MidiBinding['Input']> | null = null;
  private output: InstanceType<MidiBinding['Output']> | null = null;
  private listeners = new Set<(bytes: Uint8Array) => void>();
  private isOpen = false;
  constructor(
    private load: () => Promise<unknown> = () => import(/* @vite-ignore */ midiBackendModule),
  ) {}
  get opened() {
    return this.isOpen;
  }
  async status(): Promise<BackendStatus> {
    try {
      await this.binding_();
      return { available: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Module-resolution errors carry absolute paths; a producer needs the
      // missing package name, not this machine's directory layout.
      const missing = /cannot find (module|package)/i.test(detail);
      return {
        available: false,
        reason: missing
          ? `The optional MIDI backend "${midiBackendModule}" is not installed.`
          : `The MIDI backend could not load: ${detail.split('\n')[0].slice(0, 160)}`,
        remedy: `Install it with: pnpm add -w -D ${midiBackendModule}`,
      };
    }
  }
  private async binding_(): Promise<MidiBinding> {
    if (this.binding) return this.binding;
    const loaded = (await this.load()) as { default?: MidiBinding } & Partial<MidiBinding>;
    const binding = (loaded.Input ? loaded : loaded.default) as MidiBinding | undefined;
    if (!binding?.Input || !binding.Output)
      throw new Error('The MIDI backend exports no Input/Output.');
    this.binding = binding;
    return binding;
  }
  async listPorts(): Promise<MidiPort[]> {
    const binding = await this.binding_();
    const collect = (port: RawPort, direction: MidiPort['direction']): MidiPort[] => {
      const ports: MidiPort[] = [];
      for (let index = 0; index < port.getPortCount(); index++)
        ports.push({ id: `${direction}:${index}`, name: port.getPortName(index), direction });
      port.closePort();
      return ports;
    };
    const input = new binding.Input();
    const output = new binding.Output();
    return [...collect(input, 'input'), ...collect(output, 'output')];
  }
  async open(selection: { input: string; output: string }) {
    if (this.isOpen) return;
    const binding = await this.binding_();
    const index = (id: string) => {
      const parsed = Number(id.split(':')[1]);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Unknown MIDI port "${id}".`);
      return parsed;
    };
    const virtualName = (id: string) =>
      id.startsWith(VIRTUAL_PORT_PREFIX) ? id.slice(VIRTUAL_PORT_PREFIX.length) : null;
    const input = new binding.Input();
    // System Exclusive carries the bridge protocol, so it must not be filtered.
    input.ignoreTypes(false, true, true);
    input.on('message', (_delta, message) => {
      const bytes = Uint8Array.from(message);
      for (const listener of [...this.listeners]) listener(bytes);
    });
    const inputVirtual = virtualName(selection.input);
    if (inputVirtual) input.openVirtualPort(inputVirtual);
    else input.openPort(index(selection.input));
    const output = new binding.Output();
    const outputVirtual = virtualName(selection.output);
    if (outputVirtual) output.openVirtualPort(outputVirtual);
    else output.openPort(index(selection.output));
    this.input = input;
    this.output = output;
    this.isOpen = true;
  }
  async close() {
    this.isOpen = false;
    this.input?.closePort();
    this.output?.closePort();
    this.input = null;
    this.output = null;
  }
  async send(bytes: Uint8Array) {
    if (!this.isOpen || !this.output) throw new Error('The MIDI transport is not open.');
    this.output.sendMessage([...bytes]);
  }
  onMessage(listener: (bytes: Uint8Array) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
