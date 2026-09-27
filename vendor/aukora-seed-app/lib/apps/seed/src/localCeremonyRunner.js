import { DurableRecursion, deriveWorkflowId } from './durableRecursion.js';
import { AumaIdeEnvelope } from './ideEnvelope.js';
import { deriveIntentId, deriveDraftHash } from './proposal.js';
import { reviewerFor } from './fuStructuredAdapter.js';
import { runLiveCandidateEffect } from './liveEffectOps.js';
import { CandidateReferenceMonitor } from './candidateReferenceMonitor.js';
import { DurableCandidateReferenceMonitor, trustedStateDirInsideFence } from './durableCandidateMonitor.js';
function result(over) {
    return {
        workflowState: null, rehearsalReceiptHash: null, candidate: null, materialization: null,
        signed: false, pushed: false, touchedMain: false, grantsAuthority: false, ...over,
    };
}
/**
 * Run one owner-invoked local recursion ceremony. Idempotent + restart-safe via the durable machine; an EFFECT
 * (candidate materialization) happens only on an explicit `materialize:true` invocation with a fresh authorization.
 */
export function runLocalRecursionCeremony(env, invocation) {
    const review = invocation.fuOutcome ? reviewerFor(invocation.fuOutcome) : env.recursionEnv.review;
    const recursionEnv = { ...env.recursionEnv, review };
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
        monitor, // the ONE canonical kernel reference monitor (durable when configured)
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
function proposalToDraftInput(proposalInput) {
    const p = proposalInput;
    return { targetPath: String(p.targetPath ?? ''), newContent: String(p.newContent ?? ''), createdAt: String(p.createdAt ?? ''), supersedes: p.supersedes ?? null, id: p.id };
}
/** Re-derive the workflow id for a proposal + nonce — for a restarted ceremony to locate its durable state. */
export function ceremonyWorkflowId(proposal, nonce) {
    return deriveWorkflowId(deriveIntentId(proposal), deriveDraftHash(proposal), nonce);
}
/** HARD: the runner composes; it never signs, pushes, merges, or mints authority. Constant, by construction. */
export function localCeremonyGrantsAuthority() {
    return false;
}
