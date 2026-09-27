#!/usr/bin/env python3
"""Read-only Alpha legacy evidence: only explicit caller-supplied files are read."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from profiles.alpha.legacy.keychain import validate_keychain
from profiles.alpha.legacy.receipt import parse_json, require, verify_receipt

SCOPES = ("CELL_EXECUTION: NOT_ESTABLISHED", "HUMAN_ATTENDANCE: NOT_ESTABLISHED",
          "CONFINEMENT: NOT_ESTABLISHED", "EFFECT_EXECUTION: NOT_ESTABLISHED",
          "SOURCE_TREE_CONTENT: NOT_ESTABLISHED", "COMPLETENESS: UNDETERMINED",
          "LATESTNESS: NO_LATESTNESS")


def read_supplied(path):
    require(isinstance(path, str) and bool(path), "ALPHA_LEGACY_INPUT_PATH_REQUIRED")
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_size <= 4 * 1024 * 1024, "ALPHA_LEGACY_INPUT_FILE_LIMIT")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(4 * 1024 * 1024 + 1)
        require(len(raw) <= 4 * 1024 * 1024, "ALPHA_LEGACY_INPUT_FILE_LIMIT")
        return raw
    finally:
        os.close(fd)


def main(argv=None):
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        for name in ("receipt", "log", "pub", "subject", "effect"):
            parser.add_argument("--" + name, required=True)
        parser.add_argument("--keychain", help="Explicit JSON {active,public_keys,rotations}; public root still supplied separately")
        parser.add_argument("--retained-tip", action="append", default=[], help="Separate file containing an externally retained tip")
        parser.add_argument("--source", help="Supplied v2 source evidence bytes")
        parser.add_argument("--definition", help="Supplied v2 inert effect-definition bytes; never executed")
        args = parser.parse_args(argv)
        root = parse_json(read_supplied(args.pub))
        keychain = {"active": None, "public_keys": {}, "rotations": []}
        if args.keychain is not None:
            keychain = parse_json(read_supplied(args.keychain))
            require(isinstance(keychain, dict) and set(keychain) == {"active", "public_keys", "rotations"},
                    "ALPHA_LEGACY_KEYCHAIN_FIELDS")
        hierarchy = validate_keychain(root, **keychain)
        entries = [parse_json(line) for line in read_supplied(args.log).splitlines() if line.strip()]
        tips = [read_supplied(path).decode("ascii").strip() for path in args.retained_tip]
        require(all(tips), "ALPHA_LEGACY_RETAINED_TIP_EMPTY")
        result = verify_receipt(parse_json(read_supplied(args.receipt)), entries, hierarchy,
                                subject=args.subject, effect_bytes=read_supplied(args.effect),
                                source_bytes=read_supplied(args.source) if args.source is not None else None,
                                definition_bytes=read_supplied(args.definition) if args.definition is not None else None,
                                retained=tips)
        print(json.dumps(result, sort_keys=True))
        print("ALPHA LEGACY: " + result["status"])
        return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError) as exc:
        code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r"(?:[A-Z][A-Z0-9_:-]*|alpha-keychain:[a-z0-9-]+)", str(exc)) else "ALPHA_LEGACY_INPUT_INVALID"
        print("REFUSED: " + code)
        return 2
    finally:
        for line in SCOPES:
            print(line)


if __name__ == "__main__":
    sys.exit(main())
