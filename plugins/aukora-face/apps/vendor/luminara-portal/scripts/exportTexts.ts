// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE TEXTS, TAKEN OUT WHOLE: every written thing in Luminara as plain .txt,
// for reading and editing away from any of this machinery.
//
//   bun scripts/exportTexts.ts "C:\\some\\folder"
//
// WHAT IS WRITTEN
//   map-room/     every chart in the map room, in the catalogue's own order,
//                 each headed by its catalogue line
//   docs/         every other document in the repository's docs
//   cards/        the twenty-seven, one file each, every derived quality
//                 written out beside the essence
//   THE_TWENTY_SEVEN.txt   the same twenty-seven in one file, for a read
//                          straight through
//   THE_FOUR_SILENCES.txt  the drawable silences and what each asks
//   INDEX.txt              what is here, and where each came from
//
// WHAT IS NOT TOUCHED: the markdown is carried across VERBATIM. Stripping
// the hashes and asterisks would make a prettier .txt and a worse one: the
// structure is meaning here, and a text that cannot go back where it came
// from is a copy rather than a source. Every file says at its head which
// file it came from, so an edit can be walked home by hand.
//
// Line endings are written CRLF, since these are for a Windows desktop and
// the older editors there run the lines together without them.

import * as fs from 'fs';
import * as path from 'path';
import { CARDS, SUITS, cardOf, codeOf, codeMarks, knotOf, counterOf, becomingOf,
  isSilent, SILENCES, changingLayers } from '../spatial/app/luminara-canon.js';

const ROOT = path.join(import.meta.dir, '..');
const OUT = process.argv[2];
if (!OUT) {
  console.error('give me a folder: bun scripts/exportTexts.ts "C:\\\\path\\\\to\\\\folder"');
  process.exit(1);
}

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let written = 0;
function put(rel: string, body: string) {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, crlf(body), 'utf8');
  written++;
}

const RULE = '='.repeat(70);
const head = (title: string, from: string, extra: string[] = []) =>
  [RULE, title, ...extra, 'from: ' + from, RULE, '', ''].join('\n');

// ---------------------------------------------------------------------------
// THE MAP ROOM, in the catalogue's order, each chart wearing its own line
// ---------------------------------------------------------------------------
type Entry = { slug: string; title: string; line: string; path: string; shelf?: string;
  status?: string; field?: string };
const catalogue: Entry[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'spatial/app/map-room.json'), 'utf8'));

const indexLines: string[] = [];
const seen = new Set<string>();
let order = 1;
for (const e of catalogue) {
  if (!e.path) continue;
  const src = path.join(ROOT, e.path);
  if (!fs.existsSync(src)) { console.warn('missing, skipped: ' + e.path); continue; }
  seen.add(path.resolve(src));
  const name = String(order).padStart(2, '0') + '-' + slug(e.title) + '.txt';
  put('map-room/' + name,
    head(e.title, e.path, [e.shelf ? 'shelf: ' + e.shelf : '', e.line ? '' : '', e.line || '']
      .filter(Boolean))
    + fs.readFileSync(src, 'utf8'));
  indexLines.push('  map-room/' + name + '   <- ' + e.path);
  order++;
}

// ---------------------------------------------------------------------------
// EVERY OTHER DOCUMENT: whatever the catalogue did not already carry
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (item.name.endsWith('.md')) out.push(full);
  }
  return out;
}
for (const src of walk(path.join(ROOT, 'docs')).sort()) {
  if (seen.has(path.resolve(src))) continue;   // already out, as a chart
  const rel = path.relative(ROOT, src).replace(/\\/g, '/');
  const name = slug(path.basename(src, '.md')) + '.txt';
  put('docs/' + name, head(path.basename(src, '.md').replace(/_/g, ' '), rel)
    + fs.readFileSync(src, 'utf8'));
  indexLines.push('  docs/' + name + '   <- ' + rel);
}

// ---------------------------------------------------------------------------
// THE TWENTY-SEVEN: the essence, and every quality the canon derives for it,
// written out so a card can be read whole without running anything
// ---------------------------------------------------------------------------
const HOUSE = ['AUM', 'MA', 'RA'];
function cardText(n: number): string {
  const c = cardOf(n);
  const k = knotOf(n);
  const d = codeOf(n);
  const bec = becomingOf(n);
  const turning = changingLayers(n);
  const suit = SUITS[d[0]];
  const lines = [
    RULE,
    String(n).padStart(2, '0') + '  ' + c.name.toUpperCase(),
    RULE,
    '',
    'letter        ' + c.letter,
    'house         ' + HOUSE[d[0]] + '  (' + suit.gloss + ')',
    'code          ' + d.join('') + '     field ' + d[0] + ' / between ' + d[1] + ' / core ' + d[2],
    'marks         ' + codeMarks(n),
    'count         ' + (k.q > 0 ? '+' + k.q : String(k.q)),
    'interval      ' + k.interval,
    'knot          T(' + k.p + ', ' + k.q + ')  ' + k.kind
      + (k.components > 1 ? ', ' + k.components + ' components' : '')
      + '  genus ' + k.genus + '  hand ' + k.hand,
    'counter       ' + counterOf(n) + '  ' + cardOf(counterOf(n)).name,
    'becoming      ' + (bec === null ? 'settled: it becomes nothing else'
      : bec + '  ' + cardOf(bec).name),
    'turning       ' + (turning.length ? turning.join(', ') : 'nothing turns'),
    'silence       ' + (isSilent(n) ? 'YES: it asks for ' + SILENCES[n].asks : 'no'),
    '',
    'ESSENCE',
    '',
    c.essence,
    '',
  ];
  if (isSilent(n)) {
    lines.push('AS A SILENCE', '',
      'A Silence stops interpretation in its register and redirects.',
      'It asks for: ' + SILENCES[n].asks, '');
    for (const l of SILENCES[n].lines) lines.push('  ' + l);
    lines.push('');
  }
  return lines.join('\n');
}

for (let n = 1; n <= 27; n++) {
  const name = String(n).padStart(2, '0') + '-' + slug(cardOf(n).name) + '.txt';
  put('cards/' + name,
    cardText(n) + '\n' + 'from: spatial/app/luminara-canon.js (derived, not stored)\n');
}
indexLines.push('  cards/01-..27-*.txt   <- spatial/app/luminara-canon.js (one file each)');

put('THE_TWENTY_SEVEN.txt',
  head('THE TWENTY-SEVEN', 'spatial/app/luminara-canon.js',
    ['every card, in deck order, with all it derives'])
  + Array.from({ length: 27 }, (_, i) => cardText(i + 1)).join('\n')
  + '\n');
indexLines.push('  THE_TWENTY_SEVEN.txt   <- all twenty-seven, read straight through');

put('THE_FOUR_SILENCES.txt',
  head('THE FOUR SILENCES', 'spatial/app/luminara-canon.js',
    ['drawable cards that stop interpretation and redirect'])
  + Object.keys(SILENCES).map((k) => {
    const n = Number(k), s = SILENCES[n];
    return [String(n).padStart(2, '0') + '  ' + s.name.toUpperCase()
      + '   (the deck calls this card ' + cardOf(n).name + ')',
      '', 'asks for: ' + s.asks, '', ...s.lines.map((l: string) => '  ' + l), '', ''].join('\n');
  }).join('\n') + '\n');
indexLines.push('  THE_FOUR_SILENCES.txt   <- the silences and what each asks');

// ---------------------------------------------------------------------------
// THE INDEX: what is here, and where each of it came from
// ---------------------------------------------------------------------------
put('INDEX.txt', [
  RULE,
  'LUMINARA: THE TEXTS',
  'taken out ' + new Date().toISOString().slice(0, 10),
  RULE,
  '',
  'Everything written in Luminara, as plain text, for reading and editing',
  'away from the machinery that usually holds it.',
  '',
  'The markdown is carried across verbatim rather than flattened: the',
  'structure is meaning here, and every file names the file it came from at',
  'its head, so an edit can be walked home by hand.',
  '',
  'The card files are DERIVED: the canon stores an essence and a code, and',
  'everything else on those sheets (the count, the interval, the knot, the',
  'counter, the becoming) is computed from the code by the deck\'s own laws.',
  'Editing those lines edits a copy, not the source: only the ESSENCE and',
  'the silence texts live as written words.',
  '',
  RULE,
  'FILES',
  RULE,
  '',
  ...indexLines,
  '',
  RULE,
  'NOT HERE',
  RULE,
  '',
  'Page copy that lives inside the web pages themselves (the lessons on the',
  'harmonic language page, the labels on the instrument) is not in this',
  'export: it is interleaved with markup, and pulling it out would give you',
  'fragments rather than texts. Ask and it can be done as a separate pass.',
  '',
].join('\n'));

console.log('wrote ' + written + ' files to ' + OUT);
