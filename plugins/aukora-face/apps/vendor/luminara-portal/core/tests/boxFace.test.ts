// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE BOX FACE'S PINS — the lid of the deck's box. One emblem and one word,
// and the emblem is the SAME figure the volumes carry, imported rather than
// redrawn, so the outside of the box can never show a different mark from
// the books inside it.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pressBoxFace } from '../../scripts/pressBoxFace.mjs';
import { triquetraSvg } from '../../scripts/pressBookOfLuminara.mjs';

const SRC = readFileSync(
  fileURLToPath(new URL('../../scripts/pressBoxFace.mjs', import.meta.url)), 'utf8');
const { html, trim, bleed, sheet } = pressBoxFace();

describe('THE BOX FACE', () => {
  test('the emblem is the volumes own, never a second drawing of it', () => {
    expect(SRC).toContain("import { triquetraSvg }");
    expect(html).toContain(triquetraSvg());
    // no hand-drawn substitute crept in
    expect(SRC).not.toContain('<path d="M');
    expect(SRC).not.toMatch(/knotSvg\s*\(/);
  });

  test('the lid carries no word at all', () => {
    // a deck whose claim is that the shapes speak for themselves does not
    // print its own name on the outside of the box
    expect(html).not.toContain('LUMINARA<');
    expect(html).not.toContain('NILA PADMA');
    expect(html).not.toContain('2026');
    // the only text node in the body is the title in the head, nothing on the face
    const body = html.slice(html.indexOf('<body>'));
    expect(body.replace(/<[^>]*>/g, '').trim()).toBe('');
  });

  test('pressed to trim with a bleed, and the marks sit in the bleed', () => {
    expect(sheet).toBe(trim + 2 * bleed);
    expect(html).toContain('@page { size: ' + sheet + 'mm ' + sheet + 'mm');
    expect(html).toContain('width: ' + trim + 'mm; height: ' + trim + 'mm');
    // four corners, two marks apiece
    expect(html.split('class="crop h"').length - 1).toBe(4);
    expect(html.split('class="crop v"').length - 1).toBe(4);
  });

  test('the letters stay sealed and nothing is cast', () => {
    for (const forbidden of ['.letter', 'drawOne', 'drawThree', 'Math.random']) {
      expect(SRC.includes(forbidden), 'the box must not touch: ' + forbidden).toBe(false);
    }
  });
});

describe('THE EMBLEM — its rings follow the frame, not the origin', () => {
  test('the ghost rings are struck at the viewBox centre', () => {
    const svg = triquetraSvg();
    const vb = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
    const cx = +(vb[0] + vb[2] / 2).toFixed(3), cy = +(vb[1] + vb[3] / 2).toFixed(3);
    // both rings, and the rotation, take that centre: reading the origin
    // instead left the rings off the knot they enclose
    const rings = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)];
    expect(rings.length).toBe(2);
    for (const r of rings) {
      expect(Number(r[1])).toBeCloseTo(cx, 3);
      expect(Number(r[2])).toBeCloseTo(cy, 3);
    }
    expect(svg).toContain('rotate(-90 ' + cx + ' ' + cy + ')');
  });
});
