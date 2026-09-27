// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE ZETA HARP'S PINS — the observatory held to its own laws by source and
// by fixture. The plan is docs/zeta-harp/VALIDATION_PLAN.md; the claim
// boundary is docs/zeta-harp/CLAIM_BOUNDARY.md; the mathematics is
// docs/zeta-harp/MATH_SPEC.md. Every tolerance below was MEASURED against
// the mpmath fixtures before it was pinned (the measurement script prints
// them; the pinned value is the measured ceiling with one order of margin,
// never a guess).

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { theta, thetaPrime, countOf, termsOf, mainSum, C0, zApprox,
         waveTable, gramPoint, entryHeight, WINDOW26, TAU, psi, PSI_GUARD }
  from '../../spatial/app/luminara-harp-math.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-harp.html'), 'utf-8');
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'harp-fixtures.json'), 'utf-8'));

// measured 2026-08-03 against the 80-digit fixtures, then pinned with margin
// (measured maxima: theta 1.19e-7 at t = 1e8; thetap 8.9e-16; phi 9.3e-10;
//  K14 1.47; K34 0.12; guard-point C0 4.8e-7, the declared second-order
//  error of the symmetric average at PSI_STEP from the singularity)
const TOL = {
  theta: 5e-7,       // abs, worst at t = 1e8 (double representation of ~9e8 rad)
  thetap: 1e-13,     // abs
  phi: 1e-8,         // abs, per-term phase against the fixture tables
  M: 2e-5,           // abs; the sum accumulates phase rounding over N terms
  C0: 1e-6,          // abs, away from the guard points
  guardC0: 2e-6,     // abs, at the near-singularity fixtures (the h^2 cost)
  K14: 2.5,          // |Z - M| <= K14 * t^(-1/4), every fixture sample
  K34: 0.5,          // |Z - (M + C0)| <= K34 * t^(-3/4), every fixture sample
  KZERO: 1.5,        // |M + C0| at a refined zero, over t^(-3/4): measured 0.92;
                     // at a zero the corrected sum IS the higher-order remainder,
                     // whose constant runs larger than the off-zero fit
};

describe('THE HARP — the cutoff and the window', () => {
  test('N(t) at the design heights', () => {
    expect(countOf(100)).toBe(3);
    expect(countOf(130)).toBe(4);
    expect(countOf(1e4)).toBe(39);
    expect(countOf(1e6)).toBe(398);
    expect(countOf(1e8)).toBe(3989);
  });

  test('the 26-term window is exact, half-open, one of an infinite family', () => {
    expect(WINDOW26.lo).toBeCloseTo(4247.4332676534, 9);
    expect(WINDOW26.hi).toBeCloseTo(4580.4420889339, 9);
    expect(FX.window26.N_below).toBe(25);
    expect(FX.window26.N_at_lo).toBe(26);
    expect(FX.window26.N_at_hi).toBe(27);
    expect(countOf(WINDOW26.lo)).toBe(26);
    expect(countOf(WINDOW26.hi)).toBe(27);
  });

  test('entry heights are heights: t_n = 2 pi n^2, and gamma_1 has one string', () => {
    expect(entryHeight(1)).toBeCloseTo(6.283185307, 8);
    expect(entryHeight(2)).toBeCloseTo(25.13274123, 7);
    expect(countOf(14.134725)).toBe(1);
  });
});

describe('THE HARP — browser mathematics against the 80-digit fixtures', () => {
  const samples = FX.windows.flatMap((w: any) => w.samples);

  test('theta and theta-prime across every window', () => {
    let worstT = 0, worstP = 0;
    for (const s of samples) {
      worstT = Math.max(worstT, Math.abs(theta(s.t) - s.theta));
      worstP = Math.max(worstP, Math.abs(thetaPrime(s.t) - s.thetap));
    }
    expect(worstT).toBeLessThan(TOL.theta);
    expect(worstP).toBeLessThan(TOL.thetap);
  });

  test('the main sum and the correction, sample by sample', () => {
    let worstM = 0, worstC = 0;
    for (const s of samples) {
      worstM = Math.max(worstM, Math.abs(mainSum(s.t) - s.M));
      worstC = Math.max(worstC, Math.abs(C0(s.t) - s.C0));
    }
    expect(worstM).toBeLessThan(TOL.M);
    expect(worstC).toBeLessThan(TOL.C0);
  });

  test('the error orders hold: t^(-1/4) bare, t^(-3/4) corrected', () => {
    for (const s of samples) {
      expect(Math.abs(s.Z - s.M)).toBeLessThan(TOL.K14 * Math.pow(s.t, -0.25));
      expect(Math.abs(s.Z - (s.M + s.C0))).toBeLessThan(TOL.K34 * Math.pow(s.t, -0.75));
    }
  });

  test('term anatomy against the per-term tables, including the 26 chamber', () => {
    for (const tab of FX.termTables) {
      const st = termsOf(tab.t);
      expect(st.N).toBe(tab.N);
      for (const row of tab.terms) {
        expect(st.a[row.n]).toBeCloseTo(row.a, 12);
        expect(Math.abs(st.phi[row.n] - row.phi)).toBeLessThan(TOL.phi);
      }
    }
  });

  test('the Psi guard: continuous through both removable singularities', () => {
    for (const key of ['quarter', 'threeQuarter'] as const) {
      const g = FX.psiGuards[key];
      for (const near of g.near) {
        expect(Math.abs(C0(near.t) - near.C0)).toBeLessThan(TOL.guardC0);
      }
      // exactly at the singular height the guard answers finitely and lies
      // between its two near-values (continuity, not garbage)
      const atC0 = C0(g.t);
      expect(Number.isFinite(atC0)).toBe(true);
      const lo = Math.min(g.near[0].C0, g.near[1].C0) - 1e-6;
      const hi = Math.max(g.near[0].C0, g.near[1].C0) + 1e-6;
      expect(atC0).toBeGreaterThan(lo);
      expect(atC0).toBeLessThan(hi);
      // and the raw division there really is poison, which is why the guard exists
      const p = Math.sqrt(g.t / TAU) % 1;
      expect(Math.abs(Math.cos(TAU * p))).toBeLessThan(PSI_GUARD);
    }
  });

  test('zero completeness: found against Riemann-von Mangoldt, per window', () => {
    for (const w of FX.windows) {
      if (w.name === 'W5') { expect(w.zeros.length).toBe(2); continue; }   // capped, recorded
      expect(Math.abs(w.zeros.length - w.zerosExpectedRvM),
        w.name + ': zeros found must match the expected count').toBeLessThan(1.2);
    }
  });

  test('every refined zero is a zero of the corrected browser sum too', () => {
    for (const w of FX.windows) {
      for (const z of w.zeros) {
        // |M + C0| at a true zero is bounded by the remainder scale
        expect(Math.abs(zApprox(z.gamma))).toBeLessThan(TOL.KZERO * Math.pow(z.gamma, -0.75));
      }
    }
  });

  test('Gram points solve theta(g) = k pi', () => {
    for (const k of [0, 1, 7, 100, 5000]) {
      const g = gramPoint(k);
      expect(Math.abs(theta(g) - k * Math.PI)).toBeLessThan(1e-8 * Math.max(1, k));
    }
    expect(gramPoint(0)).toBeCloseTo(17.8455995, 5);
  });
});

describe('THE HARP — truth audio is the mathematics resampled', () => {
  test('the wavetable is the main sum, sample for sample', () => {
    const t0 = 5000, t1 = 5004, grid = 8;
    const wt = waveTable(t0, t1, grid);
    for (let i = 0; i < wt.length; i += 7) {
      const u = t0 + (i * (t1 - t0)) / (wt.length - 1);
      expect(wt[i]).toBeCloseTo(mainSum(u), 10);
    }
  });

  test('a solo term realises its own frequency: crossings against the law', () => {
    // solo n = 5 near t = 5000: the table is a pure weighted cosine whose
    // frequency per unit t is (theta' - log 5)/2pi; count its sign changes
    const t0 = 5000, t1 = 5020, grid = 16, n = 5;
    const wt = waveTable(t0, t1, grid, (m) => m === n);
    let crossings = 0;
    for (let i = 1; i < wt.length; i++) if ((wt[i - 1] < 0) !== (wt[i] < 0)) crossings++;
    const fPerT = (thetaPrime((t0 + t1) / 2) - Math.log(n)) / TAU;
    const expected = 2 * fPerT * (t1 - t0);
    expect(Math.abs(crossings - expected) / expected).toBeLessThan(0.05);
  });

  test('the table refuses to alias rather than aliasing silently', () => {
    expect(() => waveTable(1e6, 1e6 + 10, 0.5)).toThrow();
  });
});

describe('THE HARP — the claim boundary, enforced over the page', () => {
  const flat = PAGE.replace(/\s+/g, ' ').toLowerCase();

  test('the fences hold in the copy', () => {
    for (const banned of ['proves the riemann', 'supports the riemann', 'proof of rh',
      'evidence that all zeros', '26 dimensions of string', 'observer creates dimension',
      'the universe is encoded', 'first visualization', 'first sonification', 'historic']) {
      expect(flat.includes(banned), 'banned phrase present: ' + banned).toBe(false);
    }
  });

  test('the required sentences stand on the surface', () => {
    expect(PAGE).toContain('NOT EVIDENCE FOR RH');
    expect(PAGE).toContain('does not');
    expect(flat).toContain('does not determine whether off-line zeros exist');
    expect(flat).toContain('never a frequency');
    expect(flat).toContain('height at which term n enters');
    expect(PAGE).toContain('COMPUTED AND CHOSEN STAY NAMED');
    expect(PAGE).toContain('THE VOICE WAITS FOR THE HAND');
    // value classes named on the surface
    expect(PAGE).toContain('REFERENCE');
    expect(PAGE).toContain('BROWSER');
    expect(flat).toContain('interpolated says so');
  });

  test('EMPTINESS: the context is born inside the hand, once, and closes', () => {
    const count = (PAGE.match(/new AudioContext/g) || []).length;
    expect(count).toBe(1);
    expect(PAGE).toContain("if (!audio) audio = new AudioContext();");
    expect(flat.includes('autoplay')).toBe(false);
    expect(PAGE).toContain('every envelope closes');
  });

  test('self-contained: no external resource on the surface', () => {
    expect(/src\s*=\s*"http/i.test(PAGE)).toBe(false);
    expect(/href\s*=\s*"http/i.test(PAGE)).toBe(false);
    expect(PAGE).toContain("from '/app/luminara-harp-math.js'");
  });

  test('the disclosure of the drawing cap is wired, not decorative', () => {
    expect(PAGE).toContain('drawn individually');
    expect(PAGE).toContain('the sum uses all');
  });

  test('a workshop birth: no reading surface links the harp', () => {
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const p = path.join(ROOT, 'spatial', 'app', room + '.html');
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf-8').includes('luminara-harp'),
        room + ' must not link the harp yet').toBe(false);
    }
  });

  test('a solo never prints a correction it does not own', () => {
    // zApprox takes no mask (luminara-harp-math.js): C0 is the leading
    // correction to the COMPLETE main sum. Printed beside a soloed M it
    // implied a correction twenty-two times the real one at t = 1e6, and
    // the consistent value appeared nowhere on the surface. The readout
    // must withhold it under a solo, as the ribbon renderer already does.
    expect(PAGE).toContain('M + C0 withheld');
    const flat = PAGE.replace(/\s+/g, ' ');
    // the unmasked print must be the one guarded by the solo branch, so a
    // future edit cannot quietly reinstate the unconditional version
    // note: flat has collapsed the runs of spaces, so match the collapsed form
    expect(flat).toContain("solo ? ' · M + C0 withheld");
    expect(flat).not.toMatch(/'\s*·\s*M \+ C0 = ' \+ zApprox\(t\)\.toFixed\(6\) \+ '\s*\[BROWSER\]/);
  });

  test('the way back: unlinked is not the same as a dead end', () => {
    // the door INTO the harp is the workshop's, and it is pinned there.
    // this is the other direction, and it is the one that was missing: a
    // hand that walked in from the shelf must be able to leave the way it
    // came, exactly as every other workshop instrument allows. Being an
    // observatory earns the harp no exemption from letting a reader out.
    const nav = PAGE.slice(PAGE.indexOf('<nav class="lnav">'), PAGE.indexOf('</nav>'));
    expect(nav.length, 'the harp must carry the nav').toBeGreaterThan(0);
    for (const room of ['luminara-read', 'luminara-map-room', 'luminara-ring',
      'luminara-resonance', 'luminara-instrument', 'luminara-harmonic-language',
      'luminara-astrolabe', 'luminara-spectrum', 'luminara-workshop']) {
      expect(nav, 'the way back must carry ' + room).toContain('/app/' + room + '.html');
    }
    // every door it names is a real page, not a promise
    for (const m of nav.matchAll(/href="\/app\/([a-z0-9-]+)\.html"/g)) {
      expect(fs.existsSync(path.join(ROOT, 'spatial', 'app', m[1] + '.html')),
        'the harp links a missing page: ' + m[1]).toBe(true);
    }
    // and no entry claims to be the room you are standing in, because
    // none of them is this page
    expect(nav.includes('class="on"')).toBe(false);
  });
});

describe('THE HARP — fixtures carry their own honesty', () => {
  test('the fixtures record generator, precision, and the RvM numbers', () => {
    expect(FX.meta.dps).toBe(80);
    expect(FX.meta.generator).toBe('scripts/harpFixtures.py');
    for (const w of FX.windows) {
      expect(w.zerosExpectedRvM).toBeGreaterThan(0);
      expect(Array.isArray(w.zeros)).toBe(true);
    }
  });
});
