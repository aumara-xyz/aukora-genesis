// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Pure tesseract geometry, ordered 4D rotation, and deterministic 4D-to-3D projection.
 *
 * Adapted from `aumara-xyz/aukora-phi` commit
 * `a099901ad5a2d623c5343263de6ae5f9994d3159`. The tesseract is a viewing
 * cage for the six Aura planes, not evidence of topology or system authority.
 */

/** One of the four tesseract coordinate axes. */
export type Axis4 = 0 | 1 | 2 | 3

/** Ordered pair of axes defining one Givens rotation. */
export type RotationPlane = readonly [Axis4, Axis4]

/** Mutable four-dimensional point returned by the rotor. */
export type Point4 = [number, number, number, number]

/** Mutable projected three-dimensional point. */
export type Point3 = [number, number, number]

/** Pair of vertex indices defining a tesseract edge. */
export type TesseractEdge = readonly [number, number]

/** One square tesseract face associated with its varying coordinate plane. */
export interface TesseractFace {
  /** Index into the canonical `PLANES` order. */
  planeIndex: number
  /** The two axes that vary around this face. */
  plane: RotationPlane
  /** Four cyclic vertex indices forming the square perimeter. */
  vertices: readonly [number, number, number, number]
}

/** Inputs to one deterministic projected tesseract frame. */
export interface FigureFrameInput {
  /** Canonical-order four-dimensional vertices; defaults to the rigid tesseract. */
  vertices?: ReadonlyArray<ArrayLike<number>>
  /** Data-independent viewing orientation; defaults to `FIGURE_ORIENTATION`. */
  orientation?: ArrayLike<number>
  /** Fourth-axis eye distance; defaults to the canonical `W_DISTANCE`. */
  distance?: number
}

/** Frozen Givens-rotation order: standing `xy, xz, yz`, then breath `xw, yw, zw`. */
export const PLANES: readonly RotationPlane[] = Object.freeze([
  Object.freeze([0, 1] as const),
  Object.freeze([0, 2] as const),
  Object.freeze([1, 2] as const),
  Object.freeze([0, 3] as const),
  Object.freeze([1, 3] as const),
  Object.freeze([2, 3] as const),
])

/** Fixed six-plane orientation used to make the projected cage readable. */
export const FIGURE_ORIENTATION: readonly number[] = Object.freeze([
  0.38,
  -0.32,
  0.2,
  0,
  0,
  0,
])

/** Frozen bit-order enumeration of the sixteen vertices in `{−1,+1}^4`. */
export const TESSERACT_VERTICES: ReadonlyArray<readonly [number, number, number, number]> = Object.freeze(
  Array.from({ length: 16 }, (_, index): readonly [number, number, number, number] => Object.freeze([
    (index & 1) === 0 ? -1 : 1,
    (index & 2) === 0 ? -1 : 1,
    (index & 4) === 0 ? -1 : 1,
    (index & 8) === 0 ? -1 : 1,
  ] as const)),
)

/** Thirty-two unique edges joining vertices that differ in exactly one axis. */
export const TESSERACT_EDGES: readonly TesseractEdge[] = Object.freeze((() => {
  const edges: TesseractEdge[] = []
  for (let vertex = 0; vertex < 16; vertex += 1) {
    for (let axis = 0; axis < 4; axis += 1) {
      const neighbor = vertex ^ (1 << axis)
      if (neighbor > vertex) edges.push(Object.freeze([vertex, neighbor] as const))
    }
  }
  return edges
})())

/** Twenty-four square faces: four fixed-coordinate faces for each rotation plane. */
export const TESSERACT_FACES: readonly TesseractFace[] = Object.freeze((() => {
  const axes: readonly Axis4[] = [0, 1, 2, 3]
  const faces: TesseractFace[] = []
  for (const [planeIndex, plane] of PLANES.entries()) {
    const [leftAxis, rightAxis] = plane
    const fixedAxes = axes.filter(axis => axis !== leftAxis && axis !== rightAxis)
    for (let fixedPattern = 0; fixedPattern < 4; fixedPattern += 1) {
      let base = 0
      for (const [offset, axis] of fixedAxes.entries()) {
        if ((fixedPattern & (1 << offset)) !== 0) base |= 1 << axis
      }
      const left = 1 << leftAxis
      const right = 1 << rightAxis
      faces.push(Object.freeze({
        planeIndex,
        plane,
        vertices: Object.freeze([
          base,
          base ^ left,
          base ^ left ^ right,
          base ^ right,
        ] as const),
      }))
    }
  }
  return faces
})())

/** Default eye distance along the fourth axis for perspective projection. */
export const W_DISTANCE = 3

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Rotate a four-dimensional point through all six planes in `PLANES` order.
 * @param point - Four coordinates; absent or non-finite entries are zero.
 * @param angles - Six plane angles; absent or non-finite entries are zero.
 * @returns Length-preserving ordered Givens rotation of the normalized input point.
 */
export function rotate4(
  point: ArrayLike<number> | null | undefined,
  angles: ArrayLike<number> | null | undefined,
): Point4 {
  const rotated: Point4 = [
    finiteOrZero(point?.[0]),
    finiteOrZero(point?.[1]),
    finiteOrZero(point?.[2]),
    finiteOrZero(point?.[3]),
  ]
  for (const [planeIndex, [leftAxis, rightAxis]] of PLANES.entries()) {
    const angle = finiteOrZero(angles?.[planeIndex])
    if (angle === 0) continue
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const left = rotated[leftAxis]
    const right = rotated[rightAxis]
    rotated[leftAxis] = left * cosine - right * sine
    rotated[rightAxis] = left * sine + right * cosine
  }
  return rotated
}

/**
 * Project a four-dimensional point into three dimensions along the fourth axis.
 * @param point - Four coordinates; absent or non-finite entries are zero.
 * @param distance - Eye distance; zero and non-finite values use `W_DISTANCE`.
 * @returns Three finite coordinates with the perspective denominator clamped to `0.25`.
 */
export function project(
  point: ArrayLike<number> | null | undefined,
  distance: number = W_DISTANCE,
): Point3 {
  const resolvedDistance = finiteOrZero(distance) || W_DISTANCE
  const denominator = Math.max(0.25, resolvedDistance - finiteOrZero(point?.[3]))
  const scale = resolvedDistance / denominator
  return [
    finiteOrZero(point?.[0]) * scale,
    finiteOrZero(point?.[1]) * scale,
    finiteOrZero(point?.[2]) * scale,
  ]
}

/**
 * Produce the sixteen projected points of one deterministic Aura frame.
 *
 * The supplied vertices carry system state. The orientation is fixed display
 * geometry and does not change with time or session activity.
 *
 * @param input - Canonical-order vertices plus an optional fixed orientation.
 * @returns Sixteen finite projected points in canonical vertex order.
 */
export function figureFrame(input: FigureFrameInput | null | undefined): Point3[] {
  const normalized: FigureFrameInput = input !== null && typeof input === 'object' ? input : {}
  const vertices = normalized.vertices ?? TESSERACT_VERTICES
  const orientation = normalized.orientation ?? FIGURE_ORIENTATION
  const distance = normalized.distance ?? W_DISTANCE
  return vertices.map(vertex => project(rotate4(vertex, orientation), distance))
}

/**
 * Compute the canonical non-cryptographic digest of a projected frame.
 * @param frame - Projected points; absent or non-finite coordinates are zero.
 * @returns Lowercase FNV-1a digest after coordinate quantization to `1e-9`.
 */
export function frameDigest(
  frame: readonly (ArrayLike<number> | null | undefined)[] | null | undefined,
): string {
  let hash = 0x811c9dc5
  const consume = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }

  for (const point of frame ?? []) {
    for (let axis = 0; axis < 3; axis += 1) {
      consume(`${Math.round(finiteOrZero(point?.[axis]) * 1e9) + 0};`)
    }
    consume('|')
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Report the rotor's authority status.
 * @returns Always `false`; projected geometry grants no permission.
 */
export function rotorGrantsAuthority(): false {
  return false
}
