"""Foreign cold-verify of aukora-receipt/v3-toy — second implementation smoke.

Does not import diamond.*. Not a standard. Verifies closed fields + Ed25519
signature enough to pass one diamond arm.

It tracks the sealed composition contract independently: a receipt may declare
`compositionBase`, a closed name from COMPOSITION_BASES, and the block is then
checked against the base the document STATES. Both bases are accepted, each under
its own name; an unknown name is refused by name; a document with no declaration is
resolved by set membership — exactly the v1 set is v1, anything else that is the v2
set is v2, and a block that is neither is refused naming both. Nothing here decides
by counting fields, and this file is deliberately a second implementation of that
rule rather than an import of the first.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from foreign.ed25519 import verify
from foreign.jcs import canonicalize_bytes

KIND_LIVE = "aukora-receipt/v3-toy"
KIND_FIXTURE = "aukora-receipt/v3-toy-fixture"
CLOSED_REQUIRED = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce", "sig")
CLOSED_OPTIONAL = ("compositionBase",)
CLOSED = CLOSED_REQUIRED + CLOSED_OPTIONAL
SIGNED_REQUIRED = tuple(k for k in CLOSED_REQUIRED if k != "sig")
SIGNED = SIGNED_REQUIRED + CLOSED_OPTIONAL
AURA_CLOSED = ("entryHash", "head", "prevHash", "root", "seq", "size")
COMP_BASE_V1 = (
    "coeffectEnvelopeDigest",
    "operation",
    "pluginDigest",
    "pluginId",
    "revertOf",
)
COMP_BASE_V2 = (
    "coeffectEnvelopeDigest",
    "compositionDigest",
    "operation",
    "pluginDigest",
    "pluginId",
    "revertOf",
    "subjectDigest",
)
COMPOSITION_BASES = {"v1": COMP_BASE_V1, "v2": COMP_BASE_V2}
COMP_PATENT_OPTIONAL = ("patentDocketId", "patentLicenseNonce")
COMP_BASE = COMP_BASE_V2
COMP_CLOSED = COMP_BASE
FORBIDDEN = ("owner", "identity", "did", "ownerPk", "ownerPublicKey", "alg")


class ForeignError(ValueError):
    pass


def _hex(text: str, n: int) -> bytes:
    if not isinstance(text, str) or len(text) != n * 2:
        raise ForeignError("hex length")
    if text != text.lower() or any(c not in "0123456789abcdef" for c in text):
        raise ForeignError("hex")
    return bytes.fromhex(text)


def composition_base_for(receipt: dict) -> str:
    """The base this document is checked against. Stated, never counted."""
    declared = receipt.get("compositionBase")
    if declared is not None:
        if not isinstance(declared, str) or declared not in COMPOSITION_BASES:
            raise ForeignError(f"compositionBase unknown: {declared!r}")
        return declared
    comp = receipt.get("composition")
    if not isinstance(comp, dict):
        raise ForeignError("composition")
    keys = set(comp) - set(COMP_PATENT_OPTIONAL)
    matches = [n for n, fields in COMPOSITION_BASES.items() if keys == set(fields)]
    if len(matches) == 1:
        return matches[0]
    raise ForeignError(
        "composition closed fields (compositionBase not declared and the block matches "
        "neither " + " nor ".join(sorted(COMPOSITION_BASES)) + ")"
    )


def check(receipt: dict) -> str:
    """Validate the closed sets. Returns the composition base that was checked."""
    for name in FORBIDDEN:
        if name in receipt:
            raise ForeignError(f"forbidden field: {name}")
    if set(receipt.keys()) - set(CLOSED) or set(CLOSED_REQUIRED) - set(receipt.keys()):
        raise ForeignError("closed fields")
    if receipt["kind"] not in (KIND_LIVE, KIND_FIXTURE):
        raise ForeignError("kind")
    _hex(receipt["issuerPk"], 32)
    _hex(receipt["nonce"], 32)
    _hex(receipt["sig"], 64)
    if type(receipt["issuedAt"]) is bool or not isinstance(receipt["issuedAt"], int):
        raise ForeignError("issuedAt")
    base = composition_base_for(receipt)
    aura = receipt["aura"]
    if set(aura.keys()) != set(AURA_CLOSED):
        raise ForeignError("aura closed")
    for key in ("entryHash", "head", "prevHash", "root"):
        _hex(aura[key], 32)
    comp = receipt["composition"]
    keys = set(comp.keys())
    fields = set(COMPOSITION_BASES[base])
    opt = set(COMP_PATENT_OPTIONAL)
    if not fields <= keys or (keys - fields - opt):
        raise ForeignError(f"composition closed fields (base {base})")
    present_opt = keys & opt
    if present_opt and present_opt != opt:
        raise ForeignError(f"composition patent fields incomplete (base {base})")
    if comp["operation"] not in ("load", "unload"):
        raise ForeignError("operation")
    _hex(comp["pluginDigest"], 32)
    _hex(comp["coeffectEnvelopeDigest"], 32)
    for name in ("compositionDigest", "subjectDigest"):
        if name in fields:
            _hex(comp[name], 32)
    if "patentLicenseNonce" in comp:
        _hex(comp["patentLicenseNonce"], 32)
        if not isinstance(comp.get("patentDocketId"), str) or not comp["patentDocketId"]:
            raise ForeignError("patentDocketId")
    return base


def to_sign_bytes(receipt: dict) -> bytes:
    body = {k: receipt[k] for k in SIGNED if k in receipt}
    return (receipt["kind"] + "\n").encode("ascii") + canonicalize_bytes(body)


def verify_receipt(receipt: dict, *, expect_pk: str | None = None) -> tuple[str, str]:
    check(receipt)
    if expect_pk is not None and receipt["issuerPk"] != expect_pk:
        raise ForeignError("issuerPk mismatch")
    pk = _hex(receipt["issuerPk"], 32)
    sig = _hex(receipt["sig"], 64)
    if not verify(pk, to_sign_bytes(receipt), sig):
        raise ForeignError("signature")
    if receipt["kind"] == KIND_FIXTURE:
        return "fixture", "FIXTURE"
    return "unattributed", "NON-CONFORMING"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Foreign smoke: cold-verify aukora-receipt/v3-toy (not a standard)"
    )
    parser.add_argument("receipt")
    parser.add_argument("--pub", help="optional issuer public key hex file")
    args = parser.parse_args(argv)
    receipt = json.loads(Path(args.receipt).read_text(encoding="utf-8"))
    expect = Path(args.pub).read_text(encoding="utf-8").strip() if args.pub else None
    try:
        approval, conformance = verify_receipt(receipt, expect_pk=expect)
    except (ForeignError, ValueError) as exc:
        print(f"FOREIGN FAIL: {exc}", file=sys.stderr)
        return 2
    print("FOREIGN: SIGNATURE_VALID")
    if expect is None:
        print("FOREIGN: SIGNER_IDENTITY_UNANCHORED")
    else:
        print("FOREIGN: SIGNER_KEY_MATCHED")
    print(f"FOREIGN CLASS: {approval}")
    print(f"FOREIGN CONFORMANCE: {conformance}")
    print(f"FOREIGN COMPOSITION BASE: {composition_base_for(receipt)}")
    print("FOREIGN: second implementation smoke (not a standard)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
