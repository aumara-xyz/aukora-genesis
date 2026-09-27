// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA WATER: the same standing wave, read on a LIQUID surface. The
// Faraday reading: vibrate a shallow dish and the liquid stands in the very
// figure the sand plate draws, but almost nothing about the water itself is
// visible. What the eye sees is the LIGHT the water bends. So this renderer
// draws no wave at all. It draws where the light lands.
//
// THE OPTICS, and they are the real ones:
//   · the field is the surface height h(x, y). A ray falling on the surface
//     is bent toward the thicker water, so a ray landing at x reaches the
//     floor of the dish at x + c·∇h: the refracted ray map.
//   · the light gathered at a point is the area element of that map,
//     det(I + c·Hess(h)), which to first order is 1 + c·∇²h. The brightness
//     is therefore 1/|1 + c·∇²h|. That is WHY the figure appears as the
//     LAPLACIAN of the height, and it is also why a caustic is not a bright
//     patch but a CURVE: where 1 + c·∇²h passes through zero the map folds,
//     neighbouring rays pile onto one line, and the light there is bounded
//     only by how finely the surface is sampled. Those fold curves are the
//     figure. Everything else is the level the calm dish already returns.
//   · the Laplacian and the gradient are taken with the standard 5-point
//     stencil on the sampled height, in unit-disc coordinates.
//   · what tilts, glints. The surface normal is (-∂ₓh, -∂ᵧh, 1) normalised,
//     and it is lit twice: by the sky straight overhead, which a FLAT facet
//     mirrors back to the eye as an even sheen, and by one low lamp, which
//     only the tilted flanks throw back. That pairing is the whole reading of
//     water. The nodal lines are still, so they mirror cleanly; the antinodes
//     are bent, so they break the light.
//
// WHAT IS REAL AND WHAT IS SCAFFOLD, plainly:
//   REAL      the refracted ray map and its area element; the fold condition
//             det = 0 as the definition of a caustic; the 5-point stencil;
//             the Blinn reflection taken off the true surface normal; and the
//             field itself, shared with every other cymatic surface here.
//   SCAFFOLD  the SCALE of the deformation. Nothing in the canon fixes the
//             ripple height or the depth of the dish, and both enter the
//             optics only through one product c. So c is set from the FIGURE's
//             own mean absolute curvature, an exposure, the way an eye adapts,
//             and never from a per-card number. The bow's gain then multiplies
//             it, so pressure really is ripple height: a simmer barely troubles
//             the mirror, a full stroke folds it. The slope is normalised the
//             same way, to the frame's own steepest flanks. The optics are
//             exact; where the working point sits on them is chosen.
//   SCAFFOLD  normal incidence. The caustic is computed paraxially, as though
//             the illumination fell straight down. The lamp's obliquity is
//             used for the glint only, where it is the whole point.
//   FOUND     the scaffold radial law has a genuine singular point at the
//             origin, and this reading is what found it. For n ≥ 2 the surface
//             behaves as r·cos(nθ) there, whose Laplacian goes as 1/r in 2n
//             spokes: a real starburst in the field, not a rendering fault.
//             Sand and glow never saw it because they read only the amplitude,
//             and it takes a second derivative to find it. Two consequences
//             are handled where they arise, both named in place: the exposure
//             is averaged robustly so that one point cannot take the plate's
//             light, and the unreadable centre is returned to calm. Choosing
//             'bessel' removes the point at its source, since J_n goes as r^n.
//   HELD DOOR a true Faraday surface swings sign at HALF the drive frequency,
//             so across one cycle both families of antinodes take their turn
//             at converging. This plate holds the envelope instead, because a
//             figure strobing at the drive rate is unreadable on a screen.
//             Named here, not hidden: it is why the bright arcs favour one
//             family and leave the other dark.
//
// SILENCE IS NOT A SPECIAL CASE. An unstruck card drives the surface with
// nothing: h is flat, the ray map is the identity, no fold exists anywhere,
// and every facet is upright. The dish reads as a still dark mirror. That is
// the same code path with the amplitude at zero, which is the honest way to
// render silence on water (the sand plate's ruling: no sand is poured on
// silence). setGain is the bow's pressure, and when it falls to zero the
// surface HOLDS the last figure rather than clearing: a real dish would relax
// flat in a second, and this one does not, the same instrument's licence the
// sand plate takes when its grains stop moving.
//
// COST. The field is read once per cell of a coarse square buffer (48 to 128
// a side, about half the display resolution), written into ImageData and
// drawn up smoothed, exactly as coherence-glyph.js does it. Sharing each
// reading between neighbours is also what makes the stencil affordable: five
// separate readings per cell would be five times the field. The caustic is
// band-limited by the modes, not by the buffer, so the interpolation costs
// nothing real. A 27 cell bench and one large plate land in the same budget
// the sand plate already keeps.

import { fieldAt, profilesFor } from './luminara-sand.js';


// the one lamp: low, and off to the upper left, with a viewer looking straight
// down at the dish. Its Blinn half vector is derived here at load, never typed.
const norm3 = (v) => { const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
const LAMP = norm3([-0.55, -0.62, 0.56]);
const HALF = norm3([LAMP[0], LAMP[1], LAMP[2] + 1]);   // + the view direction, straight down

const WORK = 1.30;    // where the fold is placed on the figure's own curvature
const TILT = 0.62;    // the steepest flank, as a slope: about 32 degrees
const ADAPT = 0.15;   // how fast the exposure follows the figure, per frame
const KNEE = 1.6;     // the display's shoulder: a fold is bright, never infinite
const GLOSS = 0.55;   // how far a highlight clips toward the illuminant's white

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// createWaterPlate(canvas, opts) matches createSandPlate exactly, so the bench
// can swap one reading of the field for another without knowing which it holds.
//   opts: { spectrum, coherence, gain, tint:[r,g,b], struck, alpha, field }
export function createWaterPlate(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');

  let modes = opts.spectrum || [];
  let fieldKind = opts.field === 'bessel' ? 'bessel' : 'scaffold';
  let prof = profilesFor(modes, fieldKind);   // null while the scaffold is chosen
  const getCoh = typeof opts.coherence === 'function'
    ? opts.coherence
    : () => (typeof opts.coherence === 'number' ? opts.coherence : 0.6);
  // the illuminant is the card's metal. Held by reference, never copied: the
  // stage re-tints this array in place as the struck card changes.
  const tint = opts.tint || [239, 231, 207];
  const struck = opts.struck !== false;
  // how strongly the dish shows at all: dimmed when something rides above it
  const alpha = typeof opts.alpha === 'number' ? opts.alpha : 0.85;
  let gain = typeof opts.gain === 'number' ? opts.gain : 1;
  // the ripple height actually standing on the surface. It follows the bow,
  // and when the bow lifts it is simply not updated: the surface holds.
  let amp = struck ? gain : 0;

  let W = 0, H = 0, dpr = 1, BS = 0, c0 = 0, rad = 0, inv = 1;
  let HB = null, LB = null, img = null;
  let t = 0, prev = 0, rafId = 0, ro = null;
  let expoL = 0, expoG = 0;      // the exposure: the figure's own curvature and slope
  let painted = false;           // a still dish is drawn once and then left alone
  // THE STIR: the bow's touch sets the whole body of liquid turning, in the
  // card's own direction, and friction takes it back to rest. One impulse,
  // never a loop. A stirred vessel rotates bodily, so this rotates where the
  // surface is read, not what is read.
  let stirV = 0, stirSign = 1, stirAng = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    // the compute buffer: square, about half the display, capped hard. The
    // caustic is smooth between the folds, so it interpolates up honestly.
    BS = Math.max(48, Math.min(128, Math.round(Math.min(W, H) / 2)));
    off.width = BS; off.height = BS;
    HB = new Float32Array(BS * BS);    // the surface height, at unit drive
    LB = new Float32Array(BS * BS);    // its Laplacian, in unit-disc units
    img = octx.createImageData(BS, BS);
    c0 = (BS - 1) / 2;
    rad = c0 * 0.94;   // inscribed, with a margin so the rim's own stencil closes
    inv = 1 / rad;     // one cell, measured in unit-disc units
    painted = false;
  }

  function render() {
    const coh = clamp01(getCoh());
    const detune = 1 - coh;
    const driven = amp > 0.001 && modes.length > 0;

    // ---- the surface -----------------------------------------------------
    // one field reading per cell, plus a one cell halo beyond the rim so the
    // stencil at the rim has real neighbours rather than an invented zero
    if (!driven) {
      HB.fill(0); LB.fill(0);
      expoL = 0; expoG = 0;
    } else {
      const ca = Math.cos(stirAng), sa = Math.sin(stirAng);
      const halo = 1 + 2.2 * inv;
      HB.fill(0);
      for (let gy = 0; gy < BS; gy++) {
        const y = (gy - c0) * inv, row = gy * BS;
        // the dish is inscribed, so each row's span is known: no cell outside
        // it is ever touched, and no radius has to be taken to find that out
        const span = halo * halo - y * y;
        if (span <= 0) continue;
        const xs = Math.sqrt(span) * rad;
        const g0 = Math.max(0, Math.ceil(c0 - xs)), g1 = Math.min(BS - 1, Math.floor(c0 + xs));
        for (let gx = g0; gx <= g1; gx++) {
          const x = (gx - c0) * inv, i = row + gx;
          const xr = x * ca - y * sa, yr = x * sa + y * ca;
          // THE ONE FIELD, AND ONLY IT. The dissonance's restlessness is
          // already inside fieldAt (its own warp term refuses to let a
          // detuned figure close); an earlier draft rode a second invented
          // ripple on top, and the adversarial pass rightly struck it: the
          // surface a reading shows must be the shared standing wave, or
          // the same card would mean different figures on different water.
          HB[i] = fieldAt(modes, prof, xr, yr, t, detune);
        }
      }
    }

    // ---- the curvature and the slope: the 5-point stencil -----------------
    let sumL = 0, sumG = 0, cells = 0;
    if (driven) {
      const k2 = rad * rad;    // 1/dx², the stencil's own scale in disc units
      for (let gy = 1; gy < BS - 1; gy++) {
        const y = (gy - c0) * inv, row = gy * BS;
        const span = 1 - y * y;
        if (span <= 0) continue;
        const xs = Math.sqrt(span) * rad;
        const g0 = Math.max(1, Math.ceil(c0 - xs)), g1 = Math.min(BS - 2, Math.floor(c0 + xs));
        for (let gx = g0; gx <= g1; gx++) {
          const i = row + gx;
          const L = (HB[i - 1] + HB[i + 1] + HB[i - BS] + HB[i + BS] - 4 * HB[i]) * k2;
          LB[i] = L;
          const sx = (HB[i + 1] - HB[i - 1]) * 0.5 * rad;
          const sy = (HB[i + BS] - HB[i - BS]) * 0.5 * rad;
          sumL += L < 0 ? -L : L;                  // the FIRST moment: see below
          sumG += sx * sx + sy * sy; cells++;
        }
      }
    }
    // THE EXPOSURE. The optics need the deformation in real units and the
    // canon does not fix one, so the working point is read off the figure
    // itself, followed slowly so that a change of chord does not flash. The
    // bow then multiplies it, which is what makes pressure mean ripple height.
    //
    // THE CURVATURE IS AVERAGED BY ITS FIRST MOMENT, NOT ITS SECOND, and that
    // is not a taste. Against the scaffold's 1/r point at the origin the second
    // moment does not converge (∫r⁻²·r dr) while the first does (∫r⁻¹·r dr), so
    // a root-mean-square is not a summary of that field at all: measured, one
    // singular point was carrying half the whole plate's exposure and stealing
    // it from the figure. The mean absolute curvature describes the figure.
    // The SLOPE keeps its root-mean-square, because the gradient has no such
    // point: r·cos(nθ) differentiates to something bounded at the origin.
    const meanL = cells ? sumL / cells : 0;          // mean absolute curvature
    const rmsG = cells ? Math.sqrt(sumG / cells) : 0;   // root-mean-square slope
    expoL = expoL > 1e-9 ? expoL + (meanL - expoL) * ADAPT : meanL;
    expoG = expoG > 1e-9 ? expoG + (rmsG - expoG) * ADAPT : rmsG;
    const kappa = expoL > 1e-9 ? (WORK * amp) / expoL : 0;
    const tilt = expoG > 1e-9 ? (TILT * amp) / expoG : 0;

    // ---- the light --------------------------------------------------------
    const data = img.data;
    // how sharply a fold can close. A clear card folds on a line; a dissonant
    // one is already trembling faster than the fold can resolve, so its light
    // is spread into restless scatter instead of a drawn curve.
    const soft = 0.16 + 0.62 * detune;
    const calmLit = 1 / (1 + soft);          // what a flat dish already returns
    const tr = tint[0], tg = tint[1], tb = tint[2];
    // a highlight clips toward the illuminant's own white
    const hr = tr + (255 - tr) * GLOSS, hg = tg + (255 - tg) * GLOSS, hb = tb + (255 - tb) * GLOSS;

    const rim2 = (1 - inv) * (1 - inv);   // inside this, the rim cannot be reached
    // THE CENTRE IS NOT READ, and here is exactly why. Two things fail there
    // at once and both are named rather than patched:
    //   · the grid. The loudest mode's angular period is 2πr/n, so near the
    //     centre it closes to nothing. Two samples per period is the bare
    //     Nyquist for seeing a wave at all, and a SECOND difference needs
    //     several, so the curvature is only honestly read where the grid gives
    //     about six samples across that period: r ≳ n·dx. Inside that, any
    //     figure drawn is the grid's own voice.
    //   · the field. Under the scaffold radial law the surface behaves as
    //     r·cos(nθ) at the origin, whose Laplacian is (1 − n²)cos(nθ)/r: it
    //     genuinely diverges, in 2n spokes. That is not water, it is the price
    //     of the scaffold, which luminara-sand.js already names as an
    //     approximation. A free-edge mode has no such point (J_n goes as r^n),
    //     so choosing 'bessel' removes it at the source. This reading is the
    //     first to see it at all, because sand and glow read only the
    //     amplitude and the second derivative is what finds the singularity.
    // So inside that radius the light returns to the calm level. Nothing is
    // invented there and nothing is claimed: it is unread, and unread water
    // is a mirror.
    let nMax = 1;
    for (let k = 0; k < modes.length; k++) { const a = Math.abs(modes[k].n); if (a > nMax) nMax = a; }
    const nyq2 = (nMax * inv) * (nMax * inv), nyq4 = nyq2 * nyq2;
    data.fill(0);                          // everything outside the dish is nothing
    for (let gy = 1; gy < BS - 1; gy++) {
      const y = (gy - c0) * inv, row = gy * BS;
      const span = 1 - y * y;
      if (span <= 0) continue;
      const xs = Math.sqrt(span) * rad;
      const g0 = Math.max(1, Math.ceil(c0 - xs)), g1 = Math.min(BS - 2, Math.floor(c0 + xs));
      for (let gx = g0; gx <= g1; gx++) {
        const i = row + gx, p = i * 4;
        const x = (gx - c0) * inv;
        const r2 = x * x + y * y;

        // how much of the deformation here is honestly read: one across the
        // dish, falling away only inside the unreadable centre
        const r4 = r2 * r2;
        const res = r4 / (r4 + nyq4);

        // the area element of the refracted ray map, and the light it gathers.
        // At det = 0 the map folds: that curve is the caustic.
        const det = 1 + kappa * LB[i] * res;
        const ad = det < 0 ? -det : det;
        const gathered = (1 / (ad + soft) - calmLit) / calmLit;   // against the calm level
        const lit = gathered > 0 ? gathered / (gathered + KNEE) : 0;

        // the facet: the true surface normal, from the stencil's gradient
        const sx = (HB[i + 1] - HB[i - 1]) * 0.5 * rad * tilt * res;
        const sy = (HB[i + BS] - HB[i - BS]) * 0.5 * rad * tilt * res;
        const ninv = 1 / Math.sqrt(sx * sx + sy * sy + 1);
        // the sky, straight overhead: its half vector is vertical, so this
        // term is simply how upright the facet is. Still water returns it
        // whole, which is the calm mirror along the nodal lines.
        const u2 = ninv * ninv, u4 = u2 * u2;
        const sheen = u4 * u2;
        // the low lamp: only a tilted flank throws it back to the eye
        let d = (-sx * HALF[0] - sy * HALF[1] + HALF[2]) * ninv;
        if (d < 0) d = 0;
        const d2 = d * d, d4 = d2 * d2, d8 = d4 * d4, d16 = d8 * d8, d32 = d16 * d16;
        const glint = d32 * d8;      // the fortieth power: a tight, hard highlight

        // the caustic light has been through the water and carries the metal;
        // the glint is the metal reflected off the skin, so it clips whiter
        const lr = tr * lit + hr * glint * 0.95 + tr * sheen * 0.10;
        const lg = tg * lit + hg * glint * 0.95 + tg * sheen * 0.10;
        const lb = tb * lit + hb * glint * 0.95 + tb * sheen * 0.10;

        // one cell of rim, antialiased: only the rim band pays for a radius
        const edge = r2 > rim2 ? Math.min(1, (1 - Math.sqrt(r2)) * rad) : 1;
        data[p] = lr > 255 ? 255 : lr;
        data[p + 1] = lg > 255 ? 255 : lg;
        data[p + 2] = lb > 255 ? 255 : lb;
        data[p + 3] = 255 * edge * alpha;
      }
    }
    octx.putImageData(img, 0, 0);

    // ---- to the display: the dark dish, the light, the vessel's edge -------
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgb(7,7,9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const S = Math.min(canvas.width, canvas.height);
    const ox = (canvas.width - S) / 2, oy = (canvas.height - S) / 2;
    ctx.drawImage(off, 0, 0, BS, BS, ox, oy, S, S);

    ctx.strokeStyle = 'rgba(' + tr + ',' + tg + ',' + tb + ',' + (0.18 * alpha / 0.85).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, (rad / BS) * S, 0, 6.28318);
    ctx.stroke();
  }

  (function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
    prev = now;
    // a silent dish and a lifted bow are both STILL: the surface does not
    // change, so it is drawn once and then left standing. Nothing is cleared.
    const still = !struck || gain <= 0.001;
    if (still && painted) return;
    if (!still) {
      t += dt;
      amp = gain;                  // the bow's pressure is the ripple's height
      if (stirV > 0.02) { stirAng += stirSign * stirV * dt; stirV *= Math.exp(-dt / 0.45); }
    }
    if (img) { render(); painted = true; }
  })(performance.now());

  resize();
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }

  return {
    // a new chord retunes the surface, but it does not wake a held one: a
    // frozen dish stays frozen until the bow returns to it
    setSpectrum: (sp) => { if (sp?.length) { modes = sp; prof = profilesFor(modes, fieldKind); } },
    setGain: (g) => { gain = clamp01(Number(g) || 0); },
    // the radial law, chosen by name: 'scaffold' (the default) or 'bessel'
    setField: (kind) => {
      fieldKind = kind === 'bessel' ? 'bessel' : 'scaffold';
      prof = profilesFor(modes, fieldKind);
      painted = false;
    },
    // the bow stirs the body of liquid: one impulse, signed by the card's motion
    stir: (sign, v = 2.4) => { stirSign = sign >= 0 ? 1 : -1; stirV = Math.max(stirV, v); },
    field: () => fieldKind,
    destroy: () => { cancelAnimationFrame(rafId); try { ro?.disconnect(); } catch { /* */ } },
  };
}
