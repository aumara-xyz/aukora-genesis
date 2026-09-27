// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * Aukora receipts (Wave 3.7). A receipt is the ONLY proof an action was
 * kept. Hash-chained PER chainKey with the canonical SHA-256 recompute
 * (not just links) so a tampered payload is detectable.
 *
 * Wave 3.7 (Gemini HIGH): receipts chain per `chainKey`, not through one
 * global row — concurrent actors on different chains no longer serialize.
 * Each chain has its own tamper-evident head pointer (truncation
 * detection) and its own paginated full-chain verifier.
 *
 * NOT burn-ready. In-organism ledger for the first protected actions.
 */

import { internalQuery, internalMutation } from "./_generated/server"; // S1a: internal-only (B1) — unused public `mutation` import dropped
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildReceiptChainHash, verifyReceiptChainRows } from "./aukoraCore";
import { resolveFounderUserId } from "./sessionResolver";
import {
  resolveChainSigningSeed, signChainHeadV4, SIGNED_HEAD_V4_ALG,
  resolveChainVerifyingPublicKey, verifyHeadRowSignatureV4, evaluateHighWater,
} from "./aukoraSignedHead";
import { receiptHistoryRootHex } from "./aukoraMerkleLog";

/** Recompute a chain's receipt-history (RFC 6962) root + size from STORED receipts, ordered by the monotonic append
 *  SEQUENCE (seq = head.count at write), NOT by wall-clock ts — so a non-monotonic host clock can never reorder the
 *  committed log (adversarial review B1.5b2: ts is metadata, never the ordering authority). This is the ONE canonical
 *  way the receipt-log root is computed, by both the writer and the audit recompute, so a signed root and a recomputed
 *  root agree. Leaf = the receipt's 32-byte chainHash as a RAW input (receiptHistoryRootHex leaf-hashes it); a missing
 *  chainHash FAILS CLOSED rather than minting a phantom empty leaf. SCALE: a full .collect() — O(n) per call, honest
 *  at lab scale; beyond Convex's per-transaction read limit this is the ceiling, and compact-range incremental
 *  computation is the documented FUTURE work (canon/AUKORA_MERKLE_LOG_DESIGN.md §3.6). */
export async function computeReceiptLogRoot(ctx: QueryCtx | MutationCtx, chainKey: string): Promise<{ root: string; size: number }> {
  const rows = await ctx.db
    .query("auma_receipts")
    .withIndex("by_chainKey_ts", (q) => q.eq("chainKey", chainKey))
    .collect();
  rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)); // monotonic append order, clock-independent
  const leaves = rows.map((r) => {
    if (!r.chainHash) throw new Error(`aukora_receipt_missing_chainhash:${r.receiptId ?? "?"}`); // fail closed, no empty leaf
    return r.chainHash;
  });
  return { root: receiptHistoryRootHex(leaves), size: rows.length };
}

export type ReceiptInput = {
  goal: string;
  actorModel: string;
  lane: "local" | "hosted" | "hybrid";
  risk: "critical" | "high" | "medium" | "low";
  grade: "A" | "B" | "C" | "F";
  verdict: "kept" | "warning" | "failed" | "reverted";
  actionsJson: string;
  proofJson: string;
  threadId?: string;
  notes?: string;
};

/** Canonical hashed payload — used at write AND verify time. Includes
 *  chainKey + threadId + notes so any stored field is tamper-covered.
 *  Exported so integration tests verify tamper-detection against the REAL
 *  payload shape (not a hand-copied one that could silently drift). */
export function receiptPayload(input: {
  chainKey: string;
  receiptId: string;
  ts: number;
  actorModel: string;
  lane: string;
  goal: string;
  risk: string;
  grade: string;
  verdict: string;
  actionsJson: string;
  proofJson: string;
  threadId?: string | null;
  notes?: string | null;
}): Record<string, unknown> {
  return {
    chainKey: input.chainKey,
    receiptId: input.receiptId,
    ts: input.ts,
    actorModel: input.actorModel,
    lane: input.lane,
    goal: input.goal,
    risk: input.risk,
    grade: input.grade,
    verdict: input.verdict,
    actionsJson: input.actionsJson,
    proofJson: input.proofJson,
    threadId: input.threadId ?? null,
    notes: input.notes ?? null,
  };
}

/**
 * The SHARED receipt-append + V4-head-mint CORE. Builds the next receipt row on `chainKey` (linking from the
 * authoritative head pointer), then recomputes the RFC 6962 receipt-history root and mints/clears the
 * SignedChainHeadV4. This is the SINGLE place a V4 head is signed, so the writer and the audit recompute can never
 * drift (a second copy of this logic would be exactly the kind of subtle divergence that breaks cross-node
 * verification). MODULE-PRIVATE on purpose: the ONLY callers are `writeReceiptRow` (intent-gated, refuses the
 * reserved chainKeys) and `appendIdentityLifecycleReceipt` (id: only) — so no general mutation can reach this core to
 * write a reserved chain. AUTHORIZATION IS THE CALLER'S JOB; this core does NOT gate.
 */
async function appendReceiptAndSignHead(
  ctx: MutationCtx,
  chainKey: string,
  input: ReceiptInput,
): Promise<string> {
  const receiptId = `rcpt_${crypto.randomUUID()}`;
  const ts = Date.now();

  // The per-chainKey HEAD is the authoritative chain pointer — link the new receipt FROM it (Codex HIGH:
  // deriving prevHash from a timestamp-ordered receipt query can mis-link/fork under same-ms ties). Reading the
  // head first also makes the receipt link and the head count a single, consistent source of truth.
  const head = await ctx.db
    .query("auma_receipt_chain_head")
    .withIndex("by_key", (q) => q.eq("key", chainKey))
    .first();
  const prevHash = head?.lastChainHash ?? null;
  const newCount = (head?.count ?? 0) + 1;

  const payload = receiptPayload({ receiptId, ts, chainKey, ...input });
  const chainHash = await buildReceiptChainHash(payload, prevHash);
  await ctx.db.insert("auma_receipts", {
    receiptId,
    ts,
    actorModel: input.actorModel,
    lane: input.lane,
    goal: input.goal,
    risk: input.risk,
    grade: input.grade,
    verdict: input.verdict,
    actionsJson: input.actionsJson,
    proofJson: input.proofJson,
    chainKey,
    prevHash: prevHash ?? undefined,
    chainHash,
    seq: newCount, // 1-based append position — the Merkle log's clock-independent order key
    threadId: input.threadId,
    notes: input.notes,
  });

  // SIGN THE HEAD (P0b / F-T1 + B1.5b2): ML-DSA-65-sign the new head as SignedChainHeadV4 — binding BOTH the linear
  // chain head AND the RFC 6962 append-only receipt-history root, so any rewrite/fork/truncation/reorder by a
  // compromised kernel is cryptographically detectable. The receipt-log root is RECOMPUTED from stored state (the
  // chain's receipts in append order), NOT taken from any caller — invariant: receiptLogSize === newCount. A
  // configured-but-MALFORMED seed THROWS (no silent downgrade); a truly-unset seed → unsigned (additive). Atomic:
  // the receipt row above and this head update commit in the SAME mutation or roll back together.
  const seed = resolveChainSigningSeed();
  let sig: string | null = null;
  let receiptLogRoot: string | null = null;
  if (seed) {
    const log = await computeReceiptLogRoot(ctx, chainKey); // includes the row just inserted (reads-after-writes)
    if (log.size !== newCount) throw new Error(`aukora_receipt_log_size_mismatch:${log.size}!=${newCount}`); // tree_size invariant
    receiptLogRoot = log.root;
    try {
      sig = await signChainHeadV4(seed, { chainKey, timestamp: ts, chainLength: newCount, chainHeadHash: chainHash }, receiptLogRoot, "chainHead");
    } catch (e) {
      throw new Error(`aukora_chain_head_sign_failed:${chainKey}:${newCount}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const headFields = sig
    ? { lastChainHash: chainHash, count: newCount, updatedAt: ts, headSig: sig, headSigAlg: SIGNED_HEAD_V4_ALG, headSignedAt: ts, receiptLogRoot: receiptLogRoot! }
    // Unsigned branch: explicitly CLEAR any stale signature fields (Codex MEDIUM) so a previously-signed head can
    // never keep wearing an old signature after signing is turned off — that would read as "signed" but not verify.
    : { lastChainHash: chainHash, count: newCount, updatedAt: ts, headSig: undefined, headSigAlg: undefined, headSignedAt: undefined, receiptLogRoot: undefined };
  if (head) {
    await ctx.db.patch(head._id, headFields);
  } else {
    await ctx.db.insert("auma_receipt_chain_head", { key: chainKey, ...headFields });
  }
  return receiptId;
}

/**
 * Write a chained receipt row scoped to chainKey. Requires a CONSUMED
 * intent (decisionLogId) — no orphan/forged receipts via the helper.
 * Advances the per-chainKey head pointer (truncation detection).
 */
export async function writeReceiptRow(
  ctx: MutationCtx,
  input: ReceiptInput & { chainKey: string; decisionLogId: string },
): Promise<string> {
  // The ":rev" chainKey suffix is RESERVED for revocation heads (signed ad hoc in nodeA.revoke, same chainHead
  // domain). Refusing it here keeps (domain, chainKey) sufficient for grant-vs-revocation separation without
  // leaning on hash-preimage structure (adversarial review B1.3b, defense-in-depth).
  if (input.chainKey.endsWith(":rev")) throw new Error("aukora_receipt_chainkey_reserved_suffix");
  // The "id:" PREFIX is RESERVED for AUMLOK identity-lifecycle chains (B2.1), written ONLY by the PoP-gated identity
  // registry via appendReceiptAndSignHead — never by an ordinary intent-gated effect. Refusing it here prevents any
  // general writer from PRE-POLLUTING an identity's `id:{rootId}` chain before (or after) its genesis.
  if (input.chainKey.startsWith("id:")) throw new Error("aukora_receipt_chainkey_reserved_prefix_id");
  // The "mft:" PREFIX is RESERVED for AUMLOK manifest-lifecycle chains (B2.2), written ONLY by the manifest registry
  // via appendManifestLifecycleReceipt — same reservation discipline as `id:`.
  if (input.chainKey.startsWith("mft:")) throw new Error("aukora_receipt_chainkey_reserved_prefix_mft");
  const intent = await ctx.db
    .query("aukora_intent_logs")
    .withIndex("by_logId", (q) => q.eq("logId", input.decisionLogId))
    .first();
  if (!intent) throw new Error("aukora_receipt_unknown_intent");
  if (!intent.tokenConsumedAt) throw new Error("aukora_receipt_intent_not_consumed");

  const { chainKey, decisionLogId: _decisionLogId, ...receiptInput } = input;
  return appendReceiptAndSignHead(ctx, chainKey, receiptInput);
}

/** Frozen identity-name grammar (B2.1): lowercase alphanumerics + `.` `_` `-`, 1–64 chars. The **no-colon** rule is
 *  LOAD-BEARING — it stops a rootId from forming an ambiguous `id:{rootId}` chainKey that collides with the reserved
 *  `{chainKey}:rev` revocation grammar (e.g. `id:foo:rev`) or the `del:` grammar, in the SAME `auma_receipt_chain_head`
 *  table (the B1.3b reserved-grammar class, one level up). Shared by the registry mutations and the writer below. */
export const IDENTITY_NAME_RE = /^[a-z0-9._-]{1,64}$/;

/**
 * Append ONE AUMLOK identity-lifecycle receipt to the reserved `id:{rootId}` V4 chain — the ONLY writer of the `id:`
 * namespace (ordinary receipts are refused the `id:` prefix in writeReceiptRow). It can produce only a well-formed
 * identity receipt (FIXED actorModel/lane/risk/grade/verdict + the `id:{rootId}` chainKey), so even if it were ever
 * called from the wrong place it could not forge an arbitrary receipt onto an identity chain. `proof` is PUBLIC event
 * detail (fingerprints, keyIds) — NEVER a seed or phrase. Authorization (operator PoP) is the caller's job, upstream
 * in the B2.1 identity mutation. Returns the receiptId.
 */
export async function appendIdentityLifecycleReceipt(
  ctx: MutationCtx,
  rootId: string,
  event: string,
  proof: Record<string, unknown>,
): Promise<string> {
  // Defense-in-depth: re-validate the rootId grammar HERE (independent of the registry's own check) so this writer
  // can never mint an ambiguous `id:{rootId}` chainKey even if a future caller forgot to validate upstream.
  if (typeof rootId !== "string" || !IDENTITY_NAME_RE.test(rootId)) throw new Error("aukora_identity_rootid_invalid");
  return appendReceiptAndSignHead(ctx, `id:${rootId}`, {
    goal: event,
    actorModel: "aukora.identity",
    lane: "local",
    risk: "critical",
    grade: "A",
    verdict: "kept",
    actionsJson: JSON.stringify({ kind: event, rootId }),
    proofJson: JSON.stringify(proof),
  });
}

/**
 * Append ONE AUMLOK manifest-lifecycle receipt to the reserved `mft:{manifestId}` V4 chain — the ONLY writer of the
 * `mft:` namespace (ordinary receipts are refused the prefix in writeReceiptRow). Same shape/guarantees as the
 * identity writer: it can only ever emit a well-formed manifest receipt, and `manifestId` is grammar-guarded here
 * (defense-in-depth) so it can never form an ambiguous chainKey. `proof` is PUBLIC event detail (ids/fingerprints/
 * reason) — never a seed/phrase. Authorization is the caller's job, upstream in the B2.2 manifest mutation.
 */
export async function appendManifestLifecycleReceipt(
  ctx: MutationCtx,
  manifestId: string,
  event: string,
  proof: Record<string, unknown>,
): Promise<string> {
  if (typeof manifestId !== "string" || !IDENTITY_NAME_RE.test(manifestId)) throw new Error("aukora_manifest_id_invalid");
  return appendReceiptAndSignHead(ctx, `mft:${manifestId}`, {
    goal: event,
    actorModel: "aukora.identity",
    lane: "local",
    risk: "critical",
    grade: "A",
    verdict: "kept",
    actionsJson: JSON.stringify({ kind: event, manifestId }),
    proofJson: JSON.stringify(proof),
  });
}

/**
 * Founder-gated bounded verifier for one chainKey: recomputes chainHash
 * from each receipt's payload (catches tampered payloads) over the newest
 * `limit`, and confirms the newest matches the head pointer (catches tail
 * truncation). For FULL-chain proof beyond `limit`, use
 * verifyReceiptChainPage below.
 */
// Shared READ-ONLY verify + high-water evaluation — used by the verifyReceiptChain query AND the
// verifyAndRecordReceiptHead mutation, so both speak identical verification logic (one source of truth).
export async function verifyReceiptChainCore(ctx: QueryCtx | MutationCtx, chainKey: string, limit: number) {
  const desc = await ctx.db
    .query("auma_receipts")
    .withIndex("by_chainKey_ts", (q) => q.eq("chainKey", chainKey))
    .order("desc")
    .take(limit);
  const oldestFirst = [...desc].reverse();
  const rows = oldestFirst.map((r) => ({ payload: receiptPayload({ ...r, chainKey: r.chainKey ?? chainKey }), chainHash: r.chainHash ?? "" }));
  // PAL-1: seed the recompute from the window's TRUE predecessor (oldest scanned row's prevHash), not null.
  const startPrev = oldestFirst[0]?.prevHash ?? null;
  const breakAt = await verifyReceiptChainRows(rows, startPrev);

  const head = await ctx.db
    .query("auma_receipt_chain_head")
    .withIndex("by_key", (q) => q.eq("key", chainKey))
    .first();
  const newestScanned = desc[0]?.chainHash ?? null;
  // PALKERN-2: a deleted/absent head with receipts still present is a HARD failure — UNCONDITIONALLY (NOT gated on
  // signing). Without this, head==null forced truncationSuspected=false (it requires head!=null), so a head-deletion
  // false-greened as "intact". In normal operation appendReceipt always writes a head, so a chain with receipts
  // always has one — this only fires on genuine head deletion / tamper, never on a healthy chain.
  const missingHead = head == null && rows.length > 0;
  const headMatches = head == null ? rows.length === 0 : head.lastChainHash === newestScanned;
  const truncationSuspected = head != null && !headMatches;

  // DOWNGRADE/STRIP DEFENSE: when head signing is configured, a missing/wrong-alg/forged head signature is a HARD
  // failure (an unsigned head is a TAMPER signal). Skipped entirely when not configured (additive).
  const pub = await resolveChainVerifyingPublicKey();
  const signingExpected = pub != null;
  let headSignature: { ok: boolean; reason: string | null } = { ok: true, reason: null };
  // RECOMPUTE-AND-COMPARE (B1.5b2 invariant #6): the V4 signature proves the kernel signed head.receiptLogRoot for
  // this count; recomputing the root from the actual stored receipts proves that signed root matches reality. A
  // same-size head wearing a different (forged) root is caught here as log_root_mismatch (invariant #8). Full O(n)
  // pass — lab scale (compact-range incremental is FUTURE).
  let logRootOk = true;
  if (signingExpected) {
    if (head) {
      headSignature = await verifyHeadRowSignatureV4(pub, head, chainKey);
      if (headSignature.ok) {
        const recomputed = await computeReceiptLogRoot(ctx, chainKey);
        logRootOk = recomputed.root === head.receiptLogRoot && recomputed.size === head.count; // root + explicit size invariant
      }
    } else if (rows.length > 0) headSignature = { ok: false, reason: "missing_head" };
  }

  // IDC-3 ROLLBACK/FORK DETECTION (READ-ONLY here): compare the head's count against the remembered high-water
  // mark. A genuinely-signed OLDER head passes signature + head-match, so only this memory catches a rollback.
  // Inert until a verify-and-record has stored a HWM (no row → genesis/ok), so healthy chains are unaffected.
  const hwmRow = await ctx.db
    .query("auma_chain_high_water")
    .withIndex("by_chainKey", (q) => q.eq("chainKey", chainKey))
    .first();
  // Codex edge: evaluate the HWM even when the head is MISSING (treat as count 0). If a HWM with maxCount>0 exists
  // and the head + receipts were BOTH deleted, that is rollback-to-nothing / erasure — it must NOT read as healthy
  // genesis. (No HWM → evaluateHighWater returns "ok", preserving healthy empty-chain genesis behavior.)
  const effectiveHead = { count: head?.count ?? 0, headHash: head?.lastChainHash ?? "" };
  const rollbackStatus = evaluateHighWater(hwmRow ? { maxCount: hwmRow.maxCount, headHash: hwmRow.headHash } : null, effectiveHead);

  const verified = breakAt === null && !missingHead && !truncationSuspected && headSignature.ok && logRootOk && rollbackStatus === "ok";
  const status = verified
    ? ("verified" as const)
    : missingHead
      ? ("missing_head" as const)
      : truncationSuspected
        ? ("truncated" as const)
        : !headSignature.ok
          ? ("head_signature_invalid" as const)
          : !logRootOk
            ? ("log_root_mismatch" as const)
            : rollbackStatus === "rollback"
              ? ("rolled_back" as const)
              : rollbackStatus === "fork"
                ? ("forked" as const)
                : ("broken" as const);
  return {
    ok: verified, status,
    count: rows.length, headCount: head?.count ?? 0, breakAt, truncationSuspected, missingHead,
    signingExpected, headSignatureOk: headSignature.ok, headSignatureReason: headSignature.reason,
    rollbackStatus, highWaterCount: hwmRow?.maxCount ?? null,
    _head: head ? { count: head.count, lastChainHash: head.lastChainHash, headSignedAt: head.headSignedAt ?? null } : null,
  };
}

/**
 * Founder-gated bounded verifier for one chainKey: recomputes chainHash from each receipt's payload (tampered
 * payloads), confirms the newest matches the head (tail truncation), verifies the head signature when signing is
 * configured, AND (IDC-3) reports a rollback/fork against the high-water mark. READ-ONLY (never raises the HWM).
 */
export const verifyReceiptChain = internalQuery({ // S1a: internal-only (B1)
  args: { token: v.optional(v.string()), chainKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const founder = await resolveFounderUserId(ctx, args.token);
    // Codex 3.10 MED: unauthorized must NOT look like an intact chain — fail the integrity signal closed.
    if (!founder) return { authorized: false as const, ok: false, status: "unauthorized" as const, count: 0, breakAt: null, truncationSuspected: false };
    const limit = Math.max(1, Math.min(500, args.limit ?? 200));
    const { _head, ...rest } = await verifyReceiptChainCore(ctx, args.chainKey, limit);
    void _head;
    return { authorized: true as const, ...rest };
  },
});

/**
 * IDC-3 — the WITNESS action: verify the chain over the bounded NEWEST window (same window as verifyReceiptChain),
 * then RAISE the high-water mark only if that verification passes and the head is at-or-above the remembered max. A
 * rollback / fork / erasure makes verification fail → the HWM is never lowered.
 * SCOPE (honest): this is bounded newest-window verification, NOT a full-chain re-walk. When signing IS configured
 * the head SIGNATURE commits to the whole chain (the head hash chains every prior receipt; a mid-chain tamper
 * changes it and the stored signature no longer verifies → caught here). A full-chain link re-walk for the UNSIGNED
 * case (via verifyReceiptChainPage) is the documented next step. Founder-gated mutation; the ONLY writer of
 * auma_chain_high_water. Does NOT touch the receipt write path.
 */
export const verifyAndRecordReceiptHead = internalMutation({
  args: { token: v.optional(v.string()), chainKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const founder = await resolveFounderUserId(ctx, args.token);
    if (!founder) return { authorized: false as const, recorded: false, ok: false, status: "unauthorized" as const };
    const limit = Math.max(1, Math.min(500, args.limit ?? 200));
    const core = await verifyReceiptChainCore(ctx, args.chainKey, limit);
    let recorded = false;
    if (core.ok && core._head) {
      const hwmRow = await ctx.db
        .query("auma_chain_high_water")
        .withIndex("by_chainKey", (q) => q.eq("chainKey", args.chainKey))
        .first();
      const now = Date.now();
      const fields = { maxCount: core._head.count, headHash: core._head.lastChainHash, signedAt: core._head.headSignedAt ?? undefined, updatedAt: now };
      if (!hwmRow) { await ctx.db.insert("auma_chain_high_water", { chainKey: args.chainKey, ...fields }); recorded = true; }
      else if (core._head.count > hwmRow.maxCount) { await ctx.db.patch(hwmRow._id, fields); recorded = true; }
      // count === max (already at the watermark) → verified no-op; count < max → core.ok is false (rolled_back) → never here.
    }
    // Report the EFFECTIVE high-water AFTER this call (core.highWaterCount was read before the raise).
    const effectiveHighWater = recorded ? core._head!.count : core.highWaterCount;
    const { _head, ...rest } = core;
    void _head;
    return { authorized: true as const, recorded, ...rest, highWaterCount: effectiveHighWater };
  },
});

/**
 * Codex MEDIUM (3.7): full-chain paginated verifier. Walks one chainKey
 * oldest→newest in pages, carrying `expectedPrevHash` between calls
 * (Nebius nextExpectedPrevHash pattern) so the WHOLE chain can be proven,
 * not just the newest window. Returns the cursor + carry for the next page.
 *
 * #12 (2026-06-06): TRUNCATION-SAFE. Intermediate pages report link-integrity only
 * (status "scanning"); on the FINAL page (page.isDone) it ALSO asserts the walked tail
 * matches the chain head + head signature + high-water mark — the same checks
 * verifyReceiptChainCore uses — so a tail-truncated chain reports "truncated" (ok:false),
 * not a false "verified". ok:true on completion = true proof-of-completeness.
 */
export const verifyReceiptChainPage = internalQuery({ // S1a: internal-only (B1)
  args: {
    token: v.optional(v.string()),
    chainKey: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    expectedPrevHash: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const founder = await resolveFounderUserId(ctx, args.token);
    if (!founder) return { authorized: false as const, ok: false, status: "unauthorized" as const, done: true, breakAt: null, scanned: 0, nextCursor: null, nextExpectedPrevHash: null };
    const pageSize = Math.max(1, Math.min(500, args.pageSize ?? 200));
    const page = await ctx.db
      .query("auma_receipts")
      .withIndex("by_chainKey_ts", (q) => q.eq("chainKey", args.chainKey))
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });
    const rows = page.page.map((r) => ({ payload: receiptPayload({ ...r, chainKey: r.chainKey ?? args.chainKey }), chainHash: r.chainHash ?? "" }));
    const startPrev = args.expectedPrevHash ?? null;
    const breakAt = await verifyReceiptChainRows(rows, startPrev);
    const tail = rows.length ? rows[rows.length - 1].chainHash : startPrev;
    const linkOk = breakAt === null;

    // #12 FIX: link-integrity ALONE cannot detect tail-truncation (newest receipts dropped) — a
    // truncated chain walks clean to its short end and used to return ok:true. So on the FINAL page,
    // also assert the walked tail matches the signed head + high-water (same checks verifyReceiptChainCore
    // uses), making this verifier's completion true proof-of-completeness, not just link-consistency.
    let truncationSuspected = false;
    let missingHead = false; // PALKERN-2: head==null with rows present = hard failure, unconditional (not signing-gated)
    let rollbackStatus: string = "ok";
    let headSignatureOk = true;
    let logRootOk = true;
    if (page.isDone && linkOk) {
      const head = await ctx.db
        .query("auma_receipt_chain_head")
        .withIndex("by_key", (q) => q.eq("key", args.chainKey))
        .first();
      const newestScanned = tail; // asc walk: the last row of the last page is the newest
      missingHead = head == null && rows.length > 0;
      const headMatches = head == null ? rows.length === 0 : head.lastChainHash === newestScanned;
      truncationSuspected = head != null && !headMatches;
      const pub = await resolveChainVerifyingPublicKey();
      if (pub != null && head) {
        headSignatureOk = (await verifyHeadRowSignatureV4(pub, head, args.chainKey)).ok;
        if (headSignatureOk) { // recompute-and-compare the V4 receipt-log root over the full chain (final page only)
          const recomputed = await computeReceiptLogRoot(ctx, args.chainKey);
          logRootOk = recomputed.root === head.receiptLogRoot && recomputed.size === head.count;
        }
      } else if (pub != null && rows.length > 0) headSignatureOk = false;
      const hwmRow = await ctx.db
        .query("auma_chain_high_water")
        .withIndex("by_chainKey", (q) => q.eq("chainKey", args.chainKey))
        .first();
      const effectiveHead = { count: head?.count ?? 0, headHash: head?.lastChainHash ?? "" };
      rollbackStatus = evaluateHighWater(hwmRow ? { maxCount: hwmRow.maxCount, headHash: hwmRow.headHash } : null, effectiveHead);
    }
    const finalVerified = linkOk && !missingHead && !truncationSuspected && headSignatureOk && logRootOk && rollbackStatus === "ok";
    const finalStatus = !linkOk
      ? ("broken" as const)
      : missingHead ? ("missing_head" as const)
      : truncationSuspected ? ("truncated" as const)
      : !headSignatureOk ? ("head_signature_invalid" as const)
      : !logRootOk ? ("log_root_mismatch" as const)
      : rollbackStatus === "rollback" ? ("rolled_back" as const)
      : rollbackStatus === "fork" ? ("forked" as const)
      : ("verified" as const);

    return {
      authorized: true as const,
      // intermediate pages: link-ok only (head unknown until the end). final page: FULL proof.
      ok: page.isDone ? finalVerified : linkOk,
      status: page.isDone ? finalStatus : (linkOk ? ("scanning" as const) : ("broken" as const)),
      done: page.isDone,
      breakAt,
      truncationSuspected,
      missingHead,
      rollbackStatus,
      scanned: rows.length,
      nextCursor: page.isDone ? null : page.continueCursor,
      nextExpectedPrevHash: linkOk ? tail : null,
    };
  },
});

export const getReceiptChainHeadPublic = internalQuery({ // S1a: internal-only (B1) — "Public" is the donor name; NO public surface remains
  args: { chainKey: v.string() },
  handler: async (ctx, args) => {
    const head = await ctx.db
      .query("auma_receipt_chain_head")
      .withIndex("by_key", (q) => q.eq("key", args.chainKey))
      .first();
    if (!head) {
      return {
        exists: false as const,
        chainKey: args.chainKey,
        count: 0,
        lastChainHash: null,
        headSig: null,
        headSigAlg: null,
        headSignedAt: null,
        receiptLogRoot: null,
        updatedAt: null,
      };
    }
    // 24Y.7: headSig is PUBLIC verification material (an ML-DSA-65 signature, verifiable against the
    // published chain public key) — NOT a secret. Returning it lets a reader cryptographically pin the
    // canonical kernel. The signing SEED/secret key is never here (it lives only in env on the signer).
    return {
      exists: true as const,
      chainKey: args.chainKey,
      count: head.count,
      lastChainHash: head.lastChainHash,
      headSig: head.headSig ?? null,
      headSigAlg: head.headSigAlg ?? null,
      headSignedAt: head.headSignedAt ?? null,
      receiptLogRoot: head.receiptLogRoot ?? null,
      updatedAt: head.updatedAt,
    };
  },
});