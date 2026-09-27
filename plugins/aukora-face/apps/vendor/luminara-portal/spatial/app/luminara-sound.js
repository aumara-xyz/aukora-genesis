// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// LUMINARA SOUND: the sounding seat (pathway A of the resonance work,
// 2026-07-17). The second half of the bridge luminara-skin.js chartered:
// the cymatics AND THEIR SOUNDS.
//
// THE LAW: the figure and the tone are ONE SPECTRUM. This module consumes
// the identical contract every visual renderer consumes (luminara-cymatics
// spectrumOf → modes {n, m, w, motion}) and derives the voice from the same
// numbers that draw the plate: a circular plate's mode with n angular petals
// and m radial rings sounds at the Bessel zero j(n, m). Nothing per-card is
// stored or tuned. The one free constant is the ground (the unit choice,
// as the plate's diameter is for the figure): the latent trinity mode (3·1),
// the unstruck Seed's own fundamental, tuned to G (196 Hz). Every voice in
// the deck is measured against the silence's latent tone.
//
//   · each mode → one partial: freq = GROUND · j(n,m)/j(3,1), gain = w
//   · counter-motion is HEARD as it is seen: a moving mode adds a slightly
//     detuned twin (sign of motion), so flow and turning beat against
//     themselves; still modes ring pure. A card and its counter sound the
//     same tones beating opposite ways.
//   · clarity (the interval's consonance) is the ring: the clearer, the
//     longer it sounds.
//   · the unstruck are SILENT: touching the Seed sounds its silence.
//
// EMPTINESS (First Name, canon head): silent by default, a voice only ever
// invited by a touch, never autoplayed, every envelope closes. The player
// half is import-safe headless (no AudioContext until the first strike, and
// none exists under test; voiceOf is the pure, pinned half).

// McMahon's asymptotic expansion for the m-th positive zero of J_n.
// Accurate to ~1e-3 for the small orders the canon uses; pinned in tests
// against the classical values.
import { codeOf, knotOf } from './luminara-canon.js';

export function besselZero(n, m) {
  const mm = Math.max(1, m);
  const mu = 4 * n * n;
  const b = (mm + n / 2 - 0.25) * Math.PI;
  const e8 = 8 * b;
  return b
    - (mu - 1) / e8
    - (4 * (mu - 1) * (7 * mu - 31)) / (3 * e8 ** 3)
    - (32 * (mu - 1) * (83 * mu * mu - 982 * mu + 3779)) / (15 * e8 ** 5);
}

export const GROUND_HZ = 196;              // the trinity mode (3·1) sits at G
const UNIT = besselZero(3, 1);             // the unstruck Seed's latent fundamental

// ---------------------------------------------------------------------------
// THE HOUSE IS THE TIMBRE, THE COUNT IS THE PLACE (2026-07-26). Two further
// derivations, both read off numbers the canon already sealed, neither of
// them a taste:
//
//   · THE WAVE. The first ternary digit names the state, so it names the
//     voice: still rings pure (sine), moving gives the triangle's soft odd
//     harmonics, turning bites (sawtooth, every harmonic present). AUM
//     sounds round, RA sounds bright, and the ear learns the houses without
//     being told. Gain is compensated per wave so the brighter timbres do
//     not simply arrive louder: the house changes the colour, never the
//     level.
//   · THE PAN. q is a signed position on the one number line every card
//     sits on, from minus thirteen to thirteen, and the ring already draws
//     it as an angle. So it is also a place in the room: flow to one side,
//     turning to the other, the Seed dead centre. IN CONCORD then answers
//     from the opposite side by construction, because a counter's q is the
//     negation of its card's: the mirror sounds across the axis it mirrors
//     across.
// ---------------------------------------------------------------------------
const WAVES = ['sine', 'triangle', 'sawtooth'];        // still · moving · turning
const WAVE_GAIN = [1, 0.72, 0.45];                     // equal loudness, not equal amplitude
export const MAX_Q = 13;                               // the count's own far station
export const BEAT_DEPTH = 0.0045;                      // the twin's default remove

// ---------------------------------------------------------------------------
// THE FOUR TONE LAWS (2026-07-26). Four honest answers to one question: which
// of the card's numbers IS its pitch? Each is a reading of sealed material,
// none is a preference, and they differ in what they take the card to be:
//
//   PLATE        the membrane's own physics: the Bessel zero j(n, m). What
//                the figure sounds like, since these are the very numbers
//                that draw the sand. Inharmonic, struck, bell-like.
//   INTERVAL     the card as a just ratio, n against m, which is canon D26
//                taken at its word: every card IS an interval. The Mask's
//                octave truly sounds an octave; the Scar's 13:7 is truly
//                alien. Consonant and legible.
//   LADDER       the three-six-nine read as harmonics of the ground, the
//                trinity mode being the ground itself. The pure harmonic
//                series: choral, organ-like, deeply consonant.
//   TWENTYSEVEN  the deck as its own temperament: 3 cubed, so the count
//                places the pitch across two octaves and the radial ring
//                gives the partials. Even, microtonal, alien: the only law
//                where the deck's own cardinality is the tuning.
//
// Every law keeps what the others keep: the pan from q, the timbre from the
// house, clarity as the ring. Only the pitch changes hands.
// ---------------------------------------------------------------------------
export const TONES = ['plate', 'interval', 'ladder', 'twentyseven'];
// keep a ratio inside a band that a plate and an ear can both hold
const fold = (r) => {
  let x = r;
  if (!Number.isFinite(x) || x <= 0) return 1;
  while (x < 0.5) x *= 2;
  while (x > 8) x /= 2;
  return x;
};
function freqOf(tone, md, ground, q) {
  switch (tone) {
    case 'interval':
      return ground * fold(md.m ? md.n / md.m : 1);
    case 'ladder':
      return ground * fold(md.n / 3);
    case 'twentyseven':
      return ground * Math.pow(2, q / 13.5) * Math.max(1, md.m || 1);
    default:
      return (ground * besselZero(md.n, md.m)) / UNIT;
  }
}

// voiceOf(spectrum) → the audible half of the contract, pure and testable.
//   spectrum: the exact object spectrumOf(n, path) returns.
//   → { struck, clarity, decay, partials: [{ freq, gain, beat }] }
// Gains are normalised to sum 1; decay grows with clarity (the consonant
// ring lasts); beat carries the mode's motion sign for the player.
export function voiceOf(spectrum, ground = GROUND_HZ, tone = 'plate') {
  const clarity = spectrum.clarity ?? 1;
  if (!spectrum.struck || !spectrum.modes || spectrum.modes.length === 0) {
    return { struck: false, clarity, decay: 0, partials: [], wave: 'sine', pan: 0, level: 1 };
  }
  // the house and the count, read off the card when the spectrum names one;
  // a hand-made spectrum (the pins, the cycle's ticks) rings pure and centred
  const n = spectrum.card;
  const house = n ? codeOf(n)[0] : 0;
  const q = n ? knotOf(n).q : 0;
  const total = spectrum.modes.reduce((s, md) => s + md.w, 0) || 1;
  const partials = spectrum.modes.map((md) => ({
    freq: Math.max(40, Math.min(4186, freqOf(tone, md, ground, q))),
    gain: md.w / total,
    beat: md.motion ?? 0,
  }));
  return {
    struck: true, clarity, decay: 1.2 + 2.6 * clarity, partials,
    wave: WAVES[house], level: WAVE_GAIN[house],
    pan: Math.max(-1, Math.min(1, q / MAX_Q)),
  };
}

// beatRateOf(voice) → the pulse the ear actually counts, in hertz. Each
// partial that carries a motion sign is doubled by a twin at
// freq · (1 + detune · motion), so the pair beats at freq · detune · |motion|
// times a second. Gain-weighted across the partials that beat, so the
// number is the voice's own dominant pulse: derived from the counter-
// rotation, never chosen. Nought when nothing beats (the pure tuning, the
// cycle's ticks), and a figure given nought simply stands still.
export function beatRateOf(voice) {
  if (!voice || !voice.struck || !voice.partials) return 0;
  const d = voice.detune ?? BEAT_DEPTH;
  let num = 0, den = 0;
  for (const p of voice.partials) {
    if (!p.beat) continue;
    num += p.gain * Math.abs(p.freq * d * p.beat);
    den += p.gain;
  }
  return den ? num / den : 0;
}

// gapsAmong(voices) → the air of a set of voices: every gap under thirty
// hertz among all the partials that would sound together, one decimal,
// ascending. Pure, and the same law wherever a reading is heard.
export function gapsAmong(voices) {
  const ps = [];
  for (const v of voices) if (v && v.struck) ps.push(...v.partials);
  const gaps = new Set();
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const df = Math.abs(ps[i].freq - ps[j].freq);
      if (df > 0.01 && df < 30) gaps.add(df.toFixed(1));
    }
  }
  return [...gaps].sort((a, b) => a - b);
}

// THE HALL'S IMPULSE, made rather than fetched, so the module stays one file
// with no asset to lose. A room's answer to a clap is a burst of early
// reflections followed by a diffuse tail that decays away, and that is what
// is built here: noise under an exponential decay, with a handful of early
// taps standing proud of it for the walls, and the two ears decorrelated so
// the room has width. The length and the decay are CHOSEN (see THE HALL): a
// small stone room, about two and a half seconds.
// Both numbers were MEASURED rather than picked: an impulse was rendered
// through candidate impulses offline and the tail read in decibels. At 3.4
// the room dumped its energy at once and was 47 dB down by two seconds,
// which is a hall you cannot hear behind a ringing card. At 2.0 the tail
// stands 8 dB down at one second and 25 at two: present, and still short of
// mud. A room about two and a half seconds long, which is a small stone one.
export const HALL_SECONDS = 2.6;
export const STONE_MIN = 0.4, STONE_MAX = 6;   // a cupboard, and a cathedral
const HALL_DECAY = 2.0;        // how fast the tail falls: higher is drier
function hallIR(ctx, seconds = HALL_SECONDS) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.max(STONE_MIN, Math.min(STONE_MAX, seconds))));
  const buf = ctx.createBuffer(2, len, rate);
  // the walls: a few early reflections, the same for both ears but offset,
  // which is what makes a room read as a room rather than as a fog
  const early = [0.0111, 0.0177, 0.0231, 0.0307, 0.0413, 0.0561];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, HALL_DECAY);
    }
    early.forEach((sec, k) => {
      const i = Math.floor((sec + (c ? 0.0013 : 0)) * rate);
      if (i < len) d[i] += (k % 2 ? -1 : 1) * 0.6 * Math.pow(0.72, k);
    });
    // UNIT ENERGY, set here rather than left to the browser. A convolver's
    // own normalise divides by the impulse's energy, and for a tail this
    // long that buried the room: measured, the hall arrived 51 dB under the
    // card and could not be heard at all. Scaling each ear to unit energy
    // gives the wet leg about unity gain instead, which measured as a tail
    // 7 dB under the direct sound at a second and 17 at two: a room.
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    if (e > 0) { const k = Math.sqrt(1 / e); for (let i = 0; i < len; i++) d[i] *= k; }
  }
  return buf;
}

// createSounder() → { strike(voice, when), destroy() }. Lazy: the
// AudioContext is created inside the first strike, which by EMPTINESS (and
// by the browsers' own law) always happens inside a touch.
export function createSounder() {
  let ctx = null;
  let master = null;
  let room = null;                         // the door to the loudspeakers
  let mix = null;                          // dry and hall summed: what is heard
  let dry = null, wet = null, conv = null;  // the hall's own three
  let analyser = null;                     // the tap on the sounded line
  let muted = false;
  let lvlBuf = null;
  let hall = 0;                            // how far into the room, 0 to 1
  // THE HAND: the dials that are the player's rather than the card's. Each
  // rests at the law it modifies, so an untouched instrument sounds exactly
  // what the canon derives, and every departure from that is a hand on a
  // named dial rather than a constant quietly changed in the source.
  let stone = HALL_SECONDS;                // how large a room, in seconds
  let shutter = 1;                         // how far clarity may close the voice
  let closing = 1;                         // how far the shutter shuts as it dies
  let edge = 0;                            // the shutter's own ring
  // a dial set to nothing MEANS nothing: reading it through `|| fallback`
  // treats nought as absent and hands back the default, which made the
  // smallest room in the range unreachable from the bench.
  const dial = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const ringing = [];                      // active strikes, oldest first
  const MAX_RINGING = 5;

  // EQUAL POWER, so the hall does not swell the whole sounding as it opens:
  // the two legs are cosine and sine of the same quarter turn, and their
  // powers sum to one at every setting. A wet-only ramp would make the dial
  // read as a loudness knob wearing a room's name.
  function applyReverb() {
    if (!dry || !wet) return;
    const a = Math.max(0, Math.min(1, hall)) * Math.PI / 2;
    dry.gain.value = Math.cos(a);
    wet.gain.value = Math.sin(a);
  }

  function ensure() {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    // THE ROOM'S DOOR sits AFTER the tap, never before it: closing the room
    // silences the loudspeakers and NOTHING else. The strikes still ring on
    // the master line and the tap still measures them, so a figure that
    // breathes with the air keeps breathing truthfully with the sound off:
    // what is shown is still read from real air, never animated to cover a
    // silence. Muting is a fact about the room, not about the sounding.
    // THE HALL (2026-08-03). A room the sound is heard in, and it is a DIAL,
    // named as one: nothing in the canon fixes how large a room a card is
    // played in, so the size below is chosen, declared, and open to the ear.
    // What is not chosen is where it sits. The hall is part of the SOUNDING,
    // not of the loudspeakers: a tail still ringing is still air in the room,
    // so the tap must hear it or a figure that breathes with the air would
    // stop breathing while the hall was still speaking. So the wet and the
    // dry are summed BEFORE the tap, and the mute door stays after it: the
    // breath now includes the tail, and closing the room still silences the
    // speakers and nothing else.
    // A room that cannot be built is simply not built: where a context has no
    // convolver the sounding runs dry and everything else is unchanged, the
    // same courtesy placeOf pays a context with no panner. The hall is an
    // addition to the air, never a requirement of it.
    mix = ctx.createGain();
    if (typeof ctx.createConvolver === 'function' && typeof ctx.createBuffer === 'function') {
      dry = ctx.createGain();
      wet = ctx.createGain();
      conv = ctx.createConvolver();
      conv.normalize = false;   // the impulse carries its own unit energy
      conv.buffer = hallIR(ctx, stone);
      dry.gain.value = 1;
      wet.gain.value = 0;             // silent until asked: the room opens by hand
      master.connect(dry); dry.connect(mix);
      // the hall takes no rumble with it: a reverb accumulates low frequency
      // on held chords until the room reads as mud rather than as space, so
      // the wet leg alone is cleared below where the deck's lowest partial
      // sits. The dry path is untouched: what was struck is heard whole.
      if (typeof ctx.createBiquadFilter === 'function') {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.707;
        master.connect(hp); hp.connect(conv);
      } else {
        master.connect(conv);
      }
      conv.connect(wet); wet.connect(mix);
    } else {
      master.connect(mix);
    }

    room = ctx.createGain();
    room.gain.value = muted ? 0 : 1;
    // THE CATCH sits with the room's door, downstream of the tap: five held
    // voices and a hall can stack peaks past the ceiling, and an instrument
    // that clips itself is not protecting anything. Like the mute, this is a
    // fact about the loudspeakers rather than about the sounding, so the tap
    // above it still measures what was truly played.
    let out = mix;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const cap = ctx.createDynamicsCompressor();
      cap.threshold.value = -6; cap.knee.value = 0; cap.ratio.value = 20;
      cap.attack.value = 0.003; cap.release.value = 0.25;
      mix.connect(cap); out = cap;
    }
    out.connect(room);
    room.connect(ctx.destination);
    // the listening tap: the sounded line measured, so any breath shown is
    // read from the actual air, never animated
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    mix.connect(analyser);
    applyReverb();
    return ctx;
  }

  // ---------------------------------------------------------------------
  // CLARITY IS BRIGHTNESS (2026-08-03). The canon already says the locked
  // consonances settle crisp while the far dissonance trembles and never
  // lands, and that is a claim about SPECTRUM, not only about duration. So
  // clarity, which until now set the ring alone, also opens the voice: a
  // lock rings bright and whole, a far dissonance is dull and closed in.
  //
  // WHAT IS BEING SHUTTERED. Measured across the struck deck, twenty of the
  // twenty-six cards sound a SINGLE partial: their brightness is carried
  // almost entirely by the wave the house chose, and by the harmonic series
  // that wave generates above its own fundamental. So the shutter is set
  // relative to the card's own partials but is really working on the timbre
  // above them, closing the sawtooth's upper harmonics on a far dissonance
  // and leaving them whole on a lock. The AUM house rings a pure sine and
  // has no harmonics to close, which is right rather than a gap: the still
  // house is already clear, and its clarity is heard in the ring alone.
  //
  // THE OPENING IS MEASURED FROM THE CARD'S OWN TOP PARTIAL, and it has to
  // be. The least clear cards carry the HIGHEST fundamentals (the Scar sits
  // at clarity 0.1 with its partial at 1212 Hz, while the Spectrum at
  // clarity 1 begins at 118), so an absolute cutoff would have gutted
  // exactly the cards it was meant to colour. Measuring from each card's own
  // top partial instead, in octaves up to open air, gives one number x that
  // says how far open the voice is: at x = 0 the shutter sits on the tone
  // itself and nothing but the tone survives, at x = 1 it is open air and
  // nothing is touched. The card's rest is CLEAR above its top partial, far
  // enough that a wholly unclear card still speaks every tone it was given.
  //
  // AND THE CLOSING (2026-08-10). A dissonance that trembles and never lands
  // does not merely start dull, it comes apart as it goes: so the shutter
  // travels further shut across the ring, and the travel is the dissonance's
  // OWN SHARE of its opening, (1 - clarity). A lock therefore does not move
  // at all, which is the point: it was clear when it was struck and it is
  // clear when it dies. A far dissonance closes the whole way down onto its
  // bare tone, so the last thing heard of it is the interval with all its
  // colour gone. Nothing is taken from a voice as it SPEAKS: the travel ends
  // where the envelope has already run out.
  // ---------------------------------------------------------------------
  const OPEN_HZ = 18000;                   // above this, no ear and no shutter
  const CLEAR = 1.6;                       // the shutter's rest above the top partial
  const EDGE_Q = [0.707, 8];               // no peak, and a shutter that sings

  // openingOf(voice) → { hi, span, x0, x1 }, the shutter's whole journey in
  // one reading: hi is the card's top partial and the floor of the scale,
  // span is how many times that reaches open air, and x0 → x1 is how far
  // open the voice is when it speaks and when it has finished.
  function openingOf(voice) {
    let hi = 0;
    for (const p of (voice.partials || [])) if (p.freq > hi) hi = p.freq;
    if (!hi) return { hi: OPEN_HZ, span: 1, x0: 1, x1: 1 };
    const span = Math.max(1.0001, OPEN_HZ / hi);
    const rest = Math.min(1, Math.log(CLEAR) / Math.log(span));   // the tone kept whole
    const c = Math.max(0, Math.min(1, voice.clarity ?? 1));
    const law = rest + (1 - rest) * c;                            // what clarity asks for
    const x0 = law + (1 - law) * (1 - shutter);                   // the dial pulls it open
    // the shutter dial is the master: with the law off there is nothing to
    // travel, so the closing has nothing to do either
    const x1 = Math.max(0, x0 - shutter * closing * (1 - c) * x0);
    return { hi, span, x0, x1 };
  }
  const hzAt = (o, x) => o.hi * Math.pow(o.span, Math.max(0, Math.min(1, x)));

  // outletFor(voice, t0, dur) → { node, close(from, over) }. The node every
  // voice sings into; close schedules the travel for a voice whose dying is
  // known only later, which is every held one.
  function outletFor(voice, t0, dur) {
    const place = placeOf(voice);
    if (typeof ctx.createBiquadFilter !== 'function') return { node: place, close: () => {} };
    const o = openingOf(voice);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    // a shutter, not a resonance, unless a hand asks for one. THE EDGE is the
    // single dial here that adds a tone the card did not name (the corner
    // itself begins to sing), which is exactly why it rests at none: it is a
    // colour on the instrument, declared as one, not a reading of the card.
    f.Q.value = EDGE_Q[0] * Math.pow(EDGE_Q[1] / EDGE_Q[0], Math.max(0, Math.min(1, edge)));
    f.frequency.setValueAtTime(hzAt(o, o.x0), t0);
    const close = (from, over) => {
      if (!(over > 0) || o.x1 >= o.x0 - 1e-6) return;   // a lock does not move
      f.frequency.cancelScheduledValues(from);
      f.frequency.setValueAtTime(hzAt(o, o.x0), from);
      f.frequency.exponentialRampToValueAtTime(hzAt(o, o.x1), from + over);
    };
    if (dur > 0) close(t0, dur);
    f.connect(place);
    return { node: f, close };
  }

  // THE PLACE: one panner per voice, set from the count and left alone.
  // Where a browser has no stereo panner the voice simply sounds centred:
  // the pan is a reading of q, never a requirement of it.
  function placeOf(voice) {
    const p = voice.pan ?? 0;
    if (!p || typeof ctx.createStereoPanner !== 'function') return master;
    const sp = ctx.createStereoPanner();
    sp.pan.value = Math.max(-1, Math.min(1, p));
    sp.connect(master);
    return sp;
  }

  function hush(entry, at) {
    // the crowded bench: the oldest voice bows out quickly, never clipped
    entry.g.gain.cancelScheduledValues(at);
    entry.g.gain.setTargetAtTime(0.0001, at, 0.03);
    for (const o of entry.oscs) { try { o.stop(at + 0.2); } catch { /* already stopped */ } }
  }

  // sustain lengthens the ring (1 = the plate's own decay): slow beats need
  // time to be counted, and a held bench lets them breathe
  function strike(voice, when = 0, sustain = 1) {
    if (!voice || !voice.struck || voice.partials.length === 0) return false;
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + when;
    const dur = voice.decay * (sustain > 0 ? sustain : 1);
    // THE CROWDED BENCH counts the voices that will actually be sounding when
    // THIS one speaks, not every voice ever handed to the clock. A procession
    // gives the whole reading to the audio clock in a single tick, so `ringing`
    // holds voices whose windows are seconds apart and crowd nothing. Counting
    // those as neighbours evicted twenty-one of a twenty-six card reading before
    // any of them sounded, and hushing at ctx.currentTime rather than at the
    // evicted voice's own window erased an envelope that had not yet begun.
    // A voice steps aside only for a voice it genuinely overlaps, and it steps
    // aside at the moment the new one arrives.
    const crowd = ringing.filter((e) => e.t0 <= t0 && e.tEnd > t0);
    while (crowd.length >= MAX_RINGING) {
      const victim = crowd.shift();
      const i = ringing.indexOf(victim);
      if (i >= 0) ringing.splice(i, 1);
      hush(victim, Math.max(ctx.currentTime, t0));
    }
    const g = ctx.createGain();
    const peak = 0.9 * (voice.level ?? 1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    g.connect(outletFor(voice, t0, dur).node);
    const oscs = [];
    const tEnd = t0 + dur + 0.05;
    const wave = voice.wave || 'sine';
    for (const p of voice.partials) {
      const pg = ctx.createGain();
      pg.gain.value = p.gain;
      pg.connect(g);
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = p.freq;
      o.connect(pg);
      o.start(t0); o.stop(tEnd);
      oscs.push(o);
      if (p.beat) {
        // counter-rotation heard: the detuned twin, beating with the sign
        const bg = ctx.createGain();
        bg.gain.value = p.gain * 0.35;
        bg.connect(g);
        const ob = ctx.createOscillator();
        ob.type = wave;
        ob.frequency.value = p.freq * (1 + (voice.detune ?? BEAT_DEPTH) * p.beat);
        ob.connect(bg);
        ob.start(t0); ob.stop(tEnd);
        oscs.push(ob);
      }
    }
    // the window travels with the entry, so the bench can tell a true
    // neighbour from a voice that has not spoken yet
    const entry = { g, oscs, t0, tEnd };
    ringing.push(entry);
    oscs[oscs.length - 1].onended = () => {
      const i = ringing.indexOf(entry);
      if (i >= 0) ringing.splice(i, 1);
      g.disconnect();
    };
    // the strike reports its own window, so a bench can know what rings when
    return { t0, dur };
  }

  // hold(voice, shape) → { t0, release() } | false. The held bench: the voice
  // attacks, settles onto a plateau, and stays under the finger; release
  // lets it ring out at the voice's own decay (clarity is the ring, held
  // or struck). Oscillators are stopped only at release or when hushed by
  // the crowd, so a held voice costs nothing but its own sounding.
  // shape.attack (seconds): given a real value, the pluck is forgone and the
  // voice swells straight onto its plateau: a hum arriving, not a strike.
  // shape.pulses (seconds after t0, ascending, ≥ 0.11 apart, after the
  // attack): the held voice settles onto a low bed instead of the plateau
  // and rises out of it at each given moment: a beat whose pace the caller
  // composes and the law merely shapes.
  function hold(voice, shape = {}) {
    if (!voice || !voice.struck || voice.partials.length === 0) return false;
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    while (ringing.length >= MAX_RINGING) hush(ringing.shift(), ctx.currentTime);
    const g = ctx.createGain();
    const lvl = voice.level ?? 1;
    const attack = shape.attack ?? 0;
    const pulses = shape.pulses && shape.pulses.length ? shape.pulses : null;
    const bed = (pulses ? 0.3 : 0.62) * lvl;
    g.gain.setValueAtTime(0.0001, t0);
    if (attack > 0.05) {
      g.gain.linearRampToValueAtTime(bed, t0 + attack);   // the swell
    } else {
      g.gain.linearRampToValueAtTime(0.9 * lvl, t0 + 0.012);
      g.gain.setTargetAtTime(bed, t0 + 0.012, 0.14);   // the plateau under the finger
    }
    if (pulses) {
      for (const p of pulses) {
        const tp = t0 + p;
        if (tp <= t0 + attack + 0.04) continue;   // never inside the swell
        g.gain.setValueAtTime(bed, tp - 0.03);
        g.gain.linearRampToValueAtTime(0.88 * lvl, tp);
        g.gain.linearRampToValueAtTime(bed, tp + 0.07);
      }
    }
    // A HELD VOICE IS NOT DYING, so its shutter does not travel: under the
    // finger it sits at the opening its clarity asked for, and the closing
    // is scheduled at the release, over the ring the release grants it.
    const outlet = outletFor(voice, t0, 0);
    g.connect(outlet.node);
    const oscs = [];
    const wave = voice.wave || 'sine';
    for (const p of voice.partials) {
      const pg = ctx.createGain();
      pg.gain.value = p.gain;
      pg.connect(g);
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = p.freq;
      o.connect(pg);
      o.start(t0);
      oscs.push(o);
      if (p.beat) {
        const bg = ctx.createGain();
        bg.gain.value = p.gain * 0.35;
        bg.connect(g);
        const ob = ctx.createOscillator();
        ob.type = wave;
        ob.frequency.value = p.freq * (1 + (voice.detune ?? BEAT_DEPTH) * p.beat);
        ob.connect(bg);
        ob.start(t0);
        oscs.push(ob);
      }
    }
    // a held voice sounds until a hand lets it go, so its window has no end:
    // it is a neighbour to everything that arrives after it
    const entry = { g, oscs, t0, tEnd: Infinity };
    ringing.push(entry);
    let released = false;
    return {
      t0,
      release() {
        if (released || !ctx) return;
        released = true;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(g.gain.value || 0.0002, 0.0002), now);
        g.gain.exponentialRampToValueAtTime(0.0008, now + voice.decay);
        outlet.close(now, voice.decay);
        const tEnd = now + voice.decay + 0.05;
        for (const o of oscs) { try { o.stop(tEnd); } catch { /* hushed already */ } }
        oscs[oscs.length - 1].onended = () => {
          const i = ringing.indexOf(entry);
          if (i >= 0) ringing.splice(i, 1);
          g.disconnect();
        };
      },
    };
  }

  return {
    strike,
    hold,
    now: () => (ctx ? ctx.currentTime : 0),
    analyser: () => analyser,
    // THE ROOM: closed or open, remembered before the context exists so a
    // page can open muted and the first touch obeys. Ramped, never cut: a
    // hard zero on a ringing line clicks.
    setMute(v) {
      muted = !!v;
      if (room && ctx) {
        const t = ctx.currentTime;
        room.gain.cancelScheduledValues(t);
        room.gain.setTargetAtTime(muted ? 0 : 1, t, 0.02);
      }
      return muted;
    },
    isMuted: () => muted,
    // THE AIR, one door: the true amplitude on the master line, nought to
    // one, for anything that wants to breathe with the sounding. Read from
    // the tap, so it is honest with the room shut.
    level() {
      if (!analyser) return 0;
      if (!lvlBuf || lvlBuf.length !== analyser.fftSize) lvlBuf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(lvlBuf);
      let s = 0;
      for (let i = 0; i < lvlBuf.length; i++) {
        const v = (lvlBuf[i] - 128) / 128;
        s += v * v;
      }
      return Math.min(1, Math.sqrt(s / lvlBuf.length) * 3.2);
    },
    // THE HALL, set and read by name. Takes effect at once on a live room and
    // is remembered for a room not yet built, so a page may set it before the
    // first gesture ever opens a context.
    setReverb: (v) => {
      hall = dial(v, 0, 1, 0);
      applyReverb();
      return hall;
    },
    reverb: () => hall,
    // THE HAND, the shaping dials by name. Each is read at the strike, so a
    // voice already ringing keeps the hand it was struck with; only THE
    // STONE reaches a live tail, since a room's size is a fact about the
    // room rather than about any one card in it.
    setStone(v) {
      stone = dial(v, STONE_MIN, STONE_MAX, HALL_SECONDS);
      if (conv && ctx) conv.buffer = hallIR(ctx, stone);
      return stone;
    },
    setShutter(v) { shutter = dial(v, 0, 1, 1); return shutter; },
    setClosing(v) { closing = dial(v, 0, 1, 1); return closing; },
    setEdge(v) { edge = dial(v, 0, 1, 0); return edge; },
    hand: () => ({ hall, stone, shutter, closing, edge }),
    // SILENCE, the near half of destroy(): every voice on the clock bows out
    // now, and the room stays open. A procession hands seconds of sound to the
    // audio clock in one tick, so a stop button that only clears its own
    // timers stills the lights and nothing else; there was no door for it to
    // ask through short of closing the context and losing the tap with it.
    // Every envelope closes, which is the law; the context outliving them is
    // the point, since the next gesture must not have to build a room again.
    silence() {
      for (const e of ringing.splice(0)) hush(e, ctx ? ctx.currentTime : 0);
    },
    destroy() {
      for (const e of ringing.splice(0)) hush(e, ctx ? ctx.currentTime : 0);
      if (ctx) { ctx.close(); ctx = null; master = null; room = null; analyser = null;
        mix = null; dry = null; wet = null; conv = null; }
    },
  };
}
