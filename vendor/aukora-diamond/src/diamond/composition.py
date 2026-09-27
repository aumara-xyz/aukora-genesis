"""Canonical governed composition — the thing a grant actually authorizes.

A grant binds pluginDigest (which bytes) and activationDigest (which epoch).
Neither of those says *which governed composition* is being approved: two
different compositions can share one plugin digest (same bytes, different
subject / operation / coefficient envelope), and one composition can be
reached under either an epoch-bound or a portable grant.

compositionDigest closes that: it is the hash of the exact governed tuple the
activation will perform. A grant for composition A is refused for composition
B even when a plugin digest matches, named `grant:composition-mismatch`.

This is the whole mechanism: one canonical dict, one hash. It is not a
Genesis composition runtime and carries no plugin identity semantics beyond
the digests already in play.
"""

from __future__ import annotations

from diamond.hexutil import sha256_hex
from diamond.jcs import canonicalize_bytes

KIND = "aukora-composition/v1-toy"
# The whole tuple. Adding a field here broadens what "the same composition"
# means, so this list is the review surface.
FIELDS = (
    "coeffectEnvelopeDigest",
    "kind",
    "operation",
    "pluginDigest",
    "subjectDigest",
)


def canonical(composition: dict) -> dict:
    missing = [f for f in FIELDS if f not in composition]
    if missing:
        raise ValueError(f"composition missing fields: {','.join(missing)}")
    extra = set(composition) - set(FIELDS)
    if extra:
        raise ValueError(f"composition closed fields: {','.join(sorted(extra))}")
    return {k: composition[k] for k in FIELDS}


def digest(composition: dict) -> str:
    """Canonical compositionDigest (sha256 over JCS bytes)."""
    return sha256_hex(canonicalize_bytes(canonical(composition)))


def build(
    *,
    operation: str,
    plugin_digest: str,
    subject_digest: str,
    coeffect_envelope_digest: str,
) -> dict:
    return {
        "coeffectEnvelopeDigest": coeffect_envelope_digest,
        "kind": KIND,
        "operation": operation,
        "pluginDigest": plugin_digest,
        "subjectDigest": subject_digest,
    }


__all__ = ["FIELDS", "KIND", "build", "canonical", "digest"]
