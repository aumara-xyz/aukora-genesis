// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA STAGES: the seeings, disassembled from the Sounding page and
// reassembled against one contract (2026-07-26). Each factory returns a
// stage the instrument engine (luminara-instrument.js) can drive:
//
//   spectrum(modes) · gain(g) · strike(n, spec) · rest()   — all optional
//
// plus whatever extras the page wires by hand (the plate's field lens, the
// ring's halos). Nothing here decides what sounds; the engine does. Each
// stage owns exactly one element and one seeing:
//
//   THE PLATE         the sand settles into the figure (luminara-sand.js)
//   THE GLOW          the same air read luminously (coherence-glyph.js)
//   THE HARMONOGRAPH  the knot's shadow swung by its own two integers
//   THE KNOT          the struck card held large, face in its metal
//   THE RING          the twenty-seven at their stations, every glyph a key
//   THE CYCLE DIAL    the bar drawn around the stage, hand on the audio clock
//
// A future stage (water, the torus, a mandala) joins by returning the same
// shape; the engine never changes.

import { SUITS, cardOf, codeOf, knotOf, counterOf } from './luminara-canon.js';
import { metalOf, knotPaths, knotSvg, glyphInk, WHITEGOLD } from './luminara-knots.js';
import { createSandPlate } from './luminara-sand.js';
import { createGlyph } from './coherence-glyph.js';
import { spectrumOf } from './luminara-cymatics.js';

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const F2 = (v) => v.toFixed(2);

// ---------------------------------------------------------------------------
// THE PLATE: wraps the shared sand renderer. The tint follows the last
// struck card's metal; the field lens (scaffold | bessel) passes through.
// ---------------------------------------------------------------------------
export function createPlateStage(canvas, { coherence } = {}) {
  const tint = [239, 231, 207];
  const plate = createSandPlate(canvas, { spectrum: [], coherence, gain: 0, tint });
  let live = false;   // was anything already sounding when this strike landed
  // THE SIMMER (the architect's word, 2026-08-02): the bed no longer
  // freezes when the ring dies away. A real plate keeps trembling under
  // the room's own noise, and a figure that snaps still the moment the
  // decay window closes reads as a recording ending rather than a plate
  // resting. So when the voices die of their own decay the sand falls to a
  // low simmer of the LAST spectrum and keeps dancing gently in the figure
  // it found. The Seed is untouched by this: the rest is a deliberate act,
  // and playing it still brings the bed to a true standstill, so the
  // cadence home keeps its meaning. Nothing sounds during the simmer: it
  // is the sand's memory of the figure, not a voice.
  const SIMMER = 0.09;
  let rested = true;   // the page opens still: nothing has sounded yet
  return {
    spectrum: (m) => plate.setSpectrum(m),
    gain: (g) => {
      live = g > 0.001;
      if (live) { rested = false; plate.setGain(g); }
      else plate.setGain(rested ? 0 : SIMMER);
    },
    rest: () => { rested = true; plate.setGain(0); },
    strike: (n) => {
      tint.splice(0, 3, ...rgbOf(metalOf(n)));
      // THE FIRST TOUCH STIRS, AND ONLY THE FIRST. The bow waking a still
      // plate sets the bed turning in the card's own direction (the deck's
      // kinetics: flow forward, turning counter). A strike into sand that
      // is already sounding does not re-stir, because a bed stirred again
      // and again never comes to rest, and the figure is what comes to rest.
      if (!live) plate.stir(Math.sign(knotOf(n).q) || 1);
    },
    setField: (kind) => plate.setField(kind),
    field: () => plate.field(),
  };
}

// ---------------------------------------------------------------------------
// THE GLOW: the field renderer fed the identical superposition, so the two
// stages can never disagree about what is sounding.
// ---------------------------------------------------------------------------
export function createGlowStage(canvas, { coherence } = {}) {
  const glow = createGlyph(canvas, { spectrum: [{ n: 3, m: 1, w: 1, phase: 0 }],
    coherence, transmute: 1 });
  return {
    // THE METALS AS THE LIGHT: every mode arrives naming its card, and
    // leaves wearing its card's metal, so a chord paints its houses truly
    // interfering: bronze against silver against gold, the still lines in
    // white-gold, of no house. The renderer stays shared: without tints it
    // is the identity glyph it always was.
    spectrum: (m) => glow.setSpectrum(
      m.map((md) => (md.card ? { ...md, tint: rgbOf(metalOf(md.card)) } : md))),
  };
}

// ---------------------------------------------------------------------------
// THE HARMONOGRAPH: a p:|q| Lissajous IS the torus knot seen flat, so the
// pendulums are the card. The trace decays at the voice's own clarity, the
// comma visible as a figure that never quite closes; counters mirror.
// tracePoint is the pure sampler, exported for the pins: θ → [x, y, env].
// ---------------------------------------------------------------------------
export function tracePoint(a, b, clarity, sign, th) {
  const detune = 1 + 0.022 * (1 - clarity);
  const env = Math.exp(-th / (6 + 26 * clarity));
  return [env * Math.sin(a * th + (sign >= 0 ? 1 : -1) * Math.PI / 2),
          env * Math.sin(b * th * detune), env];
}
export function createHarmonographStage(canvas) {
  const ctx = canvas.getContext('2d');
  const traces = [];   // { a, b, sign, clarity, metal, th, x, y }
  let W = 0, H = 0, dpr = 1, prev = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = 'rgb(7,7,9)'; ctx.fillRect(0, 0, W, H);
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  (function loop(now) {
    requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
    prev = now;
    if (!traces.length) return;   // the rest: the drawing stands, no fade
    ctx.fillStyle = 'rgba(7,7,9,0.02)'; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, rad = Math.min(cx, cy) * 0.82;
    for (let i = traces.length - 1; i >= 0; i--) {
      const tr = traces[i];
      const steps = 90, dth = dt * 2.1;
      // the live hand reads first, but the memory stays bright: the older
      // traces step back gently rather than vanishing, and the long trails
      // are the instrument's beauty (the architect's word, restored after a
      // heavier fade dulled it: brightness first, hierarchy second)
      const behind = traces.length - 1 - i;
      const [, , envNow] = tracePoint(tr.a, tr.b, tr.clarity, tr.sign, tr.th);
      ctx.strokeStyle = tr.metal;
      ctx.lineWidth = Math.max(1, dpr * 0.9);
      ctx.globalAlpha = 0.85 * Math.pow(0.75, behind) * (0.55 + 0.45 * envNow);
      ctx.beginPath();
      ctx.moveTo(cx + tr.x * rad, cy + tr.y * rad);
      for (let s = 1; s <= steps; s++) {
        const th = tr.th + (dth * s) / steps;
        const [x, y] = tracePoint(tr.a, tr.b, tr.clarity, tr.sign, th);
        ctx.lineTo(cx + x * rad, cy + y * rad);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      tr.th += dth;
      const [x, y, env] = tracePoint(tr.a, tr.b, tr.clarity, tr.sign, tr.th);
      tr.x = x; tr.y = y;
      if (env < 0.02) traces.splice(i, 1);
    }
  })(performance.now());
  return {
    strike(n, spec) {
      const k = knotOf(n);
      if (k.q === 0) return;   // the Seed draws nothing: silence has no swing
      const start = tracePoint(Math.abs(k.q), k.p, spec.clarity, Math.sign(k.q), 0);
      traces.push({ a: Math.abs(k.q), b: k.p, sign: Math.sign(k.q),
        clarity: spec.clarity, metal: metalOf(n), th: 0, x: start[0], y: start[1] });
      if (traces.length > 4) traces.shift();
    },
    rest() { traces.length = 0; },   // the pendulums lift; the page keeps the drawing
  };
}

// ---------------------------------------------------------------------------
// THE KNOT AS FIRST RENDERED IN THREE DIMENSIONS: V1's seeing, kept whole at
// the architect's word. One strand at a time on the found torus: it ties
// itself as the voice establishes, turns by its own sign (flow forward,
// turning counter), a new strike replaces it, and on the rest the turning
// freezes where it stands. No layering, no ghosts, no loosening: the form
// before the crowd arrived. V2's living branch carries the layered seeing.
// ---------------------------------------------------------------------------
export function createKnotStageV1(el) {
  el.innerHTML = '<canvas></canvas><div class="kname"></div><div class="kint"></div>';
  const canvas = el.querySelector('canvas');
  const nameEl = el.querySelector('.kname'), intEl = el.querySelector('.kint');
  const ctx = canvas.getContext('2d');
  const SQRT2 = Math.SQRT2;
  let cur = null, tie0 = 0, ang = 0, frozen = false;
  let W = 0, H = 0, dpr = 1, prev = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  function build(p, q) {
    const g = q === 0 ? p : (function gcd(a, b) { return b ? gcd(b, a % b) : a; })(p, Math.abs(q));
    const per = 260, comps = [];
    for (let c = 0; c < g; c++) {
      const pts = [];
      for (let i = 0; i <= per; i++) {
        const t = (i / per) * (2 * Math.PI / g);
        const th = p * t, ph = q * t + (2 * Math.PI * c) / g;
        pts.push([(SQRT2 + Math.cos(ph)) * Math.cos(th),
          (SQRT2 + Math.cos(ph)) * Math.sin(th), Math.sin(ph)]);
      }
      comps.push(pts);
    }
    return comps;
  }
  const TILT = 1.05;
  function proj(pt, spin) {
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const x = pt[0] * cs - pt[1] * sn, y = pt[0] * sn + pt[1] * cs;
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    const y2 = y * ct - pt[2] * st, z2 = y * st + pt[2] * ct;
    const d = 7.5, s = d / (d - z2);
    return [x * s, y2 * s, z2];
  }
  function draw(now) {
    if (!cur) return;
    const tie = Math.min(1, (now - tie0) / 1.15);
    const ease = tie * tie * (3 - 2 * tie);
    ctx.fillStyle = 'rgb(7,7,9)';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, scale = Math.min(cx, cy) * (0.78 / (SQRT2 + 1));
    const segs = [];
    cur.segs.forEach((pts, ci) => {
      const upto = Math.max(2, Math.round(pts.length * ease));
      for (let i = 1; i < upto; i++) {
        const a = proj(pts[i - 1], ang), b = proj(pts[i], ang);
        segs.push({ a, b, z: (a[2] + b[2]) / 2, color: cur.colors[ci % cur.colors.length] });
      }
    });
    segs.sort((s1, s2) => s1.z - s2.z);
    for (const s of segs) {
      const depth = Math.max(0, Math.min(1, (s.z + 2.5) / 5));
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.22 + 0.7 * depth;
      ctx.lineWidth = Math.max(1, dpr * (0.7 + 2.6 * depth));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + s.a[0] * scale, cy - s.a[1] * scale);
      ctx.lineTo(cx + s.b[0] * scale, cy - s.b[1] * scale);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  (function loop(nowMs) {
    requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const now = nowMs / 1000;
    const dt = Math.min(0.1, prev ? now - prev : 0.016);
    prev = now;
    if (!cur) return;
    const tying = now - tie0 < 1.15;
    if (!frozen) ang += dt * 0.45 * Math.sign(cur.q || 0);
    if (!frozen || tying) draw(now);
  })(performance.now());
  return {
    strike(n) {
      const k = knotOf(n);
      const colors = k.kind === 'link' ? [metalOf(n), metalOf(counterOf(n))] : [metalOf(n)];
      cur = { q: k.q, colors, segs: build(k.p, k.q) };
      tie0 = performance.now() / 1000;
      frozen = false;
      nameEl.textContent = cardOf(n).name;
      intEl.textContent = k.interval + ' · T(' + k.p + ', ' + k.q + ') · the found radius';
    },
    rest() { frozen = true; },   // the turning stops where it stands
  };
}

// ---------------------------------------------------------------------------
// THE KNOT, REDESIGNED (the architect's word, 2026-07-26): no longer a held
// picture but the strand itself, alive in three dimensions on its own torus.
//
//   · THE FOUND RADIUS: the torus stands at R/r = root two, the Atlas's
//     skeleton, the conformally square torus where the walk is straightest.
//     Not the dress: the instrument wears the bone.
//   · THE TYING: a strike does not show the knot, it TIES it: the strand
//     draws along its own curve while the voice rings, closing as the tone
//     establishes. The figure is a movement that closes, seen closing.
//   · THE KINETICS: the deck's own rule: flow (q > 0) turns forward,
//     turning (q < 0) turns counter, and the same |q| spins opposite ways
//     for a card and its counter. On the rest the turning FREEZES where it
//     stands: the figure stands, exactly as the plate's does.
//   · THE DEPTH: nearer strand thicker and brighter, farther thinner and
//     dimmer, the same double encoding the glyphs carry. A link separates
//     into its strands, each in its own metal.
// ---------------------------------------------------------------------------
// level(): the true amplitude on the master line, nought to one, read from
// the sounder's own tap. Given it, the figure BREATHES with the sounding:
// the ink swells on the attack and settles as the voice decays, so the
// picture is a reading of the air rather than a second animation running
// beside it. The tap sits before the room's door, so the breath stays
// honest with the sound off: the strand still shows what is ringing.
// THE SHELL'S DENSITY, stated as a law rather than left as a feeling. The
// deepening's copies live a fixed span and are begotten at a fixed
// interval, and that interval OPENS OUT WITH THE COMPANY: each held strand
// waits shedS times the number of strands held. So the copies standing at
// once are fingers x (lifeS / (shedS x fingers)) = lifeS / shedS: the same
// weight of shell whatever the hand does. Two keys held together deepen as
// calmly as one, and the cap is never thrashed, which is what made a chord
// flicker before. Exported so the claim is pinned instead of admired.
export const SHELL = { shedS: 0.26, lifeS: 2.4, cap: 12 };
export const shellStanding = (heldCount) => {
  const fingers = Math.max(1, heldCount);
  return fingers * (SHELL.lifeS / (SHELL.shedS * fingers));
};

// THE FOUND TORUS, PROJECTED: the lean and the perspective divide, lifted
// out of the stage so that the frame they imply can be measured and
// pinned. The divide magnifies the near side, so a torus drawn about the
// model origin does NOT sit centred in its frame: it hangs low by the
// amount the near side gains. Against black nobody could see it; laid over
// the plate's circle it is plain, and the two seeings must share a centre
// or they are not one picture.
//
// THE LEAN IS NOW A HAND'S CHOICE (the cursor orbit), so the correction
// cannot be one number: knotFrameFor measures the frame at any lean, from
// the surface itself rather than from any card. The surface is symmetric
// about its own axis, so no turn can move the frame: it depends on the
// lean alone, which is what lets the centring law follow the orbit
// exactly. KNOT_TILT is the home lean, and KNOT_FRAME its frame.
export const KNOT_TILT = 1.05;
const KNOT_CT = Math.cos(KNOT_TILT), KNOT_ST = Math.sin(KNOT_TILT);
export function knotProject(pt, cs, sn, grow, tube, out, ct = KNOT_CT, st = KNOT_ST) {
  const R = Math.SQRT2 * grow;
  const x0 = (R + tube * pt[2]) * pt[0];
  const y0 = (R + tube * pt[2]) * pt[1];
  const z0 = tube * pt[3];
  const x = x0 * cs - y0 * sn, y = x0 * sn + y0 * cs;
  const y2 = y * ct - z0 * st, z2 = y * st + z0 * ct;
  const d = 7.5, k = d / (d - z2);
  out[0] = x * k; out[1] = y2 * k; out[2] = z2;
  return out;
}
export function knotFrameFor(lean) {
  const ct = Math.cos(lean), st = Math.sin(lean);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const o = [0, 0, 0], pt = [0, 0, 0, 0], N = 96;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * 2 * Math.PI;
    pt[0] = Math.cos(th); pt[1] = Math.sin(th);
    for (let j = 0; j < N; j++) {
      const ph = (j / N) * 2 * Math.PI;
      pt[2] = Math.cos(ph); pt[3] = Math.sin(ph);
      knotProject(pt, 1, 0, 1, 1, o, ct, st);
      if (o[0] < x0) x0 = o[0];
      if (o[0] > x1) x1 = o[0];
      if (o[1] < y0) y0 = o[1];
      if (o[1] > y1) y1 = o[1];
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2,
    halfW: (x1 - x0) / 2, halfH: (y1 - y0) / 2 };
}
export const KNOT_FRAME = knotFrameFor(KNOT_TILT);

// THE STATIONS OF THE AXIS: a double touch turns the eye to the next of
// these rather than to any angle it likes, so the view is always somewhere
// a person meant to be, and the cycle comes home on the fourth touch. The
// found lean stands first, which is why the way home is never lost by
// making the double touch do this instead of only that.
export const KNOT_VIEWS = [
  { name: 'the found lean', lean: KNOT_TILT, yaw: 0 },
  { name: 'from above, down the axis', lean: Math.PI / 2, yaw: 0 },
  { name: 'edge on, the hole shut', lean: 0.1, yaw: 0 },
  { name: 'from under', lean: 2.3, yaw: 0 },
];

export function createKnotStage(el, { level } = {}) {
  // the pane carries its own describing text: the name of what stands, the
  // interval and form beneath it, and a line the page fills with what it
  // hears in the air. They belong over the figure rather than out in a
  // margin, so that reading the strand and reading about it are one look.
  el.innerHTML = '<canvas></canvas><div class="kname"></div><div class="kint"></div>'
    + '<div class="kair"></div><div class="kcam"></div>';
  const canvas = el.querySelector('canvas');
  const nameEl = el.querySelector('.kname'), intEl = el.querySelector('.kint');
  const camEl = el.querySelector('.kcam');
  intEl.textContent = 'drag to turn the figure in the hand \u00b7 a double touch sets it home';
  const ctx = canvas.getContext('2d');
  const SQRT2 = Math.SQRT2;
  // THE LAYERED AIR (the architect's word, 2026-07-26): every card ringing
  // has its strand on the one torus, and a strand leaves the way it came:
  // by ceremony, not by cut. THE LOOSENING is the exit the Atlas already
  // wrote: between the stations the flow cannot hold a form, so a voice
  // leaving is a form losing its station: the winding relaxes outward into
  // the open water, thinning and dimming as it goes, still turning as it
  // dissolves. The pace is the voice's own ring (1.2 + 2.6 · clarity, the
  // sound module's law): a locked consonance takes long seconds to let go,
  // the far dissonance is gone in a breath. The Seed looses the whole
  // phrase at once: the cadence seen as every form returning to the water.
  let knots = [];        // [{ n, q, colors, segs, ang, tie0, clarity, loosen0 }]
  const clarityByN = new Map();   // last known clarity per card, from the strikes
  const beatByN = new Map();      // and its pulse, so a strand knows its own throb
  // THE DEEPENING (found by the architects at the address, 2026-07-30, and
  // made a door): striking a card whose strand already stands sheds a COPY
  // of the strand into the loosening, phase-locked to the living one: same
  // angle, same turn, same rate, so the family stays coherent forever.
  // Played as a beat, the copies sample the loosening's whole path at once
  // and the eye reads the surface the departing strand sweeps: the curve
  // acquiring volume, which is the Depth's own sealed essence. Each copy is
  // begotten by a touch and gone in the loosening's own time: EMPTINESS
  // kept. Sweeps carry no station, take no ink share, and never trim as
  // ghosts: they are departures only, and the living strand is never
  // dimmed by its own depth.
  let sweeps = [];               // [{ segs, colors, q, ang, shed0 }]
  const SWEEP_S = SHELL.lifeS;   // the loosening's cap: the sweep IS the loosening
  const MAX_SWEEPS = SHELL.cap;  // the shell at full depth, never a blizzard
  // THE HELD DEEPENING: a finger that stays down is a touch that has not
  // ended, so the shell may go on being begotten under it. The pace is the
  // drumming hand's, near enough that holding and beating give the same
  // figure: the gesture becomes something you can lean on rather than
  // hammer. Lifting the finger ends it at once.
  const HELD_SHED_S = SHELL.shedS;
  let W = 0, H = 0, dpr = 1, prev = 0;
  // THE MARKINGS: things the figure already knows and does not say unless
  // asked. Every one of them draws a quantity the deck derives, never a
  // decoration, and every one is OFF until a hand turns it on: the plain
  // strand is the default reading, and a marking is a question put to it.
  // Nothing here is remembered between visits.
  const MARKS = { beat: false, surface: false, travel: false,
    crossings: false, stations: false, counter: false };
  const counterCache = new Map();   // the mirror's strand, built once per card
  let air = 0;                   // the smoothed reading of the sounding
  let crowdNow = 1;              // the company's share, eased rather than stepped
  // THE ORBIT: the figure in the hand. A drag turns the torus itself: side
  // to side spins it about its own axis, up and down changes the lean, and
  // the strand's OWN turning keeps running underneath, because the hand is
  // moving the object, never the clock. Letting go keeps the last motion
  // and damps it, the way a heavy thing settles; a double touch sends the
  // figure gliding home to the found lean. The centring law rides along:
  // the frame is re-measured whenever the lean moves, so the figure stays
  // centred at every angle, over the plate as over the dark.
  let viewLean = KNOT_TILT, viewYaw = 0;
  let leanVel = 0, yawVel = 0;
  let dragging = false, homing = false;
  let station = 0;             // which of the axis's stations the eye is bound for
  let saidAt = 0;              // when the station was last named, so it can fade
  let lastFrameLean = KNOT_TILT, viewFrame = KNOT_FRAME;
  let vCT = Math.cos(KNOT_TILT), vST = Math.sin(KNOT_TILT);
  const LEAN_MIN = 0.08, LEAN_MAX = 2.55;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  // the hand on the figure
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  let px = 0, py = 0, pT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; homing = false;
    leanVel = 0; yawVel = 0;
    px = e.clientX; py = e.clientY; pT = performance.now() / 1000;
    // a pointer can be gone by the time its down is handled (a pen lifted,
    // a touch cancelled): losing the capture must not lose the drag
    try { canvas.setPointerCapture(e.pointerId); } catch { /* uncaptured is fine */ }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const t = performance.now() / 1000;
    const dx = e.clientX - px, dy = e.clientY - py;
    const dYaw = dx * 0.008, dLean = dy * 0.0055;
    viewYaw += dYaw;
    viewLean = Math.max(LEAN_MIN, Math.min(LEAN_MAX, viewLean + dLean));
    // the velocity the hand leaves behind, smoothed over the last moves
    const dt = Math.max(1 / 240, t - pT);
    yawVel = 0.7 * (dYaw / dt) + 0.3 * yawVel;
    leanVel = 0.7 * (dLean / dt) + 0.3 * leanVel;
    px = e.clientX; py = e.clientY; pT = t;
  });
  const letGo = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', letGo);
  canvas.addEventListener('pointercancel', () => { letGo(); leanVel = 0; yawVel = 0; });
  // THE DOUBLE TOUCH TURNS THE AXIS. It used to glide home and only home;
  // now it walks the stations, and since the found lean is the first of
  // them the way home is still a double touch away, never lost.
  canvas.addEventListener('dblclick', () => {
    station = (station + 1) % KNOT_VIEWS.length;
    homing = true; leanVel = 0; yawVel = 0;
    camEl.textContent = KNOT_VIEWS[station].name;
    saidAt = performance.now() / 1000;
  });

  // the strand sampled on the found torus: g components, each closing in
  // t ∈ [0, 2π/g), the link's other strands offset through the hole. The
  // winding is stored as its raw trigonometry (cosθ, sinθ, cosφ, sinφ) so
  // the loosening can relax it live: the ring radius grows (A, into the
  // open water) while the through-winding flattens toward zero (the touch
  // of B: the strand simplifying into the unknot's own circle as it goes).
  function buildSegs(p, q) {
    const g = q === 0 ? p : (function gcd(a, b) { return b ? gcd(b, a % b) : a; })(p, Math.abs(q));
    const per = 260;
    const comps = [];
    for (let c = 0; c < g; c++) {
      const pts = [];
      for (let i = 0; i <= per; i++) {
        const t = (i / per) * (2 * Math.PI / g);
        const th = p * t, ph = q * t + (2 * Math.PI * c) / g;
        pts.push([Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)]);
      }
      comps.push(pts);
    }
    return comps;
  }

  // the projector is the shared one (knotProject), so the strand, the
  // shell and the frame they are centred in can never drift apart. The
  // turn's cosine and sine arrive already taken (once per form, not four
  // times per point) and the answer is written into a scratch triple
  // rather than returned fresh: two strands under two fingers is thousands
  // of points a second, and a picture that builds that much rubbish every
  // frame stutters whenever the collector comes to sweep it up.
  const projectInto = knotProject;

  // THE FRAME'S INK: segment records pooled and refilled, never rebuilt, and
  // every point of a strand projected ONCE: the end of one segment is the
  // start of the next.
  const pool = [];
  const frame = [];
  let used = 0;
  // THE PAINTER'S BANDS: the depth sort was an n log n comparator pass over
  // thousands of records whose cost swung frame to frame, and a cost that
  // swings IS the jitter, whatever its average. Depth is only needed to the
  // eye's own resolution, so the segments are dealt into ninety-six fixed
  // bands instead: linear, steady, and the order inside a band is nobody's
  // to see, the band being thinner than the ink is wide.
  const NB = 96;
  const buckets = [];
  for (let b = 0; b < NB; b++) buckets.push([]);
  const bucketLen = new Int32Array(NB);
  // the crossing records, pooled like the ink: found fresh every frame,
  // allocated never, because a collector that wakes mid-frame is the other
  // half of the jitter
  const xpool = [];
  let xlen = 0;
  // the found torus, sampled once: the surface never changes, so asking
  // for it every frame built three hundred throwaway points a frame
  const SURF_RINGS = (() => {
    const rings = [];
    for (let m = 0; m < 14; m++) {
      const th = (m / 14) * 2 * Math.PI, mc = Math.cos(th), ms = Math.sin(th);
      const ring = [];
      for (let i = 0; i <= 26; i++) {
        const ph = (i / 26) * 2 * Math.PI;
        ring.push([mc, ms, Math.cos(ph), Math.sin(ph)]);
      }
      rings.push(ring);
    }
    return rings;
  })();
  let pa = [0, 0, 0], pb = [0, 0, 0];   // the scratch pair, swapped along the strand
  function strokeForm(pts, cs, sn, grow, tube, fade, color, upto, travelU) {
    const end = upto === undefined ? pts.length : upto;
    if (end < 2) return;
    projectInto(pts[0], cs, sn, grow, tube, pa, vCT, vST);
    const span = pts.length - 1;
    for (let i = 1; i < end; i++) {
      projectInto(pts[i], cs, sn, grow, tube, pb, vCT, vST);
      let seg = pool[used];
      if (!seg) seg = pool[used] = { ax: 0, ay: 0, bx: 0, by: 0, z: 0, fade: 0, color: null };
      seg.ax = pa[0]; seg.ay = pa[1]; seg.bx = pb[0]; seg.by = pb[1];
      seg.z = (pa[2] + pb[2]) / 2; seg.fade = fade; seg.color = color;
      // THE TRAVEL: a light running along the strand, direction the hand's
      // own sign, so the winding is seen as a way round rather than a
      // frozen rope. The light is a fade boost with no second geometry:
      // the strand carries its own runner.
      if (travelU !== undefined) {
        let d = (i / span) - travelU;
        d -= Math.floor(d);
        if (d > 0.5) d = 1 - d;
        if (d < 0.055) seg.fade = fade * (1 + 1.15 * (1 - d / 0.055));
      }
      frame.push(seg); used++;
      const t = pa; pa = pb; pb = t;
    }
  }

  // the loosening's own clock: 0 standing, 1 gone, paced by the voice's
  // ring but capped, so a locked consonance leaves with dignity rather
  // than haunting the stage: a lingering ghost is haze, not reverence
  const loosenU = (kn, now) => {
    if (!kn.loosen0) return 0;
    return Math.min(1, (now - kn.loosen0) / Math.min(2.4, 1.2 + 2.6 * kn.clarity));
  };

  function draw(now, dt) {
    ctx.fillStyle = 'rgb(7,7,9)';
    ctx.fillRect(0, 0, W, H);
    if (!knots.length && !sweeps.length) return;
    // the fit is exact and then deliberately loosened: the torus's widest
    // reach is its outer equator, root two plus one, and that point always
    // projects at z near zero, so this fraction is the true span of the
    // frame the strand takes. It is held well short of one because the
    // space around the knot is not padding: between the stations the flow
    // cannot hold a form, and the dark the strand hangs in is that open
    // water. The knot is where the winding crystallises; the void is the
    // rest of the field, and it belongs in the picture: it is also where a
    // loosening strand goes.
    const cx = W / 2, cy = H / 2, scale = Math.min(cx, cy) * (0.78 / (SQRT2 + 1));
    frame.length = 0; used = 0;
    // THE SURFACE: the found torus itself, faint, the water the strand
    // lies in. It does not turn with the strand because it is not the
    // strand: it is where every winding lives, and against it the count
    // through the hole becomes something the eye can follow.
    if (MARKS.surface) {
      ctx.strokeStyle = 'rgba(239,231,207,0.09)';
      ctx.lineWidth = Math.max(1, dpr * 0.6);
      const o = pa;   // the scratch is free between forms
      ctx.beginPath();
      for (let m = 0; m < SURF_RINGS.length; m++) {
        const ring = SURF_RINGS[m];
        for (let i = 0; i < ring.length; i++) {
          projectInto(ring[i], 1, 0, 1, 1, o, vCT, vST);
          const X = cx + (o[0] - viewFrame.x) * scale, Y = cy - (o[1] - viewFrame.y) * scale;
          if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        }
      }
      ctx.stroke();
    }
    // every strand of every knot into one depth-sorted pass, so the pair
    // truly braids: near passes in front regardless of which knot owns it
    for (const kn of knots) {
      const tie = Math.min(1, (now - kn.tie0) / 1.15);
      const ease = tie * tie * (3 - 2 * tie);   // the strand closes gently
      const u = loosenU(kn, now);
      const uu = u * u * (3 - 2 * u);           // and lets go as gently
      const grow = 1 + 0.75 * uu;               // outward, into the open water
      const tube = 1 - uu;                      // flattening toward the unknot
      // THE BEAT, WHEN IT IS ASKED FOR. The voice's detuned twins beat
      // against each other at a rate the counter-rotation fixes, and the
      // strand can be made to throb at exactly that rate: a chord then
      // shows each card's own pulse at once, which is the same
      // several-pulses-at-once the ear is being given. It is off by
      // default because at five and a half times a second it reads as
      // flashing, and a figure meant to be looked INTO must not blink at
      // the eye that is looking. Asked for, it is the truest thing on the
      // stage: the beat is not a rhythm chosen for it, it is the arithmetic
      // of the two windings heard as a wobble and seen as one.
      const throb = MARKS.beat && kn.beatHz
        ? 1 + 0.2 * Math.sin(2 * Math.PI * kn.beatHz * (now - kn.tie0))
        : 1;
      const fade = Math.pow(1 - u, 1.3) * throb;
      const cs = Math.cos(kn.ang + viewYaw), sn = Math.sin(kn.ang + viewYaw);
      // the runner's pace comes from the count: the far stations run
      // faster, as their windings do
      let travelU;
      if (MARKS.travel && kn.q) {
        const lap = 4.2 - 2.2 * (Math.abs(kn.q) / 13);
        travelU = ((now - kn.tie0) / lap) * Math.sign(kn.q);
        travelU -= Math.floor(travelU);
      }
      for (let ci = 0; ci < kn.segs.length; ci++) {
        const pts = kn.segs[ci];
        strokeForm(pts, cs, sn, grow, tube, fade, kn.colors[ci % kn.colors.length],
          Math.max(2, Math.round(pts.length * ease)), travelU);
      }
      // THE COUNTER: the answer's strand as a ghost beside its card, seen
      // without being sounded. IN CONCORD sounds the pair; this only shows
      // it: what the deck's negation looks like, laid on the same torus.
      // The Seed answers itself and shows nothing; a counter already
      // standing is really there, and is not doubled with a ghost.
      if (MARKS.counter && !kn.loosen0) {
        const cn = counterOf(kn.n);
        if (cn !== kn.n && !knots.some((k2) => k2.n === cn && !k2.loosen0)) {
          let ghost = counterCache.get(cn);
          if (!ghost) {
            const gk = knotOf(cn);
            ghost = { pts: buildSegs(gk.p, gk.q), color: metalOf(cn) };
            counterCache.set(cn, ghost);
          }
          const gcs = Math.cos(-kn.ang + viewYaw), gsn = Math.sin(-kn.ang + viewYaw);
          for (let ci = 0; ci < ghost.pts.length; ci++) {
            strokeForm(ghost.pts[ci], gcs, gsn, 1, 1, 0.16 * fade, ghost.color);
          }
        }
      }
    }
    // the deepening's copies into the same pass: they braid honestly with
    // the living strand, walking the loosening's own path as whole forms
    for (const sw of sweeps) {
      const u = Math.min(1, (now - sw.shed0) / SWEEP_S);
      const uu = u * u * (3 - 2 * u);
      const grow = 1 + 0.75 * uu, tube = 1 - uu;
      const fade = Math.pow(1 - u, 1.3) * 0.85;
      const cs = Math.cos(sw.ang + viewYaw), sn = Math.sin(sw.ang + viewYaw);
      for (let ci = 0; ci < sw.segs.length; ci++) {
        strokeForm(sw.segs[ci], cs, sn, grow, tube, fade, sw.colors[ci % sw.colors.length]);
      }
    }
    // the segments dealt into their bands: linear, and the same cost every
    // frame, which is the whole point
    bucketLen.fill(0);
    for (let i = 0; i < frame.length; i++) {
      const s = frame[i];
      let b = ((s.z + 2.6) * (NB / 5.2)) | 0;
      if (b < 0) b = 0; else if (b >= NB) b = NB - 1;
      buckets[b][bucketLen[b]++] = s;
    }
    // a chord lays several strands on the one torus, so the ink is shared
    // out: each thins and lightens as the company grows, and the crowd
    // reads as a weave rather than a blaze. Only the STANDING share the
    // ink: a dissolving ghost must never dim the living strands, or one
    // knot beside two departures reads at half its light: the murk.
    const standCount = knots.reduce((s, kn) => s + (kn.loosen0 ? 0 : 1), 0) || 1;
    // the share is the law; the GLIDE is only how it is reached, and the
    // glide is paced by TIME, not by frames: an ease worked per frame runs
    // fast on a fast screen and slow on a slow one, which reads as the
    // picture changing its mind
    const kCrowd = 1 - Math.exp(-7.5 * dt);
    crowdNow += (1 / Math.pow(standCount, 0.4) - crowdNow) * kCrowd;
    const crowd = crowdNow;
    // the breath: smoothed on the same honest clock
    if (level) air += (level() - air) * (1 - Math.exp(-10 * dt));
    const breath = level ? 0.82 + 0.62 * air : 1;
    ctx.lineCap = 'round';
    const wAir = level ? 0.9 + 0.3 * air : 1;
    // THE BATCHED INK: within a band, segments sharing a colour and a
    // quantised weight ride one path and one stroke. The eye cannot tell
    // alpha to better than a twenty-fourth at these levels, and the canvas
    // pays per stroke, not per segment: thousands of strokes a frame was
    // the third face of the jitter.
    let curColor = null, curA = -1, curW = -1, open = false;
    const fx = viewFrame.x, fy = viewFrame.y;
    for (let b = 0; b < NB; b++) {
      const arr = buckets[b], len = bucketLen[b];
      for (let j = 0; j < len; j++) {
        const s = arr[j];
        const depth = Math.max(0, Math.min(1, (s.z + 2.5) / 5));   // 0 far, 1 near
        let al = Math.min(1, (0.22 + 0.7 * depth) * crowd * s.fade * breath);
        al = ((al * 24) | 0) / 24;
        let w = Math.max(0.8, dpr * (0.7 + 2.6 * depth) * crowd * (0.55 + 0.45 * s.fade) * wAir);
        w = ((w * 4 + 0.5) | 0) / 4;
        if (s.color !== curColor || al !== curA || w !== curW) {
          if (open) ctx.stroke();
          ctx.strokeStyle = s.color; ctx.globalAlpha = al; ctx.lineWidth = w;
          ctx.beginPath();
          curColor = s.color; curA = al; curW = w; open = true;
        }
        ctx.moveTo(cx + (s.ax - fx) * scale, cy - (s.ay - fy) * scale);
        ctx.lineTo(cx + (s.bx - fx) * scale, cy - (s.by - fy) * scale);
      }
    }
    if (open) ctx.stroke();
    ctx.globalAlpha = 1;
    // THE STATIONS: the number line the deck lives on, worn as a ring of
    // twenty-seven ticks in the Ring's own arrangement, the station of
    // every standing card lit in its metal. A chord is seen as a spread of
    // stations, which is what a chord is.
    if (MARKS.stations) {
      const rr = Math.min(cx, cy) * 0.965;
      for (let q2 = -13; q2 <= 13; q2++) {
        const th = (-90 + q2 * (360 / 27)) * Math.PI / 180;
        const lit = knots.find((k2) => k2.q === q2 && !k2.loosen0);
        const len = lit ? 9 * dpr : 4.5 * dpr;
        ctx.strokeStyle = lit ? lit.colors[0] : 'rgba(239,231,207,0.16)';
        ctx.lineWidth = Math.max(1, dpr * (lit ? 1.4 : 0.7));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(th) * (rr - len), cy + Math.sin(th) * (rr - len));
        ctx.lineTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
        ctx.stroke();
      }
    }
    // THE CROSSINGS: a dot wherever the strands cross in THIS projection,
    // the braid included when a chord stands. The count is a property of
    // the shadow rather than of the knot, which is exactly the lesson:
    // orbit the camera and watch the dots come and go while the knot
    // itself never changes. Subsampled, standing strands only: the shell
    // is departure, not structure.
    if (MARKS.crossings) {
      xlen = 0;
      const o = pa;
      const step = knots.length > 3 ? 6 : 4;
      for (const kn of knots) {
        if (kn.loosen0) continue;
        const cs = Math.cos(kn.ang + viewYaw), sn = Math.sin(kn.ang + viewYaw);
        for (const pts of kn.segs) {
          let px = 0, py = 0, pz = 0, have = false;
          for (let i = 0; i < pts.length; i += step) {
            projectInto(pts[i], cs, sn, 1, 1, o, vCT, vST);
            if (have) {
              let r = xpool[xlen];
              if (!r) r = xpool[xlen] = { x1: 0, y1: 0, x2: 0, y2: 0, z: 0, color: null };
              r.x1 = px; r.y1 = py; r.x2 = o[0]; r.y2 = o[1];
              r.z = (pz + o[2]) / 2; r.color = kn.colors[0];
              xlen++;
            }
            px = o[0]; py = o[1]; pz = o[2]; have = true;
          }
        }
      }
      const S2 = xpool;
      ctx.lineWidth = Math.max(1, dpr * 0.9);
      for (let i = 0; i < xlen; i++) {
        for (let j = i + 2; j < xlen; j++) {
          const A = S2[i], B = S2[j];
          const d1x = A.x2 - A.x1, d1y = A.y2 - A.y1;
          const d2x = B.x2 - B.x1, d2y = B.y2 - B.y1;
          const den = d1x * d2y - d1y * d2x;
          if (!den) continue;
          const t = ((B.x1 - A.x1) * d2y - (B.y1 - A.y1) * d2x) / den;
          const u2 = ((B.x1 - A.x1) * d1y - (B.y1 - A.y1) * d1x) / den;
          if (t <= 0.02 || t >= 0.98 || u2 <= 0.02 || u2 >= 0.98) continue;
          const X = cx + ((A.x1 + t * d1x) - viewFrame.x) * scale;
          const Y = cy - ((A.y1 + t * d1y) - viewFrame.y) * scale;
          // the dot wears the colour of whichever strand passes OVER
          const over = A.z > B.z ? A : B;
          const depth2 = Math.max(0, Math.min(1, ((A.z + B.z) / 2 + 2.5) / 5));
          ctx.strokeStyle = over.color;
          ctx.globalAlpha = 0.35 + 0.5 * depth2;
          ctx.beginPath();
          ctx.arc(X, Y, dpr * 3.2, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  (function loop(nowMs) {
    requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const now = nowMs / 1000;
    const dt = Math.min(0.1, prev ? now - prev : 0.016);
    prev = now;
    // the view settles even over an empty stage, so a figure arriving
    // never inherits a stale glide
    if (!dragging && !homing) {
      viewYaw += yawVel * dt;
      const leanNext = viewLean + leanVel * dt;
      viewLean = Math.max(LEAN_MIN, Math.min(LEAN_MAX, leanNext));
      if (viewLean !== leanNext) leanVel = 0;   // the wall takes the motion
      const damp = Math.exp(-2.6 * dt);
      yawVel *= damp; leanVel *= damp;
      if (Math.abs(yawVel) < 0.02) yawVel = 0;
      if (Math.abs(leanVel) < 0.02) leanVel = 0;
    }
    if (homing) {
      // the glide to the station: its lean, its yaw, no corners. The yaw is
      // unwound to the nearest whole turn first, so a figure spun round
      // twenty times comes back the short way rather than rewinding.
      const want = KNOT_VIEWS[station];
      viewYaw -= Math.round((viewYaw - want.yaw) / (2 * Math.PI)) * 2 * Math.PI;
      const k = Math.min(1, dt * 6);
      viewLean += (want.lean - viewLean) * k;
      viewYaw += (want.yaw - viewYaw) * k;
      if (Math.abs(viewLean - want.lean) < 0.002 && Math.abs(viewYaw - want.yaw) < 0.002) {
        viewLean = want.lean; viewYaw = want.yaw; homing = false;
      }
    }
    if (saidAt && now - saidAt > 2.4) { camEl.textContent = ''; saidAt = 0; }
    if (viewLean !== lastFrameLean) {
      // the lean moved: the centring law follows it, measured fresh
      viewFrame = knotFrameFor(viewLean);
      lastFrameLean = viewLean;
      vCT = Math.cos(viewLean); vST = Math.sin(viewLean);
    }
    if (!knots.length && !sweeps.length) return;
    // the copies keep the living strand's turn exactly: same rate, same
    // sign, begun at its own angle, so the family never decoheres
    for (const sw of sweeps) sw.ang += dt * 0.45 * Math.sign(sw.q || 0);
    // the filter allocates a fresh array, so it runs only when a copy is
    // actually due to go: the collector sleeps through the ordinary frame
    if (sweeps.length && now - sweeps[0].shed0 >= SWEEP_S) {
      sweeps = sweeps.filter((sw) => now - sw.shed0 < SWEEP_S);
    }
    let gone = false;
    const heldCount = knots.reduce((c, kn) => c + (kn.heldDown && !kn.loosen0 ? 1 : 0), 0);
    for (const kn of knots) {
      // each knot turns its own way, and KEEPS turning as it loosens: the
      // mirror's q is negative, so pairs counter-spin by construction
      kn.ang += dt * 0.45 * Math.sign(kn.q || 0);
      // the finger still down: the shell keeps being begotten, and stops
      // the instant the key is let go. THE PACE IS THE HAND'S, NOT THE
      // FINGERS': the interval opens out with the company, so two strands
      // held together lay down the same weight of copies as one held
      // alone. The shell's density is a property of the gesture, and a
      // chord deepens as calmly as a single note does.
      if (kn.heldDown && !kn.loosen0
          && now - kn.lastShed >= HELD_SHED_S * Math.max(1, heldCount)) {
        kn.lastShed = now;
        shed(kn, now);
      }
      if (loosenU(kn, now) >= 1) gone = true;
    }
    if (gone) {
      knots = knots.filter((kn) => loosenU(kn, now) < 1);
      relabel();
    }
    draw(now, dt);
  })(performance.now());

  // THE HOVER AND THE HANDOVER (the architect's word, 2026-07-26): a knot
  // whose voice has died does NOT loose: it hovers, the figure standing as
  // it always stood. The loosening has exactly three doors:
  //   · a key released when something NEWER has been struck: the previous
  //     form yields to the present one
  //   · a new strike arriving over forms whose keys are already up: they
  //     were previous the moment the new one landed
  //   · the Seed, which looses the whole phrase at once
  // A concord pair shares one generation, so the dyad hovers and yields as
  // one; the latest form, key released or not, hovers indefinitely.
  let genCounter = 0;
  const pending = new Map();   // n → { gen, heldDown }, set by the strike
  const makeKnot = (n) => {
    const k = knotOf(n);
    const colors = k.kind === 'link' ? [metalOf(n), metalOf(counterOf(n))] : [metalOf(n)];
    const pd = pending.get(n) || { gen: ++genCounter, heldDown: false };
    pending.delete(n);
    return { n, p: k.p, q: k.q, colors, segs: buildSegs(k.p, k.q),
      ang: 0, tie0: performance.now() / 1000,
      clarity: clarityByN.get(n) ?? 0.75, loosen0: null,
      beatHz: beatByN.get(n) ?? 0, lastShed: performance.now() / 1000,
      gen: pd.gen, heldDown: pd.heldDown };
  };
  const standing = () => knots.filter((kn) => !kn.loosen0);
  // one door for every copy: the drummed one and the held one alike, so
  // the two hands give the identical figure
  function shed(kn, now) {
    sweeps.push({ segs: kn.segs, colors: kn.colors, q: kn.q, ang: kn.ang, shed0: now });
    // OVER THE CAP THE ELDEST ARE HURRIED, NEVER CUT. Dropping a copy from
    // the array kills it wherever it happens to stand, and a form vanishing
    // at half its light is a flicker: it is what made two held keys
    // stutter, since two shells want more copies than one stage may hold.
    // Pushed instead to the far end of its own walk, a copy finishes the
    // departure it was already making, in a breath, and the eye reads a
    // shell thinning rather than a hole opening in it.
    for (let i = 0; i < sweeps.length - MAX_SWEEPS; i++) {
      const hurried = now - SWEEP_S * 0.86;
      if (sweeps[i].shed0 > hurried) sweeps[i].shed0 = hurried;
    }
  }
  // THE GHOST CAP: two departures may share the stage; a third arriving
  // sends the most-faded straight to the water. More than two dissolving
  // forms is haze, and haze is what the clean figure is not.
  function trimGhosts() {
    const now = performance.now() / 1000;
    const ghosts = knots.filter((kn) => kn.loosen0)
      .sort((a, b) => loosenU(b, now) - loosenU(a, now));
    while (ghosts.length > 2) {
      const gone = ghosts.shift();   // the most faded leaves at once
      knots = knots.filter((kn) => kn !== gone);
    }
  }
  // previous + key up → the water; called at release and at new arrivals
  function yieldOld() {
    const now = performance.now() / 1000;
    const stand = standing();
    if (!stand.length) return;
    const newest = Math.max(...stand.map((kn) => kn.gen));
    for (const kn of stand) {
      if (kn.gen < newest && !kn.heldDown) kn.loosen0 = now;
    }
    trimGhosts();
    relabel();
  }
  // the label reads what still stands; the loosening is named while it is
  // all that remains. Derived from the set, never from the order of touches.
  function relabel() {
    const stand = standing();
    if (!stand.length) {
      if (knots.length) intEl.textContent = 'loosening into the open water';
      return;
    }
    if (stand.length === 1) {
      const kn = stand[0], k = knotOf(kn.n);
      nameEl.textContent = cardOf(kn.n).name;
      intEl.textContent = k.interval + ' · T(' + k.p + ', ' + k.q + ') · the found radius';
      return;
    }
    const ns = stand.map((kn) => kn.n);
    nameEl.textContent = ns.map((n) => cardOf(n).name).join(' · ');
    if (ns.length === 2 && counterOf(ns[0]) === ns[1]) {
      intEl.textContent = 'in concord · one form, spiraling opposite ways · the found radius';
    } else {
      intEl.textContent = ns.length + ' sounding · the strands overlaid on one torus';
    }
  }
  return {
    // arrivals only: a card sounding without a strand ties one. Departures
    // of the VOICE change nothing here: the form hovers past its sound.
    sounding(ns) {
      const have = new Set(standing().map((kn) => kn.n));
      let arrived = false;
      for (const n of ns) if (!have.has(n)) { knots.push(makeKnot(n)); arrived = true; }
      if (arrived) { yieldOld(); relabel(); }
    },
    // the strike carries the clarity, the generation and the finger: a
    // concord mirror inherits its partner's generation, so the pair is one
    strike(n, spec, pairOf, heldFlag, beatHz) {
      if (spec) clarityByN.set(n, spec.clarity ?? 0.75);
      if (beatHz !== undefined) beatByN.set(n, beatHz || 0);
      // the deepening's door: the card already has its strand, so no new
      // form ties; instead a phase-locked copy departs, and the beat of
      // the touches becomes the depth of the shell
      const stand = standing().find((kn) => kn.n === n);
      if (stand) {
        shed(stand, performance.now() / 1000);
        if (beatHz !== undefined) stand.beatHz = beatHz || 0;
        if (heldFlag) { stand.heldDown = true; stand.lastShed = performance.now() / 1000; }
        return;
      }
      const pairGen = pairOf !== undefined
        ? (standing().find((kn) => kn.n === pairOf)?.gen ?? pending.get(pairOf)?.gen)
        : undefined;
      pending.set(n, { gen: pairGen ?? ++genCounter, heldDown: !!heldFlag });
    },
    // the finger lifted: if something newer stands, this form yields
    release(n) {
      for (const kn of knots) if (kn.n === n && !kn.loosen0) kn.heldDown = false;
      yieldOld();
    },
    // the Seed: the whole phrase looses at once, every strand returning to
    // the water together, still turning as it goes: the cadence, seen
    rest() {
      const now = performance.now() / 1000;
      for (const kn of knots) if (!kn.loosen0) kn.loosen0 = now;
      relabel();
    },
    // a reading, never a control: how many of the deepening's copies are
    // currently walking the loosening (for pages and probes)
    depth: () => sweeps.length,
    // the markings, read and set by name. An unknown name is refused rather
    // than quietly stored, so a typo in a page cannot become a dead switch.
    setMark: (name, on) => {
      if (!Object.prototype.hasOwnProperty.call(MARKS, name)) return null;
      MARKS[name] = !!on;
      return MARKS[name];
    },
    marks: () => ({ ...MARKS }),
    // the eye, readable and settable: never derived, always chosen
    camera: () => ({ lean: viewLean, yaw: viewYaw, station, name: KNOT_VIEWS[station].name }),
    lookAt: (i) => {
      station = ((i % KNOT_VIEWS.length) + KNOT_VIEWS.length) % KNOT_VIEWS.length;
      homing = true; leanVel = 0; yawVel = 0;
      camEl.textContent = KNOT_VIEWS[station].name;
      saidAt = performance.now() / 1000;
      return KNOT_VIEWS[station].name;
    },
  };
}

// ---------------------------------------------------------------------------
// THE RING: the twenty-seven at their stations, q as the angle, the mirror
// axis, the seam at the nadir. Every glyph is a key: touches call back into
// the engine. lit(ns) wears the halos; the page drives it from the lines.
// ---------------------------------------------------------------------------
export function createRingStage(el, { onStrike } = {}) {
  const R = 126, STEP = 360 / 27, GLYPH = 4.8;
  const pos = {};
  for (let n = 1; n <= 27; n++) {
    const q = knotOf(n).q;
    const th = (-90 + q * STEP) * Math.PI / 180;
    pos[n] = [R * Math.cos(th), R * Math.sin(th)];
  }
  let s = '<svg viewBox="-141 -141 282 282" aria-label="the ring, playable">';
  s += '<line x1="0" y1="-134" x2="0" y2="134" stroke="' + WHITEGOLD
    + '" stroke-opacity="0.07" stroke-width="0.5" stroke-dasharray="2 6"/>';
  const sa = (-90 + 13.3 * STEP) * Math.PI / 180, sb = (-90 + 13.7 * STEP) * Math.PI / 180;
  s += '<path d="M ' + F2(R * Math.cos(sa)) + ' ' + F2(R * Math.sin(sa)) + ' A ' + R + ' ' + R
    + ' 0 0 1 ' + F2(R * Math.cos(sb)) + ' ' + F2(R * Math.sin(sb))
    + '" fill="none" stroke="' + WHITEGOLD + '" stroke-opacity="0.45" stroke-width="0.7" stroke-dasharray="1.2 2.2"/>';
  s += '<g data-lit></g>';
  for (let n = 1; n <= 27; n++) {
    const [x, y] = pos[n];
    if (n === 1) {
      s += '<circle cx="' + F2(x) + '" cy="' + F2(y) + '" r="11" fill="#0a0b0e" stroke="'
        + WHITEGOLD + '" stroke-width="1.2" stroke-opacity="0.9"/>';
      continue;
    }
    const k = knotOf(n);
    const colors = k.kind === 'link' ? [metalOf(n), metalOf(counterOf(n))] : [metalOf(n)];
    s += '<g transform="translate(' + F2(x) + ' ' + F2(y) + ') scale(' + GLYPH + ')">'
      + glyphInk(knotPaths(k.p, k.q, colors, 0.20, 0.30)) + '</g>';
  }
  for (let n = 1; n <= 27; n++) {
    const [x, y] = pos[n];
    s += '<circle class="ringhit" data-n="' + n + '" cx="' + F2(x) + '" cy="' + F2(y) + '" r="13.6"/>';
  }
  s += '</svg>';
  el.innerHTML = s;
  el.addEventListener('pointerdown', (e) => {
    const hit = e.target.closest('.ringhit');
    if (hit && onStrike) onStrike(Number(hit.dataset.n));
  });
  const litG = el.querySelector('[data-lit]');
  return {
    lit(ns) {
      litG.innerHTML = ns.map((n) => {
        const [x, y] = pos[n];
        return '<circle cx="' + F2(x) + '" cy="' + F2(y) + '" r="13" fill="none" stroke="'
          + metalOf(n) + '" stroke-width="1" stroke-opacity="0.75"/>';
      }).join('');
    },
  };
}

// ---------------------------------------------------------------------------
// THE DECK GRID (from the Resonance room's houses, 2026-07-26): all
// twenty-seven at once, three houses of nine, each cell its OWN card's
// figure under the chosen renderer: sand (the plate), glow (the field), or
// the harmonograph (the card's Lissajous drawn whole, decay as fading ink).
// The knot overlay rides above any of them at a word. Cells are keys, and
// lit(ns) wears each ringing card's halo in its own metal: the keyboard
// below and the grid above are one instrument seen twice.
// ---------------------------------------------------------------------------
function drawMembrane(canvas) {
  // the unstruck Seed: silence, the membrane before any mode
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2, s = Math.min(cx, cy);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s);
  g.addColorStop(0, 'rgba(239,231,207,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(239,231,207,0.6)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.47, 0, 6.28318); ctx.stroke();
}
function drawLissaCell(canvas, n, clarity) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(7,7,9)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const k = knotOf(n);
  if (k.q === 0) { drawMembrane(canvas); return; }   // silence has no swing
  const a = Math.abs(k.q), b = k.p, sign = Math.sign(k.q);
  const cx = canvas.width / 2, cy = canvas.height / 2, rad = Math.min(cx, cy) * 0.8;
  const thMax = 3 * (6 + 26 * clarity);   // draw until the ink runs out (env ≈ 0.05)
  const steps = Math.min(2600, Math.round(thMax * 26));
  ctx.strokeStyle = metalOf(n);
  ctx.lineWidth = Math.max(1, dpr * 0.8);
  let prev = tracePoint(a, b, clarity, sign, 0);
  for (let s = 1; s <= steps; s++) {
    const th = (s / steps) * thMax;
    const pt = tracePoint(a, b, clarity, sign, th);
    ctx.globalAlpha = 0.16 + 0.6 * pt[2];   // the decay as fading ink
    ctx.beginPath();
    ctx.moveTo(cx + prev[0] * rad, cy + prev[1] * rad);
    ctx.lineTo(cx + pt[0] * rad, cy + pt[1] * rad);
    ctx.stroke();
    prev = pt;
  }
  ctx.globalAlpha = 1;
}
export function createDeckGrid(el, { onStrike } = {}) {
  const live = new Map();   // n → renderer handle
  let opts = { path: 'A', renderer: 'sand', knots: false, field: 'scaffold' };
  // the shell: three houses of nine, built once; figures remount on rebuild
  let shell = '';
  SUITS.forEach((suit, s) => {
    shell += '<div class="house"><div class="hname">' + suit.key + ' · ' + suit.gloss + '</div><div class="hgrid">';
    for (let i = 0; i < 9; i++) {
      const n = 9 * s + i + 1;
      shell += '<div class="cell" data-n="' + n + '" style="--cm:' + metalOf(n) + '">'
        + '<div class="cwrap"><canvas></canvas></div>'
        + '<div class="cname">' + cardOf(n).name + '</div></div>';
    }
    shell += '</div></div>';
  });
  el.innerHTML = shell;
  el.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (cell && onStrike) onStrike(Number(cell.dataset.n));
  });
  function mountCell(n) {
    if (live.has(n)) { live.get(n).destroy?.(); live.delete(n); }
    const cell = el.querySelector('.cell[data-n="' + n + '"]');
    const wrap = cell.querySelector('.cwrap');
    // a fresh canvas each mount: renderers own their surface completely
    wrap.innerHTML = '<canvas></canvas>' + (opts.knots ? knotOverlay(n) : '');
    const canvas = wrap.querySelector('canvas');
    const spec = spectrumOf(n, opts.path);
    if (opts.renderer === 'harmo') { drawLissaCell(canvas, n, spec.clarity); return; }
    if (opts.renderer === 'glow') {
      if (!spec.struck) { drawMembrane(canvas); return; }
      live.set(n, createGlyph(canvas, { spectrum: spec.modes, coherence: spec.clarity, transmute: 1 }));
      return;
    }
    // sand: the unstruck plate is empty; under the strand the sand whispers
    live.set(n, createSandPlate(canvas, {
      spectrum: spec.modes, coherence: spec.clarity, struck: spec.struck,
      tint: rgbOf(metalOf(n)), alpha: opts.knots ? 0.28 : 0.85, field: opts.field,
    }));
  }
  function knotOverlay(n) {
    const k = knotOf(n);
    const colors = k.kind === 'link' ? [metalOf(n), metalOf(counterOf(n))] : [metalOf(n)];
    const moving = codeOf(n).filter((s) => s !== 0).length;
    return '<div class="knot-ov">' + knotSvg(k.p, k.q, colors, 0.16 + 0.11 * moving, 0.62) + '</div>';
  }
  function rebuild(next = {}) {
    opts = { ...opts, ...next };
    for (let n = 1; n <= 27; n++) mountCell(n);
  }
  rebuild();
  return {
    rebuild,
    lit(ns) {
      const on = new Set(ns);
      el.querySelectorAll('.cell').forEach((c) => c.classList.toggle('lit', on.has(Number(c.dataset.n))));
    },
  };
}

// ---------------------------------------------------------------------------
// THE CYCLE DIAL: the bar drawn around the stage, p dots inner dimmed and q
// dots outer in each loop's metal, one hand from the audio clock itself.
// ---------------------------------------------------------------------------
export function createCycleDial(canvas, { bar, loops, active, now, barZero, visible } = {}) {
  (function loop() {
    requestAnimationFrame(loop);
    if (!visible() || canvas.offsetParent === null || document.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 2 * dpr;
    let li = 0;
    for (const [n, L] of loops()) {
      const rq = R - li * 7 * dpr, rp = rq - 3.5 * dpr;
      ctx.fillStyle = metalOf(n);
      for (const t of L.ticks) {
        const a = (t.off / bar) * 2 * Math.PI - Math.PI / 2;
        const rr = t.line === 'q' ? rq : rp;
        ctx.globalAlpha = t.line === 'q' ? 0.9 : 0.45;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, (t.line === 'q' ? 2.2 : 1.6) * dpr, 0, 6.283); ctx.fill();
      }
      li++;
    }
    ctx.globalAlpha = 1;
    if (loops().size && active()) {
      const ph = (((now() - barZero()) / bar) % 1 + 1) % 1;
      const a = ph * 2 * Math.PI - Math.PI / 2;
      ctx.strokeStyle = 'rgba(239,231,207,0.5)'; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R - 26 * dpr), cy + Math.sin(a) * (R - 26 * dpr));
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    }
  })();
}
