// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CAST DIAL — a committed sky stamp, drawn on the astrolabe's own face.
//
// A pure module: a stamp in, an SVG string out. No DOM, no state, no clock, no
// randomness. That is not tidiness, it is the whole point. This module CANNOT
// read the time even if someone later asks it to, because it is never given
// one: it draws the sky that was witnessed, not the sky that is. A replayed
// cast from last winter shows last winter's sky, and there is no code path by
// which it could show tonight's.
//
// IT IS THE ASTROLABE'S FACE, NOT A DIALECT OF IT. The first version spoke the
// same visual language on a smaller frame; at the architect's word this is now
// the same frame. Every number here is read off luminara-astrolabe.html rather
// than chosen: the 208 unit box, the year ring at 96, the moon's lane at 91.6,
// the plate on its 50-root-k shells, the Seed at 6.5, the twelve folds with
// four stations among them, the window's fifteen degree half-arc. Where the two
// faces differ it is only where a RECORD differs from a PRESENT MOMENT, and
// each of those differences is named at the place it is made.
//
// WHAT IT DRAWS, AND WHY ONLY THREE THINGS MOVE.
// The stamp carries iso, cell, civil, sun, moon, node, elong, lit and window,
// but those are not nine independent facts. Given the three walkers the rest
// follow: elong is norm360(moon - sun); lit is (1 - cos elong)/2; window is
// whether the sun stands within fifteen degrees of the nearer crossing. So only
// the sun, the moon and the dragon are placed. The derived values are drawn as
// PROPERTIES of those marks, never as marks of their own: the phase is the
// moon's own luminance, the window is the arc it actually subtends.
//
// THE PLATE BENEATH IS THE DECK, NOT THE SKY. It is constant, derived from the
// canon, and identical on every dial ever drawn, so it is built once at load
// and reused. It is the frame the sky is read against, exactly as on the
// astrolabe, and it says nothing about this cast at all except by the one ring
// drawn about the cell the sky stood in.
//
// THE ANGLE CONVENTION IS THE ASTROLABE'S, EXACTLY. Zero degrees is due EAST,
// the three o'clock seat, and increasing longitude runs ANTICLOCKWISE, because
// SVG's y runs down and the sign is negated. A sun placed clockwise from the
// top would be a different instrument wearing the same clothes. Note this is
// NOT the plate's own convention, which seats the twenty-seven cells clockwise
// from north: both live on this face and must not be confused for one another.
//
// IT DOES NOT BREATHE, AND IT CANNOT BE TOUCHED. Both are deliberate and both
// are statements. The astrolabe's standing ring pulses on a four second cycle
// and that breath is this portal's signature for NOW; a committed stamp that
// breathed would claim to be present tense, which is exactly what it is not.
// And every interactive face in this portal carries an explicit transparent hit
// layer; this one has none, so the absence says the figure cannot be touched,
// because the record it draws is closed.
//
// The figure never speaks. There is no <text> in it, as there is none in any of
// the portal's round faces: naming belongs to the witness line beneath.

// RELATIVE, like every other module in this directory. It was once written
// server-absolute, a specifier the browser resolves and a test runner cannot,
// so the module could not be imported and its every pin had to be a scan of its
// source text. A drawing module no test can execute is one whose geometry is
// unpinned.
import { metalOf, knotPaths, glyphInk, GOLD, SILVER, WHITEGOLD } from './luminara-knots.js';
import { knotOf, counterOf } from './luminara-canon.js';
import { rosetteLayout } from './map-room-figures.js';

// CHOSEN here: nothing. Every radius below is the astrolabe's own.
export const DIAL_BOX = 208;
const R_LIMB = 96;             // the year ring: the sun's lane, and the dragon's
const R_MOON = 91.6;           // her own lane, 4.4 inside his
const R_SEED = 6.5;
const R_CELLRING = 13.8;       // the ring drawn about a cell on the plate
const WINDOW_DEG = 15;         // the arc's half width

const pol = (R, lon) => [R * Math.cos(-lon * Math.PI / 180), R * Math.sin(-lon * Math.PI / 180)];
const f = (x) => Number(x).toFixed(2);
const norm = (x) => ((x % 360) + 360) % 360;

// the two forced states of the phase, as the astrolabe pins them
const DARK_PIN = 0.035;
const FULL_PIN = 0.965;

const CELLS = rosetteLayout(50);

// THE TWO LIGHTS WALK SEPARATE LANES, and this is not decoration. Struck on one
// ring they are concentric at conjunction and the sun, being filled and larger,
// paints the moon out entirely. That would delete the dark moon, the commonest
// and most legible syzygy there is, from the record of the cast it fell in.

function plate() {
  let out = '';
  // the compass marks: three construction circles, the method the old
  // tile-makers would recognise
  for (const k of [1, 2, 3]) {
    out += '<circle r="' + f(50 * Math.sqrt(k)) + '" fill="none" stroke="' + WHITEGOLD
      + '" stroke-width="0.7" stroke-opacity="0.10" stroke-dasharray="2 5"/>';
  }
  // the diameters: on this projection the dyad IS a diameter, every card joined
  // to its answer straight through the still centre
  for (const c of CELLS) {
    if (c.shell === 0 || c.q <= 0) continue;
    out += '<line x1="' + f(c.x) + '" y1="' + f(c.y) + '" x2="' + f(-c.x) + '" y2="' + f(-c.y)
      + '" stroke="' + WHITEGOLD + '" stroke-width="0.7" stroke-opacity="0.13"/>';
  }
  // the glyphs: each card wearing its own knot, in its own metal
  for (const c of CELLS) {
    if (c.shell === 0) continue;
    const k = knotOf(c.n);
    const colors = k.kind === 'link' ? [metalOf(c.n), metalOf(counterOf(c.n))] : [metalOf(c.n)];
    out += '<g transform="translate(' + f(c.x) + ' ' + f(c.y) + ') scale(3.1)">'
      + glyphInk(knotPaths(k.p, k.q, colors, 0.20, 0.32)) + '</g>';
  }
  // the Seed: its own form at the centre, the unknot, unlit within
  out += '<circle r="' + R_SEED + '" fill="#0a0b0e" stroke="' + WHITEGOLD
    + '" stroke-width="1.2" stroke-opacity="0.85"/>';
  return out;
}
const PLATE = plate();

/**
 * castDialSvg(stamp, drawn) -> string
 * stamp is the record written at commit by skyStampOf: { cell, sun, moon,
 * node, lit, window, ... }. drawn is the committed three, [n1, n2, n3], as the
 * journal keeps them. Nothing else is read, and nothing is recomputed.
 *
 * THE CAST'S OWN FIGURE (the architect's ask: each cast distinct). The plate
 * draws every dyad diameter faintly, because on this projection the diameter
 * IS the correspondence: every card joined to its answer straight through the
 * still centre. The cast brightens exactly three of them. Each drawn card's
 * cell is ringed in its own metal, its diameter to its counter is raised from
 * the plate's murmur to its metal's own voice, and the three cells are joined
 * as a triangle, the constellation of this cast alone. Twenty-seven choose
 * three without replacement is 2925 triangles before the sky moves at all, so
 * no two casts wear the same face. All of it is the committed record: the
 * drawn three are as sealed as the stamp, and the Seed, having no counter but
 * itself, keeps its ring and simply has no diameter to raise.
 */
export function castDialSvg(stamp, drawn) {
  // ALL THREE LONGITUDES OR NOTHING. Guarding only the sun once let a partial
  // record through and put cx="NaN" into the page. An incomplete witness draws
  // no face at all, and the bench's #castDial:empty rule removes the seat.
  if (!stamp) return '';
  for (const k of ['sun', 'moon', 'node']) {
    if (typeof stamp[k] !== 'number' || !Number.isFinite(stamp[k])) return '';
  }
  const lit = Math.max(0, Math.min(1, (stamp.lit ?? 0) / 100));
  const [sx, sy] = pol(R_LIMB, stamp.sun);
  const [mx, my] = pol(R_MOON, stamp.moon);
  const [hx, hy] = pol(R_LIMB, stamp.node);
  const [tx, ty] = pol(R_LIMB, stamp.node + 180);

  let s = '<svg class="castdial" viewBox="-104 -104 208 208" aria-hidden="true">' + PLATE;

  // the year ring, and the twelve folds with the four stations among them
  s += '<circle r="' + R_LIMB + '" fill="none" stroke="' + WHITEGOLD
    + '" stroke-width="0.5" stroke-opacity="0.14"/>';
  for (let k = 0; k < 12; k++) {
    const station = k % 3 === 0;
    const [x1, y1] = pol(station ? 93 : 94.4, k * 30);
    const [x2, y2] = pol(station ? 99 : 97.6, k * 30);
    s += '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2)
      + '" stroke="' + WHITEGOLD + '" stroke-width="' + (station ? 0.8 : 0.5)
      + '" stroke-opacity="' + (station ? 0.3 : 0.16) + '"/>';
  }

  // THE CAST'S OWN CONSTELLATION, drawn from the committed three. Beneath the
  // sky's marks, above the plate's murmur: the record of what fell, on the
  // frame it fell in.
  const cast = Array.isArray(drawn)
    ? drawn.filter((n) => Number.isInteger(n) && n >= 1 && n <= 27) : [];
  const seats = cast.map((n) => CELLS.find((c) => c.n === n)).filter(Boolean);
  // the correspondences, raised: each drawn card's diameter to its counter
  // lifts from the plate's whitegold murmur to the card's own metal. The Seed
  // is its own counter and has no diameter to raise; its ring below suffices.
  for (const c of seats) {
    if (c.n === 1) continue;
    s += '<line x1="' + f(c.x) + '" y1="' + f(c.y) + '" x2="' + f(-c.x) + '" y2="' + f(-c.y)
      + '" stroke="' + metalOf(c.n) + '" stroke-width="0.7" stroke-opacity="0.45"/>';
  }
  // the triangle of this cast: the three cells joined, no two casts alike
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      s += '<line x1="' + f(seats[i].x) + '" y1="' + f(seats[i].y)
        + '" x2="' + f(seats[j].x) + '" y2="' + f(seats[j].y)
        + '" stroke="' + WHITEGOLD + '" stroke-width="0.5" stroke-opacity="0.3"/>';
    }
  }
  // each drawn cell ringed in its own metal, at the hit ring's radius so it
  // sits inside the sky cell's larger ring when the two coincide
  for (const c of seats) {
    s += '<circle cx="' + f(c.x) + '" cy="' + f(c.y) + '" r="9" fill="none" stroke="'
      + metalOf(c.n) + '" stroke-width="0.75" stroke-opacity="0.7"/>';
  }

  // THE CELL THE SKY STOOD IN, ringed on the plate. The astrolabe rings the
  // cell the present moment stands in; this rings the one the stamp recorded,
  // which is the same gesture made about a closed moment.
  const cell = CELLS.find((c) => c.n === stamp.cell);
  if (cell) {
    s += '<circle cx="' + f(cell.x) + '" cy="' + f(cell.y) + '" r="' + R_CELLRING
      + '" fill="none" stroke="' + metalOf(stamp.cell)
      + '" stroke-width="0.85" stroke-opacity="0.75"/>';
  }

  // THE DRAGON'S WINDOW, drawn as the ARC it actually subtends rather than as a
  // ring about the whole face. WHETHER it stood open is the committed boolean
  // and is never re-derived: it was thresholded at commit against the unrounded
  // distance while sun and node are each rounded to a tenth, so a recomputation
  // could honestly disagree with the record. WHERE it stood is arithmetic on
  // two committed longitudes, which recomputes nothing.
  if (stamp.window) {
    const d = norm(stamp.sun - stamp.node);
    const dHead = Math.min(d, 360 - d);
    const nearLon = dHead <= 90 ? stamp.node : stamp.node + 180;
    const a0 = -(nearLon - WINDOW_DEG) * Math.PI / 180;
    const a1 = -(nearLon + WINDOW_DEG) * Math.PI / 180;
    s += '<path d="M ' + f(R_LIMB * Math.cos(a0)) + ' ' + f(R_LIMB * Math.sin(a0))
      + ' A ' + R_LIMB + ' ' + R_LIMB + ' 0 0 0 '
      + f(R_LIMB * Math.cos(a1)) + ' ' + f(R_LIMB * Math.sin(a1))
      + '" fill="none" stroke="' + SILVER
      + '" stroke-width="2.2" stroke-opacity="0.22" stroke-linecap="round"/>';
  }

  // the moon: one disc whose LUMINANCE is the phase. No crescent, no
  // terminator, no clipped disc anywhere in this portal. At the dark pin she
  // becomes the Seed's own form, the unlit ring, and the frame's null echoes
  // her; at the full she stands haloed.
  if (lit < DARK_PIN) {
    s += '<circle cx="' + f(mx) + '" cy="' + f(my) + '" r="2.6" fill="#0a0b0e" stroke="'
      + WHITEGOLD + '" stroke-width="0.9" stroke-opacity="0.9"/>';
    s += '<circle r="8.4" fill="none" stroke="' + WHITEGOLD
      + '" stroke-width="0.7" stroke-opacity="0.3"/>';
  } else {
    s += '<circle cx="' + f(mx) + '" cy="' + f(my) + '" r="2.4" fill="' + SILVER
      + '" fill-opacity="' + f(0.15 + 0.75 * lit) + '" stroke="' + SILVER
      + '" stroke-width="0.5" stroke-opacity="0.7"/>';
    if (lit > FULL_PIN) {
      s += '<circle cx="' + f(mx) + '" cy="' + f(my) + '" r="4.8" fill="none" stroke="' + SILVER
        + '" stroke-width="0.6" stroke-opacity="0.45"/>';
    }
  }

  // the sun. Gold is ALSO the seed's metal on the nine cells 19 to 27, so gold
  // is not the sun alone on this face; the two are told apart by their seats
  // and never by their ink. The seed does not move; the sun walks the ring.
  s += '<circle cx="' + f(sx) + '" cy="' + f(sy) + '" r="2.6" fill="' + GOLD
    + '" fill-opacity="0.9"/>';

  // THE CROSSINGS GO LAST, over the lights and never under them. A light stands
  // within ten degrees of a crossing in about one cast in nine, and a filled
  // disc drawn over an open ring erases it. An emptiness drawn over a body
  // still reads, and reads as what it is: the light standing in the crossing.
  s += '<circle cx="' + f(hx) + '" cy="' + f(hy) + '" r="2.7" fill="none" stroke="' + SILVER
    + '" stroke-width="0.9" stroke-opacity="0.6"/>';
  s += '<circle cx="' + f(tx) + '" cy="' + f(ty) + '" r="2.7" fill="none" stroke="' + SILVER
    + '" stroke-width="0.9" stroke-opacity="0.6" stroke-dasharray="1.6 1.6"/>';

  return s + '</svg>';
}
