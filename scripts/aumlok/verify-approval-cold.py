#!/usr/bin/env python3
"""Genesis code-card verifier; independent Diamond parsing, digest and Ed25519.

No memory {key,value} canonicalization: the operation is the exact shown bytes.
Evidence only; the kernel still decides authorization. Python 3.9, stdlib only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "vendor/kira-export"))
from diamond import approval_artifact as diamond, ed25519
from diamond.kira_evidence import Refusal


def require(condition, code):
    if not condition:
        raise diamond.ArtifactRefusal(code)


class Arguments(argparse.ArgumentParser):
    def error(self, message):
        raise diamond.ArtifactRefusal("APPROVAL_INPUT_MALFORMED")


def read_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "APPROVAL_INPUT_MALFORMED")
        return stream.read()


def canonical_integer(token):
    # Check the JSON spelling before int() erases -0 and other noncanonical forms.
    require(re.fullmatch(r"0|[1-9][0-9]*", token), diamond.MALFORMED)
    return int(token)


def read_document(raw):
    def pairs_hook(pairs):
        document = {}
        for key, value in pairs:
            if key in document:
                raise Refusal("json-duplicate-key", "approval repeats a key")
            document[key] = value
        return document

    def refuse_number(token):
        raise diamond.ArtifactRefusal(diamond.MALFORMED)

    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs_hook,
                      parse_int=canonical_integer, parse_float=refuse_number,
                      parse_constant=refuse_number)


def strict_strings(artifact):
    # Vendored ^...$/.match permits a final newline. Keep its schema, but require
    # the entire parsed string here, before signing bytes or bytes.fromhex.
    patterns = {
        "domain": re.escape(diamond.APPROVAL_RECEIPT_DOMAIN),
        "verdict": re.escape(diamond.OWNER_KEY_SIGNED),
        "keyClass": r"A|B|C",
        "keyClassMeaning": r"device-bound|software-held|operator-custodied",
        "approvalClass": r"human-ceremony|delegated|scripted|unattributed",
        "signature": r"[0-9a-f]{128}",
        "subject": r"aukora:1:[0-9a-f]{64}",
        "approvalKeyDid": r"did:key:z[1-9A-HJ-NP-Za-km-z]+",
        **{field: r"[0-9a-f]{64}" for field in (
            "activeControlDigest", "operationDigest", "challenge", "signedBytesDigest")},
        **{field: r"[A-Za-z0-9._:/-]+" for field in (
            "attendance", "signerDeviceTrusted", "succession")},
    }
    for field, pattern in patterns.items():
        require(re.fullmatch(pattern, artifact[field]), diamond.MALFORMED)
    # Ceilings remain unrestricted unsigned strings, as in the receipt schema.
    for line in artifact["ceilings"]:
        require(re.fullmatch(r"[\s\S]*", line), diamond.MALFORMED)


def verify():
    parser = Arguments(description=__doc__, allow_abbrev=False, add_help=False)
    parser.add_argument("approval")
    for flag in ("approver-did", "subject", "control-digest"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--operation")
    parser.add_argument("--operation-digest")
    parser.add_argument("--now", type=int, required=True)
    parser.add_argument("--max-window", type=canonical_integer)
    parser.add_argument("--max-skew", type=canonical_integer)
    args = parser.parse_args()
    require(0 <= args.now <= 2 ** 53 - 1, diamond.INPUT_MALFORMED)
    for seconds in (args.max_window, args.max_skew):
        require(seconds is None or seconds <= 2 ** 53 - 1, diamond.INPUT_MALFORMED)
    require(re.fullmatch(r"aukora:1:[0-9a-f]{64}", args.subject), diamond.INPUT_MALFORMED)
    require(re.fullmatch(r"[0-9a-f]{64}", args.control_digest), diamond.INPUT_MALFORMED)
    require(args.operation is not None or args.operation_digest is not None, diamond.INPUT_MALFORMED)
    if args.operation_digest is not None:
        require(re.fullmatch(r"[0-9a-f]{64}", args.operation_digest), diamond.INPUT_MALFORMED)
    document = read_document(read_bytes(args.approval))
    # json.loads decodes escaped lone surrogates; check every key and value after parsing.
    try:
        json.dumps(document, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except UnicodeError:
        raise diamond.ArtifactRefusal("APPROVAL_LONE_SURROGATE")
    artifact = diamond.parse_artifact(document)
    strict_strings(artifact)
    require(artifact["approvalClass"] != diamond.UNSUPPORTED_APPROVAL_CLASS, diamond.CLASS_UNSUPPORTED)
    require(artifact["attendance"] == diamond.REQUIRED_ATTENDANCE, diamond.ATTENDANCE_UNSUPPORTED)
    require(artifact["identityBound"] is False, diamond.IDENTITY_BOUND_UNSUPPORTED)
    anchor = diamond.raw_from_did_key(args.approver_did)
    require(diamond.raw_from_did_key(artifact["approvalKeyDid"]) == anchor, diamond.KEY_MISMATCH)
    digest = args.operation_digest
    if args.operation is not None:
        derived = diamond.operation_digest_of(read_bytes(args.operation))
        require(digest is None or digest == derived, diamond.CONTENT_MISMATCH)
        digest = derived
    require(artifact["operationDigest"] == digest, diamond.CONTENT_MISMATCH)
    require(artifact["subject"] == args.subject, diamond.SUBJECT_MISMATCH)
    require(artifact["activeControlDigest"] == args.control_digest, "APPROVAL_CONTROL_MISMATCH")
    require(artifact["expiresAt"] > args.now, diamond.EXPIRED)
    if args.max_skew is not None:
        require(artifact["issuedAt"] <= args.now + args.max_skew, "APPROVAL_FUTURE")
    if args.max_window is not None:
        require(artifact["expiresAt"] - artifact["issuedAt"] <= args.max_window,
                "APPROVAL_WINDOW_EXCEEDED")
    preimage = diamond.signing_bytes(artifact)
    require(hashlib.sha256(preimage).hexdigest() == artifact["signedBytesDigest"], diamond.ARTIFACT_INCONSISTENT)
    require(ed25519.verify(bytes.fromhex(anchor), preimage, bytes.fromhex(artifact["signature"])),
            diamond.SIGNATURE_INVALID)


if __name__ == "__main__":
    try:
        verify()
    except (diamond.ArtifactRefusal, Refusal) as error:
        print("REFUSE " + error.code)
        sys.exit(1)
    except Exception:
        # File, decoding, parser and unexpected runtime failures are never acceptance.
        print("REFUSE APPROVAL_INPUT_MALFORMED")
        sys.exit(1)
    print("ACCEPT")
