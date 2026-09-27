// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PORTABLE CAST'S PINS — the travelling copy held to the canon it claims
// to carry. This file leaves the repository and is read by models with no
// access to the source, so drift here is invisible at the point of use and
// therefore worse than drift anywhere else. Every card, relation and the
// golden vector are re-derived from the canon and compared against what the
// pressed document actually says.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cardOf, codeOf, knotOf, counterOf, becomingOf, isSilent, SILENCES, drawThree,
  SILENCE_SEATS, SILENCE_COUNT,
} from '../../spatial/app/luminara-canon.js';

const ROOT = path.join(__dirname, '../..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/LUMINARA_PORTABLE_CAST.md'), 'utf8');

describe('THE PORTABLE CAST — the laws travel with it', () => {
  test('the three refusals are present and binding, not decorative', () => {
    expect(DOC).toContain('NO OPERATION');
    expect(DOC).toContain('NO PREDICTION');
    expect(DOC).toContain('NO AUTHORITY');
    expect(DOC).toContain('conditions of use, not');
  });

  test('the machine is forbidden from supplying its own chance', () => {
    expect(DOC).toContain('UNSTEERABLE');
    expect(DOC).toContain('human or machine');
    expect(DOC).toMatch(/never invent, choose, or improvise a seed/);
    expect(DOC).toContain('The querent supplies');
    // and no re-rolls
    expect(DOC).toContain('COMMITTED');
    expect(DOC).toContain('No re-rolls');
  });

  test('a model without code execution is told to decline, not to approximate', () => {
    expect(DOC).toMatch(/If you cannot execute code, do not cast/);
    expect(DOC).toContain('fabrication');
  });

  test('the beacon is specified, with an honest offline fallback', () => {
    expect(DOC).toContain('api.drand.sh/public/latest');
    expect(DOC).toContain('unwitnessed');
  });
});

describe('THE PORTABLE CAST — the data cannot drift from the canon', () => {
  test('the golden vector in the document is the canon’s own', () => {
    // the document prints: drawThree("...")  must return exactly  [a, b, c]
    const m = DOC.match(/drawThree\((".*?")\)\s+must return exactly\s+\[([\d, ]+)\]/);
    expect(m, 'the golden vector line must be present and parseable').toBeTruthy();
    const seed = JSON.parse(m![1]);
    const printed = m![2].split(',').map((s) => Number(s.trim()));
    expect(printed).toEqual(drawThree(seed));
    expect(printed).toHaveLength(3);
  });

  test('all twenty-seven rows match the canon exactly', () => {
    for (let n = 1; n <= 27; n++) {
      const card = cardOf(n), k = knotOf(n);
      const row = DOC.split('\n').find((l) => l.startsWith('| ' + n + ' | `'));
      expect(row, 'row missing for card ' + n).toBeTruthy();
      expect(row).toContain('`' + codeOf(n).join('') + '`');
      expect(row).toContain('**' + card.name + '**');
      expect(row).toContain('T(' + k.p + ',' + k.q + ')');
      expect(row, 'counter wrong for ' + n).toContain('| ' + counterOf(n) + ' |');
      // the essence travels verbatim
      expect(row).toContain(card.essence);
    }
  });

  test('every Silence travels with its own lines, unsoftened', () => {
    for (const [n, s] of Object.entries(SILENCES)) {
      expect(DOC).toContain(cardOf(+n).name);
      expect(DOC).toContain(s.asks);
      for (const line of s.lines) expect(DOC, 'missing silence line: ' + line).toContain(line);
    }
    expect(DOC).toContain('stops interpretation');
    // The count is derived from the map, never written as a numeral. The line
    // that used to stand here said exactly that and then wrote 4, which is the
    // failure countHygiene.test.ts now polices. The law: every seat the map
    // holds travels, and no seat it does not hold is marked silent.
    expect(SILENCE_COUNT).toBeGreaterThan(0);
    expect(SILENCE_SEATS.length).toBe(Object.keys(SILENCES).length);
  });

  test('the silence column marks every silent seat and no other', () => {
    // the negative half: the old suite only ever checked `if (isSilent(n))`,
    // so a seat that stopped being silent would keep its **yes** unchallenged.
    for (let n = 1; n <= 27; n++) {
      const row = DOC.split('\n').find((l) => l.startsWith('| ' + n + ' | `'))!;
      expect(row.includes('**yes**'), 'seat ' + n + ' silence mark').toBe(isSilent(n));
    }
  });

  test('the becoming column is right, including the settled dashes', () => {
    for (let n = 1; n <= 27; n++) {
      const b = becomingOf(n);
      const row = DOC.split('\n').find((l) => l.startsWith('| ' + n + ' | `'))!;
      if (b === null) expect(row, 'card ' + n + ' is settled').toContain('&mdash;');
      else expect(row).toContain('| ' + b + ' |');
      if (isSilent(n)) expect(row).toContain('**yes**');
    }
  });
});

describe('THE PORTABLE CAST — what it must not carry', () => {
  test('the letters stay sealed: the grid is open at the keeper’s gate', () => {
    expect(DOC).toContain('letters are not here');
    // no seated letter may appear in any row
    for (let n = 1; n <= 27; n++) {
      const row = DOC.split('\n').find((l) => l.startsWith('| ' + n + ' | `'))!;
      expect(row).not.toMatch(/\|\s*[A-Z]{1,2}\s*\|/);
    }
  });

  test('it is honest about carrying only the coarse reading', () => {
    expect(DOC).toContain('coarse reading always stands');
    expect(DOC).toMatch(/nine and the\s+twenty-seven/);
  });
});
