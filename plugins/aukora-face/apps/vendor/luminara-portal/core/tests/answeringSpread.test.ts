// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE ANSWERING SPREAD'S PINS — Book Two's move made an object on the bench.
// A knot met with its own reversed mirror is concordant to trivial one level
// up, and in this deck the counter IS that mirror: it sends T(p,q) to T(p,-q)
// exactly, for all twenty-seven. So a committed cast can be shown beside its
// answer without a second cast, without entropy, and without a rite.
//
// The restraint is the reason this file exists. THE WOUND AND THE CARD
// establishes that eighteen of the twenty-seven are non-slice, which is to
// say permanent alone, and that the deck sorts into three diagnostic classes.
// All of it is derived and all of it is true. But whether a READING may SPEAK
// genus, class, or permanence is a ruling of the law of spreads that has not
// been made, and an instrument does not take a ruling by shipping it. These
// pins hold the spread to the two relations it is already entitled to use,
// the counter and the signed count, and fail if it quietly grows into the
// diagnostic voice before the ruling exists.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CARDS, counterOf, knotOf } from '../../spatial/app/luminara-canon.js';
import { formOf, formLine, partitionOf } from '../../spatial/app/luminara-form.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const READ = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-read.html'), 'utf-8');
const FORM = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-form.js'), 'utf-8');

// the spread's own region: its render function through to its wiring
const SPREAD = READ.slice(READ.indexOf('function renderMirror(cast)'),
  READ.indexOf("$('meetMirror').addEventListener") + 200);

const gcdOf = (a: number, b: number): number => (b ? gcdOf(b, a % b) : a);

describe('THE ANSWERING SPREAD — the arithmetic it rests on', () => {
  test('the counter is the exact mirror of the knot, for all twenty-seven', () => {
    // the whole feature rests on this: if the counter were only approximately
    // the mirror, the spread would be asserting something false about Book Two
    for (const c of CARDS) {
      const k = knotOf(c.n);
      const m = knotOf(counterOf(c.n));
      expect(m.p, c.name + ' must keep its winding').toBe(k.p);
      // stated as the sum rather than as -q: the still point sits at nought,
      // and negative zero is not the same value as zero to an identity check
      expect(m.q + k.q, c.name + ' must reverse its count').toBe(0);
      expect(Math.abs(m.q), c.name + ' must keep its magnitude').toBe(Math.abs(k.q));
    }
  });

  test('every dyad sums to the null, and the answer answers back', () => {
    for (const c of CARDS) {
      const a = counterOf(c.n);
      expect(knotOf(c.n).q + knotOf(a).q, c.name + ' + its counter must be nought').toBe(0);
      expect(counterOf(a), c.name + ': the counter must be an involution').toBe(c.n);
    }
  });

  test('the form module partitions the deck exactly, and the classes are exhaustive', () => {
    const p = partitionOf(CARDS);
    expect(p.unknot.length + p.link.length + p.knot.length).toBe(27);
    expect(p.unknot.length, 'three cards close with no crossing').toBe(3);
    expect(p.link.length, 'six cards are links rather than knots').toBe(6);
    expect(p.knot.length, 'eighteen are true knots').toBe(18);
  });

  test('every line the spread can show is true of the card it describes', () => {
    for (const c of CARDS) {
      const f = formOf(c.n);
      const k = knotOf(c.n);
      if (f.kind === 'knot') {
        // Seifert genus of a torus knot, and by Kronheimer and Mrowka it is
        // also the slice genus, so positive genus means never slice
        expect(f.genus, c.name).toBe(((k.p - 1) * (Math.abs(k.q) - 1)) / 2);
        expect(f.genus, c.name + ' must have positive genus to be called a knot').toBeGreaterThan(0);
        expect(f.slice, c.name + ' is a nontrivial torus knot and cannot be slice').toBe(false);
        expect(formLine(c.n)).toContain('genus ' + f.genus);
      }
      if (f.kind === 'link') {
        // the line claims the components are unknotted; that is checked here
        // per card rather than assumed from any general fact about torus links
        expect(f.componentsUnknotted, c.name + ': the line claims unknotted components').toBe(true);
        expect(f.strands, c.name).toBe(Math.abs(k.q) === 0 ? k.p : gcdOf(k.p, Math.abs(k.q)));
        expect(Number.isInteger(f.linking), c.name + ': linking number must be whole').toBe(true);
      }
      if (f.kind === 'unknot') {
        expect(k.p === 1 || Math.abs(k.q) <= 1, c.name + ' must actually be unknotted').toBe(true);
      }
    }
  });

  test('the still point is the only card that answers itself', () => {
    // a cast draws without replacement, so at most one position can ever show
    // it, which is what the spread's note assumes when it names that position
    const self = CARDS.filter((c) => counterOf(c.n) === c.n).map((c) => c.name);
    expect(self).toEqual(['The Seed']);
  });
});

describe('THE ANSWERING SPREAD — nothing cast, nothing shown unasked', () => {
  test('it is a derivation of the standing cast, never a second one', () => {
    expect(READ).toContain('function renderMirror(cast)');
    // no draw of any kind inside the spread: it reads the cast already made
    for (const casting of ['drawOne', 'drawThree', 'drawWide', 'Math.random', 'crypto.getRandomValues']) {
      expect(SPREAD.includes(casting), 'the spread must not cast: ' + casting).toBe(false);
    }
    // and it is built from the canon relation, not from a table of its own
    expect(SPREAD).toContain('counterOf(n)');
  });

  test('the row hides until a cast stands, and the box waits for the touch', () => {
    expect(READ).toContain('<div class="mirror" id="mirrorRow" style="display:none">');
    expect(READ).toContain("$('meetMirror').addEventListener");
    // revealed only where a completed reading is rendered, and emptied there
    expect(READ).toContain("$('mirrorRow').style.display = '';");
    expect(READ).toContain("$('mirrorBox').innerHTML = '';");
    // and it is put away again on reset, like every other committed surface.
    // (This once matched 'readAir' beside 'mirrorBox'; THE READING, HEARD was
    // struck from the bench on 11 August 2026 and its id left the sweep.)
    expect(READ).toContain("$('mirrorRow').style.display = 'none';");
    expect(READ).toMatch(/'descents',\s*'mirrorBox'/);
  });

  test('the replay hint stays silent, and a silent hint closes its band', () => {
    // "Replayed from the declared seed. · cast for a new one" was struck on
    // 11 August 2026: the seed line already says "replayed", and a finished
    // cast needs no coaching toward the next one.
    expect(READ.includes('Replayed from the declared seed')).toBe(false);
    expect(READ.includes('cast for a new one')).toBe(false);
    expect(READ).toMatch(/\.hint:empty \{ display:none; \}/);
  });

  test('the chord button stays gone: the bench keeps one voice', () => {
    // THE READING, HEARD was a second door to the sound the ambient toggle
    // already owns, struck at the architect's word. The machinery it shared
    // (voiceOf, createSounder) remains for the cast-sound; the button, its
    // handler and its air line do not return.
    expect(READ.includes('hearReading')).toBe(false);
    expect(READ.includes('READING, HEARD stood here'), 'the strike is recorded where it happened').toBe(true);
    expect(READ.includes('readAirRow')).toBe(false);
    expect(READ.includes('gapsAmong'), 'the air law import left with its one caller').toBe(false);
  });

  test('it refuses to speak while the cast is incomplete', () => {
    expect(SPREAD).toContain('if (!done || drawn.length !== 3) return;');
  });
});

describe('THE ANSWERING SPREAD — the strand is spoken, the person is not', () => {
  // THE RULING, taken 29 July 2026. This block previously forbade the spread to
  // speak genus or sliceness at all, and was written to change if the ruling was
  // taken. It was: the form may be spoken, because it is a derived fact about a
  // knot, and the knot is a mathematical object rather than a person. What stays
  // parked is the LEAP from that object to a prognosis, which the books
  // themselves mark as a wager and which stops sounding like a wager the moment
  // an instrument says it to someone about their own cast.

  test('the form is spoken, and derived from the module rather than inlined', () => {
    expect(READ).toContain("import { formLine } from '/app/luminara-form.js';");
    expect(SPREAD).toContain('formLine(n)');
    // and the module actually says the load-bearing things
    expect(FORM).toContain('genus');
    expect(FORM).toContain('not slice');
    expect(FORM).toContain('linking');
  });

  test('no line the module can produce speaks a person, a wound, or a prognosis', () => {
    // tested on what the module SAYS rather than on its source, because the
    // header comment must be free to name the leap it exists to refuse. Every
    // line the deck can ever show is generated and checked.
    const spoken = CARDS.map((c) => formLine(c.n)).join(' ').toLowerCase();
    for (const leap of ['wound', 'heal', 'trauma', 'permanent', 'unhealable',
      'prognosis', 'cure', 'damage', 'you', 'your', 'diagnos', 'never recover']) {
      expect(spoken.includes(leap.toLowerCase()),
        'no line may speak: ' + leap).toBe(false);
    }
    // and every card produces one, so no card falls through unspoken
    expect(CARDS.every((c) => formLine(c.n).length > 20)).toBe(true);
  });

  test('the page says whose shape is being described, so the register is visible', () => {
    const flat = READ.replace(/\s+/g, ' ');
    expect(flat).toContain('describe the strand itself');
    expect(flat).toContain('They say nothing about you.');
  });

  test('the form module is pure: canon in, description out', () => {
    for (const impure of ['document', 'window', 'localStorage', 'fetch(', 'Math.random',
      'drawOne', 'drawThree', 'composeReading']) {
      expect(FORM.includes(impure), 'the form module must stay pure: ' + impure).toBe(false);
    }
  });

  test('the page states what the spread is, so the law is visible and not merely kept', () => {
    // the source wraps at the margin, so the pin reads collapsed whitespace:
    // it tests what is said rather than how it was typeset
    const flat = READ.replace(/\s+/g, ' ');
    expect(flat).toContain('the counter is a canon relation');
    expect(flat).toContain('read from the other side');
  });
});
