"""One-use Ed25519 composition grant (load|unload).

Nonce consumption is atomic across processes: each nonce is a file created
with O_EXCL under the state root. Check-then-write JSON is gone.

Blast-radius bounds live in the signed preimage: required maxTTL + issuedAt,
optional maxDepth (default 1). maxTTL is max **issuance duration**
(expiry - issuedAt <= maxTTL), with issuedAt <= now <= expiry (small clock
skew allowed on issuedAt).

A grant binds four independent things, all signed:

  governorPk         who may issue for this loader (pinned constant-time)
  activationDigest   which activation epoch      (unless PORTABLE_KIND)
  subjectDigest      which governed subject      (P0)
  compositionDigest  which governed composition  (P2)

Subject binding stops a grant for subject A being exercised as subject B even
when plugin/activation/governor/TTL/depth all match. There is no identity or
personhood semantics: a subject is a capability-shaped target, not a person.

Portability is a distinct *kind*, not a casual boolean. Flipping
`portable: true` onto a normal grant changes nothing — the flag lives only in
the portable kind, and a normal grant carrying it is refused as closed fields.
Portable authority is the one escape from epoch/restart revocation, so it is
named in the kind where an auditor can see it.

Evidence / reconstruction never authorize — those checks live at the activate
seam (see diamond.loader).
"""

from __future__ import annotations

import argparse
import errno
import hmac
import os
import sys
import time
from pathlib import Path

from diamond.ed25519 import sign, verify
from diamond.hexutil import from_hex, read_json, require_hex, sha256_hex, to_hex, write_json
from diamond.jcs import canonicalize_bytes
from diamond.refuse_codes import (
    EVIDENCE_NEVER_AUTHORIZES,
    GRANT_ACTIVATION_MISMATCH,
    GRANT_COMPOSITION_MISMATCH,
    GRANT_DELEGATION_WIDENED,
    GRANT_DEPTH_EXCEEDED,
    GRANT_GOVERNOR_MISMATCH,
    GRANT_ISSUED_IN_FUTURE,
    GRANT_NEGATIVE_LIFETIME,
    GRANT_PORTABLE_KIND,
    GRANT_REPLAYED,
    GRANT_SESSION_MISMATCH,
    GRANT_SUBJECT_MISMATCH,
    GRANT_TTL_UNBOUNDED,
    reconstruction_cannot_mint,
)

KIND = "aukora-grant/v1-toy"
# Portable authority is a different ceremony, so it is a different kind.
PORTABLE_KIND = "aukora-grant/v1-toy-portable"
KINDS = (KIND, PORTABLE_KIND)
DOMAIN = b"aukora-grant/v1-toy\n"
PORTABLE_DOMAIN = b"aukora-grant/v1-toy-portable\n"
# Small skew so issuance clocks slightly ahead of verify still pass.
CLOCK_SKEW_SECONDS = 60
# Required closed fields (exact set, plus the optionals below).
CLOSED_REQUIRED = (
    "activationDigest",
    "coeffectEnvelopeDigest",
    "compositionDigest",
    "expiry",
    "governorPk",
    "issuedAt",
    "kind",
    "maxTTL",
    "nonce",
    "operation",
    "pluginDigest",
    "sig",
    "subjectDigest",
)
OPTIONAL = ("haltDigest", "maxDepth", "parentDigest", "referenceDigest", "sessionDigest")
# `portable` is NOT optional here: it exists only inside PORTABLE_KIND.
OPTIONAL_PORTABLE = ("portable",)
CLOSED = CLOSED_REQUIRED
SIGNED_REQUIRED = (
    "activationDigest",
    "coeffectEnvelopeDigest",
    "compositionDigest",
    "expiry",
    "governorPk",
    "issuedAt",
    "kind",
    "maxTTL",
    "nonce",
    "operation",
    "pluginDigest",
    "subjectDigest",
)
SIGNED = SIGNED_REQUIRED
OPS = ("load", "unload")
# Advisory / reconstructed artifacts never authorize composition.
RECONSTRUCTION_SUBSTITUTES = (
    "recommendation",
    "evidence",
    "receipt",
    "confidence",
    "majority",
)
DEFAULT_MAX_DEPTH = 1
# Dimensions along which a child grant may narrow but never widen a parent.
DELEGATION_DIMENSIONS = (
    "activation",
    "composition",
    "expiry",
    "halt",
    "maxDepth",
    "maxTTL",
    "operation",
    "plugin",
    "portable",
    "reference",
    "session",
    "subject",
)


class GrantError(ValueError):
    pass


def is_portable_kind(grant: dict) -> bool:
    return grant.get("kind") == PORTABLE_KIND


def domain_for(grant: dict) -> bytes:
    return PORTABLE_DOMAIN if is_portable_kind(grant) else DOMAIN


def _signed_body(grant: dict) -> dict:
    body = {k: grant[k] for k in SIGNED_REQUIRED}
    for name in (*OPTIONAL, *OPTIONAL_PORTABLE):
        if name in grant:
            body[name] = grant[name]
    return body


def to_sign_bytes(grant: dict) -> bytes:
    return domain_for(grant) + canonicalize_bytes(_signed_body(grant))


def grant_fingerprint(grant: dict) -> str:
    """Digest of the signed body — what a child binds as its parent."""
    return sha256_hex(canonicalize_bytes(_signed_body(grant)))



def issue(
    *,
    seed: bytes,
    governor_pk: bytes,
    plugin_digest: str,
    coeffect_digest: str,
    operation: str,
    nonce: str,
    expiry: int,
    max_ttl: int,
    issued_at: int,
    activation_digest: str,
    subject_digest: str,
    composition_digest: str,
    max_depth: int | None = None,
    session_digest: str | None = None,
    reference_digest: str | None = None,
    halt_digest: str | None = None,
    portable: bool = False,
) -> dict:
    if operation not in OPS:
        raise GrantError("operation")
    if type(max_ttl) is bool or not isinstance(max_ttl, int) or max_ttl < 1:
        raise GrantError("maxTTL")
    if type(issued_at) is bool or not isinstance(issued_at, int):
        raise GrantError("issuedAt")
    if type(expiry) is bool or not isinstance(expiry, int):
        raise GrantError("expiry")
    require_hex(activation_digest, 32)
    require_hex(subject_digest, 32)
    require_hex(composition_digest, 32)
    if type(portable) is not bool:
        raise GrantError("portable")
    grant = {
        "activationDigest": activation_digest,
        "coeffectEnvelopeDigest": coeffect_digest,
        "compositionDigest": composition_digest,
        "expiry": int(expiry),
        "governorPk": to_hex(governor_pk),
        "issuedAt": int(issued_at),
        "kind": PORTABLE_KIND if portable else KIND,
        "maxTTL": int(max_ttl),
        "nonce": nonce,
        "operation": operation,
        "pluginDigest": plugin_digest,
        "subjectDigest": subject_digest,
    }
    if max_depth is not None:
        if type(max_depth) is bool or not isinstance(max_depth, int) or max_depth < 1:
            raise GrantError("maxDepth")
        grant["maxDepth"] = int(max_depth)
    if session_digest is not None:
        require_hex(session_digest, 32)
        grant["sessionDigest"] = session_digest
    # The reference a device holds, bound into the signed preimage: authority for a
    # physical action names WHICH reference it was granted against, not just which bytes.
    if reference_digest is not None:
        require_hex(reference_digest, 32)
        grant["referenceDigest"] = reference_digest
    # The halt a grant is allowed to clear. Naming a halt is the whole clearance ceremony:
    # the id is derived from the halt event, so a grant that names one was necessarily
    # minted after it happened.
    if halt_digest is not None:
        require_hex(halt_digest, 32)
        grant["haltDigest"] = halt_digest
    if portable:
        grant["portable"] = True
    grant["sig"] = to_hex(sign(seed, to_sign_bytes(grant)))
    return grant


def check_closed(grant: dict) -> None:
    if "alg" in grant:
        raise GrantError("alg field is forbidden")
    for name in ("owner", "identity", "did"):
        if name in grant:
            raise GrantError(f"identity field refused: {name}")
    for name in RECONSTRUCTION_SUBSTITUTES:
        if name in grant:
            raise GrantError(reconstruction_cannot_mint(name))
    keys = set(grant.keys())
    required = set(CLOSED_REQUIRED)
    kind = grant.get("kind")
    if kind not in KINDS:
        raise GrantError("kind")
    portable = kind == PORTABLE_KIND
    # The portable flag is honoured ONLY inside the portable kind. A normal
    # grant carrying it is an extra field, i.e. a closed-fields refusal.
    optional = set(OPTIONAL) | (set(OPTIONAL_PORTABLE) if portable else set())
    if not required <= keys:
        raise GrantError("closed fields")
    extra = keys - required - optional
    if extra:
        if "portable" in extra:
            raise GrantError(GRANT_PORTABLE_KIND)
        raise GrantError("closed fields")
    if grant["operation"] not in OPS:
        raise GrantError("operation")
    require_hex(grant["pluginDigest"], 32)
    require_hex(grant["coeffectEnvelopeDigest"], 32)
    require_hex(grant["activationDigest"], 32)
    require_hex(grant["subjectDigest"], 32)
    require_hex(grant["compositionDigest"], 32)
    require_hex(grant["nonce"], 32)
    require_hex(grant["governorPk"], 32)
    require_hex(grant["sig"], 64)
    if "sessionDigest" in grant:
        require_hex(grant["sessionDigest"], 32)
    if "referenceDigest" in grant:
        require_hex(grant["referenceDigest"], 32)
    if "haltDigest" in grant:
        require_hex(grant["haltDigest"], 32)
    if "parentDigest" in grant:
        require_hex(grant["parentDigest"], 32)
    if type(grant["expiry"]) is bool or not isinstance(grant["expiry"], int):
        raise GrantError("expiry")
    if type(grant["issuedAt"]) is bool or not isinstance(grant["issuedAt"], int):
        raise GrantError("issuedAt")
    max_ttl = grant["maxTTL"]
    if type(max_ttl) is bool or not isinstance(max_ttl, int) or max_ttl < 1:
        raise GrantError("maxTTL")
    if "maxDepth" in grant:
        max_depth = grant["maxDepth"]
        if type(max_depth) is bool or not isinstance(max_depth, int) or max_depth < 1:
            raise GrantError("maxDepth")
    if portable and grant.get("portable") is not True:
        raise GrantError(GRANT_PORTABLE_KIND)


def grant_max_depth(grant: dict) -> int:
    return int(grant["maxDepth"]) if "maxDepth" in grant else DEFAULT_MAX_DEPTH


def grant_is_portable(grant: dict) -> bool:
    """Portability is a kind, not a flag: only PORTABLE_KIND is portable."""
    return is_portable_kind(grant) and grant.get("portable") is True


def _narrower(child: dict, parent: dict) -> str | None:
    """Return the first dimension the child widened, or None if it narrowed.

    Monotonic delegation: child authority must be a SUBSET of parent authority.
    This is not a policy language — it is one comparison per dimension.
    """
    if child.get("operation") != parent.get("operation"):
        return "operation"
    if child.get("pluginDigest") != parent.get("pluginDigest"):
        return "plugin"
    if child.get("coeffectEnvelopeDigest") != parent.get("coeffectEnvelopeDigest"):
        return "resource"
    if child.get("compositionDigest") != parent.get("compositionDigest"):
        return "composition"
    if child.get("subjectDigest") != parent.get("subjectDigest"):
        return "subject"
    # A session may be pinned (parent none → child some) but never exchanged
    # for a different session, and never dropped once pinned.
    child_session = child.get("sessionDigest")
    parent_session = parent.get("sessionDigest")
    if child_session is not None:
        if parent_session is not None and child_session != parent_session:
            return "session"
    elif parent_session is not None:
        return "session"
    # A reference may be pinned by a child but never exchanged for a different one, and
    # never dropped once pinned. Same shape as a session: the bound is a bound, and
    # delegation is where a bound goes missing.
    child_reference = child.get("referenceDigest")
    parent_reference = parent.get("referenceDigest")
    if child_reference is not None:
        if parent_reference is not None and child_reference != parent_reference:
            return "reference"
    elif parent_reference is not None:
        return "reference"
    # A halt may be pinned by a child the same way, and for the same reason: reading a
    # narrower halt out of a wider grant is narrowing, exchanging it is not.
    child_halt = child.get("haltDigest")
    parent_halt = parent.get("haltDigest")
    if child_halt is not None:
        if parent_halt is not None and child_halt != parent_halt:
            return "halt"
    elif parent_halt is not None:
        return "halt"
    # TTL may only shrink; expiry may only move earlier.
    if int(child["maxTTL"]) > int(parent["maxTTL"]):
        return "maxTTL"
    if int(child["expiry"]) > int(parent["expiry"]):
        return "expiry"
    # Depth may only shrink.
    if grant_max_depth(child) > grant_max_depth(parent):
        return "maxDepth"
    # Portability may only be inherited, and only from a portable parent.
    if grant_is_portable(child) and not grant_is_portable(parent):
        return "portable"
    # Epoch binding: a non-portable child is pinned to the parent's activation.
    if not grant_is_portable(child):
        if not hmac.compare_digest(
            str(child["activationDigest"]), str(parent["activationDigest"])
        ):
            return "activation"
    return None


def check_delegation(child: dict, parent: dict) -> None:
    """Refuse a child that widens any dimension of its parent."""
    check_closed(child)
    check_closed(parent)
    widened = _narrower(child, parent)
    if widened is not None:
        raise GrantError(f"{GRANT_DELEGATION_WIDENED}: {widened}")
    if not hmac.compare_digest(
        str(grant_fingerprint(parent)), str(child.get("parentDigest", ""))
    ):
        raise GrantError(f"{GRANT_DELEGATION_WIDENED}: parentDigest")


def delegate(
    parent: dict,
    *,
    seed: bytes,
    nonce: str,
    expiry: int,
    max_ttl: int,
    issued_at: int,
    max_depth: int | None = None,
    session_digest: str | None = None,
    reference_digest: str | None = None,
    halt_digest: str | None = None,
) -> dict:
    """Mint a child grant that is a strict narrowing of `parent`.

    Every authority dimension is inherited; the caller may only pull expiry,
    maxTTL, maxDepth, session, reference or halt *in*, never out. `parentDigest` binds
    the chain so a child cannot be re-parented onto a wider grant later.
    """
    check_closed(parent)
    child_ttl = min(int(max_ttl), int(parent["maxTTL"]))
    child_expiry = min(int(expiry), int(parent["expiry"]))
    if child_expiry < int(issued_at):
        raise GrantError(GRANT_NEGATIVE_LIFETIME)
    parent_depth = grant_max_depth(parent)
    if max_depth is None:
        child_depth = parent_depth
    else:
        if type(max_depth) is bool or not isinstance(max_depth, int) or max_depth < 1:
            raise GrantError("maxDepth")
        child_depth = min(int(max_depth), parent_depth)
    child_session = session_digest
    if child_session is None:
        child_session = parent.get("sessionDigest")
    child_reference = reference_digest
    if child_reference is None:
        child_reference = parent.get("referenceDigest")
    child_halt = halt_digest
    if child_halt is None:
        child_halt = parent.get("haltDigest")
    child = {
        "activationDigest": parent["activationDigest"],
        "coeffectEnvelopeDigest": parent["coeffectEnvelopeDigest"],
        "compositionDigest": parent["compositionDigest"],
        "expiry": child_expiry,
        "governorPk": parent["governorPk"],
        "issuedAt": int(issued_at),
        "kind": parent["kind"],
        "maxDepth": child_depth,
        "maxTTL": child_ttl,
        "nonce": nonce,
        "operation": parent["operation"],
        "parentDigest": grant_fingerprint(parent),
        "pluginDigest": parent["pluginDigest"],
        "subjectDigest": parent["subjectDigest"],
    }
    if child_session is not None:
        child["sessionDigest"] = child_session
    if child_reference is not None:
        child["referenceDigest"] = child_reference
    if child_halt is not None:
        child["haltDigest"] = child_halt
    if is_portable_kind(parent):
        child["portable"] = True
    child["sig"] = to_hex(sign(seed, to_sign_bytes(child)))
    check_delegation(child, parent)
    return child



def looks_like_receipt(obj: object) -> bool:
    """True when an object is receipt-shaped (evidence, not a grant)."""
    if not isinstance(obj, dict):
        return False
    kind = obj.get("kind")
    if isinstance(kind, str) and kind.startswith("aukora-receipt/"):
        return True
    return "aura" in obj and "issuerPk" in obj and "composition" in obj


def verify_grant(
    grant: dict,
    *,
    now: int,
    want_operation: str | None = None,
    want_plugin: str | None = None,
    want_coeffect: str | None = None,
    want_depth: int | None = None,
    want_governor_pk: str | None = None,
    want_activation: str | None = None,
    want_subject: str | None = None,
    want_session: str | None = None,
    want_composition: str | None = None,
    parent: dict | None = None,
    spent: set[str] | None = None,
    clock_skew: int = CLOCK_SKEW_SECONDS,
) -> None:
    """Verify signature + bindings. Optional in-memory spent set for tests.

    Live activate paths use NonceStore.reserve() for atomic cross-process
    one-use; do not rely on the spent= parameter for that.

    Issuance-duration: require issuedAt <= now <= expiry (issuedAt may be
    ahead by at most clock_skew), expiry - issuedAt <= maxTTL, and
    expiry >= issuedAt. Pin governorPk / activationDigest when requested.
    Pin subjectDigest / sessionDigest / compositionDigest when requested, and
    enforce monotonic delegation when a parent grant is supplied.
    """
    if looks_like_receipt(grant):
        raise GrantError(EVIDENCE_NEVER_AUTHORIZES)
    check_closed(grant)
    issued_at = int(grant["issuedAt"])
    expiry = int(grant["expiry"])
    max_ttl = int(grant["maxTTL"])
    if expiry < issued_at:
        raise GrantError(GRANT_NEGATIVE_LIFETIME)
    if issued_at > now + int(clock_skew):
        raise GrantError(GRANT_ISSUED_IN_FUTURE)
    if expiry < now:
        raise GrantError("expired")
    # Issuance-duration ceiling (not remaining-lifetime).
    if expiry - issued_at > max_ttl:
        raise GrantError(GRANT_TTL_UNBOUNDED)
    max_depth = grant_max_depth(grant)
    if want_depth is not None:
        if type(want_depth) is bool or not isinstance(want_depth, int) or want_depth < 0:
            raise GrantError("depth")
        if want_depth > max_depth:
            raise GrantError(GRANT_DEPTH_EXCEEDED)
    if want_operation is not None and grant["operation"] != want_operation:
        raise GrantError("operation mismatch")
    if want_plugin is not None and grant["pluginDigest"] != want_plugin:
        raise GrantError("pluginDigest mismatch")
    if want_coeffect is not None and grant["coeffectEnvelopeDigest"] != want_coeffect:
        raise GrantError("coeffectEnvelopeDigest mismatch")
    if want_governor_pk is not None:
        # Constant-time pin: evil self-declared governorPk refused.
        if not hmac.compare_digest(str(grant["governorPk"]), str(want_governor_pk)):
            raise GrantError(GRANT_GOVERNOR_MISMATCH)
    if want_activation is not None and not grant_is_portable(grant):
        if not hmac.compare_digest(str(grant["activationDigest"]), str(want_activation)):
            raise GrantError(GRANT_ACTIVATION_MISMATCH)
    # Subject binding: a grant for subject A exercised as B is refused even
    # when plugin/activation/governor/TTL/depth all match.
    if want_subject is not None:
        if not hmac.compare_digest(str(grant["subjectDigest"]), str(want_subject)):
            raise GrantError(GRANT_SUBJECT_MISMATCH)
    # Session binding only when a session actually exists on both sides.
    if want_session is not None:
        got_session = grant.get("sessionDigest")
        if got_session is None or not hmac.compare_digest(
            str(got_session), str(want_session)
        ):
            raise GrantError(GRANT_SESSION_MISMATCH)
    # Composition binding: approving composition A must not authorize B just
    # because one plugin digest matches.
    if want_composition is not None:
        if not hmac.compare_digest(
            str(grant["compositionDigest"]), str(want_composition)
        ):
            raise GrantError(GRANT_COMPOSITION_MISMATCH)
    # Monotonic delegation when the parent is known (checked before signature:
    # both grants are still verified, but a widened child never reaches use).
    if parent is not None:
        check_delegation(grant, parent)
    if spent is not None and grant["nonce"] in spent:
        raise GrantError(GRANT_REPLAYED)
    pk = from_hex(grant["governorPk"])
    if not verify(pk, to_sign_bytes(grant), from_hex(grant["sig"])):
        raise GrantError("signature")



class NonceStore:
    """Atomic one-use nonces via O_EXCL file-per-nonce under state root.

    Directory layout: <root>/spent-nonces/<nonce>.spent
    Creating the file with exclusive create is the reservation.
    """

    def __init__(self, root: Path):
        # Accept either a directory root or a legacy spent-nonces.json path.
        root = Path(root)
        if root.suffix == ".json" or root.name == "spent-nonces.json":
            self.dir = root.parent / "spent-nonces"
        else:
            self.dir = root / "spent-nonces" if root.name != "spent-nonces" else root
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, nonce: str) -> Path:
        # nonce is 64 hex chars; refuse path traversal
        if any(ch not in "0123456789abcdef" for ch in nonce) or len(nonce) != 64:
            raise GrantError("nonce")
        return self.dir / f"{nonce}.spent"

    def contains(self, nonce: str) -> bool:
        return self._path(nonce).exists()

    def reserve(self, nonce: str) -> None:
        """Atomically consume nonce. Raises grant:replayed on conflict."""
        path = self._path(nonce)
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except OSError as exc:
            if exc.errno == errno.EEXIST:
                raise GrantError(GRANT_REPLAYED) from exc
            raise
        try:
            os.write(fd, b"spent\n")
        finally:
            os.close(fd)

    # Back-compat alias used by older call sites / courts.
    def consume(self, nonce: str) -> None:
        self.reserve(nonce)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Composition grant")
    sub = parser.add_subparsers(dest="cmd", required=True)
    iss = sub.add_parser("issue")
    iss.add_argument("--seed", required=True)
    iss.add_argument("--governor-pk", required=True)
    iss.add_argument("--plugin-digest", required=True)
    iss.add_argument("--coeffect-digest", required=True)
    iss.add_argument("--activation-digest", required=True)
    iss.add_argument("--subject-digest", required=True)
    iss.add_argument("--composition-digest", required=True)
    iss.add_argument("--session-digest", default=None)
    iss.add_argument("--operation", required=True, choices=OPS)
    iss.add_argument("--nonce", required=True)
    iss.add_argument("--expiry", type=int, required=True)
    iss.add_argument("--issued-at", type=int, required=True)
    iss.add_argument("--max-ttl", type=int, required=True)
    iss.add_argument("--max-depth", type=int, default=None)
    iss.add_argument(
        "--portable",
        action="store_true",
        default=False,
        help=(
            "mint the PORTABLE kind: survives activation restart. This is a "
            "distinct ceremony, not a flag on a normal grant."
        ),
    )
    iss.add_argument("--out", required=True)
    vf = sub.add_parser("verify")
    vf.add_argument("grant")
    vf.add_argument("--now", type=int, default=None)
    vf.add_argument("--depth", type=int, default=None)
    vf.add_argument("--want-governor-pk", default=None)
    vf.add_argument("--want-activation", default=None)
    vf.add_argument("--want-subject", default=None)
    vf.add_argument("--want-session", default=None)
    vf.add_argument("--want-composition", default=None)
    vf.add_argument("--parent", default=None)
    args = parser.parse_args(argv)

    if args.cmd == "issue":
        seed = require_hex(Path(args.seed).read_text().strip(), 32)
        pk = require_hex(Path(args.governor_pk).read_text().strip(), 32)
        grant = issue(
            seed=seed,
            governor_pk=pk,
            plugin_digest=args.plugin_digest,
            coeffect_digest=args.coeffect_digest,
            operation=args.operation,
            nonce=args.nonce,
            expiry=args.expiry,
            max_ttl=args.max_ttl,
            issued_at=args.issued_at,
            activation_digest=args.activation_digest,
            subject_digest=args.subject_digest,
            composition_digest=args.composition_digest,
            session_digest=args.session_digest,
            max_depth=args.max_depth,
            portable=bool(args.portable),
        )
        write_json(Path(args.out), grant)
        return 0
    grant = read_json(Path(args.grant))
    parent = read_json(Path(args.parent)) if args.parent else None
    verify_grant(
        grant,
        now=args.now if args.now is not None else int(time.time()),
        want_depth=args.depth,
        want_governor_pk=args.want_governor_pk,
        want_activation=args.want_activation,
        want_subject=args.want_subject,
        want_session=args.want_session,
        want_composition=args.want_composition,
        parent=parent,
    )
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
