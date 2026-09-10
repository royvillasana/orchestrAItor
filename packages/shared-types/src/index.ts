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
          type: z.enum(['audio', 'midi', 'instrument']),
          mute: z.boolean(),
          solo: z.boolean(),
          volume: z.number(),
        })
        .strict(),
    ),
  })
  .strict();
export type ProjectState = z.infer<typeof projectSchema>;
export const toolNames = [
  'project.get_state',
  'project.get_tempo',
  'project.set_tempo',
  'transport.play',
  'transport.stop',
] as const;
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
export const snapshotSchema = z
  .object({
    runtime: runtimeStateSchema.nullable(),
    midi: midiStatusSchema.nullable(),
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
]);
export type StoreCommand = z.infer<typeof storeCommandSchema>;
export const wireSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('control'), id: idSchema, command: controlSchema }).strict(),
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
