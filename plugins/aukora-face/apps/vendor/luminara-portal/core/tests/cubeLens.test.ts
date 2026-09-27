// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CUBE LENS'S PINS — a viewer for the geometry, never a source of it.
// The lens may show what THE SPINE found and may add nothing: no casting, no
// letters, no coordinates of its own. The structures it lights are checked
// here against the canon directly, so a lens that started inventing would
// break loudly.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { counterOf, codeOf, knotOf } from '../../spatial/app/luminara-canon.js';
import { homeOf, classOf } from '../../spatial/app/luminara-cube.js';

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-cube-lens.html'), 'utf8');

describe('THE CUBE LENS — a viewer for the geometry', () => {
  test('the room exists and carries its own law', () => {
    expect(SRC).toContain('THE CUBE LENS');
    expect(SRC).toContain('NOTHING HERE IS A READING');
    expect(SRC).toContain('DERIVED, NEVER DRAWN');
  });

  test('coordinates come from the cube, glyphs from the renderer, relations from canon', () => {
    expect(SRC).toContain("from '/app/luminara-canon.js'");
    expect(SRC).toContain("from '/app/luminara-cube.js'");
    expect(SRC).toContain("from '/app/luminara-knots.js'");
    for (const fn of ['homeOf', 'classOf', 'DEPTH_OF_AXIS']) {
      expect(SRC.includes(fn), 'the cube owns this, the lens must import it: ' + fn).toBe(true);
    }
    for (const fn of ['knotSvg', 'glyphInk', 'metalOf']) {
      expect(SRC.includes(fn), 'the glyph must draw through the shared renderer: ' + fn).toBe(true);
    }
    // no second coordinate system, no hand-rolled projection
    expect(SRC.includes('function homeOf')).toBe(false);
    expect(SRC.includes("getContext('2d')")).toBe(false);
  });

  test('the lens reads and writes the shared focus, never a second store', () => {
    expect(SRC).toContain("from '/app/luminara-focus.js'");
    for (const fn of ['focus', 'setFocus', 'onFocus']) {
      expect(SRC.includes(fn), 'the shared invariant must be used, not reinvented: ' + fn).toBe(true);
    }
    // a touch sets the focus; nothing hand-rolls a second notion of "current card"
    expect(SRC.includes('let currentCard')).toBe(false);
    expect(SRC.includes('localStorage')).toBe(false);
  });

  test('no casting machinery and no fresh chance', () => {
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'composeReading',
      'Math.random', 'crypto.getRandomValues', 'drand']) {
      expect(SRC.includes(forbidden), 'the lens must not touch: ' + forbidden).toBe(false);
    }
  });

  test('the letters stay sealed', () => {
    expect(SRC.includes('.letter')).toBe(false);
    expect(SRC.includes('SILENCES')).toBe(false);
  });

  test('a workshop instrument: unlinked from the nav until graduated', () => {
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const page = fs.readFileSync(path.join(ROOT, 'spatial/app/' + room + '.html'), 'utf8');
      expect(page.includes('luminara-cube-lens'), room + ' must not link the lens yet').toBe(false);
    }
  });
});

describe('THE CUBE LENS — the structures it lights are the canon’s', () => {
  const nOf = (d: number[]) => 9 * d[0] + 3 * d[1] + d[2] + 1;

  test('thirteen lines, each the Seed with a dyad, each summing to zero', () => {
    const lines = new Set<string>();
    for (let n = 2; n <= 27; n++) lines.add([n, counterOf(n)].sort((a, b) => a - b).join(','));
    expect(lines.size).toBe(13);
    for (const L of lines) {
      const [a, b] = L.split(',').map(Number);
      expect(counterOf(a)).toBe(b);
      expect(knotOf(a).q + knotOf(b).q).toBe(0);   // the Seed contributes nothing
    }
  });

  test('thirteen planes of nine, each poled by a distinct dyad', () => {
    const poles = new Set<string>();
    let count = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let g = 0; g < 3; g++) {
      if (!a && !b && !g) continue;
      if ([a, b, g].find((x) => x !== 0) !== 1) continue;
      count++;
      const members: number[] = [];
      for (let n = 1; n <= 27; n++) {
        const d = codeOf(n);
        if ((a * d[0] + b * d[1] + g * d[2]) % 3 === 0) members.push(n);
      }
      expect(members.length).toBe(9);
      const pole = nOf([a, b, g]);
      poles.add([pole, counterOf(pole)].sort((x, y) => x - y).join(','));
    }
    expect(count).toBe(13);
    expect(poles.size).toBe(13);   // a bijection: no name had to be invented
  });

  test('four body diagonals, and the trinity is one of them', () => {
    const diagonals = new Set<string>();
    for (let n = 1; n <= 27; n++) {
      if (classOf(n) === 'corner') diagonals.add([n, counterOf(n)].sort((a, b) => a - b).join(','));
    }
    expect(diagonals.size).toBe(4);
    expect(diagonals.has('14,27')).toBe(true);          // the Scar and the Return
    expect(homeOf(1)).toEqual([0, 0, 0]);               // the Seed at the core
    expect(classOf(14)).toBe('corner');
    expect(classOf(27)).toBe('corner');
  });

  test('the cube census is the deck’s shells', () => {
    const tally: Record<string, number> = {};
    for (let n = 1; n <= 27; n++) tally[classOf(n)] = (tally[classOf(n)] || 0) + 1;
    expect(tally).toEqual({ core: 1, centre: 6, edge: 12, corner: 8 });
  });
});
