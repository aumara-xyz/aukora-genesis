// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE FIELD'S PINS — the reading depths held to D28's own ruling. The 27
// reads as the permutation, so the decomposition must be a true one: cycles
// that partition the deck, a parity that agrees with an independent count,
// an order that actually returns every card home. The 9 reads as the weave,
// so the refinement law is pinned: the outer three stand, and every
// relation the weave names must be the canon's own. And the expectation is
// honest: a random deal expects one card at home, measured here rather
// than asserted.

import { describe, expect, test } from 'vitest';
import { drawOne, counterOf, becomingOf, isSilent } from '../../spatial/app/luminara-canon.js';
import { unfoldedReadingOf, wideReadingOf } from '../../spatial/app/luminara-81.js';
import {
  fieldReadingOf, cycleLine, fieldHeadline, circleDistance,
  nineWeaveOf, weaveLines, landingOf, landingWave, landingLine,
} from '../../spatial/app/luminara-field.js';
import { codeOf, knotOf, cardOf } from '../../spatial/app/luminara-canon.js';

const SEEDS = ['bench3|71774000.1784689426335', 'bench3|1.2', 'bench3|424242.99', 'bench3|7.777'];
const fieldOf = (seed: string) => fieldReadingOf(unfoldedReadingOf(seed).cells);

describe('THE 27 — a true permutation, truly decomposed', () => {
  test('the cycles partition the deck and close on themselves', () => {
    for (const seed of SEEDS) {
      const f = fieldOf(seed);
      const all = f.cycles.flat().sort((a: number, b: number) => a - b);
      expect(all).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      for (const cyc of f.cycles) {
        for (let i = 0; i < cyc.length; i++) {
          expect(f.seat[cyc[i] - 1]).toBe(cyc[(i + 1) % cyc.length]);
        }
      }
    }
  });

  test('parity agrees with an independent transposition count', () => {
    for (const seed of SEEDS) {
      const f = fieldOf(seed);
      // sort the seat map by adjacent swaps and count them: the sign again
      const arr = f.seat.slice();
      let swapsUsed = 0;
      for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length - 1; j++) {
          if (arr[j] > arr[j + 1]) { [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]]; swapsUsed++; }
        }
      }
      expect(f.parity).toBe(swapsUsed % 2 === 0 ? 'even' : 'odd');
    }
  });

  test('the order returns every card home, exactly', () => {
    for (const seed of SEEDS) {
      const f = fieldOf(seed);
      const apply = (times: number) => {
        let cur = Array.from({ length: 27 }, (_, i) => i + 1);
        for (let k = 0; k < times; k++) cur = cur.map((n) => f.seat[n - 1]);
        return cur;
      };
      expect(apply(f.order)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      if (f.order > 1) {
        expect(apply(1)).not.toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      }
    }
  });

  test('the parts are what they claim: homes, swaps, counter-swaps, loops', () => {
    for (const seed of SEEDS) {
      const f = fieldOf(seed);
      for (const n of f.fixed) expect(f.seat[n - 1]).toBe(n);
      for (const [a, b] of f.swaps) {
        expect(f.seat[a - 1]).toBe(b);
        expect(f.seat[b - 1]).toBe(a);
      }
      for (const [a, b] of f.counterSwaps) expect(counterOf(a)).toBe(b);
      for (const cyc of f.loops) expect(cyc.length).toBeGreaterThanOrEqual(3);
      expect(f.fixed.length + f.swaps.length * 2 + f.loops.flat().length).toBe(27);
    }
  });

  test('the deal is deterministic from its seed', () => {
    const a = JSON.stringify(fieldOf(SEEDS[0]));
    const b = JSON.stringify(fieldOf(SEEDS[0]));
    expect(a).toBe(b);
  });

  test('chance expects one at home, and the measurement agrees', () => {
    let total = 0;
    const RUNS = 150;
    for (let i = 0; i < RUNS; i++) total += fieldOf('bench3|' + i + '.' + (i * 7 + 3)).fixed.length;
    const mean = total / RUNS;
    expect(mean).toBeGreaterThan(0.6);
    expect(mean).toBeLessThan(1.5);
  });

  test('the circle distance is the counting circle’s own', () => {
    expect(circleDistance(1, 27)).toBe(1);    // across the seam
    expect(circleDistance(1, 14)).toBe(13);   // the far side
    expect(circleDistance(5, 5)).toBe(0);
    expect(circleDistance(3, 24)).toBe(circleDistance(24, 3));
  });

  test('the lines speak the ruling’s own registers', () => {
    const f = fieldOf(SEEDS[0]);
    expect(fieldHeadline(f)).toContain('chance expects one');
    for (const cyc of f.cycles) {
      const line = cycleLine(cyc);
      if (cyc.length === 1) expect(line).toContain('at home');
      if (cyc.length === 2) expect(line).toContain(counterOf(cyc[0]) === cyc[1] ? 'involution' : 'tension');
      if (cyc.length >= 3) expect(line).toContain('carry-loop');
    }
  });
});

describe('THE LANDING — the 729 derived, never authored', () => {
  const ALL: [number, number][] = [];
  for (let n = 1; n <= 27; n++) for (let k = 1; k <= 27; k++) ALL.push([n, k]);

  test('every landing sounds a real card, and the map is exactly uniform', () => {
    const tally = new Array(28).fill(0);
    for (const [n, k] of ALL) {
      const iv = landingOf(n, k);
      expect(iv).toBeGreaterThanOrEqual(1);
      expect(iv).toBeLessThanOrEqual(27);
      tally[iv]++;
    }
    // 729 landings over 27 intervals: each card is the interval of exactly 27
    for (let i = 1; i <= 27; i++) expect(tally[i]).toBe(27);
  });

  test('the standing rule is the identity case: the Seed means home', () => {
    for (const [n, k] of ALL) expect(landingOf(n, k) === 1).toBe(n === k);
  });

  test('swapping card and cell yields the counter interval', () => {
    for (const [n, k] of ALL) expect(landingOf(k, n)).toBe(counterOf(landingOf(n, k)));
  });

  test('a card in its becoming’s seat sounds its own turning mask', () => {
    for (let n = 1; n <= 27; n++) {
      const b = becomingOf(n);
      if (b === null) continue;
      const d = codeOf(n);
      const mask = 9 * (d[0] === 2 ? 2 : 0) + 3 * (d[1] === 2 ? 2 : 0) + (d[2] === 2 ? 2 : 0) + 1;
      expect(landingOf(n, b)).toBe(mask);
    }
    // and a card in its counter's seat sounds its counter
    for (let n = 1; n <= 27; n++) expect(landingOf(n, counterOf(n))).toBe(counterOf(n));
  });

  test('one card passing all cells sounds all 27 intervals, each once', () => {
    for (let n = 1; n <= 27; n++) {
      const seen = new Set<number>();
      for (let k = 1; k <= 27; k++) seen.add(landingOf(n, k));
      expect(seen.size).toBe(27);
    }
  });

  test('breadth counts the displaced layers, and falls into the shells', () => {
    const perCard: Record<number, number> = { 1: 0, 2: 0, 3: 0, 7: 0 };
    for (const [n, k] of ALL) {
      const differing = codeOf(n).filter((d: number, i: number) => d !== codeOf(k)[i]).length;
      const w = landingWave(n, k);
      expect(w.breadth).toBe(differing === 3 ? 7 : 1 + differing);
      perCard[w.breadth]++;
    }
    // one, six, twelve, eight: the deck's own shells, per card
    expect(perCard[1] / 27).toBe(1);
    expect(perCard[2] / 27).toBe(6);
    expect(perCard[3] / 27).toBe(12);
    expect(perCard[7] / 27).toBe(8);
  });

  test('the throw is the wave: node at the Seed, antinodes at thirteen', () => {
    const shells: Record<number, number> = {};
    for (const [n, k] of ALL) {
      const w = landingWave(n, k);
      expect(w.throw).toBe(knotOf(w.interval).q);
      shells[Math.abs(w.throw)] = (shells[Math.abs(w.throw)] || 0) + 1;
      // maximum throw is unreachable without total displacement
      if (w.atAntinode) expect(w.breadth).toBe(7);
    }
    expect(shells[0]).toBe(27);                       // the node: one per card, all at home
    for (let a = 1; a <= 13; a++) expect(shells[a]).toBe(54);   // a counter-pair either side
    expect(Math.abs(knotOf(14).q)).toBe(13);          // The Scar
    expect(Math.abs(knotOf(27).q)).toBe(13);          // The Return
  });

  test('the parity of the throw is the parity of the breadth', () => {
    // all three weights are odd, so an odd number of displaced layers makes
    // an odd throw: a reader hearing an even throw knows two layers moved
    for (const [n, k] of ALL) {
      const w = landingWave(n, k);
      const layers = w.breadth === 7 ? 3 : w.breadth - 1;
      expect(Math.abs(w.throw) % 2).toBe(layers % 2);
    }
  });

  test('the interval carries what the counting circle destroys', () => {
    // across the seam the Seed and the Return are neighbours; their interval
    // is the Scar, at full throw. The two measures disagree, and must.
    expect(circleDistance(1, 27)).toBe(1);
    expect(landingOf(1, 27)).toBe(14);
    expect(landingWave(1, 27).atAntinode).toBe(true);
  });

  test('the field reports every landing, agreeing with the primitive', () => {
    for (const seed of SEEDS) {
      const f = fieldOf(seed);
      expect(f.landings.length).toBe(27);
      let sum = 0;
      for (const l of f.landings) {
        expect(l.cell).toBe(f.seat[l.n - 1]);
        expect(l.interval).toBe(landingOf(l.n, l.cell));
        expect(l.atHome).toBe(f.fixed.includes(l.n));
        sum += Math.abs(l.throw);
      }
      expect(f.intervalDisplacement).toBe(sum);
    }
  });

  test('the interval table is a Latin square of order twenty-seven', () => {
    for (let n = 1; n <= 27; n++) {
      const row = new Set<number>();
      for (let k = 1; k <= 27; k++) row.add(landingOf(n, k));
      expect(row.size).toBe(27);
    }
    for (let k = 1; k <= 27; k++) {
      const col = new Set<number>();
      for (let n = 1; n <= 27; n++) col.add(landingOf(n, k));
      expect(col.size).toBe(27);
    }
  });

  test('every card read as an interval is a motion of the whole deck', () => {
    const permOf = (c: number) => {
      const p = new Array(28).fill(0);
      for (let n = 1; n <= 27; n++) for (let k = 1; k <= 27; k++) if (landingOf(n, k) === c) p[n] = k;
      return p;
    };
    for (let c = 1; c <= 27; c++) {
      const p = permOf(c);
      expect(new Set(p.slice(1)).size).toBe(27);          // a genuine permutation
      let fixed = 0;
      for (let n = 1; n <= 27; n++) if (p[n] === n) fixed++;
      if (c === 1) {
        expect(fixed).toBe(27);                            // the Seed's motion is stillness
      } else {
        expect(fixed).toBe(0);                             // every other motion moves everything
        // and returns after exactly three, never sooner
        let once = p.slice(), twice = once.map((_, i) => (i === 0 ? 0 : p[once[i]]));
        const thrice = twice.map((_, i) => (i === 0 ? 0 : p[twice[i]]));
        expect(twice.slice(1).every((v, i) => v === i + 1)).toBe(false);
        expect(thrice.slice(1).every((v, i) => v === i + 1)).toBe(true);
      }
    }
  });

  test('the motions compose exactly as the deck adds', () => {
    // the 27 translations are the deck acting on itself: element and motion agree
    const permOf = (c: number) => {
      const p = new Array(28).fill(0);
      for (let n = 1; n <= 27; n++) for (let k = 1; k <= 27; k++) if (landingOf(n, k) === c) p[n] = k;
      return p;
    };
    const add = (a: number, b: number) => {
      const ca = codeOf(a), cb = codeOf(b);
      return 9 * ((ca[0] + cb[0]) % 3) + 3 * ((ca[1] + cb[1]) % 3) + ((ca[2] + cb[2]) % 3) + 1;
    };
    for (let a = 1; a <= 27; a++) {
      for (let b = 1; b <= 27; b++) {
        const pa = permOf(a), pb = permOf(b), ps = permOf(add(a, b));
        for (let n = 1; n <= 27; n++) expect(pb[pa[n]]).toBe(ps[n]);
      }
    }
  });

  test('the line speaks derived registers only', () => {
    expect(landingLine(5, 5)).toContain('at home');
    const moved = landingLine(1, 27);
    expect(moved).toContain(cardOf(14).name);      // the interval, named
    expect(moved).toContain('all three layers');   // the breadth, counted
    expect(moved).toContain('furthest');           // the antinode, flagged
  });
});

describe('THE 9 — the weave under the refinement law', () => {
  const castOf = (seed: string) => {
    const cast: number[] = [];
    for (let i = 0; i < 3; i++) cast.push(drawOne(seed + '|' + (i + 1), cast));
    return cast;
  };

  test('the outer three stand as the whole of each column', () => {
    for (const seed of SEEDS) {
      const cast = castOf(seed);
      const w = wideReadingOf(seed, cast);
      const weave = nineWeaveOf(cast, w.cells);
      weave.columns.forEach((col: any, t: number) => {
        expect(col.coarse).toBe(cast[t]);
        expect(col.cells.length).toBe(3);
      });
      // the nine refine, never repeat, the standing three
      for (const c of w.cells) expect(cast).not.toContain(c.n);
    }
  });

  test('the lines partition the nine, one card of each tense apiece', () => {
    const seed = SEEDS[0];
    const cast = castOf(seed);
    const weave = nineWeaveOf(cast, wideReadingOf(seed, cast).cells);
    const seen = new Set<number>();
    for (const line of weave.lines) {
      expect(line.cells.length).toBe(3);
      for (const c of line.cells) seen.add(c.n);
    }
    expect(seen.size).toBe(9);
  });

  test('every named relation is the canon’s own', () => {
    for (const seed of SEEDS) {
      const cast = castOf(seed);
      const weave = nineWeaveOf(cast, wideReadingOf(seed, cast).cells);
      for (const t of weave.tensions) expect(counterOf(t.a.n)).toBe(t.b.n);
      for (const c of weave.currents) expect(becomingOf(c.from.n)).toBe(c.to.n);
      for (const s of weave.silences) expect(isSilent(s.cell.n)).toBe(true);
    }
  });

  test('the weave speaks in derived lines only, and each thread appears', () => {
    const seed = SEEDS[0];
    const cast = castOf(seed);
    const weave = nineWeaveOf(cast, wideReadingOf(seed, cast).cells);
    const lines = weaveLines(weave);
    expect(lines.length).toBeGreaterThanOrEqual(3);   // the three depth-lines always speak
    expect(lines[0]).toContain('the world runs');
    expect(lines[1]).toContain('the between runs');
    expect(lines[2]).toContain('the heart runs');
  });
});
