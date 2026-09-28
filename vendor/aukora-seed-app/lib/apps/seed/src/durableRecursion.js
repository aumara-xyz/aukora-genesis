// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Durable governed recursion (R35) — the semantic bridge to Sam 2's local durable workflow, with authority kept
 * OUT of the store.
 *
 * The split is absolute:
 *   - the KERNEL/AUMLOK gate decides — in process, outside any store: `complete` always re-runs the full canonical
 *     `runGovernedRecursion` (shape, lineage, staleness, secret, council evidence, HYBRID owner verify, replay,
 *     receipt-before-row). A persisted state can therefore never smuggle a decision: it is a PROJECTION, and any
 *     tampering (e.g. flipping `ownerVerified`) changes nothing because the gate re-verifies from scratch;
 *   - the STORE (Sam 2's local Convex, behind the injected `WorkflowStore` contract) persists projections, workflow
 *     state, evidence digests, and receipt references ONLY. It never sees the authorization object, a signature, a
 *     key, or the proposal content — states are exact-shape validated and fence-audited before every save.
 *
 * Durability laws:
 *   - IDEMPOTENT: `workflowId` = canonical hash of (intentId, draftHash, nonce); re-proposing the same work returns
 *     the existing state — a crash during advisory review restarts without duplication (the offline review is
 *     deterministic, and nothing was consumed);
 *   - AT-MOST-ONCE effect: the ledger's consume-once nonce plus the store's terminal phase make duplicate applies
 *     impossible. A crash BETWEEN the in-process apply and the store save is reconciled HONESTLY on restart: the
 *     gate's replay refusal + the consumed nonce prove the apply already happened exactly once, so the workflow
 *     terminalizes as applied-reconciled (with a fresh reconciliation receipt) instead of double-applying;
 *   - RETRYABLE vs TERMINAL: an owner-gate wait, a metabolic deferral, or an unrecordable receipt keeps the workflow
 *     `awaiting-owner` (stable reason class recorded); every other refusal terminalizes. Every terminal is receipted;
 *   - OPTIMISTIC CONCURRENCY: saves carry an expected version; a losing writer reloads and defers to the winner —
 *     two racing resumes cannot both commit.
 *
 * Pure/in-memory over injected contracts. Grants no authority.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
import { buildMemoryRecord } from '../../../packages/memory/index.js';
import { runGovernedRecursion } from './recursion.js';
import { validateProposalShape, deriveIntentId, deriveDraftHash, isHex64 } from './proposal.js';
import { mockCouncilReview } from './mockCouncil.js';
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
const STATE_KEYS = [
    'schema', 'workflowId', 'version', 'phase', 'intentId', 'draftHash', 'nonce', 'councilVerdict',
    'councilEvidenceDigest', 'stage', 'refusals', 'receiptHash', 'ownerVerified', 'createdAtIso', 'updatedAtIso',
    'advisoryOnly', 'grantsAuthority',
];
const PHASES = new Set(['awaiting-owner', 'applied', 'refused', 'cancelled']);
/**
 * Exact-shape validation that NAMES the first failing check (#87 item b: "the refusal will name itself").
 * Total; field labels are a closed content-free vocabulary — the refused value never leaves this function.
 */
export function explainWorkflowState(x) {
    const no = (field) => ({ ok: false, field });
    if (x === null || typeof x !== 'object' || Array.isArray(x))
        return no('not-an-object');
    const r = x;
    const keys = Reflect.ownKeys(r);
    if (keys.length !== STATE_KEYS.length || keys.some((k) => typeof k !== 'string' || !STATE_KEYS.includes(k)))
        return no('key-set');
    if (r.schema !== 'aukora-recursion-workflow-v1')
        return no('schema');
    if (typeof r.workflowId !== 'string' || !isHex64(r.workflowId))
        return no('workflowId');
    if (!Number.isSafeInteger(r.version) || r.version < 1)
        return no('version');
    if (typeof r.phase !== 'string' || !PHASES.has(r.phase))
        return no('phase');
    if (typeof r.intentId !== 'string' || !isHex64(r.intentId))
        return no('intentId');
    if (typeof r.draftHash !== 'string' || !isHex64(r.draftHash))
        return no('draftHash');
    if (typeof r.nonce !== 'string' || r.nonce.length === 0 || r.nonce.length > 128)
        return no('nonce');
    if (r.councilVerdict !== null && r.councilVerdict !== 'advisory-pass' && r.councilVerdict !== 'advisory-hold')
        return no('councilVerdict');
    if (r.councilEvidenceDigest !== null && (typeof r.councilEvidenceDigest !== 'string' || !isHex64(r.councilEvidenceDigest)))
        return no('councilEvidenceDigest');
    if (typeof r.stage !== 'string' || r.stage.length === 0 || r.stage.length > 64)
        return no('stage');
    const refusals = r.refusals;
    if (!Array.isArray(refusals)
        // Exact dense, index-only shape. Key count alone is insufficient: a sparse Array(1)
        // with one named property also has two keys (`length` + the named property).
        || Reflect.ownKeys(refusals).length !== refusals.length + 1
        || !Array.from(refusals.keys()).every((i) => (Object.hasOwn(refusals, i)
            && typeof refusals[i] === 'string'
            && refusals[i].length <= 256)))
        return no('refusals');
    if (r.receiptHash !== null && (typeof r.receiptHash !== 'string' || !isHex64(r.receiptHash)))
        return no('receiptHash');
    if (typeof r.ownerVerified !== 'boolean')
        return no('ownerVerified');
    if (typeof r.createdAtIso !== 'string' || typeof r.updatedAtIso !== 'string')
        return no('timestamps');
    if (r.advisoryOnly !== true || r.grantsAuthority !== false)
        return no('authority-flags');
    // Free-text fence: stage + refusals can never carry secret/authority material into the store.
    const freeText = { stage: r.stage, refusals: r.refusals };
    if (scanForbiddenKeys(freeText).length || scanForbiddenValues(freeText).length || scanForbiddenAuthorityClaims(freeText).length)
        return no('free-text-fence');
    return { ok: true, state: r };
}
/** Exact-shape validation of a persisted state. Total; a malformed or authority-claiming state is refused. */
export function validateWorkflowState(x) {
    const verdict = explainWorkflowState(x);
    return verdict.ok ? verdict.state : null;
}
/** Reference in-memory store — the contract's executable specification (Convex adapter mirrors this behavior). */
export class InMemoryWorkflowStore {
    rows = new Map();
    load(workflowId) {
        return this.rows.get(workflowId) ?? null;
    }
    save(state, expectedVersion) {
        if (validateWorkflowState(state) === null)
            return { ok: false, reason: 'refused' };
        const existing = this.rows.get(state.workflowId);
        const current = existing?.version ?? 0;
        if (current !== expectedVersion || state.version !== current + 1)
            return { ok: false, reason: 'conflict' };
        this.rows.set(state.workflowId, state);
        return { ok: true };
    }
}
/** Stages that keep the workflow waiting instead of terminalizing (deferral, not failure). */
const RETRYABLE_STAGES = new Set(['refused-owner-gate', 'refused-metabolic-contraction', 'refused-receipt-unrecordable']);
export function deriveWorkflowId(intentId, draftHash, nonce) {
    return canonicalHash({ domain: 'AUKORA-WORKFLOW/1', intentId, draftHash, nonce });
}
export class DurableRecursion {
    store;
    env;
    constructor(store, env) {
        this.store = store;
        this.env = env;
    }
    receipt(text) {
        const ing = this.env.store.ingest(buildMemoryRecord({ content: text, createdAt: this.env.nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'durable-recursion' }));
        return ing.ok ? ing.chainHash : null;
    }
    outcome(reasonClass, text, state, gate = null, ok = false) {
        return { ok, reasonClass, text, state, gate };
    }
    /**
     * Step 1 — PROPOSE. Validate + advisory review, persist `awaiting-owner`. Idempotent: an existing workflow for the
     * same (intent, draft, nonce) is returned as-is — a crash during advisory review resumes without duplication
     * because the offline review is deterministic and nothing was consumed. Pre-owner failures terminalize + receipt.
     */
    propose(proposalInput, nonce) {
        const shape = validateProposalShape(proposalInput);
        if (!shape.ok) {
            // No identity to key a workflow on — refuse without persisting (the gate would refuse identically later).
            return this.outcome('refused-shape', shape.reason, null);
        }
        const intentId = deriveIntentId(shape.proposal);
        const draftHash = deriveDraftHash(shape.proposal);
        const workflowId = deriveWorkflowId(intentId, draftHash, nonce);
        const existing = this.store.load(workflowId);
        if (existing !== null) {
            const valid = validateWorkflowState(existing);
            if (valid === null)
                return this.outcome('workflow:malformed-state', 'refused: persisted state failed exact-shape validation', null);
            return this.outcome('workflow:ok', 'resumed existing workflow (idempotent propose)', valid, null, true);
        }
        // Convergence with the real Fu boundary: an injected reviewer (e.g. reviewerFor(realCouncilOutcome)) is
        // consumed here exactly like the offline mock — advisory evidence only, never authority.
        const review = this.env.review ?? mockCouncilReview;
        const cv = review(`apply ${shape.proposal.targetPath}`, [shape.proposal.newContent.slice(0, 160)], this.env.nowMs);
        const pass = cv.verdict === 'advisory-pass' && cv.basisValid && cv.evidenceDigest.length > 0;
        const phase = pass ? 'awaiting-owner' : 'refused';
        const stage = pass ? 'awaiting-owner' : 'refused-council-evidence';
        const receiptHash = pass ? null : this.receipt(`durable-recursion refused · stage=${stage} · workflow=${workflowId.slice(0, 12)}`);
        const state = {
            schema: 'aukora-recursion-workflow-v1',
            workflowId, version: 1, phase, intentId, draftHash, nonce,
            councilVerdict: cv.verdict, councilEvidenceDigest: cv.evidenceDigest || null,
            stage, refusals: pass ? [] : ['council: missing or failed advisory evidence'],
            receiptHash, ownerVerified: false,
            createdAtIso: this.env.nowIso, updatedAtIso: this.env.nowIso,
            advisoryOnly: true, grantsAuthority: false,
        };
        const saved = this.store.save(state, 0);
        if (!saved.ok) {
            // A racing propose won — load the winner and defer (no duplication).
            const winner = this.store.load(workflowId);
            const valid = winner === null ? null : validateWorkflowState(winner);
            if (valid !== null)
                return this.outcome('workflow:ok', 'resumed concurrently-created workflow', valid, null, true);
            // #87: a validator REFUSAL is never a conflict — with no stored row, an OCC conflict is impossible here.
            // Name the exact failing field; if OUR validator passes the state the store refused, the divergence is the
            // store's own validator ('store-validator').
            if (saved.reason === 'refused') {
                const verdict = explainWorkflowState(state);
                const field = verdict.ok ? 'store-validator' : verdict.field;
                return this.outcome(`workflow:state-refused:${field}`, `refused: workflow state failed validation before persist (${field})`, null);
            }
            return this.outcome('workflow:store-conflict', 'refused: store conflict on create', null);
        }
        return this.outcome(pass ? 'workflow:ok' : stage, pass ? 'awaiting owner authorization' : 'refused at advisory review (receipted)', state, null, pass);
    }
    /**
     * Step 2 — COMPLETE. The canonical gate re-verifies EVERYTHING in process (state contents cannot authorize).
     * Terminal states no-op (duplicate effects impossible). Retryable stages keep `awaiting-owner`. A replay refusal
     * against a consumed nonce on a non-terminal workflow is the crash-between-apply-and-save signature — it is
     * reconciled honestly as applied-exactly-once, with a fresh reconciliation receipt.
     */
    complete(proposalInput, workflowId, auth) {
        const raw = this.store.load(workflowId);
        if (raw === null)
            return this.outcome('workflow:not-found', 'refused: unknown workflow', null);
        const state = validateWorkflowState(raw);
        if (state === null)
            return this.outcome('workflow:malformed-state', 'refused: persisted state failed exact-shape validation — no effects run', null);
        if (state.phase !== 'awaiting-owner') {
            return this.outcome('workflow:already-terminal', `no-op: workflow is already terminal (${state.phase}/${state.stage})`, state, null, true);
        }
        const gate = runGovernedRecursion(this.env, proposalInput, auth);
        // Crash-recovery reconciliation: replay refusal + our own consumed nonce + OUR INTENT recorded as applied on a
        // non-terminal workflow means the apply already happened exactly once and only the projection was lost. Both
        // halves of the (intent, nonce) pair must match — a different proposal that merely reuses a consumed nonce is a
        // genuine replay refusal, never a reconciliation.
        if (!gate.accepted && gate.stage === 'refused-replay'
            && this.env.ledger.nonceConsumed(state.nonce)
            && this.env.ledger.knownIntentDepth(state.intentId) !== undefined) {
            const receiptHash = this.receipt(`durable-recursion reconciled · applied-exactly-once-after-restart · workflow=${workflowId.slice(0, 12)}`);
            return this.persist(state, { phase: 'applied', stage: 'applied-reconciled-after-restart', refusals: [], receiptHash, ownerVerified: true }, gate);
        }
        if (gate.accepted) {
            return this.persist(state, { phase: 'applied', stage: gate.stage, refusals: [], receiptHash: gate.receiptHash, ownerVerified: true }, gate);
        }
        if (RETRYABLE_STAGES.has(gate.stage)) {
            // Deferral, not failure: record the attempt (the gate already receipted it) and keep waiting.
            return this.persist(state, { phase: 'awaiting-owner', stage: gate.stage, refusals: gate.refusals, receiptHash: state.receiptHash, ownerVerified: false }, gate);
        }
        return this.persist(state, { phase: 'refused', stage: gate.stage, refusals: gate.refusals, receiptHash: gate.receiptHash, ownerVerified: false }, gate);
    }
    /** CANCEL an awaiting workflow — terminal, receipted. Terminal states no-op. */
    cancel(workflowId) {
        const raw = this.store.load(workflowId);
        if (raw === null)
            return this.outcome('workflow:not-found', 'refused: unknown workflow', null);
        const state = validateWorkflowState(raw);
        if (state === null)
            return this.outcome('workflow:malformed-state', 'refused: persisted state failed exact-shape validation', null);
        if (state.phase !== 'awaiting-owner')
            return this.outcome('workflow:already-terminal', `no-op: workflow is already terminal (${state.phase})`, state, null, true);
        const receiptHash = this.receipt(`durable-recursion cancelled · workflow=${workflowId.slice(0, 12)}`);
        return this.persist(state, { phase: 'cancelled', stage: 'workflow:cancelled', refusals: ['cancelled while awaiting owner'], receiptHash, ownerVerified: false }, null);
    }
    persist(prev, patch, gate) {
        const next = { ...prev, ...patch, version: prev.version + 1, updatedAtIso: this.env.nowIso };
        const saved = this.store.save(next, prev.version);
        if (!saved.ok) {
            // A racing writer won. Defer to the stored truth — effects were at-most-once regardless (ledger law).
            const winner = this.store.load(prev.workflowId);
            const valid = winner === null ? null : validateWorkflowState(winner);
            if (valid !== null && valid.phase !== 'awaiting-owner')
                return this.outcome('workflow:already-terminal', 'no-op: a concurrent writer terminalized first', valid, gate, true);
            // #87 symmetry: a refused save on update is a validation refusal (named field), never an OCC conflict.
            if (saved.reason === 'refused') {
                const verdict = explainWorkflowState(next);
                const field = verdict.ok ? 'store-validator' : verdict.field;
                return this.outcome(`workflow:state-refused:${field}`, `refused: workflow state failed validation before persist (${field})`, valid, gate);
            }
            return this.outcome('workflow:store-conflict', 'refused: optimistic-concurrency conflict — reload and retry', valid, gate);
        }
        const ok = next.phase === 'applied' || (next.phase === 'awaiting-owner');
        return this.outcome(next.phase === 'awaiting-owner' ? next.stage : next.phase === 'applied' ? 'workflow:ok' : next.stage, `workflow ${next.phase} (${next.stage})`, next, gate, ok);
    }
}
/** HARD: the durable machine stores projections; it never stores or mints authority. Constant, by construction. */
export function durableWorkflowGrantsAuthority() {
    return false;
}
