// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Upstream: aumara-xyz/aukora-phi core/memory/scope.ts
// Commit: a099901ad5a2d623c5343263de6ae5f9994d3159
// SHA-256: vendor/aukora-governed-recall/PROVENANCE.json#/files/16/sha256
// Subtractive JavaScript port: selected function bodies; TypeScript types erased.

export const MEMORY_SCOPES = ['identity', 'architecture', 'evidence', 'doc', 'test', 'code', 'general'];

const TEST_PATH = /(^|\/)tests?\//i;
const TEST_NAME = /\.(test|spec)\.[tj]sx?(\b|$)/i;
const TEST_BODY = /\b(describe|it|expect|vitest|beforeAll|afterAll)\s*\(/;
const IDENTITY = /\b(maternal[\s_-]?anchor|who\s+am\s+i|the\s+five\s+values|MATERNAL_ANCHOR|identity[\s_-]?corpus|my\s+name\s+is)\b/i;
const ARCHITECTURE = /\b(architecture|boundary|boundaries|safety\s+law|ARCHITECTURE\.md|invariant)\b/i;
const EVIDENCE = /\b(receipt|evidence|proof|attestation|chain\s?hash|merkle)\b/i;
const DOC = /\b(readme|\.md\b|documentation|runbook|spec\b)\b/i;
const CODE = /\b(export\s+(function|const|class|interface|type)|import\s+\{|=>\s*\{|module\.exports)\b/;

function haystack(record) {
  return `${record.provenance}\n${record.content}`;
}

export function classifyScope(record) {
  const hay = haystack(record);
  if (TEST_PATH.test(hay) || TEST_NAME.test(hay) || TEST_BODY.test(record.content)) return 'test';
  if (IDENTITY.test(hay)) return 'identity';
  if (ARCHITECTURE.test(hay)) return 'architecture';
  if (EVIDENCE.test(hay)) return 'evidence';
  if (DOC.test(hay)) return 'doc';
  if (CODE.test(record.content)) return 'code';
  return 'general';
}
