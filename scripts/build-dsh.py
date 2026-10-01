#!/usr/bin/env python3
"""Reproduce the pinned upstream build, then apply Aukora's own named patches to it.

THREE REVISIONS, NEVER ONE REPORTED AS ANOTHER:

* the **pinned archive** — `vendor/dsh-source.tar.gz` must hash to `upstream-dsh.json.archiveSha256`;
* the **pristine extraction** — every file must be byte-identical to the archive, so a hand-edited
  tree is refused instead of silently inheriting the upstream pin;
* the **built tree** — the pristine tree plus the patch layer plus the build.

THE PATCH LAYER IS THE ONLY SANCTIONED DIFFERENCE FROM UPSTREAM. `patches/*.patch.json`, each hashed
and named in `upstream-dsh.json` under `localPatches`, is applied to the verified tree **as part of
the build**. What Aukora changed, and why, is therefore constructed and legible rather than a mystery
fork or a hand edit that the next re-materialize erases. A patch that does not apply exactly FAILS
THE BUILD (`patch-find-missing`, `patch-find-ambiguous`, `patch-file-drift`, `patch-pin-mismatch`,
`patch-expect-missing`); nothing here is best-effort and nothing is skipped.

Usage:
    python3 scripts/build-dsh.py                      # the supported build
    python3 scripts/build-dsh.py --patches-only       # apply+verify the patch layer, no build
    python3 scripts/build-dsh.py --root <dir>         # operate on another checkout root (tests)
    python3 scripts/build-dsh.py --verify-built       # read-only release prerequisite
"""
import argparse, contextlib, hashlib, json, os, subprocess, tarfile, urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description='Reproduce the pinned upstream build plus the Aukora patch layer.')
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1],
                    help='checkout root holding upstream-dsh.json, patches/ and vendor/ (default: this checkout)')
parser.add_argument('--patches-only', action='store_true',
                    help='verify the pin, extract if missing, apply and verify the patch layer, then STOP '
                         'before install/build/record. For patch-layer tests and divergence checks.')
parser.add_argument('--phase', choices=['all', 'apply', 'build'], default=None,
                    help='which expectation phase the patch layer checks: all (the build), apply (the '
                         'patched files), or build (the built artifacts). Defaults to all for a build and '
                         'to apply for --patches-only, whose tree has no built artifacts yet. The court '
                         'uses the explicit phases to exercise each gate on its own.')
parser.add_argument('--skip-pristine', action='store_true',
                    help='skip the pristine-tree comparison. The court uses it to reach the build-phase '
                         'expectation gate on a tree it pre-patched; the supported build never skips it.')
parser.add_argument('--verify-built', action='store_true',
                    help='read-only: require a successful build bound to this archive and complete patch set')
parser.add_argument('--source', type=Path, help='built tree to check with --verify-built')
args = parser.parse_args()
if args.verify_built and (args.patches_only or args.phase or args.skip_pristine):
    parser.error('--verify-built cannot be combined with build/patch phase options')
if args.source and not args.verify_built:
    parser.error('--source requires --verify-built')

root = args.root.resolve()
pin = json.loads((root / 'upstream-dsh.json').read_text())
archive = root / 'vendor/dsh-source.tar.gz'
source = args.source.resolve() if args.source else root / 'vendor/dsh'
patch_dir = root / 'patches'
binding_path = source / '.dsh-build/pinned-harness-build.json'


def sha256_file(path: Path) -> str:
    """Digest one file, or refuse rather than invent a value for a missing one."""
    if not path.is_file():
        raise SystemExit(f'patch-file-missing: {path}')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_patches() -> list[dict]:
    """Read `patches/*.patch.json` in filename order and bind each one to the pin.

    The pin is the legible record of what Aukora changed and why: every applied patch must appear in
    `localPatches` with its exact digest and reason, and no entry may name a patch that is not on
    disk. A patch edited without re-pinning therefore fails the build instead of changing the release
    quietly, and the set of differences from upstream is exactly the set a reader can enumerate.
    """
    declared = pin.get('localPatches', [])
    if not isinstance(declared, list):
        raise SystemExit('patch-pin-invalid: upstream-dsh.json localPatches must be a list')
    by_file: dict[str, dict] = {}
    for entry in declared:
        if not isinstance(entry, dict) or not all(k in entry for k in ('file', 'sha256', 'reason')):
            raise SystemExit('patch-pin-invalid: every localPatches entry needs file, sha256 and reason')
        if not isinstance(entry['file'], str) or entry['file'] in by_file:
            raise SystemExit('patch-pin-invalid: localPatches must name distinct patch files')
        by_file[entry['file']] = entry
    patches = []
    for path in sorted(patch_dir.glob('*.patch.json')):
        relative = f'patches/{path.name}'
        entry = by_file.get(relative)
        if entry is None:
            raise SystemExit(f'patch-unpinned: {relative} is not recorded in localPatches')
        digest = sha256_file(path)
        if digest != entry['sha256']:
            raise SystemExit(
                f'patch-file-drift: {relative} is {digest} but localPatches records {entry["sha256"]}')
        try:
            spec = json.loads(path.read_text())
        except json.JSONDecodeError as error:
            raise SystemExit(f'patch-invalid-json: {relative}: {error}')
        if spec.get('formatVersion') != 1 or not isinstance(spec.get('edits'), list) or not spec['edits']:
            raise SystemExit(f'patch-invalid: {relative} needs formatVersion 1 and a non-empty edits list')
        if not isinstance(spec.get('reason'), str) or not spec['reason'].strip():
            raise SystemExit(f'patch-invalid: {relative} needs a reason a reader can act on')
        if spec['reason'] != entry['reason']:
            raise SystemExit(f'patch-reason-drift: {relative} reason differs from localPatches')
        patches.append({'file': relative, 'sha256': digest, 'spec': spec})
    for relative in by_file:
        if relative not in {patch['file'] for patch in patches}:
            raise SystemExit(f'patch-pin-mismatch: localPatches names {relative}, which is not an applied patch')
    return patches


def apply_patches(patches: list[dict]) -> list[dict]:
    """Apply every edit in order; a patch that cannot be applied exactly stops the build."""
    applied = []
    for patch in patches:
        relative_patch = patch['file']
        spec = patch['spec']
        buffers: dict[str, str] = {}
        for index, edit in enumerate(spec['edits']):
            for key in ('path', 'find', 'replace'):
                if not isinstance(edit.get(key), str) or edit[key] == '':
                    raise SystemExit(f'patch-invalid: {relative_patch} edit {index} needs a non-empty {key}')
            expected = edit.get('occurrences', 1)
            if not isinstance(expected, int) or expected < 1:
                raise SystemExit(
                    f'patch-invalid: {relative_patch} edit {index} occurrences must be a positive integer')
            target = source / edit['path']
            if edit['path'] not in buffers:
                if not target.is_file():
                    raise SystemExit(f'patch-target-missing: {relative_patch} names {edit["path"]}')
                buffers[edit['path']] = target.read_text()
            text = buffers[edit['path']]
            found = text.count(edit['find'])
            if found != expected:
                kind = 'patch-find-missing' if found == 0 else 'patch-find-ambiguous'
                raise SystemExit(
                    f'{kind}: {relative_patch} edit {index} matched {found} of {expected} occurrence(s) in '
                    f'{edit["path"]}; the patch and the pinned tree have diverged')
            buffers[edit['path']] = text.replace(edit['find'], edit['replace'])
        for path, text in buffers.items():
            (source / path).write_text(text)
        applied.append({'file': relative_patch, 'sha256': patch['sha256'], 'reason': spec['reason'],
                        'edits': len(spec['edits'])})
        print(f"patch: applied {relative_patch} ({patch['sha256'][:12]}, {len(spec['edits'])} edit(s))")
    return applied


def verify_expectations(patches: list[dict], phase: str) -> None:
    """Check a patch's own claims about the tree, in one named phase.

    `expectAfterApply` is checked immediately after the edits land (they name the patched files);
    `expectAfterBuild` is checked after the build (they name artifacts the build produces). A claim
    that is false stops the build with `patch-expect-missing` rather than shipping a release whose
    bytes silently lack the patch — the failure mode this layer exists to make impossible.
    """
    key = 'expectAfterApply' if phase == 'apply' else 'expectAfterBuild'
    for patch in patches:
        for index, expectation in enumerate(patch['spec'].get(key, [])):
            relative = expectation.get('path')
            contains = expectation.get('contains')
            if not isinstance(relative, str) or not isinstance(contains, str) or contains == '':
                raise SystemExit(f'patch-invalid: {patch["file"]} {key} {index} needs path and contains')
            target = source / relative
            if not target.is_file() or contains not in target.read_text():
                raise SystemExit(
                    f'patch-expect-missing: {patch["file"]} requires {contains!r} in {relative} after the '
                    f'{phase}; the patch did not reach the bytes it claims')
            print(f"patch: verified {patch['file']} reached {relative} ({phase})")


def build_inputs(patches: list[dict]) -> dict:
    return {'upstream': {key: pin[key] for key in
                        ('commit', 'archiveSha256', 'lockfileSha256', 'packageManager')},
            'localPatches': [{'file': patch['file'], 'sha256': patch['sha256']} for patch in patches]}


def verify_built(patches: list[dict]) -> None:
    """Presence of patched source is not proof of compiled output: require the post-build receipt.

    The receipt is local build provenance, not an attestation against a malicious same-UID writer.
    Foundation/face edits do not change harness inputs; validate the harness inventory independently
    of the record's Genesis inventory, which the release materializer regenerates for its own commit.
    """
    try:
        binding = json.loads(binding_path.read_text())
    except (OSError, ValueError) as error:
        raise SystemExit(f'harness-patch-set-mismatch: missing/invalid successful build provenance: {error}')
    if (not isinstance(binding, dict) or binding.get('formatVersion') != 1
            or binding.get('kind') != 'pinned-harness-build' or binding.get('inputs') != build_inputs(patches)):
        raise SystemExit('harness-patch-set-mismatch: built archive/patch set differs from this checkout; rebuild')
    # Reuse the committed coverage semantics, including the upstream client build record. An empty,
    # truncated, changed or incomplete inventory cannot turn a receipt into proof of a current build.
    check = r'''
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, source, bindingPath] = process.argv.slice(1);
const { loadCoverage, coveredPaths, aggregateDigest, readUpstreamClientRecord, sha256File } =
  await import(pathToFileURL(resolve(root, 'scripts/lib/artifact-integrity.mjs')));
const fail = (kind, message) => { throw new Error(`${kind}: ${message}`); };
try {
  const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
  const coverage = loadCoverage(root);
  const recordPath = resolve(source, coverage.value.record);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (sha256File(recordPath) !== binding.artifactRecordSha256)
    fail('harness-build-record-mismatch', 'inventory differs from the successful build receipt');
  if (record?.formatVersion !== 1 || record?.kind !== 'genesis-artifact-record')
    fail('harness-build-record-invalid', 'unknown inventory format');
  const paths = coveredPaths(source, coverage.value.hostPatterns, coverage.value.excluded);
  const entries = record.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length !== binding.artifactCount
      || record.host?.fileCount !== entries.length || paths.length !== entries.length)
    fail('harness-build-record-incomplete', 'compiled inventory missing or count differs');
  const byPath = new Map(entries.map(entry => [entry?.path, entry]));
  if (byPath.size !== entries.length || paths.some(path => !byPath.has(path))
      || coverage.value.requiredEntries.some(path => !byPath.has(path))
      || record.coverage?.declarationSha256 !== coverage.sha256)
    fail('harness-build-record-incomplete', 'required/covered compiled files differ');
  for (const key of ['commit', 'archiveSha256', 'lockfileSha256'])
    if (record.upstream?.[key] !== binding.inputs.upstream[key])
      fail('harness-build-record-mismatch', `upstream.${key} differs`);
  for (const path of paths) {
    const entry = byPath.get(path), absolute = resolve(source, path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0
        || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))
      fail('harness-build-record-invalid', `invalid inventory entry ${path}`);
    if (statSync(absolute).size !== entry.bytes || sha256File(absolute) !== entry.sha256)
      fail('harness-built-artifact-mismatch', path);
  }
  if (aggregateDigest(source, paths) !== record.host.sha256)
    fail('harness-built-artifact-mismatch', 'host aggregate differs');
  const client = readUpstreamClientRecord(source, coverage.value.upstreamClientRecord);
  const clientPaths = coveredPaths(source, coverage.value.clientPatterns, coverage.value.excluded);
  const clientDigest = aggregateDigest(source, clientPaths);
  if (client.sha256 !== record.clientFace?.upstreamRecordSha256
      || clientDigest !== client.digest || clientPaths.length !== client.fileCount
      || clientDigest !== record.clientFace?.sha256 || clientPaths.length !== record.clientFace?.fileCount)
    fail('harness-built-artifact-mismatch', 'client build inventory differs');
  console.log(`harness-build-binding: verified ${paths.length} artifacts; ${binding.inputs.localPatches.length} pinned patches`);
} catch (error) {
  console.error(error.message.startsWith('harness-') ? error.message : `harness-build-record-invalid: ${error.message}`);
  process.exit(1);
}
'''
    checked = subprocess.run(['node', '--input-type=module', '-e', check, str(root), str(source), str(binding_path)])
    if checked.returncode:
        raise SystemExit(checked.returncode)
    lock = source / 'pnpm-lock.yaml'
    if not lock.is_file() or sha256_file(lock) != pin['lockfileSha256']:
        raise SystemExit('harness-lock-mismatch: built tree differs from pinned dependency inputs')
    verify_expectations(patches, 'build')


# Invalidate success BEFORE any attempted mutation, including a failed/partial patches-only run.
if not args.verify_built:
    binding_path.unlink(missing_ok=True)
patches = load_patches()
if args.verify_built:
    verify_built(patches)
    raise SystemExit(0)
archive.parent.mkdir(exist_ok=True)
if not archive.exists():
    with urllib.request.urlopen(pin['archiveUrl'], timeout=60) as response:
        archive.write_bytes(response.read())
if hashlib.sha256(archive.read_bytes()).hexdigest() != pin['archiveSha256']:
    raise SystemExit('source-digest-mismatch: retain archive and inspect provenance before retrying')
if not source.exists():
    source.mkdir()
    subprocess.run(['tar', '-xzf', str(archive), '--strip-components=1', '-C', str(source)], check=True)
# A hand-edited tree cannot inherit the archive pin. Only existing court phase checks skip this.
if not args.skip_pristine:
    with tarfile.open(archive) as snapshot:
        for member in snapshot.getmembers():
            relative = Path(*Path(member.name).parts[1:])
            if member.isfile() and (source / relative).read_bytes() != snapshot.extractfile(member).read():
                raise SystemExit(f'source-file-mismatch: inspect {relative} before building')
phase = args.phase if args.phase is not None else ('apply' if args.patches_only else 'all')
if hashlib.sha256((source / 'pnpm-lock.yaml').read_bytes()).hexdigest() != pin['lockfileSha256']:
    raise SystemExit('lockfile-digest-mismatch: restore the pinned dependency inputs')
# `--phase build` checks the built artifacts and does not touch the tree: that is the seam the court
# uses to exercise the build-phase gate on a hand-made artifact.
applied = [] if phase == 'build' else apply_patches(patches)
if phase in ('all', 'apply'):
    verify_expectations(patches, 'apply')
if args.patches_only:
    if phase in ('all', 'build'):
        verify_expectations(patches, 'build')
    print(f"patches-only: {len(applied)} patch(es) applied; expectations checked for phase '{phase}'; "
          'no install, build or record was run')
    raise SystemExit(0)
env = {**os.environ, 'CI': 'true', 'LEFTHOOK': '0', 'DSH_CLIENT_TITLE': 'AUKORA'}
# NO FACE OVERLAY IS STASHED HERE, AND THAT IS THE POINT. `build-face.py` copies the Aukora faces
# into ITS OWN overlay clone (`.runtime/face-build`), where it also adds the client-solution
# references they need, so the pinned tree never sees them. An earlier revision of this file moved
# `packages/client/aukora-face-*` aside around this install because they broke
# `--frozen-lockfile`; that is now unnecessary and was removed, because a tree that needs a stash
# to install is a tree whose inputs are wrong. If a face package is ever found here again, the
# build should be understood as running against a dirty checkout, not quietly repaired.
subprocess.run(['pnpm', 'install', '--frozen-lockfile'], cwd=source, env=env, check=True)
subprocess.run(['pnpm', 'run', 'build'], cwd=source, env=env, check=True)
if phase in ('all', 'build'):
    verify_expectations(patches, 'build')
# Record the built bytes; the check consumes this record and never trusts presence alone.
subprocess.run(['node', str(root / 'scripts/artifact-record.mjs'), '--source', str(source)], cwd=root, env=env, check=True)
# A successful full build alone creates provenance. Skipping pristine verification cannot mint it.
if not args.skip_pristine:
    record_path = source / '.dsh-build/genesis-artifacts.json'
    record = json.loads(record_path.read_text())
    binding = {'formatVersion': 1, 'kind': 'pinned-harness-build', 'inputs': build_inputs(patches),
               'artifactRecordSha256': sha256_file(record_path), 'artifactCount': len(record['entries'])}
    temporary = binding_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(binding, indent=2) + '\n')
    temporary.replace(binding_path)
    try:
        verify_built(patches)
    except BaseException:
        binding_path.unlink(missing_ok=True)
        raise
