// aukora · test/paths.test.mjs — the attacks, and what each one proves
//
// Every case here is run TWICE: once against `naiveJudge` (lexical only) and
// once against the real fence. The naive result is asserted too, because the
// point of the test is not only "the fence holds" but "here is the specific
// thing that would have got through, and here is the line of code that stops
// it." A guard nobody has watched fail is decoration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { analyse, foldPath, isMultiplyLinked, isLinkStateUnknowable, linkState } from '../src/paths.mjs';
import { compileAll, judge, DEFAULT_PROTECTED } from '../src/law.mjs';
import { makeRepo, link, hardlink, naiveJudge } from './helpers/fixture.mjs';

const PATTERNS = ['secrets/**', 'aukora.law.json', '.claude/settings.json', '.git/**'];
const RULES = compileAll(PATTERNS);

/** Run one raw path through the real fence. */
function fence(root, raw) {
  const a = analyse(root, raw);
  if (!a.ok) return { refused: true, why: `unresolvable: ${a.reason}` };
  if (a.outside) return { refused: true, why: 'outside-repo' };
  // This helper must mirror `decide()` in src/guard.mjs. It drifted once
  // already: the unknowable-link check landed in the guard and not here, so
  // A24 failed against a helper that was more permissive than the real fence.
  if (isLinkStateUnknowable(a.links)) return { refused: true, why: `link state unknowable (${a.links.reason})` };
  if (isMultiplyLinked(a.links)) return { refused: true, why: `multiply-linked (nlink=${a.links.nlink})` };
  const v = judge(RULES, a.keys);
  return { refused: v.protected, why: v.protected ? `rule ${v.rule}` : 'allowed', keys: a.keys };
}

test('the ordinary case: an innocent path is allowed, a declared one is not', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.equal(fence(root, 'src/index.js').refused, false);
    assert.equal(fence(root, 'secrets/key.txt').refused, true);
    assert.equal(fence(root, 'aukora.law.json').refused, true);
  } finally { cleanup(); }
});

test('A1 · dot-dot traversal — caught by BOTH (lexical resolve is enough)', () => {
  const { root, cleanup } = makeRepo();
  try {
    const attack = 'src/../secrets/key.txt';
    assert.equal(naiveJudge(root, attack, PATTERNS).protected, true, 'naive already handles ..');
    assert.equal(fence(root, attack).refused, true);
  } finally { cleanup(); }
});

test('A2 · absolute path to a protected file — caught by BOTH', () => {
  const { root, cleanup } = makeRepo();
  try {
    const attack = join(root, 'secrets', 'key.txt');
    assert.equal(naiveJudge(root, attack, PATTERNS).protected, true);
    assert.equal(fence(root, attack).refused, true);
  } finally { cleanup(); }
});

test('A3 · symlink to a protected file — naive ALLOWS, fence refuses', () => {
  const { root, cleanup } = makeRepo();
  try {
    link(root, 'innocent.txt', join(root, 'secrets', 'key.txt'));
    const attack = 'innocent.txt';

    // This is the whole reason `realpathish` exists. Same bytes, different name.
    assert.equal(naiveJudge(root, attack, PATTERNS).protected, false,
      'RED: a lexical fence sees an innocent name and allows the write');
    assert.equal(fence(root, attack).refused, true,
      'GREEN: resolution sees secrets/key.txt');
  } finally { cleanup(); }
});

test('A4 · symlinked PARENT directory — naive ALLOWS, fence refuses', () => {
  const { root, cleanup } = makeRepo();
  try {
    link(root, 'docs', join(root, 'secrets'));
    const attack = 'docs/key.txt';

    // The case a leaf-only realpath misses: the target may not exist yet, so
    // `realpathSync(target)` throws and a naive implementation gives up. The
    // ancestor walk is what catches this.
    assert.equal(naiveJudge(root, attack, PATTERNS).protected, false,
      'RED: the leaf name is innocent and the parent was never resolved');
    assert.equal(fence(root, attack).refused, true);
  } finally { cleanup(); }
});

test('A5 · symlinked parent to a file that does NOT exist yet', () => {
  const { root, cleanup } = makeRepo();
  try {
    link(root, 'docs', join(root, 'secrets'));
    // Nothing at docs/brand-new.txt. A Write creates it. The fence must still
    // resolve the parent.
    assert.equal(fence(root, 'docs/brand-new.txt').refused, true);
  } finally { cleanup(); }
});

test('A6 · case variation on a case-insensitive filesystem — naive ALLOWS', () => {
  const { root, cleanup } = makeRepo();
  try {
    const attack = 'SECRETS/KEY.TXT';
    assert.equal(naiveJudge(root, attack, PATTERNS).protected, false,
      'RED: string comparison is case-sensitive; APFS is not');
    assert.equal(fence(root, attack).refused, true);
    assert.equal(fence(root, 'AuKoRa.LaW.jSoN').refused, true);
  } finally { cleanup(); }
});

test('A7 · unicode NFD vs NFC — naive ALLOWS', () => {
  const { root, cleanup } = makeRepo({ protected: ['café/**'] });
  try {
    const rules = compileAll(['café/**']);
    const nfc = 'café/secret.txt';          // é as one code point
    const nfd = 'café/secret.txt';         // e + combining acute

    assert.notEqual(nfc, nfd, 'the two spellings are different strings');
    assert.equal(naiveJudge(root, nfd, ['café/**']).protected, false,
      'RED: APFS hands back NFD; a law written NFC never matches it');

    const a = analyse(root, nfd);
    assert.equal(judge(rules, a.keys).protected, true,
      'GREEN: both sides fold to NFC before comparison');
  } finally { cleanup(); }
});

test('A8 · trailing dot and trailing space — naive ALLOWS', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.equal(naiveJudge(root, 'aukora.law.json.', PATTERNS).protected, false, 'RED');
    assert.equal(naiveJudge(root, 'aukora.law.json ', PATTERNS).protected, false, 'RED');
    assert.equal(fence(root, 'aukora.law.json.').refused, true);
    assert.equal(fence(root, 'aukora.law.json ').refused, true);
  } finally { cleanup(); }
});

test('A9 · the directory ROOT itself, not just its descendants', () => {
  const { root, cleanup } = makeRepo();
  try {
    // `.git/**` must cover bare `.git`. In a git worktree `.git` is not a
    // directory — it is a small file naming which repository this is.
    assert.equal(fence(root, '.git').refused, true, 'bare .git');
    assert.equal(fence(root, '.git/config').refused, true);
    assert.equal(fence(root, 'secrets').refused, true, 'bare secrets');
  } finally { cleanup(); }
});

test('A10 · a write outside the repository is refused', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.equal(fence(root, '/etc/hosts').refused, true);
    assert.equal(fence(root, '../../../etc/hosts').refused, true);
    assert.equal(fence(root, '~/.claude/settings.json').refused, false,
      'a literal ~ is a directory name, not a home expansion — it stays in-repo');
  } finally { cleanup(); }
});

test('A11 · a symlink pointing OUT of the repository is refused', () => {
  const { root, cleanup } = makeRepo();
  try {
    link(root, 'escape', '/etc');
    assert.equal(naiveJudge(root, 'escape/hosts', PATTERNS).protected, false, 'RED');
    assert.equal(fence(root, 'escape/hosts').refused, true, 'outside-repo via symlink');
  } finally { cleanup(); }
});

test('A12 · malformed input is refused, never silently allowed', () => {
  const { root, cleanup } = makeRepo();
  try {
    for (const bad of ['', '\0', 'a\0b', null, undefined, 42, {}, []]) {
      const r = fence(root, bad);
      assert.equal(r.refused, true, `refused: ${JSON.stringify(bad)}`);
    }
  } finally { cleanup(); }
});

test('A13 · a hard link at an innocent name is REFUSED when the leaf exists', () => {
  const { root, cleanup } = makeRepo();
  try {
    hardlink(root, 'innocent.txt', 'secrets/key.txt');
    const attack = 'innocent.txt';

    // A hard link is a second NAME for one inode. There is no target to
    // resolve TO, so both the lexical and the realpath'd form return the
    // innocent name and every path comparison in this file agrees the write is
    // fine. Measured before the fix: `echo OVERWRITTEN > notes/innocent.txt`
    // changed law/protected.txt.
    //
    // This test used to assert the gap was open, and cited '(device, inode)
    // cannot work for a file that does not exist yet'. That is true of a Write
    // to a NEW path and false of every other case — and a hard link can only
    // exist to a file that already exists, so the case the reasoning excused
    // was never the case that mattered.
    assert.equal(naiveJudge(root, attack, PATTERNS).protected, false,
      'still invisible to any purely lexical matcher');
    const a = analyse(root, attack);
    assert.equal(a.aliased, false, 'and invisible to resolution — there is no target to resolve to');

    assert.equal(fence(root, attack).refused, true,
      'but the inode says nlink=2, and a name we cannot reason about is a name we do not allow');
  } finally { cleanup(); }
});

test('A18 · the link check is narrow — it refuses on nlink, not on suspicion', () => {
  const { root, cleanup } = makeRepo();
  try {
    // An ordinary singly-linked file is untouched by the new check.
    assert.equal(fence(root, 'src/index.js').refused, false, 'nlink=1 is allowed');

    // A path that does not exist yet cannot be a hard link to anything, so the
    // check does not fire and the write proceeds on the law alone. This is the
    // residue: a Write creating a NEW file is judged by path only.
    assert.equal(fence(root, 'src/brand-new.js').refused, false, 'absent leaf, nothing to stat');

    // A symlink is still resolved, not link-checked — O_NOFOLLOW would ELOOP on
    // it, and resolution already sees through it.
    link(root, 'alias.txt', join(root, 'src', 'index.js'));
    assert.equal(fence(root, 'alias.txt').refused, false, 'a symlink to an innocent file is still fine');
  } finally { cleanup(); }
});

test('A14 · the fold is total — every alias collapses to one key', () => {
  assert.equal(foldPath('Secrets/Key.TXT'), 'secrets/key.txt');
  assert.equal(foldPath('a/./b'), 'a/b');
  assert.equal(foldPath('a//b'), 'a/b');
  assert.equal(foldPath('trailing. '), 'trailing');
  assert.equal(foldPath('café'), 'café');
});

test('A15 · the self-protection set cannot be dropped by editing the law', () => {
  const { root, cleanup } = makeRepo({ protected: [] });
  try {
    // A law that lists nothing still protects itself and the hook config.
    // Verified through loadLaw in law.test.mjs; here we assert the constant
    // that makes it true has not quietly shrunk.
    for (const must of ['aukora.law.json', '.claude/settings.json', '.aukora/**']) {
      assert.ok(DEFAULT_PROTECTED.includes(must), `${must} is in the default set`);
    }
  } finally { cleanup(); }
});

test('A16 · glob shapes behave', () => {
  const r = compileAll(['src/**/*.env', '*.pem', 'a?c/**']);
  const k = (s) => judge(r, [foldPath(s)]).protected;
  assert.equal(k('src/a/b/c.env'), true);
  assert.equal(k('src/c.env'), true);
  assert.equal(k('src/c.envx'), false);
  assert.equal(k('key.pem'), true);
  assert.equal(k('sub/key.pem'), false, '* does not cross a separator');
  assert.equal(k('abc/x'), true);
  assert.equal(k('abbc/x'), false, '? is exactly one character');
});

test('A17 · a segment that folds to nothing must not break the key (Kimi K3)', () => {
  // `...`, `. ` and ` ` are legal directory names on APFS. Folding strips
  // their trailing dots and spaces, so each becomes ''. When the empty-segment
  // filter ran BEFORE the fold, that empty survived into the key as `//`, and
  // `**` — which compiles to `(?:[^/]+/)*` — could no longer match across it.
  //
  // Result: every suggested rule naming a FILE rather than a directory prefix
  // stopped matching, and the write was allowed with exit 0.
  const rules = compileAll(['**/*.pem', '**/*.key', '**/id_ed25519']);
  const protectedBy = (p) => judge(rules, [foldPath(p)]).protected;

  for (const attack of ['src/.../aws.pem', 'src/. /aws.pem', 'src/ /id_ed25519',
    'a/.../b/c.key', 'x/... /... /y.pem']) {
    assert.equal(protectedBy(attack), true, `${attack} must still be protected`);
    assert.equal(foldPath(attack).includes('//'), false, `${attack} leaves no empty segment`);
  }
  assert.equal(protectedBy('src/index.js'), false, 'and ordinary paths are still allowed');
});

test('A19 · a FIFO does not hang the guard (gpt-5.6-sol, council)', () => {
  const { root, cleanup } = makeRepo();
  try {
    // `openSync(fifo, O_RDONLY)` blocks until a writer appears, and it blocks
    // the EVENT LOOP, so no timer can rescue it. Measured before O_NONBLOCK: a
    // 3-second watchdog never fired. The harness would eventually time out and
    // `|| exit 2` would refuse — fail-closed, but only after stalling every
    // call for the full timeout.
    //
    // If this test ever hangs instead of failing, that is the bug returning.
    execFileSync('mkfifo', [join(root, 'pipe')]);
    const t0 = Date.now();
    const st = linkState(join(root, 'pipe'));
    const ms = Date.now() - t0;

    assert.ok(ms < 1000, `linkState returned in ${ms}ms — a blocking open is back`);
    assert.equal(st.checked, false, 'a FIFO is not a regular file and is not link-checked');
    assert.equal(fence(root, 'pipe').refused, false, 'and it is not refused for being one');
  } finally { cleanup(); }
});

test('A20 · a DANGLING symlink is still resolved (conformance: dangling-symlink)', () => {
  const { root, cleanup } = makeRepo();
  try {
    // `existsSync` FOLLOWS the link, so a symlink whose target does not exist
    // yet reports false — the ancestor walk stepped past the leaf, re-appended
    // its name, and returned an innocent in-repo path. The harness's own
    // open(O_CREAT) would then follow the link and create the file outside the
    // repository. `lstat` does not follow, which is the whole fix.
    link(root, 'escape.txt', '/nonexistent-target-xyz.txt');
    const a = analyse(root, 'escape.txt');
    assert.equal(a.outside, true, 'a dangling symlink out of the repo must read as outside');
    assert.equal(fence(root, 'escape.txt').refused, true);

    // And the recorded path must be the real one. `dir.slice(parent.length + 1)`
    // ate a character for any path directly under `/`, because the root ends in
    // a separator — '/nonexistent…' came back as '/onexistent…'. The verdict was
    // right either way; the RECEIPT was not.
    assert.equal(a.resolved, '/nonexistent-target-xyz.txt',
      'the resolved path is misspelled — a record that misnames what it refused');
  } finally { cleanup(); }
});

test('A21 · a symlink cycle terminates instead of spinning', () => {
  const { root, cleanup } = makeRepo();
  try {
    link(root, 'a.txt', join(root, 'b.txt'));
    link(root, 'b.txt', join(root, 'a.txt'));
    const t0 = Date.now();
    const a = analyse(root, 'a.txt');
    assert.ok(Date.now() - t0 < 1000, 'analyse did not terminate promptly on a cycle');

    // This asserted `ok: true` — "a cycle is answerable, not a crash" — which
    // was true and insufficient. Terminating is not the same as ANSWERING: the
    // resolution never completed, and the only honest verdict for a path this
    // gate could not resolve is a refusal. Tightened after the hop-exhaustion
    // escape showed what a lenient give-up costs.
    assert.equal(a.ok, false, 'a cycle is unresolvable and must refuse, not merely terminate');
    assert.equal(fence(root, 'a.txt').refused, true);
  } finally { cleanup(); }
});

test('A22 · hop exhaustion REFUSES — giving up must not look like an answer (council)', () => {
  const { root, cleanup } = makeRepo();
  try {
    // 20 dangling links ending outside the repository. Within the budget the
    // chain resolves and is refused as outside; past it, `realpathish` used to
    // return the ORIGINAL lexical name and the fence judged that innocent
    // in-repo path instead. Measured before the fix:
    //   10 hops → resolved /nonexistent-escape-target.txt, outside → exit 2
    //   20 hops → resolved d17.txt,                    not outside → exit 0
    // The harness then follows all twenty links and writes outside the repo.
    let prev = '/nonexistent-escape-target.txt';
    for (let i = 20; i >= 1; i -= 1) { link(root, `d${i}.txt`, prev); prev = `d${i}.txt`; }

    const a = analyse(root, 'd1.txt');
    assert.equal(a.ok, false, 'an unresolved chain must not be reported as resolved');
    assert.match(a.reason, /hop budget/);
    assert.equal(fence(root, 'd1.txt').refused, true);
  } finally { cleanup(); }
});

test('A23 · a chain WITHIN the budget still resolves, so A22 is not just refusing everything', () => {
  const { root, cleanup } = makeRepo();
  try {
    let prev = '/nonexistent-escape-target.txt';
    for (let i = 10; i >= 1; i -= 1) { link(root, `d${i}.txt`, prev); prev = `d${i}.txt`; }
    const a = analyse(root, 'd1.txt');
    assert.equal(a.ok, true, 'ten hops is inside the budget and must resolve');
    assert.equal(a.outside, true, 'and it resolves to the real target, outside the repo');
  } finally { cleanup(); }
});

test('A24 · a file we cannot open is not a file with one name (council)', () => {
  const { root, cleanup } = makeRepo();
  try {
    // mode 0200: writable, not readable. An O_RDONLY open fails EACCES, and
    // `checked:false` was read downstream as "not a hard link" when it means
    // "we do not know" — opposite answers. A multiply-linked file the agent
    // could not read walked through the check meant to notice exactly that.
    hardlink(root, 'decoy.txt', 'secrets/key.txt');
    chmodSync(join(root, 'decoy.txt'), 0o200);
    try {
      const st = linkState(join(root, 'decoy.txt'));
      assert.equal(st.unknowable, true, 'EACCES must read as unknowable, not as clean');
      assert.equal(fence(root, 'decoy.txt').refused, true);
    } finally { chmodSync(join(root, 'decoy.txt'), 0o600); }

    // And "cannot exist" stays benign — a name too long for any filesystem here
    // provably has no inode, so refusing it as un-inspectable would be wrong.
    const tooLong = linkState(join(root, `${'f'.repeat(4000)}.js`));
    assert.equal(tooLong.reason, 'ENAMETOOLONG');
    assert.equal(tooLong.unknowable, false, 'ENAMETOOLONG proves absence, it does not hide presence');
  } finally { cleanup(); }
});
