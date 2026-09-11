import { z } from 'zod';
import { projectSchema, toolNameSchema } from '@orchestrai/shared-types';

/**
 * MIDI System Exclusive frame:
 *   F0 7D <protocol> <kind> <correlation> <len-hi> <len-lo> <payload…> <sum> F7
 *
 * 0x7D is the non-commercial manufacturer id, appropriate for a local bridge.
 * Every byte between the delimiters is 7-bit, so JSON payloads are encoded
 * 8-to-7 before framing. Frames are never fragmented: Milestone 2's payloads
 * are small, and reassembly state would exist with no caller needing it.
 */
export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
export const MANUFACTURER_ID = 0x7d;
export const PROTOCOL_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 4096;

export const frameKinds = ['request', 'response'] as const;
export type FrameKind = (typeof frameKinds)[number];

export interface Frame {
  protocol: number;
  kind: FrameKind;
  correlation: number;
  payload: string;
}
export type DecodeFailure =
  | 'not-sysex'
  | 'foreign-manufacturer'
  | 'truncated'
  | 'unknown-kind'
  | 'bad-checksum'
  | 'bad-length'
  | 'bad-payload';
export type DecodeResult = { ok: true; frame: Frame } | { ok: false; reason: DecodeFailure };

/** Packs 8-bit bytes into 7-bit groups so arbitrary UTF-8 survives MIDI. */
export function to7Bit(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < bytes.length; index += 7) {
    const chunk = bytes.subarray(index, index + 7);
    let high = 0;
    for (let position = 0; position < chunk.length; position++)
      high |= ((chunk[position] >> 7) & 1) << position;
    out.push(high);
    for (const byte of chunk) out.push(byte & 0x7f);
  }
  return Uint8Array.from(out);
}
export function from7Bit(bytes: Uint8Array): Uint8Array | null {
  const out: number[] = [];
  for (let index = 0; index < bytes.length; ) {
    const high = bytes[index++];
    if (high > 0x7f) return null;
    const remaining = Math.min(7, bytes.length - index);
    if (remaining <= 0) break;
    for (let position = 0; position < remaining; position++) {
      const byte = bytes[index++];
      if (byte > 0x7f) return null;
      out.push(byte | (((high >> position) & 1) << 7));
    }
  }
  return Uint8Array.from(out);
}
const checksum = (bytes: Uint8Array) => bytes.reduce((sum, byte) => (sum + byte) & 0x7f, 0);

export function encodeFrame(frame: Omit<Frame, 'protocol'> & { protocol?: number }): Uint8Array {
  const payload = to7Bit(new TextEncoder().encode(frame.payload));
  if (payload.length > MAX_PAYLOAD_BYTES)
    throw new Error(
      `The bridge payload is ${payload.length} bytes, above the ${MAX_PAYLOAD_BYTES} byte ceiling.`,
    );
  const header = Uint8Array.from([
    frame.protocol ?? PROTOCOL_VERSION,
    frameKinds.indexOf(frame.kind),
    frame.correlation & 0x7f,
    (payload.length >> 7) & 0x7f,
    payload.length & 0x7f,
  ]);
  const body = Uint8Array.from([...header, ...payload]);
  return Uint8Array.from([SYSEX_START, MANUFACTURER_ID, ...body, checksum(body), SYSEX_END]);
}
export function decodeFrame(bytes: Uint8Array): DecodeResult {
  if (bytes.length < 9 || bytes[0] !== SYSEX_START || bytes[bytes.length - 1] !== SYSEX_END)
    return { ok: false, reason: 'not-sysex' };
  if (bytes[1] !== MANUFACTURER_ID) return { ok: false, reason: 'foreign-manufacturer' };
  const body = bytes.subarray(2, bytes.length - 2);
  if (body.length < 5) return { ok: false, reason: 'truncated' };
  if (checksum(body) !== bytes[bytes.length - 2]) return { ok: false, reason: 'bad-checksum' };
  const kind = frameKinds[body[1]];
  if (!kind) return { ok: false, reason: 'unknown-kind' };
  const length = (body[3] << 7) | body[4];
  const payload = body.subarray(5);
  if (payload.length !== length) return { ok: false, reason: 'bad-length' };
  const decoded = from7Bit(payload);
  if (!decoded) return { ok: false, reason: 'bad-payload' };
  try {
    return {
      ok: true,
      frame: {
        protocol: body[0],
        kind,
        correlation: body[2],
        payload: new TextDecoder('utf-8', { fatal: true }).decode(decoded),
      },
    };
  } catch {
    return { ok: false, reason: 'bad-payload' };
  }
}

export const bridgeOperations = ['hello', 'get_state', 'get_revision', 'execute'] as const;
export const requestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('hello'), protocol: z.number().int().nonnegative() }).strict(),
  z.object({ op: z.literal('get_state') }).strict(),
  z.object({ op: z.literal('get_revision') }).strict(),
  z
    .object({ op: z.literal('execute'), tool: toolNameSchema, arguments: z.record(z.unknown()) })
    .strict(),
]);
export type BridgeRequest = z.infer<typeof requestSchema>;
export const revisionResultSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
export const helloResultSchema = z
  .object({
    protocol: z.number().int().nonnegative(),
    daw: z.string().min(1).max(120),
    operations: z.array(toolNameSchema),
  })
  .strict();
export const responseSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(500) }).strict(),
]);
export type BridgeResponse = z.infer<typeof responseSchema>;
export const stateResultSchema = z.object({ project: projectSchema }).strict();
