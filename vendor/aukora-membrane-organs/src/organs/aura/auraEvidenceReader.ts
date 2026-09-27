// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AURA EVIDENCE READER — read-only, bounded, deterministic (AURA lane round 3,
 * docs/mesh/handoff/AURA.md). Turns the node's CONTENT-FREE local key knowledge into the
 * ordered `TraceEvidenceInput[]` that `buildAuraTraceEpoch` consumes — and nothing else.
 *
 * WHAT IT READS (the only evidence classes this node can honestly enumerate — the governed
 * store deliberately has NO bulk chain enumeration, and this module does not invent one):
 *   - 'canon-ledger'    — row keys from the canon ingest ledger (content-free key lists);
 *   - 'focus-pointer'   — the current working-focus row key (content-free pointer);
 *   - 'capture-status'  — the LAST captured turn's row key (the only one recorded locally).
 * WHAT IT CANNOT SEE (named, not hidden — the exact gap):
 *   - captured turns before the last one (no local key record exists);
 *   - M4-migrated atoms (their keys live in the owner's corpus file, not read this round);
 *   - erased rows (tombstones; excluded by store law — an erased chain's changed head makes
 *     old epochs fail live verification, which is the honest outcome).
 *
 * LAWS (each pinned):
 *   - READ-ONLY: no writes, no persistence, no drand fetch — this module has no IO at all;
 *     the store verifier and the head reader are INJECTED (the shadowCapture precedent).
 *   - VALUES NEVER TRAVEL: only chain identifiers and verified head hashes; no memory values,
 *     prompts, chat text, receipt bodies, signatures-as-authority, or key material.
 *   - DETERMINISTIC ORDER by an EXPLICIT rule: lexicographic by full chainKey — never
 *     filesystem, map, or query iteration order.
 *   - FAIL-CLOSED, loudly, with CATEGORY strings that never contain a chain key or hash:
 *     duplicates, malformed keys, unverified store, missing chains, invalid heads, overflow,
 *     and a CHANGING SNAPSHOT (verify + heads are read twice; any drift refuses — no partial
 *     epoch is ever produced from a moving store).
 */
import { MEM_KEY_RE } from './memoryKey';
import { MAX_TRACE_COMMITMENTS, type TraceEvidenceInput } from './auraTrace';
import { normalizeAuraEvidenceKeyRecords, MAX_CAPTURE_INDEX_KEYS } from './auraEvidenceKeyRecord';

export type EvidenceClass = 'canon-ledger' | 'focus-pointer' | 'capture-status' | 'capture-index';
export const EVIDENCE_CLASSES: readonly EvidenceClass[] = Object.freeze(['canon-ledger', 'focus-pointer', 'capture-status', 'capture-index']);

/** The gap, stated as data so every report carries it verbatim. 'captured-turns-before-last'
 *  drops out only when a validated capture-key index is actually consumed (round 4 contract:
 *  aura-evidence-key-record-v1; the WRITER is MAIN's later handshake). */
export const EXCLUDED_EVIDENCE_CLASSES = Object.freeze([
  'captured-turns-before-last (no local key record)',
  'm4-migrated-atoms (corpus keys not read this round)',
  'erased-rows (tombstones; excluded by store law)',
]);
export const EXCLUDED_WITH_CAPTURE_INDEX = Object.freeze(EXCLUDED_EVIDENCE_CLASSES.filter((x) => !x.startsWith('captured-turns-before-last')));

export interface KnownKey {
  source: EvidenceClass;
  key: string; // a governed row key (MEM_KEY_RE) — an identifier, never content
}

/** Minimal verified-head view the reader needs — a strict subset of the existing
 *  ReceiptChainHeadPublic contract (core/src/convexBrainReadonly.parseReceiptHead). */
export interface HeadView {
  exists: boolean;
  count: number;
  lastChainHash: string | null;
}

export interface EvidenceReaderDeps {
  ownerRootId: string;
  /** Injected store verifier (adapter: aumlokMemory:aumlokMemoryVerify). Green or refuse. */
  verifyStore: () => Promise<{ ok: boolean; flagged: number; checked: number }>;
  /** Injected head reader (adapter: aukoraReceipts:getReceiptChainHeadPublic through the
   *  existing parse/validation contract). Null = unreadable. */
  readHead: (chainKey: string) => Promise<HeadView | null>;
}

export type EvidenceReadResult =
  | {
      ok: true;
      evidence: TraceEvidenceInput[]; // ordered lexicographically by chainKey
      classCounts: Record<EvidenceClass, number>;
      excluded: readonly string[];
      storeChecked: number; // technical count of rows the store verifier checked (not AURA)
    }
  | { ok: false; refusal: string }; // CATEGORY only — never a key, hash, or content

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Assemble the ordered evidence set, twice-checked. Refusals are loud and categorical;
 * success is exact or nothing — never a partial epoch's worth.
 */
export async function readLiveEvidence(
  knownKeys: KnownKey[],
  deps: EvidenceReaderDeps,
  opts: { captureIndex?: unknown } = {},
): Promise<EvidenceReadResult> {
  const refuse = (refusal: string): EvidenceReadResult => ({ ok: false, refusal });
  if (typeof deps?.ownerRootId !== 'string' || !MEM_KEY_RE.test(deps.ownerRootId)) return refuse('owner_invalid');

  // Round-4 seam: an OPTIONAL validated capture-key index (aura-evidence-key-record-v1) joins
  // the local classes. Selection is the contract's bounded newest-first rule; the FINAL epoch
  // order below remains lexicographic by chainKey, unchanged. One bad record refuses the whole
  // list; a key that also arrives from another class (e.g. capture-status's lastKey) is the
  // standing duplicate refusal — when an index is supplied, the CALLER omits capture-status.
  let indexKeys: KnownKey[] = [];
  let indexConsumed = false;
  if (opts.captureIndex !== undefined) {
    const norm = normalizeAuraEvidenceKeyRecords(opts.captureIndex, { max: MAX_CAPTURE_INDEX_KEYS });
    if (!norm.ok) return refuse(norm.refusal);
    indexKeys = norm.records.map((r) => ({ source: 'capture-index' as const, key: r.key }));
    indexConsumed = true;
  }
  const allKeys = [...(Array.isArray(knownKeys) ? knownKeys : []), ...indexKeys];
  if (allKeys.length === 0) return refuse('no_local_key_knowledge');

  // validate + normalize to chain keys; duplicates REFUSE (never silently deduped — a duplicate
  // means two sources disagree about what the set is, and guessing is forbidden)
  const classCounts: Record<EvidenceClass, number> = { 'canon-ledger': 0, 'focus-pointer': 0, 'capture-status': 0, 'capture-index': 0 };
  const byChainKey = new Map<string, EvidenceClass>();
  for (const k of allKeys) {
    if (!k || !EVIDENCE_CLASSES.includes(k.source)) return refuse('unknown_evidence_class');
    if (typeof k.key !== 'string' || !MEM_KEY_RE.test(k.key)) return refuse(`invalid_key_shape:${k.source}`);
    const chainKey = `mem:${deps.ownerRootId}:${k.key}`;
    if (byChainKey.has(chainKey)) return refuse('duplicate_chain_key');
    byChainKey.set(chainKey, k.source);
  }
  if (byChainKey.size > MAX_TRACE_COMMITMENTS) return refuse('evidence_overflow');

  // EXPLICIT deterministic order: lexicographic by full chainKey. Never iteration order.
  const ordered = [...byChainKey.keys()].sort();

  // pass A — the store must verify green BEFORE any head is trusted
  let v1;
  try { v1 = await deps.verifyStore(); } catch { return refuse('store_verify_unreachable'); }
  if (!v1 || v1.ok !== true || v1.flagged !== 0) return refuse('store_unverified');

  const heads = new Map<string, { count: number; hash: string }>();
  for (const chainKey of ordered) {
    let h: HeadView | null;
    try { h = await deps.readHead(chainKey); } catch { return refuse(`head_unreachable:${byChainKey.get(chainKey)}`); }
    if (!h || h.exists !== true) return refuse(`chain_missing:${byChainKey.get(chainKey)}`);
    if (typeof h.lastChainHash !== 'string' || !HEX64.test(h.lastChainHash)) return refuse(`head_invalid:${byChainKey.get(chainKey)}`);
    if (!Number.isSafeInteger(h.count) || h.count <= 0) return refuse(`head_invalid:${byChainKey.get(chainKey)}`);
    heads.set(chainKey, { count: h.count, hash: h.lastChainHash });
  }

  // pass B — the snapshot must HOLD: verify again and re-read every head; any drift refuses.
  // A moving store never yields a partial or stitched epoch (the no-guessing law).
  let v2;
  try { v2 = await deps.verifyStore(); } catch { return refuse('store_verify_unreachable'); }
  if (!v2 || v2.ok !== true || v2.flagged !== 0 || v2.checked !== v1.checked) return refuse('snapshot_moved');
  for (const chainKey of ordered) {
    let h: HeadView | null;
    try { h = await deps.readHead(chainKey); } catch { return refuse(`head_unreachable:${byChainKey.get(chainKey)}`); }
    const a = heads.get(chainKey)!;
    if (!h || h.exists !== true || h.lastChainHash !== a.hash || h.count !== a.count) return refuse('snapshot_moved');
  }

  for (const src of byChainKey.values()) classCounts[src] += 1;
  return {
    ok: true,
    evidence: ordered.map((chainKey) => ({ chainKey, chainHeadHash: heads.get(chainKey)!.hash })),
    classCounts,
    excluded: indexConsumed ? EXCLUDED_WITH_CAPTURE_INDEX : EXCLUDED_EVIDENCE_CLASSES,
    storeChecked: v1.checked,
  };
}

export function evidenceReaderGrantsAuthority(): false { return false; }
