// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * R5b step 4 — THE CUTOVER. The ONE recall-source router for the fuzzy lanes (voiceLane ×2,
 * presenceLane).
 *
 * Law of this module (docs/R5_RECALL_STATUS.md; owner-directed 2026-07-07 on the strength of
 * the committed benchmark verdict docs/R5B_BASELINE_20260708.md, ratified by merge review):
 *   - The DEFAULT fuzzy recall source is the governed CONVEX brain (search under aumlokMemSearch
 *     PoP → integrity-checked point reads). One brain; every door on a node reads it.
 *   - The legacy Kira JSON brain is ARCHIVED. It is never read by default. The ONLY way it
 *     serves recall is the node owner setting AUKORA_RECALL_SOURCE=kira-json-legacy in the start
 *     env — the migration escape hatch for nodes whose atoms have not yet run the M4 ceremony
 *     into Convex. Remove the env after migrating; the hatch is scheduled for deletion once
 *     every node has migrated.
 *   - When the governed path refuses (backend down, custody, kernel refusal, no root), the turn
 *     is served with NO memory — hits: [] — and the refusal is LOUD (console + recallSourceStatus
 *     for the truth card). The legacy file is NEVER a silent fallback: an honest empty recall
 *     beats a stale shadow brain. Never crash, never hallucinate, never silently degrade.
 *   - Hits carry only what the recall frame needs ({citation, supportQuote}); values pass through
 *     the same #53 frame hardening downstream (frameGuard.buildRecallFrame).
 *   - Recall grants nothing. advisoryOnly semantics are inherited from both underlying clients.
 *
 * The governed path is lazy-loaded from scripts/memoryRecallAdapter (the shadowCapture precedent:
 * spatial/ imports the convex-touching adapter only at first use, keeping module load side-effect
 * free and core/ convex-free).
 */
import type { RecallHit } from './frameGuard';
import { readCoreReceiptStamp, type ConsentScope } from '../core/src/coreMemoryEnvelope';

export type RecallSourceName = 'convex' | 'kira-json-legacy';

/** ONE CORE MEMORY (#45/#244) — the owner's cross-thread recall switch. Default ON (one mind,
 *  many doors: governed rows from any session may inform any other). The exact owner-set env
 *  `AUKORA_CROSS_THREAD_RECALL=0` disables it: rows that IDENTIFY a different thread are then
 *  excluded from recall. DISCLOSED LIMIT: rows written before the core receipt stamp carry no
 *  thread identity and cannot be classified — they keep serving under the switch (excluding them
 *  would silently erase all pre-stamp memory, a wipe, not a gate). `thread-private` scoped rows
 *  are excluded from other threads REGARDLESS of this switch (consent law, fail-closed). */
export function crossThreadRecallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUKORA_CROSS_THREAD_RECALL !== '0';
}

/** The admission law for one verified hit given the calling surface's thread. Pure; exported for
 *  tests. Selection happens BEFORE display ranking; stored bytes are untouched. */
export function admitRecallHit(
  meta: { thread?: string; scope?: ConsentScope },
  callerThread: string | undefined,
  crossThreadOn: boolean,
): boolean {
  const sameThread = meta.thread !== undefined && callerThread !== undefined && meta.thread === callerThread;
  // Consent law first: a thread-private row serves ONLY its own thread — fail-closed when the
  // caller cannot identify its thread, and independent of the owner switch.
  if (meta.scope === 'thread-private') return sameThread;
  // Owner switch: cross-thread recall off → any row identifying a DIFFERENT thread is excluded.
  if (!crossThreadOn && meta.thread !== undefined && !sameThread) return false;
  return true;
}

/** The recall source, read fresh per call. DEFAULT: 'convex' — the one brain. Only the exact
 *  owner-set env value 'kira-json-legacy' serves the archived JSON brain (un-migrated nodes). */
export function recallSourceFlag(env: NodeJS.ProcessEnv = process.env): RecallSourceName {
  return env.AUKORA_RECALL_SOURCE === 'kira-json-legacy' ? 'kira-json-legacy' : 'convex';
}

/** Honest status for truth surfaces (/api/brain): the source in force, the last governed-path
 *  refusal if one occurred (cleared by the next governed success), the cross-thread switch in
 *  force, and how many hits the thread-scope law has withheld this process — never a silent cap. */
let lastConvexRefusal: { at: number; error: string } | null = null;
let crossThreadExcludedTotal = 0;
export function recallSourceStatus(env: NodeJS.ProcessEnv = process.env): {
  flag: RecallSourceName;
  lastConvexRefusal: { at: number; error: string } | null;
  crossThreadRecall: 'on' | 'off';
  crossThreadExcludedTotal: number;
} {
  return {
    flag: recallSourceFlag(env),
    lastConvexRefusal,
    crossThreadRecall: crossThreadRecallEnabled(env) ? 'on' : 'off',
    crossThreadExcludedTotal,
  };
}

// Legacy-hatch only: 30s-cached JSON brain load (kept for un-migrated nodes; delete with the hatch).
let kiraCache: { at: number; path: string; state: unknown } | null = null;

async function kiraLegacyRecallHits(input: string, k: number): Promise<RecallHit[]> {
  const kira = await import('../core/src/kiraBrain');
  const statePath = kira.defaultKiraStatePath();
  if (!kiraCache || kiraCache.path !== statePath || Date.now() - kiraCache.at > 30_000) {
    kiraCache = { at: Date.now(), path: statePath, state: kira.loadBrainState(statePath) };
  }
  return kira.recall(kiraCache.state as never, input, k).hits;
}

/** Governed rows store typed JSON envelopes (M4 migration rows wrap the original atom;
 *  turn-summary capture rows wrap digests). The recall frame wants the HUMAN text, not envelope
 *  braces — surface the atom's text when the envelope shape is recognized, else the raw value.
 *  Display-only: the stored bytes are untouched and integrity-checked upstream. */
export function governedValueExcerpt(value: string): string {
  return governedValueMeta(value).text;
}

/** Typed-envelope reader for display: the human text plus the envelope's own provenance facts
 *  (schema + timestamp + door origin) when the shape is recognized. Display-only; stored bytes
 *  untouched; anything unrecognized is honestly null/absent, never guessed. The `origin` key is
 *  included ONLY when the envelope carries a valid door slug — old rows read as door-unknown.
 *  Since the one-core-memory round (#45/#244), a row may additionally carry a core receipt stamp;
 *  its thread / consent scope / core-instance id surface here the same way — conditional keys,
 *  re-validated by readCoreReceiptStamp (untrusted-input discipline), absent on old rows. */
export function governedValueMeta(value: string): {
  text: string;
  schema: string | null;
  at: string | null;
  origin?: string;
  thread?: string;
  scope?: ConsentScope;
  coreInstanceId?: string;
} {
  try {
    const parsed = JSON.parse(value) as { schema?: unknown; at?: unknown; origin?: unknown; core?: unknown; atom?: { text?: unknown; createdAt?: unknown }; recentTurn?: { text?: unknown }; atoms?: Array<{ text?: unknown }> };
    const schema = typeof parsed.schema === 'string' && parsed.schema.length > 0 && parsed.schema.length <= 60 ? parsed.schema : null;
    const at = typeof parsed.at === 'string' && parsed.at.length <= 40
      ? parsed.at
      : typeof parsed.atom?.createdAt === 'string' && parsed.atom.createdAt.length <= 40
        ? parsed.atom.createdAt
        : null;
    // Door tag (additive, untrusted-input discipline): same slug law as the writer, re-enforced on read.
    const origin = typeof parsed.origin === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(parsed.origin) ? parsed.origin : undefined;
    // Core receipt stamp (additive): re-validated field-by-field; an invalid block reads as absent.
    const stamp = readCoreReceiptStamp(parsed.core);
    const door = {
      ...(origin ? { origin } : {}),
      ...(stamp?.thread ? { thread: stamp.thread } : {}),
      ...(stamp ? { scope: stamp.scope, coreInstanceId: stamp.coreInstanceId } : {}),
    };
    if (parsed && typeof parsed.atom?.text === 'string' && parsed.atom.text.length > 0) {
      return { text: parsed.atom.text, schema: schema ?? 'migrated-atom', at, ...door };
    }
    // turn-summary recent-turn digest: the compact role-labeled owner+auma line is the preferred
    // display text — built upstream only from already-admitted distilled atoms. Display-only.
    if (parsed && typeof parsed.recentTurn?.text === 'string' && parsed.recentTurn.text.length > 0) {
      return { text: parsed.recentTurn.text, schema, at, ...door };
    }
    // canon-atom-v1 (#62) and any future flat envelope: the human text is the top-level `text`.
    if (typeof (parsed as { text?: unknown }).text === 'string' && ((parsed as { text: string }).text.length > 0)) {
      return { text: (parsed as { text: string }).text, schema, at, ...door };
    }
    if (Array.isArray(parsed?.atoms)) {
      const texts = parsed.atoms.map((a) => (typeof a?.text === 'string' ? a.text : '')).filter(Boolean);
      if (texts.length > 0) return { text: texts.join(' · '), schema, at, ...door };
    }
    // A validated identity (stamp or door slug) must survive even when no schema/at/text shape is
    // recognized — otherwise a stamp-only envelope would lose its thread/scope and a thread-private
    // row would slip the admission law (review round finding; fail-closed on read).
    if (schema || at || origin || stamp) return { text: value, schema, at, ...door };
  } catch { /* not JSON — the raw value IS the text */ }
  return { text: value, schema: null, at: null };
}

/** Age rendering per the #178 focus-row contract's reader rules: printed on EVERY read, and an
 *  unresolvable age is SAID ("age unknown"), never omitted. Falls back to the timestamp most
 *  governed keys embed (`turn.<compact-ts>.<seq>` / `focus.<compact-ts>.<seq>`). */
export function ageLabel(atIso: string | null, key: string, nowMs: number): string {
  const ts = resolveHitTimestampMs(atIso, key);
  if (ts === null) return 'age unknown';
  const mins = Math.max(0, Math.round((nowMs - ts) / 60_000));
  if (mins < 60) return `${mins}m old`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h old`;
  return `${Math.round(mins / (60 * 24))}d old`;
}

/** Coarse, HONEST recency tiers for a recalled row — derived from the SAME resolved timestamp
 *  ageLabel and the re-rank already use (envelope `at`, else the key's embedded compact-ts). No new
 *  clock, no new capture, no ranking change: it only NAMES how recent an already-ranked row is so the
 *  seat can say "from earlier this session" instead of implying memory it does not have. `this-session`
 *  is an explicit elapsed-time heuristic, not a true session boundary, so it never claims more than time
 *  says. An unresolvable timestamp is `unknown`, never guessed — same discipline as ageLabel's "age
 *  unknown". A timestamp in the future beyond one turn is treated as clock skew we won't interpret. */
export type RecencyTier = 'this-turn' | 'this-session' | 'older' | 'unknown';
export const RECENCY_THIS_TURN_MS = 2 * 60_000; // ~this exchange
export const RECENCY_THIS_SESSION_MS = 30 * 60_000; // heuristic session window
export function deriveRecencyTier(tsMs: number | null, nowMs: number): { recencyTier: RecencyTier; ageMs: number | null } {
  if (tsMs === null || !Number.isFinite(tsMs)) return { recencyTier: 'unknown', ageMs: null };
  const ageMs = nowMs - tsMs;
  if (ageMs < -RECENCY_THIS_TURN_MS) return { recencyTier: 'unknown', ageMs }; // future beyond a turn = skew; don't claim
  const age = Math.max(0, ageMs);
  const recencyTier: RecencyTier =
    age <= RECENCY_THIS_TURN_MS ? 'this-turn' : age <= RECENCY_THIS_SESSION_MS ? 'this-session' : 'older';
  return { recencyTier, ageMs };
}

const TRACE_TERM_RE = /[a-z0-9]{3,}/g;

/** Timestamp resolution shared by ageLabel and the recency re-rank: the envelope's `at` when
 *  present, else the timestamp most governed keys embed (`turn.<compact-ts>.<seq>` etc.).
 *  Honestly null when neither resolves — an unknown age earns NO recency bonus, never a guess. */
export function resolveHitTimestampMs(atIso: string | null, key: string): number | null {
  let ts = atIso ? Date.parse(atIso) : NaN;
  if (!Number.isFinite(ts)) {
    const m = /^[a-z]+\.(\d{8})t(\d{2})(\d{2})(\d{2})/.exec(key);
    if (m) ts = Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2]}:${m[3]}:${m[4]}Z`);
  }
  return Number.isFinite(ts) ? ts : null;
}

/** Stopword-grade terms carry no retrieval signal — the live memory test showed 8-day-old
 *  migration atoms surfacing on exactly these. Deliberately small and conservative: a missed
 *  stopword only weakens the recency bias slightly; an over-broad list would erase real signal. */
const RECALL_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'that', 'this', 'have', 'has', 'had', 'was', 'were',
  'are', 'not', 'but', 'all', 'can', 'will', 'would', 'could', 'should', 'what', 'when', 'where',
  'which', 'who', 'how', 'why', 'about', 'from', 'they', 'them', 'then', 'than', 'there', 'here',
  'just', 'like', 'into', 'over', 'also', 'she', 'her', 'his', 'him', 'its', 'our', 'out', 'one',
  'did', 'does', 'get', 'got', 'yes', 'okay', 'well',
]);

/** The informative (non-stopword) index terms of a text, lowercased. Rank/display-side only. */
export function informativeTerms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(TRACE_TERM_RE) ?? []).filter((t) => !RECALL_STOPWORDS.has(t)));
}

/** Deterministic display-rank score for one verified hit: informative-term overlap (weight 2)
 *  plus a recency bonus decaying with age (1.0 now → 0.5 at 1 day → ~0.11 at 8 days). A hit
 *  matching only stopwords scores overlap 0, so a fresh recent-turn row beats an old migration
 *  atom; when overlap ties, newer wins. Pure — same inputs, same score. Exported for tests. */
export function recencyRelevanceScore(query: string, text: string, atIso: string | null, key: string, nowMs: number): number {
  const queryTerms = informativeTerms(query);
  const textTerms = informativeTerms(text);
  let shared = 0;
  for (const t of queryTerms) if (textTerms.has(t)) shared++;
  const overlap = queryTerms.size > 0 ? shared / queryTerms.size : 0;
  const ts = resolveHitTimestampMs(atIso, key);
  const recency = ts === null ? 0 : 1 / (1 + Math.max(0, nowMs - ts) / 86_400_000);
  return overlap * 2 + recency;
}

/** The why-trace for one governed hit — the cutover's lost limb restored, display-only:
 *  kernel rank + which query terms the served text actually shares (client-derived and labeled as
 *  such by wording: "matched", a fact about the text, not a kernel attestation) + provenance FUSED
 *  (schema + row key ride the same line) + age on every read. Truthful absences: no shared terms
 *  reads "no direct term overlap"; no envelope facts read "raw row" / "age unknown". */
export function governedWhyTrace(
  hit: { key: string; rank: number },
  meta: { text: string; schema: string | null; at: string | null; origin?: string; thread?: string },
  query: string,
  nowMs: number,
): string {
  // Display the SAME informative (stopword-filtered) overlap the re-ranker scores on — not raw tokens.
  // Otherwise a stopword-only overlap ("why"/"and"/"how") still prints as "matched …" while the ranker
  // treats it as no signal (regression after dee7060; the display drifted from informativeTerms).
  const queryTerms = informativeTerms(query);
  const textTerms = informativeTerms(meta.text);
  const shared = [...queryTerms].filter((t) => textTerms.has(t)).slice(0, 4);
  const matched = shared.length ? `matched ${shared.map((t) => `"${t}"`).join(', ')}` : 'no direct term overlap (index rank only)';
  const source = meta.schema ?? 'raw row';
  // Cross-thread citation (#45/#244): a row that knows its door/thread SAYS so on every read, so a
  // memory recalled from another session is never presented as if it came from this one. Old rows
  // carry no identity and the line stays byte-identical to before — honest absence, never guessed.
  const via = meta.origin || meta.thread
    ? ` · via ${meta.origin ?? 'door-unknown'}${meta.thread ? ` ${meta.thread}` : ''}`
    : '';
  return `#${hit.rank} by index · ${matched} · from ${source} ${hit.key}${via} · ${ageLabel(meta.at, hit.key, nowMs)}`;
}

/** The calling surface's identity for admission decisions (#45/#244) — thread only: origin
 *  citation always comes from the ROW, never from who is asking. */
export type RecallCaller = { thread?: string };

/** The ONE CORE MEMORY admission + display-rank step (#45/#244), pure and exported for tests:
 *  thread-private rows serve only their own thread; with the owner switch off, rows identifying
 *  another thread are excluded. Then the existing client-side DISPLAY re-rank (recency +
 *  informative-term overlap; the kernel's index rank stays verbatim in each why-trace), capped at
 *  k. Deterministic; read-only — stored bytes untouched. */
export function rankAdmittedGovernedHits(
  raw: Array<{ key: string; value: string; citation: string; rank: number }>,
  input: string,
  callerThread: string | undefined,
  crossThreadOn: boolean,
  now: number,
  k: number,
): { hits: RecallHit[]; excluded: number } {
  const verified = raw.map((h, order) => ({ h, meta: governedValueMeta(h.value), order }));
  const admitted = verified.filter(({ meta }) => admitRecallHit(meta, callerThread, crossThreadOn));
  const excluded = verified.length - admitted.length;
  const scored = admitted.map(({ h, meta, order }) => {
    return { h, meta, order, score: recencyRelevanceScore(input, meta.text, meta.at, h.key, now) };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  // supportQuote-sized excerpt; the frame layer re-neutralizes and re-truncates downstream.
  const hits = scored.slice(0, Math.max(0, k)).map(({ h, meta }) => ({
    citation: h.citation,
    supportQuote: meta.text.replace(/\s+/g, ' ').slice(0, 280),
    trace: governedWhyTrace(h, meta, input, now),
  }));
  return { hits, excluded };
}

/** The adapter's signed query road, injectable ONLY so tests can drive the REAL admission +
 *  starvation-guard code below with stub rows (the coarser `convexImpl` seam replaces this whole
 *  function, so the guard never runs under it). Production callers pass nothing. */
export type ConvexQueryImpl = (input: string, k: number) => Promise<
  { ok: true; hits: Array<{ key: string; value: string; citation: string; rank: number }> } | { ok: false; error: string }
>;

async function convexRecallHits(input: string, k: number, caller?: RecallCaller, queryImpl?: ConvexQueryImpl): Promise<RecallHit[]> {
  const query: ConvexQueryImpl = queryImpl ?? (async (i, kk) => {
    const adapter = await import('../scripts/memoryRecallAdapter');
    return adapter.convexRecallByQuery(i, kk);
  });
  const res = await query(input, k);
  if (!res.ok) throw new Error(res.error);
  const now = Date.now();
  const crossThreadOn = crossThreadRecallEnabled();
  let picked = rankAdmittedGovernedHits(res.hits, input, caller?.thread, crossThreadOn, now, k);
  // Starvation guard (review round): an admission exclusion inside the kernel's top-k must not
  // serve an empty turn while admissible rows exist deeper — over-fetch ONCE (kernel cap 20) and
  // re-admit. A failed wide fetch keeps the first (already valid) pass; never throws over width.
  if (picked.excluded > 0) {
    try {
      const wide = await query(input, Math.min(20, Math.max(k * 3, k + picked.excluded)));
      if (wide.ok) picked = rankAdmittedGovernedHits(wide.hits, input, caller?.thread, crossThreadOn, now, k);
    } catch { /* width is best-effort; the narrow pass already answered lawfully */ }
  }
  if (picked.excluded > 0) {
    crossThreadExcludedTotal += picked.excluded;
    console.error(`[recall] ${picked.excluded} governed hit(s) withheld this turn by the thread-scope law (cross-thread recall ${crossThreadOn ? 'on; thread-private row(s) from another thread' : 'OFF (AUKORA_CROSS_THREAD_RECALL=0)'}).`);
  }
  return picked.hits;
}

export type FuzzyRecallDeps = {
  flag?: RecallSourceName;
  /** The calling surface's thread id (admission law input). Absent = an unidentified caller:
   *  thread-private rows then never serve, and with the switch off no thread-identified row does. */
  caller?: RecallCaller;
  convexImpl?: (input: string, k: number, caller?: RecallCaller) => Promise<RecallHit[]>;
  /** Deeper seam than convexImpl: stubs ONLY the adapter query so the real admission +
   *  starvation-guard path runs (see ConvexQueryImpl). Ignored when convexImpl is set. */
  convexQueryImpl?: ConvexQueryImpl;
  kiraLegacyImpl?: (input: string, k: number) => Promise<RecallHit[]>;
};

export type FuzzyRecallResult = {
  hits: RecallHit[];
  source: RecallSourceName; // the source that actually served THIS result
  refused: string | null; // set when the governed path refused and the turn served EMPTY (never legacy)
};

/** The lanes' single fuzzy-recall entry point. Default path never throws on a governed refusal —
 *  it serves an honest empty recall and reports. The legacy hatch may throw (no brain file), which
 *  the lanes' existing catch-and-continue handles, unchanged. */
export async function fuzzyRecallHits(input: string, k: number, deps: FuzzyRecallDeps = {}): Promise<FuzzyRecallResult> {
  const flag = deps.flag ?? recallSourceFlag();
  if (flag === 'kira-json-legacy') {
    // Explicit owner-set migration hatch. Labeled legacy everywhere it surfaces.
    return { hits: await (deps.kiraLegacyImpl ?? kiraLegacyRecallHits)(input, k), source: 'kira-json-legacy', refused: null };
  }
  try {
    const hits = await (deps.convexImpl
      ?? ((i: string, kk: number, c?: RecallCaller) => convexRecallHits(i, kk, c, deps.convexQueryImpl)))(input, k, deps.caller);
    lastConvexRefusal = null;
    return { hits, source: 'convex', refused: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    lastConvexRefusal = { at: Date.now(), error };
    // Loud by law — and NO silent legacy read: an honest empty recall beats a stale shadow brain.
    console.error(`[recall] the governed Convex brain refused this turn (${error}) — serving the turn with NO recalled memory. The archived JSON brain is not consulted (legacy hatch only, AUKORA_RECALL_SOURCE=kira-json-legacy).`);
    return { hits: [], source: 'convex', refused: error };
  }
}

export function recallSourceGrantsAuthority(): false { return false; }
