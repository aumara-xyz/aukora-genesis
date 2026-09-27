// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * core/cube/duality.ts — THE TWO-VOICE READOUT, and why it may never be stored.
 *
 * so(4) ≅ su(2) ⊕ su(2) is real, and on this frozen plane order the Hodge star pairings hold exactly,
 * with ⋆² = +1 under orientation xyzw:
 *
 *     ⋆(xy) = zw        ⋆(xz) = −yw        ⋆(yz) = xw
 *
 * From that, two 3-vectors — the self-dual and anti-self-dual halves — and one true sentence:
 *
 *     AT REST THE LEFT AND RIGHT VOICES ARE IDENTICAL. Unison.
 *     BREATH IS EXACTLY THEIR ANTISYMMETRIC DIVERGENCE.
 *
 * Both are measured in `test/cube-walsh.test.ts` rather than asserted here.
 *
 * ══ COMPUTED PER FRAME, NEVER STORED — AND THIS IS THE LOAD-BEARING RULE ══
 *
 * The ± basis MIXES THE GOVERNANCE SPLIT. Measured: pure breath [0,0,0,1,1,1] acquires a nonzero
 * component in EVERY standing slot. That is legitimate as a per-frame readout — it is what the
 * decomposition means — and it is forbidden as storage, because a stored voice is standing that
 * arrived through presence.
 *
 * The same hazard has a second, sharper form:
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
 * COMPOSING TWO BREATH ROTATIONS DEPOSITS A STANDING ROTATION. Breath is not a subalgebra. Presence,
 * composed with itself, writes biography — through pure geometry, with no code doing anything wrong.
 * Today the rotor is stateless and recomputes every frame, so nothing composes; that is safe by
 * accident rather than by rule, and `test/cube-walsh.test.ts` turns it into a rule by walking these
 * directories for a persisted composed rotation, spin pair or voice.
 *
 * If you are here to make this faster: caching is the one optimisation this file forbids.
 *
 * ══ BUS ══
 *
 * CUBE/WALSH. A readout, never a mover of biography — only ACTION/STANDING may do that.
 */

import type { Coeffs6 } from './walsh';

/** What the voices are, in words, so a surface cannot quote them as state. */
export const VOICE_LABELS = Object.freeze({
  left: 'self-dual voice — a per-frame readout, never stored',
  right: 'anti-self-dual voice — a per-frame readout, never stored',
});

export type Triad = [number, number, number];

export interface Voices {
  /** Self-dual half. Equal to `right` exactly when breath is at rest. */
  left: Triad;
  /** Anti-self-dual half. */
  right: Triad;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The Hodge star on the frozen plane order: ⋆(xy)=zw, ⋆(xz)=−yw, ⋆(yz)=xw, and ⋆²=+1.
 *
 * Written as an explicit permutation-with-signs rather than a matrix, because the sign on `xz↔yw` is
 * the one a reader will doubt and it should be visible on one line.
 */
export function starOf(c: ArrayLike<number> | null | undefined): Coeffs6 {
  // `+ 0` normalises negative zero. `-g(4)` on an absent coefficient is `-0`, which is a different
  // value from `0` to `Object.is` and to a deep-equality check — so two identical readouts would
  // compare unequal. Caught by this module's own first test run, and the same normalisation the
  // renderer already needed for rest.
  const g = (i: number) => num(c?.[i]);
  //        xy         xz             yz         xw         yw             zw
  return [g(5) + 0, -g(4) + 0, g(3) + 0, g(2) + 0, -g(1) + 0, g(0) + 0];
}

/**
 * The two voices, computed fresh.
 *
 * `left = (c + ⋆c)/2`, `right = (c − ⋆c)/2`, each read in the standing slots — which is what makes
 * them 3-vectors rather than six numbers each, and what makes unison at rest a statement you can see.
 *
 * NEVER THROWS, and never holds anything: there is no module state in this file at all, deliberately.
 */
export function voices(c: ArrayLike<number> | null | undefined): Voices {
  const g = (i: number) => num(c?.[i]);
  const s = starOf(c);
  return {
    left: [(g(0) + s[0]) / 2, (g(1) + s[1]) / 2, (g(2) + s[2]) / 2],
    right: [(g(0) - s[0]) / 2, (g(1) - s[1]) / 2, (g(2) - s[2]) / 2],
  };
}

/** A voice is a readout of a record. It is not a permission and never has been. */
export function dualityGrantsAuthority(): false {
  return false;
}
