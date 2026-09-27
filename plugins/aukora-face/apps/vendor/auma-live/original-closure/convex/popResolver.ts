// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * Brick 6 — AUMLOK PROOF-OF-POSSESSION resolver. Replaces the plaintext `node_sessions` seam for
 * operator/Ring-0 surfaces. Authority is no longer a stored token; it is a SIGNATURE the caller proves possession of,
 * per request, verified against a PINNED public key the server never holds.
 *
 * Two signatures against ONE pinned key (founder_key_registry):
 *   capSig — founder signs scoped CAVEATS once at issuance (binds founder authority INTO the grant).
 *   reqSig — holder signs each REQUEST over {capId, methodId, argsHash, nodeId, principalId, timestamp, nonce} (PoP).
 * Both reuse SignedChainHeadV3 (ML-DSA-65 via the aukoraPqcSigner chokepoint) by mapping the canonical payload's
 * SHA-256 into ChainHeadFields.chainHeadHash with a domain-separated chainKey — and, since B1.3, DISTINCT FIPS 204
 * domains ("cap" for issuance, "req" for per-request PoP) so neither signature can be lifted onto the other or onto
 * a chain head at the primitive level. Returns the same {principalId,nodeId,roles} shape as the session resolver,
 * so callers are untouched. THROWS pop_* on ANY failure (fail-closed; a throw rolls back the mutation).
 *
 * S1a: HONEST REWRITE — every demo lane in the donor is REMOVED (each removal listed):
 *   - DEMO_OPERATOR_SEED (a fixed 64-hex demo fallback signing seed, hex pair 77 repeated) → fail-closed env resolver below.
 *   - popGatedAct (the "demo gated surface" that minted grants with "echo"/"echo:demo" fallback scopes).
 *   - runPopCrash + runKeyRotation (demo actions holding DEMO_FOUNDER_SEED "dd"*32, ATTACKER_SEED "ee"*32,
 *     ROT_SEED_OLD "11"*32, ROT_SEED_NEW "22"*32 — disposable demo constants; their attack coverage moves to
 *     the vendored test harness in a later V1 session, driven by test-local throwaway seeds, not deployed code).
 *   NO demo/seed key survives in this module; the resolver, registry, and rotation lanes are donor-faithful.
 */
import { internalMutation } from "./_generated/server"; // S1a: internal-only (B1); demo `mutation`/`action` lanes removed
import { v } from "convex/values";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { signChainHeadV3, verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed, isPqcPublicKeyHex } from "./aukoraPqcSigner";
import { consumeRateLimit } from "./aukoraRateLimit";

export const POP_FRESHNESS_MS = 60_000; // operator-action freshness window
const POP_RATE = () => ({ capacity: Number(process.env.AUKORA_POP_RATE_CAP ?? 30), windowMs: 60_000 });

// S1a: demo lane removed — donor exported DEMO_OPERATOR_SEED = env AUMA_OPERATOR_SEED with a hardcoded 64-hex
// demo fallback (hex pair 77 repeated). The operator seed now comes ONLY from env and FAILS CLOSED:
// unset → throw (no key derivation ever happens against a known constant); malformed → throw (same asymmetry
// as resolveChainSigningSeed). The seed itself never leaves this process and is never stored.
function resolveOperatorSeed(): string {
  const raw = process.env.AUMA_OPERATOR_SEED?.trim();
  if (!raw) throw new Error("aukora_operator_seed_unset");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("aukora_operator_seed_invalid");
  return raw.toLowerCase();
}

// ── Canonical serializers (domain-prefixed + version byte; byte-identical across signer/verifier/kit) ──
const CAP_FIELDS = ["v", "capId", "founderUserId", "founderKeyId", "nodeId", "methods", "ring", "action", "resource", "principalId", "roles", "notBefore", "expiresAt", "maxUses"] as const;
const REQ_FIELDS = ["v", "capId", "methodId", "argsHash", "nodeId", "principalId", "timestamp", "nonce"] as const;
const pick = (obj: any, fields: readonly string[]) => { const o: any = {}; for (const f of fields) o[f] = obj?.[f]; return o; };
export function serializeCapV1(caveats: any): string { return "aukora-cap-v1|" + stableStringify(pick(caveats, CAP_FIELDS)); }
export function serializeRequestV1(req: any): string { return "aukora-req-v1|" + stableStringify(pick(req, REQ_FIELDS)); }
// Map a canonical payload into the ChainHeadFields shape so we reuse the V3 head signer/verifier unchanged,
// under the distinct "cap"/"req" domains (the PQC library's audit status is the §7.1 accepted risk — never call it audited).
async function capHead(cav: any): Promise<ChainHeadFields> { return { chainKey: `aukora-cap-v1:${cav?.capId}`, timestamp: Number(cav?.notBefore ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeCapV1(cav)) }; }
async function reqHead(req: any): Promise<ChainHeadFields> { return { chainKey: `aukora-req-v1:${req?.capId}`, timestamp: Number(req?.timestamp ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeRequestV1(req)) }; }

// Signing helper for the CLIENT/TEST side of the contract (the private seed is the caller's; nothing here stores it).
// S1a: donor comment said "DEMO: founder private seed lives in the harness" — the harness demo seeds are gone; this
// helper remains because the owner tooling / vendored tests must be able to build a valid envelope to sign with.
export async function buildPoPEnvelope(seedHex: string, caveats: any, opts: { methodId: string; actualArgs: any; timestamp: number; nonce: string }) {
  const capSig = await signChainHeadV3(seedHex, await capHead(caveats), "cap");
  const argsHash = await sha256Hex(stableStringify(opts.actualArgs ?? {}));
  const reqPayload = { v: 1, capId: caveats.capId, methodId: opts.methodId, argsHash, nodeId: caveats.nodeId, principalId: caveats.principalId, timestamp: opts.timestamp, nonce: opts.nonce };
  const reqSig = await signChainHeadV3(seedHex, await reqHead(reqPayload), "req");
  return { caveats, capSig, reqSig, timestamp: opts.timestamp, nonce: opts.nonce };
}

// ── THE RESOLVER (fail-closed). Throws pop_* on failure; returns the session on success. ──
export async function resolvePoPSession(ctx: any, env: any, methodId: string, actualArgs: any, thisNodeId: string): Promise<{ principalId: string; nodeId: string; roles: string[]; ring?: string; action?: string; resource?: string; keyId?: string }> {
  const cav = env?.caveats;
  if (!cav || typeof cav !== "object") throw new Error("pop_no_capability");
  // 0. RATE LIMIT before any crypto — caps verification cost per founder (DoS guard).
  if (!(await consumeRateLimit(ctx, `pop:${cav.founderUserId ?? "?"}`, POP_RATE()))) throw new Error("pop_rate_limited");
  // 1. Pinned key lookup — by (founderUserId, founderKeyId), NEVER a key carried in the blob.
  const pin = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", cav.founderUserId).eq("keyId", cav.founderKeyId)).first();
  if (!pin) throw new Error("pop_key_unknown");
  if (pin.status === "revoked") throw new Error("pop_key_revoked"); // compromise kill — nothing under this key verifies
  // Rotation: a RETIRED key still verifies caps it issued WHILE ACTIVE (cav.notBefore < retiredAt) — old authority is
  // grandfathered — but cannot issue NEW caps (cav.notBefore >= retiredAt). New authority requires the rotated-in key.
  if (pin.status === "retired" && Number(cav.notBefore) >= Number(pin.retiredAt ?? 0)) throw new Error("pop_key_retired");
  // 2. capSig over the pinned key.
  if (!(await verifyChainHeadV3(pin.publicKey, await capHead(cav), env.capSig, "cap"))) throw new Error("pop_cap_sig_invalid");
  // 3. Caveat checks (node binding, time window, method allow-list).
  const now = Date.now();
  if (cav.nodeId !== thisNodeId) throw new Error("pop_node_mismatch");
  if (!(Number(cav.notBefore) <= now && now < Number(cav.expiresAt))) throw new Error("pop_cap_expired");
  if (!Array.isArray(cav.methods) || !cav.methods.includes(methodId)) throw new Error("pop_method_not_allowed");
  // 4. Revocation (reuse node_revocations: sourceNodeId=founderUserId, delegationId=capId).
  const rev = await ctx.db.query("node_revocations").withIndex("by_src_del", (q: any) => q.eq("sourceNodeId", cav.founderUserId).eq("delegationId", cav.capId)).first();
  if (rev) throw new Error("pop_revoked");
  // 5. Freshness + SERVER-recomputed argsHash (client cannot self-assert the digest).
  if (typeof env.timestamp !== "number" || Math.abs(now - env.timestamp) > POP_FRESHNESS_MS) throw new Error("pop_expired");
  const argsHash = await sha256Hex(stableStringify(actualArgs ?? {}));
  // 6. reqSig over the SAME pinned key — binds capId+methodId+argsHash+nodeId+principalId+timestamp+nonce.
  const reqPayload = { v: 1, capId: cav.capId, methodId, argsHash, nodeId: thisNodeId, principalId: cav.principalId, timestamp: env.timestamp, nonce: env.nonce };
  if (!(await verifyChainHeadV3(pin.publicKey, await reqHead(reqPayload), env.reqSig, "req"))) throw new Error("pop_req_sig_invalid");
  // 7. Replay: claim the nonce LAST (verified-then-claimed → bogus sigs never burn a nonce; commits only on success).
  if (typeof env.nonce !== "string" || !env.nonce) throw new Error("pop_nonce_missing");
  const dup = await ctx.db.query("pop_nonce_registry").withIndex("by_node_nonce", (q: any) => q.eq("nodeId", thisNodeId).eq("nonce", env.nonce)).first();
  if (dup) throw new Error("pop_replay");
  await ctx.db.insert("pop_nonce_registry", { nodeId: thisNodeId, founderUserId: cav.founderUserId, keyId: cav.founderKeyId, capId: cav.capId, nonce: env.nonce, methodId, argsHash, consumedAt: now, expiresAt: now + POP_FRESHNESS_MS });
  // Return the SIGNED caveat scope + the authorizing keyId so callers can bind their effect + record WHICH key authorized.
  return { principalId: cav.principalId, nodeId: cav.nodeId, roles: Array.isArray(cav.roles) ? cav.roles : ["operator"], ring: cav.ring, action: cav.action, resource: cav.resource, keyId: cav.founderKeyId };
}

// S1a: demo lane removed — donor's `popGatedAct` ("demo gated surface ... stands in for issueGrant") is NOT vendored:
// it minted an aukora_grants row with "echo"/"echo:demo" fallback scopes when caveats omitted them. The real
// grant-minting paths are aukoraRuntime.issueGrant and the aumlokMemoryWrite manifest pipeline.

// ── Seed / admin: pin an owner founder pubkey; revoke a cap; rotate keys. (Donor demo framing removed.) ──
export const seedFounderKey = internalMutation({
  args: { founderUserId: v.string(), keyId: v.string(), publicKey: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", a.founderUserId).eq("keyId", a.keyId)).first();
    if (existing) {
      // Defense-in-depth (ULTRON core-PoP review): an ACTIVE pinned key's publicKey is IMMUTABLE here — silently
      // replacing it would let a registry write hijack the trust root for emit/revoke. Rotation goes through
      // rotateFounderKey; status flips (active->revoked) keep the SAME key.
      if (existing.status === "active" && a.publicKey !== existing.publicKey) throw new Error("pop_key_immutable_active");
      await ctx.db.patch(existing._id, { publicKey: a.publicKey, status: a.status ?? "active" }); return { updated: true };
    }
    // Shape-gate FRESH pins (B1.3b): a legacy 64-hex/garbage founder key would never verify and, once active,
    // is immutable — refuse it at the door.
    if (!isPqcPublicKeyHex(a.publicKey)) throw new Error("pop_pubkey_invalid");
    await ctx.db.insert("founder_key_registry", { founderUserId: a.founderUserId, keyId: a.keyId, publicKey: a.publicKey, status: a.status ?? "active", pinnedAt: Date.now() });
    return { seeded: true };
  },
});

// Operator-key provisioning. Takes NO caller-supplied key — it DERIVES the operator public key from the server-side
// env seed and pins it idempotently; an active key is IMMUTABLE (rotation via rotateFounderKey). So the original
// hijack (caller POSTs their own pubkey) is structurally impossible: a caller can only ever (re)pin the one
// legitimate key. S1a: internal-only (B1) + the seed is env-only, fail-closed (see resolveOperatorSeed — the donor
// demo-constant fallback is removed).
export const seedOperatorKey = internalMutation({ // S1a: internal-only (B1); was public `mutation` in donor
  args: {},
  handler: async (ctx): Promise<any> => {
    const publicKey = await mlDsa65PublicKeyFromSeed(resolveOperatorSeed()); // S1a: fail-closed env seed (demo fallback removed)
    const existing = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", "aukora.operator").eq("keyId", "op-1")).first();
    if (existing) { if (existing.status === "active" && existing.publicKey !== publicKey) throw new Error("pop_key_immutable_active"); await ctx.db.patch(existing._id, { publicKey, status: "active" }); return { updated: true }; }
    await ctx.db.insert("founder_key_registry", { founderUserId: "aukora.operator", keyId: "op-1", publicKey, status: "active", pinnedAt: Date.now() });
    return { seeded: true };
  },
});
export const revokePopCap = internalMutation({
  args: { founderUserId: v.string(), capId: v.string() },
  handler: async (ctx, a) => { await ctx.db.insert("node_revocations", { sourceNodeId: a.founderUserId, delegationId: a.capId, revokedAt: Date.now() }); return { revoked: true }; },
});
// Brick 7 — KEY ROTATION: retire the old key (grandfathers caps it issued; cannot issue new) + pin the new key active.
export const rotateFounderKey = internalMutation({
  args: { founderUserId: v.string(), oldKeyId: v.string(), newKeyId: v.string(), newPublicKey: v.string() },
  handler: async (ctx, a) => {
    if (!isPqcPublicKeyHex(a.newPublicKey)) throw new Error("pop_pubkey_invalid"); // B1.3b: rotation can't install a legacy/garbage key
    const now = Date.now();
    const old = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", a.founderUserId).eq("keyId", a.oldKeyId)).first();
    if (old) await ctx.db.patch(old._id, { status: "retired", retiredAt: now });
    const existingNew = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", a.founderUserId).eq("keyId", a.newKeyId)).first();
    if (existingNew) await ctx.db.patch(existingNew._id, { publicKey: a.newPublicKey, status: "active" });
    else await ctx.db.insert("founder_key_registry", { founderUserId: a.founderUserId, keyId: a.newKeyId, publicKey: a.newPublicKey, status: "active", pinnedAt: now });
    return { rotated: true, retiredAt: now };
  },
});

// S1a: demo lane removed — donor's `runPopCrash` (9-attack live proof) and `runKeyRotation` (rotation lifecycle
// proof) actions are NOT vendored: both carried disposable demo signing seeds ("dd"/"ee"/"11"/"22" repeated) baked
// into deployed code. The attack matrix they proved (garbage cap, forged key, replay, cross-function lift, args
// tamper, expiry, revocation, wrong node, retire/revoke lifecycle) belongs in the vendored TEST harness
// (V1 later session) with test-local throwaway seeds — never in the deployed function set.
