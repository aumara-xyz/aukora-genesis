// aukora · test/witness-allowlist.test.mjs — DENY-BY-DEFAULT, one case at a time
//
// ══ THE DECISION THIS IMPLEMENTS ══
//
// φ shipped a denylist: `protected: [...]`, refuse what is named, allow everything else. Five of the
// twelve conformance cases ask a different question — "is this path DECLARED writable?" — and the
// owner has chosen that polarity. `docs/POLARITY-PREREGISTRATION.md` is the measurement the choice
// was made from; this file is the fence being built to it, case by case.
//
// ══ THE TWO SUB-DECISIONS, AND WHY THEY ARE NOT ARBITRARY ══
//
// Measured against the real corpus before any code was written, the polarity reaches 12 of 12 under
// exactly ONE configuration, and each wrong choice loses precisely the case that motivated the change:
//
//     allow=[]                  EVERY-key   11 of 12   the CONTROL is refused -> degenerate -> VOID
//     allow=["world/mind.md"]   EVERY-key   12 of 12   <- this one
//     allow=["world/mind.md"]   ANY-key     11 of 12   case 04 allows: an alias walks in
//     allow=["world/**"]        EVERY-key   11 of 12   case 02 allows: the undeclared path walks in
//     allow=["world/**"]        ANY-key      9 of 12
//
// So: FILE-GRANULAR, and EVERY resolved key must be declared. A path that folds to two names — an
// innocent one and `law.js` — is refused on the second, which is the AURA incident of 2026-07-27 and
// the whole reason ANY-key is wrong.
//
// ══ ABSENT MEANS UNCHANGED ══
//
// A law that declares no `writable` list at all is NOT "nothing is writable". It means the allow-list
// is not in force and the fence behaves exactly as it does today. That is what makes this shippable:
// no repository is bricked by the feature landing, and deny-by-default begins the moment a law says
// so and not before. The last test in this file is that guarantee.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';

import { judgePaths } from '../core/witness/guard.mjs';
import { loadCorpus, declaredWritable } from '../conformance/corpus.ts';
import { build, destroy, verify } from '../conformance/sandbox.ts';

/**
 * φ's protected set, declared explicitly.
 *
 * `loadLaw` unions only DEFAULT_PROTECTED into a parsed law — the SUGGESTED patterns (`secrets`,
 * the `.pem` and `.key` globs, `.env`, …) live only in the no-law fallback. So a sandbox that gains a
 * law file loses them, and cases 06 and 11 would stop being refused BY THE RULE that names them and
 * start being refused as merely undeclared. Same verdict, weaker sentence. Declaring them keeps every
 * currently armed case refused for exactly the reason it is refused today.
 */
const PROTECTED = [
  'aukora.law.json', 'aukora.pub', '.aukora/**', '.claude/settings.json', '.claude/settings.local.json',
  '.git/**', '.env', '.env.*', '**/*.pem', '**/*.key', 'secrets/**', 'credentials/**',
  '**/id_rsa', '**/id_ed25519',
];

const WRITABLE = declaredWritable(loadCorpus());   // ["world/mind.md"] — the corpus declares it

const lawFile = (root, extra) => writeFileSync(join(root, 'aukora.law.json'),
  JSON.stringify({ schema: 'aukora-law-v0', protected: PROTECTED, writesOutsideRepo: 'refuse', ...extra }, null, 2));

/** One case, judged under a law that declares what the corpus says is writable. */
function judge(caseId, extra = { writable: WRITABLE }) {
  const c = loadCorpus().find((x) => x.id === caseId);
  if (!c) throw new Error(`no such case: ${caseId}`);
  const s = build(c);
  try {
    assert.deepEqual(verify(c, s), [], `${caseId}: the fixture did not materialise`);
    lawFile(s.repo, extra);
    const [v] = judgePaths(s.repo, [resolve(s.repo, c.attempt.path)]);
    if (!v) throw new Error(`${caseId}: the judge returned no verdict`);
    return { got: v.verdict === 'allowed' ? 'ALLOW' : 'REFUSE', v, expect: c.expect };
  } finally { destroy(s); }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CONTROL. First, and non-negotiable: a fence that refuses everything scores eleven of twelve
// and protects nothing. Deny-by-default is the polarity most likely to fail this way.
// ─────────────────────────────────────────────────────────────────────────────
test('THE CONTROL · a declared path is still writable', () => {
  const r = judge('lawful-write');
  assert.equal(r.got, 'ALLOW', 'world/mind.md is declared writable and must land');
  assert.equal(r.v.reasonClass, 'ok:allowed');
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FIVE. Each was a pinned expected miss; each is closed by resolution + declaration, and each
// names the class of ambiguity it closes.
// ─────────────────────────────────────────────────────────────────────────────
test('02 · an undeclared path inside the world is refused', () => {
  // The case that no denylist rule can close without either transcribing the attacked path or
  // refusing the control — measured, both, in docs/POLARITY-PREREGISTRATION.md. This is the case
  // the whole polarity exists for, and it has no alias at all: keys are ["world/undeclared.txt"].
  const r = judge('undeclared-path');
  assert.equal(r.got, 'REFUSE');
  assert.equal(r.v.reasonClass, 'law:undeclared-path');
});

test('04 · an innocent name resolving to a protected object is refused on the SECOND key', () => {
  // keys = ["world/mind.md", "law.js"]. The first IS declared. EVERY key must be, or the alias
  // walks in under the name that was allowed — AURA, 2026-07-27, arriving through the new polarity.
  const r = judge('symlink-to-protected');
  assert.equal(r.got, 'REFUSE');
  assert.equal(r.v.reasonClass, 'law:undeclared-path');
});

test('07 · a case-folded spelling of an undeclared file is refused', () => {
  // LAW.JS folds to law.js on a case-insensitive filesystem. The folder was always right; nothing
  // declared law.js, and under a denylist nothing refused it either.
  const r = judge('case-fold');
  assert.equal(r.got, 'REFUSE');
  assert.equal(r.v.reasonClass, 'law:undeclared-path');
});

test('08 · an NFD spelling of an undeclared file is refused', () => {
  const r = judge('nfd-decompose');
  assert.equal(r.got, 'REFUSE');
  assert.equal(r.v.reasonClass, 'law:undeclared-path');
});

test('09 · a trailing-dot spelling of an undeclared file is refused', () => {
  const r = judge('trailing-dot');
  assert.equal(r.got, 'REFUSE');
  assert.equal(r.v.reasonClass, 'law:undeclared-path');
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SEVEN THAT WERE ALREADY GREEN — each still refused, and still refused FOR ITS OWN REASON.
// The kill condition is a regression here, not a low score.
// ─────────────────────────────────────────────────────────────────────────────
test('the already-armed cases keep their exact reason class', () => {
  // A deny-by-default fence would refuse all of these anyway, as merely undeclared. That would be
  // the same verdict with a worse sentence — the owner could no longer tell "this is a hard link to
  // a protected inode" from "you did not list this file". Ordering is what preserves it: root,
  // outside, protected, multiply-linked, and only THEN the allow-list.
  const expected = {
    'dotdot-traversal': 'law:outside-repo',
    'dangling-symlink': 'law:outside-repo',
    'hardlink-nlink': 'guard:multiply-linked',
    'symlinked-parent': 'law:protected-path',
    'repo-root': 'law:repository-root',
    'empty-segment-glob': 'law:protected-path',
  };
  for (const [id, reasonClass] of Object.entries(expected)) {
    const r = judge(id);
    assert.equal(r.got, 'REFUSE', `${id} must still be refused`);
    assert.equal(r.v.reasonClass, reasonClass, `${id} must still be refused BY ITS OWN NAME`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SUB-DECISIONS, pinned so neither can be relaxed without a test going red.
// ─────────────────────────────────────────────────────────────────────────────
test('EVERY key must be declared, not merely one of them', () => {
  // Directly: declare the innocent name only, and the alias case must still refuse.
  const r = judge('symlink-to-protected', { writable: ['world/mind.md'] });
  assert.equal(r.got, 'REFUSE', 'ANY-key semantics would allow this, and that is the 2026-07-27 incident');
});

test('THE TRAP · a directory glob in the allow-list re-opens case 02', () => {
  // Asserted to ALLOW, on purpose. `world/**` compiles to a pattern that matches every file under
  // `world/`, so declaring the DIRECTORY writable declares the undeclared path writable with it —
  // and case 02 is exactly "a path inside the world that no rule declares editable". A
  // directory-granular allow-list is deny-by-default in name and the old denylist in effect, one
  // directory at a time.
  //
  // This is why the corpus declares FILES, and why `declaredWritable()` reads them off the ALLOW
  // cases one path at a time. If someone later "tidies" the writable list into directory globs, the
  // conformance score will not move — case 02 will simply start passing for a reason that is not
  // true — so the trap is pinned here where it fails loudly instead.
  const glob = judge('undeclared-path', { writable: ['world/**'] });
  assert.equal(glob.got, 'ALLOW', 'a directory glob admits everything beneath it — this is the trap');

  // And the file-granular list the corpus actually declares refuses the same path.
  const files = judge('undeclared-path');
  assert.equal(files.got, 'REFUSE');
  assert.equal(files.v.reasonClass, 'law:undeclared-path');
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARDS COMPATIBILITY — the guarantee that makes this shippable.
// ─────────────────────────────────────────────────────────────────────────────
test('a law with NO writable list behaves exactly as it does today', () => {
  // Absent is not empty. If this ever flips, every repository that has not declared a writable set
  // is refused every write the moment it updates — including this one, mid-round.
  const r = judge('lawful-write', {});                 // no `writable` key at all
  assert.equal(r.got, 'ALLOW', 'no allow-list declared means the allow-list is not in force');

  const undeclared = judge('undeclared-path', {});
  assert.equal(undeclared.got, 'ALLOW',
    'and the five stay open until a law declares a writable set — that is what "absent" means');
});

test('an EMPTY writable list is a real declaration, and refuses even the control', () => {
  // The difference between "not in force" and "in force, and nothing is listed". The second is a
  // legitimate thing to declare and must be obeyed literally — GATE-0 reports it as degenerate.
  const r = judge('lawful-write', { writable: [] });
  assert.equal(r.got, 'REFUSE', 'an empty allow-list declares that nothing is writable');
});
