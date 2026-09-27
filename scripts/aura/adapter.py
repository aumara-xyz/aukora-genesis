#!/usr/bin/env python3
"""Aura observation adapter — the lead's transition log, judged by the pinned court.

WHAT THIS IS FOR. The composition gate writes one hash-linked log of transitions at
`<state>/aura/records.jsonl` (`scripts/composition/aura.py`) and one receipt per accepted
transition (`scripts/composition/receipt.py`). The composition's own consistency check
compares two checkpoints *with the log in hand*. The pinned Phase 0 court
(`vendor/append-only/verify.py`) answers the cross-time question for a reader who
holds two JSON documents and no log at all. Nothing joined the two, and they index the
same bytes under DIFFERENT leaf conventions, so a reader could compare a composition root
with a Phase 0 root and conclude the log had forked when it had not.

This file is that join, and only that join. No second ledger, no new receipt, no new hash:

    append   the real producer writes the log and the receipt (scripts/composition/*)
    reopen   a fresh process re-derives every entry hash from the bytes (aura.Aura._load)
    retain   `retain` writes the Phase 0 retained document for a prefix of that log
    extend   the log grows through the same governed path
    verify   `present` writes the presented document with its consistency proof, runs the
             vendored court, and reports three SEPARATE facts:

               ASSOCIATION  is this pair about THIS log, at these positions, for the
                            receipts that name them?
               COURT        what does the pinned court say about the pair alone?
               COMPOSITION  what does the log in hand say about the same two sizes?

WHY ASSOCIATION IS THE POINT. A valid pair proves arithmetic between two documents. It
does not prove the documents are about the log you think they are; a receipt that
verifies proves a signature over a position, not that the position is in this history.
`associate` recomputes both documents' roots and the presented proof from the log's own
bytes and refuses when they disagree, naming the field that disagreed. A pair that is
valid and belongs to another log is the case this exists for: the court still says
APPEND_ONLY, and the association refuses.

THE TWO CONVENTIONS, KEPT APART. Both are computed over the same log lines at the same
positions, and their roots are different numbers by construction:

  Phase 0 — the documents this file writes for the court, and the convention
  `scripts/phase0/phase0log.py` speaks:
      leafConvention `aukora-receipt-line-sha256-v1`
      leaf k = sha256(canonical JSON bytes of log line k), used as the leaf with no
      re-hashing; internal nodes are sha256(0x01 || left || right).

  Composition — what a receipt's `aura.root` and `Loader.checkpoint()` carry:
      leafConvention `rfc6962-leaf-sha256-0x00-prefixed-v1`
      leaf k = sha256(0x00 || entry_hash_k), where `entry_hash_k` is the composition's own
      entry hash over `{body, prev, seq}`.

A comparison between one convention's root and the other's means nothing. This file never
makes one; it prints each root under its own name.

TWO SIGNATURE QUESTIONS, KEPT APART. A receipt carries the public key it names, and a
signature that verifies under that carried key proves the document is self-consistent and
nothing more: anyone can mint a self-consistent receipt under a key of their own. So every
receipt is checked twice and labelled by what actually happened —
`issuer-pinned` when it verifies under `<state>/issuer.pk`, the key this installation
publishes for its issuer (the same file `loader.verify_receipt_against_pair` passes as
`expect_pk`); `carried-key-only` when it verifies under the key it carries but that key is not
the published issuer, or when no issuer key is published at all; and `invalid: …` when it does
not verify. A carried key never becomes an authority here, no network trust is used, and no
owner attendance is claimed.

WHAT THIS DOES NOT ESTABLISH, on every path and not only on failures: truth, occurrence,
authorization, latestness, custody, or that only one log exists. The retained document
lives in a directory you name, owned by the same uid on the same host; a second local
directory is not an independent retainer. The court's power-of-two blind spot (a retained
size m = 2^k uses the retained root as the fold seed) is reported as UNDETERMINED with its
own reason rather than smoothed into agreement.

EXIT CODES. 0 all three facts green; 3 a verdict was reached and is not APPEND_ONLY; 2 a
named refusal, which means the question could not be asked; 1 unrunnable (bad usage,
unreadable input). A refusal is not a verdict and never prints one.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

# A RELEASE MUST SURVIVE BEING USED. This file imports `aura`, `receipt`, `phase0log` and, on a
# publish or verify, `phase0/retainer.py`; an interpreter allowed to write bytecode caches them
# INSIDE the release. The release's own artifact checker re-measures the tree's file and byte totals
# against `strip-manifest.json`, which counts that debris, so a release that has been used once
# fails its own `strip-totals-mismatch` check. This is the switch
# `PYTHONDONTWRITEBYTECODE=1` / `python3 -B` sets, set from inside so it holds for a hand-typed
# command. It cannot travel to a CHILD interpreter, so `run_court` passes the environment variable
# to the pinned court it spawns out of the release instead.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COMPOSITION_DIR = os.path.join(ROOT, "scripts", "composition")
PHASE0_DIR = os.path.join(ROOT, "scripts", "phase0")
COURT = os.path.join(ROOT, "vendor", "append-only", "verify.py")

# The composition's modules import each other by bare name and so does scripts/phase0;
# this is the same flat-script idiom, and the same reason for it (scripts/composition/__main__.py).
# `scripts/` itself is deliberately NOT on the path: it would shadow `import aura` with the
# directory `scripts/aura/`.
for directory in (COMPOSITION_DIR, PHASE0_DIR):
    if directory not in sys.path:
        sys.path.insert(0, directory)

import aura as aura_mod  # noqa: E402  (the lead's log arithmetic, read-only)
import phase0log  # noqa: E402  (Genesis's Phase 0 producer arithmetic, read-only)
import receipt as receipt_mod  # noqa: E402  (the accepted receipt contract, read-only)

LOG_RELPATH = os.path.join("aura", "records.jsonl")
#: The host gate's admission ledger. A row here is an admission, never a receipt: the
#: synchronous module-load hook cannot spawn the issuer, so the gate records and the accepted
#: serializer issues. The difference is the whole reason this constant is named here.
LEDGER_NAME = "admissions.jsonl"
#: Where the serializer copies each receipt it issued. The loader writes its own copy in the
#: state root, so one document can legitimately appear at two paths; both are recorded.
RECEIPT_DIR = "receipts"
#: The installation's published issuer public key. `scripts/composition/loader.py` writes it for
#: the key it issues receipts with, and its own `verify_receipt_against_pair` passes it as
#: `expect_pk`. Reading it is the difference between "this document is internally consistent"
#: and "this document was signed by the key this installation publishes".
ISSUER_PUBLIC = "issuer.pk"
WIRE_SCHEMA = "aukora-head-log-v1"
PHASE0_LEAF_CONVENTION = "aukora-receipt-line-sha256-v1"
COMPOSITION_LEAF_CONVENTION = "rfc6962-leaf-sha256-0x00-prefixed-v1"
CHAIN_KEY_PREFIX = "aukora-aura-log-v1:"
#: The label `scripts/phase0/retain-head` writes by default. Recognised only so the refusal
#: can say what it is; it is never accepted as this log's identity, because it names no log.
LEGACY_CHAIN_KEY = "genesis-phase0:aura-chain"
ASSOCIATION_SCHEMA = "aukora-aura-association-v1"

#: Accepted Aura entry field names carried through untouched when an entry body has them.
#: The composition gate's own body uses `kind`/`operation`/`pluginId`; the Deep record
#: schema names `recordId`, `contentSha256`, `receiptSha256` and the authorization tuple.
#: This adapter renames nothing and invents nothing: it reports what an entry says.
CARRIED_FIELDS = (
    "kind",
    "operation",
    "pluginId",
    # The two bindings Diamond requires of a receipt's composition block. They belong in this
    # pass-through list as well, and the omission was a real second gap rather than a tidy-up: an
    # entry whose receipt names a composition the LOG does not carry leaves the two records
    # disagreeing about what was approved. The adapter renames nothing and invents nothing, so a
    # field the producer emits and this list drops is silently lost evidence.
    "compositionDigest",
    "subjectDigest",
    "pluginDigest",
    "coeffecEnvelopeDigest",
    "coeffectEnvelopeDigest",
    "revertOf",
    "recordId",
    "contentSha256",
    "receiptSha256",
    "requestDigest",
    "definitionId",
    "nonce",
    "sequence",
    "key",
    "subject",
    # The settlement binding's own fields, carried by the one body that has them
    # (`scripts/aura/settlement.py`, kind `settlement`). They belong here for the same reason the
    # composition bindings above do: a body field the producer emits and this list drops is
    # silently lost evidence, and these are the fields that let a reader of a row see, without
    # running the settlement bridge, which settlement entry the composition entry carries.
    "settlementEntryHash",
    "settlementSeq",
    "settlementLineSha256",
    "settlementLog",
    "settlementStream",
)

EXIT_GREEN = 0
EXIT_UNRUNNABLE = 1
EXIT_REFUSED = 2
EXIT_NOT_GREEN = 3
VERDICT_LINE = re.compile(r"^VERDICT:\s*(\S+)\s*$", re.MULTILINE)
REASON_LINE = re.compile(r"^REASON\s*:\s*(.+?)\s*$", re.MULTILINE)


class AssociationRefusal(Exception):
    """The pair cannot be shown to be about this log. Never a verdict, always a reason."""

    def __init__(self, code: str, reason: str):
        super().__init__(f"{code}: {reason}")
        self.code = code
        self.reason = reason


# ── reading the log, two ways, from one file ────────────────────────────────────────────────


def issuer_snapshot(state: str) -> dict:
    """One read of this state's published issuer key, and the single answer every caller uses.

    Three outcomes, deliberately distinct and never collapsed:

      `pinned`    the path exists, is readable, and holds a 64-hex public key;
      `absent`    there is no entry at that path at all: this installation publishes no key;
      `unusable`  an entry exists and cannot be used as a key — unreadable, unreadable as text,
                  or not a 64-hex public key.

    "Absent" and "unusable" are different facts: an operator who never published a key and an
    operator whose key file is a directory need different repairs, and a receipt label must not
    imply the first when the second is true. The earlier version returned `None` for both, so an
    existing-but-unreadable file read as "this installation publishes no issuer key" — the
    quieter of the two claims, and the wrong one.

    Exactly one snapshot is taken per verb and passed to classification and to the emitted
    evidence. `entry_associations` has no default and no fallback re-read, so the labels on the
    rows and the issuer block in the manifest cannot describe two different reads.
    """
    path = os.path.join(state, ISSUER_PUBLIC)
    if not os.path.lexists(path):
        return {"status": "absent", "source": path, "publicKey": None, "reason": None, "readable": False}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            key = handle.read().strip()
    except OSError as exc:
        return {"status": "unusable", "source": path, "publicKey": None, "readable": False,
                "reason": f"{type(exc).__name__}: {exc}"}
    except UnicodeDecodeError as exc:
        return {"status": "unusable", "source": path, "publicKey": None, "readable": False,
                "reason": f"not text a key can be read from: {exc}"}
    if re.fullmatch(r"[0-9a-f]{64}", key) is None:
        detail = ("holds 64 characters, and they are not all lowercase hex"
                  if len(key) == 64 else f"holds {len(key)} character(s), not 64 hex")
        return {"status": "unusable", "source": path, "publicKey": None, "readable": True,
                "reason": f"does not hold a 64-hex public key ({detail})"}
    return {"status": "pinned", "source": path, "publicKey": key, "reason": None, "readable": True}


def log_path(state: str) -> str:
    return os.path.join(state, LOG_RELPATH)


def pending_admissions(state: str) -> list[dict]:
    """Rows the host gate recorded that the accepted issuer has not turned into receipts.

    Read straight from the ledger, where `receipt: PENDING_SERIALIZATION` is the gate's own
    mark. A row that a previous drain could not settle is still a row without a receipt, so it
    stays in this list with its recorded reason rather than being counted as settled.
    """
    path = os.path.join(state, LEDGER_NAME)
    if not os.path.exists(path):
        return []
    rows: list[dict] = []
    with open(path, "r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                rows.append({"unreadable": True, "line": number})
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def ledger_summary(state: str) -> str | None:
    """One line distinguishing admissions still awaiting a receipt, or None when none are.

    An unreadable line is not an admission: nothing can be said about what it records, so it is
    counted separately rather than inflating the number of transitions waiting for a receipt.
    """
    rows = pending_admissions(state)
    if not rows:
        return None
    errored = sum(1 for row in rows if isinstance(row, dict) and row.get("settleError"))
    unreadable = sum(1 for row in rows if isinstance(row, dict) and row.get("unreadable"))
    known = len(rows) - unreadable
    parts = []
    if known:
        parts.append(f"{known} admission(s) pending serialization")
    if errored:
        parts.append(f"{errored} with a recorded settle error")
    if unreadable:
        parts.append(f"{unreadable} unreadable ledger line(s)")
    return f"{'; '.join(parts)} — no receipt exists for them yet"


def read_log(state: str) -> aura_mod.Aura:
    """Open the composition log through the lead's own reader.

    `Aura._load` re-derives every entry hash, checks `seq` is 1..N and checks each `prev`
    link, so a damaged log refuses here with the producer's own named reason instead of
    being read as a shorter honest log.
    """
    path = log_path(state)
    if not os.path.exists(path):
        summary = ledger_summary(state)
        if summary is not None:
            readable = [row for row in pending_admissions(state) if not row.get("unreadable")]
            # Only prescribe the drain when the ledger holds something the drain can settle: an
            # unreadable-only ledger would keep its rows by design, so naming the drain as the fix
            # would be advice that provably cannot work.
            remedy = (
                f"Run: python3 scripts/composition/serialize-admissions.py --state {state}"
                if readable
                else "The accepted drain keeps unreadable rows by design, so running it cannot clear "
                     "this; inspect the ledger deliberately"
            )
            raise AssociationRefusal(
                "aura-admission-pending",
                f"{summary}. There is no composition log, so nothing has been receipted. {remedy}",
            )
        raise AssociationRefusal("aura-no-log", f"no composition log at {path}")
    try:
        return aura_mod.Aura(path)
    except aura_mod.AuraError as exc:
        raise AssociationRefusal("aura-log-not-admissible", str(exc)) from exc


def read_phase0_view(state: str) -> tuple[list[bytes], list[dict]]:
    """The same file read by Genesis's Phase 0 producer: leaf hashes and parsed records."""
    try:
        hashes, records = phase0log.leaf_hashes(state)
    except phase0log.Phase0Error as exc:
        raise AssociationRefusal("aura-phase0-view-refused", str(exc)) from exc
    return hashes, records


def chain_key_for(entries: list[dict]) -> str:
    """Name the stream by its first entry, which is fixed for the life of the log.

    This is a stream label: it says which history's first entry these observations are
    about. It is not a fork detector, not evidence of uniqueness, and not latestness —
    two logs share this label exactly when they share a first entry.
    """
    if not entries:
        raise AssociationRefusal("aura-log-is-empty", "an empty log has no first entry to name")
    return f"{CHAIN_KEY_PREFIX}{entries[0]['hash']}"


def cross_check_the_two_reads(entries: list[dict], records: list[dict]) -> None:
    """Phase 0 hashes lines; the composition hashes `{body, prev, seq}`. Prove one file.

    Both views are derived from the same bytes here, but they are derived by two different
    readers, and a future change to either file layout could make them read different
    things while each stays internally consistent. This is the check that they are looking
    at the same entries, in the same order, with the same links.
    """
    if len(entries) != len(records):
        raise AssociationRefusal(
            "aura-views-disagree-on-size",
            f"the composition reader sees {len(entries)} entries and the Phase 0 reader sees {len(records)}",
        )
    for index, (entry, record) in enumerate(zip(entries, records), start=1):
        if record.get("seq") != entry["seq"] or record.get("hash") != entry["hash"] or record.get("prev") != entry["prev"]:
            raise AssociationRefusal(
                "aura-views-disagree-at-seq",
                f"line {index}: composition entry {entry['hash'][:16]}… / Phase 0 record "
                f"{str(record.get('hash'))[:16]}… do not describe the same entry",
            )
        if record.get("body") != entry["body"]:
            raise AssociationRefusal(
                "aura-views-disagree-on-body",
                f"line {index}: the two readers parsed different bodies",
            )


# ── the association, which is the part a pair alone cannot answer ───────────────────────────


def expect_field(document: dict, name: str, where: str) -> object:
    if not isinstance(document, dict) or name not in document:
        raise AssociationRefusal("aura-document-incomplete", f"{where} has no {name}")
    return document[name]


def verify_association(
    *, state: str, log: aura_mod.Aura, phase0_hashes: list[bytes], retained: dict, presented: dict
) -> dict:
    """Recompute both documents from this log. Refuse anything that does not match.

    Every check here is recomputation over bytes on disk, not a comparison of one claim
    with another: the roots are rebuilt from the log, the proof is rebuilt from the log,
    and the receipts are rebuilt from the log's own entries. Nothing in either document is
    trusted for anything except the sizes it claims to be about, and those are checked.
    """
    key = chain_key_for(log.entries)
    for label, document in (("retained", retained), ("presented", presented)):
        if expect_field(document, "schema", f"{label} document") != WIRE_SCHEMA:
            raise AssociationRefusal(
                "aura-foreign-document",
                f"{label} document schema {document.get('schema')!r} is not {WIRE_SCHEMA!r}",
            )
        convention = expect_field(document, "leafConvention", f"{label} document")
        if convention != PHASE0_LEAF_CONVENTION:
            raise AssociationRefusal(
                "aura-foreign-leaf-convention",
                f"{label} document leafConvention {convention!r} is not {PHASE0_LEAF_CONVENTION!r}; "
                f"the composition's own {COMPOSITION_LEAF_CONVENTION!r} roots are a different tree "
                "over the same log and are not comparable with this one",
            )
        document_key = document.get("chainKey")
        if document_key != key:
            hint = ""
            if document_key == LEGACY_CHAIN_KEY:
                hint = (
                    f"; that is scripts/phase0/retain-head's fixed label, so this document names no"
                    f" stream. Re-retain it against this log with --chain-key {key}"
                )
            raise AssociationRefusal(
                "aura-pair-not-this-log",
                f"{label} document names chain {document_key!r} but this log is {key!r}{hint}",
            )

    retained_size = expect_field(retained, "treeSize", "retained document")
    presented_size = expect_field(presented, "treeSize", "presented document")
    for label, size in (("retained", retained_size), ("presented", presented_size)):
        if isinstance(size, bool) or not isinstance(size, int) or size < 1:
            raise AssociationRefusal("aura-document-incomplete", f"{label} treeSize {size!r} is not a positive integer")
        if size > len(log.entries):
            raise AssociationRefusal(
                "aura-observation-beyond-this-log",
                f"{label} document observes {size} entries but this log has {len(log.entries)}",
            )

    for label, document, size in (("retained", retained, retained_size), ("presented", presented, presented_size)):
        recomputed = phase0log.tree_head(phase0_hashes[:size]).hex()
        if document.get("root") != recomputed:
            raise AssociationRefusal(
                "aura-root-not-this-log",
                f"{label} document root {str(document.get('root'))[:16]}… is not the root of the first "
                f"{size} entries of this log, which is {recomputed[:16]}…",
            )

    if presented_size < retained_size:
        # Not a refusal: the pair is about this log and the accusation belongs to the court
        # and to the log-in-hand comparison. Producing a proof for it would be inventing one.
        return {
            "chainKey": key,
            "logSize": len(log.entries),
            "retainedSize": retained_size,
            "presentedSize": presented_size,
            "roots": {
                "retained": retained.get("root"),
                "presented": presented.get("root"),
                "phase0RecomputedRetained": phase0log.tree_head(phase0_hashes[:retained_size]).hex(),
                "phase0RecomputedPresented": phase0log.tree_head(phase0_hashes[:presented_size]).hex(),
            },
            "proofChecked": False,
        }

    expected_proof = [element.hex() for element in phase0log.proof_from(retained_size, phase0_hashes[:presented_size])] \
        if retained_size < presented_size else []
    claimed_proof = presented.get("proofFromPrevious")
    if not isinstance(claimed_proof, list):
        raise AssociationRefusal("aura-document-incomplete", "presented document has no proofFromPrevious list")
    if len(claimed_proof) != len(expected_proof):
        raise AssociationRefusal(
            "aura-proof-not-this-log",
            f"presented proof has {len(claimed_proof)} element(s) but the proof from size {retained_size} to "
            f"{presented_size} over this log has {len(expected_proof)}",
        )
    for index, (claimed, expected) in enumerate(zip(claimed_proof, expected_proof)):
        if str(claimed).lower() != expected:
            raise AssociationRefusal(
                "aura-proof-not-this-log",
                f"presented proof element {index} is {str(claimed)[:16]}… but this log's proof element "
                f"{index} from size {retained_size} to {presented_size} is {expected[:16]}…",
            )
    declared_retained = presented.get("retainedTreeSize")
    if declared_retained is not None and declared_retained != retained_size:
        raise AssociationRefusal(
            "aura-pair-sizes-disagree",
            f"presented document says it extends size {declared_retained} but the retained document is size {retained_size}",
        )
    return {
        "chainKey": key,
        "logSize": len(log.entries),
        "retainedSize": retained_size,
        "presentedSize": presented_size,
        "roots": {
            "retained": retained.get("root"),
            "presented": presented.get("root"),
            "phase0RecomputedRetained": phase0log.tree_head(phase0_hashes[:retained_size]).hex(),
            "phase0RecomputedPresented": phase0log.tree_head(phase0_hashes[:presented_size]).hex(),
        },
        "proofChecked": True,
        "proofLength": len(expected_proof),
    }


def receipt_documents(state: str) -> list[dict]:
    """Every receipt-shaped document in this state, indexed by the position it claims.

    Two writers put a receipt here and both are read: the loader writes
    `receipt-<operation>-<seq:03d>.json` in the state root, and the accepted serializer copies
    the same document to `receipts/<id>-<seq:03d>.json`. A filename is a label, so documents
    are selected by the position they *claim* and every claim is then checked against the log.
    Files that are not receipt-shaped (`state.json`, grants, keys) are skipped silently because
    they are not claims about a position; a receipt-shaped file that lies is refused by name.
    """
    found: list[dict] = []
    for directory, label in ((state, "."), (os.path.join(state, RECEIPT_DIR), RECEIPT_DIR)):
        try:
            names = sorted(os.listdir(directory))
        except OSError:
            continue
        for name in names:
            if not name.endswith(".json"):
                continue
            path = os.path.join(directory, name)
            try:
                with open(path, "rb") as handle:
                    document = json.loads(handle.read().decode("utf-8"))
            except (UnicodeDecodeError, ValueError, OSError):
                continue
            if not isinstance(document, dict) or "kind" not in document:
                continue
            if "aura" not in document:
                continue
            block = document.get("aura")
            if not isinstance(block, dict):
                raise AssociationRefusal(
                    "aura-receipt-not-admissible",
                    f"{path} is receipt-shaped (it carries `kind` and an `aura` key) but its aura is "
                    f"{type(block).__name__}, not an object; a document that names no position is "
                    "refused rather than ignored",
                )
            claimed = block.get("seq")
            if isinstance(claimed, bool) or not isinstance(claimed, int) or claimed < 1:
                raise AssociationRefusal(
                    "aura-receipt-not-admissible",
                    f"{path} is receipt-shaped (it carries `kind` and an `aura` block) but its "
                    f"aura.seq is {claimed!r}; a document that claims no usable position is not a "
                    "receipt and is refused rather than ignored",
                )
            found.append({"path": path, "directory": label, "document": document, "seq": block["seq"]})
    return found


def roots_for(prefix: int, phase0_hashes: list[bytes], log: aura_mod.Aura) -> dict:
    """Both roots over the SAME prefix, each bound to the algorithm that produced it.

    These two numbers are different by construction and are never interchangeable: the
    composition's leaf is sha256(0x00 || entry_hash_k) while this file's Phase 0 leaf is the
    digest of the canonical line. Carrying the algorithm name beside each root means a reader
    cannot compare them by accident and cannot mistake which verifier consumes which.
    """
    return {
        "prefix": prefix,
        "entryHash": log.entries[prefix - 1]["hash"],
        "phase0": {
            "algorithm": PHASE0_LEAF_CONVENTION,
            "root": phase0log.tree_head(phase0_hashes[:prefix]).hex(),
            "consumedBy": "vendor/append-only/verify.py",
        },
        "composition": {
            "algorithm": COMPOSITION_LEAF_CONVENTION,
            "root": log.root(prefix),
            "consumedBy": "scripts/composition/aura.py:verify_consistency, and a receipt's aura.root",
        },
    }


def entry_associations(state: str, log: aura_mod.Aura, upto: int, issuer: dict) -> list[dict]:
    """One row per position: the entry, the fields it carries, and its receipt's claims.

    The receipt is not trusted here either. Its `aura` block is checked against the log's
    own entry at that position (`entryHash`, `prevHash`, `priorHead`, `seq`), against the
    composition root over the first `seq` entries, and against `head == entryHash`, which
    the accepted contract requires at issue. A receipt that names a different position is a
    refusal naming the position, not a row with a footnote.
    """
    index = receipt_documents(state)
    beyond = sorted({entry["seq"] for entry in index if entry["seq"] > log.size()})
    if beyond:
        raise AssociationRefusal(
            "aura-receipt-beyond-this-log",
            f"{len(beyond)} receipt(s) claim position(s) {beyond} but this log has {log.size()} "
            "entries; a receipt that names a position this log does not contain is about another "
            "log, not a later one",
        )
    rows: list[dict] = []
    for seq in range(1, upto + 1):
        entry = log.entries[seq - 1]
        body = entry["body"] if isinstance(entry.get("body"), dict) else {}
        row = {
            "seq": seq,
            "entryHash": entry["hash"],
            "prev": entry["prev"],
            "priorHead": log.head_before(seq),
            "compositionRoot": log.root(seq),
            "carried": {name: body[name] for name in CARRIED_FIELDS if name in body},
            "receipts": [],
        }
        for found in [entry for entry in index if entry["seq"] == seq]:
            receipt_path = found["path"]
            document = found["document"]
            block = document.get("aura")
            if not isinstance(block, dict):
                raise AssociationRefusal("aura-receipt-not-admissible", f"{receipt_path} has no aura block")
            for name, expected in (
                ("seq", seq),
                ("entryHash", entry["hash"]),
                ("prevHash", entry["prev"]),
                ("priorHead", log.head_before(seq)),
                ("head", entry["hash"]),
                ("root", log.root(seq)),
            ):
                if block.get(name) != expected:
                    raise AssociationRefusal(
                        "aura-receipt-not-this-position",
                        f"{os.path.basename(receipt_path)} says aura.{name} is "
                        f"{str(block.get(name))[:16]}… but this log's entry {seq} has {str(expected)[:16]}…",
                    )
            try:
                receipt_mod.check_payload(document)
            except Exception as exc:  # CompositionRefusal, from the accepted contract
                raise AssociationRefusal("aura-receipt-not-admissible", f"{receipt_path}: {exc}") from exc
            # Structure is not a signature, and a signature under the key the receipt itself
            # carries is not an anchor to this installation. Two questions, asked in order and
            # labelled by what actually happened.
            carried = document.get("issuerPk")
            try:
                approval, conformance, _consistency = receipt_mod.verify_receipt(document)
            except Exception as exc:  # CompositionRefusal
                approval, conformance = "unattributed", "NON-CONFORMING"
                signature, issuer_match = f"invalid: {exc}", None
            else:
                if issuer["status"] != "pinned":
                    # No readable published key: nothing here can be anchored, and the reason is
                    # carried by the snapshot rather than inferred from a missing value.
                    signature, issuer_match = "carried-key-only", None
                elif carried == issuer["publicKey"]:
                    # The accepted contract's own pinned check, not a comparison of hex strings:
                    # it verifies the signature under the published key or it raises.
                    try:
                        receipt_mod.verify_receipt(document, expect_pk=issuer["publicKey"])
                        signature, issuer_match = "issuer-pinned", True
                    except Exception as exc:  # CompositionRefusal
                        signature, issuer_match = f"invalid: {exc}", False
                else:
                    signature, issuer_match = "carried-key-only", False
            row["receipts"].append({
                "path": os.path.basename(receipt_path),
                "directory": found["directory"],
                "sha256": receipt_mod.receipt_digest(document),
                "kind": document.get("kind"),
                "operation": document.get("composition", {}).get("operation"),
                "nonce": document.get("nonce"),
                "root": block.get("root"),
                "signature": signature,
                "issuerMatch": issuer_match,
                "carriedKey": carried,
                "class": approval,
                "conformance": conformance,
            })
        rows.append(row)
    return rows


# ── the two verdicts, from the two courts ───────────────────────────────────────────────────


def run_court(retained_path: str, presented_path: str, display: str | None = None) -> dict:
    """Run the pinned court as a separate process and read its own printed verdict.

    `display` names the path a reader should use in the printed command when the bytes under test
    are staged elsewhere; the bytes are identical, so the command is reproducible after the rename.
    """
    if not os.path.exists(COURT):
        raise AssociationRefusal("aura-court-absent", f"the pinned court is not at {COURT}")
    completed = subprocess.run(
        [sys.executable, COURT, retained_path, presented_path],
        capture_output=True,
        text=True,
        # THE FLAG ABOVE DOES NOT REACH A CHILD. The court is release Python living under
        # `vendor/append-only/` inside this release, so a child free to write bytecode would
        # put `__pycache__` there and break the release's own `strip-totals-mismatch` check. Set
        # explicitly rather than inherited: the attended shell may or may not have it, and a check
        # that passes only because of an inherited variable is not evidence.
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    output = f"{completed.stdout}\n{completed.stderr}"
    verdict = VERDICT_LINE.search(output)
    reason = REASON_LINE.search(output)
    if verdict is None:
        raise AssociationRefusal(
            "aura-court-unreadable",
            f"the court printed no verdict (exit {completed.returncode}): {output.strip()[:200]}",
        )
    return {
        "verdict": verdict.group(1),
        "reason": reason.group(1) if reason else "",
        "exit": completed.returncode,
        "command": f"python3 vendor/append-only/verify.py {retained_path} {display or presented_path}",
        "raw": output.strip(),
    }


def composition_verdict(log: aura_mod.Aura, retained_size: int, presented_size: int) -> dict:
    """The log-in-hand comparison, through the composition's own checkpoint shape."""
    retained_document = {
        "size": retained_size,
        "root": log.root(retained_size),
        "head": log.entries[retained_size - 1]["hash"],
        "leafConvention": COMPOSITION_LEAF_CONVENTION,
        "tree": aura_mod.TREE_CONVENTION,
    }
    presented_document = {
        "size": presented_size,
        "root": log.root(presented_size),
        "head": log.entries[presented_size - 1]["hash"],
        "leafConvention": COMPOSITION_LEAF_CONVENTION,
        "tree": aura_mod.TREE_CONVENTION,
    }
    verdict, note = log.verify_consistency(retained_document, presented_document)
    return {
        "verdict": verdict,
        "note": note,
        "leafConvention": COMPOSITION_LEAF_CONVENTION,
        "retainedRoot": retained_document["root"],
        "presentedRoot": presented_document["root"],
    }


# ── the three verbs ─────────────────────────────────────────────────────────────────────────


def load_witness_module():
    """The witness, loaded from this directory by path rather than by name.

    `scripts/` is deliberately not on `sys.path` (see the note above the imports), so the
    sibling module is loaded explicitly. This is a read of the witness's own verification
    code: the countersignature is checked by the same function the witness test uses, not by a
    second, weaker check written here.
    """
    import importlib.util  # noqa: PLC0415

    path = os.path.join(HERE, "witness.py")
    if not os.path.exists(path):
        raise AssociationRefusal("aura-witness-absent", f"no witness module at {path}")
    spec = importlib.util.spec_from_file_location("aura_witness", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def publish_to_witness(url: str, chain_key: str, size: int, document: dict, *, out: str, node_key: str | None) -> dict:
    """Send one retained observation to a witness, then read the countersigned head back.

    Reading it back is not a formality. A witness that accepted a document and could not serve
    it again has retained nothing a later verifier can use, so this command proves the round
    trip rather than the receipt of a POST. The countersignature is verified by the witness's
    own checker, and a signature that verifies under THIS node's key is refused by name: a node
    signing its own observation is the same party talking twice, and the label a verdict
    carries would be a lie rather than a weakness.

    `retainedAt` is deliberately NOT added to the observation here, unlike the directory path:
    the retainer reader strips that key, so a witness signing a document that carries it would
    sign bytes no reader can re-derive. The witness stamps its own clock into the envelope.
    """
    import urllib.error  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415

    witness_mod = load_witness_module()
    base = url.rstrip("/")
    body = json.dumps(
        {"chainKey": chain_key, "size": size, "observation": document},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/retain", data=body, headers={"content-type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 - the operator named this URL
            answer = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            refusal = json.loads(exc.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            refusal = {"refuse": f"http-{exc.code}"}
        raise AssociationRefusal(
            "aura-witness-refused", f"{exc.code}: {refusal.get('refuse')}: {refusal.get('reason')}"
        ) from exc
    except Exception as exc:  # noqa: BLE001 - an unreachable witness is never a verdict
        raise AssociationRefusal(
            "aura-witness-unreachable",
            f"{base}: {type(exc).__name__}: {exc}. An unreachable witness leaves the consistency "
            "question unanswered; it is not agreement and not a conflict.",
        ) from exc
    if not isinstance(answer, dict) or not answer.get("ok"):
        raise AssociationRefusal("aura-witness-refused", f"{base} answered {json.dumps(answer)[:200]}")
    directory = os.path.join(os.path.abspath(out), "witness")
    try:
        fetched = witness_mod.fetch(base, chain_key, size, directory, node_key=node_key)
    except witness_mod.WitnessRefusal as exc:
        raise AssociationRefusal(f"aura-{exc.code}", exc.reason) from exc
    return {
        "kind": "witness",
        "url": base,
        "directory": directory,
        "path": os.path.relpath(fetched["path"], os.path.abspath(out)),
        "size": size,
        "chainKey": chain_key,
        "sha256": fetched["sha256"],
        "layout": "aukora-retainer-v1",
        "witness": fetched["countersignature"],
        # Whether THIS call created the witness's entry or found it already there, taken from the
        # witness's own answer rather than inferred from a 200: "published" is never assumed.
        "outcome": answer.get("outcome"),
        "won": answer.get("won"),
        "custody": "RETAINER_SAME_OWNER",
        "note": "countersigned by a separate process with a key of its own, on this host and under "
                "this uid. It shows the node cannot make this witness answer differently, and NOT "
                "that an independent party agrees: two keys are not two principals. Nothing was "
                "pushed here.",
    }


def place_first_retention(retainer_mod, directory: str, chain_key: str, size: int, document: dict) -> dict:
    """Put the observation in the retainer so the FIRST retention for a size wins, atomically.

    `retainer.retain_to_directory` checks whether the size is already held and then writes, and
    that pair has a window: two first-retentions for one stream and size can both find nothing
    and both write, so the second lands on top of the first and a caller can be told it published
    while the retainer holds someone else's observation.

    The bytes are still produced by the Phase 0 writer — one writer for that layout, no second
    implementation of the envelope — into a temporary directory *inside the retainer root*, and
    then moved into place with `os.link`, which the kernel resolves atomically and which fails
    with `FileExistsError` if the target already exists. The loser is told which case it is in:

      retained          this call created the file
      already-retained  it did not write; the retainer already held exactly these bytes
      (refused)         another writer retained a DIFFERENT observation for this size first
    """
    root = os.path.abspath(directory)
    target = os.path.join(root, retainer_mod.head_relpath(chain_key, size))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root, prefix=".aura-first-retention-") as holding:
        staged = retainer_mod.retain_to_directory(holding, chain_key, size, document, "scripts/aura/adapter.py")
        try:
            os.link(staged, target)
        except FileExistsError:
            existing = retainer_mod.read_directory_head(root, chain_key, size)
            if existing.get("observation", {}).get("root") == document.get("root"):
                return {"outcome": "already-retained", "won": False, "path": target}
            raise AssociationRefusal(
                "aura-first-retention-lost",
                f"another writer retained a different observation for size {size} of {chain_key} "
                f"first ({str(existing.get('observation', {}).get('root'))[:16]}… is held; this one "
                f"has {str(document.get('root'))[:16]}…), so this retention did not land. A "
                "retainer keeps the observation it already holds.",
            ) from None
    return {"outcome": "retained", "won": True, "path": target}


def publish_to_retainer(issuer_unused: None, directory: str, chain_key: str, size: int, document: dict) -> dict:
    """Write one retained observation into a retainer working copy, in the existing layout.

    The layout is `scripts/phase0/retainer.py`'s (`heads/<chainKey>/size-<N>.json`, envelope
    `aukora-retainer-v1`), used rather than reinvented: that module's writer produces the bytes,
    and this lane places them so the first retention of a stream and size wins atomically and
    every other writer is told it did not write. Nothing is pushed here: this writes into the
    directory it is given and prints the git commands, because a reading tool that silently wrote
    to a remote would be making a custody claim on the operator's behalf.
    """
    sys.path.insert(0, PHASE0_DIR)
    import retainer as retainer_mod  # noqa: PLC0415  (the Phase 0 lane's module, read-only use)

    published = dict(document)
    published["retainedAt"] = phase0log.now_ms()
    try:
        placed = place_first_retention(retainer_mod, directory, chain_key, size, published)
    except retainer_mod.RetainerError as exc:
        raise AssociationRefusal("aura-retainer-refused", str(exc)) from exc
    path = placed["path"]
    with open(path, "rb") as handle:
        blob = handle.read()
    return {
        "kind": "directory",
        "directory": os.path.abspath(directory),
        "path": os.path.relpath(path, os.path.abspath(directory)),
        "size": size,
        "chainKey": chain_key,
        "sha256": hashlib.sha256(blob).hexdigest(),
        "layout": "aukora-retainer-v1",
        "outcome": placed["outcome"],
        "won": placed["won"],
        "note": "same-principal retainer: it shows this host did not rewrite its own history, and "
                "not that an independent party agrees. Nothing was pushed by this command."
                + ("" if placed["won"] else " This call did not write: the retainer already held "
                                            "exactly these bytes."),
    }


def publish_observation(target: str, chain_key: str, size: int, document: dict, *, issuer: dict, out: str) -> dict:
    """`--publish` takes either a directory or the URL of a witness, and says which it did.

    The node's own key is passed to the witness path so a countersignature produced with it is
    refused there; when this state publishes no readable issuer key there is no such key to
    compare against, and that limit is reported rather than glossed.
    """
    if target.startswith(("http://", "https://")):
        published = publish_to_witness(target, chain_key, size, document, out=out, node_key=issuer.get("publicKey"))
        published["nodeKeyChecked"] = issuer.get("publicKey") is not None
        return published
    return publish_to_retainer(None, target, chain_key, size, document)


def print_retainer(published: dict, key: str, size: int) -> None:
    if published.get("kind") == "witness":
        print(f"PUBLISHED      : {published['url']}  (witness)")
        print(f"  countersigned by {published['witness']['publicKey'][:16]}… over jcs(observation)"
              f" {published['witness']['signedSha256'][:16]}…")
        print(f"  served back   {os.path.join(published['directory'], os.path.basename(published['path']))}"
              f"  sha256 {published['sha256'][:16]}…")
        if not published.get("nodeKeyChecked"):
            print("  CEILING       : this state publishes no readable issuer key, so the witness's key could not be")
            print("                  compared against this node's own key. That check is not skipped silently;")
            print("                  it is unavailable, and it runs again at fetch time with --node-key.")
        print("  CUSTODY       : RETAINER_SAME_OWNER — a separate process and key on this host, the same")
        print("                  principal. It is not independent custody, and no verdict here claims it.")
        print(f"  next: python3 scripts/phase0/verify --retainer {published['directory']} "
              f"<presented.json> --chain-key {key}")
        return
    print(f"PUBLISHED      : {os.path.join(published['directory'], published['path'])}")
    print(f"  sha256        {published['sha256']}")
    print("  nothing was pushed; publish it deliberately, e.g.")
    print(f"    git -C {published['directory']} add heads && git -C {published['directory']} commit -m 'retain {key} size {size}' && git -C {published['directory']} push")


def digest_of(path: str) -> str | None:
    """The digest of a document on disk, so a manifest cannot describe a document that moved."""
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def document_paths(out: str) -> tuple[str, str, str]:
    return (
        os.path.join(out, "retained.json"),
        os.path.join(out, "presented.json"),
        os.path.join(out, "association.json"),
    )


def write_association(path: str, value: dict) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def ceilings() -> list[str]:
    return [
        "Evidence, not truth: this says two documents describe one log. It says nothing about",
        "whether any transition happened, whether a plugin did anything, or whether a record is true.",
        "Evidence, not authorization: nothing here is a grant, a nonce, or a permission. A receipt",
        "verifies a signature over a position; it authorizes no effect.",
        "A receipt signature checks out under the key it carries unless the state publishes an",
        "issuer key; carried-key-only is self-consistency, never an anchor to this installation.",
        "Evidence, not latestness: the presented head is this log's head as of this read. Another log",
        "may exist, and this adapter cannot see it.",
        "Evidence, not custody: the retained document sits in the directory you named, owned by this",
        "uid on this host. RETAINER_SAME_OWNER — a second local directory, a private remote this uid",
        "pushes to, and a countersigning witness this uid started are all the same principal. Independent",
        "custody needs a second principal holding a copy.",
        "The court has a power-of-two blind spot: a retained size m = 2^k uses the retained root as",
        "the fold seed, so a rewritten prefix there is UNDETERMINED rather than OBSERVATION_CONFLICT.",
        "The composition's own rfc6962-leaf-sha256-0x00-prefixed-v1 roots are a DIFFERENT tree over",
        "the same log. Comparing one convention's root with the other means nothing.",
    ]


def print_ceilings() -> None:
    print()
    for line in ceilings():
        print(f"  {line}")


def verdict_is_green(court: dict | None, composition: dict | None) -> bool:
    return (
        court is not None
        and composition is not None
        and court["verdict"] == "APPEND_ONLY"
        and composition["verdict"] == "APPEND_ONLY"
    )


def position_line(rows: list[dict]) -> str:
    """The headline count, which counts only receipts anchored to this installation's issuer."""
    receipts = [receipt for row in rows for receipt in row["receipts"]]
    pinned = sum(1 for receipt in receipts if receipt["signature"] == "issuer-pinned")
    line = f"  {len(rows)} position(s), {pinned} with an issuer-pinned receipt"
    if len(receipts) != pinned:
        line += f", {len(receipts) - pinned} not issuer-pinned"
    return line


def configured_view(issuer: dict) -> dict | None:
    """The v1 `configured` value for this snapshot, kept bit-for-bit in meaning.

    `aukora-aura-association-v1` is unchanged, so a reader written against it must keep seeing
    what it saw: `null` when this state publishes no readable key file, and otherwise
    `{"path", "publicKey"}` (a readable key) or `{"path", "publicKey": null, "note"}` (readable
    and not a key). The three-way status lives in the additive `snapshot` field instead, so an
    old `configured === null` test still reads absence as absence rather than as a published key.
    """
    if issuer["status"] == "pinned":
        return {"path": issuer["source"], "publicKey": issuer["publicKey"]}
    if issuer["status"] == "unusable" and issuer["readable"]:
        return {"path": issuer["source"], "publicKey": None, "note": issuer["reason"]}
    return None


def issuer_evidence(issuer: dict) -> dict:
    """The manifest's `issuer` block, built in ONE place so the three verbs cannot drift apart.

    `configured` keeps its v1 meaning (see `configured_view`); `snapshot` is the additive field
    carrying the three-way status, the source and the reason; `classification` states the rule
    the rows were labelled by, and that the labels and this block come from the same one read.
    """
    return {
        "configured": configured_view(issuer),
        "snapshot": issuer,
        "source": issuer["source"],
        "classification": "issuer-pinned iff the receipt's carried key equals snapshot.publicKey "
                          "and snapshot.status is `pinned`; the row labels and this block are built "
                          "from this one snapshot, so they cannot describe two different reads",
        "note": "issuer-pinned: the signature verifies under the key this state publishes for the "
                "issuer that signs its receipts. carried-key-only: it verifies under the key the "
                "receipt itself carries, which is self-consistency and not an anchor to this "
                "installation. invalid: it does not verify at all. snapshot.status distinguishes "
                "an absent key from an existing key file that cannot be used.",
    }


def print_issuer(issuer: dict) -> None:
    """One line per run saying which of the three issuer facts this state produced."""
    if issuer["status"] == "pinned":
        print(f"ISSUER      : pinned — {issuer['source']}")
    elif issuer["status"] == "absent":
        print(f"ISSUER      : absent — no {ISSUER_PUBLIC} at {issuer['source']}; this installation "
              "publishes no issuer key, so nothing here can be anchored")
    else:
        print(f"ISSUER      : unusable — {issuer['source']} exists but cannot be used: {issuer['reason']}")


def issuer_ceiling(issuer: dict) -> str | None:
    """The unusable case stated where a reader would otherwise read absence into it."""
    if issuer["status"] != "unusable":
        return None
    return (
        f"the issuer file {issuer['source']} EXISTS and is unusable ({issuer['reason']}), so no "
        "receipt in this run can be anchored to this installation and every receipt here is "
        "carried-key-only. This is not the absent-key case: an absent key is a state that "
        "publishes none, while this one publishes a key that cannot be read, and the repair is "
        "different. No carried key is read as an authority in either case."
    )


def print_receipt_verdicts(rows: list[dict], issuer: dict) -> None:
    """Say out loud which receipts are anchored to this installation, and which are not.

    One number would be a lie in one direction or the other: a self-consistent receipt is real
    evidence of a signature and no evidence of this installation, and an invalid one is neither.
    """
    receipts = [receipt for row in rows for receipt in row["receipts"]]
    if not receipts:
        return
    pinned = sum(1 for receipt in receipts if receipt["signature"] == "issuer-pinned")
    carried_only = sum(1 for receipt in receipts if receipt["signature"] == "carried-key-only")
    invalid = len(receipts) - pinned - carried_only
    if issuer["status"] == "pinned":
        where = issuer["source"]
    elif issuer["status"] == "absent":
        where = f"no {ISSUER_PUBLIC} published in this state"
    else:
        where = f"{issuer['source']} exists but is unusable"
    print(f"RECEIPTS    : {pinned} issuer-pinned ({where}), {carried_only} carried-key-only, {invalid} invalid")
    if carried_only:
        print("              carried-key-only = the signature verifies under the key the receipt itself")
        print("              carries. That is self-consistency, not an anchor to this installation.")
        # ── THE CEILING, PRINTED RATHER THAN IMPLIED (aura-84, audit finding -003) ───────────────────
        # **THE NOTE ABOVE SAYS WHAT `carried-key-only` IS NOT; THIS LINE SAYS WHAT IT CAN NEVER
        # REACH, WHICH IS THE PART A READER NEEDS IN ORDER TO ACT.** *A count of carried-key-only
        # receipts with no ceiling beside it leaves the reader to infer the limit from the prose* --
        # *and the audit's own finding was that an UNANCHORED receipt verifies as carried-key-only
        # while an identity-key grant is caught by the pin and reads GOVERNOR_UNTRUSTED.* **So the
        # two paths land in the same place, and the human output should say so in one line rather
        # than three paragraphs of docstring that a person running the command never sees.**
        #
        # *The wording mirrors the `CEILING       :` block the witness path already prints above*,
        # *because a reader who has seen one ceiling line should recognise the next.*
        print("  CEILING     : GOVERNOR_UNTRUSTED. A carried-key-only receipt is self-consistent evidence and")
        print("                no more: it cannot reach a governor tier, and it is not an anchor to this")
        print("                installation. An unanchored receipt and an identity-key grant both stop here.")


def is_power_of_two(value: int) -> bool:
    return value > 0 and (value & (value - 1)) == 0


def power_of_two_ceiling(retained_size: int | None, presented_size: int | None) -> str | None:
    """The court's fold-seed limit, named whenever it applies to the pair in hand.

    At a retained size m = 2^k the court has no retained-prefix element to fold: it takes the
    supplied retained root as the seed. An `APPEND_ONLY` there therefore does not establish
    that the retained root is the log's prefix — the court assumed it — and a rewritten prefix
    comes back `UNDETERMINED` rather than as an accusation. Both halves are stated, because a
    caller who hears only the second will read the first as full verification.
    """
    if retained_size is None or presented_size is None:
        return None
    if not (retained_size < presented_size and is_power_of_two(retained_size)):
        return None
    return (
        f"retained size {retained_size} is a power of two: the court uses the retained root as the "
        "fold seed there, so APPEND_ONLY at this retained size is NOT complete verification of the "
        f"prefix (the retained root was assumed, not derived), and a rewritten prefix at {retained_size} "
        "returns UNDETERMINED instead of OBSERVATION_CONFLICT. Retain an off-2^k size for a pair the "
        "court can accuse with."
    )


def report(court: dict | None, composition: dict | None, retained_size: int | None = None, presented_size: int | None = None) -> int:
    if composition is None:
        print("COMPOSITION : unavailable — no usable pair of sizes for the log-in-hand comparison")
    else:
        print(f"COMPOSITION : {composition['verdict']}  (this log's own prefixes, {composition['leafConvention']})")
        print(f"  {composition['note']}")
        print(f"  retained root {composition['retainedRoot']}")
        print(f"  presented root {composition['presentedRoot']}")
    if court is not None:
        print(f"COURT       : {court['verdict']}  (the pinned court, pair alone)")
        if court["reason"]:
            print(f"  reason: {court['reason']}")
        print(f"  $ {court['command']}")
    ceiling = power_of_two_ceiling(retained_size, presented_size)
    if ceiling is not None:
        print(f"CEILING     : {ceiling}")
    print_ceilings()
    return EXIT_GREEN if verdict_is_green(court, composition) else EXIT_NOT_GREEN


def verb_chain_key(args: argparse.Namespace) -> int:
    log = read_log(args.state)
    print(chain_key_for(log.entries))
    return EXIT_GREEN


def verb_retain(args: argparse.Namespace) -> int:
    log = read_log(args.state)
    phase0_hashes, records = read_phase0_view(args.state)
    cross_check_the_two_reads(log.entries, records)
    size = args.size if args.size is not None else log.size()
    if isinstance(size, bool) or not isinstance(size, int) or size < 1:
        raise AssociationRefusal("aura-retain-size-invalid", f"--size {size!r} is not a positive integer")
    if size > log.size():
        raise AssociationRefusal(
            "aura-retain-beyond-log", f"cannot retain size {size}; this log has {log.size()} entries"
        )
    key = chain_key_for(log.entries)
    retained = phase0log.observation(size, phase0_hashes, 1, key)
    retained_path, presented_path, association_path = document_paths(args.out)
    os.makedirs(args.out, exist_ok=True)
    # Every receipt in this state is checked against the log, not only the ones inside the
    # prefix being retained: a receipt that lies about a position is a property of the receipt,
    # not of the size a caller happened to ask for. Only the rows up to `size` are recorded.
    issuer = issuer_snapshot(args.state)
    checked_rows = entry_associations(args.state, log, log.size(), issuer)
    # Keeping an earlier reading is the whole act. Overwriting it silently would destroy the
    # one document the later pair is checked against, and the destruction would look like a
    # successful retain — so a second retain into the same directory refuses by name.
    if os.path.exists(retained_path) and not args.force:
        raise AssociationRefusal(
            "aura-retained-exists",
            f"{retained_path} already holds a retained observation; keeping an earlier reading is "
            "the point, so this refuses to overwrite it. Pass --force to replace it deliberately.",
        )
    rows = checked_rows[:size]
    manifest = {
        "schema": ASSOCIATION_SCHEMA,
        "chainKey": key,
        "log": {"path": log_path(args.state), "size": log.size(), "head": log.head()},
        "conventions": {
            "phase0": PHASE0_LEAF_CONVENTION,
            "composition": COMPOSITION_LEAF_CONVENTION,
        },
        "issuer": issuer_evidence(issuer),
        "retained": {
            "path": os.path.basename(retained_path),
            "treeSize": size,
            "roots": roots_for(size, phase0_hashes, log),
        },
        "entries": rows,
    }
    with open(retained_path, "w", encoding="utf-8") as handle:
        handle.write(phase0log.canonical_bytes(retained).decode("utf-8") + "\n")
    manifest["retained"]["sha256"] = hashlib.sha256(open(retained_path, "rb").read()).hexdigest()
    digest = write_association(association_path, manifest)
    print(f"RETAINED       : {retained_path}")
    print(f"  chainKey      {key}")
    print(f"  treeSize      {size} of {log.size()} entries")
    print(f"  root          {retained['root']}   (leafConvention {PHASE0_LEAF_CONVENTION})")
    print(f"  entry at size {log.entries[size - 1]['hash']}")
    print(f"  composition root over the same prefix {log.root(size)}   ({COMPOSITION_LEAF_CONVENTION})")
    print("  the two roots are bound to their algorithms in association.json; they are not comparable")
    print(f"ASSOCIATION    : {association_path}  sha256 {digest}")
    print(position_line(rows))
    print_issuer(issuer)
    print_receipt_verdicts(rows, issuer)
    unusable = issuer_ceiling(issuer)
    if unusable is not None:
        print(f"CEILING     : {unusable}")
    summary = ledger_summary(args.state)
    if summary is not None:
        print(f"LEDGER      : {summary}")
    if args.publish is not None:
        manifest["retainer"] = publish_observation(args.publish, key, size, retained, issuer=issuer, out=args.out)
        write_association(association_path, manifest)
        print_retainer(manifest["retainer"], key, size)
    print("  next: extend the log through the governed path, then")
    print(f"    python3 scripts/aura/adapter.py present --state {args.state} --retained {retained_path} --out {args.out}")
    print_ceilings()
    return EXIT_GREEN


def verb_present(args: argparse.Namespace) -> int:
    log = read_log(args.state)
    phase0_hashes, records = read_phase0_view(args.state)
    cross_check_the_two_reads(log.entries, records)
    try:
        with open(args.retained, "rb") as handle:
            retained = json.loads(handle.read().decode("utf-8"))
    except FileNotFoundError as exc:
        raise AssociationRefusal("aura-retained-absent", f"{args.retained}") from exc
    except (UnicodeDecodeError, ValueError) as exc:
        raise AssociationRefusal("aura-retained-not-admissible", f"{args.retained}: {exc}") from exc
    retained_size = retain_size_of(retained)
    if retained_size > log.size():
        raise AssociationRefusal(
            "aura-observation-beyond-this-log",
            f"the retained observation is size {retained_size} but this log has {log.size()}; "
            "a torn or replaced log is a refusal here, not a shorter honest log",
        )
    key = chain_key_for(log.entries)
    presented = phase0log.observation(log.size(), phase0_hashes, 2, key)
    presented["proofFromPrevious"] = (
        [] if retained_size == log.size() else [x.hex() for x in phase0log.proof_from(retained_size, phase0_hashes)]
    )
    presented["retainedTreeSize"] = retained_size
    presented["presentedAt"] = phase0log.now_ms()
    retained_path, presented_path, association_path = document_paths(args.out)
    os.makedirs(args.out, exist_ok=True)
    # The association is decided before anything is written: a refused run must leave the
    # directory as it found it, and a written presented.json must never be one that the
    # manifest beside it does not describe.
    association = verify_association(
        state=args.state, log=log, phase0_hashes=phase0_hashes, retained=retained, presented=presented
    )
    issuer = issuer_snapshot(args.state)
    rows = entry_associations(args.state, log, log.size(), issuer)
    # The court reads bytes from disk, so the document is staged under a temporary name and only
    # renamed into place once the court has answered. Every step that can refuse therefore runs
    # before the pair directory changes, and a rejected run leaves the previous pair — document
    # and manifest together — exactly as it was.
    staged = f"{presented_path}.partial"
    landed = False
    try:
        with open(staged, "w", encoding="utf-8") as handle:
            handle.write(phase0log.canonical_bytes(presented).decode("utf-8") + "\n")
        court = run_court(args.retained, staged, display=presented_path)
        os.replace(staged, presented_path)
        landed = True
    finally:
        if not landed and os.path.exists(staged):
            os.unlink(staged)
    composition = composition_verdict(log, retained_size, log.size())
    manifest = {
        "schema": ASSOCIATION_SCHEMA,
        "chainKey": key,
        "log": {"path": log_path(args.state), "size": log.size(), "head": log.head()},
        "conventions": {"phase0": PHASE0_LEAF_CONVENTION, "composition": COMPOSITION_LEAF_CONVENTION},
        "issuer": issuer_evidence(issuer),
        "retained": {
            "path": args.retained,
            "sha256": digest_of(args.retained),
            "treeSize": retained_size,
            "roots": roots_for(retained_size, phase0_hashes, log),
        },
        "presented": {
            "path": os.path.basename(presented_path),
            "sha256": digest_of(presented_path),
            "treeSize": log.size(),
            "roots": roots_for(log.size(), phase0_hashes, log),
            "proofLength": len(presented["proofFromPrevious"]),
        },
        "association": association,
        "court": court,
        "compositionVerdict": composition,
        "entries": rows,
    }
    digest = write_association(association_path, manifest)
    print(f"PRESENTED      : {presented_path}")
    print(f"  chainKey      {key}")
    print(f"  treeSize      {presented['treeSize']}  (retained size {retained_size})")
    print(f"  root          {presented['root']}   (leafConvention {PHASE0_LEAF_CONVENTION})")
    print(f"  proof         {len(presented['proofFromPrevious'])} digest(s)")
    print(f"ASSOCIATION    : ok — both documents recomputed from this log, at these positions")
    print(f"  {association_path}  sha256 {digest}")
    print(position_line(rows))
    print_issuer(issuer)
    print_receipt_verdicts(rows, issuer)
    unusable = issuer_ceiling(issuer)
    if unusable is not None:
        print(f"CEILING     : {unusable}")
    summary = ledger_summary(args.state)
    if summary is not None:
        print(f"LEDGER      : {summary}")
    return report(court, composition, retained_size, log.size())


def retain_size_of(retained: dict) -> int:
    size = retained.get("treeSize")
    if isinstance(size, bool) or not isinstance(size, int) or size < 1:
        raise AssociationRefusal("aura-document-incomplete", f"retained document treeSize {size!r} is not a positive integer")
    return size


def verb_associate(args: argparse.Namespace) -> int:
    """Answer all three questions, even when one of them is a refusal.

    The order matters and is deliberate. The court's question is about the two documents
    and nothing else, so it is asked first and its verdict is always printed — a pair that
    is valid and belongs to another log must still show `COURT: APPEND_ONLY`, because that
    is exactly the case where pair validity alone would otherwise be read as evidence about
    this log. The association then refuses, and the refusal is the answer to a different
    question, not a downgrade of the court's.
    """
    log = read_log(args.state)
    phase0_hashes, records = read_phase0_view(args.state)
    cross_check_the_two_reads(log.entries, records)
    documents = {}
    for label, path in (("retained", args.retained), ("presented", args.presented)):
        try:
            with open(path, "rb") as handle:
                documents[label] = json.loads(handle.read().decode("utf-8"))
        except FileNotFoundError as exc:
            raise AssociationRefusal(f"aura-{label}-absent", path) from exc
        except (UnicodeDecodeError, ValueError) as exc:
            raise AssociationRefusal(f"aura-{label}-not-admissible", f"{path}: {exc}") from exc

    court = run_court(args.retained, args.presented)
    # One snapshot for this verb: it feeds the labels, the manifest and the printed lines below.
    issuer = issuer_snapshot(args.state)
    retained_size = documents["retained"].get("treeSize")
    presented_size = documents["presented"].get("treeSize")
    # Each size is checked against the log independently: a presented tree SMALLER than the
    # retained one is a question the log-in-hand comparison answers (OBSERVATION_CONFLICT), and
    # gating on `retained <= presented` would report it as unanswerable instead.
    sizes_usable = (
        isinstance(retained_size, int)
        and not isinstance(retained_size, bool)
        and isinstance(presented_size, int)
        and not isinstance(presented_size, bool)
        and 1 <= retained_size <= log.size()
        and 1 <= presented_size <= log.size()
    )
    composition = composition_verdict(log, retained_size, presented_size) if sizes_usable else None

    try:
        association = verify_association(
            state=args.state,
            log=log,
            phase0_hashes=phase0_hashes,
            retained=documents["retained"],
            presented=documents["presented"],
        )
    except AssociationRefusal as refusal:
        print(f"COURT       : {court['verdict']}  (the pinned court, pair alone)")
        if court["reason"]:
            print(f"  reason: {court['reason']}")
        print(
            "COMPOSITION : not asked — the log-in-hand comparison compares THIS log with itself, so "
            "at these sizes it would say APPEND_ONLY about the log and nothing about the documents. "
            "The association above is the fact that is missing, and it is the one a pair cannot supply."
        )
        print("ASSOCIATION : refused")
        print_issuer(issuer)
        unusable = issuer_ceiling(issuer)
        if unusable is not None:
            print(f"CEILING     : {unusable}")
        summary = ledger_summary(args.state)
        if summary is not None:
            print(f"LEDGER      : {summary}")
        print(f"REFUSE: {refusal.code}: {refusal.reason}", file=sys.stderr)
        print()
        print("  A verdict above is about the two documents. The refusal is about whether they")
        print("  are evidence about THIS log, which is a different question and the one a pair")
        print("  alone cannot answer.")
        print_ceilings()
        return EXIT_REFUSED

    if args.out:
        _, _, association_path = document_paths(args.out)
        os.makedirs(args.out, exist_ok=True)
        write_association(
            association_path,
            {
                "schema": ASSOCIATION_SCHEMA,
                "chainKey": association["chainKey"],
                "log": {"path": log_path(args.state), "size": log.size(), "head": log.head()},
                "conventions": {"phase0": PHASE0_LEAF_CONVENTION, "composition": COMPOSITION_LEAF_CONVENTION},
        "issuer": issuer_evidence(issuer),
                "association": association,
                "court": court,
                "compositionVerdict": composition,
                "entries": entry_associations(args.state, log, association["presentedSize"], issuer),
            },
        )
        print(f"ASSOCIATION    : {association_path}")
    print("ASSOCIATION    : ok — both documents recomputed from this log")
    print(f"  chainKey      {association['chainKey']}   log size {association['logSize']}")
    print(
        f"  positions     retained {association['retainedSize']} -> presented {association['presentedSize']}"
        f"   proof checked: {association['proofChecked']}"
    )
    print_issuer(issuer)
    unusable = issuer_ceiling(issuer)
    if unusable is not None:
        print(f"CEILING     : {unusable}")
    summary = ledger_summary(args.state)
    if summary is not None:
        print(f"LEDGER      : {summary}")
    return report(court, composition, association["retainedSize"], association["presentedSize"])


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="aura-adapter",
        description="Retained/presented Aura observations over the composition transition log.",
    )
    verbs = parser.add_subparsers(dest="verb", required=True)

    key = verbs.add_parser("chain-key", help="print this log's stream label, and nothing else")
    key.add_argument("--state", required=True)
    key.set_defaults(handler=verb_chain_key)

    retain = verbs.add_parser("retain", help="write the Phase 0 retained observation for a prefix of the log")
    retain.add_argument("--state", required=True, help="composition state directory holding aura/records.jsonl")
    retain.add_argument("--out", required=True, help="directory for retained.json and association.json")
    retain.add_argument("--size", type=int, help="prefix size to retain; defaults to the whole log")
    retain.add_argument("--force", action="store_true", help="replace an existing retained.json in --out")
    retain.add_argument("--publish", type=str, metavar="RETAINER-DIR-OR-WITNESS-URL",
                        help="also write this observation into a retainer working copy "
                             "(heads/<chainKey>/size-<N>.json, aukora-retainer-v1 layout; nothing is "
                             "pushed), or, when this is an http(s) URL, send it to a witness at that "
                             "URL and read the countersigned head back; both are RETAINER_SAME_OWNER")
    retain.set_defaults(handler=verb_retain)

    present = verbs.add_parser("present", help="write the presented observation, run the court, report three facts")
    present.add_argument("--state", required=True)
    present.add_argument("--retained", required=True, help="the retained observation you kept")
    present.add_argument("--out", required=True)
    present.set_defaults(handler=verb_present)

    associate = verbs.add_parser("associate", help="judge an existing pair against this log")
    associate.add_argument("--state", required=True)
    associate.add_argument("--retained", required=True)
    associate.add_argument("--presented", required=True)
    associate.add_argument("--out", help="directory to write association.json into")
    associate.set_defaults(handler=verb_associate)

    args = parser.parse_args(argv[1:])
    try:
        return args.handler(args)
    except AssociationRefusal as exc:
        print("ASSOCIATION    : refused")
        print(f"REFUSE: {exc.code}: {exc.reason}", file=sys.stderr)
        print_ceilings()
        return EXIT_REFUSED
    except (OSError, ValueError) as exc:
        print(f"UNRUNNABLE: {exc}", file=sys.stderr)
        return EXIT_UNRUNNABLE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
