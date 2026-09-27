#!/usr/bin/env python3
"""The self-contained release: carried lanes and the keeps that are not runtime references.

    python3 scripts/composition/self-contained-release-test.py

WHY THIS EXISTS. A release is a copy of the built application with the authored plugins inside
it. Two kinds of path survive the strip's deletion rules:

  runtime reference  bytes a built runtime NAMES by path (`scripts/gen-*-catalog.ts`), found by
                     grepping the release's own built JS. This is what kept the release honest
                     before the lanes landed.
  declared keep      paths the coverage declaration says must travel with the release, because a
                     lane's TOOLS execute them rather than a runtime naming them
                     (`scripts.aura/**`, `scripts/composition/**`).

The second kind had no mechanism. `scripts/**` is a strip rule, the runtime scan cannot reach a
path no runtime names, and nothing failed when those bytes went missing — so the release silently
stopped carrying the receipt producer and the Aura adapter while the manifest, the record and
every coverage check stayed green. That is the shape of defect this suite pins: the failure has
to be RED, and it has to be red for the right reason.

WHAT EACH ARM ASSERTS, and why each one is needed:

  1. the release carries every declared keep          the positive claim, measured per pattern
  2. the record covers the carried bytes              coverage is not copying: presence alone is
                                                      not integrity, so the record must attest them
  3. a removed declared keep is REFUSED               the control that has to fail. Without it,
                                                      arm 1 could pass on a release that never
                                                      carried anything and nobody would notice
  4. the refusal NAMES that path                      a failure that does not name what it lost
                                                      cannot be diagnosed from the run log
  5. a keep that matches nothing is REFUSED           a rule that does nothing is exactly how the
                                                      original defect hid, so the declaration may
                                                      not contain one
  6. a normal script is still STRIPPED                the keep must not have widened the strip into
                                                      "carry all of scripts/**"

Everything runs on disposable state under the system temporary directory. Nothing here mounts a
plugin, provisions a key, binds an identity or claims succession.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATERIALIZER = ROOT / 'scripts' / 'materialize-aukora-release.py'
CHECKER = ROOT / 'scripts' / 'genesis-check.mjs'
STRIP_CLI = ROOT / 'scripts' / 'release-strip.mjs'
DECLARATION = ROOT / 'scripts' / 'artifacts-coverage.json'

FAILURES = 0
ARMS = 0


def check(name: str, ok: bool, detail: str = '') -> None:
    global FAILURES, ARMS
    ARMS += 1
    if ok:
        print(f'  ok    {name}')
    else:
        FAILURES += 1
        print(f'  FAIL  {name}' + (f' — {detail}' if detail else ''))


def run(command: list[str], cwd: Path | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=str(cwd or ROOT), capture_output=True, text=True,
                          env={**os.environ, **(env or {})})


def main() -> int:
    print('\nself-contained release — declared keeps, coverage, and the arm that must fail\n')

    if not DECLARATION.is_file():
        print(f'  MANDATORY INPUT MISSING: {DECLARATION}')
        return 1

    declaration = json.loads(DECLARATION.read_text(encoding='utf-8'))
    declared = declaration['strip'].get('keep', [])
    if not declared:
        print('  MANDATORY INPUT MISSING: strip.keep declares no keep; this suite has nothing to pin')
        return 1

    work = Path(tempfile.mkdtemp(prefix='self-contained-release-'))
    release = work / 'release'
    try:
        built = run([sys.executable, str(MATERIALIZER), '--to', str(release)])
        if built.returncode != 0 or not release.is_dir():
            print('  MANDATORY INPUT MISSING: the materializer did not produce a release')
            print((built.stderr or built.stdout).strip()[:400])
            return 1

        # ── 1 + 2. carried, and covered ──────────────────────────────────────────────────────
        manifest = json.loads((release / 'strip-manifest.json').read_text(encoding='utf-8'))
        kept = set(manifest.get('kept', []))
        record = json.loads((release / '.dsh-build' / 'genesis-artifacts.json').read_text(encoding='utf-8'))
        covered = {entry['path'] for entry in record.get('host', {}).get('entries', [])}
        if not covered:
            # a build tree records no host face; a materialized release does
            covered = {entry['path'] for entry in record.get('entries', [])}

        for pattern in declared:
            prefix = pattern.rstrip('/*')
            matched = sorted(path for path in kept if path == prefix or path.startswith(f'{prefix}/'))
            check(f'carried: {pattern} ({len(matched)} file(s))', bool(matched),
                  f'nothing under {pattern} survived the strip')
            if matched:
                uncovered = [path for path in matched if path not in covered]
                check(f'covered by the record: {pattern}', not uncovered,
                      f'{len(uncovered)} carried file(s) absent from the record, e.g. {uncovered[:2]}')

        # ── 1b. PER-FILE, not per-directory ──────────────────────────────────────────────────
        # "one file survived under this pattern" is a much weaker claim than "the file this
        # pattern names survived". The control below removes a MIDDLE file — one whose neighbours
        # remain, so any directory-level check still sees a populated directory — and requires the
        # failure to name that exact path. A missing-file rule that only notices an empty
        # directory is the same silent no-op the declared keep exists to prevent.
        required = None
        for path in sorted(covered):
            if path.startswith('scripts/composition/') and path.endswith('.py') and path.count('/') == 2:
                required = path
                break
        check('a specific required module is covered by the record', required is not None,
              'no scripts/composition/*.py is covered; the record does not bind the closure')
        if required is not None:
            present = (release / required).is_file()
            check(f'the release carries {required}', present)

        # ── 3 + 4. the control: a declared keep that goes missing ─────────────────────────────
        sample = None
        for path in sorted(kept):
            if any(path.rstrip('/*').split('/')[0] and path.startswith(p.rstrip('/*')) for p in declared):
                sample = path
                break
        check('the release carries at least one file to remove for the control', sample is not None)

        if sample is not None:
            broken = work / 'broken'
            shutil.copytree(release, broken, symlinks=True)
            (broken / sample).unlink()
            verifier = run(['node', str(CHECKER), '--brick', 'B1', '--checkpoint', 'build',
                            '--source', str(broken)])
            output = f'{verifier.stdout}\n{verifier.stderr}'
            check('a removed declared keep makes the check FAIL', verifier.returncode != 0,
                  'the check passed with a carried file deleted')
            check('and the failure NAMES the missing path', sample in output,
                  f'{sample} not named in: {output.strip()[:200]}')

        # ── 3b. the MIDDLE file, with its neighbours still present ───────────────────────────
        if required is not None:
            hollowed = work / 'hollowed'
            shutil.copytree(release, hollowed, symlinks=True)
            (hollowed / required).unlink()
            siblings = list((hollowed / required).parent.glob('*.py'))
            verifier = run(['node', str(CHECKER), '--brick', 'B1', '--checkpoint', 'build',
                            '--source', str(hollowed)])
            output = f'{verifier.stdout}\n{verifier.stderr}'
            check(f'one missing module among {len(siblings)} survivors still FAILS the check',
                  verifier.returncode != 0,
                  'a populated directory hid a missing covered file')
            check('and it names the module rather than the directory', required in output,
                  f'{required} not named in: {output.strip()[:200]}')

        # ── 1c. the receipt closure imports, from the release's own bytes ────────────────────
        # The closure is not scripts/composition alone: the adapter imports `phase0log` by bare
        # name from scripts/phase0 and `receipt` from vendor/receipt. Imported HERE, with the
        # release's own directories on the path, so a missing member fails rather than being
        # discovered later by a reader trying to verify a receipt they were handed.
        import_probe = (
            'import sys;'
            f'sys.path[:0]=[{str(release / "scripts/composition")!r},{str(release / "scripts/phase0")!r}];'
            'import aura, receipt, phase0log, loader, hexutil;'
            'print("IMPORTS-OK")'
        )
        # `-B` AND an explicit environment. Without `-B` this probe imports from the release and
        # writes `__pycache__` into `release/scripts/composition` and `release/scripts/phase0`, so
        # the very next arm finds `['__pycache__', 'phase0log.py']` where it requires exactly the
        # one imported module — the measurement contaminating what it measures. `PYTHONDONTWRITEBYTECODE`
        # is set too rather than inherited: a local shell often has it, CI does not, and a test that
        # passes only because of an inherited variable is not evidence. Measured: this arm was green
        # locally and red in CI for exactly that reason.
        imported = run([sys.executable, '-B', '-c', import_probe],
                       env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        check('the receipt closure imports from the release bytes alone',
              'IMPORTS-OK' in imported.stdout,
              (imported.stderr or imported.stdout).strip().splitlines()[-1:] or 'no output')
        check('importing from the release left no bytecode behind',
              not any(release.rglob('__pycache__')),
              f'the release now holds {[str(p.relative_to(release)) for p in release.rglob("__pycache__")][:3]}')

        # ── 1d. the DIAMOND closure imports from the release's own bytes alone ──────────────
        # Same question as 1c for the cold evidence consumer, and the same reason: a release
        # whose verifier needs a sibling checkout is not a release that can verify its own
        # evidence. The probe runs from an EMPTY cwd with no PYTHONPATH and names the package
        # root explicitly, so anything it reaches came from the release.
        diamond_root = release / 'vendor' / 'kira-export'
        diamond_probe = (
            'import sys;'
            f'sys.path[:0]=[{str(diamond_root)!r}];'
            'from diamond import kira_evidence;'
            'from diamond.approval_artifact import verify_artifact;'
            'from diamond.aumlok_approval import verify_approval;'
            'print("DIAMOND-IMPORTS-OK")'
        )
        probe_cwd = work / 'diamond-probe-cwd'
        probe_cwd.mkdir(exist_ok=True)
        clean_env = {k: v for k, v in os.environ.items() if k != 'PYTHONPATH'}
        diamond_imported = subprocess.run(
            [sys.executable, '-B', '-c', diamond_probe], cwd=str(probe_cwd),
            capture_output=True, text=True, env=clean_env)
        check('the Diamond closure imports from the release bytes alone',
              'DIAMOND-IMPORTS-OK' in diamond_imported.stdout,
              (diamond_imported.stderr or diamond_imported.stdout).strip().splitlines()[-1:] or 'no output')

        # The closure rule itself, stated so it can FAIL. The claim is not "these files import
        # today" but "this tree contains every module its own code imports": so every absolute
        # import in the closure must be `diamond.*` (resolved to a file that is PRESENT) or one
        # of the standard-library names declared below. An import outside that set is an outside
        # import, whether or not it happens to be importable on the machine running the check —
        # which is exactly why the check is static and not a probe whose success depends on what
        # the host has installed.
        DIAMOND_ALLOWED_TOP_LEVEL = {
            '__future__', 'argparse', 'binascii', 'hashlib', 'json', 'os', 'pathlib',
            're', 'secrets', 'sys', 'typing',
        }

        def diamond_import_closure(package_root: Path) -> list:
            """Absolute top-level module names imported by the closure, and every diamond.*
            name. Returned as (outside, missing_diamond); both empty means the closure holds."""
            import ast

            outside, missing = set(), set()
            for source in sorted((package_root / 'diamond').glob('*.py')):
                tree_ast = ast.parse(source.read_text(encoding='utf-8'), filename=str(source))
                for node in ast.walk(tree_ast):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            top = alias.name.split('.')[0]
                            if top == 'diamond':
                                continue
                            if top not in DIAMOND_ALLOWED_TOP_LEVEL:
                                outside.add(f'{source.name}: import {alias.name}')
                    elif isinstance(node, ast.ImportFrom):
                        if node.level:  # a relative import stays inside the package by construction
                            continue
                        top = (node.module or '').split('.')[0]
                        if top == 'diamond':
                            # diamond.X must be a file that actually travelled.
                            sub = (node.module or '').split('.')[1:]
                            if sub and not (package_root / 'diamond' / f'{sub[0]}.py').is_file():
                                missing.add(f'{source.name}: from {node.module}')
                            continue
                        if top and top not in DIAMOND_ALLOWED_TOP_LEVEL:
                            outside.add(f'{source.name}: from {node.module}')
            return sorted(outside), sorted(missing)

        outside_imports, missing_members = diamond_import_closure(diamond_root)
        check('no module in the closure imports anything outside it',
              not outside_imports, f'outside imports: {outside_imports}')
        check('every diamond.* import names a file the closure carries',
              not missing_members, f'missing members: {missing_members}')

        # And the control that makes the rule above mean something: an injected outside import
        # must be REPORTED. A rule that cannot fail on a disposable copy is a rule that would
        # not fail on the shipped one either.
        tampered_root = work / 'diamond-tampered'
        shutil.copytree(diamond_root, tampered_root)
        with open(tampered_root / 'diamond' / 'kira_evidence.py', 'a', encoding='utf-8') as fh:
            fh.write('\nimport outside_sentinel  # injected outside import\n')
        injected_outside, _ = diamond_import_closure(tampered_root)
        check('an outside import injected into a disposable copy is REPORTED',
              any('outside_sentinel' in entry for entry in injected_outside),
              f'the injected import was not reported; the rule returned {injected_outside}')
        # And the shipped tree is untouched by that control.
        check('the control did not modify the release',
              not diamond_import_closure(diamond_root)[0],
              'the shipped closure now reports an outside import, so the control wrote through to it')

        # ── 5. a keep that matches nothing ────────────────────────────────────────────────────
        probe = work / 'probe'
        probe.mkdir()
        (probe / 'scripts' / 'composition').mkdir(parents=True)
        (probe / 'scripts' / 'artifacts-coverage.json').write_text(
            json.dumps({**declaration,
                        'strip': {**declaration['strip'],
                                  'keep': ['scripts/composition/**', 'scripts/absent-lane/**']}},
                       indent=2), encoding='utf-8')
        (probe / 'scripts' / 'composition' / 'present.py').write_text('x\n', encoding='utf-8')
        stripped = run(['node', str(STRIP_CLI), '--release', str(probe)])
        check('a keep that matches nothing is REFUSED by exact code',
              stripped.returncode != 0 and 'strip-keep-matched-nothing' in f'{stripped.stdout}{stripped.stderr}',
              f'exit={stripped.returncode}; the refusal must name the rule, not merely fail — '
              'a substring match on \'keep\' would also accept an unrelated declaration error')

        # ── 5b. `!` is refused rather than read as an exception ───────────────────────────────
        # Declared keeps are additive, so `!scripts/**` would keep nearly everything while looking
        # like a restriction. Checked directly against the exported matcher rather than through a
        # whole strip run: a probe declaration carrying other keeps fails on THOSE first
        # (`strip-keep-matched-nothing` for a sibling that matches nothing in a bare probe tree),
        # so a full-run probe would be asserting the wrong refusal's code.
        negated = run(['node', '--input-type=module', '-e',
                       "import { keepMatcher } from './scripts/lib/release-strip.mjs';"
                       "try { keepMatcher('!scripts/**'); console.log('ACCEPTED'); }"
                       "catch (e) { console.log('REFUSED ' + e.message); }"], cwd=ROOT)
        check("a negated keep is REFUSED by the matcher, not honoured as an exception",
              'REFUSED' in negated.stdout and 'unsupported-strip-keep' in negated.stdout,
              f'got: {negated.stdout.strip()[:160]}')

        # ── 6. the keep did not widen into "carry all of scripts/" ─────────────────────────────
        # Derived from the declaration rather than from a hand-kept exception list: a hard-coded
        # list is exactly how this arm went stale the first time, when `scripts/phase0/phase0log.py`
        # was declared and the arm still treated every non-composition script as a violation.
        def declared_keep_covers(path: str) -> bool:
            for pattern in declared:
                prefix = pattern.rstrip('/*')
                if path == prefix or path.startswith(f'{prefix}/'):
                    return True
            return False

        runtime_kept = set(manifest.get('runtimeReferences', {}).get('keptByRule', []))
        stray = [path for path in kept
                 if path.startswith('scripts/')
                 and not declared_keep_covers(path)
                 and path not in runtime_kept]
        check('an unrelated script is still STRIPPED (the keep did not widen)', not stray,
              f'unrelated paths survived: {stray[:3]}')
        # And the other direction: the keeps must not have swallowed a sibling the closure never
        # imports, or "self-contained" would be paid for by carrying whatever sat beside it.
        phase0_dir = release / 'scripts' / 'phase0'
        # Caches are ignored rather than counted, so this arm measures what the materializer
        # COPIED instead of tripping over bytecode some probe left behind. A cache appearing here
        # is a real defect and is caught by the arm above, which names it as contamination; this
        # arm's question is only "was the directory carried whole, or as the modules the closure
        # imports?"
        #
        # THE EXPECTED SET IS THREE, AND EACH ADDITION IS A FIX RATHER THAN A WIDENING. This arm used
        # to assert `== ['phase0log.py']`, which was right while the adapter was the only importer.
        # `scripts/composition/serialize-admissions.py` resolves `scripts/phase0/retainer.py`
        # RELATIVE TO ITSELF, so inside a release that file is the hook a settle runs — and without
        # it the shipped retainer answers an outage with `ModuleNotFoundError: No module named
        # 'retainer'` while every checkout-driven arm stays green, because a checkout always has it.
        # MEASURED on CI run 35574102129 after the file was carried but before this literal was
        # corrected.
        #
        # `memory_head.py` is the third, added 2026-09-22 for the same shape one step further along:
        # the SHIPPED settle path (`scripts/aura/settlement.py`, itself a declared keep) puts
        # scripts/phase0 on sys.path and imports it BY BARE NAME from `inscribe`, so a release with
        # the settlement verb and not this module settles without retaining — degrading to the NAMED
        # status `MEMORY_HEAD_UNAVAILABLE` over `ModuleNotFoundError: No module named 'memory_head'`
        # while every checkout-driven arm stays green. `memory-head`, the CLI entry point beside it,
        # stays out: the settle path imports the MODULE, not the command.
        #
        # THE GUARD IS UNCHANGED IN FORCE: the directory is still NOT carried whole. `selfcheck.py`
        # and `verify` sit beside these three, the closure imports neither, and their absence is the
        # part that proves the copy is a closure and not a directory. Naming the expected modules
        # keeps that property measurable; widening to "any subset" would have retired it.
        phase0_files = sorted(p.name for p in phase0_dir.iterdir()
                              if p.name != '__pycache__') if phase0_dir.is_dir() else []
        expected_phase0 = ['memory_head.py', 'phase0log.py', 'retainer.py']
        check('scripts/phase0 is NOT carried whole — only the imported modules travel',
              phase0_files == expected_phase0,
              f'carried: {phase0_files}; expected exactly {expected_phase0} — an EXTRA file here '
              f'means the copy stopped being a closure, and a MISSING one means the closure broke')

        # ── 7. the two carried lanes still refuse by name, unprovisioned ─────────────────────
        # Carrying a lane's bytes must not change what the lane DOES. Both are shipped unmounted,
        # and each must say so rather than degrading into a working-looking state. Asserted here
        # because "we carried it" and "it is inert and honest" are different claims, and the
        # second is the one an operator relies on.
        node = os.environ.get('AUKORA_NODE', 'node')
        aumlok = run([node, '--input-type=module', '-e',
                      f"const m = await import({str(release / 'plugins' / 'aukora-aumlok' / 'lib' / 'service.mjs')!r});"
                      "const r = m.AUMLOK_SERVICE_REFUSE;"
                      "console.log(JSON.stringify([r.UNBOUND, r.NO_REGISTRY]));"])
        check('aukora-aumlok refuses by name when unprovisioned',
              'aumlok:adapter-unbound' in aumlok.stdout and 'aumlok:host-registry-unavailable' in aumlok.stdout,
              (aumlok.stderr or aumlok.stdout).strip()[:200])

        kira = run([node, '--input-type=module', '-e',
                    f"const m = await import({str(release / 'plugins' / 'aukora-kira' / 'lib' / 'record.mjs')!r});"
                    "console.log(m.KIRA_SETTLEMENT.available, m.KIRA_SETTLEMENT.reason);"])
        check('aukora-kira reports production settlement UNAVAILABLE rather than substituting a test store',
              'false' in kira.stdout and 'no-admitted-memory-producer' in kira.stdout,
              (kira.stderr or kira.stdout).strip()[:200])

        print()
        if FAILURES:
            print(f'  {FAILURES} of {ARMS} arms FAILED\n')
            print('  SELF-CONTAINED RELEASE: RED')
            return 1
        print(f'  {ARMS}/{ARMS} arms: declared keeps travel, are covered, and their loss is refused\n')
        print('  SELF-CONTAINED RELEASE: GREEN')
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
