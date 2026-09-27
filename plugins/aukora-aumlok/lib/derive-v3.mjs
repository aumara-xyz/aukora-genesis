/**
 * AUMLOK v3 — the HANDLE and the seven words together are the key.
 *
 * THE PHRASE IS NOT THE KEY; THE ROOT IS DERIVED FROM IT, AND FROM THE HANDLE. **The seven words carry
 * about 14.3 bits on their own and the handle is PUBLIC, so the PAIR is worth about 34.14 bits — and that
 * is the number that matters, because there is no root without both.** (This header said "about 14 bits"
 * until AUMLOK-114; *the phrase's own figure is the smaller half of a number a reader would take as the
 * whole, which is the understatement that made the entitlement look stronger than it is.*) The pair is
 * stretched deliberately:
 *
 *     salt     = utf8("aumlok-kdf-v1") ‖ 0x00 ‖ utf8(NFKC(handle).toLowerCase())
 *     password = utf8(normalisePhrase(phrase))
 *     key      = scrypt(password, salt, 64, seconds per guess)
 *              -> ed25519Seed = key[0..32), mlDsa65Seed = key[32..64)
 *              -> Ed25519 + ML-DSA-65 public keys -> rootId
 *
 * The same handle and the same seven words therefore give the same root on ANY machine, and that IS
 * the recovery: the pair is the identity and the way back at once. On a new machine the handle is
 * typed FIRST and the seven words after it, because the handle is half of the key rather than a label
 * on it.
 *
 * THE CONTRACT IS PINNED AS `aumlok-kdf-v1`, AND ITS NAME IS ITS OWN FIRST FIELD. The owner's reason, on
 * 2026-09-23, is the whole of it: "nobody has bound, so this is the only free moment". Once one person
 * has bound, a byte moved here does not fail loudly — it silently derives a DIFFERENT ROOT from the
 * same handle and the same words, which is an identity and its only way back, quietly replaced. So
 * `AUMLOK_KDF_ID` is both the contract's version and the first bytes of its preimage, and
 * `tests/aukora-aumlok-kdf-pin.test.mjs` holds the bytes against a vector computed from this text
 * alone and goes red on a one-byte change to the domain string, the separator, the normalisation or
 * the field order.
 *
 * THERE IS NO SECOND DOOR. A handle-less derivation is not a weaker derivation, it is a DIFFERENT
 * identity, so `deriveRootFromPhrase(words)` alone refuses by name rather than answering: a caller
 * that forgot the handle must not receive a root that looks exactly like success. (That is the
 * fail-closed direction deliberately: absent, here, is not a ceiling to proceed under — it is half the
 * key missing. The handle's SHAPE, by contrast, is a usage fault and is refused as one.)
 *
 * THE HANDLE IS PUBLIC AND IS NOT A SECRET. It is recorded in the public record, where it is what a
 * NIP-05 `name@domain` local part is read from; uniqueness is a question for discovery and never a
 * gate on binding, which is why nothing in this module consults a registry or a directory.
 *
 * CANONICAL DECISIONS, RE-HOMED RATHER THAN REINVENTED (specs/0049; they lived in `custody.mjs`, which
 * v3 deletes): `rootId = sha256(JSON{suite, ed25519, mlDsa65})` and
 * `genesisRef = sha256("aumlok-genesis-aura-ref:" + rootId + "|" + boundAt)[0:24]`. The suite string is
 * the donor's, unchanged, so a root derived here is the same root the rest of the system already
 * agrees about.
 *
 * THE PHRASE IS NEVER RETURNED, STORED OR LOGGED BY THIS MODULE. Callers receive seeds and public
 * keys; the only thing that ever holds the words is the person, and the surface that shows them once.
 */
import { createHash, createPrivateKey, createPublicKey, scryptSync } from 'node:crypto'
import { normalizePhrase } from './ceremony-verify.mjs'
import { generateCorrespondingMlDsa65Keypair } from './pq-generator.mjs'
import { didKeyFromEd25519PublicKey } from './did-key.mjs'

/** The donor's suite string, unchanged: the canonical root identity is this string's preimage. */
export const AUMLOK_SUITE = 'aumlok-ed25519-ml-dsa-65-v1'

/**
 * THE PIN. The derivation contract's version, and — deliberately, not decoratively — the first field
 * of the contract's own salt preimage. Naming the contract and deriving from it cannot drift apart.
 */
export const AUMLOK_KDF_ID = 'aumlok-kdf-v1'

/** The separator between the domain and the handle: exactly one NUL byte, and not a printable one. */
export const KDF_SALT_SEPARATOR_HEX = '00'

/**
 * A handle is 3 to 24 characters of `a-z 0-9 . _ -`, applied AFTER NFKC and lower-casing.
 *
 * THE SHAPE IS CHECKED ON THE NORMALISED TEXT, which is what makes `Anchor.Keeper` and a full-width
 * `ＡＮＣＨＯＲ` the same handle as `anchor.keeper` rather than refusals: the contract folds first and
 * judges what it will actually hash. Nothing here trims, so a stray space is a REFUSAL rather than
 * something silently dropped on the way into the key.
 */
export const AUMLOK_HANDLE_LENGTH = Object.freeze({ min: 3, max: 24 })
export const AUMLOK_HANDLE = /^[a-z0-9._-]{3,24}$/u

/** The names this module refuses by. Stable strings; a caller renders them, never parses prose. */
export const DERIVE_REFUSE = Object.freeze({
  /** No handle was supplied at all: half of the key is missing, so no root can be derived. */
  HANDLE_ABSENT: 'aumlok:kdf-handle-absent',
  /** A handle was supplied and cannot be one: the wrong type, the wrong length, or outside a-z 0-9 . _ - */
  HANDLE_MALFORMED: 'aumlok:kdf-handle-malformed',
})

/** A derivation this module will not perform. */
export class DeriveV3Error extends TypeError {
  /**
   * @param {string} code - one {@link DERIVE_REFUSE} value.
   * @param {string} detail - the observed defect, in a sentence a person can act on.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'DeriveV3Error'
    this.code = code
  }
}

/**
 * scrypt at seconds per guess. `maxmem` must exceed 128*N*r bytes or scrypt refuses; 2^17 * 8 * 128 is
 * ~134 MB, so the ceiling is set above it deliberately rather than by accident. THE COST IS RAISED WITH
 * `p`, NOT `N`, BECAUSE `N` BUYS MEMORY AND `p` BUYS TIME: measured on this machine p=1 cost 0.197 s
 * per guess, and the plan asks for seconds, so the work factor is multiplied instead of the footprint.
 */
export const PHRASE_KDF_V3 = Object.freeze({
  N: 1 << 17, r: 8, p: 5, keyLen: 64, maxmem: 256 * 1024 * 1024,
})

/**
 * THE HANDLE THE COST MEASUREMENT USES, and the only place in this module that names one itself.
 *
 * `measureKdfSecondsPerGuess` answers "what does one guess cost", not "what is this person's root", so
 * it needs a handle of SOME shape and must not require a caller to hand over a real one — a cost probe
 * that could not run without a person's handle would be a cost probe nobody runs. It is not a secret
 * and it derives nothing anybody keeps.
 */
export const KDF_MEASUREMENT_HANDLE = 'measure.kdf'

// THE SUBJECT IS NOT HERE, AND THAT IS THE POINT. This module derives the ROOT; a subject is a
// claim about the GENESIS — the epoch-0 root plus the nonce the binding supplies — and a derivation
// cannot know the nonce. The field that used to be here (`subject: aukora:1:<rootId>`) named the
// CURRENT key: a refresh moved it, and every Kira record written under the old subject was orphaned
// silently. Only `genesis-v3.mjs` `buildGenesisV3` may name a subject, and `genesis.mjs`
// `AUKORA_ID_PREFIX` is the one prefix constant.

/** PKCS#8 DER prefix for an Ed25519 private key: the seed follows it verbatim. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function sha256hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** `rootId` — the canonical decision above, key order fixed because the digest is over the JSON. */
export function aumlokRootId(publicKeys) {
  return sha256hex(JSON.stringify({
    suite: AUMLOK_SUITE, ed25519: publicKeys.ed25519, mlDsa65: publicKeys.mlDsa65,
  }))
}

/** `genesisRef` — 24 hex, from rootId and boundAt. Changes if either changes. */
export function deriveGenesisRef({ rootId, boundAt }) {
  return sha256hex(`aumlok-genesis-aura-ref:${rootId}|${boundAt}`).slice(0, 24)
}

/**
 * The handle as the contract hashes it: NFKC first, then lower case, and nothing else.
 *
 * NO TRIM, ON PURPOSE. Trimming would silently accept `" anchor.keeper"` while the salt hashed
 * `anchor.keeper`, which is a normalisation the contract does not have; a stray space is refused by
 * {@link assertHandle} instead, where a person can see why. This function does not throw: it is the
 * fold, and the judgement belongs to the two functions below it.
 * @param {unknown} handle - the handle as typed.
 * @returns {string} the normalised text, or '' when there was nothing to normalise.
 */
export function normalizeHandle(handle) {
  if (typeof handle !== 'string') return ''
  return handle.normalize('NFKC').toLowerCase()
}

/**
 * The handle, or a refusal by name. Shape before comparison, always: a malformed handle is a USAGE
 * fault and never a security event, so it says so rather than being reported as a mismatch.
 * @param {unknown} handle - a value that is supposed to be a handle.
 * @returns {string} the normalised handle.
 */
export function assertHandle(handle) {
  const normalized = normalizeHandle(handle)
  if (typeof handle !== 'string') {
    throw new DeriveV3Error(DERIVE_REFUSE.HANDLE_MALFORMED,
      `a handle is text, and this is ${handle === null ? 'null' : typeof handle}`)
  }
  if (!AUMLOK_HANDLE.test(normalized)) {
    throw new DeriveV3Error(DERIVE_REFUSE.HANDLE_MALFORMED,
      `"${handle}" is not a handle: ${String(AUMLOK_HANDLE_LENGTH.min)} to `
      + `${String(AUMLOK_HANDLE_LENGTH.max)} characters of a-z, 0-9, dot, underscore and hyphen, `
      + 'after NFKC and lower-casing. It is public — it is the name half of a NIP-05 name@domain — so '
      + 'it is stored and shown, and it has to be spellable.')
  }
  return normalized
}

/**
 * The handle this derivation needs, or a refusal by name. ABSENT IS NOT A CEILING HERE: without the
 * handle there is no contract to derive under, and answering anyway would hand a caller a root that
 * is not the identity those words name.
 * @param {unknown} handle - the handle, or nothing.
 * @returns {string} the normalised handle.
 */
export function requireHandle(handle) {
  if (handle === undefined || handle === null) {
    throw new DeriveV3Error(DERIVE_REFUSE.HANDLE_ABSENT,
      'the derivation contract aumlok-kdf-v1 salts with the handle, so there is no root without one: '
      + 'a handle-less derivation would be a different identity that looked like a success. On a new '
      + 'machine the handle is typed first, then the seven words.')
  }
  return assertHandle(handle)
}

/**
 * THE SALT, AS BYTES: `utf8("aumlok-kdf-v1") ‖ 0x00 ‖ utf8(NFKC(handle).toLowerCase())`.
 *
 * The NUL is load-bearing rather than decorative: without a separator, a handle chosen to begin where
 * a different domain ends could hash the same bytes as another (domain, handle) pair. It is pinned by
 * the contract court, which shows that removing or changing it moves the derived key.
 * @param {unknown} handle - the handle, as typed.
 * @returns {Buffer} the salt.
 */
export function handleSalt(handle) {
  return Buffer.concat([
    Buffer.from(AUMLOK_KDF_ID, 'utf8'),
    Buffer.from(KDF_SALT_SEPARATOR_HEX, 'hex'),
    Buffer.from(requireHandle(handle), 'utf8'),
  ])
}

/**
 * THE PASSWORD, AS BYTES: the normalised phrase and nothing else. The handle is in the SALT, so a
 * password that folded the handle in would make the salt input decorative.
 * @param {string} phrase - the seven words, as typed or as shown.
 * @returns {Buffer} the password bytes.
 */
export function phrasePreimage(phrase) {
  return Buffer.from(normalizePhrase(phrase), 'utf8')
}

/**
 * The KDF alone, so its cost can be measured without generating keys.
 *
 * `scrypt(password, salt)`: the contract NAMES its two inputs in the other order, which is exactly the
 * swap the pin court measures, so the two are passed by name here rather than by position.
 * @param {string} phrase - the seven words.
 * @param {{handle: string, params?: object}} options - the handle and, optionally, other KDF cost.
 * @returns {Buffer} the 64 key bytes.
 */
export function kdfBytes(phrase, options = {}) {
  const salt = handleSalt(options?.handle)
  const params = options?.params ?? PHRASE_KDF_V3
  return scryptSync(phrasePreimage(phrase), salt, params.keyLen,
    { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem })
}

/** The two seeds, and nothing else, from the handle and the words. */
export function deriveSeeds(phrase, options = {}) {
  const key = kdfBytes(phrase, options)
  return {
    ed25519Seed: Buffer.from(key.subarray(0, 32)),
    mlDsa65Seed: Buffer.from(key.subarray(32, 64)),
  }
}

/** An Ed25519 keypair from 32 seed bytes: node:crypto only, no new curve, no new dependency. */
export function ed25519FromSeed(seed) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  })
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return { privateKey, publicKeyHex: Buffer.from(spki.subarray(spki.length - 32)).toString('hex') }
}

/**
 * The whole derivation: the handle and the words in, the root out.
 * @param {string} phrase - the seven words, as typed or as shown.
 * @param {{handle: string, params?: object}} options - the PUBLIC handle that salts the key, and
 *   optionally other KDF cost. THE HANDLE IS REQUIRED: without it this refuses by name, because a
 *   handle-less derivation is a different identity rather than a weaker one.
 * @returns {Promise<Readonly<object>>} the suite, rootId, both public keys, the Ed25519 `did:key`,
 *   and the two seed hexes the machine may KEEP (never the phrase). NO SUBJECT: a subject is the
 *   digest of the GENESIS, which needs the nonce only the binding holds — `buildGenesisV3` names it.
 */
export async function deriveRootFromPhrase(phrase, options = {}) {
  const seeds = deriveSeeds(phrase, options)
  const ed = ed25519FromSeed(seeds.ed25519Seed)
  const pq = await generateCorrespondingMlDsa65Keypair({ seed: new Uint8Array(seeds.mlDsa65Seed) })
  // The generator proves the two halves correspond and answers in HEX (`publicKeyHex`), not bytes.
  const mlDsa65PublicKeyHex = pq.publicKeyHex
  const rootId = aumlokRootId({ ed25519: ed.publicKeyHex, mlDsa65: mlDsa65PublicKeyHex })
  return Object.freeze({
    suite: AUMLOK_SUITE,
    rootId,
    ed25519PublicKeyHex: ed.publicKeyHex,
    mlDsa65PublicKeyHex,
    ed25519DidKey: didKeyFromEd25519PublicKey(ed.publicKeyHex),
    ed25519SeedHex: seeds.ed25519Seed.toString('hex'),
    mlDsa65SeedHex: seeds.mlDsa65Seed.toString('hex'),
  })
}

/**
 * Seconds per guess, MEASURED on this machine rather than asserted. The honest bits are the pair's
 * own entropy (the generator court measures the phrase's half); this number is what an attacker pays
 * per guess.
 *
 * IT USES A FIXED MEASUREMENT HANDLE, which is named as such above: this answers what one guess costs,
 * not what anybody's root is, and a cost probe that could not run without a person's handle is a cost
 * probe nobody runs.
 * @param {{params?: object, samples?: number, phrase?: string, handle?: string}} options - the cost.
 * @returns {Promise<{secondsPerGuess: number, samples: number, N: number, r: number, p: number}>}
 */
export async function measureKdfSecondsPerGuess(options = {}) {
  const params = options.params ?? PHRASE_KDF_V3
  const samples = options.samples ?? 2
  const phrase = options.phrase ?? 'measure one guess of the key derivation'
  const handle = options.handle ?? KDF_MEASUREMENT_HANDLE
  const started = process.hrtime.bigint()
  for (let index = 0; index < samples; index += 1) {
    kdfBytes(`${phrase} ${String(index)}`, { handle, params })
  }
  const total = Number(process.hrtime.bigint() - started) / 1e9
  return { secondsPerGuess: total / samples, samples, N: params.N, r: params.r, p: params.p }
}
