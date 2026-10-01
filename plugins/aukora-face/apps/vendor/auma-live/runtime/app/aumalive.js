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
// PIPELINE (see the bundled voice/README.md): mic → same-origin voice bridge (Silero VAD
// → whisper on the Apple GPU, live partials) → the governed presence lane on
// → Whisper) → same-origin presence lane → sentence/clause-streamed local TTS → a fading
// player worklet. Talking over her cuts her voice in ~90 ms.
//
// NON-MAC NODES (no sidecar): the browser fallback is a first-class citizen —
// Web Speech recognition drives the turns off its own final results, browser
// TTS prefers the neural voices Windows ships, and any degradation states
// itself in one fading status line instead of failing silently.

import { makeDirectiveFilter, FIELD_HUES, FIELD_FORMS } from '/app/field-directives.js';
import { recentChatTurns, fmtAgo, announceLaneTurn, onLaneTurn, bindLaneSession } from '/app/lane-bridge.js';
import { createAuraTrace } from '/app/aura-trace.js';
import { DuplexGate, isSelfEcho } from '/app/aumalive-duplex.js';
import { createFieldQuality } from '/app/field-quality.js';
import { initialMindChoice, rememberMindChoice } from '/app/aumalive-mind-choice.js';
import {
  createHomeSession, turnSessionId, transcriptLogKey, headerSessionId, refusalSentence, fallbackSentence,
  SESSION_HEADER, FALLBACK_HEADER, REFUSAL_HEADER, HOME_WAIT_MS,
} from '/app/home-session.js';

const PRESENCE_ENDPOINT = '/api/auma-live/presence/stream';
const SIDECAR_WS = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/stock-apps/auma-live/voice`;
const WORKLET_URL = '/app/aumalive-audio.js';
const PRESENCE_FIRST_EVENT_TIMEOUT_MS = 18000;
const PRESENCE_IDLE_TIMEOUT_MS = 22000;

// **THE LIVE SELECTION FIRST, THE ADDRESS ONLY WHEN THERE IS NO LIVE ONE.** Aukora's session runtime keeps its
// current thread in `dsh.sessions.current` on this origin and rewrites it on every change: `{ sessionId }` when a
// thread is clicked, `{}` after New Session. The iframe address's `?session=` is only the selection AT MOUNT: the
// surface binds it once so that a click does not reload her (`auma-live-session.ts`). This function used to read
// the address first, so once she had opened on a thread every later turn went through that thread, whatever the
// sidebar showed, and she said nothing about it. When the runtime has written the cell, the cell IS the
// selection, and an empty one means her home. The address is used only when no runtime on this origin has written
// a selection, as with a bare page opened in its own tab.
const SELECTION_KEY = 'dsh.sessions.current';
function selectedSessionId() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    const persisted = raw === null ? null : JSON.parse(raw);
    if (persisted !== null && typeof persisted === 'object' && !Array.isArray(persisted)) {
      const current = typeof persisted.sessionId === 'string' ? persisted.sessionId.trim() : '';
      return current.length <= 256 ? current : '';
    }
  } catch { /* an unavailable or malformed cell: the address is all there is */ }
  const explicit = new URLSearchParams(location.search).get('session')?.trim() || '';
  return explicit.length <= 256 ? explicit : '';
}

// **SHE HAS A HOME, SO SHE NEVER HAS TO ASK WHICH THREAD.** The home is the deployment's (`homeSession` in
// auma-live.patch.yml); the page learns it AT MOUNT through `/app/home-session.js`, and every turn goes through
// `turnSessionId(selectedSessionId(), home.id)` — the live selection, else her home — read at the moment of the
// turn, so a changed selection is followed rather than refused.
//
// The session the transcript is bound to: the one the last turn actually went through. The field's degradation
// report names it, so a report says which conversation was on screen.
let boundSessionId = '';

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
    .replace(/\[\s*(?:field|repo|web|recall|weights)\b[^\]]*\]/gi, ' ')   // her invisible tags — the last-line guarantee: never spoken even if one escapes the Host. The set is the Host's; voice-tag-parity.host.spec.ts derives both sides and refuses a drift.
    .replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, '') // bold / italic / strike markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')       // headings
    .replace(/^\s{0,3}>\s?/gm, '')            // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, '')        // bullet markers
    .replace(/^\s{0,3}\d+\.\s+/gm, '')        // numbered-list markers
    .replace(/[*_`~#|]/g, '')                 // any stray symbol left — the guarantee
    .replace(/[ \t]{2,}/g, ' ')               // tidy whitespace
    .trim();
}

const CANVAS_DOCUMENT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "img-src data:",
  "media-src data:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join('; ');

function escapeCanvasText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeCanvasMarkup(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup);
  const blockedElements = new Set([
    'animate', 'animatemotion', 'animatetransform', 'base', 'embed', 'iframe', 'link',
    'object', 'script', 'set', 'template',
  ]);
  const blockedAttributes = new Set([
    'action', 'data', 'download', 'formaction', 'href', 'ping', 'poster', 'src', 'srcdoc', 'srcset', 'target', 'xlink:href',
  ]);
  template.content.querySelectorAll('*').forEach((node) => {
    if (
      blockedElements.has(node.localName.toLowerCase())
      || (node.localName.toLowerCase() === 'meta' && node.hasAttribute('http-equiv'))
    ) {
      node.remove();
      return;
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || blockedAttributes.has(name)) node.removeAttribute(attribute.name);
    }
  });
  return template.innerHTML;
}

function canvasDocumentSrcdoc(canvasDocument) {
  const title = escapeCanvasText(canvasDocument.title || 'Auma Canvas');
  const css = String(canvasDocument.css).replace(/<\/style/gi, '<\\/style');
  const markup = sanitizeCanvasMarkup(canvasDocument.markup);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CANVAS_DOCUMENT_CSP}">
<title>${title}</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width:100%; height:100%; margin:0; }
html, body { background:transparent; color:#f3f4ff; }
/* Definite height so child percentage heights resolve, and a centering grid
   so a composition smaller than the canvas sits centered instead of pinned
   to the top-left corner; full-size and fixed/absolute scenes fill as before. */
#auma-canvas-document { position:relative; width:100%; height:100%; margin:0; overflow:hidden; display:grid; place-items:center; }
${css}
</style>
</head>
<body><main id="auma-canvas-document">${markup}</main></body>
</html>`;
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

function createField(canvas, auraTrace) {
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
  // A HIDDEN TAB SAYS NOTHING ABOUT THE GPU. The gaps it produces are enormous and mean the page was not
  // drawing, not that the field is failing — counting them degraded the field every time the owner switched
  // away and back. The ladder is told, and ignores everything inside the window.
  document.addEventListener('visibilitychange', () => { fieldQuality.visibilityChanged(performance.now()); });
  // THE QUALITY LADDER, AND THE WAY BACK UP IT. It decides ONLY; `degrade()` and `recover()` do the work, so
  // there is one implementation of "go down" and one of "come back". Every drop is posted, because a limit that
  // does not print did not happen.
  const fieldQuality = createFieldQuality({
    onDegrade: ({ reason, scale }) => { postFieldDegraded(reason, scale); },
  });
  /** Report one degradation. Best-effort: a failed report must never break the field. */
  function postFieldDegraded(reason, scale) {
    try {
      void fetch('/api/auma-live/field-degraded', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'field-degraded', reason, scale, at: Date.now(), session: boundSessionId,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* the field is more important than the report */ }
  }
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
      cnv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        // **THE LADDER IS TOLD, AND IT REMEMBERS.** Before this a loss set `gl = null` and `recover()` was
        // guarded on `gl` — so the one path that most needs recovery is the one path that can never take it.
        fieldQuality.contextLost_();
        gl = null;
        init2D();
      }, { once: true });
      // AND A RESTORE IS HEARD. The context can return on its own; the field still earns its way back through
      // clean frames, but knowing the GPU is available again is what makes the retry meaningful.
      cnv.addEventListener('webglcontextrestored', () => { fieldQuality.contextRestored(); }, { once: true });
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
  /**
   * **CLIMB BACK FROM 2D — THE RUNG THAT DID NOT EXIST.** `recover()` only steps the SCALE back up and requires
   * a live `gl`, so after a first-frame drop or a context loss there was no path to WebGL at all and the aurora
   * stayed a dot grid for the life of the page. This re-creates the context and, if it takes, reports the field
   * recovered. It is only ever called by the ladder, after clean frames have earned the attempt.
   */
  function retryWebGL() {
    try {
      if (gl) return;                  // already back; nothing to do
      if (!initGL()) return;           // the GPU is still not answering — stay in 2D and try again later
      // THE CANVAS CHANGES HANDS: release the 2D context and take a GL one, then reallocate at the new size.
      // Without this the canvas keeps the 2D context `init2D` took and `initGL` cannot get a WebGL context on
      // it at all — a canvas has exactly one context kind for its lifetime.
      ctx2d = null;
      renderScale = 1;
      resize();
      fieldQuality.recovered();
    } catch { /* a failed retry stays in 2D; the ladder will offer another */ }
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
    auraTrace.resize();
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

  let rafId = 0, fastFrames = 0, traceElapsed = 0, presentationActive = true;
  (function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!presentationActive || cnv.offsetParent === null || document.hidden) { prevFrame = 0; return; }
    let dt = 0.016;
    if (prevFrame) {
      const gapMs = now - prevFrame;
      dt = Math.min(0.1, gapMs / 1000);
      // **THE LADDER DECIDES; THESE TWO FUNCTIONS DO THE WORK.** The old code lived here: a 40-90 ms frame fell
      // between its two branches and neither counted nor cleared, so the counter sat at 5 and the sixth
      // merely-bad frame degraded the field. `field-quality.js` counts CLEAN TIME, and offers a WebGL retry in
      // 2D as well as at a reduced scale — which is what lets the aurora come back.
      const verdict = fieldQuality.frame({ atMs: now, gapMs });
      if (verdict.action === 'drop-2d') degrade();
      else if (verdict.action === 'retry-webgl') {
        if (!gl) retryWebGL();
        else recover();
      }
    }
    prevFrame = now;
    traceElapsed += dt * 1000;
    if (gl) drawGL(dt); else if (ctx2d) draw2D(dt);
    auraTrace.draw(traceElapsed, {
      color: S.col,
      mic: F.micEnv,
      say: F.sayEnv,
      think: F.think,
    });
  })(performance.now());

  F.setActive = (active) => {
    presentationActive = Boolean(active);
    if (presentationActive) requestResize();
  };

  // the shell keeps organs mounted, but a REmount must be able to free this
  // one completely — the rAF loop, the observers, and the GL context itself
  F.destroy = () => {
    cancelAnimationFrame(rafId);
    try { ro?.disconnect(); } catch { /* */ }
    window.removeEventListener('resize', requestResize);
    window.removeEventListener('lane-settled', requestResize);
    auraTrace.destroy();
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* */ }
    gl = null; ctx2d = null;
  };
  return F;
}

// ---------------------------------------------------------------------------
// VoiceLink — singleton socket to the local sidecar (reused across remounts).
// ---------------------------------------------------------------------------
const voice = {
  ws: null, ready: false, enabled: false, owner: '', voices: [], defaultVoice: 'auma',
  on: {},
  _timer: 0,
  emit(k, ...a) { try { (this.on[k] || (() => {}))(...a); } catch { /* */ } },
  connect() {
    if (!this.enabled || !this.owner) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let ws;
    try { ws = new WebSocket(`${SIDECAR_WS}?owner=${encodeURIComponent(this.owner)}`); } catch { this.retry(); return; }
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
    ws.onerror = () => { /* close owns retry and ownership-loss state */ };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      const was = this.ready;
      this.ready = false; this.ws = null;
      if (event.code === 4001) {
        this.enabled = false;
        this.owner = '';
        clearTimeout(this._timer);
        this.emit('owner_lost');
        return;
      }
      if (was) this.emit('down');
      this.retry();
    };
  },
  enable(owner) {
    if (!owner) return;
    if (this.owner && this.owner !== owner) this.disconnect();
    this.owner = owner;
    this.enabled = true;
    this.connect();
  },
  disconnect() {
    this.enabled = false;
    this.owner = '';
    clearTimeout(this._timer);
    const socket = this.ws;
    this.ws = null; this.ready = false;
    if (socket) {
      socket.onclose = null; socket.onerror = null; socket.onmessage = null;
      try { socket.close(); } catch { /* already closed */ }
    }
  },
  retry() {
    clearTimeout(this._timer);
    if (this.enabled) this._timer = setTimeout(() => this.connect(), 4000);
  },
  send(obj) {
    if (!this.ready || this.ws?.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  },
  sendPCM(buf) { if (this.ready && this.ws?.readyState === 1) { try { this.ws.send(buf); } catch { /* */ } } },
  say(id, text, v, speed, first) { return this.send({ t: 'tts', id, text, voice: v, speed: speed || 1.0, first: !!first }); },
  cancel() { this.send({ t: 'tts_cancel' }); },
  her(on) { this.send({ t: 'her', on: !!on }); },
  reset() { this.send({ t: 'reset' }); },
};

let activeCleanup = null;

// ---------------------------------------------------------------------------

export function mountAumaLive(root, options = {}) {
  injectStyle();
  if (activeCleanup) { try { activeCleanup(); } catch { /* */ } }

  const canvasMode = options.mode === 'canvas';
  let surfaceActive = window.parent === window;

  const app = el('div', 'alv-app');
  const canvas = document.createElement('canvas'); canvas.className = 'alv-canvas';
  const auraTrace = createAuraTrace();
  app.append(canvas, auraTrace.element, el('div', 'alv-scan'), el('div', 'alv-vignette'));
  const canvasScene = canvasMode ? el('div', 'alv-canvas-scene') : null;
  if (canvasScene) app.append(canvasScene);

  // the one control: the orb
  const orb = el('button', 'alv-orb'); orb.type = 'button'; orb.title = canvasMode ? 'open the channel' : 'Start Voice';
  orb.setAttribute('aria-label', canvasMode ? 'Open voice channel' : 'Start Voice');
  orb.setAttribute('aria-pressed', 'false');
  orb.innerHTML = '<span class="alv-orb-halo"></span><span class="alv-orb-ring"></span><span class="alv-orb-core"></span>';
  app.append(orb);
  if (!canvasMode) {
    const voiceDisclosure = el('div', 'alv-note alv-voice-disclosure');
    voiceDisclosure.id = 'auma-live-start-voice-disclosure';
    voiceDisclosure.textContent = 'Start Voice sends spoken text and conversation history to OpenRouter for this session. Other context needs separate authorization. Stop Voice ends this authorization.';
    orb.setAttribute('aria-describedby', voiceDisclosure.id);
    app.append(voiceDisclosure);
  }

  // status whisper — a brief, honest line above the orb when the channel's state
  // actually changes (voice blocked, fallback engaged, organ back online). It
  // fades itself out; silence stays the default.
  const statusEl = el('div', 'alv-status');
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');
  app.append(statusEl);
  let statusTimer = 0;
  function toast(msg, duration = 4200) {
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), duration);
  }

  // a small settings icon (click, not hover) opens a clean panel: her depth,
  // then her voice. The panel is the only text on the surface, and it's out of
  // the way until you ask for it.
  const gear = el('button', 'alv-gear'); gear.type = 'button'; gear.title = canvasMode ? 'her voice' : 'her mind & voice';
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
  if (!canvasMode) panel.append(mindGroup);
  panel.append(voiceGroup);
  const providerGroup = el('div', 'alv-group');
  const providerState = el('div', 'alv-note');
  const providerScope = el('div', 'alv-note');
  const providerSteps = el('div', 'alv-note');
  const nativeSdkState = el('div', 'alv-note');
  providerGroup.append(Object.assign(el('div', 'alv-group-k'), { textContent: 'provider setup' }),
    providerState, providerScope, providerSteps, nativeSdkState);
  providerState.textContent = 'Consent status unavailable until the host answers.';
  providerScope.textContent = 'Provider prompts can include your turn, conversation history, and separately authorised context. Every data class remains checked.';
  providerSteps.textContent = 'Start Voice authorizes spoken text and conversation history to OpenRouter for this session, for up to one hour. Stop Voice ends it. Other data classes still need separate authorization. No settings toggle is required; this panel does not change configuration.';
  nativeSdkState.textContent = 'Native SDK provider availability is unknown until the host answers.';
  if (!canvasMode) {
    panel.append(providerGroup);
    panel.style.maxHeight = 'calc(100% - 110px)';
    panel.style.overflowY = 'auto';
  }
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
  const stopLaneTurns = onLaneTurn((lane) => { if (lane === 'chat') renderChatPeek(); });
  logPanel.append(logHead, chatPeek, logBody, compose);
  app.append(logPanel);

  root.append(app);
  const field = createField(canvas, auraTrace);
  field.setActive(surfaceActive);

  // ---- state ----
  let channel = false, streaming = false, curAbort = null;
  let duplex = false, herAudible = false, ttsPending = 0, ttsId = 0;
  // THE GATE, AND HER OWN LAST SENTENCE. The gate decides which captured frames may reach the recogniser while
  // she is audible; `lastSpoken` is what a transcript is compared against, so her voice cannot become a turn
  // even if a frame slips past. See `/app/aumalive-duplex.js` for why the mic stayed open and what changed.
  const duplexGate = new DuplexGate();
  let lastSpoken = '';
  let gateStrictAnnounced = false;
  let lastMicRms = 0;
  const ttsRequests = new Map();
  let ttsQueueFb = 0;
  let micMuted = false;
  let chosenVoice = voice.defaultVoice;
  let voicePicked = false;       // once the owner picks, stop following the sidecar default
  // **THE CHOSEN MIND SURVIVES A RELOAD.** This was the literal `'balanced'`, re-evaluated on every document
  // load, so a reload silently discarded the choice and it looked like the choice had never been made. The
  // preference is about how she sounds, not session state. The default is unchanged: `balanced`, DeepSeek V4
  // Flash, the low-latency everyday voice mind.
  //
  // **`offeredMinds` IS DELIBERATELY NOT PASSED HERE, AND PASSING IT WOULD CRASH THE APP.** It is declared
  // further down this same function (line ~1024), so reading it at this point is a temporal dead zone
  // ReferenceError — measured by reading the declaration order, not by shipping it and waiting for a blank
  // screen. The roster is applied where it already was: `buildMinds` replaces the choice when the Host's list
  // does not contain it, so a remembered mind that is no longer offered is filtered out there.
  let chosenMind = initialMindChoice({ fallback: 'balanced' });
  let closed = false;
  const voiceOwnerId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let voiceClaim = '';
  let voiceClaimSerial = 0;
  let canvasRequestId = '';
  let announcedAgentWait = '';
  let replyWatchdog = 0;
  let canvasSessionId = '';
  let canvasRevision = -2;
  let canvasSceneFrame = null;
  let canvasPendingFrame = null;
  let canvasSceneDisposed = false;
  const canvasSceneTimers = new Set();

  // ---- her home, and the session each turn goes through ----
  // **LEARNED AT MOUNT, NOT WHEN THE GEAR OPENS.** The ask starts at the end of this function (`home.start()`),
  // retries with bounded backoff, and adopts `homeSession` whether or not the roster is empty. The roster rides
  // the same answer. See `/app/home-session.js` for each rule and the court that deletes it.
  const home = createHomeSession({
    fetch: (url, init) => fetch(url, init),
    onAnswer: (data) => applyRoster(data),
    onHome: () => adoptHome(),
  });
  /** The session a turn spoken NOW goes through: the live selection, else her home. */
  function turnSessionNow() { return turnSessionId(selectedSessionId(), home.id); }
  function adoptHome() {
    // Nothing selected: what she shows is her home's conversation, and a canvas parent hears where she answers.
    // A turn in flight settles its own transcript when the host names the session it went through.
    if (!selectedSessionId() && !streaming) bindTranscript(turnSessionNow());
    announceCanvasReady();
  }

  function releaseVoiceOwnership() {
    voiceClaim = '';
  }

  function createVoiceClaim(attempt) {
    if (!isCurrentMicAttempt(attempt)) return '';
    const token = `${String(Date.now()).padStart(13, '0')}:${voiceOwnerId}:${String(++voiceClaimSerial).padStart(6, '0')}`;
    voiceClaim = token;
    return token;
  }

  function disableCanvasSceneFrame(frame) {
    if (!frame) return;
    frame.inert = true;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.classList.add('leaving');
  }

  function scheduleCanvasSceneFrameRemoval(frame) {
    disableCanvasSceneFrame(frame);
    const timer = setTimeout(() => {
      canvasSceneTimers.delete(timer);
      frame.remove();
    }, 420);
    canvasSceneTimers.add(timer);
  }

  function resetCanvasScene(sessionId) {
    canvasSessionId = sessionId;
    canvasRevision = -2;
    canvasSceneFrame = null;
    canvasPendingFrame = null;
    canvasScene?.classList.remove('has-document');
    canvasScene?.replaceChildren();
  }

  function renderCanvasDocument(canvasDocument, revision, sessionId) {
    if (!canvasScene) return;
    if (sessionId !== canvasSessionId) resetCanvasScene(sessionId);
    if (revision <= canvasRevision) return;
    canvasRevision = revision;
    const previousFrame = canvasSceneFrame;
    if (canvasPendingFrame) {
      canvasPendingFrame.remove();
      canvasPendingFrame = null;
    }
    if (canvasDocument === null) {
      canvasSceneFrame = null;
      canvasScene.classList.remove('has-document');
      if (previousFrame) {
        previousFrame.classList.add('leaving');
        scheduleCanvasSceneFrameRemoval(previousFrame);
      }
      return;
    }

    const nextFrame = document.createElement('iframe');
    nextFrame.className = 'alv-canvas-document';
    nextFrame.title = canvasDocument.title || 'Auma Canvas';
    nextFrame.setAttribute('sandbox', '');
    nextFrame.referrerPolicy = 'no-referrer';
    nextFrame.setAttribute('referrerpolicy', 'no-referrer');
    nextFrame.inert = true;
    nextFrame.tabIndex = -1;
    nextFrame.setAttribute('aria-hidden', 'true');
    nextFrame.srcdoc = canvasDocumentSrcdoc(canvasDocument);
    canvasScene.append(nextFrame);
    canvasPendingFrame = nextFrame;

    let activated = false;
    const activate = () => {
      if (
        activated
        || canvasSceneDisposed
        || canvasPendingFrame !== nextFrame
        || !nextFrame.isConnected
      ) return;
      activated = true;
      canvasPendingFrame = null;
      canvasSceneFrame = nextFrame;
      nextFrame.inert = false;
      nextFrame.removeAttribute('aria-hidden');
      nextFrame.removeAttribute('tabindex');
      nextFrame.classList.add('active');
      canvasScene.classList.add('has-document');
      if (previousFrame && previousFrame !== nextFrame) {
        previousFrame.classList.add('leaving');
        scheduleCanvasSceneFrameRemoval(previousFrame);
      }
    };
    nextFrame.addEventListener('load', activate, { once: true });
    const timer = setTimeout(() => {
      canvasSceneTimers.delete(timer);
      activate();
    }, 800);
    canvasSceneTimers.add(timer);
  }

  function clearReplyWatchdog() {
    clearTimeout(replyWatchdog);
    replyWatchdog = 0;
  }

  function armReplyWatchdog() {
    clearReplyWatchdog();
    if (!herStillAudible()) return;
    replyWatchdog = setTimeout(() => {
      replyWatchdog = 0;
      cutHerVoice();
      settleIfDone();
    }, 25000);
  }

  function announceCanvasReady() {
    if (!canvasMode || window.parent === window) return;
    window.parent.postMessage({
      source: 'auma-canvas',
      type: 'ready',
      sessionId: turnSessionNow(),
    }, location.origin);
  }

  function applyAgentState(state) {
    switch (state) {
      case 'sending':
        field.alien('[field teal energy=0.24 storm=0.04 form=flow]'); field.think = 0.18; break;
      case 'queued':
        field.alien('[field green energy=0.28 storm=0.04 form=rings]'); field.think = 0.24; break;
      case 'steering':
        field.alien('[field cyan energy=0.55 storm=0.18 form=pulse burst]'); field.think = 0.58; break;
      case 'acting':
        field.alien('[field azure energy=0.82 storm=0.48 form=vortex burst]'); field.think = 0.9; break;
      case 'responding':
        field.alien('[field purple energy=0.52 storm=0.1 form=pulse]'); field.think = 0.42; break;
      case 'waiting':
        field.alien('[field gold energy=0.3 storm=0.03 form=rings]'); field.think = 0.2; break;
      default:
        field.alien('[field sky energy=0.42 storm=0.1 form=flow]'); field.think = 0.72;
    }
    setMode('thinking');
  }

  function onShellMessage(event) {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || message.source !== 'aukora-shell') return;
    if (message.type === 'surface-active') {
      const expectedApp = canvasMode ? 'auma-canvas' : 'auma-live';
      if (message.app !== expectedApp || typeof message.active !== 'boolean') return;
      surfaceActive = message.active;
      field.setActive(surfaceActive);
      if (surfaceActive && channel) voice.enable(voiceClaim);
      else if (!surfaceActive) {
        closeChannel();
        clearReplyWatchdog();
        duplex = false;
        ttsPending = 0;
        playerNode?.port.postMessage({ cmd: 'clear' });
        voice.disconnect();
        setOrb();
      }
      if (surfaceActive) announceCanvasReady();
      return;
    }
    if (canvasMode && message.type === 'canvas-document') {
      if (
        typeof message.sessionId !== 'string'
        || message.sessionId.length > 512
        || !Number.isSafeInteger(message.revision)
        || message.revision < -1
      ) return;
      const canvasDocument = message.document;
      if (canvasDocument !== null && (
        !canvasDocument
        || typeof canvasDocument !== 'object'
        || canvasDocument.version !== 1
        || typeof canvasDocument.title !== 'string'
        || typeof canvasDocument.markup !== 'string'
        || typeof canvasDocument.css !== 'string'
      )) return;
      renderCanvasDocument(canvasDocument, message.revision, message.sessionId);
      return;
    }
    if (canvasMode && message.type === 'agent-resume' && typeof message.requestId === 'string') {
      canvasRequestId = message.requestId;
      streaming = true;
      announcedAgentWait = '';
      applyAgentState('sending');
      return;
    }
    if (!canvasMode || message.requestId !== canvasRequestId) return;
    if (message.type === 'agent-accepted') {
      toast('Agent heard you');
      return;
    }
    if (message.type === 'agent-state') {
      applyAgentState(message.state);
      const notice = sanitizeForVoice(message.message);
      if (message.state === 'waiting' && notice && notice !== announcedAgentWait) {
        announcedAgentWait = notice;
        toast(notice, 7000);
        if (surfaceActive && channel) {
          speakVoiceText(notice);
          setMode('speaking');
        }
      }
      return;
    }
    if (message.type === 'agent-notice') {
      const notice = sanitizeForVoice(message.message || 'That spoken steering instruction was not admitted.');
      if (notice) {
        toast(notice, 7000);
        addTurn('auma', notice);
        if (surfaceActive && channel) {
          speakVoiceText(notice);
          setMode('speaking');
        }
      }
      return;
    }
    if (message.type === 'agent-error') {
      const error = sanitizeForVoice(message.message || 'The selected Agent could not accept that turn.');
      toast(error, 7000);
      if (error) {
        addTurn('auma', error);
        if (surfaceActive && channel) {
          speakVoiceText(error);
          setMode('speaking');
        }
      }
      endTurn();
      return;
    }
    if (message.type !== 'agent-response') return;
    const response = sanitizeForVoice(message.text);
    if (response) {
      if (surfaceActive && channel) speakVoiceText(response);
      addTurn('auma', response);
    }
    endTurn();
  }
  window.addEventListener('message', onShellMessage);
  announceCanvasReady();

  let voiceSession = null;
  let voiceStartAbort = null;
  let voiceExpiryTimer = 0;
  let voiceExpired = false;

  // her mind, five public depths. Honest about the trade.
  const MINDS = [
    // **THIS NOTE USED TO SAY "Fable", WHICH IS NEITHER A MODEL NOR WHAT RUNS.** The Host answers `deep` with
    // `openai/gpt-6-astra`, so the selector told Peter he was choosing one thing while another answered. A label
    // that names the wrong model is worse than no label: it is a claim about who is speaking.
    { id: 'deep', label: 'deep', note: 'OpenAI GPT-6 Astra — her fullest mind, a real breath (~3s), then something true.' },
    { id: 'opus', label: 'Opus 5.5', note: 'Anthropic Claude Opus 5.5 — the deepest mind here. Slower per turn, and the most expensive.' },
    { id: 'balanced', label: 'balanced', note: 'DeepSeek V4 Flash — strong and quick. The everyday default.' },
    { id: 'quick', label: 'quick', note: 'fastest, lightest — snappy, less depth.' },
    { id: 'muse', label: 'Muse Spark 1.3', note: 'Reasoning-enabled; provider availability and latency may vary.' },
    { id: 'yours', label: 'yours', note: 'your own H200 through your tunnel — no public provider sees this turn. Speed depends on what else is using that GPU.' },
  ];
  // The Host owns which minds exist. The selector starts with the four that always exist and adopts the Host's
  // roster from the mount-time answer that also carries her home (`home.start()`), so a mind the Host would
  // reject is never offered — including on a Host with no roster, where the four stay.
  let offeredMinds = ['deep', 'balanced', 'quick', 'muse'];
  let mindLabels = {};
  function renderProviderSetup(setup) {
    if (voiceSession !== null && voiceSession.expiresAt <= Date.now()) expireVoiceSession(voiceSession.voiceSessionToken);
    const voiceState = voiceSession !== null
      ? 'Start Voice authorized spoken text and history to OpenRouter for this session. Stop Voice ends this authorization.'
      : voiceExpired ? 'Voice session expired after one hour. Start Voice to continue.' : null;
    if (!setup || typeof setup !== 'object' || typeof setup.consentEnabled !== 'boolean') {
      providerState.textContent = voiceState ?? 'Consent status unavailable; the host still checks every request.';
      providerScope.textContent = 'Current disclosure policy scope is unavailable.';
      nativeSdkState.textContent = 'Native SDK provider availability is unknown.';
      return;
    }
    providerState.textContent = voiceState ?? (setup.consentEnabled
      ? 'Provider consent enabled by owner configuration. Start Voice is required for each voice session; disclosure policy still applies.'
      : 'Provider requests are off until Start Voice authorizes this session.');
    const recipient = typeof setup.recipient === 'string' && setup.recipient.length <= 253 ? setup.recipient : '';
    const allowed = Array.isArray(setup.allowed) ? setup.allowed.filter(value => typeof value === 'string').slice(0, 8) : [];
    providerScope.textContent = recipient && allowed.length
      ? `Policy recipient: ${recipient}. Allowed classes: ${allowed.join(', ')}. Prompts include your turn and history; additional context requires its own allowed class. Consent does not widen this policy.`
      : 'Disclosure policy unavailable or empty. Consent alone cannot permit a provider request.';
    const sdk = Array.isArray(setup.nativeSdkProviders) ? setup.nativeSdkProviders : [];
    nativeSdkState.textContent = sdk.filter(value => value && value.available === false
      && (value.id === 'codex' || value.id === 'claude-code') && typeof value.reason === 'string')
      .map(value => `${value.id} native SDK unavailable: ${value.reason}`).join(' ') || 'Native SDK provider availability is unknown.';
  }
  function applyRoster(data) {
    renderProviderSetup(data?.providerSetup);
    // AN EMPTY ROSTER IS NOT A REASON TO IGNORE THE ANSWER: her home was already adopted before this runs.
    if (!Array.isArray(data.minds) || data.minds.length === 0) return;
    offeredMinds = data.minds;
    mindLabels = (data.labels && typeof data.labels === 'object') ? data.labels : {};
    if (!offeredMinds.includes(chosenMind)) chosenMind = offeredMinds[0];
    buildMinds();
  }
  function buildMinds() {
    mindSeg.innerHTML = '';
    // Roster order is the Host's order; the Host may also relabel a mind
    // (e.g. the private endpoint showing what it actually runs).
    offeredMinds.forEach((id) => {
      const m = MINDS.find((entry) => entry.id === id) || { id, label: id, note: '' };
      const b = el('button', 'alv-seg-b' + (m.id === chosenMind ? ' on' : ''));
      b.type = 'button'; b.textContent = mindLabels[m.id] || m.label;
      b.addEventListener('click', () => {
        chosenMind = m.id;
        // REMEMBERED WHEN IT IS CHOSEN, and nowhere else. A default is not a choice, so nothing is stored
        // until a person actually picks one.
        rememberMindChoice({ mind: chosenMind });
        [...mindSeg.children].forEach((c) => c.classList.toggle('on', c === b));
        mindNote.textContent = m.note;
      });
      mindSeg.append(b);
    });
    mindNote.textContent = (MINDS.find((m) => m.id === chosenMind) || MINDS[0]).note;
  }

  let presenceBlocked = false;
  const setOrb = () => {
    orb.className = 'alv-orb'
      + (channel ? ' live' : '')
      + (field.mode === 'thinking' ? ' thinking' : '')
      + (field.mode === 'speaking' ? ' speaking' : '')
      + (!duplex ? ' fb' : '')
      + (presenceBlocked ? ' presence-blocked' : '');
    orb.title = canvasMode ? (channel ? 'close the channel' : 'open the channel') : (channel ? 'Stop Voice' : 'Start Voice');
    orb.setAttribute('aria-label', canvasMode ? (channel ? 'Close voice channel' : 'Open voice channel') : (channel ? 'Stop Voice' : 'Start Voice'));
    orb.setAttribute('aria-pressed', String(channel));
  };
  const setMode = (m) => { field.mode = m; setOrb(); };

  // ---- audio graph (built on first user gesture) ----
  let ctx = null, micStream = null, micTrack = null, micNode = null, playerNode = null, micSrc = null, muteTap = null;
  let audioInitPromise = null;
  let micAttempt = 0, channelOpeningAttempt = 0;
  let lastAudioError = null, micHeard = false, micSignalTimer = 0, micMuteTimer = 0, audioStateTimer = 0;
  let playbackLeaseRefresh = Number.NEGATIVE_INFINITY;
  const MIC_OPEN_TIMEOUT_MS = 15000;
  const PLAYBACK_LEASE_REFRESH_MS = 750;

  function onAudioStateChange() {
    clearTimeout(audioStateTimer);
    if (!channel || closed || document.hidden || ctx?.state === 'running') return;
    audioStateTimer = setTimeout(async () => {
      if (!channel || closed || document.hidden || ctx?.state === 'running') return;
      try { await ctx?.resume(); } catch { /* the state check below owns the failure */ }
      if (!channel || ctx?.state === 'running') return;
      failChannel('browser audio paused the microphone — reopen the channel to try again');
    }, 300);
  }

  async function initializeAudio() {
    lastAudioError = null;
    if (ctx?.state === 'closed') {
      ctx.removeEventListener('statechange', onAudioStateChange);
      try { playerNode?.disconnect(); } catch { /* closed graph */ }
      ctx = null; playerNode = null;
    }
    const existingContext = ctx;
    if (existingContext) {
      if (existingContext.state === 'suspended' || existingContext.state === 'interrupted') {
        try { await existingContext.resume(); }
        catch {
          lastAudioError = new Error('Audio context could not resume');
          lastAudioError.name = 'AudioContextSuspended';
          return false;
        }
      }
      return ctx === existingContext && !closed && existingContext.state !== 'closed';
    }
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor || !window.AudioWorkletNode) throw new Error('Web Audio worklets are unavailable');
      try { ctx = new AudioCtor({ latencyHint: 'interactive' }); }
      catch { ctx = new AudioCtor(); }
      if (!ctx.audioWorklet) throw new Error('Web Audio worklets are unavailable');
      ctx.addEventListener('statechange', onAudioStateChange);
      await ctx.audioWorklet.addModule(WORKLET_URL);
      playerNode = new AudioWorkletNode(ctx, 'alv-player', { numberOfInputs: 0, outputChannelCount: [1] });
      playerNode.connect(ctx.destination);
      playerNode.port.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'lvl') {
          field.sayEnv = Math.min(1, Math.max(field.sayEnv, m.rms * 26));
          const playbackAudible = m.audible === true;
          const audible = playbackAudible || ttsPending > 0;
          const audibleChanged = audible !== herAudible;
          herAudible = audible;
          duplexGate.herSpeaking(audible, performance.now());
          if (playbackAudible) refreshPlaybackLeases();
          else playbackLeaseRefresh = Number.NEGATIVE_INFINITY;
          if (audibleChanged) {
            if (!playbackAudible) voice.her(audible);
            if (!audible) { clearReplyWatchdog(); settleIfDone(); }
          }
        }
      };
      return true;
    } catch (error) {
      lastAudioError = error;
      try { playerNode?.disconnect(); } catch { /* partially built graph */ }
      playerNode = null;
      const failedContext = ctx; ctx = null;
      failedContext?.removeEventListener('statechange', onAudioStateChange);
      try { await failedContext?.close(); } catch { /* partially built context */ }
      return false;
    }
  }

  async function ensureAudio() {
    if (audioInitPromise) return audioInitPromise;
    const attempt = initializeAudio();
    audioInitPromise = attempt;
    try { return await attempt; }
    finally { if (audioInitPromise === attempt) audioInitPromise = null; }
  }

  function micFailureMessage(error) {
    const name = String(error?.name || '');
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return 'microphone permission denied — allow access for this app or site, then try again';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'no microphone found — connect or select an input device, then try again';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      return 'microphone unavailable — another app or system setting may be holding the input';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return 'the selected microphone cannot provide a usable audio stream';
    }
    if (name === 'AudioContextSuspended') {
      return 'microphone opened, but browser audio is paused — click the channel again to resume it';
    }
    return 'microphone failed to start — check browser and system input settings, then try again';
  }

  function beginMicSignalWatch() {
    clearTimeout(micSignalTimer);
    if (micHeard || micMuted || !channel) return;
    micSignalTimer = setTimeout(() => {
      if (channel && !micMuted && !micHeard) {
        toast('microphone open, but no input level detected — check the selected input device', 7000);
      }
    }, 4500);
  }

  function onMicTrackEnded() {
    failChannel('microphone disconnected — reconnect it, then reopen the channel');
  }

  function onMicTrackMute() {
    clearTimeout(micMuteTimer);
    micMuteTimer = setTimeout(() => {
      if (channel && micTrack?.muted) toast('microphone connected, but the browser is not receiving audio', 7000);
    }, 1200);
  }

  function onMicTrackUnmute() {
    clearTimeout(micMuteTimer);
    if (channel) {
      micHeard = false;
      toast('microphone audio restored — speak now');
      beginMicSignalWatch();
    }
  }

  function onMicProcessorError() {
    failChannel('microphone audio stopped — reopen the channel to try again');
  }

  function failChannel(message) {
    if (!channel || closed) {
      stopMic();
      return;
    }
    closeChannel();
    toast(message, 7000);
  }

  function isCurrentMicAttempt(attempt) {
    return attempt === micAttempt && surfaceActive && !closed;
  }

  function releaseMicResources(stream, source, node, tap) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    try { source?.disconnect(); node?.disconnect(); tap?.disconnect(); } catch { /* partially built graph */ }
  }

  function microphoneMediaDevices() {
    if (canvasMode && window.parent !== window) {
      try { return window.parent.navigator.mediaDevices; }
      catch { /* a cross-origin host cannot lend its top-level permission context */ }
    }
    return navigator.mediaDevices;
  }

  async function startMic(attempt) {
    if (!isCurrentMicAttempt(attempt)) return { ok: false, cancelled: true };
    if (micStream && micTrack?.readyState === 'live' && ctx?.state === 'running') return { ok: true };
    if (micStream) stopMic();
    const mediaDevices = microphoneMediaDevices();
    if (window.isSecureContext === false || !mediaDevices?.getUserMedia) {
      return { ok: false, message: 'microphone access is unavailable in this browser or page' };
    }
    let audioReady = false;
    try { audioReady = await ensureAudio(); }
    catch (error) { return { ok: false, message: micFailureMessage(error) }; }
    if (!audioReady) return { ok: false, message: micFailureMessage(lastAudioError) };
    if (!isCurrentMicAttempt(attempt)) return { ok: false, cancelled: true };
    const audioContext = ctx;
    let candidateStream = null, candidateTrack = null, candidateSrc = null, candidateNode = null, candidateTap = null;
    let candidateProcessorFailed = false;
    const onCandidateProcessorError = () => { candidateProcessorFailed = true; };
    let committed = false;
    try {
      try {
        candidateStream = await mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: { ideal: 1 },
          },
        });
      } catch (error) {
        const name = String(error?.name || '');
        if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw error;
        if (!isCurrentMicAttempt(attempt)) return { ok: false, cancelled: true };
        candidateStream = await mediaDevices.getUserMedia({ audio: true });
      }
      // THE HINT IS READ BACK. `echoCancellation: { ideal: true }` may be ignored, and until this line nothing
      // checked: a session could run with no canceller at all. When it is missing the gate goes STRICT — no
      // barge-in at any energy, a longer tail — because the only safe assumption then is that everything the
      // microphone hears while she speaks IS her.
      const appliedTrack = typeof candidateStream.getAudioTracks === 'function' ? candidateStream.getAudioTracks()[0] : null;
      const applied = typeof appliedTrack?.getSettings === 'function' ? appliedTrack.getSettings() : {};
      duplexGate.setStrict(applied.echoCancellation !== true);
      if (applied.echoCancellation !== true && !gateStrictAnnounced) {
        gateStrictAnnounced = true;
        toast('this browser is not cancelling echo, so the microphone waits for Auma to finish', 7000);
      }
      if (!isCurrentMicAttempt(attempt) || ctx !== audioContext) {
        releaseMicResources(candidateStream, candidateSrc, candidateNode, candidateTap);
        return { ok: false, cancelled: true };
      }
      candidateTrack = candidateStream.getAudioTracks()[0];
      if (!candidateTrack) {
        const error = new Error('The stream contains no audio track'); error.name = 'NotFoundError'; throw error;
      }
      if (candidateTrack.readyState !== 'live') {
        const error = new Error('The microphone track already ended'); error.name = 'NotReadableError'; throw error;
      }
      candidateSrc = audioContext.createMediaStreamSource(candidateStream);
      candidateNode = new AudioWorkletNode(audioContext, 'alv-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
      candidateTap = audioContext.createGain(); candidateTap.gain.value = 0;
      candidateSrc.connect(candidateNode); candidateNode.connect(candidateTap); candidateTap.connect(audioContext.destination);
      candidateNode.addEventListener('processorerror', onCandidateProcessorError);
      if (audioContext.state === 'suspended' || audioContext.state === 'interrupted') {
        try { await audioContext.resume(); }
        catch {
          const error = new Error('Audio context could not resume'); error.name = 'AudioContextSuspended'; throw error;
        }
      }
      if (!isCurrentMicAttempt(attempt) || ctx !== audioContext) {
        releaseMicResources(candidateStream, candidateSrc, candidateNode, candidateTap);
        return { ok: false, cancelled: true };
      }
      if (candidateTrack.readyState !== 'live' || candidateProcessorFailed) {
        const error = new Error('Microphone capture ended before it became active'); error.name = 'NotReadableError'; throw error;
      }
      if (audioContext.state !== 'running') {
        const error = new Error(`Audio context remained ${audioContext.state}`); error.name = 'AudioContextSuspended'; throw error;
      }
      candidateNode.removeEventListener('processorerror', onCandidateProcessorError);
      micStream = candidateStream; micTrack = candidateTrack; micSrc = candidateSrc; micNode = candidateNode; muteTap = candidateTap;
      committed = true;
      micTrack.addEventListener('ended', onMicTrackEnded);
      micTrack.addEventListener('mute', onMicTrackMute);
      micTrack.addEventListener('unmute', onMicTrackUnmute);
      micNode.addEventListener('processorerror', onMicProcessorError);
      micHeard = false;
      micNode.port.onmessage = (e) => {
        const m = e.data;
        if (micMuted) return;  // muted: don't hear you at all (side conversations stay private)
        if (m.t === 'rms') {
          const rms = Number.isFinite(m.v) ? m.v : 0;
          const lvl = clamp((rms - 0.002) * 12, 0, 1);
          field.micEnv += (lvl - field.micEnv) * 0.4;
          orb.style.setProperty('--alv-mic-glow', `${Math.round(22 + lvl * 28)}px`);
          if (!micHeard && rms > 0.006) {
            micHeard = true;
            clearTimeout(micSignalTimer);
            if (channel) toast('microphone receiving audio');
          }
          if (!duplex) fallbackVadTick(lvl);
        } else if (m.t === 'pcm' && channel && duplex) {
          // HALF DUPLEX. While she is audible — and through the tail after she stops — a captured frame does not
          // reach the recogniser. Only a frame that is loud AND sustained reopens the microphone early, and that
          // is the one case the gate reports as a barge-in. This is the line that used to forward her own voice.
          const verdict = duplexGate.decide(m.pcm, performance.now());
          lastMicRms = verdict.rms;
          if (verdict.forward) {
            voice.sendPCM(m.pcm);
            if (verdict.bargeIn) bargeIn();
          }
        }
      };
      return { ok: true };
    } catch (error) {
      if (committed) stopMic();
      else releaseMicResources(candidateStream, candidateSrc, candidateNode, candidateTap);
      return { ok: false, message: micFailureMessage(error) };
    }
  }

  async function startMicBeforeDeadline(attempt) {
    let timeoutId = 0;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({
        ok: false,
        timedOut: true,
        message: 'microphone permission did not answer — allow access for this app or site, then try again',
      }), MIC_OPEN_TIMEOUT_MS);
    });
    try { return await Promise.race([startMic(attempt), timeout]); }
    finally { clearTimeout(timeoutId); }
  }

  function stopMic() {
    clearTimeout(micSignalTimer); clearTimeout(micMuteTimer); clearTimeout(audioStateTimer);
    if (micTrack) {
      micTrack.removeEventListener('ended', onMicTrackEnded);
      micTrack.removeEventListener('mute', onMicTrackMute);
      micTrack.removeEventListener('unmute', onMicTrackUnmute);
    }
    try { micNode?.removeEventListener('processorerror', onMicProcessorError); } catch { /* partially built node */ }
    releaseMicResources(micStream, micSrc, micNode, muteTap);
    micStream = null; micTrack = null; micSrc = null; micNode = null; muteTap = null; field.micEnv = 0;
    micHeard = false;
    orb.style.removeProperty('--alv-mic-glow');
  }

  // ---- her voice out ----
  function pushPcm(arrayBuf) {
    if (!ctx || !playerNode) return;
    // Keep PCM native until it reaches the audio thread. Per-packet conversion
    // and resampling here reset interpolation at every WebSocket boundary and
    // competed with the field renderer on the UI thread, producing clicks and
    // gaps on 44.1 kHz devices and under render load.
    playerNode.port.postMessage({ cmd: 'push', pcm: arrayBuf }, [arrayBuf]);
  }

  function refreshPlaybackLeases() {
    const now = performance.now();
    if (now - playbackLeaseRefresh < PLAYBACK_LEASE_REFRESH_MS) return;
    playbackLeaseRefresh = now;
    voice.her(true);
    armReplyWatchdog();
  }

  // F3: force the sidecar's "she is speaking" bar down from ANY terminal path,
  // not just the worklet's audible→false tick. That tick never fires if the
  // AudioContext is suspended (tab backgrounded) or the node is torn down — the
  // exact case that used to latch the mic half-deaf. The WebSocket is independent
  // of the audio graph, so this reaches the sidecar even when audio is frozen.
  function dropHer() {
    clearReplyWatchdog();
    playbackLeaseRefresh = Number.NEGATIVE_INFINITY;
    ttsPending = 0;
    ttsRequests.clear();
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
      playerNode?.port.postMessage({ cmd: 'clear' });
      if (!voicePicked) chosenVoice = voice.defaultVoice;   // follow the sidecar's fast default
      populateVoices(); setOrb();
      if (channel) { voice.reset(); stopRecog(); toast('local voice organ online — full duplex'); }
    },
    down() {
      clearReplyWatchdog();
      duplex = false; playerNode?.port.postMessage({ cmd: 'clear' }); dropHer(); setOrb();
      if (channel) {
        if (!micMuted) startRecog();                        // mute survives the transition — private stays private
        announceFallback('local voice organ lost');
      }
      settleIfDone();
    },
    owner_lost() {
      closeChannel();
      toast('voice moved to the newer Auma window');
    },
    vad(m) {
      if (!channel) return;
      // TWO WITNESSES, NOT ONE. The sidecar's VAD says it heard speech; the page's own microphone energy says the
      // speech was LOUD. During her reply the first can be satisfied by her own voice coming back, which is how a
      // barge-in used to be manufactured out of nothing.
      if (m.speaking && (herAudible || streaming) && lastMicRms >= duplexGate.threshold) bargeIn();
    },
    // ONE clean path: the sidecar only sends a `final` once you've actually
    // finished a sentence. No speculation, no half-sentence guesses.
    final(m) {
      if (!channel) return;
      const text = (m.text || '').trim();
      if (!text) return;
      // HER OWN SENTENCE IS NOT A USER TURN. The gate stops her voice reaching the recogniser in the first
      // place; this catches what gets through anyway — a fragment, a room reflection, a timing gap.
      if (isSelfEcho(text, lastSpoken)) {
        duplexGate.selfEchoes = (duplexGate.selfEchoes || 0) + 1;
        return;
      }
      requestTurn(text, true);
    },
    tts_begin(m) {
      const request = ttsRequests.get(Number(m.id));
      if (request) request.started = true;
      playerNode?.port.postMessage({ cmd: 'begin', id: m.id, sampleRate: m.sr }); armReplyWatchdog();
    },
    tts_end(m) {
      const request = ttsRequests.get(Number(m.id));
      ttsRequests.delete(Number(m.id));
      playerNode?.port.postMessage({ cmd: 'end', id: m.id });
      ttsPending = Math.max(0, ttsPending - 1);
      if (request?.failed && ttsPending === 0 && ttsQueueFb === 0 && herAudible) {
        herAudible = false;
        voice.her(false);
      }
      if (herStillAudible()) armReplyWatchdog(); else clearReplyWatchdog();
      settleIfDone();
    },
    tts_cancelled() { clearReplyWatchdog(); dropHer(); },
    pcm(buf) { pushPcm(buf); },
    err(m) {
      if (m.where === 'stt') {
        toast('I heard you, but the local listener could not decode that phrase — say it once more', 7000);
        return;
      }
      if (m.where !== 'tts') return;
      const id = Number(m.id);
      const request = Number.isFinite(id) ? ttsRequests.get(id) : undefined;
      if (request && !request.started && !request.failed) {
        request.failed = true;
        speakFallback(request.text);
        toast('local voice faltered — browser voice recovered this reply', 7000);
        return;
      }
      if (request?.failed) return;
      toast('local voice faltered after playback began — the channel is still open', 7000);
    },
  };
  if (surfaceActive && channel) voice.enable(voiceClaim);
  if (channel && voice.ready) { duplex = true; populateVoices(); }
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
    if (panelOpen) home.start();   // a no-op once the host has answered; otherwise ask now, not at the next backoff
    panel.classList.toggle('show', panelOpen);
    gear.classList.toggle('on', panelOpen);
  }
  gear.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
  panel.addEventListener('click', (e) => e.stopPropagation());

  // ---- transcript log (this device; the copyable record of the channel) ----
  // **THE KEY IS A PURE FUNCTION OF THE SESSION THE TURN WENT THROUGH.** It was fixed at mount from the selection,
  // so every turn that went through her home landed under `unselected` while lane-bridge read the same. Now
  // `bindTranscript` moves this key AND lane-bridge's to the session a turn actually used — the home when the
  // selected thread was not open — and nothing else moves them.
  let logKey = '';
  let logTurns = [];
  const entryKeys = new WeakMap();   // each entry this page recorded -> the transcript key it is stored under
  function bindTranscript(sessionId) {
    boundSessionId = turnSessionId(sessionId, '');
    bindLaneSession(boundSessionId);
    const key = transcriptLogKey(canvasMode, boundSessionId);
    if (key === logKey) return;
    logKey = key;
    try { logTurns = JSON.parse(localStorage.getItem(logKey)) || []; } catch { logTurns = []; }
    renderLog();
  }
  function saveLog() { try { localStorage.setItem(logKey, JSON.stringify(logTurns.slice(-120))); } catch { /* quota */ } }
  function logRow(turn) {
    const row = el('div', 'alv-log-row ' + (turn.role === 'you' ? 'you' : 'auma'));
    const who = el('div', 'alv-log-who'); who.textContent = turn.role === 'you' ? 'you' : 'Auma';
    const txt = el('div', 'alv-log-txt'); txt.textContent = turn.text;
    row.append(who, txt);
    // **THE "WHY?" LINK, AND IT APPEARS ONLY WHEN THERE IS SOMETHING TO OPEN.**
    //
    // `turn.replyId` is set from the `manifested` frame the handler writes after `done` — **so this link names the
    // reply it sits under rather than whichever manifest is newest.** *A link that guessed would attribute one reply's
    // prompt to another, which is the failure the WHY route refuses on its own side.*
    //
    // **AND IT IS NOT DRAWN WHEN THE ID IS ABSENT.** A turn whose record failed has no manifest, **and a control that
    // opens onto nothing is worse than no control — it looks like an answer.**
    if (typeof turn.replyId === 'string' && turn.replyId !== '') {
      const why = el('button', 'alv-log-why');
      why.type = 'button';
      why.textContent = 'why?';
      why.setAttribute('aria-label', 'what this reply was shown');
      why.addEventListener('click', () => {
        // **THE EXISTING CHANNEL, NOT A NEW ONE.** `EmbeddedAppSurface` already listens for messages from this frame
        // and checks BOTH the origin and the source window, **and the shell answers `{source:'aukora-shell'}` on the
        // same channel** — so this is the portal's own way out rather than a second one invented here.
        window.parent.postMessage({ source: 'auma-live', type: 'why', replyId: turn.replyId }, window.location.origin);
      });
      row.append(why);
    }
    return row;
  }
  function renderLog() {
    logBody.innerHTML = '';
    if (!logTurns.length) { logBody.append(logEmpty); return; }
    logTurns.forEach((t) => logBody.append(logRow(t)));
    logBody.scrollTop = logBody.scrollHeight;
  }
  function addTurn(role, text, replyId) {
    const t = String(text || '').trim(); if (!t) return null;
    // **THE ID IS STORED ON THE TURN, NOT HELD BESIDE IT.** The transcript is re-rendered from `logTurns` by
    // `renderLog`, **so an id kept only in a local would survive the first draw and vanish on the next one** — *and a
    // link that disappears when the log redraws is worse than one that was never there.*
    const entry = { role, text: t, ts: Date.now(), ...(typeof replyId === 'string' && replyId !== '' ? { replyId } : {}) };
    entryKeys.set(entry, logKey);
    logTurns.push(entry);
    if (logTurns.length > 120) logTurns = logTurns.slice(-120);
    saveLog();
    announceLaneTurn('voice'); // pulse the chats lane: a spoken turn just landed
    if (logBody.contains(logEmpty)) logBody.removeChild(logEmpty);
    logBody.append(logRow(entry));
    logBody.scrollTop = logBody.scrollHeight;
    return entry;
  }
  /**
   * A turn's own entries move to the transcript of the session it ACTUALLY went through. They are recorded at once
   * under the session the turn would go through then; when the host answers through another one — her home, for a
   * selected thread that was not open, or for a turn that named none — they are taken out of that log and put in
   * the right one. Each entry remembers where it was stored, so a re-bind in between cannot strand it.
   */
  function settleTurnSession(sessionId, entries) {
    const target = transcriptLogKey(canvasMode, sessionId);
    const moving = entries.filter((entry) => entry && entryKeys.has(entry) && entryKeys.get(entry) !== target);
    for (const entry of moving) dropStoredTurn(entryKeys.get(entry), entry);
    bindTranscript(sessionId);
    if (moving.length === 0) return;
    for (const entry of moving) entryKeys.set(entry, target);
    logTurns = [...logTurns, ...moving].slice(-120);
    saveLog();
    renderLog();
  }
  function dropStoredTurn(key, entry) {
    if (key === logKey) { logTurns = logTurns.filter((turn) => turn !== entry); saveLog(); return; }
    try {
      const stored = JSON.parse(localStorage.getItem(key)) || [];
      const kept = stored.filter((turn) => !(turn && turn.role === entry.role && turn.text === entry.text && turn.ts === entry.ts));
      localStorage.setItem(key, JSON.stringify(kept));
    } catch { /* storage unavailable: the entry stays where it was */ }
  }
  // Before any turn, the transcript is the one the next turn would go through; the home's arrival re-binds it.
  bindTranscript(turnSessionNow());
  // **A CLICK IN THE SIDEBAR MOVES THE TRANSCRIPT AT ONCE, NOT AT THE NEXT TURN.** The session runtime writes the
  // selection cell from the parent document on this origin, and a `storage` event reaches this window for it. Before
  // this the transcript and lane-bridge's peek kept showing the previous thread until Peter spoke. A turn in flight
  // is left alone: it settles its own transcript when the host names the session it went through.
  const onSelectionStored = (event) => {
    if (event.key !== null && event.key !== SELECTION_KEY) return;
    if (!streaming) bindTranscript(turnSessionNow());
  };
  window.addEventListener('storage', onSelectionStored);
  // **SHE ASKS FOR HER HOME NOW, WHEN AUMA LIVE OPENS** — not when the gear does. Retries are bounded; adoption does
  // not depend on the roster; a turn spoken before the answer waits for it.
  home.start();

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
  let fbVoices = [], fbChosen = null, fbKeep = 0;
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
      u.onboundary = () => { field.sayEnv = Math.min(1, field.sayEnv + 0.5); refreshPlaybackLeases(); };
      ttsQueueFb++;
      u.onstart = () => { fbKeepAlive(); refreshPlaybackLeases(); };
      u.onend = u.onerror = () => {
        ttsQueueFb = Math.max(0, ttsQueueFb - 1);
        if (!ttsQueueFb) clearInterval(fbKeep);
        if (ttsPending === 0 && ttsQueueFb === 0 && herAudible) {
          herAudible = false;
          voice.her(false);
        }
        if (herStillAudible()) armReplyWatchdog(); else clearReplyWatchdog();
        settleIfDone();
      };
      window.speechSynthesis.speak(u);
    } catch { ttsQueueFb = Math.max(0, ttsQueueFb - 1); }
  }
  function stopBrowserVoice() { try { window.speechSynthesis.cancel(); } catch { /* */ } clearInterval(fbKeep); ttsQueueFb = 0; }

  // fallback STT — the path every node lives on when the local sidecar is unavailable.
  // REWORKED: turns now fire from the recognizer's OWN final results (debounced),
  // not from a 950ms mic-RMS silence timer. The old race — the timer grabbing
  // `heard` before the recognizer had delivered the final — was exactly why the
  // channel opened but she never answered on Windows. Errors are now honest:
  // blocked/unavailable recognition says so on the surface and leaves typing +
  // her voice out fully alive, instead of dying silently.
  let recog = null, recogEpoch = 0, recogOn = false, recogDead = false, heard = '';
  let sendTimer = 0, restartTimer = 0, netErrs = 0;
  // **THE BROWSER RECOGNISER STREAMS RAW MICROPHONE AUDIO TO GOOGLE OR APPLE, AND IT IS NOW OFF BY DEFAULT.**
  // `SpeechRecognition` is not a local API in Chrome or Safari: the audio leaves the device and is transcribed by the
  // vendor. **It is also the SILENT fallback** — a fresh download has no sidecar, and a sidecar that drops mid-session
  // silently switches to this path, so Peter's microphone can start streaming to a third party without anything
  // changing on screen.
  //
  // **THIS FILE IS THE RUNTIME COPY AND IS THE ONE THAT ACTUALLY RUNS.** The same fix in `source/app/aumalive.js`
  // protects nothing on its own — **the two are separate builds, and a privacy fix applied to one of two copies is a
  // privacy fix that does not ship.** This goal has now found that shape four times.
  // **THE TOGGLE IS EXPLICIT AND DELIBERATELY NOT PERSISTED.** `window.AUMA_LIVE_ALLOW_CLOUD_VOICE` must be set to
  // exactly `true` before this script loads. **It is not read from browser storage on purpose**: a preference that
  // survives a reload is a privacy decision made once and forgotten, and the whole reason this path is off is that a
  // dropped sidecar used to switch it on silently. **A choice that must be re-made each session is a choice.**
  const SR = (window.AUMA_LIVE_ALLOW_CLOUD_VOICE === true)
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : undefined;
  function recogFail(msg) {
    stopRecog();
    recogDead = true;
    toast(msg);
    toggleLog(true);                                                     // typing is the honest path now — put it in reach
  }
  function scheduleSend(stillForming) {
    clearTimeout(sendTimer);
    if (!heard.trim()) return;
    // finals settled → send soon; words still forming → give the recognizer room
    sendTimer = setTimeout(() => {
      const say = heard.trim(); heard = '';
      if (channel && !duplex && !micMuted && say) requestTurn(say, true);      // !duplex: a stale final must not race the sidecar
    }, stillForming ? 1500 : 600);
  }
  function startRecog() {
    if (!SR || recogOn || duplex || recogDead || micMuted) return;
    const instance = new SR();
    const epoch = ++recogEpoch;
    recog = instance; instance.lang = 'en-US'; instance.continuous = true; instance.interimResults = true;
    const isCurrent = () => recog === instance && recogEpoch === epoch;
    instance.onresult = (ev) => {
      if (!isCurrent()) return;
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
    instance.onerror = (e) => {
      if (!isCurrent()) return;
      const kind = e && e.error;
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        recogFail('voice recognition blocked by the browser — type to her below; she still speaks');
      } else if (kind === 'network' && ++netErrs >= 3) {
        recogFail('voice recognition unavailable in this browser — type to her; she still speaks');
      }
      // 'no-speech' / 'aborted' are normal breathing — onend restarts
    };
    instance.onend = () => {
      if (!isCurrent() || !recogOn || recogDead) return;
      // healthy sessions restart at once (Chrome ends continuous recognition
      // routinely — a delay here is a deaf window); only back off after errors
      clearTimeout(restartTimer);
      if (netErrs === 0) { try { instance.start(); return; } catch { /* fall through to the timer */ } }
      restartTimer = setTimeout(() => {
        if (!isCurrent()) return;
        try { instance.start(); }
        catch { recogFail('voice recognition stopped — close and reopen the channel to try again; typing still works'); }
      }, 300);
    };
    try { instance.start(); recogOn = true; } catch { recogFail('voice recognition failed to start — type to her; she still speaks'); }
  }
  function stopRecog() {
    const retiring = recog;
    recogEpoch += 1;
    recogOn = false;
    clearTimeout(sendTimer); clearTimeout(restartTimer);
    try { retiring?.stop(); } catch { /* */ }
    recog = null; heard = '';
  }
  function fallbackVadTick(lvl) {
    // RMS is now only the fast barge-in trigger; the recognizer owns the turns.
    if (!channel || duplex || micMuted) return;
    if (lvl > 0.16 && (streaming || herStillAudible())) bargeIn();
  }

  // ---- turns (one clean streaming turn — no speculation, no filler) ----
  let pendingTurn = null;
  let pendingEntries = [];
  let pendingSpoken = true;
  let canvasRequestSerial = 0;

  function requestTurn(text, spoken = false) {
    text = String(text || '').trim();
    if (!text) { if (streaming || herStillAudible()) bargeIn(); return; }
    // Recorded at once, in the transcript of the session this turn would go through NOW (a turn in flight keeps
    // its own); `settleTurnSession` moves it if the host answered through another one.
    if (!streaming) bindTranscript(turnSessionNow());
    const said = addTurn('you', text);   // record what you said (STT or typed) in the transcript
    if (streaming) {
      if (canvasMode && canvasRequestId) {
        bargeIn();
        field.burst = 1;
        window.parent.postMessage({
          source: 'auma-canvas',
          type: 'prompt',
          requestId: canvasRequestId,
          sessionId: turnSessionNow(),
          text,
        }, location.origin);
        return;
      }
      // two requests can land in the abort-propagation gap (typed + the STT
      // debounce): JOIN them — a logged turn must never silently vanish
      pendingSpoken = pendingTurn ? pendingSpoken && spoken : spoken;
      pendingTurn = pendingTurn ? pendingTurn + '\n' + text : text;
      if (said) pendingEntries.push(said);
      bargeIn();
      return;
    }
    if (herStillAudible()) bargeIn();
    transmit(text, said ? [said] : [], spoken);
  }

  function speakChunk(text, first) {
    const t = sanitizeForVoice(text); if (!t) return;   // never let the TTS read markdown symbols aloud
    // WHAT SHE IS ABOUT TO SAY, so the recogniser cannot hand it back as a user turn.
    lastSpoken = t;
    if (duplex) {
      const id = ++ttsId;
      ttsPending++;
      ttsRequests.set(id, { text: t, started: false });
      if (!herAudible) { herAudible = true; voice.her(true); }
      if (!voice.say(id, t, chosenVoice, 1.0, first)) {
        ttsRequests.delete(id);
        ttsPending = Math.max(0, ttsPending - 1);
        if (ttsPending === 0 && herAudible) { herAudible = false; voice.her(false); }
        speakFallback(t);
        toast('local voice link paused — browser voice recovered this reply', 7000);
      }
    } else speakFallback(t);
    armReplyWatchdog();
  }

  function voiceChunks(text, limit = 360) {
    const chunks = [];
    let remaining = sanitizeForVoice(text);
    while (remaining.length > limit) {
      const windowText = remaining.slice(0, limit + 1);
      let cut = Math.max(
        windowText.lastIndexOf('. '),
        windowText.lastIndexOf('? '),
        windowText.lastIndexOf('! '),
        windowText.lastIndexOf('; '),
      );
      if (cut >= Math.floor(limit * 0.55)) cut += 1;
      else {
        cut = windowText.lastIndexOf(' ');
        if (cut < Math.floor(limit * 0.55)) cut = limit;
      }
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function speakVoiceText(text) {
    voiceChunks(text).forEach((chunk, index) => speakChunk(chunk, index === 0));
  }

  async function transmit(text, entries = [], spoken = false) {
    if (!canvasMode && voiceSession !== null && voiceSession.expiresAt <= Date.now()) {
      expireVoiceSession(voiceSession.voiceSessionToken);
      return;
    }
    if (streaming) return;
    streaming = true;
    clearReplyWatchdog();

    if (canvasMode) {
      if (window.parent === window) {
        toast('Open Auma Canvas inside Aukora so it can reach the selected Agent.', 7000);
        endTurn();
        return;
      }
      field.burst = 1;
      field.alien('[field teal energy=0.24 storm=0.04 form=flow]');
      setMode(channel ? 'listening' : 'idle');
      await ensureAudio();
      // A turn spoken before her home has arrived waits for it, briefly, rather than naming no session.
      if (!turnSessionNow()) await home.waitForHome(HOME_WAIT_MS);
      if (closed) { streaming = false; return; }
      settleTurnSession(turnSessionNow(), entries);
      canvasRequestSerial += 1;
      canvasRequestId = `${Date.now().toString(36)}-${canvasRequestSerial.toString(36)}`;
      announcedAgentWait = '';
      window.parent.postMessage({
        source: 'auma-canvas',
        type: 'prompt',
        requestId: canvasRequestId,
        sessionId: turnSessionNow(),
        text,
      }, location.origin);
      return;
    }

    presenceBlocked = false;
    field.burst = 1; field.think = 1; setMode('thinking');
    await ensureAudio();

    const failTurn = (message) => {
      const clean = sanitizeForVoice(message);
      if (!clean) return;
      addTurn('auma', clean);
      speakVoiceText(clean);
    };
    // **THE SESSION THIS TURN GOES THROUGH, RESOLVED ONCE, NOW.** The live selection, else her home — so a changed
    // selection is followed, never refused. A turn spoken before the home has arrived WAITS for it, bounded.
    let turnSession = turnSessionNow();
    if (!turnSession) turnSession = turnSessionId(selectedSessionId(), await home.waitForHome(HOME_WAIT_MS));
    if (closed) { streaming = false; return; }
    if (!turnSession && home.answered) {
      // THE ONE REFUSAL LEFT, AND IT IS A FACT ABOUT THE DEPLOYMENT: the host answered and named no home, and
      // nothing is selected. It is said only when the host has actually said so.
      failTurn('There is no session for me to answer through: nothing is selected, and no home session is '
        + 'configured for Auma Live.');
      endTurn();
      return;
    }
    if (spoken && voiceSession) {
      if (turnSession !== voiceSession.requestedSession && turnSession !== voiceSession.sessionId) {
        failTurn('Stop Voice and Start Voice again to authorize the newly selected session.');
        endTurn();
        return;
      }
      turnSession = voiceSession.sessionId;
    }
    // Not answered yet: the turn goes to the host naming no session, and the host answers through its configured
    // home or refuses by name. She neither guesses a session nor claims a configuration she has not seen.

    const abortCtl = new AbortController(); curAbort = abortCtl;
    let presenceTimer = 0;
    let presenceTimedOut = false;
    const clearPresenceTimer = () => { clearTimeout(presenceTimer); presenceTimer = 0; };
    const armPresenceTimer = (delay) => {
      clearPresenceTimer();
      presenceTimer = setTimeout(() => {
        presenceTimer = 0;
        presenceTimedOut = true;
        abortCtl.abort();
      }, delay);
    };
    armPresenceTimer(PRESENCE_FIRST_EVENT_TIMEOUT_MS);

    let full = '', sentTo = 0, firstFlush = true, spoke = false, doneReason = '';
    // **THE REPLY ID OF THE TURN THAT JUST FINISHED**, set from the `manifested` frame the handler writes
    // after `done`. Empty until a turn completes, and the "why?" link is drawn only when it is not.
    let lastReplyId = '';
    // her hands on the field: [field …] tags stream out of the text here, applied
    // live and never spoken/printed. Works on both the sidecar and fallback paths.
    const dirs = makeDirectiveFilter((tag) => field.alien(tag));
    // The local engine streams whole sentences. Browser speech synthesis gets
    // one complete utterance at end-of-turn because separate utterance objects
    // insert platform-owned pauses that sound like broken audio.
    const flushSpeech = (endOfTurn) => {
      const tail = full.slice(sentTo);
      if (!tail) return;
      if (!duplex && !endOfTurn) return;
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
      const res = await fetch(PRESENCE_ENDPOINT, {
        method: 'POST', signal: abortCtl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: turnSession, text, mind: chosenMind,
          ...(spoken && channel && voiceSession ? { voiceSessionToken: voiceSession.voiceSessionToken } : {}) }),
      });
      const contentType = res.headers.get('content-type') || '';
      // **THE TRANSCRIPT FOLLOWS THE SESSION THE TURN ACTUALLY WENT THROUGH**, which the host names: her home when
      // the selected thread was not open. This turn's entries move with it, and lane-bridge's key with them.
      const wentThrough = headerSessionId(res.headers, SESSION_HEADER) || turnSession;
      settleTurnSession(wentThrough, entries);
      if (!res.ok || !res.body || !contentType.toLowerCase().startsWith('text/event-stream')) {
        clearPresenceTimer();
        // The host names why it refused; every sentence here is true for that reason, and none of them sends
        // Peter off to pick something.
        failTurn(refusalSentence(res.headers.get(REFUSAL_HEADER) || '', home.id, turnSession));
        endTurn();
        return;
      }
      // ONE SHORT, TRUE SENTENCE, and only when it is true: this turn named a thread, the host fell back from THAT
      // thread, and the answer came through another session. Never on an ordinary turn or a fresh start.
      const fellBack = fallbackSentence(turnSession, wentThrough, headerSessionId(res.headers, FALLBACK_HEADER));
      if (fellBack) toast(fellBack, 7000);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', terminal = false;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) {
          const m = p.match(/^data:\s*(.*)$/m); if (!m) continue;
          let ev; try { ev = JSON.parse(m[1]); } catch { continue; }
          armPresenceTimer(PRESENCE_IDLE_TIMEOUT_MS);
          if (ev.t === 'tok') {
            full += dirs.push(ev.v);
            if (!spoke && full.trim()) { spoke = true; setMode('speaking'); field.think = 0.4; }
            field.sayEnv = Math.min(1, field.sayEnv + 0.1);
            flushSpeech(false);
          } else if (ev.t === 'field') {
            // the door splits her body-language tags into typed events now;
            // the local dirs filter stays as defense in depth for older doors
            field.alien(ev.v);
          } else if (ev.t === 'done') {
            doneReason = typeof ev.reason === 'string' ? ev.reason : 'done';
            terminal = true;
            // **`done` MEANS THE REPLY IS COMPLETE, NOT THAT THE STREAM IS OVER — AND THE DIFFERENCE IS ONE FRAME.**
            //
            // This used to break here and then cancel the reader, **which threw away everything written after `done`.
            // The turn's own reply id is one of those things:** `done` is written by the ENGINE, inside `stream()`,
            // and the id does not exist until `recordOrRefuse`'s callback has run — so the handler writes
            // `{t:'manifested', replyId}` after `stream()` resolves, and this break cancelled the reader before it
            // arrived. **The frame was shipping and unreadable, and nothing failed: the reply simply had no id, so no
            // "why?" link could ever be attached to it.**
            //
            // **THE STREAM DECIDES WHEN THE STREAM IS OVER.** The loop now runs until the server ends the response,
            // which the handler does in its `finally`. `terminal` is kept because it marks the reply as complete —
            // it just no longer means "stop listening".
          } else if (ev.t === 'manifested') {
            // **THE REPLY'S OWN ID, DELIVERED WITH THE REPLY.** Read after `done` by design: it names the turn that
            // just finished, so it is keyed to THIS reply rather than to whichever manifest happens to be newest —
            // the mis-attribution the WHY route refuses on its own side.
            if (typeof ev.replyId === 'string' && ev.replyId !== '') lastReplyId = ev.replyId;
          }
        }
      }
      clearPresenceTimer();
      full += dirs.flush();
      if (doneReason === 'provider-consent-required') {
        providerState.textContent = 'Provider requests are off until Start Voice authorizes this session.';
        toast('Provider requests are off. Use Start Voice to authorize this session.', 7000);
      }
      if (doneReason === 'provider-consent-required' || doneReason === 'disclosure-refused') {
        presenceBlocked = true;
        endTurn();
        setOrb();
        return;
      }
      if (!full.trim()) {
        const message = doneReason === 'record-failed'
          ? 'This turn could not be secured in its thread, so I did not send it.'
          : 'I heard you, but my thinking channel returned no words. Say it once more.';
        failTurn(message);
        endTurn();
        return;
      }
      flushSpeech(true);
      if (full.trim()) addTurn('auma', sanitizeForVoice(full), lastReplyId);   // record her reply, with the id the why link needs
      endTurn();
    } catch (e) {
      clearPresenceTimer();
      if (presenceTimedOut) {
        failTurn('My thinking channel went quiet before the answer arrived. I reset it — say that once more.');
        endTurn();
        return;
      }
      if (abortCtl.signal.aborted) { if (full.trim()) addTurn('auma', sanitizeForVoice(full)); endTurn('cut'); return; }
      failTurn('The channel flickered — I lost my thread. Say it again?'); endTurn();
    }
  }

  function herStillAudible() { return herAudible || ttsPending > 0 || ttsQueueFb > 0; }

  function settleIfDone() {
    if (closed) return;
    if (streaming) {
      if (canvasMode && !herStillAudible()) setMode('thinking');
      return;
    }
    if (!herStillAudible()) setMode(channel ? 'listening' : 'idle');
  }

  function endTurn(how) {
    clearReplyWatchdog();
    streaming = false; curAbort = null; field.think = 0;
    if (canvasMode) {
      canvasRequestId = '';
      announcedAgentWait = '';
      field.alien('[field reset]');
    }
    if (pendingTurn) {
      const p = pendingTurn, e = pendingEntries, spoken = pendingSpoken;
      pendingTurn = null; pendingEntries = []; pendingSpoken = true;
      transmit(p, e, spoken);
      return;
    }
    if (how === 'cut') { cutHerVoice(); settleIfDone(); return; }
    if (herStillAudible()) setMode('speaking');
    else settleIfDone();
    armReplyWatchdog();
  }

  function bargeIn() {
    clearReplyWatchdog();
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
  function expireVoiceSession(token) {
    if (voiceSession === null || token !== voiceSession.voiceSessionToken) return;
    const remaining = voiceSession.expiresAt - Date.now();
    if (remaining > 0) {
      clearTimeout(voiceExpiryTimer);
      voiceExpiryTimer = setTimeout(() => expireVoiceSession(token), remaining);
      return;
    }
    closeChannel();
    voiceExpired = true;
    presenceBlocked = true;
    providerState.textContent = 'Voice session expired after one hour. Start Voice to continue.';
    toast(providerState.textContent, 7000);
    setOrb();
  }
  function revokeVoiceSession(token) {
    if (!token || canvasMode) return;
    void fetch(PRESENCE_ENDPOINT, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop-voice', voiceSessionToken: token }),
    }).catch(() => {}); // Local grant also expires; no retry can restart Voice.
  }
  async function authorizeStartVoice(attempt) {
    if (canvasMode) return true;
    let requestedSession = turnSessionNow();
    if (!requestedSession) requestedSession = turnSessionId(selectedSessionId(), await home.waitForHome(HOME_WAIT_MS));
    if (!isCurrentMicAttempt(attempt)) return false;
    const controller = new AbortController(); voiceStartAbort = controller;
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(PRESENCE_ENDPOINT, { method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start-voice', sessionId: requestedSession,
          recipient: 'openrouter.ai', classes: ['turn-text', 'history'] }),
      });
      const grant = await response.json();
      if (!response.ok || typeof grant.voiceSessionToken !== 'string' || !/^[0-9a-f]{48}$/.test(grant.voiceSessionToken)
          || typeof grant.sessionId !== 'string' || !grant.sessionId || grant.recipient !== 'openrouter.ai'
          || JSON.stringify(grant.classes) !== '["turn-text","history"]' || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= Date.now()) {
        toast('Voice could not be authorized: check the session and disclosure policy.', 7000);
        return false;
      }
      if (!isCurrentMicAttempt(attempt)) { revokeVoiceSession(grant.voiceSessionToken); return false; }
      voiceSession = { ...grant, requestedSession, attempt };
      voiceExpired = false;
      presenceBlocked = false;
      clearTimeout(voiceExpiryTimer);
      voiceExpiryTimer = setTimeout(() => expireVoiceSession(grant.voiceSessionToken), Math.max(0, grant.expiresAt - Date.now()));
      providerState.textContent = 'Start Voice authorized spoken text and history to OpenRouter for this session. Stop Voice ends this authorization.';
      return true;
    } catch {
      if (isCurrentMicAttempt(attempt)) toast('Voice authorization did not finish. Use Start Voice to try again.', 7000);
      return false;
    } finally {
      clearTimeout(timer);
      if (voiceStartAbort === controller) voiceStartAbort = null;
    }
  }

  async function openChannel() {
    if (channel || channelOpeningAttempt !== 0) return;
    const attempt = ++micAttempt;
    channelOpeningAttempt = attempt;
    try {
      toast('requesting microphone access…', 12_000);
      const result = await startMicBeforeDeadline(attempt);
      if (result.timedOut) {
        if (isCurrentMicAttempt(attempt)) micAttempt += 1;
        orb.classList.add('blocked');
        setTimeout(() => orb.classList.remove('blocked'), 2400);
        toast(result.message, 7000);
        return;
      }
      if (result.cancelled || !isCurrentMicAttempt(attempt)) return;
      if (!result.ok) {
        orb.classList.add('blocked');
        setTimeout(() => orb.classList.remove('blocked'), 2400);
        toast(result.message, 7000);
        return;
      }
      if (!micStream || micTrack?.readyState !== 'live' || ctx?.state !== 'running') {
        toast('microphone stopped before the channel opened — try again', 7000);
        return;
      }
      if (!await authorizeStartVoice(attempt) || !isCurrentMicAttempt(attempt)) return;
      const owner = createVoiceClaim(attempt);
      if (!owner) return;
      channel = true;
      voice.enable(owner);
      if (duplex) {
        voice.reset();
        toast('microphone active — local full duplex ready');
      }
      else {
        recogDead = false; netErrs = 0;    // opening the channel is a fresh chance — a flaky network must not deafen her forever
        if (!micMuted) startRecog();
        if (!SR) toast('microphone active, but speech recognition is unavailable — type to her below');
        else toast('microphone active — browser voice recognition ready');
      }
      setMode('listening');
      field.burst = 1;
      beginMicSignalWatch();
    } finally {
      if (!channel && channelOpeningAttempt === attempt) {
        if (voiceSession?.attempt === attempt) { clearTimeout(voiceExpiryTimer); voiceExpiryTimer = 0; revokeVoiceSession(voiceSession.voiceSessionToken); voiceSession = null; }
        releaseVoiceOwnership();
        stopMic();
        voice.disconnect();
        duplex = false;
        setOrb();
      }
      if (channelOpeningAttempt === attempt) channelOpeningAttempt = 0;
    }
  }
  function closeChannel() {
    clearTimeout(voiceExpiryTimer); voiceExpiryTimer = 0;
    voiceExpired = false;
    presenceBlocked = false;
    voiceStartAbort?.abort(); voiceStartAbort = null;
    if (voiceSession) revokeVoiceSession(voiceSession.voiceSessionToken);
    voiceSession = null;
    if (!canvasMode) providerState.textContent = 'Provider requests are off until Start Voice authorizes this session.';
    releaseVoiceOwnership();
    micAttempt += 1;
    channelOpeningAttempt = 0;
    channel = false;
    pendingTurn = null;
    pendingEntries = [];   // their entries stay in the transcript: a logged turn never silently vanishes
    stopRecog(); stopMic(); bargeIn();
    voice.disconnect();
    duplex = false;
    ttsPending = 0;
    playerNode?.port.postMessage({ cmd: 'clear' });
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
      clearTimeout(micSignalTimer);
      field.micEnv = 0;                 // stop the field showing your voice
      if (duplex) voice.reset();        // drop any half-heard phrase so it never fires
      else stopRecog();                 // fallback path: stop the recognizer too
    } else if (channel && !duplex) {
      micHeard = false;
      startRecog();                     // fallback: resume recognizing
      beginMicSignalWatch();
    } else if (channel) {
      micHeard = false;
      beginMicSignalWatch();
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
  const onVis = () => {
    if (document.hidden) dropHer();
    else if (channel) onAudioStateChange();
  };
  document.addEventListener('visibilitychange', onVis);
  activeCleanup = () => {
    closed = true;
    home.stop();
    canvasSceneDisposed = true;
    for (const timer of canvasSceneTimers) clearTimeout(timer);
    canvasSceneTimers.clear();
    canvasScene?.replaceChildren();
    canvasSceneFrame = null;
    canvasPendingFrame = null;
    window.removeEventListener('beforeunload', unload);
    window.removeEventListener('message', onShellMessage);
    window.removeEventListener('storage', onSelectionStored);
    document.removeEventListener('visibilitychange', onVis);
    stopLaneTurns();
    dropHer();
    closeChannel();
    clearTimeout(statusTimer);
    clearReplyWatchdog();
    field.destroy();                     // stop the rAF loop, release observers + the GL context
    try { playerNode?.disconnect(); } catch { /* partially built node */ }
    playerNode = null;
    const closingContext = ctx; ctx = null;
    closingContext?.removeEventListener('statechange', onAudioStateChange);
    try { void closingContext?.close(); } catch { /* already closed */ }
    voice.on = {};
    voice.disconnect();
  };
  return activeCleanup;
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const css = `
  .alv-app { position:absolute; inset:0; overflow:hidden; color:var(--text);
    background:radial-gradient(120% 130% at 50% 45%, rgba(var(--hue-c),0.05), transparent 62%), #111520; }
  .alv-canvas { position:absolute; inset:0; width:100%; height:100%; }
  .alv-aura-trace { position:absolute; inset:0; width:100%; height:100%; pointer-events:none;
    mix-blend-mode:screen; opacity:0.92;
    filter:blur(0.2px) drop-shadow(0 0 14px rgba(var(--hue-c),0.16));
    -webkit-mask-image:radial-gradient(ellipse 62% 58% at 50% 45%, #000 0 54%, rgba(0,0,0,0.72) 72%, transparent 100%);
    mask-image:radial-gradient(ellipse 62% 58% at 50% 45%, #000 0 54%, rgba(0,0,0,0.72) 72%, transparent 100%); }
  .alv-scan { position:absolute; inset:0; pointer-events:none; opacity:0.3;
    background:repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,0,0,0.1) 3px 4px); }
  .alv-vignette { position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(120% 120% at 50% 46%, transparent 58%, rgba(10,13,22,0.5) 100%); }

  .alv-canvas-scene { position:absolute; inset:0; z-index:4; overflow:hidden; opacity:0; pointer-events:none;
    transition:opacity 0.42s ease; }
  .alv-canvas-scene.has-document { opacity:1; pointer-events:auto; }
  .alv-canvas-document { position:absolute; inset:0; display:block; width:100%; height:100%; border:0; color-scheme:dark;
    background:transparent; opacity:0; transform:scale(1.006); transform-origin:center;
    transition:opacity 0.42s ease, transform 0.58s var(--ease); }
  .alv-canvas-document.active { opacity:1; transform:scale(1); }
  .alv-canvas-document.leaving { opacity:0; transform:scale(0.997); pointer-events:none; }

  .alv-voice-disclosure { position:absolute; left:50%; bottom:106px; transform:translateX(-50%); z-index:4; width:min(540px,calc(100% - 40px)); text-align:center; }
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
  .alv-orb.live .alv-orb-ring { border-color:rgba(var(--hue-l),0.85); box-shadow:0 0 var(--alv-mic-glow,22px) rgba(var(--hue-l),0.35); }
  .alv-orb.live .alv-orb-core { inset:16px; background:rgba(var(--hue-l),0.95); box-shadow:0 0 26px rgba(var(--hue-l),0.8); animation:alvBreath 2.8s ease-in-out infinite; }
  .alv-orb.live.thinking .alv-orb-core { background:rgba(var(--hue-l),1); animation:alvThink 0.9s ease-in-out infinite; }
  .alv-orb.live.speaking .alv-orb-core { background:rgba(var(--hue-r),0.95); box-shadow:0 0 30px rgba(var(--hue-r),0.8); animation:alvBreath 1.6s ease-in-out infinite; }
  .alv-orb.live.speaking .alv-orb-ring { border-color:rgba(var(--hue-r),0.85); }
  .alv-orb.fb .alv-orb-ring { border-style:dashed; border-color:rgba(255,196,140,0.55); }
  .alv-orb.blocked .alv-orb-ring, .alv-orb.presence-blocked .alv-orb-ring { border-color:rgba(255,120,120,0.9); animation:alvBlocked 0.5s ease-in-out 3; }

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

  @media (prefers-reduced-motion: reduce) {
    .alv-aura-trace { filter:none; }
    .alv-canvas-scene, .alv-canvas-document { transition:none; }
  }

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
