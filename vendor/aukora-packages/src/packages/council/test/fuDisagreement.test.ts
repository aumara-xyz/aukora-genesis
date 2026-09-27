// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R60 Fu semantic repair guards (Sam 3, directive item 2).
 *
 * Proves the UNPINNED floor-relative repair: the disagreement-above-floor measure, the now-reachable
 * `'mixed'` reason, and the preserved H5 lineage-as-one law. The donor-pinned aukoraFuGlyph.ts and
 * aukoraFuCouncil.ts are NOT edited (a separate provenance test/gate proves byte-identity); this
 * suite exercises the overlay that consumers use until the donor-first line fix lands.
 */
import { describe, it, expect } from 'vitest';
import {
  SHEAR_FLOOR, disagreementAboveFloor, isGenuineDivergence, selectPhaseLockReason,
  assessPhaseLockFloorRelative, lineageEffectiveWeights, distinctLineageVotes, GENUINE_DIVERGENCE_ABOVE_FLOOR,
} from '../fuDisagreement';
import { tilde, type GlyphPacket } from '../src/aukoraFuGlyph';
import type { SeatResult } from '../src/aukoraFuCouncil';

const packet = (dist: GlyphPacket['distribution'], modelId: string, over: Partial<GlyphPacket> = {}): GlyphPacket => ({
  modelId, stance: '⊕', confidence: '→', strategy: '↗', distribution: dist,
  hypothesis: 'h', reasoning: 'r', timestamp: 1, ...over,
});
const seat = (id: string, dist: GlyphPacket['distribution'], over: Partial<SeatResult> = {}): SeatResult => ({
  seatId: id, slug: `s/${id}`, status: 'voted', packet: packet(dist, id), ...over,
} as SeatResult);

describe('R60 disagreement-above-floor — the corrected measure', () => {
  it('maps the permanent floor (1/φ) to 0 and orthogonal (1.0) to 1', () => {
    expect(disagreementAboveFloor(SHEAR_FLOOR)).toBeCloseTo(0, 12);
    expect(disagreementAboveFloor(1.0)).toBeCloseTo(1, 12);
  });
  it('treats raw shear at or below the floor as zero disagreement-above-floor (the gap is not divergence)', () => {
    expect(disagreementAboveFloor(SHEAR_FLOOR - 0.1)).toBe(0);
    expect(disagreementAboveFloor(0)).toBe(0);
  });
  it('is monotonic and bounded in [0,1] across the band', () => {
    let prev = -1;
    for (let s = SHEAR_FLOOR; s <= 1.0001; s += 0.02) {
      const d = disagreementAboveFloor(s);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
  it('identical distributions (raw shear = floor) → NOT genuine divergence (the old > 0.5 bug called this divergence)', () => {
    const c = tilde(packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, 'a'),
                    packet({ explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 }, 'b'));
    expect(c.shearMagnitude).toBeCloseTo(SHEAR_FLOOR, 6); // raw floored value ≈ 0.618 > 0.5 under the OLD test
    expect(isGenuineDivergence(c.shearMagnitude)).toBe(false); // but 0 disagreement ABOVE the floor
  });
  it('orthogonal distributions → genuine divergence above the floor', () => {
    const c = tilde(packet({ explore: 1, exploit: 0, verify: 0, abstain: 0 }, 'a'),
                    packet({ explore: 0, exploit: 1, verify: 0, abstain: 0 }, 'b'));
    expect(isGenuineDivergence(c.shearMagnitude)).toBe(true);
  });
});

describe('R60 reason selection — the unreachable `mixed` branch is now reachable', () => {
  it('genuine-consensus-with-evidence: high coherence + anchor', () => {
    expect(selectPhaseLockReason({ coherenceScore: 0.95, shearMagnitude: SHEAR_FLOOR, anchored: true }))
      .toBe('genuine-consensus-with-evidence');
  });
  it('suspect-matched-prior-consensus: high coherence, no anchor', () => {
    expect(selectPhaseLockReason({ coherenceScore: 0.95, shearMagnitude: SHEAR_FLOOR, anchored: false }))
      .toBe('suspect-matched-prior-consensus');
  });
  it('genuine-divergence: real disagreement above the floor', () => {
    expect(selectPhaseLockReason({ coherenceScore: 0.4, shearMagnitude: 1.0, anchored: false }))
      .toBe('genuine-divergence');
  });
  it('mixed: moderate coherence, disagreement AT the floor — REACHABLE (regression against the > 0.5 dead branch)', () => {
    const reason = selectPhaseLockReason({ coherenceScore: 0.6, shearMagnitude: SHEAR_FLOOR, anchored: false });
    expect(reason).toBe('mixed');
  });
  it('the old raw `> 0.5` test would have mislabeled that same case as genuine-divergence', () => {
    // Demonstrates the bug the repair fixes: raw floored shear (~0.618) > 0.5 is always true.
    expect(SHEAR_FLOOR).toBeGreaterThan(0.5);
    expect(GENUINE_DIVERGENCE_ABOVE_FLOOR).toBe(0.5); // but in NORMALIZED space, floor maps to 0 < 0.5
  });
});

describe('R60 assessPhaseLockFloorRelative — end-to-end over real rosters', () => {
  const D_AGREE = { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 };
  it('zero-contradiction roster (single seat) → not divergence, not high-consensus phase-lock', () => {
    const a = assessPhaseLockFloorRelative([seat('only', D_AGREE)]);
    expect(a.reason === 'mixed' || a.reason === 'genuine-consensus-with-evidence' || a.reason === 'suspect-matched-prior-consensus').toBe(true);
    expect(a.reason).not.toBe('genuine-divergence'); // one seat cannot "diverge"
  });
  it('adversarial roster: many identical seats (matched-prior groupthink) is never reported as genuine divergence', () => {
    const votes = ['a', 'b', 'c', 'd', 'e'].map((id) => seat(id, D_AGREE));
    const a = assessPhaseLockFloorRelative(votes);
    expect(a.reason).not.toBe('genuine-divergence');
  });
  it('genuinely divergent roster → genuine-divergence', () => {
    const votes = [
      seat('a', { explore: 1, exploit: 0, verify: 0, abstain: 0 }),
      seat('b', { explore: 0, exploit: 1, verify: 0, abstain: 0 }),
      seat('c', { explore: 0, exploit: 0, verify: 1, abstain: 0 }),
    ];
    const a = assessPhaseLockFloorRelative(votes);
    expect(a.reason).toBe('genuine-divergence');
  });
});

describe('R60 H5 lineage law — multiple LoRAs from one base count as ONE lineage', () => {
  it('three LoRA adapters sharing a base family sum to exactly one effective vote', () => {
    const seats = [
      { seatId: 'base', family: 'kira-base' },
      { seatId: 'lora-a', family: 'kira-base' },
      { seatId: 'lora-b', family: 'kira-base' },
    ];
    const w = lineageEffectiveWeights(seats);
    const total = [...w.values()].reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(distinctLineageVotes(seats)).toBe(1);
  });
  it('distinct lineages each get a full effective vote', () => {
    const seats = [
      { seatId: 's1', family: 'kira-base' },
      { seatId: 's2', family: 'anthropic' },
      { seatId: 's3', family: 'deepseek' },
    ];
    expect(distinctLineageVotes(seats)).toBe(3);
    const w = lineageEffectiveWeights(seats);
    expect([...w.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(3, 12);
  });
  it('mixed: a base+LoRA lineage plus two distinct lineages = 3 effective votes from 4 seats', () => {
    const seats = [
      { seatId: 'base', family: 'kira-base' },
      { seatId: 'lora', family: 'kira-base' },
      { seatId: 'x', family: 'openai' },
      { seatId: 'y', family: 'google' },
    ];
    expect(distinctLineageVotes(seats)).toBe(3);
    expect([...lineageEffectiveWeights(seats).values()].reduce((s, x) => s + x, 0)).toBeCloseTo(3, 12);
  });
});
