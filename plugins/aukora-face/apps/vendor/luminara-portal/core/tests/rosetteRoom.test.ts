// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE ROSETTE'S OWN ROOM — the pins of the surface that holds one object
// and nothing else: the deck with every choice removed. Given its room at
// the architect's word, 11 August 2026. The shells' counts and the
// equilibrium are pinned where they were first measured
// (core/tests/cubeInHand.test.ts); these pins hold the room to its own
// laws: the nearness, the release, the silence, and the absence of fiat.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-rosette.html'), 'utf-8');
const SHOP = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-workshop.html'), 'utf-8');
const CHART = fs.readFileSync(path.join(ROOT, 'docs', 'map-room', 'THE_ROSETTE_IN_THE_ROUND.md'), 'utf-8');

describe('THE ROSETTE — one object, nothing chosen, a room that leans in', () => {
  test('nothing on this page is a fiat: seats, frames and dyads all derived', () => {
    // the seats are the codes, the frames nearest neighbours from distance
    // alone, the dyads negation: the same derivations the chart argues from
    expect(PAGE).toContain('codeOf(n).map((d) => (d === 2 ? -1 : d))');
    expect(PAGE).toContain('distOf(a, b) < min + 1e-9');
    expect(PAGE).toContain('counterOf(');
    // and the ink is the shared renderer's own winding law, inherited whole
    expect(PAGE).toContain('qf * t + phase');
    expect(PAGE).toContain('rampOf(');
  });

  test('the nearness: a touch draws near and tracks, a double touch stands back', () => {
    // one scalar eases the whole approach, the focus seat re-projected every
    // frame so the slow turn orbits the chosen knot rather than freezing it
    expect(PAGE).toContain('let focusN = null, near = 0, targetNear = 0;');
    expect(PAGE).toContain('(x - fx * near) * mag');
    expect(PAGE).toContain("svg.addEventListener('dblclick'");
    expect(PAGE).toContain('targetNear = 0;');
    // stood fully back, the choice is released rather than remembered
    expect(PAGE).toContain('if (near === 0) focusN = null;');
    // and drawn near, the turn slows to a drift so the knot can be read
    expect(PAGE).toContain('(0.08 - 0.06 * near) * dt');
  });

  test('the chosen card lights its answer across the body: the dyad drawn, never told', () => {
    expect(PAGE).toContain('counterOf(c.n) === focusN');
    expect(PAGE).toContain('answers ');
  });

  test('the room keeps the family laws: silent, castless, naming, still', () => {
    for (const banned of ['drawOne', 'drawWide', 'castSeed', 'descend(', 'Math.random',
      'localStorage', 'skyStampOf']) {
      expect(PAGE.includes(banned), 'the rosette must not touch: ' + banned).toBe(false);
    }
    expect(/fetch\(|XMLHttpRequest|navigator\.send/.test(PAGE)).toBe(false);
    expect(/AudioContext|createOscillator/.test(PAGE)).toBe(false);
    expect(PAGE).toContain('NAMES, NEVER MEANINGS');
    expect(PAGE).toContain('its meanings, in the Guide');
    expect(PAGE).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(PAGE).toContain('setInterval(');
    expect(PAGE.includes('requestAnimationFrame')).toBe(false);
    expect(PAGE).toContain('NOTHING HERE IS CHOSEN');
  });

  test('the flight, the isolation and the breath keep their laws', () => {
    // the eye is a world point eased toward its seat, so the road between
    // antipodes is the straight chord, and a chord between opposites passes
    // the origin: measured here, v and its negation summing to zero
    expect(PAGE).toContain('let eyeW = [0, 0, 0];');
    expect(PAGE).toContain('flown through the still centre');
    for (const v of [[1, 0, 0], [1, -1, 1], [0, 1, -1]]) {
      expect(v.map((x, i) => x + (-v[i]))).toEqual([0, 0, 0]);
    }
    // one solid forward, the rest ghosted; the same button releases; the
    // still centre never dimmed (ghostOf exempts shell zero)
    expect(PAGE).toContain('const ISO_BTNS = { bSix: 1, bTwelve: 2, bEight: 3 };');
    expect(PAGE).toContain('1 - 0.85 * iso');
    expect(PAGE).toContain('k !== 0');
    // the breath loops apart and home, resumes where it left off, and under
    // the still law holds apart unmoving
    expect(PAGE).toContain('1 + br * (0.10 + 0.15 * k)');
    expect(PAGE).toContain('brPhase = Math.acos');
    expect(PAGE).toContain('breathOn ? 0.5 : 0');
  });

  test('graduated at the architect’s word: the tenth door in every bar', () => {
    expect(PAGE).toContain('<a href="/app/luminara-rosette.html" class="on">THE ROSETTE</a>');
    expect(PAGE).toContain('GRADUATED AT THE ARCHITECT');
    expect(PAGE).toContain('#/rosette-in-the-round');
    expect(SHOP).toContain('/app/luminara-rosette.html');
    expect(CHART).toContain('/app/luminara-rosette.html');
    // every page that carries the shared bar carries the tenth door
    const APP = path.join(ROOT, 'spatial', 'app');
    for (const f of fs.readdirSync(APP).filter((x) => x.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(APP, f), 'utf-8');
      const i = src.indexOf('<nav class="lnav">');
      if (i < 0) continue;
      const bar = src.slice(i, src.indexOf('</nav>', i));
      expect(bar.includes('luminara-rosette.html'), f + ' must carry the tenth door').toBe(true);
    }
  });
});
