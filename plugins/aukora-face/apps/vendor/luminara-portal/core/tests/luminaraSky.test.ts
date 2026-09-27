// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE SKY'S PINS — the ephemeris graduated from the bench, held to its
// honest tolerance. The terms are linear (mean longitudes, no lunar
// theory), so the pins do not pretend precision: they hold the module to a
// few degrees against real eclipses whose moments the terms did not know,
// and to about a day against the almanac's own dates. The two forced
// correspondences of THE ASTROLABE OF THE 27 are pinned structurally: the
// dark moon is the phase cycle's zero and the full its antipode, at the
// bisection's own accuracy, forever.

import { describe, expect, test } from 'vitest';
import {
  SYNODIC, skyOf, elongationOf, litFraction, nodeDistance, eotMinutes,
  sunThird, phaseThird, watchOf, skyCellOf,
  nextNewMoon, nextFullMoon, nextStation, nextEotZero, dragonWindow, nextLeapDay,
} from '../../spatial/app/luminara-sky.js';

const at = (s: string) => new Date(s);
const signedTo = (angle: number, target: number) => Math.abs(((angle - target + 540) % 360) - 180);

describe('THE SKY — the walkers against real eclipses', () => {
  test('epoch: the three walkers stand at their J2000 terms exactly', () => {
    const sky = skyOf(at('2000-01-01T12:00:00Z'));
    expect(sky.sun).toBeCloseTo(280.460, 6);
    expect(sky.moon).toBeCloseTo(218.316, 6);
    expect(sky.node).toBeCloseTo(125.04452, 6);
  });

  test('solar eclipses fall at the dark pin, near a crossing', () => {
    // moments the linear terms did not know: real totalities
    for (const iso of ['1999-08-11T11:03:00Z', '2024-04-08T18:18:00Z', '2026-08-12T17:46:00Z']) {
      const sky = skyOf(at(iso));
      expect(signedTo(elongationOf(sky), 0), iso + ' elongation').toBeLessThan(8);
      expect(nodeDistance(sky), iso + ' node distance').toBeLessThan(12);
      expect(litFraction(elongationOf(sky)), iso + ' lit').toBeLessThan(0.02);
    }
  });

  test('a lunar eclipse falls at the full pin, near a crossing', () => {
    const sky = skyOf(at('2000-01-21T04:44:00Z'));
    expect(signedTo(elongationOf(sky), 180)).toBeLessThan(8);
    expect(nodeDistance(sky)).toBeLessThan(12);
    expect(litFraction(elongationOf(sky))).toBeGreaterThan(0.98);
  });

  test('the two pins, structurally: conjunction is zero, opposition its antipode', () => {
    const nm = nextNewMoon(at('2026-07-21T00:00:00Z'))!;
    const fm = nextFullMoon(at('2026-07-21T00:00:00Z'))!;
    expect(signedTo(elongationOf(skyOf(nm)), 0)).toBeLessThan(0.01);
    expect(signedTo(elongationOf(skyOf(fm)), 180)).toBeLessThan(0.01);
    expect(litFraction(0)).toBe(0);
    expect(litFraction(180)).toBe(1);
    expect(litFraction(90)).toBeCloseTo(0.5, 10);
  });

  test('the synodic month is measured, not assumed', () => {
    const n1 = nextNewMoon(at('2026-01-01T00:00:00Z'))!;
    const n2 = nextNewMoon(new Date(n1.getTime() + 86400000))!;
    const days = (n2.getTime() - n1.getTime()) / 86400000;
    expect(Math.abs(days - SYNODIC)).toBeLessThan(0.15);
  });

  test('the almanac dates land within the honest day', () => {
    const nm = nextNewMoon(at('2026-07-21T00:00:00Z'))!;   // almanac: 2026-08-12
    const fm = nextFullMoon(at('2026-07-21T00:00:00Z'))!;  // almanac: 2026-07-29
    expect(Math.abs(nm.getTime() - Date.UTC(2026, 7, 12, 18)) / 86400000).toBeLessThan(1.3);
    expect(Math.abs(fm.getTime() - Date.UTC(2026, 6, 29, 0)) / 86400000).toBeLessThan(1.3);
  });
});

describe('THE SKY — the observances', () => {
  test('the next station is the autumn crossing, within the mean-sun days', () => {
    const st = nextStation(at('2026-07-21T00:00:00Z'))!;   // almanac equinox: 2026-09-23
    expect(st.name).toBe('the autumn crossing');
    expect(Math.abs(st.when.getTime() - Date.UTC(2026, 8, 23)) / 86400000).toBeLessThan(3);
  });

  test('the breath crosses zero near the first of September', () => {
    const z = nextEotZero(at('2026-07-21T00:00:00Z'))!;    // classical zero: ~Sep 1
    expect(Math.abs(z.getTime() - Date.UTC(2026, 8, 1)) / 86400000).toBeLessThan(7);
    expect(Math.abs(eotMinutes(at('2026-09-01T12:00:00Z')))).toBeLessThan(2);
    expect(eotMinutes(at('2026-11-03T12:00:00Z'))).toBeGreaterThan(14);   // the deep swing
  });

  test('the dragon window opens before the August eclipse and holds it', () => {
    const before = dragonWindow(at('2026-07-21T00:00:00Z'));
    expect(before.open).toBe(false);
    expect(Math.abs(before.opens!.getTime() - Date.UTC(2026, 7, 7)) / 86400000).toBeLessThan(4);
    const during = dragonWindow(at('2026-08-12T00:00:00Z'));
    expect(during.open).toBe(true);
  });

  test("the debt day is the ladder's own next grant", () => {
    expect(nextLeapDay(at('2026-07-21T00:00:00Z'))!.toISOString().slice(0, 10)).toBe('2028-02-29');
  });
});

describe('THE SKY — the true clocks are coordinates', () => {
  test('the thirds are pure and bounded', () => {
    const d = at('2026-07-21T09:00:00Z');
    const sky = skyOf(d);
    for (const v of [sunThird(sky), phaseThird(sky), watchOf(d)]) {
      expect([0, 1, 2]).toContain(v);
    }
    const cell = skyCellOf(d);
    expect(cell.n).toBe(cell.time * 9 + cell.depth * 3 + cell.state + 1);
    expect(cell.n).toBeGreaterThanOrEqual(1);
    expect(cell.n).toBeLessThanOrEqual(27);
    // deterministic: the same moment always yields the same cell
    expect(skyCellOf(new Date(d.getTime())).n).toBe(cell.n);
  });
});
