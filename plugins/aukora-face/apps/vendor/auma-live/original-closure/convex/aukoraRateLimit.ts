// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * Aukora rate limiter — audit DoS-1, the FLOOD-CAP half.
 *
 * The prune cron in aukoraMaintenance.ts bounds the total SIZE of aukora_grants; this bounds the RATE at which
 * authoring writes can be issued. A persistent token bucket: `capacity` tokens that refill linearly over
 * `windowMs`, one consumed per authoring write; over-cap → refused (fail closed).
 *
 * DB-backed because Convex mutations are stateless (no shared memory across invocations) — keyed per bucketKey
 * (e.g. `grant:<founder>`), one tiny row per key, self-updating (no unbounded growth → no GC needed). The pure
 * step `bucketConsume` is deterministic (inject `now`) so the policy is unit-testable without a database; it
 * mirrors the in-memory arena QPS limiter's token-bucket shape.
 */
import type { MutationCtx } from "./_generated/server";

export type BucketState = { tokens: number; updatedAt: number };
export type BucketConfig = { capacity: number; windowMs: number };
export type BucketStep = { allowed: boolean; next: BucketState };

/**
 * Pure token-bucket step. A null state is treated as a fresh, full bucket. Refills `capacity` tokens per
 * `windowMs` (linear), consumes one token on an allowed request. Deterministic — pass `now` in ms. Never
 * throws; clamps degenerate config (capacity/windowMs floored at 1) and never grants free tokens from a
 * backwards clock (elapsed clamped at 0). Tokens never exceed capacity (no overflow after long idle).
 */
export function bucketConsume(state: BucketState | null, cfg: BucketConfig, now: number): BucketStep {
  const capacity = Math.max(1, Math.floor(cfg.capacity));
  const windowMs = Math.max(1, Math.floor(cfg.windowMs));
  const ratePerMs = capacity / windowMs;
  const prev = state ?? { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - prev.updatedAt); // clock skew/regression cannot mint free tokens
  const tokens = Math.min(capacity, prev.tokens + elapsed * ratePerMs);
  if (tokens < 1) return { allowed: false, next: { tokens, updatedAt: now } };
  return { allowed: true, next: { tokens: tokens - 1, updatedAt: now } };
}

/**
 * DB-backed consume: read/create the bucket row for `key`, apply ONE bucketConsume step, persist, and return
 * whether the request is allowed. Call INSIDE a mutation, BEFORE the authoring write (fail closed — a refused
 * request must not write). Convex OCC serializes concurrent same-key consumes (the .query read is in the read
 * set), so a flood cannot race past the cap.
 */
export async function consumeRateLimit(
  ctx: MutationCtx,
  key: string,
  cfg: BucketConfig,
  now: number = Date.now(),
): Promise<boolean> {
  const row = await ctx.db
    .query("aukora_rate_limits")
    .withIndex("by_bucketKey", (q) => q.eq("bucketKey", key))
    .first();
  const { allowed, next } = bucketConsume(
    row ? { tokens: row.tokens, updatedAt: row.updatedAt } : null,
    cfg,
    now,
  );
  if (row) await ctx.db.patch(row._id, { tokens: next.tokens, updatedAt: next.updatedAt });
  else await ctx.db.insert("aukora_rate_limits", { bucketKey: key, tokens: next.tokens, updatedAt: next.updatedAt });
  return allowed;
}