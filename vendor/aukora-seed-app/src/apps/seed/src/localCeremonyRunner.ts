// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The composed, owner-invoked local recursion ceremony (R37).
 *
 * ONE flow ties together the durable machine, the real store, the Fu structured adapter, and the LocalCandidateStage:
 *
 *   1. PROPOSE (durable) — a proposal-bound Fu SIDECAR advisory is consumed as `env.review` (real Fu evidence when
 *      a completed outcome is supplied, else the deterministic offline review). Council-hold terminalizes; a pass
 *      persists `awaiting-owner`.
 *   2. OWNER VERIFY (durable complete) — the canonical gate re-verifies EVERYTHING in process against the owner's
 *      hybrid signature. Advisory review never authorizes; the owner does.
 *   3. REHEARSAL LADDER — the accepted apply IS the sandbox rehearsal; its receipt is the ladder rung the candidate
 *      stage requires (per lineage: intent → draft → rehearsal receipt).
 *   4. CANDIDATE STAGE — ONLY on an explicit `materialize:true` invocation AND a FRESH in-process AUMLOK verification
 *      does the passed intent land in a disposable worktree/candidate branch. It never signs, pushes, merges, or
 *      touches main.
 *
 * NO AUTO-RESUME OF AN EFFECT AFTER RESTART: a restarted ceremony re-reads durable state and re-verifies from
 * scratch. It will NEVER materialize a candidate on its own — materialization requires an explicit owner invocation
 * with `materialize:true` and a fresh authorization each time; a durable state alone can never trigger an effect.
 *
 * This runner composes; it never signs. AURA stays display-only (the runner emits geometry/trace but reads nothing
 * back into a decision). Every terminal is receipted with a stable reason class.
 */
import type { ReactiveMemoryStore } from '@aukora/brain';
import type { AumlokAuthorityRootV2, SignedPromotionV2 } from '@aukora/kernel/schemas';
import type { CouncilOutcome } from '@aukora/council';
import { DurableRecursion, deriveWorkflowId, type WorkflowStore, type WorkflowStateV1 } from './durableRecursion.js';
import { runGovernedRecursion, type RecursionEnv } from './recursion.js';
import { AumaIdeEnvelope, type RepoReadCapability, type BranchCandidate } from './ideEnvelope.js';
import { deriveIntentId, deriveDraftHash, type Proposal } from './proposal.js';
import { reviewerFor } from './fuStructuredAdapter.js';
import { type CandidateMaterialization } from './localCandidateStage.js';
import { runLiveCandidateEffect } from './liveEffectOps.js';
import { CandidateReferenceMonitor } from './candidateReferenceMonitor.js';
import { DurableCandidateReferenceMonitor, trustedStateDirInsideFence } from './durableCandidateMonitor.js';
import type { CouncilReviewer } from './mockCouncil.js';

export type CeremonyRunPhase =
  | 'proposed-awaiting-owner'
  | 'refused-at-proposal'
  | 'owner-verified-rehearsed'
  | 'refused-at-owner'
  | 'candidate-materialized'
  | 'refused-at-candidate'
  | 'awaiting-explicit-materialize';

export interface CeremonyRunResult {
  readonly ok: boolean;
  readonly phase: CeremonyRunPhase;
  readonly reasonClass: string;
  readonly text: string;
  readonly workflowId: string;
  readonly workflowState: WorkflowStateV1 | null;
  readonly rehearsalReceiptHash: string | null;
  readonly candidate: BranchCandidate | null;
  readonly materialization: CandidateMaterialization | null;
  /** Never signs / pushes / merges / touches main — hard-false literals. */
  readonly signed: false;
  readonly pushed: false;
  readonly touchedMain: false;
  readonly grantsAuthority: false;
}

export interface LocalCeremonyEnv {
  readonly recursionEnv: RecursionEnv;
  readonly workflowStore: WorkflowStore;
  readonly repo: RepoReadCapability;
  readonly ownerRoot: AumlokAuthorityRootV2;
  readonly store: ReactiveMemoryStore;
  /** The canonical kernel reference monitor for the candidate effect (durable consumed-id state). Constructed if absent. */
  readonly monitor?: CandidateReferenceMonitor;
  /**
   * R54: protected trusted-state directory for the DURABLE reference monitor. When set (and no explicit `monitor`
   * is injected), the ceremony consumes authority through `@aukora/kernel-node`'s crash-safe TrustedStateStore —
   * the consumption + PREPARED descriptor are journalled BEFORE any git effect. MUST live outside the repo root
   * and outside the disposable worktree base (it must survive candidate cleanup and process death).
   */
  readonly trustedStateDir?: string;
  /** For candidate materialization (effectful). Omit to keep the ceremony non-materializing. */
  readonly gitRepoRoot?: string;
  readonly worktreeBase?: string;
  readonly nowMs: number;
  readonly nowIso: string;
}

export interface LocalCeremonyInvocation {
  readonly proposalInput: unknown;
  readonly nonce: string;
  readonly auth: SignedPromotionV2;
  /** Proposal-bound Fu sidecar: a COMPLETED advisory outcome for THIS proposal. Omitted ⇒ deterministic offline review. */
  readonly fuOutcome?: CouncilOutcome;
  /** Explicit owner intent to materialize a candidate this invocation. Never inferred from durable state. */
  readonly materialize?: boolean;
  /** The owner's authorization over the HEAD-BOUND candidate payload hash (required to materialize; verified by
   *  the monitor). R54 v6: it MUST be signed over `candidatePayloadHash(candidate, expectedHeadBefore)` — the
   *  head-free `/1` payload no longer authorizes a materialization through this ACTIVE door. */
  readonly candidateAuth?: SignedPromotionV2;
  /** The owner has explicitly ARMED materialization (maps to the kernel's humanClearance). */
  readonly ownerArmed?: boolean;
  /** The exact HEAD this materialization was approved against — REQUIRED to materialize (R54 v6): it is enforced
   *  against the ACTUAL repo head before the durable consume (R50 stale-head), AND it is bound inside the SIGNED
   *  candidate payload, so an approval for base A can never be replayed while claiming a later base B. A missing
   *  value refuses before the durable consume. */
  readonly expectedHeadBefore?: string;
  readonly explanation?: string;
}

function result(over: Partial<CeremonyRunResult> & Pick<CeremonyRunResult, 'ok' | 'phase' | 'reasonClass' | 'text' | 'workflowId'>): CeremonyRunResult {
  return {
    workflowState: null, rehearsalReceiptHash: null, candidate: null, materialization: null,
    signed: false, pushed: false, touchedMain: false, grantsAuthority: false, ...over,
  };
}

/**
 * Run one owner-invoked local recursion ceremony. Idempotent + restart-safe via the durable machine; an EFFECT
 * (candidate materialization) happens only on an explicit `materialize:true` invocation with a fresh authorization.
 */
export function runLocalRecursionCeremony(env: LocalCeremonyEnv, invocation: LocalCeremonyInvocation): CeremonyRunResult {
  const review: CouncilReviewer | undefined = invocation.fuOutcome ? reviewerFor(invocation.fuOutcome) : env.recursionEnv.review;
  const recursionEnv: RecursionEnv = { ...env.recursionEnv, review };
  const machine = new DurableRecursion(env.workflowStore, recursionEnv);

  // 1. PROPOSE — proposal-bound Fu sidecar consumed as advisory evidence.
  const proposed = machine.propose(invocation.proposalInput, invocation.nonce);
  if (!proposed.ok || proposed.state === null) {
    return result({ ok: false, phase: 'refused-at-proposal', reasonClass: proposed.reasonClass, text: proposed.text, workflowId: proposed.state?.workflowId ?? 'n/a', workflowState: proposed.state });
  }
  const workflowId = proposed.state.workflowId;

  // 2. OWNER VERIFY — the canonical gate decides; a durable projection can never authorize.
  const completed = machine.complete(invocation.proposalInput, workflowId, invocation.auth);
  const state = completed.state;
  if (state === null || state.phase !== 'applied') {
    return result({ ok: false, phase: 'refused-at-owner', reasonClass: completed.gate?.stage ?? completed.reasonClass, text: completed.text, workflowId, workflowState: state });
  }
  const rehearsalReceiptHash = state.receiptHash;

  // 3. REHEARSAL LADDER — build the staged candidate from the SAME governed apply (its receipt is the ladder rung).
  const ide = new AumaIdeEnvelope(env.repo);
  const draft = ide.draft(proposalToDraftInput(invocation.proposalInput));
  if (!draft.ok || draft.proposal === null) {
    return result({ ok: true, phase: 'owner-verified-rehearsed', reasonClass: 'workflow:ok', text: 'owner-verified + rehearsed; candidate draft unavailable', workflowId, workflowState: state, rehearsalReceiptHash });
  }

  // 4. CANDIDATE STAGE — ONLY on explicit materialize + fresh AUMLOK verification (never auto-resumed).
  if (invocation.materialize !== true) {
    return result({ ok: true, phase: 'awaiting-explicit-materialize', reasonClass: 'workflow:ok', text: 'owner-verified + rehearsed; awaiting an explicit materialize invocation (no effect without one)', workflowId, workflowState: state, rehearsalReceiptHash });
  }
  if (env.gitRepoRoot === undefined || env.worktreeBase === undefined) {
    return result({ ok: false, phase: 'refused-at-candidate', reasonClass: 'candidate:not-a-repo', text: 'refused: materialize requested but no git repoRoot/worktreeBase configured', workflowId, workflowState: state, rehearsalReceiptHash });
  }
  const proposal = draft.proposal;
  // The durable owner-verify WAS the sandbox rehearsal; its receipt is the ladder rung. Assemble the candidate from
  // that passed rehearsal (never re-run the gate — that would double-apply / re-consume the nonce).
  if (rehearsalReceiptHash === null) {
    return result({ ok: false, phase: 'refused-at-candidate', reasonClass: 'ide:not-rehearsed', text: 'refused: applied workflow carries no rehearsal receipt', workflowId, workflowState: state, rehearsalReceiptHash });
  }
  const depth = env.recursionEnv.ledger.knownIntentDepth(deriveIntentId(proposal));
  const staged = ide.assembleRehearsedCandidate([{ proposal, rehearsalReceiptHash, depth }], invocation.explanation ?? 'owner-invoked local ceremony candidate');
  if (!staged.ok) {
    return result({ ok: false, phase: 'refused-at-candidate', reasonClass: staged.refusal.reasonClass, text: staged.refusal.text, workflowId, workflowState: state, rehearsalReceiptHash });
  }
  // R54: prefer the DURABLE monitor whenever a protected state dir is configured — the consumption is then
  // crash-safe on disk before the stage's first git mutation. An explicit injected monitor still wins (tests).
  // RUNTIME ISOLATION (R54 review repair): the trusted-state dir must sit OUTSIDE the repo working tree and
  // OUTSIDE the disposable worktree base, checked AFTER canonical/symlink resolution — a docstring is not a
  // fence. Inside the repo it could ride a candidate/commit or be swept by git clean; inside the worktree base
  // it would be disposed with a failed candidate — either way consumed authority could be erased or exfiltrated.
  // (The canonicalization itself lives in durableCandidateMonitor — this runner is a RUNTIME module and, per the
  // structural containment law, must not import fs; it composes the verdict, the effect-adjacent module resolves.)
  if (env.monitor === undefined && env.trustedStateDir !== undefined
    && trustedStateDirInsideFence(env.trustedStateDir, [env.gitRepoRoot, env.worktreeBase])) {
    return result({ ok: false, phase: 'refused-at-candidate', reasonClass: 'candidate:trusted-state-inside-repo', text: 'refused: trustedStateDir resolves inside the repo or the disposable worktree base — the durable authority store must live outside both', workflowId, workflowState: state, rehearsalReceiptHash });
  }
  const monitor = env.monitor ?? (env.trustedStateDir !== undefined
    ? new DurableCandidateReferenceMonitor(env.ownerRoot, env.trustedStateDir)
    : new CandidateReferenceMonitor(env.ownerRoot));
  // R54 v6 — the ACTIVE door is MANDATORILY head-bound: a missing expectedHeadBefore is unverifiable, so refuse
  // it here (the same fail-closed the stage's head-bound precondition enforced) before any effect.
  if (invocation.expectedHeadBefore === undefined) {
    return result({ ok: false, phase: 'refused-at-candidate', reasonClass: 'candidate:stale-head', text: 'refused: head-bound authorization requires expectedHeadBefore (the approved base)', workflowId, workflowState: state, rehearsalReceiptHash, candidate: staged.candidate });
  }
  // R56 — the PRIMARY ceremony materialization now runs THROUGH the crash-recoverable effect coordinator
  // (`runLiveCandidateEffect`): rehearsal gate → NON-CONSUMING owner verify (forged/absent/wrong-base
  // authorization refuses BEFORE any Git) → durable PREPARED consume + the ONE isolated Git effect inside the
  // effect adapter → observe reality → isolation check → projection-only settle. Direct `materializeCandidate()`
  // lives ONLY inside that adapter now, never beside it. Crash-safety is free from the composition: a durably
  // consumed authorization replay-refuses and the adapter OBSERVES the existing candidate instead of
  // re-executing (COMMITTED / RECONCILE_REQUIRED / QUARANTINED), so a crash after consume — before OR after Git —
  // never double-effects. The stage still verifies the head-bound signature over the SAME `expectedHeadBefore`.
  const live = runLiveCandidateEffect({
    repoRoot: env.gitRepoRoot,
    worktreeBase: env.worktreeBase,
    candidate: staged.candidate,
    candidateAuth: invocation.candidateAuth, // owner's signature over the HEAD-BOUND candidate payload hash
    expectedHeadBefore: invocation.expectedHeadBefore,
    ownerArmed: invocation.ownerArmed === true,
    ownerRoot: env.ownerRoot,
    monitor,                                  // the ONE canonical kernel reference monitor (durable when configured)
    store: env.store,
    nowMs: env.nowMs,
    nowIso: env.nowIso,
  });
  const materialization = live.materialization; // the underlying stage result (branch/commitSha/receipts), or null
  if (live.phase === 'COMMITTED') {
    return result({ ok: true, phase: 'candidate-materialized', reasonClass: 'candidate:ok', text: materialization?.text ?? 'candidate materialized', workflowId, workflowState: state, rehearsalReceiptHash, candidate: staged.candidate, materialization });
  }
  // Any non-COMMITTED coordinator verdict is a refused ceremony. Use the EXACT stage reason ONLY when the stage
  // itself REFUSED (`!materialization.ok` → candidate:stale-head / candidate:reference-monitor-refused /
  // candidate:already-materialized …). When the stage SUCCEEDED but the coordinator then failed the run
  // (isolation violated, candidate absent on re-read, null completion, settlement unaccepted), the underlying
  // `materialization.reasonClass` is still `candidate:ok` — reporting that with `ok:false` would be a
  // success-reason on a failure. In that case (and when the owner gate refused before the stage ran) use the
  // COORDINATOR's failure reason instead; a bad candidate authorization the owner gate caught maps to the same
  // root cause the stage's decide() would have named.
  const stageRefused = materialization !== null && !materialization.ok;
  const reasonClass = stageRefused
    ? materialization.reasonClass
    : live.phase === 'REFUSED_AT_OWNER'
      ? 'candidate:reference-monitor-refused'
      : live.reasonClass;
  const text = stageRefused ? materialization.text : `refused at the governed effect (${reasonClass})`;
  return result({ ok: false, phase: 'refused-at-candidate', reasonClass, text, workflowId, workflowState: state, rehearsalReceiptHash, candidate: staged.candidate, materialization });
}

/** Extract the draft input from an already-validated proposal input (the durable gate validated it). */
function proposalToDraftInput(proposalInput: unknown): { targetPath: string; newContent: string; createdAt: string; supersedes?: string | null; id?: string } {
  const p = proposalInput as Partial<Proposal>;
  return { targetPath: String(p.targetPath ?? ''), newContent: String(p.newContent ?? ''), createdAt: String(p.createdAt ?? ''), supersedes: p.supersedes ?? null, id: p.id };
}

/** Re-derive the workflow id for a proposal + nonce — for a restarted ceremony to locate its durable state. */
export function ceremonyWorkflowId(proposal: Proposal, nonce: string): string {
  return deriveWorkflowId(deriveIntentId(proposal), deriveDraftHash(proposal), nonce);
}

/** HARD: the runner composes; it never signs, pushes, merges, or mints authority. Constant, by construction. */
export function localCeremonyGrantsAuthority(): false {
  return false;
}
