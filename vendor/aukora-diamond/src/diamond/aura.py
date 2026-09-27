"""Toy Aura: append-only hash-linked entries plus an RFC-6962 Merkle head."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from diamond.hexutil import read_json, sha256, sha256_hex, to_hex, write_json
from diamond.jcs import canonicalize_bytes

ZERO = "0" * 64


def leaf_hash(entry: bytes) -> bytes:
    return sha256(b"\x00" + entry)


def node_hash(left: bytes, right: bytes) -> bytes:
    return sha256(b"\x01" + left + right)


def largest_pow2_lt(n: int) -> int:
    k = 1
    while (k << 1) < n:
        k <<= 1
    return k


def mth_from_entry_hashes(entry_hashes: list[bytes]) -> bytes:
    n = len(entry_hashes)
    if n == 0:
        return sha256(b"")
    if n == 1:
        return leaf_hash(entry_hashes[0])
    k = largest_pow2_lt(n)
    return node_hash(
        mth_from_entry_hashes(entry_hashes[:k]),
        mth_from_entry_hashes(entry_hashes[k:]),
    )


def consistency_proof(m: int, entry_hashes: list[bytes]) -> list[bytes]:
    n = len(entry_hashes)
    if not (0 < m <= n):
        raise ValueError("m out of range")
    if m == n:
        return []
    return _subproof(m, entry_hashes, True)


def _subproof(m: int, hashes: list[bytes], known: bool) -> list[bytes]:
    n = len(hashes)
    if m == n:
        return [] if known else [mth_from_entry_hashes(hashes)]
    k = largest_pow2_lt(n)
    if m <= k:
        return _subproof(m, hashes[:k], known) + [mth_from_entry_hashes(hashes[k:])]
    return _subproof(m - k, hashes[k:], False) + [mth_from_entry_hashes(hashes[:k])]


def entry_payload(seq: int, prev: str, body: dict) -> dict:
    return {"body": body, "prev": prev, "seq": seq}


def entry_hash(payload: dict) -> str:
    return sha256_hex(canonicalize_bytes(payload))


class Aura:
    def __init__(self, store: Path):
        self.store = store
        self.entries: list[dict] = []
        if store.exists():
            self._load()

    def _load(self) -> None:
        """Load JSONL. Truncate/corrupt mid-file → refuse (never silent fake history).

        Append-only here is cryptographic/logical (hash links + Merkle), not a
        crash-safe disk WAL. A partial last line or broken hash refuses load.
        """
        raw = self.store.read_text(encoding="utf-8")
        # Trailing incomplete line (no final newline after content) is corruption
        # if the file is non-empty and does not end with newline after a full record.
        lines = raw.splitlines()
        if raw and not raw.endswith("\n") and lines:
            # Last line may be truncated JSON — refuse rather than parse partial.
            raise ValueError("aura UNDETERMINED: truncated jsonl (no trailing newline)")
        prev = ZERO
        for i, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"aura UNDETERMINED: corrupt jsonl at line {i}: {exc}"
                ) from exc
            if not isinstance(rec, dict) or "seq" not in rec or "prev" not in rec or "body" not in rec:
                raise ValueError(f"aura UNDETERMINED: malformed record at line {i}")
            payload = entry_payload(rec["seq"], rec["prev"], rec["body"])
            digest = entry_hash(payload)
            if rec.get("hash") != digest:
                raise ValueError(f"aura hash mismatch at seq {rec.get('seq')}")
            if rec["seq"] != i:
                raise ValueError("aura seq gap")
            if rec["prev"] != prev:
                raise ValueError("aura prev break")
            self.entries.append({**payload, "hash": digest})
            prev = digest

    def _persist(self) -> None:
        self.store.parent.mkdir(parents=True, exist_ok=True)
        with self.store.open("w", encoding="utf-8") as fh:
            for rec in self.entries:
                fh.write(json.dumps(rec, separators=(",", ":")) + "\n")

    def _entry_hashes(self) -> list[bytes]:
        return [bytes.fromhex(rec["hash"]) for rec in self.entries]

    def size(self) -> int:
        return len(self.entries)

    def head(self) -> str:
        if not self.entries:
            return ZERO
        return self.entries[-1]["hash"]

    def root(self) -> str:
        return to_hex(mth_from_entry_hashes(self._entry_hashes()))

    def append(self, body: dict) -> dict:
        seq = self.size() + 1
        prev = self.head() if self.entries else ZERO
        payload = entry_payload(seq, prev, body)
        rec = {**payload, "hash": entry_hash(payload)}
        self.entries.append(rec)
        self._persist()
        return rec

    def checkpoint(self, *, with_proof_from: int | None = None) -> dict:
        size = self.size()
        if size < 1:
            raise ValueError("empty aura")
        last = self.entries[-1]
        out: dict[str, Any] = {
            "head": last["hash"],
            "root": self.root(),
            "seq": last["seq"],
            "size": size,
        }
        if with_proof_from is not None:
            if not (0 < with_proof_from <= size):
                raise ValueError("retain size out of range")
            proof = consistency_proof(with_proof_from, self._entry_hashes())
            out["consistency_path"] = [to_hex(p) for p in proof]
        return out

    def entry_view(self, seq: int) -> dict:
        rec = self.entries[seq - 1]
        return {
            "entryHash": rec["hash"],
            "head": self.head(),
            "prevHash": rec["prev"],
            "root": self.root(),
            "seq": rec["seq"],
            "size": self.size(),
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Toy Aura")
    parser.add_argument("--store", required=True)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    ap = sub.add_parser("append")
    ap.add_argument("--body", required=True, help="JSON object")
    rt = sub.add_parser("retain")
    rt.add_argument("--out", required=True)
    pr = sub.add_parser("present")
    pr.add_argument("--retained", required=True)
    pr.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    store = Path(args.store)
    if args.cmd == "init":
        store.parent.mkdir(parents=True, exist_ok=True)
        store.write_text("", encoding="utf-8")
        return 0

    aura = Aura(store)
    if args.cmd == "append":
        body = json.loads(args.body)
        if not isinstance(body, dict):
            raise SystemExit("body must be a JSON object")
        rec = aura.append(body)
        print(json.dumps(rec, separators=(",", ":")))
        return 0
    if args.cmd == "retain":
        write_json(Path(args.out), aura.checkpoint())
        return 0
    if args.cmd == "present":
        retained = read_json(Path(args.retained))
        write_json(Path(args.out), aura.checkpoint(with_proof_from=int(retained["size"])))
        return 0
    raise SystemExit("unknown command")


if __name__ == "__main__":
    sys.exit(main())
