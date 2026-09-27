#!/usr/bin/env python3
"""Phase 0 stranger court: selftest + committed vectors. No Aura, no receipt."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERIFY = HERE / "verify.py"


def main() -> int:
    env = dict(os.environ)
    r = subprocess.run(
        [sys.executable, str(VERIFY), "--selftest"],
        cwd=str(HERE),
        env=env,
        text=True,
        capture_output=True,
    )
    if r.returncode != 0 or "selftest: ok" not in r.stdout:
        print(r.stdout, end="")
        print(r.stderr, end="", file=sys.stderr)
        print("PHASE0: RED")
        return 1
    print("[phase0-court] selftest ... ok")
    print("PHASE0: GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
