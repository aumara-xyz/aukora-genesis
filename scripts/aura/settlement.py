#!/usr/bin/env python3
"""Aura settlement binding — an ACTUAL settlement's observation, retained in Aura's own history.

    python3 scripts/aura/settlement.py inscribe --state <aura-state> --settlement <kira-state> --out <dir>
    python3 scripts/aura/settlement.py confirm  --binding <dir>/settlement-binding.json \
                                                 --state <aura-state> --settlement <kira-state>

WHY THIS FILE EXISTS. Two append-only logs exist on this host and neither can currently see the
other:

  * Kira's memory store writes `<kira-state>/aura.jsonl` — one entry per governed `memory.put`,
    hash-linked from `aukora:aura-record:v1`, with a signed receipt beside it
    (`plugins/aukora-kira/lib/memory-owner.mjs`). That writer is Kira's and is NOT modified here.
  * the composition log writes `<aura-state>/aura/records.jsonl` — one entry per composition
    transition, floor `ZERO`, hashed over `{body, prev, seq}` (`scripts/composition/aura.py`).

The task they fail is the same one: a reader holding a settlement's receipt can ask "is this
settlement in the history I hold?", and today the only honest answers are "no mechanism" or "I
found a file with the same name". This file is the join, and only the join:

    inscribe   append ONE Aura entry whose body carries the settlement's own canonical line, so an
               observer who has the settlement's bytes can decide, for themselves,
               whether it is in this history
    confirm    re-derive the whole binding from the bytes: the Kira entry's hash from its preimage,
               the Aura entry's hash from the log's own rule, the receipt's signature under the
               store's published key, and the stream ID from the first entry of the history

NO SECOND LEDGER, AND THAT IS A CONSTRAINT RATHER THAN A TIDY PREFERENCE. This file does not write
into `<kira-state>` at all, mints no receipt, spends no nonce, and keeps no index of settlements.
The settlement ledger remains Kira's `aura.jsonl` and the Aura ledger remains
`<aura-state>/aura/records.jsonl`; what is added is ONE reference in ONE of them, and the
reference is recomputable from the settlement's bytes rather than trusted.

WHAT IS INDEPENDENT HERE, AND WHAT IS NOT. The Kira entry rule is RESTATED in this file
(`kira_entry_hash`, `kira_entry_preimage`) instead of imported from
`plugins/aukora-kira/lib/memory-owner.mjs`: importing the writer's own function would make the
checker and the producer the same arithmetic, which agrees by construction and verifies nothing.
The two are compared, not shared. The Aura entry hash is NOT restated — it is computed by
`scripts/composition/aura.py`, this repository's writer for that log, because restating a second
hash rule beside a writer is how two conventions drift apart.

WHAT THIS DOES NOT ESTABLISH. That the settlement happened in the world, that a person attended,
that the model intended it, that the effect had any consequence, or that only one history exists.
A binding is evidence that these bytes are in this history, at this position, under this
installation's own key — nothing else. Same-UID retention is not independent custody, and every
path here reports `RETAINER_SAME_OWNER` where it reports custody at all.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COMPOSITION_DIR = os.path.join(ROOT, "scripts", "composition")
for directory in (COMPOSITION_DIR,):
    if directory not in sys.path:
        sys.path.insert(0, directory)

import aura as aura_mod  # noqa: E402  (the composition log's own writer/reader, read-only here)
import ed25519 as ed25519_mod  # noqa: E402  (RFC 8032, stdlib only, already carried by this repo)
import jcs  # noqa: E402  (the canonical form this repository signs and hashes with)

EXIT_GREEN = 0
EXIT_UNRUNNABLE = 1
EXIT_REFUSED = 2

BINDING_SCHEMA = "aukora-aura-settlement-binding/v1"
#: Kira's own domain separator. Restated, deliberately, and checked against the bytes.
KIRA_DOMAIN = "aukora:aura-record:v1"
KIRA_RECEIPT_KIND = "aukora-kira-memory-receipt/v1"
KIRA_LOG_NAME = "aura.jsonl"
#: The SPKI DER prefix an Ed25519 public key carries. The raw key is the last 32 bytes; this
#: prefix is what makes "the last 32 bytes" a claim about the format rather than a guess.
ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
CUSTODY = "RETAINER_SAME_OWNER"


class SettlementRefusal(Exception):
    """A binding that cannot be re-derived from the bytes. Never a verdict, always a reason."""

    def __init__(self, code: str, reason: str):
        super().__init__(f"{code}: {reason}")
        self.code = code
        self.reason = reason


# ── Kira's entry rule, restated ─────────────────────────────────────────────────────────────


def kira_entry_preimage(prev: str, fields: dict) -> str:
    """The exact UTF-8 preimage Kira hashes: `{prev, ...fields, domain}`, canonical JSON.

    `fields` is the entry body without `hash` and `prev`. The domain is a member of the object,
    not a prefix of the text — that is the rule in `memory-owner.mjs:auraEntryPreimage`, and the
    restatement matters: if it drifts, `confirm` refuses a settlement instead of agreeing with it.
    """
    merged = {"prev": prev}
    merged.update(fields)
    merged["domain"] = KIRA_DOMAIN
    return jcs.canonicalize(merged)


def kira_entry_hash(prev: str, fields: dict) -> str:
    return hashlib.sha256(kira_entry_preimage(prev, fields).encode("utf-8")).hexdigest()


def kira_log_path(settlement_state: str) -> str:
    return os.path.join(os.path.abspath(settlement_state), KIRA_LOG_NAME)


def kira_log_sha256(settlement_state: str) -> str:
    with open(kira_log_path(settlement_state), "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def read_kira_chain(settlement_state: str) -> list[dict]:
    """Walk the settlement log from genesis, re-deriving every hash from its own bytes.

    Every failure is named, and the walk stops at the first one: an entry after a broken link is
    attributed to a head that never existed, so continuing would report positions that this store
    cannot support.
    """
    path = kira_log_path(settlement_state)
    if not os.path.exists(path):
        raise SettlementRefusal("kirastore-no-log", f"no settlement log at {path}")
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if text == "":
        raise SettlementRefusal("kirastore-log-empty", f"{path} holds no entries")
    if not text.endswith("\n"):
        raise SettlementRefusal(
            "kirastore-log-truncated",
            f"{path} does not end in a newline; the last line is not a whole entry",
        )
    entries: list[dict] = []
    prev = KIRA_DOMAIN
    for index, line in enumerate(text[:-1].split("\n"), start=1):
        try:
            entry = json.loads(line)
        except ValueError as exc:
            raise SettlementRefusal("kirastore-log-unparseable", f"{path} line {index}: {exc}") from exc
        if not isinstance(entry, dict) or isinstance(entry, list):
            raise SettlementRefusal("kirastore-log-unparseable", f"{path} line {index}: not one object")
        if "hash" not in entry:
            raise SettlementRefusal("kirastore-entry-unhashed", f"{path} line {index} carries no hash")
        stored = entry["hash"]
        fields = {name: value for name, value in entry.items() if name not in ("hash", "prev")}
        if entry.get("prev") != prev:
            raise SettlementRefusal(
                "kirastore-link-broken",
                f"{path} line {index} links {str(entry.get('prev'))[:16]}… but the entry before it hashes to "
                f"{str(prev)[:16]}…",
            )
        recomputed = kira_entry_hash(prev, fields)
        if recomputed != stored:
            raise SettlementRefusal(
                "kirastore-hash-mismatch",
                f"{path} line {index} stores hash {str(stored)[:16]}… and its own bytes hash to "
                f"{recomputed[:16]}…; the entry is not the bytes that were hashed",
            )
        prev = stored
        entries.append(entry)
    return entries


def entry_at(entries: list[dict], seq: int, where: str) -> dict:
    if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
        raise SettlementRefusal("kirastore-seq-invalid", f"{where} names position {seq!r}, not a positive integer")
    if seq > len(entries):
        raise SettlementRefusal(
            "kirastore-seq-beyond-log",
            f"{where} names position {seq} and the settlement log holds {len(entries)} entries",
        )
    return entries[seq - 1]


# ── the receipt's key, under the format it actually carries ─────────────────────────────────


def raw_ed25519_from_spki_pem(pem: str) -> bytes:
    """The raw 32-byte key from an Ed25519 SPKI PEM, or a refusal naming the shape it found."""
    if not isinstance(pem, str):
        raise SettlementRefusal("kirastore-issuer-malformed", f"the issuer key is {type(pem).__name__}, not PEM text")
    lines = [line.strip() for line in pem.strip().splitlines()]
    if len(lines) < 3 or not lines[0].startswith("-----BEGIN PUBLIC KEY-----") or not lines[-1].startswith("-----END"):
        raise SettlementRefusal("kirastore-issuer-malformed", "the issuer key is not a PEM public key")
    try:
        der = base64.b64decode("".join(lines[1:-1]), validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise SettlementRefusal("kirastore-issuer-malformed", f"the issuer PEM body is not base64: {exc}") from exc
    if not der.startswith(ED25519_SPKI_PREFIX) or len(der) != len(ED25519_SPKI_PREFIX) + 32:
        raise SettlementRefusal(
            "kirastore-issuer-not-ed25519",
            f"the issuer key's DER is {len(der)} bytes and does not carry the Ed25519 SPKI prefix",
        )
    return der[len(ED25519_SPKI_PREFIX):]


def receipt_signed_bytes(kind: str, body: dict) -> bytes:
    """`<kind>\\n<canonical body>` — Kira's domain-separated signing rule, restated."""
    return f"{kind}\n{jcs.canonicalize(body)}".encode("utf-8")


# ── reading the two logs, and the documents between them ────────────────────────────────────


def read_json_document(path: str, label: str) -> dict:
    try:
        with open(path, "rb") as handle:
            document = json.loads(handle.read().decode("utf-8"))
    except FileNotFoundError as exc:
        raise SettlementRefusal(f"{label}-absent", path) from exc
    except (UnicodeDecodeError, ValueError) as exc:
        raise SettlementRefusal(f"{label}-not-admissible", f"{path}: {exc}") from exc
    if not isinstance(document, dict):
        raise SettlementRefusal(f"{label}-not-admissible", f"{path} is {type(document).__name__}, not one object")
    return document


def read_aura_log(state: str) -> aura_mod.Aura:
    """Aura's log, through Aura's own reader: a damaged log refuses with the producer's reason.

    An ABSENT log is not an empty one, and the caller decides which of the two it may act on:
    `confirm` refuses (`aura-no-log`) because a history that is not there cannot hold anything,
    while `inscribe` may create it and says so in the binding. Reporting an absent log as an
    empty history is the failure this separation exists to prevent.
    """
    path = os.path.join(os.path.abspath(state), aura_mod.RECORDS_RELPATH)
    if not os.path.exists(path):
        raise SettlementRefusal("aura-no-log", f"no composition log at {path}")
    try:
        return aura_mod.Aura(path)
    except aura_mod.AuraError as exc:
        raise SettlementRefusal("aura-log-not-admissible", str(exc)) from exc


def aura_entry_of(log: aura_mod.Aura, seq: int, where: str) -> dict:
    if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
        raise SettlementRefusal("aura-seq-invalid", f"{where} names position {seq!r}, not a positive integer")
    if seq > log.size():
        raise SettlementRefusal(
            "aura-seq-beyond-log", f"{where} names position {seq} and the composition log holds {log.size()} entries"
        )
    return log.entries[seq - 1]


def stream_id_of(log: aura_mod.Aura) -> str:
    """The history's stream ID: first entry hash, prefixed. Restated from the adapter's rule."""
    if log.size() < 1:
        raise SettlementRefusal("aura-log-is-empty", "an empty history has no first entry to name")
    return f"aukora-aura-log-v1:{log.entries[0]['hash']}"


# ── inscribe: one reference in Aura's history ───────────────────────────────────────────────


def settlement_facts(settlement_state: str, receipt_name: str | None) -> dict:
    """Everything the Aura entry will carry, each value re-derived here rather than accepted."""
    entries = read_kira_chain(settlement_state)
    directory = os.path.abspath(settlement_state)
    if receipt_name is None:
        candidates = sorted(
            name for name in os.listdir(directory)
            if name.startswith("receipt-memory.put-") and name.endswith(".json")
        )
        if len(candidates) != 1:
            raise SettlementRefusal(
                "kirastore-receipt-not-singular",
                f"{directory} holds {len(candidates)} memory.put receipts ({', '.join(candidates) or 'none'}); "
                "name one with --receipt so the binding is about a settlement rather than about a directory",
            )
        receipt_name = candidates[0]
    receipt_path = os.path.join(directory, receipt_name)
    receipt = read_json_document(receipt_path, "receipt")
    if receipt.get("kind") != KIRA_RECEIPT_KIND:
        raise SettlementRefusal(
            "receipt-kind-unknown", f"{receipt_path} is kind {receipt.get('kind')!r}, not {KIRA_RECEIPT_KIND!r}"
        )
    block = receipt.get("aura")
    if not isinstance(block, dict):
        raise SettlementRefusal("receipt-not-admissible", f"{receipt_path} carries no aura block")
    seq = block.get("seq")
    entry = entry_at(entries, seq, f"{receipt_path} aura.seq")
    if entry.get("hash") != block.get("entryHash"):
        raise SettlementRefusal(
            "receipt-entry-mismatch",
            f"{receipt_path} names entry {str(block.get('entryHash'))[:16]}… and the settlement log's entry "
            f"{seq} hashes to {str(entry.get('hash'))[:16]}…",
        )
    if entry.get("key") != receipt.get("recordId"):
        raise SettlementRefusal(
            "receipt-record-mismatch",
            f"{receipt_path} names record {receipt.get('recordId')!r} and the log's entry {seq} names "
            f"{entry.get('key')!r}",
        )
    if entry.get("contentSha256") != receipt.get("effectDigest"):
        raise SettlementRefusal(
            "receipt-effect-mismatch",
            f"{receipt_path} binds effect {str(receipt.get('effectDigest'))[:16]}… and the log's entry {seq} "
            f"binds {str(entry.get('contentSha256'))[:16]}…",
        )
    if receipt.get("nonce") is None:
        raise SettlementRefusal("receipt-not-admissible", f"{receipt_path} names no nonce")
    # The spend is a file whose name is the digest of the nonce: the one-use property, checked
    # against the store rather than reported.
    spent_path = os.path.join(directory, "spent", hashlib.sha256(str(receipt["nonce"]).encode("utf-8")).hexdigest())
    if not os.path.exists(spent_path):
        raise SettlementRefusal(
            "settlement-nonce-unspent",
            f"{receipt_path} names nonce {receipt['nonce']} and no spend record exists at {spent_path}; "
            "a receipt whose nonce was never consumed is not evidence of a governed settlement",
        )
    with open(kira_log_path(directory), "rb") as handle:
        raw = handle.read()
    line_bytes = raw[:-1].split(b"\n")[seq - 1]
    return {
        "entries": entries,
        "receipt": receipt,
        "receiptName": receipt_name,
        "receiptSha256": hashlib.sha256(open(receipt_path, "rb").read()).hexdigest(),
        "receiptPath": receipt_path,
        "seq": seq,
        "entry": entry,
        "lineBytes": line_bytes,
        "lineSha256": hashlib.sha256(line_bytes).hexdigest(),
        "logSha256": hashlib.sha256(raw).hexdigest(),
        "issuedAt": receipt.get("issuedAt"),
        "recordId": receipt.get("recordId"),
        "contentSha256": receipt.get("effectDigest"),
        "nonce": receipt.get("nonce"),
    }


def retain_memory_head(settlement_state: str) -> dict:
    """Keep a head of the KIRA MEMORY LEDGER outside its own state directory.

    Called from the settle path, so this is the AUTOMATIC kind of retention: nobody is
    watching, and a failure here must never undo an effect that already happened. Two
    consequences, both deliberate.

      * THE DESTINATION IS NOT INVENTED HERE. A settle path that fell back to a path in the
        owner's home would write there on every settle — and on every test that drives one on
        disposable state, a test writing into the owner's archive. It retains when a target is
        actually named (`--target`, `AUKORA_AURA_MEMORY_RETAINER_TARGET`, or
        `<kira-state>/aura-memory-retainer.json`) and otherwise reports
        `MEMORY_HEAD_NOT_CONFIGURED`, which is the deliberate no-op and not an outage.
      * NOTHING HERE RAISES. Kira's ledger and the composition entry are already durable when
        this runs. A retainer that is down, misnamed or unreadable is a flag printed beside
        the receipt; it is never a rollback and never a settled-looking silence.

    The composition log this verb appends to and Kira's memory ledger are DIFFERENT FILES with
    different hash rules. Until this call existed, nothing retained a head of the second one
    anywhere the second one could reach, so the newest memory could be dropped and every
    verifier Genesis shipped still read green.
    """
    phase0_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "phase0")
    # A release must survive being used: an interpreter allowed to write caches writes them
    # INSIDE the release and the release's own artifact checker then counts the debris.
    sys.dont_write_bytecode = True
    if phase0_dir not in sys.path:
        sys.path.insert(0, phase0_dir)
    try:
        import memory_head  # noqa: PLC0415
    except ImportError as exc:
        return {"status": "MEMORY_HEAD_UNAVAILABLE", "detail": str(exc), "target": None}
    try:
        return memory_head.retain(settlement_state, allow_default=False)
    except Exception as exc:  # noqa: BLE001 — a settle path may not fail for retention
        return {"status": "MEMORY_HEAD_UNREACHED", "detail": str(exc), "target": None}


def verb_inscribe(args: argparse.Namespace) -> int:
    """Append one entry to the composition log that carries the settlement's own line.

    The body is the binding, and it is the whole reason a later reader can decide membership
    without trusting this file: `settlement.line` IS the canonical Kira line, so anyone who has
    that line can rehash it and compare. Nothing is renamed, reformatted or reinterpreted.

    A STATE WITH NO LOG YET. This verb will create `aura/records.jsonl` when it is absent, and
    the binding records `aura.logCreated: true` when it did. That is stated rather than silent
    because creating the file is not the same act as appending to one: the first entry of a
    history is what every later stream ID is derived from. Nothing else in this file writes to
    that path, and `confirm` will not create it — a history that is not there holds nothing.
    """
    log_path = os.path.join(os.path.abspath(args.state), aura_mod.RECORDS_RELPATH)
    log_absent = not os.path.exists(log_path)
    log = aura_mod.Aura(log_path) if log_absent else read_aura_log(args.state)
    facts = settlement_facts(args.settlement, args.receipt)
    line_text = facts["lineBytes"].decode("utf-8")
    already = [
        entry for entry in log.entries
        if isinstance(entry.get("body"), dict) and entry["body"].get("settlement", {}).get("line") == line_text
    ]
    if already:
        raise SettlementRefusal(
            "settlement-already-inscribed",
            f"the settlement log's entry {facts['seq']} ({facts['entry']['hash'][:16]}…) is already carried by "
            f"composition entry {already[0]['seq']}; inscribing it twice would be two references to one "
            "settlement, which is the shape a second ledger takes",
        )

    # The stream ID is the first entry of the history. When the history already has one, the
    # stream is known before this append and is written INSIDE the entry, so the entry says which
    # history it is in as well as where. When the history is empty, this entry BECOMES the first
    # one, and the value is not knowable until it exists — so it is left out rather than guessed.
    stream_before = stream_id_of(log) if log.size() > 0 else None
    body = {
        "kind": "settlement",
        "operation": "memory.put",
        "recordId": facts["recordId"],
        "contentSha256": facts["contentSha256"],
        "nonce": facts["nonce"],
        "receiptSha256": facts["receiptSha256"],
        # Scalar restatements of the block below, so a reader who is looking at a row of the
        # adapter's association report sees WHICH settlement entry this composition entry carries
        # without loading the whole line. They are part of the entry hash like every other body
        # field; the block is the evidence and these are its index.
        "settlementEntryHash": facts["entry"]["hash"],
        "settlementSeq": facts["seq"],
        "settlementLineSha256": facts["lineSha256"],
        "settlementLog": KIRA_LOG_NAME,
        "settlement": {
            "log": KIRA_LOG_NAME,
            "seq": facts["seq"],
            "entryHash": facts["entry"]["hash"],
            "priorHead": None if facts["entry"]["prev"] == KIRA_DOMAIN else facts["entry"]["prev"],
            "lineSha256": facts["lineSha256"],
            "line": line_text,
        },
    }
    if stream_before is not None:
        body["settlementStream"] = stream_before
    entry = log.append(body)
    stream = stream_id_of(log)

    binding = {
        "schema": BINDING_SCHEMA,
        "stream": stream,
        "aura": {
            "log": os.path.join(os.path.abspath(args.state), aura_mod.RECORDS_RELPATH),
            "logCreated": log_absent,
            "seq": entry["seq"],
            "entryHash": entry["hash"],
            "prev": entry["prev"],
            "priorHead": log.head_before(entry["seq"]),
            "compositionRoot": log.root(entry["seq"]),
            "logSize": log.size(),
        },
        "settlement": {
            "log": KIRA_LOG_NAME,
            "seq": facts["seq"],
            "entryHash": facts["entry"]["hash"],
            "priorHead": None if facts["entry"]["prev"] == KIRA_DOMAIN else facts["entry"]["prev"],
            "lineSha256": facts["lineSha256"],
            "line": line_text,
            "logSha256": facts["logSha256"],
        },
        "receipt": {
            "path": os.path.basename(facts["receiptPath"]),
            "sha256": facts["receiptSha256"],
            "kind": facts["receipt"].get("kind"),
            "recordId": facts["recordId"],
            "effectDigest": facts["contentSha256"],
            "nonce": facts["nonce"],
            "issuedAt": facts["issuedAt"],
            "issuerPk": facts["receipt"].get("issuerPk"),
        },
        "custody": CUSTODY,
        "ceilings": [
            "the binding shows a settlement's own bytes are in this history at this position; it says "
            "nothing about whether the write was wise, wanted, or consequential",
            "the settlement log and this composition log are both written by processes under one uid on "
            "one host: same-UID retention is not independent custody",
            "one reference is not a second ledger: no index, no receipt and no nonce is written into the "
            "settlement store by this command",
        ],
    }
    out = args.out
    os.makedirs(out, exist_ok=True)
    binding_path = os.path.join(out, "settlement-binding.json")
    with open(binding_path, "w", encoding="utf-8") as handle:
        json.dump(binding, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"INSCRIBED      : composition entry {entry['seq']}  {entry['hash']}")
    print(f"  stream        {stream}")
    if log_absent:
        print(f"  history       CREATED {log_path} — this entry is its first, so the stream ID above is new")
    print(f"  carries       settlement entry {facts['seq']}  {facts['entry']['hash']}")
    print(f"  line sha256   {facts['lineSha256']}")
    print(f"  receipt       {os.path.basename(facts['receiptPath'])}  sha256 {facts['receiptSha256']}")
    print(f"BINDING        : {binding_path}")
    print(f"CUSTODY        : {CUSTODY}  (one uid, one host — not an independent party)")
    print("  next: python3 scripts/aura/settlement.py confirm --binding "
          f"{binding_path} --state {args.state} --settlement {args.settlement}")

    # ── retention, AFTER the effect and the binding are already durable ────────────────────
    # Flag, never block: see retain_memory_head. It is printed on the same screen as the
    # inscribe so that "the entry is in the log" and "a head of the MEMORY ledger is kept
    # somewhere the ledger cannot rewrite" are two visible facts rather than one assumed one.
    memory = retain_memory_head(args.settlement)
    print(f"MEMORY RETENTION: {memory['status']}")
    if memory.get("target"):
        print(f"  head kept at   {memory['target']}  (outside the state directory)")
    if memory.get("treeSize") is not None:
        print(f"  retained size  {memory['treeSize']}  root {str(memory.get('root'))[:16]}…")
    if memory.get("detail"):
        print(f"  detail         {memory['detail']}")
    print("  ask it later:  python3 scripts/phase0/memory-head check "
          f"--state {args.settlement}")
    return EXIT_GREEN


# ── confirm: the whole binding, re-derived from bytes ───────────────────────────────────────


def verb_confirm(args: argparse.Namespace) -> int:
    """Recompute everything the binding claims. The Aura log is the only thing trusted here,
    and it is trusted the way it is always trusted: by re-deriving it from its own bytes."""
    binding = read_json_document(args.binding, "binding")
    if binding.get("schema") != BINDING_SCHEMA:
        raise SettlementRefusal(
            "binding-schema-unknown",
            f"{args.binding} is schema {binding.get('schema')!r}, not {BINDING_SCHEMA!r}",
        )
    carried = binding.get("settlement")
    if not isinstance(carried, dict) or not isinstance(carried.get("line"), str):
        raise SettlementRefusal("binding-incomplete", f"{args.binding} carries no settlement line to check")

    # 1. THE SETTLEMENT'S OWN BYTES. The line is hashed as it stands; a re-serialized copy would
    #    be a different object that happens to have the same fields.
    line_bytes = carried["line"].encode("utf-8")
    line_sha = hashlib.sha256(line_bytes).hexdigest()
    if line_sha != carried.get("lineSha256"):
        raise SettlementRefusal(
            "binding-line-sha-mismatch",
            f"the binding's line hashes to {line_sha[:16]}… and it records {str(carried.get('lineSha256'))[:16]}…",
        )
    try:
        line_entry = json.loads(carried["line"])
    except ValueError as exc:
        raise SettlementRefusal("binding-line-unparseable", f"the binding's settlement line is not JSON: {exc}") from exc
    if not isinstance(line_entry, dict):
        raise SettlementRefusal("binding-line-unparseable", "the binding's settlement line is not one object")
    stored_hash = line_entry.get("hash")
    fields = {name: value for name, value in line_entry.items() if name not in ("hash", "prev")}
    recomputed_line = kira_entry_hash(line_entry.get("prev"), fields)
    if recomputed_line != stored_hash:
        raise SettlementRefusal(
            "binding-line-hash-mismatch",
            f"the settlement line stores hash {str(stored_hash)[:16]}… and its own preimage hashes to "
            f"{recomputed_line[:16]}…; the line is not the bytes that were hashed",
        )
    if recomputed_line != carried.get("entryHash"):
        raise SettlementRefusal(
            "binding-entry-hash-mismatch",
            f"the binding names settlement entry {str(carried.get('entryHash'))[:16]}… and the line hashes to "
            f"{recomputed_line[:16]}…",
        )

    # 2. THE SETTLEMENT LOG, WALKED. The binding is checked against the store, and the store is
    #    re-derived from genesis, so an entry inserted or rewritten after issuance is caught here.
    entries = read_kira_chain(args.settlement)
    seq = carried.get("seq")
    entry = entry_at(entries, seq, "the binding's settlement.seq")
    if entry.get("hash") != carried.get("entryHash"):
        raise SettlementRefusal(
            "kirastore-entry-mismatch",
            f"{args.settlement}/{KIRA_LOG_NAME} entry {seq} hashes to {str(entry.get('hash'))[:16]}… and the "
            f"binding names {str(carried.get('entryHash'))[:16]}…",
        )
    # The line the binding carries must be THE line at that position, byte for byte. A binding
    # that carries a well-formed line the store does not hold is about another settlement.
    with open(kira_log_path(args.settlement), "rb") as handle:
        raw = handle.read()
    if not raw.endswith(b"\n"):
        raise SettlementRefusal("kirastore-log-truncated", f"{kira_log_path(args.settlement)} does not end in a newline")
    at_position = raw[:-1].split(b"\n")[seq - 1]
    if at_position != line_bytes:
        raise SettlementRefusal(
            "binding-line-not-at-this-position",
            f"the settlement log's line {seq} is not the line this binding carries "
            f"(sha256 {hashlib.sha256(at_position).hexdigest()[:16]}… vs {line_sha[:16]}…)",
        )
    prior_expected = None if entry.get("prev") == KIRA_DOMAIN else entry.get("prev")
    if prior_expected != carried.get("priorHead"):
        raise SettlementRefusal(
            "binding-prior-head-mismatch",
            f"the settlement log's entry {seq} links {str(prior_expected)[:16]}… and the binding records "
            f"{str(carried.get('priorHead'))[:16]}…",
        )

    # 3. THE AURA ENTRY. Found by the line it carries, then re-derived: the hash comes from
    #    `aura.Aura._load`, which recomputes every entry hash from the log's own bytes.
    log = read_aura_log(args.state)
    stream = stream_id_of(log)
    aura_block = binding.get("aura") if isinstance(binding.get("aura"), dict) else {}
    holders = [
        candidate for candidate in log.entries
        if isinstance(candidate.get("body"), dict)
        and candidate["body"].get("settlement", {}).get("line") == carried["line"]
    ]
    if not holders:
        raise SettlementRefusal(
            "aura-history-does-not-hold-it",
            f"no entry in {os.path.join(os.path.abspath(args.state), aura_mod.RECORDS_RELPATH)} carries this "
            "settlement's line; the reference this binding names is not in the history presented",
        )
    if len(holders) > 1:
        raise SettlementRefusal(
            "aura-history-holds-it-twice",
            f"{len(holders)} composition entries carry this settlement's line (positions "
            f"{[candidate['seq'] for candidate in holders]}); one settlement has one reference",
        )
    holder = holders[0]
    if aura_block.get("entryHash") != holder["hash"]:
        raise SettlementRefusal(
            "binding-aura-hash-mismatch",
            f"the binding names composition entry {str(aura_block.get('entryHash'))[:16]}… and the history's "
            f"entry {holder['seq']} hashes to {holder['hash'][:16]}…",
        )
    if aura_block.get("seq") != holder["seq"]:
        raise SettlementRefusal(
            "binding-aura-seq-mismatch",
            f"the binding names composition position {aura_block.get('seq')!r} and the entry carrying this "
            f"settlement is at {holder['seq']}",
        )
    if binding.get("stream") != stream:
        raise SettlementRefusal(
            "binding-stream-mismatch",
            f"the binding names stream {binding.get('stream')!r} and this history's first entry gives {stream!r}",
        )
    if aura_block.get("priorHead") != log.head_before(holder["seq"]):
        raise SettlementRefusal(
            "binding-aura-prior-head-mismatch",
            f"the binding records prior head {str(aura_block.get('priorHead'))[:16]}… and composition entry "
            f"{holder['seq']} follows {log.head_before(holder['seq'])[:16]}…",
        )
    if aura_block.get("compositionRoot") != log.root(holder["seq"]):
        raise SettlementRefusal(
            "binding-aura-root-mismatch",
            f"the binding records composition root {str(aura_block.get('compositionRoot'))[:16]}… and the root "
            f"over the first {holder['seq']} entries is {log.root(holder['seq'])[:16]}…",
        )
    # The Aura entry's OTHER body fields are part of the same entry hash, so a mismatch here is
    # not a second question about truth — it is the entry saying two different things about the
    # settlement it carries, and a reader cannot be asked to pick.
    entry_body = holder["body"]
    for name, expected in (
        ("recordId", line_entry.get("key")),
        ("contentSha256", line_entry.get("contentSha256")),
    ):
        if entry_body.get(name) != expected:
            raise SettlementRefusal(
                "binding-aura-body-disagrees",
                f"composition entry {holder['seq']} records {name} "
                f"{str(entry_body.get(name))[:16]}… and the settlement line it carries has "
                f"{str(expected)[:16]}…",
            )

    # 4. THE RECEIPT: the signature, under the key the store publishes, over the bytes it claims.
    receipt_name = args.receipt or (binding.get("receipt") or {}).get("path")
    if not isinstance(receipt_name, str) or receipt_name == "":
        raise SettlementRefusal("binding-incomplete", "the binding names no receipt and none was given")
    receipt_path = os.path.join(os.path.abspath(args.settlement), receipt_name)
    receipt = read_json_document(receipt_path, "receipt")
    if receipt.get("kind") != KIRA_RECEIPT_KIND:
        raise SettlementRefusal("receipt-kind-unknown", f"{receipt_path} is kind {receipt.get('kind')!r}")
    if receipt.get("recordId") != line_entry.get("key"):
        raise SettlementRefusal(
            "receipt-record-mismatch",
            f"{receipt_path} names record {receipt.get('recordId')!r} and the settlement entry names "
            f"{line_entry.get('key')!r}",
        )
    if receipt.get("effectDigest") != line_entry.get("contentSha256"):
        raise SettlementRefusal(
            "receipt-effect-mismatch",
            f"{receipt_path} binds effect {str(receipt.get('effectDigest'))[:16]}… and the settlement entry "
            f"binds {str(line_entry.get('contentSha256'))[:16]}…",
        )
    rblock = receipt.get("aura") if isinstance(receipt.get("aura"), dict) else {}
    for name, expected in (("seq", seq), ("entryHash", entry["hash"]), ("head", entry["hash"])):
        if rblock.get(name) != expected:
            raise SettlementRefusal(
                "receipt-position-mismatch",
                f"{receipt_path} says aura.{name} is {str(rblock.get(name))[:16]}… and the settlement log's "
                f"entry {seq} implies {str(expected)[:16]}…",
            )
    receipt_prior = None if entry.get("prev") == KIRA_DOMAIN else entry["prev"]
    if rblock.get("priorHead") != receipt_prior:
        raise SettlementRefusal(
            "receipt-position-mismatch",
            f"{receipt_path} says aura.priorHead is {str(rblock.get('priorHead'))[:16]}… and entry {seq} follows "
            f"{str(receipt_prior)[:16]}…",
        )

    # The spend, again from the store rather than from the receipt's word.
    spent_path = os.path.join(os.path.abspath(args.settlement), "spent",
                              hashlib.sha256(str(receipt.get("nonce")).encode("utf-8")).hexdigest())
    if not os.path.exists(spent_path):
        raise SettlementRefusal("settlement-nonce-unspent", f"no spend record for nonce {receipt.get('nonce')} at {spent_path}")

    issuer_snapshot = {"status": "absent", "source": os.path.join(os.path.abspath(args.settlement), "issuer.json")}
    published = None
    issuer_path = os.path.join(os.path.abspath(args.settlement), "issuer.json")
    if os.path.exists(issuer_path):
        stored = read_json_document(issuer_path, "issuer")
        published = stored.get("publicKey")
        issuer_snapshot = {
            "status": "pinned" if isinstance(published, str) else "unusable",
            "source": issuer_path,
            "publicKeySha256": hashlib.sha256(str(published).encode("utf-8")).hexdigest() if published else None,
        }
    carried_key = receipt.get("issuerPk")
    raw_key = raw_ed25519_from_spki_pem(carried_key)
    body = {name: value for name, value in receipt.items() if name not in ("sig", "issuerPk")}
    try:
        signature = bytes.fromhex(receipt["sig"])
    except (KeyError, ValueError) as exc:
        raise SettlementRefusal("receipt-signature-malformed", f"{receipt_path}: {exc}") from exc
    if not ed25519_mod.verify(raw_key, receipt_signed_bytes(KIRA_RECEIPT_KIND, body), signature):
        raise SettlementRefusal(
            "receipt-signature-invalid",
            f"{receipt_path}'s signature does not verify under the key it carries",
        )
    if published is not None and published != carried_key:
        raise SettlementRefusal(
            "receipt-key-not-the-store-key",
            f"{receipt_path} carries a key that is not the one {issuer_path} publishes; a signature under a "
            "carried key proves the document is self-consistent and not that this store issued it",
        )
    issuer_label = "issuer-pinned" if published is not None else "carried-key-only"

    print(f"BINDING        : ok — recomputed from the bytes")
    print(f"  stream        {stream}")
    print(f"  composition   entry {holder['seq']}  {holder['hash']}")
    print(f"  settlement    entry {seq}  {entry['hash']}")
    print(f"  record        {line_entry.get('key')}")
    print(f"  content       {line_entry.get('contentSha256')}")
    print(f"  receipt       {os.path.basename(receipt_path)}  {issuer_label}")
    print(f"  nonce         spent, at {os.path.relpath(spent_path, os.path.abspath(args.settlement))}")
    print(f"CUSTODY        : {CUSTODY}  (one uid, one host — not an independent party)")
    print("  what this does NOT establish: that the write was wanted, wise or consequential; that a "
          "person attended; that only one history exists.")
    print("  this command writes neither ledger: the settlement ledger stays Kira's aura.jsonl and the "
          "composition ledger stays aura/records.jsonl, and both were only read here.")
    if args.json:
        print(json.dumps({
            "verdict": "ok",
            "stream": stream,
            "aura": {"seq": holder["seq"], "entryHash": holder["hash"]},
            "settlement": {"seq": seq, "entryHash": entry["hash"], "recordId": line_entry.get("key")},
            "receipt": {"path": os.path.basename(receipt_path), "issuer": issuer_label},
            "issuer": issuer_snapshot,
            "custody": CUSTODY,
        }, indent=2, sort_keys=True))
    return EXIT_GREEN


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="aura-settlement",
        description="Bind one actual settlement's observation into an Aura history, and recompute it.",
    )
    verbs = parser.add_subparsers(dest="verb", required=True)

    inscribe = verbs.add_parser("inscribe", help="append the Aura entry that carries a settlement's own line")
    inscribe.add_argument("--state", required=True, help="the composition state directory holding aura/records.jsonl")
    inscribe.add_argument("--settlement", required=True, help="the Kira memory state directory holding aura.jsonl")
    inscribe.add_argument("--receipt", help="which receipt-memory.put-NNN.json is the settlement; default: the only one")
    inscribe.add_argument("--out", required=True, help="directory for settlement-binding.json")
    inscribe.set_defaults(handler=verb_inscribe)

    confirm = verbs.add_parser("confirm", help="recompute a binding from the bytes it is about")
    confirm.add_argument("--binding", required=True, help="settlement-binding.json from `inscribe`")
    confirm.add_argument("--state", required=True, help="the composition state directory to check it against")
    confirm.add_argument("--settlement", required=True, help="the settlement state directory to check it against")
    confirm.add_argument("--receipt", help="override the receipt file name the binding records")
    confirm.add_argument("--json", action="store_true", help="also print one machine-readable object")
    confirm.set_defaults(handler=verb_confirm)

    args = parser.parse_args(argv[1:])
    try:
        return args.handler(args)
    except SettlementRefusal as exc:
        print(f"REFUSE: {exc.code}: {exc.reason}", file=sys.stderr)
        return EXIT_REFUSED
    except (OSError, ValueError, aura_mod.AuraError) as exc:
        print(f"UNRUNNABLE: {type(exc).__name__}: {exc}", file=sys.stderr)
        return EXIT_UNRUNNABLE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
