import { MIDI_MAX, MIDI_MIN } from './theory';

/**
 * Standard MIDI files, written directly. The format is small and stable — a
 * header chunk, a track chunk, variable-length delta times, a few meta events —
 * so emitting the bytes costs less than a dependency in an application that
 * runs offline, and it can be verified by parsing the result back.
 */
export const TICKS_PER_BEAT = 480;
export interface Note {
  /** In ticks from the start of the clip. */
  start: number;
  duration: number;
  pitch: number;
  velocity: number;
  channel?: number;
}
export interface ClipInput {
  notes: Note[];
  tempo: number;
  timeSignature: [number, number];
  name: string;
  ticksPerBeat?: number;
}
export function variableLength(value: number): number[] {
  if (value < 0 || !Number.isInteger(value)) throw new Error(`Invalid delta time ${value}.`);
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}
const text = (value: string) => [...value].map((character) => character.charCodeAt(0) & 0x7f);
const chunk = (id: string, body: number[]) => [
  ...text(id),
  (body.length >> 24) & 0xff,
  (body.length >> 16) & 0xff,
  (body.length >> 8) & 0xff,
  body.length & 0xff,
  ...body,
];
export function writeMidiFile(clip: ClipInput): Uint8Array {
  const ticksPerBeat = clip.ticksPerBeat ?? TICKS_PER_BEAT;
  if (!(clip.tempo > 0)) throw new Error(`Invalid tempo ${clip.tempo}.`);
  for (const note of clip.notes) {
    if (note.pitch < MIDI_MIN || note.pitch > MIDI_MAX)
      throw new Error(`Note ${note.pitch} is outside the MIDI range.`);
    if (note.velocity < 1 || note.velocity > 127)
      throw new Error(`Velocity ${note.velocity} is outside the MIDI range.`);
    if ((note.channel ?? 0) < 0 || (note.channel ?? 0) > 15)
      throw new Error(`Channel ${note.channel} is outside the MIDI range.`);
    if (note.duration <= 0) throw new Error('A note must have a positive duration.');
  }
  const microsecondsPerBeat = Math.round(60000000 / clip.tempo);
  const [numerator, denominator] = clip.timeSignature;
  const events: { tick: number; order: number; bytes: number[] }[] = [
    {
      tick: 0,
      order: 0,
      bytes: [0xff, 0x03, ...variableLength(text(clip.name).length), ...text(clip.name)],
    },
    {
      tick: 0,
      order: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (microsecondsPerBeat >> 16) & 0xff,
        (microsecondsPerBeat >> 8) & 0xff,
        microsecondsPerBeat & 0xff,
      ],
    },
    {
      tick: 0,
      order: 0,
      bytes: [0xff, 0x58, 0x04, numerator, Math.log2(denominator), 24, 8],
    },
  ];
  for (const note of clip.notes) {
    const channel = note.channel ?? 0;
    // Note off before note on at the same tick, so a repeated pitch retriggers
    // rather than being cut short by the previous note's release.
    events.push({
      tick: note.start + note.duration,
      order: 0,
      bytes: [0x80 | channel, note.pitch, 0],
    });
    events.push({ tick: note.start, order: 1, bytes: [0x90 | channel, note.pitch, note.velocity] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let previous = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  track.push(...variableLength(0), 0xff, 0x2f, 0x00);
  return Uint8Array.from([
    // format (2), track count (2), division (2) — six bytes, no more.
    ...chunk('MThd', [0, 0, 0, 1, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff]),
    ...chunk('MTrk', track),
  ]);
}

export interface ParsedMidi {
  format: number;
  tracks: number;
  ticksPerBeat: number;
  tempo: number;
  timeSignature: [number, number];
  name: string;
  notes: Note[];
}
/** Reads a file back, which is how the writer is actually verified. */
export function parseMidiFile(data: Uint8Array): ParsedMidi {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...data.subarray(offset, offset + length));
  if (ascii(0, 4) !== 'MThd') throw new Error('Not a MIDI file: missing MThd.');
  const format = view.getUint16(8);
  const tracks = view.getUint16(10);
  const ticksPerBeat = view.getUint16(12);
  let offset = 8 + view.getUint32(4);
  if (ascii(offset, 4) !== 'MTrk') throw new Error('Not a MIDI file: missing MTrk.');
  const end = offset + 8 + view.getUint32(offset + 4);
  offset += 8;
  let tick = 0;
  let status = 0;
  let tempo = 120;
  let timeSignature: [number, number] = [4, 4];
  let name = '';
  const open = new Map<string, Note>();
  const notes: Note[] = [];
  const readVariable = () => {
    let value = 0;
    for (;;) {
      const byte = data[offset++];
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
  };
  while (offset < end) {
    tick += readVariable();
    let byte = data[offset];
    if (byte & 0x80) {
      status = byte;
      offset++;
    }
    byte = status;
    if (byte === 0xff) {
      const type = data[offset++];
      const length = readVariable();
      const body = data.subarray(offset, offset + length);
      if (type === 0x51)
        tempo = Math.round(60000000 / ((body[0] << 16) | (body[1] << 8) | body[2]));
      if (type === 0x58) timeSignature = [body[0], 2 ** body[1]];
      if (type === 0x03) name = String.fromCharCode(...body);
      offset += length;
      if (type === 0x2f) break;
      continue;
    }
    const command = byte & 0xf0;
    const channel = byte & 0x0f;
    const pitch = data[offset++];
    const velocity = data[offset++];
    const key = `${channel}:${pitch}`;
    if (command === 0x90 && velocity > 0)
      open.set(key, { start: tick, duration: 0, pitch, velocity, channel });
    if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      const note = open.get(key);
      if (note) {
        notes.push({ ...note, duration: tick - note.start });
        open.delete(key);
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { format, tracks, ticksPerBeat, tempo, timeSignature, name, notes };
}
