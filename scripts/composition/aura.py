#!/usr/bin/env python3
"""The composition Aura: an append-only, hash-linked log of composition transitions.

WHY A LOG AT ALL. A receipt that says "bytes with digest D were loaded" is a
statement with nothing behind it. The log is what makes the statement
*positional*: this load happened at sequence 4, its entry hash is H, the head
before it was P, and the head after it is H. A receipt is then a signed claim
about a specific position in a specific log, and a reader who holds the log can
check the claim instead of believing it.

WHAT THE ROOT IS. `root()` is an RFC 6962 Merkle tree head over the entry
hashes, with the two prefixes the RFC specifies: leaves are `sha256(0x00 ||
entry_bytes)` and interior nodes are `sha256(0x01 || left || right)`. The empty
tree is `sha256("")`, matching the toy. Phase 0's read side (scripts/phase0/phase0log.py) shares the
interior-node rule but not the leaf rule: it indexes raw 64-hex line digests with no 0x00 prefix, so the two
roots are different constructions and a comparison must name which one it uses.

WHY THE CHECKPOINT IS A DIRECT PREFIX ROOT, NOT AN RFC 6962 CONSISTENCY PROOF.
A retained observation under this design is the tree head over the first N
entries. `checkpoint()` recomputes that head from the entries themselves, so
`verify_consistency` can confirm a retained root by recomputation — for every N,
including a power of two. That is deliberately the *simpler* and *stronger*
check available to a party who holds the log, and it is the opposite trade from
Phase 0, which must judge a presented head from a proof because it does not hold
the log. The difference is stated in `verify_consistency`'s own comment, because
the same fact is a known limit there and a non-issue here.

WHAT IT DOES NOT ESTABLISH. append-only-ness of the bytes on disk. Anyone who
can write this file can rewrite the whole log and recompute every hash in it,
and the result is internally perfect. That is exactly what Phase 0 and a
retainer outside this host exist to catch, and it is why a receipt over this log
prints its consistency verdict as either measured against a supplied pair or
`CONSISTENCY_UNCHECKED` — never as agreement by default.
"""
from __future__ import annotations

import json
import os

from hexutil import sha256, sha256_hex, to_hex
from jcs import canonicalize_bytes

ZERO = "0" * 64
RECORDS_RELPATH = os.path.join("aura", "records.jsonl")
LEAF_PREFIX = b"\x00"
NODE_PREFIX = b"\x01"

#: Named because the choice is load-bearing and a reader must be able to see which
#: convention produced a root. `sha256(0x00 || entry)` / `sha256(0x01 || l || r)`.
LEAF_CONVENTION = "rfc6962-leaf-sha256-0x00-prefixed-v1"
TREE_CONVENTION = "rfc6962-merkle-tree-sha256-v1"


class AuraError(Exception):
    """A log that cannot be read as the log it claims to be. Never a silent repair."""


def leaf_hash(entry_bytes: bytes) -> bytes:
    return sha256(LEAF_PREFIX + entry_bytes)


def node_hash(left: bytes, right: bytes) -> bytes:
    return sha256(NODE_PREFIX + left + right)


def split_point(length: int) -> int:
    """RFC 6962 §2.1: the largest power of two strictly less than `length`."""
    point = 1
    while point * 2 < length:
        point *= 2
    return point


def tree_head(entry_hashes: list[bytes]) -> bytes:
    if not entry_hashes:
        return sha256(b"")
    if len(entry_hashes) == 1:
        return leaf_hash(entry_hashes[0])
    point = split_point(len(entry_hashes))
    return node_hash(tree_head(entry_hashes[:point]), tree_head(entry_hashes[point:]))


def entry_payload(seq: int, prev: str, body: dict) -> dict:
    return {"body": body, "prev": prev, "seq": seq}


def entry_hash(payload: dict) -> str:
    return sha256_hex(canonicalize_bytes(payload))


class Aura:
    def __init__(self, store: str):
        self.store = store
        self.entries: list[dict] = []
        if os.path.exists(store):
            self._load()

    # ── reading ────────────────────────────────────────────────────────────────────────────

    def _load(self) -> None:
        """Read the log back and re-derive every hash. A log whose stored hash does
        not match its own bytes, whose sequence numbers are not 1..N, or whose `prev`
        does not chain is a refusal: reading it as if it were intact would attribute
        later entries to an earlier head that never existed."""
        try:
            with open(self.store, "r", encoding="utf-8") as fh:
                lines = fh.read().splitlines()
        except UnicodeDecodeError as exc:
            raise AuraError(f"aura_log_is_not_utf8: {self.store}: {exc}") from exc
        previous = ZERO
        for number, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except ValueError as exc:
                raise AuraError(f"aura_{number}_is_not_admissible_json: {exc}") from exc
            if not isinstance(record, dict) or "body" not in record:
                raise AuraError(f"aura_{number}_has_no_body")
            if record.get("seq") != number:
                raise AuraError(f"aura_seq_gap: line {number} says seq {record.get('seq')!r}")
            if record.get("prev") != previous:
                raise AuraError(f"aura_prev_break_at_seq_{number}")
            payload = entry_payload(record["seq"], record["prev"], record["body"])
            digest = entry_hash(payload)
            if record.get("hash") != digest:
                raise AuraError(f"aura_hash_mismatch_at_seq_{number}")
            self.entries.append({**payload, "hash": digest})
            previous = digest

    def _persist(self) -> None:
        directory = os.path.dirname(os.path.abspath(self.store))
        os.makedirs(directory, exist_ok=True)
        with open(self.store, "w", encoding="utf-8") as fh:
            for record in self.entries:
                fh.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")

    # ── positions ──────────────────────────────────────────────────────────────────────────

    def size(self) -> int:
        return len(self.entries)

    def head(self) -> str:
        """The hash of the last entry, or 64 zeros when the log is empty. The zero
        string is the genesis `prev`, so an empty log still has a nameable head
        rather than `None`, which callers would eventually forget to check."""
        return self.entries[-1]["hash"] if self.entries else ZERO

    def head_before(self, seq: int) -> str:
        """The head as it stood immediately before entry `seq` was appended.

        This is the PREVIOUS ENTRY'S HASH, re-derived here from the entry that precedes it,
        and it is deliberately not read from `self.entries[seq-2]["prev"]`. Those two agree
        in a healthy log and are NOT the same claim: `prev` is what entry N-1 *asserted*
        about its predecessor when it was appended, while this is what entry N-1 actually
        hashes to. Reading `prev` would make every later comparison of the form
        `head_before(seq) == prev_of(seq-1)` true by construction — a tautology that would
        hide exactly the corruption it looks like it is checking for.

        A stored `prev` that disagrees with the recomputed hash is a refusal, not a value to
        be preferred: the log is hash-linked, so a break in that link means every later
        entry is attributed to a head that never existed.
        """
        if seq < 1 or seq > self.size():
            raise AuraError(f"no_such_entry: seq {seq} of {self.size()}")
        if seq == 1:
            return ZERO
        previous = self.entries[seq - 2]
        actual = previous["hash"]
        if previous["prev"] != (self.entries[seq - 3]["hash"] if seq >= 3 else ZERO):
            raise AuraError(
                f"aura_prev_break_at_seq_{seq - 1}: stored prev {previous['prev'][:16]}… "
                f"does not match the hash of the entry before it"
            )
        return actual

    def entry_hashes(self, upto: int | None = None) -> list[bytes]:
        selected = self.entries if upto is None else self.entries[:upto]
        return [bytes.fromhex(record["hash"]) for record in selected]

    def root(self, upto: int | None = None) -> str:
        return to_hex(tree_head(self.entry_hashes(upto)))

    # ── writing ────────────────────────────────────────────────────────────────────────────

    def append(self, body: dict) -> dict:
        seq = self.size() + 1
        payload = entry_payload(seq, self.head(), body)
        record = {**payload, "hash": entry_hash(payload)}
        self.entries.append(record)
        self._persist()
        return record

    def entry_view(self, seq: int) -> dict:
        """The receipt's `aura` block: where this entry sits, and what the heads were.

        `priorHead` is the vault-brick addition over the toy's v3 aura block, and
        `receipt.py` carries the paragraph explaining why. In one line: a receipt
        that names only its own head cannot be checked for *position* by a reader
        who was handed the receipt and a retained observation but not the log.
        """
        if seq < 1 or seq > self.size():
            raise AuraError(f"no_such_entry: seq {seq} of {self.size()}")
        record = self.entries[seq - 1]
        return {
            "entryHash": record["hash"],
            "head": self.head(),
            "prevHash": record["prev"],
            "priorHead": self.head_before(seq),
            "root": self.root(),
            "seq": record["seq"],
            "size": self.size(),
        }

    # ── checkpoints, and the one court this module can run by itself ───────────────────────

    def checkpoint(self) -> dict:
        """A retained observation: size plus the tree head over exactly that prefix."""
        if self.size() < 1:
            raise AuraError("empty_aura_has_no_checkpoint")
        return {
            "size": self.size(),
            "root": self.root(),
            "head": self.head(),
            "leafConvention": LEAF_CONVENTION,
            "tree": TREE_CONVENTION,
        }

    def verify_consistency(self, retained: dict, presented: dict) -> tuple[str, str]:
        """Compare a retained observation with a presented one. Returns
        (verdict, note).

        Verdicts, in the same vocabulary the rest of this repository uses:

        - `APPEND_ONLY`  — the presented tree is the retained tree extended. Every
          entry in the retained prefix is present, in order, at the same position,
          unchanged. This is checked by recomputing the retained root over the
          presented entry hashes, so it holds at every retained size including a
          power of two. (Phase 0's court must return `UNDETERMINED` at a
          power-of-two retained size because it judges a *proof* rather than the
          log; here the log is in hand, so the case does not arise. Same fact,
          different court, and the difference is worth knowing when reading both.)
        - `OBSERVATION_CONFLICT` — the presented tree cannot be an extension of the
          retained one: a root disagrees, or the presented tree is smaller.
        - `UNDETERMINED` — a document is malformed or carries a convention this
          reader does not implement. Reported as undetermined rather than as
          agreement, because a document we cannot read is not evidence of anything.

        This proves nothing about whether the earlier bytes were ever really
        published. It compares two documents the caller supplied.
        """
        for label, document in (("retained", retained), ("presented", presented)):
            if not isinstance(document, dict):
                return "UNDETERMINED", f"{label} document is not an object"
            for field in ("size", "root", "leafConvention", "tree"):
                if field not in document:
                    return "UNDETERMINED", f"{label} document has no {field}"
            if document["leafConvention"] != LEAF_CONVENTION:
                return "UNDETERMINED", f"{label} leaf convention {document['leafConvention']!r} is not implemented"
            if document["tree"] != TREE_CONVENTION:
                return "UNDETERMINED", f"{label} tree convention {document['tree']!r} is not implemented"
            size = document["size"]
            if isinstance(size, bool) or not isinstance(size, int) or size < 1:
                return "UNDETERMINED", f"{label} size {size!r} is not a positive integer"
        if presented["size"] < retained["size"]:
            return "OBSERVATION_CONFLICT", (
                f"presented size {presented['size']} is smaller than retained size {retained['size']}"
            )
        if retained["size"] > self.size():
            return "UNDETERMINED", (
                f"retained size {retained['size']} is beyond the log's {self.size()} entries"
            )
        if presented["size"] > self.size():
            return "UNDETERMINED", (
                f"presented size {presented['size']} is beyond the log's {self.size()} entries"
            )
        recomputed_retained = self.root(retained["size"])
        if recomputed_retained != retained["root"]:
            return "OBSERVATION_CONFLICT", (
                f"retained root {retained['root'][:16]}… is not the root of the first "
                f"{retained['size']} entries, which is {recomputed_retained[:16]}…"
            )
        recomputed_presented = self.root(presented["size"])
        if recomputed_presented != presented["root"]:
            return "OBSERVATION_CONFLICT", (
                f"presented root {presented['root'][:16]}… is not the root of the first "
                f"{presented['size']} entries, which is {recomputed_presented[:16]}…"
            )
        return "APPEND_ONLY", (
            f"first {retained['size']} entries unchanged; presented {presented['size']} is an extension"
        )
