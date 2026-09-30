// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Upstream: aumara-xyz/aukora-phi core/memory/containment.ts
// Commit: a099901ad5a2d623c5343263de6ae5f9994d3159
// SHA-256: vendor/aukora-governed-recall/PROVENANCE.json#/files/2/sha256
// Subtractive JavaScript port: selected function bodies; TypeScript types erased.

export function evidenceGrantsAuthority() {
  return false;
}

function quarantine(reason) {
  return { disposition: 'quarantine', grantsAuthority: false, reason };
}

export function classifyEvidence(r) {
  if (!r.hasAuditSummary) return quarantine('untranslatable: no decode-to-audit summary');
  if (!r.codebookKnown) return quarantine('unknown codebook / unregistered representation');
  if (!r.finite) return quarantine('non-finite evidence markers (NaN/Infinity)');
  if (!r.withinBounds) return quarantine('out-of-bounds evidence (size/dimension)');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'readable; advisory only' };
}

export function mayDisplayAsAdvisory(r) {
  return classifyEvidence(r).disposition === 'readable_advisory';
}

export function decodeToAuditVerdict(a) {
  if (a.threwDuringDecode) return quarantine('decoder failure is quarantine, not passthrough');
  if (!a.decoded || !a.auditSummary) return quarantine('no decode-to-audit summary before display');
  return { disposition: 'readable_advisory', grantsAuthority: false, reason: 'decoded to audit summary; display is advisory only' };
}
