// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The effect coordinator (#22 overnight) — the canonical crash-recoverable ORDER that composes the overnight
 * primitives into one flow. It owns the sequence and the cross-step invariants; the concrete operations are
 * INJECTED (the state machine, hermetic rehearsal, ref-isolation snapshot, projection-only settlement, and audit
 * ledger supply the real implementations at integration — here they are an interface + test double, so the flow
 * compiles and is proven without those modules landing first). Pure; performs no I/O of its own; grants no
 * authority. The one authority is the injected owner gate; the one effect is the injected git adapter.
 *
 * The order (with the invariant it protects):
 *   1. rehearse           — a policy/binding simulation (+ optional hermetic rehearsal) must satisfy the gate;
 *   2. ownerAuthorize     — a fresh owner authorization is the ONE authority (no auth ⇒ AWAITING_OWNER/REFUSED);
 *   3. prepare            — persist a durable PREPARED effect that FIXES its single candidate branch;
 *   4. snapshotBefore     — capture protected refs + tree BEFORE the effect;
 *   5. runGitEffect       — the ONE effect; begins only by consuming PREPARED; observes reality (never blind);
 *   6. verifyIsolation    — protected refs/tree must be byte-identical after ⇒ else QUARANTINED;
 *   7. settle + audit     — a COMMITTED clean success requires a durable completion ref; settlement is
 *                           projection-only; every transition is audited. No crash creates a second candidate.
 */

export type EffectRunPhase =
  | 'REHEARSAL_FAILED'
  | 'REFUSED_AT_OWNER'
  | 'QUARANTINED'
  | 'RECONCILE_REQUIRED'
  | 'COMMITTED';

export interface RehearsalGate {
  /** true iff the effect may proceed to the owner gate (policy simulation ok; hermetic passed or honestly N/A). */
  readonly proceed: boolean;
  readonly status: 'passed' | 'failed' | 'unavailable' | 'simulation-only';
}
export interface EffectObservationLite {
  readonly candidatePresent: boolean;
  readonly completionRef: string | null;
  readonly snapshotAfter: unknown;
}

/** The injected operation bundle. Each maps to one overnight primitive at integration. */
export interface EffectOps {
  rehearse(): RehearsalGate;
  ownerAuthorize(): { readonly authorized: boolean };
  prepare(): { readonly effectId: string; readonly candidateBranch: string };
  snapshotBefore(): unknown;
  /** The ONE effect — begins ONLY after a durable PREPARED is consumed; returns the observed reality. */
  runGitEffect(effectId: string): EffectObservationLite;
  verifyIsolation(before: unknown, after: unknown): { readonly intact: boolean };
  /** Projection-only settlement of the terminal outcome. Returns false to force a reconcile (unsettled). */
  settle(projection: { readonly effectId: string; readonly phase: EffectRunPhase; readonly completionRef: string | null }): { readonly ok: boolean };
  /** Content-free audit of a transition. Returns false to refuse (e.g. second-candidate / null-completion). */
  audit(effectId: string | null, toPhase: string, hasCompletionRef: boolean): { readonly ok: boolean };
}

export interface EffectRunResult {
  readonly ok: boolean;
  readonly phase: EffectRunPhase;
  readonly reasonClass: string;
  readonly effectId: string | null;
  readonly candidateBranch: string | null;
  readonly completionRef: string | null;
  readonly signed: false;
  readonly pushed: false;
  readonly touchedMain: false;
  readonly grantsAuthority: false;
}

function result(over: Partial<EffectRunResult> & Pick<EffectRunResult, 'ok' | 'phase' | 'reasonClass'>): EffectRunResult {
  return {
    effectId: null, candidateBranch: null, completionRef: null,
    signed: false, pushed: false, touchedMain: false, grantsAuthority: false, ...over,
  };
}

/**
 * Drive one effect through the canonical order. Every branch is receipted through `audit`; the ONLY path to
 * COMMITTED requires: owner-authorized → durable PREPARED consumed once → candidate present → isolation intact →
 * a durable completion reference → projection-only settlement accepted → audit accepted. Anything else halts
 * before or short of COMMITTED, and any ambiguity QUARANTINES (never a silent success).
 */
export function driveEffect(ops: EffectOps): EffectRunResult {
  // 1. rehearsal gate
  const rehearsal = ops.rehearse();
  ops.audit(null, 'REHEARSAL', rehearsal.proceed);
  if (!rehearsal.proceed) {
    return result({ ok: false, phase: 'REHEARSAL_FAILED', reasonClass: `coordinator:rehearsal-${rehearsal.status}` });
  }

  // 2. owner gate — the ONE authority
  if (!ops.ownerAuthorize().authorized) {
    ops.audit(null, 'REFUSED_AT_OWNER', false);
    return result({ ok: false, phase: 'REFUSED_AT_OWNER', reasonClass: 'coordinator:owner-refused' });
  }

  // 3. durable PREPARE — fixes the single candidate branch
  const prepared = ops.prepare();
  const { effectId, candidateBranch } = prepared;
  ops.audit(effectId, 'PREPARED', false);

  // 4. snapshot BEFORE the effect
  const before = ops.snapshotBefore();

  // 5. the ONE effect — begins by consuming PREPARED, observes reality
  const audited = ops.audit(effectId, 'EXECUTING', false);
  if (!audited.ok) {
    // the audit ledger refused (e.g. a second candidate for this effect) — never run the effect again
    return result({ ok: false, phase: 'QUARANTINED', reasonClass: 'coordinator:second-candidate-refused', effectId, candidateBranch });
  }
  const observed = ops.runGitEffect(effectId);
  ops.audit(effectId, 'OBSERVED', observed.completionRef !== null);

  // 6. isolation must be byte-identical, or quarantine
  if (!ops.verifyIsolation(before, observed.snapshotAfter).intact) {
    ops.audit(effectId, 'QUARANTINED', false);
    return result({ ok: false, phase: 'QUARANTINED', reasonClass: 'coordinator:isolation-violated', effectId, candidateBranch });
  }

  // 7. terminalize by OBSERVED reality — never blindly
  if (!observed.candidatePresent) {
    ops.audit(effectId, 'QUARANTINED', false);
    return result({ ok: false, phase: 'QUARANTINED', reasonClass: 'coordinator:candidate-absent', effectId, candidateBranch });
  }
  if (observed.completionRef === null) {
    // present but no durable completion reference — never a clean success; hand to owner reconcile
    ops.audit(effectId, 'RECONCILE_REQUIRED', false);
    return result({ ok: false, phase: 'RECONCILE_REQUIRED', reasonClass: 'coordinator:null-completion', effectId, candidateBranch });
  }

  // COMMITTED: projection-only settlement + audit must both accept
  const settled = ops.settle({ effectId, phase: 'COMMITTED', completionRef: observed.completionRef });
  if (!settled.ok) {
    ops.audit(effectId, 'RECONCILE_REQUIRED', true);
    return result({ ok: false, phase: 'RECONCILE_REQUIRED', reasonClass: 'coordinator:settlement-unaccepted', effectId, candidateBranch, completionRef: observed.completionRef });
  }
  const committedAudit = ops.audit(effectId, 'COMMITTED', true);
  if (!committedAudit.ok) {
    return result({ ok: false, phase: 'QUARANTINED', reasonClass: 'coordinator:commit-audit-refused', effectId, candidateBranch, completionRef: observed.completionRef });
  }
  return result({ ok: true, phase: 'COMMITTED', reasonClass: 'coordinator:committed', effectId, candidateBranch, completionRef: observed.completionRef });
}

/** HARD: the coordinator sequences injected ops; it signs nothing, pushes nothing, mints no authority. Constant. */
export function effectCoordinatorGrantsAuthority(): false {
  return false;
}
