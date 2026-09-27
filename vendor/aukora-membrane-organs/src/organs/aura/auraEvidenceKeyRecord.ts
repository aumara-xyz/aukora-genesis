// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * aura-evidence-key-record-v1 — the CAPTURE-KEY INDEX CONTRACT (AURA lane round 4,
 * docs/mesh/handoff/AURA.md). A contract, deliberately NOT a writer: this file defines the
 * exact bounded, content-free shape a future MAIN-lane index writer must produce so the AURA
 * evidence reader can enumerate captured-turn row keys beyond the last one. MAIN reviews this
 * contract and owns any writer handshake; nothing here reads or writes any file, calls Convex,
 * or touches the capture door.
 *
 * ONE RECORD = one captured-turn ROW KEY plus only the technical metadata deterministic
 * newest-first enumeration needs:
 *   { schema: 'aura-evidence-key-record-v1', key, at, sourceClass: 'captured-turn' }
 *
 * WHAT A RECORD CAN NEVER CARRY (enforced by a CLOSED field set + shape law — an extra field
 * of any name refuses the whole list): turn text, previews, prompts, model output, identities,
 * signatures, hashes, tokens, or AURA scores. The `key` must match the governed row-key grammar
 * (≤64 chars of [a-z0-9._-]) — an identifier by construction, with no room for prose. The `at`
 * must be a canonical ISO instant; the normalizer canonicalizes and the validator refuses what
 * it cannot canonicalize. No silent repair beyond timestamp canonicalization, no partial lists.
 */
import { MEM_KEY_RE } from './memoryKey';

export const AURA_EVIDENCE_KEY_RECORD_SCHEMA = 'aura-evidence-key-record-v1' as const;

/** Newest-first selection bound: at most this many captured-turn keys enter one evidence read.
 *  (The reader's overall trace cap still applies on top.) */
export const MAX_CAPTURE_INDEX_KEYS = 128;

export interface AuraEvidenceKeyRecordV1 {
  schema: typeof AURA_EVIDENCE_KEY_RECORD_SCHEMA;
  key: string; // governed row key — identifier only, MEM_KEY_RE
  at: string; // canonical ISO instant (normalized to Date.toISOString form)
  sourceClass: 'captured-turn'; // v1: the one class this contract covers
}

const RECORD_KEYS: ReadonlySet<string> = new Set(['schema', 'key', 'at', 'sourceClass']);

export type RecordValidation =
  | { valid: true; record: AuraEvidenceKeyRecordV1 }
  | { valid: false; reason: string }; // category only — never echoes field contents

/** Validate + canonicalize ONE record. Fail-closed: unknown fields (any smuggling surface),
 *  bad key grammar, non-canonicalizable timestamps, and wrong schema/class all refuse. */
export function validateAuraEvidenceKeyRecord(r: unknown): RecordValidation {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { valid: false, reason: 'record_not_an_object' };
  const o = r as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!RECORD_KEYS.has(k)) return { valid: false, reason: 'record_unknown_field' };
  if (o.schema !== AURA_EVIDENCE_KEY_RECORD_SCHEMA) return { valid: false, reason: 'record_wrong_schema' };
  if (o.sourceClass !== 'captured-turn') return { valid: false, reason: 'record_wrong_source_class' };
  if (typeof o.key !== 'string' || !MEM_KEY_RE.test(o.key)) return { valid: false, reason: 'record_key_invalid' };
  if (typeof o.at !== 'string') return { valid: false, reason: 'record_at_invalid' };
  const t = Date.parse(o.at);
  if (!Number.isFinite(t)) return { valid: false, reason: 'record_at_invalid' };
  return {
    valid: true,
    record: { schema: AURA_EVIDENCE_KEY_RECORD_SCHEMA, key: o.key, at: new Date(t).toISOString(), sourceClass: 'captured-turn' },
  };
}

export type IndexNormalization =
  | { ok: true; records: AuraEvidenceKeyRecordV1[] } // newest-first, bounded, canonical, unique
  | { ok: false; refusal: string };

/**
 * Normalize a whole record list: every record must validate (one bad record refuses the WHOLE
 * list — a partially-trusted index is a guessing game), duplicate keys refuse, then records are
 * ordered NEWEST-FIRST (canonical `at` desc, key desc as the deterministic tiebreak) and bounded
 * to `max`. This is the SELECTION order only — the final epoch order remains the reader's
 * lexicographic chain-key rule, unchanged.
 */
export function normalizeAuraEvidenceKeyRecords(list: unknown, opts: { max?: number } = {}): IndexNormalization {
  const max = opts.max ?? MAX_CAPTURE_INDEX_KEYS;
  if (!Array.isArray(list)) return { ok: false, refusal: 'index_not_a_list' };
  if (list.length === 0) return { ok: true, records: [] };
  const seen = new Set<string>();
  const records: AuraEvidenceKeyRecordV1[] = [];
  for (const item of list) {
    const v = validateAuraEvidenceKeyRecord(item);
    if (!v.valid) return { ok: false, refusal: v.reason };
    if (seen.has(v.record.key)) return { ok: false, refusal: 'index_duplicate_key' };
    seen.add(v.record.key);
    records.push(v.record);
  }
  records.sort((a, b) => (a.at === b.at ? (a.key < b.key ? 1 : -1) : a.at < b.at ? 1 : -1)); // newest first, deterministic
  return { ok: true, records: records.slice(0, max) };
}

export function keyRecordGrantsAuthority(): false { return false; }
