#!/bin/sh
# run-root.sh — the SHELL side of scripts/lib/run-root.mjs: the same marker, the same discipline.
#
#   . scripts/lib/run-root.sh
#   run_root_open "cut-release.sh"
#   trap 'run_root_close' EXIT INT TERM HUP        # the TOP-LEVEL caller owns cleanup
#   work="$RUN_ROOT/worktree"                      # every copy, worktree, scratch dir and log goes INSIDE
#   AUKORA_RUN_ROOT="$RUN_ROOT" some-child &       # so a re-parented child is findable by its ENV
#   run_root_close                                  # reap children FIRST, then remove the root
#
# It removes ONLY the root it created, never a caller-supplied path, and it never sweeps generic temp.
run_root_open() {
  _rr_owner=${1:-unknown}
  # AN ABSOLUTE `mktemp` ON PURPOSE: MEASURED — under a caller's stub PATH (which is exactly what the cut court
  # provides) a bare `mktemp` can resolve to a stub and the run root silently fails to open, which turned court arms
  # red with no refusal message at all. A run root must not depend on the caller's PATH.
  RUN_ROOT=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/aukora-run-XXXXXX" 2>/dev/null) \
    || RUN_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/aukora-run-XXXXXX") || return 1
  RUN_ROOT=$(cd "$RUN_ROOT" && pwd -P) || return 1
  _rr_pgid=$(/bin/ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
  printf '{"owner":"%s","pid":%s,"pgid":%s,"created":"%s","realpath":"%s"}\n' \
    "$_rr_owner" "$$" "${_rr_pgid:-$$}" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ROOT" > "$RUN_ROOT/.aukora-run-root"
  AUKORA_RUN_ROOT=$RUN_ROOT
  export AUKORA_RUN_ROOT
}

run_root_path() { printf '%s/%s\n' "$RUN_ROOT" "$1"; }

# Reap children by ENVIRONMENT (`ps -AE`: without -A the sweep silently finds NOTHING, which is how two backends
# survived at PPID 1) and by any pid the caller recorded in RUN_ROOT_PIDS. SIGTERM, brief grace, then SIGKILL.
run_root_reap() {
  [ -n "${RUN_ROOT:-}" ] || return 0
  _rr_hit=''
  for _rr_pid in $(/bin/ps -AE -o pid=,command= 2>/dev/null | /usr/bin/awk -v m="AUKORA_RUN_ROOT=$RUN_ROOT" 'index($0, m) { print $1 }'); do
    [ "$_rr_pid" = "$$" ] && continue
    _rr_hit="$_rr_hit $_rr_pid"
    /bin/kill -TERM "$_rr_pid" 2>/dev/null || true
  done
  for _rr_pid in ${RUN_ROOT_PIDS:-}; do /bin/kill -TERM "$_rr_pid" 2>/dev/null || true; done
  [ -n "$_rr_hit" ] && /bin/sleep 1
  for _rr_pid in $_rr_hit ${RUN_ROOT_PIDS:-}; do
    /bin/kill -0 "$_rr_pid" 2>/dev/null && /bin/kill -KILL "$_rr_pid" 2>/dev/null || true
  done
  return 0
}

# Remove ONLY what this run created. A caller-supplied path is never touched.
run_root_close() {
  run_root_reap
  if [ -n "${RUN_ROOT:-}" ] && [ -f "$RUN_ROOT/.aukora-run-root" ]; then
    /bin/rm -rf "$RUN_ROOT"
  fi
  RUN_ROOT=''
  AUKORA_RUN_ROOT=''
  unset AUKORA_RUN_ROOT
}

# ── THE DISK GUARD'S ENTRY POINT (§3 of the disk-leak audit, 2026-09-26) ───────────────────────────────────────────
#
# **WHY THIS IS A NEW FUNCTION AND NOT A CHANGE TO `run_root_open`.** §3 says both wrappers should call
# `node scripts/lib/run-root.mjs open|reap|check` "so the policy has exactly one implementation" — and the policy it
# means is the GUARD's: a fixed owned base, a budget that refuses by name, a reaper, a richer marker. `run_root_open`
# above implements none of those; it makes a mktemp root and cleans it up, and **lanes already source it**, so
# redirecting it would change the behaviour of scripts I have not read. The guard's policy now has exactly one
# implementation — the module — and this function calls it.
#
# SET `AUKORA_ROOT` TO THE REPOSITORY ROOT, or call it after `cd`-ing there; a sourced script has no `$0` of its own to
# resolve the module from, and guessing would find the wrong file rather than failing.
run_root_guard_open() {
  _rrg_owner=${1:-unknown}
  _rrg_label=${2:-scratch}
  _rrg_max=${3:-0}
  _rrg_module="${AUKORA_ROOT:-$(pwd)}/scripts/lib/run-root.mjs"
  [ -f "$_rrg_module" ] || { echo "run-root.sh: no guard module at $_rrg_module (set AUKORA_ROOT)" >&2; return 2; }
  RUN_ROOT=$(/usr/bin/env node "$_rrg_module" open --owner "$_rrg_owner" --label "$_rrg_label" --max-bytes "$_rrg_max") || return $?
  # THE MARKER IS THE MODULE'S, not a second one written here: two writers of one file is how a marker stops meaning
  # anything.
  AUKORA_RUN_ROOT=$RUN_ROOT
  export AUKORA_RUN_ROOT
  return 0
}

# The reaper, by the same route. Prints what it removed and what it skipped, so a caller can see both.
run_root_guard_reap() {
  _rrg_module="${AUKORA_ROOT:-$(pwd)}/scripts/lib/run-root.mjs"
  [ -f "$_rrg_module" ] || { echo "run-root.sh: no guard module at $_rrg_module (set AUKORA_ROOT)" >&2; return 2; }
  /usr/bin/env node "$_rrg_module" reap
}

# And the budget, asked without creating anything: exit 2 means NOT RUN.
run_root_guard_check() {
  _rrg_module="${AUKORA_ROOT:-$(pwd)}/scripts/lib/run-root.mjs"
  [ -f "$_rrg_module" ] || { echo "run-root.sh: no guard module at $_rrg_module (set AUKORA_ROOT)" >&2; return 2; }
  /usr/bin/env node "$_rrg_module" check --need-bytes "${1:-0}" --owner "${2:-shell}" --label "${3:-a check}"
}
