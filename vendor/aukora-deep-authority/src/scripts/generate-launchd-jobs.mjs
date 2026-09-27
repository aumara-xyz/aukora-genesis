/**
 * Generate host-specific AUKORA LaunchDaemon jobs from validated install inputs.
 *
 * Usage:
 *   node scripts/generate-launchd-jobs.mjs --inputs <file.json> --out <dir>
 *   node scripts/generate-launchd-jobs.mjs --inputs <file.json> --check
 *
 * `--check` validates the inputs, renders both jobs, and validates each rendered
 * property list with `/usr/bin/plutil -lint`. It does not inspect local accounts,
 * group membership, numeric uids, directory ownership, or loaded jobs.
 */

import { spawnSync } from 'node:child_process'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readKiraPolicy } from '../aukora/broker/broker.mjs'
import { decodeSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import {
  canonicalEd25519PublicKey,
  receiptKeyIdForPublicKey,
} from '../aukora/host-dsh/src/grant.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = resolve(HERE, '..')
const TEMPLATE_DIR = join(REPO_DIR, 'ops', 'launchd')
const PLUTIL = '/usr/bin/plutil'

/** Stable refusal names. Callers match on these values, never on message prose. */
export const LAUNCHD_REFUSE = Object.freeze({
  INPUTS_UNREADABLE: 'launchd:inputs-unreadable',
  INPUTS_NOT_PLAIN: 'launchd:inputs-not-plain',
  FIELD_MISSING: 'launchd:field-missing',
  FIELD_UNKNOWN: 'launchd:field-unknown',
  FIELD_NOT_STRING: 'launchd:field-not-string',
  FIELD_XML_UNSAFE: 'launchd:field-xml-unsafe',
  FIELD_PLACEHOLDER_UNSAFE: 'launchd:field-placeholder-unsafe',
  PATH_NOT_ABSOLUTE: 'launchd:path-not-absolute',
  PATH_NOT_NORMALIZED: 'launchd:path-not-normalized',
  LABEL_UNSAFE: 'launchd:label-unsafe',
  LABELS_COLLAPSE: 'launchd:labels-collapse',
  PRINCIPALS_COLLAPSE: 'launchd:principals-collapse',
  GROUPS_COLLAPSE: 'launchd:groups-collapse',
  SOCKET_PARENTS_COLLAPSE: 'launchd:socket-parents-collapse',
  PUBLIC_KEY_INVALID: 'launchd:public-key-invalid',
  MEMORY_CONFIGURATION_INVALID: 'launchd:memory-configuration-invalid',
  IMPLEMENTATION_INSIDE_CHECKOUT: 'launchd:implementation-inside-checkout',
  SECRET_INSIDE_CHECKOUT: 'launchd:secret-inside-checkout',
  STATE_INSIDE_CHECKOUT: 'launchd:state-inside-checkout',
  KEY_READABLE_BY_BROKER: 'launchd:key-readable-by-broker',
  PLACEHOLDER_UNRESOLVED: 'launchd:placeholder-unresolved',
  TEMPLATE_MISSING: 'launchd:template-missing',
  PLIST_INVALID: 'launchd:plist-invalid',
  OUTPUT_DIR_UNSAFE: 'launchd:output-dir-unsafe',
  OUTPUT_EXISTS: 'launchd:output-exists',
  OUTPUT_WRITE_FAILED: 'launchd:output-write-failed',
  OUTPUT_ROLLBACK_INDETERMINATE: 'launchd:output-rollback-indeterminate',
})

/** A refusal carrying a stable name. */
export class LaunchdGenerateError extends Error {
  /**
   * @param {string} reason one of {@link LAUNCHD_REFUSE}
   * @param {string} detail human-readable specifics
   */
  constructor(reason, detail) {
    super(`${reason} — ${detail}`)
    this.name = 'LaunchdGenerateError'
    this.reason = reason
  }
}

const INPUT_FIELDS = Object.freeze([
  'brokerLabel',
  'brokerUser',
  'brokerGroup',
  'brokerSocket',
  'brokerStateDir',
  'brokerPublicKeyPem',
  'rootPublicKeyPem',
  'issuerLabel',
  'issuerUser',
  'issuerGroup',
  'issuerSocket',
  'issuerStateDir',
  'issuerKeyFile',
  'implementationRoot',
  'nodeBin',
  'reviewSocket',
  'reviewTerminalPublicKeyFile',
  'reviewServerId',
  'activationStatementFile',
  'activationDigest',
  'rendererId',
])

const MEMORY_INPUT_FIELDS = Object.freeze([
  'kiraRecallPolicy',
  'subjectAuthority',
  'rootControlStateFile',
])

const APPROVAL_INPUT_FIELDS = Object.freeze(['issuerApprovalSocket', 'issuerApprovalSocketUid'])

const PATH_FIELDS = Object.freeze([
  'brokerSocket',
  'brokerStateDir',
  'issuerSocket',
  'issuerStateDir',
  'issuerKeyFile',
  'implementationRoot',
  'nodeBin',
  'reviewSocket',
  'reviewTerminalPublicKeyFile',
  'activationStatementFile',
])

const PEM_FIELDS = new Set(['brokerPublicKeyPem', 'rootPublicKeyPem'])
const SAFE_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,126}[A-Za-z0-9])?$/
const TEMPLATE_TOKEN = /@@[A-Z_]+@@/

const PLACEHOLDER = Object.freeze({
  brokerLabel: 'BROKER_LABEL',
  brokerUser: 'BROKER_USER',
  brokerGroup: 'BROKER_GROUP',
  brokerSocket: 'BROKER_SOCKET',
  brokerStateDir: 'BROKER_STATE_DIR',
  rootPublicKeyPem: 'ROOT_PUBLIC_KEY_PEM',
  issuerLabel: 'ISSUER_LABEL',
  issuerUser: 'ISSUER_USER',
  issuerGroup: 'ISSUER_GROUP',
  issuerSocket: 'ISSUER_SOCKET',
  issuerStateDir: 'ISSUER_STATE_DIR',
  issuerKeyFile: 'ISSUER_KEY_FILE',
  implementationRoot: 'IMPLEMENTATION_ROOT',
  expectedReceiptKeyId: 'EXPECTED_RECEIPT_KEY_ID',
  nodeBin: 'NODE_BIN',
  reviewSocket: 'REVIEW_SOCKET',
  reviewTerminalPublicKeyFile: 'REVIEW_TERMINAL_PUBLIC_KEY_FILE',
  reviewServerId: 'REVIEW_SERVER_ID',
  activationDigest: 'ACTIVATION_DIGEST',
  rendererId: 'RENDERER_ID',
})

/**
 * True when lexical path resolution places `candidate` inside `root`.
 *
 * @param {string} candidate absolute path to test
 * @param {string} root absolute directory that must not contain it
 * @returns {boolean} whether `candidate` lies within `root`
 */
export function isInside(candidate, root) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Return whether a code point is valid XML 1.0 element text for this input.
 *
 * @param {number} codePoint Unicode code point
 * @param {boolean} allowLineFeed whether a canonical PEM may contain LF
 * @returns {boolean} whether the code point is accepted
 */
function isAllowedXmlCodePoint(codePoint, allowLineFeed) {
  if (codePoint === 0x0a) return allowLineFeed
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) return false
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false
  if (codePoint > 0x10ffff) return false
  if (codePoint >= 0xfdd0 && codePoint <= 0xfdef) return false
  if ((codePoint & 0xffff) === 0xfffe || (codePoint & 0xffff) === 0xffff) return false
  if (codePoint === 0x061c || codePoint === 0x200b || codePoint === 0x200e || codePoint === 0x200f) return false
  if (codePoint >= 0x202a && codePoint <= 0x202e) return false
  if (codePoint >= 0x2060 && codePoint <= 0x206f) return false
  return codePoint !== 0xfeff
}

/**
 * Refuse XML-forbidden or display-control code points before interpolation.
 *
 * @param {string} field input field name
 * @param {string} value input value
 * @returns {void}
 */
function validateXmlText(field, value) {
  for (const character of value) {
    if (field === 'kiraRecallPolicy' && ['\t', '\n', '\r'].includes(character)) continue
    if (!isAllowedXmlCodePoint(character.codePointAt(0), PEM_FIELDS.has(field))) {
      throw new LaunchdGenerateError(
        LAUNCHD_REFUSE.FIELD_XML_UNSAFE,
        `inputs.${field} contains a forbidden XML or display-control code point`,
      )
    }
  }
  if (TEMPLATE_TOKEN.test(value)) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.FIELD_PLACEHOLDER_UNSAFE,
      `inputs.${field} contains reserved template-token syntax`,
    )
  }
}

/**
 * Snapshot an exact JSON-like object of own enumerable data properties.
 *
 * @param {unknown} raw candidate inputs
 * @returns {Record<string, string>} one-read string snapshot
 */
function snapshotInputs(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.INPUTS_NOT_PLAIN, 'inputs must be one plain object')
  }
  const prototype = Object.getPrototypeOf(raw)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.INPUTS_NOT_PLAIN, 'inputs must have a plain-object prototype')
  }

  const ownKeys = Reflect.ownKeys(raw)
  for (const key of ownKeys) {
    if (typeof key !== 'string' || (!INPUT_FIELDS.includes(key) && !MEMORY_INPUT_FIELDS.includes(key) && !APPROVAL_INPUT_FIELDS.includes(key))) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_UNKNOWN, `inputs contains unknown field ${String(key)}`)
    }
  }
  for (const field of INPUT_FIELDS) {
    if (!ownKeys.includes(field)) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_MISSING, `inputs.${field} is required`)
    }
  }

  const snapshot = Object.create(null)
  for (const field of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, field)
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.INPUTS_NOT_PLAIN, `inputs.${field} must be an enumerable data property`)
    }
    if (typeof descriptor.value !== 'string' || descriptor.value === '') {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_NOT_STRING, `inputs.${field} must be a non-empty string`)
    }
    validateXmlText(field, descriptor.value)
    snapshot[field] = descriptor.value
  }
  return snapshot
}

/**
 * Validate an optional complete memory bundle against its selected subject and activation.
 *
 * @param {Record<string, unknown>} inputs snapshotted input data properties
 * @returns {Readonly<Record<string, string>>} the original explicit strings, or an empty record
 */
export function validateMemoryLaunchInputs(inputs) {
  if (!MEMORY_INPUT_FIELDS.some(field => Object.hasOwn(inputs, field))) return Object.freeze({})
  const bundle = {}
  for (const field of MEMORY_INPUT_FIELDS) {
    if (!Object.hasOwn(inputs, field)) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_MISSING, `inputs.${field} is required with memory configuration`)
    }
    if (typeof inputs[field] !== 'string' || inputs[field] === '') {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_NOT_STRING, `inputs.${field} must be a non-empty string`)
    }
    validateXmlText(field, inputs[field])
    bundle[field] = inputs[field]
  }
  if (!isAbsolute(bundle.rootControlStateFile)) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.PATH_NOT_ABSOLUTE, 'inputs.rootControlStateFile must be an absolute path')
  }
  try {
    const policy = readKiraPolicy(JSON.parse(bundle.kiraRecallPolicy))
    const authority = decodeSubjectAuthorityContext(bundle.subjectAuthority)
    if (authority.subject !== policy.subject) {
      throw new TypeError('subjectAuthority.subject must equal kiraRecallPolicy.subject')
    }
    if (authority.activationDigest !== inputs.activationDigest) {
      throw new TypeError('subjectAuthority.activationDigest must equal activationDigest')
    }
  } catch (error) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.MEMORY_CONFIGURATION_INVALID, String(error?.message ?? error))
  }
  return Object.freeze(bundle)
}

/**
 * Validate the optional issuer prompt transport; neither field grants approval.
 * @param {Record<string, unknown>} inputs snapshotted input fields
 * @returns {Readonly<Record<string, string>>} both explicit fields, or an empty record
 */
export function validateApprovalLaunchInputs(inputs) {
  if (!APPROVAL_INPUT_FIELDS.some(field => Object.hasOwn(inputs, field))) return Object.freeze({})
  const bundle = {}
  for (const field of APPROVAL_INPUT_FIELDS) {
    if (!Object.hasOwn(inputs, field)) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_MISSING, `inputs.${field} is required with issuer approval transport`)
    }
    if (typeof inputs[field] !== 'string' || inputs[field] === '') {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_NOT_STRING, `inputs.${field} must be a non-empty string`)
    }
    validateXmlText(field, inputs[field])
    bundle[field] = inputs[field]
  }
  if (!isAbsolute(bundle.issuerApprovalSocket)) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.PATH_NOT_ABSOLUTE, 'issuerApprovalSocket must be absolute')
  }
  if (normalize(bundle.issuerApprovalSocket) !== bundle.issuerApprovalSocket) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.PATH_NOT_NORMALIZED, 'issuerApprovalSocket must be normalized')
  }
  if (!/^(?:0|[1-9][0-9]{0,9})$/u.test(bundle.issuerApprovalSocketUid) || Number(bundle.issuerApprovalSocketUid) > 4294967294) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.FIELD_NOT_STRING, 'issuerApprovalSocketUid must be a canonical Unix uid')
  }
  return Object.freeze(bundle)
}

/**
 * Validate exact install inputs and derive the issuer's expected receipt key id.
 *
 * @param {unknown} raw parsed inputs document
 * @param {string} repoDir absolute path of the checkout being validated
 * @returns {Record<string, string>} frozen validated inputs and derived receipt key id
 */
export function validateInputs(raw, repoDir) {
  const inputs = snapshotInputs(raw)
  const memory = validateMemoryLaunchInputs(inputs)
  const approval = validateApprovalLaunchInputs(inputs)
  if (approval.issuerApprovalSocket !== undefined) {
    const path = approval.issuerApprovalSocket
    if ([repoDir, inputs.brokerStateDir, inputs.issuerStateDir].some(root => isInside(path, root))) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT, 'issuerApprovalSocket must be outside the checkout and daemon state')
    }
    if ([inputs.brokerSocket, inputs.issuerSocket, inputs.reviewSocket].some(route => resolve(route) === resolve(path))) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.SOCKET_PARENTS_COLLAPSE, 'issuerApprovalSocket must be a separate operator transport')
    }
  }
  if (memory.rootControlStateFile !== undefined && isInside(memory.rootControlStateFile, repoDir)) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT, 'inputs.rootControlStateFile is lexically inside the checkout')
  }

  for (const field of PATH_FIELDS) {
    if (!isAbsolute(inputs[field])) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.PATH_NOT_ABSOLUTE, `inputs.${field} must be an absolute path`)
    }
  }

  for (const field of ['brokerLabel', 'issuerLabel']) {
    if (!SAFE_LABEL.test(inputs[field]) || inputs[field].includes('..')) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.LABEL_UNSAFE, `inputs.${field} is not a launchd-safe basename`)
    }
  }
  if (inputs.brokerLabel === inputs.issuerLabel) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.LABELS_COLLAPSE, 'brokerLabel and issuerLabel must differ')
  }

  if (inputs.brokerUser.toLocaleLowerCase('en-US') === inputs.issuerUser.toLocaleLowerCase('en-US')) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.PRINCIPALS_COLLAPSE,
      'brokerUser and issuerUser must name distinct accounts; numeric uid separation remains an installation check',
    )
  }
  if (inputs.brokerGroup.toLocaleLowerCase('en-US') === inputs.issuerGroup.toLocaleLowerCase('en-US')) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.GROUPS_COLLAPSE,
      'brokerGroup and issuerGroup must remain distinct route peer sets',
    )
  }

  if (resolve(dirname(inputs.brokerSocket)) === resolve(dirname(inputs.issuerSocket))) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.SOCKET_PARENTS_COLLAPSE,
      'brokerSocket and issuerSocket must have distinct parent directories',
    )
  }
  // The generator is also a standalone operator entry point, so it pins the
  // route identity itself rather than leaving a malformed one to refuse at
  // daemon startup, after the property lists are already installed.
  for (const field of ['reviewServerId', 'activationDigest', 'rendererId']) {
    if (!/^[0-9a-f]{64}$/u.test(inputs[field])) {
      throw new LaunchdGenerateError(
        LAUNCHD_REFUSE.FIELD_NOT_STRING,
        `${field} must be a lowercase 64-character hex identity`,
      )
    }
  }
  // The review route deliberately shares the broker's route parent, so parents
  // are not compared here; the routes themselves must still be distinct nodes.
  if (resolve(inputs.reviewSocket) === resolve(inputs.brokerSocket)
    || resolve(inputs.reviewSocket) === resolve(inputs.issuerSocket)) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.SOCKET_PARENTS_COLLAPSE,
      'reviewSocket must not collide with the broker or issuer route',
    )
  }

  const brokerPublicKey = canonicalEd25519PublicKey(inputs.brokerPublicKeyPem)
  const rootPublicKey = canonicalEd25519PublicKey(inputs.rootPublicKeyPem)
  if (brokerPublicKey === null) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.PUBLIC_KEY_INVALID, 'brokerPublicKeyPem is not canonical Ed25519 public PEM')
  }
  if (rootPublicKey === null) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.PUBLIC_KEY_INVALID, 'rootPublicKeyPem is not canonical Ed25519 public PEM')
  }

  if (isInside(inputs.implementationRoot, repoDir)) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.IMPLEMENTATION_INSIDE_CHECKOUT,
      `implementationRoot is lexically inside ${repoDir}`,
    )
  }
  for (const field of ['reviewSocket', 'reviewTerminalPublicKeyFile', 'activationStatementFile']) {
    if (isInside(inputs[field], repoDir)) {
      throw new LaunchdGenerateError(
        LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT,
        `inputs.${field} is lexically inside ${repoDir}`,
      )
    }
  }
  // The broker reads the terminal public key at startup. Inside brokerStateDir
  // it could also replace it, and a replaced terminal key is an approval the
  // broker signs to itself.
  if (isInside(inputs.reviewTerminalPublicKeyFile, inputs.brokerStateDir)) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.KEY_READABLE_BY_BROKER,
      'reviewTerminalPublicKeyFile is lexically inside brokerStateDir',
    )
  }
  if (isInside(inputs.issuerKeyFile, repoDir)) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.SECRET_INSIDE_CHECKOUT,
      `issuerKeyFile is lexically inside ${repoDir}`,
    )
  }
  for (const field of ['brokerStateDir', 'issuerStateDir']) {
    if (isInside(inputs[field], repoDir)) {
      throw new LaunchdGenerateError(
        LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT,
        `inputs.${field} is lexically inside ${repoDir}`,
      )
    }
  }
  if (isInside(inputs.issuerKeyFile, inputs.brokerStateDir)) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.KEY_READABLE_BY_BROKER,
      'issuerKeyFile is lexically inside brokerStateDir',
    )
  }

  return Object.freeze({
    ...inputs,
    expectedReceiptKeyId: receiptKeyIdForPublicKey(brokerPublicKey),
  })
}

/**
 * Escape a validated value for XML element text.
 *
 * @param {string} value validated text
 * @returns {string} escaped text
 */
function escapeXmlText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Resolve one template against validated inputs.
 *
 * @param {string} template template text containing `@@NAME@@` placeholders
 * @param {Record<string, string>} inputs validated inputs
 * @returns {string} resolved property list
 */
export function renderTemplate(template, inputs) {
  const replacements = new Map(Object.entries(PLACEHOLDER).map(([field, name]) => [
    name,
    inputs[field],
  ]))
  const out = template.replace(/@@([A-Z_]+)@@/g, (token, name) => {
    if (name === 'ISSUER_APPROVAL_ENVIRONMENT') {
      const approval = validateApprovalLaunchInputs(inputs)
      return Object.entries({
        issuerApprovalSocket: 'AUKORA_ISSUER_APPROVAL_SOCKET',
        issuerApprovalSocketUid: 'AUKORA_ISSUER_APPROVAL_SOCKET_UID',
      }).flatMap(([field, environment]) => approval[field] === undefined ? [] : [
        `    <key>${environment}</key>\n    <string>${escapeXmlText(approval[field])}</string>\n`,
      ]).join('')
    }
    if (name === 'MEMORY_ENVIRONMENT') {
      const memory = validateMemoryLaunchInputs(inputs)
      return Object.entries({
        kiraRecallPolicy: 'AUKORA_KIRA_RECALL_POLICY',
        subjectAuthority: 'AUKORA_SUBJECT_AUTHORITY_B64',
        rootControlStateFile: 'AUKORA_ROOT_CONTROL_STATE_FILE',
      }).flatMap(([field, environment]) => memory[field] === undefined ? [] : [
        `    <key>${environment}</key>\n    <string>${escapeXmlText(memory[field])}</string>\n`,
      ]).join('')
    }
    const value = replacements.get(name)
    return value === undefined ? token : escapeXmlText(value)
  })
  const leftover = out.match(/@@[A-Z_]+@@/g)
  if (leftover !== null) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.PLACEHOLDER_UNRESOLVED,
      `unresolved placeholders survive rendering: ${[...new Set(leftover)].join(', ')}`,
    )
  }
  return out
}

/**
 * Read a template from `ops/launchd/`.
 *
 * @param {string} name template basename
 * @returns {string} template text
 */
function readTemplate(name) {
  const path = join(TEMPLATE_DIR, name)
  if (!existsSync(path)) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.TEMPLATE_MISSING, `no template at ${path}`)
  }
  return readFileSync(path, 'utf8')
}

/**
 * Render both jobs from already validated inputs.
 *
 * @param {Record<string, string>} inputs validated inputs
 * @returns {{broker: string, issuer: string}} resolved property lists
 */
export function renderJobs(inputs) {
  return {
    broker: renderTemplate(readTemplate('com.aukora.broker.plist.template'), inputs),
    issuer: renderTemplate(readTemplate('com.aukora.issuer.plist.template'), inputs),
  }
}

/**
 * Validate each rendered property list with the host plist parser.
 *
 * @param {{broker: string, issuer: string}} jobs rendered property lists
 * @returns {void}
 */
export function lintJobs(jobs) {
  for (const [name, plist] of Object.entries(jobs)) {
    const result = spawnSync(PLUTIL, ['-lint', '-'], { input: plist, encoding: 'utf8' })
    if (result.error !== undefined || result.status !== 0) {
      const detail = result.error?.message ?? (result.stderr.trim() || `exit ${String(result.status)}`)
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.PLIST_INVALID, `${name}: ${detail}`)
    }
  }
}

/**
 * Refuse unsafe output directories and pre-existing or linked output leaves.
 *
 * @param {string} outDir absolute normalized output directory
 * @param {Record<string, string>} inputs validated inputs
 * @param {{broker: string, issuer: string}} jobs rendered property lists
 * @returns {string[]} paths written with exclusive, no-follow creation
 */
export function writeExclusiveJobs(outDir, inputs, jobs) {
  if (!isAbsolute(outDir) || resolve(outDir) !== outDir) {
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.OUTPUT_DIR_UNSAFE,
      'output directory must be an absolute normalized path without traversal',
    )
  }

  try {
    mkdirSync(outDir, { recursive: true, mode: 0o700 })
    const stat = lstatSync(outDir)
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(outDir) !== outDir) {
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.OUTPUT_DIR_UNSAFE, `${outDir} is not a direct directory`)
    }
  } catch (error) {
    if (error instanceof LaunchdGenerateError) throw error
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.OUTPUT_DIR_UNSAFE, `${outDir}: ${String(error?.message ?? error)}`)
  }

  const paths = [
    join(outDir, `${inputs.brokerLabel}.plist`),
    join(outDir, `${inputs.issuerLabel}.plist`),
  ]
  for (const path of paths) {
    try {
      lstatSync(path)
      throw new LaunchdGenerateError(LAUNCHD_REFUSE.OUTPUT_EXISTS, `${path} already exists`)
    } catch (error) {
      if (error instanceof LaunchdGenerateError) throw error
      if (error?.code !== 'ENOENT') {
        throw new LaunchdGenerateError(LAUNCHD_REFUSE.OUTPUT_WRITE_FAILED, `${path}: ${String(error?.message ?? error)}`)
      }
    }
  }

  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  const created = []
  let activePath = outDir
  try {
    for (const [index, path] of paths.entries()) {
      activePath = path
      let descriptor
      try {
        descriptor = openSync(path, flags, 0o644)
        const output = { path, dev: undefined, ino: undefined }
        created.push(output)
        const stat = fstatSync(descriptor)
        output.dev = stat.dev
        output.ino = stat.ino
        writeFileSync(descriptor, index === 0 ? jobs.broker : jobs.issuer, 'utf8')
      } finally {
        if (descriptor !== undefined) closeSync(descriptor)
      }
    }
  } catch (error) {
    const rollbackFailures = []
    for (const output of created.toReversed()) {
      if (output.dev === undefined || output.ino === undefined) {
        rollbackFailures.push(`${output.path}: created output identity is unavailable`)
        continue
      }
      let observed
      try {
        observed = lstatSync(output.path)
      } catch (rollbackError) {
        if (rollbackError?.code === 'ENOENT') continue
        rollbackFailures.push(`${output.path}: ${String(rollbackError?.message ?? rollbackError)}`)
        continue
      }
      if (observed.dev !== output.dev || observed.ino !== output.ino || !observed.isFile()) {
        rollbackFailures.push(`${output.path}: created output inode identity changed`)
        continue
      }
      try {
        unlinkSync(output.path)
      } catch (rollbackError) {
        rollbackFailures.push(`${output.path}: ${String(rollbackError?.message ?? rollbackError)}`)
      }
    }

    if (rollbackFailures.length > 0) {
      throw new LaunchdGenerateError(
        LAUNCHD_REFUSE.OUTPUT_ROLLBACK_INDETERMINATE,
        `write failed (${String(error?.message ?? error)}); cleanup could not be proven: ${rollbackFailures.join('; ')}`,
      )
    }
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw new LaunchdGenerateError(
        LAUNCHD_REFUSE.OUTPUT_EXISTS,
        `${activePath} already exists or is a symbolic link`,
      )
    }
    throw new LaunchdGenerateError(
      LAUNCHD_REFUSE.OUTPUT_WRITE_FAILED,
      `${activePath}: ${String(error?.message ?? error)}`,
    )
  }
  return paths
}

/**
 * Build the check-only report without claiming observed uid or group state.
 *
 * @param {Record<string, string>} inputs validated inputs
 * @param {string} repoDir absolute checkout path
 * @returns {Record<string, string | boolean>} check report
 */
export function checkReport(inputs, repoDir = REPO_DIR) {
  return {
    ok: true,
    brokerUser: inputs.brokerUser,
    issuerUser: inputs.issuerUser,
    distinctPrincipalNames: inputs.brokerUser !== inputs.issuerUser,
    distinctRouteGroupNames: inputs.brokerGroup !== inputs.issuerGroup,
    distinctSocketParents: resolve(dirname(inputs.brokerSocket)) !== resolve(dirname(inputs.issuerSocket)),
    expectedReceiptKeyId: inputs.expectedReceiptKeyId,
    implementationRootLexicallyOutsideCheckout: !isInside(inputs.implementationRoot, repoDir),
    issuerKeyPathLexicallyOutsideCheckout: !isInside(inputs.issuerKeyFile, repoDir),
    plutilLinted: true,
  }
}

/** CLI entry: validate, render, lint, and either report or write. */
function main() {
  const argv = process.argv.slice(2)
  const read = (flag) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const inputsPath = read('--inputs')
  const outDir = read('--out')
  const checkOnly = argv.includes('--check')

  if (inputsPath === undefined || (outDir === undefined && !checkOnly) || (outDir !== undefined && checkOnly)) {
    process.stderr.write('usage: generate-launchd-jobs.mjs --inputs <file.json> (--out <dir> | --check)\n')
    process.exit(2)
  }

  let raw
  try {
    raw = JSON.parse(readFileSync(inputsPath, 'utf8'))
  } catch (error) {
    throw new LaunchdGenerateError(LAUNCHD_REFUSE.INPUTS_UNREADABLE, `${inputsPath}: ${String(error?.message ?? error)}`)
  }

  const inputs = validateInputs(raw, REPO_DIR)
  const jobs = renderJobs(inputs)
  lintJobs(jobs)

  if (checkOnly) {
    process.stdout.write(`${JSON.stringify(checkReport(inputs))}\n`)
    return
  }

  const wrote = writeExclusiveJobs(outDir, inputs, jobs)
  process.stdout.write(`${JSON.stringify({ ok: true, wrote })}\n`)
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('generate-launchd-jobs.mjs')) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    process.exit(1)
  }
}
