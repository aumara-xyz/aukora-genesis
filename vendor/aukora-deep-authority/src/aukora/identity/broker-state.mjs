/**
 * Broker-owned persistence and action admission for one active identity
 * control head.
 *
 * The persisted head is create-if-absent. Subject-bound action admission
 * re-parses it and recomputes its digest at each check so an absent, replaced,
 * revoked, or differently controlled identity cannot inherit a launch-pinned
 * delegation.
 *
 * @module @aukora/identity/broker-state
 */
import { createPublicKey } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { identityControlDigest, parseIdentityControlState } from './control.mjs'
import { readAukoraId, readDigest } from './validation.mjs'

/** Named refusals for persisted identity-control state. */
export const IDENTITY_CONTROL_STATE_REFUSE = Object.freeze({
  MALFORMED: 'broker:identity-control-state-malformed',
  CONFLICT: 'broker:identity-control-state-conflict',
})

/** Named refusals for identity-control admission at action use. */
export const IDENTITY_CONTROL_ADMIT_REFUSE = Object.freeze({
  UNBOUND: 'broker:identity-control-unbound',
  SUBJECT_MISMATCH: 'broker:identity-control-subject-mismatch',
  DIGEST_MISMATCH: 'broker:identity-control-digest-mismatch',
  REVOKED: 'broker:identity-control-revoked',
  SIGNER_MISMATCH: 'broker:identity-control-signer-mismatch',
})

const CONTROL_STATE_FILE = 'root-control.json'
const MAX_CONTROL_STATE_BYTES = 16 * 1024

/** A named refusal from persisted identity-control state. */
export class IdentityControlStateError extends Error {
  /**
   * @param {string} reason - Stable refusal from {@link IDENTITY_CONTROL_STATE_REFUSE}.
   * @param {string} detail - Observed state defect.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'IdentityControlStateError'
    this.reason = reason
  }
}

/**
 * Return the active control-head path inside one broker state directory.
 * @param {string} stateDir - broker-owned state directory.
 * @returns {string} absolute control-head path.
 */
export function identityControlStatePath(stateDir) {
  return join(stateDir, CONTROL_STATE_FILE)
}

/**
 * Translate one filesystem failure into the named malformed-state refusal.
 *
 * A failure that already carries the named refusal passes through unchanged so
 * the earliest measured fact survives.
 *
 * @param {unknown} error - caught filesystem error.
 * @returns {IdentityControlStateError} named malformed-state refusal.
 */
function malformedStateError(error) {
  if (error instanceof IdentityControlStateError) return error
  return new IdentityControlStateError(
    IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
    String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error),
  )
}

/**
 * Inspect one open descriptor and read its bounded regular-file text.
 *
 * @param {number} descriptor - open read descriptor.
 * @returns {string} decoded control-state text.
 */
function readRegularFileText(descriptor) {
  const opened = fstatSync(descriptor)
  if (!opened.isFile()) {
    throw new IdentityControlStateError(
      IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
      'control state is not a regular file',
    )
  }
  if (opened.size > MAX_CONTROL_STATE_BYTES) {
    throw new IdentityControlStateError(
      IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
      'control state is oversize',
    )
  }
  const chunks = []
  let total = 0
  while (true) {
    const remaining = MAX_CONTROL_STATE_BYTES + 1 - total
    const chunk = Buffer.allocUnsafe(Math.min(4096, remaining))
    const count = readSync(descriptor, chunk, 0, chunk.length, null)
    if (count === 0) break
    total += count
    if (total > MAX_CONTROL_STATE_BYTES) {
      throw new IdentityControlStateError(
        IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
        'control state is oversize',
      )
    }
    chunks.push(chunk.subarray(0, count))
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

/**
 * Read the state leaf bytes with a bounded, nonblocking, no-follow descriptor.
 *
 * The leaf is opened `O_NONBLOCK` so a special leaf — a FIFO or device — that
 * would otherwise wait for a peer returns immediately; the regular-file check
 * then refuses it without reading. `O_NOFOLLOW` refuses a symbolic link
 * substituted for the leaf instead of following it. The opened descriptor's
 * own size must already fit the encoded-byte ceiling, and the cumulative read
 * is capped one byte beyond it even if the file grows after the size check.
 *
 * Absence returns null. Every other open, inspect, read, or close failure is
 * the named malformed-state refusal, and a cleanup failure never masks an
 * earlier one.
 *
 * @param {string} file - control-head path.
 * @returns {string | null} decoded control-state text, or null when absent.
 */
function readControlStateText(file) {
  let descriptor
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    )
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return null
    throw malformedStateError(error)
  }
  let text
  let failure
  try {
    text = readRegularFileText(descriptor)
  } catch (error) {
    failure = malformedStateError(error)
  }
  try {
    closeSync(descriptor)
  } catch (error) {
    if (failure === undefined) failure = malformedStateError(error)
  }
  if (failure !== undefined) throw failure
  return text
}

/**
 * Read and validate the persisted active control head.
 *
 * Absence returns null. An oversize leaf, a non-regular or substituted leaf,
 * and any other open, inspect, read, or close failure are the named
 * malformed-state refusal rather than absence. Invalid JSON and structurally
 * invalid state are malformed too.
 *
 * @param {string} stateDir - broker-owned state directory.
 * @returns {Readonly<Record<string, unknown>> | null} active control state or null.
 */
export function readIdentityControlState(stateDir) {
  const text = readControlStateText(identityControlStatePath(stateDir))
  if (text === null) return null
  try {
    return parseIdentityControlState(JSON.parse(text))
  } catch (error) {
    throw new IdentityControlStateError(
      IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * Bind a new state directory to one exact active control head.
 *
 * Restarting with the identical digest succeeds. A different head never
 * replaces the persisted one through this initialization API.
 *
 * @param {string} stateDir - broker-owned state directory.
 * @param {unknown} stateInput - candidate active control state.
 * @returns {Readonly<Record<string, unknown>>} persisted control state.
 */
export function bindIdentityControlState(stateDir, stateInput) {
  let wanted
  try {
    wanted = parseIdentityControlState(stateInput)
  } catch (error) {
    throw new IdentityControlStateError(
      IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
      error instanceof Error ? error.message : String(error),
    )
  }
  const wantedDigest = identityControlDigest(wanted)
  const existing = readIdentityControlState(stateDir)
  if (existing !== null) {
    if (identityControlDigest(existing) !== wantedDigest) {
      throw new IdentityControlStateError(
        IDENTITY_CONTROL_STATE_REFUSE.CONFLICT,
        `this state directory is bound to ${identityControlDigest(existing)}`,
      )
    }
    return existing
  }
  try {
    writeFileSync(identityControlStatePath(stateDir), canonicalJSON(wanted), {
      mode: 0o600,
      flag: 'wx',
    })
  } catch (error) {
    throw new IdentityControlStateError(
      IDENTITY_CONTROL_STATE_REFUSE.CONFLICT,
      String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error),
    )
  }
  return wanted
}

/** Return the canonical raw Ed25519 public key named by one PEM value. */
function signerPublicKeyHex(value) {
  if (typeof value !== 'string') return null
  try {
    const key = createPublicKey(value)
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') return null
    if (key.export({ type: 'spki', format: 'pem' }).toString() !== value) return null
    const jwk = key.export({ format: 'jwk' })
    if (typeof jwk.x !== 'string') return null
    const bytes = Buffer.from(jwk.x, 'base64url')
    return bytes.length === 32 ? bytes.toString('hex') : null
  } catch {
    return null
  }
}

/**
 * Authenticate one action signer and launch expectation against an active
 * identity control head.
 *
 * @param {object} facts - persisted state and launch-owned expectations.
 * @param {unknown} facts.state - current persisted control state or null.
 * @param {unknown} facts.expectedSubject - subject selected by the delegation.
 * @param {unknown} facts.expectedControlDigest - control digest signed into the grant.
 * @param {unknown} facts.rootPublicKeyPem - Ed25519 action-verification key.
 * @returns {Readonly<{ok: true, state: Readonly<Record<string, unknown>>, controlDigest: string} | {ok: false, reason: string, detail: string}>} admission verdict.
 */
export function admitIdentityControl({
  state: stateInput,
  expectedSubject: expectedSubjectInput,
  expectedControlDigest: expectedControlDigestInput,
  rootPublicKeyPem,
}) {
  if (stateInput === null || stateInput === undefined) {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.UNBOUND,
      detail: 'this broker state contains no active identity control head',
    })
  }
  let state
  try {
    state = parseIdentityControlState(stateInput)
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  let expectedSubject
  try {
    expectedSubject = readAukoraId(expectedSubjectInput, 'identity control expected subject')
  } catch {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.SUBJECT_MISMATCH,
      detail: 'the expected subject is malformed',
    })
  }
  if (state.subject !== expectedSubject) {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.SUBJECT_MISMATCH,
      detail: `the active control head names ${state.subject}`,
    })
  }
  let expectedControlDigest
  try {
    expectedControlDigest = readDigest(
      expectedControlDigestInput,
      'identity control expected digest',
    )
  } catch {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.DIGEST_MISMATCH,
      detail: 'the expected control digest is malformed',
    })
  }
  const controlDigest = identityControlDigest(state)
  if (controlDigest !== expectedControlDigest) {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.DIGEST_MISMATCH,
      detail: `the active control digest is ${controlDigest}`,
    })
  }
  if (state.revoked) {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.REVOKED,
      detail: 'the active control head is terminally revoked',
    })
  }
  const signer = signerPublicKeyHex(rootPublicKeyPem)
  if (signer === null || signer !== state.publicKeys.ed25519) {
    return Object.freeze({
      ok: false,
      reason: IDENTITY_CONTROL_ADMIT_REFUSE.SIGNER_MISMATCH,
      detail: 'the action-signing key is not the active Ed25519 control key',
    })
  }
  return Object.freeze({ ok: true, state, controlDigest })
}
