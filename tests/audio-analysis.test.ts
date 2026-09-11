import { describe, expect, it } from 'vitest';
import { analyse, decodeAudio, estimateKey, estimateTempo } from '../packages/audio-analysis/src';

/** A real RIFF/WAVE file built around a signal whose answer we already know. */
function wav(
  signal: (t: number) => number,
  { seconds = 4, rate = 22050, bits = 16, channels = 1, float = false } = {},
): Uint8Array {
  const frames = Math.floor(seconds * rate);
  const bytes = bits / 8;
  const blockAlign = channels * bytes;
  const dataSize = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(float ? 3 : 1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let frame = 0; frame < frames; frame++) {
    const value = Math.max(-1, Math.min(1, signal(frame / rate)));
    for (let channel = 0; channel < channels; channel++) {
      const offset = 44 + frame * blockAlign + channel * bytes;
      if (float) buffer.writeFloatLE(value, offset);
      else if (bits === 8) buffer.writeUInt8(Math.round(value * 127) + 128, offset);
      else if (bits === 16) buffer.writeInt16LE(Math.round(value * 32767), offset);
      else if (bits === 24) {
        const scaled = Math.round(value * 8388607);
        buffer.writeUInt8(scaled & 0xff, offset);
        buffer.writeUInt8((scaled >> 8) & 0xff, offset + 1);
        buffer.writeUInt8((scaled >> 16) & 0xff, offset + 2);
      } else buffer.writeInt32LE(Math.round(value * 2147483647), offset);
    }
  }
  return new Uint8Array(buffer);
}
const tone = (hz: number) => (t: number) => Math.sin(2 * Math.PI * hz * t) * 0.7;
const chord = (freqs: number[]) => (t: number) =>
  freqs.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t), 0) * (0.7 / freqs.length);
/** A click every interval: the tempo is true by construction. */
const pulses = (bpm: number) => (t: number) => {
  const period = 60 / bpm;
  const phase = t % period;
  return phase < 0.02 ? Math.sin(2 * Math.PI * 1800 * t) * (1 - phase / 0.02) : 0;
};

describe('decoding', () => {
  it('decodes every common bit depth to the same signal', () => {
    const reference = decodeAudio(wav(tone(440), { bits: 16 }))!;
    for (const bits of [8, 24, 32]) {
      const decoded = decodeAudio(wav(tone(440), { bits }))!;
      expect(decoded.samples.length).toBe(reference.samples.length);
      const difference = reference.samples.reduce(
        (worst, value, index) => Math.max(worst, Math.abs(value - decoded.samples[index])),
        0,
      );
      // 8-bit quantisation is coarse; the others should be close.
      expect(difference).toBeLessThan(bits === 8 ? 0.05 : 0.001);
    }
    expect(decodeAudio(wav(tone(440), { bits: 32, float: true }))).not.toBeNull();
  });
  it('folds channels to mono and bounds how much audio it reads', () => {
    const stereo = decodeAudio(wav(tone(440), { channels: 2 }))!;
    expect(stereo.channels).toBe(2);
    const long = decodeAudio(wav(tone(440), { seconds: 20 }), 2)!;
    expect(long.seconds).toBeLessThanOrEqual(2.1);
  });
  it('declines what it cannot decode without pretending', () => {
    expect(decodeAudio(new Uint8Array(16))).toBeNull();
    expect(decodeAudio(new Uint8Array([...Buffer.from('ID3')]))).toBeNull();
    // A truncated data chunk: header fine, audio cut off.
    expect(decodeAudio(wav(tone(440)).subarray(0, 50))).toBeNull();
  });
});

describe('key estimation', () => {
  it('hears a single tone as its own note', () => {
    // 440 Hz is A.
    expect(estimateKey(decodeAudio(wav(tone(440)))!)?.key).toBe('A');
    // 261.63 Hz is middle C.
    expect(estimateKey(decodeAudio(wav(tone(261.63)))!)?.key).toBe('C');
  });
  it('hears a triad as its root, and hears major and minor apart', () => {
    const major = estimateKey(decodeAudio(wav(chord([261.63, 329.63, 392.0])))!);
    expect(major?.key).toBe('C');
    expect(major?.scale).toBe('major');
    const minor = estimateKey(decodeAudio(wav(chord([220.0, 261.63, 329.63])))!);
    expect(minor?.key).toBe('A');
    expect(minor?.scale).toBe('minor');
  });
  it('reports low confidence for material with no tonal centre', () => {
    let seed = 1;
    const noise = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    const tonal = estimateKey(decodeAudio(wav(chord([261.63, 329.63, 392.0])))!);
    const noisy = estimateKey(decodeAudio(wav(() => noise() * 0.5))!);
    expect(noisy).not.toBeNull();
    expect(noisy!.confidence).toBeLessThan(tonal!.confidence);
  });
});

describe('tempo estimation', () => {
  it('finds the tempo of a regular pulse', () => {
    for (const bpm of [90, 120, 140]) {
      const estimate = estimateTempo(decodeAudio(wav(pulses(bpm), { seconds: 8 }))!);
      expect(estimate).not.toBeNull();
      // Half and double time are inherent to autocorrelation; either is a hit.
      const ratio = estimate!.bpm / bpm;
      expect([1, 0.5, 2].some((factor) => Math.abs(ratio - factor) < 0.06)).toBe(true);
    }
  });
  it('reports no tempo for a one-shot', () => {
    const oneShot = (t: number) => (t < 0.1 ? Math.sin(2 * Math.PI * 120 * t) * (1 - t / 0.1) : 0);
    expect(estimateTempo(decodeAudio(wav(oneShot, { seconds: 6 }))!)).toBeNull();
  });
  it('reports no tempo for material too short to carry one', () => {
    expect(estimateTempo(decodeAudio(wav(pulses(120), { seconds: 2 }))!)).toBeNull();
  });
  it('reports no tempo for material with no attacks', () => {
    // A sustained pad has no rhythm, and neither does noise. Without a crest
    // gate both pick a tempo out of their own noise floor.
    const pad = (t: number) =>
      (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t)) * 0.4;
    expect(estimateTempo(decodeAudio(wav(pad, { seconds: 8 }))!)).toBeNull();
    let seed = 7;
    const noise = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    expect(estimateTempo(decodeAudio(wav(() => noise() * 0.4, { seconds: 8 }))!)).toBeNull();
  });
  it('is more confident about a rhythm than about an octave it had to choose', () => {
    const clear = estimateTempo(decodeAudio(wav(pulses(120), { seconds: 8 }))!)!;
    // 70 BPM is reported at its double: the prior has to pick an octave, and
    // the confidence should not pretend that choice was free.
    const octave = estimateTempo(decodeAudio(wav(pulses(70), { seconds: 8 }))!)!;
    expect(Math.abs(octave.bpm / 70 - 2)).toBeLessThan(0.06);
    expect(clear.confidence).toBeGreaterThan(octave.confidence);
  });
});

describe('analysis', () => {
  it('returns both estimates for musical material and nothing for undecodable input', () => {
    const result = analyse(wav(chord([220.0, 261.63, 329.63]), { seconds: 8 }))!;
    expect(result.key?.key).toBe('A');
    expect(result.seconds).toBeGreaterThan(7);
    expect(analyse(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
