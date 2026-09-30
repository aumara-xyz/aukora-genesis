// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Upstream: aumara-xyz/aukora-phi core/memory/recall.ts
// Commit: a099901ad5a2d623c5343263de6ae5f9994d3159
// SHA-256: vendor/aukora-governed-recall/PROVENANCE.json#/files/15/sha256
// Subtractive JavaScript port: selected function bodies; TypeScript types erased.

import { classifyScope } from './scope.mjs';

function scoreOf(content, term) {
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

function limitOf(limit) {
  return Number.isInteger(limit) && (limit) > 0 ? (limit) : 20;
}

export function recallScoped(
  records,
  query,
  forgotten = new Set(),
) {
  const term = query.text ?? '';
  const limit = limitOf(query.limit);
  const include = query.scopes && query.scopes.length ? new Set(query.scopes) : null;
  const exclude = query.excludeScopes && query.excludeScopes.length ? new Set(query.excludeScopes) : null;
  const prefer = query.preferScopes && query.preferScopes.length ? new Set(query.preferScopes) : null;
  const hits = [];
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
  const boost = prefer ? (h) => (prefer.has(h.scope) ? 1 : 0) : () => 0;
  hits.sort((a, b) =>
    b.score - a.score ||
    boost(b) - boost(a) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.recordId.localeCompare(b.recordId));
  return hits.slice(0, limit);
}
