#!/usr/bin/env python3
"""RFC-6962-style retained-vs-presented consistency (minimal membrane).

Verdicts ONLY: APPEND_ONLY | OBSERVATION_CONFLICT | UNDETERMINED.

Known limit: when retained size is a power of two and presented size is
greater, the verdict is UNDETERMINED (RFC 9162 §2.1.4.2 step 2 is not
implemented). See ../CLAIM.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Iterable

VERDICTS = ("APPEND_ONLY", "OBSERVATION_CONFLICT", "UNDETERMINED")


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def leaf_hash(entry: bytes) -> bytes:
    return sha256(b"\x00" + entry)


def node_hash(left: bytes, right: bytes) -> bytes:
    return sha256(b"\x01" + left + right)


def largest_pow2_lt(n: int) -> int:
    k = 1
    while (k << 1) < n:
        k <<= 1
    return k


def is_pow2(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def mth(leaves: list[bytes]) -> bytes:
    n = len(leaves)
    if n == 0:
        return sha256(b"")
    if n == 1:
        return leaf_hash(leaves[0])
    k = largest_pow2_lt(n)
    return node_hash(mth(leaves[:k]), mth(leaves[k:]))


def consistency_proof(m: int, leaves: list[bytes]) -> list[bytes]:
    n = len(leaves)
    if not (0 < m <= n):
        raise ValueError("m out of range")
    if m == n:
        return []
    return _subproof(m, leaves, True)


def _subproof(m: int, leaves: list[bytes], known: bool) -> list[bytes]:
    n = len(leaves)
    if m == n:
        return [] if known else [mth(leaves)]
    k = largest_pow2_lt(n)
    if m <= k:
        return _subproof(m, leaves[:k], known) + [mth(leaves[k:])]
    return _subproof(m - k, leaves[k:], False) + [mth(leaves[:k])]


def _parse_hash(value: object) -> bytes:
    if not isinstance(value, str) or len(value) != 64:
        raise ValueError("hash")
    raw = bytes.fromhex(value)
    if len(raw) != 32:
        raise ValueError("hash")
    return raw


def rfc9162_verify(
    first: int,
    second: int,
    first_root: bytes,
    second_root: bytes,
    path: list[bytes],
    *,
    prepend_pow2: bool,
) -> bool:
    """RFC 9162 §2.1.4.2. `prepend_pow2=False` is the minimal membrane."""
    if first <= 0 or second <= 0 or first > second:
        return False
    if first == second:
        return (not path) and first_root == second_root
    if not path and not (prepend_pow2 and is_pow2(first)):
        return False
    if prepend_pow2 and is_pow2(first):
        elems = [first_root, *path]
    else:
        elems = list(path)
    if not elems:
        return False
    fn = first - 1
    sn = second - 1
    while fn & 1:
        fn >>= 1
        sn >>= 1
    fr = elems[0]
    sr = elems[0]
    for c in elems[1:]:
        if sn == 0:
            return False
        if (fn & 1) or fn == sn:
            fr = node_hash(c, fr)
            sr = node_hash(c, sr)
            if (fn & 1) == 0:
                while (fn & 1) == 0 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            sr = node_hash(sr, c)
        fn >>= 1
        sn >>= 1
    return fr == first_root and sr == second_root and sn == 0


def decide(retained: dict, presented: dict) -> str:
    try:
        n = retained["size"]
        n2 = presented["size"]
        if type(n) is bool or type(n2) is bool:
            return "UNDETERMINED"
        n = int(n)
        n2 = int(n2)
        first_root = _parse_hash(retained["root"])
        second_root = _parse_hash(presented["root"])
        raw_path = presented.get("consistency_path", [])
        if raw_path is None:
            raw_path = []
        if not isinstance(raw_path, list):
            return "UNDETERMINED"
        path = [_parse_hash(item) for item in raw_path]
    except (KeyError, TypeError, ValueError):
        return "UNDETERMINED"

    if n < 1 or n2 < 1:
        return "UNDETERMINED"
    if n == n2:
        if first_root == second_root and not path:
            return "APPEND_ONLY"
        return "OBSERVATION_CONFLICT"
    if n > n2:
        return "OBSERVATION_CONFLICT"
    if is_pow2(n):
        return "UNDETERMINED"
    if rfc9162_verify(n, n2, first_root, second_root, path, prepend_pow2=False):
        return "APPEND_ONLY"
    return "OBSERVATION_CONFLICT"


def mutate_presented(presented: dict) -> dict:
    """Flip the last nibble of presented.root so a valid pair becomes a fork."""
    out = json.loads(json.dumps(presented))
    root = out.get("root")
    if not isinstance(root, str) or len(root) < 1:
        raise ValueError("presented.root missing")
    last = root[-1]
    flipped = "0" if last != "0" else "1"
    out["root"] = root[:-1] + flipped
    return out


def load_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("expected object")
    return data


def _pair_from_args(args: argparse.Namespace) -> tuple[dict, dict]:
    if args.pair:
        blob = load_json(Path(args.pair))
        return blob["retained"], blob["presented"]
    if args.retained and args.presented:
        return load_json(Path(args.retained)), load_json(Path(args.presented))
    raise SystemExit("verify.py: provide PAIR.json or --retained and --presented")


def _hex(raw: bytes) -> str:
    return raw.hex()


def build_tree(n: int, seed: bytes = b"aukora-toy") -> list[bytes]:
    leaves = []
    for i in range(n):
        leaves.append(sha256(seed + i.to_bytes(4, "big")))
    return leaves


def emit_pair(m: int, n: int, seed: bytes = b"aukora-toy") -> dict:
    leaves = build_tree(n, seed)
    return {
        "retained": {"size": m, "root": _hex(mth(leaves[:m]))},
        "presented": {
            "size": n,
            "root": _hex(mth(leaves)),
            "consistency_path": [_hex(p) for p in consistency_proof(m, leaves)],
        },
    }


def selftest() -> None:
    here = Path(__file__).resolve().parent / "vectors"
    expected = {
        "append_only.json": "APPEND_ONLY",
        "conflict.json": "OBSERVATION_CONFLICT",
        "undetermined_pow2.json": "UNDETERMINED",
        "same_size_ok.json": "APPEND_ONLY",
        "same_size_fork.json": "OBSERVATION_CONFLICT",
    }
    for name, verdict in expected.items():
        blob = load_json(here / name)
        got = decide(blob["retained"], blob["presented"])
        if got != verdict:
            raise SystemExit(f"selftest {name}: want {verdict} got {got}")

    # Generative: non-pow2 retain must decide; pow2 retain must stay UNDETERMINED.
    for n in range(2, 18):
        leaves = build_tree(n)
        root_n = mth(leaves)
        for m in range(1, n + 1):
            retained = {"size": m, "root": _hex(mth(leaves[:m]))}
            presented = {
                "size": n,
                "root": _hex(root_n),
                "consistency_path": [_hex(p) for p in consistency_proof(m, leaves)],
            }
            got = decide(retained, presented)
            if m == n:
                if got != "APPEND_ONLY":
                    raise SystemExit(f"selftest equal {m}: {got}")
                continue
            if is_pow2(m):
                if got != "UNDETERMINED":
                    raise SystemExit(f"selftest pow2 limit {m}->{n}: {got}")
                # A fuller verifier (not this membrane) would accept the pair.
                if not rfc9162_verify(
                    m, n, mth(leaves[:m]), root_n,
                    [bytes.fromhex(p) for p in presented["consistency_path"]],
                    prepend_pow2=True,
                ):
                    raise SystemExit(f"selftest internal proof {m}->{n} invalid")
            else:
                if got != "APPEND_ONLY":
                    raise SystemExit(f"selftest append {m}->{n}: {got}")
                mutant = mutate_presented(presented)
                if decide(retained, mutant) != "OBSERVATION_CONFLICT":
                    raise SystemExit(f"selftest mutant {m}->{n} did not conflict")

    # Rewind is a conflict (when retain is not a growing pow2 case).
    pair = emit_pair(3, 5)
    rewind = {
        "retained": pair["presented"],
        "presented": {**pair["retained"], "consistency_path": []},
    }
    if decide(rewind["retained"], rewind["presented"]) != "OBSERVATION_CONFLICT":
        raise SystemExit("selftest rewind")

    print("selftest: ok")


def write_vectors(dir_path: Path) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)
    good = emit_pair(3, 5)
    (dir_path / "append_only.json").write_text(
        json.dumps(good, indent=2) + "\n", encoding="utf-8"
    )
    conflict = {"retained": good["retained"], "presented": mutate_presented(good["presented"])}
    (dir_path / "conflict.json").write_text(
        json.dumps(conflict, indent=2) + "\n", encoding="utf-8"
    )
    pow2 = emit_pair(2, 5)
    (dir_path / "undetermined_pow2.json").write_text(
        json.dumps(pow2, indent=2) + "\n", encoding="utf-8"
    )
    leaves = build_tree(4)
    same = {
        "retained": {"size": 4, "root": _hex(mth(leaves))},
        "presented": {"size": 4, "root": _hex(mth(leaves)), "consistency_path": []},
    }
    (dir_path / "same_size_ok.json").write_text(
        json.dumps(same, indent=2) + "\n", encoding="utf-8"
    )
    fork = {
        "retained": same["retained"],
        "presented": {
            "size": 4,
            "root": _hex(bytes(b ^ 1 if i == 31 else b for i, b in enumerate(mth(leaves)))),
            "consistency_path": [],
        },
    }
    (dir_path / "same_size_fork.json").write_text(
        json.dumps(fork, indent=2) + "\n", encoding="utf-8"
    )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Phase 0 minimal membrane")
    parser.add_argument("pair", nargs="?", help="JSON object {retained, presented}")
    parser.add_argument("--retained", help="retained checkpoint JSON")
    parser.add_argument("--presented", help="presented checkpoint JSON")
    parser.add_argument("--mutate", action="store_true", help="flip presented.root")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--write-vectors", metavar="DIR", help=argparse.SUPPRESS)
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.write_vectors:
        write_vectors(Path(args.write_vectors))
        return 0
    if args.selftest:
        selftest()
        return 0

    retained, presented = _pair_from_args(args)
    if args.mutate:
        presented = mutate_presented(presented)
    verdict = decide(retained, presented)
    print(verdict)
    return {"APPEND_ONLY": 0, "OBSERVATION_CONFLICT": 2, "UNDETERMINED": 3}[verdict]


if __name__ == "__main__":
    sys.exit(main())
