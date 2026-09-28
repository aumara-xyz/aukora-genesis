/**
 * The receipt: signed post-dispatch evidence, not permission for an effect.
 *
 * A grant is a statement about the future — someone authorised this call. It
 * is true the moment it is signed and stays true whether or not anything
 * runs, so a grant can be produced in advance and proves nothing about what
 * occurred.
 *
 * A receipt binds the broker's post-dispatch observation: the inode and
 * modification time reported by the filesystem plus the digest and length of
 * the bytes at the content-addressed object path. The object may have existed
 * before an idempotent call, so these fields do not prove that this call
 * created it. Re-observation can expose later replacement or mutation; the
 * settlement court measures that narrower property.
 *
 * What this is NOT: proof about the world. The broker attests to its own
 * work, which is the trusted base under test, not an independent witness.
 * Call this postcondition evidence and nothing larger.
 *
 * @module @aukora/broker/receipt
 */
import { createHash, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { canonicalEd25519PublicKey, payloadDigest } from '../host-dsh/src/grant.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { CONFINEMENT_CLASS, classAtLeast, snapshotConfinementField } from './confinement.mjs'

/** Domain separation: a receipt preimage can never collide with a grant preimage. */
export const RECEIPT_DOMAIN = 'aukora:settlement-receipt:v1'

/** Named refusals for receipt verification. */
export const RECEIPT_REFUSE = Object.freeze({
  MALFORMED: 'receipt:malformed',
  BAD_SIGNATURE: 'receipt:signature-invalid',
  KEY_TYPE: 'receipt:key-not-ed25519',
  // Wire name retained: it means the named object is absent at re-observation,
  // not that the verifier proved the effect never ran.
  GONE: 'receipt:effect-absent',
  UNOBSERVABLE: 'receipt:effect-unobservable',
  CONTENT_MISMATCH: 'receipt:content-mismatch',
  INODE_MISMATCH: 'receipt:inode-mismatch',
  MTIME_MISMATCH: 'receipt:mtime-mismatch',
  CONFINEMENT_INSUFFICIENT: 'receipt:confinement-insufficient',
  DIRECTORY_MALFORMED: 'receipt:directory-malformed',
  ENTRY_MALFORMED: 'receipt:entry-malformed',
  UNKNOWN_AURA_ENTRY: 'receipt:unknown-aura-entry',
  MISSING_AURA_RECEIPT: 'receipt:missing-aura-receipt',
  ALREADY_EXISTS: 'receipt:already-exists',
  UNAVAILABLE: 'receipt:unavailable',
  MISMATCH: 'receipt:mismatch',
})

/** The fields a receipt signature covers, in order. Frozen: order is the preimage. */
export const RECEIPT_FIELDS = Object.freeze([
  'requestDigest', 'definitionId', 'nonce', 'sequence', 'path', 'bytes', 'contentSha256', 'inode', 'mtimeNs',
  'confinement',
])

/** The exact own data fields a receipt may carry. */
const RECEIPT_KEYS = Object.freeze([...RECEIPT_FIELDS, 'signature'])
const HEX_SHA256 = /^[0-9a-f]{64}$/
const SAFE_NONCE = /^[a-zA-Z0-9_-]{1,128}$/
const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/

/**
 * The bytes a receipt signature is taken over.
 *
 * Serialized with the record's own canonicalization rather than
 * `JSON.stringify`, because `confinement` is an OBJECT: a receipt that
 * round-trips through JSON must hash the same whatever order a parser hands
 * back its keys.
 *
 * @param {Record<string, unknown>} claims - a receipt without its signature.
 * @returns {Buffer} the preimage.
 */
export function receiptPreimage(claims) {
  const ordered = RECEIPT_FIELDS.map((k) => [k, claims[k] ?? null])
  return Buffer.from(`${RECEIPT_DOMAIN}\n${canonicalJSON(ordered)}`, 'utf8')
}

/**
 * Sign a receipt over evidence gathered after dispatch returned.
 *
 * @param {object} params
 * @param {string} params.requestDigest - digest of the call that was authorised.
 * @param {string} params.definitionId - digest of the definition that ran.
 * @param {string} params.nonce - the nonce this call spent.
 * @param {number} params.sequence - the broker's monotonic counter.
 * @param {{path: string, bytes: number, contentSha256: string, inode: number, mtimeNs: string}} params.evidence
 *   post-dispatch observations. Invented or stale values refuse when an
 *   independent caller re-observes a different object.
 * @param {ReturnType<typeof import('./confinement.mjs').confinementField>} params.confinement
 *   the broker's local authority measurement when the observation was recorded.
 *   Required, not defaulted: a receipt that omitted it would
 *   be read as boundary-backed by a reader who never learned there was no boundary,
 *   which is the exact silence this field exists to end.
 * @param {import('node:crypto').KeyObject} params.brokerPrivateKey - the broker's Ed25519 private key.
 * @returns {Record<string, unknown>} the signed receipt.
 * @throws {TypeError} when the signing key or `confinement` is invalid.
 */
export function mintReceipt({ requestDigest, definitionId, nonce, sequence, evidence, confinement, brokerPrivateKey }) {
  if (brokerPrivateKey?.type !== 'private' || brokerPrivateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('mintReceipt: brokerPrivateKey must be an Ed25519 private key')
  }
  const measuredConfinement = snapshotConfinementField(confinement)
  if (measuredConfinement === null
    || !classAtLeast(measuredConfinement.class, CONFINEMENT_CLASS.STATE_OWNED)) {
    throw new TypeError('mintReceipt: confinement is required and must be a measured confinement field')
  }
  const claims = {
    requestDigest, definitionId, nonce, sequence,
    path: evidence.path, bytes: evidence.bytes,
    contentSha256: evidence.contentSha256, inode: evidence.inode, mtimeNs: evidence.mtimeNs,
    confinement: measuredConfinement,
  }
  return { ...claims, signature: edSign(null, receiptPreimage(claims), brokerPrivateKey).toString('base64') }
}

/**
 * Check a receipt against a later observation of the named object.
 *
 * WHAT `require` IS WORTH, EXACTLY. The required-class gate is sound only
 * against a PINNED broker public key. A PEM that travels inside the same reply
 * as the receipt proves nothing: whoever minted the receipt chose the PEM too,
 * so `require: {class: 'peer-separated'}` against an unpinned key is circular
 * theatre. The check is worth precisely the reader's out-of-band binding of
 * `brokerPublicKeyPem` to a launch whose authority separation it independently
 * established —
 * no more, and the caller owns that binding, not this function.
 *
 * @param {object} params
 * @param {Record<string, unknown>} params.receipt - the receipt to check.
 * @param {string} params.brokerPublicKeyPem - the broker's Ed25519 public key.
 * @param {(path: string) => object | null} params.observe - re-reads the effect.
 * @param {{class: string}} [params.require] - minimum confinement class the reader will accept.
 *   Omitted, the class is reported in the receipt and judged by the reader.
 * @returns {{ok: true} | {ok: false, reason: string}} named refusal on failure.
 */
export function verifyReceipt({ receipt, brokerPublicKeyPem, observe, require: required }) {
  const verified = verifiedReceiptClaims({ receipt, brokerPublicKeyPem, require: required })
  if (!verified.ok) return verified
  const claims = verified.claims
  let now
  try {
    now = observe(claims.path)
  } catch {
    return { ok: false, reason: RECEIPT_REFUSE.UNOBSERVABLE }
  }
  if (now?.status === 'absent') return { ok: false, reason: RECEIPT_REFUSE.GONE }
  if (now?.status !== 'observed') return { ok: false, reason: RECEIPT_REFUSE.UNOBSERVABLE }
  if (now.contentSha256 !== claims.contentSha256) return { ok: false, reason: RECEIPT_REFUSE.CONTENT_MISMATCH }
  if (now.inode !== claims.inode) return { ok: false, reason: RECEIPT_REFUSE.INODE_MISMATCH }
  if (now.mtimeNs !== claims.mtimeNs) return { ok: false, reason: RECEIPT_REFUSE.MTIME_MISMATCH }
  if (now.bytes !== claims.bytes) return { ok: false, reason: RECEIPT_REFUSE.MALFORMED }
  return { ok: true }
}

/**
 * Authenticate retained receipt claims without asserting that the effect still exists.
 * Historical workspace replacements require this check separately from the latest file observation.
 * @param {object} params
 * @param {Record<string, unknown>} params.receipt - retained signed receipt.
 * @param {string} params.brokerPublicKeyPem - independently pinned broker public key.
 * @param {{class: string}} [params.require] - minimum accepted confinement class.
 * @returns {{ok: true} | {ok: false, reason: string}} signature and schema result only.
 */
export function verifyReceiptSignature(params) {
  const verified = verifiedReceiptClaims(params)
  return verified.ok ? { ok: true } : verified
}

/** Validate and authenticate one immutable snapshot shared by both verification modes. */
function verifiedReceiptClaims({ receipt, brokerPublicKeyPem, require: required }) {
  const claims = snapshotReceipt(receipt)
  if (claims === null) return { ok: false, reason: RECEIPT_REFUSE.MALFORMED }
  for (const k of RECEIPT_FIELDS) {
    if (claims[k] === undefined || claims[k] === null) return { ok: false, reason: RECEIPT_REFUSE.MALFORMED }
  }
  const confinement = snapshotConfinementField(claims.confinement)
  if (confinement === null
    || typeof claims.requestDigest !== 'string' || !HEX_SHA256.test(claims.requestDigest)
    || typeof claims.definitionId !== 'string' || !HEX_SHA256.test(claims.definitionId)
    || typeof claims.nonce !== 'string' || !SAFE_NONCE.test(claims.nonce)
    || !Number.isSafeInteger(claims.sequence) || claims.sequence < 1
    || typeof claims.path !== 'string' || claims.path.length === 0 || claims.path.includes('\0')
    || !Number.isSafeInteger(claims.bytes) || claims.bytes < 0
    || typeof claims.contentSha256 !== 'string' || !HEX_SHA256.test(claims.contentSha256)
    || !Number.isSafeInteger(claims.inode) || claims.inode < 0
    || typeof claims.mtimeNs !== 'string' || !DECIMAL_INTEGER.test(claims.mtimeNs)
    || typeof claims.signature !== 'string') return { ok: false, reason: RECEIPT_REFUSE.MALFORMED }
  claims.confinement = confinement
  const signatureBytes = Buffer.from(claims.signature, 'base64')
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== claims.signature) {
    return { ok: false, reason: RECEIPT_REFUSE.MALFORMED }
  }
  // Same posture as verifyGrant: a hostile receipt can only ever produce a
  // named refusal here, never a throw across the boundary.
  const brokerPublicKey = canonicalEd25519PublicKey(brokerPublicKeyPem)
  if (brokerPublicKey === null) {
    return { ok: false, reason: RECEIPT_REFUSE.KEY_TYPE }
  }
  try {
    const ok = edVerify(null, receiptPreimage(claims), brokerPublicKey, signatureBytes)
    if (!ok) return { ok: false, reason: RECEIPT_REFUSE.BAD_SIGNATURE }
  } catch {
    return { ok: false, reason: RECEIPT_REFUSE.BAD_SIGNATURE }
  }

  // Judged only after the signature, because an unsigned class is a claim
  // anybody could have written. The floor is `state-owned` whatever the reader
  // asked for: `unconfined` is not a mintable class, so a receipt carrying it
  // describes a broker whose state leaf failed its owner or POSIX-mode check,
  // and no reader wants that admitted by default.
  const floor = required?.class ?? CONFINEMENT_CLASS.STATE_OWNED
  if (!classAtLeast(claims.confinement.class, floor)) {
    return { ok: false, reason: RECEIPT_REFUSE.CONFINEMENT_INSUFFICIENT }
  }

  return { ok: true, claims }
}

/** Snapshot one closed receipt without invoking accessors. */
function snapshotReceipt(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== RECEIPT_KEYS.length
      || ownKeys.some((key) => typeof key !== 'string' || !RECEIPT_KEYS.includes(key))) return null
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch {
    return null
  }
}

/**
 * Digest of the authorised call. Deliberately the SAME canonicalization the
 * verifier uses for grant.digest — one call, one digest, everywhere: the
 * grant, the receipt, and the record entry all bind identical bytes.
 *
 * @param {string} toolName @param {unknown} args @returns {string}
 */
export function requestDigest(toolName, args) {
  return payloadDigest(toolName, args)
}

/** Directory name for persisted receipts under broker-owned stateDir. */
export const RECEIPT_DIRECTORY = 'receipts'
const RECEIPT_FILE = /^([0-9a-f]{64})\.json$/u

/**
 * Return deterministic file path for one persisted settlement receipt.
 *
 * @param {string} stateDir - broker-owned state directory.
 * @param {string} receiptSha256 - sha256 digest of canonical receipt JSON.
 * @returns {string} absolute path to receipt JSON artifact.
 */
export function receiptPath(stateDir, receiptSha256) {
  if (typeof receiptSha256 !== 'string' || !HEX_SHA256.test(receiptSha256)) {
    throw new TypeError('receiptPath: receiptSha256 must be a 64-character hex string')
  }
  return join(stateDir, RECEIPT_DIRECTORY, `${receiptSha256}.json`)
}

function syncDirectory(directory) {
  let descriptor
  try {
    descriptor = openSync(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
    fsyncSync(descriptor)
  } catch {
    throw new Error(RECEIPT_REFUSE.UNAVAILABLE)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function ensureReceiptDirectory(stateDir) {
  const directory = join(stateDir, RECEIPT_DIRECTORY)
  let created = false
  try {
    mkdirSync(directory, { mode: 0o700 })
    created = true
  } catch (error) {
    if (error?.code !== 'EEXIST') throw new Error(RECEIPT_REFUSE.UNAVAILABLE)
  }
  let state
  try {
    state = lstatSync(directory)
  } catch {
    throw new Error(RECEIPT_REFUSE.UNAVAILABLE)
  }
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || state.uid !== euid
    || (state.mode & 0o777) !== 0o700) {
    throw new Error(RECEIPT_REFUSE.DIRECTORY_MALFORMED)
  }
  if (created) syncDirectory(stateDir)
  return directory
}

/**
 * Persist one signed receipt in broker-owned state, bound to its canonical digest.
 *
 * @param {object} params
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {Record<string, unknown>} params.receipt - signed receipt object.
 * @returns {{ path: string, receiptSha256: string, receipt: Record<string, unknown> }}
 */
export function writeReceipt({ stateDir, receipt }) {
  const snapshot = snapshotReceipt(receipt)
  if (snapshot === null) throw new Error(RECEIPT_REFUSE.MALFORMED)
  const canonical = canonicalJSON(snapshot)
  const receiptSha256 = createHash('sha256').update(canonical, 'utf8').digest('hex')
  const directory = ensureReceiptDirectory(stateDir)
  const path = receiptPath(stateDir, receiptSha256)

  try {
    const existing = lstatSync(path)
    if (existing) throw new Error(RECEIPT_REFUSE.ALREADY_EXISTS)
  } catch (error) {
    if (error?.message === RECEIPT_REFUSE.ALREADY_EXISTS) throw error
    if (error?.code !== 'ENOENT') throw new Error(RECEIPT_REFUSE.UNAVAILABLE)
  }

  const stagingPath = join(directory, `.tmp-${receiptSha256}-${process.pid}-${randomBytes(8).toString('hex')}`)
  let descriptor
  let staged = false
  try {
    descriptor = openSync(
      stagingPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    staged = true
    writeFileSync(descriptor, `${canonical}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    // Hard-link publication is create-if-absent: EEXIST is the losing
    // reservation without overwriting an existing winner.
    linkSync(stagingPath, path)
    unlinkSync(stagingPath)
    staged = false
  } catch (error) {
    if (staged) {
      try {
        unlinkSync(stagingPath)
      } catch {
        // Discard staging cleanup errors when the file was already moved or unlinked.
      }
    }
    if (error?.code === 'EEXIST') throw new Error(RECEIPT_REFUSE.ALREADY_EXISTS)
    if (error?.message?.startsWith('receipt:')) throw error
    throw new Error(RECEIPT_REFUSE.UNAVAILABLE)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  syncDirectory(directory)
  return { path, receiptSha256, receipt: snapshot }
}

/**
 * Read one retained receipt from broker-owned state and verify its filename binding.
 *
 * @param {object} params
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {string} params.receiptSha256 - expected receipt SHA-256 digest.
 * @returns {Record<string, unknown>} validated receipt claims and signature.
 */
export function readReceipt({ stateDir, receiptSha256 }) {
  const path = receiptPath(stateDir, receiptSha256)
  let descriptor
  let raw
  try {
    const state = lstatSync(path)
    const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
    if (!state.isFile()
      || state.isSymbolicLink()
      || state.uid !== euid
      || (state.mode & 0o777) !== 0o600) {
      throw new Error(RECEIPT_REFUSE.ENTRY_MALFORMED)
    }
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(RECEIPT_REFUSE.ENTRY_MALFORMED)
    }
    raw = readFileSync(descriptor, 'utf8')
  } catch (error) {
    if (error?.message?.startsWith('receipt:')) throw error
    throw new Error(RECEIPT_REFUSE.UNAVAILABLE)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n')) {
    throw new Error(RECEIPT_REFUSE.ENTRY_MALFORMED)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(RECEIPT_REFUSE.ENTRY_MALFORMED)
  }
  const snapshot = snapshotReceipt(parsed)
  if (snapshot === null) throw new Error(RECEIPT_REFUSE.ENTRY_MALFORMED)
  const canonical = canonicalJSON(snapshot)
  if (`${canonical}\n` !== raw) throw new Error(RECEIPT_REFUSE.ENTRY_MALFORMED)
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex')
  if (digest !== receiptSha256) throw new Error(RECEIPT_REFUSE.MISMATCH)
  return snapshot
}

/**
 * Verify every retained receipt in the broker state against the known Aura digest set.
 *
 * @param {object} params
 * @param {string} params.stateDir - broker-owned state directory.
 * @param {ReadonlySet<string>} params.receiptSha256s - valid receipt digests from Aura.
 * @returns {{ ok: true, count: number } | { ok: false, reason: string }}
 */
export function verifyReceiptDirectory({ stateDir, receiptSha256s }) {
  const directory = join(stateDir, RECEIPT_DIRECTORY)
  let state
  try {
    state = lstatSync(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return receiptSha256s.size === 0
        ? { ok: true, count: 0 }
        : { ok: false, reason: RECEIPT_REFUSE.MISSING_AURA_RECEIPT }
    }
    return { ok: false, reason: RECEIPT_REFUSE.UNAVAILABLE }
  }
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : state.uid
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || state.uid !== euid
    || (state.mode & 0o777) !== 0o700) {
    return { ok: false, reason: RECEIPT_REFUSE.DIRECTORY_MALFORMED }
  }
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return { ok: false, reason: RECEIPT_REFUSE.UNAVAILABLE }
  }
  const seenSha256s = new Set()
  for (const entry of entries) {
    if (entry.name.startsWith('.tmp-')) continue
    const match = RECEIPT_FILE.exec(entry.name)
    if (!entry.isFile() || match === null) {
      return { ok: false, reason: RECEIPT_REFUSE.ENTRY_MALFORMED }
    }
    try {
      readReceipt({ stateDir, receiptSha256: match[1] })
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
    if (!receiptSha256s.has(match[1])) {
      return { ok: false, reason: RECEIPT_REFUSE.UNKNOWN_AURA_ENTRY }
    }
    seenSha256s.add(match[1])
  }
  for (const expectedSha of receiptSha256s) {
    if (!seenSha256s.has(expectedSha)) {
      return { ok: false, reason: RECEIPT_REFUSE.MISSING_AURA_RECEIPT }
    }
  }
  return { ok: true, count: seenSha256s.size }
}
