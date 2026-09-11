import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  LocalStore,
  redact,
  migrate,
  migration,
  migration002,
  migration003,
  SCHEMA_VERSION,
} from '../apps/desktop/electron/store';
import { artifactSchema, activitySchema, credentialSchema } from '../packages/shared-types/src';
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
    // Agent is a mode now; something that is not one still has to be refused.
    expect(ipcInputs.setMode.safeParse({ mode: 'agent' }).success).toBe(true);
    expect(ipcInputs.setMode.safeParse({ mode: 'autonomous' }).success).toBe(false);
    expect(ipcInputs.setMode.safeParse({ mode: 'assist', extra: 'x' }).success).toBe(false);
    // A run's budget is bounded at the boundary, not inside the orchestrator.
    expect(ipcInputs.startRun.safeParse({ budget: { maxWrites: 0, maxSeconds: 60 } }).success).toBe(
      false,
    );
    expect(
      ipcInputs.startRun.safeParse({ budget: { maxWrites: 500, maxSeconds: 60 } }).success,
    ).toBe(false);
    expect(
      ipcInputs.startRun.safeParse({ budget: { maxWrites: 5, maxSeconds: 99999 } }).success,
    ).toBe(false);
    expect(ipcInputs.startRun.safeParse({ budget: { maxWrites: 5, maxSeconds: 60 } }).success).toBe(
      true,
    );
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
  it('filters a musical search on estimates, and only confident ones', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orchestrai-musical-'));
    const store = await LocalStore.open(path.join(directory, 'orchestrai.sqlite'), wasm);
    const base = {
      root: '/library',
      extension: 'wav',
      size: 1000,
      modifiedMs: 1,
      tags: ['loop'],
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      durationMs: 4000,
    };
    store.execute({
      type: 'indexed',
      report: {
        root: '/library',
        samples: [
          { ...base, id: 'a', path: '/library/pad.wav', name: 'pad.wav' },
          { ...base, id: 'b', path: '/library/guess.wav', name: 'guess.wav' },
          { ...base, id: 'c', path: '/library/other.wav', name: 'other.wav' },
        ],
        added: 3,
        updated: 0,
        removed: [],
        skipped: 0,
        truncated: false,
        errors: [],
        indexedAt: new Date().toISOString(),
      },
    });
    const analyse = (
      id: string,
      key: string | null,
      keyConfidence: number | null,
      tempo: number | null,
      tempoConfidence: number | null,
    ) =>
      store.execute({
        type: 'analysed',
        id,
        estimatedKey: key,
        estimatedScale: key ? 'minor' : null,
        keyConfidence,
        estimatedTempo: tempo,
        tempoConfidence,
        analysedAt: new Date().toISOString(),
      });
    analyse('a', 'A', 0.88, 124, 0.7);
    // The same key, but the estimate is barely better than chance.
    analyse('b', 'A', 0.12, 124, 0.1);
    analyse('c', 'D', 0.9, 90, 0.8);

    const byKey = store.searchSamples('', 10, { key: 'A' });
    expect(byKey.map((sample) => sample.name)).toEqual(['pad.wav']);
    const byTempo = store.searchSamples('', 10, { tempoMin: 120, tempoMax: 130 });
    expect(byTempo.map((sample) => sample.name)).toEqual(['pad.wav']);
    // Estimates survive as data on the sample, and the library counts them.
    expect(byKey[0]).toMatchObject({
      estimatedKey: 'A',
      estimatedScale: 'minor',
      keyConfidence: 0.88,
    });
    expect(store.library().analysed).toBe(3);
    // Text search still works on everything, analysed or not.
    expect(store.searchSamples('guess', 10).map((sample) => sample.name)).toEqual(['guess.wav']);
    await store.close();
  });
  it('opens history written before track volume changed meaning', async () => {
    const init: typeof import('sql.js').default = require('sql.js');
    const SQL = await init({ locateFile: () => wasm });
    const db = new SQL.Database();
    migrate(db, migration, { 2: migration002, 3: migration003 });
    // An activity recorded when volume was a decibel figure: a snapshot in
    // `before`, and another nested inside the tool result.
    const legacyTracks = [
      { id: 'kick', name: 'Kick', type: 'audio', mute: false, solo: false, volume: -4.2 },
    ];
    const project = {
      name: 'After hours',
      tempo: 122,
      key: 'A minor',
      timeSignature: '4/4',
      playing: false,
      revision: 2,
      mock: true,
      tracks: legacyTracks,
    };
    const legacy = {
      id: 'call-1',
      sessionId: 's',
      conversationId: 'c',
      agent: 'demo',
      tool: 'transport.play',
      arguments: {},
      status: 'succeeded',
      timestamp: new Date().toISOString(),
      detail: 'Playing',
      undoable: true,
      before: project,
      result: { project },
    };
    db.run('INSERT INTO tool_calls VALUES(?,?)', ['call-1', JSON.stringify(legacy)]);
    db.run('INSERT INTO transactions VALUES(?,?)', ['call-1', JSON.stringify(legacy)]);
    db.run("INSERT INTO messages VALUES('m1', ?)", [
      JSON.stringify({
        id: 'm1',
        conversationId: 'c',
        role: 'user',
        content: 'hello',
        provider: 'You',
        timestamp: new Date().toISOString(),
      }),
    ]);
    // Before the migration this row makes the whole database unreadable.
    expect(activitySchema.safeParse(legacy).success).toBe(false);

    migrate(db);
    const migrated = JSON.parse(String(db.exec('SELECT json FROM tool_calls')[0].values[0][0]));
    // The snapshot goes, because a decibel figure cannot be converted
    // faithfully; what a producer reads is kept.
    expect(migrated.before).toBeUndefined();
    expect(migrated.result).toBeUndefined();
    expect(migrated).toMatchObject({
      tool: 'transport.play',
      status: 'succeeded',
      detail: 'Playing',
    });
    expect(activitySchema.safeParse(migrated).success).toBe(true);
    expect(
      JSON.parse(String(db.exec('SELECT json FROM transactions')[0].values[0][0])).before,
    ).toBeUndefined();
    db.close();
  });
  it('drops an unreadable row rather than the whole history', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orchestrai-unreadable-'));
    const file = path.join(directory, 'orchestrai.sqlite');
    const store = await LocalStore.open(file, wasm);
    store.execute({
      type: 'conversation',
      conversation: { id: 'c1', title: 'Real', timestamp: new Date().toISOString() },
    });
    await store.close();

    const init: typeof import('sql.js').default = require('sql.js');
    const SQL = await init({ locateFile: () => wasm });
    const db = new SQL.Database(readFileSync(file));
    // Something the current schema cannot read, whatever the reason.
    db.run("INSERT INTO tool_calls VALUES('broken', ?)", [JSON.stringify({ nonsense: true })]);
    writeFileSync(file, Buffer.from(db.export()));
    db.close();

    const reopened = await LocalStore.open(file, wasm);
    const history = reopened.history();
    // One bad row must not cost a producer their conversations.
    expect(history.conversations.map((conversation) => conversation.title)).toEqual(['Real']);
    expect(history.activities).toEqual([]);
    await reopened.close();
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
  it('upgrades to artifact storage and stores a clip beside the database', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orchestrai-artifacts-'));
    const store = await LocalStore.open(path.join(directory, 'orchestrai.sqlite'), wasm);
    const artifact = {
      id: 'clip-1',
      name: 'chords-A-4bar',
      kind: 'chords' as const,
      summary: '4-bar chords in A minor at 124 BPM',
      bars: 4,
      tempo: 124,
      key: 'A',
      scale: 'minor',
      progression: 'sad',
      seed: 42,
      noteCount: 12,
      createdAt: new Date().toISOString(),
    };
    const bytes = Buffer.from('MThd fake clip bytes');
    const written = artifactSchema.parse(
      store.execute({ type: 'artifact', artifact, data: bytes.toString('base64') }),
    );
    expect(written.path).toContain('artifacts');
    expect(readFileSync(written.path)).toEqual(bytes);
    expect(artifactSchema.array().parse(store.execute({ type: 'artifacts' }))).toHaveLength(1);

    // A repeated request produces a second artifact, never an overwrite.
    const second = artifactSchema.parse(
      store.execute({
        type: 'artifact',
        artifact: { ...artifact, id: 'clip-2' },
        data: bytes.toString('base64'),
      }),
    );
    expect(second.path).not.toBe(written.path);
    expect(artifactSchema.array().parse(store.execute({ type: 'artifacts' }))).toHaveLength(2);

    // Removing one deletes its file and leaves the other alone.
    store.execute({ type: 'removeArtifact', id: 'clip-1' });
    expect(existsSync(written.path)).toBe(false);
    expect(existsSync(second.path)).toBe(true);
    expect(artifactSchema.array().parse(store.execute({ type: 'artifacts' }))).toHaveLength(1);
    await store.close();
  });
  it('carries history and the sample index across the schema 2 to 3 upgrade', async () => {
    const init: typeof import('sql.js').default = require('sql.js');
    const SQL = await init({ locateFile: () => wasm });
    const db = new SQL.Database();
    migrate(db, migration, { 2: migration002 });
    expect(Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0])).toBe(2);
    db.run('INSERT INTO conversations VALUES(\'c1\', \'{"id":"c1"}\')');
    db.run("INSERT INTO samples VALUES('s1', '/root', '{\"id\":\"s1\"}')");
    migrate(db);
    // Whatever the build currently targets, not a number frozen in the test.
    expect(Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0])).toBe(
      SCHEMA_VERSION,
    );
    expect(db.exec('SELECT id FROM conversations')[0].values).toEqual([['c1']]);
    expect(db.exec('SELECT id FROM samples')[0].values).toEqual([['s1']]);
    expect(db.exec('SELECT COUNT(*) FROM artifacts')[0].values).toEqual([[0]]);
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

  it('stores a credential as ciphertext, hands back only a hint, and forgets it on request', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orchestrai-secret-'));
    const file = path.join(directory, 'orchestrai.sqlite');
    const store = await LocalStore.open(file, wasm);
    // Stands in for safeStorage, which needs a real Electron main process: what
    // matters here is that the store never sees the plaintext.
    const encrypt = (value: string) => Buffer.from(`enc:${value}`).toString('base64');
    await store.execute({ type: 'setSecret', key: 'openai', value: encrypt('sk-secret-key-1234') });
    expect(await store.execute({ type: 'secrets' })).toEqual({
      openai: encrypt('sk-secret-key-1234'),
    });
    // The plaintext must not be recoverable by reading the database file.
    store.close();
    const reopened = await LocalStore.open(file, wasm);
    expect(readFileSync(file).includes('sk-secret-key-1234')).toBe(false);
    // Replacing a key overwrites rather than accumulating.
    await reopened.execute({
      type: 'setSecret',
      key: 'openai',
      value: encrypt('sk-second-key-5678'),
    });
    const secrets = await reopened.execute({ type: 'secrets' });
    expect(Object.keys(secrets as object)).toEqual(['openai']);
    expect(
      Buffer.from(String((secrets as Record<string, string>).openai), 'base64').toString(),
    ).toBe('enc:sk-second-key-5678');
    await reopened.execute({ type: 'setSecret', key: 'openai', value: null });
    expect(await reopened.execute({ type: 'secrets' })).toEqual({});
  });

  it('describes a credential to the renderer without carrying the key', () => {
    expect(
      credentialSchema.parse({ provider: 'openai', stored: true, hint: '1234', storage: 'os' }),
    ).toEqual({
      provider: 'openai',
      stored: true,
      hint: '1234',
      storage: 'os',
    });
    // A hint long enough to be a usable key is not a hint.
    expect(() =>
      credentialSchema.parse({
        provider: 'openai',
        stored: true,
        hint: 'sk-secret-key-1234',
        storage: 'os',
      }),
    ).toThrow();
    // No field exists to smuggle one through.
    expect(() =>
      credentialSchema.parse({
        provider: 'openai',
        stored: true,
        hint: '1234',
        storage: 'os',
        key: 'sk-x',
      }),
    ).toThrow();
    // Only providers that take a key can have one.
    expect(() =>
      credentialSchema.parse({ provider: 'claude', stored: true, hint: null, storage: 'os' }),
    ).toThrow();
  });
});
