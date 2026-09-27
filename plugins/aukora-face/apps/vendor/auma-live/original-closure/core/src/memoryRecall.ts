// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Brick R5 (read side, FOUNDATION) — the client that reads a migrated memory back from the live Convex
 * brain by KEY, under the owner root's proof-of-possession. This is the mirror of the M4 ceremony's
 * recall: custody-checked owner seed → sign the recall head under the `aumlokMemRecall` domain → one
 * loopback POST to `aumlokMemory:aumlokMemoryRecall` → typed envelope. Loopback-only, key never logged.
 *
 * HONEST SCOPE — read this before wiring it into a lane:
 *   - recallMemoryByKey is a KEYED POINT READ (owner root id + exact key). Since the R5b bricks the
 *     kernel ALSO carries a `search_value` index + `aumlokMemorySearch`, and this module composes the
 *     two as `recallMemoriesByQuery` (fuzzy recall: search keys, then integrity-checked point reads) —
 *     the DEFAULT lane recall source since the step-4 cutover (spatial/recallSource.ts routes; see
 *     docs/R5_RECALL_STATUS.md and the benchmark verdict docs/R5B_BASELINE_20260708.md).
 *   - The archived Kira JSON brain serves only under the explicit kira-json-legacy hatch on nodes
 *     that have not run the M4 migration yet.
 *   - Reads carry NO authority (advisoryOnly). A recall grants nothing; it returns stored advisory text.
 *
 * The signing key is the OWNER ROOT seed at ~/.aukora-symbiote/convex/memory-root.seed (0600 custody),
 * the same pen the M4 genesis used. Custody is checked at USE time and failures are LOUD + typed.
 *
 * DEPENDENCY BOUNDARY: this module lives in core/ and is typechecked in isolation (the sandbox runner
 * typechecks core/ alone). It therefore does NOT import from convex/ — pulling the kernel's own deps into
 * a core-scoped tsc would break the sandbox typecheck. Instead the reader-signature producer is INJECTED
 * (`RecallSigner`), exactly as memoryKernelTransport injects its executor. The real signer — built from
 * the kernel's own `recallHead` + `signChainHeadV3` so a client signature can never drift from what the
 * kernel verifies — is supplied at the edge (a scripts/ ceremony or an R5b lane adapter that CAN import
 * convex). Tests inject a trivial signer.
 */
import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isLoopbackUrl } from './convexBrainReadonly';
import { verifyWindowsKeyFileCustody, WindowsCustodyError, type WindowsCustodyOptions } from './windowsKeyCustody';

/** Produces the reader PoP signature over a recall request, under the `aumlokMemRecall` domain. Injected
 *  so core/ carries no convex import; the edge builds the real one from the kernel's signer + owner seed. */
export type RecallSigner = (req: { v: number; ownerRootId: string; key: string; readerPrincipalId: string; timestamp: number }) => Promise<string>;

export const MEMORY_ROOT_SEED_PATH = join(homedir(), '.aukora-symbiote', 'convex', 'memory-root.seed');
export const DEFAULT_BRAIN_URL = 'http://127.0.0.1:3210';
const RECALL_FRESHNESS_MS = 60_000; // mirror of the kernel's window; we stamp fresh per call
const MAX_RESPONSE_BYTES = 1_048_576;

export class MemoryRecallError extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'MemoryRecallError'; }
}
const fail = (code: string, message: string): never => { throw new MemoryRecallError(code, message); };

/** Strict custody read of the owner root seed — regular file, no symlink, tight custody, 64-hex.
 *  LOUD + typed on every violation (never a silent fallback to an unsigned or wrong-key read).
 *  Custody law per platform: POSIX mode bits on Mac/Linux (UNCHANGED); on Windows — where bun/node
 *  fabricate mode 0666 for every writable file, so mode bits certify nothing — the native ACL
 *  allowlist is verified instead (core/src/windowsKeyCustody.ts, fail-closed). */
export function readOwnerSeedStrict(
  seedPath: string = MEMORY_ROOT_SEED_PATH,
  custody: { platform?: NodeJS.Platform; windows?: WindowsCustodyOptions } = {},
): string {
  let st;
  try { st = lstatSync(seedPath); } catch { return fail('owner_seed_missing', `no owner root seed at ${seedPath} — the brain is not provisioned for recall (bun scripts/captureSubjectAdapter.ts provision)`); }
  if (st.isSymbolicLink()) return fail('owner_seed_symlink_refused', `${seedPath} is a symlink; the seed must be a regular file`);
  if (!st.isFile()) return fail('owner_seed_not_regular_file', `${seedPath} is not a regular file`);
  if ((custody.platform ?? process.platform) === 'win32') {
    try {
      verifyWindowsKeyFileCustody(seedPath, custody.windows);
    } catch (e) {
      const code = e instanceof WindowsCustodyError ? e.code : 'windows_custody_failed';
      return fail(`owner_seed_${code}`, e instanceof Error ? e.message : String(e));
    }
  } else if ((st.mode & 0o077) !== 0) return fail('owner_seed_permissions_open', `${seedPath} is group/world accessible (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it`);
  const raw = readFileSync(seedPath, 'utf-8').trim();
  if (!/^[0-9a-f]{64}$/i.test(raw)) return fail('owner_seed_malformed', `${seedPath} must hold a single 64-hex seed on one line`);
  return raw.toLowerCase();
}

export type RecallFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const realFetch: RecallFetch = async (url, init) => {
  const resp = await fetch(url, init);
  const reader = resp.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); throw new Error(`response_too_large: > ${MAX_RESPONSE_BYTES} bytes`); }
        chunks.push(value);
      }
    }
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return { ok: resp.ok, status: resp.status, text: async () => body };
};

export type MemoryRecallConfig = {
  url?: string;
  ownerRootId: string;
  adminKeyProvider: () => string; // the admin bearer (createGovernedHttpInvoke's readAdminKeyStrict, injected)
  signRecall: RecallSigner;       // produces the reader PoP sig (built at the edge from the owner seed + kernel signer)
  timeoutMs?: number;
  fetchImpl?: RecallFetch;
};

export type MemoryRecallResult =
  | { ok: true; found: true; key: string; value: string; advisoryOnly: true; grantsAuthority: false }
  | { ok: true; found: false; key: string; reason: string; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; key: string; error: string; advisoryOnly: true; grantsAuthority: false };

/**
 * Read ONE migrated memory by exact key under owner-root PoP. Loopback-only. A missing / quarantined /
 * erased / integrity-failed row returns a typed `found:false` (never throws for those — they are honest
 * outcomes); custody or transport failures return `ok:false` with the reason. Never serves tampered bytes
 * (the kernel's own integrity preflight refuses them upstream).
 */
export async function recallMemoryByKey(key: string, cfg: MemoryRecallConfig): Promise<MemoryRecallResult> {
  const url = cfg.url ?? DEFAULT_BRAIN_URL;
  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };
  if (!isLoopbackUrl(url)) return { ok: false, key, error: 'recall refuses a non-loopback backend URL (local-only by law)', ...advisory };
  let adminKey: string;
  try {
    adminKey = cfg.adminKeyProvider();
  } catch (e) {
    return { ok: false, key, error: e instanceof Error ? e.message : String(e), ...advisory };
  }
  const req = { v: 1, ownerRootId: cfg.ownerRootId, key, readerPrincipalId: cfg.ownerRootId, timestamp: Date.now() };
  void RECALL_FRESHNESS_MS; // documented invariant: timestamp is stamped fresh above, inside the kernel window
  let readerSig: string;
  try {
    readerSig = await cfg.signRecall(req);
  } catch (e) {
    return { ok: false, key, error: `could not sign recall head: ${e instanceof Error ? e.message : String(e)}`, ...advisory };
  }
  const fetchImpl = cfg.fetchImpl ?? realFetch;
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
      body: JSON.stringify({ path: 'aumlokMemory:aumlokMemoryRecall', args: { req, readerSig }, format: 'json' }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });
  } catch (e) {
    // transport down → the CALLER decides fallback (JSON recall). We report, we do not invent a memory.
    return { ok: false, key, error: `recall transport failed: ${e instanceof Error ? e.message : String(e)}`, ...advisory };
  }
  let raw: string;
  try { raw = await res.text(); } catch (e) { return { ok: false, key, error: `reading recall body failed: ${e instanceof Error ? e.message : String(e)}`, ...advisory }; }
  if (!res.ok) return { ok: false, key, error: `backend HTTP ${res.status}: ${raw.slice(0, 200)}`, ...advisory };
  let parsed: { status?: unknown; value?: any; errorMessage?: unknown };
  try { parsed = JSON.parse(raw); } catch { return { ok: false, key, error: `malformed recall envelope: ${raw.slice(0, 160)}`, ...advisory }; }
  if (parsed.status === 'error') return { ok: false, key, error: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : 'kernel error', ...advisory };
  if (parsed.status !== 'success') return { ok: false, key, error: `unexpected recall envelope: ${raw.slice(0, 160)}`, ...advisory };
  const v = parsed.value ?? {};
  if (v.ok === true && typeof v.value === 'string') return { ok: true, found: true, key, value: v.value, ...advisory };
  // honest non-found outcomes (not_found | stale | quarantined | erased | integrity_failed | reader_pop_invalid)
  return { ok: true, found: false, key, reason: typeof v.reason === 'string' ? v.reason : 'not_found', ...advisory };
}

export function memoryRecallGrantsAuthority(): false { return false; }

// ─── R5b step 2 — recall BY QUERY (search keys, then integrity-checked point reads) ────────────────
//
// The benchmark verdict (docs/R5B_BASELINE_20260708.md) scored this exact two-hop path against
// kira.recall on the owner's real corpus — and it won. This client is the primitive behind the
// DEFAULT recall source since the R5b step-4 cutover (spatial/recallSource.ts); the archived Kira
// JSON brain serves only under the explicit kira-json-legacy hatch on un-migrated nodes.

/** Produces the reader PoP signature over a SEARCH request, under the dedicated `aumlokMemSearch`
 *  domain (query text is inside the signed preimage — a signed question cannot be substituted).
 *  Injected for the same reason as RecallSigner: core/ stays convex-free. */
export type SearchSigner = (req: { v: number; ownerRootId: string; query: string; readerPrincipalId: string; timestamp: number; limit?: number }) => Promise<string>;
export type RecentSigner = (req: { v: number; ownerRootId: string; readerPrincipalId: string; timestamp: number; limit?: number }) => Promise<string>;

export type MemorySearchConfig = {
  url?: string;
  ownerRootId: string;
  adminKeyProvider: () => string;
  signSearch: SearchSigner;
  timeoutMs?: number;
  fetchImpl?: RecallFetch;
};

export type MemorySearchResult =
  | { ok: true; keys: string[]; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; error: string; advisoryOnly: true; grantsAuthority: false };

export type MemoryRecentConfig = {
  url?: string;
  ownerRootId: string;
  adminKeyProvider: () => string;
  signRecent: RecentSigner;
  signRecall: RecallSigner;
  timeoutMs?: number;
  fetchImpl?: RecallFetch;
};

export type RecentMemoryPeekHit = {
  key: string;
  value: string;
  citation: string;
  createdAt: number;
  rank: number;
  advisoryOnly: true;
  grantsAuthority: false;
};

export type RecentMemoryPeekResult =
  | { ok: true; hits: RecentMemoryPeekHit[]; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; error: string; advisoryOnly: true; grantsAuthority: false };

/** Mirror of the kernel's hard query cap (convex/aumlokMemory.ts search validation: length ≤ 500,
 *  no control bytes). Mirrored, not imported — core stays convex-free; the test pins them equal in law. */
export const SEARCH_QUERY_MAX = 500;

/** Issue #274 — the bounded search query, derived at the adapter boundary BEFORE signing/sending.
 *  The strict kernel refuses any control byte (newlines/tabs included) and >500 chars with
 *  `aumlok_mem_search_query_invalid`, so a long or multiline owner prompt used to lose recall entirely.
 *  Here: control bytes become spaces, whitespace runs collapse, edges trim, and the result is capped
 *  code-point-safely (a cut can never send a torn surrogate half). The owner's ORIGINAL text is
 *  untouched — this derives only the query string the kernel sees; kernel validation stays exactly
 *  as strict as before and there is no fallback path. Pure; idempotent. */
export function normalizeSearchQuery(text: string): string {
  if (typeof text !== 'string') return '';
  let q = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length > SEARCH_QUERY_MAX) {
    q = q.slice(0, SEARCH_QUERY_MAX);
    const last = q.charCodeAt(q.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) q = q.slice(0, -1); // never a lone high surrogate at the cut
    q = q.trimEnd();
  }
  return q;
}

/** Ranked KEYS ONLY from `aumlokMemory:aumlokMemorySearch` (content stays behind the integrity-checked
 *  point read). Loopback-only; limit hard-clamped to the kernel's 1..20; every refusal is typed and
 *  loud — the caller decides fallback, this module never invents a memory. */
export async function searchMemoryKeys(query: string, limit: number, cfg: MemorySearchConfig): Promise<MemorySearchResult> {
  const url = cfg.url ?? DEFAULT_BRAIN_URL;
  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };
  if (!isLoopbackUrl(url)) return { ok: false, error: 'search refuses a non-loopback backend URL (local-only by law)', ...advisory };
  let adminKey: string;
  try {
    adminKey = cfg.adminKeyProvider();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ...advisory };
  }
  const req = {
    v: 1,
    ownerRootId: cfg.ownerRootId,
    // #274: the ONE bounded query — normalized BEFORE the signature below, so the signed preimage
    // covers exactly the string the kernel receives. An empty normalization still refuses at the
    // kernel (length 0), same as before — honest, no fallback.
    query: normalizeSearchQuery(query),
    readerPrincipalId: cfg.ownerRootId,
    timestamp: Date.now(),
    limit: Math.min(20, Math.max(1, Math.floor(limit))),
  };
  let readerSig: string;
  try {
    readerSig = await cfg.signSearch(req);
  } catch (e) {
    return { ok: false, error: `could not sign search head: ${e instanceof Error ? e.message : String(e)}`, ...advisory };
  }
  const fetchImpl = cfg.fetchImpl ?? realFetch;
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
      body: JSON.stringify({ path: 'aumlokMemory:aumlokMemorySearch', args: { req, readerSig }, format: 'json' }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });
  } catch (e) {
    return { ok: false, error: `search transport failed: ${e instanceof Error ? e.message : String(e)}`, ...advisory };
  }
  let raw: string;
  try { raw = await res.text(); } catch (e) { return { ok: false, error: `reading search body failed: ${e instanceof Error ? e.message : String(e)}`, ...advisory }; }
  if (!res.ok) return { ok: false, error: `backend HTTP ${res.status}: ${raw.slice(0, 200)}`, ...advisory };
  let parsed: { status?: unknown; value?: any; errorMessage?: unknown };
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: `malformed search envelope: ${raw.slice(0, 160)}`, ...advisory }; }
  if (parsed.status === 'error') return { ok: false, error: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : 'kernel error', ...advisory };
  if (parsed.status !== 'success') return { ok: false, error: `unexpected search envelope: ${raw.slice(0, 160)}`, ...advisory };
  const v = parsed.value ?? {};
  if (v.ok !== true || !Array.isArray(v.hits)) return { ok: false, error: `search refused: ${typeof v.reason === 'string' ? v.reason : 'unknown'}`, ...advisory };
  const keys = (v.hits as Array<{ key?: unknown }>).map((h) => h?.key).filter((k): k is string => typeof k === 'string');
  return { ok: true, keys, ...advisory };
}

export type RecallByQueryHit = {
  key: string;
  value: string;
  citation: string;
  /** 1-based position in the kernel's relevance order — the raw fact a why-trace reports. Display
   *  metadata only: it never changes which keys are read or how they are ordered. */
  rank: number;
  advisoryOnly: true;
  grantsAuthority: false;
};

export type RecallByQueryResult =
  | { ok: true; hits: RecallByQueryHit[]; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; error: string; advisoryOnly: true; grantsAuthority: false };

/**
 * Fuzzy recall from the governed brain: search for ranked keys, then read each key back through the
 * integrity-checked point read. A key that comes back found:false (erased/quarantined/raced) is
 * SKIPPED honestly — never padded, never guessed. Any transport/custody failure returns ok:false so
 * the caller can fall back to the frozen JSON brain; this module reports, it does not decide.
 */
export async function recallMemoriesByQuery(
  query: string,
  k: number,
  cfg: MemorySearchConfig & { signRecall: RecallSigner },
): Promise<RecallByQueryResult> {
  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };
  const searched = await searchMemoryKeys(query, k, cfg);
  if (!searched.ok) return { ok: false, error: searched.error, ...advisory };
  const hits: RecallByQueryHit[] = [];
  const keys = searched.keys.slice(0, Math.min(20, Math.max(1, Math.floor(k))));
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const read = await recallMemoryByKey(key, cfg);
    if (!read.ok) return { ok: false, error: `point read failed at ${key}: ${read.error}`, ...advisory };
    if (!read.found) continue; // honest absence (erased/quarantined since indexing) — skip, never fake
    // rank = the kernel's 1-based relevance position (skips preserve it: a missing #2 leaves #3 as #3).
    hits.push({ key, value: read.value, citation: `convex:mem:${cfg.ownerRootId}:${key}`, rank: i + 1, ...advisory });
  }
  return { ok: true, hits, ...advisory };
}

export type RecentMemoryKeysResult =
  | { ok: true; hits: Array<{ key: string; createdAt: number }>; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; error: string; advisoryOnly: true; grantsAuthority: false };

/** Newest-first KEYS ONLY from `aumlokMemory:aumlokMemoryRecent` (owner-root only, metadata only). This
 *  is the observability road for the seat's memory_peek tool: it proves what the local governed brain
 *  recently captured without creating a second content-serving kernel seam. Content still comes back
 *  through recallMemoryByKey below. */
export async function recentMemoryKeys(limit: number, cfg: Omit<MemoryRecentConfig, 'signRecall'>): Promise<RecentMemoryKeysResult> {
  const url = cfg.url ?? DEFAULT_BRAIN_URL;
  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };
  if (!isLoopbackUrl(url)) return { ok: false, error: 'recent-memory peek refuses a non-loopback backend URL (local-only by law)', ...advisory };
  let adminKey: string;
  try {
    adminKey = cfg.adminKeyProvider();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ...advisory };
  }
  const req = {
    v: 1,
    ownerRootId: cfg.ownerRootId,
    readerPrincipalId: cfg.ownerRootId,
    timestamp: Date.now(),
    limit: Math.min(8, Math.max(1, Math.floor(limit))),
  };
  let readerSig: string;
  try {
    readerSig = await cfg.signRecent(req);
  } catch (e) {
    return { ok: false, error: `could not sign recent-memory head: ${e instanceof Error ? e.message : String(e)}`, ...advisory };
  }
  const fetchImpl = cfg.fetchImpl ?? realFetch;
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
      body: JSON.stringify({ path: 'aumlokMemory:aumlokMemoryRecent', args: { req, readerSig }, format: 'json' }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });
  } catch (e) {
    return { ok: false, error: `recent-memory transport failed: ${e instanceof Error ? e.message : String(e)}`, ...advisory };
  }
  let raw: string;
  try { raw = await res.text(); } catch (e) { return { ok: false, error: `reading recent-memory body failed: ${e instanceof Error ? e.message : String(e)}`, ...advisory }; }
  if (!res.ok) return { ok: false, error: `backend HTTP ${res.status}: ${raw.slice(0, 200)}`, ...advisory };
  let parsed: { status?: unknown; value?: any; errorMessage?: unknown };
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: `malformed recent-memory envelope: ${raw.slice(0, 160)}`, ...advisory }; }
  if (parsed.status === 'error') return { ok: false, error: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : 'kernel error', ...advisory };
  if (parsed.status !== 'success') return { ok: false, error: `unexpected recent-memory envelope: ${raw.slice(0, 160)}`, ...advisory };
  const v = parsed.value ?? {};
  if (v.ok !== true || !Array.isArray(v.hits)) return { ok: false, error: `recent-memory refused: ${typeof v.reason === 'string' ? v.reason : 'unknown'}`, ...advisory };
  const hits = (v.hits as Array<{ key?: unknown; createdAt?: unknown }>)
    .filter((h) => typeof h?.key === 'string')
    .map((h) => ({ key: h.key as string, createdAt: Number.isFinite(h?.createdAt) ? Number(h.createdAt) : 0 }));
  return { ok: true, hits, ...advisory };
}

/** Recent-memory observability: newest keys first from the governed brain, then integrity-checked point
 *  reads for each key. Honest absences are skipped (erased/quarantined/raced), never padded or guessed.
 *  This is the seat's "show me the last N captured rows" primitive. */
export async function peekRecentMemories(limit: number, cfg: MemoryRecentConfig): Promise<RecentMemoryPeekResult> {
  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };
  const recent = await recentMemoryKeys(limit, cfg);
  if (!recent.ok) return { ok: false, error: recent.error, ...advisory };
  const hits: RecentMemoryPeekHit[] = [];
  for (let i = 0; i < recent.hits.length; i++) {
    const item = recent.hits[i];
    const read = await recallMemoryByKey(item.key, cfg);
    if (!read.ok) return { ok: false, error: `point read failed at ${item.key}: ${read.error}`, ...advisory };
    if (!read.found) continue;
    hits.push({
      key: item.key,
      value: read.value,
      citation: `convex:mem:${cfg.ownerRootId}:${item.key}`,
      createdAt: item.createdAt,
      rank: i + 1,
      ...advisory,
    });
  }
  return { ok: true, hits, ...advisory };
}
