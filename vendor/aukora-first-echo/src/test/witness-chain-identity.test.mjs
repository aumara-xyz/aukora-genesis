// aukora · test/witness-chain-identity.test.mjs — F3: WHICH CHAIN IS `verify` VERIFYING?
//
// ══ THE FINDING ══
//
// A chain lives at `~/.aukora/chains/<identity>.jsonl`, and the identity is
// `sha256(origin_url + root_commit)`. That was a deliberate, good decision — keying by identity
// rather than by path means moving or renaming a checkout does not silently begin a fresh record.
//
// But identity derived from a MUTABLE input is a switch. `git remote set-url origin <anything>`
// changes the identity, which changes which file is read, and nothing says so. Measured on 32c7755:
// three receipts, repoint origin, and `aukora verify` reports "chain intact · 1 receipt", exit 0 —
// the three prior receipts orphaned without a word. Not corruption; substitution. The tool answers a
// question about a different record and reports success.
//
// ══ WHY THIS IS NOT A REWRITE ══
//
// The evidence to catch it is ALREADY BEING WRITTEN and simply was not read. `writeCheckpoint` puts
// `repoId` and `chainFile` into the SIGNED subject of every checkpoint anchor; `verifyAnchors` read
// only `subject.head`. So the fix is to read a field that a device key already signed: if the latest
// checkpoint was signed over one identity and the repository now answers to another, the record and
// the repository have been separated, and `verify` says so instead of reporting on whichever file it
// happened to land in.
//
// What this does NOT do, stated plainly rather than implied: it does not prevent the switch, and it
// cannot recover the orphaned chain. An unsigned node — one that has never bound — has no checkpoint
// to compare against and gets no protection from this at all. That limit is real and is written into
// docs/LIMITS.md rather than papered over here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { sign as edSign } from 'node:crypto';

import { append } from '../core/witness/chain.mjs';
import { verifyChain, verifyAnchors } from '../core/witness/verify.mjs';
import { bind, privFromB64, PUB_FILE, mintDeviceSecret, mintRecoverySecret} from '../core/witness/aumlok.mjs';
import { writeCheckpoint } from '../core/witness/authority.mjs';
import { repoIdentity } from '../core/witness/identity.mjs';
import { makeRepo } from './helpers/fixture.mjs';

// Minted, not a placeholder: `bind()` refuses a degenerate factor, and a repeated byte is the
// exact shape that refusal exists to catch.
const DEVICE_SECRET = mintDeviceSecret();
const RECOVERY_SECRET = mintRecoverySecret();

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A bound repository with an origin, a commit, and a signed checkpoint over its identity. */
function anchored() {
  const { root, cleanup } = makeRepo();
  // `makeRepo` builds a directory with a law, not a git repository — and this finding is entirely
  // about git identity, so the repository has to be real.
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t.t');
  git(root, 'config', 'user.name', 't');
  git(root, 'remote', 'add', 'origin', 'https://example.invalid/original.git');
  writeFileSync(`${root}/seed.txt`, 'seed\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'seed');

  const { deviceFile, pubFile } = bind({ phrase: 'test phrase not a real secret seven words', deviceSecret: DEVICE_SECRET, recoverySecret: RECOVERY_SECRET, boundAt: 'T0' });
  writeFileSync(`${root}/${PUB_FILE}`, `${JSON.stringify(pubFile, null, 2)}\n`);
  const deviceKey = privFromB64(deviceFile.priv);
  const signer = { sign: (h) => edSign(null, Buffer.from(h, 'utf8'), deviceKey).toString('base64') };

  append(root, {
    ts: 'T1', tool: 'Write', path: 'a.txt', resolved: 'a.txt',
    verdict: 'refused', reasonClass: 'ok:refused', rule: 'secrets/**', session: 's', agent: null,
  }, signer.sign);

  const cp = writeCheckpoint({ repoRoot: root, pubFile, signer, at: 'T2' });
  assert.equal(cp.ok, true, 'precondition: the checkpoint must have been written');
  return { root, cleanup, signer, pubFile };
}

test('the verdict SAYS which identity it verified', () => {
  const A = anchored();
  try {
    const v = verifyChain(A.root);
    assert.ok(v.identity, 'the verdict must name the record it is about');
    assert.equal(v.identity.id, repoIdentity(A.root).id);
    assert.equal(typeof v.identity.chainFile, 'string');
    assert.ok(v.identity.chainFile.length > 0);
    // `source` is how the identity was derived, so a reader can tell an origin-keyed chain from one
    // keyed by root-commit alone — the difference between "renaming is safe" and "repointing is".
    assert.equal(v.identity.source, 'origin+root-commit');
  } finally { A.cleanup(); }
});

test('repointing origin is caught by the identity the checkpoint already signed', () => {
  const A = anchored();
  try {
    const before = repoIdentity(A.root).id;
    assert.ok(before, 'precondition: the repository has an identity');
    assert.deepEqual(verifyAnchors(A.root).breaks, [], 'precondition: anchors verify before the switch');

    // The whole attack, and it is one ordinary command.
    git(A.root, 'remote', 'set-url', 'origin', 'https://example.invalid/attacker.git');

    const after = repoIdentity(A.root).id;
    assert.notEqual(after, before, 'precondition: repointing origin really does change the identity');

    const anchors = verifyAnchors(A.root);
    assert.equal(anchors.ok, false, 'a switched identity must not verify clean');
    const found = anchors.breaks.find((b) => /identity/i.test(b.reason));
    assert.ok(found, `expected an identity break, got: ${JSON.stringify(anchors.breaks)}`);
    // Both halves named, so the owner can see what it was signed as and what it answers to now.
    assert.ok(found.reason.includes(before.slice(0, 12)), 'the signed identity must be named');
    assert.ok(found.reason.includes(after.slice(0, 12)), 'the current identity must be named');
  } finally { A.cleanup(); }
});

test('an unswitched repository still verifies clean — the control', () => {
  // Without this, a check that flagged every repository would pass the test above and mean nothing.
  const A = anchored();
  try {
    const anchors = verifyAnchors(A.root);
    assert.deepEqual(anchors.breaks, []);
    assert.equal(verifyChain(A.root).intact, true);
  } finally { A.cleanup(); }
});
