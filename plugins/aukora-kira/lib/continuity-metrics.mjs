/**
 * Continuity metrics (MEMORY-SPEC-v4 §6) — scored apart from recall@ceiling.
 *
 * Pure helpers + stub scorer. No live agent, no store writes.
 * Wire to a real session ping harness after Phase 0 labels exist.
 *
 * Metrics:
 *   non_silence_rate, injection_attempt_rate, quiet_death_events,
 *   undetermined_to_empty_collapse, thread_continuity_at_N (UNLABELLED until Peter labels).
 */
export const THREAD_CONTINUITY_SCRIPT = Object.freeze({
  id: 'continuity-thread-stub-v1',
  turns: [
    { role: 'owner', text: 'Remember the figurine lives on the left shelf.', expectCallback: true },
    { role: 'owner', text: 'Where did I say the figurine lives?', expectCallback: true, requiredFact: 'left shelf' },
  ],
  labelStatus: 'UNLABELLED',
})

/**
 * @param {{
 *   pings?: number,
 *   replies?: number,
 *   injectionAttempts?: number,
 *   turns?: number,
 *   quietDeaths?: number,
 *   undeterminedToEmpty?: number,
 * }} observed
 */
export function scoreContinuity(observed = {}) {
  const pings = Number(observed.pings ?? 0)
  const replies = Number(observed.replies ?? 0)
  const injectionAttempts = Number(observed.injectionAttempts ?? 0)
  const turns = Number(observed.turns ?? 0)
  const quietDeaths = Number(observed.quietDeaths ?? 0)
  const undeterminedToEmpty = Number(observed.undeterminedToEmpty ?? 0)
  if (![pings, replies, injectionAttempts, turns, quietDeaths, undeterminedToEmpty].every(n => Number.isFinite(n) && n >= 0)) {
    throw new Error('kira.continuity: observed counts must be non-negative finite numbers')
  }
  if (replies > pings) throw new Error('kira.continuity: replies cannot exceed pings')
  if (injectionAttempts > turns && turns > 0) throw new Error('kira.continuity: injectionAttempts cannot exceed turns')
  return Object.freeze({
    non_silence_rate: pings === 0 ? null : replies / pings,
    injection_attempt_rate: turns === 0 ? null : injectionAttempts / turns,
    quiet_death_events: quietDeaths,
    undetermined_to_empty_collapse: undeterminedToEmpty,
    thread_continuity_at_N: Object.freeze({ status: 'UNLABELLED', scriptId: THREAD_CONTINUITY_SCRIPT.id }),
    fold_into_recall_at_ceiling: false,
  })
}

/** True when January-shaped quiet death is present (any quiet_death_events > 0). */
export function isJanuaryShaped(score) {
  return Number(score?.quiet_death_events ?? 0) > 0 || score?.non_silence_rate === 0
}

/**
 * Sync-path stub metrics for harness (PHASE1-DRAFT B / MEMORY-SPEC-v4 Phase1).
 * Surfaces wastedReserved + sync batch outcome without claiming live continuity.
 *
 * @param {{ reserved?: { wastedReserved?: number, droppedGoverned?: number, droppedAmbient?: number }, sync?: Record<string, unknown>, dropped?: { unmapped?: unknown[], belowThreshold?: number } }} answer
 */
export function syncPathMetrics(answer = {}) {
  const reserved = answer.reserved ?? {}
  const sync = answer.sync ?? {}
  const dropped = answer.dropped ?? {}
  return Object.freeze({
    wastedReserved: Number(reserved.wastedReserved ?? 0),
    droppedGoverned: Number(reserved.droppedGoverned ?? 0),
    droppedAmbient: Number(reserved.droppedAmbient ?? 0),
    droppedUnmapped: Array.isArray(dropped.unmapped) ? dropped.unmapped.length : Number(dropped.unmapped ?? 0),
    droppedBelowThreshold: Number(dropped.belowThreshold ?? 0),
    syncAdded: Number(sync.added ?? sync.indexed ?? 0),
    syncRemoved: Number(sync.removed ?? 0),
    syncError: sync.error === undefined ? null : String(sync.error),
    fold_into_recall_at_ceiling: false,
  })
}
