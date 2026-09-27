// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Proposal law (pure) for governed inward-out recursion.
 *
 * A proposal is untrusted input. Before any grounding, review, or owner check it is validated into a
 * canonical snapshot: exact-key, data-descriptor-only, plain-prototype, single-read. This defeats the
 * classic smuggling shapes — unknown / symbol / non-enumerable keys, accessor (getter/setter) properties,
 * and read-varying proxies — because every field is read EXACTLY ONCE into a fresh plain object that is
 * what gets hashed, reviewed and applied. Nothing downstream ever touches the original object again.
 *
 * Identity is canonical and 64-hex, reusing the kernel canonical hash (no second hash implementation):
 *  - intentId  = which change (target + supersedes lineage), stable across re-drafts of the same intent;
 *  - draftHash = the exact bytes (target + newContent), so a signature for one draft cannot authorize another.
 *
 * This module is pure: no I/O, clock, randomness, signing, mutation, or authority grant.
 */
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalHash } from '@aukora/kernel/canonical';

export interface Proposal {
  readonly id: string;
  readonly targetPath: string;
  readonly newContent: string;
  /** ISO-8601 UTC, caller-supplied (pure: no ambient clock). */
  readonly createdAt: string;
  /** 64-hex intentId of the ancestor this supersedes, or null for a lineage root. */
  readonly supersedes: string | null;
}

/** Hard stops. Every one is a fail-closed ceiling, not a hint. */
export const LIMITS = Object.freeze({
  /** Governed self-change attempts per session (ledger-scoped). */
  MAX_ATTEMPTS: 64,
  /** Maximum patch size in UTF-8 bytes. */
  MAX_PATCH_BYTES: 65_536,
  /** Maximum supersedes-chain depth (root has depth 0). */
  MAX_LINEAGE_DEPTH: 16,
  /** Default wall-time budget used to derive a session deadline (callers pass an absolute deadlineMs). */
  DEFAULT_WALL_TIME_BUDGET_MS: 5 * 60_000,
} as const);

const HEX_64 = /^[0-9a-f]{64}$/;
const PROPOSAL_KEYS = ['id', 'targetPath', 'newContent', 'createdAt', 'supersedes'] as const;

export type ShapeResult =
  | { readonly ok: true; readonly proposal: Proposal }
  | { readonly ok: false; readonly reason: string };

function refuse(reason: string): ShapeResult {
  return { ok: false, reason };
}

/** UTF-8 byte length of a patch, using the kernel's encoder (no ambient TextEncoder assumptions). */
export function patchByteLength(newContent: string): number {
  return utf8ToBytes(newContent).length;
}

/**
 * Validate untrusted input into a canonical proposal snapshot. Total: never throws, returns a reason on any
 * deviation. Exact-key closed via Reflect.ownKeys (rejects symbol + non-enumerable keys); every field must be
 * a plain data property (rejects getters/setters); the value of each field is read exactly once into a fresh
 * plain object (neutralises read-varying proxies); the prototype must be ordinary (rejects class instances).
 */
export function validateProposalShape(x: unknown): ShapeResult {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return refuse('shape: not a plain object');
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) return refuse('shape: non-plain prototype');

  // Reflect.ownKeys sees symbol-keyed and non-enumerable smuggling that Object.keys hides.
  const ownKeys = Reflect.ownKeys(x);
  if (ownKeys.length !== PROPOSAL_KEYS.length) return refuse('shape: key-count mismatch (extra/hidden keys)');
  for (const k of ownKeys) if (typeof k !== 'string') return refuse('shape: symbol-keyed smuggling');

  // Each expected key must be present as an enumerable data property (no getters, no non-enumerable).
  for (const k of PROPOSAL_KEYS) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (d === undefined) return refuse(`shape: missing key '${k}'`);
    if (!('value' in d)) return refuse(`shape: accessor (getter/setter) smuggling on '${k}'`);
    if (d.enumerable !== true) return refuse(`shape: non-enumerable smuggling on '${k}'`);
  }

  // Single read of each field into locals — the snapshot is what we validate, hash and apply.
  const rec = x as Record<string, unknown>;
  const id = rec.id;
  const targetPath = rec.targetPath;
  const newContent = rec.newContent;
  const createdAt = rec.createdAt;
  const supersedes = rec.supersedes;

  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return refuse('shape: id must be a 1..128 char string');
  if (typeof targetPath !== 'string' || targetPath.length === 0 || targetPath.length > 512) return refuse('shape: targetPath must be a 1..512 char string');
  if (typeof newContent !== 'string') return refuse('shape: newContent must be a string');
  if (typeof createdAt !== 'string' || createdAt.length === 0 || createdAt.length > 40) return refuse('shape: createdAt must be a 1..40 char string');
  if (supersedes !== null && (typeof supersedes !== 'string' || !HEX_64.test(supersedes))) {
    return refuse('lineage: supersedes must be null or a 64-hex intentId');
  }

  // Fresh, frozen, ordinary-prototype snapshot. Nothing here aliases the untrusted input.
  const snapshot: Proposal = Object.freeze({ id, targetPath, newContent, createdAt, supersedes });
  return { ok: true, proposal: snapshot };
}

/**
 * Canonical 64-hex intent id: which change this is. Domain-separated over target + supersedes lineage only,
 * so re-drafts of the same intent share an id and the supersedes chain stays coherent. Reuses the kernel
 * canonical hash.
 */
export function deriveIntentId(proposal: Proposal): string {
  return canonicalHash({ domain: 'AUKORA-INTENT/1', targetPath: proposal.targetPath, supersedes: proposal.supersedes });
}

/**
 * Canonical 64-hex draft hash: the exact bytes being proposed. Binds target + content, so an owner signature
 * over one draft cannot be replayed to authorize a different target or different content.
 */
export function deriveDraftHash(proposal: Proposal): string {
  return canonicalHash({ domain: 'AUKORA-DRAFT/1', targetPath: proposal.targetPath, newContent: proposal.newContent });
}

export function isHex64(value: string): boolean {
  return HEX_64.test(value);
}

export type LineageResult =
  | { readonly ok: true; readonly depth: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Evaluate a supersedes chain for reachability and depth. `lookupDepth` returns the depth of a known/applied
 * ancestor intent (or undefined if unknown). Fail-closed: an unknown ancestor or an over-deep chain is refused.
 * Self-supersession is cryptographically impossible (the intentId hashes its own supersedes), and depth strictly
 * increases, so the applied set forms a DAG — no cycles.
 */
export function evaluateLineage(supersedes: string | null, lookupDepth: (intentId: string) => number | undefined): LineageResult {
  if (supersedes === null) return { ok: true, depth: 0 };
  const parentDepth = lookupDepth(supersedes);
  if (parentDepth === undefined) return { ok: false, reason: 'lineage: supersedes references an unknown/unreachable intent' };
  const depth = parentDepth + 1;
  if (depth > LIMITS.MAX_LINEAGE_DEPTH) return { ok: false, reason: `lineage: chain depth ${depth} exceeds max ${LIMITS.MAX_LINEAGE_DEPTH}` };
  return { ok: true, depth };
}

/** Proposal law grants no authority — it only shapes and identifies. Constant, by construction. */
export function proposalGrantsAuthority(): false {
  return false;
}
