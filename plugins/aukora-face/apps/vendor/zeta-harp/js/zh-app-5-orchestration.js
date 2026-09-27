/* ==========================================================================
   Orchestration: navigation, events, opening sequence, fence, main loop.
   ========================================================================== */

var T_MIN = 100, T_MAX = 1e8;

function clampT(t) { return Math.max(T_MIN, Math.min(T_MAX, t)); }
function glideTo(t) { ST.tTarget = clampT(t); }

function showPanel(id, on) {
  var el = document.getElementById(id);
  if (on === undefined) on = el.classList.contains('hidden');
  el.classList.toggle('hidden', !on);
  return on;
}

/* ---------------- events: ignition + crossings --------------------------- */
var EV = { labelUntil: 0 };
function showEvent(html, seconds) {
  var el = document.getElementById('eventLabel');
  el.innerHTML = html;
  el.style.opacity = 1;
  EV.labelUntil = performance.now() + (seconds || 2) * 1000;
}
function eventTick(now) {
  if (EV.labelUntil && now > EV.labelUntil) {
    document.getElementById('eventLabel').style.opacity = 0;
    EV.labelUntil = 0;
  }
}
function detectEvents(tPrev, tNow) {
  var Nprev = ZH.Nt(tPrev), Nnow = TERMS.N;
  var dT = Math.abs(tNow - tPrev), hw = halfWindow(tNow);
  if (Nnow > Nprev && Nnow - Nprev <= 3 && dT < hw) {
    for (var n = Nprev + 1; n <= Nnow; n++) {
      var zPos = (ZH.cutoffT(n) - tNow) * zScale(tNow);
      GLR.spawnRing(ZH.an(n) * RSCALE, Math.max(-SCENE_HALF, Math.min(SCENE_HALF, zPos)), 'birth');
      /* a birth is shown, not told: a ring flash in the tunnel, a chime if
         sound is on, and the entering string's tick lighting on the torus */
      TORUS.flashAt[n % 27] = performance.now();
      chime(n);
    }
  }
  /* main-sum sign change while moving slowly */
  if (dT > 0 && dT < 0.5 * hw) {
    var mPrev = ST.lastM, mNow = Mnow();
    if (mPrev !== undefined && mPrev !== 0 && (mPrev > 0) !== (mNow > 0)) {
      var lo = Math.min(tPrev, tNow), hi = Math.max(tPrev, tNow);
      var tc = ZH.bisectM(lo, hi, 60);
      if (tc !== null) {
        GLR.spawnRing(0.5, 0, 'cross');
        var nearest = null, bd = 0.5;
        for (var i = 0; i < FX.zeros.length; i++) {
          var d = Math.abs(FX.zeros[i].g - tc);
          if (d < bd) { bd = d; nearest = FX.zeros[i]; }
        }
        /* the one event label: every crossing carries the same boundary
           wording — a computed crossing (finite approximation), and never
           a certified zero */
        showEvent('computed crossing (finite approximation) at t &asymp; ' + tc.toFixed(6) +
          '<div class="sub2">' +
          (nearest
            ? 'refined reference zero &gamma; &asymp; ' + esc(nearest.gs.slice(0, 22)) +
              ' nearby &middot; offset ' + fmtSig(tc - nearest.g, 3) + ' (finite-sum error) &middot; '
            : 'sign change of the main sum M(t) &middot; ') +
          'not a certified zero</div>', 2.5);
      }
    }
  }
  ST.lastM = Mnow();
}

/* ---------------- intro B: the controls tour -------------------------------
   After the dramatic flight, three beats — no more. LEFT-anchored at
   left:18px, serif 19px, on a generous radial scrim, each up ~5s and
   pointing at the actual controls it names. Then they end and nothing like
   them ever appears again. The camera keeps cruising gently throughout.
   prefers-reduced-motion: the beats swap instantly (no fades). */
var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
var TOURB = { i: -1, timer: 0, on: false };
var BEATS = [
  { text: 'play, speed, zoom — here', targets: ['cluster'] },
  { text: 'sound and volume — here', targets: ['cpSound'] },
  { text: 'the torus, the flower, the wave — here', targets: ['torusCv', 'sliceCv', 'ribbonPanel'] }
];
function introBStart() {
  if (TOURB.on) return;
  TOURB.on = true; TOURB.i = -1;
  introBNext();
}
function introBNext() {
  if (!TOURB.on) return;
  TOURB.i++;
  if (TOURB.i >= BEATS.length) { introBEnd(); return; }
  var el = document.getElementById('tourBeat');
  el.textContent = BEATS[TOURB.i].text;
  el.classList.add('on');
  introBPoint(BEATS[TOURB.i].targets);
  TOURB.timer = setTimeout(introBNext, 5000);
}
function introBEnd() {
  TOURB.on = false;
  clearTimeout(TOURB.timer);
  var el = document.getElementById('tourBeat');
  if (el) { el.classList.remove('on'); el.textContent = ''; }
  var svg = document.getElementById('tourSVG');
  if (svg) svg.innerHTML = '';
}
/* one dashed gold connector from the beat's scrim to each control it names,
   ending in a small dot on the control's edge — the beat points, literally */
function introBPoint(ids) {
  var svg = document.getElementById('tourSVG');
  var NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  var beat = document.getElementById('tourBeat').getBoundingClientRect();
  var x1 = beat.right - 34, y1 = beat.top + beat.height / 2;
  for (var q = 0; q < ids.length; q++) {
    var t = document.getElementById(ids[q]);
    if (!t) continue;
    var r = t.getBoundingClientRect();
    var x2 = r.left, y2 = r.top + Math.min(r.height - 8, Math.max(8, r.height / 2));
    if (ids[q] === 'ribbonPanel') { x2 = r.left + Math.min(220, r.width * 0.18); }
    var mx = (x1 + x2) / 2;
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      ' C ' + mx.toFixed(1) + ' ' + y1.toFixed(1) + ', ' + mx.toFixed(1) + ' ' +
      y2.toFixed(1) + ', ' + (x2 - 7).toFixed(1) + ' ' + y2.toFixed(1));
    path.setAttribute('class', 'bp');
    svg.appendChild(path);
    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', (x2 - 4).toFixed(1)); dot.setAttribute('cy', y2.toFixed(1));
    dot.setAttribute('r', 3); dot.setAttribute('class', 'bpdot');
    svg.appendChild(dot);
  }
}

/* views open as clean windows: one at a time, anchored to the left edge */
var VIEW_PANELS = ['flowerPanel', 'microPanel', 'fencePanel', 'inspectorPanel'];
function openView(id, on) {
  var el = document.getElementById(id);
  if (on === undefined) on = el.classList.contains('hidden');
  if (on) VIEW_PANELS.forEach(function (v) { if (v !== id) showPanel(v, false); });
  showPanel(id, on);
  syncChips();
  if (on && TOURB.on) introBEnd();   /* a window takes precedence over the tour beats */
  return on;
}
function closeAllViews() {
  VIEW_PANELS.forEach(function (v) { showPanel(v, false); });
  syncChips();
}
function syncChips() {
  /* a left-anchored window takes precedence over the left column's label */
  document.body.classList.toggle('leftwin',
    panelVisible('flowerPanel') || panelVisible('microPanel') || panelVisible('inspectorPanel'));
}

/* ---- cross-section inset: "flower · now" — the same renderer, small ----- */
function drawSlice() {
  var cv = document.getElementById('sliceCv');
  if (!cv) return;
  drawPhasorSection(cv, false);
}

/* ---- the torus room: the formula's phases on the Clifford torus -----------
   Three views of the same object, switched by the SHADOW / SLICE / UNFOLD
   buttons above the canvas:
   SHADOW — the Clifford torus (cos u, sin u, cos v, sin v)/sqrt(2) in R4,
     double-rotated in two orthogonal planes: (x,z) by A, (y,w) by B, where
     A and B are the driving phases phi_3(t), phi_4(t) plus a slow constant
     viewing spin; projected 4D -> 3D -> 2D.
   SLICE — the same object held still (A = 0, B = pi/2, no spin), brighter,
     plus the single cut circle at the current phi_2 in gold.
   UNFOLD — the flat (phi_1, phi_2) square fundamental domain, opposite
     edges glued; the trail breaks where it wraps across a glued edge.
   The gold point is "you are here": (phi_1(t), phi_2(t)) — the same phases
   the sum itself uses, phi_n(t) = theta(t) - t ln n (the ZH math core). */
var TOR = { trail: [], spin: 0 };
var TOR_VIEW = 'shadow';
var TORUS = { flashAt: new Float64Array(27) };   /* birth-flash slots, still written by detectEvents */
var TOR_VIEW_TEXT = {
  shadow: "the torus — the formula's phases, turning",
  slice: 'one still slice — the gold ring is you',
  unfold: 'unfolded flat — the edges wrap around'
};
function torTick(dt, tChanged) {
  TOR.spin += dt * 0.12;
  if (tChanged && TERMS.N >= 4) {
    TOR.trail.push([ZH.mod2pi(ZH.phin(1, ST.t)), ZH.mod2pi(ZH.phin(2, ST.t))]);
    if (TOR.trail.length > 140) TOR.trail.shift();
  }
}
function drawTorus() {
  var cv = document.getElementById('torusCv');
  if (!cv) return;
  var ctx = fitCanvas(cv);
  var W = cv.clientWidth, H = cv.clientHeight;
  ctx.clearRect(0, 0, W, H);
  var TWO_PI = Math.PI * 2, PI = Math.PI;
  var p1 = ZH.mod2pi(ZH.phin(1, ST.t)), p2 = ZH.mod2pi(ZH.phin(2, ST.t));
  var i, gr;

  if (TOR_VIEW === 'unfold') {
    /* flat fundamental domain (-pi, pi]^2, opposite edges glued */
    var pad = Math.max(22, W * 0.09);
    var S = Math.min(W, H) - 2 * pad;
    var ox = (W - S) / 2, oy = (H - S) / 2;
    function px(a) { return ox + ((a + PI) / TWO_PI) * S; }
    function py(a) { return oy + S - ((a + PI) / TWO_PI) * S; }
    ctx.lineWidth = 1;
    for (i = 1; i < 12; i++) {
      var ga = -PI + TWO_PI * i / 12;
      ctx.strokeStyle = 'rgba(91,142,242,0.16)';
      ctx.beginPath(); ctx.moveTo(px(ga), oy); ctx.lineTo(px(ga), oy + S); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,107,255,0.14)';
      ctx.beginPath(); ctx.moveTo(ox, py(ga)); ctx.lineTo(ox + S, py(ga)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(198,214,240,0.34)';
    ctx.strokeRect(ox, oy, S, S);
    /* the trail, breaking across glued-edge wraps */
    for (i = 1; i < TOR.trail.length; i++) {
      var a0 = TOR.trail[i - 1], a1 = TOR.trail[i];
      if (Math.abs(a1[0] - a0[0]) > PI || Math.abs(a1[1] - a0[1]) > PI) continue;
      ctx.strokeStyle = 'rgba(226,180,90,' + (0.05 + 0.55 * (i / TOR.trail.length)).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(px(a0[0]), py(a0[1])); ctx.lineTo(px(a1[0]), py(a1[1])); ctx.stroke();
    }
    /* the gold point: you are here */
    gr = Math.max(3.6, W / 150);
    ctx.strokeStyle = 'rgba(226,180,90,0.35)';
    ctx.beginPath(); ctx.arc(px(p1), py(p2), gr * 2.1, 0, TWO_PI); ctx.stroke();
    ctx.fillStyle = COL.gold;
    ctx.beginPath(); ctx.arc(px(p1), py(p2), gr, 0, TWO_PI); ctx.fill();
    return;
  }

  /* SHADOW / SLICE: the Clifford torus in R4, double rotation, 4D->3D->2D */
  if (TERMS.N < 4) {
    ctx.fillStyle = 'rgba(107,120,144,0.9)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('needs at least four', W / 2, H / 2 - 8);
    ctx.fillText('threads — fly higher', W / 2, H / 2 + 8);
    ctx.textAlign = 'left';
    return;
  }
  var sliceMode = TOR_VIEW === 'slice';
  var A = sliceMode ? 0 : ZH.mod2pi(ZH.phin(3, ST.t)) + TOR.spin;
  var B = sliceMode ? PI / 2 : ZH.mod2pi(ZH.phin(4, ST.t)) + TOR.spin * 0.7;
  var cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
  function proj(u, v) {
    var x = Math.cos(u) * Math.SQRT1_2, y = Math.sin(u) * Math.SQRT1_2;
    var z = Math.cos(v) * Math.SQRT1_2, w = Math.sin(v) * Math.SQRT1_2;
    var x2 = x * cA - z * sA, z2 = x * sA + z * cA;    /* rotation in the (x,z) plane */
    var y2 = y * cB - w * sB, w2 = y * sB + w * cB;    /* rotation in the (y,w) plane */
    var s4 = 1.35 / (2.1 - w2);                        /* 4D -> 3D perspective */
    var X = x2 * s4, Y = y2 * s4, Z = z2 * s4;
    var s3 = 1.9 / (2.9 - Z);                          /* 3D -> 2D perspective */
    return [W / 2 + X * s3 * W * 0.78, H / 2 - Y * s3 * H * 0.78];
  }
  var GU = sliceMode ? 4 : 14, GS = 64;
  var j, pp;
  ctx.lineWidth = 1;
  /* u-lines (parallels of the phase square) in blue, v-lines in purple */
  ctx.strokeStyle = sliceMode ? 'rgba(91,142,242,0.40)' : 'rgba(91,142,242,0.26)';
  for (j = 0; j < GU; j++) {
    var u0 = TWO_PI * j / GU;
    ctx.beginPath();
    for (i = 0; i <= GS; i++) {
      pp = proj(u0, TWO_PI * i / GS);
      if (i === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = sliceMode ? 'rgba(160,107,255,0.38)' : 'rgba(160,107,255,0.24)';
  for (j = 0; j < GU; j++) {
    var v0 = TWO_PI * j / GU;
    ctx.beginPath();
    for (i = 0; i <= GS; i++) {
      pp = proj(TWO_PI * i / GS, v0);
      if (i === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]);
    }
    ctx.stroke();
  }
  /* the trail: recent (phi_1, phi_2) phase points, fading gold */
  for (i = 1; i < TOR.trail.length; i++) {
    var t0p = TOR.trail[i - 1], t1p = TOR.trail[i];
    if (Math.abs(t1p[0] - t0p[0]) > PI || Math.abs(t1p[1] - t0p[1]) > PI) continue;
    var q0 = proj(t0p[0], t0p[1]), q1 = proj(t1p[0], t1p[1]);
    ctx.strokeStyle = 'rgba(226,180,90,' + (0.05 + 0.55 * (i / TOR.trail.length)).toFixed(3) + ')';
    ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
  }
  /* SLICE: the single cut circle at the current phi_2, in gold */
  if (sliceMode) {
    ctx.strokeStyle = 'rgba(226,180,90,0.55)';
    ctx.beginPath();
    for (i = 0; i <= GS * 2; i++) {
      pp = proj(TWO_PI * i / (GS * 2), p2);
      if (i === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]);
    }
    ctx.stroke();
  }
  /* the gold point (phi_1, phi_2) with its halo: you are here */
  var gp = proj(p1, p2);
  gr = Math.max(3.6, W / 150);
  ctx.strokeStyle = 'rgba(226,180,90,0.35)';
  ctx.beginPath(); ctx.arc(gp[0], gp[1], gr * 2.1, 0, TWO_PI); ctx.stroke();
  ctx.fillStyle = COL.gold;
  ctx.beginPath(); ctx.arc(gp[0], gp[1], gr, 0, TWO_PI); ctx.fill();
}

/* ---------------- HUD -----------------------------------------------------
   No standing telemetry on screen: the allowed text is the masthead, the
   crossing event label, the control labels and their one-line plain-words
   notes, the torus label, the chart axis ticks, and the intro-B beats.
   Nothing below 12px. The sound-law disclosures live in the fence panel
   (fillFenceLive); nothing else. */

/* ---------------- fence ---------------------------------------------------- */
function fillFenceStatic() {
  var rt = document.getElementById('fenceRTable');
  var vt2 = document.getElementById('fenceVTable');
  var keys = Object.keys(FX.windows);
  for (var i = 0; i < keys.length; i++) {
    var w = FX.windows[keys[i]], maxR = 0, rms = 0, maxM = 0, k;
    for (k = 0; k < w.Z.length; k++) {
      var Mfix = w.M[k];
      maxR = Math.max(maxR, Math.abs(w.R[k]));
      rms += w.R[k] * w.R[k];
      maxM = Math.max(maxM, Math.abs(Mfix));
    }
    rms = Math.sqrt(rms / w.Z.length);
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + keys[i] + '</td><td>[' + fmtT(w.range[0]) + ', ' + fmtT(w.range[1]) + ']</td>' +
      '<td>' + fmtSig(maxR, 4) + '</td><td>' + fmtSig(rms, 4) + '</td><td>' + fmtSig(maxM, 4) + '</td>';
    rt.appendChild(tr);

    /* in-page self-check: inline M vs embedded fixture M */
    var maxDiff = 0;
    for (k = 0; k < w.M.length; k++) {
      var tg = w.range[0] + k * w.step;
      maxDiff = Math.max(maxDiff, Math.abs(ZH.M(tg) - w.M[k]));
    }
    var tv = document.createElement('tr');
    tv.innerHTML = '<td>' + keys[i] + '</td><td>' + w.M.length + '</td><td>' + fmtSig(maxDiff, 3) + '</td>';
    vt2.appendChild(tv);
  }
  document.getElementById('fenceRNote').textContent =
    'R_ref is defined by subtraction from the high-precision reference, not by the ' +
    'Riemann-Siegel correction series. Near 10^8 (window W4) float64 phase rounding ' +
    '(~1e-7 rad) additionally limits the drawn phases; W4 is shown as the honest edge ' +
    'of this instrument’s range.';
}
function fillFenceLive() {
  document.getElementById('fenceDisclosures').innerHTML =
    'scale_t (scene length per unit height) = ' + fmtSig(zScale(ST.t), 4) +
    ' &nbsp;=&nbsp; ' + SCENE_HALF + ' / half-window(' + fmtSig(halfWindow(ST.t), 3) + ')<br>' +
    'radius scale (scene length per unit amplitude) = ' + RSCALE + '<br>' +
    'v_t (time dilation) = ' + fmtSig(ST.vt, 4) + ' height-units per second, one global value<br>' +
    'the hum (full sum): every one of the N(t) = ' + TERMS.N + ' terms sounds — the first ' +
    Math.min(AUD.VOICE_N, TERMS.N) + ' voiced individually, each at f_n = v_t&thinsp;(&theta;&prime;(t) &minus; ln n)/2&pi; ' +
    'with gain a_n &times; volume &times; ' + AUD.HUM_SCALE + '; the remaining ' +
    Math.max(0, TERMS.N - AUD.VOICE_N) + ' terms are band-summed into &le; ' + AUD.BAND_MAX +
    ' log-spaced bands, each one sine with energy-preserving amplitude &radic;(&Sigma;a_n&sup2;) ' +
    'at the amplitude-weighted mean rate (same law, same v_t, same gain); a voice or band is ' +
    'silenced (never retuned) when its rate falls outside 8 Hz..12 kHz at this v_t<br>' +
    'volume = SOUND group slider ' + fmtSig(ST.gain, 3) + ' (linear); voiced-term gain = a_n &times; volume &times; 0.12<br>' +
    'cutoff-entry chime: a UI event cue at the entering term’s f_audio, clamped up to 55 Hz ' +
    'for audibility — it is not part of the sonification law<br>' +
    'ribbon/helix phases beyond the exact-evaluation window use the local expansion ' +
    'φ₀ + ωu + ½θ″u² + ⅙θ‴u³ (error ≪ 10⁻³ rad at all displayed heights)';
}
