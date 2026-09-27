// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * B2.2 — AUMLOK delegation MANIFESTS. A manifest is a DOUBLY-SIGNED delegation from an identity root key to a subject
 * (agent / device / node / model): the ROOT signs the manifest under `aukora-aumlok-manifest-v1`, the SUBJECT
 * counter-signs proof-of-possession under `aukora-aumlok-subjectpop-v1`. BOTH must verify before the manifest is
 * stored active — a manifest with a missing/forged/wrong-domain/tampered signature is refused. Mirrors the proven
 * codeAttestation manifest-signing + popResolver two-signature shapes, and the B2.1 root-registry status semantics.
 *
 * INVARIANT — NO SIGNED-BUT-UNENFORCED FIELD. Every field in the signed serialization is enforced: `permissions`
 * (resolver match), `allowedIntentCodecs` (resolver membership), `notBefore`/`expiresAt` (resolver time), `maxUses`
 * (OCC `usedCount` counter), `maxPerWindow` (consumeRateLimit), `subjectPubKey` (the PoP — the authoritative subject
 * binding), `subjectId` (re-asserted + matched at consume), `rootId`+`rootKeyId` (root-key lookup + live status), and
 * `manifestId` (the unique lookup key). `subjectKind` is bound + range-checked at mint (rejects an unknown kind) but
 * is NOT yet an authority gate — per-kind policy is DESIGNED/FUTURE, stated not faked. Unknown/extra input fields are
 * DROPPED before hashing+storage, so an unsigned field can never grant authority.
 *
 * IMMUTABLE v1: there is no amend — changing a manifest means revoke + re-mint. Lifecycle (mint / root-revoke /
 * subject-self-revoke-or-pause) is receipted on the reserved `mft:{manifestId}` V4 chain (one writer,
 * appendManifestLifecycleReceipt). CONSUME does not receipt in B2.2 (no real effect yet — that is B2.4); it only
 * enforces the circuit breakers. Root revocation is superior to subject self-revocation.
 *
 * CLAIM DISCIPLINE: PROVEN-LAB for the tested behavior. NO production claim; Vymakira (`vk_v1`) is a FUTURE codec
 * label with NO security meaning — only `json_action_v1` is concrete. Ceremony (B2.3), memory enforcement (B2.4),
 * and recovery are OUT of scope.
 */
import { internalMutation, internalQuery } from "./_generated/server"; // S1a: internal-only (B1)
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { signChainHeadV3, verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";
import { isPqcPublicKeyHex } from "./aukoraPqcSigner";
import { rootKeyFingerprint } from "./aumlokRootRegistry";
import { appendManifestLifecycleReceipt, IDENTITY_NAME_RE } from "./aukoraReceipts";
import { consumeRateLimit } from "./aukoraRateLimit";
import { FRESHNESS_WINDOW_MS } from "./aukoraConstants"; // S1a: cycle cut — was ./nodeImport (multi-node parked; value identical). B3.5b: reuse the B3.5a pull-origin freshness window (cross-grant honor gate)

export const AUMLOK_SUBJECT_KINDS = Object.freeze(["agent", "device", "node", "model"] as const);
/** Rings a manifest MAY grant. `self-modify` (the kernel ceiling-wall ring, never auto-grantable — aukoraCore
 *  AukoraRing/RING_ORDER) is REFUSED at mint; unknown/typo rings are refused too. action/resource stay free scopes. */
export const AUMLOK_MANIFEST_RINGS = Object.freeze(["observe", "local-write", "external"] as const);
/** Concrete intent codecs (enforced). `vk_v1` is a FUTURE label a manifest MAY list, but there is no Vymakira
 *  implementation and it carries NO security meaning — the resolver only enforces codec MEMBERSHIP, not semantics. */
export const AUMLOK_CODEC_RE = /^[a-z0-9_]{1,32}$/;
const SCOPE_RE = /^[\x21-\x7e]{1,128}$/; // action/resource/intentCodec/nodeId: printable ASCII, bounded, exact-matched (may contain ':' — not a chainKey)
const CONSUME_FRESHNESS_MS = 60_000;
/** This deployment's node identity (same source as the rest of the kernel). A manifest is signed FOR a specific node;
 *  mint refuses a foreign nodeId and the resolver refuses a manifest not bound to THIS node — closing cross-node
 *  replay before the B3 mesh exists (where every node pins the same root key). */
// S1a: demo lane removed — donor defaulted to "aukora-node-a-demo" when AUMA_NODE_ID was unset; the local
// organism FAILS CLOSED instead (an unset node id must never silently bind or mint against a demo node).
const THIS_NODE_ID = (): string => {
  const n = process.env.AUMA_NODE_ID?.trim();
  if (!n) throw new Error("aukora_node_id_unset");
  return n;
};

// ── Canonical signed serialization (the ONLY bytes the two signatures cover). Nullable limits are normalized to an
//    explicit null so "absent" and "present" never collide; extra input fields are excluded by construction. ──
type Permission = { ring: string; action: string; resource: string };
function canonicalManifest(m: any) {
  return {
    v: 1,
    manifestId: m.manifestId, rootId: m.rootId, rootKeyId: m.rootKeyId, nodeId: m.nodeId, // nodeId signed → anti cross-node lift
    subjectId: m.subjectId, subjectKind: m.subjectKind, subjectPubKey: m.subjectPubKey,
    permissions: (m.permissions ?? []).map((p: any) => ({ ring: p?.ring, action: p?.action, resource: p?.resource })),
    allowedIntentCodecs: m.allowedIntentCodecs ?? [],
    notBefore: m.notBefore, expiresAt: m.expiresAt,
    maxUses: m.maxUses ?? null,
    maxPerWindow: m.maxPerWindow ? { capacity: m.maxPerWindow.capacity, windowMs: m.maxPerWindow.windowMs } : null,
    createdAt: m.createdAt,
  };
}
export function serializeManifestV1(m: any): string { return "aukora-aumlok-manifest-v1|" + stableStringify(canonicalManifest(m)); }
export async function manifestHash(m: any): Promise<string> { return sha256Hex(serializeManifestV1(m)); }

// Two heads over the SAME manifest commitment, distinct chainKeys + domains (the root sig and subject PoP can never
// be lifted onto each other — chain_id + FIPS 204 domain separation). NOT receipt chainKeys (signing preimages only).
export async function manifestRootHead(m: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:mft:${m.manifestId}`, timestamp: Number(m.createdAt), chainLength: 1, chainHeadHash: await manifestHash(m) }; }
export async function manifestPopHead(m: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:mftpop:${m.manifestId}`, timestamp: Number(m.createdAt), chainLength: 1, chainHeadHash: await manifestHash(m) }; }

// Revoke/pause statement (root signs under aumlokManifest; subject signs under aumlokSubjectPop — distinct heads).
const REVOKE_FIELDS = ["v", "manifestId", "action", "reason", "timestamp"] as const;
const pick = (o: any, f: readonly string[]) => { const r: any = {}; for (const k of f) r[k] = o?.[k]; return r; };
export function serializeRevokeV1(s: any): string { return "aukora-aumlok-mft-revoke-v1|" + stableStringify(pick(s, REVOKE_FIELDS)); }
export async function rootRevokeHead(s: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:mftrev:${s.manifestId}`, timestamp: Number(s.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeRevokeV1(s)) }; }
export async function subjectRevokeHead(s: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:mftself:${s.manifestId}`, timestamp: Number(s.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeRevokeV1(s)) }; }

// Consume request (subject signs under aumlokSubjectPop). useSeq === usedCount is a replay-proof monotonic nonce.
// subjectId is bound + enforced (must match the manifest) so the signed subjectId is not dead weight.
const CONSUME_FIELDS = ["v", "manifestId", "subjectId", "action", "resource", "ring", "intentCodec", "useSeq", "timestamp"] as const;
export function serializeConsumeV1(r: any): string { return "aukora-aumlok-mft-use-v1|" + stableStringify(pick(r, CONSUME_FIELDS)); }
export async function consumeHead(r: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:mftuse:${r.manifestId}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeConsumeV1(r)) }; }

// ── Validation (fail closed). Identity names use the frozen IDENTITY_NAME_RE (no colon); scope/codec fields have
//    their own bounded grammars; timestamps must be safe positive integers (no NaN/Infinity reaching the u64 serializer). ──
const asName = (x: unknown, f: string): string => { if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error(`aumlok_mft_name_invalid:${f}`); return x; };
const asScope = (x: unknown, f: string): string => { if (typeof x !== "string" || !SCOPE_RE.test(x)) throw new Error(`aumlok_mft_scope_invalid:${f}`); return x; };
const asPosInt = (x: unknown, f: string): number => { if (!Number.isSafeInteger(x) || (x as number) <= 0) throw new Error(`aumlok_mft_int_invalid:${f}`); return x as number; };
// A manifest may NEVER grant `self-modify` (its own error) and may only grant a whitelisted ring (typos refuse).
const asRing = (x: unknown): string => {
  if (x === "self-modify") throw new Error("aumlok_mft_ring_self_modify");
  if (typeof x !== "string" || !(AUMLOK_MANIFEST_RINGS as readonly string[]).includes(x)) throw new Error("aumlok_mft_ring_invalid");
  return x;
};

function validatePermissions(perms: any): Permission[] {
  if (!Array.isArray(perms) || perms.length === 0 || perms.length > 64) throw new Error("aumlok_mft_permissions_invalid");
  return perms.map((p) => ({ ring: asRing(p?.ring), action: asScope(p?.action, "action"), resource: asScope(p?.resource, "resource") }));
}
function validateCodecs(codecs: any): string[] {
  if (!Array.isArray(codecs) || codecs.length === 0 || codecs.length > 16) throw new Error("aumlok_mft_codecs_invalid");
  return codecs.map((c) => { if (typeof c !== "string" || !AUMLOK_CODEC_RE.test(c)) throw new Error("aumlok_mft_codec_invalid"); return c; });
}
function validateMaxPerWindow(w: any): { capacity: number; windowMs: number } | null {
  if (w == null) return null;
  return { capacity: asPosInt(w.capacity, "maxPerWindow.capacity"), windowMs: asPosInt(w.windowMs, "maxPerWindow.windowMs") };
}

type ManifestRow = {
  _id: any; manifestId: string; rootId: string; rootKeyId: string; nodeId: string; subjectId: string; subjectKind: string;
  subjectPubKey: string; subjectFingerprint: string; permissionsJson: string; allowedIntentCodecsJson: string;
  notBefore: number; expiresAt: number; maxUses?: number; maxPerWindowJson?: string; usedCount: number;
  status: string; manifestHash: string; rootSig: string; subjectPopSig: string; createdAt: number;
  revokedAt?: number; revokedBy?: string; pausedAt?: number;
};

async function manifestById(ctx: QueryCtx | MutationCtx, manifestId: string): Promise<ManifestRow | null> {
  return (await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q) => q.eq("manifestId", manifestId)).first()) as ManifestRow | null;
}
/** B3.5b: the cross-grant authority row (a foreign manifest A signed FOR this node, promoted into node_cross_grants). The
 *  resolver reads aumlok_manifests + THIS, and NEVER node_foreign_manifests (which stays B3.5a audit-only). */
async function crossGrantById(ctx: QueryCtx | MutationCtx, manifestId: string): Promise<ManifestRow | null> {
  return (await ctx.db.query("node_cross_grants").withIndex("by_manifestId", (q) => q.eq("manifestId", manifestId)).first()) as unknown as ManifestRow | null;
}
async function rootKeyRow(ctx: QueryCtx | MutationCtx, rootId: string, rootKeyId: string): Promise<any> {
  return ctx.db.query("aumlok_root_keys").withIndex("by_root_kid", (q) => q.eq("rootId", rootId).eq("keyId", rootKeyId)).first();
}

/** B3.5b issuer tag — AUDIT-ONLY (threaded into the grant + receipt; NO check ever branches on it to loosen anything). */
export type ManifestIssuer = { kind: "local" } | { kind: "foreign"; sourceNodeId: string; rootId: string; rootKeyId: string };

/** RESOLVE manifest authority (READ-ONLY; no counter consumption). Fail-closed pipeline: manifest exists + active +
 *  within [notBefore,expiresAt) + the signing root key resolved & not revoked + {ring,action,resource} matches a signed
 *  permission + intentCodec is allowed. B3.5b: the row may be a LOCAL manifest (aumlok_manifests) OR a promoted
 *  cross-grant (node_cross_grants); local takes deterministic precedence. The ONLY relaxed clause is WHERE the signing
 *  key comes from — a rootId-bound PINNED FOREIGN ROOT when the rootId is absent from aumlok_root_keys ENTIRELY. A local
 *  rootId with an unknown keyId refuses `root_key_unknown` (never foreign-fallback). Returns the row + issuer tag. */
export async function resolveManifestAuthority(
  ctx: QueryCtx | MutationCtx,
  req: { manifestId: string; ring: string; action: string; resource: string; intentCodec: string; now?: number },
): Promise<{ ok: boolean; reason?: string; manifest?: ManifestRow; issuer?: ManifestIssuer }> {
  const local = await manifestById(ctx, req.manifestId);
  const cross = local ? null : await crossGrantById(ctx, req.manifestId); // local authority is never shadowed by a cross-grant
  const m = (local ?? cross) as ManifestRow | null;
  if (!m) return { ok: false, reason: "manifest_unknown" };
  if (m.nodeId !== THIS_NODE_ID()) return { ok: false, reason: "node_mismatch" }; // a manifest bound to another node grants nothing here (unchanged outer gate)
  if (m.status !== "active") return { ok: false, reason: m.status === "revoked" ? "manifest_revoked" : m.status === "paused" ? "manifest_paused" : "manifest_inactive" };
  const now = Number.isSafeInteger(req.now) ? (req.now as number) : Date.now();
  if (now < m.notBefore) return { ok: false, reason: "manifest_not_yet_valid" }; // B's LOCAL clock governs B-local effects (live for foreign too)
  if (now >= m.expiresAt) return { ok: false, reason: "manifest_expired" };
  // ── root-key resolution: the ONE relaxed clause. A rootId with ANY local key NEVER reaches the foreign branch. ──
  let issuer: ManifestIssuer;
  const anyLocalRoot = await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", m.rootId)).first();
  if (anyLocalRoot) {                                                              // LOCAL root namespace exists
    const rk = await rootKeyRow(ctx, m.rootId, m.rootKeyId);
    if (!rk) return { ok: false, reason: "root_key_unknown" };                     // unknown/rotated keyId → refuse (NO foreign-fallback)
    if (rk.status === "revoked") return { ok: false, reason: "root_revoked" };
    issuer = { kind: "local" };
  } else {                                                                          // FOREIGN namespace (B3.5b)
    if (!cross) return { ok: false, reason: "not_cross_grant" };                    // a non-promoted manifest is not authority
    const sourceNodeId = (cross as any).sourceNodeId;                               // from the PROMOTED row — never self-declared by the manifest
    const pin = await ctx.db.query("node_trust_registry").withIndex("by_src_root_kid", (q) => q.eq("sourceNodeId", sourceNodeId).eq("rootId", m.rootId).eq("headKeyId", `root:${m.rootKeyId}`)).first();
    if (!pin || pin.rootId !== m.rootId) return { ok: false, reason: "unpinned_foreign_root" }; // rootId-bound pin or nothing
    // Db3: revocation-view freshness (fail-closed) + not-revoked — the same B3.5a pull-origin gate.
    const view = await ctx.db.query("node_revocation_view").withIndex("by_src_root", (q) => q.eq("sourceNodeId", sourceNodeId).eq("rootId", m.rootId)).first();
    if (!view || Date.now() - view.verifiedAtLocal > FRESHNESS_WINDOW_MS) return { ok: false, reason: "stale_revocation_view" };
    if ((JSON.parse(view.revokedManifestIdsJson || "[]") as string[]).includes(m.manifestId)) return { ok: false, reason: "cross_grant_revoked" };
    issuer = { kind: "foreign", sourceNodeId, rootId: m.rootId, rootKeyId: m.rootKeyId };
  }
  // permission / codec — IDENTICAL for local and foreign (no issuer.kind branch loosens these).
  const perms: Permission[] = JSON.parse(m.permissionsJson);
  if (!perms.some((p) => p.ring === req.ring && p.action === req.action && p.resource === req.resource)) return { ok: false, reason: "permission_denied" };
  const codecs: string[] = JSON.parse(m.allowedIntentCodecsJson);
  if (!codecs.includes(req.intentCodec)) return { ok: false, reason: "codec_not_allowed" };
  return { ok: true, manifest: m, issuer };
}

/** Read-only authority check exposed as a query (no state change). Uses SERVER time only — the deployed surface never
 *  accepts a caller-controlled `now` (the consume mutation also always uses server time; the `now` override on
 *  resolveManifestAuthority exists solely for deterministic time-window tests, driven via t.run). */
export const aumlokManifestResolve = internalQuery({ // S1a: internal-only (B1)
  args: { manifestId: v.string(), ring: v.string(), action: v.string(), resource: v.string(), intentCodec: v.string() },
  handler: async (ctx, a): Promise<any> => resolveManifestAuthority(ctx, a),
});

/** MINT a manifest. Gated by the two signatures themselves: the ROOT (active key — retired CANNOT mint new) signs the
 *  canonical manifest under aumlokManifest, the SUBJECT counter-signs the SAME commitment under aumlokSubjectPop.
 *  Both verify before storage. Only the canonical fields are hashed+stored, so an unknown input field grants nothing. */
export const aumlokMintManifest = internalMutation({ // S1a: internal-only (B1)
  args: { manifest: v.any(), rootSig: v.string(), subjectPopSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const i = a.manifest ?? {};
    if (i.v !== 1) throw new Error("aumlok_mft_version_unsupported");
    if (typeof a.rootSig !== "string" || !a.rootSig || typeof a.subjectPopSig !== "string" || !a.subjectPopSig) throw new Error("aumlok_mft_signature_missing");
    const manifestId = asName(i.manifestId, "manifestId");
    const rootId = asName(i.rootId, "rootId");
    const rootKeyId = asName(i.rootKeyId, "rootKeyId");
    const nodeId = asScope(i.nodeId, "nodeId");
    if (nodeId !== THIS_NODE_ID()) throw new Error("aumlok_mft_node_mismatch"); // a manifest is minted on, and for, exactly THIS node
    const subjectId = asName(i.subjectId, "subjectId");
    if (!AUMLOK_SUBJECT_KINDS.includes(i.subjectKind)) throw new Error("aumlok_mft_subjectkind_invalid");
    const subjectPubKey = i.subjectPubKey;
    if (!isPqcPublicKeyHex(subjectPubKey)) throw new Error("aumlok_mft_subject_pubkey_invalid");
    const permissions = validatePermissions(i.permissions);
    const allowedIntentCodecs = validateCodecs(i.allowedIntentCodecs);
    const notBefore = asPosInt(i.notBefore, "notBefore");
    const expiresAt = asPosInt(i.expiresAt, "expiresAt");
    if (notBefore >= expiresAt) throw new Error("aumlok_mft_window_invalid");
    const maxUses = i.maxUses == null ? null : asPosInt(i.maxUses, "maxUses");
    const maxPerWindow = validateMaxPerWindow(i.maxPerWindow);
    const createdAt = asPosInt(i.createdAt, "createdAt");

    // Canonical view (drops any extra input field) — the EXACT bytes the signatures must cover.
    const m = { v: 1, manifestId, rootId, rootKeyId, nodeId, subjectId, subjectKind: i.subjectKind, subjectPubKey, permissions, allowedIntentCodecs, notBefore, expiresAt, maxUses, maxPerWindow, createdAt };

    // The minting root key must exist and be ACTIVE — a retired/revoked key cannot mint a NEW manifest (B2.1 semantics).
    const rk = await rootKeyRow(ctx, rootId, rootKeyId);
    if (!rk) throw new Error("aumlok_mft_root_key_unknown");
    if (rk.status === "revoked") throw new Error("aumlok_mft_root_key_revoked");
    if (rk.status === "retired") throw new Error("aumlok_mft_root_key_retired");

    // BOTH signatures over the canonical commitment, distinct domains. verifyChainHeadV3 returns false (never throws).
    if (!(await verifyChainHeadV3(rk.publicKey, await manifestRootHead(m), a.rootSig, "aumlokManifest"))) throw new Error("aumlok_mft_root_sig_invalid");
    if (!(await verifyChainHeadV3(subjectPubKey, await manifestPopHead(m), a.subjectPopSig, "aumlokSubjectPop"))) throw new Error("aumlok_mft_subject_pop_invalid");

    if (await manifestById(ctx, manifestId)) throw new Error("aumlok_mft_manifestid_exists"); // duplicate/re-insert refused

    const hash = await manifestHash(m);
    const subjectFingerprint = rootKeyFingerprint(subjectPubKey);
    await ctx.db.insert("aumlok_manifests", {
      manifestId, rootId, rootKeyId, nodeId, subjectId, subjectKind: i.subjectKind, subjectPubKey, subjectFingerprint,
      permissionsJson: JSON.stringify(permissions), allowedIntentCodecsJson: JSON.stringify(allowedIntentCodecs),
      notBefore, expiresAt, ...(maxUses != null ? { maxUses } : {}), ...(maxPerWindow ? { maxPerWindowJson: JSON.stringify(maxPerWindow) } : {}),
      usedCount: 0, status: "active", manifestHash: hash, rootSig: a.rootSig, subjectPopSig: a.subjectPopSig, createdAt,
    });
    const receiptId = await appendManifestLifecycleReceipt(ctx, manifestId, "aumlok.manifest.mint", { manifestId, rootId, rootKeyId, subjectId, subjectKind: i.subjectKind, subjectFingerprint, manifestHash: hash });
    return { ok: true, manifestId, manifestHash: hash, subjectFingerprint, receiptId };
  },
});

/** ROOT-initiated manifest revoke (superior). Signed by the rootId's CURRENT ACTIVE key under aumlokManifest — NOT
 *  the minting key. Rationale (B2.2 review): only ACTIVE keys author new signed actions (mirrors mint/rotate); using
 *  the current active key (not the minting key) also keeps targeted revocation working AFTER a rotation — the new
 *  active key governs all delegations under its identity, including manifests minted by a now-retired predecessor
 *  (which the resolver still grandfathers until revoked). A retired/old key can no longer revoke. Terminal. */
export const aumlokRevokeManifest = internalMutation({ // S1a: internal-only (B1)
  args: { statement: v.any(), rootSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const s = a.statement ?? {};
    if (s.v !== 1) throw new Error("aumlok_mft_version_unsupported");
    if (s.action !== "revoke") throw new Error("aumlok_mft_revoke_action_invalid");
    const manifestId = asName(s.manifestId, "manifestId");
    asScope(s.reason, "reason");
    asPosInt(s.timestamp, "timestamp");
    if (typeof a.rootSig !== "string" || !a.rootSig) throw new Error("aumlok_mft_signature_missing");
    const m = await manifestById(ctx, manifestId);
    if (!m) throw new Error("aumlok_mft_manifest_unknown");
    if (m.status === "revoked") throw new Error("aumlok_mft_already_revoked"); // terminal — idempotent refuse
    // The CURRENT active key of the identity (exactly one exists unless the root itself is fully revoked).
    const keys = await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", m.rootId)).collect();
    const active = keys.find((k: any) => k.status === "active");
    if (!active) throw new Error("aumlok_mft_no_active_root_key"); // root fully revoked → manifest already dead at resolve
    if (!(await verifyChainHeadV3(active.publicKey, await rootRevokeHead(s), a.rootSig, "aumlokManifest"))) throw new Error("aumlok_mft_root_sig_invalid");
    await ctx.db.patch(m._id, { status: "revoked", revokedAt: Date.now(), revokedBy: "root" });
    const receiptId = await appendManifestLifecycleReceipt(ctx, manifestId, "aumlok.manifest.revoke", { manifestId, by: "root", byKeyId: active.keyId, reason: s.reason });
    return { ok: true, manifestId, by: "root", receiptId };
  },
});

/** SUBJECT self-revocation / quarantine. The SUBJECT key signs a revoke|pause statement under aumlokSubjectPop. It may
 *  affect ONLY its own manifest (bound by the signed manifestId, verified against THIS manifest's subjectPubKey) — it
 *  cannot touch the root, other manifests, or history. Root revocation remains superior (a root-revoked manifest is
 *  terminal; the subject cannot un-revoke it). */
export const aumlokManifestSelfRevoke = internalMutation({ // S1a: internal-only (B1)
  args: { statement: v.any(), subjectSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const s = a.statement ?? {};
    if (s.v !== 1) throw new Error("aumlok_mft_version_unsupported");
    if (s.action !== "revoke" && s.action !== "pause") throw new Error("aumlok_mft_selfaction_invalid");
    const manifestId = asName(s.manifestId, "manifestId");
    asScope(s.reason, "reason");
    asPosInt(s.timestamp, "timestamp");
    if (typeof a.subjectSig !== "string" || !a.subjectSig) throw new Error("aumlok_mft_signature_missing");
    const m = await manifestById(ctx, manifestId);
    if (!m) throw new Error("aumlok_mft_manifest_unknown");
    if (m.status === "revoked") throw new Error("aumlok_mft_already_revoked"); // root-revoke is superior + terminal
    // Verify against THIS manifest's subject key only — a subject can act on no manifest but its own.
    if (!(await verifyChainHeadV3(m.subjectPubKey, await subjectRevokeHead(s), a.subjectSig, "aumlokSubjectPop"))) throw new Error("aumlok_mft_subject_sig_invalid");
    const now = Date.now();
    const next = s.action === "revoke" ? { status: "revoked", revokedAt: now, revokedBy: "subject" } : { status: "paused", pausedAt: now };
    await ctx.db.patch(m._id, next);
    const receiptId = await appendManifestLifecycleReceipt(ctx, manifestId, `aumlok.manifest.${s.action}`, { manifestId, by: "subject", reason: s.reason });
    return { ok: true, manifestId, action: s.action, by: "subject", receiptId };
  },
});

/** CONSUME one use of a manifest. Subject-PoP-gated (the subject signs the request under aumlokSubjectPop). Resolves
 *  authority, then enforces the circuit breakers atomically: `useSeq === usedCount` (replay-proof monotonic nonce),
 *  freshness, `maxUses` (OCC read-check-increment on usedCount — Convex serializes the row, no double-spend), and
 *  `maxPerWindow` (consumeRateLimit token bucket). Any failure throws → the whole mutation rolls back (no use spent).
 *  B2.2 performs NO effect and writes NO receipt here — it proves the limits bite; effects are B2.4. */
/** SHARED CONSUME CHOKEPOINT (B2.2 + B2.4). Resolves authority, verifies the subject PoP over the request, enforces
 *  the circuit breakers, and does the OCC `usedCount++` — all callers go through THIS so the pure consume (B2.2) and
 *  the memory EFFECT (B2.4) cannot drift on a single check. Runs inside the CALLER's mutation transaction, so the
 *  increment is atomic with whatever effect the caller performs: any later throw rolls back the use too (a use is
 *  spent IFF the whole mutation commits). Returns the resolved manifest + the post-increment count. */
export async function consumeManifestUseCore(
  ctx: MutationCtx, r: any, subjectSig: unknown,
): Promise<{ manifest: ManifestRow; useSeq: number; usedCount: number; issuer?: ManifestIssuer }> {
  if (r?.v !== 1) throw new Error("aumlok_mft_version_unsupported");
  const manifestId = asName(r.manifestId, "manifestId");
  const subjectId = asName(r.subjectId, "subjectId");
  const ring = asScope(r.ring, "ring");          // the REQUESTED scope — matched against the signed permissions
  const action = asScope(r.action, "action");
  const resource = asScope(r.resource, "resource");
  const intentCodec = asScope(r.intentCodec, "intentCodec");
  asPosInt(r.timestamp, "timestamp");
  if (!Number.isSafeInteger(r.useSeq) || r.useSeq < 0) throw new Error("aumlok_mft_useseq_invalid");
  if (typeof subjectSig !== "string" || !subjectSig) throw new Error("aumlok_mft_signature_missing");

  const res = await resolveManifestAuthority(ctx, { manifestId, ring, action, resource, intentCodec });
  if (!res.ok || !res.manifest) throw new Error(`aumlok_mft_${res.reason}`);
  const m = res.manifest;
  const issuer = res.issuer; // AUDIT-ONLY (carried to the receipt/grant); NO check below branches on it — local & foreign run the same checks
  if (subjectId !== m.subjectId) throw new Error("aumlok_mft_subject_mismatch"); // the signed subjectId is enforced, not decorative

  // Subject proof-of-possession over the request (binds manifestId/subjectId/action/resource/ring/intentCodec/useSeq/timestamp).
  if (!(await verifyChainHeadV3(m.subjectPubKey, await consumeHead(r), subjectSig as string, "aumlokSubjectPop"))) throw new Error("aumlok_mft_subject_pop_invalid");
  if (Math.abs(Date.now() - Number(r.timestamp)) > CONSUME_FRESHNESS_MS) throw new Error("aumlok_mft_stale");
  if (r.useSeq !== m.usedCount) throw new Error("aumlok_mft_useseq_mismatch"); // replay / out-of-order → refuse

  if (m.maxUses != null && m.usedCount >= m.maxUses) throw new Error("aumlok_mft_max_uses_exceeded");
  if (m.maxPerWindowJson) {
    const w = JSON.parse(m.maxPerWindowJson);
    if (!(await consumeRateLimit(ctx, `mft:${manifestId}`, { capacity: w.capacity, windowMs: w.windowMs }))) throw new Error("aumlok_mft_rate_exceeded");
  }
  await ctx.db.patch(m._id, { usedCount: m.usedCount + 1 }); // OCC-safe increment — m._id is the resolved row (local OR cross-grant): ONE chokepoint, both tables
  return { manifest: m, useSeq: r.useSeq, usedCount: m.usedCount + 1, issuer };
}

export const aumlokManifestConsume = internalMutation({ // S1a: internal-only (B1)
  args: { req: v.any(), subjectSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const { manifest, useSeq, usedCount } = await consumeManifestUseCore(ctx, a.req ?? {}, a.subjectSig);
    return { ok: true, manifestId: manifest.manifestId, useSeq, usedCount }; // B2.2 still performs NO effect / NO receipt here
  },
});
