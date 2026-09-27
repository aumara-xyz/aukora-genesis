// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE WATER'S OWN MEASURES (11 August 2026) — the sea's geometry, weighed
// and then pinned, the room's standing rule. The meetings hold the crossing
// counts; these pins hold the water itself: the shells' latitudes are a law
// and not a list, the middle shell is the Clifford torus exactly, every
// projected shell is confocal about the Seed's unit circle so the Seed
// threads the whole weave, the double rotation truly pours each strand along
// its own body, and the stereographic eye is safe from every strand the deck
// can wind. Pure mathematics against the sealed canon: no DOM, no page state.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { knotOf } from '../../spatial/app/luminara-canon.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-cube-in-the-hand.html'), 'utf-8');

// the law: shell k rides the flat torus at sin(alpha) = sqrt(k)/2
const ALPHA = (k: number) => Math.asin(Math.sqrt(k) / 2);

describe("THE WATER — the sea's geometry, measured then pinned", () => {
  test('the shells’ latitudes are a law, and the middle shell is the Clifford torus', () => {
    // sin(alpha) = sqrt(k)/2 gives exactly the seats the surface wears:
    // 0, pi/6, pi/4, pi/3 — the rosette's own square roots, become latitudes
    expect(ALPHA(0)).toBeCloseTo(0, 12);
    expect(ALPHA(1)).toBeCloseTo(Math.PI / 6, 12);
    expect(ALPHA(2)).toBeCloseTo(Math.PI / 4, 12);
    expect(ALPHA(3)).toBeCloseTo(Math.PI / 3, 12);
    expect(PAGE).toContain('[0, Math.PI / 6, Math.PI / 4, Math.PI / 3]');
    // the twelvefold rides the one torus where the two circles are equal,
    // which is the Clifford torus itself: the sea's own middle
    expect(Math.sin(ALPHA(2))).toBeCloseTo(Math.cos(ALPHA(2)), 12);
  });

  test('every projected shell is confocal about the Seed: A^2 - r^2 = 1', () => {
    // the stereographic image of the torus at latitude alpha is a torus of
    // revolution; its profile is measured here, never assumed. For every
    // shell the centre radius A and tube radius r obey A^2 - r^2 = 1, which
    // is the circle the Seed's own core projects to: the unit circle in the
    // sea's floor. (A - r)(A + r) = 1 means the tube's inner equator stands
    // inside the unit circle and its outer equator beyond it, for every
    // shell at once: the Seed THREADS all three tori. The heart of the weave
    // is not a figure of speech; it is an incidence, and it is pinned.
    const MEASURED: Record<number, [number, number]> = {
      1: [2 / Math.sqrt(3), 1 / Math.sqrt(3)],
      2: [Math.SQRT2, 1],
      3: [2, Math.sqrt(3)],
    };
    for (const k of [1, 2, 3]) {
      const a = ALPHA(k);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i <= 4000; i++) {
        const b = (i / 4000) * 2 * Math.PI;
        const rho = Math.cos(a) / (1 - Math.sin(a) * Math.sin(b));
        lo = Math.min(lo, rho); hi = Math.max(hi, rho);
      }
      const A = (hi + lo) / 2, r = (hi - lo) / 2;
      expect(A, 'centre radius of shell ' + k).toBeCloseTo(MEASURED[k][0], 6);
      expect(r, 'tube radius of shell ' + k).toBeCloseTo(MEASURED[k][1], 6);
      expect(A * A - r * r, 'confocal law at shell ' + k).toBeCloseTo(1, 6);
      expect(A - r, 'the Seed inside the tube of shell ' + k).toBeLessThan(1);
      expect(A + r, 'the tube of shell ' + k + ' beyond the Seed').toBeGreaterThan(1);
    }
  });

  test('the flow is exact: the double rotation pours every strand along itself', () => {
    // rotate the two circle-planes by (p s, q s) and the strand K(t) lands
    // on K(t + s): motion with no moving part, held to machine accuracy for
    // every winding the deck owns, on that card's own shell torus
    const rot2 = (x: number, y: number, th: number) =>
      [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
    let worst = 0;
    for (let n = 2; n <= 27; n++) {
      const k = knotOf(n);
      if (k.q === 0) continue;
      const a = ALPHA(3), ca = Math.cos(a), sa = Math.sin(a);   // the widest shell is the sternest test
      const K = (t: number) => [ca * Math.cos(k.p * t), ca * Math.sin(k.p * t),
        sa * Math.cos(k.q * t), sa * Math.sin(k.q * t)];
      for (let i = 0; i < 24; i++) {
        const t = i * 0.261, s = 0.5 + i * 0.13;
        const P = K(t);
        const [x1, x2] = rot2(P[0], P[1], k.p * s);
        const [x3, x4] = rot2(P[2], P[3], k.q * s);
        const Q = K(t + s);
        worst = Math.max(worst, Math.hypot(x1 - Q[0], x2 - Q[1], x3 - Q[2], x4 - Q[3]));
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  test('the eye is safe: no strand of the deck can touch the pole, and the fourth shell would', () => {
    // a strand on the torus at latitude alpha never exceeds x4 = sin(alpha),
    // so its distance to the projection pole is at least sqrt(2 - 2 sin a):
    // the widest shell keeps sqrt(2 - sqrt 3) clear of the eye, about half a
    // radius, and the bound is exact. The shell that does not exist, k = 4,
    // has sin(alpha) = 1: its core passes through the pole itself and leaves
    // the glass as the axis. The sea's boundary is drawn by the same law
    // that seats its shells.
    for (const k of [1, 2, 3]) {
      const bound = Math.sqrt(2 - 2 * Math.sin(ALPHA(k)));
      let min = Infinity;
      const a = ALPHA(k), ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i <= 6000; i++) {
        const t = (i / 6000) * 2 * Math.PI * 7;    // seven laps samples every winding phase
        const P = [ca * Math.cos(5 * t), ca * Math.sin(5 * t), sa * Math.cos(3 * t), sa * Math.sin(3 * t)];
        min = Math.min(min, Math.hypot(P[0], P[1], P[2], P[3] - 1));
      }
      expect(min, 'clearance of shell ' + k).toBeGreaterThanOrEqual(bound - 1e-6);
    }
    expect(Math.sqrt(2 - 2 * Math.sin(ALPHA(3)))).toBeCloseTo(Math.sqrt(2 - Math.sqrt(3)), 12);
    expect(Math.sin(ALPHA(4))).toBeCloseTo(1, 12);
  });
});
