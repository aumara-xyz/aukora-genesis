"""Foreign Phase 0 pair smoke — shape + power-of-two UNDETERMINED path.

Does not import diamond.* or vendor.phase0. Second implementation smoke, not a
standard. Enough to decide equal-size same/different root and refuse garbage.
For full APPEND_ONLY growth proofs, use vendor/phase0/verify.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _is_pow2(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def decide(retained: dict, presented: dict) -> str:
    for obj, label in ((retained, "retained"), (presented, "presented")):
        if not isinstance(obj, dict):
            return "UNDETERMINED"
        if "size" not in obj or "root" not in obj:
            return "UNDETERMINED"
        if type(obj["size"]) is bool or not isinstance(obj["size"], int):
            return "UNDETERMINED"
        if not isinstance(obj["root"], str) or len(obj["root"]) != 64:
            return "UNDETERMINED"
    n, m = retained["size"], presented["size"]
    if m < n:
        return "OBSERVATION_CONFLICT"
    if m == n:
        return "APPEND_ONLY" if retained["root"] == presented["root"] else "OBSERVATION_CONFLICT"
    # Growth: this smoke does not reimplement consistency proofs.
    # Power-of-two retained + larger presented → UNDETERMINED (honest limit).
    if _is_pow2(n):
        return "UNDETERMINED"
    # Without a path, refuse to claim APPEND_ONLY.
    if "consistency_path" not in presented:
        return "UNDETERMINED"
    # Foreign smoke: if roots equal on growth without verifying path → still UNDETERMINED.
    # Only equal-size decisions are claimed here; growth is deferred to vendor Phase 0.
    return "UNDETERMINED"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Foreign Phase 0 pair smoke")
    parser.add_argument("--retained", required=True)
    parser.add_argument("--presented", required=True)
    args = parser.parse_args(argv)
    retained = json.loads(Path(args.retained).read_text(encoding="utf-8"))
    presented = json.loads(Path(args.presented).read_text(encoding="utf-8"))
    verdict = decide(retained, presented)
    print(verdict)
    print("FOREIGN: second implementation smoke (not a standard)", file=sys.stderr)
    return 0 if verdict == "APPEND_ONLY" else 1


if __name__ == "__main__":
    sys.exit(main())
