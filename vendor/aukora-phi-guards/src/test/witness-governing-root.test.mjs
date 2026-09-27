// aukora · test/witness-governing-root.test.mjs — WHICH REPOSITORY IS THIS WRITE GOVERNED BY?
//
// ══ F1 — THE PARENT-CWD VOID. NO EXPLOIT REQUIRED. ══
//
// The fence took its root from the caller's working directory and never asked which repository the
// path it was judging actually lives in. So opening an editor on the folder ABOVE the repo voided the
// entire fence — not by defeating a check, but by asking a different question. Measured on 32c7755:
//
//     write attempt              cwd = repo    cwd = PARENT
//     LAW.md                     refused       ALLOWED
//     aukora.law.json            refused       ALLOWED
//     .claude/settings.json      refused       ALLOWED
//     .git/config                refused       ALLOWED
//
// Three things line up to make it total, and each is individually reasonable:
//   · the parent has no `aukora.pub`, so `checkLawAuthority` reads `unbound` and PASSES — the one
//     exception that exists so unadopted repositories still work;
//   · the parent has no `aukora.law.json`, so the law falls back to DEFAULT_PROTECTED;
//   · every compiled rule anchors at the root, so `repo/LAW.md` matches the pattern `LAW.md` not at
//     all. The self-protection set is intact and simply describes a different directory.
//
// It voids #99 completely — every `lawmd-selfprotect` test runs with `cwd: repo`, and no case in the
// corpus varies cwd. A whole class of test agreed with a whole class of code about the wrong thing.
//
// SECOND ORDER, and it is why this is not merely "a check in the wrong place": the chain follows the
// same root. A parent directory is not a git repository, so it has no durable identity, so
// `chainHome` keeps its chain in-tree at `<parent>/.aukora/chain.jsonl`. The writes are recorded —
// into a file `aukora verify` inside the repo never reads. Refused writes and a fork of the record,
// from one wrong variable.
//
// ══ THE FIX, AND WHY IT TAKES THE STRICTEST OF TWO ANSWERS ══
//
// The governing root is discovered from THE PATH BEING JUDGED, by walking up for `.git` or a law
// file. But discovery alone would WIDEN the fence in one case — cwd inside repo A, path inside repo
// B — where today's answer is a clean `law:outside-repo` refusal and B's own law might allow it. So
// both roots are judged and any refusal wins. That is provably non-widening: the cwd answer is still
// computed, and it can still refuse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runFence, FENCED_TOOLS, REFUSE, ALLOW } from '../core/witness/guard.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A governed repository, its law, and a parent directory that is not a repository. */
function lab({ writable = null } = {}) {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-root-')));
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t.t');
  git(repo, 'config', 'user.name', 't');

  const law = {
    schema: 'aukora-law-v0',
    protected: ['LAW.md', 'aukora.law.json', '.aukora/**', '.claude/settings.json', '.git/**'],
    writesOutsideRepo: 'refuse',
  };
  if (writable) law.writable = writable;
  writeFileSync(join(repo, 'aukora.law.json'), `${JSON.stringify(law, null, 2)}\n`);
  writeFileSync(join(repo, 'LAW.md'), '# the law\n');
  writeFileSync(join(repo, 'notes.txt'), 'ordinary\n');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), '{}');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'seed');

  return { dir, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Exactly the envelope the PreToolUse hook sends. */
const write = (cwd, absPath) =>
  runFence({ tool_name: 'Write', tool_input: { file_path: absPath }, cwd, session_id: 's' });

// ─────────────────────────────────────────────────────────────────────────────
// F1
// ─────────────────────────────────────────────────────────────────────────────
test('F1 · the ring-0 set is refused from the repository, as it always was', () => {
  const L = lab();
  try {
    for (const rel of ['LAW.md', 'aukora.law.json', '.claude/settings.json', '.git/config']) {
      assert.equal(write(L.repo, join(L.repo, rel)), REFUSE, `${rel} must be refused from the repo`);
    }
  } finally { L.cleanup(); }
});

test('F1 · and refused from the PARENT — the fence follows the path, not the caller', () => {
  const L = lab();
  try {
    // Every one of these returned ALLOW before the governing root was discovered from the path.
    for (const rel of ['LAW.md', 'aukora.law.json', '.claude/settings.json', '.git/config']) {
      assert.equal(write(L.dir, join(L.repo, rel)), REFUSE,
        `${rel} written from the parent must be refused — this is the whole finding`);
    }
  } finally { L.cleanup(); }
});

test('F1 · an ordinary file in the repo is still allowed from either directory', () => {
  // THE CONTROL. A fix that refused everything from a parent would pass every assertion above and
  // protect nothing — and would also break the ordinary case of an editor opened one level up.
  const L = lab();
  try {
    assert.equal(write(L.repo, join(L.repo, 'notes.txt')), ALLOW, 'from the repo');
    assert.equal(write(L.dir, join(L.repo, 'notes.txt')), ALLOW, 'from the parent');
  } finally { L.cleanup(); }
});

test('F1 · the receipt lands in the governed chain, not a fork beside the parent', () => {
  const L = lab();
  try {
    write(L.dir, join(L.repo, 'notes.txt'));
    // A parent directory is not a git repository, so it has no durable identity and `chainHome`
    // keeps such a chain in-tree. If the root were still the parent, this file would exist — and
    // `aukora verify` inside the repo would never read it.
    assert.equal(existsSync(join(L.dir, '.aukora', 'chain.jsonl')), false,
      'a write into the repo must not be recorded into a chain beside the parent');
  } finally { L.cleanup(); }
});

test('F1 · NON-WIDENING — a write into a DIFFERENT repository is still refused', () => {
  // The one case where discovery alone would have loosened the fence: cwd in repo A, path in repo B.
  // B's own law might well permit it; the session is governed by A, and today's answer is a clean
  // `law:outside-repo`. Both roots are judged and any refusal wins, so that answer survives.
  const L = lab();
  try {
    const other = join(L.dir, 'other');
    mkdirSync(other, { recursive: true });
    git(other, 'init', '-q');
    writeFileSync(join(other, 'anything.txt'), 'x\n');
    assert.equal(write(L.repo, join(other, 'anything.txt')), REFUSE,
      'a path in another repository is outside the one being governed');
  } finally { L.cleanup(); }
});

test('F1 · a path in no repository at all is still refused from inside one', () => {
  const L = lab();
  try {
    assert.equal(write(L.repo, join(L.dir, 'loose.txt')), REFUSE, 'outside the repo is outside');
  } finally { L.cleanup(); }
});

test('F1 · a RELATIVE tool path is resolved against the caller, not against process.cwd()', () => {
  // A defect in the first draft of this very fix, found by the suite rather than by reasoning.
  // `governingRoot` was handed the raw declared path; a relative one resolves against the running
  // process's directory — which in a test run is the real repository — so the fence discovered a root
  // nobody was writing to and sent the receipt there. Two writes, zero receipts read back.
  const L = lab();
  try {
    const rel = { tool_name: 'Write', tool_input: { file_path: 'LAW.md' }, cwd: L.repo, session_id: 's' };
    assert.equal(runFence(rel), REFUSE, 'a relative path to a protected file is still protected');

    const ok = { tool_name: 'Write', tool_input: { file_path: 'notes.txt' }, cwd: L.repo, session_id: 's' };
    assert.equal(runFence(ok), ALLOW, 'and an ordinary relative path still lands');
    assert.equal(existsSync(join(L.dir, '.aukora', 'chain.jsonl')), false,
      'a relative path must never route the record outside the governed repository');
  } finally { L.cleanup(); }
});

test('F1 · T-WWR CONTROL · a worktree is governed by its OWN law, and is still not the parent repo', () => {
  // The worktree null stands. Discovery matches `.git` as a FILE as well as a directory, which is
  // what a worktree has — so a path inside a worktree is governed by the law in that worktree's own
  // checkout. That is NOT the same as making a worktree part of the repository it was cut from: a
  // write into the worktree is judged by the worktree, and a write from the worktree into the parent
  // repository is judged by the parent. Neither absorbs the other.
  const L = lab();
  try {
    const wt = join(L.dir, 'wt');
    git(L.repo, 'worktree', 'add', '-q', wt, '-b', 'lane');

    // The worktree carries its own checkout of the law, so its own LAW.md is protected there.
    assert.equal(write(wt, join(wt, 'LAW.md')), REFUSE, "the worktree's own law governs it");
    assert.equal(write(wt, join(wt, 'notes.txt')), ALLOW, 'and ordinary files there are ordinary');

    // And the parent repository still governs itself, from anywhere.
    assert.equal(write(wt, join(L.repo, 'LAW.md')), REFUSE,
      'a write from the worktree into the parent repo is judged by the parent repo');
  } finally { L.cleanup(); }
});

test('F1 · T-WWR CONTROL · a directory governed by nothing falls back to the caller', () => {
  // No `.git`, no law, nowhere above it either — there is no discovered root, so the caller's
  // directory is the only answer available and behaviour is exactly what it was.
  const L = lab();
  try {
    assert.equal(write(L.dir, join(L.dir, 'loose.txt')), ALLOW,
      'an ungoverned directory is not made governed by this change');
  } finally { L.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// F4 — the hook lane never enforced deny-by-default
// ─────────────────────────────────────────────────────────────────────────────
test('F4 · the interactive fence enforces the allow-list, not just the write seam', () => {
  // `runFence` read `{ law, rules }` out of `loadLaw` and handed only those two to `decide`, so
  // `writableRules` arrived undefined and the allow-list block was skipped for every hook-mediated
  // write. 12 of 12 was true of `review.ts` capture -> apply and NOT of the fence a session actually
  // meets. Two lanes, one law, and only one of them was reading all of it.
  const L = lab({ writable: ['notes.txt'] });
  try {
    assert.equal(write(L.repo, join(L.repo, 'notes.txt')), ALLOW, 'declared writable');
    assert.equal(write(L.repo, join(L.repo, 'undeclared.txt')), REFUSE,
      'a law that declares a writable set must be enforced by the fence too');
  } finally { L.cleanup(); }
});

test('F4 · a law with no writable set still behaves exactly as before', () => {
  const L = lab();                                   // no `writable` key at all
  try {
    assert.equal(write(L.repo, join(L.repo, 'undeclared.txt')), ALLOW,
      'absent is not empty — deny-by-default begins when a law says so');
  } finally { L.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 — the two lists, and the test that was claimed but never written
// ─────────────────────────────────────────────────────────────────────────────
test('F2 · every fenced tool is actually matched by the installed hook', () => {
  // `guard.mjs` says of FENCED_TOOLS: "This list and the matcher `init` writes are asserted equal by
  // a test." No such test existed. Meanwhile the witness lane returns early for any FENCED_TOOL on
  // the grounds that "the fence already recorded it" — so a name in this list that the matcher does
  // NOT carry is judged by nobody AND recorded by nobody. Five names were in exactly that state.
  const settings = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
  const pre = settings.hooks?.PreToolUse ?? [];
  const matchers = pre.filter((h) => typeof h.matcher === 'string').map((h) => h.matcher);
  assert.ok(matchers.length > 0, 'no PreToolUse matcher found — has the hook been renamed?');

  const covered = (tool) => matchers.some((m) => new RegExp(`^(?:${m})$`).test(tool));
  const uncovered = FENCED_TOOLS.filter((t) => !covered(t));
  assert.deepEqual(uncovered, [],
    `these tools are fenced in code but not matched by the hook, so nothing judges OR records them: ${uncovered.join(', ')}`);
});
