// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CONSOLE'S PINS — the synthesis surface held to THE RITE AND THE
// WORKSHOP. The console demonstrates that one focus crosses every mode; these
// pins hold that no cast can ever join it on the crossing, and that the page
// draws only through the focus layer and the modules that own each
// projection.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-console.html'), 'utf8');

describe('THE CONSOLE — one focus, four projections, no caster', () => {
  test('the room exists and carries the law it demonstrates', () => {
    expect(SRC).toContain('THE CONSOLE');
    expect(SRC).toContain('THE FOCUS CROSSES A MODE SWITCH; A CAST DOES NOT');
    expect(SRC).toContain('NOTHING HERE IS A READING');
  });

  test('no caster on this surface, and none may arrive quietly', () => {
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'composeReading', 'descend(',
      'Math.random', 'crypto.getRandomValues', 'drand', 'castDeclaration', 'scrambleWord']) {
      expect(SRC.includes(forbidden), 'the console must not touch: ' + forbidden).toBe(false);
    }
  });

  test('every pane draws through the focus layer and the owning modules', () => {
    expect(SRC).toContain("from '/app/luminara-focus.js'");
    expect(SRC).toContain("from '/app/luminara-canon.js'");
    expect(SRC).toContain("from '/app/luminara-cube.js'");
    expect(SRC).toContain("from '/app/luminara-knots.js'");
    for (const fn of ['projectionsOf', 'setFocus', 'onFocus', 'lineOf', 'planeOf']) {
      expect(SRC.includes(fn), 'the console must draw through: ' + fn).toBe(true);
    }
    // no second geometry: the page may not re-derive what the layer owns
    expect(SRC.includes('function knotOf')).toBe(false);
    expect(SRC.includes('function homeOf')).toBe(false);
    expect(SRC.includes('% 3')).toBe(false);
  });

  test('the letters stay sealed and the substrate question stays open', () => {
    expect(SRC.includes('.letter')).toBe(false);
    expect(SRC.includes('SILENCES')).toBe(false);
    // the wheel pane may claim only the counting circle, not a substrate
    expect(SRC).toContain('THE_THIRD_SUBSTRATE');
  });

  test('a workshop instrument: unlinked from the nav until graduated', () => {
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const page = fs.readFileSync(path.join(ROOT, 'spatial/app/' + room + '.html'), 'utf8');
      expect(page.includes('luminara-console'), room + ' must not link the console yet').toBe(false);
    }
  });
});
