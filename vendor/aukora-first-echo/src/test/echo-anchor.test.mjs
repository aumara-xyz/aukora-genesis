// aukora · test/echo-anchor.test.mjs — HOW A WITNESS JOINS A CHAIN THAT ALREADY EXISTS
//
// ══ THE FIELD BLOCKER, MEASURED ══
//
// `verifyDelta` requires a first push to replay from `GENESIS_ACC`, so a witness meeting an existing
// chain is handed every receipt hash it ever wrote. On the owner's real node the day this was written:
//
//     11,993 receipts · 69 heads · first push = 803,982 bytes (785 KB)
//
// Nobody relays 785 KB by hand, and the whole point of this courier is that a human carries the file.
// So First Echo could run between two fresh test machines and could not run against the actual record
// it exists to witness. The comment on `deltaOf` said the cost was "bounded by pushing often, not by
// trusting more" — true from the second push onward, and the FIRST push has nothing to be bounded by.
//
// ══ WHAT AN ANCHOR IS, AND WHAT IT IS NOT ══
//
// A witness that joins at count N cannot verify receipts 1..N. It was not there. No protocol makes it
// there — the honest options are to hand it the whole history or to have it say plainly that it starts
// from here. An ANCHOR is the second: the witness records the frontier it was told, marks the row as
// anchored, and attests only from that point forward.
//
// The cost is stated rather than hidden: an anchored checkpoint CANNOT detect a rewrite below itself.
// That is not a weakness introduced here — it is the permanent situation of any witness that arrived
// late, and the marking is what stops it being read as something stronger later.
//
// Every push after the anchor is verified in full, against the anchored frontier. You may anchor once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { prefixDigestOf, buildDelta, verifyDelta, DELTA_STATES } from '../core/witness/frontier.mjs';

const H = (n) => String(n).padStart(64, '0');
const CHAIN = (n) => Array.from({ length: n }, (_, i) => H(i));

const F = (count, over = {}) => ({
  schema: 'aukora-frontier-v2', repoId: 'r', writerEpoch: 'w',
  receiptCount: count, prefixDigest: prefixDigestOf(CHAIN(count)),
  frontierDigest: 'h1', frontierCount: 1, policyVersions: [], ...over,
});

const rec = (i) => ({
  ts: `T${i}`, tool: 'Write', path: `f${i}`, resolved: `f${i}`,
  verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null,
});

async function node(fn) {
  const keys = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-anc-k-')));
  const chainHome = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-anc-c-')));
  const repo = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-anc-r-')));
  const savedK = process.env.AUKORA_KEYS_DIR;
  const savedC = process.env.AUKORA_CHAIN_HOME;
  process.env.AUKORA_KEYS_DIR = keys;
  process.env.AUKORA_CHAIN_HOME = chainHome;
  try {
    mkdirSync(join(repo, '.aukora'), { recursive: true });
    writeFileSync(join(repo, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');
    const grow = async (n) => {
      const { append } = await import('../core/witness/chain.mjs');
      for (let i = 0; i < n; i += 1) append(repo, rec(`${i}-${Math.random().toString(36).slice(2, 8)}`));
    };
    return await fn({ keys, repo, grow });
  } finally {
    if (savedK === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = savedK;
    if (savedC === undefined) delete process.env.AUKORA_CHAIN_HOME; else process.env.AUKORA_CHAIN_HOME = savedC;
    for (const d of [keys, chainHome, repo]) rmSync(d, { recursive: true, force: true });
  }
}

test('an ANCHOR carries no history and is accepted only at first contact', () => {
  const to = F(11_993);
  const anchor = buildDelta({ from: null, to, appended: [], anchor: true });
  assert.equal(anchor.appended.length, 0, 'an anchor is constant-size whatever the chain weighs');
  assert.ok(JSON.stringify(anchor).length < 2_000, 'and small enough for a human to carry');

  const v = verifyDelta(null, anchor);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.state, DELTA_STATES.ANCHORED);
});

test('an anchor is REFUSED once anything is already retained — you may anchor once', () => {
  // Otherwise it is a reset: claim any frontier you like and call it a new beginning.
  const retained = F(10);
  const v = verifyDelta(retained, buildDelta({ from: null, to: F(500), appended: [], anchor: true }));
  assert.equal(v.ok, false);
  assert.notEqual(v.state, DELTA_STATES.ANCHORED);
});

test('an UNFLAGGED empty first delta is still refused — anchoring must be declared', () => {
  // The flag is the point. Without it, "I sent no history" and "there is no history" are the same
  // bytes, and the second is a claim the witness can check while the first is one it cannot.
  const v = verifyDelta(null, buildDelta({ from: null, to: F(400), appended: [] }));
  assert.equal(v.ok, false, 'a silent empty delta must not be adopted as an anchor');
});

test('after anchoring, the next push is verified IN FULL against the anchored frontier', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer, openRetention, witnessPush, buildCheckpointPush, latestRetained } = await import('../core/witness/peer.mjs');
    const { frontierOf, deltaOf } = await import('../core/witness/frontier.mjs');

    await grow(30);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });

    const anchored = frontierOf(repo);
    const first = witnessPush(openRetention(), buildCheckpointPush({
      peerId: me.peerId, frontier: anchored, seq: 1, at: 'T',
      delta: buildDelta({ from: null, to: anchored, appended: [], anchor: true }),
    }), { witnessPeerId: w.peerId, receivedAt: 'T', receivedAtMs: 1 });
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.retained.anchored, true, 'the row says it was anchored, not verified from genesis');

    await grow(4);
    const store = openRetention();
    const prior = latestRetained(store, anchored.repoId, anchored.writerEpoch);
    const second = witnessPush(store, buildCheckpointPush({
      peerId: me.peerId, frontier: frontierOf(repo), seq: 2, at: 'T2',
      delta: deltaOf(repo, prior.frontier),
    }), { witnessPeerId: w.peerId, receivedAt: 'T2', receivedAtMs: 2 });
    assert.equal(second.ok, true, second.reason);
    assert.equal(second.retained.anchored, false, 'and everything after it is fully replayed');
    assert.equal(second.state, 'delta:extended');
  });
});

test('a push after an anchor that does NOT extend it is refused', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer, openRetention, witnessPush, buildCheckpointPush } = await import('../core/witness/peer.mjs');
    const { frontierOf } = await import('../core/witness/frontier.mjs');
    await grow(20);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });
    const anchored = frontierOf(repo);
    assert.equal(witnessPush(openRetention(), buildCheckpointPush({
      peerId: me.peerId, frontier: anchored, seq: 1, at: 'T',
      delta: buildDelta({ from: null, to: anchored, appended: [], anchor: true }),
    }), { witnessPeerId: w.peerId, receivedAt: 'T', receivedAtMs: 1 }).ok, true);

    // A different history under the same identity, longer, with a higher seq.
    const forged = { ...anchored, receiptCount: 25, prefixDigest: prefixDigestOf(CHAIN(25)) };
    const out = witnessPush(openRetention(), buildCheckpointPush({
      peerId: me.peerId, frontier: forged, seq: 2, at: 'T2',
      delta: buildDelta({ from: anchored, to: forged, appended: CHAIN(25).slice(20) }),
    }), { witnessPeerId: w.peerId, receivedAt: 'T2', receivedAtMs: 2 });
    assert.equal(out.ok, false, 'an anchor binds everything after it, even though it proves nothing before it');
  });
});

test('THE COST IS ON THE RECORD — an anchored row says what it cannot prove', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer, openRetention, witnessPush, buildCheckpointPush, retainedCheckpoints } = await import('../core/witness/peer.mjs');
    const { frontierOf } = await import('../core/witness/frontier.mjs');
    await grow(12);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });
    const anchored = frontierOf(repo);
    witnessPush(openRetention(), buildCheckpointPush({
      peerId: me.peerId, frontier: anchored, seq: 1, at: 'T',
      delta: buildDelta({ from: null, to: anchored, appended: [], anchor: true }),
    }), { witnessPeerId: w.peerId, receivedAt: 'T', receivedAtMs: 1 });

    const rows = retainedCheckpoints(openRetention(), anchored.repoId, anchored.writerEpoch);
    assert.equal(rows[0].anchored, true);
    // A later reader must be able to tell this apart from a checkpoint replayed from genesis, or the
    // marking is decoration — the same defect as `forWitness`.
    assert.equal(rows[0].transition, DELTA_STATES.ANCHORED);
  });
});

test('the courier summary MARKS an anchored accept — not just seq and count', async () => {
  // `core/echo/courier.mjs`'s `accept()` re-summarizes `witnessPush`'s retained row as
  // `{ seq, receiptCount }`, dropping the `anchored` flag `peer.mjs` itself takes care to set. So
  // `bin/echo.mjs`'s `accept` verb — the human-facing surface for the witness side of this exact
  // protocol — could never print the caveat its own `emit --anchor` help text already promises
  // ("the witness starts HERE and proves nothing before it"). The summary must carry the flag, not
  // just the numbers, or a later reader cannot tell this apart from a checkpoint verified from genesis.
  await node(async ({ repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit, accept } = await import('../core/echo/courier.mjs');
    await grow(15);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });

    const push = emit(repo, { asPeerId: me.peerId, anchor: true, at: 'T', atMs: 1 });
    assert.equal(push.ok, true, push.reason);
    const r = accept(push.doc, { asWitness: w.peerId, receivedAt: 'T', receivedAtMs: 1 });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.retained.seq, 1);
    assert.equal(r.retained.receiptCount, 15);
    assert.equal(r.retained.anchored, true,
      'the courier summary must say this witness cannot see below this point, not just its seq/count');
  });
});

test('and marks a genesis-replayed first push as NOT anchored — the two must not read alike', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit, accept } = await import('../core/echo/courier.mjs');
    await grow(9);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });

    // No `anchor: true` — first contact, and the whole chain is replayed and verified from genesis.
    const push = emit(repo, { asPeerId: me.peerId, at: 'T', atMs: 1 });
    assert.equal(push.ok, true, push.reason);
    const r = accept(push.doc, { asWitness: w.peerId, receivedAt: 'T', receivedAtMs: 1 });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.retained.anchored, false,
      'a witness that verified every hash from genesis must not read the same as one that merely adopted a frontier');
  });
});

test('the emit path can produce an anchor, and it is small', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit } = await import('../core/echo/courier.mjs');
    await grow(60);
    const me = pairPeer({ name: 'laptop' });
    const e = emit(repo, { asPeerId: me.peerId, anchor: true, at: 'T', atMs: 1 });
    assert.equal(e.ok, true, e.reason);
    assert.equal(e.doc.push.delta.anchor, true);
    assert.equal(e.doc.push.delta.appended.length, 0);
    assert.ok(JSON.stringify(e.doc).length < 3_000, 'a human has to be able to paste this');
  });
});
