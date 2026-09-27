#!/usr/bin/env python3
"""Phase 0 consistency — RFC 6962 tree, proofs, and the append-only record stream.

Genesis owns this file, not the vendored court. It carries three things:

1. The RFC 6962 arithmetic a *producer* needs: leaf hashing, the Merkle tree head
   over the first N leaves, and a consistency proof from size N to size M. The
   consumer side is the vendored `vendor/append-only/verify.py`, which is
   never imported here and never modified: `scripts/phase0/verify` runs it as a
   separate process so the two sides stay independent.
2. The disposable Aura record stream: one JSONL file, treated as append-only by
   construction. Line k's payload hash is leaf k.
3. Retained and presented observations on the wire shape the membrane court
   publishes (`schema`, `chainKey`, `leafConvention`, `treeSize`, `root`,
   `atGeneration`, plus `proofFromPrevious` on the presented document), so a
   stranger holding only verify.py can check Genesis documents with no Genesis
   code at all.

Leaf convention — measured against the published files, not assumed. The court's
vectors and demo heads index RAW 64-hex leaf digests (`aukora-receipt-line-sha256-v1`:
the chain hash of each line, already a digest), and `leafHash` there is a bare
sha256 with NO leaf prefix; internal nodes are sha256(0x01 || left || right).

An earlier draft of this file did the other thing — sha256(0x00 || raw record bytes),
the RFC 6962 §2.1 reading — and it verified only when the retained size was NOT a
power of two. At `m = 2^k` the court uses the retained root itself as the fold
convergence seed, so the root enters the arithmetic directly and the two conventions
stop agreeing: every honest power-of-two pair came back
`POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE`. That is a producer/consumer seam
defect dressed as a limitation of the mathematics, and the arms in
`scripts/phase0/selfcheck.py` are what caught it. The record stream's line hash is
therefore the leaf, and this file never prefixes it.

NOT A TRUST ROOT. Nothing here proves that today's records are the ones that were
retained, that a record is true, or that only one log exists. It computes what the
court judges.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

NODE_PREFIX = b"\x01"
# The wire convention this producer speaks. Named for what it is: each leaf is the
# sha256 chain hash of one line, presented as a digest rather than re-hashed bytes.
LEAF_CONVENTION = "aukora-receipt-line-sha256-v1"
WIRE_SCHEMA = "aukora-head-log-v1"
GENESIS_DOMAIN = "aukora:aura-checkpoint:v1"


class Phase0Error(Exception):
    """A refusal with a reason. Never a silent skip: callers print the reason."""


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def line_digest(payload: bytes) -> bytes:
    """The chain hash of one record line. This digest IS the leaf."""
    return sha256(payload)


def leaf_hash(leaf_digest: bytes) -> bytes:
    """Identity by the wire convention, with the shape check that keeps it honest.

    Kept as a named function rather than inlined so the seam is visible in one place:
    a future reader who imports RFC 6962's prefixed leaf hashing will find this
    comment instead of a silent 32-byte mismatch.
    """
    if len(leaf_digest) != 32:
        raise Phase0Error(f"leaf_must_be_a_32_byte_digest: got {len(leaf_digest)}")
    return leaf_digest


def node_hash(left: bytes, right: bytes) -> bytes:
    return sha256(NODE_PREFIX + left + right)


def split_point(length: int) -> int:
    """RFC 6962 §2.1: the largest power of two strictly less than `length`."""
    point = 1
    while point * 2 < length:
        point *= 2
    return point


def tree_head(leaf_hashes: list[bytes]) -> bytes:
    """MTH of the whole list. Empty list means there is no observation to make."""
    if not leaf_hashes:
        raise Phase0Error("empty_tree_has_no_head")
    if len(leaf_hashes) == 1:
        return leaf_hashes[0]
    point = split_point(len(leaf_hashes))
    return node_hash(tree_head(leaf_hashes[:point]), tree_head(leaf_hashes[point:]))


def proof_from(size1: int, leaf_hashes: list[bytes]) -> list[bytes]:
    """Consistency proof from size1 to len(leaf_hashes).

    Ported branch for branch from the membrane's `consistencyProof`
    (`organs/merkle/merkle.ts`, commit d8b17fac), because the shape of this proof is
    not something to re-derive from memory: it starts the walk with `complete = true`,
    and starting it false emits one extra node and rejects every power-of-two retained
    size. That exact mistake was made here first, and `selfcheck.py` caught it.

    A refusal rather than a guess when the arguments cannot describe a proof: size1 < 1
    has nothing to retain, size1 > len is a retained observation of the future.
    """
    size2 = len(leaf_hashes)
    if not isinstance(size1, int) or not isinstance(size2, int):
        raise Phase0Error("proof_sizes_must_be_integers")
    if size1 < 1:
        raise Phase0Error("nothing_to_retain: size1 must be at least 1")
    if size1 > size2:
        raise Phase0Error("retained_size_exceeds_presented_size")
    if size1 == size2:
        return []
    return _walk(size1, leaf_hashes, True)


def _walk(prefix: int, hashes: list[bytes], complete: bool) -> list[bytes]:
    if prefix == len(hashes):
        return [] if complete else [tree_head(hashes)]
    point = split_point(len(hashes))
    if prefix <= point:
        return _walk(prefix, hashes[:point], complete) + [tree_head(hashes[point:])]
    return _walk(prefix - point, hashes[point:], False) + [tree_head(hashes[:point])]


# ── the append-only record stream ───────────────────────────────────────────────────────────

def stream_path(state_root: str, log: str | None = None) -> str:
    """The record stream this observation is over.

    `log` names a stream directly, which is what lets ONE producer cover a second
    ledger. Genesis keeps two: the composition/admission log at
    `<state_root>/aura/records.jsonl`, and Kira's memory ledger at
    `<kira-state>/aura.jsonl`. They are different files with different hash rules, and
    the court does not care which one it is handed — it checks arithmetic over two
    observations. Defaulting to the composition log keeps every existing caller on the
    stream it already named; nothing here decides which log is authoritative.
    """
    if log is not None:
        return log
    return os.path.join(state_root, "aura", "records.jsonl")


def retained_dir(state_root: str) -> str:
    return os.path.join(state_root, "retained-heads")


def retained_path(state_root: str, chain_key: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in chain_key)
    return os.path.join(retained_dir(state_root), safe + ".json")


def read_stream(state_root: str, log: str | None = None) -> list[dict]:
    """Read the record stream. Missing stream is a refusal, never an empty log:
    'no records' and 'no log' are different claims and only one of them is true here."""
    path = stream_path(state_root, log)
    if not os.path.exists(path):
        raise Phase0Error(f"no_record_stream: {path}")
    records: list[dict] = []
    with open(path, "rb") as fh:
        for number, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                record = json.loads(line.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise Phase0Error(f"record_{number}_is_not_admissible_json: {exc}") from exc
            records.append(record)
    if not records:
        raise Phase0Error(f"record_stream_is_empty: {path}")
    return records


def leaf_payloads(records: list[dict]) -> list[bytes]:
    """Leaf k is the canonical bytes of record k. Canonical here means sorted keys and
    no insignificant whitespace, so the same record always hashes the same way; a
    record that cannot be serialized is a refusal, not a skipped leaf."""
    payloads = []
    for number, record in enumerate(records, start=1):
        try:
            payloads.append(json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        except (TypeError, ValueError) as exc:
            raise Phase0Error(f"record_{number}_is_not_serializable: {exc}") from exc
    return payloads


def leaf_hashes(state_root: str, log: str | None = None) -> tuple[list[bytes], list[dict]]:
    records = read_stream(state_root, log)
    return [leaf_hash(line_digest(p)) for p in leaf_payloads(records)], records


def observation(size: int, hashes: list[bytes], at_generation: int, chain_key: str) -> dict:
    return {
        "schema": WIRE_SCHEMA,
        "domain": GENESIS_DOMAIN,
        "chainKey": chain_key,
        "epoch": 0,
        "leafConvention": LEAF_CONVENTION,
        "treeSize": size,
        "root": tree_head(hashes[:size]).hex(),
        "atGeneration": at_generation,
        "firstUnverifiedLine": None,
    }


def canonical_bytes(document: dict) -> bytes:
    return json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")


def document_digest(document: dict) -> str:
    return hashlib.sha256(canonical_bytes(document)).hexdigest()


def write_document(path: str, document: dict) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    blob = canonical_bytes(document) + b"\n"
    with open(path, "wb") as fh:
        fh.write(blob)
    return hashlib.sha256(blob).hexdigest()


def read_document(path: str) -> dict:
    try:
        with open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8"))
    except FileNotFoundError as exc:
        raise Phase0Error(f"document_absent: {path}") from exc
    except (UnicodeDecodeError, ValueError) as exc:
        raise Phase0Error(f"document_is_not_admissible_json: {path}: {exc}") from exc


def now_ms() -> int:
    return int(time.time() * 1000)
