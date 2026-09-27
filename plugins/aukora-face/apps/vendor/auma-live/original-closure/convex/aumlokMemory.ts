// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * B2.4 — AUMLOK MEMORY BOUNDARY (LIVE manifest enforcement). The seam Fable kept flagging: a B2.2 delegation manifest
 * is the AUTHORITY that justifies a one-shot kernel grant, which flows through the UNCHANGED grant→intent→token→receipt
 * pipeline to a memory effect + a receipt that binds the manifest. This replaces the harness-flag simulation in
 * memory.ts (runMemory — the superseded KIRA-rehearsal demo, kept only for the slice/http/harvester demo wiring, NOT
 * an authority path, exactly as the B0 aukora_delegations lane is frozen demo).
 *
 * SEAM (ATOMIC — one Convex mutation = one serializable transaction): consumeManifestUseCore (resolve authority +
 * subject PoP + circuit breakers + OCC usedCount++) → mint a one-shot aukora_grants row FROM the resolved manifest →
 * submitIntentCore (finds the grant, mints the decision token) → verifyAndConsumeDecisionToken → writeReceiptRow on
 * the `mem:{owner}:{key}` effect chain (intent-gated, binds {manifestId,rootId,subjectId,fingerprint,useSeq,memoryHash})
 * → insert the aukora_memory row. A use is spent IFF the whole mutation commits; two concurrent same-useSeq writes
 * conflict on the manifest row → exactly one commits, the other refuses (aumlok_mft_useseq_mismatch). No double-spend.
 * No signed-but-unenforced field — the resolver already enforced node/status/time/root/permission/codec, the consume
 * enforced subjectId/PoP/freshness/useSeq/maxUses/maxPerWindow, and the boundary pins action/ring/resource-scope here.
 *
 * CLAIM DISCIPLINE: PROVEN-LAB. NOT production identity, NOT full privacy, NOT recovery, NOT lifecycle-sovereignty,
 * NOT Vymakira-as-security. The kernel intent/token/receipt pipeline is reused UNCHANGED.
 */
import { internalMutation, internalQuery, internalAction } from "./_generated/server"; // S1a: internal-only (B1); R5c adds ONE action (vectorSearch is action-only in Convex)
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server"; // M2: shared integrity helper types
import { v } from "convex/values";
import { consumeManifestUseCore, resolveManifestAuthority } from "./aumlokManifests";
import { submitIntentCore } from "./aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "./aukoraToken";
import { writeReceiptRow, IDENTITY_NAME_RE } from "./aukoraReceipts";
import { sha256Hex, stableStringify } from "./aukoraCore";
import { verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";

// S1a: demo lane removed — donor defaulted to "aukora-node-a-demo" when AUMA_NODE_ID was unset; the local
// organism FAILS CLOSED instead (an unset node id must never silently bind or mint against a demo node).
const THIS_NODE_ID = (): string => {
  const n = process.env.AUMA_NODE_ID?.trim();
  if (!n) throw new Error("aukora_node_id_unset");
  return n;
};
const RECALL_FRESHNESS_MS = 60_000;
// Memory key: the frozen identity-name grammar (no colon) so `mem:{owner}:{key}` stays an unambiguous chainKey.
const asMemKey = (x: unknown): string => { if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error("aumlok_mem_key_invalid"); return x; };
const asMemName = (x: unknown): string => { if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error("aumlok_mem_name_invalid"); return x; };

// The reader's proof-of-possession head for a recall (READ), signed under the DEDICATED `aumlokMemRecall` domain
// (`aukora-aumlok-memrecall-v1`, B3.1 P3 — both owner-root and subject recall sign under it). Its distinct domain +
// chainKey (`aumlok:memrecall:`) chain_id-separate it from rotation / genesis / manifest-PoP / consume, so a recall
// sig can never be replayed as any of those, and vice versa.
const RECALL_FIELDS = ["v", "ownerRootId", "key", "readerPrincipalId", "timestamp"] as const;
const pick = (o: any, f: readonly string[]) => { const r: any = {}; for (const k of f) r[k] = o?.[k]; return r; };
export function serializeRecallV1(r: any): string { return "aukora-aumlok-memrecall-v1|" + stableStringify(pick(r, RECALL_FIELDS)); }
export async function recallHead(r: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:memrecall:${r.ownerRootId}:${r.key}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeRecallV1(r)) }; }

// M2b (owner-ratified, GH #103): the erase head — signed under the DEDICATED `aumlokMemErase` domain
// (`aukora-aumlok-memerase-v1`), chainKey-separated (`aumlok:memerase:`) from recall/rotation/genesis/
// consume, so an erase PoP can never be replayed as any of those and — critically — a captured RECALL
// PoP can never authorize an ERASE. The eraseReason is INSIDE the signed preimage: the receipt's reason
// is owner-attested words, not a value anyone downstream could substitute.
const ERASE_FRESHNESS_MS = 60_000;
const ERASE_FIELDS = ["v", "ownerRootId", "key", "eraseReason", "timestamp"] as const;
export function serializeEraseV1(r: any): string { return "aukora-aumlok-memerase-v1|" + stableStringify(pick(r, ERASE_FIELDS)); }
export async function eraseHead(r: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:memerase:${r.ownerRootId}:${r.key}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeEraseV1(r)) }; }

// R5b CANDIDATE (2026-07-07): the search head — signed under the DEDICATED `aumlokMemSearch` domain
// (`aukora-aumlok-memsearch-v1`), chainKey-separated (`aumlok:memsearch:`) from recall/erase/consume,
// so a captured search PoP can never be replayed as a recall (content read) or an erase, and vice
// versa. The QUERY TEXT is inside the signed preimage — the kernel answers the question the owner
// actually signed, never a substituted one.
const SEARCH_FRESHNESS_MS = 60_000;
const SEARCH_FIELDS = ["v", "ownerRootId", "query", "readerPrincipalId", "timestamp"] as const;
export function serializeSearchV1(r: any): string { return "aukora-aumlok-memsearch-v1|" + stableStringify(pick(r, SEARCH_FIELDS)); }
export async function searchHead(r: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:memsearch:${r.ownerRootId}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeSearchV1(r)) }; }

// Recent-owner peek: the dedicated head for a bounded newest-first key listing, signed under its OWN
// `aumlokMemRecent` domain. This is the observability road for the seat's bounded `memory_peek` tool:
// owner-root only, KEYS + createdAt only, no content bytes. Content still travels only through the
// integrity-checked point-read road (`aumlokMemoryRecall`), so the "show me the last N rows" surface
// gains visibility without inventing a second content-serving seam.
const RECENT_FRESHNESS_MS = 60_000;
const RECENT_FIELDS = ["v", "ownerRootId", "readerPrincipalId", "timestamp", "limit"] as const;
export function serializeRecentV1(r: any): string { return "aukora-aumlok-memrecent-v1|" + stableStringify(pick(r, RECENT_FIELDS)); }
export async function recentHead(r: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:memrecent:${r.ownerRootId}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeRecentV1(r)) }; }

/** WRITE a memory value UNDER a delegation manifest — the manifest (root→subject) is the ONLY authority. */
export const aumlokMemoryWrite = internalMutation({ // S1a: internal-only (B1) — the governed chokepoint (W3) reaches this via admin-authenticated `convex run` only
  args: { req: v.any(), subjectSig: v.string(), value: v.string(), embedding: v.optional(v.array(v.float64())) },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    // The boundary fixes the effect shape: a manifest may only authorize memory.write on the local-write ring here.
    if (r.action !== "memory.write") throw new Error("aumlok_mem_action_invalid");
    // R5c: validate an optional embedding FIRST — a malformed vector is refused before any
    // manifest use, token, or receipt work is spent (the whole mutation is transactional anyway;
    // this just makes the refusal cheap and the ordering obvious).
    if (a.embedding !== undefined) assertValidEmbedding(a.embedding);
    if (r.ring !== "local-write") throw new Error("aumlok_mem_ring_invalid");
    const key = asMemKey(r.key);
    if (typeof a.value !== "string") throw new Error("aumlok_mem_value_invalid");

    // 1) resolve + consume the manifest use (authority + circuit breaker + OCC usedCount++) — atomic in this mutation.
    //    B3.5b: `issuer` is the AUDIT-ONLY tag (local | foreign) — it is RECORDED on the grant + receipt, never branched on.
    const { manifest: m, useSeq, issuer } = await consumeManifestUseCore(ctx, r, a.subjectSig);
    const owner = m.rootId, writer = m.subjectId;
    const issuerKind = issuer?.kind ?? "local";
    const issuerSrc = issuer?.kind === "foreign" ? issuer.sourceNodeId : undefined;
    // 2) scope binding: a manifest only writes its OWN root's memory namespace (owner is the manifest's rootId — for a
    //    cross-grant, the FOREIGN root's namespace `mem:{foreignRootId}` on THIS node; no new effect type, Db6).
    if (r.resource !== `mem:${owner}`) throw new Error("aumlok_mem_resource_scope");

    const node = THIS_NODE_ID(), now = Date.now(), ck = `mem:${owner}:${key}`;
    // 3) mint a ONE-SHOT kernel grant FROM the resolved manifest, then the UNCHANGED intent→token gate authorizes it.
    await ctx.db.insert("aukora_grants", { grantKey: `pg_mem_${m.manifestId}_${useSeq}`, status: "active", actorId: writer, actorRole: "operator", ring: "local-write", action: "memory.write", resource: `mem:${owner}`, issuedBy: owner, issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now, issuer: issuerKind, issuerSourceNodeId: issuerSrc });
    const s = await submitIntentCore(ctx, { actorId: writer, actorRole: "operator", ring: "local-write", claim: "moga", action: "memory.write", resource: `mem:${owner}`, requiresAuthorization: true, stateKey: ck });
    if (!s.decisionToken) throw new Error("aumlok_mem_no_authority");
    const consumed = await verifyAndConsumeDecisionToken(ctx, { token: s.decisionToken, action: "memory.write", resource: `mem:${owner}`, ring: "local-write", expectedActorId: writer });

    // 4) the EFFECT receipt (intent-gated writeReceiptRow on the mem: effect chain) binds the manifest authority used.
    const memoryHash = await sha256Hex(`${owner}:${key}:${a.value}`);
    await writeReceiptRow(ctx, { chainKey: ck, decisionLogId: consumed.logId, goal: "memory.write", actorModel: writer, lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson: JSON.stringify({ memory: true, manifestId: m.manifestId, rootId: owner, subjectId: writer, subjectFingerprint: m.subjectFingerprint, useSeq, memoryHash, nodeId: node, issuer: issuerKind, ...(issuer?.kind === "foreign" ? { issuerSourceNodeId: issuer.sourceNodeId, issuerRootId: issuer.rootId, issuerRootKeyId: issuer.rootKeyId } : {}) }) });
    const rcpt = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", ck)).order("desc").first();
    // 5) the effect: the memory row, coupled to the receipt + tagged with the authorizing manifest.
    // R5c: the OPTIONAL embedding (validated at the top) is DERIVED, REBUILDABLE index data —
    // deliberately OUTSIDE the integrity chain (memoryHash binds owner:key:value only, the
    // ONE_BRAIN Brick-2 law: embeddings never enter the chain).
    await ctx.db.insert("aukora_memory", { ownerRootId: owner, writerPrincipalId: writer, readerScope: "owner+writer", delegationId: m.manifestId, receiptHash: rcpt!.chainHash ?? "", memoryHash, sourceNodeId: node, visibility: "private", key, value: a.value, ...(a.embedding !== undefined ? { embedding: a.embedding } : {}) });
    return { ok: true, manifestId: m.manifestId, ownerRootId: owner, writerPrincipalId: writer, key, useSeq, memoryHash, receiptHash: rcpt!.chainHash };
  },
});

/** RECALL (read; NO use consumed — reads do not burn the maxUses budget). AUTHENTICATED: the reader must PROVE
 *  possession of the key it claims (not merely assert a principal string), mirroring the write's subject PoP — so
 *  "cross-principal refused" is a real defense, not shape. The OWNER root reads by signing with its ACTIVE root key,
 *  the delegated SUBJECT reads by signing with the manifest's subject key — BOTH under the dedicated `aumlokMemRecall`
 *  domain (B3.1 P3) — and the subject reads only while the authorizing manifest is STILL valid (revocation / expiry /
 *  root-revoke severs the read). Any other principal, or a valid-looking claim with the wrong key, is refused. */
export const aumlokMemoryRecall = internalQuery({ // S1a: internal-only (B1)
  args: { req: v.any(), readerSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), key = asMemKey(r.key), reader = asMemName(r.readerPrincipalId);
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (typeof a.readerSig !== "string" || !a.readerSig) throw new Error("aumlok_mem_signature_missing");
    const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q) => q.eq("ownerRootId", ownerRootId).eq("key", key)).first();
    if (!row || row.deletedAt) return { ok: false, reason: "not_found" };
    if (Math.abs(Date.now() - Number(r.timestamp)) > RECALL_FRESHNESS_MS) return { ok: false, reason: "stale" };
    // M2: content-integrity preflight — a row that fails its own binding is NEVER served, and the failure
    // REFUSES (ok:false) instead of throwing, so one tampered row can't take the read path down
    // (quarantine-not-brick, ported from ONE_BRAIN Brick 0d). Checked before PoP so tampered bytes
    // never even reach an authenticated reader.
    if (row.quarantined) return { ok: false, reason: "quarantined" };
    // M2b: an erased row is a COUNTABLE STUB — recall says "erased", boringly (a reason code, never
    // content), and serves nothing. Never "not_found": a forgotten memory is visibly forgotten,
    // never an invisible hole (Auma's condition).
    if (row.erased) return { ok: false, reason: "erased" };
    const integ = await verifyMemoryRowIntegrityCore(ctx, row);
    if (!integ.ok) return { ok: false, reason: "integrity_failed", detail: integ.reason };
    const head = await recallHead(r);

    if (reader === ownerRootId) { // owner root — prove possession of the ACTIVE root key
      const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
      if (!rk) return { ok: false, reason: "no_active_root_key" };
      if (await verifyChainHeadV3(rk.publicKey, head, a.readerSig, "aumlokMemRecall")) return { ok: true, value: row.value };
      return { ok: false, reason: "reader_pop_invalid" };
    }
    if (reader === row.writerPrincipalId) { // delegated subject — manifest still live AND prove possession of the subject key
      const res = await resolveManifestAuthority(ctx, { manifestId: row.delegationId, ring: "local-write", action: "memory.write", resource: `mem:${ownerRootId}`, intentCodec: "json_action_v1" });
      if (!res.ok || !res.manifest) return { ok: false, reason: "cross_principal_refused", detail: res.reason }; // revoked/expired/root-revoked → severed
      if (await verifyChainHeadV3(res.manifest.subjectPubKey, head, a.readerSig, "aumlokMemRecall")) return { ok: true, value: row.value };
      return { ok: false, reason: "reader_pop_invalid" };
    }
    return { ok: false, reason: "cross_principal_refused" }; // any unrelated principal / the node itself
  },
});

/** R5b CANDIDATE — SEARCH (read; ranked KEYS ONLY, never content). The benchmark's contender:
 *  full-text relevance over the owner's own rows via the `search_value` index.
 *
 *  Deliberate narrownesses (each one load-bearing):
 *    - OWNER ROOT ONLY this brick: the reader must prove possession of the ACTIVE root key under
 *      the dedicated `aumlokMemSearch` domain. No subject path — a delegated writer searching the
 *      owner's whole namespace is a scope widening that would need its own ratified brick.
 *    - KEYS ONLY in results: content stays behind aumlokMemoryRecall, whose per-row integrity
 *      preflight (M2) and erasure/quarantine law remain the ONLY road to stored bytes. Search can
 *      therefore rank but never leak a tampered row's content.
 *    - erased / quarantined / deleted rows never surface (same visibility law as recall).
 *    - This is NOT the recall cutover: nothing in any lane calls this. It exists so the R5b
 *      benchmark can score a real Convex candidate against kira.recall on the same corpus
 *      (docs/R5_RECALL_STATUS.md); cutover is a separate owner-reviewed brick, only after this
 *      candidate demonstrably wins. */
export const aumlokMemorySearch = internalQuery({ // R5b: internal-only (B1), read-only, keys-only
  args: { req: v.any(), readerSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), reader = asMemName(r.readerPrincipalId);
    if (reader !== ownerRootId) return { ok: false, reason: "cross_principal_refused" }; // owner-root only, by design
    const query = r.query;
    // eslint-disable-next-line no-control-regex
    if (typeof query !== "string" || query.length === 0 || query.length > 500 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new Error("aumlok_mem_search_query_invalid");
    }
    const limit = Number.isSafeInteger(r.limit) && r.limit >= 1 && r.limit <= 20 ? Number(r.limit) : 8;
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (Math.abs(Date.now() - Number(r.timestamp)) > SEARCH_FRESHNESS_MS) return { ok: false, reason: "stale" };
    if (typeof a.readerSig !== "string" || !a.readerSig) throw new Error("aumlok_mem_signature_missing");

    const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
    if (!rk) return { ok: false, reason: "no_active_root_key" };
    if (!(await verifyChainHeadV3(rk.publicKey, await searchHead(r), a.readerSig, "aumlokMemSearch"))) {
      return { ok: false, reason: "reader_pop_invalid" };
    }

    // over-fetch, then apply the visibility law (erased/quarantined/deleted never surface), then cap.
    const raw = await ctx.db
      .query("aukora_memory")
      .withSearchIndex("search_value", (q) => q.search("value", query).eq("ownerRootId", ownerRootId))
      .take(limit * 3);
    const hits = raw
      .filter((row: any) => !row.deletedAt && !row.erased && !row.quarantined)
      .slice(0, limit)
      .map((row: any) => ({ key: row.key }));
    return { ok: true, hits, advisoryOnly: true, grantsAuthority: false };
  },
});

/** Bounded newest-first owner peek (read-only, KEYS + createdAt only). This is not "search", and not
 *  another content road: it exists so the seat can verify recent capture directly instead of guessing
 *  from fuzzy recall symptoms. Owner-root only, dedicated `aumlokMemRecent` PoP, erased/quarantined/
 *  deleted rows never surface, and the result is metadata only — content still stays behind
 *  aumlokMemoryRecall's integrity check. */
export const aumlokMemoryRecent = internalQuery({ // R5d: internal-only (B1), read-only, owner-only metadata
  args: { req: v.any(), readerSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), reader = asMemName(r.readerPrincipalId);
    if (reader !== ownerRootId) return { ok: false, reason: "cross_principal_refused" };
    const limit = Number.isSafeInteger(r.limit) && r.limit >= 1 && r.limit <= 8 ? Number(r.limit) : 5;
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (Math.abs(Date.now() - Number(r.timestamp)) > RECENT_FRESHNESS_MS) return { ok: false, reason: "stale" };
    if (typeof a.readerSig !== "string" || !a.readerSig) throw new Error("aumlok_mem_signature_missing");

    const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
    if (!rk) return { ok: false, reason: "no_active_root_key" };
    if (!(await verifyChainHeadV3(rk.publicKey, await recentHead(r), a.readerSig, "aumlokMemRecent"))) {
      return { ok: false, reason: "reader_pop_invalid" };
    }

    const raw = await ctx.db
      .query("aukora_memory")
      .withIndex("by_owner", (q) => q.eq("ownerRootId", ownerRootId))
      .order("desc")
      .take(limit * 3);
    const hits = raw
      .filter((row: any) => !row.deletedAt && !row.erased && !row.quarantined)
      .slice(0, limit)
      .map((row: any) => ({ key: row.key, createdAt: Number(row._creationTime) || 0 }));
    return { ok: true, hits, advisoryOnly: true, grantsAuthority: false };
  },
});

// ── M2 (2026-07-05) — content binding: the store must not be able to silently lie ─────────────────
// ONE_BRAIN Brick 0b/0d ported to the Convex kernel (plan of record, Brick M2). The write path COMPUTES
// memoryHash and the receipt binds it — but until M2 nothing ever RE-CHECKED a stored row, so a direct
// DB edit (sqlite in hand, or a buggy migration) served tampered bytes under a green-looking ledger.
// M2 closes that: every serve and every verify re-derives the binding. Erasure (Brick 0a) shipped as
// M2b below AFTER owner ratification of the `aumlokMemErase` domain (GH #103, chat approval 2026-07-05).

// How many receipts of one mem:{owner}:{key} chain the integrity check will scan for the binding
// receipt. Lab-scale honest bound (a key is written once or a handful of times); a miss within the
// bound reads as "not on chain", which is the fail-closed direction.
const INTEGRITY_RECEIPT_SCAN_LIMIT = 2_000;

/** M2: one row's content binding, re-derived from what the row ACTUALLY holds. Three checks, all
 *  fail-closed: (1) sha256(owner:key:value) must equal row.memoryHash; (2) row.receiptHash must exist
 *  on the row's own mem: chain; (3) that receipt's proofJson.memoryHash must equal row.memoryHash — so
 *  an attacker who edits value AND recomputes row.memoryHash consistently is still caught (the receipt
 *  chain is hash-linked under a signed head; rewriting it is a different, detectable crime). */
export async function verifyMemoryRowIntegrityCore(ctx: QueryCtx | MutationCtx, row: any): Promise<{ ok: boolean; reason?: string }> {
  if (row.erased) {
    // M2b — a stub's integrity is DIFFERENT: no content to bind (that's the point), but the erasure
    // itself must be complete AND proven. kiraBrain Brick 0a parity: a scrub without a receipt is
    // tampering, not forgetting; a stub that grew its content back is tampering wearing a tombstone.
    if (row.value !== "") return { ok: false, reason: "erased_row_still_carries_content" };
    if (typeof row.receiptHash !== "string" || !row.receiptHash) return { ok: false, reason: "receipt_missing" };
    if (typeof row.erasureReceiptHash !== "string" || !row.erasureReceiptHash) return { ok: false, reason: "erasure_receipt_missing" };
    const eck = `mem:${row.ownerRootId}:${row.key}`;
    const ercpts = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", eck)).order("desc").take(INTEGRITY_RECEIPT_SCAN_LIMIT);
    const original = ercpts.find((rc: any) => rc.chainHash === row.receiptHash);
    if (!original) return { ok: false, reason: "receipt_not_on_chain" };
    let originalProof: any = null;
    try { originalProof = JSON.parse(original.proofJson ?? "null"); } catch { /* malformed falls through */ }
    if (!originalProof || originalProof.memoryHash !== row.memoryHash) return { ok: false, reason: "receipt_binds_different_content" };
    const ercpt = ercpts.find((rc: any) => rc.chainHash === row.erasureReceiptHash);
    if (!ercpt) return { ok: false, reason: "erasure_receipt_not_on_chain" };
    let eproof: any = null;
    try { eproof = JSON.parse(ercpt.proofJson ?? "null"); } catch { /* malformed falls through */ }
    if (!eproof || eproof.erasure !== true || eproof.rootId !== row.ownerRootId || eproof.erasedAtomKey !== row.key || eproof.eraseReason !== row.eraseReason || eproof.originalMemoryHash !== row.memoryHash || eproof.originalReceiptHash !== row.receiptHash) {
      return { ok: false, reason: "erasure_receipt_binds_different_erasure" };
    }
    return { ok: true };
  }
  const expected = await sha256Hex(`${row.ownerRootId}:${row.key}:${row.value}`);
  if (row.memoryHash !== expected) return { ok: false, reason: "content_hash_mismatch" };
  if (typeof row.receiptHash !== "string" || !row.receiptHash) return { ok: false, reason: "receipt_missing" };
  const ck = `mem:${row.ownerRootId}:${row.key}`;
  const rcpts = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", ck)).order("desc").take(INTEGRITY_RECEIPT_SCAN_LIMIT);
  const rcpt = rcpts.find((rc: any) => rc.chainHash === row.receiptHash);
  if (!rcpt) return { ok: false, reason: "receipt_not_on_chain" };
  let proof: any = null;
  try { proof = JSON.parse(rcpt.proofJson ?? "null"); } catch { /* malformed proof falls through to the mismatch below */ }
  if (!proof || proof.memoryHash !== row.memoryHash) return { ok: false, reason: "receipt_binds_different_content" };
  return { ok: true };
}

/** M2: verify the WHOLE memory store's content binding — the silent-edit probe's target. Read-only,
 *  no authority, refuses nothing: it REPORTS. `ok` means every live, un-quarantined row re-derives
 *  cleanly; contained rows are counted, never hidden (a green verify with jailed rows must SAY so —
 *  same visibility law as the JSON brain's Brick 0). */
export const aumlokMemoryVerify = internalQuery({ // M2: internal-only (B1), read-only
  args: { ownerRootId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<any> => {
    const rows = a.ownerRootId
      ? await ctx.db.query("aukora_memory").withIndex("by_owner", (q) => q.eq("ownerRootId", asMemName(a.ownerRootId))).collect()
      : await ctx.db.query("aukora_memory").collect();
    const flagged: Array<{ ownerRootId: string; key: string; reason: string }> = [];
    let quarantinedCount = 0, deletedCount = 0, erasedCount = 0, checked = 0;
    for (const row of rows) {
      if (row.deletedAt) { deletedCount++; continue; }
      if (row.quarantined) { quarantinedCount++; continue; } // contained — counted, content checks suspended
      if (row.erased) erasedCount++; // M2b: stubs are counted AND still checked (scrub completeness + erasure proof)
      checked++;
      const res = await verifyMemoryRowIntegrityCore(ctx, row);
      if (!res.ok) flagged.push({ ownerRootId: row.ownerRootId, key: row.key, reason: res.reason ?? "unknown" });
    }
    return { ok: flagged.length === 0, checked, flagged, quarantinedCount, deletedCount, erasedCount };
  },
});

/** M2: persist a quarantine mark — EVIDENCE-GATED containment, not an authority. The mutation re-derives
 *  the row's integrity itself and REFUSES to jail a healthy row, so it cannot be abused to silence good
 *  memories; there is nothing to sign because the tampered bytes ARE the authorization. Idempotent on an
 *  already-jailed row. Un-quarantining has no path here at all — that is owner surgery for a later,
 *  ratified brick, not a callable function. */
export const aumlokMemoryQuarantine = internalMutation({ // M2: internal-only (B1)
  args: { ownerRootId: v.string(), key: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const ownerRootId = asMemName(a.ownerRootId), key = asMemKey(a.key);
    const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q) => q.eq("ownerRootId", ownerRootId).eq("key", key)).first();
    if (!row || row.deletedAt) throw new Error("aumlok_mem_quarantine_not_found");
    if (row.quarantined) return { ok: true, key, alreadyQuarantined: true };
    const integ = await verifyMemoryRowIntegrityCore(ctx, row);
    if (integ.ok) throw new Error("aumlok_mem_quarantine_refused_healthy"); // evidence gates containment
    await ctx.db.patch(row._id, { quarantined: true, quarantinedAt: Date.now(), quarantineReason: (integ.reason ?? "integrity_failed").slice(0, 200) });
    return { ok: true, key, reason: integ.reason };
  },
});

/** M2b (owner-ratified, GH #103 — chat approval 2026-07-05): the typed owner ERASE. The one function
 *  that can make the store forget, and it answers to exactly one key.
 *
 *  AUTHORITY: the OWNER'S ACTIVE ROOT KEY, signing under the dedicated `aumlokMemErase` domain —
 *  full stop. There is NO subject path (Auma's ruling: a delegated writer must never be able to
 *  un-say the owner's record), no manifest path, no node path. Internal-only on top (B1): reaching
 *  this at all already requires admin custody.
 *
 *  EFFECT (countable stub, never an invisible hole — Auma's condition):
 *    - `value` is scrubbed to "". The row REMAINS: id/key/owner/receipt linkage intact, erased:true,
 *      counted by verify (erasedCount) and answered by recall as reason:"erased" — never "not_found".
 *    - `memoryHash`/`receiptHash` KEEP the original binding. HONEST LIMIT (disclosed, same as the
 *      JSON brain): those unsalted commitments — and the immutable original write receipt — survive,
 *      so an actor who can GUESS the plaintext can confirm it. Salted-commitment erasure is future
 *      work; do not claim more than "the content bytes are gone from the serving row".
 *    - an ERASURE RECEIPT lands on the SAME `mem:{owner}:{key}` chain through the UNCHANGED
 *      grant→intent→token pipeline (action `memory.erase`), binding the key, the owner's signed
 *      reason, and the original content hash. `erasureReceiptHash` on the stub points at it; the
 *      integrity core verifies the whole loop (scrub completeness + proof) from then on.
 *    - physical storage honesty: Convex retains prior document versions for its retention window and
 *      SQLite pages persist until vacuum — "erased" means scrubbed from every serving path NOW,
 *      physically gone after retention + vacuum (plan's three retention clauses, M2b STATUS block). */
export const aumlokMemoryErase = internalMutation({ // M2b: internal-only (B1)
  args: { req: v.any(), ownerSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), key = asMemKey(r.key);
    // The reason is INSIDE the signed preimage — validate strictly, NEVER coerce (a kernel that
    // rewrites the reason after signature verification would be attesting words the owner never signed).
    const reason = r.eraseReason;
    // eslint-disable-next-line no-control-regex
    if (typeof reason !== "string" || reason.length === 0 || reason.length > 200 || /[\u0000-\u001f\u007f]/.test(reason)) {
      throw new Error("aumlok_mem_erase_reason_invalid");
    }
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (Math.abs(Date.now() - Number(r.timestamp)) > ERASE_FRESHNESS_MS) throw new Error("aumlok_mem_erase_stale");
    if (typeof a.ownerSig !== "string" || !a.ownerSig) throw new Error("aumlok_mem_signature_missing");

    const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
    if (!rk) throw new Error("aumlok_mem_erase_no_active_root_key");
    if (!(await verifyChainHeadV3(rk.publicKey, await eraseHead(r), a.ownerSig, "aumlokMemErase"))) {
      throw new Error("aumlok_mem_erase_pop_invalid"); // wrong key, wrong domain, or altered fields — one boring refusal
    }

    const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q) => q.eq("ownerRootId", ownerRootId).eq("key", key)).first();
    if (!row || row.deletedAt) throw new Error("aumlok_mem_erase_not_found");
    if (row.erased) throw new Error("aumlok_mem_erase_already_erased");
    const integ = await verifyMemoryRowIntegrityCore(ctx, row);
    if (!integ.ok) throw new Error("aumlok_mem_erase_integrity_failed");

    const node = THIS_NODE_ID(), now = Date.now(), ck = `mem:${ownerRootId}:${key}`;
    // one-shot owner grant → the UNCHANGED intent→token gate → the erasure receipt (write-path parity).
    await ctx.db.insert("aukora_grants", { grantKey: `pg_memerase_${ownerRootId}_${key}_${now}`, status: "active", actorId: ownerRootId, actorRole: "operator", ring: "local-write", action: "memory.erase", resource: `mem:${ownerRootId}`, issuedBy: ownerRootId, issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now, issuer: "local" });
    const s = await submitIntentCore(ctx, { actorId: ownerRootId, actorRole: "operator", ring: "local-write", claim: "moga", action: "memory.erase", resource: `mem:${ownerRootId}`, requiresAuthorization: true, stateKey: ck });
    if (!s.decisionToken) throw new Error("aumlok_mem_erase_no_authority");
    const consumed = await verifyAndConsumeDecisionToken(ctx, { token: s.decisionToken, action: "memory.erase", resource: `mem:${ownerRootId}`, ring: "local-write", expectedActorId: ownerRootId });
    await writeReceiptRow(ctx, { chainKey: ck, decisionLogId: consumed.logId, goal: "memory.erase", actorModel: ownerRootId, lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson: JSON.stringify({ erasure: true, erasedAtomKey: key, rootId: ownerRootId, eraseReason: reason, erasedAt: now, originalMemoryHash: row.memoryHash, originalReceiptHash: row.receiptHash, nodeId: node }) });
    const rcpt = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", ck)).order("desc").first();

    await ctx.db.patch(row._id, { value: "", erased: true, erasedAt: now, eraseReason: reason, erasureReceiptHash: rcpt!.chainHash ?? "" });
    return { ok: true, ownerRootId, key, erasedAt: now, erasureReceiptHash: rcpt!.chainHash };
  },
});

// ── R5c CONTENDER — the VECTOR road (Great Merge round 3, #178). Benchmark-first, like R5b: ──────
// nothing in any lane calls any of this. It exists so the committed harness can score a SEMANTIC
// candidate against the full-text incumbent on the same corpus; any ranking change remains a
// separate owner-reviewed brick that lands only on a winning report (the law that shipped the
// cutover). Embeddings are DERIVED, REBUILDABLE index data and live OUTSIDE the integrity chain
// (memoryHash binds owner:key:value only — ONE_BRAIN Brick-2 law); erasure law still rules: an
// erased/quarantined/deleted row never surfaces from ANY road, vector included.

export const EMBEDDING_DIMS = 384; // all-MiniLM-L6-v2, the vendored LOCAL embedder (zero egress)
const VEC_SEARCH_FRESHNESS_MS = 60_000;

/** Hard validation for any embedding that enters the store: exact dims, every element a finite
 *  number. Refuses loudly — a malformed vector never lands next to governed rows. */
export function assertValidEmbedding(e: unknown): asserts e is number[] {
  if (!Array.isArray(e) || e.length !== EMBEDDING_DIMS) throw new Error("aumlok_mem_embedding_invalid");
  for (const x of e) if (typeof x !== "number" || !Number.isFinite(x)) throw new Error("aumlok_mem_embedding_invalid");
}

/** Canonical serialization for vector hashing — BOTH sides (client signer + kernel verifier) hash
 *  exactly this string, so a signed question cannot have its vector substituted. */
export async function vectorHashHex(vec: number[]): Promise<string> {
  return sha256Hex(`aukora-vec-v1:${JSON.stringify(vec)}`);
}

const VEC_SEARCH_FIELDS = ["v", "ownerRootId", "queryVectorHash", "readerPrincipalId", "timestamp", "limit"] as const;
function serializeVecSearchV1(r: any): string {
  return stableStringify(Object.fromEntries(VEC_SEARCH_FIELDS.map((f) => [f, r?.[f]])));
}
export async function vecSearchHead(r: any): Promise<ChainHeadFields> {
  return { chainKey: `aumlok:memvecsearch:${r.ownerRootId}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeVecSearchV1(r)) };
}

const EMBED_FIELDS = ["v", "ownerRootId", "key", "embeddingHash", "timestamp"] as const;
function serializeEmbedV1(r: any): string {
  return stableStringify(Object.fromEntries(EMBED_FIELDS.map((f) => [f, r?.[f]])));
}
export async function embedHead(r: any): Promise<ChainHeadFields> {
  return { chainKey: `aumlok:memembed:${r.ownerRootId}:${r.key}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeEmbedV1(r)) };
}

/** Auth gate for the vector action (actions have no db): verifies owner-root PoP under the
 *  DEDICATED aumlokMemVecSearch domain over the vec-search head, plus freshness and the vector
 *  hash binding. Returns a typed verdict; the action refuses on anything but ok. */
export const aumlokMemoryVectorSearchAuth = internalQuery({
  args: { req: v.any(), readerSig: v.string(), queryVectorHash: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), reader = asMemName(r.readerPrincipalId);
    if (reader !== ownerRootId) return { ok: false, reason: "cross_principal_refused" }; // owner-root only, R5b parity
    if (typeof r.queryVectorHash !== "string" || r.queryVectorHash !== a.queryVectorHash) return { ok: false, reason: "vector_hash_mismatch" };
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (Math.abs(Date.now() - Number(r.timestamp)) > VEC_SEARCH_FRESHNESS_MS) return { ok: false, reason: "stale" };
    if (typeof a.readerSig !== "string" || !a.readerSig) throw new Error("aumlok_mem_signature_missing");
    const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
    if (!rk) return { ok: false, reason: "no_active_root_key" };
    if (!(await verifyChainHeadV3(rk.publicKey, await vecSearchHead(r), a.readerSig, "aumlokMemVecSearch"))) {
      return { ok: false, reason: "reader_pop_invalid" };
    }
    return { ok: true };
  },
});

/** Visibility filter for the action's raw index results: keys of rows that are the owner's and
 *  visible (erased/quarantined/deleted never surface — same law as recall and search), input
 *  order preserved (the index's relevance order IS the ranking). KEYS ONLY, R5b parity. */
export const aumlokMemoryKeysForRows = internalQuery({
  args: { ids: v.array(v.id("aukora_memory")), ownerRootId: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const owner = asMemName(a.ownerRootId);
    const keys: string[] = [];
    for (const id of a.ids.slice(0, 60)) {
      const row: any = await ctx.db.get(id);
      if (!row || row.ownerRootId !== owner) continue;
      if (row.deletedAt || row.erased || row.quarantined) continue;
      keys.push(row.key);
    }
    return { ok: true, keys, advisoryOnly: true, grantsAuthority: false };
  },
});

/** R5c CANDIDATE — VECTOR SEARCH (action: Convex vectorSearch is action-only). Owner-root PoP
 *  under aumlokMemVecSearch with the query-vector hash INSIDE the signed preimage; ranked KEYS
 *  ONLY; content stays behind aumlokMemoryRecall's integrity road. Nothing in any lane calls
 *  this — benchmark-first, exactly like aumlokMemorySearch was. */
export const aumlokMemoryVectorSearch = internalAction({
  args: { req: v.any(), readerSig: v.string(), queryVector: v.array(v.float64()) },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    assertValidEmbedding(a.queryVector);
    const queryVectorHash = await vectorHashHex(a.queryVector);
    const auth = await ctx.runQuery(internal.aumlokMemory.aumlokMemoryVectorSearchAuth, { req: r, readerSig: a.readerSig, queryVectorHash });
    if (!auth?.ok) return { ok: false, reason: auth?.reason ?? "auth_failed", advisoryOnly: true, grantsAuthority: false };
    const limit = Number.isSafeInteger(r.limit) && r.limit >= 1 && r.limit <= 20 ? Number(r.limit) : 8;
    // over-fetch, then the visibility law trims (erased rows keep their vectors OUT of results even
    // if a stale index entry survives — the keys filter is the wall, not the index).
    const results = await ctx.vectorSearch("aukora_memory", "by_owner_embedding", {
      vector: a.queryVector,
      limit: Math.min(60, limit * 3),
      filter: (q) => q.eq("ownerRootId", asMemName(r.ownerRootId)),
    });
    const filtered = await ctx.runQuery(internal.aumlokMemory.aumlokMemoryKeysForRows, { ids: results.map((x) => x._id), ownerRootId: asMemName(r.ownerRootId) });
    const keys: string[] = (filtered?.keys ?? []).slice(0, limit);
    return { ok: true, hits: keys.map((key) => ({ key })), advisoryOnly: true, grantsAuthority: false };
  },
});

/** R5c — EMBEDDING BACKFILL for rows written before embeddings existed. Owner-root PoP under the
 *  DEDICATED aumlokMemEmbed domain (embedding hash inside the signed preimage). ABSENT-ONLY and
 *  idempotent: an identical re-send is ok:already; a DIFFERENT embedding for a row that has one is
 *  refused (rebuild = erase-and-recapture territory, never silent replacement). Touches ONLY the
 *  embedding field — value, memoryHash, receipts, and the erasure law are out of reach. */
export const aumlokMemoryEmbedBackfill = internalMutation({
  args: { req: v.any(), ownerSig: v.string(), embedding: v.array(v.float64()) },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), key = asMemKey(r.key);
    assertValidEmbedding(a.embedding);
    const embeddingHash = await vectorHashHex(a.embedding);
    if (typeof r.embeddingHash !== "string" || r.embeddingHash !== embeddingHash) return { ok: false, reason: "embedding_hash_mismatch" };
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (Math.abs(Date.now() - Number(r.timestamp)) > VEC_SEARCH_FRESHNESS_MS) return { ok: false, reason: "stale" };
    if (typeof a.ownerSig !== "string" || !a.ownerSig) throw new Error("aumlok_mem_signature_missing");
    const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
    if (!rk) return { ok: false, reason: "no_active_root_key" };
    if (!(await verifyChainHeadV3(rk.publicKey, await embedHead(r), a.ownerSig, "aumlokMemEmbed"))) {
      return { ok: false, reason: "owner_pop_invalid" };
    }
    const row: any = await ctx.db
      .query("aukora_memory")
      .withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", ownerRootId).eq("key", key))
      .unique();
    if (!row || row.deletedAt) return { ok: false, reason: "not_found" };
    if (row.quarantined) return { ok: false, reason: "quarantined" };
    if (row.erased) return { ok: false, reason: "erased" }; // a forgotten memory grows no new index
    if (Array.isArray(row.embedding)) {
      const existingHash = await vectorHashHex(row.embedding as number[]);
      return existingHash === embeddingHash ? { ok: true, already: true, key } : { ok: false, reason: "embedding_present" };
    }
    await ctx.db.patch(row._id, { embedding: a.embedding });
    return { ok: true, already: false, key, advisoryOnly: true, grantsAuthority: false };
  },
});
