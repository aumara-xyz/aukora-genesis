// aukora · test/witness-cli.test.mjs — every verb the help text advertises must actually run.
//
// ══ THE BUG THIS EXISTS FOR ══
//
// `bin/witness.mjs` dispatched `init`, `view` and `--file` to `core/witness/init.mjs`, `serve.mjs` and
// `view.mjs`. **None of the three existed in the repository.** The help text advertised all of them,
// and `init` is the first command anyone runs:
//
//     $ node bin/witness.mjs init
//     node:internal/modules/esm/resolve:272   ← ERR_MODULE_NOT_FOUND
//
// A dynamic `import()` inside a `switch` case fails at call time, not at load time, so nothing about
// this was visible until someone typed the word. Unit tests exercised the functions behind the verbs
// that DID exist and said nothing about the ones that did not — which is `LIMITS.md` §7 exactly: three
// defects shipped at once, every one a config or dispatch problem standing between correct functions
// and the caller.
//
// So this suite drives the actual binary as a subprocess. It is the only thing that can catch a verb
// that only fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeRepo } from './helpers/fixture.mjs';

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'witness.mjs');

const run = (args, cwd, input) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, input: input ?? '', encoding: 'utf8' });

/** Verbs the help text promises, read from the help text itself rather than from a list kept here. */
function advertisedVerbs() {
  const help = run(['--help'], process.cwd()).stdout;
  const found = new Set();
  for (const m of help.matchAll(/^\s{2}aukora\s+([a-z-]+)/gmu)) found.add(m[1]);
  return [...found];
}

test('the help text lists at least the verbs we know are real', () => {
  const verbs = advertisedVerbs();
  for (const v of ['log', 'verify', 'guard', 'witness']) {
    assert.ok(verbs.includes(v), `help must advertise ${v}`);
  }
});

test('EVERY advertised verb dispatches to a module that exists', () => {
  const { root, cleanup } = makeRepo();
  try {
    for (const verb of advertisedVerbs()) {
      // guard and witness read a tool call on stdin; give them a well-formed one.
      const input = (verb === 'guard' || verb === 'witness')
        ? JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'src/index.js' }, cwd: root, session_id: 'cli' })
        : '';
      const r = run([verb], root, input);
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/u.test(out),
        `aukora ${verb} could not load its own module:\n${out.slice(0, 400)}`);
      assert.ok(!/node:internal\/modules/u.test(out),
        `aukora ${verb} threw a module-resolution error:\n${out.slice(0, 400)}`);
    }
  } finally { cleanup(); }
});

test('no verb in the switch points at a file that is not there', () => {
  // Belt and braces, and it reads the source rather than the behaviour: catches a dead dispatch that
  // happens to be unreachable today but would fire the moment someone wires it up.
  const src = readFileSync(BIN, 'utf8');
  const here = dirname(BIN);
  for (const m of src.matchAll(/await import\('(\.\.\/[^']+)'\)/gu)) {
    const spec = m[1];
    let exists = true;
    try { readFileSync(join(here, spec)); } catch { exists = false; }
    assert.ok(exists, `bin/witness.mjs imports ${spec}, which does not exist`);
  }
});

test('an unknown verb is refused with help, not with a stack trace', () => {
  const r = run(['definitely-not-a-verb'], process.cwd());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/u);
  assert.ok(!/node:internal/u.test(`${r.stdout}${r.stderr}`));
});

test('help exits 0 and says what the tool will not do', () => {
  const r = run(['--help'], process.cwd());
  assert.equal(r.status, 0);
  // The scope disclaimer is load-bearing: it is the first place anyone reads what this is not.
  assert.match(r.stdout, /does not sandbox/u);
});
