// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE LETTER TABLE'S PINS — a periodic table for the ledger's open letter
// question, held to the same discipline as every other instrument: it may
// show the ledger's four readings, but it may never become a fifth one, and
// it must never re-derive canon math it can simply import.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-letter-table.html'), 'utf8');

describe('THE LETTER TABLE — a viewer for the ledger, never a fifth grid', () => {
  test('the room exists and carries its own law', () => {
    expect(SRC).toContain('THE LETTER TABLE');
    expect(SRC).toContain('letter-free by construction');
    expect(SRC).toContain('independent proof');
  });

  test('every shape is imported from canon, never re-derived', () => {
    // codeOf, knotOf, CARDS, SILENCES and the render module are the single
    // source of truth; this page must draw through them, not duplicate them.
    expect(SRC).toContain("from '/app/luminara-canon.js'");
    expect(SRC).toContain("from '/app/luminara-knots.js'");
    for (const fn of ['codeOf', 'knotOf', 'CARDS', 'SILENCES']) {
      expect(SRC.includes(fn), 'must import, not reimplement: ' + fn).toBe(true);
    }
    for (const fn of ['knotSvg', 'glyphInk', 'metalOf']) {
      expect(SRC.includes(fn), 'the knot must draw through the shared renderer: ' + fn).toBe(true);
    }
    // no second CARDS array, no hand-rolled canvas torus projection
    expect(SRC.includes('const CARDS = [')).toBe(false);
    expect(SRC.includes('getContext(\'2d\')')).toBe(false);
  });

  test('all four readings stand, none silently promoted over another', () => {
    for (const key of ['A:', 'B:', 'SWAP:', 'RETURN:']) {
      expect(SRC.includes(key), 'a stated view is missing: ' + key).toBe(true);
    }
    // Grid A is drawn from the live letter, not a fifth invented seating
    expect(SRC).toContain('CARDS[n - 1].letter');
  });

  test('a workshop instrument: unlinked from the nav until the architect graduates it', () => {
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const page = fs.readFileSync(path.join(ROOT, 'spatial/app/' + room + '.html'), 'utf8');
      expect(page.includes('luminara-letter-table'), room + ' must not link the table yet').toBe(false);
    }
  });

  test('points back to the ledger it visualises', () => {
    expect(SRC).toContain('/app/luminara-map-room.html#/letters-ledger');
  });
});
