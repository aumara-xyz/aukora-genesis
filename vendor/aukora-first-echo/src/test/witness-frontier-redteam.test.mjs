// aukora · test/witness-frontier-redteam.test.mjs — ATTACKING MY OWN MODULE
//
// Two rounds running, an outside reviewer found a hole here that my own tests had pinned as an EXAMPLE
// rather than an invariant. So this file is the attempt to be that reviewer first. Every case below was
// written as an attack and run before it was written as an assertion; the ones that landed are marked.
//
// The attacks: rewrite-and-pad · concurrent pushes · torn writes · a signed ack for a rejected push ·
// a replayed old ack · a future sender timestamp · a forged bucket key · degenerate shapes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  prefixDigestOf, buildDelta, verifyDelta, DELTA_STATES, accumulate, GENESIS_ACC,
} from '../core/witness/frontier.mjs';
import {
  pairPeer, openRetention, witnessPush, buildCheckpointPush, verifyWitnessAck,
  retainedCheckpoints, peerFreshness, PEER_STATES,
} from '../core/witness/peer.mjs';

const H = (n) => String(n).padStart(64, '0');
const CHAIN = (n) => Array.from({ length: n }, (_, i) => H(i));
const REPO = 'repo-red';
const WRITER = 'writer-red';

const F = (count, prefix = prefixDigestOf(CHAIN(count)), heads = ['h1'], over = {}) => ({
  schema: 'aukora-frontier-v2', repoId: REPO, writerEpoch: WRITER,
  receiptCount: count, prefixDigest: prefix,
  frontierDigest: [...heads].sort().join(','), frontierCount: heads.length,
  policyVersions: ['aukora-policy-v1'], ...over,
});

function sandbox(fn) {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-red-')));
  const saved = process.env.AUKORA_KEYS_DIR;
  process.env.AUKORA_KEYS_DIR = dir;
  try { return fn(dir); } finally {
    if (saved === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

const push = ({ peerId, to, prior = null, chain = null, seq, at = 'T', atMs = null }) => buildCheckpointPush({
  peerId, frontier: to, seq, at, atMs,
  delta: buildDelta({ from: prior, to, appended: (chain ?? CHAIN(to.receiptCount)).slice(prior ? prior.receiptCount : 0) }),
});

// ─────────────────────────────────────────────────────────────────────────────
// REWRITE AND PAD — make the arithmetic work out
// ─────────────────────────────────────────────────────────────────────────────

test('ATTACK — rewrite the prefix, then pad the append list so the COUNT still reconciles', () => {
  // The count check alone is satisfiable: hand over as many hashes as the arithmetic wants. The replay
  // is what refuses, because reaching a chosen digest by choosing the inputs is a preimage attack.
  const retained = F(10);
  const forged = [...CHAIN(9), 'TAMPERED'];
  const to = F(15, prefixDigestOf([...forged, ...CHAIN(15).slice(10)]));
  const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: CHAIN(15).slice(10) }));
  assert.equal(v.ok, false);
  assert.equal(v.state, DELTA_STATES.PREFIX_REWRITTEN);
});

test('ATTACK — pad with the RIGHT number of hashes but the wrong ones', () => {
  const retained = F(10);
  const to = F(13, prefixDigestOf(CHAIN(13)));
  const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: ['x', 'y', 'z'] }));
  assert.equal(v.ok, false);
  assert.equal(v.state, DELTA_STATES.PREFIX_REWRITTEN);
});

test('ATTACK — an append list with duplicates, to fold twice through the same hash', () => {
  const retained = F(3);
  const dup = [H(3), H(3)];
  const to = F(5, prefixDigestOf([...CHAIN(3), H(3), H(4)]));
  const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: dup }));
  assert.equal(v.ok, false, 'folding the same hash twice must not reach a frontier built from two different ones');
});

test('the accumulator is not length-extendable — appending is not the same as claiming', () => {
  // D_i = H(domain || D_{i-1} || h). An attacker holding D(n) can compute D(n+1) for a hash they
  // choose — that is by design, it is what the witness does. What they cannot do is make the writer's
  // NEXT real receipt land on it, because they do not choose that hash.
  const d10 = prefixDigestOf(CHAIN(10));
  assert.notEqual(accumulate(d10, H(10)), accumulate(d10, H(11)));
  assert.notEqual(accumulate(GENESIS_ACC, H(0)), GENESIS_ACC);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEGENERATE SHAPES
// ─────────────────────────────────────────────────────────────────────────────

test('ATTACK — a negative, NaN or absurd receiptCount', () => {
  const retained = F(5);
  for (const bad of [-1, Number.NaN, Number.MAX_SAFE_INTEGER, 1e308]) {
    const to = F(5, prefixDigestOf(CHAIN(5)), ['h1'], { receiptCount: bad });
    const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: [] }));
    assert.equal(v.ok, false, `receiptCount ${bad} must not verify`);
  }
});

test('ATTACK — a delta claiming a different repository than the one it continues from', () => {
  const retained = F(5);
  const to = F(6, prefixDigestOf(CHAIN(6)), ['h1'], { repoId: 'somebody-elses-repo' });
  const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: [H(5)] }));
  assert.equal(v.ok, false);
  assert.equal(v.state, DELTA_STATES.FOREIGN);
});

test('ATTACK — __proto__ smuggled through a frontier', () => {
  const retained = F(3);
  const hostile = JSON.parse('{"schema":"aukora-frontier-v2","repoId":"repo-red","writerEpoch":"writer-red","receiptCount":4,"prefixDigest":"x","frontierDigest":"h1","frontierCount":1,"policyVersions":[],"__proto__":{"polluted":true}}');
  const v = verifyDelta(retained, buildDelta({ from: retained, to: hostile, appended: [H(3)] }));
  assert.equal(v.ok, false);
  assert.equal(({}).polluted, undefined, 'nothing reached Object.prototype');
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ACK — the artefact that leaves the building
// ─────────────────────────────────────────────────────────────────────────────

test('ATTACK — obtain a signed ack for a push the witness REFUSED', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'w' });
    const store = openRetention();
    assert.equal(witnessPush(store, push({ peerId: me.peerId, to: F(5), seq: 1 }), { witnessPeerId: witness.peerId, receivedAtMs: 1 }).ok, true);

    // A shorter history under the same identity, with a higher seq.
    const out = witnessPush(store, push({ peerId: me.peerId, to: F(2), seq: 2 }), { witnessPeerId: witness.peerId, receivedAtMs: 2 });
    assert.equal(out.ok, false);
    assert.equal(out.ack, null, 'a refusal must not be signable');
    assert.equal(retainedCheckpoints(openRetention(), REPO, WRITER).length, 1, 'and must not be stored');
  });
});

test('ATTACK — replay an old, genuinely-signed ack to imply current agreement', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'w' });
    const store = openRetention();
    const firstPush = push({ peerId: me.peerId, to: F(3), seq: 1 });
    const laterPush = push({ peerId: me.peerId, to: F(6), prior: F(3), seq: 2 });
    const first = witnessPush(store, firstPush, { witnessPeerId: witness.peerId, receivedAt: 'T1', receivedAtMs: 1_000 });
    const later = witnessPush(store, laterPush, { witnessPeerId: witness.peerId, receivedAt: 'T2', receivedAtMs: 2_000 });

    // The old ack still verifies — and MUST, because it is a true statement about the past.
    // Correlated against the push it actually answers — which is the only way this question has a
    // meaning. Verified alone it would only say "a witness signed something ack-shaped".
    assert.equal(verifyWitnessAck(first.ack, firstPush).ok, true);

    // And it does NOT answer the later one, which is what makes a replay useless rather than merely
    // detectable-in-principle.
    assert.equal(verifyWitnessAck(first.ack, laterPush).ok, false);

    // What stops a replay being useful is that it names WHAT it covers. A consumer comparing the
    // commitment against the frontier it holds now finds a different one, and the witnessSeq is behind.
    assert.notEqual(first.ack.checkpointCommitment, later.ack.checkpointCommitment);
    assert.ok(first.ack.witnessSeq < later.ack.witnessSeq);
    assert.ok(first.ack.receivedAtMs < later.ack.receivedAtMs);

    // Every field a consumer would compare is inside the signature.
    for (const field of ['checkpointCommitment', 'witnessSeq', 'senderSeq', 'receivedAtMs', 'pairId']) {
      const tampered = { ...first.ack, [field]: field.endsWith('Ms') || field.endsWith('Seq') ? 99_999 : 'x'.repeat(16) };
      assert.equal(verifyWitnessAck(tampered, firstPush).ok, false, `${field} must be covered by the signature`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLOCKS
// ─────────────────────────────────────────────────────────────────────────────

test('ATTACK — a sender timestamp far in the future, to hold a stale witness fresh', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    // Heard long ago; the sender claims it is the year 3000.
    witnessPush(store, push({ peerId: me.peerId, to: F(5), seq: 1, atMs: 32_503_680_000_000 }), { receivedAtMs: 0 });
    const f = peerFreshness(store, { frontier: F(5), nowMs: 5 * 86_400_000, maxAgeMs: 86_400_000 });
    assert.equal(f.state, PEER_STATES.STALE, 'the sender does not get to say when someone else heard from it');
  });
});

test('ATTACK — move the sender clock without re-signing', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const p = push({ peerId: me.peerId, to: F(3), seq: 1, atMs: 1_000 });
    const moved = witnessPush(store, { ...p, atMs: 9_999_999_999_999 }, { receivedAtMs: 1 });
    assert.equal(moved.ok, false);
    assert.match(moved.reason, /signature/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE STORE
// ─────────────────────────────────────────────────────────────────────────────

test('ATTACK — a torn final line in the retention log', () => {
  sandbox((dir) => {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    witnessPush(store, push({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 1 });
    // A power loss mid-append.
    appendFileSync(join(dir, 'retention.json'), '{"seq":2,"repoId":"repo-red","writ', 'utf8');

    const reread = openRetention();
    assert.notEqual(reread.state, 'retention:corrupt', 'a torn TAIL truncates the log, it does not destroy it');
    assert.equal(retainedCheckpoints(reread, REPO, WRITER).length, 1, 'and the intact prefix survives');
    assert.ok(reread.torn, 'and the tear is reported rather than silently swallowed');
  });
});

test('ATTACK — edit a line in the MIDDLE of the retention log', () => {
  sandbox((dir) => {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    witnessPush(store, push({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 1 });
    witnessPush(store, push({ peerId: me.peerId, to: F(6), prior: F(3), seq: 2 }), { receivedAtMs: 2 });

    const p = join(dir, 'retention.json');
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    writeFileSync(p, `${'{ not json'}\n${lines[1]}\n`, 'utf8');

    const reread = openRetention();
    assert.equal(reread.state, 'retention:corrupt', 'a bad line in the middle means edited, not torn');
    // And a corrupt store must not then answer questions from an empty object.
    const f = peerFreshness(reread, { frontier: F(6), nowMs: 3, maxAgeMs: 1e9 });
    assert.equal(f.ok, false);
    assert.equal(f.state, PEER_STATES.UNREACHABLE);
  });
});

test('ATTACK — a corrupt store must refuse to ACCEPT, not accept from amnesia', () => {
  sandbox((dir) => {
    const me = pairPeer({ name: 'laptop' });
    writeFileSync(join(dir, 'retention.json'), '{ not json\n{ also not\n', 'utf8');
    const out = witnessPush(openRetention(), push({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 1 });
    assert.equal(out.ok, false, 'a witness that cannot read its own memory cannot honestly agree');
    assert.equal(out.ack, null);
  });
});

test('ATTACK — two concurrent witnesses, each holding a stale snapshot', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const a = openRetention();
    const b = openRetention();
    assert.equal(witnessPush(a, push({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 1 }).ok, true);
    // B's snapshot predates A's append. The continuity check must consult the DURABLE log.
    assert.equal(witnessPush(b, push({ peerId: me.peerId, to: F(6), prior: F(3), seq: 2 }), { receivedAtMs: 2 }).ok, true);
    assert.deepEqual(retainedCheckpoints(openRetention(), REPO, WRITER).map((h) => h.seq), [1, 2]);
  });
});

test('ATTACK — a stale snapshot must not let a REPLAY through either', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const stale = openRetention();
    assert.equal(witnessPush(openRetention(), push({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 1 }).ok, true);
    // `stale` still believes it holds nothing, so a naive implementation accepts seq 1 twice.
    const again = witnessPush(stale, push({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 2 });
    assert.equal(again.ok, false, 'the durable log is authoritative for replay, not the caller snapshot');
    assert.match(again.reason, /replay|seq|continuity/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BUCKET KEY
// ─────────────────────────────────────────────────────────────────────────────

test('ATTACK — forge an identity that collides with another pair\'s retention bucket', () => {
  // THIS ONE LANDED. Rows were grouped by `${repoId}|${writerEpoch}`, and a delimiter that can appear
  // inside its own operands is not a delimiter:
  //
  //     ('a|b', 'c')  →  "a|b|c"        two distinct pairs,
  //     ('a',   'b|c')  →  "a|b|c"      one bucket
  //
  // Both fields arrive over the wire in a signed push, so a paired peer picks them. The WRITE path
  // survived by accident — `verifyDelta` compares the two fields and refused — but the READ path
  // returned the victim's rows, and `verifyEverything` then re-derives this chain's prefix against a
  // foreign frontier and reports a rewrite. A crafted identity raising a truncation alarm on a healthy
  // chain is the false accusation this whole subsystem is built to avoid making.
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const victim = F(9, prefixDigestOf(CHAIN(9)), ['h1'], { repoId: 'a|b', writerEpoch: 'c' });
    assert.equal(witnessPush(store, push({ peerId: me.peerId, to: victim, seq: 1 }), { receivedAtMs: 1 }).ok, true);

    const reread = openRetention();
    assert.equal(retainedCheckpoints(reread, 'a|b', 'c').length, 1, 'the victim holds its own row');
    assert.deepEqual(
      retainedCheckpoints(reread, 'a', 'b|c'), [],
      'and a different pair that string-concatenates to the same key holds NOTHING',
    );
  });
});

test('THE INVARIANT — no two distinct (repo, writer) pairs share a bucket', () => {
  // The general form. The specific collision above is one instance; this is the property.
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const pairs = [
      ['a|b', 'c'], ['a', 'b|c'], ['a|b|c', ''], ['', 'a|b|c'],
      ['a"b', 'c'], ['a', 'b"c'], ['a\\', 'b'], ['a', '\\b'],
      ['x', 'y'], ['xy', ''],
    ];
    const store = openRetention();
    pairs.forEach(([repoId, writerEpoch], i) => {
      const to = F(i + 2, prefixDigestOf(CHAIN(i + 2)), ['h1'], { repoId, writerEpoch });
      witnessPush(store, push({ peerId: me.peerId, to, seq: 1 }), { receivedAtMs: i + 1 });
    });
    const reread = openRetention();
    for (const [repoId, writerEpoch] of pairs) {
      const rows = retainedCheckpoints(reread, repoId, writerEpoch);
      for (const r of rows) {
        assert.equal(r.frontier.repoId, repoId, `bucket (${repoId}, ${writerEpoch}) holds a foreign repoId`);
        assert.equal(r.frontier.writerEpoch, writerEpoch, `bucket (${repoId}, ${writerEpoch}) holds a foreign writerEpoch`);
      }
    }
  });
});
