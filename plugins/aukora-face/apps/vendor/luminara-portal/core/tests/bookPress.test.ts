// THE BOOK OF LUMINARA — pressing gates.
// Enforcement over declaration: the sealed room, the style law, and the
// derived content of the pressed book are all verified here, against the
// canon module, before any artifact ships.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pressBook, bookText } from '../../scripts/pressBookOfLuminara.mjs';
import { CARDS, codeMarks, knotOf, counterOf, isSilent } from '../../spatial/app/luminara-canon.js';

const SRC = readFileSync(
  fileURLToPath(new URL('../../scripts/pressBookOfLuminara.mjs', import.meta.url)), 'utf8');
const { html } = pressBook();

describe('THE SEALED ROOM (the gate, not the promise)', () => {
  test('the pressing script never touches the withheld field', () => {
    // no property access, no destructure, no bracket access of the sealed field
    expect(SRC).not.toMatch(/\.letter\b/);
    expect(SRC).not.toMatch(/\bletter\s*[:,}]/);
    expect(SRC).not.toMatch(/\[\s*['"]letter['"]\s*\]/);
    // the safe destructure is present: only n, name, essence enter the book
    expect(SRC).toContain('CARDS.map(({ n, name, essence })');
  });
  test('the room is stated plainly in the book', () => {
    expect(html).toContain('One correspondence is missing from this book on purpose.');
    expect(html).toContain('Nothing is hidden inside these pages: no cipher, no puzzle.');
    expect(html).toContain('derives without a single letter');
    expect(html).toContain('or they will not. That is the test, and the book is content to wait.');
  });
});

describe('THE STYLE LAW (applied at pressing, canon untouched)', () => {
  test('no em or en dash survives in the PROSE (the bar mark of the code is exempt)', () => {
    // the flowing mark of the written code IS the em-dash glyph (canon MARKS);
    // the style law governs prose, not the code's own glyphs
    const prose = html
      .replace(/<div class="pmarks"[^>]*>[^<]*<\/div>/g, '')
      .replace(/<td class="tmk">[^<]*<\/td>/g, '');
    expect(prose).not.toContain('—');
    expect(prose).not.toContain('–');
    // and the marks themselves are present, verbatim from canon
    expect(html).toContain('class="pmarks"');
  });
  test('bookText converts the register: dashes to colon then comma, spelling turns British', () => {
    expect(bookText('Silence itself — the unstruck string.'))
      .toBe('Silence itself: the unstruck string.');
    expect(bookText('First asymmetry: something stirs — still open.'))
      .toBe('First asymmetry: something stirs, still open.');
    expect(bookText('A — b. C — d.')).toBe('A: b. C: d.');
    expect(bookText('Recognize it. Do not rename it.')).toBe('Recognise it. Do not rename it.');
  });
});

describe('THE PRESSED CONTENT (derived, verified against canon)', () => {
  test('the spine: cover, front matter, three houses, table, appendix, the circle', () => {
    expect(html).toContain('THE BOOK OF LUMINARA');
    expect(html).toContain('NILA PADMA');
    expect(html).toContain('THE WAY TO APPROACH');
    expect(html).toContain('THE INTERPRETER’S LAW');
    expect(html).toContain('HOW THIS BOOK IS MADE');
    expect(html).toContain('THE SEALED ROOM');
    expect(html).toContain('HOW TO READ');
    expect(html).toContain('THE TABLE OF ANSWERS');
    expect(html).toContain('APPENDIX: THE DERIVATION');
    expect(html).toContain('APPENDIX: THE TWENTY-SEVEN');
    expect(html).toContain('The book you have finished is a circle.');
  });
  test('the approach rides verbatim; the law keeps its refusals; crisis outranks', () => {
    expect(html).toContain('Come settled, not urgent.');
    expect(html).toContain('Receive as a mirror, not a verdict.');
    expect(html).toContain('The last word is yours.');
    expect(html).toContain('describes; it never operates');
    expect(html).toContain('trajectory, never prediction');
    expect(html).toContain('beside you, never above you');
    expect(html).toContain('the oracle waits; it never calls');
    expect(html).toContain('that call outranks every page here');
  });
  test('exactly 27 card pages, every name and code present, no Silence tag on any page', () => {
    expect(html.split('<div class="page card-page">').length - 1).toBe(27);
    for (const c of CARDS) {
      expect(html).toContain('>' + c.name + '<');
      expect(html).toContain(codeMarks(c.n));
    }
    // the Silences remain silent: the class is taught in the grammar only
    expect(html).not.toContain('a Silence<'); // no page tag
    expect(html).toContain('seated at four, sixteen, twenty-two and twenty-five');
    // the grammar stands as two pages of short teachings
    expect(html.split('HOW TO READ').length - 1).toBe(2);
    expect(html).toContain('Each card bears its figure twice');
    expect(html).toContain('it is written in the code itself');
  });
  test('every answer line points to the true counter', () => {
    expect(html).toContain('Its answer is itself');
    for (let n = 2; n <= 27; n++) {
      const cn = counterOf(n);
      expect(html).toContain('Its answer is ' + CARDS[cn - 1].name + ' (' + cn + ').');
    }
  });
  test('the appendix carries every ratio and interval, derived', () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    for (let n = 1; n <= 27; n++) {
      const k = knotOf(n);
      const aq = Math.abs(k.q);
      const ratio = aq === 0 ? '0:1' : (aq / gcd(k.p, aq)) + ':' + (k.p / gcd(k.p, aq));
      expect(html).toContain('>' + ratio + '<');
      expect(html).toContain(k.interval);
    }
    expect(html).toContain('the perfect fifth');
    expect(html).toContain('the tritone');
    expect(html).toContain('the far dissonance');
  });
  test('the letters never appear as a correspondence anywhere in the book', () => {
    // the book may speak the word "letters" (the sealed room does), but no
    // card page may pair a card with its withheld letter
    for (const c of CARDS) {
      expect(html).not.toContain(c.name + ' · ' + (c as any).letter);
      expect(html).not.toContain('>' + (c as any).letter + '</td>');
    }
  });
});
