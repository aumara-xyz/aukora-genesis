// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * KIRA recall contracts (pure, portable).
 *
 * Deterministic recall over a supplied set of memory records: filter, score, stably order, bound. Governed
 * forgetting is enforced HERE as a read-time rail — a forgotten recordId never appears in recall results and
 * its content is never returned, while the historical receipt chain (held by the app adapter) is NOT rewritten.
 * Pure: no I/O, no clock, no randomness, no mutation of inputs.
 */
import type { MemoryRecordV1, ProvenanceKind } from './envelope.js';
import { classifyScope, type MemoryScope } from './scope.js';

/**
 * The STABLE recall query (contract v1) — text/kind/limit only. Deliberately carries NO scope selectors, so the
 * default `recall` path is byte-for-byte identical to the pre-#62 law. Scope-aware recall is a SEPARATE, explicitly
 * opt-in contract (`ScopedRecallQuery` + `recallScoped`).
 */
export interface RecallQuery {
  /** Substring/keyword to match against content (case-insensitive). Empty = match all. */
  readonly text?: string;
  readonly kind?: ProvenanceKind;
  /** Max hits (default 20). */
  readonly limit?: number;
}

/**
 * OPT-IN scope-aware query (#62) — the stable `RecallQuery` PLUS scope selectors. Only `recallScoped` reads these;
 * asking for scope-aware recall is an explicit, versioned choice, never a silent change to the default shape.
 */
export interface ScopedRecallQuery extends RecallQuery {
  /** keep ONLY records in these scopes. Absent ⇒ no scope filter. */
  readonly scopes?: readonly MemoryScope[];
  /** drop records in these scopes (e.g. exclude test/code noise). */
  readonly excludeScopes?: readonly MemoryScope[];
  /** rank records in these scopes above equal-keyword-score records of other scopes. */
  readonly preferScopes?: readonly MemoryScope[];
}

/**
 * The STABLE recall hit (contract v1) — EXACT keys, order and JSON serialization: recordId, createdAt, kind,
 * content, score. Unchanged since before #62 so existing callers, receipts and hashes over a serialized hit are
 * unaffected. The classified scope is NOT a field here — it lives only on the opt-in `ScopedRecallHit`.
 */
export interface RecallHit {
  readonly recordId: string;
  readonly createdAt: string;
  readonly kind: ProvenanceKind;
  readonly content: string;
  readonly score: number;
}

/** OPT-IN scope-aware hit (#62) — the stable `RecallHit` PLUS the classified `scope`. Only `recallScoped` returns it. */
export interface ScopedRecallHit extends RecallHit {
  readonly scope: MemoryScope;
}

/** Deterministic keyword score: term hits, higher for exact/earlier matches. No randomness. */
function scoreOf(content: string, term: string): number {
  if (term.length === 0) return 1;
  const hay = content.toLowerCase();
  const needle = term.toLowerCase();
  let score = 0;
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    score += 1;
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return score;
}

function limitOf(limit: number | undefined): number {
  return Number.isInteger(limit) && (limit as number) > 0 ? (limit as number) : 20;
}

/**
 * DEFAULT recall (contract v1) — excludes any recordId in `forgotten`. Deterministic: score desc, then createdAt
 * asc, then recordId asc — stable regardless of input order. A forgotten record is invisible and its content is
 * never surfaced (governed forgetting at read time). The result hit shape is byte-for-byte the pre-#62 law:
 * `{recordId, createdAt, kind, content, score}` with NO scope field. Scope classification is never even computed
 * here, so old callers, receipts and hashes over a serialized hit are provably unaffected.
 */
export function recall(
  records: readonly MemoryRecordV1[],
  query: RecallQuery,
  forgotten: ReadonlySet<string> = new Set(),
): RecallHit[] {
  const term = query.text ?? '';
  const limit = limitOf(query.limit);
  const hits: RecallHit[] = [];
  for (const r of records) {
    if (forgotten.has(r.recordId)) continue; // forgotten: never recalled
    if (query.kind !== undefined && r.kind !== query.kind) continue;
    const score = scoreOf(r.content, term);
    if (term.length > 0 && score === 0) continue;
    hits.push({ recordId: r.recordId, createdAt: r.createdAt, kind: r.kind, content: r.content, score });
  }
  hits.sort((a, b) =>
    b.score - a.score ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.recordId.localeCompare(b.recordId));
  return hits.slice(0, limit);
}

/**
 * OPT-IN scope-aware recall (#62) — same deterministic ordering as `recall`, plus: scope filters (`scopes`/
 * `excludeScopes`) and a `preferScopes` rank boost (a preferred-scope hit sorts above an equal-keyword-score hit of
 * another scope). Each returned hit carries the classified `scope`. This is the ONLY path that reads or emits scope,
 * so it can never change the default `recall` serialization. Deterministic; never fabricates identity (an absent
 * scope simply yields no hits — see `hasScope`/`scopeCensus` for the honest "empty shelf" signal).
 */
export function recallScoped(
  records: readonly MemoryRecordV1[],
  query: ScopedRecallQuery,
  forgotten: ReadonlySet<string> = new Set(),
): ScopedRecallHit[] {
  const term = query.text ?? '';
  const limit = limitOf(query.limit);
  const include = query.scopes && query.scopes.length ? new Set(query.scopes) : null;
  const exclude = query.excludeScopes && query.excludeScopes.length ? new Set(query.excludeScopes) : null;
  const prefer = query.preferScopes && query.preferScopes.length ? new Set(query.preferScopes) : null;
  const hits: ScopedRecallHit[] = [];
  for (const r of records) {
    if (forgotten.has(r.recordId)) continue; // forgotten: never recalled
    if (query.kind !== undefined && r.kind !== query.kind) continue;
    const score = scoreOf(r.content, term);
    if (term.length > 0 && score === 0) continue;
    const scope = classifyScope(r);
    if (include && !include.has(scope)) continue;
    if (exclude && exclude.has(scope)) continue;
    hits.push({ recordId: r.recordId, createdAt: r.createdAt, kind: r.kind, content: r.content, score, scope });
  }
  const boost = prefer ? (h: ScopedRecallHit) => (prefer.has(h.scope) ? 1 : 0) : () => 0;
  hits.sort((a, b) =>
    b.score - a.score ||
    boost(b) - boost(a) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.recordId.localeCompare(b.recordId));
  return hits.slice(0, limit);
}

/** Count of live (non-forgotten) records — the "growth" measure the organism proves increases over time. */
export function liveMemoryCount(records: readonly MemoryRecordV1[], forgotten: ReadonlySet<string> = new Set()): number {
  let n = 0;
  for (const r of records) if (!forgotten.has(r.recordId)) n += 1;
  return n;
}
