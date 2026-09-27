"""Subject binding — signed, minimal, no identity or personhood semantics.

A "subject" here is the governed target of an activation: the path the loaded
plugin is authorized to act as/upon. It is a *capability-shaped scope*, not a
person. There is deliberately no owner, no identity, no DID and no human.

Two digests, both optional-as-a-pair-free, both signed into the grant:

  subjectDigest  the governed target      (required on every grant)
  sessionDigest  the governed session     (optional; only when a session exists)

A grant minted for subject A refuses as `grant:subject-mismatch` when
exercised as subject B even when pluginDigest, activationDigest, governorPk,
TTL and depth all match. Identity never crowns: nothing here claims to know
*who* anyone is.
"""

from __future__ import annotations

import os
from pathlib import Path

from diamond.hexutil import sha256_hex
from diamond.jcs import canonicalize_bytes

DOMAIN = "aukora-subject/v1-toy"


def normalize_subject(subject: str | os.PathLike) -> str:
    """Canonical absolute path form. Redundant separators / '.' are dropped.

    Symlinks are deliberately NOT resolved: a symlink is a different governed
    target here, and pretending otherwise would be an unmeasured claim.
    """
    raw = os.fspath(subject)
    if not isinstance(raw, str) or not raw:
        raise ValueError("subject")
    return str(Path(os.path.abspath(raw)))


def subject_digest(subject: str | os.PathLike) -> str:
    return sha256_hex(
        canonicalize_bytes({"domain": DOMAIN, "subject": normalize_subject(subject)})
    )


def session_digest(session: str | None) -> str | None:
    """None in, None out — absence of a session is not a session."""
    if session is None:
        return None
    if not isinstance(session, str) or not session:
        raise ValueError("session")
    return sha256_hex(
        canonicalize_bytes({"domain": DOMAIN, "session": session})
    )
