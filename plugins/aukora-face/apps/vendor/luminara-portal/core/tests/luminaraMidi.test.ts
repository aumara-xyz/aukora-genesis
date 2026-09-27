// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PAD LANE: the pins. Hardware cannot be held in a test, so the lane is
// built to be driven without it: the parsing is pure, and feed() is the same
// door the real port pours into. What is pinned here is everything that can
// be wrong while the pads still look like they work: a note left hanging, a
// pad that falls off the end of the deck, a pedal that rests the phrase when
// it should not.
import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMidi, padCard, padSeat, createMidiLane, DECK, PAD_ORDER }
  from '../../spatial/app/luminara-midi.js';
import { knotOf } from '../../spatial/app/luminara-canon.js';

describe('THE PARSING: what the wire actually says', () => {
  test('a note-on is a press, and carries how hard', () => {
    expect(parseMidi([0x90, 60, 100])).toEqual({ kind: 'press', note: 60, velocity: 100, ch: 0 });
  });

  test('A NOTE-ON AT NOUGHT IS A NOTE-OFF: the hanging-note trap', () => {
    // the commonest bug in any naive reader, and the one that would leave a
    // voice droning with no finger on it
    expect(parseMidi([0x90, 60, 0])).toEqual({ kind: 'release', note: 60, velocity: 0, ch: 0 });
  });

  test('a plain note-off is a release, on whatever channel it came in on', () => {
    expect(parseMidi([0x85, 42, 64])).toEqual({ kind: 'release', note: 42, velocity: 64, ch: 5 });
  });

  test('controls and the bend are read, the bend centred at nought', () => {
    expect(parseMidi([0xb0, 64, 127])).toEqual({ kind: 'control', cc: 64, value: 127, ch: 0 });
    expect(parseMidi([0xe0, 0, 64])).toEqual({ kind: 'bend', value: 0, ch: 0 });
  });

  test('what it does not understand it refuses, rather than guessing', () => {
    expect(parseMidi([0xf8])).toBeNull();          // the clock
    expect(parseMidi([0xf0, 1, 2])).toBeNull();    // a system exclusive
    expect(parseMidi([])).toBeNull();
    expect(parseMidi(null as never)).toBeNull();
  });
});

describe('THE PAD MAP: a grid laid on a deck of twenty-seven', () => {
  test('THE PADS CLIMB THE NUMBER LINE: each pad counts one higher', () => {
    // an instrument ascends. Pad by pad, q must go up by exactly one, from
    // the far turning to the far flowing, with no station skipped
    for (let i = 0; i < DECK; i++) {
      expect(knotOf(padCard(36 + i, 36)).q).toBe(-13 + i);
    }
  });

  test('THE SEED SITS AT THE CENTRE, not under the first pad', () => {
    // the Seed is the rest at this seat: under the lowest pad it made every
    // first tap fall silent, which reads as an instrument that is broken
    expect(padCard(36, 36)).not.toBe(1);
    expect(knotOf(padCard(36, 36)).q).toBe(-13);
    expect(PAD_ORDER.indexOf(1)).toBe(13);          // dead centre of twenty-seven
    expect(padCard(36 + 13, 36)).toBe(1);
  });

  test('the deck wraps rather than ending: no pad is ever dead', () => {
    expect(padCard(36 + 27, 36)).toBe(padCard(36, 36));
    expect(padCard(35, 36)).toBe(PAD_ORDER[DECK - 1]);   // below comes round the top
    expect(padCard(0, 36)).toBe(padCard(0 + DECK * 4, 36));
    expect(padSeat(36, 36)).toBe(0);
  });

  test('the order is the whole deck once: every card reachable, none twice', () => {
    expect(new Set(PAD_ORDER).size).toBe(DECK);
    expect([...PAD_ORDER].sort((a, b) => a - b)).toEqual(
      Array.from({ length: DECK }, (_, i) => i + 1));
  });

  test('every note lands on a real card, however wild the numbers', () => {
    for (let note = 0; note <= 127; note++) {
      for (const anchor of [0, 36, 60, 127]) {
        for (const bank of [0, 9, 18]) {
          const c = padCard(note, anchor, bank);
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(1);
          expect(c).toBeLessThanOrEqual(DECK);
        }
      }
    }
  });

  test('a bank slides the window nine stations along', () => {
    expect(knotOf(padCard(36, 36, 9)).q).toBe(-4);
    expect(knotOf(padCard(36, 36, 18)).q).toBe(5);
    expect(padCard(36, 36, 27)).toBe(padCard(36, 36));   // three banks is the way home
  });

  test('sixteen pads reach sixteen distinct cards: a grid is not a chord', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) seen.add(padCard(36 + i, 36));
    expect(seen.size).toBe(16);
  });
});

describe('THE LANE: fingers arriving from hardware', () => {
  const lane = () => {
    const presses: number[] = [], releases: number[] = [], rests: number[] = [];
    const l = createMidiLane({
      onPress: (n) => presses.push(n),
      onRelease: (n) => releases.push(n),
      onRest: () => rests.push(1),
    });
    return { l, presses, releases, rests };
  };

  const first = padCard(36, 36);   // what the lowest pad means, by the order

  test('a pad pressed and lifted is one card pressed and lifted', () => {
    const { l, presses, releases } = lane();
    l.feed([0x90, 36, 100]);
    l.feed([0x80, 36, 0]);
    expect(presses).toEqual([first]);
    expect(releases).toEqual([first]);
  });

  test('the very first tap SOUNDS: it must never land on the rest', () => {
    const { l, presses } = lane();
    l.feed([0x90, 44, 100]);        // whatever pad a hand happens to meet first
    expect(presses).toEqual([padCard(44, 44)]);
    expect(presses[0]).not.toBe(1);
  });

  test('the velocity-nought lift releases the same card it pressed', () => {
    const { l, presses, releases } = lane();
    l.feed([0x90, 40, 90]);
    l.feed([0x90, 40, 0]);
    expect(presses).toEqual(releases);
    expect(presses.length).toBe(1);
  });

  test('the lane teaches itself the floor of the grid', () => {
    const { l, presses } = lane();
    l.feed([0x90, 44, 100]);   // the first pad seen anchors the deck
    expect(l.anchor()).toBe(44);
    expect(presses).toEqual([first]);
    l.feed([0x90, 40, 100]);   // a lower pad moves the floor down
    expect(l.anchor()).toBe(40);
  });

  test('the anchor can be told rather than guessed', () => {
    const { l, presses } = lane();
    l.feed([0x90, 36, 100]);
    l.armAnchor();
    expect(l.arming()).toBe(true);
    l.feed([0x90, 50, 100]);
    expect(l.anchor()).toBe(50);
    expect(presses[presses.length - 1]).toBe(first);
    expect(l.arming()).toBe(false);
  });

  test('a chord of pads is a chord of cards, each held on its own', () => {
    const { l, presses, releases } = lane();
    l.feed([0x90, 36, 100]);
    l.feed([0x90, 38, 100]);
    l.feed([0x80, 36, 0]);
    expect(presses).toEqual([padCard(36, 36), padCard(38, 36)]);
    expect(releases).toEqual([padCard(36, 36)]);   // the other is still down
  });

  test('the sustain pedal rests the phrase, and only when it is pressed', () => {
    const { l, rests } = lane();
    l.feed([0xb0, 64, 0]);
    expect(rests.length).toBe(0);
    l.feed([0xb0, 64, 127]);
    expect(rests.length).toBe(1);
    l.feed([0xb0, 7, 127]);          // some other control rests nothing
    expect(rests.length).toBe(1);
  });

  test('the bank is kept inside the deck however it is wound', () => {
    const { l } = lane();
    expect(l.setBank(9)).toBe(9);
    expect(l.setBank(27)).toBe(0);
    expect(l.setBank(-9)).toBe(18);
  });

  test('a lane nobody connected hears nothing and costs nothing', () => {
    const { l, presses } = lane();
    expect(l.ports()).toEqual([]);
    expect(l.anchor()).toBeNull();
    expect(presses).toEqual([]);
  });
});

describe('THE LANE KEEPS THE PAGE’S PROMISE', () => {
  test('nothing is stored: the mapping dies with the visit, as the register says', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../spatial/app/luminara-midi.js'), 'utf8');
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie',
      'fetch(', 'XMLHttpRequest', 'navigator.sendBeacon']) {
      expect(src.includes(forbidden), 'the pad lane must not touch: ' + forbidden).toBe(false);
    }
  });

  test('the door is asked for, never assumed: no access without connect()', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../spatial/app/luminara-midi.js'), 'utf8');
    const asks = src.split('requestMIDIAccess').length - 1;
    // once to see whether the door exists, once to knock: both inside connect
    expect(asks).toBe(2);
    expect(src.indexOf('async function connect')).toBeLessThan(src.indexOf('await navigator.requestMIDIAccess'));
  });
});
