#!/usr/bin/env python3
"""The receipt closure, end to end, FROM THE RELEASE BYTES with the checkout out of reach.

    python3 scripts/composition/receipt-closure-test.py

WHAT THIS PROVES, AND WHY PRESENCE WAS NOT ENOUGH. `self-contained-release-test.py` shows that the
closure travels and is covered. That is a claim about FILES. This is a claim about BEHAVIOUR: that
a release can produce a governed admission, settle it into a receipt, retain the Aura pair over its
own log, and have a STRANGER verify that receipt — using only the bytes inside the release.

The distinction matters because the two failure modes look identical from a file listing. A release
can carry `scripts/composition` and still be unable to verify its own receipt, because the adapter
imports `phase0log` by bare name from `scripts/phase0` and the receipt contract lives in
`vendor/receipt/toy`. The owner named exactly this: copying two directories is not a receipt closure.

HOW THE CHECKOUT IS KEPT OUT OF REACH, WITHOUT TOUCHING IT. Every release command runs with an
EMPTY working directory and a `PYTHONPATH` that names only the release's own module directories, so
a command that reached back into the checkout would need an absolute path it was never given. An
earlier version of this test renamed the checkout it was running from; that is gone. Renaming a live
working tree to prove isolation risks the tree itself and proves no more than an absolute-path-free
environment does — and the environment is the thing actually under test, since it is what a reader
running the release would have.

WHAT THIS DOES NOT CLAIM. It does not mount anything into a running DSH, does not load a profile,
and does not touch a live session, key, identity or custody store. The producer here is the
receipt-level composition CLI on disposable state, which is the producer the receipt path actually
has. Kira's production settlement and the Aumlok signer channel remain absent and are not exercised:
the receipt path and the memory path are different paths, and this test only speaks for the first.
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


def release_env(release: Path, extra: dict | None = None) -> dict:
    """An environment that names the release's own modules and nothing from the checkout.

    `scripts/` itself is deliberately absent: it would shadow `import aura` with the directory
    `scripts/aura/`, which is the same reason `scripts/aura/adapter.py` omits it.
    """
    env = dict(os.environ)
    env['PYTHONPATH'] = os.pathsep.join([
        str(release / 'scripts' / 'composition'),
        str(release / 'scripts' / 'phase0'),
        str(release / 'scripts' / 'aura'),
    ])
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    if extra:
        env.update(extra)
    return env


def run(command: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([str(part) for part in command], cwd=str(cwd),
                          capture_output=True, text=True, env=env, timeout=300)


def labelled(output: str) -> dict[str, str]:
    """The court's labelled verdicts. A label present twice keeps the last.

    The VALUE is the first whitespace-delimited token: the courts print the verdict followed by
    prose (`APPEND_ONLY  (the pinned court, pair alone)`), and an arm that compared the whole
    remainder would be asserting the prose rather than the verdict.
    """
    found = {}
    for line in output.splitlines():
        if ':' in line and line.split(':', 1)[0].isupper():
            label, value = line.split(':', 1)
            found[label.strip()] = value.strip().split(maxsplit=1)[0] if value.strip() else ''
    return found


def main() -> int:
    # AN EXISTING RELEASE MAY BE NAMED, and then nothing is materialized. CI keeps the
    # self-materializing path because it has no release to point at; a caller that HAS one — an
    # operator before an upgrade, or a demonstration wrapping this suite — must be able to exercise
    # that exact artifact rather than a fresh equivalent. The state, pair and working directories
    # remain disposable either way, so the release under test is only ever READ.
    named = None
    for index, argument in enumerate(sys.argv[1:], start=1):
        if argument == '--release' and index < len(sys.argv) - 1:
            named = Path(sys.argv[index + 1]).resolve()
    print('\nreceipt closure — producer, Aura pair and a stranger, from the release alone\n')

    work = Path(tempfile.mkdtemp(prefix='receipt-closure-'))
    release = named if named is not None else work / 'release'
    state = work / 'state'
    pair = work / 'pair'
    run_from = work / 'run'          # empty working directory for every release command
    try:
        if named is not None:
            if not (release / '.dsh-build' / 'genesis-artifacts.json').is_file():
                print(f'  MANDATORY INPUT MISSING: {release} carries no artifact record')
                return 1
            print(f'  release given: {release} (not materialized by this run)')
        else:
            built = run([sys.executable, str(MATERIALIZER), '--to', release], cwd=ROOT)
            if built.returncode != 0 or not release.is_dir():
                print('  MANDATORY INPUT MISSING: the materializer did not produce a release')
                print((built.stderr or built.stdout).strip()[:400])
                return 1

        run_from.mkdir(parents=True, exist_ok=True)
        state.mkdir(parents=True)
        pair.mkdir(parents=True)

        python = sys.executable
        composition = release / 'scripts' / 'composition' / '__main__.py'
        serializer = release / 'scripts' / 'composition' / 'serialize-admissions.py'
        adapter = release / 'scripts' / 'aura' / 'adapter.py'
        env = release_env(release)

        check('the run directory holds no checkout', not any(run_from.iterdir()))

        plugin = work / 'hello-plugin.mjs'
        plugin.write_text(
            "export const name = 'hello-plugin';\n"
            "export function apply(ctx, config) { console.log('[hello-plugin] APPLIED'); }\n",
            encoding='utf-8')
        shutil.copy2(plugin, state / 'governed-hello-plugin.bin')

        minted = run([python, composition, 'grant', '--state', state, '--plugin', plugin, '--root', work,
                      '--operation', 'load', '--out', state / 'grants' / 'hello-plugin.json'],
                     cwd=run_from, env=env)
        check('the release mints a one-use grant', minted.returncode == 0,
              (minted.stderr or minted.stdout).strip()[:200])
        grants = sorted((state / 'grants').glob('*.json')) if (state / 'grants').is_dir() else []
        check('the grant names the module it binds', bool(grants))
        if not grants:
            return 1

        loaded = run([python, composition, 'load', '--state', state, '--plugin', plugin,
                      '--grant', grants[0]], cwd=run_from, env=env)
        output = f'{loaded.stdout}\n{loaded.stderr}'
        check('the release admits the module under its grant', loaded.returncode == 0,
              output.strip()[:200])
        ledger = state / 'aura' / 'records.jsonl'
        check("the admission is recorded in the release's own log",
              ledger.is_file() and 'load' in ledger.read_text(encoding='utf-8'),
              f'state holds: {sorted(p.name for p in state.iterdir())}')
        receipts_after_load = sorted(state.glob('receipt-load-*.json'))
        check('a receipt exists after the admission',
              len(receipts_after_load) == 1)
        if receipts_after_load:
            minted_receipt = json.loads(receipts_after_load[0].read_text(encoding='utf-8'))
            blob = os.path.abspath(os.path.join(str(state), 'plugin.blob'))
            # Stranger computation of Diamond's subject_digest(abspath(blob)): same
            # JCS record, no call into Genesis's helper, so agreement is evidence.
            sys.path.insert(0, str(release / 'scripts' / 'composition'))
            try:
                from jcs import canonicalize_bytes  # noqa: E402
                from hexutil import sha256_hex  # noqa: E402
            finally:
                if sys.path and sys.path[0] == str(release / 'scripts' / 'composition'):
                    sys.path.pop(0)
            # Diamond `diamond/subject.py` (SHA `cac9f69`; the same blob at `b80ab8e`) hashes domain+subject.
            # Built as a literal so a kind/principal producer cannot stay green.
            diamond_record = {
                'domain': 'aukora-subject/v1-toy',
                'subject': blob,
            }
            check(
                'Diamond subject record keys are domain+subject',
                set(diamond_record) == {'domain', 'subject'},
                f'got {sorted(diamond_record)}',
            )
            want = sha256_hex(canonicalize_bytes(diamond_record))
            got_digest = minted_receipt.get('composition', {}).get('subjectDigest')
            check(
                'subjectDigest equals the pinned Diamond subject-law literal (domain+subject; no Diamond bytes read)',
                got_digest == want,
                f'got {got_digest} want {want} over {blob}',
            )
            check(
                'subjectDigest is not the drifted kind+principal spelling',
                got_digest != sha256_hex(canonicalize_bytes({
                    'kind': 'aukora-subject/v1-toy',
                    'principal': blob,
                })),
                'subjectDigest still hashes kind+principal',
            )
            check(
                'subjectDigest is not the old plugin-id / v1-pin formula',
                got_digest != sha256_hex(canonicalize_bytes({
                    'kind': 'aukora-subject/v1-pin',
                    'principal': minted_receipt['composition']['pluginId'],
                })),
                'subjectDigest still hashes plugin identity under aukora-subject/v1-pin',
            )
            check('the loader wrote the governed blob that the subject names',
                  Path(blob).is_file(), blob)

        drained = run([python, serializer, '--state', state], cwd=run_from, env=env)
        check('the release settles the admission into a receipt', drained.returncode == 0,
              (drained.stderr or drained.stdout).strip()[:200])
        receipts = sorted(state.glob('receipt-load-*.json'))
        check('the release settles the admission into exactly one receipt', len(receipts) == 1,
              f'state holds {sorted(p.name for p in state.iterdir())}')

        # ── TWO PAIR FORMATS, TWO COURTS, and they are not interchangeable ────────────────────
        # The composition's own checkpoint writes `{size, root, head, leafConvention, tree}` and its
        # `verify --retained/--presented` reads exactly that. The Aura adapter writes
        # `{treeSize, epoch, atGeneration, chainKey, …}` for the Phase 0 court. Feeding the adapter's
        # document to the composition's verifier yields UNDETERMINED "has no size" — correct
        # behaviour, because a document carrying a convention this reader does not implement is not
        # evidence of anything. Measured: that is how this arm was written the first time.
        comp_retained = work / 'comp-retained.json'
        comp_presented = work / 'comp-presented.json'
        for out in (comp_retained, comp_presented):
            made = run([python, composition, 'checkpoint', '--state', state, '--out', out],
                       cwd=run_from, env=env)
            check(f'the release writes its own checkpoint ({out.name})', made.returncode == 0,
                  (made.stderr or made.stdout).strip()[:200])

        retained = run([python, adapter, 'retain', '--state', state, '--out', pair],
                       cwd=run_from, env=env)
        check('the release retains the Aura pair over its own log', retained.returncode == 0,
              (retained.stderr or retained.stdout).strip()[:200])
        retained_json = pair / 'retained.json'
        check('the retained observation is written', retained_json.is_file())

        if retained_json.is_file() and receipts:
            presented = run([python, adapter, 'present', '--state', state,
                             '--retained', retained_json, '--out', pair], cwd=run_from, env=env)
            presented_output = f'{presented.stdout}\n{presented.stderr}'
            labels = labelled(presented_output)
            check('the release presents the pair to the Phase 0 court', presented.returncode == 0,
                  presented_output.strip()[-200:])
            check('the presented pair earns APPEND_ONLY from the pinned court',
                  labels.get('COURT') == 'APPEND_ONLY' or labels.get('COMPOSITION') == 'APPEND_ONLY',
                  f'labels: {labels}')
            check('the presented observation is written beside the retained one',
                  (pair / 'presented.json').is_file())

            # ── the stranger: an EMPTY cwd, exit 0, and the four labelled verdicts ────────────
            # The canonical invocation, taken from scripts/receipt-verify: `-B` and
            # `PYTHONPATH=<release>/vendor/receipt`, so `toy` resolves from the release's own
            # tree and the vendored bytes stay free of __pycache__. `-B` also keeps this run from
            # writing into the release it is measuring.
            #
            # cwd IS THE EMPTY RUN DIRECTORY, which is what this file's header claims for EVERY
            # command. An earlier version ran this one from `release/vendor/receipt` to get `toy`
            # onto sys.path, so the assertion said "empty directory" while the invocation did not —
            # and a test whose stated isolation and actual isolation differ is the failure this
            # suite exists to catch. `PYTHONPATH` is the supported mechanism and it is release-only:
            # nothing from the checkout is named.
            #
            # An earlier guard also accepted any non-empty, traceback-free result, which ACCEPTS
            # `FAIL: REFUSE: ...` — the fail-closed refusal for a missing anchor. Exit 0 plus the
            # named verdicts is what makes this arm evidence rather than a liveness check.
            stranger_env = release_env(release, {
                'PYTHONPATH': str(release / 'vendor' / 'receipt'),
                'PYTHONDONTWRITEBYTECODE': '1',
            })
            cold = run([python, '-B', '-m', 'toy.cold_verify', receipts[0],
                        '--pub', state / 'issuer.pk'],
                       cwd=run_from, env=stranger_env)
            cold_output = f'{cold.stdout}\n{cold.stderr}'
            cold_labels = labelled(cold_output)
            check('a stranger verifies the receipt from release bytes alone, empty cwd, exit 0',
                  cold.returncode == 0, cold_output.strip()[-300:])
            check('the stranger cwd is still empty after the run',
                  not any(run_from.iterdir()),
                  f'the run directory holds {sorted(p.name for p in run_from.iterdir())}')
            for label, value in (('SIGNER', 'SIGNER_KEY_MATCHED'),
                                 ('CLASS', 'unattributed'),
                                 ('CONFORMANCE', 'NON-CONFORMING'),
                                 ('CONSISTENCY', 'CONSISTENCY_UNCHECKED'),
                                 ('ATTENDANCE', 'reported-not-proven')):
                check(f'stranger verdict {label}: {value}',
                      cold_labels.get(label) == value,
                      f'got {label!r}={cold_labels.get(label)!r}')
            check('the stranger did not merely refuse for a missing anchor',
                  'REFUSE' not in cold_output, cold_output.strip()[-200:])

            verify = run([python, composition, 'verify', '--state', state,
                          '--receipt', receipts[0], '--retained', comp_retained,
                          '--presented', comp_presented], cwd=run_from, env=env)
            verify_output = f'{verify.stdout}\n{verify.stderr}'
            verify_labels = labelled(verify_output)
            check('the release verifies its own receipt against its own checkpoint pair, exit 0',
                  verify.returncode == 0, verify_output.strip()[-300:])
            check('and the consistency verdict is APPEND_ONLY',
                  verify_labels.get('CONSISTENCY') == 'APPEND_ONLY',
                  f'labels: {verify_labels}')
            check('and the receipt conformance is read, not assumed',
                  verify_labels.get('CONFORMANCE') in ('NON-CONFORMING', 'CONFORMING'),
                  f'labels: {verify_labels}')

            associated = run([python, adapter, 'associate', '--state', state,
                              '--retained', retained_json,
                              '--presented', pair / 'presented.json'],
                             cwd=run_from, env=env)
            associate_output = f'{associated.stdout}\n{associated.stderr}'
            associate_labels = labelled(associate_output)
            check('the release associates its own adapter pair, exit 0',
                  associated.returncode == 0, associate_output.strip()[-300:])
            check('and the association names the court verdict',
                  associate_labels.get('COURT') == 'APPEND_ONLY',
                  f'labels: {associate_labels}')

        print()
        if FAILURES:
            print(f'  {FAILURES} of {ARMS} arms FAILED\n')
            print('  RECEIPT CLOSURE: RED')
            return 1
        print(f'  {ARMS}/{ARMS} arms: the release produces, settles, retains and verifies its own receipt\n')
        print('  RECEIPT CLOSURE: GREEN')
        print('  Scope: the RECEIPT path. Kira production settlement and Aumlok signer custody are')
        print('  absent from this release and are not exercised here.')
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
