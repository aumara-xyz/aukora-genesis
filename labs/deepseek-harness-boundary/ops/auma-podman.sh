#!/usr/bin/env bash
# Rootless Podman API socket for user auma (run via: sudo -n -u auma -H).
set -e
export XDG_RUNTIME_DIR=/run/user/$(id -u); cd "$HOME"
mkdir -p "$XDG_RUNTIME_DIR/podman"
exec podman system service --time=0 "unix://$XDG_RUNTIME_DIR/podman/podman.sock"
