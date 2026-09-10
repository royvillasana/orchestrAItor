import { describe, expect, it } from 'vitest';
import {
  DRUMS,
  TICKS_PER_BEAT,
  diatonicChord,
  generateClip,
  noteName,
  parseKey,
  parseMidiFile,
  scalePitches,
  seeded,
  variableLength,
  voice,
  writeMidiFile,
} from '../packages/music-engine/src';

const pitchNames = (pitches: number[], key = 'C') => pitches.map((p) => noteName(p, key));

describe('theory', () => {
  it('builds the major and minor scales every musician would write down', () => {
    expect(pitchNames(scalePitches(parseKey('C').root, 'major'))).toEqual([
      'C',
      'D',
      'E',
      'F',
      'G',
      'A',
      'B',
    ]);
    expect(pitchNames(scalePitches(parseKey('A').root, 'minor'))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
    ]);
    // Flat keys are named with flats, so an Eb session is not reported as D#.
    expect(pitchNames(scalePitches(parseKey('Eb').root, 'major'), 'Eb')).toEqual([
      'Eb',
      'F',
      'G',
      'Ab',
      'Bb',
      'C',
      'D',
    ]);
  });
  it('derives chord quality from the key rather than asserting it', () => {
    const root = parseKey('C').root;
    // I ii iii IV V vi vii° is the shape of a major key.
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => diatonicChord(root, 'major', d).roman)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'vii°',
    ]);
    expect(diatonicChord(root, 'major', 0).name).toBe('C');
    expect(diatonicChord(root, 'major', 5).name).toBe('Am');
    expect(diatonicChord(root, 'major', 4, { seventh: true }).name).toBe('G7');
    const minor = parseKey('A').root;
    expect([0, 3, 4].map((d) => diatonicChord(minor, 'minor', d).name)).toEqual(['Am', 'Dm', 'Em']);
  });
  it('voices chords in a playable register, ascending, and refuses impossible octaves', () => {
    const voiced = voice(diatonicChord(parseKey('C').root, 'major', 0), 4);
    expect(voiced).toEqual([60, 64, 67]);
    expect([...voiced].sort((a, b) => a - b)).toEqual(voiced);
    expect(() => voice(diatonicChord(parseKey('C').root, 'major', 0), 11)).toThrow(/MIDI range/);
  });
  it('rejects a key that is not a note name', () => {
    expect(() => parseKey('H')).toThrow(/Unknown key/);
    expect(() => parseKey('')).toThrow();
  });
  it('produces the same stream from the same seed', () => {
    const a = Array.from({ length: 5 }, seeded(7));
    const b = Array.from({ length: 5 }, seeded(7));
    const c = Array.from({ length: 5 }, seeded(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('MIDI files', () => {
  it('encodes variable-length quantities the way the spec requires', () => {
    expect(variableLength(0)).toEqual([0x00]);
    expect(variableLength(127)).toEqual([0x7f]);
    expect(variableLength(128)).toEqual([0x81, 0x00]);
    expect(variableLength(480)).toEqual([0x83, 0x60]);
    expect(variableLength(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });
  it('writes a file that parses back to what was asked for', () => {
    const notes = [
      { start: 0, duration: TICKS_PER_BEAT, pitch: 60, velocity: 90 },
      { start: TICKS_PER_BEAT, duration: TICKS_PER_BEAT, pitch: 64, velocity: 80 },
      { start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, pitch: 67, velocity: 100 },
    ];
    const parsed = parseMidiFile(
      writeMidiFile({ notes, tempo: 124, timeSignature: [4, 4], name: 'test clip' }),
    );
    expect(parsed.format).toBe(0);
    expect(parsed.ticksPerBeat).toBe(TICKS_PER_BEAT);
    expect(parsed.tempo).toBe(124);
    expect(parsed.timeSignature).toEqual([4, 4]);
    expect(parsed.name).toBe('test clip');
    expect(parsed.notes.map((n) => [n.start, n.duration, n.pitch, n.velocity])).toEqual(
      notes.map((n) => [n.start, n.duration, n.pitch, n.velocity]),
    );
  });
  it('starts with the standard chunk identifiers', () => {
    const bytes = writeMidiFile({
      notes: [{ start: 0, duration: 240, pitch: 60, velocity: 90 }],
      tempo: 120,
      timeSignature: [3, 4],
      name: 'x',
    });
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('MThd');
    expect(parseMidiFile(bytes).timeSignature).toEqual([3, 4]);
  });
  it('refuses values outside the MIDI range rather than writing a bad file', () => {
    const base = { tempo: 120, timeSignature: [4, 4] as [number, number], name: 'x' };
    expect(() =>
      writeMidiFile({ ...base, notes: [{ start: 0, duration: 10, pitch: 200, velocity: 90 }] }),
    ).toThrow(/MIDI range/);
    expect(() =>
      writeMidiFile({ ...base, notes: [{ start: 0, duration: 10, pitch: 60, velocity: 0 }] }),
    ).toThrow(/MIDI range/);
    expect(() =>
      writeMidiFile({ ...base, notes: [{ start: 0, duration: 0, pitch: 60, velocity: 90 }] }),
    ).toThrow(/positive duration/);
    expect(() => writeMidiFile({ ...base, notes: [], tempo: 0 })).toThrow(/Invalid tempo/);
  });
  it('retriggers a repeated pitch instead of cutting it short', () => {
    const parsed = parseMidiFile(
      writeMidiFile({
        notes: [
          { start: 0, duration: TICKS_PER_BEAT, pitch: 60, velocity: 90 },
          { start: TICKS_PER_BEAT, duration: TICKS_PER_BEAT, pitch: 60, velocity: 90 },
        ],
        tempo: 120,
        timeSignature: [4, 4],
        name: 'repeat',
      }),
    );
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes.every((note) => note.duration === TICKS_PER_BEAT)).toBe(true);
  });
});

describe('generation', () => {
  const base = {
    key: 'A',
    scale: 'minor' as const,
    bars: 4,
    tempo: 124,
    progression: 'sad',
    seed: 42,
  };
  it('keeps a progression diatonic to the requested key', () => {
    const clip = generateClip({ ...base, kind: 'chords' });
    const parsed = parseMidiFile(clip.bytes);
    const inKey = new Set(scalePitches(parseKey('A').root, 'minor'));
    expect(parsed.notes.every((note) => inKey.has(note.pitch % 12))).toBe(true);
    expect(parsed.tempo).toBe(124);
    expect(clip.summary).toContain('A minor');
    expect(clip.chords[0]).toMatch(/^i /);
  });
  it('spans the bars it was asked for', () => {
    const parsed = parseMidiFile(generateClip({ ...base, kind: 'chords', bars: 8 }).bytes);
    const lastEnd = Math.max(...parsed.notes.map((note) => note.start + note.duration));
    expect(lastEnd).toBeGreaterThan(7 * 4 * TICKS_PER_BEAT);
    expect(lastEnd).toBeLessThanOrEqual(8 * 4 * TICKS_PER_BEAT);
  });
  it('is reproducible from its seed and different from another', () => {
    const first = generateClip({ ...base, kind: 'bass' });
    const same = generateClip({ ...base, kind: 'bass' });
    const other = generateClip({ ...base, kind: 'bass', seed: 43 });
    expect([...first.bytes]).toEqual([...same.bytes]);
    expect([...first.bytes]).not.toEqual([...other.bytes]);
    // Different material, still in key.
    const inKey = new Set(scalePitches(parseKey('A').root, 'minor'));
    expect(parseMidiFile(other.bytes).notes.every((n) => inKey.has(n.pitch % 12))).toBe(true);
  });
  it('writes drums on the percussion channel using the general MIDI map', () => {
    const parsed = parseMidiFile(generateClip({ ...base, kind: 'drums' }).bytes);
    expect(parsed.notes.every((note) => note.channel === 9)).toBe(true);
    expect(parsed.notes.some((note) => note.pitch === DRUMS.kick)).toBe(true);
    expect(parsed.notes.some((note) => note.pitch === DRUMS.snare)).toBe(true);
    expect(parsed.notes.every((note) => Object.values(DRUMS).includes(note.pitch as never))).toBe(
      true,
    );
  });
  it('refuses a bar count outside what a clip should be', () => {
    expect(() => generateClip({ ...base, kind: 'chords', bars: 0 })).toThrow(/1 and 32/);
    expect(() => generateClip({ ...base, kind: 'chords', bars: 64 })).toThrow(/1 and 32/);
    expect(() => generateClip({ ...base, kind: 'chords', key: 'H' })).toThrow(/Unknown key/);
  });
});
