import { classifyScope } from './scope.js';
/** Deterministic keyword score: term hits, higher for exact/earlier matches. No randomness. */
function scoreOf(content, term) {
    if (term.length === 0)
        return 1;
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
    return Number.isInteger(limit) && limit > 0 ? limit : 20;
}
/**
 * DEFAULT recall (contract v1) — excludes any recordId in `forgotten`. Deterministic: score desc, then createdAt
 * asc, then recordId asc — stable regardless of input order. A forgotten record is invisible and its content is
 * never surfaced (governed forgetting at read time). The result hit shape is byte-for-byte the pre-#62 law:
 * `{recordId, createdAt, kind, content, score}` with NO scope field. Scope classification is never even computed
 * here, so old callers, receipts and hashes over a serialized hit are provably unaffected.
 */
export function recall(records, query, forgotten = new Set()) {
    const term = query.text ?? '';
    const limit = limitOf(query.limit);
    const hits = [];
    for (const r of records) {
        if (forgotten.has(r.recordId))
            continue; // forgotten: never recalled
        if (query.kind !== undefined && r.kind !== query.kind)
            continue;
        const score = scoreOf(r.content, term);
        if (term.length > 0 && score === 0)
            continue;
        hits.push({ recordId: r.recordId, createdAt: r.createdAt, kind: r.kind, content: r.content, score });
    }
    hits.sort((a, b) => b.score - a.score ||
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
export function recallScoped(records, query, forgotten = new Set()) {
    const term = query.text ?? '';
    const limit = limitOf(query.limit);
    const include = query.scopes && query.scopes.length ? new Set(query.scopes) : null;
    const exclude = query.excludeScopes && query.excludeScopes.length ? new Set(query.excludeScopes) : null;
    const prefer = query.preferScopes && query.preferScopes.length ? new Set(query.preferScopes) : null;
    const hits = [];
    for (const r of records) {
        if (forgotten.has(r.recordId))
            continue; // forgotten: never recalled
        if (query.kind !== undefined && r.kind !== query.kind)
            continue;
        const score = scoreOf(r.content, term);
        if (term.length > 0 && score === 0)
            continue;
        const scope = classifyScope(r);
        if (include && !include.has(scope))
            continue;
        if (exclude && exclude.has(scope))
            continue;
        hits.push({ recordId: r.recordId, createdAt: r.createdAt, kind: r.kind, content: r.content, score, scope });
    }
    const boost = prefer ? (h) => (prefer.has(h.scope) ? 1 : 0) : () => 0;
    hits.sort((a, b) => b.score - a.score ||
        boost(b) - boost(a) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.recordId.localeCompare(b.recordId));
    return hits.slice(0, limit);
}
/** Count of live (non-forgotten) records — the "growth" measure the organism proves increases over time. */
export function liveMemoryCount(records, forgotten = new Set()) {
    let n = 0;
    for (const r of records)
        if (!forgotten.has(r.recordId))
            n += 1;
    return n;
}
