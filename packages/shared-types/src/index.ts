import { z } from 'zod';

export const idSchema = z.string().min(1).max(100);
export const modeSchema = z.enum(['ask', 'assist']);
export type Mode = z.infer<typeof modeSchema>;
export const tempoSchema = z.number().finite().min(20).max(300);
export const adapterIdSchema = z.enum(['mock', 'bridge']);
export type AdapterId = z.infer<typeof adapterIdSchema>;
export const providerIdSchema = z.enum(['demo', 'claude', 'codex']);
export type ProviderId = z.infer<typeof providerIdSchema>;
export const midiPortSchema = z
  .object({ id: idSchema, name: z.string().max(200), direction: z.enum(['input', 'output']) })
  .strict();
export const midiStatusSchema = z
  .object({
    available: z.boolean(),
    reason: z.string().max(500).nullable(),
    remedy: z.string().max(500).nullable(),
    ports: z.array(midiPortSchema),
  })
  .strict();
export type MidiStatus = z.infer<typeof midiStatusSchema>;
export const indexedSampleSchema = z
  .object({
    id: idSchema,
    root: z.string().max(1000),
    path: z.string().max(1000),
    name: z.string().max(300),
    extension: z.string().max(10),
    size: z.number().int().nonnegative(),
    modifiedMs: z.number().int().nonnegative(),
    tags: z.array(z.string().max(24)).max(24),
    sampleRate: z.number().int().positive().nullable(),
    channels: z.number().int().positive().nullable(),
    bitDepth: z.number().int().positive().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type IndexedSample = z.infer<typeof indexedSampleSchema>;
export const indexReportSchema = z
  .object({
    root: z.string().max(1000),
    samples: z.array(indexedSampleSchema),
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    removed: z.array(z.string().max(1000)),
    skipped: z.number().int().nonnegative(),
    truncated: z.boolean(),
    errors: z.array(z.string().max(500)),
    indexedAt: z.string(),
  })
  .strict();
export type IndexReport = z.infer<typeof indexReportSchema>;
export const sampleRootSchema = z
  .object({
    path: z.string().max(1000),
    count: z.number().int().nonnegative(),
    indexedAt: z.string().nullable(),
    truncated: z.boolean(),
    error: z.string().max(500).nullable(),
  })
  .strict();
export type SampleRoot = z.infer<typeof sampleRootSchema>;
export const sampleLibrarySchema = z
  .object({ roots: z.array(sampleRootSchema), total: z.number().int().nonnegative() })
  .strict();
export type SampleLibrary = z.infer<typeof sampleLibrarySchema>;
export const clipKindSchema = z.enum(['chords', 'bass', 'drums']);
export const artifactSchema = z
  .object({
    id: idSchema,
    name: z.string().max(200),
    kind: clipKindSchema,
    path: z.string().max(1000),
    summary: z.string().max(500),
    bars: z.number().int().min(1).max(32),
    tempo: tempoSchema,
    key: z.string().max(10),
    scale: z.string().max(20),
    progression: z.string().max(30),
    seed: z.number().int().nonnegative(),
    noteCount: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .strict();
export type MidiArtifact = z.infer<typeof artifactSchema>;
export const capabilitySchema = z
  .object({
    id: idSchema,
    support: z.enum(['native', 'bridge', 'experimental', 'unsupported']),
    risk: z.enum(['read', 'safe-write', 'destructive']),
    requiresConfirmation: z.boolean(),
  })
  .strict();
export type Capability = z.infer<typeof capabilitySchema>;
export const projectSchema = z
  .object({
    name: z.string(),
    tempo: tempoSchema,
    key: z.string(),
    timeSignature: z.string(),
    playing: z.boolean(),
    revision: z.number().int().nonnegative(),
    mock: z.boolean(),
    tracks: z.array(
      z
        .object({
          id: idSchema,
          name: z.string(),
          type: z.enum(['audio', 'midi', 'instrument', 'group', 'fx']),
          mute: z.boolean(),
          solo: z.boolean(),
          // The fader position the DAW reports, not decibels: converting would
          // mean guessing at Steinberg's taper, and a wrong dB figure reads as
          // authoritative in a way a normalized one does not.
          volume: z.number().min(0).max(1),
        })
        .strict(),
    ),
    /** True when the session has more channels than the reported bank covers. */
    tracksTruncated: z.boolean().optional(),
  })
  .strict();
export type ProjectState = z.infer<typeof projectSchema>;
export const toolNames = [
  'project.get_state',
  'project.get_tempo',
  'project.set_tempo',
  'transport.play',
  'transport.stop',
  'track.set_volume',
  'track.set_mute',
  'track.set_solo',
  'samples.search',
  'samples.stats',
  'midi.create_clip',
] as const;
/** Local tools that answer from the sample index rather than from a DAW. */
export const localToolNames = ['samples.search', 'samples.stats', 'midi.create_clip'] as const;
/** Local writes produce a file rather than a DAW change, but still need approval. */
export const localWriteToolNames = ['midi.create_clip'] as const;
export const isLocalWriteTool = (name: string): name is (typeof localWriteToolNames)[number] =>
  (localWriteToolNames as readonly string[]).includes(name);
export const isLocalTool = (name: string): name is (typeof localToolNames)[number] =>
  (localToolNames as readonly string[]).includes(name);
export const toolNameSchema = z.enum(toolNames);
export type ToolName = z.infer<typeof toolNameSchema>;
export const emptySchema = z.object({}).strict();
export const argumentsSchema = z.record(z.unknown()).refine((value) => {
  try {
    return JSON.stringify(value).length <= 8192;
  } catch {
    return false;
  }
}, 'Tool arguments must be serializable and no larger than 8 KB.');
export const toolSchemas = {
  'project.get_state': emptySchema,
  'project.get_tempo': emptySchema,
  'project.set_tempo': z.object({ tempo: tempoSchema }).strict(),
  'transport.play': emptySchema,
  'transport.stop': emptySchema,
  'track.set_volume': z.object({ trackId: idSchema, volume: z.number().min(0).max(1) }).strict(),
  'track.set_mute': z.object({ trackId: idSchema, mute: z.boolean() }).strict(),
  'track.set_solo': z.object({ trackId: idSchema, solo: z.boolean() }).strict(),
  'samples.search': z
    .object({
      query: z.string().trim().min(1).max(120),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  'samples.stats': emptySchema,
  'midi.create_clip': z
    .object({
      kind: clipKindSchema,
      bars: z.number().int().min(1).max(32).optional(),
      key: z.string().max(10).optional(),
      scale: z
        .enum(['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'harmonicMinor'])
        .optional(),
      progression: z.enum(['pop', 'sad', 'loop', 'cadence', 'descending']).optional(),
      tempo: tempoSchema.optional(),
      seed: z.number().int().min(0).max(999999).optional(),
    })
    .strict(),
};
export const commandSchema = z
  .object({ tool: toolNameSchema, arguments: argumentsSchema })
  .strict();
export type DawCommand = z.infer<typeof commandSchema>;
export const resultSchema = z.object({ project: projectSchema }).strict();
export type DawCommandResult = z.infer<typeof resultSchema>;
export interface DawAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<Capability[]>;
  getProjectState(): Promise<ProjectState>;
  execute(command: DawCommand): Promise<DawCommandResult>;
}
export const messageSchema = z
  .object({
    id: idSchema,
    conversationId: idSchema,
    role: z.enum(['user', 'assistant']),
    content: z.string().max(16000),
    provider: z.string(),
    timestamp: z.string(),
  })
  .strict();
export type Message = z.infer<typeof messageSchema>;
export const conversationSchema = z
  .object({ id: idSchema, title: z.string().max(120), timestamp: z.string() })
  .strict();
export type Conversation = z.infer<typeof conversationSchema> & { messages: Message[] };
export const activitySchema = z
  .object({
    id: idSchema,
    sessionId: idSchema,
    conversationId: idSchema,
    agent: idSchema,
    tool: z.string().max(100),
    arguments: z.record(z.unknown()),
    status: z.enum([
      'requested',
      'awaiting-approval',
      'running',
      'succeeded',
      'failed',
      'denied',
      'cancelled',
      'interrupted',
      'unknown-outcome',
    ]),
    timestamp: z.string(),
    detail: z.string(),
    expiresAt: z.number().optional(),
    undoable: z.boolean(),
    before: projectSchema.optional(),
    result: resultSchema.optional(),
    afterRevision: z.number().optional(),
    undoOf: idSchema.optional(),
  })
  .strict();
export type Activity = z.infer<typeof activitySchema>;
export const agentSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    installed: z.boolean(),
    executable: z.string().nullable(),
    status: z.enum(['detected', 'missing', 'unavailable']),
    // Discovery never executes a candidate, so it can only ever report
    // 'unverified'. The other states come from explicit verification.
    authentication: z.enum(['unverified', 'authenticated', 'unauthenticated', 'failed']),
    account: z.string().max(200).nullable(),
    version: z.string().max(60).nullable(),
    errors: z.array(z.string()),
  })
  .strict();
export type DiscoveredAgent = z.infer<typeof agentSchema>;
export const logSchema = z
  .object({
    timestamp: z.string(),
    level: z.enum(['info', 'error']),
    event: z.string(),
    requestId: z.string().optional(),
    detail: z.string(),
  })
  .strict();
export type LogEntry = z.infer<typeof logSchema>;
export const historySchema = z
  .object({
    conversations: z.array(conversationSchema),
    messages: z.array(messageSchema),
    activities: z.array(activitySchema),
    mode: modeSchema,
  })
  .strict();
export const runtimeStateSchema = z
  .object({
    sessionId: idSchema,
    connected: z.boolean(),
    mode: modeSchema,
    project: projectSchema.nullable(),
    capabilities: z.array(capabilitySchema),
    adapter: adapterIdSchema,
    daw: z.string().max(120).nullable(),
    provider: providerIdSchema,
    providerLabel: z.string().max(120),
    providerLive: z.boolean(),
  })
  .strict();
export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export const streamSchema = z
  .object({ conversationId: idSchema, text: z.string().max(16000), done: z.boolean() })
  .strict();
export type StreamChunk = z.infer<typeof streamSchema>;
export const snapshotSchema = z
  .object({
    runtime: runtimeStateSchema.nullable(),
    midi: midiStatusSchema.nullable(),
    library: sampleLibrarySchema,
    indexing: z.string().max(300).nullable(),
    streaming: streamSchema.nullable(),
    samples: z.array(indexedSampleSchema).max(50),
    artifacts: z.array(artifactSchema).max(200),
    agents: z.array(agentSchema),
    history: historySchema,
    logs: z.array(logSchema),
    error: z.string().nullable(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const callSchema = z
  .object({ tool: toolNameSchema, arguments: argumentsSchema, conversationId: idSchema })
  .strict();
export const decisionSchema = z
  .object({ id: idSchema, sessionId: idSchema, approve: z.boolean() })
  .strict();
export const sendSchema = z
  .object({ conversationId: idSchema, content: z.string().trim().min(1).max(4000) })
  .strict();
export const controlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z
    .object({
      type: z.literal('connect'),
      adapter: adapterIdSchema.optional(),
      provider: providerIdSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('midi') }).strict(),
  z.object({ type: z.literal('verify'), agent: providerIdSchema }).strict(),
  // Switching the creative partner mid-session, without touching the DAW.
  z.object({ type: z.literal('provider'), provider: providerIdSchema }).strict(),
  z.object({ type: z.literal('disconnect') }).strict(),
  z.object({ type: z.literal('mode'), mode: modeSchema }).strict(),
  z.object({ type: z.literal('decision'), decision: decisionSchema }).strict(),
  z.object({ type: z.literal('undo'), id: idSchema, conversationId: idSchema }).strict(),
  z.object({ type: z.literal('chat'), message: sendSchema }).strict(),
  z.object({ type: z.literal('cancel') }).strict(),
]);
export type Control = z.infer<typeof controlSchema>;
export const storeCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('history') }).strict(),
  z.object({ type: z.literal('conversation'), conversation: conversationSchema }).strict(),
  z.object({ type: z.literal('message'), message: messageSchema }).strict(),
  z.object({ type: z.literal('activity'), activity: activitySchema }).strict(),
  z.object({ type: z.literal('mode'), mode: modeSchema }).strict(),
  z.object({ type: z.literal('interrupt') }).strict(),
  z.object({ type: z.literal('log'), log: logSchema }).strict(),
  z.object({ type: z.literal('library') }).strict(),
  z.object({ type: z.literal('addRoot'), path: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal('removeRoot'), path: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal('indexed'), report: indexReportSchema }).strict(),
  z
    .object({
      type: z.literal('searchSamples'),
      query: z.string().max(120),
      limit: z.number().int().min(1).max(50),
    })
    .strict(),
  z.object({ type: z.literal('sampleByPath'), path: z.string().max(1000) }).strict(),
  z.object({ type: z.literal('samplesForRoot'), root: z.string().max(1000) }).strict(),
  z.object({ type: z.literal('artifacts') }).strict(),
  z
    .object({
      type: z.literal('artifact'),
      artifact: artifactSchema.omit({ path: true }),
      // The clip itself, base64 for the wire; the store owns where it lands.
      data: z.string().max(2000000),
    })
    .strict(),
  z.object({ type: z.literal('removeArtifact'), id: idSchema }).strict(),
]);
export type StoreCommand = z.infer<typeof storeCommandSchema>;
export const wireSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('control'), id: idSchema, command: controlSchema }).strict(),
  // Assistant text as it arrives. It is display state only: the persisted
  // message is still written once, when the turn finishes.
  z.object({ kind: z.literal('stream'), chunk: streamSchema }).strict(),
  z.object({ kind: z.literal('store'), id: idSchema, command: storeCommandSchema }).strict(),
  z
    .object({
      kind: z.literal('reply'),
      id: idSchema,
      value: z.unknown().optional(),
      error: z.string().optional(),
    })
    .strict(),
]);
export type Wire = z.infer<typeof wireSchema>;
export const ipcInputs = {
  snapshot: emptySchema,
  discover: emptySchema,
  connect: z
    .object({ adapter: adapterIdSchema.optional(), provider: providerIdSchema.optional() })
    .strict(),
  verify: z.object({ agent: providerIdSchema }).strict(),
  setProvider: z.object({ provider: providerIdSchema }).strict(),
  addSampleFolder: emptySchema,
  removeSampleFolder: z.object({ path: z.string().min(1).max(1000) }).strict(),
  reindexSamples: emptySchema,
  revealArtifact: z.object({ id: idSchema }).strict(),
  removeArtifact: z.object({ id: idSchema }).strict(),
  dragArtifact: z.object({ id: idSchema }).strict(),
  searchSamples: z
    .object({ query: z.string().max(120), limit: z.number().int().min(1).max(50).optional() })
    .strict(),
  disconnect: emptySchema,
  restart: emptySchema,
  setMode: z.object({ mode: modeSchema }).strict(),
  createConversation: emptySchema,
  sendMessage: sendSchema,
  callTool: callSchema,
  decide: decisionSchema,
  undo: z.object({ id: idSchema, conversationId: idSchema }).strict(),
  cancel: emptySchema,
};
export type IpcMethod = keyof typeof ipcInputs;
export type OrchestraAPI = {
  [K in IpcMethod]: (input: z.infer<(typeof ipcInputs)[K]>) => Promise<Snapshot>;
};
export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}
export const agentResponseSchema = z
  .object({ text: z.string().max(16000), commands: z.array(commandSchema).max(10) })
  .strict();
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export interface AgentCapabilities {
  tools: boolean;
  streaming: boolean;
  local: boolean;
}
export interface AgentProvider {
  id: string;
  name: string;
  initialize(): Promise<void>;
  sendMessage(conversation: Conversation, tools: ToolDefinition[]): Promise<AgentResponse>;
  cancel(): Promise<void>;
  getCapabilities(): AgentCapabilities;
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
