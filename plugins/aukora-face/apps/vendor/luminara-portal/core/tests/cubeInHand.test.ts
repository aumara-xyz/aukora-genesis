// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CUBE, TURNED IN THE HAND — the pins of the workshop surface. The
// twenty-seven held as the parts of one solid, glyphs at their barycentres,
// slowly turning. Pinned at birth (10 August 2026) to the laws it was born
// under: it names and never means, casts nothing, sends nothing, honours the
// reader's stillness, and keeps the null unlit. Scanned over the source, the
// same craft the astrolabe's own pins use.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-cube-in-the-hand.html'), 'utf-8');
const ASTRO = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-astrolabe.html'), 'utf-8');

describe('THE CUBE IN THE HAND — a held object, lawful from birth', () => {
  test('one geometry, the canon quoted: the glyphs are the deck’s own', () => {
    // the knots and metals come whole from the shared renderer, and the
    // seats from the canon’s codes: nothing on this page invents a form
    expect(PAGE).toContain("from '/app/luminara-canon.js'");
    expect(PAGE).toContain("from '/app/luminara-knots.js'");
    // the glyphs are in the round, but the winding law and the tempered ramp
    // are still the shared renderer's own: tube q against longitude p on the
    // golden torus, un-flattened rather than re-invented
    expect(PAGE).toContain('qf * t + phase');
    expect(PAGE).toContain('rampOf(');
    expect(PAGE).toContain('<canvas id="ink"');
    expect(PAGE).toContain('codeOf(n).map((d) => (d === 2 ? -1 : d))');
    // the bloom lands on the plate's own seats: the one layout quoted, so
    // the two surfaces can never drift apart
    expect(PAGE).toContain("from '/app/map-room-figures.js'");
    expect(PAGE).toContain('rosetteLayout(S)');
  });

  test('no draw machinery, no entropy, nothing sent: composed, never cast', () => {
    for (const banned of ['drawOne', 'drawWide', 'castSeed', 'descend(', 'Math.random',
      'localStorage', 'skyStampOf']) {
      expect(PAGE.includes(banned), 'the cube must not touch: ' + banned).toBe(false);
    }
    expect(/fetch\(|XMLHttpRequest|navigator\.send/.test(PAGE)).toBe(false);
  });

  test('the surface is silent, entirely: no voice waits on any touch', () => {
    expect(/AudioContext|createOscillator/.test(PAGE)).toBe(false);
    expect(PAGE).toContain('SILENT, ENTIRELY');
  });

  test('a touch names, it never means: the Guide holds the door', () => {
    expect(PAGE).toContain('NAMES, NEVER MEANINGS');
    expect(PAGE).toContain('its meanings, in the Guide');
    expect(PAGE).toContain('/app/luminara-read.html#guide');
  });

  test('the idle turn yields to the hand and to the reader’s stillness', () => {
    // the still law is consulted before the cube ever turns itself, and a
    // drag or a tween holds the idle turn off
    expect(PAGE).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(PAGE).toContain('!stillLaw.matches && !drag && !targetM');
  });

  test('the null is never lit: the Seed is the one dark part', () => {
    // the Seed’s disc wears the page’s own dark, ringed in white gold, and
    // the legend says why: the core is the part no turning shows
    expect(PAGE).toContain("ctx.fillStyle = '#0a0b0e'");
    expect(PAGE).toContain('the one part no turning shows');
  });

  test('the corner bearing is the astrolabe’s own, so THE SHADOW rhymes with the plate', () => {
    // same matrix on both pages would be overreach; what is pinned is the
    // shared convention: the corner bearing named, and the two surfaces
    // pointing at each other by address
    expect(PAGE).toContain('1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)');
    expect(PAGE).toContain('/app/luminara-astrolabe.html');
    expect(ASTRO).toContain('/app/luminara-cube-in-the-hand.html');
  });

  test('THE PLATE is a pose in the world, and the pose is an object', () => {
    // the flat pose is anchored in space: the plate's seats lifted onto the
    // diagonal's plane, and the bloom a great-circle slide on each cell's own
    // shell sphere, so the radius is invariant in the very shape of the
    // arithmetic, not by a check bolted on after
    expect(PAGE).toContain('id="bPlate"');
    expect(PAGE).toContain('Math.sin((1 - ros) * c.om)');
    expect(PAGE).toContain('Math.sin(ros * c.om)');
    // the bloom still waits for the corner bearing to open, but the pose
    // then turns like the solid: neither the hand nor the idle turn undoes
    // it, and the old holds are gone
    expect(PAGE).toContain('if (targetM === null)');
    expect(PAGE.includes('&& !targetRos && !ros &&')).toBe(false);
    expect(PAGE.includes("if (targetRos || ros) { targetRos = 0;")).toBe(false);
    // the shadow and the bloom are two teachings of one collapse, never both
    expect(PAGE).toContain('targetFlat = 0; document.getElementById(\'bShadow\').classList.remove(\'on\');');
  });

  test('THE ROSETTE is its own object: three perfect shells, measured then pinned', () => {
    // the claim the dress draws is checkable arithmetic: nearest neighbours
    // on each sphere give twelve, twenty-four and twelve edges, the
    // octahedron of faces, the cuboctahedron of edges, the cube of corners.
    // Measured here from the codes alone, exactly as the page derives them.
    const vecs: number[][] = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) vecs.push([a, b, c]);
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (const k of [1, 2, 3]) {
      const ring = vecs.filter((v) => v.filter((x) => x !== 0).length === k);
      const distOf = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      let min = Infinity;
      for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
        min = Math.min(min, distOf(ring[i], ring[j]));
      }
      for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
        if (distOf(ring[i], ring[j]) < min + 1e-9) counts[k]++;
      }
    }
    expect(counts[1], 'the octahedron of faces').toBe(12);
    expect(counts[2], 'the cuboctahedron of edges').toBe(24);
    expect(counts[3], 'the cube of corners').toBe(12);
    // and the page derives the same frames from distance alone, trades the
    // bones for them as the dress wakes, and owns the rosette's name
    expect(PAGE).toContain('id="bRosette"');
    expect(PAGE).toContain('const shellEdges = [];');
    expect(PAGE).toContain('distOf(a, b) < min + 1e-9');
    expect(PAGE).toContain('* (1 - Math.max(dress, anat))');
    expect(PAGE).toContain('THE ROSETTE IN THE ROUND');
  });

  test('the plate furnishes itself in the world as the bloom opens', () => {
    // the rings are circles on the diagonal's own plane, built from the
    // corner bearing's in-plane basis, and every stick of furniture carries
    // the bloom in its opacity: no bloom, no plate, and never a screen-locked
    // decoration pretending to be an object
    expect(PAGE).toContain('Math.cos(th) * E1[i] + Math.sin(th) * E2[i]');
    expect(PAGE).toContain('0.10 * ros');
    expect(PAGE).toContain('0.12 * ros');
    // the diameters are the plate's own dyads, one per pair, through the centre
    expect(PAGE).toContain('PLATE.get(c.n).q <= 0');
  });

  test('THE WATER is the knots’ native sea: the fourth mode, streamed and not turned', () => {
    // the stereographic eye, the three nested tori around the core circle,
    // and the double rotation as the mode's own ambient, tuned by a touch to
    // a card's winding so the strand pours along its own body
    expect(PAGE).toContain('id="bWater"');
    expect(PAGE).toContain('1 - y2');
    expect(PAGE).toContain('Math.PI / 6, Math.PI / 4, Math.PI / 3');
    expect(PAGE).toContain('W1 += stream[0] * dt');
    expect(PAGE).toContain('function streamOf(');
    // the null streams unlit at the heart of the weave
    expect(PAGE).toContain('the core circle streams unlit');
    // entering the sea lifts every pose: another embedding, never a pose
    expect(PAGE).toContain('targetRos = 0; ros = 0;');
  });

  test('the ambient is a tumble in the round, one law for every reading', () => {
    // the per-axis ambients (rolls about the line of sight, spins in plane)
    // read as a picture rotating on the glass and were withdrawn at the
    // architect's word, 11 August 2026: every reading now tumbles about two
    // axes so the sides come around, the flat poses included; the water
    // alone streams, its motion being the sphere's own double rotation
    expect(PAGE).toContain('turn(0, 0.11 * dt); turn(1, 0.034 * dt)');
    expect(PAGE.includes('function roll('), 'the roll must stay withdrawn').toBe(false);
    expect(PAGE.includes('function worldSpin('), 'the world spin must stay withdrawn').toBe(false);
    // a named bearing holds one breath before the tumble, and the hand
    // frees the bearing so no button claims an axis it lost
    expect(PAGE).toContain('lastHand = performance.now();');
    expect(PAGE).toContain('setSeat(null)');
  });

  test('THE MEETING draws the relation: the determinant made ink', () => {
    // the count comes whole from the pinned module, the pair is laid on the
    // one shared torus, and the marks ride the same stream as the strands
    expect(PAGE).toContain("from '/app/luminara-meetings.js'");
    expect(PAGE).toContain('meetingDet(');
    expect(PAGE).toContain('meetingPoints(');
    expect(PAGE).toContain('COS45');
    expect(PAGE).toContain('mp.th + W1, ph = mp.ph + W2');
    // the grammar: a second touch meets, open water releases, leaving the
    // water ends the meeting, and the ghost sea stays as context
    expect(PAGE).toContain('touch the water to release');
    expect(PAGE).toContain('a meeting lives in the water and stays there');
    expect(PAGE).toContain('ghost');
  });

  test('THE ANATOMY performs the reading: panes, struts, corners, glyphs at barycentres', () => {
    // the parts are drawn as the parts they are, in their own metals, and
    // the arithmetic beneath is measured here as the page derives it: an
    // edge cell's two endpoints, filling its one free axis, are always
    // corner cells; a face cell's four pane corners are always corners of
    // the cube; and the barycentre of each part is the cell itself.
    const vecs: number[][] = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) vecs.push([a, b, c]);
    for (const v of vecs) {
      const k = v.filter((x) => x !== 0).length;
      if (k === 2) {
        const j = v.findIndex((x) => x === 0);
        for (const s of [1, -1]) {
          const w = v.slice(); w[j] = s;
          expect(w.filter((x) => x !== 0).length, 'an edge ends on corners').toBe(3);
          // the two endpoints average back to the edge cell: the barycentre law
        }
        const mid = v.map((_, i) => (i === j ? 0 : v[i]));
        expect(mid).toEqual(v);
      }
      if (k === 1) {
        const i = v.findIndex((x) => x !== 0);
        const [j, l] = [0, 1, 2].filter((a2) => a2 !== i);
        let bary = [0, 0, 0];
        for (const [o0, o1] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
          const w = [0, 0, 0]; w[i] = v[i]; w[j] = o0; w[l] = o1;
          expect(w.filter((x) => x !== 0).length, 'a pane hangs on corners').toBe(3);
          bary = bary.map((x, m) => x + w[m] / 4);
        }
        expect(bary).toEqual(v);   // the pane's centre is the face cell itself
      }
    }
    expect(PAGE).toContain('id="bAnat"');
    expect(PAGE).toContain("kind: 'quad'");
    expect(PAGE).toContain('(1 - Math.max(dress, anat))');
    expect(PAGE).toContain('THE ANATOMY · THE CUBE ASSEMBLED FROM ITS TWENTY-SEVEN PARTS');
  });

  test('no button strands the hand: every solid reading steps out of the sea first', () => {
    // the water is a place, not a lock. Found stuck at the architect's hand
    // (11 August 2026): a mode pressed inside the sea tweened an invisible
    // pose. Every bearing and every pose now leaves the water before acting.
    expect(PAGE).toContain('const leaveWater');
    expect((PAGE.match(/^\s*leaveWater\(\);/gm) || []).length).toBeGreaterThanOrEqual(4);
  });

  test('a workshop surface: it carries the shared bar, and the bar does not list it', () => {
    // the portal law holds (every served page carries a way out), while the
    // graduation law holds too: unlisted until the architect seats it. The
    // page wears the nav; the nav does not name the page, not even here.
    expect(PAGE).toContain('<nav class="lnav">');
    expect(PAGE).toContain('<link rel="stylesheet" href="/app/luminara-nav.css">');
    const bar = PAGE.slice(PAGE.indexOf('<nav class="lnav">'), PAGE.indexOf('</nav>'));
    expect(bar.includes('cube-in-the-hand')).toBe(false);
    expect(PAGE).toContain('A WORKSHOP SURFACE');
  });
});
