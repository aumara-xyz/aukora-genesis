// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE WORKSHOP'S PINS — a directory, held to a different law than what it
// lists. Every instrument it links carries its own "unlinked until
// graduated" pin against the six reading surfaces; those pins are untouched
// by this page's existence. This page's own job is the opposite one: be
// reachable from the six, and point at everything real without a dead link.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const APP = path.join(ROOT, 'spatial/app');
const SRC = fs.readFileSync(path.join(APP, 'luminara-workshop.html'), 'utf8');

const ROOMS = ['luminara-read', 'luminara-ring', 'luminara-map-room',
  'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum'];

describe('THE WORKSHOP — a directory, not an instrument', () => {
  test('the room exists and names itself as a directory', () => {
    expect(SRC).toContain('THE WORKSHOP');
    expect(SRC).toContain('A directory, not an instrument');
  });

  test('no casting machinery: a directory runs nothing', () => {
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'composeReading', 'descend(',
      'Math.random', 'crypto.getRandomValues', 'drand', 'setFocus', 'castDeclaration']) {
      expect(SRC.includes(forbidden), 'the workshop must not touch: ' + forbidden).toBe(false);
    }
  });

  test('every linked instrument page actually exists', () => {
    const hrefs = [...SRC.matchAll(/href="\/app\/([a-z0-9-]+)\.html"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(10);
    for (const page of hrefs) {
      const p = path.join(APP, page + '.html');
      expect(fs.existsSync(p), 'linked but missing: ' + page + '.html').toBe(true);
    }
  });

  test('every map-room anchor it links resolves to a real chart', () => {
    const cat = JSON.parse(fs.readFileSync(path.join(APP, 'map-room.json'), 'utf8'));
    const slugs = new Set(cat.map((e: { slug: string }) => e.slug));
    const anchors = [...SRC.matchAll(/luminara-map-room\.html#\/([a-z0-9-]+)/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(3);
    for (const slug of anchors) {
      expect(slugs.has(slug), 'linked but not in the catalogue: ' + slug).toBe(true);
    }
  });

  test('unlike every instrument it lists, this page IS linked from the six rooms', () => {
    for (const room of ROOMS) {
      const page = fs.readFileSync(path.join(APP, room + '.html'), 'utf8');
      expect(page.includes('luminara-workshop'), room + ' must link the workshop').toBe(true);
    }
  });

  test('the instruments it lists keep their own law: still unlinked from the six', () => {
    // this page existing must not have quietly graduated anything else
    for (const room of ROOMS) {
      const page = fs.readFileSync(path.join(APP, room + '.html'), 'utf8');
      for (const instrument of ['luminara-sea', 'luminara-cube-lens', 'luminara-console',
        'luminara-letter-table', 'luminara-sheet', 'luminara-harp']) {
        expect(page.includes(instrument), room + ' must still not link ' + instrument).toBe(false);
      }
    }
  });

  test('the harp has a door here, and the claim boundary reaches the directory', () => {
    // the observatory is the one instrument on this shelf reading a
    // mathematics from outside the work, so the copy that advertises it is
    // bound by docs/zeta-harp/CLAIM_BOUNDARY.md exactly as the surface is:
    // a directory may not say what the instrument itself refuses to say
    expect(SRC).toContain('/app/luminara-harp.html');
    expect(SRC).toContain('THE ZETA HARP');
    const flat = SRC.replace(/\s+/g, ' ').toLowerCase();
    for (const banned of ['proves the riemann', 'supports the riemann', 'proof of rh',
      'evidence for rh', 'evidence that all zeros', 'first visualization',
      'first sonification', 'historic', 'breakthrough']) {
      expect(flat.includes(banned), 'the workshop must not say: ' + banned).toBe(false);
    }
    // and it states the refusal positively, where a reader meets the door
    expect(flat).toContain('not evidence for the hypothesis');
  });

  test('the letters stay sealed', () => {
    expect(SRC.includes('.letter')).toBe(false);
    expect(SRC.includes('SILENCES')).toBe(false);
  });
});

// THE PORTAL'S OWN TWO LAWS, asserted over every page the server will serve
// rather than over the seated rooms alone. This scope is the lesson of a real
// failure: aeccca4 closed the instrument fork by RENAMING luminara-instrument-v2
// to luminara-instrument, and the unify merge b9c9d32 resurrected the pre-rename
// snapshot, because the fork commit existed twice under different SHAs so git
// saw no shared lineage and never raised a conflict. The zombie sat in the tree
// with no nav, no inbound link, and an h1 still reading THE INSTRUMENT, served
// 200 by the static /app/ mount, while the suite stayed green. Nothing caught it
// because the nav law had only ever been asserted over the nine seated rooms.
// A law that is not a test is a wish, and a law tested over part of its subject
// is a wish about the rest.
describe('THE PORTAL — no dead ends, no orphans', () => {
  const PAGES = fs.readdirSync(APP).filter((f) => f.endsWith('.html'));

  // A page may be exempted only by being named here WITH its reason, and the
  // exemption is from the SHARED BAR, never from having a way out at all. The
  // test below holds an exempted page to the same law by a different shape.
  const NAVLESS_BY_DESIGN: Record<string, string> = {
    'luminara-harp-v2.html':
      'Third party, hosted by permission (docs/THIRD_PARTY.md). The shared bar is ' +
      '980px wide and centres on the viewport, so it cannot sit inside this ' +
      "instrument's own menu column, and luminara-nav.css forbids restyling it. " +
      "Its way out is the Leave block in its own Menu sheet, in the author's own " +
      'idiom. A borrowed instrument keeps its own chrome.',
  };

  test('every page the server serves carries a way out', () => {
    expect(PAGES.length).toBeGreaterThan(20);
    for (const page of PAGES) {
      if (page in NAVLESS_BY_DESIGN) continue;
      const src = fs.readFileSync(path.join(APP, page), 'utf8');
      expect(src.includes('<nav class="lnav">'),
        page + ' is a dead end: give it the nav, or name it in NAVLESS_BY_DESIGN with a reason')
        .toBe(true);
    }
  });

  test('an exemption buys a different shape, never a dead end', () => {
    // the ledger is not a free pass. Whatever a named page does instead of the
    // shared bar, it must still let a hand out, and the reason must be written
    // down rather than assumed.
    for (const [page, reason] of Object.entries(NAVLESS_BY_DESIGN)) {
      expect(fs.existsSync(path.join(APP, page)),
        'NAVLESS_BY_DESIGN names a page that is gone: ' + page).toBe(true);
      expect(reason.length,
        page + ' must carry a real reason, not a shrug').toBeGreaterThan(60);
      const src = fs.readFileSync(path.join(APP, page), 'utf8');
      const doors = [...src.matchAll(/href="\/app\/([a-z0-9-]+\.html)"/g)].map((m) => m[1]);
      const real = doors.filter((d) => fs.existsSync(path.join(APP, d)));
      expect(real.length,
        page + ' is exempt from the bar, not from having a way out').toBeGreaterThan(2);
      expect(real.includes('luminara-workshop.html'),
        page + ' must at least lead back to the shelf it sits on').toBe(true);
    }
  });

  test('no page is an orphan: something points at every page', () => {
    // the corpus a reader could arrive through: the surfaces and the charts
    const sources: string[] = [];
    for (const p of PAGES) sources.push(path.join(APP, p));
    const docs = path.join(ROOT, 'docs', 'map-room');
    if (fs.existsSync(docs)) {
      for (const f of fs.readdirSync(docs)) {
        if (f.endsWith('.md')) sources.push(path.join(docs, f));
      }
    }
    for (const page of PAGES) {
      const inbound = sources.filter((s) =>
        path.basename(s) !== page && fs.readFileSync(s, 'utf8').includes('/app/' + page));
      expect(inbound.length,
        page + ' is an orphan: nothing links it, so only a stale URL can reach it')
        .toBeGreaterThan(0);
    }
  });
});
