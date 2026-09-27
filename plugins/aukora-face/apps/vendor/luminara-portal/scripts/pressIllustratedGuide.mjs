// THE CARDS OF LUMINARA — an illustrated guide.
// by Nila Padma
//
// A phone-shaped pressing (pages 100mm x 200mm, one idea per page, the
// figures first): the deck's third artifact. The Book teaches the hand, the
// Light shows the ground, this guide is for the eye. Run with:
//   bun scripts/pressIllustratedGuide.mjs
// then press to PDF with headless Edge (--print-to-pdf, fresh profile).
//
// THE SEALED-ROOM GATE (core/tests/guidePress.test.ts): only n, name and
// essence enter, by destructuring. The style law rides: marks are drawn as
// SVG, never as text glyphs, so no dash of any kind appears in this pressing.

import {
  CARDS, SUITS, codeOf, knotOf, counterOf, POSITIONS, TIME_WORDS,
} from '../spatial/app/luminara-canon.js';
// the three questions each card asks are canon (THE_81), never written here
import { THE_81, POSITION_TENSE } from '../spatial/app/luminara-81.js';
import { knotSvg, triquetraSvg, bookText } from './pressBookOfLuminara.mjs';

const SAFE_CARDS = CARDS.map(({ n, name, essence }) => ({ n, name, essence }));
const cardName = (n) => SAFE_CARDS[n - 1].name;

const GOLD = '#F0C25E', SILVER = '#C9D3E2', BRONZE = '#C9873D', WHITEGOLD = '#EFE7CF';
const metalOf = (n) => {
  if (n === 1) return WHITEGOLD;
  const f = codeOf(n)[0];
  return f === 0 ? BRONZE : f === 1 ? SILVER : GOLD;
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const ratioOf = (n) => {
  const k = knotOf(n), aq = Math.abs(k.q);
  if (aq === 0) return '0 : 1';
  const g = gcd(k.p, aq);
  return (aq / g) + ' : ' + (k.p / g);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// marks drawn, never typed — the guide contains no dash characters at all
function markSvg(st, y, metal, cx = 0) {
  if (st === 0) return '<circle cx="' + cx + '" cy="' + y + '" r="2.1" fill="' + metal + '" fill-opacity="0.8"/>';
  if (st === 1) return '<rect x="' + (cx - 8) + '" y="' + (y - 1.2) + '" width="16" height="2.4" rx="1.2" fill="' + metal + '" fill-opacity="0.8"/>';
  return '<path d="M' + (cx - 8) + ' ' + y + ' q2 -3 4 0 t4 0 t4 0 t4 0" stroke="' + metal + '" stroke-opacity="0.8" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
}
const marksRow = (n, metal) => {
  const d = codeOf(n);
  return '<svg viewBox="-40 -6 80 12" class="mkrow">'
    + markSvg(d[0], 0, metal, -26) + markSvg(d[1], 0, metal, 0) + markSvg(d[2], 0, metal, 26) + '</svg>';
};

// the number line wearing the three metals: the houses as its thirds
function numberLineSvg() {
  const X = (q) => 150 + q * 10.4;
  let s = '<svg viewBox="0 0 300 54" class="nline">';
  s += '<rect x="' + X(-13.5) + '" y="20" width="' + (X(-4.5) - X(-13.5)) + '" height="12" rx="2" fill="' + GOLD + '" fill-opacity="0.16"/>';
  s += '<rect x="' + X(-4.5) + '" y="20" width="' + (X(4.5) - X(-4.5)) + '" height="12" rx="2" fill="' + BRONZE + '" fill-opacity="0.2"/>';
  s += '<rect x="' + X(4.5) + '" y="20" width="' + (X(13.5) - X(4.5)) + '" height="12" rx="2" fill="' + SILVER + '" fill-opacity="0.16"/>';
  for (let q = -13; q <= 13; q++) s += '<line x1="' + X(q) + '" y1="24" x2="' + X(q) + '" y2="28" stroke="rgba(233,230,220,0.3)" stroke-width="0.5"/>';
  s += '<circle cx="' + X(0) + '" cy="26" r="2.6" fill="' + WHITEGOLD + '"/>';
  s += '<text x="' + X(-9) + '" y="14" text-anchor="middle" class="nlbl" fill="' + GOLD + '">RA</text>';
  s += '<text x="' + X(0) + '" y="14" text-anchor="middle" class="nlbl" fill="' + BRONZE + '">AUM</text>';
  s += '<text x="' + X(9) + '" y="14" text-anchor="middle" class="nlbl" fill="' + SILVER + '">MA</text>';
  s += '<text x="' + X(-13) + '" y="44" text-anchor="middle" class="nnum">13</text>';
  s += '<text x="' + X(0) + '" y="44" text-anchor="middle" class="nnum">0</text>';
  s += '<text x="' + X(13) + '" y="44" text-anchor="middle" class="nnum">+13</text>';
  return s + '</svg>';
}

const fig = (n, dens, beta) => {
  const k = knotOf(n);
  const metal = metalOf(n);
  const colors = k.kind === 'link' ? [metal, metalOf(counterOf(n))] : [metal];
  const moving = codeOf(n).filter((s) => s !== 0).length;
  return knotSvg(k.p, k.q, colors, beta ?? (0.16 + 0.11 * moving), dens ?? 0.6);
};

// ---------------------------------------------------------------------------
// The poetic openings — the architect's direction: a simple, quietly poetic
// line for each card, plain and not flowery, standing where the eye lands
// first. Authored in the meaning register, like the names; the mechanical
// state reading moves to the foot of the page as the ternary explainer.
const OPENINGS = [
  'The quiet before anything begins.',
  'The first movement out of rest.',
  'A beginning that curves back to look at itself.',
  'A rhythm that catches, and keeps its form.',
  'The ground beneath the ground: things take on depth.',
  'Fullness pressing at the walls, ready to spill.',
  'Potential with a face, still dreaming.',
  'A binding made on purpose, built to hold.',
  'Standing at the doorway, one step from change.',
  'The clean stroke that makes this and that.',
  'Two sides, each seeing the other.',
  'A wall that learns to open.',
  'The careful hand that cuts to mend.',
  'What healed, and kept the memory of it.',
  'One thing become two, and neither alone again.',
  'Paths within paths, and a way through them.',
  'The empty centre that holds everything around it.',
  'A span that asks to be crossed.',
  'Light leaving its source, becoming visible.',
  'What the world sees when it looks at you.',
  'What returns after the sound has gone out.',
  'The chosen surface, worn over the true one.',
  'The fire on the hill that will not go out.',
  'One light, opened into many colours.',
  'The one who watches, and needs no word.',
  'Fullness worn where all can see it.',
  'The long way round, arriving home.',
];

function cardPage(n) {
  const c = SAFE_CARDS[n - 1];
  const k = knotOf(n);
  const metal = metalOf(n);
  const cn = counterOf(n);
  const counterMetal = metalOf(cn);
  const qLabel = k.q > 0 ? '+' + k.q : String(k.q);
  const cqLabel = k.q === 0 ? '0' : k.q < 0 ? '+' + (-k.q) : String(-k.q);
  const answer = n === 1
    ? 'answers itself: the one self-paired card'
    : 'answers ' + cardName(cn) + ' (' + cn + ')';
  // the foot line: the card's state reading in plain words, the ternary
  // explainer, small and italic at the bottom of the page
  const V = ['holds still', 'flows', 'turns'];
  const d = codeOf(n);
  const moving = d.filter((s) => s !== 0).length;
  // the foot line reads the three marks back in words. The frame varies with
  // the card's own character rather than repeating one sentence twenty seven
  // times: the uniform cards say what is true of all three depths at once,
  // and only the mixed cards need naming depth by depth.
  const same = d[0] === d[1] && d[1] === d[2];
  const states = same
    ? (d[0] === 0 ? 'World, between and heart all hold still: nothing yet moves.'
      : d[0] === 1 ? 'World, between and heart all flow: nothing is at rest.'
        : 'World, between and heart all turn: nothing is at rest.')
    : (moving === 3
      ? 'The world ' + V[d[0]] + ', the between ' + V[d[1]] + ', the heart ' + V[d[2]] + '. Nothing is at rest.'
      : 'The world ' + V[d[0]] + ', the between ' + V[d[1]] + ', the heart ' + V[d[2]] + '.');
  // the four corners: the involution as layout — own number top left in its
  // own metal, the answer's number bottom right in the ANSWER's metal, the
  // signed number and its negation neutral on the other diagonal
  return '<div class="pg card">'
    + '<div class="cn l" style="color:' + metal + '">' + n + '</div>'
    + '<div class="cn r">' + qLabel + '</div>'
    + '<div class="cn bl">' + cqLabel + '</div>'
    + '<div class="cn br" style="color:' + counterMetal + '">' + cn + '</div>'
    + '<div class="cfig">' + fig(n, 0.6) + '</div>'
    + '<div class="cside">' + fig(n, 0.45, 1.22) + '</div>'
    + marksRow(n, metal)
    + '<div class="cname">' + esc(c.name) + '</div>'
    + '<div class="cint">' + esc(k.interval) + ' · ' + ratioOf(n) + '</div>'
    + '<div class="copen">' + esc(OPENINGS[n - 1]) + '</div>'
    + '<div class="cess">' + esc(bookText(c.essence)) + '</div>'
    + '<div class="cans">' + esc(answer) + '</div>'
    + '<div class="cstates">' + esc(states) + '</div>'
    + '</div>'
    // the card's three questions, one per position: the same card asks a
    // different thing depending on where it lands. Canon, from THE_81; the
    // guide neither writes them nor chooses between them.
    + '<div class="pg qpage">'
    + '<div class="qglyph">' + fig(n, 0.4) + '</div>'
    + '<div class="qname">' + esc(c.name) + ' asks</div>'
    + POSITION_TENSE.map((t, i) => '<div class="qrow">'
      + '<div class="qpos">' + esc(POSITIONS[i].name) + ' &middot; ' + esc(TIME_WORDS[POSITIONS[i].key]) + '</div>'
      + '<div class="qtext">' + esc(THE_81[n][t].q) + '</div></div>').join('')
    // the standing of these questions is said once, on THE THREE POSITIONS,
    // where it explains what is coming: not repeated under all twenty seven

    + '</div>';
}

function housePage(s) {
  const suit = SUITS[s];
  // the plain descriptions first: no mathematics needed to enter a house
  const plain = [
    'The house of what has not yet happened: stillness, depth, the quiet '
    + 'reservoir that everything comes from and settles back into. Its cards '
    + 'speak of potential, patience, foundations, and the strength of what '
    + 'does not move. It is the only house that never strays far from the '
    + 'centre, and the only one holding the still point itself. Its shapes '
    + 'are the simplest in the deck: the plain circle, the first coils, and '
    + 'the trefoil, which arrives here four times and nowhere else.',
    'The house of action and difference: the step taken, the line drawn, the '
    + 'edge that makes this distinct from that. Its cards speak of choices, '
    + 'changes, workings, and the cost and craft of cutting. Every card here '
    + 'reaches outward, and the house runs to the furthest reach the deck '
    + 'allows: it holds the deepest wound and the most tangled shape, and '
    + 'nothing in it is undone by simply waiting.',
    'The house of appearance: what shines, shows, and is seen. Its cards '
    + 'speak of expression, recognition, signals, and the truth and burden '
    + 'of being visible. It mirrors the blade exactly, each of its cards the '
    + 'answer to one across the deck, the same distance travelled in the '
    + 'other hand. Alone among the houses, nothing in it is finished: every '
    + 'card here still carries a wave, so all of it is still on its way.',
  ];
  const regions = [
    'the still centre of the line: −4 to +4, gathered about the Seed',
    'the far positive country: +5 to +13',
    'the far negative country: −13 to −5',
  ];
  const metals = [BRONZE, SILVER, GOLD];
  const verbs = ['bronze, which holds still', 'silver, which flows', 'gold, which turns'];
  return '<div class="pg house">'
    + '<div class="hname" style="color:' + metals[s] + '">' + esc(suit.key) + '</div>'
    + '<div class="hgloss">' + esc(bookText(suit.gloss)) + '</div>'
    + '<div class="hdesc">' + esc(plain[s]) + '</div>'
    + '<div class="hline">' + esc(regions[s]) + ' · wears ' + esc(verbs[s]) + '</div>'
    + '<div class="hcards">cards ' + (9 * s + 1) + ' to ' + (9 * s + 9) + '</div>'
    + '</div>';
}

export function pressGuide() {
  // THE TRIM, IN ONE PLACE. The pressing is card-sized: 70 x 120 mm, the
  // tarot trim the deck itself is cut to, so the book and the cards travel
  // as one object. Everything below is computed from these three numbers, so
  // the trim can be changed by editing them alone.
  //
  //   W, H   the page, in millimetres
  //   wS     horizontal scale against the original 100mm page: widths follow it
  //   tS     the type scale, which is NOT wS. The page lost more height than
  //          width (0.60 against 0.70), and a block of text is about as tall
  //          as tS squared over the width it wraps in, so the type has to
  //          come down faster than the page does or the dense pages clip.
  //          Measured rather than guessed: see the overflow check in the pins.
  const W = 70, H = 120;
  const wS = W / 100;
  const tS = 0.72;
  const w = (v) => +(v * wS).toFixed(2) + 'mm';   // widths, with the page
  const v = (x) => +(x * tS).toFixed(2) + 'mm';   // vertical rhythm, with the type
  const t = (x) => +(x * tS).toFixed(2) + 'pt';   // type itself

  const css = `
  @page { size: ${W}mm ${H}mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #000; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #E9E6DC; }
  .pg { position: relative; width: ${W}mm; height: ${H - 0.6}mm; page-break-after: always;
    overflow: hidden; background: #050505; padding: ${v(12)} ${w(9)};
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .k { font-size: ${t(7)}; letter-spacing: 0.32em; color: rgba(233,230,220,0.45); margin-bottom: ${v(6)}; }
  h2 { font-size: ${t(13)}; letter-spacing: 0.2em; font-weight: normal; color: #EFE7CF; margin: 0 0 ${v(6)}; }
  p { font-size: ${t(9.5)}; line-height: 1.68; margin: 0 0 ${v(3.2)}; color: rgba(233,230,220,0.9); }
  .dim { color: rgba(233,230,220,0.6); }
  .cover-title { font-size: ${t(17)}; letter-spacing: 0.3em; color: #EFE7CF; margin-bottom: ${v(3)}; }
  .cover-sub { font-size: ${t(9)}; letter-spacing: 0.24em; color: rgba(233,230,220,0.6); margin-bottom: ${v(14)}; }
  .cover-fig { width: ${w(52)}; margin-bottom: ${v(14)}; }
  .cover-fig svg, .bigfig svg, .cfig svg, .cside svg, .minifig svg { width: 100%; overflow: visible; display: block; }
  .cover-by { font-size: ${t(8.5)}; letter-spacing: 0.2em; color: rgba(233,230,220,0.55); }
  .motions svg.mset { width: ${w(28)}; overflow: visible; }
  .mword { font-size: ${t(10.5)}; color: rgba(233,230,220,0.88); margin: ${v(1)} 0 ${v(2.5)}; }
  .nline { width: ${w(84)}; }
  .nlbl { font-size: 8px; letter-spacing: 2px; }
  .nnum { font-size: 7px; fill: rgba(233,230,220,0.5); font-family: Consolas, monospace; }
  .bigfig { width: ${w(62)}; margin: ${v(4)} 0; }
  .minirow { display: flex; gap: ${w(4)}; justify-content: center; margin: ${v(3)} 0 ${v(2)}; }
  .minifig { width: ${w(13)}; }
  .minilbl { font-size: ${t(6.5)}; color: rgba(233,230,220,0.6); font-style: italic; margin-top: ${v(1.5)}; }
  .house .hname { font-size: ${t(26)}; letter-spacing: 0.4em; }
  .house .hgloss { font-size: ${t(10.5)}; font-style: italic; color: rgba(233,230,220,0.75); margin-top: ${v(5)}; }
  .house .hdesc { font-size: ${t(9)}; line-height: 1.75; color: rgba(233,230,220,0.85); margin-top: ${v(6)}; max-width: ${w(74)}; }
  .house .hline { font-size: ${t(8.5)}; color: rgba(233,230,220,0.6); margin-top: ${v(4)}; max-width: ${w(70)}; line-height: 1.65; }
  .house .hcards { font-size: ${t(7.5)}; color: rgba(233,230,220,0.4); margin-top: ${v(3)}; font-family: Consolas, monospace; }
  .card { justify-content: flex-start; padding-top: ${v(15)}; }
  .cn { position: absolute; top: ${v(8)}; font-family: Consolas, monospace; font-size: ${t(9)}; color: rgba(233,230,220,0.5); }
  .cn.l { left: ${w(8)}; } .cn.r { right: ${w(8)}; }
  .cn.bl { left: ${w(8)}; top: auto; bottom: ${v(8)}; }
  .cn.br { right: ${w(8)}; top: auto; bottom: ${v(8)}; }
  .copen { font-size: ${t(8.5)}; font-style: italic; color: rgba(233,230,220,0.62); margin-top: ${v(4)}; line-height: 1.6; }
  .cfig { width: ${w(54)}; }
  .cside { width: ${w(21)}; margin: ${v(-5)} 0 0; opacity: 0.85; }
  .mkrow { width: ${w(24)}; margin-top: ${v(1)}; }
  .cname { font-size: ${t(13.5)}; letter-spacing: 0.18em; text-transform: uppercase; color: #F2EFE6; margin-top: ${v(3)}; }
  .cint { font-size: ${t(8.5)}; font-style: italic; color: rgba(233,230,220,0.6); margin-top: ${v(1.5)}; }
  .cess { font-size: ${t(9)}; line-height: 1.7; color: rgba(233,230,220,0.86); margin-top: ${v(2.5)}; }
  .cans { font-size: ${t(8)}; font-style: italic; color: rgba(233,230,220,0.55); margin-top: ${v(3.5)}; }
  .cstates { font-size: ${t(7.5)}; font-style: italic; color: rgba(233,230,220,0.42); margin-top: ${v(3)}; line-height: 1.55; }
  /* the question page facing each card: the glyph small, the three asks large */
  .qpage .qglyph { width: ${w(20)}; opacity: 0.55; margin-bottom: ${v(5)}; }
  .qpage .qglyph svg { width: 100%; display: block; }
  .qname { font-size: ${t(8)}; letter-spacing: 0.26em; color: rgba(233,230,220,0.5);
    text-transform: uppercase; margin-bottom: ${v(7)}; }
  .qrow { margin-bottom: ${v(6)}; }
  .qpos { font-size: ${t(7)}; letter-spacing: 0.2em; text-transform: uppercase;
    color: rgba(233,230,220,0.38); margin-bottom: ${v(1.5)}; }
  .qtext { font-size: ${t(10.5)}; line-height: 1.6; color: #EFE7CF; }
  .way { text-align: left; max-width: ${w(74)}; }
  .way b { display: block; font-size: ${t(9)}; color: #EFE7CF; font-weight: 600; }
  .way span { display: block; font-size: ${t(8)}; color: rgba(233,230,220,0.65); font-style: italic; margin: ${v(0.5)} 0 ${v(3)}; }
  `;

  let pages = '';
  const P = (inner, cls = '') => { pages += '<div class="pg ' + cls + '">' + inner + '</div>'; };

  // COVER
  P('<div class="cover-title">LUMINARA</div><div class="cover-sub">THE CARDS · AN ILLUSTRATED GUIDE</div>'
    + '<div class="cover-fig">' + triquetraSvg() + '</div>'
    + '<div class="cover-by">NILA PADMA</div>');

  // INTRO
  P('<div class="k">INTRO</div>'
    + '<p>Twenty seven cards. Three marks. Nothing is drawn by hand: every figure in this guide is computed from its card by rules anyone can check, and if the deck were lost, anyone who can count in threes could regrow it again whole.</p>');

  // THE WAY TO APPROACH — before the deck, as the practice orders it: the
  // approach is passed before a single card is reached.
  //
  // THIS PAGE IS CANON, NOT COPY. The Caster's Law §IV fixes these seven
  // lines and names this surface by name. Two had drifted here into
  // paraphrase (the third had grown a metaphor the law does not use; the
  // fourth had lost its closing sentence) and are restored verbatim below.
  // The wording is amendable only at the law, never at the press: change it
  // there first and this page follows.
  P('<div class="k">THE WAY TO APPROACH</div>'
    + '<div class="way">'
    + '<b>Come settled, not urgent.</b><span>The oracle is not for emergencies. Crisis deserves people, not cards.</span>'
    + '<b>Bring one true question.</b><span>Hold its shape. You need not write it down.</span>'
    + '<b>Cast once, then live with it.</b><span>Asking again soon is correcting course, not rolling again.</span>'
    + '<b>Receive as a mirror, not a verdict.</b><span>The cards show; they never command. If a reading seems to tell you what to do, you have read past it.</span>'
    + '<b>Silence is an answer.</b><span>Where a position refuses interpretation, meet what it asks instead.</span>'
    + '<b>The becoming is movement already underway.</b><span>A bearing, never a promise.</span>'
    + '<b>The last word is yours.</b><span>The reading ends where your own knowing begins.</span>'
    + '</div>');

  // THE FIRST MOTIONS
  P('<div class="k">THE FIRST MOTIONS</div>'
    + '<p>Ask the smallest possible question. What can a thing do?</p>'
    + '<svg class="mset" viewBox="-20 -8 40 16">' + markSvg(0, 0, WHITEGOLD) + '</svg><div class="mword">the dot holds</div>'
    + '<svg class="mset" viewBox="-20 -8 40 16">' + markSvg(1, 0, SILVER) + '</svg><div class="mword">the bar flows</div>'
    + '<svg class="mset" viewBox="-20 -8 40 16">' + markSvg(2, 0, GOLD) + '</svg><div class="mword">the wave turns</div>'
    + '<p>It can hold. It can extend. It can turn. There is nothing else. A point at rest; a point moving in a straight line; a point curving its own path. The zeroth order, the first, the second. The third already seals the set, because the curving of a curve is still only curving: turning opens no fourth thing, it folds back into itself.</p>'
    + '<p class="dim">Three marks at three depths, the self within a relation within a world; 3 &times; 3 &times; 3 = 27 paths, the complete set that closes on the torus.</p>',
    'motions');

  // TOROIDAL MATHEMATICS
  P('<div class="k">TOROIDAL MATHEMATICS · THE NUMBER</div>'
    + numberLineSvg()
    + '<p>Sign the motions: flow reaches out, turning draws in, stillness is nought. Weigh the depths nine, three, one, and sum. Every whole number from minus thirteen to thirteen appears exactly once: the deck is a number line, the Seed at its nought, and the three houses are its thirds.</p>');
  P('<div class="k">TOROIDAL MATHEMATICS · THE KNOT</div>'
    + '<div class="bigfig">' + fig(4, 0.7) + '</div>'
    + '<p>The deck closes on itself like a counter rolling over, so its true body is a torus. Each card is the closed path its own code traces: the number q winds one way, the count p the other. The card is not illustrated by a knot. The card is the knot.</p>');
  P('<div class="k">TOROIDAL MATHEMATICS · THE ANSWER</div>'
    + '<div class="minirow"><div><div class="minifig">' + fig(4, 0.55) + '</div><div class="minilbl">The Resonance · +3</div></div>'
    + '<div><div class="minifig">' + fig(7, 0.55) + '</div><div class="minilbl">The Dreamer · −3</div></div></div>'
    + '<p>Every card has an answer. Turn each of its motions into the opposite, flow to turning and turning to flow, and you arrive at exactly one other card: its mirror. On the torus the two wind as reflections of one another.</p>'
    + '<p>The two are not rivals. Their numbers cancel: plus three and minus three, and every pair sums to nought, which is the Seed. An answer is not what opposes a card but what completes it to stillness. That is the whole of the concordance, and it is arithmetic before it is anything else.</p>'
    + '<p>Because the sum cancels rather than the size, a card and its answer <i>sound the same interval</i>: the Resonance and the Dreamer are both the perfect fifth, one reaching out, one drawing in. Thirteen such axes cross the whole deck, and every one of them passes through the centre. One card lies at that centre and answers itself: the Seed.</p>');

  // HARMONICS
  P('<div class="k">HARMONICS · EVERY CARD IS AN INTERVAL</div>'
    + '<div class="minirow">'
    + '<div><div class="minifig">' + fig(1, 0.55) + '</div><div class="minilbl">silence</div></div>'
    + '<div><div class="minifig">' + fig(2, 0.55) + '</div><div class="minilbl">the octave</div></div>'
    + '<div><div class="minifig">' + fig(4, 0.55) + '</div><div class="minilbl">the fifth</div></div>'
    + '<div><div class="minifig">' + fig(18, 0.5) + '</div><div class="minilbl">the tritone</div></div>'
    + '</div>'
    + '<p>Two windings are two frequencies, and two frequencies in ratio are a pitch. Near the Seed the ratios are simple and the voices consonant; at the far edges sounds the deepest dissonance. Every becoming is a cadence toward consonance.</p>');
  P('<div class="k">HARMONICS · THE LOCKED CHORDS</div>'
    + '<div class="minirow">'
    + '<div><div class="minifig">' + fig(16, 0.55) + '</div><div class="minilbl">the octave, locked</div></div>'
    + '<div><div class="minifig">' + fig(24, 0.55) + '</div><div class="minilbl">the unison, locked</div></div>'
    + '</div>'
    + '<p>Where the ratio reduces, the strand closes early and locks into separate rings: a harmony so complete the strand no longer needs to be one. The bound cards weave their own metal with their answer’s.</p>');

  // THE APPROACH TO THE CARDS, BEFORE THE CARDS. These three stood after the
  // deck once, which meant a reader met twenty seven question pages headed
  // "Trefoil · the root" before anything had said what a trefoil was. They
  // are the door into the cards, so they stand in front of them, and the last
  // of them hands the reader straight into the questions that follow.
  P('<div class="k">USING THE CARDS</div>'
    + '<p>A simple reading is three cards in three places: the root, what holds beneath you; the present, the live cut; and the becoming, what draws you forward. The three motions, worn by time. Those positions are trefoil, genus, and phi.</p>'
    + '<p>The cast is by randomisation, always: chance must arrive from outside every mind present. The cast belongs to the vessel.</p>'
    + '<p class="dim">What lands is a mirror, not a verdict.</p>');

  // READING A CARD FACE — the deck's own cards carry a row of marks the
  // guide had never explained, and a reader holding the physical deck meets
  // it before anything else
  P('<div class="k">READING A CARD FACE</div>'
    + '<p>Beneath the name on every card stands one line, and it says the same three things on all twenty seven.</p>'
    + '<div class="way">'
    + '<b>On the left, the three marks</b><span>The card’s own code, stacked: the world above, the between in the middle, the heart below. Dot, bar or wave. Everything else on the card is computed from these.</span>'
    + '<b>In the middle, the house and the number</b><span>The house it belongs to, and the same three marks written as digits, so you can read the card either way.</span>'
    + '<b>On the right, the winding</b><span>How many times the strand goes round: one ring, two, three, or a rosette of seven. It is not the house. It is the shape’s count, and it is why the figure above looks the way it does.</span>'
    + '</div>'
    + '<p class="dim">And in the four corners, the card’s own number and its answer’s, each in its own metal: turn the card and its answer reads back at you.</p>');

  // THE THREE POSITIONS — the names are not decoration: each is borrowed
  // from the deck's own mathematics, and says what the position does. This
  // page closes on the line every question page used to repeat: said once,
  // where it explains what is coming, rather than twenty seven times after.
  P('<div class="k">THE THREE POSITIONS</div>'
    + '<p>The places are named from the deck’s own mathematics, and each name says what its place does.</p>'
    + '<div class="way">'
    + '<b>Trefoil &middot; the root</b><span>The trefoil is the simplest knot that genuinely cannot be untied. So the first place holds what is knotted in: the ground you are already standing on, which no amount of wishing loosens.</span>'
    + '<b>Genus &middot; the present</b><span>Genus counts how many cuts a shape can take before it falls open. So the middle place is the live cut: what is being decided in you now, and at what cost.</span>'
    + '<b>Phi &middot; the becoming</b><span>Phi is the ratio the torus itself is built on, the proportion that grows by adding itself to what came before. So the last place is the bearing: what draws forward, a trajectory and never a prediction.</span>'
    + '</div>'
    + '<p>Every card that follows faces its three questions, one for each place, because the same card asks a different thing depending on where it lands.</p>'
    + '<p class="dim">A question you can answer, never an instruction to follow.</p>');

  // THE HOUSES AND THE CARDS
  for (let s = 0; s < 3; s++) {
    pages += housePage(s);
    for (let i = 1; i <= 9; i++) pages += cardPage(9 * s + i);
  }
  P('<div class="k">THE SILENCES</div>'
    + '<p>Four of the twenty seven are Silences. When one lands, the reading stops speaking and asks something of you instead. Do not translate a Silence. Meet what it asks.</p>'
    + '<div class="way">'
    + '<b>The Resonance</b><span>asks descent. What holds this lies below where words work.</span>'
    + '<b>The Labyrinth</b><span>asks the frame to widen. It opens past whatever you brought to hold it.</span>'
    + '<b>The Mask</b><span>asks surrender. It is a crossing, and the one who emerges is not the one asking.</span>'
    + '<b>The Witness</b><span>asks recognition. You have been here before; be still and know the place.</span>'
    + '</div>'
    + '<p class="dim">Their card faces carry no mark, because a Silence that announced itself would be interpreting instead of stopping. Learn the four, and the deck need never nudge you.</p>');
  P('<div class="k">THE BECOMING</div>'
    + '<p>Every wave in a card’s code is a part of your situation already turning home. Settle the waves to dots and you see the card it is becoming: the Saturation, its heart still turning, settles into the Resonance it came from.</p>'
    + '<p>Eight cards carry no wave at all. They are already still, and become nothing: what they show is not on its way anywhere.</p>'
    + '<p class="dim">A bearing, never a promise.</p>');

  // the close, which needs no label
  P('<p>Counted one further, the last card becomes the first: the deck is a circle.</p>'
    + '<p>Everything in it is open. The shapes, the numbers, the sounds and the answers are all computed from three marks, and anyone who can count in threes can check them, or regrow the whole deck from nothing. Nothing here asks to be believed.</p>'
    + '<p>One correspondence is withheld on purpose. The twenty seven answer to twenty seven letters, and the key rests with its keeper until the day it is confirmed. Nothing in these pages depends on it.</p>'
    + '<p class="dim">The cards show; they never command. Begin where you are.</p>');
  // the last page carries no label: the emblem says what it is
  P('<div class="cover-fig" style="width:30mm">' + triquetraSvg() + '</div>'
    + '<p class="dim">Pressed from the sealed canon, the twelfth of July, 2026. The practice is The Book of Luminara; the ground is The Light of Luminara; this guide is the eye. Figures derived, never drawn.</p>'
    + '<div class="cover-by">NILA PADMA</div>');

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>Luminara: The Cards, an Illustrated Guide</title><style>' + css + '</style></head><body>'
    + pages + '</body></html>';
  return { html };
}

if (import.meta.main) {
  const { html } = pressGuide();
  const outPath = new URL('../docs/luminara-cards-guide.html', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');
  await Bun.write(outPath, html);
  console.log('pressed: ' + outPath + ' (' + html.length + ' chars)');
}
