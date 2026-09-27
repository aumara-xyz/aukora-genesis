// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Fusion self-optimization v0 (Zenith-inspired discipline, NO code copy). Pure helpers that make Fusion
 * manage itself like a disciplined mission controller: schedule only the calls it can afford, surface typed
 * attention items, build a retry pack of ONLY the failed pairs, and produce a terminal review. ALL advisory:
 * Fusion reviews; Fusion never authorizes. Nothing here carries secrets, raw prompts, PoPs, signatures, or
 * authority fields. Quorum classification stays in fusionConfig.evaluateFusionQuorum (reused, not duplicated).
 */

// minimal structural shapes (so callers/tests don't need the full ShardReviewResult)
export interface SwarmInstanceLike { shard: string; model: string; }
export interface ReviewResultLike { shard: string; model: string; adapterFailure?: boolean; failureReason?: string; verdict?: string; provider_contacted?: boolean; }

// ── Task 1: budget-aware scheduling ──
export interface FusionSchedule {
  planned: number;
  budget: number;
  scheduled: SwarmInstanceLike[];   // calls we will ATTEMPT (<= budget)
  unscheduled: SwarmInstanceLike[]; // calls we will NOT attempt — NO fake rate_cap failures
}

/** Spread a budget across the plan, round-robin by shard so a small budget buys breadth (coverage) before
 *  depth. Deterministic. budget<=0 schedules nothing; budget>=plan schedules everything. */
export function resolveBudgetSchedule<T extends SwarmInstanceLike>(plan: T[], budget: number): { planned: number; budget: number; scheduled: T[]; unscheduled: T[] } {
  const b = Math.max(0, Math.floor(Number.isFinite(budget) ? budget : 0));
  const byShard = new Map<string, T[]>();
  for (const inst of plan) {
    if (!byShard.has(inst.shard)) byShard.set(inst.shard, []);
    byShard.get(inst.shard)!.push(inst);
  }
  const queues = [...byShard.values()];
  const ordered: T[] = [];
  let drained = false;
  while (!drained) {
    drained = true;
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) { ordered.push(next); drained = false; }
    }
  }
  return { planned: plan.length, budget: b, scheduled: ordered.slice(0, b), unscheduled: ordered.slice(b) };
}

// ── Task 2: typed attention items ──
export type AttentionKind =
  | 'model_empty_response' | 'schema_failure' | 'provider_rate_limited' | 'budget_exhausted'
  | 'red_quorum' | 'weak_quorum' | 'retry_pack_ready' | 'shard_conflict' | 'other_adapter_failure';

export interface AttentionItem {
  kind: AttentionKind;
  detail: string;      // bounded summary — NO raw model payloads, prompts, or secrets
  count: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function buildAttentionItems(input: {
  results: ReviewResultLike[];
  schedule?: { planned: number; budget: number; scheduled: unknown[]; unscheduled: unknown[] };
  quorumStatus?: string;
  retryPairCount?: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (kind: AttentionKind, detail: string, count = 1) => { if (count > 0) items.push({ kind, detail, count, advisoryOnly: true, grantsAuthority: false }); };
  const by = (...reasons: string[]) => input.results.filter(r => r.failureReason && reasons.includes(r.failureReason)).length;

  add('model_empty_response', 'model(s) returned empty content', by('empty_response'));
  add('schema_failure', 'model(s) returned unparseable/invalid JSON', by('schema_mismatch', 'invalid_json'));
  add('provider_rate_limited', 'provider rate-limited the swarm', by('rate_limited', 'rate_cap'));
  // catch-all: any typed failure not already surfaced above (http_4xx/5xx, network/wall-clock timeout,
  // bad_endpoint, missing_key, generic adapter_failure) — so no real failure class stays invisible.
  const SURFACED = new Set(['empty_response', 'schema_mismatch', 'invalid_json', 'rate_limited', 'rate_cap']);
  const otherFailures = input.results.filter(r => (r.adapterFailure || r.failureReason) && !(r.failureReason && SURFACED.has(r.failureReason))).length;
  add('other_adapter_failure', 'model(s) failed for other typed reasons (timeout / http / endpoint / missing key)', otherFailures);
  if (input.schedule && input.schedule.unscheduled.length > 0) {
    add('budget_exhausted', `${input.schedule.unscheduled.length} of ${input.schedule.planned} planned calls not scheduled (budget ${input.schedule.budget})`, input.schedule.unscheduled.length);
  }
  if (input.quorumStatus === 'RED_QUORUM') add('red_quorum', 'a completed model returned RED');
  if (input.quorumStatus === 'YELLOW_QUORUM' || input.quorumStatus === 'NO_QUORUM') add('weak_quorum', `quorum is ${input.quorumStatus}`);
  if (input.retryPairCount) add('retry_pack_ready', 'failed/weak pair(s) eligible for retry', input.retryPairCount);

  // shard_conflict: a shard whose COMPLETED verdicts disagree (some GREEN/YELLOW, some RED)
  const shards = new Map<string, Set<string>>();
  for (const r of input.results) {
    if (r.adapterFailure || r.failureReason) continue; // completed only
    if (!shards.has(r.shard)) shards.set(r.shard, new Set());
    if (r.verdict) shards.get(r.shard)!.add(r.verdict);
  }
  const conflicted = [...shards.values()].filter(s => s.size > 1).length;
  add('shard_conflict', 'shard(s) with disagreeing completed verdicts', conflicted);
  return items;
}

// ── Task 3: retry / supersede pack (ONLY the failed pairs, never the whole swarm) ──
export interface RetryPair { shard: string; model: string; reason: string; }
export interface RetryPack {
  pairs: RetryPair[];
  supersede: string[];
  advisoryOnly: true;
  grantsAuthority: false;
}

export function buildRetryPack(results: ReviewResultLike[]): RetryPack {
  const pairs: RetryPair[] = results
    .filter(r => r.adapterFailure || (r.failureReason && r.failureReason.length > 0))
    .map(r => ({ shard: r.shard, model: r.model, reason: r.failureReason ?? 'adapter_failure' }));
  const perModel = new Map<string, number>();
  for (const p of pairs) perModel.set(p.model, (perModel.get(p.model) ?? 0) + 1);
  const supersede: string[] = [];
  for (const [model, n] of perModel) {
    if (n >= 2) supersede.push(`model ${model} failed ${n}× — supersede with a different model / smaller evidence pack / cheaper schedule / manual attention`);
  }
  return { pairs, supersede, advisoryOnly: true, grantsAuthority: false };
}

// ── Task 4: terminal Fusion review (advisory summary; safe-as-evidence gate) ──
export interface TerminalReviewSummary {
  quorumStatus: string;
  realCompletedVotes: number;
  nonVotesByReason: Record<string, number>;
  providerContactedCount: number;     // truth: how many calls actually reached a provider
  schedule: { planned: number; scheduled: number; unscheduled: number; budget: number };
  retryRecommended: boolean;
  safeAsEvidence: boolean;            // true only if there is a real, non-empty completed quorum
  summary: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function terminalFusionReview(input: {
  results: ReviewResultLike[];
  schedule: { planned: number; budget: number; scheduled: unknown[]; unscheduled: unknown[] };
  quorumStatus: string;
  completedVotes: number;
  retryPairCount: number;
}): TerminalReviewSummary {
  const nonVotesByReason: Record<string, number> = {};
  let providerContactedCount = 0;
  for (const r of input.results) {
    if (r.provider_contacted) providerContactedCount++;
    if (r.adapterFailure || r.failureReason) {
      const reason = r.failureReason ?? 'adapter_failure';
      nonVotesByReason[reason] = (nonVotesByReason[reason] ?? 0) + 1;
    }
  }
  const safeAsEvidence = input.quorumStatus !== 'NO_QUORUM' && input.completedVotes >= 2;
  return {
    quorumStatus: input.quorumStatus,
    realCompletedVotes: input.completedVotes,
    nonVotesByReason,
    providerContactedCount,
    schedule: { planned: input.schedule.planned, scheduled: input.schedule.scheduled.length, unscheduled: input.schedule.unscheduled.length, budget: input.schedule.budget },
    retryRecommended: input.retryPairCount > 0,
    safeAsEvidence,
    summary: safeAsEvidence
      ? `${input.quorumStatus} from ${input.completedVotes} completed vote(s); ${providerContactedCount} provider contact(s); safe to hand to Aukora as ADVISORY evidence.`
      : `${input.quorumStatus} with only ${input.completedVotes} completed vote(s) — NOT safe as evidence; retry recommended.`,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}
