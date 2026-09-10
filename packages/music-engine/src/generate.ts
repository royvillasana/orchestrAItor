import { TICKS_PER_BEAT, writeMidiFile, type Note } from './midi';
import {
  PROGRESSIONS,
  diatonicChord,
  noteName,
  parseKey,
  scalePitches,
  seeded,
  voice,
  type ScaleName,
} from './theory';

export const clipKinds = ['chords', 'bass', 'drums'] as const;
export type ClipKind = (typeof clipKinds)[number];
export interface GenerateInput {
  kind: ClipKind;
  key: string;
  scale: ScaleName;
  bars: number;
  tempo: number;
  progression: string;
  seed: number;
  octave?: number;
}
export interface GeneratedClip {
  bytes: Uint8Array;
  notes: Note[];
  summary: string;
  chords: string[];
}
/** General MIDI drum map, the one every DAW agrees on. */
export const DRUMS = { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 } as const;

function chordNotes(
  input: GenerateInput,
  beatsPerBar: number,
): { notes: Note[]; chords: string[] } {
  const { root } = parseKey(input.key);
  const degrees = PROGRESSIONS[input.progression] ?? PROGRESSIONS.pop;
  const random = seeded(input.seed);
  const notes: Note[] = [];
  const chords: string[] = [];
  for (let bar = 0; bar < input.bars; bar++) {
    const chord = diatonicChord(root, input.scale, degrees[bar % degrees.length], {
      seventh: random() > 0.65,
    });
    chords.push(`${chord.roman} (${chord.name})`);
    const pitches = voice(chord, input.octave ?? 4);
    const start = bar * beatsPerBar * TICKS_PER_BEAT;
    for (const pitch of pitches)
      notes.push({
        start,
        duration: beatsPerBar * TICKS_PER_BEAT - 20,
        pitch,
        velocity: 78 + Math.round(random() * 18),
      });
  }
  return { notes, chords };
}
function bassNotes(input: GenerateInput, beatsPerBar: number): { notes: Note[]; chords: string[] } {
  const { root } = parseKey(input.key);
  const degrees = PROGRESSIONS[input.progression] ?? PROGRESSIONS.pop;
  const scale = scalePitches(root, input.scale);
  const random = seeded(input.seed);
  const notes: Note[] = [];
  const chords: string[] = [];
  const base = ((input.octave ?? 2) + 1) * 12;
  for (let bar = 0; bar < input.bars; bar++) {
    const chord = diatonicChord(root, input.scale, degrees[bar % degrees.length]);
    chords.push(`${chord.roman} (${chord.name})`);
    for (let beat = 0; beat < beatsPerBar; beat++) {
      // Root on the downbeat, then scale tones around it: recognisably the
      // chord rather than a random walk.
      const pitchClass =
        beat === 0
          ? chord.pitches[0]
          : random() > 0.6
            ? chord.pitches[Math.floor(random() * chord.pitches.length)]
            : scale[Math.floor(random() * scale.length)];
      if (beat > 0 && random() > 0.75) continue;
      notes.push({
        start: (bar * beatsPerBar + beat) * TICKS_PER_BEAT,
        duration: Math.round(TICKS_PER_BEAT * (random() > 0.5 ? 0.5 : 0.9)),
        pitch: base + pitchClass,
        velocity: beat === 0 ? 100 : 74 + Math.round(random() * 16),
      });
    }
  }
  return { notes, chords };
}
function drumNotes(input: GenerateInput, beatsPerBar: number): { notes: Note[]; chords: string[] } {
  const random = seeded(input.seed);
  const notes: Note[] = [];
  const eighth = TICKS_PER_BEAT / 2;
  for (let bar = 0; bar < input.bars; bar++) {
    for (let step = 0; step < beatsPerBar * 2; step++) {
      const at = bar * beatsPerBar * TICKS_PER_BEAT + step * eighth;
      const beat = step / 2;
      const add = (pitch: number, velocity: number) =>
        notes.push({ start: at, duration: eighth - 10, pitch, velocity, channel: 9 });
      if (beat === 0 || (beat === 2 && random() > 0.3)) add(DRUMS.kick, 110);
      else if (step % 2 === 1 && random() > 0.85) add(DRUMS.kick, 84);
      if (beat === 1 || beat === 3) add(DRUMS.snare, 104);
      if (random() > 0.15)
        add(step % 4 === 2 ? DRUMS.openHat : DRUMS.closedHat, 62 + Math.round(random() * 22));
    }
  }
  return { notes, chords: [] };
}
export function generateClip(input: GenerateInput): GeneratedClip {
  if (!Number.isInteger(input.bars) || input.bars < 1 || input.bars > 32)
    throw new Error('A clip must be between 1 and 32 bars.');
  parseKey(input.key);
  const beatsPerBar = 4;
  const { notes, chords } =
    input.kind === 'chords'
      ? chordNotes(input, beatsPerBar)
      : input.kind === 'bass'
        ? bassNotes(input, beatsPerBar)
        : drumNotes(input, beatsPerBar);
  if (notes.length === 0) throw new Error('Generation produced no notes.');
  const { root } = parseKey(input.key);
  const keyLabel = `${noteName(root, input.key)} ${input.scale}`;
  const name = `${input.kind} · ${keyLabel} · ${input.bars} bars`;
  const summary =
    input.kind === 'drums'
      ? `${input.bars}-bar drum pattern at ${input.tempo} BPM`
      : `${input.bars}-bar ${input.kind} in ${keyLabel} at ${input.tempo} BPM — ${[...new Set(chords)].join(' · ')}`;
  return {
    bytes: writeMidiFile({ notes, tempo: input.tempo, timeSignature: [beatsPerBar, 4], name }),
    notes,
    summary,
    chords,
  };
}
