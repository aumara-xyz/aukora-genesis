// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE DOORWAY — the portal made legible to an AI coder, and nothing more.
// Four tools, all of them readings of what already stands: the deck, a
// card, the sky, and the replay of a declared seed. There is no draw tool
// through this doorway and there never will be: a cast belongs to the hand
// at the bench, with its rite, its witness and its journal, and none of
// those exist here. A replay is not a rite: it reconstructs a committed
// cast from its own declared seed, exactly as the bench's replay does,
// and it stamps nothing, keeps nothing, and sends nothing.
//
// Pure module: canon in, text out. No DOM, no storage, no network, no
// entropy. The server (server.mjs) is only this module's stdio skin.

import {
  CARDS, cardOf, codeOf, codeMarks, isSilent, SILENCES, counterOf,
  becomingOf, changingLayers, knotOf, standingCellOf, drawOne,
  POSITIONS, TIME_WORDS, DEPTH_WORDS,
} from '../spatial/app/luminara-canon.js';
import { metalOf } from '../spatial/app/luminara-knots.js';
import { unfoldedReadingOf, wideReadingOf } from '../spatial/app/luminara-81.js';
import {
  fieldReadingOf, fieldHeadline, cycleLine, nineWeaveOf, weaveLines,
} from '../spatial/app/luminara-field.js';
import {
  skyOf, elongationOf, litFraction, nodeDistance, skyCellOf, DRAGON_WINDOW_DEG,
} from '../spatial/app/luminara-sky.js';

export const SERVER_INFO = { name: 'luminara-doorway', version: '1.0.0' };

const REGISTER = 'derived, never authored · weather, never verdict';
const REPLAY_REGISTER = 'a replay, not a rite: no witness, no journal, no cast through this doorway';

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const refuse = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function cardLine(n) {
  const c = cardOf(n);
  const k = knotOf(n);
  return String(n).padStart(2) + ' · ' + codeMarks(n) + ' · ' + c.name
    + ' (' + c.letter + ')'
    + (isSilent(n) ? ' · silence' : '')
    + ' · counter ' + cardOf(counterOf(n)).name
    + (becomingOf(n) !== null ? ' · becoming ' + cardOf(becomingOf(n)).name : '')
    + ' · knot q=' + k.q + ' · ' + metalOf(n);
}

function cardText(n) {
  const c = cardOf(n);
  const lines = [
    c.name + ' (' + c.letter + ') · card ' + n + ' · ' + codeMarks(n)
      + ' · code [' + codeOf(n).join(',') + ']',
    c.essence,
    'counter: ' + cardOf(counterOf(n)).name,
  ];
  if (becomingOf(n) !== null) lines.push('becoming: ' + cardOf(becomingOf(n)).name);
  const layers = changingLayers(n);
  if (layers.length) lines.push('turning in: ' + layers.join(', '));
  if (isSilent(n)) lines.push('a Silence · asks for ' + SILENCES[n].asks);
  const k = knotOf(n);
  lines.push('knot: (' + k.p + ',' + k.q + ') · metal ' + metalOf(n));
  lines.push(REGISTER);
  return lines.join('\n');
}

function skyText(date) {
  const sky = skyOf(date);
  const elong = elongationOf(sky);
  const cell = skyCellOf(date);
  const civil = standingCellOf(date);
  return [
    'the sky at ' + date.toISOString().slice(0, 16).replace('T', ' ') + 'Z',
    'sun ' + sky.sun.toFixed(1) + '° · moon ' + sky.moon.toFixed(1)
      + '° · node ' + sky.node.toFixed(1) + '°',
    'elongation ' + elong.toFixed(1) + '° · the moon '
      + Math.round(litFraction(elong) * 100) + '% lit',
    'the dragon’s window ' + (nodeDistance(sky) <= DRAGON_WINDOW_DEG ? 'open' : 'closed'),
    'sky cell ' + cell.n + ' · ' + cardOf(cell.n).name,
    'civil standing cell ' + (civil.index + 1) + ' · ' + cardOf(civil.index + 1).name,
    REGISTER + ' · no hour is auspicious and none is forbidden',
  ].join('\n');
}

function replayText(seed) {
  // the bench's own reconstruction, verbatim: the declared seed carries
  // its three draws inside itself, and the derivation is deterministic
  const p = seed.split('|');
  const seeds = p.length >= 4
    ? [p.slice(0, p.length - 2).join('|'), p.slice(0, p.length - 1).join('|'), seed]
    : [seed + '|1', seed + '|2', seed + '|3'];
  const drawn = [];
  seeds.forEach((sd) => { drawn.push(drawOne(sd, drawn)); });

  const lines = ['seed · ' + seed + ' · replayed'];
  drawn.forEach((n, i) => {
    lines.push(TIME_WORDS[POSITIONS[i].key] + ': ' + cardOf(n).name + ' · ' + codeMarks(n)
      + (isSilent(n) ? ' · silence' : ''));
  });

  const wide = wideReadingOf(seed, drawn);
  lines.push('', 'THE NINE · THE WEAVE');
  for (const l of weaveLines(nineWeaveOf(drawn, wide.cells))) lines.push(l);

  const unfolded = unfoldedReadingOf(seed);
  const f = fieldReadingOf(unfolded.cells);
  lines.push('', 'THE WHOLE FIELD · HOW IT FELL', fieldHeadline(f));
  for (const cyc of f.cycles) if (cyc.length !== 1 || f.fixed.includes(cyc[0])) lines.push(cycleLine(cyc));

  lines.push('', REPLAY_REGISTER);
  return lines.join('\n');
}

export function toolsList() {
  return [
    {
      name: 'deck',
      description: 'The twenty-seven, listed: number, marks, name, letter, counter, becoming, knot and metal. The whole surface of the canon at a glance.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'card',
      description: 'One card, whole: essence, code, counter, becoming, silence and knot. Ask by number (1-27) or by name.',
      inputSchema: {
        type: 'object',
        properties: {
          n: { type: 'number', description: 'the card number, 1 to 27' },
          name: { type: 'string', description: 'the card name, e.g. "The Fold"' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'sky_at',
      description: 'The sky read at a moment (ISO time, default now): sun, moon, node, elongation, the dragon’s window, and where the hour stands on the deck. Weather, never verdict.',
      inputSchema: {
        type: 'object',
        properties: { iso: { type: 'string', description: 'ISO 8601 time; omitted means now' } },
        additionalProperties: false,
      },
    },
    {
      name: 'replay_declared_seed',
      description: 'Replay a committed cast from its declared seed: the three, the nine-weave, the whole field. A replay, not a rite: nothing is cast, witnessed or kept through this doorway.',
      inputSchema: {
        type: 'object',
        properties: { seed: { type: 'string', description: 'a declared seed, bench3|…' } },
        required: ['seed'],
        additionalProperties: false,
      },
    },
  ];
}

export function toolCall(name, args = {}) {
  if (name === 'deck') {
    return text(CARDS.map((c) => cardLine(c.n)).join('\n') + '\n' + REGISTER);
  }
  if (name === 'card') {
    let n = args.n;
    if (n == null && args.name) {
      const hit = CARDS.find((c) => c.name.toLowerCase() === String(args.name).toLowerCase());
      n = hit ? hit.n : null;
    }
    if (!Number.isInteger(n) || n < 1 || n > 27) {
      return refuse('no such card: give n between 1 and 27, or an exact name');
    }
    return text(cardText(n));
  }
  if (name === 'sky_at') {
    const date = args.iso ? new Date(args.iso) : new Date();
    if (Number.isNaN(date.getTime())) return refuse('unreadable time: give ISO 8601, e.g. 2026-07-22T12:00:00Z');
    return text(skyText(date));
  }
  if (name === 'replay_declared_seed') {
    const seed = String(args.seed || '');
    if (!/^bench3\|/.test(seed)) {
      return refuse('only a declared seed replays: it begins bench3| and comes from a committed cast at the bench. The doorway does not cast.');
    }
    return text(replayText(seed));
  }
  return refuse('no such tool through this doorway');
}
