"""aukora-receipt/v3-toy — Ed25519, closed fields, integer-only JCS.

Class is derived by the verifier, never a signed field.
Live issuers without owner keys are unattributed / NON-CONFORMING.
Fixtures use kind aukora-receipt/v3-toy-fixture.

THE COMPOSITION BASE IS NAMED, NOT COUNTED. The composition block has a closed field set,
and the set changed once (v1 → v2, when grants gained compositionDigest and subjectDigest).
Treating that as "five fields or seven" made an acceptance decision depend on arithmetic and
made a refusal unreadable. A receipt may therefore declare `compositionBase` — a closed name
from COMPOSITION_BASES, inside the signature — and the verifier checks the block against the
base the document STATES. Both bases are accepted, each under its own name; an unknown name is
refused by name; a block that does not fit the base it declares is refused naming that base.
The one inference left is the legacy one: a document with no declaration that is exactly the
v1 set is v1, because receipts issued before the name existed are still evidence. A block
matching neither base is refused naming both, never as an anonymous field count.

Evidence never authorizes. Identity never crowns. A forged owner /
identity / did field does not grant permission — closed-field refuse.
No alg field. Grants authorize composition, not receipt identity claims.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from diamond.ed25519 import sign, verify
from diamond.hexutil import from_hex, read_json, require_hex, to_hex, write_json
from diamond.jcs import canonicalize_bytes
from diamond.refuse_codes import COMPOSITION_BASE_UNKNOWN

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
#: Every key a receipt must carry. Unchanged, and still closed.
CLOSED_REQUIRED = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce", "sig")
#: The one optional top-level key, and the only one it will ever be. It names the
#: composition base the document was composed under, so a verifier checks a STATED base
#: instead of counting fields. It is inside the signature (see SIGNED) because a version
#: that could be relabelled after signing would choose which field set applies to the same
#: bytes, which is the failure this field exists to remove.
CLOSED_OPTIONAL = ("compositionBase",)
#: Every key a receipt may carry.
CLOSED = CLOSED_REQUIRED + CLOSED_OPTIONAL
SIGNED_REQUIRED = tuple(k for k in CLOSED_REQUIRED if k != "sig")
#: Every key the signature covers. The optional key is covered when it is present, which
#: leaves to_sign_bytes byte-identical for a document that does not carry it: JCS sorts
#: keys, so such a body serialises exactly as it always did.
SIGNED = SIGNED_REQUIRED + CLOSED_OPTIONAL
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


#: Composition base v1 — the set the pinned contract (c512d0c, the bytes Genesis vendors as
#: `vendor/receipt-v3`) requires, and the set Genesis's own composer still emits. It is a
#: NAMED base, not "the old shape": a document carrying it is checked under this name.
COMP_BASE_V1 = (
    "coeffectEnvelopeDigest",
    "operation",
    "pluginDigest",
    "pluginId",
    "revertOf",
)
#: Composition base v2 — v1 plus the two bindings grants gained at the same time:
#: `compositionDigest` and `subjectDigest`, so a receipt can state WHICH composition and
#: WHICH subject it attests, not just which plugin bytes.
COMP_BASE_V2 = (
    "coeffectEnvelopeDigest",
    "compositionDigest",
    "operation",
    "pluginDigest",
    "pluginId",
    "revertOf",
    "subjectDigest",
)
#: The closed set of base names. This block is the whole version vocabulary: a name that is
#: not here is refused BY NAME and is never turned into a field-count failure.
COMPOSITION_BASES = {"v1": COMP_BASE_V1, "v2": COMP_BASE_V2}
#: The base this revision composes under, and stamps on everything it issues.
COMPOSITION_BASE_CURRENT = "v2"
#: The base an undeclared document falls back to when its block is exactly the v1 set.
#: Documents issued before `compositionBase` existed are still evidence and must keep
#: verifying, so the legacy path stays — but it is an inference WITH A NAME, and a block
#: that fits NEITHER base is refused naming both, never as an anonymous count.
COMPOSITION_BASE_LEGACY = "v1"
# Optional patent-license references (both required if either present, in either base).
COMP_PATENT_OPTIONAL = ("patentDocketId", "patentLicenseNonce")
# Back-compat aliases: the current base, and the base closed set without optional refs.
COMP_BASE = COMP_BASE_V2
COMP_CLOSED = COMP_BASE
OPS = ("load", "unload")
FORBIDDEN_IDENTITY_FIELDS = ("owner", "identity", "did", "ownerPk", "ownerPublicKey")


def infer_composition_base(composition: dict) -> str:
    """Which NAMED base a block with no declared version is, or refuse naming both.

    This is the legacy path, kept only because documents issued before `compositionBase`
    existed are still evidence. It resolves by set membership, not by counting: exactly
    one base's field set must fit the block.
    """
    if not isinstance(composition, dict):
        raise ReceiptError("composition")
    keys = set(composition) - set(COMP_PATENT_OPTIONAL)
    matches = [name for name, fields in COMPOSITION_BASES.items() if keys == set(fields)]
    if len(matches) == 1:
        return matches[0]
    raise ReceiptError(
        "composition closed fields (compositionBase not declared and the block matches "
        "neither " + " nor ".join(sorted(COMPOSITION_BASES)) + ")"
    )


def composition_base_for(receipt: dict) -> str:
    """The composition base this document is checked against — stated, never counted.

    A declared `compositionBase` is authoritative, and a name outside the closed set is
    refused by that name. With no declaration the block is matched against each base; the
    inference exists so pre-versioning documents keep verifying, and it names both bases
    when it cannot resolve rather than reporting an anonymous field-count failure.
    """
    declared = receipt.get("compositionBase")
    if declared is None:
        return infer_composition_base(receipt.get("composition"))
    if not isinstance(declared, str) or declared not in COMPOSITION_BASES:
        raise ReceiptError(f"{COMPOSITION_BASE_UNKNOWN}: {declared!r}")
    return declared


def check_composition_fields(comp: dict, base: str | None = None) -> str:
    """Closed composition for ONE base. Returns the base that was checked.

    `base` is the declared or resolved base; None means the block's base is inferred, which
    is the legacy path. Both bases are checked by the same rules — what differs between them
    is the field set, and that is now stated rather than counted.
    """
    if not isinstance(comp, dict):
        raise ReceiptError("composition")
    if base is None:
        base = infer_composition_base(comp)
    if base not in COMPOSITION_BASES:
        raise ReceiptError(f"{COMPOSITION_BASE_UNKNOWN}: {base!r}")
    fields = set(COMPOSITION_BASES[base])
    opt = set(COMP_PATENT_OPTIONAL)
    keys = set(comp.keys())
    if not fields <= keys or keys - fields - opt:
        raise ReceiptError(f"composition closed fields (base {base})")
    present_opt = keys & opt
    if present_opt and present_opt != opt:
        raise ReceiptError(f"composition patent fields incomplete (base {base})")
    if comp["operation"] not in OPS:
        raise ReceiptError("operation")
    if not isinstance(comp["pluginId"], str) or not comp["pluginId"]:
        raise ReceiptError("pluginId")
    require_hex(comp["pluginDigest"], 32)
    require_hex(comp["coeffectEnvelopeDigest"], 32)
    # The two bindings v2 added exist in v1's vocabulary as nothing at all, so they are
    # checked against the base that requires them rather than by their names alone.
    for name in ("compositionDigest", "subjectDigest"):
        if name in fields:
            require_hex(comp[name], 32)
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
    return base




class ReceiptError(ValueError):
    pass


def domain_for(kind: str) -> bytes:
    return (kind + "\n").encode("ascii")


def _signed_body(receipt: dict) -> dict:
    """The signed subset. The optional key is covered when present, absent otherwise."""
    return {k: receipt[k] for k in SIGNED if k in receipt}


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
    composition_base: str | None = None,
) -> dict:
    """Mint a receipt. The composition base is DECLARED, never left implicit.

    `composition_base` defaults to the base the block's field set implies, and the resolved
    name is stamped on the document, so every receipt this revision issues states which
    base its block is. An unknown name is refused before anything is signed.
    """
    if kind not in KINDS:
        raise ReceiptError("kind")
    if composition_base is None:
        composition_base = infer_composition_base(composition)
    receipt = {
        "aura": aura,
        "composition": composition,
        "compositionBase": composition_base,
        "issuedAt": int(issued_at),
        "issuerPk": to_hex(issuer_pk),
        "kind": kind,
        "nonce": nonce,
    }
    check_payload(receipt)
    receipt["sig"] = to_hex(sign(seed, to_sign_bytes(receipt)))
    return receipt


def check_payload(receipt: dict) -> str:
    """Validate a receipt body. Returns the composition base that was checked."""
    for name in FORBIDDEN_IDENTITY_FIELDS:
        if name in receipt:
            raise ReceiptError(f"identity field refused: {name}")
    extra = set(receipt.keys()) - set(CLOSED)
    missing = set(SIGNED_REQUIRED) - set(receipt.keys())
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

    # The base is resolved BEFORE the block is judged, so an unknown version is refused by
    # name even when the rest of the document is also malformed, and so the aura check
    # cannot mask a version claim.
    base = composition_base_for(receipt)

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

    return check_composition_fields(receipt["composition"], base)


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
    """Verify a receipt. The composition base checked is `composition_base_for(receipt)`.

    The returned pair is unchanged — the base is not smuggled into the class or conformance
    vocabulary, which callers, courts and docs assert on. A caller that must STATE the base
    it checked asks `composition_base_for`, which is the same resolution this verifier used.
    """
    # Identity/owner/did never authorize — refuse before signature work.
    for name in FORBIDDEN_IDENTITY_FIELDS:
        if name in receipt:
            raise ReceiptError(f"identity field refused: {name}")
    if "alg" in receipt:
        raise ReceiptError("alg field is forbidden")
    extra = set(receipt.keys()) - set(CLOSED)
    missing = set(CLOSED_REQUIRED) - set(receipt.keys())
    if extra or missing:
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
    print(f"COMPOSITION BASE: {composition_base_for(receipt)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
