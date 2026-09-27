"""One-use Ed25519 patent-license grant (aukora-patent-license/v1).

Optional authorization plumbing for *authorized practice under a patent
license* in conforming loaders. This is NOT DRM over arbitrary forks or
MIT copies of a leaked snapshot. Patents are exclusionary rights enforced
in court; this grant is a technical gate for loaders that choose strict
mode (env AUKORA_STRICT_PATENT_LICENSE=1 or mediator policy).

Signed by **patentee root** — a key separate from the composition governor.
Nonce consumption is atomic (O_EXCL), same discipline as composition grants.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from diamond.ed25519 import sign, verify
from diamond.grant import GrantError, NonceStore
from diamond.hexutil import from_hex, read_json, require_hex, to_hex, write_json
from diamond.jcs import canonicalize_bytes

KIND = "aukora-patent-license/v1"
DOMAIN = b"aukora-patent-license/v1\n"
CLOSED = (
    "expiry",
    "kind",
    "licenseePk",
    "nonce",
    "patentDocketId",
    "patenteeRootPk",
    "scopeDigest",
    "sig",
)
SIGNED = (
    "expiry",
    "kind",
    "licenseePk",
    "nonce",
    "patentDocketId",
    "patenteeRootPk",
    "scopeDigest",
)
FORBIDDEN_IDENTITY = ("owner", "identity", "did", "ownerPk", "ownerPublicKey")


class PatentLicenseError(GrantError):
    """Named refuse path for patent-license gate failures."""


def _signed_body(grant: dict) -> dict:
    return {k: grant[k] for k in SIGNED}


def to_sign_bytes(grant: dict) -> bytes:
    return DOMAIN + canonicalize_bytes(_signed_body(grant))


def issue(
    *,
    seed: bytes,
    patentee_root_pk: bytes,
    patent_docket_id: str,
    licensee_pk: bytes,
    scope_digest: str,
    nonce: str,
    expiry: int,
) -> dict:
    if not isinstance(patent_docket_id, str) or not patent_docket_id.strip():
        raise PatentLicenseError("patentDocketId")
    grant = {
        "expiry": int(expiry),
        "kind": KIND,
        "licenseePk": to_hex(licensee_pk),
        "nonce": nonce,
        "patentDocketId": patent_docket_id.strip(),
        "patenteeRootPk": to_hex(patentee_root_pk),
        "scopeDigest": scope_digest,
    }
    grant["sig"] = to_hex(sign(seed, to_sign_bytes(grant)))
    return grant


def check_closed(grant: dict) -> None:
    if "alg" in grant:
        raise PatentLicenseError("alg field is forbidden")
    for name in FORBIDDEN_IDENTITY:
        if name in grant:
            raise PatentLicenseError(f"identity field refused: {name}")
    if set(grant.keys()) != set(CLOSED):
        raise PatentLicenseError("closed fields")
    if grant["kind"] != KIND:
        raise PatentLicenseError("kind")
    if not isinstance(grant["patentDocketId"], str) or not grant["patentDocketId"]:
        raise PatentLicenseError("patentDocketId")
    require_hex(grant["scopeDigest"], 32)
    require_hex(grant["nonce"], 32)
    require_hex(grant["licenseePk"], 32)
    require_hex(grant["patenteeRootPk"], 32)
    require_hex(grant["sig"], 64)
    if type(grant["expiry"]) is bool or not isinstance(grant["expiry"], int):
        raise PatentLicenseError("expiry")


def verify_patent_license(
    grant: dict,
    *,
    now: int,
    want_scope: str | None = None,
    want_licensee: str | None = None,
    want_patentee: str | None = None,
    want_docket: str | None = None,
) -> None:
    """Verify signature + bindings. Caller reserves nonce separately."""
    check_closed(grant)
    if grant["expiry"] < now:
        raise PatentLicenseError("expired")
    if want_scope is not None and grant["scopeDigest"] != want_scope:
        raise PatentLicenseError("scopeDigest mismatch")
    if want_licensee is not None and grant["licenseePk"] != want_licensee:
        raise PatentLicenseError("licenseePk mismatch")
    if want_patentee is not None and grant["patenteeRootPk"] != want_patentee:
        raise PatentLicenseError("patenteeRootPk mismatch")
    if want_docket is not None and grant["patentDocketId"] != want_docket:
        raise PatentLicenseError("patentDocketId mismatch")
    pk = from_hex(grant["patenteeRootPk"])
    if not verify(pk, to_sign_bytes(grant), from_hex(grant["sig"])):
        raise PatentLicenseError("signature")


class PatentNonceStore(NonceStore):
    """Atomic one-use store under <root>/spent-patent-nonces/."""

    def __init__(self, root: Path):
        root = Path(root)
        self.dir = root / "spent-patent-nonces"
        self.dir.mkdir(parents=True, exist_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Patent-license grant")
    sub = parser.add_subparsers(dest="cmd", required=True)
    iss = sub.add_parser("issue")
    iss.add_argument("--seed", required=True, help="patentee root seed hex file")
    iss.add_argument("--patentee-pk", required=True)
    iss.add_argument("--patent-docket-id", required=True)
    iss.add_argument("--licensee-pk", required=True)
    iss.add_argument("--scope-digest", required=True)
    iss.add_argument("--nonce", required=True)
    iss.add_argument("--expiry", type=int, required=True)
    iss.add_argument("--out", required=True)
    vf = sub.add_parser("verify")
    vf.add_argument("grant")
    vf.add_argument("--now", type=int, default=None)
    args = parser.parse_args(argv)

    if args.cmd == "issue":
        seed = require_hex(Path(args.seed).read_text().strip(), 32)
        pk = require_hex(Path(args.patentee_pk).read_text().strip(), 32)
        licensee = require_hex(Path(args.licensee_pk).read_text().strip(), 32)
        grant = issue(
            seed=seed,
            patentee_root_pk=pk,
            patent_docket_id=args.patent_docket_id,
            licensee_pk=licensee,
            scope_digest=args.scope_digest,
            nonce=args.nonce,
            expiry=args.expiry,
        )
        write_json(Path(args.out), grant)
        return 0
    grant = read_json(Path(args.grant))
    verify_patent_license(
        grant, now=args.now if args.now is not None else int(time.time())
    )
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
