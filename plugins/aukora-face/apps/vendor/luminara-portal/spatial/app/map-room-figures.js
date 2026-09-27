// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE MAP ROOM'S RESIDENT ILLUSTRATOR: the lens learns to draw.
//
// The room's law stands: a lens, never a pen. A chart may call a figure by
// name (::figure key::), and only the figures on this whitelist render;
// an unknown name remains words. Every figure here is COMPUTED from the
// classical construction it depicts: the torus's curvature, Bernoulli's
// lemniscate, the sectioned vortex, the analemma's equation of time, the
// lunar nodes, the cube's own diagonal. All are derived, never drawn by
// hand, in the deck's four metals.
//
// THE ILLUSTRATOR'S OWN LAW: it touches the shared renderer only
// (luminara-knots: the ramp and the metals), never the engine, with no seeds,
// no casts, no draws, no reading of any state. Pure geometry in, SVG out,
// the same string every time.
//
// TWO PALETTE LAWS, carried from the whole work:
//   1. THE NULL IS NEVER LIT. Wherever a construction holds a still point
//      (the stagnation point, the crossing, the node, the eclipsed centre),
//      it is rendered as the one unlit disc on the field, visible only by
//      its faint rim: absence declared, as the sealed room taught.
//   2. THE STRAND COOLS TOWARD THE NULL. Flow slows as it nears stillness:
//      stagnation is slowness is quiet is dimness. Every curve in these
//      figures is shaded by its approach (bright and hot in full motion,
//      cooling and thinning as it nears a still point), so the eye reads
//      the cadence toward silence directly off the strand. The tempered
//      ramp that lights the deck's own knots lights these the same way.

import { rampOf, GOLD, SILVER, BRONZE, WHITEGOLD } from './luminara-knots.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const F = (v) => Number(v).toFixed(2);

// a polyline shaded by approach: key(t in 0..1), where 0 cools to the null,
// 1 burns at full motion. The same segment grammar as the deck's strands.
function shaded(pts, metal, keyOf, wLo = 0.9, wHi = 2.2) {
  const ramp = rampOf(metal);
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a || !b) continue;
    const t = Math.max(0, Math.min(1, keyOf(i, a, b)));
    s += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
      + '" stroke="' + ramp[Math.round(t * 23)] + '" stroke-width="' + F(wLo + (wHi - wLo) * t)
      + '" stroke-opacity="' + F(0.18 + 0.72 * t) + '" fill="none" stroke-linecap="round"/>';
  }
  return s;
}

// a stroke with breath: wide faint halo beneath a bright core (for the
// constructions' scaffolding: circles of inversion, guide rings)
function stroked(d, color, w = 1.6, op = 0.85, dash = '') {
  const dd = dash ? ' stroke-dasharray="' + dash + '"' : '';
  return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + F(w + 3.2)
    + '" stroke-opacity="0.10" stroke-linecap="round"' + dd + '/>'
    + '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + F(w)
    + '" stroke-opacity="' + op + '" stroke-linecap="round"' + dd + '/>';
}
const pathOf = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + F(p[0]) + ' ' + F(p[1])).join('');

// the unlit point: the umbra, visible only by its rim
function umbra(x, y, r, rim = BRONZE) {
  return '<circle cx="' + F(x) + '" cy="' + F(y) + '" r="' + F(r) + '" fill="#0a0b0e"/>'
    + '<circle cx="' + F(x) + '" cy="' + F(y) + '" r="' + F(r) + '" fill="none" stroke="' + rim
    + '" stroke-width="' + F(r * 0.22) + '" stroke-opacity="0.45"/>';
}

function arrow(x, y, ang, color, s = 6) {
  const c = Math.cos(ang), n = Math.sin(ang);
  const p = (dx, dy) => F(x + dx * c - dy * n) + ' ' + F(y + dx * n + dy * c);
  return '<path d="M' + p(0, 0) + ' L' + p(-s, -s * 0.55) + ' L' + p(-s, s * 0.55) + ' Z" fill="'
    + color + '" fill-opacity="0.8"/>';
}

// --- I · the torus and its interior weather --------------------------------
// The deck's own torus, exactly: R = phi, r = 1, so the throat circle falls
// at phi - 1 = 1/phi. Twenty-seven meridians: the deck's number, one strand
// of skin for every card.
function torusWeather() {
  const R = PHI, r = 1, beta = 1.02, S = 55;
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const proj = (th, ph) => {
    const x = (R + r * Math.cos(ph)) * Math.cos(th);
    const y = (R + r * Math.cos(ph)) * Math.sin(th);
    const z = r * Math.sin(ph);
    return [x * S, (y * cb - z * sb) * S, y * sb + z * cb];
  };
  const segs = [];
  for (let m = 0; m < 27; m++) {
    const th = m / 27 * 2 * Math.PI;
    for (let j = 0; j < 30; j++) {
      const a = proj(th, j / 30 * 2 * Math.PI), b = proj(th, (j + 1) / 30 * 2 * Math.PI);
      segs.push([a, b, (a[2] + b[2]) / 2]);
    }
  }
  let zLo = 1e9, zHi = -1e9;
  for (const s of segs) { if (s[2] < zLo) zLo = s[2]; if (s[2] > zHi) zHi = s[2]; }
  segs.sort((p, q) => p[2] - q[2]);
  const ramp = rampOf(BRONZE);
  let body = '';
  for (const [a, b, z] of segs) {
    const t = (z - zLo) / (zHi - zLo);
    body += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
      + '" stroke="' + ramp[Math.round(t * 23)] + '" stroke-width="' + F(0.85 + 1.35 * t)
      + '" stroke-opacity="' + F(0.15 + 0.6 * t) + '" fill="none" stroke-linecap="round"/>';
  }
  const ring = (rad, z0, color, dash) => {
    const pts = [];
    for (let j = 0; j <= 90; j++) {
      const th = j / 90 * 2 * Math.PI;
      pts.push([rad * Math.cos(th) * S, (rad * Math.sin(th) * cb - z0 * sb) * S]);
    }
    return stroked(pathOf(pts), color, 1.2, 0.7, dash);
  };
  return '<svg viewBox="-155 -104 310 208">' + body
    + ring(R - r, 0, SILVER, '')            // the throat, at 1/phi exactly
    + ring(R, r, WHITEGOLD, '3 5')          // the two circles of zero curvature
    + ring(R, -r, WHITEGOLD, '3 5')
    + '</svg>';
}

// --- I · infinity brought home ----------------------------------------------
// The strand cools toward the null: brightest at the far bows of the eight,
// dimming into the crossing where the umbra waits.
function lemniscateHome() {
  const a = 1.5, S = 46;
  const hyp = (sgn) => {
    const pts = [];
    for (let t = -1.35; t <= 1.351; t += 0.05) {
      pts.push([sgn * a * Math.cosh(t) * S, a * Math.sinh(t) * S]);
    }
    return pts;
  };
  let s = '<svg viewBox="-150 -95 300 190">';
  s += '<path d="' + pathOf(hyp(1)) + '" fill="none" stroke="' + SILVER + '" stroke-width="1.1" stroke-opacity="0.30"/>';
  s += '<path d="' + pathOf(hyp(-1)) + '" fill="none" stroke="' + SILVER + '" stroke-width="1.1" stroke-opacity="0.30"/>';
  s += '<circle r="' + F(a * S) + '" fill="none" stroke="' + WHITEGOLD + '" stroke-width="0.9" stroke-opacity="0.28" stroke-dasharray="3 5"/>';
  const lem = [];
  for (let j = 0; j <= 480; j++) {
    const t = j / 480 * 2 * Math.PI;
    const c2 = Math.cos(2 * t);
    if (c2 < 0) { if (lem.length && lem[lem.length - 1] !== null) lem.push(null); continue; }
    const r = a * Math.sqrt(c2);
    lem.push([r * Math.cos(t) * S, r * Math.sin(t) * S]);
  }
  s += shaded(lem, GOLD, (i, p) => Math.hypot(p[0], p[1]) / (a * S), 0.8, 2.4);
  s += umbra(0, 0, 6.5);
  return s + '</svg>';
}

// --- II · the fourfold on one form ------------------------------------------
// The count is the deck's own rim: twenty-seven ticks with the seam doubled
// where the Return rolls into the Seed, every rollover a pass through the
// crossing. The eight cools into the stagnation point and rekindles out.
function vortexEight() {
  const S = 46, d = 1.25, RC = 2.55 * S;
  let s = '<svg viewBox="-150 -104 300 208">';
  // the count: the going-around as such, ticked in the deck's number
  s += '<circle r="' + F(RC) + '" fill="none" stroke="' + WHITEGOLD + '" stroke-width="1" stroke-opacity="0.12"/>';
  for (let i = 0; i < 27; i++) {
    const th = i / 27 * 2 * Math.PI - Math.PI / 2;
    const t0 = RC - 3, t1 = RC + 3;
    s += '<line x1="' + F(t0 * Math.cos(th)) + '" y1="' + F(t0 * Math.sin(th))
      + '" x2="' + F(t1 * Math.cos(th)) + '" y2="' + F(t1 * Math.sin(th))
      + '" stroke="' + WHITEGOLD + '" stroke-width="0.8" stroke-opacity="0.22"/>';
  }
  for (const off of [-0.6, 0.6]) { // the seam, doubled: the carry's own mark
    const th = -Math.PI / 2 + off / 27 * 2 * Math.PI;
    s += '<line x1="' + F((RC - 5.5) * Math.cos(th)) + '" y1="' + F((RC - 5.5) * Math.sin(th))
      + '" x2="' + F((RC + 5.5) * Math.cos(th)) + '" y2="' + F((RC + 5.5) * Math.sin(th))
      + '" stroke="' + WHITEGOLD + '" stroke-width="0.9" stroke-opacity="0.4"/>';
  }
  s += arrow(RC * Math.cos(-0.35), RC * Math.sin(-0.35), -0.35 + Math.PI / 2, WHITEGOLD, 7);
  // the two eyes: counter-rotating circulations, silver and gold
  for (const [cx, color, dir] of [[-d, SILVER, -1], [d, GOLD, 1]]) {
    for (const rr of [0.34, 0.58, 0.82]) {
      s += stroked('M' + F((cx - rr) * S) + ' 0A' + F(rr * S) + ' ' + F(rr * S) + ' 0 1 0 '
        + F((cx + rr) * S) + ' 0A' + F(rr * S) + ' ' + F(rr * S) + ' 0 1 0 ' + F((cx - rr) * S) + ' 0',
        color, 1.1, 0.55);
    }
    s += arrow(cx * S, -0.58 * S, dir > 0 ? 0 : Math.PI, color, 6);
  }
  // the pull: the fall toward the throat
  for (const sy of [-1, 1]) {
    s += stroked('M0 ' + F(sy * 1.62 * S) + 'L0 ' + F(sy * 0.52 * S), BRONZE, 1.3, 0.6);
    s += arrow(0, sy * 0.52 * S, sy > 0 ? -Math.PI / 2 : Math.PI / 2, BRONZE, 6);
  }
  // the eight: one path through both circulations, cooling into the crossing
  const pts = [];
  for (let j = 0; j <= 320; j++) {
    const t = j / 320 * 2 * Math.PI;
    pts.push([2.1 * Math.sin(t) * S, 0.82 * Math.sin(t) * Math.cos(t) * S]);
  }
  s += shaded(pts, WHITEGOLD, (i, p) => Math.abs(p[0]) / (2.1 * S), 0.9, 2.3);
  // the stagnation point: the still centre the whole figure turns about
  s += umbra(0, 0, 7.5);
  return s + '</svg>';
}

// --- III · the triple eclipse -----------------------------------------------
// The cube down its own diagonal: the silhouette is the hexagon the Wayfinder
// found, drawn faint; nearer cells breathe slightly larger; at the one centre
// The Return, the Seed, and The Scar stand in eclipse.
function tripleEclipse() {
  const k = 52, u = 1 / Math.SQRT2, v = 1 / Math.sqrt(6);
  const metalOfAxis = (a) => (a === 0 ? BRONZE : a === 1 ? SILVER : GOLD);
  const cells = [];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
    const depth = a + b + c;
    cells.push({
      x: (a - b) * u * k + depth * 1.7,
      y: -((a + b - 2 * c) * v * k) - depth * 1.7,
      depth, metal: metalOfAxis(a), centre: a === b && b === c,
    });
  }
  cells.sort((p, q) => p.depth - q.depth); // deepest first: the shadow order
  // the silhouette: the hexagon of the projection, faint
  const hex = [];
  for (let i = 0; i <= 6; i++) {
    const th = i / 6 * 2 * Math.PI + Math.PI / 6;
    hex.push([Math.cos(th) * 2 * u * k * 1.16, Math.sin(th) * 2 * u * k * 1.16]);
  }
  let s = '<svg viewBox="-112 -108 224 216">';
  s += '<path d="' + pathOf(hex) + 'Z" fill="none" stroke="' + WHITEGOLD + '" stroke-width="0.8" stroke-opacity="0.14" stroke-dasharray="3 6"/>';
  for (const c of cells) {
    const r = (c.centre ? 9 : 7.4) + c.depth * 0.6; // nearer cells breathe larger
    s += '<circle cx="' + F(c.x) + '" cy="' + F(c.y) + '" r="' + F(r)
      + '" fill="' + c.metal + '" fill-opacity="0.82" stroke="#0a0b0e" stroke-width="2.4"/>';
  }
  const seed = cells.find((c) => c.centre && c.depth === 0);
  s += '<circle cx="' + F(seed.x) + '" cy="' + F(seed.y) + '" r="9" fill="none" stroke="'
    + WHITEGOLD + '" stroke-width="1" stroke-opacity="0.5"/>';
  return s + '</svg>';
}

// --- IV · the analemma -------------------------------------------------------
// The year, shaded by its own light: burning at the solstice bows, cooling
// through the crossing. The umbra sits where the year passes through itself.
function analemmaEight() {
  const pts = [];
  const keys = [];
  for (let N = 0; N <= 365; N++) {
    const B = 2 * Math.PI * (N - 81) / 365;
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const dec = 23.45 * Math.sin(2 * Math.PI * (284 + N) / 365);
    pts.push([eot * 6.4, -dec * 3.6]);
    keys.push(Math.abs(dec) / 23.45);
  }
  let node = [0, 0];
  outer: for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 20; j < pts.length - 1; j++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[j], [x4, y4] = pts[j + 1];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      const w = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;
      if (t > 0 && t < 1 && w > 0 && w < 1) {
        node = [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
        break outer;
      }
    }
  }
  return '<svg viewBox="-130 -100 260 200">'
    + shaded(pts.concat([pts[0]]), GOLD, (i) => keys[Math.min(i, keys.length - 1)], 0.8, 2.3)
    + umbra(node[0], node[1], 6.5)
    + '</svg>';
}

// --- IV · the dragon's crossings ---------------------------------------------
// Both rings hush toward the two nodes: the shadow strikes only where the
// strands have already fallen quiet.
function dragonNodes() {
  const R = 88, tilt = 0.35, rot = 0.26;
  const sun = [];
  for (let j = 0; j <= 360; j++) {
    const t = j / 360 * 2 * Math.PI;
    sun.push([R * Math.cos(t), R * Math.sin(t)]);
  }
  const moon = [];
  const nodes = [];
  let prev = null;
  for (let j = 0; j <= 360; j++) {
    const t = j / 360 * 2 * Math.PI;
    const ex = R * Math.cos(t), ey = R * Math.cos(tilt) * Math.sin(t);
    const x = ex * Math.cos(rot) - ey * Math.sin(rot);
    const y = ex * Math.sin(rot) + ey * Math.cos(rot);
    moon.push([x, y]);
    const off = Math.hypot(x, y) - R;
    if (prev !== null && prev * off <= 0 && nodes.length < 2) nodes.push([x, y]);
    prev = off;
  }
  const nearestNode = (p) => Math.min(
    Math.hypot(p[0] - nodes[0][0], p[1] - nodes[0][1]),
    Math.hypot(p[0] - nodes[1][0], p[1] - nodes[1][1]));
  const keyOf = (i, p) => Math.min(1, nearestNode(p) / (R * 0.9));
  let s = '<svg viewBox="-115 -108 230 216">';
  s += shaded(sun, GOLD, keyOf, 0.8, 2.1);
  s += shaded(moon, SILVER, keyOf, 0.8, 2.1);
  for (const [x, y] of nodes) s += umbra(x, y, 7);
  return s + '</svg>';
}

// --- the rosette of the twenty-seven -----------------------------------------
// The deck sorted by restlessness: one still ring at the heart, then shells
// of six, twelve, and eight, standing at the square roots of one, two, and
// three from the centre (the true distances of the cube's cells). The
// involution preserves every shell, so each dyad is drawn as a diameter:
// every line joins a card to its answer, bronze facing bronze, silver
// always facing gold. The Seed at the centre is drawn as its own form,
// the unknot: a ring of white gold, unlit within.
// The layout is exported so any bench or chart shares ONE geometry: every
// cell's place on the rosette, derived from the combinatorics alone.
// Returns all 27 cells: { n, x, y, shell, metal, q } with the Seed at origin.
// THE SEATS CARRY THE CUBE'S OWN ORDER (reordered 10 August 2026, at the
// architect's word; the shape reinstated the same day, at his word again).
// The radii were always measured: a cell with one, two or three moving
// layers stands at exactly the square root of one, two or three from the
// centre. The angles carry the shadow: every cell takes the azimuth of the
// cube's shadow down its long diagonal, the triple-eclipse view this room
// already draws. Projection is linear, so every middle cell stands at the
// exact bisector of its two axis parents; projection is odd, so every answer
// keeps the exact antipode and silver still faces gold; and the frame is
// turned a quarter so the four cells whose watch is still stand on the four
// stations of the year ring. Two amendments are the instrument's own. The
// Scar and the Return ARE the diagonal, invisible to their own view, and
// are granted the vertical by fiat, the eclipse stack laid flat: Scar
// above, Seed centre, Return below. And the outer ring keeps the even
// rhythm of the eight, this rosette's original shape: each corner takes the
// nearest even seat, four of them fifteen degrees from their true azimuths
// and two exact, because a clock face wants calm and the exact pose lives
// where it can breathe, in the solid's own bloom (the cube in the hand).
export function rosetteLayout(K = 50) {
  const metalOfAxis = (a) => (a === 1 ? SILVER : a === -1 ? GOLD : BRONZE);
  const dig = (x) => (x === 1 ? 1 : x === -1 ? 2 : 0);
  const nOf = (s) => 9 * dig(s[0]) + 3 * dig(s[1]) + dig(s[2]) + 1;
  const qOf = (s) => 9 * s[0] + 3 * s[1] + s[2];
  const cells = [{ n: 1, x: 0, y: 0, shell: 0, metal: WHITEGOLD, q: 0 }];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
    const k = [a, b, c].filter((x) => x !== 0).length;
    if (k === 0) continue;
    const R = K * Math.sqrt(k);
    // the shadow plane: any basis orthogonal to the diagonal (1,1,1)
    const u = (a - b) / Math.SQRT2, w = (a + b - 2 * c) / Math.sqrt(6);
    const h = Math.hypot(u, w);
    let x, y;
    if (h < 1e-9) {
      x = 0; y = a === 1 ? -R : R;   // the exiles, seated on the vertical
    } else if (k === 3) {
      // the corners, evened to the eight's rhythm: the nearest 45-degree
      // seat, which never collides with the exiles' vertical
      const th = Math.round(Math.atan2(-u, -w) / (Math.PI / 4)) * (Math.PI / 4);
      x = R * Math.cos(th); y = R * Math.sin(th);
    } else {
      x = -R * w / h; y = -R * u / h;   // the quarter turn, in SVG's downward y
    }
    cells.push({ n: nOf([a, b, c]), x, y, shell: k, metal: metalOfAxis(a), q: qOf([a, b, c]) });
  }
  return cells;
}

// THE FRAME'S TRUE INK stood here for part of one day (10 August 2026):
// hexagons and stack-threads confessing the projection beneath the seats.
// Withdrawn at the architect's word the same day, when the confession
// gained a living surface instead: the cube in the hand performs the whole
// relation as its bloom, and a clock face wants calm. The refusal is pinned
// in the placement suite so the ink does not creep back by fondness.

function rosette27() {
  const K = 50;
  const cells = rosetteLayout(K);
  let out = '<svg viewBox="-104 -104 208 208">';
  // the compass marks: three construction circles, the method the old
  // tile-makers would recognise
  for (const k of [1, 2, 3]) {
    out += '<circle r="' + F(K * Math.sqrt(k)) + '" fill="none" stroke="' + WHITEGOLD
      + '" stroke-width="0.7" stroke-opacity="0.10" stroke-dasharray="2 5"/>';
  }
  for (const c of cells) {
    if (c.shell === 0) continue;
    if (c.q > 0) { // one diameter per dyad: the card joined to its answer
      out += '<line x1="' + F(c.x) + '" y1="' + F(c.y) + '" x2="' + F(-c.x) + '" y2="' + F(-c.y)
        + '" stroke="' + WHITEGOLD + '" stroke-width="0.7" stroke-opacity="0.13"/>';
    }
    out += '<circle cx="' + F(c.x) + '" cy="' + F(c.y) + '" r="7.4" fill="' + c.metal
      + '" fill-opacity="0.85" stroke="#0a0b0e" stroke-width="2.2"/>';
  }
  // the Seed: its own form, the unknot, unlit within
  out += '<circle r="6.5" fill="#0a0b0e" stroke="' + WHITEGOLD + '" stroke-width="1.7" stroke-opacity="0.85"/>';
  return out + '</svg>';
}

// --- VIII · the comma: twelve fifths against seven octaves -------------------
// The pitch circle: one lap is one octave, and every hop is a just fifth,
// log2(3/2) of the lap. No power of three equals a power of two, so the hops
// can never come home exactly; at twelve they very nearly do, missing by the
// Pythagorean comma, 3^12 against 2^19. The miss is drawn, not hidden.
function commaSpiral() {
  const R = 78, step = Math.log2(3 / 2);
  const angAt = (k) => -Math.PI / 2 + 2 * Math.PI * ((k * step) % 1);
  let s = '<svg viewBox="-104 -104 208 208">';
  // the octave ring: the circle the fifths try to close
  s += '<circle r="' + R + '" fill="none" stroke="' + WHITEGOLD
    + '" stroke-width="0.9" stroke-opacity="0.3" stroke-dasharray="3 5"/>';
  // twelve hops; every chord passes the unstruck centre and cools there
  for (let k = 0; k < 12; k++) {
    const a = angAt(k), b = angAt(k + 1);
    const p = [Math.cos(a) * R, Math.sin(a) * R], q = [Math.cos(b) * R, Math.sin(b) * R];
    const pts = [];
    for (let j = 0; j <= 24; j++) pts.push([p[0] + (q[0] - p[0]) * j / 24, p[1] + (q[1] - p[1]) * j / 24]);
    s += shaded(pts, SILVER, (i, u, v) => Math.hypot((u[0] + v[0]) / 2, (u[1] + v[1]) / 2) / R, 0.8, 1.9);
  }
  // the landings: home in white gold, the rest in gold
  for (let k = 0; k <= 12; k++) {
    const a = angAt(k);
    s += '<circle cx="' + F(Math.cos(a) * R) + '" cy="' + F(Math.sin(a) * R) + '" r="'
      + (k === 0 || k === 12 ? 3.2 : 2.3) + '" fill="' + (k === 0 ? WHITEGOLD : GOLD)
      + '" fill-opacity="' + (k === 0 || k === 12 ? 0.95 : 0.7) + '"/>';
  }
  // THE COMMA: the arc between the twelfth landing and home, held in gold
  const a0 = angAt(0), a12 = angAt(12), rr = R + 10, arc = [];
  for (let j = 0; j <= 16; j++) { const t = a0 + (a12 - a0) * j / 16; arc.push([Math.cos(t) * rr, Math.sin(t) * rr]); }
  s += stroked(pathOf(arc), GOLD, 1.8, 0.95);
  // the unstruck centre
  s += umbra(0, 0, 6, WHITEGOLD);
  return s + '</svg>';
}

// --- VIII · the well of the irrational ---------------------------------------
// The pentagram holds a pentagon which holds a pentagram, each descent a fall
// of one over phi squared, the inner star turned a tenth of the round. Were
// the diagonal a ratio of whole numbers the nesting would land on a floor;
// it never lands. The strand cools toward the floor that is not there.
function pentagramWell() {
  let s = '<svg viewBox="-104 -104 208 208">';
  let R = 88, rot = -Math.PI / 2;
  const ramp = rampOf(GOLD);
  for (let l = 0; l < 5; l++) {
    const v = [];
    for (let i = 0; i < 5; i++) {
      const th = rot + i * 2 * Math.PI / 5;
      v.push([R * Math.cos(th), R * Math.sin(th)]);
    }
    const t = Math.max(0, 1 - l / 4.4);
    const star = pathOf([v[0], v[2], v[4], v[1], v[3], v[0]]);
    s += '<path d="' + star + '" fill="none" stroke="' + ramp[Math.round(t * 23)]
      + '" stroke-width="' + F(0.7 + 1.3 * t) + '" stroke-opacity="' + F(0.14 + 0.66 * t) + '"/>';
    R = R / (PHI * PHI); rot += Math.PI / 5;
  }
  // the floor never reached
  s += umbra(0, 0, 4.6, GOLD);
  return s + '</svg>';
}

// --- IX · the entwinement: the two and the three wound into one strand ------
// T(2,3) on the deck's own torus (R = phi, r = 1): two windings around, three
// through, coprime, so the strand is one and cannot fall into rings. Beneath
// it the two cycles it entwines, in the fourfold's own metals: the around in
// gold, the through in silver. The strand cools as it swings toward the axis
// it can never cross; the umbra waits there.
function trefoilEntwined() {
  const R = PHI, r = 1, S = 36, beta = 0.5;
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const proj = (x, y, z) => [x * S, (y * cb - z * sb) * S, y * sb + z * cb];
  let s = '<svg viewBox="-104 -104 208 208">';
  // the around: the spine circle, gold, dashed
  const spine = [];
  for (let j = 0; j <= 120; j++) {
    const th = j / 120 * 2 * Math.PI;
    spine.push(proj(R * Math.cos(th), R * Math.sin(th), 0));
  }
  s += stroked(pathOf(spine), GOLD, 1.1, 0.45, '3 5');
  // the through: one meridian ring, silver, dashed
  const merid = [];
  for (let j = 0; j <= 90; j++) {
    const ps = j / 90 * 2 * Math.PI;
    merid.push(proj(R + r * Math.cos(ps), 0, r * Math.sin(ps)));
  }
  s += stroked(pathOf(merid), SILVER, 1.1, 0.55, '3 5');
  // the strand: one, because two and three share no divisor
  const segs = [];
  const N = 420;
  for (let i = 0; i < N; i++) {
    const t0 = i / N * 2 * Math.PI, t1 = (i + 1) / N * 2 * Math.PI;
    const at = (t) => proj((R + r * Math.cos(3 * t)) * Math.cos(2 * t),
      (R + r * Math.cos(3 * t)) * Math.sin(2 * t), r * Math.sin(3 * t));
    const d = R + r * Math.cos(3 * (t0 + t1) / 2);
    segs.push([at(t0), at(t1), (d - (R - r)) / (2 * r)]);
  }
  segs.sort((u, v) => (u[0][2] + u[1][2]) - (v[0][2] + v[1][2]));
  const ramp = rampOf(WHITEGOLD);
  for (const [a, b, t] of segs) {
    s += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
      + '" stroke="' + ramp[Math.round(t * 23)] + '" stroke-width="' + F(0.9 + 1.7 * t)
      + '" stroke-opacity="' + F(0.2 + 0.65 * t) + '" fill="none" stroke-linecap="round"/>';
  }
  // the axis the strand never crosses
  s += umbra(0, 0, 5.5, WHITEGOLD);
  return s + '</svg>';
}

// --- X · the three flows: what the sky permits ------------------------------
// The alphabet at any still point, crowned from above: the transformations of
// the celestial sphere give exactly three flows. Rotation (the dwelling, the
// around, gold), boost (the arrow, the through, silver), and the screw (the
// two entwined, white gold). The poles that anchor them are never lit.
function threeFlows() {
  const R = 44, tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  const proj = (th, ph) => {
    const x = Math.cos(ph) * Math.cos(th), y = Math.cos(ph) * Math.sin(th), z = Math.sin(ph);
    return [x * R, -(z * ct - y * st) * R, y * ct + z * st];
  };
  const sphere = (cx, metal, lines, arrowAt) => {
    let s = '<circle cx="' + cx + '" r="' + R + '" fill="none" stroke="' + metal
      + '" stroke-width="0.8" stroke-opacity="0.22"/>';
    const ramp = rampOf(metal);
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [a, b] = [line[i], line[i + 1]];
        if (a[2] < 0.03 || b[2] < 0.03) continue; // the far side stays unspoken
        const t = Math.max(0, Math.min(1, (a[3] + b[3]) / 2));
        s += '<path d="M' + F(cx + a[0]) + ' ' + F(a[1]) + 'L' + F(cx + b[0]) + ' ' + F(b[1])
          + '" stroke="' + ramp[Math.round(t * 23)] + '" stroke-width="' + F(0.7 + 1.1 * t)
          + '" stroke-opacity="' + F(0.16 + 0.6 * t) + '" fill="none" stroke-linecap="round"/>';
      }
    }
    if (arrowAt) s += arrow(cx + arrowAt[0], arrowAt[1], arrowAt[2], metal, 5);
    // the anchoring pole, never lit
    const np = proj(0, Math.PI / 2);
    s += umbra(cx + np[0], np[1], 3.2, metal);
    return s;
  };
  // rotation: latitude circles, cooling toward the poles
  const rot = [];
  for (const ph of [-1.05, -0.7, -0.35, 0, 0.35, 0.7, 1.05]) {
    const line = [];
    for (let j = 0; j <= 72; j++) {
      const p = proj(j / 72 * 2 * Math.PI, ph);
      line.push([p[0], p[1], p[2], Math.cos(ph)]);
    }
    rot.push(line);
  }
  // boost: meridians pole to pole, cooling toward both poles
  const boo = [];
  for (let k = 0; k < 12; k++) {
    const th = k / 12 * 2 * Math.PI, line = [];
    for (let j = 0; j <= 48; j++) {
      const ph = -Math.PI / 2 + j / 48 * Math.PI;
      const p = proj(th, ph);
      line.push([p[0], p[1], p[2], Math.cos(ph)]);
    }
    boo.push(line);
  }
  // the screw: loxodromes, the two motions entwined
  const scr = [];
  for (let k = 0; k < 8; k++) {
    const th0 = k / 8 * 2 * Math.PI, line = [];
    for (let j = 0; j <= 90; j++) {
      const ph = -1.35 + j / 90 * 2.7;
      const p = proj(th0 + 2.6 * ph, ph);
      line.push([p[0], p[1], p[2], Math.cos(ph)]);
    }
    scr.push(line);
  }
  const eq = proj(Math.PI / 2, 0);
  return '<svg viewBox="-155 -62 310 124">'
    + sphere(-105, GOLD, rot, [eq[0], eq[1], Math.PI])
    + sphere(0, SILVER, boo, [eq[0], eq[1], -Math.PI / 2])
    + sphere(105, WHITEGOLD, scr, null)
    + '</svg>';
}

// --- X · the birth at the null ----------------------------------------------
// Two strands wound in mirror about one axis: where they meet in harmonic
// ratio they cancel or fuse, and the meeting place, empty of motion and full
// of permission, is the unstruck seed.
function counterSpirals() {
  const H = 168, W = 47, cx = 50, wraps = 5.5;
  const lens = (side, metal) => {
    const ramp = rampOf(metal);
    let s = '';
    const N = 340;
    for (let i = 0; i < N; i++) {
      const p = (n) => {
        const t = n / N, env = Math.sin(Math.PI * t);
        const a = side * wraps * 2 * Math.PI * t;
        return [side * cx + W * env * Math.sin(a), -H / 2 + H * t, env * Math.cos(a)];
      };
      const a = p(i), b = p(i + 1);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const cool = Math.max(0, Math.min(1, Math.hypot(mx, my) / 92));
      const front = (a[2] + b[2]) / 2 > 0;
      s += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
        + '" stroke="' + ramp[Math.round(cool * 23)]
        + '" stroke-width="' + F((front ? 0.8 : 0.55) + 1.05 * cool)
        + '" stroke-opacity="' + F((front ? 0.2 : 0.09) + (front ? 0.6 : 0.28) * cool)
        + '" fill="none" stroke-linecap="round"/>';
    }
    return s;
  };
  return '<svg viewBox="-104 -104 208 208">'
    + lens(-1, SILVER) + lens(1, GOLD)
    + umbra(0, 0, 5.4, WHITEGOLD)
    + '</svg>';
}

// --- X · the dwelling and the throat ----------------------------------------
// The torus and the hyperboloid as one construction on the deck's own ring:
// the dwelling stores in bronze, the passage transports in silver, and the
// waist of the passage falls exactly on the throat circle at one over phi.
// The passage grows quiet where it crosses the plane of the ring.
function dwellingThroat() {
  const R = PHI, r = 1, S = 33, beta = 1.02;
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const proj = (x, y, z) => [x * S, (y * cb - z * sb) * S, y * sb + z * cb];
  // the dwelling: the torus, drawn quietly
  const segs = [];
  for (let m = 0; m < 27; m++) {
    const th = m / 27 * 2 * Math.PI;
    for (let j = 0; j < 26; j++) {
      const at = (ps) => proj((R + r * Math.cos(ps)) * Math.cos(th), (R + r * Math.cos(ps)) * Math.sin(th), r * Math.sin(ps));
      const a = at(j / 26 * 2 * Math.PI), b = at((j + 1) / 26 * 2 * Math.PI);
      segs.push([a, b, (a[2] + b[2]) / 2]);
    }
  }
  let zLo = 1e9, zHi = -1e9;
  for (const sg of segs) { if (sg[2] < zLo) zLo = sg[2]; if (sg[2] > zHi) zHi = sg[2]; }
  segs.sort((p, q) => p[2] - q[2]);
  const bronze = rampOf(BRONZE);
  let body = '';
  for (const [a, b, z] of segs) {
    const t = (z - zLo) / (zHi - zLo);
    body += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
      + '" stroke="' + bronze[Math.round(t * 23)] + '" stroke-width="' + F(0.6 + 0.9 * t)
      + '" stroke-opacity="' + F(0.10 + 0.38 * t) + '" fill="none" stroke-linecap="round"/>';
  }
  // the passage: the hyperboloid through the hole, waist at R - r = 1/phi
  const r0 = R - r, slope = 1.106, silver = rampOf(SILVER);
  let pass = '';
  for (let k = 0; k < 10; k++) {
    const th = k / 10 * 2 * Math.PI;
    for (let j = 0; j < 36; j++) {
      const at = (n) => {
        const z = -2.3 + n / 36 * 4.6;
        const rad = Math.sqrt(r0 * r0 + (z * slope) * (z * slope));
        return [proj(rad * Math.cos(th), rad * Math.sin(th), z), Math.abs(z) / 2.3];
      };
      const [a, ta] = at(j), [b, tb] = at(j + 1);
      const t = Math.max(0, Math.min(1, (ta + tb) / 2));
      pass += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
        + '" stroke="' + silver[Math.round(t * 23)] + '" stroke-width="' + F(0.6 + 1.0 * t)
        + '" stroke-opacity="' + F(0.14 + 0.5 * t) + '" fill="none" stroke-linecap="round"/>';
    }
  }
  // the waist: the throat ring itself, spoken in the room's dashed voice
  const waist = [];
  for (let j = 0; j <= 72; j++) {
    const th = j / 72 * 2 * Math.PI;
    waist.push(proj(r0 * Math.cos(th), r0 * Math.sin(th), 0));
  }
  const waistPath = stroked(pathOf(waist), WHITEGOLD, 1.0, 0.5, '3 5');
  return '<svg viewBox="-104 -104 208 208">' + body + pass + waistPath
    + umbra(0, 0, 4.8, WHITEGOLD) + '</svg>';
}

// --- X · the tree and the return --------------------------------------------
// Crown above, root below, the two cones of an hourglass about the soil line,
// which is the null plane; the circulation closes beyond the tips, and the
// seed holds the crossing, unlit. The branches cool toward the seed.
function breathingTree() {
  const segs = [];
  const grow = (x, y, ang, len, depth) => {
    if (depth === 0 || len < 2.6) return;
    const nx = x + len * Math.cos(ang), ny = y + len * Math.sin(ang);
    segs.push([x, y, nx, ny]);
    grow(nx, ny, ang - 0.50, len * 0.68, depth - 1);
    grow(nx, ny, ang + 0.38, len * 0.70, depth - 1);
  };
  grow(0, 0, -Math.PI / 2, 33, 6);            // the crown
  grow(0, 0, Math.PI / 2 + 0.09, 30, 6);      // the root, a breath aslant
  let maxD = 1;
  for (const [, , x2, y2] of segs) maxD = Math.max(maxD, Math.hypot(x2, y2));
  let s = '<svg viewBox="-104 -104 208 208">';
  // the circulation, closing beyond the tips
  s += stroked('M-56 -64 Q-101 0 -56 64', WHITEGOLD, 0.9, 0.16, '3 6');
  s += stroked('M56 -64 Q101 0 56 64', WHITEGOLD, 0.9, 0.16, '3 6');
  // the soil line: the null plane
  s += stroked('M-95 0L95 0', WHITEGOLD, 0.9, 0.3, '3 5');
  const gold = rampOf(GOLD), silver = rampOf(SILVER);
  for (const [x1, y1, x2, y2] of segs) {
    const ramp = (y1 + y2) / 2 < 0 ? gold : silver;
    const t = Math.max(0, Math.min(1, Math.hypot((x1 + x2) / 2, (y1 + y2) / 2) / maxD));
    s += '<path d="M' + F(x1) + ' ' + F(y1) + 'L' + F(x2) + ' ' + F(y2)
      + '" stroke="' + ramp[Math.round(t * 23)] + '" stroke-width="' + F(0.7 + 1.2 * t)
      + '" stroke-opacity="' + F(0.18 + 0.6 * t) + '" fill="none" stroke-linecap="round"/>';
  }
  // the seed at the crossing
  s += umbra(0, 0, 5, WHITEGOLD);
  return s + '</svg>';
}

// ---------------------------------------------------------------------------
// THE EMISSION SPECTRUM (THE PARTICLE READING, come home 24 July 2026).
// The one figure drawn from the canon's own theorem rather than classical
// geometry: the stable octet as ticks on the charge line, the nineteen
// decays' shed charges as lines. The illustrator's law holds unbent: no
// canon import, no state; the derivation travels as literals, and the pin
// (particleReading.test.ts) re-derives them from the canon, so the figure
// is the same string every time and the drift-guard lives with the pins.
export const EMISSION = {
  stable: [0, 1, 3, 4, 9, 10, 12, 13],                      // |q| of the eight at rest
  lines: { 1: 4, 3: 4, 4: 2, 9: 4, 10: 2, 12: 2, 13: 1 },   // shed |dq| -> count
  decays: 19,
};
function emissionSpectrum() {
  const X = (q) => -100 + (q / 13) * 200;
  const maxN = Math.max(...Object.values(EMISSION.lines));
  let s = '<svg viewBox="-112 -60 224 112">';
  s += stroked('M' + F(X(0)) + ' 24L' + F(X(13)) + ' 24', BRONZE, 1.0, 0.4);
  for (const q of EMISSION.stable) {
    if (q === 0) {
      // the still point: charge zero, the one unlit disc on the line
      s += '<circle cx="' + F(X(0)) + '" cy="24" r="3.4" fill="#0a0b0e" stroke="' + WHITEGOLD
        + '" stroke-width="0.8" stroke-opacity="0.55"/>';
    } else {
      s += '<line x1="' + F(X(q)) + '" y1="24" x2="' + F(X(q)) + '" y2="31" stroke="' + WHITEGOLD
        + '" stroke-width="1.3" stroke-opacity="0.9"/>';
    }
    s += '<text x="' + F(X(q)) + '" y="42" text-anchor="middle" font-size="8.5"'
      + ' fill="rgba(233,230,220,0.5)" font-family="ui-monospace,monospace">' + q + '</text>';
  }
  // the lines cool toward the null: the shed charge nearest stillness dimmest
  for (const [q, n] of Object.entries(EMISSION.lines)) {
    const h = (n / maxN) * 58;
    s += '<rect x="' + F(X(Number(q)) - 2.4) + '" y="' + F(24 - h) + '" width="4.8" height="' + F(h)
      + '" fill="' + GOLD + '" fill-opacity="' + F(0.40 + 0.45 * (Number(q) / 13)) + '"/>';
  }
  return s + '</svg>';
}

export const FIGURES = {
  'emission-spectrum': {
    caption: 'the emission spectrum of the deck: the stable octet as ticks on the charge line, the unlit disc at zero, and the nineteen decays’ shed charges as gold lines, height by how often the canon emits them; the two spectra coincide exactly, and the pin holds the coincidence',
    draw: emissionSpectrum,
  },
  'torus-weather': {
    caption: 'the deck’s own torus, twenty-seven strands of skin: bronze body, the silver throat at one over phi, and the two circles of zero curvature',
    draw: torusWeather,
  },
  'lemniscate-home': {
    caption: 'infinity brought home: the hyperbola, inverted through the circle, closes into the eight; the strand cools into the crossing, and the umbra waits there',
    draw: lemniscateHome,
  },
  'vortex-eight': {
    caption: 'the fourfold on one form: the through in silver, the around in gold, the pull in bronze, and the count in white gold, ticked twenty-seven with the seam doubled; the eight cools into the still point and rekindles out',
    draw: vortexEight,
  },
  'triple-eclipse': {
    caption: 'the cube seen down its own diagonal, inside the hexagon it casts: every cell in its house metal, and at the one centre The Return, the Seed, and The Scar stacked in eclipse',
    draw: tripleEclipse,
  },
  'analemma-eight': {
    caption: 'the analemma, computed from the equation of time: the year burns at its solstice bows and cools through its own crossing',
    draw: analemmaEight,
  },
  'dragon-nodes': {
    caption: 'the two rings hush toward the two nodes, the dragon’s head and tail: the shadow strikes only where the strands have already fallen quiet',
    draw: dragonNodes,
  },
  'rosette-27': {
    caption: 'the rosette of the twenty-seven, carrying the cube’s own order in its original even shape: the Seed’s ring at the heart, then the sixfold, the twelvefold, and the restless eightfold, standing at the square roots of one, two, and three; every middle card at the exact bisector of its two parents, the Scar and the Return, invisible down their own diagonal, holding the vertical; every diameter joins a card to its answer, silver always facing gold',
    draw: rosette27,
  },
  'comma-spiral': {
    caption: 'the circle of fifths, computed just: twelve hops of three against two around the octave ring, every chord cooling as it passes the unstruck centre; the twelfth lands beside home, not upon it, and the gold arc is the comma, the carry that will not vanish',
    draw: commaSpiral,
  },
  'pentagram-well': {
    caption: 'the well of the irrational: pentagram within pentagon within pentagram, each descent a fall of one over phi squared; were the diagonal a ratio the nesting would land, and it never lands; the strand cools toward a floor that is not there',
    draw: pentagramWell,
  },
  'trefoil-entwined': {
    caption: 'the entwinement: the two and the three wound coprime into one strand on the golden torus, the around in gold and the through in silver beneath it; sharing no divisor, the strand cannot fall into rings, and it cools as it swings toward the axis it can never cross',
    draw: trefoilEntwined,
  },
  'three-flows': {
    caption: 'the three flows the sky permits: the rotation in gold, the dwelling; the boost in silver, the arrow; the screw in white gold, the two entwined; no fourth exists, and the poles that anchor them are never lit',
    draw: threeFlows,
  },
  'counter-spirals': {
    caption: 'the birth at the null: two strands wound in mirror, meeting exactly once; where they cross in harmonic ratio they cancel or fuse, and the meeting place, empty of motion and full of permission, is the unstruck seed',
    draw: counterSpirals,
  },
  'dwelling-throat': {
    caption: 'the dwelling and the throat as one construction: the ring that stores in bronze, the passage that transports in silver, the waist falling on the throat circle at one over phi; the passage grows quiet exactly where it crosses the plane of the ring',
    draw: dwellingThroat,
  },
  'breathing-tree': {
    caption: 'the tree breathes about its soil line: crown in gold, root in silver, each a throat descended into branches, the circulation closing beyond the tips; at the crossing the seed, unlit, holds the whole',
    draw: breathingTree,
  },
  'book-cinquefoil': {
    caption: 'the cinquefoil, the (2,5) knot: five crossings of one strand, the frontispiece of the first book',
    draw: bkCinquefoil,
  },
  'book-trefoil': {
    caption: 'the trefoil: one strand, three folds, the simplest knot no smooth motion undoes; the event, the frozen response, the isolation',
    draw: bkTrefoil,
  },
  'book-fig8': {
    caption: 'the figure-eight: the held paradox, two truths crossed so that pulling on one tightens the other',
    draw: bkFig8,
  },
  'book-hopf': {
    caption: 'the Hopf link: two circles bound, neither knotted alone; the wound that lives between two people, not inside either',
    draw: bkHopf,
  },
  'book-borromean': {
    caption: 'the Borromean rings: three circles held only by the third, any pair falling apart the moment the third is removed',
    draw: bkBorromean,
  },
  'book-unknot': {
    caption: 'the unknot: a loop with no true crossing, tangled only in appearance; the difficulty is in recognising that it is already free',
    draw: bkUnknot,
  },
  'book-braid': {
    caption: 'the braid: three strands crossing in pattern, the weave before it closes into a knot',
    draw: bkBraid,
  },
  'book-rift': {
    caption: 'the rift: a loop pinched almost to breaking, a small separate observer beside it, born so the whole would not tear',
    draw: bkRift,
  },
  'book-torus-outline': {
    caption: 'the toroid seen at an angle: the outer silhouette and the opening of the central hole, the shape a fold makes when it stays folded',
    draw: bkTorusOutline,
  },
  'book-torus': {
    caption: 'the toroidal flow: the line rises through the central hole, fans over the top, descends around the outside and re-enters below; the still passage through the centre is the one place unlit',
    draw: bkTorus,
  },
};

export function renderFigure(key) {
  const f = FIGURES[key];
  if (!f) return null;
  return '<figure class="chartfig">' + f.draw()
    + '<figcaption>' + f.caption + '</figcaption></figure>';
}

// ---------------------------------------------------------------------------
// THE KNOT DIAGRAMS OF BOOK ONE. The illustrations of the Topology of Healing,
// Book One (The Shape of Trauma), ported from the book's own press generator
// (scripts/book_shape_of_trauma_pdf.py) so the chart in the room carries what
// the pressed volume carries. The book drew ten line-art knots with
// depth-correct crossing gaps; here the same parametric curves are projected
// and the same hidden-line removal is run, then each strand is shaded by its
// depth under the room's own second palette law: the strand cools as it passes
// behind, so the eye reads the over and the under directly off the line. Pure
// geometry in, one string out, every time.
// ---------------------------------------------------------------------------
function segCross(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [t, u];
  return null;
}
// sample a parametric curve fn(t) -> [x, y, z] over [t0, t1] into n points
function curve(fn, n, t0 = 0, t1 = 2 * Math.PI) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(fn(t0 + (t1 - t0) * i / n));
  return pts;
}
// the diagram: curves = [{pts, closed}], projected into a REACH box, crossings
// hidden on the deeper strand, the visible strand shaded by depth in whitegold
function knotDiagram(curves, dots = [], reach = 82, gapmul = 4.4, lw = 1.6) {
  const xs = [], ys = [];
  for (const cu of curves) for (const p of cu.pts) { xs.push(p[0]); ys.push(p[1]); }
  for (const d of dots) { xs.push(d[0] - d[2], d[0] + d[2]); ys.push(d[1] - d[2], d[1] + d[2]); }
  const minx = Math.min(...xs), maxx = Math.max(...xs);
  const miny = Math.min(...ys), maxy = Math.max(...ys);
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const span = Math.max(maxx - minx, maxy - miny) || 1;
  const s = (2 * reach) / span;
  // project: centre, scale, flip y for screen; depth z kept raw
  const scaled = curves.map((cu) => ({
    p: cu.pts.map((q) => [(q[0] - cx) * s, -(q[1] - cy) * s, q[2]]),
    closed: cu.closed,
  }));
  let zLo = Infinity, zHi = -Infinity;
  for (const cu of scaled) for (const q of cu.p) { if (q[2] < zLo) zLo = q[2]; if (q[2] > zHi) zHi = q[2]; }
  const zSpan = Math.max(1e-6, zHi - zLo);
  // cumulative arc length per curve
  const cum = scaled.map((cu) => {
    const n = cu.p.length, out = [0];
    const rng = cu.closed ? n : n - 1;
    for (let i = 0; i < rng; i++) {
      const a = cu.p[i], b = cu.p[(i + 1) % n];
      out.push(out[out.length - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    return out;
  });
  // every segment, with its bounding box
  const segs = [];
  scaled.forEach((cu, ci) => {
    const n = cu.p.length, rng = cu.closed ? n : n - 1;
    for (let i = 0; i < rng; i++) {
      const a = cu.p[i], b = cu.p[(i + 1) % n];
      segs.push([ci, i, a, b,
        [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]]);
    }
  });
  // the deeper strand at each crossing is hidden a gap-width around the meeting
  const hides = scaled.map(() => []);
  for (let u = 0; u < segs.length; u++) {
    const [c1, i1, a1, b1, bb1] = segs[u];
    for (let v = u + 1; v < segs.length; v++) {
      const [c2, i2, a2, b2, bb2] = segs[v];
      if (bb1[2] < bb2[0] || bb2[2] < bb1[0] || bb1[3] < bb2[1] || bb2[3] < bb1[1]) continue;
      if (c1 === c2) {
        const n = scaled[c1].p.length;
        let d = Math.abs(i1 - i2);
        if (scaled[c1].closed) d = Math.min(d, n - d);
        if (d <= 3) continue;
      }
      const tw = segCross(a1, b1, a2, b2);
      if (!tw) continue;
      const z1 = a1[2] + (b1[2] - a1[2]) * tw[0];
      const z2 = a2[2] + (b2[2] - a2[2]) * tw[1];
      if (z1 < z2) hides[c1].push(cum[c1][i1] + (cum[c1][i1 + 1] - cum[c1][i1]) * tw[0]);
      else hides[c2].push(cum[c2][i2] + (cum[c2][i2 + 1] - cum[c2][i2]) * tw[1]);
    }
  }
  const g = (lw * gapmul) / 2;
  const ramp = rampOf(WHITEGOLD);
  let out = '';
  scaled.forEach((cu, ci) => {
    const n = cu.p.length, total = cum[ci][cum[ci].length - 1];
    const rng = cu.closed ? n : n - 1;
    const hs = hides[ci];
    for (let i = 0; i < rng; i++) {
      const a = cu.p[i], b = cu.p[(i + 1) % n];
      const smid = (cum[ci][i] + cum[ci][i + 1]) / 2;
      let hidden = false;
      for (const s0 of hs) {
        let d = Math.abs(smid - s0);
        if (cu.closed) d = Math.min(d, total - d);
        if (d < g) { hidden = true; break; }
      }
      if (hidden) continue;               // the under-strand's gap
      const zt = ((a[2] + b[2]) / 2 - zLo) / zSpan;   // depth: 1 in front, 0 behind
      out += '<path d="M' + F(a[0]) + ' ' + F(a[1]) + 'L' + F(b[0]) + ' ' + F(b[1])
        + '" stroke="' + ramp[Math.round(zt * 23)] + '" stroke-width="' + F(0.9 + 1.5 * zt)
        + '" stroke-opacity="' + F(0.28 + 0.66 * zt) + '" fill="none" stroke-linecap="round"/>';
    }
  });
  for (const d of dots) {
    out += '<circle cx="' + F((d[0] - cx) * s) + '" cy="' + F(-(d[1] - cy) * s)
      + '" r="' + F(d[2] * s) + '" fill="' + WHITEGOLD + '" fill-opacity="0.85"/>';
  }
  const R = reach + 12;
  return '<svg viewBox="' + F(-R) + ' ' + F(-R) + ' ' + F(2 * R) + ' ' + F(2 * R) + '">' + out + '</svg>';
}

// the ten curve families, verbatim from the book's press generator
function bkTrefoil() {
  return knotDiagram([{ pts: curve((t) => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)], 420), closed: true }]);
}
function bkFig8() {
  return knotDiagram([{ pts: curve((t) => [Math.cos(3 * t + 0.7), Math.cos(2 * t + 0.2), Math.cos(7 * t)], 460), closed: true }]);
}
function bkCinquefoil() {
  return knotDiagram([{ pts: curve((t) => [(1 + 0.72 * Math.cos(2.5 * t)) * Math.cos(t), (1 + 0.72 * Math.cos(2.5 * t)) * Math.sin(t), Math.sin(2.5 * t)], 520, 0, 4 * Math.PI), closed: true }]);
}
function bkUnknot() {
  return knotDiagram([{ pts: curve((t) => [Math.cos(t), Math.sin(t), 0], 200), closed: true }]);
}
function bkHopf() {
  return knotDiagram([
    { pts: curve((t) => [Math.cos(t) - 0.62, Math.sin(t), 0], 320), closed: true },
    { pts: curve((t) => [Math.cos(t) + 0.62, Math.sin(t), 0.5 * Math.sin(t)], 320), closed: true },
  ]);
}
function bkBorromean() {
  const defs = [
    (t) => [Math.cos(t), PHI * Math.sin(t), 0],
    (t) => [0, Math.cos(t), PHI * Math.sin(t)],
    (t) => [PHI * Math.sin(t), 0, Math.cos(t)],
  ];
  const curves = defs.map((f) => {
    const pts = [];
    for (let i = 0; i < 260; i++) {
      const t = 2 * Math.PI * i / 260;
      const [x, y, z] = f(t);
      pts.push([(x - y) / Math.SQRT2, (x + y - 2 * z) / Math.sqrt(6), (x + y + z) / Math.sqrt(3)]);
    }
    return { pts, closed: true };
  });
  return knotDiagram(curves);
}
function bkBraid() {
  const curves = [];
  for (let k = 0; k < 3; k++) {
    const ph = 2 * Math.PI * k / 3, pts = [];
    for (let i = 0; i < 260; i++) {
      const sv = 4 * Math.PI * i / 259;
      pts.push([sv, 0.8 * Math.sin(sv + ph), Math.cos(sv + ph)]);
    }
    curves.push({ pts, closed: false });
  }
  return knotDiagram(curves, [], 96);
}
function bkRift() {
  const loop = [];
  for (let i = 0; i < 420; i++) {
    const t = 2 * Math.PI * i / 420, pinch = 0.5 * (1 + Math.cos(t));
    loop.push([Math.cos(t), Math.sin(t) * (0.12 + 0.88 * pinch) * 0.62, 0]);
  }
  const small = curve((t) => [-1.42 + 0.19 * Math.cos(t), 0.19 * Math.sin(t), 0], 140);
  return knotDiagram([{ pts: loop, closed: true }, { pts: small, closed: true }], [[-1.42, 0, 0.032]], 92);
}
// the torus, seen in flow: lines rise through the hole, fan over the top,
// descend around the outside and re-enter below (book's TorusArt, at the room's
// palette). the still passage through the centre reads as the null.
function bkTorus() {
  const cx = 0, cy = 0, s = 0.72;
  const loops = [[34, 44, 0.86], [62, 62, 0.92], [92, 76, 0.96], [120, 86, 1.0]];
  let out = '<svg viewBox="-104 -104 208 208">';
  for (const [w0, a0, k] of loops) {
    const w = w0 * s, a = a0 * s;
    for (const sgn of [1, -1]) {
      const x = cx + sgn * w;
      out += '<path d="M' + F(cx) + ' ' + F(cy + a)
        + 'C' + F(cx + sgn * w * k) + ' ' + F(cy + a) + ' ' + F(x) + ' ' + F(cy + a * 0.55) + ' ' + F(x) + ' ' + F(cy)
        + 'C' + F(x) + ' ' + F(cy - a * 0.55) + ' ' + F(cx + sgn * w * k) + ' ' + F(cy - a) + ' ' + F(cx) + ' ' + F(cy - a)
        + '" fill="none" stroke="' + WHITEGOLD + '" stroke-width="1.3" stroke-opacity="0.7" stroke-linecap="round"/>';
    }
  }
  const chev = (x, y, up, sz) => {
    const d = up ? -sz : sz;
    return '<path d="M' + F(x - sz * 0.64) + ' ' + F(y + d) + 'L' + F(x) + ' ' + F(y) + 'L' + F(x + sz * 0.64) + ' ' + F(y + d)
      + '" fill="none" stroke="' + WHITEGOLD + '" stroke-width="1.3" stroke-opacity="0.7" stroke-linecap="round" stroke-linejoin="round"/>';
  };
  const sz = 7 * s;
  for (const idx of [1, 3]) { const w = loops[idx][0] * s; out += chev(cx + w, cy + sz * 0.4, false, sz) + chev(cx - w, cy + sz * 0.4, false, sz); }
  for (const off of [-28, 0, 28]) {
    const y0 = cy - off * s;   // flip y for screen
    out += '<line x1="' + F(cx) + '" y1="' + F(y0 + 10 * s) + '" x2="' + F(cx) + '" y2="' + F(y0 - 8 * s)
      + '" stroke="' + WHITEGOLD + '" stroke-width="1.3" stroke-opacity="0.55" stroke-linecap="round"/>';
    out += chev(cx, y0 - 8 * s, false, sz * 0.8);
  }
  // the central hole: the still passage, unlit, by its rim only
  out += '<circle cx="0" cy="0" r="7" fill="#0a0b0e" stroke="' + WHITEGOLD + '" stroke-width="0.8" stroke-opacity="0.4"/>';
  return out + '</svg>';
}
// the torus at a slight angle: outer silhouette plus the hole opening
function bkTorusOutline() {
  const w = 190, h = 130, cx = 0, cy = 0;
  const rx = w * 0.44, ry = h * 0.40;
  const hy = cy - ry * 0.20, hx = rx * 0.50, hh = ry * 0.34;   // y flipped
  return '<svg viewBox="-104 -78 208 156">'
    + '<ellipse cx="0" cy="0" rx="' + F(rx) + '" ry="' + F(ry) + '" fill="none" stroke="' + WHITEGOLD + '" stroke-width="1.4" stroke-opacity="0.75"/>'
    + '<path d="M' + F(cx - hx) + ' ' + F(hy)
    + 'C' + F(cx - hx * 0.45) + ' ' + F(hy - hh) + ' ' + F(cx + hx * 0.45) + ' ' + F(hy - hh) + ' ' + F(cx + hx) + ' ' + F(hy)
    + 'C' + F(cx + hx * 0.45) + ' ' + F(hy + hh) + ' ' + F(cx - hx * 0.45) + ' ' + F(hy + hh) + ' ' + F(cx - hx) + ' ' + F(hy)
    + '" fill="none" stroke="' + WHITEGOLD + '" stroke-width="1.4" stroke-opacity="0.75" stroke-linecap="round"/></svg>';
}
