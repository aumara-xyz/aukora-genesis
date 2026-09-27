// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PARTICLE READING'S PINS — the emission theorem held to the canon it
// was computed from, in both directions, so that if the becomings or the
// windings ever move, the chart and the spectrum page break loudly rather
// than lie quietly. The reading is the deck's physics, never nature's;
// these pins hold the deck's side only.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CARDS, knotOf, becomingOf, counterOf } from '../../spatial/app/luminara-canon.js';
import { EMISSION } from '../../spatial/app/map-room-figures.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const SPECTRUM = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-spectrum.html'), 'utf-8');

describe('THE PARTICLE READING — computed, both directions, no exceptions', () => {
  const stable = CARDS.filter((c: any) => becomingOf(c.n) === null);
  const stableQ = new Set(stable.map((c: any) => Math.abs(knotOf(c.n).q)));

  test('the stable octet: eight at rest, at the charges the chart names', () => {
    expect(stable.length).toBe(8);
    expect([...stableQ].sort((a: any, b: any) => a - b)).toEqual([0, 1, 3, 4, 9, 10, 12, 13]);
  });

  test('the emission theorem: every emission stable, every stable charge emitted', () => {
    const emitted = new Set<number>();
    let decays = 0;
    for (const c of CARDS) {
      const b = becomingOf(c.n);
      if (b === null) continue;
      decays++;
      const dq = Math.abs(knotOf(c.n).q - knotOf(b).q);
      expect(stableQ.has(dq), c.name + ' sheds ' + dq + ', which is not a stable charge').toBe(true);
      emitted.add(dq);
    }
    expect(decays).toBe(19);
    // the other direction: no stable charge sits unused (zero cannot be
    // shed, for a decay that sheds nothing would not be a decay)
    expect([...emitted].sort((a, b) => a - b)).toEqual([1, 3, 4, 9, 10, 12, 13]);
  });

  test('the one Majorana: the Seed alone is its own antiparticle', () => {
    const self = CARDS.filter((c: any) => counterOf(c.n) === c.n);
    expect(self.map((c: any) => c.n)).toEqual([1]);
    expect(knotOf(1).q).toBe(0);
  });

  test('the selection rule: two generations closed, the third pours home', () => {
    const houseOf = (n: number) => (n <= 9 ? 'AUM' : n <= 18 ? 'MA' : 'RA');
    for (const c of CARDS) {
      const b = becomingOf(c.n);
      if (b === null) continue;
      const from = houseOf(c.n), to = houseOf(b);
      if (from === 'RA') expect(to).toBe('AUM');
      else expect(to).toBe(from);
    }
  });

  test('the ruling: found and made stay in separate rooms, and the figure literals match the canon', () => {
    // the zeta room holds zeta only: the emission section came home to the
    // chart at the architect's word (the shared word spectrum was the bridge,
    // and a join made on vocabulary is the interference the laws forbid)
    expect(SPECTRUM.includes('EMISSION')).toBe(false);
    expect(SPECTRUM.includes('emission')).toBe(false);
    expect(SPECTRUM.includes('PARTICLE')).toBe(false);
    // and the page still casts nothing
    expect(SPECTRUM.includes('drawOne')).toBe(false);
    // the chart carries the figure, drawn by the room's own illustrator
    const CHART = fs.readFileSync(
      path.join(__dirname, '../../docs/map-room/THE_PARTICLE_READING.md'), 'utf8');
    expect(CHART).toContain('::figure emission-spectrum::');
    // the illustrator's literals are the canon's own numbers: re-derive both
    const stable = CARDS.filter((c) => becomingOf(c.n) === null)
      .map((c) => Math.abs(knotOf(c.n).q)).sort((a, b) => a - b);
    const lines: Record<number, number> = {};
    let decays = 0;
    for (const c of CARDS) {
      const b = becomingOf(c.n);
      if (b === null) continue;
      decays++;
      const dq = Math.abs(knotOf(c.n).q - knotOf(b).q);
      lines[dq] = (lines[dq] || 0) + 1;
    }
    expect(EMISSION.stable).toEqual(stable);
    expect(EMISSION.lines).toEqual(lines);
    expect(EMISSION.decays).toBe(decays);
  });
});
