// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The governed AUMLOK–AURA ceremony contract — ONE formalized flow:
 *
 *   unsigned challenge → local custody adapter (out-of-band owner signs) → hybrid Ed25519+ML-DSA-65 verification
 *   → AURA witnessed event/geometry → receipt/Merkle commitment → sandbox-only effect.
 *
 * `issueChallenge` produces the UNSIGNED challenge the owner must sign; the runtime never signs. `completeCeremony`
 * adds the ceremony-level gates (challenge self-consistency via a gateArgsHash linkage, an allowed inward capability,
 * a fresh epoch) and then delegates to the governed recursion (which performs the advisory council review, the real
 * hybrid owner verification, replay/lineage/secret/staleness law, the sandbox-only apply, and the receipt + trace).
 * Every terminal outcome is receipted; no path mints authority; all effects stay in the in-memory sandbox.
 *
 * Auma may inspect / recall / draft / propose / rehearse / request council review / explain — the capability law
 * ([[capabilities]]) refuses anything else, so a ceremony can never sign, authorize, expand capabilities, merge,
 * deploy, or bypass owner consent.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
import { buildMemoryRecord } from '../../../packages/memory/index.js';
import { validateProposalShape, deriveIntentId, deriveDraftHash } from './proposal.js';
import { runGovernedRecursion } from './recursion.js';
import { assertCapability } from './capabilities.js';
import { deriveGeometry } from './geometry.js';
const CEREMONY_GATE_DOMAIN = 'AUKORA-CEREMONY-GATE/1';
/** Canonical linkage over the gate args — binds the whole challenge so display/trace/receipt reference one gate. */
export function deriveGateArgsHash(args) {
    return canonicalHash({
        domain: CEREMONY_GATE_DOMAIN,
        intentId: args.intentId, draftHash: args.draftHash, epoch: args.epoch,
        nonce: args.nonce, capability: args.capability, issuedAtIso: args.issuedAtIso,
    });
}
function epochOf(env) {
    return Number.isSafeInteger(env.currentEpoch ?? 0) ? (env.currentEpoch ?? 0) : 0;
}
/**
 * PHASE 1 — issue the UNSIGNED challenge. Pure w.r.t. authority: it produces the exact thing the owner custody
 * adapter must sign, and nothing else. Refuses a malformed proposal or a forbidden/unknown capability up front.
 */
export function issueChallenge(env, proposalInput, opts = {}) {
    const shape = validateProposalShape(proposalInput);
    if (!shape.ok)
        return { ok: false, stage: 'refused-shape', reason: shape.reason };
    const capability = opts.capability ?? 'propose';
    const cap = assertCapability(capability);
    if (!cap.ok)
        return { ok: false, stage: 'refused-forbidden-capability', reason: cap.reason };
    const intentId = deriveIntentId(shape.proposal);
    const draftHash = deriveDraftHash(shape.proposal);
    const epoch = epochOf(env);
    const nonce = opts.nonce ?? `challenge-${intentId.slice(0, 12)}-${epoch}`;
    const issuedAtIso = opts.issuedAtIso ?? env.nowIso;
    const gateArgsHash = deriveGateArgsHash({ intentId, draftHash, epoch, nonce, capability: cap.capability, issuedAtIso });
    return {
        ok: true,
        challenge: {
            schema: 'aukora-ceremony-challenge-v1',
            intentId, draftHash, gateArgsHash, epoch, nonce, issuedAtIso,
            capability: cap.capability,
            advisoryOnly: true,
            grantsAuthority: false,
        },
    };
}
function readMerkleRoot(env) {
    try {
        return env.store.snapshot().merkleRootHex ?? null;
    }
    catch {
        return null;
    }
}
/** Receipt + trace a ceremony-level refusal (a terminal that never reached the governed gate). */
function ceremonyRefuse(env, challenge, stage, reason, intentId) {
    const content = `aumlok-aura-ceremony refused · stage=${stage} · intent=${intentId ?? 'n/a'} · epoch=${challenge.epoch}`;
    const ing = env.store.ingest(buildMemoryRecord({ content, createdAt: env.nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'aumlok-aura-ceremony' }));
    const receiptHash = ing.ok ? ing.chainHash : null;
    env.trace?.record({
        eventId: `cer_${env.ledger.attempts}_${stage}`,
        timestampMs: Number.isSafeInteger(env.nowMs) ? env.nowMs : 0,
        phase: 'refused', stage, receiptMode: 'witness', refusalCause: stage,
        intentPrefix: intentId ? intentId.slice(0, 12) : undefined, source: 'governedRecursion',
    });
    const geometry = deriveGeometry({ epoch: challenge.epoch, phase: stage, applied: false, lineageDepth: 0, attemptsUsed: env.ledger.attempts, intentId });
    env.geometryLog?.push(geometry);
    return {
        schema: 'aukora-ceremony-outcome-v1',
        phase: stage, completed: false, refused: true, reason,
        challenge, recursion: null, receiptHash, merkleRootHex: readMerkleRoot(env), geometry,
        advisoryOnly: true, grantsAuthority: false,
    };
}
/**
 * PHASES 2–6 — complete the ceremony. The owner custody adapter has (out-of-band) signed the challenge into `auth`.
 * Ceremony-level gates run first (challenge self-consistency, allowed capability, fresh epoch), then the governed
 * recursion performs the hybrid verification, witnesses the AURA trace, commits the receipt/Merkle, and applies to
 * the sandbox. Fail-closed everywhere; the runtime never signs.
 */
export function completeCeremony(env, proposalInput, challenge, auth) {
    const shape = validateProposalShape(proposalInput);
    if (!shape.ok)
        return ceremonyRefuse(env, challenge, 'refused-shape', shape.reason, null);
    const proposal = shape.proposal;
    const intentId = deriveIntentId(proposal);
    const draftHash = deriveDraftHash(proposal);
    // The challenge must describe THIS proposal.
    if (intentId !== challenge.intentId || draftHash !== challenge.draftHash) {
        return ceremonyRefuse(env, challenge, 'refused-challenge-mismatch', 'challenge does not match the presented proposal', intentId);
    }
    // The challenge must be self-consistent (its gateArgsHash must recompute from its own fields).
    const expectedGate = deriveGateArgsHash({
        intentId: challenge.intentId, draftHash: challenge.draftHash, epoch: challenge.epoch,
        nonce: challenge.nonce, capability: challenge.capability, issuedAtIso: challenge.issuedAtIso,
    });
    if (expectedGate !== challenge.gateArgsHash) {
        return ceremonyRefuse(env, challenge, 'refused-tampered-challenge', 'challenge gateArgsHash mismatch (tampered)', intentId);
    }
    // The capability must be an allowed inward capability.
    const cap = assertCapability(challenge.capability);
    if (!cap.ok)
        return ceremonyRefuse(env, challenge, 'refused-forbidden-capability', cap.reason, intentId);
    // The epoch must be current — a challenge from a past/other epoch is stale.
    if (challenge.epoch !== epochOf(env)) {
        return ceremonyRefuse(env, challenge, 'refused-stale-epoch', `challenge epoch ${challenge.epoch} ≠ current ${epochOf(env)}`, intentId);
    }
    // Delegate to the governed recursion — advisory council, real hybrid owner verify, sandbox-only apply, receipt+trace.
    const recursion = runGovernedRecursion(env, proposalInput, auth);
    const completed = recursion.accepted && recursion.stage === 'sandbox-applied';
    const lineageDepth = env.ledger.knownIntentDepth(intentId) ?? 0;
    const geometry = deriveGeometry({
        epoch: challenge.epoch, phase: recursion.stage, applied: completed,
        lineageDepth, attemptsUsed: env.ledger.attempts, intentId,
    });
    env.geometryLog?.push(geometry);
    return {
        schema: 'aukora-ceremony-outcome-v1',
        phase: recursion.stage,
        completed,
        refused: !completed,
        reason: completed ? 'ceremony completed — sandbox-only effect committed' : recursion.refusals.join('; ') || recursion.stage,
        challenge,
        recursion,
        receiptHash: recursion.receiptHash,
        merkleRootHex: readMerkleRoot(env),
        geometry,
        advisoryOnly: true,
        grantsAuthority: false,
    };
}
/**
 * Re-derive whether a ceremony outcome's claimed COMPLETION is backed by real evidence — a fake "completed" outcome
 * (no accepted gate, no receipt, or a minted-authority claim) is caught. This is the anti-fake-completion check:
 * completion is only real when the underlying governed gate accepted, produced a receipt, and minted no authority.
 */
export function verifyCeremony(outcome) {
    if (outcome.grantsAuthority !== false)
        return { valid: false, reason: 'outcome claims authority' };
    if (outcome.completed) {
        const r = outcome.recursion;
        if (r === null)
            return { valid: false, reason: 'completed without an underlying governed result' };
        if (!r.accepted || r.stage !== 'sandbox-applied')
            return { valid: false, reason: 'completed without an accepted sandbox apply' };
        if (r.receiptHash === null || outcome.receiptHash !== r.receiptHash)
            return { valid: false, reason: 'completed without a matching receipt' };
        if (r.authorityMinted !== false)
            return { valid: false, reason: 'completed with a minted-authority claim' };
        if (r.sandboxApplied !== true)
            return { valid: false, reason: 'completed without a sandbox effect' };
        return { valid: true };
    }
    // A refusal must not carry an accepted governed result.
    if (outcome.recursion && outcome.recursion.accepted)
        return { valid: false, reason: 'refused outcome carries an accepted result' };
    return { valid: true };
}
/** The ceremony grants no authority — constant, by construction. */
export function ceremonyGrantsAuthority() {
    return false;
}
