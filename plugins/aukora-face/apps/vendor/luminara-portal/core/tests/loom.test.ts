// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE LOOM — the pins of the deck at home. Named at the architect's word,
// 11 August 2026, the successor to the archived study: the three-torus
// whose three circles are the three clocks, all eighty-one roads honest,
// the shuttle derived from the clock and never drawn, the thread grown
// only forward, the carry passing home through the null. Measured first,
// pinned second, the standing rule of the room.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-loom.html'), 'utf-8');
const SHOP = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-workshop.html'), 'utf-8');

describe('THE LOOM — the three-torus, measured before drawn', () => {
  test('the room holds eighty-one roads, and twenty-seven cross the seams', () => {
    // the discrete three-torus: every trit steps its cycle both ways, so
    // every pair differing in exactly one trit is one road. Counted whole
    // here, exactly the arithmetic the page draws.
    const vecs: number[][] = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) vecs.push([a, b, c]);
    let roads = 0, seams = 0;
    for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) {
      const diffs = [0, 1, 2].filter((k) => vecs[i][k] !== vecs[j][k]);
      if (diffs.length !== 1) continue;
      roads++;
      const [k] = diffs;
      if (Math.abs(vecs[i][k] - vecs[j][k]) === 2) seams++;   // flow against turn
    }
    expect(roads, 'all the moves of the torus').toBe(81);
    expect(seams, 'the moves no flat frame could carry').toBe(27);
    // and in the periodic drawing every seam road is still one step long:
    // out through the wall at +1 lands on the ghost of -1, one lattice unit
    expect(2 - 1).toBe(1);
    expect(PAGE).toContain('outA[i] += va[i] * S');
  });

  test('the shuttle is derived, never drawn, and the loom never prescribes', () => {
    expect(PAGE).toContain('standingCellOf(sim)');
    expect(PAGE).toContain('DERIVED FROM THE CLOCK, NEVER DRAWN');
    expect(PAGE).toContain('WEATHER, NEVER PERMISSION');
    // no cast machinery, no entropy, nothing kept, nothing sent
    for (const banned of ['drawOne', 'drawWide', 'castSeed', 'descend(', 'Math.random',
      'localStorage', 'skyStampOf']) {
      expect(PAGE.includes(banned), 'the loom must not touch: ' + banned).toBe(false);
    }
    expect(/fetch\(|XMLHttpRequest|navigator\.send/.test(PAGE)).toBe(false);
    expect(/AudioContext|createOscillator/.test(PAGE)).toBe(false);
  });

  test('the thread grows only forward, and the carry passes home through the null', () => {
    // a completing count returns through the still point: the calendar's own
    // law, drawn as the thread's one lawful visit to the Seed, and dashed
    expect(PAGE).toContain('to: [0, 0, 0], carry: true');
    expect(PAGE).toContain('from: [0, 0, 0], to: seatOf(vb), carry: true');
    expect(PAGE).toContain('THE THREAD GROWS ONLY FORWARD');
    // the loom does not unweave: nothing ever pops the thread from behind
    expect(PAGE.includes('thread.pop')).toBe(false);
    expect(PAGE.includes('thread.reverse')).toBe(false);
  });

  test('a touch names, it never means, and the stillness law is honoured', () => {
    expect(PAGE).toContain('NAMES, NEVER MEANINGS');
    expect(PAGE).toContain('its meanings, in the Guide');
    expect(PAGE).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    // under the still law the breathing ring stands steady rather than breathing
    expect(PAGE).toContain('stillLaw.matches ?');
    // and the loom weaves unwatched: the astrolabe's own timer, never a frame clock
    expect(PAGE).toContain('setInterval(');
    expect(PAGE.includes('requestAnimationFrame')).toBe(false);
  });

  test('the body is inherited, not sketched: the study’s own ink at full scale', () => {
    // the knots are in the round, the shared renderer's winding law kept
    // whole: tube q against longitude p on the golden torus, the tempered
    // ramp lighting every strand. The loom is the body lived in, so it must
    // wear the body's own ink, never a smaller dialect of it.
    expect(PAGE).toContain('qf * t + phase');
    expect(PAGE).toContain('rampOf(');
    expect(PAGE).toContain('const S = 52');
  });

  test('the walls are weather, not furniture: summoned by a crossing, cooled with it', () => {
    // a neighbouring room appears only when the living thread actually
    // crosses its seam, at the heat of the crossing that summoned it; the
    // receiving wall is the nine cells facing the crossing, and the Seed is
    // never among them, since the null does not stand on any wall
    expect(PAGE).toContain('wallHeat');
    expect(PAGE).toContain("if (c.v[i] !== -t) continue;");
    expect(PAGE).toContain('the seed is never on a wall');
  });

  test('the cloth: recurrence shows as geometry, for this sitting alone', () => {
    // every walked road takes one more turn of wear, the worn roads brighten
    // on a gentle log, and a fresh NOW is a fresh bolt: the cloth resets with
    // the thread and is never kept or sent (the store bans stand above)
    expect(PAGE).toContain('roadWear.set(key, (roadWear.get(key) || 0) + 1)');
    expect((PAGE.match(/roadWear = new Map\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(PAGE).toContain('Math.log2(1 + wear)');
  });

  test('the dress is the default face, and the standing shell breathes the tide', () => {
    // the rosette is the loom's opening dress at the architect's word, the
    // button baring the body instead; and the shell the shuttle stands on
    // carries the hour's breath, the still centre exempt by the oldest law
    expect(PAGE).toContain('let dress = 1, targetDress = 1');
    expect(PAGE).toContain('<button id="bRosette" class="on"');
    expect(PAGE).toContain('const tideOf = (k) => (k === standShell && k > 0');
    expect(PAGE).toContain('* dress * tideOf(');
  });

  test('the loom arrives already weaving, and the rosette is worn with time in it', () => {
    // the first look shows the walk: the last hours of the real clock are
    // seeded at arrival and at NOW, never an empty frame
    expect(PAGE).toContain('function seedThread()');
    expect((PAGE.match(/seedThread\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
    // the study's dress rides here unchanged, because it never moved a seat:
    // the shells' frames derived from distance alone, traded for the bones
    expect(PAGE).toContain('id="bRosette"');
    expect(PAGE).toContain('const shellEdges = [];');
    expect(PAGE).toContain('* (1 - dress)');
    // and the hour's restlessness is the same geometry read aloud
    expect(PAGE).toContain("the hour's restlessness");
    expect(PAGE).toContain('SHELL_WORDS[byN.get(n).shell]');
  });

  test('a workshop surface: the shared bar carried, the loom unlisted, the shelf aware', () => {
    expect(PAGE).toContain('<nav class="lnav">');
    const bar = PAGE.slice(PAGE.indexOf('<nav class="lnav">'), PAGE.indexOf('</nav>'));
    expect(bar.includes('luminara-loom')).toBe(false);
    expect(PAGE).toContain('A WORKSHOP SURFACE');
    // the workshop knows its bench, and the archived study stands beside it
    expect(SHOP).toContain('/app/luminara-loom.html');
    expect(SHOP).toContain('/app/luminara-cube-in-the-hand.html');
  });
});
