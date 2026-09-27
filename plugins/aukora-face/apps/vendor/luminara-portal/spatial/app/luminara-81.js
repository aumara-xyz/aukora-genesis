// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE 81: the merged corpus and the reading engine.
//
// 27 cards × 3 positions = 81 position texts, each in five voices:
//   f  THE FIGURE       · the deck speaks its own geometry
//   c  THE CROSSING     · the human register: world, between, heart
//   w  WITH THE FLOW    · the cleanest slope: describes the walk, never the walker
//   a  AGAINST THE FLOW · the shadow, and the carry's address
//   q  THE QUESTION     · ends in agency, always
//
// The engine COMPOSES; it never interprets, predicts, or judges character
// (Interpreter's Law). Everything it adds beyond the corpus is derivable from
// the sealed canon: codes, intervals, counters, becomings, houses. This corpus
// is PRE-DISTILLATION: the bench exists so the reduce can be run against
// live casts. Texts change only by the distillation protocol, not in passing.

import { AUM_81 } from './luminara-81-aum.js';
import { MA_81 } from './luminara-81-ma.js';
import { RA_81 } from './luminara-81-ra.js';
import {
  POSITIONS, SUITS, STATES, LAYERS, cardOf, codeOf, codeMarks, isSilent, SILENCES,
  knotOf, counterOf, becomingOf, changingLayers,
  WIDE, drawWide, descend, DESCENT_LIMIT, TIME_WORDS, DEPTH_WORDS, drawOne,
} from './luminara-canon.js';

export const THE_81 = { ...AUM_81, ...MA_81, ...RA_81 };

// THE CROSSING LEADS (the architect's word, 11 August 2026). It stood second
// behind the Figure from the first pressing, and the reorder is not cosmetic:
// the Crossing is the human register and the Figure is the deck's geometry,
// and a reading that opens with geometry greets a person with a diagram. The
// person comes first; the deck explains itself after. Every surface renders
// through this one array, so the order changes here and nowhere else.
export const VOICES = [
  { key: 'c', name: 'The Crossing', register: 'the human register: world, between, heart' },
  { key: 'f', name: 'The Figure', register: 'the deck speaks its own geometry' },
  { key: 'w', name: 'With the Flow', register: 'the cleanest slope: the walk, never the walker' },
  { key: 'a', name: 'Against the Flow', register: 'the shadow, and where the carry lands' },
  { key: 'q', name: 'The Question', register: 'ends in agency: always yours to answer or decline' },
];

// THE DEPTH WALK, derived and never authored. A card's three digits ARE the
// three depths' states (codeOf: [world, between, heart], each 0 still, 1
// flowing, 2 turning), and for a long while the crossing texts opened by
// restating them in prose: fifty-one of the eighty-one began with some form
// of "the between turns and the heart turns while the world flows", which
// reads as repetition because it is one fact said three ways by hand. The
// walk now has one home. It is derived from the code, worded once, and shown
// with the Figure, which is where structural information belongs; the
// crossing is freed to speak to the person. The marks in the section head
// say the same thing in symbols, and the two cannot disagree because both
// are read off codeOf.
const WALK_WORDS = ['holds still', 'flows', 'turns'];
const WALK_LAYERS = ['the world', 'the between', 'the heart'];
export function depthWalkOf(n) {
  const d = codeOf(n);
  // one state across all three is said once, not three times
  if (d[0] === d[1] && d[1] === d[2]) {
    return d[0] === 0 ? 'world, between and heart all hold still'
      : 'world, between and heart all ' + (d[0] === 1 ? 'flow' : 'turn');
  }
  return d.map((s, i) => WALK_LAYERS[i] + ' ' + WALK_WORDS[s]).join(' · ');
}

// position index (Trefoil/Genus/Phi) → the corpus tense. The three motions
// worn by time: root is held, present is live, becoming is turned forward.
export const POSITION_TENSE = ['root', 'present', 'becoming'];

export const textOf = (n, posIndex) => THE_81[n][POSITION_TENSE[posIndex]];

// ---------------------------------------------------------------------------
// The threads: the spaces between the three cards of a cast. Every thread is
// derivable (canon arithmetic), stated in deck register, and descriptive only.
// ---------------------------------------------------------------------------
const houseOf = (n) => SUITS[codeOf(n)[0]];

export function threadsOf(cast) {
  const threads = [];
  const posName = (i) => POSITIONS[i].name;
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      const a = cast[i], b = cast[j];
      if (counterOf(a) === b) {
        threads.push({
          kind: 'dyad', between: [i, j],
          line: `${cardOf(a).name} and ${cardOf(b).name} are answers to each other: together they sum to the Seed. ${posName(i)} and ${posName(j)} are one conversation here.`,
        });
      }
      if (becomingOf(a) === b) {
        threads.push({
          kind: 'becoming', between: [i, j],
          line: `${cardOf(a).name}'s turning marks resolve into ${cardOf(b).name}: what stands at ${posName(i)} is already becoming what stands at ${posName(j)}.`,
        });
      } else if (becomingOf(b) === a) {
        threads.push({
          kind: 'becoming', between: [i, j],
          line: `${cardOf(b).name}'s turning marks resolve into ${cardOf(a).name}: what stands at ${posName(j)} is already becoming what stands at ${posName(i)}.`,
        });
      }
      if (counterOf(a) !== b && knotOf(a).interval === knotOf(b).interval) {
        threads.push({
          kind: 'weather', between: [i, j],
          line: `${cardOf(a).name} and ${cardOf(b).name} share one weather (${knotOf(a).interval}): the same interval heard at two stations.`,
        });
      }
    }
  }
  const houses = new Set(cast.map((n) => codeOf(n)[0]));
  if (cast.length === 3 && houses.size === 1) {
    const h = houseOf(cast[0]);
    threads.push({ kind: 'house', between: [0, 1, 2], line: `All three rise from one house, ${h.key}: ${h.gloss}. The whole cast speaks in a single register.` });
  }
  if (cast.length === 3 && houses.size === 3) {
    threads.push({ kind: 'house', between: [0, 1, 2], line: `The three houses stand complete: one card from each region of the line. The cast spans the deck's whole breadth.` });
  }
  return threads;
}

// ---------------------------------------------------------------------------
// readingOf: the full five-voice reading for a cast of three.
// Returns structure; rendering belongs to the surface that asked.
// ---------------------------------------------------------------------------
export function readingOf(cast) {
  const sections = cast.map((n, i) => {
    const card = cardOf(n), k = knotOf(n), bec = becomingOf(n);
    return {
      n,
      name: card.name,
      position: POSITIONS[i],
      tense: POSITION_TENSE[i],
      silent: isSilent(n),
      ask: isSilent(n) ? SILENCES[n].asks : null,
      marks: codeMarks(n),
      interval: k.interval,
      house: houseOf(n).key,
      counter: { n: counterOf(n), name: cardOf(counterOf(n)).name },
      becoming: bec === null
        ? { settled: true }
        : { settled: false, n: bec, name: cardOf(bec).name, layers: changingLayers(n) },
      voices: textOf(n, i),
    };
  });
  const whole = `From ${sections[0].name}, through ${sections[1].name}, toward ${sections[2].name}.`;
  return { cast: [...cast], sections, threads: threadsOf(cast), whole };
}

// ---------------------------------------------------------------------------
// THE WIDE AND THE DEEP (canon D28), composed with the corpus. Both draws are
// the canon's own (drawWide / descend, seeded from the cast's seed), so a
// journaled widening or descent replays identically on every surface: the
// bench and the vessel land the same cards from the same seed. The engine
// only adds the corpus's voice: each cell speaks its column's tense.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE STATION TEXTS: the meanings layer of the frame itself (the calendar
// lane, 2026-07-17). The cells needed voices of their own: not what a card
// means, but what a STATION asks of any card standing in it. Nine crossings
// (time × depth) are authored; three state-inflections compose them into
// all twenty-seven, the differential discipline: author the components,
// derive the whole. Form law (learned from the finger-count traditions,
// credited, worded in our own tongue): short, decisive, weather-like,
// composable with any landing. Every station ends by handing the work to
// the card ('a card standing here names…'), never to fate.
// ---------------------------------------------------------------------------
export const STATION_TEXTS = {
  'trefoil-field': 'The ground the question was already standing on when it arrived: circumstance set before anyone chose. A card standing here names what the ground is made of.',
  'trefoil-middle': 'The old agreements: bonds, debts, and understandings that predate this moment and still hold their shape. A card standing here names the relationship everything rests on.',
  'trefoil-core': 'The taproot: what was planted in the core long before the question formed. A card standing here names the commitment underneath everything, the one found last.',
  'genus-field': 'The weather actually outside the window: what circumstance is doing this hour, as against what it threatens or promises. A card standing here names the live condition.',
  'genus-middle': 'The exchange as it stands: what is actually passing, or refusing to pass, between the people in the question. A card standing here names the live current of the bond.',
  'genus-core': 'The pulse under the surface: what the core is doing while the outer story talks. A card standing here names the feeling beneath the feeling.',
  'phi-field': 'Where circumstance is leaning: the shape the outer world makes as it turns. Trajectory, never verdict: a card standing here names what the conditions are becoming.',
  'phi-middle': 'The bond’s forward edge: what is being rewoven, or unwoven, between. A card standing here names what the relation is turning into.',
  'phi-core': 'The seed of the next self: what the deepest layer is quietly turning toward. A card standing here names what is being asked of the core, never demanded of it.',
};
export const STATE_INFLECTIONS = [
  'Here in its still aspect, read the card as what stands: what holds, waits, or refuses to move.',
  'Here in its flowing aspect, read the card as what moves: what runs, carries, and spends.',
  'Here in its turning aspect, read the card as what changes: mid-transformation, neither held nor yet landed.',
];
// the station's voice at any resolution: crossing alone at the 9,
// crossing inflected by state at the 27
export function stationTextOf(timeIdx, depthIdx, stateIdx = null) {
  const key = POSITIONS[timeIdx].key + '-' + LAYERS[depthIdx];
  const crossing = STATION_TEXTS[key];
  return stateIdx === null ? crossing : crossing + ' ' + STATE_INFLECTIONS[stateIdx];
}

// The nine cells: time × depth, refining a standing cast, never replacing it.
export function wideReadingOf(castSeed, cast) {
  const nine = drawWide(castSeed, cast);
  const cells = nine.map((n, i) => {
    const w = WIDE[i];
    return {
      key: w.key,
      time: w.time,
      depth: w.depth,
      gloss: w.gloss,
      affinity: w.affinity,
      station: stationTextOf(w.affinity.time, w.affinity.depth),
      n,
      name: cardOf(n).name,
      marks: codeMarks(n),
      silent: isSilent(n),
      ask: isSilent(n) ? SILENCES[n].asks : null,
      // the cell speaks its column's tense: the corpus question travels
      question: textOf(n, w.affinity.time).q,
    };
  });
  return {
    cells,
    law: 'The coarse reading stands; the nine cells refine it, never replace it.',
  };
}

// ---------------------------------------------------------------------------
// THE UNFOLDING (SEALED by the architect, 2026-07-16: the reading of 27,
// the Wayfinder's deepest stop). The spread ladder's third rung: crossing time × depth × STATE (the deck's
// first trinity: still, flowing, turning) yields the twenty-seven cells.
// The forcing is the grammar's own: the cast and the wide have committed
// twelve cards, which cannot fill twenty-seven cells, so the finest scale
// obeys the descent's law instead: THE FULL DECK RETURNS. Twenty-seven
// draws without replacement place every card exactly once: the complete
// reading is a permutation of the whole deck onto the crossing. The
// coarser readings stand; the unfolding refines them, never replaces.
// One instrument: 3, 9, 27; one seed, three resolutions.
// ---------------------------------------------------------------------------
export const STATE_WORDS = ['the stillness', 'the flow', 'the turning'];

export function unfoldedReadingOf(castSeed) {
  const cells = [];
  const placed = [];
  let i = 0;
  for (let t = 0; t < 3; t++) {
    for (let d = 0; d < 3; d++) {
      for (let s = 0; s < 3; s++) {
        const n = drawOne(String(castSeed) + '|u' + (i + 1), placed);
        placed.push(n);
        cells.push({
          key: POSITIONS[t].key + '-' + LAYERS[d] + '-' + STATES[s],
          time: POSITIONS[t].key,
          depth: LAYERS[d],
          state: STATES[s],
          gloss: STATE_WORDS[s] + ' of ' + DEPTH_WORDS[d] + ' of ' + TIME_WORDS[POSITIONS[t].key],
          affinity: { time: t, depth: d, state: s },
          station: stationTextOf(t, d, s),
          n,
          name: cardOf(n).name,
          marks: codeMarks(n),
          silent: isSilent(n),
          ask: isSilent(n) ? SILENCES[n].asks : null,
          question: textOf(n, t).q,
        });
        i++;
      }
    }
  }
  return {
    cells,
    law: 'The whole deck unfolds: every card exactly once, the complete map at the finest grain. The coarser readings stand.',
  };
}

// One step of the descent: within the card at a position, the full deck
// returns at the next scale. The chain is the portal's own ([outer card,
// ...prior inner cards]); the inner card is read at the SAME tense: the
// fractal: finer grain of the same moment. The outer card stands.
export function descentReadingOf(castSeed, cast, posIndex, priorPath) {
  if (priorPath.length >= DESCENT_LIMIT) return null;
  const chain = [cast[posIndex], ...priorPath];
  const n = descend(castSeed, chain);
  return {
    n,
    name: cardOf(n).name,
    marks: codeMarks(n),
    silent: isSilent(n),
    ask: isSilent(n) ? SILENCES[n].asks : null,
    within: cardOf(chain[chain.length - 1]).name,
    level: priorPath.length + 1,
    voices: textOf(n, posIndex),
    path: [...priorPath, n],
  };
}
