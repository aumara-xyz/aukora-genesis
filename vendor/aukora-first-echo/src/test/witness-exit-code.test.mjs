// aukora · test/witness-exit-code.test.mjs — WHAT AN EXIT CODE PROMISES
//
// `renderVerify` returned `v.trustworthy ? 0 : 1`. So a witness reporting BEHIND, or a witnessed prefix
// rewritten under a longer chain, printed IN RED and exited 0 — a script reading the code was told
// everything was fine while the screen said otherwise.
//
// Switching to `composed.ok` is the obvious fix and the wrong one: it flattens "the witness
// CONTRADICTS us" into "no witness was available". Those call for opposite actions — stop and
// investigate, versus go and pair a witness.
//
//   0  the assurance you ASKED FOR was established
//   1  evidence BROKEN OR CONTRADICTORY — fatal in every mode
//   2  the assurance you asked for is UNAVAILABLE — only reachable when you asked
//
// The default is LOCAL, and the output says so, because a node with no witness (today: every node)
// must not begin failing for not having one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const rec = (over = {}) => ({
  ts: 'T', tool: 'Write', path: 'f', resolved: 'f',
  verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null, ...over,
});

async function sandbox(fn) {
  const keys = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-exit-k-')));
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-exit-r-')));
  const savedKeys = process.env.AUKORA_KEYS_DIR;
  process.env.AUKORA_KEYS_DIR = keys;
  const realWrite = process.stdout.write.bind(process.stdout);
  const lines = [];
  try {
    mkdirSync(join(root, '.aukora'), { recursive: true });
    writeFileSync(join(root, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');
    const run = async (argv) => {
      const { renderVerify } = await import('../core/witness/log.mjs');
      lines.length = 0;
      process.stdout.write = (c) => { lines.push(String(c)); return true; };
      let code;
      try { code = renderVerify(root, argv); } finally { process.stdout.write = realWrite; }
      return { code, text: lines.join('').replace(ANSI, '') };
    };
    return await fn({ root, run });
  } finally {
    process.stdout.write = realWrite;
    if (savedKeys === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = savedKeys;
    rmSync(keys, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('0 — a healthy local chain, with the DEFAULT named in the output', async () => {
  await sandbox(async ({ root, run }) => {
    const { append } = await import('../core/witness/chain.mjs');
    for (let i = 0; i < 3; i += 1) append(root, rec({ ts: `T${i}`, path: `f${i}`, resolved: `f${i}` }));
    const { code, text } = await run([]);
    assert.equal(code, 0);
    // The mode is SAID. A reader must not have to know which question was asked.
    assert.match(text, /LOCAL assurance only/);
    assert.match(text, /--witness/, 'and how to ask the stronger question');
  });
});

test('2 — witness assurance REQUESTED and unavailable is not the same as fine', async () => {
  await sandbox(async ({ root, run }) => {
    const { append } = await import('../core/witness/chain.mjs');
    append(root, rec());
    const { code, text } = await run(['--witness']);
    assert.equal(code, 2, 'asked for a witness, got none');
    assert.match(text, /unavailable/);
    assert.notEqual(code, 1, 'no witness is not a broken chain');
  });
});

test('1 — a CONTRADICTION is fatal even in local mode, which is the whole ruling', async () => {
  // Not having asked for peer assurance does not excuse ignoring a contradiction already in hand: a
  // retained checkpoint that disagrees is evidence about THIS chain.
  await sandbox(async ({ root, run }) => {
    const { append, hashOf } = await import('../core/witness/chain.mjs');
    const { pairPeer, openRetention, witnessPush, buildCheckpointPush } = await import('../core/witness/peer.mjs');
    const { frontierOf, deltaOf } = await import('../core/witness/frontier.mjs');

    for (let i = 0; i < 4; i += 1) append(root, rec({ ts: `T${i}`, path: `f${i}`, resolved: `f${i}` }));
    const me = pairPeer({ name: 'laptop' });
    const store = openRetention();
    const witnessed = frontierOf(root);
    assert.equal(
      witnessPush(store, buildCheckpointPush({ peerId: me.peerId, frontier: witnessed, seq: 1, at: 'T', delta: deltaOf(root, null) }), { receivedAtMs: 1 }).ok,
      true,
    );

    // Rewrite a receipt under the witnessed prefix and recompute every downstream hash, then grow past
    // it. The chain is INTACT — the attacker is the one who recomputed it — and the count only went up,
    // so every digest-only comparison reads a healthy extension.
    const chainFile = join(root, '.aukora', 'chain.jsonl');
    const rows = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    rows[1] = { ...rows[1], path: 'TAMPERED', resolved: 'TAMPERED' };
    for (let i = 1; i < rows.length; i += 1) {
      const { hash: _h, prev: _p, sig, ...body } = rows[i];
      const newPrev = rows[i - 1].hash;
      rows[i] = { ...body, prev: newPrev, hash: hashOf(newPrev, body), sig: sig ?? null };
    }
    writeFileSync(chainFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    append(root, rec({ ts: 'T9', path: 'f9', resolved: 'f9' }));

    // BARE verify — no --witness. Still fatal.
    const { code, text } = await run([]);
    assert.equal(code, 1, 'a contradiction in hand is fatal whether or not a witness was requested');
    assert.match(text, /contradicts it|evidence is broken/);
    assert.match(text, /WITNESSED PREFIX REWRITTEN/, 'and the reader is told which prefix');
  });
});

test('a broken chain is 1, not 2 — broken outranks unavailable', async () => {
  await sandbox(async ({ root, run }) => {
    const { append } = await import('../core/witness/chain.mjs');
    append(root, rec());
    const chainFile = join(root, '.aukora', 'chain.jsonl');
    const rows = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    rows[0].hash = 'f'.repeat(64);
    writeFileSync(chainFile, `${JSON.stringify(rows[0])}\n`, 'utf8');
    const { code } = await run(['--witness']);
    assert.equal(code, 1, 'a broken chain outranks a missing witness');
  });
});

test('duplicates and forks stay NON-FATAL — the live chain carries both', async () => {
  // The first draft of the new exit logic folded in `problems`, which counts duplicates and forks.
  // This renderer prints those in yellow and calls them worth attention rather than a broken chain,
  // so folding them in made `aukora verify` exit 1 on a healthy node — the same overclaim, reversed.
  await sandbox(async ({ root, run }) => {
    const { append } = await import('../core/witness/chain.mjs');
    const chainFile = join(root, '.aukora', 'chain.jsonl');
    append(root, rec());
    // A byte-identical duplicate: same body, same predecessor, therefore the same hash.
    const line = readFileSync(chainFile, 'utf8').split('\n').filter(Boolean)[0];
    writeFileSync(chainFile, `${line}\n${line}\n`, 'utf8');
    const { code, text } = await run([]);
    assert.match(text, /duplicate/i, 'the duplicate is reported');
    assert.equal(code, 0, 'and reporting it is not the same as failing');
  });
});
