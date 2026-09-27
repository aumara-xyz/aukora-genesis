/**
 * **ONE VERIFIER: THE POINT IS CHECKED BEFORE `node:crypto` IS ASKED (cohesion plan §3 AUMLOK, row 15).**
 *
 * ── THE DEFECT, MEASURED AT HEAD ──────────────────────────────────────────────────────────────────────────
 *
 * Two node sites called `node:crypto`'s `verify` **directly**, with no check on the key:
 *
 *     root-class-v3.mjs:174   verify(null, rootClassSigningBytes({act, subject, epoch}), publicKey, …)
 *     refresh-v3.mjs:199      verify(null, handoverSigningBytes(line), publicKey, …)
 *
 * **SO THE VERDICT AT THOSE SITES WAS OPENSSL'S, NOT OURS**, while the Python copies in
 * `scripts/composition/ed25519.py` refuse a small-order point **explicitly and in their own code**. *The organs
 * did not disagree about the answer; they disagreed about who was answering* — and a library's guarantee can be
 * changed by a version bump nobody in this repository reviews.
 *
 * ── **AND WHAT I MEASURED, WHICH IS NOT WHAT THE ROW PREDICTS** ───────────────────────────────────────────
 *
 * The row says *"node:crypto accepts the small-order identity-key forgery"*. **ON THIS MACHINE IT DOES NOT.**
 * MEASURED on node 22.23.0, all five canonical small-order encodings — `y=0`, `y=0` with the sign bit, **`y=1`
 * (the identity)**, `y=p-1`, and `y=p-1` with the sign bit — are **rejected**, with a zero signature, a garbage
 * signature, and under a real message. **I could not reproduce the premise, and I am saying so rather than
 * restating it.**
 *
 * **THE FIX IS STILL RIGHT, AND FOR A REASON THAT DOES NOT DEPEND ON THAT MEASUREMENT:** the wrapper makes the
 * verdict **ours**. A check that holds because OpenSSL currently refuses is *a check that holds until it does not*,
 * and the failure mode is a forgery accepted by one organ and refused by another — which is the divergence the row
 * is actually about. **We do not have to reproduce a defect to stop depending on somebody else's behaviour.**
 *
 * ── WHY IT REUSES `ed25519-point.mjs` RATHER THAN ADDING ARITHMETIC ───────────────────────────────────────
 *
 * `isValidEd25519Point` already performs the prime-order test — decode `y`, reject the identity, and require
 * `[L]P == identity` — and the tree already uses it elsewhere (`control.mjs`, `service.mjs`, `index.mjs`).
 * **AGENTS.md forbids a hand-written curve, and row 43 retires this one in favour of a single noble version**, so
 * importing the existing check is the honest interim: it adds no arithmetic, and when row 43 lands there is one
 * call site to move rather than two.
 */
import { createPublicKey, verify } from 'node:crypto'
import { isValidEd25519Point } from './ed25519-point.mjs'

/** The SPKI prefix for an Ed25519 public key: the fixed header, then the 32-byte point. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** Every way this verifier can refuse, named, so a caller can tell them apart. */
export const ED25519_REFUSE = Object.freeze({
  POINT_MALFORMED: 'aukora-ed25519:point-malformed',
  POINT_NOT_PRIME_ORDER: 'aukora-ed25519:point-not-prime-order',
  SIGNATURE_MALFORMED: 'aukora-ed25519:signature-malformed',
  SIGNATURE_INVALID: 'aukora-ed25519:signature-invalid',
})

/**
 * Verify an Ed25519 signature **after** establishing that the key is a usable prime-order point.
 *
 * @param {object} input
 * @param {string} input.publicKeyHex 64 lowercase hex characters — the raw 32-byte point.
 * @param {Uint8Array} input.message the bytes that were signed.
 * @param {string} input.signatureHex 128 lowercase hex characters.
 * @returns {{ok: boolean, refusal: string|null}} the verdict and, when it is `false`, why.
 */
export function verifyEd25519Detailed({ publicKeyHex, message, signatureHex }) {
  // ── THE POINT FIRST, BECAUSE IT IS THE HALF A LIBRARY MIGHT NOT CHECK ────────────────────────────────────
  if (typeof publicKeyHex !== 'string' || !/^[0-9a-f]{64}$/u.test(publicKeyHex)) {
    return { ok: false, refusal: ED25519_REFUSE.POINT_MALFORMED }
  }
  if (!isValidEd25519Point(Buffer.from(publicKeyHex, 'hex'))) {
    // **THIS IS THE SMALL-ORDER REFUSAL, AND IT IS OURS.** A key that is not prime-order can make a signature
    // verify against bytes nobody signed, which is why the Python copies refuse it in their own code.
    return { ok: false, refusal: ED25519_REFUSE.POINT_NOT_PRIME_ORDER }
  }
  if (typeof signatureHex !== 'string' || !/^[0-9a-f]{128}$/u.test(signatureHex)) {
    return { ok: false, refusal: ED25519_REFUSE.SIGNATURE_MALFORMED }
  }
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    const ok = verify(null, message, publicKey, Buffer.from(signatureHex, 'hex')) === true
    return { ok, refusal: ok ? null : ED25519_REFUSE.SIGNATURE_INVALID }
  } catch {
    // A KEY THE LIBRARY WILL NOT EVEN PARSE IS NOT A VERIFIED SIGNATURE. The point has already passed our own
    // check, so this is the library refusing something we accepted — which is a refusal, never a pass.
    return { ok: false, refusal: ED25519_REFUSE.SIGNATURE_INVALID }
  }
}

/**
 * The boolean shape the two call sites already expect.
 * @param {object} input as {@link verifyEd25519Detailed}.
 * @returns {boolean} whether the signature is valid under a prime-order key.
 */
export function verifyEd25519(input) {
  return verifyEd25519Detailed(input).ok === true
}
