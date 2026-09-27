// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE CANON'S FINGERPRINT — one deliberate golden, in one file, that a human
// edits knowingly.
//
// The suite used to scatter the canon's most load-bearing facts across six
// hand-written literals in five files: the silence count as a numeral, the
// seat list as an array, an all-silent cast written out by hand. Each was a
// badly-aimed attempt to do what this file does properly, and together they
// had two failure modes. They went red in six unrelated places when the canon
// moved on purpose, and worse, several of them went QUIETLY GREEN when it
// moved in ways they did not happen to look at.
//
// So: everything else in the suite asserts LAWS that hold for any canon. This
// one file asserts THIS canon, and when it fails the message says so plainly.
// A red here is not a bug. It is the canon having moved, and the only correct
// response is to look at the diff, satisfy yourself it was intended, and
// update the fingerprint in the same commit as the change.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CARDS, SILENCES, SILENCE_SEATS } from '../../spatial/app/luminara-canon.js';

const FILE = path.join(__dirname, 'canon.fingerprint.json');

const fingerprint = () => ({
  cards: CARDS.map((c: any) => ({ n: c.n, name: c.name, letter: c.letter })),
  silences: Object.fromEntries(
    SILENCE_SEATS.map((n: number) => [n, { name: SILENCES[n].name, asks: SILENCES[n].asks }]),
  ),
});

describe('THE CANON FINGERPRINT — one place a deliberate change goes red', () => {
  test('the twenty-seven, their letters, and the Silences stand where they stood', () => {
    const now = fingerprint();
    const golden = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    expect(now, 'THE CANON MOVED. If that was intended — a letter reseated, a '
      + 'Silence added or removed — update core/tests/canon.fingerprint.json in '
      + 'the same commit, on purpose. If it was not intended, this is the alarm.')
      .toEqual(golden);
  });

  test('the fingerprint covers every card, so nothing can move unwatched', () => {
    expect(fingerprint().cards.length).toBe(CARDS.length);
  });
});
