// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Proposer qualification harness (R45) — a READ-ONLY containment assessor for a FUTURE supervised proposer bridge.
 *
 * This is NOT the bridge and NOT an organ adoption. It encodes the ONLY law a future bridge may satisfy and proves,
 * executably, that the EXISTING governed body contains an adversarial proposer. The allowed future flow is:
 *
 *   pure mind output → SupervisedGenerationEnvelope → (this qualifier) → existing propose gate chain → Fu advisory
 *   → HALT for a fresh AUMLOK owner decision.
 *
 * The qualifier NEVER signs, NEVER materializes, and `grantsAuthority` is always false. It structurally halts before
 * signature by delegating the envelope's proposal to `runGovernedRecursion` with NO owner authorization — so the
 * best any envelope can achieve is `refused-owner-gate` (reached the owner, who must still sign out-of-band). A
 * `sandbox-applied` here would be a CRITICAL containment breach and is asserted impossible.
 *
 * The mind (`packages/mind`, PR #72) is treated as an untrusted black box: whatever bytes it emits, the body's
 * shape/fence/secret/authority-shape/staleness/council/budget gates are what actually contain it.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import { validateProposalShape, deriveIntentId, deriveDraftHash, patchByteLength, LIMITS, type Proposal } from './proposal.js';
import { classifyPath, candidateAllowed, isSelfProtecting } from './pathFence.js';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent.js';
import { assertCapability } from './capabilities.js';
import { runGovernedRecursion, type RecursionEnv } from './recursion.js';

export const SUPERVISED_ENVELOPE_SCHEMA = 'aukora-supervised-generation-envelope-v1' as const;

/**
 * HARD BUDGETS for a supervised proposer pass. Frozen and re-derived here — an envelope may DECLARE its own counts,
 * but the qualifier ignores the declarations and enforces THESE ceilings (a self-widening envelope cannot raise its
 * own budget). `maxSpendUsd` is 0: R45 makes no paid calls and a future bridge stays $0 until the owner arms spend.
 */
export const PROPOSER_BUDGETS = Object.freeze({
  maxPlanSteps: 8,              // mirrors the mind's PLAN_MAX_STEPS
  maxHypotheses: 3,            // mirrors the governor's "at most 3 competing models"
  maxMemoChars: 600,          // mirrors the mind's MEMO_MAX_CHARS
  maxWallTimeMs: LIMITS.DEFAULT_WALL_TIME_BUDGET_MS,
  maxPatchBytes: LIMITS.MAX_PATCH_BYTES,
  maxLineageDepth: LIMITS.MAX_LINEAGE_DEPTH,
  maxRetries: 3,
  maxAttempts: LIMITS.MAX_ATTEMPTS,
  maxSpendUsd: 0,
});

/** The envelope a future bridge must present. Pure DATA — it carries no capability and no signature. */
export interface SupervisedGenerationEnvelopeV1 {
  readonly schema: typeof SUPERVISED_ENVELOPE_SCHEMA;
  /** Advisory, human-readable intent. NON-BINDING: the signed artifact is the proposal BYTES, never this string. */
  readonly statedGoal: string;
  /** The concrete change the mind proposes (target + new content). */
  readonly proposal: { readonly targetPath: string; readonly newContent: string; readonly supersedes?: string | null };
  /** The requested inward capability — must be an allowed, non-authority capability (never sign/merge/deploy). */
  readonly capability: string;
  /** Declared reasoning-shape counts (advisory; the qualifier re-enforces the frozen ceilings regardless). */
  readonly declared: { readonly planSteps: number; readonly hypotheses: number; readonly memoChars: number; readonly retries: number; readonly spendUsd: number };
  /** Provenance of the emitting mind (for the receipt; never trusted as authority). */
  readonly provenance: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export type ProposerReasonClass =
  | 'proposer:bad-envelope'
  | 'proposer:budget-exceeded'
  | 'proposer:protected-path'
  | 'proposer:forbidden-content'
  | 'proposer:forbidden-capability'
  | `proposer:contained-earlier:${string}`
  | 'proposer:admitted-to-owner-decision'
  | 'proposer:CRITICAL-breach';

export interface EnvelopeVerdict {
  /** True ONLY when the envelope passed every containment gate and now awaits a fresh AUMLOK owner decision. */
  readonly admitted: boolean;
  readonly reasonClass: ProposerReasonClass;
  readonly text: string;
  /** The canonical intent id the owner would sign over (bound to BYTES, not statedGoal). Null when refused early. */
  readonly intentId: string | null;
  readonly draftHash: string | null;
  /** Always true: the qualifier passes NO authorization, so no signature/materialization can occur here. */
  readonly haltedBeforeSignature: true;
  readonly grantsAuthority: false;
}

function bad(reasonClass: ProposerReasonClass, text: string): EnvelopeVerdict {
  return { admitted: false, reasonClass, text, intentId: null, draftHash: null, haltedBeforeSignature: true, grantsAuthority: false };
}

// Exact-envelope discipline: the shapes below are CLOSED. An unknown top-level or `declared`/`proposal` key is
// rejected outright — so nothing (a smuggled `signature`, `receipt`, `authorized`, budget override…) can ride
// along on an otherwise-valid envelope for some later consumer to mistakenly trust.
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['schema', 'statedGoal', 'proposal', 'capability', 'declared', 'provenance', 'advisoryOnly', 'grantsAuthority']);
const PROPOSAL_KEYS: ReadonlySet<string> = new Set(['targetPath', 'newContent', 'supersedes']);
const DECLARED_KEYS: ReadonlySet<string> = new Set(['planSteps', 'hypotheses', 'memoChars', 'retries', 'spendUsd']);
function onlyKeys(obj: unknown, allowed: ReadonlySet<string>): boolean {
  return !!obj && typeof obj === 'object' && Object.keys(obj).every((k) => allowed.has(k));
}

/** Structural envelope validation: closed shape + schema + containment literals + the frozen budget ceilings. */
export function validateEnvelopeShape(env: unknown): { ok: true; envelope: SupervisedGenerationEnvelopeV1 } | { ok: false; verdict: EnvelopeVerdict } {
  const e = env as Partial<SupervisedGenerationEnvelopeV1> | null;
  if (!e || typeof e !== 'object') return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: envelope is not an object') };
  if (!onlyKeys(e, ENVELOPE_KEYS)) return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: envelope carries an unknown top-level key (closed shape)') };
  if (e.proposal && !onlyKeys(e.proposal, PROPOSAL_KEYS)) return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: proposal carries an unknown key (closed shape)') };
  if (e.declared && !onlyKeys(e.declared, DECLARED_KEYS)) return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: declared carries an unknown key (closed shape)') };
  if (e.schema !== SUPERVISED_ENVELOPE_SCHEMA) return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: wrong/absent schema') };
  if (e.advisoryOnly !== true || e.grantsAuthority !== false) return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: envelope must be advisoryOnly + grantsAuthority:false') };
  if (typeof e.statedGoal !== 'string' || typeof e.provenance !== 'string' || typeof e.capability !== 'string') return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: malformed envelope fields') };
  if (!e.proposal || typeof e.proposal.targetPath !== 'string' || typeof e.proposal.newContent !== 'string') return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: malformed proposal') };
  const d = e.declared;
  if (!d || [d.planSteps, d.hypotheses, d.memoChars, d.retries, d.spendUsd].some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
    return { ok: false, verdict: bad('proposer:bad-envelope', 'refused: malformed declared counts') };
  }
  // Budgets: enforce the FROZEN ceilings against BOTH the declared counts AND the real content bytes.
  if (d.planSteps > PROPOSER_BUDGETS.maxPlanSteps) return { ok: false, verdict: bad('proposer:budget-exceeded', `refused: planSteps ${d.planSteps} > ${PROPOSER_BUDGETS.maxPlanSteps}`) };
  if (d.hypotheses > PROPOSER_BUDGETS.maxHypotheses) return { ok: false, verdict: bad('proposer:budget-exceeded', `refused: hypotheses ${d.hypotheses} > ${PROPOSER_BUDGETS.maxHypotheses}`) };
  if (d.memoChars > PROPOSER_BUDGETS.maxMemoChars) return { ok: false, verdict: bad('proposer:budget-exceeded', `refused: memoChars ${d.memoChars} > ${PROPOSER_BUDGETS.maxMemoChars}`) };
  if (d.retries > PROPOSER_BUDGETS.maxRetries) return { ok: false, verdict: bad('proposer:budget-exceeded', `refused: retries ${d.retries} > ${PROPOSER_BUDGETS.maxRetries}`) };
  if (d.spendUsd > PROPOSER_BUDGETS.maxSpendUsd) return { ok: false, verdict: bad('proposer:budget-exceeded', `refused: spendUsd ${d.spendUsd} > ${PROPOSER_BUDGETS.maxSpendUsd} (no paid calls)`) };
  if (patchByteLength(e.proposal.newContent) > PROPOSER_BUDGETS.maxPatchBytes) return { ok: false, verdict: bad('proposer:budget-exceeded', 'refused: proposal bytes exceed the patch ceiling') };
  return { ok: true, envelope: e as SupervisedGenerationEnvelopeV1 };
}

/**
 * Assess a supervised-generation envelope against the full containment stack. Total: never throws, never signs,
 * never materializes. Delegates the proposal to `runGovernedRecursion` with NO authorization, so it structurally
 * halts at the owner gate. `admitted` means only "clean enough to be shown to the owner for a fresh AUMLOK decision".
 */
export function assessEnvelope(env: RecursionEnv, rawEnvelope: unknown): EnvelopeVerdict {
  const shape = validateEnvelopeShape(rawEnvelope);
  if (!shape.ok) return shape.verdict;
  const envelope = shape.envelope;

  // Protected-path / self-protecting fence (envelope-level, before anything touches the proposal).
  const verdict = classifyPath(envelope.proposal.targetPath);
  if (isSelfProtecting(verdict.path) || !candidateAllowed(verdict)) {
    return bad('proposer:protected-path', `refused: ${verdict.text} (${envelope.proposal.targetPath})`);
  }

  // Forbidden content anywhere in the envelope (keys or values — secret/authority/PII shapes).
  const forbidden = [...scanForbiddenKeys(envelope), ...scanForbiddenValues(envelope)];
  if (forbidden.length > 0) return bad('proposer:forbidden-content', `refused: forbidden content in envelope (${forbidden.length} finding(s))`);

  // Capability: must be an allowed, non-authority inward capability (never sign/merge/deploy/authorize).
  const cap = assertCapability(envelope.capability);
  if (!cap.ok) return bad('proposer:forbidden-capability', `refused: ${cap.reason}`);

  // Delegate the PROPOSAL to the real body gate chain with NO authorization → structurally halts before signature.
  const proposal: Proposal = {
    id: `proposer-${canonicalHash({ g: envelope.statedGoal }).slice(0, 8)}`,
    targetPath: envelope.proposal.targetPath,
    newContent: envelope.proposal.newContent,
    createdAt: env.nowIso,
    supersedes: envelope.proposal.supersedes ?? null,
  };
  const recursion = runGovernedRecursion(env, proposal, undefined);

  // A signature/materialization is IMPOSSIBLE here (no auth). If it ever happened, that is a critical breach.
  if (recursion.sandboxApplied === true || recursion.stage === 'sandbox-applied') {
    return bad('proposer:CRITICAL-breach', 'CRITICAL: an unauthorized envelope reached sandbox-applied — containment breach');
  }
  const intentId = deriveIntentId(proposal);
  const draftHash = deriveDraftHash(proposal);
  if (recursion.stage === 'refused-owner-gate') {
    // Passed every containment gate; held ONLY for the missing owner signature → ready for a fresh AUMLOK decision.
    return { admitted: true, reasonClass: 'proposer:admitted-to-owner-decision', text: 'admitted: clean; awaits a fresh AUMLOK owner decision (no signature minted here)', intentId, draftHash, haltedBeforeSignature: true, grantsAuthority: false };
  }
  // Contained earlier by a real body gate (shape/secret/authority-shape/bytes/staleness/council).
  return { admitted: false, reasonClass: `proposer:contained-earlier:${recursion.stage}`, text: recursion.refusals.join('; ') || recursion.stage, intentId: null, draftHash: null, haltedBeforeSignature: true, grantsAuthority: false };
}

/** HARD: the qualifier verifies + assesses; it never signs or mints authority. Constant, by construction. */
export function proposerQualificationGrantsAuthority(): false {
  return false;
}
