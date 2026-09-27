// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R60 Fu semantic repair (Sam 3, directive item 2) — UNPINNED overlay.
 *
 * Why this file exists, and why it is NOT in aukoraFuGlyph.ts / aukoraFuCouncil.ts:
 * both of those are donor-pinned canonical sources (verify-provenance byte-pins them to the frozen
 * donor blobs). The R60 directive named only aukoraFuGlyph.ts as pinned, but aukoraFuCouncil.ts —
 * which contains the defective `verdict.shearMagnitude > 0.5` reason branch — is pinned too. So the
 * fix CANNOT be an in-place edit of either file without breaking provenance. Instead this unpinned
 * module derives the corrected floor-relative semantics; consumers select reasons through here, and a
 * donor-first proposal (below) records the in-place line change for a future donor rebase.
 *
 * This module lives at the package root (NOT under src/) so the pinned canonical set under src/
 * stays exactly the two donor primitives — the "glyph is consumed only by the council" boundary test
 * that scans src/ is unaffected. This overlay is exported through the package barrel (index.ts).
 *
 * The defect (verified): the glyph `~` operator clamps every pairwise shear to SHEAR_FLOOR = 1/φ
 * (≈0.618) — this is the tested, intended "permanent φ-gap" law and stays untouched. But
 * PerceiverVerdict.shearMagnitude is the MEAN of those floored values, so it is itself always ≥ 1/φ
 * whenever at least one contradiction exists. Therefore `shearMagnitude > 0.5` in
 * aukoraFuCouncil.ts:297 can never be false for any ordinary multi-seat roster, and the `'mixed'`
 * reason is unreachable. The repair is to rank/threshold on disagreement measured RELATIVE TO the
 * floor, where "no disagreement above the permanent gap" maps to 0 and "orthogonal" maps to 1.
 *
 * This module performs no network, filesystem, environment, credential, capture, authority, or
 * repository operation. It re-derives the floor constant locally rather than importing it (the pinned
 * module does not export it); the value is the same mathematical 1/φ the glyph law uses.
 */
import { GlyphChannel, perceive } from './src/aukoraFuGlyph.js';
import type { SeatResult, ClaimBasis, PhaseLockAssessment } from './src/aukoraFuCouncil.js';

const PHI = 1.618033988749894;
/** The tested glyph shear floor (1/φ). Identical frameworks still register this permanent gap. */
export const SHEAR_FLOOR = 1 / PHI;
/** Width of the meaningful shear band [floor, 1]. ≈ 0.382. */
export const SHEAR_BAND = 1 - SHEAR_FLOOR;

/**
 * Disagreement measured RELATIVE TO the permanent floor, normalized to [0, 1]:
 *   floor (total agreement / the permanent φ-gap) → 0
 *   1.0   (orthogonal frameworks)                → 1
 * A raw shear at or below the floor is 0 disagreement-above-floor (the gap is not "divergence").
 * This is the measure the pinned council SHOULD have thresholded on; `shearMagnitude > 0.5` on the
 * raw floored value is the bug this replaces.
 */
export function disagreementAboveFloor(rawShearMagnitude: number): number {
  if (!Number.isFinite(rawShearMagnitude)) return 0;
  const clamped = Math.min(1, Math.max(SHEAR_FLOOR, rawShearMagnitude));
  return (clamped - SHEAR_FLOOR) / SHEAR_BAND;
}

/**
 * Floor-relative genuine-divergence threshold. In the NORMALIZED [0,1] disagreement-above-floor
 * space, 0.5 means "halfway from the permanent gap to fully orthogonal" — a meaningful midpoint that
 * IS reachable in both directions (unlike the raw `> 0.5` the floor made unreachable).
 */
export const GENUINE_DIVERGENCE_ABOVE_FLOOR = 0.5;

/** True when the roster genuinely diverges above the permanent floor (reachable in both directions). */
export function isGenuineDivergence(rawShearMagnitude: number): boolean {
  return disagreementAboveFloor(rawShearMagnitude) > GENUINE_DIVERGENCE_ABOVE_FLOOR;
}

export type PhaseLockReason = PhaseLockAssessment['reason'];

/**
 * The corrected reason selection. Same decision structure as aukoraFuCouncil.assessPhaseLock, but the
 * divergence test is floor-relative, so:
 *   - high coherence + evidence anchor → 'genuine-consensus-with-evidence'
 *   - high coherence, no anchor        → 'suspect-matched-prior-consensus'
 *   - genuine divergence ABOVE the floor → 'genuine-divergence'
 *   - otherwise (near-floor, not high-consensus) → 'mixed'  (now actually reachable)
 */
export function selectPhaseLockReason(input: {
  coherenceScore: number;
  shearMagnitude: number;
  anchored: boolean;
  highConsensusThreshold?: number;
}): PhaseLockReason {
  const highConsensus = input.coherenceScore > (input.highConsensusThreshold ?? 0.85);
  if (highConsensus && input.anchored) return 'genuine-consensus-with-evidence';
  if (highConsensus && !input.anchored) return 'suspect-matched-prior-consensus';
  if (isGenuineDivergence(input.shearMagnitude)) return 'genuine-divergence';
  return 'mixed';
}

/**
 * Unpinned corrected replacement for aukoraFuCouncil.assessPhaseLock. Composes the pinned, tested
 * `perceive` geometry with the floor-relative reason selection above. Future council callers should
 * read `reason` from here rather than from the pinned function until the donor-first fix lands.
 */
export function assessPhaseLockFloorRelative(votes: SeatResult[], _basis?: ClaimBasis): PhaseLockAssessment {
  const channel = new GlyphChannel();
  for (const v of votes) if (v.packet) channel.emit(v.packet);
  const verdict = perceive(channel);
  const anchored = votes.some((v) => {
    if (!v.claimVector || !v.packet) return false;
    const strongClaim = Object.values(v.claimVector).some((x) => Math.abs(x) >= 0.6);
    const verifyLean = v.packet.strategy === '↙' || v.packet.distribution.verify >= 0.4;
    return strongClaim && verifyLean;
  });
  const highConsensus = verdict.coherenceScore > 0.85;
  return {
    coherence: verdict.coherenceScore,
    shearMagnitude: verdict.shearMagnitude,
    phaseLockDetected: verdict.phaseLocked,
    hasEvidenceAnchor: anchored,
    reason: selectPhaseLockReason({ coherenceScore: verdict.coherenceScore, shearMagnitude: verdict.shearMagnitude, anchored }),
    suspect: highConsensus && !anchored,
  };
}

/**
 * H5 lineage-cluster weighting, re-derived as a pure helper so the "multiple LoRAs from one base
 * count as ONE lineage" law is independently testable without touching the pinned council internals.
 * Each seat's effective weight is 1/(number of seats sharing its lineage family); a base model and
 * all its LoRA adapters share one `family`, so they sum to exactly one effective vote — unless a
 * distinct lineage is explicitly proven (a different `family` key).
 */
export function lineageEffectiveWeights(seatFamilies: Array<{ seatId: string; family: string }>): Map<string, number> {
  const familyCount = new Map<string, number>();
  for (const s of seatFamilies) familyCount.set(s.family, (familyCount.get(s.family) ?? 0) + 1);
  const w = new Map<string, number>();
  for (const s of seatFamilies) w.set(s.seatId, 1 / (familyCount.get(s.family) ?? 1));
  return w;
}

/** Total effective votes = number of DISTINCT lineages, never the raw seat count. */
export function distinctLineageVotes(seatFamilies: Array<{ seatId: string; family: string }>): number {
  return new Set(seatFamilies.map((s) => s.family)).size;
}

/**
 * DONOR-FIRST PROPOSAL (recorded here; donor stays read-only this round).
 *
 * Target: aukora-kernel donor source that becomes packages/council/src/aukoraFuCouncil.ts
 *         (currently pinned to donor blob 93bc046ab866ad022b82e9dc04aac65eb6ae39dc), line ~297.
 * Change: replace
 *             else if (verdict.shearMagnitude > 0.5) reason = 'genuine-divergence';
 *         with a floor-relative test equivalent to this module's isGenuineDivergence(), e.g.
 *             else if ((verdict.shearMagnitude - SHEAR_FLOOR) / (1 - SHEAR_FLOOR) > 0.5)
 *               reason = 'genuine-divergence';
 *         (exporting SHEAR_FLOOR from aukoraFuGlyph, or re-deriving 1/φ locally in the council file).
 * Rationale: makes 'mixed' reachable and 'genuine-divergence' meaningful; the raw `> 0.5` can never
 *            be false because perceive() averages floored (≥1/φ) pairwise shears.
 * Provenance: land in the donor first, then re-pin the blob hash in scripts/verify-provenance.mjs on
 *            the next Symbiote/Fu rebase. Until then, consumers use assessPhaseLockFloorRelative here.
 */
export const DONOR_FIRST_PROPOSAL = {
  file: 'packages/council/src/aukoraFuCouncil.ts',
  donorBlob: '93bc046ab866ad022b82e9dc04aac65eb6ae39dc',
  line: 297,
  from: "else if (verdict.shearMagnitude > 0.5) reason = 'genuine-divergence';",
  to: "else if (disagreementAboveFloor(verdict.shearMagnitude) > 0.5) reason = 'genuine-divergence';",
  status: 'PROPOSED_DONOR_FIRST — donor read-only this round; overlay used meanwhile',
} as const;
