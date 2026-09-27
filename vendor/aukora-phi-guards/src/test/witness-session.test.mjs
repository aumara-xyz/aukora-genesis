// aukora · test/witness-session.test.mjs — a session nobody watched, told apart from a quiet one.
//
// ══ WHY THIS RECEIPT EXISTS ══
//
// A missing witness and an innocent session look identical. If a runtime session produced no receipts,
// nothing in the record distinguishes "the agent did nothing" from "the guard was never installed, or
// was removed for the duration". LIMITS §10 is the sharp edge of it: the vendor's own session store
// lives outside every repository and outlives ours, so an auditor can see that a session EXISTED while
// our chain says nothing at all about it.
//
// `session:open` converts absence of evidence into evidence of absence. A vendor session directory
// with no matching `session:open` is provably ungoverned — not ambiguous, provably.
//
// ══ WHAT IT DOES NOT DO, ASSERTED HERE SO NOBODY CLAIMS IT ══
//
// It does not prove the guard stayed installed for the whole session, only that it was at the boundary.
// It does not narrow §8. And it is not registered by the installer yet — see the note at the end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runSession, runWitness, ALLOW } from '../core/witness/guard.mjs';
import { readAll } from '../core/witness/chain.mjs';
import { verifyChain } from '../core/witness/verify.mjs';
import { makeRepo } from './helpers/fixture.mjs';

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'witness.mjs');
const classes = (root) => readAll(root).records.map((r) => r.entry.reasonClass);

test('a session boundary lands a receipt with the session named', () => {
  const { root, cleanup } = makeRepo();
  try {
    runSession({ hookEventName: 'SessionStart', cwd: root, session_id: 'S-1', permissionMode: 'default' });
    runSession({ hookEventName: 'SessionEnd', cwd: root, session_id: 'S-1', permissionMode: 'default' });

    const entries = readAll(root).records.map((r) => r.entry);
    assert.deepEqual(entries.map((e) => e.reasonClass), ['session:open', 'session:close']);
    for (const e of entries) {
      assert.equal(e.session, 'S-1', 'the session id is the whole point of the receipt');
      assert.equal(e.verdict, 'unguarded', 'a boundary is not a judgement — the verdict set stays closed');
      assert.equal(e.path, '', 'no path was judged, so naming one would imply an opinion');
    }
    assert.equal(verifyChain(root).intact, true);
  } finally { cleanup(); }
});

test('THE POINT — a session with no tool calls is still a session we saw', () => {
  const { root, cleanup } = makeRepo();
  try {
    runSession({ hookEventName: 'SessionStart', cwd: root, session_id: 'quiet', permissionMode: 'default' });
    // …and nothing else happens. Before this receipt existed, that produced an empty chain, which is
    // indistinguishable from a session the guard never saw.
    const entries = readAll(root).records.map((r) => r.entry);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].session, 'quiet');
  } finally { cleanup(); }
});

test('the permission posture is captured at the boundary too', () => {
  const { root, cleanup } = makeRepo();
  try {
    runSession({ hookEventName: 'SessionStart', cwd: root, session_id: 'S', permissionMode: 'bypassPermissions' });
    assert.equal(readAll(root).records[0].entry.mode, 'bypassPermissions',
      'a session that opened with permissions bypassed is a different fact from one that did not');
  } finally { cleanup(); }
});

test('an event that is neither a start nor an end is not invented into a receipt', () => {
  const { root, cleanup } = makeRepo();
  try {
    const r = runSession({ hookEventName: 'PreToolUse', cwd: root, session_id: 'S' });
    assert.equal(r, ALLOW);
    assert.deepEqual(classes(root), [], 'a record that guesses what it was told is worse than a silent one');
  } finally { cleanup(); }
});

test('it never blocks and never throws, even on a payload it cannot read', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.equal(runSession(null), ALLOW);
    assert.equal(runSession({ hookEventName: 'SessionStart' }), ALLOW);   // no cwd
    assert.equal(runSession({ cwd: root }), ALLOW);                       // no event
  } finally { cleanup(); }
});

test('the session lane does not disturb the witness lane', () => {
  const { root, cleanup } = makeRepo();
  try {
    runSession({ hookEventName: 'SessionStart', cwd: root, session_id: 'S' });
    runWitness({ tool_name: 'Bash', cwd: root, session_id: 'S' });
    runSession({ hookEventName: 'SessionEnd', cwd: root, session_id: 'S' });
    assert.deepEqual(classes(root), ['session:open', 'unguarded:not-a-file-tool', 'session:close']);
    assert.equal(verifyChain(root).intact, true, 'and the chain still links across all three');
  } finally { cleanup(); }
});

test('the verb runs through the real binary and exits 0', () => {
  const { root, cleanup } = makeRepo();
  try {
    const r = spawnSync(process.execPath, [BIN, 'session'], {
      cwd: root, encoding: 'utf8',
      input: JSON.stringify({ hookEventName: 'SessionStart', cwd: root, session_id: 'cli' }),
    });
    assert.equal(r.status, 0, 'a session hook must never block a session');
    assert.deepEqual(classes(root), ['session:open']);
  } finally { cleanup(); }
});
