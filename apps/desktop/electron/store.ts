import initSqlJs, { type Database } from 'sql.js';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  rmSync,
  fsyncSync,
  closeSync,
  renameSync,
  appendFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  activitySchema,
  conversationSchema,
  messageSchema,
  historySchema,
  indexedSampleSchema,
  artifactSchema,
  type MidiArtifact,
  sampleLibrarySchema,
  sampleRootSchema,
  type IndexedSample,
  type SampleLibrary,
  storeCommandSchema,
  type StoreCommand,
  type LogEntry,
} from '@orchestrai/shared-types';

export function redact(text: string): string {
  return text
    .replace(/\b(sk-[\w-]+|Bearer\s+[\w.-]+)\b/gi, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
/** Must match the indexer's derivation so removals and updates address the same row. */
/** Below this an estimate is a guess, and a guess should not answer a question. */
export const MIN_MATCH_CONFIDENCE = 0.35;
export const sampleId = (file: string) =>
  createHash('sha1').update(file).digest('hex').slice(0, 24);
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
/** Sample libraries. Applied on top of schema 1 so existing history survives. */
export const migration002 = `
CREATE TABLE sample_roots(path TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE samples(id TEXT PRIMARY KEY, root TEXT NOT NULL, json TEXT NOT NULL);
CREATE INDEX samples_root ON samples(root);
INSERT INTO schema_migrations VALUES(2);
`;
/** Generated MIDI clips. Files live beside the database, under application data. */
export const migration003 = `
CREATE TABLE artifacts(id TEXT PRIMARY KEY, json TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(3);
`;
/**
 * Track volume changed meaning: it was a decibel figure the mock invented, and
 * became the normalized fader position a DAW reports. History written before
 * that change holds values the schema now refuses, which stopped the database
 * opening at all.
 *
 * A stored decibel figure cannot be converted faithfully — reproducing a fader
 * taper is the guess this project refused to make for live values, and making
 * it for history would be no better. So the unreadable part is dropped: the
 * snapshot goes, and the activity keeps its tool, status, detail, and time,
 * which is what a producer reads. Those snapshots could not have restored
 * anything anyway; their revision no longer matches the session.
 */
export const migration004 = 'INSERT INTO schema_migrations VALUES(4);';
function carriesLegacyVolume(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const tracks = record.tracks;
  if (
    Array.isArray(tracks) &&
    tracks.some(
      (track) =>
        typeof (track as { volume?: unknown }).volume === 'number' &&
        ((track as { volume: number }).volume < 0 || (track as { volume: number }).volume > 1),
    )
  )
    return true;
  return Object.values(record).some((nested) => carriesLegacyVolume(nested, depth + 1));
}
export function stripLegacySnapshots(db: Database) {
  for (const table of ['tool_calls', 'transactions']) {
    const rows = db.exec(`SELECT id, json FROM ${table}`)[0]?.values ?? [];
    for (const [id, raw] of rows) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        continue;
      }
      let changed = false;
      // Any field may carry a project snapshot — before, after, and the tool
      // result all do — so the search is by shape rather than by field name.
      for (const key of Object.keys(record)) {
        if (carriesLegacyVolume(record[key])) {
          delete record[key];
          changed = true;
        }
      }
      if (changed)
        db.run(`UPDATE ${table} SET json=? WHERE id=?`, [JSON.stringify(record), String(id)]);
    }
  }
}
export const MIGRATIONS: Record<number, string> = {
  2: migration002,
  3: migration003,
  4: migration004,
};
/** The schema this build targets: whatever the last migration it ships reaches. */
export const SCHEMA_VERSION = Math.max(1, ...Object.keys(MIGRATIONS).map(Number));
export function migrate(
  db: Database,
  sql = migration,
  upgrades: Record<number, string> = MIGRATIONS,
) {
  // Derived from the upgrades in hand rather than the constant, so a caller
  // holding fewer migrations targets the version those actually reach.
  const target = Math.max(1, ...Object.keys(upgrades).map(Number));
  const existing = db.exec("SELECT name FROM sqlite_master WHERE name='schema_migrations'");
  const apply = (statements: string) => {
    db.run('BEGIN');
    try {
      db.run(statements);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  };
  // A fresh database takes the base schema and then the same upgrade path an
  // existing one does, so a new install can never skip a migration.
  if (!existing.length) apply(sql);
  let version = Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0]?.values[0]?.[0]);
  if (version > target)
    throw new Error(
      'Unsupported database schema; preserve this file and use a compatible application version.',
    );
  // Each step commits on its own, so a failure leaves the database at the last
  // version that fully applied rather than half-upgraded.
  while (version < target) {
    const next = version + 1;
    const statements = upgrades[next];
    if (!statements)
      throw new Error(
        'Unsupported database schema; preserve this file and use a compatible application version.',
      );
    // Some migrations rewrite rows rather than adding tables.
    if (next === 4) stripLegacySnapshots(db);
    apply(statements);
    version = next;
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
    // One unreadable row must not cost a producer their whole history. A row
    // that no longer validates is dropped and reported, and the rest opens.
    const readable = <T>(
      rows: unknown[],
      schema: { safeParse(value: unknown): { success: boolean; data?: T } },
    ) => {
      const kept: T[] = [];
      for (const row of rows) {
        const parsed = schema.safeParse(row);
        if (parsed.success && parsed.data !== undefined) kept.push(parsed.data);
        else this.dropped++;
      }
      return kept;
    };
    const history = {
      conversations: readable(this.rows('conversations'), conversationSchema),
      messages: readable(this.rows('messages'), messageSchema),
      activities: readable(this.rows('tool_calls'), activitySchema),
      mode,
    };
    if (this.dropped > 0) {
      this.log({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'history.unreadable_rows',
        detail: `${this.dropped} stored row(s) could not be read and were left out of history.`,
      });
      this.dropped = 0;
    }
    return historySchema.parse(history);
  }
  private dropped = 0;
  private artifactDirectory() {
    const directory = path.join(path.dirname(this.file), 'artifacts');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }
  artifacts(): MidiArtifact[] {
    return (this.db.exec('SELECT json FROM artifacts ORDER BY rowid DESC')[0]?.values ?? []).map(
      (row) => artifactSchema.parse(JSON.parse(String(row[0]))),
    );
  }
  library(): SampleLibrary {
    const roots = (
      this.db.exec('SELECT json FROM sample_roots ORDER BY rowid')[0]?.values ?? []
    ).map((row) => sampleRootSchema.parse(JSON.parse(String(row[0]))));
    const total = Number(this.db.exec('SELECT COUNT(*) FROM samples')[0]?.values[0]?.[0] ?? 0);
    const analysed = (this.db.exec('SELECT json FROM samples')[0]?.values ?? []).filter((row) =>
      String(row[0]).includes('"analysedAt":"'),
    ).length;
    return sampleLibrarySchema.parse({ roots, total, analysed });
  }
  /**
   * Ranked by where the query matches: an exact name beats a name prefix, which
   * beats a tag, which beats anything else in the path. Shorter names win ties,
   * because "kick.wav" is a better answer than "kick_layer_processed_v3.wav".
   */
  searchSamples(
    query: string,
    limit: number,
    filters: { key?: string; scale?: 'major' | 'minor'; tempoMin?: number; tempoMax?: number } = {},
  ): IndexedSample[] {
    const needle = query.trim().toLowerCase();
    const musical = !!(filters.key || filters.tempoMin || filters.tempoMax);
    if (!needle && !musical) return [];
    const terms = needle.split(/\s+/).filter(Boolean);
    const scored: { sample: IndexedSample; score: number }[] = [];
    for (const row of this.db.exec('SELECT json FROM samples')[0]?.values ?? []) {
      const sample = indexedSampleSchema.parse(JSON.parse(String(row[0])));
      const name = sample.name.toLowerCase();
      const haystack = `${sample.path.toLowerCase()} ${sample.tags.join(' ')}`;
      if (!terms.every((term) => haystack.includes(term))) continue;
      // Musical filters exclude rather than rank: a producer asking for A minor
      // does not want D major ranked lower, they want it gone. An estimate
      // below the confidence floor is not evidence of a key, so it does not
      // match one — otherwise every weak guess answers every musical question.
      if (filters.key && (sample.keyConfidence ?? 0) < MIN_MATCH_CONFIDENCE) continue;
      if (filters.key && sample.estimatedKey !== filters.key) continue;
      if (filters.scale && sample.estimatedScale !== filters.scale) continue;
      if (
        (filters.tempoMin || filters.tempoMax) &&
        (sample.tempoConfidence ?? 0) < MIN_MATCH_CONFIDENCE
      )
        continue;
      if (filters.tempoMin && (sample.estimatedTempo ?? 0) < filters.tempoMin) continue;
      if (filters.tempoMax && (sample.estimatedTempo ?? Infinity) > filters.tempoMax) continue;
      let score = 0;
      // A confident estimate outranks a guess when the filter is musical.
      if (musical)
        score += Math.round(((sample.keyConfidence ?? 0) + (sample.tempoConfidence ?? 0)) * 30);
      if (name === needle || name.replace(/\.[^.]+$/, '') === needle) score += 100;
      if (name.startsWith(needle)) score += 40;
      if (name.includes(needle)) score += 20;
      if (terms.every((term) => sample.tags.includes(term))) score += 15;
      score += Math.max(0, 20 - Math.floor(sample.name.length / 4));
      scored.push({ sample, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.sample.name.localeCompare(b.sample.name))
      .slice(0, limit)
      .map((entry) => entry.sample);
  }
  sampleById(id: string): IndexedSample | null {
    const row = this.db.exec('SELECT json FROM samples WHERE id=?', [id])[0]?.values[0]?.[0];
    return row ? indexedSampleSchema.parse(JSON.parse(String(row))) : null;
  }
  sampleByPath(file: string): IndexedSample | null {
    for (const row of this.db.exec('SELECT json FROM samples')[0]?.values ?? []) {
      const sample = indexedSampleSchema.parse(JSON.parse(String(row[0])));
      if (sample.path === file) return sample;
    }
    return null;
  }
  execute(raw: StoreCommand): unknown {
    const command = storeCommandSchema.parse(raw);
    if (command.type === 'history') return this.history();
    if (command.type === 'library') return this.library();
    if (command.type === 'searchSamples')
      return this.searchSamples(command.query, command.limit, {
        key: command.key,
        scale: command.scale,
        tempoMin: command.tempoMin,
        tempoMax: command.tempoMax,
      });
    if (command.type === 'unanalysed')
      return (this.db.exec('SELECT json FROM samples')[0]?.values ?? [])
        .map((row) => indexedSampleSchema.parse(JSON.parse(String(row[0]))))
        .filter((sample) => !sample.analysedAt && ['wav', 'aif', 'aiff'].includes(sample.extension))
        .slice(0, command.limit);
    if (command.type === 'sampleByPath') return this.sampleByPath(command.path);
    if (command.type === 'artifacts') return this.artifacts();
    if (command.type === 'secrets')
      return Object.fromEntries(
        (
          this.db.exec("SELECT key, value FROM settings WHERE key LIKE 'secret.%'")[0]?.values ?? []
        ).map((row) => [String(row[0]).slice('secret.'.length), String(row[1])]),
      );
    if (command.type === 'samplesForRoot')
      return (
        this.db.exec('SELECT json FROM samples WHERE root=?', [command.root])[0]?.values ?? []
      ).map((row) => indexedSampleSchema.parse(JSON.parse(String(row[0]))));
    if (command.type === 'log') {
      this.log(command.log);
      return null;
    }
    const backup = this.db.export();
    let written: MidiArtifact | null = null;
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
      if (command.type === 'artifact') {
        // Generation never overwrites: the id is unique per clip, so a repeated
        // identical request produces a second artifact beside the first.
        const file = path.join(this.artifactDirectory(), `${command.artifact.id}.mid`);
        writeFileSync(file, Buffer.from(command.data, 'base64'), { mode: 0o600 });
        const artifact = artifactSchema.parse({ ...command.artifact, path: file });
        put('artifacts', artifact.id, artifact);
        written = artifact;
      }
      if (command.type === 'removeArtifact') {
        const existing = this.artifacts().find((artifact) => artifact.id === command.id);
        if (existing) {
          rmSync(existing.path, { force: true });
          this.db.run('DELETE FROM artifacts WHERE id=?', [command.id]);
        }
      }
      if (command.type === 'setSecret') {
        // Ciphertext only: the plaintext never reaches this process.
        if (command.value === null)
          this.db.run('DELETE FROM settings WHERE key=?', [`secret.${command.key}`]);
        else
          this.db.run(
            'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            [`secret.${command.key}`, command.value],
          );
      }
      if (command.type === 'analysed') {
        const existing = this.sampleById(command.id);
        // Estimates attach to the sample; a re-index that changed the file
        // rewrites the row without them, so they are recomputed.
        // samples carries its own root column, so the generic two-column put
        // would fail its NOT NULL constraint and roll the write back.
        if (existing)
          this.db.run('UPDATE samples SET json=? WHERE id=?', [
            JSON.stringify({
              ...existing,
              estimatedKey: command.estimatedKey,
              estimatedScale: command.estimatedScale,
              keyConfidence: command.keyConfidence,
              estimatedTempo: command.estimatedTempo,
              tempoConfidence: command.tempoConfidence,
              analysedAt: command.analysedAt,
            }),
            existing.id,
          ]);
      }
      if (command.type === 'addRoot')
        this.db.run(
          'INSERT INTO sample_roots(path,json) VALUES(?,?) ON CONFLICT(path) DO NOTHING',
          [
            command.path,
            JSON.stringify({
              path: command.path,
              count: 0,
              indexedAt: null,
              truncated: false,
              error: null,
            }),
          ],
        );
      if (command.type === 'removeRoot') {
        this.db.run('DELETE FROM samples WHERE root=?', [command.path]);
        this.db.run('DELETE FROM sample_roots WHERE path=?', [command.path]);
      }
      if (command.type === 'indexed') {
        const report = command.report;
        // Ids are derived from the absolute path, so a removal is exact rather
        // than a pattern match against stored JSON.
        for (const file of report.removed)
          this.db.run('DELETE FROM samples WHERE id=? AND root=?', [sampleId(file), report.root]);
        // samples carries its own root column, so it needs its own upsert.
        for (const sample of report.samples)
          this.db.run(
            'INSERT INTO samples(id,root,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root, json=excluded.json',
            [sample.id, report.root, JSON.stringify(sample)],
          );
        const count = Number(
          this.db.exec('SELECT COUNT(*) FROM samples WHERE root=?', [report.root])[0]
            ?.values[0]?.[0] ?? 0,
        );
        this.db.run(
          'INSERT INTO sample_roots(path,json) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET json=excluded.json',
          [
            report.root,
            JSON.stringify({
              path: report.root,
              count,
              indexedAt: report.indexedAt,
              truncated: report.truncated,
              error: report.errors[0] ?? null,
            }),
          ],
        );
      }
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
      return written;
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
