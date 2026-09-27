// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA HARP MATH — the Riemann-Siegel term engine, computed and only
// computed. Implements docs/zeta-harp/MATH_SPEC.md exactly; the spec is the
// law and this file is its executable half. theta comes from the house
// engine (luminara-zeta.js) so the asymptotic series has one home; the
// derivative, the cutoff, the term anatomy, the main sum, the leading
// correction with its guard, and the Gram solver live here because the
// house engine never needed them before this instrument.
//
// WHAT IS COMPUTED AND WHAT IS CHOSEN. Everything in this module is
// computed: checkable against DLMF 25.10 and against the committed
// fixtures (spatial/app/harp-fixtures.json, mpmath at 80 digits). The one
// numerical policy is the Psi guard (below), whose trigger and stencil are
// declared constants, pinned against fixtures rather than trusted.
//
// Pure module: numbers in, numbers out. No DOM, no state, no randomness.

import { theta } from './luminara-zeta.js';

export { theta };
export const TAU = 2 * Math.PI;

/** N(t) = floor(sqrt(t / 2pi)): how many terms are active at height t. */
export const countOf = (t) => Math.floor(Math.sqrt(t / TAU));

/** t_n = 2pi n^2: the height at which term n enters the sum. A height,
 *  never a frequency; the claim boundary holds that line by pin. */
export const entryHeight = (n) => TAU * n * n;

/** theta'(t): the term-by-term derivative of the same asymptotic series
 *  the house theta uses, so the pair cannot drift apart. */
export function thetaPrime(t) {
  const t2 = t * t;
  return 0.5 * Math.log(t / TAU)
    - 1 / (48 * t2) - 21 / (5760 * t2 * t2)
    - 155 / (80640 * t2 * t2 * t2) - 889 / (430080 * t2 * t2 * t2 * t2);
}

/** omega_n(t) = theta'(t) - log n, radians per unit t; f_n = omega / 2pi.
 *  Strictly positive inside the cutoff; ~0 exactly at the entry height. */
export const omegaOf = (t, n) => thetaPrime(t) - Math.log(n);

// log n cached once; the sum at t = 10^8 walks 3,989 of these per call
let LOGN = new Float64Array(0);
function logsUpTo(N) {
  if (LOGN.length >= N + 1) return LOGN;
  const next = new Float64Array(N + 1);
  next.set(LOGN);
  for (let n = Math.max(1, LOGN.length); n <= N; n++) next[n] = Math.log(n);
  LOGN = next;
  return LOGN;
}

/** The active ensemble at height t: amplitudes, phases, angular velocities.
 *  This is the state vector every representation of the instrument is a
 *  projection of. */
export function termsOf(t) {
  const N = countOf(t);
  const th = theta(t);
  const thp = thetaPrime(t);
  const logs = logsUpTo(N);
  const a = new Float64Array(N + 1);
  const phi = new Float64Array(N + 1);
  const omega = new Float64Array(N + 1);
  for (let n = 1; n <= N; n++) {
    a[n] = 2 / Math.sqrt(n);
    phi[n] = th - t * logs[n];
    omega[n] = thp - logs[n];
  }
  return { t, N, theta: th, thetaPrime: thp, a, phi, omega };
}

/** M(t): the Riemann-Siegel main sum. mask, if given, is called with n and
 *  keeps the term when it returns true (the solo and mute laws upstream). */
export function mainSum(t, mask) {
  const N = countOf(t);
  const th = theta(t);
  const logs = logsUpTo(N);
  let s = 0;
  for (let n = 1; n <= N; n++) {
    if (mask && !mask(n)) continue;
    s += 2 * Math.cos(th - t * logs[n]) / Math.sqrt(n);
  }
  return s;
}

// --- the leading correction, with its guard --------------------------------
// Psi(p) = cos(2pi(p^2 - p - 1/16)) / cos(2pi p) has removable 0/0 points
// at p = 1/4 and p = 3/4. Near them the division is poison, so within
// PSI_GUARD of a vanishing denominator the value is taken as the symmetric
// average at PSI_STEP, exact to second order across a removable
// singularity. Both constants are declared here and pinned against the
// fixtures' near-singularity samples.
export const PSI_GUARD = 1e-4;
export const PSI_STEP = 1e-3;

function psiRaw(p) {
  return Math.cos(TAU * (p * p - p - 1 / 16)) / Math.cos(TAU * p);
}

export function psi(p) {
  if (Math.abs(Math.cos(TAU * p)) < PSI_GUARD) {
    return (psiRaw(p - PSI_STEP) + psiRaw(p + PSI_STEP)) / 2;
  }
  return psiRaw(p);
}

/** C0(t): the leading Riemann-Siegel correction. M + C0 has error
 *  O(t^(-3/4)) against the true Z, demonstrated in the fixtures. */
export function C0(t) {
  const x = Math.sqrt(t / TAU);
  const N = Math.floor(x);
  const sign = (N - 1) % 2 === 0 ? 1 : -1;
  return sign * Math.pow(t / TAU, -0.25) * psi(x - N);
}

/** The browser's best Z: main sum plus leading correction. Labelled
 *  BROWSER wherever shown; never presented as exact Z. */
export const zApprox = (t) => mainSum(t) + C0(t);

// --- Gram points -----------------------------------------------------------
/** g_k solves theta(g) = k pi. Newton from the asymptotic inverse, safe
 *  because theta is monotone increasing for t >= 10 (theta' > 0 there). */
export function gramPoint(k) {
  const target = k * Math.PI;
  // asymptotic seed: theta ~ (t/2) log(t/2pie), inverted by iteration
  let g = Math.max(18, TAU * Math.exp(1) * Math.exp(lambertW(target <= 0 ? 0.1 : target / (Math.PI * Math.E))));
  if (!Number.isFinite(g) || g < 18) g = 18;
  for (let i = 0; i < 60; i++) {
    const err = theta(g) - target;
    const step = err / thetaPrime(g);
    g -= step;
    if (Math.abs(step) < 1e-12 * Math.max(1, g)) break;
    if (g < 10) g = 10;
  }
  return g;
}

// Lambert W by Newton, principal branch, for the Gram seed only
function lambertW(x) {
  let w = x < 1 ? x : Math.log(x);
  for (let i = 0; i < 40; i++) {
    const ew = Math.exp(w);
    const next = w - (w * ew - x) / (ew * (w + 1));
    if (Math.abs(next - w) < 1e-14) return next;
    w = next;
  }
  return w;
}

// --- the truth-audio wavetable ---------------------------------------------
/** The exact main sum sampled on a uniform t-grid over [t0, t1], for
 *  playback at rate v_t (units of t per second). The samples are M(t)
 *  itself, so the audio IS the mathematics resampled; the per-term audible
 *  frequency is v_t (theta' - log n) / 2pi by the chain rule, and the pin
 *  checks the realised spectrum against that law. mask as in mainSum.
 *
 *  gridPerUnit must exceed twice the fastest frequency per unit t
 *  (theta'/2pi at the window top); the caller passes it explicitly and the
 *  function refuses undersampling rather than aliasing silently. */
export function waveTable(t0, t1, gridPerUnit, mask) {
  const fMax = thetaPrime(t1) / TAU;
  if (gridPerUnit < 2.5 * fMax) {
    throw new Error('waveTable: grid ' + gridPerUnit + '/unit undersamples fMax '
      + fMax.toFixed(4) + '/unit; refusing to alias');
  }
  const count = Math.max(2, Math.ceil((t1 - t0) * gridPerUnit));
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = mainSum(t0 + (i * (t1 - t0)) / (count - 1), mask);
  }
  return out;
}

// --- the 26 window, exact --------------------------------------------------
export const WINDOW26 = { lo: TAU * 676, hi: TAU * 729 };
