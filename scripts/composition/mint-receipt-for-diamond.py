#!/usr/bin/env python3
"""Mint ONE receipt from Genesis bytes, cross-check its digest, and write it to a temp path.

    python3 scripts/composition/mint-receipt-for-diamond.py [--out /tmp/...]

WHAT IT DOES, IN ORDER, AND WHY EACH STEP IS THERE:

  1. Computes `subjectDigest` with GENESIS code over Diamond's record:
     `{"domain": "aukora-subject/v1-toy", "subject": os.path.abspath(plugin.blob)}`.
     Then computes `compositionDigest` from that subject and the rest of the canonical tuple.
  2. Computes the SAME composition digest with DIAMOND's own `toy.composition.digest` and REFUSES
     if the two disagree. When Diamond exposes `subject_digest`, the subject is cross-checked the
     same way. A producer that agrees with itself proves nothing, and the two implementations are
     separate code in separate repositories that are free to drift.
  3. Mints a receipt with Genesis's stock producer and writes it to a path under the system temp
     directory, printing that path.

WHAT IT DOES NOT DO, and this is the whole discipline of the file: it does NOT verify the receipt
cryptographically with Diamond's verifier, and it does NOT claim Diamond accepts the result. This
script's job is to hand a stranger a receipt and a digest agreement; the acceptance sentence belongs
to the Diamond side, in Diamond's words, and is not this repository's to write. Anything stronger
here would be the same overclaim the two new fields exist to remove.

EXIT CODES: 0 wrote a receipt whose digests agree. 2 refused (missing input, or digest disagreement).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSITION_DIR = ROOT / 'scripts' / 'composition'
# Diamond is a SIBLING repository and is deliberately not vendored here. A missing checkout is a
# refusal, never a skip: the cross-check is the point of this script, so a run without it would be
# precisely the unverified claim it exists to prevent.
DIAMOND_DEFAULT = Path.home() / 'aukora-diamond'

# Genesis's composition modules import each other by bare name (`from jcs import ...`), so the
# directory joins the path rather than each module becoming a package.
sys.path.insert(0, str(COMPOSITION_DIR))

import receipt as genesis_receipt  # noqa: E402
import ed25519  # noqa: E402


def fail(message: str) -> 'NoReturn':  # noqa: F821
    print(f'mint-refused: {message}', file=sys.stderr)
    raise SystemExit(2)


def require_diamond(diamond: Path):
    """Load Diamond's composition module. A missing checkout is a refusal, never a skip.

    Returns `(composition_mod, package_name, saved_path)`; `package_name` is the package the
    module was actually imported under, which is where Diamond's sibling law modules live.
    """
    # THE PACKAGE IS DISCOVERED FIRST, AND THE GUARD RUNS AFTER. An earlier revision checked for
    # `toy/composition.py` here and only then discovered the package, which made the discovery dead
    # code: a Diamond checkout that had renamed or dropped the `toy` distribution was refused with
    # `diamond-checkout-missing` before the loop could find `diamond/`. MEASURED 2026-09-18 —
    # Diamond tip `cac9f69` ships `diamond/` and no `toy/`, so every mint refused, and the
    # cross-check this script exists to perform could not run at all. The guard now names whichever
    # package is actually missing rather than assuming `toy` is the only name Diamond ever had.
    import importlib
    package_name = next(
        (name for name in ('toy', 'diamond') if (diamond / name / 'composition.py').is_file()),
        None,
    )
    if package_name is None:
        fail(f'diamond-checkout-missing: {diamond} has neither toy/composition.py nor '
             f'diamond/composition.py. Pass --diamond <checkout>, or clone aukora-diamond. '
             f'Refusing: without the composition module the digest cross-check cannot run, and a '
             f'receipt written without that check is an unverified claim.')
    saved = list(sys.path)
    sys.path.insert(0, str(diamond))
    try:
        return importlib.import_module(f'{package_name}.composition'), package_name, saved
    except Exception as exc:
        sys.path[:] = saved
        # A LAW MODULE THAT CANNOT BE IMPORTED IS A REFUSAL, NOT A TRACEBACK. Measured by an
        # independent verifier: a `composition.py` with a syntax error exited 1 with a raw
        # `SyntaxError` frame, and a `subject.py` that raises at import exited 1 with its own
        # `RuntimeError` — while a merely ABSENT name got the documented exit-2 refusal. The
        # asymmetry mattered little while this path was unreachable and matters a great deal now
        # that the `diamond/` package is what every mint loads. The exception type and message are
        # carried into the refusal, so the cause is still visible rather than swallowed.
        fail(f'diamond-law-unimportable: {package_name}/composition.py exists in {diamond} but '
             f'could not be imported ({type(exc).__name__}: {exc}). Refusing: the digest '
             f'cross-check compares against Diamond\'s own module, and a law that will not load '
             f'cannot be compared against. This is NOT a digest disagreement — nothing was '
             f'compared.')


def diamond_digest(diamond: Path, composition: dict) -> str:
    """Diamond's own composition digest, imported from its tree rather than re-implemented here."""
    composition_mod, package, saved = require_diamond(diamond)
    try:
        # A NAMED REFUSAL, NOT AN AttributeError TRACEBACK. `diamond_subject_digest` below already
        # guards its name this way; the composition digest did not, and the asymmetry was dormant
        # only while the `diamond/` package path was unreachable. It is now the path every mint
        # takes, so a `composition.py` that imports but omits `digest` would have ended the run
        # with a Python traceback instead of the documented refusal.
        fn = getattr(composition_mod, 'digest', None)
        if fn is None:
            fail(f'diamond-composition-digest-missing: {package}.composition has no `digest`. '
                 f'Refusing: the digest the cross-check compares against would have to be '
                 f're-implemented here, and a second implementation of the law is exactly what '
                 f'this script exists to avoid.')
        return fn(composition)
    finally:
        sys.path[:] = saved


def diamond_subject_digest(diamond: Path, normalize_subject: str) -> str:
    """Diamond's own `subject_digest(abspath(blob))`, read from the module that exports it.

    Diamond splits the two laws across two modules: the composition digest lives in
    `<pkg>.composition`, but `subject_digest` lives in `<pkg>.subject` — a SIBLING module, not a
    name re-exported by `composition.py` (measured: `hasattr(<pkg>.composition,
    'subject_digest')` is False, `hasattr(<pkg>.subject, 'subject_digest')` is True). Looking for
    it on the composition module made this cross-check unreachable: it refused on every run, so
    the one assertion that proves Genesis agrees with Diamond's subject law never executed.
    The package is taken from the module that actually imported, never spelled out again here.
    """
    _composition_mod, package, saved = require_diamond(diamond)
    try:
        import importlib
        # Absence of the module is a refusal with a name, not an ImportError traceback: the
        # cross-check is mandatory, and a crash is a worse report than a refusal.
        if not (diamond / package / 'subject.py').is_file():
            fail(f'diamond-subject-law-missing: {diamond} has {package}/composition.py but no '
                 f'{package}/subject.py, which is the module that exports subject_digest. '
                 f'Refusing: the subject cross-check cannot run, and a receipt written without it '
                 f'is an unverified claim.')
        # THE IMPORT IS GUARDED TOO, not only the file's existence. Measured by an independent
        # verifier: a `subject.py` that exists but RAISES at import exited 1 with a raw
        # `RuntimeError` traceback, while a merely absent module got the named refusal above. The
        # same asymmetry the composition module had, in the sibling law. The exception is carried
        # into the refusal so the cause stays visible.
        try:
            subject_mod = importlib.import_module(f'{package}.subject')
        except Exception as exc:
            fail(f'diamond-subject-law-unimportable: {package}/subject.py exists in {diamond} but '
                 f'could not be imported ({type(exc).__name__}: {exc}). Refusing: the subject '
                 f'cross-check compares against Diamond\'s own subject_digest, and a law that will '
                 f'not load cannot be compared against. This is NOT a digest disagreement — '
                 f'nothing was compared.')
        fn = getattr(subject_mod, 'subject_digest', None)
        if fn is None:
            fail(f'diamond-subject-digest-missing: {package}.subject has no subject_digest. '
                 f'Genesis will not invent a second spelling; the cross-check is the point.')
        return fn(normalize_subject)
    finally:
        sys.path[:] = saved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=None,
                        help='where to write the receipt; defaults to a fresh file under the '
                             'system temp directory')
    parser.add_argument('--diamond', type=Path, default=DIAMOND_DEFAULT,
                        help='Diamond checkout used for the digest cross-check')
    parser.add_argument('--blob-path', default=None,
                        help='governed blob path hashed as the subject; defaults to '
                             'abspath(<temp>/state/plugin.blob)')
    args = parser.parse_args()

    out = args.out or Path(tempfile.mkdtemp(prefix='genesis-receipt-')) / 'receipt.json'
    out.parent.mkdir(parents=True, exist_ok=True)

    # Fixed, clearly-synthetic inputs so the output is reproducible and obviously not production
    # material. A receipt minted here attests nothing about any real plugin.
    plugin_digest = '33' * 32
    coeffect_envelope_digest = '44' * 32
    operation = 'load'

    # Diamond hashes abspath of the governed blob path, not plugin identity.
    if args.blob_path:
        blob_path = os.path.abspath(args.blob_path)
    else:
        state_dir = Path(tempfile.mkdtemp(prefix='genesis-subject-state-'))
        blob_path = os.path.abspath(os.path.join(str(state_dir), 'plugin.blob'))
        Path(blob_path).write_bytes(b'genesis-mint-synthetic-plugin\n')
    subject_digest = genesis_receipt.subject_digest_for(blob_path)
    theirs_subject = diamond_subject_digest(args.diamond.resolve(), blob_path)
    if theirs_subject != subject_digest:
        fail(f'subject-digest-disagreement: genesis computed {subject_digest}, '
             f'diamond computed {theirs_subject}, over abspath({blob_path!r}).')
    print(f'subjectDigest AGREES across both implementations: {subject_digest}')
    print(f'subject path hashed: {blob_path}')
    print(f'subject record keys: {list(genesis_receipt.SUBJECT_RECORD_KEYS)}')
    print(f'subject domain: {genesis_receipt.SUBJECT_DOMAIN}')

    composition_digest = genesis_receipt.composition_digest_for(
        operation=operation,
        plugin_digest=plugin_digest,
        subject_digest=subject_digest,
        coeffect_envelope_digest=coeffect_envelope_digest,
    )

    # THE CROSS-CHECK. The tuple Diamond hashes is closed and sorted, so the dict is built once here
    # and handed to both implementations.
    canonical_tuple = {
        'coeffectEnvelopeDigest': coeffect_envelope_digest,
        'kind': genesis_receipt.COMPOSITION_KIND,
        'operation': operation,
        'pluginDigest': plugin_digest,
        'subjectDigest': subject_digest,
    }
    theirs = diamond_digest(args.diamond.resolve(), canonical_tuple)
    if theirs != composition_digest:
        fail(f'digest-disagreement: genesis computed {composition_digest}, diamond computed {theirs}, '
             f'over the same canonical tuple. The two canonical forms have drifted; a receipt minted '
             f'now would name a composition the verifier cannot reproduce.')
    print(f'digest AGREES across both implementations: {composition_digest}')

    seed, issuer_pk_bytes = ed25519.keygen()
    issuer_pk = genesis_receipt.to_hex(issuer_pk_bytes)
    aura = {
        'entryHash': '11' * 32, 'head': '11' * 32, 'prevHash': '00' * 32,
        'priorHead': '00' * 32, 'root': '22' * 32, 'seq': 1, 'size': 1,
    }
    receipt = genesis_receipt.issue(
        seed=seed,
        issuer_pk=issuer_pk,
        kind=genesis_receipt.KIND_LIVE,
        issued_at=1_700_000_000,
        nonce='55' * 32,
        aura=aura,
        # NOTE THE ASYMMETRY, MEASURED not chosen: Diamond's CANONICAL tuple includes `kind`, but
        # Diamond's RECEIPT composition deliberately excludes it. The digest is computed over the
        # five-field tuple above; the receipt carries a seven-field block that does NOT include
        # `kind`. Adding it here is refused by Genesis's own closed-set check — and would be refused
        # by Diamond's `check_composition_fields` for the same reason, since both close the
        # composition to seven names and `kind` is not one of them.
        composition={
            'coeffectEnvelopeDigest': coeffect_envelope_digest,
            'compositionDigest': composition_digest,
            'operation': operation,
            'pluginDigest': plugin_digest,
            'pluginId': 'org.aukora.toy',
            'revertOf': '',
            'subjectDigest': subject_digest,
        },
    )
    out.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    os.chmod(out, 0o600)

    # Genesis's own verifier must accept what Genesis just produced, or the producer is broken in a
    # way the field count would not reveal.
    genesis_receipt.verify_receipt(dict(receipt), expect_pk=issuer_pk)

    print(f'composition fields: {len(receipt["composition"])} -> {sorted(receipt["composition"])}')
    print(f'receipt written: {out}')
    print('NOT CLAIMED: that Diamond accepts this receipt. That sentence belongs to Diamond, and this '
          'script deliberately does not write it.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
