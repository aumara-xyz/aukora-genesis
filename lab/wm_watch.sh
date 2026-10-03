#!/bin/bash
# Mac-side watcher for the wm run. Reads ONLY files that pull_loop.sh already exports (pulled/wm.log,
# pulled/.pull_history, pulled/out/wm_DONE.json); no ssh, no provider calls, never stops or starts anything.
# Alerts once per event, as a macOS notification plus a line in $D/wm_watch.log:
#   WM_ALL_DONE (queue finished: the GPU is idle and the box still bills ~$5.4/h until someone stops it), WM_FAIL,
#   WM_WARN_* (a stage failed or was retried), WM_WAIT_GPU_LONG (waited 30+ min for the GPU: v7 still running, or an
#   orphaned EngineCore), WM_INTERACTIVE_INCOMPLETE / WM_RESUME, WM_EARLY (interactive close/commit rates after round 3),
#   WM_DONE_<stage>; wm.log unchanged for 25+ min before ALL_DONE (hang, or the pull loop stopped); pull loop silent 15+ min.
# Usage (Mac): nohup bash ~/aukora-nebius-run/lab/wm_watch.sh > ~/aukora-nebius-run/wm_watch.out 2>&1 &
# Testing: WM_WATCH_DIR=<dir with pulled/> WM_WATCH_DRY=1 WM_WATCH_ONCE=1 bash wm_watch.sh   (prints instead of notifying)
D=${WM_WATCH_DIR:-$HOME/aukora-nebius-run}
LOG=$D/pulled/wm.log; HIST=$D/pulled/.pull_history; DONE=$D/pulled/out/wm_DONE.json; ALOG=$D/wm_watch.log; SEEN=$D/.wm_watch_seen
touch "$SEEN"
notify(){ local msg=${1//\"/}; msg=${msg//\\/}
          echo "$(date -u +%FT%TZ) $msg" >> "$ALOG"
          if [ "${WM_WATCH_DRY:-0}" = 1 ]; then echo "NOTIFY $msg"
          else osascript -e "display notification \"$msg\" with title \"Aukora wm run\" sound name \"Glass\"" >/dev/null 2>&1; fi; }
once(){ grep -qxF "$1" "$SEEN" 2>/dev/null || { echo "$1" >> "$SEEN"; notify "$2"; }; }
mtime(){ stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }
while :; do
  now=$(date +%s)
  if [ -f "$LOG" ]; then
    LC_ALL=C grep -aoE 'WM_(ALL_DONE|FAIL|WARN_[A-Z_]+|WAIT_GPU_LONG|INTERACTIVE_INCOMPLETE|RESUME|EARLY|DONE_[A-Z]+)[^'$'\r'']*' "$LOG" |
      while IFS= read -r line; do once "$(printf '%s' "$line" | shasum | cut -c1-16)" "${line:0:200}"; done
    lm=$(mtime "$LOG")
    if ! LC_ALL=C grep -aq 'WM_ALL_DONE' "$LOG" && [ $((now - lm)) -gt 1500 ]; then
      once "stale-$lm" "wm.log unchanged for $(((now - lm) / 60)) min and no WM_ALL_DONE: hang, or the pull loop stopped"
    fi
  fi
  [ -f "$DONE" ] && once "done-json-$(mtime "$DONE")" "wm_DONE.json pulled: the wm queue is finished; the GPU is idle and billing"
  if [ -f "$HIST" ]; then
    hm=$(mtime "$HIST"); [ $((now - hm)) -gt 900 ] && once "pull-stale-$hm" "pull loop silent for $(((now - hm) / 60)) min"
  fi
  [ "${WM_WATCH_ONCE:-0}" = 1 ] && break
  sleep 120
done
