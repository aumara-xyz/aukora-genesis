// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Fu structured adapter (R36) — makes the REAL Aukora Fu council operational inside the recursion pipeline,
 * behind a strict provider-neutral boundary.
 *
 * The engine is the canonical `runAukoraFuCouncil` (@aukora/council): two rounds, bounded packet extraction,
 * lineage-weighted quorum, English-last synthesis. This adapter adds ONLY boundary law:
 *   - provider-neutral: the transport is INJECTED (none embedded — no transport, no call, ever);
 *   - roster hygiene: an external reviewer (Fugu Ultra) can never hold a seat — the roster is refused up front;
 *   - spend: ceilings are CLAMPED to the frozen $2/pass + $10/day runner ceilings (narrower allowed, wider never)
 *     and enforced fail-closed by the engine's own SpendMeter (a projected breach refuses before any call);
 *   - failures become NON-VOTES (engine law: invalid JSON, truncation, substitution, timeouts, empty replies —
 *     never a council failure, never a vote);
 *   - every advisory run is RECEIPTED into the governed memory store (outcome digest, verdict, votes, spend);
 *   - the outcome maps to the pipeline's sync `CouncilVerdict` via a PURE projection: `advisory-pass` requires a
 *     met quorum AND a valid frozen basis — anything else is a hold. `advisoryOnly:true` / `grantsAuthority:false`
 *     are stamped on every surface; a favorable verdict still never substitutes for the owner's hybrid signature.
 *
 * Convergence: `reviewerFor(outcome)` returns a `CouncilReviewer` the recursion/durable envs inject as
 * `env.review` — the gate then consumes REAL Fu evidence with zero changes to the gate itself.
 */
import {
  runAukoraFuCouncil, CANONICAL_SEATS, SpendMeter, SpendCeilingExceeded,
  type CouncilInput, type CouncilOutcome, type CouncilOpts, type CouncilSeat, type Transport, type SpendLimits,
} from '@aukora/council';
import { canonicalHash } from '@aukora/kernel/canonical';
import { buildMemoryRecord } from '@aukora/memory';
import type { ReactiveMemoryStore } from '@aukora/brain';
import type { CouncilVerdict, CouncilReviewer } from './mockCouncil.js';
import { RUNNER_CEILINGS, effectiveLimits, rosterExcludesExternalReviewers } from './councilRunnerBoundary.js';

export type FuAdapterReasonClass =
  | 'fu:ok'
  | 'fu:no-transport'
  | 'fu:external-reviewer-in-roster'
  | 'fu:spend-ceiling'
  | 'fu:engine-error';

export interface FuAdvisoryResult {
  readonly ok: boolean;
  readonly reasonClass: FuAdapterReasonClass;
  readonly text: string;
  readonly outcome: CouncilOutcome | null;
  /** Canonical digest over the outcome's decision-relevant projection — the council-evidence artifact. */
  readonly outcomeDigest: string | null;
  readonly receiptHash: string | null;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export interface FuAdvisoryOpts {
  readonly seats?: readonly CouncilSeat[];
  readonly limits?: Partial<SpendLimits>;
  readonly dayToDateUsd?: number;
  readonly maxTokensPerCall?: number;
  readonly perSeatDeadlineMs?: number;
  readonly now?: number;
  /** ISO timestamp for the receipt (caller-supplied; no ambient clock). */
  readonly nowIso?: string;
  readonly quorum?: CouncilOpts['quorum'];
}

/** Pure digest over the outcome's decision-relevant projection (verdict, quorum, basis digest, votes, spend). */
export function councilOutcomeDigest(outcome: CouncilOutcome): string {
  return canonicalHash({
    domain: 'AUKORA-FU-OUTCOME/1',
    basisDigest: outcome.basis.digest,
    verdict: outcome.verdict,
    quorumMet: outcome.quorumMet,
    votes: outcome.votes.map((v) => v.seatId).sort(),
    nonVotes: outcome.nonVotes.map((v) => `${v.seatId}:${v.status}`).sort(),
    fableVerified: outcome.fableVerified,
    votingFamilies: outcome.votingFamilies,
    answerSource: outcome.answerSource,
  });
}

/**
 * Run ONE advisory Fu pass over a problem + claims through the injected transport, ceiling-clamped and receipted.
 * Total at the boundary: transport/roster/spend violations refuse BEFORE any call; engine throws become refusals.
 */
export async function runFuAdvisory(
  input: CouncilInput,
  transport: Transport | undefined,
  store: ReactiveMemoryStore,
  opts: FuAdvisoryOpts = {},
): Promise<FuAdvisoryResult> {
  const refuse = (reasonClass: Exclude<FuAdapterReasonClass, 'fu:ok'>, text: string): FuAdvisoryResult =>
    ({ ok: false, reasonClass, text, outcome: null, outcomeDigest: null, receiptHash: null, advisoryOnly: true, grantsAuthority: false });

  if (transport === undefined) return refuse('fu:no-transport', 'refused: no injected provider transport — no live call is possible (none is embedded, by design)');

  const seats = opts.seats ?? CANONICAL_SEATS;
  const roster = rosterExcludesExternalReviewers(seats);
  if (!roster.valid) return refuse('fu:external-reviewer-in-roster', `refused: ${roster.reason}`);

  // Ceilings clamp to the frozen runner law (narrower allowed, wider never); the engine's SpendMeter enforces
  // fail-closed — a projected breach refuses before any seat is called.
  const limits = effectiveLimits(opts.limits ?? RUNNER_CEILINGS);
  const spend = new SpendMeter(limits, opts.dayToDateUsd ?? 0);

  let outcome: CouncilOutcome;
  try {
    outcome = await runAukoraFuCouncil(input, transport, {
      seats,
      spend,
      maxTokensPerCall: opts.maxTokensPerCall,
      perSeatDeadlineMs: opts.perSeatDeadlineMs,
      now: opts.now,
      quorum: opts.quorum,
    });
  } catch (e) {
    if (e instanceof SpendCeilingExceeded) return refuse('fu:spend-ceiling', `refused: ${e.message}`);
    return refuse('fu:engine-error', `refused: council engine error (${e instanceof Error ? e.message.slice(0, 120) : 'unknown'})`);
  }

  const outcomeDigest = councilOutcomeDigest(outcome);
  const receipt = buildMemoryRecord({
    content: `fu-advisory · verdict=${outcome.verdict} · quorumMet=${outcome.quorumMet} · votes=${outcome.votes.length}/${seats.length}`
      + ` · digest=${outcomeDigest.slice(0, 12)} · spentUsd=${outcome.actualUsd.toFixed(4)}`,
    createdAt: opts.nowIso ?? new Date(opts.now ?? 0).toISOString(),
    kind: 'receipt',
    consent: 'owner-only',
    provenance: 'fu-advisory',
  });
  const ing = store.ingest(receipt);
  return {
    ok: true,
    reasonClass: 'fu:ok',
    text: `advisory pass complete (${outcome.verdict}); receipted`,
    outcome,
    outcomeDigest,
    receiptHash: ing.ok ? ing.chainHash : null,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/**
 * PURE projection of a completed council outcome into the pipeline's sync `CouncilVerdict`. `advisory-pass`
 * requires a MET quorum and a valid frozen basis; insufficient quorum, suspect consensus without evidence anchor,
 * or a broken basis all project to `advisory-hold`. The evidence digest is the outcome digest — real Fu evidence.
 */
export function verdictFromCouncilOutcome(outcome: CouncilOutcome): CouncilVerdict {
  const pass = outcome.quorumMet
    && outcome.grantsAuthority === false
    && (outcome.verdict === 'consensus' || outcome.verdict === 'divergence' || outcome.verdict === 'consensus-suspect');
  return {
    verdict: pass ? 'advisory-pass' : 'advisory-hold',
    grantsAuthority: false,
    advisoryOnly: true,
    basisValid: outcome.basis.digest.length > 0,
    evidenceDigest: pass ? councilOutcomeDigest(outcome) : '',
    reason: pass
      ? `real Fu advisory (${outcome.verdict}; ${outcome.votes.length} votes from ${outcome.votingFamilies} families)`
      : `advisory hold (${outcome.verdict}; quorumMet=${outcome.quorumMet})`,
  };
}

/** A `CouncilReviewer` closure over a COMPLETED outcome — inject as `env.review` so the gate consumes real Fu evidence. */
export function reviewerFor(outcome: CouncilOutcome): CouncilReviewer {
  const verdict = verdictFromCouncilOutcome(outcome);
  return () => verdict;
}

/** HARD: the adapter is advisory plumbing — it can never mint authority. Constant, by construction. */
export function fuAdapterGrantsAuthority(): false {
  return false;
}
