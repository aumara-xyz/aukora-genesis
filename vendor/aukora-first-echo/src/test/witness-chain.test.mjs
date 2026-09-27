// aukora · test/chain.test.mjs — the record, and the claims made about it

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, appendFileSync } from 'node:fs';

import { append, readAll, chainPath, canonicalJSON, GENESIS_PREV, MAX_LINE_BYTES } from '../core/witness/chain.mjs';
import { verifyChain, explain, bodyOf } from '../core/witness/verify.mjs';
import { runFence, runWitness, REFUSE, ALLOW } from '../core/witness/guard.mjs';
import { makeRepo } from './helpers/fixture.mjs';

const payload = (root, tool, file) => ({
  session_id: 'test', cwd: root, tool_name: tool, tool_input: { file_path: file },
});

test('a chain of one links to genesis', () => {
  const { root, cleanup } = makeRepo();
  try {
    append(root, { ts: 'T0', tool: 'Write', path: 'a.txt', resolved: 'a.txt', verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null }, null);
    const entries = readAll(root).records.map((r) => r.entry);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].prev, GENESIS_PREV);
    assert.equal(verifyChain(root).intact, true);
  } finally { cleanup(); }
});

test('editing one byte of a receipt breaks its hash', () => {
  const { root, cleanup } = makeRepo();
  try {
    runFence(payload(root, 'Edit', 'src/index.js'));
    runFence(payload(root, 'Write', 'secrets/key.txt'));
    assert.equal(verifyChain(root).intact, true, 'intact before tampering');

    const file = chainPath(root);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const target = lines.findIndex((l) => JSON.parse(l).verdict === 'refused');
    assert.notEqual(target, -1, 'there is a refusal to rewrite');

    const e = JSON.parse(lines[target]);
    assert.equal(e.verdict, 'refused', 'the byte we are about to change really does change');
    e.verdict = 'allowed';                 // rewrite history: it was refused
    lines[target] = JSON.stringify(e);
    writeFileSync(file, `${lines.join('\n')}\n`);

    const v = verifyChain(root);
    assert.equal(v.intact, false);
    assert.equal(v.hashBreaks.length >= 1, true);
    assert.equal(v.hashBreaks[0].line, target + 1);
  } finally { cleanup(); }
});

test('deleting a receipt is detected — the successor is orphaned', () => {
  const { root, cleanup } = makeRepo();
  try {
    for (const f of ['a.txt', 'b.txt', 'c.txt']) runFence(payload(root, 'Write', f));
    const file = chainPath(root);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    writeFileSync(file, `${[lines[0], lines[2]].join('\n')}\n`);   // remove the middle

    const v = verifyChain(root);
    assert.equal(v.intact, false);
    assert.equal(v.orphans.length, 1, 'the third receipt names a predecessor that is gone');
  } finally { cleanup(); }
});

test('a fork is reported as a fork, not as corruption', () => {
  const { root, cleanup } = makeRepo();
  try {
    // Two guards racing: both read the same head, both append against it.
    append(root, { ts: 'T0', tool: 'Write', path: 'a', resolved: 'a', verdict: 'allowed', reasonClass: 'ok:allowed', rule: null, session: 's', agent: null }, null);
    const head = readAll(root).records[0].entry.hash;
    const file = chainPath(root);
    const twin = (p) => JSON.stringify({
      v: 0, ts: `T-${p}`, tool: 'Write', path: p, resolved: p, verdict: 'allowed',
      reasonClass: 'ok:allowed', rule: null, session: 's', agent: null, prev: head,
    });
    // Recompute honest hashes for both so ONLY the fork is the anomaly.
    const withHash = (raw) => {
      const o = JSON.parse(raw);
      o.hash = createHash('sha256').update(`${head}${canonicalJSON(bodyOf(o))}`).digest('hex');
      o.sig = null;
      return JSON.stringify(o);
    };
    writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}\n${withHash(twin('b'))}\n${withHash(twin('c'))}\n`);

    const v = verifyChain(root);
    assert.equal(v.hashBreaks.length, 0, 'both branches hash correctly');
    assert.equal(v.orphans.length, 0, 'both name a predecessor that exists');
    assert.equal(v.intact, true, 'a fork is not a broken chain');
    assert.equal(v.forks.length, 1);
    assert.deepEqual(v.forks[0].lines, [2, 3]);
    assert.equal(v.heads.length, 2, 'two heads');
  } finally { cleanup(); }
});

// root ignores the permission bits these two tests rely on.
const notRoot = typeof process.getuid !== 'function' || process.getuid() !== 0;

test('NO RECEIPT, NO WRITE — an allow becomes a refusal if the chain cannot be appended', { skip: !notRoot }, () => {
  const { root, cleanup } = makeRepo();
  try {
    // src/index.js is not protected: this is an ALLOW under the law.
    assert.equal(runFence(payload(root, 'Edit', 'src/index.js')), ALLOW, 'allowed while the chain is writable');

    // Make the append fail. It must be the FILE, not the directory: appending
    // to a file that already exists needs write permission on the file, and a
    // read-only directory does not stop it. Getting this wrong is how a test
    // for this property passes without ever creating the condition.
    const file = chainPath(root);
    chmodSync(file, 0o400);
    let threw = false;
    try { appendFileSync(file, 'x'); } catch { threw = true; }
    assert.equal(threw, true, 'the append really is blocked now');

    const code = runFence(payload(root, 'Edit', 'src/index.js'));
    chmodSync(file, 0o600);   // restore so cleanup works

    assert.equal(code, REFUSE,
      'a write the law permits is refused when its receipt cannot be recorded — ' +
      'bytes must not reach disk with no record that they did');
  } finally { cleanup(); }
});

test('a refusal still refuses when the chain cannot be appended', { skip: !notRoot }, () => {
  const { root, cleanup } = makeRepo();
  try {
    runFence(payload(root, 'Edit', 'src/index.js'));      // create the chain file
    const file = chainPath(root);
    chmodSync(file, 0o400);
    const code = runFence(payload(root, 'Write', 'secrets/key.txt'));
    chmodSync(file, 0o600);
    assert.equal(code, REFUSE, 'refusing is safe under every failure mode');
  } finally { cleanup(); }
});

test('the witness never blocks, and records what the fence did not judge', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.equal(runWitness({ cwd: root, tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }), ALLOW);
    assert.equal(runWitness({ cwd: root, tool_name: 'Write', tool_input: { file_path: 'x' } }), ALLOW);
    assert.equal(runWitness(null), ALLOW);
    assert.equal(runWitness({ cwd: '/nonexistent/nope', tool_name: 'Bash' }), ALLOW, 'even when it cannot write');

    const entries = readAll(root).records.map((r) => r.entry);
    assert.equal(entries.length, 1, 'Bash recorded; Write skipped because the fence owns it');
    assert.equal(entries[0].verdict, 'unguarded');
    assert.equal(entries[0].reasonClass, 'unguarded:not-a-file-tool');
  } finally { cleanup(); }
});

test('an unrecognised tool is recorded as a visible gap, not silently', () => {
  const { root, cleanup } = makeRepo();
  try {
    runWitness({ cwd: root, tool_name: 'SomeFutureWriteTool', tool_input: { file_path: 'x' } });
    const entries = readAll(root).records.map((r) => r.entry);
    assert.equal(entries[0].reasonClass, 'unguarded:unknown-tool');
  } finally { cleanup(); }
});

test('a multi-path call refuses as a whole, and siblings say so', () => {
  const { root, cleanup } = makeRepo();
  try {
    const code = runFence({
      session_id: 's', cwd: root, tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/index.js', edits: [{ file_path: 'secrets/key.txt' }] },
    });
    assert.equal(code, REFUSE);
    const entries = readAll(root).records.map((r) => r.entry);
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.verdict === 'refused'), 'nothing was written, so nothing is allowed');
    const classes = entries.map((e) => e.reasonClass).sort();
    assert.deepEqual(classes, ['law:protected-path', 'law:sibling-refused']);
  } finally { cleanup(); }
});

test('receipts never carry file contents', () => {
  const { root, cleanup } = makeRepo();
  try {
    runFence({
      session_id: 's', cwd: root, tool_name: 'Write',
      tool_input: { file_path: 'src/new.js', content: 'SUPER_SECRET_TOKEN_abc123' },
    });
    runWitness({ cwd: root, tool_name: 'Bash', tool_input: { command: 'echo SUPER_SECRET_TOKEN_abc123' } });
    const raw = readFileSync(chainPath(root), 'utf8');
    assert.equal(raw.includes('SUPER_SECRET_TOKEN_abc123'), false,
      'no file content and no command text may ever reach the chain');
    assert.equal(raw.includes('content'), false);
    assert.equal(raw.includes('command'), false);
  } finally { cleanup(); }
});

test('every line stays under the atomic-append bound', () => {
  const { root, cleanup } = makeRepo();
  try {
    const long = `src/${'d'.repeat(300)}/${'f'.repeat(4000)}.js`;
    runFence(payload(root, 'Write', long));
    for (const line of readFileSync(chainPath(root), 'utf8').trimEnd().split('\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') + 1 <= MAX_LINE_BYTES,
        `line is ${Buffer.byteLength(line, 'utf8')} bytes, bound is ${MAX_LINE_BYTES}`);
    }
    // The verdict survives truncation even though the display path does not.
    const entries = readAll(root).records.map((r) => r.entry);
    assert.equal(entries[0].verdict, 'allowed');
  } finally { cleanup(); }
});

test('explain() reproduces the hash, and so does jq', { skip: !hasJq() }, () => {
  const { root, cleanup } = makeRepo();
  try {
    // Unicode, an em dash, and embedded quotes — the cases where two JSON
    // serialisers are most likely to quietly disagree.
    runFence(payload(root, 'Write', 'docs/café — "quoted"/naïve.md'));
    runFence(payload(root, 'Write', 'secrets/key.txt'));

    for (const { entry: e, line } of readAll(root).records) {
      const x = explain(root, line);
      assert.equal(x.matches, true, `line ${line} recomputes`);

      const viaJq = execFileSync('/bin/sh', ['-c', x.recipes.jq], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/)[0];
      assert.equal(viaJq, e.hash, `jq recipe reproduces line ${line}`);

      const viaHex = execFileSync('/bin/sh', ['-c', x.recipes.hex], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/)[0];
      assert.equal(viaHex, e.hash, `hex recipe reproduces line ${line}`);
    }
  } finally { cleanup(); }
});

function hasJq() {
  try { execFileSync('/bin/sh', ['-c', 'command -v jq'], { stdio: 'ignore' }); return true; } catch { return false; }
}
