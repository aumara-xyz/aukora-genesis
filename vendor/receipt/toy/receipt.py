"""aukora-receipt/v3-toy — Ed25519, closed fields, integer-only JCS.

Class is derived by the verifier, never a signed field.
Live issuers without owner keys are unattributed / NON-CONFORMING.
Fixtures use kind aukora-receipt/v3-toy-fixture.

Evidence never authorizes. Identity never crowns. A forged owner /
identity / did field does not grant permission — closed-field refuse.
No alg field. Grants authorize composition, not receipt identity claims.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from toy.ed25519 import sign, verify
from toy.hexutil import from_hex, read_json, require_hex, to_hex, write_json
from toy.jcs import canonicalize_bytes

KIND_LIVE = "aukora-receipt/v3-toy"
KIND_FIXTURE = "aukora-receipt/v3-toy-fixture"
#: The Genesis control plane emits the same receipt with one extra field: its `aura` block
#: names `priorHead`, the head as it stood immediately before the entry, so a reader holding
#: a receipt and a retained observation can check the entry's POSITION without the log. That
#: is an addition to a closed block, not a new shape, so it is accepted as a sibling kind
#: rather than by loosening the check for everybody.
KIND_GENESIS = "aukora-receipt/v3-genesis"
KIND_GENESIS_FIXTURE = "aukora-receipt/v3-genesis-fixture"
KINDS = (KIND_LIVE, KIND_FIXTURE, KIND_GENESIS, KIND_GENESIS_FIXTURE)
#: The two v3-toy kinds, which this repository issues.
TOY_KINDS = (KIND_LIVE, KIND_FIXTURE)
#: The two v3-genesis kinds, which Genesis issues and this court accepts.
GENESIS_KINDS = (KIND_GENESIS, KIND_GENESIS_FIXTURE)
CLOSED = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce", "sig")
SIGNED = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce")
AURA_CLOSED = ("entryHash", "head", "prevHash", "root", "seq", "size")
#: The v3-genesis aura block, closed over seven fields instead of six. `priorHead` is
#: REQUIRED for these kinds and REFUSED for the toy kinds: it is a closed set per kind, not
#: an optional field for all of them. A v3-toy receipt carrying `priorHead` is still a
#: closed-fields refusal, and a v3-genesis receipt missing it is still a closed-fields
#: refusal, so neither can drift into the other's shape.
AURA_CLOSED_GENESIS = ("entryHash", "head", "prevHash", "priorHead", "root", "seq", "size")


def is_genesis_kind(kind: str) -> bool:
    return kind in GENESIS_KINDS


def aura_closed_for(kind: str) -> tuple[str, ...]:
    """The closed `aura` field set for a kind. The field set is a property of the kind."""
    return AURA_CLOSED_GENESIS if is_genesis_kind(kind) else AURA_CLOSED


#: The base composition block. Upstream added optional patent-license references on top of
#: this. Genesis kinds additionally require Diamond's compositionDigest and subjectDigest;
#: toy kinds stay on COMP_BASE. `check_composition_fields` owns that rule.
COMP_BASE = (
    "coeffectEnvelopeDigest",
    "operation",
    "pluginDigest",
    "pluginId",
    "revertOf",
)
#: Genesis receipts name WHICH composition and WHICH subject they attest. Diamond
#: requires both on every kind; the v3-toy kinds stay on COMP_BASE so this is a
#: closed set per kind, not an optional field for everybody. Same pattern as
#: `priorHead` on the aura block.
COMP_DIGEST_FIELDS = ("compositionDigest", "subjectDigest")
# Optional patent-license references (both required if either present).
COMP_PATENT_OPTIONAL = ("patentDocketId", "patentLicenseNonce")
# Back-compat alias: base closed set without optional patent refs.
COMP_CLOSED = COMP_BASE
OPS = ("load", "unload")
FORBIDDEN_IDENTITY_FIELDS = ("owner", "identity", "did", "ownerPk", "ownerPublicKey")


def composition_closed_for(kind: str) -> tuple[str, ...]:
    """The closed composition field set for a kind."""
    if is_genesis_kind(kind):
        return COMP_BASE + COMP_DIGEST_FIELDS
    return COMP_BASE


def check_composition_fields(comp: dict, kind: str = "") -> None:
    """Closed composition: base fields required; patent refs optional as a pair.

    Genesis kinds additionally require `compositionDigest` and `subjectDigest`.
    Toy kinds still refuse those names as extras.
    """
    if not isinstance(comp, dict):
        raise ReceiptError("composition")
    keys = set(comp.keys())
    base = set(composition_closed_for(kind))
    opt = set(COMP_PATENT_OPTIONAL)
    if not base <= keys:
        raise ReceiptError("composition closed fields")
    extra = keys - base - opt
    if extra:
        raise ReceiptError("composition closed fields")
    present_opt = keys & opt
    if present_opt and present_opt != opt:
        raise ReceiptError("composition patent fields incomplete")
    if comp["operation"] not in OPS:
        raise ReceiptError("operation")
    if not isinstance(comp["pluginId"], str) or not comp["pluginId"]:
        raise ReceiptError("pluginId")
    require_hex(comp["pluginDigest"], 32)
    require_hex(comp["coeffectEnvelopeDigest"], 32)
    if is_genesis_kind(kind):
        require_hex(comp["compositionDigest"], 32)
        require_hex(comp["subjectDigest"], 32)
    if not isinstance(comp["revertOf"], str):
        raise ReceiptError("revertOf")
    if comp["operation"] == "load" and comp["revertOf"] != "":
        raise ReceiptError("load revertOf must be empty")
    if comp["operation"] == "unload":
        require_hex(comp["revertOf"], 32)
    if "patentLicenseNonce" in comp:
        require_hex(comp["patentLicenseNonce"], 32)
        if not isinstance(comp["patentDocketId"], str) or not comp["patentDocketId"]:
            raise ReceiptError("patentDocketId")




class ReceiptError(ValueError):
    pass


def domain_for(kind: str) -> bytes:
    return (kind + "\n").encode("ascii")


def _signed_body(receipt: dict) -> dict:
    return {k: receipt[k] for k in SIGNED}


def to_sign_bytes(receipt: dict) -> bytes:
    return domain_for(receipt["kind"]) + canonicalize_bytes(_signed_body(receipt))


def issue(
    *,
    seed: bytes,
    issuer_pk: bytes,
    kind: str,
    issued_at: int,
    nonce: str,
    aura: dict,
    composition: dict,
) -> dict:
    if kind not in KINDS:
        raise ReceiptError("kind")
    receipt = {
        "aura": aura,
        "composition": composition,
        "issuedAt": int(issued_at),
        "issuerPk": to_hex(issuer_pk),
        "kind": kind,
        "nonce": nonce,
    }
    check_payload(receipt)
    receipt["sig"] = to_hex(sign(seed, to_sign_bytes(receipt)))
    return receipt


def check_payload(receipt: dict) -> None:
    for name in FORBIDDEN_IDENTITY_FIELDS:
        if name in receipt:
            raise ReceiptError(f"identity field refused: {name}")
    extra = set(receipt.keys()) - set(CLOSED)
    missing = set(SIGNED) - set(receipt.keys())
    if extra or missing:
        raise ReceiptError("closed fields")
    if "alg" in receipt:
        raise ReceiptError("alg field is forbidden")
    if receipt["kind"] not in KINDS:
        raise ReceiptError("kind")
    if type(receipt["issuedAt"]) is bool or not isinstance(receipt["issuedAt"], int):
        raise ReceiptError("issuedAt")
    require_hex(receipt["issuerPk"], 32)
    require_hex(receipt["nonce"], 32)

    aura = receipt["aura"]
    if set(aura.keys()) != set(aura_closed_for(receipt["kind"])):
        raise ReceiptError("aura closed fields")
    for key in ("entryHash", "head", "prevHash", "root"):
        require_hex(aura[key], 32)
    # `priorHead` is the head BEFORE this entry: at the first entry there is no predecessor,
    # so it is the zero digest. The same shape check the other digests get.
    if is_genesis_kind(receipt["kind"]):
        require_hex(aura["priorHead"], 32)
    if type(aura["seq"]) is bool or not isinstance(aura["seq"], int) or aura["seq"] < 1:
        raise ReceiptError("aura.seq")
    if type(aura["size"]) is bool or not isinstance(aura["size"], int) or aura["size"] < 1:
        raise ReceiptError("aura.size")
    if aura["head"] != aura["entryHash"]:
        raise ReceiptError("aura.head must equal aura.entryHash")
    if aura["seq"] != aura["size"]:
        raise ReceiptError("aura.seq must equal aura.size at issue")

    check_composition_fields(receipt["composition"], receipt["kind"])


def derive_class(receipt: dict, owner_keys: set[str] | None = None) -> tuple[str, str]:
    """Class is derived from kind + registered owner keys — never from a
    receipt field named owner/identity/did. This toy ships no owner keys,
    so live is always NON-CONFORMING. Identity never crowns.
    """
    if receipt["kind"] in (KIND_FIXTURE, KIND_GENESIS_FIXTURE):
        return "fixture", "FIXTURE"
    owners = owner_keys or set()
    if receipt["issuerPk"] in owners:
        # Reserved. This repository does not ship owner keys and must not
        # print CONFORMING. Presence of a registered issuer is not ceremony.
        return "attributed", "OWNER-KEY-PRESENT-NOT-CONFORMING"
    return "unattributed", "NON-CONFORMING"


def verify_receipt(receipt: dict, *, expect_pk: str | None = None) -> tuple[str, str]:
    # Identity/owner/did never authorize — refuse before signature work.
    for name in FORBIDDEN_IDENTITY_FIELDS:
        if name in receipt:
            raise ReceiptError(f"identity field refused: {name}")
    if "alg" in receipt:
        raise ReceiptError("alg field is forbidden")
    if set(receipt.keys()) != set(CLOSED):
        raise ReceiptError("closed fields")
    check_payload({k: receipt[k] for k in receipt if k != "sig"})
    require_hex(receipt["sig"], 64)
    if expect_pk is not None and receipt["issuerPk"] != expect_pk:
        raise ReceiptError("issuerPk mismatch")
    pk = from_hex(receipt["issuerPk"])
    if not verify(pk, to_sign_bytes(receipt), from_hex(receipt["sig"])):
        raise ReceiptError("signature")
    return derive_class(receipt)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Receipt v3-toy")
    parser.add_argument("receipt")
    parser.add_argument("--pub", help="issuer public key hex file")
    args = parser.parse_args(argv)
    receipt = read_json(Path(args.receipt))
    expect = Path(args.pub).read_text().strip() if args.pub else None
    approval, conformance = verify_receipt(receipt, expect_pk=expect)
    print(f"CLASS: {approval}")
    print(f"CONFORMANCE: {conformance}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
