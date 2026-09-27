// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Registered erase-root pin registry (R59, G1 repair).
 *
 * G1 was: `verifyEraseAttestation` trusted the ML-DSA-65 public key CARRIED IN the submitted attestation, and
 * `ownerRootId` was a free string checked against nothing. So any caller could mint their own keypair, sign a
 * self-consistent erase attestation for any recordId, and it verified — a caller-supplied key authorized a
 * destructive `forget`.
 *
 * The pin: erase authority is bound to a REGISTERED owner root. An attestation is honored only if its
 * `ownerRootId` is registered AND its `publicKeyHex` byte-equals the pin registered for that root. The registry
 * holds PUBLIC ML-DSA-65 keys only — never a seed or any private byte. It is an allowlist / store-integrity pin:
 * the row (or entry) decides nothing and releases nothing; authority remains the owner's off-store signature.
 * A new/forged key that is not the registered pin is refused BEFORE the signature is even checked, so a forged
 * attestation cannot reach plaintext deletion.
 *
 * FAIL-CLOSED: an empty registry authorizes NO erase. Provisioning a real owner pin is an owner-level decision
 * (public key only), analogous to a donor-pin update — it is deliberately not a public, unauthenticated path.
 */

/** ownerRootId → lowercase-hex ML-DSA-65 PUBLIC key. Public material only. */
export type RegisteredEraseRoots = ReadonlyMap<string, string>;

// ML-DSA-65 public keys are ~1952 bytes (~3904 hex); accept lowercase even-length hex within a generous bound
// so a vendored-impl length change does not silently break the pin, while payloads/garbage are rejected.
const PUBKEY_HEX_RE = /^(?:[0-9a-f]{2}){64,8192}$/;

/** Build a registry from explicit entries. Pure; throws on malformed input (fail closed at construction). */
export function buildEraseRootRegistry(entries: ReadonlyArray<readonly [string, string]>): RegisteredEraseRoots {
  const m = new Map<string, string>();
  for (const [rootId, pubHex] of entries) {
    if (typeof rootId !== 'string' || rootId.length === 0 || rootId.length > 128) throw new Error('erase_root_id_bounds');
    if (typeof pubHex !== 'string') throw new Error('erase_root_pubkey_type');
    const pub = pubHex.toLowerCase();
    if (!PUBKEY_HEX_RE.test(pub)) throw new Error('erase_root_pubkey_shape');
    if (m.has(rootId)) throw new Error('erase_root_duplicate');
    m.set(rootId, pub);
  }
  return m;
}

/**
 * Build a registry from store rows (the Convex `eraseRoots` allowlist table). Skips malformed rows rather than
 * throwing, so one bad row cannot brick the whole gate — a skipped row simply does not authorize its root, which
 * is the fail-closed direction. Duplicate rootIds resolve to the FIRST seen and the rest are skipped (a second
 * pin for a root can never widen authority).
 */
export function eraseRootsFromRows(rows: ReadonlyArray<{ ownerRootId?: unknown; publicKeyHex?: unknown }>): RegisteredEraseRoots {
  const m = new Map<string, string>();
  for (const row of rows) {
    const rootId = row.ownerRootId;
    const pubHex = row.publicKeyHex;
    if (typeof rootId !== 'string' || rootId.length === 0 || rootId.length > 128) continue;
    if (typeof pubHex !== 'string') continue;
    const pub = pubHex.toLowerCase();
    if (!PUBKEY_HEX_RE.test(pub)) continue;
    if (m.has(rootId)) continue;
    m.set(rootId, pub);
  }
  return m;
}

/**
 * Pinned compiled-in production registry. EMPTY by default = fail-closed: no erase is authorized until an owner
 * provisions a PUBLIC ML-DSA-65 key (never a seed/private byte). Populating this is an owner-level decision.
 */
export const PINNED_ERASE_ROOTS: RegisteredEraseRoots = buildEraseRootRegistry([
  // ['owner-root-id', '<ml-dsa-65 public key hex>'],  // provision out-of-band; public material only
]);
