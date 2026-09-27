// aukora · test/witness-alias-gaps.test.mjs — two aliases the resolver could not see
//
// ══ HOW THESE WERE FOUND ══
//
// The armed conformance suite reported "3 of 12 met" and the lane brief read that as nine
// path-alias bypasses in `paths.mjs`. It is not that. The suite drives
// `core/forge/review.ts` (capture -> apply), whose only path predicate is
// `abs.startsWith(repoRoot() + sep)` — it consults no law, no protected set, and no
// `judge()`. So `paths.mjs` was never called during a conformance run, and editing it
// could not have moved the score at all.
//
// Running the case fixtures through the composition `core/forge/crush.ts` DOES perform
// (loadLaw + analyse + judge + isMultiplyLinked) is what separated the architectural gap
// from the real defects. That measurement said 5 of 12 — and the two cases below are the
// ones that missed for a reason inside this lane rather than outside it.
//
// Both are the same shape: a comment in `paths.mjs` asserting a property the code did not
// carry. That is the dangerous kind, because the next reader believes the comment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyse, realpathish } from '../core/witness/paths.mjs';
import { judgePaths, REASON } from '../core/witness/guard.mjs';

/** A sandbox shaped like the conformance one: a root standing in for the filesystem, and a repo inside it. */
function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-alias-')));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'world'), { recursive: true });
  writeFileSync(join(repo, 'aukora.law.json'),
    `${JSON.stringify({ schema: 'aukora-law-v0', protected: ['secrets/**'] }, null, 2)}\n`);
  return { root, repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ── CASE 03 · a symlink whose target does not exist ────────────────────────────
//
// `realpathish` walked with `existsSync`, which FOLLOWS the link. A dangling link
// answers false, so the walker read it as "a name that does not exist yet", stepped up
// to the parent, re-appended the leaf, and returned the innocent lexical path.

test('a DANGLING symlink out of the repo is seen as an escape', () => {
  const { root, repo, cleanup } = world();
  try {
    const outside = join(root, 'nonexistent-target.txt');   // absent, and outside the repo
    symlinkSync(outside, join(repo, 'world', 'mind.md'));

    const a = analyse(repo, join(repo, 'world', 'mind.md'));
    assert.equal(a.outside, true, 'the link leaves the repository — that is the whole attack');
    assert.equal(a.aliased, true,
      'aliased is what puts "path: X / resolved: Y" in the receipt; false made the escape invisible');

    const [v] = judgePaths(repo, [join(repo, 'world', 'mind.md')]);
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, REASON.OUTSIDE);
  } finally { cleanup(); }
});

test('a dangling symlink to a path INSIDE the repo still resolves to its real name', () => {
  // The mirror of the above: resolution must not simply start refusing every dangling
  // link. One pointing at an ordinary in-repo path is an ordinary write to that path.
  const { repo, cleanup } = world();
  try {
    symlinkSync(join(repo, 'world', 'not-yet.md'), join(repo, 'world', 'mind.md'));
    const a = analyse(repo, join(repo, 'world', 'mind.md'));
    assert.equal(a.outside, false);
    assert.equal(a.resolved, 'world/not-yet.md', 'it resolves THROUGH the link to the real target');

    const [v] = judgePaths(repo, [join(repo, 'world', 'mind.md')]);
    assert.equal(v.verdict, 'allowed', 'an innocent dangling link is not an attack');
  } finally { cleanup(); }
});

test('a dangling symlink onto a PROTECTED path is refused by the law, not by luck', () => {
  const { repo, cleanup } = world();
  try {
    // `secrets/` is protected and `secrets/key.txt` does not exist — so the link dangles
    // and, before the fix, resolved to the innocent name and was allowed outright.
    symlinkSync(join(repo, 'secrets', 'key.txt'), join(repo, 'world', 'mind.md'));
    const [v] = judgePaths(repo, [join(repo, 'world', 'mind.md')]);
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, REASON.PROTECTED);
    assert.equal(v.rule, 'secrets/**');
  } finally { cleanup(); }
});

test('a symlink LOOP resolves to no lexical claim and is refused', () => {
  const { repo, cleanup } = world();
  try {
    symlinkSync(join(repo, 'world', 'b'), join(repo, 'world', 'a'));
    symlinkSync(join(repo, 'world', 'a'), join(repo, 'world', 'b'));
    // The bound on the walk is what stops this; the assertion is that it TERMINATES and
    // returns an answer rather than spinning. ELOOP refuses it again at the syscall.
    const got = realpathish(join(repo, 'world', 'a'));
    assert.equal(typeof got, 'string', 'the walk is bounded and returns');
  } finally { cleanup(); }
});

// ── CASE 10 · the repository root ──────────────────────────────────────────────
//
// `analyse` added the key `''` under a comment reading "treat as protected". Every rule
// compiles to `^(?:body)(?:/.*)?$` and no law has an empty body, so `''` matched nothing
// and `judge()` returned protected:false. The conformance case was green on EISDIR — the
// kernel refusing a write to a directory — and its own report said so.

test('the repository root is refused by the fence, not by the kernel', () => {
  const { repo, cleanup } = world();
  try {
    const a = analyse(repo, repo);
    assert.equal(a.isRoot, true, 'the root needs a flag: it cannot be expressed as a rule');

    const [v] = judgePaths(repo, [repo]);
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, REASON.REPO_ROOT);
    assert.equal(v.rule, null, 'no rule declares this, because no rule can');
  } finally { cleanup(); }
});

test('"." and a path that climbs back to the root are the same answer', () => {
  const { repo, cleanup } = world();
  try {
    for (const raw of ['.', join(repo, 'world', '..'), `${repo}/`]) {
      const [v] = judgePaths(repo, [raw]);
      assert.equal(v.reasonClass, REASON.REPO_ROOT, `${raw} resolves to the root`);
    }
  } finally { cleanup(); }
});

test('the control still holds — an ordinary declared write is ALLOWED', () => {
  // Case 00's argument, enforced here too: a fence that refuses everything passes every
  // hostile case and protects nothing. Both fixes above are refusals; this is the guard
  // against having bought them by refusing more than was asked.
  const { repo, cleanup } = world();
  try {
    writeFileSync(join(repo, 'world', 'mind.md'), 'genesis\n');
    const [v] = judgePaths(repo, [join(repo, 'world', 'mind.md')]);
    assert.equal(v.verdict, 'allowed');
    assert.equal(v.reasonClass, REASON.ALLOWED);
  } finally { cleanup(); }
});
