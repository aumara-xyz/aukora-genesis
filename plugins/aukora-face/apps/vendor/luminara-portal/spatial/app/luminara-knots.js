// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// Aukora Spatial · LUMINARA: the shared knot renderer.
//
// One renderer, every consumer: THE CARDS page and the portal organ both draw
// the deck through this module, so the tempered rendition can never drift
// between surfaces. The DERIVATION lives in luminara-canon.js (knotOf: q the
// law, p the voice); this file owns only presentation: the golden torus
// projection, depth as luminance, and the three metals.
//
// THE THREE METALS are the states themselves (the architect's rulings):
// SILVER FLOWS (quicksilver, the one metal that runs; MA, the blade),
// GOLD TURNS (the circling sun; RA, the dawn), BRONZE HOLDS STILL (the alloy
// that stands millennia; AUM, the bulk). A card wears its field's metal; the
// Seed alone wears white-gold, the zero above the three. Links weave their
// own metal with their counter-card's.
//
// THE TEMPERED RENDITION (the architect's tuning): 80% flat metal, 20%
// molten. Depth still reads as temperature, but only a fifth of the way.

import { codeOf } from './luminara-canon.js';

const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLD = '#F0C25E', SILVER = '#C9D3E2', BRONZE = '#C9873D', WHITEGOLD = '#EFE7CF';
export const metalOf = (n) => {
  if (n === 1) return WHITEGOLD;
  const f = codeOf(n)[0];
  return f === 0 ? BRONZE : f === 1 ? SILVER : GOLD;
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

const MOLTEN_MIX = 0.20;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp3 = (A, B, t) => A.map((v, i) => Math.round(v + (B[i] - v) * t));
const RAMPS = {};
export function rampOf(metal) {
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

// The strand paths of T(p, q) on the golden torus (R = φ, r = 1), projected
// at tilt beta, depth-sorted, luminance and width by depth. Returns the path
// elements only (knot-space coordinates, extent ±2.85) so a consumer can
// place and scale them inside its own svg; knotSvg wraps them standalone.
export function knotPaths(p, q, colors, beta, dens) {
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
  let s = '';
  for (const [j, zm, f] of segs) {
    const ramp = rampOf(colors[f % colors.length]);
    const zn = (zm - zLo) / zSpan;
    const col = ramp[Math.round(zn * 23)];
    const w = (0.055 + 0.135 * zn).toFixed(3);
    const op = (0.20 + 0.78 * zn).toFixed(2);
    s += '<path d="M' + P(j) + ' L' + P(j + 1) + '" stroke="' + col + '" stroke-width="' + w
      + '" stroke-opacity="' + op + '" fill="none" stroke-linecap="round"/>';
  }
  return s;
}

export function knotSvg(p, q, colors, beta, dens) {
  return '<svg viewBox="-2.85 -2.85 5.7 5.7" aria-hidden="true">'
    + knotPaths(p, q, colors, beta, dens) + '</svg>';
}

// THE GLYPH INK: the knot rendered small, as a glyph on an instrument face.
// knotPaths encodes depth TWICE, in stroke width (0.055 to 0.190) and in
// opacity (0.20 to 0.98). At card size that reads beautifully; at glyph size
// the thick near-strands blob and the form stops being traceable. So the
// widths are REMAPPED rather than scaled: the range is compressed toward a
// legible band while opacity is left untouched, and depth goes on speaking
// through brightness alone. The thick strands halve, the faint ones barely
// move, and the form opens. FLOOR is the thinnest strand; SPAN is how much
// width still varies with depth (the renderer's own span is 0.135).
// Shared, because both instruments draw the same glyphs at the same weight.
export const INK_FLOOR = 0.14, INK_SPAN = 1.35;
export const glyphInk = (svg) => svg.replace(/stroke-width="([\d.]+)"/g,
  (_, w) => 'stroke-width="' + (INK_FLOOR + (parseFloat(w) - 0.055) * INK_SPAN).toFixed(3) + '"');
