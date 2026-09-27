// aukora · test/witness-advice.test.mjs — never ship a fence whose advice fails
//
// ══ THE DEFECT THIS MEASURES ══
//
// `core/witness/authority.mjs` refuses a write and then tells the operator what to do
// about it. Five of those hints said some form of:
//
//     run `aukora init --resign-law` and enter your seven-word phrase.
//
// and `guard.mjs` prints them on the HOT PATH — the fence stops you, then hands you a
// command. The command does not exist:
//
//     $ bun run bin/witness.mjs init
//     aukora: unknown command "init"
//
// `bin/witness.mjs` removed `init` and `view` on purpose, and its own header already
// argued the principle this file enforces: "An advertised verb that only fails is worse
// than an absent one: it spends the reader's trust before they have seen anything work."
// The binary took that seriously about its own dispatch. The hints did not.
//
// This is the worst possible placement for bad advice. A reader meets it at the moment
// the tool has just refused them — the one moment they have no reason to doubt it and
// every reason to do what it says.
//
// ══ WHY THE VERB LIST IS READ FROM THE BINARY ══
//
// A hardcoded list here would be a second place to update, and the second place is
// always the one that goes stale — which is the whole shape of the bug being fixed. So
// the accepted set is parsed out of `--help`, which is the binary's own statement about
// what it offers. If a verb is added or removed, this test follows it with no edit.
//
// ══ WHAT THIS DOES NOT CHECK ══
//
// That the advice is GOOD — only that it names something real. A hint pointing at a verb
// that exists and does not help would pass here and still be a bad hint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const WITNESS_DIR = join(REPO, 'core', 'witness');

/** Every verb `bin/witness.mjs --help` advertises. The binary's own word, not ours. */
function advertisedVerbs() {
  const help = execFileSync('node', [join(REPO, 'bin', 'witness.mjs'), '--help'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const verbs = new Set();
  for (const m of help.matchAll(/^\s{2}aukora ([a-z][a-z-]*)/gmu)) verbs.add(m[1]);
  return verbs;
}

/** Every `aukora <verb>` named anywhere in the witness lane, with its site. */
function advisedVerbs() {
  const found = [];
  for (const name of readdirSync(WITNESS_DIR)) {
    if (!name.endsWith('.mjs')) continue;
    const text = readFileSync(join(WITNESS_DIR, name), 'utf8');
    text.split('\n').forEach((lineText, i) => {
      for (const m of lineText.matchAll(/aukora ([a-z][a-z-]*)/gu)) {
        found.push({ file: `core/witness/${name}`, line: i + 1, verb: m[1], text: lineText.trim() });
      }
    });
  }
  return found;
}

test('the binary advertises verbs this test can read', () => {
  const verbs = advertisedVerbs();
  assert.ok(verbs.size >= 5, `--help should advertise the verbs; parsed ${verbs.size}`);
  // Two spot checks so a parser that silently matched nothing cannot pass this file.
  assert.ok(verbs.has('verify'), 'verify is advertised');
  assert.ok(verbs.has('guard'), 'guard is advertised');
});

test('every command the witness lane names is a command the binary has', () => {
  const verbs = advertisedVerbs();
  const bad = advisedVerbs().filter((a) => !verbs.has(a.verb));
  assert.deepEqual(
    bad.map((b) => `${b.file}:${b.line} names "aukora ${b.verb}" — ${[...verbs].join(', ')} are the verbs that exist`),
    [],
    'a fence that refuses you and then hands you a command that errors spends trust it cannot get back',
  );
});

test('the removed verb really is removed — so the hints have to say something else', () => {
  // Pins the PREMISE of the fix rather than its wording. If `init` is ever written for
  // real, this goes red and whoever wrote it gets to decide, deliberately, whether the
  // authority hints should point at it again.
  let stderr = '';
  try {
    execFileSync('node', [join(REPO, 'bin', 'witness.mjs'), 'init'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.fail('`aukora init` exited 0 — it now exists, and the hints should be revisited');
  } catch (err) {
    stderr = String(err.stderr ?? '');
  }
  assert.match(stderr, /unknown command "init"/u);
});
