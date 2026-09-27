// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE GUIDE'S PINS — the beginner's door lives inside the Wayfinder now,
// behind the button still named GUIDE, and it is the one surface a newcomer
// is most likely to read and least able to check. So it is held to the canon
// it quotes: THE WAY TO APPROACH and the three refusals must match the
// Caster's Law, the position glosses must match the sealed canon, the five
// voices must match the corpus, and the Silences must be the canon's own set,
// however many that is. A guide that drifted from the law it teaches would be
// worse than no guide, because it would be believed.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { POSITIONS, SILENCES, cardOf, counterOf, isSilent, CARDS, SILENCE_COUNT } from '../../spatial/app/luminara-canon.js';
import { VOICES } from '../../spatial/app/luminara-81.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf-8');
const READ = read('spatial', 'app', 'luminara-read.html');
const LAW = read('docs', 'LUMINARA_CASTERS_LAW.md');

// the guide is the browse pane: from its opening div to the script
const GUIDE = READ.slice(READ.indexOf('<div id="browsePane"'), READ.indexOf('<script type="module">'));

// the law wraps its lines across the margin; compare on collapsed whitespace
const flat = (s: string) => s.replace(/\s+/g, ' ');
// words alone: entities, quotation marks and punctuation stripped, so a pin
// tests what is said rather than how it was typeset
const words = (s: string) => s.toLowerCase().replace(/&[a-z]+;/g, ' ')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const GUIDE_FLAT = flat(GUIDE);
const LAW_FLAT = flat(LAW);

describe('THE WAY TO APPROACH — quoted from the law, never paraphrased', () => {
  const SEVEN = [
    'Come settled, not urgent.',
    'The oracle is not for emergencies. Crisis deserves people, not cards.',
    'Bring one true question.',
    'Cast once, then live with it.',
    'Receive as a mirror, not a verdict.',
    'The cards show; they never command.',
    'Silence is an answer.',
    'The last word is yours.',
    'The reading ends where your own knowing begins.',
  ];

  test('every line the guide teaches is the law’s own wording', () => {
    for (const line of SEVEN) {
      expect(LAW_FLAT.includes(line), 'the law must still say: ' + line).toBe(true);
      expect(GUIDE_FLAT.includes(line), 'the guide must quote: ' + line).toBe(true);
    }
  });

  test('all seven stand, numbered, and none has been dropped', () => {
    const list = GUIDE.slice(GUIDE.indexOf('THE WAY TO APPROACH'), GUIDE.indexOf('HOW TO CAST'));
    expect((list.match(/<li>/g) || []).length).toBe(7);
  });

  test('the three refusals are carried whole', () => {
    for (const refusal of ['No operation.', 'No prediction.', 'No authority.']) {
      expect(GUIDE).toContain(refusal);
    }
    expect(GUIDE_FLAT).toContain('Trajectory, never prediction');
    expect(GUIDE_FLAT).toContain('never tells anyone what to do');
  });

  test('the crisis line is said twice: first invitation, last word', () => {
    // the one line most likely to be needed and least likely to be read in
    // time, so the guide opens and closes on it
    expect((GUIDE_FLAT.match(/Crisis deserves people, not cards/g) || []).length).toBe(2);
  });
});

describe('THE TERMS — the guide teaches what the canon actually holds', () => {
  test('the three positions carry the canon’s own glosses', () => {
    for (const p of POSITIONS) {
      expect(GUIDE_FLAT.includes(p.gloss), 'gloss of ' + p.key).toBe(true);
    }
  });

  test('the five voices carry the corpus’s own registers', () => {
    for (const v of VOICES) {
      expect(GUIDE_FLAT.includes(v.register), 'register of ' + v.name).toBe(true);
      expect(GUIDE_FLAT.toUpperCase()).toContain(v.name.toUpperCase());
    }
  });

  test('the Silences stand in one paragraph, and it is the canon’s own set', () => {
    const section = GUIDE.slice(GUIDE.indexOf('V &middot; THE SILENCES'), GUIDE.indexOf('VI &middot; THE THREE DEPTHS'));
    // one paragraph, as the architect asked: a single <p> in the panel
    expect((section.match(/<p>/g) || []).length).toBe(1);
    expect(flat(section)).toContain('the edges of the map');
    const listed = CARDS.filter((c: any) => isSilent(c.n));
    expect(listed.length).toBe(SILENCE_COUNT);
    const w = words(section);
    for (const c of listed) {
      const sil = SILENCES[c.n];
      expect(w.includes(words(c.name)), 'card ' + c.name).toBe(true);
      expect(w.includes(words(sil.name)), 'the silence named ' + sil.name).toBe(true);
      expect(w.includes(words(sil.asks)), 'asks for ' + sil.asks).toBe(true);
    }
    // a card that does speak must not be listed among the edges
    expect(w.includes(words('The Drift'))).toBe(false);
  });

  test('the mirror is stated, and the depth law with it', () => {
    expect(GUIDE_FLAT).toContain('It is a mirror, not an oracle.');
    expect(GUIDE_FLAT).toContain('The coarse reading always stands.');
    // the honest expectation, or a reader counts one card at home as an omen
    expect(GUIDE_FLAT).toContain('exactly one card at home');
  });
});

describe('THE DOOR — the guide stands where the browser stood', () => {
  test('the button is still named GUIDE, and it opens this pane', () => {
    expect(READ).toContain('<button id="mBrowse">GUIDE</button>');
    expect(READ).toContain("$('mBrowse').addEventListener('click', () => mode(false));");
    // the old deep link still lands: pages elsewhere point at #guide
    expect(READ).toContain("location.hash === '#guide'");
  });

  test('the standalone page is gone, and nothing points at it', () => {
    expect(fs.existsSync(path.join(ROOT, 'spatial', 'app', 'luminara-first.html'))).toBe(false);
    expect(READ.includes('luminara-first.html')).toBe(false);
  });

  test('the browse machinery left with the browser', () => {
    for (const gone of ['renderBrowse', 'recenterGlyphs', 'gCensus', 'concordRing', 'pickCard']) {
      expect(READ.includes(gone), gone + ' should be gone').toBe(false);
    }
    // and the guide points a student at the deck's own study room instead
    expect(GUIDE).toContain('href="/app/luminara-ring.html"');
  });
});
