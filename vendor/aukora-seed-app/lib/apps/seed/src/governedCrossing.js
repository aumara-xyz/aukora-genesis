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
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
import { deriveDraftHash, patchByteLength } from './proposal.js';
import { SUPERVISED_ENVELOPE_SCHEMA, PROPOSER_BUDGETS, assessEnvelope, } from './proposerQualification.js';
import { runLocalRecursionCeremony } from './localCeremonyRunner.js';
export const PENDING_INTENT_SCHEMA = 'aukora-pending-intent-v1';
/** Recursively freeze — the translation output is immutable, so nothing can mutate a qualified envelope in flight. */
function deepFreeze(o) {
    if (o && typeof o === 'object') {
        for (const v of Object.values(o))
            deepFreeze(v);
        Object.freeze(o);
    }
    return o;
}
/**
 * The ONE immutable translation. Deterministic + total. Refuses goal/code substitution (a target the intent did not
 * declare), a non-advisory intent, and an over-budget patch up front. The draftHash is computed from the REAL bytes
 * — the intent's hints can never substitute the signed content.
 */
export function translateToEnvelope(intent, draft, opts) {
    if (!intent || intent.schema !== PENDING_INTENT_SCHEMA)
        return { ok: false, reasonClass: 'crossing:bad-intent', text: 'refused: not a pending-intent-v1' };
    if (intent.advisoryOnly !== true || intent.grantsAuthority !== false)
        return { ok: false, reasonClass: 'crossing:bad-intent', text: 'refused: intent must be advisoryOnly + grantsAuthority:false' };
    if (!draft || typeof draft.targetPath !== 'string' || typeof draft.newContent !== 'string')
        return { ok: false, reasonClass: 'crossing:bad-draft', text: 'refused: malformed draft bytes' };
    if (typeof opts?.headBefore !== 'string' || opts.headBefore.length === 0)
        return { ok: false, reasonClass: 'crossing:no-head', text: 'refused: headBefore is required (stale-head binding)' };
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
    const binding = {
        draftHash, headBefore: opts.headBefore, affectedPaths, tests,
        bindingHash: canonicalHash({ domain: 'AUKORA-CROSSING-BINDING/1', draftHash, headBefore: opts.headBefore, affectedPaths, tests }),
    };
    const envelope = {
        schema: SUPERVISED_ENVELOPE_SCHEMA,
        statedGoal: intent.goal, // advisory prose — NON-binding (never enters draftHash)
        proposal: { targetPath: draft.targetPath, newContent: draft.newContent, supersedes: draft.supersedes ?? null },
        capability: 'propose',
        declared: { planSteps: 1, hypotheses: 1, memoChars: Math.min(intent.rationale.length, PROPOSER_BUDGETS.maxMemoChars), retries: 0, spendUsd: 0 },
        provenance: `pending-intent:${intent.authoredBy}:${intent.intentId.slice(0, 12)}`,
        advisoryOnly: true,
        grantsAuthority: false,
    };
    const crossing = deepFreeze({
        schema: 'aukora-governed-crossing-v1',
        intentId: intent.intentId,
        envelope, binding,
        advisoryOnly: true, grantsAuthority: false,
    });
    return { ok: true, crossing };
}
/** Qualify a crossing through the EXISTING qualifier — structurally halts before signature (no auth is passed). */
export function qualifyCrossing(env, crossing) {
    return assessEnvelope(env, crossing.envelope);
}
/**
 * Terminate the crossing at the EXISTING governed machinery. Adds ONLY a fresh stale-head check and a qualifier
 * re-check, then delegates entirely to `runLocalRecursionCeremony` (owner-verify → rehearsal → isolated candidate
 * stage via the ONE monitor). No new authority path; the owner's signature is still the one gate.
 */
export function crossToCandidate(env, input) {
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
    const proposalInput = {
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
export function projectCrossing(crossing, cross) {
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
export function governedCrossingGrantsAuthority() {
    return false;
}
