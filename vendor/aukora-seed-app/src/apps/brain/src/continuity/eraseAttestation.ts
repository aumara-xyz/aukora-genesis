// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Signed erase attestation (WAVE 2) — restores the donor's M2b erase law over the current content-free chain.
 *
 * DONOR FAITHFULNESS (aukora-symbiote@ed1824a `convex/aumlokMemory.ts`, blob 5fc75be6…):
 *   - the preimage is EXACTLY the donor shape: `"aukora-aumlok-memerase-v1|" + stableStringify({v, ownerRootId,
 *     key, eraseReason, timestamp})` — sorted-key JSON (kernel `canonicalJson` is byte-identical to the donor's
 *     `stableStringify` for this flat shape; proven by a comparative vector test);
 *   - the erase REASON is INSIDE the signed preimage — the receipt's reason is owner-attested words, never a
 *     value anyone downstream could substitute;
 *   - the signature is a single-shot SignedChainHeadV3 over chainKey `aumlok:memerase:{ownerRootId}:{key}`,
 *     chainLength 1, head = sha256 of the serialized preimage — the donor's dedicated erase domain separation,
 *     now carried by the vendored ML-DSA-65 chokepoint (PQC upgrade is the one deliberate divergence: the donor's
 *     V3 verify was already ML-DSA; we sign under the `chainHead` FIPS-204 domain like every other head).
 *   - ADAPTATION (boundary only): `key` is the CURRENT identity — the content-addressed recordId — so an
 *     attestation is SCOPED to exactly one memory.
 *
 * Durable-mutation laws carried by the attestation object:
 *   SCOPED (ownerRootId + recordId inside the signed bytes) · EXPIRING (timestamp + ERASE_FRESHNESS_MS window,
 *   donor constant) · ANTI-REPLAY (nonce = the attestation digest, consumed once by the store) · ATOMICALLY
 *   CONSUMED (the store consumes nonce + removes plaintext + appends the erasure receipt in ONE transaction) ·
 *   CONTENT-MINIMIZING (reason bounded at 256 chars, scanned for secret shapes by the caller's ingest law;
 *   no plaintext memory content anywhere in the attestation).
 *
 * AUTHORITY BOUNDARY: the OWNER's seed signs OUT HERE (kernel side). Convex verifies-and-refuses forgeries as a
 * store-integrity check and records the evidence — it decides nothing and can release nothing.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJson } from '@aukora/kernel/canonical';
import { signChainHeadV3, verifyChainHeadV3, type ChainHeadFields } from './aukoraSignedHead.js';
import { mlDsa65PublicKeyFromSeed } from './aukoraPqcSigner.js';
import type { RegisteredEraseRoots } from './eraseRootRegistry.js';

export const ERASE_DOMAIN_PREFIX = 'aukora-aumlok-memerase-v1'; // donor domain string, unchanged
export const ERASE_FRESHNESS_MS = 60_000; // donor constant, unchanged
const MAX_REASON = 256;

export interface EraseAttestationV1 {
  readonly v: 1;
  readonly ownerRootId: string;
  /** The content-addressed recordId being erased — the attestation's exact scope. */
  readonly key: string;
  readonly eraseReason: string;
  readonly timestamp: number;
  /** ML-DSA-65 signature (hex) over the single-shot erase head. */
  readonly signatureHex: string;
  /** The signer's ML-DSA-65 public key (hex) — public material only. */
  readonly publicKeyHex: string;
}

/** The donor-exact serialized preimage. */
export function serializeEraseV1(fields: { v: number; ownerRootId: string; key: string; eraseReason: string; timestamp: number }): string {
  return `${ERASE_DOMAIN_PREFIX}|${canonicalJson({ v: fields.v, ownerRootId: fields.ownerRootId, key: fields.key, eraseReason: fields.eraseReason, timestamp: fields.timestamp })}`;
}

/** The donor-exact single-shot erase head over the serialized preimage. */
export function eraseHead(fields: { ownerRootId: string; key: string; eraseReason: string; timestamp: number }): ChainHeadFields {
  return {
    chainKey: `aumlok:memerase:${fields.ownerRootId}:${fields.key}`,
    timestamp: fields.timestamp,
    chainLength: 1,
    chainHeadHash: bytesToHex(sha256(utf8ToBytes(serializeEraseV1({ v: 1, ...fields })))),
  };
}

/** The attestation's digest — doubles as its consume-once anti-replay nonce. */
export function eraseAttestationDigest(a: Omit<EraseAttestationV1, 'signatureHex' | 'publicKeyHex'>): string {
  return bytesToHex(sha256(utf8ToBytes(serializeEraseV1(a))));
}

/** OWNER-side signing (kernel layer; never inside Convex). Throws on malformed input (fail closed at the signer). */
export async function signEraseAttestation(
  seedHex: string,
  fields: { ownerRootId: string; key: string; eraseReason: string; timestamp: number },
): Promise<EraseAttestationV1> {
  if (fields.eraseReason.length === 0 || fields.eraseReason.length > MAX_REASON) throw new Error('erase_reason_bounds');
  const signatureHex = await signChainHeadV3(seedHex, eraseHead(fields), 'chainHead');
  return { v: 1, ...fields, signatureHex, publicKeyHex: await mlDsa65PublicKeyFromSeed(seedHex) };
}

export type EraseVerifyResult = { readonly ok: true; readonly digest: string } | { readonly ok: false; readonly reason: string };

/**
 * TOTAL verification (never throws): structure, bounds, freshness window, REGISTERED-ROOT PIN, and the ML-DSA
 * signature over the donor-exact head. `nowMs` is caller-supplied (no ambient clock in the law). Expiry is a
 * REFUSAL.
 *
 * G1 repair: `registeredRoots` pins erase authority to a registered owner root. The attestation is honored only
 * if its `ownerRootId` is registered AND its carried `publicKeyHex` byte-equals the pin for that root. The pin is
 * checked BEFORE the signature, so a self-consistent forged/new-key attestation (valid signature over an
 * attacker key) is refused as `unregistered_root` / `key_not_pinned` and never reaches deletion. An empty
 * registry authorizes nothing (fail-closed).
 */
export async function verifyEraseAttestation(a: unknown, nowMs: number, registeredRoots: RegisteredEraseRoots): Promise<EraseVerifyResult> {
  try {
    if (a === null || typeof a !== 'object') return { ok: false, reason: 'malformed' };
    const o = a as Record<string, unknown>;
    if (o.v !== 1) return { ok: false, reason: 'version' };
    if (typeof o.ownerRootId !== 'string' || o.ownerRootId.length === 0 || o.ownerRootId.length > 128) return { ok: false, reason: 'ownerRootId' };
    if (typeof o.key !== 'string' || !/^[0-9a-f]{64}$/.test(o.key)) return { ok: false, reason: 'key' };
    if (typeof o.eraseReason !== 'string' || o.eraseReason.length === 0 || o.eraseReason.length > MAX_REASON) return { ok: false, reason: 'reason_bounds' };
    if (!Number.isSafeInteger(o.timestamp) || (o.timestamp as number) < 0) return { ok: false, reason: 'timestamp' };
    if ((o.timestamp as number) > nowMs + 5_000) return { ok: false, reason: 'timestamp_future' };
    if (nowMs - (o.timestamp as number) > ERASE_FRESHNESS_MS) return { ok: false, reason: 'expired' };
    if (typeof o.signatureHex !== 'string' || typeof o.publicKeyHex !== 'string') return { ok: false, reason: 'signature_shape' };
    // REGISTERED-ROOT PIN (before signature): the attestation's key must be the pinned owner key for its root.
    const pinnedPub = registeredRoots.get(o.ownerRootId as string);
    if (pinnedPub === undefined) return { ok: false, reason: 'unregistered_root' };
    if ((o.publicKeyHex as string).toLowerCase() !== pinnedPub) return { ok: false, reason: 'key_not_pinned' };
    const fields = { ownerRootId: o.ownerRootId as string, key: o.key as string, eraseReason: o.eraseReason as string, timestamp: o.timestamp as number };
    const valid = await verifyChainHeadV3(o.publicKeyHex as string, eraseHead(fields), o.signatureHex as string, 'chainHead');
    if (!valid) return { ok: false, reason: 'signature_invalid' };
    return { ok: true, digest: eraseAttestationDigest({ v: 1, ...fields }) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** Attestations grant no authority — they PROVE an owner instruction; the store still only obeys, never decides. */
export function eraseAttestationGrantsAuthority(): false {
  return false;
}
