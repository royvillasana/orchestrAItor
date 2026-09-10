import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import {
  wireSchema,
  runtimeStateSchema,
  errorText,
  type StoreCommand,
  type Control,
  type RuntimeState,
  type Activity,
  type StreamChunk,
} from '@orchestrai/shared-types';

export class DatabaseService {
  private worker: Worker;
  private closed = false;
  private requests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly ready: Promise<void>;
  constructor(directory: string, dataDirectory: string, onFailure: (error: string) => void) {
    this.worker = new Worker(path.join(directory, 'database.cjs'), {
      workerData: {
        file: path.join(dataDirectory, 'orchestrai.sqlite'),
        wasmPath: path.join(directory, 'sql-wasm.wasm'),
      },
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Database startup timed out.')), 15000);
      this.worker.on('message', (raw) => {
        if (raw?.ready === true) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const parsed = wireSchema.safeParse(raw);
        if (!parsed.success || parsed.data.kind !== 'reply') return;
        const reply = parsed.data;
        const request = this.requests.get(reply.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.requests.delete(reply.id);
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.value);
      });
      this.worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
        onFailure(error.message);
        this.fail(error);
      });
      this.worker.on('exit', (code) => {
        clearTimeout(timer);
        if (!this.closed) onFailure(`Database worker exited (${code}).`);
        reject(new Error('Database worker closed before startup completed.'));
        this.closed = true;
        this.fail(new Error('Database worker closed.'));
      });
    });
  }
  private fail(error: Error) {
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
  }
  async execute(command: StoreCommand): Promise<unknown> {
    await this.ready;
    if (this.closed) throw new Error('Database worker is closed.');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('Database request timed out.'));
      }, 10000);
      this.requests.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, command });
    });
  }
  async close() {
    this.closed = true;
    this.fail(new Error('Application closing.'));
    await this.worker.terminate();
  }
}
class ChildTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = new ReadBuffer();
  constructor(readonly child: ChildProcess) {}
  async start() {
    this.child.stdout!.on('data', (chunk: Buffer) => {
      try {
        this.buffer.append(chunk);
        let message;
        while ((message = this.buffer.readMessage())) this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(new Error(errorText(error)));
      }
    });
    this.child.on('error', (error) => this.onerror?.(error));
    this.child.on('exit', () => this.onclose?.());
  }
  async send(message: JSONRPCMessage) {
    await new Promise<void>((resolve, reject) =>
      this.child.stdin!.write(serializeMessage(message), (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const child = this.child;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}
/**
 * A deliberate allowlist rather than the whole environment. The runtime needs
 * PATH to discover agent CLIs, and a CLI needs HOME and USER to find its own
 * login — macOS keeps those credentials in the Keychain, whose lookup fails
 * without USER. Everything else stays behind: the environment of a desktop
 * session can hold unrelated secrets, and a live agent process would inherit
 * them.
 */
export const FORWARDED_ENVIRONMENT = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'SystemRoot',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'PATHEXT',
] as const;
export function runtimeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
  for (const key of FORWARDED_ENVIRONMENT) if (source[key] !== undefined) env[key] = source[key];
  return env;
}
export class RuntimeService {
  private child: ChildProcess | null = null;
  private client: Client | null = null;
  private requests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closing = false;
  constructor(
    private directory: string,
    private db: DatabaseService,
    private onFailure: (error: string) => void,
    private onActivity: (activity: Activity) => void,
    private onStream: (chunk: StreamChunk | null) => void,
    private log: (event: string, detail: string) => void,
  ) {}
  async start() {
    this.closing = false;
    const child = fork(path.join(this.directory, 'runtime.cjs'), [], {
      execPath: process.execPath,
      env: runtimeEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    child.stderr!.on('data', (chunk) => this.log('runtime.stderr', String(chunk).slice(0, 2000)));
    child.on('message', (raw) => {
      const parsed = wireSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.kind === 'reply') {
        const request = this.requests.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.requests.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.value);
      }
      if (message.kind === 'stream') this.onStream(message.chunk.done ? null : message.chunk);
      if (message.kind === 'store')
        void this.db.execute(message.command).then(
          (value) => {
            if (message.command.type === 'activity') this.onActivity(message.command.activity);
            if (child.connected) child.send({ kind: 'reply', id: message.id, value });
          },
          (error) => {
            if (child.connected)
              child.send({ kind: 'reply', id: message.id, error: errorText(error) });
          },
        );
    });
    child.on('exit', () => {
      for (const request of this.requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Runtime disconnected.'));
      }
      this.requests.clear();
      if (!this.closing)
        this.onFailure('Music runtime disconnected. Restart to begin a fresh mock session.');
    });
    this.client = new Client({ name: 'orchestrai-desktop', version: '0.1.0' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.client.connect(new ChildTransport(child)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MCP startup timed out.')), 15000);
        }),
      ]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async control(command: Control): Promise<unknown> {
    if (!this.child?.connected) throw new Error('Runtime unavailable. Restart the session.');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('Runtime request timed out.'));
      }, 20000);
      this.requests.set(id, { resolve, reject, timer });
      this.child!.send({ kind: 'control', id, command });
    });
  }
  async state(): Promise<RuntimeState> {
    return runtimeStateSchema.parse(await this.control({ type: 'state' }));
  }
  async call(tool: string, args: Record<string, unknown>, conversationId: string) {
    if (!this.client) throw new Error('MCP unavailable.');
    return this.client.callTool({ name: tool, arguments: args, _meta: { conversationId } });
  }
  async close() {
    this.closing = true;
    await this.client?.close();
    this.client = null;
    this.child = null;
  }
}
