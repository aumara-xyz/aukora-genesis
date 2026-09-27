#!/usr/bin/env python3
"""Verify one public-evidence export with the RELEASE's own vendored Diamond.

WHAT THIS IS. A caller, not a verifier. Every judgement belongs to the frozen
Diamond consumer vendored under ``vendor/kira-export``; this script's whole job
is to map an exporter manifest onto that CLI's arguments, run it as a bounded
subprocess, and report what came back without softening it.

WHAT IT IS NOT. It grants nothing. Cold verification answers "do these Kira bytes
and signatures agree under the keys I supplied" -- never "is this write
authorized", never "was a human present", never "did the pinned cell run". The
report it publishes keeps those answers in separate fields and prints the
consumer's own ceilings beside them.

THE ONE RULE THAT IS EASY TO GET WRONG. ``--expect`` is FIXED to ``verified``
here and is never taken from input. The frozen CLI exits 0 when the observed
verdict EQUALS the expectation, so a caller that forwarded an untrusted
``--expect refused`` would exit 0 on a refusal and could publish that as success.
This script refuses to forward it, and then refuses to treat exit 0 alone as
anything: ``VERIFIED`` requires exit 0 AND a report whose ``status`` and
``verified`` agree with it.

Usage:
  python3 scripts/kira/verify-public-evidence.py --export <export-dir>
      [--issuer-anchor <path>] [--approver-anchor <path>]
      [--retained-receipt <path>] [--package-root <dir>]
      [--record <export-relative>] [--timeout-seconds N] [--json]

Exit codes: 0 VERIFIED, 1 NOT VERIFIED (a verdict was reached and is published),
2 SETUP/REFUSED INPUT (no usable verdict; the export or the consumer is unusable).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import stat
import subprocess
import sys
from pathlib import Path

# The framing the frozen CLI emits. Exactly one block must be present: zero means
# no verdict was produced, and more than one means the output is ambiguous and we
# cannot say which block is the report.
BEGIN = "REPORT-JSON-BEGIN"
END = "REPORT-JSON-END"

# The expectation is fixed. See the module docstring: forwarding this from input
# is the defect that turns a refusal into a published success.
EXPECTED_VERDICT = "verified"

# The consumer's report is authoritative, so a bound that truncated it would be a
# silent loss of verdict. This ceiling is far above any real report (~10 KB) and
# exists so a runaway child cannot exhaust memory.
MAX_REPORT_BYTES = 4 * 1024 * 1024

# *** THE ARTIFACT BUDGET (A37 row 1, Fable's bounded read). *** *The producer caps what it will WRITE; this verifier had no cap
# on what it would READ, and two of its read loops accumulate the whole file in memory.* *** THE BUDGET IS THE PRODUCER'S OWN
# CONSTANT PLUS ONE BYTE, and the +1 is the point: a budget of exactly the producer's limit cannot distinguish "at the limit"
# from "over it" -- it refuses the former or accepts the latter. *** *Reading one byte more than the producer would ever write
# lets the oversize case be refused BY NAME instead of by truncation.* **MIRRORED, NEVER RETYPED: the parity arm compares this
# against `plugins/aukora-kira/lib/strict-read.mjs`, because a budget written down twice is a budget that drifts.**
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_READ_BYTES = MAX_ARTIFACT_BYTES + 1
DEFAULT_TIMEOUT_SECONDS = 120

MANIFEST_NAME = "manifest.json"
MANIFEST_KIND = "aukora-public-evidence-handoff/v1"


class InputRefused(Exception):
    """An input that makes verification impossible. Never a verdict."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def sha256_contained(export_root: Path, relative: str, label: str) -> tuple[str, int, Path]:
    """Resolve, open and hash a member — ALL FROM ONE DESCRIPTOR.

    THE WINDOW THIS CLOSES: `contained_file(...)` resolved a path and then `sha256_file(path)` REOPENED it.
    Between the two calls the path can be swapped for a link or a different file, and **the check and the
    hash would then be about two different objects** — which is the check-then-use window, in the one place
    where it decides whether a digest matches.

    So the open happens ONCE, with `O_NOFOLLOW`; `fstat` requires `S_ISREG`; and the digest is over the
    bytes read from THAT descriptor.
    """
    member = contained_file(export_root, relative, label)
    try:
        fd = os.open(member, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise InputRefused("EXPORT_MEMBER_MISSING", f"{label} names {relative!r}, which is not present")
    except OSError as exc:
        raise InputRefused("EXPORT_MEMBER_UNREADABLE",
                           f"{label} names {relative!r}, which could not be opened ({exc.strerror})") from exc
    digest = hashlib.sha256()
    length = 0
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise InputRefused("EXPORT_MEMBER_NOT_REGULAR", f"{label} names {relative!r}, which is not a file")
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            digest.update(chunk)
            length += len(chunk)
    finally:
        os.close(fd)
    return digest.hexdigest(), length, member


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), total


def _reject_duplicate_keys(pairs):
    """`object_pairs_hook` that refuses a repeated key instead of keeping the last.

    PORTED FROM AUKORA-37 `src37/store37.py` (the 8a break). A plain `json.loads` turns
    ``{"a": 1, "a": 2}`` into ``{"a": 2}``, so **one document can carry two different values for one
    field and the reader keeps whichever came last** — which is how a signature verifies against a value
    the signer never saw.
    """
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise InputRefused("DUPLICATE_KEY", f"the document repeats the key {key!r}")
        seen[key] = value
    return seen


def _refuse_non_finite_constant(name: str):
    """`parse_constant`: JSON HAS NO NaN AND NO Infinity, and `json.loads` accepts both by default.

    A packet carrying either cannot round-trip, so it cannot be judged -- and the refusal is a refusal,
    not a verdict. **MEASURED: without this hook `json.loads("NaN")` returns `nan` and the verifier
    proceeds as though it had read a number.**
    """
    raise InputRefused(
        "artifact:non-finite-number",
        f"the document contains {name}, which JSON does not permit; a number that cannot round-trip "
        f"cannot be judged")


def _finite_float(text: str) -> float:
    """`parse_float`: `1e400` is VALID JSON SYNTAX and overflows to `inf` WITHOUT calling `parse_constant`.

    *So the constant hook alone is not enough -- Fable named both, and this is why.* **A finite float is
    returned unchanged, so ordinary decimals behave exactly as before.**
    """
    value = float(text)
    if not math.isfinite(value):
        raise InputRefused(
            "artifact:non-finite-number",
            f"{text} is not a finite number; it overflows to {value!r}")
    return value


def _refuse_surrogates(node, label: str, where: str = "$") -> None:
    """Refuse a LONE SURROGATE anywhere in a parsed document (A37 row 1, Fable's surrogate check).

    *JSON escapes can name a surrogate directly -- `json.loads('"\\ud800"')` yields a string holding
    U+ D800 and nothing else -- and such a string cannot be encoded back to UTF-8, so a packet carrying
    one cannot round-trip.* **A value that cannot round-trip is not a value this verifier can judge, so it
    is refused by NAME AND POSITION rather than failing later inside an encoder.**

    *Keys are walked as well as values: a surrogate in a key is the same defect one level up.*
    """
    if isinstance(node, str):
        for ch in node:
            if 0xD800 <= ord(ch) <= 0xDFFF:
                raise InputRefused(
                    "artifact:lone-surrogate",
                    f"{label}: {where} contains the lone surrogate U+{ord(ch):04X}, which cannot be "
                    f"encoded as UTF-8; a value that cannot round-trip cannot be judged")
    elif isinstance(node, dict):
        for key, value in node.items():
            # *** THE PATH MUST NOT CARRY THE SURROGATE ITSELF (measured, and it cost a probe). *** *Interpolating
            # a raw key put the lone surrogate INTO the refusal message, so PRINTING the refusal raised
            # `UnicodeEncodeError` -- the check turned one crash into another.* **`ascii()` escapes it, so the
            # message names the position in a form that can always be written out.**
            shown = ascii(key) if isinstance(key, str) else str(key)
            _refuse_surrogates(key, label, f"{where}.{shown}")
            _refuse_surrogates(value, label, f"{where}.{shown}")
    elif isinstance(node, list):
        for position, value in enumerate(node):
            _refuse_surrogates(value, label, f"{where}[{position}]")


MAX_DEPTH = 64


def _refuse_deep(text: str, label: str) -> None:
    """Refuse a document nested deeper than `MAX_DEPTH` BEFORE parsing it (A37 row 1).

    *`json.loads` recurses once per level, so a deep document is refused only AFTER the interpreter has
    already recursed into it; the `RecursionError` mapping catches that, and this refuses it earlier and
    more cheaply.* *** THE SCAN IS A REAL JSON STRING SCANNER, NOT A BRACKET COUNT: A STRING MAY CONTAIN
    BRACKETS AND ESCAPED QUOTES, AND A COUNT THAT IGNORED THEM WOULD REFUSE LEGITIMATE PACKETS. *** *Inside a
    string a backslash escapes exactly the next character, which is the whole of the rule.*

    **A miscount here is not fatal: undercounting falls through to the parse and the `RecursionError`
    mapping still refuses, so this is an optimisation in front of a correctness fix rather than a
    replacement for one.**
    """
    depth = 0
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "[{":
            depth += 1
            if depth > MAX_DEPTH:
                raise InputRefused(
                    "json:depth-limit",
                    f"{label} nests deeper than {MAX_DEPTH} levels; a document this deep is not judgeable")
        elif ch in "]}":
            depth -= 1


def loads_strict(text: str, label: str) -> object:
    """Parse JSON text that did NOT come from a file — a subprocess's stdout, say.

    THE DUPLICATE-KEY RULE IS THE SAME RULE, so it goes through the same hook: a report block emitted by
    the frozen CLI can carry a repeated key exactly as a manifest can, and **the two readers must not
    disagree about what a document is**.
    """
    _refuse_deep(text, label)
    try:
        parsed = json.loads(text, object_pairs_hook=_reject_duplicate_keys,
                       parse_constant=_refuse_non_finite_constant, parse_float=_finite_float)
    except InputRefused:
        raise
    except ValueError as exc:
        raise InputRefused("artifact:malformed-json", f"{label} is not JSON ({exc})") from exc
    except RecursionError as exc:
        # *** DEPTH IS A REFUSAL, NOT A CRASH (A37 row 1, Fable's depth limit). *** *`json.loads` recurses once per
        # nesting level, so a deeply nested document raises `RecursionError` -- which is NOT a `ValueError`, so it
        # escaped every handler here and exited 1.* *** A reader sees exit 1 as the published verdict `NOT VERIFIED`;
        # the truth is that the document is too deep to judge. *** **`RecursionError` is caught by name and mapped to
        # the producer's own code, `json:depth-limit`.**
        raise InputRefused(
            "json:depth-limit",
            f"{label} nests too deeply to parse ({exc}); a document this deep is not judgeable") from exc
    # *** THE DOCUMENT MUST BE AN OBJECT (A37 row 1, Fable's dict guards). *** *A `[]` document parsed
    # cleanly and then reached callers that index it as a mapping, so the refusal a stranger deserves
    # arrived instead as an `AttributeError` traceback and exit 1*
    # -- **which a reader sees as the published verdict `NOT VERIFIED` rather than as `we could not judge
    # this`.** *A manifest and every record are objects, so a document of the wrong kind is refused by
    # name here, at the choke point the file readers pass through.* **A JSON array is not a MALFORMED
    # document -- it is a document of the wrong kind -- so it gets its own code rather than borrowing
    # `artifact:malformed-json`.**
    if not isinstance(parsed, dict):
        raise InputRefused(
            "artifact:not-an-object",
            f"{label} is a JSON {type(parsed).__name__}, not an object; a manifest and every record must "
            f"be an object, so this packet cannot be judged")
    _refuse_surrogates(parsed, label)
    return parsed


def read_json_strict(path: Path) -> object:
    """Read JSON from a path the way a stranger's bytes deserve to be read.

    PORTED FROM AUKORA-37 `src37/store37.py:67-114`. Every clause below closes a measured defect:
    - ``O_NOFOLLOW`` so a SYMLINK in the slot is refused rather than followed;
    - ``O_NONBLOCK`` so a FIFO cannot BLOCK the open before any check can refuse it;
    - ``fstat`` on the DESCRIPTOR with ``S_ISREG``, then read **from that same descriptor** — so nothing
      is checked by path and then reopened, which is the check-then-use window itself;
    - strict UTF-8, so a corrupt byte is a refusal and not a U+FFFD that parses;
    - duplicate keys refused at the same boundary.

    **ENOENT PASSES THROUGH.** "Absent" is a fact each caller names for itself, and a reader that
    invented a code for it would be answering a question it was not asked.
    """
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise
    except OSError as exc:
        # ELOOP lands here (the symlink), and so does EISDIR for a directory on some systems.
        raise InputRefused("artifact:nonregular-file",
                           f"{os.fspath(path)} could not be opened as a regular file ({exc.strerror})") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise InputRefused("artifact:nonregular-file",
                               f"{os.fspath(path)} is not a regular file")
        raw = os.read(fd, min(info.st_size, MAX_READ_BYTES) if info.st_size > 0 else 1)
        # A file that grew between fstat and read must not be silently truncated: read to EOF too.
        chunks = [raw]
        total = len(raw)
        # *** THE SAME CEILING AS THE RECORD READER (A37 row 1). *** *This loop accumulates too, and it is the
        # WORSE of the two: it reads `st_size` first and then keeps reading past it, so a file that grows
        # while it is being read is followed.* **The first read is capped as well -- `st_size` is the writer's
        # claim about a file the reader does not control, so asking the kernel for that many bytes is the
        # same unbounded request one step earlier.**
        if total > MAX_READ_BYTES:
            raise InputRefused(
                "artifact:too-large",
                f"{os.fspath(path)} exceeds the {MAX_ARTIFACT_BYTES}-byte artifact budget "
                f"(read {total} bytes); the producer never writes one this big, so this packet is not judgeable")
        while True:
            more = os.read(fd, 65536)
            if not more:
                break
            total += len(more)
            if total > MAX_READ_BYTES:
                raise InputRefused(
                    "artifact:too-large",
                    f"{os.fspath(path)} exceeds the {MAX_ARTIFACT_BYTES}-byte artifact budget "
                    f"(read {total} bytes); the producer never writes one this big, so this packet is not judgeable")
            chunks.append(more)
        body = b"".join(chunks)
    finally:
        os.close(fd)
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InputRefused("artifact:not-utf8",
                           f"{os.fspath(path)} is not valid UTF-8 at byte {exc.start}") from exc
    return loads_strict(text, os.fspath(path))


CARD_LEDGER_NAME = "card-ledger.jsonl"
CARD_FIELDS = ("seq", "prevHash", "lane", "kind", "digest", "action", "time", "sender", "nonceHash")
GENESIS = "0" * 64


def card_entry_hash(entry: dict) -> str:
    """The hash of one card entry — over the FIELDS IN ORDER, and NOT over the hash itself.

    THE SAME RULE AS THE JS MODULE, WRITTEN OUT AGAIN BECAUSE THIS IS A DIFFERENT LANGUAGE. That is a
    second implementation and therefore a second thing to keep in step, **which is why the court asserts
    both readers agree on the same bytes rather than each agreeing with itself.**
    """
    ordered = {field: entry.get(field) for field in CARD_FIELDS}
    return hashlib.sha256(json.dumps(ordered, separators=(",", ":")).encode("utf-8")).hexdigest()


def read_json_strict_lines(path: Path):
    """One JSON document per line, read through the STRICT reader and with a torn tail refused.

    A TORN TAIL IS NOT A GAP: appends only add at the end, so only the LAST line can be cut off mid-write,
    and nothing is missing from the middle.
    """
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise InputRefused("artifact:nonregular-file", f"{os.fspath(path)} is not a regular file") from exc
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise InputRefused("artifact:nonregular-file", f"{os.fspath(path)} is not a regular file")
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            total += len(chunk)
            # *** THE CEILING IS CHECKED AS THE FILE IS READ, NOT AFTER. *** *A reader that accumulates first and measures
            # afterwards has already paid the cost the bound exists to avoid.*
            if total > MAX_READ_BYTES:
                raise InputRefused(
                    "artifact:too-large",
                    f"{os.fspath(path)} exceeds the {MAX_ARTIFACT_BYTES}-byte artifact budget "
                    f"(read {total} bytes); the producer never writes one this big, so this packet is not judgeable")
            chunks.append(chunk)
    finally:
        os.close(fd)
    text = b"".join(chunks).decode("utf-8")
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    for index, line in enumerate(lines):
        try:
            _refuse_deep(line, f"record {index + 1} of {os.fspath(path)}")
            entry = json.loads(line, object_pairs_hook=_reject_duplicate_keys,
                                    parse_constant=_refuse_non_finite_constant, parse_float=_finite_float)
        except InputRefused:
            raise
        except ValueError as exc:
            where = "the last line is TORN — it was cut off mid-write" if index == len(lines) - 1 \
                else f"line {index + 1} is not JSON, and only the LAST line can be torn"
            raise InputRefused("card-chain/torn", f"{os.fspath(path)}: {where} ({exc})") from exc
        except RecursionError as exc:
            # THE SAME REFUSAL ON THE RECORD READER: a single deeply nested line raises here too (A37 row 1).
            raise InputRefused(
                "json:depth-limit",
                f"{os.fspath(path)}: line {index + 1} nests too deeply to parse ({exc})") from exc
        # *** A RECORD MUST BE AN OBJECT (A37 row 1, Fable's dict guards, part 2 of 2). *** *This reader parses
        # each line ITSELF, so the whole-file guard in `loads_strict` never sees these.* **A line that is a JSON
        # array parsed cleanly and then reached callers that index it as a mapping -- an `AttributeError` and
        # exit 1, which a reader sees as the published verdict `NOT VERIFIED` rather than as `we could not judge
        # this`.** *`index` is in scope HERE and not in the whole-file reader, so this refusal can name WHICH
        # record is the wrong kind.* **Anchored after the `card-chain/torn` raise, which is the last statement of
        # the second `except` -- the first attempt guessed the insertion point from indentation and landed inside
        # a docstring (R686).**
        if not isinstance(entry, dict):
            raise InputRefused(
                "artifact:not-an-object",
                f"record {index + 1} of {len(lines)} is a JSON {type(entry).__name__}, not an object; every "
                f"record must be an object, so this packet cannot be judged")
        _refuse_surrogates(entry, f"record {index + 1} of {os.fspath(path)}")
        yield entry


def verify_card_chain(export_root: Path, manifest: dict) -> dict:
    """Verify the exported card chain cold.

    THE VERDICT CODES ARE `card-chain/*`, THE SAME STRINGS THE JS READER EMITS. They were
    `CARD_CHAIN_INCOMPLETE` here and `card-chain/incomplete` there, and **a stranger cannot compare two
    verdicts that are spelled differently** — so "both readers agree" was unverifiable and no downstream
    check could cover both. **The chain's own names win, because `card-chain.mjs` is where the rule
    lives.**

    **MISSING ENTRIES READ AS INCOMPLETE, NOT CLEAN.** A reader that says "the entries I found are all
    correctly chained" is describing a ledger IT CANNOT SEE THE HOLE IN — the same fault as skipping a
    record it could not parse. So the manifest's declared count is checked against what is actually there:
    the file cannot notice that it is short, and the count is the one fact that lives outside it.
    """
    declared = manifest.get("cardChain") or {}
    if declared.get("present") is not True:
        return {"ok": True, "present": False, "entries": 0,
                "reason": "this handoff declares no card ledger"}
    member = export_root / CARD_LEDGER_NAME
    if not member.exists():
        return {"ok": False, "code": "card-chain/incomplete", "declared": declared.get("entries"),
                "reason": f"the manifest declares a card ledger and {CARD_LEDGER_NAME} is not present"}
    try:
        entries = []
        for line in read_json_strict_lines(member):
            entries.append(line)
    except InputRefused as exc:
        return {"ok": False, "code": "card-chain/torn", "reason": str(exc)}

    for index, entry in enumerate(entries):
        expected_seq = index + 1
        if entry.get("seq") != expected_seq:
            # A GAP AND A REORDER ARE DIFFERENT DEFECTS: if the expected seq appears LATER nothing is
            # missing and somebody has been editing; if it appears NOWHERE an entry is gone.
            later = any(other.get("seq") == expected_seq for other in entries[index + 1:])
            return {"ok": False, "code": "card-chain/broken" if later else "card-chain/incomplete",
                    "expected": expected_seq, "found": entry.get("seq"),
                    "reason": f"entry {index + 1} is seq {entry.get('seq')}; the chain expects {expected_seq}"}
        expected_prev = GENESIS if index == 0 else entries[index - 1].get("hash")
        if entry.get("prevHash") != expected_prev:
            return {"ok": False, "code": "card-chain/broken", "seq": entry.get("seq"),
                    "reason": f"entry {entry.get('seq')} does not chain to its predecessor"}
        if card_entry_hash(entry) != entry.get("hash"):
            return {"ok": False, "code": "card-chain/broken", "seq": entry.get("seq"),
                    "reason": f"entry {entry.get('seq')} does not hash to the value it carries"}

    if isinstance(declared.get("entries"), int) and declared["entries"] != len(entries):
        return {"ok": False, "code": "card-chain/incomplete", "declared": declared["entries"],
                "found": len(entries),
                "reason": f"the manifest declares {declared['entries']} card entr(ies) and the ledger "
                          f"holds {len(entries)}: THE LEDGER IS SHORT, which is not the same as the "
                          "entries in it being correctly chained"}
    head = entries[-1]["hash"] if entries else GENESIS
    return {"ok": True, "present": True, "entries": len(entries), "head": head}


def contained_file(export_root: Path, relative: str, label: str) -> Path:
    """Resolve ``relative`` under ``export_root`` and refuse any escape.

    Both checks are needed and they are different checks. The lexical one catches
    ``..`` in the manifest; the realpath one catches a SYMLINK inside the export
    that points outside it, which a lexical check cannot see because the manifest
    still says ``evidence/records/x.json``. An export is a directory of bytes a
    stranger handed us, so neither is optional.
    """
    if not isinstance(relative, str) or not relative:
        raise InputRefused("EXPORT_MEMBER_UNNAMED", f"{label} is not a named member")
    if os.path.isabs(relative) or ".." in Path(relative).parts:
        raise InputRefused("EXPORT_MEMBER_ESCAPES", f"{label} names {relative!r}, which is not inside the export")
    candidate = export_root / relative
    if not candidate.is_file():
        raise InputRefused("EXPORT_MEMBER_MISSING", f"{label} names {relative!r}, which is not present")
    real_root = os.path.realpath(export_root)
    real_candidate = os.path.realpath(candidate)
    if real_candidate != real_root and not real_candidate.startswith(real_root + os.sep):
        raise InputRefused("EXPORT_MEMBER_ESCAPES",
                           f"{label} names {relative!r}, which resolves outside the export")
    # ── EVERY COMPONENT, NOT JUST THE LEAF ───────────────────────────────────────────────────────
    # `realpath` on the leaf catches a link AT the leaf. It does NOT catch a SYMLINKED DIRECTORY in the
    # middle of the path, which is the same escape one level up: `evidence` itself can be a link out of
    # the export while every file name underneath it reads as contained.
    walk = export_root
    for part in Path(relative).parts:
        walk = walk / part
        if os.path.islink(walk):
            raise InputRefused("EXPORT_MEMBER_SYMLINK",
                               f"{label} names {relative!r}, whose component {part!r} is a symlink; "
                               "an export carries bytes, not links")
    # THE SECOND REFUSAL THAT USED TO SIT HERE WAS INSIDE THE LOOP, SO IT FIRED ON THE FIRST COMPONENT OF
    # EVERY NAME AND NEVER LOOKED AT THE REST OF THE PATH. A member called `anchors/approver` was reported as
    # "which is a symlink" whether or not anything was a link, so the driver REFUSED EVERY EXPORT whose member
    # names contain a separator — which is nearly all of them — with a reason that was simply false. The loop
    # above already refuses a symlink at the leaf (its last iteration IS the leaf) and at any directory in
    # between, which is everything the deleted line was trying to say.
    return candidate


def verify_manifest_digests(export_root: Path, manifest: dict) -> None:
    """Every member the manifest lists must hash to what it says."""
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise InputRefused("EXPORT_MANIFEST_FILENESS", "the manifest lists no files")
    for entry in files:
        relative = entry.get("path") if isinstance(entry, dict) else None
        # ONE OPEN: the containment check and the digest are about the SAME descriptor.
        digest, length, member = sha256_contained(export_root, relative, "manifest file entry")
        if digest != entry.get("sha256"):
            raise InputRefused("EXPORT_MEMBER_DIGEST_MISMATCH",
                               f"{relative} hashes to {digest}, the manifest pins {entry.get('sha256')}")
        if entry.get("bytes") is not None and length != entry.get("bytes"):
            raise InputRefused("EXPORT_MEMBER_SIZE_MISMATCH",
                               f"{relative} is {length} bytes, the manifest pins {entry.get('bytes')}")


def anchor_path(manifest: dict, export_root: Path, name: str, supplied: str | None, required: bool) -> str | None:
    """Resolve a NAMED anchor. Supplied wins; otherwise the export's own copy.

    An anchor carried in the export is a DESCRIPTION of a key, not the trust
    decision -- which is why a caller may override it, and why both routes are
    reported. Neither route falls back to a fixture key: missing means refused.
    """
    if supplied:
        candidate = Path(supplied).expanduser()
        if not candidate.is_file():
            raise InputRefused("ANCHOR_MISSING", f"the supplied {name} anchor {supplied!r} is not a file")
        return str(candidate)
    for entry in manifest.get("anchors", []) or []:
        if isinstance(entry, dict) and entry.get("name") == name:
            return str(contained_file(export_root, entry.get("path"), f"{name} anchor"))
    if required:
        raise InputRefused("ANCHOR_UNDECLARED",
                           f"no {name} anchor was supplied and the export carries none; "
                           "there is no unanchored mode and no fixture fallback")
    return None


def parse_one_report(stdout: str) -> dict:
    """Extract EXACTLY one framed report, refusing absence, ambiguity, malformation."""
    begins = stdout.count(BEGIN)
    ends = stdout.count(END)
    if begins == 0 and ends == 0:
        raise InputRefused("REPORT_ABSENT", "the consumer printed no REPORT-JSON block")
    if begins != 1 or ends != 1:
        raise InputRefused("REPORT_AMBIGUOUS",
                           f"expected exactly one REPORT-JSON block, found {begins} begin marker(s) "
                           f"and {ends} end marker(s)")
    start = stdout.index(BEGIN) + len(BEGIN)
    stop = stdout.index(END, start)
    body = stdout[start:stop].strip()
    if not body:
        raise InputRefused("REPORT_EMPTY", "the REPORT-JSON block is empty")
    try:
        report = loads_strict(body, "the verifier's report block")
    except json.JSONDecodeError as exc:
        raise InputRefused("REPORT_MALFORMED", f"the REPORT-JSON block is not JSON: {exc}") from exc
    if not isinstance(report, dict):
        raise InputRefused("REPORT_MALFORMED", "the REPORT-JSON block is not a JSON object")
    return report


def build_argv(args, export_root: Path, manifest: dict) -> tuple[list[str], dict]:
    """Map the manifest onto the frozen CLI. Every path is export-relative."""
    records = manifest.get("records")
    if not isinstance(records, list) or not records:
        raise InputRefused("EXPORT_HAS_NO_RECORDS", "the manifest carries no record to verify")

    # The record to verify: the caller may name one; otherwise the ONLY one, so an
    # export carrying several is never silently reduced to whichever sorted first.
    if args.record:
        chosen = next((r for r in records if isinstance(r, dict)
                       and args.record in (r.get("contentSha256"), r.get("recordPath"))), None)
        if chosen is None:
            raise InputRefused("EXPORT_RECORD_UNKNOWN", f"no record in the manifest matches {args.record!r}")
    elif len(records) == 1:
        chosen = records[0]
    else:
        raise InputRefused("EXPORT_RECORD_AMBIGUOUS",
                           f"the manifest carries {len(records)} records; name one with --record")

    record_path = contained_file(export_root, chosen.get("recordPath"), "the record")
    receipt_path = contained_file(export_root, chosen.get("receiptPath"), "the receipt")
    log_path = contained_file(export_root, "evidence/aura.jsonl", "the Aura log")

    issuer = anchor_path(manifest, export_root, "issuer", args.issuer_anchor, required=True)
    approver = anchor_path(manifest, export_root, "approver", args.approver_anchor, required=False)

    argv = [
        # -E -s: the consumer ignores PYTHON* variables and the user site, so the caller's environment cannot steer it.
        sys.executable, '-E', '-s', str(Path(args.consumer).resolve()),
        "--package-root", str(Path(args.package_root).resolve()),
        "--record", str(record_path),
        "--receipt", str(receipt_path),
        "--log", str(log_path),
        "--anchor", issuer,
        # FIXED, never forwarded from input.
        "--expect", EXPECTED_VERDICT,
        "--json",
    ]
    mapping = {
        "record": chosen.get("recordPath"),
        "receipt": chosen.get("receiptPath"),
        "log": "evidence/aura.jsonl",
        "issuerAnchor": "supplied" if args.issuer_anchor else "carried-in-export",
        "approverAnchor": None,
        "artifact": None,
        "artifactContent": None,
        "retainedReceipt": None,
        "expect": EXPECTED_VERDICT,
    }

    # The approval's exact bytes, when the manifest accounts for one. `--artifact`
    # plus `--artifact-content` is what binds an approval to the bytes it was
    # issued for; a manifest that carries an approval but no content path is the
    # named gap and is left for the consumer to report, not repaired here.
    approval = chosen.get("approval")
    if isinstance(approval, dict) and approval.get("artifactPath"):
        argv += [
            "--artifact", str(contained_file(export_root, approval.get("artifactPath"), "the approval artifact")),
            "--artifact-content", str(contained_file(export_root, approval.get("contentPath"), "the approved content")),
        ]
        mapping["artifact"] = approval.get("artifactPath")
        mapping["artifactContent"] = approval.get("contentPath")
        if approver is not None:
            argv += ["--artifact-anchor", approver]
            mapping["approverAnchor"] = "supplied" if args.approver_anchor else "carried-in-export"
    if args.retained_receipt:
        retained = Path(args.retained_receipt).expanduser()
        if not retained.is_file():
            raise InputRefused("RETAINED_RECEIPT_MISSING", f"{args.retained_receipt!r} is not a file")
        argv += ["--retained-receipt", str(retained)]
        mapping["retainedReceipt"] = str(retained)
    return argv, mapping


#: A summary is never presented as fact. This is the only label a summary may carry.
SUMMARY_LABEL = "model-inference"

#: The three-valued outcome. INCOMPLETE is NOT a soft failure: a supersedes target that is not in the
#: packet means the chain cannot be read from these bytes alone, and saying so by name is the honest
#: answer. **Refuse rather than accuse** -- an absent target is not evidence of a forged one.
SUMMARY_CLEAN = "CLEAN"
SUMMARY_INCOMPLETE = "INCOMPLETE"
SUMMARY_NOT_VERIFIED = "NOT_VERIFIED"


def check_summaries(export_root: Path, consumer_verified: bool) -> dict:
    """Every settled summary in the packet, checked as a summary rather than as a record.

    A summary verifies ONLY if all of these hold:

      1. its record hash and its Aura position check -- which is the consumer's verdict,
         passed in rather than recomputed here: this file maps arguments and reports
         what Diamond said, and a second implementation of the same check is a second
         thing to get wrong;
      2. its label is `model-inference` -- a summary that presents itself as fact is
         refused, because the record kind and the label disagreeing is the defect;
      3. every `supersedes` target is EITHER in the packet and itself a summary of the
         SAME lane, OR reported by name as NOT_IN_PACKET.

    A target that is absent makes the whole reading INCOMPLETE -- never a pass, and
    never an accusation. It is not evidence that the target was forged or withheld;
    it is evidence that THIS PACKET cannot answer the question.
    """
    records_dir = export_root / "evidence" / "records"
    summaries: list[dict] = []
    if records_dir.is_dir():
        for path in sorted(records_dir.glob("*.json")):
            # ── A RECORD THAT CANNOT BE READ IS A REFUSAL, NOT AN OMISSION ────────────────────────
            # This was `except (OSError, ValueError): continue`: the unreadable record simply VANISHED,
            # and a packet whose summary cannot be parsed then reported as a packet with one fewer
            # summary — **a healthier answer than the truth, produced by the reader rather than by the
            # packet.** Absence is something a caller may name; a reader that invents it is lying.
            document = read_json_strict(path)
            # The record rides as its own document; a wrapper that names `value` is unwrapped once.
            record = document.get("value") if isinstance(document.get("value"), dict) else document
            if not isinstance(record, dict) or record.get("kind") != "summary":
                continue
            summaries.append({"name": path.name, "record": record})

    if not summaries:
        return {"status": SUMMARY_CLEAN, "summaries": [], "findings": []}

    by_id = {}
    for entry in summaries:
        record_id = entry["record"].get("recordId")
        if isinstance(record_id, str):
            by_id[record_id] = entry

    findings: list[dict] = []
    incomplete = False
    for entry in summaries:
        content = entry["record"].get("content")
        content = content if isinstance(content, dict) else {}
        thread = content.get("thread") if isinstance(content.get("thread"), dict) else {}
        lane = thread.get("lane")
        label = content.get("label")

        if label != SUMMARY_LABEL:
            findings.append({
                "summary": entry["name"], "rule": "label",
                "detail": f"label is {label!r}, not {SUMMARY_LABEL!r}; "
                          "a summary is never presented as fact",
            })

        links = entry["record"].get("links")
        for link in links if isinstance(links, list) else []:
            if not isinstance(link, dict) or link.get("relation") != "supersedes":
                continue
            target_id = link.get("recordId")
            target = by_id.get(target_id) if isinstance(target_id, str) else None
            if target is None:
                # NAMED, AND INCOMPLETE. Never a pass, never an accusation.
                incomplete = True
                findings.append({
                    "summary": entry["name"], "rule": "supersedes",
                    "outcome": "NOT_IN_PACKET", "target": target_id,
                    "detail": "the superseded summary is not in this packet; the chain cannot be "
                              "read from these bytes. This is INCOMPLETE, not a failure and not a "
                              "finding against the producer.",
                })
                continue
            target_content = target["record"].get("content")
            target_content = target_content if isinstance(target_content, dict) else {}
            target_thread = target_content.get("thread") if isinstance(target_content.get("thread"), dict) else {}
            if target_thread.get("lane") != lane:
                findings.append({
                    "summary": entry["name"], "rule": "supersedes",
                    "outcome": "WRONG_LANE", "target": target_id,
                    "detail": f"the superseded summary is of lane {target_thread.get('lane')!r}, "
                              f"not {lane!r}; a lane's chain must not cross into another lane",
                })

    failed = any(f.get("rule") == "label" or f.get("outcome") == "WRONG_LANE" for f in findings)
    if failed:
        status = SUMMARY_NOT_VERIFIED
    elif incomplete or not consumer_verified:
        status = SUMMARY_INCOMPLETE
    else:
        status = SUMMARY_CLEAN
    return {
        "status": status,
        "count": len(summaries),
        "findings": findings,
        "consumerVerified": consumer_verified,
    }


def separate_findings(report: dict, exit_code: int, stderr: str,
                      export_root: Path | None = None) -> dict:
    """Keep every distinct question in its own field, and publish the verdict.

    The fields are NOT collapsed into one boolean on purpose. "The signatures
    agree", "a human was present", "execution was authorized", "history is
    complete" and "the cell ran" are five different questions with five different
    answers, and a report that merged them would be the defect this whole
    increment exists to avoid.
    """
    status = report.get("status")
    verified = report.get("verified") is True
    execution = report.get("execution") if isinstance(report.get("execution"), dict) else {}
    authority = report.get("authorityScope") if isinstance(report.get("authorityScope"), dict) else {}
    retention = report.get("retention") if isinstance(report.get("retention"), dict) else {}
    approval = report.get("approval") if isinstance(report.get("approval"), dict) else None

    # THE RULE. Exit 0 alone is never VERIFIED, and it never overrides the report:
    # the CLI returns 0 when the observed verdict equals the expectation, and the
    # expectation is fixed to `verified` above -- but a caller must still require
    # the report to agree, because "exit 0" is a claim about the expectation and
    # not about the evidence.
    agrees = status == "VERIFIED" and verified
    published = "VERIFIED" if (agrees and exit_code == 0) else "NOT_VERIFIED"

    reasons = []
    if not agrees:
        reasons.append(f"the consumer reported status={status!r} verified={verified!r}")
    if exit_code != 0:
        reasons.append(f"the consumer exited {exit_code}")
    if agrees and exit_code != 0:
        reasons.append("the report says VERIFIED and the process exit disagrees; "
                       "a verdict that contradicts its own exit status is not published as verified")

    return {
        "publication": published,
        # The consumer's own verdict, preserved verbatim.
        "consumerStatus": status,
        "consumerVerified": verified,
        "consumerExitCode": exit_code,
        "publicationReasons": reasons,
        "refusal": report.get("refusal"),
        "approval": approval,
        "execution": {
            "status": execution.get("status"),
            # ALWAYS null. No artefact here says the cell ran; the mount court's
            # instantiation counter is the only instrument that speaks to it.
            "cellRan": None,
        },
        "authorityScope": {
            "mode": authority.get("mode"),
            "operatorPresence": authority.get("operatorPresence"),
        },
        "retention": {
            "status": retention.get("status"),
            "completeness": retention.get("completeness"),
            "latestness": retention.get("latestness"),
        },
        # A SIXTH QUESTION, IN ITS OWN FIELD. "The signatures agree" and "every summary in this
        # packet can be read as a summary" are different questions, and a summary whose supersedes
        # target is absent makes the reading INCOMPLETE -- which is neither a pass nor a failure, and
        # would be destroyed by collapsing it into `publication`.
        "summaries": check_summaries(export_root, published == "VERIFIED") if export_root is not None
        else {"status": SUMMARY_INCOMPLETE, "findings": [],
              "detail": "the export root was not supplied, so no summary could be read"},
        "attendance": report.get("attendance"),
        "ceilings": report.get("ceilings"),
        "approvalLane": report.get("approvalLane"),
        "stderr": stderr.strip()[-2000:] if stderr else "",
    }


def main(argv: list[str]) -> int:
    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent
    default_root = repo_root / "vendor" / "kira-export"

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--export", required=True, help="the public-evidence export directory")
    parser.add_argument("--package-root", default=str(default_root),
                        help="the directory CONTAINING the `diamond` package (default: this release's vendored copy)")
    parser.add_argument("--consumer", default=None, help="the consumer entry point (default: <package-root>/scripts/verify-kira-evidence.py)")
    parser.add_argument("--issuer-anchor", default=None, help="issuer public key; overrides the export's own copy")
    parser.add_argument("--approver-anchor", default=None, help="approval signer public key; overrides the export's own copy")
    parser.add_argument("--retained-receipt", default=None, help="a separately retained Kira receipt")
    parser.add_argument("--record", default=None, help="which record to verify, by contentSha256 or recordPath")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--json", action="store_true", help="print the full report as JSON")
    args = parser.parse_args(argv[1:])

    if args.consumer is None:
        args.consumer = str(Path(args.package_root) / "scripts" / "verify-kira-evidence.py")

    try:
        export_root = Path(args.export).expanduser().resolve()
        if not export_root.is_dir():
            raise InputRefused("EXPORT_NOT_A_DIRECTORY", f"{args.export!r} is not a directory")
        manifest_path = export_root / MANIFEST_NAME
        if not manifest_path.is_file():
            raise InputRefused("EXPORT_MANIFEST_MISSING", f"{MANIFEST_NAME} is absent from {export_root}")
        try:
            manifest = read_json_strict(manifest_path)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise InputRefused("EXPORT_MANIFEST_UNREADABLE", f"{MANIFEST_NAME} could not be read: {exc}") from exc
        if not isinstance(manifest, dict) or manifest.get("kind") != MANIFEST_KIND:
            raise InputRefused("EXPORT_MANIFEST_KIND",
                               f"expected kind {MANIFEST_KIND!r}, found {manifest.get('kind')!r}")
        if not Path(args.consumer).is_file():
            raise InputRefused("CONSUMER_MISSING", f"the consumer {args.consumer!r} is not present")

        # The consumer's own closure must be the bytes we are about to run. The pin
        # checker holds these to upstream; here we only require the entry point to
        # exist under the package root, so a caller cannot point --consumer at a
        # checkout while believing it ran the release's copy.
        consumer_real = os.path.realpath(args.consumer)
        package_real = os.path.realpath(args.package_root)
        if not consumer_real.startswith(package_real + os.sep):
            raise InputRefused("CONSUMER_OUTSIDE_PACKAGE_ROOT",
                               f"the consumer {consumer_real} is not inside the package root {package_real}")

        verify_manifest_digests(export_root, manifest)
        run_argv, mapping = build_argv(args, export_root, manifest)
    except InputRefused as refused:
        payload = {"publication": "NOT_VERIFIED", "refusedInput": {"code": refused.code, "detail": refused.detail},
                   "execution": {"status": None, "cellRan": None}}
        print(json.dumps(payload, indent=2, sort_keys=True) if args.json
              else f"REFUSED INPUT: {refused.code}\n  {refused.detail}")
        return 2

    # A subprocess is not an OS sandbox, and this bound is not a security boundary:
    # it stops a runaway child from hanging the caller or exhausting memory. THE
    # ENVIRONMENT IS CONSTRUCTED, NOT INHERITED (2026-09-27, outside review): a cold
    # consumer must not be steerable by whatever the caller's shell exported.
    cold_env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    try:
        completed = subprocess.run(
            run_argv, capture_output=True, text=True, timeout=args.timeout_seconds,
            cwd=str(export_root), check=False, env=cold_env,
        )
    except subprocess.TimeoutExpired:
        print(f"REFUSED INPUT: CONSUMER_TIMEOUT\n  the consumer exceeded {args.timeout_seconds}s; "
              "an unusable report means verification is unavailable, not successful")
        return 2
    except OSError as exc:
        print(f"REFUSED INPUT: CONSUMER_UNRUNNABLE\n  {exc}")
        return 2

    if len(completed.stdout) > MAX_REPORT_BYTES:
        print(f"REFUSED INPUT: REPORT_TOO_LARGE\n  the consumer printed {len(completed.stdout)} bytes")
        return 2

    try:
        report = parse_one_report(completed.stdout)
    except InputRefused as refused:
        print(f"REFUSED INPUT: {refused.code}\n  {refused.detail}")
        if completed.stderr.strip():
            print(f"  consumer stderr: {completed.stderr.strip().splitlines()[-1]}")
        return 2

    # *** THE REFUSAL THAT ESCAPED (A37, Fable's row 1). *** *`separate_findings` ran OUTSIDE every
    # `InputRefused` handler, so a refusal raised in here propagated out of `main` and the process exited 1*
    # -- **which a reader of a public-evidence packet sees as the verdict `NOT VERIFIED` rather than as a
    # refusal to judge.** *A verifier that cannot judge must say so by name and exit 2, exactly as the parse
    # handler twelve lines above already does; this mirrors it.*
    try:
        findings = separate_findings(report, completed.returncode, completed.stderr,
                                     export_root=export_root)
    except InputRefused as refused:
        print(f"REFUSED INPUT: {refused.code}\n  {refused.detail}")
        return 2
    findings["invocation"] = mapping
    findings["exportRoot"] = str(export_root)
    findings["manifestSha256"] = sha256_file(manifest_path)[0]
    findings["consumerSha256"] = sha256_file(Path(args.consumer))[0]
    findings["interpreter"] = sys.version.split()[0]

    if args.json:
        print(json.dumps(findings, indent=2, sort_keys=True))
    else:
        # *** WHERE THE TRUST CAME FROM BELONGS IN THE HUMAN OUTPUT, NOT ONLY IN --json (Fable, 2026-09-26). ***
        # A reader told "PUBLICATION: VERIFIED" must also be told WHICH KEY did the verifying and who supplied it:
        # an anchor carried in the export is the PRODUCER vouching for the producer, which is a different fact from a
        # caller handing over a key out of band. The two routes were already distinguished for the JSON report
        # (`mapping["issuerAnchor"] = "supplied" if args.issuer_anchor else "carried-in-export"`); this prints them.
        invocation = findings.get("invocation", {})
        for label, route in (("issuerAnchor", invocation.get("issuerAnchor")),
                             ("approverAnchor", invocation.get("approverAnchor"))):
            if route == "carried-in-export":
                print(f"ANCHOR_SUPPLIED_BY_PRODUCER: {label} came from the packet, so the producer vouched for its own bytes")
            elif route == "supplied":
                print(f"ANCHOR_SUPPLIED_BY_CALLER: {label} was supplied out of band")
        print(f"PUBLICATION: {findings['publication']}")
        print(f"  consumer status : {findings['consumerStatus']}  (exit {findings['consumerExitCode']})")
        print(f"  refusal         : {json.dumps(findings['refusal']) if findings['refusal'] else 'none'}")
        print(f"  approval        : {(findings['approval'] or {}).get('status')}")
        print(f"  cell execution  : {findings['execution']['status']}  cellRan={findings['execution']['cellRan']}")
        print(f"  authority mode  : {findings['authorityScope']['mode']}  "
              f"operatorPresence={findings['authorityScope']['operatorPresence']}")
        print(f"  retention       : {findings['retention']['status']}  "
              f"completeness={findings['retention']['completeness']}  "
              f"latestness={findings['retention']['latestness']}")
        print(f"  attendance      : {findings['attendance']}")
        for reason in findings["publicationReasons"]:
            print(f"  because         : {reason}")
        print("  ceilings:")
        for ceiling in findings["ceilings"] or []:
            print(f"    - {ceiling}")

    return 0 if findings["publication"] == "VERIFIED" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
