#!/usr/bin/env python3
"""The versioned composition contract: both bases accepted, each under its own name.

    python3 scripts/verify-composition-base.py

WHY THIS EXISTS. The composition block's closed field set changed once: v1 (five fields)
became v2 (seven, when grants gained `compositionDigest` and `subjectDigest`). While that was
implicit, acceptance depended on counting fields — a five-field receipt was refused by this
revision for arithmetic reasons rather than for a stated rule, and a reader could not tell
which field set had been applied. A receipt may now declare `compositionBase`, and the
verifier checks the block against the base the DOCUMENT STATES.

WHAT THIS PROVES, and each arm fails if its property stops holding:

  1. A five-field document with no declaration verifies and is checked as base `v1`.
  2. A seven-field document with no declaration verifies and is checked as base `v2`, so
     nothing this revision accepted before is refused now.
  3. `issue()` stamps the base it composed under: `v1` for a five-field block, `v2` for a
     seven-field one, and both documents verify under that name.
  4. The committed Genesis fixture — real Genesis bytes, five fields, no declaration — now
     verifies here, checked as `v1`. That is the compatibility closure, on real evidence.
  5. An unknown base name is refused BY NAME, and the refusal quotes the name it did not
     recognise.
  6. A base that contradicts its own block is refused naming the base it checked: a `v1`
     declaration over a seven-field block, and a `v2` declaration over a five-field one.
  7. The declaration is inside the signature: flipping it after signing is a signature
     refusal, so a version cannot be relabelled to select a field set for the same bytes.
  8. A block matching neither base is refused NAMING BOTH, not as an anonymous count.
  9. Negative control: a tampered document is still refused, so this is not a script that
     only ever says yes.

WHAT IT DOES NOT DO. It does not repin Genesis, loosen either base, or relabel a kind. It does
not decide whether Genesis should emit `compositionBase`; that is Genesis's own change. It says
nothing about whether a receipt is true or authorizes anything — evidence never authorizes.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO))

from diamond.ed25519 import keygen, public_from_seed, sign  # noqa: E402
from diamond.hexutil import to_hex  # noqa: E402
from diamond.receipt import (  # noqa: E402
    KIND_GENESIS,
    KIND_LIVE,
    SIGNED_REQUIRED,
    ReceiptError,
    composition_base_for,
    issue,
    to_sign_bytes,
    verify_receipt,
)

FIVE_FIELD = {
    "coeffectEnvelopeDigest": "44" * 32,
    "operation": "load",
    "pluginDigest": "55" * 32,
    "pluginId": "versioned-plugin",
    "revertOf": "",
}
SEVEN_FIELD = dict(FIVE_FIELD, compositionDigest="66" * 32, subjectDigest="77" * 32)
PARTIAL = dict(FIVE_FIELD, compositionDigest="66" * 32)

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


def aura_for(kind: str) -> dict:
    entry = "11" * 32
    aura = {"entryHash": entry, "head": entry, "prevHash": "00" * 32,
            "root": "22" * 32, "seq": 1, "size": 1}
    if kind.endswith("genesis") or kind.endswith("genesis-fixture"):
        aura["priorHead"] = "00" * 32
    return aura


def body(kind: str, composition: dict, declared: str | None) -> dict:
    doc = {
        "aura": aura_for(kind),
        "composition": composition,
        "issuedAt": 1_700_000_000,
        "kind": kind,
        "nonce": "33" * 32,
    }
    if declared is not None:
        doc["compositionBase"] = declared
    return doc


def resign(document: dict, seed: bytes, pk: bytes) -> dict:
    """Sign the required set plus a declaration when present; keep any extra field.

    Mirrors `to_sign_bytes`: the optional key is covered when it is present and absent
    otherwise. Extras are deliberately NOT dropped, so a negative control can carry a field
    the signature does not cover and the verifier still has to refuse it.
    """
    doc = dict(document)
    doc.setdefault("issuerPk", to_hex(pk))
    signed = {k: doc[k] for k in SIGNED_REQUIRED}
    if "compositionBase" in doc:
        signed["compositionBase"] = doc["compositionBase"]
    extras = {k: v for k, v in doc.items()
              if k not in set(SIGNED_REQUIRED) | {"compositionBase", "sig"}}
    return {**signed, **extras, "sig": to_hex(sign(seed, to_sign_bytes(signed)))}


def expect_accept(label: str, document: dict, base: str, expect_pk: str | None = None) -> None:
    try:
        approval, conformance = verify_receipt(document, expect_pk=expect_pk)
    except (ReceiptError, ValueError) as exc:
        bad(label, f"refused: {exc}")
        return
    checked = composition_base_for(document)
    if checked != base:
        bad(label, f"checked as {checked!r}, expected {base!r}")
        return
    ok(f"{label} -> {approval} / {conformance}, checked as {checked}")


def expect_refused(label: str, document: dict, needle: str) -> None:
    try:
        approval, conformance = verify_receipt(document)
        bad(label, f"ACCEPTED as {approval} / {conformance}")
    except (ReceiptError, ValueError) as exc:
        if needle in str(exc):
            ok(f"{label} -> refused: {exc}")
        else:
            bad(label, f"refused as {exc!r}, wanted {needle!r}")


def main() -> int:
    print("\ncomposition base — both bases accepted, each under its own name\n")
    tmp = Path(tempfile.mkdtemp(prefix="composition-base-"))
    seed, raw_pk = keygen()
    pk_hex = to_hex(raw_pk)

    # 1/2. The legacy path: no declaration, resolved by set membership to a NAMED base.
    five = resign(body(KIND_LIVE, FIVE_FIELD, None), seed, raw_pk)
    seven = resign(body(KIND_LIVE, SEVEN_FIELD, None), seed, raw_pk)
    expect_accept("undeclared five-field block resolves to v1", five, "v1", expect_pk=pk_hex)
    expect_accept("undeclared seven-field block resolves to v2", seven, "v2", expect_pk=pk_hex)

    # 3. What this revision issues states its own base.
    issued_v1 = issue(seed=seed, issuer_pk=raw_pk, kind=KIND_LIVE, issued_at=1_700_000_000,
                      nonce="33" * 32, aura=aura_for(KIND_LIVE), composition=FIVE_FIELD)
    issued_v2 = issue(seed=seed, issuer_pk=raw_pk, kind=KIND_LIVE, issued_at=1_700_000_000,
                      nonce="33" * 32, aura=aura_for(KIND_LIVE), composition=SEVEN_FIELD)
    if issued_v1.get("compositionBase") != "v1" or issued_v2.get("compositionBase") != "v2":
        bad("issue stamps the base it composed under",
            f"got {issued_v1.get('compositionBase')!r} / {issued_v2.get('compositionBase')!r}")
    else:
        ok("issue stamps the base it composed under (v1 / v2)")
    expect_accept("an issued v1 receipt verifies under v1", issued_v1, "v1", expect_pk=pk_hex)
    expect_accept("an issued v2 receipt verifies under v2", issued_v2, "v2", expect_pk=pk_hex)

    # 4. The real thing: Genesis's own committed five-field document.
    fixture = json.loads((REPO / "tests" / "pinned-contract" / "fixtures"
                          / "genesis-receipt.json").read_text())
    fixture_pub = (REPO / "tests" / "pinned-contract" / "fixtures"
                   / "genesis-issuer.pk").read_text().strip()
    expect_accept("the committed Genesis fixture verifies here", fixture, "v1",
                  expect_pk=fixture_pub)

    # 5. An unknown name is refused by name, and the name is quoted.
    expect_refused("an unknown base name",
                   resign(body(KIND_LIVE, FIVE_FIELD, "v9"), seed, raw_pk),
                   "compositionBase unknown")
    expect_refused("the unknown name is quoted in the refusal",
                   resign(body(KIND_LIVE, SEVEN_FIELD, "v3"), seed, raw_pk), "'v3'")

    # 6. A declaration that contradicts its own block names the base it checked.
    expect_refused("a v1 declaration over a seven-field block",
                   resign(body(KIND_LIVE, SEVEN_FIELD, "v1"), seed, raw_pk), "base v1")
    expect_refused("a v2 declaration over a five-field block",
                   resign(body(KIND_LIVE, FIVE_FIELD, "v2"), seed, raw_pk), "base v2")

    # 6b. The base decides, not the count: v1 plus the optional patent pair is seven fields.
    patent = dict(FIVE_FIELD, patentDocketId="AUKORA-PROVISIONAL-B", patentLicenseNonce="88" * 32)
    expect_accept("a v1 base with the optional patent pair (seven fields) verifies as v1",
                  issue(seed=seed, issuer_pk=raw_pk, kind=KIND_LIVE, issued_at=1_700_000_000,
                        nonce="33" * 32, aura=aura_for(KIND_LIVE), composition=patent,
                        composition_base="v1"), "v1", expect_pk=pk_hex)

    # 7. The declaration is inside the signature. Two arms, because one of them has an
    #    artefact worth naming: a declaration flipped after signing is refused by the CLOSED
    #    SET first (structural checks run before signature work, the same order the pinned
    #    comparison documents), so it never reaches the signature. What proves coverage is
    #    the second arm: a document whose declaration the signature does NOT cover must not
    #    verify, even though every field it carries is otherwise valid and well-formed.
    flipped = dict(issued_v1)
    flipped["compositionBase"] = "v2"
    expect_refused("a declaration flipped after signing", flipped,
                   "composition closed fields (base v2)")
    uncovered = body(KIND_LIVE, FIVE_FIELD, "v1")
    uncovered["issuerPk"] = pk_hex
    uncovered["sig"] = to_hex(sign(seed, to_sign_bytes(
        {k: uncovered[k] for k in SIGNED_REQUIRED})))
    expect_refused("a declaration the signature does not cover", uncovered, "signature")

    # 8. Neither base fits: refused naming both, never as an anonymous count.
    expect_refused("a block matching neither base",
                   resign(body(KIND_LIVE, PARTIAL, None), seed, raw_pk), "neither v1 nor v2")

    # 9. Negative control.
    tampered = dict(issued_v2)
    tampered["composition"] = dict(SEVEN_FIELD, pluginDigest="ab" * 32)
    expect_refused("a tampered document", tampered, "signature")

    out = tmp / "issued-v1.json"
    out.write_text(json.dumps(issued_v1, indent=2, sort_keys=True) + "\n")
    (tmp / "issuer.pk").write_text(pk_hex + "\n")

    print()
    if FAILURES:
        print(f"  {FAILURES} of {ARMS} arms FAILED\n\n  COMPOSITION-BASE: RED")
        return 1
    print(f"  {ARMS}/{ARMS} arms produced their published result\n\n  COMPOSITION-BASE: GREEN")
    print(f"\n  issued v1 receipt written to {out}")
    print(f"  public key written to {tmp / 'issuer.pk'}")
    print(
        "\n  NOTE: Genesis is not modified and its verifier is not repinned. Whether Genesis\n"
        "  emits compositionBase is Genesis's own change; this sealed the contract on the\n"
        "  side that had to seal it, and the pinned bytes still refuse what they always did."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
