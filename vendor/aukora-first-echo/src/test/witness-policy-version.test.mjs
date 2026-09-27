// aukora · test/witness-policy-version.test.mjs — WHICH POLICY JUDGED THIS RECEIPT?
//
// ══ WHY NOW, AND ONLY NOW ══
//
// A receipt says what the fence decided. It did not say WHICH FENCE — which version of the rules and
// their interpretation was in force when the verdict was reached. Without that, two records are
// indistinguishable: one produced under a policy that refused a class of write, and one produced
// after that policy was weakened. The second can be presented as the first. That is a downgrade, and
// it is invisible to a hash chain, because every link is intact either way.
//
// `v: RECEIPT_VERSION` already existed and answers a DIFFERENT question — the shape of the line, not
// the semantics of the verdict. deny-by-default landing did not change the line format by one byte,
// and it changed what "allowed" means completely.
//
// The field goes in the HASHED body, so it is covered by the signature on every signed receipt and
// cannot be edited after the fact without breaking the chain. That is also why it can only be added
// while a repository has almost no history: every existing line hashes over the body it already has,
// so adding a field is additive and breaks nothing — but a record that is half-versioned can only
// ever say "these later ones were judged under a policy I can name, and about the earlier ones I
// have nothing to say."
//
// ══ WHAT IT IS NOT ══
//
// It is not an integrity claim about the law FILE — `checkLawAuthority` already answers that, by
// hashing the bytes and comparing them to what the owner signed. The two are complementary: the
// anchor says "this is the law the owner blessed", the policy version says "these are the semantics
// that read it". A law can be unchanged while the code interpreting it changes underneath.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { append, buildBody, POLICY_VERSION, chainPath } from '../core/witness/chain.mjs';
import { bodyOf, verifyChain } from '../core/witness/verify.mjs';
import { makeRepo } from './helpers/fixture.mjs';

const receipt = (i) => ({
  ts: `T${i}`, tool: 'Write', path: `f${i}.txt`, resolved: `f${i}.txt`,
  verdict: 'refused', reasonClass: 'law:protected-path', rule: 'secrets/**', session: 's', agent: null,
});

const rows = (root) => readFileSync(chainPath(root), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('the policy version is declared, and it is not the receipt-format version', async () => {
  assert.equal(typeof POLICY_VERSION, 'string');
  assert.ok(POLICY_VERSION.length > 0);
  // Two different questions. If these ever become the same value, one of them has stopped meaning
  // what it says — the line format and the fence semantics do not change together.
  const body = buildBody(receipt(0));
  assert.notEqual(String(body.policyVersion), String(body.v));
});

test('every appended receipt carries it', async () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, receipt(0));
    append(root, receipt(1));
    for (const r of rows(root)) {
      assert.equal(r.policyVersion, POLICY_VERSION, 'a receipt that cannot name its policy is the gap this closes');
    }
  } finally { cleanup(); }
});

test('it is inside the HASHED body, so a signature covers it and an edit breaks the chain', async () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, receipt(0));
    const [line] = rows(root);

    // In the body that is hashed — not metadata riding alongside it.
    assert.ok(Object.prototype.hasOwnProperty.call(bodyOf(line), 'policyVersion'));

    // And therefore tamper-evident: rewriting it to claim a different policy breaks the receipt's
    // own hash. Without this, a downgrade could be backdated onto an existing record for free.
    const tampered = { ...line, policyVersion: 'aukora-policy-v0-weaker' };
    const { createHash } = await import('node:crypto');
    const { preimage } = await import('../core/witness/chain.mjs');
    const recomputed = createHash('sha256').update(preimage(tampered.prev ?? '', bodyOf(tampered))).digest('hex');
    assert.notEqual(recomputed, tampered.hash, 'the claimed policy must be covered by the hash');
  } finally { cleanup(); }
});

test('verify says which policies the record was produced under', async () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, receipt(0));
    append(root, receipt(1));
    const v = verifyChain(root);
    // Said out loud, like `identity`. "The chain is intact" is a weaker sentence than anyone reads it
    // as if the reader cannot also see which rules produced the lines that are intact.
    assert.deepEqual(v.policyVersions, [POLICY_VERSION]);
  } finally { cleanup(); }
});

test('a chain that predates the field verifies clean, and says so honestly', async () => {
  // The half-versioned record. Adding a field must not invalidate a single existing line — every
  // receipt hashes over the body it actually has — and `verify` must not pretend the older lines
  // carry a policy they never claimed.
  const { root, cleanup } = makeRepo();
  try {
    append(root, receipt(0));
    const before = rows(root);
    assert.equal(before.length, 1);

    // A line written the old way: same body minus the new field, hashed as it would have been.
    const legacyBody = { ...bodyOf(before[0]) };
    delete legacyBody.policyVersion;
    const { createHash } = await import('node:crypto');
    const { preimage, canonicalJSON } = await import('../core/witness/chain.mjs');
    void canonicalJSON;
    const prev = before[0].hash;
    const hash = createHash('sha256').update(preimage(prev, legacyBody)).digest('hex');
    const { appendFileSync } = await import('node:fs');
    appendFileSync(chainPath(root), `${JSON.stringify({ ...legacyBody, prev, hash, sig: null })}\n`, 'utf8');

    const v = verifyChain(root);
    assert.equal(v.intact, true, 'a pre-policy-version receipt still hashes to what it claims');
    assert.deepEqual(v.policyVersions, [POLICY_VERSION, null],
      'and the record says plainly that one line names no policy rather than inventing one for it');
  } finally { cleanup(); }
});
