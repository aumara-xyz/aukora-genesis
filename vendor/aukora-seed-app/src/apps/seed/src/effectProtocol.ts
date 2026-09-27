// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The crash-recoverable EFFECT PROTOCOL (#22 overnight) — the explicit lifecycle that replaces the direct
 * ceremony-to-Git path. Every phase is FIRST-CLASS and PERSISTED as a projection into Sam 2's trusted state
 * (injected `PreparedEffectStore`), so a crash at any phase is recovered by OBSERVING reality — never by blindly
 * re-executing. This module is PURE over the injected store: it performs no Git, no filesystem, no network, and
 * grants no authority. It is the spec the effectful adapter (localCandidateStage) is wired behind in a later brick.
 *
 * Four invariants are enforced structurally here:
 *   1. GIT BEGINS ONLY AFTER CONSUMING A DURABLE `PREPARED` EFFECT — the sole transition into `EXECUTING` is
 *      `beginEffect`, from `PREPARED`, and it consumes the once-only `consumedForExecution` marker.
 *   2. AFTER A CRASH IN `EXECUTING`, OBSERVE BEFORE ACTING — recovery enters through `reconcile(observation)`,
 *      never through a fresh `beginEffect`; a consumed effect can never re-execute.
 *   3. NO CLEAN SUCCESS WITH A NULL COMPLETION RECEIPT — `COMMITTED` requires a non-null `completionRef`; a commit
 *      attempt without one is refused and quarantined, never recorded as success.
 *   4. NO CRASH CREATES A SECOND CANDIDATE — the effect id and candidate branch are fixed at `PREPARED`; recovery
 *      reconciles the ONE existing candidate; it never mints another.
 */

export type EffectPhase =
  // the governed forward path
  | 'PROPOSED'
  | 'QUALIFIED'
  | 'POLICY_REHEARSAL_PASSED'
  | 'HERMETIC_REHEARSAL_PASSED'
  | 'AWAITING_OWNER'
  | 'PREPARED'
  | 'EXECUTING'
  | 'OBSERVED'
  | 'COMMITTED'
  // first-class exceptional states
  | 'REFUSED'
  | 'REHEARSAL_FAILED'
  | 'CANCELLED_BEFORE_PREPARE'
  | 'RECONCILE_REQUIRED'
  | 'QUARANTINED'
  | 'COMPENSATED';

/** Terminal phases — no further transition is legal. */
export const TERMINAL_PHASES: ReadonlySet<EffectPhase> = new Set<EffectPhase>([
  'COMMITTED', 'REFUSED', 'REHEARSAL_FAILED', 'CANCELLED_BEFORE_PREPARE', 'QUARANTINED', 'COMPENSATED',
]);

/**
 * The named events that drive the machine. Each event maps a source phase to a target phase; anything not in the
 * table is an illegal transition and is refused (fail-closed). Exceptional events are legal from many phases.
 */
export type EffectEvent =
  | 'qualify'                 // PROPOSED → QUALIFIED
  | 'policyRehearsalPass'     // QUALIFIED → POLICY_REHEARSAL_PASSED
  | 'hermeticRehearsalPass'   // POLICY_REHEARSAL_PASSED → HERMETIC_REHEARSAL_PASSED
  | 'awaitOwner'              // HERMETIC_REHEARSAL_PASSED → AWAITING_OWNER
  | 'prepare'                 // AWAITING_OWNER → PREPARED (owner-authorized; durable)
  | 'beginEffect'             // PREPARED → EXECUTING (THE ONE gate into Git; consumes PREPARED once)
  | 'observe'                 // EXECUTING → OBSERVED (the effect happened; reality read back)
  | 'commit'                  // OBSERVED → COMMITTED (requires completionRef)
  // exceptional
  | 'refuse'                  // any pre-PREPARED → REFUSED
  | 'rehearsalFail'           // QUALIFIED / POLICY_REHEARSAL_PASSED → REHEARSAL_FAILED
  | 'cancel'                  // AWAITING_OWNER (or earlier, before prepare) → CANCELLED_BEFORE_PREPARE
  | 'flagReconcile'           // EXECUTING → RECONCILE_REQUIRED (a crash/ambiguity was detected)
  | 'quarantine'              // any non-terminal → QUARANTINED
  | 'compensate';             // OBSERVED / RECONCILE_REQUIRED → COMPENSATED (a landed effect was rolled back)

/** The projection persisted into Sam 2's trusted state. PROJECTION ONLY — no authorization/signature/key/content. */
export interface PreparedEffect {
  readonly schema: 'aukora-prepared-effect-v1';
  // NAMESPACE NOTE (R53 de-dup): this is a GOVERNED-RECURSION effect id — content-addressed from
  // (intentId, draftHash, nonce); fixed for life. It is a DISTINCT keyspace from @aukora/brain's JOURNAL
  // step-effect id (`deriveEffectId(rehearsalKey, step)`, domain `AUKORA-EFFECT/1`); the two must not be
  // conflated. At runtime wiring, derive this from the canonical recursion identity (proposal.deriveIntentId
  // + deriveDraftHash + nonce) rather than minting a second scheme.
  readonly effectId: string;
  readonly phase: EffectPhase;
  readonly candidateBranch: string | null;   // fixed at PREPARED; the ONE candidate this effect may ever produce
  readonly consumedForExecution: boolean;     // the once-only PREPARED→EXECUTING marker
  readonly completionRef: string | null;      // durable completion reference; COMMITTED ⇒ non-null
  readonly grantsAuthority: false;
}

/** What OBSERVING reality after a crash reports — did the isolated candidate land, and with what completion ref? */
export interface EffectObservation {
  /** The candidate branch was found to exist in the repo (the git effect completed). */
  readonly candidatePresent: boolean;
  /** A durable completion reference was recovered for the effect (a receipt bound to the commit). */
  readonly completionRef: string | null;
  /** The primary tree / protected refs were observed unchanged (isolation held). */
  readonly isolationIntact: boolean;
}

export type ProtocolStep =
  | { readonly ok: true; readonly effect: PreparedEffect }
  | { readonly ok: false; readonly reasonClass: string; readonly text: string; readonly effect: PreparedEffect };

/** The legal forward transition table (source phase + event → target phase). Exceptional events are handled
 *  separately in `advance` because they are legal from broad phase sets. */
const FORWARD: ReadonlyMap<string, EffectPhase> = new Map<string, EffectPhase>([
  ['PROPOSED|qualify', 'QUALIFIED'],
  ['QUALIFIED|policyRehearsalPass', 'POLICY_REHEARSAL_PASSED'],
  ['POLICY_REHEARSAL_PASSED|hermeticRehearsalPass', 'HERMETIC_REHEARSAL_PASSED'],
  ['HERMETIC_REHEARSAL_PASSED|awaitOwner', 'AWAITING_OWNER'],
  ['AWAITING_OWNER|prepare', 'PREPARED'],
  ['PREPARED|beginEffect', 'EXECUTING'],
  ['EXECUTING|observe', 'OBSERVED'],
  ['OBSERVED|commit', 'COMMITTED'],
]);

const REFUSABLE_BEFORE_PREPARE: ReadonlySet<EffectPhase> = new Set<EffectPhase>([
  'PROPOSED', 'QUALIFIED', 'POLICY_REHEARSAL_PASSED', 'HERMETIC_REHEARSAL_PASSED', 'AWAITING_OWNER',
]);
const REHEARSAL_PHASES: ReadonlySet<EffectPhase> = new Set<EffectPhase>(['QUALIFIED', 'POLICY_REHEARSAL_PASSED']);

function refuse(effect: PreparedEffect, reasonClass: string, text: string): ProtocolStep {
  return { ok: false, reasonClass, text, effect };
}
function to(effect: PreparedEffect, phase: EffectPhase, patch: Partial<PreparedEffect> = {}): ProtocolStep {
  return { ok: true, effect: { ...effect, ...patch, phase } };
}

/**
 * The pure transition function. Total and fail-closed: any event not legal from the current phase is refused with
 * a stable reason class and the effect is returned UNCHANGED (the caller persists only on `ok`).
 */
export function advance(effect: PreparedEffect, event: EffectEvent): ProtocolStep {
  if (TERMINAL_PHASES.has(effect.phase)) {
    return refuse(effect, 'effect:already-terminal', `no-op: effect is already terminal (${effect.phase})`);
  }

  // ── exceptional transitions (legal from broad phase sets) ───────────────────────────────────────
  if (event === 'refuse') {
    if (!REFUSABLE_BEFORE_PREPARE.has(effect.phase)) return refuse(effect, 'effect:illegal-refuse', `refuse is not legal from ${effect.phase}`);
    return to(effect, 'REFUSED');
  }
  if (event === 'rehearsalFail') {
    if (!REHEARSAL_PHASES.has(effect.phase)) return refuse(effect, 'effect:illegal-rehearsal-fail', `rehearsalFail is not legal from ${effect.phase}`);
    return to(effect, 'REHEARSAL_FAILED');
  }
  if (event === 'cancel') {
    // Cancellation is only clean BEFORE the durable PREPARED effect exists; after prepare, use compensate.
    if (!REFUSABLE_BEFORE_PREPARE.has(effect.phase)) return refuse(effect, 'effect:illegal-cancel', `cancel is only legal before PREPARE (from ${effect.phase} use compensate)`);
    return to(effect, 'CANCELLED_BEFORE_PREPARE');
  }
  if (event === 'quarantine') {
    return to(effect, 'QUARANTINED'); // any non-terminal phase may be quarantined (ambiguous outcome)
  }
  if (event === 'flagReconcile') {
    if (effect.phase !== 'EXECUTING') return refuse(effect, 'effect:illegal-reconcile-flag', `flagReconcile is only legal from EXECUTING (was ${effect.phase})`);
    return to(effect, 'RECONCILE_REQUIRED');
  }
  if (event === 'compensate') {
    if (effect.phase !== 'OBSERVED' && effect.phase !== 'RECONCILE_REQUIRED') return refuse(effect, 'effect:illegal-compensate', `compensate is only legal from OBSERVED/RECONCILE_REQUIRED (was ${effect.phase})`);
    return to(effect, 'COMPENSATED');
  }

  // ── forward transitions ─────────────────────────────────────────────────────────────────────────
  const target = FORWARD.get(`${effect.phase}|${event}`);
  if (target === undefined) return refuse(effect, 'effect:illegal-transition', `event '${event}' is not legal from ${effect.phase}`);

  // INVARIANT 1 + 4: the ONE gate into Git. beginEffect must consume a not-yet-consumed PREPARED effect that
  // already fixed its single candidate branch; a second beginEffect can never mint a second candidate.
  if (event === 'beginEffect') {
    if (effect.consumedForExecution) return refuse(effect, 'effect:prepared-already-consumed', 'refused: this PREPARED effect was already consumed — recover via reconcile, never re-execute');
    if (effect.candidateBranch === null) return refuse(effect, 'effect:no-candidate-bound', 'refused: PREPARED effect has no bound candidate branch');
    return to(effect, 'EXECUTING', { consumedForExecution: true });
  }

  // INVARIANT 3: a clean COMMITTED success must carry a durable completion reference.
  if (event === 'commit' && effect.completionRef === null) {
    return refuse(effect, 'effect:null-completion-receipt', 'refused: COMMITTED requires a durable completion reference — quarantine instead of recording a null-receipt success');
  }

  return to(effect, target);
}

/**
 * INVARIANT 2: crash recovery. An effect found in `EXECUTING` on restart must OBSERVE reality before doing
 * anything — this is the ONLY recovery entry, and it never re-executes. Given the observation:
 *   - candidate present + completion ref + isolation intact → the effect applied exactly once → COMMITTED (reconciled);
 *   - candidate present but no completion ref, or isolation not confirmed → RECONCILE_REQUIRED (owner attention);
 *   - candidate absent → the effect never landed → QUARANTINED (never silently retried; a fresh attempt is a new
 *     governed proposal, not an implicit re-execute).
 * A non-EXECUTING/RECONCILE_REQUIRED phase is not a crash-recovery input and is refused.
 */
export function reconcile(effect: PreparedEffect, observation: EffectObservation): ProtocolStep {
  if (effect.phase !== 'EXECUTING' && effect.phase !== 'RECONCILE_REQUIRED') {
    return refuse(effect, 'effect:not-recoverable', `reconcile is only for a crashed EXECUTING/RECONCILE_REQUIRED effect (was ${effect.phase})`);
  }
  if (!observation.candidatePresent) {
    return to(effect, 'QUARANTINED'); // reality shows no candidate — do NOT re-execute; a new proposal is required
  }
  if (observation.completionRef !== null && observation.isolationIntact) {
    return to(effect, 'COMMITTED', { completionRef: observation.completionRef });
  }
  return to(effect, 'RECONCILE_REQUIRED');
}

/** A COMMITTED effect is a clean success iff it carries a durable completion reference. Constant-time predicate. */
export function isCleanSuccess(effect: PreparedEffect): boolean {
  return effect.phase === 'COMMITTED' && typeof effect.completionRef === 'string' && effect.completionRef.length > 0;
}

/** Git may begin for an effect ONLY when it is a PREPARED, not-yet-consumed effect with a bound candidate. */
export function gitMayBegin(effect: PreparedEffect): boolean {
  return effect.phase === 'PREPARED' && effect.consumedForExecution === false && effect.candidateBranch !== null;
}

// ── the durable seam (Sam 2's trusted-state contract, INJECTED — implemented against a test double here) ──────
export type EffectSaveResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'conflict' | 'refused' };

/**
 * The store contract Sam 2's trusted state implements. The protocol machine reads/writes ONLY projections through
 * it. `save` is optimistically concurrent on the expected prior phase (null = create) so two racing recoveries
 * cannot both advance a single effect — the loser reloads and defers.
 */
export interface PreparedEffectStore {
  load(effectId: string): PreparedEffect | null;
  save(effect: PreparedEffect, expectedPhase: EffectPhase | null): EffectSaveResult;
}

/** Executable specification of the store — the exact interface Sam 2's durable adapter mirrors. Test double. */
export class InMemoryPreparedEffectStore implements PreparedEffectStore {
  private readonly rows = new Map<string, PreparedEffect>();
  load(effectId: string): PreparedEffect | null {
    return this.rows.get(effectId) ?? null;
  }
  save(effect: PreparedEffect, expectedPhase: EffectPhase | null): EffectSaveResult {
    if (effect.schema !== 'aukora-prepared-effect-v1' || effect.grantsAuthority !== false) return { ok: false, reason: 'refused' };
    const current = this.rows.get(effect.effectId) ?? null;
    if ((current?.phase ?? null) !== expectedPhase) return { ok: false, reason: 'conflict' };
    this.rows.set(effect.effectId, effect);
    return { ok: true };
  }
}

/** HARD: the effect protocol persists projections and drives a state machine; it never mints authority. Constant. */
export function effectProtocolGrantsAuthority(): false {
  return false;
}
