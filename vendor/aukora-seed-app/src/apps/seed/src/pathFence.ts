// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Repo path fence (pure) — classifies a repo-relative path so Auma's inward IDE envelope can reason over the whole
 * repo WITHOUT ever bypassing the authority/secret boundaries.
 *
 *   - SECRET paths (key material, .env, credentials) are never read and never candidate-able — fail closed both ways.
 *   - SACRED paths (root release files, .git/.github, models, other lanes' apps, kernel conformance) may be READ
 *     (Auma may reason about them) but never candidate-able (she may never propose changing them).
 *   - AUTHORITY paths (owner custody / hybrid verification) may be READ (reasoning) but never candidate-able —
 *     "see everything" never means editing the authority fence.
 *   - ALLOWED paths (ordinary non-sacred source) are readable and candidate-able within the owner-minted envelope.
 *   - INVALID paths (absolute, traversal, hostile shape) fail closed everywhere.
 *
 * Every refusal carries a STABLE reason class and quotable text. Pure: no I/O, no authority, no mutation.
 */

export type PathClass = 'allowed' | 'authority' | 'sacred' | 'secret' | 'invalid';

export type FenceReasonClass =
  | 'fence:ok'
  | 'fence:invalid-path'
  | 'fence:secret-path'
  | 'fence:sacred-path'
  | 'fence:authority-path';

export interface PathVerdict {
  readonly path: string;
  readonly class: PathClass;
  readonly reasonClass: FenceReasonClass;
  readonly text: string;
}

const REASON_TEXT: Record<FenceReasonClass, string> = {
  'fence:ok': 'path is within the allowed envelope',
  'fence:invalid-path': 'refused: path is absolute, traversing, or malformed — outside the repo-relative envelope',
  'fence:secret-path': 'refused: secret/credential path — Auma never reads or proposes changes to key material',
  'fence:sacred-path': 'refused: sacred path — readable for reasoning, never candidate-able (owner-only)',
  'fence:authority-path': 'refused: authority path — readable for reasoning, never candidate-able (owner-only custody/verification)',
};

// A conservative repo-relative path: forward slashes, no leading slash, no traversal, no NUL/backslash.
const SAFE_PATH = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/;

const SECRET = [
  /(^|\/)\.env(\.[^/]*)?$/i,
  /(^|\/)secrets?\//i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.[^/]*)?$/i,
  /(^|\/)credentials?(\.[^/]*)?$/i,
];

const SACRED = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.github(\/|$)/i,
  /^(LICENSE|NOTICE|SECURITY\.md|CLAIMS\.md|CONTRIBUTING\.md|README\.md|ARCHITECTURE\.md)$/,
  /^package(-lock)?\.json$/,
  /(^|\/)models(\/|$)/i,
  /^apps\/(brain|console)\//,
  /^packages\/kernel\/(conformance|SBOM\.cdx\.json|examples)(\/|$)/,
];

const AUTHORITY = [
  /authority/i,
  /aumlok(gate|signer)/i,
  /ownerfixture/i,
];

/**
 * SELF-PROTECTING paths — the fence's own enforcement code and everything that authorizes, gates, or verifies the
 * one effectful path. These are refused for CANDIDATE materialization UNCONDITIONALLY, checked BEFORE and
 * INDEPENDENTLY of the SACRED/AUTHORITY tables above — so even if a parsed allowlist is EMPTY or STALE, the fence,
 * the candidate stage, the ceremony runner, the doors, the kernel authority/reducer/schema, and the provenance/
 * boundary/CI scripts + workflows can NEVER become candidate-able. This list is frozen and cannot be emptied.
 */
const SELF_PROTECTING: readonly RegExp[] = Object.freeze([
  // the fence itself + the effectful/authorization surfaces (apps/seed and any mirror)
  /(^|\/)pathFence\.ts$/,
  /(^|\/)localCandidateStage\.ts$/,
  /(^|\/)candidateReferenceMonitor\.ts$/,
  /(^|\/)localCeremonyRunner\.ts$/,
  /(^|\/)aumlokGate\.ts$/,
  /(^|\/)ownerFixture\.ts$/,
  /(^|\/)mindDoor\.ts$/,
  /(^|\/)doorGuards\.ts$/,
  /(^|\/)providerTransport\.ts$/,
  /(^|\/)fuStructuredAdapter\.ts$/,
  /(^|\/)forbiddenContent\.ts$/,
  // WAVE 2 — the AUMLOK ceremony authority membrane (approve/bind door + guard + challenge + custody + bond)
  /(^|\/)approveDoor\.ts$/,
  /(^|\/)approveGuard\.ts$/,
  /(^|\/)approveChallenge\.ts$/,
  /(^|\/)ownerCustody\.ts$/,
  /(^|\/)bondCeremony\.ts$/,
  // R45/R47/R48 — the proposer containment surface (a mind/crossing/model-cell must never edit its own gate)
  /(^|\/)proposerQualification\.ts$/,
  /(^|\/)governedCrossing\.ts$/,
  /(^|\/)modelCellAdapter\.ts$/,
  // the kernel authority core
  /^packages\/kernel\/src\/(authority|reducer|schema|registry|canonical|evidence|merkle)\.ts$/,
  /(^|\/)kernel\/(dist|conformance)\//,
  // provenance / boundary / CI scripts + workflows
  /^scripts\/(verify|generate|check)[-A-Za-z0-9]*\.mjs$/,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)scan-public-tree\.mjs$/,
]);

/** True if `path` is a self-protecting authority/enforcement surface — never candidate-able, table-independent. */
export function isSelfProtecting(path: string): boolean {
  return typeof path === 'string' && SELF_PROTECTING.some((re) => re.test(path));
}

/** Classify a repo-relative path. Total: never throws. */
export function classifyPath(rawPath: unknown): PathVerdict {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > 1024 || !SAFE_PATH.test(rawPath)) {
    return { path: typeof rawPath === 'string' ? rawPath.slice(0, 64) : '<non-string>', class: 'invalid', reasonClass: 'fence:invalid-path', text: REASON_TEXT['fence:invalid-path'] };
  }
  if (SECRET.some((re) => re.test(rawPath))) return { path: rawPath, class: 'secret', reasonClass: 'fence:secret-path', text: REASON_TEXT['fence:secret-path'] };
  // SELF-PROTECTING is checked BEFORE the mutable SACRED/AUTHORITY tables and independently of them.
  if (isSelfProtecting(rawPath)) return { path: rawPath, class: 'authority', reasonClass: 'fence:authority-path', text: REASON_TEXT['fence:authority-path'] };
  if (AUTHORITY.some((re) => re.test(rawPath))) return { path: rawPath, class: 'authority', reasonClass: 'fence:authority-path', text: REASON_TEXT['fence:authority-path'] };
  if (SACRED.some((re) => re.test(rawPath))) return { path: rawPath, class: 'sacred', reasonClass: 'fence:sacred-path', text: REASON_TEXT['fence:sacred-path'] };
  return { path: rawPath, class: 'allowed', reasonClass: 'fence:ok', text: REASON_TEXT['fence:ok'] };
}

/** May Auma READ this path? Everything except secret + invalid is readable (she may reason over the whole repo). */
export function readAllowed(verdict: PathVerdict): boolean {
  return verdict.class === 'allowed' || verdict.class === 'authority' || verdict.class === 'sacred';
}

/**
 * May Auma stage a CANDIDATE touching this path? Only ordinary allowed paths — never sacred/authority/secret/invalid,
 * and NEVER a self-protecting path. The self-protecting check runs FIRST and is TABLE-INDEPENDENT: even if the
 * SACRED/AUTHORITY allowlists were emptied or went stale, `classifyPath` would still not mark these `allowed`, and
 * this second, direct `isSelfProtecting` guard refuses them regardless of the verdict's class.
 */
export function candidateAllowed(verdict: PathVerdict): boolean {
  if (isSelfProtecting(verdict.path)) return false;
  return verdict.class === 'allowed';
}

/** The fence grants no authority — it only classifies and refuses. Constant, by construction. */
export function pathFenceGrantsAuthority(): false {
  return false;
}
