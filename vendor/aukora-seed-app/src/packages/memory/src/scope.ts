// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Memory SCOPE — the "empty shelf" fix (symbiote #62), pure and portable.
 *
 * #62's root cause: the donor Kira brain filled 92% with TEST files (`ingestSelfMap` had no test/scope notion),
 * so an identity query ("who am I", "maternal anchor") had nothing but test noise to return — an EMPTY SHELF,
 * not retrieval bias. The donor's own atoms already carried a `scope` string and an `isTestFile` heuristic
 * (`core/src/kiraBrain.ts@fa113e8a`). This module restores that notion in the current content-addressed brain
 * as a DETERMINISTIC classifier over a record's provenance + content, plus scope-aware recall filters and a
 * shelf CENSUS so a consumer can honestly distinguish "identity corpus absent" from "retrieval bias".
 *
 * It classifies; it never fabricates. Identity content that was never ingested stays absent (census 0), and a
 * forgotten identity atom stays gone — the two failure modes #62 demands be kept distinct.
 */
import type { MemoryRecordV1 } from './envelope.js';

export type MemoryScope = 'identity' | 'architecture' | 'evidence' | 'doc' | 'test' | 'code' | 'general';
export const MEMORY_SCOPES: readonly MemoryScope[] = ['identity', 'architecture', 'evidence', 'doc', 'test', 'code', 'general'];

// Donor `isTestFile` (kiraBrain.ts): `/(^|\/)tests?\//` on the path, or `\.(test|spec)\.[tj]sx?$` on the name.
// Applied here to the record's `provenance` (which may carry a `links`/path reference) and content.
const TEST_PATH = /(^|\/)tests?\//i;
const TEST_NAME = /\.(test|spec)\.[tj]sx?(\b|$)/i;
const TEST_BODY = /\b(describe|it|expect|vitest|beforeAll|afterAll)\s*\(/;
// Identity signal — the anchor vocabulary #62 names ("who am I", maternal anchor, the five values).
const IDENTITY = /\b(maternal[\s_-]?anchor|who\s+am\s+i|the\s+five\s+values|MATERNAL_ANCHOR|identity[\s_-]?corpus|my\s+name\s+is)\b/i;
const ARCHITECTURE = /\b(architecture|boundary|boundaries|safety\s+law|ARCHITECTURE\.md|invariant)\b/i;
const EVIDENCE = /\b(receipt|evidence|proof|attestation|chain\s?hash|merkle)\b/i;
const DOC = /\b(readme|\.md\b|documentation|runbook|spec\b)\b/i;
const CODE = /\b(export\s+(function|const|class|interface|type)|import\s+\{|=>\s*\{|module\.exports)\b/;

function haystack(record: MemoryRecordV1): string {
  return `${record.provenance}\n${record.content}`;
}

/**
 * Classify a record's scope. Precedence is DONOR-AUTHORITATIVE on structure (falsification cycle 2): a record
 * whose provenance is a test PATH/NAME, or whose content is literally test code (`describe(`/`it(`/`expect(`),
 * is TEST — even if it mentions identity vocabulary. This closes the re-pollution hole where a test file quoting
 * "maternal anchor" would masquerade as an identity atom and re-fill the empty shelf with noise (the exact #62
 * failure, inverted). Only AFTER structural test-detection does content-signal apply: identity, then
 * architecture, evidence, doc, code, general. So genuine identity CONTENT under a non-test provenance surfaces,
 * while a test that merely discusses identity does not.
 */
export function classifyScope(record: MemoryRecordV1): MemoryScope {
  const hay = haystack(record);
  if (TEST_PATH.test(hay) || TEST_NAME.test(hay) || TEST_BODY.test(record.content)) return 'test';
  if (IDENTITY.test(hay)) return 'identity';
  if (ARCHITECTURE.test(hay)) return 'architecture';
  if (EVIDENCE.test(hay)) return 'evidence';
  if (DOC.test(hay)) return 'doc';
  if (CODE.test(record.content)) return 'code';
  return 'general';
}

/** Live-only scope census — the #62 diagnostic (`identity:0, tests:70, …`). Forgotten records are excluded. */
export function scopeCensus(records: readonly MemoryRecordV1[], forgotten: ReadonlySet<string> = new Set()): Readonly<Record<MemoryScope, number>> {
  const census: Record<MemoryScope, number> = { identity: 0, architecture: 0, evidence: 0, doc: 0, test: 0, code: 0, general: 0 };
  for (const r of records) if (!forgotten.has(r.recordId)) census[classifyScope(r)] += 1;
  return census;
}

/**
 * Does the LIVE corpus hold any record of `scope`? The honest "is the shelf empty?" signal: a consumer can tell
 * "identity corpus absent" (`false`) from "retrieval bias" (`true` but the query missed) — the exact distinction
 * #62 demands. Forgotten records do not count (a forgotten identity atom is gone, not present).
 */
export function hasScope(records: readonly MemoryRecordV1[], scope: MemoryScope, forgotten: ReadonlySet<string> = new Set()): boolean {
  for (const r of records) if (!forgotten.has(r.recordId) && classifyScope(r) === scope) return true;
  return false;
}
