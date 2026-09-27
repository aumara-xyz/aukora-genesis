// LUMINARA FIELD — the reading depths, derived and never authored.
//
// D28's own ruling, executed: the 9 reads by cell, refining a finished cast
// that always stands; the 27 reads as THE PERMUTATION, fixed points as
// cards at home, swaps as dyadic tensions, long cycles as carry-loops, the
// wrong-address remainder drawn as geometry. Nothing here writes a meaning:
// every line is composed from the canon's own relations (counter, becoming,
// house, silence) and from the arithmetic of the deal itself. The 729 stay
// parked, as ruled: nothing may say what card and cell do not jointly say.
//
// Pure module: canon in, structure out. No DOM, no state, no randomness.

import {
  CARDS, cardOf, codeOf, codeMarks, isSilent, SILENCES, knotOf,
  counterOf, becomingOf, WIDE, DEPTH_WORDS, TIME_WORDS, POSITIONS,
} from './luminara-canon.js';

const STATE_WORDS = ['the stillness', 'the flow', 'the turning'];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

// the counting-circle distance between two cells: how far from home a card
// travelled, measured on the deck's own circle (the seam counts as one step)
export const circleDistance = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 27 - d);
};

// ===========================================================================
// THE LANDING · WHAT A CARD AND ITS CELL JOINTLY SAY
// ===========================================================================
// Cell k is the home of card k, so a card and a cell index the same twenty-
// seven codes and their difference is well defined: layer by layer, modulo
// three. That difference is itself a card, which lets all 729 landings speak
// without a line of authorship. The 729 authored texts stay parked exactly as
// ruled; this is the other road, derivation rather than writing, and the
// standing rule about cards at home is its identity case: the interval is the
// Seed precisely when the card sits in its own seat.
export const landingOf = (n, k) => {
  const a = codeOf(n), b = codeOf(k);
  return 9 * ((a[0] - b[0] + 3) % 3)
    + 3 * ((a[1] - b[1] + 3) % 3)
    + ((a[2] - b[2] + 3) % 3) + 1;
};

// The landing read as displacement. Both halves are the interval card's own
// winding pair, nothing added. BREADTH (p) counts how many layers moved: one
// more than the number of differing layers, seven when all three differ, so
// across a field it falls into the deck's own shells, one, six, twelve,
// eight. THROW (q) is the signed amplitude, zero at the Seed, which is the
// node, and thirteen either way at the Scar and the Return, the antinodes.
// All three weights are odd, so the parity of the throw is the parity of the
// breadth: an even throw means exactly two layers moved.
export function landingWave(n, k) {
  const interval = landingOf(n, k);
  const { p, q } = knotOf(interval);
  return {
    interval, breadth: p, throw: q,
    atHome: interval === 1,
    atAntinode: Math.abs(q) === 13,
  };
}

// one derived line for a single landing: every clause is arithmetic speaking
export function landingLine(n, k) {
  const w = landingWave(n, k);
  if (w.atHome) return cardOf(n).name + ' stands at home: nothing displaced.';
  const layers = w.breadth === 7 ? 'all three layers'
    : w.breadth === 3 ? 'two layers' : 'one layer';
  return cardOf(n).name + ' sits in ' + cardOf(k).name + '’s seat; the interval is '
    + cardOf(w.interval).name + ', ' + layers + ' displaced, throw '
    + (w.throw > 0 ? '+' : '') + w.throw
    + (w.atAntinode ? ': the furthest the deck reaches.' : '.');
}

// ===========================================================================
// THE 27 · THE PERMUTATION
// ===========================================================================
// cells: the unfolding's own array — cells[i].n is the card dealt into home
// position i+1. The reading follows each CARD's journey: seatOf(n) is the
// home whose place card n took, and the cycles of that map are the deal.
export function fieldReadingOf(cells) {
  const seat = new Array(28).fill(0);
  cells.forEach((c, i) => { seat[c.n] = i + 1; });

  const seen = new Array(28).fill(false);
  const cycles = [];
  for (let n = 1; n <= 27; n++) {
    if (seen[n]) continue;
    const cyc = [];
    let x = n;
    while (!seen[x]) { seen[x] = true; cyc.push(x); x = seat[x]; }
    cycles.push(cyc);
  }

  const fixed = cycles.filter((c) => c.length === 1).map((c) => c[0]);
  const swaps = cycles.filter((c) => c.length === 2);
  const counterSwaps = swaps.filter(([a, b]) => counterOf(a) === b);
  const loops = cycles.filter((c) => c.length >= 3);

  // the deal's own invariants, all real arithmetic:
  // parity — the chirality of the whole deal, in the deck's mirror language
  const parity = (27 - cycles.length) % 2 === 0 ? 'even' : 'odd';
  // order — re-deal this same pattern so many times and every card is home:
  // the deal's return period, the field's own exeligmos
  const order = cycles.reduce((o, c) => lcm(o, c.length), 1);
  // circleDisplacement — total distance from home, measured on the counting
  // circle (the wheel's own metric). Named "circle-", not plain
  // "displacement": a second, disagreeing measure stands beside it below, and
  // which one is the deck's true distance is an open question, held open on
  // purpose. See docs/map-room/THE_THIRD_SUBSTRATE.md.
  const circleDisplacement = CARDS.reduce((s, c) => s + circleDistance(c.n, seat[c.n]), 0);
  // whether the still point itself moved
  const seedAtHome = seat[1] === 1;
  // every card's landing: the interval between it and the seat it took
  const landings = CARDS.map((c) => ({ n: c.n, cell: seat[c.n], ...landingWave(c.n, seat[c.n]) }));
  // intervalDisplacement ("throw") — the same question, measured by the
  // interval's own layers rather than by steps around the wheel. The two
  // disagree, and the disagreement is information, not noise: across the
  // seam the Seed and the Return are neighbours by the circle (distance one)
  // and at full throw by the interval (the Scar, thirteen). Neither name
  // claims to be THE distance, on purpose.
  const intervalDisplacement = landings.reduce((s, l) => s + Math.abs(l.throw), 0);

  return {
    seat: seat.slice(1), cycles, fixed, swaps, counterSwaps, loops,
    parity, order, circleDisplacement, seedAtHome, landings, intervalDisplacement,
    expectedFixed: 1,   // a random deal expects exactly one card at home
  };
}

// one derived line per cycle: the carry-chain, spoken in the deal's own terms
export function cycleLine(cyc) {
  const name = (n) => cardOf(n).name;
  if (cyc.length === 1) {
    return name(cyc[0]) + ' stands at home.';
  }
  if (cyc.length === 2) {
    const [a, b] = cyc;
    return name(a) + ' and ' + name(b) + ' have exchanged seats'
      + (counterOf(a) === b
        ? ': a card and its own answer, the involution surfacing in the deal.'
        : ': a dyadic tension across the field.');
  }
  const steps = cyc.map((n, i) => {
    const next = cyc[(i + 1) % cyc.length];
    return name(n) + ' sits in ' + name(next) + '’s seat';
  });
  return 'A carry-loop of ' + cyc.length + ': ' + steps.join('; ')
    + '; the remainder returns where it began.';
}

// the headline of the whole field, counted honestly: weather, never verdict
export function fieldHeadline(field) {
  const k = field.fixed.length;
  const home = k === 0 ? 'No card stands at home'
    : k === 1 ? 'One card stands at home'
    : k + ' cards stand at home';
  return home + ' (chance expects one). The deal’s hand is ' + field.parity
    + '; dealt again in this pattern, every card returns home after '
    + field.order + ' rounds.';
}

// ===========================================================================
// THE 9 · THE WEAVE
// ===========================================================================
// cast: the standing three. wideCells: wideReadingOf's own cells, in WIDE
// order (root world/between/heart, then present, then becoming). The outer
// three stand as the whole of each column, as ruled: the weave adds the
// lines and the relations the grid holds but never speaks.
export function nineWeaveOf(cast, wideCells) {
  const columns = [0, 1, 2].map((t) => ({
    time: POSITIONS[t].key,
    word: TIME_WORDS[POSITIONS[t].key],
    coarse: cast[t],
    cells: wideCells.slice(t * 3, t * 3 + 3),
  }));

  // the three lines: the world, the between, the heart, each walked across
  // the tenses. The line's motion is read from each card's own house, the
  // outer digit: derived, never assigned.
  const lines = [0, 1, 2].map((d) => {
    const cellsAt = [0, 1, 2].map((t) => wideCells[t * 3 + d]);
    return {
      depth: d,
      word: DEPTH_WORDS[d],
      cells: cellsAt,
      motion: cellsAt.map((c) => STATE_WORDS[codeOf(c.n)[0]]),
    };
  });

  // the relations inside the spread, from the canon alone
  const ns = wideCells.map((c) => c.n);
  const tensions = [];
  for (let i = 0; i < 9; i++) {
    for (let j = i + 1; j < 9; j++) {
      if (counterOf(ns[i]) === ns[j]) {
        tensions.push({ a: wideCells[i], b: wideCells[j] });
      }
    }
  }
  const currents = [];
  for (let i = 0; i < 9; i++) {
    const bec = becomingOf(ns[i]);
    if (bec == null) continue;
    const j = ns.indexOf(bec);
    if (j >= 0 && j !== i) currents.push({ from: wideCells[i], to: wideCells[j] });
  }
  const silences = wideCells.filter((c) => isSilent(c.n))
    .map((c) => ({ cell: c, asks: SILENCES[c.n].asks }));

  return { columns, lines, tensions, currents, silences };
}

// the weave, spoken: one derived line per thread, nothing authored
export function weaveLines(weave) {
  const out = [];
  for (const line of weave.lines) {
    out.push(line.word + ' runs ' + line.motion.join(' · ') + ': '
      + line.cells.map((c) => c.name).join(', ') + '.');
  }
  for (const t of weave.tensions) {
    out.push(t.a.name + ' (' + t.a.gloss + ') and ' + t.b.name + ' (' + t.b.gloss
      + ') answer one another: a dyad standing open across the nine.');
  }
  for (const c of weave.currents) {
    out.push(c.from.name + ' settles toward ' + c.to.name + ', and ' + c.to.name
      + ' stands in ' + c.to.gloss + ': the current runs inside the spread.');
  }
  for (const s of weave.silences) {
    out.push(s.cell.name + ' keeps its silence in ' + s.cell.gloss
      + ' and asks for ' + s.asks + '.');
  }
  return out;
}
