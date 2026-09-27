// aukora · test/echo-first.test.mjs — FIRST ECHO
//
// ══ THE MOVE ══
//
// Make ONE external fact stick: a second machine retained Peter's frontier at count N and signed an
// acknowledgement of the exact checkpoint it retained. Then repeat it once, and the second push must
// EXTEND the first. Everything else here exists to stop that fact from being faked.
//
// ══ TWO MACHINES, AND NEITHER OF THEM IS HIS ══
//
// Every case runs with two disposable `AUKORA_KEYS_DIR` values — one per machine, because a keyring is
// what makes a machine a machine here — and a disposable `AUKORA_CHAIN_HOME`. The owner's real
// keyring, real chain and real retention are never read and never written. A test that had to touch
// them to prove transport works would have proved the opposite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ECHO = join(HERE, '..', 'bin', 'echo.mjs');

const rec = (i) => ({
  ts: `T${i}`, tool: 'Write', path: `f${i}`, resolved: `f${i}`,
  verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null,
});

/**
 * Two machines and a repository, all disposable.
 *
 * `a` is Peter's node — it has the chain. `b` is the witness — it has nothing but a keyring. Switching
 * between them is switching `AUKORA_KEYS_DIR`, which is the only thing that distinguishes them.
 */
async function twoMachines(fn) {
  const a = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'echo-a-')));
  const b = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'echo-b-')));
  const chainHome = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'echo-chain-')));
  const repo = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'echo-repo-')));
  const savedKeys = process.env.AUKORA_KEYS_DIR;
  const savedChain = process.env.AUKORA_CHAIN_HOME;
  process.env.AUKORA_CHAIN_HOME = chainHome;

  try {
    mkdirSync(join(repo, '.aukora'), { recursive: true });
    writeFileSync(join(repo, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');

    // `on` runs a function with one machine's keyring mounted. Module state that caches the keys dir
    // would break this, which is itself worth knowing.
    const on = async (machine, f) => {
      process.env.AUKORA_KEYS_DIR = machine;
      return f();
    };
    // `spawnSync`, not `execFileSync`. The latter returns only stdout, so a run that SUCCEEDED
    // discarded everything the program wrote to stderr — and the loud cases here (a torn log, a writer
    // epoch change) are reported on stderr precisely because they accompany success. The first draft
    // of this harness asserted against `''` and would have called a silent build correct.
    const cli = (machine, args, stdin = '') => {
      const r = spawnSync('bun', [ECHO, ...args], {
        cwd: repo, encoding: 'utf8', input: stdin,
        env: { ...process.env, AUKORA_KEYS_DIR: machine, AUKORA_CHAIN_HOME: chainHome },
      });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const grow = async (n) => {
      const { append } = await import('../core/witness/chain.mjs');
      for (let i = 0; i < n; i += 1) append(repo, rec(`${Date.now()}-${i}-${Math.floor(i)}`));
    };
    return await fn({ a, b, repo, chainHome, on, cli, grow });
  } finally {
    if (savedKeys === undefined) delete process.env.AUKORA_KEYS_DIR; else process.env.AUKORA_KEYS_DIR = savedKeys;
    if (savedChain === undefined) delete process.env.AUKORA_CHAIN_HOME; else process.env.AUKORA_CHAIN_HOME = savedChain;
    for (const d of [a, b, chainHome, repo]) rmSync(d, { recursive: true, force: true });
  }
}

/** Pair an identity on one machine and hand back its public document. */
async function mint(machine, name) {
  process.env.AUKORA_KEYS_DIR = machine;
  const { pairPeer } = await import('../core/witness/peer.mjs');
  const { exportablePeer } = await import('../core/echo/courier.mjs');
  const record = pairPeer({ name });
  return { record, doc: exportablePeer(record) };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 · WHAT MAY CROSS
// ═════════════════════════════════════════════════════════════════════════════

test('1 · the exported peer document carries the public half and NOTHING else', async () => {
  await twoMachines(async ({ a }) => {
    const { doc } = await mint(a, 'laptop');
    assert.deepEqual(
      Object.keys(doc).sort(),
      ['channelPub', 'name', 'pairedAt', 'peerId', 'schema'],
      'an allow-list, so a field added to the peer record later cannot leak by default',
    );
    const text = JSON.stringify(doc);
    assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY/);
  });
});

test('2 · nothing that crosses is a secret, a path, or a piece of content', async () => {
  await twoMachines(async ({ a, b, repo, on, cli, grow }) => {
    const me = await mint(a, 'laptop');
    const w = await mint(b, 'witness');
    await on(a, () => {});
    await grow(4);
    await on(a, async () => {
      const { importPeer } = await import('../core/echo/courier.mjs');
      importPeer(w.doc, { expect: w.record.peerId });
    });

    const pushDoc = cli(a, ['emit', '--as', me.record.peerId]).stdout;
    const ackDoc = cli(b, ['accept', '--as', w.record.peerId], pushDoc).stdout;

    for (const [label, text] of [['push', pushDoc], ['ack', ackDoc]]) {
      // The receipts in this repository name paths `f<n>` and a session `s`. A document that carried
      // the record's CONTENT rather than its shape would show them.
      assert.doesNotMatch(text, /aukora\.law\.json/, `${label} leaks a repository path`);
      assert.doesNotMatch(text, /"tool"/, `${label} leaks a receipt body`);
      assert.doesNotMatch(text, /PRIVATE KEY/, `${label} leaks key material`);
      assert.doesNotMatch(text, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} leaks an absolute path`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · TRUST ON FIRST USE IS THE OWNER'S ACT
// ═════════════════════════════════════════════════════════════════════════════

test('3 · import without --expect is REFUSED — delivery is not endorsement', async () => {
  await twoMachines(async ({ a, b, cli }) => {
    const w = await mint(b, 'witness');
    const r = cli(a, ['import-peer'], JSON.stringify(w.doc));
    assert.equal(r.code, 2, 'nothing was established');
    assert.match(r.stdout + r.stderr, /--expect/);
  });
});

test('4 · import with the WRONG expected peerId is refused', async () => {
  await twoMachines(async ({ a, b, cli }) => {
    const w = await mint(b, 'witness');
    const r = cli(a, ['import-peer', '--expect', 'f'.repeat(24)], JSON.stringify(w.doc));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /you expected/);
  });
});

test('5 · a document whose peerId does not derive from its own key is refused', async () => {
  // The lie that would otherwise survive the visual check: keep a peerId the owner recognises and
  // swap the key underneath it.
  await twoMachines(async ({ a, b, cli }) => {
    const w = await mint(b, 'witness');
    const impostor = await mint(b, 'impostor');
    const forged = { ...w.doc, channelPub: impostor.doc.channelPub };
    const r = cli(a, ['import-peer', '--expect', w.record.peerId], JSON.stringify(forged));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /derives|not what it says/i);
  });
});

test('6 · a matching import succeeds and is idempotent', async () => {
  await twoMachines(async ({ a, b, cli }) => {
    const w = await mint(b, 'witness');
    const first = cli(a, ['import-peer', '--expect', w.record.peerId], JSON.stringify(w.doc));
    assert.equal(first.code, 0);
    const again = cli(a, ['import-peer', '--expect', w.record.peerId], JSON.stringify(w.doc));
    assert.equal(again.code, 0);
    assert.match(again.stdout, /already known/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · FIRST ECHO
// ═════════════════════════════════════════════════════════════════════════════

async function pairedPair({ a, b, on, cli }) {
  const me = await mint(a, 'laptop');
  const w = await mint(b, 'witness');
  assert.equal(cli(a, ['import-peer', '--expect', w.record.peerId], JSON.stringify(w.doc)).code, 0);
  assert.equal(cli(b, ['import-peer', '--expect', me.record.peerId], JSON.stringify(me.doc)).code, 0);
  await on(a, () => {});
  return { me, w };
}

test('7 · FIRST ECHO — one external fact, end to end through two CLIs', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow, on } = ctx;
    const { me, w } = await pairedPair(ctx);
    await on(a, () => grow(12));

    const emitted = cli(a, ['emit', '--as', me.record.peerId, '--for', w.record.peerId]);
    assert.equal(emitted.code, 0);

    const accepted = cli(b, ['accept', '--as', w.record.peerId], emitted.stdout);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.match(accepted.stderr, /retained seq 1 at count 12/);

    const verified = cli(a, ['verify', '--as', me.record.peerId], accepted.stdout);
    assert.equal(verified.code, 0, verified.stdout + verified.stderr);
    // THE LABEL COMES FIRST — a human and a script must learn the same thing.
    assert.match(verified.stdout.split('\n')[0], /^VERIFIED/);
    assert.match(verified.stdout, /retained this chain at count 12/);
  });
});

test('8 · SECOND ECHO — and the second push must EXTEND the first', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow, on } = ctx;
    const { me, w } = await pairedPair(ctx);

    await on(a, () => grow(5));
    const e1 = cli(a, ['emit', '--as', me.record.peerId]);
    const a1 = cli(b, ['accept', '--as', w.record.peerId], e1.stdout);
    assert.equal(cli(a, ['verify', '--as', me.record.peerId], a1.stdout).code, 0);

    await on(a, () => grow(7));
    const e2 = cli(a, ['emit', '--as', me.record.peerId]);
    assert.equal(JSON.parse(e2.stdout).push.seq, 2, 'the sequence advanced');

    const a2 = cli(b, ['accept', '--as', w.record.peerId], e2.stdout);
    assert.equal(a2.code, 0, a2.stderr);
    assert.match(a2.stderr, /retained seq 2 at count 12/);

    const v2 = cli(a, ['verify', '--as', me.record.peerId], a2.stdout);
    assert.equal(v2.code, 0);
    assert.match(v2.stdout, /count 12/);
  });
});

test('8b · accept prints the ANCHOR caveat on the machine that actually holds it', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow } = ctx;
    const { me, w } = await pairedPair(ctx);
    await grow(9);

    const anchored = cli(a, ['emit', '--as', me.record.peerId, '--anchor']);
    assert.equal(anchored.code, 0, anchored.stderr);
    const acceptedAnchor = cli(b, ['accept', '--as', w.record.peerId], anchored.stdout);
    assert.equal(acceptedAnchor.code, 0, acceptedAnchor.stderr);
    assert.match(acceptedAnchor.stderr, /retained seq 1 at count 9/);
    assert.match(acceptedAnchor.stderr, /ANCHORED/,
      'the witness that just accepted an anchor must be told what it cannot vouch for');
  });
});

test('8c · and does NOT print it for a first push replayed from genesis — the two must not read alike', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow } = ctx;
    const { me, w } = await pairedPair(ctx);
    await grow(9);

    // No `--anchor` — first contact, and the whole chain is replayed and verified from genesis.
    const genesis = cli(a, ['emit', '--as', me.record.peerId]);
    assert.equal(genesis.code, 0, genesis.stderr);
    const acceptedGenesis = cli(b, ['accept', '--as', w.record.peerId], genesis.stdout);
    assert.equal(acceptedGenesis.code, 0, acceptedGenesis.stderr);
    assert.match(acceptedGenesis.stderr, /retained seq 1 at count 9/);
    assert.equal(/ANCHORED/.test(acceptedGenesis.stderr), false,
      'a witness that verified every hash from genesis must not print the anchor caveat');
  });
});

test('9 · a second push that does NOT extend the first is refused by the witness', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, repo, cli, grow, on } = ctx;
    const { me, w } = await pairedPair(ctx);
    await on(a, () => grow(6));
    const e1 = cli(a, ['emit', '--as', me.record.peerId]);
    const a1 = cli(b, ['accept', '--as', w.record.peerId], e1.stdout);
    assert.equal(cli(a, ['verify', '--as', me.record.peerId], a1.stdout).code, 0);

    // Rewrite the witnessed prefix and grow past it. Intact locally; a forgery to anyone who saw the
    // first six.
    await on(a, async () => {
      const { hashOf, chainPath } = await import('../core/witness/chain.mjs');
      const f = chainPath(repo);
      const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      rows[1] = { ...rows[1], path: 'TAMPERED', resolved: 'TAMPERED' };
      for (let i = 1; i < rows.length; i += 1) {
        const { hash: _h, prev: _p, sig, ...body } = rows[i];
        const prev = rows[i - 1].hash;
        rows[i] = { ...body, prev, hash: hashOf(prev, body), sig: sig ?? null };
      }
      writeFileSync(f, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
      await grow(2);
    });

    const e2 = cli(a, ['emit', '--as', me.record.peerId]);
    const a2 = cli(b, ['accept', '--as', w.record.peerId], e2.stdout);
    assert.equal(a2.code, 1, 'the witness must refuse a history that does not extend what it holds');
    assert.match(a2.stdout.split('\n')[0], /^CONTRADICTED/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · ONE UNRESOLVED PUSH AT A TIME
// ═════════════════════════════════════════════════════════════════════════════

test('10 · re-running emit returns the SAME push, byte for byte', async () => {
  await twoMachines(async (ctx) => {
    const { a, cli, grow, on } = ctx;
    const { me } = await pairedPair(ctx);
    await on(a, () => grow(3));
    const first = cli(a, ['emit', '--as', me.record.peerId]);
    const second = cli(a, ['emit', '--as', me.record.peerId]);
    assert.equal(second.code, 0);
    assert.equal(second.stdout, first.stdout, 'a second emit must not mint a divergent sequence');
    assert.match(second.stderr, /already awaiting acknowledgement/);
  });
});

test('11 · growing the chain does not mint a second sequence while one is in flight', async () => {
  await twoMachines(async (ctx) => {
    const { a, cli, grow, on } = ctx;
    const { me } = await pairedPair(ctx);
    await on(a, () => grow(3));
    const first = JSON.parse(cli(a, ['emit', '--as', me.record.peerId]).stdout);
    await on(a, () => grow(9));
    const second = JSON.parse(cli(a, ['emit', '--as', me.record.peerId]).stdout);
    assert.equal(second.push.seq, first.push.seq);
    assert.equal(second.push.frontier.receiptCount, first.push.frontier.receiptCount,
      'the in-flight push describes the chain as it was when it was minted');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · THE ANSWER MUST ANSWER OUR QUESTION
// ═════════════════════════════════════════════════════════════════════════════

test('12 · an ack for a DIFFERENT push is CONTRADICTED, not verified', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow, on } = ctx;
    const { me, w } = await pairedPair(ctx);

    await on(a, () => grow(4));
    const e1 = cli(a, ['emit', '--as', me.record.peerId]);
    const a1 = cli(b, ['accept', '--as', w.record.peerId], e1.stdout);
    assert.equal(cli(a, ['verify', '--as', me.record.peerId], a1.stdout).code, 0);

    await on(a, () => grow(4));
    cli(a, ['emit', '--as', me.record.peerId]);
    // Hand back the OLD acknowledgement. Genuine, correctly signed, and about a different checkpoint.
    const v = cli(a, ['verify', '--as', me.record.peerId], a1.stdout);
    assert.equal(v.code, 1);
    assert.match(v.stdout.split('\n')[0], /^CONTRADICTED/);
  });
});

test('13 · verify with nothing in flight is UNAVAILABLE — "not asked" never becomes success', async () => {
  await twoMachines(async (ctx) => {
    const { a, cli } = ctx;
    const { me } = await pairedPair(ctx);
    const v = cli(a, ['verify', '--as', me.record.peerId], JSON.stringify({ schema: 'aukora-echo-ack-v1', ack: {} }));
    assert.equal(v.code, 2);
    assert.match(v.stdout.split('\n')[0], /^UNAVAILABLE/);
  });
});

test('14 · a garbled acknowledgement is UNAVAILABLE, not a silent zero', async () => {
  await twoMachines(async (ctx) => {
    const { a, cli, grow, on } = ctx;
    const { me } = await pairedPair(ctx);
    await on(a, () => grow(2));
    cli(a, ['emit', '--as', me.record.peerId]);
    const v = cli(a, ['verify', '--as', me.record.peerId], '{ not json');
    assert.equal(v.code, 2);
    assert.match(v.stdout.split('\n')[0], /^UNAVAILABLE/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · THE LOUD CASES
// ═════════════════════════════════════════════════════════════════════════════

test('15 · a WRITER EPOCH CHANGE is loud — a deleted identity is not a fresh innocent node', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow, on } = ctx;
    const { me, w } = await pairedPair(ctx);
    await on(a, () => grow(9));
    const e1 = cli(a, ['emit', '--as', me.record.peerId]);
    assert.equal(cli(b, ['accept', '--as', w.record.peerId], e1.stdout).code, 0);
    cli(a, ['verify', '--as', me.record.peerId], cli(b, ['accept', '--as', w.record.peerId], e1.stdout).stdout);

    // THE ATTACK: delete `writer.id`. A new epoch is minted, every retained checkpoint for the old one
    // stops being compared against, and the node presents as having no history.
    rmSync(join(a, 'writer.id'), { force: true });
    await on(a, async () => {
      const { rmSync: rm } = await import('node:fs');
      rm(join(a, 'echo'), { recursive: true, force: true });
    });

    const e2 = cli(a, ['emit', '--as', me.record.peerId]);
    const a2 = cli(b, ['accept', '--as', w.record.peerId], e2.stdout);
    assert.match(a2.stderr, /WRITER EPOCH CHANGED/, 'the witness must say so, on success as well as failure');
    assert.match(a2.stderr, /deleted one/i);
  });
});

test('16 · a torn final retention line REFUSES — never appended after, never repaired', async () => {
  await twoMachines(async (ctx) => {
    const { a, b, cli, grow, on } = ctx;
    const { me, w } = await pairedPair(ctx);
    await on(a, () => grow(5));
    const e1 = cli(a, ['emit', '--as', me.record.peerId]);
    assert.equal(cli(b, ['accept', '--as', w.record.peerId], e1.stdout).code, 0);

    // A power loss mid-append on the WITNESS.
    const retention = join(b, 'retention.json');
    const before = readFileSync(retention, 'utf8');
    appendFileSync(retention, '{"seq":2,"repoId":"x","writ', 'utf8');

    await on(a, () => grow(3));
    const e2 = cli(a, ['emit', '--as', me.record.peerId]);
    const a2 = cli(b, ['accept', '--as', w.record.peerId], e2.stdout);
    assert.notEqual(a2.code, 0, 'a torn log must not be accepted onto');
    assert.match(a2.stderr, /torn/i);

    // AND IT IS NEITHER REPAIRED NOR APPENDED TO. Repairing invents a row; appending buries the tear.
    const after = readFileSync(retention, 'utf8');
    assert.ok(after.startsWith(before), 'the intact prefix is untouched');
    assert.match(after, /\{"seq":2,"repoId":"x","writ$/, 'the torn tail is left exactly as found');
  });
});
