#!/usr/bin/env python3
"""Receipts for accepted composition transitions — aukora-receipt/v3 vocabulary.

A receipt is emitted **only** for a transition that was accepted. A refused
transition gets a refusal code and no receipt, because a receipt is a record of
something that happened, and minting one for a refusal would put a signed
statement in the log that the log's own state contradicts.

WHAT THIS RECEIPT IS. A detached Ed25519 signature over a canonical encoding of:

    kind, issuedAt, nonce, issuerPk, aura, composition

verifying under the public key it names, in the same top-level vocabulary the
sealed toy's `aukora-receipt/v3-toy` uses — `kind`, `composition`, `aura`,
`issuedAt`, `nonce`, `sig`, `issuerPk` — so that a reader holding one of each can
lay them side by side and see them as the same kind of object. The `composition`
block is field-for-field the toy's:

    operation, pluginId, pluginDigest, coeffectEnvelopeDigest, revertOf

and the `aura` block is the toy's plus one field:

    entryHash, head, prevHash, priorHead, root, seq, size

HOW THIS DIFFERS FROM THE TOY'S RECEIPT, AND WHY. Three differences, stated
here rather than left for a reader to diff:

1.  `kind` is `aukora-receipt/v3-genesis`, not `aukora-receipt/v3-toy`. Two
    different issuers must not produce receipts that claim to be the same kind
    string; the `kind` is the signature's domain separator, so sharing it would
    mean a signature made by one system verified as the other's.
2.  `aura` gains `priorHead`: the head as it stood immediately before this entry.
    The toy's block names `prevHash` (the previous *entry* hash) and `head` (the
    head *after* this entry), so the head before it is derivable from the toy's
    fields only by a reader who already holds the log. A receipt should be
    checkable for *position* by someone holding just the receipt and a retained
    observation, so the prior head is carried explicitly. `seq`, `entryHash`,
    `root` and `size` keep the toy's names and meanings exactly.
3.  There is no `coeffect`-related field addition and no owner field anywhere.
    `coeffectEnvelopeDigest` stays inside `composition` exactly as the toy has
    it, so the ceiling travels with the signed bytes rather than only in prose.

NEVER AN `alg` FIELD. `ALGORITHM_FIELDS` are refused by name on both issue and
verify. The `kind` string is the algorithm binding. A receipt that advertises an
algorithm has moved a decision that belongs to the verifier into data the signer
controls — the classic downgrade surface — so the field does not exist here.

THE CLASS IS DERIVED, NEVER A SIGNED FIELD, AND AT THIS GATE IT IS ALWAYS
`unattributed` / `NON-CONFORMING`. Classification reads `kind` and a registry of
owner public keys. This brick registers no owner keys and has no path to acquire
one: `Loader` generates a governor key and an issuer key locally, and `derive_class`
is never handed an owner registry by any code in this gate. So a live receipt is
`unattributed`, and its conformance is `NON-CONFORMING`. A field named `owner` in
a receipt does not make it attributed; it is refused as an identity field. Nobody
should be able to read a receipt from this gate and conclude that a human
authorized it, because nobody did.

ATTENDANCE IS `reported-not-proven`. Every human-facing path prints that word.
It means exactly this: the system can report that a transition occurred and
which key signed for it. It cannot prove a person was present, and the "issued
at" timestamp is a clock reading by the same process that emitted the receipt,
not an attendance record.

CONSISTENCY IS NOT CLAIMED HERE. A receipt names an Aura head. Whether that head
extends some earlier retained observation is a *different* question, answered by
comparing a retained and a presented document. A verifier that was handed only a
receipt and a key prints `CONSISTENCY_UNCHECKED`, which is an honest "I did not
look", and never an implied "it agreed". `cold_verify` always prints it, and
`loader.verify_receipt` prints it whenever no pair was supplied.
"""
from __future__ import annotations

import os
import time

import ed25519
from hexutil import read_json, require_hex, sha256_hex, to_hex, write_json
from jcs import canonicalize_bytes
from refusals import (
    CONSISTENCY_UNCHECKED,
    RECEIPT_TAMPERED,
    CompositionRefusal,
)

#: Live receipts. `-fixture` exists in the vocabulary for documents that stand in
#: for bytes a producer could not produce; this gate emits none, and the constant
#: is named only so the verifier can recognise and label one rather than mistake
#: it for a live receipt.
KIND_LIVE = "aukora-receipt/v3-genesis"
KIND_FIXTURE = "aukora-receipt/v3-genesis-fixture"
KINDS = (KIND_LIVE, KIND_FIXTURE)
LIVE_KINDS = (KIND_LIVE,)

#: The closed field set. Unknown fields are refused by name.
FIELDS = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce", "sig")
SIGNED_FIELDS = tuple(name for name in FIELDS if name != "sig")

AURA_FIELDS = ("entryHash", "head", "prevHash", "priorHead", "root", "seq", "size")
COMPOSITION_FIELDS = (
    "coeffectEnvelopeDigest",
    # `compositionDigest` and `subjectDigest` close a gap MEASURED against Diamond tip `c96c588`.
    # Diamond's `toy/receipt.py:64` declares a closed composition of SEVEN fields; this tuple carried
    # FIVE, and the two absent ones were exactly these. Without them a Genesis receipt cannot state
    # WHICH governed composition it attests or WHICH subject it binds, so Diamond refuses it with
    # `composition closed fields` before any signature is examined — a structural refusal that no
    # amount of correct signing closes.
    #
    # THE VALUES ARE COMPUTED BY THE CALLER, from Diamond's own `toy/composition.py` canonical tuple
    # and the pinned subject record, and carried here. This producer deliberately does not derive
    # them: a second implementation of Diamond's canonical form is the drift this field exists to
    # prevent, and two implementations that agree today are free to disagree tomorrow.
    "compositionDigest",
    "operation",
    "pluginId",
    "pluginDigest",
    "revertOf",
    "subjectDigest",
)
OPERATIONS = ("load", "unload")

# ── the two bindings Diamond requires and Genesis omitted ───────────────────────────────────────
#
# MEASURED against Diamond tip `c96c588`, not inferred. Diamond's `toy/receipt.py:64` declares
# `COMP_BASE`, a closed composition of seven fields, and `check_composition_fields` requires all
# seven for every kind. Genesis emitted five; the two missing were exactly these.
#
# The comment there gives the reason in Diamond's own words: "a receipt must be able to state WHICH
# composition and WHICH subject it attests, not just which plugin bytes. Both are required for every
# kind, so a receipt that cannot name its subject is refused rather than silently accepted."
#
# BOTH LITERALS ARE DIAMOND'S, COPIED DELIBERATELY. `kinds` is a closed vocabulary on the verifying
# side: inventing a Genesis spelling would produce a digest that is internally consistent and
# rejected, which is the worst of both outcomes. If Diamond's constants move, these must move with
# them, and the mint script below is what catches that — it compares this computation against
# Diamond's own `toy.composition.digest` and refuses on any disagreement.

COMPOSITION_KIND = "aukora-composition/v1-toy"
#: Diamond's subject domain string. The previous spelling `aukora-subject/v1-pin` hashed plugin
#: identity and is refused by Diamond; do not restore it. Measured against
#: `labs/contract-pin/zipper_test.py` lines 107 / 126-127: `os.path.abspath(gate.blob_path())`
#: then `subject_digest`.
#:
#: THE HASHED KEYS ARE Diamond's, not a Genesis paraphrase. Diamond
#: `diamond/subject.py` (aukora-diamond main after #12, SHA `cac9f69`; the same blob at `b80ab8e`) hashes
#: `{"domain": SUBJECT_DOMAIN, "subject": normalize_subject(path)}`. Genesis previously
#: hashed `{"kind": …, "principal": …}` over the same domain string and path; those
#: field names produce a different digest (Lead measured e1c387… vs 60b8a8…) that
#: `cold_verify` cannot see. Do not restore `kind`/`principal` here.
SUBJECT_DOMAIN = "aukora-subject/v1-toy"
SUBJECT_KIND = SUBJECT_DOMAIN  # historical alias for the domain *string*; the hashed key is `domain`
SUBJECT_RECORD_KEYS = ("domain", "subject")


def normalize_subject(blob_path: str) -> str:
    """abspath of the governed blob path, not symlink-resolved.

    `os.path.realpath` would collapse a symlink and bind a different path than the one the
    gate governs. Diamond's zipper uses `os.path.abspath`, so this does too.
    """
    if not isinstance(blob_path, str) or not blob_path:
        raise ValueError("subject blob path must be a non-empty string")
    return os.path.abspath(blob_path)


def subject_record_for(blob_path: str) -> dict:
    """Closed two-field record Diamond hashes. Keys are `domain` and `subject`.

    Built in one place so a caller cannot mint a digest over a third spelling.
    A third field, or `kind`/`principal`, would change every digest and disagree
    with Diamond's loader.
    """
    record = {
        "domain": SUBJECT_DOMAIN,
        "subject": normalize_subject(blob_path),
    }
    if set(record) != set(SUBJECT_RECORD_KEYS):
        raise ValueError(
            f"subject record keys {sorted(record)} are not Diamond's {list(SUBJECT_RECORD_KEYS)}"
        )
    return record


def subject_digest_for(blob_path: str) -> str:
    """Diamond's subjectDigest: `domain` `aukora-subject/v1-toy` over normalize_subject.

    The hashed value is the absolute governed blob path (`plugin.blob` under the state
    directory), not `plugin_id(plugin_bytes)`. The record is closed at two fields
    (`domain`, `subject`); a third field here would change every digest and be
    refused by Diamond's loader.
    """
    return sha256_hex(canonicalize_bytes(subject_record_for(blob_path)))


def composition_digest_for(
    *, operation: str, plugin_digest: str, subject_digest: str, coeffect_envelope_digest: str
) -> str:
    """Hash the canonical governed tuple — the SAME tuple Diamond hashes.

    Computed here rather than accepted as an opaque argument because emitting a field named
    `compositionDigest` without deriving it is precisely the overclaim this pair of fields exists to
    remove: the receipt would name a composition it cannot prove.

    The canonical form is shared by construction, not by convention: Genesis's `jcs.canonicalize_bytes`
    and Diamond's `toy/jcs.py` produce byte-identical output, verified empirically on nested
    unicode/None/bool/list input rather than assumed from reading two similar files. What differs
    between the repos is only WHICH key order the tuple uses, and Diamond sorts (`canonical()` returns
    `{k: composition[k] for k in FIELDS}` and JCS sorts keys), so a dict built in any order hashes the
    same.

    CEILING: this is Genesis's implementation of Diamond's rule. It is checked against Diamond's own
    `digest()` in `scripts/composition/mint-receipt-for-diamond.py`, which refuses on disagreement.
    Agreement TODAY is not a guarantee tomorrow; that script is the check, and this comment is not.
    """
    if operation not in OPERATIONS:
        raise ValueError(f"operation {operation!r} is not an operation")
    for name, value in (
        ("pluginDigest", plugin_digest),
        ("subjectDigest", subject_digest),
        ("coeffectEnvelopeDigest", coeffect_envelope_digest),
    ):
        require_hex(value, 32, name)
    return sha256_hex(
        canonicalize_bytes(
            {
                "coeffectEnvelopeDigest": coeffect_envelope_digest,
                "kind": COMPOSITION_KIND,
                "operation": operation,
                "pluginDigest": plugin_digest,
                "subjectDigest": subject_digest,
            }
        )
    )

IDENTITY_FIELDS = frozenset({"owner", "identity", "did", "ownerPk", "ownerPublicKey", "subject"})
ALGORITHM_FIELDS = frozenset({"alg", "algorithm", "hash", "curve"})

#: The two words every human-facing path prints. Spelled once.
ATTENDANCE = "reported-not-proven"


def domain_for(kind: str) -> bytes:
    return kind.encode("ascii") + b"\n"


def to_sign_bytes(receipt: dict) -> bytes:
    body = {name: receipt[name] for name in SIGNED_FIELDS}
    return domain_for(receipt["kind"]) + canonicalize_bytes(body)


def derive_class(receipt: dict, owner_keys: "set[str] | None" = None) -> tuple[str, str]:
    """(class, conformance). Derived from `kind` and a registry of owner keys.

    The registry parameter exists so the derivation is visible and testable, not
    because this gate has a way to populate it. No code path in this brick passes
    a non-empty registry, and the branch below deliberately returns
    `OWNER-KEY-PRESENT-NOT-CONFORMING` even if one were passed: a registered key
    would be a step toward attribution, not a ceremony, and this repository must
    not print `CONFORMING` for it.
    """
    if not isinstance(receipt, dict) or "kind" not in receipt:
        return "unattributed", "NON-CONFORMING"
    if receipt["kind"] == KIND_FIXTURE:
        return "fixture", "FIXTURE"
    owners = owner_keys or set()
    if receipt.get("issuerPk") in owners:
        return "attributed", "OWNER-KEY-PRESENT-NOT-CONFORMING"
    return "unattributed", "NON-CONFORMING"


def check_payload(receipt: dict) -> dict:
    """Structural verification of everything except the signature."""
    if not isinstance(receipt, dict):
        raise CompositionRefusal(
            RECEIPT_TAMPERED, f"receipt must be a JSON object, got {type(receipt).__name__}"
        )
    for name in sorted(ALGORITHM_FIELDS):
        if name in receipt:
            raise CompositionRefusal(
                RECEIPT_TAMPERED,
                f"receipt carries a forbidden `{name}` field — the kind string is the algorithm "
                "binding and no algorithm field is ever written",
            )
    for name in sorted(IDENTITY_FIELDS):
        if name in receipt:
            raise CompositionRefusal(
                RECEIPT_TAMPERED,
                f"receipt carries an identity field `{name}` — identity never crowns, and this "
                "field is never read as a class",
            )
    unknown = sorted(set(receipt.keys()) - set(FIELDS))
    if unknown:
        raise CompositionRefusal(
            RECEIPT_TAMPERED, f"unknown receipt field(s) {unknown} — closed set is {list(FIELDS)}"
        )
    missing = sorted(set(SIGNED_FIELDS) - set(receipt.keys()))
    if missing:
        raise CompositionRefusal(RECEIPT_TAMPERED, f"missing receipt field(s) {missing}")
    if receipt["kind"] not in KINDS:
        raise CompositionRefusal(RECEIPT_TAMPERED, f"unrecognised kind {receipt['kind']!r}")
    if isinstance(receipt["issuedAt"], bool) or not isinstance(receipt["issuedAt"], int):
        raise CompositionRefusal(RECEIPT_TAMPERED, "issuedAt must be an integer")
    for name in ("issuerPk", "nonce"):
        try:
            require_hex(receipt[name], 32, name)
        except ValueError as exc:
            raise CompositionRefusal(RECEIPT_TAMPERED, str(exc)) from exc

    aura = receipt["aura"]
    if not isinstance(aura, dict):
        raise CompositionRefusal(RECEIPT_TAMPERED, "aura must be an object")
    if set(aura.keys()) != set(AURA_FIELDS):
        raise CompositionRefusal(
            RECEIPT_TAMPERED,
            f"aura closed fields: got {sorted(aura.keys())}, expected {sorted(AURA_FIELDS)}",
        )
    for name in ("entryHash", "head", "prevHash", "priorHead", "root"):
        try:
            require_hex(aura[name], 32, f"aura.{name}")
        except ValueError as exc:
            raise CompositionRefusal(RECEIPT_TAMPERED, str(exc)) from exc
    for name in ("seq", "size"):
        value = aura[name]
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise CompositionRefusal(RECEIPT_TAMPERED, f"aura.{name} must be a positive integer")
    if aura["head"] != aura["entryHash"]:
        raise CompositionRefusal(
            RECEIPT_TAMPERED,
            "aura.head must equal aura.entryHash at issue: the entry this receipt names was the "
            "head when it was issued",
        )

    composition = receipt["composition"]
    if not isinstance(composition, dict):
        raise CompositionRefusal(RECEIPT_TAMPERED, "composition must be an object")
    if set(composition.keys()) != set(COMPOSITION_FIELDS):
        raise CompositionRefusal(
            RECEIPT_TAMPERED,
            f"composition closed fields: got {sorted(composition.keys())}, "
            f"expected {sorted(COMPOSITION_FIELDS)}",
        )
    if composition["operation"] not in OPERATIONS:
        raise CompositionRefusal(
            RECEIPT_TAMPERED, f"composition.operation {composition['operation']!r} is not an operation"
        )
    if not isinstance(composition["pluginId"], str) or not composition["pluginId"]:
        raise CompositionRefusal(RECEIPT_TAMPERED, "composition.pluginId must be a non-empty string")
    # The two digest bindings are validated to the SAME standard Diamond applies in
    # `check_composition_fields`: 32 bytes of hex each. A field that is present but unvalidated is
    # worse than an absent one, because it passes a closed-set check while binding nothing — and a
    # receipt that names a composition it cannot prove is the overclaim this pair exists to remove.
    for name in ("pluginDigest", "coeffectEnvelopeDigest", "compositionDigest", "subjectDigest"):
        try:
            require_hex(composition[name], 32, f"composition.{name}")
        except ValueError as exc:
            raise CompositionRefusal(RECEIPT_TAMPERED, str(exc)) from exc
    if not isinstance(composition["revertOf"], str):
        raise CompositionRefusal(RECEIPT_TAMPERED, "composition.revertOf must be a string")
    if composition["operation"] == "load" and composition["revertOf"] != "":
        raise CompositionRefusal(RECEIPT_TAMPERED, "a load receipt must carry an empty revertOf")
    return receipt


def issue(
    *,
    seed: bytes,
    issuer_pk: bytes,
    kind: str,
    issued_at: int,
    nonce: str,
    aura: dict,
    composition: dict,
) -> dict:
    """Sign a receipt for an accepted transition. The caller has already applied
    the transition and appended the Aura entry this receipt names."""
    if kind not in KINDS:
        raise CompositionRefusal(RECEIPT_TAMPERED, f"cannot issue kind {kind!r}")
    receipt = {
        "aura": aura,
        "composition": composition,
        "issuedAt": int(issued_at),
        "issuerPk": to_hex(issuer_pk),
        "kind": kind,
        "nonce": nonce,
    }
    check_payload(receipt)
    receipt["sig"] = to_hex(ed25519.sign(seed, to_sign_bytes(receipt)))
    return receipt


def verify_receipt(
    receipt: dict, *, expect_pk: str | None = None
) -> tuple[str, str, str]:
    """Verify a receipt. Returns (class, conformance, consistency).

    The third element exists so that the honest answer about consistency is
    part of this function's result rather than a footnote a caller might omit:
    verifying a receipt on its own **cannot** check consistency, so this
    function returns `CONSISTENCY_UNCHECKED`. A caller that also holds a
    retained/presented pair calls `loader.verify_receipt_against_pair`, which
    replaces that word with a measured verdict.
    """
    # Identity and algorithm fields refuse before any signature work: a document
    # carrying them is not made admissible by a valid signature over them.
    for name in sorted(ALGORITHM_FIELDS):
        if isinstance(receipt, dict) and name in receipt:
            raise CompositionRefusal(
                RECEIPT_TAMPERED, f"receipt carries a forbidden `{name}` field"
            )
    for name in sorted(IDENTITY_FIELDS):
        if isinstance(receipt, dict) and name in receipt:
            raise CompositionRefusal(RECEIPT_TAMPERED, f"receipt carries an identity field `{name}`")
    if not isinstance(receipt, dict) or set(receipt.keys()) != set(FIELDS):
        raise CompositionRefusal(RECEIPT_TAMPERED, "receipt does not carry the closed field set")
    check_payload({k: v for k, v in receipt.items() if k != "sig"})
    try:
        require_hex(receipt["sig"], 64, "sig")
    except ValueError as exc:
        raise CompositionRefusal(RECEIPT_TAMPERED, str(exc)) from exc
    if expect_pk is not None and receipt["issuerPk"] != expect_pk:
        raise CompositionRefusal(
            RECEIPT_TAMPERED,
            f"receipt names issuerPk {receipt['issuerPk'][:16]}… but the expected key is "
            f"{expect_pk[:16]}…",
        )
    if not ed25519.verify(
        bytes.fromhex(receipt["issuerPk"]), to_sign_bytes(receipt), bytes.fromhex(receipt["sig"])
    ):
        raise CompositionRefusal(
            RECEIPT_TAMPERED,
            "signature does not verify: the receipt's signed content does not match its signature",
        )
    approval, conformance = derive_class(receipt)
    return approval, conformance, CONSISTENCY_UNCHECKED


def receipt_digest(receipt: dict) -> str:
    """A digest of the receipt's canonical bytes. Names the exact document, which
    is what a report should cite rather than a filename."""
    return sha256_hex(canonicalize_bytes(receipt))


def write(path: str, receipt: dict) -> None:
    write_json(path, receipt)


def read(path: str) -> dict:
    return read_json(path)


def fresh_nonce() -> str:
    return to_hex(os.urandom(32))


def now() -> int:
    return int(time.time())
