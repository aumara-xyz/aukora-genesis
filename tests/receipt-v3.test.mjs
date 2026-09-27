// G3 — the receipt stranger path, tested the way a stranger would use it.
//
//   node tests/receipt-v3.test.mjs
//
// WHAT THIS PROVES. A receipt JSON, a public key file and the bytes committed under
// vendor/receipt/ are enough to reach the cold court's verdict from a FRESH EMPTY
// TEMPORARY DIRECTORY — no sibling checkout, nothing inherited through PYTHONPATH, and
// nothing written into the directory the stranger stands in. The fixture receipt was
// produced by upstream's own producer (vendor/receipt/PROVENANCE.md records the exact
// demo run), and every refusal below is a negative control: the check is only worth its
// green run if the mutation that should break it actually turns it red.
//
// WHAT IT DOES NOT PROVE. The cold court judges a signature over closed fields and the
// closed-field rules. It prints CONSISTENCY: CONSISTENCY_UNCHECKED always, because it
// retains no head and presents none; retained-vs-presented APPEND_ONLY /
// OBSERVATION_CONFLICT is Phase 0's court, which this file reaches only through the
// wrapper's --pair arm. `CLASS: unattributed` / `CONFORMANCE: NON-CONFORMING` is upstream's
// honest derivation for a live receipt from a toy that ships no owner keys — an
// attribution statement, not a statement that the signature failed. Nothing here proves
// that any human attended, and nothing here makes a receipt authorize anything: grants
// authorize composition, and no grant is vendored in this tree.
//
// "Offline" is evidenced by the import closure being standard-library-only and by the run
// needing exactly two input files; this test does not sandbox the network, so it does not
// prove the absence of a network call. The vendored modules import only hashlib, json,
// secrets, typing and pathlib.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRAPPER = join(ROOT, 'scripts', 'receipt-verify');
const VENDOR = join(ROOT, 'vendor', 'receipt');
const FIXTURES = join(VENDOR, 'fixtures');
const RECEIPT = join(FIXTURES, 'receipt.json');
const PUB = join(FIXTURES, 'issuer.pk');
const MANIFEST = join(VENDOR, 'upstream-receipt-v3.json');
const PHASE0_VECTORS = join(ROOT, 'vendor', 'append-only', 'vectors');
const PYTHON = process.env.PYTHON ?? 'python3';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Run the wrapper from a fresh empty directory with PYTHONPATH removed, so nothing about
 * this repository's environment can be what made the verdict reachable. */
function stranger(args) {
  const cwd = mkdtempSync(join(tmpdir(), 'receipt-v3-stranger-'));
  const env = { ...process.env };
  delete env.PYTHONPATH;
  const run = spawnSync(PYTHON, [WRAPPER, ...args], { cwd, env, encoding: 'utf8' });
  return {
    cwd,
    code: run.status,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    output: `${run.stdout ?? ''}${run.stderr ?? ''}`,
    leftBehind: existsSync(cwd) ? readdirSync(cwd) : [],
    lines: (run.stdout ?? '').split('\n'),
  };
}

/** A copy of the fixture in its own temp dir, so a mutation can never touch committed bytes. */
function fixtureCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-v3-fixture-'));
  const raw = readFileSync(RECEIPT);
  writeFileSync(join(dir, 'receipt.json'), mutate ? mutate(raw) : raw);
  writeFileSync(join(dir, 'issuer.pk'), readFileSync(PUB));
  return { dir, receipt: join(dir, 'receipt.json'), pub: join(dir, 'issuer.pk') };
}

/** Edit one field of the receipt JSON and write it to the copy. */
function withField(raw, name, value) {
  const document = JSON.parse(raw.toString('utf8'));
  document[name] = value;
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function hasVerdict(output) {
  return /^CLASS:/m.test(output) && /^CONFORMANCE:/m.test(output);
}

console.log('receipt v3 — the stranger path (receipt JSON + public key + vendored bytes)\n');

// 1. The happy path, from an empty directory, with nothing inherited.
const baselines = [];
const baseline = stranger([RECEIPT, '--pub', PUB]);
baselines.push(baseline);
check('the committed fixture verifies from a fresh empty directory', baseline.code === 0,
  `exit ${baseline.code}: ${baseline.stderr.trim().split('\n').slice(-1)[0] ?? ''}`);
check('the court is the VENDORED one, named in the printed command it ran',
  baseline.stdout.includes(`cd ${VENDOR} &&`) && baseline.stdout.includes('-m toy.cold_verify'),
  'the printed command does not name vendor/receipt/toy');
check('it needed exactly the two input files and wrote nothing into the stranger\'s directory',
  baseline.leftBehind.length === 0, `left behind: ${baseline.leftBehind.join(', ')}`);
// The signature court is only worth what its curve arithmetic is worth. The vendored
// module carries its own official-vector self-test, so run it rather than trusting the module.
const selftest = spawnSync(PYTHON, ['-B', join(VENDOR, 'toy', 'ed25519.py')],
  { cwd: baseline.cwd, encoding: 'utf8' });
check('the vendored Ed25519 reproduces RFC 8032 TEST 1 in its own self-test',
  selftest.status === 0 && `${selftest.stdout}`.includes('RFC 8032 TEST 1 ok'),
  `${selftest.stdout ?? ''}${selftest.stderr ?? ''}`.trim().split('\n').slice(-1)[0] ?? '');
check('CONSISTENCY is UNCHECKED: a head without a retained/presented pair is not a pair',
  baseline.stdout.includes('CONSISTENCY: CONSISTENCY_UNCHECKED'));
check('the wrapper says so itself before the court speaks, with the head it read',
  /^CONSISTENCY_UNCHECKED$/m.test(baseline.stdout)
  && baseline.stdout.includes(JSON.parse(readFileSync(RECEIPT, 'utf8')).aura.head),
  'the wrapper printed no CONSISTENCY_UNCHECKED notice naming the head');
check('ATTENDANCE is reported-not-proven, never proven',
  baseline.stdout.includes('ATTENDANCE: reported-not-proven'));

// The fixture's real verdict strings, measured by running it — not guessed. Upstream
// derives the class; a toy with no owner keys cannot print CONFORMING.
check('the live-class fixture is attributed, not crowned: unattributed / NON-CONFORMING',
  baseline.stdout.includes('CLASS: unattributed')
  && baseline.stdout.includes('CONFORMANCE: NON-CONFORMING'),
  baseline.lines.filter((l) => l.startsWith('CLASS') || l.startsWith('CONFORMANCE')).join(' '));

// 2. The fixture the test verifies is the fixture the manifest pins. The pin checker
// enforces presence for these paths and reports the digests in its `fixtures` block; this
// is where those two recorded digests are actually enforced against the bytes.
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const pinnedFixtures = manifest.fixtures ?? [];
const fixtureRows = pinnedFixtures.map((entry) => {
  const raw = readFileSync(join(VENDOR, entry.path));
  const digest = createHash('sha256').update(raw).digest('hex');
  return { path: entry.path, ok: digest === entry.sha256 && raw.length === entry.bytes, digest };
});
check('the committed fixture bytes match the digests recorded in upstream-receipt-v3.json',
  fixtureRows.length === 2 && fixtureRows.every((row) => row.ok),
  fixtureRows.map((row) => `${row.path} ${row.digest}`).join(' '));

// 3. One flipped byte must fail. The flip lands inside the signature, so the JSON stays
// well-formed, every closed field still parses, and the signature is what refuses it. The
// delta is measured rather than asserted by hand: re-serialising the fixture must cost
// exactly one byte of difference, or this control is testing something else.
const committedRaw = readFileSync(RECEIPT);
const flipped = fixtureCopy((raw) => {
  const document = JSON.parse(raw.toString('utf8'));
  document.sig = (document.sig[0] === '0' ? '1' : '0') + document.sig.slice(1);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
});
const mutatedRaw = readFileSync(flipped.receipt);
const byteDiffs = mutatedRaw.length === committedRaw.length
  ? committedRaw.reduce((n, byte, i) => n + (byte === mutatedRaw[i] ? 0 : 1), 0)
  : -1;
check('the mutation flips exactly one byte of the receipt and nothing else',
  byteDiffs === 1, `${byteDiffs} byte(s) differ`);
const flippedRun = stranger([flipped.receipt, '--pub', flipped.pub]);
check('one flipped byte of the receipt is refused', flippedRun.code !== 0,
  `exit ${flippedRun.code}`);
check('the refusal is the signature itself, and no verdict is printed',
  flippedRun.stderr.includes('FAIL: signature') && !hasVerdict(flippedRun.stdout),
  flippedRun.stderr.trim());

// 4. A public key that does not match must fail even though it is valid hex.
const wrongPub = fixtureCopy();
writeFileSync(wrongPub.pub, `${'ab'.repeat(32)}\n`);
const wrongRun = stranger([wrongPub.receipt, '--pub', wrongPub.pub]);
check('a non-matching public key is refused', wrongRun.code !== 0, `exit ${wrongRun.code}`);
check('the refusal names the key mismatch, and no verdict is printed',
  wrongRun.stderr.includes('FAIL: issuerPk mismatch') && !hasVerdict(wrongRun.stdout),
  wrongRun.stderr.trim());
check('the same receipt still passes under its own key (the control for the control)',
  stranger([wrongPub.receipt, '--pub', PUB]).code === 0);

// 5. Identity injection. A forged owner/identity/did field is refused by name, before any
// signature work, and never becomes permission. Exact texts measured, not guessed.
for (const field of ['owner', 'identity', 'did']) {
  const forged = fixtureCopy((raw) => withField(raw, field, 'a stranger claiming to be the owner'));
  const forgedRun = stranger([forged.receipt, '--pub', forged.pub]);
  check(`a forged ${field} field is refused by name`, forgedRun.code !== 0
    && forgedRun.stderr.includes(`FAIL: identity field refused: ${field}`)
    && !hasVerdict(forgedRun.stdout),
  forgedRun.stderr.trim().split('\n').slice(-1)[0] ?? `exit ${forgedRun.code}`);
}

// 6. Missing inputs fail; they never skip into a silent pass.
const absent = stranger([join(tmpdir(), 'receipt-v3-does-not-exist.json'), '--pub', PUB]);
check('a missing receipt fails rather than skipping', absent.code !== 0 && !hasVerdict(absent.output),
  `exit ${absent.code}, verdict printed: ${hasVerdict(absent.output)}`);
const absentPub = stranger([RECEIPT, '--pub', join(tmpdir(), 'receipt-v3-no-such.pk')]);
check('a missing public key fails rather than skipping',
  absentPub.code !== 0 && !hasVerdict(absentPub.output),
  `exit ${absentPub.code}, verdict printed: ${hasVerdict(absentPub.output)}`);

// 7. The other court. Phase 0 decides consistency, and it is a different court reached as
// a separate process — the committed vectors earn APPEND_ONLY there.
const paired = stranger([RECEIPT, '--pub', PUB, '--pair',
  join(PHASE0_VECTORS, 'retained.json'), join(PHASE0_VECTORS, 'append-only.json')]);
check('with --pair the Phase 0 court decides consistency in its own process',
  paired.code === 0 && paired.stdout.includes('VERDICT: APPEND_ONLY')
  && paired.stdout.includes(join('vendor', 'append-only', 'verify.py')),
  `exit ${paired.code}: ${paired.stdout.split('\n').filter((l) => l.startsWith('VERDICT') || l.startsWith('FAIL')).join(' ')}`);

console.log();
if (failures > 0) {
  console.log(`RECEIPT V3 STRANGER TEST: FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log(`RECEIPT V3 STRANGER TEST: all checks passed (${baselines.length} stranger run from an empty directory)`);
console.log('The fixture is upstream-produced data, the refusals are negative controls, and the');
console.log('consistency question is answered by Phase 0 or declared unchecked — never by this court.');
