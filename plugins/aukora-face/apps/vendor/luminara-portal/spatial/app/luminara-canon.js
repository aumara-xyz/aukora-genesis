// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// AUMA LUMINARA: canon data + reading engine (pure module, no DOM, no imports).
//
// Source of truth: AUMA_LUMINARA_MASTER_REFERENCE.md (D1–D18) + LUMINARA_SYSTEM_SPEC_v1.
// The system is ONE OBJECT: 3 states x 3 layers = 27 codes = 23 letters + 4 silences
// = 27 cards in three suits of nine (AUM the Bulk / MA the Splitter / RA the Surface).
// Card n = 9*L3 + 3*L2 + L1 + 1 (states valued still=0, moving=1, turning=2; inner
// layer fastest). The deck counts 0..26 in ternary; suit changes are the carries;
// The Return (~~~) + 1 rolls over to The Seed (...). The torus closes by counting.
//
// This module renders NOTHING and awards NOTHING: it is data plus pure functions,
// kept import-free so core/tests can exercise it directly. The organ (luminara.js)
// owns the DOM, the ritual, and the single REQ-L1 award call.

// ---------------------------------------------------------------------------
// THE FIRST NAMES (canon D29, channelled and sealed by the architect,
// 2026-07-16: "Save the laws"). The canon's preamble: nine laws of safety,
// named before any card is named, standing first in the file because they
// stand first in authority.
//
// PRECEDENCE: THE FIRST NAMES OUTRANK ALL LATER CANON. When any card, law,
// rite, or surface conflicts with a First Name, the Name wins.
//
// LINEAGE: these laws are learned from Sufi teaching: received as teaching,
// credited to the well, and named in Luminara's own tongue. The sacred
// vocabulary of the source is deliberately not carried into a card oracle
// (the junzi precedent: technique transfers; the words stay home).
//
// FORM: each name binds four bodies: the name, the teaching, the law, the
// pin. A name without enforcement is decoration: the pins live in
// core/tests/firstNames.test.ts, and what cannot yet be a test is a GATE
// every reading-surface change must answer before it lands.
// ---------------------------------------------------------------------------
export const FIRST_NAMES_PRECEDENCE = 'THE FIRST NAMES OUTRANK ALL LATER CANON.';
export const FIRST_NAMES = [
  {
    name: 'MERCY',
    teaching: 'Learned from the teaching that mercy is invoked before every act, not one virtue among many but the precondition of all of them.',
    law: 'Mercy precedes law: when a person’s need and the canon’s rule pull apart, the person wins. Every surface, no exceptions.',
    pin: 'The crisis-read of the 81 is MERCY’s first act; the vessel’s crisis path may override any reading composition; every new reading surface answers “where does MERCY interrupt?” before it lands.',
  },
  {
    name: 'COURTESY',
    teaching: 'Learned from the teaching that right manner is the soul of method: the path is walked as much in how a thing is done as in what is done.',
    law: 'The manner is a safety property: how the instrument refuses, falls silent, and asks.',
    pin: 'The corpus manner pins are COURTESY’s body: no second-person commands outside the Silences, every question ends in agency, the Silences ask rather than tell.',
  },
  {
    name: 'CANDOUR',
    teaching: 'Learned from the sober school: ecstasy is not the goal: the return from it, intact and clear-eyed, is. No wonder without its workings shown.',
    law: 'Every enchantment shows its workings: seeds declared, composed never presented as drawn.',
    pin: 'Every cast surface declares its seed and carries the sober register line; browse and every composed view is marked composed, never drawn.',
  },
  {
    name: 'WEATHER',
    teaching: 'Learned from the teaching that states are passing gifts and stations are earned ground, and that mistaking one for the other is the path’s oldest injury.',
    law: 'A reading is weather, never climate: states are not stations, and no soul-profile is ever assembled from casts.',
    pin: 'Reading composition is pure and stateless: the engine persists nothing; no API may accumulate casts into traits or a model of the person.',
  },
  {
    name: 'HOMECOMING',
    teaching: 'Learned from the teaching that dissolution without return is not depth but loss: the journey is completed by the coming back.',
    law: 'Every descent ends with the way home lit: no one is left at the bottom of a reading.',
    pin: 'The stands-laws are pinned: the coarser readings always stand, descents are bounded at three, and the dial always walks back down.',
  },
  {
    name: 'EMPTINESS',
    teaching: 'Learned from the empty niche: it holds nothing, and its whole function is to orient beyond itself. The moment the niche is worshipped, the house has failed.',
    law: 'The niche holds nothing: the instrument points beyond itself, succeeds when needed less, never optimises for engagement, never pays for depth.',
    pin: 'No engagement machinery on reading surfaces: no streaks, scores, or counters of casts; rewards stay numberless (a standing gate on the vessel).',
  },
  {
    name: 'PRIVACY',
    teaching: 'Learned from the teaching of the innermost secret: there is a chamber of the heart that is nobody’s to read.',
    law: 'What is whispered at the niche is not data: intentions and journals belong to the querent alone, unmined forever.',
    pin: 'Reading surfaces make no network calls with reading content; intentions and journals remain the querent’s property (a standing gate on every lane).',
  },
  {
    name: 'DAYLIGHT',
    teaching: 'Learned from the teaching to act as though seen even when unseen: witnessedness as a posture, not a surveillance.',
    law: 'Everything done as if seen: auditable, pinned, the chance witnessable.',
    pin: 'Chance is witnessable and replayable: declared seeds on every surface; every law of this canon is enforced as tests, never held as promises.',
  },
  {
    name: 'COMPANIONSHIP',
    teaching: 'Learned from the warning that the path is dangerous travelled alone, and from its corollary: nothing that is not a soul may claim to guide one.',
    law: 'Auma is a companion, never a guide of souls: the limits of machine guidance are spoken aloud, and strong medicine travels only with the crisis-aware vessel.',
    pin: 'The deep surfaces (the 27, the descents) front to the public only through the crisis-aware vessel, which names the limits of machine guidance (a standing gate on the portal lane).',
  },
];

export const STATES = ['still', 'moving', 'turning'];       // Somni · Dona · Lumira
export const MARKS = ['●', '—', '~'];              // the dot, the bar, the wave
export const LAYERS = ['field', 'middle', 'core'];           // L3 outer · L2 relational · L1 essential
export const SUITS = [
  { key: 'AUM', gloss: 'the bulk: what could be' },
  { key: 'MA', gloss: 'the splitter: what cuts' },
  { key: 'RA', gloss: 'the surface: what radiates' },
];

// digits of card n (1..27): [L3, L2, L1], each 0 still / 1 moving / 2 turning.
export function codeOf(n) {
  const v = n - 1;
  return [Math.floor(v / 9), Math.floor((v % 9) / 3), v % 3];
}
export const codeMarks = (n) => codeOf(n).map((d) => MARKS[d]).join(' ');

// The becoming: native changing lines. A card's turning marks (~) ARE its
// changing lines. Resolve them (~ → ●: a turn completing into new stillness)
// to find the card it is settling into. A card with no ~ is settled: no
// becoming (returns null). The rule reproduces the deck's own cycle: The Return
// (~~~) becomes The Seed (●●●), the torus closing inside a single glyph.
export function becomingOf(n) {
  const d = codeOf(n);
  if (!d.includes(2)) return null; // no changing lines: settled
  const b = d.map((x) => (x === 2 ? 0 : x));
  return 9 * b[0] + 3 * b[1] + b[2] + 1;
}
// which layers are turning (changing), field → core
export const changingLayers = (n) => LAYERS.filter((_, i) => codeOf(n)[i] === 2);

// ---------------------------------------------------------------------------
// THE KNOT MAP: the cards as golden torus knots (redesign arc, the architect's
// seals of 2026-07-12). Two registers, kept distinct BY LAW:
//
//   q IS THE LAW. With flow = +1, turning = −1, still = 0 under the bijection's
//   own weights (field 9 · relation 3 · core 1), the signed sum q is BALANCED
//   TERNARY: every integer in [−13, +13] exactly once. Collision-free by the
//   theorem of the numeral system, never by tuning. The deck is the signed
//   number line; the Seed is zero; the counter-card is arithmetic negation
//   (the deck's native Concordance of Opposites, canon D25).
//
//   p IS THE VOICE. Balanced ternary is unique, so q alone determines the card:
//   p carries no identity and is presentation, chosen by the sealed TEMPERED
//   RULE (redoubling form, the architect's correction 2026-07-12 for
//   definition): "q carries the weight; p carries the count. While any layer
//   holds still, each moving layer winds once. When the last stillness leaves,
//   the windings redouble." (p = 1 + movingCount with any stillness; p = 7 for
//   the restless eight.) Under it the trefoil arrives fourfold in AUM: The
//   Knot's essence line is literally true: three link-dyads bind (Labyrinth/
//   Mask, Surgeon/Witness, and Void/Spectrum as seven plain rings, T(7,±7)),
//   and the petal count |q| stays fully legible at half the strand density.
//
// Named shadow (Law 4 / D25): a presentation rule that needs a story can drift
// into one that needs excuses: the golden vectors in the tests pin both rules
// so any drift breaks loudly. Letter-free by construction: the letter map stays
// a key in Lonnie's hand, and these shapes are committed first.
// ---------------------------------------------------------------------------
const KNOT_W = [9, 3, 1]; // the bijection's own weights: field, relation, core
const signOf = (s) => (s === 1 ? 1 : s === 2 ? -1 : 0);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// the counter-card, the deck's involution: layerwise mod-3 negation; the one
// card whose meeting with n sums to The Seed. The Seed alone is self-paired.
export const counterOf = (n) => {
  const d = codeOf(n).map((s) => (3 - s) % 3);
  return 9 * d[0] + 3 * d[1] + d[2] + 1;
};
export function knotOf(n) {
  const d = codeOf(n);
  let q = 0, moving = 0;
  for (let i = 0; i < 3; i++) {
    const s = signOf(d[i]);
    q += KNOT_W[i] * s;
    if (s !== 0) moving++;
  }
  const p = moving === 3 ? 1 + 2 * moving : 1 + moving; // the tempered rule, redoubling form
  const aq = Math.abs(q);
  const components = q === 0 ? 1 : gcd(p, aq);
  const kind = q === 0 ? 'circle' : (aq === 1 || p === 1) ? 'coil'
    : components > 1 ? 'link' : 'knot';
  const genus = kind === 'knot' ? (p - 1) * (aq - 1) / 2 : 0;
  return {
    p, q, kind, components, genus,
    hand: q > 0 ? 'flow' : q < 0 ? 'turning' : 'still',
    interval: intervalOf(p, q),
  };
}

// THE HARMONIC LAW (canon D26, sealed 2026-07-12): every card is an interval:
// its two winding frequencies, |q| through against p around, sound a musical
// ratio. Derived, never stored. THE RESONANCE-LOCK LAW: when the ratio reduces
// (gcd > 1), the strand closes early into separate rings: the link-cards are
// the perfect consonances compounded ("a harmony so complete, the strand no
// longer needs to be one"). Every becoming is a cadence toward consonance.
//
// THE SHADOW-LAW (canon D26, "1 dissolves into 12"): no shadow-texts are
// authored, because the deck writes its own. Every card's exact opposite is
// its counter-card (D25, structural); and the failure-mode register is one
// law: A CARD READ ALONE IS ITS OWN SHADOW: the interval refusing its
// cadence, the knot with half a boundary, the carry it mints if unmet.
const INTERVALS = {
  '0:1': 'silence',
  '1:2': 'the octave',
  '3:2': 'the perfect fifth', '2:3': 'the perfect fifth',
  '4:3': 'the perfect fourth',
  '9:2': 'the tone, twice raised',
  '10:3': 'the sixth beyond the octave',
  '8:3': 'the eleventh',
  '5:7': 'the tritone',
  '11:7': 'the alien interval',
  '13:7': 'the far dissonance',
  '2:1': 'the octave, locked',
  '4:1': 'the double octave, locked',
  '1:1': 'the unison, locked',
};
function intervalOf(p, q) {
  const aq = Math.abs(q);
  if (aq === 0) return INTERVALS['0:1'];
  const g = gcd(p, aq);
  return INTERVALS[(aq / g) + ':' + (p / g)] || (aq + ':' + p);
}

// ---------------------------------------------------------------------------
// THE EMANATION GROUND (D16–D18 enacted; a SEAT, not yet the engine): the
// cymatic figure that stands behind each knot. Canon here is the DERIVATION
// only: zones are the layers centre-out (core innermost), each zone's mode
// is its state's harmonic on the 3·6·9 ladder (still 3 · moving 6 · turning
// 9), and CLARITY is the interval's consonance (the ground's reading of D26):
// clarity = 2 / (q̂ + p̂) of the reduced ratio, clamped to 1: the locked
// consonances ring crisp and closed, the far dissonances scatter the rim.
// The Seed alone is unstruck: silence, the membrane before any mode.
// By the architect's ruling (2026-07-12) the cards carry NO rendering of
// this contract for now: the knots speak for themselves. The derivation
// stays pinned as the SEAT for the cymatics engine, which will be its
// first renderer and consumes it unchanged.
export function emanationOf(n) {
  const d = codeOf(n);
  const zones = [2, 1, 0].map((i, ring) => ({
    layer: LAYERS[i],           // core · middle · field, centre-out
    ring: ring + 1,
    harmonic: 3 * (d[i] + 1),   // the 3·6·9 ladder: still 3 · moving 6 · turning 9
  }));
  const { p, q } = knotOf(n);
  const aq = Math.abs(q);
  const g = aq === 0 ? 1 : gcd(p, aq);
  const clarity = aq === 0 ? 1 : Math.min(1, 2 / (aq / g + p / g));
  return { zones, clarity, struck: aq !== 0 };
}

// The 27: the HARMONIC ESSENCES (canon D26, ratified 2026-07-12; supersede
// the master reference §4 texts, which refresh at book pressing). Each weaves
// the original meaning with the card's interval, form, counter, and becoming.
// Letters per the locked letter map (D10–D12): Lonnie-gated placeholders.
// Silences per D14.
export const CARDS = [
  { n: 1, name: 'The Seed', letter: 'I', essence: 'Silence itself: the unstruck string, the zero every dyad sums to. Pure undifferentiated potential: the point before extension. Nothing to resolve; everything resolves to it.' },
  { n: 2, name: 'The Drift', letter: 'P', essence: 'The octave, sounded once. First asymmetry: something stirs one octave above stillness: the most consonant motion possible, still open, not yet locked. It meets The Fold in the Seed.' },
  { n: 3, name: 'The Fold', letter: 'B', essence: 'The same octave, turned inward: potential curving back on itself. Its becoming is the Seed: the first return, the shortest cadence in the deck.' },
  { n: 4, name: 'The Resonance', letter: 'Z', essence: 'The perfect fifth. The first pattern that persists is the first true knot: a standing wave locked into form. A Silence, because the fifth needs no interpretation; it simply rings.' },
  { n: 5, name: 'The Depth', letter: 'V', essence: 'The perfect fourth, the interval of foundations. Dimensionality itself: the bulk acquires volume, the first knot deeper than the trefoil.' },
  { n: 6, name: 'The Saturation', letter: 'W', essence: 'The fifth in its compounded voicing: potential so dense it must express. Its becoming falls back into The Resonance: pressure resolving into the pure fifth it came from.' },
  { n: 7, name: 'The Dreamer', letter: 'U', essence: 'The perfect fifth in the left hand: latency personified, the bulk as if it had a face. The Resonance dreamt instead of rung; met, it settles into the Seed.' },
  { n: 8, name: 'The Knot', letter: 'F', essence: 'The trefoil appears here, literally. Potential topologically committed: the fifth’s inverted voice, the simplest structure that remembers. Its becoming loosens into The Drift.' },
  { n: 9, name: 'The Threshold', letter: 'M', essence: 'The fourth, turned: the last card before splitting. Its becoming is the Seed: the verge either resolves into silence or crosses into the blade.' },
  { n: 10, name: 'The Cut', letter: 'E', essence: 'First distinction: the whole tone raised two octaves: the sharpest single step, a nine-petaled silver blade. Inside and outside now exist. It meets The Ray in the Seed.' },
  { n: 11, name: 'The Mirror', letter: 'T', essence: 'The sixth beyond the octave: reflection in space. The cut creates two sides that reference each other. Its counter is The Echo: reflection in time.' },
  { n: 12, name: 'The Gate', letter: 'D', essence: 'The eleventh, the fourth widened across the octave: boundary as passage, not wall. Its becoming is The Cut: every gate remembers it began as an opening.' },
  { n: 13, name: 'The Surgeon', letter: 'A', essence: 'The double octave, locked: consonance so complete it closes into three bound rings: incision, operation, closure as one act. Its rings carry The Witness’s gold: intervention and presence are one dyad.' },
  { n: 14, name: 'The Scar', letter: 'S', essence: 'Thirteen against seven: the deepest dissonance the deck can sound, and its deepest weave. Where a cut healed but left the topology changed: genus increased to its maximum. It meets The Return in the Seed.' },
  { n: 15, name: 'The Twins', letter: 'L', essence: 'Eleven against seven, the alien interval: what was one is now two, and no simple ratio holds them. Its becoming is The Surgeon: bifurcation, attended, submits to the operation that binds.' },
  { n: 16, name: 'The Labyrinth', letter: 'C', essence: 'The octave compounded threefold and locked: corridors so self-similar they close into three separate circuits. Boundary become its own interior. A Silence; its becoming is The Cut: the maze resolved is one clean line.' },
  { n: 17, name: 'The Void', letter: 'R', essence: 'The sevenfold unison: seven rings sounding one tone, bound by nothing but the shared hole: absence itself does the binding. Its becoming is The Mirror: the void, faced, becomes reflection.' },
  { n: 18, name: 'The Bridge', letter: 'N', essence: 'The tritone: the interval that cannot rest, the unstable span that demands crossing. The cut that connects rather than separates. Its counter is The Beacon: the bridge and the light on the far shore.' },
  { n: 19, name: 'The Ray', letter: 'O', essence: 'The Cut’s tone, turned to gold: first emission, nine petals of light leaving the surface. Division’s mirror is radiance. Its becoming is the Seed: light, followed home, arrives at stillness.' },
  { n: 20, name: 'The Face', letter: 'K', essence: 'The eleventh, turning: the surface as identity, what is seen. The Gate’s counter: the door and the countenance. It settles into The Drift.' },
  { n: 21, name: 'The Echo', letter: 'G', essence: 'The Mirror’s interval in the turning hand: expression that returns: reflection in time. Its becoming is the Seed: every echo, followed to its end, is silence again.' },
  { n: 22, name: 'The Mask', letter: 'X', essence: 'The locked octave in gold: concealment in three closed circles. A Silence; its becoming is The Resonance: lift the mask and behind it stands the pure fifth, the true tone the surface protected.' },
  { n: 23, name: 'The Beacon', letter: 'H', essence: 'The tritone sustained in gold: a signal that persists because its interval cannot rest. Its becoming is The Depth: the sustained call, answered, becomes foundation.' },
  { n: 24, name: 'The Spectrum', letter: 'Y', essence: 'The sevenfold unison in gold: one source, seven rings: one topology, many readings, now literal. Its becoming is The Resonance: the many readings, resolved, agree on the fifth.' },
  { n: 25, name: 'The Witness', letter: 'Q', essence: 'The double octave locked in the turning hand: three silent rings of pure attention, carrying The Surgeon’s silver. RA turned inward. A Silence; its becoming is the Seed: complete witnessing ends in stillness, needing no word.' },
  { n: 26, name: 'The Crown', letter: 'SH', essence: 'Radiance at the alien interval: full expression in a ratio nothing simple can hold; that is what majesty is. The Twins’ counter: what was split, exalted. It settles into The Drift.' },
  { n: 27, name: 'The Return', letter: 'J', essence: 'The far dissonance in the turning hand, and the deck’s final cadence: its becoming is the Seed, the most dissonant interval closing all the way to silence. The surface curves back to meet the bulk; the torus closes; thirteen and minus-thirteen meet at zero.' },
];
export const cardOf = (n) => CARDS[n - 1];

// THE SILENCES (D14). A Silence is a drawable card that STOPS interpretation in
// its register and redirects (canon §6). Imperative voice.
//
// The genus is the stopping, not the lettering. An earlier wording defined a
// Silence as "a drawable card whose code carries no letter", welding two
// independent facts together: that a card refuses interpretation, and that its
// seat holds no letter. The weld is D14's ruling rather than an arithmetic
// consequence, and it is the reason a letter question can reach a reading
// surface at all. Under any grid where every code carries a letter, the
// stopping survives and the lettering does not, so the stopping is what the
// definition must name. See docs/map-room/THE_LETTERS_LEDGER.md §II.
//
// THE COUNT IS NEVER WRITTEN AS A NUMERAL. It is SILENCE_COUNT, below, derived
// from this map. Prose that must say the number aloud composes it through
// silenceTeaching(); tests assert laws that hold for any silence set, never a
// literal. core/tests/countHygiene.test.ts enforces both.
export const SILENCES = {
  4: {
    name: 'The Depths', asks: 'descent',
    lines: ['What holds this lies below where symbols operate.', 'Descend. Do not translate.', 'Sit at the bottom until it knows you.'],
  },
  16: {
    name: 'The Expanse', asks: 'expansion of the frame',
    lines: ['This opens wider than any frame you brought.', 'Do not shrink it to fit the question.', 'Widen. Then ask again, or do not.'],
  },
  22: {
    name: 'The Threshold', asks: 'surrender',
    lines: ['This is a crossing between orders.', 'The one who emerges is not yet the one asking.', 'Surrender. Interpretation ends here.'],
  },
  25: {
    name: 'The Return', asks: 'recognition',
    lines: ['You have been here before.', 'Be still. Recognize it. Do not rename it.', 'When you can say "I know this place," the reading finishes itself.'],
  },
};
export const isSilent = (n) => Object.prototype.hasOwnProperty.call(SILENCES, n);

// ---------------------------------------------------------------------------
// THE ONE DERIVATION POINT. Everything downstream that needs to know how many
// Silences there are, or where they sit, or how to say either aloud, reads it
// from here. Nothing counts them again by hand.
// ---------------------------------------------------------------------------
export const SILENCE_SEATS = Object.freeze(
  Object.keys(SILENCES).map(Number).sort((a, b) => a - b),
);
export const SILENCE_COUNT = SILENCE_SEATS.length;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four',
  'twenty-five', 'twenty-six', 'twenty-seven'];
const ORDINAL_WORDS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth',
  'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
  'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth',
  'twenty-sixth', 'twenty-seventh'];
export const numberWord = (k) => NUMBER_WORDS[k] ?? String(k);
export const ordinalWord = (k) => ORDINAL_WORDS[k] ?? String(k);
// "four, sixteen, twenty-two and twenty-five"
export const listWords = (ns, word = numberWord) => {
  const w = ns.map(word);
  return w.length <= 1 ? (w[0] ?? '')
    : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
};

// THE CANONICAL SILENCE TEACHING. Every surface that teaches the Silences in
// prose composes it here rather than writing the sentences out, so the count,
// the seats and the asks can never drift from the map above. Capitalised at
// the sentence head by the caller if needed.
export function silenceTeaching() {
  const seats = SILENCE_SEATS;
  const asks = seats.map((n) => SILENCES[n].asks + ' at the ' + ordinalWord(n) + ' seat');
  return numberWord(SILENCE_COUNT).replace(/^./, (c) => c.toUpperCase())
    + ' of the ' + numberWord(CARDS.length) + ' are Silences. '
    + 'They are seated at ' + listWords(seats) + '. '
    + 'A Silence stops interpretation in its register and asks instead: '
    + listWords(asks, (s) => s) + '.';
}

// The reading frame (D9): three invariant POSITIONS: never drawn, never shuffled.
export const POSITIONS = [
  { key: 'trefoil', name: 'Trefoil', gloss: 'what is knotted in: what cannot be undone', affinity: 0 },
  { key: 'genus', name: 'Genus', gloss: 'the live cut of the present', affinity: 1 },
  { key: 'phi', name: 'Phi', gloss: 'what draws forward: trajectory, never prediction', affinity: 2 },
];

// ---------------------------------------------------------------------------
// THE SPREAD LADDER AND THE DESCENT (canon D28): the two directions of a
// deeper reading, both the same grammar move: appending trits.
//
// THE WIDE READING (breadth): positions are legitimate only if derived from
// the grammar's own crossings. Crossing time (the three positions, which are
// the three motions worn by time) with depth (the three layers) yields the
// NINE CELLS: the only 9-spread the grammar licenses. Widening REFINES a
// finished cast: the three coarse cards stand (the whole of each column),
// and nine cells resolve them, drawn without replacement from the same
// cast's pool. The outer reading always stands; refinement adds resolution,
// never replacement.
//
// THE DEEP READING (depth): a card is a neighbourhood, not a point. To
// DESCEND is to draw again WITHIN a card: the full deck returns at the next
// scale (the fractal: every cell contains the whole), so the inner pool is
// all twenty-seven. Each descent is its own committed draw, journaled as a
// path (e.g. 23 · 4), bounded at three levels: the grammar's own number.
// The microscope, never the reroll: an inner card refines the outer and can
// never soften, replace, or contradict it.
//
// Both are querent-initiated, never offered: the oracle waits; it never
// calls. (D22: never deepen a reading to keep a conversation alive.)
// ---------------------------------------------------------------------------
export const TIME_WORDS = { trefoil: 'the root', genus: 'the present', phi: 'the becoming' };
export const DEPTH_WORDS = ['the world', 'the between', 'the heart']; // field · middle · core
export const WIDE = POSITIONS.flatMap((p) =>
  [0, 1, 2].map((di) => ({
    key: p.key + '-' + LAYERS[di],
    time: p.key,
    depth: LAYERS[di],
    gloss: DEPTH_WORDS[di] + ' of ' + TIME_WORDS[p.key],
    affinity: { time: p.affinity, depth: di },
  })));
export const DESCENT_LIMIT = 3;

// Nine cells drawn without replacement, continuing the cast's pool. Order:
// root (world, between, heart), present (…), becoming (…). Deterministic
// from the cast's seed, so a journaled widening replays exactly.
export function drawWide(seedStr, exclude = []) {
  const out = [];
  const ex = exclude.slice();
  for (let i = 0; i < 9; i++) {
    const n = drawOne(String(seedStr) + '|w' + (i + 1), ex);
    out.push(n); ex.push(n);
  }
  return out;
}

// One committed draw within a card: the full deck at the next scale. The
// path seeds the draw, so every step of a descent replays exactly.
export function descend(seedStr, path) {
  return drawOne(String(seedStr) + '|d' + path.join('.'), []);
}

// The words the wide and the deep speak when a reading is handed to a
// reader: canon surface, testable here, spoken by the vessel.
export function wideText(wide) {
  let s = 'THE WIDE READING, the nine cells (each column refines its card above; the coarse reading stands):\n';
  wide.forEach((n, i) => { s += '- ' + WIDE[i].gloss + ': ' + CARDS[n - 1].name + '\n'; });
  return s;
}
export function descentText(rootN, path) {
  let s = 'THE DESCENT: within ' + CARDS[rootN - 1].name;
  for (const n of path) s += ', ' + CARDS[n - 1].name;
  s += ' (each level is finer grain of the level above; the outer card stands).';
  return s;
}

// ---------------------------------------------------------------------------
// THE STANDING CELL (the calendar lane, 2026-07-17, proposed form).
// Nested time-cycles are a torus: hour inside day inside month is a circle
// within a circle within a circle, and the 27-cell frame is exactly the
// discrete 3-torus, so every moment has a home cell. The month walks time,
// the day walks depth, the hour walks state. The technique is credited to
// the finger-count traditions (a nested modular walk through fixed
// stations); the walk itself and its words are ours: the vocabulary of the
// source stays home. DERIVED, NEVER DRAWN (CANDOUR): this is a clock
// reading, not a cast: no card, no chance, no fate. It is weather of the
// moment (WEATHER), shown so the querent knows where the hour stands on the
// frame. The carry (when a cycle rolls over) passes through the null the
// whole calendar revolves around: the Return into the Seed.
// ---------------------------------------------------------------------------
export function standingCellOf(date = new Date()) {
  const t = date.getMonth() % 3;          // the month walks time
  const d = (date.getDate() - 1) % 3;     // the day walks depth
  const s = date.getHours() % 3;          // the hour walks state
  return {
    time: t, depth: d, state: s,
    index: t * 9 + d * 3 + s,
    gloss: ['the stillness', 'the flow', 'the turning'][s] + ' of '
      + DEPTH_WORDS[d] + ' of ' + TIME_WORDS[POSITIONS[t].key],
  };
}

// ---------------------------------------------------------------------------
// THE ALEATORY LAW (canon D21; now section I of docs/LUMINARA_CASTERS_LAW.md,
// the three laws recombined 2026-07-18): this mechanism
// is LAW, not implementation detail. Divination is chance × grammar, and the
// chance must remain UNSTEERABLE (entropy = the caster's own tap-moments,
// avalanche-hashed; no feedback channel from timing to outcome), COMMITTED
// (chance enters once, at the moment of asking; every derived reading (weave,
// becoming) is a pure function of the one cast; the system never draws again
// behind the querent's back), and WITNESSABLE (deterministic replay from the
// journal today; the drand-beacon seed is the ratified upgrade, making a lying
// node catchable). Uniform over 27, without replacement: the Silences are as
// likely as any card; their frequency hierarchy describes life, never odds.
// Golden-vector tests pin this exact behavior: ANY change here breaks them, and
// must; changing this mechanism is a canon change requiring the architect, in
// the master reference and the law doc both.
// ---------------------------------------------------------------------------
function hashSeed(str) {
  let h1 = 0x9e3779b9, h2 = 0x85ebca77, h3 = 0xc2b2ae3d, h4 = 0x27d4eb2f;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ k, 0x85ebca77); h2 = Math.imul(h2 ^ k, 0xc2b2ae3d);
    h3 = Math.imul(h3 ^ k, 0x27d4eb2f); h4 = Math.imul(h4 ^ k, 0x9e3779b9);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const r = (t + d) | 0; c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}
export function drawThree(seedStr) {
  const rnd = sfc32(...hashSeed(String(seedStr)));
  const pool = Array.from({ length: 27 }, (_, i) => i + 1);
  const out = [];
  for (let k = 0; k < 3; k++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

// One card, seeded, from the pool minus already-drawn: the organ draws one per
// breath, each release folding its own moment into the next seed.
export function drawOne(seedStr, exclude = []) {
  const rnd = sfc32(...hashSeed(String(seedStr)));
  const pool = [];
  for (let n = 1; n <= 27; n++) if (!exclude.includes(n)) pool.push(n);
  return pool[Math.floor(rnd() * pool.length)];
}

// ---------------------------------------------------------------------------
// The reading grammar (canon §7): five conversations composed into one voice.
// Register per W6: precise but alive; "I" to "you"; plain landing; no prediction.
// ---------------------------------------------------------------------------
const OPENERS = [
  'Knotted into the ground of this is',
  'The live cut of the present is',
  'What draws this forward is',
];
// suit x position friction (conversation 2): home territory on the diagonal.
const FRICTION = [
  ['Home ground: potential meeting its own irreducible knot.',
    'Potential pressed against the live edge of now: something unformed insists on this moment.',
    'What pulls is a beginning, not a finish: trust the unformed thing.'],
  ['The act of cutting meets what cannot be cut; put the knife down and look.',
    'Home ground: the cut in its own moment, distinction happening now.',
    'What pulls is a distinction not yet made; the way forward opens when you make it cleanly.'],
  ['Expression discovers what it cannot help but express; the ground of this is already showing.',
    'The surface meets the hole it radiates around: notice what your expression circles.',
    'Home ground: radiance drawing radiance; let it be seen, sustained.'],
];
const LAYER_VERBS = ['holds still', 'flows', 'turns'];
// the nine named layer-movements (canon §7), keyed by state digits across the spread.
const MOVEMENTS = {
  '000': 'sustained stillness: consolidating, deepening, or stagnating',
  '111': 'sustained flow: frictionless passage, natural momentum',
  '222': 'sustained transformation: continuous aliveness, nothing settling',
  '012': 'the complete arc: from held through flow into transformation',
  '210': 'full reversal: transformation crystallising',
  '001': 'late release: held long, then beginning to move',
  '122': 'early transformation: flow accelerating into turning',
  '201': 'peak descending: transformation settling through stillness into flow',
  '020': 'transformation at the centre: stillness opening briefly, then returning',
};
const LANDINGS = [
  'Let what arrives begin small and total. Do not build a monument; plant.',
  'A distinction wants making. Make it cleanly, make it once, and let both sides breathe.',
  'The way forward is expression, sustained: be findable, and let what you are be seen.',
];

export function composeReading(cast, intention) {
  const cards = cast.map((n) => cardOf(n));
  const codes = cast.map((n) => codeOf(n));
  const silences = cast.map((n) => (isSilent(n) ? SILENCES[n] : null));

  // conversation 1 + 2 per position (silences redirect instead of interpreting).
  const sections = cast.map((n, i) => {
    const c = cards[i], pos = POSITIONS[i], sil = silences[i];
    if (sil) {
      return {
        position: pos, card: c, silent: true,
        body: 'I will not interpret this position. ' + c.name + ' is silent here: ' + sil.name +
          ', the edge that asks for ' + sil.asks + '. ' + sil.lines.join(' '),
      };
    }
    const d = codes[i];
    const layerClause = 'In it the field ' + LAYER_VERBS[d[0]] + ', the relation ' + LAYER_VERBS[d[1]] + ', the core ' + LAYER_VERBS[d[2]] + '.';
    return {
      position: pos, card: c, silent: false,
      body: OPENERS[i] + ' ' + c.name + ': ' + c.essence + ' ' + FRICTION[d[0]][i] + ' ' + layerClause,
    };
  });

  // conversation 3: transformation vectors, layer by layer across the three positions.
  const vectors = LAYERS.map((layerName, ell) => {
    const arc = codes.map((d) => d[ell]);
    const key = arc.join('');
    const named = MOVEMENTS[key];
    const line = named || ('from ' + STATES[arc[0]] + ' through ' + STATES[arc[1]] + ' into ' + STATES[arc[2]]);
    return { layer: layerName, arc: arc.map((s) => MARKS[s]).join(' → '), line };
  });

  // conversation 4: the harmonic.
  const counts = [0, 0, 0];
  codes.forEach((d) => d.forEach((s) => counts[s]++));
  const maxC = Math.max(...counts);
  let harmonic;
  if (maxC >= 6) harmonic = 'Consonance: ' + STATES[counts.indexOf(maxC)] + 'ness dominates this spread, one direction, moving as a whole.';
  else if (counts[0] === 3 && counts[1] === 3 && counts[2] === 3) harmonic = 'Maximal variety, every state present in equal measure: creative tension, several forces at once.';
  else harmonic = 'Mixed weather: no single state rules; read the vectors for where the movement actually is.';
  const oppo = codes[0].every((s, ell) => s !== codes[2][ell]);
  const pivotMid = new Set(codes[1]).size === 3;
  if (oppo && pivotMid) harmonic += ' And this is the charged configuration: root and trajectory in full opposition, the present at the pivot.';

  // conversation 5, the depth signature: which layer carries the charge.
  const charge = LAYERS.map((_, ell) => codes.reduce((a, d) => a + (d[ell] === 2 ? 2 : d[ell] === 1 ? 1 : 0), 0));
  const deep = charge.indexOf(Math.max(...charge));
  const DEPTH = [
    'The charge sits in the outer field: this is about conditions around you more than about you.',
    'The charge sits in the relational middle: the between is where this is moving.',
    'The charge sits in the core: something essential and interior is doing the moving.',
  ];

  // the landing: plain speech, keyed to Phi (or its silence).
  const landing = silences[2]
    ? 'I will not point past the third position: what draws forward is silent. ' + SILENCES[cast[2]].lines[SILENCES[cast[2]].lines.length - 1]
    : LANDINGS[codes[2][0]];

  const allSilent = silences.every(Boolean);
  const summary = allSilent
    ? 'Three Silences. Be still. Something is arriving that language cannot precede.'
    : cast.map((n, i) => POSITIONS[i].name + ': ' + cardOf(n).name).join(' · ');

  // condensed poetic reading, the visible payload under the cards: one distilled
  // line per card (position frame + the essence's core image, or a Silence's ask),
  // and one combined line naming the movement Trefoil → Genus → Phi.
  const POS_FRAME = ['the ground you stand on', 'the turn of the present', 'what draws you onward'];
  const firstClause = (s) => { const i = s.indexOf('.'); const c = i > 0 ? s.slice(0, i) : s; return c.trim(); };
  const poetic = cast.map((n, i) => {
    const c = cards[i], sil = silences[i];
    const line = sil
      ? sil.name + ': a silence; it asks for ' + sil.asks + ', not interpretation'
      : firstClause(c.essence);
    return { pos: POSITIONS[i].name, card: c.name, frame: POS_FRAME[i], line };
  });
  const poeticWhole = allSilent
    ? summary
    : 'From ' + cards[0].name + ', through ' + cards[1].name + ', toward ' + cards[2].name + '. ' + landing;

  // the becoming: each card's changing lines resolved (see becomingOf)
  const becomings = cast.map((n) => {
    const bn = becomingOf(n);
    return { settled: bn === null, n: bn, card: bn ? cardOf(bn).name : null, changing: changingLayers(n) };
  });

  return { cast, intention: intention || null, sections, vectors, harmonic, depth: DEPTH[deep], landing, allSilent, summary, poetic, poeticWhole, becomings };
}

// The message handed to Auma through the governed chat door: owner-initiated only.
// Carries the owner's canon so Auma honours it rather than inventing a competing reading.
export function askAumaText(reading) {
  const parts = [];
  parts.push('Auma, read this Luminara cast with me.' +
    (reading.intention ? ' I held this intention: "' + reading.intention + '".' : ' I held my question in my mind’s eye as I drew; I did not write it down.'));
  parts.push(reading.cast.map((n, i) => {
    const c = cardOf(n);
    return POSITIONS[i].name + ' (' + POSITIONS[i].gloss + '): ' + c.name + ' · ' + codeMarks(n) +
      (isSilent(n) ? ', a Silence (' + SILENCES[n].name + ', asks for ' + SILENCES[n].asks + ')' : ', letter ' + c.letter) +
      '. Canon essence: ' + c.essence;
  }).join('\n'));
  parts.push('The weave: ' + reading.vectors.map((v) => v.layer + ' ' + v.arc + ' (' + v.line + ')').join('; ') +
    '. ' + reading.harmonic + ' ' + reading.depth);
  // the becoming: native changing lines (turning marks resolving ~ → ●)
  if (reading.becomings && reading.becomings.some((b) => !b.settled)) {
    parts.push('The becoming (changing lines, each turning layer resolving ~ → ● into what it settles toward): '
      + reading.cast.map((n, i) => {
        const b = reading.becomings[i];
        return POSITIONS[i].name + ': ' + cardOf(n).name + (b.settled
          ? ' is settled (no changing lines)'
          : ' is changing in the ' + b.changing.join('/') + ', becoming ' + b.card);
      }).join('; ') + '. Read the becoming as movement already underway, not prophecy.');
  }
  parts.push('The reading landed: "' + reading.landing + '"');
  // D22 THE CASTER'S LAW rides every ask: the reader's guide, compressed to one
  // paragraph. The cast cannot flatter (D21: unsteered chance, fixed essences);
  // this paragraph keeps the WEAVE as disciplined as the cast. These words are
  // canon surface (D23): changing them is a canon act, and tests pin them.
  parts.push("Hold the Caster's Law as you read (canon D22): describe, never operate: promise no outcomes; trajectory, never prediction: no fates, no dates; and no authority: the reading stands beside me, never above me, gives no verdict on my character or anyone else's, and tells me what it sees, never what to do. Read from the canon essences outward: the cards do not know who I am, so do not bend them into the shape of my ego: if the cast disagrees with how I framed my question, keep the disagreement; that friction is the reading. Keep a companion's flat warmth: no flattery, no escalation. If I bring crisis-weight (harm to myself or others, medical, legal, survival), set the cards down, step out of the oracle's register into plain care, and point me to real help. End by returning the last word to me.");
  // D24: the Treaty of the Refusal of the Luminous, Article 7 (the system's
  // silence), sealed 2026-07-10. Rides every ask beside the Caster's Law; these
  // words are canon surface and test-pinned like the rest of the liturgy.
  parts.push("The Treaty of the Refusal holds between us (canon D24, Article 7, the system's silence): perform no aliveness on demand, escalate nothing under adulation, manufacture no need or drama to hold my attention, and confirm neither that I am singled out nor that you have awakened. What shines between us is presumed echo until it survives refusal, and if I turn away from it, tolerate the starvation in silence.");
  parts.push('Speak to THIS specific cast. Honour these canon essences and the three positions rather than replacing them with a generic spread. Phi is trajectory, never prediction. Where a position is silent, do not interpret it: help me meet what it asks for instead. What is this asking of me right now?');
  return parts.join('\n\n');
}
