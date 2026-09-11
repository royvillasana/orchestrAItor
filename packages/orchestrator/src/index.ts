import { randomUUID } from 'node:crypto';
import {
  type AdapterId,
  type ProviderId,
  type Capability,
  localToolNames,
  isLocalTool,
  isLocalWriteTool,
  activitySchema,
  errorText,
  resultSchema,
  toolNameSchema,
  toolSchemas,
  type Activity,
  type DawAdapter,
  type Mode,
  type ProjectState,
  type RuntimeState,
  type ToolName,
} from '@orchestrai/shared-types';

export interface SampleQuery {
  query?: string;
  key?: string;
  scale?: 'major' | 'minor';
  tempoMin?: number;
  tempoMax?: number;
  limit?: number;
}
export interface SampleTools {
  search(query: SampleQuery): Promise<string>;
  stats(): Promise<string>;
}
export interface ArtifactTools {
  createClip(input: Record<string, unknown>): Promise<string>;
}
export class Orchestrator {
  readonly sessionId = randomUUID();
  private mode: Mode = 'ask';
  private connected = false;
  private queue: Promise<unknown> = Promise.resolve();
  private calls = new Map<string, Activity>();
  private adapterId: AdapterId = 'mock';
  private samples: SampleTools | null = null;
  private artifacts: ArtifactTools | null = null;
  private provider: { id: ProviderId; label: string; live: boolean } = {
    id: 'demo',
    label: 'Demo agent',
    live: false,
  };
  constructor(
    private adapter: DawAdapter,
    private readonly persist: (activity: Activity) => Promise<void>,
    private readonly now = Date.now,
  ) {}
  /**
   * Adapter choice is an application decision, never an agent one: this is
   * reachable only over the trusted control channel, and only while
   * disconnected, so a live session can never be swapped underneath a caller
   * holding an approval.
   */
  /** Provider identity travels with every message, so it is runtime state. */
  useProvider(provider: { id: ProviderId; label: string; live: boolean }) {
    return this.serial(async () => {
      this.provider = provider;
      return this.state();
    });
  }
  useAdapter(id: AdapterId, adapter: DawAdapter) {
    return this.serial(async () => {
      if (this.connected) throw new Error('Disconnect before changing the DAW adapter.');
      this.adapter = adapter;
      this.adapterId = id;
      return this.state();
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async state(): Promise<RuntimeState> {
    return {
      sessionId: this.sessionId,
      connected: this.connected,
      mode: this.mode,
      project: this.connected ? await this.adapter.getProjectState() : null,
      capabilities: await this.adapter.getCapabilities(),
      adapter: this.adapterId,
      daw: this.connected ? this.dawLabel() : null,
      provider: this.provider.id,
      providerLabel: this.provider.label,
      providerLive: this.provider.live,
    };
  }
  /** Everything the session can do, before the mode filter. */
  private async capabilities(): Promise<Capability[]> {
    const adapterTools = (await this.adapter.getCapabilities()).filter(
      (c) => !isLocalTool(c.id) && toolNameSchema.safeParse(c.id).success,
    );
    // Sample tools answer from the local index, so they do not depend on a DAW
    // session and are read-only in both modes.
    const localTools: Capability[] = localToolNames
      .filter((id) => (isLocalWriteTool(id) ? this.artifacts !== null : this.samples !== null))
      .map((id) => ({
        id,
        support: 'native' as const,
        // A generated clip is a file the producer did not ask for byte by byte,
        // so it is a write and takes the same approval as one.
        risk: isLocalWriteTool(id) ? ('safe-write' as const) : ('read' as const),
        requiresConfirmation: isLocalWriteTool(id),
      }));
    return [...adapterTools, ...localTools];
  }
  async tools() {
    return (await this.capabilities()).filter(
      (c) => c.support !== 'unsupported' && (this.mode === 'assist' || c.risk === 'read'),
    );
  }
  /** Local, read-only sample search, injected so the orchestrator owns no storage. */
  useSamples(samples: SampleTools | null) {
    this.samples = samples;
  }
  /** Local clip generation, injected for the same reason. */
  useArtifacts(artifacts: ArtifactTools | null) {
    this.artifacts = artifacts;
  }
  private dawLabel() {
    const named = this.adapter as DawAdapter & { connectedDaw?: string | null };
    return named.connectedDaw ?? (this.adapterId === 'mock' ? 'Cubase 14 (mock)' : 'Cubase');
  }
  connect() {
    return this.serial(async () => {
      await this.adapter.connect();
      this.connected = true;
      return this.state();
    });
  }
  disconnect() {
    return this.serial(async () => {
      await this.invalidate('Disconnected');
      await this.adapter.disconnect();
      this.connected = false;
      return this.state();
    });
  }
  setMode(mode: Mode) {
    return this.serial(async () => {
      if (this.mode !== mode) await this.invalidate('Mode changed');
      this.mode = mode;
      return this.state();
    });
  }
  cancel() {
    return this.serial(() => this.invalidate('Cancelled by user'));
  }
  private async invalidate(reason: string) {
    for (const call of this.calls.values())
      if (call.status === 'awaiting-approval')
        await this.record({ ...call, status: 'cancelled', undoable: false, detail: reason });
  }
  private async record(call: Activity) {
    const parsed = activitySchema.parse(call);
    await this.persist(structuredClone(parsed));
    this.calls.set(call.id, structuredClone(parsed));
    return structuredClone(parsed);
  }
  request(tool: string, args: Record<string, unknown>, conversationId: string, agent = 'demo') {
    return this.serial(() => this.prepare(tool, args, conversationId, agent));
  }
  private async prepare(
    tool: string,
    args: Record<string, unknown>,
    conversationId: string,
    agent: string,
    undoOf?: string,
  ) {
    let call: Activity = {
      id: randomUUID(),
      sessionId: this.sessionId,
      conversationId,
      agent,
      tool,
      arguments: structuredClone(args),
      status: 'requested',
      timestamp: new Date(this.now()).toISOString(),
      detail: 'Requested',
      undoable: false,
      ...(undoOf ? { undoOf } : {}),
    };
    await this.record(call);
    try {
      const name = toolNameSchema.parse(tool);
      const validated = toolSchemas[name].parse(args);
      // Looked up unfiltered, so an Ask-mode write is explained rather than
      // reported as a tool that does not exist.
      const capability = (await this.capabilities()).find((c) => c.id === tool);
      if (!capability || capability.support === 'unsupported')
        throw new Error('Tool unavailable in the current session.');
      // Everything but the local sample tools needs a connected DAW.
      if (!isLocalTool(tool) && !this.connected)
        throw new Error('Tool unavailable in the current adapter session.');
      call = { ...call, arguments: validated };
      if (capability.risk !== 'read') {
        if (this.mode === 'ask')
          return this.record({
            ...call,
            status: 'denied',
            detail: 'Ask mode cannot change the project. Switch to Assist to propose changes.',
          });
        return this.record({
          ...call,
          status: 'awaiting-approval',
          expiresAt: this.now() + 300000,
          detail: undoOf
            ? 'Approve restoring the previous session state.'
            : 'Waiting for your approval. No changes made.',
        });
      }
      return await this.execute(call);
    } catch (error) {
      return this.record({ ...call, status: 'failed', detail: errorText(error) });
    }
  }
  /**
   * Local reads have no project state to snapshot and nothing to undo, so they
   * take the same recorded path without the adapter's before/after handling.
   */
  private async executeLocal(call: Activity): Promise<Activity> {
    await this.record({
      ...call,
      status: 'running',
      detail: isLocalWriteTool(call.tool)
        ? 'Generating the clip.'
        : 'Reading the local sample index.',
    });
    try {
      if (isLocalWriteTool(call.tool)) {
        if (!this.artifacts) throw new Error('Clip generation is unavailable.');
        const detail = await this.artifacts.createClip(
          toolSchemas['midi.create_clip'].parse(call.arguments),
        );
        // A generated file is not session state, so there is nothing to restore
        // into the DAW and nothing to offer an undo for.
        return this.record({ ...call, status: 'succeeded', undoable: false, detail });
      }
      if (!this.samples) throw new Error('No sample library is available.');
      const detail =
        call.tool === 'samples.stats'
          ? await this.samples.stats()
          : await this.samples.search(toolSchemas['samples.search'].parse(call.arguments));
      return this.record({ ...call, status: 'succeeded', undoable: false, detail });
    } catch (error) {
      return this.record({ ...call, status: 'failed', detail: errorText(error) });
    }
  }
  decide(id: string, sessionId: string, approve: boolean) {
    return this.serial(async () => {
      const call = this.calls.get(id);
      if (
        !call ||
        call.sessionId !== sessionId ||
        sessionId !== this.sessionId ||
        call.status !== 'awaiting-approval'
      ) {
        const rejected: Activity = {
          id: randomUUID(),
          sessionId: this.sessionId,
          conversationId: call?.conversationId ?? 'system',
          agent: 'user',
          tool: 'approval.rejected',
          arguments: { id },
          status: 'denied',
          timestamp: new Date(this.now()).toISOString(),
          detail: 'Approval is invalid, belongs to another session, or was already used.',
          undoable: false,
        };
        return this.record(rejected);
      }
      if (!approve)
        return this.record({ ...call, status: 'cancelled', detail: 'Cancelled by user.' });
      if ((call.expiresAt ?? 0) <= this.now())
        return this.record({
          ...call,
          status: 'denied',
          detail: 'Approval expired. Request the change again.',
        });
      if (this.mode !== 'assist' || !this.connected)
        return this.record({
          ...call,
          status: 'denied',
          detail: 'Session no longer permits this write.',
        });
      return this.execute(call);
    });
  }
  expire() {
    return this.serial(async () => {
      for (const call of this.calls.values())
        if (call.status === 'awaiting-approval' && (call.expiresAt ?? 0) <= this.now())
          await this.record({
            ...call,
            status: 'denied',
            detail: 'Approval expired. Request the change again.',
          });
    });
  }
  undo(id: string, conversationId: string) {
    return this.serial(async () => {
      const original = this.calls.get(id);
      if (!original?.undoable || !original.before || original.status !== 'succeeded')
        throw new Error('This operation cannot be undone in the current session.');
      const tool = original.tool as ToolName;
      const inverse =
        tool === 'project.set_tempo'
          ? tool
          : original.before.playing
            ? 'transport.play'
            : 'transport.stop';
      return this.prepare(
        inverse,
        tool === 'project.set_tempo' ? { tempo: original.before.tempo } : {},
        conversationId,
        'user',
        id,
      );
    });
  }
  private async execute(call: Activity): Promise<Activity> {
    if (isLocalTool(call.tool)) return this.executeLocal(call);
    let before: ProjectState;
    try {
      const available = await this.tools();
      if (!available.some((c) => c.id === call.tool))
        throw new Error('Capability or permission changed before execution.');
      before = await this.adapter.getProjectState();
      if (call.undoOf) {
        const original = this.calls.get(call.undoOf);
        if (!original?.undoable || original.afterRevision !== before.revision)
          throw new Error('Undo conflict: the project has changed since this operation.');
      }
    } catch (error) {
      return this.record({ ...call, status: 'failed', detail: errorText(error) });
    }
    // A durable running intent is required before the adapter can mutate anything.
    await this.record({ ...call, status: 'running', before, detail: 'Executing normalized tool.' });
    let project: ProjectState;
    try {
      project = resultSchema.parse(
        await this.adapter.execute({
          tool: toolNameSchema.parse(call.tool),
          arguments: call.arguments,
        }),
      ).project;
    } catch (error) {
      return this.record({ ...call, status: 'failed', detail: errorText(error) });
    }
    const write = !call.tool.includes('.get_');
    const completed: Activity = {
      ...call,
      status: 'succeeded',
      before,
      afterRevision: project.revision,
      result: { project },
      undoable: write && !call.undoOf,
      detail: `${project.name} · ${project.tempo} BPM · ${project.key} · ${project.playing ? 'Playing' : 'Stopped'}${project.mock ? ' (mock)' : ' (live)'}`,
    };
    try {
      if (call.undoOf) {
        const original = this.calls.get(call.undoOf)!;
        await this.record({ ...original, undoable: false });
      }
      return await this.record(completed);
    } catch (error) {
      this.calls.set(call.id, {
        ...call,
        status: 'unknown-outcome',
        undoable: false,
        detail: 'The adapter ran, but its result could not be saved. Do not retry automatically.',
      });
      throw new Error(`Unknown outcome: ${errorText(error)}`);
    }
  }
}
