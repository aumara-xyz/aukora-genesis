// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA SAND: the plate itself. The same spectrum contract as the glow
// renderer (coherence-glyph.js), read the way Chladni read it: grains are
// kicked where the plate is loud and settle where it is quiet, so the figure
// is drawn entirely by what does not move. Under path A a single-voiced card
// settles into |q| spokes and p rings: the interval, countable by eye.
//
// Clarity is how completely the plate lets the sand rest: the locked
// consonances settle crisp; the far dissonance trembles and never quite
// lands. The Seed's plate is unstruck and EMPTY (the architect's ruling,
// 2026-07-16): no sand is poured on silence. setGain is the bow's pressure:
// fade it to zero and the plate quiets, the last figure frozen where it
// landed (the cadence into the Seed, played physically).
//
// Same field as the glow renderer (drumhead approximation, sin(mπr)·cos(nθ);
// scaffold, not a claim of Bessel exactness): one field, two readings:
// the glow lights the flow, the sand sits in the still.
//
// TWO RADIAL LAWS, THE CHOICE NAMED (the architect, 2026-07-26). The
// scaffold above is the default and stays the default, because it is what
// the plate looked best under. Beside it now stands the disc's real
// physics, chosen by name and never silently:
//
//   'scaffold' · sin(mπr): even rings, the rim nailed still. An honest
//                approximation, and the figure the eye already knows.
//   'bessel'   · J_n(j'nm·r): the FREE-EDGE modes, exact to the classical
//                tables (luminara-bessel.js, pinned). Two things change and
//                both are what real sand does: the nodal circles crowd
//                outward at Bessel spacing instead of sitting evenly, and
//                the rim becomes an antinode, so the lines curve out to
//                MEET the edge, the signature of every real Chladni figure.
//
// Profiles are resolved once per spectrum and only while 'bessel' is
// chosen, so the default path costs exactly what it always did.

import { radialProfile, profileAt } from './luminara-bessel.js';

// ---------------------------------------------------------------------------
// THE FIELD, SHARED (2026-07-26). One standing wave, read four ways: the sand
// sits in its stillness, the glow lights its flow, the water refracts it, the
// film colours it. Exported so no renderer can quietly invent its own physics:
// every cymatic surface in the portal evaluates THIS function.
//   modes   the spectrum (luminara-cymatics spectrumOf)
//   prof    the Bessel radial tables, or null for the scaffold law
//   x, y    unit-disc coordinates
//   t       seconds, for the modes' own drift
//   detune  1 - clarity: how far the figure refuses to close
// ---------------------------------------------------------------------------
export function fieldAt(modes, prof, x, y, t, detune) {
  const r = Math.hypot(x, y), th = Math.atan2(y, x);
  let f = 0, ws = 0;
  for (let k = 0; k < modes.length; k++) {
    const md = modes[k];
    ws += md.w;
    const warp = 1 + detune * 0.22 * Math.sin(th * 3 + k);
    const rot = (md.drift !== undefined ? 0.2 + md.drift : 0.2) * t * 0.6;
    const radial = prof
      ? profileAt(prof[k], r * warp)          // the real free-edge law
      : Math.sin(md.m * Math.PI * r * warp);  // the scaffold, the default
    f += md.w * radial * Math.cos(md.n * th + md.phase + rot);
  }
  return ws ? f / ws : 0;
}
// the Bessel tables for a spectrum, or null for the scaffold: a renderer
// resolves these once per spectrum, never per pixel
export const profilesFor = (modes, kind) => (kind === 'bessel' && modes.length
  ? modes.map((md) => radialProfile(md.n, md.m)) : null);

export function createSandPlate(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let modes = opts.spectrum || [];
  let fieldKind = opts.field === 'bessel' ? 'bessel' : 'scaffold';
  let prof = null;   // null while the scaffold is chosen
  const resolveProfiles = () => {
    prof = fieldKind === 'bessel' && modes.length
      ? modes.map((md) => radialProfile(md.n, md.m))
      : null;
  };
  resolveProfiles();
  const getCoh = typeof opts.coherence === 'function'
    ? opts.coherence
    : () => (typeof opts.coherence === 'number' ? opts.coherence : 0.6);
  const tint = opts.tint || [239, 231, 207];
  const struck = opts.struck !== false;
  // grain brightness: dimmed when something rides above the plate
  const alpha = typeof opts.alpha === 'number' ? opts.alpha : 0.85;
  let gain = typeof opts.gain === 'number' ? opts.gain : 1;

  let W = 0, H = 0, dpr = 1, grains = null, N = 0;
  let t = 0, prev = 0, rafId = 0, ro = null;
  // THE STIR: the bow's touch sets the whole bed turning, in the card's own
  // direction (the deck's kinetics: flow forward, turning counter), and
  // friction takes it back to rest while the kicks resume their work. A
  // one-shot impulse, never a loop: the plate wakes, it does not spin.
  let stirV = 0, stirSign = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
    // grain count follows plate area: enough to draw lines, cheap to move;
    // an unstruck plate is empty: no sand on silence
    // GRAIN DENSITY IS THE CLARITY. The figure is drawn by grains coming to
    // rest, so the lines only read if the bed is truly full: the 2600 cap
    // starved a large plate (a 620 px stage held a twelfth of the bench
    // cell's density and its nodal lines never accumulated). The cap rises
    // to keep density near the bench's own on any size; the settled-grain
    // shortcut below pays for it.
    N = struck ? Math.max(260, Math.min(16000, Math.round((r.width * r.width) / 12))) : 0;
    grains = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.28318, rr = Math.sqrt(Math.random());
      grains[i * 2] = Math.cos(a) * rr;
      grains[i * 2 + 1] = Math.sin(a) * rr;
    }
    ctx.fillStyle = 'rgb(7,7,9)';
    ctx.fillRect(0, 0, W, H);
  }

  // the standing wave in unit-disc coordinates (the glow renderer's field)
  // the one shared law, evaluated here as everywhere
  const field = (x, y, detune) => fieldAt(modes, prof, x, y, t, detune);

  function stepFrame(dt) {
    const coh = Math.max(0, Math.min(1, getCoh()));
    const detune = 1 - coh;
    // dust the plate: slow fade so the lines accumulate as the sand lands
    ctx.fillStyle = 'rgba(7,7,9,0.20)';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, rad = Math.min(cx, cy) * 0.94;
    const K = 0.016, EPS = 0.012;
    // the stir: the bed turns rigidly and friction slows it; the kicks then
    // redraw the figure out of the moving sand
    let ca = 1, sa = 0;
    const stirring = struck && gain > 0.001 && stirV > 0.02;
    if (stirring) {
      const da = stirSign * stirV * (dt || 0.016);
      ca = Math.cos(da); sa = Math.sin(da);
      stirV *= Math.exp(-(dt || 0.016) / 0.45);
    }
    ctx.fillStyle = 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',' + alpha + ')';
    const gs = Math.max(1, dpr * 0.9);
    for (let i = 0; i < N; i++) {
      let x = grains[i * 2], y = grains[i * 2 + 1];
      if (struck && gain > 0.001) {
        if (stirring) { const rx = x * ca - y * sa; y = x * sa + y * ca; x = rx; }
        const a = Math.abs(field(x, y, detune)) * gain;
        const drive = Math.min(1, a * 1.6);
        // THE SETTLED GRAIN COSTS ONE READING. A grain sitting in the quiet
        // has almost no gradient to follow, so the two extra field samples
        // that find the downhill are only taken where there is a hill: at
        // rest the plate is three times cheaper, which is what buys the
        // density above. The physics is unchanged; only the arithmetic that
        // would have returned nearly zero is skipped.
        if (drive > 0.02) {
          const gx = (Math.abs(field(x + EPS, y, detune)) * gain - a) / EPS;
          const gy = (Math.abs(field(x, y + EPS, detune)) * gain - a) / EPS;
          x -= gx * drive * K * 2.2;
          y -= gy * drive * K * 2.2;
        }
        const kick = (drive + detune * 0.5) * K * 2.6;
        x += (Math.random() - 0.5) * kick;
        y += (Math.random() - 0.5) * kick;
        const rr = Math.hypot(x, y);
        if (rr > 0.985) { x *= 0.985 / rr; y *= 0.985 / rr; }
        grains[i * 2] = x; grains[i * 2 + 1] = y;
      }
      ctx.fillRect(cx + x * rad, cy + y * rad, gs, gs);
    }
    // the plate's edge: fades with the sand
    ctx.strokeStyle = 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',' + (0.18 * alpha / 0.85).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.28318); ctx.stroke();
  }

  (function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
    prev = now; t += dt;
    if (grains) stepFrame(dt);
  })(performance.now());

  resize();
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }

  return {
    setSpectrum: (sp) => { if (sp?.length) { modes = sp; resolveProfiles(); } },
    setGain: (g) => { gain = Math.max(0, Math.min(1, Number(g) || 0)); },
    // the radial law, chosen by name: 'scaffold' (the default) or 'bessel'
    setField: (kind) => { fieldKind = kind === 'bessel' ? 'bessel' : 'scaffold'; resolveProfiles(); },
    // the bow stirs the bed: one impulse, signed by the card's own motion
    stir: (sign, v = 2.4) => { stirSign = sign >= 0 ? 1 : -1; stirV = Math.max(stirV, v); },
    field: () => fieldKind,
    destroy: () => { cancelAnimationFrame(rafId); try { ro?.disconnect(); } catch { /* */ } },
  };
}
