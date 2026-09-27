/**
 * Is the key in this record the key this record registers? For the STORED bytes, not a fresh pair.
 *
 * THE GAP THIS CLOSES, STATED PRECISELY. `pq-generator.mjs` proves that a pair it has just
 * GENERATED corresponds. `store.mjs` reads the record's public half and checks that the head's key
 * set is the one the genesis committed to. Neither of them looks at the private halves sitting in
 * the record. So before this module, a record whose `mlDsa65SecretKeyHex` was arbitrary bytes of
 * the right LENGTH — the exact defect a previous binding script shipped — would be read happily by every
 * reader in this lane: the genesis commitment covers the PUBLIC keys, and nothing covered the
 * relation between the two fields. This module asks that question and refuses by name when the
 * answer is no.
 *
 * WHAT IT PROVES, EXACTLY. Three relations, each measured in THIS process, over the STORED bytes:
 *
 *   1. ED25519 CORRESPONDENCE — the raw public key derived from the stored `ed25519PrivateKeyPem`
 *      is byte-identical to `activeControl.publicKeys.ed25519`, and the `did:key` printed is
 *      re-derived from THAT key rather than string-matched against a stored identifier.
 *
 *   2. ML-DSA-65 CORRESPONDENCE — `getPublicKey(storedSecretKey)` is byte-identical to
 *      `activeControl.publicKeys.mlDsa65`. This is Deep's own check
 *      (`aukora/identity/local-control-store.mjs:295`), applied to the stored pair instead of to a
 *      pair being created.
 *
 *   3. ML-DSA-65 ROUND TRIP, WITH A NEGATIVE PROBE — the stored secret half signs a
 *      domain-separated probe in this lane's own `aukora-root-control-v1` context and the stored
 *      public half verifies it; AND the same signature is REJECTED over a different message.
 *      Without the negative probe a verifier that returned `true` unconditionally would satisfy
 *      the round trip, and "proven" would mean nothing.
 *
 * WHAT IT DOES NOT PROVE, AND WHY EACH ONE MATTERS.
 *
 *   * NOT FIPS 204 CONFORMANCE. The checks above establish that this implementation is internally
 *     consistent and that the stored pair is a pair. They do not establish that the implementation
 *     IS ML-DSA-65: no known-answer vector from the standard and no second, independent ML-DSA
 *     implementation exist on this host, and none was fetched. `ML_DSA_65_CONFORMANCE:
 *     not-established` is printed for that reason and `ML_DSA_65_UNMEASURED` is NOT retired.
 *   * NOT CUSTODY. Reading these bytes is itself a same-uid act: the record is a mode-0600 file
 *     owned by the running uid, so every process of this user can read it. A correspondence proof
 *     is a statement about bytes, not about who can reach them.
 *   * NOT AUTHORITY. A proven pair authorizes nothing. This module returns facts; the approval
 *     path is `lib/operation-approval.mjs`, and it does not consult this module for permission —
 *     it requires a signature over one exact operation digest.
 *   * NOT ATTENDANCE, NOT SUCCESSION, NOT IDENTITY BINDING. `IDENTITY_BOUND` stays false. No
 *     ceremony happened here; nobody was present; nothing about observer succession is measured.
 *
 * @module @aukora/dsh-plugin-aumlok/identity-correspondence
 */
import { createHash, createPrivateKey } from 'node:crypto'
import { didKeyFromEd25519PublicKey } from './did-key.mjs'
import { rawEd25519PublicKeyHex } from './owner-signer.mjs'
import {
  ML_DSA_65_LENGTHS,
  ML_DSA_65_PROBE_CONTEXT,
  ML_DSA_65_PROBE_DOMAIN,
  MlDsa65KeygenError,
  vendoredMlDsa65Capability,
} from './pq-generator.mjs'
import { LocalAumlokControlError, readLocalAumlokFullRecord } from './store.mjs'

/** The raw Ed25519 public key length the registered half must have. */
const ED25519_PUBLIC_KEY_BYTES = 32

/** Refusals this module produces by name. Each is a refusal; none has a fallback. */
export const IDENTITY_CORRESPONDENCE_REFUSE = Object.freeze({
  RECORD_UNREADABLE: 'aukora:identity-record-unreadable',
  ED25519_MALFORMED: 'aukora:identity-ed25519-malformed',
  ED25519_CORRESPONDENCE_FAILED: 'aukora:identity-ed25519-correspondence-failed',
  ML_DSA_65_MALFORMED: 'aukora:identity-ml-dsa-65-malformed',
  ML_DSA_65_GENERATOR_UNAVAILABLE: 'aukora:identity-ml-dsa-65-generator-unavailable',
  ML_DSA_65_CORRESPONDENCE_FAILED: 'aukora:identity-ml-dsa-65-correspondence-failed',
  ML_DSA_65_ROUND_TRIP_FAILED: 'aukora:identity-ml-dsa-65-round-trip-failed',
  ML_DSA_65_VERIFIER_INDISCRIMINATE: 'aukora:identity-ml-dsa-65-verifier-indiscriminate',
})

/** A correspondence check that did not hold, carrying one stable refusal code. */
export class IdentityCorrespondenceError extends Error {
  /**
   * @param {string} code - one {@link IDENTITY_CORRESPONDENCE_REFUSE} value.
   * @param {string} detail - the observed defect, in the reader's terms.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'IdentityCorrespondenceError'
    this.code = code
  }
}

/** The probe message, the wrong message, and the context — derived so both sides cannot disagree. */
function probeMaterial() {
  return Object.freeze({
    message: new Uint8Array(Buffer.from(`${ML_DSA_65_PROBE_DOMAIN}:probe`, 'utf8')),
    other: new Uint8Array(Buffer.from(`${ML_DSA_65_PROBE_DOMAIN}:other-message`, 'utf8')),
    context: new Uint8Array(Buffer.from(ML_DSA_65_PROBE_CONTEXT, 'utf8')),
  })
}

/** Reject a hex string that is not exactly `expected` bytes long. */
function requireHexBytes(value, expected, code, what) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${String(expected * 2)}}$`, 'u').test(value)) {
    throw new IdentityCorrespondenceError(
      code,
      `${what}: must be ${String(expected)} bytes of lowercase hexadecimal`,
    )
  }
  return Buffer.from(value, 'hex')
}

/**
 * Prove that the stored secret halves of one controller record correspond to the public keys it
 * registers, and return what was measured rather than a bare boolean.
 *
 * Fails by throwing a named {@link IdentityCorrespondenceError}; there is no partial result and no
 * "checked: false" return, because a caller that received one would have to decide what to do with
 * an unproven record, and the only correct thing to do with one is to stop.
 *
 * @param {object} options - the record to check.
 * @param {string} options.directory - private controller directory holding `local-control.json`.
 * @param {unknown} [options.expectation] - optional `{subject, activeControlDigest}` pin.
 * @param {import('./pq-generator.mjs').MlDsa65GeneratorCapability} [options.capability] - injected ML-DSA-65 operations (courts).
 * @returns {Promise<Readonly<Record<string, unknown>>>} the measured facts.
 */
export async function verifyIdentityCorrespondence({ directory, expectation, capability } = {}) {
  let record
  try {
    record = readLocalAumlokFullRecord(directory, expectation)
  } catch (error) {
    if (error instanceof LocalAumlokControlError) {
      // The store's own vocabulary is narrower and more precise than anything this module could
      // invent — `aumlok-local:identity-changed` says exactly which pin failed — so it is carried
      // through as the detail of this module's refusal rather than flattened into a new word.
      throw new IdentityCorrespondenceError(
        IDENTITY_CORRESPONDENCE_REFUSE.RECORD_UNREADABLE,
        `${error.code} (${record?.path ?? String(directory)})`,
      )
    }
    throw error
  }
  const projection = record.projection

  // ── 1. Ed25519: the stored private key must derive the registered public key ────────────────
  const registeredEd25519 = requireHexBytes(
    record.publicKeys.ed25519,
    ED25519_PUBLIC_KEY_BYTES,
    IDENTITY_CORRESPONDENCE_REFUSE.ED25519_MALFORMED,
    'the registered Ed25519 public key',
  )
  let derivedEd25519Hex
  try {
    const privateKey = createPrivateKey(record.ed25519PrivateKeyPem)
    derivedEd25519Hex = rawEd25519PublicKeyHex(privateKey)
  } catch (cause) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ED25519_MALFORMED,
      `the stored ed25519PrivateKeyPem is not a usable Ed25519 private key: `
      + `${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (derivedEd25519Hex !== registeredEd25519.toString('hex')) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ED25519_CORRESPONDENCE_FAILED,
      `the stored ed25519PrivateKeyPem derives ${derivedEd25519Hex}, but the active control head `
      + `registers ${registeredEd25519.toString('hex')}`,
    )
  }
  // Re-derived from the key, never string-matched: the projection's `approvalKeyDid` is a claim
  // this module checks rather than copies.
  const derivedDid = didKeyFromEd25519PublicKey(derivedEd25519Hex)
  if (derivedDid !== projection.approvalKeyDid) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ED25519_CORRESPONDENCE_FAILED,
      `the registered key derives ${derivedDid}, but the projection names ${String(projection.approvalKeyDid)}`,
    )
  }

  // ── 2 and 3. ML-DSA-65: correspondence, then a round trip a wrong answer cannot pass ────────
  let cap
  try {
    cap = capability ?? await vendoredMlDsa65Capability()
  } catch (cause) {
    if (cause instanceof MlDsa65KeygenError) {
      throw new IdentityCorrespondenceError(
        IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_GENERATOR_UNAVAILABLE,
        cause.message,
      )
    }
    throw cause
  }
  const registeredMlDsa65 = requireHexBytes(
    record.publicKeys.mlDsa65,
    ML_DSA_65_LENGTHS.publicKey,
    IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_MALFORMED,
    'the registered ML-DSA-65 public key',
  )
  const storedSecret = requireHexBytes(
    record.mlDsa65SecretKeyHex,
    ML_DSA_65_LENGTHS.secretKey,
    IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_MALFORMED,
    'the stored mlDsa65SecretKeyHex',
  )
  if (storedSecret.every(byte => byte === 0) || registeredMlDsa65.every(byte => byte === 0)) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_MALFORMED,
      'the stored ML-DSA-65 secret key or the registered public key is all zero',
    )
  }
  let derivedMlDsa65
  try {
    derivedMlDsa65 = cap.getPublicKey(new Uint8Array(storedSecret))
  } catch (cause) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_CORRESPONDENCE_FAILED,
      `getPublicKey refused the stored mlDsa65SecretKeyHex (${cause instanceof Error ? cause.message : String(cause)}) `
      + '— a secret half no public key can be derived from is exactly the shape a placeholder secret key has',
    )
  }
  if (!Buffer.from(derivedMlDsa65 ?? []).equals(registeredMlDsa65)) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_CORRESPONDENCE_FAILED,
      `getPublicKey(stored mlDsa65SecretKeyHex) is not the registered ML-DSA-65 public key: the `
      + 'stored halves are not one pair, which is the exact shape a placeholder secret key has',
    )
  }

  const { message, other, context } = probeMaterial()
  let signature
  try {
    signature = cap.sign(message, new Uint8Array(storedSecret), { context })
  } catch (cause) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_ROUND_TRIP_FAILED,
      `sign refused the stored mlDsa65SecretKeyHex: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!(signature instanceof Uint8Array) || signature.length !== ML_DSA_65_LENGTHS.signature) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_ROUND_TRIP_FAILED,
      `the signature is ${String(signature?.length)} bytes, not the ML-DSA-65 length `
      + `${String(ML_DSA_65_LENGTHS.signature)}`,
    )
  }
  let accepted
  let rejected
  try {
    accepted = cap.verify(signature, message, new Uint8Array(registeredMlDsa65), { context })
    rejected = cap.verify(signature, other, new Uint8Array(registeredMlDsa65), { context })
  } catch (cause) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_ROUND_TRIP_FAILED,
      `verify refused the stored pair: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (accepted !== true) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_ROUND_TRIP_FAILED,
      'the registered public key did not accept the signature the stored secret key produced',
    )
  }
  if (rejected !== false) {
    throw new IdentityCorrespondenceError(
      IDENTITY_CORRESPONDENCE_REFUSE.ML_DSA_65_VERIFIER_INDISCRIMINATE,
      'the registered public key accepted the same signature over a DIFFERENT message, so the '
      + 'round trip proves nothing',
    )
  }

  return Object.freeze({
    ok: true,
    path: record.path,
    projection,
    publicKeys: record.publicKeys,
    ed25519: Object.freeze({
      registeredHex: registeredEd25519.toString('hex'),
      derivedFromStoredPrivateHex: derivedEd25519Hex,
      derivedDid,
      correspondence: 'rawPublicKey(stored ed25519PrivateKeyPem) === activeControl.publicKeys.ed25519',
    }),
    mlDsa65: Object.freeze({
      publicKeyBytes: registeredMlDsa65.length,
      secretKeyBytes: storedSecret.length,
      signatureBytes: signature.length,
      context: ML_DSA_65_PROBE_CONTEXT,
      correspondence: 'getPublicKey(stored mlDsa65SecretKeyHex) === activeControl.publicKeys.mlDsa65',
      roundTrip: 'sign(stored secret) verified by verify(registered public)',
      negativeProbe: 'the same signature was REJECTED over a different message',
      publicKeyDigest: createHash('sha256')
        .update(`${ML_DSA_65_PROBE_DOMAIN}:registered-public-key`, 'utf8')
        .update('\0', 'utf8')
        .update(registeredMlDsa65)
        .digest('hex'),
      fips204Conformance: 'not-established: no known-answer vector and no second ML-DSA implementation on this host',
    }),
  })
}
