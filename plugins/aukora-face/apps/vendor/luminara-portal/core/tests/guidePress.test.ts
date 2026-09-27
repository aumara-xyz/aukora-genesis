// THE ILLUSTRATED GUIDE — pressing gates. The sealed room, the style law
// (no dash characters at all: the marks are drawn, never typed), and the
// guide's content verified against canon.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pressGuide } from '../../scripts/pressIllustratedGuide.mjs';
import { CARDS, counterOf, knotOf } from '../../spatial/app/luminara-canon.js';
import { THE_81, POSITION_TENSE } from '../../spatial/app/luminara-81.js';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SRC = readFileSync(
  fileURLToPath(new URL('../../scripts/pressIllustratedGuide.mjs', import.meta.url)), 'utf8');
const { html } = pressGuide();

describe('THE ILLUSTRATED GUIDE (phone pressing)', () => {
  test('the sealed room holds: only n, name, essence enter', () => {
    expect(SRC).not.toMatch(/\.letter\b/);
    expect(SRC).not.toMatch(/\bletter\s*[:,}]/);
    expect(SRC).toContain('CARDS.map(({ n, name, essence })');
  });
  test('the style law, absolute: no em or en dash anywhere (marks are drawn, never typed)', () => {
    expect(html).not.toContain('—');
    expect(html).not.toContain('–');
  });
  test('the spine: cover, approach first, motions, mathematics, harmonics, houses, use, the close', () => {
    for (const s of ['AN ILLUSTRATED GUIDE', 'THE FIRST MOTIONS', 'TOROIDAL MATHEMATICS · THE NUMBER',
      'TOROIDAL MATHEMATICS · THE KNOT', 'TOROIDAL MATHEMATICS · THE ANSWER',
      'HARMONICS · EVERY CARD IS AN INTERVAL', 'HARMONICS · THE LOCKED CHORDS',
      'USING THE CARDS', 'THE WAY TO APPROACH', 'THE SILENCES', 'THE BECOMING',
      'Begin where you are.', 'NILA PADMA']) {
      expect(html).toContain(s);
    }
    expect(html.split('<div class="pg house">').length - 1).toBe(3);
    // the approach is passed before a single card is reached
    expect(html.indexOf('THE WAY TO APPROACH')).toBeLessThan(html.indexOf('THE FIRST MOTIONS'));
    // the close carries no label: OUTRO is retired
    expect(html).not.toContain('OUTRO');
  });
  test('the openings above, the state reading at the foot', () => {
    // the poetic opening stands first; the ternary explainer moved to the
    // bottom of the page, small and italic (the architect's direction)
    expect(html).toContain('The quiet before anything begins.');
    expect(html).toContain('The fire on the hill that will not go out.');
    expect(html.split('class="copen"').length - 1).toBe(27);
    expect(html.split('class="cstates"').length - 1).toBe(27);
    expect(html).toContain('nothing yet moves');
    // on a card page, the opening precedes the essence and the states close it
    const seed = html.indexOf('The quiet before anything begins.');
    const seedStates = html.indexOf('nothing yet moves');
    expect(seed).toBeLessThan(seedStates);
  });
  test('the four corners: the involution as layout on every card page', () => {
    expect(html.split('class="cn bl"').length - 1).toBe(27);
    expect(html.split('class="cn br"').length - 1).toBe(27);
    // the Seed reads 1 · 0 · 0 · 1, self-paired at both ends of the diagonal
    expect(html).toContain('<div class="cn bl">0</div>');
  });
  test('all twenty-seven cards, each with its interval, ratio, and true answer', () => {
    expect(html.split('<div class="pg card">').length - 1).toBe(27);
    for (const c of CARDS) {
      expect(html).toContain('>' + c.name + '<');
      expect(html).toContain(knotOf(c.n).interval);
    }
    expect(html).toContain('answers itself: the one self-paired card');
    for (let n = 2; n <= 27; n++) {
      const cn = counterOf(n);
      expect(html).toContain('answers ' + CARDS[cn - 1].name + ' (' + cn + ')');
    }
  });
  test('the rails ride: mirror line, approach, positions named, silences taught, no page tags', () => {
    expect(html).toContain('What lands is a mirror, not a verdict.');
    expect(html).toContain('Come settled, not urgent.');
    expect(html).toContain('The last word is yours.');
    expect(html).toContain('The cast is by randomisation, always');
    expect(html).toContain('Those positions are trefoil, genus, and phi.');
    expect(html).toContain('Do not translate a Silence. Meet what it asks.');
    expect(html).not.toContain('a Silence<');
    expect(html).toContain('the key rests with its keeper');
  });
});

describe('THE ILLUSTRATED GUIDE — held to the canon it presses from', () => {
  // the law wraps its lines, so both sides are compared with whitespace flattened
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  const lawText = flat(readFileSync(
    fileURLToPath(new URL('../../docs/LUMINARA_CASTERS_LAW.md', import.meta.url)), 'utf8'));
  const flatHtml = flat(html);

  test('the approach is the law\'s own seven lines, not a paraphrase', () => {
    // the Caster's Law IV fixes this surface by name; the guide may reproduce
    // it and may not reword it. Both clauses below had drifted once already.
    for (const line of [
      'Come settled, not urgent.',
      'Crisis deserves people, not cards.',
      'Bring one true question.',
      'Cast once, then live with it.',
      'Asking again soon is correcting course, not rolling again.',
      'Receive as a mirror, not a verdict.',
      'If a reading seems to tell you what to do, you have read past it.',
      'Silence is an answer.',
      'The last word is yours.',
    ]) {
      expect(lawText, 'the law must still say: ' + line).toContain(line);
      expect(flatHtml, 'the guide must not drift from the law: ' + line).toContain(line);
    }
    // the metaphor the guide had grown, which the law does not use
    expect(html).not.toContain('argues with the mirror');
  });

  test('the concordance explains itself: the pair sums to the Seed', () => {
    expect(html).toContain('every pair sums to nought');
    expect(html).toContain('sound the same interval');
  });

  test('the four Silences are named, and what each asks', () => {
    for (const s of ['The Resonance', 'The Labyrinth', 'The Mask', 'The Witness']) {
      expect(html).toContain(s);
    }
    for (const s of ['asks descent', 'asks surrender', 'asks recognition']) {
      expect(html).toContain(s);
    }
    // and the reason the faces stay unmarked is stated rather than assumed
    expect(html).toContain('carry no mark');
  });

  test('the foot line varies: the uniform cards do not use the mixed frame', () => {
    // one sentence repeated twenty seven times was the complaint
    expect(html).toContain('World, between and heart all hold still');
    expect(html).toContain('World, between and heart all turn');
    const framed = html.split('The world ').length - 1;
    expect(framed).toBeLessThan(27);   // the uniform cards are spoken differently
    expect(framed).toBeGreaterThan(15);
  });

  test('anyone who can count in threes: the claim is exact', () => {
    expect(html).not.toContain('anyone who can count could');
    expect(html.split('count in threes').length - 1).toBe(2);
  });
});

describe('THE ILLUSTRATED GUIDE — the figure, the questions, the two new keys', () => {
  test('the frame follows the ink: no figure hangs off centre', () => {
    // the viewBox was pinned to the torus origin, which is the hole and not
    // the drawing; at low windings the strand leans hard to one side
    // a symmetric figure (the Seed's circle) legitimately still sits at the
    // old value: what matters is that asymmetric ones no longer do
    const boxes = [...html.matchAll(/viewBox="(-?[\d.]+) (-?[\d.]+) 5\.7 5\.7"/g)];
    expect(boxes.length).toBeGreaterThan(50);
    // every frame is still the same size, so cards stay comparable
    for (const b of boxes) {
      expect(Math.abs(parseFloat(b[1]) + 2.85)).toBeLessThan(0.6);
      expect(Math.abs(parseFloat(b[2]) + 2.85)).toBeLessThan(0.6);
    }
    // and at least one has genuinely moved (the Drift and the Fold do)
    expect(boxes.some((b) => Math.abs(parseFloat(b[1]) + 2.85) > 0.2)).toBe(true);
  });

  test('each card faces its three questions, taken from canon', () => {
    expect(html.split('class="pg qpage"').length - 1).toBe(27);
    for (const n of [1, 6, 14, 27]) {
      for (const t of POSITION_TENSE) {
        expect(html).toContain(esc(THE_81[n][t].q));
      }
    }
    // the guide writes none of them, and the law's shape is stated
    expect(html).toContain('A question you can answer, never an instruction to follow.');
  });

  test('the positions are explained, each from the mathematics it is named for', () => {
    expect(html).toContain('THE THREE POSITIONS');
    expect(html).toContain('the simplest knot that genuinely cannot be untied');
    expect(html).toContain('how many cuts a shape can take');
    expect(html).toContain('the ratio the torus itself is built on');
  });

  test('the card face is explained, and the winding is not called a house', () => {
    expect(html).toContain('READING A CARD FACE');
    expect(html).toContain('On the right, the winding');
    expect(html).toContain('It is not the house.');
  });
});

describe('THE ILLUSTRATED GUIDE — the trim', () => {
  test('pressed at the tarot trim, so book and deck travel as one object', () => {
    expect(html).toContain('@page { size: 70mm 120mm; margin: 0; }');
    expect(html).toContain('width: 70mm');
  });

  test('the trim is computed from one place, never hardcoded per rule', () => {
    // W, H, wS and tS govern every length; changing the trim is three numbers
    expect(SRC).toContain('const W = 70, H = 120;');
    expect(SRC).toContain('const wS = W / 100;');
    expect(SRC).toMatch(/const tS = 0\.\d+;/);
    // and the type scale is deliberately NOT the width scale: the page loses
    // more height than width, so type must come down faster or dense pages clip
    expect(SRC).toContain('the type scale, which is NOT wS');
  });

  test('no page-sized value survives from the old 100 x 200 pressing', () => {
    expect(html).not.toContain('100mm 200mm');
    expect(html).not.toContain('199.4mm');
  });
});

describe('THE ILLUSTRATED GUIDE — the door stands before the room', () => {
  test('how to pull, the face, and the positions all precede the cards', () => {
    const firstHouse = html.indexOf('<div class="pg house">');
    for (const s of ['USING THE CARDS', 'READING A CARD FACE', 'THE THREE POSITIONS']) {
      expect(html.indexOf(s), s + ' must come before the deck').toBeLessThan(firstHouse);
    }
    // and the positions page is the last of them, handing straight into the cards
    expect(html.indexOf('THE THREE POSITIONS')).toBeGreaterThan(html.indexOf('READING A CARD FACE'));
  });

  test('the questions are explained once, not repeated under all twenty seven', () => {
    expect(html.split('never an instruction to follow').length - 1).toBe(1);
    // and the one saying stands on the positions page, before any question page
    const line = html.indexOf('never an instruction to follow');
    const firstAsks = html.indexOf('class="qname"');
    expect(line).toBeLessThan(firstAsks);
    expect(html).toContain('Every card that follows faces its three questions');
  });
});
