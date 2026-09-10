import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  session,
  shell,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { discoverAgents } from '@orchestrai/cli';
import { indexRoot } from '@orchestrai/sample-indexer';
import {
  historySchema,
  snapshotSchema,
  midiStatusSchema,
  providerIdSchema,
  sampleLibrarySchema,
  indexedSampleSchema,
  artifactSchema,
  ipcInputs,
  sendSchema,
  callSchema,
  decisionSchema,
  errorText,
  type Snapshot,
  type LogEntry,
  type IpcMethod,
  type Activity,
  type RuntimeState,
  type MidiStatus,
  type StreamChunk,
} from '@orchestrai/shared-types';
import { DatabaseService, RuntimeService } from './services';
import { assetResponse, sampleResponse, trustedURL, trustedSender } from './security';
import { redact } from './store';

app.setName('OrchestrAI');
if (process.env.ORCHESTRA_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.ORCHESTRA_DATA_DIR));
// SQLite checkpoints have a single writer, including across application instances.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'orchestra',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    // Media only: streaming needs range support, and nothing fetches this
    // scheme from script.
    scheme: 'orchestra-sample',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false },
  },
]);
const developmentOrigin =
  !app.isPackaged && process.env.ORCHESTRA_DEV === '1' ? 'http://127.0.0.1:3210' : undefined;
let window: BrowserWindow | null = null;
let db: DatabaseService;
let runtime: RuntimeService | null = null;
let state: RuntimeState | null = null;
let midi: MidiStatus | null = null;
let indexing: string | null = null;
let streaming: StreamChunk | null = null;
let samples: Snapshot['samples'] = [];
let library: Snapshot['library'] = { roots: [], total: 0 };
let artifacts: Snapshot['artifacts'] = [];
/** Discovery ids are product names; provider ids are what the runtime selects. */
/** Drag needs a picture; a plain accent tile beats a missing icon. */
const DRAG_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAUElEQVR42u3aMQ0AIAwAwUogBPkIwgwaiggGUnLDC7j9o/WRlYtvAGvPUgEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3ADcKo86hZfKt1L995gAAAAASUVORK5CYII=';
const agentKey = (id: string) =>
  id === 'claude-code' ? 'claude' : id === 'codex' ? 'codex' : 'openai';
const verificationSchema = z
  .object({
    agent: providerIdSchema,
    authentication: z.enum(['authenticated', 'unauthenticated', 'failed']),
    account: z.string().nullable(),
    version: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict();
let failure: string | null = null;
let agents: Snapshot['agents'] = [];
const logs: LogEntry[] = [];
let quitting = false;
let databaseFailed = false;
let lastHistory: Snapshot['history'] = {
  conversations: [],
  messages: [],
  activities: [],
  mode: 'ask',
};
function log(event: string, detail: string, requestId?: string) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: event.includes('error') ? 'error' : 'info',
    event,
    detail: redact(detail),
    ...(requestId ? { requestId } : {}),
  };
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  if (db) void db.execute({ type: 'log', log: entry }).catch(() => undefined);
}
function activity(call: Activity) {
  log(call.tool, `${call.status}: ${call.detail}`, call.id);
}
async function startRuntime() {
  runtime = new RuntimeService(
    __dirname,
    db,
    (error) => {
      failure = error;
      state = null;
      streaming = null;
      log('runtime.error', error);
      void db
        .execute({ type: 'interrupt' })
        .catch((error) => log('database.error', errorText(error)));
    },
    activity,
    (chunk) => {
      streaming = chunk;
    },
    log,
  );
  await runtime.start();
  const history = historySchema.parse(await db.execute({ type: 'history' }));
  await runtime.control({ type: 'mode', mode: history.mode });
  state = await runtime.state();
  log('mcp.ready', 'Local stdio server initialized.');
}
async function snapshot(): Promise<Snapshot> {
  try {
    lastHistory = historySchema.parse(await db.execute({ type: 'history' }));
  } catch (error) {
    databaseFailed = true;
    failure = `Local storage unavailable: ${errorText(error)}`;
    state = null;
  }
  return snapshotSchema.parse({
    runtime: state,
    midi,
    library,
    indexing,
    streaming,
    artifacts,
    samples,
    agents,
    history: lastHistory,
    logs,
    error: failure,
  });
}
/**
 * Indexing is the first operation here that can take minutes, so progress is
 * published as it goes and a failing root never stops the others.
 */
async function indexRoots(roots: string[]) {
  for (const root of roots) {
    indexing = `Indexing ${path.basename(root)}…`;
    try {
      // Incremental: what is already indexed for this root, so unchanged files
      // are skipped rather than re-read.
      const existing = new Map(
        z
          .array(indexedSampleSchema)
          .parse(await db.execute({ type: 'samplesForRoot', root }))
          .map((sample) => [sample.path, { size: sample.size, modifiedMs: sample.modifiedMs }]),
      );
      const report = await indexRoot(root, {
        existing,
        onProgress: (found) => {
          indexing = `Indexing ${path.basename(root)}… ${found} samples`;
        },
      });
      await db.execute({ type: 'indexed', report });
      log(
        'samples.indexed',
        `${report.root}: +${report.added} ~${report.updated} -${report.removed.length}`,
      );
    } catch (error) {
      log('samples.index_failed', errorText(error));
      await db.execute({
        type: 'indexed',
        report: {
          root,
          samples: [],
          added: 0,
          updated: 0,
          removed: [],
          skipped: 0,
          truncated: false,
          errors: [errorText(error)],
          indexedAt: new Date().toISOString(),
        },
      });
    }
  }
  indexing = null;
  library = sampleLibrarySchema.parse(await db.execute({ type: 'library' }));
}
function startArtifactDrag(sender: Electron.WebContents, input: unknown) {
  const artifact = artifacts.find((a) => a.id === ipcInputs.dragArtifact.parse(input).id);
  if (!artifact) return;
  try {
    sender.startDrag({ file: artifact.path, icon: nativeImage.createFromDataURL(DRAG_ICON) });
  } catch (error) {
    // A refused drag is a platform limitation, not a failed operation: reveal
    // in the file manager still works.
    log('artifact.drag_failed', errorText(error));
  }
}
async function invoke(method: IpcMethod, input: unknown): Promise<Snapshot> {
  const value = ipcInputs[method].parse(input);
  await ready;
  try {
    if (failure && !['snapshot', 'discover', 'restart'].includes(method)) throw new Error(failure);
    if (method === 'discover') {
      agents = await discoverAgents();
      // Backend probing loads an optional native module, so it happens on an
      // explicit refresh rather than on every snapshot poll.
      if (runtime && !failure)
        midi = midiStatusSchema.parse(await runtime.control({ type: 'midi' }));
    }
    if (method === 'restart') {
      await runtime?.close();
      if (databaseFailed) {
        await db.close();
        db = createDatabase();
        await db.ready;
        databaseFailed = false;
      }
      await db.execute({ type: 'interrupt' });
      failure = null;
      await startRuntime();
    }
    if (method === 'verify') {
      const input = ipcInputs.verify.parse(value);
      const result = verificationSchema.parse(await runtime!.control({ type: 'verify', ...input }));
      agents = agents.map((agent) =>
        agentKey(agent.id) === result.agent
          ? {
              ...agent,
              authentication: result.authentication,
              account: result.account,
              version: result.version,
              errors: result.error ? [result.error] : [],
            }
          : agent,
      );
    }
    if (method === 'addSampleFolder') {
      const chosen = await dialog.showOpenDialog(window!, {
        title: 'Choose a sample folder',
        properties: ['openDirectory'],
      });
      // Indexing records canonical paths, so a root is stored canonically too;
      // otherwise the same folder appears twice under two spellings.
      const folder = chosen.canceled ? null : await realpath(chosen.filePaths[0]);
      if (folder) {
        await db.execute({ type: 'addRoot', path: folder });
        await indexRoots([folder]);
      }
    }
    if (method === 'removeSampleFolder') {
      await db.execute({
        type: 'removeRoot',
        path: ipcInputs.removeSampleFolder.parse(value).path,
      });
      library = sampleLibrarySchema.parse(await db.execute({ type: 'library' }));
      samples = [];
    }
    if (method === 'reindexSamples') await indexRoots(library.roots.map((root) => root.path));
    if (method === 'searchSamples') {
      const input = ipcInputs.searchSamples.parse(value);
      samples = z.array(indexedSampleSchema).parse(
        await db.execute({
          type: 'searchSamples',
          query: input.query,
          limit: input.limit ?? 25,
        }),
      );
    }
    if (method === 'revealArtifact') {
      const artifact = artifacts.find((a) => a.id === ipcInputs.revealArtifact.parse(value).id);
      // Reveal rather than open: a MIDI file opened by the system launches
      // whatever is registered for it, which is not what "show me" means.
      if (artifact) shell.showItemInFolder(artifact.path);
    }
    if (method === 'removeArtifact') {
      await db.execute({ type: 'removeArtifact', ...ipcInputs.removeArtifact.parse(value) });
      artifacts = z.array(artifactSchema).parse(await db.execute({ type: 'artifacts' }));
    }
    if (method === 'setProvider')
      await runtime!.control({ type: 'provider', ...ipcInputs.setProvider.parse(value) });
    if (method === 'connect') {
      await runtime!.control({ type: 'connect', ...ipcInputs.connect.parse(value) });
      failure = null;
    }
    if (method === 'disconnect') await runtime!.control({ type: 'disconnect' });
    if (method === 'setMode')
      await runtime!.control({ type: 'mode', mode: ipcInputs.setMode.parse(value).mode });
    if (method === 'createConversation')
      await db.execute({
        type: 'conversation',
        conversation: {
          id: randomUUID(),
          title: 'New session',
          timestamp: new Date().toISOString(),
        },
      });
    if (method === 'sendMessage') {
      const message = sendSchema.parse(value);
      const history = historySchema.parse(await db.execute({ type: 'history' }));
      const conversation = history.conversations.find((c) => c.id === message.conversationId);
      if (!conversation) throw new Error('Conversation not found.');
      if (!state?.connected) throw new Error('Connect the mock session before sending a message.');
      if (!history.messages.some((m) => m.conversationId === conversation.id))
        await db.execute({
          type: 'conversation',
          conversation: { ...conversation, title: message.content.slice(0, 60) },
        });
      await db.execute({
        type: 'message',
        message: {
          id: randomUUID(),
          ...message,
          role: 'user',
          provider: 'You',
          timestamp: new Date().toISOString(),
        },
      });
      await runtime!.control({ type: 'chat', message });
    }
    if (method === 'callTool') {
      const call = callSchema.parse(value);
      await runtime!.call(call.tool, call.arguments, call.conversationId);
    }
    if (method === 'decide')
      await runtime!.control({ type: 'decision', decision: decisionSchema.parse(value) });
    if (method === 'undo') await runtime!.control({ type: 'undo', ...ipcInputs.undo.parse(value) });
    if (method === 'cancel') await runtime!.control({ type: 'cancel' });
    if (runtime && !failure) state = await runtime.state();
    // Generation happens inside an approved tool call, so the list is refreshed
    // from the store rather than from whatever the renderer last asked for.
    if (db && !databaseFailed)
      artifacts = z.array(artifactSchema).parse(await db.execute({ type: 'artifacts' }));
  } catch (error) {
    log('operation.error', errorText(error));
    if (method !== 'snapshot') throw error;
  }
  return snapshot();
}
for (const method of Object.keys(ipcInputs) as IpcMethod[])
  ipcMain.handle(`orchestra:${method}`, (event, input: unknown) => {
    if (
      !window ||
      !trustedSender(
        event.sender,
        window.webContents,
        event.senderFrame,
        window.webContents.mainFrame,
        event.senderFrame?.url ?? '',
        developmentOrigin,
      )
    )
      throw new Error('Untrusted IPC sender.');
    // Dragging must start from the frame that is dragging, so this one call
    // needs the sender; everything else is answered from application state.
    if (method === 'dragArtifact') startArtifactDrag(event.sender, input);
    return invoke(method, input);
  });
async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: '#111315',
    title: 'OrchestrAI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!trustedURL(url, developmentOrigin)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    log('renderer.error', details.reason);
    // Relaunch the renderer only; pending writes are invalidated before reload.
    void runtime
      ?.control({ type: 'cancel' })
      .catch((error) => log('runtime.error', errorText(error)))
      .finally(() => window?.reload());
  });
  await window.loadURL(developmentOrigin ?? 'orchestra://app/');
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await runtime?.close();
      await db?.close();
    } finally {
      app.quit();
    }
  })();
});
function createDatabase() {
  return new DatabaseService(__dirname, app.getPath('userData'), (error) => {
    databaseFailed = true;
    failure = error;
    state = null;
    log('database.error', error);
    void runtime?.close();
  });
}
const ready = app
  .whenReady()
  .then(async () => {
    protocol.handle('orchestra', (request) =>
      assetResponse(path.join(__dirname, '../renderer/out'), request.url),
    );
    protocol.handle('orchestra-sample', (request) =>
      sampleResponse(request.url, async (file) => {
        const sample = await db.execute({ type: 'sampleByPath', path: file });
        return sample !== null;
      }),
    );
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    db = createDatabase();
    await db.ready;
    agents = await discoverAgents();
    library = sampleLibrarySchema.parse(await db.execute({ type: 'library' }));
    await startRuntime();
    try {
      midi = midiStatusSchema.parse(await runtime!.control({ type: 'midi' }));
    } catch (error) {
      // A missing MIDI backend is an expected state, not a startup failure.
      log('midi.unavailable', errorText(error));
    }
  })
  .catch((error) => {
    failure = errorText(error);
    log('startup.error', failure);
  });
void ready.then(createWindow);
