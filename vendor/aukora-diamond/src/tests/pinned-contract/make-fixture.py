#!/usr/bin/env python3
"""Generate the canonical aukora-receipt/v3-genesis-fixture fixture.

    python3 tests/pinned-contract/make-fixture.py

WHY THIS EXISTS. The fixture committed beside it is a real, signed
`aukora-receipt/v3-genesis-fixture` document produced by this repository's own
issuer code, so a reader can regenerate it and get the same bytes rather than
taking a hand-written JSON blob on trust. The seed is the fixed constant below:
public, written here, and worthless — it exists so the signature is real and
reproducible without storing any secret. No production key is involved and no
secret is committed.

WHY THE KIND IS `-fixture` AND NOT `v3-genesis`. `v3-genesis` is the kind the
Genesis control plane emits for transitions it actually admitted. A diamond-run
document must not claim that kind: the kind string is the signature domain and
the claim about who produced the document. The `-fixture` kind exists precisely
for documents that stand in for bytes a producer could not produce, and the
verifier derives class `fixture` / `FIXTURE` from it rather than `unattributed`.

WHAT IT CARRIES. The 7-field composition block this repository's contract requires
(`compositionDigest`, `subjectDigest` included) plus the 7-field genesis aura
(`priorHead` required), and the block's base is DECLARED: `compositionBase: "v2"`.
The declaration is stamped by `issue()` and covered by the signature, so the
document states which base its block is instead of leaving a verifier to infer it
from the field count. Those digests are derived from the document's own fields
rather than pasted, so the fixture cannot drift from the contract without this
script failing.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO))

from diamond.composition import build as build_composition, digest as comp_digest
from diamond.ed25519 import public_from_seed
from diamond.hexutil import to_hex
from diamond.receipt import KIND_GENESIS_FIXTURE, issue

#: Public, worthless, fixed. Regenerating this fixture must be deterministic.
FIXTURE_SEED = bytes.fromhex("7f" * 32)
#: Fixed so the document is byte-stable; not a clock reading.
FIXTURE_ISSUED_AT = 1_789_551_177
FIXTURE_NONCE = "3a" * 32
FIXTURE_SUBJECT = "/var/aukora/fixture-subject"
FIXTURE_PLUGIN_BYTES = b"aukora-diamond fixture plugin bytes\n"
ZERO = "00" * 32


def main() -> int:
    from diamond.hexutil import sha256_hex
    from diamond.jcs import canonicalize_bytes

    pk = public_from_seed(FIXTURE_SEED)
    plugin_digest = sha256_hex(FIXTURE_PLUGIN_BYTES)
    subject_digest = sha256_hex(
        canonicalize_bytes({"domain": "aukora-subject/v1-toy", "subject": FIXTURE_SUBJECT})
    )
    envelope_digest = sha256_hex(
        canonicalize_bytes({"kind": "same-uid-envelope", "uid": 0})
    )
    composition = build_composition(
        operation="load",
        plugin_digest=plugin_digest,
        subject_digest=subject_digest,
        coeffect_envelope_digest=envelope_digest,
    )
    entry_hash = "91" * 32
    receipt = issue(
        seed=FIXTURE_SEED,
        issuer_pk=pk,
        kind=KIND_GENESIS_FIXTURE,
        issued_at=FIXTURE_ISSUED_AT,
        nonce=FIXTURE_NONCE,
        aura={
            "entryHash": entry_hash,
            "head": entry_hash,
            "prevHash": ZERO,
            "priorHead": ZERO,
            "root": "50" * 32,
            "seq": 1,
            "size": 1,
        },
        composition={
            "coeffectEnvelopeDigest": envelope_digest,
            "compositionDigest": comp_digest(composition),
            "operation": "load",
            "pluginDigest": plugin_digest,
            "pluginId": "fixture-plugin",
            "revertOf": "",
            "subjectDigest": subject_digest,
        },
    )

    out = HERE / "fixtures" / "diamond-genesis-fixture.json"
    out.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    pk_out = HERE / "fixtures" / "diamond-fixture-issuer.pk"
    pk_out.write_text(to_hex(pk) + "\n")
    print(f"wrote {out.relative_to(REPO)}  kind={receipt['kind']}  "
          f"composition fields={len(receipt['composition'])}")
    print(f"wrote {pk_out.relative_to(REPO)}  (PUBLIC key only; seed is the public "
          f"constant FIXTURE_SEED in this file)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
