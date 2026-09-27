#!/usr/bin/env node
/**
 * Genesis B1 consumer check: verify the built upstream tree against the
 * build-produced artifact record and the committed pins.
 *
 * Usage:
 *   node scripts/genesis-check.mjs --brick B1 --checkpoint build
 *   node scripts/genesis-check.mjs --brick B1 --checkpoint build --mutate
 *   node scripts/genesis-check.mjs --brick B1 --checkpoint build --source <release-root>
 *
 * `--mutate` runs disposable negative controls: a faithful copy of the covered
 * state is materialized under the system temporary directory, each arm breaks
 * one invariant there, and the verifier must fail for the expected reason. The
 * real built tree, the running release and private state are never mutated.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { COVERAGE_DECLARATION_PATH, aggregateDigest, loadCoverage, sha256Buffer, verifyArtifacts } from './lib/artifact-integrity.mjs';

const args = process.argv.slice(2);
const has = name => args.includes(name);
const option = name => (has(name) ? args[args.indexOf(name) + 1] : undefined);

if (!has('--brick') || option('--brick') !== 'B1' || !has('--checkpoint') || option('--checkpoint') !== 'build') {
  console.error('acceptance-incomplete: use --brick B1 --checkpoint build for keyless build checks; full B1 requires live model/tool evidence and owner/review gates');
  process.exit(1);
}

const genesisRoot = fileURLToPath(new URL('../', import.meta.url));
let coverage;
try {
  coverage = loadCoverage(genesisRoot);
} catch (error) {
  console.error(`FAIL coverage declaration: ${error.message}`);
  process.exit(1);
}
const source = resolve(genesisRoot, option('--source') ?? coverage.value.source);
const recordPath = resolve(source, coverage.value.record);

/** Flip one byte in the middle of a file inside a disposable copy. */
function flipByte(root, relative) {
  const path = join(root, relative);
  const original = readFileSync(path);
  const mutated = Buffer.from(original);
  const index = Math.floor(mutated.length / 2);
  mutated[index] = mutated[index] ^ 0xff;
  if (mutated.equals(original)) throw new Error(`arm-not-applied: ${relative}`);
  writeFileSync(path, mutated);
  return () => writeFileSync(path, original);
}

/** Replace one copy of a file and return the restore step. */
function rewrite(root, relative, content) {
  const path = join(root, relative);
  const original = existsSync(path) ? readFileSync(path) : undefined;
  writeFileSync(path, content);
  return () => {
    if (original === undefined) rmSync(path, { force: true });
    else writeFileSync(path, original);
  };
}

function readRecord(root) {
  return JSON.parse(readFileSync(join(root, coverage.value.record), 'utf8'));
}

/** Recompute every recorded digest from the copy so a tamper stays self-consistent. */
function resealRecord(root, record) {
  for (const entry of record.entries) {
    const absolute = join(root, entry.path);
    const bytes = readFileSync(absolute);
    entry.bytes = bytes.byteLength;
    entry.sha256 = sha256Buffer(bytes);
  }
  record.requiredEntries = record.requiredEntries.map(entry => ({
    ...entry,
    sha256: sha256Buffer(readFileSync(join(root, entry.path))),
  }));
  record.host.sha256 = aggregateDigest(root, record.entries.map(entry => entry.path));
  return record;
}

function materializeArmRoot(reference) {
  const armRoot = mkdtempSync(join(tmpdir(), 'genesis-b1-arms-'));
  const copy = relative => {
    const destination = join(armRoot, relative);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(source, relative), destination);
  };
  for (const entry of reference.entries) copy(entry.path);
  copy(coverage.value.record);
  copy(coverage.value.upstreamClientRecord);
  copy(coverage.value.sourceLockfile);
  if (reference.strip !== undefined) copy(coverage.value.strip.manifest);
  return armRoot;
}

/** Copy the strip manifest back into an arm root after an arm removed it. */
function restoreStripManifest(armRoot) {
  const destination = join(armRoot, coverage.value.strip.manifest);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(resolve(source, coverage.value.strip.manifest), destination);
}

/** Arms: name, expected outcome, expected failure code, and the mutation to apply. */
function armDefinitions(reference) {
  const covered = reference.entries.map(entry => entry.path);
  const required = new Set(reference.requiredEntries.map(entry => entry.path));
  const plain = covered.find(path => !required.has(path) && !path.startsWith('apps/web/dist/'));
  if (plain === undefined) throw new Error('arm-target-unavailable: no non-required covered artifact to delete');
  // A build tree carries no strip manifest and no strip attestation, so the strip arms
  // only exist where the invariant does: on a materialized release. CI runs this check
  // against both, so the arms are exercised rather than skipped.
  const stripArms = reference.strip === undefined ? [] : [
    {
      name: 'release-translation-twin-left-behind',
      expect: 'fail',
      codes: ['strip-violation'],
      apply: root => {
        const path = join(root, 'docs', 'arm-leftover.zh.md');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, '# mutation arm: one translation twin left in the release\n');
        return () => rmSync(path, { force: true });
      },
    },
    {
      name: 'strip-manifest-deleted',
      expect: 'fail',
      codes: ['strip-manifest-missing'],
      apply: root => {
        rmSync(join(root, coverage.value.strip.manifest), { force: true });
        return () => restoreStripManifest(root);
      },
    },
    {
      name: 'strip-manifest-tampered',
      expect: 'fail',
      codes: ['strip-manifest-changed'],
      apply: root => {
        const path = join(root, coverage.value.strip.manifest);
        const original = readFileSync(path);
        const tampered = JSON.parse(original.toString('utf8'));
        tampered.deleted = [];
        writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`);
        return () => writeFileSync(path, original);
      },
    },
  ];
  return [
    { name: 'clean-control', expect: 'pass' },
    {
      name: 'executable-byte-flip',
      expect: 'fail',
      codes: ['changed-artifact'],
      apply: root => flipByte(root, 'apps/cli/lib/bin.js'),
    },
    {
      name: 'browser-byte-flip',
      expect: 'fail',
      codes: ['changed-artifact'],
      apply: root => flipByte(root, 'apps/web/dist/index.html'),
    },
    {
      name: 'vendored-cordis-byte-flip',
      expect: 'fail',
      codes: ['changed-artifact'],
      apply: root => flipByte(root, 'vendor/cordis/lib/index.js'),
    },
    {
      name: 'covered-file-deleted',
      expect: 'fail',
      codes: ['missing-artifact'],
      apply: root => {
        rmSync(join(root, plain));
        return () => cpSync(resolve(source, plain), join(root, plain));
      },
    },
    {
      name: 'required-entry-deleted',
      expect: 'fail',
      codes: ['missing-artifact', 'required-entry-missing'],
      apply: root => {
        rmSync(join(root, 'apps/cli/lib/bin.js'));
        return () => cpSync(resolve(source, 'apps/cli/lib/bin.js'), join(root, 'apps/cli/lib/bin.js'));
      },
    },
    {
      name: 'record-coverage-shrunk',
      expect: 'fail',
      codes: ['record-coverage-set-mismatch'],
      apply: root => {
        const record = readRecord(root);
        record.entries = record.entries.filter(entry => entry.path !== plain);
        return rewrite(root, coverage.value.record, `${JSON.stringify(record, null, 2)}\n`);
      },
    },
    {
      name: 'self-consistent-record-rewrite',
      expect: 'fail',
      codes: ['upstream-client-record-mismatch', 'client-face-mismatch'],
      apply: root => {
        const revertByte = flipByte(root, 'apps/web/dist/index.html');
        const resealed = resealRecord(root, readRecord(root));
        const revertRecord = rewrite(root, coverage.value.record, `${JSON.stringify(resealed, null, 2)}\n`);
        return () => {
          revertRecord();
          revertByte();
        };
      },
    },
    {
      name: 'upstream-client-record-forged',
      expect: 'fail',
      codes: ['upstream-client-record-changed', 'upstream-client-record-mismatch'],
      apply: root => {
        const upstream = JSON.parse(readFileSync(join(root, coverage.value.upstreamClientRecord), 'utf8'));
        upstream.artifacts.sha256 = '0'.repeat(64);
        return rewrite(root, coverage.value.upstreamClientRecord, `${JSON.stringify(upstream, null, 2)}\n`);
      },
    },
    {
      name: 'source-lockfile-mutated',
      expect: 'fail',
      codes: ['source-lockfile-mismatch'],
      apply: root => {
        const lockfile = join(root, coverage.value.sourceLockfile);
        const original = readFileSync(lockfile);
        writeFileSync(lockfile, Buffer.concat([original, Buffer.from('\n# mutation arm: dependency input changed on disk\n')]));
        return () => writeFileSync(lockfile, original);
      },
    },
    {
      name: 'record-schema-broken',
      expect: 'fail',
      codes: ['record-schema'],
      apply: root => {
        const record = readRecord(root);
        record.formatVersion = 99;
        return rewrite(root, coverage.value.record, `${JSON.stringify(record, null, 2)}\n`);
      },
    },
    {
      name: 'foundation-bundle-mutated',
      expect: 'fail',
      codes: ['genesis-artifact-changed'],
      apply: () => {
        // The foundation tree is verified against the Genesis root, so this arm
        // runs the same verifier against a disposable copy of it rather than
        // touching the real checkout.
        const genesisArm = copyGenesisInputs(mkdtempSync(join(tmpdir(), 'genesis-arm-root-')), reference);
        const revertByte = flipByte(genesisArm, 'plugins/aukora-foundation/lib/client.js');
        return {
          genesisRoot: genesisArm,
          revert: () => {
            revertByte();
            rmSync(genesisArm, { recursive: true, force: true });
          },
        };
      },
    },
    {
      name: 'record-deleted',
      expect: 'fail',
      codes: ['record-missing'],
      apply: root => {
        rmSync(join(root, coverage.value.record), { force: true });
        return () => cpSync(recordPath, join(root, coverage.value.record));
      },
    },
    {
      name: 'record-pin-drift',
      expect: 'fail',
      codes: ['pin-mismatch'],
      apply: root => {
        const record = readRecord(root);
        record.upstream.lockfileSha256 = '0'.repeat(64);
        return rewrite(root, coverage.value.record, `${JSON.stringify(record, null, 2)}\n`);
      },
    },
    {
      name: 'record-declaration-drift',
      expect: 'fail',
      codes: ['coverage-declaration-mismatch'],
      apply: root => {
        const record = readRecord(root);
        record.coverage.declarationSha256 = '0'.repeat(64);
        return rewrite(root, coverage.value.record, `${JSON.stringify(record, null, 2)}\n`);
      },
    },
    ...stripArms,
  ];
}

/** Copy the Genesis-side declared inputs into a disposable root for one arm. */
function copyGenesisInputs(destination, record) {
  const copy = relative => {
    const target = join(destination, relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(genesisRoot, relative), target);
  };
  copy('upstream-dsh.json');
  copy(COVERAGE_DECLARATION_PATH); // already relative to the Genesis root; resolve() would escape the arm root
  for (const entry of record.genesis?.entries ?? []) copy(entry.path);
  return destination;
}

function runArms() {
  const reference = verifyArtifacts({ genesisRoot, source });
  if (!reference.ok) {
    console.error('arms-require-verified-tree: fix the normal check before mutation evidence can be claimed');
    for (const failure of reference.failures) console.error(`  ${failure}`);
    return 1;
  }
  const record = readRecord(source);
  let armRoot;
  let arms;
  let missed = 0;
  let detected = 0;
  let controls = 0;
  try {
    try {
      armRoot = materializeArmRoot(record);
      arms = armDefinitions(record);
    } catch (error) {
      console.error(`arms-unavailable: ${error.message}`);
      return 1;
    }
    for (const arm of arms) {
      let revert;
      let observed;
      let codes = [];
      let armGenesisRoot = genesisRoot;
      try {
        const applied = arm.apply?.(armRoot);
        if (typeof applied === 'function') revert = applied;
        else if (applied !== undefined && applied !== null) {
          revert = applied.revert;
          if (applied.genesisRoot !== undefined) armGenesisRoot = applied.genesisRoot;
        }
        // An arm root is a partial copy of the covered state, so whole-tree totals are
        // not applicable here; every other invariant, the strip included, still is.
        const result = verifyArtifacts({ genesisRoot: armGenesisRoot, source: armRoot, recordPath: join(armRoot, coverage.value.record), partial: true });
        observed = result.ok ? 'pass' : 'fail';
        codes = result.failures.map(failure => failure.split(':')[0]);
      } catch (error) {
        observed = `error(${error.message})`;
      } finally {
        if (revert !== undefined) revert();
      }
      const wanted = arm.expect === 'fail' ? `fail(${(arm.codes ?? []).join('|')})` : 'pass';
      const matched = arm.expect === 'pass' ? observed === 'pass' : observed === 'fail' && (arm.codes ?? []).some(code => codes.includes(code));
      if (matched && arm.expect === 'pass') controls += 1;
      else if (matched) detected += 1;
      else missed += 1;
      const observedLabel = observed === 'fail' ? `fail[${codes.join(',') || 'none'}]` : observed;
      const reason = arm.expect === 'fail' && observed === 'fail' && !matched ? 'WRONG-REASON' : matched ? 'OK' : 'MISSED';
      console.log(`ARM ${arm.name} expect=${wanted} observed=${observedLabel} result=${reason}`);
    }
  } finally {
    if (armRoot !== undefined) rmSync(armRoot, { recursive: true, force: true });
  }
  if (arms.length === 0) {
    console.error('NO ARMS: structural mutation coverage=0; refusing to report mutation evidence');
    return 1;
  }
  const summary = `MUTATION ARMS: ${String(arms.length)} run, ${String(detected)} negative arm(s) detected, ${String(controls)} control passed, ${String(missed)} missed`;
  console.log(summary);
  if (missed > 0) {
    console.error(`mutation-evidence-invalid: ${String(missed)} arm(s) were not detected as expected`);
    return 1;
  }
  return 0;
}

if (has('--mutate')) {
  process.exit(runArms());
}

const result = verifyArtifacts({ genesisRoot, source });
if (!result.ok) {
  console.error(`FAIL artifact integrity at ${source} (record ${coverage.value.record})`);
  for (const failure of result.failures) console.error(`  ${failure}`);
  process.exit(1);
}
const { summary } = result;
console.log(
  `KEYLESS BUILD PASS upstream=${summary.upstreamCommit} genesis=${summary.genesisCommit} record=${summary.recordSha256} host=${summary.host.sha256} (${String(summary.host.fileCount)} files, ${String(summary.host.bytes)} bytes) client=${summary.client.sha256} (${String(summary.client.fileCount)} files)`,
);
if (summary.genesis !== undefined) {
  console.log(`foundation coverage: ${String(summary.genesis.fileCount)} file(s) in the Genesis tree, digest ${summary.genesis.sha256}`);
}
if (summary.strip === undefined) {
  console.log(`strip: not applied — ${source} is a build tree, not a materialized release`);
} else {
  console.log(`strip: ${String(summary.strip.deletedFiles)} file(s)/${String(summary.strip.deletedBytes)} bytes removed; manifest ${summary.strip.manifest} sha256 ${summary.strip.sha256}`);
  console.log(`strip totals now: ${String(summary.strip.totals.files)} file(s), ${String(summary.strip.totals.bytes)} bytes`);
  console.log(`kept by runtime reference (${String(summary.strip.keptByRule.length)}): ${summary.strip.keptByRule.join(', ') || 'none'}`);
}
console.log(`coverage: ${String(coverage.value.hostPatterns.length)} host pattern(s) at ${source}; excluded ${coverage.value.excluded.join(', ')}`);
console.log('uncovered dynamic inputs (declared, not measured by this check):');
for (const input of coverage.value.uncoveredInputs) console.log(`  - ${input}`);
console.log('limits of this evidence:');
for (const limit of coverage.value.limits) console.log(`  - ${limit}`);
console.log('full B1 acceptance remains pending: live model/tool evidence, review, merge and owner activation are separate gates');
