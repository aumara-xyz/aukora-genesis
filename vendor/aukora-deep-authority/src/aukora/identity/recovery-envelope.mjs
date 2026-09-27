/**
 * Versioned memory-hard KDF plus AEAD envelope for a separately random
 * recovery secret.
 *
 * The phrase never derives identity or signing material. It feeds one
 * memory-hard KDF whose key unwraps a 32-byte secret that was random at
 * enrollment. KDF parameters travel beside the ciphertext so a future
 * version can calibrate differently; a parser from this version refuses any
 * other version rather than guessing. Tampering and wrong phrases share one
 * content-free refusal, per the specification (docs/specs/AUKORA-SOVEREIGN-
 * SHIELD.md section 6.2): recovery attempts expose no oracle about which
 * half failed.
 *
 * Primitives are Node's maintained `scrypt` and AES-256-GCM. No new
 * cryptography is invented here.
 *
 * @module @aukora/identity/recovery-envelope
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'

/** Envelope version this module reads and produces. */
export const RECOVERY_ENVELOPE_VERSION = 1

/** Pinned version-1 KDF parameters. A parameter change requires a new version. */
export const RECOVERY_KDF_V1 = Object.freeze({ name: 'scrypt', N: 65536, r: 8, p: 1, keyLength: 32 })

/** scrypt working-memory ceiling: N=2^16 at r=8 needs ~64 MiB; calibration stays operator duty. */
const SCRYPT_MAXMEM = 256 * 1024 * 1024

/** Random-field sizes in bytes. */
const SALT_BYTES = 16
const NONCE_BYTES = 12
const SECRET_BYTES = 32
const GCM_TAG_BYTES = 16
const CIPHERTEXT_BYTES = SECRET_BYTES + GCM_TAG_BYTES

/** Named envelope failures. Unlock refusal is content-free by design. */
export const RECOVERY_ENVELOPE_REFUSE = Object.freeze({
  ENVELOPE_MALFORMED: 'recovery-envelope:envelope-malformed',
  VERSION_UNSUPPORTED: 'recovery-envelope:version-unsupported',
  UNLOCK_FAILED: 'recovery-envelope:unlock-failed',
})

/** Error carrying one stable envelope refusal code and no secret material. */
export class RecoveryEnvelopeError extends Error {
  /**
   * @param {string} code - one `RECOVERY_ENVELOPE_REFUSE` value.
   */
  constructor(code) {
    super(code)
    this.name = 'RecoveryEnvelopeError'
    this.code = code
  }
}

function readHex(value, bytes) {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/u.test(value) || value.length !== bytes * 2) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.ENVELOPE_MALFORMED)
  }
  return Buffer.from(value, 'hex')
}

/**
 * Validate a candidate envelope without touching secret material.
 * @param {unknown} envelope - candidate envelope record.
 * @returns {{version: number, kdf: Record<string, unknown>, salt: Buffer, nonce: Buffer, ciphertext: Buffer}} parsed envelope.
 */
function readEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.ENVELOPE_MALFORMED)
  }
  const fields = /** @type {Record<string, unknown>} */ (envelope)
  const keys = Object.keys(fields).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['ciphertext', 'kdf', 'nonce', 'salt', 'version'])) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.ENVELOPE_MALFORMED)
  }
  if (fields.version !== RECOVERY_ENVELOPE_VERSION) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.VERSION_UNSUPPORTED)
  }
  const kdf = fields.kdf
  if (kdf === null || typeof kdf !== 'object' || Array.isArray(kdf)
    || canonicalJSON(kdf) !== canonicalJSON({ ...RECOVERY_KDF_V1 })) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.ENVELOPE_MALFORMED)
  }
  return {
    version: RECOVERY_ENVELOPE_VERSION,
    kdf: { ...RECOVERY_KDF_V1 },
    salt: readHex(fields.salt, SALT_BYTES),
    nonce: readHex(fields.nonce, NONCE_BYTES),
    ciphertext: readHex(fields.ciphertext, CIPHERTEXT_BYTES),
  }
}

function deriveKey(phrase, salt) {
  if (typeof phrase !== 'string' || phrase.length === 0) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.ENVELOPE_MALFORMED)
  }
  return scryptSync(Buffer.from(phrase, 'utf8'), salt, RECOVERY_KDF_V1.keyLength, {
    N: RECOVERY_KDF_V1.N, r: RECOVERY_KDF_V1.r, p: RECOVERY_KDF_V1.p, maxmem: SCRYPT_MAXMEM,
  })
}

/**
 * Wrap a separately random 32-byte recovery secret under a phrase.
 * @param {object} params - wrap inputs.
 * @param {Uint8Array} params.secret - exactly 32 random bytes; never a signing key.
 * @param {string} params.phrase - unlock phrase text.
 * @returns {{version: number, kdf: {name: string, N: number, r: number, p: number, keyLength: number}, salt: string, nonce: string, ciphertext: string}} versioned envelope record.
 */
export function wrapRecoverySecret({ secret, phrase }) {
  if (!(secret instanceof Uint8Array) || secret.length !== SECRET_BYTES) {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.ENVELOPE_MALFORMED)
  }
  const salt = randomBytes(SALT_BYTES)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(phrase, salt), nonce)
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()])
  return Object.freeze({
    version: RECOVERY_ENVELOPE_VERSION,
    kdf: { ...RECOVERY_KDF_V1 },
    salt: salt.toString('hex'),
    nonce: nonce.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  })
}

/**
 * Unwrap the recovery secret. Wrong phrases and tampered envelopes share
 * one content-free refusal: no oracle distinguishes them.
 * @param {object} params - unwrap inputs.
 * @param {unknown} params.envelope - candidate envelope record.
 * @param {string} params.phrase - unlock phrase text.
 * @returns {Buffer} detached 32-byte recovery secret copy.
 */
export function unwrapRecoverySecret({ envelope, phrase }) {
  const parsed = readEnvelope(envelope)
  let key
  try {
    key = deriveKey(phrase, parsed.salt)
  } catch {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.UNLOCK_FAILED)
  }
  try {
    const data = parsed.ciphertext
    const decipher = createDecipheriv('aes-256-gcm', key, parsed.nonce)
    decipher.setAuthTag(data.subarray(SECRET_BYTES))
    const secret = Buffer.concat([
      decipher.update(data.subarray(0, SECRET_BYTES)),
      decipher.final(),
    ])
    if (secret.length !== SECRET_BYTES) throw new Error('length')
    return secret
  } catch {
    throw new RecoveryEnvelopeError(RECOVERY_ENVELOPE_REFUSE.UNLOCK_FAILED)
  }
}
