// aukora · test/witness-ack-correlation.test.mjs — THE TWO BLOCKERS BEFORE ANY TRANSPORT
//
// An acknowledgement is the artefact that CROSSES A MACHINE BOUNDARY and gets believed on the other
// side. Two things were wrong with it, and both only matter once something actually carries it.
//
//   1 · signAckFromRetained derived the ack from the RETAINED record — which means the append had
//       already happened — and its `catch` returned `{ ...body, signature: null }`. So a witness that
//       could not read its own signing channel APPENDED SUCCESSFULLY and answered with an unsigned
//       acknowledgement. Storage said yes; the artefact proving it said nothing.
//
//   2 · verifyWitnessAck took ONE argument. It could prove a witness signed an ack-SHAPED object. It
//       could not prove the ack answers THIS push, because the push was never passed in. Every field
//       that would correlate the two was inside the signature and unchecked against anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  pairPeer, openRetention, witnessPush, buildCheckpointPush, verifyWitnessAck,
  retainedCheckpoints,
} from '../core/witness/peer.mjs';
import { prefixDigestOf, buildDelta } from '../core/witness/frontier.mjs';
import { keysDir } from '../core/witness/aumlok.mjs';

const peersDir = () => join(keysDir(), 'peers');

const H = (n) => String(n).padStart(64, '0');
const CHAIN = (n) => Array.from({ length: n }, (_, i) => H(i));
const REPO = 'repo-ack';
const WRITER = 'writer-ack';

const F = (count, over = {}) => ({
  schema: 'aukora-frontier-v2', repoId: REPO, writerEpoch: WRITER,
  receiptCount: count, prefixDigest: prefixDigestOf(CHAIN(count)),
  frontierDigest: 'h1', frontierCount: 1, policyVersions: ['aukora-policy-v1'], ...over,
});

const mkPush = ({ peerId, to, prior = null, seq, at = 'T', atMs = null }) => buildCheckpointPush({
  peerId, frontier: to, seq, at, atMs,
  delta: buildDelta({ from: prior, to, appended: CHAIN(to.receiptCount).slice(prior ? prior.receiptCount : 0) }),
});

function sandbox(fn) {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-ack-')));
  const saved = process.env.AUKORA_KEYS_DIR;
  process.env.AUKORA_KEYS_DIR = dir;
  try { return fn(dir); } finally {
    if (saved === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 · A NODE THAT CANNOT SIGN RETAINS NOTHING FOR THAT OPERATION
// ═════════════════════════════════════════════════════════════════════════════

test('a witness that cannot read its signing channel MUST NOT append', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });

    // The signing key is gone — a permission change, a half-restored backup, a wiped keyring.
    unlinkSync(join(peersDir(), `${witness.peerId}.channel`));

    const out = witnessPush(openRetention(), mkPush({ peerId: me.peerId, to: F(4), seq: 1 }), {
      witnessPeerId: witness.peerId, receivedAt: 'T', receivedAtMs: 1,
    });

    assert.equal(out.ok, false, 'a witness that cannot acknowledge must not accept');
    assert.equal(out.ack, null, 'and must not answer with an unsigned acknowledgement');
    assert.match(out.reason, /sign/i);

    // THE POINT: the append is what used to happen anyway. The witness would hold the checkpoint and
    // have handed back nothing that proves it — the storage and the evidence disagreeing, with only
    // the evidence travelling.
    assert.equal(
      retainedCheckpoints(openRetention(), REPO, WRITER).length, 0,
      'nothing may be retained for an operation whose acknowledgement could not be produced',
    );
  });
});

test('and an ack is NEVER returned unsigned', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const out = witnessPush(openRetention(), mkPush({ peerId: me.peerId, to: F(3), seq: 1 }), {
      witnessPeerId: witness.peerId, receivedAt: 'T', receivedAtMs: 1,
    });
    assert.equal(out.ok, true);
    assert.equal(typeof out.ack.signature, 'string');
    assert.ok(out.ack.signature.length > 0, 'an acknowledgement without a signature is a rumour');
  });
});

test('a store-only push still works — no witness identity, no ack, and that is not a failure', () => {
  // The absent `witnessPeerId` is the caller saying "store this, do not acknowledge". That must stay
  // possible, or the preflight above becomes a requirement to hold a signing key in order to retain.
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const out = witnessPush(openRetention(), mkPush({ peerId: me.peerId, to: F(3), seq: 1 }), { receivedAtMs: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.ack, null);
    assert.equal(retainedCheckpoints(openRetention(), REPO, WRITER).length, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · AN ACK MUST ANSWER *THIS* PUSH
// ═════════════════════════════════════════════════════════════════════════════

test('a genuine ack for a DIFFERENT push does not verify against this one', () => {
  // The whole defect in one case. Both acks below are real, both are signed by a witness this node
  // paired with, and both verify as ack-shaped objects. Only one answers the push in hand.
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const store = openRetention();

    const pushA = mkPush({ peerId: me.peerId, to: F(3), seq: 1 });
    const ackA = witnessPush(store, pushA, { witnessPeerId: witness.peerId, receivedAt: 'T1', receivedAtMs: 1 }).ack;

    const pushB = mkPush({ peerId: me.peerId, to: F(7), prior: F(3), seq: 2 });
    const ackB = witnessPush(store, pushB, { witnessPeerId: witness.peerId, receivedAt: 'T2', receivedAtMs: 2 }).ack;

    assert.equal(verifyWitnessAck(ackA, pushA).ok, true);
    assert.equal(verifyWitnessAck(ackB, pushB).ok, true);

    const crossed = verifyWitnessAck(ackA, pushB);
    assert.equal(crossed.ok, false, 'an ack for an earlier checkpoint must not answer a later push');
    assert.match(crossed.reason, /commitment|seq|correlat/i);
  });
});

test('every correlating field is checked, not just the one we happened to think of', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const other = pairPeer({ name: 'another-writer' });
    const witness = pairPeer({ name: 'the-witness' });
    const store = openRetention();

    const p = mkPush({ peerId: me.peerId, to: F(4), seq: 1 });
    const ack = witnessPush(store, p, { witnessPeerId: witness.peerId, receivedAt: 'T', receivedAtMs: 1 }).ack;
    assert.equal(verifyWitnessAck(ack, p).ok, true);

    // Each mutation is a real confusion, not a corrupted byte: the ack stays internally consistent and
    // correctly signed for the thing it actually describes.
    const wrongPair = mkPush({ peerId: other.peerId, to: F(4), seq: 1 });
    assert.equal(verifyWitnessAck(ack, wrongPair).ok, false, 'pairId must match the push it answers');

    const wrongSeq = { ...p, seq: 9 };
    assert.equal(verifyWitnessAck(ack, wrongSeq).ok, false, 'senderSeq must match');

    const wrongCommitment = { ...p, commitment: 'a'.repeat(64) };
    assert.equal(verifyWitnessAck(ack, wrongCommitment).ok, false, 'checkpointCommitment must match');

    assert.equal(verifyWitnessAck(ack, null).ok, false, 'no push is not a match');
    assert.equal(verifyWitnessAck(ack, undefined).ok, false);
  });
});

test('an unsupported protocol version is refused rather than assumed compatible', () => {
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const p = mkPush({ peerId: me.peerId, to: F(3), seq: 1 });
    const ack = witnessPush(openRetention(), p, { witnessPeerId: witness.peerId, receivedAt: 'T', receivedAtMs: 1 }).ack;

    // Changing it breaks the signature, which is correct — but the check must be explicit, so a future
    // witness signing a version we do not understand is refused by NAME rather than by accident.
    assert.equal(verifyWitnessAck({ ...ack, protocolVersion: 'aukora-witness-ack-v99' }, p).ok, false);
  });
});

test('the witness sequence must be monotonic against acks already verified', () => {
  // Without this, a replayed older ack — genuinely signed, correctly correlated to a push that is
  // itself replayed — walks a consumer's view of the witness backwards.
  sandbox(() => {
    const me = pairPeer({ name: 'laptop' });
    const witness = pairPeer({ name: 'the-witness' });
    const store = openRetention();

    const p1 = mkPush({ peerId: me.peerId, to: F(3), seq: 1 });
    const a1 = witnessPush(store, p1, { witnessPeerId: witness.peerId, receivedAt: 'T1', receivedAtMs: 1 }).ack;
    const p2 = mkPush({ peerId: me.peerId, to: F(6), prior: F(3), seq: 2 });
    const a2 = witnessPush(store, p2, { witnessPeerId: witness.peerId, receivedAt: 'T2', receivedAtMs: 2 }).ack;

    assert.ok(a1.witnessSeq < a2.witnessSeq);
    assert.equal(verifyWitnessAck(a2, p2, { afterWitnessSeq: a1.witnessSeq }).ok, true);
    const backwards = verifyWitnessAck(a1, p1, { afterWitnessSeq: a2.witnessSeq });
    assert.equal(backwards.ok, false, 'a witness sequence may not walk backwards');
    assert.match(backwards.reason, /monotonic|behind|sequence/i);
  });
});
