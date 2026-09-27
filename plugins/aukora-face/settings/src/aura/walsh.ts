// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Pure degree-two Walsh codec for the six rotation planes of a 16-vertex tesseract.
 *
 * Adapted from `aumara-xyz/aukora-phi` commit
 * `a099901ad5a2d623c5343263de6ae5f9994d3159`. The codec is exact only on its
 * six-dimensional degree-two subspace; decoding a field altered by a nonlinear
 * operation silently discards every component outside that subspace.
 */

type Axis4 = 0 | 1 | 2 | 3

/** Ordered pair of tesseract axes defining one rotation plane. */
export type Plane = readonly [Axis4, Axis4]

/** Six plane coefficients in `PLANE_ORDER`. */
export type Coeffs6 = [number, number, number, number, number, number]

/** One scalar amplitude per tesseract vertex. */
export type Field16 = number[]

/** Frozen plane order: standing `xy, xz, yz`, then breath `xw, yw, zw`. */
export const PLANE_ORDER: readonly Plane[] = Object.freeze([
  Object.freeze([0, 1] as const),
  Object.freeze([0, 2] as const),
  Object.freeze([1, 2] as const),
  Object.freeze([0, 3] as const),
  Object.freeze([1, 3] as const),
  Object.freeze([2, 3] as const),
])

/** Human-readable names corresponding one-for-one with `PLANE_ORDER`. */
export const MODE_NAMES: readonly string[] = Object.freeze(['xy', 'xz', 'yz', 'xw', 'yw', 'zw'])

/** Frozen bit-order enumeration of the sixteen vertices in `{−1,+1}^4`. */
export const VERTICES: ReadonlyArray<readonly [number, number, number, number]> = Object.freeze(
  Array.from({ length: 16 }, (_, index): readonly [number, number, number, number] => Object.freeze([
    (index & 1) === 0 ? -1 : 1,
    (index & 2) === 0 ? -1 : 1,
    (index & 4) === 0 ? -1 : 1,
    (index & 8) === 0 ? -1 : 1,
  ] as const)),
)

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Compute the unnormalized inner product of two 16-vertex fields.
 * @param left - First field; missing or non-finite entries contribute zero.
 * @param right - Second field; missing or non-finite entries contribute zero.
 * @returns Sum of the sixteen pairwise products.
 */
export function dot16(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let total = 0
  for (let index = 0; index < 16; index += 1) {
    total += finiteOrZero(left[index]) * finiteOrZero(right[index])
  }
  return total
}

/**
 * Synthesize a 16-vertex field from six degree-two Walsh coefficients.
 * @param coefficients - Values in `PLANE_ORDER`; absent or non-finite entries are zero.
 * @returns Sixteen finite vertex amplitudes in `VERTICES` order.
 */
export function synth6(coefficients: ArrayLike<number> | null | undefined): Field16 {
  const field: Field16 = new Array(16).fill(0)
  for (const [vertexIndex, vertex] of VERTICES.entries()) {
    let amplitude = 0
    for (const [mode, [leftAxis, rightAxis]] of PLANE_ORDER.entries()) {
      amplitude += finiteOrZero(coefficients?.[mode]) * vertex[leftAxis] * vertex[rightAxis]
    }
    field[vertexIndex] = amplitude
  }
  return field
}

/**
 * Analyze a 16-vertex field into its six degree-two Walsh coefficients.
 * @param field - Vertex amplitudes in `VERTICES` order; absent or non-finite entries are zero.
 * @returns Six coefficients in `PLANE_ORDER`.
 */
export function analyze6(field: ArrayLike<number> | null | undefined): Coeffs6 {
  const coefficients: Coeffs6 = [0, 0, 0, 0, 0, 0]
  for (const [mode, [leftAxis, rightAxis]] of PLANE_ORDER.entries()) {
    let total = 0
    for (const [vertexIndex, vertex] of VERTICES.entries()) {
      total += finiteOrZero(field?.[vertexIndex]) * vertex[leftAxis] * vertex[rightAxis]
    }
    coefficients[mode] = total / 16
  }
  return coefficients
}

/**
 * Report the codec's authority status.
 * @returns Always `false`; this arithmetic is a readout and grants no permission.
 */
export function walshGrantsAuthority(): false {
  return false
}
