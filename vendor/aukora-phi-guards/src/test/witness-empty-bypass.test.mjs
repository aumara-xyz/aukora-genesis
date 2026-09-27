// aukora · test/witness-empty-bypass.test.mjs — EMPTY IS NOT CLEAN
//
// ══ THE BYPASS, REPRODUCED THROUGH THE REAL CLI ══
//
// `renderVerify` returned 0 when `receipts === 0`, from a block placed BEFORE the assurance logic and
// AFTER `verifyEverything` had already been computed four lines above it. It consulted none of it.
//
//     40 receipts → pushed to a witness → chain.jsonl deleted
//     $ aukora verify              EXIT 0   "no receipts yet — nothing to verify."
//     $ aukora verify --witness    EXIT 0   "no receipts yet — nothing to verify."
//
// The deletion attack that peer retention exists to catch walked through the front door, and asking
// for the witness explicitly did not help, because nothing downstream of that return ever ran.
//
// ══ WHY THESE RUN AS SUBPROCESSES ══
//
// Calling `renderVerify` in-process tests a function. The claim is about what `aukora verify` EXITS
// with — the thing a script, a CI job, or the owner actually reads. `bin/witness.mjs` does
// `process.exit(renderVerify(...))`, and that hop is part of what is being asserted: a test that
// stops at the function cannot see a wrapper that discards the code, which is a defect this repository
// has already shipped twice elsewhere (`gate.ts:113`, `hands.ts:60`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'witness.mjs');
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const rec = (i) => ({
  ts: `T${i}`, tool: 'Write', path: `f${i}`, resolved: `f${i}`,
  verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null,
});

async function node({ receipts = 0, witness = null }, fn) {
  const keys = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-empty-k-')));
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-empty-r-')));
  const saved = process.env.AUKORA_KEYS_DIR;
  process.env.AUKORA_KEYS_DIR = keys;
  try {
    mkdirSync(join(root, '.aukora'), { recursive: true });
    writeFileSync(join(root, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');

    const { append } = await import('../core/witness/chain.mjs');
    for (let i = 0; i < receipts; i += 1) append(root, rec(i));

    // `witness` says what the witness was told, and WHEN — before or after any deletion.
    if (witness === 'retains-current') await push(root);

    const run = (args) => {
      try {
        const out = execFileSync('bun', [CLI, 'verify', ...args], { cwd: root, encoding: 'utf8', env: process.env });
        return { code: 0, text: out.replace(ANSI, '') };
      } catch (e) {
        return { code: e.status, text: `${e.stdout ?? ''}${e.stderr ?? ''}`.replace(ANSI, '') };
      }
    };
    const wipe = () => { try { unlinkSync(join(root, '.aukora', 'chain.jsonl')); } catch { /* already gone */ } };
    return await fn({ root, run, wipe, push: () => push(root) });
  } finally {
    if (saved === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = saved;
    rmSync(keys, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

async function push(root) {
  const { pairPeer, openRetention, witnessPush, buildCheckpointPush, latestRetained } = await import('../core/witness/peer.mjs');
  const { frontierOf, deltaOf } = await import('../core/witness/frontier.mjs');
  const me = pairPeer({ name: 'laptop' });
  const store = openRetention();
  const mine = frontierOf(root);
  const prior = latestRetained(store, mine.repoId, mine.writerEpoch);
  const r = witnessPush(store, buildCheckpointPush({
    peerId: me.peerId, frontier: mine, seq: (prior?.seq ?? 0) + 1, at: 'T',
    delta: deltaOf(root, prior?.frontier ?? null),
  }), { receivedAt: 'T', receivedAtMs: Date.now() });
  assert.equal(r.ok, true, `the fixture's own push must succeed: ${r.reason}`);
  return r;
}

// ═════════════════════════════════════════════════════════════════════════════
// SOL'S TABLE
// ═════════════════════════════════════════════════════════════════════════════

test('THE ATTACK — empty local, witness retains receipts → EXIT 1, in BOTH modes', async () => {
  await node({ receipts: 40, witness: 'retains-current' }, async ({ run, wipe }) => {
    wipe();
    for (const args of [[], ['--witness']]) {
      const { code, text } = run(args);
      assert.equal(code, 1, `aukora verify ${args.join(' ')} must not exit 0 over a deleted chain`);
      assert.match(text, /EMPTY and a witness retains/i);
      // And it must not read as the innocent case.
      assert.doesNotMatch(text, /nothing to verify/i);
    }
  });
});

test('empty local + a witness that attests the emptiness → EXIT 0', async () => {
  // The one way an empty chain earns a zero: somebody outside says there was nothing. This node
  // cannot say it about itself, which is the entire argument for a witness.
  await node({ receipts: 0 }, async ({ run, push: p }) => {
    await p();
    const { code, text } = run([]);
    assert.equal(code, 0);
    assert.match(text, /attests it was always empty/i);
  });
});

test('empty local + no witness → EXIT 2, never 0', async () => {
  await node({ receipts: 0 }, async ({ run }) => {
    const { code, text } = run([]);
    assert.equal(code, 2, 'unknowable is not clean');
    assert.notEqual(code, 0);
    assert.match(text, /no witness can say whether it always was/i);
  });
});

test('a healthy nonempty chain that was never witnessed → EXIT 0, and the mode is NAMED', async () => {
  await node({ receipts: 5 }, async ({ run }) => {
    const { code, text } = run([]);
    assert.equal(code, 0);
    assert.match(text, /LOCAL assurance only/);
    assert.match(text, /--witness/, 'and how to ask the stronger question');
  });
});

test('nonempty + --witness with no witness paired → EXIT 2', async () => {
  await node({ receipts: 5 }, async ({ run }) => {
    const { code, text } = run(['--witness']);
    assert.equal(code, 2);
    assert.match(text, /unavailable/i);
  });
});

test('a node that WAS witnessed and can no longer be → EXIT 2 even without --witness', async () => {
  // Losing an assurance you had is not the same as never having sought one. Reporting a degraded node
  // as a clean 0 would make the witness optional in exactly the moment it stops being optional.
  await node({ receipts: 5, witness: 'retains-current' }, async ({ root, run }) => {
    // The witness's memory goes stale: its retained row is old, so it can no longer speak to now.
    const { keysDir } = await import('../core/witness/aumlok.mjs');
    const p = join(keysDir(), 'retention.json');
    const { readFileSync, writeFileSync: wf } = await import('node:fs');
    const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    rows[rows.length - 1].receivedAtMs = 1;
    wf(p, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

    const { code, text } = run([]);
    assert.equal(code, 2, 'a witness that was there and is not now is a loss, not a clean run');
    assert.match(text, /WAS witnessed/i);
  });
});

test('a broken chain outranks a missing witness — 1, not 2', async () => {
  await node({ receipts: 3 }, async ({ root, run }) => {
    const { readFileSync, writeFileSync: wf } = await import('node:fs');
    const f = join(root, '.aukora', 'chain.jsonl');
    const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    rows[0].hash = 'f'.repeat(64);
    wf(f, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    const { code } = run(['--witness']);
    assert.equal(code, 1);
  });
});

test('THE HOP IS PART OF THE CLAIM — bin/witness.mjs must not discard the code', async () => {
  // `gate.ts:113` and `hands.ts:60` both dropped a child's status. A suite that stops at the function
  // cannot see a wrapper that does that, so this asserts the process exit, end to end.
  await node({ receipts: 0 }, async ({ run }) => {
    assert.equal(run([]).code, 2, 'the CLI propagates 2');
  });
  await node({ receipts: 5 }, async ({ run }) => {
    assert.equal(run([]).code, 0, 'and 0');
  });
});
