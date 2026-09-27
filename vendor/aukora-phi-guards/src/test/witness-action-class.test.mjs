// aukora · test/witness-action-class.test.mjs — WHAT A RECEIPT IS EVIDENCE OF
//
// The first taxonomy called `unguarded` ATTENTION and `allowed`/`refused` ACTION. Codex overturned
// both, and the live chain settles it: of 8,178 "attention" receipts, 5,275 were `Bash` or
// `run_terminal_command` — the calls `guard.mjs` states it CANNOT inspect. The most-inspected name was
// attached to the least-inspected receipts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RECEIPT_CLASSES, classifyReceipt, biographyOf, READ_ONLY_TOOLS } from '../core/witness/action.mjs';
import { KNOWN_NON_WRITE_TOOLS } from '../core/witness/guard.mjs';

const r = (over = {}) => ({ tool: 'Read', path: '', resolved: '', verdict: 'unguarded', reasonClass: 'unguarded:not-a-file-tool', rule: null, session: 's', agent: null, ...over });

test('SHELL IS NOT ATTENTION — the one the old taxonomy got backwards', () => {
  assert.equal(classifyReceipt(r({ tool: 'Bash' })), RECEIPT_CLASSES.UNJUDGED);
  assert.equal(classifyReceipt(r({ tool: 'run_terminal_command' })), RECEIPT_CLASSES.UNJUDGED);
  assert.notEqual(classifyReceipt(r({ tool: 'Bash' })), RECEIPT_CLASSES.ATTENTION);
});

test('a judged write path is an INTENT, not a proven effect', () => {
  // `allowed` proves the fence said yes. It does not prove bytes moved, and one tool call can produce
  // several of these — including innocent siblings marked refused.
  assert.equal(classifyReceipt(r({ verdict: 'allowed', reasonClass: 'ok:allowed' })), RECEIPT_CLASSES.JUDGED_WRITE_PATH);
  assert.equal(classifyReceipt(r({ verdict: 'refused', reasonClass: 'law:sibling-refused' })), RECEIPT_CLASSES.JUDGED_WRITE_PATH);
});

test('explicitly read-only tools, and only those, are ATTENTION', () => {
  for (const tool of ['Read', 'Grep', 'Glob', 'read_file', 'list_dir', 'web_search']) {
    assert.equal(classifyReceipt(r({ tool })), RECEIPT_CLASSES.ATTENTION, tool);
  }
  // Membership is POSITIVE: an unrecognised tool is uninspected, never assumed to be a read.
  assert.equal(classifyReceipt(r({ tool: 'SomeToolNobodyHasClassified' })), RECEIPT_CLASSES.UNJUDGED);
  assert.equal(classifyReceipt(r({ tool: 'StructuredOutput' })), RECEIPT_CLASSES.UNJUDGED);
});

test('the read-only list is NOT the guard list, and Bash is why', () => {
  // The invariant, not the example: no tool the guard declares uninspectable may appear as read-only.
  assert.ok(KNOWN_NON_WRITE_TOOLS.includes('Bash'), 'the guard list contains Bash by design');
  assert.equal(READ_ONLY_TOOLS.includes('Bash'), false);
  assert.equal(READ_ONLY_TOOLS.includes('run_terminal_command'), false);
  for (const t of ['Task', 'spawn_subagent', 'TodoWrite', 'SlashCommand']) {
    assert.equal(READ_ONLY_TOOLS.includes(t), false, `${t} is not a read`);
  }
});

test('session lifecycle is BOUNDARY — structure, not conduct', () => {
  assert.equal(classifyReceipt(r({ tool: 'SessionStart', reasonClass: 'session:open' })), RECEIPT_CLASSES.BOUNDARY);
  assert.equal(classifyReceipt(r({ tool: 'SessionEnd', reasonClass: 'session:close' })), RECEIPT_CLASSES.BOUNDARY);
});

test('what the OWNER decided is its own class', () => {
  // Who decided and what happened are the two facts a biography must never merge into "it did a thing".
  assert.equal(classifyReceipt(r({ reasonClass: 'owner:applied' })), RECEIPT_CLASSES.OWNER_OUTCOME);
  assert.equal(classifyReceipt(r({ reasonClass: 'owner:rolled-back' })), RECEIPT_CLASSES.OWNER_OUTCOME);
});

test('a damaged receipt is UNJUDGED, not attention', () => {
  // The old code returned ATTENTION for an unreadable receipt, inventing conduct out of damage.
  assert.equal(classifyReceipt(null), RECEIPT_CLASSES.UNJUDGED);
  assert.equal(classifyReceipt('not an object'), RECEIPT_CLASSES.UNJUDGED);
  assert.equal(classifyReceipt({}), RECEIPT_CLASSES.UNJUDGED);
});

test('the projection separates coverage from conduct and never sums them', () => {
  const chain = [
    r({ tool: 'Bash' }), r({ tool: 'Bash' }),
    r({ tool: 'Read' }),
    r({ verdict: 'allowed', reasonClass: 'ok:allowed', tool: 'Write' }),
    r({ tool: 'SessionStart', reasonClass: 'session:open' }),
  ];
  const b = biographyOf(chain);
  assert.deepEqual(
    { attention: b.attention, unjudged: b.unjudged, boundary: b.boundary, judgedWritePaths: b.judgedWritePaths },
    { attention: 1, unjudged: 2, boundary: 1, judgedWritePaths: 1 },
  );
  assert.equal(b.uninspectableShellCalls, 2, 'the caveat on every other number is itself a number');

  // COVERAGE IS NOT IN HERE. A total that sits inside a biography is a total that gets read as part of
  // one; it travels beside, as `verifyChain`'s `receipts`.
  assert.equal(b.coverage, undefined);

  // The classes PARTITION the receipts: every one lands in exactly one, so nothing is double-counted
  // into looking accomplished and nothing silently vanishes.
  assert.equal(b.attention + b.unjudged + b.boundary + b.judgedWritePaths + b.ownerOutcomes, chain.length);
});

test('the partition holds for arbitrary receipts, not just the ones we thought of', () => {
  const tools = ['Bash', 'Read', 'Glob', 'SessionStart', 'Write', 'Edit', 'unknown_x', 'grep', null];
  const verdicts = ['unguarded', 'allowed', 'refused', undefined];
  const reasons = ['unguarded:not-a-file-tool', 'session:open', 'ok:allowed', 'owner:applied', 'law:protected-path', undefined];
  const all = [];
  for (const tool of tools) for (const verdict of verdicts) for (const reasonClass of reasons) all.push({ tool, verdict, reasonClass, session: 's' });
  const b = biographyOf(all);
  assert.equal(b.attention + b.unjudged + b.boundary + b.judgedWritePaths + b.ownerOutcomes, all.length);
  assert.equal(b.coverage, undefined, 'coverage never rides inside the classes');
});

test('verifyChain publishes ONE projection, and coverage stays a separate number', () => {
  const src = readFileSync(new URL('../core/witness/verify.mjs', import.meta.url), 'utf8');
  assert.match(src, /biography: biographyOf\(/, 'the canonical projection is published from the verified chain');
  assert.match(src, /receipts: records\.length/, 'coverage is still available and still called something else');
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PROJECTION HAS A READER — which is the whole point of publishing it
// ═════════════════════════════════════════════════════════════════════════════
//
// `verifyChain(...).biography` was published in #148 and NOTHING READ IT for two rounds. A projection
// computed on every verify and consumed by nobody is a verifier with no caller wearing different
// clothes. These pin the door open.

test('the projection is read off verifyChain DIRECTLY — measured by calling it, not by grepping for it', async () => {
  const { verifyChain } = await import('../core/witness/verify.mjs');
  const { append } = await import('../core/witness/chain.mjs');
  const { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-bio-')));
  try {
    mkdirSync(join(root, '.aukora'), { recursive: true });
    writeFileSync(join(root, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');
    const rec = (over) => ({ ts: 'T', tool: 'Read', path: '', resolved: '', verdict: 'unguarded', reasonClass: 'unguarded:not-a-file-tool', rule: null, session: 's', agent: null, ...over });
    append(root, rec({ tool: 'Bash' }));
    append(root, rec({ tool: 'Read' }));
    append(root, rec({ tool: 'Write', verdict: 'allowed', reasonClass: 'ok:allowed', path: 'f', resolved: 'f' }));

    const v = verifyChain(root);
    assert.equal(v.biography.schema, 'aukora-biography-v1', 'a consumer can refuse a shape it does not know');
    assert.equal(v.biography.unjudged, 1);
    assert.equal(v.biography.attention, 1);
    assert.equal(v.biography.judgedWritePaths, 1);

    // ONE CALL carries all three, which is what makes a second source unnecessary and therefore makes
    // double-counting unnecessary: coverage beside, and the verdict alongside.
    assert.equal(v.receipts, 3, 'coverage travels beside the classes');
    assert.equal(v.biography.coverage, undefined, 'and never inside them');
    assert.equal(typeof v.trustworthy, 'boolean', 'and the verdict comes with them, not from a second ask');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the callerless wrapper stays gone — asserted by IMPORTING, not by reading the source', async () => {
  // What this replaces counted `export function biographyFor` occurrences in the file TEXT. That proves
  // a name is present. It cannot prove anything calls it — and nothing did.
  const mod = await import('../core/witness/verify.mjs');
  assert.equal(mod.biographyFor, undefined, 'a callerless adapter must not come back without a caller');
  assert.equal(mod.classifyAll, undefined);
  assert.equal(typeof mod.verifyChain, 'function', 'the direct read is the supported path');
});

test('A READER EXISTS — renderVerify PRINTS the numbers, proven by running it', async () => {
  // Also previously a source regex over log.mjs. Running the renderer and reading its output is the
  // claim; matching `/v\.biography/` in a file is not.
  const { renderVerify } = await import('../core/witness/log.mjs');
  const { append } = await import('../core/witness/chain.mjs');
  const { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'phi-render-')));
  const written = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  try {
    mkdirSync(join(root, '.aukora'), { recursive: true });
    writeFileSync(join(root, 'aukora.law.json'), JSON.stringify({ schema: 'aukora-law-v0', protected: [], writable: ['**'] }), 'utf8');
    const rec = (over) => ({ ts: 'T', tool: 'Read', path: '', resolved: '', verdict: 'unguarded', reasonClass: 'unguarded:not-a-file-tool', rule: null, session: 's', agent: null, ...over });
    append(root, rec({ tool: 'Bash' }));
    append(root, rec({ tool: 'Bash' }));
    append(root, rec({ tool: 'Read' }));

    process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
    renderVerify(root, []);
    process.stdout.write = realWrite;

    const text = written.join('').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(text, /what this is evidence of/, 'the projection reaches the screen');
    assert.match(text, /2 are shell the fence cannot inspect/, 'and the caveat carries its real number');
    assert.match(text, /coverage 3/, 'and coverage is printed as its own separate thing');
  } finally {
    process.stdout.write = realWrite;
    rmSync(root, { recursive: true, force: true });
  }
});
