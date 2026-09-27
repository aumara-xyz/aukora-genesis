/**
 * Broker-owned persistence for the one activation digest a broker will serve.
 *
 * The binding lives in the broker's own state directory rather than in its
 * process memory because the check that matters happens immediately before an
 * effect, and a value only held in memory cannot detect state that was
 * replaced while the process ran. Every check-at-use re-reads this file.
 *
 * Ordinary launch is create-if-absent and refuses rebinding. The offline Web
 * upgrade replaces a v1 binding only with an exact hybrid-signed transition;
 * every read verifies that transition against the retained controller.
 *
 * @module @aukora/activation/broker-state
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { readClosedDataRecord, readDigest } from '../identity/validation.mjs'
import { readIdentityControlState } from '../identity/broker-state.mjs'
import { activationDigest } from './statement.mjs'
import { UPGRADED_BINDING_DOMAIN, verifyWebUpgradeRecord } from './web-upgrade-record.mjs'

/** Domain separating the persisted binding from the statement it names. */
export const ACTIVATION_BINDING_DOMAIN = 'aukora:activation-binding:v1'

/** Named refusals for the persisted binding. */
export const ACTIVATION_STATE_REFUSE = Object.freeze({
  MALFORMED: 'broker:activation-state-malformed',
  CONFLICT: 'broker:activation-state-conflict',
})

/**
 * Named verdicts for one check-at-use admission decision.
 *
 * The activation vocabulary is defined here rather than in the broker so the
 * decision can be exercised on its own, with no socket, state directory, or
 * child process. The broker re-exports these through `BROKER_REFUSE`.
 */
export const ACTIVATION_ADMIT_REFUSE = Object.freeze({
  STATE_MALFORMED: 'broker:activation-state-malformed',
  MISMATCH: 'broker:activation-mismatch',
  STALE: 'broker:activation-stale',
  UNBOUND: 'broker:activation-unbound',
})

/**
 * Decide whether one authorization may proceed to its effect.
 *
 * Three separate facts have to agree: the activation this process was started
 * to serve, the activation its state directory still records, and the
 * activation the authorization in hand was admitted under. Any disagreement
 * refuses by its own name so the reason survives into a transcript.
 *
 * An `expected` of null is the pre-activation posture: this broker serves no
 * binding, and the decision defers rather than inventing one.
 *
 * @param {object} facts - the three activations being compared.
 * @param {string | null} facts.expected - activation this broker was started to serve.
 * @param {string | null} facts.persisted - activation its state directory records now.
 * @param {string | null | undefined} facts.presented - activation the authorization was admitted under.
 * @returns {{ok: true} | {ok: false, reason: string, detail: string}} admission verdict.
 */
export function admitActivation({ expected, persisted, presented }) {
  if (expected === null || expected === undefined) return { ok: true }
  if (persisted !== expected) {
    return {
      ok: false,
      reason: ACTIVATION_ADMIT_REFUSE.MISMATCH,
      detail: `this broker serves ${expected}; its state now names ${persisted ?? 'no activation'}`,
    }
  }
  if (presented === null || presented === undefined) {
    return { ok: false, reason: ACTIVATION_ADMIT_REFUSE.UNBOUND, detail: 'this effect names no activation' }
  }
  if (presented !== expected) {
    return { ok: false, reason: ACTIVATION_ADMIT_REFUSE.STALE, detail: 'this authorization belongs to another activation' }
  }
  return { ok: true }
}

const BINDING_FILE = 'activation.json'
const BINDING_FIELDS = Object.freeze(['activationDigest', 'domain'])
const MAX_BINDING_BYTES = 256 * 1024

/** A named refusal from the persisted activation binding. */
export class ActivationStateError extends Error {
  /**
   * @param {string} reason - Stable refusal reason from `ACTIVATION_STATE_REFUSE`.
   * @param {string} detail - Human-readable detail.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'ActivationStateError'
    this.reason = reason
  }
}

/**
 * Absolute path of the binding record inside one broker state directory.
 * @param {string} stateDir - broker-owned state directory.
 * @returns {string} the binding record path.
 */
export function activationBindingPath(stateDir) {
  return join(stateDir, BINDING_FILE)
}

/**
 * Read the persisted activation digest, or null when this state is unbound.
 *
 * An unreadable or malformed record is never treated as "unbound": absence and
 * corruption are different answers, and only absence may serve.
 *
 * @param {string} stateDir - broker-owned state directory.
 * @returns {string | null} the bound activation digest, or null when absent.
 */
export function readActivationBinding(stateDir) {
  const path = activationBindingPath(stateDir)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return null
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error))
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BINDING_BYTES) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, 'binding record is oversize')
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, error instanceof Error ? error.message : String(error))
  }
  let record
  try {
    if (parsed?.domain === UPGRADED_BINDING_DOMAIN) {
      if (canonicalJSON(parsed) !== text) throw new Error('upgraded binding is not canonical')
      const operation = verifyWebUpgradeRecord(parsed, readIdentityControlState(stateDir))
      return activationDigest(operation.nextStatement)
    }
    record = readClosedDataRecord(parsed, BINDING_FIELDS, 'activation binding')
  } catch (error) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, error instanceof Error ? error.message : String(error))
  }
  if (record.domain !== ACTIVATION_BINDING_DOMAIN) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, `expected ${ACTIVATION_BINDING_DOMAIN}`)
  }
  try {
    return readDigest(record.activationDigest, 'activation binding.activationDigest')
  } catch (error) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Bind this state directory to one activation digest, create-if-absent.
 *
 * A directory already bound to the same digest is accepted so a restart over
 * surviving state can serve the same activation. A different digest refuses.
 *
 * @param {string} stateDir - broker-owned state directory.
 * @param {unknown} digest - lowercase SHA-256 activation digest.
 * @returns {string} the bound activation digest.
 */
export function bindActivation(stateDir, digest) {
  let wanted
  try {
    wanted = readDigest(digest, 'activation digest')
  } catch (error) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.MALFORMED, error instanceof Error ? error.message : String(error))
  }
  const existing = readActivationBinding(stateDir)
  if (existing !== null) {
    if (existing !== wanted) {
      throw new ActivationStateError(
        ACTIVATION_STATE_REFUSE.CONFLICT,
        `this state directory is bound to ${existing}`,
      )
    }
    return existing
  }
  const record = canonicalJSON({ activationDigest: wanted, domain: ACTIVATION_BINDING_DOMAIN })
  try {
    writeFileSync(activationBindingPath(stateDir), record, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    throw new ActivationStateError(ACTIVATION_STATE_REFUSE.CONFLICT, String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error))
  }
  return wanted
}
