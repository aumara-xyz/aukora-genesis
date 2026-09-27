// THE LIVING CUBE — the pins (docs/THE_LIVING_CUBE_PLAN.md, sealed before the
// sweep). The mapping census, the face structure, the namesake invariant (the
// Seed never moves), the cast's determinism, and the load-bearing promise:
// the reduced return word carries every scramble home.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  homeOf, classOf, solvedState, isSolved, MOVES, rotatePos, applyMove,
  applyWord, scrambleWord, castDeclaration, inverseWord, reduceWord,
  returnWord, displacementOf, heatOf, driftOf, labelFace,
} from '../../spatial/app/luminara-cube.js';
import { knotOf } from '../../spatial/app/luminara-canon.js';

const PAGE = readFileSync(
  fileURLToPath(new URL('../../spatial/app/luminara-cube.html', import.meta.url)), 'utf8');

describe('THE MAPPING (discovered, not designed)', () => {
  test('the piece census is the tempered rule census: 1·6·12·8 with p 1·2·3·7', () => {
    const byClass: Record<string, number[]> = { core: [], centre: [], edge: [], corner: [] };
    for (let n = 1; n <= 27; n++) byClass[classOf(n)].push(n);
    expect(byClass.core.length).toBe(1);
    expect(byClass.centre.length).toBe(6);
    expect(byClass.edge.length).toBe(12);
    expect(byClass.corner.length).toBe(8);
    expect(byClass.core[0]).toBe(1); // the Seed is the hidden core
    expect(knotOf(byClass.core[0]).p).toBe(1);
    for (const n of byClass.centre) expect(knotOf(n).p).toBe(2);
    for (const n of byClass.edge) expect(knotOf(n).p).toBe(3);
    for (const n of byClass.corner) expect(knotOf(n).p).toBe(7); // the restless eight
  });
  test('home coordinates tile the cube: 27 distinct cells, Seed at the origin', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 27; n++) seen.add(homeOf(n).join(','));
    expect(seen.size).toBe(27);
    expect(homeOf(1)).toEqual([0, 0, 0]);
  });
  test('every face layer is nine cards: one centre, four edges, four corners', () => {
    for (let axis = 0; axis < 3; axis++) for (const side of [1, -1]) {
      const layer = solvedState().filter((pc) => pc.pos[axis] === side);
      expect(layer.length).toBe(9);
      const c = (k: string) => layer.filter((pc) => classOf(pc.n) === k).length;
      expect(c('centre')).toBe(1);
      expect(c('edge')).toBe(4);
      expect(c('corner')).toBe(4);
      expect(c('core')).toBe(0);
    }
  });
});

describe('THE TURNS (re-embeddings, never severings)', () => {
  test('a quarter-turn has order four and preserves its layer', () => {
    for (const m of MOVES) {
      let s = solvedState();
      for (let k = 0; k < 4; k++) s = applyMove(s, m);
      expect(isSolved(s)).toBe(true);
      const once = applyMove(solvedState(), m);
      for (const pc of once) {
        const home = homeOf(pc.n);
        if (home[m.axis] === m.side) expect(pc.pos[m.axis]).toBe(m.side);
      }
    }
  });
  test('exactly eight pieces translate per turn; centres spin in place', () => {
    for (const m of MOVES) {
      const before = solvedState();
      const after = applyMove(before, m);
      let moved = 0;
      for (let i = 0; i < 27; i++) {
        if (before[i].pos.join() !== after[i].pos.join()) {
          moved++;
          expect(['edge', 'corner']).toContain(classOf(after[i].n));
        }
      }
      expect(moved).toBe(8);
    }
  });
  test('THE NAMESAKE INVARIANT: the Seed and the six centres never move', () => {
    let s = solvedState();
    const word = scrambleWord('invariant-pin', 300);
    s = applyWord(s, word);
    for (const pc of s) {
      const c = classOf(pc.n);
      if (c === 'core' || c === 'centre') expect(pc.pos).toEqual(homeOf(pc.n));
    }
  });
});

describe('THE CAST (unsteerable · committed · witnessable)', () => {
  test('81 turnings, deterministic from the seed, seed-sensitive', () => {
    const a = scrambleWord('cube-pin');
    const b = scrambleWord('cube-pin');
    expect(a.length).toBe(81);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(scrambleWord('cube-pin-2'))).not.toBe(JSON.stringify(a));
  });
  test('the declaration carries the numbers and the source', () => {
    expect(castDeclaration('s', 123)).toContain('the cast: 81 turnings');
    expect(castDeclaration('s', 123)).toContain('drand round 123');
    expect(castDeclaration('s')).toContain('the beacon unreachable');
    expect(castDeclaration('s')).toContain('seed: s');
  });
});

describe('THE RETURN (the drift retraced, its noise removed)', () => {
  test('THE WAY HOME: the reduced return word carries every scramble to the Seed-position', () => {
    for (const seed of ['walk-1', 'walk-2', 'walk-3', 'the-ground-walk']) {
      const scramble = scrambleWord(seed);
      const scrambled = applyWord(solvedState(), scramble);
      const home = applyWord(scrambled, returnWord(scramble));
      expect(isSolved(home)).toBe(true);
    }
  });
  test('what cancels was never real: reduction removes an appended inverse', () => {
    const w = scrambleWord('reduce-pin', 20);
    const withEcho = w.concat([{ ...w[w.length - 1], dir: -w[w.length - 1].dir }]);
    expect(reduceWord(withEcho).length).toBeLessThan(withEcho.length);
    const r = returnWord(scrambleWord('reduce-pin'));
    expect(r.length).toBeLessThanOrEqual(81);
  });
  test('the witnessing: displacement, heat on the carried, drift over twelve turns', () => {
    const scramble = scrambleWord('witness-pin');
    const scrambled = applyWord(solvedState(), scramble);
    const ret = returnWord(scramble);
    const heat = heatOf(scrambled, ret);
    for (const key of Object.keys(heat)) {
      expect(['edge', 'corner']).toContain(classOf(Number(key)));
      expect(heat[Number(key)]).toBeGreaterThan(0);
    }
    for (const pc of scrambled) expect(displacementOf(pc)).toBeGreaterThanOrEqual(0);
    const drift = driftOf(scramble);
    expect(drift.length).toBe(12);
    for (const d of drift) expect(Math.abs(d.delta)).toBeLessThanOrEqual(2);
    expect(labelFace(MOVES[0])).toContain('the relation');
  });
});

describe('THE RITE (canon surface, pinned verbatim)', () => {
  test('gate 0 — the approach, five lines', () => {
    expect(PAGE).toContain('This is the deck, standing whole. Your convergence is at its centre.');
    expect(PAGE).toContain('The centre cannot be scrambled. Only the surface drifts.');
    expect(PAGE).toContain('You are not solving a puzzle. You are witnessing a drift, and walking it home.');
    expect(PAGE).toContain('The tool is for the finding. Found, it rests.');
    expect(PAGE).toContain('Hold your question. Tap three times, and the turning begins.');
  });
  test('gate 5 — the setting down, closing on the seventh line of the Way', () => {
    expect(PAGE).toContain('The cube rests at the Seed. So does the reading.');
    expect(PAGE).toContain('What the flows showed you is yours to walk without the cube.');
    expect(PAGE).toContain('The water was the aim. Lay the rods down.');
    expect(PAGE).toContain('The last word is yours.');
  });
  test('the sealed room holds in the device: no letter touches the cube', () => {
    const ENGINE = readFileSync(
      fileURLToPath(new URL('../../spatial/app/luminara-cube.js', import.meta.url)), 'utf8');
    expect(ENGINE).not.toMatch(/\.letter\b/);
    expect(PAGE).not.toMatch(/\.letter\b/);
  });
});
