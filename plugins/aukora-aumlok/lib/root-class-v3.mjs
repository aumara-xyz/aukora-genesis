/**
 * ROOT-CLASS ACTS AND APPROVALS: which KIND of key signed, not merely whether a signature verifies.
 *
 * THE ONE QUESTION THIS MODULE ANSWERS. "Does this signature verify under some key of mine?" is the
 * wrong question, and answering it is how an identity system fails open: a machine key that can sign a
 * refresh means a stolen laptop is a stolen identity, and a root key that can sign an approval means
 * every approval costs seven typed words. So this module classifies the SIGNER first and verifies the
 * signature second, and the two classes are disjoint by construction.
 *
 *   APPROVALS      per-operation acts. The machine key signs them, because the machine is what is
 *                  present when a person is not. `approve-operation` is the one act here.
 *   ROOT-CLASS     acts that change the IDENTITY rather than approve an operation: refresh, revoke,
 *                  vouch, delegation, forget, cortex-change. ONLY the root signs these. The plan's
 *                  wording is "verify only under the root; cross-signature refused by name", and the
 *                  name is {@link ROOT_CLASS_REFUSE.MACHINE_MAY_NOT_SIGN_ROOT_CLASS}.
 *
 * "CROSS-SIGNATURE" MEANS A SIGNATURE BY THE WRONG CLASS, which is why the class is decided from the
 * KEY THAT ACTUALLY SIGNED (`signerKeyHex`) and not from what a caller claims. A caller passing
 * `signer: 'root'` alongside a machine key changes nothing: the key decides, and the signer key is
 * compared against the root the record publishes and against the machines the record lists.
 *
 * A REVOKED MACHINE IS AN UNKNOWN MACHINE. If the key that signed is not in `machines[]`, it is refused
 * as {@link ROOT_CLASS_REFUSE.UNKNOWN_SIGNER} — which is what makes "a stolen machine = one root-signed
 * revoke and one bind" true rather than aspirational: after the revoke, the stolen key is simply not a
 * key this record recognises.
 *
 * WHAT THIS DOES NOT DO. It does not decide whether the ACT should happen — no policy, no limits, no
 * ordering. It answers exactly one question about one signature, so that a caller cannot answer it
 * differently in two places.
 *
 * @module @aukora/dsh-plugin-aumlok/root-class-v3
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { canonicalJSON } from './canonical.mjs'
import { verifyEd25519Detailed } from './ed25519-verify.mjs'

/** Domain separation for everything this module signs. Pinned, and never composed. */
export const ROOT_CLASS_SIGNING_DOMAIN = 'aukora:aumlok-root-class:v3'

/** The acts that change the identity. ONLY the root signs these. */
export const ROOT_CLASS_ACTS = Object.freeze([
  'refresh',
  'revoke',
  'vouch',
  'delegation',
  'forget',
  'cortex-change',
])

/** The acts the machine key signs, because the machine is what is present. */
export const MACHINE_CLASS_ACTS = Object.freeze([
  'approve-operation',
])

/** Refusals this module produces by name. */
export const ROOT_CLASS_REFUSE = Object.freeze({
  /** A root key signed an approval. The root is not an approval key. */
  APPROVAL_IS_NOT_ROOT_CLASS: 'aumlok:approval-is-not-root-class',
  /** A machine key signed a root-class act. The cross-signature the plan refuses by name. */
  MACHINE_MAY_NOT_SIGN_ROOT_CLASS: 'aumlok:machine-may-not-sign-root-class',
  /** The signing key is neither the published root nor a listed machine. */
  UNKNOWN_SIGNER: 'aumlok:root-class-unknown-signer',
  /** The signature does not verify under the key that claims to have made it. */
  SIGNATURE_INVALID: 'aumlok:root-class-signature-invalid',
  /** The act is not in either class. */
  ACT_UNKNOWN: 'aumlok:root-class-act-unknown',
  /** The request cannot be parsed at all. */
  REQUEST_MALFORMED: 'aumlok:root-class-request-malformed',
})

/** PKCS#8 DER prefix wrapping a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const SEED_HEX = /^[0-9a-f]{64}$/u
const PUB_HEX = /^[0-9a-f]{64}$/u
const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u

/**
 * The exact bytes one act signs.
 *
 * THE SUBJECT AND THE EPOCH ARE INSIDE THE SIGNED BYTES, so a signature cannot be replayed onto a
 * different identity, and a root-class act cannot be moved to another epoch by whoever is holding the
 * message. The act name is inside too, so an approval signature can never be presented as a refresh.
 * @param {{act: string, subject: string, epoch: number}} request - what is being signed.
 * @returns {Buffer} the canonical bytes.
 */
export function rootClassSigningBytes({ act, subject, epoch }) {
  return Buffer.from(`${ROOT_CLASS_SIGNING_DOMAIN}\u0000${canonicalJSON({ act, subject, epoch })}`, 'utf8')
}

/**
 * Sign one act with either class of key.
 *
 * THE SIGNER IS DECLARED AND THEN CHECKED AGAINST THE KEY, never trusted: the seed the caller passes
 * decides which key is used, and `verifyRootClassAct` re-decides the class from the public key. A
 * caller that passes a machine seed with `signer: 'root'` gets a machine signature that verification
 * will classify as a machine.
 * @param {{operation: string, subject: string, epoch: number, root?: object, machine?: object,
 *   signer: 'root'|'machine'}} input - the act, the identity, and the key material to sign with.
 * @returns {Readonly<{signature: string, publicKeyHex: string, act: string, signer: string}>} the signature.
 */
export function signOperation({ operation, subject, epoch, root, machine, signer } = /** @type {never} */ ({})) {
  if (typeof subject !== 'string' || !SUBJECT.test(subject)
    || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0
    || typeof operation !== 'string' || operation.length === 0) {
    throw new TypeError(`${ROOT_CLASS_REFUSE.REQUEST_MALFORMED}: an act, a subject and an epoch are required`)
  }
  const seedHex = signer === 'root' ? root?.ed25519SeedHex : machine?.ed25519SeedHex
  const publicKeyHex = signer === 'root' ? root?.ed25519PublicKeyHex : machine?.ed25519PublicKeyHex
  if (typeof seedHex !== 'string' || !SEED_HEX.test(seedHex)
    || typeof publicKeyHex !== 'string' || !PUB_HEX.test(publicKeyHex)) {
    throw new TypeError(`${ROOT_CLASS_REFUSE.REQUEST_MALFORMED}: the ${String(signer)} signer has no key`)
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
  const bytes = rootClassSigningBytes({ act: operation, subject, epoch })
  return Object.freeze({
    act: operation,
    signer,
    publicKeyHex,
    signature: sign(null, bytes, privateKey).toString('hex'),
  })
}

/**
 * Classify the signing key, then verify the signature under it.
 *
 * THE ORDER MATTERS AND IS THE POINT. An approval signed by the root is refused even though the
 * signature is perfectly valid, and a refresh signed by a machine key is refused for the same reason:
 * these are refusals about the CLASS of the signer, and they are reached before any signature check
 * could make them look like successes.
 * @param {{act: string, subject: string, epoch: number, signature: string, signerKeyHex: string,
 *   record: object, machines: readonly object[]}} input - the request and the identity it names.
 * @returns {Readonly<{ok: boolean, reason?: string, class?: string}>} the verdict, never an exception.
 */
export function verifyRootClassAct({ act, subject, epoch, signature, signerKeyHex, record, machines } = /** @type {never} */ ({})) {
  const refuse = reason => Object.freeze({ ok: false, reason })
  if (typeof act !== 'string' || typeof subject !== 'string' || !SUBJECT.test(subject)
    || typeof epoch !== 'number' || typeof signature !== 'string' || typeof signerKeyHex !== 'string') {
    return refuse(ROOT_CLASS_REFUSE.REQUEST_MALFORMED)
  }
  const isRootClass = ROOT_CLASS_ACTS.includes(act)
  const isMachineClass = MACHINE_CLASS_ACTS.includes(act)
  if (!isRootClass && !isMachineClass) return refuse(ROOT_CLASS_REFUSE.ACT_UNKNOWN)

  // THE ROOT THE RECORD PUBLISHES, and the machines it lists. A record that names no root cannot
  // authorise anything: refusing here is what stops a malformed record from being read as permission.
  const rootKey = record?.publicRoot?.ed25519 ?? record?.ed25519
  if (typeof rootKey !== 'string' || !PUB_HEX.test(rootKey)) return refuse(ROOT_CLASS_REFUSE.REQUEST_MALFORMED)
  const listed = (Array.isArray(machines) ? machines : Array.isArray(record?.publicRoot?.machines)
    ? record.publicRoot.machines : [])
    .map(entry => entry?.ed25519)
    .filter(key => typeof key === 'string')

  const signedByRoot = signerKeyHex === rootKey
  const signedByMachine = listed.includes(signerKeyHex)
  if (!signedByRoot && !signedByMachine) return refuse(ROOT_CLASS_REFUSE.UNKNOWN_SIGNER)
  // The cross-signature refusals, BY NAME, before the signature is even looked at.
  if (isRootClass && !signedByRoot) return refuse(ROOT_CLASS_REFUSE.MACHINE_MAY_NOT_SIGN_ROOT_CLASS)
  if (isMachineClass && !signedByMachine) return refuse(ROOT_CLASS_REFUSE.APPROVAL_IS_NOT_ROOT_CLASS)

  // ONE VERIFIER, AND THE POINT IS CHECKED BEFORE THE LIBRARY IS ASKED (row 15).
  //
  // MEASURED AT HEAD: this called node:crypto's `verify` directly, so the verdict was OPENSSL'S rather than this
  // repository's - while the Python copies in scripts/composition/ed25519.py refuse a small-order point in their
  // own code. The organs did not disagree about the answer; they disagreed about WHO WAS ANSWERING, and a
  // library's guarantee can be changed by a version bump nobody here reviews.
  const verified = verifyEd25519Detailed({
    publicKeyHex: signerKeyHex,
    message: rootClassSigningBytes({ act, subject, epoch }),
    signatureHex: signature,
  })
  if (!verified) return refuse(ROOT_CLASS_REFUSE.SIGNATURE_INVALID)
  return Object.freeze({ ok: true, class: signedByRoot ? 'root' : 'machine' })
}
