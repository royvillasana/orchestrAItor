import { randomUUID } from 'node:crypto';
import {
  type DawCommand,
  type AdapterId,
  type ProviderId,
  type AgentRun,
  type RunBudget,
  runBudgetSchema,
  AGENT_MODE_TOOLS,
  type Capability,
  localToolNames,
  isLocalTool,
  isUnpromptedTool,
  hostCommand,
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
  private run: AgentRun | null = null;
  private runBefore: ProjectState | null = null;
  private finishedRuns = new Map<string, { run: AgentRun; before: ProjectState }>();
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
      // Selecting the adapter that is already live is not a change, and should
      // not read as one: a producer returning to the connection screen and
      // pressing connect means "take me back", not "swap the session".
      if (this.connected && id === this.adapterId) return this.state();
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
      run: this.run ? { ...this.run } : null,
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
      // Ask is reads only. Assist and Agent both expose writes; what differs is
      // whether a write waits for approval, not whether the tool exists.
      (c) =>
        c.support !== 'unsupported' &&
        (this.mode !== 'ask' || c.risk === 'read' || isUnpromptedTool(c.id)),
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
      await this.endRun('disconnected');
      await this.adapter.disconnect();
      this.connected = false;
      return this.state();
    });
  }
  setMode(mode: Mode) {
    return this.serial(async () => {
      if (this.mode !== mode) {
        await this.invalidate('Mode changed');
        // A run belongs to the mode it was authorised in.
        await this.endRun('mode-changed');
      }
      this.mode = mode;
      return this.state();
    });
  }
  /**
   * A run is what Agent mode actually authorises: a bounded number of writes
   * within a bounded time, on a named set of tools. It is granted per run and
   * never persists, because a mode whose purpose is acting without asking is
   * the one nobody should find already switched on.
   */
  startRun(budget: RunBudget) {
    return this.serial(async () => {
      if (this.mode !== 'agent') throw new Error('Switch to Agent mode before starting a run.');
      if (!this.connected) throw new Error('Connect a session before starting a run.');
      if (this.run && !this.run.endedAt) throw new Error('A run is already going.');
      this.runBefore = await this.adapter.getProjectState();
      this.run = {
        id: randomUUID(),
        budget: runBudgetSchema.parse(budget),
        startedAt: new Date(this.now()).toISOString(),
        writes: 0,
        endedAt: null,
        endedBecause: null,
        undone: false,
      };
      return this.state();
    });
  }
  stopRun() {
    return this.serial(async () => {
      await this.endRun('stopped');
      return this.state();
    });
  }
  private async endRun(reason: NonNullable<AgentRun['endedBecause']>) {
    if (!this.run || this.run.endedAt) return;
    this.run = { ...this.run, endedAt: new Date(this.now()).toISOString(), endedBecause: reason };
    if (this.runBefore)
      this.finishedRuns.set(this.run.id, { run: this.run, before: this.runBefore });
  }
  /** Checked before each write, never after: a budget spent afterwards is not a budget. */
  private runAllows(): { ok: true } | { ok: false; reason: NonNullable<AgentRun['endedBecause']> } {
    if (!this.run || this.run.endedAt) return { ok: false, reason: 'stopped' };
    if (this.run.writes >= this.run.budget.maxWrites) return { ok: false, reason: 'write-budget' };
    const elapsed = (this.now() - new Date(this.run.startedAt).getTime()) / 1000;
    if (elapsed >= this.run.budget.maxSeconds) return { ok: false, reason: 'time-budget' };
    return { ok: true };
  }
  cancel() {
    return this.serial(() => this.invalidate('Cancelled by user'));
  }
  /** The tools a run may use without asking. Destructive risk is never here. */
  private async autonomousTools(): Promise<Set<string>> {
    const allowed = new Set<string>();
    for (const capability of await this.capabilities())
      if (
        AGENT_MODE_TOOLS.includes(capability.id as (typeof AGENT_MODE_TOOLS)[number]) &&
        capability.risk !== 'destructive'
      )
        allowed.add(capability.id);
    return allowed;
  }
  /**
   * A host command takes no arguments and acts on whatever the session has
   * selected, so the approval has to say what that is. Everything else can be
   * read from the arguments the producer is already shown.
   */
  private async approvalDetail(call: Activity) {
    if (call.tool !== 'host.run_command') return 'Waiting for your approval. No changes made.';
    const entry = hostCommand(String(call.arguments.command));
    const selected = (await this.adapter.getProjectState().catch(() => null))?.tracks.find(
      (track) => track.selected,
    );
    return `${entry?.label ?? 'Run a Cubase command'}. This acts on what Cubase has selected: ${
      selected ? `"${selected.name}"` : 'nothing is selected'
    }.${entry?.dialog ? ' This opens a dialog in Cubase for you to finish.' : ''}`;
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
      // Playing and stopping move the playhead, not the project. They are
      // recorded like any other call and execute directly, in every mode:
      // approving "play" would be approving listening.
      if (capability.risk !== 'read' && !isUnpromptedTool(tool)) {
        if (this.mode === 'ask')
          return this.record({
            ...call,
            status: 'denied',
            detail: 'Ask mode cannot change the project. Switch to Assist to propose changes.',
          });
        if (this.mode === 'agent') {
          const permitted = await this.autonomousTools();
          // Only the standing list runs without asking. Anything else takes the
          // same approval it would in Assist, Agent mode or not.
          if (permitted.has(tool)) {
            const allowed = this.runAllows();
            if (!allowed.ok) {
              await this.endRun(allowed.reason);
              return this.record({
                ...call,
                status: 'denied',
                detail:
                  allowed.reason === 'write-budget'
                    ? 'The run reached its write limit. Start another run to continue.'
                    : allowed.reason === 'time-budget'
                      ? 'The run reached its time limit. Start another run to continue.'
                      : 'No run is active. Start one to make changes without approval.',
              });
            }
            this.run = { ...this.run!, writes: this.run!.writes + 1 };
            const executed = await this.execute({ ...call, runId: this.run.id });
            // A failed write ends the run: continuing would be guessing about a
            // session whose state is no longer known, unwatched.
            if (executed.status !== 'succeeded') await this.endRun('failed');
            return executed;
          }
        }
        return this.record({
          ...call,
          status: 'awaiting-approval',
          expiresAt: this.now() + 300000,
          detail: undoOf
            ? 'Approve restoring the previous session state.'
            : await this.approvalDetail(call),
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
  /**
   * Undo the run, not its writes. A producer authorised the run; asking them to
   * reason about the ordering of writes they never watched would be a worse
   * question than the one they actually answered.
   */
  undoRun(id: string, conversationId: string) {
    return this.serial(async () => {
      const finished = this.finishedRuns.get(id);
      if (!finished) throw new Error('That run is not available to undo.');
      if (finished.run.undone) throw new Error('That run has already been undone.');
      const current = await this.adapter.getProjectState();
      const since = this.lastWriteRevisionFor(id);
      if (since !== null && current.revision !== since)
        throw new Error('Undo conflict: the session has changed since that run.');
      const before = finished.before;
      const steps: DawCommand[] = [
        { tool: 'project.set_tempo', arguments: { tempo: before.tempo } },
        { tool: before.playing ? 'transport.play' : 'transport.stop', arguments: {} },
        ...before.tracks.flatMap((track): DawCommand[] => [
          { tool: 'track.set_volume', arguments: { trackId: track.id, volume: track.volume } },
          { tool: 'track.set_mute', arguments: { trackId: track.id, mute: track.mute } },
          { tool: 'track.set_solo', arguments: { trackId: track.id, solo: track.solo } },
          // Pan, arm and monitor move during a run like anything else on a
          // channel, so undoing the run has to put them back too.
          ...(track.pan === undefined
            ? []
            : ([
                { tool: 'track.set_pan', arguments: { trackId: track.id, pan: track.pan } },
              ] as DawCommand[])),
          ...(track.recordEnabled === undefined
            ? []
            : ([
                {
                  tool: 'track.set_record_enable',
                  arguments: { trackId: track.id, armed: track.recordEnabled },
                },
              ] as DawCommand[])),
          ...(track.monitoring === undefined
            ? []
            : ([
                {
                  tool: 'track.set_monitor',
                  arguments: { trackId: track.id, monitoring: track.monitoring },
                },
              ] as DawCommand[])),
          // A run may move quick controls without asking, so undoing the run
          // has to put them back; the capability filter below drops these
          // where the adapter reports no plugin control.
          ...(track.plugin
            ? ([
                {
                  tool: 'plugin.set_bypass',
                  arguments: { trackId: track.id, bypassed: track.plugin.bypassed },
                },
                ...track.plugin.quickControls.map((control) => ({
                  tool: 'plugin.set_quick_control',
                  arguments: { trackId: track.id, index: control.index, value: control.value },
                })),
              ] as DawCommand[])
            : []),
        ]),
      ];
      const call: Activity = {
        id: randomUUID(),
        sessionId: this.sessionId,
        conversationId,
        agent: 'user',
        tool: 'run.undo',
        arguments: { runId: id },
        status: 'running',
        timestamp: new Date(this.now()).toISOString(),
        detail: 'Restoring the session to before the run.',
        undoable: false,
      };
      await this.record(call);
      try {
        for (const step of steps)
          if (
            (await this.capabilities()).some(
              (c) => c.id === step.tool && c.support !== 'unsupported',
            )
          )
            await this.adapter.execute(step);
      } catch (error) {
        return this.record({ ...call, status: 'failed', detail: errorText(error) });
      }
      this.finishedRuns.set(id, { ...finished, run: { ...finished.run, undone: true } });
      if (this.run?.id === id) this.run = { ...this.run, undone: true };
      return this.record({
        ...call,
        status: 'succeeded',
        detail: `Restored the session to before the run: ${before.tempo} BPM, ${before.tracks.length} track(s).`,
      });
    });
  }
  private lastWriteRevisionFor(runId: string): number | null {
    let revision: number | null = null;
    for (const call of this.calls.values())
      if (call.runId === runId && call.afterRevision !== undefined) revision = call.afterRevision;
    return revision;
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
