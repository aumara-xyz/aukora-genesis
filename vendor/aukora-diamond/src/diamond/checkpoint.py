"""Signed Aura checkpoints (retained / presented).

Issuer (or governor) signs the Merkle observation head. verify-pair checks
the signature before Phase 0 arithmetic. Unsigned rewrite-both fails closed.
An alternate valid Merkle fork still CONFLICT vs a signed retained.
"""

from __future__ import annotations

from typing import Any

from diamond.ed25519 import sign, verify
from diamond.hexutil import from_hex, require_hex, to_hex
from diamond.jcs import canonicalize_bytes

KIND = "aukora-checkpoint/v1-toy"
DOMAIN = b"aukora-checkpoint/v1-toy\n"
# Core observation fields always signed; consistency_path when present.
CORE_SIGNED = ("head", "kind", "root", "seq", "signerPk", "size")


class CheckpointError(ValueError):
    pass


def _signed_body(cp: dict) -> dict:
    body = {k: cp[k] for k in CORE_SIGNED}
    if "consistency_path" in cp:
        body["consistency_path"] = cp["consistency_path"]
    return body


def to_sign_bytes(cp: dict) -> bytes:
    return DOMAIN + canonicalize_bytes(_signed_body(cp))


def sign_checkpoint(
    checkpoint: dict,
    *,
    seed: bytes,
    signer_pk: bytes,
) -> dict:
    """Return a copy of checkpoint with kind/signerPk/sig bound."""
    out: dict[str, Any] = {
        "head": checkpoint["head"],
        "kind": KIND,
        "root": checkpoint["root"],
        "seq": checkpoint["seq"],
        "signerPk": to_hex(signer_pk),
        "size": checkpoint["size"],
    }
    if "consistency_path" in checkpoint:
        out["consistency_path"] = checkpoint["consistency_path"]
    # Preserve any other non-signed metadata only if absent from core — keep closed.
    out["sig"] = to_hex(sign(seed, to_sign_bytes(out)))
    return out


def verify_checkpoint(
    checkpoint: dict,
    *,
    expect_pk: str | None = None,
) -> None:
    if not isinstance(checkpoint, dict):
        raise CheckpointError("checkpoint")
    if checkpoint.get("kind") != KIND:
        raise CheckpointError("checkpoint kind")
    for name in ("head", "root", "seq", "size", "signerPk", "sig"):
        if name not in checkpoint:
            raise CheckpointError(f"missing {name}")
    require_hex(checkpoint["head"], 32)
    require_hex(checkpoint["root"], 32)
    require_hex(checkpoint["signerPk"], 32)
    require_hex(checkpoint["sig"], 64)
    if type(checkpoint["seq"]) is bool or not isinstance(checkpoint["seq"], int):
        raise CheckpointError("seq")
    if type(checkpoint["size"]) is bool or not isinstance(checkpoint["size"], int):
        raise CheckpointError("size")
    if expect_pk is not None and checkpoint["signerPk"] != expect_pk:
        raise CheckpointError("signerPk mismatch")
    pk = from_hex(checkpoint["signerPk"])
    if not verify(pk, to_sign_bytes(checkpoint), from_hex(checkpoint["sig"])):
        raise CheckpointError("signature")
