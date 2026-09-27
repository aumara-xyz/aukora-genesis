// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE SEA'S PINS — the sailable atlas held to its own laws by source. The
// sea is a workshop instrument (unlinked from the nav until the architect
// graduates it): the stars are canon, the sailing is exploration, and the
// open water is never a card. These pins hold the page to the Atlas's law
// and to the room's standing disciplines.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-sea.html'), 'utf8');

describe('THE SEA — the stars canon, the sailing exploration', () => {
  test('the room exists and carries the law', () => {
    expect(SRC).toContain('THE SEA');
    expect(SRC).toContain('THE STARS ARE CANON');
    expect(SRC).toContain('THE OPEN WATER IS NEVER A CARD');
    expect(SRC).toContain('A READING MAY NOW BE STRUCK HERE');
  });

  test('no casting machinery enters the sea', () => {
    // drawThree/drawWide/composeReading all mean a NEW cast, fresh entropy,
    // an authored reading: forbidden absolutely. drawOne and
    // unfoldedReadingOf are allowed by name only in the exact shape the
    // next test pins: pure replay and pure derivation from an
    // already-committed seed, never a source of new chance and never a
    // card+cell meaning (fieldReadingOf speaks only in cycles, parity,
    // order — the 729 stay parked, as ruled elsewhere).
    for (const forbidden of ['drawThree', 'drawWide', 'descend(', 'composeReading']) {
      expect(SRC.includes(forbidden), 'the sea must not touch: ' + forbidden).toBe(false);
    }
  });

  test('a hand is the only chance: pasted, or struck, never Math.random', () => {
    // drawOne and unfoldedReadingOf exist here for exactly one purpose:
    // reconstructing what a DECLARED seed means, at both depths, the same
    // deterministic algorithms the Wayfinder itself uses. Neither may be
    // fed by a programmatic entropy source.
    expect(SRC).toContain('function replaySeaCast(s)');
    // matched on the call form, not the bare name, so the page's own prose
    // may still name what it deliberately does not use
    for (const entropy of ['Math.random(', 'crypto.getRandomValues(', 'drand(']) {
      expect(SRC.includes(entropy), 'a fresh entropy source has no place here: ' + entropy).toBe(false);
    }
    // nothing casts on load: castCards and castField start empty and are
    // set only inside the replay function, itself only reachable by a hand
    expect(SRC).toContain('let castCards = null;');
    expect(SRC).toContain('let castField = null;');
    expect(SRC).toContain("$('castReplay').addEventListener");
    // CAST strikes a fresh seed by the same construction the Wayfinder's
    // own live rite uses: the instant of the touch, never a programmatic
    // roll — proof this borrows a standing practice rather than inventing
    // a second source of chance
    expect(SRC).toContain('function castFresh()');
    expect(SRC).toContain("$('castNow').addEventListener");
    expect(SRC).toContain('performance.now()');
    expect(SRC).toContain('Date.now()');
    // struck or pasted, the seed is shown, never hidden, so it can be kept
    expect(SRC).toContain("$('castSeedIn').value = s;");
    // the law is stated on the page itself, not only enforced in silence
    expect(SRC).toContain('the exact instant of the touch its only chance');
  });

  test('the overlays are lean: sky, cast and field each their own switch, off by default', () => {
    // the count, dyads and becomings are the toroid's own standing law and
    // never sit behind a switch; only the three visitor layers do
    expect(SRC).toContain('const layers = { sky: false, cast: false, field: false };');
    expect(SRC).toContain('if (layers.sky)');
    expect(SRC).toContain('castCards && layers.cast');
    expect(SRC).toContain('if (!layers.field) continue;');
    expect(SRC).toContain('id="layerSky"');
    expect(SRC).toContain('id="layerCast"');
    expect(SRC).toContain('id="layerField"');
  });

  test('the complete twenty-seven speaks only in derived structure, never card+cell meaning', () => {
    // the field reading may only ever be built from the module ruled to
    // hold that law (luminara-field.js); the sea must not reimplement or
    // shortcut its own cycle-finding, and must not import the 9's own
    // weave (nineWeaveOf/weaveLines), which is a different depth entirely
    expect(SRC).toContain("from '/app/luminara-field.js'");
    expect(SRC).toContain('fieldReadingOf');
    for (const foreign of ['nineWeaveOf', 'weaveLines']) {
      expect(SRC.includes(foreign), 'a different depth than the sea shows: ' + foreign).toBe(false);
    }
  });

  test('the letters stay sealed', () => {
    expect(SRC.includes('.letter')).toBe(false);
  });

  test('sound is lazy and invited, never ambient', () => {
    expect(SRC).toContain('createSounder');
    expect(SRC.includes('new AudioContext')).toBe(false);
    expect(SRC).toContain('if (!sounder) sounder = createSounder()');
  });

  test('the sea imports only the portal, never the organism', () => {
    for (const foreign of ['aura-core', 'focus.js', 'localStorage']) {
      expect(SRC.includes(foreign), 'foreign import: ' + foreign).toBe(false);
    }
    expect(SRC).toContain("from '/app/luminara-canon.js'");
  });

  test('the open water is drawn honestly: the strand may hang open', () => {
    // the viewport must know the difference between a star and the sea:
    // the open strand shows its ends, and the say-line says which is which
    expect(SRC).toContain('the strand does not close');
    expect(SRC).toContain('the strand closes');
  });

  test('both radii stand, named for what they are', () => {
    // the dress and the skeleton: phi the chosen, root two the found
    expect(SRC).toContain('Math.SQRT2');
    expect(SRC).toContain('DRESS');
    expect(SRC).toContain('SKELETON');
  });

  test('a workshop instrument: unlinked from the nav until the architect graduates it', () => {
    // graduation is a canon act at the architect's word; this pin changes then
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const page = fs.readFileSync(path.join(ROOT, 'spatial/app/' + room + '.html'), 'utf8');
      expect(page.includes('luminara-sea'), room + ' must not link the sea yet').toBe(false);
    }
  });
});
