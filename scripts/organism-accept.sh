#!/usr/bin/env bash
# organism-accept — the one command that says whether the ORGANISM works, not whether a lane does.
#
#   bash scripts/organism-accept.sh [--release <dir>] [--live]
#
# WHY THIS EXISTS. Every "green" in this repository has so far meant "a lane proved itself in
# isolation". That is a fact about a lane. It is not a fact about the organism, and the two were
# being read as the same thing — which is how merged lanes sat unmounted on a live app while their
# PRs were green. This script reports on the ORGANISM: the composition actually loaded, the tools
# actually registered, the receipts actually on disk.
#
# IT REFUSES TO SUBSTITUTE, AND IT REFUSES TWICE. A candidate patch that is not in the running
# composition counts as a FAIL for that step, NOT as "prepared". Disposable-only evidence is labelled
# disposable. If a step cannot be measured in the mode requested, it reports FAIL with the reason —
# never a skip. And if the reason is the ENVIRONMENT rather than the product, that is said as an
# ENVIRONMENT REFUSAL with no product verdict at all: see the second refusal below, which exists
# because this file once reported "identity/approval is NOT established" when the truth was "this
# interpreter has no `yaml` module".
#
# ── EVIDENCE CLASSES (why the words changed) ────────────────────────────────────────────────────
# The first version of this file had two words for four different kinds of proof, and the strongest
# word was the one it used most loosely. Steps 4, 5 and 6 were printed as "LIVE" while their entire
# evidence was `row in aukora-composition.patch.yml` — a CONFIG/MOUNT fact. A release whose organ
# rows are DISABLED, whose entry file is missing, whose Aumlok mount carries no controller
# directory, or whose service is never invoked, still printed LIVE. Step 7 was printed as a
# capability ("ceilings available") while measuring only that a file exists. And the run ended
# "GREEN — every step measured on the loaded composition", which a reader takes as "the system
# works" when four of the seven steps had proved only "the system is configured".
#
# Every step now prints the class of evidence it actually produced, and the final verdict names the
# classes it is made of:
#
#   EXECUTED       a real code path ran here, on disposable state, and its own assertion or artifact
#                  is the evidence (steps 1-3: the release's own receipt-closure suite).
#   CONFIG/MOUNT   the release's OWN LOADER (dsh --dump-config, the same patch algorithm that boots)
#                  was asked what the patch list mounts: the row is present in the EFFECTIVE entry
#                  list, is not disabled, and its entry artifact exists. This is a fact about
#                  configuration. It is evidence that a cutover CAN carry the organ. It is NOT
#                  evidence that the organ is loaded or that it works, and it is never printed as
#                  LIVE. A row whose artifact resolves outside the measured release is a caveat on
#                  the row, not a silent pass: a moved or cloned release keeps mounting the tree it
#                  was built in, and the row says which bytes would load.
#   BIND           added to step 6 only: the row's own bytes were imported, mounted with the row's
#                  own config, and the mounted service READ a bound identity (a projection came
#                  back). This is the one organ measurement here that is behavioural rather than
#                  configurational, and it FAILs for an unbound, mistyped or empty binding.
#   LIVE-PROCESS   measured against the running process itself, --live only: the pid the launch
#                  record names is alive, its OWN argv names the recorded release, the record's own
#                  `command` agrees with that argv, the `--patch` list the process was started with
#                  matches the record's, and the recorded port's LISTEN socket belongs to that pid.
#                  This is process identity. It does NOT prove that any particular plugin registered
#                  inside that process — see the ceiling printed with a green run.
#   PRESENCE       a file exists and parses. Nothing about behaviour (step 7).
#
# A green run therefore says which of those it is made of, and a run that measured no process says so
# in the verdict line rather than in a footnote.
#
# ── THE SECOND REFUSAL: ENVIRONMENT, NOT PRODUCT ────────────────────────────────────────────────
# Steps 4-6 are measured from the loader's own effective entry list, and reading it is a
# PRECONDITION. When the precondition cannot be met, this command prints an ENVIRONMENT REFUSAL,
# reports steps 4-6 as NOT MEASURED, makes NO claim about the organs in either direction, and exits
# non-zero. It does not print FAIL for them, because "this run could not look" is not "the organ is
# not mounted" — and a tool that confuses the two wastes an afternoon of whoever believes it. The
# reader is the release's OWN js-yaml resolved through node (never a PATH python3), and the output
# states which one was used.
#
# EXIT 0 requires every non-optional step to pass AND the run's own controls to hold.
# EXIT 1 means either a product FAIL or an ENVIRONMENT REFUSAL; the verdict line says which.
#
#   --live            measure the composition the RUNNING app actually mounts (default)
#   --release <dir>   measure a named release's composition instead, on disposable state
#
# The seven steps are the fractal: propose -> grant -> check-at-use -> effect -> receipt, plus the
# three organs that make it identity-bearing (who), evidence-bearing (where/when) and memory-bearing
# (what).
set -uo pipefail

MODE="live"
RELEASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --live) MODE="live"; shift ;;
    --release) MODE="release"; RELEASE="$2"; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# NO MACHINE PATH IS BAKED IN HERE. An earlier revision defaulted to one absolute
# `.../deployments/owner-activation-<date>/live-state`, which made this file a description of one
# operator's laptop that merely happened to read correctly there: carried into a release it named
# a deployment no reader of that release could have. The default is now EMPTY and `--live`
# RESOLVES the state root, or REFUSES naming what it looked for. `--release` never needs it at all.
LIVE_STATE="${AUKORA_LIVE_STATE:-}"
# The port an operator names. It is an ASSERTION, not an instruction to kill anything: --live
# requires it to agree with the port the launch record names, and NOTHING in this file ever
# signals a process because of a port. (The previous revision's cleanup killed whatever `lsof`
# reported on this port. That is a machine-wide kill by coincidence of socket number: it is gone,
# and an unrelated listener sentinel now runs on every invocation to prove it is gone.)
PORT="${AUKORA_ACCEPT_PORT:-}"
TMPROOT="${TMPDIR:-/tmp}"; TMPROOT="${TMPROOT%/}"
WORK="$(mktemp -d "$TMPROOT/organism-accept-XXXXXX")"
SENTINEL_DIR=""
PASS=0; FAIL=0; OPT_SKIP=0
CONTROL_FAIL=0
declare -a ROWS

# Classes, counted over the steps that PASSED, so the verdict line can name what it is made of.
C_EXECUTED=0; C_MOUNT=0; C_LIVE=0; C_PRESENCE=0; C_BIND=0

say() { printf '%s\n' "$*"; }

# ── stopping things: only ever a process this run can prove it owns ─────────────────────────────
# An "owned" process is one whose OWN argv names a path inside a disposable tree THIS RUN created.
# Nothing else is reachable from here: no port, no process name, no pattern, no pid file. A pid the
# run merely remembers is not evidence of ownership, because a pid can be recycled and a record can
# be stale — which is exactly what the sentinel below is here to demonstrate.
OWNED_ROOT="$WORK/owned"           # helpers must name a path under this tree
mkdir -p "$OWNED_ROOT"

argv_of() { # argv_of <pid> — the kernel's view of a process, not a document's claim about it
  ps -p "$1" -o command= 2>/dev/null || true
}

prove_owned() { # prove_owned <pid> <tree-root> — 0 only when argv names a path inside that tree
  local pid="$1" root="$2" argv
  case "${pid:-}" in ''|*[!0-9]*) return 1 ;; esac
  [ -n "${root:-}" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  argv="$(argv_of "$pid")"
  [ -n "$argv" ] || return 1
  case "$argv" in
    *"$root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

stop_by_identity() { # stop_by_identity <pid> <tree-root> <label> — refuses everything unproven
  local pid="${1:-}" root="${2:-}" label="${3:-process}" i
  if ! prove_owned "$pid" "$root"; then
    say "  REFUSED to stop pid ${pid:-<none>} ($label): its own argv names no path inside ${root:-<no tree>}"
    return 1
  fi
  kill "$pid" 2>/dev/null || return 1
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  say "  stopped $label pid $pid (ownership proven: argv names a path inside $root)"
  return 0
}

cleanup() {
  # The ONLY kill sites in this file, both identity-proven. The sentinel is stopped last, after the
  # control has already asserted it SURVIVED every step; the two trees are the run's own.
  [ -n "${SENTINEL_PID:-}" ] && stop_by_identity "$SENTINEL_PID" "$SENTINEL_DIR" "sentinel" >/dev/null 2>&1
  [ -n "${HELPER_PID:-}" ] && stop_by_identity "$HELPER_PID" "$OWNED_ROOT" "helper" >/dev/null 2>&1
  [ -n "${WORK:-}" ] && rm -rf "$WORK"
  [ -n "${SENTINEL_DIR:-}" ] && rm -rf "$SENTINEL_DIR"
}
trap cleanup EXIT

# ── the unrelated-listener sentinel ─────────────────────────────────────────────────────────────
# A control that runs on EVERY invocation. It starts a process that looks superficially like a
# target — it listens on a loopback port and its argv has the shape of the app's own command line
# (node <...>/apps/cli/lib/bin.js --patch <...> --profile web --host 127.0.0.1 --port N) — but it is
# NOT the deployment, is NOT in the tree the run treats as owned, and is never measured by any step.
# At the end the run asserts it SURVIVED every step and that the ownership rule REFUSES to stop it
# through the run-owned tree. A verifier that silently kills unrelated work while reporting green is
# worse than one that reports nothing, so this is a control and a failing control fails the run.
free_port() {
  "${PY:-python3}" -c 'import socket
s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()' 2>/dev/null
}

start_sentinel() {
  command -v "${NODE:-node}" >/dev/null 2>&1 || return 1
  SENTINEL_DIR="$(mktemp -d "$TMPROOT/organism-accept-sentinel-XXXXXX")"
  cat > "$SENTINEL_DIR/listener.mjs" <<'SENTINEL'
// The unrelated listener: a plain HTTP server whose argv is shaped like the app's.
// It is deliberately NOT in the run's owned tree, so a cleanup that keys on a port, a name or a
// pattern will kill it, and a cleanup that keys on proven identity will not.
import { createServer } from 'node:http'
const port = Number(process.argv[2])
const server = createServer((_req, res) => { res.writeHead(200); res.end('sentinel\n') })
server.listen(port, '127.0.0.1', () => { console.log(`SENTINEL-READY pid=${process.pid} port=${port}`) })
setInterval(() => {}, 1000)
SENTINEL
  SENTINEL_PORT="$(free_port)"
  [ -n "$SENTINEL_PORT" ] || return 1
  "${NODE:-node}" "$SENTINEL_DIR/listener.mjs" "$SENTINEL_PORT" \
      "$RELEASE/apps/cli/lib/bin.js" --patch "$RELEASE/aukora-composition.patch.yml" \
      --profile web --host 127.0.0.1 --port "$SENTINEL_PORT" --no-open \
      >"$SENTINEL_DIR/out" 2>&1 &
  SENTINEL_PID=$!
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    grep -q 'SENTINEL-READY' "$SENTINEL_DIR/out" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

sentinel_listening() { # both the pid and the socket, measured — not the pid alone
  local who
  [ -n "${SENTINEL_PID:-}" ] || return 1
  kill -0 "$SENTINEL_PID" 2>/dev/null || return 1
  who="$(lsof -ti "tcp:$SENTINEL_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  [ "$who" = "$SENTINEL_PID" ] || return 1
  return 0
}

row() { # row <n> <name> <class> <PASS|FAIL|N/A> <evidence>
  local n="$1" name="$2" cls="$3" status="$4" evidence="$5"
  ROWS+=("$(printf '%-3s %-44s %-5s %-20s %s' "$n" "$name" "$status" "$cls" "$evidence")")
  case "$status" in
    PASS) PASS=$((PASS+1))
          case "$cls" in
            *LIVE-PROCESS*) C_LIVE=$((C_LIVE+1)) ;;
            *CONFIG/MOUNT*) C_MOUNT=$((C_MOUNT+1)) ;;
            *PRESENCE*)     C_PRESENCE=$((C_PRESENCE+1)) ;;
          esac
          case "$cls" in *EXECUTED*) C_EXECUTED=$((C_EXECUTED+1)) ;; esac
          case "$cls" in *BIND*) C_BIND=$((C_BIND+1)) ;; esac ;;
    FAIL) FAIL=$((FAIL+1)) ;;
    *)    OPT_SKIP=$((OPT_SKIP+1)) ;;
  esac
}

# Resolve the live state root from the machine this runs ON, in this order:
#   1. $AUKORA_LIVE_STATE, the explicit statement — always wins.
#   2. the recorded deployments under $AUKORA_HOME (default ~/.aukora-genesis), found by the SAME
#      `<deployments>/*/live-state/launch.json` glob that scripts/launch-dsh.py already uses to
#      identify the live root. Reusing that layout rather than inventing a second convention is the
#      point: discovery and recording must not be able to disagree about where live is.
# ZERO candidates and MORE THAN ONE are both refusals. Picking either would mean reporting on a
# deployment nobody named, which is the failure this command exists to catch.
resolve_live_state() {
  local home candidates
  [ -n "$LIVE_STATE" ] && return 0
  home="${AUKORA_HOME:-$HOME/.aukora-genesis}"
  set -- "$home"/deployments/*/live-state/launch.json
  candidates=""
  for _c in "$@"; do
    [ -f "$_c" ] || continue
    candidates="$candidates$(dirname "$_c")
"
  done
  candidates="$(printf '%s' "$candidates" | sed '/^$/d')"
  if [ -z "$candidates" ]; then
    say "BLOCKED: no live deployment record found under $home/deployments/*/live-state/launch.json"
    say "         Set AUKORA_LIVE_STATE=<state root> to name it, or AUKORA_HOME=<home> if the"
    say "         deployment records live somewhere else. Refusing rather than guessing: this"
    say "         command reports on THE composition that is loaded, so a state root it picked"
    say "         itself would be a report about a deployment nobody named."
    exit 1
  fi
  if [ "$(printf '%s\n' "$candidates" | wc -l | tr -d ' ')" -gt 1 ]; then
    say "BLOCKED: more than one live deployment record under $home/deployments:"
    printf '%s\n' "$candidates" | sed 's/^/         /'
    say "         Name the one to measure with AUKORA_LIVE_STATE=<state root>. Refusing to choose:"
    say "         on 2026-09-17 a rehearsal and the live app differed only by which state root they"
    say "         addressed, and that difference is exactly what this command must not guess about."
    exit 1
  fi
  LIVE_STATE="$(printf '%s\n' "$candidates" | head -1)"
  say "  live state: $LIVE_STATE (discovered; AUKORA_LIVE_STATE overrides)"
}

# ── what composition are we measuring? ──────────────────────────────────────────────────────────
PATCHES=()
LAUNCH=""
LIVE_PID=""; LIVE_PORT=""; LIVE_RECORD_CMD=""
if [ "$MODE" = "live" ]; then
  resolve_live_state
  LAUNCH="$LIVE_STATE/launch.json"
  if [ ! -f "$LAUNCH" ]; then
    say "BLOCKED: no launch record at $LAUNCH — cannot tell what the live app mounts"
    exit 1
  fi
  RELEASE="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('release',''))" "$LAUNCH")"
  # PORTABLE READ, not `mapfile`. macOS ships bash 3.2, where `mapfile` does not exist; the
  # command substitution then failed silently and PATCHES stayed EMPTY, so every organ row read as
  # "absent from every loaded patch" and the command reported a false 4/7 on a release that was
  # genuinely 7/7. A verifier that under-reports the thing it verifies is worse than no verifier,
  # so this reads line by line and REFUSES if it ends up with nothing while a record exists.
  PATCHES=()
  while IFS= read -r _p; do
    [ -n "$_p" ] && PATCHES+=("$_p")
  done < <(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
[print(p.get('path','')) for p in d.get('patches',[])]" "$LAUNCH")
  if [ "${#PATCHES[@]}" -eq 0 ]; then
    say "BLOCKED: launch record names no patches — refusing to report on an empty patch list"
    exit 1
  fi
else
  if [ -z "$RELEASE" ] || [ ! -d "$RELEASE" ]; then
    say "BLOCKED: --release needs an existing release directory"
    exit 1
  fi
  PATCHES=("$RELEASE/aukora-composition.patch.yml")
  for extra in aukora-lanes.patch.yml; do
    [ -f "$RELEASE/$extra" ] && PATCHES+=("$RELEASE/$extra") || true
  done
fi

say ""
say "organism-accept — mode=$MODE"
say "  release : ${RELEASE:-<none>}"
say "  patches : ${PATCHES[*]:-<none>}"
say ""
say "  evidence classes: EXECUTED      = a code path ran here, on disposable state"
say "                    CONFIG/MOUNT  = the release's OWN LOADER says the row is mounted (enabled,"
say "                                    entry present). Configuration, never behaviour."
say "                    BIND          = the row's own bytes were loaded with the row's own config"
say "                                    and the mounted service read a bound identity (in-process)"
say "                    LIVE-PROCESS  = measured against the running process's own argv and socket"
say "                    PRESENCE      = a file exists"
say ""

if [ -z "$RELEASE" ] || [ ! -d "$RELEASE" ]; then
  say "BLOCKED: release directory ${RELEASE:-<none>} does not exist"
  exit 1
fi

NODE="${AUKORA_ACCEPT_NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
  say "BLOCKED: no node on PATH (looked for '$NODE'). Steps 4-7 need it to ask the release's own"
  say "         loader what the patch list mounts. Failing rather than reporting CONFIG/MOUNT from a"
  say "         grep this file wrote itself: that is the substitution this command refuses to make."
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  say "BLOCKED: no python3 on PATH. Steps 1-3 run the release's own closure suite with it, and the"
  say "         loader's entry dump is read with it. Missing mandatory input fails; it is not skipped."
  exit 1
fi

# ── the run's control: an unrelated listener that must survive everything below ─────────────────
if start_sentinel; then
  say "  sentinel: unrelated listener on 127.0.0.1:$SENTINEL_PORT (pid $SENTINEL_PID), argv shaped"
  say "            like the app's, NOT owned by this run — every step below runs while it serves"
else
  CONTROL_FAIL=$((CONTROL_FAIL+1))
  say "  sentinel: COULD NOT START — the controls below cannot run, so this run proves nothing about"
  say "            its own cleanup. Failing the run rather than omitting the control silently."
fi
say ""

# ── 1 + 2 + 3: the composition path, driven from THIS release's bytes ───────────────────────────
CLOSURE="$RELEASE/scripts/composition/receipt-closure-test.py"
if [ ! -f "$CLOSURE" ]; then
  row 1 "NO_GRANT refuse / granted load / receipt" "EXECUTED" "FAIL" "release carries no receipt-closure suite"
  row 2 "granted load produces a receipt on disk" "EXECUTED" "FAIL" "same missing suite"
  row 3 "stranger verify from an empty directory" "EXECUTED" "FAIL" "same missing suite"
else
  if (cd "$WORK" && python3 -B "$CLOSURE" --release "$RELEASE" >"$WORK/closure.log" 2>&1); then
    row 1 "NO_GRANT refuse + granted load under a real grant" "EXECUTED" "PASS" "$(grep -cE '^  ok' "$WORK/closure.log") arms ran"
    row 2 "receipt settled to disk" "EXECUTED" "PASS" "suite exit 0; it asserts the settled receipt on disk"
    row 3 "stranger verify, empty cwd, exit 0" "EXECUTED" "PASS" "labelled verdicts present"
  else
    row 1 "NO_GRANT refuse + granted load under a real grant" "EXECUTED" "FAIL" "closure suite red — see $WORK/closure.log"
    row 2 "receipt settled to disk" "EXECUTED" "FAIL" "closure suite red"
    row 3 "stranger verify from an empty directory" "EXECUTED" "FAIL" "closure suite red"
    tail -4 "$WORK/closure.log" | sed 's/^/        /'
  fi
fi

# ── what does the release's OWN LOADER say the patch list mounts? ───────────────────────────────
# `dsh --dump-config` runs the include plugin's patch algorithm — the same one that boots — and
# prints the EFFECTIVE entry list: inserts applied, overrides assigned, `disabled` flags visible.
# Asking the loader is the point: a grep for "- id: X" answers a question about TEXT, and a row that
# is present-but-disabled, or present-and-pointing-at-nothing, passes a grep and mounts nothing.
# It runs with a DISPOSABLE home under $WORK. It never sees, and never writes, deployment state.
FACTS="$WORK/mount-facts.json"
READER_ERR=""
READER_NOTE=""
NOT_MEASURED=0
dump_effective_entries() {
  local args=() p
  for p in "${PATCHES[@]}"; do args+=(--patch "$p"); done
  [ -d "$WORK/home" ] || mkdir -p "$WORK/home" "$WORK/agents"
  ( cd "$WORK" && DSH_HOME="$WORK/home" DSH_AGENTS_HOME="$WORK/agents" DSH_TELEMETRY_MODE=DISABLED \
      "$NODE" "$RELEASE/apps/cli/lib/bin.js" --dump-config "${args[@]}" --profile web \
      >"$WORK/effective-entries.yml" 2>"$WORK/dump.err" )
}

entry_facts() { # entry_facts — writes $FACTS for the three organ ids; sets READER_ERR on refusal
  local ids="aukora-aura-association aukora-kira aukora-aumlok" reader_out rc=0
  if [ ! -f "$RELEASE/apps/cli/lib/bin.js" ]; then
    READER_ERR="the release carries no apps/cli/lib/bin.js, so its own loader cannot be asked what the patch list mounts"
    return 1
  fi
  if ! dump_effective_entries; then
    # NAME THE FAILURE, not the banner. `tail -1` on a crashed node prints "Node.js v22.23.0", which
    # tells a reader nothing; the error line is what says which module is missing.
    local loader_err
    loader_err="$(grep -m1 -E "Cannot find (package|module)|No module named" "$WORK/dump.err" 2>/dev/null | cut -c1-220)"
    [ -n "$loader_err" ] || loader_err="$(grep -m1 -E 'ERR_[A-Z_]+|Error' "$WORK/dump.err" 2>/dev/null | cut -c1-220)"
    [ -n "$loader_err" ] || loader_err="$(tail -1 "$WORK/dump.err" 2>/dev/null | cut -c1-220)"
    READER_ERR="the release's loader refused --dump-config: $loader_err"
    return 1
  fi
  reader_out="$("$NODE" "$WORK/entry-facts.mjs" "$WORK/effective-entries.yml" "$FACTS" "$RELEASE" $ids 2>"$WORK/facts.err")" || rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$reader_out" ]; then
    READER_ERR="the entry list could not be read back: ${reader_out:-$(tail -1 "$WORK/facts.err" 2>/dev/null | cut -c1-160)}"
    return 1
  fi
  case "$reader_out" in
    READER*) READER_NOTE="${reader_out#READER }" ;;
    *) READER_ERR="the entry reader refused: $reader_out"; return 1 ;;
  esac
  return 0
}

fact() { # fact <id> <key>
  python3 -c "
import json,sys
d=json.load(open(sys.argv[1])).get(sys.argv[2],{})
v=d.get(sys.argv[3],'')
print(json.dumps(v) if isinstance(v,(dict,list)) or v is None else v)" "$FACTS" "$1" "$2"
}

# ── reading the loader's own answer, with the loader's OWN library ──────────────────────────────
# The dump is the entry-list dialect written by the release's js-yaml, and it is read back with THAT
# library, resolved deliberately from the release rather than from whatever `python3` PATH happened
# to resolve to. MEASURED 2026-09-20 on this machine, and the reason this reader was rewritten:
# /usr/bin/python3 HAS PyYAML 6.0.3 and /opt/homebrew/bin/python3 does NOT, so the earlier reader
# let "which python3 is first in PATH" decide whether steps 4-6 reported the organs as "NOT
# established". An environment failure was wearing a product verdict — the same class of defect this
# command exists to refuse, pointing the other way. There is no PyYAML dependency here any more.
cat > "$WORK/entry-facts.mjs" <<'FACTSJS'
// Read the loader's effective entry list. argv: <dump> <out> <release> <id>...
// Resolves js-yaml from the release, by anchors a materialized release actually carries, and
// reports WHICH one it used so the reader is a stated fact rather than an invisible assumption.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dump, out, release, ...ids] = process.argv.slice(2)
const anchors = [
  join(release, 'vendor', 'include', 'lib', 'index.js'),   // the module that imports js-yaml at boot
  join(release, 'node_modules', 'js-yaml'),                // the package itself
  join(release, 'apps', 'cli', 'lib', 'bin.js'),           // the entry that composed the dump
]
const tried = []
let yaml = null
let resolved = ''
for (const anchor of anchors) {
  tried.push(anchor)
  try {
    const req = createRequire(anchor)
    yaml = req('js-yaml')
    resolved = req.resolve('js-yaml')
    break
  } catch { /* try the next anchor */ }
}
if (!yaml) {
  process.stdout.write(`REFUSAL no js-yaml resolvable from the release; tried ${tried.join(', ')}`)
  process.exit(3)
}

// The same dialect the include plugin mounts: JSON schema plus `!!js` scalars as expression nodes.
// An unevaluated expression is reported as UNPROVEN by the caller, never as enabled.
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', resolve: (d) => typeof d === 'string', construct: (d) => ({ __jsExpr: d }),
})
const schema = (yaml.JSON_SCHEMA ?? yaml.DEFAULT_SCHEMA).extend(JsExpr)
let docs
try {
  docs = yaml.load(readFileSync(dump, 'utf8'), { schema })
} catch (error) {
  process.stdout.write(`REFUSAL the release's own js-yaml could not read its own dump: ${String(error).slice(0, 200)}`)
  process.exit(4)
}

const facts = {}
const dups = {}
for (const entry of Array.isArray(docs) ? docs : []) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
  const id = entry.id
  if (!ids.includes(id)) continue
  // Last wins, which is the patch algorithm's own semantics: the entry map is rebuilt as inserts
  // are appended, so a later row with the same id is the one a non-insert patch addresses.
  if (id in facts) dups[id] = (dups[id] ?? 1) + 1
  facts[id] = entry
}
const result = {}
for (const id of ids) {
  const entry = facts[id]
  if (!entry) { result[id] = { present: false }; continue }
  const raw = 'disabled' in entry ? entry.disabled : false
  result[id] = {
    present: true,
    disabled: raw === true,
    disabled_unproven: typeof raw === 'object' && raw !== null,
    disabled_raw: typeof raw === 'boolean' || typeof raw === 'string' ? raw : '!!js expression',
    duplicate_rows: dups[id] ?? 1,
    name: entry.name ?? null,
    config: entry.config && typeof entry.config === 'object' && !Array.isArray(entry.config) ? entry.config : null,
  }
}
writeFileSync(out, JSON.stringify(result, null, 1))
process.stdout.write(`READER ${resolved} (node ${process.version})`)
FACTSJS

# The mount probe: mount the row's OWN bytes with the row's OWN config and observe whether the
# service appears and can read an identity. This is the difference between "a path string is in a
# file" and "these bytes register a service" — and for Aumlok, between "mounted" and "bound".
cat > "$WORK/mount-probe.mjs" <<'PROBE'
import { pathToFileURL } from 'node:url'
const [entry, cfgJson] = process.argv.slice(2)
const out = { entry, provided: [], mounted: false, bound: false }
try {
  const mod = await import(pathToFileURL(entry).href)
  if (typeof mod.apply !== 'function') out.refuse = 'entry exports no apply()'
  else {
    let svc
    mod.apply({ provide: (name, value) => { out.provided.push(name); svc = value } }, JSON.parse(cfgJson))
    out.mounted = out.provided.includes('aumlokControl')
    if (!out.mounted) out.refuse = `apply() provided ${JSON.stringify(out.provided)}, not aumlokControl`
    else if (typeof svc.refresh !== 'function') out.refuse = 'mounted service exposes no refresh()'
    else {
      try {
        const projection = svc.refresh()
        out.bound = true
        out.subject = projection.subject ?? null
        out.activeControlDigest = projection.activeControlDigest ?? null
      } catch (e) { out.refuse = `${e.code ?? e.name}: ${String(e.message).slice(0, 160)}` }
    }
  }
} catch (e) { out.refuse = `${e.name}: ${String(e.message).slice(0, 160)}` }
process.stdout.write(JSON.stringify(out))
PROBE

# ── the live claim, measured against the Process, not the record ────────────────────────────────
# A launch record is a document. It can name a release, a pid and a port that are not the ones
# running — measured on this machine on 2026-09-20: the recorded `command` array named
# .../aukora-release-7a98eec while the recorded pid's own argv named .../aukora-release-845ea06. The
# old revision printed LIVE for that record because all it read was the record. This reads the
# kernel: the pid's OWN argv must name the recorded release, and the socket on the recorded port
# must be owned by that same pid. Any disagreement is a FAIL naming the disagreement.
LIVE_OK=0; LIVE_WHY=""
prove_live_process() {
  local argv bin rec_bin listen_pid rec_port argv_patches rec_patches
  if [ "$MODE" != "live" ]; then
    LIVE_WHY="mode=release names no running process, so no step here is a LIVE claim"
    return 1
  fi
  LIVE_PID="$(python3 -c "import json,sys;print(json.load(open('$LAUNCH')).get('pid',''))" 2>/dev/null)"
  LIVE_PORT="$(python3 -c "import json,sys;print(json.load(open('$LAUNCH')).get('port',''))" 2>/dev/null)"
  case "${LIVE_PID:-}" in ''|*[!0-9]*) LIVE_WHY="launch record names no usable pid"; return 1 ;; esac
  if ! kill -0 "$LIVE_PID" 2>/dev/null; then
    LIVE_WHY="launch record names pid $LIVE_PID and that pid is not running"
    return 1
  fi
  argv="$(argv_of "$LIVE_PID")"
  [ -n "$argv" ] || { LIVE_WHY="could not read the argv of pid $LIVE_PID"; return 1; }
  # WHICH BYTES DID IT ACTUALLY START? The ENTRY token, not "does the release path appear anywhere
  # in argv": a process can be started from one release's bin.js while being handed another
  # release's --patch file, and "the string is in there somewhere" would call that a match.
  bin="$(printf '%s' "$argv" | tr ' ' '\n' | grep -E '/apps/cli/lib/bin\.js$' | head -1)"
  if [ -z "$bin" ]; then
    LIVE_WHY="pid $LIVE_PID's OWN argv names no .../apps/cli/lib/bin.js entry, so it is not the app process this record could describe"
    return 1
  fi
  case "$bin" in
    "$RELEASE"/*) : ;;
    *) LIVE_WHY="pid $LIVE_PID's OWN argv names $bin, not the recorded release $RELEASE"
       return 1 ;;
  esac
  # The record's own prose must agree with the process it claims. A record that names release A in
  # its fields and release B in its command line is a record about neither.
  rec_bin="$(python3 -c "
import json,sys
cmd=json.load(open('$LAUNCH')).get('command') or []
print(next((a for a in cmd if str(a).split('/')[-1]=='bin.js'), ''))" 2>/dev/null)"
  if [ -n "$rec_bin" ]; then
    case "$argv" in
      *"$rec_bin"*) : ;;
      *) LIVE_WHY="the record's command names $rec_bin and pid $LIVE_PID's OWN argv names a different entry — the record does not describe the running process"
         return 1 ;;
    esac
  fi
  case "${LIVE_PORT:-}" in
    ''|*[!0-9]*) LIVE_WHY="launch record names no usable port"; return 1 ;;
  esac
  if [ -n "$PORT" ] && [ "$PORT" != "$LIVE_PORT" ]; then
    LIVE_WHY="AUKORA_ACCEPT_PORT=$PORT was asserted and the launch record names port $LIVE_PORT"
    return 1
  fi
  # The composition the PROCESS loads, from its OWN argv: `--patch` is how the launcher passes it,
  # so a running process names the patch files it was started with. Comparing that against the
  # record's patch list is the difference between "a process with the right name is serving" and
  # "the composition this record describes is the one being served".
  argv_patches="$(printf '%s' "$argv" | python3 -c "
import sys
a = sys.stdin.read().split()
print('\n'.join(sorted(a[i+1] for i, t in enumerate(a[:-1]) if t == '--patch')))")"
  rec_patches="$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
print('\n'.join(sorted(p.get('path','') for p in d.get('patches',[]) if p.get('path'))))" "$LAUNCH")"
  if [ -z "$argv_patches" ]; then
    LIVE_WHY="pid $LIVE_PID's OWN argv names no --patch at all, so the composition it loads cannot be the one this record names"
    return 1
  fi
  if [ "$argv_patches" != "$rec_patches" ]; then
    LIVE_WHY="the record names patches [$(printf '%s' "$rec_patches" | tr '\n' ' ')] and pid $LIVE_PID's OWN argv names [$(printf '%s' "$argv_patches" | tr '\n' ' ')]"
    return 1
  fi
  listen_pid="$(lsof -ti "tcp:$LIVE_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  if [ -z "$listen_pid" ]; then
    LIVE_WHY="nothing is listening on the recorded port $LIVE_PORT, so the recorded process is not serving"
    return 1
  fi
  if [ "$listen_pid" != "$LIVE_PID" ]; then
    LIVE_WHY="port $LIVE_PORT is served by pid $listen_pid, not by the recorded pid $LIVE_PID"
    return 1
  fi
  LIVE_OK=1
  return 0
}
prove_live_process

# One function emits exactly one row per step, so the seven rows keep their numbers and their order.
# A row counts as mounted only when the RELEASE'S OWN LOADER puts it in the effective entry list
# ENABLED, and its entry artifact exists INSIDE the release being measured. A row pointing outside
# the release is a row about another release — the same defect the live record is checked for above.
check_organ() { # check_organ <step> <name> <row-id> <what-it-means> <binding:yes|no>
  local step="$1" name="$2" id="$3" meaning="$4" binding="${5:-no}"
  local cls="CONFIG/MOUNT" present disabled unproven dup raw entry path cfg directory probe subject OUTSIDE=""
  [ "$MODE" = "live" ] && cls="LIVE-PROCESS+CONFIG/MOUNT"

  present="$(fact "$id" present)"
  if [ "$present" != "True" ]; then
    row "$step" "$name" "$cls" "FAIL" "row '$id' absent from the effective entry list the loader built from ${PATCHES[*]} — $meaning NOT mounted"
    return
  fi
  unproven="$(fact "$id" disabled_unproven)"; raw="$(fact "$id" disabled_raw)"
  if [ "$unproven" = "True" ]; then
    row "$step" "$name" "$cls" "FAIL" "row '$id' carries a disabled EXPRESSION ($raw) that this tool does not evaluate — it cannot prove the row mounts, and an unproven row is not a mounted one"
    return
  fi
  disabled="$(fact "$id" disabled)"
  if [ "$disabled" = "True" ]; then
    row "$step" "$name" "$cls" "FAIL" "row '$id' is present but DISABLED in the effective entry list — $meaning NOT mounted"
    return
  fi
  entry="$(fact "$id" name)"
  path="${entry#file://}"; path="${path#./}"
  case "$path" in
    /*) : ;;
    *) row "$step" "$name" "$cls" "FAIL" "row '$id' names '$entry', which is not a file path inside the release — nothing to mount"; return ;;
  esac
  if [ ! -f "$path" ]; then
    row "$step" "$name" "$cls" "FAIL" "row '$id' names $path and no such file exists — the row mounts nothing"
    return
  fi
  # A row whose entry artifact lives in ANOTHER tree is still mounted — the loader loads those bytes —
  # so this is a CAVEAT and not a FAIL: the materializer writes absolute plugin paths, so a moved or
  # cloned release keeps mounting the tree it was built in. What this tool will not do is stay quiet
  # about it, so the row says which bytes would load. The hard FAIL is reserved for a row naming a
  # file that is not there, which mounts nothing whatever the release is called.
  OUTSIDE=""
  case "$path" in
    "$RELEASE"/*) : ;;
    *) OUTSIDE=" [caveat: entry artifact resolves OUTSIDE the measured release for this row; the bytes loaded are $path]" ;;
  esac
  # A LIVE claim needs the running process measured first. The mount fact still holds without it,
  # and the class says both rather than hiding one behind the other.
  if [ "$MODE" = "live" ] && [ "$LIVE_OK" != "1" ]; then
    row "$step" "$name" "$cls" "FAIL" "$LIVE_WHY — so the LIVE claim for '$id' (${meaning}) is not established"
    return
  fi
  dup="$(fact "$id" duplicate_rows)"
  cfg="$(fact "$id" config)"

  # ── the identity organ must be BOUND, not merely mounted ─────────────────────────────────────
  # Aumlok's own service refuses by name when it has no controller directory:
  # `aumlok:adapter-unbound: no controller directory is configured; a mount binds an identity with
  # config.directory`. A row that is present, enabled and points at real bytes therefore proves
  # nothing about identity until the mount carries a directory AND that directory's record can be
  # read. The probe mounts the row's OWN bytes with the row's OWN config and calls refresh(); the
  # step stands only if a projection comes back. Unbound, mistyped and empty all FAIL here.
  if [ "$binding" = "yes" ]; then
    cls="$cls+BIND"
    if [ -z "$cfg" ] || [ "$cfg" = "None" ] || [ "$cfg" = "null" ]; then
      row "$step" "$name" "$cls" "FAIL" "row mounted with NO config at all, so no config.directory — aumlok:adapter-unbound: identity is NOT live, only the row is"
      return
    fi
    directory="$(python3 -c "
import json,sys
c=json.loads(sys.argv[1]) or {}
d=c.get('directory')
if isinstance(d,str): print(d)
elif isinstance(d,dict): print('<unevaluated-expression>')
else: print('')" "$cfg" 2>/dev/null)"
    if [ "$directory" = "<unevaluated-expression>" ]; then
      row "$step" "$name" "$cls" "FAIL" "config.directory is an UNEVALUATED !!js expression: this tool does not evaluate expressions, so it cannot prove the binding and will not report one that it has not read"
      return
    fi
    if [ -z "$directory" ]; then
      row "$step" "$name" "$cls" "FAIL" "row mounted but UNBOUND: config carries no directory — aumlok:adapter-unbound, identity is NOT live"
      return
    fi
    if [ ! -d "$directory" ]; then
      row "$step" "$name" "$cls" "FAIL" "row bound to $directory and no such directory exists — the binding is a name, not a controller"
      return
    fi
    probe="$("$NODE" "$WORK/mount-probe.mjs" "$path" "$cfg" 2>"$WORK/probe.err" || true)"
    [ -n "$probe" ] || probe="$(tail -1 "$WORK/probe.err" 2>/dev/null)"
    case "$probe" in
      *'"bound":true'*)
        subject="$(printf '%s' "$probe" | python3 -c "import json,sys;print(json.load(sys.stdin).get('subject'))" 2>/dev/null)"
        row "$step" "$name" "$cls" "PASS" "enabled row; entry present; probe mounted the row's own bytes and READ the bound controller (subject ${subject:-<none>})$OUTSIDE" ;;
      *'"mounted":true'*)
        row "$step" "$name" "$cls" "FAIL" "mount registers aumlokControl and refuses to read the bound identity: $(printf '%s' "$probe" | cut -c1-160)" ;;
      *)
        row "$step" "$name" "$cls" "FAIL" "mounting the row's own bytes registers no aumlokControl service: $(printf '%s' "$probe" | cut -c1-160)" ;;
    esac
    return
  fi

  if [ "$MODE" = "live" ]; then
    row "$step" "$name" "$cls" "PASS" "pid $LIVE_PID argv names $RELEASE and owns LISTEN $LIVE_PORT; loader-built entry list carries an ENABLED row whose entry file exists$OUTSIDE"
  else
    row "$step" "$name" "$cls" "PASS" "enabled row in the loader's effective list$( [ "$dup" != "1" ] && printf ' (%s rows share this id)' "$dup" ); entry file present$OUTSIDE"
  fi
}

entry_facts || true
if [ -n "$READER_ERR" ]; then
  # AN ENVIRONMENT REFUSAL IS NOT A PRODUCT VERDICT. If the loader's own answer cannot be read, the
  # three organ steps were NOT MEASURED, and printing FAIL for them would say "the organs are not
  # mounted" when the truth is "this run could not look". They are reported as unmeasured, by name,
  # and the run exits non-zero: a precondition that cannot be met is never a silent skip.
  NOT_MEASURED=3
  say ""
  say "  ENVIRONMENT REFUSAL — steps 4, 5 and 6 were NOT MEASURED."
  say "    reason: $READER_ERR"
  say "    This is a precondition about THIS RUN, not a verdict about the organs. NO claim is made"
  say "    here about Aura, Kira or Aumlok, in either direction — neither LIVE, nor CONFIG/MOUNT,"
  say "    nor not-mounted. Fix the environment (or name one that works) and run it again."
  say "    reader: $("$NODE" --version 2>/dev/null) at $(command -v "$NODE")"
  say "    js-yaml resolution points tried, in order (the release's own parser, never a PATH python3):"
  say "      1. $RELEASE/vendor/include/lib/index.js"
  say "      2. $RELEASE/node_modules/js-yaml"
  say "      3. $RELEASE/apps/cli/lib/bin.js"
else
  say "  entry reader: $READER_NOTE"
  say "                (the release's own js-yaml, reading the dump its own loader produced)"
  check_organ 4 "Aura association (where/when)" "aukora-aura-association" "evidence chain is" no
  check_organ 5 "Kira memory (what)" "aukora-kira" "canonical memory is" no
  check_organ 6 "Aumlok identity (who)" "aukora-aumlok" "identity/approval is" yes
fi

# ── 7: ceilings, printed from the gate policy the release actually carries ──────────────────────
# PRESENCE, and named as presence. A policy file is not confinement: the gate plugin cannot enforce
# from where it is mounted (a plugin loads after the modules it would govern), so a green here says
# the release carries an admission boundary and prints its vocabulary — nothing more.
POLICY="$RELEASE/plugins/aukora-composition-gate/policy.json"
if [ -f "$POLICY" ]; then
  governed="$(python3 -c "
import json,sys
try: print(','.join(json.load(open(sys.argv[1])).get('governed',[])))
except Exception: print('')" "$POLICY" 2>/dev/null)"
  if [ -z "$governed" ]; then
    row 7 "gate policy present (not enforcement)" "PRESENCE" "FAIL" "policy.json present but carries no readable governed list"
  else
    row 7 "gate policy present (not enforcement)" "PRESENCE" "PASS" "policy.json parses; governed=[$governed]; file presence only"
    say ""
    # *** THE LIST IS READ FROM policy.js, WHICH IS THE SOURCE THAT DECLARES IT. *** It used to be TYPED BY
    # HAND, WITH A COMMENT CLAIMING IT WAS "printed from the gate's own vocabulary" -- AND IT HAD ALREADY
    # DRIFTED: FOUR NAMES HERE, THREE IN `policy.js`'s `CEILINGS`, the extra one being
    # `ATTENDANCE_REPORTED_NOT_PROVEN`, WHICH THE GATE DOES NOT DECLARE. So the tool asserted a provenance it
    # did not have AND PRINTED A CEILING THAT DOES NOT EXIST, WHILE OMITTING NOTHING -- the worst direction,
    # because a reader would take the fourth name as something the gate promises.
    # A LIST THAT DIFFERS FROM ITS SOURCE BY ONE NAME IS NOT A STALE COPY, IT IS A FALSE CLAIM -- which is why
    # the red arm for this is exactly that: one name added, and the arm must go red.
    ceilings="$(RELEASE="$RELEASE" node -e '
      import(process.env.RELEASE + "/plugins/aukora-composition-gate/src/policy.js")
        .then(m => { process.stdout.write((m.CEILINGS ?? []).join(", ")) })
        .catch(() => { process.exit(1) })
    ' 2>/dev/null)" || ceilings=""
    if [ -z "$ceilings" ]; then
      # FAIL CLOSED: an unreadable vocabulary is NOT "no ceilings", and printing nothing would read as one.
      row 7b "ceilings read from the gate's own source" "PRESENCE" "FAIL" \
        "policy.js is present but its CEILINGS could not be read, so what this composition declares is UNKNOWN rather than empty"
    else
      say "  ceilings this composition declares:"
      say "    $ceilings"
      say "    (READ FROM policy.js's own CEILINGS export -- not typed here; a green here is admission, not confinement)"
    fi
  fi
else
  row 7 "gate policy present (not enforcement)" "PRESENCE" "FAIL" "no gate policy.json in the release"
fi

# ── the control: did anything this run did touch the unrelated listener? ────────────────────────
if [ -n "${SENTINEL_PID:-}" ]; then
  say ""
  if sentinel_listening; then
    say "  CONTROL: unrelated listener pid $SENTINEL_PID on 127.0.0.1:$SENTINEL_PORT SURVIVED every step"
  else
    CONTROL_FAIL=$((CONTROL_FAIL+1))
    say "  CONTROL FAILED: unrelated listener pid ${SENTINEL_PID} on port ${SENTINEL_PORT} did NOT survive"
  fi
  if prove_owned "$SENTINEL_PID" "$OWNED_ROOT"; then
    CONTROL_FAIL=$((CONTROL_FAIL+1))
    say "  CONTROL FAILED: the ownership rule accepted the unrelated listener as owned — it is vacuous"
  else
    say "  CONTROL: ownership rule REFUSED to treat pid $SENTINEL_PID as owned (argv names no path in $OWNED_ROOT)"
  fi
fi

# ── result ──────────────────────────────────────────────────────────────────────────────────────
say ""
say "── result ─────────────────────────────────────────────────────────────────────"
for r in "${ROWS[@]}"; do say "  $r"; done
say ""
say "  passed: $PASS   failed: $FAIL   not-applicable: $OPT_SKIP   not measured: $NOT_MEASURED   control failures: $CONTROL_FAIL"
say "  passing-step evidence classes: EXECUTED $C_EXECUTED | BEHAVIOURAL BIND $C_BIND | CONFIG/MOUNT $C_MOUNT | LIVE-PROCESS $C_LIVE | PRESENCE $C_PRESENCE"
say ""
if [ "$NOT_MEASURED" -gt 0 ]; then
  say "ORGANISM-ACCEPT: NOT MEASURED — $NOT_MEASURED of 7 steps were refused for an ENVIRONMENT reason"
  say "  and were not measured; $PASS step(s) passed. This is neither a pass nor a product failure:"
  say "  $READER_ERR"
  exit 1
fi
if [ "$FAIL" -eq 0 ] && [ "$CONTROL_FAIL" -eq 0 ]; then
  if [ "$C_LIVE" -gt 0 ]; then
    say "ORGANISM-ACCEPT: GREEN — $PASS/7 steps satisfied, $C_LIVE of them measured against a running"
    say "  process. LIVE-PROCESS means: pid $LIVE_PID's own argv names this release and owns the"
    say "  listening socket on port $LIVE_PORT. It does NOT mean each organ was observed registering"
    say "  inside that process; the per-organ facts above are CONFIG/MOUNT, computed by the release's"
    say "  own loader. A plugin that loads and then refuses at use time is inside this green."
  else
    say "ORGANISM-ACCEPT: GREEN (CONFIGURED ONLY) — $PASS/7 steps satisfied and NOT ONE process was"
    say "  measured. $C_MOUNT of them are CONFIG/MOUNT facts and $C_PRESENCE is file presence. This"
    say "  release is CONFIGURED, not running, not exercised, not proven to mount anything at boot."
    say "  Re-run with --live against a recorded deployment to turn steps 4-6 into a LIVE claim."
  fi
  exit 0
fi
say "ORGANISM-ACCEPT: FAIL — $FAIL step(s) not satisfied, $CONTROL_FAIL control failure(s)."
say "  A lane whose row is not in a loaded patch is a lane that is NOT mounted, whatever its"
say "  PR status says. Candidate patches and disposable-only evidence do not count as live."
exit 1
