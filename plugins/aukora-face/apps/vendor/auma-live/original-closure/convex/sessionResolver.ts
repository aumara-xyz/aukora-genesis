// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
import type { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * S1a: HONEST REWRITE (demo lane removed). The donor resolver was a DEMO seam: a plaintext bearer token
 * looked up in `node_sessions` (seeded via seed.ts), with "the resolved session principal IS the
 * authority — no allowlist gate". The local organism has NO demo sessions and NO bearer-token authority.
 *
 * Local-owner model: the single owner principal is the unique `founderUserId` holding an ACTIVE key in
 * `founder_key_registry` — the same table the donor's own tests seed (popResolver.seedFounderKey /
 * seedOperatorKey), so the data model is unchanged; only the demo token lane is gone.
 *
 * FAIL CLOSED:
 *   - zero active founder keys      → unresolved (owner not yet pinned; seed the owner key first)
 *   - >1 distinct active founderIds → unresolved (ambiguous — never guess an owner)
 *
 * Authority note (B1+B2, one lock with two parts): every registered function in this vendored set is
 * internal-only, so reaching these resolvers already requires the self-hosted ADMIN KEY. The legacy
 * `token` parameter is retained for call-site compatibility but carries NO authority here — bearer-token
 * authority was the demo lane and is removed.
 */
export async function resolveFounderUserId(
  ctx: QueryCtx | MutationCtx,
  _token?: string, // S1a: demo lane removed — ignored; kept only so donor call sites are untouched
): Promise<string | null> {
  // Owner-scale table (a handful of rows); full scan is deliberate — no index exists on status alone.
  const rows = await ctx.db.query("founder_key_registry").collect();
  const owners = [...new Set(rows.filter((r) => r.status === "active").map((r) => r.founderUserId))];
  return owners.length === 1 ? owners[0] : null; // fail closed on zero AND on ambiguity
}

export async function requireFounderUserId(ctx: QueryCtx | MutationCtx, token?: string): Promise<string> {
  const id = await resolveFounderUserId(ctx, token);
  if (!id) {
    throw new Error(
      "aukora_local_owner_unresolved: founder_key_registry must hold exactly one ACTIVE owner principal " +
        "(pin it via popResolver.seedFounderKey / seedOperatorKey); zero or ambiguous active owners fail closed",
    );
  }
  return id;
}
