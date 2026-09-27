/**
 * The grant. Binds an approval to the exact bytes the tool will run with.
 *
 * Tool identity alone does not bind what a tool will do. This module binds a
 * canonical digest of the tool name and arguments, expires the authority, and
 * verifies it against a root key unavailable to the runtime.
 *
 * A request binding controls the bytes to execute, not why they were proposed.
 * A valid grant may still authorize an action proposed after untrusted influence.
 * @module @aukora/host-dsh/grant
 */

import { createHash, verify as edVerify, createPublicKey, randomBytes } from 'node:crypto'
import { canonicalJSON } from '../../kernel-seed/canonical-json.mjs'

export const GRANT_DOMAIN = 'aukora:tool-grant:v3'

/**
 * The v4 authorization domain. v4 exists because the SIGNED MESSAGE changes,
 * not because a claim was added: v3 signs the canonical claims preimage, v4
 * signs the SHA-256 of that preimage so the issuer can authorize a grant it
 * never receives the preimage of. The claim set is byte-identical between the
 * two families; only what the root's key covers differs, which is exactly the
 * case that requires a new domain rather than a compatible extension.
 *
 * There is no downgrade path. `verifyGrant` accepts v3 signatures only and
 * `verifyGrantV4` accepts v4 only; neither inspects a caller-supplied version,
 * so no input selects the weaker family.
 */
export const GRANT_DOMAIN_V4 = 'aukora:tool-grant:v4'

/** Named refusals. A bare false teaches nobody anything. Frozen so a caller that reaches this
 *  module's live object cannot reword the verdict string the live verifier emits. */
export const REFUSE = Object.freeze({
  NO_ROOT: 'grant:no-root-bound',
  NO_GRANT: 'grant:absent',
  MALFORMED: 'grant:malformed',
  TOOL_MISMATCH: 'grant:tool-mismatch',
  PAYLOAD_MISMATCH: 'grant:payload-mismatch',
  DEFINITION_MISMATCH: 'grant:definition-mismatch',
  EXPIRED: 'grant:expired',
  REPLAYED: 'grant:replayed',
  NONCE_UNCERTAIN: 'grant:nonce-claim-uncertain',
  BAD_SIGNATURE: 'grant:signature-invalid',
  ROOT_KEY_TYPE: 'grant:root-key-not-ed25519',
  NO_OPERATION_BOUND: 'grant:no-operation-bound',
  OPERATION_MISMATCH: 'grant:operation-mismatch',
  NO_RECEIPT_KEY_BOUND: 'grant:no-receipt-key-bound',
  RECEIPT_KEY_MISMATCH: 'grant:receipt-key-mismatch',
  TTL_UNBOUNDED: 'grant:ttl-unbounded',
  NO_NONCE_BOOK: 'grant:no-nonce-book',
})

/**
 * The ceiling on how far ahead a grant may expire. A SECURITY INVARIANT, not
 * a tunable: without it `exp` only has to be finite, and `1e21` is finite, an
 * integer, and never less than now — so an eternal grant both mints and
 * verifies while every existing check passes. A grant is for one call taken
 * now; an hour is already far past generous.
 */
export const MAX_TTL_SECONDS = 3600

/** sha256 over canonical (tool, arguments). The same canonicalization the chain uses. */
export function payloadDigest(toolName, args) {
  return createHash('sha256').update(canonicalJSON({ tool: toolName, arguments: args ?? null })).digest('hex')
}

/**
 * Stable identity of the key permitted to sign the settlement receipt.
 * @param {string | import('node:crypto').KeyObject} publicKey - an Ed25519 public key.
 * @returns {string} sha256 over its canonical SPKI DER bytes.
 */
export function receiptKeyIdForPublicKey(publicKey) {
  const key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey)
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
}

/**
 * Parse exactly the canonical PEM encoding of an Ed25519 public key.
 *
 * Node's `createPublicKey()` intentionally accepts a private-key PEM and
 * derives its public half. That convenience is unsafe at a configuration
 * boundary: accepting a private root where a public root was required can
 * distribute the signing secret through a verifier or child environment.
 *
 * @param {unknown} value - the configured PEM string.
 * @returns {import('node:crypto').KeyObject | null} the canonical public key, or null.
 */
export function canonicalEd25519PublicKey(value) {
  if (typeof value !== 'string') return null
  try {
    const key = createPublicKey(value)
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') return null
    return key.export({ type: 'spki', format: 'pem' }).toString() === value ? key : null
  } catch {
    return null
  }
}

/**
 * The exact bytes a root signs. v3 is a canonical-JSON preimage over the
 * closed claims — domain, tool, payload digest, nonce, expiry, the bound
 * definition digest, the exact operation digest, and the receipt-signing key
 * identity. Earlier grant domains are not accepted.
 *
 * @param claims - the grant's claims: `definitionId` is REQUIRED — the grant
 *   binds the resolved tool definition, never the name alone.
 */
export function grantPreimage({ toolName, digest, nonce, exp, definitionId, operationDigest, receiptKeyId }) {
  return Buffer.from(canonicalJSON({
    domain: GRANT_DOMAIN,
    tool: toolName,
    digest,
    nonce,
    exp,
    definitionId,
    operationDigest,
    receiptKeyId,
  }), 'utf8')
}

export function newNonce() { return randomBytes(12).toString('hex') }

/**
 * The v4 authorization preimage: the same closed claims as v3 under the v4
 * domain. The party assembling an authorization hashes this; it is never transmitted.
 *
 * @param {object} claims - the grant's claims, without the signature.
 * @param {string} claims.toolName - the resolved tool name.
 * @param {string} claims.digest - the canonical payload digest.
 * @param {string} claims.nonce - the one-use nonce. In v4 the assembling party chooses it, not the issuer.
 * @param {number} claims.exp - expiry in unix seconds.
 * @param {string} claims.definitionId - the bound tool-definition digest.
 * @param {string} claims.operationDigest - the exact operation digest.
 * @param {string} claims.receiptKeyId - the permitted settlement key identity.
 * @returns {Buffer} the canonical preimage bytes.
 */
export function authorizationPreimage(claims) {
  const { toolName, digest, nonce, exp, definitionId, operationDigest, receiptKeyId } = exactAuthorizationClaims(claims)
  return Buffer.from(canonicalJSON({
    domain: GRANT_DOMAIN_V4,
    tool: toolName,
    digest,
    nonce,
    exp,
    definitionId,
    operationDigest,
    receiptKeyId,
  }), 'utf8')
}

/** Every key a v4 claim set may carry. CLOSED, and the closure is the mechanism. */
export const AUTHORIZATION_CLAIM_KEYS = Object.freeze(
  ['toolName', 'digest', 'nonce', 'exp', 'definitionId', 'operationDigest', 'receiptKeyId'],
)

/**
 * Snapshot a v4 claim set once and refuse anything that is not exactly the
 * closed seven.
 *
 * The digest is the whole authorization: whatever is not inside it is not
 * authorized, and a claim set that hashes anyway would let a rider ride. A
 * future `closureDigest`, `proposalId`, or algorithm marker must therefore
 * refuse here rather than be dropped on the floor and produce a digest for the
 * seven fields that remained. Reading each property exactly once also denies a
 * second observation of an accessor a different answer than the one hashed.
 *
 * @param {unknown} claims - the candidate claim set.
 * @returns {{toolName: string, digest: string, nonce: string, exp: number, definitionId: string, operationDigest: string, receiptKeyId: string}} the frozen exact claims.
 * @throws {TypeError} when the value is not exactly the closed seven with valid formats.
 */
export function exactAuthorizationClaims(claims) {
  const refuse = () => { throw new TypeError('authorizationPreimage: claims are not exact') }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) refuse()
  const prototype = Object.getPrototypeOf(claims)
  if (prototype !== Object.prototype && prototype !== null) refuse()
  const ownKeys = Reflect.ownKeys(claims)
  if (ownKeys.length !== AUTHORIZATION_CLAIM_KEYS.length) refuse()
  const snapshot = Object.create(null)
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !AUTHORIZATION_CLAIM_KEYS.includes(key)) refuse()
    const descriptor = Object.getOwnPropertyDescriptor(claims, key)
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) refuse()
    snapshot[key] = descriptor.value
  }
  for (const key of ['toolName', 'digest', 'nonce', 'definitionId', 'operationDigest', 'receiptKeyId']) {
    if (typeof snapshot[key] !== 'string' || snapshot[key] === '') refuse()
  }
  for (const key of ['digest', 'definitionId', 'operationDigest', 'receiptKeyId']) {
    if (!HEX_SHA256.test(snapshot[key])) refuse()
  }
  if (!SAFE_NONCE.test(snapshot.nonce)) refuse()
  if (!Number.isSafeInteger(snapshot.exp)) refuse()
  return Object.freeze(snapshot)
}

/**
 * The SHA-256 of the v4 preimage, as raw bytes. Its hex form is the value that
 * crosses the hop; the bytes the root's key signs are
 * {@link authorizationSignedMessage}, which tags these.
 *
 * Authorizing a digest rather than a preimage is what makes a digest-only hop
 * implementable: the authorizing party cannot invert the value, and the
 * assembling party re-derives it from the claims it retained. The binding to
 * the exact call survives because the digest covers the whole claim set; what
 * does NOT survive is the issuer's ability to read what it signed. That is a
 * real loss and is this family's ceiling.
 *
 * @param {object} claims - the grant's claims, without the signature.
 * @returns {Buffer} the 32-byte digest embedded in the tagged signed message.
 */
export function authorizationDigestBytes(claims) {
  return createHash('sha256').update(authorizationPreimage(claims)).digest()
}

/**
 * The hex rendering of {@link authorizationDigestBytes}, for the wire frame,
 * the issuer's pending table, and the human's screen.
 *
 * @param {object} claims - the grant's claims, without the signature.
 * @returns {string} 64 lowercase hex characters.
 */
export function authorizationDigest(claims) {
  return authorizationDigestBytes(claims).toString('hex')
}

/**
 * THE BYTES THE ROOT KEY ACTUALLY SIGNS: the v4 domain, a NUL, then the
 * authorization digest.
 *
 * Without the tag the root would sign thirty-two caller-chosen bytes with
 * nothing saying what they mean, and any future protocol that also signs a
 * digest under this key would be substitutable for this one. The tag costs
 * nothing and makes the family explicit inside the signature itself. The wire
 * value and the human's screen still carry {@link authorizationDigest}
 * unchanged; only the signed message is tagged.
 *
 * @param {string} digestHex - the authorization digest, 64 lowercase hex characters.
 * @returns {Buffer} the exact message to sign or verify.
 */
export function authorizationSignedMessageFromHex(digestHex) {
  if (typeof digestHex !== 'string' || !HEX_SHA256.test(digestHex)) {
    throw new TypeError('authorizationSignedMessage: digest is not a sha256 hex string')
  }
  return Buffer.concat([Buffer.from(`${GRANT_DOMAIN_V4}\u0000`, 'utf8'), Buffer.from(digestHex, 'hex')])
}

/**
 * The signed message derived from a bare claim set, for the party ASSEMBLING an
 * authorization. Refuses anything that is not exactly the closed seven.
 *
 * @param {object} claims - the grant's claims, without the signature.
 * @returns {Buffer} the exact message the issuer signed.
 */
export function authorizationSignedMessage(claims) {
  return authorizationSignedMessageFromHex(authorizationDigest(claims))
}

/**
 * The signed message derived from a VERIFIED GRANT, which carries the signature
 * alongside the seven claims.
 *
 * The signature is not part of what the signature covers, so it is projected
 * away here rather than being refused as a rider: by this point the grant has
 * already passed the closed `GRANT_KEYS` check, so the eight keys present are
 * exactly the eight allowed and the seven taken are exactly the seven signed.
 * Callers holding a bare claim set use {@link authorizationSignedMessage},
 * which refuses an eighth key.
 *
 * @param {object} grantClaims - the eight closed grant keys, signature included.
 * @returns {Buffer} the exact message the issuer signed.
 */
function authorizationSignedMessageFromGrant(grantClaims) {
  const claims = Object.create(null)
  for (const key of AUTHORIZATION_CLAIM_KEYS) claims[key] = grantClaims[key]
  return authorizationSignedMessage(claims)
}

/**
 * Every key a grant may carry. CLOSED, and the closure is the mechanism.
 *
 * `grantPreimage` destructures a fixed set, so any key outside it is invisible
 * to the signature: it rides along unsigned and a verifier that merely ignores
 * it has accepted an artifact the root never saw. Refusing the whole grant is
 * the only reading that keeps "the signature covers the grant" true.
 *
 * This is also why there is no per-grant algorithm field. A presenter-supplied
 * `algo` lets the signer name its own strength while absent-algo grants keep
 * verifying, so the one adversary post-quantum signatures exist to stop — a
 * party who can forge Ed25519 — simply mints a fresh absent-algo grant and is
 * never inspected. Minimum strength belongs to the bound root, as
 * `AUMLOK_SUITE` already fixes it. A future PQ family gets a NEW domain
 * string with no legacy branch to fall back into, and until then `algo` and
 * `pqSignature` refuse here by name.
 */
export const GRANT_KEYS = Object.freeze(['toolName', 'digest', 'nonce', 'exp', 'definitionId', 'operationDigest', 'receiptKeyId', 'signature'])

const HEX_SHA256 = /^[0-9a-f]{64}$/
const SAFE_NONCE = /^[a-zA-Z0-9_-]{1,128}$/

/** Private association for the single frozen claim set that signature verification approved. */
const verifiedClaims = new WeakMap()

/** Snapshot only own enumerable data claims from one plain grant object. */
function snapshotGrant(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key !== 'string' || !GRANT_KEYS.includes(key))) return null
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return Object.freeze(snapshot)
  } catch {
    return null
  }
}

/**
 * Verify a grant artifact against the call it claims to authorize, without
 * reserving its nonce.
 *
 * FAILS CLOSED IN EVERY DIRECTION. No root bound -> refused, not allowed. This is
 * deliberate and is the deny-by-default doctrine the kernel already enforces: an
 * unimplemented capability refuses, it never stubs to success. Until the ceremony
 * runs on this host, every consequential tool call is refused, and that is correct.
 *
 * This is an inspection primitive for the issuer's post-mint WYSIWYS check.
 * It does not authorize an effect: callers that admit an effect must use
 * `verifyGrant()`, which requires and consumes a nonce book entry.
 */
function verifyGrantArtifact({ grant, toolName, args, rootPublicKeyPem, now, expectedOperationDigest, expectedDefinitionId, expectedReceiptKeyId }, signedMessage) {
  if (!rootPublicKeyPem) return { ok: false, reason: REFUSE.NO_ROOT }
  if (!grant) return { ok: false, reason: REFUSE.NO_GRANT }
  const claims = snapshotGrant(grant)
  if (claims === null) return { ok: false, reason: REFUSE.MALFORMED }
  if (typeof expectedOperationDigest !== 'string' || !HEX_SHA256.test(expectedOperationDigest)) {
    return { ok: false, reason: REFUSE.NO_OPERATION_BOUND }
  }
  if (typeof expectedReceiptKeyId !== 'string' || !HEX_SHA256.test(expectedReceiptKeyId)) {
    return { ok: false, reason: REFUSE.NO_RECEIPT_KEY_BOUND }
  }
  if (claims.operationDigest === undefined || claims.operationDigest === null || claims.operationDigest === '') {
    return { ok: false, reason: REFUSE.NO_OPERATION_BOUND }
  }
  if (claims.receiptKeyId === undefined || claims.receiptKeyId === null || claims.receiptKeyId === '') {
    return { ok: false, reason: REFUSE.NO_RECEIPT_KEY_BOUND }
  }
  for (const k of ['toolName', 'digest', 'nonce', 'exp', 'signature', 'definitionId']) {
    if (claims[k] === undefined || claims[k] === null || claims[k] === '') return { ok: false, reason: REFUSE.MALFORMED }
  }
  // The closure, applied before anything is trusted: a key outside the set is
  // an unsigned rider, and the grant carrying it is refused whole.
  if (Object.keys(claims).length !== GRANT_KEYS.length) return { ok: false, reason: REFUSE.MALFORMED }
  if (typeof claims.toolName !== 'string'
    || typeof claims.digest !== 'string' || !HEX_SHA256.test(claims.digest)
    || typeof claims.nonce !== 'string' || !SAFE_NONCE.test(claims.nonce)
    || typeof claims.definitionId !== 'string' || !HEX_SHA256.test(claims.definitionId)
    || typeof claims.operationDigest !== 'string' || !HEX_SHA256.test(claims.operationDigest)
    || typeof claims.receiptKeyId !== 'string' || !HEX_SHA256.test(claims.receiptKeyId)
    || typeof claims.signature !== 'string') {
    return { ok: false, reason: REFUSE.MALFORMED }
  }
  const signatureBytes = Buffer.from(claims.signature, 'base64')
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== claims.signature) {
    return { ok: false, reason: REFUSE.MALFORMED }
  }
  if (claims.toolName !== toolName) return { ok: false, reason: REFUSE.TOOL_MISMATCH }
  // Verification inputs are mandatory. An optional security input is one an
  // attacker can remove to disable the check it governs. Earlier measurements
  // found that now=NaN admitted an effectively eternal grant, an omitted
  // expectedDefinitionId admitted a different tool definition, and no nonce
  // book admitted the same grant repeatedly. Operation and receipt-key
  // expectations follow the same fail-closed rule above.
  if (!Number.isSafeInteger(now)) return { ok: false, reason: REFUSE.MALFORMED }
  // The referent binding lives where the resolution lives: the executor
  // always supplies the digest of the definition it resolved; a grant whose
  // bound definition differs from the one about to run refuses by name.
  if (typeof expectedDefinitionId !== 'string' || expectedDefinitionId.length === 0) {
    return { ok: false, reason: REFUSE.DEFINITION_MISMATCH }
  }
  if (claims.definitionId !== expectedDefinitionId) {
    return { ok: false, reason: REFUSE.DEFINITION_MISMATCH }
  }
  if (claims.receiptKeyId !== expectedReceiptKeyId) {
    return { ok: false, reason: REFUSE.RECEIPT_KEY_MISMATCH }
  }
  const digest = payloadDigest(toolName, args)
  if (claims.digest !== digest) return { ok: false, reason: REFUSE.PAYLOAD_MISMATCH }
  if (claims.operationDigest !== expectedOperationDigest) {
    return { ok: false, reason: REFUSE.OPERATION_MISMATCH }
  }

  // Three distinct failures, three names. A non-integer expiry is malformed,
  // a past expiry is expired, and an expiry beyond the ceiling is neither —
  // it is a grant that never stops, which is a different defect and refuses
  // under its own name rather than being folded into `expired`.
  if (!Number.isSafeInteger(claims.exp)) return { ok: false, reason: REFUSE.MALFORMED }
  if (claims.exp * 1000 <= now) return { ok: false, reason: REFUSE.EXPIRED }
  if (claims.exp > Math.floor(now / 1000) + MAX_TTL_SECONDS) return { ok: false, reason: REFUSE.TTL_UNBOUNDED }
  const rootPublicKey = canonicalEd25519PublicKey(rootPublicKeyPem)
  if (rootPublicKey === null) {
    return { ok: false, reason: REFUSE.ROOT_KEY_TYPE }
  }
  let ok = false
  try {
    ok = edVerify(null, signedMessage(claims), rootPublicKey, signatureBytes)
  } catch {
    // Swallows only what the Ed25519 verifier throws for a signature buffer
    // the curve rejects outright. Hostile artifacts stay named refusals.
    return { ok: false, reason: REFUSE.BAD_SIGNATURE }
  }
  // NOTHING IS LOGGED ON A REFUSAL PATH. The preimage is the exact byte
  // string an attacker needs a signature over, and the agent under test can
  // read this process's stderr; printing it hands over the one artifact the
  // root's key is protecting. `toolName` is model-supplied and unescaped, so
  // a log line here is also newline-injectable into the guard's own output.
  // The named refusal is the diagnostic.
  if (!ok) return { ok: false, reason: REFUSE.BAD_SIGNATURE }

  const verified = { ok: true, digest, operationDigest: expectedOperationDigest, receiptKeyId: expectedReceiptKeyId }
  verifiedClaims.set(verified, claims)
  return verified
}

/**
 * Inspect the freshly minted artifact against exactly the operation displayed
 * to the human. This check reserves no nonce and can never authorize an
 * effect; `verifyGrant()` and `verifyGrantV4()` are the effect-admission
 * verifiers, one per family.
 *
 * @param {Parameters<typeof verifyGrantArtifact>[0]} params - exact issuer expectations.
 * @returns {{ok: boolean, reason?: string, digest?: string, operationDigest?: string, receiptKeyId?: string}}
 */
export function verifyIssuedGrant(params) {
  return verifyGrantArtifact(params, grantPreimage)
}

/**
 * The v4 form of {@link verifyIssuedGrant}: identical claim checks, and the
 * signature is verified over the authorization digest instead of the preimage.
 * Reserves no nonce and can never authorize an effect.
 *
 * @param {Parameters<typeof verifyGrantArtifact>[0]} params - exact issuer expectations.
 * @returns {{ok: boolean, reason?: string, digest?: string, operationDigest?: string, receiptKeyId?: string}}
 */
export function verifyIssuedGrantV4(params) {
  return verifyGrantArtifact(params, authorizationSignedMessageFromGrant)
}

/**
 * Verify and atomically reserve a grant before effect admission.
 *
 * Single-use is settled here, not upstream: the successful verification ENDS
 * with the nonce claim. Atomic final-name publication admits one caller across
 * processes. A validated prior burn refuses as replay; an uncertain claim
 * refuses by its own name. A durable callback owns this distinction when
 * present; a standalone in-memory set supports process-local callers only.
 *
 * @param {Parameters<typeof verifyGrantArtifact>[0] & {seenNonces?: Set<string>, claimNonce?: (nonce: string, exp: number) => true | false | 'malformed' | 'uncertain'}} params
 * @returns {{ok: boolean, reason?: string, digest?: string, operationDigest?: string, receiptKeyId?: string}}
 */
function admitGrant({ grant, toolName, args, rootPublicKeyPem, seenNonces, claimNonce, now, expectedOperationDigest, expectedDefinitionId, expectedReceiptKeyId }, signedMessage) {
  const verified = verifyGrantArtifact({
    grant, toolName, args, rootPublicKeyPem, now,
    expectedOperationDigest, expectedDefinitionId, expectedReceiptKeyId,
  }, signedMessage)
  if (!verified.ok) return verified
  if (seenNonces === undefined && claimNonce === undefined) {
    return { ok: false, reason: REFUSE.NO_NONCE_BOOK }
  }
  // Reserve the exact frozen claims that signature verification approved. A
  // second observation of a Proxy could present a different nonce after the
  // signature check, leaving the signed nonce unspent.
  const claims = verifiedClaims.get(verified)
  if (claims === undefined) return { ok: false, reason: REFUSE.MALFORMED }
  if (claimNonce !== undefined) {
    const claimResult = claimNonce(claims.nonce, claims.exp)
    if (claimResult === 'malformed') return { ok: false, reason: REFUSE.MALFORMED }
    if (claimResult === false) return { ok: false, reason: REFUSE.REPLAYED }
    if (claimResult !== true) return { ok: false, reason: REFUSE.NONCE_UNCERTAIN }
  } else {
    if (seenNonces?.has(claims.nonce)) return { ok: false, reason: REFUSE.REPLAYED }
    seenNonces?.add(claims.nonce)
  }
  return verified
}

/**
 * Verify and atomically reserve a v3 grant before effect admission.
 *
 * @param {Parameters<typeof admitGrant>[0]} params - the grant and every required expectation.
 * @returns {{ok: boolean, reason?: string, digest?: string, operationDigest?: string, receiptKeyId?: string}}
 */
export function verifyGrant(params) {
  return admitGrant(params, grantPreimage)
}

/**
 * Verify and atomically reserve a v4 grant before effect admission. Identical
 * to {@link verifyGrant} in every check except the signed message, which is
 * the authorization digest the issuer actually signed.
 *
 * @param {Parameters<typeof admitGrant>[0]} params - the grant and every required expectation.
 * @returns {{ok: boolean, reason?: string, digest?: string, operationDigest?: string, receiptKeyId?: string}}
 */
export function verifyGrantV4(params) {
  return admitGrant(params, authorizationSignedMessageFromGrant)
}
