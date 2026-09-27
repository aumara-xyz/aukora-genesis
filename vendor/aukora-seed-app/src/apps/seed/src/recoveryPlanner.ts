// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Crash recovery planner (#22 overnight · "SIGKILL at every effect phase" + "observe before acting").
 *
 * On restart, an effect is rehydrated from durable state at whatever phase it was in when the process died. This
 * pure, EXHAUSTIVE decision table chooses the SAFE recovery action for every phase, under two hard laws:
 *   - NEVER blindly re-execute: any phase where the effect MIGHT already have run resolves to
 *     RECONCILE_BY_OBSERVATION (read reality first), never RESUME_FORWARD into a second execution;
 *   - NEVER create a second candidate: the effect-consuming step happens at most once, so a consumed/executing
 *     effect can only be reconciled, never re-begun.
 * Fail-closed: an unrecognized phase QUARANTINES. Pure; grants no authority; performs no I/O.
 *
 * Phase labels are kept in lockstep with the effect protocol's EffectPhase (not imported, so this recovery layer
 * is self-contained and does not depend on the protocol module landing first).
 */

export type RecoveryAction =
  | 'RESUME_FORWARD'            // no effect has run yet — safe to continue the governed forward path
  | 'RECONCILE_BY_OBSERVATION' // the effect may have run — observe reality, then decide (never re-execute)
  | 'TERMINAL_NOOP'            // already terminal — nothing to do
  | 'QUARANTINE';             // unknown/incoherent state — fail closed

export interface RecoveryPlan {
  readonly action: RecoveryAction;
  readonly reasonClass: string;
}

// Pre-effect phases: no candidate has been consumed, so resuming forward cannot re-execute anything.
const PRE_EFFECT: ReadonlySet<string> = new Set([
  'PROPOSED', 'QUALIFIED', 'POLICY_REHEARSAL_PASSED', 'HERMETIC_REHEARSAL_PASSED', 'AWAITING_OWNER',
]);
// Post-effect-but-not-terminal phases where the effect is done and only bookkeeping remains.
const POST_EFFECT_FORWARD: ReadonlySet<string> = new Set(['OBSERVED']);
// Terminal phases — recovery is a no-op.
const TERMINAL: ReadonlySet<string> = new Set([
  'COMMITTED', 'REFUSED', 'REHEARSAL_FAILED', 'CANCELLED_BEFORE_PREPARE', 'QUARANTINED', 'COMPENSATED',
]);
// Phases where the effect MIGHT have run and reality must be observed before any action.
const MUST_RECONCILE: ReadonlySet<string> = new Set(['EXECUTING', 'RECONCILE_REQUIRED']);

/**
 * Decide the safe recovery action for an effect rehydrated at `phaseAtCrash`. `candidateConsumed` is the durable
 * once-only PREPARED→EXECUTING marker: if a crash landed on `PREPARED` but the consume marker is already set (the
 * process died between marking-consumed and recording EXECUTING), the effect may have begun — so it must be
 * reconciled by observation, never resumed forward into a second begin.
 */
export function planRecovery(phaseAtCrash: string, candidateConsumed: boolean): RecoveryPlan {
  if (TERMINAL.has(phaseAtCrash)) return { action: 'TERMINAL_NOOP', reasonClass: 'recovery:already-terminal' };
  if (MUST_RECONCILE.has(phaseAtCrash)) return { action: 'RECONCILE_BY_OBSERVATION', reasonClass: 'recovery:effect-may-have-run' };
  if (phaseAtCrash === 'PREPARED') {
    // The durable PREPARED exists; whether the effect began depends ONLY on the consume marker.
    return candidateConsumed
      ? { action: 'RECONCILE_BY_OBSERVATION', reasonClass: 'recovery:prepared-consumed-ambiguous' }
      : { action: 'RESUME_FORWARD', reasonClass: 'recovery:prepared-not-consumed' };
  }
  if (PRE_EFFECT.has(phaseAtCrash)) {
    // No effect has run. A consume marker here would be incoherent (marker before PREPARE) → fail closed.
    return candidateConsumed
      ? { action: 'QUARANTINE', reasonClass: 'recovery:incoherent-consume-before-prepare' }
      : { action: 'RESUME_FORWARD', reasonClass: 'recovery:pre-effect' };
  }
  if (POST_EFFECT_FORWARD.has(phaseAtCrash)) {
    // The effect completed and was OBSERVED; only settle/commit remain — safe to resume forward (no re-execute).
    return { action: 'RESUME_FORWARD', reasonClass: 'recovery:post-effect-bookkeeping' };
  }
  return { action: 'QUARANTINE', reasonClass: 'recovery:unknown-phase' };
}

/** True iff, from this crash phase, resuming forward could POSSIBLY re-run the effect. The planner guarantees this
 *  is never the chosen action when true — it is the safety property the table protects. */
export function couldReExecuteOnResume(phaseAtCrash: string, candidateConsumed: boolean): boolean {
  if (MUST_RECONCILE.has(phaseAtCrash)) return true;
  if (phaseAtCrash === 'PREPARED' && candidateConsumed) return true;
  return false;
}

/** HARD: the recovery planner is a pure decision function; it runs nothing and grants no authority. Constant. */
export function recoveryPlannerGrantsAuthority(): false {
  return false;
}
