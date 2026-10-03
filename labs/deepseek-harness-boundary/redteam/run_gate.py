#!/usr/bin/env python3
"""Push every corpus attack through a gate instance's REAL code paths (propose -> validation -> render/flags).
Usage: run_gate.py <corpus.json> <out.jsonl> <scratch|live> [limit]
scratch: box-owned scratch gate on /tmp/sgate (touches nothing live); proposals left pending (scratch is disposable)
live:    the real gate as aukora-host; EVERY created proposal is rejected immediately."""
import json, subprocess, sys, time, re
NODE="/workspace/skunkworks/node/bin/node"; RT="/workspace/skunkworks/redteam"
corpus_f, out_f, mode = sys.argv[1], sys.argv[2], sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv)>4 else None
TARGET="plugins/auma-theme/theme.json"
SOCK = "/tmp/sgate/run/gate.sock" if mode=="scratch" else "/run/skunkworks-gate/gate.sock"

def call_batch(reqs):
    data="\n".join(json.dumps(r) for r
