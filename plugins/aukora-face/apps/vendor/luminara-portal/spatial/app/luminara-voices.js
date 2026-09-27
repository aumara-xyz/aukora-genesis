// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE FIVE VOICES, RENDERED — one shared renderer for a reading section,
// extracted at the merge of 18 July 2026 when the guide moved from the
// Wayfinder to the Astrolabe and the cast kept reading. Both surfaces render
// a section through this one function, so the voices can never drift between
// the rite and the guide. The classes it emits (.pos, .poshead, .voice …)
// are styled by each page that uses it.
import { VOICES, depthWalkOf } from './luminara-81.js';

export function voicesHtml(section) {
  const v = section.voices;
  // the depth walk stands directly after the ternary marks (the architect's
  // word, 11 August 2026): the marks say the three digits in symbols and the
  // walk says the same digits in words, so they read as one fact in two
  // scripts rather than as a fact and a caption in different rooms. It left
  // the Figure's block the same day it had arrived there.
  const walk = '<span class="mwalk">' + depthWalkOf(section.n) + '</span>';
  const head =
    '<div class="poshead">' +
      '<span class="pname">' + section.position.name.toUpperCase() + '</span>' +
      '<span class="cname">' + section.name + '</span>' +
      '<span class="meta">' + section.marks + ' · ' + walk + ' · ' + section.interval + ' · ' + section.house +
        ' · answers ' + section.counter.name +
        (section.becoming.settled ? ' · settled' : ' · becoming ' + section.becoming.name) + '</span>' +
      (section.silent ? '<span class="silent-flag">A SILENCE · ASKS FOR ' + section.ask.toUpperCase() + '</span>' : '') +
    '</div>';
  const body = VOICES.map((voice) =>
    '<div class="voice ' + (voice.key === 'q' ? 'q' : '') + '">' +
      '<div class="vname">' + voice.name.toUpperCase() + ' · <span style="letter-spacing:0.05em">' + voice.register + '</span></div>' +
      '<div class="vtext">' + v[voice.key] + '</div>' +
    '</div>').join('');
  return '<section class="pos">' + head + body + '</section>';
}
