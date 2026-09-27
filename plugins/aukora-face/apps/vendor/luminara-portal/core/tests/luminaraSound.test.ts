// THE SOUNDING SEAT: the pins. The law under test: the figure and the tone
// are ONE SPECTRUM. voiceOf consumes the identical contract the visual
// renderers consume and derives every frequency from the same mode numbers
// that draw the plate (Bessel zeros, McMahon), against one free constant:
// the latent trinity mode (3·1) tuned to G. Derived, never tuned: no
// per-card tables can exist because no per-card data exists.
// The player half (createSounder) is WebAudio and lives untested here by
// design: voiceOf is the whole derivation; the player only obeys it.
import { describe, expect, test } from 'vitest';
import { besselZero, voiceOf, beatRateOf, BEAT_DEPTH, GROUND_HZ, TONES, createSounder,
  HALL_SECONDS, STONE_MIN, STONE_MAX }
  from '../../spatial/app/luminara-sound.js';
import { spectrumOf, meetOf } from '../../spatial/app/luminara-cymatics.js';
import { counterOf, codeOf, knotOf } from '../../spatial/app/luminara-canon.js';

const ALL = Array.from({ length: 27 }, (_, i) => i + 1);
const PATHS = ['A', 'B'] as const;

describe('THE BESSEL ZEROS: McMahon against the classical values', () => {
  test('the known zeros, within a hair', () => {
    // classical values of j(n,m), the m-th zero of J_n
    const KNOWN: [number, number, number][] = [
      [0, 1, 2.4048], [1, 1, 3.8317], [2, 1, 5.1356],
      [3, 1, 6.3802], [0, 2, 5.5201], [1, 2, 7.0156],
    ];
    for (const [n, m, j] of KNOWN) {
      expect(Math.abs(besselZero(n, m) - j)).toBeLessThan(0.05);
    }
  });
  test('monotone in both numbers: more petals ring higher, more rings ring higher', () => {
    for (let n = 0; n < 13; n++) expect(besselZero(n + 1, 1)).toBeGreaterThan(besselZero(n, 1));
    for (let m = 1; m < 8; m++) expect(besselZero(3, m + 1)).toBeGreaterThan(besselZero(3, m));
  });
  test('a ring count below one is held at one, never dropped', () => {
    expect(besselZero(3, 0)).toBe(besselZero(3, 1));
  });
});

describe('THE GROUND: the one free constant', () => {
  test('the latent trinity mode (3·1) sounds at G exactly', () => {
    const v = voiceOf({ struck: true, clarity: 1, modes: [{ n: 3, m: 1, w: 1, motion: 0 }] });
    expect(v.partials).toHaveLength(1);
    expect(v.partials[0].freq).toBeCloseTo(GROUND_HZ, 9);
    expect(GROUND_HZ).toBe(196);
  });
});

describe('THE 27 VOICES: every card, both paths, derived and bounded', () => {
  test('struck voices are audible, normalised, and finite; the unstruck are silent', () => {
    for (const path of PATHS) {
      for (const n of ALL) {
        const spec = spectrumOf(n, path);
        const v = voiceOf(spec);
        expect(v.struck).toBe(spec.struck);
        if (!spec.struck) {
          expect(v.partials).toHaveLength(0);
          expect(v.decay).toBe(0);
          continue;
        }
        expect(v.partials.length).toBeGreaterThanOrEqual(1);
        let sum = 0;
        for (const p of v.partials) {
          expect(Number.isFinite(p.freq)).toBe(true);
          expect(p.freq).toBeGreaterThan(40);
          expect(p.freq).toBeLessThanOrEqual(4186);
          expect(p.gain).toBeGreaterThan(0);
          sum += p.gain;
        }
        expect(sum).toBeCloseTo(1, 9);
        expect(v.decay).toBeGreaterThan(1.2);
        expect(v.decay).toBeLessThanOrEqual(1.2 + 2.6);
      }
    }
  });
  test('the voice is deterministic: one spectrum, one sound, always', () => {
    for (const n of ALL) {
      expect(voiceOf(spectrumOf(n, 'A'))).toEqual(voiceOf(spectrumOf(n, 'A')));
    }
  });
  test('the Seed sounds its silence on both paths', () => {
    for (const path of PATHS) {
      const v = voiceOf(spectrumOf(1, path));
      expect(v.struck).toBe(false);
      expect(v.partials).toHaveLength(0);
    }
  });
});

describe('THE KINSHIP OF OPPOSITES: heard as it is seen', () => {
  test('on path A a card and its counter sound the same tones, beating opposite ways', () => {
    for (const n of ALL) {
      const cn = counterOf(n);
      const a = voiceOf(spectrumOf(n, 'A'));
      const b = voiceOf(spectrumOf(cn, 'A'));
      if (!a.struck || !b.struck) continue;
      expect(b.partials.map((p) => p.freq)).toEqual(a.partials.map((p) => p.freq));
      expect(b.partials.map((p) => p.beat)).toEqual(a.partials.map((p) => -p.beat + 0));
    }
  });
  test('the annihilation is audible as silence: a card met with its counter voices the Seed', () => {
    for (const n of ALL) {
      const m = meetOf(n, counterOf(n));
      expect(m).toBe(1);
      expect(voiceOf(spectrumOf(m, 'A')).struck).toBe(false);
    }
  });
  test('the clearer the interval, the longer the ring', () => {
    const voices = ALL.map((n) => voiceOf(spectrumOf(n, 'A'))).filter((v) => v.struck);
    for (const v of voices) expect(v.decay).toBeCloseTo(1.2 + 2.6 * v.clarity, 9);
  });
});

describe('THE AIR: the bench reports the beats, never stores them', () => {
  test('the audible gaps of the whole deck are exactly five, derived from the ladder', () => {
    // every sub-thirty-hertz gap any pairing can produce, from voiceOf alone
    const freqs = new Set<number>();
    for (const n of ALL) {
      for (const p of voiceOf(spectrumOf(n, 'B')).partials) freqs.add(Number(p.freq.toFixed(1)));
    }
    const fv = [...freqs].sort((a, b) => a - b);
    const gaps = new Set<string>();
    for (let i = 0; i < fv.length; i++) {
      for (let j = i + 1; j < fv.length; j++) {
        const df = fv[j] - fv[i];
        if (df > 0.01 && df < 30) gaps.add(df.toFixed(1));
      }
    }
    expect([...gaps].sort()).toEqual(['3.5', '6.6', '8.1', '14.3', '17.8'].sort());
  });
  test('the bench hardcodes no frequency: the air line is computed at the strike', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(import.meta.dir, '..', '..', 'spatial', 'app', 'luminara-resonance.html'), 'utf8');
    expect(src).toMatch(/airGaps/);                 // the report derives, in code
    expect(src).toMatch(/analyser\(\)/);            // the strip reads the real line
    for (const lit of ['417.5', '414.0', '399.7', '530.3', '639.2', '306.3', '299.7', '17.8', '14.3', '8.1']) {
      expect(src.includes(lit), 'a ladder number is hardcoded on the bench: ' + lit).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// THE HOUSE AND THE COUNT, HEARD (2026-07-26). Two further derivations,
// both read off sealed numbers: the first ternary digit chooses the wave,
// the signed count chooses the place in the room. Pinned so neither can
// quietly become a preference.
// ---------------------------------------------------------------------------
describe('THE HOUSE IS THE TIMBRE', () => {
  test('each house rings its own wave, and only its own', () => {
    const want = ['sine', 'triangle', 'sawtooth'];   // still · moving · turning
    for (const n of ALL) {
      const v = voiceOf(spectrumOf(n, 'A'));
      if (!v.struck) continue;
      expect(v.wave, 'card ' + n).toBe(want[codeOf(n)[0]]);
    }
  });

  test('the brighter timbres are level-compensated, never simply louder', () => {
    const lv = (d: number) => {
      const n = ALL.find((c) => codeOf(c)[0] === d && voiceOf(spectrumOf(c, 'A')).struck)!;
      return voiceOf(spectrumOf(n, 'A')).level;
    };
    expect(lv(0)).toBeGreaterThan(lv(1));   // sine loudest per amplitude
    expect(lv(1)).toBeGreaterThan(lv(2));   // sawtooth quietest, being brightest
  });

  test('a spectrum naming no card rings pure and centred: the pins and the ticks', () => {
    const v = voiceOf({ struck: true, clarity: 1, modes: [{ n: 3, m: 1, w: 1, motion: 0 }] });
    expect(v.wave).toBe('sine');
    expect(v.pan).toBe(0);
    expect(v.level).toBe(1);
  });
});

describe('THE FOUR TONE LAWS', () => {
  const struckCards = ALL.filter((n) => voiceOf(spectrumOf(n, 'A')).struck);

  test('each law is a real law: every card audible, in band, and finite', () => {
    for (const tone of TONES) {
      for (const n of struckCards) {
        const v = voiceOf(spectrumOf(n, 'A'), 196, tone);
        expect(v.partials.length, tone + ' card ' + n).toBeGreaterThan(0);
        for (const p of v.partials) {
          expect(Number.isFinite(p.freq)).toBe(true);
          expect(p.freq).toBeGreaterThanOrEqual(40);
          expect(p.freq).toBeLessThanOrEqual(4186);
        }
      }
    }
  });

  test('the laws genuinely differ: no two agree across the deck', () => {
    const sig = (tone: string) => struckCards
      .map((n) => voiceOf(spectrumOf(n, 'A'), 196, tone).partials.map((p) => p.freq.toFixed(2)).join(','))
      .join('|');
    const seen = TONES.map(sig);
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        expect(seen[i] === seen[j], TONES[i] + ' equals ' + TONES[j]).toBe(false);
      }
    }
  });

  test('THE INTERVAL sounds the card\'s own ratio: the octave is an octave', () => {
    // under path A a mode is (n = |q|, m = p), so n/m IS the card's interval
    for (const n of struckCards) {
      const md = spectrumOf(n, 'A').modes[0];
      const v = voiceOf(spectrumOf(n, 'A'), 196, 'interval');
      let want = md.n / md.m;
      while (want < 0.5) want *= 2;
      while (want > 8) want /= 2;
      expect(v.partials[0].freq).toBeCloseTo(196 * want, 6);
    }
  });

  test('THE LADDER sets the trinity mode at the ground itself', () => {
    // path B's core zone is the 3-harmonic: on the ladder that is the ground
    const three = { struck: true, clarity: 1, card: 4, modes: [{ n: 3, m: 1, w: 1 }] };
    expect(voiceOf(three, 196, 'ladder').partials[0].freq).toBeCloseTo(196, 6);
    const nine = { struck: true, clarity: 1, card: 4, modes: [{ n: 9, m: 1, w: 1 }] };
    expect(voiceOf(nine, 196, 'ladder').partials[0].freq).toBeCloseTo(588, 6);
  });

  test('THE TWENTY-SEVEN places by the count: counters straddle the ground', () => {
    for (const n of struckCards) {
      const cn = counterOf(n);
      if (!voiceOf(spectrumOf(cn, 'A')).struck) continue;
      const a = voiceOf(spectrumOf(n, 'A'), 196, 'twentyseven').partials[0].freq;
      const b = voiceOf(spectrumOf(cn, 'A'), 196, 'twentyseven').partials[0].freq;
      // q and -q place at reciprocal ratios about the ground, so the pair's
      // geometric mean is the ground times the shared partial index
      expect(Math.sign(knotOf(n).q)).toBe(-Math.sign(knotOf(cn).q));
      if (spectrumOf(n, 'A').modes[0].m === spectrumOf(cn, 'A').modes[0].m) {
        const m = Math.max(1, spectrumOf(n, 'A').modes[0].m);
        expect(Math.sqrt(a * b)).toBeCloseTo(196 * m, 4);
      }
    }
  });

  test('the tone law changes the pitch and nothing else: pan, wave and ring hold', () => {
    for (const n of [4, 14, 22]) {
      const base = voiceOf(spectrumOf(n, 'A'), 196, 'plate');
      for (const tone of TONES) {
        const v = voiceOf(spectrumOf(n, 'A'), 196, tone);
        expect(v.pan).toBe(base.pan);
        expect(v.wave).toBe(base.wave);
        expect(v.level).toBe(base.level);
        expect(v.decay).toBe(base.decay);
      }
    }
  });

  test('an unnamed law falls to the plate, and the plate is the default', () => {
    const spec = spectrumOf(14, 'A');
    const d = voiceOf(spec, 196).partials.map((p) => p.freq);
    expect(voiceOf(spec, 196, 'plate').partials.map((p) => p.freq)).toEqual(d);
    expect(voiceOf(spec, 196, 'nonsense').partials.map((p) => p.freq)).toEqual(d);
  });
});

describe('THE COUNT IS THE PLACE', () => {
  test('the pan is the signed count over its own far station, and stays in the room', () => {
    for (const n of ALL) {
      const v = voiceOf(spectrumOf(n, 'A'));
      if (!v.struck) continue;
      expect(v.pan).toBeCloseTo(knotOf(n).q / 13, 10);
      expect(Math.abs(v.pan)).toBeLessThanOrEqual(1);
    }
  });

  test('a counter answers from the opposite side, by the involution alone', () => {
    for (const n of ALL) {
      const a = voiceOf(spectrumOf(n, 'A'));
      const b = voiceOf(spectrumOf(counterOf(n), 'A'));
      if (!a.struck || !b.struck) continue;
      expect(a.pan).toBeCloseTo(-b.pan, 10);
    }
  });

  test('the far stations reach the walls and the Seed would stand centre', () => {
    const far = ALL.filter((n) => Math.abs(knotOf(n).q) === 13);
    expect(far.length).toBeGreaterThan(0);
    for (const n of far) expect(Math.abs(voiceOf(spectrumOf(n, 'A')).pan)).toBe(1);
    expect(voiceOf({ struck: true, clarity: 1, card: 1, modes: [{ n: 3, m: 1, w: 1 }] }).pan).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE BEAT AS A NUMBER: a figure may throb at the rate the ear counts only
// if that rate is derived. Each partial carrying a motion sign is doubled by
// a twin a hair away, and the pair beats at freq · detune · |motion| hertz.
// ---------------------------------------------------------------------------
describe('THE BEAT RATE: the pulse the counter-rotation fixes', () => {
  test('nothing beating beats at nothing: silence, and the pure tunings', () => {
    expect(beatRateOf(null as never)).toBe(0);
    expect(beatRateOf({ struck: false, partials: [] } as never)).toBe(0);
    // a hand-made voice (the cycle's ticks) carries no motion: it stands still
    expect(beatRateOf({ struck: true, partials: [{ freq: 440, gain: 1, beat: 0 }] } as never)).toBe(0);
  });

  test('one beating partial beats at exactly freq · detune · |motion|', () => {
    const v = { struck: true, partials: [{ freq: 200, gain: 1, beat: 1 }] } as never;
    expect(beatRateOf(v)).toBeCloseTo(200 * BEAT_DEPTH, 10);
  });

  test('the sign is a direction, never a rate: counter-motions beat alike', () => {
    const up = { struck: true, partials: [{ freq: 300, gain: 1, beat: 1 }] } as never;
    const down = { struck: true, partials: [{ freq: 300, gain: 1, beat: -1 }] } as never;
    expect(beatRateOf(up)).toBeCloseTo(beatRateOf(down), 12);
  });

  test('the detune a voice carries governs it, and the mean is weighted by loudness', () => {
    const v = { struck: true, detune: 0.01,
      partials: [{ freq: 100, gain: 0.75, beat: 1 }, { freq: 500, gain: 0.25, beat: 1 }] } as never;
    // (0.75·1 + 0.25·5) / 1 = 2 hertz
    expect(beatRateOf(v)).toBeCloseTo(2, 10);
  });

  test('every struck card of the deck beats slowly enough to be counted', () => {
    for (const n of ALL) {
      const v = voiceOf(spectrumOf(n, 'A'));
      if (!v.struck) continue;
      const r = beatRateOf(v);
      expect(r).toBeGreaterThanOrEqual(0);
      // a throb the eye can follow: never a flicker
      expect(r).toBeLessThan(12);
    }
  });
});

// THE CROWDED BENCH, under test at last. The header above says the player
// "lives untested here by design", and that decision is exactly what let a
// real defect live: strike() counted every voice ever handed to the audio
// clock as a neighbour, and evicted by hushing at ctx.currentTime rather than
// at the evicted voice's own window. A procession hands a whole reading over
// in one synchronous tick, so twenty-one of a twenty-six card reading were
// erased before they ever sounded. The derivation being pure is no reason for
// the player to go unwatched; it only means the player needs a room to be
// watched in. This is that room: enough of Web Audio to be obeyed, and no more.
function fakeAudio() {
  const log: { hushes: { at: number }[] } = { hushes: [] };
  const mkParam = (owner: any) => ({
    value: 0,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
    setTargetAtTime(v: number, at: number) {
      // the signature of a hush: driven to silence at a named moment
      if (v <= 0.001) { owner.hushedAt = at; log.hushes.push({ at }); }
      return this;
    },
  });
  // THE ROOM REMEMBERS ITS OWN WIRING. Every node here records what it was
  // connected to, because the load-bearing claims in this module are not
  // about any node's settings but about WHERE each node sits: the mute door
  // and the catch below the listening tap, the hall's tail above it. A fake
  // whose connect() is a no-op cannot see any of that, and a suite that
  // cannot see it will pass a graph rewired the wrong way round.
  const nodes: any[] = [];
  const wire = (n: any, kind: string) => {
    n.kind = kind;
    n.outs = [] as any[];
    n.connect = (to: any) => { n.outs.push(to); return to; };
    n.disconnect = () => { n.outs.length = 0; };
    nodes.push(n);
    return n;
  };
  const mkGain = () => {
    const g: any = { hushedAt: null };
    g.gain = mkParam(g);
    return wire(g, 'gain');
  };
  const ctx: any = {
    currentTime: 0,
    state: 'running',
    destination: wire({}, 'destination'),
    resume() {}, close() { ctx.closed = true; },
    closed: false,
    nodes,
    createGain: mkGain,
    createAnalyser: () => wire({ fftSize: 2048, smoothingTimeConstant: 0,
      getByteTimeDomainData: (b: Uint8Array) => b.fill(128) }, 'analyser'),
    // enough of a room to build a hall in: the convolver and the buffer it
    // wants, recorded so the pins can look at what was actually made
    sampleRate: 48000,
    createConvolver: () => {
      const c: any = wire({ normalize: true, buffer: null }, 'convolver');
      ctx.convolvers.push(c); return c;
    },
    createBuffer: (channels: number, length: number, rate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const b: any = { numberOfChannels: channels, length, sampleRate: rate,
        getChannelData: (i: number) => data[i] };
      ctx.buffers.push(b); return b;
    },
    convolvers: [] as any[],
    buffers: [] as any[],
    // the shutter and the catch, likewise recorded rather than swallowed.
    // The shutter's frequency is a param that REMEMBERS: the closing is a
    // scheduled travel, so a pin that cannot see the ramp cannot see the law,
    // and it remembers WHEN as well as how far, since a travel that lands at
    // the wrong moment is as wrong as one that lands in the wrong place.
    createBiquadFilter: () => {
      const held: number[] = [];
      const ramps: { to: number; at: number }[] = [];
      const freq: any = {
        value: 350, held, ramps,
        setValueAtTime(v: number) { freq.value = v; held.push(v); return freq; },
        linearRampToValueAtTime(v: number, at: number) { ramps.push({ to: v, at }); return freq; },
        exponentialRampToValueAtTime(v: number, at: number) { ramps.push({ to: v, at }); return freq; },
        cancelScheduledValues() { return freq; },
        setTargetAtTime() { return freq; },
      };
      const f: any = wire({ type: 'lowpass', frequency: freq, Q: { value: 1 } }, 'filter');
      ctx.filters.push(f); return f;
    },
    createDynamicsCompressor: () => {
      const c: any = wire({ threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 },
        attack: { value: 0.003 }, release: { value: 0.25 } }, 'compressor');
      ctx.caps.push(c); return c;
    },
    filters: [] as any[],
    caps: [] as any[],
    createOscillator: () => wire({ type: 'sine', frequency: { value: 0 }, onended: null,
      start: () => {}, stop: () => {} }, 'oscillator'),
  };
  return { ctx, log, gains: mkGain };
}

// THE WALK: which nodes can a signal leaving `from` ever arrive at. Every
// placement law in this module is a statement about reachability, so this is
// the one helper they all share.
function downstream(from: any): Set<any> {
  const seen = new Set<any>();
  const walk = (n: any) => {
    for (const to of (n && n.outs) || []) {
      if (seen.has(to)) continue;
      seen.add(to);
      walk(to);
    }
  };
  walk(from);
  return seen;
}
const reaches = (from: any, to: any) => downstream(from).has(to);

describe('THE CROWDED BENCH: a voice is never erased before it sounds', () => {
  // rebuilt per test so no context leaks between them
  const withRoom = (fn: (s: any, ctx: any, created: any[]) => void) => {
    const { ctx } = fakeAudio();
    const created: any[] = [];
    const realCreateGain = ctx.createGain;
    ctx.createGain = () => { const g = realCreateGain(); created.push(g); return g; };
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try { fn(createSounder(), ctx, created); }
    finally { (globalThis as any).window = prevWindow; }
  };

  test('a whole reading handed over in one tick still sounds, every card', () => {
    withRoom((sounder, ctx, created) => {
      // the procession exactly as THE RESONANCE issues it: 26 struck cards,
      // one synchronous loop, windows from 0.12s out past 13s
      const windows: { t0: number; g: any }[] = [];
      let when = 0.12;
      for (let n = 1; n <= 27; n++) {
        const voice = voiceOf(spectrumOf(n, 'A'));
        if (!voice.struck) continue;                 // the Silences decline
        const before = created.length;
        const res = sounder.strike(voice, when, 1);
        expect(res, 'a struck card must report its window').toBeTruthy();
        windows.push({ t0: (res as any).t0, g: created[before] });
        when += 0.42;
      }
      expect(windows.length).toBeGreaterThan(20);

      // THE LAW: nothing is hushed before its own window opens. This is the
      // precise defect: hushing at ctx.currentTime (0) erased envelopes whose
      // t0 was seconds away, so the card never sounded at all.
      for (const w of windows) {
        if (w.g.hushedAt !== null) {
          expect(w.g.hushedAt, 'a voice was hushed before it sounded').toBeGreaterThanOrEqual(w.t0);
        }
      }
      // said as the defect itself, so the pin names what went wrong: before
      // the fix, twenty-one of these were erased at ctx.currentTime while
      // their own windows were still seconds away
      const killedEarly = windows.filter((w) => w.g.hushedAt !== null && w.g.hushedAt < w.t0);
      expect(killedEarly.length, 'voices erased before they sounded').toBe(0);

      // and the bench still does its work: genuine overlaps DO step aside, so
      // this is a cap on simultaneity, not a licence for everything to ring at
      // once. Measured here: 5 of 23 step aside, all of them after sounding.
      const stepped = windows.filter((w) => w.g.hushedAt !== null).length;
      expect(stepped, 'the crowd law must still bound simultaneity').toBeGreaterThan(0);
      expect(stepped, 'but must never evict a whole procession').toBeLessThan(windows.length / 2);
    });
  });

  test('silence() stills every voice and leaves the room standing', () => {
    withRoom((sounder, ctx, created) => {
      let when = 0.12;
      for (let n = 1; n <= 9; n++) {
        const voice = voiceOf(spectrumOf(n, 'A'));
        if (voice.struck) { sounder.strike(voice, when, 1); when += 0.42; }
      }
      const before = created.filter((g) => g.hushedAt !== null).length;
      sounder.silence();
      const after = created.filter((g) => g.hushedAt !== null).length;
      expect(after, 'silence must hush what was still ringing').toBeGreaterThan(before);
      // the near half of destroy(): the context survives, so the next gesture
      // does not have to build a room again, and the tap keeps measuring
      expect(ctx.closed, 'silence must not close the context').toBe(false);
    });
  });
});

// EVERY ENVELOPE CLOSES is a law about the whole sounding, not about the
// sounder alone. A page that hands seconds of audio to the clock in one tick
// owns a promise it cannot keep by clearing its own timers: the voices arrive
// on schedule whether or not the lights are still lit. Both pages below made
// exactly that mistake, in the same shape, so both are watched here together.
describe('EVERY ENVELOPE CLOSES: a stop button must mean the sound too', () => {
  const read = (page: string) => {
    const fs = require('node:fs');
    const path = require('node:path');
    return fs.readFileSync(
      path.resolve(import.meta.dir, '..', '..', 'spatial', 'app', page), 'utf8');
  };

  test('the sounder offers a silence that does not close the room', () => {
    const src = read('luminara-sound.js');
    expect(src).toMatch(/silence\(\)\s*\{/);
    // silence() must hush the ringing WITHOUT closing the context: that is
    // the whole difference between it and destroy(), and the reason a stop
    // button can use it without costing the tap and the next gesture's room
    // match the DEFINITIONS, not the prose: the comment above silence() names
    // destroy(), so searching for the bare word ran the slice backwards
    const from = src.indexOf('silence() {');
    const body = src.slice(from, src.indexOf('destroy() {', from));
    expect(body.length, 'silence() must be defined before destroy()').toBeGreaterThan(0);
    expect(body).toContain('ringing.splice(0)');
    expect(body.includes('ctx.close()'), 'silence must not close the context').toBe(false);
  });

  test('THE RESONANCE stills the voices, not only the lights', () => {
    const src = read('luminara-resonance.html');
    const stop = src.slice(src.indexOf('function latStop()'),
      src.indexOf('function latPlayReading()'));
    expect(stop, 'latStop clears its timers').toContain('clearTimeout');
    expect(stop, 'latStop must also still the sound').toMatch(/sounder\.silence\(\)/);
  });

  test("THE ONE's rest closes the beats it scheduled, not just the pad", () => {
    const src = read('luminara-the-one.html');
    // the beats bypass the pad's own gain and feed the delay line directly,
    // so the pad must own them explicitly or releasing it cannot reach them
    expect(src).toMatch(/beats:\s*\[\]/);
    expect(src).toMatch(/pad\.beats\.push/);
    const rel = src.slice(src.indexOf('release() {'), src.indexOf('// the beats, denser'));
    expect(rel, 'release must stop the scheduled beat oscillators').toMatch(/this\.beats/);
  });
});

// ---------------------------------------------------------------------------
// THE HALL (2026-08-03). A dial, not a derivation, and pinned as one: what is
// tested is not that the room is the right size but that it is wired where it
// claims to be. The two placement laws carry the weight. The tap must hear the
// tail, or a figure breathing with the air would stop breathing while the hall
// still spoke. The mute door must stay downstream of the tap, so closing the
// room silences the speakers and nothing else. Both are checked by following
// the actual graph the sounder builds in a room made for the purpose.
// ---------------------------------------------------------------------------
describe('THE HALL: the room the sounding is heard in', () => {
  const withRoom = (fn: (s: any, ctx: any) => void) => {
    const { ctx } = fakeAudio();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try { fn(createSounder(), ctx); }
    finally { (globalThis as any).window = prevWindow; }
  };

  test('the dial is remembered before a room exists, and answers itself', () => {
    const s = createSounder();                 // no context: nothing built yet
    expect(s.reverb()).toBe(0);                // dry until asked
    expect(s.setReverb(0.5)).toBe(0.5);
    expect(s.reverb()).toBe(0.5);
    expect(s.setReverb(9)).toBe(1);            // held inside its own range
    expect(s.setReverb(-3)).toBe(0);
  });

  test('the hall is built once the room is, and carries an impulse of its own', () => {
    withRoom((s, ctx) => {
      s.setReverb(0.6);
      s.strike(voiceOf(spectrumOf(14, 'A')), 0, 1);   // the first gesture opens the context
      expect(ctx.convolvers.length).toBe(1);
      const ir = ctx.convolvers[0].buffer;
      expect(ir, 'the convolver must carry an impulse').toBeTruthy();
      expect(ir.numberOfChannels, 'two ears, so the room has width').toBe(2);
      expect(ir.length).toBeGreaterThan(ctx.sampleRate);   // a real tail, seconds long
      // the tail decays rather than standing: late is quieter than early
      const d = ir.getChannelData(0);
      const early = Math.abs(d[Math.floor(ir.length * 0.05)]);
      const late = Math.abs(d[Math.floor(ir.length * 0.9)]);
      expect(late).toBeLessThan(early);
      // and the two ears differ, or the room would be a corridor
      expect(ir.getChannelData(1)[1000]).not.toBe(d[1000]);
    });
  });

  // the two legs found by following the wiring rather than by being told:
  // the WET leg is whatever the convolver feeds, and the DRY leg is the other
  // thing the master feeds, the master itself being what reaches the hall's
  // clearance filter. Nothing here knows a variable name in the module.
  const legs = (ctx: any) => {
    const conv = ctx.convolvers[0];
    const wet = conv.outs[0];
    const feeds = (t: any) => ctx.nodes.filter((n: any) => n.outs.includes(t));
    const master = feeds(feeds(conv)[0])[0] || feeds(conv)[0];
    const dry = master.outs.find((n: any) => n.kind === 'gain' && n !== wet);
    return { conv, wet, dry, master };
  };

  test('equal power: the dial changes the room, never the loudness', () => {
    withRoom((s, ctx) => {
      s.strike(voiceOf(spectrumOf(14, 'A')), 0, 1);
      const { dry, wet } = legs(ctx);
      expect(dry, 'a dry leg').toBeTruthy();
      expect(wet, 'a wet leg').toBeTruthy();
      // THE PIN READS THE NODES, not the arithmetic. An earlier cut of this
      // asserted cos squared plus sine squared is one, which is true of every
      // real number and so passed with applyReverb gutted entirely: the dial
      // could have been wholly disconnected from the sounding and the suite
      // would have said nothing. What has to be true is that the two legs the
      // sounder actually built carry those values.
      const seen: number[] = [];
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        s.setReverb(v);
        const a = v * Math.PI / 2;
        expect(dry.gain.value, 'the dry leg at ' + v).toBeCloseTo(Math.cos(a), 9);
        expect(wet.gain.value, 'the wet leg at ' + v).toBeCloseTo(Math.sin(a), 9);
        expect(dry.gain.value ** 2 + wet.gain.value ** 2,
          'equal power at ' + v).toBeCloseTo(1, 9);
        seen.push(wet.gain.value);
      }
      // and the dial genuinely travels: a wet leg pinned at one value would
      // satisfy every equality above if the cosine happened to match
      expect(seen[0], 'dry at rest').toBeCloseTo(0, 9);
      expect(seen[seen.length - 1], 'wholly in the room at full').toBeCloseTo(1, 9);
      expect(new Set(seen).size, 'five settings, five rooms').toBe(5);
      expect(s.reverb()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // WHERE EACH THING SITS. These are the load-bearing claims of the whole
  // module and until now they lived only in comments: measured against a room
  // that recorded no edges, moving the tap behind the mute door passed every
  // pin in the suite. The three laws, each a statement about reachability:
  //   · the mute door is BELOW the tap, so closing the room silences the
  //     loudspeakers and nothing else, and a figure that breathes with the air
  //     keeps breathing truthfully with the sound off
  //   · the catch is BELOW the tap, for the same reason: it is a fact about
  //     the loudspeakers, and the drawn breath must be what was played
  //   · the hall is ABOVE it, because a tail still ringing is still air in the
  //     room, and a breath that stopped while the hall spoke would be a lie
  // -------------------------------------------------------------------------
  test('the mute door and the catch sit below the tap; the hall sits above it', () => {
    withRoom((s, ctx) => {
      s.setReverb(0.5);
      s.strike(voiceOf(spectrumOf(14, 'A')), 0, 1);
      const tap = ctx.nodes.find((n: any) => n.kind === 'analyser');
      const cap = ctx.caps[0];
      const conv = ctx.convolvers[0];
      expect(tap, 'there is a tap').toBeTruthy();
      // the door is whatever feeds the loudspeakers, found by the wiring
      const door = ctx.nodes.filter((n: any) => n.outs.includes(ctx.destination));
      expect(door.length, 'one door to the loudspeakers').toBe(1);
      expect(reaches(door[0], tap),
        'the mute door must not be able to reach the tap').toBe(false);
      expect(reaches(cap, tap),
        'the catch must not be able to reach the tap').toBe(false);
      expect(reaches(conv, tap),
        'the hall must reach the tap: its tail is still air in the room').toBe(true);
      // and the sounding does arrive at both: the ear and the eye are fed
      const { master } = legs(ctx);
      expect(reaches(master, tap), 'what is played is measured').toBe(true);
      expect(reaches(master, ctx.destination), 'what is played is heard').toBe(true);
      expect(reaches(master, cap), 'and it is caught on the way out').toBe(true);
    });
  });

  test('the hall is cleared of rumble on the wet leg only', () => {
    withRoom((s, ctx) => {
      s.strike(voiceOf(spectrumOf(14, 'A')), 0, 1);
      const { dry, master, conv } = legs(ctx);
      const highs = ctx.filters.filter((f: any) => f.type === 'highpass');
      expect(highs.length, 'one clearance').toBe(1);
      expect(reaches(highs[0], conv), 'it stands before the hall').toBe(true);
      expect(reaches(master, highs[0]), 'and after the sounding').toBe(true);
      expect(reaches(dry, highs[0]), 'the dry path never passes through it').toBe(false);
    });
  });

  test('a context with no convolver simply runs dry, and everything else stands', () => {
    const { ctx } = fakeAudio();
    delete (ctx as any).createConvolver;             // an older room
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try {
      const s = createSounder();
      s.setReverb(1);
      const res = s.strike(voiceOf(spectrumOf(14, 'A')), 0, 1);
      expect(res, 'the sounding must survive a room with no hall').toBeTruthy();
      expect(s.reverb()).toBe(1);                    // the dial still remembers
      expect(ctx.convolvers.length).toBe(0);         // nothing was built
    } finally { (globalThis as any).window = prevWindow; }
  });
});

// ---------------------------------------------------------------------------
// THE SHUTTER: clarity heard as brightness, not only as length.
//
// Why this needs pinning rather than eyeballing: the first cut of this law
// anchored its cutoff to each card's LOWEST partial, which reads sensibly and
// is inert in practice. Twenty of the twenty-six struck cards sound a single
// partial, so lowest and highest are the same number and the cutoff always
// landed above every tone the card had, leaving the wave's harmonics (where
// the brightness actually lives) untouched. Measured, it moved the spectral
// centroid by under a decibel. Re-anchored to the HIGHEST partial it moves the
// Ray from 4430 Hz to 1197, and still takes nothing from any fundamental.
// These pins hold both halves of that: it bites, and it never bites a tone.
// ---------------------------------------------------------------------------
describe('THE SHUTTER: the far dissonance is dull, the lock is bright', () => {
  const withRoom = (fn: (s: any, ctx: any) => void) => {
    const { ctx } = fakeAudio();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try { fn(createSounder(), ctx); }
    finally { (globalThis as any).window = prevWindow; }
  };
  // the shutters only, told apart from the hall's own high pass on the wet leg
  const shutters = (ctx: any) => ctx.filters.filter((f: any) => f.type === 'lowpass');

  test('a card never loses a tone it was given', () => {
    withRoom((sounder, ctx) => {
      for (let n = 1; n <= 27; n++) {
        const voice = voiceOf(spectrumOf(n, 'A'));
        if (!voice.struck) continue;
        const before = shutters(ctx).length;
        sounder.strike(voice, 0.1, 1);
        const made = shutters(ctx).slice(before);
        expect(made.length, 'every struck voice passes a shutter').toBe(1);
        const top = Math.max(...voice.partials.map((p: any) => p.freq));
        expect(made[0].frequency.held[0],
          'the cutoff clears the card\'s own highest partial').toBeGreaterThan(top);
        expect(made[0].Q.value,
          'a shutter, not a resonance: no peak at the corner').toBeCloseTo(0.707, 3);
        // and the travel, wherever it ends, never closes past the tone
        for (const r of made[0].frequency.ramps) {
          expect(r.to, 'the closing stops above the tone').toBeGreaterThanOrEqual(top);
        }
      }
    });
  });

  test('the cutoff rises with clarity, and opens fully at a lock', () => {
    withRoom((sounder, ctx) => {
      const seen: { c: number; cut: number }[] = [];
      for (let n = 1; n <= 27; n++) {
        const voice = voiceOf(spectrumOf(n, 'A'));
        if (!voice.struck) continue;
        const before = shutters(ctx).length;
        sounder.strike(voice, 0.1, 1);
        seen.push({ c: voice.clarity, cut: shutters(ctx)[before].frequency.held[0] });
      }
      // the far dissonance is closed in and the lock is wide open
      const dull = seen.reduce((a, b) => (b.c < a.c ? b : a));
      const lock = seen.filter((s) => s.c === 1);
      expect(lock.length, 'the deck holds locks').toBeGreaterThan(0);
      lock.forEach((s) => expect(s.cut, 'full clarity is open air').toBeCloseTo(18000, 0));
      expect(dull.cut, 'the far dissonance is shuttered well below').toBeLessThan(4000);
      const sorted = [...seen].sort((a, b) => a.c - b.c);
      expect(sorted[0].cut, 'the dullest is not the brightest')
        .toBeLessThan(sorted[sorted.length - 1].cut);
    });
  });

  test('a room without filters still sounds, unshuttered', () => {
    const { ctx } = fakeAudio();
    delete ctx.createBiquadFilter;
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try {
      const s = createSounder();
      const voice = voiceOf(spectrumOf(14, 'A'));    // the Scar, the dullest card
      expect(s.strike(voice, 0.1, 1), 'the voice still reaches the room').toBeTruthy();
    } finally { (globalThis as any).window = prevWindow; }
  });
});

// ---------------------------------------------------------------------------
// THE CATCH AND THE CLEARED HALL. Two pieces of protection, both placed by the
// same rule the mute already follows: anything that is a fact about the
// loudspeakers rather than about the sounding sits DOWNSTREAM of the listening
// tap, so what is drawn is still what was played.
// ---------------------------------------------------------------------------
describe('THE CATCH: the room is protected, the reading is not altered', () => {
  const build = (fn: (s: any, ctx: any) => void) => {
    const { ctx } = fakeAudio();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try { fn(createSounder(), ctx); }
    finally { (globalThis as any).window = prevWindow; }
  };

  test('one catch, set to hold rather than to squash', () => {
    build((sounder, ctx) => {
      sounder.strike(voiceOf(spectrumOf(14, 'A')), 0.1, 1);
      expect(ctx.caps.length, 'exactly one catch on the way out').toBe(1);
      const cap = ctx.caps[0];
      expect(cap.ratio.value, 'a limiter, not a compressor').toBeGreaterThanOrEqual(20);
      expect(cap.knee.value, 'hard: below the ceiling nothing is touched').toBe(0);
      expect(cap.threshold.value, 'headroom left under the ceiling').toBeLessThan(0);
      expect(cap.attack.value, 'fast enough to catch a struck transient')
        .toBeLessThanOrEqual(0.005);
    });
  });

  test('the hall alone is cleared of rumble; the strike is untouched', () => {
    build((sounder, ctx) => {
      sounder.strike(voiceOf(spectrumOf(14, 'A')), 0.1, 1);
      const highs = ctx.filters.filter((f: any) => f.type === 'highpass');
      expect(highs.length, 'one clearance, on the wet leg only').toBe(1);
      expect(highs[0].frequency.value,
        'below where the deck\'s lowest partial sits').toBeLessThan(120);
    });
  });
});

// ---------------------------------------------------------------------------
// THE CLOSING (2026-08-10). A far dissonance does not merely start dull, it
// comes apart as it goes, so the shutter travels further shut across the ring
// and the travel is the dissonance's own share of its opening. Two halves have
// to hold together: a lock must not move at all, and no voice may be closed
// past the tone it was given.
// ---------------------------------------------------------------------------
describe('THE CLOSING: the dissonance comes apart as it dies', () => {
  const withRoom = (fn: (s: any, ctx: any) => void) => {
    const { ctx } = fakeAudio();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try { fn(createSounder(), ctx); }
    finally { (globalThis as any).window = prevWindow; }
  };
  const shutters = (ctx: any) => ctx.filters.filter((f: any) => f.type === 'lowpass');
  const top = (v: any) => Math.max(...v.partials.map((p: any) => p.freq));

  test('a lock does not move; a far dissonance travels far', () => {
    withRoom((sounder, ctx) => {
      const travel: { c: number; from: number; to: number }[] = [];
      for (let n = 1; n <= 27; n++) {
        const voice = voiceOf(spectrumOf(n, 'A'));
        if (!voice.struck) continue;
        const before = shutters(ctx).length;
        sounder.strike(voice, 0.1, 1);
        const f = shutters(ctx)[before];
        const from = f.frequency.held[0];
        travel.push({ c: voice.clarity, from,
          to: f.frequency.ramps.length ? f.frequency.ramps[0].to : from });
      }
      const locks = travel.filter((t) => t.c === 1);
      expect(locks.length, 'the deck holds locks').toBeGreaterThan(0);
      locks.forEach((t) =>
        expect(t.to, 'a lock is clear when struck and clear when it dies').toBe(t.from));
      const dull = travel.reduce((a, b) => (b.c < a.c ? b : a));
      expect(dull.to, 'the far dissonance shuts as it goes').toBeLessThan(dull.from * 0.6);
      // and the travel is ordered by clarity: the less clear, the further it closes
      const share = travel.map((t) => ({ c: t.c, shut: t.to / t.from }))
        .sort((a, b) => a.c - b.c);
      expect(share[0].shut, 'the dullest closes furthest')
        .toBeLessThan(share[share.length - 1].shut);
    });
  });

  test('no card in the deck is ever closed onto its own tone', () => {
    withRoom((sounder, ctx) => {
      for (let n = 1; n <= 27; n++) {
        const voice = voiceOf(spectrumOf(n, 'A'));
        if (!voice.struck) continue;
        const before = shutters(ctx).length;
        sounder.strike(voice, 0.1, 1);
        for (const r of shutters(ctx)[before].frequency.ramps) {
          expect(r.to, 'card ' + n + ' keeps its tone to the end').toBeGreaterThan(top(voice));
        }
      }
    });
  });

  test('the travel lasts exactly the ring, so nothing is taken while it speaks', () => {
    withRoom((sounder, ctx) => {
      // ctx.currentTime is nought in this room, so a window handed in is the
      // absolute moment. The law: the closing begins when the voice speaks and
      // ends where the envelope has already run out, which is t0 plus the ring.
      const voice = voiceOf(spectrumOf(14, 'A'));
      for (const [when, sustain] of [[0, 1], [0.4, 1], [0.1, 3]] as [number, number][]) {
        const before = shutters(ctx).length;
        sounder.strike(voice, when, sustain);
        const r = shutters(ctx)[before].frequency.ramps;
        expect(r.length, 'the dull card travels').toBe(1);
        expect(r[0].at, 'the travel ends with the ring, at ' + when + ' by ' + sustain)
          .toBeCloseTo(when + voice.decay * sustain, 9);
      }
    });
  });

  test('a held voice does not travel under the finger, only at the release', () => {
    withRoom((sounder, ctx) => {
      const voice = voiceOf(spectrumOf(14, 'A'));      // the Scar, the dullest card
      const before = shutters(ctx).length;
      const h: any = sounder.hold(voice);
      const f = shutters(ctx)[before];
      expect(f.frequency.ramps.length, 'held: the shutter stands still').toBe(0);
      h.release();
      expect(f.frequency.ramps.length, 'released: the closing begins').toBe(1);
      expect(f.frequency.ramps[0].to, 'and it closes').toBeLessThan(f.frequency.held[0]);
      // and it takes the ring the release grants it, not an instant and not
      // an age: a travel landing at the wrong moment is as wrong as one
      // landing in the wrong place
      expect(f.frequency.ramps[0].at, 'over the voice own decay')
        .toBeCloseTo(voice.decay, 9);
    });
  });
});

// ---------------------------------------------------------------------------
// THE HAND: the dials that are the player's rather than the card's. The point
// of pinning these is the REST POSITION. Each dial rests at the law it
// modifies, so an untouched instrument sounds exactly what the canon derives;
// a bench that quietly started somewhere other than the law would make every
// reading taken on it a reading of the bench.
// ---------------------------------------------------------------------------
describe('THE HAND: every dial rests at the law', () => {
  const withRoom = (fn: (s: any, ctx: any) => void) => {
    const { ctx } = fakeAudio();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = { AudioContext: function () { return ctx; } };
    try { fn(createSounder(), ctx); }
    finally { (globalThis as any).window = prevWindow; }
  };
  const shutters = (ctx: any) => ctx.filters.filter((f: any) => f.type === 'lowpass');

  test('an untouched bench is the canon, dry', () => {
    withRoom((sounder) => {
      expect(sounder.hand()).toEqual(
        { hall: 0, stone: HALL_SECONDS, shutter: 1, closing: 1, edge: 0 });
    });
  });

  test('the dials are clamped, and answer with what they took', () => {
    withRoom((sounder) => {
      expect(sounder.setShutter(5)).toBe(1);
      expect(sounder.setClosing(-3)).toBe(0);
      expect(sounder.setEdge(0.5)).toBe(0.5);
      expect(sounder.setStone(99)).toBe(STONE_MAX);
      expect(sounder.setStone(0)).toBe(STONE_MIN);
      expect(sounder.hand()).toEqual(
        { hall: 0, stone: STONE_MIN, shutter: 1, closing: 0, edge: 0.5 });
    });
  });

  test('the shutter at none is the law off, and the closing with it', () => {
    withRoom((sounder, ctx) => {
      sounder.setShutter(0);
      sounder.strike(voiceOf(spectrumOf(14, 'A')), 0.1, 1);   // the dullest card
      const f = shutters(ctx)[0];
      expect(f.frequency.held[0], 'open air: nothing is touched').toBeCloseTo(18000, 0);
      expect(f.frequency.ramps.length, 'and nothing travels').toBe(0);
    });
  });

  test('the closing alone can be stilled, leaving the opening standing', () => {
    withRoom((sounder, ctx) => {
      const voice = voiceOf(spectrumOf(14, 'A'));
      sounder.strike(voice, 0.1, 1);
      const lawful = shutters(ctx)[0];
      sounder.setClosing(0);
      sounder.strike(voice, 0.2, 1);
      const still = shutters(ctx)[1];
      expect(still.frequency.held[0], 'struck just as dull as before')
        .toBeCloseTo(lawful.frequency.held[0], 6);
      expect(still.frequency.ramps.length, 'and now it holds where it was struck').toBe(0);
    });
  });

  test('the edge gives the shutter a ring, and rests without one', () => {
    withRoom((sounder, ctx) => {
      const voice = voiceOf(spectrumOf(14, 'A'));
      sounder.strike(voice, 0.1, 1);
      expect(shutters(ctx)[0].Q.value, 'at rest, no peak').toBeCloseTo(0.707, 3);
      sounder.setEdge(1);
      sounder.strike(voice, 0.2, 1);
      expect(shutters(ctx)[1].Q.value, 'wide open, the corner sings').toBeGreaterThan(7);
    });
  });

  test('the stone resizes a live room rather than building a second one', () => {
    withRoom((sounder, ctx) => {
      sounder.strike(voiceOf(spectrumOf(14, 'A')), 0.1, 1);
      expect(ctx.convolvers.length, 'one hall').toBe(1);
      const first = ctx.convolvers[0].buffer.length;
      sounder.setStone(STONE_MAX);
      expect(ctx.convolvers.length, 'still one hall: resized, not replaced').toBe(1);
      expect(ctx.convolvers[0].buffer.length, 'a larger stone').toBeGreaterThan(first);
      expect(ctx.convolvers[0].buffer.numberOfChannels, 'and still two ears').toBe(2);
    });
  });
});
