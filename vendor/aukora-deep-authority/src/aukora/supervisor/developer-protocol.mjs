/**
 * Closed direct-parent protocol for the same-UID governed source guest.
 *
 * This module contains constants plus public outcome re-exports. It imports no
 * broker, issuer, filesystem, network, process, or harness implementation.
 *
 * @module @aukora/supervisor/developer-protocol
 */

/** Closed configuration schema accepted by the command-line launcher. */
export const DEVELOPER_LAUNCH_SCHEMA = 'aukora:developer-launch:v1'

/** Direct-child readiness record emitted by the governed guest. */
export const GUEST_READY_TYPE = 'aukora:guest-ready:v2'

/** Direct-parent request for one governed operation inside the real guest. */
export const GUEST_EXECUTE_TYPE = 'aukora:guest-memory-put:v1'

/** Direct-parent request for one user turn inside the parent-staged loop guest. */
export const GUEST_TURN_TYPE = 'aukora:guest-user-turn:v1'

/** Closed one-shot user-turn file accepted by the live-turn command. */
export const LIVE_TURN_SCHEMA = 'aukora:live-turn:v1'

/** Direct-child reply carrying one classified ToolRuntime result. */
export const GUEST_RESULT_TYPE = 'aukora:guest-memory-put-result:v1'

/**
 * Retain a parent-channel disconnect that can arrive before guest startup
 * yields its shutdown controller.
 * @param {{connected?: boolean, once(event: 'disconnect', listener: () => void): unknown}} channel - Direct parent IPC channel.
 * @returns {{attach(shutdown: () => void): void}} one-use shutdown attachment.
 */
export function createParentDisconnectLatch(channel) {
  let disconnected = channel.connected === false
  let delivered = false
  let shutdown
  const deliver = () => {
    if (!disconnected || delivered || shutdown === undefined) return
    delivered = true
    shutdown()
  }
  channel.once('disconnect', () => {
    disconnected = true
    deliver()
  })
  return Object.freeze({
    attach(callback) {
      if (shutdown !== undefined) throw new Error('supervisor:parent-disconnect-handler-already-attached')
      if (typeof callback !== 'function') throw new TypeError('supervisor:parent-disconnect-handler-invalid')
      shutdown = callback
      if (channel.connected === false) disconnected = true
      deliver()
    },
  })
}

export {
  SOURCE_OUTCOME_INDETERMINATE,
  SOURCE_OUTCOME_REFUSED,
  SOURCE_OUTCOME_SETTLED,
} from '../broker/public-outcome.mjs'

/**
 * Map one public execution outcome to the command's documented exit status.
 * @param {'SETTLED'|'REFUSED'|'INDETERMINATE'} outcome - Parent-derived terminal class.
 * @returns {0|2|3} the stable process exit status.
 */
export function sourceOutcomeExitCode(outcome) {
  if (outcome === 'SETTLED') return 0
  if (outcome === 'REFUSED') return 2
  if (outcome === 'INDETERMINATE') return 3
  throw new TypeError('supervisor:source-outcome-unknown')
}

/** Honest observation class of this source-only launch. */
export const DEVELOPER_OBSERVATION_CLASS = 'SAME_UID_PARENT_LAUNCH / NO_CUSTODY_CLAIM'
