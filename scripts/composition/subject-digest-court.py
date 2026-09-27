#!/usr/bin/env python3
"""Keyless court: Genesis subjectDigest must match Diamond's subject hash law.

    python3 scripts/composition/subject-digest-court.py

ACCEPTANCE. Exit 0 only when Genesis `subject_digest_for` produces the same digest
as Diamond's `subject_digest` over the same fixture path. Expected printed result:
every arm ok, then `SUBJECT DIGEST COURT: GREEN`.

WHY THIS COURT EXISTS. `toy/cold_verify.py` checks that `subjectDigest` is 32 bytes
of hex. It does not recompute the preimage. Genesis previously hashed
`{"kind": "aukora-subject/v1-toy", "principal": <abspath>}` while Diamond
(`diamond/subject.py`, aukora-diamond main after #12, SHA `cac9f69`; the same blob at `b80ab8e`) hashes
`{"domain": "aukora-subject/v1-toy", "subject": <normalize_subject(path)>}`.
Same domain string and same path produced different digests (Lead measured
e1c387… vs 60b8a8…). Stranger cold_verify stayed green either way. Diamond's
loader derives `want_subject` and is where the mismatch bites.

HOW THE CROSS-CHECK WORKS, AND WHY IT IS NOT A SELF-AGREEMENT. This file copies
Diamond's exact canonical dict as a literal and hashes it with Genesis JCS. It
does not call Genesis `subject_digest_for` to build the "Diamond" side. A court
that reused the helper would stay green under `kind`/`principal` — that is the
class of error that already shipped. `mint-receipt-for-diamond.py` refuses the
same way when a sibling Diamond checkout is present; this court is the keyless
path that CI can run without that sibling.

KEY-DRIFT ARM. The Diamond literal's keys must be exactly `{domain, subject}`.
If those names move, this arm fails before any digest comparison can be
"updated" in lockstep with a wrong producer.

NEGATIVE CONTROLS. The previous `kind`/`principal` spelling must not match.
An empty path must refuse. A symlink must hash `abspath`, not `realpath`.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hexutil import sha256_hex  # noqa: E402
from jcs import canonicalize_bytes  # noqa: E402
import receipt as genesis_receipt  # noqa: E402

# Diamond law, copied as a literal. Cite: aumara-xyz/aukora-diamond
# `diamond/subject.py` at SHA `cac9f69` (main tip after #12; the same blob at `b80ab8e`). Diamond is a
# sibling and is not vendored here; the private checkout was not readable from
# this environment, so the record is the Lead-measured closed dict rather than
# an imported function. Do not replace these keys with Genesis aliases.
DIAMOND_SUBJECT_DOMAIN = "aukora-subject/v1-toy"
DIAMOND_SUBJECT_RECORD_KEYS = frozenset({"domain", "subject"})
WRONG_KEYS = frozenset({"kind", "principal"})

FAILURES = 0
ARMS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILURES, ARMS
    ARMS += 1
    if ok:
        print(f"  ok    {name}")
    else:
        FAILURES += 1
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


def diamond_subject_record(blob_path: str) -> dict:
    """Diamond's closed subject record. Keys are a literal, not Genesis's helper."""
    return {
        "domain": DIAMOND_SUBJECT_DOMAIN,
        "subject": os.path.abspath(blob_path),
    }


def diamond_subject_digest(blob_path: str) -> str:
    return sha256_hex(canonicalize_bytes(diamond_subject_record(blob_path)))


def wrong_kind_principal_digest(blob_path: str) -> str:
    return sha256_hex(
        canonicalize_bytes(
            {
                "kind": DIAMOND_SUBJECT_DOMAIN,
                "principal": os.path.abspath(blob_path),
            }
        )
    )


def main() -> int:
    print("\nsubject digest court — Genesis must match Diamond domain+subject\n")

    work = Path(tempfile.mkdtemp(prefix="genesis-subject-digest-court-"))
    try:
        fixture = work / "state" / "plugin.blob"
        fixture.parent.mkdir(parents=True)
        fixture.write_bytes(b"genesis-subject-digest-court-fixture\n")
        fixture_path = str(fixture)

        diamond_record = diamond_subject_record(fixture_path)
        check(
            "Diamond literal keys are exactly {domain, subject}",
            set(diamond_record) == DIAMOND_SUBJECT_RECORD_KEYS,
            f"got {sorted(diamond_record)}",
        )
        check(
            "Diamond literal keys are not the drifted {kind, principal} set",
            set(diamond_record) != WRONG_KEYS and WRONG_KEYS.isdisjoint(diamond_record),
            f"got {sorted(diamond_record)}",
        )

        theirs = diamond_subject_digest(fixture_path)
        ours = genesis_receipt.subject_digest_for(fixture_path)
        check(
            "Genesis subject_digest_for == Diamond subject_digest on the fixture path",
            ours == theirs,
            f"genesis {ours} diamond {theirs} over {os.path.abspath(fixture_path)}",
        )

        genesis_record = genesis_receipt.subject_record_for(fixture_path)
        check(
            "Genesis subject_record_for keys are Diamond's {domain, subject}",
            set(genesis_record) == DIAMOND_SUBJECT_RECORD_KEYS,
            f"got {sorted(genesis_record)}",
        )
        check(
            "Genesis subject_record_for equals the Diamond literal over the same path",
            genesis_record == diamond_record,
            f"genesis {genesis_record} diamond {diamond_record}",
        )
        check(
            "Genesis digest is the hash of its own subject_record_for (no second spelling)",
            ours == sha256_hex(canonicalize_bytes(genesis_record)),
            "subject_digest_for hashed a different record than subject_record_for returned",
        )

        drifted = wrong_kind_principal_digest(fixture_path)
        check(
            "kind+principal over the same path is a different digest (the measured miss)",
            drifted != theirs,
            f"kind/principal collided with Diamond: {drifted}",
        )
        check(
            "Genesis digest is not the drifted kind+principal spelling",
            ours != drifted,
            f"genesis still hashes kind/principal: {ours}",
        )

        check(
            "domain string is Diamond's aukora-subject/v1-toy (not v1-pin)",
            diamond_record["domain"] == "aukora-subject/v1-toy"
            and genesis_receipt.SUBJECT_DOMAIN == "aukora-subject/v1-toy",
            f"diamond {diamond_record['domain']!r} genesis {genesis_receipt.SUBJECT_DOMAIN!r}",
        )

        refused_empty = False
        try:
            genesis_receipt.subject_digest_for("")
        except ValueError:
            refused_empty = True
        except Exception:  # noqa: BLE001
            refused_empty = False
        check("empty blob path is refused", refused_empty, "empty path was accepted")

        real_state = work / "real-state"
        link_state = work / "link-state"
        real_state.mkdir()
        os.symlink(os.path.abspath(real_state), link_state)
        linked_blob = os.path.join(str(link_state), "plugin.blob")
        Path(os.path.join(str(real_state), "plugin.blob")).write_bytes(b"linked\n")
        linked_ours = genesis_receipt.subject_digest_for(linked_blob)
        linked_abspath = diamond_subject_digest(linked_blob)
        linked_realpath = sha256_hex(
            canonicalize_bytes(
                {
                    "domain": DIAMOND_SUBJECT_DOMAIN,
                    "subject": os.path.realpath(linked_blob),
                }
            )
        )
        check(
            "symlink path hashes abspath, matching Diamond, not realpath",
            linked_ours == linked_abspath
            and (
                os.path.realpath(linked_blob) == os.path.abspath(linked_blob)
                or linked_ours != linked_realpath
            ),
            f"ours {linked_ours} abspath {linked_abspath} realpath {linked_realpath}",
        )

        # Source-level key court: the producer bytes themselves must still name
        # Diamond's keys. A helper that returns the right dict while digesting
        # kind/principal would pass the equality arms above if both sides were
        # later "fixed" together; this reads the hashed dict construction.
        producer = (HERE / "receipt.py").read_text(encoding="utf-8")
        hashed_wrong = (
            '{"kind": SUBJECT_KIND, "principal":' in producer
            or '{"kind": SUBJECT_DOMAIN, "principal":' in producer
            or '"principal": principal' in producer
        )
        hashed_right = (
            '"domain": SUBJECT_DOMAIN' in producer and '"subject":' in producer
        )
        check(
            "receipt.py subject record still spells Diamond domain+subject, not kind+principal",
            hashed_right and not hashed_wrong,
            "producer bytes drifted off Diamond's keys",
        )

        print()
        if FAILURES:
            print(f"  {FAILURES} of {ARMS} arms FAILED\n")
            print("  SUBJECT DIGEST COURT: RED")
            return 1
        print(f"  {ARMS}/{ARMS} arms: Genesis subjectDigest equals the pinned Diamond subject-law literal (domain+subject; no Diamond bytes read)\n")
        print("  SUBJECT DIGEST COURT: GREEN")
        return 0
    finally:
        # The fixture is disposable; a leftover directory is not evidence.
        import shutil

        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
