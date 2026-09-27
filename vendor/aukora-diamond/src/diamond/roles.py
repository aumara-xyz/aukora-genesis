"""One Ed25519 algorithm, many authority roles — roles do not collapse.

Every artifact in this toy is signed with the same curve. That makes it
tempting to feed one kind of artifact into a seam that accepts another:
a receipt as a grant, a checkpoint as a grant, a patent license as a grant,
a grant as a checkpoint. Each is a well-formed signature over well-formed
bytes, so signature verification alone cannot separate them.

Separation is therefore structural: each seam declares the single kind it
honours, and anything else is refused by role rather than by crypto.

This file is the one place that knows the roles. It is not a policy engine
and has no extensibility hook on purpose.
"""

from __future__ import annotations

from diamond.refuse_codes import ROLE_MISMATCH

# Role → the single artifact kind that satisfies it.
GRANT_ROLE = "grant"
CHECKPOINT_ROLE = "checkpoint"
RECEIPT_ROLE = "receipt"
PATENT_LICENSE_ROLE = "patent-license"

ROLE_KINDS = {
    GRANT_ROLE: ("aukora-grant/",),
    CHECKPOINT_ROLE: ("aukora-checkpoint/",),
    RECEIPT_ROLE: ("aukora-receipt/",),
    PATENT_LICENSE_ROLE: ("aukora-patent-license/",),
}

# Key roles. Same key material presented in the wrong role is refused at the
# seam that requires the role; this table names the roles so docs can quote it.
ISSUER_ROLE = "issuer"
GOVERNOR_ROLE = "governor"
PATENTEE_ROLE = "patentee"
CHECKPOINT_SIGNER_ROLE = "checkpoint-signer"
KEY_ROLES = (
    ISSUER_ROLE,
    GOVERNOR_ROLE,
    PATENTEE_ROLE,
    CHECKPOINT_SIGNER_ROLE,
)


class RoleError(ValueError):
    CODE = ROLE_MISMATCH


def kind_of(obj: object) -> str | None:
    if not isinstance(obj, dict):
        return None
    kind = obj.get("kind")
    return kind if isinstance(kind, str) else None


def admit(obj: object, role: str) -> None:
    """Refuse anything not of the single kind this role honours."""
    if role not in ROLE_KINDS:
        raise RoleError(f"{ROLE_MISMATCH}: unknown role {role}")
    kind = kind_of(obj)
    prefixes = ROLE_KINDS[role]
    if kind is None or not any(kind.startswith(p) for p in prefixes):
        raise RoleError(
            f"{ROLE_MISMATCH}: role {role} requires kind "
            f"{'|'.join(prefixes)}*, got {kind!r}"
        )
