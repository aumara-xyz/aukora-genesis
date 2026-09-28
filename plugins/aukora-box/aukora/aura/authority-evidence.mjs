/**
 * Versioned subject-authority evidence retained beside Aura v1.
 *
 * Aura record-entry v1 has a frozen field inventory. A subject-bound v5
 * settlement therefore writes one separate closed record named by the Aura
 * entry hash instead of adding fields to that entry. The record is a broker
 * statement, not an authority artifact or an independent custody domain.
 *
 * @module @aukora/aura/authority-evidence
 */
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { GRANT_DOMAIN_V5 } from '../host-dsh/src/grant-v5.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
  readExactAtom,
  readNonNegativeInteger,
} from '../identity/validation.mjs'

/** Domain separating v5 subject evidence from Aura entries and authority artifacts. */
export const AUTHORITY_EVIDENCE_DOMAIN = 'aukora:aura-authority-evidence:v1'

/** Private directory containing one evidence record per subject-bound Aura entry. */
export const AUTHORITY_EVIDENCE_DIRECTORY = 'authority-evidence'

/** Exact serialized fields in one v1 authority-evidence record. */
export const AUTHORITY_EVIDENCE_KEYS = Object.freeze([
  'domain',
  'auraChainHash',
  'grantDomain',
  'subject',
  'parentDigest',
  'delegationDigest',
  'controlDigest',
  'activationDigest',
  'audience',
  'resource',
  'budget',
  'authorizationDigest',
])

const AUTHORITY_KEYS = Object.freeze([
  'grantDomain',
  'subject',
  'parentDigest',
  'delegationDigest',
  'controlDigest',
  'activationDigest',
  'audience',
  'resource',
  'budget',
  'authorizationDigest',
])
const BUDGET_KEYS = Object.freeze(['calls', 'bytes', 'computeMs', 'costMicrounits'])
const EVIDENCE_FILE = /^([0-9a-f]{64})\.json$/u

/** Named authority-evidence persistence and verification failures. */
export const AUTHORITY_EVIDENCE_REFUSE = Object.freeze({
  DIRECTORY_MALFORMED: 'authority-evidence:directory-malformed',
  ENTRY_MALFORMED: 'authority-evidence:entry-malformed',
  UNKNOWN_AURA_ENTRY: 'authority-evidence:unknown-aura-entry',
  ALREADY_EXISTS: 'authority-evidence:already-exists',
  UNAVAILABLE: 'authority-evidence:unavailable',
  MISMATCH: 'authority-evidence:mismatch',
})

function readBudget(value, label) {
  const fields = readClosedDataRecord(value, BUDGET_KEYS, label)
  return Object.freeze({
    calls: readNonNegativeInteger(fields.calls, `${label}.calls`),
    bytes: readNonNegativeInteger(fields.bytes, `${label}.bytes`),
    computeMs: readNonNegativeInteger(fields.computeMs, `${label}.computeMs`),
    costMicrounits: readNonNegativeInteger(fields.costMicrounits, `${label}.costMicrounits`),
  })
}

function readAuthority(value, label) {
  const fields = readClosedDataRecord(value, AUTHORITY_KEYS, label)
  if (fields.grantDomain !== GRANT_DOMAIN_V5) {
    throw new TypeError(`${label}.grantDomain: must be ${GRANT_DOMAIN_V5}`)
  }
  return Object.freeze({
    grantDomain: GRANT_DOMAIN_V5,
    subject: readAukoraId(fields.subject, `${label}.subject`),
    parentDigest: readDigest(fields.parentDigest, `${label}.parentDigest`),
    delegationDigest: readDigest(fields.delegationDigest, `${label}.delegationDigest`),
    controlDigest: readDigest(fields.controlDigest, `${label}.controlDigest`),
    activationDigest: readDigest(fields.activationDigest, `${label}.activationDigest`),
    audience: readExactAtom(fields.audience, `${label}.audience`, 256),
    resource: readExactAtom(fields.resource, `${label}.resource`, 256),
    budget: readBudget(fields.budget, `${label}.budget`),
    authorizationDigest: readDigest(
      fields.authorizationDigest,
      `${label}.authorizationDigest`,
    ),
  })
}

/**
 * Build one detached v1 evidence record from a successful v5 admission.
 * @param {object} params - retained Aura association and verified authority evidence.
 * @param {string} params.auraChainHash - hash of the exact Aura v1 entry.
 * @param {unknown} params.authority - successful v5 verifier authority projection.
 * @returns {Readonly<Record<string, unknown>>} closed evidence record.
 */
export function createAuthorityEvidence({ auraChainHash, authority }) {
  const exactAuraChainHash = readDigest(auraChainHash, 'authority evidence.auraChainHash')
  const exactAuthority = readAuthority(authority, 'authority evidence authority')
  return Object.freeze({
    domain: AUTHORITY_EVIDENCE_DOMAIN,
    auraChainHash: exactAuraChainHash,
    ...exactAuthority,
  })
}

/**
 * Parse one serialized authority-evidence record without accepting extra fields.
 * @param {unknown} value - candidate record.
 * @returns {Readonly<Record<string, unknown>>} validated evidence record.
 */
export function readAuthorityEvidence(value) {
  const fields = readClosedDataRecord(value, AUTHORITY_EVIDENCE_KEYS, 'authority evidence')
  if (fields.domain !== AUTHORITY_EVIDENCE_DOMAIN) {
    throw new TypeError(`authority evidence.domain: must be ${AUTHORITY_EVIDENCE_DOMAIN}`)
  }
  const authority = {}
  for (const key of AUTHORITY_KEYS) authority[key] = fields[key]
  return createAuthorityEvidence({
    auraChainHash: fields.auraChainHash,
    authority,
  })
}

/**
 * Return the deterministic file path for one Aura-linked authority record.
 * @param {string} stateDir - broker-owned state directory.
 * @param {string} auraChainHash - Aura entry hash.
 * @returns {string} evidence file path.
 */
export function authorityEvidencePath(stateDir, auraChainHash) {
  const exact = readDigest(auraChainHash, 'authority evidence path hash')
  return join(stateDir, AUTHORITY_EVIDENCE_DIRECTORY, `${exact}.json`)
}

function ensureEvidenceDirectory(stateDir) {
  const directory = join(stateDir, AUTHORITY_EVIDENCE_DIRECTORY)
  let created = false
  try {
    mkdirSync(directory, { mode: 0o700 })
    created = true
  } catch (error) {
    if (error?.code !== 'EEXIST') throw new Error(AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE)
  }
  let state
  try {
    state = lstatSync(directory)
  } catch {
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE)
  }
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || state.uid !== euid
    || (state.mode & 0o777) !== 0o700) {
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.DIRECTORY_MALFORMED)
  }
  if (created) syncDirectory(stateDir)
  return directory
}

function syncDirectory(directory) {
  let descriptor
  try {
    descriptor = openSync(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
    fsyncSync(descriptor)
  } catch {
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * Persist one subject-authority record after its Aura v1 entry exists.
 * @param {object} params - broker state and verified evidence.
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {string} params.auraChainHash - hash of the exact Aura v1 entry.
 * @param {unknown} params.authority - successful v5 verifier authority projection.
 * @returns {{path: string, record: Readonly<Record<string, unknown>>}} retained record.
 */
export function writeAuthorityEvidence({ stateDir, auraChainHash, authority }) {
  const record = createAuthorityEvidence({ auraChainHash, authority })
  const directory = ensureEvidenceDirectory(stateDir)
  const path = authorityEvidencePath(stateDir, record.auraChainHash)
  let descriptor
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    writeFileSync(descriptor, `${canonicalJSON(record)}\n`, 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(AUTHORITY_EVIDENCE_REFUSE.ALREADY_EXISTS)
    if (error?.message?.startsWith('authority-evidence:')) throw error
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  syncDirectory(directory)
  return { path, record }
}

function readEvidenceFile(file) {
  let descriptor
  let raw
  try {
    const state = lstatSync(file)
    const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
    if (!state.isFile()
      || state.isSymbolicLink()
      || state.uid !== euid
      || (state.mode & 0o777) !== 0o600) {
      throw new Error(AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED)
    }
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED)
    }
    raw = readFileSync(descriptor, 'utf8')
  } catch (error) {
    if (error?.message === AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED) throw error
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n')) {
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED)
  }
  try {
    const record = readAuthorityEvidence(JSON.parse(raw))
    if (`${canonicalJSON(record)}\n` !== raw) {
      throw new Error(AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED)
    }
    return record
  } catch (error) {
    if (error?.message === AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED) throw error
    throw new Error(AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED)
  }
}

/**
 * Reopen the exact authority record required by one successful v5 admission.
 * @param {object} params - broker state and admitted authority.
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {string} params.auraChainHash - newly appended Aura entry hash.
 * @param {unknown} params.authority - successful verifier's authority projection.
 * @returns {{ok: true} | {ok: false, reason: string}} exact retained-record verdict.
 */
export function verifyAuthorityEvidence({ stateDir, auraChainHash, authority }) {
  const expected = createAuthorityEvidence({ auraChainHash, authority })
  let retained
  try {
    retained = readEvidenceFile(authorityEvidencePath(stateDir, auraChainHash))
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
  return canonicalJSON(retained) === canonicalJSON(expected)
    ? { ok: true }
    : { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.MISMATCH }
}

/**
 * Verify every retained evidence file against the live Aura entry inventory.
 * @param {object} params - broker state and verified Aura entry hashes.
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {ReadonlySet<string>} params.auraChainHashes - hashes from verified Aura bytes.
 * @returns {{ok: true, count: number} | {ok: false, reason: string}} verdict.
 */
export function verifyAuthorityEvidenceDirectory({ stateDir, auraChainHashes }) {
  const directory = join(stateDir, AUTHORITY_EVIDENCE_DIRECTORY)
  let state
  try {
    state = lstatSync(directory)
  } catch (error) {
    return error?.code === 'ENOENT'
      ? { ok: true, count: 0 }
      : { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE }
  }
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || state.uid !== euid
    || (state.mode & 0o777) !== 0o700) {
    return { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.DIRECTORY_MALFORMED }
  }
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.UNAVAILABLE }
  }
  for (const entry of entries) {
    const match = EVIDENCE_FILE.exec(entry.name)
    if (!entry.isFile() || match === null) {
      return { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED }
    }
    let record
    try {
      record = readEvidenceFile(join(directory, entry.name))
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
    if (record.auraChainHash !== match[1]) {
      return { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.ENTRY_MALFORMED }
    }
    if (!auraChainHashes.has(record.auraChainHash)) {
      return { ok: false, reason: AUTHORITY_EVIDENCE_REFUSE.UNKNOWN_AURA_ENTRY }
    }
  }
  return { ok: true, count: entries.length }
}
