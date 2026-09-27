#!/usr/bin/env python3
"""Cold consumer for Alpha's existing aukora-freeze/v1 source statement.

The signed message is Alpha stableStringify(body), with the domain INSIDE that
body; there is no domain prefix. This closed subset has ASCII keys/identifiers
and safe nonnegative integers, so compact sorted Python JSON produces the same
bytes as Alpha's recursive key sort plus JSON.stringify. Other values refuse.
No Git, Node, signing, key discovery, source execution, or court rerun occurs.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diamond.ed25519 import verify

FIELDS = frozenset((
    "kind", "subject", "tree", "issuerKeyDigest", "kid", "courtCount", "testCount",
    "unexpected", "platformClaims", "attended", "liveModel", "createdAt", "domain", "signature",
))
SAFE_INTEGER = 2**53 - 1


class Refusal(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Refusal(code)


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def unsupported_number(_text):
    raise Refusal("JSON_UNSUPPORTED_NUMBER")


def parse_json(data):
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=object_pairs,
                          parse_float=unsupported_number, parse_constant=unsupported_number)
    except Refusal:
        raise
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise Refusal("JSON_MALFORMED") from exc


def matches(value, pattern):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def signed_body(document):
    require(isinstance(document, dict) and set(document) == FIELDS, "FREEZE_FIELDS")
    require(document["kind"] == "aukora-freeze/v1", "FREEZE_KIND")
    require(document["domain"] == "aukora:freeze:v1", "FREEZE_DOMAIN")
    for name in ("subject", "tree"):
        require(matches(document[name], r"[0-9a-f]{40}"), "FREEZE_" + name.upper() + "_SHAPE")
    require(matches(document["issuerKeyDigest"], r"[0-9a-f]{64}"), "FREEZE_KEY_DIGEST_SHAPE")
    require(matches(document["kid"], r"[A-Za-z0-9_.:-]+"), "FREEZE_KID_UNSUPPORTED")
    for name in ("courtCount", "testCount", "unexpected", "createdAt"):
        value = document[name]
        require(type(value) is int and 0 <= value <= SAFE_INTEGER, "FREEZE_NUMBER_RANGE")
    require(document["unexpected"] == 0, "FREEZE_UNEXPECTED_NONZERO")
    require(document["platformClaims"] == {"seatbelt": "DARWIN_ONLY"}, "FREEZE_PLATFORM_CLAIMS")
    require(document["attended"] in ("PASS", "UNRUN"), "FREEZE_ATTENDED_LABEL")
    require(document["liveModel"] == "UNRUN", "FREEZE_MODEL_LABEL")
    return {key: value for key, value in document.items() if key != "signature"}


def message_bytes(body):
    # Only called after signed_body validates the complete supported subset.
    return json.dumps(body, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
                      allow_nan=False).encode("ascii")


def verify_statement(manifest_bytes, public_bytes, *, subject, tree):
    require(matches(subject, r"[0-9a-f]{40}"), "EXPECTED_SUBJECT_REQUIRED")
    require(matches(tree, r"[0-9a-f]{40}"), "EXPECTED_TREE_REQUIRED")
    document = parse_json(manifest_bytes)
    body = signed_body(document)
    require(document["subject"] == subject, "FREEZE_SUBJECT_MISMATCH")
    require(document["tree"] == tree, "FREEZE_TREE_MISMATCH")
    public = parse_json(public_bytes)
    require(isinstance(public, dict) and set(public) == {"kty", "crv", "kid", "x"},
            "PUBLIC_KEY_FIELDS")
    require(public["kty"] == "OKP" and public["crv"] == "Ed25519", "PUBLIC_KEY_TYPE")
    require(public["kid"] == document["kid"], "PUBLIC_KEY_KID_MISMATCH")
    require(matches(public["x"], r"[A-Za-z0-9_-]{43}"), "PUBLIC_KEY_ENCODING")
    raw_public = base64.urlsafe_b64decode(public["x"] + "=")
    require(len(raw_public) == 32 and base64.urlsafe_b64encode(raw_public).decode().rstrip("=") == public["x"],
            "PUBLIC_KEY_ENCODING")
    require(hashlib.sha256(public_bytes).hexdigest() == document["issuerKeyDigest"],
            "PUBLIC_KEY_FILE_DIGEST_MISMATCH")
    signature_text = document["signature"]
    require(matches(signature_text, r"[A-Za-z0-9+/]{86}=="), "FREEZE_SIGNATURE_ENCODING")
    signature = base64.b64decode(signature_text, validate=True)
    require(len(signature) == 64 and base64.b64encode(signature).decode() == signature_text,
            "FREEZE_SIGNATURE_ENCODING")
    require(verify(raw_public, message_bytes(body), signature), "FREEZE_SIGNATURE_INVALID")
    return body


def print_scope():
    print("CELL_EXECUTION: NOT_ESTABLISHED")
    print("HUMAN_ATTENDANCE: NOT_ESTABLISHED")
    print("MODEL_EXECUTION: NOT_ESTABLISHED")
    print("CONFINEMENT: NOT_ESTABLISHED")
    print("SOURCE_EXECUTION: NOT_ESTABLISHED")
    print("COURTS_RERUN: NOT_ESTABLISHED")
    print("SOURCE_TREE_CONTENT: NOT_ESTABLISHED")
    print("KEY_ROTATION_CONTINUITY: NOT_ESTABLISHED")
    print("SCOPE: caller-anchored signed statement; source labels and counts are issuer assertions")


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal("CLI_ARGUMENTS: " + message)


def main(argv=None):
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--pub", required=True, type=Path, help="separately supplied exact public JWK file")
    parser.add_argument("--subject", required=True, help="independently expected 40-hex source commit")
    parser.add_argument("--tree", required=True, help="independently expected 40-hex source tree")
    try:
        args = parser.parse_args(argv)
        body = verify_statement(args.manifest.read_bytes(), args.pub.read_bytes(),
                                subject=args.subject, tree=args.tree)
        print("SIGNED_SOURCE_STATEMENT_VALID")
        print("SUBJECT: " + body["subject"])
        print("TREE: " + body["tree"])
        print(f"SIGNED_COUNTS_REPORTED: courts={body['courtCount']} tests={body['testCount']} unexpected={body['unexpected']}")
        print(f"SIGNED_LABELS_REPORTED: attended={body['attended']} liveModel={body['liveModel']}")
        return 0
    except Refusal as exc:
        print("REFUSED: " + str(exc), file=sys.stderr)
        return 2
    except (OSError, ValueError) as exc:
        print("REFUSED: INPUT_UNREADABLE_OR_MALFORMED (" + type(exc).__name__ + ")", file=sys.stderr)
        return 2
    finally:
        print_scope()


if __name__ == "__main__":
    raise SystemExit(main())
