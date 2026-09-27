// LUMINARA CYMATICS: the pins. Path B sealed in direction (2026-07-16): the
// emanation seat drives the figure; the knot shows the aggregate, the cymatic
// shows the composition. These tests pin the bridge AND the correspondences
// the bridge revealed: they are the discoveries, made enforceable. meetOf
// was SEALED by the architect 2026-07-16; its pins assert the algebra is
// sound, not that it is canon.
import { describe, expect, test } from 'vitest';
import {
  cymaticSpectrum, cymaticSpectrumA, spectrumOf, cymaticFigure, motionsOf,
  meetOf, sharedStillness,
} from '../../spatial/app/luminara-cymatics.js';
import {
  codeOf, emanationOf, knotOf, counterOf, becomingOf, cardOf,
} from '../../spatial/app/luminara-canon.js';

const ALL = Array.from({ length: 27 }, (_, i) => i + 1);
const PHI = 1.6180339887498949;

describe('THE SPECTRUM: the seat as designed, nothing else', () => {
  test('derived and deterministic: two calls, one figure', () => {
    for (const n of ALL) {
      expect(cymaticSpectrum(n)).toEqual(cymaticSpectrum(n));
    }
  });

  test('three modes centre-out, golden-decaying, the core loudest, phase derived', () => {
    for (const n of ALL) {
      const { modes } = cymaticSpectrum(n);
      expect(modes.length).toBe(3);
      expect(modes.map((m) => m.m)).toEqual([1, 2, 3]);
      expect(modes.map((m) => m.layer)).toEqual(['core', 'middle', 'field']);
      expect(modes[0].w).toBeCloseTo(1, 12);
      expect(modes[1].w).toBeCloseTo(1 / PHI, 12);
      expect(modes[2].w).toBeCloseTo(1 / (PHI * PHI), 12);
      for (const m of modes) expect(m.phase).toBe(0);
    }
  });

  test('the 3·6·9 ladder: each mode IS its zone of the emanation seat', () => {
    for (const n of ALL) {
      const { modes } = cymaticSpectrum(n);
      const { zones } = emanationOf(n);
      modes.forEach((m, k) => {
        expect(m.n).toBe(zones[k].harmonic);
        expect([3, 6, 9]).toContain(m.n);
        expect(m.m).toBe(zones[k].ring);
      });
    }
  });

  test('motion carries the layer sign; renderer-one drift nets to half the motion', () => {
    for (const n of ALL) {
      const d = codeOf(n);
      const sign = (s: number) => (s === 1 ? 1 : s === 2 ? -1 : 0);
      expect(motionsOf(n)).toEqual([sign(d[2]), sign(d[1]), sign(d[0])]);
      for (const m of cymaticSpectrum(n).modes) {
        expect(0.2 + m.drift).toBeCloseTo(0.5 * m.motion, 12);
      }
    }
  });

  test('the Seed alone is unstruck: its latent spectrum is the pure trinity', () => {
    const seed = cymaticSpectrum(1);
    expect(seed.struck).toBe(false);
    expect(seed.modes.map((m) => m.n)).toEqual([3, 3, 3]);
    for (const n of ALL.slice(1)) expect(cymaticSpectrum(n).struck).toBe(true);
  });

  test('clarity is the interval consonance: the figure coherence', () => {
    for (const n of ALL) {
      expect(cymaticSpectrum(n).clarity).toBe(emanationOf(n).clarity);
    }
  });

  test('cymaticFigure carries what a renderer needs', () => {
    const f = cymaticFigure(23);
    expect(f.name).toBe(cardOf(23).name);
    expect(f.interval).toBe(knotOf(23).interval);
    expect(f.counter).toBe(counterOf(23));
    expect(f.modes.length).toBe(3);
  });
});

describe('THE CORRESPONDENCES: what the bridge revealed', () => {
  test('a card and its counter share their stillnesses and reverse their motions', () => {
    for (const n of ALL) {
      const a = motionsOf(n), b = motionsOf(counterOf(n));
      a.forEach((x, i) => expect(b[i]).toBe(-x + 0)); // +0 folds the Seed's −0
      // exact mode equality precisely at the silent layers
      const ma = cymaticSpectrum(n).modes, mb = cymaticSpectrum(counterOf(n)).modes;
      ma.forEach((m, k) => {
        const equal = m.n === mb[k].n && m.motion === mb[k].motion;
        expect(equal).toBe(a[k] === 0);
      });
    }
  });

  test('the kinship of opposites is their shared silence: the restless pairs meet as strangers', () => {
    // all-moving cards (p7) have no still layer: Scar/Return, Twins/Crown,
    // Beacon/Bridge, Void/Spectrum: zero shared modes with their counters
    for (const n of ALL) {
      const p7 = knotOf(n).p === 7;
      expect(sharedStillness(n) === 0).toBe(p7 && n !== 1);
    }
  });

  test('clarity extremes: silence and the sevenfold unison ring pure; the far station scatters most', () => {
    expect(cymaticSpectrum(1).clarity).toBe(1);            // the Seed: silence
    expect(cymaticSpectrum(17).clarity).toBe(1);           // the Void
    expect(cymaticSpectrum(24).clarity).toBe(1);           // the Spectrum
    // the ONLY struck figures at full clarity are the unison-locked pair
    const fullStruck = ALL.filter((n) => cymaticSpectrum(n).struck && cymaticSpectrum(n).clarity === 1);
    expect(fullStruck).toEqual([17, 24]);
    // the far dissonance scatters the rim hardest, and only there
    expect(cymaticSpectrum(14).clarity).toBeCloseTo(0.1, 12);
    expect(cymaticSpectrum(27).clarity).toBeCloseTo(0.1, 12);
    for (const n of ALL) expect(cymaticSpectrum(n).clarity).toBeGreaterThanOrEqual(0.1);
    const dimmest = ALL.filter((n) => cymaticSpectrum(n).clarity <= 0.1 + 1e-12);
    expect(dimmest).toEqual([14, 27]);
  });

  test('one weather, one clarity: cards sharing an interval share a coherence', () => {
    const byInterval = new Map<string, number[]>();
    for (const n of ALL) {
      const k = knotOf(n).interval;
      byInterval.set(k, [...(byInterval.get(k) || []), cymaticSpectrum(n).clarity]);
    }
    for (const [, cs] of byInterval) {
      for (const c of cs) expect(c).toBe(cs[0]);
    }
  });

  test('becomings that resolve home reach full clarity: the cadence lands in silence', () => {
    for (const n of ALL) {
      if (becomingOf(n) === 1) {
        expect(cymaticSpectrum(becomingOf(n)!).clarity).toBe(1);
      }
    }
  });
});

describe('PATH A, the interval: the figure is the knot’s number', () => {
  test('derived and deterministic; spectrumOf dispatches by name, never silently', () => {
    for (const n of ALL) {
      expect(cymaticSpectrumA(n)).toEqual(cymaticSpectrumA(n));
      expect(spectrumOf(n, 'A').path).toBe('A');
      expect(spectrumOf(n, 'B').path).toBe('B');
    }
  });

  test('the primary mode IS the knot: |q| petals through, p rings around', () => {
    for (const n of ALL) {
      const k = knotOf(n);
      const [primary] = cymaticSpectrumA(n).modes;
      expect(primary.n).toBe(Math.abs(k.q));
      expect(primary.m).toBe(k.p);
      expect(primary.w).toBe(1);
      expect(primary.phase).toBe(0);
    }
  });

  test('a card and its counter are one figure spinning opposite ways', () => {
    for (const n of ALL) {
      const a = cymaticSpectrumA(n).modes, b = cymaticSpectrumA(counterOf(n)).modes;
      expect(a.length).toBe(b.length);
      a.forEach((m, i) => {
        expect(b[i].n).toBe(m.n);
        expect(b[i].m).toBe(m.m);
        expect(b[i].w).toBe(m.w);
        expect(b[i].motion).toBe(-m.motion + 0); // +0 folds the Seed's −0
      });
    }
  });

  test('exactly the three link-dyads carry the reduced voice', () => {
    const twoVoiced = ALL.filter((n) => cymaticSpectrumA(n).modes.length === 2);
    expect(twoVoiced.sort((x, y) => x - y)).toEqual([13, 16, 17, 22, 24, 25]);
    // the reduced ratio is the lock's consonance: 12:3→4:1, 6:3→2:1, 7:7→1:1
    const reduced = (n: number) => {
      const [, r] = cymaticSpectrumA(n).modes;
      return r.n + ':' + r.m;
    };
    expect(reduced(13)).toBe('4:1'); expect(reduced(25)).toBe('4:1');
    expect(reduced(16)).toBe('2:1'); expect(reduced(22)).toBe('2:1');
    expect(reduced(17)).toBe('1:1'); expect(reduced(24)).toBe('1:1');
  });

  test('the Seed is unstruck on both paths; clarity is path-invariant (one seat)', () => {
    expect(cymaticSpectrumA(1).struck).toBe(false);
    for (const n of ALL) {
      expect(cymaticSpectrumA(n).struck).toBe(cymaticSpectrum(n).struck);
      expect(cymaticSpectrumA(n).clarity).toBe(cymaticSpectrum(n).clarity);
    }
  });
});

describe('THE MEET (sealed 2026-07-16): the deck as a group of order 27', () => {
  test('the Seed is the identity of meeting', () => {
    for (const n of ALL) expect(meetOf(n, 1)).toBe(n);
  });

  test('every card meets its counter in the Seed: the involution is the inverse', () => {
    for (const n of ALL) expect(meetOf(n, counterOf(n))).toBe(1);
  });

  test('the meeting of any two cards is a card, and order does not matter', () => {
    for (const a of ALL) for (const b of ALL) {
      const m = meetOf(a, b);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(27);
      expect(meetOf(b, a)).toBe(m);
    }
  });

  test('meeting associates: the full 19683 triples', () => {
    for (const a of ALL) for (const b of ALL) for (const c of ALL) {
      expect(meetOf(meetOf(a, b), c)).toBe(meetOf(a, meetOf(b, c)));
    }
  });

  test('every card except the Seed has order three: thrice met with itself, home', () => {
    for (const n of ALL) {
      const thrice = meetOf(n, meetOf(n, n));
      expect(thrice).toBe(1);
      if (n !== 1) expect(meetOf(n, n)).not.toBe(1);
    }
  });
});
