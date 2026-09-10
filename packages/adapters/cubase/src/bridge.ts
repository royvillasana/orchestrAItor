import {
  commandSchema,
  projectSchema,
  toolNames,
  toolSchemas,
  type Capability,
  type DawAdapter,
  type DawCommand,
  type ProjectState,
  type ToolName,
} from '@orchestrai/shared-types';
import {
  PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  helloResultSchema,
  requestSchema,
  responseSchema,
  stateResultSchema,
  type BridgeRequest,
} from './protocol';
import type { MidiTransport } from './transport';

export const DEFAULT_REQUEST_TIMEOUT_MS = 4000;
export interface BridgeOptions {
  timeoutMs?: number;
  log?: (event: string, detail: string) => void;
}
export interface BridgeSession {
  daw: string;
  operations: ToolName[];
}
/**
 * Speaks the bridge protocol to a Cubase MIDI Remote driver script. A request
 * whose response never arrives fails and disconnects the bridge: a lost MIDI
 * message must never be reported to a producer as an applied write.
 */
export class CubaseBridgeAdapter implements DawAdapter {
  private unsubscribe: (() => void) | null = null;
  private correlation = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private session: BridgeSession | null = null;
  private timeoutMs: number;
  private log: (event: string, detail: string) => void;
  constructor(
    private transport: MidiTransport,
    private selection: { input: string; output: string },
    options: BridgeOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.log = options.log ?? (() => {});
  }
  get connected() {
    return this.session !== null;
  }
  get connectedDaw() {
    return this.session?.daw ?? null;
  }
  async connect() {
    if (this.session) return;
    await this.transport.open(this.selection);
    this.unsubscribe = this.transport.onMessage((bytes) => this.receive(bytes));
    let hello;
    try {
      hello = helloResultSchema.parse(
        await this.request({ op: 'hello', protocol: PROTOCOL_VERSION }),
      );
    } catch (error) {
      await this.teardown();
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (hello.protocol !== PROTOCOL_VERSION) {
      await this.teardown();
      throw new Error(
        `The Cubase bridge script speaks protocol ${hello.protocol}; this build speaks ${PROTOCOL_VERSION}. Update the driver script.`,
      );
    }
    this.session = { daw: hello.daw, operations: hello.operations };
  }
  async disconnect() {
    await this.teardown();
  }
  async getCapabilities(): Promise<Capability[]> {
    const reported = new Set(this.session?.operations ?? []);
    return toolNames.map((id) => ({
      id,
      // Capability truth comes from the handshake, never from a static list.
      support: reported.has(id) ? 'bridge' : 'unsupported',
      risk: id.includes('.get_') ? 'read' : 'safe-write',
      requiresConfirmation: !id.includes('.get_'),
    }));
  }
  async getProjectState(): Promise<ProjectState> {
    this.assertConnected();
    const state = stateResultSchema.parse(await this.request({ op: 'get_state' }));
    return projectSchema.parse({ ...state.project, mock: false });
  }
  async execute(input: DawCommand) {
    this.assertConnected();
    const command = commandSchema.parse(input);
    toolSchemas[command.tool].parse(command.arguments);
    if (!this.session?.operations.includes(command.tool))
      throw new Error(`The connected Cubase session does not support ${command.tool}.`);
    const result = stateResultSchema.parse(
      await this.request({
        op: 'execute',
        tool: command.tool,
        arguments: command.arguments as Record<string, unknown>,
      }),
    );
    return { project: projectSchema.parse({ ...result.project, mock: false }) };
  }
  private assertConnected() {
    if (!this.session) throw new Error('The Cubase bridge is disconnected.');
  }
  private async request(payload: BridgeRequest): Promise<unknown> {
    const request = requestSchema.parse(payload);
    this.correlation = (this.correlation + 1) & 0x7f;
    const correlation = this.correlation;
    const frame = encodeFrame({ kind: 'request', correlation, payload: JSON.stringify(request) });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlation);
        this.log('bridge.timeout', request.op);
        // A silent DAW is a disconnected DAW; leaving the session "connected"
        // would let the next write queue against a peer that is not listening.
        void this.teardown();
        reject(
          new Error(`The Cubase bridge did not answer ${request.op} within ${this.timeoutMs} ms.`),
        );
      }, this.timeoutMs);
      this.pending.set(correlation, { resolve, reject, timer });
      this.transport.send(frame).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(correlation);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
  private receive(bytes: Uint8Array) {
    const decoded = decodeFrame(bytes);
    if (!decoded.ok) {
      this.log('bridge.frame_rejected', decoded.reason);
      return;
    }
    if (decoded.frame.kind !== 'response') return;
    const waiting = this.pending.get(decoded.frame.correlation);
    if (!waiting) {
      this.log('bridge.unmatched_response', String(decoded.frame.correlation));
      return;
    }
    this.pending.delete(decoded.frame.correlation);
    clearTimeout(waiting.timer);
    let parsed;
    try {
      parsed = responseSchema.parse(JSON.parse(decoded.frame.payload));
    } catch {
      waiting.reject(new Error('The Cubase bridge sent a malformed response.'));
      return;
    }
    if (parsed.ok) waiting.resolve(parsed.result);
    else waiting.reject(new Error(parsed.error));
  }
  private async teardown() {
    this.session = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error('The Cubase bridge disconnected.'));
    }
    this.pending.clear();
    await this.transport.close();
  }
}
