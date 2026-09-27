// Aukora Spatial — the coherence glyph.
//
// A cymatic standing-wave figure derived from a coherence SIGNATURE and
// rendered the way a drum sounds its own shape (Kac: "can one hear the shape
// of a drum?"). Coherence is registered as RESONANCE, never counted: a clean,
// closed, symmetric figure reads as high coherence; a detuned scatter reads as
// decoherence — the way a face or a chord reads, not the way a number reads.
//
// The two palettes carry the whole thesis (see docs/COHERENCE_GLYPH.md):
//   · the NODAL LINES — where the standing wave is still, the stable structure —
//     are drawn in GOLD: the immortal metal, the thermodynamic anchor, the place
//     the pattern holds. Discrete, phi-governed, the icosahedral record.
//   · the LIVING FLOW between the nodes is AURA-hued light: the continuous field,
//     pi-governed, the sphere the record is a mode of.
// Coherence modulates CLARITY, not size: high → the modes phase-lock, the figure
// is crisp and ringed by a solid gold boundary (the last stable state before the
// "snap"); low → the modes detune, the sand scatters, the rim breaks open.
//
// 2D canvas on purpose: it runs on every node with no GPU. The meter must work
// on everyone's metal. This is SCAFFOLD/analogy, an instrument — not a claim
// that the figure IS quantum topology.

const PHI = 1.6180339887498949;
const GOLD = [255, 201, 92];   // the anchor metal — where the wave stands still
// THE METALS AS THE LIGHT (the sounding, 2026-07-26): a mode may carry its
// own tint ([r,g,b] — the card's metal, in the deck's use). When any mode
// does, the living flow is coloured per-pixel by whichever modes are loud
// there — a chord paints its houses actually interfering — and the nodal
// lines wear WHITE-GOLD instead of the identity gold: stillness is of no
// house, which is the Seed's own metal. With no tints present the glyph
// renders exactly as it always has; the identity surfaces never change.
const WHITEGOLD = [239, 231, 207];

function hashSig(s) {
  s = String(s);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stable identity → its full bank of SIX resonant modes with golden-decaying
// weights. The same signature always builds the same bank; that reproducibility
// is what lets the glyph serve as a living identifier (a voice, not a
// fingerprint). How many of the six are AUDIBLE is The Tuning's progression
// (tuning.js — the Platonic ladder): the figure never gets bigger as you grow,
// more of who you already are becomes audible.
export function signatureSpectrum(sig, count) {
  const rng = mulberry32(hashSig(sig || 'aukora'));
  const modes = [];
  for (let i = 0; i < 6; i++) {
    modes.push({
      n: 1 + Math.floor(rng() * 7),              // angular symmetry — the petals
      m: 1 + Math.floor(rng() * 4),              // radial nodes — the rings
      w: Math.pow(1 / PHI, i),                    // golden-decaying weight
      phase: rng() * Math.PI * 2,
      drift: (rng() - 0.5) * 0.5,                 // slow per-mode shimmer — alive, not frozen
    });
  }
  const k = Math.max(1, Math.min(6, count ?? 6));
  return modes.slice(0, k);
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// Two spectra ringing together — the Forge's bond, rendered as harmony.
// consonance(a, b) ∈ [0,1]: how much of each figure finds a near-match in the
// other (shared symmetries ring; disjoint ones beat against each other). The
// bond spectrum interleaves both, weights averaged where modes agree — so a
// consonant pair draws a crisp shared figure and a dissonant pair visibly
// shimmers. Read, never scored — the number stays internal (spec §12).
// ---------------------------------------------------------------------------
export function consonance(a, b) {
  if (!a?.length || !b?.length) return 0;
  let wsum = 0, hit = 0;
  for (const ma of a) {
    wsum += ma.w;
    let best = 0;
    for (const mb of b) {
      const dn = Math.abs(ma.n - mb.n), dm = Math.abs(ma.m - mb.m);
      const score = dn === 0 && dm === 0 ? 1 : dn + dm === 1 ? 0.5 : 0;
      if (score > best) best = score;
    }
    hit += ma.w * best;
  }
  return wsum ? hit / wsum : 0;
}

export function combineSpectra(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < 6; i++) {
    if (a[i]) out.push({ ...a[i], w: a[i].w * Math.pow(1 / PHI, out.length / 2) });
    if (b[i] && out.length < 6) out.push({ ...b[i], w: b[i].w * Math.pow(1 / PHI, out.length / 2) });
  }
  return out;
}

// createGlyph(canvas, { signature, coherence: () => 0..1, modes: 1..6 })
// Returns { pulseNow(), setSignature(sig), setModeCount(n), destroy() }.
export function createGlyph(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  let sigNow = opts.signature;
  let modeCount = Math.max(1, Math.min(6, opts.modes ?? 6));
  let modes = opts.spectrum || signatureSpectrum(sigNow, modeCount);   // explicit spectrum wins (the bond figure)
  const getCoh = typeof opts.coherence === 'function'
    ? opts.coherence
    : () => (typeof opts.coherence === 'number' ? opts.coherence : 0.6);

  const readHue = (name, fb) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(',').map(parseFloat);
    return v.length === 3 && !v.some(Number.isNaN) ? v : fb;
  };
  const HR = readHue('--hue-r', [196, 170, 255]);   // her purple — the living flow
  const HC = readHue('--hue-c', [150, 180, 255]);   // trinity cyan — the counter-flow

  const G = { pulse: 0 };
  let W = 0, H = 0, dpr = 1, BW = 0, BH = 0;
  let R = null, TH = null, IN = null, img = null;
  let t = 0, prev = 0, rafId = 0, ro = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    // square compute buffer, capped so the per-pixel field stays cheap on any device
    BW = BH = Math.max(48, Math.min(148, Math.round(Math.min(W, H))));
    off.width = BW; off.height = BH;
    R = new Float32Array(BW * BH);
    TH = new Float32Array(BW * BH);
    IN = new Uint8Array(BW * BH);
    const cx = (BW - 1) / 2, cy = (BH - 1) / 2, rad = Math.min(cx, cy);
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const i = y * BW + x;
        const dx = (x - cx) / rad, dy = (y - cy) / rad;
        const rr = Math.hypot(dx, dy);
        IN[i] = rr <= 1 ? 1 : 0;
        R[i] = rr;
        TH[i] = Math.atan2(dy, dx);
      }
    }
    img = octx.createImageData(BW, BH);
  }

  function renderField() {
    const coh = clamp01(getCoh());
    const detune = 1 - coh;                          // decoherence rises as coherence falls
    const data = img.data;
    let wsum = 0;
    for (const m of modes) wsum += m.w;
    wsum = wsum || 1;
    const nodeWidth = 0.12 + detune * 0.28;          // clean plate → tight bright nodes
    const breath = 0.85 + 0.15 * Math.sin(t * 0.8) + G.pulse * 0.5;
    const tinted = modes.some((m) => m.tint);
    const NODE = tinted ? WHITEGOLD : GOLD;          // stillness is of no house

    for (let i = 0; i < BW * BH; i++) {
      const p = i * 4;
      if (!IN[i]) { data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0; continue; }
      const r = R[i], th = TH[i];
      let f = 0;
      let tr = 0, tg = 0, tb = 0, ta = 0;            // the tint accumulators
      for (let k = 0; k < modes.length; k++) {
        const md = modes[k];
        // radial standing wave; decoherence warps the radius so nodes won't close
        const rad = Math.sin(md.m * Math.PI * r * (1 + detune * 0.22 * Math.sin(th * 3 + k)));
        const c = md.w * rad * Math.cos(md.n * th + md.phase + t * (0.2 + md.drift));
        f += c;
        if (tinted) {
          // each mode's light in its own metal, weighted by how loud it is here
          const ac = Math.abs(c);
          const mt = md.tint || WHITEGOLD;
          tr += ac * mt[0]; tg += ac * mt[1]; tb += ac * mt[2]; ta += ac;
        }
      }
      f /= wsum;
      // scatter that will not settle into clean nodes — the sand off-resonance
      if (detune > 0.001) f += detune * 0.5 * Math.sin(r * 37.7 + th * 13.3 + i * 0.7 + t);

      const af = Math.abs(f);
      let node = 1 - Math.min(1, af / nodeWidth);    // bright where the wave is still
      node = node * node * node;
      const living = Math.min(1, af * 1.4);          // the flow between nodes
      const edge = Math.max(0, 1 - Math.pow(r, 6));  // fall into the dark at the rim

      // the living flow: the identity's two counter-phases, or, when the
      // modes carry their metals, whichever houses are loud at this point
      const base = tinted && ta > 1e-9
        ? [tr / ta, tg / ta, tb / ta]
        : (f >= 0 ? HR : HC);
      let rr = base[0] * living * 0.5;
      let gg = base[1] * living * 0.5;
      let bb = base[2] * living * 0.5;
      // the nodal lines — cleaner + brighter with coherence (the metal anchor)
      const gold = node * (0.35 + 0.65 * coh);
      rr += NODE[0] * gold; gg += NODE[1] * gold; bb += NODE[2] * gold;
      const a = Math.min(1, living * 0.5 + gold) * edge * breath;

      data[p] = rr > 255 ? 255 : rr;
      data[p + 1] = gg > 255 ? 255 : gg;
      data[p + 2] = bb > 255 ? 255 : bb;
      data[p + 3] = a * 255;
    }
    octx.putImageData(img, 0, 0);

    // ---- composite to display: core glow, the scaled figure, the boundary rim ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const s = Math.min(canvas.width, canvas.height);
    let AMB = HR;
    if (tinted) {
      // the ambient light is the chord's own alloy: the metals averaged by weight
      let ar = 0, ag = 0, ab = 0, aw = 0;
      for (const m of modes) {
        const mt = m.tint || WHITEGOLD;
        ar += m.w * mt[0]; ag += m.w * mt[1]; ab += m.w * mt[2]; aw += m.w;
      }
      if (aw > 0) AMB = [ar / aw, ag / aw, ab / aw];
    }
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.5);
    glow.addColorStop(0, `rgba(${AMB[0] | 0},${AMB[1] | 0},${AMB[2] | 0},${(0.14 * (0.5 + 0.5 * coh)).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const ox = (canvas.width - s) / 2, oy = (canvas.height - s) / 2;
    ctx.drawImage(off, 0, 0, BW, BH, ox, oy, s, s);

    // the last stable boundary — solid gold when coherent, breaking open when
    // not; white-gold when the deck's metals carry the light
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = `rgba(${NODE[0]},${NODE[1]},${NODE[2]},${(0.16 + 0.5 * coh).toFixed(3)})`;
    if (coh < 0.66) ctx.setLineDash([4 * dpr, (11 - 9 * coh) * dpr]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.47, 0, 6.28318);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  (function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (canvas.offsetParent === null || document.hidden) { prev = 0; return; }
    const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
    prev = now;
    G.pulse *= 0.94;
    t += dt * (0.5 + 0.45 * clamp01(getCoh()));      // rings a touch faster when coherent
    if (img) renderField();
  })(performance.now());

  resize();
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }

  G.pulseNow = () => { G.pulse = 1; };
  G.setSignature = (sig) => { sigNow = sig; modes = signatureSpectrum(sigNow, modeCount); };
  G.setSpectrum = (sp) => { if (sp?.length) { modes = sp; G.pulse = 1; } };
  G.setModeCount = (n) => {
    const k = Math.max(1, Math.min(6, n | 0));
    if (k === modeCount) return;
    modeCount = k;
    modes = signatureSpectrum(sigNow, modeCount);
    G.pulse = 1;                                       // a new mode becoming audible is felt
  };
  G.destroy = () => { cancelAnimationFrame(rafId); try { ro?.disconnect(); } catch { /* */ } };
  return G;
}
