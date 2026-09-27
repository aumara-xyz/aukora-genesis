/**
 * THE STRANGER'S VERDICT MAY NOT DISAGREE WITH `node:crypto` — Fable's item (b), 2026-09-26.
 *
 * WHY. The stranger side of this repository verifies Ed25519 with its own Python (`vendor/receipt/toy/ed25519.py`),
 * and we have already measured that implementation getting a case catastrophically wrong: no small-order check, so one
 * signature verified two different messages under the identity key. `AGENTS.md` forbids adding a curve implementation
 * of our own and names `node:crypto` as the sanctioned second opinion — so the rule here is: ASK BOTH, AND IF THEY
 * DISAGREE, REFUSE. A signature that one implementation accepts and the other rejects is not evidence for anything.
 *
 * WHAT IT IS NOT: this is not a second verifier to trust instead of the stranger's. It is a cross-check that can only
 * ever produce "both agree" or a named refusal.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

/** The SPKI prefix for a raw 32-byte Ed25519 public key, so node:crypto can read one. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** A refusal that names the disagreement, so a caller can never report the stranger's answer alone. */
export class CrossCheckRefusal extends Error {
  constructor(detail) {
    super(`ed25519-crosscheck: ${detail}`)
    this.name = 'CrossCheckRefusal'
    this.detail = detail
  }
}

/**
 * What `node:crypto` says about a raw public key, a message and a signature.
 * @param {Uint8Array} pub - 32 raw bytes.
 * @param {Uint8Array} message
 * @param {Uint8Array} signature - 64 raw bytes.
 * @returns {boolean}
 */
export function nodeVerdict(pub, message, signature) {
  if (!(pub instanceof Uint8Array) || !(signature instanceof Uint8Array)) return false
  if (pub.length !== 32 || signature.length !== 64) return false
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]), format: 'der', type: 'spki' })
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signature))
  } catch {
    // A key node:crypto will not even load is a REFUSAL, not an error to propagate: the caller's question is "does
    // this verify", and the answer for an unusable key is no.
    return false
  }
}

/**
 * Both answers, or a named refusal when they disagree.
 * @param {{pub: Uint8Array, message: Uint8Array, signature: Uint8Array, strangerVerdict: boolean}} input
 * @returns {{node: boolean, stranger: boolean}}
 */
export function crossCheck({ pub, message, signature, strangerVerdict }) {
  if (typeof strangerVerdict !== 'boolean') {
    throw new CrossCheckRefusal('the stranger produced no boolean verdict, so there is nothing to agree with')
  }
  const node = nodeVerdict(pub, message, signature)
  if (node !== strangerVerdict) {
    throw new CrossCheckRefusal(`the stranger says ${String(strangerVerdict)} and node:crypto says ${String(node)} about the same bytes; neither answer may be reported alone`)
  }
  return { node, stranger: strangerVerdict }
}
