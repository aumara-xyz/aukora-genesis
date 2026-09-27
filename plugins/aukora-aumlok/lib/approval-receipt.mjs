/**
 * The approval receipt: what one verified owner approval entitles anyone to say.
 *
 * WHY THIS EXISTS. D2 ends at "the broker verifies it under the registered key before
 * settlement", and a verification that leaves no record is a verification nobody can inspect
 * afterwards. This module turns one *verified* approval into a closed record that prints the
 * verdict and, beside it, every ceiling that qualifies it.
 *
 * IT IS NOT A receipt-v3. Receipt v3 is a separate, pinned, portable format
 * (`vendor/receipt/`, D5); this is this lane's approval receipt, it claims no CONFORMING
 * status, and it deliberately carries no `alg`, no owner field and no identity binding. Nothing
 * here is a stranger-verifiable artifact — it is the honest local record of one verified event.
 *
 * THE FLIP-RISK BIND, ENFORCED RATHER THAN DESCRIBED (Genesis plan D1). `human-ceremony` is
 * mintable only under a key BOUND by a human ceremony recorded in a register. This lane holds
 * no such register, so it cannot mint that class for ANY input — an agent-held software key that
 * signs an approval yields `delegated` at most, and asking for `human-ceremony` is refused BY NAME
 * rather than quietly downgraded. A silent downgrade would be the same defect as a silent upgrade:
 * the caller would not learn what it actually got.
 *
 * WHAT THE VERDICT DOES AND DOES NOT SAY. `OWNER_KEY_SIGNED` means: at that instant, the key named
 * by the projection's `approvalKeyDid` signed those exact bytes, over that operation digest, for
 * that identity, inside that window. It does NOT mean a person saw anything — a signature proves a
 * key signed, never that anyone attended — and it binds no identity. Those limits travel as fields
 * in the record, not as a paragraph beside it, so a consumer cannot read the verdict without them.
 *
 * @module @aukora/dsh-plugin-aumlok/approval-receipt
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './canonical.mjs'
import { approvalSigningBytes } from './owner-approval.mjs'
import { signerCeilingLines } from './ceilings.mjs'
import { readAukoraId, readClosedDataRecord, readDigest, readExactAtom, readNonNegativeInteger } from './validation.mjs'

/** Domain of one approval receipt. */
export const APPROVAL_RECEIPT_DOMAIN = 'aukora:approval-receipt:v1'

/** The one verdict this lane can earn. */
export const OWNER_KEY_SIGNED = 'OWNER_KEY_SIGNED'

/** Approval classes, from Genesis plan D1. A closed set. */
export const APPROVAL_CLASSES = Object.freeze(['human-ceremony', 'delegated', 'scripted', 'unattributed'])

/** Key classes, from the receipt v3 technical specification §5.2. */
export const KEY_CLASSES = Object.freeze({
  A: 'device-bound',
  B: 'software-held',
  C: 'operator-custodied',
})

/**
 * The class this lane's approvals earn, and why it is not a choice.
 *
 * The signer holds a software key file with no ceremony record behind it, so the strongest true
 * statement is `delegated`. Class C (`operator-custodied`) may never carry `human-ceremony`, and
 * this lane cannot mint `human-ceremony` at all — see the module comment.
 */
export const DEFAULT_APPROVAL_CLASS = 'delegated'

/** Refusals this module produces by name. */
export const RECEIPT_REFUSE = Object.freeze({
  HUMAN_CEREMONY: 'aukora:receipt-human-ceremony-unmintable',
  UNVERIFIED: 'aukora:receipt-approval-not-verified',
  MALFORMED: 'aukora:receipt-malformed',
  UNKNOWN_CLASS: 'aukora:receipt-unknown-class',
})

/** The exact fields of one approval receipt. */
export const APPROVAL_RECEIPT_FIELDS = Object.freeze([
  'domain',
  'verdict',
  'keyClass',
  'keyClassMeaning',
  'approvalClass',
  'subject',
  'activeControlDigest',
  'approvalKeyDid',
  'operationDigest',
  'challenge',
  'issuedAt',
  'expiresAt',
  'signature',
  'signedBytesDigest',
  'verifiedAt',
  'attendance',
  'signerDeviceTrusted',
  'succession',
  'identityBound',
  'ceilings',
])

/** A receipt that cannot be minted, carrying one stable refusal code. */
export class ApprovalReceiptError extends Error {
  /**
   * @param {string} code - one {@link RECEIPT_REFUSE} value.
   * @param {string} detail - the observed defect.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'ApprovalReceiptError'
    this.code = code
  }
}

/**
 * Mint the receipt for one approval that the broker has already verified.
 *
 * @param {object} input - the verified approval, the projection it was checked against, and the key class.
 * @param {unknown} input.approval - the `{ok: true, …}` verdict from `createOwnerApprovalSession().approve()`.
 * @param {unknown} input.projection - the public control projection the approval was admitted against.
 * @param {'A'|'B'|'C'} input.keyClass - the custody class of the registered key.
 * @param {string} [input.approvalClass] - defaults to `delegated`; `human-ceremony` is never mintable here.
 * @param {unknown} input.request - the request the broker built, from which the signed preimage is re-derived.
 * @returns {Readonly<Record<string, unknown>>} frozen receipt.
 */
export function createApprovalReceipt({ approval, projection, keyClass, approvalClass, request }) {
  if (approval === null || typeof approval !== 'object' || approval.ok !== true) {
    throw new ApprovalReceiptError(
      RECEIPT_REFUSE.UNVERIFIED,
      'a receipt is minted only for an approval the broker verified; refusing to record an unverified one',
    )
  }
  const wanted = approvalClass ?? DEFAULT_APPROVAL_CLASS
  if (!APPROVAL_CLASSES.includes(wanted)) {
    throw new ApprovalReceiptError(RECEIPT_REFUSE.UNKNOWN_CLASS, `${String(wanted)} is not an approval class`)
  }
  if (wanted === 'human-ceremony') {
    // Refused BY NAME, not downgraded: this lane holds no human-binding register, so it cannot
    // know the key behind an approval was BOUND by a ceremony, and a class it cannot know it
    // earned is a class it may not print.
    throw new ApprovalReceiptError(
      RECEIPT_REFUSE.HUMAN_CEREMONY,
      'human-ceremony requires a key BOUND by a recorded human ceremony; this lane holds no '
      + 'binding register and mints no such class for any input',
    )
  }
  if (!Object.hasOwn(KEY_CLASSES, /** @type {string} */ (keyClass))) {
    throw new ApprovalReceiptError(
      RECEIPT_REFUSE.UNKNOWN_CLASS,
      `keyClass: must be one of ${Object.keys(KEY_CLASSES).join(', ')}`,
    )
  }
  let fields
  try {
    fields = readClosedDataRecord(projection, [
      'domain', 'subject', 'epoch', 'activeControlDigest', 'revoked', 'approvalKeyDid', 'custodyClass',
    ], 'approval receipt projection')
  } catch (cause) {
    throw new ApprovalReceiptError(RECEIPT_REFUSE.MALFORMED, cause instanceof Error ? cause.message : String(cause))
  }
  // The digest of the bytes the signer actually signed, recomputed here from the request rather
  // than taken from the signer: the receipt names the preimage, and the broker is the party that
  // derived it.
  let signedBytesDigest
  try {
    signedBytesDigest = createHash('sha256').update(approvalSigningBytes(request)).digest('hex')
  } catch (cause) {
    throw new ApprovalReceiptError(RECEIPT_REFUSE.MALFORMED, cause instanceof Error ? cause.message : String(cause))
  }
  return Object.freeze({
    domain: APPROVAL_RECEIPT_DOMAIN,
    verdict: OWNER_KEY_SIGNED,
    keyClass,
    keyClassMeaning: KEY_CLASSES[keyClass],
    approvalClass: wanted,
    subject: readAukoraId(fields.subject, 'approval receipt.subject'),
    activeControlDigest: readDigest(fields.activeControlDigest, 'approval receipt.activeControlDigest'),
    approvalKeyDid: readExactAtom(fields.approvalKeyDid, 'approval receipt.approvalKeyDid', 256),
    operationDigest: readDigest(approval.operationDigest, 'approval receipt.operationDigest'),
    challenge: readDigest(approval.challenge, 'approval receipt.challenge'),
    // The window and the signature travel IN the receipt because a verifier that holds only the
    // receipt and the registered public key must be able to re-derive the exact bytes and check the
    // signature itself. Without them the record names a claim nobody else can test.
    issuedAt: readNonNegativeInteger(request.issuedAt, 'approval receipt.issuedAt'),
    expiresAt: readNonNegativeInteger(request.expiresAt, 'approval receipt.expiresAt'),
    signature: readSignatureHex(approval.signature),
    signedBytesDigest,
    verifiedAt: readNonNegativeInteger(approval.verifiedAt, 'approval receipt.verifiedAt'),
    attendance: 'reported-not-proven',
    signerDeviceTrusted: 'not-established',
    succession: 'unmeasured',
    identityBound: false,
    ceilings: Object.freeze(signerCeilingLines()),
  })
}

/**
 * Parse one serialized approval receipt as a CLOSED record.
 *
 * This is the stranger side's first step and it is deliberately strict: exactly the published
 * fields, every one an enumerable data property, no symbol keys, no accessors, no extra field. A
 * verifier that tolerates an extra field is a verifier that can be handed `{...valid, ceiling:
 * "none"}` and will print a verdict over bytes nobody agreed to.
 *
 * It validates SHAPE only. Whether the signature is real, and whether the identifier names the key
 * that will be used, are separate questions with separate refusals — a parser that also answered
 * them would collapse "this is not a receipt" into "this receipt is wrong".
 *
 * @param {unknown} input - candidate receipt.
 * @returns {Readonly<Record<string, unknown>>} detached frozen receipt.
 */
export function parseApprovalReceipt(input) {
  let fields
  try {
    fields = readClosedDataRecord(input, APPROVAL_RECEIPT_FIELDS, 'approval receipt')
  } catch (cause) {
    throw new ApprovalReceiptError(RECEIPT_REFUSE.MALFORMED, cause instanceof Error ? cause.message : String(cause))
  }
  try {
    if (fields.domain !== APPROVAL_RECEIPT_DOMAIN) {
      throw new TypeError(`approval receipt.domain: must equal ${APPROVAL_RECEIPT_DOMAIN}`)
    }
    if (fields.verdict !== OWNER_KEY_SIGNED) {
      throw new TypeError(`approval receipt.verdict: must equal ${OWNER_KEY_SIGNED}`)
    }
    if (!Object.hasOwn(KEY_CLASSES, /** @type {string} */ (fields.keyClass))) {
      throw new TypeError(`approval receipt.keyClass: must be one of ${Object.keys(KEY_CLASSES).join(', ')}`)
    }
    if (fields.keyClassMeaning !== KEY_CLASSES[/** @type {'A'|'B'|'C'} */ (fields.keyClass)]) {
      throw new TypeError('approval receipt.keyClassMeaning: does not match the key class it names')
    }
    if (!APPROVAL_CLASSES.includes(/** @type {string} */ (fields.approvalClass))) {
      throw new TypeError(`approval receipt.approvalClass: must be one of ${APPROVAL_CLASSES.join(', ')}`)
    }
    if (typeof fields.identityBound !== 'boolean') {
      throw new TypeError('approval receipt.identityBound: must be a boolean')
    }
    if (!Array.isArray(fields.ceilings) || fields.ceilings.some(line => typeof line !== 'string')) {
      throw new TypeError('approval receipt.ceilings: must be an array of strings')
    }
    return Object.freeze({
      domain: APPROVAL_RECEIPT_DOMAIN,
      verdict: OWNER_KEY_SIGNED,
      keyClass: fields.keyClass,
      keyClassMeaning: KEY_CLASSES[/** @type {'A'|'B'|'C'} */ (fields.keyClass)],
      approvalClass: fields.approvalClass,
      subject: readAukoraId(fields.subject, 'approval receipt.subject'),
      activeControlDigest: readDigest(fields.activeControlDigest, 'approval receipt.activeControlDigest'),
      approvalKeyDid: readExactAtom(fields.approvalKeyDid, 'approval receipt.approvalKeyDid', 256),
      operationDigest: readDigest(fields.operationDigest, 'approval receipt.operationDigest'),
      challenge: readDigest(fields.challenge, 'approval receipt.challenge'),
      issuedAt: readNonNegativeInteger(fields.issuedAt, 'approval receipt.issuedAt'),
      expiresAt: readNonNegativeInteger(fields.expiresAt, 'approval receipt.expiresAt'),
      signature: readSignatureHex(fields.signature),
      signedBytesDigest: readDigest(fields.signedBytesDigest, 'approval receipt.signedBytesDigest'),
      verifiedAt: readNonNegativeInteger(fields.verifiedAt, 'approval receipt.verifiedAt'),
      attendance: readExactAtom(fields.attendance, 'approval receipt.attendance', 64),
      signerDeviceTrusted: readExactAtom(fields.signerDeviceTrusted, 'approval receipt.signerDeviceTrusted', 64),
      succession: readExactAtom(fields.succession, 'approval receipt.succession', 64),
      identityBound: fields.identityBound,
      ceilings: Object.freeze([...fields.ceilings]),
    })
  } catch (cause) {
    if (cause instanceof ApprovalReceiptError) throw cause
    throw new ApprovalReceiptError(RECEIPT_REFUSE.MALFORMED, cause instanceof Error ? cause.message : String(cause))
  }
}

/**
 * The receipt as printable lines, so the verdict and its limits are emitted together.
 *
 * A caller that prints the verdict without the ceilings has produced a claim rather than a
 * record, so the two travel in one function and the court asserts the lines appear together.
 * @param {unknown} receipt - a receipt from {@link createApprovalReceipt}.
 * @returns {string[]} printable lines.
 */
export function approvalReceiptLines(receipt) {
  const lines = [
    `RECEIPT: ${receipt.domain}`,
    `VERDICT: ${receipt.verdict}`,
    `KEY_CLASS: ${receipt.keyClass} (${receipt.keyClassMeaning})`,
    `APPROVAL_CLASS: ${receipt.approvalClass}`,
    `SUBJECT: ${receipt.subject}`,
    `ACTIVE_CONTROL_DIGEST: ${receipt.activeControlDigest}`,
    `APPROVAL_KEY_DID: ${receipt.approvalKeyDid}`,
    `OPERATION_DIGEST: ${receipt.operationDigest}`,
    `CHALLENGE: ${receipt.challenge}`,
    `ISSUED_AT: ${String(receipt.issuedAt)}`,
    `EXPIRES_AT: ${String(receipt.expiresAt)}`,
    `SIGNATURE: ${receipt.signature}`,
    `SIGNED_BYTES_DIGEST: ${receipt.signedBytesDigest}`,
    `VERIFIED_AT: ${String(receipt.verifiedAt)}`,
    `ATTENDANCE: ${receipt.attendance}`,
    `SIGNER_DEVICE_TRUSTED: ${receipt.signerDeviceTrusted}`,
    `SUCCESSION: ${receipt.succession}`,
    `IDENTITY_BOUND: ${String(receipt.identityBound)}`,
  ]
  return [...lines, ...receipt.ceilings.map(line => `  ${line}`)]
}

/** Read one 128-character lowercase-hex Ed25519 signature. */
function readSignatureHex(value) {
  if (typeof value !== 'string' || value.length !== 128 || !/^[0-9a-f]{128}$/u.test(value)) {
    throw new ApprovalReceiptError(
      RECEIPT_REFUSE.MALFORMED,
      'approval receipt.signature: must be 128 lowercase hexadecimal characters',
    )
  }
  return value
}

/** The canonical bytes of one receipt, for a consumer that wants to pin what it read. */
export function approvalReceiptBytes(receipt) {
  return Buffer.from(canonicalJSON(receipt), 'utf8')
}
