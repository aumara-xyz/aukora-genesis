// aukora · test/witness-peer.test.mjs — A SECOND MACHINE THAT REMEMBERS
//
// ══ WHY THIS COMES BEFORE THE CEREMONY, NOT AFTER ══
//
// Three reviews converged on this without conferring, and the argument is one line already in our own
// LIMITS: **signing is not the mechanism, retention is.**
//
// Every prefix of a valid chain is a valid chain. Truncate a chain at line 400 and lines 1-400 hash
// perfectly, link perfectly, and verify clean — because a hash chain proves that what SURVIVED was
// not edited, and says nothing whatsoever about what was removed. Signing does not change this: a
// signed prefix is still a valid prefix. Every signature on the surviving lines is genuine.
//
// The only thing that catches deletion is someone else remembering a head you can no longer produce.
// That works in the unsigned era, today, with no ceremony and no bound root — which is exactly why it
// belongs first.
//
// ══ PAIR FIRST, OR IT IS THEATRE ══
//
// Kimi's caveat is load-bearing and is the reason this file starts with pairing rather than pushing:
// unsigned retention that the same attacker can simply re-push proves nothing. If anyone may tell the
// witness "my head is X", then whoever truncated the chain says so too and the witness agrees.
//
// So a peer accepts a checkpoint only over a CHANNEL KEY established at pairing. That key is separate
// from the root and device keys on purpose — it is about "may this speaker write to your retention
// store", not "is this node bound". A node with no ceremony can still be witnessed.
//
// ══ WRITER, NOT JUST repoId ══
//
// `repoId` is `sha256(origin + root_commit)`, so two clones of the same repository share it exactly.
// Retention keyed on `repoId` alone therefore lets clone A's head be compared against clone B's — and
// B, legitimately behind, reads as having TRUNCATED a chain it never held. A false accusation is
// worse than a missed one here, because it is the accusation that gets acted on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  pairPeer, loadPeer, listPeers, retirePeer,
  buildCheckpointPush, acceptPush, witnessPush, openRetention, retainedCheckpoints, latestRetained,
  peerFreshness, PEER_STATES,
} from '../core/witness/peer.mjs';
import { prefixDigestOf, buildDelta } from '../core/witness/frontier.mjs';

// ══ PORTED FROM A HEAD TO A FRONTIER ══
//
// #122 pushed a single `head`. Measured afterwards on the live node: 8,533 receipts, 52 heads. So
// "the witness holds the head we hold" — this file's own words — was never true, and every test below
// that said `head` was testing a claim the chain could not support. They now push a FRONTIER; the
// properties each one was written for are unchanged.
const F = (repoId, writerEpoch, count, prefix, heads = ['h1']) => ({
  schema: 'aukora-frontier-v2', repoId, writerEpoch,
  receiptCount: count, prefixDigest: prefix,
  frontierDigest: [...heads].sort().join(','), frontierCount: heads.length,
  policyVersions: ['aukora-policy-v1'],
});

function sandbox() {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-peer-')));
  const saved = process.env.AUKORA_KEYS_DIR;
  process.env.AUKORA_KEYS_DIR = dir;
  return {
    dir,
    cleanup() {
      if (saved === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = saved;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const H = (n) => String(n).padStart(64, '0');
const CHAIN = (n) => Array.from({ length: n }, (_, i) => H(i));
const frontier = (count, prefix = prefixDigestOf(CHAIN(count)), heads = ['h1']) => F(REPO, WRITER, count, prefix, heads);

// Every push now carries a CONTINUITY PROOF, so the test helper builds one. `prior` is what the
// witness already holds: null for a first push, which proves itself from the genesis accumulator.
const mkPush = ({ peerId, frontier: to, seq, at, atMs = null, prior = null, chain = null }) => buildCheckpointPush({
  peerId, frontier: to, seq, at, atMs,
  delta: buildDelta({ from: prior, to, appended: (chain ?? CHAIN(to.receiptCount)).slice(prior ? prior.receiptCount : 0) }),
});
const REPO = 'repo-aaaa';
const WRITER = 'writer-1111';

/** A paired node and the witness that will hold its heads. */
function paired() {
  const me = pairPeer({ name: 'my-laptop' });
  const witness = pairPeer({ name: 'the-witness' });
  return { me, witness, store: openRetention() };
}

// ═════════════════════════════════════════════════════════════════════════════
// PAIRING
// ═════════════════════════════════════════════════════════════════════════════
test('pairing mints a channel key that is not the root and not the device key', () => {
  const S = sandbox();
  try {
    const p = pairPeer({ name: 'the-witness' });
    assert.ok(p.peerId && p.channelPub, 'a peer has an identity and a public channel key');
    assert.equal(p.channelPriv, undefined, 'the private half never leaves the store');
    // A node with no ceremony must still be able to pair — that is the whole point of doing this first.
    assert.deepEqual(listPeers().map((x) => x.peerId), [p.peerId]);
    assert.equal(loadPeer(p.peerId).channelPub, p.channelPub);
  } finally { S.cleanup(); }
});

test('two pairings are never the same channel', () => {
  const S = sandbox();
  try {
    assert.notEqual(pairPeer({ name: 'a' }).channelPub, pairPeer({ name: 'b' }).channelPub);
  } finally { S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PUSH — authenticated, or it is theatre
// ═════════════════════════════════════════════════════════════════════════════
test('a witness accepts a push signed by a paired channel, and only that', () => {
  const S = sandbox();
  try {
    const { me, store } = paired();
    const push = mkPush({ peerId: me.peerId, frontier: frontier(1), seq: 1, at: 'T1' });
    assert.equal(acceptPush(store, push).ok, true);
    assert.equal(latestRetained(store, REPO, WRITER).frontier.receiptCount, 1);
  } finally { S.cleanup(); }
});

test('THE CAVEAT — an UNPAIRED speaker cannot write to the retention store', () => {
  // The whole reason pairing comes first. If anyone may say "my head is X", the same attacker who
  // truncated the chain says so too, and the witness agrees with them.
  const S = sandbox();
  try {
    const { store } = paired();
    const forged = {
      schema: 'aukora-peer-push-v3', peerId: 'peer-nobody-paired', repoId: REPO,
      writerEpoch: WRITER, frontier: frontier(9), commitment: 'c'.repeat(64), seq: 1, at: 'T1', sig: 'x'.repeat(86),
    };
    const out = acceptPush(store, forged);
    assert.equal(out.ok, false);
    assert.match(out.reason, /unpaired|unknown peer/i);
    assert.equal(latestRetained(store, REPO, WRITER), null, 'nothing was retained');
  } finally { S.cleanup(); }
});

test('a push with a tampered head does not verify', () => {
  const S = sandbox();
  try {
    const { me, store } = paired();
    const push = mkPush({ peerId: me.peerId, frontier: frontier(1), seq: 1, at: 'T1' });
    const out = acceptPush(store, { ...push, seq: 99 });
    assert.equal(out.ok, false);
    assert.match(out.reason, /signature/i);
  } finally { S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// REPLAY, and the clone problem
// ═════════════════════════════════════════════════════════════════════════════
test('REPLAY — an old push cannot be re-sent to rewind what the witness remembers', () => {
  // Without this, an attacker who truncates simply replays yesterday's push and the witness's memory
  // walks backwards to a head that matches the shortened chain.
  const S = sandbox();
  try {
    const { me, store } = paired();
    const first = mkPush({ peerId: me.peerId, frontier: frontier(1), seq: 1, at: 'T1' });
    const second = mkPush({ peerId: me.peerId, frontier: frontier(2), seq: 2, at: 'T2', prior: frontier(1) });
    assert.equal(acceptPush(store, first).ok, true);
    assert.equal(acceptPush(store, second).ok, true);

    const replay = acceptPush(store, first);
    assert.equal(replay.ok, false);
    assert.match(replay.reason, /replay|seq/i);
    assert.equal(latestRetained(store, REPO, WRITER).frontier.receiptCount, 2, 'the witness does not walk backwards');
    assert.equal(latestRetained(store, REPO, WRITER).seq, 2);
  } finally { S.cleanup(); }
});

test('WRITER — two clones of one repository do not accuse each other', () => {
  // `repoId` is sha256(origin + root commit), so two clones share it exactly. Keyed on repoId alone,
  // clone B being legitimately behind reads as clone B having TRUNCATED. A false accusation is worse
  // than a missed one, because it is the one somebody acts on.
  const S = sandbox();
  try {
    const { me, store } = paired();
    const a = mkPush({ peerId: me.peerId, frontier: F(REPO, 'clone-A', 7, prefixDigestOf(CHAIN(7))), seq: 7, at: 'T7' });
    const b = mkPush({ peerId: me.peerId, frontier: F(REPO, 'clone-B', 2, prefixDigestOf(CHAIN(2))), seq: 2, at: 'T2' });
    assert.equal(acceptPush(store, a).ok, true);
    assert.equal(acceptPush(store, b).ok, true, 'a second clone at a lower head is not a replay');

    assert.equal(latestRetained(store, REPO, 'clone-A').frontier.receiptCount, 7);
    assert.equal(latestRetained(store, REPO, 'clone-B').frontier.receiptCount, 2);
  } finally { S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE VERDICT — silence is LOUD
// ═════════════════════════════════════════════════════════════════════════════
test('a witness that never heard of this repository is NAMED, not absent', () => {
  // The failure this whole lane exists to prevent is a verifier that reports nothing when a witness
  // says nothing. "No news" and "no witness" must never render the same.
  const S = sandbox();
  try {
    const { store } = paired();
    const f = peerFreshness(store, { frontier: frontier(1), nowMs: 1000, maxAgeMs: 60_000 });
    assert.equal(f.state, PEER_STATES.SILENT);
    assert.equal(f.ok, false);
    assert.match(f.reason, /never/i);
  } finally { S.cleanup(); }
});

test('a witness holding a head we can no longer produce is the TRUNCATION alarm', () => {
  const S = sandbox();
  try {
    const { me, store } = paired();
    acceptPush(store, mkPush({ peerId: me.peerId, frontier: frontier(5), seq: 5, at: 'T5' }));

    // Our chain now claims an EARLIER head than the witness retains: the shape of a truncation.
    const f = peerFreshness(store, { frontier: frontier(3), nowMs: 1000, maxAgeMs: 60_000 });
    assert.equal(f.state, PEER_STATES.BEHIND);
    assert.equal(f.ok, false);
    assert.match(f.reason, /removed|truncat|disagree/i);
  } finally { S.cleanup(); }
});

test('agreement is the only state that reads ok', () => {
  const S = sandbox();
  try {
    const { me, store } = paired();
    // Stored through `witnessPush`, which is now the only path that records WHEN the witness heard.
    witnessPush(store, mkPush({ peerId: me.peerId, frontier: frontier(5), seq: 5, at: 'T5' }), { receivedAt: 'T5', receivedAtMs: 500 });
    const f = peerFreshness(store, { frontier: frontier(5), nowMs: 1000, maxAgeMs: 60_000 });
    assert.equal(f.state, PEER_STATES.AGREED);
    assert.equal(f.ok, true);
  } finally { S.cleanup(); }
});

test('THE WITNESS CLOCK — a sender cannot hold its own checkpoint fresh', () => {
  // Freshness read the SENDER\'S `atMs` while the comment beside it said a sender is not a trustworthy
  // source of when someone else heard from it. So anyone who could sign a push could keep a stale
  // witness reading AGREED forever by stamping the message "now".
  const S = sandbox();
  try {
    const { me, store } = paired();
    // Heard long ago; the sender claims it is current.
    witnessPush(store, mkPush({ peerId: me.peerId, frontier: frontier(5), seq: 5, at: 'T5', atMs: 10 * 86_400_000 }), { receivedAt: 'T0', receivedAtMs: 0 });
    const f = peerFreshness(store, { frontier: frontier(5), nowMs: 5 * 86_400_000, maxAgeMs: 86_400_000 });
    assert.equal(f.state, PEER_STATES.STALE, 'the sender\'s clock must not establish the witness\'s freshness');
  } finally { S.cleanup(); }
});

test('a row retained with no witness timestamp cannot be called fresh', () => {
  // `acceptPush` stores without a witness identity or clock. That is allowed, and the consequence is
  // stated rather than defaulted: age that cannot be established is not age zero.
  const S = sandbox();
  try {
    const { me, store } = paired();
    acceptPush(store, mkPush({ peerId: me.peerId, frontier: frontier(5), seq: 5, at: 'T5' }));
    const f = peerFreshness(store, { frontier: frontier(5), nowMs: 1000, maxAgeMs: 60_000 });
    assert.equal(f.ok, false);
    assert.equal(f.state, PEER_STATES.STALE);
  } finally { S.cleanup(); }
});

test('a witness that has not been told anything lately is STALE, and stale is not agreement', () => {
  const S = sandbox();
  try {
    const { me, store } = paired();
    acceptPush(store, mkPush({ peerId: me.peerId, frontier: frontier(5), seq: 5, at: 'T5', atMs: 0 }));
    const f = peerFreshness(store, { frontier: frontier(5), nowMs: 10 * 86_400_000, maxAgeMs: 86_400_000 });
    assert.equal(f.state, PEER_STATES.STALE);
    assert.equal(f.ok, false, 'an old agreement is not a current one');
  } finally { S.cleanup(); }
});

test('OFFLINE is its own answer — unreachable is not agreement and not accusation', () => {
  // Said rather than discovered. A partition must not read as a truncation alarm (which would cry
  // wolf on every flight) and must not read as agreement (which would be the hole).
  const S = sandbox();
  try {
    const { store } = paired();
    const f = peerFreshness(store, { frontier: frontier(1), nowMs: 1000, maxAgeMs: 60_000, reachable: false });
    assert.equal(f.state, PEER_STATES.UNREACHABLE);
    assert.equal(f.ok, false);
    assert.equal(/truncat/i.test(f.reason), false, 'a partition must never read as an accusation');
  } finally { S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// PEER REPLACEMENT
// ═════════════════════════════════════════════════════════════════════════════
test('retiring a peer is recorded, and a retired channel stops being accepted', () => {
  // Peer replacement, said rather than discovered: the old channel must stop working the moment it is
  // retired, or "replacing" a compromised witness leaves the compromised one still able to speak.
  const S = sandbox();
  try {
    const { me, store } = paired();
    const push = mkPush({ peerId: me.peerId, frontier: frontier(1), seq: 1, at: 'T1' });
    assert.equal(acceptPush(store, push).ok, true);

    retirePeer(me.peerId, { at: 'T2', reason: 'replaced' });
    const later = mkPush({ peerId: me.peerId, frontier: frontier(2), seq: 2, at: 'T3' });
    const out = acceptPush(store, later);
    assert.equal(out.ok, false);
    assert.match(out.reason, /retired/i);

    // Retired, not forgotten: what it already witnessed is still held.
    assert.equal(latestRetained(store, REPO, WRITER).frontier.receiptCount, 1);
    assert.equal(loadPeer(me.peerId).retiredAt, 'T2');
  } finally { S.cleanup(); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE COMPOSED VERIFIER — three objects, one entry point
// ═════════════════════════════════════════════════════════════════════════════
test('COMPOSED · not asking a witness is reported as not asking, never as ok', async () => {
  // The failure this composition removes: a caller who ran chain integrity alone got a clean bill of
  // health over a chain with its last four hundred lines removed, because every prefix of a valid
  // chain is a valid chain. "I did not ask" and "nothing is wrong" must never render the same.
  const S = sandbox();
  try {
    const { verifyEverything } = await import('../core/witness/verify.mjs');
    const { makeRepo } = await import('./helpers/fixture.mjs');
    const { root, cleanup } = makeRepo();
    try {
      const v = verifyEverything(root, { peers: false });
      assert.equal(v.peerChecked, false);
      assert.equal(v.ok, false, 'an unconsulted witness is not a passing verdict');
      assert.match(v.reason, /retention was not consulted/i);
      assert.ok(v.chain, 'the integrity half is still reported');
    } finally { cleanup(); }
  } finally { S.cleanup(); }
});

test('COMPOSED · a silent witness makes the whole verdict fail, loudly', async () => {
  const S = sandbox();
  try {
    const { verifyEverything } = await import('../core/witness/verify.mjs');
    const { makeRepo } = await import('./helpers/fixture.mjs');
    const { root, cleanup } = makeRepo();
    try {
      const v = verifyEverything(root, { peers: true, nowMs: 1000 });
      assert.equal(v.peerChecked, true);
      assert.equal(v.ok, false);
      assert.equal(v.peer.state, PEER_STATES.SILENT);
    } finally { cleanup(); }
  } finally { S.cleanup(); }
});
