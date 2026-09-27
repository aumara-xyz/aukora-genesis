#!/usr/bin/env python3
"""Nostr message evidence — the READER for ONE closed evidence record.

THE RECORD. A NIP-17 message produces this six-field document and nothing else:

    {
      "domain":        "aukora:nostr-message-evidence:v1",
      "kind":          "nostr-message-evidence",
      "version":       1,
      "eventId":       "<64 lowercase hex>",
      "contentDigest": "<64 lowercase hex>",
      "observedAt":    "<canonical seconds-precision UTC instant with a Z suffix>"
    }

DESIGN: A DIGEST, NEVER CONTENT. The record names an event and commits to content by digest.
It carries no plaintext, no ciphertext and no key material, and this reader refuses any document
that carries content under ANY key that implies it — see CONTENT_BEARING_KEYS. The refusal is
deliberate rather than a shrug: a reader that IGNORES a content key is one refactor away from a
reader that prints one, and an evidence reader that can read private messages is a surveillance
surface wearing a court's clothes. The record carries a digest only; this file must never become
a reader of private messages.

THE CLOSED-TYPE RULE, and why the unknown-field refusal is load-bearing. The field set above is
closed: exactly those names, no others, and a document carrying a field outside the set is
refused BY NAME THAT NAMES THE FIELD. An open field set is how a later lane smuggles authority
in: add `"grantsAuthority": true` or `"approval": {...}` to a document that already reads as
evidence, and every consumer that tolerated the extra key is now reading a record whose meaning
it never agreed to. On this record the refusal IS the interface, so it is checked before every
other field-level rule.

AUTHORITY: NONE, ON EVERY PATH. This record authorises nothing. It is not a receipt, not an
approval, not a settlement and not a grant, and reading it confers no permission. A signature
over these bytes would prove only that a key signed them. See `ceilings()`.

READ-ONLY BY CONSTRUCTION. This module declares an interface and validates a document against
it. It contains no code path that writes a file, creates a directory, generates a key, mints a
receipt, appends to a ledger or grants authority; the single filesystem call in it opens the
named document for reading. `tests/aura-nostr-evidence.test.mjs` MEASURES that instead of taking
this paragraph's word for it: it inventories a disposable state root before and after a read,
requires the two inventories byte-identical, and carries a negative control proving the
inventory would have noticed a write. That measurement is not ceremony — this repository has
already shipped a reader that generated a keypair on first use (`Loader.__init__` and
`createKiraMemoryOwner` both write), so "a reader writes nothing" is a claim that has been false
here before.

THE PRODUCER IS ANOTHER LANE'S (Beta's). The Nostr send/receive path writes the record; this
file fixes the reader's side of the interface and nothing else. `interface()` returns the
declared shape so that lane can read it from code rather than from this prose.

EXIT CODES. 0 the document reads; 2 a named refusal, which means the question could not be
answered as asked; 1 unrunnable — the path cannot be read, or the bytes are not JSON at all.
Those last two are kept apart deliberately: JSON that is not an object is a NAMED refusal,
because the document arrived and was judged; a file that is not JSON never got that far.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import json
import re
import sys
import time
from typing import NoReturn

EXIT_READ = 0
EXIT_UNRUNNABLE = 1
EXIT_REFUSED = 2

#: The domain separator. A restatement is a claim about a producer elsewhere, so it is one
#: literal, declared once, and every comparison is against this name rather than a second copy.
DOMAIN = "aukora:nostr-message-evidence:v1"
KIND = "nostr-message-evidence"
VERSION = 1

#: The CLOSED field set, in the order a producer would read it. Six names, and the reader
#: compares against exactly this tuple: a field that is not here is refused by name.
FIELDS = ("domain", "kind", "version", "eventId", "contentDigest", "observedAt")

#: Digests are compared as bytes, so exactly 64 LOWERCASE hex characters. `re.fullmatch` with
#: an unanchored-looking pattern is deliberate: fullmatch anchors both ends without a second
#: `^…$` that a future edit could drop half of.
HEX64 = re.compile(r"[0-9a-f]{64}")

#: Canonical seconds-precision UTC with a `Z` suffix. The pattern and the format string are two
#: checks, not one: the pattern alone accepts `2026-13-45T99:99:99Z`, which no clock can produce,
#: and `strptime` alone accepts a trailing newline. Form AND instant, both refused under the
#: same name when either fails.
OBSERVED_AT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
OBSERVED_AT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

#: Keys that IMPLY message content. The closed field set already refuses every one of them, so
#: this tuple adds no power — it changes only WHICH refusal a content-bearing document gets, and
#: why. Two reasons it is spelled out rather than inferred: (1) a producer that points this
#: reader at a raw NIP-17 rumor should be told "this carries content", not "missing domain";
#: (2) a future editor who widens FIELDS must delete a line here first, in daylight, rather than
#: silently turning an unknown key into a readable one. Matching is case-folded, because an
#: uppercase `Content` is already refused as an unknown field and the reason should still be the
#: privacy one rather than the spelling one.
CONTENT_BEARING_KEYS = (
    "content", "plaintext", "cleartext", "ciphertext", "body", "text", "message",
    "rumor", "seal", "giftwrap", "nip44", "nip59",
)

#: The closed refusal vocabulary. Printed by `refusals()` and asserted in the court, so a new
#: refusal added anywhere in this file without being declared here is a court failure rather
#: than an undocumented name a caller has to guess.
REFUSALS = (
    "nostr-evidence-not-an-object",
    "nostr-evidence-carries-content",
    "nostr-evidence-unknown-field",
    "nostr-evidence-missing-field",
    "nostr-evidence-domain-mismatch",
    "nostr-evidence-kind-mismatch",
    "nostr-evidence-version-unsupported",
    "nostr-evidence-field-malformed",
    # The wire binding. The digest alone does not bind a record to its wire: a record re-pointed at
    # another message's wire keeps every field individually valid while the PAIRING is false, so a
    # reader that only re-hashes bytes reports it exactly as it reports an intact one.
    "nostr-evidence-wire-unbound",
    "nostr-evidence-wire-not-present",
    "nostr-evidence-wire-uncheckable",
    "nostr-evidence-wire-mode-required",
)


class NostrEvidenceRefusal(Exception):
    """A document this reader will not read. Never a verdict, always a named reason."""

    def __init__(self, code: str, reason: str):
        super().__init__(f"{code}: {reason}")
        self.code = code
        self.reason = reason


def refuse(code: str, reason: str) -> NoReturn:
    """The one way this module says no. A bare False would be a boolean nobody can act on."""
    raise NostrEvidenceRefusal(code, reason)


def check_digest(name: str, value: object, where: str) -> str:
    """One digest field: exactly 64 lowercase hex characters.

    Uppercase is refused with its own sentence rather than folded to lowercase. Folding is the
    tempting kindness and it is wrong here: the record's identity is the bytes, so `AB…` and
    `ab…` would become two documents naming one event, and a consumer comparing the string it
    was given against a derived digest would disagree with the reader about what was read.
    """
    if isinstance(value, str) and HEX64.fullmatch(value):
        return value
    if isinstance(value, str) and value != value.lower() and HEX64.fullmatch(value.lower()):
        refuse(
            "nostr-evidence-field-malformed",
            f"{where}{name} is uppercase hex ({value!r}); uppercase is refused, never folded — "
            f"a digest is compared as bytes, so {value.lower()!r} is not the string this record "
            "carries, and reading it as one would invent a document nobody wrote",
        )
    refuse(
        "nostr-evidence-field-malformed",
        f"{where}{name} is {value!r} ({type(value).__name__}); the record carries exactly 64 "
        "lowercase hex characters",
    )


def check_observed_at(value: object, where: str) -> str:
    """One canonical instant: seconds precision, `Z` suffix, and a real date on a real clock."""
    if not isinstance(value, str) or not OBSERVED_AT.fullmatch(value):
        refuse(
            "nostr-evidence-field-malformed",
            f"{where}observedAt is {value!r}; the canonical form is a seconds-precision UTC "
            "instant with a Z suffix, e.g. 2026-09-08T00:00:00Z (no fractional seconds, no "
            "offset, no space)",
        )
    try:
        time.strptime(value, OBSERVED_AT_FORMAT)
    except ValueError as exc:
        # Form-correct is not the same as producible: `2026-13-45T99:99:99Z` matches the pattern
        # and is not an instant. Refused under the same name, with the calendar's own words.
        refuse(
            "nostr-evidence-field-malformed",
            f"{where}observedAt is {value!r}, which has the canonical form but is not an "
            f"instant: {exc}",
        )
    return value


def read_evidence(document: object, source: str | None = None) -> dict:
    """Validate ONE closed evidence record, and return a minimal owned summary.

    `source` is a label for refusal reasons only (a path, usually). It never reaches the
    summary: a summary that echoes where it was read from invites a caller to treat the path as
    provenance, and this record carries no provenance.

    The order of the checks is chosen, not inherited:

      1. object            a list or a string is not a document that was judged; it is refused
      2. content keys      FIRST among the field rules, because a document that carries content
                           must never be summarised, not even far enough to say its domain is
                           wrong. Pointing this reader at a raw rumor says "carries content",
                           which is the true and useful answer
      3. unknown fields    the closed-type rule, before every other field rule
      4. missing fields
      5. domain, kind, version
      6. the two digests, then observedAt

    The returned dict holds only validated leaves and no reference to the input document, so a
    caller cannot mutate the reader's view by mutating what it handed in.
    """
    where = f"{source}: " if source else ""

    if not isinstance(document, dict):
        refuse(
            "nostr-evidence-not-an-object",
            f"{where}the document is {type(document).__name__}, not one JSON object",
        )

    folded = {str(key).lower(): key for key in document}
    carried = sorted(key for key in CONTENT_BEARING_KEYS if key in folded)
    if carried:
        names = ", ".join(repr(folded[key]) for key in carried)
        refuse(
            "nostr-evidence-carries-content",
            f"{where}the document carries message content under {names}. This record carries a "
            "DIGEST only, and this reader will not read private messages: a key that implies "
            "content is refused rather than ignored, because ignoring it leaves the content in "
            "the document for the next reader to find",
        )

    unknown = sorted((key for key in document if key not in FIELDS), key=repr)
    if unknown:
        names = ", ".join(repr(key) for key in unknown)
        refuse(
            "nostr-evidence-unknown-field",
            f"{where}the record carries field(s) outside the closed set: {names}. The closed "
            f"set is {', '.join(FIELDS)}, and an extra field is how authority is smuggled into "
            "a document that otherwise reads as evidence",
        )

    missing = [name for name in FIELDS if name not in document]
    if missing:
        refuse(
            "nostr-evidence-missing-field",
            f"{where}the record is missing field(s): {', '.join(repr(name) for name in missing)}",
        )

    if document["domain"] != DOMAIN:
        refuse(
            "nostr-evidence-domain-mismatch",
            f"{where}domain is {document['domain']!r}, and this reader reads {DOMAIN!r}",
        )
    if document["kind"] != KIND:
        refuse(
            "nostr-evidence-kind-mismatch",
            f"{where}kind is {document['kind']!r}, and this reader reads {KIND!r}",
        )

    version = document["version"]
    # `isinstance(True, int)` is True in Python, so `{"version": true}` would pass an
    # isinstance-only check and be read as version 1. The bool branch is not defensive padding:
    # it is the difference between reading the integer 1 and reading a document that said yes.
    if isinstance(version, bool) or not isinstance(version, int) or version != VERSION:
        refuse(
            "nostr-evidence-version-unsupported",
            f"{where}version is {version!r} ({type(version).__name__}); this reader reads exactly "
            f"the integer {VERSION} and coerces nothing — '1', 1.0 and true are three other "
            "documents, and guessing which one a producer meant is how a reader comes to accept "
            "a version no producer emitted",
        )

    event_id = check_digest("eventId", document["eventId"], where)
    content_digest = check_digest("contentDigest", document["contentDigest"], where)
    observed_at = check_observed_at(document["observedAt"], where)

    return {
        "domain": DOMAIN,
        "kind": KIND,
        "version": VERSION,
        "eventId": event_id,
        "contentDigest": content_digest,
        "observedAt": observed_at,
        # A statement about THIS READER, not about the message. Every key that could carry
        # content was refused above, so no content reached this summary; the message itself is
        # as unreadable to this reader as it was before the call.
        "carriesContent": False,
    }


def interface() -> dict:
    """The declared shape, for the producer lane to read from code rather than from prose."""
    return {
        "domain": DOMAIN,
        "kind": KIND,
        "version": VERSION,
        "fields": list(FIELDS),
        "closed": True,
        "hex64": ["eventId", "contentDigest"],
        "observedAt": "canonical seconds-precision UTC instant with a Z suffix",
        "refusals": list(REFUSALS),
        # The standing limits travel WITH the interface, because a producer lane reading what
        # this reader accepts must read what it will not claim in the same breath. One spawn
        # then gives a caller the shape and the limits as data instead of as prose to parse.
        "ceilings": ceilings(),
    }


def ceilings() -> list[str]:
    """The standing limits. ONE COMPLETE STATEMENT PER ELEMENT, unwrapped.

    The wrapping is the presentation's job (`print_ceilings`), not the data's: a list of
    hard-wrapped fragments cannot be asserted on without reassembling sentences, and a limit
    that can only be checked by a human reading a terminal is a limit that quietly rots.
    """
    return [
        "Evidence, not authority: this record authorises NOTHING. It is not a receipt, not an "
        "approval, not a settlement and not a grant, and reading it confers no permission.",
        "A signature over these bytes would prove only that a key signed them. It would not "
        "prove that a message was sent, received or read, nor who the sender is, nor that the "
        "signer is that person: a key signs, and a name is a claim attached to it elsewhere.",
        "The digest commits to content this reader NEVER SEES. The record says some content has "
        "one digest and says nothing else about it; if that digest is over the PLAINTEXT it is "
        "also a confirmation oracle for anyone who can guess the message, so the producer's "
        "choice of preimage is a privacy decision rather than a format detail.",
        "Reading this evidence writes nothing: no file, no key, no receipt, no ledger entry, no "
        "authority. The court measures that over a disposable state root rather than trusting "
        "this sentence.",
        "This reader reads ONE document. It reads no relay, contacts no network, and cannot say "
        "whether the event it names exists on any relay at all, let alone whether it is the only "
        "record of that event.",
        "Freshness is not established: observedAt is when THIS record was written down, not when "
        "the message was sent. A replayed record keeps its old instant and reads the same.",
        "No person attended: nothing here shows a human wrote, approved or received anything, "
        "and this reader's own read is not a claim by anyone about the message.",
    ]


def refusals() -> list[str]:
    return list(REFUSALS)


def print_ceilings() -> None:
    print()
    for line in ceilings():
        print(f"  {line}")


def check_wire_binding(state_dir: str, document_path: str, where: str) -> None:
    """Bind the record to the wire it names, or refuse BY NAME. Never a digest-only fallback.

    The comparison is not reimplemented here. `readRecordWire`/`recordWireStatus` live in
    `plugins/aukora-nostr/lib/evidence.mjs` and recompute the wire's OWN event id from its bytes,
    requiring it to equal `record.eventId`; a second implementation in Python would be two
    implementations of one rule, which drift. So this calls the lane's own CLI across.

    IF node OR THE CLI IS MISSING THIS REFUSES. It does not degrade to the digest question, because
    that is the question which answers `present` for a re-pointed record — falling back would turn a
    missing tool into a clean read, which is the defect this function exists to prevent.
    """
    cli = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wire-binding.mjs")
    if not os.path.exists(cli):
        raise NostrEvidenceRefusal(
            "nostr-evidence-wire-uncheckable",
            f"the wire-binding CLI is absent at {cli}, so {where} cannot be bound to its wire; a "
            "digest-only answer is not a binding and is not offered as one",
        )
    node = shutil.which("node")
    if node is None:
        raise NostrEvidenceRefusal(
            "nostr-evidence-wire-uncheckable",
            f"node is not on PATH, so {where} cannot be bound to its wire; a digest-only answer is "
            "not a binding and is not offered as one",
        )
    proc = subprocess.run(
        [node, cli, "--state", state_dir, "--record", document_path],
        capture_output=True, text=True,
    )
    out = (proc.stdout or "").strip().splitlines()
    payload = None
    if out:
        try:
            payload = json.loads(out[-1])
        except ValueError:
            payload = None
    if proc.returncode != 0 or payload is None:
        detail = (proc.stdout or proc.stderr or "").strip()[:200]
        raise NostrEvidenceRefusal(
            "nostr-evidence-wire-uncheckable",
            f"the binding check produced no status for {where} (exit {proc.returncode}): {detail}",
        )
    status = payload.get("status")
    if status == "present":
        return
    if status == "unbound":
        raise NostrEvidenceRefusal(
            "nostr-evidence-wire-unbound",
            payload.get("reason")
            or f"{where} names a wire whose bytes re-derive to a different message's event id",
        )
    raise NostrEvidenceRefusal(
        "nostr-evidence-wire-not-present",
        f"{where} names a wire that is {status}: "
        f"{payload.get('reason') or payload.get('refusal') or 'no detail'}",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="nostr_evidence.py",
        description=(
            "Read ONE closed Nostr message evidence record. Read-only: nothing is written, no "
            "key is generated, no receipt is minted and no authority is granted."
        ),
    )
    parser.add_argument("document", nargs="?", help="path to the evidence record (JSON)")
    parser.add_argument("--state", help="the store holding the wire; binds the record to it")
    parser.add_argument("--no-wire", action="store_true",
                        help="read WITHOUT binding, and say so: prints the WIRE_NOT_CHECKED ceiling")
    parser.add_argument("--ceilings", action="store_true", help="print the standing limits")
    parser.add_argument("--interface", action="store_true", help="print the declared shape")
    args = parser.parse_args(argv)

    if args.ceilings:
        print_ceilings()
    if args.interface:
        print(json.dumps(interface(), indent=2, sort_keys=True))
    if args.ceilings or args.interface:
        return EXIT_READ
    if not args.document:
        print(
            "UNRUNNABLE: no document path given. Pass a path, or --interface / --ceilings.",
            file=sys.stderr,
        )
        return EXIT_UNRUNNABLE

    try:
        with open(args.document, "rb") as handle:
            raw = handle.read()
    except OSError as exc:
        print(f"UNRUNNABLE: {args.document} cannot be read: {exc}", file=sys.stderr)
        return EXIT_UNRUNNABLE
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        # Bytes that are not JSON never reached the judgment, so this is not one of the named
        # refusals: refusing `nostr-evidence-not-an-object` here would claim a document was
        # judged when nothing was parsed to judge.
        print(f"UNRUNNABLE: {args.document} is not UTF-8 JSON: {exc}", file=sys.stderr)
        return EXIT_UNRUNNABLE

    try:
        summary = read_evidence(document, source=args.document)
    except NostrEvidenceRefusal as exc:
        print(f"REFUSE: {exc.code}: {exc.reason}", file=sys.stderr)
        return EXIT_REFUSED
    if args.state:
        try:
            check_wire_binding(args.state, args.document, args.document)
        except NostrEvidenceRefusal as exc:
            print(f"REFUSE: {exc.code}: {exc.reason}", file=sys.stderr)
            return EXIT_REFUSED
    # THE MODE IS NOT OPTIONAL. An opt-in binding is the optional-argument fail-open: leave
    # the argument off and the reader answers the digest question, which is `present` for a
    # record re-pointed at another message's wire. So a read must SAY which mode it is in, and
    # the unbound mode carries its ceiling IN the read rather than in a separate call — a caller
    # who reads only stdout must still be able to tell a digest-only read from a bound one.
    if args.state and args.no_wire:
        print("REFUSE: nostr-evidence-wire-mode-required: --state and --no-wire are mutually exclusive; a read is either bound or it says the wire went unchecked", file=sys.stderr)
        return EXIT_REFUSED
    if not args.state and not args.no_wire:
        print(
            "REFUSE: nostr-evidence-wire-mode-required: pass --state to bind this record to its "
            "wire, or --no-wire to read it as digest-only and carry the WIRE_NOT_CHECKED ceiling",
            file=sys.stderr,
        )
        return EXIT_REFUSED
    summary["wireBinding"] = "BOUND" if args.state else "WIRE_NOT_CHECKED"
    print(json.dumps(summary, sort_keys=True))
    return EXIT_READ


if __name__ == "__main__":
    raise SystemExit(main())
