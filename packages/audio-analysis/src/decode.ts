/**
 * PCM decoding, written directly. A codec dependency would buy compressed
 * formats; estimating from a partial decode of one produces numbers whose
 * errors nobody can account for, so those stay unanalysed instead.
 */
export const ANALYSIS_RATE = 11025;
export const MAX_SECONDS = 30;

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  sourceRate: number;
  channels: number;
  seconds: number;
}
const ascii = (data: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...data.subarray(offset, offset + length));

interface PcmBlock {
  data: Uint8Array;
  sampleRate: number;
  channels: number;
  bits: number;
  float: boolean;
  littleEndian: boolean;
}
function readWav(data: Uint8Array): PcmBlock | null {
  if (data.length < 44 || ascii(data, 0, 4) !== 'RIFF' || ascii(data, 8, 12 - 8) !== 'WAVE')
    return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let format = 1;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= data.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // Extensible WAV carries the real format in its extension.
      if (format === 0xfffe && body + 26 <= data.length) format = view.getUint16(body + 24, true);
    }
    if (id === 'data') {
      if (!channels || !sampleRate || !bits) return null;
      return {
        data: data.subarray(body, Math.min(body + size, data.length)),
        sampleRate,
        channels,
        bits,
        float: format === 3,
        littleEndian: true,
      };
    }
    if (size <= 0) break;
    offset = body + size + (size % 2);
  }
  return null;
}
function readAiff(data: Uint8Array): PcmBlock | null {
  if (data.length < 32 || ascii(data, 0, 4) !== 'FORM') return null;
  const form = ascii(data, 8, 4);
  if (form !== 'AIFF' && form !== 'AIFC') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4);
    const size = view.getUint32(offset + 4);
    const body = offset + 8;
    if (id === 'COMM' && body + 18 <= data.length) {
      channels = view.getUint16(body);
      bits = view.getUint16(body + 6);
      const exponent = view.getUint16(body + 8);
      const mantissa = Number(view.getBigUint64(body + 10));
      sampleRate = Math.round(mantissa * Math.pow(2, exponent - 16383 - 63));
    }
    if (id === 'SSND' && body + 8 <= data.length) {
      if (!channels || !sampleRate || !bits) return null;
      const start = body + 8 + view.getUint32(body);
      return {
        data: data.subarray(start, Math.min(body + size, data.length)),
        sampleRate,
        channels,
        bits,
        float: false,
        // AIFF is big-endian, which is the whole reason this is a parameter.
        littleEndian: false,
      };
    }
    if (size <= 0) break;
    offset = body + size + (size % 2);
  }
  return null;
}
function readSample(view: DataView, offset: number, block: PcmBlock): number {
  const { bits, float, littleEndian } = block;
  if (float && bits === 32) return view.getFloat32(offset, littleEndian);
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, littleEndian) / 32768;
  if (bits === 24) {
    const bytes = [view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2)];
    const ordered = littleEndian ? bytes : [...bytes].reverse();
    let value = ordered[0] | (ordered[1] << 8) | (ordered[2] << 16);
    if (value & 0x800000) value -= 0x1000000;
    return value / 8388608;
  }
  if (bits === 32) return view.getInt32(offset, littleEndian) / 2147483648;
  return 0;
}
/** Mono, downsampled, and bounded: analysis needs shape, not fidelity. */
export function decodeAudio(data: Uint8Array, maxSeconds = MAX_SECONDS): DecodedAudio | null {
  const block = readWav(data) ?? readAiff(data);
  if (!block) return null;
  const bytesPerSample = Math.ceil(block.bits / 8);
  const frameBytes = bytesPerSample * block.channels;
  if (frameBytes <= 0) return null;
  const frames = Math.floor(block.data.length / frameBytes);
  if (frames <= 0) return null;
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const wanted = Math.min(frames, Math.floor(block.sampleRate * maxSeconds));
  const step = Math.max(1, Math.round(block.sampleRate / ANALYSIS_RATE));
  const out = new Float32Array(Math.floor(wanted / step));
  for (let index = 0; index < out.length; index++) {
    const frame = index * step;
    let sum = 0;
    for (let channel = 0; channel < block.channels; channel++) {
      const offset = frame * frameBytes + channel * bytesPerSample;
      if (offset + bytesPerSample > block.data.length)
        return finish(out.subarray(0, index), block, step);
      sum += readSample(view, offset, block);
    }
    out[index] = sum / block.channels;
  }
  return finish(out, block, step);
}
function finish(samples: Float32Array, block: PcmBlock, step: number): DecodedAudio | null {
  if (samples.length < 64) return null;
  const rate = block.sampleRate / step;
  return {
    samples,
    sampleRate: rate,
    sourceRate: block.sampleRate,
    channels: block.channels,
    seconds: samples.length / rate,
  };
}
