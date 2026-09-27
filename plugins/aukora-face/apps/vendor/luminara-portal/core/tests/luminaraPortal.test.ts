// AUMA LUMINARA portal: canon + engine invariants.
// Exercises the pure module directly (it is import-free by design).
import { describe, expect, test } from 'vitest';
import {
  CARDS, SILENCES, POSITIONS, codeOf, codeMarks, isSilent,
  drawThree, drawOne, composeReading, askAumaText, SILENCE_SEATS,
} from '../../spatial/app/luminara-canon.js';

describe('the skeleton (D13 bijection)', () => {
  test('27 cards, codes unique, bijection arithmetic holds', () => {
    expect(CARDS.length).toBe(27);
    const seen = new Set<string>();
    for (const c of CARDS) {
      const d = codeOf(c.n);
      expect(9 * d[0] + 3 * d[1] + d[2] + 1).toBe(c.n);
      seen.add(d.join(''));
    }
    expect(seen.size).toBe(27);
  });
  test('suit openers are X●● and closers are X~~ (every beginning a still core)', () => {
    for (const n of [1, 10, 19]) expect(codeOf(n).slice(1)).toEqual([0, 0]);
    for (const n of [9, 18, 27]) expect(codeOf(n).slice(1)).toEqual([2, 2]);
  });
  test('the torus closes by counting: The Return + 1 rolls over to The Seed', () => {
    const ret = codeOf(27), seed = codeOf(1);
    expect(ret).toEqual([2, 2, 2]);
    expect(seed).toEqual([0, 0, 0]);
  });
});

describe('the letter map (D10–D12) and the Silences (D14)', () => {
  test('23 active letters + 4 silences = 27, letters match the locked map', () => {
    const letters = CARDS.map((c) => c.letter);
    expect(letters).toEqual(['I', 'P', 'B', 'Z', 'V', 'W', 'U', 'F', 'M', 'E', 'T', 'D', 'A', 'S', 'L', 'C', 'R', 'N', 'O', 'K', 'G', 'X', 'H', 'Y', 'Q', 'SH', 'J']);
    expect(new Set(letters).size).toBe(27);
  });
  test('every Silence is a real seat, once, and sits on the still core (the vowel plane)', () => {
    // Laws that hold for ANY silence set, so a re-count cannot make them lie.
    // The seats themselves are pinned deliberately, in one place, by
    // canonFingerprint.test.ts: that is where a change is meant to go red.
    expect(SILENCE_SEATS.length).toBe(new Set(SILENCE_SEATS).size);
    expect([...SILENCE_SEATS]).toEqual([...SILENCE_SEATS].sort((a, b) => a - b));
    for (const n of SILENCE_SEATS) {
      expect(Number.isInteger(n) && n >= 1 && n <= CARDS.length, 'seat ' + n).toBe(true);
      expect(codeOf(n)[2], 'seat ' + n + ' must have a still core').toBe(0);
      const s = SILENCES[n];
      expect(typeof s.name).toBe('string');
      expect(typeof s.asks).toBe('string');
      expect(s.lines.length).toBe(3);
    }
  });
});

describe('draw mechanics (Q6 v0: seeded, uniform, without replacement)', () => {
  test('deterministic: same seed, same cast, a journal entry can reopen exactly', () => {
    expect(drawThree('intent|1234|5678')).toEqual(drawThree('intent|1234|5678'));
  });
  test('three distinct cards, all in 1..27, and seeds actually matter', () => {
    const a = drawThree('seed-a'), b = drawThree('seed-b');
    expect(new Set(a).size).toBe(3);
    for (const n of a) { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(27); }
    expect(a.join()).not.toBe(b.join());
  });
  test('drawOne is deterministic and honours exclusions', () => {
    expect(drawOne('moment-1', [])).toBe(drawOne('moment-1', []));
    const first = drawOne('moment-1', []);
    const second = drawOne('moment-2', [first]);
    expect(second).not.toBe(first);
    const nearlyAll = Array.from({ length: 26 }, (_, i) => i + 1);
    expect(drawOne('any-seed', nearlyAll)).toBe(27);
  });
  test('uniform-ish: over many seeds every card appears (no unreachable card)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) drawThree('sweep-' + i).forEach((n) => seen.add(n));
    expect(seen.size).toBe(27);
  });
});

describe('the reading grammar (canon §7, W6 register)', () => {
  test('three sections in position order, weave present, plain landing', () => {
    const r = composeReading([8, 12, 23], 'a test intention');
    expect(r.sections.length).toBe(3);
    expect(r.sections.map((s: any) => s.position.name)).toEqual(['Trefoil', 'Genus', 'Phi']);
    expect(r.vectors.length).toBe(3);
    expect(r.harmonic.length).toBeGreaterThan(10);
    expect(r.landing.length).toBeGreaterThan(10);
    expect(r.summary).toContain('The Knot');
  });
  test('a Silence stops interpretation in its register and speaks imperatively', () => {
    const r = composeReading([15, 25, 21], null);
    expect(r.sections[1].silent).toBe(true);
    expect(r.sections[1].body).toContain('I will not interpret');
    expect(r.sections[1].body).toContain('recognition');
    expect(r.sections[0].silent).toBe(false);
  });
  test('Phi silent redirects the landing instead of pointing forward', () => {
    const r = composeReading([1, 11, 22], null);
    expect(r.landing).toContain('silent');
    expect(r.landing).toContain('Surrender');
  });
  test('an all-silent cast yields the rarest reading verbatim', () => {
    // The cast is DERIVED from the map. Written as [4, 16, 25] it would have
    // gone quietly false the moment seat 4 stopped being silent: allSilent
    // would compute to false and this path would lose its only coverage.
    const r = composeReading(SILENCE_SEATS.slice(0, 3), null);
    expect(r.allSilent).toBe(true);
    expect(r.summary).toContain('language cannot precede');
  });
  test('named movement: an all-suit-opener cast reads sustained stillness in middle and core', () => {
    const r = composeReading([1, 10, 19], null);
    const mid = r.vectors[1], core = r.vectors[2];
    expect(mid.line).toContain('sustained stillness');
    expect(core.line).toContain('sustained stillness');
    expect(r.vectors[0].line).toContain('complete arc');
  });
  test('no numbers about persons anywhere; ask text honours canon and forbids prediction', () => {
    const r = composeReading([9, 14, 27], 'what completes');
    const ask = askAumaText(r);
    expect(ask).toContain('Honour these canon essences');
    expect(ask).toContain('never prediction');
    expect(ask).not.toMatch(/score|rank|points/i);
    expect(codeMarks(9)).toBe('● ~ ~');
    expect(isSilent(9)).toBe(false);
  });
});
