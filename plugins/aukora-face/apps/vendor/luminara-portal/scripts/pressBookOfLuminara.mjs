// THE BOOK OF LUMINARA: Pressing One (the 27).
// by Nila Padma
//
// The pressing script: assembles the whole book as one print-ready HTML
// document, every figure and number DERIVED from the sealed canon module,
// never drawn, never typed by hand. Run with:  bun scripts/pressBookOfLuminara.mjs
// Then press to PDF with headless Edge (--print-to-pdf, fresh profile).
//
// THE SEALED-ROOM GATE (enforced by core/tests/bookPress.test.ts): this
// script must never read the sealed field of the card records. It takes only
// n, name and essence, by destructuring, and the test refuses any access to
// the withheld correspondence. The room stays locked by construction.
//
// THE STYLE LAW (applied at pressing, canon untouched): no em dashes,
// British spelling, provenance stated. bookText() converts; the test lints
// the pressed output for any dash that survived.

import {
  CARDS, SUITS, codeOf, codeMarks, isSilent, knotOf, counterOf,
} from '../spatial/app/luminara-canon.js';

// the sealed-room gate: only these three fields ever enter the book
const SAFE_CARDS = CARDS.map(({ n, name, essence }) => ({ n, name, essence }));
const cardName = (n) => SAFE_CARDS[n - 1].name;

const PHI = (1 + Math.sqrt(5)) / 2;
const GOLD = '#F0C25E', SILVER = '#C9D3E2', BRONZE = '#C9873D', WHITEGOLD = '#EFE7CF';
const metalOf = (n) => {
  if (n === 1) return WHITEGOLD;
  const f = codeOf(n)[0];
  return f === 0 ? BRONZE : f === 1 ? SILVER : GOLD;
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// ---------------------------------------------------------------------------
// THE STYLE LAW: the book register. Em dashes become colons (first in the
// sentence) or commas (after a colon); spelling turns British. Canon keeps
// its own inscription; only the pressing converts.
export function bookText(t) {
  t = String(t)
    .replace(/\bRecognize\b/g, 'Recognise').replace(/\brecognize\b/g, 'recognise')
    .replace(/\bRecognized\b/g, 'Recognised').replace(/\brecognized\b/g, 'recognised');
  let out = '', colonSeen = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === ';') colonSeen = false;
    else if (ch === ':') colonSeen = true;
    if (ch === '—') {
      while (out.endsWith(' ')) out = out.slice(0, -1);
      out += colonSeen ? ', ' : ': ';
      colonSeen = true;
      while (t[i + 1] === ' ') i++;
      continue;
    }
    if (ch === '–') { out += '-'; continue; }
    out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE FIGURES: derived, never drawn. The same golden-torus projection the
// cards page renders (R = phi, depth as luminance, the tempered rendition at
// one fifth molten), emitted as static SVG for the pressing.
const MOLTEN_MIX = 0.20;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp3 = (A, B, t) => A.map((v, i) => Math.round(v + (B[i] - v) * t));
const RAMPS = {};
function rampOf(metal) {
  if (RAMPS[metal]) return RAMPS[metal];
  const M = hexRgb(metal), DARK = hexRgb('#100903'), WHITE = [255, 255, 255];
  const steps = [];
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const molten = t < 0.55
      ? lerp3(DARK, M, 0.30 + 0.70 * (t / 0.55))
      : lerp3(M, WHITE, 0.52 * ((t - 0.55) / 0.45));
    steps.push('rgb(' + lerp3(M, molten, MOLTEN_MIX).join(',') + ')');
  }
  return (RAMPS[metal] = steps);
}

export function knotSvg(p, q, colors, beta, dens) {
  const R = PHI, r = 1;
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const g = q === 0 ? 1 : gcd(p, Math.abs(q));
  const pf = p / g, qf = q / g;
  const Nf = Math.round((dens || 1) * Math.min(520, Math.max(150, 30 * pf + 13 * Math.abs(qf))));
  const pts = []; const runs = [];
  for (let k = 0; k < g; k++) {
    const phase = 2 * Math.PI * k / g, start = pts.length;
    for (let j = 0; j <= Nf; j++) {
      const t = j / Nf * 2 * Math.PI;
      const tube = qf * t + phase, lon = pf * t;
      const x3 = (R + r * Math.cos(tube)) * Math.cos(lon);
      const y3 = (R + r * Math.cos(tube)) * Math.sin(lon);
      const z3 = r * Math.sin(tube);
      pts.push([x3, y3 * cb - z3 * sb, y3 * sb + z3 * cb]);
    }
    runs.push([start, pts.length - 1]);
  }
  let zLo = Infinity, zHi = -Infinity;
  for (const pt of pts) { if (pt[2] < zLo) zLo = pt[2]; if (pt[2] > zHi) zHi = pt[2]; }
  const zSpan = Math.max(1e-6, zHi - zLo);
  const segs = [];
  runs.forEach(([a, b], f) => { for (let j = a; j < b; j++) segs.push([j, (pts[j][2] + pts[j + 1][2]) / 2, f]); });
  segs.sort((x, y) => x[1] - y[1]);
  const P = (k) => pts[k][0].toFixed(3) + ' ' + pts[k][1].toFixed(3);
  // THE FRAME FOLLOWS THE INK, NOT THE HOLE. The viewBox was fixed on the
  // torus origin, which is the centre of the hole and not the centre of the
  // drawn figure: at low windings the strand leans hard to one side, so the
  // Drift and the Fold sat almost half a unit off centre in a frame five and
  // a bit wide, and looked it. The scale is left alone so every card stays
  // comparable in size; only the frame slides.
  //
  // BY THE BOUNDING BOX, and the centroid was tried and rejected: a torus
  // knot's points wrap the whole hole, so their mean sits near the origin
  // however lopsided the ENVELOPE is, and the Drift moved three hundredths
  // instead of the half unit it needed. It is the envelope that reads as
  // off centre, so it is the envelope that decides the frame.
  //
  // Anything composed ON TOP of a figure must therefore take its centre
  // from the viewBox and not from the origin: see triquetraSvg, whose ghost
  // rings stopped being concentric when this was first added.
  let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
  for (const pt of pts) {
    if (pt[0] < xLo) xLo = pt[0]; if (pt[0] > xHi) xHi = pt[0];
    if (pt[1] < yLo) yLo = pt[1]; if (pt[1] > yHi) yHi = pt[1];
  }
  const ox = (-2.85 + (xLo + xHi) / 2).toFixed(3);
  const oy = (-2.85 + (yLo + yHi) / 2).toFixed(3);
  let s = '<svg viewBox="' + ox + ' ' + oy + ' 5.7 5.7" aria-hidden="true">';
  for (const [j, zm, f] of segs) {
    const ramp = rampOf(colors[f % colors.length]);
    const zn = (zm - zLo) / zSpan;
    const col = ramp[Math.round(zn * 23)];
    const w = (0.055 + 0.135 * zn).toFixed(3);
    const op = (0.20 + 0.78 * zn).toFixed(2);
    s += '<path d="M' + P(j) + ' L' + P(j + 1) + '" stroke="' + col + '" stroke-width="' + w
      + '" stroke-opacity="' + op + '" fill="none" stroke-linecap="round"/>';
  }
  return s + '</svg>';
}

// the triquetra of the frame: T(2,3) down the torus axis, threefold by
// theorem, one petal up; the ghost embrace rings ride outside the knot
export function triquetraSvg() {
  const svg = knotSvg(2, 3, [WHITEGOLD], 0, 0.73);
  // the frame is set by the figure's own envelope, so the emblem turns about
  // the FRAME's centre and its ghost rings are struck there too. Reading the
  // origin instead leaves the rings off the knot they enclose.
  const [ox, oy, w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const cx = +(ox + w / 2).toFixed(3), cy = +(oy + h / 2).toFixed(3);
  return svg
    .replace('aria-hidden="true">', 'aria-hidden="true"><g transform="rotate(-90 ' + cx + ' ' + cy + ')">')
    .replace('</svg>', '</g>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="2.74" fill="none" stroke="' + WHITEGOLD + '" stroke-width="0.030" stroke-opacity="0.08"/>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="2.62" fill="none" stroke="' + WHITEGOLD + '" stroke-width="0.014" stroke-opacity="0.04"/>'
      + '</svg>');
}

const ratioOf = (n) => {
  const k = knotOf(n);
  const aq = Math.abs(k.q);
  if (aq === 0) return '0:1';
  const g2 = gcd(k.p, aq);
  return (aq / g2) + ':' + (k.p / g2);
};
const formOf = (n) => {
  const k = knotOf(n);
  if (k.kind === 'circle') return 'the circle';
  if (k.kind === 'coil') return 'open coil';
  if (k.kind === 'link') return k.components + ' rings, bound';
  return k.genus === 1 ? 'the trefoil' : 'knot, genus ' + k.genus;
};

// ---------------------------------------------------------------------------
// THE FRONT MATTER: the ratified texts, in the book register.
const LINEAGE =
  'This book continues a line: The Topology of Healing, The Concordance of Opposites, '
  + 'and now the deck itself. Everything in it is derived. Where a thing was chosen '
  + 'rather than derived, the text says so.';

const APPROACH = [
  ['Come settled, not urgent.', 'The oracle is not for emergencies. Crisis deserves people, not cards.'],
  ['Bring one true question.', 'Hold its shape. You need not write it down.'],
  ['Cast once, then live with it.', 'Asking again soon is correcting course, not rolling again.'],
  ['Receive as a mirror, not a verdict.', 'The cards show; they never command. If a reading seems to tell you what to do, you have read past it.'],
  ['Silence is an answer.', 'Where a position refuses interpretation, meet what it asks instead.'],
  ['The becoming is movement already underway.', 'A bearing, never a promise.'],
  ['The last word is yours.', 'The reading ends where your own knowing begins.'],
];

const LAW_PARAS = [
  'This book describes; it never operates. No page here does anything to anyone: no effects, '
  + 'no promised outcomes, divination without operation, permanently and by construction.',
  'This book offers trajectory, never prediction. No fates, no dates, no dooms. '
  + 'The becoming is a bearing, not a sentence.',
  'This book sits beside you, never above you. A reading never stands over the reader, '
  + 'gives no verdict on any person’s worth, and will not tell you what to do. '
  + 'The moment a reading is taken as instruction, the practice has left its canon: '
  + 'the fine line is attunement versus coercion, and the oracle waits; it never calls.',
  'If you are in danger or in crisis, put the book down and reach for a person. '
  + 'Crisis deserves people, not cards, and that call outranks every page here.',
];

const MADE_PARA =
  'Three positions, each in one of three states: twenty-seven cards, and nothing else. '
  + 'Every figure, number, pairing and interval in this book is derived from those three '
  + 'marks by rules a reader can check. The appendix carries the whole derivation. '
  + 'If a page and the derivation ever disagree, the page is wrong. '
  + 'The figures are derived, never drawn.';

const SEALED_ROOM =
  'One correspondence is missing from this book on purpose. The twenty-seven cards answer '
  + 'to twenty-seven letters, and the key that seats each letter is withheld until its '
  + 'keeper confirms it. Nothing is hidden inside these pages: no cipher, no puzzle. '
  + 'Nothing in these pages depends on the key: every figure, number and pairing derives '
  + 'without a single letter. The room is simply locked, and the book says so plainly. '
  + 'When the key arrives, the letters will either land on the shape this book already '
  + 'draws, or they will not. That is the test, and the book is content to wait.';

// HOW TO READ, the grammar, in two pages of short teachings: first the
// page (what a single card shows), then the reading (how cards meet).
const READ_THE_PAGE = [
  ['THE COUNT',
    'The deck is counted one to twenty-seven through three houses: AUM, which holds still; '
    + 'MA, which flows; RA, which turns. Bronze, then silver, then gold: the book brightens '
    + 'as it goes. Each card wears its house’s metal, and the Seed alone wears white-gold, '
    + 'the zero above the three.'],
  ['THE TWO FIGURES',
    'Each card bears its figure twice. Seen from above it is a mandala, and its petals '
    + 'number the signed corner, sign set aside: count them and you have read the corner '
    + 'without looking. Seen from the side it is the body of the knot itself, a strand '
    + 'winding a golden ring. One form, two views, and both are true: what a thing looks '
    + 'like depends on where you stand.'],
  ['THE CORNERS',
    'The corners hold four numbers. Across one diagonal, the card’s own number and its '
    + 'answer’s number, each wearing its own metal. Across the other, the card’s signed '
    + 'number and its negation, wearing no metal at all: the signed number is the law, the '
    + 'one number line every card sits on, and it belongs to no house. Turn a page upside '
    + 'down and the corners read as the answer’s corners. Opposition is not an orientation '
    + 'of a card; it is another card.'],
  ['THE CODE',
    'At the foot of each page, the card’s code in three marks: the dot holds still, the '
    + 'bar flows, the wave turns. They read field, then relation, then core. Where a wave '
    + 'stands, that layer is already turning: the becoming is not a prediction added to the '
    + 'card, it is written in the code itself.'],
];
const READ_THE_READING = [
  ['THE ANSWER',
    'Every card’s opposite is another card, and a card read alone is its own shadow: '
    + 'itself, unpaired, the interval refusing its cadence. When a card lands, its answer is '
    + 'already in the deck. The table of answers stands after the houses.'],
  ['THE SOUND',
    'Every card sounds an interval. The face writes it in the deck’s own notation: the '
    + 'signed number in the corner is one voice, and the winding of the strands is the other. '
    + 'The ratio and its name stand in each card’s appendix entry. One day the sound will '
    + 'be seen rather than named; that seat is held and stands empty on purpose.'],
  ['THE SILENCES',
    'Four of the twenty-seven are Silences. Their pages do not say so: silence does not '
    + 'announce itself. They are seated at four, sixteen, twenty-two and twenty-five. Where a '
    + 'Silence lands in a reading, it stops interpretation in its position and asks something '
    + 'instead: descent at the fourth seat, widening at the sixteenth, surrender at the '
    + 'twenty-second, recognition at the twenty-fifth. Do not translate a Silence. Meet what '
    + 'it asks.'],
  ['THE CAST',
    'This book teaches reading, not casting. The cast belongs to the vessel, where chance is '
    + 'unsteerable, committed and witnessable, and a composed spread is never presented as '
    + 'drawn.'],
  ['THE CIRCLE',
    'Counted one further, the last card becomes the first. The book is a circle.'],
];

const COLOPHON =
  'The Book of Luminara, Pressing One: the twenty-seven. Pressed from the sealed canon on '
  + 'the twelfth of July, 2026. The 81 position readings await the second edition. The one '
  + 'withheld thing is stated plainly in the sealed room. Figures derived, never drawn.';

// ---------------------------------------------------------------------------
// PAGE COMPOSITION
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cardPage(n) {
  const c = SAFE_CARDS[n - 1];
  const k = knotOf(n);
  const metal = metalOf(n);
  const cn = counterOf(n);
  const counterMetal = metalOf(cn);
  const colors = k.kind === 'link' ? [metal, counterMetal] : [metal];
  const moving = codeOf(n).filter((s) => s !== 0).length;
  const qLabel = k.q > 0 ? '+' + k.q : String(k.q);
  const cqLabel = k.q === 0 ? '0' : k.q < 0 ? '+' + -k.q : String(-k.q);
  const answer = n === 1
    ? 'Its answer is itself: the one self-paired card, the still point the other twenty-six lean around.'
    : 'Its answer is ' + cardName(cn) + ' (' + cn + ').';
  return '<div class="page card-page">'
    + '<div class="pcorner tl" style="color:' + metal + '">' + n + '</div>'
    + '<div class="pcorner tr">' + qLabel + '</div>'
    + '<div class="pcorner bl">' + cqLabel + '</div>'
    + '<div class="pcorner br" style="color:' + counterMetal + '">' + cn + '</div>'
    + '<div class="pfig">' + knotSvg(k.p, k.q, colors, 0.16 + 0.11 * moving, 0.7) + '</div>'
    + '<div class="pside">' + knotSvg(k.p, k.q, colors, 1.22, 0.5) + '</div>'
    + '<div class="pmarks" style="color:' + metal + '">' + codeMarks(n) + '</div>'
    + '<div class="pname">' + esc(c.name) + '</div>'
    + '<div class="pessence">' + esc(bookText(c.essence)) + '</div>'
    + '<div class="panswer">' + esc(answer) + '</div>'
    + '</div>';
}

function housePage(s) {
  const suit = SUITS[s];
  return '<div class="page house-page">'
    + '<div class="house-name">' + esc(suit.key) + '</div>'
    + '<div class="house-gloss">' + esc(bookText(suit.gloss)) + '</div>'
    + '<div class="house-cards">cards ' + (9 * s + 1) + ' to ' + (9 * s + 9) + '</div>'
    + '</div>';
}

function answersTable() {
  let rows = '';
  rows += '<tr><td class="tn">1</td><td>' + esc(cardName(1)) + '</td><td class="tmid">answers</td>'
    + '<td class="tn">1</td><td>itself</td><td class="tint">silence</td></tr>';
  for (let n = 2; n <= 27; n++) {
    const cn = counterOf(n);
    if (cn < n) continue;
    rows += '<tr><td class="tn">' + n + '</td><td>' + esc(cardName(n)) + '</td><td class="tmid">answers</td>'
      + '<td class="tn">' + cn + '</td><td>' + esc(cardName(cn)) + '</td>'
      + '<td class="tint">' + esc(knotOf(n).interval) + '</td></tr>';
  }
  return rows;
}

function appendixTable() {
  let rows = '';
  for (let n = 1; n <= 27; n++) {
    const k = knotOf(n);
    rows += '<tr><td class="tn">' + n + '</td>'
      + '<td class="tmk">' + codeMarks(n) + '</td>'
      + '<td class="tn">' + (k.q > 0 ? '+' + k.q : k.q) + '</td>'
      + '<td class="tn">' + k.p + '</td>'
      + '<td>' + esc(formOf(n)) + '</td>'
      + '<td class="tn">' + ratioOf(n) + '</td>'
      + '<td>' + esc(k.interval) + '</td>'
      + '<td class="tn">' + counterOf(n) + '</td></tr>';
  }
  return rows;
}

const DERIVATION = [
  'The card. Three layers (field, relation, core), each in one of three states (still, '
  + 'flowing, turning), written as dot, bar and wave. The card’s number is '
  + 'nine times the field, three times the relation, plus the core, plus one: every card a '
  + 'three-digit number in base three, every number a card.',
  'The signed number. Give each state a sign: flowing is plus one, turning is minus one, '
  + 'stillness is nought. Weigh the layers nine, three and one and sum. This is balanced '
  + 'ternary: every whole number from minus thirteen to thirteen appears exactly once. The '
  + 'deck is a signed number line; the Seed is its zero; collision is impossible by the '
  + 'numeral system itself, not by tuning.',
  'The windings. The signed number q winds through the ring; the winding count p carries '
  + 'the count of moving layers, one more than their number, and when the last stillness '
  + 'leaves, the windings redouble: the restless eight wind at seven. q carries the weight; '
  + 'p carries the count. q is the law; p is the voice.',
  'The forms. Draw each card as the torus knot T(p, q) on a golden torus. Where q is '
  + 'nought the card is the circle. Where the two numbers share a factor the strand closes '
  + 'early into separate rings: a link. Otherwise a knot, whose genus is half the product '
  + 'of the two numbers each less one. The census: one circle, two open coils, eighteen '
  + 'knots of which four are trefoils, and six link-cards in three bound pairs.',
  'The answer. Each card’s opposite negates every layer: still stays still, flowing '
  + 'and turning exchange. This is the deck’s involution; each card’s signed '
  + 'number negates; the Seed alone is its own answer. Meeting, a card and its answer sum '
  + 'to zero: the Seed.',
  'The sound. Every card is an interval: the two winding frequencies |q| against p, reduced. '
  + 'The Seed is silence. The Resonance and The Dreamer sound the perfect fifth; The Depth '
  + 'and The Threshold the fourth; The Bridge and The Beacon the tritone. Where the ratio '
  + 'reduces, the strand has locked into rings: the link-cards are the perfect consonances '
  + 'compounded, a harmony so complete the strand no longer needs to be one. Every becoming '
  + 'is a cadence toward consonance.',
];

// ---------------------------------------------------------------------------
export function pressBook() {
  const css = `
  @page { size: 148mm 210mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #000; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #E9E6DC; }
  .page { position: relative; width: 148mm; height: 209.5mm; page-break-after: always;
    overflow: hidden; background: #000; padding: 14mm 16mm; }
  .cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .cover-title { font-size: 21pt; letter-spacing: 0.32em; color: #EFE7CF; margin-bottom: 16mm; }
  .cover-fig { width: 64mm; margin-bottom: 16mm; }
  .cover-fig svg { width: 100%; overflow: visible; }
  .cover-author { font-size: 11pt; letter-spacing: 0.24em; color: rgba(233,230,220,0.75); }
  .plate { display: flex; flex-direction: column; justify-content: center; }
  .plate h2 { font-size: 13pt; letter-spacing: 0.22em; font-weight: normal; color: #EFE7CF;
    text-align: center; margin: 0 0 9mm; }
  .plate p { font-size: 10pt; line-height: 1.75; margin: 0 0 4.5mm; color: rgba(233,230,220,0.92); }
  .lineage { font-style: italic; text-align: center; color: rgba(233,230,220,0.8); }
  .colophon { font-size: 9pt; text-align: center; color: rgba(233,230,220,0.6); margin-top: 12mm; }
  .gram-sub { text-align: center; font-style: italic; font-size: 9.5pt;
    color: rgba(233,230,220,0.55); margin: -7mm 0 8mm; }
  .gram-h { font-size: 8pt; letter-spacing: 0.3em; color: rgba(233,230,220,0.45);
    margin: 0 0 1.6mm; }
  .approach-item { margin-bottom: 5mm; }
  .approach-lead { font-size: 10.5pt; color: #EFE7CF; }
  .approach-sub { font-size: 9.5pt; color: rgba(233,230,220,0.7); font-style: italic; }
  .house-page { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .house-name { font-size: 19pt; letter-spacing: 0.42em; color: #EFE7CF; }
  .house-gloss { font-size: 10.5pt; font-style: italic; color: rgba(233,230,220,0.7); margin-top: 6mm; }
  .house-cards { font-size: 9pt; color: rgba(233,230,220,0.45); margin-top: 3mm; font-family: Consolas, monospace; }
  .card-page { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .pcorner { position: absolute; font-family: Consolas, monospace; font-size: 9.5pt; color: rgba(233,230,220,0.5); }
  .pcorner.tl { top: 9mm; left: 10mm; }
  .pcorner.tr { top: 9mm; right: 10mm; }
  .pcorner.bl { bottom: 9mm; left: 10mm; }
  .pcorner.br { bottom: 9mm; right: 10mm; }
  .pfig { width: 88mm; margin-top: 2mm; }
  .pfig svg { width: 100%; overflow: visible; }
  .pside { width: 40mm; margin: -7mm 0 0; opacity: 0.85; }
  .pside svg { width: 100%; overflow: visible; }
  .pmarks { font-size: 10pt; letter-spacing: 0.42em; margin-top: 1mm; }
  .pname { font-size: 14pt; letter-spacing: 0.2em; text-transform: uppercase; color: #F2EFE6; margin-top: 2.5mm; }
  .pessence { font-size: 9.8pt; line-height: 1.7; color: rgba(233,230,220,0.88); margin-top: 5mm; max-width: 104mm; }
  .panswer { font-size: 9pt; font-style: italic; color: rgba(233,230,220,0.6); margin-top: 4mm; }
  table { border-collapse: collapse; margin: 0 auto; }
  td, th { font-size: 8.6pt; padding: 1.1mm 2.4mm; color: rgba(233,230,220,0.88);
    border-bottom: 0.2mm solid rgba(233,230,220,0.14); text-align: left; }
  th { color: rgba(233,230,220,0.55); font-weight: normal; letter-spacing: 0.1em; }
  .tn, .tmk { font-family: Consolas, monospace; }
  .tmid { color: rgba(233,230,220,0.45); font-style: italic; }
  .tint { font-style: italic; color: rgba(233,230,220,0.66); }
  .appendix p { font-size: 9.2pt; line-height: 1.65; }
  .lastpage { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .lastpage .ring { width: 40mm; margin-bottom: 12mm; }
  .lastpage .ring svg { width: 100%; overflow: visible; }
  .lastpage p { font-size: 10.5pt; color: rgba(233,230,220,0.85); line-height: 1.8; max-width: 96mm; }
  `;

  let pages = '';

  // cover
  pages += '<div class="page cover">'
    + '<div class="cover-title">THE BOOK OF LUMINARA</div>'
    + '<div class="cover-fig">' + triquetraSvg() + '</div>'
    + '<div class="cover-author">NILA PADMA</div>'
    + '</div>';

  // lineage + colophon
  pages += '<div class="page plate"><p class="lineage">' + esc(LINEAGE) + '</p>'
    + '<p class="colophon">' + esc(COLOPHON) + '</p></div>';

  // i. the way to approach
  pages += '<div class="page plate"><h2>THE WAY TO APPROACH</h2>'
    + '<p>Before any card, the approach. These are invitations, never gates.</p>'
    + APPROACH.map(([lead, sub]) =>
      '<div class="approach-item"><div class="approach-lead">' + esc(lead)
      + '</div><div class="approach-sub">' + esc(sub) + '</div></div>').join('')
    + '</div>';

  // ii. the interpreter's law
  pages += '<div class="page plate"><h2>THE INTERPRETER’S LAW</h2>'
    + '<p>Known inside the practice as the Caster’s Law: one law, two registers.</p>'
    + LAW_PARAS.map((p) => '<p>' + esc(p) + '</p>').join('')
    + '</div>';

  // iii. how this book is made
  pages += '<div class="page plate"><h2>HOW THIS BOOK IS MADE</h2>'
    + '<p>' + esc(MADE_PARA) + '</p></div>';

  // iv. the sealed room
  pages += '<div class="page plate"><h2>THE SEALED ROOM</h2>'
    + '<p>' + esc(SEALED_ROOM) + '</p></div>';

  // v. how to read, two pages: the page, then the reading
  const gramPage = (sub, items) => '<div class="page plate"><h2>HOW TO READ</h2>'
    + '<div class="gram-sub">' + esc(sub) + '</div>'
    + items.map(([head, body]) =>
      '<div class="gram-h">' + esc(head) + '</div><p>' + esc(body) + '</p>').join('')
    + '</div>';
  pages += gramPage('the page', READ_THE_PAGE);
  pages += gramPage('the reading', READ_THE_READING);

  // vi-viii. the three houses
  for (let s = 0; s < 3; s++) {
    pages += housePage(s);
    for (let i = 1; i <= 9; i++) pages += cardPage(9 * s + i);
  }

  // ix. the table of answers
  pages += '<div class="page plate"><h2>THE TABLE OF ANSWERS</h2>'
    + '<table><tr><th></th><th></th><th></th><th></th><th></th><th>the shared interval</th></tr>'
    + answersTable() + '</table></div>';

  // x. the appendix
  pages += '<div class="page plate appendix"><h2>APPENDIX: THE DERIVATION</h2>'
    + DERIVATION.map((p) => '<p>' + esc(p) + '</p>').join('')
    + '</div>';
  pages += '<div class="page plate appendix"><h2>APPENDIX: THE TWENTY-SEVEN</h2>'
    + '<table><tr><th>no.</th><th>code</th><th>q</th><th>p</th><th>form</th><th>ratio</th><th>interval</th><th>answer</th></tr>'
    + appendixTable() + '</table></div>';

  // xi. the last page
  pages += '<div class="page lastpage">'
    + '<div class="ring"><svg viewBox="-2.85 -2.85 5.7 5.7"><circle r="2.2" fill="none" stroke="'
    + WHITEGOLD + '" stroke-width="0.09" stroke-opacity="0.85"/></svg></div>'
    + '<p>Counted one further, the last card becomes the first: the wave rolls over and every '
    + 'mark returns to the dot. The book you have finished is a circle. Begin where you are.</p>'
    + '</div>';

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>The Book of Luminara</title><style>' + css + '</style></head><body>'
    + pages + '</body></html>';
  return { html };
}

if (import.meta.main) {
  const { html } = pressBook();
  const outPath = new URL('../docs/the-book-of-luminara-p1.html', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');
  await Bun.write(outPath, html);
  console.log('pressed: ' + outPath + ' (' + html.length + ' chars)');
}
