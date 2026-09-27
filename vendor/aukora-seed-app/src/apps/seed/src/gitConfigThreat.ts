// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Git config threat classifier (#22 overnight · HARDEN GIT: malicious config / filters / textconv / submodules).
 *
 * The candidate-stage git cell already DISABLES hostile config through a minimal environment (empty HOME/XDG,
 * system+global config off, hooksPath=/dev/null). This is the complementary DETECTION primitive: given a git
 * config as `git config -l` lines (`section.key=value`), it classifies any directive that can execute a command
 * or redirect a fetch — so a caller can refuse LOUDLY and audit, rather than only silently neutralizing.
 *
 * Pure string classification; no git, no I/O; grants no authority. It is deliberately conservative: an unknown
 * key is NOT flagged (this reports known-dangerous directives), and a `!`-shell alias is flagged by its value.
 */

export interface ConfigThreat {
  readonly key: string;               // the offending config key (lowercased section.key)
  readonly reasonClass: string;       // a stable threat class
}

export interface ConfigThreatReport {
  readonly ok: boolean;               // ok === (threats.length === 0)
  readonly threats: readonly ConfigThreat[];
}

// Directives that can run a command or redirect a fetch. Matched case-insensitively against the lowercased key.
// Each entry is [matcher, reasonClass]; a matcher is either an exact key or a RegExp over the full key.
const DANGEROUS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^core\.hookspath$/, 'config:hooks-path'],
  [/^core\.fsmonitor$/, 'config:fsmonitor-command'],
  [/^core\.sshcommand$/, 'config:ssh-command'],
  [/^core\.(editor|pager|askpass)$/, 'config:external-command'],
  [/^filter\..+\.(clean|smudge|process)$/, 'config:filter-driver'],
  [/^diff\..+\.(textconv|command)$/, 'config:textconv-command'],
  [/^merge\..+\.driver$/, 'config:merge-driver'],
  [/^url\..+\.insteadof$/, 'config:url-rewrite'],
  [/^url\..+\.pushinsteadof$/, 'config:url-rewrite'],
  [/^submodule\..+\.url$/, 'config:submodule-url'],
  [/^credential\..*helper$/, 'config:credential-helper'],
  [/^protocol\..+\.allow$/, 'config:protocol-allow'],
  [/^remote\..+\.(url|pushurl|uploadpack|receivepack)$/, 'config:remote'],
  [/^gpg\..*program$/, 'config:gpg-program'],
];

/** Parse one `git config -l` line `section.key=value` → [lowercased key, value] or null. */
function parseLine(line: string): readonly [string, string] | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim().toLowerCase();
  const value = line.slice(eq + 1);
  if (key.length === 0) return null;
  return [key, value];
}

/** Classify a git config given as `git config -l` lines. Returns every known-dangerous directive present. */
export function scanGitConfigThreats(configLines: readonly string[]): ConfigThreatReport {
  const threats: ConfigThreat[] = [];
  for (const raw of configLines) {
    const parsed = parseLine(raw);
    if (parsed === null) continue;
    const [key, value] = parsed;
    // An alias is dangerous ONLY when its value is a shell escape (`!command`) — a plain alias is benign.
    if (/^alias\..+$/.test(key)) {
      if (value.trimStart().startsWith('!')) threats.push({ key, reasonClass: 'config:shell-alias' });
      continue;
    }
    for (const [matcher, reasonClass] of DANGEROUS) {
      if (matcher.test(key)) { threats.push({ key, reasonClass }); break; }
    }
  }
  return { ok: threats.length === 0, threats };
}

/** Convenience over a multi-line config blob (splits on newlines). */
export function scanGitConfigBlob(configText: string): ConfigThreatReport {
  return scanGitConfigThreats(configText.split('\n'));
}

/** HARD: this classifier reads text and reports; it runs no git and grants no authority. Constant. */
export function gitConfigThreatGrantsAuthority(): false {
  return false;
}
