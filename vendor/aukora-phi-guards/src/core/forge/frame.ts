// core/forge/frame.ts — WHAT IS ACTUALLY IN THE PICTURE, BEFORE ANYBODY IS ASKED ABOUT IT.
//
// Pure. No network, no clock, no disk. Bytes in, facts out.
//
// ══ WHY THIS EXISTS ══
//
// MEASURED by CODEX: a valid blank frame returns `{ok:true, critique:"The screen is blank."}` — a
// shape INDISTINGUISHABLE from grounded sight. `crush.ts` turned any non-empty stdout into `ok:true`,
// so "I looked and there was nothing there" and "I looked and here is what is there" arrived at the
// surface as the same kind of answer, and everything downstream treated them the same.
//
// That is the vacuous-pass shape, in the one place it is most expensive: an eye reporting success over
// no subject. The model is not wrong when it says the screen is blank — it is the only honest thing it
// can say. What is wrong is calling that ordinary success.
//
// So the frame is INSPECTED BEFORE INFERENCE. Dimensions come from the header; blankness comes from
// actually decoding the pixels. Neither asks a model anything, so neither can be talked out of it by
// one.
//
// ══ WHY DECODING RATHER THAN A SIZE HEURISTIC ══
//
// A uniform PNG compresses to almost nothing — measured at 1920×1080: 8,316 bytes for a blank frame
// against 71,609 for a noisy one, 0.0040 against 0.0345 bytes per pixel. That is a real signal and it
// was the first design. It was dropped because the threshold between them is a number somebody picks,
// and a mostly-empty screenshot with one small window sits exactly in the gap. A pin on a number I
// chose is the defect this repository keeps paying for.
//
// The capture is always PNG — `sight.js` calls `toDataURL('image/png')` at all three capture sites —
// so the pixels are reachable exactly, with zlib and about forty lines of unfiltering. Exact beats a
// threshold, and when it CANNOT be exact it says so rather than guessing.

import { inflateSync } from 'zlib';
import { createHash } from 'crypto';

/** The vocabulary CODEX specified. Three values, and each means a different thing to a caller. */
export type FrameSubject = 'present' | 'blank' | 'invalid';

export interface FrameFacts {
  /** Short digest of the exact bytes looked at, so two answers can be compared to one frame. */
  frameDigest: string;
  width: number | null;
  height: number | null;
  bytes: number;
  subject: FrameSubject;
  /**
   * WAS `subject` MEASURED, OR DEFAULTED?
   *
   * `false` means the frame could not be decoded — an unsupported colour type, a truncated stream, a
   * format that is not PNG — so `present` here is an ASSUMPTION and not a finding. A caller that
   * treats an unchecked `present` as a checked one has rebuilt the exact defect this file exists to
   * remove, one field further along.
   */
  subjectChecked: boolean;
  /** Why, when the answer is not the obvious one. Never empty for `blank` or `invalid`. */
  because: string;
}

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The smallest frame that could carry anything a person would call a subject. */
const MIN_USEFUL_EDGE = 8;

/** Bytes out of a `data:image/...;base64,` URL, or null if it is not one. */
export function frameBytes(dataUrl: unknown): Buffer | null {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(dataUrl ?? ''));
  if (!m?.[2]) return null;
  try { return Buffer.from(m[2], 'base64'); } catch { return null; }
}

/** Width and height from the PNG header alone. No decompression, no allocation. */
function pngHeader(buf: Buffer): { width: number; height: number; depth: number; colour: number } | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    depth: buf[24]!,
    colour: buf[25]!,
  };
}

/** Every IDAT chunk, concatenated — PNG allows the stream to be split across any number of them. */
function idat(buf: Buffer): Buffer | null {
  const parts: Buffer[] = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (type === 'IDAT') parts.push(buf.subarray(i + 8, i + 8 + len));
    if (type === 'IEND') break;
    i += 12 + len;
    if (len < 0 || i > buf.length) return null;
  }
  return parts.length ? Buffer.concat(parts) : null;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * How many DISTINCT colours the frame contains, or null when it cannot be decoded.
 *
 * Only 8-bit RGB and RGBA are handled, which is what a canvas produces. Anything else returns null —
 * "I could not tell", which the caller must not round to either answer.
 *
 * Counting stops at `cap`: the question is "is there a subject", and a frame with more than a handful
 * of colours has one. Stopping early keeps this cheap on a full-screen capture.
 */
export function distinctColours(buf: Buffer, cap = 8): number | null {
  const h = pngHeader(buf);
  if (!h || h.depth !== 8 || (h.colour !== 2 && h.colour !== 6)) return null;
  if (h.width <= 0 || h.height <= 0) return null;
  const raw = idat(buf);
  if (!raw) return null;

  let data: Buffer;
  try { data = inflateSync(raw); } catch { return null; }

  const channels = h.colour === 6 ? 4 : 3;
  const stride = h.width * channels;
  if (data.length < (stride + 1) * h.height) return null;

  const seen = new Set<number>();
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);

  for (let y = 0; y < h.height; y += 1) {
    const at = y * (stride + 1);
    const filter = data[at]!;
    data.copy(line, 0, at + 1, at + 1 + stride);

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      const v = line[x]!;
      // The five PNG filters. Anything else is a malformed stream, and malformed is not "blank".
      if (filter === 1) line[x] = (v + a) & 0xff;
      else if (filter === 2) line[x] = (v + b) & 0xff;
      else if (filter === 3) line[x] = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[x] = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) return null;
    }

    for (let x = 0; x + channels <= stride; x += channels) {
      // Alpha is deliberately excluded: a transparent screenshot over one colour is still one colour
      // to a person looking at it, and the question here is what a person would see.
      seen.add((line[x]! << 16) | (line[x + 1]! << 8) | line[x + 2]!);
      if (seen.size > cap) return seen.size;
    }
    line.copy(prev);
  }
  return seen.size;
}

/**
 * Everything knowable about a frame without asking a model.
 *
 * `invalid` — it is not a frame, or it is too small to hold anything. There is nothing to look at.
 * `blank`   — decoded, and it is one flat colour. A model asked about it can only say so.
 * `present` — there is something in it. `subjectChecked` says whether that was measured or assumed.
 */
export function inspectFrame(dataUrl: unknown): FrameFacts {
  const buf = frameBytes(dataUrl);
  if (!buf || buf.length === 0) {
    return {
      frameDigest: '', width: null, height: null, bytes: 0,
      subject: 'invalid', subjectChecked: true,
      because: 'what was handed over is not an image at all',
    };
  }

  const frameDigest = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const h = pngHeader(buf);
  const width = h?.width ?? null;
  const height = h?.height ?? null;
  const base = { frameDigest, width, height, bytes: buf.length };

  if (h && (h.width < MIN_USEFUL_EDGE || h.height < MIN_USEFUL_EDGE)) {
    return {
      ...base, subject: 'invalid', subjectChecked: true,
      because: `the frame is ${h.width}x${h.height} — too small to hold anything a person would call a subject`,
    };
  }

  const colours = distinctColours(buf);
  if (colours === null) {
    // NOT "blank" AND NOT A VERIFIED "present". A frame nobody could decode is a frame nobody looked
    // at, and the flag says so — the whole point of carrying `subjectChecked` beside `subject`.
    return {
      ...base, subject: 'present', subjectChecked: false,
      because: h
        ? 'this frame could not be decoded here, so whether it has a subject was not established'
        : 'not a PNG, so whether it has a subject was not established',
    };
  }
  if (colours <= 1) {
    return {
      ...base, subject: 'blank', subjectChecked: true,
      because: 'the frame is one flat colour — there is nothing in it to look at',
    };
  }
  return { ...base, subject: 'present', subjectChecked: true, because: '' };
}

/** It reports. It cannot authorize, approve, sign or gate anything. */
export function frameGrantsAuthority(): false {
  return false;
}
