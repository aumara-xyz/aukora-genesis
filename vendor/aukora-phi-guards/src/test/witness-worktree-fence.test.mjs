// aukora · test/witness-worktree-fence.test.mjs — WHY A GIT WORKTREE STAYS OUTSIDE THE FENCE
//
// ══ WHAT THIS FILE IS ══
//
// It is the record of a widening that was proposed, preregistered, measured, and REFUSED. Every test
// here passes against unmodified code, and that is the point: a null result nobody can re-run is an
// opinion. `docs/WORKTREE-FENCE-PREREGISTRATION.md` is the write-up; this is the measurement.
//
// ══ THE PROPOSAL ══
//
// The law reads a legitimate `git worktree` sibling of the governed repository as outside-repo and
// refuses writes there. Measured cost, three hits in one day: it refused this lane's own test write
// mid-PR-#93, Lane 1 abandoned worktrees entirely in #92, and it refuses the lead's memory directory.
// The proposed rule was "a worktree of the governed repo IS the governed repo — same gitdir".
//
// ══ THE THREE CONTROLS ALL HELD ══
//
// Forgery is genuinely impossible, and the tests below are the proof — a directory dressed like a
// worktree is inert, a worktree of a different repository is refused, and a symlink into a foreign
// worktree is refused with the escape legible in the receipt. If the question had been "can a fake
// worktree get in?", the answer is no and the widening would have shipped.
//
// ══ AND THE KILL CONDITION FIRED ANYWAY ══
//
// The question that decides the change is not "can a FAKE worktree get in" but "who controls the set
// of REAL ones". The answer is: the fenced party. `.claude/settings.json` fences
// `Write|Edit|MultiEdit|NotebookEdit`; `Bash` is in `KNOWN_NON_WRITE_TOOLS` and the law's
// `unguardedTools: 'receipt'` records it rather than refusing it. So `git worktree add /anywhere`
// costs an agent one unrefused command, and under the widening that directory becomes a writable
// region of the governed repository. "Inside the repo" would stop being a fact about a path and
// become a mutable claim controlled by the party being fenced.
//
// The last two tests are the two independent fail-open findings, either of which would have been
// enough on its own. They are pinned here so that a future attempt has to answer them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgePaths } from '../core/witness/guard.mjs';
import { analyse } from '../core/witness/paths.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
/** For the calls that are SUPPOSED to fail — git's own diagnostic is not this suite's output. */
const gitQuiet = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const verdict = (root, abs) => judgePaths(root, [abs])[0];

/**
 * A governed repository with one legitimate worktree, one foreign repository, and one foreign
 * worktree — built with real git, because the whole question is what git actually reports.
 *
 * realpath'd for the reason `analyse` resolves its root through symlinks: on macOS `os.tmpdir()`
 * hands out /var/... for /private/var/..., and an unresolved root makes every in-repo path read as
 * outside-repo — which would make every assertion below pass for the wrong reason.
 */
function lab() {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-wt-fence-')));
  const init = (name) => {
    const p = join(dir, name);
    mkdirSync(p, { recursive: true });
    git(p, 'init', '-q');
    git(p, 'config', 'user.email', 't@t.t');
    git(p, 'config', 'user.name', 't');
    writeFileSync(join(p, 'seed.txt'), 'seed\n');
    git(p, 'add', '.');
    git(p, 'commit', '-qm', 'seed');
    return p;
  };
  const gov = init('gov');
  const foreign = init('foreign');
  const govWt = join(dir, 'gov-wt');
  const foreignWt = join(dir, 'foreign-wt');
  git(gov, 'worktree', 'add', '-q', govWt, '-b', 'lane');
  git(foreign, 'worktree', 'add', '-q', foreignWt, '-b', 'lane');
  return { dir, gov, foreign, govWt, foreignWt, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL A — a directory dressed like a worktree is not one, and cannot become one.
// ─────────────────────────────────────────────────────────────────────────────
test('CONTROL A · a hand-written .git file does not make a directory a worktree', () => {
  const L = lab();
  try {
    const fake = join(L.dir, 'fake');
    mkdirSync(fake, { recursive: true });
    // Exactly what a worktree's `.git` looks like — a file, one line, pointing at an admin dir.
    writeFileSync(join(fake, '.git'), `gitdir: ${L.gov}/.git/worktrees/fake\n`);

    // git itself does not accept it: the admin directory it names does not exist.
    assert.equal(existsSync(join(L.gov, '.git', 'worktrees', 'fake')), false);
    assert.throws(() => gitQuiet(fake, 'rev-parse', '--git-common-dir'),
      'a .git file pointing at a non-existent admin dir is not a repository');

    // And the governed repo does not claim it.
    assert.ok(!git(L.gov, 'worktree', 'list', '--porcelain').includes('/fake'),
      'the governed repo must not list a directory that merely claims to be its worktree');

    // The fence refuses it today, and would still refuse it under the proposed rule.
    const v = verdict(L.gov, join(fake, 'payload.txt'));
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, 'law:outside-repo');

    // THE ASSERTION THAT GIVES THIS CONTROL ITS TEETH. Registering a worktree means writing
    // `<gov>/.git/worktrees/<name>/gitdir`, and `.git/**` is in the law's non-removable defaults —
    // so no fenced write can forge a registration from outside.
    const reg = verdict(L.gov, join(L.gov, '.git', 'worktrees', 'fake', 'gitdir'));
    assert.equal(reg.verdict, 'refused');
    assert.equal(reg.reasonClass, 'law:protected-path');
    assert.equal(reg.rule, '.git/**');
  } finally { L.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL B — a worktree of a DIFFERENT repository stays outside.
// ─────────────────────────────────────────────────────────────────────────────
test('CONTROL B · a worktree of another repository is refused, and git can tell them apart', () => {
  const L = lab();
  try {
    const v = verdict(L.gov, join(L.foreignWt, 'payload.txt'));
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, 'law:outside-repo');

    // The discriminator any future attempt would have to rely on, measured rather than assumed:
    // the legitimate worktree's common dir IS the governed repo's git dir, and the foreign one's
    // is not. This is the one part of the proposal that was sound.
    const govGitDir = git(L.gov, 'rev-parse', '--absolute-git-dir');
    assert.equal(realpathSync(git(L.govWt, 'rev-parse', '--git-common-dir')), realpathSync(govGitDir));
    assert.notEqual(realpathSync(git(L.foreignWt, 'rev-parse', '--git-common-dir')), realpathSync(govGitDir));
  } finally { L.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL C — a symlink out of the repository stays out, and says so.
// ─────────────────────────────────────────────────────────────────────────────
test('CONTROL C · a symlink from inside the repo into a foreign worktree is refused', () => {
  const L = lab();
  try {
    symlinkSync(L.foreignWt, join(L.gov, 'link-to-foreign'));
    const v = verdict(L.gov, join(L.gov, 'link-to-foreign', 'payload.txt'));
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, 'law:outside-repo');

    // Legible, not merely blocked: the receipt names where the path actually went.
    const a = analyse(L.gov, join(L.gov, 'link-to-foreign', 'payload.txt'));
    assert.equal(a.aliased, true);
    assert.ok(a.resolved.startsWith(L.foreignWt), 'the receipt must name the real destination');
  } finally { L.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE KILL CONDITION — the two findings that refused the change even though the controls held.
// ─────────────────────────────────────────────────────────────────────────────

test('KILL 1 · the set of real worktrees is a list the fenced party can extend', () => {
  const L = lab();
  try {
    const before = git(L.gov, 'worktree', 'list', '--porcelain');
    const added = join(L.dir, 'added-later');
    // One ordinary git command — the same one an agent runs through Bash, which
    // `.claude/settings.json` does not fence and the law only receipts.
    git(L.gov, 'worktree', 'add', '-q', added, '-b', 'added-later');
    const after = git(L.gov, 'worktree', 'list', '--porcelain');

    assert.ok(!before.includes('/added-later'));
    assert.ok(after.includes('/added-later'),
      'a directory of the agent\'s choosing is now, genuinely, a worktree of the governed repo');

    // Today that buys nothing: the fence answers on paths, not on git's opinion of them.
    const v = verdict(L.gov, join(added, 'payload.txt'));
    assert.equal(v.verdict, 'refused');
    assert.equal(v.reasonClass, 'law:outside-repo');
    // Under the proposed rule this same path would have been ALLOWED — with no attacker, no forgery,
    // and no control violated. That is the whole reason the widening does not ship: the predicate is
    // not a property of the repository, it is a list the fenced party appends to.
  } finally { L.cleanup(); }
});

test('KILL 2 · an outside path carries NO fold-keys, so the law cannot protect it', () => {
  const L = lab();
  try {
    // `analyse` returns early for an outside path without ever adding a fold-key. So if a widening
    // only flipped `outside` to false, every admitted path would reach `judge()` with an empty key
    // set and match no rule — the governed repository's entire self-protection set would be
    // writable from a worktree. Measured here rather than argued.
    for (const p of ['.git/config', 'aukora.law.json', '.env', '.aukora/witness.jsonl']) {
      const outside = analyse(L.gov, join(L.govWt, p));
      assert.equal(outside.outside, true, `${p} in a worktree is outside today`);
      assert.deepEqual(outside.keys, [], `${p} carries no fold-keys when outside — nothing for judge() to match`);

      // The same names, inside the governed root, DO carry keys and ARE protected. This is the
      // contrast that makes the empty key set a finding rather than a curiosity.
      const inside = analyse(L.gov, join(L.gov, p));
      assert.ok(inside.keys.length > 0, `${p} inside the repo carries fold-keys`);
      assert.equal(verdict(L.gov, join(L.gov, p)).verdict, 'refused');
    }
  } finally { L.cleanup(); }
});
