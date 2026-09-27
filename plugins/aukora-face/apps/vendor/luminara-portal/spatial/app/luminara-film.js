// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA FILM: the same standing wave, read as a SOAP BUBBLE.
//
// The sand reads the wave by POSITION: grains gather where the plate is
// still. The glow reads it by BRIGHTNESS. The film reads it by COLOUR, and
// it is the only one of the three whose colour is not ours to choose. The
// iridescence is computed from the physics and comes out the way it comes
// out; the palette is the arithmetic's, not the designer's.
//
// WHY A FILM IS COLOURED AT ALL. Light striking a soap film reflects twice,
// once off the front surface and once off the back, and the two reflections
// interfere. Which wavelengths survive depends on how much further the second
// one travelled, and that is fixed by one quantity only: the film's
// THICKNESS. The wave reflecting off the front surface goes from air into
// soap, low index into high, and takes a half-wave flip; the one off the back
// goes high into low and takes none. Fold that half-wave into the round trip
// of 2nd and the standard normal-incidence result for a soap film in air is
//
//     I(lambda) = sin^2( 2 * pi * n * d / lambda ),    n = 1.33
//
// with d in nanometres. Evaluate it at a representative red, green and blue
// and the colour falls out. This module implements exactly that, in
// nanometres throughout, and nothing else decides the hue.
//
// THE THICKNESS IS THE FIGURE. A driven film is not flat. The standing wave
// piles liquid where it is high and stretches it thin where it is low, so
//
//     d(x, y) = BASE_NM + SWING_NM * field(x, y)
//
// which puts the NODES at one single thickness, and therefore at one single
// colour, threading the figure like a wire; the antinodes run away from that
// thickness in both directions and paint the colour orders on either side.
// BASE 340 nm and SWING 320 nm give d in [20, 660] nm, and that span is
// chosen for one reason: it carries about three colour orders. Red, green and
// blue pass through 3, 3 and 4 fringes across it respectively, and it is
// precisely because they de-phase at different rates that the plate reads as
// iridescent rather than as grey stripes. Wider and the orders pile up muddy;
// narrower and there is only one band and no sequence to see.
//
// THE BLACK FILM IS FREE. sin^2 goes to zero as d does, so the deepest
// troughs, where the wave has stretched the film to a few tens of nanometres,
// darken on their own: the black film, the last thing a bubble shows before
// it bursts. We did not add it. It is what the formula says, and it is why
// the unstruck card is dark: a film that is not being driven simply drains,
// and a drained film is black. No sand on silence, and no colour either.
//
// CLARITY IS THE COHERENCE LENGTH OF THE LIGHT. This is the piece worth
// reading twice. Real illumination is not three wavelengths, it is three
// BANDS, and averaging sin^2 over a band of width sigma in wavelength gives
//
//     I = 1/2 - 1/2 * V(d) * cos(4 * pi * n * d / lambda),
//     V(d) = exp( -( 4 * pi * n * d * sigma / lambda^2 )^2 / 2 )
//
// V is the fringe visibility, and it decays with thickness: broad light
// cannot hold a high-order fringe together. At sigma near zero V is 1 and the
// expression collapses back to sin^2 exactly. So a locked consonance is lit
// by narrow light (sigma 18 nm) and shows crisp concentric orders all the way
// out; the far dissonance is lit by broad light (sigma 64 nm) and its outer
// orders wash to soap grey while only the first survives. Coherence is
// rendered as coherence, in the optical sense of the word, and the crispness
// of the bands is the physics of the lamp rather than a blur we applied.
//
// WHAT IS REAL PHYSICS HERE, PLAINLY:
//   · the interference law and its half-wave flip: real, standard, exact at
//     normal incidence
//   · the visibility envelope under finite bandwidth: real, and the actual
//     reason real soap films only ever show four or five orders
//   · the black film in the thin limit: real, and unforced
// WHAT IS SCAFFOLD, NAMED:
//   · d = base + swing * field is a linear caricature of how a driven film
//     redistributes its liquid. The sign and the shape are right; the
//     constants are a reading, not a measurement.
//   · the churn that detune adds to the thickness stands in for marginal
//     regeneration, the turbulent hand-over of liquid in a real film. It is
//     the glyph's idiom (a spiral in r and theta), not a fluid solve.
//   · the field itself is luminara-sand's shared standing wave, scaffold or
//     Bessel by name, exactly as the sand and the glow read it.
// WHAT IS LEFT OUT, AND WHY: gravitational drainage. A real film hung in a
// ring is thinner at the top and its orders lie in horizontal bands. It is
// honest physics and it would tilt every figure on the plate, so it is
// omitted deliberately: this surface exists to be READ, and the drainage
// gradient would compete with the thing being read.
//
// opts.tint does not choose the colour and cannot. It leans the INCIDENT
// light towards the card's metal, normalised to unit mean and applied at
// about a third strength, so a copper card is lit a little warm and a
// white-gold card is lit almost neutrally. The interference still decides
// which wavelengths come back.
//
// THE BOW LIFTING reads differently here than on the sand, and the difference
// is honest rather than a compromise. Sand that stops being kicked keeps its
// places, so the sand's figure freezes where it landed. A film that stops
// being driven has liquid that flows back, so its colour orders collapse
// inward towards the one still colour as gain falls. At gain zero the loop
// stops updating altogether and the last image stands: not cleared, per the
// contract, and by then the film is showing what an undriven film shows.
//
// 2D canvas, no libraries, one coarse ImageData buffer per plate. Three
// economies, all of them free of any per-card knowledge:
//   · the buffer is coarse. Interference bands are broad, so the film reads
//     at under half the plate's resolution and loses nothing.
//   · the thickness-to-colour scale is tabulated, not evaluated per pixel.
//   · the field is resampled at 30 Hz, not 60. The modes drift at well under
//     a radian per second, so this oversamples the motion by a factor of
//     tens; it is the cheapest honest saving available and it is what lets a
//     full twenty-seven-cell grid cost less per frame than the sand does.

import { fieldAt, profilesFor } from './luminara-sand.js';

const N_SOAP = 1.33;                 // soapy water, near enough to water
const LAMBDA = [610, 550, 465];      // representative R, G, B, nanometres
const BASE_NM = 340;                 // the nodal thickness: the still colour
const SWING_NM = 320;                // the wave's pile and stretch, nanometres
const D_TOP = BASE_NM + SWING_NM;    // 660 nm: about three colour orders
const SIG_CLEAR = 18;                // nm: narrow light, the locked consonance
const SIG_MUD = 64;                  // nm: broad light, the far dissonance
const N_SCALE = 512;                 // steps in the thickness-to-colour scale
const SCALE_STEP = (N_SCALE - 1) / D_TOP;
const TINT_LEAN = 0.35;              // how far the lamp leans to the metal
const CHURN = 0.30;                  // marginal regeneration, at full detune
const STEP_MIN = 1 / 30;             // seconds: the resample cadence, see above
const TAU = 6.28318;

// ---------------------------------------------------------------------------
// THE COLOUR SCALE. Thin-film colour is a function of thickness and nothing
// else, so the whole optical law lives in one 512-entry table rebuilt only
// when clarity moves. This is not an approximation of the physics, it IS the
// physics, tabulated: the same object a mineralogist calls a Michel-Levy
// chart. The per-pixel work is then a multiply and a lookup.
//   coh  clarity in [0,1]: sets the bandwidth of the light, hence how far out
//        the fringes stay visible before they wash to grey
//   ill  the lamp's per-channel lean (opts.tint, normalised to unit mean)
// ---------------------------------------------------------------------------
function buildScale(scale, coh, ill) {
  const sig = SIG_CLEAR + (1 - coh) * (SIG_MUD - SIG_CLEAR);
  for (let c = 0; c < 3; c++) {
    const lam = LAMBDA[c];
    const k = (4 * Math.PI * N_SOAP) / lam;               // phase per nm of d
    const a = (4 * Math.PI * N_SOAP * sig) / (lam * lam); // visibility decay per nm
    for (let i = 0; i < N_SCALE; i++) {
      const d = (i / (N_SCALE - 1)) * D_TOP;
      const ad = a * d;
      const vis = Math.exp(-0.5 * ad * ad);
      // I = 1/2 - 1/2 V cos(4 pi n d / lambda); at V = 1 this is exactly
      // sin^2(2 pi n d / lambda), and at d = 0 it is exactly zero: the black film
      const I = (0.5 - 0.5 * vis * Math.cos(k * d)) * ill[c];
      scale[i * 3 + c] = I <= 0 ? 0 : I >= 1 ? 255 : I * 255;
    }
  }
}

export function createBubbleFilm(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');

  let modes = opts.spectrum || [];
  let fieldKind = opts.field === 'bessel' ? 'bessel' : 'scaffold';
  let prof = profilesFor(modes, fieldKind);   // resolved per spectrum, never per pixel
  const getCoh = typeof opts.coherence === 'function'
    ? opts.coherence
    : () => (typeof opts.coherence === 'number' ? opts.coherence : 0.6);
  const tint = opts.tint || [239, 231, 207];
  const struck = opts.struck !== false;
  // dimmed when something rides above the film (the knot overlay's register)
  const alpha = typeof opts.alpha === 'number' ? opts.alpha : 0.85;
  let gain = typeof opts.gain === 'number' ? opts.gain : 1;

  // the lamp: the card's metal, normalised to unit mean so it leans the
  // incident light without deciding what comes back
  const mean = (tint[0] + tint[1] + tint[2]) / 3 || 1;
  const ILL = [0, 1, 2].map((i) => 1 + TINT_LEAN * (tint[i] / mean - 1));

  const scale = new Uint8Array(N_SCALE * 3);
  let scaleKey = -1;                          // quantised clarity the scale was built for

  let W = 0, H = 0, dpr = 1, BW = 0, BH = 0;
  let img = null, IDX = null, PX = null, PY = null, PR = null, PTH = null, PM = null;
  let t = 0, prev = 0, rafId = 0, ro = null, dirty = true, acc = 0;
  // THE STIR: the bow's touch drags the film's liquid round with it, carrying
  // the thickness pattern bodily, and viscosity takes it back to rest. Same
  // one-shot impulse as the sand bed, same signature, applied to the sampling
  // frame instead of to grains.
  let stirV = 0, stirSign = 1, stirAng = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    // the buffer is deliberately coarse: interference bands are broad, so the
    // film loses nothing at well under half the plate's resolution, and this
    // is what lets a full 27-cell grid stay alive. The cap is what keeps one
    // large plate cheap; the factor is what keeps twenty-seven small ones so.
    BW = BH = Math.max(40, Math.min(128, Math.round(Math.min(W, H) * 0.45)));
    off.width = BW; off.height = BH;
    img = octx.createImageData(BW, BH);

    // the inscribed disc, resolved once: everything outside radius 1 is left
    // fully transparent here and never touched again
    const cx = (BW - 1) / 2, cy = (BH - 1) / 2, rad = Math.min(cx, cy);
    const idx = [], px = [], py = [], pr = [], pth = [], pm = [];
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const dx = (x - cx) / rad, dy = (y - cy) / rad;
        const rr = Math.hypot(dx, dy);
        if (rr > 1) continue;
        // a soft last pixel or two so the rim reads round once scaled up
        const m = Math.min(1, (1 - rr) * rad / 1.5);
        if (m <= 0) continue;
        idx.push(y * BW + x);
        px.push(dx); py.push(dy); pr.push(rr); pth.push(Math.atan2(dy, dx)); pm.push(m);
      }
    }
    IDX = Int32Array.from(idx);
    PX = Float32Array.from(px); PY = Float32Array.from(py);
    PR = Float32Array.from(pr); PTH = Float32Array.from(pth);
    PM = Float32Array.from(pm);
    scaleKey = -1;                            // force one rebuild of the colour scale
    dirty = true;                             // a resized canvas is a blank one: repaint
  }

  function paintRim() {
    const cw = canvas.width, ch = canvas.height;
    const s = Math.min(cw, ch) * 0.94;
    ctx.strokeStyle = 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ','
      + (0.18 * alpha / 0.85).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2, s / 2, 0, TAU);
    ctx.stroke();
  }

  function stepFrame(dt) {
    const coh = Math.max(0, Math.min(1, getCoh()));
    const detune = 1 - coh;
    const key = Math.round(coh * 64);
    if (key !== scaleKey) { buildScale(scale, coh, ILL); scaleKey = key; }

    // the stir: the film turns bodily and viscosity slows it
    const stirring = gain > 0.001 && stirV > 0.02;
    if (stirring) {
      stirAng += stirSign * stirV * (dt || 0.016);
      stirV *= Math.exp(-(dt || 0.016) / 0.45);
    }
    const ca = Math.cos(stirAng), sa = Math.sin(stirAng);
    const turned = stirAng !== 0;
    // the churn rides the BOW as well as the dissonance: a lifted bow drives
    // nothing, so an undriven film must not keep handing its liquid about
    // (the adversarial pass caught a full-amplitude churn at gain zero)
    const churn = detune * CHURN * gain;

    const data = img.data;
    const n = IDX.length;
    for (let j = 0; j < n; j++) {
      let x = PX[j], y = PY[j];
      if (turned) { const rx = x * ca - y * sa; y = x * sa + y * ca; x = rx; }
      let u = fieldAt(modes, prof, x, y, t, detune) * gain;
      // marginal regeneration: a dissonant film hands its liquid about and
      // will not hold a thickness, so the orders break rather than close.
      // Two constraints fix the scale of it. The theta multiplier must be a
      // whole number or the churn is not single-valued on the disc and
      // atan2's branch cut shows up as a seam along the negative x axis; 7 is
      // whole and shares no factor with the 3, 6, 9 ladder, so it never locks
      // to the figure it is disturbing. And the pattern must stay well inside
      // the coarse buffer's Nyquist limit, or it aliases into speckle: at
      // these numbers it is roughly a dozen broad plumes across the disc,
      // which is both what a real film does and what a 40 px buffer can hold.
      if (churn > 0.001) u += churn * Math.sin(PR[j] * 17 + PTH[j] * 7 + t * 1.9);
      // the thickness, and with it the colour: nodes at BASE, antinodes thick
      // and thin either side of it
      let si = ((BASE_NM + SWING_NM * u) * SCALE_STEP) | 0;
      if (si < 0) si = 0; else if (si >= N_SCALE) si = N_SCALE - 1;
      const p = IDX[j] * 4, q = si * 3;
      data[p] = scale[q];
      data[p + 1] = scale[q + 1];
      data[p + 2] = scale[q + 2];
      data[p + 3] = PM[j] * alpha * 255;
    }
    octx.putImageData(img, 0, 0);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const s = Math.min(canvas.width, canvas.height) * 0.94;
    ctx.drawImage(off, 0, 0, BW, BH,
      (canvas.width - s) / 2, (canvas.height - s) / 2, s, s);
    paintRim();
  }

  function paintDrained() {
    // the unstruck card: a film nobody is driving drains to the black film,
    // so there is nothing to colour. Only the wire that holds it remains.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintRim();
  }

  (function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
    prev = now;
    if (!img) return;
    if (!struck) { if (dirty) { paintDrained(); dirty = false; } return; }
    // the bow lifted: the last image stands frozen, it does not clear. The
    // film keeps whatever thickness it was left holding.
    if (gain < 0.004 && !dirty) { acc = 0; return; }
    // resample at STEP_MIN, but advance the wave's own clock by the real
    // elapsed time, so the cadence costs frames and never changes the physics
    acc += dt;
    if (acc < STEP_MIN && !dirty) return;
    t += acc;
    stepFrame(acc);
    acc = 0;
    dirty = false;
  })(performance.now());

  resize();
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }

  return {
    setSpectrum: (sp) => {
      if (sp?.length) { modes = sp; prof = profilesFor(modes, fieldKind); dirty = true; }
    },
    setGain: (g) => { gain = Math.max(0, Math.min(1, Number(g) || 0)); },
    // the radial law, chosen by name: 'scaffold' (the default) or 'bessel'
    setField: (kind) => {
      fieldKind = kind === 'bessel' ? 'bessel' : 'scaffold';
      prof = profilesFor(modes, fieldKind);
      dirty = true;
    },
    // the bow drags the film round: one impulse, signed by the card's motion
    stir: (sign, v = 2.4) => { stirSign = sign >= 0 ? 1 : -1; stirV = Math.max(stirV, v); },
    field: () => fieldKind,
    destroy: () => { cancelAnimationFrame(rafId); try { ro?.disconnect(); } catch { /* */ } },
  };
}
