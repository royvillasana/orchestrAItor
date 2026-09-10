import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { discoverAgents } from '@orchestrai/cli';
import {
  historySchema,
  snapshotSchema,
  midiStatusSchema,
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
} from '@orchestrai/shared-types';
import { DatabaseService, RuntimeService } from './services';
import { assetResponse, trustedURL, trustedSender } from './security';
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
]);
const developmentOrigin =
  !app.isPackaged && process.env.ORCHESTRA_DEV === '1' ? 'http://127.0.0.1:3210' : undefined;
let window: BrowserWindow | null = null;
let db: DatabaseService;
let runtime: RuntimeService | null = null;
let state: RuntimeState | null = null;
let midi: MidiStatus | null = null;
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
      log('runtime.error', error);
      void db
        .execute({ type: 'interrupt' })
        .catch((error) => log('database.error', errorText(error)));
    },
    activity,
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
    agents,
    history: lastHistory,
    logs,
    error: failure,
  });
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
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    db = createDatabase();
    await db.ready;
    agents = await discoverAgents();
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
