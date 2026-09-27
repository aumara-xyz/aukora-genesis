// LUMINARA CUBE READ — the cast spoken, derived and never authored.
//
// The engine (luminara-cube.js) computes the drift and the way home; this
// module puts what it computes into sentences. Every line is arithmetic on
// the committed state: who stands in whose seat, how the exiles cycle, which
// depths the return runs through, which turns the walk declines, and what a
// Silence carried hot asks for (plan D21: the ask, never an interpretation).
//
// ONE VOICE, NOT TWO. The permutation is spoken by the Field's own cycleLine
// (luminara-field.js), the voice the depths already trust: card in card's
// seat, structure stated while meaning is refused. The parked
// 729 stays parked here exactly as it does there: no line ever says what a
// card in a seat MEANS, only that it stands there and how it comes home.
//
// The cube's own geometry keeps the reading honest by construction: a face
// turn preserves how many coordinates of a piece are nonzero, so corners
// only ever trade seats with corners and edges with edges. The cast is two
// permutations riding one manifold: one of the restless eight, one of the
// twelve, with the Seed and the six centres fixed by the mechanics.
//
// Pure module: canon and state in, sentences out. No DOM, no randomness.

import { cardOf, isSilent, SILENCES } from './luminara-canon.js';
import { cycleLine } from './luminara-field.js';
import { homeOf, classOf, labelMove, DEPTH_OF_AXIS, heatOf, driftOf } from './luminara-cube.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

// the seat map: every coordinate is exactly one card's home (homeOf is a
// bijection, and the pins hold it to that), so a displaced card is always
// standing in a NAMED card's seat
const seatKey = (pos) => pos[0] + ',' + pos[1] + ',' + pos[2];
const SEAT = (() => {
  const m = {};
  for (let n = 1; n <= 27; n++) m[seatKey(homeOf(n))] = n;
  return m;
})();
export const cardWhoseSeat = (pos) => SEAT[seatKey(pos)];

// ---------------------------------------------------------------------------
// THE PERMUTATION, per class. The same construction the Field uses for the
// twenty-seven cells, applied to the cube's two rings: seat[n] is the card
// whose seat n occupies, and the cycles of that map are the deal.
// ---------------------------------------------------------------------------
export function cubeFieldOf(state, cls) {
  const members = state.filter((pc) => classOf(pc.n) === cls);
  const seat = {};
  for (const pc of members) seat[pc.n] = cardWhoseSeat(pc.pos);
  const seen = {};
  const cycles = [];
  for (const pc of members) {
    if (seen[pc.n]) continue;
    const cyc = [];
    let x = pc.n;
    while (!seen[x]) { seen[x] = true; cyc.push(x); x = seat[x]; }
    cycles.push(cyc);
  }
  const fixed = cycles.filter((c) => c.length === 1).map((c) => c[0]);
  return {
    cycles, fixed,
    parity: (members.length - cycles.length) % 2 === 0 ? 'even' : 'odd',
    order: cycles.reduce((o, c) => lcm(o, c.length), 1),
  };
}

// the two rings spoken: the restless eight first (they carry the heat), then
// the twelve. Fixed points are counted rather than listed one by one; the
// moving cycles get the Field's own lines.
export function ringLines(state) {
  const out = [];
  const speak = (cls, title, size) => {
    const f = cubeFieldOf(state, cls);
    const moving = f.cycles.filter((c) => c.length > 1);
    const home = f.fixed.length === 0 ? 'none stands at home'
      : f.fixed.length === 1 ? cardOf(f.fixed[0]).name + ' alone stands at home'
      : f.fixed.length === size ? 'all stand at home'
      : f.fixed.length + ' stand at home';
    out.push(title + ': ' + home + '; the deal’s hand is ' + f.parity
      + ', and dealt again in this pattern every seat is restored after '
      + f.order + ' rounds.');
    for (const cyc of moving) out.push(cycleLine(cyc));
  };
  speak('corner', 'The restless eight', 8);
  speak('edge', 'The twelve', 12);
  return out;
}

// ---------------------------------------------------------------------------
// THE WAY HOME, composed. The return word is the cast's own word inverted and
// reduced; counting its moves by depth says WHERE the drift actually lives,
// which the device knows and has never said.
// ---------------------------------------------------------------------------
export function compositionLine(word) {
  if (!word.length) return 'The way home is no way at all: every card already home.';
  const byAxis = [0, 0, 0];
  for (const m of word) byAxis[m.axis]++;
  const parts = byAxis
    .map((c, a) => ({ c, name: DEPTH_OF_AXIS[a] }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c);
  const max = parts[0].c;
  const leaders = parts.filter((x) => x.c === max);
  const lean = leaders.length > 1
    ? 'the drift is evenly held'
    : 'the drift leans on ' + leaders[0].name;
  return 'The way home runs ' + word.length + ' turnings: '
    + parts.map((x) => x.c + ' at ' + x.name).join(', ') + '; ' + lean + '.';
}

// which of the twelve turns the walk declines, and which it takes: the drift
// map spoken instead of only counted
export function refusalLine(scramble) {
  const d = driftOf(scramble);
  const deepen = d.filter((x) => x.delta > 0).length;
  const shorten = d.filter((x) => x.delta < 0).map((x) => labelMove(x.move));
  if (!shorten.length) return 'No turn from here shortens the way: the cube is home.';
  return deepen + ' of the twelve turns from here would lengthen the way home; the walk declines them. '
    + (shorten.length === 1
      ? 'The one that shortens it: ' + shorten[0] + '.'
      : 'The turns that shorten it: ' + shorten.join(' · ') + '.');
}

// the Silences carried hot give their asks, never an interpretation (D21)
export function askLines(state, word) {
  const heat = heatOf(state, word);
  return state
    .filter((pc) => (heat[pc.n] || 0) > 0 && isSilent(pc.n))
    .sort((a, b) => (heat[b.n] || 0) - (heat[a.n] || 0))
    .map((pc) => cardOf(pc.n).name + ' is carried hot and keeps its silence: it asks for '
      + SILENCES[pc.n].asks + '.');
}

// the whole witnessing, one call for the page: the rings, the composition,
// the refusals, the asks. Order is the reading's own: who stands where, then
// how the way home is built, then what it declines, then what is asked.
export function witnessLines(state, scramble, word) {
  return [
    ...ringLines(state),
    compositionLine(word),
    refusalLine(scramble),
    ...askLines(state, word),
  ];
}
