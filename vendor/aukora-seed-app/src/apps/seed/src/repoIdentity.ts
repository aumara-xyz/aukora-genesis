// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Canonical repository identity (R57A, Sam 4 spatial lane) — the PURE verdict half of the
 * candidate-stage repository guard. This module reads nothing and runs nothing (no fs, no
 * subprocess, no network — it sits on the containment runtime list); the ONE effectful adapter
 * (`localCandidateStage.ts`) performs the hardened read-only config read and hands the raw bytes
 * here for a verdict, BEFORE the reference monitor may consume an authorization nonce and BEFORE
 * any worktree/branch mutation.
 *
 * ACCEPTANCE LAW — byte identity only. An origin URL is canonical IFF it is byte-identical to one
 * of ACCEPTED_ORIGIN_FORMS. No suffix stripping, case folding, host normalization, or
 * parser-based acceptance: the loose parser below only improves the refusal detail (donor vs
 * foreign vs malformed) and can never admit a URL. Equivalent-in-practice spellings (case, default
 * ports, FQDN dots) are false-rejects by design — never loosen the matcher to admit them.
 *
 * These constants are compiled in deliberately (the guard must not trust anything the TARGET repo
 * could carry, including a planted manifest). The repository manifest `repository-identity.json`
 * at the repo root is the documented source of truth: the suite proves constant-for-constant
 * equality with it, and proves verdict parity with the manifest's shared adversarial vector table
 * against the root gate's twin (`scripts/repo-identity-core.mjs`), so the twins cannot drift.
 */

export const CANONICAL_REPOSITORY_IDENTITY = {
  host: 'github.com',
  owner: 'aumara-xyz',
  repository: 'aukora',
} as const;

export const ACCEPTED_ORIGIN_FORMS: readonly string[] = [
  'https://github.com/aumara-xyz/aukora',
  'https://github.com/aumara-xyz/aukora.git',
  'git@github.com:aumara-xyz/aukora',
  'git@github.com:aumara-xyz/aukora.git',
  'ssh://git@github.com/aumara-xyz/aukora',
  'ssh://git@github.com/aumara-xyz/aukora.git',
];

export const FORBIDDEN_REPOSITORY_IDENTITIES: readonly { owner: string; repository: string; reason: string }[] = [
  { owner: 'aumara-xyz', repository: 'aukora-symbiote', reason: 'read-only donor evidence — never a write target for any canonical lane' },
];

/** Typed refusal codes for the wrong-repository outcome of the candidate stage. */
export type RepoIdentityCode =
  | 'missing-origin'
  | 'extra-remote'
  | 'ambiguous-origin'
  | 'url-rewrite'
  | 'pushurl-mismatch'
  | 'donor-repository'
  | 'wrong-repository'
  | 'malformed-remote-config';

export type RepoIdentityVerdict =
  | { readonly ok: true; readonly originUrl: string; readonly pushUrl: string | null }
  | { readonly ok: false; readonly code: RepoIdentityCode; readonly detail: string };

export type OriginClassification =
  | { readonly verdict: 'canonical'; readonly url: string }
  | { readonly verdict: 'donor-repository' | 'foreign-repository' | 'malformed-origin'; readonly detail: string };

/** Best-effort owner/repo extraction for refusal DETAIL only — never an acceptance path. */
function bestEffortOwnerRepo(url: string): { owner: string; repo: string } | null {
  let m = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+\/([^/]+)\/([^/]+)$/); // scheme://host/owner/repo
  if (!m) m = url.match(/^[^@/]+@[^:/]+:([^/]+)\/([^/]+)$/); // user@host:owner/repo (scp form)
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Classify one origin URL. 'canonical' requires BYTE identity with an accepted form. */
export function classifyOriginUrl(url: string): OriginClassification {
  if (ACCEPTED_ORIGIN_FORMS.includes(url)) return { verdict: 'canonical', url };
  const shown = JSON.stringify(url.slice(0, 120));
  const parsed = bestEffortOwnerRepo(url);
  if (parsed) {
    const bareRepo = parsed.repo.endsWith('.git') ? parsed.repo.slice(0, -4) : parsed.repo;
    for (const f of FORBIDDEN_REPOSITORY_IDENTITIES) {
      if (parsed.owner === f.owner && bareRepo === f.repository) {
        return { verdict: 'donor-repository', detail: `origin ${shown} is the forbidden donor ${f.owner}/${f.repository} (${f.reason})` };
      }
    }
    return { verdict: 'foreign-repository', detail: `origin ${shown} is not byte-identical to any accepted canonical form` };
  }
  return { verdict: 'malformed-origin', detail: `origin ${shown} is not an accepted canonical form` };
}

/** Parse `git config -z --get-regexp` output: `<key>\n<value>` entries terminated by NUL, so
 *  values containing spaces or newlines cannot confuse the split. */
export function parseZConfig(zRaw: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  for (const chunk of (zRaw ?? '').split('\0')) {
    if (chunk.length === 0) continue;
    const i = chunk.indexOf('\n');
    entries.push(i === -1 ? { key: chunk, value: '' } : { key: chunk.slice(0, i), value: chunk.slice(i + 1) });
  }
  return entries;
}

/** Verdict over the raw `^(remote|url)\.` config of the TARGET repo. Law (same as the root gate):
 *  no url.* rewrite keys; remote names exactly {origin} (`remote.pushdefault=origin` allowed);
 *  exactly ONE byte-canonical remote.origin.url; canonical single pushurl when present; strict
 *  parsing refuses anything else. Fail closed throughout. */
export function evaluateRemoteConfig(zRaw: string): RepoIdentityVerdict {
  const entries = parseZConfig(zRaw);
  if (entries.length === 0) {
    return { ok: false, code: 'missing-origin', detail: 'no git remote is configured — repository identity cannot be established' };
  }
  const rewrite = entries.find((e) => e.key === 'url' || e.key.startsWith('url.'));
  if (rewrite !== undefined) {
    return { ok: false, code: 'url-rewrite', detail: `url.* rewrite keys are not permitted (${rewrite.key.slice(0, 120)})` };
  }
  const names = new Set<string>();
  const urls: string[] = [];
  const pushUrls: string[] = [];
  for (const e of entries) {
    const parts = e.key.split('.');
    if (parts[0] !== 'remote' || parts.length < 2 || parts.some((p) => p.length === 0)) {
      return { ok: false, code: 'malformed-remote-config', detail: `unexpected config key (${e.key.slice(0, 80)})` };
    }
    if (parts.length === 2) {
      if (parts[1] === 'pushdefault' && e.value === 'origin') continue;
      return { ok: false, code: 'malformed-remote-config', detail: `unexpected remote-section key (${e.key.slice(0, 80)}=${e.value.slice(0, 80)})` };
    }
    const name = parts.slice(1, -1).join('.');
    const leaf = parts[parts.length - 1];
    names.add(name);
    if (name === 'origin' && leaf === 'url') urls.push(e.value);
    if (name === 'origin' && leaf === 'pushurl') pushUrls.push(e.value);
  }
  const others = [...names].filter((n) => n !== 'origin').sort();
  if (others.length > 0) {
    return { ok: false, code: 'extra-remote', detail: `remotes beyond origin are not permitted (${others.join(', ').slice(0, 120)})` };
  }
  if (!names.has('origin') || urls.length === 0) {
    return { ok: false, code: 'missing-origin', detail: 'remote.origin.url is not configured — repository identity cannot be established' };
  }
  if (urls.length > 1) {
    return { ok: false, code: 'ambiguous-origin', detail: `remote.origin.url carries ${urls.length} values` };
  }
  const cls = classifyOriginUrl(urls[0]);
  if (cls.verdict !== 'canonical') {
    return { ok: false, code: cls.verdict === 'donor-repository' ? 'donor-repository' : 'wrong-repository', detail: cls.detail };
  }
  if (pushUrls.length > 1) {
    return { ok: false, code: 'malformed-remote-config', detail: `remote.origin.pushurl carries ${pushUrls.length} values` };
  }
  if (pushUrls.length === 1) {
    const pcls = classifyOriginUrl(pushUrls[0]);
    if (pcls.verdict !== 'canonical') {
      return { ok: false, code: pcls.verdict === 'donor-repository' ? 'donor-repository' : 'pushurl-mismatch', detail: pcls.detail };
    }
  }
  return { ok: true, originUrl: urls[0], pushUrl: pushUrls[0] ?? null };
}

/** HARD: identity verdicts grant nothing; they only refuse. Constant, by construction. */
export function repoIdentityGrantsAuthority(): false {
  return false;
}
