// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE MAP ROOM'S LENS: a small resident markdown renderer (the schematic's
// piece 4, docs/LUMINARA_MAP_ROOM.md). It exists so the room stays whole
// offline and the rendering can never drift with a third party.
//
// THE LENS'S OWN LAW: escape first, markup second. Chart content is HTML-
// escaped in full before any markup is applied, so a chart can never inject
// behaviour into the room; links are allowed only to the open web (http/https,
// opened in their own tab), the served archive (/docs/...), the instruments
// (/app/...), and the room's own addresses (#/...). Anything else renders as
// plain text. No scripts pass through here in any direction.
//
// THE INSTRUMENTS WERE ADDED at the architect's word, 19 July 2026. The room
// had described itself as texts only, and a chart about an instrument could
// name its address but not open it. That is now a door: a chart may point at
// the surface it describes. What did NOT change is the thing the old wording
// was actually protecting. The room still reads nothing, draws nothing and
// casts nothing; it imports no engine, holds no seed, and a link is a
// signpost, not a hand. Pointing at an instrument is not operating one. The
// allowlist stays an allowlist, so every scheme outside these four remains
// words.
//
// THE FIGURES: a chart may call a figure by name on its own line
// (::figure key::). Only the resident illustrator's whitelisted, computed
// figures render (map-room-figures.js: pure geometry, the renderer's metals,
// never the engine); an unknown name remains words. The lens still draws
// nothing itself: it admits only what the illustrator can prove.
//
// Coverage: headings 1-4, paragraphs, emphasis, strong, inline code, fenced
// code blocks, unordered and ordered lists, blockquotes, rules, links, pipe
// tables, figure directives. Enough for the charts; nothing speculative.

import { renderFigure } from './map-room-figures.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, href) => {
    if (/^https?:\/\//.test(href)) return '<a href="' + href + '" target="_blank" rel="noopener">' + txt + '</a>';
    if (/^(\/docs\/|\/app\/|#)/.test(href)) return '<a href="' + href + '">' + txt + '</a>';
    return txt; // any other scheme stays words
  });
  return t;
}

const cellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function table(rows) {
  let header = null;
  let body = rows;
  if (rows.length > 1 && /^[\s|:-]+$/.test(rows[1]) && rows[1].includes('-')) {
    header = cellsOf(rows[0]);
    body = rows.slice(2);
  }
  let h = '<table>';
  if (header) h += '<thead><tr>' + header.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>';
  h += '<tbody>' + body.map((r) => '<tr>' + cellsOf(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  return h;
}

// THE LIVE LINK: if a chart's own markdown points at an instrument
// (/app/...) anywhere in its text, this names that link so the room can
// surface it at the top of the chart rather than leaving it buried
// wherever the prose happened to place it. Derived from the chart's own
// words, never a second registry to keep in step with the text.
export function liveLinkOf(src) {
  const m = String(src).match(/\[([^\]]+)\]\((\/app\/[^)\s]+)\)/);
  return m ? { text: m[1], href: m[2] } : null;
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  let quote = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => {
    if (list) {
      out.push('<' + list.tag + '>' + list.items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + list.tag + '>');
      list = null;
    }
  };
  const flushQuote = () => { if (quote.length) { out.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>'); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushAll();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence (or end of file)
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    i++;
    if (/^\s*$/.test(line)) { flushAll(); continue; }
    const fig = line.match(/^::figure\s+([a-z0-9-]+)::\s*$/);
    if (fig) {
      flushAll();
      const drawn = renderFigure(fig[1]);
      out.push(drawn !== null ? drawn : '<p>' + inline(line) + '</p>'); // unknown names stay words
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushAll(); const n = h[1].length; out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>'); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    if (/^\s*\|/.test(line)) {
      flushAll();
      const rows = [line];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      out.push(table(rows));
      continue;
    }
    const item = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      flushQuote();
      const tag = /^\s*[-*]/.test(line) ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(item[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return out.join('\n');
}
