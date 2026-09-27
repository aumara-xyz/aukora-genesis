#!/usr/bin/env python3
"""Derive the Experience Court fixtures from that court's own code, executably.

    python3 tests/pinned-contract/make-experience-fixtures.py --court <path to a checkout>

WHY THIS EXISTS. The compatibility matrix gained rows for the kind the Experience Court sealed
(`aukora-experience/v1`), and those rows compare BYTES. Committing the bytes without a way to
regenerate them would make the row a claim about a document nobody can reproduce; so this
script mints the same two documents from that court's own producer and writes them here.

WHAT IS VENDORED AND WHAT IS DERIVED. The documents are produced by the Experience Court's
`ExperienceStore` at the commit named below — not hand-written here. What is derived here is
only the serialization: their records live in memory, so this writes them out as JSON with
sorted keys. The digests of those bytes are recorded in `pins.json`, and the matrix runner
re-verifies them before comparing, refusing with PIN DRIFT if a byte moves.

The two documents are the two shapes the sealed kind takes: a stored record (`ExperienceStore.put`)
and a recall reply (`ExperienceStore.recall`). Both are advisory and unsigned — `grantsAuthority`
is false and there is no signature anywhere in them — which is the whole point of that court.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"

#: The Experience Court commit these bytes were derived from. Recorded in pins.json too; if the
#: court moves, the fixtures do not follow silently — this script refuses a different checkout.
COURT_REPO = "github.com/aumara-xyz/aukora-experience-court"
COURT_COMMIT = "0e970d9cdf40dd3e3d651c37c52af2a3007ac480"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--court", required=True, help="path to an aukora-experience-court checkout")
    args = parser.parse_args()
    court = Path(args.court).resolve()

    # Full SHA, not a short one: `--short` picks the shortest unambiguous prefix, which varies
    # with how many objects a repository holds. A short SHA is a display convenience, and using
    # one as a pin means the pin can stop matching without any byte having moved.
    head = subprocess.run(["git", "-C", str(court), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()
    if head != COURT_COMMIT:
        print(f"REFUSE: checkout is at {head}, this script is pinned to {COURT_COMMIT}",
              file=sys.stderr)
        return 2

    sys.path.insert(0, str(court))
    from court.experience import ExperienceStore  # noqa: E402

    # The producer, not a transcription: their store builds both documents.
    store = ExperienceStore()
    record = store.put("baseline: the pump ran warm on Tuesday", b"log line 41\n")
    reply = store.recall("pump")

    written = []
    for name, document in (("experience-record.json", record), ("experience-recall.json", reply)):
        path = FIXTURES / name
        path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        written.append((name, digest, document["kind"]))
        print(f"wrote {path.relative_to(HERE.parent.parent)}  kind={document['kind']}  "
              f"sha256={digest[:16]}…")

    print(f"\n  derived from {COURT_REPO} at {COURT_COMMIT} by its own ExperienceStore")
    print("  both documents are advisory and unsigned: grantsAuthority is false and there is")
    print("  no signature field, so no verifier of authority can reach a signature on them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
