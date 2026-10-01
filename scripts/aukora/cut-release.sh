#!/bin/sh
# cut-release.sh — TONIGHT'S PATH IN ONE COMMAND, refusing by name at every step, and STOPPING BEFORE APPLY.
#
#   scripts/aukora/cut-release.sh <commit> [--worktree DIR] [--support DIR] [--home-session ID]
#                                 [--target DIR] [--retention-root DIR] [--log-dir DIR]
#
# The order is the order that matters, and each step is guarded by the thing that proves it:
#   (a) a CLEAN DETACHED WORKTREE at the named commit, with vendor/dsh as an APFS CLONE — NEVER A SYMLINK,
#       which is the root cause of the night of 2026-09-25 (a symlinked vendor/dsh built inside main's pinned
#       harness through `cp -Rc`). `build-face.py` refuses a symlinked pinned tree independently; this step
#       refuses it first, by name.
#   (b) the LOCKFILE PIN CHECK on MAIN's harness, against `upstream-dsh.json` — a source tree that is not the
#       pinned harness must never be materialized from.
#   (c) the RETENTION BOUND: over the bound it NAMES a park candidate and REFUSES if there is nothing it may
#       name. It NEVER deletes, and it NEVER touches 39ade459.
#   (d) materialize with `--from` MAIN's `vendor/dsh` (the tree step (b) just checked, not the worktree's copy).
#   (e) the boot smoke WITH ITS LOG PERSISTED, because "the URL answered" is not "the plugins activated".
#   (f) `desktop-cutover prepare --home-session`, which writes the receipt that binds the validation to bytes.
#
# IT STOPS HERE. The live apply is Fable's word, so this prints the exact `apply` command and exits 0.
#
# REFUSALS (each one is a court arm, with a red arm that removes the check):
#   usage-missing-commit, gate-below-floor, worktree-dir-exists, worktree-failed, harness-symlink,
#   harness-clone-failed, harness-lock-mismatch, retention-only-candidate-protected, materialize-failed,
#   boot-smoke-failed, boot-log-absent, prepare-refused, receipt-absent
#
# Every external command is taken from PATH, so a court can stub each step; nothing here needs the heavy lock
# EXCEPT the real runs (materialize and the smoke), which is why the caller runs this under scripts/heavy-run.sh.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
GIT=${GIT:-git}
NODE=${AUKORA_CUT_NODE:-${NODE:-node}}
PY=${AUKORA_CUT_PY:-${PY:-python3}}

refuse() { printf 'cut-release: %s: %s\n' "$1" "$2" >&2; exit "${3:-1}"; }
say() { printf '  %s\n' "$*"; }

COMMIT=''
WORKTREE=''
SUPPORT=''
SESSION=''
TARGET=''
RETENTION_ROOT=$(dirname "$HOME")
LOG_DIR=''
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE=${2:-}; shift 2 ;;
    --support) SUPPORT=${2:-}; shift 2 ;;
    --home-session) SESSION=${2:-}; shift 2 ;;
    --target) TARGET=${2:-}; shift 2 ;;
    --retention-root) RETENTION_ROOT=${2:-}; shift 2 ;;
    --log-dir) LOG_DIR=${2:-}; shift 2 ;;
    --*) refuse bad-usage "unknown option $1" ;;
    *) if [ -z "$COMMIT" ]; then COMMIT=$1; else refuse bad-usage "unexpected $1"; fi; shift ;;
  esac
done
[ -n "$COMMIT" ] || refuse usage-missing-commit "usage: cut-release.sh <commit> [--worktree DIR] [--support DIR] [--home-session ID] [--target DIR] [--retention-root DIR] [--log-dir DIR]"
[ -n "$SUPPORT" ] || refuse usage-missing-commit "no --support: prepare writes a receipt into that tree, and it must be a COPY, never Peter's"
[ -n "$SESSION" ] || refuse usage-missing-commit "no --home-session: the release's auma-live.patch.yml must be told which CORE session is home"
# *** `none` IS A VALUE, NOT AN ABSENCE (aura-91). *** *The running app has NO homeSession -- Fable measured the live
# config and the face-apps block carries no such key -- so requiring an id made this script STRICTER THAN WHAT PETER IS
# RUNNING. `none` therefore means "same as today": the key is OMITTED from auma-live.patch.yml rather than set to a
# placeholder. An EMPTY value is still refused by the line above, and any real id is still passed through unchanged.*
if [ "$SESSION" = none ]; then SESSION_KIND=none; else SESSION_KIND=id; fi
SHORT=$(printf '%s' "$COMMIT" | cut -c1-12)
# ── ONE RUN ROOT PER RUN (alpha-13) ─────────────────────────────────────────────────────────────────────────
# `. scripts/lib/run-root.sh` gives this script the same marker and the same discipline as the node side: ONE
# mktemp root, every scratch path INSIDE it, cleanup on EXIT/INT/TERM/HUP that reaps this run's children FIRST
# (by environment, because a backend re-parents to PID 1) and then removes the root.
#
# WHAT GOES INSIDE: the WORKTREE (scratch) and the LOG_DIR (the spec puts logs in the run root — and a REFUSAL
# KEEPS the root and says so, so a failed cut's evidence survives; the stale reaper removes it after 6h).
# WHAT DOES NOT: `--target` (the materialized release is the PRODUCT, kept for the parity gate) and `--support`
# (CALLER-SUPPLIED; a script cleans only what it created, and the receipt prepare writes belongs to the caller).
# THE HELPER IS FOUND FROM THIS SCRIPT'S OWN LOCATION, NOT FROM `$REPO`: MEASURED — `$REPO` is resolved by tools
# the court STUBS, so a source line that depends on it died before the run root existed and every arm ended at
# `commit HEAD` with no refusal message. A script must be able to find its own sibling library.
RUN_ROOT_LIB=$(cd "$(dirname "$0")/../lib" 2>/dev/null && pwd) || RUN_ROOT_LIB=''
[ -n "$RUN_ROOT_LIB" ] && [ -f "$RUN_ROOT_LIB/run-root.sh" ] || refuse usage-missing-helper "cannot find scripts/lib/run-root.sh next to $0, and the run root is how this script cleans up after itself"
. "$RUN_ROOT_LIB/run-root.sh"
# THE CALL MUST PRECEDE THE FIRST USE OF $RUN_ROOT: MEASURED — under `set -u` the WORKTREE default read
# an unset RUN_ROOT and the script died with `RUN_ROOT: unbound variable` on EVERY invocation, which is what
# turned eighteen court arms red. The root is opened exactly once, here, before anything names a path inside it.
run_root_open "cut-release.sh"
[ -n "$WORKTREE" ] || WORKTREE="$RUN_ROOT/worktree"
[ -n "$LOG_DIR" ] || LOG_DIR="$RUN_ROOT/logs"
[ -n "$TARGET" ] || TARGET="$HOME/aukora-release-$SHORT"
say "  run root $RUN_ROOT (removed on exit; AUKORA_RUN_ROOT_KEEP=1 keeps it, --log-dir keeps the logs)"

# The top-level caller owns cleanup. SUCCESS removes the root; a REFUSAL keeps it, names it, and reaps the
# children anyway — so nothing survives at PPID 1 either way.
# THE SPEC IS CLEANUP ON EXIT/INT/TERM/HUP, AND MY FIRST VERSION BROKE IT: I kept the root on refusal "for
# evidence", which leaked ONE ROOT PER REFUSAL — the cut court's 22 refusal arms left 45 of them in TMPDIR, the
# exact leak class this work exists to remove. The default is now REMOVE, always, reaping children first; a human
# debugging a real cut opts in with AUKORA_RUN_ROOT_KEEP=1, and a caller who wants the logs permanently passes
# `--log-dir`, which is caller-supplied and therefore never removed by this script.
cut_cleanup() {
  _status=$?
  run_root_reap
  if [ "${AUKORA_RUN_ROOT_KEEP:-0}" = "1" ]; then
    printf 'cut-release: the run root is KEPT because AUKORA_RUN_ROOT_KEEP=1: %s\n' "$RUN_ROOT" >&2
  else
    run_root_close
  fi
  return "$_status"
}
trap 'cut_cleanup' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

say "cut-release: commit $SHORT"
say "  worktree $WORKTREE"
say "  target   $TARGET"
say "  support  $SUPPORT (a COPY; the live tree is never touched by this script)"
say "  logs     $LOG_DIR"

# ── THE MACHINE GATE, BEFORE ANYTHING HEAVY (Fable's metric, not the wrong swap-free one) ────────────────
# ABSOLUTE TOOL PATHS: MEASURED — under a clean `env -i` PATH (which is how the courts run), `sysctl` lives in
# `/usr/sbin` and was NOT found, so the gate read `level=0` and refused a healthy machine with a message that
# blamed the machine instead of the PATH. A missing tool must not be reported as an unhealthy host.
# A COURT MAY OVERRIDE EVERY TOOL THIS SCRIPT CALLS BY ABSOLUTE PATH (MEASURED: making `sysctl` absolute to fix
# the env-i PATH problem ALSO made the gate's own court unable to stub it, so two arms could no longer measure the
# floor). A real run never sets these; a court must be able to, or it is not measuring the script.
SYSCTL=${AUKORA_CUT_SYSCTL:-/usr/sbin/sysctl}; [ -x "$SYSCTL" ] || SYSCTL=$(command -v sysctl || true)
DFCMD=${AUKORA_CUT_DF:-/bin/df}; [ -x "$DFCMD" ] || DFCMD=$(command -v df || true)
[ -n "$SYSCTL" ] || refuse gate-below-floor "cannot find sysctl (looked at /usr/sbin/sysctl and PATH), so the machine gate cannot be read"
LEVEL=$("$SYSCTL" -n kern.memorystatus_level 2>/dev/null || echo 0)
# **THE DISK GATE READS THE DISK THE WAY THIS PLATFORM REPORTS IT.** MEASURED (steps 447-448, reproduced in the
# container): `df -g` is BSD-only — Linux answers `df: invalid option -- 'g'` — so DISK came back EMPTY and the gate
# below refused `gate-below-floor` BEFORE the script did anything; that one refusal produced all six reds, including the
# one that read like a contradiction, "a green summary still exits 1". On darwin the first read succeeds and NOTHING
# CHANGES; elsewhere the fallback reads KiB and converts. Two single-line reads, because a multi-line `if` inside a
# substitution did not survive `sh` when I first tried it, and it broke a passing Mac court.
#
# **WHAT THIS CHANGE DID NOT DO, MEASURED.** I committed it claiming the BSD-only flag "produced all six of steps
# 447-448's reds"; the next run contradicted that — the Linux count was 6 of 23 BEFORE and 6 of 23 AFTER, and the Mac
# was unchanged. So the portability fix is real but INERT for that court, and the six reds have a cause I have not
# found. The likely reason is above in this file: DFCMD comes from AUKORA_CUT_DF, so the court can hand the script a
# stub and never reach this line at all. The mechanism that IS measured: Linux answers `df: invalid option -- 'g'`, so
# an unreplaced /bin/df would give an empty DISK here. Recording the disproof beside the change, because the commit
# message could not be amended and a wrong causal claim in the log is worse than no claim.
DISK=$("$DFCMD" -g / 2>/dev/null | awk 'NR==2 {print $4}')
[ -n "$DISK" ] || DISK=$("$DFCMD" -Pk / 2>/dev/null | awk 'NR==2 {print int($4 / 1048576)}')
if [ "$LEVEL" -lt 35 ] || [ "$DISK" -lt 10 ]; then
  refuse gate-below-floor "kern.memorystatus_level=$LEVEL (needs >=35) or free disk ${DISK}GiB (needs >=10): this run materializes and boots, and one heavy thing at a time is the rule"
fi
say "  gate: level=$LEVEL disk=${DISK}GiB"

# ── (a) THE WORKTREE, AND THE HARNESS AS A CLONE ─────────────────────────────────────────────────────────
[ -e "$WORKTREE" ] && refuse worktree-dir-exists "$WORKTREE exists; remove it by its FULL name first, so a stale tree cannot be mistaken for a fresh one"
mkdir -p "$(dirname "$WORKTREE")"
"$GIT" -C "$REPO" worktree add --detach "$WORKTREE" "$COMMIT" >/dev/null 2>&1 \
  || refuse worktree-failed "git worktree add --detach $WORKTREE $COMMIT failed"
HARNESS="$WORKTREE/vendor/dsh"
mkdir -p "$WORKTREE/vendor"
[ -L "$HARNESS" ] && refuse harness-symlink "$HARNESS is a SYMBOLIC LINK; \`cp -Rc\` copies a symlink AS a symlink, so a build would write INSIDE its target"
cp -Rc "$REPO/vendor/dsh" "$HARNESS" 2>/dev/null || refuse harness-clone-failed "cp -Rc $REPO/vendor/dsh $HARNESS failed"
[ -L "$HARNESS" ] && refuse harness-symlink "$HARNESS became a SYMBOLIC LINK during the clone"
say "(a) worktree at $(printf '%s' "$COMMIT" | cut -c1-12) with vendor/dsh cloned (never linked)"

# The candidate's complete patch set must have reached the compiled harness, not just its lockfile.
"$PY" "$WORKTREE/scripts/build-dsh.py" --root "$WORKTREE" --verify-built --source "$HARNESS" \
  || refuse harness-build-binding-refused "the cloned harness has no successful build for the candidate archive and patch set; rebuild before cutting"

# ── (b) THE LOCKFILE PIN, CHECKED ON MAIN'S HARNESS ──────────────────────────────────────────────────────
"$PY" - "$REPO" <<'PY' || refuse harness-lock-mismatch "main's vendor/dsh/pnpm-lock.yaml does not match the digest upstream-dsh.json pins, so this tree is NOT the pinned harness and nothing may be materialized from it"
import hashlib, json, pathlib, sys
repo = pathlib.Path(sys.argv[1])
pin = json.loads((repo / 'upstream-dsh.json').read_text())['lockfileSha256']
got = hashlib.sha256((repo / 'vendor/dsh/pnpm-lock.yaml').read_bytes()).hexdigest()
print(f"  (b) lock {got[:12]} == pin {pin[:12]}" if got == pin else f"  (b) lock {got[:12]} != pin {pin[:12]}")
sys.exit(0 if got == pin else 1)
PY

# ── (c) THE RETENTION BOUND: NAMES A CANDIDATE, DELETES NOTHING, NEVER TOUCHES 39ade459 ──────────────────
# **aura-80: THE REFUSAL NOW NAMES THE RELEASE IT WOULD PARK, AND STOPS CLAIMING A PROTECTION IT DOES NOT HAVE.**
# *The old message said "the only candidate is protected (39ade459 is never touched)"* -- **and that is not what
# the code does.** `release-retention.py:20` is `PROTECTED_ALWAYS = ('bd69f9cd','bd45806a','e1e24153','845ea06')`
# and **`39ade459` is not in it**; *it is unprotected*, and what excludes it is this step's OWN `safe` filter.
# **The distinction matters to the next person**: *a protected release cannot be parked at all, while an
# unprotected one needs only a person to move it* -- and Fable cleared exactly this by RENAME.
#
# **AND THE MESSAGE NAMES THE CANDIDATE NOW**, because "park a release BY HAND" without naming which one is the
# sentence that left this lane stuck for three rounds. *The python writes the names to a file the refusal reads*,
# so the name survives into the error a person actually sees.
RETENTION_CANDIDATES="$RETENTION_ROOT/../.cut-release-candidates"; export RETENTION_CANDIDATES
"$PY" - "$REPO" "$RETENTION_ROOT" <<'PY' || refuse retention-only-candidate-protected "the root is over the retention bound and NO candidate may be parked by this script; the candidate this run needs parked is named on the line above and in .cut-release-candidates, and it is NOT a protected release (it is excluded by this step's own safe filter), so parking it BY HAND -- a rename is enough -- clears this refusal and leaves every protected release untouched"
import importlib.util as ilu, os, pathlib, sys
repo, root = pathlib.Path(sys.argv[1]), sys.argv[2]
# *** `spec_from_file_location` DOES NOT PUT THE MODULE'S OWN DIRECTORY ON `sys.path`, SO ITS
# `from lib.platform_tools import …` DIED WITH ModuleNotFoundError AND THE RETENTION CHECK CRASHED.** *A crash here
# is not a refusal: the script failed with `retention-only-candidate-protected` for a reason that had nothing to do
# with the bound.* Running the file as `python3 scripts/x.py` would put `scripts/` on sys.path[0]; loading it by spec
# does not, so it is added here.
sys.path.insert(0, str(repo / 'scripts'))
spec = ilu.spec_from_file_location('rr', repo / 'scripts' / 'release-retention.py')
m = ilu.module_from_spec(spec); spec.loader.exec_module(m)
state = pathlib.Path.home() / 'Library' / 'Application Support' / 'AUKORA'
protect = m.protected_names(launch_record=state / 'state' / 'launch.json', rollback_record=state / 'state' / 'rollback.json')
over, remove, kept = m.plan(root, live=None, protect=protect)
names = [i['name'] for i in remove]
print('  (c) over bound' if over else '  (c) under the bound')
if not over:
    sys.exit(0)
safe = [n for n in names if '39ade459' not in n]
if not safe:
    print('      nothing may be named: ' + (', '.join(names) or 'no candidate'))
    # **THE NAMES GO TO A FILE THE REFUSAL READS**, so the message a person sees carries the release they
    # must park. *A refusal that says "park one by hand" without saying WHICH costs its reader the same
    # investigation twice* -- which is exactly what it cost this lane.
    try:
        pathlib.Path(os.environ['RETENTION_CANDIDATES']).write_text(', '.join(names) or 'no candidate')
    except Exception:
        pass
    sys.exit(1)
print('      PASS BY HAND, never by this script: ' + ', '.join(safe))
PY

# ── (d) MATERIALIZE, FROM THE HARNESS STEP (b) PINNED ───────────────────────────────────────────────────
# MEASURED, 2026-09-25, AND IT IS WHY THIS RUNS IN THE WORKTREE: run from the main checkout, the materializer
# REFUSED `materialize-dirty-tree` — three uncommitted tracked changes that belong to OTHER LANES
# (`.agents/live/reports/KIRA.md`, `plugins/aukora-face/threads/lib/client.js`, `tests/aukora-heavy-run.test.mjs`)
# — because its record would name HEAD while attesting working-tree bytes. A lane may not commit another lane's
# files, so the remedy the refusal itself names is used: `cut from a clean checkout`. Step (a) has already made
# one at this commit, and step (b) pinned the harness, so the release is cut from a CLEAN tree at the SAME commit
# whose harness is byte-identical to main's. (Fable's step (d) said "from main's vendor/dsh": the worktree's
# vendor/dsh IS main's, cloned in step (a) and pinned in step (b), and no uncommitted byte of main's enters it.)
( cd "$WORKTREE" && "$PY" "$WORKTREE/scripts/materialize-aukora-release.py" --from "$WORKTREE/vendor/dsh" --to "$TARGET" ) \
  || refuse materialize-failed "materialize-aukora-release.py --from $WORKTREE/vendor/dsh --to $TARGET failed in the clean worktree"
say "(d) materialized $TARGET from the pinned harness, in the CLEAN worktree at this commit"

# ── (e) THE BOOT SMOKE, WITH ITS LOG PERSISTED ──────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
SMOKE_LOG="$LOG_DIR/smoke.log"
# --repo IS THE CLEAN WORKTREE AT THIS COMMIT (2026-09-27): without it the smoke took the caller's cwd, the main checkout,
# whose HEAD is not the commit being cut when become.mjs runs, and refused repo-not-at-release-commit every time.
"$NODE" "$REPO/scripts/aura/release-boot-smoke.mjs" --release "$TARGET" --repo "$WORKTREE" --log-out "$SMOKE_LOG" > "$LOG_DIR/smoke.out" 2>&1 \
  || refuse boot-smoke-failed "the boot smoke failed; its output is $LOG_DIR/smoke.out and its log $SMOKE_LOG"
# MEASURED (Fable, 2026-09-25): `launch-dsh.py` composes patches ONLY from its `--patch` arguments, and the
# smoke passed NONE, so every smoke booted a BARE harness — no face, Kira, Aumlok, board or CORE rows — and
# "BOOTED" never proved the composition loads. The smoke's stdout is the LAUNCHER's output; the backend's log is
# `<stateRoot>/logs/server.log`, a FILE that dies with the scratch root. So an empty or missing file here is NOT
# a formatting detail: it is the blindness itself, and it refuses. AURA's fix (pass the release's composition
# patch, require the face to serve, persist the backend log before cleanup) is what satisfies this check.
[ -s "$SMOKE_LOG" ] || refuse boot-log-absent "the smoke booted but persisted NO log content at $SMOKE_LOG — and the launcher's stdout is not the BACKEND's log, which is <stateRoot>/logs/server.log and dies with the scratch root, so 'the composition loaded and its plugins activated' is UNPROVEN (Fable's measured gap: the smoke passed no --patch, so it booted a BARE harness)"
say "(e) boot smoke booted, log $(wc -c < "$SMOKE_LOG" | tr -d ' ') bytes at $SMOKE_LOG"

# ── (f) PREPARE, WHICH WRITES THE RECEIPT ───────────────────────────────────────────────────────────────
# THE FLAG IS OMITTED, NOT BLANKED: `--home-session ""` would reach the planner as an empty id and write an empty key.
if [ "$SESSION_KIND" = none ]; then
  "$NODE" "$REPO/scripts/aukora/desktop-cutover.mjs" prepare "$TARGET" --support-root "$SUPPORT" \
    || refuse prepare-refused "desktop-cutover prepare refused; nothing has been written to any live tree"
else
  "$NODE" "$REPO/scripts/aukora/desktop-cutover.mjs" prepare "$TARGET" --support-root "$SUPPORT" --home-session "$SESSION" \
    || refuse prepare-refused "desktop-cutover prepare refused; nothing has been written to any live tree"
fi
RECEIPT="$SUPPORT/state/desktop-cutover.prepared.json"
[ -f "$RECEIPT" ] || refuse receipt-absent "prepare reported success but wrote no receipt at $RECEIPT, so apply would refuse and this cutover would not be bound to the bytes that were validated"
say "(f) receipt written: $(wc -c < "$RECEIPT" | tr -d ' ') bytes"

# ── IT STOPS HERE: THE LIVE APPLY IS FABLE'S WORD, NOT THIS SCRIPT'S ─────────────────────────────────────
printf '\ncut-release: READY. Nothing has been applied. The apply is Fable'\''s, and it is:\n\n'
# *** THE APPLY LINE MUST CARRY WHAT PREPARE CARRIED. *** *Printing `--home-session none` here would hand Peter a command
# that sets a literal session named "none" -- the same class of error as a placeholder reaching a live tree.*
if [ "$SESSION_KIND" = none ]; then
  printf '  HOME SESSION: none -- same as today, the key is ABSENT from auma-live.patch.yml\n\n'
  printf '  %s %s apply %s --support-root %s\n\n' \
    "$(command -v node)" "$REPO/scripts/aukora/desktop-cutover.mjs" "$TARGET" "$SUPPORT"
else
  printf '  HOME SESSION: %s\n\n' "$SESSION"
  printf '  %s %s apply %s --support-root %s --home-session %s\n\n' \
    "$(command -v node)" "$REPO/scripts/aukora/desktop-cutover.mjs" "$TARGET" "$SUPPORT" "$SESSION"
fi
printf 'Run it with the app QUIT, from a shell that is not the app'\''s own descendant, and roll back with:\n\n'
printf '  %s %s rollback --support-root %s\n' "$(command -v node)" "$REPO/scripts/aukora/desktop-cutover.mjs" "$SUPPORT"
