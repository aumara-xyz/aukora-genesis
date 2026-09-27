// AUKORA ONE · authority/hybrid-keygen.mjs — RING 1
//
// Hybrid owner key birth: seeds in, PUBLIC material out.
//
// PROVENANCE: ADAPTED from AUKORA-EVOLUTION 🧬 @ 68210d479a35e325eda4e14ac8fba5dc87db979e,
// `apps/seed/src/hybridKeygen.ts`, blob sha256
// c32563070a2853073b00fc5208b8907d228f122fed573d0506996efcc3d89a95.
// See PROVENANCE.md for the full row and the enumerated adaptations.
//
// ══ WHAT LEAVES THIS MODULE ══
//
// Public bytes only. `derivePublicKeys` and `buildOwnerRoot` return public
// material by construction; the expanded ML-DSA secret key produced on the way
// is a local that goes out of scope with the call. `HybridOwnerSeeds` — the one
// shape in this repository that carries private bytes — is never persisted here,
// never receipted, never logged, and never stringified into an error. The
// seed-validation failure throws the content-free `aumlok_keygen_seed_invalid`
// and never echoes the offending value.
//
// ══ THE RNG IS AN ARGUMENT, AND THAT IS LOAD-BEARING ══
//
// `generateOwnerSeeds` takes its randomness as a parameter, defaulting to the OS
// CSPRNG. The donor's own comment says why: "so a test can pin a vector without
// a real key." Every test in this repository injects a deterministic generator
// and never reaches `randomBytes`, which keeps the suite deterministic
// (AGENTS.md §4–5: no ambient randomness in a constitutional decision) and means
// no test has ever caused real owner entropy to be produced.
//
// ══ A ROOT MINTED HERE IS A ROOT THE KERNEL ACCEPTS ══
//
// `rootId` and `integrity` come from the kernel's own derivations, so a root
// built here is exactly the shape `verifyAumlokPromotionV2` re-derives and checks
// at verification time. A root that would be rejected later cannot be produced
// now — there is no second implementation to drift.

import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { aumlokRootId, aumlokRootIntegrity } from './authority.js';
// The mode constant has ONE definition in this lane, on the verifying gate.
// Keygen consumes it rather than declaring a second one, so a root minted here
// and a promotion verified there can never disagree about it.
import { AUMLOK_MODE } from './aumlok-gate.mjs';

/** The one suite this organism's authority speaks. */
export const AUMLOK_SUITE = 'aumlok-ed25519-ml-dsa-65-v1';

/** Both seeds are 32 bytes: Ed25519 takes a 32-byte seed, ML-DSA-65 keygen takes a 32-byte seed. */
export const SEED_BYTES = 32;
const SEED_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Custody account names for the two private halves. Stable, so a restart finds
 * the same items.
 *
 * ADAPTATION: the donor namespaces these `evolution-*`. Renamed to `aukora-one-*`
 * for the same reason the Keychain SERVICE was renamespaced — a live Evolution
 * node holds `evolution-owner-*` items on this machine, and account names are the
 * second half of the `security(1)` lookup key. The service allowlist in
 * `secure-custody.mjs` already makes a cross-node read impossible; this makes it
 * impossible twice, including against a hand-typed command aimed at the wrong
 * service.
 */
export const CUSTODY_ACCOUNTS = Object.freeze({
  edSeed: 'aukora-one-owner-ed25519-seed',
  mlSeed: 'aukora-one-owner-mldsa65-seed',
});

/**
 * Is this a well-formed 32-byte hex seed?
 *
 * Shape only. It says nothing about whether the seed is any particular owner's,
 * and nothing here can answer that question.
 */
export function isSeedHex(value) {
  return typeof value === 'string' && SEED_HEX_RE.test(value);
}

/**
 * Fresh owner seeds.
 *
 * `rng` is injectable so a test can pin a vector without a real key — carried
 * from the donor, and relied on by every test in this lane.
 */
export function generateOwnerSeeds(rng = (n) => new Uint8Array(randomBytes(n))) {
  return {
    ed25519Seed: bytesToHex(rng(SEED_BYTES)),
    mlDsa65Seed: bytesToHex(rng(SEED_BYTES)),
  };
}

/**
 * Derive the PUBLIC hybrid key pair from the seeds.
 *
 * Public bytes out. The expanded ML-DSA secret key produced on the way is a local
 * that goes out of scope with this call.
 */
export function derivePublicKeys(seeds) {
  if (!isSeedHex(seeds?.ed25519Seed) || !isSeedHex(seeds?.mlDsa65Seed)) {
    throw new Error('aumlok_keygen_seed_invalid'); // content-free: the bad value is never echoed
  }
  const edPublic = ed25519.getPublicKey(hexToBytes(seeds.ed25519Seed));
  const mlKeys = ml_dsa65.keygen(hexToBytes(seeds.mlDsa65Seed));
  return { ed25519: bytesToHex(edPublic), mlDsa65: bytesToHex(mlKeys.publicKey) };
}

/**
 * Build the canonical PUBLIC authority root.
 *
 * `createdAt` must be canonical ISO-UTC-millis (`YYYY-MM-DDTHH:MM:SS.mmmZ`).
 */
export function buildOwnerRoot(publicKeys, createdAt, expiresAt = null) {
  const base = {
    schema: 'aumlok-authority-root-v2',
    suite: AUMLOK_SUITE,
    rootId: aumlokRootId(publicKeys),
    publicKeys: { ed25519: publicKeys.ed25519, mlDsa65: publicKeys.mlDsa65 },
    mode: AUMLOK_MODE,
    createdAt,
    expiresAt,
    revoked: false,
  };
  return { ...base, integrity: aumlokRootIntegrity(base) };
}

/** Convenience: seeds → public root, in one step, with no private material in the return. */
export function ownerRootFromSeeds(seeds, createdAt, expiresAt = null) {
  return buildOwnerRoot(derivePublicKeys(seeds), createdAt, expiresAt);
}

/**
 * The short PUBLIC fingerprint a bond ceremony pins.
 *
 * Taken from the rootId, itself a hash over the two public keys — so this is
 * public by construction, and far below the length that would look like key bytes.
 */
export function publicFingerprint(root) {
  return root.rootId.slice(0, 32);
}

/** HARD: minting a keypair is not permission — only a hybrid-verified signature crosses. */
export function hybridKeygenGrantsAuthority() {
  return false;
}
