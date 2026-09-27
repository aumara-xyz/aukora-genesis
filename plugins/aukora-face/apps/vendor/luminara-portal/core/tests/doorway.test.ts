// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE DOORWAY'S PINS — the law before the convenience: there is no draw
// tool through the MCP doorway and there never will be. The four tools are
// readings of what already stands, the replay agrees exactly with the
// bench's own reconstruction, and the module holds no entropy, no storage
// and no network by construction. The pins read the source as well as the
// behaviour, because a doorway is judged by what it cannot do.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { toolsList, toolCall } from '../../doorway/doorway.mjs';
import { skyCellOf } from '../../spatial/app/luminara-sky.js';
import { drawOne } from '../../spatial/app/luminara-canon.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const DOORWAY = fs.readFileSync(path.join(ROOT, 'doorway', 'doorway.mjs'), 'utf-8');
const SERVER = fs.readFileSync(path.join(ROOT, 'doorway', 'server.mjs'), 'utf-8');
const WITNESSED = 'bench3|71774000.1784689426335';

const textOf = (r: any) => r.content[0].text as string;

describe('THE LAW — no cast through the doorway, by construction', () => {
  test('four tools, none of them a draw', () => {
    const names = toolsList().map((t: any) => t.name);
    expect(names).toEqual(['deck', 'card', 'sky_at', 'replay_declared_seed']);
    for (const n of names) expect(/^(cast|draw|rite)/.test(n)).toBe(false);
  });

  test('the module holds no entropy, no storage, no network, no files', () => {
    for (const src of [DOORWAY, SERVER]) {
      expect(src.includes('Math.random')).toBe(false);
      expect(src.includes('localStorage')).toBe(false);
      expect(/fetch\(|XMLHttpRequest|WebSocket/.test(src)).toBe(false);
      expect(/from ['"]fs['"]|require\(['"]fs/.test(src)).toBe(false);
    }
    // the skin never touches the canon directly: one module, one law
    expect(SERVER.includes('drawOne')).toBe(false);
  });

  test('an undeclared seed is refused, and says why', () => {
    const r = toolCall('replay_declared_seed', { seed: 'anything-i-made-up' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('The doorway does not cast');
  });

  test('the registers are spoken in the replies themselves', () => {
    expect(textOf(toolCall('deck'))).toContain('derived, never authored');
    expect(textOf(toolCall('sky_at', { iso: '2026-07-22T12:00:00Z' })))
      .toContain('no hour is auspicious and none is forbidden');
    expect(textOf(toolCall('replay_declared_seed', { seed: WITNESSED })))
      .toContain('a replay, not a rite');
  });
});

describe('THE READINGS — everything said is the canon’s own', () => {
  test('the deck lists all twenty-seven, once each', () => {
    const t = textOf(toolCall('deck'));
    expect(t).toContain('The Seed');
    expect(t).toContain('The Spectrum');
    expect(t.split('\n').filter((l) => / · /.test(l)).length).toBe(28); // 27 + register
  });

  test('a card answers by number and by name alike', () => {
    const byN = textOf(toolCall('card', { n: 3 }));
    const byName = textOf(toolCall('card', { name: 'the fold' }));
    expect(byN).toBe(byName);
    expect(byN).toContain('The Fold');
    expect(byN).toContain('becoming: The Seed');   // the shortest cadence in the deck
    expect(textOf(toolCall('card', { n: 99 }))).toContain('no such card');
  });

  test('the sky agrees with the pinned ephemeris exactly', () => {
    const iso = '2026-07-21T09:00:00Z';
    const t = textOf(toolCall('sky_at', { iso }));
    const cell = skyCellOf(new Date(iso));
    expect(t).toContain('sky cell ' + cell.n);
    expect(textOf(toolCall('sky_at', { iso: 'not a time' }))).toContain('unreadable time');
  });

  test('the replay reconstructs the bench’s own cast, then reads its depths', () => {
    const t = textOf(toolCall('replay_declared_seed', { seed: WITNESSED }));
    // the same three the bench replays from this seed
    const p = WITNESSED.split('|');
    const seeds = [p.slice(0, p.length - 2).join('|'), p.slice(0, p.length - 1).join('|'), WITNESSED];
    const drawn: number[] = [];
    seeds.forEach((sd) => { drawn.push(drawOne(sd, drawn)); });
    expect(drawn.length).toBe(3);
    // the first witnessed cast's field, as the engine pinned it
    expect(t).toContain('THE NINE · THE WEAVE');
    expect(t).toContain('THE WHOLE FIELD · HOW IT FELL');
    expect(t).toContain('One card stands at home');
    expect(t).toContain('after 90 rounds');
    expect(t).toContain('The Surgeon stands at home.');
  });
});
