// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE RING'S PINS — the deck-walking room held to its own laws by source
// scan, the way the sealed rooms are held elsewhere. The Ring composes and
// never casts: it may import no draw machinery and carry no cast state. The
// letters stay sealed until the keeper's word: no letter is read anywhere in
// the room. Sound obeys EMPTINESS: the context is lazy (createSounder) and
// no AudioContext is built at load. The relations walked are the canon's own
// (counterOf, becomingOf), never re-derived in the page. And the room stands
// in every nav, because a named room gets a door.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const APP = (f: string) => path.join(ROOT, 'spatial', 'app', f);
const SRC = fs.readFileSync(APP('luminara-ring.html'), 'utf-8');

describe('THE RING — composed, never cast', () => {
  test('the room exists and names itself', () => {
    expect(SRC.startsWith('<!doctype html>')).toBe(true);
    expect(SRC).toContain('THE RING');
    expect(SRC).toContain('COMPOSED, NEVER CAST');
    expect(SRC).toContain('NOTHING HERE IS A READING');
  });

  test('no draw machinery enters the room', () => {
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'descend(', 'castSeed', 'composeReading', 'readingOf']) {
      expect(SRC.includes(forbidden), 'the ring must not touch: ' + forbidden).toBe(false);
    }
  });

  test('the letters stay sealed: no letter is read', () => {
    expect(SRC.includes('.letter'), 'no letter access until the keeper').toBe(false);
  });

  test('sound is lazy and invited, never ambient', () => {
    expect(SRC).toContain('createSounder');
    expect(SRC.includes('new AudioContext'), 'no eager context').toBe(false);
    // the law used to be pinned on a SOUND toggle. The room's own redesign
    // dropped the toggle and holds the law by construction instead: the
    // sounder is built inside the touch path, so no voice can exist before a
    // hand asks for one, and the page opens showing rather than sounding.
    expect(SRC).toContain('if (!sounder) sounder = createSounder()');
    expect(SRC.includes('say(1)'), 'nothing sounds at load').toBe(false);
  });

  test('the walk moves by the canon, not by re-derivation', () => {
    expect(SRC).toContain('counterOf(');
    expect(SRC).toContain('becomingOf(');
    expect(SRC).toContain("from '/app/luminara-canon.js'");
    // the walk is by the count alone: left and right along the signed number
    // line. The answer and the becoming are READ at the card's hand, not
    // driven by keys, so no up/down is pinned here.
    for (const key of ['ArrowRight', 'ArrowLeft']) {
      expect(SRC).toContain(key);
    }
  });

  test('the room imports only the portal, never the organism', () => {
    for (const foreign of ['aura-core', 'focus.js', 'localStorage']) {
      expect(SRC.includes(foreign), 'foreign import: ' + foreign).toBe(false);
    }
  });

  test('every room carries the ring door', () => {
    const pages = ['luminara-read.html', 'luminara-resonance.html', 'luminara-map-room.html',
      'luminara-astrolabe.html', 'luminara-spectrum.html', 'luminara-ring.html'];
    for (const p of pages) {
      const src = fs.readFileSync(APP(p), 'utf-8');
      expect(src.includes('luminara-ring.html'), p + ' must link the ring').toBe(true);
    }
  });
});
