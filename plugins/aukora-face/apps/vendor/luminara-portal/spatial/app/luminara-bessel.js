// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA BESSEL: the plate's own mathematics, exact. The sand plate began
// on a scaffold (sin(mπr), even rings, a rim nailed still) and its header
// said so honestly. This module replaces the scaffold with the disc's real
// modes so the figures are modelled on real cymatics:
//
//   · J_n evaluated by Miller's downward recurrence with the standard
//     normalisation identity: good to ~1e-10 over the orders and arguments
//     the canon uses (n ≤ 13, x ≤ 60).
//   · j'_{n,m}, the m-th positive zero of J_n' : the FREE-EDGE radial
//     wavenumbers. A real Chladni plate is free at its rim, the rim is an
//     antinode, and the nodal lines curve out to MEET the edge: the
//     signature of every real sand figure. For n = 0 the identity
//     J_0' = −J_1 gives the extrema exactly; for n ≥ 1 each extremum is
//     bracketed between consecutive zeros of J_n and bisected on the
//     derivative.
//   · radialProfile(n, m): J_n(j'_{n,m} · r) sampled to a table on [0, 1],
//     normalised to unit peak so mode weights keep their old meaning.
//
// THE HELD DOOR, named: a rigid plate obeys the biharmonic equation, its
// modes mix J_n with the modified I_n under a Poisson ratio, and its
// frequencies run with k² rather than k. That rung is real and unclimbed:
// it changes pitch ratios, which are pinned canon (voiceOf), so it joins
// only by a ruling, never by a renderer. The free-edge membrane below is
// exact physics with the true rim behaviour, and every number is computed,
// none tuned.

import { besselZero } from './luminara-sound.js';

// J_n(x) by Miller's downward recurrence, normalised by J_0 + 2·ΣJ_2k = 1.
export function besselJ(n, x) {
  if (x === 0) return n === 0 ? 1 : 0;
  if (x < 0) return (n % 2 ? -1 : 1) * besselJ(n, -x);
  const M = 2 * Math.ceil((n + Math.ceil(x) + 24) / 2);   // even start, safe margin
  let jp = 0, jc = 1e-30, norm = 0, out = 0;
  for (let k = M; k >= 0; k--) {
    const jm = (2 * (k + 1) / x) * jc - jp;
    jp = jc; jc = jm;
    if (k > 0 && k % 2 === 0) norm += 2 * jc;
    if (k === n) out = jc;
    // rescale to keep the recurrence finite
    if (Math.abs(jc) > 1e10) { jc *= 1e-10; jp *= 1e-10; norm *= 1e-10; out *= 1e-10; }
  }
  norm += jc;   // k = 0 term
  return out / norm;
}

const dJ = (n, x) => (n === 0 ? -besselJ(1, x) : (besselJ(n - 1, x) - besselJ(n + 1, x)) / 2);

// j'_{n,m}: the m-th positive zero of J_n', the free rim's own wavenumbers.
export function besselPrimeZero(n, m) {
  if (n === 0) return besselZero(1, m);          // J_0' = −J_1, exactly
  // the m-th extremum of J_n lies between its (m−1)-th and m-th zeros,
  // with "zeroth zero" the origin (J_n(0) = 0 for n ≥ 1)
  let lo = m === 1 ? 1e-6 : besselZero(n, m - 1) + 1e-6;
  let hi = besselZero(n, m) - 1e-6;
  let flo = dJ(n, lo);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2, f = dJ(n, mid);
    if ((f > 0) === (flo > 0)) { lo = mid; flo = f; } else hi = mid;
  }
  return (lo + hi) / 2;
}

// the radial law of one free-edge mode, tabulated: T[i] = J_n(j'·r_i) / peak
const PROFILE_LEN = 256;
const profileCache = new Map();
export function radialProfile(n, m) {
  const key = n + ':' + m;
  let T = profileCache.get(key);
  if (T) return T;
  const jp = besselPrimeZero(n, Math.max(1, m));
  T = new Float32Array(PROFILE_LEN);
  let peak = 0;
  for (let i = 0; i < PROFILE_LEN; i++) {
    const v = besselJ(n, (jp * i) / (PROFILE_LEN - 1));
    T[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0) for (let i = 0; i < PROFILE_LEN; i++) T[i] /= peak;
  profileCache.set(key, T);
  return T;
}

// sample a profile at radius r ∈ [0, 1+], linear between table stops
export function profileAt(T, r) {
  const x = Math.max(0, Math.min(1, r)) * (PROFILE_LEN - 1);
  const i = x | 0, f = x - i;
  return i >= PROFILE_LEN - 1 ? T[PROFILE_LEN - 1] : T[i] * (1 - f) + T[i + 1] * f;
}
