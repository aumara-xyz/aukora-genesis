#!/usr/bin/env bash
# Run as auma: make sure OpenShell sandbox "auma-ws" is Ready, network none, and that Auma's /sandbox
# workspace survives Podman restarts AND sandbox recreation:
#   * a host copy lives in /home/auma/sandbox-persist (auma 0700, outside every container)
#   * it is refreshed from the live volume on every run and right before any delete
#   * a recreated sandbox gets it restored into its new workspace volume before use
export XDG_RUNTIME_DIR=/run/user/$(id -u) OPENSHELL_TELEMETRY_ENABLED=false OPENSHELL_LOCAL_TLS_DIR=$HOME/.local/state/openshell/tls
cd "$HOME"; P="$HOME/sandbox-persist"; mkdir -p "$P"; chmod 700 "$P" 2>/dev/null
vol() { local id; id=$(podman ps -a --sort created --format '{{.Names}}' | sed -n 's/^openshell-default--auma-ws-//p' | tail -1); [ -n "$id" ] && echo "$HOME/.local/share/containers/storage/volumes/openshell-sandbox-$id-workspace/_data"; }
snapshot() { local v; v=$(vol); [ -n "$v" ] || return 0
  podman unshare bash -c 'v=$1; P=$2; test -d "$v" || exit 0; rm -rf "$P.new"; cp -a "$v/." "$P.new/" 2>/dev/null || { mkdir -p "$P.new" && cp -a "$v/." "$P.new/"; } || exit 1
    rm -rf "$P.prev"; mv "$P" "$P.prev" && mv "$P.new" "$P"' _ "$v" "$P" && echo "snapshot: live /sandbox -> $P"; }
phase() { openshell sandbox list 2>/dev/null | awk '$1=="auma-ws"{print $NF}'; }
waitready() { for i in $(seq 1 90); do [ "$(phase)" = Ready ] && return 0; sleep 1; done; return 1; }
for i in $(seq 1 30); do openshell status >/dev/null 2>&1 && break; sleep 1; done
openshell gateway list 2>/dev/null | grep -q openshell || openshell gateway add https://127.0.0.1:17690 --local --name openshell
ph=$(phase); created=0
case "$ph" in
  Ready) ;;
  "") openshell sandbox create --name auma-ws --no-auto-providers --no-tty --detach </dev/null; created=1 ;;
  *) # Stopped/Completed/Error/...: try to bring the SAME sandbox (same volume) back first
     openshell sandbox start auma-ws </dev/null >/dev/null 2>&1; waitready || {
       snapshot; openshell sandbox delete auma-ws </dev/null
       for i in $(seq 1 60); do [ -z "$(phase)" ] && break; sleep 1; done
       openshell sandbox create --name auma-ws --no-auto-providers --no-tty --detach </dev/null; created=1; } ;;
esac
waitready || { echo "auma-ws not Ready" >&2; exit 1; }
v=$(vol)
# the persist copy is owned by the container uid: inspect/copy it inside the podman user namespace
if [ "$created" = 1 ]; then
  [ -n "$v" ] || { echo "REFUSING: new workspace volume not found; persist copy left untouched" >&2; exit 4; }
  if podman unshare bash -c '[ -n "$(ls -A "$1" 2>/dev/null)" ]' _ "$P"; then
    podman unshare cp -a "$P/." "$v/" || { echo "REFUSING: restore into new volume failed; persist copy left untouched" >&2; exit 4; }
    echo "restored $P -> new workspace volume"
  fi
else snapshot; fi
c=$(podman ps --format '{{.Names}}' | grep '^openshell-default--auma-ws-' | head -1)
net=$(podman inspect "$c" --format '{{.HostConfig.NetworkMode}}'); echo "sandbox network mode: $net"
[ "$net" = none ] || { echo "REFUSING: sandbox network mode is '$net', expected none" >&2; exit 3; }
[ -n "$v" ] && ln -sfn "$v" "$HOME/workspace"
openshell sandbox list
