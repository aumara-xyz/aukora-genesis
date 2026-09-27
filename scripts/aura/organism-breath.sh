#!/usr/bin/env bash
#
# organism-breath.sh — the morning check. Four legs, READ-ONLY, one exit code.
#
# WHAT IT ANSWERS: is the newest settled record for Peter's subject still retained outside the store,
# still recallable with a citation, still exportable, and still verifiable by the vendored Diamond from
# an empty cwd as a stranger? A4 proved that once, by hand, with a settlement attached. This is the same
# four legs with the settlement removed, so it can be run every morning and changes nothing.
#
# IT WRITES NOTHING TO THE STORE. Every artifact goes to a scratch directory that is deleted on exit.
# There is no `--commit` here and no code path that settles, stages, spends a nonce or appends an Aura
# entry; the store is opened by readers only. `--keep` leaves the scratch directory for inspection.
#
# EXIT: 0 all four legs hold · 1 a leg failed, named · 2 usage · 4 the store is not readable.
#
# PINS ARE READ LIVE, never remembered: the launch record names the port, pid, release and genesis; the
# release on disk names the shell's digest; the deployment's own config file is hashed; and the subject
# comes from the overlay the deployment actually loads.
set -uo pipefail

# THE TRAP IS INSTALLED BEFORE THE ARGUMENTS ARE PARSED, because a usage refusal is an exit too and it
# was the one exit that printed no ceiling: MEASURED, `--subject not-a-subject` printed 0 CEILING lines
# while success and RED each printed 4. That is exactly the plan's 4c — "usage errors print no ceilings"
# — and it survived the first version of this fix. `$SCRATCH` is empty until it is created, so the
# guard is not decoration: an unguarded `rm -rf ""` is not a cleanup.
# DEFINED BEFORE THE TRAP AND BEFORE THE ARGUMENTS ARE READ: bash resolves a function name when the
# trap RUNS, and a usage refusal exits before the later half of this file is ever reached — so a
# ceiling defined below the argument parsing prints nothing on exactly the exit the plan names (4c).
# MEASURED twice: 0 CEILING lines on `--subject not-a-subject` with the definition below, 4 with it here.
ceiling() {
  cat <<'CEIL'
CEILING: ORGANISM_BREATH_ONE_RECORD — the four legs report on ONE record, the one the recall leg
         named, not on the store and not on any other row in it.
CEILING: RETAINER_SAME_OWNER — the head is retained on THIS disk. A second directory on this host is
         not a second device, so this is not a durability claim. COMPLETENESS is a statement about a
         prefix, never about the tip.
CEILING: VENDORED_CONSUMER — verification is by the vendored Diamond pinned at 0d3cc66 in this
         repository, not by an independent implementation of the same format.
CEILING: STORE_READ_NOT_LIVE — the store was READ. Nothing here says the running app has seen these
         bytes, is serving them, or would agree with this reading.
CEIL
}
SCRATCH=""
cleanup() {
  echo ""; ceiling
  [ -n "$SCRATCH" ] || return 0
  if [ -n "$KEEP" ]; then echo "  scratch kept: $SCRATCH"; else rm -rf "$SCRATCH"; fi
}
trap cleanup EXIT

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUKORA="${AUKORA_HOME:-$HOME/Library/Application Support/AUKORA}"
LAUNCH="${AUKORA_LIVE_STATE:-$AUKORA/state/launch.json}"
OVERLAY="${AUKORA_OVERLAY:-$AUKORA/kira-deployment-overlay.patch.yml}"
CONFIG="${AUKORA_CONFIG:-$AUKORA/config.json}"

STATE=""; SUBJECT=""; RETAINED=""; KEEP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --state) STATE="${2:-}"; shift 2 ;;
    --subject) SUBJECT="${2:-}"; shift 2 ;;
    --retained) RETAINED="${2:-}"; shift 2 ;;
    --keep) KEEP="1"; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "REFUSED: unknown argument $1" >&2; exit 2 ;;
  esac
done

# ── the store, and the subject this deployment serves ────────────────────────────────────────────
[ -n "$STATE" ] || STATE="$AUKORA/state/home/kira-memory"
[ -d "$STATE" ] || { echo "REFUSED: no Kira store at $STATE" >&2; exit 4; }
if [ -z "$SUBJECT" ]; then
  SUBJECT="$(python3 -c "
import re, sys
try:
    text = open(sys.argv[1], encoding='utf-8').read()
except Exception:
    print(''); raise SystemExit
match = re.search(r'^\s*subject:\s*(aukora:1:[0-9a-f]{64})\s*$', text, re.M)
print(match.group(1) if match else '')
" "$OVERLAY" 2>/dev/null)"
fi
if ! printf '%s' "$SUBJECT" | grep -Eq '^aukora:1:[0-9a-f]{64}$'; then
  echo "REFUSED: no usable subject (--subject unset and the overlay at $OVERLAY names none)" >&2
  exit 2
fi

# ── pins, all read live ──────────────────────────────────────────────────────────────────────────
PORT="$(python3 -c "
import json,sys
try: print(json.load(open(sys.argv[1])).get('port') or '')
except Exception: print('')
" "$LAUNCH" 2>/dev/null)"
LIVE_RELEASE="$(python3 -c "
import json,sys
try: print(json.load(open(sys.argv[1])).get('release') or '')
except Exception: print('')
" "$LAUNCH" 2>/dev/null)"
GENESIS="$(python3 -c "
import json,sys
try: print(str(json.load(open(sys.argv[1])).get('genesisCommit') or ''))
except Exception: print('')
" "$LAUNCH" 2>/dev/null)"
PID=""; [ -n "$PORT" ] && PID="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
SHELL_PIN="ABSENT (no launch record)"; SHELL_DIGEST=""
for candidate in apps/desktop/lib/main.js apps/aukora-desktop/main.mjs; do
  if [ -n "$LIVE_RELEASE" ] && [ -f "${LIVE_RELEASE%/}/$candidate" ]; then
    SHELL_DIGEST="$(shasum -a 256 "${LIVE_RELEASE%/}/$candidate" | cut -c1-40)"
    SHELL_PIN="$SHELL_DIGEST ($candidate in the live release)"
    break
  fi
done
CONFIG_PIN="ABSENT"; [ -f "$CONFIG" ] && CONFIG_PIN="$(shasum -a 256 "$CONFIG" | cut -c1-40)"

echo "AURA ORGANISM BREATH — read-only; nothing is settled and the store is only ever read"
echo "  port      : ${PORT:-unknown}"
echo "  pid       : ${PID:-NONE}"
echo "  release   : ${LIVE_RELEASE:-unknown}"
echo "  genesis   : ${GENESIS:-unknown}"
echo "  shell sha : $SHELL_PIN"
echo "  config sha: $CONFIG_PIN"
echo "  subject   : $SUBJECT"
echo "  store     : $STATE"
echo ""

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/aura-breath-XXXXXX")"

FAILED=0
note() { printf '  %-9s %s\n' "$1" "$2"; }

# ── LEG 1: the head, retained OUTSIDE the store ──────────────────────────────────────────────────
RETAIN_OUT="$(node "$ROOT/scripts/kira/retain-head.mjs" retain --state "$STATE" --retain "$SCRATCH/retained" 2>&1)"
RETAIN_CODE=$?
FRESH_ROOT="$(printf '%s\n' "$RETAIN_OUT" | grep -m1 -oE 'root [0-9a-f]{64}' | sed 's/root //')"
if [ "$RETAIN_CODE" -ne 0 ] || [ -z "$FRESH_ROOT" ]; then
  note "retain" "RED — the head could not be retained: $(printf '%s' "$RETAIN_OUT" | head -1 | cut -c1-80)"
  FAILED=$((FAILED + 1))
else
  # THE RETAINED HEAD MUST AGREE WITH THE STORE. If an earlier retained copy is supplied, its root is
  # compared to a FRESH retain of the store: agreement means the copy still describes the store, and a
  # difference means the store has moved on or the copy was tampered with — either way the retained
  # evidence no longer describes what is here, which is the whole point of retaining it.
  if [ -n "$RETAINED" ]; then
    # THE RETAINED LOG IS NAMED, NOT WHATEVER SORTS FIRST. This read `glob(**/*.json)[0]`, so the
    # verdict depended on FILESYSTEM ORDER rather than on the evidence: MEASURED — the same genuine
    # retain, plus a decoy called AAA-decoy.json carrying a wrong root, turned a passing check RED. The
    # same fault runs the other way: a directory whose first file happens to agree reports agreement
    # while the retained log itself disagrees. retain-head writes exactly ONE file,
    # `aukora-kira-memory-log-v1.json`, so that is what is read, and its absence or ambiguity is a
    # refusal by name rather than a quiet fallback to a neighbour.
    PRIOR="$(python3 -c "
import glob, os, sys
files = glob.glob(os.path.join(sys.argv[1], '**', 'aukora-kira-memory-log-v1.json'), recursive=True)
print(files[0] if len(files) == 1 else '')
" "$RETAINED" 2>/dev/null)"
    if [ -z "$PRIOR" ]; then
      note "retain" "RED — $RETAINED holds no single aukora-kira-memory-log-v1.json to compare against"
      FAILED=$((FAILED + 1))
      PRIOR_ROOT=""
    else
      PRIOR_ROOT="$(python3 -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('root') or '')
except Exception:
    print('')
" "$PRIOR" 2>/dev/null)"
    fi
    if [ -n "$PRIOR" ] && [ -z "$PRIOR_ROOT" ]; then
      note "retain" "RED — the retained copy at $PRIOR names no root"
      FAILED=$((FAILED + 1))
    elif [ -n "$PRIOR_ROOT" ] && [ "$PRIOR_ROOT" != "$FRESH_ROOT" ]; then
      note "retain" "RED — the retained head ${PRIOR_ROOT:0:16}… DISAGREES with the store's ${FRESH_ROOT:0:16}…"
      FAILED=$((FAILED + 1))
    else
      note "retain" "ok — retained head ${FRESH_ROOT:0:16}… agrees with the store and with the copy supplied"
    fi
  else
    note "retain" "ok — head retained outside the store, root ${FRESH_ROOT:0:16}…"
  fi
fi

# ── LEG 2: recall, with its citation ─────────────────────────────────────────────────────────────
RECALL_OUT="$(node "$ROOT/scripts/aura/recall-cite.mjs" --state "$STATE" --subject "$SUBJECT" 2>&1)"
RECALL_CODE=$?
if [ "$RECALL_CODE" -ne 0 ]; then
  note "recall" "RED — $(printf '%s' "$RECALL_OUT" | head -1 | cut -c1-88)"
  FAILED=$((FAILED + 1))
else
  note "recall" "ok — $(printf '%s' "$RECALL_OUT" | head -1 | sed 's/^RECALL: //' | cut -c1-84)"
fi
# THE RECORD THIS CHECK IS ABOUT, NAMED BY THE LEG THAT FOUND IT. The stranger leg below must verify
# THIS record — the one the store's own read path returned — and not whichever file happens to sort
# first. The citation's contentSha256 is the export's own file name, so the selection is forced by
# evidence rather than by `ls`.
RECALL_SHA="$(printf '%s' "$RECALL_OUT" | grep -oE 'contentSha256 [0-9a-f]{64}' | head -1 | sed 's/contentSha256 //')"

# ── LEG 3: the export, with the store's public half written OUTSIDE it ───────────────────────────
PIN="$SCRATCH/issuer-pin.json"
python3 - "$STATE" "$PIN" <<'PY' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1] + '/issuer.json'))
json.dump({k: v for k, v in d.items() if 'public' in k.lower()}, open(sys.argv[2], 'w'), indent=2)
PY
if [ ! -s "$PIN" ]; then
  note "export" "RED — the store names no public half in issuer.json"
  FAILED=$((FAILED + 1))
elif [ ${#GENESIS} -ne 40 ]; then
  note "export" "RED — the launch record names no 40-hex genesis commit to attribute the export to"
  FAILED=$((FAILED + 1))
else
  EXPORT="$SCRATCH/export"
  EXPORT_OUT="$(node "$ROOT/scripts/kira/public-evidence.mjs" export --store "$STATE" --out "$EXPORT" \
    --producer-commit "$GENESIS" --release "${LIVE_RELEASE:-unknown}" --anchor "issuer=$PIN" 2>&1)"
  if [ $? -ne 0 ]; then
    note "export" "RED — $(printf '%s' "$EXPORT_OUT" | head -1 | cut -c1-88)"
    FAILED=$((FAILED + 1))
  else
    note "export" "ok — $(printf '%s' "$EXPORT_OUT" | grep -c ':') facts, producer ${GENESIS:0:12}…"
  fi
fi

# ── LEG 4: the stranger — Diamond, from an EMPTY cwd ─────────────────────────────────────────────
DIAMOND="$ROOT/vendor/kira-export/scripts/verify-kira-evidence.py"
DIAMOND_PIN="0d3cc66"
DIAMOND_COMMIT="$(python3 -c "
import json, sys
try: print(json.load(open(sys.argv[1])).get('commit') or '')
except Exception: print('')
" "$ROOT/vendor/kira-export/upstream-diamond.json" 2>/dev/null)"
if [ -z "$DIAMOND_COMMIT" ] || [ "${DIAMOND_COMMIT#"$DIAMOND_PIN"}" = "$DIAMOND_COMMIT" ]; then
  note "stranger" "RED — the vendored Diamond is not the ${DIAMOND_PIN} this check names"
  FAILED=$((FAILED + 1))
elif [ ! -f "$DIAMOND" ]; then
  note "stranger" "RED — LEG_MISSING (vendor/kira-export)"
  FAILED=$((FAILED + 1))
elif [ ! -s "$PIN" ]; then
  note "stranger" "skipped — the export did not happen, so there is nothing to verify"
else
  ANCHOR="$SCRATCH/anchor.pem"
  python3 - "$PIN" "$ANCHOR" <<'PY' 2>/dev/null
import json, sys
pem = json.load(open(sys.argv[1]))['publicKey']
open(sys.argv[2], 'w').write(pem if pem.endswith('\n') else pem + '\n')
PY
  # THE RECORD THE CHECK IS ABOUT, NOT WHATEVER SORTS FIRST. These three read
  # `ls .../*.json | head -1`, and `ls` sorts lexicographically: MEASURED against the LIVE store, whose
  # export carries TWO records — a2cc95817ce17233… and c3ae0afb1cfc3dac… — `head -1` took a2cc9581…,
  # the FIRST, not the newest. The verdict printed below was therefore about a record the check never
  # chose, while the newest record, the one the settlement produced, went unverified. The name now comes
  # from the recall leg's own citation, so the stranger verifies the same bytes the rest of the check
  # names; a missing one is a refusal rather than a neighbour.
  if [ -z "$RECALL_SHA" ]; then
    note "stranger" "RED — the recall leg named no contentSha256, so there is no record to verify"
    FAILED=$((FAILED + 1))
    R=""; T=""; C=""
  else
    R="$SCRATCH/export/evidence/records/$RECALL_SHA.json"
    T="$SCRATCH/export/evidence/receipts/$RECALL_SHA.json"
    C="$SCRATCH/export/evidence/objects/$RECALL_SHA.json"
  fi
  if [ -z "$R" ] || [ ! -s "$R" ] || [ ! -s "$T" ] || [ ! -s "$C" ] || [ ! -s "$ANCHOR" ]; then
    note "stranger" "RED — the export does not carry the record the recall leg named ($RECALL_SHA)"
    FAILED=$((FAILED + 1))
  else
    EMPTY="$(mktemp -d)"
    DV="$(cd "$EMPTY" && python3 "$DIAMOND" --record "$R" --receipt "$T" \
      --log "$SCRATCH/export/evidence/aura.jsonl" --anchor "$ANCHOR" \
      --artifact-content "$C" --package-root "$ROOT/vendor/kira-export" 2>&1 | grep -m1 '^VERDICT:')"
    rm -rf "$EMPTY"
    case "$DV" in
      *VERIFIED*) note "stranger" "ok — $DV [diamond ${DIAMOND_COMMIT:0:7}, empty cwd]" ;;
      *) note "stranger" "RED — ${DV:-no verdict was printed}"; FAILED=$((FAILED + 1)) ;;
    esac
  fi
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "ORGANISM BREATH: BREATHING — retained, recallable, exportable and verifiable; nothing was written"
  exit 0
fi
echo "ORGANISM BREATH: RED — $FAILED leg(s) failed; see the named legs above"
exit 1
