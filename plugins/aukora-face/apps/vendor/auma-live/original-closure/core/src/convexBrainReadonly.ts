import { ConvexBrainSnapshot, ConvexBridgeMode, validateSnapshot } from './convexBrainSnapshot';

// ── Loopback validation ──

const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

const CLOUD_DENY = ['.convex.cloud', '.convex.dev', '.convex.site'];

export function isLoopbackUrl(url: string): boolean {
  if (!url || url.includes('@')) return false;
  return LOOPBACK_RE.test(url);
}

export function rejectNonLoopback(url: string): void {
  if (!isLoopbackUrl(url)) {
    throw new Error(`refuse_non_loopback_convex_url: ${url}`);
  }
  for (const deny of CLOUD_DENY) {
    if (url.includes(deny)) {
      throw new Error(`refuse_cloud_convex_url: ${url}`);
    }
  }
}

// ── Allowlisted queries ──

// SECURITY: only queries that have been verified to be (1) read-only and (2) free of
// secrets/signing-seeds/signature-bytes/payloads may appear here. The earlier speculative
// entries (getChainHead, getLatest, aukoraSignedHead:getCurrent) were REMOVED — they did not
// exist as real queries (24Y.5 adversarial review, MEDIUM): a placeholder allowlist entry
// risks becoming a leakage vector if later implemented without explicit secret-omission.
// Adding a new entry REQUIRES a field-level review proving it returns only public metadata.
const ALLOWED_QUERIES = new Set([
  'aukoraReceipts:getReceiptChainHeadPublic',
  'kira:getHeadPublic',
  'kira:recall',
]);

const MUTATION_DENY = new Set([
  'submitIntentCore',
  'verifyAndConsumeDecisionToken',
  'writeReceiptRow',
  'executeDecision',
  'signPoP',
  'submitAndConsume',
]);

export function isAllowedQuery(queryName: string): boolean {
  return ALLOWED_QUERIES.has(queryName);
}

export function rejectMutation(name: string): void {
  if (MUTATION_DENY.has(name)) {
    throw new Error(`refuse_mutation_in_readonly_bridge: ${name}`);
  }
  if (/^(insert|replace|patch|delete|mutation|action)$/i.test(name.split(':').pop() ?? '')) {
    throw new Error(`refuse_mutation_verb_in_readonly_bridge: ${name}`);
  }
}

// ── Bridge types ──

export interface ConvexLoopbackConfig {
  url: string;
  timeoutMs: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

export type ConvexReadSource = 'convex_loopback' | 'static_inventory' | 'unavailable';

export interface ConvexLoopbackResult {
  source: ConvexReadSource;
  bridgeMode: ConvexBridgeMode;
  data: Record<string, unknown> | null;
  readOnly: true;
  advisoryOnly: true;
  grantsAuthority: false;
  timestamp: string;
  fallbackReason?: string;
}

// AUKORA_CONVEX_URL matches kernelAdapter.ts's existing env-var pattern. Default was previously the
// dead organism-lab loopback (:3220, nothing ever listens there); the real, verified-live backend on
// this machine (aukora-os's node-template/convex, deployed at :3210) is the correct default (issue #11).
// This does NOT make :3210 trusted as canonical by itself — that still requires classifyBackend()'s
// cryptographic pin verification (convexTopology.ts) to pass; without AUKORA_CANONICAL_PIN_PUBLIC_KEY
// configured, the topology classifier correctly and safely refuses to call anything canonical.
const DEFAULT_CONFIG: ConvexLoopbackConfig = {
  url: process.env.AUKORA_CONVEX_URL || 'http://127.0.0.1:3210',
  timeoutMs: 3000,
  advisoryOnly: true,
  grantsAuthority: false,
};

// ── Scrub ──

const SCRUB_KEYS = new Set([
  'apiKey', 'api_key', 'privateKey', 'private_key',
  'seed', 'secretSeed', 'secret_seed', 'password', 'secret', 'token',
  'pop', 'proofOfPossession', 'rawSignature', 'raw_signature',
  'hiddenState', 'hidden_state', 'rawActivations', 'raw_activations',
  'modelWeights', 'model_weights', 'kvCache', 'kv_cache',
  'deploymentUrl', 'deployment_url', 'convexUrl', 'convex_url',
  'deploymentSlug', 'deployment_slug',
]);

// Bounded recursion depth. A legitimate public head is flat; deep nesting can only come from a
// broken/malicious local backend. (24Y.6 adversarial review, MEDIUM: unbounded recursion on a
// deeply-nested response stack-overflows the womb — a DoS. Cap depth and drop beyond it; FAIL CLOSED.)
const SCRUB_MAX_DEPTH = 12;

export function scrubPayload(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  if (depth >= SCRUB_MAX_DEPTH) return null; // refuse to descend further — drop the over-deep subtree
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SCRUB_KEYS.has(key)) continue;
    if (typeof value === 'string' && (value.startsWith('sk-') || /https:\/\/.*convex\.(cloud|dev|site)/.test(value))) continue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = scrubPayload(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Convex response envelope ──

/**
 * Convex's HTTP query API wraps results: success → {status:"success", value:<result>},
 * error → {status:"error", errorMessage, ...}. The womb-facing head fields therefore live
 * under `value`, NOT at the top level. (24Y.6: without unwrapping, a deployed head query
 * could NEVER be recognized as a real head — the canonical signal would be impossible.)
 * Non-enveloped input (already-unwrapped objects, e.g. unit-test mocks) passes through.
 */
export function unwrapConvexEnvelope(raw: unknown): { ok: boolean; value: unknown; errorMessage?: string } {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.status === 'success' && 'value' in r) return { ok: true, value: r.value };
    if (r.status === 'error') {
      return { ok: false, value: null, errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage : 'convex_error' };
    }
  }
  return { ok: true, value: raw };
}

// ── Core read ──

export async function readLoopbackSurface(
  queryName: string,
  config: ConvexLoopbackConfig = DEFAULT_CONFIG,
  queryArgs: Record<string, unknown> = {},
): Promise<ConvexLoopbackResult> {
  rejectNonLoopback(config.url);
  rejectMutation(queryName);
  if (!isAllowedQuery(queryName)) {
    throw new Error(`query_not_in_allowlist: ${queryName}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.url}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: queryName, args: scrubPayload(queryArgs) ?? {} }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`convex_loopback_http_${response.status}`);
    }

    const raw = await response.json();
    const env = unwrapConvexEnvelope(raw);
    // On a Convex error envelope, keep the (scrubbed) error object visible so the response is
    // classified as server_alive_query_unavailable — never as a real head.
    const data = env.ok ? scrubPayload(env.value) : scrubPayload(raw);

    return {
      source: 'convex_loopback',
      bridgeMode: 'local_loopback_readonly',
      data,
      readOnly: true,
      advisoryOnly: true,
      grantsAuthority: false,
      timestamp: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Read with fallback ──

export async function readWithFallback(
  queryName: string,
  staticSnapshot: ConvexBrainSnapshot | null,
  config: ConvexLoopbackConfig = DEFAULT_CONFIG,
  queryArgs: Record<string, unknown> = {},
): Promise<ConvexLoopbackResult> {
  try {
    return await readLoopbackSurface(queryName, config, queryArgs);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'unknown_error';

    if (staticSnapshot) {
      return {
        source: 'static_inventory',
        bridgeMode: 'static_inventory',
        data: {
          snapshotTimestamp: staticSnapshot.timestamp,
          tableCount: staticSnapshot.brainStatus.tableCount,
          activeCandidateCount: staticSnapshot.activeCandidateCount,
          donorCount: staticSnapshot.donorCount,
        },
        readOnly: true,
        advisoryOnly: true,
        grantsAuthority: false,
        timestamp: new Date().toISOString(),
        fallbackReason: `loopback_unavailable: ${reason}`,
      };
    }

    return {
      source: 'unavailable',
      bridgeMode: 'missing',
      data: null,
      readOnly: true,
      advisoryOnly: true,
      grantsAuthority: false,
      timestamp: new Date().toISOString(),
      fallbackReason: `loopback_unavailable_no_static: ${reason}`,
    };
  }
}

// ── Snapshot enrichment ──

export interface ReceiptChainHeadPublic {
  exists: boolean;
  chainKey: string;
  count: number;
  lastChainHash: string | null;
  /** PUBLIC ML-DSA-65 signature over the V4 head preimage — verification material, NOT a secret. */
  headSig: string | null;
  headSigAlg: string | null;
  headSignedAt: number | null;
  receiptLogRoot: string | null;
  updatedAt: number | null;
}

export type LiveDataKind = 'receipt_chain_head_public' | 'server_alive_query_unavailable' | 'unavailable';

/**
 * Type-validate a (scrubbed, unwrapped) response into a ReceiptChainHeadPublic, or null.
 * FAIL CLOSED: only a response whose shape AND types match the public head contract is a head.
 * A garbage/error response that merely carries the field NAMES (e.g. {exists:"error",
 * chainKey:null, count:-1}) is NOT a head. Optional fields are coerced to null on wrong type —
 * junk types are never propagated to the womb. (24Y.5 hardening; reused by topology classifier.)
 */
export function parseReceiptHead(data: Record<string, unknown> | null): ReceiptChainHeadPublic | null {
  if (!data) return null;

  const exists = data.exists;
  const chainKey = data.chainKey;
  const count = data.count;

  const shapeOk =
    typeof exists === 'boolean' &&
    typeof chainKey === 'string' && chainKey.length > 0 &&
    typeof count === 'number' && Number.isFinite(count) && count >= 0;

  if (!shapeOk) return null;

  const asStringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const asNumberOrNull = (v: unknown): number | null =>
    (typeof v === 'number' && Number.isFinite(v) ? v : null);

  return {
    exists: exists as boolean,
    chainKey: chainKey as string,
    count: count as number,
    lastChainHash: asStringOrNull(data.lastChainHash),
    headSig: asStringOrNull(data.headSig),
    headSigAlg: asStringOrNull(data.headSigAlg),
    headSignedAt: asNumberOrNull(data.headSignedAt),
    receiptLogRoot: asStringOrNull(data.receiptLogRoot),
    updatedAt: asNumberOrNull(data.updatedAt),
  };
}

function classifyLiveData(data: Record<string, unknown> | null): { kind: LiveDataKind; head: ReceiptChainHeadPublic | null } {
  if (!data) return { kind: 'unavailable', head: null };
  const head = parseReceiptHead(data);
  if (head) return { kind: 'receipt_chain_head_public', head };
  return { kind: 'server_alive_query_unavailable', head: null };
}

/**
 * SHAPE-ONLY enrichment: reads the head query and type-classifies the response. It does NOT
 * establish that the responding backend is the canonical Aukora kernel — a donor/lab backend
 * that happens to return a head-shaped object would still classify as receipt_chain_head_public
 * here. The CANONICAL gate (backend role + receiptHeadVisible) lives in convexTopology.ts
 * (`enrichSnapshotWithTopology`). Callers that need a TRUE canonical brain signal must use that.
 */
export async function enrichSnapshotWithLoopback(
  snapshot: ConvexBrainSnapshot,
  config: ConvexLoopbackConfig = DEFAULT_CONFIG,
  chainKey: string = 'organism',
): Promise<{ snapshot: ConvexBrainSnapshot; loopbackResult: ConvexLoopbackResult; liveDataKind: LiveDataKind; receiptHead: ReceiptChainHeadPublic | null }> {
  const result = await readWithFallback(
    'aukoraReceipts:getReceiptChainHeadPublic',
    snapshot,
    config,
    { chainKey },
  );

  const { kind, head } = classifyLiveData(result.data);

  const enriched: ConvexBrainSnapshot = {
    ...snapshot,
    bridgeMode: result.bridgeMode,
    advisoryOnly: true,
    grantsAuthority: false,
  };

  if (result.source === 'convex_loopback') {
    const riskIdx = enriched.risks.indexOf('No Convex subscription or read-only bridge exists between womb and kernel');
    if (riskIdx >= 0) enriched.risks.splice(riskIdx, 1);
    enriched.nextSafeWiringStep = kind === 'receipt_chain_head_public'
      ? 'Head-shaped response read. Confirm backend is canonical kernel (convexTopology) before trusting as brain signal.'
      : 'Server live but query unavailable. Deploy getReceiptChainHeadPublic to the canonical kernel backend.';
  }

  const validation = validateSnapshot(enriched);
  if (!validation.valid) {
    throw new Error(`enriched snapshot validation failed: ${validation.violations.join(', ')}`);
  }

  return { snapshot: enriched, loopbackResult: result, liveDataKind: kind, receiptHead: head };
}
