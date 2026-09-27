// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * Mutation-layer decision-token verify + consume.
 *
 * Hardened beyond the Nebius original (Gemini HIGH): the token is
 * HMAC-signed with a server-only secret (AUKORA_TOKEN_SECRET), so a
 * leaked intent hash is NOT enough to forge a token — you also need the
 * secret. FAIL CLOSED: if the secret is unset, verification throws and
 * no protected action can run.
 *
 * `ring` is REQUIRED (Gemini MEDIUM: the old `if (input.ring && ...)`
 * silently skipped the ring check when omitted).
 *
 * OCC-safe: consume patches the same intent-log row; Convex serializes
 * mutations on that row, so a concurrent reuse retries → sees
 * `tokenConsumedAt` → throws.
 */

import type { MutationCtx } from "./_generated/server";
import { parseAukoraDecisionToken, hmacSha256Hex, timingSafeEqual, AUKORA_DECISION_TOKEN_TTL_MS } from "./aukoraCore";
import { isAukoraDisabled, isGlobalSalamaActive } from "./aukoraRuntime";

export type DecisionTokenConsumeInput = {
  token?: string | null;
  action: string;
  resource: string;
  ring: string; // REQUIRED
  expectedActorId?: string; // optional binding: token must belong to this actor
  maxAgeMs?: number;
};

export type DecisionTokenConsumeResult = {
  ok: true;
  logId: string;
  authorizationRef: string | null;
  actorId: string;
  actorRole: string;
  consumedAt: number;
};

export async function verifyAndConsumeDecisionToken(
  ctx: MutationCtx,
  input: DecisionTokenConsumeInput,
): Promise<DecisionTokenConsumeResult> {
  if (!input.token) throw new Error("aukora_decision_token_required");
  if (!input.ring) throw new Error("aukora_decision_ring_required");
  // Kill switch fails closed before anything else (Wave 3.6).
  if (await isAukoraDisabled(ctx)) throw new Error("aukora_kill_switch_active");
  if (await isGlobalSalamaActive(ctx)) throw new Error("aukora_salama_active");
  const secret = process.env.AUKORA_TOKEN_SECRET;
  if (!secret) throw new Error("aukora_token_secret_unset"); // fail closed

  const parsed = parseAukoraDecisionToken(input.token);

  const row = await ctx.db
    .query("aukora_intent_logs")
    .withIndex("by_logId", (q) => q.eq("logId", parsed.logId))
    .first();
  if (!row) throw new Error("aukora_decision_token_not_found");

  // Recompute the expected HMAC signature over logId:intentHash and compare
  // in constant time (Wave 3.6 — `!==` leaked timing). A forged token (or
  // one built from a leaked hash without the secret) fails here.
  const expectedSig = await hmacSha256Hex(secret, `${parsed.logId}:${row.hash}`);
  if (!timingSafeEqual(parsed.sig, expectedSig)) throw new Error("aukora_decision_token_not_found");

  if (input.expectedActorId && row.actorId !== input.expectedActorId) {
    throw new Error("aukora_decision_actor_mismatch");
  }
  if (row.executionStatus !== "allowed") throw new Error("aukora_decision_not_allowed");
  if (row.status !== "accepted" || row.acceptedClaim !== "moga") {
    throw new Error("aukora_decision_not_accepted");
  }
  if (row.requiresAuthorization && !row.authorizationGranted) {
    throw new Error("aukora_decision_not_authorized");
  }
  if (row.ring !== input.ring) throw new Error("aukora_decision_ring_mismatch");
  if (row.action !== input.action) throw new Error("aukora_decision_action_mismatch");
  if (row.resource !== input.resource) throw new Error("aukora_decision_resource_mismatch");
  if (row.tokenConsumedAt) throw new Error("aukora_decision_token_consumed");

  const maxAgeMs = input.maxAgeMs ?? AUKORA_DECISION_TOKEN_TTL_MS;
  const ageMs = Date.now() - Number(row.ts ?? 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    throw new Error("aukora_decision_token_expired");
  }

  const consumedAt = Date.now();
  await ctx.db.patch(row._id, {
    tokenConsumedAt: consumedAt,
    tokenConsumedAction: input.action,
    tokenConsumedResource: input.resource,
  });

  return {
    ok: true,
    logId: row.logId,
    authorizationRef: row.authorizationRef ?? null,
    actorId: row.actorId,
    actorRole: row.actorRole,
    consumedAt,
  };
}