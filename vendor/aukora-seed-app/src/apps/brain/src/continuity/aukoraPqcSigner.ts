// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
// RE-VENDORED (WAVE 2) from aukora-symbiote@ed1824a blob a112e4021656d9be506a60eb0263675adfeef8ce on 2026-07-16; body unchanged.
/**
 * AUKORA PQC SIGNING ADAPTER (B1 increment 2) — the single chokepoint where ML-DSA-65 (FIPS 204) is touched.
 * Design record: canon/AUKORA_PQC_LIBRARY_DECISION.md (all four §8 sign-offs approved 2026-06-10).
 *
 * Centralization is the security property, enforced structurally:
 *  - DETERMINISTIC signing only ({extraEntropy:false}) — pinned HERE so no caller can silently reintroduce the
 *    hedged default and break byte-reproducibility (the seeded-evidence law). FIPS 204 prefers hedged; the forgone
 *    hedge guards fault-injection on physical signers — not this server-isolate threat model. DESIGNED choice.
 *  - SEEDED keygen only — seedless ml_dsa65.keygen() reaches randomBytes/getRandomValues, the one non-pure surface
 *    the deterministic design removes. The seed parser fails CLOSED (throw) on anything but 64-hex. The suite
 *    proves the property with a throwing-randomness probe, not a comment.
 *  - DOMAINS, NOT CONTEXT BYTES — callers pass an immutable string label (chainHead | cap | req | delegation |
 *    manifest — one per distinct signing PURPOSE in the kernel); the FIPS 204
 *    context bytes are minted INSIDE this module, fresh per call, from frozen string constants. Callers never hold
 *    context bytes, so there is nothing to mutate or mint (adversarial review B1.2: Object.freeze cannot freeze
 *    Uint8Array contents — exporting raw bytes left an in-process corruption footgun). Unknown domains refuse.
 *  - Fail-closed asymmetry (mirrors resolveChainSigningSeed vs chainSigningSeed): pqcSign THROWS on misconfiguration
 *    (a broken signer must error, never degrade); pqcVerify returns FALSE on any malformed/forged input (a refusal,
 *    never an exception), with exact-length + lowercase-canonical pre-checks before any lattice math
 *    (verification-cost DoS guard; one wire artifact has exactly one accepted hex representation).
 *  - NO Ed25519 anywhere in this module, and no fallback hooks: SignedChainHeadV3 verifies via the
 *    alg-id table below, which THROWS on unknown ids — algorithm-downgrade attempts become refusals, not fallbacks.
 *  - Best-effort key hygiene: per-call secret keys and parsed seeds are zeroized in finally blocks. JS gives no
 *    guarantee against GC-era heap copies — an accepted residual of the same class as the no-constant-time risk
 *    (decision record §7.3), documented, never claimed otherwise.
 *
 * The dependency tree was verified pure-JS in the decision record; the library itself has NO independent
 * third-party audit (§7.1 accepted risk) — this chokepoint exists so the primitive stays swappable.
 *
 * PURE: no Convex, no Node APIs, no WASM. @noble/post-quantum@0.6.1 (exact-pinned) + @noble/hashes utils,
 * byte-identical across Convex's V8 isolate, the edge-runtime test runner, and extracted TS clients. Async
 * signatures wrap sync compute so future call sites keep the existing await shape. Imports use explicit .js
 * subpaths (the only form @noble/hashes v2 exports — survives the planned hashes-v2 bump).
 */
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// ── Algorithm-id table (sign-off §8.4: dedicated byte at preimage[1], starting 0x04) ──
// 0x00–0x03 are HISTORICAL/RESERVED (V2 version byte, CT tree_hash(1), chain_hash(2), chain_checkpoint(3)) and are
// NEVER valid PQC alg-ids. Future entries (reserved, NOT implemented): 0x05 ml-dsa-87, 0x06 slh-dsa family.
// Byte [1] identifies the ALGORITHM only; purpose separation lives in the FIPS 204 domain context (§8.4 supersedes
// the §4 "ml_dsa_chain_hash" purpose+alg label — erratum recorded in the decision record).
export const PQC_ALG_ML_DSA_65 = 0x04;

export type PqcAlgInfo = { name: string; headAlg: string; publicKeyBytes: number; signatureBytes: number; seedBytes: number };
const PQC_ALG_TABLE = new Map<number, PqcAlgInfo>([
  [PQC_ALG_ML_DSA_65, Object.freeze({ name: "ml-dsa-65", headAlg: "ml-dsa-65-chainhead-v3", publicKeyBytes: 1952, signatureBytes: 3309, seedBytes: 32 })],
]);

/** Resolve an alg-id to its (frozen) parameters. THROWS on unknown or non-integer ids — an unrecognized algorithm
 *  byte is a refusal (algorithm-downgrade resistance), never a fallback to another verifier. */
export function pqcAlgInfo(algId: number): PqcAlgInfo {
  if (!Number.isInteger(algId)) throw new Error(`aukora_pqc_alg_unknown:${algId}`);
  const info = PQC_ALG_TABLE.get(algId);
  if (!info) throw new Error(`aukora_pqc_alg_unknown:${algId}`);
  return info;
}

export const PQC_SIZES = pqcAlgInfo(PQC_ALG_ML_DSA_65);

// ── Signing domains (the V3 FIPS 204 domain-separation labels) ──
// Callers name a DOMAIN; the context bytes are minted inside sign/verify from these frozen string constants
// (strings are immutable — no caller ever holds mutable context bytes). The set of valid domains is exactly this
// table, auditable in one place; an attacker-influenced context would require an unknown domain, which refuses.
export const PQC_DOMAINS = Object.freeze({
  chainHead: "aukora-chainhead-v3",   // receipt-chain heads + revocation heads (node signing key)
  cap: "aukora-cap-v3",               // PoP capability signatures (founder/operator key)
  req: "aukora-req-v3",               // PoP per-request signatures (founder/operator key)
  delegation: "aukora-delegation-v3", // carbon-root delegation grants + their revocations (ceremony.ts)
  manifest: "aukora-manifest-v3",     // release-manifest signatures (release authority, codeAttestation.ts)
  // B2 AUMLOK identity (ratified permanent labels, Peter §15.2). Registered now (B2.0b); the manifest/rotation
  // primitives that USE them land in B2.1/B2.2. One purpose per domain — no double-duty (anti-rogue-key separation).
  aumlokManifest: "aukora-aumlok-manifest-v1",     // root signs the identity delegation manifest
  aumlokSubjectPop: "aukora-aumlok-subjectpop-v1", // subject proof-of-possession counter-signature (manifest PoP / consume / self-revoke)
  aumlokRotation: "aukora-aumlok-rotation-v1",     // old root key signs the key-rotation statement (rotation ONLY, post B3.1)
  // B3.1 (P3, Peter §8 sign-off 2026-06-11): dedicated single-purpose domains, replacing the B2.3/B2.4 aumlokRotation
  // reuse — each domain now has exactly one purpose (cleaner cross-node audit before real identities exist).
  aumlokGenesis: "aukora-aumlok-genesis-v1",       // the self-sovereign ceremony challenge (was aumlokRotation reuse)
  aumlokMemRecall: "aukora-aumlok-memrecall-v1",   // memory-recall proof-of-possession (owner-root OR subject key)
  // M2b (MINTED 2026-07-05, owner-ratified via GH #103 chat approval): dedicated erase domain — owner-root key
  // ONLY (the delegated subject can never erase; Auma's ruling). Separate from aumlokMemRecall so a captured
  // recall PoP can never replay as an erase authorization — the exact anti-rogue-key class this registry exists for.
  aumlokMemErase: "aukora-aumlok-memerase-v1",     // memory-erase proof-of-possession (owner-root key ONLY)
  // B3.3 witness mesh (MINTED 2026-06-11, §10.2 Option B): ONE witness domain. The record type
  // (baseline | attestation | equivocation) is a MANDATORY field inside the signed preimage — a record signed as one
  // type can never verify as another. The WITNESS node's own signing key signs these (records, never authority).
  aukoraWitness: "aukora-witness-v1",
  // B3.4 ML-KEM channel (MINTED 2026-06-12, Peter §6 doors-ratified): binds a node's ML-KEM channel public key + epoch
  // + channel capability to its ML-DSA-65 node identity. Domain-separated from chainHead — a channel-key binding can
  // never verify as a chain head, nor the reverse. Confidentiality binding only; grants/gates/mints NOTHING (B2.4 holds).
  aukoraChannel: "aukora-channel-v1",
  // B3.5a cross-node IMPORT (MINTED 2026-06-13, Peter D1–D10 ruled). THIS node signs its own attestation that it
  // verified-and-recorded a foreign manifest/memory/revocation-view from an EXPLICITLY-pinned peer (audit RECORD, never
  // authority — imported records grant ZERO local effect authority; B2.4 holds). Domain-separated: an import attestation
  // can never verify as a chain head, manifest, or witness record. Was reserved in RESERVED_MESH_DOMAINS until now.
  aukoraNodeImport: "aukora-node-import-v1",
} as const);
export type PqcDomain = keyof typeof PQC_DOMAINS;

const enc = new TextEncoder();
for (const label of Object.values(PQC_DOMAINS)) {
  const n = enc.encode(label).length;
  if (n === 0 || n > 255) throw new Error(`aukora_pqc_context_len:${label}`); // FIPS 204 bound, asserted at load
}

/** Mint the FIPS 204 context bytes for a domain, fresh per call (no shared mutable state). THROWS
 *  aukora_pqc_context_unregistered on anything not in PQC_DOMAINS — own-property check, so prototype keys
 *  ("toString", "__proto__") refuse like any other unknown domain. */
function contextBytes(domain: PqcDomain): Uint8Array {
  if (typeof domain !== "string" || !Object.prototype.hasOwnProperty.call(PQC_DOMAINS, domain)) {
    throw new Error("aukora_pqc_context_unregistered");
  }
  return enc.encode(PQC_DOMAINS[domain]);
}

// ── Seed handling (fail closed; same 64-hex contract as resolveChainSigningSeed) ──
function parseSeed(seedHex: string): Uint8Array {
  if (typeof seedHex !== "string" || !/^[0-9a-fA-F]{64}$/.test(seedHex)) throw new Error("aukora_pqc_seed_invalid");
  return hexToBytes(seedHex.toLowerCase());
}

const HEX_LOWER = /^[0-9a-f]+$/; // wire artifacts are canonical lowercase — exactly one accepted representation

/** Shape check for an ML-DSA-65 public key as stored/pinned (3904 lowercase-hex chars). Trust-registry write paths
 *  use this to refuse pinning a legacy/garbage key — immutable-once-pinned means a malformed pin is otherwise a
 *  permanent trust-bricking (adversarial review B1.3b). Verification-protected paths (TOFU) don't need it: a wrong-
 *  shape key can never verify a V3 signature in the first place. */
export function isPqcPublicKeyHex(s: unknown): boolean {
  return typeof s === "string" && s.length === PQC_SIZES.publicKeyBytes * 2 && HEX_LOWER.test(s);
}

/** Derive the ML-DSA-65 public key (3904-char lowercase hex) from a 32-byte seed (64-hex, case-normalized in).
 *  ALWAYS seeded — the seedless keygen path (which consumes platform randomness) is unreachable from this module. */
export async function mlDsa65PublicKeyFromSeed(seedHex: string): Promise<string> {
  const seed = parseSeed(seedHex);
  let secretKey: Uint8Array | null = null;
  try {
    const keys = ml_dsa65.keygen(seed);
    secretKey = keys.secretKey;
    return bytesToHex(keys.publicKey);
  } finally {
    seed.fill(0);
    secretKey?.fill(0); // best-effort hygiene; GC-era heap copies are an accepted JS residual (§7.3 class)
  }
}

/** Sign message bytes under a named domain. Deterministic ({extraEntropy:false}) — two calls on identical inputs
 *  are byte-identical. THROWS on bad seed or unknown domain (fail closed at the signer). The per-call secret key
 *  is zeroized on exit (best-effort — see module header). */
export async function pqcSign(seedHex: string, message: Uint8Array, domain: PqcDomain): Promise<string> {
  const context = contextBytes(domain);
  const seed = parseSeed(seedHex);
  let secretKey: Uint8Array | null = null;
  try {
    secretKey = ml_dsa65.keygen(seed).secretKey;
    return bytesToHex(ml_dsa65.sign(message, secretKey, { extraEntropy: false, context }));
  } finally {
    seed.fill(0);
    secretKey?.fill(0);
  }
}

/** Verify a signature under a named domain. Returns FALSE on any failure — forged, tampered, truncated, non-hex,
 *  non-canonical-case, wrong-length, or unknown-domain input is a refusal, never an exception. Exact-length and
 *  lowercase-canonical pre-checks run before any lattice math (verification-cost DoS guard). */
export async function pqcVerify(publicKeyHex: string, message: Uint8Array, sigHex: string, domain: PqcDomain): Promise<boolean> {
  try {
    const context = contextBytes(domain);
    if (typeof publicKeyHex !== "string" || publicKeyHex.length !== PQC_SIZES.publicKeyBytes * 2 || !HEX_LOWER.test(publicKeyHex)) return false;
    if (typeof sigHex !== "string" || sigHex.length !== PQC_SIZES.signatureBytes * 2 || !HEX_LOWER.test(sigHex)) return false;
    return ml_dsa65.verify(hexToBytes(sigHex), message, hexToBytes(publicKeyHex), { context });
  } catch {
    return false;
  }
}
