/* ==========================================================================
   ZH math core. Pure functions of (t, n). No DOM, no state, no fitted
   parameters. The donor recorded that this block was extracted verbatim by
   reference/check_inline_math.mjs and validated against its fixtures before
   the artifact shipped; NEITHER that script nor that spec travelled with this
   page, so phi cannot re-run it and does not claim it. What IS checkable here
   and runs on every load: fillFenceStatic recomputes M(t) from this block at
   every embedded fixture grid point and prints the maximum deviation.

   Standing label: KNOWN MATHEMATICS / INTERACTIVE SCIENTIFIC AND ARTISTIC
   INSTRUMENT / NOT EVIDENCE FOR RH OR GHP.
   ========================================================================== */
(function () {
  'use strict';
  var TWO_PI = Math.PI * 2;
  var LN_2PI = Math.log(TWO_PI);

  /* MATH_SPEC section 2 — Riemann-Siegel theta, working asymptotic:
     theta(t) ~ (t/2) ln(t/2pi) - t/2 - pi/8 + 1/(48 t) + 7/(5760 t^3) */
  function theta(t) {
    return 0.5 * t * (Math.log(t) - LN_2PI) - 0.5 * t - Math.PI / 8
      + 1 / (48 * t) + 7 / (5760 * t * t * t);
  }

  /* d/dt of the working asymptotic:
     theta'(t) ~ (1/2) ln(t/2pi) - 1/(48 t^2) - 7/(1920 t^4) */
  function thetaPrime(t) {
    var t2 = t * t;
    return 0.5 * (Math.log(t) - LN_2PI) - 1 / (48 * t2) - 7 / (1920 * t2 * t2);
  }

  /* Higher local derivatives used ONLY for the local phase expansion of the
     rendered window (disclosed in the fence panel). Leading terms:
     theta''(t) = 1/(2t) + O(t^-3), theta'''(t) = -1/(2t^2) + O(t^-4). */
  function thetaPP(t) { return 1 / (2 * t) + 1 / (24 * t * t * t); }
  function thetaPPP(t) { return -1 / (2 * t * t); }

  /* MATH_SPEC section 3 — main-sum term count N(t) = floor(sqrt(t/2pi)).
     Guard the floor against float rounding exactly at cutoff-entry heights
     t_n = 2 pi n^2: nudge by one ulp-scale epsilon so N(2 pi n^2) = n. */
  function Nt(t) {
    if (!(t > 0)) return 0;
    var x = Math.sqrt(t / TWO_PI);
    var f = Math.floor(x);
    if (f + 1 - x < 4e-16 * x) f = f + 1; /* x within rounding of integer above */
    return f;
  }

  /* MATH_SPEC section 4 — computed spectral amplitude, phase, contribution. */
  function an(n) { return 2 / Math.sqrt(n); }
  function phin(n, t) { return theta(t) - t * Math.log(n); }
  function cn(n, t) { return an(n) * Math.cos(phin(n, t)); }

  /* MATH_SPEC section 5 — main sum M(t). */
  function M(t) {
    var N = Nt(t), s = 0;
    for (var n = 1; n <= N; n++) s += cn(n, t);
    return s;
  }

  /* MATH_SPEC section 6 — instantaneous term frequency in the height
     parameter t (NOT an audio frequency). */
  function omegan(n, t) { return thetaPrime(t) - Math.log(n); }
  function fn(n, t) { return omegan(n, t) / TWO_PI; }

  /* MATH_SPEC section 7 — cutoff-entry height t_n = 2 pi n^2.
     A height, never a frequency. */
  function cutoffT(n) { return TWO_PI * n * n; }

  /* MATH_SPEC section 9 — Truth Audio law. One global disclosed v_t.
     f_audio_n = v_t * (theta'(t) - ln n) / 2pi  [Hz]. */
  function fAudio(n, t, vt) { return vt * omegan(n, t) / TWO_PI; }

  /* Reduce a phase to (-pi, pi] for display and float32 handoff. The
     reduction error inherits the float64 rounding of theta(t) itself
     (~1e-7 rad at t ~ 1e8 — the documented W4 accuracy frontier). */
  function mod2pi(x) {
    var y = x - TWO_PI * Math.round(x / TWO_PI);
    if (y <= -Math.PI) y += TWO_PI;
    if (y > Math.PI) y -= TWO_PI;
    return y;
  }

  /* Bracket + bisect a sign change of M on [a,b]. Returns the crossing
     location or null. Labeling law: results are "computed crossings
     (finite approximation)" — never certified zeros. */
  function bisectM(a, b, iters) {
    var fa = M(a), fb = M(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if ((fa > 0) === (fb > 0)) return null;
    for (var i = 0; i < (iters || 80); i++) {
      var m = 0.5 * (a + b), fm = M(m);
      if (fm === 0) return m;
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
    }
    return 0.5 * (a + b);
  }

  var ZH = {
    TWO_PI: TWO_PI,
    theta: theta, thetaPrime: thetaPrime, thetaPP: thetaPP, thetaPPP: thetaPPP,
    Nt: Nt, an: an, phin: phin, cn: cn, M: M,
    omegan: omegan, fn: fn, cutoffT: cutoffT, fAudio: fAudio,
    mod2pi: mod2pi, bisectM: bisectM
  };
  if (typeof globalThis !== 'undefined') globalThis.ZH = ZH;
})();
