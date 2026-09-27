/* ==========================================================================
   Truth Audio — MATH_SPEC section 9.
   f_audio_n = v_t * (theta'(t) - ln n) / 2pi, one global v_t, one global gain.

   THE HUM (full sum, the donor's disclosed scheme): every one of the N(t)
   terms sounds. The first VOICE_N = 24 terms are voiced individually (sine
   per term, amplitude a_n = 2/sqrt(n)); the remaining N - 24 terms are
   band-summed into at most BAND_MAX = 8 bands, log-spaced in n. Each band is
   one sine at the amplitude-weighted mean rate f_b = sum(a_n f_n)/sum(a_n)
   with energy-preserving amplitude A_b = sqrt(sum a_n^2), so the rendered
   energy (sum over voices+bands of amplitude^2) equals the sum over all N
   terms of a_n^2 exactly. One disclosed v_t, one global gain (the cockpit
   SOUND group's volume slider); no per-string tuning. A voice or band is
   silenced — disclosed, never retuned — when its rate falls outside
   8 Hz..12 kHz at this v_t. Inspector-voiced terms ride separate oscillators.

   ROOT-CAUSE NOTES on the "no sound" defect this replaced:
   (1) the only enable control lived inside a panel hidden behind a chip —
       most sessions never opened it;
   (2) the default v_t (10^1.56 = 36 height-units/s) put every f_n at tour
       heights at ~5..35 Hz — at or below the audible floor, so even an
       "enabled" hum was effectively silence;
   (3) there was no visual feedback that audio was running;
   (4) a gesture-created AudioContext can stay 'suspended' (Safari) until
       resume() is awaited — toggling without awaiting it stayed silent.
   Fixes: the cockpit SOUND group is always visible and its toggle IS the
   gesture (the AudioContext is created and resume() awaited inside that
   click, with failures reported in the group); default v_t is now 10^2.4
   (f_1 ~ 240 Hz at t = 10^6); an analyser-driven 12-bar visualizer moves
   whenever sound is on.
   ========================================================================== */

var AUD = {
  ctx: null, master: null, analyser: null, wet: null, conv: null,
  started: false,
  VOICE_N: 24,          /* first terms voiced individually */
  BAND_MAX: 8,          /* log-spaced remainder bands (full-sum render) */
  HUM_SCALE: 0.10, VOICE_MAX: 8, MASTER_SCALE: 0.045,
  VIZ_BARS: 12,         /* sound-bar visualizer bar count (display only) */
  voices: [],           /* [{osc, g}] for terms n = 1..VOICE_N */
  bandOsc: [],          /* [{osc, g}] for the <= BAND_MAX remainder bands */
  plan: null,           /* live full-sum plan (see audioPlan) */
  voiced: {},           /* n -> {osc, g} (inspector-voiced extra terms) */
  vizData: null, vizSmooth: null
};

/* The full-sum render plan at term count N: pure function, no audio state —
   the same numbers drive the oscillators, the disclosure line, and the
   verification harness. Terms 1..min(VOICE_N, N) are voiced; terms V+1..N go
   into B = min(BAND_MAX, N - V) bands, log-spaced in n. Each band carries
   amp = sqrt(sum a_n^2) (energy-preserving) and nEff with
   ln nEff = sum(a_n ln n)/sum(a_n), so its rate f_b = v_t(theta' - ln nEff)/2pi
   is the amplitude-weighted mean of its member rates — the same law. */
function audioPlan(N) {
  var V = Math.min(AUD.VOICE_N, N), D = N - V, bands = [];
  if (D > 0) {
    var B = Math.min(AUD.BAND_MAX, D);
    var lo = Math.log(V + 0.5), hi = Math.log(N + 0.5), n, b, a, bd;
    for (b = 0; b < B; b++) bands.push({ n0: 0, n1: -1, count: 0, amp2: 0, wsum: 0, wln: 0 });
    for (n = V + 1; n <= N; n++) {
      var k = Math.floor(B * (Math.log(n) - lo) / (hi - lo));
      if (k < 0) k = 0; else if (k >= B) k = B - 1;
      a = ZH.an(n); bd = bands[k];
      bd.amp2 += a * a; bd.wsum += a; bd.wln += a * Math.log(n); bd.count++;
      if (bd.count === 1 || n < bd.n0) bd.n0 = n;
      if (n > bd.n1) bd.n1 = n;
    }
    bands = bands.filter(function (bd2) { return bd2.count > 0; });
    for (b = 0; b < bands.length; b++) {
      bd = bands[b];
      bd.amp = Math.sqrt(bd.amp2);
      bd.nEff = Math.exp(bd.wln / bd.wsum);
    }
  }
  return { N: N, V: V, D: D, B: bands.length, bands: bands };
}

function audioEnsure(cb) {
  if (AUD.started) { cb && cb(); return; }
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('this browser has no Web Audio');
  AUD.ctx = new Ctx();
  AUD.master = AUD.ctx.createGain();
  AUD.master.gain.value = 1;
  AUD.master.connect(AUD.ctx.destination);
  /* analyser tap for the SOUND group visualizer: pulled through a silent gain
     so the tap is rendered without doubling the audible signal */
  AUD.analyser = AUD.ctx.createAnalyser();
  AUD.analyser.fftSize = 2048;
  AUD.analyser.smoothingTimeConstant = 0.55;
  var tap = AUD.ctx.createGain(); tap.gain.value = 0;
  AUD.master.connect(AUD.analyser); AUD.analyser.connect(tap); tap.connect(AUD.ctx.destination);
  AUD.vizData = new Uint8Array(AUD.analyser.frequencyBinCount);
  AUD.vizSmooth = new Float64Array(AUD.VIZ_BARS);
  /* reverb path (silent until artistic mode) */
  AUD.conv = AUD.ctx.createConvolver();
  AUD.conv.buffer = makeIR(AUD.ctx, 2.0);
  AUD.wet = AUD.ctx.createGain(); AUD.wet.gain.value = 0;
  AUD.master.connect(AUD.conv); AUD.conv.connect(AUD.wet); AUD.wet.connect(AUD.ctx.destination);
  /* the hum, full sum: VOICE_N individually voiced term oscillators plus
     BAND_MAX remainder-band oscillators, exact law, gains ramped live */
  var n, osc, g;
  for (n = 1; n <= AUD.VOICE_N; n++) {
    osc = AUD.ctx.createOscillator(); g = AUD.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = Math.max(0.001, Math.abs(ZH.fAudio(n, ST.t, ST.vt)));
    g.gain.value = 0;
    osc.connect(g); g.connect(AUD.master);
    osc.start();
    AUD.voices.push({ osc: osc, g: g });
  }
  for (n = 0; n < AUD.BAND_MAX; n++) {
    osc = AUD.ctx.createOscillator(); g = AUD.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 220;
    g.gain.value = 0;
    osc.connect(g); g.connect(AUD.master);
    osc.start();
    AUD.bandOsc.push({ osc: osc, g: g });
  }
  AUD.started = true;
  cb && cb();
}

function makeIR(ctx, seconds) {
  var sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  var buf = ctx.createBuffer(2, len, sr);
  for (var ch = 0; ch < 2; ch++) {
    var d = buf.getChannelData(ch);
    for (var i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4) * 0.5;
  }
  return buf;
}

/* Live update: every voice and band follows the full-sum plan at the current
   t; gains follow the SOUND group volume (ST.gain). The plan refreshes from
   TERMS.N, so terms entering the sum join the render as t advances.

   The pitches are re-targeted from the CURRENT ST.t on every audio tick
   (~20 Hz), so as t climbs — cruise, keys, scroll, chart scrub, preset
   glide — every voice and band bends with the law f_n = v_t(theta'(t) -
   ln n)/2pi, and the chord evolves with the flight. While t is moving the
   retune time constant shortens (0.03 s) so the bend tracks the flight
   crisply; when t holds (paused) the targets stop changing and the chord
   holds. The law, the one v_t, the one gain and the 24-voiced +
   band-summed architecture are exactly as disclosed — unchanged. */
function audioUpdateRates() {
  if (!AUD.started) return;
  var ct = AUD.ctx.currentTime;
  var plan = audioPlan(TERMS.N);
  AUD.plan = plan;
  var moving = AUD.lastUpT === undefined || ST.t !== AUD.lastUpT;
  AUD.lastUpT = ST.t;
  var fTau = moving ? 0.03 : 0.05;
  var silentV = 0, silentB = 0, n, f, af, audible;
  for (n = 1; n <= AUD.VOICE_N; n++) {
    var h = AUD.voices[n - 1];
    f = ZH.fAudio(n, ST.t, ST.vt);
    if (ST.artistic.quant) f = quantize(f);
    af = Math.abs(f);
    audible = ST.audioOn && n <= plan.V && af >= 8 && af <= 12000;
    if (!audible && n <= plan.V) silentV++;  /* in the sum but out of audible band */
    h.osc.frequency.setTargetAtTime(Math.max(0.001, af), ct, fTau);
    h.g.gain.setTargetAtTime(audible ? ZH.an(n) * ST.gain * AUD.HUM_SCALE : 0, ct, 0.06);
  }
  for (var b = 0; b < AUD.BAND_MAX; b++) {
    var bo = AUD.bandOsc[b], bp = b < plan.B ? plan.bands[b] : null;
    if (bp) {
      f = ZH.fAudio(bp.nEff, ST.t, ST.vt);
      af = Math.abs(f);
      audible = ST.audioOn && af >= 8 && af <= 12000;
      if (!audible) silentB++;
      bo.osc.frequency.setTargetAtTime(Math.max(0.001, af), ct, fTau);
      bo.g.gain.setTargetAtTime(audible ? bp.amp * ST.gain * AUD.HUM_SCALE : 0, ct, 0.06);
    } else {
      bo.g.gain.setTargetAtTime(0, ct, 0.06);
    }
  }
  /* inspector-voiced extra terms follow the law live */
  for (var vn in AUD.voiced) {
    var v = AUD.voiced[vn], fv = ZH.fAudio(+vn, ST.t, ST.vt);
    if (ST.artistic.quant) fv = quantize(fv);
    if (ST.audioOn && fv > 8 && fv < 12000) {
      v.osc.frequency.setTargetAtTime(fv, ct, fTau);
      v.g.gain.setTargetAtTime(ZH.an(+vn) * ST.gain * 0.12, ct, 0.05);
    } else {
      v.g.gain.setTargetAtTime(0, ct, 0.05); /* out of audible band at this v_t */
    }
  }
  setHonesty(silentV, silentB);
}

function setHonesty(silentV, silentB) {
  var el = document.getElementById('honesty');
  if (!el) return;
  var p = AUD.plan || audioPlan(TERMS.N);
  el.innerHTML = 'full sum, live: N(t) = ' + p.N + ' terms &middot; first ' + p.V +
    ' voiced individually (a_n = 2/&radic;n)' +
    (p.B
      ? ' &middot; remaining ' + p.D + ' terms band-summed into ' + p.B +
        ' log-spaced bands (&radic;(&Sigma;a_n&sup2;) amplitude, amplitude-weighted mean rate)'
      : ' &middot; 0 bands — every term in the sum is individually voiced') +
    ' &middot; one law f_n = v_t(&theta;&prime; &minus; ln n)/2&pi;, one v_t, one gain' +
    ((silentV + silentB) ? ' &middot; ' + (silentV + silentB) +
      ' silent (in the sum but outside 8 Hz..12 kHz at this v_t — silenced, never retuned)' : '') +
    (ST.voiced.length ? ' &middot; ' + ST.voiced.length + ' inspector-voiced extra' : '');
}

/* Live disclosure inside the SOUND group: the full-sum accounting line. Runs
   whether or not audio is started; the counts follow N(t) live. */
var lastTruth = '';
function syncSoundTruth() {
  var el = document.getElementById('soundTruth');
  if (!el) return;
  var p = audioPlan(TERMS.N);
  var s = p.N + ' terms in the sum · ' +
    (p.D > 0 ? p.V + ' voiced · ' + p.B + ' band-summed'
             : 'all ' + p.V + ' voiced · 0 band-summed') +
    ' · one v_t, one gain — no tuning';
  if (s !== lastTruth) { lastTruth = s; el.textContent = s; }
}

/* The cockpit SOUND toggle IS the gesture, and the only audio control.
   ON: the context is created (first time) and ctx.resume() is AWAITED —
   Safari leaves a gesture-created context 'suspended' until resume()
   resolves, so the audible state is only set after the promise settles.
   The oscillators were started (silent) at creation; every gain ramps in
   via setTargetAtTime inside audioUpdateRates, so nothing snaps.
   Any failure lands in the SOUND group as "audio could not start — {reason}". */
function setSoundErr(msg) {
  var el = document.getElementById('soundErr');
  if (el) { el.textContent = msg || ''; el.classList.toggle('on', !!msg); }
}
function soundFail(err) {
  ST.audioOn = false;
  audioUpdateRates();
  setSoundErr('audio could not start — ' + (err && err.message ? err.message : String(err)));
  syncSoundUI();
}
function soundSetOn(on) {
  if (on) {
    setSoundErr('');
    try {
      audioEnsure(function () {
        var p;
        try { p = AUD.ctx.resume(); } catch (e) { soundFail(e); return; }
        Promise.resolve(p).then(function () {
          ST.audioOn = true;
          audioUpdateRates();   /* ramped gains */
          syncSoundUI();
        }, soundFail);
      });
    } catch (e) { soundFail(e); }
  } else {
    ST.audioOn = false;
    audioUpdateRates();   /* ramps every hum/voiced gain to 0; bars flatline */
    syncSoundUI();
    /* then the context actually suspends once the release ramps finish */
    setTimeout(function () {
      if (!ST.audioOn && AUD.ctx && AUD.ctx.state === 'running') AUD.ctx.suspend();
    }, 450);
  }
}

function syncSoundUI() {
  var t = document.getElementById('soundToggle');
  if (t) {
    t.textContent = ST.audioOn ? 'ON' : 'OFF';
    t.classList.toggle('on', ST.audioOn);
    t.setAttribute('aria-pressed', ST.audioOn ? 'true' : 'false');
  }
  syncAudioParamUI();
}

function syncAudioParamUI() {
  var sp = document.getElementById('soundParams');
  if (sp) sp.innerHTML = 'v_t ' + fmtSig(ST.vt, 3) + ' &middot; gain ' + fmtSig(ST.gain, 2);
  var sv = document.getElementById('soundVol');
  if (sv && +sv.value !== Math.round(ST.gain * 100)) sv.value = Math.round(ST.gain * 100);
}

/* ~12 bars from the analyser: log-spaced bins 23 Hz..~8 kHz. While sound is
   on the bars are ALWAYS moving: a small display-only baseline shimmer keeps
   them visibly alive even at heights where every voice sits outside the
   audible band (those voices are silenced, disclosed, never retuned). When
   off, the smoothed values decay to a flat baseline. */
function drawSoundViz() {
  var cv = document.getElementById('soundViz');
  if (!cv || !AUD.vizSmooth) return;
  var ctx = fitCanvas(cv);
  var W = cv.clientWidth, H = cv.clientHeight;
  ctx.clearRect(0, 0, W, H);
  if (ST.audioOn && AUD.analyser) AUD.analyser.getByteFrequencyData(AUD.vizData);
  var B = AUD.VIZ_BARS, bw = W / B;
  var nowMs = performance.now();
  for (var i = 0; i < B; i++) {
    var v = 0;
    if (ST.audioOn && AUD.vizData) {
      var lo = Math.max(1, Math.round(Math.pow(2, i * 0.62)));
      var hi = Math.min(AUD.vizData.length - 1, Math.round(Math.pow(2, (i + 1) * 0.62)) + 1);
      var acc = 0, cnt = 0;
      for (var k2 = lo; k2 <= hi; k2++) { acc += AUD.vizData[k2]; cnt++; }
      v = cnt ? acc / cnt / 255 : 0;
      v = Math.max(v, 0.055 + 0.045 * Math.sin(nowMs / 640 + i * 1.13));
    }
    AUD.vizSmooth[i] += (v - AUD.vizSmooth[i]) * 0.35;
    var bh = Math.max(1, AUD.vizSmooth[i] * (H - 4));
    ctx.fillStyle = ST.audioOn ? 'rgba(143,208,168,0.85)' : 'rgba(58,68,89,0.8)';
    ctx.fillRect(i * bw + 1, H - 2 - bh, Math.max(1, bw - 2), bh);
  }
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.fillRect(0, H - 1, W, 1);
}


function quantize(f) {
  /* ARTISTIC ONLY: snap to A-minor pentatonic; never active in Truth Mode */
  if (f <= 20) return f;
  var degrees = [0, 3, 5, 7, 10];
  var semis = 12 * Math.log(f / 55) / Math.LN2;
  var oct = Math.floor(semis / 12), pos = semis - 12 * oct, best = degrees[0], bd = 99;
  for (var i = 0; i < degrees.length; i++) {
    var d = Math.abs(degrees[i] - pos);
    if (d < bd) { bd = d; best = degrees[i]; }
  }
  return 55 * Math.pow(2, (12 * oct + best) / 12);
}

function voiceTerm(n) {
  var i = ST.voiced.indexOf(n);
  if (i >= 0) {
    ST.voiced.splice(i, 1);
    if (AUD.voiced[n]) {
      AUD.voiced[n].g.gain.setTargetAtTime(0, AUD.ctx.currentTime, 0.08);
      var vn = AUD.voiced[n]; delete AUD.voiced[n];
      setTimeout(function () { try { vn.osc.stop(); } catch (e2) {} }, 600);
    }
  } else {
    if (ST.voiced.length >= AUD.VOICE_MAX) return;
    ST.voiced.push(n);
    if (AUD.started) {
      var osc = AUD.ctx.createOscillator(), g = AUD.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = Math.max(8, ZH.fAudio(n, ST.t, ST.vt));
      g.gain.value = 0;
      osc.connect(g); g.connect(AUD.master);
      osc.start();
      AUD.voiced[n] = { osc: osc, g: g };
    }
  }
  updateInspector();
  audioUpdateRates();
}

function chime(n) {
  if (!AUD.started || !ST.audioOn) return;
  var f = ZH.fAudio(n, ST.t, ST.vt);
  f = Math.max(55, Math.abs(f));          /* event cue: clamped for audibility (UI sound, not the sonification) */
  var osc = AUD.ctx.createOscillator(), g = AUD.ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = f;
  var t0 = AUD.ctx.currentTime;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(ST.gain * 0.18, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
  osc.connect(g); g.connect(AUD.master);
  osc.start(t0); osc.stop(t0 + 1.7);
}
