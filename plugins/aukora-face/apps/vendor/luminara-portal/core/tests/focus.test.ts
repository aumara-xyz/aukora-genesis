// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE FOCUS'S PINS — the console's one invariant, held to THE RITE AND THE
// WORKSHOP by source and by behaviour. The focus is a card and nothing else:
// no cast, no seed, no question may ever live in the shared layer, and every
// projection must agree with the module that owns it.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { codeOf, knotOf, counterOf, becomingOf } from '../../spatial/app/luminara-canon.js';
import { homeOf, classOf } from '../../spatial/app/luminara-cube.js';
import { metalOf } from '../../spatial/app/luminara-knots.js';
import {
  projectionsOf, lineOf, planeOf, onDiagonal, shellOf,
  focus, setFocus, onFocus,
} from '../../spatial/app/luminara-focus.js';

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-focus.js'), 'utf8');

describe('THE FOCUS — the boundary held by source', () => {
  test('no casting machinery, no entropy, no situational state', () => {
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'composeReading', 'descend(',
      'Math.random', 'crypto.getRandomValues', 'drand', 'seedStr', 'localStorage']) {
      expect(SRC.includes(forbidden), 'the focus must not touch: ' + forbidden).toBe(false);
    }
  });

  test('every projection is imported from its owner, never re-derived', () => {
    expect(SRC).toContain("from './luminara-canon.js'");
    expect(SRC).toContain("from './luminara-cube.js'");
    expect(SRC).toContain("from './luminara-knots.js'");
    // no second knot map, no second cube map
    expect(SRC.includes('function knotOf')).toBe(false);
    expect(SRC.includes('function homeOf')).toBe(false);
    expect(SRC.includes('function metalOf')).toBe(false);
  });

  test('the letters stay sealed', () => {
    expect(SRC.includes('.letter')).toBe(false);
    expect(SRC.includes('SILENCES')).toBe(false);
  });
});

describe('THE FOCUS — the projections agree with their owners', () => {
  test('all twenty-seven project completely and truthfully', () => {
    for (let n = 1; n <= 27; n++) {
      const P = projectionsOf(n);
      expect(P.n).toBe(n);
      expect(P.code).toEqual(codeOf(n));
      const k = knotOf(n);
      expect(P.torus.p).toBe(k.p);
      expect(P.torus.q).toBe(k.q);
      expect(P.cube.pos).toEqual(homeOf(n));
      expect(P.cube.piece).toBe(classOf(n));
      expect(P.metal).toBe(metalOf(n));
      expect(P.counter).toBe(counterOf(n));
      expect(P.becoming).toBe(becomingOf(n));
      // the wheel projection is the counting circle, a pure fraction
      expect(P.wheel.turn).toBeCloseTo((n - 1) / 27, 12);
      // the house is the coset of the field digit
      expect(P.house).toBe(n <= 9 ? 'AUM' : n <= 18 ? 'MA' : 'RA');
    }
  });

  test('the structures are the canon’s: line, plane, diagonal, shell', () => {
    for (let n = 2; n <= 27; n++) {
      const L = lineOf(n);
      expect(L).toContain(1);
      expect(L).toContain(counterOf(n));
      expect(L.length).toBe(3);
      const Pl = planeOf(n)!;
      expect(Pl.length).toBe(9);
      expect(Pl).toContain(1);          // the Seed lies in every plane
      // the plane is exactly the cards orthogonal to the focus
      const f = codeOf(n);
      for (const m of Pl) {
        const d = codeOf(m);
        expect((f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) % 3).toBe(0);
      }
    }
    expect(lineOf(1)).toEqual([1]);     // the Seed's line is itself
    expect(planeOf(1)).toBeNull();      // and it poles no plane
    expect(onDiagonal(14)).toBe(true);  // the Scar
    expect(onDiagonal(4)).toBe(false);  // the Resonance
    expect(shellOf(1)).toBe('core');
  });
});

describe('THE FOCUS — the store holds a card or nothing', () => {
  test('set, read, subscribe, unsubscribe; garbage refused', () => {
    setFocus(null);
    expect(focus()).toBeNull();
    const seen: (number | null)[] = [];
    const off = onFocus((n: number | null) => seen.push(n));
    setFocus(14);
    expect(focus()).toBe(14);
    setFocus(14);                        // no re-fire on same value
    setFocus(0);                         // out of range: refused
    setFocus(28);
    setFocus(2.5 as unknown as number);  // not a card: refused
    expect(focus()).toBe(14);
    setFocus(null);
    expect(focus()).toBeNull();
    off();
    setFocus(7);
    expect(seen).toEqual([14, null]);    // nothing heard after unsubscribe
    setFocus(null);
  });
});
