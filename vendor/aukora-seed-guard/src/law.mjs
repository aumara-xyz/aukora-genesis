// aukora · src/law.mjs — the law file, and what "protected" means
//
// The law is a small JSON file at the repo root. It declares paths, and nothing
// else. It grants no authority, describes no capability, and carries no policy
// engine. If it ever needs a policy engine, the design has gone wrong.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { foldPath } from './paths.mjs';

export const LAW_FILE = 'aukora.law.json';
export const LAW_SCHEMA = 'aukora-law-v0';

/**
 * What `init` writes, and what a missing/broken law falls back to.
 *
 * ── SELF-PROTECTION IS LOAD-BEARING ──
 *
 * `aukora.law.json` and `.claude/settings.json` are on this list because a
 * fence an agent can edit is a suggestion. The agent must not be able to widen
 * its own permissions or unhook the guard through its own file tools.
 *
 * `.aukora/**` is on it because the receipt chain is the product. An agent that
 * can rewrite the chain can rewrite the record of what it did.
 */
export const DEFAULT_PROTECTED = Object.freeze([
  'aukora.law.json',
  'aukora.pub',
  '.aukora/**',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.git/**',
]);

/**
 * Written by `init` on top of the self-protection set, and removable.
 *
 * The self-protection set exists so the gate cannot be disarmed. This set exists
 * because a law that protects only Aukora's own files, and none of the owner's,
 * is a demo of a fence rather than a fence. These are the paths almost everyone
 * means when they say "not that" — and being wrong here costs an edit to a JSON
 * file, while being silent costs a leaked key.
 */
export const SUGGESTED_PROTECTED = Object.freeze([
  '.env',
  '.env.*',
  '**/*.pem',
  '**/*.key',
  'secrets/**',
  'credentials/**',
  '**/id_rsa',
  '**/id_ed25519',
]);

export const DEFAULT_LAW = Object.freeze({
  schema: LAW_SCHEMA,
  protected: [...DEFAULT_PROTECTED, ...SUGGESTED_PROTECTED],
  // Writes to paths outside the repository root. The law is repo-scoped, so a
  // write that leaves the repo has left the thing the law describes.
  writesOutsideRepo: 'refuse',
  // Tool calls the guard cannot inspect (Bash, and anything it does not know).
  // 'receipt' records an `unguarded` receipt so the chain shows its own edges.
  unguardedTools: 'receipt',
  // Declared, and surfaced by `aukora verify`, so neither claim can drift into
  // marketing without someone editing a file that says it out loud.
  aumlokGrantsAuthority: false,
  auraIsTraceOnly: true,
});

/**
 * Compile one pattern to a matcher.
 *
 * Supported, and no more: `**` across segments, `*` within a segment, `?` for
 * one character. Anything else is a literal.
 *
 * ── ROOT OR DESCENDANT, NOT DESCENDANT ONLY ──
 *
 * Every match also covers everything beneath it. `law` protects `law` AND
 * `law/x`; `law/**` protects `law` too. A rule that covered only the descendants
 * would leave the directory entry itself writable, which is the same defect
 * three times over: a bare name slipping past a rule written with a slash.
 */
export function compilePattern(pattern) {
  const raw = String(pattern ?? '');
  // Fold to the same key space paths are folded into, then drop a trailing
  // `/**` so the base itself is covered by the root-or-descendant wrap below.
  let p = foldPath(raw.replace(/\/+$/u, ''));
  p = p.replace(/\/\*\*$/u, '');

  let body = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` consumes whole segments including none; bare `**` is anything.
        if (p[i + 2] === '/') { body += '(?:[^/]+/)*'; i += 2; } else { body += '.*'; i += 1; }
      } else {
        body += '[^/]*';
      }
    } else if (c === '?') {
      body += '[^/]';
    } else {
      body += c.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    }
  }

  // The wrap is the root-or-descendant rule.
  const re = new RegExp(`^(?:${body})(?:/.*)?$`, 'u');
  return { source: raw, test: (key) => re.test(key), regex: re };
}

export function lawPath(repoRoot) {
  return join(repoRoot, LAW_FILE);
}

/**
 * The law file's raw bytes.
 *
 * Exists so that "which bytes are the law" has ONE definition. `loadLaw` parses
 * them into an effective law with the self-protection set merged in;
 * `authority.mjs` hashes them to decide whether the owner blessed this exact
 * file. Those are different questions about the same bytes, and a second
 * `readFileSync(join(root, 'aukora.law.json'))` somewhere else is how the two
 * answers would eventually come to be about different files.
 *
 * Returns a Buffer, not a string. A hash over decoded text would silently
 * normalise a BOM or an invalid sequence; the signature is over what is on disk.
 */
export function readLawBytes(repoRoot) {
  try {
    return { ok: true, buffer: readFileSync(lawPath(repoRoot)) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'no-law' };
    return { ok: false, reason: `unreadable-law: ${err?.message ?? 'unknown'}` };
  }
}

/** Read the law, or say why it could not be read. Never throws. */
export function loadLaw(repoRoot) {
  let text;
  try {
    text = readFileSync(join(repoRoot, LAW_FILE), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ok: false, reason: 'no-law', law: DEFAULT_LAW, rules: compileAll(DEFAULT_LAW.protected) };
    }
    return { ok: false, reason: `unreadable-law: ${err?.message ?? 'unknown'}`, law: DEFAULT_LAW, rules: compileAll(DEFAULT_LAW.protected) };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // A law we cannot parse is not a law we can obey. Fall back to the strict
    // default rather than to nothing — a corrupt file must not open the gate.
    return { ok: false, reason: `malformed-law: ${err?.message ?? 'unknown'}`, law: DEFAULT_LAW, rules: compileAll(DEFAULT_LAW.protected) };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'law-not-an-object', law: DEFAULT_LAW, rules: compileAll(DEFAULT_LAW.protected) };
  }
  if (parsed.schema !== LAW_SCHEMA) {
    return { ok: false, reason: `law-schema-mismatch: ${String(parsed.schema)}`, law: DEFAULT_LAW, rules: compileAll(DEFAULT_LAW.protected) };
  }

  const declared = Array.isArray(parsed.protected) ? parsed.protected.filter((p) => typeof p === 'string' && p.length > 0) : [];
  // The self-protection set is not optional. A law that removes `aukora.law.json`
  // from its own protected list is a law that can be edited to say anything, so
  // the defaults are unioned in rather than replaced.
  const merged = [...new Set([...DEFAULT_PROTECTED, ...declared])];

  const law = {
    ...DEFAULT_LAW,
    ...parsed,
    protected: merged,
    writesOutsideRepo: parsed.writesOutsideRepo === 'receipt' ? 'receipt' : 'refuse',
    unguardedTools: parsed.unguardedTools === 'ignore' ? 'ignore' : 'receipt',
    aumlokGrantsAuthority: false,
    auraIsTraceOnly: true,
  };
  return { ok: true, reason: null, law, rules: compileAll(merged) };
}

export function compileAll(patterns) {
  return patterns.map(compilePattern);
}

/**
 * Does the law protect this path?
 *
 * Takes the fold-keys produced by `analyse()` — every alias of the same object
 * collapsed to the same key space — and refuses if ANY of them matches ANY rule.
 */
export function judge(rules, keys) {
  for (const key of keys) {
    for (const rule of rules) {
      if (rule.test(key)) return { protected: true, rule: rule.source, key };
    }
  }
  return { protected: false, rule: null, key: null };
}
