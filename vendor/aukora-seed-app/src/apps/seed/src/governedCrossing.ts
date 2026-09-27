// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The governed crossing (R47) — the SMALLEST lawful bridge from an Auma-authored pending intent to the EXISTING
 * governed candidate machinery. It closes the R45 AMEND blocker without a second authority path and without
 * importing the mind organ (PR #72) or the donor's native live-apply.
 *
 * DONOR SEMANTICS reused as EVIDENCE ONLY (`docs/INSIDE_OUT_HANDOFF.md`, `/api/loop`): "Auma authors hints from
 * inside (cheap); the carrying lane re-reads the REAL bytes; Peter's out-of-band signature is the one unchanged
 * gate." The intent carries only stated hints — never trusted content. The REAL draft bytes drive the draftHash.
 *
 * CHALLENGE TO THE BRIDGE SHAPE: the entire authority chain already exists — the closed
 * [[proposerQualification]] `SupervisedGenerationEnvelope` + `assessEnvelope` qualifier (halts before signature),
 * and [[localCeremonyRunner]] `runLocalRecursionCeremony` (owner-verify → rehearsal → isolated candidate stage via
 * the ONE reference monitor). So the crossing adds ONLY three things and nothing that can authorize:
 *   1. ONE immutable translation `pending intent + real draft bytes → a DEEP-FROZEN closed envelope`, bound
 *      byte-exact to {draftHash, headBefore, affectedPaths, tests};
 *   2. `qualifyCrossing` = the existing qualifier (structurally halts before signature; grantsAuthority:false);
 *   3. `crossToCandidate` = a thin wrapper over the existing runner that adds a fresh stale-head check and then
 *      delegates the rest, plus `projectCrossing` for the `/api/loop` diff/test/status projection.
 *
 * The crossing NEVER signs, NEVER applies to the live tree, and holds no key. Materialization is the existing
 * disposable-worktree candidate stage; the donor `nativeLiveApply` is not imported and is not an alternate route.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import type { SignedPromotionV2 } from '@aukora/kernel/schemas';
import { deriveIntentId, deriveDraftHash, patchByteLength, type Proposal } from './proposal.js';
import {
  SUPERVISED_ENVELOPE_SCHEMA, PROPOSER_BUDGETS, assessEnvelope,
  type SupervisedGenerationEnvelopeV1, type EnvelopeVerdict,
} from './proposerQualification.js';
import { runLocalRecursionCeremony, type LocalCeremonyEnv, type CeremonyRunResult } from './localCeremonyRunner.js';
import type { RecursionEnv } from './recursion.js';

export const PENDING_INTENT_SCHEMA = 'aukora-pending-intent-v1' as const;

/** The Auma-authored pending intent — honest HINTS only (mirrors the donor `proposal-intent-v1` shape). It carries
 *  NO trusted file content; the carrying lane supplies the real bytes separately. */
export interface PendingIntentV1 {
  readonly schema: typeof PENDING_INTENT_SCHEMA;
  readonly intentId: string;
  readonly goal: string;
  readonly rationale: string;
  /** Stated affected paths with an honesty label. The real draft's target MUST be one of these. */
  readonly affectedPaths: readonly { readonly path: string; readonly epistemicStatus: 'verified' | 'inferred' | 'owner_stated' | 'unknown' }[];
  readonly riskNotes: string;
  readonly authoredBy: 'voice' | 'owner' | 'workbench';
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/** The REAL draft bytes the carrying lane re-read from disk — the ONLY thing the draftHash is computed from. */
export interface DraftBytes {
  readonly targetPath: string;
  readonly newContent: string;
  readonly supersedes?: string | null;
}

/** The immutable binding: what the owner's signature will be bound to, byte-exact. */
export interface CrossingBinding {
  readonly draftHash: string;      // computed from the REAL bytes, never from the intent hints
  readonly headBefore: string;     // the repo HEAD sha at translation time (stale-head guard)
  readonly affectedPaths: readonly string[];
  readonly tests: readonly string[];
  readonly bindingHash: string;    // canonical hash over all of the above
}

export interface GovernedCrossing {
  readonly schema: 'aukora-governed-crossing-v1';
  readonly intentId: string;
  /** The DEEP-FROZEN closed envelope (immutable — mutation attempts throw in strict mode / are inert). */
  readonly envelope: SupervisedGenerationEnvelopeV1;
  readonly binding: CrossingBinding;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export type TranslateResult =
  | { readonly ok: true; readonly crossing: GovernedCrossing }
  | { readonly ok: false; readonly reasonClass: string; readonly text: string };

/** Recursively freeze — the translation output is immutable, so nothing can mutate a qualified envelope in flight. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/**
 * The ONE immutable translation. Deterministic + total. Refuses goal/code substitution (a target the intent did not
 * declare), a non-advisory intent, and an over-budget patch up front. The draftHash is computed from the REAL bytes
 * — the intent's hints can never substitute the signed content.
 */
export function translateToEnvelope(intent: PendingIntentV1, draft: DraftBytes, opts: { headBefore: string; tests?: readonly string[] }): TranslateResult {
  if (!intent || intent.schema !== PENDING_INTENT_SCHEMA) return { ok: false, reasonClass: 'crossing:bad-intent', text: 'refused: not a pending-intent-v1' };
  if (intent.advisoryOnly !== true || intent.grantsAuthority !== false) return { ok: false, reasonClass: 'crossing:bad-intent', text: 'refused: intent must be advisoryOnly + grantsAuthority:false' };
  if (!draft || typeof draft.targetPath !== 'string' || typeof draft.newContent !== 'string') return { ok: false, reasonClass: 'crossing:bad-draft', text: 'refused: malformed draft bytes' };
  if (typeof opts?.headBefore !== 'string' || opts.headBefore.length === 0) return { ok: false, reasonClass: 'crossing:no-head', text: 'refused: headBefore is required (stale-head binding)' };

  // Goal/code substitution: the real draft's target MUST be a path the intent actually declared.
  const declared = intent.affectedPaths.map((p) => p.path);
  if (!declared.includes(draft.targetPath)) {
    return { ok: false, reasonClass: 'crossing:path-not-declared', text: `refused: draft target ${draft.targetPath} is not among the intent's affected paths (code substitution)` };
  }
  if (patchByteLength(draft.newContent) > PROPOSER_BUDGETS.maxPatchBytes) {
    return { ok: false, reasonClass: 'crossing:budget-exceeded', text: 'refused: draft bytes exceed the patch ceiling' };
  }

  const draftHash = deriveDraftHash({ id: 'crossing', targetPath: draft.targetPath, newContent: draft.newContent, createdAt: '2026-01-01T00:00:00.000Z', supersedes: draft.supersedes ?? null });
  const affectedPaths = [...declared].sort();
  const tests = [...(opts.tests ?? [])].sort();
  const binding: CrossingBinding = {
    draftHash, headBefore: opts.headBefore, affectedPaths, tests,
    bindingHash: canonicalHash({ domain: 'AUKORA-CROSSING-BINDING/1', draftHash, headBefore: opts.headBefore, affectedPaths, tests }),
  };

  const envelope: SupervisedGenerationEnvelopeV1 = {
    schema: SUPERVISED_ENVELOPE_SCHEMA,
    statedGoal: intent.goal,                       // advisory prose — NON-binding (never enters draftHash)
    proposal: { targetPath: draft.targetPath, newContent: draft.newContent, supersedes: draft.supersedes ?? null },
    capability: 'propose',
    declared: { planSteps: 1, hypotheses: 1, memoChars: Math.min(intent.rationale.length, PROPOSER_BUDGETS.maxMemoChars), retries: 0, spendUsd: 0 },
    provenance: `pending-intent:${intent.authoredBy}:${intent.intentId.slice(0, 12)}`,
    advisoryOnly: true,
    grantsAuthority: false,
  };

  const crossing: GovernedCrossing = deepFreeze({
    schema: 'aukora-governed-crossing-v1',
    intentId: intent.intentId,
    envelope, binding,
    advisoryOnly: true, grantsAuthority: false,
  });
  return { ok: true, crossing };
}

/** Qualify a crossing through the EXISTING qualifier — structurally halts before signature (no auth is passed). */
export function qualifyCrossing(env: RecursionEnv, crossing: GovernedCrossing): EnvelopeVerdict {
  return assessEnvelope(env, crossing.envelope);
}

export interface CrossToCandidateInput {
  readonly crossing: GovernedCrossing;
  /** The CURRENT repo HEAD sha at crossing time — must equal the binding's headBefore (stale-head guard). */
  readonly currentHead: string;
  /** The owner's out-of-band hybrid authorization over the proposal intent/draft (single-use nonce). */
  readonly auth: SignedPromotionV2;
  readonly nonce: string;
  /** The owner's authorization over the candidate payload hash (required to materialize). */
  readonly candidateAuth?: SignedPromotionV2;
  readonly ownerArmed?: boolean;
  readonly materialize?: boolean;
}

export type CrossResult =
  | { readonly ok: false; readonly reasonClass: string; readonly text: string; readonly run: null }
  | { readonly ok: boolean; readonly reasonClass: string; readonly text: string; readonly run: CeremonyRunResult };

/**
 * Terminate the crossing at the EXISTING governed machinery. Adds ONLY a fresh stale-head check and a qualifier
 * re-check, then delegates entirely to `runLocalRecursionCeremony` (owner-verify → rehearsal → isolated candidate
 * stage via the ONE monitor). No new authority path; the owner's signature is still the one gate.
 */
export function crossToCandidate(env: LocalCeremonyEnv, input: CrossToCandidateInput): CrossResult {
  const { crossing } = input;
  // Stale-head guard: the repo must not have moved since the intent was translated + bound.
  if (input.currentHead !== crossing.binding.headBefore) {
    return { ok: false, reasonClass: 'crossing:stale-head', text: `refused: head moved (${crossing.binding.headBefore.slice(0, 12)} → ${String(input.currentHead).slice(0, 12)}); re-translate`, run: null };
  }
  // Qualifier re-check (halts before signature) — a crossing that would be contained never reaches the runner.
  const verdict = qualifyCrossing(env.recursionEnv, crossing);
  if (!verdict.admitted) {
    return { ok: false, reasonClass: verdict.reasonClass, text: verdict.text, run: null };
  }
  // Delegate to the EXISTING runner. The frozen envelope's proposal is the input; the owner's real auth decides.
  const proposalInput: Proposal = {
    id: `crossing-${crossing.intentId.slice(0, 8)}`,
    targetPath: crossing.envelope.proposal.targetPath,
    newContent: crossing.envelope.proposal.newContent,
    createdAt: env.nowIso,
    supersedes: crossing.envelope.proposal.supersedes ?? null,
  };
  const run = runLocalRecursionCeremony(env, {
    proposalInput, nonce: input.nonce, auth: input.auth,
    materialize: input.materialize === true,
    candidateAuth: input.candidateAuth,
    ownerArmed: input.ownerArmed === true,
    // R54 v6: the crossing's bound base (verified equal to the current head above) rides into the runner's
    // MANDATORY head binding — the candidateAuth must be signed over the head-bound payload for this base.
    expectedHeadBefore: crossing.binding.headBefore,
    explanation: `governed crossing of pending intent ${crossing.intentId.slice(0, 12)}`,
  });
  return { ok: run.ok, reasonClass: run.reasonClass, text: run.text, run };
}

/** The `/api/loop` projection back to the inside-out feedback surface — content-free, no authority, display only. */
export function projectCrossing(crossing: GovernedCrossing, cross: CrossResult): {
  readonly schema: 'aukora-crossing-projection-v1';
  readonly intentId: string;
  readonly draftHash: string;
  readonly headBefore: string;
  readonly affectedPaths: readonly string[];
  readonly tests: readonly string[];
  readonly phase: string;
  readonly admitted: boolean;
  readonly materialized: boolean;
  readonly rehearsalReceiptHash: string | null;
  readonly candidateBranch: string | null;
  readonly grantsAuthority: false;
} {
  const run = cross.run;
  return {
    schema: 'aukora-crossing-projection-v1',
    intentId: crossing.intentId,
    draftHash: crossing.binding.draftHash,
    headBefore: crossing.binding.headBefore,
    affectedPaths: crossing.binding.affectedPaths,
    tests: crossing.binding.tests,
    phase: run?.phase ?? cross.reasonClass,
    admitted: cross.ok || (run !== null && run.phase !== 'refused-at-proposal'),
    materialized: run?.phase === 'candidate-materialized',
    rehearsalReceiptHash: run?.rehearsalReceiptHash ?? null,
    candidateBranch: run?.materialization?.branch ?? null,
    grantsAuthority: false,
  };
}

/** HARD: the crossing translates + projects; it never signs, applies, or mints authority. Constant, by construction. */
export function governedCrossingGrantsAuthority(): false {
  return false;
}
