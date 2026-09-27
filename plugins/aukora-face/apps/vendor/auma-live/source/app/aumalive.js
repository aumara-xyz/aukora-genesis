// Aukora Spatial — AUMA · LIVE: true full-duplex voice. No chrome, no words.
//
// The entire interface is the living field and one orb. The field is a GPU
// fragment shader now — smooth domain-warped aurora, no hard pixels — and it
// is HER BODY: her replies can carry invisible [field …] tags that reshape its
// hue / energy / storm / form in real time, mid-sentence (never spoken, never
// printed). The state language is unchanged:
//   green ripples  = your voice entering the field
//   blue spiral    = she is thinking
//   purple blooms  = her voice leaving the speakers
//   orb dim        = channel closed  ·  orb bright = she is listening
//   orb amber ring = fallback mode (local sidecar down, browser voice)
//
// PIPELINE (see spatial/voice/README.md): mic → local sidecar 7092 (Silero VAD
// → whisper on the Apple GPU, live partials) → the governed presence lane on
// 7091 (the mind — unchanged) → sentence/clause-streamed Kokoro TTS → a fading
// player worklet. Talking over her cuts her voice in ~90 ms.
//
// NON-MAC NODES (no sidecar): the browser fallback is a first-class citizen —
// Web Speech recognition drives the turns off its own final results, browser
// TTS prefers the neural voices Windows ships, and any degradation states
// itself in one fading status line instead of failing silently.

import { makeDirectiveFilter, FIELD_HUES, FIELD_FORMS } from '/app/field-directives.js';
import { recentChatTurns, fmtAgo, announceLaneTurn, onLaneTurn } from '/app/lane-bridge.js';

const DOOR = 'http://127.0.0.1:7091';
const SIDECAR_WS = 'ws://127.0.0.1:7092/ws';
const WORKLET_URL = '/app/aumalive-audio.js';

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Strip markdown/formatting so the TTS never dictates the symbols (e.g. she was
// literally saying "asterisk"). Keeps the words + sentence punctuation; removes
// the markers. Works on partial chunks too (a stray "**" split across a flush is
// still caught by the final sweep). Used before every TTS call and for the log.
function sanitizeForVoice(s) {
  return String(s == null ? '' : s)
    .replace(/```[\s\S]*?```/g, ' ')          // code fences
    .replace(/`([^`]*)`/g, '$1')              // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links → their text
    .replace(/\[\s*field\b[^\]]*\]/gi, ' ')   // her [field …] body-language tags — the last-line guarantee
    .replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, '') // bold / italic / strike markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')       // headings
    .replace(/^\s{0,3}>\s?/gm, '')            // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, '')        // bullet markers
    .replace(/^\s{0,3}\d+\.\s+/gm, '')        // numbered-list markers
    .replace(/[*_`~#|]/g, '')                 // any stray symbol left — the guarantee
    .replace(/[ \t]{2,}/g, ' ')               // tidy whitespace
    .trim();
}

// ---------------------------------------------------------------------------
// The field — her body of light. A GPU fragment shader now (smooth, organic,
// no hard pixels): domain-warped flowing noise with a breathing core, reacting
// to both voices at once. The state language is unchanged — green ripples in
// when you talk, a blue spiral while she thinks, purple blooms out when she
// speaks — but it renders as continuous aurora, not a grid.
//
// AND: she can shape it herself. Her replies may carry invisible [field …]
// tags (see makeDirectiveFilter below); field.alien() receives them and
// tweens hue / energy / storm / form live — her real-time body language.
// A soft-particle 2D canvas fallback covers machines without WebGL.
// ---------------------------------------------------------------------------

// Her resting body. The hue/form vocabulary itself lives in field-directives.js
// (shared with the server prompt, so the two can never drift).
const ALIEN_DEFAULT = { hue: 0, hueAmt: 0, energy: 0.5, storm: 0.25, form: 0 };
const hasOwn = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

// rgb (0-255 arrays) → hue-rotated rgb IN PLACE, keeping saturation/lightness.
// Used to bend the state palette toward the hue SHE asked for, by hueAmt.
// Runs every frame while she wears a hue — no allocations, NaN-proof.
function rotateHue(rgb, targetHue, amt) {
  if (amt <= 0.001 || !Number.isFinite(targetHue)) return rgb;
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const dd = mx - mn;
    s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    h = mx === r ? ((g - b) / dd + (g < b ? 6 : 0)) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    h *= 60;
  }
  let delta = ((targetHue - h) % 360 + 540) % 360 - 180;   // shortest way around the wheel
  h = (h + delta * amt + 360) % 360;
  s = Math.max(s, 0.35 * amt);                              // grey can't show a hue — give it some
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  let tr = 0, tg = 0, tb = 0;
  if (seg === 0) { tr = c; tg = x; } else if (seg === 1) { tr = x; tg = c; }
  else if (seg === 2) { tg = c; tb = x; } else if (seg === 3) { tg = x; tb = c; }
  else if (seg === 4) { tr = x; tb = c; } else { tr = c; tb = x; }
  rgb[0] = (tr + m) * 255; rgb[1] = (tg + m) * 255; rgb[2] = (tb + m) * 255;
  return rgb;
}

const FIELD_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;                       // phase-accumulated: energy already scales it
uniform float uMic, uSay, uThink, uBurst;  // conversation envelopes
uniform float uStorm, uForm, uGlow;        // her controls: turbulence · pattern · brightness
uniform vec3 uColLo, uColHi;               // deep + bright ends of the live palette

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = r * p * 2.03 + 11.5; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  float d = length(uv);
  float ang = atan(uv.y, uv.x);
  float t = uTime;

  // living tissue: fbm warped by fbm — the smooth flow that replaces the grid.
  // (Deliberately 3 fbm / 3 octaves: rich enough warped, and it has to run on
  // weak GPUs and even software GL — see the adaptive scale in the JS loop.)
  vec2 p = uv * (2.1 + uStorm * 2.4);
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.14)), fbm(p + vec2(5.2, 1.3) - t * 0.11));
  float n = fbm(p + (2.6 + uStorm * 2.6) * (q - 0.5) + vec2(t * 0.05, -t * 0.03));

  // her four forms, cross-faded by uForm: aurora · vortex · pulse · swarm.
  // Each form is branched on its weight — uniform-driven, so the GPU skips
  // the math for forms she isn't wearing (most frames pay for exactly one).
  float wA = max(0.0, 1.0 - abs(uForm - 0.0));
  float wV = max(0.0, 1.0 - abs(uForm - 1.0));
  float wP = max(0.0, 1.0 - abs(uForm - 2.0));
  float wS = max(0.0, 1.0 - abs(uForm - 3.0));
  float v = 0.0;
  if (wA > 0.0) v += wA * (n * (0.62 + 0.38 * sin(uv.x * 2.6 + q.y * 5.0 + t * 0.35)));
  if (wV > 0.0) v += wV * ((0.5 + 0.5 * sin(ang * 3.0 - t * 1.6 + (n - 0.5) * 7.0 - d * 9.0)) * n * 1.15);
  if (wP > 0.0) v += wP * ((0.5 + 0.5 * sin(d * 13.0 - t * 2.6 + n * 4.0)) * (0.35 + 0.65 * n));
  if (wS > 0.0) v += wS * (smoothstep(0.52, 0.8, vnoise(uv * 9.0 + q * 4.0 + vec2(t * 0.9, -t * 0.7))) * (0.5 + 0.5 * n));
  v /= max(0.001, wA + wV + wP + wS);

  // her breathing core — a soft central presence whose edge the flow erodes
  v += exp(-d * d * 7.0) * (0.5 + 0.28 * sin(t * 0.9)) * (0.75 + 0.5 * n) * 0.44;

  // the conversation, same language as ever
  v += uThink * 0.5 * (0.5 + 0.5 * sin(ang * 3.0 + t * 2.8 - d * 8.0));          // blue spiral: thinking
  v += uMic * (0.20 + 0.34 * (0.5 + 0.5 * sin(t * 3.6 + d * 12.0))) * (1.1 - d);  // you: ripples inward (softened, motion kept)
  v += uSay * (0.18 + 0.36 * (0.5 + 0.5 * sin(t * 4.6 - d * 14.0))) * (1.15 - d); // her: blooms outward (softened, motion kept)
  v += uBurst * exp(-2.6 * d);

  v = clamp(v * uGlow, 0.0, 1.02);   // hard ceiling — the field can glow but never wash to white
  vec3 col = vec3(0.030, 0.036, 0.062);                                  // deep space, never pure black
  col += mix(uColLo, uColHi, smoothstep(0.12, 1.15, v)) * min(v * 0.9, 0.58); // soft: dimmer, and bright hues need real energy — never a wash
  col += mix(uColHi, vec3(0.85, 0.9, 1.0), 0.25) * smoothstep(1.1, 1.42, v) * 0.13; // soft palette-tinted shimmer at rare peaks — never a white flash
  col *= 0.92 + 0.16 * vec3(q.x, n, q.y);                                // subtle chroma drift — never flat
  col *= smoothstep(1.5, 0.42, d);                                       // fall away into the dark
  gl_FragColor = vec4(col, 1.0);
}`;

function createField(canvas) {
  const hue = (n, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim().split(',').map(parseFloat); return v.length === 3 && !v.some(Number.isNaN) ? v : fb; };
  const HL = hue('--hue-l', [129, 212, 180]), HC = hue('--hue-c', [150, 180, 255]), HR = hue('--hue-r', [196, 170, 255]);
  const REST = [70, 150, 190];                                            // quiet blue-green at idle

  const F = { mode: 'idle', micEnv: 0, sayEnv: 0, burst: 0, think: 0 };
  // her live control targets (t) and the tweened current values (c)
  const A = { t: { ...ALIEN_DEFAULT }, c: { ...ALIEN_DEFAULT } };

  // She speaks this in [field …] tags; everything is clamped, junk is ignored.
  // Lookups use hasOwn + Number.isFinite so a hostile or hallucinated value
  // ('hue=1e999', 'hue=constructor') can never poison the tween with NaN.
  F.alien = (tag) => {
    const body = String(tag).replace(/^\[\s*field/i, '').replace(/\]\s*$/, '').trim().toLowerCase();
    if (!body || /^(default|reset|release|rest)$/.test(body)) { A.t = { ...ALIEN_DEFAULT }; return; }
    for (const word of body.split(/[\s,;]+/)) {
      if (!word) continue;
      const eq = word.split(/[=:]/), k = eq[0], val = eq[1];
      if (word === 'burst') { F.burst = 1; continue; }
      if (word === 'calm') { A.t.energy = 0.12; A.t.storm = 0.05; continue; }
      if (k === 'hue' && val !== undefined) {
        const h = hasOwn(FIELD_HUES, val) ? FIELD_HUES[val] : parseFloat(val);
        if (Number.isFinite(h)) { A.t.hue = ((h % 360) + 360) % 360; A.t.hueAmt = 1; }
      } else if (k === 'energy' && val !== undefined) {
        const e = parseFloat(val); if (Number.isFinite(e)) A.t.energy = clamp(e, 0, 1);
      } else if (k === 'storm' && val !== undefined) {
        const s = parseFloat(val); if (Number.isFinite(s)) A.t.storm = clamp(s, 0, 1);
      } else if (k === 'form' && val !== undefined) {
        if (hasOwn(FIELD_FORMS, val)) A.t.form = FIELD_FORMS[val];
      } else if (hasOwn(FIELD_HUES, word)) { A.t.hue = FIELD_HUES[word]; A.t.hueAmt = 1; }
      else if (hasOwn(FIELD_FORMS, word)) { A.t.form = FIELD_FORMS[word]; }
    }
  };

  // ---- shared per-frame state math (both renderers) ----
  // One reused scratch object — the render loop must not feed the GC.
  let phase = 0;
  const S = { col: [0, 0, 0], glow: 1, storm: 0.25, form: 0 };
  function stepState(dt) {
    F.sayEnv *= 0.92; F.burst *= 0.9; F.think *= 0.965;
    const c = A.c, tg = A.t, k = 1 - Math.pow(0.06, dt);                  // ~smooth 1s tween, frame-rate independent
    c.energy += (tg.energy - c.energy) * k;
    c.storm += (tg.storm - c.storm) * k;
    c.form += (tg.form - c.form) * k;
    c.hueAmt += (tg.hueAmt - c.hueAmt) * k;
    let dh = ((tg.hue - c.hue) % 360 + 540) % 360 - 180;
    c.hue = (c.hue + dh * k + 360) % 360;
    // energy drives the field's clock — she can slow her whole body down.
    // Wrapped well below float32 precision loss (multi-hour sessions must not
    // turn the shader's sin() arguments to mush); one subtle pop per ~day.
    phase += dt * (0.45 + c.energy * 0.9 + c.storm * 0.3 + F.micEnv * 0.4 + F.sayEnv * 0.5);
    if (phase > 65534.9) phase -= 65534.9;                                // ≈ 2π · 10430
    // state palette: GREEN you · BLUE thinking · PURPLE her · resting teal
    const wYou = Math.min(1, F.micEnv * 1.35), wThink = Math.min(1, F.think), wHer = Math.min(1, F.sayEnv * 1.35);
    const wRest = 1 - Math.min(1, wYou + wThink + wHer);
    const den = wYou + wThink + wHer + wRest + 1e-4;
    S.col[0] = (HL[0] * wYou + HC[0] * wThink + HR[0] * wHer + REST[0] * wRest) / den;
    S.col[1] = (HL[1] * wYou + HC[1] * wThink + HR[1] * wHer + REST[1] * wRest) / den;
    S.col[2] = (HL[2] * wYou + HC[2] * wThink + HR[2] * wHer + REST[2] * wRest) / den;
    rotateHue(S.col, c.hue, c.hueAmt);                                    // her chosen skin, if she set one
    S.glow = 0.52 + c.energy * 0.55; S.storm = c.storm; S.form = c.form;
    return S;
  }

  // ---- WebGL path — with survival instincts. A canvas that ever held a GL
  // context can never hand out a 2d one, so the 2D bailout swaps in a fresh
  // canvas element. renderScale drops under sustained slow frames (weak GPUs,
  // software GL) before giving up on the shader entirely.
  let cnv = canvas, gl = null, prog = null, U = null, dpr = 1;
  let renderScale = 1, slowFrames = 0, prevFrame = 0, ro = null;
  function swapCanvas() {
    const fresh = document.createElement('canvas');
    fresh.className = cnv.className;
    cnv.replaceWith(fresh);
    cnv = fresh;
    if (ro) ro.observe(cnv);
  }
  function initGL() {
    try {
      gl = cnv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
        || cnv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      // Software GL (VMs, remote desktop, blocked GPUs) runs this shader at
      // seconds-per-frame and freezes the tab — the soft 2D field is far better
      // there. Ask the context what it really is before committing to it.
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const rname = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        if (/swiftshader|llvmpipe|software|basic render/i.test(rname)) { gl = null; return false; }
      } catch { /* renderer name unavailable — the first-frame probe below still guards us */ }
      const vsSrc = 'attribute vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }';
      const mk = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
        return s;
      };
      prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FIELD_FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aP');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      U = {};
      for (const name of ['uRes', 'uTime', 'uMic', 'uSay', 'uThink', 'uBurst', 'uStorm', 'uForm', 'uGlow', 'uColLo', 'uColHi']) U[name] = gl.getUniformLocation(prog, name);
      cnv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; init2D(); }, { once: true });
      return true;
    } catch { gl = null; return false; }
  }

  let firstDraw = true;
  function drawGL(dt) {
    const s = stepState(dt);
    gl.viewport(0, 0, cnv.width, cnv.height);
    gl.uniform2f(U.uRes, cnv.width, cnv.height);
    gl.uniform1f(U.uTime, phase);
    gl.uniform1f(U.uMic, F.micEnv); gl.uniform1f(U.uSay, F.sayEnv);
    gl.uniform1f(U.uThink, F.think); gl.uniform1f(U.uBurst, F.burst);
    gl.uniform1f(U.uStorm, s.storm); gl.uniform1f(U.uForm, s.form); gl.uniform1f(U.uGlow, s.glow);
    const r = s.col[0] / 255, g = s.col[1] / 255, b = s.col[2] / 255;
    gl.uniform3f(U.uColHi, r, g, b);
    gl.uniform3f(U.uColLo, r * 0.16 + 0.015, g * 0.16 + 0.02, b * 0.16 + 0.05);
    if (firstDraw) {
      // one honest measurement AT REAL RESOLUTION (resize() runs before the
      // loop starts): force the GPU to actually finish a frame. A renderer
      // that lied its way past the name check gets caught here, immediately.
      firstDraw = false;
      const t0 = performance.now();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      try { gl.finish(); } catch { /* */ }
      const cost = performance.now() - t0;
      if (cost > 400) { gl = null; init2D(); }
      else if (cost > 120) { renderScale = 0.4; resize(); }
      return;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Sustained slow frames → shrink the shader's resolution (CSS scales it up —
  // glow survives blur beautifully); still drowning at minimum → soft 2D grid.
  // Sustained FAST frames climb back up, so transient jank (DevTools, GC, a
  // lane animation) never taxes a healthy GPU for the rest of the session.
  function degrade() {
    if (gl && renderScale > 0.36) { renderScale *= 0.6; resize(); }
    else if (gl) { gl = null; init2D(); }
  }
  function recover() {
    if (gl && renderScale < 1) { renderScale = Math.min(1, renderScale / 0.6); resize(); }
  }

  // ---- 2D fallback: same physics, soft additive orbs instead of hard rects ----
  let ctx2d = null, cols = 0, rows = 0, cell = 16, gap = 3, seeds = null, W = 0, H = 0;
  function init2D() {
    // a canvas that ever held a GL context can never hand out a 2d one —
    // swap unconditionally; one spare canvas element is free
    swapCanvas();
    ctx2d = cnv.getContext('2d');
    resize();
  }
  function draw2D(dt) {
    const s = stepState(dt);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.fillStyle = '#0a0d16'; ctx2d.fillRect(0, 0, W, H);
    ctx2d.globalCompositeOperation = 'lighter';
    // one fillStyle for the whole frame; per-cell brightness rides globalAlpha
    // (this path exists FOR weak machines — no per-cell string building)
    ctx2d.fillStyle = `rgb(${s.col[0] | 0},${s.col[1] | 0},${s.col[2] | 0})`;
    const ox = (W - cols * (cell + gap) + gap) / 2, oy = (H - rows * (cell + gap) + gap) / 2;
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2, maxd = Math.hypot(cx, cy) || 1;
    const t = phase;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const seed = seeds[y * cols + x];
        const dx = (x - cx) / maxd, dy = (y - cy) / maxd, d = Math.hypot(dx, dy);
        let v = 0.24 + 0.16 * Math.sin(t * 0.7 + seed) + 0.14 * Math.sin(x * 0.5 - t * 0.85 + Math.sin(y * 0.33 + t * 0.4));
        v += 0.15 * Math.sin(t * 0.8 - d * 4.5);
        if (F.think > 0.02) v += F.think * 0.5 * Math.sin(Math.atan2(dy, dx) * 3 + t * 2.8 - d * 8);
        if (F.micEnv > 0.02) v += (0.3 + F.micEnv) * 0.5 * Math.sin(t * 3.6 + d * 12) + F.micEnv * (1 - d) * 0.35;
        if (F.sayEnv > 0.02) v += (0.25 + F.sayEnv) * 0.6 * Math.sin(t * 4.6 - d * 14) + F.sayEnv * (1 - d) * 0.5;
        v += F.burst * (1 - d);
        v = clamp(v * s.glow, 0, 1);
        if (v < 0.06) continue;
        const px = ox + x * (cell + gap) + cell / 2, py = oy + y * (cell + gap) + cell / 2;
        ctx2d.globalAlpha = v * 0.5;
        ctx2d.beginPath(); ctx2d.arc(px, py, cell * (0.35 + v * 0.45), 0, 6.28318); ctx2d.fill();
      }
    }
    ctx2d.globalAlpha = 1;
    ctx2d.globalCompositeOperation = 'source-over';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, gl ? 1.5 : 2) * (gl ? renderScale : 1);
    const r = cnv.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
    if (cnv.width !== pw || cnv.height !== ph) {
      cnv.width = pw; cnv.height = ph;                                   // reallocates + clears — only when it must
      prevFrame = 0;                                                     // a resize frame is not the GPU's fault — watchdog skips it
    }
    if (ctx2d) {
      cell = clamp(Math.floor(W / 52), 10, 20); gap = Math.max(2, Math.floor(cell * 0.24));
      const nc = Math.floor(W / (cell + gap)), nr = Math.floor(H / (cell + gap));
      if (nc !== cols || nr !== rows || !seeds) {                        // keep the grid's identity across no-op resizes
        cols = nc; rows = nr;
        seeds = new Float32Array(cols * rows);
        for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random() * 6.28318;
      }
    }
  }
  // coalesce observer/event storms (lane CSS animations fire every frame) to
  // one resize per painted frame
  let resizeQueued = false;
  function requestResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  }

  if (!initGL()) init2D();
  resize();                                                              // size BEFORE the first frame — the GPU probe must see real resolution
  window.addEventListener('resize', requestResize); window.addEventListener('lane-settled', requestResize);
  // The events above can all miss (organ mounted mid-layout, lane animated by
  // CSS, emulated viewports): observe the canvas itself and never render 1×1.
  if (window.ResizeObserver) { ro = new ResizeObserver(requestResize); ro.observe(cnv); }

  let rafId = 0, fastFrames = 0;
  (function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (cnv.offsetParent === null || document.hidden) { prevFrame = 0; return; }
    let dt = 0.016;
    if (prevFrame) {
      const gapMs = now - prevFrame;
      dt = Math.min(0.1, gapMs / 1000);
      // jank watchdog: 6 straight >90ms frames → degrade (scale, then 2D);
      // ~5s of clean frames at reduced scale → step back up
      if (gapMs > 90) { fastFrames = 0; if (++slowFrames >= 6) { slowFrames = 0; degrade(); } }
      else if (gapMs < 40) {
        if (slowFrames > 0) slowFrames--;
        if (renderScale < 1 && gl && ++fastFrames >= 300) { fastFrames = 0; recover(); }
      }
    }
    prevFrame = now;
    if (gl) drawGL(dt); else if (ctx2d) draw2D(dt);
  })(performance.now());

  // the shell keeps organs mounted, but a REmount must be able to free this
  // one completely — the rAF loop, the observers, and the GL context itself
  F.destroy = () => {
    cancelAnimationFrame(rafId);
    try { ro?.disconnect(); } catch { /* */ }
    window.removeEventListener('resize', requestResize);
    window.removeEventListener('lane-settled', requestResize);
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* */ }
    gl = null; ctx2d = null;
  };
  return F;
}

// ---------------------------------------------------------------------------
// VoiceLink — singleton socket to the local sidecar (reused across remounts).
// ---------------------------------------------------------------------------
const voice = {
  ws: null, ready: false, voices: [], defaultVoice: 'auma',
  on: {},
  _timer: 0,
  emit(k, ...a) { try { (this.on[k] || (() => {}))(...a); } catch { /* */ } },
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let ws;
    try { ws = new WebSocket(SIDECAR_WS); } catch { this.retry(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') { this.emit('pcm', e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'ready') {
        this.ready = true;
        this.voices = m.voices || [];
        this.defaultVoice = m.default_voice || 'aurora';
        this.emit('ready', m);
      } else this.emit(m.t, m);
    };
    ws.onclose = ws.onerror = () => {
      const was = this.ready;
      this.ready = false; this.ws = null;
      if (was) this.emit('down');
      this.retry();
    };
  },
  retry() { clearTimeout(this._timer); this._timer = setTimeout(() => this.connect(), 4000); },
  send(obj) { if (this.ready && this.ws?.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch { /* */ } } },
  sendPCM(buf) { if (this.ready && this.ws?.readyState === 1) { try { this.ws.send(buf); } catch { /* */ } } },
  say(id, text, v, speed, first) { this.send({ t: 'tts', id, text, voice: v, speed: speed || 1.0, first: !!first }); },
  cancel() { this.send({ t: 'tts_cancel' }); },
  her(on) { this.send({ t: 'her', on: !!on }); },
  reset() { this.send({ t: 'reset' }); },
};

function resampleLinear(f32, from, to) {
  if (from === to) return f32;
  const n = Math.max(1, Math.round(f32.length * to / from));
  const out = new Float32Array(n);
  const r = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * r, i0 = x | 0, i1 = Math.min(i0 + 1, f32.length - 1), fr = x - i0;
    out[i] = f32[i0] * (1 - fr) + f32[i1] * fr;
  }
  return out;
}

let activeCleanup = null;

// ---------------------------------------------------------------------------

export function mountAumaLive(root) {
  injectStyle();
  if (activeCleanup) { try { activeCleanup(); } catch { /* */ } }

  const app = el('div', 'alv-app');
  const canvas = document.createElement('canvas'); canvas.className = 'alv-canvas';
  app.append(canvas, el('div', 'alv-scan'), el('div', 'alv-vignette'));

  // the one control: the orb
  const orb = el('button', 'alv-orb'); orb.type = 'button'; orb.title = 'open the channel';
  orb.innerHTML = '<span class="alv-orb-halo"></span><span class="alv-orb-ring"></span><span class="alv-orb-core"></span>';
  app.append(orb);

  // status whisper — a brief, honest line above the orb when the channel's state
  // actually changes (voice blocked, fallback engaged, organ back online). It
  // fades itself out; silence stays the default.
  const statusEl = el('div', 'alv-status');
  app.append(statusEl);
  let statusTimer = 0;
  function toast(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), 4200);
  }

  // a small settings icon (click, not hover) opens a clean panel: her depth,
  // then her voice. The panel is the only text on the surface, and it's out of
  // the way until you ask for it.
  const gear = el('button', 'alv-gear'); gear.type = 'button'; gear.title = 'her mind & voice';
  gear.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1"/></svg>';
  app.append(gear);

  // mute — stops her hearing you (side conversations stay private). Sits next to
  // the gear; one tap. Muting also drops any half-heard phrase so it never fires.
  const muteBtn = el('button', 'alv-mute'); muteBtn.type = 'button'; muteBtn.title = 'mute — she stops listening';
  const micOn = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const micOff = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 11V6a3 3 0 0 0-5.9-.7M5 11a7 7 0 0 0 10.3 6.2M12 18v3M19 11a7 7 0 0 1-.6 2.8"/><path d="M3 3l18 18"/></svg>';
  muteBtn.innerHTML = micOn;
  app.append(muteBtn);

  const panel = el('div', 'alv-panel');
  const mindGroup = el('div', 'alv-group');
  const mindSeg = el('div', 'alv-seg');
  mindGroup.append(Object.assign(el('div', 'alv-group-k'), { textContent: 'her mind' }), mindSeg);
  const mindNote = el('div', 'alv-note'); mindGroup.append(mindNote);
  const voiceGroup = el('div', 'alv-group');
  const voiceList = el('div', 'alv-vlist');
  voiceGroup.append(Object.assign(el('div', 'alv-group-k'), { textContent: 'her voice' }), voiceList);
  panel.append(mindGroup, voiceGroup);
  app.append(panel);

  // a three-line icon, bottom-LEFT (mirrors the gear): opens the running
  // transcript so you can read + copy the back-and-forth, or type to her.
  const logBtn = el('button', 'alv-log-btn'); logBtn.type = 'button'; logBtn.title = 'transcript';
  logBtn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';
  app.append(logBtn);

  const logPanel = el('div', 'alv-log');
  const logHead = el('div', 'alv-log-head');
  logHead.append(Object.assign(el('div', 'alv-log-title'), { textContent: 'transcript' }));
  const logCopy = el('button', 'alv-log-copy'); logCopy.type = 'button'; logCopy.textContent = 'copy';
  logHead.append(logCopy);
  const logBody = el('div', 'alv-log-body');
  const logEmpty = el('div', 'alv-log-empty'); logEmpty.textContent = 'nothing said yet — open the channel and talk, or type to her below.';
  const compose = document.createElement('form'); compose.className = 'alv-log-compose';
  const composeInput = document.createElement('input'); composeInput.className = 'alv-log-input'; composeInput.type = 'text'; composeInput.placeholder = 'type to her…';
  const composeSend = el('button', 'alv-log-send'); composeSend.type = 'submit'; composeSend.textContent = 'send';
  compose.append(composeInput, composeSend);
  // Cross-lane peek (one mind, two mouths): what's being typed in the chats lane,
  // pinned between the transcript head and body. Display-only, read from the chat
  // lane's own localStorage — the SERVER twin (crossLane.ts) is what she actually sees.
  const chatPeek = el('div', 'alv-chat-peek');
  function renderChatPeek() {
    const turns = recentChatTurns(3);
    chatPeek.innerHTML = '';
    if (!turns.length) { chatPeek.style.display = 'none'; return; }
    chatPeek.style.display = '';
    const head = el('div', 'alv-chat-peek-head');
    head.textContent = `⌨ the typed thread, ${fmtAgo(turns[turns.length - 1].ts) || 'earlier'} — she carries both`;
    chatPeek.append(head);
    for (const t of turns) {
      const row = el('div', 'alv-chat-peek-row');
      const speech = t.text.length > 140 ? t.text.slice(0, 140) + '…' : t.text;
      row.textContent = `${t.role === 'you' ? 'you typed' : 'she wrote'}: ${speech}`;
      chatPeek.append(row);
    }
  }
  renderChatPeek();
  onLaneTurn((lane) => { if (lane === 'chat') renderChatPeek(); });
  logPanel.append(logHead, chatPeek, logBody, compose);
  app.append(logPanel);

  root.append(app);
  const field = createField(canvas);

  // ---- state ----
  let channel = false, streaming = false, curAbort = null;
  let duplex = false, herAudible = false, ttsPending = 0, ttsId = 0;
  let micMuted = false;
  let chosenVoice = voice.defaultVoice;
  let voicePicked = false;       // once the owner picks, stop following the sidecar default
  let chosenMind = 'balanced';   // her Claude mind, fast + memory-aware; deep = her fullest
  let closed = false;

  // her mind, three depths. Honest about the trade.
  const MINDS = [
    { id: 'deep', label: 'deep', note: 'her fullest mind — Fable, a real breath (~3s), then something true.' },
    { id: 'balanced', label: 'balanced', note: 'DeepSeek V4 Flash — strong and quick. The everyday default.' },
    { id: 'quick', label: 'quick', note: 'fastest, lightest — snappy, less depth.' },
  ];
  function buildMinds() {
    mindSeg.innerHTML = '';
    MINDS.forEach((m) => {
      const b = el('button', 'alv-seg-b' + (m.id === chosenMind ? ' on' : ''));
      b.type = 'button'; b.textContent = m.label;
      b.addEventListener('click', () => {
        chosenMind = m.id;
        [...mindSeg.children].forEach((c) => c.classList.toggle('on', c === b));
        mindNote.textContent = m.note;
      });
      mindSeg.append(b);
    });
    mindNote.textContent = (MINDS.find((m) => m.id === chosenMind) || MINDS[0]).note;
  }

  const setOrb = () => {
    orb.className = 'alv-orb'
      + (channel ? ' live' : '')
      + (field.mode === 'thinking' ? ' thinking' : '')
      + (field.mode === 'speaking' ? ' speaking' : '')
      + (!duplex ? ' fb' : '');
    orb.title = channel ? 'close the channel' : 'open the channel';
  };
  const setMode = (m) => { field.mode = m; setOrb(); };

  // ---- audio graph (built on first user gesture) ----
  let ctx = null, micStream = null, micNode = null, playerNode = null, micSrc = null, muteTap = null;

  async function ensureAudio() {
    if (ctx) { if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* */ } } return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.audioWorklet.addModule(WORKLET_URL);
      playerNode = new AudioWorkletNode(ctx, 'alv-player', { numberOfInputs: 0, outputChannelCount: [1] });
      playerNode.connect(ctx.destination);
      playerNode.port.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'lvl') {
          field.sayEnv = Math.min(1, Math.max(field.sayEnv, m.rms * 26));
          const audible = m.audible || ttsPending > 0;
          if (audible !== herAudible) { herAudible = audible; voice.her(audible); if (!audible) settleIfDone(); }
        }
      };
      return true;
    } catch { ctx = null; return false; }
  }

  async function startMic() {
    if (micStream) return true;
    if (!(await ensureAudio())) return false;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      micSrc = ctx.createMediaStreamSource(micStream);
      micNode = new AudioWorkletNode(ctx, 'alv-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
      muteTap = ctx.createGain(); muteTap.gain.value = 0;
      micSrc.connect(micNode); micNode.connect(muteTap); muteTap.connect(ctx.destination);
      micNode.port.onmessage = (e) => {
        const m = e.data;
        if (micMuted) return;  // muted: don't hear you at all (side conversations stay private)
        if (m.t === 'rms') {
          const lvl = clamp((m.v - 0.008) * 11, 0, 1);
          field.micEnv += (lvl - field.micEnv) * 0.4;
          if (!duplex) fallbackVadTick(lvl);
        } else if (m.t === 'pcm' && channel && duplex) {
          voice.sendPCM(m.pcm);
        }
      };
      return true;
    } catch { return false; }
  }

  function stopMic() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    try { micSrc?.disconnect(); micNode?.disconnect(); muteTap?.disconnect(); } catch { /* */ }
    micStream = null; micSrc = null; micNode = null; muteTap = null; field.micEnv = 0;
  }

  // ---- her voice out ----
  function pushPcm(arrayBuf) {
    if (!ctx || !playerNode) return;
    const i16 = new Int16Array(arrayBuf);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const rs = resampleLinear(f32, 24000, ctx.sampleRate);
    playerNode.port.postMessage({ cmd: 'push', pcm: rs.buffer }, [rs.buffer]);
  }

  // F3: force the sidecar's "she is speaking" bar down from ANY terminal path,
  // not just the worklet's audible→false tick. That tick never fires if the
  // AudioContext is suspended (tab backgrounded) or the node is torn down — the
  // exact case that used to latch the mic half-deaf. The WebSocket is independent
  // of the audio graph, so this reaches the sidecar even when audio is frozen.
  function dropHer() {
    ttsPending = 0;
    if (herAudible) { herAudible = false; voice.her(false); }
  }

  function cutHerVoice() {
    if (playerNode) playerNode.port.postMessage({ cmd: 'cut' });
    voice.cancel();
    dropHer();
    stopBrowserVoice();
  }

  // ---- sidecar events ----
  voice.on = {
    ready() {
      duplex = true;
      if (!voicePicked) chosenVoice = voice.defaultVoice;   // follow the sidecar's fast default
      populateVoices(); setOrb();
      if (channel) { voice.reset(); stopRecog(); toast('local voice organ online — full duplex'); }
    },
    down() {
      duplex = false; ttsPending = 0; setOrb();
      if (channel) {
        if (!micMuted) startRecog();                        // mute survives the transition — private stays private
        announceFallback('local voice organ lost');
      }
    },
    vad(m) {
      if (!channel) return;
      if (m.speaking && (herAudible || streaming)) bargeIn();
    },
    // ONE clean path: the sidecar only sends a `final` once you've actually
    // finished a sentence. No speculation, no half-sentence guesses.
    final(m) {
      if (!channel) return;
      const text = (m.text || '').trim();
      if (text) requestTurn(text);
    },
    tts_end() { ttsPending = Math.max(0, ttsPending - 1); settleIfDone(); },
    tts_cancelled() { dropHer(); },
    pcm(buf) { pushPcm(buf); },
    err() { /* soft error; the turn continues */ },
  };
  voice.connect();
  if (voice.ready) { duplex = true; populateVoices(); }
  setOrb();

  // ---- pickers: the only text, and they hide themselves ----
  buildMinds();
  function populateVoices() {
    voiceList.innerHTML = '';
    // fast (streaming pocket) voices first, then the richer-but-slower kokoro ones
    const ordered = [...voice.voices].sort((a, b) => (a.engine === 'pocket' ? 0 : 1) - (b.engine === 'pocket' ? 0 : 1));
    ordered.forEach((v) => {
      const slow = v.engine === 'kokoro';
      const b = el('button', 'alv-vrow' + (v.id === chosenVoice ? ' on' : '') + (slow ? ' slow' : ''));
      b.type = 'button';
      const name = el('span', 'alv-vname'); name.textContent = v.label;
      const tag = el('span', 'alv-vtag ' + (slow ? 'is-slow' : 'is-fast')); tag.textContent = slow ? 'richer · slower' : 'fast';
      const top = el('span', 'alv-vtop'); top.append(name, tag);
      const hint = el('span', 'alv-vhint'); hint.textContent = v.hint || '';
      b.append(top, hint);
      b.addEventListener('click', async () => {
        chosenVoice = v.id; voicePicked = true;
        [...voiceList.children].forEach((c) => c.classList.toggle('on', c === b));
        await ensureAudio();
        ttsPending++; voice.her(true);
        voice.say(++ttsId, 'This is me.', chosenVoice);
      });
      voiceList.append(b);
    });
  }
  // click the gear to open/close; click anywhere else closes it. No hover.
  let panelOpen = false;
  function togglePanel(force) {
    panelOpen = force === undefined ? !panelOpen : force;
    panel.classList.toggle('show', panelOpen);
    gear.classList.toggle('on', panelOpen);
  }
  gear.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
  panel.addEventListener('click', (e) => e.stopPropagation());

  // ---- transcript log (this device; the copyable record of the channel) ----
  const LOG_KEY = 'aukora-auma-live-log-v1';
  let logTurns = [];
  try { logTurns = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { logTurns = []; }
  function saveLog() { try { localStorage.setItem(LOG_KEY, JSON.stringify(logTurns.slice(-120))); } catch { /* quota */ } }
  function logRow(turn) {
    const row = el('div', 'alv-log-row ' + (turn.role === 'you' ? 'you' : 'auma'));
    const who = el('div', 'alv-log-who'); who.textContent = turn.role === 'you' ? 'you' : 'Auma';
    const txt = el('div', 'alv-log-txt'); txt.textContent = turn.text;
    row.append(who, txt); return row;
  }
  function renderLog() {
    logBody.innerHTML = '';
    if (!logTurns.length) { logBody.append(logEmpty); return; }
    logTurns.forEach((t) => logBody.append(logRow(t)));
    logBody.scrollTop = logBody.scrollHeight;
  }
  function addTurn(role, text) {
    const t = String(text || '').trim(); if (!t) return;
    logTurns.push({ role, text: t, ts: Date.now() });
    if (logTurns.length > 120) logTurns = logTurns.slice(-120);
    saveLog();
    announceLaneTurn('voice'); // pulse the chats lane: a spoken turn just landed
    if (logBody.contains(logEmpty)) logBody.removeChild(logEmpty);
    logBody.append(logRow(logTurns[logTurns.length - 1]));
    logBody.scrollTop = logBody.scrollHeight;
  }
  renderLog();

  let logOpen = false;
  function toggleLog(force) {
    logOpen = force === undefined ? !logOpen : force;
    logPanel.classList.toggle('show', logOpen);
    logBtn.classList.toggle('on', logOpen);
    if (logOpen) { togglePanel(false); logBody.scrollTop = logBody.scrollHeight; }
  }
  logBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLog(); });
  logPanel.addEventListener('click', (e) => e.stopPropagation());
  logCopy.addEventListener('click', () => {
    const text = logTurns.map((t) => (t.role === 'you' ? 'You: ' : 'Auma: ') + t.text).join('\n\n');
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
    logCopy.textContent = 'copied'; setTimeout(() => { logCopy.textContent = 'copy'; }, 1400);
  });
  compose.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = composeInput.value.trim(); if (!v) return;
    composeInput.value = '';
    requestTurn(v);   // rides the same governed door; addTurn('you') fires inside requestTurn
  });

  app.addEventListener('click', () => { if (panelOpen) togglePanel(false); if (logOpen) toggleLog(false); });

  // ---- fallback voice (sidecar down): browser TTS, no on-screen labels.
  // Voice pick now prefers the neural "Natural" voices Windows/Edge ship — the
  // difference between a 90s robot and her — before the classic favourites. ----
  let ttsQueueFb = 0, fbVoices = [], fbChosen = null, fbKeep = 0;
  function loadFbVoices() {
    // **`localService === true` IS A PRIVACY FILTER, NOT A QUALITY ONE.** A voice that is NOT local is synthesised
    // by the BROWSER VENDOR: `speechSynthesis.speak()` sends the reply TEXT to Google or Microsoft to be spoken.
    // **Her answer leaves the machine to be read aloud** — with no prompt, no indicator, and no way for Peter to tell
    // which of two identically-named voices did it. `localService` is the only field that distinguishes them.
    //
    // **A BROWSER WITH NO LOCAL VOICE NOW GETS NOTHING RATHER THAN THE CLOUD**, which is the honest failure: the
    // caller says "local voice not installed" instead of quietly shipping her words to a third party.
    fbVoices = (window.speechSynthesis?.getVoices() || [])
      .filter((v) => /^en/i.test(v.lang))
      .filter((v) => v.localService === true);
    // NAMED female neural voices first — never a bare /natural/ match, which
    // would let 'Guy (Natural)' outrank every female favourite and flip her
    // voice's gender on installs without the named ones. Then the classics.
    const pref = [/(aria|jenny|sonia|libby|michelle|emma|ava|ana).*(natural|neural|online)/i, /serena/i, /google uk english female/i, /sonia/i, /kate/i, /moira/i, /tessa/i, /zira/i, /female/i];
    fbVoices.sort((a, b) => (pref.findIndex((r) => r.test(a.name)) + 1 || 99) - (pref.findIndex((r) => r.test(b.name)) + 1 || 99));
    fbChosen = fbVoices[0] || null;
  }
  if ('speechSynthesis' in window) { loadFbVoices(); window.speechSynthesis.onvoiceschanged = loadFbVoices; }
  // Desktop Chrome stalls speechSynthesis ~15s into a long utterance; the known
  // fix is a periodic pause/resume nudge while speaking. Chrome-only on purpose.
  const isChromeDesktop = /Chrome\//.test(navigator.userAgent) && !/Edg\/|Mobile/.test(navigator.userAgent);
  function fbKeepAlive() {
    if (!isChromeDesktop) return;
    clearInterval(fbKeep);
    fbKeep = setInterval(() => {
      const ss = window.speechSynthesis;
      if (!ss || !ss.speaking) { clearInterval(fbKeep); return; }
      try { ss.pause(); ss.resume(); } catch { /* */ }
    }, 12000);
  }
  function speakFallback(text) {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    try {
      const u = new SpeechSynthesisUtterance(text.trim());
      u.voice = fbChosen; u.rate = 0.96; u.pitch = 1.02;
      u.onboundary = () => { field.sayEnv = Math.min(1, field.sayEnv + 0.5); };
      u.onstart = () => { ttsQueueFb++; fbKeepAlive(); };
      u.onend = u.onerror = () => { ttsQueueFb = Math.max(0, ttsQueueFb - 1); if (!ttsQueueFb) clearInterval(fbKeep); settleIfDone(); };
      window.speechSynthesis.speak(u);
    } catch { /* no tts */ }
  }
  function stopBrowserVoice() { try { window.speechSynthesis.cancel(); } catch { /* */ } clearInterval(fbKeep); ttsQueueFb = 0; }

  // fallback STT — the path every non-Mac node lives on (no sidecar on 7092).
  // REWORKED: turns now fire from the recognizer's OWN final results (debounced),
  // not from a 950ms mic-RMS silence timer. The old race — the timer grabbing
  // `heard` before the recognizer had delivered the final — was exactly why the
  // channel opened but she never answered on Windows. Errors are now honest:
  // blocked/unavailable recognition says so on the surface and leaves typing +
  // her voice out fully alive, instead of dying silently.
  let recog = null, recogOn = false, recogDead = false, heard = '';
  let sendTimer = 0, restartTimer = 0, netErrs = 0;
  // **THE BROWSER RECOGNISER STREAMS RAW MICROPHONE AUDIO TO GOOGLE OR APPLE, AND IT IS NOW OFF BY DEFAULT.**
  // `SpeechRecognition` is not a local API in Chrome or Safari: the audio leaves the device and is transcribed by the
  // vendor. **It is also the SILENT fallback** — a fresh download has no sidecar, and a sidecar that drops mid-session
  // silently switches to this path, so Peter's microphone can start streaming to a third party without anything
  // changing on screen.
  //
  // **OPT-IN, VIA A KEY THAT DEFAULTS OFF.** `window.AUMA_LIVE_ALLOW_CLOUD_VOICE === true` is the only way to reach
  // it, because **a privacy behaviour must be chosen rather than inherited from a missing sidecar.**
  // **THE TOGGLE IS EXPLICIT AND DELIBERATELY NOT PERSISTED.** `window.AUMA_LIVE_ALLOW_CLOUD_VOICE` must be set to
  // exactly `true` before this script loads. **It is not read from browser storage on purpose**: a preference that
  // survives a reload is a privacy decision made once and forgotten, and the whole reason this path is off is that a
  // dropped sidecar used to switch it on silently. **A choice that must be re-made each session is a choice.**
  const SR = (window.AUMA_LIVE_ALLOW_CLOUD_VOICE === true)
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : undefined;
  function recogFail(msg) {
    recogDead = true; recogOn = false;
    toast(msg);
    toggleLog(true);                                                     // typing is the honest path now — put it in reach
  }
  function scheduleSend(stillForming) {
    clearTimeout(sendTimer);
    if (!heard.trim()) return;
    // finals settled → send soon; words still forming → give the recognizer room
    sendTimer = setTimeout(() => {
      const say = heard.trim(); heard = '';
      if (channel && !duplex && !micMuted && say) requestTurn(say);      // !duplex: a stale final must not race the sidecar
    }, stillForming ? 1500 : 600);
  }
  function startRecog() {
    if (!SR || recogOn || duplex || recogDead || micMuted) return;
    recog = new SR(); recog.lang = 'en-US'; recog.continuous = true; recog.interimResults = true;
    recog.onresult = (ev) => {
      // guards for events that outlive their welcome: a trailing result after
      // the sidecar took over, or while the owner muted for a side conversation
      if (duplex || micMuted || !channel) return;
      // ECHO GATE: on speakers the recognizer hears HER voice too. The mic
      // stream is echo-cancelled, so while she is audible we only accept
      // recognition the mic envelope corroborates — otherwise she'd barge
      // herself in and answer her own sentences.
      if (herStillAudible() && field.micEnv < 0.04) return;
      netErrs = 0;
      let interim = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) heard += r[0].transcript + ' ';
        else if (r[0].transcript.trim()) interim = true;
      }
      if (interim) {
        field.micEnv = Math.min(1, field.micEnv + 0.2);                  // the field sees your words forming
        if (streaming || herStillAudible()) bargeIn();                   // she yields the moment you start
      }
      scheduleSend(interim);
    };
    recog.onerror = (e) => {
      const kind = e && e.error;
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        recogFail('voice recognition blocked by the browser — type to her below; she still speaks');
      } else if (kind === 'network' && ++netErrs >= 3) {
        recogFail('voice recognition unavailable in this browser — type to her; she still speaks');
      }
      // 'no-speech' / 'aborted' are normal breathing — onend restarts
    };
    recog.onend = () => {
      if (!recogOn || recogDead) return;
      // healthy sessions restart at once (Chrome ends continuous recognition
      // routinely — a delay here is a deaf window); only back off after errors
      clearTimeout(restartTimer);
      if (netErrs === 0) { try { recog.start(); return; } catch { /* fall through to the timer */ } }
      restartTimer = setTimeout(() => { try { recog.start(); } catch { /* mid-teardown */ } }, 300);
    };
    try { recog.start(); recogOn = true; } catch { recogFail('voice recognition failed to start — type to her; she still speaks'); }
  }
  function stopRecog() {
    recogOn = false;
    clearTimeout(sendTimer); clearTimeout(restartTimer);
    try { recog?.stop(); } catch { /* */ }
    recog = null; heard = '';
  }
  function fallbackVadTick(lvl) {
    // RMS is now only the fast barge-in trigger; the recognizer owns the turns.
    if (!channel || duplex || micMuted) return;
    if (lvl > 0.16 && (streaming || herStillAudible())) bargeIn();
  }

  // ---- turns (one clean streaming turn — no speculation, no filler) ----
  let pendingTurn = null;

  function requestTurn(text) {
    text = String(text || '').trim();
    if (!text) { if (streaming || herStillAudible()) bargeIn(); return; }
    addTurn('you', text);   // record what you said (STT or typed) in the transcript
    if (streaming) {
      // two requests can land in the abort-propagation gap (typed + the STT
      // debounce): JOIN them — a logged turn must never silently vanish
      pendingTurn = pendingTurn ? pendingTurn + '\n' + text : text;
      bargeIn();
      return;
    }
    if (herStillAudible()) bargeIn();
    transmit(text);
  }

  function speakChunk(text, first) {
    const t = sanitizeForVoice(text); if (!t) return;   // never let the TTS read markdown symbols aloud
    if (duplex) { ttsPending++; if (!herAudible) { herAudible = true; voice.her(true); } voice.say(++ttsId, t, chosenVoice, 1.0, first); }
    else speakFallback(t);
  }

  async function transmit(text) {
    if (streaming) return;
    streaming = true;
    const abortCtl = new AbortController(); curAbort = abortCtl;
    field.burst = 1; field.think = 1; setMode('thinking');
    await ensureAudio();

    let full = '', sentTo = 0, firstFlush = true, spoke = false;
    // her hands on the field: [field …] tags stream out of the text here, applied
    // live and never spoken/printed. Works on both the sidecar and fallback paths.
    const dirs = makeDirectiveFilter((tag) => field.alien(tag));
    // Stream her voice by WHOLE SENTENCES (not tiny clauses): each sentence is
    // one clean, continuous TTS stream, so there are far fewer gaps between
    // synthesis runs — the main cause of the choppiness. Silence until real
    // words arrive reads as her thinking (no filler).
    const flushSpeech = (endOfTurn) => {
      const tail = full.slice(sentTo);
      if (!tail) return;
      if (endOfTurn) { speakChunk(tail, firstFlush); sentTo = full.length; firstFlush = false; return; }
      let cut = -1;
      // send everything up to the LAST completed sentence in the buffer
      // (typographic closers ” ’ » count too — models use them constantly)
      // snappier opener: the FIRST flush speaks a short reply ("Yes." "Right.") the
      // instant it completes (>=2); later flushes keep the >=12 anti-tiny-synth floor
      // so the whole-sentence, non-choppy streaming is unchanged.
      const floor = firstFlush ? 2 : 12;
      for (const m of tail.matchAll(/[.!?…]["'”’»)\]]?(?=\s|$)/g)) {
        const end = m.index + m[0].length;
        if (end >= floor) cut = end;
      }
      // a very long run-on with no end punctuation yet — break at a comma so she starts
      if (cut < 0 && tail.length > 180) { const c = tail.lastIndexOf(', '); if (c > 100) cut = c + 1; }
      if (cut > 0) { speakChunk(tail.slice(0, cut), firstFlush); sentTo += cut; firstFlush = false; }
    };

    try {
      const res = await fetch(DOOR + '/api/presence/stream', {
        method: 'POST', signal: abortCtl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, mind: chosenMind }),
      });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) {
          const m = p.match(/^data:\s*(.*)$/m); if (!m) continue;
          let ev; try { ev = JSON.parse(m[1]); } catch { continue; }
          if (ev.t === 'tok') {
            full += dirs.push(ev.v);
            if (!spoke && full.trim()) { spoke = true; setMode('speaking'); field.think = 0.4; }
            field.sayEnv = Math.min(1, field.sayEnv + 0.1);
            flushSpeech(false);
          } else if (ev.t === 'field') {
            // the door splits her body-language tags into typed events now;
            // the local dirs filter stays as defense in depth for older doors
            field.alien(ev.v);
          }
          // 'done' needs no handling here — the ONE finalizer below runs when
          // the stream closes, whether or not the server managed to say done
        }
      }
      full += dirs.flush();
      flushSpeech(true);
      if (full.trim()) addTurn('auma', sanitizeForVoice(full));   // record her reply in the transcript
      endTurn();
    } catch (e) {
      if (abortCtl.signal.aborted) { if (full.trim()) addTurn('auma', sanitizeForVoice(full)); endTurn('cut'); return; }
      speakChunk('The channel flickered — I lost my thread. Say it again?', true); endTurn();
    }
  }

  function herStillAudible() { return herAudible || ttsPending > 0 || ttsQueueFb > 0; }

  function settleIfDone() {
    if (streaming || closed) return;
    if (!herStillAudible()) setMode(channel ? 'listening' : 'idle');
  }

  function endTurn(how) {
    streaming = false; curAbort = null; field.think = 0;
    if (pendingTurn) { const p = pendingTurn; pendingTurn = null; transmit(p); return; }
    if (how === 'cut') { cutHerVoice(); settleIfDone(); return; }
    if (herStillAudible()) setMode('speaking');
    else settleIfDone();
    setTimeout(() => { dropHer(); settleIfDone(); }, 25000);
  }

  function bargeIn() {
    if (curAbort) try { curAbort.abort(); } catch { /* */ }
    cutHerVoice();
  }

  // one honest announcement of which body she's wearing on this node —
  // shared by channel-open and a live sidecar loss, so the two can't drift
  let fbToastShown = false;
  function announceFallback(prefix) {
    // **THIS SENTENCE BECAME FALSE THE MOMENT THE CLOUD PATH WAS GATED.** It said *"no speech recognition in this
    // browser"* — but the browser HAS it; **the config refuses it, and those are different facts a person needs to
    // tell apart.** A missing API is not something Peter can act on; a switched-off one is.
    if (!SR && window.AUMA_LIVE_ALLOW_CLOUD_VOICE === true) {
      toast('no speech recognition in this browser — type to her below; she speaks aloud');
    } else if (!SR) {
      // The honest sentence: local voice is what is absent, and the cloud path is off by choice rather than broken.
      // **THE MESSAGE SAYS WHAT TO DO, NOT ONLY WHAT IS MISSING.** "Local voice not installed" is a diagnosis; the
      // person reading it needs the remedy, and there is exactly one: `setup.sh` builds the venv, fetches the models
      // and derives the prompt. **A message that names a problem and no action is a message that gets ignored.**
      //
      // **AND IT NAMES THE CHOICE.** Peter asked that the cloud path work *when he chooses it* — so the sentence says
      // the switch exists and what it is called, rather than leaving a privacy default that looks like a dead end.
      toast('local voice not installed — run the Auma Live voice setup to install it, or set '
        + 'window.AUMA_LIVE_ALLOW_CLOUD_VOICE = true before loading to use the browser voice instead. '
        + 'Typing to her below always works, and she speaks aloud either way.');
    }
    else if (recogDead) toast('voice recognition unavailable — type to her; she still speaks');
    else if (prefix) toast(prefix + ' — browser voice engaged');
    else if (!fbToastShown) { fbToastShown = true; toast('local voice organ offline — browser voice engaged'); }
  }
  async function openChannel() {
    const ok = await startMic();
    if (!ok) {
      orb.classList.add('blocked');
      setTimeout(() => orb.classList.remove('blocked'), 2400);
      toast('microphone blocked — allow mic access for this site, or type to her below');
      return;
    }
    channel = true;
    if (duplex) voice.reset();
    else {
      recogDead = false; netErrs = 0;    // opening the channel is a fresh chance — a flaky network must not deafen her forever
      if (!micMuted) startRecog();
      announceFallback();
    }
    setMode('listening');
    field.burst = 1;
  }
  function closeChannel() {
    channel = false;
    stopRecog(); stopMic(); bargeIn();
    field.alien('[field reset]');        // channel closed = her resting body, not the last skin she wore
    setMode('idle');
  }
  orb.addEventListener('click', () => { if (channel) closeChannel(); else openChannel(); });

  // mute toggle — stop her hearing you without closing the channel
  function setMute(on) {
    micMuted = on;
    muteBtn.classList.toggle('muted', on);
    muteBtn.innerHTML = on ? micOff : micOn;
    muteBtn.title = on ? 'unmute — she can hear you again' : 'mute — she stops listening';
    if (on) {
      field.micEnv = 0;                 // stop the field showing your voice
      if (duplex) voice.reset();        // drop any half-heard phrase so it never fires
      else stopRecog();                 // fallback path: stop the recognizer too
    } else if (channel && !duplex) {
      startRecog();                     // fallback: resume recognizing
    }
  }
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); setMute(!micMuted); });

  // first contact
  setTimeout(() => { field.burst = 1; }, 350);
  const unload = () => { closeChannel(); };
  window.addEventListener('beforeunload', unload);
  // F3: when the tab is backgrounded, the AudioContext suspends and the worklet
  // stops emitting the audible→false tick — so tell the sidecar she's done NOW,
  // over the WS, before that happens. This is the #1 real-world latch trigger.
  const onVis = () => { if (document.hidden) dropHer(); };
  document.addEventListener('visibilitychange', onVis);
  activeCleanup = () => {
    closed = true;
    window.removeEventListener('beforeunload', unload);
    document.removeEventListener('visibilitychange', onVis);
    dropHer();
    closeChannel();
    clearTimeout(statusTimer);
    field.destroy();                     // stop the rAF loop, release observers + the GL context
    voice.on = {};
  };
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .alv-app { position:absolute; inset:0; overflow:hidden; color:var(--text);
    background:radial-gradient(120% 130% at 50% 45%, rgba(var(--hue-c),0.05), transparent 62%), #111520; }
  .alv-canvas { position:absolute; inset:0; width:100%; height:100%; }
  .alv-scan { position:absolute; inset:0; pointer-events:none; opacity:0.3;
    background:repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,0,0,0.1) 3px 4px); }
  .alv-vignette { position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(120% 120% at 50% 46%, transparent 58%, rgba(10,13,22,0.5) 100%); }

  .alv-orb { position:absolute; left:50%; bottom:34px; transform:translateX(-50%); z-index:5;
    width:64px; height:64px; border-radius:50%; cursor:pointer; border:none; background:transparent; }
  .alv-orb-halo { position:absolute; inset:-22px; border-radius:50%; opacity:0; transition:opacity 0.6s ease;
    background:radial-gradient(circle, rgba(var(--hue-l),0.22), transparent 65%); }
  .alv-orb-ring { position:absolute; inset:0; border-radius:50%; border:1.5px solid rgba(var(--hue-c),0.4);
    transition:border-color 0.3s ease, box-shadow 0.3s ease; }
  .alv-orb-core { position:absolute; inset:20px; border-radius:50%; background:rgba(var(--hue-c),0.4);
    box-shadow:0 0 12px rgba(var(--hue-c),0.35); transition:all 0.3s ease; }
  .alv-orb:hover .alv-orb-ring { border-color:rgba(var(--hue-c),0.85); box-shadow:0 0 18px rgba(var(--hue-c),0.25); }

  .alv-orb.live .alv-orb-halo { opacity:1; animation:alvHalo 3.2s ease-in-out infinite; }
  .alv-orb.live .alv-orb-ring { border-color:rgba(var(--hue-l),0.85); box-shadow:0 0 22px rgba(var(--hue-l),0.35); }
  .alv-orb.live .alv-orb-core { inset:16px; background:rgba(var(--hue-l),0.95); box-shadow:0 0 26px rgba(var(--hue-l),0.8); animation:alvBreath 2.8s ease-in-out infinite; }
  .alv-orb.live.thinking .alv-orb-core { background:rgba(var(--hue-l),1); animation:alvThink 0.9s ease-in-out infinite; }
  .alv-orb.live.speaking .alv-orb-core { background:rgba(var(--hue-r),0.95); box-shadow:0 0 30px rgba(var(--hue-r),0.8); animation:alvBreath 1.6s ease-in-out infinite; }
  .alv-orb.live.speaking .alv-orb-ring { border-color:rgba(var(--hue-r),0.85); }
  .alv-orb.fb .alv-orb-ring { border-style:dashed; border-color:rgba(255,196,140,0.55); }
  .alv-orb.blocked .alv-orb-ring { border-color:rgba(255,120,120,0.9); animation:alvBlocked 0.5s ease-in-out 3; }

  /* status whisper — bottom center, above the orb; brief, honest, self-fading */
  .alv-status { position:absolute; left:50%; bottom:116px; transform:translateX(-50%) translateY(8px); z-index:6;
    max-width:min(78vw, 540px); text-align:center; font-size:10px; letter-spacing:0.22em; text-transform:uppercase;
    color:rgba(var(--hue-c),0.9); text-shadow:0 0 14px rgba(var(--hue-c),0.5); padding:7px 16px; border-radius:20px;
    border:1px solid rgba(var(--hue-c),0.16); background:rgba(8,10,18,0.55); backdrop-filter:blur(10px);
    opacity:0; pointer-events:none; transition:opacity 0.5s ease, transform 0.5s var(--ease); }
  .alv-status.show { opacity:1; transform:translateX(-50%) translateY(0); }

  @keyframes alvBreath { 0%,100%{transform:scale(1);} 50%{transform:scale(1.14);} }
  @keyframes alvThink { 0%,100%{transform:scale(0.9); opacity:0.75;} 50%{transform:scale(1.22); opacity:1;} }
  @keyframes alvHalo { 0%,100%{transform:scale(1); opacity:0.75;} 50%{transform:scale(1.35); opacity:1;} }
  @keyframes alvBlocked { 0%,100%{transform:scale(1);} 50%{transform:scale(1.12);} }

  /* settings icon — quiet, bottom-right, clicked (never hovered) */
  .alv-gear { position:absolute; right:22px; bottom:40px; z-index:6; width:38px; height:38px; border-radius:50%;
    display:grid; place-items:center; cursor:pointer; color:var(--faint);
    border:1px solid rgba(255,255,255,0.1); background:rgba(8,10,18,0.5); backdrop-filter:blur(10px);
    transition:color 0.18s ease, border-color 0.18s ease, transform 0.3s ease; }
  .alv-gear:hover { color:var(--dim); border-color:rgba(255,255,255,0.24); }
  .alv-gear.on { color:rgba(var(--hue-l),1); border-color:rgba(var(--hue-l),0.45); transform:rotate(35deg); }

  /* mute — sits just left of the gear */
  .alv-mute { position:absolute; right:68px; bottom:40px; z-index:6; width:38px; height:38px; border-radius:50%;
    display:grid; place-items:center; cursor:pointer; color:var(--faint);
    border:1px solid rgba(255,255,255,0.1); background:rgba(8,10,18,0.5); backdrop-filter:blur(10px);
    transition:color 0.18s ease, border-color 0.18s ease; }
  .alv-mute:hover { color:var(--dim); border-color:rgba(255,255,255,0.24); }
  .alv-mute.muted { color:rgba(255,170,90,1); border-color:rgba(255,170,90,0.6); background:rgba(255,170,90,0.12);
    box-shadow:0 0 16px rgba(255,170,90,0.28); animation:alvMuteP 2s ease-in-out infinite; }
  @keyframes alvMuteP { 0%,100%{opacity:1;} 50%{opacity:0.7;} }

  /* the panel — clean, aligned, single column; rises from the icon */
  .alv-panel { position:absolute; right:22px; bottom:88px; z-index:6; width:288px; max-width:calc(100% - 44px);
    display:flex; flex-direction:column; gap:18px; padding:18px; border-radius:18px;
    opacity:0; transform:translateY(10px) scale(0.98); transform-origin:bottom right; pointer-events:none;
    border:1px solid rgba(255,255,255,0.1); background:rgba(9,11,19,0.9); backdrop-filter:blur(20px) saturate(1.1);
    box-shadow:0 24px 60px rgba(0,0,0,0.5); transition:opacity 0.24s ease, transform 0.24s var(--ease); }
  .alv-panel.show { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }
  .alv-group { display:flex; flex-direction:column; gap:9px; }
  .alv-group-k { font-size:9.5px; letter-spacing:0.24em; text-transform:uppercase; color:var(--faint); }

  /* her mind — a proper segmented control */
  .alv-seg { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; padding:3px; border-radius:12px;
    background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); }
  .alv-seg-b { font:inherit; font-size:12px; padding:7px 4px; border-radius:9px; cursor:pointer; color:var(--dim);
    border:1px solid transparent; background:transparent; transition:all 0.15s ease; }
  .alv-seg-b:hover { color:var(--text); }
  .alv-seg-b.on { color:#fff; background:rgba(var(--hue-l),0.18); border-color:rgba(var(--hue-l),0.5); box-shadow:0 0 12px rgba(var(--hue-l),0.2); }
  .alv-note { font-size:11px; line-height:1.5; color:var(--faint); min-height:2.6em; }

  /* her voice — a clean scrollable list, one per row */
  .alv-vlist { display:flex; flex-direction:column; gap:2px; max-height:216px; overflow-y:auto; margin:0 -4px; padding:0 4px; }
  .alv-vlist::-webkit-scrollbar { width:6px; } .alv-vlist::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.14); border-radius:3px; }
  .alv-vrow { display:flex; align-items:baseline; justify-content:space-between; gap:10px; text-align:left;
    font:inherit; padding:8px 11px; border-radius:10px; cursor:pointer; border:1px solid transparent; background:transparent; transition:all 0.14s ease; }
  .alv-vrow:hover { background:rgba(255,255,255,0.04); }
  .alv-vrow.on { background:rgba(var(--hue-r),0.1); border-color:rgba(var(--hue-r),0.4); }
  .alv-vtop { display:flex; align-items:center; gap:8px; min-width:0; }
  .alv-vname { font-size:13px; color:var(--text); flex:none; }
  .alv-vrow.on .alv-vname { color:rgba(var(--hue-r),1); }
  .alv-vtag { font-size:8.5px; letter-spacing:0.08em; text-transform:uppercase; padding:1px 6px; border-radius:20px; flex:none; }
  .alv-vtag.is-fast { color:rgba(var(--hue-l),0.95); border:1px solid rgba(var(--hue-l),0.4); background:rgba(var(--hue-l),0.1); }
  .alv-vtag.is-slow { color:var(--faint); border:1px solid rgba(255,255,255,0.14); }
  .alv-vrow.slow .alv-vname { color:var(--dim); }
  .alv-vhint { font-size:10px; color:var(--faint); text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  /* transcript icon — mirrors the gear, bottom-LEFT */
  .alv-log-btn { position:absolute; left:22px; bottom:40px; z-index:6; width:38px; height:38px; border-radius:50%;
    display:grid; place-items:center; cursor:pointer; color:var(--faint);
    border:1px solid rgba(255,255,255,0.1); background:rgba(8,10,18,0.5); backdrop-filter:blur(10px);
    transition:color 0.18s ease, border-color 0.18s ease; }
  .alv-log-btn:hover { color:var(--dim); border-color:rgba(255,255,255,0.24); }
  .alv-log-btn.on { color:rgba(var(--hue-c),1); border-color:rgba(var(--hue-c),0.45); }

  /* transcript panel — rises from the bottom-left icon */
  .alv-log { position:absolute; left:22px; bottom:88px; z-index:6; width:342px; max-width:calc(100% - 44px); max-height:min(62vh, 470px);
    display:flex; flex-direction:column; overflow:hidden; opacity:0; transform:translateY(10px) scale(0.98); transform-origin:bottom left; pointer-events:none;
    border-radius:18px; border:1px solid rgba(255,255,255,0.1); background:rgba(9,11,19,0.92); backdrop-filter:blur(20px) saturate(1.1);
    box-shadow:0 24px 60px rgba(0,0,0,0.5); transition:opacity 0.24s ease, transform 0.24s var(--ease); }
  .alv-log.show { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }
  .alv-log-head { flex:none; display:flex; align-items:center; justify-content:space-between; padding:13px 15px 10px; border-bottom:1px solid rgba(255,255,255,0.06); }
  .alv-log-title { font-size:9.5px; letter-spacing:0.24em; text-transform:uppercase; color:var(--faint); }
  .alv-log-copy { font:inherit; font-size:11px; padding:4px 12px; border-radius:8px; cursor:pointer; color:var(--dim);
    border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.03); transition:color 0.15s ease, border-color 0.15s ease; }
  .alv-log-copy:hover { color:#fff; border-color:rgba(var(--hue-c),0.5); }
  .alv-chat-peek { flex:none; padding:9px 15px 10px; border-bottom:1px dashed rgba(196,170,255,0.22); background:rgba(196,170,255,0.04); }
  .alv-chat-peek-head { font-size:9.5px; letter-spacing:0.18em; text-transform:uppercase; color:rgba(196,170,255,0.7); margin-bottom:5px; }
  .alv-chat-peek-row { font-size:11.5px; line-height:1.5; color:var(--dim); margin-top:2px; }
  .alv-log-body { flex:1; overflow-y:auto; padding:13px 15px; display:flex; flex-direction:column; gap:12px; }
  .alv-log-body::-webkit-scrollbar { width:6px; } .alv-log-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.14); border-radius:3px; }
  .alv-log-empty { font-size:12px; line-height:1.55; color:var(--faint); }
  .alv-log-row { display:flex; flex-direction:column; gap:3px; }
  .alv-log-row.you { align-items:flex-end; }
  .alv-log-who { font-size:8.5px; letter-spacing:0.18em; text-transform:uppercase; }
  .alv-log-row.you .alv-log-who { color:rgba(var(--hue-c),0.9); }
  .alv-log-row.auma .alv-log-who { color:rgba(var(--hue-r),0.9); }
  .alv-log-txt { font-size:13px; line-height:1.5; color:rgba(255,255,255,0.9); max-width:90%; padding:8px 11px; border-radius:12px; white-space:pre-wrap; word-break:break-word; }
  .alv-log-row.you .alv-log-txt { background:rgba(var(--hue-c),0.1); border:1px solid rgba(var(--hue-c),0.22); border-bottom-right-radius:4px; }
  .alv-log-row.auma .alv-log-txt { background:rgba(var(--hue-r),0.08); border:1px solid rgba(var(--hue-r),0.2); border-bottom-left-radius:4px; }
  .alv-log-compose { flex:none; display:flex; gap:8px; padding:10px 12px; border-top:1px solid rgba(255,255,255,0.06); }
  .alv-log-input { flex:1; min-width:0; font:inherit; font-size:13px; color:var(--text); background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.1); border-radius:11px; padding:8px 11px; outline:none; }
  .alv-log-input::placeholder { color:var(--faint); }
  .alv-log-input:focus { border-color:rgba(var(--hue-c),0.5); }
  .alv-log-send { flex:none; font:inherit; font-size:12px; font-weight:600; padding:0 15px; border-radius:11px; cursor:pointer; color:#0b0d16; border:none;
    background:rgba(var(--hue-c),0.9); transition:box-shadow 0.2s ease; }
  .alv-log-send:hover { box-shadow:0 0 16px rgba(var(--hue-c),0.4); }
  `;
  const tag = document.createElement('style'); tag.id = 'aumalive-style'; tag.textContent = css;
  document.getElementById('aumalive-style')?.remove();
  document.head.append(tag);
}
