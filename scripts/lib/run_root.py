"""run_root.py — the Python half of the disk guard, and NOTHING else.

THE POLICY LIVES IN ONE PLACE: `scripts/lib/run-root.mjs`. This file is a thin wrapper for Python callers, and it
deliberately implements no policy of its own — a second implementation of "how big is too big" is a second thing to
disagree with the first, which is exactly what §3 of the disk audit forbids.

    from run_root import open_scratch, reap, check

    with open_scratch(owner="my-lane", label="my-scratch", max_bytes=64 << 20) as root:
        ...                      # everything you write goes under root

A refusal raises `DiskGuardRefused`, whose `reason` is the guard's name for it (`scratch-cap`, `free-floor`, …) and
whose `returncode` is 2 — the number the front door counts as not green.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE = HERE / "run-root.mjs"
REFUSAL_EXIT = 2


class DiskGuardRefused(RuntimeError):
    """The guard refused BY NAME. `reason` is the guard's name; `message` is the sentence a person reads."""

    def __init__(self, message: str, returncode: int = REFUSAL_EXIT, reason: str = "refused") -> None:
        super().__init__(message)
        self.returncode = returncode
        self.reason = reason


def _run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    node = os.environ.get("AUKORA_NODE", "node")
    result = subprocess.run(
        [node, str(MODULE), *args],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if check and result.returncode != 0:
        first = (result.stderr or result.stdout or "").strip().splitlines()
        message = first[0] if first else f"the guard exited {result.returncode}"
        reason = message.split("REFUSED ", 1)[1].split(":", 1)[0] if "REFUSED " in message else "failed"
        raise DiskGuardRefused(message, returncode=result.returncode, reason=reason)
    return result


@contextmanager
def open_scratch(owner: str, label: str = "scratch", max_bytes: int = 0):
    """Open one scratch root, yield it, and remove it on the way out — including on an exception.

    The Node guard already cleans on exit, INT, TERM, HUP and uncaughtException. This context manager is the Python
    side of the same promise: a `with` block that raises still leaves no directory behind.
    """
    root = Path(_run("open", "--owner", owner, "--label", label, "--max-bytes", str(max_bytes)).stdout.strip())
    try:
        yield root
    finally:
        # A SCRATCH ROOT OUTLIVES NOTHING. Removal is the Node side's business, so this asks it to reap and never
        # deletes a path itself — one implementation of "what may be removed" is the whole point.
        reap()


def reap(base: str | None = None) -> dict:
    """Reap dead, reused-pid and stale unmarked roots in the guard's base."""
    args = ["reap"] + (["--base", base] if base else [])
    return json.loads(_run(*args).stdout or "{}")


def check(need_bytes: int = 0, owner: str = "check", label: str = "a check", base: str | None = None) -> dict:
    """Ask the budget without creating anything. Raises `DiskGuardRefused` when it would refuse."""
    args = ["check", "--need-bytes", str(need_bytes), "--owner", owner, "--label", label] + (["--base", base] if base else [])
    return json.loads(_run(*args).stdout or "{}")


if __name__ == "__main__":
    sys.exit(_run(*sys.argv[1:], check=False).returncode)
