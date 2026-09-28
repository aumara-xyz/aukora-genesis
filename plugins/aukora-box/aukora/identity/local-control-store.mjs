/**
 * Durable same-UID AUMLOK controller for local product development.
 *
 * The store gives repeated parent launches one stable `AukoraId` and one
 * hybrid root-control head. It is not human-key custody: the reader checks
 * POSIX ownership and mode bits but does not measure ACLs or separate the
 * launch UID from the guest.
 *
 * @module @aukora/identity/local-control-store
 */
import {
  createHash,
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
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import {
  AUMLOK_ROOT_CONTROL_SUITE,
  createInitialIdentityControl,
  identityControlDigest,
  parseIdentityControlState,
  rootKeySetId,
} from './control.mjs'
import {
  aukoraIdFromGenesis,
  createIdentityGenesis,
  parseIdentityGenesis,
} from './genesis.mjs'
import {
  readAukoraId,
  readClosedDataRecord,
  readDigest,
} from './validation.mjs'

/** On-disk domain for the local development controller. */
export const LOCAL_AUMLOK_CONTROL_DOMAIN = 'aukora:local-aumlok-control:v1'

/** Explicitly non-custodial POSIX-mode classification carried on disk. */
export const LOCAL_AUMLOK_CUSTODY_CLASS = 'same-uid-posix-mode-only'

/** Versioned amendment policy retained beside the immutable genesis commitment. */
export const LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN = 'aukora:local-aumlok-amendment-policy:v1'

/**
 * Local-development identities permit only the implemented predecessor-signed
 * control transition and deliberately have no recovery path.
 */
export const LOCAL_AUMLOK_AMENDMENT_POLICY = Object.freeze({
  domain: LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN,
  rootControl: 'active-hybrid-root-dual-signature',
  recovery: 'disabled',
})

/** Fixed filename inside one caller-selected private directory. */
export const LOCAL_AUMLOK_CONTROL_FILENAME = 'local-control.json'

/** Named local-controller failures. */
export const LOCAL_AUMLOK_CONTROL_REFUSE = Object.freeze({
  DIRECTORY_MALFORMED: 'aumlok-local:directory-malformed',
  ENTRY_MALFORMED: 'aumlok-local:entry-malformed',
  EXPECTATION_MALFORMED: 'aumlok-local:expectation-malformed',
  IDENTITY_CHANGED: 'aumlok-local:identity-changed',
  POSIX_REQUIRED: 'aumlok-local:posix-required',
  UNAVAILABLE: 'aumlok-local:unavailable',
})

const RECORD_FIELDS = Object.freeze([
  'domain',
  'custodyClass',
  'amendmentPolicy',
  'genesis',
  'activeControl',
  'ed25519PrivateKeyPem',
  'mlDsa65SecretKeyHex',
])
const AMENDMENT_POLICY_FIELDS = Object.freeze(['domain', 'rootControl', 'recovery'])
const EXPECTATION_FIELDS = Object.freeze(['subject', 'activeControlDigest'])
const LOWER_HEX = /^[0-9a-f]+$/u
const MAX_RECORD_BYTES = 32 * 1024
const AMENDMENT_RULE_DIGEST_DOMAIN = 'aukora:local-aumlok-amendment-rule-digest:v1'

/** Error carrying one stable local-controller refusal code. */
export class LocalAumlokControlError extends Error {
  /**
   * @param {string} code - one `LOCAL_AUMLOK_CONTROL_REFUSE` value.
   * @param {unknown} [cause] - underlying filesystem or validation failure.
   */
  constructor(code, cause) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = 'LocalAumlokControlError'
    this.code = code
  }
}

function fail(code, cause) {
  throw new LocalAumlokControlError(code, cause)
}

function requirePosixOwner() {
  if (typeof process.geteuid !== 'function') fail(LOCAL_AUMLOK_CONTROL_REFUSE.POSIX_REQUIRED)
  return process.geteuid()
}

function rawEd25519PublicKey(publicKey) {
  const exported = publicKey.export({ format: 'jwk' })
  if (typeof exported.x !== 'string') fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
  const raw = Buffer.from(exported.x, 'base64url')
  if (raw.length !== 32) fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
  return raw.toString('hex')
}

function readSecretHex(value, byteLength, label) {
  if (typeof value !== 'string'
    || value.length !== byteLength * 2
    || !LOWER_HEX.test(value)) {
    throw new TypeError(`${label}: must be ${String(byteLength * 2)} lowercase hexadecimal characters`)
  }
  return Buffer.from(value, 'hex')
}

function parseAmendmentPolicy(value) {
  const fields = readClosedDataRecord(
    value,
    AMENDMENT_POLICY_FIELDS,
    'local AUMLOK amendment policy',
  )
  if (fields.domain !== LOCAL_AUMLOK_AMENDMENT_POLICY.domain
    || fields.rootControl !== LOCAL_AUMLOK_AMENDMENT_POLICY.rootControl
    || fields.recovery !== LOCAL_AUMLOK_AMENDMENT_POLICY.recovery) {
    throw new TypeError('local AUMLOK amendment policy: unsupported policy')
  }
  return LOCAL_AUMLOK_AMENDMENT_POLICY
}

/**
 * Derive the immutable identity-genesis commitment for one supported policy.
 * @param {unknown} policyInput - closed versioned amendment policy.
 * @returns {string} lowercase SHA-256 commitment.
 */
export function localAumlokAmendmentRuleDigest(policyInput) {
  const policy = parseAmendmentPolicy(policyInput)
  return createHash('sha256')
    .update(AMENDMENT_RULE_DIGEST_DOMAIN)
    .update('\0')
    .update(canonicalJSON(policy))
    .digest('hex')
}

function parseExpectation(value) {
  if (value === undefined) return undefined
  try {
    const fields = readClosedDataRecord(value, EXPECTATION_FIELDS, 'local AUMLOK expectation')
    return Object.freeze({
      subject: readAukoraId(fields.subject, 'local AUMLOK expectation.subject'),
      activeControlDigest: readDigest(
        fields.activeControlDigest,
        'local AUMLOK expectation.activeControlDigest',
      ),
    })
  } catch (error) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.EXPECTATION_MALFORMED, error)
  }
}

function assertExpectation(loaded, expectation) {
  if (expectation !== undefined
    && (loaded.subject !== expectation.subject
      || loaded.activeControlDigest !== expectation.activeControlDigest)) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.IDENTITY_CHANGED)
  }
  return loaded
}

function ensurePrivateDirectory(input) {
  if (typeof input !== 'string' || input.length === 0) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.DIRECTORY_MALFORMED)
  }
  const directory = resolve(input)
  const euid = requirePosixOwner()
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const state = lstatSync(directory)
    if (!state.isDirectory()
      || state.isSymbolicLink()
      || state.uid !== euid
      || (state.mode & 0o777) !== 0o700) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.DIRECTORY_MALFORMED)
    }
  } catch (error) {
    if (error instanceof LocalAumlokControlError) throw error
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.DIRECTORY_MALFORMED, error)
  }
  return directory
}

function syncDirectory(directory) {
  let descriptor
  try {
    descriptor = openSync(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
    fsyncSync(descriptor)
  } catch (error) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE, error)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function createRecord() {
  const ed25519 = generateKeyPairSync('ed25519')
  const mlDsa65 = ml_dsa65.keygen(randomBytes(32))
  const publicKeys = Object.freeze({
    ed25519: rawEd25519PublicKey(ed25519.publicKey),
    mlDsa65: Buffer.from(mlDsa65.publicKey).toString('hex'),
  })
  const genesis = createIdentityGenesis({
    genesisNonce: randomBytes(32).toString('hex'),
    initialRootKeySetId: rootKeySetId(publicKeys),
    amendmentRuleDigest: localAumlokAmendmentRuleDigest(LOCAL_AUMLOK_AMENDMENT_POLICY),
  })
  const activeControl = createInitialIdentityControl(genesis, {
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    publicKeys,
    authorizedAt: Math.floor(Date.now() / 1000),
  })
  return Object.freeze({
    domain: LOCAL_AUMLOK_CONTROL_DOMAIN,
    custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
    amendmentPolicy: LOCAL_AUMLOK_AMENDMENT_POLICY,
    genesis,
    activeControl,
    ed25519PrivateKeyPem: ed25519.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    mlDsa65SecretKeyHex: Buffer.from(mlDsa65.secretKey).toString('hex'),
  })
}

function parseRecord(value) {
  const fields = readClosedDataRecord(value, RECORD_FIELDS, 'local AUMLOK control')
  if (fields.domain !== LOCAL_AUMLOK_CONTROL_DOMAIN) {
    throw new TypeError(`local AUMLOK control.domain: must be ${LOCAL_AUMLOK_CONTROL_DOMAIN}`)
  }
  if (fields.custodyClass !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new TypeError(`local AUMLOK control.custodyClass: must be ${LOCAL_AUMLOK_CUSTODY_CLASS}`)
  }
  const amendmentPolicy = parseAmendmentPolicy(fields.amendmentPolicy)
  const genesis = parseIdentityGenesis(fields.genesis)
  if (genesis.amendmentRuleDigest !== localAumlokAmendmentRuleDigest(amendmentPolicy)) {
    throw new TypeError('local AUMLOK control: amendment policy commitment mismatch')
  }
  const activeControl = parseIdentityControlState(fields.activeControl)
  if (activeControl.epoch !== 0 || activeControl.predecessorControlDigest !== null) {
    throw new TypeError('local AUMLOK control: v1 stores only an epoch-zero control head')
  }
  if (activeControl.subject !== aukoraIdFromGenesis(genesis)) {
    throw new TypeError('local AUMLOK control: genesis subject mismatch')
  }
  const expectedControl = createInitialIdentityControl(genesis, {
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    publicKeys: activeControl.publicKeys,
    authorizedAt: activeControl.authorizedAt,
  })
  if (canonicalJSON(expectedControl) !== canonicalJSON(activeControl)) {
    throw new TypeError('local AUMLOK control: initial control mismatch')
  }
  if (typeof fields.ed25519PrivateKeyPem !== 'string') {
    throw new TypeError('local AUMLOK control.ed25519PrivateKeyPem: must be a string')
  }
  const ed25519PrivateKey = createPrivateKey(fields.ed25519PrivateKeyPem)
  if (ed25519PrivateKey.asymmetricKeyType !== 'ed25519'
    || ed25519PrivateKey.export({ type: 'pkcs8', format: 'pem' }).toString() !== fields.ed25519PrivateKeyPem
    || rawEd25519PublicKey(createPublicKey(ed25519PrivateKey)) !== activeControl.publicKeys.ed25519) {
    throw new TypeError('local AUMLOK control: Ed25519 private key mismatch')
  }
  const mlDsa65SecretKey = readSecretHex(
    fields.mlDsa65SecretKeyHex,
    ml_dsa65.lengths.secretKey,
    'local AUMLOK control.mlDsa65SecretKeyHex',
  )
  if (Buffer.from(ml_dsa65.getPublicKey(mlDsa65SecretKey)).toString('hex') !== activeControl.publicKeys.mlDsa65) {
    throw new TypeError('local AUMLOK control: ML-DSA-65 private key mismatch')
  }
  return Object.freeze({
    record: Object.freeze({
      domain: LOCAL_AUMLOK_CONTROL_DOMAIN,
      custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
      amendmentPolicy,
      genesis,
      activeControl,
      ed25519PrivateKeyPem: fields.ed25519PrivateKeyPem,
      mlDsa65SecretKeyHex: fields.mlDsa65SecretKeyHex,
    }),
    subject: activeControl.subject,
    activeControl,
    activeControlDigest: identityControlDigest(activeControl),
    ed25519PrivateKey,
    ed25519PublicKeyPem: createPublicKey(ed25519PrivateKey)
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    mlDsa65SecretKey,
  })
}

function assertPrivateRecordState(state, euid) {
  if (!state.isFile()
    || state.uid !== BigInt(euid)
    || (state.mode & 0o777n) !== 0o600n
    || state.nlink !== 1n
    || state.size <= 0n
    || state.size > BigInt(MAX_RECORD_BYTES)) {
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
  }
}

function sameRecordState(first, second) {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.uid === second.uid
    && first.mode === second.mode
    && first.nlink === second.nlink
    && first.size === second.size
    && first.mtimeNs === second.mtimeNs
    && first.ctimeNs === second.ctimeNs
}

function readBoundedRecord(descriptor) {
  const chunks = []
  let byteLength = 0
  while (true) {
    const remaining = MAX_RECORD_BYTES + 1 - byteLength
    const chunk = Buffer.allocUnsafe(Math.min(4096, remaining))
    const count = readSync(descriptor, chunk, 0, chunk.length, null)
    if (count === 0) break
    byteLength += count
    if (byteLength > MAX_RECORD_BYTES) fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    chunks.push(chunk.subarray(0, count))
  }
  return Buffer.concat(chunks, byteLength).toString('utf8')
}

function readRecord(path) {
  const euid = requirePosixOwner()
  let descriptor
  try {
    const before = lstatSync(path, { bigint: true })
    assertPrivateRecordState(before, euid)
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor, { bigint: true })
    assertPrivateRecordState(opened, euid)
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    }
    const raw = readBoundedRecord(descriptor)
    const after = fstatSync(descriptor, { bigint: true })
    assertPrivateRecordState(after, euid)
    if (!sameRecordState(opened, after)) fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n')) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    }
    const parsed = parseRecord(JSON.parse(raw))
    if (`${canonicalJSON(parsed.record)}\n` !== raw) {
      fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED)
    }
    return parsed
  } catch (error) {
    if (error instanceof LocalAumlokControlError) throw error
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.ENTRY_MALFORMED, error)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function publishRecord(directory, record) {
  const target = join(directory, LOCAL_AUMLOK_CONTROL_FILENAME)
  const candidate = join(
    directory,
    `.${LOCAL_AUMLOK_CONTROL_FILENAME}.${String(process.pid)}.${randomBytes(12).toString('hex')}`,
  )
  let descriptor
  let candidateCreated = false
  let published = false
  const failures = []
  try {
    descriptor = openSync(
      candidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    candidateCreated = true
    writeFileSync(descriptor, `${canonicalJSON(record)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    try {
      linkSync(candidate, target)
      published = true
    } catch (error) {
      if (error?.code !== 'EEXIST') fail(LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE, error)
    }
  } catch (error) {
    failures.push(error)
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch (error) {
        failures.push(error)
      }
    }
    if (candidateCreated) {
      try {
        unlinkSync(candidate)
      } catch (error) {
        if (error?.code !== 'ENOENT') failures.push(error)
      }
      try {
        syncDirectory(directory)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length === 1) {
    const [error] = failures
    if (error instanceof LocalAumlokControlError) throw error
    fail(LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE, error)
  }
  if (failures.length > 1) {
    fail(
      LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE,
      new AggregateError(failures, 'local AUMLOK control publication failed'),
    )
  }
  return published
}

/**
 * Return the fixed controller file inside a validated private directory.
 * @param {string} directoryInput - absolute or relative local controller directory.
 * @returns {string} absolute controller file path.
 */
export function localAumlokControlPath(directoryInput) {
  return join(resolve(directoryInput), LOCAL_AUMLOK_CONTROL_FILENAME)
}

/**
 * Read and authenticate one existing local development controller.
 * @param {string} directoryInput - private controller directory.
 * @param {unknown} [expectationInput] - optional exact subject and active-control pin.
 * @returns {Readonly<Record<string, unknown>>} stable subject, control head, and private signing material.
 */
export function loadLocalAumlokControl(directoryInput, expectationInput) {
  const expectation = parseExpectation(expectationInput)
  const directory = ensurePrivateDirectory(directoryInput)
  const loaded = assertExpectation(
    readRecord(localAumlokControlPath(directory)),
    expectation,
  )
  return Object.freeze({ ...loaded, path: localAumlokControlPath(directory), created: false })
}

/**
 * Atomically create one controller if absent, then authenticate the winning bytes.
 * @param {string} directoryInput - private controller directory.
 * @param {unknown} [expectationInput] - optional exact subject and active-control pin.
 * @returns {Readonly<Record<string, unknown>>} stable subject, control head, and private signing material.
 */
export function loadOrCreateLocalAumlokControl(directoryInput, expectationInput) {
  const expectation = parseExpectation(expectationInput)
  const directory = ensurePrivateDirectory(directoryInput)
  const target = localAumlokControlPath(directory)
  let created = false
  try {
    lstatSync(target)
  } catch (error) {
    if (error?.code !== 'ENOENT') fail(LOCAL_AUMLOK_CONTROL_REFUSE.UNAVAILABLE, error)
    if (expectation !== undefined) fail(LOCAL_AUMLOK_CONTROL_REFUSE.IDENTITY_CHANGED)
    const record = createRecord()
    created = publishRecord(directory, record)
  }
  const loaded = assertExpectation(readRecord(target), expectation)
  return Object.freeze({ ...loaded, path: target, created })
}
