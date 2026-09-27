// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// AUMA LUMINARA · THE FOCUS: the console's one invariant.
//
// THE RITE AND THE WORKSHOP ruled the architecture before this file existed:
// the card is the invariant and a mode is a projection. Every card already
// has a code, a knot, a cube position, a torus winding and a place on the
// wheel, all derived, so a console holds ONE FOCUS and each mode draws it.
// Focus crosses a mode switch; a cast does not. That single rule implements
// the boundary, and this module is that rule made code.
//
// Therefore, by construction:
//   · this module knows nothing about casts, seeds, questions or readings;
//   · it holds at most one card number (or none), and derived projections;
//   · every projection is imported from the module that owns it, never
//     re-derived, so the console can never drift from the canon.
//
// Pure except for the one tiny store at the bottom (the focus itself), which
// is the console's shared state and the only shared state it is allowed.

import { codeOf, codeMarks, knotOf, counterOf, becomingOf, cardOf, isSilent } from './luminara-canon.js';
import { homeOf, classOf } from './luminara-cube.js';
import { metalOf } from './luminara-knots.js';

// ---------------------------------------------------------------------------
// THE PROJECTIONS: one card, every lens. All derived, nothing situational.
// ---------------------------------------------------------------------------
export function projectionsOf(n) {
  const { p, q, kind, components, genus, hand } = knotOf(n);
  const code = codeOf(n);
  return {
    n,
    name: cardOf(n).name,
    // the code, the ground truth all others project from
    code, marks: codeMarks(n),
    // the torus: the winding pair is the card's whole torus identity;
    // the radius (phi the dress, root two the skeleton) is presentation
    // and belongs to the mode, not the card
    torus: { p, q, kind, components, genus, hand },
    // the cube: position and piece-class, from the cube's own module
    cube: { pos: homeOf(n), piece: classOf(n) },
    // the wheel: the counting circle, held as a fraction of the turn so a
    // mode may scale it to any radius it likes. Whether the wheel is a
    // third substrate or a face of the torus is an OPEN question
    // (docs/map-room/THE_THIRD_SUBSTRATE.md); this projection takes no side,
    // it only reports the circle position every surface already agrees on
    wheel: { turn: (n - 1) / 27 },
    // the house and the metal, the coset and its colour
    house: n <= 9 ? 'AUM' : n <= 18 ? 'MA' : 'RA',
    metal: metalOf(n),
    silent: isSilent(n),
    // the relations, the card's own verbs
    counter: counterOf(n),
    becoming: becomingOf(n),
  };
}

// ---------------------------------------------------------------------------
// THE STRUCTURES: what the focus lights in any mode. Derived, letter-free.
// ---------------------------------------------------------------------------
const nOf = (d) => 9 * d[0] + 3 * d[1] + d[2] + 1;

// the line through the focus: the Seed, the card, its counter (a subgroup)
export function lineOf(n) {
  if (n === 1) return [1];
  return [1, n, counterOf(n)].sort((a, b) => a - b);
}

// the plane perpendicular to the focus: the nine that take neither side
export function planeOf(n) {
  if (n === 1) return null;              // the Seed poles no plane
  const f = codeOf(n);
  const members = [];
  for (let m = 1; m <= 27; m++) {
    const d = codeOf(m);
    if ((f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) % 3 === 0) members.push(m);
  }
  return members;
}

// whether the focus stands on a body diagonal (a corner-dyad)
export const onDiagonal = (n) => classOf(n) === 'corner';

// the shell the focus stands in, the cube's own census word
export const shellOf = (n) => classOf(n);

// ---------------------------------------------------------------------------
// THE FOCUS STORE: the console's one shared thing.
// ---------------------------------------------------------------------------
// A number 1..27 or null. Nothing else may ever live here: no seed, no cast,
// no question, no reading. The pins hold this file to that shape.
let focused = null;
const listeners = new Set();

export function focus() { return focused; }

export function setFocus(n) {
  const next = (n === null || n === undefined) ? null : Number(n);
  if (next !== null && (!Number.isInteger(next) || next < 1 || next > 27)) return focused;
  if (next === focused) return focused;
  focused = next;
  for (const fn of listeners) fn(focused);
  return focused;
}

export function onFocus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
