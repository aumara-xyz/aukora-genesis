// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CAST, SPOKEN — pins for luminara-cube-read.js, the Living Cube's text
// instrument. The module turns the engine's arithmetic into sentences: who
// stands in whose seat, how the exiles cycle, where the way home runs, which
// turns the walk declines, and what a Silence carried hot asks for.
//
// Two disciplines are held here. ONE VOICE: the permutation is spoken by the
// Field's own cycleLine, never a second implementation, so the depths and
// the cube can never drift into different grammars. THE PARKED 729: every
// generated line is structure (seats, loops, turnings, asks) and no line
// ever says what a card in a seat means.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CARDS, cardOf, isSilent } from '../../spatial/app/luminara-canon.js';
import {
  solvedState, applyWord, applyMove, scrambleWord, returnWord, homeOf, classOf, MOVES, driftOf,
} from '../../spatial/app/luminara-cube.js';
import {
  cardWhoseSeat, cubeFieldOf, ringLines, compositionLine, refusalLine, askLines, witnessLines,
} from '../../spatial/app/luminara-cube-read.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-cube-read.js'), 'utf-8');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-cube.html'), 'utf-8');

// deterministic casts for every behavioural pin: fixed strings, no entropy
const SEEDS = ['cube|pin:1', 'cube|pin:2', 'cube|pin:3', 'cube|taps:1:2:3|drand:7:abc'];
const casts = SEEDS.map((s) => {
  const scramble = scrambleWord(s);
  const state = applyWord(solvedState(), scramble);
  return { scramble, state, word: returnWord(scramble) };
});

describe('THE SEATS — the coordinate map the reading stands on', () => {
  test('every card has a seat and every seat exactly one card', () => {
    const seen = new Set<number>();
    for (const c of CARDS) {
      const back = cardWhoseSeat(homeOf(c.n));
      expect(back, c.name + ' must own its home seat').toBe(c.n);
      seen.add(back);
    }
    expect(seen.size).toBe(27);
  });

  test('the two rings are closed: corners trade only with corners, edges with edges', () => {
    for (const { state } of casts) {
      for (const pc of state) {
        const owner = cardWhoseSeat(pc.pos);
        expect(classOf(owner), cardOf(pc.n).name + ' must stand in a seat of its own class')
          .toBe(classOf(pc.n));
      }
    }
  });

  test('the core and the six centres never leave home, in any cast', () => {
    for (const { state } of casts) {
      for (const pc of state) {
        if (classOf(pc.n) === 'core' || classOf(pc.n) === 'centre') {
          expect(cardWhoseSeat(pc.pos), cardOf(pc.n).name).toBe(pc.n);
        }
      }
    }
  });
});

describe('THE RINGS — the permutation spoken in the Field\'s voice', () => {
  test('the cycles are a true decomposition: sizes sum to the ring, disjoint, closed', () => {
    for (const { state } of casts) {
      for (const [cls, size] of [['corner', 8], ['edge', 12]] as const) {
        const f = cubeFieldOf(state, cls);
        const all = f.cycles.flat();
        expect(all.length, cls + ' cycles must cover the ring').toBe(size);
        expect(new Set(all).size, cls + ' cycles must be disjoint').toBe(size);
        for (const n of all) expect(classOf(n)).toBe(cls);
      }
    }
  });

  test('a fixed point in the reading really is a card at home', () => {
    for (const { state } of casts) {
      for (const cls of ['corner', 'edge'] as const) {
        for (const n of cubeFieldOf(state, cls).fixed) {
          const pc = state.find((p) => p.n === n)!;
          expect(cardWhoseSeat(pc.pos), cardOf(n).name).toBe(n);
        }
      }
    }
  });

  test('the solved state reads as all home, and says so without a single loop line', () => {
    const home = solvedState();
    expect(cubeFieldOf(home, 'corner').fixed.length).toBe(8);
    expect(cubeFieldOf(home, 'edge').fixed.length).toBe(12);
    const lines = ringLines(home);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l).toContain('all stand at home');
  });

  test('one voice: the cycles are spoken by the Field\'s own cycleLine, not a copy', () => {
    expect(SRC).toContain("import { cycleLine } from './luminara-field.js';");
    expect(SRC.includes('sits in'), 'the loop grammar must come from the Field, not be reimplemented')
      .toBe(false);
  });
});

describe('THE WAY HOME — composition and refusals, checked against the engine', () => {
  test('the composition line counts exactly the reduced word, and names the true lean', () => {
    for (const { word } of casts) {
      const line = compositionLine(word);
      expect(line).toContain('runs ' + word.length + ' turnings');
      const byAxis = [0, 0, 0];
      for (const m of word) byAxis[m.axis]++;
      const max = Math.max(...byAxis);
      const leaders = byAxis.filter((c) => c === max).length;
      if (leaders > 1) expect(line).toContain('evenly held');
      else expect(line).toContain('leans on');
      for (const [i, name] of [['the relation', 0], ['the field', 1], ['the core', 2]].map((x, j) => [x[1], x[0]] as const)) {
        if (byAxis[i as number] > 0) expect(line).toContain(byAxis[i as number] + ' at ' + name);
      }
    }
  });

  test('the refusal line agrees with the drift map move for move', () => {
    for (const { scramble } of casts) {
      const d = driftOf(scramble);
      const line = refusalLine(scramble);
      const deepen = d.filter((x) => x.delta > 0).length;
      expect(line).toContain(deepen + ' of the twelve');
      // and a declined turn really would lengthen the way, checked mechanically
      const base = returnWord(scramble).length;
      for (const x of d) {
        const after = returnWord(scramble.concat([x.move])).length;
        expect(after - base).toBe(x.delta);
      }
    }
  });

  test('the home state refuses nothing because nothing shortens nothing', () => {
    expect(refusalLine([])).toContain('the cube is home');
    expect(compositionLine([])).toContain('every card already home');
  });
});

describe('THE PARKED 729 — structure spoken, meaning refused', () => {
  test('no generated line speaks a meaning, a person, or a verdict', () => {
    const spoken = casts.flatMap((c) => witnessLines(c.state, c.scramble, c.word)).join(' ').toLowerCase();
    for (const leap of ['means', 'signifies', 'you are', 'your ', 'fate', 'destiny',
      'wound', 'heal', 'prognosis', 'fortune']) {
      expect(spoken.includes(leap), 'no line may speak: ' + leap).toBe(false);
    }
  });

  test('the asks belong only to Silences actually carried hot, and give the ask alone', () => {
    for (const { state, word } of casts) {
      for (const line of askLines(state, word)) {
        const name = line.split(' is carried hot')[0];
        const card = CARDS.find((c) => c.name === name)!;
        expect(card, name + ' must be a real card').toBeTruthy();
        expect(isSilent(card.n), name + ' must be a Silence').toBe(true);
        expect(line).toContain('it asks for');
      }
    }
  });

  test('the page renders the weave from the module, escaped, inside the witnessing', () => {
    expect(PAGE).toContain("import { witnessLines } from '/app/luminara-cube-read.js';");
    expect(PAGE).toContain('id="weave"');
    expect(PAGE).toContain("$('weave').innerHTML = witnessLines(state, scramble, remaining)");
    expect(PAGE).toContain('esc(l)');
  });

  test('the module is pure: canon and state in, sentences out', () => {
    for (const impure of ['document', 'window', 'localStorage', 'fetch(', 'Math.random',
      'drawOne', 'drawThree', 'composeReading']) {
      expect(SRC.includes(impure), 'the reader must stay pure: ' + impure).toBe(false);
    }
  });
});
