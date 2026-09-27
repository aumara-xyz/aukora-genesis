// AUKORA ONE · authority/hybrid-signer.mjs — RING 1
//
// ██ THE OWNER'S SIGNING HALF ██
//
// The ONLY module in this repository that can produce an owner authorization,
// and the only one that touches private material.
//
// PROVENANCE: ADAPTED from AUKORA-EVOLUTION 🧬 @ 68210d479a35e325eda4e14ac8fba5dc87db979e,
// `apps/seed/src/hybridSigner.ts`, blob sha256
// ad1a6ca569bba90d735bcda7d82547ad1db582790830cfe1b9a74df9dfb57e1b.
// Adaptation is TypeScript → `.mjs` and relative-specifier renames only; the
// signing logic is line-for-line the donor's. See PROVENANCE.md.
//
// ══ THE EXCLUSION IS THE LOAD-BEARING PROPERTY OF THIS BRICK ══
//
// **Nothing imports this file.** Not another authority module, not the gate, not
// the fence, not any future door. In the donor that exclusion is asserted by
// containment tests rather than intended in a comment, and the same is true here:
// `test/authority-signer-containment.test.mjs` scans every module in this
// repository and fails if a single non-test importer appears.
//
// That is what makes "the ceremony never signs" a property of the import graph
// instead of a promise. The verifying gate (`aumlok-gate.mjs`) checks an
// authorization that arrives ALREADY signed; it cannot produce one. The
// separation is structural.
//
// If you are about to import this module from anywhere that is not the owner's
// own deliberate local command, you are about to break the property this entire
// brick exists to establish. The suite will stop you. That is the point.
//
// ══ WHERE THIS IS ALLOWED TO RUN ══
//
// From the owner's own terminal, invoked deliberately, on the owner's own
// machine. There is no CLI wired in this repository yet, so today the only
// caller is the containment suite itself — which signs with a loudly-labelled
// non-secret test vector and never with owner material.
//
// ══ WHAT IT SIGNS ══
//
// Exactly the bytes the kernel verifies: `canonicalAumlokPromotion(authorization)`
// from `@aukora/kernel/authority`. One shared canonicalization, no second
// implementation — the anti-confused-deputy anchor. Ed25519 signs the message
// with NO context; ML-DSA-65 signs the SAME message under the
// `aumlok-promotion-v2` purpose domain, which is what blocks cross-profile
// signature replay.
//
// That asymmetry is easy to "tidy" and must not be. Both signatures go into one
// `SignedPromotionV2`, and **there is no code path here that emits a promotion
// carrying only one of them** — so this module cannot mint the downgraded shape
// the verifier refuses.
//
// ══ WHAT NEVER LEAVES ══
//
// The seeds arrive as an argument and stay on this call's stack. Nothing here
// logs, prints, throws with, or returns private bytes; the expanded ML-DSA secret
// key is a local that dies with the call. The seed-validation failure throws the
// content-free `aumlok_sign_seed_invalid` and never echoes the seed.

import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalAumlokPromotion } from './authority.js';
import { PURPOSE_DOMAINS } from './registry.js';
import { AUMLOK_SUITE, isSeedHex } from './hybrid-keygen.mjs';
import { AUMLOK_MODE } from './aumlok-gate.mjs';

/**
 * Sign an authorization with BOTH owner halves.
 *
 * The caller supplies the fully-formed `authorization` — including the `nonce`,
 * which an approval surface binds to its own single-use challenge. A signature is
 * therefore bound to one gesture on one payload: it authorizes that and nothing
 * else, and it is spent when the consuming surface consumes it.
 */
export function signOwnerPromotion(seeds, authorization) {
  if (!isSeedHex(seeds?.ed25519Seed) || !isSeedHex(seeds?.mlDsa65Seed)) {
    throw new Error('aumlok_sign_seed_invalid'); // content-free
  }
  const message = canonicalAumlokPromotion(authorization);
  const edSignature = bytesToHex(ed25519.sign(message, hexToBytes(seeds.ed25519Seed)));
  const mlSecret = ml_dsa65.keygen(hexToBytes(seeds.mlDsa65Seed)).secretKey;
  const mlSignature = bytesToHex(
    ml_dsa65.sign(message, mlSecret, { context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion) }),
  );
  return {
    schema: 'aumlok-signed-promotion-v2',
    suite: AUMLOK_SUITE,
    authorization,
    signatures: { ed25519: edSignature, mlDsa65: mlSignature },
    mode: AUMLOK_MODE,
  };
}

/** HARD: producing a signature is the owner's act, taken here on the owner's explicit local invocation. */
export function hybridSignerGrantsAuthority() {
  return false;
}
