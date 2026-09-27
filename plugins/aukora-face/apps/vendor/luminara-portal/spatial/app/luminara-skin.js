// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA SKIN: the brush engine (the architect's redesign, 2026-07-16).
//
// THE BRIDGE THIS IS: the visual half of a coming exploration layer for the
// cymatics AND THEIR SOUNDS: another face of the same shape. For now the
// brushes are visual; the sounding seat (the instrument guide, seat 7) joins
// through this same contract when its day comes. Any surface that wants to
// wear the harmonics (the Wayfinder's cube, the stack's layers, the future
// exploration layer) paints through here, so the rendition can never drift
// between them.
//
// THE BRUSHES are the instrument's own preset modes, used as paint:
//   · SAND (the plate): matte, granular, the figure drawn by what rests
//   · GLOW (the field): luminous, the figure drawn by what flows
// The brush follows the STATE, by the canon's own signs: still and turning
// paint with sand; FLOW paints with glow. Tint is the sealed metal law
// (bronze holds still, silver flows, gold turns); motion is the sealed
// drift law (net rotation 0 · +0.5 · −0.5).
//
// paintSkin() maps a living brush canvas INTO a 3d plane: a unit square
// affine-mapped by the plane's own basis vectors and clipped to its edges:
// tilework on the solid. Geometry arrives in pixels; the caller owns its
// viewBox mathematics.

import { createSandPlate } from './luminara-sand.js';
import { createGlyph } from './coherence-glyph.js';
import { GOLD, SILVER, BRONZE } from './luminara-knots.js';

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export const STATE_METAL = [BRONZE, SILVER, GOLD];   // still · flow · turning
export const STATE_DRIFT = [-0.2, 0.3, -0.7];        // net rotation 0 · +0.5 · −0.5

// how a state paints: one pure mode on the 3·6·9 ladder, in its metal,
// moving as it moves, rendered by its own preset
export function brushOf(state) {
  return {
    renderer: state === 1 ? 'glow' : 'sand',
    spectrum: [{
      n: 3 * (state + 1), m: 2, w: 1, phase: 0,
      motion: [0, 1, -1][state], drift: STATE_DRIFT[state],
    }],
    tint: rgbOf(STATE_METAL[state]),
  };
}

// paint one skin onto a parallelogram plane.
//   container : the positioned element the skin lives in
//   before    : sibling the skin is inserted before (so it renders beneath)
//   originPx  : [x, y] of the plane's origin corner, in container pixels
//   Upx, Vpx  : the plane's two edge vectors, in pixels
//   state     : 0 still · 1 flow · 2 turning, chooses the brush
//   opacity   : the painter's value; shading lives here
//   rotDeg    : in-plane rotation of the figure (lean toward a corner)
// returns { el, destroy() }
export function paintSkin({ container, before, originPx, Upx, Vpx, state, opacity = 1, rotDeg = 0, resolution = 220 }) {
  const S = resolution;
  const wrap = document.createElement('div');
  wrap.className = 'lskin';
  wrap.style.cssText = 'position:absolute; overflow:hidden; pointer-events:none;'
    + 'transform-origin:0 0; left:0; top:0; width:' + S + 'px; height:' + S + 'px;'
    + 'opacity:' + opacity + ';'
    + 'transform:matrix(' + (Upx[0] / S).toFixed(4) + ',' + (Upx[1] / S).toFixed(4) + ','
    + (Vpx[0] / S).toFixed(4) + ',' + (Vpx[1] / S).toFixed(4) + ','
    + originPx[0].toFixed(1) + ',' + originPx[1].toFixed(1) + ');';
  const cv = document.createElement('canvas');
  const CS = Math.round(S * 2.0);   // the figure spills past the face; the edges clip it
  cv.style.cssText = 'position:absolute; display:block;'
    + 'left:' + (-(CS - S) / 2) + 'px; top:' + (-(CS - S) / 2) + 'px;'
    + 'width:' + CS + 'px; height:' + CS + 'px;'
    + (rotDeg ? 'transform:rotate(' + rotDeg + 'deg);' : '');
  wrap.appendChild(cv);
  container.insertBefore(wrap, before);
  const brush = brushOf(state);
  const plate = brush.renderer === 'glow'
    ? createGlyph(cv, { spectrum: brush.spectrum, coherence: 1, transmute: 1 })
    : createSandPlate(cv, { spectrum: brush.spectrum, coherence: 1, alpha: 0.85, tint: brush.tint });
  return { el: wrap, destroy: () => { plate.destroy(); wrap.remove(); } };
}
