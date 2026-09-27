'use strict';
/* ==========================================================================
   State + computation cache. Everything here calls the ZH math core only.
   ========================================================================== */

/* Disclosed rendering constants (fence panel). */
var RSCALE = 6.0;          /* scene length per unit amplitude (radius = RSCALE * a_n) */
var SCENE_HALF = 80.0;     /* scene half-length of the rendered height window */
var RIB_K = 288;           /* samples across the window for the resultant ribbon */
var EXACT_N_LIMIT = 512;   /* below this term count the ribbon is evaluated exactly */

var FX = window.ZH_FX;   /* fixtures arrive as js/zh-fixtures-1.js + zh-fixtures-2.js */

var ST = {
  t: 1e6,                  /* current height t0 */
  tTarget: null,           /* glide target (log-space approach) */
  frozen: false,
  sel: -1,                 /* selected term n, -1 none */
  layers: { M: true, Z: true, R: true },   /* chart chips drive chart AND tunnel (one eased fade each) */
  paused: false,           /* PLAY button: false = time and camera both run */
  speed: 0.35,             /* cruise speed from the SPEED slider, eased toward speedTarget */
  speedTarget: 0.35,       /* 0 = stopped .. 1 = fast cruise; default 35% = gentle */
  opening: true,
  vt: Math.pow(10, 2.4),   /* disclosed global time dilation, height units / s */
  gain: 0.35,
  audioOn: false,
  artistic: { reverb: false, quant: false },
  voiced: [],
  lastMSign: 0,
  lastN: 0
};

var TERMS = { N: 0, NR: 0, a: null, phi0: null, omega: null, c: null, born: null };
var RIB = { u: new Float64Array(RIB_K), x: new Float64Array(RIB_K), y: new Float64Array(RIB_K), valid: false };

/* Layer fades, shared by BOTH surfaces. The chart chips M / Z / R each ease
   one 0..1 value here, once per frame; the tunnel (GLR.draw) and the chart
   (drawRibbon) read the SAME value, so a layer appears and disappears on both
   surfaces together, always, with an ease — no split state, no snapping.
   Layer meaning: M = the strings (tunnel helices), Z = the resultant
   (the gold line on the chart AND the gold coil in the tunnel — the same
   curve — plus the fixture Z_ref trace on the chart), R = the fixture
   remainder trace (chart only; the remainder is never drawn as geometry). */
var LYR = { M: 1, Z: 1, R: 1 };
function layerFadeTick(dt) {
  var k;
  for (k in LYR) {
    var tgt = ST.layers[k] ? 1 : 0;
    LYR[k] += (tgt - LYR[k]) * Math.min(1, dt * 4.5);
    if (Math.abs(tgt - LYR[k]) < 0.01) LYR[k] = tgt;
  }
}

function halfWindow(t) {
  var N = Math.max(3, ZH.Nt(t));
  var h = 48 / Math.log(N);
  return Math.max(4, Math.min(30, h));
}
function zScale(t) { return SCENE_HALF / halfWindow(t); }

/* --- term cache at t0 --------------------------------------------------- */
function computeTerms(t) {
  var N = ZH.Nt(t);
  var hw = halfWindow(t);
  var NR = ZH.Nt(t + hw);           /* includes terms whose cutoff entry is inside the window */
  if (!TERMS.a || TERMS.a.length < NR) {
    TERMS.a = new Float64Array(NR + 8); TERMS.phi0 = new Float64Array(NR + 8);
    TERMS.omega = new Float64Array(NR + 8); TERMS.c = new Float64Array(NR + 8);
    TERMS.born = new Float64Array(NR + 8);
  }
  var th = ZH.theta(t), tp = ZH.thetaPrime(t);
  for (var n = 1; n <= NR; n++) {
    var i = n - 1;
    TERMS.a[i] = ZH.an(n);
    TERMS.phi0[i] = ZH.mod2pi(th - t * Math.log(n));
    TERMS.omega[i] = tp - Math.log(n);
    TERMS.c[i] = TERMS.a[i] * Math.cos(TERMS.phi0[i]);
    var tb = ZH.cutoffT(n) - t;      /* birth position in window coords */
    TERMS.born[i] = (tb <= -hw) ? (-hw - 1) : tb;
  }
  TERMS.N = N; TERMS.NR = NR;
}
function Mnow() {
  var s = 0;
  for (var n = 0; n < TERMS.N; n++) s += TERMS.c[n];
  return s;
}

/* --- resultant ribbon over the window ----------------------------------- */
function computeRibbon(t) {
  var hw = halfWindow(t), K = RIB_K;
  var du = 2 * hw / (K - 1);
  var k, n;
  for (k = 0; k < K; k++) RIB.u[k] = -hw + du * k;
  if (ZH.Nt(t + hw) <= EXACT_N_LIMIT) {
    /* exact evaluation (also handles N(t) changing inside the window) */
    for (k = 0; k < K; k++) {
      var ta = t + RIB.u[k], th = ZH.theta(ta), Nk = ZH.Nt(ta), sx = 0, sy = 0;
      for (n = 1; n <= Nk; n++) {
        var phi = th - ta * Math.log(n), a = 2 / Math.sqrt(n);
        sx += a * Math.cos(phi); sy += a * Math.sin(phi);
      }
      RIB.x[k] = sx; RIB.y[k] = sy;
    }
  } else {
    /* local-expansion phase recurrence (windows here never cross a cutoff:
       cutoff spacing 2pi(2N+1) >> window width for N > EXACT_N_LIMIT) */
    for (k = 0; k < K; k++) { RIB.x[k] = 0; RIB.y[k] = 0; }
    var thpp = ZH.thetaPP(t), thppp = ZH.thetaPPP(t);
    var N = TERMS.N;
    var incA = thpp * du * du;                       /* constant step-rotation drift */
    var ci = Math.cos(incA), si = Math.sin(incA);
    for (n = 0; n < N; n++) {
      var a2 = TERMS.a[n], om = TERMS.omega[n];
      var u0 = -hw;
      var phiStart = TERMS.phi0[n] + om * u0 + 0.5 * thpp * u0 * u0 + thppp * u0 * u0 * u0 / 6;
      var px = a2 * Math.cos(phiStart), py = a2 * Math.sin(phiStart);
      var d0 = om * du + thpp * du * (u0 + du / 2);   /* first step increment */
      var sc = Math.cos(d0), ss = Math.sin(d0);
      RIB.x[0] += px; RIB.y[0] += py;
      for (k = 1; k < K; k++) {
        var nx = px * sc - py * ss; py = px * ss + py * sc; px = nx;
        RIB.x[k] += px; RIB.y[k] += py;
        var nc = sc * ci - ss * si; ss = sc * si + ss * ci; sc = nc;
      }
    }
  }
  RIB.valid = true;
}

/* --- fixture access ------------------------------------------------------ */
function fixtureWindowAt(t) {
  for (var key in FX.windows) {
    var w = FX.windows[key];
    if (t >= w.range[0] && t <= w.range[1]) return key;
  }
  return null;
}
function fixtureOverlap(tLo, tHi) {
  for (var key in FX.windows) {
    var w = FX.windows[key];
    if (tHi >= w.range[0] && tLo <= w.range[1]) return key;
  }
  return null;
}
/* linear interpolation on the fixture grid; returns {Z, R} or null */
function fixtureInterp(t) {
  var key = fixtureWindowAt(t);
  if (!key) return null;
  var w = FX.windows[key];
  var x = (t - w.range[0]) / w.step;
  var i = Math.floor(x);
  if (i >= w.Z.length - 1) i = w.Z.length - 2;
  var f = x - i;
  return {
    win: key,
    Z: w.Z[i] * (1 - f) + w.Z[i + 1] * f,
    R: w.R[i] * (1 - f) + w.R[i + 1] * f
  };
}
/* First Z_ref sign change at/after tFrom in fixture window `key`.
   IMPORTANT (honesty): at W3/W4 heights the grid step (0.5) is comparable to
   the local zero spacing (~2pi/ln(t/2pi)), so interpolating Z_ref between
   grid points would fabricate a location. We therefore return the BRACKET
   [t_i, t_i+step] (certain from the high-precision endpoint values) and the
   bracket endpoint with the smaller |Z_ref| as the freeze point. */
function fixtureBestCrossingBracket(key) {
  var w = FX.windows[key], best = null, bestScore = 1e9;
  for (var i = 0; i < w.Z.length - 1; i++) {
    if ((w.Z[i] > 0) !== (w.Z[i + 1] > 0)) {
      var score = Math.min(Math.abs(w.Z[i]), Math.abs(w.Z[i + 1]));
      if (score < bestScore) {
        bestScore = score;
        var ta = w.range[0] + i * w.step;
        var pickLeft = Math.abs(w.Z[i]) <= Math.abs(w.Z[i + 1]);
        best = {
          tLo: ta, tHi: ta + w.step,
          zLo: w.Z[i], zHi: w.Z[i + 1],
          tAt: pickLeft ? ta : ta + w.step,
          zAt: pickLeft ? w.Z[i] : w.Z[i + 1]
        };
      }
    }
  }
  return best;
}

/* --- formatting ---------------------------------------------------------- */
function fmtSig(x, d) {
  if (!isFinite(x)) return '—';
  if (x === 0) return '0';
  var ax = Math.abs(x);
  if (ax >= 1e-4 && ax < 1e7) {
    var s = x.toPrecision(d || 4);
    if (s.indexOf('e') < 0 && s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s;
  }
  return x.toExponential((d || 4) - 1);
}
function fmtT(t) {
  if (t < 1e5) return t.toFixed(3);
  return Math.round(t).toLocaleString('en-US');
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
