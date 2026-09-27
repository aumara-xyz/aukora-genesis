#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# setup-owner.sh — THE TWO-UID OWNER CUT, IN TWO PHASES, BECAUSE ROOT MUST NEVER RUN AGENT CODE.
#
# THE GOVERNING PRINCIPLE (Codex's review, 2026-09-25, and it is the reason this file looks like this):
#
#   NO AGENT-WRITABLE CODE EVER RUNS AS ROOT.
#
# Everything that reads, computes or interprets agent-authored bytes — this repository, its tools, its
# interpreter, its module graph — runs UNPRIVILEGED, as Peter, in PHASE A. That phase produces ONE
# artifact: an immutable bundle whose every file carries a sha256 in a manifest, and whose manifest has a
# single BUNDLE DIGEST. Phase A changes nothing on the system and needs no privilege at all.
#
# PHASE B is what sudo runs. It receives the bundle, the digest and the reviewed commit as ARGUMENTS,
# re-execs itself under a controlled environment with an absolute PATH, and uses ONLY trusted system
# tools BY ABSOLUTE PATH (/bin/sh, /bin/cp, /usr/bin/shasum, /usr/sbin/chown, /bin/chmod, /usr/bin/stat,
# /usr/bin/dscl, /bin/launchctl, /usr/bin/plutil, /usr/bin/otool). It copies the bundle into a fresh
# root-owned staging directory, verifies EVERY file against the manifest, refuses any file the manifest
# does not list, and only then moves the tree into place. The interpreter is downloaded from nodejs.org in
# Phase A, verified against the payload's pinned official digest list, extracted and RUN UNPRIVILEGED there
# (so a broken build is found as Peter, not by launchd); Phase B executes it again only AFTER it is
# root-owned in place, and only to re-check the version recorded in the bundle.
#
#   PETER RUNS, IN THIS ORDER, AND NOTHING ELSE:
#     /bin/sh scripts/owner/setup-owner.sh --from . --bundle-dir ~/aukora-bundles            # PHASE A
#     <the STAGED COPY of this file, as root>                                               # PHASE B
#
#   *** PHASE B IS NOT `sudo /bin/sh scripts/owner/setup-owner.sh`. *** This header used to print exactly that,
#   and IT CONTRADICTED THE REST OF THE FILE: the refusal at Phase B says in full that the supported way is
#   INSTALL.md 1b -- paste the block into `sudo env -i PATH=... /bin/bash`, which copies THIS script and the
#   bundle into a fresh ROOT-OWNED 0700 STAGING DIRECTORY, compares both digests THERE, AND EXECUTES ONLY THE
#   STAGED COPY. `:551` even says "THERE IS DELIBERATELY NO READY-TO-PASTE sudo LINE PRINTED HERE".
#   SO THE HEADER WAS THE ONE PLACE STILL TELLING A READER TO RUN ROOT CODE OUT OF A CHECKOUT THE AGENT CAN
#   WRITE, AND A HEADER IS WHAT A READER BELIEVES FIRST.
#   Phase A prints the last command with every value filled in, and it prints the digest of THIS FILE as
#   Phase B will see it. Compare that digest with the reviewed commit's copy before you run anything as root.
#
#   THE CEILING THIS DESIGN DOES NOT REMOVE, STATED RATHER THAN IMPLIED: the script you sudo is read from
#   a checkout the agent can write, and the bundle lives in a directory the agent can write. The digest
#   arguments are what make that safe — they are YOUR confirmation, taken from the reviewed revision.
#   An argument this script defaulted would confirm nothing, so all four are REQUIRED in Phase B.
#   And this file is honest about the largest limit of all: this isolates the unprivileged agent process
#   through filesystem permissions. Peter remains an administrator and can become root using sudo. Any
#   agent process with usable sudo authority can cross this boundary. Shell-console approval is not
#   independent proof of human consent.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
set -u

# ── identity and paths ─────────────────────────────────────────────────────────────────────────────
OWNER_USER="aukora-owner"; SUBMIT_GROUP="aukora-submit"
OWNER_DIR="/Library/Application Support/AUKORA-Owner"
RUN_ROOT="/Library/Application Support/AUKORA-Run"
APPROVE_DIR="$RUN_ROOT/owner"
LIBEXEC="/usr/local/libexec/aukora-owner"
CONFIG="/usr/local/etc/aukora-owner.json"
PLIST="/Library/LaunchDaemons/com.aukora.owner.plist"
LABEL="com.aukora.owner"
ENTRY="plugins/aukora-owner-daemon/bin/owner-daemon.mjs"
CONSOLE="plugins/aukora-owner-daemon/bin/owner-console.mjs"
MARKER="INSTALL-MARKER"            # root-owned record of what THIS install created; teardown obeys it
# ── THE CREATION LEDGER ───────────────────────────────────────────────────────────────────────────────
# *** THE MARKER CLAIMED CREATION IT HAD NOT DONE, WHICH IS CODEX r5's BLOCKING FINDING. *** It wrote
# `createdGroup=` and `createdUser=` UNCONDITIONALLY, but `provision_accounts` REUSES a group or user that
# already exists (`:907`, `:928`, `:943` all say so in their own words) -- SO TEARDOWN COULD DELETE A
# PRINCIPAL THIS INSTALL NEVER MADE. On a machine where `aukora-owner` already existed, uninstalling the
# installer would remove an account somebody else created, and the marker SAID IT WAS OURS.
#
# THE LEDGER REPLACES A CLAIM WITH A RECORD KEPT AS THE THING HAPPENS. Every line is one resource, written at
# the moment of its creation by the branch that created it -- so a REUSED resource is recorded as reused, and
# teardown removes ONLY what a `created` line proves. A record written at the end can only describe what the
# author REMEMBERED; a record written at the moment cannot describe what did not happen.
LEDGER="INSTALL-LEDGER"
LEDGER_ROWS=0
ledger_init() {
  # CREATED EMPTY AND LOCKED DOWN BEFORE ANY RESOURCE EXISTS, so a crash mid-install leaves a partial ledger
  # rather than none: a partial ledger is honest (it names what was made) where a missing one is not.
  #
  # *** BUT "EMPTY" MUST NOT MEAN "FORGET WHAT THIS INSTALL ALREADY MADE" (Codex r6 finding 4). *** `: > "$LEDGER_T"`
  # TRUNCATES, SO ON `--replace` THE PREVIOUS LEDGER'S ROWS WERE DESTROYED. The re-run then finds the accounts and
  # directories it made LAST TIME, records them as `reused` -- correctly, since it did not create them THIS time --
  # AND TEARDOWN LOSES THE EVIDENCE THAT THIS INSTALL MADE THEM AT ALL. The result would be an uninstall that
  # leaves behind every principal and every directory the install ever created, WHILE REPORTING THAT IT HAD
  # DECIDED THEY WERE NOT ITS OWN. **AN UNINSTALL THAT SILENTLY KEEPS EVERYTHING IS A WORSE FAILURE THAN ONE THAT
  # DELETES TOO MUCH, BECAUSE NOTHING LOOKS WRONG.**
  #
  # THE LEDGER'S QUESTION IS "DID *THIS INSTALL* MAKE THIS", AND A REPLACE IS THE SAME INSTALL CONTINUING.
  # So the prior `created` rows are CARRIED FORWARD, verbatim, above the new ones. They are not re-derived and not
  # re-checked against the live system: they are a historical record, and rewriting history on every replace is
  # what produced this defect.
  #
  # `reused` ROWS ARE NOT CARRIED: they say "this was here before me", which a later replace can only confirm or
  # contradict, and they authorise nothing.
  if [ "${REPLACE:-0}" = "1" ] && [ -f "$LEDGER_T" ]; then
    local prior
    prior="$("$AWK" -F'\t' '$1=="created"' "$LEDGER_T" 2>/dev/null)" || prior=""
    if [ -n "$prior" ]; then
      say "  REPLACE: carrying forward $(printf '%s\n' "$prior" | "$GREP" -c .) prior created row(s) — a replace is"
      say "    the same install continuing, and these name resources TEARDOWN WOULD OTHERWISE NEVER REMOVE."
    fi
    : > "$LEDGER_T" || refuse "cannot create the ledger at $LEDGER_T"
    if [ -n "$prior" ]; then
      printf '%s\n' "$prior" >> "$LEDGER_T" || refuse "cannot carry the prior created rows forward into $LEDGER_T"
      LEDGER_ROWS="$(printf '%s\n' "$prior" | "$GREP" -c .)"
    fi
  else
    : > "$LEDGER_T" || refuse "cannot create the ledger at $LEDGER_T"
  fi
  "$CHOWN" root:wheel "$LEDGER_T" 2>/dev/null || true
  "$CHMOD" 0600 "$LEDGER_T" || refuse "cannot set the ledger to 0600"
}
# $1 = kind (group|user|directory|plist|config|tree), $2 = name or path, $3 = evidence
ledger_record() {
  printf 'created\t%s\t%s\t%s\n' "$1" "$2" "$3" >> "$LEDGER_T" \
    || refuse "cannot record the created $1 $2 in the ledger — AN UNRECORDED CREATION IS ONE TEARDOWN CANNOT UNDO, and continuing would leave a resource nothing owns"
  LEDGER_ROWS=$((LEDGER_ROWS + 1))
}
ledger_reuse() {
  # REUSED IS RECORDED TOO, AND THAT IS NOT BOOKKEEPING FOR ITS OWN SAKE: a reader asking "did this install
  # touch the group aukora-submit" gets an answer either way, and teardown can say WHY it is preserving it
  # rather than leaving an operator to guess whether the marker simply forgot.
  printf 'reused\t%s\t%s\n' "$1" "$2" >> "$LEDGER_T" 2>/dev/null || true
}
# /private/var/root, NOT /var/root: MEASURED 2026-09-25, /var is a symlink to /private/var, and this
# script's ancestor check REFUSES a symlinked component rather than resolving it away. /private/var/root
# is a real directory, root:wheel 0700.
STAGE_PARENT="/private/var/root"   # root-owned parent for the trusted staging directory

# ══ ITEM 5: THE SELF-HASH RUNS BEFORE ANYTHING ELSE IN THIS FILE, AND IT USES NOTHING FROM BELOW. ══════
#
# *** THE HASH COVERED THE WHOLE FILE, BUT IT WAS CHECKED AT STEP 1 OF `deploy` -- AFTER THE SHELL HAD ALREADY
# PARSED AND EXECUTED EVERY LINE ABOVE IT. *** So a tampered copy had its EARLY LINES RUN before the digest that
# would have caught them was ever computed. The check detected the edit and could not undo its effect: BY THE
# TIME IT RAN, THE CODE IT WAS SUPPOSED TO VOUCH FOR HAD ALREADY EXECUTED. A HASH CHECK IS ONLY A GUARD IF IT
# HAPPENS BEFORE THE THING IT GUARDS.
#
# AND IT CANNOT USE ANYTHING DEFINED BELOW -- `$SHASUM`, `$AWK`, `say`, `refuse` AND THE PARSED ARGUMENTS ARE
# ALL LATER IN THE FILE, SO DEPENDING ON THEM WOULD PUT THE CHECK BACK AFTER CODE THAT COULD BE TAMPERED WITH.
# Everything here is a literal path, and `--script-sha256` is read straight out of `$@`.
#
# IT APPLIES ONLY WHEN THE FLAG IS PRESENT, WHICH IS EXACTLY PHASE B's CASE: Phase B REQUIRES it (`:606`), so a
# root deployment always carries it; Phase A prints the digest and passes no such flag, and a copy running
# unprivileged has no root to protect from. THE LATER CHECK AT STEP 1 STAYS, because it re-measures `$0` AFTER
# the staging copy has been confirmed in place and the two are not redundant: this one stops a tampered file
# from acting, that one proves the file root is about to trust is the one the operator confirmed.
__early_script_sha=""
__early_arg_prev=""
for __early_arg in "$@"; do
  if [ "$__early_arg_prev" = "--script-sha256" ]; then __early_script_sha="$__early_arg"; fi
  __early_arg_prev="$__early_arg"
done
if [ -n "$__early_script_sha" ]; then
  __early_actual="$(/usr/bin/shasum -a 256 "$0" 2>/dev/null | /usr/bin/awk '{print $1}')"
  if [ "$__early_actual" != "$__early_script_sha" ]; then
    printf '\nREFUSED: THIS FILE DOES NOT MATCH THE DIGEST YOU NAMED, AND IT REFUSES BEFORE RUNNING ANY OF ITSELF.\n' >&2
    printf '  named  : %s\n' "$__early_script_sha" >&2
    printf '  measured: %s\n' "${__early_actual:-<unreadable>}" >&2
    printf '  file   : %s\n' "$0" >&2
    printf '  NOTHING IN THIS FILE HAS EXECUTED. Take the commit and the digest from the CI log line, never from\n' >&2
    printf '  a checkout the agent can write.\n' >&2
    exit 2
  fi
fi
unset __early_script_sha __early_arg __early_arg_prev __early_actual

# ── trusted tools, BY ABSOLUTE PATH (Phase B uses nothing else) ────────────────────────────────────
SH=/bin/sh; CP=/bin/cp; MV=/bin/mv; RM=/bin/rm; MKDIR=/bin/mkdir; CHMOD=/bin/chmod
LS=/bin/ls; CAT=/bin/cat; ENV=/usr/bin/env; DIFF=/usr/bin/diff; TOUCH=/usr/bin/touch
SHASUM=/usr/bin/shasum; STAT=/usr/bin/stat; CHOWN=/usr/sbin/chown; ID=/usr/bin/id
TAR=/usr/bin/tar
MKTEMP=/usr/bin/mktemp; FIND=/usr/bin/find; AWK=/usr/bin/awk; SED=/usr/bin/sed
GREP=/usr/bin/grep; TR=/usr/bin/tr; WC=/usr/bin/wc; CUT=/usr/bin/cut
DSCL=/usr/bin/dscl; DSEDITGROUP=/usr/sbin/dseditgroup
LAUNCHCTL=/bin/launchctl; PLUTIL=/usr/bin/plutil; OTOOL=/usr/bin/otool; SUDO=/usr/bin/sudo
NODE_BIN=/usr/local/libexec/aukora-owner/bin/node

# ── arguments ──────────────────────────────────────────────────────────────────────────────────────
FROM="$(cd "$(dirname "$0")/../.." && pwd)"; SHA=""; BUNDLE=""; BUNDLE_DIR=""; BUNDLE_DIGEST=""
SCRIPT_SHA=""; PREFIX=""; EXPECT_NODE_SHA=""; VERIFY_SHALIST=1; REPLACE=0; PHASE_B_EXPLICIT=0; AGENT_USER=""; AGENT_UID=""; OWNER_GID=""
NODE_PIN_ARG=""; PIN_FILE="scripts/owner/NODE-PIN"; SHASUMS_FILE=""; SHASUMS_SOURCE=""
while [ $# -gt 0 ]; do case "$1" in
  --from) FROM="${2:?--from needs a path}"; shift 2;;
  --sha) SHA="${2:?--sha needs a commit}"; shift 2;;
  --bundle) BUNDLE="${2:?--bundle needs a directory}"; shift 2;;
  --bundle-dir) BUNDLE_DIR="${2:?--bundle-dir needs a directory}"; shift 2;;
  --bundle-digest) BUNDLE_DIGEST="${2:?--bundle-digest needs a hex digest}"; shift 2;;
  --script-sha256) SCRIPT_SHA="${2:?--script-sha256 needs a hex digest}"; shift 2;;
  --prefix) PREFIX="${2:?--prefix needs a directory}"; shift 2;;
  --agent-user) AGENT_USER="${2:?--agent-user needs a user name}"; shift 2;;
  --expect-node-sha256) EXPECT_NODE_SHA="${2:?}"; shift 2;;
  --node-version) NODE_PIN_ARG="${2:?}"; shift 2;;
  --shasums) SHASUMS_FILE="${2:?--shasums needs a file}"; shift 2;;
  --no-verify-shalist) VERIFY_SHALIST=0; shift;;
  --replace) REPLACE=1; shift;;
  phase-b) PHASE_B_EXPLICIT=1; shift;;   # the word the bootstrap uses; Phase B is still chosen by --bundle
  -h|--help) "$SED" -n '2,40p' "$0"; exit 0;;
  *) printf 'REFUSED: unknown option %s\n' "$1" >&2; exit 2;;
esac; done

# ── the two output verbs, and THE CHECK VERBS (Codex item 3: no checkmark without an expected result) ─
say()    { printf '%s\n' "$*"; }
note()   { printf '  %s\n' "$*"; }
refuse() { printf '\nREFUSED: %s\n' "$*" >&2; exit 2; }

sha256_of() { "$SHASUM" -a 256 "$1" | "$AWK" '{print $1}'; }
byte_size_of() { "$WC" -c < "$1" | "$TR" -d ' '; }
# ── THE OCTAL PERMISSION BITS, AND THE DIRECTIVE THAT DOES NOT RETURN THEM ──────────────────────────
# MEASURED 2026-09-25 on this Mac: `stat -f '%Mp'` prints '0' for EVERY path — a 0700 directory, a 0600
# file, /private/tmp with its sticky bit, all of them — while `%Lp` prints 700, 600, 1777 and `%p` prints
# the mode with its file type. `%Mp` is not a BSD stat directive, and the cost was TWO wrong answers from
# one instrument: check_ancestors cut characters 2 and 3 out of '0', got nothing, and therefore REFUSED
# NOBODY (a g+w ancestor passed as if it were 0755), while the three mode checks in checks() compared a
# correct install against '0' and would have refused it. A measurement that cannot return the value is not
# a weak check, it is a check that answers the wrong question confidently.
mode_of() {
  case "$(/usr/bin/uname -s)" in
    Darwin) "$STAT" -f '%Lp' "$1";;
    *) "$STAT" -c '%a' "$1";;
  esac
}
# uid_of <path> — the OWNER uid, in the same per-platform shape as mode_of. check_ancestors reads this for the
# real prefix; it is used again below to recognise this install's OWN leaves on a re-run.
uid_of() {
  case "$(/usr/bin/uname -s)" in
    Darwin) "$STAT" -f '%u' "$1" 2>/dev/null || printf '?';;
    *) "$STAT" -c '%u' "$1" 2>/dev/null || printf '?';;
  esac
}

# expect_exact <what> <expected> <cmd...> — the command must EXIT ZERO *and* print exactly <expected>.
# The previous version printed a checkmark for any nonempty output, so a tool that failed and printed an
# error to stderr was reported as verification. Errors are not results.
expect_exact() {
  local what="$1" want="$2" got; shift 2
  if ! got="$("$@" 2>&1)"; then refuse "$what: the CHECK ITSELF FAILED (exit $?): $got"; fi
  [ "$got" = "$want" ] || refuse "$what: expected '$want', MEASURED '$got'"
  say "    ok  $what = $got"
}
# expect_nonempty <what> <cmd...> — zero exit required; the value is printed, never asserted as safety.
expect_nonempty() {
  local what="$1" got; shift
  if ! got="$("$@" 2>&1)"; then refuse "$what: the CHECK ITSELF FAILED (exit $?): $got"; fi
  [ -n "$got" ] || refuse "$what: the command succeeded and printed NOTHING, which is not a result"
  say "    ok  $what: $got"
}
# expect_refused <what> <cmd...> — a NEGATIVE expectation, checked explicitly rather than assumed.
expect_refused() {
  local what="$1" got; shift
  if got="$("$@" 2>&1)"; then refuse "$what: this MUST be refused, but it exited 0: $got"; fi
  say "    ok  $what: refused as required"
}
# ── NO SYMLINKS, NO SPECIAL FILES, ANYWHERE IN A TREE THAT IS ABOUT TO BE TRUSTED ───────────────────
# `cp -R` on macOS PRESERVES symlinks, so "we copied it and hashed it" says nothing about what it is: the
# hash follows the link to whatever it points at. find without -L does not follow them, so this lists every
# entry that is neither a directory nor a regular file — symlink, socket, fifo, device — and refuses.
reject_nonregular() {
  local what="$1" tree="$2" bad rc=0
  # FIND'S OWN FAILURE MUST NOT READ AS "NOTHING FOUND". This was `... 2>/dev/null || true`, so a find
  # that could not read the tree — a directory it lacks permission for, a path that is not there — printed
  # nothing and exited non-zero, and the check returned as if the tree were clean. The one input that
  # means "I could not look" was the one input that failed OPEN, in the check that exists to refuse
  # symlinks and sockets before anything is hashed or installed.
  # STDERR IS MERGED RATHER THAN SENT TO A TEMPORARY FILE: this script's own test harness stubs mktemp,
  # and its stub creates a DIRECTORY (measured: the staged-tree arm refused with `Is a directory` and a
  # find that never ran). On failure the merged text is find's own words; on success any stray diagnostic
  # would land in the entries list below, which is the safe direction for this check — it refuses and
  # prints what it saw.
  bad="$("$FIND" "$tree" ! -type d ! -type f -print 2>&1)" || rc=$?
  if [ "$rc" != "0" ]; then
    refuse "$what could not be scanned for non-regular entries: find exited $rc on $tree, so NOTHING is proven about the bytes this install would hash and copy. find said: ${bad:-nothing}"
  fi
  [ -z "$bad" ] || refuse "$what holds entries that are neither directories nor regular files. Hashing them would follow whatever they point at, and installing them would install the link:
$bad"
}

# ── path ancestors: ACLs, symlinks, group/world write — CHECKED BEFORE ANY WRITE ───────────────────
# Prints the first problem and returns 1; prints nothing and returns 0 when every EXISTING component of
# the path is root-owned, not group/world writable, carries no write ACL, and is not a symlink.
# A component that does not exist yet is skipped BY NAME: it is the parent that decides whether it can be
# created, and that parent is checked on the same walk.
# SYMLINK COMPONENTS ARE REFUSED, NOT RESOLVED AWAY (Codex item 4): resolving them would check the
# target's ancestors while the install writes through a link whose owner is someone else.
check_ancestors() {
  local p="$1" rest prefix comp kind uid oct grp wld acl
  case "$p" in /*) ;; *) printf '%s is not an absolute path\n' "$p"; return 1;; esac
  rest="${p#/}"; prefix=""
  while [ -n "$rest" ]; do
    comp="${rest%%/*}"
    if [ "$comp" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    prefix="$prefix/$comp"
    [ -e "$prefix" ] || continue
    kind="$("$STAT" -f '%HT' "$prefix" 2>/dev/null || printf 'MISSING')"
    [ "$kind" = "Symbolic Link" ] && { printf '%s IS A SYMLINK — a component this install would write through; replace it with a real directory\n' "$prefix"; return 1; }
    uid="$("$STAT" -f '%u' "$prefix" 2>/dev/null || printf '?')"
    [ "$uid" = "0" ] || { printf '%s is owned by uid %s, not root — whoever owns it can rename or replace what is installed under it\n' "$prefix" "$uid"; return 1; }
    oct="$(mode_of "$prefix" 2>/dev/null || printf '000')"
    grp="$(printf '%s' "$oct" | "$CUT" -c2)"; wld="$(printf '%s' "$oct" | "$CUT" -c3)"
    case "$grp$wld" in
      *2*|*3*|*6*|*7*) printf '%s is %s (group/world writable) — on macOS /usr/local is often root:admin 0775, and Peter is an admin, so an agent process can write there. FIX: sudo chmod g-w %s (or install under a root-owned 0755 path). This install refuses to place root-owned code beneath a directory the agent can write.\n' "$prefix" "$oct" "$prefix"; return 1;;
    esac
# ── read_acl <path> — the ACEs on <path>, OR A REFUSAL. NEVER AN EMPTY LIST ON A FAILED READ. ─────────────
#
# *** THE FAIL-OPEN THIS REPLACES, AND IT WAS IN THREE PLACES: ***
#     ACL_OUT="$ACL_TMP"; read_acl_write "$prefix"; acl="$(cat "$ACL_TMP")"
# THE `|| true` SWALLOWED A FAILED `ls`, SO `acl` BECAME EMPTY -- AND AN EMPTY ACL LIST IS EXACTLY WHAT "THIS
# PATH HAS NO DANGEROUS ACEs" LOOKS LIKE. A CHECK THAT CANNOT READ THE THING IT CHECKS MUST NOT REPORT THE SAFE
# ANSWER, and `2>/dev/null` made it worse by discarding the reason. SAME DEFECT CLASS AS THE GATE THAT PRINTED
# "a skipped check is not a pass" AND THEN WROTE A STAMP.
#
# AUMLOK 60d4589d8 HAS THE CORRECT SHAPE AND THIS MATCHES IT:
#   * a failed read REFUSES -- "a failed read is not an absence of ACEs";
#   * THE PLATFORM IS EXPLICIT: `ls -led` on macOS, `getfacl` on Linux, because `-e` IS A macOS OPTION AND GNU
#     `ls` REJECTS IT. That commit exists because the boundary could not read ACLs on Linux AT ALL, and the
#     refusal was honest while the reader was simply missing;
#   * A PLATFORM NOBODY WROTE A READER FOR IS REFUSED BY NAME -- returning empty would certify every path on a
#     platform whose ACLs this script has never looked at.
#
# THE OUTPUT IS ONE ACE PER LINE on stdout. On success the exit status is 0 AND stdout MAY LEGITIMATELY BE EMPTY
# (a path with no ACEs); on any failure it REFUSES rather than returning.
# *** `read_acl` WRITES TO A FILE AND IS CALLED WITHOUT A COMMAND SUBSTITUTION (Codex r6, WORST FINDING). ***
# It used to be `ACL_OUT="$ACL_TMP"; read_acl_write "$prefix"; acl="$(cat "$ACL_TMP")"`, AND `refuse` INSIDE A SUBSTITUTION EXITS ONLY THE SUBSHELL: the
# caller carried on with an EMPTY `acl`, AND AN EMPTY ACL LIST IS EXACTLY WHAT "THIS PATH HAS NO DANGEROUS ACEs"
# LOOKS LIKE. The message "REFUSED: cannot read the ACL" WAS PRINTED AND DID NOT STOP ANYTHING.
# *** THIS IS THE SAME DEFECT I FIXED IN THE GATE'S `resolve_pinned`, INTRODUCED AGAIN BY ME TWO ITEMS LATER. ***
# Knowing the pattern did not prevent it; the court that would have caught it did not exist.
# SO THE CONTRACT CHANGED: `read_acl <path>` WRITES THE ACEs TO `$ACL_OUT` AND RETURNS 0, OR REFUSES THE WHOLE
# SCRIPT. It is never called in a substitution, so its `refuse` is the caller's refusal.
ACL_OUT="${ACL_OUT:-}"
read_acl_write() {
  local path="$1"
  [ -n "$ACL_OUT" ] || refuse "read_acl_write called with no ACL_OUT: the caller would have no way to see the ACEs and would read an empty list as \"no ACLs\""
  : > "$ACL_OUT" || refuse "cannot truncate the ACL scratch file $ACL_OUT"
  local raw
  case "$ACL_READER" in
    Darwin)
      raw="$("$LS" -led "$path" 2>&1)" || refuse "cannot read the ACL on $path with 'ls -led': $(printf '%s' "$raw" | head -1). A FAILED READ IS NOT AN ABSENCE OF ACEs, so this is a refusal and not an empty list"
      printf '%s\n' "$raw" | "$GREP" -E '^ *[0-9]+: ' > "$ACL_OUT" || true
      ;;
    *)
      # THE LINUX BRANCH AND THE UNSUPPORTED-PLATFORM REFUSAL LIVE IN `read_acl` BELOW; THIS DELEGATES SO THERE
      # IS ONE READER AND NOT TWO THAT CAN DISAGREE.
      read_acl "$path" > "$ACL_OUT" || return 1
      ;;
  esac
}
ACL_READER="${AUKORA_ACL_READER:-$(uname -s)}"
# THE SCRATCH FILE `read_acl_write` FILLS. It is created once, lazily, because a script that never reads an ACL
# should not create a file at all -- and it is under TMPDIR rather than beside anything the install owns.
ACL_TMP="${ACL_TMP:-${TMPDIR:-/tmp}/aukora-acl-$$.txt}"
read_acl() {
  local path="$1" raw
  case "$ACL_READER" in
    Darwin)
      # `ls -led` is the only portable way to see ACEs on macOS, and -d matters: without it `ls -le` lists the
      # CONTENTS and the directory's own ACL is never the thing inspected.
      raw="$("$LS" -led "$path" 2>&1)" || refuse "cannot read the ACL on $path with 'ls -led': $(printf '%s' "$raw" | head -1). A FAILED READ IS NOT AN ABSENCE OF ACEs, so this is a refusal and not an empty list"
      printf '%s\n' "$raw" | "$GREP" -E '^ *[0-9]+: ' || true
      ;;
    Linux)
      command -v getfacl >/dev/null 2>&1 || refuse "cannot read the ACL on $path: this is Linux and 'getfacl' is not installed. INSTALL acl, OR THE ACL CHECK CANNOT RUN — an unread ACL is not an absent one"
      raw="$(getfacl -p -c "$path" 2>&1)" || refuse "cannot read the ACL on $path with 'getfacl': $(printf '%s' "$raw" | head -1). A FAILED READ IS NOT AN ABSENCE OF ACEs"
      # TRANSLATED INTO THE SAME SHAPE macOS PRODUCES, because two formats would mean two parsers and two places
      # for the platforms to disagree. ONLY NAMED user:/group: ENTRIES AND THE MASK ARE EXTENDED ACEs: `user::`,
      # `group::` and `other::` RESTATE THE MODE, which is checked on its own, so emitting them would report the
      # file's ordinary permissions as ACL grants and refuse every path on the platform.
      printf '%s\n' "$raw" | "$AWK" '
        /^#/ { next }
        /^(user|group|mask|other):/ {
          # *** THE PERMISSION IS `k[3]`, NOT `$2`. *** WITH THE DEFAULT SEPARATOR THE WHOLE LINE IS `$1`, so
          # `perm=$2` was EMPTY and every ACE came out as `allow none` -- AN ACL READER THAT REPORTS NO RIGHTS
          # ON EVERY ENTRY IS A READER THAT FINDS NOTHING DANGEROUS. `split` on `:` gives kind, name and rights.
          split($1, k, ":"); kind=k[1]; name=k[2]; perm=k[3]
          if (kind == "other") next
          if (kind != "mask" && name == "") next
          p = ""
          if (perm ~ /r/) p = p "r"
          if (perm ~ /w/) p = p "w"
          printf "%d: %s:%s allow %s\n", ++n, kind, (name == "" ? "mask" : name), (p == "" ? "none" : p)
        }'
      ;;
    *)
      refuse "there is no ACL reader for '$ACL_READER' in this script, so it cannot certify $path. ADD A READER rather than assuming the platform has no ACLs — an empty list here would certify every path on a platform these ACLs have never been read from"
      ;;
  esac
}

    ACL_OUT="$ACL_TMP"; read_acl_write "$prefix"; acl="$(cat "$ACL_TMP")"
    if [ -n "$acl" ]; then
      # ANY ALLOW ACE, NOT THE WORD "write" (Codex r4, blocker F): an ACE granting delete_child, add_file,
      # add_subdirectory, append, writeattr, writeextattr, writesecurity or chown is mutation authority over
      # this component, and every one of them was invisible to a check that searched for "write" alone.
      printf '%s\n' "$acl" | "$GREP" -q ' allow ' && { printf '%s carries an ACL that ALLOWS a non-root principal (%s) — authority to add, rename, delete or replace what is below it, which the mode bits do not show\n' "$prefix" "$acl"; return 1; }
    fi
  done
  return 0
}

# The bundle's manifest is the only list of what may be installed. Print the paths it names, sorted.
manifest_paths() { "$AWK" '{print $2}' "$1" | LC_ALL=C "$SED" -e 's|^\./||' | LC_ALL=C /usr/bin/sort; }

# ── PHASE A — UNPRIVILEGED. Builds the bundle. Runs the checkout's own tooling, as Peter. ───────────
phase_a() {
  [ "$("$ID" -u)" != "0" ] || refuse "PHASE A MUST NOT RUN AS ROOT. It runs the checkout's closure tool and the PATH interpreter; that is exactly the code root must never execute. Run it as Peter (no sudo), then run Phase B with the digest it prints."
  command -v git >/dev/null 2>&1 || refuse "git is not on PATH; Phase A reads the reviewed revision from the checkout"
  command -v node >/dev/null 2>&1 || refuse "no node on PATH; Phase A needs the interpreter to COPY (it is never run as root)"
  [ -d "$FROM/.git" ] || [ -f "$FROM/.git" ] || refuse "$FROM is not a git checkout, so the bundle cannot be bound to a reviewed commit"

  say "PHASE A — building the bundle, unprivileged, changing nothing on this system"
  local HEAD_SHA; HEAD_SHA="$(git -C "$FROM" rev-parse HEAD)" || refuse "cannot read HEAD of $FROM"
  local dirty; dirty="$(git -C "$FROM" status --porcelain)"
  # A DIRTY TREE IS NOT THE REVIEWED COMMIT. The bundle's whole claim is that it is those bytes.
  [ -z "$dirty" ] || refuse "the checkout at $FROM is DIRTY, so its bytes are not commit $HEAD_SHA. Phase A builds the reviewed revision or nothing. First entry: $(printf '%s' "$dirty" | "$SED" -n 1p)"
  [ -n "$SHA" ] || SHA="$HEAD_SHA"
  [ "$SHA" = "$HEAD_SHA" ] || refuse "--sha $SHA is not this checkout's HEAD ($HEAD_SHA); check out the reviewed revision or drop --sha"
  say "  reviewed revision: $SHA (clean tree, so these are that commit's bytes)"

  # ── the interpreter: the PATH node runs the CHECKOUT'S TOOLING; the INSTALLED interpreter is the
  #    official build for this platform, downloaded, verified against the payload's digest list, cached ──
  local NODE_SRC NODE_REAL NODE_SHA NODE_VERSION SHASUMS_TMP PATH_NODE_SHA
  SHASUMS_TMP="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/aukora-shasums.XXXXXX")" || refuse "cannot make a scratch file for the pinned digest list"
  NODE_SRC="$(command -v node)"; NODE_REAL="$(cd "$(dirname "$NODE_SRC")" && pwd)/$(basename "$NODE_SRC")"
  [ -f "$NODE_REAL" ] || refuse "node resolves to $NODE_REAL, which is not a file"
  PATH_NODE_SHA="$(sha256_of "$NODE_REAL")"
  # Executed HERE, as Peter: an unprivileged user running their own interpreter is not the risk this
  # design removes. This binary is a TOOLCHAIN, not the installed interpreter — it runs the closure tool
  # and is then put down. What gets installed is the official build fetched and verified below, because a
  # daemon run as $OWNER_USER on the builder's PATH node would be running a file whoever owns that
  # directory can rewrite, with owner privileges.
  NODE_VERSION="$("$NODE_REAL" --version 2>/dev/null)" || refuse "$NODE_REAL does not run"
  [ -n "$NODE_VERSION" ] || refuse "$NODE_REAL printed no version"
  # THE VERSION IS PINNED IN THE REPO, so the same commit built on two machines pins the same interpreter
  # and its digest is comparable. A bundle that records whatever node happened to be on PATH is not
  # reproducible, and an unreproducible digest is not something Peter can check against a builder.
  local PINNED=""
  [ -f "$FROM/$PIN_FILE" ] && PINNED="$(/usr/bin/tr -d ' \n' < "$FROM/$PIN_FILE")"
  [ -n "$NODE_PIN_ARG" ] && PINNED="$NODE_PIN_ARG"
  [ -n "$PINNED" ] || refuse "no pinned interpreter version: $FROM/$PIN_FILE is missing or empty and --node-version was not given. A bundle that records whatever node was on PATH is not reproducible."
  [ "$NODE_VERSION" = "$PINNED" ] || refuse "the interpreter on PATH is $NODE_VERSION and the pin is $PINNED. Install $PINNED, or pass --node-version $NODE_VERSION deliberately — which changes the pin for everyone who builds this commit."
  say "  toolchain       : $NODE_REAL ($NODE_VERSION, sha256 ${PATH_NODE_SHA})"
  say "                    owner $("$LS" -ld "$NODE_REAL" | "$AWK" '{print $3":"$4}') — runs the closure tool AS YOU, then is never used again"
  say "                    NOT the installed interpreter: that is the pinned OFFICIAL build, below"
  # ── THE OFFICIAL DIGEST LIST IS PART OF THE PAYLOAD, AND THE LOCAL BINARY'S OWN DIGEST IS NOT ──
  # REPRODUCIBILITY DEPENDS ON THIS EXACTLY: sha256(bin/node) differs between darwin-arm64 and linux-x64,
  # so putting that number in the payload would make the CI builder and this Mac print different BUNDLE
  # DIGESTS for the same commit — which would defeat the entire point of round 2. What goes INSIDE is
  # nodejs.org's SHASUMS256.txt for the pinned version: one file, byte-identical everywhere, listing every
  # platform. The local binary's digest goes into build-info.txt, OUTSIDE the digest, as a build input.
  [ "$VERIFY_SHALIST" = "1" ] || refuse "--no-verify-shalist is NOT accepted: the official digest list is part of the payload and the interpreter is verified against it on whatever platform installs the bundle. For an offline build pass --shasums <file> whose provenance you can name."
  if [ -n "$SHASUMS_FILE" ]; then
    [ -f "$SHASUMS_FILE" ] || refuse "--shasums $SHASUMS_FILE does not exist"
    "$CP" "$SHASUMS_FILE" "$SHASUMS_TMP" || refuse "cannot copy the digest list"
    SHASUMS_SOURCE="$SHASUMS_FILE (given by the caller)"
  else
    say "               fetching nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    /usr/bin/curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$SHASUMS_TMP" \
      || refuse "could not fetch the official digest list for $NODE_VERSION. It is part of the payload because the interpreter is verified against it on whatever platform installs this bundle; pass --shasums <file> from a reviewer for an offline build and record that provenance."
    SHASUMS_SOURCE="https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  fi
  local ARCH NA TARBALL TARBALL_URL TARBALL_SHA CACHE_DIR CACHE_FILE TARBALL_BYTES GOT
  case "$(/usr/bin/uname -s):$(/usr/bin/uname -m)" in
    Darwin:arm64) ARCH_NA=darwin-arm64;; Darwin:x86_64) ARCH_NA=darwin-x64;;
    Linux:x86_64) ARCH_NA=linux-x64;; Linux:aarch64) ARCH_NA=linux-arm64;; *) ARCH_NA="";;
  esac
  NA="$ARCH_NA"
  [ -n "$NA" ] || refuse "cannot name the official node build for $(/usr/bin/uname -s)/$(/usr/bin/uname -m); this host cannot install a verified interpreter"
  TARBALL="node-$NODE_VERSION-$NA.tar.gz"
  TARBALL_URL="https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
  # THE PINNED OFFICIAL LIST IS THE AUTHORITY, AND THE ARCHIVE IS VERIFIED AGAINST IT BEFORE ANYTHING IS
  # EXTRACTED FROM IT. Fail-closed: an entry that is missing refuses rather than skipping the check.
  # NOTE WHAT IS COMPARED, because an earlier revision of this file got it wrong: SHASUMS256.txt lists the
  # TARBALL, never the bin/node INSIDE it, so the digest checked here is the archive's. Comparing the PATH
  # binary against that line can never pass on any machine (MEASURED 2026-09-25: it refused a byte-identical
  # official install). The extracted binary's own digest is not confirmable from this list at all, so it is
  # recorded in build-info.txt as a build input, and what binds it to the official build is this line.
  "$GREP" -q " $TARBALL\$" "$SHASUMS_TMP" || refuse "$TARBALL is not listed in the pinned official digest list for $NODE_VERSION — refusing rather than comparing against nothing"
  TARBALL_SHA="$("$GREP" " $TARBALL\$" "$SHASUMS_TMP" | "$AWK" '{print $1}')"
  [ -n "$TARBALL_SHA" ] || refuse "the pinned digest list carries no digest on the $TARBALL line"
  # THE CACHE IS KEYED BY CONTENT, NOT BY NAME: a cached file is reused only while its digest is the pinned
  # one, so a corrupted or substituted cache entry is re-downloaded rather than trusted or installed.
  CACHE_DIR="${HOME:-/tmp}/aukora-private/cache/node"
  CACHE_FILE="$CACHE_DIR/$TARBALL"
  if [ -f "$CACHE_FILE" ] && [ "$(sha256_of "$CACHE_FILE")" = "$TARBALL_SHA" ]; then
    TARBALL_BYTES="$(byte_size_of "$CACHE_FILE")"
    say "  official build  : $TARBALL — already cached, $TARBALL_BYTES bytes"
    say "                    $CACHE_FILE"
    say "                    its sha256 is $TARBALL_SHA, the pinned list's own line: not re-downloaded"
  else
    "$MKDIR" -p "$CACHE_DIR" || refuse "cannot create the interpreter cache $CACHE_DIR"
    say "  downloading     : $TARBALL"
    say "                    $TARBALL_URL"
    /usr/bin/curl -fsSL --proto '=https' --tlsv1.2 "$TARBALL_URL" -o "$CACHE_FILE.part" \
      || refuse "could not download $TARBALL_URL, and the interpreter is only installed after the pinned official list verifies it, so there is nothing to install without it. Check the network, or fetch that one file yourself and leave it at $CACHE_FILE."
    GOT="$(sha256_of "$CACHE_FILE.part")"
    if [ "$GOT" != "$TARBALL_SHA" ]; then
      "$RM" -f "$CACHE_FILE.part"
      refuse "the downloaded $TARBALL has sha256 $GOT and the pinned official list says $TARBALL_SHA. Discarded rather than installed: this one comparison is the whole claim that the installed interpreter is the official build."
    fi
    "$MV" "$CACHE_FILE.part" "$CACHE_FILE" || refuse "cannot move the verified archive into the cache"
    TARBALL_BYTES="$(byte_size_of "$CACHE_FILE")"
    say "                    received $TARBALL_BYTES bytes, sha256 $GOT — the pinned list's own line"
  fi

  # ── the bundle: the closure at the layout it will keep, plus the copied interpreter ──
  [ -n "$BUNDLE_DIR" ] || BUNDLE_DIR="${HOME:-/tmp}/aukora-bundles"
  "$MKDIR" -p "$BUNDLE_DIR" || refuse "cannot create $BUNDLE_DIR"
  BUNDLE="$("$MKTEMP" -d "$BUNDLE_DIR/owner-$(printf '%s' "$SHA" | "$CUT" -c1-12).XXXXXX")" || refuse "cannot make a bundle directory under $BUNDLE_DIR"
  local PAYLOAD="$BUNDLE/payload"
  "$MKDIR" -p "$PAYLOAD" || refuse "cannot create the payload directory"
  # the official digest list, fetched (or supplied) before the payload existed, now becomes a PAYLOAD FILE
  # — inside the digest, so a builder on any platform produces the same BUNDLE DIGEST from it.
  "$MV" "$SHASUMS_TMP" "$PAYLOAD/NODE-SHASUMS256.txt" || refuse "cannot place the digest list in the payload"
  [ -s "$PAYLOAD/NODE-SHASUMS256.txt" ] || refuse "the pinned digest list is empty"

  say ""
  say "  the import closure, computed by the checkout's own tool AS PETER (never as root):"
  say "  \$ node $FROM/scripts/owner/owner-closure.mjs --repo $FROM --install <bundle>/payload --entry $ENTRY --entry $CONSOLE"
  local CLOG="$BUNDLE/closure.log"
  if node "$FROM/scripts/owner/owner-closure.mjs" --repo "$FROM" --install "$PAYLOAD" \
        --entry "$ENTRY" --entry "$CONSOLE" > "$CLOG" 2>&1; then :; else
    "$SED" 's/^/  | /' "$CLOG" >&2
    refuse "the closure computation refused (above, and in $CLOG); there is no bundle"
  fi
  "$SED" 's/^/  | /' "$CLOG"
  # AN EXIT STATUS IS NOT EVIDENCE THAT WORK HAPPENED. The tool prints this line only after the installed
  # tree resolved inside itself; requiring it is what makes a silent no-op impossible to mistake for an
  # install (measured 2026-09-25: a symlinked path made its guard false, it exited 0 and installed nothing).
  "$GREP" -q '^INSTALLED TREE RESOLVES INSIDE ITSELF' "$CLOG" || refuse "the closure tool exited 0 but never printed its closing assertion; that is not a bundle"
  # THE PARSER'S OWN CEILINGS, CARRIED INTO THE PAYLOAD so the digest Peter confirms covers them. A file
  # that resolves specifiers at CALL time — createRequire(pathToFileURL(x).href).resolve(spec) in
  # composition-gate/src/artifact.mjs:157 is the measured instance — cannot be followed by any static
  # parser. Refusing would block the install on someone else's module; passing silently would let the
  # bundle claim a completeness it does not have. The honest claim is written down instead: every STATIC
  # import was followed, and runtime loading inside these files is exercised by the post-install
  # resolution check and the courts, NOT proven by the parser.
  "$GREP" '^CEILING ' "$CLOG" > "$PAYLOAD/RUNTIME-LOADING-CEILING.txt" || true
  [ -f "$PAYLOAD/RUNTIME-LOADING-CEILING.txt" ] || refuse "cannot record the runtime-loading ceiling file"
  say "  runtime-loading ceiling: $("$WC" -l < "$PAYLOAD/RUNTIME-LOADING-CEILING.txt" | "$TR" -d ' ') line(s), recorded INSIDE the digest"
  "$SED" 's/^CEILING /    ceiling /' "$PAYLOAD/RUNTIME-LOADING-CEILING.txt"
  local CLOSURE_FILES
  CLOSURE_FILES="$("$SED" -n 's/^installed to .*: \([0-9][0-9]*\) file(s).*/\1/p' "$CLOG" | /usr/bin/tail -1)"
  [ -n "$CLOSURE_FILES" ] || refuse "the closure tool never reported an installed file count"
  [ "$CLOSURE_FILES" -ge 2 ] || refuse "the closure is $CLOSURE_FILES file(s); the two entry points alone are 2"
  say "  closure: $CLOSURE_FILES file(s)"

  # ── THE ARCHIVE IS WHAT TRAVELS, AND IT IS WHAT PHASE B AUTHENTICATES AND EXTRACTS FROM ─────────────
  # REPRODUCIBILITY IS WHAT MAKES THE DIGEST CHECKABLE ELSEWHERE. The payload may hold only bytes that are
  # identical for the same commit on any machine, so the platform-specific ARCHIVE lives BESIDE the payload
  # at interpreter/<tarball> — OUTSIDE the digest — and the payload records how to identify it in
  # machine-independent terms: NODE-VERSION and the official NODE-SHASUMS256.txt, which is INSIDE the digest.
  # Phase A extracts here only to check the binary it is about to hand over: it runs it as Peter, then
  # discards it. What Phase B installs is extracted from the archive inside its own staging, after checking
  # that archive against the payload's list. No extracted binary travels, so there is none to trust.
  "$MKDIR" -p "$BUNDLE/interpreter" || refuse "cannot create the interpreter directory"
  local MEMBER="node-$NODE_VERSION-$NA/bin/node"
  local EXTRACT="$BUNDLE/interpreter/.extract"
  "$MKDIR" -p "$EXTRACT" || refuse "cannot create a scratch directory for the extraction"
  /usr/bin/tar -xzf "$CACHE_FILE" -C "$EXTRACT" "$MEMBER" \
    || refuse "the verified archive $TARBALL does not contain $MEMBER, so it is not the archive this script expects to install"
  [ -f "$EXTRACT/$MEMBER" ] || refuse "$MEMBER is not a regular file inside $TARBALL"
  "$CHMOD" 0755 "$EXTRACT/$MEMBER" || refuse "cannot set the extracted interpreter to 0755"
  NODE_SHA="$(sha256_of "$EXTRACT/$MEMBER")"
  [ -n "$NODE_SHA" ] || refuse "cannot hash the extracted interpreter"
  # IT RUNS HERE, UNPRIVILEGED, BEFORE IT IS EVER PRIVILEGED: an archive whose bytes match the official
  # digest but whose program will not start on this machine would otherwise be discovered by launchd.
  local EXTRACTED_VERSION
  EXTRACTED_VERSION="$("$EXTRACT/$MEMBER" --version 2>/dev/null)" || refuse "the interpreter extracted from $TARBALL does not run on this machine"
  [ "$EXTRACTED_VERSION" = "$NODE_VERSION" ] || refuse "the interpreter extracted from $TARBALL reports $EXTRACTED_VERSION and the pin is $NODE_VERSION"
  [ -z "$EXPECT_NODE_SHA" ] || [ "$EXPECT_NODE_SHA" = "$NODE_SHA" ] || refuse "the extracted interpreter's sha256 is $NODE_SHA, not the pinned $EXPECT_NODE_SHA"
  say "  interpreter     : extracted $MEMBER from $TARBALL — sha256 $NODE_SHA"
  say "                    reports $EXTRACTED_VERSION; run here as you, then DISCARDED — Phase B extracts its own from the archive"
  # THE SHARED-LIBRARY CLOSURE, MEASURED ON THE PLATFORM THAT WILL RUN IT: an interpreter that resolved a
  # library out of a directory its owner can write would undo the reason for installing an official build.
  local BADLIB
  case "$(/usr/bin/uname -s)" in
    Darwin)
      if ! BADLIB="$("$OTOOL" -L "$EXTRACT/$MEMBER" 2>&1)"; then
        refuse "otool could not read the interpreter's libraries, so its dylib closure is UNMEASURED. otool said: $BADLIB"
      fi
      BADLIB="$(printf '%s\n' "$BADLIB" | "$AWK" 'NR>1 {print $1}' | "$GREP" -v '^/usr/lib/' | "$GREP" -v '^/System/' || true)"
      [ -z "$BADLIB" ] || refuse "the interpreter links libraries outside /usr/lib and /System:
$BADLIB"
      say "                    every dylib it links is a system path (otool -L)"
      ;;
    Linux)
      if ! BADLIB="$(/usr/bin/ldd "$EXTRACT/$MEMBER" 2>&1)"; then
        refuse "ldd could not read the interpreter's libraries, so its shared-library closure is UNMEASURED. ldd said: $BADLIB"
      fi
      printf '%s\n' "$BADLIB" | "$GREP" -q '=> /' || refuse "ldd resolved no shared library for the interpreter, which is not what a dynamically linked node looks like: its library closure is UNMEASURED rather than clean"
      BADLIB="$(printf '%s\n' "$BADLIB" | "$AWK" '{print $3}' | "$GREP" '^/' | "$GREP" -vE '^/(usr/)?lib' || true)"
      [ -z "$BADLIB" ] || refuse "the interpreter links libraries outside /lib and /usr/lib:
$BADLIB"
      say "                    every shared library it links is a system path (ldd)"
      ;;
    *) refuse "no shared-library check is defined for $(/usr/bin/uname -s), so the interpreter's library closure would be UNMEASURED rather than clean" ;;
  esac
  "$RM" -rf "$EXTRACT" || refuse "cannot remove the extraction scratch directory"
  # THE ONLY INTERPRETER ARTIFACT THAT LEAVES PHASE A, and it is the ARCHIVE: Phase B checks its sha256
  # against the list inside the payload and extracts bin/node itself, in its own 0700 staging.
  "$CP" "$CACHE_FILE" "$BUNDLE/interpreter/$TARBALL" || refuse "cannot place the verified archive beside the payload"
  say "  archive         : $BUNDLE/interpreter/$TARBALL (what Phase B authenticates against the payload's list, and extracts from)"
  printf '%s\n' "$SHA" > "$PAYLOAD/REVISION"
  printf '%s\n' "$NODE_VERSION" > "$PAYLOAD/NODE-VERSION"
  # BUILD INPUTS, RECORDED BUT OUTSIDE THE DIGEST: everything a human needs to say WHERE a digest came
  # from — including the ARCHIVE's digest, the URL it was fetched from and the extracted binary's digest,
  # all of which differ per platform and therefore must not be inside the payload. A second builder on
  # another OS prints the same BUNDLE DIGEST and a different nodeSha256/nodeArchive line, which is exactly
  # what these files are for. **NONE OF IT IS A TRUST ANCHOR, and Phase B does not read it**: it lives
  # outside the digest, so anything that can write the bundle can rewrite it.
  {
    printf 'revision=%s\n' "$SHA"
    printf 'nodeVersion=%s\n' "$NODE_VERSION"
    printf 'NODE-SOURCE=%s\n' "$TARBALL_URL"
    printf 'tarball=%s\n' "$TARBALL"
    printf 'tarballSha256=%s\n' "$TARBALL_SHA"
    printf 'tarballBytes=%s\n' "$TARBALL_BYTES"
    printf 'cachePath=%s\n' "$CACHE_FILE"
    printf 'nodeArchive=%s\n' "$BUNDLE/interpreter/$TARBALL"
    printf 'nodeSha256=%s\n' "$NODE_SHA"
    printf 'platform=%s-%s\n' "$(/usr/bin/uname -s)" "$(/usr/bin/uname -m)"
    printf 'toolchainNode=%s\n' "$NODE_REAL"
    printf 'toolchainSha256=%s\n' "$PATH_NODE_SHA"
    printf 'shasumsSource=%s\n' "$SHASUMS_SOURCE"
    printf 'closureFiles=%s\n' "$CLOSURE_FILES"
  } > "$BUNDLE/build-info.txt" || refuse "cannot write build-info.txt"

  # ── the manifest and THE BUNDLE DIGEST: one number Peter confirms ──
  local FILES="$BUNDLE/files.txt"
  ( cd "$PAYLOAD" && "$FIND" . -type f ! -name MANIFEST.sha256 | "$SED" 's|^\./||' | LC_ALL=C /usr/bin/sort ) > "$FILES" || refuse "cannot list the bundle"
  : > "$PAYLOAD/MANIFEST.sha256"
  local rel n=0
  while IFS= read -r rel; do
    printf '%s  %s\n' "$(sha256_of "$PAYLOAD/$rel")" "$rel" >> "$PAYLOAD/MANIFEST.sha256" || refuse "cannot write the manifest"
    n=$((n + 1))
  done < "$FILES"
  [ "$n" -ge "$((CLOSURE_FILES + 4))" ] || refuse "the manifest covers $n file(s) but the closure alone was $CLOSURE_FILES: modules are missing (payload = closure + REVISION + NODE-VERSION + NODE-SHASUMS256.txt + RUNTIME-LOADING-CEILING.txt)"
  BUNDLE_DIGEST="$(sha256_of "$PAYLOAD/MANIFEST.sha256")"
  SCRIPT_SHA="$(sha256_of "$0")"
  say ""
  say "════ PHASE A DONE — WHAT YOU NOW HOLD ════════════════════════════════════════════════════════"
  say "  bundle          : $BUNDLE"
  say "  files           : $n (closure $CLOSURE_FILES + REVISION + NODE-VERSION + NODE-SHASUMS256.txt + RUNTIME-LOADING-CEILING.txt)"
  say "                    the official ARCHIVE is beside the payload (interpreter/$TARBALL), outside the digest;"
  say "                    Phase B verifies it against the payload's pinned list and extracts from it"
  say "  interpreted by  : node $NODE_VERSION — the official $NA build, sha256 $NODE_SHA, beside the payload"
  say "                    from $TARBALL_URL ($TARBALL_BYTES bytes, archive sha256 $TARBALL_SHA, cached at $CACHE_FILE)"
  say "  REVIEWED COMMIT : $SHA"
  say "  BUNDLE DIGEST   : $BUNDLE_DIGEST      (sha256 of the bundle's MANIFEST.sha256)"
  say "  SCRIPT DIGEST   : $SCRIPT_SHA      (sha256 of this file, as Phase B will re-measure it)"
  say ""
  say "  COMPARE THE TWO DIGESTS WITH THE REVIEWED REVISION. Then run Phase B from INSTALL.md 1b — the block"
  say "  pasted into \`sudo env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash\`, which copies THIS script and"
  say "  the bundle into a fresh root-owned 0700 staging directory, compares both digests THERE, and executes"
  say "  only the staged copy."
  say ""
  say "  THERE IS DELIBERATELY NO READY-TO-PASTE sudo LINE PRINTED HERE. This file is read from a checkout the"
  say "  agent uid can write, so a line that runs it as root would recommend exactly what the two-phase design"
  say "  exists to prevent. The four values Phase B needs, to take from the CI log line and not from here:"
  say ""
  say "    BUNDLE=$BUNDLE"
  say "    WANT_BUNDLE=$BUNDLE_DIGEST"
  say "    SHA=$SHA"
  say "    WANT_SCRIPT=$SCRIPT_SHA"
  say ""
  say "  NOTHING ABOVE TOUCHED THE SYSTEM: no directory was created, no account exists, no service was"
  say "  loaded. --prefix <dir> proves the same Phase B procedure under a temporary root instead of sudo."
}

# ── PHASE B — SUDO. Deploys the confirmed bundle. Trusted tools, absolute paths, protected staging. ──
deploy() {
  local PRIV="$1"            # 1 = real install (root), 0 = --prefix proof (unprivileged)
  local LIBEXEC_T="$LIBEXEC" CONFIG_T="$CONFIG" PLIST_T="$PLIST"
  local OWNER_T="$OWNER_DIR" RUN_T="$RUN_ROOT" APPROVE_T="$APPROVE_DIR" STAGE_T="" NODE_T="$NODE_BIN"
  # THE LEDGER LIVES IN THE OWNER DIRECTORY, BESIDE THE MARKER, for the same reason: it is the record
  # teardown reads before it removes anything, so it must be somewhere teardown already knows how to
  # authenticate. SET HERE AS A LOCAL so every function called from this scope sees it, which is how
  # `OWNER_T` itself already reaches `provision_accounts`.
  # *** THE LEDGER DOES NOT LIVE IN THE SETTLEMENT RECORD, AND THAT IS A CORRECTION TO MY OWN FIRST PLACEMENT. ***
  # I put it at `$OWNER_T/$LEDGER` -- and `$OWNER_T` is `chown $OWNER_USER:$OWNER_USER` + `chmod 0700` two
  # hundred lines below, SO ITS OWN OWNER CAN WRITE IT. Teardown refuses a ledger with an owner-writable parent
  # (a writable parent lets the file be REPLACED wholesale, which makes its own 0600 and root ownership
  # meaningless), SO THE LEDGER I WROTE COULD NEVER BE AUTHENTICATED ON A REAL INSTALL AND TEARDOWN WOULD
  # DELETE NO ACCOUNTS AT ALL -- a safety property turned into a broken uninstall.
  #
  # THE CONFIG'S DIRECTORY IS THE RIGHT NEIGHBOUR: setup creates it, NEVER CHOWNS IT TO THE OWNER, and it is
  # where the install's other root-owned state already lives. Deriving it from `$CONFIG_T` rather than writing a
  if [ "$PRIV" = "0" ]; then
    case "$PREFIX" in /*) ;; *) refuse "--prefix needs an absolute path";; esac
    "$MKDIR" -p "$PREFIX" || refuse "cannot create $PREFIX"
    LIBEXEC_T="$PREFIX/usr/local/libexec/aukora-owner"; CONFIG_T="$PREFIX/usr/local/etc/aukora-owner.json"
    PLIST_T="$PREFIX/Library/LaunchDaemons/com.aukora.owner.plist"
    RUN_T="$PREFIX/Library/Application Support/AUKORA-Run"
    OWNER_T="$PREFIX/Library/Application Support/AUKORA-Owner"
    APPROVE_T="$RUN_T/owner"; NODE_T="$LIBEXEC_T/bin/node"
  fi
  # *** `LEDGER_T` IS DERIVED FROM `CONFIG_T` AND MUST BE DERIVED *AFTER* THE RELOCATION (Codex r6 finding 8). ***
  # It used to be computed ABOVE the `if [ "$PRIV" = "0" ]` block, SO IN PREFIX MODE `CONFIG_T` MOVED TO
  # `$PREFIX/usr/local/etc/…` WHILE `LEDGER_T` STILL NAMED THE REAL `/usr/local/etc/aukora-owner-ledger`. The
  # directory-creation loop records a `created directory` row UNCONDITIONALLY (`:882`), so THE UNPRIVILEGED PROOF
  # TRIED TO WRITE THE SYSTEM LEDGER, FAILED, AND REFUSED -- a fresh prefix proof could not complete at all.
  # *** A PATH DERIVED FROM A RELOCATED PATH HAS TO BE DERIVED AFTER THE RELOCATION; DERIVING IT EARLIER SILENTLY
  # BINDS IT TO THE OLD VALUE. *** This is a defect I introduced when I moved the ledger out of `$OWNER_T` for
  # beta-103 item 1: the ledger had to leave a directory the install chowns to its own account, and this is the
  # consequence of where I put it. The `local` still holds, so the fake-root court relocates it with the
  # constants it already moves.
  local LEDGER_T="$(dirname "$CONFIG_T")/aukora-owner-ledger"

  say "PHASE B — deploying the bundle you confirmed"
  # ── 0. the arguments are the trust anchor: a defaulted digest confirms nothing ──
  [ -n "$BUNDLE" ] || refuse "--bundle is REQUIRED: Phase B installs the bundle Phase A built, never the checkout"
  [ -n "$BUNDLE_DIGEST" ] || refuse "--bundle-digest is REQUIRED: it is the number you compared with the reviewed revision"
  [ -n "$SHA" ] || refuse "--sha is REQUIRED: the reviewed commit the bundle claims to be"
  [ "$PRIV" = "1" ] && [ -z "$SCRIPT_SHA" ] && refuse "--script-sha256 is REQUIRED: without it this file is whatever the agent last wrote to the checkout"
  [ -d "$BUNDLE/payload" ] || refuse "$BUNDLE/payload is missing; --bundle must name a Phase A bundle directory"

  # ── 1. this script, pinned before it does anything ──
  if [ "$PRIV" = "1" ]; then
    expect_exact "the script running as root" "$SCRIPT_SHA" sha256_of "$0"
  fi

  # ── 2. the bundle: digest, revision, and no file the manifest does not list ──
  local MAN="$BUNDLE/payload/MANIFEST.sha256"
  [ -f "$MAN" ] || refuse "$MAN is missing"
  # BEFORE ANY PATH OR HASH IS USED: a symlink is not a copy. `cp -R` preserves them, the hash follows them,
  # and an install would install the link. This refuses the whole tree if anything in it is not a plain file
  # or directory, and it runs before the manifest is trusted to describe what is there.
  reject_nonregular "the staged bundle" "$BUNDLE"
  expect_exact "bundle digest (the number you confirmed)" "$BUNDLE_DIGEST" sha256_of "$MAN"

  # ── THE INTERPRETER: AUTHENTICATED AGAINST THE PAYLOAD'S OWN LIST, EXTRACTED HERE, AND **build-info.txt
  #    IS NOT A TRUST ANCHOR** (Codex r3, blocking item 1). It lives OUTSIDE the digest, so anything that can
  #    write the bundle can rewrite every line of it; a comparison against Phase A's recorded digest proves
  #    only that two files agree, not that either is the official build. What authenticates the interpreter
  #    is the ARCHIVE's sha256 against nodejs.org's SHASUMS256.txt — and that list is a PAYLOAD file, inside
  #    the digest Peter confirmed. So Phase B verifies the archive, extracts bin/node from it INSIDE its own
  #    0700 staging, and installs only that. Nothing extracted is ever taken on trust from beside the payload.
  local NA TARBALL WANT_TARBALL ARCHIVE
  case "$(/usr/bin/uname -s):$(/usr/bin/uname -m)" in
    Darwin:arm64) NA=darwin-arm64;; Darwin:x86_64) NA=darwin-x64;;
    Linux:x86_64) NA=linux-x64;; Linux:aarch64) NA=linux-arm64;; *) NA="";;
  esac
  [ -n "$NA" ] || refuse "cannot name the official node build for this platform, so the interpreter cannot be authenticated"
  TARBALL="node-$("$CAT" "$BUNDLE/payload/NODE-VERSION")-$NA.tar.gz"
  ARCHIVE="$BUNDLE/interpreter/$TARBALL"
  [ -f "$ARCHIVE" ] || refuse "the bundle carries no official archive at interpreter/$TARBALL. The interpreter is installed by verifying that archive against the payload's pinned list and extracting from it; without the archive there is nothing to authenticate."
  WANT_TARBALL="$("$GREP" " $TARBALL\$" "$BUNDLE/payload/NODE-SHASUMS256.txt" | "$AWK" '{print $1}')"
  [ -n "$WANT_TARBALL" ] || refuse "$TARBALL is not in the bundle's pinned official digest list, so the archive carries no provenance anything can check"
  expect_exact "the bundle's official archive matches the pinned list INSIDE the payload" "$WANT_TARBALL" sha256_of "$ARCHIVE"
  # NOTHING IS EXECUTED HERE. An unauthenticated binary beside the payload is not run even to ask its
  # version: that question is answered in staging, on the binary extracted from the archive just verified.
  expect_exact "reviewed revision recorded in the bundle" "$SHA" "$CAT" "$BUNDLE/payload/REVISION"
  local TMP; TMP="$("$MKTEMP" -d "${TMPDIR:-/tmp}/aukora-verify.XXXXXX")" || refuse "cannot make a scratch dir"
  manifest_paths "$MAN" > "$TMP/listed.txt"
  ( cd "$BUNDLE/payload" && "$FIND" . -type f ! -name MANIFEST.sha256 | "$SED" 's|^\./||' | LC_ALL=C /usr/bin/sort ) > "$TMP/actual.txt"
  if ! "$DIFF" -u "$TMP/listed.txt" "$TMP/actual.txt" > "$TMP/diff.txt" 2>&1; then
    "$SED" 's/^/  | /' "$TMP/diff.txt" >&2
    refuse "the bundle holds files its manifest does not list, or lists files it does not hold (above). Only the manifest may be installed."
  fi
  local NFILES; NFILES="$("$WC" -l < "$TMP/listed.txt" | "$TR" -d ' ')"
  say "  manifest agrees with the bundle: $NFILES file(s), no extras"

  # ── 3. PATHS BEFORE WRITES: ancestors, ACLs, symlinks (never resolved away), group/world write ──
  # THE CHECK RUNS ON THE REAL TARGET PATHS IN BOTH MODES, because that is where Phase B will write and
  # the answer has to be knowable before sudo. MEASURED on this Mac 2026-09-25: /usr, /usr/local, /Library,
  # /Library/LaunchDaemons and /var/root are root:wheel 0755, and /Library/Application Support is
  # root:admin 0755 — the admin GROUP has no write bit there, so it passes; a g+w component would not.
  # THE TEMP ROOT IS A NAMED CEILING IN PREFIX MODE: this proof was told to write into a scratch root that
  # uid $("$ID" -u) owns by construction (and /tmp is a symlink, which a real install must refuse), so the
  # components that hold it are not the subject here.
  say ""
  # ── THE AGENT USER IS AN EXPLICIT, VALIDATED INPUT (Codex r4, blocker A) ─────────────────────────────
  # `env -i` and the re-exec ERASE SUDO_USER, so an install that needs to name the unprivileged agent had
  # nothing to name: it would have skipped the boundary measurement and the submit-group membership and still
  # printed a finished install. It is passed in, and every property it must have is checked here.
  if [ "$PRIV" = "1" ]; then
    [ -n "$AGENT_USER" ] || refuse "Phase B needs --agent-user <name>: the unprivileged account that must be REFUSED on $APPROVE_DIR/approve.sock and added to $SUBMIT_GROUP. env -i erases SUDO_USER, so it cannot be inherited — an install that cannot name the agent cannot measure the cut."
    [ "$AGENT_USER" != root ] || refuse "--agent-user root is not an unprivileged agent"
    AGENT_UID="$("$ID" -u "$AGENT_USER" 2>/dev/null || true)"
    [ -n "$AGENT_UID" ] || refuse "the agent user '$AGENT_USER' does not exist on this machine"
    [ "$AGENT_UID" != 0 ] || refuse "the agent user '$AGENT_USER' has uid 0 — it must be a real, non-root account"
    [ "$AGENT_USER" != "$OWNER_USER" ] || refuse "--agent-user $OWNER_USER is the account this install creates; the agent is the human who must be refused BY it"
    say "  agent user: $AGENT_USER (uid $AGENT_UID) — the unprivileged principal this cut is measured against"
  fi

  # ── ACCOUNTS ARE PROVISIONED *AFTER* EVERYTHING IS VERIFIED (independent review R10) ────────────────
  # They used to be created HERE, before the ancestor check, before the directories and before the only
  # per-file verification of the payload (STAGED BYTES DIFFER, below). A refusal anywhere in between left a
  # half-install with the principals created and no marker — so teardown would not delete them, and every
  # re-run refused. The first persistent write now happens after the staging tree has been verified and the
  # interpreter extracted; see the block below the staging section.

  say "  path ancestors, checked BEFORE anything is written:"
  local bad
  # A RE-RUN MUST PASS ITS OWN CHECK (independent review R10). After a successful install these leaves are
  # owned by $OWNER_USER — that is exactly what the chowns below do — so a rule demanding ROOT OF THE LEAF
  # refused every re-run and every --replace, on this install's own output, while the error read as though a
  # stranger owned it. The rule that actually protects the leaf is the one about its PARENT: the parent must be
  # root-owned and unwritable by others, because that is what stops the leaf being renamed or replaced. The
  # account is read HERE, without creating anything, so a first run has no leaf to accept and is checked in
  # full.
  local OWN_UID; OWN_UID="$("$DSCL" . -read "/Users/$OWNER_USER" UniqueID 2>/dev/null | "$AWK" '{print $2}')"
  for p in "$LIBEXEC" "$CONFIG" "$PLIST" "$OWNER_DIR" "$RUN_ROOT" "$APPROVE_DIR" "$STAGE_PARENT"; do
    local subject="$p"
    # WALK UP PAST EVERYTHING THIS INSTALL ITSELF OWNS. Stopping at the immediate parent is not enough:
    # $APPROVE_DIR's parent IS $RUN_ROOT, which this install also chowns to $OWNER_USER, so the "parent" was
    # another leaf of its own and was refused (MEASURED — the first version of this fix did exactly that). The
    # first ancestor that is NOT ours is the one whose ownership actually protects the chain.
    if [ -e "$p" ] && [ -n "$OWN_UID" ]; then
      while [ "$subject" != / ] && [ -e "$subject" ] && [ "$(uid_of "$subject")" = "$OWN_UID" ]; do
        subject="$(dirname "$subject")"
      done
      [ "$subject" = "$p" ] || say "    (re-run) $p was made by this install (uid $OWN_UID); checking the first ancestor that is NOT $OWNER_USER: $subject"
    fi
    if bad="$(check_ancestors "$subject")"; then say "    ok  $subject — root-owned, unwritable by others, ACL-free, no symlink component"
    elif [ "$PRIV" = "1" ]; then refuse "PATH CHECK FAILED for $subject: $bad"
    else
      say "    FINDING on the REAL path (Phase B refuses until this is fixed): $subject"
      say "      $bad"
    fi
  done
  [ "$PRIV" = "1" ] || say "    CEILING (prefix mode): the components ABOVE $PREFIX are not checked — the scratch root is this proof's own by construction."

  # ── THE EXISTING-INSTALL GUARD IS A CHECK, SO IT RUNS BEFORE THE WRITES TOO (independent review R10) ──
  # $LIBEXEC_T is the DESTINATION of the `mv` below, and a destination that already exists makes
  # `mv "$STAGE" "$LIBEXEC_T"` move staging INSIDE it — installing one level too deep, at paths nothing reads,
  # while every check still reported OK. It is refused here, before anything has been created.
  if [ -e "$LIBEXEC_T" ] && [ "$PRIV" = "1" ] && [ "$REPLACE" != "1" ]; then
    refuse "$LIBEXEC_T already exists. Pass --replace to install over it (the old tree is removed only AFTER the new one has been verified)."
  fi
  # PREFIX MODE stages BESIDE its destination, so that one parent has to exist before staging. It is created
  # here rather than with the other directories because the other directories are persistent writes and this
  # is not: it is the scratch root the caller named, and in Phase B the staging parent is $STAGE_PARENT, which
  # already exists and was checked above.
  [ "$PRIV" = "1" ] || "$MKDIR" -p "$(dirname "$LIBEXEC_T")" || refuse "cannot create the staging parent $(dirname "$LIBEXEC_T")"

  # ── 5. staging: fresh, 0700, under a root-owned parent (or beside the prefix, which says so) ──
  local STAGE
  if [ "$PRIV" = "1" ]; then
    STAGE="$("$MKTEMP" -d "$STAGE_PARENT/aukora-stage.XXXXXX")" || refuse "cannot create a staging directory under $STAGE_PARENT"
  else
    STAGE="$("$MKTEMP" -d "$LIBEXEC_T.stage.XXXXXX")" || refuse "cannot create a staging directory beside $LIBEXEC_T"
    say "    CEILING (prefix mode): the staging directory is NOT under a root-owned parent — uid $("$ID" -u) can write it. Only sudo creates the real staging root."
  fi
  "$CHMOD" 0700 "$STAGE" || refuse "cannot set the staging directory to 0700"
  say "  staging: $STAGE (0700)"

  # ── 6. copy each manifest entry, then verify EVERY file and require the whole set OK ──
  local rel want got ok=0
  while IFS= read -r rel; do
    [ -f "$BUNDLE/payload/$rel" ] || refuse "the manifest lists '$rel' and the bundle does not hold it"
    "$MKDIR" -p "$STAGE/$(dirname "$rel")" || refuse "cannot create staging subdirectory for $rel"
    "$CP" "$BUNDLE/payload/$rel" "$STAGE/$rel" || refuse "cannot copy $rel into staging"
    want="$("$AWK" -v r="$rel" '$2 == r {print $1}' "$MAN")"
    got="$(sha256_of "$STAGE/$rel")"
    [ "$want" = "$got" ] || refuse "STAGED BYTES DIFFER for $rel: manifest $want, staged $got"
    ok=$((ok + 1))
  done < "$TMP/listed.txt"
  [ "$ok" = "$NFILES" ] || refuse "verified $ok of $NFILES files"
  # The manifest installs WITH the tree: it is the only thing that lets anyone re-verify the install later,
  # and it is its own digest, so the copy is checked against the number Peter confirmed rather than assumed.
  "$CP" "$MAN" "$STAGE/MANIFEST.sha256" || refuse "cannot copy MANIFEST.sha256 into staging"
  # and once more, in the form a reader can re-run, requiring EVERY line to say OK
  local VOUT; VOUT="$( cd "$STAGE" && "$SHASUM" -a 256 -c MANIFEST.sha256 2>&1 )" || { printf '%s\n' "$VOUT" | "$SED" 's/^/  | /' >&2; refuse "the staged tree does not verify against the manifest"; }
  local NOKS; NOKS="$(printf '%s\n' "$VOUT" | "$GREP" -c ': OK$' || true)"
  [ "$NOKS" = "$NFILES" ] || refuse "only $NOKS of $NFILES files reported OK"
  say "  every staged file verified against the manifest: $NOKS/$NFILES OK"
  expect_exact "bundle digest, recomputed from the staged manifest" "$BUNDLE_DIGEST" sha256_of "$STAGE/MANIFEST.sha256"
  reject_nonregular "the install staging tree" "$STAGE"
  # ── THE INTERPRETER IS EXTRACTED HERE, FROM THE ARCHIVE THAT WAS JUST CHECKED AGAINST THE PAYLOAD ────
  # The archive's sha256 came from a file inside the digest Peter confirmed; the extraction happens inside
  # this 0700 staging directory, and only the extracted bin/node is installed. Nothing is taken from beside
  # the payload, and build-info.txt is not consulted at all: it is outside the digest and therefore not a
  # trust anchor, whatever it says.
  "$MKDIR" -p "$STAGE/bin" "$STAGE/.extract" || refuse "cannot create the staging bin directory"
  MEMBER="node-$("$CAT" "$BUNDLE/payload/NODE-VERSION")-$NA/bin/node"
  "$TAR" -xzf "$ARCHIVE" -C "$STAGE/.extract" "$MEMBER" || refuse "the verified archive does not contain $MEMBER"
  [ -f "$STAGE/.extract/$MEMBER" ] || refuse "$MEMBER is not a regular file inside the verified archive"
  "$MV" "$STAGE/.extract/$MEMBER" "$STAGE/bin/node" || refuse "cannot move the extracted interpreter into staging"
  "$RM" -rf "$STAGE/.extract" || refuse "cannot remove the extraction scratch directory"
  "$CHMOD" 0755 "$STAGE/bin/node" || refuse "cannot set the staged interpreter to 0755"
  expect_exact "the extracted interpreter's version matches the bundle's NODE-VERSION" \
    "$("$CAT" "$BUNDLE/payload/NODE-VERSION")" "$STAGE/bin/node" --version
  say "  interpreter staged as bin/node: verified archive → extracted in staging → version checked (never copied from beside the payload)"

  # ── THE FIRST PERSISTENT WRITE, AND IT COMES AFTER EVERY CHECK ABOVE (independent review R10) ─────────
  # Everything that can refuse — the script digest, the bundle digest, the archive, the revision, the manifest
  # against the files present, the agent user, every path ancestor, the existing-install guard, every staged
  # file hashed against the manifest, the staged manifest re-verified, and the interpreter's own version — has
  # already passed. From here on the writes are the install itself. `provision_accounts` used to run before all
  # of that, which is what made a mid-install refusal unrecoverable: the principals existed, the marker did
  # not, teardown had nothing to obey, and the re-run refused on the account it had just made.
  # *** THE CONFIG IS COMPOSED AND VALIDATED HERE, BEFORE THE FIRST PERSISTENT WRITE (Codex r5 item 6). ***
  # It used to be written at step 8, WITH `[ -s "$CONFIG_T" ] || refuse "the config was not written"` -- A
  # REFUSAL THAT COULD FIRE AFTER `provision_accounts` HAD CREATED THE ACCOUNTS AND THE SIX DIRECTORIES EXISTED.
  # A mid-install refusal there is the same unrecoverable state R10 was written to remove: the principals exist,
  # the marker does not, and a re-run refuses on the account it just made.
  # ITS CONTENT DEPENDS ONLY ON PATHS ALREADY CHECKED, SO IT CAN BE BUILT NOW. Nothing below can change it, and
  # nothing between here and the write can fail in a way that this would have caught.
  CONFIG_TEXT="{
  \"approveSocket\": \"$APPROVE_T/approve.sock\",
  \"keyFile\": \"$OWNER_T/owner.key\",
  \"ownerDir\": \"$OWNER_T\",
  \"runDir\": \"$RUN_T\",
  \"submitSocket\": \"$RUN_T/submit.sock\"
}"
  [ -n "$CONFIG_TEXT" ] || refuse "the config composed to nothing, which cannot happen and therefore means this script is broken"
  # EACH FIELD IS CHECKED ON ITS OWN. My first version was ONE `case` PATTERN requiring all five IN A FIXED
  # ORDER -- AND IT LISTED THEM IN A DIFFERENT ORDER THAN THE TEXT ABOVE PRODUCES, SO IT COULD NEVER MATCH AND
  # THE INSTALLER REFUSED EVERY INSTALL. `"*a*b*"` IS NOT "CONTAINS a AND b"; IT IS "CONTAINS a, THEN LATER b",
  # and the order it demands is invisible in the source because it is spread across two blocks.
  # THE FAKE-ROOT COURT CAUGHT IT IMMEDIATELY: "nothing was REFUSED before that line — REFUSED: the composed
  # config is missing a field it must carry". A GUARD THAT REFUSES EVERYTHING IS AS BROKEN AS ONE THAT REFUSES
  # NOTHING, AND ONLY A COURT THAT RUNS THE INSTALL CAN TELL THEM APART.
  for __field in approveSocket keyFile ownerDir runDir submitSocket; do
    case "$CONFIG_TEXT" in
      *"\"$__field\""*) ;;
      *) refuse "the composed config is missing $__field, and writing it would install a daemon that cannot find its own state. THIS REFUSAL HAPPENS BEFORE ANY ACCOUNT OR DIRECTORY CHANGES." ;;
    esac
  done
  unset __field

  if [ "$PRIV" = "1" ]; then
    # *** THE LEDGER EXISTS BEFORE THE FIRST RESOURCE DOES. *** `provision_accounts` records as it creates, so
    # a ledger initialised after it would be missing exactly the rows that matter most -- THE ACCOUNTS, which
    # are the resources teardown can do the most damage with. And "the directory does not exist yet" is not an
    # obstacle: `ledger_init` creates the file, and the account provisioning below creates the directory that
    # holds it in the ordinary way.
    # THE LEDGER'S OWN DIRECTORY, NOT THE RECORD'S: this one stays root-owned.
    "$MKDIR" -p "$(dirname "$CONFIG_T")" || refuse "cannot create $(dirname "$CONFIG_T") for the ledger"
    ledger_init
    provision_accounts || refuse "account provisioning failed"
  else
    say ""
    say "  CEILING (prefix mode): no account is created and no existing account is judged — uid $("$ID" -u) cannot. Only sudo proves the uid cut."
  fi

  # ── the directories, created AFTER provisioning: they are chowned to $OWNER_USER:$OWNER_USER, so both the
  #    user and the GROUP must exist before the first chown (Codex r4, blocker B) ──
  local d
  # *** `$LIBEXEC_T` ITSELF IS IN THIS LIST, NOT ONLY ITS PARENT. *** The six were the owner directory, the run
  # root, the approve directory AND THREE PARENTS, SO THE CODE'S OWN DIRECTORY WAS NEVER RECORDED -- only the
  # `/usr/local/libexec` that holds it, WHICH PRE-EXISTS ON A MAC and therefore never gets a `created` row
  # either. A path whose row can only exist when its parent did NOT pre-exist is not a path the ledger can speak
  # about.
  # *** `$LIBEXEC_T` IS DELIBERATELY NOT IN THIS LOOP. *** I put it here first, AND IT BROKE PHASE B:
  #     REFUSED: revision recorded in the install: the CHECK ITSELF FAILED (exit 0): cat: …/AUKORA-OWNER/REVISION
  # Creating the code directory EARLY changes what the later `cp -R "$STAGE/." "$LIBEXEC_T/"` copies into and
  # when, and the revision file the install asserts was not there. IT IS RECORDED WHERE IT IS MADE INSTEAD, which
  # is also the more honest moment: a `created` row for a directory should be written when the directory is
  # created FOR ITS OWN SAKE, not when some unrelated loop happens to mkdir it.
  for d in "$OWNER_T" "$RUN_T" "$APPROVE_T" "$(dirname "$CONFIG_T")" "$(dirname "$PLIST_T")" "$(dirname "$LIBEXEC_T")"; do
    # *** CREATED AND RECORDED IN THE SAME BREATH, WHICH IS THE ENTIRE POINT OF A LEDGER. *** A directory that
    # already exists is NOT this install's to remove -- it may be a parent like /usr/local/etc that predates
    # the install by years -- so the LEDGER distinguishes the two and teardown obeys the distinction.
    #
    # THE MARKER COULD NOT: it named the principals and nothing else, so teardown had to GUESS which
    # directories to take, and guessed wrong in both directions -- leaving this install's own directories
    # behind on one path and recursing into a pre-existing parent on another.
    if [ -e "$d" ]; then
      ledger_reuse "directory=$d" "already existed"
    else
      "$MKDIR" -p "$d" || refuse "cannot create $d"
      ledger_record directory "$d" "created by this install"
    fi
  done
  say "  directories exist with the modes this install intends:"
  if [ "$PRIV" = "1" ]; then
    "$CHOWN" "$OWNER_USER:$OWNER_USER" "$OWNER_T" || refuse "cannot chown $OWNER_T"
    "$CHOWN" "$OWNER_USER:$SUBMIT_GROUP" "$RUN_T" || refuse "cannot chown $RUN_T"
    "$CHOWN" "$OWNER_USER:$OWNER_USER" "$APPROVE_T" || refuse "cannot chown $APPROVE_T"
    "$CHMOD" 0700 "$OWNER_T"; "$CHMOD" 0750 "$RUN_T"; "$CHMOD" 0700 "$APPROVE_T"
    say "    ok  $OWNER_T 0700 $OWNER_USER, $RUN_T 0750 $OWNER_USER:$SUBMIT_GROUP, $APPROVE_T 0700 (the boundary)"
    # ── A KEPT RECORD IS HANDED BACK TO THE ACCOUNT (independent review R12) ─────────────────────────────
    # The DEFAULT teardown KEEPS this directory and makes it root-only ON PURPOSE — `chown -R root:wheel` and
    # `chmod -R go-rwx` — so a reinstall found a key owned by root INSIDE a directory owned by aukora-owner.
    # launchd starts the daemon as that account, the daemon cannot read `owner.key`, and with KeepAlive it is
    # restarted forever into a failure it can never pass. The record is the account's own private state (the
    # first install produces exactly that, because the daemon creates these files as itself), so a reinstall
    # gives it back — RECURSIVELY, because the teardown's chmod stripped the modes off every file inside, and
    # the daemon needs to READ its key and WRITE its journal.
    local kept=""
    for f in "$OWNER_T"/*; do
      [ -e "$f" ] || continue
      [ "$(uid_of "$f")" = "$OWNER_UID" ] || kept="$f"
    done
    if [ -n "$kept" ]; then
      say "    the record was KEPT by a teardown and is still root's ($kept): handing it back to $OWNER_USER (uid $OWNER_UID)"
      "$CHOWN" -R "$OWNER_USER:$OWNER_USER" "$OWNER_T" || refuse "cannot hand the kept record back to $OWNER_USER:$OWNER_USER — the daemon would start and could not read its own key"
      "$CHMOD" -R go-rwx "$OWNER_T" || refuse "cannot restore owner-only modes on the kept record"
      [ "$(uid_of "$kept")" = "$OWNER_UID" ] || refuse "$kept still does not belong to $OWNER_USER (uid $OWNER_UID): the daemon would be restarted forever into a key it cannot read"
      say "    ok  the kept record belongs to $OWNER_USER again, and its key is readable by the account that runs the daemon"
    fi
  else
    "$CHMOD" 0700 "$OWNER_T"; "$CHMOD" 0750 "$RUN_T"; "$CHMOD" 0700 "$APPROVE_T"
    say "    ok  modes set exactly as the real install sets them: 0700/$OWNER_T, 0750/$RUN_T, 0700/$APPROVE_T"
    say "    CEILING (prefix mode): the OWNERS read uid $("$ID" -u), not root/$OWNER_USER — only sudo can chown"
  fi

  # ── 8. the config and the plist, written STRAIGHT to their final paths ──
  # They are written here rather than staged because their content is composed by this script from paths
  # that were checked above: a second copy under a writable staging root would add a swap window without
  # adding a check. Every ancestor of both paths was verified BEFORE this write.
  say ""
  say "  composing the install:"
  # THE EXACT TEXT VALIDATED ABOVE, not a second composition: two compositions could differ, and the one that
  # was checked would not be the one installed.
  printf '%s\n' "$CONFIG_TEXT" > "$CONFIG_T"
  [ -s "$CONFIG_T" ] || refuse "the config was not written to $CONFIG_T"
  # *** THE FILE ITSELF IS RECORDED, NOT JUST ITS DIRECTORY (r6 finding 3, and this is the stronger fix I named
  # when the parent-row version landed). *** `/usr/local/etc` PRE-EXISTS ON A MAC, so the six-directory loop takes
  # the `reuse` branch for it AND THERE IS NO `created` ROW FOR THE CONFIG'S PARENT EITHER. Teardown's
  # parent-row tolerance therefore could not authorise removing a config THIS INSTALL WROTE. MEASURED:
  #     FAIL the config is gone
  # while the plist and the code passed -- because `/Library/LaunchDaemons` did NOT exist in the fake root, so
  # the install created it and the row was there. THE ARM THAT FAILED AND THE ARMS THAT PASSED DIFFER ONLY IN
  # WHETHER THE PARENT HAPPENED TO PRE-EXIST, WHICH IS NOT A PROPERTY OF THE FILE.
  # THE LEDGER NOW NAMES THE FILE, so "this install wrote this" is recorded directly rather than inferred.
  ledger_record file "$CONFIG_T" "written by this install"

  # No comment inside the plist: a '--' may not occur inside an XML comment, and a plist is configuration
  # a reader lints, not a place for a maintainer essay. The rules it encodes, kept here instead:
  #   PATH is /usr/bin:/bin on purpose, so nothing the daemon resolves comes from a user directory;
  #   neither NODE_OPTIONS nor NODE_PATH appears, because either would let a user-controlled path back in.
  "$CAT" > "$PLIST_T" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_T</string>
    <string>$LIBEXEC_T/$ENTRY</string>
    <string>$CONFIG_T</string>
  </array>
  <key>UserName</key>         <string>$OWNER_USER</string>
  <key>GroupName</key>        <string>$SUBMIT_GROUP</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>ProcessType</key>      <string>Background</string>
  <key>Umask</key>            <integer>63</integer>
  <key>WorkingDirectory</key> <string>$LIBEXEC_T</string>
  <key>StandardOutPath</key>  <string>$RUN_T/daemon.log</string>
  <key>StandardErrorPath</key> <string>$RUN_T/daemon.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin</string>
    <key>AUKORA_OWNER_CONFIG</key><string>$CONFIG_T</string>
  </dict>
</dict>
</plist>
PLIST
  [ -s "$PLIST_T" ] || refuse "the plist was not written to $PLIST_T"
  # THE FILE, NOT JUST ITS DIRECTORY -- the same reason as the config above, and the same measurement: whether
  # the parent row exists depends on whether the parent HAPPENED TO PRE-EXIST, which is not a property of this
  # install's act of writing the file.
  ledger_record file "$PLIST_T" "written by this install"
  # plutil's OWN words on failure: hiding them behind >/dev/null turned "the file was never written" into
  # "the composed plist does not lint", and sent a reader to the wrong file.
  local LINT
  if LINT="$("$PLUTIL" -lint "$PLIST_T" 2>&1)"; then say "    ok  plutil -lint: $LINT"; else
    printf '%s\n' "$LINT" >&2; refuse "the composed plist does not lint (plutil said so above)"
  fi
  if [ "$PRIV" = "1" ]; then
    "$CHOWN" root:wheel "$CONFIG_T" "$PLIST_T" || refuse "cannot chown the config and the plist to root:wheel"
    "$CHMOD" 0644 "$CONFIG_T" "$PLIST_T" || refuse "cannot set 0644 on the config and the plist"
    say "    ok  config and plist are root:wheel 0644"
    # ── THE AGENT MUST BE ABLE TO READ THE CONFIG (independent review R5, Aumlok's owner.pub) ────────────
    # The detector derives the KEY's path from this file, so the agent uid has to reach and read it. None of the
    # rules above says so: they refuse group/other WRITE, and a 0750 /usr/local/etc passes all of them while
    # leaving the app unable to traverse to the config — detection then answers "absent" forever, which is the
    # failure this whole change exists to remove. So: the file needs o+r and EVERY ancestor needs o+x.
    local q; q="$(dirname "$CONFIG_T")" && local dlast
    while [ "$q" != / ]; do
      dlast="$(mode_of "$q")"; dlast="${dlast#${dlast%?}}"
      case "$dlast" in
        1|3|5|7) : ;;
        *) refuse "$q is mode $(mode_of "$q"), so the AGENT uid cannot traverse it, and the detector reads its key path from $CONFIG_T. FIX: sudo chmod o+x $q";;
      esac
      q="$(dirname "$q")"
    done
    dlast="$(mode_of "$CONFIG_T")"; dlast="${dlast#${dlast%?}}"
    case "$dlast" in
      4|5|6|7) say "    ok  $CONFIG_T is READABLE by the agent uid, and every component above it is traversable — the detector can resolve its key path";;
      *) refuse "$CONFIG_T is mode $(mode_of "$CONFIG_T"): the agent uid cannot READ it, and the detector derives the key's path from it";;
    esac
  else
    say "    CEILING (prefix mode): the config and the plist are NOT chowned to root:wheel (uid $("$ID" -u) cannot); their composition and the lint above are what this run measures"
  fi

  # ── 9. the verified tree into place ──
  say ""
  say "  into place:"
  if [ "$PRIV" = "1" ]; then
    # the interpreter is root-owned BEFORE it is ever executed: chown the staged tree, clear group/world
    # write, and only then move it atomically onto the target path
    "$CHOWN" -R root:wheel "$STAGE" || refuse "cannot chown the staged tree to root:wheel"
    "$CHMOD" -R go-w "$STAGE" || refuse "cannot clear group/world write on the staged tree"
    if [ -e "$LIBEXEC_T" ] && [ "$REPLACE" = "1" ]; then "$RM" -rf "$LIBEXEC_T" || refuse "cannot remove the old install"; fi
    "$MV" "$STAGE" "$LIBEXEC_T" || refuse "cannot move the verified tree into place"
    "$CHMOD" 0755 "$LIBEXEC_T"; "$CHMOD" 0755 "$LIBEXEC_T/bin/node"
    say "    ok  $LIBEXEC_T — the verified tree, now root:wheel, at the layout its imports expect"
    # *** THIS LINE IS THE BLOCKING DEFECT AND IT IS GONE. *** It wrote `createdGroup=` and `createdUser=`
    # UNCONDITIONALLY, so a REUSED account was recorded as created and teardown deleted it. WHETHER THESE WERE
    # CREATED IS NOW IN THE LEDGER, WRITTEN BY THE BRANCH THAT KNOWS, AT THE MOMENT IT KNEW.
    printf 'revision=%s\nbundleDigest=%s\nledgerRows=%s\n' \
      "$SHA" "$BUNDLE_DIGEST" "$LEDGER_ROWS" > "$OWNER_T/$MARKER"
    "$CHOWN" root:wheel "$OWNER_T/$MARKER"; "$CHMOD" 0600 "$OWNER_T/$MARKER"
    say "    ok  $OWNER_T/$MARKER — what THIS install created, so teardown can undo exactly that and nothing else"
  else
    "$CP" -R "$STAGE/." "$LIBEXEC_T/" || refuse "cannot copy the verified tree into the prefix"
    say "    CEILING (prefix mode): nothing is chowned to root:wheel or to $OWNER_USER — uid $("$ID" -u) cannot; the MODES below are the real ones and are measured"
  fi
  "$CHMOD" 0755 "$LIBEXEC_T" 2>/dev/null || true
  # REVISION is already in the tree (it is one of the manifest's files); this asserts that rather than
  # writing a second copy, which would be a file no digest covers.
  expect_exact "revision recorded in the install" "$SHA" "$CAT" "$LIBEXEC_T/REVISION"
  # AND *NOW* THE LEDGER NAMES THE CODE DIRECTORY, after the tree is in place and the revision has been read
  # back. A row written earlier would be a claim about a directory that did not yet hold what it names.
  ledger_record directory "$LIBEXEC_T" "created by this install"
  expect_exact "installed file count (every manifest file + MANIFEST.sha256 + bin/node)" \
    "$((NFILES + 2))" "$SH" -c "'$FIND' '$LIBEXEC_T' -type f | '$WC' -l | '$TR' -d ' '"

  # ── 10. the interpreter runs for the FIRST time here, now that it is root-owned in place ──
  say ""
  expect_exact "the installed interpreter's version (FIRST execution of those bytes)" \
    "$("$CAT" "$LIBEXEC_T/NODE-VERSION")" "$NODE_T" --version
  expect_exact "installed tree verifies against its manifest" \
    "$NFILES" "$SH" -c "cd '$LIBEXEC_T' && '$SHASUM' -a 256 -c MANIFEST.sha256 | '$GREP' -c ': OK\$'"
  # the config is parsed by the ROOT-OWNED interpreter, so this check needs no PATH-selected python3
  expect_exact "the config parses" "config-parses" "$NODE_T" -e \
    'const fs=require("fs");JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log("config-parses")' "$CONFIG_T"

  # ── 11. ownership chain of everything the daemon will execute or import ──
  if [ "$PRIV" = "1" ]; then
    say ""
    say "  ownership of everything the daemon executes or imports, up the full ancestor chain:"
    local f
    for f in "$NODE_T" "$LIBEXEC_T/$ENTRY" "$LIBEXEC_T/$CONSOLE" "$CONFIG_T" "$PLIST_T"; do
      if bad="$(check_ancestors "$f")"; then say "    ok  $f — root-owned chain, no ACL or symlink component"
      else refuse "$f is not safe to execute: $bad"; fi
    done
    local relf
    while IFS= read -r relf; do
      f="$LIBEXEC_T/$relf"; [ -f "$f" ] || continue
      bad="$(check_ancestors "$f")" || refuse "$f is not root-owned up the chain: $bad"
    done < "$TMP/listed.txt"
    say "    ok  every installed file is root-owned and not group/world writable"
  fi

  # ── 11. load, then read the system's own answer back ──
  say ""
  say "  the service:"
  if [ "$PRIV" = "1" ]; then
    "$LAUNCHCTL" bootout system "$PLIST_T" >/dev/null 2>&1 || true      # not loaded is not a failure
    "$LAUNCHCTL" bootstrap system "$PLIST_T" || refuse "launchctl bootstrap failed for $PLIST_T"
    /bin/sleep 2
    expect_nonempty "launchctl's own view of system/$LABEL" "$SH" -c "'$LAUNCHCTL' print 'system/$LABEL' 2>/dev/null | '$AWK' '/state =|pid =/{printf \"%s \", \$3}'"
    [ -f "$RUN_T/daemon.err" ] || refuse "no $RUN_T/daemon.err after bootstrap: the service did not start, and an empty log must not read as a clean one"
    say "    ok  daemon.err exists ($("$WC" -c < "$RUN_T/daemon.err" | "$TR" -d ' ') bytes); last lines: $("$SH" -c "tail -n 3 '$RUN_T/daemon.err'" | "$TR" '\n' ' ')"
    # ── THE BOUNDARY UNDER THE AGENT'S ACTUAL IDENTITY (Codex item 9): modes can read correct while the ──
    # ── kernel answer is different, so the answer is MEASURED, by the agent uid, against the live daemon ──
    [ -S "$APPROVE_T/approve.sock" ] || refuse "the daemon did not create $APPROVE_T/approve.sock"
    [ -S "$RUN_T/submit.sock" ] || refuse "the daemon did not create $RUN_T/submit.sock"
    expect_exact "submit.sock mode" "660" mode_of "$RUN_T/submit.sock"
    expect_exact "approve.sock mode" "600" mode_of "$APPROVE_T/approve.sock"
    expect_exact "the approve directory mode (THE BOUNDARY)" "700" mode_of "$APPROVE_T"
    if [ -n "$AGENT_USER" ]; then
      expect_exact "the AGENT UID is REFUSED on approve.sock, by the kernel" "refused:EACCES" \
        "$SUDO" -u "$AGENT_USER" "$LIBEXEC_T/bin/node" -e \
        'const net=require("net");const s=net.connect(process.argv[1]);s.on("error",e=>{console.log("refused:"+e.code);process.exit(0)});s.on("connect",()=>{console.log("CONNECTED");process.exit(1)})' \
        "$APPROVE_T/approve.sock"
      expect_exact "the AGENT UID REACHES submit.sock" "connected" \
        "$SUDO" -u "$AGENT_USER" "$LIBEXEC_T/bin/node" -e \
        'const net=require("net");const s=net.connect(process.argv[1]);s.on("connect",()=>{console.log("connected");process.exit(0)});s.on("error",e=>{console.log("refused:"+e.code);process.exit(1)})' \
        "$RUN_T/submit.sock"
    else
      refuse "cannot name the agent uid to measure the boundary (--agent-user is '${AGENT_USER:-unset}'); the mode checks above are not a substitute for the agent's own refusal"
    fi
  else
    say "    CEILING (prefix mode): no LaunchDaemon is loaded and there is no service state to read. The"
    say "      composed, linted plist is at $PLIST_T; loading it and reading launchctl's answer needs sudo."
  fi

  # ── 12. the courts, AS THE AGENT UID — never as root ──
  say ""
  run_courts "$PRIV" "$FROM" "$NODE_T"
}

# ── accounts, hardening-checked (Codex item 5) ─────────────────────────────────────────────────────
SUBMIT_GID=""; OWNER_UID=""
# *** A FAILED LOOKUP IS NOT AN ABSENCE (Codex r6 finding 5). *** `"$DSCL" . -read … >/dev/null 2>&1` DISCARDS
# BOTH STREAMS, SO "NO SUCH RECORD" AND "THE LOOKUP ITSELF FAILED" ARRIVE AS THE SAME NON-ZERO EXIT. A FAILED
# LOOKUP THEREFORE FELL INTO THE CREATE BRANCH, AND THE INSTALL RECORDED A `created` ROW FOR A PRINCIPAL IT HAD NOT
# MADE -- a deletion claim teardown would act on. SAME DEFECT CLASS AS A FAILED ACL READ REPORTED AS "no ACLs":
# AN ERROR IS NOT EVIDENCE OF ABSENCE, IT IS EVIDENCE OF NOT KNOWING.
#
# *** IT SETS `PRINCIPAL_STATE` AND IS NEVER CALLED IN A COMMAND SUBSTITUTION. *** My first version PRINTED the
# state and was called as `$(lookup_principal …)` -- WHICH PUT ITS `refuse` INSIDE A SUBSHELL, SO THE REFUSAL
# WOULD HAVE EXITED THE SUBSHELL AND THE CALLER WOULD HAVE READ AN EMPTY STRING: *** THE EXACT DEFECT I FIXED AS
# FINDING 1, WRITTEN AGAIN FOUR FINDINGS LATER. *** AND ITS DEFINITION SAT BELOW ITS FIRST CALL, which in shell
# means "command not found" at runtime. Both are fixed by the shape below.
#
# THREE OUTCOMES, NAMED: found / absent / (the script refuses). Only ONE of them is safe to act on.
PRINCIPAL_STATE=""
lookup_principal() { # lookup_principal <path> — sets PRINCIPAL_STATE to found|absent, or refuses the install
  local path="$1" out rc
  PRINCIPAL_STATE=""
  out="$("$DSCL" . -read "$path" 2>&1)"; rc=$?
  if [ "$rc" = "0" ]; then PRINCIPAL_STATE="found"; return 0; fi
  # THE NOT-FOUND SIGNATURES ARE NAMED RATHER THAN GUESSED, and anything not matching them is fatal. A directory
  # service that is down, a dscl that cannot authenticate, a permissions failure -- ALL of those must stop the
  # install rather than let it create a second account carrying the first one's name.
  case "$out" in
    *"No such key"*|*"eDSAttributeNotFound"*|*"Unable to find"*|*"does not exist"*|*"DS Error: -14136"*)
      PRINCIPAL_STATE="absent"; return 0;;
  esac
  refuse "the lookup of $path FAILED and did not say 'no such record': $(printf '%s' "$out" | head -1). A FAILED LOOKUP IS NOT AN ABSENCE — treating it as one would make this install create a principal that may already exist, and record a deletion claim for it"
}

provision_accounts() {
  say ""
  say "  accounts:"
  local ugid uids existing
  # collision check IMMEDIATELY before creation, from the live directory service, not from a scan made
  # earlier (a uid chosen minutes ago can be taken by the time dscl runs).
  used_ids() { { "$DSCL" . -list /Users UniqueID; "$DSCL" . -list /Groups PrimaryGroupID; } 2>/dev/null; }

  lookup_principal "/Groups/$SUBMIT_GROUP"
  if [ "$PRINCIPAL_STATE" = "found" ]; then
    SUBMIT_GID="$("$DSCL" . -read "/Groups/$SUBMIT_GROUP" PrimaryGroupID | "$AWK" '{print $2}')"
    say "    group $SUBMIT_GROUP exists (gid $SUBMIT_GID); this install will NOT delete or recreate it"
    # AND THE LEDGER SAYS SO, WHICH IS THE WHOLE FIX: the marker recorded this as CREATED, so teardown would
    # have deleted a group this install did not make.
    ledger_reuse "group=$SUBMIT_GROUP" "pre-existing gid $SUBMIT_GID"
  else
    SUBMIT_GID=""
    for i in $(/usr/bin/seq 450 499); do used_ids | "$AWK" '{print $2}' | "$GREP" -qx "$i" || { SUBMIT_GID="$i"; break; }; done
    [ -n "$SUBMIT_GID" ] || refuse "no free gid in 450-499"
    used_ids | "$AWK" '{print $2}' | "$GREP" -qx "$SUBMIT_GID" && refuse "gid $SUBMIT_GID was taken between the check and the creation"
    "$DSCL" . -create "/Groups/$SUBMIT_GROUP" PrimaryGroupID "$SUBMIT_GID" || refuse "cannot create the group $SUBMIT_GROUP"
    "$DSCL" . -create "/Groups/$SUBMIT_GROUP" RealName "AUKORA submit group"
    "$DSCL" . -create "/Groups/$SUBMIT_GROUP" Password '*'
    ledger_record group "$SUBMIT_GROUP" "gid $SUBMIT_GID created by this install"
    say "    created the private group $SUBMIT_GROUP (gid $SUBMIT_GID) — the fallback used to skip this and"
    say "      then fail later on directory creation, which is why it is explicit here"
  fi
  expect_exact "group $SUBMIT_GROUP resolves" "$SUBMIT_GID" "$SH" -c "'$DSCL' . -read '/Groups/$SUBMIT_GROUP' PrimaryGroupID | '$AWK' '{print \$2}'"

  # ── THE OWNER'S OWN GROUP (Codex r4, blocker B) ──────────────────────────────────────────────────────
  # Every directory below is chowned to $OWNER_USER:$OWNER_USER, and no such group was ever created — so on a
  # fresh machine the first chown failed on a group that did not exist. The group is created here, BEFORE the
  # user, with the user's uid as its gid: that is the ordinary macOS pairing, and it means the gid a chown
  # names is one a reader can resolve afterwards.
  lookup_principal "/Groups/$OWNER_USER"
  if [ "$PRINCIPAL_STATE" = "found" ]; then
    OWNER_GID="$("$DSCL" . -read "/Groups/$OWNER_USER" PrimaryGroupID | "$AWK" '{print $2}')"
    say "    group $OWNER_USER exists (gid $OWNER_GID)"
    ledger_reuse "group=$OWNER_USER" "pre-existing gid $OWNER_GID"
  else
    OWNER_GID=""
    for i in $(/usr/bin/seq 450 499); do used_ids | "$AWK" '{print $2}' | "$GREP" -qx "$i" || { OWNER_GID="$i"; break; }; done
    [ -n "$OWNER_GID" ] || refuse "no free gid in 450-499 for the group $OWNER_USER"
    used_ids | "$AWK" '{print $2}' | "$GREP" -qx "$OWNER_GID" && refuse "gid $OWNER_GID was taken between the check and the creation"
    "$DSCL" . -create "/Groups/$OWNER_USER" PrimaryGroupID "$OWNER_GID" || refuse "cannot create the group $OWNER_USER, which every chown below names"
    "$DSCL" . -create "/Groups/$OWNER_USER" RealName "AUKORA owner group"
    "$DSCL" . -create "/Groups/$OWNER_USER" Password '*'
    ledger_record group "$OWNER_USER" "gid $OWNER_GID created by this install"
    say "    created the group $OWNER_USER (gid $OWNER_GID)"
  fi
  expect_exact "group $OWNER_USER resolves" "$OWNER_GID" "$SH" -c "'$DSCL' . -read '/Groups/$OWNER_USER' PrimaryGroupID | '$AWK' '{print \$2}'"

  lookup_principal "/Users/$OWNER_USER"
  if [ "$PRINCIPAL_STATE" = "found" ]; then
    OWNER_UID="$("$DSCL" . -read "/Users/$OWNER_USER" UniqueID | "$AWK" '{print $2}')"
    say "    user $OWNER_USER already exists (uid $OWNER_UID) — VERIFYING it against the hardening this"
    say "      install requires, because an existing account is exactly how the cut is defeated quietly:"
    local shell home authh admin sudoers
    shell="$("$DSCL" . -read "/Users/$OWNER_USER" UserShell 2>/dev/null | "$AWK" '{print $2}')"
    case "$shell" in /usr/bin/false|/sbin/nologin|/usr/bin/true) say "    ok  shell is $shell (no interactive login)";; *) refuse "$OWNER_USER has shell '$shell', which is an interactive login. FIX: sudo dscl . -create /Users/$OWNER_USER UserShell /usr/bin/false";; esac
    home="$("$DSCL" . -read "/Users/$OWNER_USER" NFSHomeDirectory 2>/dev/null | "$AWK" '{print $2}')"
    # THE SANCTIONED HOME IS NOT CHECKED, IT IS RECOGNISED (independent review R10). /var/empty is the system's
    # own "no home" directory and /var is a SYMLINK on macOS, so running the ancestor walk over it refused
    # every re-run AND every --replace after a successful install — the install refuted itself on the value it
    # had just written. Both spellings are accepted because /var/empty is what earlier installs wrote and
    # /private/var/empty is what this one writes; any OTHER home still has to pass the walk in full.
    case "$home" in
      /var/empty|/private/var/empty)
        say "    ok  home $home is the sanctioned empty home (the system's own, never a real home directory)";;
      *)
        if [ -n "$home" ] && [ -d "$home" ]; then
          bad_home="$(check_ancestors "$home")" || refuse "$OWNER_USER's home $home is not root-owned/unwritable: $bad_home"
          say "    ok  home $home exists and is root-owned"
        else
          say "    ok  home '$home' does not exist as a directory (nothing to protect)"
        fi;;
    esac
    authh="$("$DSCL" . -read "/Users/$OWNER_USER" AuthenticationAuthority 2>/dev/null || true)"
    printf '%s' "$authh" | "$GREP" -q 'DisabledUser' || refuse "$OWNER_USER's authentication is NOT disabled (AuthenticationAuthority: '${authh:-empty}'). Hiding an account is not disabling it. FIX: sudo dscl . -create /Users/$OWNER_USER AuthenticationAuthority ';DisabledUser;'"
    say "    ok  authentication is disabled (AuthenticationAuthority names DisabledUser)"
    admin="$("$DSEDITGROUP" -o checkmember -m "$OWNER_USER" admin 2>/dev/null || true)"
    case "$admin" in yes*) refuse "$OWNER_USER IS AN ADMINISTRATOR — an admin can sudo, and this whole cut is filesystem permissions. FIX: sudo dseditgroup -o edit -d $OWNER_USER -t user admin";; *) say "    ok  not an administrator";; esac
    sudoers="$(/usr/bin/grep -rl "$OWNER_USER" /etc/sudoers /etc/sudoers.d 2>/dev/null || true)"
    [ -z "$sudoers" ] || refuse "$OWNER_USER is named in $sudoers — a sudo rule is a root path around every mode bit below. Remove it."
    say "    ok  no sudoers rule names $OWNER_USER"
  else
    OWNER_UID=""
    for i in $(/usr/bin/seq 450 499); do used_ids | "$AWK" '{print $2}' | "$GREP" -qx "$i" || { OWNER_UID="$i"; break; }; done
    [ -n "$OWNER_UID" ] || refuse "no free uid in 450-499"
    used_ids | "$AWK" '{print $2}' | "$GREP" -qx "$OWNER_UID" && refuse "uid $OWNER_UID was taken between the check and the creation"
    ledger_record user "$OWNER_USER" "uid $OWNER_UID created by this install"
    "$DSCL" . -create "/Users/$OWNER_USER" UniqueID "$OWNER_UID" || refuse "cannot create $OWNER_USER (dscl). There is NO silent fallback: run the dscl commands by hand and re-run this script, which will then VERIFY the account instead of creating it (sysadminctl was advertised as a fallback before, and it could not recover because the failed command already exited)."
    "$DSCL" . -create "/Users/$OWNER_USER" PrimaryGroupID "$SUBMIT_GID"
    "$DSCL" . -create "/Users/$OWNER_USER" NFSHomeDirectory /private/var/empty
    "$DSCL" . -create "/Users/$OWNER_USER" UserShell /usr/bin/false
    "$DSCL" . -create "/Users/$OWNER_USER" RealName "AUKORA owner (daemon principal)"
    "$DSCL" . -create "/Users/$OWNER_USER" IsHidden 1
    "$DSCL" . -create "/Users/$OWNER_USER" AuthenticationAuthority ";DisabledUser;"
    "$DSCL" . -passwd "/Users/$OWNER_USER" '*'
    say "    created $OWNER_USER (uid $OWNER_UID, gid $SUBMIT_GID, shell /usr/bin/false, authentication disabled)"
    expect_exact "the new account's shell" "/usr/bin/false" "$SH" -c "'$DSCL' . -read '/Users/$OWNER_USER' UserShell | '$AWK' '{print \$2}'"
  fi
  # membership: the agent is added to the submit group (it is the submitter), the owner is NOT
  local member
  for member in "$AGENT_USER"; do
    [ -n "$member" ] && [ "$member" != root ] || continue
    "$DSEDITGROUP" -o read "$SUBMIT_GROUP" 2>/dev/null | "$GREP" -q "[[:space:]]$member\$" \
      || "$DSEDITGROUP" -o edit -a "$member" -t user "$SUBMIT_GROUP" || refuse "cannot add $member to $SUBMIT_GROUP"
    say "    ok  $member is in $SUBMIT_GROUP (the submitter; the owner socket stays out of reach)"
  done
  return 0
}

# ── the courts: run as the AGENT, never as root ─────────────────────────────────────────────────────
run_courts() {
  local PRIV="$1" TREE="$2" AS="" CNODE=""
  # A SKIP IS A NAMED CEILING IN PREFIX MODE AND A REFUSAL IN PHASE B. Every reason below used to `return
  # 0` in BOTH modes, so "the courts were never run" printed above a successful install in the one mode
  # whose whole purpose is to prove them. An arm that did not run is not a pass.
  if [ ! -f "$TREE/tests/aukora-owner-protocol.test.mjs" ]; then
    [ "$PRIV" != "1" ] || refuse "no tests/aukora-owner-protocol.test.mjs under $TREE: Phase B does not report DONE over courts that were never run"
    say "  (no tests/aukora-owner-protocol.test.mjs under $TREE — the courts were NOT run in prefix mode; Phase B refuses instead of skipping)"
    return 0
  fi
  # The courts run under the interpreter the BUNDLE recorded, by absolute path: Phase B's environment is
  # empty on purpose, so the agent's node is not on PATH, and a PATH lookup here would fail or, worse,
  # find something else.
  # THE INTERPRETER THE COURTS RUN UNDER IS THE INSTALLED ONE — the binary extracted from the archive whose
  # sha256 was checked against the list inside the digest. build-info.txt is NOT consulted: it is outside
  # the digest, and nothing outside the digest decides what root, or the courts, execute.
  if [ -n "$3" ] && [ -x "$3" ]; then CNODE="$3"; else CNODE=""; fi
  if [ -z "$CNODE" ]; then
    [ "$PRIV" != "1" ] || refuse "the installed interpreter is not executable at '$3': Phase B does not report DONE over courts that were never run"
    say "  (the installed interpreter is not executable at '$3' — the courts were NOT run in prefix mode; Phase B refuses rather than run them under something else)"
    return 0
  fi
  if [ "$PRIV" = "1" ]; then
    case "$AGENT_USER" in
      ""|root)
        refuse "cannot name the agent uid to run the courts as (--agent-user is '${AGENT_USER:-unset}'): root must never execute the checkout's test code, and Phase B does not report DONE over a boundary it never measured";;
    esac
    AS="$AGENT_USER"
    say "  the courts, run AS $AS (the agent uid). Root must never execute the checkout's test code."
  else
    say "  the courts, run as uid $("$ID" -u) (the agent uid in this proof)"
  fi
  local court mode log rc fail=0 strict=0
  [ "$PRIV" = "1" ] && strict=1
  [ "$strict" = "1" ] || say "    (prefix mode: a NAMED CEILING is EXPECTED here — the account cannot be created without sudo, so an arm that needs a second uid cannot run. Phase B is where a skip becomes a failure.)"
  for court in protocol ingress authority; do
    for mode in "" "--mutate"; do
      log="$("$MKTEMP" "${TMPDIR:-/tmp}/aukora-court.XXXXXX")"
      if [ -n "$AS" ]; then
        "$SUDO" -u "$AS" -H "$SH" -c "cd '$TREE' && '$CNODE' tests/aukora-owner-$court.test.mjs $mode" > "$log" 2>&1
      else
        ( cd "$TREE" && "$CNODE" "tests/aukora-owner-$court.test.mjs" $mode ) > "$log" 2>&1
      fi
      rc=$?
      /usr/bin/tail -n 14 "$log" | "$SED" 's/^/  | /'
      # AN EXIT STATUS WITH NOTHING UNDER IT IS NOT A MEASUREMENT. A court that exits 0 and prints not one
      # line — a truncated test file, an interpreter that swallows its argument, a runner that returned
      # before its arms — used to be reported as `ok`. The courts print every arm they run, so an empty log
      # means no arm ran, and that is a failure in both modes rather than a silent pass.
      if [ ! -s "$log" ]; then
        say "    FAIL $court${mode:+ --mutate}: the court exited $rc and printed NOTHING — an exit status with no arm under it is not a pass"; fail=1
      elif [ "$rc" != "0" ]; then
        say "    FAIL $court${mode:+ --mutate}: the court exited $rc — ITS OWN WORDS ABOVE ARE THE VERDICT"; fail=1
      else
        say "    ok  $court${mode:+ --mutate}: exit 0"; fi
      if "$GREP" -qE 'NAMED CEILING|skipped with a named ceiling' "$log"; then
        if [ "$strict" = "1" ]; then
          say "    FAIL $court${mode:+ --mutate}: reported a NAMED CEILING while the account exists here — an arm that did not run must not read as a pass"; fail=1
        else
          say "    ceiling $court${mode:+ --mutate}: a named ceiling, which prefix mode expects and Phase B refuses"
        fi
      fi
      "$RM" -f "$log"
    done
  done
  [ "$fail" = "0" ] || refuse "a court went red or skipped an arm on a host where it should have run (above). This install does not end with DONE over that."
  return 0
}

# ── dispatch ───────────────────────────────────────────────────────────────────────────────────────
if [ -n "$PREFIX" ]; then
  # *** PREFIX MODE REFUSES ROOT, AND THIS GUARD IS THE ONE THAT WAS MISSING (Codex r5 item 4). ***
  # `phase_a()` refuses root with a long explanation -- "that is exactly the code root must never execute" --
  # BUT PREFIX MODE WITH A PRE-BUILT BUNDLE SKIPS `phase_a` ENTIRELY, and `deploy 0` runs the COURTS from the
  # checkout. SO `sudo setup-owner.sh --prefix <dir> --bundle <dir> …` EXECUTED CHECKOUT CODE AS ROOT, past the
  # one guard written to prevent exactly that. A GUARD ON A FUNCTION IS NOT A GUARD ON THE ROUTE.
  #
  # AND IT IS NOT ONLY A PRIVILEGE DEFECT: prefix mode's entire claim is that it proves the Phase B procedure
  # UNPRIVILEGED -- `PRIV=0` -- and it prints a paragraph about what it cannot claim because of the uid it runs
  # as. RUN AS ROOT THE PROOF IS VACUOUS AND THE PARAGRAPH IS FALSE. The mode has no meaning as root, so
  # refusing costs nothing and removes the route.
  [ "$("$ID" -u)" != "0" ] || refuse "PREFIX MODE MUST NOT RUN AS ROOT. It is the unprivileged proof of the Phase B procedure (--prefix <dir>), and it runs the checkout's courts -- THE SAME CODE phase_a REFUSES TO RUN AS ROOT, reached by a route that skipped phase_a. Run it as Peter, then run Phase B against a STAGED root-owned copy."
  # --prefix with a PRE-BUILT bundle skips Phase A, which is what lets the verification below be exercised
  # against a bundle that has been tampered with ON PURPOSE: a proof that can only ever see its own fresh
  # output cannot show that the tamper checks work.
  if [ -n "$BUNDLE" ]; then
    say "PREFIX MODE, pre-built bundle: Phase A is skipped and Phase B's verification runs against $BUNDLE"
  else
    phase_a
  fi
  say ""
  deploy 0
  say ""
  say "DONE — PREFIX PROOF: the bundle was built and verified, deployed under $PREFIX through the SAME"
  say "  procedure Phase B uses, and the courts ran UNLESS the line above says they could not be found. WHAT"
  say "  THIS PROOF DOES NOT CLAIM, because uid $("$ID" -u)"
  say "  cannot: root:wheel ownership of anything, the accounts, the loaded service, or a refusal through"
  say "  $APPROVE_DIR/approve.sock. Those are Phase B's, with sudo."
  exit 0
fi
if [ -n "$BUNDLE" ]; then
  # NO READY-TO-PASTE `sudo $SH $0 ...` HERE EITHER. That is the same recommendation Phase A's summary
  # stopped printing: this file is read from a checkout the agent uid can write, so a line that runs THIS
  # copy as root is the one thing the two-phase design exists to prevent. The supported way is staged.
  [ "$("$ID" -u)" = "0" ] || refuse "Phase B creates accounts, root-owned code and a LaunchDaemon, so it needs root — but NOT by sudo-ing this copy: it lives in a checkout the agent uid can write. THE SUPPORTED WAY IS INSTALL.MD 1b: paste that block into 'sudo env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash', which copies THIS script and the bundle into a fresh root-owned 0700 staging directory, compares both digests THERE, and executes only the STAGED copy. Take the commit and both digests from the CI log line, never from Phase A's output. The bundle this invocation named is:
  $BUNDLE"
  # CONTROLLED ENVIRONMENT: re-exec with an empty environment and an absolute PATH, so nothing this phase
  # runs can be redirected by the caller's PATH, NODE_OPTIONS, NODE_PATH or DYLD_* variables.
  if [ "${AUKORA_PHASE_B_ENV:-}" != "1" ]; then
    say "re-executing under a controlled environment: env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin"
    # --agent-user MUST BE CARRIED ACROSS THIS EXEC. MEASURED in the fake-root court (step 3): `env -i` erases
    # SUDO_USER, so argv is the only carrier left; without it the re-exec'd Phase B refused "needs --agent-user
    # <name>" AFTER the manifest check, on every install, and the boundary cut could never be measured. Built
    # with `set --` because a conditional argument list cannot be written inline in sh without either
    # word-splitting an account name or duplicating this whole exec; nothing after this line reads "$@".
    set -- --bundle "$BUNDLE" --bundle-digest "$BUNDLE_DIGEST" --sha "$SHA" --script-sha256 "$SCRIPT_SHA" --from "$FROM"
    [ -z "$AGENT_USER" ] || set -- "$@" --agent-user "$AGENT_USER"
    # --replace MUST CROSS THIS EXEC TOO, OR A REINSTALL IS IMPOSSIBLE (independent review). Without it the
    # re-exec'd Phase B sees REPLACE=0 and refuses "already exists. Pass --replace" — the flag did its job in
    # the process the operator started and then vanished in the one that installs. It is added ONLY when it was
    # asked for: passing it always would silently authorise overwriting an existing install.
    if [ "$REPLACE" = "1" ]; then set -- "$@" --replace; fi
    exec "$ENV" -i PATH=/usr/bin:/bin:/usr/sbin:/sbin AUKORA_PHASE_B_ENV=1 "$SH" "$0" "$@"
  fi
  # ── **THE BOUNDARY THIS CUT DOES NOT MOVE (AUMLOK-113, reviewer rows 9/8)** ─────────────────────────────
  #
  # THE HEADER SAYS IT AT `:8-12` AND `:38-44`: *"this isolates the unprivileged agent process through
  # filesystem permissions. Peter remains an administrator and can become root using sudo. Any agent process
  # with usable sudo authority can cross this boundary."* **THAT IS A CEILING AND IT BELONGS IN THE OUTPUT, NOT
  # ONLY IN A COMMENT** — the person reading "the daemon runs as $OWNER_USER and an agent-uid connect fails in
  # the kernel" is entitled to know in the same breath that the AGENT'S OWN ACCOUNT IS AN ADMINISTRATOR, and
  # that the refusal they just installed does not constrain it.
  #
  # **PRINTED BEFORE THE INSTALL AND NOT AFTER, because it is a fact about the machine as it stands** rather
  # than about what this run produced. A ceiling that appears only on success is one a failed run never says.
  say "CEILING: AGENT_UID_IS_ADMIN — the agent account is an administrator and can become root with sudo."
  say "  The uid separation installed here is a FILESYSTEM boundary: it holds only while the agent process"
  say "  does not use the sudo authority its own account already has. Shell-console approval is not"
  say "  independent proof of human consent, and this script cannot tell a person from a process holding"
  say "  their terminal."
  deploy 1
  say ""
  say "DONE. WHAT IS TRUE NOW, and what is not:"
  say "  the daemon runs as $OWNER_USER from code installed at $LIBEXEC (root:wheel), deployed from the"
  say "  bundle whose digest you confirmed ($BUNDLE_DIGEST) at revision $SHA; its key and journal live in"
  say "  $OWNER_DIR (0700), and an agent-uid connect to $APPROVE_DIR/approve.sock fails in the kernel"
  say "  because that directory is 0700."
  say ""
  say "  NOT CLAIMED: this isolates the unprivileged agent process through filesystem permissions. Peter"
  say "  remains an administrator and can become root using sudo. Any agent process with usable sudo"
  say "  authority can cross this boundary. Shell-console approval is not independent proof of human consent."
  say "  The owner console is the owner uid answering on a terminal — not proof a person read anything:"
  say "    sudo -u $OWNER_USER $NODE_BIN $LIBEXEC/$CONSOLE --config $CONFIG list"
  say "  UNDO: scripts/owner/teardown-owner.sh removes the service, the plist, the installed code, the"
  say "  config and the run root, and it KEEPS $OWNER_DIR (keys, journal, witness) unless you pass"
  say "  --delete-settlement-record and type the path. IT IS ROOT CODE LIKE EVERYTHING ELSE: run it from a"
  say "  root-owned staged copy of the reviewed revision, the way INSTALL.md 1b runs Phase B — never as"
  say "  'sudo $SH scripts/owner/teardown-owner.sh', which runs the checkout's copy as root."
  exit 0
fi

# `phase-b` NAMES A PHASE THAT NEEDS ARGUMENTS. Saying the word without the bundle would silently fall
# through to Phase A — which on a root shell reads as "it did something" while deploying nothing. Refuse
# instead, and name all four values, because all four are required and none of them is defaultable.
if [ "$PHASE_B_EXPLICIT" = "1" ]; then
  refuse "phase-b needs the bundle it deploys: --bundle <dir> --bundle-digest <hex> --sha <commit> --script-sha256 <hex>. Phase A builds and prints all four; without them this would deploy nothing and confirm nothing."
fi
phase_a
