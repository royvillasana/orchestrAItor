import { readdir, stat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { errorText, type IndexedSample, type IndexReport } from '@orchestrai/shared-types';

export const MAX_DEPTH = 12;
export const MAX_FILES_PER_ROOT = 50000;
export const AUDIO_EXTENSIONS = [
  '.wav',
  '.aif',
  '.aiff',
  '.flac',
  '.mp3',
  '.ogg',
  '.m4a',
  '.aac',
  '.wv',
] as const;
const HEADER_BYTES = 4096;

export const sampleId = (file: string) =>
  createHash('sha1').update(file).digest('hex').slice(0, 24);

/**
 * Facts read straight from a file header. Decoding audio to measure it would
 * add a codec dependency and take orders of magnitude longer for nothing a
 * producer searching for a kick needs, so formats whose headers are not read
 * here record unknown rather than an estimate.
 */
export interface FormatFacts {
  sampleRate: number | null;
  channels: number | null;
  bitDepth: number | null;
  durationMs: number | null;
}
const unknownFacts: FormatFacts = {
  sampleRate: null,
  channels: null,
  bitDepth: null,
  durationMs: null,
};
export function readWavHeader(buffer: Buffer): FormatFacts {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return unknownFacts;
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return unknownFacts;
  let offset = 12;
  const facts = { ...unknownFacts };
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      facts.channels = buffer.readUInt16LE(body + 2);
      facts.sampleRate = buffer.readUInt32LE(body + 4);
      byteRate = buffer.readUInt32LE(body + 8);
      facts.bitDepth = buffer.readUInt16LE(body + 14);
    }
    if (id === 'data') {
      if (byteRate > 0) facts.durationMs = Math.round((size / byteRate) * 1000);
      break;
    }
    if (size <= 0) break;
    offset = body + size + (size % 2);
  }
  return facts.sampleRate ? facts : unknownFacts;
}
export function readAiffHeader(buffer: Buffer): FormatFacts {
  if (buffer.length < 32 || buffer.toString('ascii', 0, 4) !== 'FORM') return unknownFacts;
  const form = buffer.toString('ascii', 8, 12);
  if (form !== 'AIFF' && form !== 'AIFC') return unknownFacts;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32BE(offset + 4);
    const body = offset + 8;
    if (id === 'COMM' && body + 18 <= buffer.length) {
      const channels = buffer.readUInt16BE(body);
      const frames = buffer.readUInt32BE(body + 2);
      const bitDepth = buffer.readUInt16BE(body + 6);
      // Sample rate is an 80-bit IEEE extended float.
      const exponent = buffer.readUInt16BE(body + 8);
      const mantissa = Number(buffer.readBigUInt64BE(body + 10));
      const sampleRate = Math.round(mantissa * Math.pow(2, exponent - 16383 - 63));
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return unknownFacts;
      return {
        channels,
        bitDepth,
        sampleRate,
        durationMs: Math.round((frames / sampleRate) * 1000),
      };
    }
    if (size <= 0) break;
    offset = body + size + (size % 2);
  }
  return unknownFacts;
}
export async function readFormatFacts(file: string): Promise<FormatFacts> {
  const extension = path.extname(file).toLowerCase();
  if (!['.wav', '.aif', '.aiff'].includes(extension)) return unknownFacts;
  let handle;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    const header = buffer.subarray(0, bytesRead);
    return extension === '.wav' ? readWavHeader(header) : readAiffHeader(header);
  } catch {
    // A file whose header cannot be read is still a sample worth finding.
    return unknownFacts;
  } finally {
    await handle?.close();
  }
}
/** Tags come from path and file name tokens; they are derived, not analysed. */
export function deriveTags(root: string, file: string): string[] {
  const relative = path.relative(root, file);
  const tokens = relative
    .replace(path.extname(relative), '')
    .split(/[/\\\s._\-()[\]]+/)
    .map((token) => token.toLowerCase().trim())
    .filter((token) => token.length > 1 && token.length <= 24 && !/^\d{1,2}$/.test(token));
  return [...new Set(tokens)].slice(0, 24);
}

export interface IndexOptions {
  maxDepth?: number;
  maxFiles?: number;
  existing?: Map<string, { size: number; modifiedMs: number }>;
  onProgress?: (found: number) => void;
  signal?: { cancelled: boolean };
}
export async function indexRoot(root: string, options: IndexOptions = {}): Promise<IndexReport> {
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxFiles = options.maxFiles ?? MAX_FILES_PER_ROOT;
  const existing = options.existing ?? new Map();
  const resolvedRoot = await realpath(root);
  const samples: IndexedSample[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  let skipped = 0;
  let updated = 0;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || truncated || options.signal?.cancelled) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`${directory}: ${errorText(error)}`);
      return;
    }
    for (const entry of entries) {
      if (truncated || options.signal?.cancelled) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      let resolved: string;
      try {
        resolved = await realpath(full);
      } catch (error) {
        errors.push(`${full}: ${errorText(error)}`);
        continue;
      }
      // A symlink may not carry indexing outside the folder the producer chose.
      if (resolved !== path.join(resolvedRoot, path.relative(resolvedRoot, resolved))) continue;
      if (path.relative(resolvedRoot, resolved).startsWith('..')) continue;
      let info;
      try {
        info = await stat(resolved);
      } catch (error) {
        errors.push(`${full}: ${errorText(error)}`);
        continue;
      }
      if (info.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!info.isFile()) continue;
      if (!AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase() as never)) continue;
      if (samples.length >= maxFiles) {
        truncated = true;
        return;
      }
      seen.add(full);
      const previous = existing.get(full);
      const modifiedMs = Math.floor(info.mtimeMs);
      if (previous && previous.size === info.size && previous.modifiedMs === modifiedMs) {
        skipped++;
        continue;
      }
      if (previous) updated++;
      samples.push({
        id: sampleId(full),
        root: resolvedRoot,
        path: full,
        name: path.basename(full),
        extension: path.extname(full).toLowerCase().slice(1),
        size: info.size,
        modifiedMs,
        tags: deriveTags(resolvedRoot, full),
        ...(await readFormatFacts(resolved)),
      });
      options.onProgress?.(samples.length + skipped);
    }
  };
  await walk(resolvedRoot, 0);
  const removed = [...existing.keys()].filter((file) => !seen.has(file));
  return {
    root: resolvedRoot,
    samples,
    added: samples.length - updated,
    updated,
    removed,
    skipped,
    truncated,
    errors: errors.slice(0, 50),
    indexedAt: new Date().toISOString(),
  };
}
