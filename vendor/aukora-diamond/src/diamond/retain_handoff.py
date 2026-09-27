"""Separate-process retainer-B handoff.

Writes a retained observation under a separate root from a separate Python
process. Measured claim: separate process + separate root — not device
independence.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def handoff(observation: dict, out_path: Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(observation, indent=2) + "\n", encoding="utf-8")
    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write retained observation to a separate retainer root"
    )
    parser.add_argument(
        "--from",
        dest="src",
        required=True,
        help="source retained.json (or observation JSON)",
    )
    parser.add_argument(
        "--retainer-b-root",
        required=True,
        help="separate root directory for retainer-B",
    )
    parser.add_argument(
        "--name",
        default="retained.json",
        help="filename under retainer-b-root (default retained.json)",
    )
    args = parser.parse_args(argv)

    src = Path(args.src)
    obj = json.loads(src.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        print("FAIL: observation must be a JSON object", file=sys.stderr)
        return 2
    root = Path(args.retainer_b_root)
    dest = handoff(obj, root / args.name)
    print(f"retainer-B wrote {dest}")
    print("MEASURED: separate process + separate root (not device independence)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
