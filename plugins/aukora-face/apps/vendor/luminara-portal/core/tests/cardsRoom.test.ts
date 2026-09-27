// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CARDS AS A ROOM — the deck stopped being a prototype on the workshop's
// back shelf on 28 July 2026 and took a place in the portal's nav, because it
// had quietly become the only source of a physical object: the press script
// drives THIS page to make the deck, so a face here is a card in a hand.
//
// The invariant that matters most is the last one. The nav is a door and a
// card is a printed thing, and the two share a document. If the door ever
// prints on a card the whole run is spoiled, so press mode's isolation is
// pinned structurally rather than trusted.

import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL('../../' + rel, import.meta.url)), 'utf8');

const CARDS_PAGE = read('spatial/app/luminara-cards.html');
const PRESS = read('scripts/pressCards.mjs');
const IGNORE = read('.gitignore');
const CHART = read('docs/map-room/THE_CARDS.md');

// every page that carries a door in the portal nav. Three pages are
// deliberately absent, each reached from somewhere that already names it:
// luminara-sea.html from the workshop; luminara-instrument-v1.html from the
// workshop's retired shelf, the settled form kept whole when the living
// branch became the one console (2026-08-02); and luminara-cards.html from
// the map room, whose CARDS chart opens it, at the architect's word
// (2026-07-26). Each still carries the nav so a hand can leave; none of
// them claims a seat.
const ROOMS = [
  'luminara-read.html', 'luminara-map-room.html', 'luminara-ring.html',
  'luminara-resonance.html', 'luminara-instrument.html',
  'luminara-harmonic-language.html', 'luminara-astrolabe.html',
  'luminara-spectrum.html', 'luminara-workshop.html',
];

describe('THE CARDS · a room, not a prototype', () => {
  test('every room names every other room, the cards among them', () => {
    for (const room of ROOMS) {
      const src = read('spatial/app/' + room);
      for (const other of ROOMS) {
        expect(src, room + ' must carry the door to ' + other).toContain('/app/' + other);
      }
      // and exactly one nav entry is marked as the room you are standing in.
      // Counted inside the nav only: a room may use .on for its own state
      // (the wayfinder does), and that is none of the door's business.
      const navBlock = src.slice(src.indexOf('<nav class="lnav">'), src.indexOf('</nav>'));
      expect(navBlock.split('class="on"').length - 1, room + ' marks one current room').toBe(1);
    }
  });

  test('the cards are reached from the map room, and claim no seat in the nav', () => {
    // the chart is the door, and the door is real
    expect(CHART).toContain('/app/luminara-cards.html');
    for (const room of ROOMS) {
      const src = read('spatial/app/' + room);
      const navBlock = src.slice(src.indexOf('<nav class="lnav">'), src.indexOf('</nav>'));
      expect(navBlock, room + ' must not seat the cards').not.toContain('luminara-cards.html');
    }
    // and the cards still carry the nav, so a hand can leave the way it came
    expect(CARDS_PAGE).toContain('<nav class="lnav">');
  });

  test('the nav is the rooms in one order', () => {
    // the reading order is the same everywhere, so the door does not move
    // under a hand that has learnt where it is
    // the matcher allows digits: a room may carry a version in its name
    const order = (src: string) =>
      [...src.matchAll(/<a href="\/app\/(luminara-[a-z0-9-]+\.html)"/g)]
        .map((m) => m[1]).filter((f) => ROOMS.includes(f)).slice(0, ROOMS.length);
    const first = order(read('spatial/app/' + ROOMS[0]));
    expect(first.length).toBe(ROOMS.length);
    for (const room of ROOMS) {
      expect(order(read('spatial/app/' + room)), room + ' keeps the rooms in order').toEqual(first);
    }
  });

  test('the workshop no longer shelves the deck as an untested sketch', () => {
    const shop = read('spatial/app/luminara-workshop.html');
    // the shelf note calls everything on it a sketch for the eye; the deck is
    // pressed for a printer, so it cannot sit under that sentence
    const shelf = shop.slice(shop.indexOf('Early Prototypes'));
    expect(shelf).not.toContain('/app/luminara-cards.html');
  });
});

describe('THE CARDS · the door must never print on a card', () => {
  test('the nav sits inside .wrap, and press mode hides .wrap wholesale', () => {
    expect(CARDS_PAGE).toContain('body.press .wrap { display:none; }');
    const wrapOpen = CARDS_PAGE.indexOf('<div class="wrap">');
    const wrapShut = CARDS_PAGE.indexOf('<div id="press"></div>');
    const nav = CARDS_PAGE.indexOf('<nav class="lnav">');
    expect(wrapOpen).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(wrapOpen);
    expect(nav).toBeLessThan(wrapShut);
  });

  test('the printed things ride inside .wrap too, never onto a sheet', () => {
    const wrapShut = CARDS_PAGE.indexOf('<div id="press"></div>');
    expect(CARDS_PAGE.indexOf('class="printed"')).toBeLessThan(wrapShut);
    expect(CARDS_PAGE.indexOf('THE PRESS NOTES')).toBeLessThan(wrapShut);
  });

  test('the press sheet itself is built only from #press', () => {
    // the sheets are written into #press, which lives outside .wrap: nothing
    // the room shows can reach the page box
    expect(CARDS_PAGE).toContain("getElementById('press').innerHTML");
  });
});

describe('THE CARDS · the printed things resolve', () => {
  test('each thing on the shelf is a real file or a real route', () => {
    for (const rel of [
      'docs/Luminara_Cards_Illustrated_Guide.pdf',
      'docs/luminara-box-face.html',
      'docs/CARD_PRESS_NOTES.md',
    ]) {
      expect(CARDS_PAGE, 'the room must link ' + rel).toContain('/' + rel);
      expect(existsSync(fileURLToPath(new URL('../../' + rel, import.meta.url))),
        rel + ' must exist to be linked').toBe(true);
    }
    // the deck is pressed rather than kept, so only its route is pinned
    expect(CARDS_PAGE).toContain('/docs/luminara-deck.pdf');
  });

  test('the press leaves a serving copy where the portal can reach it', () => {
    // the portal serves /docs and /app and nothing else: a deck in /dist is
    // pressable but not reachable from the room that pressed it
    expect(PRESS).toContain("copyFileSync(resolve(OUT, 'luminara-deck.pdf')");
    expect(PRESS).toContain("resolve(ROOT, 'docs', 'luminara-deck.pdf')");
  });

  test('that copy is still rebuilt, never committed', () => {
    // the doctrine the press notes state: any checkout rebuilds it exactly,
    // so a twelve megabyte binary has no business in the history
    expect(IGNORE).toContain('dist/');
    expect(IGNORE).toContain('docs/luminara-deck.pdf');
  });

  test('the press still drives the page rather than a copy of its markup', () => {
    // the whole reason the faces cannot drift from the deck
    expect(PRESS).toContain('/app/luminara-cards.html');
    expect(PRESS).not.toMatch(/<div class="tcard"/);
  });
});

describe('THE CARDS · the chart records the answer without tidying the question', () => {
  test('the case against is left standing', () => {
    expect(CHART).toContain('The strongest case against');
    expect(CHART).toContain('WHAT ANSWERED IT');
    expect(CHART).toContain('Not an argument. A press.');
  });

  test('the map room style law holds: the marks are drawn, never typed', () => {
    expect(CHART).not.toContain('—');
    expect(CHART).not.toContain('–');
  });
});
