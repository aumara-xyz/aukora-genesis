// aukora · test/echo-field-findings.test.mjs — WHAT THE FIELD RUN EXPOSED
//
// Grok ran First Echo on a second host with two real keyrings: VERIFIED twice, 12→19, the second push
// extended the first, a stale ack came back CONTRADICTED, a truncated retention log came back
// CONTRADICTED rather than "unavailable", and a witness that could not sign retained zero. The
// preflight holds in the field.
//
// Three things it exposed, and none of them are about the protocol working.
//
//   1 · THE FACE IS WIRED TO NOTHING. `verifyChain` publishes no peer section, and the door reads
//       `verifyChain`. The peer verdict lives on `verifyEverything`, which the face never calls. So
//       `narrowPeer` correctly reports "this build cannot see whether any second machine remembers
//       this record" — a TRUE sentence for the WRONG REASON, which is the same failure the empty-chain
//       bypass was: a check guarded one level down and rebuilt one level up.
//
//   2 · `forWitness` IS WRITTEN AND NEVER CHECKED. A push addressed to witness A is acceptable to
//       witness B. The field is decoration.
//
//   3 · A CHANGED WRITER EPOCH IS LOUD AND STILL EXITS 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const rec = (i) => ({
  ts: `T${i}`, tool: 'Write', path: `f${i}`, resolved: `f${i}`,
  verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null,
});

async function node(fn) {
  const keys = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-fld-k-')));
  const chainHome = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-fld-c-')));
  const repo = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-fld-r-')));
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

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE FACE MUST BE ABLE TO ASK THE QUESTION IT IS ALREADY ASKING
// ═════════════════════════════════════════════════════════════════════════════

test('verifyChain PUBLISHES a peer section — the face reads verifyChain, not verifyEverything', async () => {
  await node(async ({ repo, grow }) => {
    const { verifyChain } = await import('../core/witness/verify.mjs');
    await grow(3);
    const v = verifyChain(repo);
    assert.ok('peer' in v, 'the face calls this function; a verdict it never carries is a verdict nobody sees');
    assert.equal(v.peer.schema, 'aukora-peer-report-v1', 'under the schema the consumer already narrows');
  });
});

test('with no witness it reports never-witnessed — a REAL verdict, not an absence', async () => {
  await node(async ({ repo, grow }) => {
    const { verifyChain } = await import('../core/witness/verify.mjs');
    await grow(2);
    const v = verifyChain(repo);
    assert.equal(v.peer.state, 'peer:never-witnessed');
    // The distinction the whole round turns on: "nobody has been asked" is a thing we KNOW, and it is
    // not the same as "this build cannot see whether anybody was asked".
    assert.equal(v.peer.witnessRef, null);
    assert.equal(v.peer.agedMs, null);
  });
});

test('after a real acknowledgement it reports AGREED, with the witness and the age', async () => {
  await node(async ({ repo, grow }) => {
    const { verifyChain } = await import('../core/witness/verify.mjs');
    const { pairPeer, openRetention, witnessPush, buildCheckpointPush } = await import('../core/witness/peer.mjs');
    const { frontierOf, deltaOf } = await import('../core/witness/frontier.mjs');
    await grow(6);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });
    const out = witnessPush(openRetention(), buildCheckpointPush({
      peerId: me.peerId, frontier: frontierOf(repo), seq: 1, at: 'T', delta: deltaOf(repo, null),
    }), { witnessPeerId: w.peerId, receivedAt: 'T', receivedAtMs: Date.now() });
    assert.equal(out.ok, true, out.reason);

    const v = verifyChain(repo);
    assert.equal(v.peer.state, 'peer:agreed');
    assert.equal(typeof v.peer.witnessRef, 'string');
    assert.equal(v.peer.witnessRef.length, 12, 'a twelve-hex reference, the shape the consumer narrows');
    assert.ok(v.peer.agedMs >= 0, 'how long ago, so the face can say "recently enough" or not');
  });
});

test('a truncated chain under a retained checkpoint reports the CONTRADICTION, not silence', async () => {
  await node(async ({ repo, grow }) => {
    const { verifyChain } = await import('../core/witness/verify.mjs');
    const { pairPeer, openRetention, witnessPush, buildCheckpointPush } = await import('../core/witness/peer.mjs');
    const { frontierOf, deltaOf } = await import('../core/witness/frontier.mjs');
    const { chainPath } = await import('../core/witness/chain.mjs');
    const { readFileSync, writeFileSync: wf } = await import('node:fs');

    await grow(8);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });
    witnessPush(openRetention(), buildCheckpointPush({
      peerId: me.peerId, frontier: frontierOf(repo), seq: 1, at: 'T', delta: deltaOf(repo, null),
    }), { witnessPeerId: w.peerId, receivedAt: 'T', receivedAtMs: Date.now() });

    const f = chainPath(repo);
    const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    wf(f, `${rows.slice(0, 3).join('\n')}\n`, 'utf8');

    const v = verifyChain(repo);
    assert.equal(v.peer.state, 'peer:retains-later-head', 'a second machine remembers receipts this one cannot produce');
  });
});

test('verifyEverything reuses the section rather than deriving a rival one', async () => {
  // Two producers of "what the witness said" is exactly how they come to disagree, and the one that
  // disagrees silently is the one nobody is running.
  await node(async ({ repo, grow }) => {
    const { verifyChain, verifyEverything } = await import('../core/witness/verify.mjs');
    await grow(4);
    const chain = verifyChain(repo);
    const composed = verifyEverything(repo, { nowMs: Date.now() });
    assert.equal(composed.chain.peer.state, chain.peer.state);
    assert.equal(composed.peer.state, chain.peer.state, 'one answer, reachable two ways');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · A PUSH ADDRESSED TO ONE WITNESS IS NOT ACCEPTABLE TO ANOTHER
// ═════════════════════════════════════════════════════════════════════════════

test('forWitness is CHECKED — an addressed push is refused by anyone else', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit, accept } = await import('../core/echo/courier.mjs');
    await grow(5);
    const me = pairPeer({ name: 'laptop' });
    const intended = pairPeer({ name: 'witness-A' });
    const other = pairPeer({ name: 'witness-B' });

    const e = emit(repo, { asPeerId: me.peerId, forWitness: intended.peerId, at: 'T', atMs: 1 });
    assert.equal(e.ok, true, e.reason);

    const wrong = accept(e.doc, { asWitness: other.peerId });
    assert.equal(wrong.ok, false, 'a push addressed to A must not be acceptable to B');
    assert.match(wrong.reason, /addressed/i);

    const right = accept(e.doc, { asWitness: intended.peerId });
    assert.equal(right.ok, true, right.reason);
  });
});

test('an UNaddressed push is still acceptable by anyone — addressing is optional, not implied', async () => {
  await node(async ({ repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit, accept } = await import('../core/echo/courier.mjs');
    await grow(3);
    const me = pairPeer({ name: 'laptop' });
    const anyone = pairPeer({ name: 'whoever' });
    const e = emit(repo, { asPeerId: me.peerId, at: 'T', atMs: 1 });
    assert.equal(accept(e.doc, { asWitness: anyone.peerId }).ok, true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · A CHANGED WRITER EPOCH IS A HARD STOP THE OWNER CAN CLEAR
// ═════════════════════════════════════════════════════════════════════════════

test('a changed writer epoch REFUSES by default — loud that still exits 0 is not loud', async () => {
  await node(async ({ keys, repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit, accept } = await import('../core/echo/courier.mjs');
    const { rmSync: rm } = await import('node:fs');

    await grow(7);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });
    const first = emit(repo, { asPeerId: me.peerId, at: 'T', atMs: 1 });
    assert.equal(accept(first.doc, { asWitness: w.peerId }).ok, true);

    // THE ATTACK: delete `writer.id`. A new epoch is minted, every retained checkpoint for the old one
    // stops being compared against, and the node presents as having no history at all.
    rm(join(keys, 'writer.id'), { force: true });
    rm(join(keys, 'echo'), { recursive: true, force: true });
    await grow(2);

    const second = emit(repo, { asPeerId: me.peerId, at: 'T2', atMs: 2 });
    const out = accept(second.doc, { asWitness: w.peerId });
    assert.equal(out.ok, false, 'a witness must not silently adopt a second identity for a record it already holds');
    assert.ok((out.epochChange ?? []).length > 0, 'and it must name the epoch it already knew');
    assert.match(out.reason, /epoch/i);
  });
});

test('and the owner can clear it deliberately, which is the same act as --expect on import', async () => {
  await node(async ({ keys, repo, grow }) => {
    const { pairPeer } = await import('../core/witness/peer.mjs');
    const { emit, accept } = await import('../core/echo/courier.mjs');
    const { rmSync: rm } = await import('node:fs');

    await grow(7);
    const me = pairPeer({ name: 'laptop' });
    const w = pairPeer({ name: 'witness' });
    assert.equal(accept(emit(repo, { asPeerId: me.peerId, at: 'T', atMs: 1 }).doc, { asWitness: w.peerId }).ok, true);

    rm(join(keys, 'writer.id'), { force: true });
    rm(join(keys, 'echo'), { recursive: true, force: true });
    await grow(2);

    const second = emit(repo, { asPeerId: me.peerId, at: 'T2', atMs: 2 });
    const cleared = accept(second.doc, { asWitness: w.peerId, acceptNewEpoch: true });
    assert.equal(cleared.ok, true, cleared.reason);
    assert.ok((cleared.epochChange ?? []).length > 0, 'the fact is still reported on the way through');
  });
});
