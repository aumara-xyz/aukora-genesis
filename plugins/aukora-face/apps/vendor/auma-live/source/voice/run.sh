#!/bin/bash
# Aukora voice sidecar — pm2 entrypoint (pm2 start ./run.sh --name spatial-voice)
cd "$(dirname "$0")"
exec .venv/bin/python sidecar.py
