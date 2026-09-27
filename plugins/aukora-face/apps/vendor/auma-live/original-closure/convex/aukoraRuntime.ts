// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * Aukora runtime spine (Wave 3 enforcement core), ported from the
 * Auma Nebius forge. Founder-gated operator mutations + the internal
 * submit-intent engine.
 *
 * Flow (the muscle):
 *   issueGrant (operator)  → aukora_grants row (maxUses one-shot)
 *   submitIntent (internal) → evaluate + execute + consume grant if
 *      allowed + write runtime state + log intent (hash-chained) +
 *      mint a single-use decision token when allowed
 *   the protected mutation then verifies+consumes that token
 *
 * FAIL CLOSED everywhere. Decision-token + intent hashes are NEVER
 * returned from public/operator surfaces (only the internal submit
 * path returns the token to its trusted caller).
 */

import { internalMutation, internalQuery } from "./_generated/server"; // S1a: internal-only (B1) — unused public `mutation` import dropped
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  evaluateAukoraIntent,
  executeAukoraIntent,
  grantUsability,
  ringCovers,
  buildReceiptChainHash,
  buildSignedDecisionToken,
  intentLogIdFromHash,
  assertBoundedEngineInputs,
  type AukoraRing,
  type AukoraIntentInput,
  type AukoraRuntimeStateInput,
} from "./aukoraCore";
import { requireFounderUserId } from "./sessionResolver";
import { consumeRateLimit } from "./aukoraRateLimit";
import { assertAsciiTarget } from "./aukoraActionRegistry";

// Operator/global state key for salama + the operator console. Per-actor
// chains use their own stateKey so intents do NOT all serialize through
// one global row (Gemini CRITICAL: global-row OCC bottleneck).
export const AUKORA_OPERATOR_STATE_KEY = "auma_operator";

const ringValidator = v.union(
  v.literal("observe"),
  v.literal("local-write"),
  v.literal("external"),
  v.literal("self-modify"),
);

// Grant clamps (Codex MEDIUM) — mirror the Nebius operator limits.
const MAX_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_GRANT_USES = 1000;

// ── Runtime state helpers (keyed per stateKey) ───────────────────

async function readRuntimeState(
  ctx: MutationCtx,
  stateKey: string,
): Promise<AukoraRuntimeStateInput & { lastLogId?: string | null }> {
  const row = await ctx.db
    .query("aukora_runtime_state")
    .withIndex("by_stateKey", (q) => q.eq("stateKey", stateKey))
    .first();
  return {
    salamaActive: Boolean(row?.salamaActive),
    salamaReason: row?.salamaReason ?? null,
    lastHash: row?.lastHash ?? null,
    lastLogId: row?.lastLogId ?? null,
  };
}

async function writeRuntimeState(
  ctx: MutationCtx,
  stateKey: string,
  next: AukoraRuntimeStateInput,
  updatedBy: string,
  lastLogId: string | null,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("aukora_runtime_state")
    .withIndex("by_stateKey", (q) => q.eq("stateKey", stateKey))
    .first();
  const patch = {
    salamaActive: next.salamaActive,
    salamaReason: next.salamaReason ?? null,
    lastHash: next.lastHash ?? undefined,
    lastLogId: lastLogId ?? undefined,
    updatedBy,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("aukora_runtime_state", { stateKey, createdAt: now, ...patch });
  }
}

// ── Kill switch (Wave 3.6 defense-in-depth) ──────────────────────
// Read the operator state row's killSwitch. When true, the whole
// enforcement engine fails closed. Exported so aukoraToken can also
// check it at consume time (one-directional import; no cycle).

export async function isAukoraDisabled(ctx: MutationCtx): Promise<boolean> {
  const row = await ctx.db
    .query("aukora_runtime_state")
    .withIndex("by_stateKey", (q) => q.eq("stateKey", AUKORA_OPERATOR_STATE_KEY))
    .first();
  return Boolean(row?.killSwitch);
}

// Operator-wide salama HOLD (Codex HIGH fix). Distinct from the kill switch:
// salama is AUMA's pause signal. When the operator state row's salamaActive is
// set, the WHOLE engine pauses (fail-closed) on EVERY stateKey until Peter
// clears it — previously salama only halted its own chain, leaving other
// stateKeys submittable. Read at submit AND consume, like the kill switch.
export async function isGlobalSalamaActive(ctx: MutationCtx): Promise<boolean> {
  const row = await ctx.db
    .query("aukora_runtime_state")
    .withIndex("by_stateKey", (q) => q.eq("stateKey", AUKORA_OPERATOR_STATE_KEY))
    .first();
  return Boolean(row?.salamaActive);
}

// ── Grant lookup ─────────────────────────────────────────────────

async function findActiveGrant(
  ctx: MutationCtx,
  actorId: string,
  ring: AukoraRing,
  action: string,
  resource: string,
) {
  const now = Date.now();
  const candidates = await ctx.db
    .query("aukora_grants")
    .withIndex("by_actor_status", (q) => q.eq("actorId", actorId).eq("status", "active"))
    .take(50);
  for (const g of candidates) {
    if (!ringCovers(g.ring as AukoraRing, ring)) continue;
    // F5-grant (audit): a grant must EXPLICITLY scope BOTH action and resource. An empty/undefined action or
    // resource is a NO-MATCH sentinel (fail closed) — never a ring-wide wildcard. An under-specified grant
    // authorizes NOTHING, not everything. (Every legitimate creator sets both; only a founder issueGrant that
    // omits them could create an unscoped row, which now matches nothing rather than the whole ring.)
    if (!g.action || g.action !== action) continue;
    if (!g.resource || g.resource !== resource) continue;
    const u = grantUsability({ status: g.status, expiresAt: g.expiresAt, maxUses: g.maxUses, usedCount: g.usedCount }, now);
    if (u.usable) return g;
  }
  return null;
}

// ── Internal: submit an intent (the engine) ──────────────────────
// Trusted callers only (protected actions). actorId/actorRole/ring/
// action/resource must be derived from the action, not from user input.

export type SubmitIntentArgs = {
  actorId: string;
  actorRole: "operator" | "system" | "test";
  ring: AukoraRing;
  claim: string;
  action: string;
  resource: string;
  statement?: string;
  requiresAuthorization: boolean;
  intentId?: string;
  triggerSalama?: boolean;
  clearSalama?: boolean;
  // Per-chain key (Gemini CRITICAL fix). Each actor/session chains its
  // intents independently so they don't all serialize through one global
  // row. Defaults to a per-actor key.
  stateKey?: string;
  // Explicit human/Ring-0 clearance. self-modify is refused without it (kernel ceiling). Defaults false.
  humanClearance?: boolean;
  // Opt-in per-key rate limit for UNTRUSTED proposers (e.g. a model). Trusted prod callers omit it (unaffected).
  // When provided + exhausted, the submit is refused BEFORE any intent-log/receipt write (no dirty state).
  rateLimit?: { key: string; capacity: number; windowMs: number };
};

/**
 * The submit-intent ENGINE as a plain ctx helper so trusted callers
 * (protected actions, the operator test driver) can run the full flow in
 * one atomic mutation. The internalMutation below is a thin wrapper.
 */
export async function submitIntentCore(ctx: MutationCtx, args: SubmitIntentArgs) {
  {
    // Kill switch fails the whole engine closed (Wave 3.6).
    if (await isAukoraDisabled(ctx)) {
      throw new Error("aukora_kill_switch_active");
    }
    // Operator-wide salama hold halts ALL submissions, any stateKey (Codex HIGH).
    if (await isGlobalSalamaActive(ctx)) {
      throw new Error("aukora_salama_active");
    }
    // ASCII-TARGET GUARD (Aukora Action Registry, Phase 2a — F-T3 residual #1). action + resource MUST be ASCII.
    // A non-ASCII homoglyph of a sacred word (e.g. a Cyrillic "раladin_config") is collapsed to "_" by the sacred
    // regex normalizer and would MISS the Ring-0 check — so reject any non-ASCII target at the gate entrance, fail
    // closed, BEFORE matching. This does NOT change sacred-target semantics (the regex is untouched); it only
    // rejects malformed/confusable input. Every legitimate caller passes ASCII identifier constants, so it never
    // fires for real traffic. (Aukora is the portable kernel; AUMA contains the first implementation.)
    // Input-1 (audit): bounded, FAIL-CLOSED validation of engine inputs BEFORE any grant lookup, log write, or
    // token mint — length caps bound log/receipt growth; the ASCII guard on key/id/claim rejects control / bidi /
    // zero-width / non-ASCII in fields the runtime treats as stable keys. Authority strings pass EXACTLY or fail
    // (never trimmed/mutated). Real callers pass short ASCII constants, so it never fires for them; it hardens the
    // latent Wave-4 user-derived stateKey / per-thread-chain path.
    assertBoundedEngineInputs(args);
    assertAsciiTarget(args.action, args.resource);
    // Codex MEDIUM (3.7): for a durable action that will need an HMAC
    // token, FAIL BEFORE consuming a grant or logging "allowed" if the
    // secret is unset — otherwise we'd burn a one-shot grant and record
    // an allowed intent that can never mint a redeemable token.
    if (args.requiresAuthorization && !process.env.AUKORA_TOKEN_SECRET) {
      throw new Error("aukora_token_secret_unset");
    }
    // RATE LIMIT (ULTRON_PASS Brick 5): opt-in per-key token bucket for untrusted proposers. Checked BEFORE any
    // intent-log/receipt write, so a refused (rate-limited) spam leaves no dirty state — only the bucket row advances.
    // Trusted prod callers (studio/memory/evals) omit rateLimit and are unaffected (no global false-red).
    if (args.rateLimit) {
      const rlOk = await consumeRateLimit(ctx, args.rateLimit.key, { capacity: args.rateLimit.capacity, windowMs: args.rateLimit.windowMs });
      if (!rlOk) return { ok: false as const, rateLimited: true as const, decisionToken: null, logId: "", executionStatus: "blocked" as const, decisionStatus: "refused" as const, acceptedClaim: args.claim, message: "rate_limited" };
    }
    const stateKey = args.stateKey ?? `actor:${args.actorId}`;
    const state = await readRuntimeState(ctx, stateKey);

    let intent: AukoraIntentInput = {
      ring: args.ring,
      claim: args.claim,
      action: args.action,
      resource: args.resource,
      statement: args.statement,
      requiresAuthorization: args.requiresAuthorization,
      authorizationGranted: false,
      humanClearance: args.humanClearance ?? false,
      intentId: args.intentId,
      triggerSalama: args.triggerSalama,
      clearSalama: args.clearSalama,
    };

    // Authorization: find a usable grant for this actor + ring + action.
    let grant = null as Awaited<ReturnType<typeof findActiveGrant>>;
    if (args.requiresAuthorization) {
      grant = await findActiveGrant(ctx, args.actorId, args.ring, args.action, args.resource);
      if (grant) {
        intent = { ...intent, authorizationGranted: true, authorizationRef: grant.grantKey };
      }
    }

    const evaluated = evaluateAukoraIntent(intent, new Set(), state);
    const execution = executeAukoraIntent(intent, evaluated.decision, evaluated.nextState);

    // One-shot consume: only when the action is actually allowed.
    if (grant && execution.status === "allowed") {
      const usedCount = (grant.usedCount ?? 0) + 1;
      const at = Date.now();
      await ctx.db.patch(grant._id, {
        usedCount,
        lastUsedAt: at,
        status: grant.maxUses !== undefined && usedCount >= grant.maxUses ? "used" : grant.status,
        updatedAt: at,
      });
    }

    const tsIso = new Date().toISOString();
    const ts = Date.now();

    // Canonical intent hash (SHA-256 over the stable payload). A random
    // nonce guarantees the derived logId is unique even for two identical
    // intents submitted in the same millisecond (self-red-team 3.6: logId
    // collision would let the SECOND row shadow the first by_logId).
    // The intent hash is never recomputed at verify time (verify recomputes
    // the HMAC over logId:storedHash), so the nonce is safe here.
    const nonce = crypto.randomUUID();
    const hash = await buildReceiptChainHash(
      {
        nonce,
        intentId: intent.intentId ?? "",
        ring: intent.ring,
        action: intent.action ?? "",
        resource: intent.resource ?? "",
        claim: intent.claim,
        status: evaluated.decision.status,
        acceptedClaim: evaluated.decision.acceptedClaim,
        requiresAuthorization: intent.requiresAuthorization ?? false,
        authorizationGranted: intent.authorizationGranted ?? false,
        executionStatus: execution.status,
        actorId: args.actorId,
        ts,
      },
      state.lastHash ?? null,
    );
    const logId = intentLogIdFromHash(hash);

    await writeRuntimeState(ctx, stateKey, { ...evaluated.nextState, lastHash: hash }, args.actorId, logId);

    await ctx.db.insert("aukora_intent_logs", {
      logId,
      stateKey,
      intentId: String(intent.intentId ?? ""),
      ring: intent.ring,
      action: intent.action,
      resource: intent.resource,
      claim: intent.claim,
      status: evaluated.decision.status,
      acceptedClaim: evaluated.decision.acceptedClaim,
      errorCode: evaluated.decision.errorCode,
      message: execution.message,
      proofRefs: evaluated.decision.proofRefs,
      requiresAuthorization: intent.requiresAuthorization ?? false,
      authorizationGranted: intent.authorizationGranted ?? false,
      authorizationRef: intent.authorizationRef,
      humanClearance: args.humanClearance ?? false,
      triggerSalama: Boolean(intent.triggerSalama),
      clearSalama: Boolean(intent.clearSalama),
      prevHash: state.lastHash ?? undefined,
      hash,
      nonce,
      executionStatus: execution.status,
      actorId: args.actorId,
      actorRole: args.actorRole,
      tsIso,
      ts,
    });

    // Mint the HMAC-signed single-use token, ONLY when allowed AND the
    // server secret is set. No secret → no token → action denied (fail
    // closed). The token is returned ONLY to the trusted internal caller.
    const secret = process.env.AUKORA_TOKEN_SECRET;
    const decisionToken =
      execution.status === "allowed" && secret
        ? await buildSignedDecisionToken(logId, hash, secret)
        : null;

    return {
      ok: execution.status === "allowed",
      logId,
      executionStatus: execution.status,
      decisionStatus: evaluated.decision.status,
      acceptedClaim: evaluated.decision.acceptedClaim,
      message: execution.message,
      decisionToken,
    };
  }
}

/** Thin internal wrapper around the engine for trusted internal callers. */
export const submitIntent = internalMutation({
  args: {
    actorId: v.string(),
    actorRole: v.union(v.literal("operator"), v.literal("system"), v.literal("test")),
    ring: ringValidator,
    claim: v.string(),
    action: v.string(),
    resource: v.string(),
    statement: v.optional(v.string()),
    requiresAuthorization: v.boolean(),
    intentId: v.optional(v.string()),
    triggerSalama: v.optional(v.boolean()),
    clearSalama: v.optional(v.boolean()),
    // Codex 3.8 MED: the helper accepts a per-chain stateKey but the wrapper
    // omitted it, so callers of the deployed wrapper could not target a
    // per-session/per-memory chain. Required for Wave 4 per-thread chains.
    stateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => submitIntentCore(ctx, args as SubmitIntentArgs),
});

// ── Operator mutations (founder-gated) ───────────────────────────

export const issueGrant = internalMutation({
  args: {
    token: v.string(),
    forActorId: v.optional(v.string()),
    ring: ringValidator,
    action: v.optional(v.string()),
    resource: v.optional(v.string()),
    reason: v.optional(v.string()),
    maxUses: v.optional(v.number()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const founder = await requireFounderUserId(ctx, args.token);
    const now = Date.now();
    // DoS-1 flood cap: bound the RATE of grant creation per founder (aukora_grants grows one row per issue;
    // the prune cron bounds total SIZE, this bounds the RATE). Default 60 per 60s, env-tunable. Fail closed —
    // an over-cap issue throws BEFORE any grant row is written.
    const rlOk = await consumeRateLimit(ctx, `grant:${founder}`, {
      capacity: Number(process.env.AUKORA_GRANT_RATE_CAP ?? 60),
      windowMs: Number(process.env.AUKORA_GRANT_RATE_WINDOW_MS ?? 60_000),
    }, now);
    if (!rlOk) throw new Error("aukora_grant_rate_limited");
    // Codex MEDIUM: clamp the operator footguns. TTL within (0, 24h];
    // maxUses within [1, 1000] when provided; forActorId must be a real
    // non-empty id when provided.
    const ttlMs = Math.min(Math.max(1, args.ttlMs ?? DEFAULT_GRANT_TTL_MS), MAX_GRANT_TTL_MS);
    let maxUses = args.maxUses;
    if (maxUses !== undefined) {
      maxUses = Math.min(Math.max(1, Math.floor(maxUses)), MAX_GRANT_USES);
    }
    const forActor = args.forActorId?.trim();
    if (args.forActorId !== undefined && !forActor) {
      throw new Error("aukora_grant_invalid_actor");
    }
    const grantKey = `pg_${crypto.randomUUID()}`;
    await ctx.db.insert("aukora_grants", {
      grantKey,
      status: "active",
      actorId: forActor ?? founder,
      actorRole: "operator",
      ring: args.ring,
      action: args.action,
      resource: args.resource,
      reason: args.reason,
      issuedBy: founder,
      issuedAt: now,
      expiresAt: now + ttlMs,
      maxUses,
      usedCount: 0,
      updatedAt: now,
    });
    return { ok: true as const, grantKey };
  },
});

export const revokeGrant = internalMutation({
  args: { token: v.string(), grantKey: v.string() },
  handler: async (ctx, args) => {
    const founder = await requireFounderUserId(ctx, args.token);
    const row = await ctx.db
      .query("aukora_grants")
      .withIndex("by_grantKey", (q) => q.eq("grantKey", args.grantKey))
      .first();
    if (!row) return { ok: false as const, reason: "not_found" as const };
    await ctx.db.patch(row._id, { status: "revoked", revokedBy: founder, revokedAt: Date.now(), revokeReason: "operator_revoke", updatedAt: Date.now() });
    return { ok: true as const };
  },
});

// Salama is operator-scoped: the founder IS the human clearance (Codex
// LOW — AUMA's operator-only clear is intentionally direct, unlike the
// Nebius evaluator which requires a separate humanClearance flag).
export const triggerSalama = internalMutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const founder = await requireFounderUserId(ctx, args.token);
    await writeRuntimeState(ctx, AUKORA_OPERATOR_STATE_KEY, { salamaActive: true, salamaReason: args.reason ?? "operator hold", lastHash: null }, founder, null);
    return { ok: true as const };
  },
});

export const clearSalama = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const founder = await requireFounderUserId(ctx, args.token);
    const state = await readRuntimeState(ctx, AUKORA_OPERATOR_STATE_KEY);
    await writeRuntimeState(ctx, AUKORA_OPERATOR_STATE_KEY, { salamaActive: false, salamaReason: null, lastHash: state.lastHash ?? null }, founder, state.lastLogId ?? null);
    return { ok: true as const };
  },
});

// Global kill switch — founder-gated, fail-closed when on.
export const setKillSwitch = internalMutation({
  args: { token: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    const founder = await requireFounderUserId(ctx, args.token);
    const now = Date.now();
    const existing = await ctx.db
      .query("aukora_runtime_state")
      .withIndex("by_stateKey", (q) => q.eq("stateKey", AUKORA_OPERATOR_STATE_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { killSwitch: args.on, updatedBy: founder, updatedAt: now });
    } else {
      await ctx.db.insert("aukora_runtime_state", {
        stateKey: AUKORA_OPERATOR_STATE_KEY,
        salamaActive: false,
        salamaReason: null,
        killSwitch: args.on,
        updatedBy: founder,
        updatedAt: now,
        createdAt: now,
      });
    }
    return { ok: true as const, killSwitch: args.on };
  },
});

export const getRuntimeState = internalQuery({ // S1a: internal-only (B1)
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const founder = args.token ? await requireFounderUserIdSafe(ctx, args.token) : null;
    if (!founder) return { authorized: false as const, salamaActive: false, salamaReason: null, killSwitch: false };
    const row = await ctx.db
      .query("aukora_runtime_state")
      .withIndex("by_stateKey", (q) => q.eq("stateKey", AUKORA_OPERATOR_STATE_KEY))
      .first();
    return {
      authorized: true as const,
      salamaActive: Boolean(row?.salamaActive),
      salamaReason: row?.salamaReason ?? null,
      killSwitch: Boolean(row?.killSwitch),
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

// Query-safe founder resolve (no throw) for the read above.
async function requireFounderUserIdSafe(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<string | null> {
  try {
    return await requireFounderUserId(ctx, token);
  } catch {
    return null;
  }
}