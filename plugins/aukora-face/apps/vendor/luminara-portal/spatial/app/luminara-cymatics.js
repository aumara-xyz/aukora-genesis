// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA CYMATICS, the bridge (path B, the architect's ruling 2026-07-16):
// the emanation seat (canon emanationOf, D16–D18) rendered as a mode spectrum.
//
// THE MAPPING, the seat as designed, nothing else:
//   · one mode per zone, centre-out (core ring 1 · middle ring 2 · field ring 3)
//   · angular symmetry = the zone's harmonic on the 3·6·9 ladder
//     (still 3 · moving 6 · turning 9): the knot shows the AGGREGATE (p, q);
//     the cymatic shows the COMPOSITION: which layer is still, moving, turning
//   · weight decays golden centre-out: the core is loudest
//   · motion carries the layer's sign (still 0 · moving +1 · turning −1);
//     flow and turning literally counter-rotate in the figure, so a card and
//     its counter are the same figure with every rotation reversed
//   · clarity (the interval's consonance) is the figure's coherence
//   · the Seed alone is unstruck: its latent spectrum is the pure trinity
//     (3·3·3), never sounded: silence, the membrane before any mode
//
// THE CONTRACT (the handoff line): this module is the source of truth for any
// cymatics renderer. coherence-glyph.js is RENDERER ONE (2D canvas analogy,
// runs on every node); Peter's cymatics engine is RENDERER TWO and consumes
// the identical spectrum unchanged. Mode fields {n, m, w, phase} match the
// glyph engine's contract; `motion` and `layer` are canonical extras any
// renderer may use; `drift` is derived for renderer one so that net rotation
// = 0.5 × motion (still zones truly still, turning zones counter-rotating).
//
// Everything here is DERIVED from the sealed canon: nothing stored, nothing
// tuned. The operation meetOf (SEALED by the architect, 2026-07-16) extends
// the counter-involution (D25, layerwise mod-3 negation) to the full group
// law.

import { codeOf, cardOf, emanationOf, knotOf, counterOf } from './luminara-canon.js';

const PHI = 1.6180339887498949;

// the layer's sign, per the knot law: moving +1 · turning −1 · still 0
const signOf = (s) => (s === 1 ? 1 : s === 2 ? -1 : 0);

// motions centre-out [core, middle, field]: the composition the knot hides
export const motionsOf = (n) => {
  const d = codeOf(n);
  return [signOf(d[2]), signOf(d[1]), signOf(d[0])];
};

// ---------------------------------------------------------------------------
// TWO PATHS, ONE SEAT: both derived, the choice open (the architect compares
// on the bench, 2026-07-16). Path B was proposed first; path A joined for the
// comparison after the architect held judgment on B's results.
//
//   PATH A · THE INTERVAL: the figure IS the knot's number. Angular symmetry
//   |q| (the petals through), radial nodes p (the windings around): knot and
//   cymatic become two faces of one number. Link-cards add their REDUCED
//   voice (the resonance-lock law: where the ratio reduces, the strand closes
//   early), so the sevenfold unison shows its plain unison beneath. The whole
//   figure rotates with q's sign: flow forward, turning counter, a card and
//   its counter are one figure spinning opposite ways.
//
//   PATH B · THE COMPOSITION: the emanation seat as designed. One mode per
//   zone centre-out on the 3·6·9 ladder; the knot shows the aggregate, the
//   figure shows which layer is still, moving, turning.
// ---------------------------------------------------------------------------

// cymaticSpectrumA(n) → { modes[1..2], clarity, struck }: path A
export function cymaticSpectrumA(n) {
  const e = emanationOf(n);
  const k = knotOf(n);
  const aq = Math.abs(k.q);
  const sign = k.q > 0 ? 1 : k.q < 0 ? -1 : 0;
  const drift = 0.5 * sign - 0.2;     // renderer one: net rotation = 0.5 × sign(q)
  const modes = [{ n: aq, m: k.p, w: 1, phase: 0, motion: sign, drift }];
  const g = aq === 0 ? 1 : gcdOf(k.p, aq);
  if (g > 1) {
    // the reduced voice: the consonance the lock closes into
    modes.push({ n: aq / g, m: k.p / g, w: 1 / PHI, phase: 0, motion: sign, drift });
  }
  return { card: n, path: 'A', modes, clarity: e.clarity, struck: e.struck };
}
const gcdOf = (a, b) => (b ? gcdOf(b, a % b) : a);

// cymaticSpectrum(n) → { modes[3], clarity, struck }: path B
export function cymaticSpectrum(n) {
  const e = emanationOf(n);
  const motions = motionsOf(n);
  const modes = e.zones.map((z, k) => ({
    n: z.harmonic,                    // 3 · 6 · 9: the ladder as petal count
    m: z.ring,                        // radial node: core innermost
    w: Math.pow(1 / PHI, k),          // golden decay: the core loudest
    phase: 0,                         // derived, never random
    motion: motions[k],               // canonical: the layer's sign
    layer: z.layer,
    // renderer one: net rotation = 0.2 + drift = 0.5 × motion
    drift: 0.5 * motions[k] - 0.2,
  }));
  return { card: n, path: 'B', modes, clarity: e.clarity, struck: e.struck };
}

// one door for renderers: the path is a named choice, never a silent default
export function spectrumOf(n, path) {
  return path === 'A' ? cymaticSpectrumA(n) : cymaticSpectrum(n);
}

// ---------------------------------------------------------------------------
// THE MEET (SEALED by the architect, 2026-07-16): the counter-involution
// extended to the full operation: layerwise mod-3 addition. Under it the
// deck is a group of order 27: the Seed is the identity, every card's inverse
// is its counter (meet of counters = the Seed), and the meeting of ANY two
// cards is a card. Cymatically the counter-pair case is literal wave physics:
// a moving zone (6) superposed with its turning zone (9) shares only their
// common symmetry, gcd(6,9) = 3: the still. Like meeting like (6+6 → 9,
// flow compounding into turning) is the ladder's algebra, not plate physics;
// it is offered as the deck's own suggestion, not a claim.
// ---------------------------------------------------------------------------
export function meetOf(a, b) {
  const da = codeOf(a), db = codeOf(b);
  const d = da.map((x, i) => (x + db[i]) % 3);
  return 9 * d[0] + 3 * d[1] + d[2] + 1;
}

// the kinship of opposites: a card and its counter share their EXACT modes
// precisely at the layers where both are still: opposites are kin exactly
// where they are silent. Derived, testable, and the reason the restless
// cards (all layers moving) meet their counters as total strangers.
export function sharedStillness(n) {
  const m = motionsOf(n);
  return m.filter((x) => x === 0).length;
}

// convenience: everything a renderer needs for one card, in one call
export function cymaticFigure(n) {
  const spec = cymaticSpectrum(n);
  const k = knotOf(n);
  return {
    ...spec,
    name: cardOf(n).name,
    interval: k.interval,
    counter: counterOf(n),
  };
}
