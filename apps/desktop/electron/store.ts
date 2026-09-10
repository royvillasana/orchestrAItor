import initSqlJs, { type Database } from 'sql.js';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  appendFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  activitySchema,
  historySchema,
  storeCommandSchema,
  type StoreCommand,
  type LogEntry,
} from '@orchestrai/shared-types';

export function redact(text: string): string {
  return text
    .replace(/\b(sk-[\w-]+|Bearer\s+[\w.-]+)\b/gi, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
export const migration = `
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE conversations(id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE messages(id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE tool_calls(id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE transactions(id TEXT PRIMARY KEY, json TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(1);
INSERT INTO settings VALUES('mode', 'ask');
`;
export function migrate(db: Database, sql = migration) {
  const existing = db.exec("SELECT name FROM sqlite_master WHERE name='schema_migrations'");
  if (existing.length) {
    const version = Number(
      db.exec('SELECT MAX(version) FROM schema_migrations')[0]?.values[0]?.[0],
    );
    if (version !== 1)
      throw new Error(
        'Unsupported database schema; preserve this file and use a compatible application version.',
      );
    return;
  }
  db.run('BEGIN');
  try {
    db.run(sql);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
export class LocalStore {
  private constructor(
    private db: Database,
    private readonly file: string,
  ) {}
  static async open(file: string, wasmPath: string) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const db = new SQL.Database(existsSync(file) ? readFileSync(file) : undefined);
    try {
      migrate(db);
      const store = new LocalStore(db, file);
      store.flush();
      return store;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  private flush() {
    const temp = `${this.file}.pending`;
    const fd = openSync(temp, 'w', 0o600);
    try {
      writeFileSync(fd, this.db.export());
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.file);
    if (process.platform !== 'win32') {
      const directory = openSync(path.dirname(this.file), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  }
  private rows(table: 'conversations' | 'messages' | 'tool_calls') {
    return (this.db.exec(`SELECT json FROM ${table} ORDER BY rowid`)[0]?.values ?? []).map(
      (row) => JSON.parse(String(row[0])) as unknown,
    );
  }
  history() {
    const mode = this.db.exec("SELECT value FROM settings WHERE key='mode'")[0]?.values[0]?.[0];
    return historySchema.parse({
      conversations: this.rows('conversations'),
      messages: this.rows('messages'),
      activities: this.rows('tool_calls'),
      mode,
    });
  }
  execute(raw: StoreCommand): unknown {
    const command = storeCommandSchema.parse(raw);
    if (command.type === 'history') return this.history();
    if (command.type === 'log') {
      this.log(command.log);
      return null;
    }
    const backup = this.db.export();
    try {
      this.db.run('BEGIN');
      const put = (table: string, id: string, value: unknown) =>
        this.db.run(
          `INSERT INTO ${table}(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
          [id, JSON.stringify(value)],
        );
      if (command.type === 'conversation')
        put('conversations', command.conversation.id, command.conversation);
      if (command.type === 'message') put('messages', command.message.id, command.message);
      if (command.type === 'activity') {
        put('tool_calls', command.activity.id, command.activity);
        put('transactions', command.activity.id, command.activity);
      }
      if (command.type === 'mode')
        this.db.run("UPDATE settings SET value=? WHERE key='mode'", [command.mode]);
      if (command.type === 'interrupt')
        for (const raw of this.rows('tool_calls')) {
          const call = activitySchema.parse(raw);
          if (['requested', 'awaiting-approval', 'running'].includes(call.status)) {
            const terminal = {
              ...call,
              status: call.status === 'running' ? 'unknown-outcome' : 'interrupted',
              undoable: false,
              detail: 'Session ended before a terminal result. This request will not be replayed.',
            };
            put('tool_calls', call.id, terminal);
            put('transactions', call.id, terminal);
          }
        }
      this.db.run('COMMIT');
      this.flush();
      return null;
    } catch (error) {
      // Restore the in-memory snapshot as well as leaving the durable file intact.
      const Constructor = this.db.constructor as new (data: Uint8Array) => Database;
      this.db.close();
      this.db = new Constructor(backup);
      throw error;
    }
  }
  log(entry: LogEntry) {
    appendFileSync(
      path.join(path.dirname(this.file), 'events.jsonl'),
      JSON.stringify({ ...entry, detail: redact(entry.detail) }) + '\n',
      { mode: 0o600 },
    );
  }
  close() {
    this.db.close();
  }
}
