#!/usr/bin/env bash
# Run as auma: make sure OpenShell sandbox "auma-ws" is Ready; point /home/auma/workspace at its /sandbox volume.
export XDG_RUNTIME_DIR=/run/user/$(id -u) OPENSHELL_TELEMETRY_ENABLED=false OPENSHELL_LOCAL_TLS_DIR=$HOME/.local/state/openshell/tls
cd "$HOME"
for i in $(seq 1 30); do openshell status >/dev/null 2>&1 && break; sleep 1; done
openshell gateway list 2>/dev/null | grep -q openshell || openshell gateway add https://127.0.0.1:17690 --local --name openshell
phase=$(openshell sandbox list 2>/dev/null | awk '$1=="auma-ws"{print $NF}')
case "$phase" in
  Ready) ;;
  Stopped|Completed) openshell sandbox start auma-ws </dev/null ;;
  "") openshell sandbox create --name auma-ws --no-auto-providers --no-tty --detach </dev/null ;;
  *) openshell sandbox delete auma-ws </dev/null; for i in $(seq 1 60); do openshell sandbox list 2>/dev/null | grep -q '^auma-ws ' || break; sleep 1; done
     openshell sandbox create --name auma-ws --no-auto-providers --no-tty --detach </dev/null ;;
esac
id=$(podman ps --format '{{.Names}}' | sed -n 's/^openshell-default--auma-ws-//p' | head -1)
[ -n "$id" ] && ln -sfn "$HOME/.local/share/containers/storage/volumes/openshell-sandbox-$id-workspace/_data" "$HOME/workspace"
openshell sandbox list; ls -l "$HOME/workspace"
