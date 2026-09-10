/**
 * Chords are derived from scale degrees rather than looked up in a table, so
 * the result is correct in whatever key the session reports and can be
 * explained back to the producer in its own terms.
 */
export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;
export const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;
export const MIDI_MIN = 0;
export const MIDI_MAX = 127;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
} as const;
export type ScaleName = keyof typeof SCALES;
export const scaleNames = Object.keys(SCALES) as ScaleName[];

/** Keys written with flats, so an Eb minor session is not reported as D# minor. */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'D', 'G', 'C']);
export function noteName(pitchClass: number, key = 'C'): string {
  const index = ((pitchClass % 12) + 12) % 12;
  return FLAT_KEYS.has(key) ? FLAT_NAMES[index] : NOTE_NAMES[index];
}
export function parseKey(key: string): { root: number; name: string } {
  const match = /^([A-Ga-g])([#b]?)$/.exec(key.trim());
  if (!match) throw new Error(`Unknown key "${key}". Use a note name such as A, F#, or Bb.`);
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase()]!;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return { root: (base + accidental + 12) % 12, name: match[1].toUpperCase() + match[2] };
}
/** Scale degrees as pitch classes, so degree 0 is the tonic. */
export function scalePitches(root: number, scale: ScaleName): number[] {
  return SCALES[scale].map((step) => (root + step) % 12);
}
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
export interface Chord {
  degree: number;
  roman: string;
  quality: 'major' | 'minor' | 'diminished' | 'augmented';
  pitches: number[];
  name: string;
}
const QUALITY_BY_THIRD_FIFTH: Record<string, Chord['quality']> = {
  '4,7': 'major',
  '3,7': 'minor',
  '3,6': 'diminished',
  '4,8': 'augmented',
};
/**
 * Builds the chord on a scale degree by stacking thirds within the scale, which
 * is what makes the quality fall out of the key rather than being asserted.
 */
export function diatonicChord(
  root: number,
  scale: ScaleName,
  degree: number,
  options: { seventh?: boolean } = {},
): Chord {
  const steps = SCALES[scale];
  const index = ((degree % steps.length) + steps.length) % steps.length;
  const at = (offset: number) =>
    steps[(index + offset) % steps.length] + (index + offset >= steps.length ? 12 : 0);
  const intervals = [
    0,
    at(2) - at(0),
    at(4) - at(0),
    ...(options.seventh ? [at(6) - at(0)] : []),
  ].map((interval) => ((interval % 12) + 12) % 12);
  const chordRoot = (root + steps[index]) % 12;
  const quality = QUALITY_BY_THIRD_FIFTH[`${intervals[1]},${intervals[2]}`] ?? 'major';
  const roman =
    quality === 'major' || quality === 'augmented'
      ? ROMAN[index]
      : ROMAN[index].toLowerCase() + (quality === 'diminished' ? '°' : '');
  const suffix =
    quality === 'minor'
      ? 'm'
      : quality === 'diminished'
        ? 'dim'
        : quality === 'augmented'
          ? 'aug'
          : '';
  return {
    degree: index,
    roman: roman + (options.seventh ? '7' : ''),
    quality,
    pitches: intervals.map((interval) => (chordRoot + interval) % 12),
    name: `${noteName(chordRoot, noteName(root))}${suffix}${options.seventh ? '7' : ''}`,
  };
}
/** Places chord tones in a register a keyboard player would actually use. */
export function voice(chord: Chord, octave: number): number[] {
  const base = (octave + 1) * 12;
  const voiced: number[] = [];
  let previous = -1;
  for (const pitchClass of chord.pitches) {
    let pitch = base + pitchClass;
    while (pitch <= previous) pitch += 12;
    if (pitch > MIDI_MAX || pitch < MIDI_MIN)
      throw new Error(`Voicing octave ${octave} places notes outside the MIDI range.`);
    voiced.push(pitch);
    previous = pitch;
  }
  return voiced;
}
/** Deterministic: the same seed must reproduce the same material, always. */
export function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}
export const PROGRESSIONS: Record<string, number[]> = {
  pop: [0, 5, 3, 4],
  sad: [0, 5, 2, 6],
  loop: [0, 3, 4, 3],
  cadence: [0, 3, 4, 0],
  descending: [0, 6, 5, 4],
};
export const progressionNames = Object.keys(PROGRESSIONS);
