// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// Aukora Spatial · THE LIVING CUBE: the engine.
//
// The deck as a turnable 3×3×3, per docs/THE_LIVING_CUBE_PLAN.md (the plan was
// sealed before this file existed; this is the single sweep). The mapping is
// DISCOVERED, not designed: the Rubik piece taxonomy is the tempered rule's
// taxonomy exactly: the hidden core is the Seed (p = 1, never moves), the six
// fixed centres are the one-moving cards (p = 2), the twelve edges the
// two-moving (p = 3), the eight corners the restless eight (p = 7, redoubled).
// One face is the nine cards of one depth-state: one centre, four edges, four
// corners.
//
// This module is PURE: state, moves, the cast, the reduction, the heat. The
// rite and its liturgy live in luminara-cube.html. Pinned by
// core/tests/livingCube.test.ts: the way home is a test, not a promise.
//
// THE INVARIANTS (why the device can promise a return before the cast):
//  · the Seed and the six centres never translate: the convergence cannot be
//    scrambled, only obscured;
//  · the only operations are turns: re-embeddings, never severings, so the
//    forbidden cut is unperformable by construction;
//  · the return is the cast's own word, inverted and REDUCED: the drift
//    retraced with its self-cancelling noise removed. What cancels was never
//    real; the reduced length is the true depth of the drift.

import { codeOf } from './luminara-canon.js';

// the ratified axis convention (plan §7.3): x = relation (lateral, the
// between), y = field (vertical, the world's axis), z = core (toward the
// querent). Signed states: flow +1 · still 0 · turning −1.
export const DEPTH_OF_AXIS = ['the relation', 'the field', 'the core'];
const sgn = (s) => (s === 1 ? 1 : s === 2 ? -1 : 0);

// home coordinate of card n: codeOf gives [field, relation, core]
export function homeOf(n) {
  const d = codeOf(n);
  return [sgn(d[1]), sgn(d[0]), sgn(d[2])];
}

export function classOf(n) {
  const moving = codeOf(n).filter((s) => s !== 0).length;
  return ['core', 'centre', 'edge', 'corner'][moving];
}

// state: 27 pieces, each { n, pos }, the manifold's points
export function solvedState() {
  const s = [];
  for (let n = 1; n <= 27; n++) s.push({ n, pos: homeOf(n) });
  return s;
}
export const isSolved = (state) =>
  state.every((pc) => { const h = homeOf(pc.n); return pc.pos[0] === h[0] && pc.pos[1] === h[1] && pc.pos[2] === h[2]; });

// the twelve moves: six faces (depth × motion-side) by two directions.
// A face is (axis, side): side +1 is that depth's flow face, −1 its turning
// face. A quarter-turn of a face carries its nine cards, one sentence in the
// deck's grammar: one depth, taken through one motion.
export const MOVES = [];
for (let axis = 0; axis < 3; axis++)
  for (const side of [1, -1])
    for (const dir of [1, -1]) MOVES.push({ axis, side, dir });

export const labelFace = (m) => DEPTH_OF_AXIS[m.axis] + ' · ' + (m.side === 1 ? 'flow' : 'turning');
export const labelMove = (m) => labelFace(m) + (m.dir === 1 ? ' ⟳' : ' ⟲');

// 90° about an axis; the handedness is a rendering convention, pinned by the
// tests as order-4 and layer-preserving, never claimed as canon.
export function rotatePos(pos, axis, dir) {
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const p = pos.slice();
  const a = pos[u], b = pos[v];
  // + 0 folds the negative zero back into nought (the Seed's own gotcha:
  // the deck's centre is 0, and −0 is not a place)
  if (dir === 1) { p[u] = -b + 0; p[v] = a; } else { p[u] = b; p[v] = -a + 0; }
  return p;
}

export function applyMove(state, m) {
  return state.map((pc) =>
    pc.pos[m.axis] === m.side ? { n: pc.n, pos: rotatePos(pc.pos, m.axis, m.dir) } : pc);
}
export function applyWord(state, word) {
  for (const m of word) state = applyMove(state, m);
  return state;
}

// --------------------------------------------------------------------------
// THE CAST (plan gate 2). The ladder's avalanche, restated device-side (the
// canon module keeps its own unexported); same construction, same honesty:
// unsteerable entropy in, a deterministic replayable walk out.
function hashSeed(str) {
  let h1 = 0x9e3779b9, h2 = 0x85ebca77, h3 = 0xc2b2ae3d, h4 = 0x27d4eb2f;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ k, 0x85ebca77); h2 = Math.imul(h2 ^ k, 0xc2b2ae3d);
    h3 = Math.imul(h3 ^ k, 0x27d4eb2f); h4 = Math.imul(h4 ^ k, 0x9e3779b9);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const r = (t + d) | 0; c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

// 81 quarter-turns: 3⁴, the deck's own next power, past the mixing cutoff,
// the walk on the group converging toward uniformity, sampled finitely.
// "Representatively infinite turns, falling finitely into one position."
export function scrambleWord(seedStr, count = 81) {
  const rnd = sfc32(...hashSeed(String(seedStr)));
  const word = [];
  for (let i = 0; i < count; i++) word.push(MOVES[Math.floor(rnd() * MOVES.length)]);
  return word;
}

// the declared cast (Reader's Protocol: numbers and source before meaning)
export function castDeclaration(seedStr, drandRound) {
  return 'the cast: 81 turnings · committed, replayable'
    + (drandRound ? ' · drand round ' + drandRound : ' · the beacon unreachable; your moments and this device’s clock alone')
    + ' · seed: ' + seedStr;
}

// --------------------------------------------------------------------------
// THE RETURN (plan gate 4). Inverse, then reduce: adjacent same-face runs
// combine mod 4 and vanish at nought. What cancels was never real; what
// remains is the essential knot-work. The reduced length is the true depth.
export const inverseWord = (word) => word.slice().reverse().map((m) => ({ axis: m.axis, side: m.side, dir: -m.dir }));

export function reduceWord(word) {
  const runs = [];
  for (const m of word) {
    const last = runs[runs.length - 1];
    if (last && last.axis === m.axis && last.side === m.side) {
      last.net = (((last.net + m.dir) % 4) + 4) % 4;
      if (last.net === 0) runs.pop();
    } else {
      runs.push({ axis: m.axis, side: m.side, net: ((m.dir % 4) + 4) % 4 });
    }
  }
  const out = [];
  for (const r of runs) {
    if (r.net === 1) out.push({ axis: r.axis, side: r.side, dir: 1 });
    else if (r.net === 3) out.push({ axis: r.axis, side: r.side, dir: -1 });
    else if (r.net === 2) out.push({ axis: r.axis, side: r.side, dir: 1 }, { axis: r.axis, side: r.side, dir: 1 });
  }
  return out;
}

export const returnWord = (scramble) => reduceWord(inverseWord(scramble));

// --------------------------------------------------------------------------
// THE WITNESSING (plan gate 3).
// displacement: how far a card stands from home (the exile's distance)
export function displacementOf(pc) {
  const h = homeOf(pc.n);
  return Math.abs(pc.pos[0] - h[0]) + Math.abs(pc.pos[1] - h[1]) + Math.abs(pc.pos[2] - h[2]);
}

// heat: how much of the way home passes through each card, the map of the
// knots that will likely need embedding. Centres spin in place and the core
// never rides a face; heat belongs to the carried.
export function heatOf(state, word) {
  const heat = {};
  let s = state;
  for (const m of word) {
    for (const pc of s) {
      if (pc.pos[m.axis] === m.side) {
        const c = classOf(pc.n);
        if (c === 'edge' || c === 'corner') heat[pc.n] = (heat[pc.n] || 0) + 1;
      }
    }
    s = applyMove(s, m);
  }
  return heat;
}

// drift: from this state, which of the twelve turns would lengthen the way
// home: the map of the likely pathways of drift from the harmonic resonance.
export function driftOf(scramble) {
  const base = returnWord(scramble).length;
  return MOVES.map((m) => ({
    move: m,
    delta: reduceWord(inverseWord(scramble.concat([m]))).length - base,
  }));
}
