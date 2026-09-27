// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE INSTRUMENT ENGINE, PINNED. The disassembly's first dividend: the
// strike logic lived in a page and could only be probed by hand in a
// browser; as a module it takes pins. A fake sounder stands in for the
// audio line (the engine never asks it for more than strike/now), and the
// laws the Sounding has kept by hand are now kept by test: the Seed is the
// rest in every mode, the crowd cap of five, IN CONCORD's mirror and its
// two refusals, the cycle's tick arithmetic and its cap of three, and the
// superposition weighted by each strike's own envelope.

import { describe, test, expect } from 'bun:test';
import { createInstrument, BAR, SETTLE_S, MORPH_S } from '../../spatial/app/luminara-instrument.js';
import { counterOf, becomingOf } from '../../spatial/app/luminara-canon.js';
import { tracePoint, SHELL, shellStanding, knotProject, KNOT_FRAME, knotFrameFor,
  KNOT_TILT } from '../../spatial/app/luminara-stages.js';
import { GROUND_HZ } from '../../spatial/app/luminara-sound.js';

function fakeSounder() {
  return {
    t: 0,
    strikes: [] as Array<{ voice: any; when: number; sustain: number }>,
    releases: 0,
    strike(voice: any, when = 0, sustain = 1) {
      this.strikes.push({ voice, when, sustain });
      return { t0: this.t + when, dur: voice.decay * (sustain > 0 ? sustain : 1) };
    },
    hold(voice: any) {
      this.strikes.push({ voice, when: 0, sustain: Infinity });
      const self = this;
      return { t0: this.t, release() { self.releases++; } };
    },
    now() { return this.t; },
  };
}
const rig = () => {
  const sounder = fakeSounder();
  const engine = createInstrument({ sounder, defer: () => {} });
  return { sounder, engine };
};

describe('THE STRIKE — the air and its laws', () => {
  test('a strike joins the ringing; the crowd cap holds at five', () => {
    const { engine } = rig();
    for (const n of [2, 3, 4, 5, 6, 7]) engine.strike(n);
    expect(engine.ringing.length).toBe(5);
    expect(engine.ringing[0].n).toBe(3);   // the oldest bowed out
  });

  test('the Seed is the rest: ringing cleared, stages told, gain to zero', () => {
    const { engine } = rig();
    const calls: string[] = [];
    engine.addStage({ rest: () => calls.push('rest'), gain: (g: number) => calls.push('gain' + g) });
    engine.strike(14);
    engine.strike(1);
    expect(engine.ringing.length).toBe(0);
    expect(calls).toContain('rest');
    expect(calls[calls.length - 1]).toBe('gain0');
  });

  test('IN CONCORD answers with the mirror, refuses the Seed, sleeps in the cycle', () => {
    const { engine } = rig();
    engine.setConcord(true);
    engine.strike(19);
    expect(engine.ringing.map((e: any) => e.n)).toEqual([19, counterOf(19)]);
    engine.strike(1);   // the rest, never doubled
    expect(engine.ringing.length).toBe(0);
    engine.setMode('cycle');
    engine.strike(4);
    expect(engine.loops.size).toBe(1);   // one loop, no mirror loop
  });

  test('the superposition weights by each strike\'s remaining envelope', () => {
    const { sounder, engine } = rig();
    let seen: any[] = [];
    engine.addStage({ spectrum: (m: any[]) => { seen = m; } });
    engine.strike(22);
    const e = engine.ringing[0];
    sounder.t = e.dur / 2;   // half the window gone
    engine.recompose();
    expect(seen.length).toBeGreaterThan(0);
    // every recomposed weight is half its source weight
    for (const md of seen) expect(md.w).toBeCloseTo(engine.ringing[0].spec.modes
      .find((s: any) => s.n === md.n && s.m === md.m).w * 0.5, 5);
    sounder.t = e.dur + 0.01;   // the window closed
    engine.recompose();
    expect(engine.ringing.length).toBe(0);
  });
});

describe('THE CYCLE — the knot as rhythm', () => {
  test('the tick arithmetic: the hemiola and the impossible twenty', () => {
    const { engine } = rig();
    engine.setMode('cycle');
    engine.strike(4);    // The Resonance T(2,3)
    engine.strike(14);   // The Scar T(7,13)
    expect(engine.loops.get(4).ticks.length).toBe(5);
    expect(engine.loops.get(14).ticks.length).toBe(20);
    expect(engine.loops.get(4).p).toBe(2);
    expect(engine.loops.get(4).aq).toBe(3);
  });

  test('three loops at most; a repeat toggles off; the Seed clears the bar', () => {
    const { engine } = rig();
    engine.setMode('cycle');
    for (const n of [4, 14, 22, 19]) engine.strike(n);
    expect(engine.loops.size).toBe(3);            // the fourth refused
    engine.strike(4);
    expect(engine.loops.has(4)).toBe(false);      // toggled off
    engine.strike(1);
    expect(engine.loops.size).toBe(0);            // the rest clears the bar
    expect(engine.cycle.active()).toBe(false);
  });

  test('the pump schedules real ticks on the two lines: the ground and the fundamental', () => {
    const { sounder, engine } = rig();
    engine.setMode('cycle');
    engine.strike(4);
    sounder.strikes.length = 0;
    engine.pump();
    expect(sounder.strikes.length).toBeGreaterThan(0);
    const freqs = new Set(sounder.strikes.map((s) => s.voice.partials[0].freq));
    for (const f of freqs) {
      expect(f === GROUND_HZ || f > 0).toBe(true);
    }
    // every scheduled tick lands inside the lookahead horizon
    for (const s of sounder.strikes) expect(s.when).toBeLessThan(0.45);
  });

  test('leaving the cycle clears the bar; entering it silences the ringing', () => {
    const { engine } = rig();
    engine.strike(22);
    expect(engine.ringing.length).toBe(1);
    engine.setMode('cycle');
    expect(engine.ringing.length).toBe(0);
    engine.strike(22);
    expect(engine.loops.size).toBe(1);
    engine.setMode('strike');
    expect(engine.loops.size).toBe(0);
  });
});

describe('THE HOLD — the key under the finger, chords under the hand', () => {
  test('a held voice stands at full envelope for as long as it is held', () => {
    const { sounder, engine } = rig();
    let seen: any[] = [];
    engine.addStage({ spectrum: (m: any[]) => { seen = m; } });
    // a SETTLED card, so the hold is testing the envelope alone: an
    // unsettled one would begin its becoming and rightly change its modes
    const settled = [...Array(27)].map((_, i) => i + 1)
      .find((n) => n !== 1 && becomingOf(n) === null)!;
    engine.press(settled);
    sounder.t = 60;   // a minute under the finger
    engine.recompose();
    expect(engine.ringing.length).toBe(1);
    expect(engine.ringing[0].n).toBe(settled);   // settled: it stands
    for (const md of seen) expect(md.w).toBeCloseTo(engine.ringing[0].spec.modes
      .find((s: any) => s.n === md.n && s.m === md.m).w, 5);
  });

  test('release lets it ring at its own decay, then it is gone', () => {
    const { sounder, engine } = rig();
    engine.press(22);
    sounder.t = 3;
    engine.release(22);
    expect(sounder.releases).toBe(1);
    expect(engine.ringing[0].held).toBe(false);
    sounder.t = 3 + engine.ringing[0].dur + 0.01;
    engine.recompose();
    expect(engine.ringing.length).toBe(0);
  });

  test('chords: several keys held at once, each its own voice', () => {
    const { engine } = rig();
    engine.press(4); engine.press(14); engine.press(22);
    expect(engine.ringing.length).toBe(3);
    expect(engine.ringing.every((e: any) => e.held)).toBe(true);
    engine.release(14);
    expect(engine.ringing.filter((e: any) => e.held).length).toBe(2);
  });

  test('a repeat press of a held key does not double the voice', () => {
    const { engine } = rig();
    engine.press(22); engine.press(22);
    expect(engine.ringing.length).toBe(1);
  });

  test('the mirror strike names its partner, so a stage can braid the pair', () => {
    const { engine } = rig();
    const calls: Array<[number, number | undefined]> = [];
    engine.addStage({ strike: (n: number, _s: any, pairOf?: number) => calls.push([n, pairOf]) });
    engine.setConcord(true);
    engine.strike(19);
    expect(calls).toEqual([[19, undefined], [counterOf(19), 19]]);
    calls.length = 0;
    engine.press(4);
    expect(calls).toEqual([[4, undefined], [counterOf(4), 4]]);
  });

  test('IN CONCORD holds the mirror too, and the mirror lifts with the finger', () => {
    const { sounder, engine } = rig();
    engine.setConcord(true);
    engine.press(19);
    expect(engine.ringing.map((e: any) => e.n).sort((a: number, b: number) => a - b))
      .toEqual([10, 19]);
    engine.release(19);
    expect(sounder.releases).toBe(2);
    expect(engine.ringing.every((e: any) => !e.held)).toBe(true);
  });

  test('the Seed under any finger is still the rest: held voices are released, not abandoned', () => {
    const { sounder, engine } = rig();
    engine.press(4); engine.press(14);
    engine.press(1);
    expect(sounder.releases).toBe(2);   // both held voices let go before the silence
    expect(engine.ringing.length).toBe(0);
  });

  test('the crowd law releases the oldest held voice when a sixth joins', () => {
    const { sounder, engine } = rig();
    for (const n of [2, 3, 4, 5, 6, 7]) engine.press(n);
    expect(engine.ringing.length).toBe(5);
    expect(sounder.releases).toBe(1);   // the oldest was let go, never left singing
  });
});

describe('THE SOUNDING SET — the stages learn the whole chord', () => {
  test('the set names every card in the air, in the order they entered', () => {
    const { engine } = rig();
    let seen: number[] = [];
    engine.addStage({ sounding: (ns: number[]) => { seen = ns; } });
    engine.press(4); engine.press(14); engine.press(22);
    expect(seen).toEqual([4, 14, 22]);
  });

  test('a voice leaving the air leaves the set', () => {
    // the Scar rings short (far dissonance), the Mask long (the locked
    // octave): step past the first window only, and only the Mask remains
    const { sounder, engine } = rig();
    let seen: number[] = [];
    engine.addStage({ sounding: (ns: number[]) => { seen = ns; } });
    engine.strike(14);
    engine.strike(22);
    expect(seen).toEqual([14, 22]);
    const scar = engine.ringing.find((e: any) => e.n === 14);
    const mask = engine.ringing.find((e: any) => e.n === 22);
    expect(scar.dur).toBeLessThan(mask.dur);
    sounder.t = scar.dur + 0.01;
    engine.recompose();
    expect(seen).toEqual([22]);
  });

  test('the set matches the superposition exactly: same cards, same moment', () => {
    const { engine } = rig();
    let seen: number[] = [];
    let modeCount = 0;
    engine.addStage({
      sounding: (ns: number[]) => { seen = ns; },
      spectrum: (m: any[]) => { modeCount = m.length; },
    });
    engine.press(4); engine.press(22);
    const expected = engine.ringing.reduce((s: number, e: any) => s + e.spec.modes.length, 0);
    expect(seen).toEqual(engine.ringing.map((e: any) => e.n));
    expect(modeCount).toBe(expected);
  });

  test('in concord the set carries both ends of the dyad', () => {
    const { engine } = rig();
    let seen: number[] = [];
    engine.addStage({ sounding: (ns: number[]) => { seen = ns; } });
    engine.setConcord(true);
    engine.strike(19);
    expect(seen.sort((a, b) => a - b)).toEqual([10, 19]);
  });
});

describe('THE SETTLING — the cadence played by holding', () => {
  // a card with a becoming, found from the canon rather than hardcoded
  const unsettled = () => {
    for (let n = 2; n <= 27; n++) if (becomingOf(n) !== null && becomingOf(n) !== 1) return n;
    throw new Error('no unsettled card');
  };

  test('a voice held past the settle begins its becoming: new hold, old released', () => {
    const { sounder, engine } = rig();
    const n = unsettled();
    engine.press(n);
    sounder.t = SETTLE_S + 0.01;
    engine.recompose();
    expect(engine.ringing[0].n).toBe(becomingOf(n));
    expect(sounder.releases).toBe(1);
    expect(engine.ringing[0].held).toBe(true);
  });

  test('the chain walks on at the same pace until a settled card stands', () => {
    const { sounder, engine } = rig();
    const n = unsettled();
    engine.press(n);
    let cur = n;
    for (let step = 0; step < 5 && becomingOf(cur) !== null && becomingOf(cur) !== 1; step++) {
      sounder.t += SETTLE_S + 0.01;
      engine.recompose();
      cur = becomingOf(cur)!;
      expect(engine.ringing[0].n).toBe(cur);
    }
    if (becomingOf(cur) === null) {
      const before = sounder.releases;
      sounder.t += SETTLE_S + 0.01;
      engine.recompose();
      expect(engine.ringing[0].n).toBe(cur);        // settled: it stands
      expect(sounder.releases).toBe(before);        // nothing let go
    }
  });

  test('the cadence home: a becoming of silence ends the hold and rings out', () => {
    const { sounder, engine } = rig();
    const n = [...Array(27)].map((_, i) => i + 1).find((c) => becomingOf(c) === 1);
    if (n === undefined) return;                     // the canon may not offer one
    engine.press(n);
    sounder.t = SETTLE_S + 0.01;
    engine.recompose();
    expect(sounder.releases).toBe(1);                // the voice let go
    expect(engine.ringing.length ? engine.ringing[0].held : false).toBe(false);
    sounder.t += 20;                                 // long past any decay
    engine.recompose();
    expect(engine.ringing.length).toBe(0);           // home to silence
  });

  test('the settling glides: the outgoing modes are still present mid-crossing', () => {
    const { sounder, engine } = rig();
    let seen: any[] = [];
    engine.addStage({ spectrum: (m: any[]) => { seen = m; } });
    const n = unsettled();
    engine.press(n);
    sounder.t = SETTLE_S + 0.01;
    engine.recompose();                     // the settling begins
    sounder.t += MORPH_S / 2;               // halfway across
    engine.recompose();
    const bec = becomingOf(n)!;
    const before = engine.ringing[0].spec.modes.length;
    expect(seen.length).toBeGreaterThan(before);   // both spectra in the air
    sounder.t += MORPH_S;                   // well past the crossing
    engine.recompose();
    expect(seen.length).toBe(before);       // the becoming stands alone
    expect(engine.ringing[0].n).toBe(bec);
  });

  test('a lifted key does not settle: release before the threshold stays itself', () => {
    const { sounder, engine } = rig();
    const n = unsettled();
    engine.press(n);
    sounder.t = SETTLE_S - 1;
    engine.release(n);
    sounder.t = SETTLE_S + 2;
    engine.recompose();
    for (const e of engine.ringing) expect(e.n).toBe(n);
  });

  test('the superposition names its cards, for the metals to wear', () => {
    const { engine } = rig();
    let seen: any[] = [];
    engine.addStage({ spectrum: (m: any[]) => { seen = m; } });
    engine.press(4); engine.press(22);
    const cards = new Set(seen.map((md) => md.card));
    expect(cards).toEqual(new Set([4, 22]));
  });
});

describe('THE TUNING — the dials reach the voice', () => {
  test('the ground moves every partial together, and the ratios hold', () => {
    const { sounder, engine } = rig();
    engine.strike(22);
    const a = sounder.strikes[0].voice.partials.map((p: any) => p.freq);
    sounder.strikes.length = 0;
    engine.setTuning({ ground: 392 });   // the octave above G
    engine.strike(22);
    const b = sounder.strikes[0].voice.partials.map((p: any) => p.freq);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i] * 2, 6);
  });

  test('the room scales the count\'s placement without inventing one', () => {
    const { sounder, engine } = rig();
    engine.strike(14);
    const full = sounder.strikes[0].voice.pan;
    sounder.strikes.length = 0;
    engine.setTuning({ room: 0.5 });
    engine.strike(14);
    expect(sounder.strikes[0].voice.pan).toBeCloseTo(full * 0.5, 10);
    sounder.strikes.length = 0;
    engine.setTuning({ room: 0 });
    engine.strike(14);
    expect(sounder.strikes[0].voice.pan).toBe(0);   // the room closes to a point
  });

  test('the houses can be silenced: every card rings pure and level', () => {
    const { sounder, engine } = rig();
    engine.setTuning({ houses: false });
    for (const n of [4, 14, 22]) {
      sounder.strikes.length = 0;
      engine.strike(n);
      expect(sounder.strikes[0].voice.wave).toBe('sine');
      expect(sounder.strikes[0].voice.level).toBe(1);
    }
    engine.setTuning({ houses: true });
    sounder.strikes.length = 0;
    engine.strike(22);
    expect(sounder.strikes[0].voice.wave).not.toBe('sine');
  });

  test('the beat reaches the voice, and zero stills the twin', () => {
    const { sounder, engine } = rig();
    engine.setTuning({ beat: 0.02 });
    engine.strike(14);
    expect(sounder.strikes[0].voice.detune).toBe(0.02);
    sounder.strikes.length = 0;
    engine.setTuning({ beat: 0 });
    engine.strike(14);
    expect(sounder.strikes[0].voice.detune).toBe(0);
  });

  test('a dial set leaves every other dial standing', () => {
    const { engine } = rig();
    engine.setTuning({ ground: 220 });
    const t = engine.getTuning();
    expect(t.ground).toBe(220);
    expect(t.room).toBe(1);
    expect(t.houses).toBe(true);
  });

  test('the ground carries into the cycle\'s own p line', () => {
    const { engine } = rig();
    engine.setTuning({ ground: 260 });
    engine.setMode('cycle');
    engine.strike(4);
    const pTicks = engine.loops.get(4).ticks.filter((t: any) => t.line === 'p');
    for (const t of pTicks) expect(t.freq).toBe(260);
  });
});

describe('THE HARMONOGRAPH SAMPLER — carried over with its pins', () => {
  test('the locked figure closes over 2π, up to its own decay', () => {
    const a = tracePoint(3, 2, 1, 1, 0);
    const b = tracePoint(3, 2, 1, 1, 2 * Math.PI);
    expect(Math.abs(a[0] - b[0] * Math.exp(2 * Math.PI / 32))).toBeLessThan(0.01);
  });
  test('the dissonance precesses: clarity short of one never comes home', () => {
    const y0 = tracePoint(13, 7, 0.2, 1, 0)[1];
    const y1 = tracePoint(13, 7, 0.2, 1, 2 * Math.PI)[1];
    expect(Math.abs(y0 - y1 * Math.exp(2 * Math.PI / (6 + 26 * 0.2)))).toBeGreaterThan(0.001);
  });
  test('counters mirror: x flips, y holds', () => {
    const a = tracePoint(3, 2, 1, 1, 0.7);
    const b = tracePoint(3, 2, 1, -1, 0.7);
    expect(Math.abs(a[0] + b[0])).toBeLessThan(1e-9);
    expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------
// THE SHELL'S DENSITY: the deepening under held keys. The claim under test
// is the one a player feels as smoothness: a chord must deepen as calmly as
// a single note, so the shedding interval opens out with the company and
// the copies standing at once come to the same number whatever the hand
// does. Pinned because the eye cannot audit a frame rate, and because the
// cap being thrashed is exactly what made two held keys flicker.
// ---------------------------------------------------------------------------
describe('THE DEEPENING: the shell weighs the same in any hand', () => {
  test('one finger or five, the same weight of shell stands', () => {
    const alone = shellStanding(1);
    for (const fingers of [2, 3, 4, 5, 9]) {
      expect(shellStanding(fingers)).toBeCloseTo(alone, 10);
    }
  });

  test('no hand at all is read as one: the drummed shell is the held one', () => {
    expect(shellStanding(0)).toBeCloseTo(shellStanding(1), 10);
  });

  test('the standing shell is the span over the interval, and nothing else', () => {
    expect(shellStanding(1)).toBeCloseTo(SHELL.lifeS / SHELL.shedS, 10);
  });

  test('it never asks the stage for more copies than the stage will hold', () => {
    // the cap thrashing is the flicker: the density must sit under it with
    // room to spare, for every hand
    for (const fingers of [1, 2, 3, 5, 9]) {
      expect(shellStanding(fingers)).toBeLessThan(SHELL.cap);
    }
  });

  test('the span outlives the interval, or there would be no shell to see', () => {
    expect(SHELL.lifeS).toBeGreaterThan(SHELL.shedS * 4);
  });
});

// ---------------------------------------------------------------------------
// THE FIGURE'S OWN CENTRE: the perspective divide magnifies the near side of
// the lean, so a torus drawn about the model origin hangs off centre in its
// frame. Invisible against black; plain the moment the strand is laid over
// the plate's circle, where the two seeings must share a centre or they are
// not one picture. The correction is measured from the surface, and these
// pins hold it to what centring MEANS: equal reach on either side.
// ---------------------------------------------------------------------------
describe('THE KNOT FRAME: the strand centred on what it is drawn over', () => {
  const surface = (cs: number, sn: number) => {
    const o = [0, 0, 0];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 120; i++) {
      const th = (i / 120) * 2 * Math.PI;
      for (let j = 0; j < 120; j++) {
        const ph = (j / 120) * 2 * Math.PI;
        knotProject([Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)], cs, sn, 1, 1, o);
        x0 = Math.min(x0, o[0]); x1 = Math.max(x1, o[0]);
        y0 = Math.min(y0, o[1]); y1 = Math.max(y1, o[1]);
      }
    }
    return { x0, x1, y0, y1 };
  };

  test('the lean leaves the figure hanging off centre: the correction is real', () => {
    // if this ever went to nought the correction would be pointless, and
    // the bug it fixes would be back
    expect(Math.abs(KNOT_FRAME.y)).toBeGreaterThan(0.05);
  });

  test('side to side it was never off: the axis keeps that honest', () => {
    expect(KNOT_FRAME.x).toBeCloseTo(0, 9);
  });

  // both surfaces below are GRIDS over a smooth shape, and the frame under
  // test was measured on a grid of its own, so these agree to sampling
  // precision rather than to the machine's: a thousandth of a unit is
  // already a five-hundredth of one pixel on any stage this is drawn at.
  test('corrected, the figure reaches equally up and down, and left and right', () => {
    const s = surface(1, 0);
    expect(s.y1 - KNOT_FRAME.y).toBeCloseTo(-(s.y0 - KNOT_FRAME.y), 3);
    expect(s.x1 - KNOT_FRAME.x).toBeCloseTo(-(s.x0 - KNOT_FRAME.x), 3);
  });

  test('the turn cannot move the frame: the surface is symmetric about its axis', () => {
    // measured at one turn or another, the centre and the reach are the
    // same, which is why it can be taken once and trusted every frame
    for (const th of [0.4, 1.3, 2.9, 5.1]) {
      const s = surface(Math.cos(th), Math.sin(th));
      expect((s.y0 + s.y1) / 2).toBeCloseTo(KNOT_FRAME.y, 3);
      expect((s.x0 + s.x1) / 2).toBeCloseTo(KNOT_FRAME.x, 3);
      expect((s.y1 - s.y0) / 2).toBeCloseTo(KNOT_FRAME.halfH, 3);
    }
  });

  test('the lean is a lean: the figure is wider than it is tall', () => {
    expect(KNOT_FRAME.halfW).toBeGreaterThan(KNOT_FRAME.halfH);
  });
});

// ---------------------------------------------------------------------------
// THE FRAME UNDER THE ORBIT: the lean is a hand's choice now, so the
// centring correction cannot be one number. knotFrameFor measures it at any
// lean, and these pins hold it to the geometry that makes it trustworthy:
// the correction belongs to the SLANT, so it vanishes at both pure views
// (down the hole, and edge on), grows monotonically toward the home lean,
// and at the home lean reproduces KNOT_FRAME exactly, KNOT_FRAME being the
// same measurement taken once.
// ---------------------------------------------------------------------------
describe('THE ORBIT FRAME: the centring law follows the lean', () => {
  test('at the home lean it IS the pinned frame, to the last digit', () => {
    const f = knotFrameFor(KNOT_TILT);
    expect(f.x).toBe(KNOT_FRAME.x);
    expect(f.y).toBe(KNOT_FRAME.y);
    expect(f.halfW).toBe(KNOT_FRAME.halfW);
    expect(f.halfH).toBe(KNOT_FRAME.halfH);
  });

  test('looking down the hole the figure stands centred, and round', () => {
    const f = knotFrameFor(0);
    expect(Math.abs(f.y)).toBeLessThan(1e-6);
    expect(f.halfW).toBeCloseTo(f.halfH, 6);
  });

  test('edge on it stands centred again, and flat: the correction is the slant\u2019s', () => {
    const f = knotFrameFor(Math.PI / 2);
    expect(Math.abs(f.y)).toBeLessThan(1e-6);
    expect(f.halfW).toBeGreaterThan(f.halfH * 1.5);
  });

  test('between the pure views the correction only grows toward the home lean', () => {
    let last = 0;
    for (const lean of [0.2, 0.5, 0.8, KNOT_TILT]) {
      const y = knotFrameFor(lean).y;
      expect(y).toBeGreaterThan(last);
      last = y;
    }
  });
});
