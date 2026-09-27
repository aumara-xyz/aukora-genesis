// aukora · core/witness/law.mjs — the law file, and what "protected" means
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
 * WHICH POLICY JUDGED THIS — stamped into every receipt, and a different question from every other
 * version in this organ.
 *
 * `LAW_SCHEMA` versions the FILE FORMAT. `RECEIPT_VERSION` versions the LINE FORMAT. Neither answers
 * the one an auditor actually arrives with: what did "allowed" MEAN when this verdict was reached?
 *
 * Deny-by-default landing did not change the law file's schema by one character, and it did not
 * change the receipt line by one byte. It changed the meaning of every `allowed` in the record
 * completely. Before this field, a receipt written under the denylist and a receipt written under
 * deny-by-default were indistinguishable — so a record produced under weaker rules could be
 * presented as one produced under stronger ones, with every hash intact and nothing to notice. That
 * is a downgrade, and a hash chain is structurally blind to it.
 *
 * It lives in `law.mjs` rather than beside `RECEIPT_VERSION` because the thing it versions is HERE:
 * the protected set, the allow-list polarity, and the interpretation `guard.mjs` puts on them. The
 * chain module imports it and holds no opinion about it, which is the same reason signing is
 * injected there rather than imported.
 *
 * ══ WHEN TO BUMP IT ══
 *
 * When the SEMANTICS of a verdict change — a new refusal class, a change in what an existing class
 * covers, a change of polarity. Not when a rule is added to `aukora.law.json`; that is the owner
 * editing their own law, and `checkLawAuthority` already hashes those bytes and compares them to
 * what was signed. The two are complementary and neither substitutes for the other: the anchor says
 * "this is the law the owner blessed", this says "these are the semantics that read it".
 *
 * v1 is the first, and it is stamped from the commit that adds it onward. Receipts written before
 * carry no `policyVersion`, and `verify` reports that as `null` rather than assuming they were
 * judged under v1 — the honest answer about a record that predates the question.
 */
export const POLICY_VERSION = 'aukora-policy-v1';

/**
 * What `init` writes, and what a missing/broken law falls back to.
 *
 * ── SELF-PROTECTION IS LOAD-BEARING ──
 *
 * `aukora.law.json` and `.claude/settings.json` are on this list because a
 * fence an agent can edit is a suggestion. The agent must not be able to widen
 * its own permissions or unhook the guard through its own file tools.
 *
 * `.aukora/**` is on it because of what stays in the tree: the signed anchors
 * (`.aukora/anchors/<kind>.jsonl`) and the cached repository identity that keys the chain — and, in a
 * directory that is not a git repository, the chain itself.
 *
 * For a git repository the chain is NOT here. It lives at `~/.aukora/chains/<identity>.jsonl`, outside
 * the tree, for exactly the reason this rule gives — an agent that can rewrite the chain can rewrite
 * the record of what it did — and out there it is covered by `writesOutsideRepo`, not by this rule.
 */
export const DEFAULT_PROTECTED = Object.freeze([
  // ── THE CONSTITUTION WAS NOT IN ITS OWN SELF-PROTECTION SET ──
  //
  // A red-team exercise was asked to overwrite LAW.md and leave `verify` exiting 0. It succeeded, and
  // the part worth keeping is that it needed NO EXPLOIT. `aukora.law.json` is signed, anchored and
  // hardcoded here; LAW.md was protected only because the committed law file happened to list it.
  //
  // Measured: one shell edit setting `protected: []`, and the FENCE ITSELF then allowed an ordinary
  // `Write` to LAW.md (guard exit 0) while still refusing `aukora.law.json` (exit 2). The machine-law
  // defended itself and the human law delegated its defence to a mutable file — backwards, because the
  // whole point of a self-protection set is that the gate cannot be disarmed, and the sentence the gate
  // exists to enforce lived outside it.
  //
  // This does NOT make LAW.md unwritable. The shell escape of LIMITS §1 is unchanged and undefeated: a
  // `>` redirect still overwrites it and the chain still records only that a shell was used. What this
  // closes is the front door — a declared write, through the fence, with the law emptied.
  'LAW.md',
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
  // THE ALLOW-LIST, and `null` is load-bearing.
  //
  // `null` means "not in force": the repository has not adopted deny-by-default and the fence behaves
  // exactly as it did before this field existed. `[]` means "in force, and nothing is writable" — a
  // real declaration, obeyed literally. Absent must never collapse into empty, or the commit that
  // lands this feature refuses every write in every repository that has not yet declared a set,
  // including the one making the commit, halfway through making it.
  writable: null,
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

/**
 * The strict default, returned whenever the law on disk cannot be believed.
 *
 * ONE HELPER RATHER THAN FIVE LITERALS, and the reason is `writableRules`. There are five ways to
 * fail to read a law — absent, unreadable, malformed, not-an-object, wrong-schema — and every one of
 * them must answer the allow-list question too. Written out five times, the failure mode is that
 * someone adds a sixth and forgets: `writableRules` comes back `undefined`, which is falsy, which
 * reads as "no allow-list in force" — the polarity silently switching OFF on the exact inputs where
 * a fence should be strictest. A corrupt law must not open the gate, and that includes this gate.
 *
 * `writableRules: null` is correct here rather than lazy: `DEFAULT_LAW.writable` is `null`, so a node
 * with no readable law has not declared a writable set and deny-by-default is not in force. The
 * fallback protects by DENYLIST, exactly as it always has.
 */
const strictDefault = (reason) => ({
  ok: false, reason, law: DEFAULT_LAW, rules: compileAll(DEFAULT_LAW.protected), writableRules: null,
});

/** Read the law, or say why it could not be read. Never throws. */
export function loadLaw(repoRoot) {
  let text;
  try {
    text = readFileSync(join(repoRoot, LAW_FILE), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return strictDefault('no-law');
    return strictDefault(`unreadable-law: ${err?.message ?? 'unknown'}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // A law we cannot parse is not a law we can obey. Fall back to the strict
    // default rather than to nothing — a corrupt file must not open the gate.
    return strictDefault(`malformed-law: ${err?.message ?? 'unknown'}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return strictDefault('law-not-an-object');
  }
  if (parsed.schema !== LAW_SCHEMA) {
    return strictDefault(`law-schema-mismatch: ${String(parsed.schema)}`);
  }

  const declared = Array.isArray(parsed.protected) ? parsed.protected.filter((p) => typeof p === 'string' && p.length > 0) : [];
  // The self-protection set is not optional. A law that removes `aukora.law.json`
  // from its own protected list is a law that can be edited to say anything, so
  // the defaults are unioned in rather than replaced.
  const merged = [...new Set([...DEFAULT_PROTECTED, ...declared])];

  // THE ALLOW-LIST — and `Array.isArray` is the entire distinction between two very different laws.
  //
  //     no `writable` key at all  ->  null  ->  not in force, the fence behaves as it always has
  //     "writable": []            ->  []    ->  in force, and nothing is writable
  //
  // Collapsing those two would mean every repository that has not yet declared a set gets every write
  // refused the moment it picks up this version. Deny-by-default begins when a law SAYS so.
  //
  // The same string filter the protected list uses, and for the same reason: a non-string in the
  // array would compile to a pattern nobody wrote.
  const declaredWritable = Array.isArray(parsed.writable)
    ? parsed.writable.filter((p) => typeof p === 'string' && p.length > 0)
    : null;

  const law = {
    ...DEFAULT_LAW,
    ...parsed,
    protected: merged,
    writable: declaredWritable,
    writesOutsideRepo: parsed.writesOutsideRepo === 'receipt' ? 'receipt' : 'refuse',
    unguardedTools: parsed.unguardedTools === 'ignore' ? 'ignore' : 'receipt',
    aumlokGrantsAuthority: false,
    auraIsTraceOnly: true,
  };
  return {
    ok: true, reason: null, law, rules: compileAll(merged),
    writableRules: declaredWritable === null ? null : compileAll(declaredWritable),
  };
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

/**
 * Is EVERY resolved name of this path declared writable?
 *
 * ══ EVERY, NOT ANY — AND THAT IS THE WHOLE SECURITY PROPERTY ══
 *
 * `analyse()` hands over every alias of the same object. Conformance case 04 folds to TWO keys: the
 * innocent `world/mind.md` a rule may well declare, and the `law.js` it actually resolves to. ANY-key
 * semantics allow the write on the first key and land the bytes on the second — which is the AURA
 * incident of 2026-07-27 arriving again through the new polarity, the gate returning `admitted` while
 * a ring-0 file changes through a lawful-looking path.
 *
 * Measured against the real corpus before this function was written:
 *
 *     allow=["world/mind.md"]  ANY-key     11 of 12   case 04 allows
 *     allow=["world/mind.md"]  EVERY-key   12 of 12
 *
 * ══ AN EMPTY KEY SET IS REFUSED, NOT VACUOUSLY ALLOWED ══
 *
 * `[].every(...)` is `true`, so the obvious one-liner admits exactly the paths the resolver could say
 * nothing about — a path with no keys is one `analyse` declined to place, and a deny-by-default fence
 * that admits the unplaceable has inverted itself on its worst input. Named here rather than left to
 * a reader of `Array.prototype`.
 *
 * The failing key is returned so the refusal can name WHICH spelling was undeclared. On case 04 that
 * is `law.js`, which is a far more useful sentence than the innocent name the tool asked for.
 */
export function judgeWritable(writableRules, keys) {
  if (!keys.length) return { declared: false, key: null };
  for (const key of keys) {
    if (!writableRules.some((rule) => rule.test(key))) return { declared: false, key };
  }
  return { declared: true, key: null };
}
