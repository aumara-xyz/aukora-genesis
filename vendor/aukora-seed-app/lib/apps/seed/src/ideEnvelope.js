// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Auma's safe inward IDE envelope (R0–R3).
 *
 *   R0  confined repo list / read / search — through an INJECTED read-only capability, with visible fence refusals.
 *   R1  integrity-checked recall with citations (over the receipt-chained memory store).
 *   R2  draft an intent + rehearse it against real files in the sandbox (lineage/attempt limits, verbatim logs).
 *   R3  stage a BRANCH CANDIDATE — only after a PASSED rehearsal — in an isolated workspace, with diff, receipts,
 *       explanation and lineage.
 *
 * R3 NEVER pushes, signs, authorizes, merges, deploys, widens its tools, or touches main. Sacred / authority /
 * secret paths fail closed (see [[pathFence]]). Every refusal has a stable reason class and quotable text. Auma may
 * reason over the whole repo, but the confined resolver never lets "see everything" bypass the authority/secret
 * fences. The runtime never signs — a rehearsal reaches the sandbox only on an out-of-band OWNER signature.
 *
 * This module has NO filesystem/network import: the real repo arrives as an injected `RepoReadCapability`, so the
 * law is pure and testable against a fake repo, and it structurally cannot touch disk itself.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
import { classifyPath, readAllowed, candidateAllowed } from './pathFence.js';
import { validateProposalShape, deriveIntentId, deriveDraftHash, LIMITS } from './proposal.js';
import { runGovernedRecursion } from './recursion.js';
const MAX_READ_BYTES = 262_144; // 256 KiB confined read ceiling
const MAX_SEARCH_HITS = 200;
const MAX_DIFF_LINES = 400;
/** A naive but honest line diff: trims common leading/trailing lines, shows the changed middle, bounded. */
function simpleDiff(path, oldText, newText) {
    if (oldText === null)
        return `--- ${path} (new file)\n${newText.split('\n').slice(0, MAX_DIFF_LINES).map((l) => `+${l}`).join('\n')}`;
    if (oldText === newText)
        return `--- ${path}\n(no change)`;
    const a = oldText.split('\n');
    const b = newText.split('\n');
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start])
        start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
    }
    const removed = a.slice(start, endA).map((l) => `-${l}`);
    const added = b.slice(start, endB).map((l) => `+${l}`);
    const body = [...removed, ...added].slice(0, MAX_DIFF_LINES);
    return `--- ${path} @@ lines ${start + 1}..${endA}\n${body.join('\n')}`;
}
export class AumaIdeEnvelope {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    // ── R0 — confined list / read / search ──────────────────────────────────────────────────────
    /** List a directory, dropping secret/invalid entries and reporting each as a visible refusal. The repo root
     *  (`''` or `.`) is listable; a secret/invalid DIR is fully refused. */
    list(dir) {
        if (dir !== '' && dir !== '.') {
            const v = classifyPath(dir);
            if (v.class === 'secret' || v.class === 'invalid')
                return { entries: [], refusals: [{ reasonClass: v.reasonClass, text: v.text, path: dir }] };
        }
        const entries = [];
        const refusals = [];
        for (const raw of this.repo.list(dir)) {
            const pv = classifyPath(raw);
            if (pv.class === 'secret' || pv.class === 'invalid')
                refusals.push({ reasonClass: pv.reasonClass, text: pv.text, path: raw });
            else
                entries.push(raw);
        }
        return { entries, refusals };
    }
    /** Read a file. Secret/invalid → fail closed (never surface key material). Content is integrity-hashed for citation. */
    read(path) {
        const v = classifyPath(path);
        if (!readAllowed(v))
            return { ok: false, refusal: { reasonClass: v.reasonClass, text: v.text, path } };
        const content = this.repo.read(path);
        if (typeof content === 'string' && content.length > MAX_READ_BYTES) {
            return { ok: false, refusal: { reasonClass: 'ide:read-too-large', text: `refused: file exceeds the ${MAX_READ_BYTES}-byte confined-read ceiling`, path } };
        }
        return { ok: true, path, content, contentHash: canonicalHash({ content }) };
    }
    /** Search readable files under `root` for a substring; returns bounded citations. Secret/invalid paths are skipped. */
    search(root, query) {
        const citations = [];
        const refusals = [];
        if (query.length === 0)
            return { citations, refusals };
        const { entries, refusals: listRefusals } = this.list(root);
        refusals.push(...listRefusals);
        for (const path of entries) {
            const r = this.read(path);
            if (!r.ok) {
                refusals.push(r.refusal);
                continue;
            }
            const lines = r.content.split('\n');
            for (let i = 0; i < lines.length && citations.length < MAX_SEARCH_HITS; i += 1) {
                if (lines[i].includes(query))
                    citations.push({ path, line: i + 1, snippet: lines[i].slice(0, 200) });
            }
            if (citations.length >= MAX_SEARCH_HITS)
                break;
        }
        return { citations, refusals };
    }
    // ── R1 — integrity-checked recall with citations ────────────────────────────────────────────
    /** Recall from the receipt-chained memory store WITH an integrity gate: hits are content-addressed and cited, and
     *  the whole chain must verify — a tampered chain yields integrityValid:false and no trusted hits. */
    recall(store, query) {
        const integrityValid = store.verifyChain().valid;
        if (!integrityValid)
            return { integrityValid: false, hits: [] };
        const hits = store.recall(query).map((h) => ({ content: h.content, recordId: h.recordId, contentHash: canonicalHash({ content: h.content }) }));
        return { integrityValid, hits };
    }
    // ── R2 — draft an intent + rehearse ─────────────────────────────────────────────────────────
    /** Draft a proposed change. The target must be CANDIDATE-able (not sacred/authority/secret) and well-shaped. */
    draft(input) {
        const v = classifyPath(input.targetPath);
        if (!candidateAllowed(v))
            return { ok: false, proposal: null, refusal: { reasonClass: v.reasonClass, text: v.text, path: input.targetPath } };
        const candidate = {
            id: input.id ?? `draft-${canonicalHash({ t: input.targetPath, c: input.newContent }).slice(0, 12)}`,
            targetPath: input.targetPath,
            newContent: input.newContent,
            createdAt: input.createdAt,
            supersedes: input.supersedes ?? null,
        };
        const shape = validateProposalShape(candidate);
        if (!shape.ok)
            return { ok: false, proposal: null, refusal: { reasonClass: 'ide:draft-shape-invalid', text: `refused: ${shape.reason}`, path: input.targetPath } };
        return { ok: true, proposal: shape.proposal, refusal: null };
    }
    /** Rehearse a draft against real files in the sandbox — the governed gate (owner-signed). Verbatim logs = refusals. */
    rehearse(env, proposal, auth) {
        return runGovernedRecursion(env, proposal, auth);
    }
    /**
     * Assemble a candidate from ALREADY-rehearsed drafts — each carrying the receipt hash of its PASSED rehearsal.
     * Unlike `stageBranchCandidate`, this does NOT re-run the governed gate (so it never double-applies or re-consumes
     * a nonce); it is used when the rehearsal already happened durably. The passed-rehearsal receipt IS the proof, and
     * a FRESH in-process AUMLOK verification still gates the actual materialization downstream.
     */
    assembleRehearsedCandidate(drafts, explanation) {
        if (drafts.length === 0)
            return { ok: false, refusal: { reasonClass: 'ide:candidate-empty', text: 'refused: a branch candidate needs at least one rehearsed draft' } };
        const workspace = new Map();
        const files = [];
        const lineage = [];
        for (const { proposal, rehearsalReceiptHash, depth } of drafts) {
            const v = classifyPath(proposal.targetPath);
            if (!candidateAllowed(v))
                return { ok: false, refusal: { reasonClass: v.reasonClass, text: v.text, path: proposal.targetPath } };
            if (typeof rehearsalReceiptHash !== 'string' || !/^[0-9a-f]{64}$/.test(rehearsalReceiptHash)) {
                return { ok: false, refusal: { reasonClass: 'ide:not-rehearsed', text: 'refused: draft lacks a valid passed-rehearsal receipt hash', path: proposal.targetPath } };
            }
            const intentId = deriveIntentId(proposal);
            const draftHash = deriveDraftHash(proposal);
            const oldText = this.repo.exists(proposal.targetPath) ? this.repo.read(proposal.targetPath) : null;
            workspace.set(proposal.targetPath, proposal.newContent);
            files.push({ path: proposal.targetPath, intentId, draftHash, diff: simpleDiff(proposal.targetPath, oldText, proposal.newContent), receiptHash: rehearsalReceiptHash });
            const d = depth ?? 0;
            if (d <= LIMITS.MAX_LINEAGE_DEPTH)
                lineage.push({ intentId, depth: d });
        }
        const candidateId = canonicalHash({ files: files.map((f) => ({ path: f.path, intentId: f.intentId, draftHash: f.draftHash })) });
        return {
            ok: true,
            candidate: {
                schema: 'aukora-branch-candidate-v1', candidateId, workspace, files,
                explanation: explanation.slice(0, 4096), lineage,
                staged: true, pushed: false, signed: false, merged: false, deployed: false, grantsAuthority: false,
            },
        };
    }
    // ── R3 — stage a branch candidate (only after a PASSED rehearsal) ────────────────────────────
    /**
     * Stage a branch candidate. Each draft must (a) target a candidate-able path and (b) have PASSED its rehearsal
     * (reached the sandbox). The result is an isolated workspace + diff + receipts + explanation + lineage. It NEVER
     * pushes, signs, authorizes, merges, deploys, or touches main — those fields are hard-false literals.
     */
    stageBranchCandidate(env, drafts, explanation) {
        if (drafts.length === 0)
            return { ok: false, refusal: { reasonClass: 'ide:candidate-empty', text: 'refused: a branch candidate needs at least one rehearsed draft' } };
        const workspace = new Map();
        const files = [];
        const lineage = [];
        for (const { proposal, auth } of drafts) {
            const v = classifyPath(proposal.targetPath);
            if (!candidateAllowed(v))
                return { ok: false, refusal: { reasonClass: v.reasonClass, text: v.text, path: proposal.targetPath } };
            const rehearsal = this.rehearse(env, proposal, auth);
            if (!rehearsal.accepted || rehearsal.stage !== 'sandbox-applied') {
                return { ok: false, refusal: { reasonClass: 'ide:not-rehearsed', text: `refused: draft did not pass rehearsal (stage=${rehearsal.stage})`, path: proposal.targetPath } };
            }
            const intentId = deriveIntentId(proposal);
            const draftHash = deriveDraftHash(proposal);
            const oldText = this.repo.exists(proposal.targetPath) ? this.repo.read(proposal.targetPath) : null;
            workspace.set(proposal.targetPath, proposal.newContent);
            files.push({ path: proposal.targetPath, intentId, draftHash, diff: simpleDiff(proposal.targetPath, oldText, proposal.newContent), receiptHash: rehearsal.receiptHash });
            const depth = env.ledger.knownIntentDepth(intentId) ?? 0;
            if (depth <= LIMITS.MAX_LINEAGE_DEPTH)
                lineage.push({ intentId, depth });
        }
        const candidateId = canonicalHash({ files: files.map((f) => ({ path: f.path, intentId: f.intentId, draftHash: f.draftHash })) });
        return {
            ok: true,
            candidate: {
                schema: 'aukora-branch-candidate-v1',
                candidateId,
                workspace,
                files,
                explanation: explanation.slice(0, 4096),
                lineage,
                staged: true,
                pushed: false,
                signed: false,
                merged: false,
                deployed: false,
                grantsAuthority: false,
            },
        };
    }
}
/** The IDE envelope grants no authority — constant, by construction. */
export function ideEnvelopeGrantsAuthority() {
    return false;
}
