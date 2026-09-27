// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE FIVE VOICES — the order, the walk, and the freed crossing. Pinned on
// 11 August 2026, when the architect reordered the reading: the Crossing
// leads, because it is the human register and a reading that opens with
// geometry greets a person with a diagram. The same day the depth walk (the
// card's three digits said in words) moved out of the crossing prose and
// into a derived line beside the Figure, where structure belongs. These pins
// hold all three decisions.

import { describe, expect, test } from 'vitest';
import { VOICES, THE_81, depthWalkOf, readingOf } from '../../spatial/app/luminara-81.js';
import { voicesHtml } from '../../spatial/app/luminara-voices.js';
import { codeOf } from '../../spatial/app/luminara-canon.js';

const ALL = Array.from({ length: 27 }, (_, i) => i + 1);
const TENSES = ['root', 'present', 'becoming'] as const;

describe('THE ORDER — the person before the geometry', () => {
  test('the crossing leads, and the question still closes', () => {
    expect(VOICES.map((v: any) => v.key)).toEqual(['c', 'f', 'w', 'a', 'q']);
    expect(VOICES[0].name).toBe('The Crossing');
    expect(VOICES[1].name).toBe('The Figure');
  });

  test('the rendered section speaks in that order', () => {
    const r = readingOf([2, 18, 27]);
    const html = voicesHtml(r.sections[1]);
    const at = (label: string) => html.indexOf(label);
    expect(at('THE CROSSING')).toBeGreaterThan(-1);
    expect(at('THE CROSSING')).toBeLessThan(at('THE FIGURE'));
    expect(at('THE FIGURE')).toBeLessThan(at('WITH THE FLOW'));
    expect(at('AGAINST THE FLOW')).toBeLessThan(at('THE QUESTION'));
  });
});

describe('THE DEPTH WALK — derived from the code, one wording, one home', () => {
  test('every card walks its own digits', () => {
    const VERBS = ['holds still', 'flows', 'turns'];
    for (const n of ALL) {
      const d = codeOf(n);
      const line = depthWalkOf(n);
      if (d[0] === d[1] && d[1] === d[2]) {
        // one state across all three is said once, not three times
        expect(line.startsWith('world, between and heart all'), 'card ' + n).toBe(true);
      } else {
        expect(line, 'card ' + n).toContain('the world ' + VERBS[d[0]]);
        expect(line, 'card ' + n).toContain('the between ' + VERBS[d[1]]);
        expect(line, 'card ' + n).toContain('the heart ' + VERBS[d[2]]);
      }
    }
  });

  test('the two ends of the deck, verbatim', () => {
    expect(depthWalkOf(1)).toBe('world, between and heart all hold still');
    expect(depthWalkOf(27)).toBe('world, between and heart all turn');
    // the card whose crossing once opened with this exact walk in prose
    expect(depthWalkOf(18)).toBe('the world flows · the between turns · the heart turns');
  });

  test('the walk stands in the head, directly after the ternary marks', () => {
    // moved out of the Figure's block at the architect's word (11 August
    // 2026): the marks say the digits in symbols and the walk says them in
    // words, one fact in two scripts, side by side in the meta line.
    const r = readingOf([2, 18, 27]);
    for (const s of r.sections) {
      const html = voicesHtml(s);
      const head = html.slice(0, html.indexOf('THE CROSSING'));
      expect(head, 'the walk lives in the head').toContain(depthWalkOf(s.n));
      expect(head).toContain(s.marks + ' · <span class="mwalk">' + depthWalkOf(s.n) + '</span>');
      // and the voices below carry no copy of it
      const body = html.slice(html.indexOf('THE CROSSING'));
      expect(body.includes('mwalk'), 'no second walk among the voices').toBe(false);
      expect(html.includes('vwalk'), 'the old Figure seat stays empty').toBe(false);
    }
    // exactly one walk per section: derived once, never repeated
    expect(voicesHtml(r.sections[0]).split('mwalk').length - 1).toBe(1);
  });
});

describe('THE FREED CROSSING — the walk left the prose where the architect asked', () => {
  test('card 18 present: the quoted opener is gone and the voice stands whole', () => {
    const c = THE_81[18].present.c;
    expect(c.startsWith('Both your relationships and your core are in motion')).toBe(true);
    expect(c.includes('while the world flows beneath'), 'the walk now lives with the Figure').toBe(false);
  });

  test('the corpus contract holds: every card, every tense, all five voices', () => {
    for (const n of ALL) {
      for (const t of TENSES) {
        for (const v of VOICES) {
          const text = THE_81[n][t][v.key];
          expect(typeof text, 'card ' + n + ' ' + t + ' ' + v.key).toBe('string');
          // presence, not length: this pin first demanded forty characters of
          // every voice and went red against five Question voices that are
          // short BECAUSE they are good ("Can you watch without touching?").
          // The contract is that every voice speaks, not that it goes on.
          expect(text.trim().length, 'card ' + n + ' ' + t + ' ' + v.key).toBeGreaterThan(10);
        }
      }
    }
  });
});
