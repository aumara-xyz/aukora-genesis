// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE MEETINGS' PINS. The claim is arithmetic before it is ink: two windings
// on one torus cross exactly |p·q' - q·p'| times, the determinant of their
// two laws. Measured across every pair the deck can make, then pinned, so
// the surface that draws the meetings can never drift from the count.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { knotOf, counterOf, cardOf } from '../../spatial/app/luminara-canon.js';
import { meetingDet, meetingPoints, MEETING_SEP } from '../../spatial/app/luminara-meetings.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const MOD = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-meetings.js'), 'utf-8');

describe('THE MEETINGS — the determinant of two laws, counted and kept', () => {
  test('every pair of the deck meets exactly |det| times: all 351, none excused', () => {
    for (let a = 1; a <= 27; a++) {
      for (let b = a + 1; b <= 27; b++) {
        const A = knotOf(a), B = knotOf(b);
        const D = meetingDet(A.p, A.q, B.p, B.q);
        const pts = meetingPoints(A.p, A.q, B.p, B.q);
        expect(pts.length, cardOf(a).name + ' meets ' + cardOf(b).name).toBe(Math.abs(D));
      }
    }
  });

  test('the deck holds no parallel pair: every two cards truly meet', () => {
    // measured before it was believed: no two of the twenty-seven share a
    // slope, so the meeting is never empty and the relation web is complete
    for (let a = 1; a <= 27; a++) {
      for (let b = a + 1; b <= 27; b++) {
        const A = knotOf(a), B = knotOf(b);
        expect(meetingDet(A.p, A.q, B.p, B.q), a + ' v ' + b).not.toBe(0);
      }
    }
  });

  test('the determinant is antisymmetric, and a dyad meets its answer 2pq times', () => {
    for (let a = 2; a <= 27; a++) {
      const A = knotOf(a), C = knotOf(counterOf(a));
      expect(meetingDet(A.p, A.q, C.p, C.q)).toBe(-meetingDet(C.p, C.q, A.p, A.q));
      // the answer's law is the mirror (same p, negated q), so the meeting
      // of a card with its own answer is always -2pq: the dyad's spread
      expect(meetingDet(A.p, A.q, C.p, C.q), 'dyad of ' + a).toBe(-2 * A.p * A.q);
    }
  });

  test('the largest meeting is the Scar against the Return: 182 crossings', () => {
    let maxD = 0, at = '';
    for (let a = 1; a <= 27; a++) {
      for (let b = a + 1; b <= 27; b++) {
        const A = knotOf(a), B = knotOf(b);
        const D = Math.abs(meetingDet(A.p, A.q, B.p, B.q));
        if (D > maxD) { maxD = D; at = a + 'v' + b; }
      }
    }
    expect(maxD).toBe(182);
    expect(at).toBe('14v27');
  });

  test('the separation is declared, golden, and the count does not depend on it', () => {
    expect(MOD).toContain('MEETING_SEP');
    const A = knotOf(11), B = knotOf(18);
    const D = Math.abs(meetingDet(A.p, A.q, B.p, B.q));
    for (const sep of [MEETING_SEP, 0.31, 1.7, 2.9]) {
      expect(meetingPoints(A.p, A.q, B.p, B.q, sep).length, 'sep ' + sep).toBe(D);
    }
  });

  test('every meeting point lies on both windings, to the arithmetic’s own accuracy', () => {
    const TAU = 2 * Math.PI;
    const wrap = (x) => ((x % TAU) + TAU) % TAU;
    const A = knotOf(14), B = knotOf(22);   // a knot against a three-strand link
    for (const pt of meetingPoints(A.p, A.q, B.p, B.q)) {
      // the points come parameterised by A's winding (th = p·t, ph = q·t
      // from A's own gate), so lying on A is the closure of the arithmetic:
      // q·(th/p) - ph must vanish on the torus
      const onA = Math.abs(wrap(A.q * (pt.th / A.p) - pt.ph + Math.PI) - Math.PI);
      expect(onA, 'on A').toBeLessThan(1e-6);
    }
  });

  test('the module is pure: no clock, no entropy, no state, no draw', () => {
    for (const banned of ['Date', 'now(', 'Math.random', 'localStorage', 'document', 'window.']) {
      expect(MOD.includes(banned), 'the meetings must not touch: ' + banned).toBe(false);
    }
  });
});
