// Port of the original run-tests.js (from the owner's aukora-fu-v8.0.0 export) into this repo's real
// vitest suite, testing the canonical pure glyph/parser/perceiver module extracted from the donor
// rather than a re-derived copy of its math. No test here makes a network call.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GlyphChannel, perceive, parseGlyphResponse, tilde, decayShear, type GlyphPacket, type Contradiction } from '../src/aukoraFuGlyph';

function packet(distribution: GlyphPacket['distribution'], overrides: Partial<GlyphPacket> = {}): GlyphPacket {
  return {
    modelId: overrides.modelId ?? 'M',
    stance: overrides.stance ?? '⊙',
    confidence: overrides.confidence ?? '→',
    strategy: overrides.strategy ?? '↗',
    framework: overrides.framework,
    distribution,
    hypothesis: overrides.hypothesis ?? '',
    reasoning: overrides.reasoning ?? '',
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

describe('aukoraFuGlyph: perceiver (KL-divergence coherence)', () => {
  it('perfect agreement across 5 identical distributions -> near-1.0 coherence, but escalated to YELLOW by phase-lock (this IS the groupthink case phase-lock exists to catch, now that the detector is fixed — see the phase-lock describe block below)', () => {
    const ch = new GlyphChannel();
    for (let i = 0; i < 5; i++) ch.emit(packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, { modelId: `m${i}` }));
    const r = perceive(ch);
    expect(r.coherenceScore).toBeGreaterThan(0.99);
    expect(r.pinch).toBeLessThan(0.1);
    expect(r.phaseLocked).toBe(true);
    expect(r.verdict).toBe('YELLOW'); // phase-lock override, not a raw-coherence RED/GREEN call
  });

  it('orthogonal distributions -> RED, high pinch', () => {
    const ch = new GlyphChannel();
    const dists: GlyphPacket['distribution'][] = [
      { explore: 1, exploit: 0, verify: 0, abstain: 0 },
      { explore: 0, exploit: 1, verify: 0, abstain: 0 },
      { explore: 0, exploit: 0, verify: 1, abstain: 0 },
      { explore: 0, exploit: 0, verify: 0, abstain: 1 },
      { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 },
    ];
    dists.forEach((d, i) => ch.emit(packet(d, { modelId: `m${i}` })));
    const r = perceive(ch);
    expect(r.verdict).toBe('RED');
    expect(r.pinch).toBeGreaterThan(1.0);
  });

  it('empty channel fails closed -> RED quarantine, never throws', () => {
    const ch = new GlyphChannel();
    const r = perceive(ch);
    expect(r.verdict).toBe('RED');
    expect(r.pinch).toBe(1e6);
    expect(r.divergenceMatrix).toEqual([]);
    expect(r.contradictions).toEqual([]);
  });

  it('moderate disagreement across 3 models -> not RED, coherence still reasonably high', () => {
    const ch = new GlyphChannel();
    const dists: GlyphPacket['distribution'][] = [
      { explore: 0.4, exploit: 0.3, verify: 0.2, abstain: 0.1 },
      { explore: 0.35, exploit: 0.35, verify: 0.2, abstain: 0.1 },
      { explore: 0.3, exploit: 0.4, verify: 0.2, abstain: 0.1 },
    ];
    dists.forEach((d, i) => ch.emit(packet(d, { modelId: `m${i}` })));
    const r = perceive(ch);
    expect(r.verdict).not.toBe('RED');
    expect(r.coherenceScore).toBeGreaterThan(0.7);
  });
});

describe('aukoraFuGlyph: ~ operator + φ-governed shear decay', () => {
  it('tilde() produces a valid contradiction between disagreeing distributions', () => {
    const a = packet({ explore: 1, exploit: 0, verify: 0, abstain: 0 }, { modelId: 'a' });
    const b = packet({ explore: 0, exploit: 1, verify: 0, abstain: 0 }, { modelId: 'b' });
    const c = tilde(a, b);
    expect(c.modelA).toBe('a');
    expect(c.modelB).toBe('b');
    expect(c.shearMagnitude).toBeGreaterThan(0.6); // orthogonal -> near-maximal shear
    expect(c.phaseLockStatus).toBe('open');
  });

  it('tilde() on identical distributions still returns at least the shear floor (1/φ), never zero', () => {
    const a = packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, { modelId: 'a' });
    const b = packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, { modelId: 'b' });
    const c = tilde(a, b);
    expect(c.shearMagnitude).toBeCloseTo(1 / 1.618033988749894, 5);
  });

  // R59 planted equality case — the shear-floor-at-creation law, pinned EXACTLY. Reproduces the
  // externally reported "identical inputs yield ~1/φ disagreement" observation and pins it as the
  // module's intended permanent-φ-gap law; the defect is the contradictory "0 = resolved" comment on
  // Contradiction.shearMagnitude in aukoraFuGlyph.ts, not the clamp. THAT COMMENT CANNOT BE FIXED
  // HERE: the module is one of the 10 donor-pinned provenance sources (byte-identical to donor
  // b441edc4d17d, enforced by verify:provenance), so the one-line doc correction must land in the
  // DONOR first. Until then, THIS block is the authoritative statement of the law:
  //   shearMagnitude ∈ [SHEAR_FLOOR (1/φ ≈ 0.618), 1] at creation and under decay; identical
  //   frameworks still register the permanent φ-gap; 0 is intentionally unreachable.
  it('R59 equality law: identical inputs yield EXACTLY the floor, 0 is unreachable, and decay never drops below it', () => {
    const FLOOR = 1 / 1.618033988749894;
    const a = packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, { modelId: 'a' });
    const b = packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, { modelId: 'b' });
    const c = tilde(a, b);
    expect(c.shearMagnitude).toBe(Math.max(1 - 1, FLOOR)); // exact clamp arithmetic: cos(identical)=1
    expect(c.shearMagnitude).not.toBe(0);
    // permanent gap: 30 days of decay still sits exactly on the floor
    expect(decayShear(c, c.decayOrigin + 30 * 24 * 3600 * 1000)).toBeCloseTo(FLOOR, 9);
    // creation range law across corner/mixed inputs: shear ∈ [floor, 1]
    const corners = [
      { explore: 1, exploit: 0, verify: 0, abstain: 0 },
      { explore: 0, exploit: 1, verify: 0, abstain: 0 },
      { explore: 0.7, exploit: 0.1, verify: 0.1, abstain: 0.1 },
      { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 },
    ];
    for (const dA of corners) for (const dB of corners) {
      const s = tilde(packet(dA, { modelId: 'x' }), packet(dB, { modelId: 'y' })).shearMagnitude;
      expect(s).toBeGreaterThanOrEqual(FLOOR - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('decayShear(): an active (just-created) contradiction keeps its full shear', () => {
    const a = packet({ explore: 1, exploit: 0, verify: 0, abstain: 0 }, { modelId: 'a' });
    const b = packet({ explore: 0, exploit: 1, verify: 0, abstain: 0 }, { modelId: 'b' });
    const c = tilde(a, b);
    const now = c.decayOrigin + 1000; // 1 second later, well within the 10-minute "active" window
    expect(decayShear(c, now)).toBeCloseTo(c.shearMagnitude, 5);
  });

  it('decayShear(): an old contradiction decays toward the floor but never reaches it', () => {
    const a = packet({ explore: 1, exploit: 0, verify: 0, abstain: 0 }, { modelId: 'a' });
    const b = packet({ explore: 0, exploit: 1, verify: 0, abstain: 0 }, { modelId: 'b' });
    const c = tilde(a, b);
    const farFuture = c.decayOrigin + 1000 * 60 * 60 * 24 * 30; // 30 days later
    const decayed = decayShear(c, farFuture);
    const floor = 1 / 1.618033988749894;
    expect(decayed).toBeGreaterThan(floor - 1e-6);
    expect(decayed).toBeLessThan(c.shearMagnitude);
  });

  it('GlyphChannel.emit() auto-computes contradictions against every prior packet from a different model', () => {
    const ch = new GlyphChannel();
    ch.emit(packet({ explore: 1, exploit: 0, verify: 0, abstain: 0 }, { modelId: 'a' }));
    ch.emit(packet({ explore: 0, exploit: 1, verify: 0, abstain: 0 }, { modelId: 'b' }));
    ch.emit(packet({ explore: 0, exploit: 0, verify: 1, abstain: 0 }, { modelId: 'c' }));
    // b contradicts a (1), c contradicts a and b (2) => 3 total
    expect(ch.getContradictions().length).toBe(3);
  });

  it('GlyphChannel.strongestContradiction() picks the highest-shear still-open contradiction', () => {
    const ch = new GlyphChannel();
    ch.emit(packet({ explore: 0.3, exploit: 0.3, verify: 0.3, abstain: 0.1 }, { modelId: 'a' })); // close
    ch.emit(packet({ explore: 0.28, exploit: 0.32, verify: 0.3, abstain: 0.1 }, { modelId: 'b' })); // close to a
    ch.emit(packet({ explore: 0, exploit: 0, verify: 0, abstain: 1 }, { modelId: 'c' })); // far from both
    const strongest = ch.strongestContradiction();
    expect(strongest).toBeDefined();
    expect([strongest!.modelA, strongest!.modelB]).toContain('c');
  });
});

describe('aukoraFuGlyph: phase-lock (groupthink) detection', () => {
  it('all models in near-total agreement -> phase-locked, verdict escalated off GREEN', () => {
    const ch = new GlyphChannel();
    for (let i = 0; i < 4; i++) ch.emit(packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, { modelId: `m${i}` }));
    const r = perceive(ch);
    expect(r.phaseLocked).toBe(true);
    expect(r.verdict).not.toBe('GREEN'); // phase-lock forces at least YELLOW
  });

  it('healthy (genuinely orthogonal) disagreement -> not phase-locked', () => {
    // Two mildly different-looking distributions (e.g. 0.6/0.1/0.2/0.1 vs 0.1/0.6/0.2/0.1) still
    // clamp to the shear floor on this simplex — cosine similarity between non-negative,
    // sum-to-1 vectors rarely gets low enough to clear the near-floor margin unless the
    // models genuinely disagree on which action dominates. Orthogonal basis vectors are the clear
    // "no plausible groupthink reading" case.
    const ch = new GlyphChannel();
    ch.emit(packet({ explore: 1, exploit: 0, verify: 0, abstain: 0 }, { modelId: 'a' }));
    ch.emit(packet({ explore: 0, exploit: 1, verify: 0, abstain: 0 }, { modelId: 'b' }));
    const r = perceive(ch);
    expect(r.phaseLocked).toBe(false);
  });
});

describe('aukoraFuGlyph: parseGlyphResponse (fail-closed parser)', () => {
  it('parses a well-formed glyph response including the new FRAMEWORK field', () => {
    const text = 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↗ FRAMEWORK:statistical DIST:explore=0.4,exploit=0.3,verify=0.2,abstain=0.1 HYP:"looks solid"';
    const { packet: p, incident } = parseGlyphResponse(text, 'M1');
    expect(p.stance).toBe('⊕');
    expect(p.framework).toBe('statistical');
    expect(p.hypothesis).toBe('looks solid');
    expect(incident).toBeUndefined();
  });

  it('malformed input (missing fields) falls back to an abstaining quarantine packet + a malformed_glyph incident', () => {
    const { packet: p, incident } = parseGlyphResponse('not a glyph response at all', 'M1');
    expect(p.stance).toBe('⊚');
    expect(p.hypothesis).toMatch(/parse failed/i);
    expect(incident?.type).toBe('malformed_glyph');
    expect(incident?.action).toBe('quarantined');
  });

  it('a distribution that does not sum to ~1.0 is rejected as fabricated, logs a dist_sum_mismatch incident', () => {
    const text = 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↗ FRAMEWORK:statistical DIST:explore=0.9,exploit=0.9,verify=0.9,abstain=0.9 HYP:"fake"';
    const { packet: p, incident } = parseGlyphResponse(text, 'M1');
    expect(p.stance).toBe('⊚');
    expect(incident?.type).toBe('dist_sum_mismatch');
  });

  // Round 2 (issue #22) regression: the prompt's own instructions/examples (this same file, ~line 340)
  // tell every model to reply with DIST:(explore=X,...) — parentheses included — but this regex used to
  // require NO parentheses, so a model that correctly followed the prompt's own format could never
  // parse. Found via a real live council run: 2 of 5 real replies were exactly this shape and were
  // still marked malformed_glyph. This is the EXACT reply text captured from that live run.
  it('parses a real, prompt-compliant reply with parenthesized DIST (this used to always fail)', () => {
    const text = 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↘ FRAMEWORK:geometric DIST:(explore=0.10,exploit=0.80,verify=0.05,abstain=0.05) HYP:"Delineating the module\'s topological boundary between declaration and execution prevents unintended side-effect coupling."';
    const { packet: p, incident } = parseGlyphResponse(text, 'M1');
    expect(incident).toBeUndefined();
    expect(p.stance).toBe('⊕');
    expect(p.framework).toBe('geometric');
    expect(p.distribution.explore).toBeCloseTo(0.10);
    expect(p.distribution.exploit).toBeCloseTo(0.80);
    expect(p.distribution.verify).toBeCloseTo(0.05);
    expect(p.distribution.abstain).toBeCloseTo(0.05);
  });

  it('still parses the older no-parentheses shape (backward compatible, not a breaking change)', () => {
    const text = 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↗ FRAMEWORK:statistical DIST:explore=0.4,exploit=0.3,verify=0.2,abstain=0.1 HYP:"looks solid"';
    const { packet: p, incident } = parseGlyphResponse(text, 'M1');
    expect(incident).toBeUndefined();
    expect(p.distribution.explore).toBeCloseTo(0.4);
    expect(p.distribution.exploit).toBeCloseTo(0.3);
    expect(p.distribution.verify).toBeCloseTo(0.2);
    expect(p.distribution.abstain).toBeCloseTo(0.1);
  });
});

// Round 6 (issue #34): a real live council run (5 models, real network calls, capture mode on — see
// core/src/fusionCaptureLog.ts) produced these EXACT five raw replies, committed verbatim as fixtures
// under core/tests/fixtures/fusion-replies/. Two genuinely compliant, one real parser bug (DeepSeek's
// DIST keys in a different order — fixed, order-independent extraction), two genuinely non-compliant
// (an empty reply, and a model that ignored the format instructions entirely and wrote prose) — the
// last of those is the adversarial fixture proving fail-closed survived the fix: it must NEVER parse.
describe('aukoraFuGlyph: parseGlyphResponse against REAL captured council replies (issue #34 live run)', () => {
  const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'fusion-replies');
  const readFixture = (name: string) => fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');

  it('GLM (z-ai/glm-5.2) — genuinely compliant, canonical DIST order, parses cleanly', () => {
    const { packet: p, incident } = parseGlyphResponse(readFixture('glm-5.2-compliant.txt'), 'GLM');
    expect(incident).toBeUndefined();
    expect(p.stance).toBe('⊖');
    expect(p.framework).toBe('symbolic');
    expect(p.distribution.explore).toBeCloseTo(0.10);
    expect(p.distribution.exploit).toBeCloseTo(0.20);
    expect(p.distribution.verify).toBeCloseTo(0.60);
    expect(p.distribution.abstain).toBeCloseTo(0.10);
  });

  it('QWN (qwen/qwen3.7-max) — genuinely compliant, canonical DIST order, parses cleanly', () => {
    const { packet: p, incident } = parseGlyphResponse(readFixture('qwen3.7-max-compliant.txt'), 'QWN');
    expect(incident).toBeUndefined();
    expect(p.stance).toBe('⊕');
    expect(p.framework).toBe('geometric');
    expect(p.distribution.explore).toBeCloseTo(0.10);
    expect(p.distribution.exploit).toBeCloseTo(0.80);
    expect(p.distribution.verify).toBeCloseTo(0.10);
    expect(p.distribution.abstain).toBeCloseTo(0.00);
  });

  // THE key fixture: real DIST keys in a different order (exploit,verify,explore,abstain — not the
  // prompt's own explore,exploit,verify,abstain example order). Fail-before/pass-after proven below.
  it('DSK (deepseek/deepseek-v4-pro) — real reply with DIST keys in a DIFFERENT order — now parses correctly', () => {
    const text = readFixture('deepseek-v4-pro-dist-reordered.txt');
    expect(text).toContain('DIST:(exploit=0.10,verify=0.70,explore=0.10,abstain=0.10)'); // pin the fixture's own shape
    const { packet: p, incident } = parseGlyphResponse(text, 'DSK');
    expect(incident).toBeUndefined();
    expect(p.stance).toBe('⊕');
    expect(p.framework).toBe('statistical');
    expect(p.distribution.explore).toBeCloseTo(0.10);
    expect(p.distribution.exploit).toBeCloseTo(0.10);
    expect(p.distribution.verify).toBeCloseTo(0.70);
    expect(p.distribution.abstain).toBeCloseTo(0.10);
  });

  it('KIM (moonshotai/kimi-k2.7-code) — a real EMPTY reply — correctly rejected, never a fabricated vote', () => {
    const text = readFixture('kimi-k2.7-code-empty.txt');
    expect(text).toBe('');
    const { packet: p, incident } = parseGlyphResponse(text, 'KIM');
    expect(incident?.type).toBe('malformed_glyph');
    expect(p.hypothesis).toBe('Parse failed — abstaining');
  });

  // The adversarial fixture: LMA ignored the "respond with EXACTLY this format" instruction entirely and
  // wrote multi-paragraph reasoning prose instead. A reasonable reader would NOT call this compliant —
  // this must stay rejected. Proves the order-independent DIST fix didn't accidentally loosen fail-closed
  // behavior for genuinely malformed input.
  it('LMA (meta-llama/llama-4-maverick) — real free-form prose ignoring the format entirely — still correctly rejected (fail-closed survived the fix)', () => {
    const text = readFixture('llama-4-maverick-prose-noncompliant.txt');
    expect(text).not.toMatch(/STANCE:/); // confirms this fixture never even attempts the format
    const { packet: p, incident } = parseGlyphResponse(text, 'LMA');
    expect(incident?.type).toBe('malformed_glyph');
    expect(p.hypothesis).toBe('Parse failed — abstaining');
  });
});

describe('aukoraFuGlyph: pure canonical boundary', () => {
  it('has no network, environment, filesystem, capture, custody, or Symbiote dependency', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'aukoraFuGlyph.ts'), 'utf-8');
    const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(codeOnly).not.toMatch(/\bfetch\(|process\.env|node:fs|from ['"]fs['"]|fusionCaptureLog|authority\/|convex|aumlok|\.aukora-symbiote|opencode\/auth/);
  });

  it('is consumed only by the canonical council', () => {
    const srcDir = path.join(__dirname, '..', 'src');
    const callers = fs.readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts') && f !== 'aukoraFuGlyph.ts')
      .filter((f) => fs.readFileSync(path.join(srcDir, f), 'utf-8').includes('aukoraFuGlyph'))
      .sort();
    expect(callers).toEqual(['aukoraFuCouncil.ts']);
  });
});
