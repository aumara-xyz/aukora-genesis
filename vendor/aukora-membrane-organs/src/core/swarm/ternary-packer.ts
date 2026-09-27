// core/swarm/ternary-packer.ts — a fixed-width codec for streams of 3-trit cells.
//
// Extracted from core/swarm/t27-utility-discriminator.ts, which is now quarantined. This is the
// part of that work that was real: a lossless, deterministic codec that stores a stream of
// 27-valued cells at 5 bits each instead of 8. Nothing else came with it — no bridge, no court,
// no address semantics.
//
// ══ THE NAME WAS WRONG, AND THE RENAME IS THE POINT ══
//
// It was called packBase27Stream. It does not pack in base 27. It writes each cell as a
// FIXED 5-BIT FIELD (2^5 = 32 >= 27) and discards the 5 code points of every 32 that a
// 27-valued symbol does not use. Measured:
//
//     this codec        5.000 bits/cell   (exactly, at every length)
//     true base-27      4.755 bits/cell   (log2 27, asymptotic)
//     naive one byte    8.000 bits/cell
//     the gap           0.245 bits/cell — about 4.9% left on the table
//
// The gap is left deliberately and is gated as a named number rather than closed, because
// closing it means carrying a big-integer radix conversion for a 5% saving, and because a
// codec that claims an optimum it does not reach is the defect this repository exists to
// refuse. If someone later wants the 4.755, they should change the code and the gate together.
//
// ══ RELATION TO core/vk-address.ts — ASKED AND ANSWERED ══
//
// Both use balanced ternary. That is the whole of the overlap, and a shared radix is not a
// shared design:
//
//   vk-address   ONE six-trit word whose trits MEAN things — six named verification lanes,
//                each {-1, 0, +1} = {failed, unknown, verified} — bijective to an integer in
//                [-364, +364], with a unique zero meaning "nothing is known". A SEMANTIC
//                encoder. Its value is that each position carries a claim.
//   this codec   A stream of arbitrarily many three-trit cells whose trits mean NOTHING to it.
//                A SYNTACTIC codec. Its value is that it does not care what they mean.
//
// They are not duplicates and neither subsumes the other: one encodes a single posture with
// meaning per position, the other compresses a sequence with no meaning at all.
//
// THE ONE REAL COMPOSITION POINT, recorded so it is a decision rather than an accident: a
// HISTORY of VK addresses is a stream of six-trit words, and this codec could store each as two
// cells at 10 bits instead of the 16 a pair of bytes costs. Nothing does that today, and nothing
// should start doing it without an owner deciding a posture history is worth persisting.
//
// ZERO AUTHORITY. packerGrantsAuthority() === false. A codec is not a permission.

/** A cell is a 27-valued symbol. That is all it is here — no coordinates, no shell, no address
 *  semantics. The quarantined T27 code carried the same 27 states across eight fields (x/y/z,
 *  t2/t1/t0 and address are three encodings bijective with one another, and shell is derived);
 *  this interface is the 4.75 bits that were actually in there. */
export type TritCellAddress = number; // 0..26

export const CELL_VALUES = 27;
export const BITS_PER_CELL = 5;

export class TernaryPackError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'TernaryPackError'; }
}

/** Refused by name rather than silently truncated: a value outside 0..26 is not a cell, and
 *  masking it to five bits would store a different symbol than the caller handed over. */
function assertCell(v: unknown, i: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= CELL_VALUES) {
    throw new TernaryPackError('packer:not-a-cell', `cell ${i} is ${JSON.stringify(v)}; a cell is an integer in [0, ${CELL_VALUES - 1}]`);
  }
  return v;
}

/** Stream -> bytes. Big-endian bit order within the stream, so the encoding is one thing and not
 *  a platform question. */
export function packTritCells(cells: readonly TritCellAddress[]): Uint8Array {
  const out = new Uint8Array(Math.ceil((cells.length * BITS_PER_CELL) / 8));
  let bit = 0;
  for (let i = 0; i < cells.length; i++) {
    const addr = assertCell(cells[i], i);
    for (let b = 0; b < BITS_PER_CELL; b++) {
      if ((addr >> (BITS_PER_CELL - 1 - b)) & 1) out[bit >> 3] |= 1 << (7 - (bit & 7));
      bit++;
    }
  }
  return out;
}

/** Bytes -> stream. `count` is required: the trailing bits of the last byte are padding and are
 *  indistinguishable from a cell of value 0, so a length that is not carried is a length that is
 *  guessed. */
export function unpackTritCells(packed: Uint8Array, count: number): TritCellAddress[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new TernaryPackError('packer:bad-count', `count is ${JSON.stringify(count)}; it must be a non-negative integer`);
  }
  const need = Math.ceil((count * BITS_PER_CELL) / 8);
  if (packed.length < need) {
    throw new TernaryPackError('packer:short-buffer', `${count} cell(s) need ${need} byte(s); got ${packed.length}`);
  }
  const cells: number[] = [];
  let bit = 0;
  for (let i = 0; i < count; i++) {
    let addr = 0;
    for (let b = 0; b < BITS_PER_CELL; b++) {
      addr = (addr << 1) | ((packed[bit >> 3]! >> (7 - (bit & 7))) & 1);
      bit++;
    }
    cells.push(addr);
  }
  return cells;
}

/** Bits per cell this codec actually achieves at a given length. Exposed so the gate asserts a
 *  measured number rather than a remembered one. */
export function bitsPerCell(count: number): number {
  if (count <= 0) return 0;
  return (Math.ceil((count * BITS_PER_CELL) / 8) * 8) / count;
}

export function packerGrantsAuthority(): false { return false; }
