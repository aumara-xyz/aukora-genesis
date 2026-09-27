// aukora · test/witness-frontier.test.mjs — WITNESSING A CHAIN THAT FORKS
//
// ══ THE DEFECT, MEASURED ON THE OWNER'S LIVE NODE ══
//
// The chain intentionally permits forks — `chain.mjs` argues it, and the argument is right: two guard
// processes reading the same head and both appending costs a TOTAL ORDER, not integrity. Every
// receipt still hashes to what it claims.
//
// But `writeCheckpoint` signs `readHead()`, and the peer push I shipped in #122 carried a single
// `head`. Measured on the live node the day this was written:
//
//     8,533 receipts · 52 heads · 67 forks · intact: true
//
// So the witness holds ONE of fifty-two heads. **Delete an entire branch and the peer still agrees.**
// My own module's comments say "the witness holds the head we hold" — which was never true here, and
// building transport on top of it would have shipped false agreement at speed.
//
// ══ WHAT IS COMMITTED INSTEAD ══
//
// The FRONTIER: how many receipts, a digest over the ordered prefix, and a digest over the SORTED SET
// of every head. Growth is honest and must pass; a deleted branch, an altered prefix and a replaced
// history must each fail, by their own name.
//
// The HEAD-SET half is absorbed from `core/acp/checkpoint.ts` (`count`, `head`, `root` over ordered
// entry hashes, growth-tolerant) and `rootOf` still comes from there. The PREFIX half is deliberately a
// second definition: `rootOf` is a sha256 over a list and cannot be continued from its output, so a
// witness holding D(n) could not check a claim about D(n+1) without being handed every hash again.
//
// This paragraph said the prefix half was "absorbed rather than redefined" — true when written, false
// from #148 onward, and it survived the round that changed it because the correction went into
// `frontier.mjs` where the code was and not here, where the same claim was also standing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  frontierOf, compareFrontier, FRONTIER_STATES, prefixDigestOf, frontierDigestOf, deltaOf,
} from '../core/witness/frontier.mjs';
import {
  pairPeer, buildCheckpointPush, acceptPush, openRetention, retainedCheckpoints,
  peerFreshness, PEER_STATES, witnessPush, verifyWitnessAck, RETENTION_STATES,
} from '../core/witness/peer.mjs';
import { append, chainPath } from '../core/witness/chain.mjs';

function sandbox() {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-front-')));
  const saved = { keys: process.env.AUKORA_KEYS_DIR };
  process.env.AUKORA_KEYS_DIR = dir;
  return {
    dir,
    cleanup() {
      if (saved.keys === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = saved.keys;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A repository with a real chain, so the frontier is computed from real bytes. */
function repoWith(n) {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-chain-')));
  for (let i = 0; i < n; i += 1) {
    append(root, {
      ts: `T${i}`, tool: 'Write', path: `f${i}.txt`, resolved: `f${i}.txt`,
      verdict: 'refused', reasonClass: 'law:protected-path', rule: 'secrets/**', session: 's', agent: null,
    });
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const lines = (root) => readFileSync(chainPath(root), 'utf8').split('\n').filter(Boolean);
const rewrite = (root, ls) => writeFileSync(chainPath(root), `${ls.join('\n')}\n`, 'utf8');

// ═════════════════════════════════════════════════════════════════════════════
// THE FRONTIER
// ═════════════════════════════════════════════════════════════════════════════
test('a frontier commits the count, the prefix and the SET of heads', () => {
  const R = repoWith(5);
  try {
    const f = frontierOf(R.root);
    assert.equal(f.receiptCount, 5);
    assert.equal(typeof f.prefixDigest, 'string');
    assert.equal(typeof f.frontierDigest, 'string');
    assert.ok(f.frontierCount >= 1);
    assert.ok(Array.isArray(f.policyVersions));
    assert.equal(typeof f.schema, 'string');
  } finally { R.cleanup(); }
});

test('the frontier digest is over a SORTED SET — head order must not change it', () => {
  // A digest that depended on the order heads happen to appear in would report a rewrite every time
  // two processes raced, which is the honest case this chain deliberately permits.
  assert.equal(frontierDigestOf(['bb', 'aa']), frontierDigestOf(['aa', 'bb']));
  assert.notEqual(frontierDigestOf(['aa', 'bb']), frontierDigestOf(['aa']));
});

test('the prefix digest is order-SENSITIVE — a reordering is a rewrite', () => {
  assert.notEqual(prefixDigestOf(['aa', 'bb']), prefixDigestOf(['bb', 'aa']));
});

test('HONEST GROWTH passes — the chain is allowed to get longer', () => {
  const R = repoWith(3);
  try {
    const before = frontierOf(R.root);
    append(R.root, {
      ts: 'T9', tool: 'Write', path: 'new.txt', resolved: 'new.txt',
      verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null,
    });
    const v = compareFrontier(frontierOf(R.root), before);
    assert.equal(v.state, FRONTIER_STATES.EXTENDED);
    assert.equal(v.ok, true);
  } finally { R.cleanup(); }
});

test('IDENTICAL is agreement', () => {
  const R = repoWith(3);
  try {
    const f = frontierOf(R.root);
    const v = compareFrontier(f, f);
    assert.equal(v.state, FRONTIER_STATES.AGREED);
    assert.equal(v.ok, true);
  } finally { R.cleanup(); }
});

test('TRUNCATION is caught — the count went backwards', () => {
  const R = repoWith(6);
  try {
    const before = frontierOf(R.root);
    rewrite(R.root, lines(R.root).slice(0, 3));
    const v = compareFrontier(frontierOf(R.root), before);
    assert.equal(v.state, FRONTIER_STATES.TRUNCATED);
    assert.equal(v.ok, false);
  } finally { R.cleanup(); }
});

test('A REWRITTEN PREFIX is caught even when the length is preserved', () => {
  // The attack a length check alone misses entirely: swap a receipt, keep the count.
  const R = repoWith(6);
  try {
    const before = frontierOf(R.root);
    const ls = lines(R.root);
    const one = JSON.parse(ls[2]);
    ls[2] = JSON.stringify({ ...one, hash: 'f'.repeat(64) });
    rewrite(R.root, ls);
    const v = compareFrontier(frontierOf(R.root), before);
    assert.equal(v.state, FRONTIER_STATES.PREFIX_REWRITTEN);
    assert.equal(v.ok, false);
  } finally { R.cleanup(); }
});

test('THE ONE THE OLD CHECKPOINT MISSED — a deleted BRANCH, with the prefix intact', () => {
  // 52 heads on the live node. Committing one head means fifty-one branches can vanish and the
  // witness still agrees. This is the case the frontier exists for.
  const R = repoWith(4);
  try {
    // Two receipts sharing a predecessor: a real fork, which this chain permits.
    const ls = lines(R.root);
    const last = JSON.parse(ls[ls.length - 1]);
    const sibling = { ...last, ts: 'T-fork', path: 'fork.txt', hash: 'a'.repeat(64) };
    rewrite(R.root, [...ls, JSON.stringify(sibling)]);

    const withBranch = frontierOf(R.root);
    assert.ok(withBranch.frontierCount >= 2, 'precondition: the chain really has more than one head');

    // Delete the branch. Count drops, so this is caught — but the point is the FRONTIER changed.
    rewrite(R.root, ls);
    const v = compareFrontier(frontierOf(R.root), withBranch);
    assert.equal(v.ok, false);
    assert.ok([FRONTIER_STATES.TRUNCATED, FRONTIER_STATES.BRANCH_LOST].includes(v.state), `got ${v.state}`);
    assert.match(v.reason, /head|branch|truncat/i);
  } finally { R.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// RETENTION IS APPEND-ONLY, AND CONTINUITY IS CHECKED
// ═════════════════════════════════════════════════════════════════════════════
test('retention APPENDS — a later checkpoint never overwrites the one before it', () => {
  const S = sandbox();
  const R = repoWith(3);
  try {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const first = frontierOf(R.root);
    assert.equal(acceptPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: first, seq: 1, at: 'T1', delta: deltaOf(R.root, null) })).ok, true);

    append(R.root, { ts: 'T4', tool: 'Write', path: 'x', resolved: 'x', verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null });
    const second = frontierOf(R.root);
    assert.equal(acceptPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: second, seq: 2, at: 'T2', delta: deltaOf(R.root, first) })).ok, true);

    // BOTH are held. The old shape kept one row and overwrote it, so the earliest evidence — the one
    // an attacker most wants gone — was the first thing discarded.
    const held = retainedCheckpoints(store, first.repoId, first.writerEpoch);
    assert.equal(held.length, 2);
    assert.deepEqual(held.map((h) => h.frontier.receiptCount), [3, 4]);
  } finally { R.cleanup(); S.cleanup(); }
});

test('CONTINUITY — a checkpoint that does not EXTEND the retained one is refused', () => {
  // The hole Codex measured: acceptPush took any larger seq and never proved the new state extended
  // the old. So an attacker truncates, pushes with seq+1, and the witness adopts the shorter chain.
  const S = sandbox();
  const A = repoWith(5);
  const B = repoWith(2);
  try {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const good = frontierOf(A.root);
    assert.equal(acceptPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: good, seq: 1, at: 'T1', delta: deltaOf(A.root, null) })).ok, true);

    // A DIFFERENT, SHORTER history under the same identity, with a higher seq.
    const shorter = { ...frontierOf(B.root), repoId: good.repoId, writerEpoch: good.writerEpoch };
    const out = acceptPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: shorter, seq: 2, at: 'T2', delta: { ...deltaOf(B.root, null), toFrontier: shorter } }));
    assert.equal(out.ok, false);
    assert.match(out.reason, /extend|continuity|truncat/i);
    assert.equal(retainedCheckpoints(store, good.repoId, good.writerEpoch).length, 1);
  } finally { A.cleanup(); B.cleanup(); S.cleanup(); }
});

test('freshness compares the local chain against EVERY retained checkpoint', () => {
  const S = sandbox();
  const R = repoWith(4);
  try {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const f1 = frontierOf(R.root);
    witnessPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: f1, seq: 1, at: 'T1', delta: deltaOf(R.root, null) }), { receivedAtMs: 1 });
    append(R.root, { ts: 'T5', tool: 'Write', path: 'y', resolved: 'y', verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null });
    const f2 = frontierOf(R.root);
    witnessPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: f2, seq: 2, at: 'T2', delta: deltaOf(R.root, f1) }), { receivedAtMs: 2 });

    assert.equal(peerFreshness(store, { frontier: frontierOf(R.root), nowMs: 1000, maxAgeMs: 1e9 }).ok, true);

    // Truncate below the EARLIEST retained checkpoint: both must object, not just the latest.
    rewrite(R.root, lines(R.root).slice(0, 2));
    const bad = peerFreshness(store, { frontier: frontierOf(R.root), nowMs: 1000, maxAgeMs: 1e9 });
    assert.equal(bad.ok, false);
    assert.equal(bad.state, PEER_STATES.BEHIND);
    assert.ok(bad.disagreeing.length >= 2, 'every retained checkpoint that disagrees is named');
  } finally { R.cleanup(); S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE THREE SMALL ONES
// ═════════════════════════════════════════════════════════════════════════════
test('a CORRUPT retention store is loud, not empty', () => {
  // It mapped missing, unreadable and corrupt to the same empty store — so a torn write read as
  // "this witness has never heard of you", which is the answer an attacker would choose.
  const S = sandbox();
  try {
    assert.equal(openRetention().state, RETENTION_STATES.FRESH);
    writeFileSync(join(S.dir, 'retention.json'), '{ not json\n{ also not json\n', 'utf8');
    const store = openRetention();
    assert.equal(store.state, RETENTION_STATES.CORRUPT);
    assert.notEqual(store.state, RETENTION_STATES.FRESH);
  } finally { S.cleanup(); }
});

test('the sender clock is INSIDE the signature, so it cannot be moved', () => {
  // Codex set atMs to a far-future value without invalidating the signature, because it rode outside
  // the signed preimage while being used for freshness.
  const S = sandbox();
  const R = repoWith(2);
  try {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const push = buildCheckpointPush({ peerId: me.peerId, frontier: frontierOf(R.root), seq: 1, at: 'T1', atMs: 1000, delta: deltaOf(R.root, null) });
    assert.equal(acceptPush(openRetention(), push).ok, true);
    const moved = acceptPush(store, { ...push, atMs: 9_999_999_999_999 });
    assert.equal(moved.ok, false);
    assert.match(moved.reason, /signature/i);
  } finally { R.cleanup(); S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// "PEER ACKNOWLEDGES" IS AN OBJECT, NOT A RETURN VALUE
// ═════════════════════════════════════════════════════════════════════════════
test('the witness signs an acknowledgement, and it is checkable off the wire', () => {
  // `{ ok: true }` is a function return. It is not durable evidence that a remote machine ever held
  // anything, and the activation sequence's last gate cannot be a value that vanishes with the stack.
  const S = sandbox();
  const R = repoWith(3);
  try {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const store = openRetention();
    const push = buildCheckpointPush({ peerId: me.peerId, frontier: frontierOf(R.root), seq: 1, at: 'T1', atMs: 10, delta: deltaOf(R.root, null) });
    const out = witnessPush(store, push, { witnessPeerId: witness.peerId, receivedAt: 'T2', receivedAtMs: 20 });
    assert.equal(out.ok, true);

    const ack = out.ack;
    assert.ok(ack.signature, 'an acknowledgement without a signature is a rumour');
    assert.equal(ack.checkpointCommitment, push.commitment);
    assert.equal(ack.senderSeq, 1);
    assert.equal(ack.witnessSeq, 1);

    assert.equal(verifyWitnessAck(ack, push).ok, true);
    // The witness's OWN receivedAt is the load-bearing clock, and it is inside the signature.
    assert.equal(verifyWitnessAck({ ...ack, receivedAtMs: 999 }, push).ok, false);
    assert.equal(verifyWitnessAck({ ...ack, checkpointCommitment: 'x'.repeat(64) }, push).ok, false);

    // AND THE PUSH IS NOW PART OF THE QUESTION. Without it there is nothing to check the ack against,
    // so asking is refused rather than answered leniently.
    assert.equal(verifyWitnessAck(ack).ok, false, 'an ack alone cannot be verified — against what?');
  } finally { R.cleanup(); S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// ACCEPT AND ACKNOWLEDGE ARE ONE OPERATION
// ═════════════════════════════════════════════════════════════════════════════
test('THE SEAM IS GONE — a refused push yields no acknowledgement, and there is no other way to get one', () => {
  // Before this, `acceptPush` and `buildWitnessAck` were separate exports and nothing joined them: a
  // caller could sign an ack for a push that was REFUSED, or never stored. The ack is the artefact that
  // travels to another machine and gets believed, so the signed statement and the stored fact could
  // disagree — and only the signed one left the building.
  const S = sandbox();
  const A = repoWith(5);
  const B = repoWith(2);
  try {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const store = openRetention();
    const good = frontierOf(A.root);
    assert.equal(witnessPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: good, seq: 1, at: 'T1', delta: deltaOf(A.root, null) }), { witnessPeerId: witness.peerId, receivedAtMs: 1 }).ok, true);

    const shorter = { ...frontierOf(B.root), repoId: good.repoId, writerEpoch: good.writerEpoch };
    const out = witnessPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: shorter, seq: 2, at: 'T2', delta: { ...deltaOf(B.root, null), toFrontier: shorter } }), { witnessPeerId: witness.peerId, receivedAtMs: 2 });
    assert.equal(out.ok, false);
    assert.equal(out.ack, null, 'a refusal must not be signable');
    assert.equal(out.retained, null);

    // And the module exports no path from a push to a signature that bypasses the store.
    const src = readFileSync(new URL('../core/witness/peer.mjs', import.meta.url), 'utf8');
    assert.equal(/export function buildWitnessAck/.test(src), false, 'the standalone ack builder must not be exported');
  } finally { A.cleanup(); B.cleanup(); S.cleanup(); }
});

test('the acknowledgement is derived from the STORED record, not the message', () => {
  const S = sandbox();
  const R = repoWith(3);
  try {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const store = openRetention();
    const push = buildCheckpointPush({ peerId: me.peerId, frontier: frontierOf(R.root), seq: 1, at: 'T1', atMs: 10, delta: deltaOf(R.root, null) });
    const out = witnessPush(store, push, { witnessPeerId: witness.peerId, receivedAt: 'T2', receivedAtMs: 20 });

    const held = retainedCheckpoints(store, push.repoId, push.writerEpoch);
    assert.equal(out.ack.checkpointCommitment, held[held.length - 1].commitment);
    assert.equal(out.ack.senderSeq, held[held.length - 1].seq);
    assert.equal(held[held.length - 1].receivedAtMs, 20, 'the witness records when IT heard');
  } finally { R.cleanup(); S.cleanup(); }
});

test('RETENTION SURVIVES A CONCURRENT WRITER — appends do not overwrite each other', () => {
  // The old store rewrote one JSON blob from a CALLER-SUPPLIED SNAPSHOT, so two pushes arriving
  // together raced and the loser\'s rows vanished — oldest evidence first, which is the evidence an
  // attacker most wants gone.
  const S = sandbox();
  const R = repoWith(3);
  try {
    const me = pairPeer({ name: 'laptop' });
    const f1 = frontierOf(R.root);
    // Two witnesses opened the store at the same moment; each holds its own stale snapshot. The
    // continuity check must consult the DURABLE log, not the snapshot, or B refuses A\'s legitimate
    // successor for a reason that is about B\'s memory rather than about the chain.
    const storeA = openRetention();
    const storeB = openRetention();
    assert.equal(witnessPush(storeA, buildCheckpointPush({ peerId: me.peerId, frontier: f1, seq: 1, at: 'T1', delta: deltaOf(R.root, null) }), { receivedAtMs: 1 }).ok, true);

    append(R.root, { ts: 'T4', tool: 'Write', path: 'z', resolved: 'z', verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null });
    const f2 = frontierOf(R.root);
    assert.equal(witnessPush(storeB, buildCheckpointPush({ peerId: me.peerId, frontier: f2, seq: 2, at: 'T2', delta: deltaOf(R.root, f1) }), { receivedAtMs: 2 }).ok, true);

    // Re-read from disk: BOTH rows are there. Under the rewrite-a-blob shape, B\'s snapshot had no
    // knowledge of A\'s row and erased it.
    const reread = retainedCheckpoints(openRetention(), f1.repoId, f1.writerEpoch);
    assert.deepEqual(reread.map((h) => h.seq), [1, 2]);
  } finally { R.cleanup(); S.cleanup(); }
});
