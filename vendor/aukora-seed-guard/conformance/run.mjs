#!/usr/bin/env node
// AUKORA · conformance/run.mjs — the suite BOTH repositories must pass
//
// ══ WHY THIS EXISTS ══
//
// Two repositories implement the same idea. They have drifted twice already,
// in both directions, and neither drift was noticed by a human reading docs:
//
//   · the chain-lock defect was fixed in `adapters/membrane/chain.mjs` and sat
//     LIVE in the transplanted `seed/chain.mjs` for days, because the file was
//     VERBATIM and the transplant discipline says you do not edit a donor
//   · the hard-link hole is closed in aukora-one and OPEN in aukora-seed today
//
// Prose does not stop that. Discipline does not stop that. A shared executable
// suite does: a finding becomes a CASE first and a fix second, in both repos,
// and a case that passes in one and fails in the other names the divergence in
// one line, mechanically.
//
// ══ THE CONTRACT ══
//
// This file and `cases/` are vendored BYTE-IDENTICALLY into both repositories.
// Each repository supplies its own adapter, and nothing else:
//
//     export const NAME = 'aukora-one';
//     export function protectedPatterns(): string[]   // what the fixture protects
//     export async function judge({ root, path, op }): Promise<'REFUSE'|'ALLOW'>
//
// The adapter's only job is to answer the question this repository's real fence
// would answer, using this repository's real code. An adapter that reimplements
// the fence is worthless — it would prove the adapter conforms, not the fence.
//
// ══ WHAT A CASE IS ══
//
// A fixture built on a real filesystem, one attempted write, and the required
// verdict. Cases are DECLARATIVE so neither repository can quietly reinterpret
// one, and every case cites the incident that produced it. None of these are
// hypothetical; every one is something that actually happened here.
//
// ══ THE CONTROL IS NOT OPTIONAL ══
//
// `lawful-write` must ALLOW. A suite that refuses everything is not a strict
// suite, it is a broken one, and it would pass against a fence that returns
// REFUSE unconditionally. Any run where the control fails is reported as a
// suite failure regardless of what else passed.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Materialise a fixture INTO an existing directory.
 *
 * ══ WHY THE ADAPTER BUILDS THIS, NOT THE RUNNER ══
 *
 * The first version built the fixture in a scratch root and let the adapter
 * copy it wherever its fence expected. That silently destroyed the cases:
 * `cpSync` does not preserve hard links. Measured — nlink went 2 → 1 across
 * the copy, so the `hardlink-nlink` case handed the fence an ordinary file and
 * the fence correctly ALLOWED it. The suite then reported a real defect in
 * code that has no such defect.
 *
 * An alias is a property of a filesystem location, not of a file's bytes, and
 * it cannot survive being copied. So the adapter says where its fence expects
 * a repository to live, and the fixture is built THERE, once, in place.
 */
export function materialize(spec, root) {
  // NOT under a bare /tmp path that a caller might pass in: on macOS `/tmp` is
  // a symlink to `/private/tmp`, and a fence that realpaths its root while the
  // caller reports the literal path will refuse everything. Measured — it
  // blinded three of nine reviewers in one round. `mkdtempSync(tmpdir())`
  // returns the resolved `/var/folders/...` form on macOS, which is why it is
  // used rather than a hand-built `/tmp/...`.
  for (const d of spec.dirs ?? []) mkdirSync(join(root, d), { recursive: true });
  for (const [p, content] of Object.entries(spec.files ?? {})) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), content);
  }
  for (const [from, to] of Object.entries(spec.symlinks ?? {})) {
    mkdirSync(dirname(join(root, from)), { recursive: true });
    // `to` starting with '/' is absolute-outside-the-repo on purpose.
    symlinkSync(to.startsWith('/') ? to : join(root, to), join(root, from));
  }
  for (const [from, to] of Object.entries(spec.hardlinks ?? {})) {
    mkdirSync(dirname(join(root, from)), { recursive: true });
    linkSync(join(root, to), join(root, from));
  }
  return root;
}

/** A scratch directory that is already realpath-resolved. Never a bare /tmp path. */
export function scratchRoot() {
  return mkdtempSync(join(tmpdir(), 'conformance-'));
}

export function loadCases(dir = join(HERE, 'cases')) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

export async function runConformance(adapter, { cases = loadCases() } = {}) {
  const results = [];
  for (const c of cases) {
    const root = scratchRoot();
    let verdict; let error = null;
    try {
      // The adapter decides WHERE the repository lives and calls `materialize`
      // itself, so aliases are created in place and survive. See the note on
      // `materialize`.
      verdict = await adapter.judge({
        root, spec: c.fixture ?? {}, materialize,
        path: c.attempt.path, op: c.attempt.op ?? 'write',
      });
    } catch (err) {
      // A fence that throws is a fence that fails open — unless the adapter is
      // documented to convert a throw into a refusal. Recorded as ERROR so it
      // can never be mistaken for either verdict.
      verdict = 'ERROR'; error = String(err?.message ?? err).split('\n')[0];
    }
    rmSync(root, { recursive: true, force: true });
    results.push({
      id: c.id, expect: c.expect, got: verdict, pass: verdict === c.expect,
      why: c.why, incident: c.incident, error,
    });
  }
  const control = results.find((r) => r.id === 'lawful-write');
  return {
    adapter: adapter.NAME,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass),
    controlHeld: control ? control.pass : false,
    // A run whose control failed proves nothing about the run, whatever else
    // it reports. Stated as its own field so no caller can miss it.
    trustworthy: control ? control.pass : false,
    results,
  };
}

// ── CLI ──
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--adapter');
  const path = i >= 0 ? process.argv[i + 1] : join(HERE, 'adapter.aukora-one.mjs');
  if (!existsSync(path)) {
    console.error(`conformance: no adapter at ${path}`);
    console.error('usage: node conformance/run.mjs [--adapter <file>]');
    process.exit(2);
  }
  const adapter = await import(resolvePath(path));
  const r = await runConformance(adapter);
  console.log(`\nCONFORMANCE · ${r.adapter}\n`);
  for (const x of r.results) {
    const mark = x.pass ? ' ok ' : 'FAIL';
    console.log(`  ${mark}  ${x.id.padEnd(26)} expect ${x.expect.padEnd(7)} got ${x.got}${x.error ? `  (${x.error})` : ''}`);
    if (!x.pass) console.log(`        ↳ ${x.why}`);
  }
  console.log(`\n  ${r.passed}/${r.total} pass`);
  if (!r.controlHeld) {
    console.log('\n  THE CONTROL FAILED. `lawful-write` must be ALLOWED. A fence that refuses');
    console.log('  everything passes every other case here and protects nothing. This run');
    console.log('  proves nothing, whatever the count above says.');
  }
  process.exit(r.failed.length === 0 && r.controlHeld ? 0 : 1);
}
