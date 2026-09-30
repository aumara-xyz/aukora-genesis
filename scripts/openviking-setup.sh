#!/bin/sh
# OpenViking as Kira's retrieval layer: install the pinned release, and run it on this Mac.
#
#   sh scripts/openviking-setup.sh install [HOME]   venv + pinned wheel + hash-locked closure, ov.conf, root.key,
#                                                   aukora-bridge.json, and the local embedding model (verified)
#   sh scripts/openviking-setup.sh serve   [HOME]   run the embedding server and OpenViking in the foreground
#   sh scripts/openviking-setup.sh status  [HOME]   say whether both answer
#
# HOME is where OpenViking lives. The default is the directory beside the Kira store the app names
# (`stateDir` in ~/Library/Application Support/AUKORA/kira-deployment-overlay.patch.yml, whose parent + /openviking),
# which is also where Kira looks for it; $AUKORA_OPENVIKING_HOME overrides both. Nothing here writes outside HOME.
#
# What is pinned (vendor/openviking/upstream-openviking.json): the openviking wheel by sha256, the whole dependency
# closure by `pip --require-hashes` (requirements-macos-arm64-py311.lock, itself checked by sha256), and the embedding
# model by sha256. NOT pinned: llama-server (Homebrew `llama.cpp`) and the Python 3.11 interpreter.
#
# Environment knobs for install: AUKORA_OPENVIKING_PORT (default 1933), AUKORA_OPENVIKING_EMBED_PORT (1934),
# AUKORA_OPENVIKING_MODEL (an existing Qwen3-Embedding-0.6B-Q8_0.gguf to use in place; its sha256 is checked).
# For serve: AUKORA_OPENVIKING_EMBED_RSS_MIB (positive integer, default 1536) limits both RSS and
# macOS physical footprint, sampled every two seconds. Exceeding it restarts only the embedder.
set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PIN="$REPO/vendor/openviking/upstream-openviking.json"
LOCK="$REPO/vendor/openviking/requirements-macos-arm64-py311.lock"

die() { printf 'openviking-setup: %s\n' "$*" >&2; exit 1; }
say() { printf 'openviking-setup: %s\n' "$*"; }

pin() { # pin <python expression over m, the manifest>
    python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$PIN" "$1"
}
sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }

default_home() {
    if [ -n "${AUKORA_OPENVIKING_HOME:-}" ]; then printf '%s\n' "$AUKORA_OPENVIKING_HOME"; return; fi
    overlay="${AUKORA_STATE:-$HOME/Library/Application Support/AUKORA}/kira-deployment-overlay.patch.yml"
    [ -f "$overlay" ] || die "no HOME given and no app overlay at $overlay; pass the directory: $0 $1 <dir>"
    store=$(sed -n 's/^[[:space:]]*stateDir:[[:space:]]*//p' "$overlay" | head -n 1 | tr -d "\"'")
    [ -n "$store" ] || die "the app overlay names no stateDir; pass the directory explicitly"
    printf '%s/openviking\n' "$(dirname -- "$store")"
}

cmd=${1:-}
case "$cmd" in
    door|mcp) shift; exec node "$REPO/scripts/kira/viking-$cmd.mjs" "$@" ;;
esac
[ -n "$cmd" ] || die "usage: $0 install|serve|status [HOME], or door|mcp --installed (or --state-dir PATH --subject SUBJECT)"
H=${2:-}
[ -n "$H" ] || H=$(default_home "$cmd")
case "$H" in /*) ;; *) die "HOME must be an absolute path: $H" ;; esac

conf_get() { # conf_get <key> from aukora-bridge.json
    python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); v=c
for k in sys.argv[2].split("."): v=v[k]
print(v)' "$H/aukora-bridge.json" "$1"
}

install_home() {
    command -v shasum >/dev/null 2>&1 || die "shasum is required"
    mkdir -p "$H/downloads" "$H/data" "$H/models"
    chmod 700 "$H"

    # 1. The lock and the wheel are what the manifest says, byte for byte.
    want_lock=$(pin 'm["lock"]["sha256"]')
    [ "$(sha256_of "$LOCK")" = "$want_lock" ] || die "the dependency lock does not match its pin ($LOCK)"
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64) platform=darwin-arm64 ;;
        *) die "only macOS arm64 is locked (requirements-macos-arm64-py311.lock); this is $(uname -s)-$(uname -m)" ;;
    esac
    wheel=$(pin "[w for w in m['wheels'] if w['platform']=='$platform'][0]['filename']")
    wheel_url=$(pin "[w for w in m['wheels'] if w['platform']=='$platform'][0]['url']")
    wheel_sha=$(pin "[w for w in m['wheels'] if w['platform']=='$platform'][0]['sha256']")
    if [ ! -f "$H/downloads/$wheel" ] || [ "$(sha256_of "$H/downloads/$wheel")" != "$wheel_sha" ]; then
        say "downloading $wheel"
        curl -fsSL --retry 2 -o "$H/downloads/$wheel.part" "$wheel_url"
        mv "$H/downloads/$wheel.part" "$H/downloads/$wheel"
    fi
    got=$(sha256_of "$H/downloads/$wheel")
    [ "$got" = "$wheel_sha" ] || { rm -f "$H/downloads/$wheel"; die "$wheel sha256 $got != pinned $wheel_sha; removed"; }
    say "wheel verified: $wheel sha256 $got"

    # 2. The closure, every file hash-checked, then the verified wheel itself with no index and no dependencies.
    python3 -c 'import sys
out, skip = [], False
for line in open(sys.argv[1]):
    if line.startswith("openviking=="): skip = True; continue
    if skip and line.startswith("    "): continue
    skip = False; out.append(line)
open(sys.argv[2], "w").write("".join(out))' "$LOCK" "$H/downloads/closure.lock"
    if command -v uv >/dev/null 2>&1; then
        [ -x "$H/venv/bin/python" ] || uv venv --quiet --python 3.11 "$H/venv"
        uv pip install --quiet --python "$H/venv/bin/python" --require-hashes --no-deps -r "$H/downloads/closure.lock"
        uv pip install --quiet --python "$H/venv/bin/python" --no-deps --no-index "$H/downloads/$wheel"
    else
        py=$(command -v python3.11 || true)
        [ -n "$py" ] || die "Python 3.11 is required (the lock is resolved for 3.11): brew install python@3.11, or install uv"
        [ -x "$H/venv/bin/python" ] || "$py" -m venv "$H/venv"
        "$H/venv/bin/python" -m pip install --quiet --disable-pip-version-check --require-hashes --no-deps -r "$H/downloads/closure.lock"
        "$H/venv/bin/python" -m pip install --quiet --disable-pip-version-check --no-deps --no-index "$H/downloads/$wheel"
    fi
    installed=$("$H/venv/bin/python" -c 'import importlib.metadata as m; print(m.version("openviking"))')
    [ "$installed" = "$(pin 'm["version"]')" ] || die "installed openviking $installed, pinned $(pin 'm["version"]')"
    say "openviking $installed installed in $H/venv"

    # 3. The embedding model: an existing file checked in place, or the pinned download.
    model_sha=$(pin 'm["embeddingModel"]["sha256"]')
    model="${AUKORA_OPENVIKING_MODEL:-$H/models/$(pin 'm["embeddingModel"]["file"]')}"
    if [ ! -f "$model" ]; then
        [ -z "${AUKORA_OPENVIKING_MODEL:-}" ] || die "AUKORA_OPENVIKING_MODEL names no file: $model"
        say "downloading the embedding model ($(pin 'm["embeddingModel"]["bytes"]') bytes)"
        curl -fsSL --retry 2 -o "$model.part" "$(pin 'm["embeddingModel"]["url"]')"
        mv "$model.part" "$model"
    fi
    got=$(sha256_of "$model")
    [ "$got" = "$model_sha" ] || die "$model sha256 $got != pinned $model_sha"
    say "embedding model verified: $model"
    command -v llama-server >/dev/null 2>&1 || say "NOTE: llama-server is not on PATH; serve needs it (brew install llama.cpp)"

    # 4. Configuration. Written once; an existing file is kept so an owner's edits survive a re-install.
    port=${AUKORA_OPENVIKING_PORT:-1933}
    embed_port=${AUKORA_OPENVIKING_EMBED_PORT:-1934}
    if [ ! -f "$H/root.key" ]; then
        python3 -c 'import os,secrets,sys; fd=os.open(sys.argv[1], os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); os.write(fd, secrets.token_hex(32).encode()); os.close(fd)' "$H/root.key"
    fi
    chmod 600 "$H/root.key"
    if [ ! -f "$H/ov.conf" ]; then
        cat > "$H/ov.conf" <<EOF
{
  "server": {"host": "127.0.0.1", "port": $port, "auth_mode": "trusted", "root_api_key": "\${AUKORA_OPENVIKING_ROOT_KEY}", "cors_origins": []},
  "storage": {"workspace": "\${AUKORA_OPENVIKING_HOME}/data", "vectordb": {"name": "context", "backend": "local"}, "agfs": {"backend": "local"}},
  "embedding": {"max_input_tokens": 2000, "dense": {"provider": "openai", "api_base": "http://127.0.0.1:$embed_port/v1", "api_key": "local", "model": "qwen3-embedding-0.6b", "dimension": 1024, "encoding_format": "float"}}
}
EOF
    fi
    if [ ! -f "$H/aukora-bridge.json" ]; then
        # What Kira reads (plugins/aukora-kira/lib/recall-openviking.mjs) and what `serve` starts. The thresholds were
        # measured on ten notes with this model (see the commit that added this file); tune them here, not in code.
        python3 -c 'import json,sys
json.dump({
  "url": "http://127.0.0.1:%s" % sys.argv[2], "account": "aukora", "user": "owner",
  "scoreThreshold": 0.4, "window": 0.1, "limit": 3,
  "queryInstruction": "Instruct: Given a question from the owner, retrieve the memory notes that answer it\nQuery: ",
  "embedding": {"model": sys.argv[3], "port": int(sys.argv[4]), "context": 2048},
}, open(sys.argv[1], "w"), indent=2)' "$H/aukora-bridge.json" "$port" "$model" "$embed_port"
    fi
    chmod 600 "$H/ov.conf" "$H/aukora-bridge.json"
    say "installed in $H. Run: sh $0 serve \"$H\""
}

serve_home() {
    [ -x "$H/venv/bin/openviking-server" ] || die "not installed in $H; run: sh $0 install \"$H\""
    command -v llama-server >/dev/null 2>&1 || die "llama-server is not on PATH (brew install llama.cpp)"
    exec python3 "$REPO/scripts/openviking-supervisor.py" "$H"
}

status_home() {
    [ -f "$H/aukora-bridge.json" ] || { say "not installed in $H"; exit 1; }
    url=$(conf_get url)
    embed_port=$(conf_get embedding.port)
    ok=0
    if curl -fs -m 3 "http://127.0.0.1:$embed_port/health" >/dev/null 2>&1; then say "embedding: up on 127.0.0.1:$embed_port"; else say "embedding: DOWN on 127.0.0.1:$embed_port"; ok=1; fi
    if answer=$(curl -fs -m 3 "$url/health" 2>/dev/null); then say "openviking: $answer"; else say "openviking: DOWN at $url"; ok=1; fi
    exit "$ok"
}

case "$cmd" in
    install) install_home ;;
    serve) serve_home ;;
    status) status_home ;;
    *) die "usage: $0 install|serve|status [HOME], or door|mcp --installed (or --state-dir PATH --subject SUBJECT)" ;;
esac
