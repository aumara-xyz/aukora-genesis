#!/usr/bin/env python3
"""Project the Aura evidence that already exists, as JSON, and write nothing.

WHY THIS FILE EXISTS AND WHAT IT REFUSES TO BE. The verification lives in
`scripts/aura/adapter.py` and `scripts/composition/receipt.py`; this is a projection of
it, not a second implementation. Every verdict below is produced by calling those
functions. Nothing here decides whether a signature is good, whether a log is
admissible, or what a retention status means — it asks, and reports the answer with the
label the answer came with.

IT IS READ-ONLY, AND THAT IS NOT AUTOMATIC IN THIS TREE. Three nearby entry points look
like reads and are not: `composition.loader.Loader.__init__` makes the state directory
and generates keys into it; `plugins/aukora-kira/lib/memory-owner.mjs` writes an Ed25519
keypair to `issuer.json` when one is absent; and the adapter's `retain` and `present`
verbs write `retained.json` and `presented.json`. None of them is reached from here. The
functions this module calls — `issuer_snapshot`, `read_log`, `receipt_documents`,
`entry_associations`, `ceilings`, `delivery_path` — are the write-free ones.

WHY A SEPARATE PROCESS. The adapter is Python and has no `--json` mode; the only existing
JS entry point wraps it and parses English prose with regular expressions. Rather than
add a mode to a file another lane owns, or re-derive verdicts in TypeScript, the face
spawns this and reads one document.

Usage:
    aura-evidence.py --state <state root> --scripts <release scripts dir>

Exit status is 0 whenever a document was produced, including a refusal document: a named
refusal is an answer, not a crash. Only an unusable invocation exits non-zero.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

# Written nowhere near a checkout on purpose: importing the adapter would otherwise drop
# __pycache__ into a tree this process has no business modifying.
sys.dont_write_bytecode = True

#: This projection's own shape version, so a consumer can refuse a stranger.
SCHEMA = 'aukora-face/aura-evidence:v1'


def _load(scripts_dir: str):
    """Import the adapter and its neighbours from the tree that shipped them.

    BY FILE PATH, AND NOT AS A PACKAGE. `scripts/aura/adapter.py` carries an explicit note
    above its imports: "`scripts/` itself is deliberately NOT on the path: it would shadow
    `import aura`" — the adapter means `scripts/composition/aura.py`, and the directory
    `scripts/aura/` wins that name whenever `scripts/` is on `sys.path`. The first draft of
    this loader did exactly that and every log read failed with
    `module 'aura' has no attribute 'AuraError'`. Loading each module from its own file
    reproduces direct execution, and the adapter then adds the two directories it needs.

    :param scripts_dir: the release's (or checkout's) ``scripts`` directory.
    :returns: the three modules this projection reads through.
    """
    import importlib.util  # noqa: PLC0415 — only needed on this path

    def from_file(name: str, relative: str):
        path = os.path.join(scripts_dir, relative)
        spec = importlib.util.spec_from_file_location(name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f'no module at {path}')
        module = importlib.util.module_from_spec(spec)
        # Registered before execution so a module that imports itself by name resolves.
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    adapter = from_file('aukora_aura_adapter', 'aura/adapter.py')
    retain = from_file('aukora_aura_retain', 'aura/retain_on_settle.py')
    # The adapter put scripts/composition on the path for its own `import receipt`; reuse
    # that rather than adding a second entry for the same directory.
    import receipt as receipt_mod  # noqa: PLC0415,E402
    return adapter, retain, receipt_mod


def _retention_for(receipt_path: str, seq, state: str, retain):
    """Report the delivery record beside one receipt, or its considered absence.

    ABSENCE IS NOT FAILURE HERE. `retain_on_settle` writes no delivery record at all when
    retention was never configured, so a missing file means "never asked for" and is
    reported as that rather than as an outage. The custody label travels with every
    outcome, because every retention path in this system is same-owner and a panel that
    omits it implies a third party is holding a copy.

    :param receipt_path: absolute path of the receipt the record would sit beside.
    :param seq: the receipt's claimed position.
    :param state: the state root.
    :param retain: the retain_on_settle module.
    :returns: one retention block.
    """
    custody = retain.CUSTODY
    try:
        path = retain.delivery_path(state, receipt_path, seq)
    except Exception as error:  # noqa: BLE001 — a path helper must not break the report
        return {'present': False, 'status': None, 'custody': custody,
                'note': f'delivery path could not be resolved: {error}'}
    if path is None or not os.path.isfile(path):
        return {
            'present': False,
            'status': retain.STATUS_NOT_CONFIGURED,
            'custody': custody,
            'note': 'no delivery record was written, which this system means as '
                    '"retention was never asked for" — not as a retainer that failed',
        }
    try:
        with open(path, encoding='utf-8') as handle:
            document = json.load(handle)
    except Exception as error:  # noqa: BLE001
        return {'present': True, 'status': None, 'custody': custody,
                'note': f'delivery record unreadable: {error}'}
    block = document.get('retainer') if isinstance(document, dict) else None
    block = block if isinstance(block, dict) else {}
    return {
        'present': True,
        'status': block.get('status'),
        # The record carries its own custody value; the constant is reported beside it so
        # a divergence is visible rather than papered over by trusting one of them.
        'custody': block.get('custody', custody),
        'custodyConstant': custody,
        'target': block.get('target'),
        'size': block.get('size'),
        'published': block.get('published'),
        'reason': block.get('reason'),
        'refusal': block.get('refusal'),
        # `flag` is non-null for exactly three of the six statuses; it is reported as it
        # is found rather than inferred from the status.
        'flag': document.get('flag') if isinstance(document, dict) else None,
        'note': document.get('note') if isinstance(document, dict) else None,
    }


def project(state: str, scripts_dir: str) -> dict:
    """Build the whole evidence document.

    :param state: the state root to read.
    :param scripts_dir: the scripts directory to import the adapter from.
    :returns: one JSON-serialisable document, refusal included.
    """
    observed_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    source = {
        'schema': SCHEMA,
        'state': state,
        'scripts': scripts_dir,
        'observedAt': observed_at,
        # Named so a reader can tell WHICH log and WHICH issuer produced the verdicts,
        # and so two reports over different state roots can never be confused.
        'logPath': os.path.join(state, 'aura', 'records.jsonl'),
        'issuerPath': os.path.join(state, 'issuer.pk'),
    }
    try:
        adapter, retain, _receipt_mod = _load(scripts_dir)
    except Exception as error:  # noqa: BLE001
        return {'source': source, 'refusal': {
            'code': 'aura-adapter-unavailable',
            'reason': f'{type(error).__name__}: {error}',
        }, 'ceilings': []}

    limits = list(adapter.ceilings())

    # The issuer snapshot is taken ONCE and passed everywhere. It is the single read that
    # decides issuer-pinned versus carried-key-only, and taking it twice would let one
    # report contain two different answers to the same question.
    try:
        issuer = adapter.issuer_snapshot(state)
    except Exception as error:  # noqa: BLE001
        return {'source': source, 'ceilings': limits, 'refusal': {
            'code': 'aura-issuer-unreadable', 'reason': f'{type(error).__name__}: {error}'}}

    try:
        log = adapter.read_log(state)
    except adapter.AssociationRefusal as refusal:
        # A NAMED REFUSAL IS THE ANSWER, NOT AN ERROR. With no composition log the honest
        # report is `aura-no-log` — a zero receipt count would read as health.
        return {
            'source': source,
            'ceilings': limits,
            'issuer': _issuer_block(adapter, issuer),
            'refusal': {'code': refusal.code, 'reason': str(getattr(refusal, 'reason', refusal))},
        }
    except Exception as error:  # noqa: BLE001
        return {'source': source, 'ceilings': limits, 'refusal': {
            'code': 'aura-log-unreadable', 'reason': f'{type(error).__name__}: {error}'}}

    # `entries` is a list attribute and there is no size() — the adapter itself reads
    # `len(log.entries)` everywhere, and this projection follows it rather than inventing
    # an accessor the class does not have.
    entries = list(getattr(log, 'entries', []) or [])
    size = len(entries)
    try:
        chain_key = adapter.chain_key_for(entries)
    except Exception:  # noqa: BLE001 — an empty log has no chain key, which is not fatal
        chain_key = None
    source['chainKey'] = chain_key
    source['logSize'] = size

    try:
        rows = adapter.entry_associations(state, log, size, issuer)
    except adapter.AssociationRefusal as refusal:
        return {
            'source': source, 'ceilings': limits, 'issuer': _issuer_block(adapter, issuer),
            'refusal': {'code': refusal.code, 'reason': str(getattr(refusal, 'reason', refusal))},
        }

    receipts = []
    for row in rows:
        for found in row.get('receipts') or []:
            path = found.get('path')
            receipts.append({
                'seq': row.get('seq'),
                'entryHash': row.get('entryHash'),
                'path': path,
                'directory': found.get('directory'),
                # The two signature questions, kept as the adapter labelled them. There
                # are four outcomes here, not two, and they are copied rather than
                # collapsed into a boolean.
                'signature': found.get('signature'),
                'issuerMatch': found.get('issuerMatch'),
                'class': found.get('class'),
                'conformance': found.get('conformance'),
                'invalid': found.get('invalid'),
                'digest': found.get('digest'),
                'retention': _retention_for(path, row.get('seq'), state, retain)
                if isinstance(path, str) else None,
            })

    try:
        pending = adapter.pending_admissions(state)
    except Exception:  # noqa: BLE001
        pending = []

    return {
        'source': source,
        'ceilings': limits,
        'issuer': _issuer_block(adapter, issuer),
        'receipts': receipts,
        # Admitted-but-not-yet-receipted is its own count. Folding it into the receipt
        # count would claim a receipt that does not exist.
        'pendingAdmissions': len(pending),
        'refusal': None,
    }


def _issuer_block(adapter, issuer: dict) -> dict:
    """The issuer block, in the adapter's own five-key shape.

    :param adapter: the adapter module.
    :param issuer: the snapshot taken once for this request.
    :returns: the block, or a minimal one when the adapter's own helper refuses.
    """
    try:
        return adapter.issuer_evidence(issuer)
    except Exception:  # noqa: BLE001
        return {'snapshot': issuer, 'note': 'issuer_evidence unavailable in this adapter'}


def main() -> int:
    """Parse arguments, project, print.

    :returns: process exit status.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--scripts', required=True)
    args = parser.parse_args()
    if not os.path.isdir(args.scripts):
        print(json.dumps({'source': {'schema': SCHEMA}, 'refusal': {
            'code': 'aura-scripts-missing',
            'reason': f'no scripts directory at {args.scripts}',
        }, 'ceilings': []}))
        return 0
    json.dump(project(args.state, args.scripts), sys.stdout, sort_keys=True)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
