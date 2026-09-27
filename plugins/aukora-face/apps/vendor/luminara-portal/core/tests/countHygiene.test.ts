// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// COUNT HYGIENE — the lint that sees prose.
//
// An audit of what a change to the silence count would touch found roughly
// fifty places. Six independent sweeps found the same handful of numerals and
// still missed hits that carry no numeral at all. The lesson is not that the
// sweeps were careless: it is that no test in this repo could see prose. A
// sentence in a guide that teaches the wrong number is invisible to a suite
// that only imports functions, and it will ship.
//
// So this file does two things no other file does.
//
// THE NEGATIVE HALF forbids a hand-written silence count anywhere in the
// living corpus. If the number is worth saying, it is worth deriving: say it
// through silenceTeaching() or numberWord(SILENCE_COUNT). A literal is a
// defect even when it is currently correct, because correct-for-now is exactly
// how the last one survived long enough to become load-bearing.
//
// THE POSITIVE HALF pins the canon-carrying surfaces to the canon itself, so
// they drift LOUDLY. A document that must teach the Silences must contain the
// seats the canon actually holds and must not name a seat it does not.
//
// THE ALLOWLIST is for the historical record only. THE LETTERS LEDGER, THE
// SCORESHEET and the like exist precisely to say what was believed and when,
// so a frozen numeral there is the point rather than a defect. Anything added
// to this list needs a written reason, here, in this file.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SILENCE_SEATS, SILENCE_COUNT, isSilent, cardOf, numberWord } from '../../spatial/app/luminara-canon.js';

const ROOT = path.join(__dirname, '../..');

// Files whose job is to record what was once believed. A count frozen in these
// is testimony, not drift.
const HISTORICAL = [
  'docs/map-room/THE_LETTERS_LEDGER.md',   // the audit itself: quotes every grid's claim
  'docs/map-room/THE_SCORESHEET.md',       // preregistered predictions, frozen by design
  'docs/map-room/THE_SECOND_SHEET.md',     // the keeper's blind instrument as it travelled
  'docs/CONVERGENCE_ARCHIVE.md',           // archive of prior convergences
  'core/tests/countHygiene.test.ts',       // this file names the patterns it forbids
  'core/tests/canon.fingerprint.json',     // the deliberate golden
];

const walk = (dir: string, out: string[] = []): string[] => {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.scratch'].includes(e.name)) continue;
      walk(rel, out);
    } else if (/\.(md|html|js|mjs|ts|json)$/.test(e.name)) out.push(rel);
  }
  return out;
};

const CORPUS = ['docs', 'spatial/app', 'scripts', 'core']
  .flatMap((d) => walk(d))
  .filter((f) => !HISTORICAL.includes(f));

// A hand-written count of the Silences, in any of the shapes the audit found.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\b(one|two|three|four|five|six|seven)\s+Silences\b/i, 'a silence count written as a word'],
  [/\bTHE\s+(THREE|FOUR|FIVE)\s+SILENCES\b/, 'a silence count in a heading'],
  [/\b[1-9]\s+Silences\b/, 'a silence count written as a digit'],
  [/\bseated at (one|two|three|four|five)\b/i, 'a seat count written out'],
  [/\b4,\s*16,\s*22,\s*25\b/, 'the silence seats enumerated as a literal list'],
  [/\b010,\s*120,\s*210,\s*220\b/, 'the silence codes enumerated as a literal list'],
];

// THE BASELINE. This lint arrives to a corpus that already carries the debt it
// forbids: thirty-one places, found the day it was written. Burning them down
// touches generators, pressed artifacts and page copy across the repo, which is
// its own change and does not belong in the same commit as the guard.
//
// So the guard lands first and holds the line: the set may SHRINK freely and
// may never GROW. New drift fails immediately; old drift is visible, counted,
// and scheduled. The baseline must reach zero before the silence count is
// ratified, because every entry in it is a sentence that would then be false.
//
// One entry is a true false-positive and is kept in the baseline rather than
// excused by loosening the pattern: luminara-canon.js:609 reads "Three
// Silences" in the all-silent reading, which counts the three cards of a cast
// rather than the map. Loosening the regex to admit it would blind the lint to
// real drift phrased the same way.
const BASELINE: string[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'count-hygiene.baseline.json'), 'utf8'),
);

const scan = () => {
  const found: string[] = [];
  for (const f of CORPUS) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [re, why] of FORBIDDEN) if (re.test(text)) found.push(`${f}|${why}`);
  }
  return found.sort();
};

describe('COUNT HYGIENE — the count is derived, never written', () => {
  test('no NEW file writes the silence count by hand', () => {
    const fresh = scan().filter((k) => !BASELINE.includes(k));
    expect(fresh, 'A hand-written silence count has entered the corpus. Derive it '
      + 'instead: silenceTeaching(), or numberWord(SILENCE_COUNT). If the file is a '
      + 'historical record, add it to HISTORICAL with a reason.\n'
      + fresh.join('\n')).toEqual([]);
  });

  test('the baseline only shrinks: fixed debt is struck from it', () => {
    const stale = BASELINE.filter((k) => !scan().includes(k));
    expect(stale, 'These baseline entries no longer occur, which means the debt was '
      + 'paid. Remove them from count-hygiene.baseline.json so the line holds tighter.\n'
      + stale.join('\n')).toEqual([]);
  });

  test('the remaining debt is visible and counted', () => {
    // not an assertion about the number, an assertion that it is known
    expect(BASELINE.length).toBe(scan().length);
  });

  test('the canon composes its own teaching, and it is true of the map', () => {
    // the derived sentence must name every seat the canon holds
    for (const n of SILENCE_SEATS) {
      expect(isSilent(n), 'seat ' + n + ' must be silent').toBe(true);
      expect(cardOf(n), 'seat ' + n + ' must be a real card').toBeTruthy();
    }
    expect(numberWord(SILENCE_COUNT)).not.toBe(String(SILENCE_COUNT));
  });

  test('no card is silent that the map does not hold, and none is missed', () => {
    // the negative half, stated once as a law: isSilent and SILENCE_SEATS are
    // the same fact, so a surface can never disagree with the map by accident
    for (let n = 1; n <= 27; n++) {
      expect(isSilent(n), 'seat ' + n).toBe(SILENCE_SEATS.includes(n));
    }
  });
});
