// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
// RE-VENDORED (WAVE 2) from aukora-symbiote@ed1824a blob b0c2a4fce11338b21d432cc88d54629ad06e2037 on 2026-07-16; sole change: ESM .js import suffix.
/**
 * AUKORA SIGNED CHAIN HEAD (SignedChainHeadV3) — closes the "compromised operator rewrites history" gap.
 *
 * Aukora's receipt chain links each receipt to the previous via SHA-256, but the chain HEAD
 * (auma_receipt_chain_head: {lastChainHash, count}) is a mutable row. The fix (RFC 6962 / RFC 9162 Certificate
 * Transparency, IETF SCITT RFC 9943): cryptographically SIGN the head after every append. Any modification then
 * invalidates the signature, and a lower count is a detectable truncation (high-water rollback/fork detection below).
 *
 * B1.3 (the PQC trust spine): heads are signed with ML-DSA-65 (FIPS 204) through the aukoraPqcSigner chokepoint —
 * deterministic signatures, named purpose domains, fail-closed alg-id table. The algorithm is BOUND INTO THE SIGNED
 * BYTES ([0] version 0x03, [1] alg-id 0x04), so tag stripping/swapping refuses; the stored headSigAlg is a
 * non-authoritative fast-reject hint. The Ed25519 V2 format was retired at the B1.3b hard cutover: there is NO
 * dual-mode and NO fallback — V2 material refuses through every V3 path (alg_mismatch / signature_invalid).
 * Phase 2 (Merkle inclusion/consistency proofs) LANDED in B1.5 — SignedChainHeadV4 (below) binds the RFC 6962
 * receipt-history root; see aukoraMerkleLog.ts + canon/AUKORA_MERKLE_LOG_DESIGN.md. Phase 3 (witness gossip /
 * equivocation detection) is B3/FUTURE.
 *
 * PURE: no Convex, no Node APIs. @noble/post-quantum via aukoraPqcSigner + @noble/hashes, wired so it runs
 * identically in Convex's V8 isolate, the node test runner, and the extracted kit's TS clients.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, concatBytes } from "@noble/hashes/utils.js";
import { PQC_ALG_ML_DSA_65, pqcAlgInfo, pqcSign, pqcVerify, mlDsa65PublicKeyFromSeed, PQC_SIZES, type PqcDomain } from "./aukoraPqcSigner.js";

export const SIGNED_HEAD_CHAIN_ID_PREFIX = "aukora-chain"; // domain-separation prefix for chain_id derivation

export type ChainHeadFields = {
  chainKey: string;      // bound into the payload as a 16-byte chain_id — a sig is valid ONLY for its own chain
  timestamp: number;     // ms since epoch — MUST be monotonic
  chainLength: number;   // number of receipts committed — MUST be monotonic
  chainHeadHash: string; // 64-hex (32 bytes) — the linear chain's current head hash (lastChainHash)
};

/** Derive the 16-byte chain_id bound into every signature: SHA-256("aukora-chain" || chainKey)[:16]. 128-bit,
 *  deterministic (no registry needed), domain-separated. Makes a head signature valid ONLY for its own chain — a
 *  signature lifted onto another chain's head row fails to verify (closes PAL-3 / cross-chain replay). */
export function deriveChainId(chainKey: string): Uint8Array {
  const enc = new TextEncoder();
  return sha256(concatBytes(enc.encode(SIGNED_HEAD_CHAIN_ID_PREFIX), enc.encode(chainKey))).slice(0, 16);
}

function writeU64BE(buf: Uint8Array, off: number, value: number): void {
  // FAIL CLOSED on garbage: reject NaN/Infinity/negative/non-safe-integer rather than silently clamping — a bad
  // number must error, never serialize to a misleading payload.
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`aukora_signed_head_u64_range:${value}`);
  // Split into high/low 32-bit halves. timestamp (ms) and chainLength are always < 2^53, so this is exact —
  // no BigInt (which the project's TS target predates). Byte order is identical to a BigInt u64 BE encoding.
  const v = value;
  const high = Math.floor(v / 0x100000000); // top 32 bits
  const low = v >>> 0;                       // bottom 32 bits (ToUint32 = v mod 2^32 for 0 ≤ v < 2^53)
  buf[off + 0] = (high >>> 24) & 0xff;
  buf[off + 1] = (high >>> 16) & 0xff;
  buf[off + 2] = (high >>> 8) & 0xff;
  buf[off + 3] = high & 0xff;
  buf[off + 4] = (low >>> 24) & 0xff;
  buf[off + 5] = (low >>> 16) & 0xff;
  buf[off + 6] = (low >>> 8) & 0xff;
  buf[off + 7] = low & 0xff;
}

// ═══════════════════════════════ SignedChainHeadV3 (the PQC head format) ═══════════════════════════════
// Same 66-byte layout as the retired V2 (the chain_id cross-chain domain separation survives byte-for-byte), with
// the algorithm BOUND INTO THE SIGNED BYTES: [0] = format version 0x03, [1] = algorithm id from the fail-closed
// table in aukoraPqcSigner.ts (0x04 = ml-dsa-65; unknown ids REFUSE — algorithm-downgrade resistance). Purpose
// separation is carried by the FIPS 204 domain context (chainHead | cap | req | delegation | manifest), NOT by
// byte [1] — so a signature is bound to (version, algorithm, chain, purpose) simultaneously.

export const SIGNED_HEAD_V3_VERSION = 0x03; // format version byte at [0] (the retired V2 used 0x00)
export const SIGNED_HEAD_V3_ALG = pqcAlgInfo(PQC_ALG_ML_DSA_65).headAlg; // "ml-dsa-65-chainhead-v3" — telemetry tag only

/** The exact 66-byte SignedChainHeadV3 preimage. THROWS on unknown algId (fail closed before any bytes are minted),
 *  on malformed chainHeadHash, and on out-of-range u64 fields (via writeU64BE). Layout:
 *    [0]      version        (0x03)
 *    [1]      algorithm id   (0x04 = ml-dsa-65; the dedicated alg-id table, sign-off §8.4)
 *    [2..17]  chain_id       (16 bytes = SHA-256("aukora-chain"||chainKey)[:16] — unchanged from V2, PAL-3)
 *    [18..25] timestamp      (uint64 BE, ms)
 *    [26..33] chain_length   (uint64 BE)
 *    [34..65] chain_head_hash(32 bytes) */
export function serializeSignedChainHeadV3(h: ChainHeadFields, algId: number = PQC_ALG_ML_DSA_65): Uint8Array {
  pqcAlgInfo(algId); // refuse unknown algorithms at mint time
  const buf = new Uint8Array(66);
  buf[0] = SIGNED_HEAD_V3_VERSION;
  buf[1] = algId;
  buf.set(deriveChainId(h.chainKey), 2);
  writeU64BE(buf, 18, h.timestamp);
  writeU64BE(buf, 26, h.chainLength);
  const hh = hexToBytes(h.chainHeadHash);
  if (hh.length !== 32) throw new Error(`aukora_signed_head_chain_hash_len:${hh.length}`);
  buf.set(hh, 34);
  return buf;
}

/** Sign a chain head (or any head-shaped payload) under a named domain. Deterministic ML-DSA-65 via the adapter
 *  chokepoint. THROWS on bad seed, unknown domain, or malformed fields (fail closed at the signer). The domain is
 *  REQUIRED — no default — so every signer/verifier call site names its purpose and the compiler enforces the
 *  sign-domain==verify-domain pairing discipline (adversarial review B1.3b). */
export async function signChainHeadV3(seedHex: string, h: ChainHeadFields, domain: PqcDomain): Promise<string> {
  return pqcSign(seedHex, serializeSignedChainHeadV3(h), domain);
}

/** Verify a V3 head signature. Returns FALSE on any failure — malformed fields, wrong domain, wrong chain,
 *  tampered bytes, non-canonical encoding, or legacy V2/Ed25519 material (refusal, never an exception).
 *  The domain is REQUIRED — see signChainHeadV3. */
export async function verifyChainHeadV3(publicKeyHex: string, h: ChainHeadFields, sigHex: string, domain: PqcDomain): Promise<boolean> {
  try {
    return await pqcVerify(publicKeyHex, serializeSignedChainHeadV3(h), sigHex, domain);
  } catch {
    return false;
  }
}

// ═══════════════════════════ SignedChainHeadV4 (B1.5b — + receipt-history commitment) ═══════════════════════════
// V3's 66 bytes EXTENDED by a 32-byte merkle_root → a 98-byte preimage. One signature now binds BOTH the linear
// chain head AND the RFC 6962 append-only history root over the chain's receipt leaves. tree_size is NOT a new
// field — it IS chain_length at [26..33] (receipt count = leaf count). V4's 98-byte preimage is a DIFFERENT signed
// message than V3's 66 bytes (version [0]=0x04, plus the trailing 32-byte root); ML-DSA binds the whole message, so
// V3 and V4 signatures never cross-verify (no silent cross-version) — length, version byte, and root all separate
// them. Algorithm id, chain_id, and the FIPS 204 purpose domain remain explicit, exactly as in V3.
// This is the FORMAT primitive only (B1.5b1); wiring it into the live receipt write/verify path is B1.5b2. The
// merkle_root is supplied by the caller (computed via aukoraMerkleLog over the receipt chainHashes) — this module
// embeds and binds it but holds no Merkle logic of its own.

export const SIGNED_HEAD_V4_VERSION = 0x04; // format version byte at [0] (V3 used 0x03); distinct from the alg-id byte
export const SIGNED_HEAD_V4_ALG = `${pqcAlgInfo(PQC_ALG_ML_DSA_65).name}-chainhead-v4`; // "ml-dsa-65-chainhead-v4" — telemetry tag only

/** The exact 98-byte SignedChainHeadV4 preimage. THROWS on unknown algId, malformed chainHeadHash, malformed
 *  merkleRoot, or out-of-range u64 fields (fail closed before any bytes are minted). Layout:
 *    [0]      version         (0x04)
 *    [1]      algorithm id    (0x04 = ml-dsa-65; the dedicated alg-id table)
 *    [2..17]  chain_id        (16 bytes = SHA-256("aukora-chain"||chainKey)[:16] — unchanged from V2/V3, PAL-3)
 *    [18..25] timestamp       (uint64 BE, ms)
 *    [26..33] chain_length    (uint64 BE) — doubles as tree_size (leaf count)
 *    [34..65] chain_head_hash (32 bytes) — the linear chain head
 *    [66..97] merkle_root     (32 bytes) — RFC 6962 append-only history root over the receipt leaves
 *  CONTRACT: merkleRootHex MUST be aukoraMerkleLog.receiptHistoryRootHex(...) over the chain's RAW receipt
 *  chainHashes (leaf-hashed internally) — NEVER an already-leaf-hashed root, or no proof will match it (B1.5b1
 *  review). This primitive cannot detect a wrong-convention root; B1.5b2 mints it via that helper and the audit
 *  path recomputes-and-compares against exactly chain_length receipt leaves. */
export function serializeSignedChainHeadV4(h: ChainHeadFields, merkleRootHex: string, algId: number = PQC_ALG_ML_DSA_65): Uint8Array {
  pqcAlgInfo(algId); // refuse unknown algorithms at mint time
  const root = hexToBytes(merkleRootHex);
  if (root.length !== 32) throw new Error(`aukora_signed_head_merkle_root_len:${root.length}`);
  const buf = new Uint8Array(98);
  buf[0] = SIGNED_HEAD_V4_VERSION;
  buf[1] = algId;
  buf.set(deriveChainId(h.chainKey), 2);
  writeU64BE(buf, 18, h.timestamp);
  writeU64BE(buf, 26, h.chainLength);
  const hh = hexToBytes(h.chainHeadHash);
  if (hh.length !== 32) throw new Error(`aukora_signed_head_chain_hash_len:${hh.length}`);
  buf.set(hh, 34);
  buf.set(root, 66);
  return buf;
}

/** Sign a V4 head (linear chain head + history root) under a named domain. Deterministic ML-DSA-65 via the adapter
 *  chokepoint. THROWS on bad seed, unknown domain, or malformed fields. Domain REQUIRED (see signChainHeadV3). */
export async function signChainHeadV4(seedHex: string, h: ChainHeadFields, merkleRootHex: string, domain: PqcDomain): Promise<string> {
  return pqcSign(seedHex, serializeSignedChainHeadV4(h, merkleRootHex), domain);
}

/** Verify a V4 head signature over (chain fields + history root). Returns FALSE on any failure — a tampered
 *  merkle_root, tampered tree_size/chain fields, wrong domain, wrong chain, non-canonical encoding, or V3/legacy
 *  material (refusal, never an exception). Domain REQUIRED. */
export async function verifyChainHeadV4(publicKeyHex: string, h: ChainHeadFields, merkleRootHex: string, sigHex: string, domain: PqcDomain): Promise<boolean> {
  try {
    return await pqcVerify(publicKeyHex, serializeSignedChainHeadV4(h, merkleRootHex), sigHex, domain);
  } catch {
    return false;
  }
}

/** Reads the operator chain-signing seed from env. Unset → head signing is OFF (additive; the SHA chain still holds).
 *  Lenient: returns null for both "unset" and "present-but-malformed" — use only to DETECT whether signing is on. */
export function chainSigningSeed(): string | null {
  const s = process.env.AUKORA_CHAIN_SIGNING_SEED?.trim();
  return s && /^[0-9a-fA-F]{64}$/.test(s) ? s.toLowerCase() : null;
}

/** The WRITE-PATH seed resolver. Distinguishes "unset" (→ null, signing legitimately OFF) from "present but
 *  malformed" (→ THROW). A misconfigured signer must fail closed, never silently degrade to an unsigned head. */
export function resolveChainSigningSeed(): string | null {
  const raw = process.env.AUKORA_CHAIN_SIGNING_SEED?.trim();
  if (!raw) return null; // truly unset → signing OFF (additive)
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("aukora_chain_signing_seed_invalid"); // present but bad → fail closed
  return raw.toLowerCase();
}

/** The VERIFIER's public key: prefer an explicitly-published AUKORA_CHAIN_PUBLIC_KEY (so auditors needn't hold the
 *  seed); else derive from the signing seed if configured; else null (signing OFF → nothing to verify). When this is
 *  non-null, head signing is EXPECTED and the audit path must reject an unsigned/forged head (no silent downgrade).
 *  FAIL CLOSED on a present-but-malformed pubkey — including a stale 64-hex Ed25519 value left over from before the
 *  cutover (adversarial review B1.3b HIGH: falling through silently would set signingExpected=false on an auditor
 *  deployment and turn the whole tamper audit OFF). Same asymmetry as the seed resolver: unset → off; bad → THROW.
 *  ML-DSA-65 pubkeys are 3904 hex chars; env input is operator config (case-normalized in, canonical lowercase out). */
export async function resolveChainVerifyingPublicKey(): Promise<string | null> {
  const pub = process.env.AUKORA_CHAIN_PUBLIC_KEY?.trim();
  if (pub) {
    if (!new RegExp(`^[0-9a-fA-F]{${PQC_SIZES.publicKeyBytes * 2}}$`).test(pub)) throw new Error("aukora_chain_public_key_invalid");
    return pub.toLowerCase();
  }
  const seed = chainSigningSeed();
  return seed ? await mlDsa65PublicKeyFromSeed(seed) : null;
}

export type HeadRowForVerify = {
  lastChainHash: string;
  count: number;
  headSig?: string | null;
  headSigAlg?: string | null;
  headSignedAt?: number | null;
  receiptLogRoot?: string | null; // V4 only: the signed receipt-history root
};

/** (Retained for back-compat + tests; the live receipt audit path moved to verifyHeadRowSignatureV4 at the B1.5b2
 *  cutover.) Verify a chain-head ROW against the operator public key — the V3 audit-path verdict. Structured verdict so the
 *  audit path can FAIL CLOSED on a downgrade/strip: when signing is expected, a missing signature ("unsigned_head"),
 *  a wrong/legacy algorithm tag ("alg_mismatch:<tag>" — V2 rows land here), or an invalid signature is a TAMPER
 *  signal — not "signing was off". The headSigAlg check is a fast-reject HINT; a forged tag still fails the
 *  in-preimage verify. V2/Ed25519 material is never re-verified — it refuses. */
export async function verifyHeadRowSignatureV3(
  publicKeyHex: string,
  head: HeadRowForVerify,
  chainKey: string,
): Promise<{ ok: boolean; reason: string | null }> {
  if (!head.headSig) return { ok: false, reason: "unsigned_head" };
  if (head.headSigAlg !== SIGNED_HEAD_V3_ALG) return { ok: false, reason: `alg_mismatch:${head.headSigAlg ?? "none"}` };
  if (head.headSignedAt == null) return { ok: false, reason: "missing_signed_at" };
  const ok = await verifyChainHeadV3(
    publicKeyHex,
    { chainKey, timestamp: head.headSignedAt, chainLength: head.count, chainHeadHash: head.lastChainHash },
    head.headSig,
    "chainHead",
  );
  return { ok, reason: ok ? null : "signature_invalid" };
}

/** Verify a RECEIPT-chain head ROW's V4 signature (B1.5b2) — same structured-verdict contract as V3 plus the
 *  receipt-history binding. Verifies the signature over the head's STORED receiptLogRoot; the caller separately
 *  recomputes the root from the receipts and compares (recompute-and-compare). A missing/legacy-V3 tag, a missing
 *  receiptLogRoot, or an invalid signature is a TAMPER signal — never a silent downgrade. V3 receipt heads refuse
 *  here (alg_mismatch); checkpoint heads (:rev/del:) are NOT receipt logs and keep using the V3 verifier. */
export async function verifyHeadRowSignatureV4(
  publicKeyHex: string,
  head: HeadRowForVerify,
  chainKey: string,
): Promise<{ ok: boolean; reason: string | null }> {
  if (!head.headSig) return { ok: false, reason: "unsigned_head" };
  if (head.headSigAlg !== SIGNED_HEAD_V4_ALG) return { ok: false, reason: `alg_mismatch:${head.headSigAlg ?? "none"}` };
  if (head.headSignedAt == null) return { ok: false, reason: "missing_signed_at" };
  if (!head.receiptLogRoot) return { ok: false, reason: "missing_log_root" };
  const ok = await verifyChainHeadV4(
    publicKeyHex,
    { chainKey, timestamp: head.headSignedAt, chainLength: head.count, chainHeadHash: head.lastChainHash },
    head.receiptLogRoot,
    head.headSig,
    "chainHead",
  );
  return { ok, reason: ok ? null : "signature_invalid" };
}

export type HighWaterRecord = { maxCount: number; headHash: string };
export type HighWaterStatus = "ok" | "rollback" | "fork";

/** Compare a presented chain head against the remembered high-water mark (IDC-3 — rollback / fork detection). PURE.
 *  A signed head proves "this state was signed", but a genuinely-signed OLDER head still verifies; only a memory of
 *  the highest count a verifier has confirmed catches a rollback. Rule:
 *   - no prior HWM             → "ok"       (genesis; nothing to roll back from yet)
 *   - head.count  >  maxCount  → "ok"       (legitimate advance — caller raises the HWM ONLY after full verify)
 *   - head.count === maxCount && headHash === hwm.headHash → "ok"   (same confirmed checkpoint)
 *   - head.count === maxCount && headHash !== hwm.headHash → "fork" (equivocation at the same height)
 *   - head.count  <  maxCount  → "rollback" (an older still-valid head replaced a higher confirmed one) */
export function evaluateHighWater(hwm: HighWaterRecord | null, head: { count: number; headHash: string }): HighWaterStatus {
  if (!hwm) return "ok";
  if (head.count > hwm.maxCount) return "ok";
  if (head.count === hwm.maxCount) return head.headHash === hwm.headHash ? "ok" : "fork";
  return "rollback";
}
