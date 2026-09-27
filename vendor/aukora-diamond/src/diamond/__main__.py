"""python -m diamond"""

from __future__ import annotations

import sys

HELP = """aukora-toy — sealed control-plane toy / wind tunnel.

  ./scripts/stranger-demo.sh     meeting narrative (exit 0 = all green)
  ./scripts/diamond.sh           diamond court
  python3 -m diamond.demo --out out  ephemeral plugin demo
  python3 -m diamond.cold_verify     stranger receipt court
  python3 -m diamond.simulated_device  B3c simulated device + fault arms

Phase 0 and cold receipt verify are different courts. Both are required.
Cold-only is CONSISTENCY_UNCHECKED. Attendance is reported-not-proven.
Evidence never authorizes; identity never crowns; grants authorize.
See PITCH.md, CEILINGS.md, SECURITY.md, REDTEAM.md, CONTINUITY-SPINE.md.
"""


def main() -> int:
    sys.stdout.write(HELP)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
