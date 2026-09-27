/**
 * Installed broker entry: serve the real broker with terminal review bound.
 *
 * `aukora/broker/broker.mjs` takes its review callback from
 * `AUKORA_PARENT_REVIEW`, which reaches a parent over Node IPC. A LaunchDaemon
 * has no such parent, so that entry can only ever run the broker unreviewed.
 * This module is the installed selection: it reads the same broker environment
 * and additionally requires a terminal review route, then hands both to
 * `serveBrokerWithTerminalReview`.
 *
 * IT REFUSES TO START WITHOUT THE ROUTE. An installed broker that silently
 * degraded to unreviewed on a missing variable would be the defect this entry
 * exists to remove, so absent or malformed review configuration is a startup
 * failure rather than a fallback.
 *
 * WHAT THIS DOES NOT DO. Terminal review is the broker's review callback only.
 * Issuer authorization remains the issuer's, reached over `AUKORA_ISSUER_SOCKET`
 * exactly as before; a terminal answer here is not issuer consent and cannot
 * mint a grant. No private signing key is read by this process.
 *
 * @module launchd-broker-entry
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BROKER_REFUSE, readKiraPolicy } from '../aukora/broker/broker.mjs'
import { decodeSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import { admitIdentityControl } from '../aukora/identity/broker-state.mjs'
import { INSTALLED_ACTIVATION_STATEMENT, verifyInstalledActivation } from './launchd-activation.mjs'
import { serveBrokerWithTerminalReview } from './launchd-broker-review.mjs'

/** Stable refusals for installed broker startup. */
export const BROKER_ENTRY_REFUSE = Object.freeze({
  BROKER_ENVIRONMENT_INCOMPLETE: 'launchd-broker-entry:broker-environment-incomplete',
  REVIEW_ROUTE_REQUIRED: 'launchd-broker-entry:review-route-required',
  TERMINAL_KEY_UNREADABLE: 'launchd-broker-entry:terminal-key-unreadable',
  ACTIVATION_REQUIRED: 'launchd-broker-entry:activation-required',
  MEMORY_CONFIGURATION_INCOMPLETE: 'launchd-broker-entry:memory-configuration-incomplete',
})

/**
 * The implementation root this entry is staged in, derived from its own
 * location rather than from the environment. A root the job could name would
 * let the same environment that carries the digest also choose the bytes the
 * digest is measured against.
 */
const IMPLEMENTATION_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Read a bounded regular public control file without following its final path component. */
function readControlFile(path) {
  let descriptor
  try {
    if (!isAbsolute(path)) throw new Error('absolute control path required')
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o022) !== 0
      || (before.uid !== 0 && before.uid !== process.geteuid()) || before.size > 16 * 1024) {
      throw new Error('untrusted control file')
    }
    const bytes = Buffer.alloc(16 * 1024 + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    const after = fstatSync(descriptor)
    if (length > 16 * 1024 || length !== before.size || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error('control file changed or exceeded limit')
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
  } catch {
    throw new Error(BROKER_REFUSE.IDENTITY_CONTROL_STATE_MALFORMED)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** No memory configuration is a disabled route; a partial configuration never enables one. */
function readMemoryOptions(environment, activationDigest, rootPublicKeyPem) {
  const values = [environment.AUKORA_KIRA_RECALL_POLICY, environment.AUKORA_SUBJECT_AUTHORITY_B64,
    environment.AUKORA_ROOT_CONTROL_STATE_FILE]
  if (values.every(value => value === undefined)) return {}
  if (values.some(value => typeof value !== 'string' || value === '')) {
    throw new Error(BROKER_ENTRY_REFUSE.MEMORY_CONFIGURATION_INCOMPLETE)
  }
  let kiraRecallPolicy
  try { kiraRecallPolicy = readKiraPolicy(JSON.parse(environment.AUKORA_KIRA_RECALL_POLICY)) }
  catch { throw new Error(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID) }
  let subjectAuthority
  try { subjectAuthority = decodeSubjectAuthorityContext(environment.AUKORA_SUBJECT_AUTHORITY_B64) }
  catch { throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID) }
  if (subjectAuthority.activationDigest !== activationDigest) throw new Error(BROKER_REFUSE.ACTIVATION_MISMATCH)
  if (kiraRecallPolicy.subject !== subjectAuthority.subject) throw new Error(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
  const candidate = readControlFile(environment.AUKORA_ROOT_CONTROL_STATE_FILE)
  const control = admitIdentityControl({
    state: candidate, expectedSubject: subjectAuthority.subject,
    expectedControlDigest: subjectAuthority.activeControlDigest, rootPublicKeyPem,
  })
  if (!control.ok) throw new Error(control.reason)
  return { kiraRecallPolicy, subjectAuthority, rootControlState: control.state }
}

/**
 * Read the installed broker and terminal-review configuration from one
 * environment. Every absence refuses; nothing defaults.
 * @param {Record<string, string | undefined>} environment - process environment.
 * @returns {{ broker: Record<string, unknown>, review: Record<string, unknown> }} validated options.
 * @throws {Error} named refusal when required configuration is absent or unreadable.
 */
export function readEntryOptions(environment) {
  const {
    AUKORA_SOCKET, AUKORA_STATE_DIR, AUKORA_ROOT_PEM, AUKORA_ISSUER_SOCKET,
    AUKORA_REVIEW_SOCKET, AUKORA_REVIEW_TERMINAL_PUBLIC_KEY_FILE, AUKORA_REVIEW_SERVER_ID,
    AUKORA_SOCKET_GROUP_ACCESS, AUKORA_ACTIVATION_DIGEST, AUKORA_RENDERER_ID,
  } = environment
  if (!AUKORA_SOCKET || !AUKORA_STATE_DIR || !AUKORA_ROOT_PEM || !AUKORA_ISSUER_SOCKET) {
    throw new Error(BROKER_ENTRY_REFUSE.BROKER_ENVIRONMENT_INCOMPLETE)
  }
  if (!AUKORA_REVIEW_SOCKET || !AUKORA_REVIEW_TERMINAL_PUBLIC_KEY_FILE || !AUKORA_REVIEW_SERVER_ID) {
    throw new Error(BROKER_ENTRY_REFUSE.REVIEW_ROUTE_REQUIRED)
  }
  if (!AUKORA_ACTIVATION_DIGEST || !AUKORA_RENDERER_ID) {
    throw new Error(BROKER_ENTRY_REFUSE.ACTIVATION_REQUIRED)
  }
  let terminalPublicKeyPem
  try { terminalPublicKeyPem = readFileSync(AUKORA_REVIEW_TERMINAL_PUBLIC_KEY_FILE, 'utf8') }
  catch { throw new Error(BROKER_ENTRY_REFUSE.TERMINAL_KEY_UNREADABLE) }
  // The environment says which activation to expect; the retained statement and
  // the bytes on disk are what make it evidence. A digest that no measured
  // statement produces never reaches the broker.
  const activationDigest = verifyInstalledActivation({
    statementPath: join(IMPLEMENTATION_ROOT, INSTALLED_ACTIVATION_STATEMENT),
    implementationRoot: IMPLEMENTATION_ROOT,
    // The interpreter actually executing this entry, not one the job named.
    interpreter: process.execPath,
    expectedDigest: AUKORA_ACTIVATION_DIGEST,
  })
  return {
    broker: {
      socketPath: AUKORA_SOCKET,
      stateDir: AUKORA_STATE_DIR,
      rootPublicKeyPem: AUKORA_ROOT_PEM,
      issuerSocket: AUKORA_ISSUER_SOCKET,
      socketGroupAccess: AUKORA_SOCKET_GROUP_ACCESS === '1',
      // Verified above, not carried through. broker.mjs binds the activation
      // before every effect and refuses `broker:activation-unbound` without it.
      activationDigest,
      rendererId: AUKORA_RENDERER_ID,
      ...readMemoryOptions(environment, activationDigest, AUKORA_ROOT_PEM),
    },
    review: {
      socketPath: AUKORA_REVIEW_SOCKET,
      terminalPublicKeyPem,
      serverId: AUKORA_REVIEW_SERVER_ID,
    },
  }
}

/**
 * Serve the reviewed broker and retain it until a termination signal.
 * @param {Record<string, string | undefined>} [environment] - process environment.
 * @returns {Promise<import('../aukora/broker/broker.mjs').BrokerServer>} the running server.
 */
export async function main(environment = process.env) {
  const server = await serveBrokerWithTerminalReview(readEntryOptions(environment))
  const stop = () => {
    // Close owns this process's broker socket and review listener only. A
    // failed close leaves the ambiguity and its state residue for an operator
    // rather than unlinking a route this process may no longer own.
    void server.close().then(() => process.exit(0), () => process.exit(1))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  return server
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('launchd-broker-entry.mjs')) {
  main().catch((error) => { console.error(String(error?.message ?? error)); process.exit(1) })
}
