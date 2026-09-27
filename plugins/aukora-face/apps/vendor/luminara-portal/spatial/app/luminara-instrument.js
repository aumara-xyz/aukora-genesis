// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA INSTRUMENT: the engine, disassembled from the Sounding page at
// the architect's word (2026-07-26) and reassembled as the spine of a
// modular interface. Everything that decides WHAT SOUNDS lives here, and
// nothing that decides how it looks: no DOM, no canvas, no element. The
// stages plug in through one contract, the page is assembly, and the
// engine takes pins for the first time (core/tests/luminaraInstrument).
//
// THE CONTRACT (a stage is any object; every method optional):
//   spectrum(modes)  the superposed air, weighted by each strike's envelope
//   gain(g)          the bow's pressure: 1 while anything rings, 0 at rest
//   strike(n, spec)  one card was struck (after the voice is confirmed)
//   rest()           the Seed was played: the phrase ended
//
// THE NOTICES (one listener, page-side): 'touch' n (any key, before the
// voice), 'struck' n (a voiced strike landed), 'rest' n, 'lines' (the
// ringing changed), 'cycle' (the bar changed).
//
// THE LAWS CARRIED OVER WHOLE: the Seed is the rest in every mode; the
// crowd cap of five; IN CONCORD answers all but the Seed and never inside
// the cycle; three loops at most, one shared bar of 2.4 s; scheduling
// rides the audio clock with a lookahead, never a display timer.

import { knotOf, counterOf, becomingOf } from './luminara-canon.js';
import { spectrumOf } from './luminara-cymatics.js';
import { voiceOf, beatRateOf, GROUND_HZ, BEAT_DEPTH } from './luminara-sound.js';

export const BAR = 2.4;      // seconds: one closing of the strand
export const SETTLE_S = 4;   // the hold that becomes a settling: the cadence's own pace
export const MORPH_S = 1.6;  // the glide across it: the figure breathing over, not cutting

// THE VOICES: a tone law with the ring, beat and room that suit it. The law
// is derived; this dress is chosen, and named as chosen. Struck things ring
// short and shimmer; consonant things are given time; the choral law sits
// nearer the centre of the room because a chorus is not scattered.
export const VOICES = {
  plate:       { tone: 'plate',       ring: 1.6, beat: 0.0045, room: 1 },
  interval:    { tone: 'interval',    ring: 2.6, beat: 0.0030, room: 1 },
  ladder:      { tone: 'ladder',      ring: 3.4, beat: 0.0020, room: 0.7 },
  twentyseven: { tone: 'twentyseven', ring: 1.2, beat: 0.0080, room: 1 },
};

export function createInstrument({ sounder, defer } = {}) {
  if (!sounder) throw new Error('the instrument needs a sounder');
  // the default re-composition pacing: a display frame then a breath; tests
  // inject their own defer (or none) and drive recompose by hand
  const later = defer || ((fn, ms) => {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => setTimeout(fn, ms));
    else setTimeout(fn, ms);
  });

  const ringing = [];        // { n, spec, voice, t0, dur }
  const loops = new Map();   // n → { spec, ticks, metal-free: p, aq }
  const stages = [];
  let path = 'A', mode = 'strike', concord = false;
  let sustain = 1.6;         // the bow's hold: RING SHORT; the held bench doubles it
  // THE TUNING: the dials that are honestly dials. The ground is the one
  // free constant the module always named as such; the room scales the
  // count's own placement without inventing a placement; the beat is how
  // far the counter-rotating twin is removed; the houses switch decides
  // whether the first digit chooses the wave or every card rings pure, so
  // the derivation can be heard against its own absence.
  const tuning = { ground: GROUND_HZ, room: 1, beat: BEAT_DEPTH, houses: true, tone: 'plate' };
  // one door: every voice the instrument sounds passes through here
  const voiceFor = (spec) => {
    const v = voiceOf(spec, tuning.ground, tuning.tone);
    if (!v.struck) return v;
    return { ...v,
      pan: v.pan * tuning.room,
      detune: tuning.beat,
      wave: tuning.houses ? v.wave : 'sine',
      level: tuning.houses ? v.level : 1 };
  };
  let notify = () => {};
  let barZero = 0, schedTimer = 0, lastSched = 0;

  const each = (m, ...a) => { for (const s of stages) if (typeof s[m] === 'function') s[m](...a); };
  // a held voice stands at full envelope until the finger lifts; then it
  // decays from the moment of release like any strike from its own t0
  const envOf = (e, now) => {
    if (e.held) return 1;
    const dt = now - e.t0;
    return dt < 0 ? 1 : Math.max(0, 1 - dt / e.dur);
  };
  function liveCoherence() {
    if (!ringing.length) return 0.85;
    let s = 0; for (const e of ringing) s += e.spec.clarity;
    return s / ringing.length;
  }

  // THE SETTLING (2026-07-26): a voice held past SETTLE_S begins its own
  // cadence: the tone crossfades into its becoming (the old voice released
  // to ring out, the becoming's voice held in its place), the figure
  // follows because figure and tone are one spectrum, and the chain walks
  // on at the same pace until a settled card stands, or until the becoming
  // is the Seed and the voice comes home to silence: the cadence played by
  // doing nothing but holding.
  function settleStep(e, now) {
    const oldN = e.n;
    const bec = becomingOf(e.n);
    if (bec === null) { e.settledAt = Infinity; return; }   // settled: it stands
    const spec2 = spectrumOf(bec, path);
    const v2 = voiceFor(spec2);
    e.releaseFn?.();                       // the old voice rings out at its own decay
    if (!v2.struck) {
      // the cadence home: the becoming is silence, and the hold ends itself
      e.releaseFn = null;
      e.held = false;
      e.t0 = now; e.dur = e.voice.decay;
      return;
    }
    const h2 = sounder.hold(v2);
    if (!h2) return;
    // the figure glides rather than cuts: the outgoing spectrum is kept and
    // blended out across MORPH_S while the incoming blends in, which is the
    // same crossfade the ear is already getting from the released voice's
    // own decay against the new one's attack
    e.morphFrom = e.spec; e.morphT0 = now;
    e.n = bec; e.spec = spec2; e.voice = v2;
    e.releaseFn = h2.release; e.t0 = h2.t0; e.dur = v2.decay;
    e.settledAt = now;
    each('strike', bec, spec2, undefined, true, beatRateOf(v2));   // the settling lands as a held voice
    each('release', oldN);                 // and the form it settles FROM is let go
    notify('struck', bec);
  }
  // the modes an entry is showing right now: itself, or itself emerging from
  // what it was. A raised cosine, so the crossing has no corner at either end.
  function modesOf(e, now) {
    if (!e.morphFrom) return e.spec.modes;
    const u = (now - e.morphT0) / MORPH_S;
    if (u >= 1) { e.morphFrom = null; return e.spec.modes; }
    const k = (1 - Math.cos(Math.max(0, u) * Math.PI)) / 2;
    return [
      ...e.morphFrom.modes.map((md) => ({ ...md, w: md.w * (1 - k) })),
      ...e.spec.modes.map((md) => ({ ...md, w: md.w * k })),
    ];
  }

  function recompose() {
    const now = sounder.now();
    for (const e of ringing) {
      if (e.held && now - (e.settledAt ?? e.t0) >= SETTLE_S) settleStep(e, now);
    }
    for (let i = ringing.length - 1; i >= 0; i--) {
      if (envOf(ringing[i], now) <= 0.02) ringing.splice(i, 1);
    }
    if (ringing.length) {
      const modes = [];
      for (const e of ringing) {
        const w = envOf(e, now);
        // each mode carries its card, so a stage that colours by the house
        // (the glow's metals) knows whose light it is
        for (const md of modesOf(e, now)) modes.push({ ...md, w: md.w * w, card: e.n });
      }
      each('spectrum', modes);
      each('gain', 1);
    } else {
      each('gain', 0);   // the bow lifts: the figure freezes where it landed
    }
    // THE SOUNDING SET: which cards are in the air right now, so a stage
    // that draws whole forms can overlay them the way the plate overlays
    // their modes. The plate hears the superposition; this is the same
    // truth by name rather than by spectrum.
    each('sounding', ringing.map((e) => e.n));
    notify('lines');
    if (ringing.length) later(recompose, 120);
  }

  // ---- THE CYCLE: the knot as rhythm, p pulses against |q| on one bar ----
  const tickVoice = (freq, clarity) => ({ struck: true, clarity,
    decay: 0.9 + 0.9 * clarity, partials: [{ freq, gain: 1, beat: 0 }] });
  function scheduleAhead() {
    const now = sounder.now();
    const horizon = now + 0.4;
    for (const [, L] of loops) {
      for (const t of L.ticks) {
        let at = barZero + t.off + Math.floor((lastSched - barZero) / BAR) * BAR;
        while (at < lastSched) at += BAR;
        for (; at < horizon; at += BAR) {
          sounder.strike(tickVoice(t.freq, L.spec.clarity), at - now, t.line === 'p' ? 0.10 : 0.16);
        }
      }
    }
    lastSched = horizon;
  }
  function toggleLoop(n) {
    if (loops.has(n)) { loops.delete(n); notify('cycle'); return; }
    if (loops.size >= 3) return;   // three houses, three hands
    const spec = spectrumOf(n, path);
    const voice = voiceFor(spec);
    if (!voice.struck) return;
    const k = knotOf(n), aq = Math.abs(k.q);
    const fund = voice.partials[0].freq;
    const ticks = [];
    for (let i = 0; i < k.p; i++) ticks.push({ line: 'p', off: (i / k.p) * BAR, freq: tuning.ground });
    for (let i = 0; i < aq; i++) ticks.push({ line: 'q', off: (i / aq) * BAR, freq: fund });
    loops.set(n, { spec, ticks, p: k.p, aq });
    if (!schedTimer) {
      barZero = sounder.now() + 0.08; lastSched = barZero - 0.01;
      schedTimer = setInterval(scheduleAhead, 100);
    }
    each('spectrum', [...loops.entries()].flatMap(([ln, L]) => L.spec.modes.map((md) => ({ ...md, card: ln }))));
    each('gain', 1);
    notify('cycle');
  }
  function clearLoops() {
    loops.clear();
    if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    each('gain', 0);
    notify('cycle');
  }

  // ---- THE STRIKE: the Seed is the rest, everything else joins the air ----
  const held = new Map();   // n → its held ringing entry, while the finger stays
  function doRest(n) {
    // the rest: the phrase ends here, in every mode and on every stage.
    // Held voices are released first, or they would sing through the silence.
    for (const [, e] of held) { e.releaseFn?.(); }
    held.clear();
    ringing.length = 0;
    clearLoops();
    each('rest');
    each('gain', 0);
    notify('rest', n);
  }
  const shiftCrowd = () => {
    if (ringing.length <= 5) return;
    const old = ringing.shift();   // the sounder's own crowd law
    if (old.held) { old.releaseFn?.(); old.held = false; old.t0 = sounder.now(); }
    if (held.get(old.n) === old) held.delete(old.n);
  };
  function strikeOne(n, pairOf) {
    const spec = spectrumOf(n, path);
    const voice = voiceFor(spec);
    notify('touch', n);
    if (!voice.struck) { doRest(n); return; }
    if (mode === 'cycle') { toggleLoop(n); return; }
    const win = sounder.strike(voice, 0, sustain);
    if (!win) return;
    ringing.push({ n, spec, voice, t0: win.t0, dur: win.dur });
    shiftCrowd();
    // pairOf names the strike this one mirrors, so a stage that wants to
    // show the dyad together (the knots spiraling in concord) can know;
    // the final flag says whether a finger still holds this voice
    each('strike', n, spec, pairOf, false, beatRateOf(voice));
    notify('struck', n);
    recompose();
  }
  function strike(n) {
    strikeOne(n);
    // IN CONCORD (the Ring's resonance): the mirror answers at once. The
    // Seed is its own counter and already the rest; nothing doubles.
    if (concord && n !== 1 && mode !== 'cycle') strikeOne(counterOf(n), n);
  }

  // ---- THE HOLD: the key under the finger, chords under the hand ----
  function pressOne(n, pairOf) {
    const spec = spectrumOf(n, path);
    const voice = voiceFor(spec);
    notify('touch', n);
    if (!voice.struck) { doRest(n); return; }
    if (mode === 'cycle') { toggleLoop(n); return; }
    if (held.has(n)) return;   // already under a finger
    const h = sounder.hold(voice);
    if (!h) return;
    const e = { n, spec, voice, t0: h.t0, dur: voice.decay, held: true, releaseFn: h.release };
    ringing.push(e);
    shiftCrowd();
    held.set(n, e);
    each('strike', n, spec, pairOf, true, beatRateOf(voice));
    notify('struck', n);
    recompose();
  }
  function releaseOne(n) {
    const e = held.get(n);
    if (!e) return;
    held.delete(n);
    e.releaseFn?.();
    // from here it is an ordinary decaying voice: the ring after the lift
    e.held = false;
    e.t0 = sounder.now();
    e.dur = e.voice.decay;
    each('release', n);   // the stages learn the finger lifted
    recompose();
  }
  function press(n) {
    pressOne(n);
    if (concord && n !== 1 && mode !== 'cycle') {
      const m = counterOf(n);
      pressOne(m, n);
      const e = held.get(n);
      if (e) e.pair = m;   // the mirror lifts when the finger does
    }
  }
  function release(n) {
    const pair = held.get(n)?.pair;
    releaseOne(n);
    if (pair !== undefined) releaseOne(pair);
  }

  return {
    // state, read as the page reads it
    ringing, loops, liveCoherence,
    // action
    strike, press, release, recompose,
    // the dials
    setPath: (p) => { path = p === 'B' ? 'B' : 'A'; }, getPath: () => path,
    setMode: (m) => {
      mode = m === 'cycle' ? 'cycle' : 'strike';
      if (mode === 'strike') clearLoops();
      else {
        for (const [, e] of held) e.releaseFn?.();   // no voice sings into the bar
        held.clear();
        ringing.length = 0; each('gain', 0); notify('cycle');
      }
    },
    getMode: () => mode,
    setConcord: (v) => { concord = !!v; }, getConcord: () => concord,
    // the bow's hold: RING SHORT (1.6) or the held bench (3.2), so slow
    // beats can be counted while they breathe
    setSustain: (v) => { sustain = Number(v) > 0 ? Number(v) : 1.6; }, getSustain: () => sustain,
    // the tuning dials, set by name; anything omitted is left standing
    setTuning: (t) => { Object.assign(tuning, t); }, getTuning: () => ({ ...tuning }),
    // THE VOICES: each tone law arrives with the ring, beat and room that
    // suit it, so one touch is a whole character rather than four dials to
    // find. The pitch law is the derivation; these three are its dress.
    setVoice: (name) => {
      const V = VOICES[name] || VOICES.plate;
      Object.assign(tuning, { tone: V.tone, beat: V.beat, room: V.room });
      sustain = V.ring;
      return V;
    },
    // the rack
    addStage: (s) => { stages.push(s); return s; },
    onNotify: (fn) => { notify = typeof fn === 'function' ? fn : () => {}; },
    // the bar, read-only, for the dial that draws it
    cycle: { bar: BAR, active: () => !!schedTimer, barZero: () => barZero },
    // the scheduler's hand, callable so the pins can pump it without timers
    pump: scheduleAhead,
  };
}
