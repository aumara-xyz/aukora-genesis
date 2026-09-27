// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE SPECTRUM — the zeros of the zeta function, computed, and given knots.
//
// WHAT IS COMPUTED AND WHAT IS CHOSEN. This distinction is the whole
// discipline of this module, and it is drawn here once, plainly:
//
//   COMPUTED (nobody's opinion, checkable against the literature):
//     - zeta on the critical line, by the Dirichlet eta series with
//       Cohen-Rodriguez-Villegas-Zagier acceleration, validated for
//       heights up to t = 683 and refused beyond (see MAX_TERMS);
//     - the Riemann-Siegel theta function, by its asymptotic series;
//     - the Hardy function Z(t), which is REAL on the critical line, so its
//       sign changes locate zeros exactly and bisection refines them;
//     - the normalised spacings of those zeros, and their comparison with
//       the GUE and Poisson laws.
//   CHOSEN (a design decision of this work, and labelled as such wherever
//   it is shown):
//     - the map from a zero to a torus knot. There is no canonical such
//       map. The one used here is declared in knotOfZero below and uses
//       machinery this work already derived, but it remains a choice.
//
// WHY ZEROS AT ALL. The explicit formula reconstructs the primes from the
// zeros: each zero is a frequency, and the prime staircase is the chord they
// sound together. That is the Nodus's first law holding in arithmetic: a
// mode is named by its nulls. The functional equation is an involution whose
// fixed line is the critical line, and the Riemann hypothesis is the claim
// that every null stands on the mirror. Recorded as convergence, never as
// authority: no theorem here is imported into the deck, and nothing the deck
// says is offered as evidence about the zeros.
//
// The physics is not decoration either. Montgomery and Odlyzko found the
// zeros repel one another with the statistics of the Gaussian Unitary
// Ensemble, the same law that governs the energy levels of heavy nuclei.
// The spectrum computed here is drawn as a level diagram for that reason.
// That the zeros ARE the spectrum of some self-adjoint operator is the
// Hilbert-Polya conjecture, and it is a conjecture; this module claims only
// what it computes.

const TAU = 2 * Math.PI;

// --- zeta on the critical line ---------------------------------------------
// eta(s) = sum (-1)^k (k+1)^-s converges for Re(s) > 0 and is accelerated by
// the CRVZ weights, whose error falls like (3 + sqrt 8)^-n. zeta = eta over
// (1 - 2^(1-s)). The weights depend only on the term count, so they are
// built once per count and cached.
const weightCache = new Map();

// The same (3 + sqrt 8)^n that makes the error fall makes the weights grow,
// and they leave IEEE double range at n = 401 (measured, not estimated).
// termsFor first asks for 401 terms at t = 684, so the validated range is
// |t| <= 683; zetaCritical refuses beyond it rather than answering NaN.
const MAX_TERMS = 400;

function crvzWeights(n) {
  const hit = weightCache.get(n);
  if (hit) return hit;
  // c_0 = 1/n and c_{i+1} = c_i * 4(n+i)(n-i) / ((2i+2)(2i+1)); d_k = n * sum c_i
  const d = new Float64Array(n + 1);
  let c = 1 / n, run = 0;
  for (let i = 0; i <= n; i++) {
    run += c;
    d[i] = n * run;
    c = c * (4 * (n + i) * (n - i)) / ((2 * i + 2) * (2 * i + 1));
  }
  weightCache.set(n, d);
  return d;
}

// How many terms the acceleration needs. The series oscillates faster as t
// grows, so the count is lifted with height; the tests pin the accuracy this
// actually delivers rather than trusting the rule.
export const termsFor = (t) => Math.max(32, Math.ceil(24 + 0.55 * Math.abs(t)));

/** zeta(1/2 + it) as [re, im]. */
export function zetaCritical(t) {
  const n = termsFor(t);
  if (n > MAX_TERMS) {
    throw new RangeError('zetaCritical: t = ' + t + ' needs ' + n
      + ' acceleration terms and the CRVZ weights overflow doubles past '
      + MAX_TERMS + '; validated for |t| <= 683 only');
  }
  const d = crvzWeights(n);
  const dn = d[n];
  let re = 0, im = 0;
  for (let k = 0; k < n; k++) {
    // (k+1)^(-1/2 - it) = (k+1)^(-1/2) * exp(-i t ln(k+1))
    const mag = Math.pow(k + 1, -0.5);
    const ph = -t * Math.log(k + 1);
    // the CRVZ weight is the tail (dn - d[k]) / dn, in that order: the
    // orientation carries the sign of eta itself, and every downstream
    // consumer of |Z| is blind to it, so the tests pin Z's signed values
    const w = ((k % 2 === 0) ? 1 : -1) * (dn - d[k]) / dn;
    re += w * mag * Math.cos(ph);
    im += w * mag * Math.sin(ph);
  }
  // divide by (1 - 2^(1-s)), s = 1/2 + it  =>  2^(1-s) = sqrt2 * exp(-i t ln2)
  const a = Math.SQRT2 * Math.cos(t * Math.LN2);
  const b = -Math.SQRT2 * Math.sin(t * Math.LN2);
  const dr = 1 - a, di = -b;
  const den = dr * dr + di * di;
  return [(re * dr + im * di) / den, (im * dr - re * di) / den];
}

/** The Riemann-Siegel theta function, asymptotic series (accurate for t >= 10). */
export function theta(t) {
  const t2 = t * t;
  return (t / 2) * Math.log(t / TAU) - t / 2 - Math.PI / 8
    + 1 / (48 * t) + 7 / (5760 * t * t2)
    + 31 / (80640 * t * t2 * t2) + 127 / (430080 * t * t2 * t2 * t2);
}

/** The Hardy function Z(t) = exp(i theta) zeta(1/2 + it). Real on the line, so
 *  its sign changes are zeros of zeta and nothing else is needed to find them. */
export function Z(t) {
  const [re, im] = zetaCritical(t);
  const th = theta(t);
  return Math.cos(th) * re - Math.sin(th) * im;
}

/** Zeros of Z, in order, by sign change then bisection to machine precision.
 *  Returns the imaginary parts (the heights) of the zeros on the critical line. */
export function findZeros(count = 27, { from = 13.5, step = 0.05, refine = 80 } = {}) {
  const out = [];
  let t = from, prev = Z(t);
  while (out.length < count && t < from + 40000) {
    const next = t + step;
    const cur = Z(next);
    if ((prev < 0 && cur > 0) || (prev > 0 && cur < 0)) {
      let lo = t, hi = next, flo = prev;
      for (let i = 0; i < refine; i++) {
        const mid = (lo + hi) / 2, fm = Z(mid);
        if (fm === 0) { lo = hi = mid; break; }
        if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else { hi = mid; }
      }
      out.push((lo + hi) / 2);
    }
    t = next; prev = cur;
  }
  return out;
}

/** Riemann-von Mangoldt: the expected count of zeros with height below T.
 *  Used to check that the search skipped none, rather than assuming it. */
export const expectedCount = (T) => (T / TAU) * Math.log(T / (TAU * Math.E)) + 7 / 8;

// --- the chosen map: a zero becomes a knot ---------------------------------

/** The best rational p/q with q <= maxQ, in lowest terms. Exhaustive over q,
 *  so it is exactly the best by absolute error, not merely a convergent. */
export function bestRational(x, maxQ = 13) {
  let bp = 1, bq = 1, best = Infinity;
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(x * q);
    if (p < 1) continue;
    const err = Math.abs(x - p / q);
    if (err < best - 1e-15) { best = err; bp = p; bq = q; }
  }
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(bp, bq);
  return { p: bp / d, q: bq / d, err: best };
}

/** THE MAPPING, DECLARED.
 *
 *  The explicit formula makes every zero a frequency. So take each zero's
 *  ratio to the fundamental, r = gamma_n / gamma_1, and approximate it by the
 *  best rational p/q whose denominator stays within the deck's own span of
 *  thirteen. T(p, q) is that zero's knot, and the residue |r - p/q| is its
 *  comma: the part of the ratio no whole numbers can say.
 *
 *  Two consequences worth stating because they are properties of the mapping,
 *  not discoveries about the zeros:
 *    - a best rational in lowest terms is coprime, so every zero-knot is a
 *      single strand. Nothing in this spectrum ever locks into rings.
 *    - the comma vanishes only for the fundamental, whose ratio to itself is
 *      exactly one and whose knot is therefore the unknot. Every other zero
 *      leaves a remainder, as the well of the irrational says it must. That
 *      these ratios are irrational is observed here, not proved: it is not
 *      a theorem, and this module does not pretend otherwise.
 */
export function knotOfZero(gamma, fundamental, maxQ = 13) {
  const ratio = gamma / fundamental;
  const { p, q, err } = bestRational(ratio, maxQ);
  // written in the deck's own order, so a perfect fifth reads 3:2
  return { gamma, ratio, p, q, comma: err, interval: p + ':' + q };
}

// --- the spectrum as a spectrum --------------------------------------------

/** Unfold the spectrum: divide each gap by the local mean gap, so the
 *  spacings have mean one at every height and heights become comparable.
 *  The local density of zeros at height t is log(t / 2pi) / 2pi. */
export function normalisedSpacings(zeros) {
  const out = [];
  for (let i = 0; i < zeros.length - 1; i++) {
    const density = Math.log(zeros[i] / TAU) / TAU;
    out.push((zeros[i + 1] - zeros[i]) * density);
  }
  return out;
}

/** The Wigner surmise for the Gaussian Unitary Ensemble: the spacing law of
 *  heavy nuclei, and the law the zeros are observed to follow. Note P(0) = 0:
 *  levels repel, they do not fall where they like. */
export const gue = (s) => (32 / (Math.PI * Math.PI)) * s * s * Math.exp(-4 * s * s / Math.PI);

/** Poisson: what the spacings would look like if the zeros ignored each
 *  other. Shown only for contrast. P(0) = 1: no repulsion at all. */
export const poisson = (s) => Math.exp(-s);

/** Bin spacings into a histogram on [0, hi], normalised to a density. */
export function histogram(values, bins = 24, hi = 3) {
  const h = new Array(bins).fill(0);
  let kept = 0;
  for (const v of values) {
    if (v < 0 || v >= hi) continue;
    h[Math.floor((v / hi) * bins)]++;
    kept++;
  }
  const w = hi / bins;
  return { bins: h.map((c) => (kept ? c / (kept * w) : 0)), width: w, kept };
}

/** THE CHORD: Riemann's explicit formula, the room's opening claim made
 *  computable. The Chebyshev staircase psi(x) counts the primes with their
 *  powers, each step log p; the formula rebuilds it from the zeros alone:
 *    psi(x) = x - sum over zeros - log 2pi - (1/2) log(1 - x^-2)
 *  where each conjugate pair rho = 1/2 +- i gamma contributes
 *    sqrt(x) (cos(g L) + 2 g sin(g L)) / (1/4 + g^2),  L = ln x.
 *  Nothing fitted: the staircase from the sieve, the rebuild from the zeros,
 *  and the distance between them is exactly the truncation. */
export function chebyshevSteps(X = 100) {
  const isP = new Array(X + 1).fill(true);
  isP[0] = isP[1] = false;
  for (let i = 2; i * i <= X; i++) if (isP[i]) for (let j = i * i; j <= X; j += i) isP[j] = false;
  const steps = [];
  for (let p = 2; p <= X; p++) {
    if (!isP[p]) continue;
    for (let q = p; q <= X; q *= p) steps.push({ x: q, logp: Math.log(p), prime: q === p });
  }
  steps.sort((a, b) => a.x - b.x);
  let acc = 0;
  return steps.map((s) => ({ x: s.x, psi: (acc += s.logp), prime: s.prime }));
}

export function psiFromZeros(x, zeros, m = zeros.length) {
  if (x <= 1) return 0;
  const L = Math.log(x), sx = Math.sqrt(x);
  let s = x - Math.log(TAU) - 0.5 * Math.log(1 - 1 / (x * x));
  const n = Math.min(m, zeros.length);
  for (let i = 0; i < n; i++) {
    const g = zeros[i];
    s -= sx * (Math.cos(g * L) + 2 * g * Math.sin(g * L)) / (0.25 + g * g);
  }
  return s;
}

/** MONTGOMERY'S PAIR CORRELATION: every pair now, not only the neighbours.
 *  The zeros are unfolded by the counting law so the mean gap is one, then
 *  every gap between every pair is binned. The predicted density is the
 *  sine kernel, 1 - (sin pi x / pi x)^2: the curve Dyson recognised over
 *  tea in 1972, the same statistic the eigenvalues of random Hermitian
 *  matrices obey. The theorem is asymptotic; at the heights this page can
 *  afford, the first bins fall short of the kernel, and that shortfall is
 *  the finite height showing, kept visible rather than smoothed. */
export const sineKernel = (x) => {
  if (x === 0) return 0;
  const s = Math.sin(Math.PI * x) / (Math.PI * x);
  return 1 - s * s;
};

export function pairCorrelation(zeros, { hi = 3, bins = 12 } = {}) {
  const x = zeros.map(expectedCount);
  const counts = new Array(bins).fill(0);
  let kept = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const d = x[j] - x[i];
      if (d >= hi) break;
      counts[Math.floor((d / hi) * bins)]++;
      kept++;
    }
  }
  const w = hi / bins;
  return { density: counts.map((c) => c / (zeros.length * w)), width: w, pairs: kept };
}
