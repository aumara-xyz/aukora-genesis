// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Brick W3 — memoryAppend: THE single governed client write path to the memory organ.
 *
 * SAFETY_LAWS 2 (as amended 2026-07-05, owner-ratified D1): writes flow only through the
 * registered memory mutations. This module is the ONE client allowed to call a Convex
 * mutation (enforced by core/tests/convexReadOnlyInvariant.test.ts), and the only mutation
 * it knows how to reach is the vendored kernel's internal governed chokepoint
 * (convex/aumlokMemory.ts `aumlokMemoryWrite`): manifest resolution → subject PoP →
 * one-shot grant → intent → DECISION TOKEN (minted and consumed inside the same
 * serializable transaction; its absence throws `aumlok_mem_no_authority`) → V4-signed
 * receipt on the `mem:{owner}:{key}` chain → row insert.
 *
 * WHAT THIS BRICK IS NOT (held deliberately):
 * - NO live capture: nothing in the organism calls memoryAppend yet. The write path and
 *   its refusals are pinned by tests BEFORE any data flows.
 * - NO live transport: `deps.invoke` is required. The admin-authenticated invoke wiring
 *   (kernelAdapter, key custody at ~/.aukora-symbiote/convex/) is its own later brick.
 * - NO migration: the 77 JSON atoms move only after the verification path is pinned (M4).
 *
 * Fail-closed discipline: every boundary check refuses BEFORE the transport is touched;
 * a kernel/transport error refuses with the kernel's reason — there is no retry, no
 * fallback store, no second path. Every envelope this module returns — success or
 * refusal — is stamped advisoryOnly: true / grantsAuthority: false: a memory write never
 * grants permission to anything (SAFETY_LAWS 1).
 */
import { createHash } from 'crypto';
import { isLoopbackUrl } from './convexBrainReadonly';
import { scanForbiddenValues } from './forbiddenContent';

/** The one governed mutation this module may reach. The invariant test allowlists this
 *  module; this constant pins WHICH function the allowlist buys. */
export const REGISTERED_GOVERNED_MUTATION = 'aumlokMemory:aumlokMemoryWrite' as const;

/** Mirror of the kernel's frozen identity-name grammar (convex/aukoraReceipts.ts
 *  IDENTITY_NAME_RE) — no colon, so `mem:{owner}:{key}` stays an unambiguous chainKey. */
export const MEM_KEY_RE = /^[a-z0-9._-]{1,64}$/;

/** The boundary fields memoryAppend itself enforces. Extra manifest/PoP fields
 *  (manifestId, timestamp, useSeq, …) pass through for the kernel to verify — the kernel,
 *  not the client, is the authority on manifest validity. */
export type MemoryAppendRequest = {
  action: 'memory.write';
  ring: 'local-write';
  key: string;
  ownerRootId: string;
  resource: string; // must equal `mem:${ownerRootId}`
  [extra: string]: unknown;
};

export type MemoryAppendDeps = {
  /** Loopback deployment URL of the LOCAL self-hosted backend. Non-loopback refuses —
   *  CLOUD_DENY parity on the write client (plan §5 Brick G question 4). */
  deploymentUrl: string;
  /** Admin-authenticated invoke of ONE kernel function. Injected so this brick carries
   *  no live transport; the wiring brick supplies the real `convex run` client. */
  invoke: (mutationName: typeof REGISTERED_GOVERNED_MUTATION, payload: {
    req: Record<string, unknown>;
    subjectSig: string;
    value: string;
  }) => Promise<unknown>;
};

export type MemoryAppendResult =
  | {
      ok: true;
      advisoryOnly: true;
      grantsAuthority: false;
      key: string;
      ownerRootId: string;
      memoryHash: string;
      receiptHash: string;
    }
  | {
      ok: false;
      advisoryOnly: true;
      grantsAuthority: false;
      refused: string;
      /** true iff the refusal came back from the kernel (vs. a pre-transport boundary check) */
      transportInvoked: boolean;
    };

// ---- canonical value bytes (outside-advisory: deterministic JSON before hashing) ----

/** Recursively sort object keys; arrays keep order. Mirrors the kernel's own
 *  stableStringify (convex/aukoraCore.ts) so client and kernel canonicalize identically —
 *  a reformat or key-order change never produces different bytes, so it can never raise
 *  a false tamper flag downstream. */
function normalizeStableJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeStableJson);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = normalizeStableJson(obj[k]);
  return out;
}

/** A string value passes through verbatim; anything else becomes canonical JSON
 *  (sorted keys, no formatting whitespace). Throws on values JSON cannot carry
 *  faithfully (undefined, functions, cycles) — a memory that cannot be re-read
 *  byte-identically must not be written. */
export function canonicalMemoryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('memory_value_not_serializable');
  }
  const s = JSON.stringify(normalizeStableJson(value)); // throws on cycles/BigInt
  if (s === undefined) throw new Error('memory_value_not_serializable');
  return s;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const refuse = (reason: string, transportInvoked: boolean): MemoryAppendResult => ({
  ok: false,
  advisoryOnly: true,
  grantsAuthority: false,
  refused: reason,
  transportInvoked,
});

// ---- step 2b: forbidden-content wall (capture law 3 parity at the write choke point) ----

/** Provenance fields whose schema-validated pure-hex content may legitimately trip the bare-hex
 *  net (e.g. selfModOutcomeProjection's proposalHash/receiptHash). HARD-CODED — never
 *  env-configurable — and content-validated below: only strict lowercase hex is ever skipped. */
const PROVENANCE_HEX_FIELDS = new Set([
  'proposalHash',
  'receiptHash',
  'memoryHash',
  'originalMemoryHash',
  'artifactHash',
  'erasureReceiptHash',
  // canon-atom-v1 (found 2026-07-18, first gate run after the wall was signed live): the canon
  // ingester stamps each chunk with the sha256 of its WHOLE source file — provenance by the same
  // law as the receipt hashes above. Without this entry the wall refused every canon chunk.
  'sourceSha',
]);
const PURE_HEX_RE = /^[0-9a-f]{8,128}$/;

/** Scan the canonical value bytes for secret-shaped content (drop-not-sanitize: any finding
 *  refuses the WHOLE append; bytes are never rewritten). When the value parses as JSON, each
 *  string field is scanned individually so ONLY allowlisted provenance fields whose content is
 *  strictly pure hex are skipped — pure hex cannot match the sk-/PEM/bearer/key nets, so this
 *  skip is exactly equivalent to relaxing only the bare-hex net for validated provenance fields;
 *  every other byte of the value faces the full net. Non-JSON values are scanned whole.
 *  DISCLOSED RESIDUAL: a pure-hex secret stored under a hash-named field would pass — accepted
 *  because those fields are schema-validated hex provenance, and refusing them would brick the
 *  self-mod-outcome lane. */
function scanValueForForbiddenContent(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return scanForbiddenValues({ v: value });
  }
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'string') { found.push(...scanForbiddenValues(o, p)); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      // the narrow allowance: allowlisted key AND strictly pure-hex content — otherwise full net.
      if (typeof v === 'string' && PROVENANCE_HEX_FIELDS.has(k) && PURE_HEX_RE.test(v)) continue;
      walk(v, p ? `${p}.${k}` : k);
    }
  };
  walk(parsed, '');
  return found;
}

/**
 * Append one memory value through the governed kernel pipeline. The ring/permission
 * boundary is checked HERE (fail-closed, pre-transport) and again inside the kernel
 * (which additionally verifies the manifest, the subject PoP, and mints+consumes the
 * decision token atomically — no token, no write, `aumlok_mem_no_authority`).
 */
export const EMBEDDING_DIMS = 384; // mirror of the kernel's vector-index dimensions (R5c)

export async function memoryAppend(
  input: { req: MemoryAppendRequest; subjectSig: string; value: unknown; embedding?: number[] },
  deps: MemoryAppendDeps,
): Promise<MemoryAppendResult> {
  const { req, subjectSig } = input;

  // 0) the WRITE client only ever speaks to the local loopback organ — zero cloud, by law.
  if (!isLoopbackUrl(deps.deploymentUrl)) return refuse('memory_append_nonloopback_refused', false);

  // 1) ring/permission boundary (the kernel re-checks; refusing here keeps garbage off the wire).
  if (req?.action !== 'memory.write') return refuse('memory_append_action_refused', false);
  if (req?.ring !== 'local-write') return refuse('memory_append_ring_refused', false);
  if (typeof req.key !== 'string' || !MEM_KEY_RE.test(req.key)) return refuse('memory_append_key_invalid', false);
  if (typeof req.ownerRootId !== 'string' || !MEM_KEY_RE.test(req.ownerRootId)) return refuse('memory_append_owner_invalid', false);
  if (req.resource !== `mem:${req.ownerRootId}`) return refuse('memory_append_resource_scope_refused', false);
  // the subject PoP signature is the caller's proof of permission — absent proof never travels.
  if (typeof subjectSig !== 'string' || subjectSig.length === 0) return refuse('memory_append_pop_missing', false);

  // 1b) R5c: an OPTIONAL embedding may ride the write — derived, rebuildable index data OUTSIDE
  //     the integrity chain (memoryHash still binds owner:key:value only). Validated hard here
  //     (the kernel re-validates): a malformed vector never travels.
  if (input.embedding !== undefined) {
    const e = input.embedding;
    if (!Array.isArray(e) || e.length !== EMBEDDING_DIMS || e.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      return refuse('memory_append_embedding_invalid', false);
    }
  }

  // 2) canonical value bytes.
  let value: string;
  try {
    value = canonicalMemoryValue(input.value);
  } catch {
    return refuse('memory_append_value_uncanonical', false);
  }

  // 2b) forbidden-content wall — DROP, never sanitize. A secret-shaped value refuses the whole
  //     append pre-transport with a typed reason; the bytes never travel and are never rewritten.
  //     This is capture law 3 (conversationDistiller) enforced at the ONE choke point EVERY
  //     governed writer already uses, so no other/future writer can persist a secret unscrubbed.
  const forbidden = scanValueForForbiddenContent(value);
  if (forbidden.length > 0) return refuse(`memory_append_forbidden_content:${forbidden[0]}`, false);

  // 3) the ONE governed mutation. A kernel refusal (bad manifest, spent use, stale PoP,
  //    missing decision token → aumlok_mem_no_authority) refuses the append — fail-closed,
  //    no retry, no alternate path.
  let raw: unknown;
  try {
    raw = await deps.invoke(REGISTERED_GOVERNED_MUTATION, { req: req as Record<string, unknown>, subjectSig, value, ...(input.embedding !== undefined ? { embedding: input.embedding } : {}) });
  } catch (e) {
    return refuse(`memory_append_kernel_refused:${e instanceof Error ? e.message : String(e)}`, true);
  }

  // 4) trust, but verify the RESULT: a write without a receipt is not a write we accept,
  //    and the kernel's memoryHash must equal what WE compute from what WE sent — a lying
  //    or corrupted transport cannot report success for different bytes.
  const res = raw as { ok?: unknown; receiptHash?: unknown; memoryHash?: unknown } | null;
  if (!res || res.ok !== true) return refuse('memory_append_kernel_not_ok', true);
  if (typeof res.receiptHash !== 'string' || res.receiptHash.length === 0) return refuse('memory_append_unreceipted', true);
  const expectedHash = sha256Hex(`${req.ownerRootId}:${req.key}:${value}`);
  if (res.memoryHash !== expectedHash) return refuse('memory_append_hash_mismatch', true);

  return {
    ok: true,
    advisoryOnly: true,
    grantsAuthority: false,
    key: req.key,
    ownerRootId: req.ownerRootId,
    memoryHash: expectedHash,
    receiptHash: res.receiptHash,
  };
}
