// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The device-local AUMLOK APPROVE / BIND door — the P0 authority membrane, as a PURE request handler.
 *
 * PROVENANCE (WAVE 2): the composition is the donor `spatial/aumlok-approve-serve.ts` flow (aukora-symbiote, #105b)
 * — guard → challenge → owner-custody → sign+re-verify+apply — restored as the authority membrane. DOCUMENTED
 * ADAPTATION: the donor's terminal in-door signer + `dispatchSignedLiveApply` (which read a local key and wrote the
 * live tree) is REPLACED by the current law: the runtime VERIFIES and the owner signs OUT-OF-BAND. The door routes
 * the owner's hybrid-signed authorization through the ONE canonical [[candidateReferenceMonitor]] (`decide()` — fresh
 * hybrid verify + payload binding + consume-once), and the door itself performs NO effect: a favourable decision
 * AUTHORIZES the downstream isolated candidate stage ([[localCandidateStage]], terminal), it does not touch the tree.
 *
 * Hard laws this door holds:
 *   - runtime verifies; owner signing is out-of-band + locally custodied (custody is EXISTENCE-only, [[ownerCustody]]);
 *   - no key/signature/phrase enters any receipt/log — receipts carry only a reason CLASS + short hash prefixes;
 *   - fresh hybrid verification + consume-once authority are load-bearing (the monitor, not the door, decides);
 *   - Fu / AURA / health / Convex / supervisor / UI can never authorize — none is consulted on the authority path;
 *   - a failed / abandoned ceremony leaves NO effect and produces a reason-classed receipt (every terminal receipts);
 *   - the ceremony cannot modify its own gate / sacred / self-protecting paths ([[pathFence]] refuses them first);
 *   - ZERO effect before authorization: `monitor.decide()` (the only consuming step) is reached ONLY after every
 *     guard passes, so no refusal ever burns owner authority.
 *
 * Pure w.r.t. authority: it never signs and holds no key.
 */
import { buildMemoryRecord } from '../../../packages/memory/index.js';
import { evaluateApprovalGate, approvalGateReasonClass } from './approveGuard.js';
import { verifyAndConsumeChallenge } from './approveChallenge.js';
import { classifyPath, candidateAllowed, isSelfProtecting } from './pathFence.js';
import { candidatePayloadHash } from './candidateReferenceMonitor.js';
import { revealPhrase, pinPublicFingerprint, witnessVoicePresence, markReadyForSignature, validateBond, sanitizeBondForArtifact, } from './bondCeremony.js';
function h12(s) {
    return typeof s === 'string' && s.length >= 12 ? s.slice(0, 12) : 'n/a';
}
/** Content-free door receipt: reason CLASS + short hashes only. Never the phrase / signature / key. */
function receipt(env, verb, reasonClass, candidateId, payloadHash, code) {
    const content = `aumlok-approve-door ${verb} · reason=${reasonClass} · candidate=${h12(candidateId)} · payload=${h12(payloadHash)} · code=${code ?? 'n/a'}`;
    const ing = env.store.ingest(buildMemoryRecord({ content, createdAt: env.nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'aumlok-approve-door' }));
    return ing.ok ? ing.chainHash : null;
}
function refuse(env, status, reasonClass, candidateId, payloadHash, code) {
    const receiptHash = receipt(env, 'refused', reasonClass, candidateId, payloadHash, code);
    return { ok: false, status, reasonClass, authorized: false, decisionReceiptHash: null, receiptHash, decisionCode: code };
}
/**
 * Handle an owner approval gesture. Fail-closed at every membrane, zero effect before authorization, every terminal
 * receipted. Returns the reference-monitor decision (the single authorization) or a reason-classed refusal.
 */
export function handleApprove(env, req) {
    // 0) shape — a malformed request never reaches any membrane.
    const candidate = req?.candidate;
    if (!candidate || typeof candidate.candidateId !== 'string' || !Array.isArray(candidate.files)) {
        return refuse(env, 400, 'approve:malformed-request', null, null, null);
    }
    const candidateId = candidate.candidateId;
    const payloadHash = candidatePayloadHash(candidate);
    // 1) CSRF perimeter — armed, not-lockdown, loopback host, same-origin (donor guard).
    const gateInputs = {
        enabled: env.gate.enabled, advisory: env.gate.advisory,
        host: req.host, origin: req.origin, secFetchSite: req.secFetchSite,
        allowedHosts: env.gate.allowedHosts, allowedOrigins: env.gate.allowedOrigins,
    };
    const gate = evaluateApprovalGate(gateInputs);
    if (!gate.ok) {
        return refuse(env, gate.status, `approve:${approvalGateReasonClass(gateInputs)}`, candidateId, payloadHash, null);
    }
    // 2) self-protection + path fence — the ceremony can never target its own gate / sacred / self-protecting paths.
    for (const f of candidate.files) {
        if (isSelfProtecting(f.path))
            return refuse(env, 403, 'approve:self-protected-path', candidateId, payloadHash, null);
        if (!candidateAllowed(classifyPath(f.path)))
            return refuse(env, 403, 'approve:path-refused', candidateId, payloadHash, null);
    }
    // 3) owner custody — existence-only; an owner who cannot sign out-of-band on this device is not offered approval.
    if (!env.custody.custodyComplete) {
        return refuse(env, 403, `approve:${env.custody.reasonClass}`, candidateId, payloadHash, null);
    }
    // 4) challenge — single-use, short-TTL, bound to THIS payload hash. Consumed only on a correct live phrase.
    const chal = verifyAndConsumeChallenge(env.challengeStore, payloadHash, req.phrase, env.nowMs);
    if (!chal.ok) {
        return refuse(env, 403, `approve:challenge-${chal.reason}`, candidateId, payloadHash, null);
    }
    // 5) nonce binding — the owner's signed authorization must carry THIS challenge's nonce (bound to the gesture).
    let authNonce = '';
    try {
        const n = req.authorization?.authorization?.nonce;
        authNonce = typeof n === 'string' ? n : '';
    }
    catch {
        authNonce = '';
    }
    if (authNonce !== chal.nonce) {
        return refuse(env, 403, 'approve:nonce-unbound', candidateId, payloadHash, null);
    }
    // 6) THE ONE AUTHORIZATION — fresh hybrid verify + payload binding + consume-once, in the kernel monitor.
    //    Reached ONLY after every guard passed, so no refusal above ever consumed owner authority (zero-effect law).
    const decision = env.monitor.decide(candidate, req.authorization, env.nowMs, { ownerArmed: req.ownerArmed });
    if (!decision.allowed) {
        return refuse(env, 403, `approve:monitor-refused:${decision.code}`, candidateId, payloadHash, decision.code);
    }
    // 7) authorized — the door emits a completion receipt bound to the kernel receipt draft. It performs NO effect;
    //    the isolated candidate stage materializes downstream. This is the ONLY path that returns authorized:true.
    const receiptHash = receipt(env, 'authorized', 'approve:authorized', candidateId, payloadHash, decision.code);
    return {
        ok: true, status: 200, reasonClass: 'approve:authorized', authorized: true,
        decisionReceiptHash: decision.receiptDraftHash, receiptHash, decisionCode: decision.code,
    };
}
function bindRefuse(env, status, reasonClass) {
    const receiptHash = receipt(env, 'bind-refused', reasonClass, null, null, null);
    return { ok: false, status, reasonClass, artifact: null, receiptHash, grantsAuthority: false };
}
/**
 * Advance the bond ceremony one step, behind the same CSRF perimeter as approval. The bond grants NO authority; the
 * real crossing is a hybrid-verified signature at the approve door. Every terminal is receipted; a throwing/invalid
 * transition fails closed to a reason-classed refusal. Returns only the sanitized PUBLIC artifact.
 */
export function handleBind(env, req) {
    const gateInputs = {
        enabled: env.gate.enabled, advisory: env.gate.advisory,
        host: req.host, origin: req.origin, secFetchSite: req.secFetchSite,
        allowedHosts: env.gate.allowedHosts, allowedOrigins: env.gate.allowedOrigins,
    };
    const gate = evaluateApprovalGate(gateInputs);
    if (!gate.ok)
        return bindRefuse(env, gate.status, `bind:${approvalGateReasonClass(gateInputs)}`);
    let next;
    try {
        switch (req.action) {
            case 'reveal':
                next = revealPhrase(req.bond, env.nowIso);
                break;
            case 'pin':
                next = pinPublicFingerprint(req.bond, req.fingerprint ?? '', env.nowIso);
                break;
            case 'witness':
                if (!req.witness)
                    return bindRefuse(env, 400, 'bind:missing-witness');
                next = witnessVoicePresence(req.bond, req.witness, env.nowIso);
                break;
            case 'ready':
                next = markReadyForSignature(req.bond, env.nowIso);
                break;
            default: return bindRefuse(env, 400, 'bind:unknown-action');
        }
    }
    catch {
        // pin/ready/witness throw on invalid public fingerprint / not-ready / voice-is-authority — fail closed.
        return bindRefuse(env, 403, 'bind:invalid-transition');
    }
    const check = validateBond(next);
    if (!check.valid)
        return bindRefuse(env, 403, 'bind:validation-failed');
    const artifact = sanitizeBondForArtifact(next);
    const receiptHash = receipt(env, `bind-${req.action}`, `bind:${next.bondState}`, null, null, null);
    return { ok: true, status: 200, reasonClass: `bind:${next.bondState}`, artifact, receiptHash, grantsAuthority: false };
}
/** HARD: the door verifies + routes; it never signs or mints authority. Constant, by construction. */
export function approveDoorGrantsAuthority() {
    return false;
}
