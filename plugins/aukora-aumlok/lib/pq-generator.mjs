/**
 * The ML-DSA-65 key generator, as a capability the ceremony must obtain and must prove.
 *
 * WHY THIS MODULE EXISTS. `scripts/aumlok/bind` used to fill the two ML-DSA-65 fields with
 * `randomBytes` — arbitrary bytes of the right LENGTH and of no other relation to one another. The
 * record that resulted named a hybrid suite while carrying a "keypair" that could not sign, could
 * not verify, and had never been asked to. The defect is not that the bytes were random; a random
 * 32-byte seed is exactly what FIPS 204's `ML-DSA.KeyGen` takes. The defect is that nothing ever
 * ESTABLISHED a relationship between the two fields before registering them.
 *
 * So this module does two things and refuses to do a third:
 *
 *   1. It obtains the generator as a CAPABILITY, from the vendored implementation under
 *      `lib/vendor/noble-ml-dsa/`. The import is dynamic and its failure is a named refusal, so a
 *      missing or corrupt vendored tree stops the ceremony with `aumlok:ml-dsa-65-generator-
 *      unavailable` rather than crashing the process before a name can be printed.
 *
 *   2. It PROVES the pair before returning it — three checks, all of which must pass:
 *        * shape       — public key 1952 bytes, secret key 4032 bytes, neither all-zero;
 *        * correspondence — `getPublicKey(secretKey)` equals the generated public key, which is
 *          Deep's own check (`aukora/identity/local-control-store.mjs:295`);
 *        * round trip  — sign a domain-separated probe with the secret half and verify it with the
 *          public half, in this lane's own `AUMLOK_ROOT_CONTROL_CONTEXT`, so what is proven is that
 *          the pair works for the thing this lane will later ask it to do;
 *        * AND a NEGATIVE probe — the same signature must FAIL to verify against a different
 *          message. Without this, a verifier that returned `true` unconditionally would satisfy the
 *          round trip, and the positive result would mean nothing.
 *
 *   3. It does NOT fall back. There is no branch in this file that returns filler bytes, and there
 *      is no option that makes it use a weaker check. If the generator is unavailable, refuses, or
 *      returns something that does not correspond, this module throws a named error and the caller
 *      registers nothing. `bind` calls {@link acquireCorrespondingMlDsa65Keypair} before it opens
 *      the record file, so a refusal cannot leave a partial record behind.
 *
 * WHAT IS NOT PROVEN HERE, STATED BECAUSE THE PROOF ABOVE IS EASY TO OVERREAD. The checks above
 * establish that this implementation is internally consistent: it makes a pair, the halves
 * correspond, and it can tell its own signature from a wrong one. They do NOT establish that the
 * implementation is FIPS 204 ML-DSA-65. This lane holds no known-answer vector from the standard
 * and no second, independent ML-DSA implementation on this host, and it did not fetch either. The
 * ceiling `ML_DSA_65_UNMEASURED` carries exactly this statement, and nothing here retires it.
 *
 * @module @aukora/dsh-plugin-aumlok/pq-generator
 */
import { createHash, randomBytes } from 'node:crypto'

/**
 * THE INSTALLED KEYGEN, OWNED HERE SINCE v3. This state and its installer used to live in the custody
 * core, which v3 deletes; the one dynamic loader below is the only thing that installs it, so the
 * state belongs beside that loader rather than in a module that no longer exists.
 */
let installedKeygen = null

/** Install the vendored keygen. Nothing statically imports the vendor tree; this is the one place. */
export function installMlDsa65Keygen(keygen) {
  if (typeof keygen !== 'function') {
    throw new TypeError('installMlDsa65Keygen: the keygen must be a function')
  }
  installedKeygen = keygen
}

/** Whether a generator has been installed. Lets a caller refuse by name instead of catching. */
export function mlDsa65KeygenInstalled() {
  return installedKeygen !== null
}

/** FIPS 204 ML-DSA-65 sizes. The shape check is against these, not against whatever the library returns. */
export const ML_DSA_65_LENGTHS = Object.freeze({
  publicKey: 1952,
  secretKey: 4032,
  seed: 32,
  signature: 3309,
})

/** The context this lane signs root-control material under; the probe uses the same one. */
export const ML_DSA_65_PROBE_CONTEXT = 'aukora-root-control-v1'

/** Domain of the probe message. Static, so the probe cannot be confused with a real signed statement. */
export const ML_DSA_65_PROBE_DOMAIN = 'aukora:ml-dsa-65-keypair-correspondence:v1'

/** Refusals this module produces by name. Every one is a refusal, never a fallback. */
export const ML_DSA_65_KEYGEN_REFUSE = Object.freeze({
  GENERATOR_UNAVAILABLE: 'aumlok:ml-dsa-65-generator-unavailable',
  GENERATOR_MALFORMED: 'aumlok:ml-dsa-65-generator-malformed',
  KEYPAIR_MALFORMED: 'aumlok:ml-dsa-65-keypair-malformed',
  CORRESPONDENCE_FAILED: 'aumlok:ml-dsa-65-correspondence-failed',
  ROUND_TRIP_FAILED: 'aumlok:ml-dsa-65-round-trip-failed',
  VERIFIER_INDISCRIMINATE: 'aumlok:ml-dsa-65-verifier-indiscriminate',
})

/** A key generation this module would not hand to a caller. */
export class MlDsa65KeygenError extends Error {
  /**
   * @param {string} code - one {@link ML_DSA_65_KEYGEN_REFUSE} value.
   * @param {string} detail - the observed defect.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'MlDsa65KeygenError'
    this.code = code
  }
}

/**
 * The ML-DSA-65 operations one generation and one proof need.
 *
 * Every member is the vendored library's own function, unwrapped. A member that is missing is a
 * refusal, never a skipped check.
 * @typedef {Readonly<{
 *   lengths: Readonly<{publicKey: number, secretKey: number, seed: number, signature: number}>,
 *   keygen: (seed: Uint8Array) => {publicKey: Uint8Array, secretKey: Uint8Array},
 *   getPublicKey: (secretKey: Uint8Array) => Uint8Array,
 *   sign: (message: Uint8Array, secretKey: Uint8Array, options: {context: Uint8Array}) => Uint8Array,
 *   verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array, options: {context: Uint8Array}) => boolean,
 * }>} MlDsa65GeneratorCapability
 */

/** The vendored entry, addressed relative to this module so the path cannot drift from the code. */
const VENDORED_ENTRY = new URL('./vendor/noble-ml-dsa/index.mjs', import.meta.url)

let cachedCapability

/**
 * Load the vendored ML-DSA-65 capability, or refuse by name.
 *
 * The import is dynamic on purpose. With a static import a missing vendored file is a module
 * resolution crash that happens while this module is being loaded — before any caller can print a
 * reason. Here the failure is caught and becomes {@link ML_DSA_65_KEYGEN_REFUSE.GENERATOR_UNAVAILABLE},
 * which is the difference between "binding refused" and "binding died".
 * @returns {Promise<MlDsa65GeneratorCapability>} the vendored implementation's own functions.
 */
export async function vendoredMlDsa65Capability() {
  if (cachedCapability !== undefined) return cachedCapability
  let loaded
  try {
    loaded = await import(VENDORED_ENTRY.href)
  } catch (cause) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.GENERATOR_UNAVAILABLE,
      `the vendored ML-DSA-65 module did not load (${VENDORED_ENTRY.pathname}): `
      + `${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const candidate = loaded?.ml_dsa65
  const operations = ['keygen', 'getPublicKey', 'sign', 'verify']
  const missing = operations.filter(name => typeof candidate?.[name] !== 'function')
  if (missing.length > 0) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.GENERATOR_MALFORMED,
      `the vendored module loaded but exports no ${missing.join(', ')} on ml_dsa65`,
    )
  }
  const lengths = candidate.lengths
  for (const [name, expected] of Object.entries(ML_DSA_65_LENGTHS)) {
    if (lengths?.[name] !== expected) {
      throw new MlDsa65KeygenError(
        ML_DSA_65_KEYGEN_REFUSE.GENERATOR_MALFORMED,
        `the vendored module reports lengths.${name}=${String(lengths?.[name])}, not the ML-DSA-65 value ${String(expected)}`,
      )
    }
  }
  cachedCapability = Object.freeze({
    lengths: Object.freeze({ ...lengths }),
    keygen: candidate.keygen,
    getPublicKey: candidate.getPublicKey,
    sign: candidate.sign,
    verify: candidate.verify,
  })
  // THE ONE DYNAMIC LOADER ALSO INSTALLS THE KEYGEN INTO THE CUSTODY CORE, so the core never needs a
  // static import of the vendored tree and the vendor is loaded in exactly one place. A caller that
  // reaches `derivePublicKeys` without having acquired through here gets the NAMED
  // `aumlok:ml-dsa-65-generator-unavailable` rather than a module resolution crash.
  installMlDsa65Keygen(cachedCapability.keygen)
  return cachedCapability
}

/** Reject a byte string that is not exactly `expected` bytes. */
function requireLength(bytes, expected, what) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== expected) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.KEYPAIR_MALFORMED,
      `${what} is ${bytes instanceof Uint8Array ? String(bytes.length) : typeof bytes} bytes, not the ML-DSA-65 length ${String(expected)}`,
    )
  }
  return bytes
}

/** True when every byte is zero — a filler value, never a key. */
function isAllZero(bytes) {
  for (const byte of bytes) if (byte !== 0) return false
  return true
}

/** The probe message and context, derived rather than written so both sides cannot disagree. */
function probeMaterial() {
  return Object.freeze({
    message: new Uint8Array(Buffer.from(`${ML_DSA_65_PROBE_DOMAIN}:probe`, 'utf8')),
    other: new Uint8Array(Buffer.from(`${ML_DSA_65_PROBE_DOMAIN}:other-message`, 'utf8')),
    context: new Uint8Array(Buffer.from(ML_DSA_65_PROBE_CONTEXT, 'utf8')),
  })
}

/**
 * Generate one ML-DSA-65 keypair and prove the two halves correspond before returning it.
 *
 * The pair is only returned if every check passes. There is no parameter that disables a check and
 * no branch that returns a substitute: a caller that gets a value from here has a keypair that
 * signed and verified in this process.
 * @param {{capability?: MlDsa65GeneratorCapability, seed?: Uint8Array}} [options] - an injected capability (courts) and an explicit seed (tests).
 * @returns {Promise<Readonly<{publicKeyHex: string, secretKeyHex: string, proof: Readonly<Record<string, unknown>>}>>} the proven pair.
 */
export async function generateCorrespondingMlDsa65Keypair(options = {}) {
  const capability = options.capability ?? await vendoredMlDsa65Capability()
  const seed = options.seed ?? new Uint8Array(randomBytes(ML_DSA_65_LENGTHS.seed))
  requireLength(seed, ML_DSA_65_LENGTHS.seed, 'the keygen seed')

  let generated
  try {
    generated = capability.keygen(seed)
  } catch (cause) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.KEYPAIR_MALFORMED,
      `keygen refused: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const publicKey = requireLength(generated?.publicKey, ML_DSA_65_LENGTHS.publicKey, 'the generated public key')
  const secretKey = requireLength(generated?.secretKey, ML_DSA_65_LENGTHS.secretKey, 'the generated secret key')
  if (isAllZero(publicKey) || isAllZero(secretKey)) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.KEYPAIR_MALFORMED,
      'the generator returned an all-zero public or secret key',
    )
  }

  // ── correspondence: the check Deep performs at aukora/identity/local-control-store.mjs:295 ──
  let derived
  try {
    derived = capability.getPublicKey(secretKey)
  } catch (cause) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.CORRESPONDENCE_FAILED,
      `getPublicKey refused the generated secret key: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const derivedBytes = requireLength(derived, ML_DSA_65_LENGTHS.publicKey, 'the public key derived from the secret key')
  if (!Buffer.from(derivedBytes).equals(Buffer.from(publicKey))) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.CORRESPONDENCE_FAILED,
      'getPublicKey(secretKey) is not the generated public key; the two halves do not correspond',
    )
  }

  // ── round trip, and the negative probe that makes the round trip mean something ──
  const { message, other, context } = probeMaterial()
  let signature
  try {
    signature = capability.sign(message, secretKey, { context })
  } catch (cause) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.ROUND_TRIP_FAILED,
      `sign refused the generated secret key: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const signatureBytes = requireLength(signature, ML_DSA_65_LENGTHS.signature, 'the signature')
  let accepted
  let rejected
  try {
    accepted = capability.verify(signatureBytes, message, publicKey, { context })
    rejected = capability.verify(signatureBytes, other, publicKey, { context })
  } catch (cause) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.ROUND_TRIP_FAILED,
      `verify refused the generated pair: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (accepted !== true) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.ROUND_TRIP_FAILED,
      'the public half did not accept the signature the secret half produced',
    )
  }
  if (rejected !== false) {
    throw new MlDsa65KeygenError(
      ML_DSA_65_KEYGEN_REFUSE.VERIFIER_INDISCRIMINATE,
      'the public half accepted the same signature over a DIFFERENT message, so the round trip proves nothing',
    )
  }

  return Object.freeze({
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
    secretKeyHex: Buffer.from(secretKey).toString('hex'),
    proof: Object.freeze({
      generator: 'noble-post-quantum@0.6.1 (vendored)',
      publicKeyBytes: publicKey.length,
      secretKeyBytes: secretKey.length,
      signatureBytes: signatureBytes.length,
      context: ML_DSA_65_PROBE_CONTEXT,
      correspondence: 'getPublicKey(secretKey) === publicKey',
      roundTrip: 'sign(secretKey) verified by verify(publicKey)',
      negativeProbe: 'the same signature was REJECTED over a different message',
      publicKeyDigest: createHash('sha256')
        .update(`${ML_DSA_65_PROBE_DOMAIN}:public-key`, 'utf8')
        .update('\0', 'utf8')
        .update(Buffer.from(publicKey))
        .digest('hex'),
      fips204Conformance: 'not-established: no known-answer vector and no second implementation on this host',
    }),
  })
}

/**
 * The one call `scripts/aumlok/bind` makes.
 *
 * Kept as a separate name so the ceremony reads as an intent — "I need a corresponding pair, or I
 * stop" — rather than as a sequence of crypto calls the ceremony would be free to reorder.
 * @param {{capability?: MlDsa65GeneratorCapability, seed?: Uint8Array}} [options] - as {@link generateCorrespondingMlDsa65Keypair}.
 * @returns {Promise<Readonly<{publicKeyHex: string, secretKeyHex: string, proof: Readonly<Record<string, unknown>>}>>} the proven pair.
 */
export function acquireCorrespondingMlDsa65Keypair(options = {}) {
  return generateCorrespondingMlDsa65Keypair(options)
}
