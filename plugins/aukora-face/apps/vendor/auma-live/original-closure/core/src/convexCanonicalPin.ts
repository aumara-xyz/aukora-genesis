/**
 * 24Y.7 — Cryptographic canonicality pin for the Convex brain.
 *
 * 24Y.6 proved (Fusion RED) that name-marker canonicality is spoofable: any backend serving a
 * same-named getReceiptChainHeadPublic that returns a type-valid head would classify as canonical.
 * This module closes that hole: a backend is canonical ONLY if its signed receipt head verifies
 * (ML-DSA-65, FIPS 204) against an EXPLICITLY PINNED canonical public key.
 *
 * Trust model (hard laws):
 *  - The pin is EXPLICIT and OUT-OF-BAND (env/config). NO trust-on-first-use, NO auto-derivation
 *    from whatever a backend hands us.
 *  - If no pin is configured, there is NO cryptographic canonicality — we fall back to
 *    'name_marker_only' (spoofable) and say so. We NEVER claim 'cryptographic_pin' without a pin.
 *  - Invalid signature / wrong key / unsupported alg / malformed head → HALT (noncanonical), never a
 *    silent downgrade to a weaker proof.
 *  - We verify the signature over the SAME V4 preimage + FIPS 204 context the kernel signs with
 *    (node-template/convex/aukoraSignedHead.ts + aukoraPqcSigner.ts). The constants below MUST match
 *    those files byte-for-byte; `tests/convexCanonicalPin.test.ts` pins a GOLD vector produced by the
 *    kernel's own signer to prove byte-exact compatibility (no faked verification).
 *
 * PURE: @noble/post-quantum + @noble/hashes only. No Convex, no network, no mutation, no secrets.
 */
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, concatBytes } from '@noble/hashes/utils.js';
import type { ReceiptChainHeadPublic } from './convexBrainReadonly';

// ── Constants mirrored from the kernel signer (MUST match node-template/convex). Proven by GOLD vector. ──
const SIGNED_HEAD_V4_VERSION = 0x04;
const PQC_ALG_ML_DSA_65 = 0x04;
export const SIGNED_HEAD_V4_ALG = 'ml-dsa-65-chainhead-v4';
const CHAIN_ID_PREFIX = 'aukora-chain';
const CHAINHEAD_CONTEXT = 'aukora-chainhead-v3'; // FIPS 204 domain context for the "chainHead" domain
const ML_DSA_65_PUBKEY_HEXLEN = 1952 * 2; // 3904
const ML_DSA_65_SIG_HEXLEN = 3309 * 2;    // 6618
const HEX_LOWER = /^[0-9a-f]+$/;

const enc = new TextEncoder();

function deriveChainId(chainKey: string): Uint8Array {
  return sha256(concatBytes(enc.encode(CHAIN_ID_PREFIX), enc.encode(chainKey))).slice(0, 16);
}

function writeU64BE(buf: Uint8Array, off: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`canonical_pin_u64_range:${value}`);
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  buf[off + 0] = (high >>> 24) & 0xff; buf[off + 1] = (high >>> 16) & 0xff;
  buf[off + 2] = (high >>> 8) & 0xff;  buf[off + 3] = high & 0xff;
  buf[off + 4] = (low >>> 24) & 0xff;  buf[off + 5] = (low >>> 16) & 0xff;
  buf[off + 6] = (low >>> 8) & 0xff;   buf[off + 7] = low & 0xff;
}

/** The exact 98-byte SignedChainHeadV4 preimage (byte-identical to the kernel's serializer). */
function serializeSignedChainHeadV4(
  chainKey: string, timestamp: number, chainLength: number, chainHeadHashHex: string, merkleRootHex: string,
): Uint8Array {
  const root = hexToBytes(merkleRootHex);
  if (root.length !== 32) throw new Error(`canonical_pin_merkle_root_len:${root.length}`);
  const hh = hexToBytes(chainHeadHashHex);
  if (hh.length !== 32) throw new Error(`canonical_pin_chain_hash_len:${hh.length}`);
  const buf = new Uint8Array(98);
  buf[0] = SIGNED_HEAD_V4_VERSION;
  buf[1] = PQC_ALG_ML_DSA_65;
  buf.set(deriveChainId(chainKey), 2);
  writeU64BE(buf, 18, timestamp);
  writeU64BE(buf, 26, chainLength);
  buf.set(hh, 34);
  buf.set(root, 66);
  return buf;
}

// ── Pin config (explicit, out-of-band ONLY — no TOFU) ──

export interface CanonicalPin {
  publicKeyHex: string;        // pinned ML-DSA-65 public key (3904 lowercase hex)
  expectedAlg: string;         // SIGNED_HEAD_V4_ALG
  allowedChainKeys: string[] | null; // null = any chainKey; else the head's chainKey must be listed
  source: 'explicit_config';
}

/**
 * Resolve the canonical pin from EXPLICIT config only. Returns null when unset (→ no crypto
 * canonicality). FAIL CLOSED on a present-but-malformed pin (a bad pin must error, never silently
 * disable verification). NO TOFU: the key never comes from a backend response.
 *   AUKORA_CANONICAL_PIN_PUBLIC_KEY = 3904-hex ML-DSA-65 public key
 *   AUKORA_CANONICAL_PIN_CHAINKEYS  = optional comma-separated allowlist of chainKeys
 */
export function resolveCanonicalPin(env: NodeJS.ProcessEnv = process.env): CanonicalPin | null {
  const raw = env.AUKORA_CANONICAL_PIN_PUBLIC_KEY?.trim();
  if (!raw) return null; // unset → no pin → no cryptographic canonicality
  const pub = raw.toLowerCase();
  if (pub.length !== ML_DSA_65_PUBKEY_HEXLEN || !HEX_LOWER.test(pub)) {
    throw new Error('aukora_canonical_pin_public_key_invalid'); // present but malformed → fail closed
  }
  const chainKeysRaw = env.AUKORA_CANONICAL_PIN_CHAINKEYS?.trim();
  const allowedChainKeys = chainKeysRaw
    ? chainKeysRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : null;
  return { publicKeyHex: pub, expectedAlg: SIGNED_HEAD_V4_ALG, allowedChainKeys, source: 'explicit_config' };
}

export type CanonicalityProof = 'cryptographic_pin' | 'name_marker_only' | 'none';

export interface CanonicalVerifyResult {
  verified: boolean;
  proof: CanonicalityProof;
  reason: string;
  spoofable: boolean;
  /** True when verification FAILED in a way that signals a possible attack (sig invalid / wrong key
   *  / alg / chainKey mismatch) — as opposed to merely "no pin configured". */
  halt: boolean;
}

function isHex(s: unknown, len: number): s is string {
  return typeof s === 'string' && s.length === len && HEX_LOWER.test(s);
}

/**
 * Verify a public receipt head against a pinned canonical key.
 *  - no pin                       → name_marker_only, spoofable=true, halt=false (no crypto possible)
 *  - malformed head               → none, spoofable=false, halt=true (fail closed)
 *  - alg != V4                    → none, halt=true (downgrade/unsupported)
 *  - chainKey not allowed by pin  → none, halt=true
 *  - signature invalid / wrong key→ none, halt=true (HALT — possible spoof)
 *  - valid signature, pinned key  → cryptographic_pin, verified=true, spoofable=false
 */
export function verifyCanonicalReceiptHead(
  head: ReceiptChainHeadPublic | null,
  pin: CanonicalPin | null,
): CanonicalVerifyResult {
  if (!pin) {
    return { verified: false, proof: 'name_marker_only', reason: 'no_pin', spoofable: true, halt: false };
  }
  if (!head || !head.exists) {
    return { verified: false, proof: 'none', reason: 'no_head_or_empty', spoofable: false, halt: false };
  }
  // Required public verification material must be present and well-formed.
  if (head.headSigAlg !== pin.expectedAlg) {
    return { verified: false, proof: 'none', reason: `alg_mismatch:${head.headSigAlg ?? 'none'}`, spoofable: false, halt: true };
  }
  if (!isHex(head.headSig, ML_DSA_65_SIG_HEXLEN)) {
    return { verified: false, proof: 'none', reason: 'malformed_signature', spoofable: false, halt: true };
  }
  if (!isHex(head.lastChainHash ?? undefined as unknown as string, 64)) {
    return { verified: false, proof: 'none', reason: 'malformed_chain_head_hash', spoofable: false, halt: true };
  }
  if (!isHex(head.receiptLogRoot ?? undefined as unknown as string, 64)) {
    return { verified: false, proof: 'none', reason: 'malformed_receipt_log_root', spoofable: false, halt: true };
  }
  if (head.headSignedAt == null || !Number.isSafeInteger(head.headSignedAt) || head.headSignedAt < 0) {
    return { verified: false, proof: 'none', reason: 'malformed_signed_at', spoofable: false, halt: true };
  }
  if (!Number.isSafeInteger(head.count) || head.count < 0) {
    return { verified: false, proof: 'none', reason: 'malformed_count', spoofable: false, halt: true };
  }
  if (pin.allowedChainKeys && !pin.allowedChainKeys.includes(head.chainKey)) {
    return { verified: false, proof: 'none', reason: `chainkey_not_pinned:${head.chainKey}`, spoofable: false, halt: true };
  }

  let preimage: Uint8Array;
  try {
    preimage = serializeSignedChainHeadV4(
      head.chainKey, head.headSignedAt, head.count, head.lastChainHash!, head.receiptLogRoot!,
    );
  } catch {
    return { verified: false, proof: 'none', reason: 'preimage_serialize_failed', spoofable: false, halt: true };
  }

  let ok = false;
  try {
    ok = ml_dsa65.verify(
      hexToBytes(head.headSig),
      preimage,
      hexToBytes(pin.publicKeyHex),
      { context: enc.encode(CHAINHEAD_CONTEXT) },
    );
  } catch {
    ok = false;
  }

  if (!ok) {
    // Verified against the pinned key and FAILED → not the canonical kernel. HALT (possible spoof).
    return { verified: false, proof: 'none', reason: 'signature_invalid', spoofable: false, halt: true };
  }
  return { verified: true, proof: 'cryptographic_pin', reason: 'verified', spoofable: false, halt: false };
}
