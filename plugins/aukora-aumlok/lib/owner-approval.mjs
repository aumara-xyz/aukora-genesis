/**
 * The owner-approval preimage: the exact bytes an owner key signs (Genesis plan D2).
 *
 * D2: "the broker requests a signature over the exact operation preimage, including
 * operation digest, challenge and expiry. The signer presents the operation and
 * returns a signature or a refusal. The broker verifies it under the registered key
 * before settlement."
 *
 * WHY THE PREIMAGE LOOKS LIKE THIS. A signature proves exactly one thing: that the
 * holder of a key produced these bytes. Everything that must not be substitutable
 * therefore has to be *inside* the bytes:
 *
 *   subject, activeControlDigest   bind the approval to one identity AND one
 *                                  control head. A root-key rotation changes the
 *                                  digest, so an approval captured before it no
 *                                  longer verifies after it — the same
 *                                  "rotation does not silently carry scope
 *                                  forward" property the delegation claims have.
 *   operationDigest                binds the *operation*, as a digest the broker
 *                                  computed over the exact operation bytes. The
 *                                  preimage carries the digest, never the
 *                                  operation: a signer that signs an operation
 *                                  document is a signer that can be talked into
 *                                  signing a different one.
 *   challenge                      a 32-byte nonce the broker generates per
 *                                  request. It makes two approvals of the same
 *                                  operation distinct bytes, so one signature can
 *                                  never be presented twice.
 *   issuedAt, expiresAt            the window. Both sides check it, because the
 *                                  broker's clock keeps moving during the round
 *                                  trip and the signer's does too.
 *
 * NO SIGNATURE IS PRODUCED IN THIS MODULE. It builds records and derives bytes;
 * `owner-signer.mjs` holds a key, and `signer-channel.mjs` verifies. The verifier
 * re-derives the bytes from the *parsed* record rather than accepting a preimage a
 * signer supplied, which is the only way "verified" means anything.
 *
 * @module @aukora/dsh-plugin-aumlok/owner-approval
 */
import { canonicalJSON } from './canonical.mjs'
import { readAukoraId, readClosedDataRecord, readDigest, readExactAtom, readNonNegativeInteger } from './validation.mjs'

/** Domain of one approval request record. */
export const APPROVAL_REQUEST_DOMAIN = 'aukora:owner-approval-request:v1'
/** Domain of one approval response record. */
export const APPROVAL_RESPONSE_DOMAIN = 'aukora:owner-approval-response:v1'
/** Domain separation for the signing preimage. */
export const APPROVAL_SIGNATURE_DOMAIN = 'aukora:owner-approval-signature:v1'

/** Exact fields of one approval request. */
export const APPROVAL_REQUEST_FIELDS = Object.freeze([
  'domain',
  'subject',
  'activeControlDigest',
  'operationDigest',
  'challenge',
  'issuedAt',
  'expiresAt',
])

const REQUEST_INPUT_FIELDS = Object.freeze(APPROVAL_REQUEST_FIELDS.filter(field => field !== 'domain'))

/**
 * The broker's refusal vocabulary. Every one of these is a named, stable string:
 * "the signer was absent" and "the signature did not verify" are different facts
 * and a caller must be able to tell them apart without parsing prose.
 */
export const APPROVAL_REFUSE = Object.freeze({
  // The identity the approval is about is not the one that was pinned.
  UNAVAILABLE: 'aumlok:approval-unavailable',
  // The caller's inputs are not a usable request.
  MALFORMED: 'aumlok:approval-malformed',
  // The window had already closed before the request went out, or closed during it.
  EXPIRED: 'aumlok:approval-expired',
  // No signer is listening on the socket.
  CHANNEL_UNAVAILABLE: 'aumlok:channel-unavailable',
  // A signer is listening and did not answer in time.
  CHANNEL_TIMEOUT: 'aumlok:channel-timeout',
  // What came back was not a well-formed response record.
  CHANNEL_PROTOCOL: 'aumlok:channel-protocol',
  // The signer answered and said no, on purpose.
  REFUSED: 'aumlok:approval-refused',
  // The response names a different request.
  CHALLENGE_MISMATCH: 'aumlok:approval-challenge-mismatch',
  // This exact challenge has already been accepted once.
  REPLAYED: 'aumlok:approval-replayed',
  // Ed25519 verification under the REGISTERED key failed.
  SIGNATURE_INVALID: 'aumlok:approval-signature-invalid',
})

/**
 * The signer's refusal vocabulary. Kept separate from the broker's on purpose: a
 * signer refusal travels back as data and is reported by the broker as
 * `aumlok:approval-refused` with the signer's own reason in the detail, so the two
 * vocabularies never have to be merged or guessed at.
 */
export const SIGNER_REFUSE = Object.freeze({
  REQUEST_MALFORMED: 'signer:request-malformed',
  /**
   * A REQUEST WITH NO EXPIRY. Z1, from Peter's first real approval, 2026-09-23 21:29.
   *
   * "Valid until —" on the screen was the symptom; a request nobody can bound is the fact. It gets its
   * OWN name rather than collapsing into `REQUEST_MALFORMED`, because "your record is broken" sends a
   * caller to look at its own encoding while the truth is that no window was named at all — and because
   * the one thing missing should be the one thing the refusal says.
   */
  REQUEST_NO_EXPIRY: 'signer:request-no-expiry',
  REQUEST_EXPIRED: 'signer:request-expired',
  CHALLENGE_ALREADY_SEEN: 'signer:challenge-already-seen',
  NO_REVIEWER: 'signer:no-reviewer',
  DECLINED: 'signer:declined',
  /**
   * The reviewer could not PUT THE QUESTION — its window would not open, or it threw while trying.
   *
   * ITS OWN NAME, because "nobody was asked" and "the person said no" are different sentences and only
   * one of them is true at a time. Collapsing them tells an operator their owner declined an operation
   * the owner was never shown.
   */
  ASK_UNAVAILABLE: 'signer:ask-unavailable',
  /**
   * A reviewer that has to ask a person was called through the SYNCHRONOUS path.
   *
   * A decision that arrives from a window later cannot be returned synchronously, and a synchronous
   * caller that ignored the promise would be reading "no objection yet" as an approval. So the sync
   * path REFUSES one instead of returning something a caller must remember not to trust.
   */
  ASK_REQUIRES_AWAIT: 'signer:ask-requires-await',
})

/** An owner-approval record that cannot be built or parsed. */
export class ApprovalError extends TypeError {}

/**
 * Create one canonical approval request from trusted broker inputs.
 * @param {unknown} input - exact request fields without the fixed domain.
 * @returns {Readonly<Record<string, unknown>>} frozen request.
 */
export function createApprovalRequest(input) {
  const fields = readClosedDataRecord(input, REQUEST_INPUT_FIELDS, 'owner approval request input')
  return freezeRequest(fields)
}

/**
 * Parse a serialized approval request.
 * @param {unknown} input - candidate request.
 * @returns {Readonly<Record<string, unknown>>} detached frozen request.
 */
export function parseApprovalRequest(input) {
  let fields
  try {
    fields = readClosedDataRecord(input, APPROVAL_REQUEST_FIELDS, 'owner approval request')
  } catch (cause) {
    throw new ApprovalError(messageOf(cause))
  }
  if (fields.domain !== APPROVAL_REQUEST_DOMAIN) {
    throw new ApprovalError(`owner approval request.domain: must equal ${APPROVAL_REQUEST_DOMAIN}`)
  }
  try {
    return freezeRequest(fields)
  } catch (cause) {
    throw new ApprovalError(messageOf(cause))
  }
}

/**
 * The exact bytes an owner key signs for one request.
 *
 * `domain + NUL + canonicalJSON(request)`. Both sides derive these bytes from the
 * parsed record, so a signer cannot choose a different preimage for the same
 * request and a verifier cannot accidentally check one.
 * @param {unknown} input - candidate request.
 * @returns {Buffer} domain-separated canonical signing bytes.
 */
export function approvalSigningBytes(input) {
  return Buffer.from(`${APPROVAL_SIGNATURE_DOMAIN}\0${canonicalJSON(parseApprovalRequest(input))}`, 'utf8')
}

/**
 * Create a signed approval response.
 * @param {unknown} input - `{challenge, signature}`.
 * @returns {Readonly<Record<string, unknown>>} frozen signed response.
 */
export function createSignedApprovalResponse(input) {
  const fields = readClosedDataRecord(input, ['challenge', 'signature'], 'owner approval response input')
  return Object.freeze({
    domain: APPROVAL_RESPONSE_DOMAIN,
    challenge: readDigest(fields.challenge, 'owner approval response input.challenge'),
    signature: readSignatureHex(fields.signature),
  })
}

/**
 * Create a refusal response. The challenge is echoed when the signer could read
 * one and null when it could not, so a refusal is still attributable to a request
 * wherever that is possible.
 * @param {unknown} input - `{challenge, refusal}`.
 * @returns {Readonly<Record<string, unknown>>} frozen refusal response.
 */
export function createRefusedApprovalResponse(input) {
  const fields = readClosedDataRecord(input, ['challenge', 'refusal'], 'owner approval refusal input')
  const challenge = fields.challenge === null
    ? null
    : readDigest(fields.challenge, 'owner approval refusal input.challenge')
  return Object.freeze({
    domain: APPROVAL_RESPONSE_DOMAIN,
    challenge,
    refusal: readExactAtom(fields.refusal, 'owner approval refusal input.refusal', 128),
  })
}

/**
 * Parse any serialized approval response into a signed or refused verdict.
 * @param {unknown} input - candidate response.
 * @returns {Readonly<{kind: 'signed', challenge: string, signature: string} | {kind: 'refused', challenge: string | null, refusal: string}>} detached response.
 */
export function parseApprovalResponse(input) {
  let fields
  try {
    fields = readClosedDataRecord(input, ['domain', 'challenge', 'signature'], 'owner approval response')
    if (fields.domain !== APPROVAL_RESPONSE_DOMAIN) {
      throw new ApprovalError(`owner approval response.domain: must equal ${APPROVAL_RESPONSE_DOMAIN}`)
    }
    return Object.freeze({
      kind: 'signed',
      challenge: readDigest(fields.challenge, 'owner approval response.challenge'),
      signature: readSignatureHex(fields.signature),
    })
  } catch {
    // Not a signed response; try the refusal shape. Both shapes are closed, so a
    // record carrying a signature AND a refusal parses as neither.
  }
  try {
    fields = readClosedDataRecord(input, ['domain', 'challenge', 'refusal'], 'owner approval refusal')
    if (fields.domain !== APPROVAL_RESPONSE_DOMAIN) {
      throw new ApprovalError(`owner approval response.domain: must equal ${APPROVAL_RESPONSE_DOMAIN}`)
    }
    const challenge = fields.challenge === null
      ? null
      : readDigest(fields.challenge, 'owner approval refusal.challenge')
    return Object.freeze({
      kind: 'refused',
      challenge,
      refusal: readExactAtom(fields.refusal, 'owner approval refusal.refusal', 128),
    })
  } catch (cause) {
    throw new ApprovalError(messageOf(cause))
  }
}

/** Serialize one response record as a single line. */
export function serializeApprovalResponse(response) {
  return `${JSON.stringify(response)}\n`
}

/** Freeze one request into its canonical field order. */
function freezeRequest(fields) {
  const issuedAt = readNonNegativeInteger(fields.issuedAt, 'owner approval request.issuedAt')
  const expiresAt = readNonNegativeInteger(fields.expiresAt, 'owner approval request.expiresAt')
  if (expiresAt <= issuedAt) {
    throw new ApprovalError('owner approval request: expiresAt must be greater than issuedAt')
  }
  return Object.freeze({
    domain: APPROVAL_REQUEST_DOMAIN,
    subject: readAukoraId(fields.subject, 'owner approval request.subject'),
    activeControlDigest: readDigest(fields.activeControlDigest, 'owner approval request.activeControlDigest'),
    operationDigest: readDigest(fields.operationDigest, 'owner approval request.operationDigest'),
    challenge: readDigest(fields.challenge, 'owner approval request.challenge'),
    issuedAt,
    expiresAt,
  })
}

/** Read one 128-character lowercase-hex Ed25519 signature. */
function readSignatureHex(value) {
  if (typeof value !== 'string' || value.length !== 128 || !/^[0-9a-f]{128}$/u.test(value)) {
    throw new ApprovalError('owner approval response.signature: must be 128 lowercase hexadecimal characters')
  }
  return value
}

/** One error's message, never a bare `undefined`. */
function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}
