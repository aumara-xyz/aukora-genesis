#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="$ROOT"
python3 -B "$ROOT/tests/continuity-spine/boundary.py" --root "$ROOT"
python3 -B -m unittest discover -s "$ROOT/tests/continuity-spine" -p 'test_*.py'
exec python3 -m diamond.court
