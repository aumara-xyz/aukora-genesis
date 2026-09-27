#!/bin/sh
# teardown-owner.sh — THE EXACT UNDO of scripts/owner/setup-owner.sh. PETER RUNS THIS, AS ROOT.
#
# IT IS ROOT CODE, SO IT IS STAGED LIKE PHASE B, AND THE COMMANDS BELOW ARE ITS ARGUMENTS RATHER THAN A
# READY-TO-PASTE LINE. This file lives in a checkout the agent uid can write, so `sudo /bin/sh
# scripts/owner/teardown-owner.sh …` — which an earlier revision of this header printed — would run the
# checkout's copy as root, the one thing the two-phase design exists to prevent. Run it from a root-owned
# staged copy of the reviewed revision, the way INSTALL.md 1b runs Phase B. What it takes:
#
#   (no arguments)                     # remove install + service, KEEP the record
#   --dry-run                          # print every command, change nothing
#   --delete-settlement-record         # ALSO destroy keys/journal (asks first)
#
# FOUR RULES THAT COME FROM CODEX'S REVIEW OF 2026-09-25, each of which was a defect before:
#
#  1. THE RECORD IS CHOWNED TO ROOT *BEFORE* THE UID THAT OWNS IT IS RETIRED. "Only root can read it" used
#     to be a claim about a directory left owned by a numeric uid that no longer existed — and a numeric uid
#     can be REUSED by any account created later, which would then own the record. chown first, then delete.
#  2. AN ACCOUNT OR GROUP IS DELETED ONLY IF THIS INSTALL CREATED IT. The root-owned marker written by
#     Phase B names what was created and with which uid/gid; a marker that is absent, unreadable, or names
#     different ids means the account is not ours to delete, and this script says so instead of deleting it.
#     The marker is read FIRST, before anything is removed, because --delete-settlement-record takes it away.
#  3. AN ALREADY-UNLOADED SERVICE IS NOT A FAILURE. The old script ran `launchctl bootout` unconditionally
#     and aborted the whole cleanup when the job was not loaded — the common case after a reboot.
#  4. EVERY rm -rf IS GUARDED TWICE: by a literal (a variable that does not equal the exact expected string
#     is refused before rm is invoked) AND by a path check (no symlinked component, every existing component
#     root-owned, parent not group/world writable). A literal alone does not stop a writable intermediate
#     directory from being swapped for a symlink between the check and the delete.
#
# THE CEILING, STATED: this is agent-authored code that sudo runs, exactly like the installer, and it can
# delete. It is small, it refuses more than it acts, and the marker is what keeps its hands off accounts it
# did not create. Peter's account, Electron, the lanes, the checkout and /Applications are never touched.
set -u

OWNER_USER="aukora-owner"; SUBMIT_GROUP="aukora-submit"
OWNER_DIR="/Library/Application Support/AUKORA-Owner"
RUN_ROOT="/Library/Application Support/AUKORA-Run"
LIBEXEC="/usr/local/libexec/aukora-owner"; CONFIG="/usr/local/etc/aukora-owner.json"
PLIST="/Library/LaunchDaemons/com.aukora.owner.plist"; LABEL="com.aukora.owner"
MARKER="$OWNER_DIR/INSTALL-MARKER"

SH=/bin/sh; RM=/bin/rm; CAT=/bin/cat; LS=/bin/ls; AWK=/usr/bin/awk; GREP=/usr/bin/grep
STAT=/usr/bin/stat; CHOWN=/usr/sbin/chown; CHMOD=/bin/chmod; ID=/usr/bin/id
DSCL=/usr/bin/dscl; LAUNCHCTL=/bin/launchctl; SED=/usr/bin/sed

# ── THE OCTAL PERMISSION BITS, AND THE DIRECTIVE THAT DOES NOT RETURN THEM (Codex r3) ───────────────
# This script still read modes with `stat -f '%Mp'`, which prints `0` for EVERY path on macOS — the same
# broken instrument setup-owner.sh was fixed for. Cut into characters 2 and 3 it yields nothing, so the
# group/world-writable check below REFUSED NOBODY: a writable directory component passed as if it were
# 0755, and that is the check standing between a swap and the delete. `%Lp` is the octal permission bits.
mode_of() {
  case "$(/usr/bin/uname -s)" in
    Darwin) "$STAT" -f '%Lp' "$1";;
    *) "$STAT" -c '%a' "$1";;
  esac
}

DRY_RUN=0; DELETE_RECORD=0
for a in "$@"; do case "$a" in
  --dry-run) DRY_RUN=1;;
  --delete-settlement-record) DELETE_RECORD=1;;
  --keep-data) printf 'NOTE: --keep-data is the DEFAULT; the flag is accepted and means nothing extra.\n' >&2;;
  *) printf 'usage: %s [--dry-run] [--delete-settlement-record]\n' "$0" >&2; exit 2;;
esac; done

say()    { printf '%s\n' "$*"; }
refuse() { printf '\nREFUSED: %s\n' "$*" >&2; exit 2; }
run()    { say "  \$ $*"; [ "$DRY_RUN" = "1" ] && return 0; "$@" || refuse "command failed: $*"; }

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

# path_check <path> — prints the first problem and returns 1; the DELETE-side twin of the installer's check.
# THE OWNER-OWNED TREE IS NOT ROOT-OWNED, AND THAT IS CORRECT (Codex r4, blocker D). $OWNER_DIR,
# $RUN_ROOT and $APPROVE_DIR belong to $OWNER_USER — the daemon's own uid — so a checker that demands root
# on every component REFUSED THE CORRECT INSTALL and made teardown unusable on a machine it had just set up.
# The uid is resolved from the live directory service here; only paths under the owner's own trees may be
# owner-owned, and nothing else is let through.
OWNER_UID_RESOLVED="$("$DSCL" . -read "/Users/$OWNER_USER" UniqueID 2>/dev/null | "$AWK" '{print $2}')"

path_check() {
  local p="$1" rest prefix comp kind uid oct grp wld
  case "$p" in /*) ;; *) printf '%s is not an absolute path\n' "$p"; return 1;; esac
  rest="${p#/}"; prefix=""
  while [ -n "$rest" ]; do
    comp="${rest%%/*}"
    if [ "$comp" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    prefix="$prefix/$comp"
    [ -e "$prefix" ] || continue
    kind="$("$STAT" -f '%HT' "$prefix" 2>/dev/null || printf 'MISSING')"
    [ "$kind" = "Symbolic Link" ] && { printf '%s IS A SYMLINK — deleting through a symlinked component would remove whatever it points at\n' "$prefix"; return 1; }
    uid="$("$STAT" -f '%u' "$prefix" 2>/dev/null || printf '?')"
    extra=""
    case "$prefix" in "$OWNER_DIR"|"$OWNER_DIR"/*|"$RUN_ROOT"|"$RUN_ROOT"/*) extra="$OWNER_UID_RESOLVED";; esac
    [ "$uid" = "0" ] || { [ -n "$extra" ] && [ "$uid" = "$extra" ]; } || {
      printf '%s is owned by uid %s, which is neither root nor %s (uid %s)\n' "$prefix" "$uid" "$OWNER_USER" "${OWNER_UID_RESOLVED:-unresolved}"; return 1; }
    oct="$(mode_of "$prefix" 2>/dev/null || printf '000')"
    grp="$(printf '%s' "$oct" | /usr/bin/cut -c2)"; wld="$(printf '%s' "$oct" | /usr/bin/cut -c3)"
    case "$grp$wld" in
      *2*|*3*|*6*|*7*) printf '%s is %s (group/world writable) — a writable directory component can be renamed or replaced between this check and the delete\n' "$prefix" "$oct"; return 1;;
    esac
    # THE DIRECTORY'S OWN ACL, with -d: without it `ls -le` lists the CONTENTS and the directory's own ACL
    # is never the thing inspected (Codex r3, item 5). An ACL is a write path the mode bits do not show.
    ACL_OUT="$ACL_TMP"; read_acl_write "$prefix"; acl="$(cat "$ACL_TMP")"
    if [ -n "$acl" ]; then
      printf '%s\n' "$acl" | "$GREP" -q ' allow ' && { printf '%s carries an ACL that ALLOWS a non-root principal (%s) — delete_child, add_file, append and writesecurity are mutation authority the mode bits do not show, so the rule is any allow ACE, not the word "write" (Codex r4, blocker F)\n' "$prefix" "$acl"; return 1; }
    fi
  done
  return 0
}

safe_rm() { # safe_rm <path> <literal it must equal>
  local path="$1" literal="$2" bad
  [ "$path" = "$literal" ] || refuse "refusing to delete '$path': it does not equal the literal '$literal'"
  case "$path" in ""|/|/Library|/Library/Application\ Support|/usr|/usr/local|/usr/local/libexec|/private|/private/var) refuse "refusing to delete '$path'";; esac
  bad="$(path_check "$path")" && : || refuse "refusing to delete $path: $bad"
  run "$RM" -rf "$literal"
}

say "AUKORA owner cut — teardown"
[ "$("$ID" -u)" = "0" ] || refuse "removing a LaunchDaemon and an account needs root — but NOT by sudo-ing this copy: it lives in a checkout the agent uid can write. Run it from a root-owned staged copy of the reviewed revision, the way INSTALL.md 1b runs Phase B (stage first, then execute the STAGED file). Nothing has been changed."
[ "$DRY_RUN" = "1" ] && say "  MODE: --dry-run — nothing below is executed"
if [ "$DELETE_RECORD" = "1" ]; then
  say "  MODE: --delete-settlement-record — the keys, journal, witness and marks under"
  say "        $OWNER_DIR will be DESTROYED. This is not recoverable."
else
  say "  the settlement record at $OWNER_DIR is KEPT (delete it only with --delete-settlement-record)"
fi

# ── 0. THE LEDGER, READ FIRST: it decides what this script is allowed to delete, and destroying the ──
# ──    record would destroy it too, so it is read before any deletion happens                       ──
#
# *** THE MARKER SAID "CREATED" ABOUT THINGS THE INSTALL HAD ONLY REUSED. *** `setup-owner.sh` reuses a group
# or user that already exists -- its own log lines say so -- and then wrote `createdGroup=`/`createdUser=`
# ANYWAY. SO ON A MACHINE WHERE `aukora-owner` ALREADY EXISTED, THIS SCRIPT WOULD DELETE AN ACCOUNT SOMEBODY
# ELSE CREATED, WITH A DOCUMENT IN ITS HAND SAYING IT WAS OURS.
#
# THE LEDGER REPLACES THAT CLAIM. It is written at the moment each resource is created by the branch that
# created it, so a REUSED resource has a `reused` row and NO `created` row -- and THIS SCRIPT REMOVES ONLY
# WHAT A `created` ROW PROVES.
# BESIDE THE CONFIG, NOT INSIDE THE RECORD -- see the long note in setup-owner.sh. `$OWNER_DIR` is owned by the
# account and is 0700, so a ledger inside it has an owner-writable parent and can never be authenticated.
LEDGER="$(/usr/bin/dirname "$CONFIG")/aukora-owner-ledger"
LEDGER_OK=0
LEDGER_REASON=""

# ── IT IS AUTHENTICATED BEFORE IT IS BELIEVED (Codex r5). ─────────────────────────────────────────────
# A LEDGER IS A LIST OF THINGS TO DELETE, SO A LEDGER THE AGENT UID CAN WRITE IS A LIST OF THINGS THE AGENT
# UID CAN MAKE THIS SCRIPT DELETE. Four conditions, and each is a way that could happen:
#   1. it must be owned by root,
#   2. it must not be group- or world-writable,
#   3. it must carry no ACL that ALLOWS a non-root principal (an ACL is a write path the mode bits do not
#      show -- the same rule `path_check` already applies to directories),
#   4. and its PARENT must not be owner-writable, because a writable parent lets the file be REPLACED
#      WHOLESALE, which makes its own 0600 and root ownership irrelevant.
ledger_authenticate() {
  [ -f "$LEDGER" ] || { LEDGER_REASON="no ledger at $LEDGER"; return 1; }
  local uid oct grp wld parent puid poct pgrp pwld acl
  uid="$("$STAT" -f '%u' "$LEDGER" 2>/dev/null || printf '?')"
  [ "$uid" = "0" ] || { LEDGER_REASON="the ledger is owned by uid $uid, not root"; return 1; }
  oct="$(mode_of "$LEDGER" 2>/dev/null || printf '000')"
  grp="$(printf '%s' "$oct" | /usr/bin/cut -c2)"; wld="$(printf '%s' "$oct" | /usr/bin/cut -c3)"
  case "$grp$wld" in
    *2*|*3*|*6*|*7*) LEDGER_REASON="the ledger is mode $oct (group/world writable)"; return 1;;
  esac
  ACL_OUT="$ACL_TMP"; read_acl_write "$LEDGER"; acl="$(cat "$ACL_TMP")"
  if [ -n "$acl" ] && printf '%s\n' "$acl" | "$GREP" -q ' allow '; then
    LEDGER_REASON="the ledger carries an ACL that ALLOWS a non-root principal ($acl)"; return 1
  fi
  # THE PARENT IS THE ONE THAT IS EASY TO MISS. A 0600 root-owned file beside an owner-writable directory can
  # be removed and recreated by that owner, so the file's own permissions certify nothing.
  parent="$(/usr/bin/dirname "$LEDGER")"
  puid="$("$STAT" -f '%u' "$parent" 2>/dev/null || printf '?')"
  poct="$(mode_of "$parent" 2>/dev/null || printf '000')"
  pgrp="$(printf '%s' "$poct" | /usr/bin/cut -c2)"; pwld="$(printf '%s' "$poct" | /usr/bin/cut -c3)"
  case "$pgrp$pwld" in
    *2*|*3*|*6*|*7*)
      LEDGER_REASON="the ledger's parent $parent is mode $poct (group/world writable), so the ledger can be REPLACED rather than edited"; return 1;;
  esac
  # *** THE PARENT MUST BE OWNED BY ROOT, AND THIS CHECK WAS MISSING (Codex r6 finding 2). *** `puid` WAS READ
  # AND ONLY EVER PRINTED IN A MESSAGE. A parent at mode 0755 OWNED BY A NON-ROOT USER passes every mode test
  # above AND THAT USER CAN REPLACE THE LEDGER -- rename their own file over it, or unlink it and write a new one
  # -- so the ledger's own 0600 root ownership certified a file that somebody else controls the name of.
  # "SAFE MODES" AND "SAFE OWNER" ARE TWO CONDITIONS AND ONLY ONE WAS BEING CHECKED.
  # THE COMPARISON IS AGAINST 0, WHICH IS ALSO TRUE UNDER THE FAKE ROOT: the court's declared table reports uid 0
  # for the paths it seeds root-owned, so this is exercised rather than skipped there.
  [ "$puid" = "0" ] || { LEDGER_REASON="the ledger's parent $parent is owned by uid $puid, NOT root, so that uid can replace the ledger whatever its mode (mode $poct). A LEDGER ONLY ROOT CAN REWRITE IS THE WHOLE BASIS FOR BELIEVING IT"; return 1; }
  # AND THE PARENT'S OWN ACL: the file's ACL was checked and the directory's was not, so an allow-ACL on the
  # PARENT let a named principal rename a fresh ledger into place.
  ACL_OUT="$ACL_TMP"; read_acl_write "$parent"; pacl="$(cat "$ACL_TMP")"
  if [ -n "$pacl" ] && printf '%s\n' "$pacl" | "$GREP" -q ' allow '; then
    LEDGER_REASON="the ledger's parent $parent carries an ACL that ALLOWS a non-root principal ($pacl), so the ledger can be replaced rather than edited"; return 1
  fi
  # *** AND THE ANCESTOR CHAIN, WHICH IS WHAT `path_check` ALREADY DOES AND WAS NEVER APPLIED HERE. *** A
  # root-owned 0700 parent under a WORLD-WRITABLE GRANDPARENT can have the whole directory renamed away and
  # replaced, which defeats the two checks above without touching either of them. `path_check` walks every
  # component for symlinks and writability, and it is the same guard the removals use -- SO THE LEDGER IS NOW
  # AUTHENTICATED BY THE SAME RULE AS THE THINGS IT AUTHORISES.
  local chain
  chain="$(path_check "$LEDGER")" && : || { LEDGER_REASON="the ledger's PATH is not confined: $chain"; return 1; }
  return 0
}

# ledger_proves_created <kind> <name> [<expected-id>] — the ONLY authority to delete anything.
#
# *** THE ID IS PART OF THE CLAIM, AND MATCHING ONLY KIND AND NAME IS NOT ENOUGH (Codex r6 finding 6). ***
# The row says `created user aukora-owner uid 450 created by this install`. THE INSTALL MADE **THAT** ACCOUNT,
# NOT WHATEVER IS CALLED `aukora-owner` TODAY. Without the id, this sequence deletes somebody else's account:
#   1. the install creates `aukora-owner` uid 450 and records it;
#   2. the account is deleted by hand, or the machine is re-imaged from a backup;
#   3. A DIFFERENT `aukora-owner` is created -- by a person, by another tool -- with uid 501;
#   4. teardown reads a `created` row for the NAME, matches, AND DELETES THE NEW ACCOUNT.
# THE ROW IS EVIDENCE THAT THIS INSTALL MADE AN ACCOUNT CALLED `aukora-owner` WITH uid 450; IT IS NOT EVIDENCE
# THAT ANY ACCOUNT CALLED `aukora-owner` IS OURS. The caller passes the id the DIRECTORY SERVICE currently
# reports, so the comparison is between the record and reality at the moment of deletion.
#
# WHEN NO ID IS SUPPLIED THE NAME ALONE DECIDES, which is right for DIRECTORIES: a path is its own identity, and
# the ledger's `created directory` rows carry no numeric id to compare.
ledger_proves_created() {
  [ "$LEDGER_OK" = "1" ] || return 1
  local want="${3:-}"
  if [ -z "$want" ]; then
    "$AWK" -F'\t' -v k="$1" -v n="$2" \
      '$1=="created" && $2==k && $3==n { found=1 } END { exit(found?0:1) }' "$LEDGER"
    return $?
  fi
  # THE EVIDENCE FIELD CARRIES `uid 450 created by this install`, SO THE ID IS EXTRACTED FROM IT AND COMPARED.
  # A ROW THAT NAMES THE RIGHT PRINCIPAL WITH A DIFFERENT ID IS NOT A MATCH -- it is the case this exists for.
  "$AWK" -F'\t' -v k="$1" -v n="$2" -v w="$want" '
    $1=="created" && $2==k && $3==n {
      id = $4
      sub(/^(uid|gid) /, "", id)
      sub(/ .*$/, "", id)
      if (id == w) found = 1
      else seen = id
    }
    END { exit(found ? 0 : (seen == "" ? 1 : 2)) }' "$LEDGER"
}

# A NAME IS VALIDATED BEFORE IT IS USED IN A PATH, because a name becomes `/Users/<name>` and an empty or
# crafted one becomes something else entirely. The account names come from the installer's own config, so this
# is a bound on a value that is USUALLY right -- WHICH IS EXACTLY WHEN A BOUND IS WORTH HAVING.
valid_principal_name() {
  case "$1" in
    ""|*/*|*..*|*" "*) return 1;;
    [a-zA-Z_]*) ;;
    *) return 1;;
  esac
  printf '%s' "$1" | "$GREP" -Eq '^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$'
}

if [ -f "$LEDGER" ]; then
  if ledger_authenticate; then
    LEDGER_OK=1
    say ""
    say "  ledger $LEDGER — authenticated (root-owned, $(mode_of "$LEDGER"), no allow ACL, parent not owner-writable):"
    "$AWK" -F'\t' '{ printf "    %-9s %-7s %s\n", $1, $2, $3 }' "$LEDGER"
    # *** EVERY CREATED PRINCIPAL IS ANNOUNCED, NOT JUST ONE OF THEM. *** My first version took `tail -1` of
    # each kind -- and THERE ARE TWO CREATED GROUPS (`aukora-submit` AND `aukora-owner`), so it announced the
    # second and silently omitted the first. The whole point of announcing them is that somebody can confirm
    # the accounts about to be deleted are the ones this install made, AND A LIST THAT SILENTLY OMITS AN ENTRY
    # CANNOT BE CHECKED AGAINST ANYTHING. The court caught exactly this: it expected `aukora-submit` and got
    # `aukora-owner`.
    LEDGER_PRINCIPALS=0
    while IFS="$(printf '\t')" read -r kind what name evidence; do
      [ "$kind" = "created" ] || continue
      case "$what" in user|group) ;; *) continue ;; esac
      LEDGER_PRINCIPALS=$((LEDGER_PRINCIPALS + 1))
      # THE ID IS EXTRACTED FROM THE EVIDENCE. The ledger stores `gid 450 created by this install` -- the
      # evidence is a SENTENCE, because a reader of the file benefits from knowing who wrote the row. The
      # announcement is a FACT A PERSON CHECKS AGAINST `dscl`, so it carries the number and not the sentence.
      # `uid`/`gid`, WHICH ARE THE TWO WORDS A PERSON TYPES INTO `dscl` -- `user id` and `group id` are not
      # names anything accepts, and an announcement whose whole purpose is to be checked against the directory
      # service should use the words that service uses.
      case "$what" in
        user)  id="$(printf '%s' "$evidence" | "$SED" 's/^uid \([0-9][0-9]*\).*/\1/')"; label=uid;;
        group) id="$(printf '%s' "$evidence" | "$SED" 's/^gid \([0-9][0-9]*\).*/\1/')"; label=gid;;
        *)     id="$evidence"; label=id;;
      esac
      say "  the ledger records this install CREATED the $what '$name' ($label $id)"
    done < "$LEDGER"
    [ "$LEDGER_PRINCIPALS" -gt 0 ] || say "  the ledger records NO created principal — nothing will be deleted from the directory service"
  else
    say ""
    say "  LEDGER NOT AUTHENTICATED: $LEDGER_REASON"
    say "  This script will NOT delete any account or group. A LEDGER IS A LIST OF THINGS TO DELETE, so an"
    say "  unauthenticated one is a list somebody else could have written. The install, the service and the"
    say "  plist are still removed below."
  fi
elif [ -f "$MARKER" ]; then
  # THE OLD MARKER IS READ ONLY TO EXPLAIN ITSELF. It cannot authorise a deletion any more: it claimed
  # creation for reused resources, which is the defect. AN OPERATOR WHO INSTALLED BEFORE THIS CHANGE gets a
  # sentence telling them why nothing was deleted rather than a silent no-op.
  say ""
  say "  OLD MARKER at $MARKER and no ledger. This install predates the creation ledger, so this script has NO"
  say "  evidence of what it created — and the marker it does have RECORDED REUSED ACCOUNTS AS CREATED, which"
  say "  is why it is not obeyed. NO ACCOUNT OR GROUP WILL BE DELETED. The install, the service and the plist"
  say "  are still removed below. To remove the accounts, do it yourself once you have checked they are yours:"
  say "      sudo dscl . -read /Users/$OWNER_USER"
  say "      sudo dscl . -delete /Users/$OWNER_USER"
else
  say ""
  say "  NO LEDGER at $LEDGER: this script will NOT delete any account or group. It has no evidence that they"
  say "  were created by this install, and deleting an account that belongs to something else is not an undo —"
  say "  it is a second incident. The install, the service and the plist are still removed below."
fi

say ""; say "1. the service"
if [ "$DRY_RUN" = "1" ]; then
  say "  \$ $LAUNCHCTL print system/$LABEL   # to see whether it is loaded at all"
elif "$LAUNCHCTL" print "system/$LABEL" >/dev/null 2>&1; then
  run "$LAUNCHCTL" bootout "system/$LABEL"
  [ "$DRY_RUN" = "1" ] || { "$LAUNCHCTL" print "system/$LABEL" >/dev/null 2>&1 && refuse "the service is still loaded; not touching anything else"; }
else
  say "  the service is NOT loaded (an already-unloaded job is a finished state, not a failure)"
fi
# *** THE PLIST GOES THROUGH safe_rm, NOT A BARE `rm -f`. *** Codex r5 item 2: this and the config below were
# the only two removals in the file that DID NOT go through `path_check`, SO A PLIST PATH A SYMLINK OR A
# WRITABLE ANCESTOR POINTED AT COULD BE DELETED while every neighbouring removal refused the same condition.
# A CONFINEMENT THAT APPLIES TO MOST REMOVALS IS NOT A CONFINEMENT: the one that skips it is the one that
# matters, because an attacker chooses the weakest door.
# *** EVERY REMOVAL BELOW REQUIRES A `created` ROW FOR THAT PATH (Codex r6 finding 3). ***
# Setup DISTINGUISHES the two cases and records which (`:907` `ledger_reuse` / `:911` `ledger_record
# directory`), so THE EVIDENCE WAS ALREADY THERE AND TEARDOWN SIMPLY DID NOT CONSULT IT: it removed the plist,
# the code, the config and the run root UNCONDITIONALLY, so A REUSED DIRECTORY WAS STILL RECURSIVELY DELETED.
# `$RUN_ROOT` is the one that matters most -- it is removed with `safe_rm`, which recurses.
#
# AND THE REFUSAL IS NOT SILENT: a path that exists but has no `created` row is KEPT and SAID SO, because
# "teardown left something behind" and "teardown declined to remove something it did not make" are different
# facts and an operator needs to know which one they are looking at.
# *** ONE HELPER, SO THE THREE OUTCOMES CANNOT BE CONFLATED. *** My first version chained `&&`/`||` and printed
# "no $X" WHENEVER THE REMOVAL DID NOT HAPPEN -- SO A PATH THAT EXISTED AND WAS DELIBERATELY KEPT WAS REPORTED AS
# ABSENT. "It was not there", "we removed it" and "IT IS THERE AND WE DECLINED TO REMOVE IT" ARE THREE FACTS,
# and an operator reading the summary has to be able to tell them apart.
remove_if_created() { # remove_if_created <what> <path> <literal> [<path for the literal check>]
  local what="$1" path="$2" literal="$3" check="${4:-$2}"
  if [ ! -e "$path" ]; then
    say "  no $what at $path"
    return 0
  fi
  # *** THE PATH'S OWN ROW, OR ITS PARENT'S. *** Setup records SIX `created directory` ROWS -- the owner
  # directory, the run root, the approve directory and the three parents -- AND NOTHING FOR THE PLIST, THE
  # CONFIG OR THE CODE. So asking for a row naming the plist asked for a row that NEVER EXISTS, AND THREE OF THE
  # FOUR REMOVALS REFUSED ON A CORRECT INSTALL. MEASURED, on the court's first run after the fixture was fixed:
  #     FAIL the plist is gone / FAIL the installed code is gone / FAIL the config is gone / ok the run root is gone
  # -- the run root worked because IT is one of the six, and the other three are FILES inside recorded
  # directories.
  #
  # THE PARENT'S ROW IS THE HONEST EVIDENCE HERE: "this install created the directory that holds this file" is
  # what the ledger actually recorded, and it is a real claim rather than an assumed one. IT IS WEAKER THAN A ROW
  # FOR THE FILE ITSELF, AND THAT WEAKNESS IS NAMED RATHER THAN HIDDEN: a file placed by hand into a directory
  # this install created would be removed. The stronger fix is for SETUP to record each file it writes, and that
  # is the next change if this one proves too loose.
  local parent_check
  parent_check="$(/usr/bin/dirname "$check")"
  # *** THE PATH'S OWN ROW IN EITHER KIND, OR ITS PARENT'S. *** Setup now records a `file` row for the config and
  # the plist AT THE MOMENT IT WRITES THEM, and `$LIBEXEC_T` as a directory in its own right -- because
  # `/usr/local/etc`, `/Library/LaunchDaemons` and `/usr/local/libexec` ALL PRE-EXIST ON A MAC, so the parent
  # rows can be absent for a file this install definitely wrote. The own-row check is the strong one; the
  # parent's stays for the directories created inside a recorded tree.
  if ! ledger_proves_created file "$check" && ! ledger_proves_created directory "$check" \
     && ! ledger_proves_created directory "$parent_check"; then
    say "  KEPT: $what at $path -- the ledger records no 'created directory' row for it OR for $parent_check, so"
    say "        this install did not make either. REMOVING IT WOULD DELETE SOMETHING THAT WAS HERE FIRST, which"
    say "        is the defect Codex r6 raised. Remove it by hand if you know it is yours."
    return 0
  fi
  safe_rm "$path" "$literal"
}
remove_if_created "the plist" "$PLIST" /Library/LaunchDaemons/com.aukora.owner.plist

say ""; say "2. installed code and config"
remove_if_created "the installed code" "$LIBEXEC" /usr/local/libexec/aukora-owner
remove_if_created "the config" "$CONFIG" /usr/local/etc/aukora-owner.json

say ""; say "3. the run root (sockets and logs only — the record is elsewhere)"
remove_if_created "the run root" "$RUN_ROOT" "/Library/Application Support/AUKORA-Run"

say ""; say "4. the settlement record"
if [ -d "$OWNER_DIR" ]; then
  if [ "$DELETE_RECORD" = "1" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      say "  (dry run: would ask you to type the path, then delete $OWNER_DIR)"
    else
      say "  TYPE THE PATH EXACTLY to destroy the record, or anything else to abort:"
      printf '  > '; read -r typed
      [ "$typed" = "$OWNER_DIR" ] || refuse "the typed path did not match; nothing was deleted"
      say "  typed path matches — destroying the record"
    fi
    safe_rm "$OWNER_DIR" "/Library/Application Support/AUKORA-Owner"
  else
    # RULE 1: root owns the record BEFORE the uid that owns it stops existing.
    if [ "$DRY_RUN" = "1" ]; then
      say "  (dry run: would chown -R root:wheel and chmod -R go-rwx $OWNER_DIR, then keep it)"
    else
      # *** A RECURSIVE OWNERSHIP CHANGE IS A MUTATION OF EVERY FILE UNDER THE PATH, SO IT NEEDS THE SAME
      # CONFINEMENT AS A DELETE (Codex r5 item 2). *** `chown -R` and `chmod -R` were the other bypass: they
      # walk the whole tree, FOLLOW the path's components, and on a path that is a symlink or sits under a
      # writable ancestor they change the ownership of files this install never created.
      # A REFUSAL HERE IS FATAL RATHER THAN SKIPPED: the record must become root-only BEFORE the account that
      # owns it is retired, and a record left owned by a uid that is about to stop existing is the exact
      # condition R12 was written for.
      bad="$(path_check "$OWNER_DIR")" && : || refuse "refusing to chown -R the record: $bad"
      run "$CHOWN" -R root:wheel "$OWNER_DIR"
      run "$CHMOD" -R go-rwx "$OWNER_DIR"
      say "  KEPT and now genuinely root-only: $OWNER_DIR ($("$STAT" -f '%Sp %Su:%Sg' "$OWNER_DIR"))"
      say "  the account that owned it is retired below, so no reusable uid can reach its contents."
    fi
  fi
else
  say "  no $OWNER_DIR"
fi

say ""; say "5. the principals — ONLY what the LEDGER proves this install created"
# *** THE LEDGER IS THE ONLY AUTHORITY, AND THE NAME IS VALIDATED BEFORE IT BECOMES A PATH. ***
# A name here becomes `/Users/<name>`, so an empty or crafted one deletes something else entirely. These names
# come from the installer's own config, which is exactly when a bound is worth having: THE VALUE IS USUALLY
# RIGHT, SO NOTHING ELSE WOULD CATCH THE DAY IT IS NOT.
delete_user() {
  local name="$1" got
  valid_principal_name "$name" || { say "  REFUSING account '$name': not a valid principal name, and a name becomes /Users/<name>"; return 0; }
  "$DSCL" . -read "/Users/$name" >/dev/null 2>&1 || { say "  no account $name"; return 0; }
  # *** THE LIVE uid IS READ FIRST AND PASSED INTO THE CHECK (Codex r6 finding 6). *** It used to be read only
  # in the FAILURE branch, for the message -- so the check itself compared the NAME ALONE, AND A REPLACEMENT
  # ACCOUNT WITH THE SAME NAME AND A DIFFERENT uid WAS DELETED. The row is evidence that this install made an
  # account called `$name` WITH A PARTICULAR uid; it is not evidence that whatever carries that name today is ours.
  got="$("$DSCL" . -read "/Users/$name" UniqueID 2>/dev/null | "$AWK" '{print $2}')"
  ledger_proves_created user "$name" "${got:-}"
  case "$?" in
    0) ;;
    2) say "  NOT deleting account $name: the ledger records a `created` row for that NAME, BUT WITH A DIFFERENT uid."
       say "    It currently has uid ${got:-?}. THE ACCOUNT THIS INSTALL MADE IS GONE AND THIS IS SOMEBODY ELSE'S:"
       say "    a row naming the right principal with the wrong id is exactly the case this check exists for."
       return 0;;
    *) say "  NOT deleting account $name: the ledger does not record that THIS install created it."
       if [ "$LEDGER_OK" != "1" ]; then
         say "    (the ledger was not authenticated: $LEDGER_REASON)"
       else
         say "    It records it as reused, or does not mention it — either way it is not this script's to delete."
       fi
       say "    It currently has uid ${got:-?}. Delete it yourself if you are sure:  sudo dscl . -delete /Users/$name"
       return 0;;
  esac
  run "$DSCL" . -delete "/Users/$name"
}
delete_group() {
  local name="$1" got
  valid_principal_name "$name" || { say "  REFUSING group '$name': not a valid principal name, and a name becomes /Groups/<name>"; return 0; }
  "$DSCL" . -read "/Groups/$name" >/dev/null 2>&1 || { say "  no group $name"; return 0; }
  # THE LIVE gid IS READ FIRST AND PASSED IN, for the same reason as the account above.
  got="$("$DSCL" . -read "/Groups/$name" PrimaryGroupID 2>/dev/null | "$AWK" '{print $2}')"
  ledger_proves_created group "$name" "${got:-}"
  case "$?" in
    2) say "  NOT deleting group $name: the ledger records a `created` row for that NAME, BUT WITH A DIFFERENT gid."
       say "    It currently has gid ${got:-?}. THE GROUP THIS INSTALL MADE IS GONE AND THIS IS SOMEBODY ELSE'S."
       return 0;;
    0) ;;
    *) say "  NOT deleting group $name: the ledger does not record that THIS install created it."
    if [ "$LEDGER_OK" != "1" ]; then
      say "    (the ledger was not authenticated: $LEDGER_REASON)"
    else
      say "    It records it as reused, or does not mention it — either way it is not this script's to delete."
    fi
    say "    It currently has gid ${got:-?}. Delete it yourself if you are sure:  sudo dscl . -delete /Groups/$name"
    return 0;;
  esac
  run "$DSCL" . -delete "/Groups/$name"
}
delete_group "$SUBMIT_GROUP"
# THE OWNER'S OWN GROUP WAS NEITHER RECORDED NOR REMOVED BEFORE (Codex r5): setup creates it, and teardown
# never knew its name. It is in the ledger now, so it is removed here -- on the same evidence as everything
# else, which means a pre-existing group of that name is still preserved.
delete_group "$OWNER_USER"
delete_user "$OWNER_USER"
if [ "$DELETE_RECORD" != "1" ] && [ -d "$OWNER_DIR" ] && [ "$DRY_RUN" = "0" ]; then
  say "  (the record is now root-owned, so retiring the account does not orphan it)"
fi

say ""
say "DONE. Peter's account, Electron, the lanes, the checkout and /Applications were never touched."
say "WHAT THIS DOES NOT DO: it does not restore anything the install replaced (the installer refuses to"
say "overwrite an existing install unless you passed --replace), and it does not delete an account or group"
say "the marker does not name. If the account is gone but the record is kept, re-creating that account with"
say "a DIFFERENT uid will not give it access to the record — root owns it now, deliberately."
