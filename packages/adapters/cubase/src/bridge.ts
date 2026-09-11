import {
  commandSchema,
  projectSchema,
  toolNames,
  toolSchemas,
  isLocalTool,
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
  revisionResultSchema,
  type BridgeRequest,
} from './protocol';
import type { MidiTransport } from './transport';

export const DEFAULT_REQUEST_TIMEOUT_MS = 4000;
/**
 * Pairing happens inside Cubase's MIDI Remote Manager while this side waits.
 * When this process publishes the port pair itself, those ports exist only
 * while the transport is open, so the handshake must hold them open long
 * enough for a producer to switch to Cubase and pair.
 */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60000;
export const HANDSHAKE_RETRY_MS = 2000;
export interface BridgeOptions {
  timeoutMs?: number;
  handshakeTimeoutMs?: number;
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
  private cached: { revision: number; project: ProjectState } | null = null;
  private timeoutMs: number;
  private handshakeTimeoutMs: number;
  private log: (event: string, detail: string) => void;
  constructor(
    private transport: MidiTransport,
    private selection: { input: string; output: string },
    options: BridgeOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
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
      hello = helloResultSchema.parse(await this.handshake());
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
    this.cached = null;
    await this.teardown();
  }
  /**
   * Retries the handshake without closing the transport, so published ports
   * stay visible to Cubase for the whole window instead of disappearing after
   * the first unanswered request.
   */
  private async handshake(): Promise<unknown> {
    const deadline = Date.now() + this.handshakeTimeoutMs;
    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        return await this.request(
          { op: 'hello', protocol: PROTOCOL_VERSION },
          { timeoutMs: Math.min(HANDSHAKE_RETRY_MS, this.timeoutMs), disconnectOnTimeout: false },
        );
      } catch (error) {
        if (Date.now() >= deadline)
          throw new Error(
            `Cubase did not answer the bridge handshake within ${Math.round(
              this.handshakeTimeoutMs / 1000,
            )}s after ${attempts} attempts. Pair the OrchestrAI Bridge script in Cubase's MIDI Remote Manager while the ports are published. (${
              error instanceof Error ? error.message : String(error)
            })`,
          );
      }
    }
  }
  async getCapabilities(): Promise<Capability[]> {
    const reported = new Set(this.session?.operations ?? []);
    // An adapter speaks for the DAW only; local tools are not its business.
    return toolNames
      .filter((id) => !isLocalTool(id))
      .map((id) => ({
        id,
        // Capability truth comes from the handshake, never from a static list.
        support: reported.has(id) ? 'bridge' : 'unsupported',
        // A host command acts on whatever Cubase has selected rather than on an
        // argument the producer was shown, which is what destructive means here.
        risk: id.includes('.get_')
          ? 'read'
          : id === 'host.run_command'
            ? 'destructive'
            : 'safe-write',
        requiresConfirmation: !id.includes('.get_'),
      }));
  }
  /**
   * A session is a large SysEx message and MIDI is a slow wire, so the state is
   * cached against the session's own revision: the poll that finds nothing
   * changed costs four bytes instead of two kilobytes. A revision probe that
   * fails for any reason falls through to a full read rather than serving a
   * cached session that may be stale.
   */
  async getProjectState(): Promise<ProjectState> {
    this.assertConnected();
    if (this.cached) {
      const current = await this.revision().catch(() => null);
      if (current !== null && current === this.cached.revision) return this.cached.project;
    }
    const state = stateResultSchema.parse(await this.request({ op: 'get_state' }));
    const project = projectSchema.parse({ ...state.project, mock: false });
    this.cached = { revision: project.revision, project };
    return project;
  }
  private async revision() {
    const result = revisionResultSchema.parse(await this.request({ op: 'get_revision' }));
    return result.revision;
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
    // A write answers with the state it produced, so the cache is refreshed
    // from the write rather than invalidated and re-read over the wire.
    const project = projectSchema.parse({ ...result.project, mock: false });
    this.cached = { revision: project.revision, project };
    return { project };
  }
  private assertConnected() {
    if (!this.session) throw new Error('The Cubase bridge is disconnected.');
  }
  private async request(
    payload: BridgeRequest,
    options: { timeoutMs?: number; disconnectOnTimeout?: boolean } = {},
  ): Promise<unknown> {
    const request = requestSchema.parse(payload);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const disconnectOnTimeout = options.disconnectOnTimeout ?? true;
    this.correlation = (this.correlation + 1) & 0x7f;
    const correlation = this.correlation;
    const frame = encodeFrame({ kind: 'request', correlation, payload: JSON.stringify(request) });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlation);
        this.log('bridge.timeout', request.op);
        // A silent DAW is a disconnected DAW; leaving the session "connected"
        // would let the next write queue against a peer that is not listening.
        // The handshake is the exception: nothing is connected yet, and the
        // published ports must stay visible for Cubase to pair with them.
        if (disconnectOnTimeout) void this.teardown();
        reject(new Error(`The Cubase bridge did not answer ${request.op} within ${timeoutMs} ms.`));
      }, timeoutMs);
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
