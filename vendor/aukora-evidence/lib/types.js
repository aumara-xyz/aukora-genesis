// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * EvidencePack v1 — pure types and stable error codes. See docs/EVIDENCEPACK_V1.md (the contract,
 * Round-11 settled). No filesystem, environment, network, subprocess, or authority. The literal
 * fields advisoryOnly:true / grantsAuthority:false are load-bearing invariants: a pack is evidence,
 * never authority.
 *
 * Settled contract highlights: snapshot-primary subject (repoId + head + optional base pair, NO
 * diffSha256); testRuns[] is the only evidence (no narrative claims, no timestamp); the fence is
 * derived from packDigest at presentation, never stored; catalogueId is bound; security ceilings come
 * from a registered immutable limits profile, never self-declared; omission reasons are a closed enum.
 */
export const EVIDENCE_PACK_SCHEMA = 'aukora-fu-evidence-pack-v1';
/** Closed enumeration of omission reason codes (contract decision 10 — never narrative prose). */
export const OMISSION_REASONS = [
    'outside-root', 'not-in-allowlist', 'symlink', 'non-regular', 'cross-device', 'binary', 'oversize',
    'secret-file', 'unreadable', 'changed-during-read', 'truncated', 'path-invalid',
];
export const LIMITS_PROFILES = {
    'default-v1': { maxFileBytes: 1048576, maxPackBytes: 8388608, maxFiles: 4096 },
};
export const ERROR_CODES = [
    'E_SCHEMA', 'E_NOT_OBJECT', 'E_MISSING_FIELD', 'E_UNKNOWN_FIELD', 'E_WRONG_TYPE', 'E_ADVISORY_LITERAL',
    'E_AUTHORITY_SHAPED_KEY', 'E_NOT_NFC', 'E_REL_PATH', 'E_NUL', 'E_INVALID_UTF8', 'E_BAD_INTEGER',
    'E_BAD_SHA', 'E_BAD_GITSHA', 'E_BASE_PAIR', 'E_ARRAY_UNSORTED', 'E_DUP_PATH', 'E_DUP_TEST',
    'E_BAD_RANGE', 'E_BINARY_INLINE', 'E_BAD_ENUM', 'E_CONTENT_LENGTH', 'E_SECRET_CONTENT',
    'E_OMISSION_REASON', 'E_LIMIT_PROFILE', 'E_LIMIT_FILES', 'E_LIMIT_FILE_BYTES', 'E_LIMIT_PACK_BYTES',
    'E_CATALOGUE_ID', 'E_DIGEST_MISMATCH', 'E_HASH_INCLUDED', 'E_HASH_COMPLETE', 'E_BASE64_NONCANONICAL',
    'E_PARTITION', 'E_MAP_KEY', 'E_MAP_VALUE_NFC', 'E_CWD',
    'E_PROTO', 'E_STREAM_LENGTH', 'E_STREAM_HASH', 'E_LIMIT_ALLOWLIST',
];
