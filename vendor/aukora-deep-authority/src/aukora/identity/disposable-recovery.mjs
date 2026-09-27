/**
 * Disposable-identity enrollment with phrase-protected recovery material.
 *
 * This module mints throwaway identities for tests and trials. It never
 * reads, writes, migrates, or re-policies `local-control.json`: the record
 * lives under its own domain and file, carries its own loudly disposable
 * recovery rule, and keeps the honest same-UID custody label. Nothing here
 * enrolls a real identity, changes an existing one, or approves a broker
 * operation. No signing custody is stored or recovered, ever. Private
 * keys exist only transiently inside enrollment to build the genesis
 * head, then are dropped; the record carries the public head plus a
 * phrase envelope over a separately random non-signing secret. Recovery
 * proves the presenter holds the enrollment phrase for this exact record
 * and returns public facts. The one authorized effect is rewrapping
 * recovery material under a new phrase. Signing-custody integration is
 * explicitly unimplemented: recovery of signing keys is not offered and
 * must not be read into the rotation path. Phrase knowledge proves
 * envelope knowledge only: identity binding here is same-file
 * co-location plus head self-consistency, not cryptographic
 * authentication of the head by the envelope. That hardening is posted
 * separately. Historical file copies plus
 * their phrase still open those copies; rotation revokes the current
 * record only.
 *
 * Recovery is authorization shaped as data: the returned handle states what
 * it permits and denies, and the denied surface does not exist as code.
 *
 * @module @aukora/identity/disposable-recovery
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto'
import { closeSync, fsyncSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import {
  AUMLOK_ROOT_CONTROL_SUITE,
  createInitialIdentityControl,
  parseIdentityControlState,
  rootKeySetId,
} from './control.mjs'
import {
  aukoraIdFromGenesis,
  createIdentityGenesis,
  parseIdentityGenesis,
} from './genesis.mjs'
import { readAukoraId, readClosedDataRecord } from './validation.mjs'
import { parseRecoveryPhrase } from './recovery-phrase.mjs'
import { unwrapRecoverySecret, wrapRecoverySecret } from './recovery-envelope.mjs'

/**
 * On-disk domain for disposable recovery identities. Never `local-control.json`.
 * Version 2 holds no key bundle: v1 records (phrase-wrapped signing keys)
 * are refused as malformed, never half-read.
 */
export const DISPOSABLE_RECOVERY_DOMAIN = 'aukora:disposable-recovery-control:v2'

/** Honest custody label: encryption changes nothing about the executing UID. */
export const DISPOSABLE_RECOVERY_CUSTODY_CLASS = 'same-uid-posix-mode-only'

/** Disposable-only amendment rule. Applies to no other record, ever. */
export const DISPOSABLE_RECOVERY_RULE = Object.freeze({
  domain: 'aukora:disposable-recovery-rule:v1',
  rootControl: 'active-hybrid-root-dual-signature',
  recovery: 'envelope-v1',
})

/** Fixed filename inside one caller-selected private directory. */
export const DISPOSABLE_RECOVERY_FILENAME = 'disposable-recovery.json'

/** What a recovered handle permits and denies, stated as data. Rotation is the only effectful action. */
export const DISPOSABLE_RECOVERY_GRANT = Object.freeze({
  permits: Object.freeze(['read-public-identity', 'rotate-recovery-material']),
  denies: Object.freeze(['approve-broker-operation', 'mint-grant', 'spend-nonce', 'contact-issuer']),
})

/** Named disposable-recovery failures. */
export const DISPOSABLE_RECOVERY_REFUSE = Object.freeze({
  DIRECTORY_MALFORMED: 'disposable-recovery:directory-malformed',
  RECORD_MALFORMED: 'disposable-recovery:record-malformed',
  ALREADY_ENROLLED: 'disposable-recovery:already-enrolled',
  NOT_ENROLLED: 'disposable-recovery:not-enrolled',
  IDENTITY_MISMATCH: 'disposable-recovery:identity-mismatch',
  PUBLISH_INDETERMINATE: 'disposable-recovery:publish-indeterminate',
})

/** Error carrying one stable disposable-recovery refusal code. */
export class DisposableRecoveryError extends Error {
  /**
   * @param {string} code - one `DISPOSABLE_RECOVERY_REFUSE` value.
   * @param {unknown} [cause] - underlying failure; never phrase or secret material.
   */
  constructor(code, cause) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = 'DisposableRecoveryError'
    this.code = code
  }
}

const RECORD_FIELDS = Object.freeze([
  'domain',
  'disposable',
  'custodyClass',
  'recoveryRule',
  'genesis',
  'activeControl',
  'recoveryEnvelope',
])
const MAX_RECORD_BYTES = 64 * 1024

function fail(code, cause) {
  throw new DisposableRecoveryError(code, cause)
}

function ruleDigest() {
  return createHash('sha256').update(canonicalJSON(DISPOSABLE_RECOVERY_RULE), 'utf8').digest('hex')
}

function rawEd25519PublicKey(publicKey) {
  const exported = publicKey.export({ format: 'jwk' })
  return Buffer.from(exported.x, 'base64url').toString('hex')
}

function recordPath(directory) {
  if (typeof directory !== 'string' || !resolve(directory).startsWith('/')) {
    fail(DISPOSABLE_RECOVERY_REFUSE.DIRECTORY_MALFORMED)
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return join(directory, DISPOSABLE_RECOVERY_FILENAME)
}

/**
 * Create a record exclusively: write and sync private bytes, then make
 * the directory entry durable. A write or sync failure removes the owned
 * file so retry starts clean. A late close or directory-durability
 * failure preserves the completed record and reports indeterminate:
 * the bytes are written and synced, so re-enrollment is honestly refused
 * while confirmation is outstanding — re-open to determine state.
 */
function writeExclusive(file, bytes) {
  let descriptor
  try {
    descriptor = openSync(file, 'wx', 0o600)
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      fail(DISPOSABLE_RECOVERY_REFUSE.ALREADY_ENROLLED, error)
    }
    throw error
  }
  try {
    writeFileSync(descriptor, bytes, 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    try { closeSync(descriptor) } catch { /* close failed too; the write error below stands */ }
    removeOwnedPath(file)
    throw error
  }
  try {
    closeSync(descriptor)
  } catch (error) {
    fail(DISPOSABLE_RECOVERY_REFUSE.PUBLISH_INDETERMINATE, error)
  }
  try {
    const directoryDescriptor = openSync(dirname(file), 'r')
    try {
      fsyncSync(directoryDescriptor)
    } finally {
      closeSync(directoryDescriptor)
    }
  } catch (error) {
    fail(DISPOSABLE_RECOVERY_REFUSE.PUBLISH_INDETERMINATE, error)
  }
}

/** Best-effort removal of a file this call owns; never masks the primary failure. */
function removeOwnedPath(owned) {
  try {
    rmSync(owned, { force: true })
  } catch { /* the original error below stands; residue is reported by tests */ }
}

/**
 * Publish a record atomically: private same-directory temporary file,
 * complete write and sync, atomic replacement, directory durability.
 *
 * The commit point is `renameSync` returning. Every failure before it
 * propagates its original error with the record intact and the temporary
 * removed. Every failure at or after directory durability throws
 * `publish-indeterminate` with the cause: the record was replaced but its
 * durability is unconfirmed, so neither unchanged state nor success may
 * be claimed, and no automatic retry follows.
 * @param {string} directory - record directory.
 * @param {string} bytes - exact record bytes with trailing newline.
 * @returns {string} record file path.
 */
function publishRecordAtomic(directory, bytes) {
  const file = join(directory, DISPOSABLE_RECOVERY_FILENAME)
  const temporary = join(directory, `.${DISPOSABLE_RECOVERY_FILENAME}.${randomBytes(12).toString('hex')}.tmp`)
  let descriptor
  descriptor = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(descriptor, bytes, 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    try { closeSync(descriptor) } catch { /* close failed too; the write error below stands */ }
    descriptor = undefined
    removeOwnedPath(temporary)
    throw error
  }
  try {
    closeSync(descriptor)
    descriptor = undefined
  } catch (error) {
    removeOwnedPath(temporary)
    throw error
  }
  try {
    renameSync(temporary, file)
  } catch (error) {
    removeOwnedPath(temporary)
    throw error
  }
  try {
    const directoryDescriptor = openSync(directory, 'r')
    try {
      fsyncSync(directoryDescriptor)
    } finally {
      closeSync(directoryDescriptor)
    }
  } catch (error) {
    fail(DISPOSABLE_RECOVERY_REFUSE.PUBLISH_INDETERMINATE, error)
  }
  return file
}

function parseRecord(value) {
  const fields = readClosedDataRecord(value, RECORD_FIELDS, 'disposable recovery control')
  if (fields.domain !== DISPOSABLE_RECOVERY_DOMAIN) {
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
  }
  if (fields.disposable !== true || fields.custodyClass !== DISPOSABLE_RECOVERY_CUSTODY_CLASS) {
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
  }
  if (canonicalJSON(fields.recoveryRule) !== canonicalJSON({ ...DISPOSABLE_RECOVERY_RULE })) {
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
  }
  const genesis = parseIdentityGenesis(fields.genesis)
  if (genesis.amendmentRuleDigest !== ruleDigest()) {
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
  }
  const activeControl = parseIdentityControlState(fields.activeControl)
  if (activeControl.subject !== aukoraIdFromGenesis(genesis)) {
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
  }
  return { genesis, activeControl, recoveryEnvelope: fields.recoveryEnvelope }
}

/**
 * Read a record file with a byte limit enforced before decoding: the
 * descriptor's own size plus a cumulative read cap, so an arbitrarily
 * large file is refused without being consumed. Multibyte content is
 * decoded only after the byte limit holds. The descriptor closes on
 * every path.
 * @param {string} file - record file path.
 * @returns {string} decoded file text.
 */
function readBoundedFile(file) {
  let descriptor
  try {
    descriptor = openSync(file, 'r')
  } catch (error) {
    fail(DISPOSABLE_RECOVERY_REFUSE.NOT_ENROLLED, error)
  }
  try {
    if (fstatSync(descriptor).size > MAX_RECORD_BYTES) {
      fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
    }
    const chunks = []
    let total = 0
    const window = Buffer.alloc(8192)
    for (;;) {
      const read = readSync(descriptor, window, 0, window.length, null)
      if (read === 0) break
      total += read
      if (total > MAX_RECORD_BYTES) fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
      chunks.push(window.subarray(0, read))
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

function readStored(directory) {
  const file = join(directory, DISPOSABLE_RECOVERY_FILENAME)
  let bytes
  try {
    bytes = readBoundedFile(file)
  } catch (error) {
    if (error instanceof DisposableRecoveryError) throw error
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED, error)
  }
  try {
    return { file, record: parseRecord(JSON.parse(bytes)) }
  } catch (error) {
    if (error instanceof DisposableRecoveryError) throw error
    fail(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED, error)
  }
  throw new DisposableRecoveryError(DISPOSABLE_RECOVERY_REFUSE.RECORD_MALFORMED)
}

/**
 * Enroll one disposable identity. Key pairs exist only inside this call to
 * build the genesis head; the record keeps the public head plus a phrase
 * envelope over a separately random non-signing secret. Returns public
 * facts only: no phrase, no secret, no private key leaves this call in
 * its return value.
 * @param {object} params - enrollment inputs.
 * @param {string} params.directory - fresh private directory for this identity.
 * @param {string} params.phrase - seven-token unlock phrase (form-checked; production phrases must come from a gated corpus).
 * @param {unknown} [params.corpus] - optional corpus; when given, phrase membership is enforced.
 * @returns {{aukoraId: string, directory: string}} public enrollment facts.
 */
export function enrollDisposableIdentity({ directory, phrase, corpus }) {
  const parsed = parseRecoveryPhrase(phrase, corpus)
  const file = recordPath(directory)
  const ed25519 = generateKeyPairSync('ed25519')
  const mlDsa = ml_dsa65.keygen(randomBytes(32))
  const publicKeys = Object.freeze({
    ed25519: rawEd25519PublicKey(ed25519.publicKey),
    mlDsa65: Buffer.from(mlDsa.publicKey).toString('hex'),
  })
  mlDsa.secretKey.fill(0)
  const genesis = createIdentityGenesis({
    genesisNonce: randomBytes(32).toString('hex'),
    initialRootKeySetId: rootKeySetId(publicKeys),
    amendmentRuleDigest: ruleDigest(),
  })
  const activeControl = createInitialIdentityControl(genesis, {
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    publicKeys,
    authorizedAt: Math.floor(Date.now() / 1000),
  })
  const recoverySecret = randomBytes(32)
  const record = {
    domain: DISPOSABLE_RECOVERY_DOMAIN,
    disposable: true,
    custodyClass: DISPOSABLE_RECOVERY_CUSTODY_CLASS,
    recoveryRule: { ...DISPOSABLE_RECOVERY_RULE },
    genesis,
    activeControl,
    recoveryEnvelope: wrapRecoverySecret({ secret: recoverySecret, phrase: parsed.text }),
  }
  recoverySecret.fill(0)
  writeExclusive(file, `${canonicalJSON(record)}\n`)
  return { aukoraId: aukoraIdFromGenesis(genesis), directory }
}

/**
 * Open the public view of an enrolled identity. Secrets are never returned.
 * @param {string} directory - enrolled identity directory.
 * @returns {{aukoraId: string, genesis: unknown, activeControl: unknown}} public view.
 */
export function openDisposableIdentity(directory) {
  const { record } = readStored(directory)
  return {
    aukoraId: readAukoraId(aukoraIdFromGenesis(record.genesis), 'disposable recovery control.subject'),
    genesis: record.genesis,
    activeControl: record.activeControl,
  }
}

/**
 * Recover the identical identity from its phrase. A successful unwrap
 * proves the presenter holds the enrollment phrase for this exact
 * record; the stored head is publicly revalidated and only public facts
 * leave the call. No signing custody is recovered because none is
 * stored. The handle authorizes one effectful action — rotation
 * via {@link rotateRecoveryPhrase} — and structurally cannot sign with,
 * approve with, or otherwise spend the identity keys.
 * @param {string} directory - enrolled identity directory.
 * @param {string} phrase - unlock phrase text.
 * @returns {{aukoraId: string, subject: string, publicKeys: object, recoveryGrant: object}} recovered handle.
 */
export function recoverDisposableIdentity(directory, phrase) {
  const { record } = readStored(directory)
  const parsed = parseRecoveryPhrase(phrase)
  const secret = unwrapRecoverySecret({ envelope: record.recoveryEnvelope, phrase: parsed.text })
  secret.fill(0)
  return Object.freeze({
    aukoraId: aukoraIdFromGenesis(record.genesis),
    subject: record.activeControl.subject,
    publicKeys: record.activeControl.publicKeys,
    recoveryGrant: DISPOSABLE_RECOVERY_GRANT,
  })
}

/**
 * Verify a rotation publication settled: same identity, changed envelope.
 * Anything else after the commit point is indeterminate — never unchanged,
 * never retried here.
 * @param {object} params - verification inputs.
 * @param {string} params.beforeAukoraId - identity before publication.
 * @param {string} params.beforeEnvelope - canonical envelope JSON before publication.
 * @param {object} params.afterView - public view re-read after publication.
 * @param {object} params.afterRecord - stored record re-read after publication.
 * @returns {void} returns only when settlement is proven.
 */
export function assertRotationSettled({ beforeAukoraId, beforeEnvelope, afterView, afterRecord }) {
  if (afterView.aukoraId !== beforeAukoraId
    || canonicalJSON(afterRecord.recoveryEnvelope) === beforeEnvelope) {
    fail(DISPOSABLE_RECOVERY_REFUSE.PUBLISH_INDETERMINATE)
  }
}
/**
 * Rewrap recovery material under a new phrase through crash-safe
 * publication. The identity is unchanged: genesis and control bytes are
 * carried over untouched.
 *
 * The commit point is the atomic replacement inside publishRecordAtomic.
 * A failure before it preserves the original record; a failure after it
 * throws `publish-indeterminate` instead of reporting unchanged state,
 * and never retries automatically.
 * @param {string} directory - enrolled identity directory.
 * @param {string} oldPhrase - current unlock phrase text.
 * @param {string} newPhrase - replacement seven-token phrase text.
 * @returns {{aukoraId: string}} unchanged public identifier.
 */
export function rotateRecoveryPhrase(directory, oldPhrase, newPhrase) {
  const { record } = readStored(directory)
  const before = openDisposableIdentity(directory)
  const beforeEnvelope = canonicalJSON(record.recoveryEnvelope)
  const parsed = parseRecoveryPhrase(newPhrase)
  const secret = unwrapRecoverySecret({ envelope: record.recoveryEnvelope, phrase: parseRecoveryPhrase(oldPhrase).text })
  secret.fill(0)
  const nextSecret = randomBytes(32)
  const next = {
    domain: DISPOSABLE_RECOVERY_DOMAIN,
    disposable: true,
    custodyClass: DISPOSABLE_RECOVERY_CUSTODY_CLASS,
    recoveryRule: { ...DISPOSABLE_RECOVERY_RULE },
    genesis: record.genesis,
    activeControl: record.activeControl,
    recoveryEnvelope: wrapRecoverySecret({ secret: nextSecret, phrase: parsed.text }),
  }
  nextSecret.fill(0)
  publishRecordAtomic(directory, `${canonicalJSON(next)}\n`)
  const after = readStored(directory)
  const afterView = openDisposableIdentity(directory)
  assertRotationSettled({
    beforeAukoraId: before.aukoraId,
    beforeEnvelope,
    afterView,
    afterRecord: after.record,
  })
  return { aukoraId: afterView.aukoraId }
}
