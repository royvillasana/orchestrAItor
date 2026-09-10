import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  LocalStore,
  redact,
  migrate,
  migration,
  SCHEMA_VERSION,
} from '../apps/desktop/electron/store';
import {
  trustedURL,
  trustedSender,
  resolveAsset,
  contentPolicy,
  assetResponse,
} from '../apps/desktop/electron/security';
import { ipcInputs, snapshotSchema } from '../packages/shared-types/src';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
describe('security boundaries', () => {
  it('rejects same-origin foreign windows and subframes at the IPC handler boundary', () => {
    const sender = {};
    const frame = {};
    expect(trustedSender(sender, sender, frame, frame, 'orchestra://app/')).toBe(true);
    expect(trustedSender({}, sender, frame, frame, 'orchestra://app/')).toBe(false);
    expect(trustedSender(sender, sender, {}, frame, 'orchestra://app/')).toBe(false);
    expect(trustedSender(sender, sender, frame, frame, 'https://example.com/')).toBe(false);
  });
  it('serves bundled assets but rejects a symlink to a file outside the export', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orchestrai-protocol-'));
    const root = path.join(directory, 'out');
    await mkdir(root);
    await writeFile(path.join(root, 'index.html'), '<html><script>self.hydrate=1</script></html>');
    await writeFile(path.join(directory, 'secret.txt'), 'private');
    await symlink(path.join(directory, 'secret.txt'), path.join(root, 'escape.txt'));
    const response = await assetResponse(root, 'orchestra://app/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain('sha256-');
    expect((await assetResponse(root, 'orchestra://app/escape.txt')).status).toBe(403);
  });
  it('rejects bad IPC input and malformed outputs', () => {
    expect(ipcInputs.setMode.safeParse({ mode: 'agent' }).success).toBe(false);
    expect(
      ipcInputs.callTool.safeParse({ tool: 'exec', arguments: { cmd: 'id' }, conversationId: 'c' })
        .success,
    ).toBe(false);
    expect(ipcInputs.connect.safeParse({ shell: 'id' }).success).toBe(false);
    expect(snapshotSchema.safeParse({ runtime: 'connected' }).success).toBe(false);
  });
  it('checks exact trusted origins and confines protocol assets', () => {
    expect(trustedURL('orchestra://app/workspace/')).toBe(true);
    for (const url of [
      'https://app/',
      'orchestra://app.evil/',
      'orchestra://evil/',
      'orchestra://user@app/',
    ])
      expect(trustedURL(url)).toBe(false);
    expect(trustedURL('http://127.0.0.1:3210/', 'http://127.0.0.1:3210')).toBe(true);
    expect(resolveAsset('/bundle', 'orchestra://app/workspace/')).toBe(
      '/bundle/workspace/index.html',
    );
    for (const url of [
      'orchestra://app/../secret',
      'orchestra://app/%2e%2e/secret',
      'orchestra://app/%5csecret',
    ])
      expect(() => resolveAsset('/bundle', url)).toThrow();
  });
  it('hashes hydration scripts without permitting arbitrary scripts', () => {
    const policy = contentPolicy('<script>self.x=1</script><script src="/bundle.js"></script>');
    expect(policy).toContain("script-src 'self' 'sha256-");
    expect(policy.split(';')[1]).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(redact('token=abc sk-secret Bearer abc.def')).not.toContain('abc');
  });
});
describe('SQLite persistence', () => {
  it('persists local history and migration across restarts and marks pending calls interrupted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'orchestrai-db-'));
    const file = path.join(dir, 'studio.sqlite');
    let store = await LocalStore.open(file, wasm);
    store.execute({
      type: 'conversation',
      conversation: { id: 'c', title: 'Saved', timestamp: 'now' },
    });
    store.execute({
      type: 'message',
      message: {
        id: 'm',
        conversationId: 'c',
        role: 'user',
        provider: 'You',
        content: 'Hello',
        timestamp: 'now',
      },
    });
    store.execute({
      type: 'activity',
      activity: {
        id: 'a',
        conversationId: 'c',
        sessionId: 's',
        agent: 'demo',
        tool: 'transport.play',
        arguments: {},
        timestamp: 'now',
        status: 'running',
        detail: 'running',
        undoable: false,
      },
    });
    store.close();
    expect((await readFile(file)).subarray(0, 15).toString()).toBe('SQLite format 3');
    store = await LocalStore.open(file, wasm);
    store.execute({ type: 'interrupt' });
    expect(store.history().messages[0].content).toBe('Hello');
    expect(store.history().activities[0].status).toBe('unknown-outcome');
    store.close();
  });
  it('preserves corrupt files instead of resetting user data', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'orchestrai-corrupt-'));
    const file = path.join(dir, 'studio.sqlite');
    await writeFile(file, 'not a database');
    await expect(LocalStore.open(file, wasm)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('not a database');
  });
  it('rolls back failed migrations and rejects incompatible schema', async () => {
    const init: typeof import('sql.js').default = require('sql.js');
    const SQL = await init({ locateFile: () => wasm });
    const db = new SQL.Database();
    expect(() => migrate(db, 'CREATE TABLE marker(x); INVALID SQL;')).toThrow();
    expect(db.exec("SELECT name FROM sqlite_master WHERE name='marker'")).toEqual([]);
    migrate(db);
    db.run(`INSERT INTO schema_migrations VALUES(${SCHEMA_VERSION + 1})`);
    expect(() => migrate(db)).toThrow('Unsupported');
    db.close();
  });
  it('upgrades a version 1 database to 2 without losing history', async () => {
    const init: typeof import('sql.js').default = require('sql.js');
    const SQL = await init({ locateFile: () => wasm });
    const db = new SQL.Database();
    // A database created before sample libraries existed.
    migrate(db, migration, {} as never);
    expect(Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0])).toBe(1);
    db.run('INSERT INTO conversations VALUES(\'c1\', \'{"id":"c1"}\')');
    db.run('INSERT INTO messages VALUES(\'m1\', \'{"id":"m1"}\')');

    migrate(db);
    expect(Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0])).toBe(
      SCHEMA_VERSION,
    );
    expect(db.exec('SELECT id FROM conversations')[0].values).toEqual([['c1']]);
    expect(db.exec('SELECT id FROM messages')[0].values).toEqual([['m1']]);
    expect(db.exec('SELECT COUNT(*) FROM samples')[0].values).toEqual([[0]]);
    db.close();
  });
  it('leaves the database at its previous version when an upgrade fails', async () => {
    const init: typeof import('sql.js').default = require('sql.js');
    const SQL = await init({ locateFile: () => wasm });
    const db = new SQL.Database();
    migrate(db, migration, {} as never);
    expect(() =>
      migrate(db, migration, { 2: 'CREATE TABLE ok(x); INVALID SQL;' } as never),
    ).toThrow();
    expect(Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0])).toBe(1);
    expect(db.exec("SELECT name FROM sqlite_master WHERE name='ok'")).toEqual([]);
    db.close();
  });
});
