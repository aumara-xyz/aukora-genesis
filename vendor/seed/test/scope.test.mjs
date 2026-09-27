// aukora · test/scope.test.mjs — the caller does not get to choose the law
//
// ══ THE BYPASS, AS IT WAS FOUND ══
//
// `runFence` took its repository root from `payload.cwd`. Everything hangs off
// that value: which `aukora.law.json` is loaded, which key `checkLawAuthority`
// verifies, which `.aukora/` receives the receipts, and what counts as "outside
// this repository".
//
// Narrowing it is harmless — a subdirectory root makes the outside-check
// stricter, which is why `cd src` produced nothing. Widening it dissolves the
// law completely. Measured against a repo that had just been `aukora init`-ed:
//
//   cwd = the repo    write repo/aukora.law.json        refused   (correct)
//   cwd = its PARENT  write repo/aukora.law.json        ALLOWED, silently
//                     write repo/aukora.pub             ALLOWED, silently
//                     write repo/.aukora/chain.jsonl    ALLOWED, silently
//                     write repo/.claude/settings.json  ALLOWED, silently
//
// The parent has no `aukora.pub`, so `checkLawAuthority` returns `unbound` — the
// one state that does not refuse, and rightly so, since a repository that has
// not adopted Aukora must still be workable. The parent also has no law, so
// nothing is protected. Every governed repository beneath it is now inside a
// root with no rules, and a fresh `.aukora/` appears in the caller's chosen
// directory while the real chain records that nothing happened.
//
// Both halves were correct in isolation. `checkLawAuthority` answers honestly
// about the root it is handed; `judge` applies the rules it is handed. Nothing
// asked whether that root was the one that GOVERNS the file. A guard proven
// where it is defined and never where it is used — the same shape as every
// other defect found in this project, which is why it gets a whole file.
//
// ══ WHAT THIS FILE HOLDS ══
//
// Every case runs against BOTH the old behaviour and the new one, the way
// `test/paths.test.mjs` and `test/authority.test.mjs` do. The red half is not a
// strawman: `callerChosenRoot` is literally the line that was in `runFence`.
// Keeping it runnable means the bypass can be demonstrated forever instead of
// being a paragraph somebody has to take on trust.
//
// ══ WHAT THIS DOES NOT PROVE ══
//
// Nothing about `runWitness`, which still takes the caller's cwd — it records
// tools that carry no path, so there is nothing to derive a root from. It never
// refuses, so there is no control to bypass there; the residue is a misfiled
// receipt, and it is stated in the code rather than tested away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { runFence, governingRoot, rootForCall, REFUSE, ALLOW } from '../src/guard.mjs';

/**
 * The root selection `runFence` USED to do: whatever the caller said.
 *
 * Kept so the bypass stays demonstrable. Nothing in `src/` calls it.
 */
const callerChosenRoot = (payload) => (
  typeof payload?.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd()
);

/** A parent directory with NO law of its own, holding a governed repo inside it. */
function nested() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-scope-')));
  const repo = join(parent, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, 'src', 'index.js'), 'export const ok = 1;\n');
  writeFileSync(join(repo, '.claude', 'settings.json'), '{}\n');
  writeFileSync(join(repo, 'aukora.law.json'), JSON.stringify({
    schema: 'aukora-law-v0',
    protected: ['aukora.law.json', 'aukora.pub', '.aukora/**', '.claude/settings.json', 'secrets/**'],
  }, null, 2));
  return { parent, repo, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

const quiet = (fn) => {
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try { return fn(); } finally { process.stderr.write = orig; }
};

const write = (cwd, file) => quiet(() => runFence({
  tool_name: 'Write', cwd, session: 't', tool_input: { file_path: file },
}));

// ── the bypass, both halves ─────────────────────────────────────────────────

test('the OLD root selection hands a caller in the parent a root with no law', () => {
  const { parent, repo, cleanup } = nested();
  try {
    // This is the whole bug in one assertion: the caller names the parent, and
    // the parent is what gets used — a directory holding no aukora.law.json.
    const chosen = callerChosenRoot({ cwd: parent });
    assert.equal(chosen, parent);
    assert.equal(existsSync(join(chosen, 'aukora.law.json')), false);
    // …while the file being written is governed by a law that protects it.
    assert.equal(existsSync(join(repo, 'aukora.law.json')), true);
  } finally { cleanup(); }
});

test('the NEW root selection follows the file, not the caller', () => {
  const { parent, repo, cleanup } = nested();
  try {
    const scope = rootForCall(parent, { file_path: join(repo, 'aukora.law.json') });
    assert.equal(scope.root, repo, 'the governed repo must judge its own files');
    assert.notEqual(scope.root, parent);
  } finally { cleanup(); }
});

test('a caller standing in the parent can no longer write the protected files', () => {
  const { parent, repo, cleanup } = nested();
  try {
    for (const f of ['aukora.law.json', 'aukora.pub', '.aukora/chain.jsonl', '.claude/settings.json']) {
      assert.equal(write(parent, join(repo, f)), REFUSE, `${f} must refuse from the parent`);
      // and the control: it refuses from the real root too, so the fix did not
      // merely move which root is wrong.
      assert.equal(write(repo, join(repo, f)), REFUSE, `${f} must refuse from the repo root`);
    }
  } finally { cleanup(); }
});

test('widening the cwd no longer plants a receipt chain in the caller\'s directory', () => {
  const { parent, repo, cleanup } = nested();
  try {
    write(parent, join(repo, 'aukora.law.json'));
    assert.equal(
      existsSync(join(parent, '.aukora')), false,
      'a caller-named directory must not accumulate the governed repo\'s receipts',
    );
  } finally { cleanup(); }
});

// ── the fix must not become a fence of its own ──────────────────────────────

test('an ordinary write inside the governed repo is still allowed', () => {
  const { parent, repo, cleanup } = nested();
  try {
    // From both vantage points, so the fix is not quietly refusing everything —
    // a guard that refuses all inputs passes every "does it refuse?" test.
    assert.equal(write(repo, join(repo, 'src', 'index.js')), ALLOW);
    assert.equal(write(parent, join(repo, 'src', 'index.js')), ALLOW);
  } finally { cleanup(); }
});

test('a file with no law anywhere above it is unaffected', () => {
  const { parent, cleanup } = nested();
  try {
    const loose = join(parent, 'loose.txt');
    assert.equal(governingRoot(loose), null);
    assert.equal(rootForCall(parent, { file_path: loose }).root, parent);
  } finally { cleanup(); }
});

test('the nearest law wins, not the outermost', () => {
  const { parent, repo, cleanup } = nested();
  try {
    const inner = join(repo, 'vendor', 'sub');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [] }, null, 2));
    assert.equal(governingRoot(join(inner, 'x.js')), inner, 'a nested repo governs its own files');
    assert.equal(governingRoot(join(repo, 'src', 'index.js')), repo, 'and does not govern its parent\'s');
    assert.notEqual(parent, repo);
  } finally { cleanup(); }
});

test('a call spanning two constitutions refuses rather than picking the looser', () => {
  const { parent, repo, cleanup } = nested();
  try {
    const other = join(parent, 'other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [] }, null, 2));

    const scope = rootForCall(parent, { file_path: join(repo, 'src', 'index.js'), notebook_path: join(other, 'a.js') });
    assert.ok(scope.split, 'two governing roots must be reported as a split, not silently resolved');
    assert.equal(scope.split.length, 2);

    // The permissive law must not be able to speak for the strict one's files.
    assert.equal(
      quiet(() => runFence({
        tool_name: 'Write',
        cwd: other,
        session: 't',
        tool_input: { file_path: join(repo, 'aukora.law.json'), notebook_path: join(other, 'a.js') },
      })),
      REFUSE,
    );
  } finally { cleanup(); }
});

test('governingRoot walks up rather than checking only the immediate directory', () => {
  const { repo, cleanup } = nested();
  try {
    const deep = join(repo, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    assert.equal(governingRoot(join(deep, 'f.js')), repo);
    assert.equal(dirname(join(deep, 'f.js')), deep, 'the file is genuinely several levels down');
  } finally { cleanup(); }
});

// ── the law is chosen where the write LANDS ────────────────────────────────
//
// The first version handed `governingRoot` the LEXICAL path while enforcement
// downstream realpaths. So a leaf that is a symlink into another repository
// selected its authority under one law and was judged under another — the same
// error as trusting the caller's cwd, one level further down. This function
// exists because the constitution must not be selectable, and a symlink
// selects it.

test('a symlink into another repository cannot pick that repository\'s law', () => {
  const { parent, repo, cleanup } = nested();
  try {
    // A second repo whose law protects NOTHING.
    const lax = join(parent, 'lax');
    mkdirSync(join(lax, 'inner'), { recursive: true });
    writeFileSync(join(lax, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [] }, null, 2));

    // …and, inside the STRICT repo, a name that points at it. The target does
    // NOT exist — creating through a link is exactly what an ordinary Write to
    // a new filename does when that name happens to be a link, and `realpath`
    // cannot follow a dangling one.
    const alias = join(repo, 'alias.json');
    symlinkSync(join(lax, 'inner', 'anything.json'), alias);

    const scope = rootForCall(repo, { file_path: alias });
    // The spelling lives under `repo`; the landing lives under `lax`. Two
    // constitutions answer for one path, so it must not resolve to one of them.
    assert.ok(scope.split, 'a path answering to two laws must be reported as a split');
    assert.equal(new Set(scope.split).size, 2);
    assert.ok(scope.split.includes(lax), 'the landing repository must be among them');
    assert.ok(scope.split.includes(repo), 'and so must the one it is spelled under');
  } finally { cleanup(); }
});

test('an ordinary file still resolves to exactly one law', () => {
  // The control: the split must be caused by the alias, not by realpathing.
  const { repo, cleanup } = nested();
  try {
    const scope = rootForCall(repo, { file_path: join(repo, 'src', 'index.js') });
    assert.equal(scope.split, undefined);
    assert.equal(scope.root, repo);
  } finally { cleanup(); }
});

test('an EXISTING symlink target is caught the same way', () => {
  // The companion to the dangling case above: realpath can follow this one, so
  // it exercises the other branch of `realTarget`.
  const { parent, repo, cleanup } = nested();
  try {
    const lax = join(parent, 'lax2');
    mkdirSync(join(lax, 'inner'), { recursive: true });
    writeFileSync(join(lax, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [] }, null, 2));
    writeFileSync(join(lax, 'inner', 'real.json'), '{}\n');

    const alias = join(repo, 'alias2.json');
    symlinkSync(join(lax, 'inner', 'real.json'), alias);

    const scope = rootForCall(repo, { file_path: alias });
    assert.ok(scope.split, 'an existing alias across laws must split too');
    assert.ok(scope.split.includes(lax));
  } finally { cleanup(); }
});
