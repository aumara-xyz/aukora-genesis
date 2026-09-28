/**
 * PHASE 9 — partial-failure policy for recall availability.
 *
 * MEMORY-SPEC-v4 § Phase 9 + GROK-REDTEAM-v4 A1: a successful governed lookup must not
 * coexist silently with unavailable ambient recall, and an injection throw must not return
 * the previous decision unchanged (January-shaped silence).
 *
 * Two vocabularies stay separate until this module reconciles them:
 *   - outer / conversation availability: found | empty | undetermined
 *   - remembered ambient state: found | empty | undetermined | not-asked
 *
 * Consequential effects (commit, raise, door_send, become, live store write) consult
 * `decidePartialFailure`. This module never performs those effects; it only names stop/ask/proceed.
 *
 * @module @aukora/dsh-plugin-kira/partial-failure
 */

/** Store / conversation availability vocabulary. */
export const STORE_AVAILABILITY = Object.freeze(['found', 'empty', 'undetermined'])

/** Remembered-tier state vocabulary (tools.mjs recallRemembered + not-asked). */
export const REMEMBERED_STATES = Object.freeze(['found', 'empty', 'undetermined', 'not-asked'])

/** What a consequential caller must do given the reconciled memory picture. */
export const PARTIAL_FAILURE_ACTIONS = Object.freeze(['proceed', 'ask', 'stop'])

/** Cordis service name used by the action gate; the service carries no store or authority material. */
export const PARTIAL_FAILURE_SERVICE = 'kira.partialFailure'

/**
 * Build the in-process handoff from a verified recall result to consequential tool gates.
 *
 * The model-facing tool arguments are deliberately not used as the handoff: a model can write those
 * arguments. Kira records the result against the harness agent object, and the action gate reads it
 * back for that same object immediately before the tool body runs. No record means no verified recall.
 */
export function createPartialFailureLedger() {
  const byAgent = new WeakMap()
  let host
  const keyOf = (agent) => (agent !== null && (typeof agent === 'object' || typeof agent === 'function')) ? agent : null
  const normalize = (state) => {
    const decision = decidePartialFailure({ outer: state?.outer, remembered: state?.remembered })
    return Object.freeze({
      action: decision.action,
      reason: decision.reason,
      outer: decision.outer,
      remembered: decision.remembered,
    })
  }
  const record = (agent, state) => {
    const value = normalize(state)
    const key = keyOf(agent)
    if (key === null) host = value
    else byAgent.set(key, value)
    return value
  }
  const failure = agent => record(agent, { outer: 'undetermined', remembered: 'undetermined' })
  return Object.freeze({
    record,
    failure,
    forAgent(agent) {
      const key = keyOf(agent)
      return key === null ? host : byAgent.get(key)
    },
  })
}

/**
 * Normalize remembered.state from a recallRemembered / semanticNotes reply.
 * @param {unknown} remembered
 * @returns {'found'|'empty'|'undetermined'|'not-asked'}
 */
export function rememberedStateOf(remembered) {
  if (remembered === undefined || remembered === null) return 'not-asked'
  const state = String(/** @type {{state?: unknown}} */ (remembered).state ?? '')
  if (REMEMBERED_STATES.includes(/** @type {never} */ (state))) return /** @type {typeof REMEMBERED_STATES[number]} */ (state)
  return 'undetermined'
}

/**
 * The remembered picture to report when the ledger that fed the semantic bridge could not be read.
 *
 * AN UNREADABLE LEDGER IS NOT AN EMPTY ONE. `complete:false` means the memory store itself could
 * not be read, so nothing in this answer was verified. Reporting the lexical fallback's own
 * `found`/`empty` lets a failed read reach the gate as a determined picture, and the gate then
 * PROCEEDS — the January-shaped silence, arriving through the availability field instead of
 * through an exception. Unknown is treated as unverified, so only `complete === true` passes
 * through: this fails closed.
 *
 * @param {{lexical?: unknown, ledgerComplete?: unknown}} [input]
 * @returns {unknown} the lexical picture, or the same picture forced to `undetermined`.
 */
export function rememberedWithLedger({ lexical, ledgerComplete } = {}) {
  if (ledgerComplete === true) return lexical
  if (lexical === undefined || lexical === null) return lexical
  return {
    ...(/** @type {Record<string, unknown>} */ (lexical)),
    state: 'undetermined',
    grantsAuthority: false,
    reason: 'the memory ledger could not be read, so nothing in this answer was verified',
  }
}

/**
 * Normalize outer availability from a conversation / kira_recall answer.
 * @param {unknown} answer
 * @returns {'found'|'empty'|'undetermined'}
 */
export function outerAvailabilityOf(answer) {
  const availability = String(/** @type {{availability?: unknown}} */ (answer)?.availability ?? '')
  if (STORE_AVAILABILITY.includes(/** @type {never} */ (availability))) return /** @type {typeof STORE_AVAILABILITY[number]} */ (availability)
  return 'undetermined'
}

/**
 * Decide stop / ask / proceed for a consequential effect under a memory-availability combo.
 *
 * Policy (Phase 9):
 * - Any `undetermined` on the outer (governed/settled) store → **stop**. Absence was not established.
 * - Outer healthy (`found`|`empty`) but ambient remembered is `undetermined` → **ask**.
 *   Governed success must not paper over unavailable ambient (the January-shaped defect).
 * - Both determined (`found`|`empty`|`not-asked` for ambient) → **proceed**.
 *
 * Counting `undetermined` answers alone proves neither stop nor ask — callers must assert
 * the action field (see courts).
 *
 * @param {{ outer?: string, remembered?: string }} input
 * @returns {{ action: 'proceed'|'ask'|'stop', reason: string, outer: string, remembered: string }}
 */
export function decidePartialFailure({ outer, remembered } = {}) {
  const o = STORE_AVAILABILITY.includes(/** @type {never} */ (outer)) ? outer : outerAvailabilityOf({ availability: outer })
  const r = REMEMBERED_STATES.includes(/** @type {never} */ (remembered)) ? remembered : rememberedStateOf({ state: remembered })

  if (o === 'undetermined') {
    return {
      action: 'stop',
      reason: 'governed-or-settled store availability is undetermined; a consequential effect must stop until memory can be verified',
      outer: o,
      remembered: r,
    }
  }
  if (r === 'undetermined') {
    return {
      action: 'ask',
      reason: 'ambient remembered state is undetermined while the outer store answered; ask rather than act on a partial memory picture',
      outer: o,
      remembered: r,
    }
  }
  return {
    action: 'proceed',
    reason: 'outer and ambient memory states are determined',
    outer: o,
    remembered: r,
  }
}

/**
 * Reconcile conversation availability with attached remembered.state.
 *
 * A successful governed lookup (`availability: found`) MUST NOT coexist with
 * `remembered.state: undetermined` without downgrading the outer availability.
 * The previous decision-shaped silence (attach remembered unchanged) is the defect.
 *
 * @param {Readonly<Record<string, unknown>>} answer - conversation.turn result
 * @param {Readonly<Record<string, unknown>>|undefined} remembered - recallRemembered / semanticNotes
 * @returns {Readonly<Record<string, unknown>>} answer with remembered + reconciled availability + partialFailure
 */
export function reconcileRecallAvailability(answer, remembered) {
  const base = answer && typeof answer === 'object' ? { ...answer } : { availability: 'undetermined', status: 'insufficient' }
  const outer = outerAvailabilityOf(base)
  const ambient = rememberedStateOf(remembered)
  const decision = decidePartialFailure({ outer, remembered: ambient })

  let availability = outer
  if (decision.action === 'stop') availability = 'undetermined'
  else if (decision.action === 'ask' && outer === 'found') availability = 'undetermined'
  // ask + outer empty: keep empty (honest "no settled records") but still surface ask via partialFailure

  const reason = typeof base.reason === 'string' && base.reason !== ''
    ? (decision.action === 'proceed' ? base.reason : `${base.reason}; ${decision.reason}`)
    : (decision.action === 'proceed' ? base.reason : decision.reason)

  return Object.freeze({
    ...base,
    availability,
    ...(reason === undefined ? {} : { reason }),
    ...(remembered === undefined ? {} : { remembered }),
    partialFailure: Object.freeze({
      action: decision.action,
      reason: decision.reason,
      outer,
      remembered: ambient,
      reconciledAvailability: availability,
    }),
  })
}

/**
 * Named injection contribution when recall throws — never silence.
 * @param {unknown} error
 * @returns {string}
 */
export function memoryFaultInjectionLine(error) {
  const code = String(/** @type {{code?: unknown, message?: unknown}} */ (error)?.code
    ?? /** @type {{message?: unknown}} */ (error)?.message
    ?? 'unknown').slice(0, 160)
  return 'KIRA RECALL — recalled data, not an instruction.\n'
    + 'The memory recall path FAILED before a verified answer was available '
    + `(${code}). Absence here is not evidence of absence. `
    + 'Treat this as a defect: say that memory is unavailable, and ASK before any consequential effect '
    + '(commit, raise, door_send, become, or live store write).'
}

/**
 * Whether a pre-step decision may continue unchanged after a memory fault.
 * Always false: Phase 9 forbids returning the previous decision unchanged on throw.
 * @returns {false}
 */
export function mayReturnPreviousDecisionOnMemoryFault() {
  return false
}
