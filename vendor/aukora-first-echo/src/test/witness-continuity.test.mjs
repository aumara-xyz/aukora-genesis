// aukora · test/witness-continuity.test.mjs — A PROOF THE WITNESS CAN CHECK WITHOUT THE LEDGER
//
// ══ THE HOLE, REPRODUCED TWO WAYS ══
//
//   CODEX: retain {count 3, prefix A}, push {count 4, prefix B, seq 2}  → ACCEPTED
//   SOL:   rewrite the first 100 receipts, append one, push count 101    → ACCEPTED as EXTENDED
//
// `compareFrontier` treated ANY higher count as an extension, because with two digests and no chain
// bytes it cannot do better. The strong check existed — and had ZERO CALLERS. Worse, the `ok: true`
// it returned carried a reason string naming that uncalled function, so the verdict shipped with a
// reassurance pointing at a check nobody ran.
//
// ══ AND WHY THE TEST DID NOT CATCH IT — the more valuable half ══
//
// The previous suite pinned "reject a SHORTER history". That is the EXAMPLE from the probe that
// motivated it, not the INVARIANT. The invariant is: **reject every non-extension, regardless of
// count.** A test written from an example is satisfied by the one case somebody already thought of.
//
// So the properties below are quantified over many shapes rather than demonstrated on one.
//
// ══ THE FIX: A ROLLING ACCUMULATOR THE WITNESS REPLAYS ══
//
//     D₀ = H(domain)                     D_i = H(domain ‖ D_{i-1} ‖ receiptHash_i)
//
// A push carries a DELTA — `{ fromCommitment, toFrontier, appended[] }` — and the witness replays the
// appended hashes from the accumulator it ALREADY HOLDS. If the result matches the claimed frontier,
// the prefix it witnessed is provably still a prefix. It needs no copy of the ledger to know that,
// which is the whole point of a witness on another machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { accumulate, GENESIS_ACC, prefixDigestOf, buildDelta, verifyDelta, DELTA_STATES } from '../core/witness/frontier.mjs';

const F = (count, acc, heads = ['h1']) => ({
  schema: 'aukora-frontier-v2', repoId: 'r', writerEpoch: 'w',
  receiptCount: count, prefixDigest: acc,
  frontierDigest: [...heads].sort().join(','), frontierCount: heads.length, policyVersions: [],
});
const H = (n) => `${n}`.padStart(64, '0');
const chainOf = (n) => Array.from({ length: n }, (_, i) => H(i));

test('the accumulator is a fold, so a witness can resume it from a digest', () => {
  const hashes = chainOf(5);
  // Folding from the genesis constant reproduces the whole-chain digest — that is what makes it
  // resumable. A plain sha256 over concatenated hashes is NOT: you cannot continue it from its output.
  let d = GENESIS_ACC;
  for (const h of hashes) d = accumulate(d, h);
  assert.equal(d, prefixDigestOf(hashes));

  // And resuming from a prefix gets to the same place.
  let mid = prefixDigestOf(hashes.slice(0, 3));
  for (const h of hashes.slice(3)) mid = accumulate(mid, h);
  assert.equal(mid, d);
});

test('THE INVARIANT — a delta is accepted iff replaying it from the retained digest reproduces the claim', () => {
  // Quantified, not demonstrated. Every prefix length, every append length, checked both ways.
  const full = chainOf(12);
  for (let held = 0; held <= 12; held += 1) {
    for (let add = 0; add + held <= 12; add += 1) {
      const retained = F(held, prefixDigestOf(full.slice(0, held)));
      const appended = full.slice(held, held + add);
      const to = F(held + add, prefixDigestOf(full.slice(0, held + add)));
      const v = verifyDelta(retained, buildDelta({ from: retained, to, appended }));
      assert.equal(v.ok, true, `held=${held} add=${add} must verify: ${v.reason}`);
    }
  }
});

test('CODEX — a higher count with an unrelated prefix is REFUSED', () => {
  const retained = F(3, prefixDigestOf(chainOf(3)));
  const to = F(4, prefixDigestOf(['zz', 'yy', 'xx', 'ww']));
  const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: ['ww'] }));
  assert.equal(v.ok, false);
  assert.equal(v.state, DELTA_STATES.PREFIX_REWRITTEN);
});

test('SOL — rewrite the first hundred, append one, and the count still grows: REFUSED', () => {
  const original = chainOf(100);
  const retained = F(100, prefixDigestOf(original));
  const rewritten = [...original.slice(0, 99), 'TAMPERED'];
  const to = F(101, prefixDigestOf([...rewritten, H(100)]));
  const v = verifyDelta(retained, buildDelta({ from: retained, to, appended: [H(100)] }));
  assert.equal(v.ok, false);
  assert.equal(v.state, DELTA_STATES.PREFIX_REWRITTEN);
});

test('THE GENERAL FORM — no non-extension is accepted, whatever its count', () => {
  // The invariant the old test replaced with an example. Shorter, equal, longer; rewritten,
  // reordered, truncated, unrelated. NONE may verify.
  const full = chainOf(10);
  const retained = F(10, prefixDigestOf(full));
  const hostile = [
    ['shorter', F(4, prefixDigestOf(full.slice(0, 4))), []],
    ['equal but rewritten', F(10, prefixDigestOf([...full.slice(0, 9), 'X'])), []],
    ['longer but reordered', F(11, prefixDigestOf([...full.slice().reverse(), H(10)])), [H(10)]],
    // NOTE — the first draft of this case used `chainOf(50)`, whose first ten hashes ARE `chainOf(10)`.
    // That is a legitimate extension, and `verifyDelta` accepted it, correctly. The test was wrong, not
    // the code. Writing hostile cases is itself a place to mistake an example for the property: a case
    // is only adversarial if it actually diverges.
    ['longer, genuinely unrelated', F(50, prefixDigestOf(Array.from({ length: 50 }, (_, i) => H(i + 500)))), Array.from({ length: 40 }, (_, i) => H(i + 510))],
    ['count lies about appended', F(20, prefixDigestOf([...full, H(10)])), [H(10)]],
  ];
  for (const [label, to, appended] of hostile) {
    const v = verifyDelta(retained, buildDelta({ from: retained, to, appended }));
    assert.equal(v.ok, false, `${label} must be refused`);
  }
});

test('an empty delta is agreement, not growth', () => {
  const full = chainOf(6);
  const retained = F(6, prefixDigestOf(full));
  const v = verifyDelta(retained, buildDelta({ from: retained, to: retained, appended: [] }));
  assert.equal(v.ok, true);
  assert.equal(v.state, DELTA_STATES.AGREED);
});

test('a delta whose fromCommitment is not what the witness holds is refused', () => {
  const retained = F(3, prefixDigestOf(chainOf(3)));
  const other = F(3, prefixDigestOf(['a', 'b', 'c']));
  const v = verifyDelta(retained, buildDelta({ from: other, to: F(4, prefixDigestOf(['a', 'b', 'c', 'd'])), appended: ['d'] }));
  assert.equal(v.ok, false);
  assert.equal(v.state, DELTA_STATES.WRONG_ANCESTOR);
});

test('the witness needs NO copy of the ledger — only what it already retained', () => {
  // The property that makes a remote witness possible at all. `verifyDelta` receives a retained
  // frontier and a delta; it never reads a chain, a file, or a repository root.
  const src = readFileSync(new URL('../core/witness/frontier.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function verifyDelta'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.equal(/readAll|readFileSync|repoRoot/.test(fn), false, 'verifyDelta must not touch the filesystem');
});

// ═════════════════════════════════════════════════════════════════════════════
// THE WRITER-SIDE HALF — a check nobody calls is not a check
// ═════════════════════════════════════════════════════════════════════════════
//
// `verifyDelta` closed the WITNESS side. The writer's own node has the bytes and can do better: it can
// re-derive the witnessed prefix instead of trusting a count. `verifyFrontierAgainstChain` did exactly
// that and HAD ZERO CALLERS through two rounds — including the round that fixed the witness side —
// while `compareFrontier` returned ok:true naming it, and a comment in peer.mjs said it ran "in
// verifyEverything". Two descriptions, no caller.

test('verifyEverything RE-DERIVES the witnessed prefix, and says so in its verdict', async () => {
  const { verifyEverything } = await import('../core/witness/verify.mjs');
  const { pairPeer, openRetention, witnessPush, buildCheckpointPush } = await import('../core/witness/peer.mjs');
  const { frontierOf, deltaOf } = await import('../core/witness/frontier.mjs');
  const { append } = await import('../core/witness/chain.mjs');
  const { mkdtempSync, rmSync, realpathSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const keys = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-strong-k-')));
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-strong-r-')));
  const savedKeys = process.env.AUKORA_KEYS_DIR;
  process.env.AUKORA_KEYS_DIR = keys;
  try {
    mkdirSync(join(root, '.aukora'), { recursive: true });
    writeFileSync(join(root, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');
    const rec = (ts, path) => ({ ts, tool: 'Write', path, resolved: path, verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null });
    for (let i = 0; i < 4; i += 1) append(root, rec(`T${i}`, `f${i}`));

    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const witnessed = frontierOf(root);
    assert.equal(witnessPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: witnessed, seq: 1, at: 'T1', delta: deltaOf(root, null) }), { receivedAtMs: 1 }).ok, true);

    // Clean state: the witness agrees and nothing was rewritten.
    const before = verifyEverything(root, { store: openRetention(), nowMs: 2, maxAgeMs: 1e9 });
    assert.deepEqual(before.rewritten, [], 'nothing has been rewritten yet');

    // NOW REWRITE A RECEIPT UNDER THE WITNESSED PREFIX AND GROW THE CHAIN PAST IT — recomputing
    // every downstream hash, exactly as an attacker with write access would.
    //
    // The recomputation is the point. Tampering WITHOUT it leaves `hash` unchanged, so the prefix
    // digest still matches and nothing is proven — the first draft of this test made that mistake and
    // passed the tamper straight through. Recomputed, the chain is `intact` (the attacker is the one
    // who recomputed it) and the count only grows, so every digest-only comparison reports a healthy
    // extension. The re-derivation against what was WITNESSED is the only thing that objects.
    const { hashOf } = await import('../core/witness/chain.mjs');
    const chainFile = join(root, '.aukora', 'chain.jsonl');
    const rows = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    rows[1] = { ...rows[1], path: 'TAMPERED', resolved: 'TAMPERED' };
    for (let i = 1; i < rows.length; i += 1) {
      const { hash, prev, sig, ...body } = rows[i];
      const newPrev = rows[i - 1].hash;
      rows[i] = { ...body, prev: newPrev, hash: hashOf(newPrev, body), sig: sig ?? null };
    }
    writeFileSync(chainFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    append(root, rec('T9', 'f9'));

    const after = verifyEverything(root, { store: openRetention(), nowMs: 3, maxAgeMs: 1e9 });
    assert.ok(after.rewritten.length >= 1, 'a prefix rewritten under a longer chain must be named');
    assert.equal(after.ok, false, 'and it must not read ok');
    assert.match(after.reason, /no longer|rewritten|witnessed/i);
  } finally {
    if (savedKeys === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = savedKeys;
    rmSync(keys, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('THE INVARIANT BEHIND EVERY ROUND OF THIS — no exported answer is callerless except by declaration', () => {
  // The defect was never "one missing call". It was a CHECK WHOSE ABSENCE COMMENTS CONCEALED, and it
  // recurred: `verifyFrontierAgainstChain` went two rounds with no caller while two comments described
  // it running, and `biographyFor` shipped as "the single adapter" with none at all — guarded by a test
  // that counted its own declaration in the source text.
  //
  // So the scope is now every exported answer this lane publishes, not a hand-picked three.
  //
  // ══ THE DECLARATION SHRANK, AND THE TEST IS WHAT MADE IT ══
  //
  // For four rounds this named three: `deltaOf`, `acceptPush`, `verifyWitnessAck` — one cluster with
  // one reason, the peer protocol having no wire. `core/echo/courier.mjs` is that wire now, and the
  // day it landed this assertion FAILED, because two of the three had gained callers and the exception
  // list still claimed they had none. That is the mechanism working: a pending exception that quietly
  // becomes permanent is the thing being guarded against, so it has to break when the reason expires.
  //
  // `acceptPush` remains. It is the store-WITHOUT-acknowledging path, and the courier never wants it:
  // a witness that retains and does not sign is exactly the split `signingKeyFor` was added to close.
  // It stays because the distinction is real and tests exercise it; it is declared because nothing in
  // production should reach for it.
  const { execSync } = require('node:child_process');

  const EXPORTS = [
    'verifyChain', 'verifyAnchors', 'verifyEverything',
    'verifyDelta', 'verifyFrontierAgainstChain', 'verifyWitnessAck',
    'biographyOf', 'classifyReceipt',
    'frontierOf', 'deltaOf', 'compareFrontier',
    'witnessPush', 'acceptPush', 'peerFreshness',
  ];
  const DECLARED_CALLERLESS = ['acceptPush']; // store-without-ack; the courier deliberately never uses it

  const callerless = EXPORTS.filter((fn) => {
    const hits = execSync(`grep -rn "\\b${fn}(" core/ bin/ surface/ 2>/dev/null | grep -v "export function ${fn}" || true`, { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim())
      // A mention inside a comment is not a call. This is the whole lesson of the class, applied to the
      // test that polices the class.
      .filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*|\/\*)/.test(l));
    return hits.length === 0;
  });

  assert.deepEqual(
    callerless.sort(),
    [...DECLARED_CALLERLESS].sort(),
    'an exported answer is callerless without being declared — or a declared one gained a caller and the declaration is now stale',
  );
});
