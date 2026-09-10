import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, utimes, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  deriveTags,
  indexRoot,
  readAiffHeader,
  readWavHeader,
} from '../packages/sample-indexer/src';
import { sampleResponse, sampleRequestPath } from '../apps/desktop/electron/security';

/** A minimal but real RIFF/WAVE file: 16-bit stereo at 44.1 kHz. */
function wavFile(seconds: number, sampleRate = 44100, channels = 2, bits = 16): Buffer {
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(seconds * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
function aiffFile(frames: number, sampleRate = 48000, channels = 1, bits = 24): Buffer {
  const buffer = Buffer.alloc(54);
  buffer.write('FORM', 0, 'ascii');
  buffer.writeUInt32BE(46, 4);
  buffer.write('AIFF', 8, 'ascii');
  buffer.write('COMM', 12, 'ascii');
  buffer.writeUInt32BE(18, 16);
  buffer.writeUInt16BE(channels, 20);
  buffer.writeUInt32BE(frames, 22);
  buffer.writeUInt16BE(bits, 26);
  // 80-bit IEEE extended sample rate.
  const exponent = 16383 + 31;
  buffer.writeUInt16BE(exponent, 28);
  buffer.writeBigUInt64BE(BigInt(sampleRate) * 2n ** 32n, 30);
  buffer.write('SSND', 38, 'ascii');
  buffer.writeUInt32BE(8, 42);
  return buffer;
}

describe('header facts', () => {
  it('reads sample rate, channels, bit depth, and duration from WAV', () => {
    expect(readWavHeader(wavFile(1.5))).toEqual({
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      durationMs: 1500,
    });
  });
  it('reads an AIFF COMM chunk including its extended-float sample rate', () => {
    expect(readAiffHeader(aiffFile(24000))).toEqual({
      sampleRate: 48000,
      channels: 1,
      bitDepth: 24,
      durationMs: 500,
    });
  });
  it('records unknown rather than guessing for malformed or truncated headers', () => {
    const unknown = { sampleRate: null, channels: null, bitDepth: null, durationMs: null };
    expect(readWavHeader(Buffer.alloc(10))).toEqual(unknown);
    expect(readWavHeader(Buffer.from('NOTARIFFFILE!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'))).toEqual(
      unknown,
    );
    expect(readAiffHeader(wavFile(1))).toEqual(unknown);
    expect(readWavHeader(wavFile(1).subarray(0, 30))).toEqual(unknown);
  });
});

describe('tags', () => {
  it('derives tokens from folder and file names without inventing analysis', () => {
    const tags = deriveTags('/library', '/library/Drums/808 Kicks/Deep_Kick-03.wav');
    expect(tags).toContain('drums');
    expect(tags).toContain('808');
    expect(tags).toContain('kicks');
    expect(tags).toContain('deep');
    // Two-digit take numbers are noise, not tags.
    expect(tags).not.toContain('03');
  });
});

describe('indexing a real folder', () => {
  let root: string;
  let outside: string;
  beforeAll(async () => {
    // Indexing records canonical paths, so the fixture works in those terms.
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'orchestrai-lib-')));
    outside = await realpath(await mkdtemp(path.join(tmpdir(), 'orchestrai-out-')));
    await mkdir(path.join(root, 'Drums', '808'), { recursive: true });
    await mkdir(path.join(root, '.hidden'), { recursive: true });
    await writeFile(path.join(root, 'Drums', '808', 'kick.wav'), wavFile(0.5));
    await writeFile(path.join(root, 'Drums', 'snare.aiff'), aiffFile(48000));
    await writeFile(path.join(root, 'loop.mp3'), Buffer.alloc(2048));
    await writeFile(path.join(root, 'notes.txt'), 'not audio');
    await writeFile(path.join(root, '.hidden', 'secret.wav'), wavFile(0.1));
    await writeFile(path.join(outside, 'elsewhere.wav'), wavFile(0.1));
    await symlink(path.join(outside, 'elsewhere.wav'), path.join(root, 'escape.wav'));
  });

  it('indexes audio only, skips hidden folders, and refuses a symlink escape', async () => {
    const report = await indexRoot(root);
    const names = report.samples.map((sample) => sample.name).sort();
    expect(names).toEqual(['kick.wav', 'loop.mp3', 'snare.aiff']);
    expect(report.truncated).toBe(false);
    const kick = report.samples.find((sample) => sample.name === 'kick.wav')!;
    expect(kick).toMatchObject({ sampleRate: 44100, channels: 2, durationMs: 500 });
    expect(kick.tags).toContain('808');
    // A compressed format is findable, with facts recorded as unknown.
    const loop = report.samples.find((sample) => sample.name === 'loop.mp3')!;
    expect(loop).toMatchObject({ sampleRate: null, durationMs: null, size: 2048 });
  });
  it('reports truncation instead of silently indexing part of a library', async () => {
    const report = await indexRoot(root, { maxFiles: 2 });
    expect(report.truncated).toBe(true);
    expect(report.samples).toHaveLength(2);
  });
  it('respects the depth bound', async () => {
    const report = await indexRoot(root, { maxDepth: 0 });
    expect(report.samples.map((sample) => sample.name)).toEqual(['loop.mp3']);
  });
  it('skips unchanged files and reports what changed on re-index', async () => {
    const first = await indexRoot(root);
    const existing = new Map(
      first.samples.map((sample) => [
        sample.path,
        { size: sample.size, modifiedMs: sample.modifiedMs },
      ]),
    );
    const added = path.join(root, 'Drums', 'hat.wav');
    await writeFile(added, wavFile(0.2));
    await rm(path.join(root, 'loop.mp3'));
    const second = await indexRoot(root, { existing });
    expect(second.added).toBe(1);
    expect(second.skipped).toBe(2);
    expect(second.removed).toEqual([path.join(root, 'loop.mp3')]);
    // A rewritten file is an update, not a duplicate.
    await writeFile(path.join(root, 'Drums', '808', 'kick.wav'), wavFile(0.9));
    await utimes(
      path.join(root, 'Drums', '808', 'kick.wav'),
      new Date(),
      new Date(Date.now() + 5000),
    );
    const third = await indexRoot(root, {
      existing: new Map(
        second.samples
          .concat(first.samples)
          .map((s) => [s.path, { size: s.size, modifiedMs: s.modifiedMs }]),
      ),
    });
    expect(third.updated).toBeGreaterThanOrEqual(1);
    await rm(added);
  });
  it('reports an unreadable directory and still indexes the rest', async () => {
    const blocked = path.join(root, 'Locked');
    await mkdir(blocked, { recursive: true });
    await writeFile(path.join(blocked, 'inside.wav'), wavFile(0.1));
    await chmod(blocked, 0o000);
    try {
      const report = await indexRoot(root);
      expect(report.errors.some((error) => error.includes('Locked'))).toBe(true);
      expect(report.samples.some((sample) => sample.name === 'kick.wav')).toBe(true);
    } finally {
      await chmod(blocked, 0o755);
      await rm(blocked, { recursive: true, force: true });
    }
  });
});

describe('sample preview protocol', () => {
  it('serves an indexed file with its media type', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orchestrai-preview-'));
    const file = path.join(root, 'kick.wav');
    await writeFile(file, wavFile(0.2));
    // The index stores canonical paths, which is what indexing produces.
    const indexed = await realpath(file);
    const response = await sampleResponse(
      `orchestra-sample://local${encodeURI(file)}`,
      async (candidate) => candidate === indexed,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/wav');
  });
  it('refuses a file that is not indexed, whether or not it exists', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orchestrai-preview-'));
    const file = path.join(root, 'private.wav');
    await writeFile(file, wavFile(0.2));
    const response = await sampleResponse(
      `orchestra-sample://local${encodeURI(file)}`,
      async () => false,
    );
    expect(response.status).toBe(403);
    const missing = await sampleResponse(
      'orchestra-sample://local/nope/missing.wav',
      async () => true,
    );
    expect(missing.status).toBe(404);
  });
  it('refuses a symlink that borrows an indexed name to reach elsewhere', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'orchestrai-preview-')));
    const target = path.join(root, 'outside.wav');
    await writeFile(target, wavFile(0.2));
    const link = path.join(root, 'indexed.wav');
    await symlink(target, link);
    // The link's own name is indexed; what it points at is not.
    const response = await sampleResponse(
      `orchestra-sample://local${encodeURI(link)}`,
      async (candidate) => candidate === link,
    );
    expect(response.status).toBe(403);
  });
  it('refuses a format it cannot serve and rejects a non-absolute path', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'orchestrai-preview-')));
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'text');
    const response = await sampleResponse(
      `orchestra-sample://local${encodeURI(file)}`,
      async () => true,
    );
    expect(response.status).toBe(415);
    expect(sampleRequestPath('orchestra-sample://local')).toBe(null);
  });
});
