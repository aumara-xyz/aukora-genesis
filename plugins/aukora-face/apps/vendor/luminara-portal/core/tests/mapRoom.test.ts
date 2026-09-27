// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE MAP ROOM'S PINS (docs/LUMINARA_MAP_ROOM.md) — mechanical honesty for
// the room of living charts. The catalogue is the room's only source of
// shelves, so these pins hold the catalogue to its word: every door opens
// onto a real file, every slug is a clean address, and the room's own
// authored charts (docs/map-room/**) keep the style laws by test rather
// than by memory: no em dashes, provenance recorded. The lens is pinned to
// its own law: escape first, markup second, and no link scheme beyond the
// open web, the served archive, and the room's own addresses.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderMarkdown, liveLinkOf } from '../../spatial/app/map-room-md.js';
import { FIGURES } from '../../spatial/app/map-room-figures.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const CAT: Array<{
  slug: string; shelf: string; status: string; field: string; title: string; line: string;
  path?: string; pdf?: string; where?: string; lineage: string[]; added: string;
  resonates?: string[]; frictions?: string[];
}> = JSON.parse(fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'map-room.json'), 'utf-8'));

describe('THE MAP ROOM — the catalogue', () => {
  test('every entry is whole: slug, shelf, title, line, status, added', () => {
    for (const e of CAT) {
      expect(e.slug, e.title).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['books', 'seeings', 'laws', 'instruments', 'workings', 'references']).toContain(e.shelf);
      expect(['resident', 'draft', 'held']).toContain(e.status);
      expect(['trefoil', 'genus', 'phi'], e.slug + ' must stand in a field').toContain(e.field);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.line.length).toBeGreaterThan(10);
      expect(e.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(e.lineage)).toBe(true);
    }
  });

  test('slugs are unique addresses', () => {
    const slugs = CAT.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('every resident or draft door opens onto a real markdown file that begins with its title', () => {
    // draft carries the same door as resident: it renders and it opens in
    // the desk for editing. The status only says the TEXT is unfinished,
    // not that the mechanism differs.
    for (const e of CAT.filter((x) => x.status === 'resident' || x.status === 'draft')) {
      expect(e.path, e.slug).toBeTruthy();
      expect(e.path!.endsWith('.md'), e.slug + ' must be markdown to be openable').toBe(true);
      const abs = path.join(ROOT, ...e.path!.split('/'));
      expect(fs.existsSync(abs), e.slug + ' → ' + e.path).toBe(true);
      const head = fs.readFileSync(abs, 'utf-8').slice(0, 200);
      expect(head.startsWith('# '), e.slug + ' must begin with a # title').toBe(true);
    }
  });

  test('the field law: a Map is knotted in — trefoil requires resident, and every pressed companion exists', () => {
    for (const e of CAT) {
      if (e.field === 'trefoil') {
        expect(e.status, e.slug + ': a Map cannot be a draft or merely held; it earned its knot').toBe('resident');
      }
      if (e.pdf) {
        const abs = path.join(ROOT, ...e.pdf.split('/'));
        expect(fs.existsSync(abs), e.slug + ' pressed volume → ' + e.pdf).toBe(true);
      }
    }
    // each bench holds work: no face of the room stands empty
    for (const f of ['trefoil', 'genus', 'phi']) {
      expect(CAT.some((e) => e.field === f), 'the ' + f + ' bench must not stand empty').toBe(true);
    }
  });

  test('every named resonance or friction points at a real chart (the resonance discipline)', () => {
    const slugs = new Set(CAT.map((e) => e.slug));
    for (const e of CAT) {
      for (const r of e.resonates ?? []) {
        expect(slugs.has(r), e.slug + ' resonates with unknown chart: ' + r).toBe(true);
        expect(r === e.slug, e.slug + ' may not resonate with itself').toBe(false);
      }
      for (const r of e.frictions ?? []) {
        expect(slugs.has(r), e.slug + ' frictions with unknown chart: ' + r).toBe(true);
        expect(r === e.slug, e.slug + ' may not friction with itself').toBe(false);
      }
    }
    // the web is not empty: the first resonances were named when the
    // discipline was sealed (the umbra family, the declaration, the names)
    expect(CAT.some((e) => e.resonates && e.resonates.length > 0)).toBe(true);
  });

  test('every held entry either opens a real volume or records where it lives', () => {
    for (const e of CAT.filter((x) => x.status === 'held')) {
      if (e.path) {
        const abs = path.join(ROOT, ...e.path.split('/'));
        expect(fs.existsSync(abs), e.slug + ' → ' + e.path).toBe(true);
      } else {
        expect(e.where, e.slug + ' held without path must record where').toBeTruthy();
      }
    }
  });
});

describe("THE MAP ROOM — the room's own charts keep the style laws", () => {
  const roomDir = path.join(ROOT, 'docs', 'map-room');
  const charts = fs.readdirSync(roomDir).filter((f) => f.endsWith('.md'));

  test('the room has at least its first chart', () => {
    expect(charts.length).toBeGreaterThanOrEqual(1);
  });

  test('no em dashes; provenance recorded; nothing predicted or prescribed by force', () => {
    for (const f of charts) {
      const text = fs.readFileSync(path.join(roomDir, f), 'utf-8');
      expect(text.includes('—'), f + ' must contain no em dashes').toBe(false);
      expect(/##[^\n]*PROVENANCE/i.test(text), f + ' must record provenance').toBe(true);
      expect(/\byou (should|must)\b/i.test(text), f + ' must not command').toBe(false);
    }
  });

  test('the standalone law: a chart reads whole without the conversation that made it', () => {
    // set by the architect, 23 July 2026: charts are short standalone essays.
    // Chat lineage lives only in the provenance footer, so the body may not
    // lean on a conversation the reader cannot see. The patterns here are the
    // unambiguous leans; the rest is editorial judgement at writing time.
    const DEIXIS = /this session|as discussed|the conversation (above|we)|earlier in this (chat|thread)|you (said|asked)|returned from the descent|in the chat\b/i;
    for (const f of charts) {
      const text = fs.readFileSync(path.join(roomDir, f), 'utf-8');
      const cut = text.search(/##+ *[^\n]*PROVENANCE/i);
      const body = cut >= 0 ? text.slice(0, cut) : text;
      expect(DEIXIS.test(body), f + ' body must stand without its conversation').toBe(false);
    }
  });
});

describe('THE MAP ROOM — the lens', () => {
  test('the illustrator: whitelisted figures render, unknown names stay words, never the engine', () => {
    // a known figure renders as a computed SVG with its caption
    const known = renderMarkdown('::figure vortex-eight::');
    expect(known).toContain('<figure class="chartfig">');
    expect(known).toContain('<svg');
    expect(known).toContain('figcaption');
    // deterministic: the same string every time
    expect(renderMarkdown('::figure vortex-eight::')).toBe(known);
    // an unknown name remains words: no svg, no injection
    const unknown = renderMarkdown('::figure not-a-figure::');
    expect(unknown).not.toContain('<svg');
    expect(unknown).toContain('::figure not-a-figure::');
    // the whitelist is exactly the computed constructions: the room's own
    // fifteen (the emission spectrum came home from the zeta page, its
    // literals pinned to the canon in particleReading.test.ts), and the ten
    // knot diagrams of the Topology of Healing, Book One
    expect(Object.keys(FIGURES).sort()).toEqual([
      'analemma-eight', 'book-borromean', 'book-braid', 'book-cinquefoil',
      'book-fig8', 'book-hopf', 'book-rift', 'book-torus', 'book-torus-outline',
      'book-trefoil', 'book-unknot', 'breathing-tree', 'comma-spiral',
      'counter-spirals', 'dragon-nodes', 'dwelling-throat', 'emission-spectrum',
      'lemniscate-home', 'pentagram-well', 'rosette-27', 'three-flows',
      'torus-weather', 'trefoil-entwined', 'triple-eclipse', 'vortex-eight',
    ].sort());
    // the illustrator touches the renderer only, never the engine
    const src = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'map-room-figures.js'), 'utf8');
    for (const forbidden of ['drawOne', 'drawThree', 'drawWide', 'descend(', 'composeReading', 'askAumaText', 'SILENCES', 'localStorage']) {
      expect(src.includes(forbidden), 'illustrator must not touch: ' + forbidden).toBe(false);
    }
    // every figure every chart calls is on the whitelist
    const chartsDir = path.join(ROOT, 'docs', 'map-room');
    let totalCalls = 0;
    for (const f of fs.readdirSync(chartsDir).filter((x) => x.endsWith('.md'))) {
      const chart = fs.readFileSync(path.join(chartsDir, f), 'utf8');
      const calls = [...chart.matchAll(/^::figure\s+([a-z0-9-]+)::/gm)].map((m) => m[1]);
      totalCalls += calls.length;
      for (const key of calls) expect(Object.keys(FIGURES), f + ' calls ' + key).toContain(key);
    }
    expect(totalCalls).toBeGreaterThanOrEqual(7); // the crossing and its two works
  });
  test('renders the ordinary grammar: headings, emphasis, lists, quotes, rules', () => {
    const html = renderMarkdown('# Title\n\nA *soft* and **firm** line.\n\n- one\n- two\n\n> held\n\n---\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<em>soft</em>');
    expect(html).toContain('<strong>firm</strong>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<blockquote>held</blockquote>');
    expect(html).toContain('<hr>');
  });

  test('escape first, markup second: a chart cannot inject behaviour', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> and <img src=x onerror=y>');
    expect(html.includes('<script')).toBe(false);
    expect(html.includes('<img')).toBe(false);
    expect(html).toContain('&lt;script&gt;');
  });

  test('links: web, archive, instruments and the room itself pass; all else falls to words', () => {
    // The instruments (/app/...) were opened to charts at the architect's word,
    // 19 July 2026: a chart about an instrument may now point at it. The room
    // still casts nothing; a link is a signpost, not a hand.
    const html = renderMarkdown(
      '[a](https://example.org) [b](/docs/x.md) [c](#/nodus) [e](/app/luminara-lattice.html) [d](javascript:alert(1))');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('href="/docs/x.md"');
    expect(html).toContain('href="#/nodus"');
    expect(html).toContain('href="/app/luminara-lattice.html"');
    expect(html.includes('javascript:')).toBe(false);
    expect(html).toContain('d'); // the words survive
  });

  test('the allowlist stays an allowlist: no other scheme or path escapes it', () => {
    // Adding a fourth prefix is only safe while the rule remains a whitelist.
    // These are the shapes that would matter if it ever became a blacklist.
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox', 'file:///etc/passwd', '//evil.example.org/x',
      '/api/aumlok', '/state/kira/brain.json', 'app/relative.html',
    ]) {
      const out = renderMarkdown('[t](' + bad + ')');
      expect(out.includes('<a '), bad + ' must not become a link').toBe(false);
      expect(out, bad + ' must survive as words').toContain('t');
    }
  });

  test('fenced code is carried verbatim and inert', () => {
    const html = renderMarkdown('```\nconst x = 1; // *not* emphasis\n<b>not bold</b>\n```');
    expect(html).toContain('const x = 1; // *not* emphasis');
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;');
    expect(html.includes('<em>')).toBe(false);
  });

  test('pipe tables render with their header row', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  test('the crossing and its two works render end to end through the lens', () => {
    // the nodus, the centre of the room: five laws in orbit, four roads out
    const nodus = renderMarkdown(
      fs.readFileSync(path.join(ROOT, 'docs', 'map-room', 'THE_NODUS.md'), 'utf-8'));
    expect(nodus).toContain('<h1>THE NODUS</h1>');
    expect(nodus).toContain('<h2>IV · THE BIRTH AT THE NULL</h2>');
    expect(nodus).toContain('<h2>VIII · THE FOUR ROADS</h2>');
    expect(nodus).toContain('lit by its distance from the null');
    for (const road of ['#/interior-weather', '#/shape-of-the-year', '#/two-and-three', '#/arrow-and-dwelling']) {
      expect(nodus, 'the road ' + road).toContain('href="' + road + '"');
    }
    expect(nodus.includes('<script')).toBe(false);
    // the form's work carries the family of forms and the healing law
    const weather = renderMarkdown(
      fs.readFileSync(path.join(ROOT, 'docs', 'map-room', 'THE_INTERIOR_WEATHER.md'), 'utf-8'));
    expect(weather).toContain('<h1>THE INTERIOR WEATHER</h1>');
    expect(weather).toContain('<h2>I · THE FAMILY OF FORMS</h2>');
    expect(weather).toContain('<h2>III · THE DECK UPON THE FORM</h2>');
    expect(weather).toContain('<em>no cut operations</em>');
    expect(weather.includes('<script')).toBe(false);
    // the year's work carries the calendar, the carry, and recurrence
    const year = renderMarkdown(
      fs.readFileSync(path.join(ROOT, 'docs', 'map-room', 'THE_SHAPE_OF_THE_YEAR.md'), 'utf-8'));
    expect(year).toContain('<h1>THE SHAPE OF THE YEAR</h1>');
    expect(year).toContain('<h2>I · THE CALENDAR IS A TORUS</h2>');
    expect(year).toContain('keeps time by returning to it');
    expect(year).toContain('It is how the year is shaped');
    expect(year.includes('<script')).toBe(false);
    // the descent into the cave: the two and the three
    const two = renderMarkdown(
      fs.readFileSync(path.join(ROOT, 'docs', 'map-room', 'THE_TWO_AND_THE_THREE.md'), 'utf-8'));
    expect(two).toContain('<h1>THE TWO AND THE THREE</h1>');
    expect(two).toContain('<h2>IV · THE LADDER OF NEAR-CLOSURES</h2>');
    expect(two).toContain('bases without a centre');
    expect(two).toContain('what cannot');
    expect(two.includes('<script')).toBe(false);
    // the entwinement: the arrow and the dwelling
    const arrow = renderMarkdown(
      fs.readFileSync(path.join(ROOT, 'docs', 'map-room', 'THE_ARROW_AND_THE_DWELLING.md'), 'utf-8'));
    expect(arrow).toContain('<h1>THE ARROW AND THE DWELLING</h1>');
    expect(arrow).toContain('<h2>II · THE MIRROR RUNS BACKWARD</h2>');
    expect(arrow).toContain('Reverse every motion; keep every place.');
    expect(arrow).toContain('not separate, they are entwined');
    expect(arrow.includes('<script')).toBe(false);
  });
});

describe('THE MAP ROOM — a chart that links a live window says so at the top', () => {
  test('liveLinkOf finds a chart\'s own instrument link and nothing else', () => {
    expect(liveLinkOf('no link here, just words')).toBeNull();
    expect(liveLinkOf('a web link [x](https://example.org) is not an instrument')).toBeNull();
    expect(liveLinkOf('a docs link [x](/docs/y.md) is not an instrument')).toBeNull();
    expect(liveLinkOf('buried deep: [the sea](/app/luminara-sea.html), a workshop surface'))
      .toEqual({ text: 'the sea', href: '/app/luminara-sea.html' });
    // the first instrument link wins; a chart names one live window, not a list
    expect(liveLinkOf('[a](/app/one.html) and later [b](/app/two.html)'))
      .toEqual({ text: 'a', href: '/app/one.html' });
  });

  test('the room surfaces the chart\'s own link at the top, never a second registry', () => {
    const roomSrc = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-map-room.html'), 'utf-8');
    expect(roomSrc).toContain("import { renderMarkdown, liveLinkOf } from '/app/map-room-md.js';");
    expect(roomSrc).toContain('const live = liveLinkOf(currentOriginalText);');
    expect(roomSrc).toContain('id="chartLive"');
    expect(roomSrc).toContain('open the live window');
    // the pressed volume stands at the head beside the live window rather than
    // buried in the resonance line, and is hung from the catalogue BEFORE the
    // fetch so it survives a chart that fails to answer
    expect(roomSrc).toContain('the pressed volume &middot; pdf');
    expect(roomSrc).toContain('const doors = [];');
    expect(roomSrc.indexOf('const doors = [];')).toBeLessThan(roomSrc.indexOf("await fetch('/' + entry.path)"));
    // and it is no longer duplicated into the resonance line
    const resBlock = roomSrc.slice(roomSrc.indexOf('const resLines = [];'), roomSrc.indexOf('const doors = [];'));
    expect(resBlock.includes('entry.pdf'), 'the pressed volume must not also sit in the resonance line').toBe(false);
  });

  test('every catalogue pdf a chart offers is a file that actually exists', () => {
    for (const e of CAT.filter((x) => x.pdf)) {
      const abs = path.join(ROOT, ...e.pdf!.split('/'));
      expect(fs.existsSync(abs), e.slug + ' offers a pressed volume that is missing: ' + e.pdf).toBe(true);
      expect(fs.statSync(abs).size, e.slug + ' pressed volume is empty').toBeGreaterThan(1000);
    }
  });

  test('the search reads the catalogue only, and marks without weakening the escape', () => {
    const roomSrc = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-map-room.html'), 'utf-8');
    // the search exists and is driven by the input's own events
    expect(roomSrc).toContain('id="searchIn"');
    expect(roomSrc).toContain("searchInEl.addEventListener('input'");
    // it reaches across all three faces: a reader who has forgotten a name has
    // also forgotten which bench it stands on
    expect(roomSrc).toContain('function hits(terms)');
    expect(roomSrc).toContain('const found = hits(terms);');
    // THE ESCAPE DISCIPLINE. The highlighter must slice the RAW string and
    // escape each fragment, inserting <mark> between escaped pieces. Marking
    // already-escaped HTML would let a query like "amp" cut an entity in half.
    expect(roomSrc).toContain("out += escText(s.slice(last, m.index)) + '<mark>' + escText(m[0]) + '</mark>';");
    expect(roomSrc).toContain("return out + escText(s.slice(last));");
    // the query is escaped into its own regex: a search is not a pattern
    expect(roomSrc).toContain('const escRx =');
    expect(roomSrc).toContain('terms.map(escRx)');
    // the search adds no network lane; the catalogue is already in hand
    const searchBlock = roomSrc.slice(roomSrc.indexOf('function hits(terms)'), roomSrc.indexOf('function renderShelves()'));
    for (const forbidden of ['fetch(', 'localStorage', 'XMLHttpRequest']) {
      expect(searchBlock.includes(forbidden), 'the search must not reach for: ' + forbidden).toBe(false);
    }
  });

  test('every chart in the room today that names a live window is one liveLinkOf actually finds', () => {
    const roomDir = path.join(ROOT, 'docs', 'map-room');
    let found = 0;
    for (const f of fs.readdirSync(roomDir).filter((x) => x.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(roomDir, f), 'utf-8');
      if (!text.includes('](/app/')) continue;
      const live = liveLinkOf(text);
      expect(live, f + ' has an instrument link liveLinkOf must find').not.toBeNull();
      expect(live!.href).toMatch(/^\/app\/[a-z0-9-]+\.html/);
      found++;
    }
    expect(found).toBeGreaterThanOrEqual(1); // the sea, the cards, the draw and others already stand
  });
});

describe('THE MAP ROOM — the instrument travels with its chart', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'spatial/app/luminara-map-room.html'), 'utf-8');

  test('downloading a chart also bundles every instrument it links', () => {
    expect(SRC).toContain('bundleInstrument');
    expect(SRC).toContain('instrumentsIn');
    // the md download is still the charter's own act, and still happens first
    expect(SRC).toContain("downloadText(currentEntry.slug + '.md', text)");
  });

  test('the copy is self-contained: modules inlined, nothing left to fetch', () => {
    // a bare copy would import /app/*.js from a server that is not there and
    // arrive broken, which is worse than not arriving
    expect(SRC).toContain('data:text/javascript;base64,');
    expect(SRC).toContain('SELF-CONTAINED COPY');
  });

  test('modules are inlined per-module, never concatenated', () => {
    // the canon's modules privately reuse names, so concatenation collides;
    // this test IS that fact, so it fails loudly if the modules ever diverge
    const names = new Map<string, string[]>();
    for (const m of ['luminara-canon', 'luminara-cube', 'luminara-knots',
      'luminara-cymatics', 'luminara-sound']) {
      const src = fs.readFileSync(path.join(ROOT, 'spatial/app/' + m + '.js'), 'utf-8');
      for (const mm of src.matchAll(/^(?:const|function|let)\s+([a-zA-Z_$][\w$]*)/gm)) {
        const list = names.get(mm[1]) ?? [];
        list.push(m);
        names.set(mm[1], list);
      }
    }
    const collisions = [...names.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);
    expect(collisions.length).toBeGreaterThan(0);   // gcd, PHI, hashSeed, signOf, sfc
    // so the bundler must give each module its own scope
    expect(SRC).toContain('inlineModule');
  });

  test('every chart that links an instrument links one that exists', () => {
    const roomDir = path.join(ROOT, 'docs', 'map-room');
    const charts = fs.readdirSync(roomDir).filter((f) => f.endsWith('.md'));
    let checked = 0;
    for (const f of charts) {
      const text = fs.readFileSync(path.join(roomDir, f), 'utf-8');
      for (const m of text.matchAll(/\/app\/(luminara-[a-z0-9-]+\.html)/g)) {
        const abs = path.join(ROOT, 'spatial/app', m[1]);
        expect(fs.existsSync(abs), f + ' links a missing instrument: ' + m[1]).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});
