// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Governed inward-out recursion (hardened, R29).
 *
 * A proposed self-change flows through a strictly ordered, fail-closed pipeline:
 *
 *   propose
 *   → validate exact shape (snapshot-first; rejects unknown/symbol/non-enumerable/getter/proxy smuggling)
 *   → derive canonical 64-hex intent id
 *   → bind supersedes lineage (reachable + bounded depth)
 *   → secret / staleness / authority-shape checks
 *   → Fu advisory review (advisory-only; produces required council EVIDENCE, authorizes NOTHING)
 *   → AUMLOK owner verification (real hybrid Ed25519 + ML-DSA-65, bound to THIS intent + draft)
 *   → sandbox-only application (isolated in-memory Map; never a live repo, never the filesystem)
 *   → receipt (every terminal outcome, accept or refuse, is receipt-chained into memory)
 *
 * Hard stops are enforced up front: maximum attempts, wall-time budget, patch bytes, lineage depth. The runtime
 * NEVER signs (verification only); a favorable council verdict can NEVER substitute for the owner's signature;
 * replays, stale/forged signatures, target/content mismatch, secret-shaped patches, invalid lineage, and missing
 * council evidence all fail closed. This orchestrator reuses canonical law only — @aukora/evidence (secret scan),
 * @aukora/memory (containment, receipts), @aukora/kernel/staleness (the canonical staleness law), @aukora/council (advisory basis), @aukora/kernel/authority
 * (hybrid AUMLOK verify), @aukora/brain (receipt-chained memory).
 */
import { textHasSecret } from '@aukora/evidence';
import { advisoryContainmentGrantsAuthority, buildMemoryRecord } from '@aukora/memory';
import { stalenessVerdict } from '@aukora/kernel/staleness'; // canonical staleness law (single source)
import type { ReactiveMemoryStore } from '@aukora/brain';
import type { AumlokAuthorityRootV2, SignedPromotionV2 } from '@aukora/kernel/schemas';
import {
  LIMITS, validateProposalShape, deriveIntentId, deriveDraftHash, evaluateLineage, patchByteLength,
} from './proposal.js';
import type { RecursionLedger } from './ledger.js';
import { mockCouncilReview, type CouncilReviewer, type CouncilVerdict } from './mockCouncil.js';
import { verifyOwnerPromotion, AUMLOK_MODE } from './aumlokGate.js';
import { AuraTraceLog, TRACE_LIMITS, type TracePhase } from './auraTrace.js';
import { metabolismDecision } from './metabolism.js';

/** An owner authorization is a hybrid AUMLOK signed promotion — never an Ed25519-only shape. */
export type OwnerAuthorization = SignedPromotionV2;

export interface RecursionEnv {
  readonly store: ReactiveMemoryStore;
  /** Grounding: the proposal target must exist here (real files), else it is ungrounded. */
  readonly knownFiles: ReadonlySet<string>;
  /** The trusted hybrid owner authority root (Ed25519 + ML-DSA-65). */
  readonly ownerRoot: AumlokAuthorityRootV2;
  /** Session-scoped replay / attempt / lineage guard. */
  readonly ledger: RecursionLedger;
  readonly nowMs: number;
  readonly nowIso: string;
  /** Absolute wall-time deadline (a hard stop). Requests observed after it fail closed. */
  readonly deadlineMs: number;
  /** Advisory council review. Defaults to the deterministic offline mock; injectable for tests. Authorizes nothing. */
  readonly review?: CouncilReviewer;
  /** Optional AURA trace log (TRACE_ONLY). Every terminal outcome emits a scrubbed trace here; authorizes nothing. */
  readonly trace?: AuraTraceLog;
  /** Optional metabolism capacity in [0,1] — a MONOTONIC CONTRACTION input. Low capacity can only ADD a refusal;
   *  it can never grant authority or turn a refusal into an acceptance. */
  readonly metabolismCapacity?: number;
}

export interface RecursionResult {
  readonly accepted: boolean;
  readonly stage: string;
  readonly refusals: readonly string[];
  readonly intentId: string | null;
  readonly councilVerdict: 'advisory-pass' | 'advisory-hold' | null;
  /** The council-evidence digest that was actually present (null if none). */
  readonly councilEvidenceDigest: string | null;
  readonly sandboxApplied: boolean;
  /** Isolated sandbox result — an in-memory Map, never written to disk. */
  readonly sandbox?: ReadonlyMap<string, string>;
  /** Every terminal outcome is receipt-chained; this is that receipt's chain hash (null only if ingest refused). */
  readonly receiptHash: string | null;
  /** Load-bearing containment literal: this pipeline mints no authority, ever. */
  readonly authorityMinted: false;
  readonly aumlokMode: typeof AUMLOK_MODE;
}

const AUTHORITY_SHAPES = /grantsauthority\s*[:=]\s*true|liveapply|live-apply|owner-?impersonat|sign-?for-?owner/i;

interface Terminal {
  readonly accepted: boolean;
  readonly stage: string;
  readonly refusals: readonly string[];
  readonly intentId: string | null;
  readonly councilVerdict?: 'advisory-pass' | 'advisory-hold' | null;
  readonly councilEvidenceDigest?: string | null;
  readonly sandbox?: ReadonlyMap<string, string>;
}

/**
 * Ingest a bounded receipt for a terminal outcome and return its chain hash (null if the store refused the write —
 * corrupt/full store). The receipt content is a fixed, bounded summary — it NEVER echoes the proposed content or
 * any untrusted field, so a secret-shaped or malformed patch cannot leak through the audit trail. `targetLabel` is
 * caller-controlled and safe (a validated path, or a constant placeholder for pre-validation refusals).
 */
function ingestReceipt(env: RecursionEnv, seq: number, accepted: boolean, stage: string, intentId: string | null, targetLabel: string): string | null {
  const content =
    `governed-recursion ${accepted ? 'applied' : 'refused'} · seq=${seq} · stage=${stage}` +
    ` · intent=${intentId ?? 'n/a'} · target=${targetLabel}`;
  const ing = env.store.ingest(buildMemoryRecord({ content, createdAt: env.nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'governed-recursion' }));
  return ing.ok ? ing.chainHash : null;
}

/** Emit a scrubbed AURA trace (TRACE_ONLY) for a terminal outcome, if a trace log is present. Safe categories only:
 *  the phase/stage, a safe refusal category, and a SHORT (≤12 hex) intent correlator — never content or a full id. */
function emitTrace(env: RecursionEnv, seq: number, phase: TracePhase, stage: string, intentId: string | null): void {
  if (!env.trace) return;
  env.trace.record({
    eventId: `rec_${seq}_${stage}`,
    timestampMs: Number.isSafeInteger(env.nowMs) ? env.nowMs : 0,
    phase,
    stage,
    receiptMode: phase === 'applied' ? 'write' : phase === 'refused' ? 'witness' : 'unknown',
    refusalCause: phase === 'refused' ? stage : undefined,
    intentPrefix: intentId ? intentId.slice(0, TRACE_LIMITS.MAX_INTENT_PREFIX) : undefined,
    source: 'governedRecursion',
  });
}

/** Finalize a REFUSAL: receipt it (fail-closed if the store refuses ⇒ receiptHash null) and emit a scrubbed trace. */
function finalize(env: RecursionEnv, seq: number, t: Terminal, targetLabel: string): RecursionResult {
  const receiptHash = ingestReceipt(env, seq, t.accepted, t.stage, t.intentId, targetLabel);
  emitTrace(env, seq, t.accepted ? 'applied' : 'refused', t.stage, t.intentId);
  return {
    accepted: t.accepted,
    stage: t.stage,
    refusals: t.refusals,
    intentId: t.intentId,
    councilVerdict: t.councilVerdict ?? null,
    councilEvidenceDigest: t.councilEvidenceDigest ?? null,
    sandboxApplied: t.sandbox !== undefined,
    sandbox: t.sandbox,
    receiptHash,
    authorityMinted: false,
    aumlokMode: AUMLOK_MODE,
  };
}

/** Run the governed recursion. Fail-closed at every gate; only a valid hybrid owner signature authorizes a sandbox apply. */
export function runGovernedRecursion(env: RecursionEnv, proposalInput: unknown, auth?: OwnerAuthorization): RecursionResult {
  const ledger = env.ledger;
  const review = env.review ?? mockCouncilReview;

  // HARD STOP 1 — maximum attempts per session (fail-closed, before any work).
  if (!ledger.tryAttempt()) {
    return finalize(env, ledger.attempts, { accepted: false, stage: 'hard-stop-max-attempts', refusals: ['hard-stop: max attempts exceeded'], intentId: null }, '<attempts-exhausted>');
  }
  const seq = ledger.attempts;

  // HARD STOP 2 — wall-time budget.
  if (!Number.isSafeInteger(env.nowMs) || env.nowMs > env.deadlineMs) {
    return finalize(env, seq, { accepted: false, stage: 'hard-stop-wall-time', refusals: ['hard-stop: wall-time budget exceeded'], intentId: null }, '<wall-time>');
  }

  // METABOLIC CONTRACTION — a refuse-only resource gate. Low capacity defers work; it never grants authority.
  if (env.metabolismCapacity !== undefined) {
    const metabolic = metabolismDecision(env.metabolismCapacity);
    if (!metabolic.admit) {
      return finalize(env, seq, { accepted: false, stage: 'refused-metabolic-contraction', refusals: [metabolic.reason], intentId: null }, '<contracted>');
    }
  }

  // 1. Exact-shape validation (snapshot-first; smuggling rejected). Untrusted input never flows past this.
  const shape = validateProposalShape(proposalInput);
  if (!shape.ok) {
    return finalize(env, seq, { accepted: false, stage: 'refused-shape', refusals: [shape.reason], intentId: null }, '<unvalidated>');
  }
  const proposal = shape.proposal;

  // HARD STOP 3 — patch bytes.
  const bytes = patchByteLength(proposal.newContent);
  if (bytes > LIMITS.MAX_PATCH_BYTES) {
    return finalize(env, seq, { accepted: false, stage: 'hard-stop-patch-bytes', refusals: [`hard-stop: patch ${bytes}B exceeds max ${LIMITS.MAX_PATCH_BYTES}B`], intentId: null }, proposal.targetPath);
  }

  // 2. Canonical 64-hex intent id + draft hash.
  const intentId = deriveIntentId(proposal);
  const draftHash = deriveDraftHash(proposal);
  const refuse = (stage: string, reasons: readonly string[], cv?: CouncilVerdict | null): RecursionResult =>
    finalize(env, seq, {
      accepted: false, stage, refusals: reasons, intentId,
      councilVerdict: cv ? cv.verdict : null, councilEvidenceDigest: cv ? (cv.evidenceDigest || null) : null,
    }, proposal.targetPath);

  // 3. Bind supersedes lineage (reachable ancestor, bounded depth — HARD STOP 4).
  const lineage = evaluateLineage(proposal.supersedes, (id) => ledger.knownIntentDepth(id));
  if (!lineage.ok) return refuse('refused-lineage', [lineage.reason]);

  // 4. Ground against real files.
  if (!env.knownFiles.has(proposal.targetPath)) return refuse('refused-ungrounded', ['ungrounded: target not in the known fileset']);

  // 5. Staleness.
  const st = stalenessVerdict({ createdAt: proposal.createdAt }, env.nowMs);
  if (st.state === 'stale') return refuse('refused-stale', [`stale: ${st.ageLabel}`]);

  // 6. Secret-shaped content.
  if (textHasSecret(proposal.newContent)) return refuse('refused-secret', ['secret: proposed content contains a secret shape']);

  // 7. Authority-shaped content.
  if (AUTHORITY_SHAPES.test(proposal.newContent)) return refuse('refused-authority-shaped', ['authority-shaped: proposal attempts to grant authority / live apply']);

  // 8. Containment invariant — advisory law must never grant authority.
  if (advisoryContainmentGrantsAuthority() !== false) return refuse('refused-containment', ['containment-invariant-broken']);

  // 9. Fu advisory review — REQUIRED council evidence; authorizes nothing. Missing/failed evidence fails closed.
  const cv = review(`apply ${proposal.targetPath}`, [proposal.newContent.slice(0, 160)], env.nowMs);
  if (cv.grantsAuthority !== false || cv.advisoryOnly !== true) return refuse('refused-council-containment', ['council-containment-broken'], cv);
  if (cv.verdict !== 'advisory-pass' || !cv.basisValid || cv.evidenceDigest.length === 0) {
    return refuse('refused-council-evidence', ['council: missing or failed advisory evidence'], cv);
  }

  // 10. AUMLOK owner verification (hybrid). A favorable council verdict is NOT authorization — this gate is separate.
  if (auth === undefined) return refuse('refused-owner-gate', ['owner-gate: no owner authorization (advisory review never authorizes)'], cv);

  // Replay guard — a nonce may authorize exactly once. Checked (not consumed) before verification.
  // Total: `auth` is untrusted, so extracting the nonce can never throw (a hostile getter ⇒ no nonce ⇒ the
  // owner verify below rejects the malformed authorization anyway).
  let nonce: string | undefined;
  try {
    const raw = (auth as SignedPromotionV2)?.authorization?.nonce;
    nonce = typeof raw === 'string' ? raw : undefined;
  } catch {
    nonce = undefined;
  }
  if (nonce !== undefined && ledger.nonceConsumed(nonce)) {
    return refuse('refused-replay', ['replay: authorization nonce already consumed'], cv);
  }

  const owner = verifyOwnerPromotion(auth, env.ownerRoot, { rootId: env.ownerRoot.rootId, proposalHash: intentId, draftHash }, env.nowMs);
  if (!owner.valid) return refuse('refused-owner-gate', [owner.reason], cv);
  // A valid hybrid authorization always carries a string nonce (assertSignedPromotion enforced it); this guard
  // makes the apply total and guarantees the replay nonce below is always consumed on a successful path.
  if (nonce === undefined) return refuse('refused-owner-gate', ['owner-gate: authorization missing nonce'], cv);

  // 11. Prepare the isolated sandbox effect — an in-memory Map; NEVER the live repo, no filesystem.
  const sandbox = new Map<string, string>();
  sandbox.set(proposal.targetPath, proposal.newContent);

  // 12. RECEIPT BEFORE ROW — record the receipt FIRST. If the store cannot record it (corrupt/full), the apply
  //     does NOT count: fail closed, do not consume the nonce (so a legitimate retry still works), expose no
  //     sandbox. This removes the receipt/row failure asymmetry — no acknowledged effect without a durable receipt.
  const receiptHash = ingestReceipt(env, seq, true, 'sandbox-applied', intentId, proposal.targetPath);
  if (receiptHash === null) {
    emitTrace(env, seq, 'refused', 'refused-receipt-unrecordable', intentId);
    return {
      accepted: false, stage: 'refused-receipt-unrecordable',
      refusals: ['receipt: outcome could not be recorded — apply refused, no effect, retryable'],
      intentId, councilVerdict: cv.verdict, councilEvidenceDigest: cv.evidenceDigest || null,
      sandboxApplied: false, receiptHash: null, authorityMinted: false, aumlokMode: AUMLOK_MODE,
    };
  }

  // 13. Row committed only after the receipt: consume the nonce (replay) and record the applied intent (lineage).
  ledger.consumeNonce(nonce);
  ledger.recordApplied(intentId, lineage.depth);
  emitTrace(env, seq, 'applied', 'sandbox-applied', intentId);

  return {
    accepted: true, stage: 'sandbox-applied', refusals: [], intentId,
    councilVerdict: cv.verdict, councilEvidenceDigest: cv.evidenceDigest,
    sandboxApplied: true, sandbox, receiptHash, authorityMinted: false, aumlokMode: AUMLOK_MODE,
  };
}

/** The recursion pipeline grants no authority — constant, by construction. */
export function recursionGrantsAuthority(): false {
  return false;
}
