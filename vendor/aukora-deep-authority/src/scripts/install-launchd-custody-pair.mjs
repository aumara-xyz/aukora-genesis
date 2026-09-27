/**
 * Provision and observe the macOS issuer/broker custody pair.
 *
 * This installer creates three service identities so active denial probes can
 * run as the future guest, but it installs only the issuer and broker daemons.
 * A successful result is therefore `PROVISIONED_DAEMON_PAIR`, never a complete
 * guest, activator, approval-renderer, or product-boundary claim.
 *
 * Usage:
 *   sudo node scripts/install-launchd-custody-pair.mjs --inputs <file.json> --apply
 *   sudo node scripts/install-launchd-custody-pair.mjs --inputs <file.json> --check
 */

import { spawnSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'
import { SUN_PATH_MAX_BYTES } from './launchd-review-transport.mjs'
import { INSTALLED_ACTIVATION_STATEMENT, verifyInstalledActivation } from './launchd-activation.mjs'
import {
  FROZEN_VERIFIER_SHA256,
  verifierGraph,
} from '../aukora/host-dsh/src/verifier-bytes.mjs'
import {
  LAUNCHD_REFUSE,
  lintJobs,
  renderJobs,
  validateInputs as validateLaunchdInputs,
  validateMemoryLaunchInputs,
  validateApprovalLaunchInputs,
} from './generate-launchd-jobs.mjs'
import { snapshotAuthorityDependencies } from './launchd-authority-dependencies.mjs'
import {
  assertNoExtendedAcl,
  assertNoExtendedAclAncestors,
  CustodyAclError,
} from './launchd-custody-acl.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = resolve(HERE, '..')
const CHILD_HELPER_SOURCE = join(HERE, 'launchd-custody-child.mjs')
const SELECTOR_PATH = join(REPO_DIR, 'aukora', 'host-dsh', 'src', 'verifier-bytes.mjs')
const MANAGED_STATE_ROOT = '/private/var/db/aukora'
const MANAGED_SOCKET_ROOT = join(MANAGED_STATE_ROOT, 'run')
const IMPLEMENTATION_PARENT = join(MANAGED_STATE_ROOT, 'implementation')
// The terminal's public key lives in a root-owned leaf, not in brokerStateDir.
// The broker reads it at startup and must never be able to replace it: a broker
// that could swap this key could manufacture its own approvals. Rotation
// therefore takes effect only when the broker job restarts.
const MANAGED_REVIEW_ROOT = join(MANAGED_STATE_ROOT, 'review')
const INSTALL_LOCK_PATH = join(MANAGED_STATE_ROOT, '.install.lock')
const LAUNCH_DAEMON_DIR = '/Library/LaunchDaemons'
const EMPTY_HOME = '/var/empty'
const NO_LOGIN_SHELL = '/usr/bin/false'
const SAFE_ENV = Object.freeze({
  HOME: '/var/empty',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
})
const COMMAND_TIMEOUT_MS = 10_000
const MAX_COMMAND_OUTPUT = 1024 * 1024
const PRIVILEGED_HOST_GIDS = new Set([0, 80])
const { O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants

/** Exact input document format. */
export const CUSTODY_PAIR_FORMAT = 'aukora:launchd-custody-pair:v2'

/** Honest result class emitted only after active cross-principal probes hold. */
export const CUSTODY_PAIR_STATUS = 'PROVISIONED_DAEMON_PAIR'

/** Stable refusal names for host provisioning and observation. */
export const CUSTODY_PAIR_REFUSE = Object.freeze({
  ARGUMENTS_NOT_EXACT: 'launchd-install:arguments-not-exact',
  INPUTS_UNREADABLE: 'launchd-install:inputs-unreadable',
  INPUTS_NOT_PLAIN: 'launchd-install:inputs-not-plain',
  FIELD_MISSING: 'launchd-install:field-missing',
  FIELD_UNKNOWN: 'launchd-install:field-unknown',
  FIELD_DUPLICATE: 'launchd-install:field-duplicate',
  FIELD_INVALID: 'launchd-install:field-invalid',
  PLATFORM_UNSUPPORTED: 'launchd-install:platform-unsupported',
  ROOT_REQUIRED: 'launchd-install:root-required',
  INVOCATION_TREE_UNTRUSTED: 'launchd-install:invocation-tree-untrusted',
  INSTALL_ACTIVE: 'launchd-install:install-active',
  INSTALL_LOCK_INDETERMINATE: 'launchd-install:install-lock-indeterminate',
  MANAGED_PATH_REQUIRED: 'launchd-install:managed-path-required',
  ID_COLLISION: 'launchd-install:id-collision',
  GROUP_CONFLICT: 'launchd-install:group-conflict',
  ACCOUNT_CONFLICT: 'launchd-install:account-conflict',
  MEMBERSHIP_CONFLICT: 'launchd-install:membership-conflict',
  HOST_OBSERVATION_FAILED: 'launchd-install:host-observation-failed',
  HOST_MUTATION_FAILED: 'launchd-install:host-mutation-failed',
  PARTIAL_STATE: 'launchd-install:partial-state',
  PATH_SYMLINK: 'launchd-install:path-symlink',
  PATH_CUSTODY_MISMATCH: 'launchd-install:path-custody-mismatch',
  ACL_UNOBSERVED: 'launchd-install:acl-unobserved',
  EXTENDED_ACL_PRESENT: 'launchd-install:extended-acl-present',
  IMPLEMENTATION_CONFLICT: 'launchd-install:implementation-conflict',
  IMPLEMENTATION_PUBLICATION_FAILED: 'launchd-install:implementation-publication-failed',
  PRINCIPAL_HELPER_FAILED: 'launchd-install:principal-helper-failed',
  PRINCIPAL_HELPER_MISMATCH: 'launchd-install:principal-helper-mismatch',
  PRINCIPAL_PROCESS_CONFLICT: 'launchd-install:principal-process-conflict',
  JOB_DEFINITION_CONFLICT: 'launchd-install:job-definition-conflict',
  JOB_PUBLICATION_FAILED: 'launchd-install:job-publication-failed',
  BOOTSTRAP_FAILED: 'launchd-install:bootstrap-failed',
  JOB_PRINCIPAL_MISMATCH: 'launchd-install:job-principal-mismatch',
  ROUTE_UNOBSERVED: 'launchd-install:route-unobserved',
  POSITIVE_CONTROL_FAILED: 'launchd-install:positive-control-failed',
  GUEST_REACHED_ISSUER: 'launchd-install:guest-reached-issuer',
  GUEST_REACHED_SECRET: 'launchd-install:guest-reached-secret',
  RUNTIME_BYTES_MISMATCH: 'launchd-install:runtime-bytes-mismatch',
  RUNTIME_CHANGED: 'launchd-install:runtime-changed',
})

/** A named, machine-readable installation refusal. */
export class CustodyPairError extends Error {
  /**
   * @param {string} reason one of {@link CUSTODY_PAIR_REFUSE}
   * @param {string} detail non-secret diagnostic detail
   */
  constructor(reason, detail) {
    super(`${reason} — ${detail}`)
    this.name = 'CustodyPairError'
    this.reason = reason
  }
}

const STRING_FIELDS = Object.freeze([
  'format',
  'brokerLabel',
  'brokerUser',
  'brokerGroup',
  'brokerSocket',
  'brokerStateDir',
  'issuerLabel',
  'issuerUser',
  'issuerGroup',
  'issuerSocket',
  'issuerStateDir',
  'issuerKeyFile',
  'guestUser',
  'implementationRoot',
  'nodeBin',
  'nodeSha256',
  'launchDaemonDir',
  'reviewSocket',
  'reviewTerminalPublicKeyFile',
  'reviewServerId',
  'activationStatementFile',
  'activationDigest',
  'rendererId',
])
const INTEGER_FIELDS = Object.freeze([
  'brokerUid',
  'brokerGid',
  'issuerUid',
  'issuerGid',
  'guestUid',
])
const MEMORY_FIELDS = Object.freeze(['kiraRecallPolicy', 'subjectAuthority', 'rootControlStateFile'])
const APPROVAL_FIELDS = Object.freeze(['issuerApprovalSocket', 'issuerApprovalSocketUid'])
const PLAN_FIELDS = Object.freeze([...STRING_FIELDS, ...INTEGER_FIELDS])
const PATH_FIELDS = Object.freeze([
  'brokerSocket',
  'brokerStateDir',
  'issuerSocket',
  'issuerStateDir',
  'issuerKeyFile',
  'reviewSocket',
  'reviewTerminalPublicKeyFile',
  'activationStatementFile',
  'implementationRoot',
  'nodeBin',
  'launchDaemonDir',
])
const SAFE_SERVICE_NAME = /^_[a-z][a-z0-9_]{0,30}$/u
const SAFE_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,126}[A-Za-z0-9])?$/u

/** Return whether `candidate` is inside `root` after lexical normalization. */
function isInside(candidate, root) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Snapshot one plain exact-key JSON object without invoking accessors. */
function snapshotPlan(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INPUTS_NOT_PLAIN, 'inputs must be one plain object')
  }
  const prototype = Object.getPrototypeOf(raw)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INPUTS_NOT_PLAIN, 'inputs must have a plain-object prototype')
  }
  const keys = Reflect.ownKeys(raw)
  for (const key of keys) {
    if (typeof key !== 'string' || (!PLAN_FIELDS.includes(key) && !MEMORY_FIELDS.includes(key) && !APPROVAL_FIELDS.includes(key))) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_UNKNOWN, `inputs contains unknown field ${String(key)}`)
    }
  }
  for (const field of PLAN_FIELDS) {
    if (!keys.includes(field)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_MISSING, `inputs.${field} is required`)
    }
  }

  const out = Object.create(null)
  for (const field of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, field)
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INPUTS_NOT_PLAIN, `inputs.${field} must be an enumerable data property`)
    }
    out[field] = descriptor.value
  }
  return out
}

/**
 * Parse one closed custody-pair plan.
 *
 * @param {unknown} raw candidate JSON value
 * @param {string} [repoDir] checkout path that installed state must not occupy
 * @returns {Readonly<Record<string, string | number>>} validated frozen plan
 */
export function validateCustodyPairPlan(raw, repoDir = REPO_DIR) {
  const plan = snapshotPlan(raw)
  let memory
  let approval
  try {
    memory = validateMemoryLaunchInputs(plan)
    approval = validateApprovalLaunchInputs(plan)
  } catch (error) {
    throw new CustodyPairError(
      error?.reason === LAUNCHD_REFUSE.FIELD_MISSING ? CUSTODY_PAIR_REFUSE.FIELD_MISSING : CUSTODY_PAIR_REFUSE.FIELD_INVALID,
      String(error?.message ?? error),
    )
  }
  for (const field of STRING_FIELDS) {
    if (typeof plan[field] !== 'string' || plan[field] === '') {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} must be a non-empty string`)
    }
  }
  for (const field of INTEGER_FIELDS) {
    if (!Number.isSafeInteger(plan[field]) || plan[field] < 500) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} must be an integer at least 500`)
    }
  }
  if (plan.format !== CUSTODY_PAIR_FORMAT) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.format must equal ${CUSTODY_PAIR_FORMAT}`)
  }
  if (!/^[0-9a-f]{64}$/u.test(plan.nodeSha256)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, 'inputs.nodeSha256 must be a lowercase SHA-256 digest')
  }
  for (const field of ['brokerUser', 'issuerUser', 'guestUser', 'brokerGroup', 'issuerGroup']) {
    if (!SAFE_SERVICE_NAME.test(plan[field])) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} is not a safe local service name`)
    }
  }
  for (const field of ['brokerLabel', 'issuerLabel']) {
    if (!SAFE_LABEL.test(plan[field]) || plan[field].includes('..')) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} is not a safe launchd label`)
    }
  }
  if (new Set([plan.brokerUser, plan.issuerUser, plan.guestUser]).size !== 3
    || new Set([plan.brokerUid, plan.issuerUid, plan.guestUid]).size !== 3) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, 'broker, issuer, and guest identities must be distinct')
  }
  if (approval.issuerApprovalSocket !== undefined) {
    if (dirname(approval.issuerApprovalSocket) !== MANAGED_REVIEW_ROOT
      || normalize(approval.issuerApprovalSocket) !== approval.issuerApprovalSocket
      || Buffer.byteLength(approval.issuerApprovalSocket, 'utf8') > SUN_PATH_MAX_BYTES) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'issuerApprovalSocket must be an addressable direct child of the root-owned review directory')
    }
    if ([plan.brokerUid, plan.issuerUid, plan.guestUid].includes(Number(approval.issuerApprovalSocketUid))) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, 'issuerApprovalSocketUid must be an operator distinct from the daemon and guest principals')
    }
    if ([plan.reviewTerminalPublicKeyFile, plan.activationStatementFile, memory.rootControlStateFile].includes(approval.issuerApprovalSocket)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'issuerApprovalSocket must not replace retained public authority files')
    }
  }
  if (plan.brokerGroup === plan.issuerGroup || plan.brokerGid === plan.issuerGid) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, 'broker and issuer route groups must be distinct')
  }
  if (plan.brokerLabel === plan.issuerLabel) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, 'broker and issuer labels must be distinct')
  }
  for (const field of [...PATH_FIELDS, ...(memory.rootControlStateFile === undefined ? [] : ['rootControlStateFile'])]) {
    if (!isAbsolute(plan[field]) || normalize(plan[field]) !== plan[field]) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} must be one normalized absolute path`)
    }
    if (/\s/u.test(plan[field])) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} must not contain whitespace`)
    }
  }
  if (memory.rootControlStateFile !== undefined && isInside(memory.rootControlStateFile, repoDir)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'rootControlStateFile must be outside the checkout')
  }
  if (plan.launchDaemonDir !== LAUNCH_DAEMON_DIR) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `launchDaemonDir must equal ${LAUNCH_DAEMON_DIR}`)
  }
  for (const field of ['brokerStateDir', 'issuerStateDir', 'issuerKeyFile', 'implementationRoot']) {
    if (!isInside(plan[field], MANAGED_STATE_ROOT) || isInside(plan[field], repoDir)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `inputs.${field} must be under ${MANAGED_STATE_ROOT} and outside the checkout`)
    }
  }
  for (const field of ['brokerSocket', 'issuerSocket']) {
    if (!isInside(plan[field], MANAGED_SOCKET_ROOT)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `inputs.${field} must be under ${MANAGED_SOCKET_ROOT}`)
    }
  }
  if (dirname(plan.issuerKeyFile) !== plan.issuerStateDir) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'issuerKeyFile must be an immediate child of issuerStateDir')
  }
  // A route a daemon cannot address refuses only at startup, which is after
  // accounts, keys, staged bytes, both property lists and both bootstraps. The
  // bound is the transport's own measured constant, not a second copy of it.
  for (const field of ['brokerSocket', 'issuerSocket', 'reviewSocket']) {
    if (Buffer.byteLength(plan[field], 'utf8') > SUN_PATH_MAX_BYTES) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} exceeds the ${String(SUN_PATH_MAX_BYTES)}-byte addressable socket path limit`)
    }
  }
  for (const field of ['reviewServerId', 'activationDigest', 'rendererId']) {
    if (!/^[0-9a-f]{64}$/u.test(plan[field])) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `inputs.${field} must be a lowercase 64-character hex identity`)
    }
  }
  // Retained beside the terminal key in the same root-owned leaf: the broker
  // measures itself against this statement and must not be able to rewrite it.
  if (dirname(plan.activationStatementFile) !== MANAGED_REVIEW_ROOT) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `activationStatementFile must be an immediate child of ${MANAGED_REVIEW_ROOT}`)
  }
  // The broker publishes the review route, so it shares the broker's route
  // parent and its 0710 custody rather than introducing a second owner.
  if (dirname(plan.reviewSocket) !== join(MANAGED_SOCKET_ROOT, 'broker')) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'reviewSocket must be an immediate child of the broker route parent')
  }
  if (plan.reviewSocket === plan.brokerSocket || plan.reviewSocket === plan.issuerSocket) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'reviewSocket must not collide with the broker or issuer route')
  }
  // Pinning the key to the root-owned review leaf is what keeps it outside any
  // directory the broker principal owns; brokerStateDir is separately pinned to
  // its own fixed leaf below, so no further comparison can fire.
  if (dirname(plan.reviewTerminalPublicKeyFile) !== MANAGED_REVIEW_ROOT) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `reviewTerminalPublicKeyFile must be an immediate child of ${MANAGED_REVIEW_ROOT}`)
  }
  if (!isInside(plan.implementationRoot, IMPLEMENTATION_PARENT)
    || dirname(plan.implementationRoot) !== IMPLEMENTATION_PARENT) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `implementationRoot must be one direct versioned child of ${IMPLEMENTATION_PARENT}`)
  }
  if (plan.brokerStateDir !== join(MANAGED_STATE_ROOT, 'broker')
    || plan.issuerStateDir !== join(MANAGED_STATE_ROOT, 'issuer')
    || dirname(plan.brokerSocket) !== join(MANAGED_SOCKET_ROOT, 'broker')
    || dirname(plan.issuerSocket) !== join(MANAGED_SOCKET_ROOT, 'issuer')) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'broker and issuer state and route paths must use the fixed managed leaves')
  }
  return Object.freeze({ ...plan })
}

/** Parse one JSON object while refusing duplicate top-level field spellings. */
export function parseCustodyPairJson(text) {
  const source = String(text)
  const keys = new Set()
  let objectDepth = 0
  let arrayDepth = 0
  for (let index = 0; index < source.length;) {
    const character = source[index]
    if (character === '"') {
      const start = index
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index] === '"') break
        index += 1
      }
      if (index >= source.length) break
      const end = index + 1
      let cursor = end
      while (/\s/u.test(source[cursor] ?? '')) cursor += 1
      if (objectDepth === 1 && arrayDepth === 0 && source[cursor] === ':') {
        let key
        try { key = JSON.parse(source.slice(start, end)) } catch { break }
        if (keys.has(key)) {
          throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_DUPLICATE, `inputs repeats field ${key}`)
        }
        keys.add(key)
      }
      index = end
      continue
    }
    if (character === '{') objectDepth += 1
    else if (character === '}') objectDepth -= 1
    else if (character === '[') arrayDepth += 1
    else if (character === ']') arrayDepth -= 1
    index += 1
  }
  return JSON.parse(source)
}

/** Parse a `dscl -list ... id` result into an exact name-to-id map. */
export function parseIdentityList(text, kind) {
  const out = new Map()
  for (const [index, rawLine] of String(text).split('\n').entries()) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = /^(\S+)\s+(-?[0-9]+)$/u.exec(line)
    if (match === null) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `${kind} list line ${index + 1} is malformed`)
    }
    const id = Number(match[2])
    if (!Number.isSafeInteger(id) || out.has(match[1])) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `${kind} list contains an invalid or duplicate identity`)
    }
    out.set(match[1], id)
  }
  return out
}

/** Parse exact local name-to-GeneratedUID rows. */
function parseGeneratedUidList(text) {
  const out = new Map()
  for (const [index, rawLine] of String(text).split('\n').entries()) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = /^(\S+)\s+([0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12})$/u.exec(line)
    if (match === null || out.has(match[1])) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `GeneratedUID list line ${index + 1} is malformed or duplicated`)
    }
    out.set(match[1], match[2].toUpperCase())
  }
  return out
}

/** Parse one-line dscl attributes, accepting the native IsHidden field name. */
export function parseDsclRecord(text, requiredFields) {
  const values = new Map()
  for (const rawLine of String(text).split('\n')) {
    if (rawLine.trim() === '') continue
    const line = rawLine.startsWith('dsAttrTypeNative:IsHidden:')
      ? rawLine.slice('dsAttrTypeNative:'.length)
      : rawLine
    const match = /^([A-Za-z][A-Za-z0-9]*):(?:[ \t](.*))?$/u.exec(line)
    if (match === null || values.has(match[1])) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, 'dscl record is malformed or repeats an attribute')
    }
    values.set(match[1], match[2] ?? '')
  }
  for (const field of requiredFields) {
    if (!values.has(field)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `dscl record omits ${field}`)
    }
  }
  return values
}

/** Parse numeric supplementary and primary groups from `id -G`. */
export function parseNumericGroups(text) {
  const value = String(text).trim()
  if (!/^[0-9]+(?: [0-9]+)*$/u.test(value)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, 'id -G output is malformed')
  }
  return new Set(value.split(' ').map(Number))
}

/** Parse bounded `ps` rows needed for service-uid exclusivity observations. */
export function parseProcessList(text) {
  const rows = []
  for (const [index, rawLine] of String(text).split('\n').entries()) {
    if (rawLine.trim() === '') continue
    const match = /^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+(\S.*)$/u.exec(rawLine)
    if (match === null) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `process row ${index + 1} is malformed`)
    }
    const [pid, uid, gid] = match.slice(1, 4).map(Number)
    if (![pid, uid, gid].every(Number.isSafeInteger)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `process row ${index + 1} has an invalid numeric id`)
    }
    rows.push(Object.freeze({ pid, uid, gid, command: match[4] }))
  }
  return rows
}

/** Grade active allow/deny probes without accepting absence as deprivation. */
export function gradeCustodyProbes(probes) {
  const denial = (result) => result?.opened === false || result?.connected === false
    ? result.errno === 'EACCES' || result.errno === 'EPERM'
    : false
  if (probes.guestBroker?.connected !== true || probes.brokerIssuer?.connected !== true) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.POSITIVE_CONTROL_FAILED, 'an allowed socket route did not connect')
  }
  if (probes.issuerKey?.opened !== true || probes.brokerState?.opened !== true) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.POSITIVE_CONTROL_FAILED, 'an owning principal could not open its protected file')
  }
  if (!denial(probes.guestIssuer)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.GUEST_REACHED_ISSUER, 'guest-to-issuer was not denied by EACCES or EPERM')
  }
  if (!denial(probes.issuerBroker)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.GUEST_REACHED_SECRET, 'issuer-to-broker was not denied by EACCES or EPERM')
  }
  for (const [name, result] of Object.entries({
    brokerKey: probes.brokerKey,
    guestKey: probes.guestKey,
    guestState: probes.guestState,
    issuerState: probes.issuerState,
  })) {
    if (!denial(result)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.GUEST_REACHED_SECRET, `${name} was not denied by EACCES or EPERM`)
    }
  }
  return Object.freeze({
    brokerToIssuer: 'CONNECTED',
    guestToBroker: 'CONNECTED',
    issuerToBroker: probes.issuerBroker.errno,
    guestToIssuer: probes.guestIssuer.errno,
    brokerToIssuerKey: probes.brokerKey.errno,
    guestToIssuerKey: probes.guestKey.errno,
    guestToBrokerState: probes.guestState.errno,
    issuerToBrokerState: probes.issuerState.errno,
  })
}

/** Return one SHA-256 lowercase hex digest. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Run one absolute host command under a closed environment and output bound. */
function runHost(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: SAFE_ENV,
    maxBuffer: MAX_COMMAND_OUTPUT,
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (result.error !== undefined) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `${basename(command)} failed: ${result.error.message}`)
  }
  if (!allowFailure && result.status !== 0) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.HOST_MUTATION_FAILED,
      `${basename(command)} exited ${String(result.status)}: ${result.stderr.trim()}`,
    )
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Read all account or group name-to-id assignments. */
function identityList(kind) {
  const isUser = kind === 'user'
  const result = runHost('/usr/bin/dscl', ['.', '-list', isUser ? '/Users' : '/Groups', isUser ? 'UniqueID' : 'PrimaryGroupID'])
  return parseIdentityList(result.stdout, kind)
}

/** Read and normalize one service-account record. */
function userRecord(name) {
  const fields = [
    'UniqueID',
    'PrimaryGroupID',
    'NFSHomeDirectory',
    'UserShell',
    'IsHidden',
    'GeneratedUID',
    'Password',
    'AuthenticationAuthority',
  ]
  const result = runHost('/usr/bin/dscl', ['.', '-read', `/Users/${name}`, ...fields])
  const values = parseDsclRecord(result.stdout, fields.filter(field => field !== 'AuthenticationAuthority'))
  return {
    uid: Number(values.get('UniqueID')),
    gid: Number(values.get('PrimaryGroupID')),
    home: values.get('NFSHomeDirectory'),
    shell: values.get('UserShell'),
    hidden: values.get('IsHidden') === '1',
    generatedUid: values.get('GeneratedUID'),
    password: values.get('Password'),
    authenticationAuthority: values.get('AuthenticationAuthority') ?? null,
  }
}

/** Read one local group record, including every direct or nested member. */
function groupRecord(name) {
  const result = runHost('/usr/bin/dscl', [
    '.',
    '-read',
    `/Groups/${name}`,
    'PrimaryGroupID',
    'GroupMembership',
    'GroupMembers',
    'NestedGroups',
  ])
  const values = parseDsclRecord(result.stdout, ['PrimaryGroupID'])
  const tokens = (field) => {
    const value = values.get(field)
    return value === undefined || value === '' ? new Set() : new Set(value.split(/\s+/u))
  }
  return {
    gid: Number(values.get('PrimaryGroupID')),
    names: tokens('GroupMembership'),
    generatedUids: tokens('GroupMembers'),
    nested: tokens('NestedGroups'),
  }
}

/** Create one group record without deleting any pre-existing record. */
function createGroup(name, gid) {
  runHost('/usr/bin/dscl', ['.', '-create', `/Groups/${name}`, 'PrimaryGroupID', String(gid)])
}

/** Create one disabled hidden service account. Partial failure remains visible. */
function createUser(name, uid, gid) {
  const path = `/Users/${name}`
  try {
    runHost('/usr/bin/dscl', ['.', '-create', path, 'UniqueID', String(uid)])
    runHost('/usr/bin/dscl', ['.', '-create', path, 'PrimaryGroupID', String(gid)])
    runHost('/usr/bin/dscl', ['.', '-create', path, 'NFSHomeDirectory', EMPTY_HOME])
    runHost('/usr/bin/dscl', ['.', '-create', path, 'UserShell', NO_LOGIN_SHELL])
    runHost('/usr/bin/dscl', ['.', '-create', path, 'IsHidden', '1'])
    runHost('/usr/bin/dscl', ['.', '-create', path, 'Password', '*'])
  } catch (error) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.PARTIAL_STATE,
      `${name} may contain a partial service-account record: ${String(error?.message ?? error)}`,
    )
  }
}

/** Ensure names and numeric identities are exact, creating only absent records in apply mode. */
function ensureIdentities(plan, apply) {
  let groups = identityList('group')
  const createdGroups = new Set()
  for (const expected of [
    { name: plan.brokerGroup, gid: plan.brokerGid },
    { name: plan.issuerGroup, gid: plan.issuerGid },
  ]) {
    const observed = groups.get(expected.name)
    const owner = [...groups].find(([, gid]) => gid === expected.gid)?.[0]
    const alias = [...groups].find(([name, gid]) => name !== expected.name && gid === expected.gid)?.[0]
    if (alias !== undefined) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, `gid ${expected.gid} is also assigned to ${alias}`)
    if (observed === undefined) {
      if (owner !== undefined) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, `gid ${expected.gid} belongs to ${owner}`)
      if (!apply) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.GROUP_CONFLICT, `group ${expected.name} is absent`)
      createGroup(expected.name, expected.gid)
      createdGroups.add(expected.name)
      groups = identityList('group')
    }
    if (groups.get(expected.name) !== expected.gid) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.GROUP_CONFLICT, `group ${expected.name} does not own gid ${expected.gid}`)
    }
  }

  let users = identityList('user')
  const createdUsers = new Set()
  const userRecords = new Map()
  for (const expected of [
    { name: plan.brokerUser, uid: plan.brokerUid, gid: plan.brokerGid },
    { name: plan.issuerUser, uid: plan.issuerUid, gid: plan.issuerGid },
    { name: plan.guestUser, uid: plan.guestUid, gid: plan.brokerGid },
  ]) {
    const observed = users.get(expected.name)
    const owner = [...users].find(([, uid]) => uid === expected.uid)?.[0]
    const alias = [...users].find(([name, uid]) => name !== expected.name && uid === expected.uid)?.[0]
    if (alias !== undefined) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, `uid ${expected.uid} is also assigned to ${alias}`)
    if (observed === undefined) {
      if (owner !== undefined) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, `uid ${expected.uid} belongs to ${owner}`)
      if (!apply) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ACCOUNT_CONFLICT, `account ${expected.name} is absent`)
      createUser(expected.name, expected.uid, expected.gid)
      createdUsers.add(expected.name)
      users = identityList('user')
    }
    if (users.get(expected.name) !== expected.uid) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ACCOUNT_CONFLICT, `account ${expected.name} does not own uid ${expected.uid}`)
    }
    const record = userRecord(expected.name)
    if (record.uid !== expected.uid || record.gid !== expected.gid || record.home !== EMPTY_HOME
      || record.shell !== NO_LOGIN_SHELL || record.hidden !== true
      || record.password !== '*' || record.authenticationAuthority !== null
      || !/^[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/u.test(record.generatedUid)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ACCOUNT_CONFLICT, `account ${expected.name} has conflicting service fields`)
    }
    userRecords.set(expected.name, record)
  }

  const brokerRecord = userRecords.get(plan.brokerUser)
  const issuerRecord = userRecords.get(plan.issuerUser)
  const guestRecord = userRecords.get(plan.guestUser)
  const generatedUids = parseGeneratedUidList(
    runHost('/usr/bin/dscl', ['.', '-list', '/Users', 'GeneratedUID']).stdout,
  )
  const plannedGeneratedUids = new Map([
    [plan.brokerUser, brokerRecord.generatedUid.toUpperCase()],
    [plan.issuerUser, issuerRecord.generatedUid.toUpperCase()],
    [plan.guestUser, guestRecord.generatedUid.toUpperCase()],
  ])
  if (new Set(plannedGeneratedUids.values()).size !== 3) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, 'planned service accounts share a GeneratedUID')
  }
  for (const [name, generatedUid] of plannedGeneratedUids) {
    const owners = [...generatedUids].filter(([, value]) => value === generatedUid).map(([owner]) => owner)
    if (generatedUids.get(name) !== generatedUid || owners.length !== 1 || owners[0] !== name) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ID_COLLISION, `GeneratedUID for ${name} is missing or aliased`)
    }
  }
  const assertExactNames = (observed, allowed, detail) => {
    if ([...observed].some(value => !allowed.has(value))) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MEMBERSHIP_CONFLICT, detail)
    }
  }
  const validateRouteRecords = () => {
    const brokerRoute = groupRecord(plan.brokerGroup)
    const issuerRoute = groupRecord(plan.issuerGroup)
    assertExactNames(brokerRoute.names, new Set([plan.brokerUser, plan.guestUser]), 'broker route group contains another named member')
    assertExactNames(
      brokerRoute.generatedUids,
      new Set([brokerRecord.generatedUid, guestRecord.generatedUid]),
      'broker route group contains another UUID member',
    )
    assertExactNames(issuerRoute.names, new Set([plan.brokerUser, plan.issuerUser]), 'issuer route group contains another named member')
    assertExactNames(
      issuerRoute.generatedUids,
      new Set([brokerRecord.generatedUid, issuerRecord.generatedUid]),
      'issuer route group contains another UUID member',
    )
    if (brokerRoute.gid !== plan.brokerGid || issuerRoute.gid !== plan.issuerGid
      || brokerRoute.nested.size !== 0 || issuerRoute.nested.size !== 0) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MEMBERSHIP_CONFLICT, 'managed route groups contain a conflicting gid or nested group')
    }
  }
  validateRouteRecords()

  let brokerGroups = parseNumericGroups(runHost('/usr/bin/id', ['-G', plan.brokerUser]).stdout)
  if (!brokerGroups.has(plan.issuerGid)) {
    if (!apply || !createdUsers.has(plan.brokerUser) || !createdGroups.has(plan.issuerGroup)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MEMBERSHIP_CONFLICT, 'existing account or group membership is never repaired')
    }
    runHost('/usr/sbin/dseditgroup', ['-o', 'edit', '-a', plan.brokerUser, '-t', 'user', plan.issuerGroup])
    brokerGroups = parseNumericGroups(runHost('/usr/bin/id', ['-G', plan.brokerUser]).stdout)
    validateRouteRecords()
  }
  const guestGroups = parseNumericGroups(runHost('/usr/bin/id', ['-G', plan.guestUser]).stdout)
  const issuerGroups = parseNumericGroups(runHost('/usr/bin/id', ['-G', plan.issuerUser]).stdout)
  if (!brokerGroups.has(plan.brokerGid) || !brokerGroups.has(plan.issuerGid)
    || !guestGroups.has(plan.brokerGid) || guestGroups.has(plan.issuerGid)
    || !issuerGroups.has(plan.issuerGid) || issuerGroups.has(plan.brokerGid)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MEMBERSHIP_CONFLICT, 'live numeric route membership does not match the peer sets')
  }
  if ([brokerGroups, guestGroups, issuerGroups].some(groups => [...PRIVILEGED_HOST_GIDS].some(gid => groups.has(gid)))) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MEMBERSHIP_CONFLICT, 'a service account belongs to wheel or admin')
  }
  const primaryAssignments = parseIdentityList(
    runHost('/usr/bin/dscl', ['.', '-list', '/Users', 'PrimaryGroupID']).stdout,
    'user primary-group',
  )
  const primaryNames = (gid) => new Set([...primaryAssignments].filter(([, value]) => value === gid).map(([name]) => name))
  const brokerPrimaryNames = primaryNames(plan.brokerGid)
  const issuerPrimaryNames = primaryNames(plan.issuerGid)
  if (brokerPrimaryNames.size !== 2 || !brokerPrimaryNames.has(plan.brokerUser) || !brokerPrimaryNames.has(plan.guestUser)
    || issuerPrimaryNames.size !== 1 || !issuerPrimaryNames.has(plan.issuerUser)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MEMBERSHIP_CONFLICT, 'another local account shares a managed primary group')
  }
  const ambient = (groups, managed) => [...groups].filter(gid => !managed.has(gid)).sort((left, right) => left - right)
  return Object.freeze({
    broker: {
      uid: plan.brokerUid,
      primaryGid: plan.brokerGid,
      supplementaryIssuerRoute: true,
      ambientSupplementaryGids: ambient(brokerGroups, new Set([plan.brokerGid, plan.issuerGid])),
    },
    issuer: {
      uid: plan.issuerUid,
      primaryGid: plan.issuerGid,
      ambientSupplementaryGids: ambient(issuerGroups, new Set([plan.issuerGid])),
    },
    guest: {
      uid: plan.guestUid,
      primaryGid: plan.brokerGid,
      issuerRoute: false,
      ambientSupplementaryGids: ambient(guestGroups, new Set([plan.brokerGid])),
    },
  })
}

/** Refuse a linked or wrongly owned existing directory; create only managed absences. */
/**
 * Require one directory to have exact custody, creating it when the caller may apply.
 *
 * Shared with the operator-seat stager so both staged roots get their managed parents under one
 * implementation of the ownership, mode, symlink and ACL rules.
 *
 * @param {string} path - absolute directory path.
 * @param {{uid: number, gid: number, mode: number, apply: boolean}} options - required custody, and whether an absent directory may be created.
 * @returns {void} nothing; every mismatch throws `CustodyPairError`.
 */
export function ensureDirectory(path, { uid, gid, mode, apply }) {
  try {
    const entry = lstatSync(path)
    if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(path) !== path) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_SYMLINK, `${path} is not an exact directory`)
    }
    if (entry.uid !== uid || entry.gid !== gid || (entry.mode & 0o777) !== mode) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} has unexpected owner, group, or mode`)
    }
    assertAclCustody(path, true)
    return
  } catch (error) {
    if (error instanceof CustodyPairError) throw error
    if (error?.code !== 'ENOENT') {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} could not be observed`)
    }
  }
  if (!apply) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} is absent`)
  assertAclCustody(dirname(path), true)
  let created = false
  try {
    mkdirSync(path, { mode })
    created = true
    chownSync(path, uid, gid)
    chmodSync(path, mode)
  } catch (error) {
    if (!created && error?.code === 'EEXIST') {
      ensureDirectory(path, { uid, gid, mode, apply: false })
      return
    }
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PARTIAL_STATE, `${path} may be partially provisioned: ${String(error?.message ?? error)}`)
  }
  const entry = lstatSync(path)
  if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(path) !== path
    || entry.uid !== uid || entry.gid !== gid || (entry.mode & 0o777) !== mode) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} did not retain exact custody`)
  }
  assertAclCustody(path)
}

/**
 * Acquire one root-owned single-writer lock.
 *
 * @param {string} [path] exact lock leaf; production uses the fixed managed path
 * @param {{uid?: number, gid?: number}} [owner] expected owner; production uses root
 * @returns {Readonly<{path: string, dev: number, ino: number, uid: number, gid: number}>} created inode identity
 */
export function acquireInstallerLock(path = INSTALL_LOCK_PATH, { uid = 0, gid = 0 } = {}) {
  let descriptor
  let identity
  try {
    descriptor = openSync(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    identity = fstatSync(descriptor)
    fchownSync(descriptor, uid, gid)
    fchmodSync(descriptor, 0o600)
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* exact-inode cleanup below remains authoritative */ }
      descriptor = undefined
    }
    if (identity !== undefined) {
      try {
        const observed = lstatSync(path)
        if (!observed.isFile() || observed.isSymbolicLink()
          || observed.dev !== identity.dev || observed.ino !== identity.ino) {
          throw new Error('installer lock inode identity changed')
        }
        unlinkSync(path)
        syncDirectory(dirname(path))
      } catch (cleanupError) {
        throw new CustodyPairError(
          CUSTODY_PAIR_REFUSE.INSTALL_LOCK_INDETERMINATE,
          `${String(error?.message ?? error)}; lock cleanup failed: ${String(cleanupError?.message ?? cleanupError)}`,
        )
      }
    }
    if (error?.code === 'EEXIST') {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INSTALL_ACTIVE, `${path} already exists`)
    }
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INSTALL_LOCK_INDETERMINATE, String(error?.message ?? error))
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  syncDirectory(dirname(path))
  return Object.freeze({ path, dev: identity.dev, ino: identity.ino, uid, gid })
}

/**
 * Release only the exact installer-lock inode created by this invocation.
 *
 * @param {{path: string, dev: number, ino: number, uid: number, gid: number}} lock created lock identity
 * @returns {void}
 */
export function releaseInstallerLock(lock) {
  try {
    const observed = lstatSync(lock.path)
    if (!observed.isFile() || observed.isSymbolicLink()
      || observed.uid !== lock.uid || observed.gid !== lock.gid || (observed.mode & 0o777) !== 0o600
      || observed.dev !== lock.dev || observed.ino !== lock.ino) {
      throw new Error('installer lock custody or inode identity changed')
    }
    unlinkSync(lock.path)
    syncDirectory(dirname(lock.path))
  } catch (error) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INSTALL_LOCK_INDETERMINATE, String(error?.message ?? error))
  }
}

/** Run one operation while holding the root-owned installer lock. */
async function withInstallerLock(operation) {
  const lock = acquireInstallerLock()
  let operationError = null
  try {
    return await operation()
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      releaseInstallerLock(lock)
    } catch (lockError) {
      if (operationError !== null) {
        throw new CustodyPairError(
          CUSTODY_PAIR_REFUSE.INSTALL_LOCK_INDETERMINATE,
          `${String(operationError?.message ?? operationError)}; ${String(lockError?.message ?? lockError)}`,
        )
      }
      throw lockError
    }
  }
}

/**
 * Require one exact root-owned directory whose group and other cannot write.
 *
 * Shared with the operator-seat stager, which must observe the grandparent of its own managed
 * parent before creating anything under it.
 *
 * @param {string} path - absolute directory path.
 * @returns {void} nothing; an inexact or writable directory throws `CustodyPairError`.
 */
export function assertRootManagedDirectory(path) {
  const state = lstatSync(path)
  if (!state.isDirectory() || state.isSymbolicLink() || realpathSync(path) !== path
    || state.uid !== 0 || (state.mode & 0o022) !== 0) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_SYMLINK, `${path} is not an exact root-managed directory`)
  }
  assertAclCustody(path, true)
}

/** Create the fixed root-owned parents one component at a time. */
function ensureManagedParents(apply) {
  for (const path of [MANAGED_STATE_ROOT, MANAGED_SOCKET_ROOT, IMPLEMENTATION_PARENT, MANAGED_REVIEW_ROOT]) {
    assertRootManagedDirectory(dirname(path))
    ensureDirectory(path, { uid: 0, gid: 0, mode: 0o755, apply })
  }
}

/** Read one exact regular file without following its leaf. */
function readExactFile(path) {
  const descriptor = openSync(path, O_RDONLY | O_NOFOLLOW)
  try {
    const entry = fstatSync(descriptor)
    if (!entry.isFile()) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `${path} is not a regular file`)
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Require one existing no-link regular file to have exact installed custody. */
function assertFileCustody(path, uid, gid, mode) {
  const state = lstatSync(path)
  if (!state.isFile() || state.isSymbolicLink() || realpathSync(path) !== path
    || state.uid !== uid || state.gid !== gid || (state.mode & 0o777) !== mode) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} has unexpected owner, group, or mode`)
  }
  assertAclCustody(path, true)
}

/** Preserve ACL refusals in the installer's machine-readable error family. */
function assertAclCustody(path, ancestors = false) {
  try {
    if (ancestors) assertNoExtendedAclAncestors(path)
    else assertNoExtendedAcl(path)
  } catch (error) {
    if (error instanceof CustodyAclError) throw new CustodyPairError(error.reason, error.path)
    throw error
  }
}

/** Require a root-owned executable below root-owned non-writable ancestors. */
function assertTrustedExecutable(path) {
  const nodeState = lstatSync(path)
  if (!nodeState.isFile() || nodeState.isSymbolicLink() || nodeState.uid !== 0 || (nodeState.mode & 0o022) !== 0
    || (nodeState.mode & 0o111) === 0 || realpathSync(path) !== path) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, 'nodeBin must be one direct root-owned executable not writable by group or other')
  }
  assertAclCustody(path)
  let current = dirname(path)
  while (true) {
    const state = lstatSync(current)
    if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== 0 || (state.mode & 0o022) !== 0
      || realpathSync(current) !== current) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `nodeBin ancestor ${current} is not root-owned and non-writable`)
    }
    assertAclCustody(current)
    if (current === '/') break
    current = dirname(current)
  }
}

/**
 * Require every ancestor of this module and the repo root to be root-owned without group or world write.
 *
 * @param {{modulePath?: string, repoRoot?: string, stat?: (path: string) => {isDirectory(): boolean, isSymbolicLink(): boolean, uid: number, mode: number}}} [options] fixture-injectable invocation locations
 * @returns {void}
 */
export function assertInvocationTree({ modulePath = fileURLToPath(import.meta.url), repoRoot = REPO_DIR, stat = lstatSync } = {}) {
  const seen = new Set()
  const paths = []
  let current = dirname(resolve(modulePath))
  while (true) {
    const normalized = resolve(current)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      paths.push(normalized)
    }
    const parent = dirname(normalized)
    if (parent === normalized) break
    current = parent
  }
  const root = resolve(repoRoot)
  if (!seen.has(root)) paths.push(root)
  for (const path of paths) {
    let state
    try {
      state = stat(path)
    } catch {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED, `${path} invocation tree is unobservable`)
    }
    if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== 0 || (state.mode & 0o022) !== 0) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED, `${path} invocation tree must be root-owned without group or world write`)
    }
  }
}

/** Flush directory-entry changes before reporting publication success. */
function syncDirectory(path) {
  const descriptor = openSync(path, O_RDONLY | O_NOFOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Measure one executable descriptor against an operator-selected byte digest.
 * Ownership and ACL checks belong to the installer; this read proves only the
 * observed file bytes, not loaded pages, dynamic libraries, or future integrity.
 *
 * @param {string} path canonical executable path
 * @param {string} expectedSha256 operator-pinned SHA-256
 * @returns {Readonly<{path: string, sha256: string, bytes: number}>} measured executable
 */
export function measureLaunchdRuntime(path, expectedSha256) {
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, 'nodeSha256 must be a lowercase SHA-256 digest')
  }
  const descriptor = openSync(path, O_RDONLY | O_NOFOLLOW)
  try {
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER)
      || realpathSync(path) !== path) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.RUNTIME_CHANGED, 'runtime must be one canonical regular file without hard links')
    }
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(1024 * 1024)
    let bytes = 0
    for (;;) {
      const length = readSync(descriptor, buffer, 0, buffer.length, null)
      if (length === 0) break
      bytes += length
      hash.update(buffer.subarray(0, length))
    }
    const after = fstatSync(descriptor, { bigint: true })
    const named = lstatSync(path, { bigint: true })
    const fields = ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
    if (fields.some(field => before[field] !== after[field] || after[field] !== named[field])
      || bytes !== Number(before.size)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.RUNTIME_CHANGED, 'runtime identity changed during measurement')
    }
    const digest = hash.digest('hex')
    if (digest !== expectedSha256) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.RUNTIME_BYTES_MISMATCH, `runtime bytes ${digest} do not match the selected digest`)
    }
    return Object.freeze({ path, sha256: digest, bytes })
  } finally {
    closeSync(descriptor)
  }
}

/** Return the exact staged authority file set, including the graph selector. */
function authorityFiles() {
  const graph = verifierGraph()
  const computedVerifierSha256 = sha256(JSON.stringify(graph))
  if (computedVerifierSha256 !== FROZEN_VERIFIER_SHA256) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT,
      `authority graph ${computedVerifierSha256} differs from frozen ${FROZEN_VERIFIER_SHA256}`,
    )
  }
  let dependencyFiles
  try {
    dependencyFiles = snapshotAuthorityDependencies(graph.externalEdges
      .filter(edge => !edge.specifier.startsWith('node:'))
      .map(edge => ({ specifier: edge.specifier, consumerPath: join(REPO_DIR, 'aukora', edge.from) })))
  } catch (error) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT,
      String(error?.message ?? error),
    )
  }
  const files = graph.nodes.map(node => ({
    path: `aukora/${node.path}`,
    bytes: Buffer.from(node.sourceBase64, 'base64'),
    sha256: node.sha256,
  }))
  files.push(...dependencyFiles)
  const selectorBytes = readExactFile(SELECTOR_PATH)
  files.push({
    path: 'aukora/host-dsh/src/verifier-bytes.mjs',
    bytes: selectorBytes,
    sha256: sha256(selectorBytes),
  })
  const helperBytes = readExactFile(CHILD_HELPER_SOURCE)
  files.push({
    path: 'scripts/launchd-custody-child.mjs',
    bytes: helperBytes,
    sha256: sha256(helperBytes),
  })
  // The installed entry requires its review and activation imports even when
  // they are not already members of the frozen authority graph.
  for (const relative of [
    'scripts/launchd-broker-entry.mjs',
    'scripts/launchd-broker-review.mjs',
    'scripts/launchd-review-transport.mjs',
    'scripts/launchd-socket-listener.mjs',
    // The entry verifies its own activation before serving, so the modules that
    // perform that measurement are part of what must be installed.
    'scripts/launchd-activation.mjs',
    'aukora/activation/measure.mjs',
    'aukora/activation/statement.mjs',
  ]) {
    if (files.some(file => file.path === relative)) continue
    const bytes = readExactFile(join(REPO_DIR, relative))
    files.push({ path: relative, bytes, sha256: sha256(bytes) })
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const manifest = canonicalJSON({
    domain: 'aukora:installed-authority-files:v1',
    frozenVerifierSha256: FROZEN_VERIFIER_SHA256,
    files: files.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
  })
  return { files, manifest, manifestSha256: sha256(manifest) }
}

/**
 * Return the content address required for the installed authority directory.
 *
 * @returns {string} canonical installed-manifest SHA-256
 */
export function installedAuthorityManifestDigest() {
  return authorityFiles().manifestSha256
}

/**
 * Return every file the installer stages under the implementation root.
 *
 * Exposed so a test can assert that the broker entry's whole relative-import
 * closure is staged, and can stand up a scratch implementation root holding
 * exactly these bytes. An unstaged import would resolve, if at all, against a
 * developer checkout the installed daemon must not depend on.
 *
 * @returns {readonly {path: string, bytes: Buffer, sha256: string}[]} staged files, paths relative to the implementation root
 */
export function installedAuthorityFiles() {
  return authorityFiles().files
}

/** Return every direct relative path below one directory. */
function directoryEntries(root) {
  const found = []
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      found.push({ entry, rel })
      if (entry.isDirectory()) visit(join(directory, entry.name), rel)
    }
  }
  visit(root, '')
  return found
}

/**
 * Publish or verify one root-owned read-only authority implementation and its
 * retained activation. Existing files must already match; none are replaced.
 * @param {Readonly<{implementationRoot: string, activationStatementFile: string}>} plan implementation destination and operator statement
 * @param {boolean} apply whether an absent implementation may be published
 * @returns {Readonly<{frozenVerifierSha256: string, manifestSha256: string, files: number}>} observed implementation inventory
 */
export function stageAuthority(plan, apply) {
  const { implementationRoot } = plan
  const expected = authorityFiles()
  if (basename(implementationRoot) !== expected.manifestSha256) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT,
      `implementationRoot basename must equal installed manifest digest ${expected.manifestSha256}`,
    )
  }
  const expectedFiles = new Map(expected.files.map(file => [file.path, file]))
  expectedFiles.set('manifest.json', { path: 'manifest.json', bytes: Buffer.from(expected.manifest), sha256: expected.manifestSha256 })
  assertFileCustody(plan.activationStatementFile, 0, 0, 0o644)
  const activationBytes = readExactFile(plan.activationStatementFile)
  expectedFiles.set(INSTALLED_ACTIVATION_STATEMENT, {
    path: INSTALLED_ACTIVATION_STATEMENT,
    bytes: activationBytes,
    sha256: sha256(activationBytes),
  })
  publishStagedRoot(implementationRoot, expectedFiles, apply)
  return Object.freeze({
    frozenVerifierSha256: FROZEN_VERIFIER_SHA256,
    manifestSha256: expected.manifestSha256,
    files: expectedFiles.size,
  })
}

/**
 * Publish or verify one root-owned read-only staged root holding exactly one file set.
 *
 * Publication is all-or-nothing per root: an absent root is created `0700`, filled with
 * `0444` root-owned files through `O_EXCL | O_NOFOLLOW` descriptors, then sealed `0555`.
 * An existing root is never rewritten — it is only observed, so a staged root that already
 * differs is reported rather than repaired. The inventory comparison is exact in both
 * directions, which is what makes an unstaged import fail here instead of silently
 * resolving against whatever checkout the reader happens to have.
 *
 * @param {string} root absolute staged-root path, already content-addressed by its caller
 * @param {Map<string, {path: string, bytes: Buffer, sha256: string}>} expectedFiles the complete file set, keyed by root-relative path
 * @param {boolean} apply whether an absent root may be published
 * @returns {void} nothing; every mismatch throws `CustodyPairError`
 */
export function publishStagedRoot(root, expectedFiles, apply) {
  const implementationRoot = root

  if (!existsSync(implementationRoot)) {
    if (!apply) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `${implementationRoot} is absent`)
    ensureDirectory(implementationRoot, { uid: 0, gid: 0, mode: 0o700, apply: true })
    try {
      const directories = new Set()
      for (const path of expectedFiles.keys()) {
        let current = dirname(path)
        while (current !== '.') {
          directories.add(current)
          current = dirname(current)
        }
      }
      for (const path of [...directories].sort((left, right) => left.split('/').length - right.split('/').length)) {
        const target = join(implementationRoot, path)
        mkdirSync(target, { mode: 0o755 })
        chownSync(target, 0, 0)
        assertAclCustody(target)
      }
      for (const file of expectedFiles.values()) {
        const target = join(implementationRoot, file.path)
        const descriptor = openSync(target, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o444)
        try {
          fchownSync(descriptor, 0, 0)
          fchmodSync(descriptor, 0o444)
          writeFileSync(descriptor, file.bytes)
          fsyncSync(descriptor)
        } finally {
          closeSync(descriptor)
        }
        assertAclCustody(target)
      }
      for (const path of [...directories].sort((left, right) => right.split('/').length - left.split('/').length)) {
        syncDirectory(join(implementationRoot, path))
        chmodSync(join(implementationRoot, path), 0o555)
      }
      syncDirectory(implementationRoot)
      chmodSync(implementationRoot, 0o555)
    } catch (error) {
      if (error instanceof CustodyPairError) throw error
      throw new CustodyPairError(
        CUSTODY_PAIR_REFUSE.IMPLEMENTATION_PUBLICATION_FAILED,
        `${implementationRoot} may contain an incomplete read-only staging: ${String(error?.message ?? error)}`,
      )
    }
  }

  const rootState = lstatSync(implementationRoot)
  if (!rootState.isDirectory() || rootState.isSymbolicLink() || rootState.uid !== 0 || rootState.gid !== 0 || (rootState.mode & 0o777) !== 0o555) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, 'implementation root custody does not match root:wheel 0555')
  }
  assertAclCustody(implementationRoot, true)
  const observed = directoryEntries(implementationRoot)
  const observedFiles = observed.filter(({ entry }) => entry.isFile()).map(({ rel }) => rel).sort()
  const observedDirs = observed.filter(({ entry }) => entry.isDirectory()).map(({ rel }) => rel)
  const expectedNames = [...expectedFiles.keys()].sort()
  if (JSON.stringify(observedFiles) !== JSON.stringify(expectedNames)
    || observed.some(({ entry }) => entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `${root} inventory differs from the closed staged file set`)
  }
  for (const rel of observedDirs) {
    const state = lstatSync(join(implementationRoot, rel))
    if (state.uid !== 0 || state.gid !== 0 || (state.mode & 0o777) !== 0o555) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `${rel} is not root:wheel 0555`)
    }
    assertAclCustody(join(implementationRoot, rel))
  }
  for (const [rel, file] of expectedFiles) {
    const target = join(implementationRoot, rel)
    assertAclCustody(target)
    const state = lstatSync(target)
    if (!state.isFile() || state.isSymbolicLink() || state.uid !== 0 || state.gid !== 0 || (state.mode & 0o777) !== 0o444
      || sha256(readExactFile(target)) !== file.sha256) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `${rel} differs from the staged file set`)
    }
  }
}

/** Run the closed helper as one named account and validate its reported IDs. */
function runAsPrincipal(plan, account, operation, path) {
  const expected = account === plan.brokerUser
    ? { uid: plan.brokerUid, gid: plan.brokerGid }
    : account === plan.issuerUser
      ? { uid: plan.issuerUid, gid: plan.issuerGid }
      : { uid: plan.guestUid, gid: plan.brokerGid }
  const installedHelper = join(plan.implementationRoot, 'scripts', 'launchd-custody-child.mjs')
  const result = runHost('/usr/bin/sudo', ['-n', '-u', account, '--', plan.nodeBin, installedHelper, operation, path], { allowFailure: true })
  let body
  try {
    body = JSON.parse(result.status === 0 ? result.stdout : result.stderr)
  } catch {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PRINCIPAL_HELPER_FAILED, `${account}/${operation} returned non-JSON output`)
  }
  if (result.status !== 0 || body?.ok !== true) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PRINCIPAL_HELPER_FAILED, `${account}/${operation} refused as ${String(body?.reason ?? result.status)}`)
  }
  if (body.euid !== expected.uid || body.egid !== expected.gid || body.operation !== operation) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PRINCIPAL_HELPER_MISMATCH, `${account}/${operation} ran under the wrong numeric principal`)
  }
  return body
}

/** Publish one exact plist, or accept an existing identical root-owned plist. */
function installJob(path, content, apply) {
  if (existsSync(path)) {
    const state = lstatSync(path)
    if (!state.isFile() || state.isSymbolicLink() || state.uid !== 0 || state.gid !== 0 || (state.mode & 0o777) !== 0o644
      || readExactFile(path).toString('utf8') !== content) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.JOB_DEFINITION_CONFLICT, `${path} conflicts with the expected job`)
    }
    return Object.freeze({ created: false, path, dev: null, ino: null })
  }
  if (!apply) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.JOB_DEFINITION_CONFLICT, `${path} is absent`)
  let descriptor
  let identity
  try {
    descriptor = openSync(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644)
    identity = fstatSync(descriptor)
    fchownSync(descriptor, 0, 0)
    fchmodSync(descriptor, 0o644)
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* inode cleanup below remains authoritative */ }
      descriptor = undefined
    }
    if (identity !== undefined) {
      try {
        const observed = lstatSync(path)
        if (!observed.isFile() || observed.dev !== identity.dev || observed.ino !== identity.ino) {
          throw new Error('created inode identity changed')
        }
        unlinkSync(path)
        syncDirectory(dirname(path))
      } catch (cleanupError) {
        throw new CustodyPairError(
          CUSTODY_PAIR_REFUSE.PARTIAL_STATE,
          `${path}: ${String(error?.message ?? error)}; cleanup failed: ${String(cleanupError?.message ?? cleanupError)}`,
        )
      }
    }
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.JOB_PUBLICATION_FAILED, `${path}: ${String(error?.message ?? error)}`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  syncDirectory(dirname(path))
  return Object.freeze({ created: true, path, dev: identity.dev, ino: identity.ino })
}

/** Roll back only exact property-list inodes created by this invocation. */
function rollbackPublishedJobs(publications, cause) {
  const failures = []
  for (const publication of publications.toReversed()) {
    if (!publication.created) continue
    try {
      const state = lstatSync(publication.path)
      if (!state.isFile() || state.dev !== publication.dev || state.ino !== publication.ino) {
        failures.push(`${publication.path}: created inode identity changed`)
        continue
      }
      unlinkSync(publication.path)
      syncDirectory(dirname(publication.path))
    } catch (error) {
      failures.push(`${publication.path}: ${String(error?.message ?? error)}`)
    }
  }
  if (failures.length > 0) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.PARTIAL_STATE,
      `${String(cause?.message ?? cause)}; plist rollback indeterminate: ${failures.join('; ')}`,
    )
  }
}

/** Read the current system launchd job, returning null only for an absent label. */
function readLaunchdJob(label) {
  const result = runHost('/bin/launchctl', ['print', `system/${label}`], { allowFailure: true })
  if (result.status !== 0) {
    const absent = result.status === 113
      && result.stdout === ''
      && result.stderr.includes(`Could not find service "${label}" in domain for system`)
    if (absent) return null
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
      `launchctl could not determine whether ${label} is loaded`,
    )
  }
  return result.stdout
}

/**
 * Return the exact program each installed job must be observed running.
 *
 * One definition serves both program comparisons: the pre-existing pair
 * observation and the post-bootstrap active pair observation. Load and rollback
 * observation checks liveness only and passes no expected program. The broker
 * job runs the reviewed entry, not `broker.mjs`, whose review callback can only
 * arrive over a Node IPC parent that launchd cannot supply.
 *
 * @param {Readonly<Record<string, string | number>>} plan validated custody-pair plan
 * @returns {Readonly<{issuer: {nodeBin: string, module: string}, broker: {nodeBin: string, module: string}}>} expected programs
 */
export function expectedJobEntries(plan) {
  return Object.freeze({
    issuer: Object.freeze({
      nodeBin: plan.nodeBin,
      module: join(plan.implementationRoot, 'aukora', 'issuer', 'issuer.mjs'),
    }),
    broker: Object.freeze({
      nodeBin: plan.nodeBin,
      module: join(plan.implementationRoot, 'scripts', 'launchd-broker-entry.mjs'),
    }),
  })
}

/**
 * Return whether one observed process command is exactly the expected program.
 *
 * The comparison is exact and positional: any extra argument, any other
 * interpreter, and any other module refuse.
 *
 * @param {readonly string[]} command whitespace-split `ps -o command=` output
 * @param {{nodeBin: string, module: string}} expectedEntry expected program
 * @returns {boolean} whether the observed command is the expected program
 */
export function jobCommandMatches(command, expectedEntry) {
  return command.length === 2
    && command[0] === expectedEntry.nodeBin
    && command[1] === expectedEntry.module
}

/** Observe one running launchd job and its live executable identity. */
function observeJob(label, expectedEntry) {
  const printed = readLaunchdJob(label)
  if (printed === null) return null
  const pid = /^\s*pid = ([0-9]+)\s*$/mu.exec(printed)?.[1]
  const state = /^\s*state = (\S+)\s*$/mu.exec(printed)?.[1]
  if (pid === undefined || state !== 'running') {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ROUTE_UNOBSERVED, `${label} is loaded but not observed running`)
  }
  const identity = runHost('/bin/ps', ['-o', 'uid=,gid=', '-p', pid]).stdout.trim().split(/\s+/u).map(Number)
  if (identity.length !== 2 || !identity.every(Number.isSafeInteger)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED, `${label} pid has no numeric uid and gid`)
  }
  if (expectedEntry !== undefined) {
    const command = runHost('/bin/ps', ['-ww', '-o', 'command=', '-p', pid]).stdout.trim().split(/\s+/u)
    if (!jobCommandMatches(command, expectedEntry)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.JOB_PRINCIPAL_MISMATCH, `${label} runs an unexpected executable or module`)
    }
  }
  return { pid: Number(pid), uid: identity[0], gid: identity[1] }
}

/** Remove every job loaded by this invocation and prove each label is absent. */
function rollbackLoadedJobs(labels, cause) {
  const failures = []
  for (const label of labels.toReversed()) {
    try {
      runHost('/bin/launchctl', ['bootout', `system/${label}`], { allowFailure: true })
    } catch (error) {
      failures.push(`${label}: ${String(error?.message ?? error)}`)
    }
    try {
      if (readLaunchdJob(label) !== null) failures.push(`${label}: label remains loaded`)
    } catch (error) {
      failures.push(`${label}: cleanup could not be observed: ${String(error?.message ?? error)}`)
    }
  }
  if (failures.length > 0) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.PARTIAL_STATE,
      `${String(cause?.message ?? cause)}; job rollback indeterminate: ${failures.join('; ')}`,
    )
  }
}

/** Require the planned service UIDs to own no process beyond the named jobs. */
function observeExclusiveProcesses(plan, jobs) {
  const rows = parseProcessList(runHost('/bin/ps', ['-axo', 'pid=,uid=,gid=,command=']).stdout)
  const allowed = new Map([
    [plan.brokerUid, jobs.broker === null ? new Set() : new Set([jobs.broker.pid])],
    [plan.issuerUid, jobs.issuer === null ? new Set() : new Set([jobs.issuer.pid])],
    [plan.guestUid, new Set()],
  ])
  for (const row of rows) {
    const allowedPids = allowed.get(row.uid)
    if (allowedPids !== undefined && !allowedPids.has(row.pid)) {
      throw new CustodyPairError(
        CUSTODY_PAIR_REFUSE.PRINCIPAL_PROCESS_CONFLICT,
        `uid ${row.uid} owns unexpected pid ${row.pid}`,
      )
    }
  }
  for (const job of [jobs.broker, jobs.issuer]) {
    if (job !== null && !rows.some(row => row.pid === job.pid && row.uid === job.uid && row.gid === job.gid)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PRINCIPAL_PROCESS_CONFLICT, `planned pid ${job.pid} was not stable across observation`)
    }
  }
}

/**
 * Load missing jobs issuer-first and roll back only jobs loaded by this call.
 *
 * @param {Record<string, unknown>} plan validated custody plan
 * @param {{issuer: string, broker: string}} paths installed property-list paths
 * @param {boolean} apply whether missing jobs may be bootstrapped
 * @param {object} [operations] test-only coarse launchd operations
 * @returns {string[]} labels loaded by this invocation
 */
export function ensureJobsLoaded(plan, paths, apply, operations = undefined) {
  const host = operations ?? Object.freeze({
    observe: label => observeJob(label),
    bootstrap: (label, path) => runHost('/bin/launchctl', ['bootstrap', 'system', path], { allowFailure: true }),
    read: label => readLaunchdJob(label),
    rollback: (labels, cause) => rollbackLoadedJobs(labels, cause),
  })
  const loaded = []
  try {
    for (const item of [
      { label: plan.issuerLabel, path: paths.issuer },
      { label: plan.brokerLabel, path: paths.broker },
    ]) {
      if (host.observe(item.label) !== null) continue
      if (!apply) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.BOOTSTRAP_FAILED, `${item.label} is not loaded`)
      let failure = null
      try {
        const result = host.bootstrap(item.label, item.path)
        if (result.status !== 0) {
          failure = new CustodyPairError(CUSTODY_PAIR_REFUSE.BOOTSTRAP_FAILED, `${item.label}: ${result.stderr.trim()}`)
        }
      } catch (error) {
        failure = error
      }
      if (failure !== null) {
        try {
          if (host.read(item.label) !== null) {
            throw new CustodyPairError(
              CUSTODY_PAIR_REFUSE.PARTIAL_STATE,
              `${String(failure?.message ?? failure)}; ${item.label} is present after failed bootstrap and ownership is indeterminate`,
            )
          }
        } catch (observationError) {
          if (observationError instanceof CustodyPairError) throw observationError
          throw new CustodyPairError(
            CUSTODY_PAIR_REFUSE.PARTIAL_STATE,
            `${String(failure?.message ?? failure)}; bootstrap outcome cannot be observed: ${String(observationError?.message ?? observationError)}`,
          )
        }
        throw failure
      }
      loaded.push(item.label)
    }
  } catch (error) {
    host.rollback(loaded, error)
    throw error
  }
  return loaded
}

/** Wait briefly for both installed sockets to become exact `0660` socket nodes. */
async function observeSocket(path, uid, gid) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const state = lstatSync(path)
      if (state.isSocket() && !state.isSymbolicLink() && state.uid === uid && state.gid === gid && (state.mode & 0o777) === 0o660) {
        assertAclCustody(path, true)
        return Object.freeze({ uid, gid, mode: '0660' })
      }
    } catch (error) {
      if (error instanceof CustodyPairError) throw error
      if (error?.code !== 'ENOENT') break
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ROUTE_UNOBSERVED, `${path} was not observed as the expected 0660 socket`)
}

/**
 * Require the operator's root-owned activation statement to measure exactly
 * the implementation and interpreter selected for the generated jobs.
 *
 * @param {Readonly<Record<string, string | number>>} plan validated custody-pair plan
 * @returns {string} the verified activation digest
 */
export function requireActivationStatement(plan) {
  try {
    assertFileCustody(plan.activationStatementFile, 0, 0, 0o644)
  } catch (error) {
    if (error instanceof CustodyPairError) throw error
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH,
      `${plan.activationStatementFile} is not one root-owned 0644 activation statement`,
    )
  }
  // The generated job carries the digest in its environment, where it is
  // transport. This measurement against the staged bytes is what makes it
  // evidence, and it runs before either property list is written.
  return verifyInstalledActivation({
    statementPath: plan.activationStatementFile,
    implementationRoot: plan.implementationRoot,
    // The binary the generated job will launch, which is not this installer's
    // own interpreter. Passing process.execPath here would validate the wrong
    // program and pass on a host where the two differ.
    interpreter: plan.nodeBin,
    expectedDigest: plan.activationDigest,
  })
}

export function requireTerminalPublicKey(plan) {
  try {
    assertFileCustody(plan.reviewTerminalPublicKeyFile, 0, 0, 0o644)
  } catch (error) {
    if (error instanceof CustodyPairError) throw error
    // An absent key is the ordinary case before the operator places one, and it
    // must refuse in the installer's own family rather than as a raw ENOENT.
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH,
      `${plan.reviewTerminalPublicKeyFile} is not one root-owned 0644 terminal public key`,
    )
  }
  return canonicalTerminalPublicKey(
    readExactFile(plan.reviewTerminalPublicKeyFile).toString('utf8'),
    plan.reviewTerminalPublicKeyFile,
  )
}

/**
 * Require the optional public control-state file and every ancestor to remain under root custody.
 *
 * @param {Readonly<Record<string, string | number>>} plan validated custody-pair plan
 * @returns {void}
 */
export function requireRootControlStateFile(plan) {
  if (plan.rootControlStateFile === undefined) return
  const path = plan.rootControlStateFile
  try {
    assertFileCustody(path, 0, 0, 0o644)
    if (lstatSync(path).nlink !== 1) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} must have one hard link`)
    }
    for (let parent = dirname(path);; parent = dirname(parent)) {
      assertRootManagedDirectory(parent)
      if (parent === '/') break
    }
  } catch (error) {
    if (error instanceof CustodyPairError) throw error
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} is not one root-owned 0644 public control-state file`)
  }
}

/**
 * Return one canonical Ed25519 public PEM, refusing anything else.
 *
 * Separate from the custody assertion so both halves are reachable: the custody
 * assertion needs root-owned bytes on disk, and this does not.
 *
 * @param {string} pem candidate PEM text
 * @param {string} path path reported in the refusal
 * @returns {string} the same PEM, once it is canonical Ed25519 SPKI
 * @throws {CustodyPairError} on unreadable, non-Ed25519, or non-canonical key material
 */
export function canonicalTerminalPublicKey(pem, path) {
  let key
  try { key = createPublicKey(pem) }
  catch { throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `${path} is not one readable public key`) }
  if (key.asymmetricKeyType !== 'ed25519' || key.export({ type: 'spki', format: 'pem' }).toString() !== pem) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, `${path} is not one canonical Ed25519 public key`)
  }
  return pem
}

/**
 * Assemble public launch inputs after each key is provisioned by its final owner.
 *
 * Exported so a test can drive the real installer-to-generator connection. The
 * installer's phase seam is injectable, so a faked render phase would hide a
 * plan field the generator requires and the installer never supplies.
 *
 * @param {Readonly<Record<string, string | number>>} plan validated custody-pair plan
 * @param {string} rootPublicKeyPem canonical Ed25519 root public key
 * @param {string} brokerPublicKeyPem canonical Ed25519 broker receipt key
 * @returns {Readonly<Record<string, string>>} generator inputs validated against this checkout
 */
export function launchInputs(plan, rootPublicKeyPem, brokerPublicKeyPem) {
  return validateLaunchdInputs({
    brokerLabel: plan.brokerLabel,
    brokerUser: plan.brokerUser,
    brokerGroup: plan.brokerGroup,
    brokerSocket: plan.brokerSocket,
    brokerStateDir: plan.brokerStateDir,
    brokerPublicKeyPem,
    rootPublicKeyPem,
    issuerLabel: plan.issuerLabel,
    issuerUser: plan.issuerUser,
    issuerGroup: plan.issuerGroup,
    issuerSocket: plan.issuerSocket,
    issuerStateDir: plan.issuerStateDir,
    issuerKeyFile: plan.issuerKeyFile,
    implementationRoot: plan.implementationRoot,
    nodeBin: plan.nodeBin,
    reviewSocket: plan.reviewSocket,
    reviewTerminalPublicKeyFile: plan.reviewTerminalPublicKeyFile,
    reviewServerId: plan.reviewServerId,
    activationStatementFile: plan.activationStatementFile,
    activationDigest: plan.activationDigest,
    rendererId: plan.rendererId,
    ...validateMemoryLaunchInputs(plan),
    ...validateApprovalLaunchInputs(plan),
  }, REPO_DIR)
}

/** Prepare and verify every managed directory plus the installed authority bytes. */
function prepareManagedState(plan, apply) {
  ensureManagedParents(apply)
  ensureDirectory(plan.brokerStateDir, { uid: plan.brokerUid, gid: plan.brokerGid, mode: 0o700, apply })
  ensureDirectory(plan.issuerStateDir, { uid: plan.issuerUid, gid: plan.issuerGid, mode: 0o700, apply })
  ensureDirectory(dirname(plan.brokerSocket), { uid: plan.brokerUid, gid: plan.brokerGid, mode: 0o710, apply })
  ensureDirectory(dirname(plan.issuerSocket), { uid: plan.issuerUid, gid: plan.issuerGid, mode: 0o710, apply })
  ensureDirectory(join(MANAGED_STATE_ROOT, 'guest'), {
    uid: plan.guestUid,
    gid: plan.brokerGid,
    mode: 0o700,
    apply,
  })
  return stageAuthority(plan, apply)
}

/** Observe existing labels and refuse any process outside the planned pair. */
function observePreexistingPair(plan) {
  const expectedEntries = expectedJobEntries(plan)
  const jobs = {
    issuer: observeJob(plan.issuerLabel, expectedEntries.issuer),
    broker: observeJob(plan.brokerLabel, expectedEntries.broker),
  }
  for (const [kind, expected] of [
    ['issuer', { uid: plan.issuerUid, gid: plan.issuerGid }],
    ['broker', { uid: plan.brokerUid, gid: plan.brokerGid }],
  ]) {
    const job = jobs[kind]
    if (job !== null && (job.uid !== expected.uid || job.gid !== expected.gid)) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.JOB_PRINCIPAL_MISMATCH, `${kind} job runs under the wrong numeric principal`)
    }
  }
  observeExclusiveProcesses(plan, jobs)
  return { expectedEntries }
}

/** Provision or observe the issuer and broker key material under their final owners. */
function provisionPrincipalIdentities(plan, apply) {
  const brokerKeyDirectory = join(plan.brokerStateDir, 'keys')
  const brokerKeyFile = join(brokerKeyDirectory, 'broker.json')
  if (!apply) {
    for (const path of [plan.issuerKeyFile, brokerKeyFile]) {
      const state = lstatSync(path)
      if (!state.isFile() || state.isSymbolicLink()) {
        throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, `${path} is not an existing exact key file`)
      }
    }
  }
  // Refuses before any property list is rendered or published. The broker
  // cannot start without this key, so an absent or replaceable one must stop
  // the install rather than surface as a respawning daemon.
  requireTerminalPublicKey(plan)
  requireActivationStatement(plan)
  const issuerIdentity = runAsPrincipal(plan, plan.issuerUser, 'issuer-key', plan.issuerKeyFile)
  const brokerIdentity = runAsPrincipal(plan, plan.brokerUser, 'broker-identity', plan.brokerStateDir)
  ensureDirectory(brokerKeyDirectory, { uid: plan.brokerUid, gid: plan.brokerGid, mode: 0o700, apply: false })
  assertFileCustody(plan.issuerKeyFile, plan.issuerUid, plan.issuerGid, 0o600)
  assertFileCustody(brokerKeyFile, plan.brokerUid, plan.brokerGid, 0o600)
  return { issuerIdentity, brokerIdentity, brokerKeyFile }
}

/** Render the exact issuer and broker property lists and their fixed install paths. */
function renderCustodyJobs(plan, principals) {
  const inputs = launchInputs(
    plan,
    principals.issuerIdentity.rootPublicKeyPem,
    principals.brokerIdentity.brokerPublicKeyPem,
  )
  const jobs = renderJobs(inputs)
  lintJobs(jobs)
  return {
    jobs,
    paths: {
      broker: join(plan.launchDaemonDir, `${plan.brokerLabel}.plist`),
      issuer: join(plan.launchDaemonDir, `${plan.issuerLabel}.plist`),
    },
  }
}

/** Observe the live pair and execute every positive and negative custody probe. */
/**
 * Observe one job that launchd has accepted but may not have spawned yet.
 *
 * `launchctl bootstrap` returns before the job's process exists, so a single
 * read right after it reports `loaded but not observed running` on a healthy
 * host. Only that refusal is retried, within the same bound the socket
 * observation already uses; every other refusal is immediate.
 */
async function observeRunningJob(label, expectedEntry) {
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      return observeJob(label, expectedEntry)
    } catch (error) {
      if (!(error instanceof CustodyPairError) || error.reason !== CUSTODY_PAIR_REFUSE.ROUTE_UNOBSERVED || Date.now() >= deadline) throw error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
}

async function observeActivePair(plan, expectedEntries, brokerKeyFile) {
  const issuerJob = await observeRunningJob(plan.issuerLabel, expectedEntries.issuer)
  const brokerJob = await observeRunningJob(plan.brokerLabel, expectedEntries.broker)
  if (issuerJob?.uid !== plan.issuerUid || issuerJob?.gid !== plan.issuerGid
    || brokerJob?.uid !== plan.brokerUid || brokerJob?.gid !== plan.brokerGid) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.JOB_PRINCIPAL_MISMATCH, 'live daemon pid uid or gid does not match its service account')
  }
  observeExclusiveProcesses(plan, { broker: brokerJob, issuer: issuerJob })
  const issuerSocket = await observeSocket(plan.issuerSocket, plan.issuerUid, plan.issuerGid)
  const brokerSocket = await observeSocket(plan.brokerSocket, plan.brokerUid, plan.brokerGid)
  const probeReport = gradeCustodyProbes({
    guestBroker: runAsPrincipal(plan, plan.guestUser, 'probe-socket', plan.brokerSocket),
    brokerIssuer: runAsPrincipal(plan, plan.brokerUser, 'probe-socket', plan.issuerSocket),
    guestIssuer: runAsPrincipal(plan, plan.guestUser, 'probe-socket', plan.issuerSocket),
    issuerBroker: runAsPrincipal(plan, plan.issuerUser, 'probe-socket', plan.brokerSocket),
    issuerKey: runAsPrincipal(plan, plan.issuerUser, 'probe-file', plan.issuerKeyFile),
    brokerKey: runAsPrincipal(plan, plan.brokerUser, 'probe-file', plan.issuerKeyFile),
    guestKey: runAsPrincipal(plan, plan.guestUser, 'probe-file', plan.issuerKeyFile),
    brokerState: runAsPrincipal(plan, plan.brokerUser, 'probe-file', brokerKeyFile),
    guestState: runAsPrincipal(plan, plan.guestUser, 'probe-file', brokerKeyFile),
    issuerState: runAsPrincipal(plan, plan.issuerUser, 'probe-file', brokerKeyFile),
  })
  return { issuerJob, brokerJob, issuerSocket, brokerSocket, probeReport }
}

const REAL_CUSTODY_PHASES = Object.freeze({
  ensureIdentities: (plan, apply) => ensureIdentities(plan, apply),
  prepareManaged: (plan, apply) => prepareManagedState(plan, apply),
  observePreexisting: plan => observePreexistingPair(plan),
  provisionIdentities: (plan, apply) => provisionPrincipalIdentities(plan, apply),
  renderJobs: (plan, principals) => renderCustodyJobs(plan, principals),
  publishJob: (_kind, path, content, apply) => installJob(path, content, apply),
  rollbackPublished: (publications, cause) => rollbackPublishedJobs(publications, cause),
  loadJobs: (plan, paths, apply) => ensureJobsLoaded(plan, paths, apply),
  observeActive: (plan, expectedEntries, brokerKeyFile) => observeActivePair(plan, expectedEntries, brokerKeyFile),
  rollbackLoaded: (labels, cause) => rollbackLoadedJobs(labels, cause),
})

/**
 * Execute the custody-pair sequence without emitting a product status claim.
 *
 * The production entry point supplies the closed real phase set. Tests may pass
 * fake coarse phases to exercise ordering and rollback without mutating macOS.
 *
 * @param {Record<string, unknown>} plan validated custody plan
 * @param {boolean} apply whether absent host state may be created
 * @param {object} phases coarse owned installation operations
 * @returns {Promise<Record<string, unknown>>} internal observations
 */
export async function executeCustodyPairPhases(plan, apply, phases) {
  const identities = phases.ensureIdentities(plan, apply)
  phases.observePreexisting(plan)
  const implementation = phases.prepareManaged(plan, apply)
  const principals = phases.provisionIdentities(plan, apply)
  const preexisting = phases.observePreexisting(plan)
  const rendered = phases.renderJobs(plan, principals)
  const publications = []
  try {
    publications.push(phases.publishJob('issuer', rendered.paths.issuer, rendered.jobs.issuer, apply))
    publications.push(phases.publishJob('broker', rendered.paths.broker, rendered.jobs.broker, apply))
  } catch (error) {
    phases.rollbackPublished(publications, error)
    throw error
  }
  const loaded = phases.loadJobs(plan, rendered.paths, apply)
  try {
    const active = await phases.observeActive(plan, preexisting.expectedEntries, principals.brokerKeyFile)
    return Object.freeze({
      identities,
      implementation,
      receiptKeyId: principals.brokerIdentity.receiptKeyId,
      active,
    })
  } catch (error) {
    if (apply) phases.rollbackLoaded(loaded, error)
    throw error
  }
}

/**
 * Apply or check the bounded installed pair on the live macOS host.
 *
 * @param {unknown} rawPlan candidate plan
 * @param {{apply: boolean, platform?: string, euid?: number}} options execution mode and testable host identity
 * @returns {Promise<Record<string, unknown>>} public observation report
 */
export async function runCustodyPair(rawPlan, { apply, platform = process.platform, euid = process.geteuid?.() } = {}) {
  const plan = validateCustodyPairPlan(rawPlan)
  if (typeof apply !== 'boolean') {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, 'apply must be one explicit boolean')
  }
  if (platform !== 'darwin') {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PLATFORM_UNSUPPORTED, 'launchd custody installation requires macOS')
  }
  if (euid !== 0) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ROOT_REQUIRED, 'launchd custody installation and cross-principal checks require uid 0')
  }
  if (!Number.isInteger(O_NOFOLLOW)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PLATFORM_UNSUPPORTED, 'O_NOFOLLOW is required')
  }
  requireRootControlStateFile(plan)
  assertTrustedExecutable(plan.nodeBin)
  const runtime = measureLaunchdRuntime(plan.nodeBin, plan.nodeSha256)
  const daemonState = lstatSync(plan.launchDaemonDir)
  if (!daemonState.isDirectory() || daemonState.isSymbolicLink() || realpathSync(plan.launchDaemonDir) !== plan.launchDaemonDir
    || daemonState.uid !== 0 || daemonState.gid !== 0 || (daemonState.mode & 0o777) !== 0o755) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH, 'launchDaemonDir must be root:wheel 0755')
  }

  assertRootManagedDirectory(dirname(MANAGED_STATE_ROOT))
  ensureDirectory(MANAGED_STATE_ROOT, { uid: 0, gid: 0, mode: 0o755, apply })
  return withInstallerLock(async () => {
    const observed = await executeCustodyPairPhases(plan, apply, REAL_CUSTODY_PHASES)
    measureLaunchdRuntime(plan.nodeBin, plan.nodeSha256)
    const active = observed.active
    return Object.freeze({
      ok: true,
      status: CUSTODY_PAIR_STATUS,
      issue3Complete: false,
      apply,
      identities: observed.identities,
      jobs: {
        broker: { label: plan.brokerLabel, pid: active.brokerJob.pid, uid: active.brokerJob.uid },
        issuer: { label: plan.issuerLabel, pid: active.issuerJob.pid, uid: active.issuerJob.uid },
      },
      routes: { broker: active.brokerSocket, issuer: active.issuerSocket, probes: active.probeReport },
      implementation: observed.implementation,
      runtime: {
        ...runtime,
        manifestSha256: sha256(canonicalJSON({
          domain: 'aukora:installed-runtime:v1',
          implementationManifestSha256: observed.implementation.manifestSha256,
          node: runtime,
        })),
      },
      receiptKeyId: observed.receiptKeyId,
      blockers: [
        'operational-issuer-key-not-aumlok-control-history',
        'guest-job-unimplemented',
        'parent-activator-unimplemented',
        'human-login-session-approval-unimplemented',
        'standalone-broker-review-channel-unavailable',
        'settled-product-turn-unmeasured',
        'guest-network-deprivation-unmeasured',
        'ambient-supplementary-groups-unconfined',
        'recursive-runtime-closure-and-acl-oracle-unimplemented',
        'loaded-runtime-pages-and-dynamic-libraries-unattested',
        'loaded-launchd-environment-unattested',
      ],
    })
  })
}

/** CLI entry. */
async function main() {
  const argv = process.argv.slice(2)
  const inputsAt = argv.indexOf('--inputs')
  const apply = argv.includes('--apply')
  const check = argv.includes('--check')
  if (argv.length !== 3 || inputsAt !== 0 || (argv[2] !== '--apply' && argv[2] !== '--check')
    || argv[1].startsWith('--') || apply === check) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.ARGUMENTS_NOT_EXACT,
      'usage: install-launchd-custody-pair.mjs --inputs <file.json> (--apply | --check)',
    )
  }
  if (apply) assertInvocationTree()
  let raw
  try {
    raw = parseCustodyPairJson(readFileSync(argv[inputsAt + 1], 'utf8'))
  } catch (error) {
    if (error instanceof CustodyPairError) throw error
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.INPUTS_UNREADABLE, String(error?.message ?? error))
  }
  const report = await runCustodyPair(raw, { apply })
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    const reason = error instanceof CustodyPairError ? error.reason : CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED
    process.stderr.write(`${JSON.stringify({ ok: false, reason, detail: String(error?.message ?? error) })}\n`)
    process.exitCode = 1
  }
}
