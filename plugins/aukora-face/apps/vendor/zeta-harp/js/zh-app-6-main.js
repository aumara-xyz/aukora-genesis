/* ---------------- input ---------------------------------------------------- */
var keys = {};
function bindInput() {
  var cv = GLR.canvas;
  var down = false, moved = 0, lx = 0, ly = 0, btn = 0;
  cv.addEventListener('mousedown', function (e) {
    if (OP.on) return;      /* intro A flies itself; nothing is overlaid or steerable */
    down = true; moved = 0; lx = e.clientX; ly = e.clientY; btn = e.button;
  });
  window.addEventListener('mousemove', function (e) {
    if (!down) return;
    var dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (btn === 2 || e.ctrlKey) {
      GLR.CAM.dist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, GLR.CAM.dist * (1 + dy * 0.004)));
      GLR.CAM.distTarget = GLR.CAM.dist;
      syncZoomUI();
    } else {
      GLR.CAM.yaw += dx * 0.0045; GLR.CAM.pitch += dy * 0.0035;
      GLR.CAM.vyaw = dx * 0.0009; GLR.CAM.vpitch = dy * 0.0007;
    }
  });
  window.addEventListener('mouseup', function (e) {
    if (down && moved < 5 && btn === 0) {
      var n = GLR.pickTerm(e.clientX, e.clientY);
      if (n > 0) selectTerm(n);
    }
    down = false;
  });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (OP.on) return;
    /* direct flight takes over for the gesture; the SPEED cruise resumes after */
    if (e.shiftKey) {
      var lt = Math.log10(ST.t) + e.deltaY * 0.0006;
      ST.t = clampT(Math.pow(10, lt)); ST.tTarget = null;
    } else {
      ST.t = clampT(ST.t + e.deltaY * halfWindow(ST.t) * 0.0022); ST.tTarget = null;
    }
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    var k = e.key.toLowerCase();
    if (OP.on) {
      /* intro A carries no skip button (nothing is overlaid); a key still
         ends the flight for anyone who asks */
      if (k === ' ' || k === 'escape' || k === 'enter') { e.preventDefault(); endOpening(); }
      return;
    }
    keys[k] = true;
    if (k === ' ') { e.preventDefault(); setPaused(!ST.paused); }
    else if (k === 'f') openView('flowerPanel');
    else if (k === 'z') { if (openView('microPanel')) microJumpNearest(); }
    else if (k === 'i') { if (openView('fencePanel')) fillFenceLive(); }
    else if (k === 'escape') closeAllViews();
  });
  /* the three view chips — the fence stays a click away (the boundary is a door,
     never a keyboard shortcut) */
  function chipWire(id, panel, after) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      var on = openView(panel);
      el.classList.toggle('on', !!on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on && after) after();
    });
    return el;
  }
  chipWire('chipFlower', 'flowerPanel');
  chipWire('chipScope', 'microPanel', microJumpNearest);
  chipWire('chipFence', 'fencePanel', fillFenceLive);

  /* the torus room's three views: SHADOW / SLICE / UNFOLD */
  document.querySelectorAll('.tor-view').forEach(function (b) {
    b.addEventListener('click', function () {
      TOR_VIEW = b.getAttribute('data-view');
      document.querySelectorAll('.tor-view').forEach(function (x) {
        var isOn = x === b;
        x.classList.toggle('on', isOn);
        x.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      });
      var lbl = document.getElementById('torusLbl');
      if (lbl) lbl.textContent = TOR_VIEW_TEXT[TOR_VIEW];
      drawTorus();
    });
  });

  /* DEGREES — the scale snap: prettier, not pure math (off = the raw law).
     ARTISTIC ONLY; the truth fence's "no frequency remapping" holds while
     this is off, which is the default. */
  document.getElementById('quantToggle').addEventListener('click', function () {
    ST.artistic.quant = !ST.artistic.quant;
    var qb = document.getElementById('quantToggle');
    qb.textContent = ST.artistic.quant ? 'ON' : 'OFF';
    qb.classList.toggle('on', ST.artistic.quant);
    qb.setAttribute('aria-pressed', ST.artistic.quant ? 'true' : 'false');
    if (AUD.started) audioUpdateRates();
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  /* the waveform map strip IS the t scrubber (the separate slider is gone) */
  (function bindScrubber() {
    var cv = document.getElementById('ribbon');
    function tAt(evt) {
      var r = cv.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (evt.clientX - r.left) / r.width));
      var hw = halfWindow(ST.t);
      return ST.t - hw + 2 * hw * frac;
    }
    function scrubTo(evt) {
      ST.t = clampT(tAt(evt)); ST.tTarget = null;
      /* the frame loop recomputes terms/ribbon on the t change; the gold
         position marker on the chart is drawn at ST.t, so it follows the
         pointer while scrubbing */
    }
    cv.addEventListener('pointerdown', function (e) {
      if (OP.on) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('scrubbing');
      scrubTo(e);
    });
    cv.addEventListener('pointermove', function (e) {
      if (cv.classList.contains('scrubbing')) scrubTo(e);
    });
    function endScrub() { cv.classList.remove('scrubbing'); }
    cv.addEventListener('pointerup', endScrub);
    cv.addEventListener('pointercancel', endScrub);
  })();
  document.querySelectorAll('#presets button').forEach(function (b) {
    b.addEventListener('click', function () { glideTo(+b.dataset.t); });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { showPanel(b.dataset.close, false); syncChips(); });
  });

  /* the chart's layer chips: each eases one shared fade (LYR), read by the
     chart AND the tunnel, so both surfaces always agree */
  ['lyrM', 'lyrZ', 'lyrR'].forEach(function (id) {
    var el = document.getElementById(id), key = id.slice(3);
    el.addEventListener('click', function () {
      ST.layers[key] = !ST.layers[key];
      el.classList.toggle('off', !ST.layers[key]);
    });
  });

  /* the control cluster: PLAY — a play/pause icon button that pauses time
     AND the camera together (ST.paused is read by the frame loop and by
     GLR.draw), and resumes both on the next click */
  document.getElementById('playBtn').addEventListener('click', function () {
    setPaused(!ST.paused);
  });

  /* SOUND — the toggle IS the gesture, and the only audio control */
  document.getElementById('soundToggle').addEventListener('click', function () {
    soundSetOn(!ST.audioOn);
  });
  document.getElementById('soundVol').addEventListener('input', function (e) {
    ST.gain = +e.target.value / 100; syncAudioParamUI();
  });

  /* SPEED — 0 = stopped, right = fast cruise. The frame loop eases ST.speed
     toward this target, so rate changes never snap. Under
     prefers-reduced-motion there is no auto-cruise: the slider starts at 0
     and flight begins only when the user raises it. */
  var spdS = document.getElementById('speedSlider');
  if (REDUCED) { ST.speed = 0; ST.speedTarget = 0; spdS.value = 0; }
  spdS.addEventListener('input', function () { ST.speedTarget = +spdS.value / 100; });

  /* ZOOM — one continuous slider, way out (left) to way in (right), mapped
     logarithmically onto camera distance; the render loop eases dist toward
     distTarget, so zooming is always smooth */
  var zmS = document.getElementById('zoomSlider');
  zmS.addEventListener('input', function () {
    GLR.CAM.distTarget = zoomFromSlider(+zmS.value);
  });
  syncZoomUI();

  syncAudioParamUI();
  document.getElementById('voiceBtn').addEventListener('click', function () {
    if (!(ST.sel >= 1)) return;
    try {
      if (!AUD.started) audioEnsure(function () { voiceTerm(ST.sel); });
      else voiceTerm(ST.sel);
    } catch (e2) {
      setSoundErr('audio could not start — ' + (e2 && e2.message ? e2.message : String(e2)));
    }
  });
}

/* ---------------- the control cluster's helpers --------------------------- */
var ZOOM_MIN = 4.5, ZOOM_MAX = 120;   /* way in .. way out (camera distance) */
function zoomFromSlider(v) { return ZOOM_MAX * Math.pow(ZOOM_MIN / ZOOM_MAX, v / 100); }
function sliderFromZoom(d) { return 100 * Math.log(d / ZOOM_MAX) / Math.log(ZOOM_MIN / ZOOM_MAX); }
function syncZoomUI() {
  var zmS = document.getElementById('zoomSlider');
  if (zmS) zmS.value = Math.round(sliderFromZoom(GLR.CAM.distTarget));
}
function zoomBy(f) {   /* kept for the debug handle; the on-screen control is the ZOOM slider */
  GLR.CAM.distTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, GLR.CAM.distTarget * f));
  syncZoomUI();
}
function setPaused(p) {
  ST.paused = !!p;
  var b = document.getElementById('playBtn');
  if (b) {
    b.innerHTML = ST.paused ? '<span class="ic-play"></span>' : '<span class="ic-pause"></span>';
    b.setAttribute('aria-pressed', ST.paused ? 'false' : 'true');
  }
}

/* ---------------- intro A: the dramatic flight ----------------------------
   ~8s of pure flight. The opening is purely visual — the tunnel flying on
   its own. Zero words, zero small text, nothing overlaid: every HUD element
   is faded out by body.introA for the whole flight, there is no skip
   button, and the standing label lives in the fence and nowhere else.
   (prefers-reduced-motion: the same flight at minimum speed — the tunnel
   holds nearly still, no spin, no travel.) */
var OP = { on: true, s: 0, cross: null, br: null };
var INTRO_A_SEC = 8.0;
function setupOpening() {
  OP.br = fixtureBestCrossingBracket('W3');
  OP.cross = OP.br ? OP.br.tAt : 1000010;
  ST.t = 1000000.0;
  GLR.CAM.dist = 9; GLR.CAM.distTarget = 9; GLR.CAM.pitch = 0.10; GLR.CAM.yaw = 0.4;
  document.getElementById('fade').style.opacity = 1;
  document.body.classList.add('introA');
}
function openingTick(now, dt) {
  OP.s += dt;              /* frame-accumulated: robust to rAF throttling */
  var s = OP.s;
  if (s > 0.3) document.getElementById('fade').style.opacity = 0;
  var f = Math.min(1, s / INTRO_A_SEC), ease = 1 - Math.pow(1 - f, 3);
  if (!REDUCED) {
    /* the flight: drift up the tunnel toward the first fixture crossing,
       pulling back so the structure reads — motion only, no words */
    GLR.CAM.yaw += dt * 0.045;
    ST.t = 1000000.0 + (OP.cross - 1000000.0) * ease;
    GLR.CAM.dist = 9 + 24 * ease;
    GLR.CAM.pitch = 0.10 + 0.05 * ease;
  } else {
    /* minimum speed: a barely-moving hold on the tunnel */
    ST.t = 1000000.0 + (OP.cross - 1000000.0) * 0.08 * ease;
    GLR.CAM.dist = 30;
  }
  if (s >= INTRO_A_SEC) endOpening();
}
function endOpening() {
  if (!OP.on) return;
  OP.on = false; ST.opening = false;
  document.getElementById('fade').style.opacity = 0;
  document.body.classList.remove('introA');
  ST.frozen = false; ST.paused = false;
  /* land zoomed out, eased: the whole tunnel reads */
  GLR.CAM.distTarget = Math.max(GLR.CAM.distTarget, 51);
  syncZoomUI();
  /* intro B: the short controls tour — three beats, then they end. The
     cruise (SPEED default 35%) is already running underneath, gently. */
  setTimeout(function () { if (!OP.on) introBStart(); }, REDUCED ? 60 : 900);
}

/* ---------------- main loop ------------------------------------------------ */
var lastFrame = performance.now(), frameCount = 0, audioAcc = 0, lastComputedT = null;
function frame(now) {
  var dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  frameCount++;
  var tPrev = lastComputedT !== null ? lastComputedT : ST.t;

  if (OP.on) openingTick(now, dt);
  else {
    /* eased control rates: the SPEED slider sets a target, t follows smoothly */
    ST.speed += (ST.speedTarget - ST.speed) * Math.min(1, dt * 3.2);
    if (Math.abs(ST.speedTarget - ST.speed) < 0.002) ST.speed = ST.speedTarget;
    /* PLAY pauses time: no cruise, no key flight, no preset glide while
       ST.paused (direct scrubbing the chart still answers the hand) */
    if (!ST.frozen && !ST.paused) {
      var hw = halfWindow(ST.t), spd = hw * 1.6 * (keys.shift ? 8 : 1);
      var flying = false;
      if (keys.w || keys.arrowup) { ST.t = clampT(ST.t + spd * dt); ST.tTarget = null; flying = true; }
      if (keys.s || keys.arrowdown) { ST.t = clampT(ST.t - spd * dt); ST.tTarget = null; flying = true; }
      /* the cruise: the SPEED slider's rate, 0 = stopped. Direct flight
         (keys, scroll, chart drag) applies on top and wins the gesture;
         releasing returns to this cruise. Paused during a preset glide. */
      if (!flying && ST.tTarget === null && ST.speed > 0.001) {
        ST.t = clampT(ST.t + hw * 1.6 * Math.pow(ST.speed, 1.7) * dt);
        GLR.CAM.yaw += dt * 0.075 * ST.speed;
      }
      if (ST.tTarget !== null) {
        var lt = Math.log10(ST.t), ltT = Math.log10(ST.tTarget);
        lt += (ltT - lt) * Math.min(1, dt * 2.0);
        ST.t = Math.pow(10, lt);
        if (Math.abs(ltT - lt) < 1e-7) { ST.t = ST.tTarget; ST.tTarget = null; }
      }
    }
  }
  /* one eased fade per layer per frame — chart and tunnel read these same
     values, so the two surfaces can never disagree about a layer */
  layerFadeTick(dt);

  var tChanged = (lastComputedT === null || ST.t !== lastComputedT);
  if (tChanged || !RIB.valid) {
    computeTerms(ST.t);
    computeRibbon(ST.t);
    if (!OP.on && lastComputedT !== null) detectEvents(tPrev, ST.t);
    lastComputedT = ST.t;
  }
  /* the torus room: the viewing spin always turns; the gold trail grows
     one (phi_1, phi_2) point per change of t */
  torTick(dt, tChanged);

  GLR.draw(dt);
  var flowerVisible = panelVisible('flowerPanel');
  if (flowerVisible && (ST.frozen || frameCount % 4 === 0)) drawFlower();
  if (panelVisible('ribbonPanel')) drawRibbon();
  if (!OP.on && frameCount % 3 === 0) { drawSlice(); drawTorus(); }
  if (!OP.on) drawSoundViz();
  eventTick(now);

  audioAcc += dt;
  if (audioAcc > 0.05) {
    audioAcc = 0;
    if (AUD.started) audioUpdateRates();
    syncSoundTruth();   /* full-sum disclosure line follows N(t) live */
  }

  requestAnimationFrame(frame);
}

/* ---------------- boot ------------------------------------------------------ */
(function boot() {
  computeTerms(ST.t);
  computeRibbon(ST.t);
  ST.lastM = Mnow();
  microInit();
  fillFenceStatic();
  fillFenceLive();
  bindInput();
  setupOpening();
  /* read-only debug handle (the donor's check-harness notes used it; that harness is not in
     this repository. No behavior.) */
  window.ZH_DEBUG = { ST: ST, OP: OP, TERMS: TERMS, CAM: GLR.CAM, AUD: AUD, frame: frame,
    glDraw: GLR.draw, glOk: function () { return GLR.ok; },
    endOpening: endOpening, microSelect: microSelect, glideTo: glideTo,
    selectTerm: selectTerm, showPanel: showPanel, zoomBy: zoomBy,
    setPaused: setPaused, LYR: LYR, TOURB: TOURB, TORUS: TORUS, TOR: TOR,
    torView: function () { return TOR_VIEW; },
    introBStart: introBStart, introBEnd: introBEnd,
    fillFenceLive: fillFenceLive, drawMicro: drawMicro, soundSetOn: soundSetOn,
    nearestCrossingFrom: nearestCrossingFrom, microJumpNearest: microJumpNearest,
    drawPhasorSection: drawPhasorSection, drawTorus: drawTorus, openView: openView };
  requestAnimationFrame(function (n) { lastFrame = n; requestAnimationFrame(frame); });
})();
