#!/usr/bin/env python3
"""Concurrent-reader and malformed-input controls for the composition spent-nonce store.

    python3 scripts/composition/spent-store-race-test.py

WHY THIS EXISTS. `NonceStore.consume` records a spent nonce by writing the whole
`spent-nonces.json` document through `hexutil.write_json`. That function opened the path with
`open(path, "w")`, which truncates and then writes: between those two steps the file on disk is
an empty or partial document. A concurrent reader that lands in that window fails to parse a
store that is perfectly valid on either side of the write.

This is the SAME defect that failed the required check in the JavaScript gate
(`plugins/aukora-composition-gate/src/policy.js`, `reserveNonce`): there, a losing racer was
refused GRANT_MALFORMED instead of GRANT_SPENT in 5 of 150 raced rounds, because the winner's
`writeFileSync(path, ...)` had truncated the store mid-read. The JavaScript writer now replaces
the store with a temporary file and a rename. The Python writer of the same file did not, which
is the follow-up this test was written for.

WHAT THE ARMS ASSERT, and why each one is needed:

  concurrent readers  A reader must never observe a store it cannot parse. Spinning reader
                      PROCESSES run for the whole duration of repeated writes, so the overlap
                      is observed rather than waited for. Every read either parses or does not.
  exclusion preserved The store is a record of what was admitted, not the exclusion. A second
                      `consume` of the same nonce must still be refused as GRANT_SPENT, and the
                      refusal must not become a generic error.
  malformed input     A store that is genuinely not admissible must still be refused by name.
                      This pins the direction of the repair: making the READER tolerant -
                      treating an unreadable store as empty or as spent - would satisfy the
                      reader arm while hiding a store nobody can trust.
  no tolerant reader  The malformed branch must still raise. Checked directly, because the
                      cheapest way to pass the reader arm is to swallow the parse error.

Nothing here provisions a key, binds an identity, or claims succession. The store is a
disposable temporary directory. The exclusion mechanism itself is not reimplemented: this file
measures the store's write, and the Python side has never carried the exclusion.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
# Defaults to this checkout. The override lets the SAME controls be pointed at a candidate tree
# so a repair and a would-be repair can be measured against each other; required CI leaves it
# unset, so the shipped module is what runs there.
COMPOSITION = Path(os.environ.get("AUKORA_COMPOSITION_ROOT", str(ROOT / "scripts" / "composition")))
sys.path.insert(0, str(COMPOSITION))

from hexutil import read_json as _read_json  # noqa: E402
from hexutil import write_json as _write_json  # noqa: E402
from grant import NonceStore  # noqa: E402
from refusals import GRANT_SPENT  # noqa: E402

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


READER = r'''
import json, sys, time
from pathlib import Path
store = Path(sys.argv[1]); out = Path(sys.argv[2]); flag = Path(sys.argv[3])
reads = bad = 0
while flag.exists():
    try:
        raw = store.read_text(encoding="utf-8")
    except FileNotFoundError:
        continue          # the rename window: the old name is momentarily absent
    reads += 1
    try:
        json.loads(raw)
    except ValueError:
        bad += 1
out.write_text(f"{reads} {bad}", encoding="utf-8")
'''


def main() -> int:
    print("\ncomposition spent-nonce store — concurrent readers and malformed input\n")
    work = Path(tempfile.mkdtemp(prefix="spent-store-race-"))
    try:
        # ── 1. concurrent readers while the store is written repeatedly ────────────────────
        store = work / "spent-nonces.json"
        _write_json(str(store), {"spent": []})

        reader_src = work / "reader.py"
        reader_src.write_text(READER, encoding="utf-8")
        flag = work / "go"
        flag.write_text("spin", encoding="utf-8")

        readers = []
        outs = []
        for i in range(4):
            out = work / f"out-{i}"
            outs.append(out)
            readers.append(subprocess.Popen(
                [sys.executable, str(reader_src), str(store), str(out), str(flag)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            ))
        time.sleep(0.15)   # readers established before the first write

        writes = 0
        for i in range(40):
            store_obj = NonceStore(str(store))
            store_obj.consume(f"{i:064x}")
            writes += 1

        flag.unlink()      # only now may the spinners stop
        for p in readers:
            p.wait(timeout=30)

        total_reads = 0
        unparseable = 0
        for out in outs:
            if out.exists():
                r, b = out.read_text(encoding="utf-8").split()
                total_reads += int(r)
                unparseable += int(b)

        check(
            f"no reader observes an unparseable store across {writes} writes "
            f"({total_reads} reads)",
            total_reads > 0 and unparseable == 0,
            "the spinners observed no reads at all, so this measured nothing"
            if total_reads == 0 else f"{unparseable} unparseable read(s) of {total_reads}",
        )

        stored = json.loads(store.read_text(encoding="utf-8"))
        check("the store records every consumed nonce",
              isinstance(stored.get("spent"), list) and len(stored["spent"]) == writes,
              f"spent entries: {len(stored.get('spent', []))} of {writes}")

        # ── 2. the exclusion behaviour is unchanged ────────────────────────────────────────
        again = NonceStore(str(store))
        first = f"{writes:064x}"
        again.consume(first)
        try:
            again.consume(first)
            check("a second consume of one nonce is refused", False, "it was accepted twice")
        except Exception as exc:                                  # noqa: BLE001 - named refusal
            code = getattr(exc, "code", None)
            check("a second consume of one nonce is refused as GRANT_SPENT",
                  code == GRANT_SPENT, f"code={code} message={exc}")

        # ── 3. malformed input is still refused, by name ────────────────────────────────────
        broken = work / "broken.json"
        broken.write_text('{"spent": ["abab', encoding="utf-8")   # a truncated document
        try:
            NonceStore(str(broken))
            check("an inadmissible store is refused", False, "it was accepted")
        except Exception as exc:                                  # noqa: BLE001
            text = str(exc)
            check("an inadmissible store is refused by name, not silently emptied",
                  "malformed" in text.lower() or "json" in text.lower(),
                  f"message={text[:120]}")

        # ── 4. the writer must not be repaired by making the reader tolerant ───────────────
        # A partial document is a real state a mid-write reader observed, so it must stay an
        # error. If a future change makes `read_json` return {} for unparseable bytes, this
        # fails — which is the point: the fix belongs in the write, not in the read.
        try:
            _read_json(str(broken))
            check("read_json still rejects an inadmissible document", False,
                  "it returned a value for a truncated store")
        except Exception:                                         # noqa: BLE001
            check("read_json still rejects an inadmissible document", True)

        print()
        if FAILURES:
            print(f"  {FAILURES} of {ARMS} arms FAILED\n")
            print("  SPENT STORE RACE: RED")
            return 1
        print(f"  {ARMS}/{ARMS} arms: the spent store is replaced atomically and still refuses\n")
        print("  SPENT STORE RACE: GREEN")
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
