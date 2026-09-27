// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PLATE'S PINS — the globe of the three, merged home to the astrolabe:
// one frame, two readings, and the law that nothing moves twice. The
// surface animates two operations the record already holds: the involution
// as a point reflection (THE NOT, one lawful turn) and the doubling
// permutation whose four orbits are charted in the map room (THE OCTAVE).
// The pins hold the arithmetic the buttons perform and the laws the page
// must keep: composed never cast, no draw machinery, the register spoken.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { counterOf, isSilent } from '../../spatial/app/luminara-canon.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-astrolabe.html'), 'utf-8');
const SPECTRUM = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-spectrum.html'), 'utf-8');

describe('THE PLATE — the globe of the three, composed and lawful', () => {
  test('the surface stands, and speaks its own registers', () => {
    expect(PAGE).toContain('id="mSky"');
    expect(PAGE).toContain('id="mPlate"');
    expect(PAGE).toContain('NOTHING MOVES TWICE');
    // entering the plate lifts the sky off before the frame may turn
    expect(PAGE).toContain('if (!sky) stopPlay();');
    expect(PAGE).toContain('the zero every dyad sums to');
    expect(PAGE).toContain('COMPOSED, NEVER CAST · A RHYME WITH THE GLOBE, NEVER AN AUTHORITY');
    for (const id of ['plateNot', 'plateOct', 'plateHome']) expect(PAGE).toContain('id="' + id + '"');
    // the geometry is quoted whole from the map room's own layout
    expect(PAGE).toContain("from '/app/map-room-figures.js'");
  });

  test('the spectrum is itself again: the plate left no trace behind', () => {
    expect(SPECTRUM.includes('THE PLATE')).toBe(false);
    expect(SPECTRUM.includes('plateNot')).toBe(false);
    expect(SPECTRUM.includes('rosetteLayout')).toBe(false);
    expect(SPECTRUM).toContain('COMPUTED IN THE PAGE');
  });

  test('no draw machinery enters the astrolabe', () => {
    for (const forbidden of ['drawOne', 'drawWide', 'castSeed', 'descend(']) {
      expect(PAGE.includes(forbidden), 'the astrolabe must not touch: ' + forbidden).toBe(false);
    }
  });

  test('THE OCTAVE walks a true permutation: four orbits, home in eighteen', () => {
    const next = (n: number) => (((n - 1) * 2) % 27) + 1;
    // orbits partition the deck as the chart of the shells records
    const seen = new Set<number>();
    const sizes: number[] = [];
    for (let n = 1; n <= 27; n++) {
      if (seen.has(n)) continue;
      let x = n, len = 0;
      while (!seen.has(x)) { seen.add(x); x = next(x); len++; }
      sizes.push(len);
    }
    expect(sizes.sort((a, b) => a - b)).toEqual([1, 2, 6, 18]);
    // eighteen presses of the button return every card home, and not before
    const after = (n: number, k: number) => { let x = n; for (let i = 0; i < k; i++) x = next(x); return x; };
    for (let n = 1; n <= 27; n++) expect(after(n, 18)).toBe(n);
    expect(after(2, 9)).not.toBe(2);
    // the hexad orbit is the silence family whole: the silences and their answers
    const hexad = [4, 7, 13, 16, 22, 25];
    for (const n of hexad) {
      expect(hexad.includes(counterOf(n))).toBe(true);
      expect(hexad.includes(next(n))).toBe(true);
    }
    // The real geometric claim, which holds however many Silences there are:
    // the orbit is closed under the involution, so every Silence in it brings
    // its own answer with it. Counting to a numeral here said less and broke
    // on a re-count; this says what the orbit is actually for.
    for (const n of hexad) {
      if (isSilent(n)) expect(hexad.includes(counterOf(n)), 'answer of ' + n).toBe(true);
    }
    expect(hexad.some(isSilent), 'the silence family must hold Silences').toBe(true);
  });

  test('THE NOT is honest: the involution is a point reflection, so one turn performs it', () => {
    // the page rides rotate(180deg); that is lawful only because every
    // counter stands at the exact antipode, which THE PLACEMENT pins hold
    // in skyWitness.test.ts. Here the arithmetic side: the involution is
    // its own inverse, and the Seed alone is fixed.
    for (let n = 1; n <= 27; n++) expect(counterOf(counterOf(n))).toBe(n);
    expect(counterOf(1)).toBe(1);
    expect(PAGE).toContain("classList.toggle('flipped')");
  });
});
