// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Pure field-driven deformation of the canonical Aura tesseract vertices. */

import { TESSERACT_VERTICES, type Point4 } from './rotor.ts'
import { synth6 } from './walsh.ts'

/** Maximum fractional radial displacement from a canonical vertex. */
export const AURA_DEFORMATION_LIMIT = 0.34

/** Walsh-field magnitude producing the fixed deformation response scale. */
export const AURA_DEFORMATION_RESPONSE = 1

function responseOf(amplitude: number): number {
  return Number.isNaN(amplitude)
    ? 0
    : Math.tanh(amplitude / AURA_DEFORMATION_RESPONSE)
}

/**
 * Deform the canonical tesseract through its six ordered Aura coefficients.
 *
 * The existing Walsh synthesis assigns one amplitude `f(v)` to every vertex.
 * Each vertex moves only along its radial line by
 * `1 + AURA_DEFORMATION_LIMIT * tanh(f(v) / AURA_DEFORMATION_RESPONSE)`.
 * Antipodal vertices share one Walsh amplitude, so they remain exact opposites
 * and preserve the origin-centered figure. Positive scale bounds retain the
 * canonical vertex order and edge topology.
 *
 * @param coefficients - `xy, xz, yz, xw, yw, zw`; missing or non-finite values are zero.
 * @returns sixteen finite four-dimensional points in canonical vertex order.
 */
export function deformTesseract(
  coefficients: ArrayLike<number> | null | undefined,
): Point4[] {
  const field = synth6(coefficients)
  return TESSERACT_VERTICES.map((vertex, index) => {
    const scale = 1 + AURA_DEFORMATION_LIMIT * responseOf(field[index] ?? 0)
    return [
      vertex[0] * scale,
      vertex[1] * scale,
      vertex[2] * scale,
      vertex[3] * scale,
    ]
  })
}
