import { ANALYSIS_RATE, decodeAudio, type DecodedAudio } from './decode';

/**
 * Key and tempo estimated from the audio. Both are guesses with a number
 * attached, and both are reported that way: a wrong key stated confidently
 * sends a producer to the wrong sound, which costs more than no key at all.
 */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FRAME = 2048;
export const HOP = 512;
/** The envelope needs finer time resolution than the chroma analysis does. */
export const ONSET_HOP = 256;
export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const MIN_CREST = 4;
/** Krumhansl-Schmuckler profiles, the standard weights for this correlation. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyEstimate {
  key: string;
  scale: 'major' | 'minor';
  confidence: number;
}
export interface TempoEstimate {
  bpm: number;
  confidence: number;
}
export interface Analysis {
  key: KeyEstimate | null;
  tempo: TempoEstimate | null;
  seconds: number;
}
const hann = (length: number) => {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  return window;
};
/**
 * A direct transform over the bins that matter musically. A full FFT would be
 * faster, but only these bins are read, and this stays short enough to verify.
 */
function spectrum(frame: Float32Array, window: Float32Array, bins: number): Float32Array {
  const magnitudes = new Float32Array(bins);
  for (let bin = 1; bin < bins; bin++) {
    let real = 0;
    let imaginary = 0;
    const step = (2 * Math.PI * bin) / frame.length;
    for (let n = 0; n < frame.length; n++) {
      const value = frame[n] * window[n];
      real += value * Math.cos(step * n);
      imaginary -= value * Math.sin(step * n);
    }
    magnitudes[bin] = Math.sqrt(real * real + imaginary * imaginary);
  }
  return magnitudes;
}
const correlate = (a: number[], b: number[]) => {
  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;
  let top = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    top += da * db;
    left += da * da;
    right += db * db;
  }
  return left && right ? top / Math.sqrt(left * right) : 0;
};
export function estimateKey(audio: DecodedAudio): KeyEstimate | null {
  const bins = FRAME / 2;
  const window = hann(FRAME);
  const chroma = new Array(12).fill(0);
  let frames = 0;
  for (let start = 0; start + FRAME <= audio.samples.length; start += HOP * 2) {
    const magnitudes = spectrum(audio.samples.subarray(start, start + FRAME), window, bins);
    for (let bin = 1; bin < bins; bin++) {
      const frequency = (bin * audio.sampleRate) / FRAME;
      // Below 55 Hz pitch is unreliable; above 2 kHz it is mostly harmonics.
      if (frequency < 55 || frequency > 2000) continue;
      const midi = 69 + 12 * Math.log2(frequency / 440);
      chroma[((Math.round(midi) % 12) + 12) % 12] += magnitudes[bin];
    }
    frames++;
  }
  if (!frames || chroma.every((value) => value === 0)) return null;
  let best: KeyEstimate | null = null;
  let second = -Infinity;
  for (let rotation = 0; rotation < 12; rotation++) {
    const rotated = chroma.map((_, index) => chroma[(index + rotation) % 12]);
    for (const [scale, profile] of [
      ['major', MAJOR_PROFILE],
      ['minor', MINOR_PROFILE],
    ] as const) {
      const score = correlate(rotated, profile);
      if (!best || score > (best as KeyEstimate & { score: number }).score) {
        if (best) second = Math.max(second, (best as KeyEstimate & { score: number }).score);
        best = Object.assign({ key: NOTE_NAMES[rotation], scale, confidence: 0 }, { score });
      } else second = Math.max(second, score);
    }
  }
  if (!best) return null;
  const score = (best as KeyEstimate & { score: number }).score;
  // Confidence is the margin over the runner-up: a key that only just wins is
  // one a producer should not trust.
  const margin = Math.max(0, score - Math.max(0, second));
  return {
    key: best.key,
    scale: best.scale,
    confidence: Math.max(
      0,
      Math.min(1, Number((margin * 2 + Math.max(0, score) * 0.3).toFixed(3))),
    ),
  };
}
export function onsetEnvelope(audio: DecodedAudio): Float32Array {
  const bins = 64;
  const window = hann(FRAME);
  const frames = Math.max(0, Math.floor((audio.samples.length - FRAME) / HOP));
  const envelope = new Float32Array(frames);
  let previous: Float32Array | null = null;
  for (let index = 0; index < frames; index++) {
    const magnitudes = spectrum(
      audio.samples.subarray(index * HOP, index * HOP + FRAME),
      window,
      bins,
    );
    if (previous) {
      let flux = 0;
      // Rising energy only: onsets are attacks, not releases.
      for (let bin = 1; bin < bins; bin++) flux += Math.max(0, magnitudes[bin] - previous[bin]);
      envelope[index] = flux;
    }
    previous = magnitudes;
  }
  return envelope;
}
export function estimateTempo(audio: DecodedAudio): TempoEstimate | null {
  // Under four seconds there is not enough material to carry a tempo.
  if (audio.seconds < 4) return null;
  const envelope = onsetEnvelope(audio);
  if (envelope.length < 32) return null;
  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  if (mean <= 0) return null;
  const centred = Array.from(envelope, (value) => value - mean);
  const peak = Math.max(...envelope);
  // Too few attacks above the floor: a one-shot, not a rhythm.
  if (envelope.filter((value) => value > mean + (peak - mean) * 0.5).length < 4) return null;
  // Crest separates material that has attacks from material that does not.
  // Measured on synthesised signals: rhythmic pulses land around 8 to 11,
  // white noise at 1.4, a sustained pad at 2.5. Without this a pad gets a
  // tempo from the shape of its own noise floor.
  if (peak / mean < MIN_CREST) return null;
  const perSecond = audio.sampleRate / ONSET_HOP;

  // Scored per lag rather than per BPM: several BPM values round to the same
  // lag, and scoring by BPM kept whichever label was tested first.
  const shortest = Math.max(2, Math.floor((60 / MAX_BPM) * perSecond));
  const longest = Math.min(centred.length - 2, Math.ceil((60 / MIN_BPM) * perSecond));
  if (longest <= shortest) return null;
  const scores = new Map<number, number>();
  // The prior decides which octave wins; it must not decide how sure we are,
  // or a tempo dragged toward the middle of the range would look more certain
  // than one that was simply right.
  const raw = new Map<number, number>();
  for (let lag = shortest; lag <= longest; lag++) {
    let product = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index + lag < centred.length; index++) {
      product += centred[index] * centred[index + lag];
      energyA += centred[index] * centred[index];
      energyB += centred[index + lag] * centred[index + lag];
    }
    // Normalized over the overlap: an unnormalized sum grows with the window
    // and hands longer lags — that is, slower tempos — an unearned advantage.
    const correlation = energyA && energyB ? product / Math.sqrt(energyA * energyB) : 0;
    // A prior over musical tempo. Autocorrelation cannot tell a tempo from its
    // half or double, so something has to prefer the one producers work at.
    const bpmAt = (60 * perSecond) / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpmAt / 120) / 0.9) ** 2);
    raw.set(lag, correlation);
    scores.set(lag, correlation * weight);
  }
  let bestLag = shortest;
  for (const [lag, score] of scores) if (score > scores.get(bestLag)!) bestLag = lag;
  const best = scores.get(bestLag)!;
  if (best <= 0) return null;

  // Parabolic interpolation around the peak: lag resolution is coarse at fast
  // tempos, and the true period usually falls between two integer lags.
  const before = scores.get(bestLag - 1) ?? best;
  const after = scores.get(bestLag + 1) ?? best;
  const denominator = before - 2 * best + after;
  const shift = denominator === 0 ? 0 : (0.5 * (before - after)) / denominator;
  const refined = bestLag + Math.max(-1, Math.min(1, shift));
  const bpm = (60 * perSecond) / refined;
  if (bpm < MIN_BPM - 1 || bpm > MAX_BPM + 1) return null;

  // How periodic the material actually is at the chosen lag, reduced when some
  // other period explains it nearly as well. Adjacent lags correlate with the
  // winner by construction and are ignored.
  const strength = Math.max(0, raw.get(bestLag) ?? 0);
  let rival = 0;
  for (const [lag, correlation] of raw)
    if (Math.abs(lag - bestLag) > 2) rival = Math.max(rival, correlation);
  const distinctness = strength > 0 ? Math.max(0, (strength - Math.max(0, rival)) / strength) : 0;
  return {
    bpm: Number(bpm.toFixed(1)),
    confidence: Math.max(
      0,
      Math.min(1, Number((strength * (0.4 + 0.6 * distinctness)).toFixed(3))),
    ),
  };
}
export function analyse(data: Uint8Array, maxSeconds?: number): Analysis | null {
  const audio = decodeAudio(data, maxSeconds);
  if (!audio) return null;
  return { key: estimateKey(audio), tempo: estimateTempo(audio), seconds: audio.seconds };
}
export { ANALYSIS_RATE, decodeAudio };
