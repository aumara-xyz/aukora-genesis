/**
 * Perform the narrow filesystem and socket operations that must run as one
 * provisioned launchd principal rather than as the root installer.
 *
 * Each invocation accepts one closed operation and one normalized absolute
 * path. Provisioning operations refuse uid 0. Every successful invocation
 * writes one JSON line containing public data only; failures write one JSON
 * line with a stable reason to stderr and exit nonzero.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import { provisionBrokerIdentity } from '../aukora/broker/broker.mjs'

const { O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants
const MAX_KEY_BYTES = 16 * 1024
const SOCKET_PROBE_TIMEOUT_MS = 2_000

/** Stable refusal names for the principal-owned custody helper. */
export const CUSTODY_CHILD_REFUSE = Object.freeze({
  ARGUMENTS_NOT_EXACT: 'launchd-custody-child:arguments-not-exact',
  OPERATION_UNKNOWN: 'launchd-custody-child:operation-unknown',
  PATH_NOT_ABSOLUTE: 'launchd-custody-child:path-not-absolute',
  PATH_NOT_NORMALIZED: 'launchd-custody-child:path-not-normalized',
  POSIX_IDENTITY_UNAVAILABLE: 'launchd-custody-child:posix-identity-unavailable',
  NOFOLLOW_UNAVAILABLE: 'launchd-custody-child:nofollow-unavailable',
  PROVISION_AS_ROOT: 'launchd-custody-child:provision-as-root',
  KEY_PARENT_UNSAFE: 'launchd-custody-child:key-parent-unsafe',
  KEY_STATE_UNOBSERVABLE: 'launchd-custody-child:key-state-unobservable',
  KEY_STATE_MALFORMED: 'launchd-custody-child:key-state-malformed',
  KEY_OWNER_MISMATCH: 'launchd-custody-child:key-owner-mismatch',
  KEY_MODE_UNSAFE: 'launchd-custody-child:key-mode-unsafe',
  KEY_PUBLICATION_FAILED: 'launchd-custody-child:key-publication-failed',
  KEY_CLEANUP_INDETERMINATE: 'launchd-custody-child:key-cleanup-indeterminate',
  BROKER_IDENTITY_FAILED: 'launchd-custody-child:broker-identity-failed',
  FILE_PROBE_FAILED: 'launchd-custody-child:file-probe-failed',
  SOCKET_PROBE_FAILED: 'launchd-custody-child:socket-probe-failed',
  INTERNAL_FAILURE: 'launchd-custody-child:internal-failure',
})

/** An expected helper refusal with a stable machine-readable reason. */
export class CustodyChildError extends Error {
  /**
   * @param {string} reason one of {@link CUSTODY_CHILD_REFUSE}
   * @param {string} detail non-secret diagnostic detail
   */
  constructor(reason, detail) {
    super(`${reason} — ${detail}`)
    this.name = 'CustodyChildError'
    this.reason = reason
  }
}

/**
 * Validate one exact lexical path.
 *
 * @param {unknown} value candidate path
 * @returns {string} unchanged normalized absolute path
 */
export function exactAbsolutePath(value) {
  if (typeof value !== 'string' || value === '' || !isAbsolute(value)) {
    throw new CustodyChildError(CUSTODY_CHILD_REFUSE.PATH_NOT_ABSOLUTE, 'the operation path must be absolute')
  }
  if (normalize(value) !== value) {
    throw new CustodyChildError(CUSTODY_CHILD_REFUSE.PATH_NOT_NORMALIZED, 'the operation path must be normalized')
  }
  return value
}

/** Return the effective uid or refuse when the host cannot supply one. */
function effectiveUid() {
  if (typeof process.geteuid !== 'function') {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.POSIX_IDENTITY_UNAVAILABLE,
      'the operation requires a POSIX effective uid',
    )
  }
  return process.geteuid()
}

/** Return the effective gid or refuse when the host cannot supply one. */
function effectiveGid() {
  if (typeof process.getegid !== 'function') {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.POSIX_IDENTITY_UNAVAILABLE,
      'the operation requires a POSIX effective gid',
    )
  }
  return process.getegid()
}

/** Require a platform primitive that refuses a symbolic-link leaf. */
function requireNoFollow() {
  if (!Number.isInteger(O_NOFOLLOW)) {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.NOFOLLOW_UNAVAILABLE,
      'O_NOFOLLOW is required for custody filesystem operations',
    )
  }
}

/** Refuse a provisioning operation under uid 0. */
function requireNonRootProvisioner() {
  if (effectiveUid() === 0) {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.PROVISION_AS_ROOT,
      'key material must be provisioned by its final service principal',
    )
  }
}

/** Return whether two stat results name the same filesystem object. */
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

/** Flush a directory entry change before reporting provisioning success. */
function syncDirectory(path) {
  const descriptor = openSync(path, O_RDONLY | O_NOFOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Require an owner-held exact parent directory for the issuer key. */
function validateKeyParent(keyPath) {
  let entry
  try {
    entry = lstatSync(dirname(keyPath))
  } catch {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.KEY_PARENT_UNSAFE,
      'the issuer-key parent must already exist as an exact owner-held directory',
    )
  }
  if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== effectiveUid() || (entry.mode & 0o077) !== 0) {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.KEY_PARENT_UNSAFE,
      'the issuer-key parent must already exist as an exact owner-held directory',
    )
  }
}

/** Load one exact owner-only Ed25519 private key and return only its public half. */
function loadIssuerPublicKey(keyPath) {
  let descriptor
  try {
    descriptor = openSync(keyPath, O_RDONLY | O_NOFOLLOW)
  } catch {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.KEY_STATE_UNOBSERVABLE,
      'the issuer key could not be opened without following links',
    )
  }
  try {
    const entry = fstatSync(descriptor)
    if (!entry.isFile() || entry.size < 1 || entry.size > MAX_KEY_BYTES) {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_STATE_MALFORMED, 'the issuer key is not one bounded regular file')
    }
    if (entry.uid !== effectiveUid()) {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_OWNER_MISMATCH, 'the issuer key has another owner')
    }
    if ((entry.mode & 0o077) !== 0) {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_MODE_UNSAFE, 'the issuer key must have mode 0600 or stricter')
    }
    let privateKey
    try {
      privateKey = createPrivateKey(readFileSync(descriptor, 'utf8'))
    } catch {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_STATE_MALFORMED, 'the issuer key is not a private Ed25519 key')
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_STATE_MALFORMED, 'the issuer key is not a private Ed25519 key')
    }
    return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
  } finally {
    closeSync(descriptor)
  }
}

/** Remove only the candidate inode created by this invocation. */
function removeOwnedCandidate(candidate, identity) {
  try {
    const observed = lstatSync(candidate)
    if (!observed.isFile() || !sameIdentity(observed, identity)) return false
    unlinkSync(candidate)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

/**
 * Create or load the issuer's Ed25519 key at one exact path.
 *
 * A first writer publishes a complete fsynced file through an atomic hard link.
 * Existing entries are loaded but never replaced or removed. The returned data
 * contains only the public key.
 *
 * @param {string} value normalized absolute key path
 * @returns {{rootPublicKeyPem: string}} public provisioning data
 */
export function provisionIssuerKey(value) {
  requireNonRootProvisioner()
  requireNoFollow()
  const keyPath = exactAbsolutePath(value)
  validateKeyParent(keyPath)
  try {
    return { rootPublicKeyPem: loadIssuerPublicKey(keyPath) }
  } catch (error) {
    if (!(error instanceof CustodyChildError)
      || error.reason !== CUSTODY_CHILD_REFUSE.KEY_STATE_UNOBSERVABLE) throw error
    try {
      lstatSync(keyPath)
      throw error
    } catch (entryError) {
      if (entryError === error || entryError?.code !== 'ENOENT') throw error
    }
  }

  const pair = generateKeyPairSync('ed25519')
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const candidate = join(dirname(keyPath), `.issuer-key-candidate-${process.pid}-${randomBytes(12).toString('hex')}`)
  let descriptor
  let identity = null
  try {
    descriptor = openSync(candidate, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    identity = fstatSync(descriptor)
    if (!identity.isFile() || identity.uid !== effectiveUid() || (identity.mode & 0o077) !== 0) {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_PUBLICATION_FAILED, 'the private candidate is not owner-held')
    }
    writeFileSync(descriptor, privatePem, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    try {
      linkSync(candidate, keyPath)
      syncDirectory(dirname(keyPath))
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new CustodyChildError(CUSTODY_CHILD_REFUSE.KEY_PUBLICATION_FAILED, 'the issuer key could not be published atomically')
      }
    }
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* cleanup still verifies the candidate identity */ }
    }
    if (identity !== null) {
      if (!removeOwnedCandidate(candidate, identity)) {
        throw new CustodyChildError(
          CUSTODY_CHILD_REFUSE.KEY_CLEANUP_INDETERMINATE,
          'the candidate path no longer names the file this invocation created',
        )
      }
      syncDirectory(dirname(keyPath))
    }
  }
  return { rootPublicKeyPem: loadIssuerPublicKey(keyPath) }
}

/**
 * Create or load the broker receipt identity under its service principal.
 *
 * @param {string} value normalized absolute state directory
 * @returns {{brokerPublicKeyPem: string, receiptKeyId: string}} public provisioning data
 */
export function provisionBroker(value) {
  requireNonRootProvisioner()
  requireNoFollow()
  const stateDir = exactAbsolutePath(value)
  try {
    return provisionBrokerIdentity(stateDir)
  } catch (error) {
    throw new CustodyChildError(
      CUSTODY_CHILD_REFUSE.BROKER_IDENTITY_FAILED,
      String(error?.message ?? 'the broker identity could not be provisioned'),
    )
  }
}

/**
 * Attempt one no-follow read-only open without reading file contents.
 *
 * @param {string} value normalized absolute target path
 * @returns {{opened: boolean, errno: string | null}}
 */
export function probeFileAccess(value) {
  const path = exactAbsolutePath(value)
  requireNoFollow()
  let descriptor
  try {
    descriptor = openSync(path, O_RDONLY | O_NOFOLLOW)
    return { opened: true, errno: null }
  } catch (error) {
    if (typeof error?.code !== 'string') {
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.FILE_PROBE_FAILED, 'the access attempt produced no errno')
    }
    return { opened: false, errno: error.code }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * Attempt one Unix-socket connection and wait for the handle to close.
 *
 * @param {string} value normalized absolute socket path
 * @returns {Promise<{connected: boolean, errno: string | null}>}
 */
export async function probeSocketAccess(value) {
  const path = exactAbsolutePath(value)
  return await new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let outcome = null
    const timeout = setTimeout(() => {
      outcome = { connected: false, errno: 'ETIMEDOUT' }
      socket.destroy()
    }, SOCKET_PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      outcome = { connected: true, errno: null }
      socket.destroy()
    })
    socket.once('error', (error) => {
      if (typeof error?.code !== 'string') {
        clearTimeout(timeout)
        socket.destroy()
        reject(new CustodyChildError(CUSTODY_CHILD_REFUSE.SOCKET_PROBE_FAILED, 'the connect attempt produced no errno'))
        return
      }
      outcome = { connected: false, errno: error.code }
    })
    socket.once('close', () => {
      clearTimeout(timeout)
      if (outcome === null) {
        reject(new CustodyChildError(CUSTODY_CHILD_REFUSE.SOCKET_PROBE_FAILED, 'the socket closed without an outcome'))
      } else {
        resolve(outcome)
      }
    })
  })
}

/** Dispatch one closed CLI operation. */
async function dispatch(operation, path) {
  switch (operation) {
    case 'issuer-key': return { operation, euid: effectiveUid(), egid: effectiveGid(), ...provisionIssuerKey(path) }
    case 'broker-identity': return { operation, euid: effectiveUid(), egid: effectiveGid(), ...provisionBroker(path) }
    case 'probe-file': return { operation, euid: effectiveUid(), egid: effectiveGid(), ...probeFileAccess(path) }
    case 'probe-socket': return { operation, euid: effectiveUid(), egid: effectiveGid(), ...await probeSocketAccess(path) }
    default:
      throw new CustodyChildError(CUSTODY_CHILD_REFUSE.OPERATION_UNKNOWN, `unknown operation ${JSON.stringify(operation)}`)
  }
}

/** Run the executable interface and set the process exit code. */
async function main(argv) {
  try {
    if (argv.length !== 2) {
      throw new CustodyChildError(
        CUSTODY_CHILD_REFUSE.ARGUMENTS_NOT_EXACT,
        'usage: node scripts/launchd-custody-child.mjs <issuer-key|broker-identity|probe-file|probe-socket> <absolute-path>',
      )
    }
    const result = await dispatch(argv[0], argv[1])
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
  } catch (error) {
    const reason = error instanceof CustodyChildError
      ? error.reason
      : CUSTODY_CHILD_REFUSE.INTERNAL_FAILURE
    process.stderr.write(`${JSON.stringify({ ok: false, reason, detail: String(error?.message ?? error) })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
