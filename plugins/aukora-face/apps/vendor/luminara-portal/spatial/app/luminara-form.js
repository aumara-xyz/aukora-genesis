// LUMINARA FORM — what each card's knot IS, derived and never interpreted.
//
// The knot map assigns every card a torus knot T(p, q). Standard knot theory
// then determines, from those two integers alone, exactly what kind of form
// it is: an unknot, a link of several strands, or a knot of some genus. This
// module computes that and says it, and stops there.
//
// THE LINE IT DOES NOT CROSS. THE WOUND AND THE CARD establishes a
// correspondence between these forms and the Topology of Healing's account of
// wounds, and Book 2.2's IV.5 carries the theorem. That correspondence is
// real and it is also, in the books' own register, a WAGER: Book 1.1 marks
// the witness instance as a wager stated so it can lose, and its preface
// holds that a rhyme is not a docking. A wager spoken inside a person's own
// reading, in the second person, stops sounding like a wager. So every line
// here speaks the STRAND: how it closes, how many there are, what holds them,
// what joining completes its boundary. None speaks a person, a wound, a
// prognosis, or a permanence. The reader who wants the correspondence has the
// chart and the book; the instrument does not make the leap for them.
//
// Pure module: canon in, description out. No DOM, no state, no randomness.

import { knotOf } from './luminara-canon.js';

const gcd = (a, b) => (b ? gcd(b, Math.abs(a % b)) : Math.abs(a));

// ---------------------------------------------------------------------------
// THE FORM. Three classes, exhaustive over the deck and decided by the winding
// pair alone.
//
//   unknot  p = 1 or |q| <= 1: the strand closes with no crossing to hold.
//   link    gcd(p, |q|) = d > 1: not one strand but d, each a T(p/d, q/d).
//   knot    otherwise: a genuine torus knot, Seifert genus (p-1)(|q|-1)/2.
//
// The sliceness of the knot class is not decided here by inspection: it is
// Kronheimer and Mrowka's theorem that the slice genus of a torus knot equals
// its Seifert genus, so a torus knot of positive genus is never slice. That is
// recorded as a fact about the family, not recomputed per card.
// ---------------------------------------------------------------------------
export function formOf(n) {
  const k = knotOf(n);
  const q = Math.abs(k.q);
  if (k.p === 1 || q <= 1) {
    return { kind: 'unknot', p: k.p, q: k.q, strands: 1, genus: 0, linking: null, slice: true };
  }
  const d = gcd(k.p, q);
  if (d > 1) {
    // every component is T(p/d, q/d); in this deck each of those is an unknot,
    // which the pins check rather than assume. Pairwise linking number is
    // pq/d^2, carrying the sign of q as the deck's own handedness.
    return {
      kind: 'link', p: k.p, q: k.q, strands: d, genus: null,
      linking: (k.p * k.q) / (d * d), slice: null,
      componentsUnknotted: (k.p / d === 1 || Math.abs(k.q / d) <= 1),
    };
  }
  return {
    kind: 'knot', p: k.p, q: k.q, strands: 1,
    genus: ((k.p - 1) * (q - 1)) / 2, linking: null, slice: false,
  };
}

// one line about the strand, in the deck's own register: what it is, and what
// completes it. Never what it means.
export function formLine(n) {
  const f = formOf(n);
  if (f.kind === 'unknot') {
    return 'an unknot: the strand closes with no crossing to hold.';
  }
  if (f.kind === 'link') {
    const mag = Math.abs(f.linking);
    return f.strands + ' strands, none of them knotted, and each pair linked '
      + mag + (mag === 1 ? ' time' : ' times') + ': what holds here is the linking, not the strand.';
  }
  return 'a knot of genus ' + f.genus + ', and not slice: no deformation of the strand '
    + 'alone closes it, in three dimensions or in four. Joined with its mirror, it bounds.';
}

// the deck's three classes, counted. Used by the pins and by any surface that
// wants to state the partition rather than recompute it.
export function partitionOf(cards) {
  const out = { unknot: [], link: [], knot: [] };
  for (const c of cards) out[formOf(c.n).kind].push(c.n);
  return out;
}
