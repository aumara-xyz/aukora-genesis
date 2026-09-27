#!/usr/bin/env python3
"""Accepting aukora-receipt/v3-genesis, without loosening anything for v3-toy.

    python3 scripts/verify-v3-genesis-acceptance.py

WHY THIS EXISTS. The Genesis control plane emits the same receipt shape as this toy with one
addition: its `aura` block also names `priorHead`, the head as it stood immediately before the
entry, so a reader with a receipt and a retained observation can check the entry's POSITION
without holding the log. That is an addition to a CLOSED block, so the two shapes are sibling
kinds with sibling field sets — not one shape with an optional field.

WHAT THIS PROVES, and each arm fails if its property stops holding:

  1. A well-formed v3-genesis receipt is accepted and attributed honestly.
  2. A v3-toy receipt carrying `priorHead` is refused as closed fields. The acceptance in
     (1) did not make `priorHead` optional for everybody.
  3. A v3-genesis receipt MISSING `priorHead` is refused as closed fields. The genesis kind
     is not accepted with a missing required field.
  4. Changing ONLY the `kind` of a signed receipt is refused. A signature covers the kind,
     because the kind is the algorithm binding and the signature domain.
  5. An unknown kind is still refused by name.
  6. Existing v3-toy receipts still verify, so none of the above changed them.

The receipts here are built with this repository's own issuer, so the signatures are real:
the test does not assert on hand-written hex. Arm 4 is the interesting one — flipping the
kind changes `domain_for(kind)`, so the signature must fail, which is what makes the kind a
binding rather than a label.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from diamond.ed25519 import keygen  # noqa: E402
from diamond.hexutil import to_hex  # noqa: E402
from diamond.receipt import (  # noqa: E402
    KIND_FIXTURE,
    KIND_GENESIS,
    KIND_LIVE,
    ReceiptError,
    issue,
    to_sign_bytes,
    verify_receipt,
)
from diamond.ed25519 import sign  # noqa: E402

FAILURES = 0
ARMS = 0


def ok(label: str) -> None:
    global ARMS
    ARMS += 1
    print(f"  ok    {label}")


def bad(label: str, detail: str = "") -> None:
    global ARMS, FAILURES
    ARMS += 1
    FAILURES += 1
    print(f"  FAIL  {label}{f' — {detail}' if detail else ''}")


def expect_accepted(label: str, receipt: dict, expect_pk: str | None = None) -> None:
    try:
        approval, conformance = verify_receipt(receipt, expect_pk=expect_pk)
        ok(f"{label} -> {approval} / {conformance}")
    except (ReceiptError, ValueError) as exc:
        bad(label, f"refused: {exc}")


def expect_refused(label: str, receipt: dict, needle: str) -> None:
    try:
        approval, conformance = verify_receipt(receipt)
        bad(label, f"ACCEPTED as {approval} / {conformance}")
    except (ReceiptError, ValueError) as exc:
        if needle in str(exc):
            ok(f"{label} -> refused: {exc}")
        else:
            bad(label, f"refused as {exc!r}, wanted {needle!r}")


def build(kind: str, *, prior_head: str | None, seed: bytes, pk: bytes) -> dict:
    """A receipt of `kind`, with or without the genesis-only field, signed for real."""
    entry_hash = "11" * 32
    aura = {
        "entryHash": entry_hash,
        "head": entry_hash,
        "prevHash": "00" * 32,
        "root": "22" * 32,
        "seq": 1,
        "size": 1,
    }
    if prior_head is not None:
        aura["priorHead"] = prior_head
    return issue(
        seed=seed,
        issuer_pk=pk,
        kind=kind,
        issued_at=1_700_000_000,
        nonce="33" * 32,
        aura=aura,
        composition={
            "coeffectEnvelopeDigest": "44" * 32,
            "compositionDigest": "66" * 32,
            "operation": "load",
            "pluginId": "hello-plugin",
            "pluginDigest": "55" * 32,
            "revertOf": "",
            "subjectDigest": "77" * 32,
        },
    )


def resign(receipt: dict, seed: bytes) -> dict:
    """Re-sign the required set, KEEPING any extra fields the caller added.

    Two properties matter here and both were learned by getting them wrong:

    * The signature covers exactly the six required fields, so a field outside that set is
      not part of what is signed — which is precisely why an identity field can be added to a
      correctly-signed receipt and must still be refused. Dropping extras before signing
      would quietly delete the field under test.
    * `issue` validates before it signs, so it correctly REFUSES to mint a malformed shape.
      A negative control therefore cannot be built with it: start from a shape the issuer
      accepts, mutate, re-sign, and let `verify_receipt` do the refusing.
    """
    signed = {k: receipt[k] for k in ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce")}
    # The composition-base declaration is part of what this revision signs, so a re-signed
    # document has to cover it too — otherwise every arm below would fail on the signature
    # and stop testing the property it names.
    if "compositionBase" in receipt:
        signed["compositionBase"] = receipt["compositionBase"]
    extras = {k: v for k, v in receipt.items()
              if k not in (*signed, "sig")}
    return {**signed, **extras, "sig": sign(seed, to_sign_bytes(signed)).hex()}


def main() -> int:
    print("\nv3-genesis acceptance — narrow support, no general loosening\n")
    tmp = tempfile.mkdtemp(prefix="v3-genesis-acceptance-")
    seed, raw_pk = keygen()
    pk = to_hex(raw_pk)
    pk_path = os.path.join(tmp, "issuer.pk")
    with open(pk_path, "w", encoding="utf-8") as fh:
        fh.write(pk + "\n")
    # `issue` takes the raw key and hexes it itself; every receipt below is signed for real.
    key = raw_pk

    genesis = build(KIND_GENESIS, prior_head="00" * 32, seed=seed, pk=key)
    with open(os.path.join(tmp, "receipt.json"), "w", encoding="utf-8") as fh:
        json.dump(genesis, fh, indent=2, sort_keys=True)

    # 1. the new kind, complete, accepted
    expect_accepted("a complete v3-genesis receipt verifies", genesis, expect_pk=pk)

    # 2. priorHead is not optional for the toy kind: add it to a validly signed v3-toy receipt
    toy_valid = build(KIND_LIVE, prior_head=None, seed=seed, pk=key)
    toy_with_prior = resign({**toy_valid, "aura": {**toy_valid["aura"], "priorHead": "00" * 32}}, seed)
    expect_refused("a v3-toy receipt carrying priorHead", toy_with_prior, "aura closed fields")

    # 3. priorHead is required for the genesis kind: remove it and re-sign, so the refusal is
    #    about the missing field and not about a stale signature
    genesis_missing = dict(genesis)
    genesis_missing["aura"] = {k: v for k, v in genesis["aura"].items() if k != "priorHead"}
    genesis_missing = resign(genesis_missing, seed)
    expect_refused("a v3-genesis receipt missing priorHead", genesis_missing, "aura closed fields")

    # 4. the kind is inside the signature, not a label on top of it. This is the arm that
    #    matters, and the fixture has to be built carefully to reach it: strip `priorHead`
    #    FIRST, so the aura block satisfies the v3-toy closed set, then relabel. The document
    #    is now structurally a valid v3-toy receipt whose signature was computed under the
    #    genesis domain — and the only thing that can refuse it is the signature.
    relabelled = dict(genesis)
    relabelled["aura"] = {k: v for k, v in genesis["aura"].items() if k != "priorHead"}
    relabelled["kind"] = KIND_LIVE
    expect_refused("a v3-genesis receipt relabelled v3-toy", relabelled, "signature")

    # 5. unknown kinds are still refused by name, and identity fields still refuse first
    unknown = resign({**genesis, "kind": "aukora-receipt/v9-nonsense"}, seed)
    expect_refused("an unknown kind", unknown, "kind")
    forged = resign({**genesis, "owner": "did:key:zForged"}, seed)
    expect_refused("a forged owner field", forged, "identity field refused")

    # 6. nothing about v3-toy changed
    toy = build(KIND_LIVE, prior_head=None, seed=seed, pk=key)
    expect_accepted("an existing v3-toy receipt still verifies", toy, expect_pk=pk)
    fixture = build(KIND_FIXTURE, prior_head=None, seed=seed, pk=key)
    approval, conformance = verify_receipt(fixture)
    if (approval, conformance) == ("fixture", "FIXTURE"):
        ok("a v3-toy fixture is still classed fixture / FIXTURE")
    else:
        bad("a v3-toy fixture is still classed fixture / FIXTURE", f"got {approval} / {conformance}")

    print()
    if FAILURES:
        print(f"  {FAILURES} of {ARMS} arms FAILED\n\n  V3-GENESIS ACCEPTANCE: RED")
        return 1
    print(f"  {ARMS}/{ARMS} arms produced their published result\n\n  V3-GENESIS ACCEPTANCE: GREEN")
    print(f"\n  receipt written to {os.path.join(tmp, 'receipt.json')}")
    print(f"  public key written to {pk_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
