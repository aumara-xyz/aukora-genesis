// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * B2.1 — AUMLOK identity ROOT-key registry + lifecycle. The server pins ML-DSA-65 root PUBLIC keys and nothing else:
 * NO seed, NO phrase, NO root private material ever transits a mutation (the phrase stays client-side, B2.0b). This
 * module is identity GENESIS → ROTATION → REVOCATION over `aumlok_root_keys`, mirroring the proven
 * `founder_key_registry` lifecycle (popResolver.ts) and the V4 receipt spine.
 *
 * TWO layers of authority (kept distinct on purpose):
 *  1. OPERATOR PoP gates the MUTATION (interim authority — every lifecycle call is operator-PoP-gated via
 *     resolvePoPSession, the same cap/req proof-of-possession the kernel already uses). This is honest, NOT
 *     self-sovereign: in B2.1 the root is OPERATOR-BORN; the subject-owned ceremony is B2.3.
 *  2. The OLD ROOT KEY's signature gates the registry FLIP. A rotation only commits if the old (active) root key
 *     signed the rotation statement under the `aukora-aumlok-rotation-v1` FIPS 204 domain (reusing the proven V3 head
 *     signer/verifier by mapping the statement's SHA-256 into ChainHeadFields — exactly like cap/req). The flip is
 *     ATOMIC: verify-then-write in one Convex mutation; an unsigned / wrong-domain / wrong-old-key / tampered
 *     statement throws BEFORE any row changes, so the registry never half-rotates.
 *
 * Lifecycle STATUS (mirrors founder_key_registry): "active" (may author a rotation + be verified) | "retired"
 * (grandfathered — statements it already signed still verify, but it CANNOT author a NEW rotation) | "revoked" (dead
 * — kills future authority). Every lifecycle event is receipted on the reserved `id:{rootId}` V4 chain
 * (appendReceiptAndSignHead — the one V4-head chokepoint; `id:` is refused to all ordinary receipt writers).
 *
 * CLAIM DISCIPLINE: PROVEN-LAB for the tested registry behavior; the root is operator-born (no self-sovereign
 * ceremony yet, B2.3); NO production identity claim. Manifests (B2.2), ceremony (B2.3), memory (B2.4), recovery are
 * OUT of scope here.
 */
import { internalMutation } from "./_generated/server"; // S1a: internal-only (B1)
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";
import { isPqcPublicKeyHex } from "./aukoraPqcSigner";
import { resolvePoPSession } from "./popResolver";
import { appendIdentityLifecycleReceipt, IDENTITY_NAME_RE } from "./aukoraReceipts";

// Operator-PoP method ids (must appear in the operator's signed caveat `methods` allow-list).
export const AUMLOK_METHODS = Object.freeze({ genesis: "aumlokGenesisMint", rotate: "aumlokRotateRoot", revoke: "aumlokRevokeRoot" });

/** sha256 of the RAW ML-DSA-65 public-key bytes (NOT the hex string) — the short, unambiguous identity reference.
 *  Caller MUST pass a shape-valid pubkey (isPqcPublicKeyHex) so hexToBytes cannot choke. */
export function rootKeyFingerprint(publicKeyHex: string): string {
  return bytesToHex(sha256(hexToBytes(publicKeyHex)));
}

// ── Rotation statement: canonical serialization → V3 head, signed by the OLD root key under "aumlokRotation" ──
// Mirrors serializeCapV1/capHead. The chainKey `aumlok:rot:{rootId}` domain-separates per identity (a statement for
// root A can never verify against root B's head — chain_id binding). NOT a receipt chainKey (never written as one).
const ROT_FIELDS = ["v", "rootId", "oldKeyId", "newKeyId", "newPublicKey", "newFingerprint", "reason", "timestamp"] as const;
const pick = (o: any, fields: readonly string[]) => { const r: any = {}; for (const f of fields) r[f] = o?.[f]; return r; };
export function serializeRotationV1(s: any): string { return "aukora-aumlok-rot-v1|" + stableStringify(pick(s, ROT_FIELDS)); }
export async function rotationHead(s: any): Promise<ChainHeadFields> {
  return { chainKey: `aumlok:rot:${s?.rootId}`, timestamp: Number(s?.timestamp ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeRotationV1(s)) };
}

type RootRow = { _id: any; rootId: string; keyId: string; publicKey: string; fingerprint: string; status: string; pinnedAt: number; retiredAt?: number };

async function rootKey(ctx: MutationCtx, rootId: string, keyId: string): Promise<RootRow | null> {
  return (await ctx.db.query("aumlok_root_keys").withIndex("by_root_kid", (q) => q.eq("rootId", rootId).eq("keyId", keyId)).first()) as RootRow | null;
}

/** Write one identity-lifecycle receipt on the reserved `id:{rootId}` V4 chain. proofJson carries the public,
 *  non-secret event detail (fingerprints, keyIds, the authorizing operator keyId) — never any seed/phrase. */
async function lifecycleReceipt(ctx: MutationCtx, rootId: string, event: string, proof: Record<string, unknown>): Promise<string> {
  return appendIdentityLifecycleReceipt(ctx, rootId, event, proof); // the single id:{rootId} writer (V4-signed)
}

// Identity NAMES (rootId, keyId) — frozen grammar (IDENTITY_NAME_RE: lowercase alnum + . _ - , 1–64, NO colon). The
// no-colon rule blocks ambiguous `id:{rootId}` / `aumlok:rot:{rootId}` chainKeys (collision with `:rev`/`del:`).
const asName = (x: unknown, field: string): string => {
  if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error(`aumlok_name_invalid:${field}`);
  return x;
};
// Short free-text/label fields (reason, fingerprint) — bounded, any content. NOT for the long hex artifacts
// (publicKey 3904, rotationSig 6618), which carry their own validators (isPqcPublicKeyHex / verifyChainHeadV3).
const asStr = (x: unknown, name: string): string => {
  if (typeof x !== "string" || x.length === 0 || x.length > 256) throw new Error(`aumlok_arg_invalid:${name}`);
  return x;
};
const asHexBlob = (x: unknown, name: string): string => {
  if (typeof x !== "string" || x.length === 0) throw new Error(`aumlok_arg_invalid:${name}`);
  return x;
};
/** Global pubkey uniqueness — one root key governs exactly ONE root identity (no cross-root key sharing; conscious
 *  B2.1 ruling). Used at genesis and rotation so a fingerprint→identity lookup is never ambiguous. */
async function fingerprintInUse(ctx: MutationCtx, fingerprint: string): Promise<boolean> {
  return !!(await ctx.db.query("aumlok_root_keys").withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint)).first());
}

/** SHARED root-key birth chokepoint. Enforces the registry invariants — once-per-root, ML-DSA-65 shape-gate, and
 *  cross-root fingerprint uniqueness — then inserts the active key. BOTH birth paths go through here (the operator-born
 *  lab/admin `aumlokGenesisMint` AND the self-sovereign B2.3 `aumlokCeremonyMint`), so those invariants can never drift
 *  between them. The CALLER owns AUTHORIZATION (operator PoP, or the self-sovereign root PoP) and the lifecycle receipt.
 *  THROWS on any violation → the caller's mutation rolls back. Returns the computed fingerprint. */
export async function mintRootKeyRow(ctx: MutationCtx, rootId: string, keyId: string, publicKey: string): Promise<{ fingerprint: string; pinnedAt: number }> {
  if (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", rootId)).first()) throw new Error("aumlok_root_already_exists");
  if (!isPqcPublicKeyHex(publicKey)) throw new Error("aumlok_root_pubkey_invalid"); // shape-gate (immutable-once-pinned)
  const fingerprint = rootKeyFingerprint(publicKey);
  if (await fingerprintInUse(ctx, fingerprint)) throw new Error("aumlok_root_pubkey_reused"); // cross-root uniqueness
  const pinnedAt = Date.now();
  await ctx.db.insert("aumlok_root_keys", { rootId, keyId, publicKey, fingerprint, status: "active", pinnedAt });
  return { fingerprint, pinnedAt };
}

/**
 * GENESIS — LAB/ADMIN ONLY (operator-born). NOT the normal birth path: the self-sovereign B2.3 ceremony
 * (`aumlokCeremonyMint`, where the ROOT proves possession of its own key) is how a real identity is minted. This
 * operator-PoP-gated path remains for lab/admin provisioning. Once a root exists, genesis refuses (born once; key
 * changes go through rotation). The identity payload is PoP-bound (the operator's reqSig commits to {rootId,keyId,publicKey}).
 */
export const aumlokGenesisMint = internalMutation({ // S1a: internal-only (B1)
  // methodId is NOT caller-supplied: each mutation HARD-CODES its own method so the operator's reqSig binds to THIS
  // exact operation (no confused-deputy: an envelope signed for one method can't be redirected to another).
  args: { env: v.any(), actualArgs: v.any(), nodeId: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const session = await resolvePoPSession(ctx, a.env, AUMLOK_METHODS.genesis, a.actualArgs, a.nodeId); // throws pop_* → rolls back
    const rootId = asName(a.actualArgs?.rootId, "rootId");
    const keyId = asName(a.actualArgs?.keyId, "keyId");
    const publicKey = asHexBlob(a.actualArgs?.publicKey, "publicKey");
    const { fingerprint } = await mintRootKeyRow(ctx, rootId, keyId, publicKey); // shared invariants + insert
    const receiptId = await lifecycleReceipt(ctx, rootId, "aumlok.genesis", { rootId, keyId, fingerprint, authorizedByKeyId: session.keyId ?? null, mintedBy: "operator-lab-admin" });
    return { ok: true, rootId, keyId, fingerprint, receiptId };
  },
});

/**
 * ROTATE — retire the active root key and activate a new one. Operator-PoP-gated AND gated on the OLD root key's
 * signature over the rotation statement (aumlokRotation domain). Atomic: any failure throws before the registry flip.
 */
export const aumlokRotateRoot = internalMutation({ // S1a: internal-only (B1)
  args: { env: v.any(), actualArgs: v.any(), nodeId: v.string() }, // methodId hard-coded below (see aumlokGenesisMint)
  handler: async (ctx, a): Promise<any> => {
    const session = await resolvePoPSession(ctx, a.env, AUMLOK_METHODS.rotate, a.actualArgs, a.nodeId);
    const s = a.actualArgs?.statement ?? {};
    const rotationSig = asHexBlob(a.actualArgs?.rotationSig, "rotationSig");
    const rootId = asName(s.rootId, "rootId");
    const oldKeyId = asName(s.oldKeyId, "oldKeyId");
    const newKeyId = asName(s.newKeyId, "newKeyId");
    const newPublicKey = asHexBlob(s.newPublicKey, "newPublicKey");
    const newFingerprint = asStr(s.newFingerprint, "newFingerprint");
    asStr(s.reason, "reason");
    if (s.v !== 1) throw new Error("aumlok_rotation_version_unsupported"); // verifier refuses unknown statement versions
    // Timestamp hygiene: reject NaN/Infinity/non-integer/non-positive EXPLICITLY (a clear error, not a misleading
    // signature failure deep in the u64 serializer).
    if (!Number.isSafeInteger(s.timestamp) || s.timestamp <= 0) throw new Error("aumlok_rotation_timestamp_invalid");
    if (newKeyId === oldKeyId) throw new Error("aumlok_rotation_same_keyid");

    // 1. The OLD key must exist and be ACTIVE — retired/revoked keys cannot AUTHOR a new rotation (grandfathering:
    //    statements they already signed still verify, but they issue no NEW authority).
    const old = await rootKey(ctx, rootId, oldKeyId);
    if (!old) throw new Error("aumlok_root_key_unknown");
    if (old.status === "revoked") throw new Error("aumlok_root_key_revoked");
    if (old.status === "retired") throw new Error("aumlok_root_key_retired");

    // 2. Shape-gate the new key + bind its fingerprint; refuse keyId reuse (within root) and pubkey reuse (GLOBAL —
    //    one root key = one identity, no cross-root sharing).
    if (!isPqcPublicKeyHex(newPublicKey)) throw new Error("aumlok_root_pubkey_invalid");
    if (newFingerprint !== rootKeyFingerprint(newPublicKey)) throw new Error("aumlok_rotation_fingerprint_mismatch");
    if (await rootKey(ctx, rootId, newKeyId)) throw new Error("aumlok_root_keyid_exists");
    if (await fingerprintInUse(ctx, newFingerprint)) throw new Error("aumlok_root_pubkey_reused");

    // 3. THE FLIP GATE: the old key must have signed THIS exact statement under the rotation domain. Verify-then-write.
    if (!(await verifyChainHeadV3(old.publicKey, await rotationHead(s), rotationSig, "aumlokRotation"))) throw new Error("aumlok_rotation_sig_invalid");

    // 4. Atomic flip: retire old, activate new (both in this mutation — roll back together on any later throw).
    const now = Date.now();
    await ctx.db.patch(old._id, { status: "retired", retiredAt: now });
    await ctx.db.insert("aumlok_root_keys", { rootId, keyId: newKeyId, publicKey: newPublicKey, fingerprint: newFingerprint, status: "active", pinnedAt: now });
    const receiptId = await lifecycleReceipt(ctx, rootId, "aumlok.rotate", { rootId, oldKeyId, newKeyId, oldFingerprint: old.fingerprint, newFingerprint, reason: s.reason, authorizedByKeyId: session.keyId ?? null });
    return { ok: true, rootId, oldKeyId, newKeyId, newFingerprint, receiptId };
  },
});

/**
 * REVOKE — kill a root key (compromise response). Operator-PoP-gated. Targets an active OR retired key; revoked is
 * terminal. Future authority under this key is dead; the lifecycle receipt records the kill.
 */
export const aumlokRevokeRoot = internalMutation({ // S1a: internal-only (B1)
  args: { env: v.any(), actualArgs: v.any(), nodeId: v.string() }, // methodId hard-coded below (see aumlokGenesisMint)
  handler: async (ctx, a): Promise<any> => {
    const session = await resolvePoPSession(ctx, a.env, AUMLOK_METHODS.revoke, a.actualArgs, a.nodeId);
    const rootId = asName(a.actualArgs?.rootId, "rootId");
    const keyId = asName(a.actualArgs?.keyId, "keyId");
    asStr(a.actualArgs?.reason, "reason");
    const row = await rootKey(ctx, rootId, keyId);
    if (!row) throw new Error("aumlok_root_key_unknown");
    if (row.status === "revoked") throw new Error("aumlok_root_key_revoked"); // already dead — idempotent refuse
    await ctx.db.patch(row._id, { status: "revoked", retiredAt: row.retiredAt ?? Date.now() });
    const receiptId = await lifecycleReceipt(ctx, rootId, "aumlok.revoke", { rootId, keyId, fingerprint: row.fingerprint, reason: a.actualArgs?.reason, authorizedByKeyId: session.keyId ?? null });
    return { ok: true, rootId, keyId, receiptId };
  },
});
