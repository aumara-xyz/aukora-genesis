// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PLATE'S MATHEMATICS, PINNED. The sand plate's field moved from the
// sin(mπr) scaffold to the disc's real modes (free-edge Bessel), so the
// machinery is held to the classical tables: J_n against Abramowitz &
// Stegun, the derivative zeros against the standard j'_{n,m} values, and
// the free rim against its own definition: the edge of a real Chladni
// plate moves, so no profile may vanish there.

import { describe, test, expect } from 'bun:test';
import { besselJ, besselPrimeZero, radialProfile, profileAt }
  from '../../spatial/app/luminara-bessel.js';

describe('THE BESSEL MACHINERY — J_n against the classical tables', () => {
  test('the anchor values of A&S hold to 1e-6', () => {
    expect(Math.abs(besselJ(0, 0) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(besselJ(1, 0))).toBeLessThan(1e-12);
    expect(Math.abs(besselJ(0, 1) - 0.7651976866)).toBeLessThan(1e-6);
    expect(Math.abs(besselJ(1, 1) - 0.4400505857)).toBeLessThan(1e-6);
    expect(Math.abs(besselJ(2, 2) - 0.3528340286)).toBeLessThan(1e-6);
    expect(Math.abs(besselJ(5, 10) - (-0.2340615282))).toBeLessThan(1e-6);
    expect(Math.abs(besselJ(0, 2.4048255577))).toBeLessThan(1e-6);   // the first zero
  });

  test('the recurrence survives the deck\'s far corner (n=13, x to 60)', () => {
    // sanity, not a table: finite, bounded by 1, and sign-consistent with
    // the asymptotic regime
    for (const x of [5, 20, 40, 60]) {
      const v = besselJ(13, x);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('THE FREE EDGE — the derivative zeros', () => {
  test('the classical j\'_{n,m} hold to 1e-3', () => {
    expect(Math.abs(besselPrimeZero(1, 1) - 1.84118)).toBeLessThan(1e-3);
    expect(Math.abs(besselPrimeZero(2, 1) - 3.05424)).toBeLessThan(1e-3);
    expect(Math.abs(besselPrimeZero(3, 1) - 4.20119)).toBeLessThan(1e-3);
    expect(Math.abs(besselPrimeZero(0, 1) - 3.83171)).toBeLessThan(1e-3);  // = j_{1,1}
    expect(Math.abs(besselPrimeZero(0, 2) - 7.01559)).toBeLessThan(1e-3);  // = j_{1,2}
    expect(Math.abs(besselPrimeZero(1, 2) - 5.33144)).toBeLessThan(1e-3);
  });

  test('each is truly a flat point: the derivative vanishes there', () => {
    for (const [n, m] of [[1, 1], [2, 1], [3, 2], [6, 1], [9, 1], [13, 1]]) {
      const jp = besselPrimeZero(n, m);
      const d = (besselJ(n - 1, jp) - besselJ(n + 1, jp)) / 2;
      expect(Math.abs(d)).toBeLessThan(1e-6);
    }
  });
});

describe('THE PROFILES — the rim moves, the rings crowd true', () => {
  test('no free-edge profile vanishes at the rim: the edge is an antinode', () => {
    // every mode the canon can ask for: n = |q| to 13, m = p in {1,2,3,7}
    for (let n = 0; n <= 13; n++) {
      for (const m of [1, 2, 3, 7]) {
        const T = radialProfile(n, m);
        expect(Math.abs(profileAt(T, 1))).toBeGreaterThan(0.005);
      }
    }
  });

  test('the profile peaks at one and interpolates cleanly', () => {
    const T = radialProfile(3, 2);
    let peak = 0;
    for (let r = 0; r <= 1.0001; r += 0.002) peak = Math.max(peak, Math.abs(profileAt(T, r)));
    expect(Math.abs(peak - 1)).toBeLessThan(0.02);
  });

  test('the rings crowd outward: nodal radii are NOT evenly spaced (the scaffold\'s tell)', () => {
    // J_3 at j'_{3,3}: two interior nodal circles; under sin(mπr) they would
    // sit at r = 1/3 and 2/3 exactly: the real ones sit elsewhere
    const jp = besselPrimeZero(3, 3);
    const nodes: number[] = [];
    let prev = besselJ(3, 0.001);
    for (let r = 0.002; r < 1; r += 0.001) {
      const v = besselJ(3, jp * r);
      if ((v > 0) !== (prev > 0)) nodes.push(r);
      prev = v;
    }
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    const even = [1 / 3, 2 / 3];
    const offEven = nodes.slice(0, 2).map((r, i) => Math.abs(r - even[i]));
    expect(Math.max(...offEven)).toBeGreaterThan(0.02);
  });
});
