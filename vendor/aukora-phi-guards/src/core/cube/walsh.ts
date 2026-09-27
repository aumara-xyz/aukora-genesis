// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * core/cube/walsh.ts — THE EXACT REVERSIBLE READOUT. Phase 1, and phase 1 only.
 *
 * The six SO(4) rotation planes are also exactly the six degree-2 Walsh modes of a 16-vertex
 * tesseract. So six numbers and a 6-dimensional subspace of the vertex field are the same thing, and
 * you can go both ways without losing anything:
 *
 *     F(v)  = c_xy·xy + c_xz·xz + c_yz·yz + c_xw·xw + c_yw·yw + c_zw·zw
 *     c_ij  = (1/16) Σ_v F(v)·v_i·v_j
 *
 * Measured on the frozen vertex order below: orthonormality error 0, round-trip 8.9e-16, Parseval gap
 * 1.4e-14. `test/cube-walsh.test.ts` re-measures all three here rather than trusting the figures.
 *
 * PURE. No clock, no IO, no chain, no imports. It is arithmetic over sixteen numbers.
 *
 * ══ THREE THINGS THIS IS NOT — each refuted by measurement, each pinned by test ══
 *
 * 1. THE SIX ANGLES ARE **NOT bivector coefficients**. `rotate4` applies six ORDERED Givens rotations;
 *    the measured Frobenius distance from exp(the same coefficients) is 1.103 at moderate angles, and
 *    agreement is first-order only (1.5e-6 at ε=1e-3). This is an exact codec of SIX NUMBERS. It is
 *    not an algebraic identity and nothing here may be read as one.
 *
 * 2. THERE ARE **NOT six natural pitches**. All six degree-2 modes share Laplacian eigenvalue 4
 *    (multiplicities 1,4,6,4,1 at eigenvalues 0,2,4,6,8). There is ONE FUNDAMENTAL and six spatial
 *    patterns. Any six-pitch spread is an ARTISTIC MAPPING and must wear that badge — the observatory
 *    already carries the precedent for what a badge like that costs to earn.
 *
 * 3. EQUIVARIANCE IS **B4** — signed axis permutations — **NOT SO(4)**. A general rotation does not
 *    act on the 16-vertex function space at all. The smaller sentence is the true one.
 *
 * ══ AND THE ONE THAT MATTERS MOST ══
 *
 *     [B_xw, B_yw]  =  ± B_xy          THE SIGN IS A CONVENTION. THE NON-ZERO IS NOT.
 *
 * MEASURED, NOT ASSUMED, AND THE CONVENTION IS PART OF THE STATEMENT. Under the generator convention
 * used throughout this module and its test —
 *
 *     (B_ij)_ab  =  δ_ia·δ_jb − δ_ib·δ_ja
 *
 * — the measurement gives [B_xw, B_yw] = −B_xy, and [B_xy, B_xz] = −B_yz. One global sign, consistent
 * across both, so it is a choice of convention (or of [A,B] against [B,A]) and NOT a disagreement
 * about the mathematics. #150 states these with the opposite sign; both are right, under their own
 * convention, and neither is right without one.
 *
 * SO DO NOT READ THE SIGN AS THE CLAIM. A future reader who flips the convention will correctly write
 * the other sign, and nothing about this module changes. WHAT MUST NEVER CHANGE IS THE MAGNITUDE:
 * the bracket is NON-ZERO and lies in the STANDING triad, with no breath component surviving. If a
 * refactor ever makes that bracket vanish, the geometry has been broken, whatever sign is written.
 *
 * COMPOSING TWO BREATH ROTATIONS DEPOSITS A STANDING ROTATION. Breath is not a subalgebra: presence,
 * composed with itself, writes biography — through pure geometry, with no code doing anything wrong.
 *
 * It is safe today ONLY because the rotor is stateless and recomputes from fresh angles every frame.
 * That is safe by accident, not by rule. NO MODULE MAY PERSIST A COMPOSED ROTATION, SPIN PAIR OR
 * DUAL-VOICE VALUE ACROSS FRAMES — the moment one is cached, transient conversation begins writing
 * permanent posture and every existing isolation test still passes. Pinned structurally in
 * `test/cube-walsh.test.ts`.
 *
 * ══ BUS ══
 *
 * CUBE/WALSH. Only ACTION/STANDING may move biography; this bus never does. Zeta Truth Audio is
 * byte-pinned and untouched by anything here, and if the cube ever earns a published mapping it gets
 * its own name — `docs/HARP-MAPPING.md` is a separate, separately versioned document.
 */

/** The plane order, frozen. Identical to `surface/app/aura/rotor.js` PLANES; a test asserts it. */
export const PLANE_ORDER: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0, 1], [0, 2], [1, 2],   // xy · xz · yz — standing
  [0, 3], [1, 3], [2, 3],   // xw · yw · zw — breath
]);

/** Human names for the six coefficients, in `PLANE_ORDER`. */
export const MODE_NAMES: readonly string[] = Object.freeze(['xy', 'xz', 'yz', 'xw', 'yw', 'zw']);

/** The vertex order, frozen. Identical to `rotor.js` TESSERACT_VERTICES; a test asserts it. */
export const VERTICES: ReadonlyArray<readonly [number, number, number, number]> = Object.freeze(
  Array.from({ length: 16 }, (_, i): readonly [number, number, number, number] => Object.freeze([
    (i & 1) ? 1 : -1,
    (i & 2) ? 1 : -1,
    (i & 4) ? 1 : -1,
    (i & 8) ? 1 : -1,
  ] as [number, number, number, number])),
);

export type Coeffs6 = [number, number, number, number, number, number];
export type Field16 = number[];

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Plain inner product on the 16 vertices. Exported so a test can check orthonormality itself. */
export function dot16(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < 16; i += 1) s += num(a[i]) * num(b[i]);
  return s;
}

/**
 * SYNTHESIS — six numbers to a 16-vertex field.
 *
 * Never throws; a missing or malformed coefficient is zero, because a field with a NaN in it would
 * poison every downstream reading silently.
 */
export function synth6(c: ArrayLike<number> | null | undefined): Field16 {
  const out: Field16 = new Array(16).fill(0);
  for (let vi = 0; vi < 16; vi += 1) {
    const v = VERTICES[vi]!;
    let f = 0;
    for (let m = 0; m < 6; m += 1) {
      const [i, j] = PLANE_ORDER[m]!;
      f += num(c?.[m]) * v[i]! * v[j]!;
    }
    out[vi] = f;
  }
  return out;
}

/**
 * ANALYSIS — a 16-vertex field back to six numbers.
 *
 * EXACT on the codec subspace and SILENTLY ANNIHILATING outside it. That second half is not a flaw to
 * work around, it is the reason field-domain processing is display-only: squaring a field leaked RMS
 * 40.9 outside the subspace and this function threw all of it away without a word. Anything that has
 * been through a nonlinearity must not be read back as coefficients.
 */
export function analyze6(f: ArrayLike<number> | null | undefined): Coeffs6 {
  const out: Coeffs6 = [0, 0, 0, 0, 0, 0];
  for (let m = 0; m < 6; m += 1) {
    const [i, j] = PLANE_ORDER[m]!;
    let s = 0;
    for (let vi = 0; vi < 16; vi += 1) {
      const v = VERTICES[vi]!;
      s += num(f?.[vi]) * v[i]! * v[j]!;
    }
    out[m] = s / 16;
  }
  return out;
}

/** A codec is a readout of a record. It is not a permission and never has been. */
export function walshGrantsAuthority(): false {
  return false;
}
