// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE SHEET'S PINS — a study companion for the physical deck, held to the
// one claim it makes on its own face: every quality shown is DERIVED, not
// assigned. So the pins check that it imports rather than invents, that it
// carries no reading, and that the two roll-ups it does compute (the
// becoming-root and the receptivity) are what the canon's own map says.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { becomingOf, knotOf, emanationOf, counterOf, isSilent } from '../../spatial/app/luminara-canon.js';
import { spectrumOf } from '../../spatial/app/luminara-cymatics.js';
import { voiceOf, GROUND_HZ } from '../../spatial/app/luminara-sound.js';

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-sheet.html'), 'utf8');

describe('THE SHEET — a companion, not a face and not a reading', () => {
  test('the page carries its own claim and its own limits', () => {
    expect(SRC).toContain('THE SHEET');
    expect(SRC).toContain('NOTHING HERE IS A READING');
    expect(SRC).toContain('A COMPANION, NOT A FACE');
    expect(SRC).toContain('DERIVED, NEVER ASSIGNED');
  });

  test('no caster, no entropy, no situational state', () => {
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'composeReading', 'descend(',
      'Math.random', 'crypto.getRandomValues', 'drand', 'seedStr', 'localStorage']) {
      expect(SRC.includes(forbidden), 'the sheet must not touch: ' + forbidden).toBe(false);
    }
  });

  test('every quality is imported from its owner, never re-derived', () => {
    expect(SRC).toContain("from '/app/luminara-canon.js'");
    expect(SRC).toContain("from '/app/luminara-cube.js'");
    expect(SRC).toContain("from '/app/luminara-knots.js'");
    for (const fn of ['knotOf', 'emanationOf', 'counterOf', 'becomingOf', 'classOf', 'metalOf']) {
      expect(SRC.includes(fn), 'the sheet must import: ' + fn).toBe(true);
    }
    // no second interval table, no second clarity formula, no second knot map
    expect(SRC.includes('INTERVALS')).toBe(false);
    expect(SRC.includes('clarity =')).toBe(false);
    expect(SRC.includes('function knotOf')).toBe(false);
  });

  test('the letters stay sealed', () => {
    expect(SRC.includes('.letter')).toBe(false);
  });

  test('the glyph keeps its own field in print, never an inversion', () => {
    // luminara-knots draws depth as luminance on the deck's night; inverting
    // it for paper would break the one-renderer law, so the cell keeps the
    // ground the renderer was written for
    expect(SRC).toContain('@media print');
    expect(SRC).toContain('print-color-adjust:exact');
    expect(SRC.includes('filter:invert')).toBe(false);
  });

  test('a workshop instrument: unlinked from the nav until graduated', () => {
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const page = fs.readFileSync(path.join(ROOT, 'spatial/app/' + room + '.html'), 'utf8');
      expect(page.includes('luminara-sheet'), room + ' must not link the sheet yet').toBe(false);
    }
  });
});

describe('THE SHEET — the two roll-ups agree with the canon', () => {
  // the sheet computes these by walking becomingOf; the same walk, checked
  const rootOf = (n: number) => { let x = n, g = 0; while (becomingOf(x) !== null && g++ < 10) x = becomingOf(x); return x; };

  test('every card falls to a settled root, and there are eight', () => {
    const roots = new Set<number>();
    for (let n = 1; n <= 27; n++) {
      const r = rootOf(n);
      expect(becomingOf(r)).toBeNull();   // a root is settled by definition
      roots.add(r);
    }
    expect(roots.size).toBe(8);
    expect(roots.has(1)).toBe(true);      // the Seed is one
    expect(roots.has(14)).toBe(true);     // and so is the Scar, alone
  });

  test('receptivity: only seven cards receive, and the Scar receives nothing', () => {
    const recv: Record<number, number> = {};
    for (let n = 1; n <= 27; n++) recv[n] = 0;
    for (let n = 1; n <= 27; n++) { const b = becomingOf(n); if (b) recv[b]++; }
    const receiving = Object.entries(recv).filter(([, c]) => c > 0);
    expect(receiving.length).toBe(7);
    expect(recv[1]).toBe(7);              // the Seed catches the most
    expect(recv[14]).toBe(0);             // the Scar catches nothing
    expect(becomingOf(14)).toBeNull();    // and sends nothing: the one isolate
  });

  test('the interval belongs to the dyad: counters share a sound', () => {
    for (let n = 1; n <= 27; n++) {
      expect(knotOf(n).interval).toBe(knotOf(counterOf(n)).interval);
    }
    // twelve intervals and silence across the twenty-seven
    const intervals = new Set<string>();
    for (let n = 1; n <= 27; n++) intervals.add(knotOf(n).interval);
    expect(intervals.size).toBe(13);
  });

  test('clarity stands at one for exactly the Seed, the Void and the Spectrum', () => {
    const perfect: number[] = [];
    for (let n = 1; n <= 27; n++) if (emanationOf(n).clarity === 1) perfect.push(n);
    expect(perfect).toEqual([1, 17, 24]);
  });

  test('the second page: the names in the tables are the standard ones', () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    // the trefoil arrives exactly four times, all in AUM (T(2,3) ≅ T(3,2))
    const trefoils: number[] = [];
    for (let n = 1; n <= 27; n++) {
      const k = knotOf(n), aq = Math.abs(k.q);
      if (aq && gcd(k.p, aq) === 1 && Math.min(k.p, aq) === 2 && Math.max(k.p, aq) === 3) trefoils.push(n);
    }
    expect(trefoils).toEqual([4, 6, 7, 8]);
    expect(trefoils.every((n) => n <= 9)).toBe(true);
    // the Depth and the Threshold are T(3,4): 8_19, eight crossings
    for (const n of [5, 9]) {
      const k = knotOf(n), aq = Math.abs(k.q);
      expect([Math.min(k.p, aq), Math.max(k.p, aq)]).toEqual([3, 4]);
      expect(Math.min(k.p * (aq - 1), aq * (k.p - 1))).toBe(8);
    }
    // the Scar and the Return: seventy-eight crossings, far beyond the tables
    for (const n of [14, 27]) {
      const k = knotOf(n), aq = Math.abs(k.q);
      expect(Math.min(k.p * (aq - 1), aq * (k.p - 1))).toBe(78);
    }
    // the Void: seven rings, each pair linked exactly once (pq/g^2)
    const kv = knotOf(17);
    expect((kv.p * Math.abs(kv.q)) / (7 * 7)).toBe(1);
  });

  test('the second page: the tone is the ground exactly at the Resonance', () => {
    // the card whose essence says the fifth simply rings sounds the deck's
    // own reference: its core mode (3, ring 1) IS the unit of the tuning
    const v = voiceOf(spectrumOf(4, 'B'));
    expect(v.struck).toBe(true);
    const top = v.partials.reduce((a: any, b: any) => (b.gain > a.gain ? b : a));
    expect(top.freq).toBeCloseTo(GROUND_HZ, 6);
    // and the Seed alone is silent
    expect(voiceOf(spectrumOf(1, 'B')).struck).toBe(false);
    for (let n = 2; n <= 27; n++) expect(voiceOf(spectrumOf(n, 'B')).struck).toBe(true);
  });

  test('the second page: the shells from home are 1, 7, 7, 12', () => {
    const adj: number[][] = Array.from({ length: 28 }, () => []);
    for (let n = 1; n <= 27; n++) {
      const c = counterOf(n); if (c !== n) { adj[n].push(c); adj[c].push(n); }
      const b = becomingOf(n); if (b !== null) { adj[n].push(b); adj[b].push(n); }
    }
    const d = new Array(28).fill(-1); d[1] = 0; const q = [1];
    while (q.length) { const x = q.shift()!; for (const y of adj[x]) if (d[y] < 0) { d[y] = d[x] + 1; q.push(y); } }
    const shells: Record<number, number> = {};
    for (let n = 1; n <= 27; n++) shells[d[n]] = (shells[d[n]] || 0) + 1;
    expect(shells).toEqual({ 0: 1, 1: 7, 2: 7, 3: 12 });
  });

  test('the second page imports its qualities, never re-derives them', () => {
    expect(SRC).toContain("from '/app/luminara-cymatics.js'");
    expect(SRC).toContain("from '/app/luminara-sound.js'");
    for (const fn of ['spectrumOf', 'voiceOf']) {
      expect(SRC.includes(fn), 'the sheet must import: ' + fn).toBe(true);
    }
    // no second Bessel expansion, no second spectrum
    expect(SRC.includes('besselZero')).toBe(false);
    expect(SRC.includes('cymaticSpectrum(')).toBe(false);
  });

  test('six cards are links, in three counter-dyads', () => {
    const links: number[] = [];
    for (let n = 1; n <= 27; n++) if (knotOf(n).components > 1) links.push(n);
    expect(links.length).toBe(6);
    for (const n of links) expect(links).toContain(counterOf(n));
    // and the Silences are not the links: different qualities entirely
    expect(links.some((n) => isSilent(n))).toBe(true);   // Labyrinth, Mask, Witness are
    expect(links.includes(4)).toBe(false);               // the Resonance is not
  });
});
