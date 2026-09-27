// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * ONE CORE MEMORY — the core receipt stamp (issues #45 / #244, one-core-memory round).
 *
 * Every surface that speaks to the governed memory organ (chat door, presence, self-mod outcome
 * projection, future doors) already funnels WRITES through core/src/memoryAppend.ts and fuzzy READS
 * through spatial/recallSource.ts. What no surface could do until now is SAY, inside the stored
 * value, WHICH core instance and memory namespace it intended — so two doors could not prove they
 * share one brain, and a recalled row could not name the thread it came from.
 *
 * This module is that identification layer: a small, bounded, ADDITIVE `core` block that rides
 * inside existing value envelopes (turn-summary-v1, self-mod-outcome-v1). It is metadata about a
 * write, never the write itself:
 *   - NO new write path: the stamp travels inside the one governed memoryAppend value. Zero new
 *     mutations, zero new transports (convexReadOnlyInvariant.test.ts still pins the single door).
 *   - NEVER fails a capture: the origin-tag law (captureOrigin.test.ts) extends to every field
 *     here — an invalid optional field is DROPPED, an unbuildable stamp is OMITTED, and the turn
 *     still captures. Old rows without a stamp read honestly as unstamped.
 *   - NO authority: the stamp carries the literal advisory marks; identifying a core instance
 *     grants nothing (SAFETY_LAWS 1). Memory never grants permission and never overrides AUMLOK.
 *   - The CANONICAL identities stay where they already live: the row key + `mem:{owner}:{key}`
 *     receipt chain are canonical (kernel-side); a value cannot carry its own receipt hash
 *     (hash cycle), so the stamp names the intended namespace and the recall citation
 *     (`convex:mem:{owner}:{key}`) remains the receipt reference readers cite.
 *
 * PURE + LEAF: node:crypto only (same as memoryAppend). No fs, no network, no clock — `at` and
 * `sourceCommit` are injected by the edge (spatial/coreSession.ts resolves them per process).
 */
import { createHash } from 'crypto';

export const CORE_RECEIPT_STAMP_SCHEMA = 'core-receipt-stamp-v1' as const;

/** The door-tag law, shared verbatim with conversationShadowCapture's origin slug. */
export const CORE_SLUG_RE = /^[a-z][a-z0-9_-]{0,23}$/;

/** Thread/session ids: the door-slug alphabet plus dots (session ids embed compact timestamps,
 *  `sess.20260713t090000z.ab12`), bounded. Same drop-not-fail discipline as origin. */
export const THREAD_ID_RE = /^[a-z][a-z0-9._-]{0,47}$/;

/** Repo commit as recorded by the edge resolver: a short-or-full git hash, or absent. */
const COMMIT_RE = /^[0-9a-f]{7,64}$/;

/** A supersedes reference is a governed row KEY in the same namespace (MEM_KEY_RE mirror —
 *  mirrored, not imported, to keep this module a leaf; the law is byte-identical). */
export const SUPERSEDES_KEY_RE = /^[a-z0-9._-]{1,64}$/;

/** Derived-index digest (e.g. an embedding-encoder or mesh_peek config digest): bounded hex. */
const DERIVED_DIGEST_RE = /^[0-9a-f]{8,128}$/;

/** Consent/visibility scope WITHIN the one owner namespace. The kernel's row-level `visibility:
 *  "private"` (owner vs the world) is untouched and remains authoritative; this scope only says
 *  how far a row may travel BETWEEN the owner's own threads:
 *    - 'owner-shared'  (default): any of the owner's surfaces/threads may recall it.
 *    - 'thread-private': served ONLY to the thread that wrote it — recall on any other thread
 *      must exclude it regardless of the cross-thread switch. */
export const CONSENT_SCOPES = ['owner-shared', 'thread-private'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** Provenance names the WRITER KIND (which projection/capture lane authored the value), while
 *  `origin` names the DOOR a human-visible turn came through. Bounded slug set — additive. */
export const PROVENANCE_KINDS = ['distilled-turn', 'selfmod-outcome'] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export interface CoreReceiptStampV1 {
  schema: typeof CORE_RECEIPT_STAMP_SCHEMA;
  /** WHICH core this surface intended: deterministic from (deploymentUrl, ownerRootId). Two doors
   *  writing through the same governed brain carry the SAME id — the shared-core proof. */
  coreInstanceId: string;
  /** The intended memory namespace — exactly memoryAppend's resource scope. */
  namespace: string;
  /** Writer kind (see PROVENANCE_KINDS). */
  provenance: ProvenanceKind;
  /** Consent scope between the owner's own threads (see CONSENT_SCOPES). */
  scope: ConsentScope;
  /** ISO timestamp of the stamped write (the surrounding envelope's `at`, repeated so the stamp
   *  is self-contained when values are inspected row-by-row). */
  at: string;
  /** Thread/session id of the writing surface, when the door provided a valid one. */
  thread?: string;
  /** Repo commit the writing process was running, when the edge could resolve one. */
  sourceCommit?: string;
  /** Governed row KEY this value corrects/supersedes, when the writer declared one. Advisory
   *  lineage only — supersession becomes real when the owner erases/quarantines the old row or a
   *  reader (e.g. the mesh_peek shadow index) honors the pointer. Never a deletion. */
  supersedesKey?: string;
  /** Digest of any derived-index encoder/config used for this row (e.g. embedding model id hash).
   *  Derived data is cache, never authority; the digest exists so drift is detectable. */
  derivedIndexDigest?: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

/** Hard cap on the stamp's serialized bytes — the stamp must never crowd the value it rides in
 *  (turn-summary caps the WHOLE value at 8k; a stamp is ~350 bytes). */
export const MAX_STAMP_CHARS = 1_000;

/** Deterministic core-instance id: `core.` + first 12 hex of sha256(`${deploymentUrl}|${ownerRootId}`).
 *  Same brain URL + same owner root → same id, in every process, on both the write and read side.
 *  A different deployment (another node, a disposable guest) derives a DIFFERENT id — exactly the
 *  distinction "one core" needs to be checkable. Trailing slashes are normalized so
 *  `http://127.0.0.1:3210` and `http://127.0.0.1:3210/` name one instance. */
export function deriveCoreInstanceId(deploymentUrl: string, ownerRootId: string): string {
  const url = deploymentUrl.replace(/\/+$/, '').toLowerCase();
  const h = createHash('sha256').update(`${url}|${ownerRootId}`, 'utf8').digest('hex');
  return `core.${h.slice(0, 12)}`;
}

export interface BuildCoreReceiptStampInput {
  deploymentUrl: string;
  ownerRootId: string;
  provenance: ProvenanceKind;
  at: string;
  /** Optional fields follow the drop-not-fail law — invalid values are omitted, never guessed. */
  thread?: string;
  sourceCommit?: string;
  scope?: string;
  supersedesKey?: string;
  derivedIndexDigest?: string;
}

/**
 * Build the stamp, or return null when no honest stamp can be built (malformed required inputs,
 * oversize serialization). A null stamp means the value travels UNSTAMPED — the capture itself
 * must never fail over identification metadata (the origin-tag law, extended).
 */
export function buildCoreReceiptStamp(input: BuildCoreReceiptStampInput): CoreReceiptStampV1 | null {
  if (!input || typeof input !== 'object') return null;
  const { deploymentUrl, ownerRootId, provenance, at } = input;
  if (typeof deploymentUrl !== 'string' || deploymentUrl.length === 0 || deploymentUrl.length > 200) return null;
  if (typeof ownerRootId !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(ownerRootId)) return null;
  if (!PROVENANCE_KINDS.includes(provenance)) return null;
  if (typeof at !== 'string' || at.length === 0 || at.length > 40) return null;

  const thread = typeof input.thread === 'string' && THREAD_ID_RE.test(input.thread) ? input.thread : undefined;
  const sourceCommit = typeof input.sourceCommit === 'string' && COMMIT_RE.test(input.sourceCommit) ? input.sourceCommit : undefined;
  // Consent fails CLOSED (review round): an absent scope is the shared default, but a scope the
  // writer TRIED to set and this module does not recognize collapses to thread-private — a missed
  // restriction would leak across threads; a missed share merely hides. Capture still never fails.
  const scope: ConsentScope =
    input.scope === undefined || input.scope === 'owner-shared'
      ? 'owner-shared'
      : 'thread-private';
  const supersedesKey = typeof input.supersedesKey === 'string' && SUPERSEDES_KEY_RE.test(input.supersedesKey) ? input.supersedesKey : undefined;
  const derivedIndexDigest =
    typeof input.derivedIndexDigest === 'string' && DERIVED_DIGEST_RE.test(input.derivedIndexDigest) ? input.derivedIndexDigest : undefined;

  const stamp: CoreReceiptStampV1 = {
    schema: CORE_RECEIPT_STAMP_SCHEMA,
    coreInstanceId: deriveCoreInstanceId(deploymentUrl, ownerRootId),
    namespace: `mem:${ownerRootId}`,
    provenance,
    scope,
    at,
    ...(thread ? { thread } : {}),
    ...(sourceCommit ? { sourceCommit } : {}),
    ...(supersedesKey ? { supersedesKey } : {}),
    ...(derivedIndexDigest ? { derivedIndexDigest } : {}),
    advisoryOnly: true,
    grantsAuthority: false,
  };
  try {
    if (JSON.stringify(stamp).length > MAX_STAMP_CHARS) return null;
  } catch {
    return null;
  }
  return stamp;
}

/** Reader-side re-validation (untrusted-input discipline, exactly the origin-tag reader law):
 *  a stored `core` block is untrusted bytes; every field is re-checked and anything invalid reads
 *  as absent. Returns null when the block is not a recognizable stamp. */
export function readCoreReceiptStamp(value: unknown): CoreReceiptStampV1 | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.schema !== CORE_RECEIPT_STAMP_SCHEMA) return null;
  if (typeof v.coreInstanceId !== 'string' || !/^core\.[0-9a-f]{12}$/.test(v.coreInstanceId)) return null;
  if (typeof v.namespace !== 'string' || !/^mem:[a-z0-9._-]{1,64}$/.test(v.namespace)) return null;
  if (!PROVENANCE_KINDS.includes(v.provenance as ProvenanceKind)) return null;
  if (!CONSENT_SCOPES.includes(v.scope as ConsentScope)) return null;
  if (typeof v.at !== 'string' || v.at.length === 0 || v.at.length > 40) return null;
  const thread = typeof v.thread === 'string' && THREAD_ID_RE.test(v.thread) ? v.thread : undefined;
  const sourceCommit = typeof v.sourceCommit === 'string' && COMMIT_RE.test(v.sourceCommit) ? v.sourceCommit : undefined;
  const supersedesKey = typeof v.supersedesKey === 'string' && SUPERSEDES_KEY_RE.test(v.supersedesKey) ? v.supersedesKey : undefined;
  const derivedIndexDigest =
    typeof v.derivedIndexDigest === 'string' && DERIVED_DIGEST_RE.test(v.derivedIndexDigest) ? v.derivedIndexDigest : undefined;
  return {
    schema: CORE_RECEIPT_STAMP_SCHEMA,
    coreInstanceId: v.coreInstanceId,
    namespace: v.namespace,
    provenance: v.provenance as ProvenanceKind,
    scope: v.scope as ConsentScope,
    at: v.at,
    ...(thread ? { thread } : {}),
    ...(sourceCommit ? { sourceCommit } : {}),
    ...(supersedesKey ? { supersedesKey } : {}),
    ...(derivedIndexDigest ? { derivedIndexDigest } : {}),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** The mechanical guarantee, mirrored across governed surfaces: a stamp NEVER grants authority. */
export function coreReceiptStampGrantsAuthority(_s?: CoreReceiptStampV1): false {
  return false;
}
