// aukora · test/witness-injection.test.mjs — the hash must cover EVERY key, or it covers nothing.
//
// ══ THE BUG THIS EXISTS FOR ══
//
// `readAll()` parsed each line and then handed back `{ ...entry, __line, __raw }` — display metadata
// mixed into the same object as the receipt. `bodyOf()` therefore had to exclude it before hashing,
// and it did so by NAME SHAPE: skip any key starting with `__`.
//
// That made the exclusion a property of the DATA rather than of the reader. Anything on disk whose key
// began with `__` was removed from the preimage before the hash was recomputed — so it could be added
// to, or removed from, any receipt at rest, and the chain still verified clean. Measured against the
// shipped binary before the fix:
//
//     BEFORE   chain intact · 3 receipts · head 7b794cc3942d…
//       inject __exfil = "BEGIN RSA PRIVATE KEY …"
//     AFTER    chain intact · 3 receipts · head 7b794cc3942d…
//
// Two claims fell with it, and both are load-bearing:
//
//   · `AGENTS.md` and LIMITS §8 — "proves that record has not been altered since it was written."
//     False, in this one direction, for unlimited arbitrary content.
//   · `chain.mjs` — "Never file contents, never diffs, never prompts, never command text." That is
//     what the WRITER emits. It was not a property of the FORMAT, so a chain could carry a private key
//     and still verify. The whole argument for publishing a chain rests on that being structural.
//
// ══ THE SAME HOLE WAS IN THE ANCHORS, AND NOBODY HAD LOOKED ══
//
// `anchorBody()` skipped `__` for the same reason `bodyOf()` did — `readAnchors()` also injected
// `__line`. So the signed genesis, law and checkpoint records were injectable too. A signature over a
// digest that does not cover the bytes is a signature over an opinion.
//
// ══ WHY THE CONTROL CASE IS HERE ══
//
// A verifier that rejected every chain would pass every assertion above and protect nothing. So the
// first test in each pair is an untampered record that MUST still verify. Same discipline as case 00
// in `conformance/`: a fence that refuses everything is not a fence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { append, chainPath, readAll, MAX_LINE_BYTES } from '../core/witness/chain.mjs';
import { verifyChain } from '../core/witness/verify.mjs';
import { anchorBody, anchorDigest, appendAnchor, buildAnchor, verifyAnchor } from '../core/witness/authority.mjs';
import { makeRepo } from './helpers/fixture.mjs';

/** Three real receipts through the real writer. */
function chainOfThree(root) {
  for (const n of ['a.txt', 'b.txt', 'c.txt']) {
    append(root, {
      ts: `T-${n}`, tool: 'Write', path: n, resolved: n,
      verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null, mode: 'default',
    }, null);
  }
}

/** Put a key on every line of the chain, leaving `hash`, `prev` and `sig` untouched. */
function injectIntoEveryReceipt(root, key, value) {
  const file = chainPath(root);
  const out = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((line) => {
    const e = JSON.parse(line);
    e[key] = value;
    return JSON.stringify(e);
  });
  writeFileSync(file, `${out.join('\n')}\n`, 'utf8');
}

const SECRET = 'BEGIN RSA PRIVATE KEY … an entire secret could live here';

// ---------------------------------------------------------------------------
// THE RECEIPT CHAIN
// ---------------------------------------------------------------------------

test('CONTROL — an untouched chain of three verifies', () => {
  const { root, cleanup } = makeRepo();
  try {
    chainOfThree(root);
    const v = verifyChain(root);
    assert.equal(v.intact, true, 'a clean chain must verify, or nothing below means anything');
    assert.equal(v.hashBreaks.length, 0);
  } finally { cleanup(); }
});

test('a __-prefixed key injected at rest breaks the hash it was hidden from', () => {
  const { root, cleanup } = makeRepo();
  try {
    chainOfThree(root);
    assert.equal(verifyChain(root).intact, true, 'precondition: clean before the injection');

    injectIntoEveryReceipt(root, '__exfil', SECRET);

    const v = verifyChain(root);
    assert.equal(v.intact, false, 'THE REGRESSION: injected content must not verify clean');
    assert.equal(v.hashBreaks.length, 3, 'every tampered receipt is named, not just the first');
    // The bytes are still on disk — the point is that the verifier now says so.
    assert.match(readFileSync(chainPath(root), 'utf8'), /__exfil/u);
  } finally { cleanup(); }
});

test('REMOVING a key is caught too — the hash covers absence as well as presence', () => {
  const { root, cleanup } = makeRepo();
  try {
    chainOfThree(root);
    const file = chainPath(root);
    const out = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((line) => {
      const e = JSON.parse(line);
      delete e.mode;                       // a real field, quietly dropped
      return JSON.stringify(e);
    });
    writeFileSync(file, `${out.join('\n')}\n`, 'utf8');

    assert.equal(verifyChain(root).intact, false, 'a dropped field must break its receipt');
  } finally { cleanup(); }
});

test('any key name is covered, not a blocklist of the ones we thought of', () => {
  // The fix must not be "also exclude __exfil". Every key present is hashed.
  for (const key of ['__line', '__raw', '__proto__x', '_single', 'ordinary', '__']) {
    const { root, cleanup } = makeRepo();
    try {
      chainOfThree(root);
      injectIntoEveryReceipt(root, key, 'x');
      assert.equal(verifyChain(root).intact, false, `injecting ${key} must break the hash`);
    } finally { cleanup(); }
  }
});

// ---------------------------------------------------------------------------
// THE SIGNED ANCHORS — same hole, same fix
// ---------------------------------------------------------------------------

const anchorFixture = () => buildAnchor({
  kind: 'law', rootId: 'r0', signedBy: 'root', keyId: 'r0',
  subject: { file: 'aukora.law.json', sha256: 'a'.repeat(64) }, at: '2026-01-01T00:00:00.000Z',
});

test('CONTROL — an anchor digest reproduces from its own body', () => {
  const a = anchorFixture();
  const signed = { ...a, digest: anchorDigest(a) };
  assert.equal(anchorDigest(signed), signed.digest, 'a clean anchor must self-reproduce');
});

test('a __-prefixed key injected into an anchor changes its digest', () => {
  const a = anchorFixture();
  const signed = { ...a, digest: anchorDigest(a), sig: null };

  const tampered = { ...signed, __exfil: SECRET };
  assert.notEqual(anchorDigest(tampered), signed.digest,
    'THE REGRESSION: an injected key must move the anchor digest');

  const v = verifyAnchor(tampered, { rootPub: null, devicePub: null });
  assert.equal(v.ok, false);
  assert.match(v.reason, /digest does not match/u,
    'and it must be rejected for the digest, before any question about keys');
});

test('anchorBody carries every key except the two that cannot be in their own digest', () => {
  const b = anchorBody({ kind: 'law', digest: 'd', sig: 's', __line: 3, __exfil: 'x', ordinary: 1 });
  assert.deepEqual(Object.keys(b).sort(), ['__exfil', '__line', 'kind', 'ordinary'],
    'only `digest` and `sig` are excluded, and only because they cannot cover themselves');
});

// ---------------------------------------------------------------------------
// THE ATOMICITY BOUND
//
// `MAX_LINE_BYTES` is not a formatting preference. `chain.mjs` argues that the append needs no lock
// because a single `O_APPEND` write that does not exceed the pipe buffer is atomic against a
// concurrent writer — and two guard processes CAN be in flight at once, because subagents fire hooks
// too. An over-long line is a torn line, which is a corrupted chain, which is the one failure mode
// that looks like tampering and is not.
//
// The bound was argued and not enforced: `append()` shortened `body.path` once, so any other
// envelope-supplied field could carry the line past 4096 bytes unchallenged.
// ---------------------------------------------------------------------------

test('CONTROL — an ordinary receipt is well under the bound and nothing is truncated', () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, {
      ts: 'T', tool: 'Write', path: 'src/index.js', resolved: 'src/index.js',
      verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 'abc', agent: null, mode: 'default',
    }, null);
    const [line] = readFileSync(chainPath(root), 'utf8').trimEnd().split('\n');
    assert.ok(Buffer.byteLength(line, 'utf8') + 1 <= MAX_LINE_BYTES);
    const { entry } = readAll(root).records[0];
    assert.equal(entry.path, 'src/index.js', 'a short path must arrive intact');
    assert.equal(entry.session, 'abc');
  } finally { cleanup(); }
});

test('a runtime-supplied field cannot carry the line past the atomicity bound', () => {
  // `session` comes straight off the hook envelope and nothing bounded it. Same for tool/agent/mode.
  for (const field of ['session', 'tool', 'agent', 'mode', 'resolved']) {
    const { root, cleanup } = makeRepo();
    try {
      append(root, {
        ts: 'T', tool: 'Write', path: 'a.txt', resolved: 'a.txt', verdict: 'allowed',
        reasonClass: 'ok:allowed', rule: null, session: 's', agent: null, mode: 'default',
        [field]: 'X'.repeat(5000),
      }, null);
      for (const line of readFileSync(chainPath(root), 'utf8').trimEnd().split('\n')) {
        assert.ok(Buffer.byteLength(line, 'utf8') + 1 <= MAX_LINE_BYTES,
          `${field}: line is ${Buffer.byteLength(line, 'utf8')} bytes, bound is ${MAX_LINE_BYTES}`);
      }
    } finally { cleanup(); }
  }
});

test('what may never be truncated to make a line fit', () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, {
      ts: '2026-01-01T00:00:00.000Z', tool: 'Write', path: 'a.txt', resolved: 'a.txt',
      verdict: 'refused', reasonClass: 'law:protected-path', rule: 'secrets/**',
      session: 'S'.repeat(5000), agent: null, mode: 'bypassPermissions',
    }, null);
    const { entry } = readAll(root).records[0];
    // The security-relevant answer survives whatever the display fields had to give up.
    assert.equal(entry.verdict, 'refused');
    assert.equal(entry.reasonClass, 'law:protected-path');
    assert.equal(entry.rule, 'secrets/**');
    assert.equal(entry.ts, '2026-01-01T00:00:00.000Z');
    assert.equal(entry.mode, 'bypassPermissions', 'the permission posture is evidence, not decoration');
    assert.equal(verifyChain(root).intact, true, 'and the truncated receipt still hashes');
  } finally { cleanup(); }
});

test('truncation is visible in the record, never silent', () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, {
      ts: 'T', tool: 'Write', path: `src/${'d'.repeat(4000)}.js`, resolved: 'x',
      verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null, mode: 'default',
    }, null);
    const { entry } = readAll(root).records[0];
    assert.notEqual(entry.path.length, 4008, 'it must actually have been shortened');
    assert.match(entry.path, /…/u, 'and the record must say so, or a reader trusts a partial path');
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// THE SIGNED CHECKPOINT — read at last
//
// The guard signs `{ head, repoId, chainFile }` hourly and appends it to the anchors. Nothing read
// `subject.head`: the object was signed, verified as well-formed, and used as evidence about nothing.
// A reader seeing a signed checkpoint reasonably assumes it was checked against something.
//
// What is honestly checkable locally is narrow, and the tests say which half is which.
// ---------------------------------------------------------------------------

test('CONTROL — a signed head still present in the chain raises nothing', () => {
  const { root, cleanup } = makeRepo();
  try {
    chainOfThree(root);
    const head = readAll(root).records[1].entry.hash;      // a real head, mid-chain
    appendAnchor(root, buildAnchor({
      kind: 'checkpoint', rootId: 'r0', signedBy: 'device', keyId: 'd0',
      subject: { head, repoId: 'x', chainFile: chainPath(root) }, at: '2026-01-01T00:00:00.000Z',
    }));
    assert.deepEqual(verifyChain(root).checkpointBreaks, [],
      'a head that is still there must not be reported — a checker that always fires is not a checker');
  } finally { cleanup(); }
});

test('a head this device signed that has vanished from the chain is named', () => {
  const { root, cleanup } = makeRepo();
  try {
    chainOfThree(root);
    appendAnchor(root, buildAnchor({
      kind: 'checkpoint', rootId: 'r0', signedBy: 'device', keyId: 'd0',
      subject: { head: 'f'.repeat(64), repoId: 'x', chainFile: chainPath(root) },
      at: '2026-01-01T00:00:00.000Z',
    }));
    const v = verifyChain(root);
    assert.equal(v.checkpointBreaks.length, 1, 'a signed head that is gone means a rewrite below it');
    assert.match(v.checkpointBreaks[0].reason, /rewritten below/u);
    assert.equal(v.intact, true, 'and `intact` stays purely about the chain — this folds into `ok` only');
    assert.equal(v.ok, false);
  } finally { cleanup(); }
});

test('a checkpoint says which chain it is about', () => {
  const { root, cleanup } = makeRepo();
  try {
    chainOfThree(root);
    const cp = buildAnchor({
      kind: 'checkpoint', rootId: 'r0', signedBy: 'device', keyId: 'd0',
      subject: { head: 'a'.repeat(64), repoId: 'the-id', chainFile: chainPath(root) },
      at: '2026-01-01T00:00:00.000Z',
    });
    // Both were wrong before: `chainFile` was the hardcoded constant `.aukora/chain.jsonl` — the
    // location the chain LEFT when it moved to `~/.aukora/chains/<identity>.jsonl` — and there was no
    // `repoId` at all, so the record did not say which chain it was about. A statement with an unnamed
    // subject is not evidence; it cannot be shown to be about anything.
    assert.equal(cp.subject.repoId, 'the-id');
    // The property that matters is that the path is RESOLVED rather than assumed. A fixture repo has
    // no git and therefore no identity, so its chain legitimately stays in-tree — the assertion is
    // that the signed path is whatever `chainPath` actually returns, wherever that is.
    assert.equal(cp.subject.chainFile, chainPath(root));
    assert.ok(cp.subject.chainFile.startsWith('/'),
      'a resolved absolute path, not the relative constant the old code signed');
  } finally { cleanup(); }
});
