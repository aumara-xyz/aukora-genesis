// THE CHORD's pins: the staircase is the sieve's own, and the explicit
// formula rebuilt from 120 computed zeros walks beside it. The tolerances
// were measured before they were pinned (midpoint error <= 0.15 for
// x <= 91 with 120 zeros; the zero-free slope misses by up to 2.1 on the
// same points): the pin holds the measurement, not a hope.
import { describe, expect, test } from 'vitest';
import { findZeros, chebyshevSteps, psiFromZeros, sineKernel, pairCorrelation, Z }
  from '../../spatial/app/luminara-zeta.js';

describe('THE SPECTRUM — the chord', () => {
  const zeros = findZeros(120);
  const steps = chebyshevSteps(100);
  const psiAt = (x: number) => {
    let v = 0;
    for (const s of steps) if (s.x <= x) v = s.psi;
    return v;
  };

  test('the staircase: psi at the classic values, steps at prime powers only', () => {
    // psi(10) = 3 log 2 + 2 log 3 + log 5 + log 7
    expect(psiAt(10)).toBeCloseTo(3 * Math.log(2) + 2 * Math.log(3) + Math.log(5) + Math.log(7), 10);
    expect(psiAt(2)).toBeCloseTo(Math.log(2), 10);
    // flat between prime powers: nothing lands at 24
    expect(psiAt(24)).toBe(psiAt(23.2));
    // the prime flag marks first powers only: 8 and 9 step, but are not primes
    const at = (x: number) => steps.find((s) => s.x === x);
    expect(at(8)!.prime).toBe(false);
    expect(at(9)!.prime).toBe(false);
    expect(at(23)!.prime).toBe(true);
  });

  test('the chord: 120 zeros land within a fifth of a step of the primes', () => {
    for (const x of [4.5, 10.5, 20.5, 30.5, 50.5, 70.5, 90.5]) {
      const err = Math.abs(psiFromZeros(x, zeros, 120) - psiAt(x));
      expect(err).toBeLessThan(0.2);
      // and the smooth slope alone does worse at every one of these points:
      // the improvement IS the spectrum's work, which is the room's claim
      const err0 = Math.abs(psiFromZeros(x, zeros, 0) - psiAt(x));
      expect(err).toBeLessThan(err0);
    }
  });

  test('the pair correlation: the kernel exact, the envelope measured, the shortfall shown', () => {
    // the sine kernel at its landmarks: repulsion total at zero,
    // indifference recovered far away
    expect(sineKernel(0)).toBe(0);
    const half = Math.sin(Math.PI * 0.5) / (Math.PI * 0.5);
    expect(sineKernel(0.5)).toBeCloseTo(1 - half * half, 12);
    expect(sineKernel(2.5)).toBeGreaterThan(0.98);
    // the golden count: 120 zeros give exactly 292 unfolded pairs within 3
    const pc = pairCorrelation(zeros);
    expect(pc.pairs).toBe(292);
    // the envelope was measured before it was pinned: worst bin 0.188
    let worst = 0;
    pc.density.forEach((d, i) => {
      const mid = (i + 0.5) * pc.width;
      worst = Math.max(worst, Math.abs(d - sineKernel(mid)));
    });
    expect(worst).toBeLessThan(0.2);
    // and the honest shortfall stands: low in the spectrum the second bin
    // falls short of the kernel; the finite height shows, and is shown
    expect(pc.density[1]).toBeLessThan(sineKernel(1.5 * pc.width));
  });
});

describe('THE SPECTRUM: the sign of Z', () => {
  // Every consumer above survives a global negation of Z, because zeros are
  // sign CHANGES, spacings are differences, and histograms forget the sign.
  // A negated Z therefore passed every pin in this file for months. So these
  // pins hold the SIGNED values themselves, against mpmath's siegelz at
  // twenty digits (checked 2026-08-03), one height of each sign. Tolerances
  // were measured before they were pinned: 2.7e-15 at t = 17.8, 5.1e-15 at
  // t = 20, 6.9e-15 at t = 23, 3.1e-6 at t = 200, 7.5e-9 at t = 600. Each
  // pin sits an order of magnitude or more above its measurement, not a hope.
  test('signed values against siegelz, both signs represented', () => {
    // between the first two zeros Z is POSITIVE; this sign was checked
    // against siegelz, not assumed from a sketch of the curve
    expect(Math.abs(Z(17.8) - 2.3387137787116217)).toBeLessThan(1e-13);
    expect(Math.abs(Z(20) - 1.1478424121851973)).toBeLessThan(1e-13);
    // between the second and third zeros it is negative
    expect(Math.abs(Z(23) - -1.4546250264981679)).toBeLessThan(1e-13);
    // higher up, the accuracy the rule actually delivers, measured and held
    expect(Math.abs(Z(200) - 5.5897836231501090)).toBeLessThan(1e-4);
    expect(Math.abs(Z(600) - 2.6715800758191856)).toBeLessThan(1e-7);
  });

  test('the first two zeros stand where the literature puts them', () => {
    // gamma_1 and gamma_2 to the digits Odlyzko publishes; the sign fix
    // moved these by exactly nothing, and this pin keeps it that way
    const [g1, g2] = findZeros(2);
    expect(g1).toBeCloseTo(14.134725141734694, 12);
    expect(g2).toBeCloseTo(21.022039638771555, 12);
  });

  test('the ceiling: finite through t = 683, refused beyond', () => {
    // the CRVZ weights overflow doubles at 401 terms, which termsFor first
    // requests at t = 684; the module answers plainly or not at all
    expect(Number.isFinite(Z(683))).toBe(true);
    expect(() => Z(684)).toThrow(RangeError);
    expect(() => Z(684)).toThrow(/683/);
  });
});
