#!/bin/bash
# Aukora voice sidecar — optional manual entrypoint; the UI host normally supervises it.
cd "$(dirname "$0")"
export HF_HOME="$PWD/models/huggingface"
export HUGGINGFACE_HUB_CACHE="$HF_HOME/hub"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
exec .venv/bin/python sidecar.py
