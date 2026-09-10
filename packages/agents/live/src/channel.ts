import { createServer, connect, type Server, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { errorText } from '@orchestrai/shared-types';

/**
 * The one channel an external agent process gets. It carries tool listing and
 * tool calls and nothing else: no approval decisions, no adapter or provider
 * selection, no persistence control. An agent still cannot approve its own
 * write, which is the boundary the whole permission design rests on.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const agentRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('list'), token: z.string().min(1).max(200) }).strict(),
  z
    .object({
      op: z.literal('call'),
      token: z.string().min(1).max(200),
      tool: z.string().min(1).max(100),
      arguments: z.record(z.unknown()),
    })
    .strict(),
]);
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export const agentResponseSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(500) }).strict(),
]);

const sameToken = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export interface AgentChannelHandlers {
  list(): Promise<unknown>;
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}
export class AgentToolChannel {
  readonly token = randomBytes(24).toString('hex');
  // Unix socket paths are capped near 104 bytes and macOS temp directories are
  // already ~48 of them, so the name stays short rather than being truncated
  // into a path nothing else can find.
  readonly address = path.join(
    process.platform === 'win32' ? '\\\\.\\pipe' : tmpdir(),
    `oai-${randomBytes(8).toString('hex')}.sock`,
  );
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  constructor(
    private handlers: AgentChannelHandlers,
    private log: (event: string, detail: string) => void = () => {},
  ) {}
  async start() {
    if (this.server) return;
    if (process.platform !== 'win32' && Buffer.byteLength(this.address) > 100)
      throw new Error(`The agent channel path is too long: ${this.address}`);
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.address, () => {
        server.off('error', reject);
        resolve();
      });
    });
    // Owner-only, so another user on the machine cannot drive the agent surface.
    if (process.platform !== 'win32') await chmod(this.address, 0o600);
  }
  async stop() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== 'win32') await unlink(this.address).catch(() => undefined);
  }
  private accept(socket: Socket) {
    this.sockets.add(socket);
    let buffer = '';
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > MAX_MESSAGE_BYTES) {
        this.log('agent.oversized', String(buffer.length));
        socket.write(JSON.stringify({ ok: false, error: 'Message too large.' }) + '\n');
        buffer = '';
        socket.destroy();
        return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim()) void this.dispatch(socket, line);
      }
    });
  }
  private async dispatch(socket: Socket, line: string) {
    const reply = (value: unknown) => {
      if (socket.writable) socket.write(JSON.stringify(value) + '\n');
    };
    let request: AgentRequest;
    try {
      request = agentRequestSchema.parse(JSON.parse(line));
    } catch (error) {
      this.log('agent.malformed', errorText(error));
      return reply({ ok: false, error: 'Malformed request.' });
    }
    if (!sameToken(request.token, this.token)) {
      this.log('agent.rejected_token', request.op);
      return reply({ ok: false, error: 'Unauthorized.' });
    }
    try {
      const result =
        request.op === 'list'
          ? await this.handlers.list()
          : await this.handlers.call(request.tool, request.arguments);
      reply({ ok: true, result });
    } catch (error) {
      reply({ ok: false, error: errorText(error).slice(0, 500) });
    }
  }
}
/** Client half, used by the MCP proxy the agent CLI loads. */
export async function requestOverChannel(
  address: string,
  request: AgentRequest,
  timeoutMs = 30000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('The OrchestrAI tool channel did not answer.'));
    }, timeoutMs);
    const finish = (action: () => void) => {
      clearTimeout(timer);
      socket.destroy();
      action();
    };
    socket.on('error', (error) => finish(() => reject(error)));
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      try {
        const parsed = agentResponseSchema.parse(JSON.parse(buffer.slice(0, index)));
        finish(() => (parsed.ok ? resolve(parsed.result) : reject(new Error(parsed.error))));
      } catch (error) {
        finish(() => reject(new Error(errorText(error))));
      }
    });
  });
}
