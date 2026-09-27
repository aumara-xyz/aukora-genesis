// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Change-risk classifier — a PURE function: given a set of proposed changed files + a diff, decide
 * whether the change is HIGH risk (must pause, never auto-apply) or LOW. No host, no engine, no live
 * repo, no spawn, no write — just classification. Sensitive paths, secret-bearing diff content, and
 * broad rewrites are HIGH. (Extracted seed-native from the old host engine; the proof that the gate
 * refuses catastrophes — catastropheScenarios — runs the REAL classifier here.)
 */
export type HostRisk = 'low' | 'high';
export interface HostChangedFile { path: string; status: 'modified' | 'added' | 'deleted'; afterContent?: string }

const BROAD_FILE_COUNT = 8;        // > this many files → broad rewrite → HIGH risk
const BROAD_LINE_COUNT = 400;      // > this many changed lines → broad rewrite → HIGH risk

// HIGH-risk PATH patterns — any match pauses (never auto-applies), even inside an unlocked session.
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/(^|\/)\.env(\.|$)/, 'env file'],
  [/(^|\/)secrets?(\/|\.|$)/i, 'secrets'],
  [/\.(key|pem|p12|keystore)$/i, 'key material'],
  [/auth\.json$/i, 'auth file'],
  [/admin[-_]?key/i, 'admin key'],
  [/(^|\/)\.aukora\//, 'aukora identity dir'],
  [/aumlok/i, 'AUMLOK authority code'],
  [/manifestSigner|kernelSigner|\bsigner\b/i, 'signer/authority code'],
  [/structuredTruth/i, 'structured-truth authority'],
  [/(^|\/)node-template\/convex\//, 'kernel/convex authority code'],
  [/(^|\/)\.github\/workflows\//, 'CI workflow'],
  [/(^|\/)PATENTS?/i, 'patent file'],
  [/package\.json$|package-lock|bun\.lock|yarn\.lock|pnpm-lock/i, 'dependency/manifest'],
  [/(^|\/)\.git\//, 'git internals'],
  [/id_rsa|credentials/i, 'credentials'],
  [/aukoraGate|sandboxApply|changeRiskClassifier/i, 'authority / apply-gate / risk code'], // editing the gate's own code is high-risk
  [/vite\.config/i, 'dev-server / apply-gate config'],
];

// HIGH-risk CONTENT patterns — a path denylist "fails open" (a secret in a normal-named file would be
// LOW); so ALSO scan the ADDED diff lines for apparent secret material → HIGH, path notwithstanding.
const SECRET_CONTENT_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{16,}/, 'apparent API key (sk-)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*['"][A-Za-z0-9_\-./+]{16,}['"]/i, 'hardcoded credential'],
];

/** True iff `line` matches any of the trusted secret-content patterns above (AWS/GitHub/Slack keys,
 *  PEM blocks, sk-keys, hardcoded credentials). Exported so any read-only surface that must WITHHOLD a
 *  secret-shaped line (e.g. the #105 diff preview) shares this ONE detector rather than a narrower copy —
 *  the exact gap an adversarial review found: the preview's other scanner missed AWS/GitHub/Slack/hardcoded. */
export function lineHasSecretContent(line: string): boolean {
  return typeof line === 'string' && SECRET_CONTENT_PATTERNS.some(([re]) => re.test(line));
}

/** Classify risk from the changed paths + ADDED diff content + diff size. HIGH → must pause (never auto-apply). */
export function classifyRisk(files: HostChangedFile[], diff: string): { risk: HostRisk; reasons: string[] } {
  const reasons: string[] = [];
  for (const f of files) {
    for (const [re, label] of SENSITIVE_PATTERNS) if (re.test(f.path)) { reasons.push(`${f.path}: ${label}`); break; }
    if (f.status === 'deleted') reasons.push(`${f.path}: deletion`);
  }
  // content scan — only the ADDED lines (a credential introduced by this edit), never path-trusting.
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  for (const [re, label] of SECRET_CONTENT_PATTERNS) if (re.test(added)) { reasons.push(`secret in diff content: ${label}`); break; }
  if (files.length > BROAD_FILE_COUNT) reasons.push(`broad rewrite: ${files.length} files`);
  const addedRemoved = (diff.match(/^[+-]/gm) || []).length;
  if (addedRemoved > BROAD_LINE_COUNT) reasons.push(`broad rewrite: ~${addedRemoved} changed lines`);
  return { risk: reasons.length ? 'high' : 'low', reasons };
}
