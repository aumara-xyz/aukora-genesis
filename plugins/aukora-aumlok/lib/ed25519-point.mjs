import { ed25519 } from './vendor/noble-curves/curves/ed25519.js'

/**
 * A real Ed25519 point validator, because this lane needs one and did not have one.
 *
 * WHY THIS MODULE EXISTS AT ALL. `verifyAndApplyRootControlPromotion` refuses
 * `aumlok:ed25519-point-validator-unavailable` unless its capability set supplies
 * `validateEd25519Point`, and `nodeCryptoVerifierCapabilities()` supplies only `verifyEd25519`.
 * Measured 2026-09-22: the ONLY implementations of that capability anywhere in this repository are
 * `validateEd25519Point: () => true` inside two courts. So before this file, no production caller
 * could verify a root-control promotion — and the shape it would have taken, importing a constant
 * `true` into a signing path, is the fail-open this lane refuses everywhere else.
 *
 * ── **THE ARITHMETIC IS NOBLE'S NOW, NOT OURS (cohesion plan row 43)** ─────────────────────────────────────
 *
 * MEASURED AT HEAD: this file carried **162 lines of hand-written curve arithmetic** — field inversion, modular
 * exponentiation, point addition, scalar multiplication, `decompressX` — against `AGENTS.md`, which forbids
 * exactly that: *"Do not add a new curve implementation: use `node:crypto` or a library that is already vendored
 * and pinned."* The row's words: *"Two noble versions and a hand-written curve (DUP-11) … Use one noble version
 * that includes ed25519, and replace the point arithmetic."*
 *
 * **AND THE TREE ALREADY HAD THE RIGHT LIBRARY — TWICE, AT TWO VERSIONS:**
 *
 *     plugins/aukora-aumlok/lib/vendor/…   @noble/curves 2.2.0   curves/ = abstract/, utils.js   NO ed25519
 *     plugins/aukora-nostr/lib/vendor/…    @noble/curves 2.4.0   curves/ = …, ed25519.js        HAS IT
 *
 * So the version that can do this job is **nostr's 2.4.0**, and the arithmetic below is its `ed25519.Point`.
 * *A hand-written implementation beside a pinned library is the library's guarantee replaced by ours, and it is
 * the one thing the repository's own rules name first.*
 *
 * WHAT IT CHECKS, in the order the cheap failures come first:
 *
 *   1. **THE ENCODING DECODES** — `Point.fromHex` throws for bytes that are not a curve point, which is the same
 *      test the hand-written `decompressX` performed, done by the library;
 *   2. **THE POINT IS NOT SMALL-ORDER** — `[8]P` is the identity. **THIS IS THE CHECK THE HAND-WRITTEN CODE GOT
 *      RIGHT AND NAIVE NOBLE USE GETS WRONG:** MEASURED, `ed25519.Point.fromHex(<identity>).isTorsionFree()`
 *      returns **`true`**, because the identity satisfies `[L]P == 0` for *any* `L`. A small-subgroup public key
 *      is a real attack — it makes signatures forgeable for an attacker who chooses the key — so the ordering
 *      here is deliberate: **small-order first, torsion-free second.**
 *   3. **AND IT IS TORSION-FREE** — `[L]P` is the identity for the group order `L`, which the library computes.
 *
 * The identity is small-order, so it fails (2) and never reaches (3) — which is why this file needs no special
 * case for it, unlike the version it replaces.
 */

/**
 * @param {unknown} bytes 32 raw bytes of an Ed25519 public key.
 * @returns {boolean} whether the bytes name a usable prime-order point.
 */
export function isValidEd25519Point(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false
  let point
  try {
    // ── **HEX, NOT BYTES — MEASURED, AND THE CAUGHT ERROR HID IT** ─────────────────────────────────────────
    //
    // `ed25519.Point.fromHex` takes a **hex STRING**; given a `Uint8Array` it throws `hex string expected, got
    // object`. My first version passed the bytes, the `catch` below turned that TypeError into `false`, and
    // **EVERY VALID KEY WAS REFUSED** — a validator that says no to everything, which the court caught with
    // *"a genuine signature was refused"*. *A broad catch around a call whose argument type is wrong converts a
    // programming error into a verdict about the key.* The conversion is explicit here so the two cannot be
    // confused again.
    point = ed25519.Point.fromHex(Buffer.from(bytes).toString('hex'))
  } catch { return false }
  try {
    // **SMALL-ORDER FIRST, BECAUSE `isTorsionFree()` IS TRUE FOR THE IDENTITY.** `[8]P == 0` holds for every point
    // in the small subgroup — the identity, the order-2 and the order-4 points — and for those it is exactly the
    // property that makes a forged signature verify.
    if (point.multiply(8n).equals(ed25519.Point.ZERO)) return false
    return point.isTorsionFree() === true
  } catch {
    // A scalar multiplication the library refuses is a point it will not certify. Refused, never assumed.
    return false
  }
}

/**
 * The validator in the shape `verifyAndApplyRootControlPromotion` expects.
 * @param {unknown} publicKeyHex - 64 lowercase hex characters.
 * @returns {boolean} whether the key is a usable prime-order Ed25519 point.
 */
export function validateEd25519PublicKeyHex(publicKeyHex) {
  if (typeof publicKeyHex !== 'string' || !/^[0-9a-f]{64}$/u.test(publicKeyHex)) return false
  return isValidEd25519Point(Buffer.from(publicKeyHex, 'hex'))
}
