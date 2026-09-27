// LUMINARA · THE CARDS, pressed for the physical run.
//
// Drives the live card page rather than re-generating its markup, so what is
// exported is exactly what the architect reviewed on screen and the two can
// never drift. Run with:
//   bun scripts/pressCards.mjs
//
// It spawns its own portal server on a free port, presses through headless
// Chrome, and cleans up after itself. Nothing needs to be running first.
//
// OUT (dist/cards/):
//   luminara-deck.pdf      all twenty-eight sheets, one card per page,
//                          70 x 120 mm trim inside a 76 x 126 mm bleed box
//   001-the-seed.png ...   one file per card, 898 x 1488 px, 300 dpi,
//   028-the-back.png       bleed included, no crop marks
//
// The geometry, for whoever prints it: see docs/CARD_PRESS_NOTES.md.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS } from '../spatial/app/luminara-canon.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist', 'cards');
const PORT = 7311;
const BASE = 'http://127.0.0.1:' + PORT + '/app/luminara-cards.html';

// 300 dpi at the bleed box: 76 mm = 2.9921 in = 897.6 px, 126 mm = 1488.2 px.
const PX_W = 898, PX_H = 1488;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('No Chrome or Edge found.'); process.exit(1); }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = (n) => String(n).padStart(3, '0');

function run(args) {
  return new Promise((ok, no) => {
    const p = spawn(CHROME, args, { stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? ok() : no(new Error('chrome exited ' + c))));
    p.on('error', no);
  });
}

// a fresh profile per call: headless Chrome will otherwise attach to a running
// instance and silently do nothing
const PROFILE = resolve(OUT, '.chrome-profile');
const base = (extra) => [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + PROFILE, '--force-device-scale-factor=1',
  '--default-background-color=00000000', ...extra,
];

const server = spawn('bun', [resolve(ROOT, 'spatial', 'serve.ts'), String(PORT)],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });

const ready = async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(BASE)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (!(await ready())) throw new Error('portal server did not come up on ' + PORT);

  // ONE FILE, ALL THE CARDS. The page's own @page rule is 76 x 126 mm with
  // zero margin, so each sheet is already the bleed box: no scaling applied.
  process.stdout.write('deck pdf ... ');
  await run(base([
    '--print-to-pdf=' + resolve(OUT, 'luminara-deck.pdf'),
    '--no-pdf-header-footer', '--print-to-pdf-no-header',
    BASE + '?press',
  ]));
  console.log('done');

  // ONE FILE PER CARD, at the bleed box, 300 dpi.
  for (let n = 1; n <= 28; n++) {
    const name = n === 28 ? 'the-back' : slug(CARDS[n - 1].name);
    const file = resolve(OUT, pad(n) + '-' + name + '.png');
    process.stdout.write('\r' + pad(n) + '/028  ' + name.padEnd(22));
    await run(base([
      '--screenshot=' + file,
      '--window-size=' + PX_W + ',' + PX_H,
      '--hide-scrollbars',
      BASE + '?press&card=' + n,
    ]));
  }
  console.log('\r' + '28/28 pressed'.padEnd(34));

  rmSync(PROFILE, { recursive: true, force: true });
  const made = readdirSync(OUT).filter((f) => f.endsWith('.png') || f.endsWith('.pdf'));
  console.log('\n' + made.length + ' files in dist/cards');
  console.log('  trim 70 x 120 mm · bleed 3 mm every edge · ' + PX_W + ' x ' + PX_H + ' px at 300 dpi');
  console.log('  press notes: docs/CARD_PRESS_NOTES.md');
} finally {
  server.kill();
}
