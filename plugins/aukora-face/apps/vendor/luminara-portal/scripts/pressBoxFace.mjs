// THE BOX FACE — the emblem alone, for the lid of the deck's box.
//
// The one figure the deck wears on the outside: the trefoil struck down the
// torus axis, T(2,3) at beta nought, one petal up, inside the two ghost
// rings. It is the same triquetraSvg the guide closes on and the Book
// carries, imported rather than redrawn, so the box can never show a
// different emblem from the volumes inside it.
//
// NO WORD ON THE LID (the architect's ruling). The name was set beneath the
// figure and then struck: a deck whose whole claim is that the shapes speak
// for themselves does not need to say its own name on the outside of the
// box. The emblem stands alone and centred on the trimmed face.
//
// WHY THE TREFOIL AND NOT ANOTHER CARD. It is the first knot that genuinely
// cannot be untied, so it is what the deck's first position is named for; it
// arrives four times in AUM and nowhere else; and looked down the axis it is
// threefold, which is the whole system in one glance. Nothing here is drawn
// by hand.
//
// Run:  bun scripts/pressBoxFace.mjs
// then press to PDF with headless Edge (--print-to-pdf, fresh profile).
//
// The sheet is square and carries a 3mm bleed: the lid is trimmed to taste,
// and the emblem sits on the trimmed centre rather than the bled one.

import { triquetraSvg } from './pressBookOfLuminara.mjs';

// the lid, in millimetres. TRIM is the finished face; BLEED runs past the cut.
const TRIM = 90;
const BLEED = 3;
const SHEET = TRIM + 2 * BLEED;

export function pressBoxFace() {
  const css = `
  @page { size: ${SHEET}mm ${SHEET}mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #000; }
  body { font-family: Georgia, 'Times New Roman', serif; }
  .sheet { position: relative; width: ${SHEET}mm; height: ${SHEET}mm; background: #050505;
    display: flex; align-items: center; justify-content: center; overflow: hidden; }
  /* the trimmed face, centred in the bleed: everything lives in here */
  .face { width: ${TRIM}mm; height: ${TRIM}mm; display: flex; flex-direction: column;
    align-items: center; justify-content: center; }
  .emblem { width: ${TRIM * 0.52}mm; }
  .emblem svg { width: 100%; height: auto; overflow: visible; display: block; }
  /* the cut marks sit in the bleed and are struck off when the lid is trimmed */
  .crop { position: absolute; background: rgba(233,230,220,0.5); }
  .crop.h { width: ${BLEED * 0.7}mm; height: 0.2mm; }
  .crop.v { width: 0.2mm; height: ${BLEED * 0.7}mm; }
  `;

  const marks = [];
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const px = x ? `right: 0;` : `left: 0;`;
    const py = y ? `bottom: ${BLEED}mm;` : `top: ${BLEED}mm;`;
    marks.push(`<div class="crop h" style="${px}${py}"></div>`);
    const qx = x ? `right: ${BLEED}mm;` : `left: ${BLEED}mm;`;
    const qy = y ? `bottom: 0;` : `top: 0;`;
    marks.push(`<div class="crop v" style="${qx}${qy}"></div>`);
  }

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>Luminara: the box face</title><style>' + css + '</style></head><body>'
    + '<div class="sheet">' + marks.join('')
    + '<div class="face">'
    + '<div class="emblem">' + triquetraSvg() + '</div>'
    + '</div></div></body></html>';
  return { html, trim: TRIM, bleed: BLEED, sheet: SHEET };
}

if (import.meta.main) {
  const { html, trim, bleed, sheet } = pressBoxFace();
  const outPath = new URL('../docs/luminara-box-face.html', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');
  await Bun.write(outPath, html);
  console.log('pressed: ' + outPath
    + ' (trim ' + trim + 'mm, bleed ' + bleed + 'mm, sheet ' + sheet + 'mm)');
}
