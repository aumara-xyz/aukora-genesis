#!/usr/bin/env bash
# post-relaunch-check.sh — the first thing to run after Peter reopens the app.
#
# READ-ONLY. It starts nothing, restarts nothing, writes nothing, and settles nothing. Every leg is a
# question asked of something that is already running or already on disk.
#
# ONE VERDICT LINE, AND EVERY FAILING LEG NAMED. A check that says "not ready" without saying which leg
# failed sends the reader back to the beginning; a check that says "ready" while a leg was never asked is
# the defect this lane has spent the session finding. So each leg is either ok, RED, or NAMED AS
# UNCHECKABLE — never silently absent.
#
# EVERY SOURCE IS OVERRIDABLE BY ENVIRONMENT. That is not configuration for its own sake: it is what lets
# the court force each leg to fail from a fixture, which is the only way to know a leg can fail at all.
set -uo pipefail

ROOT="${AUKORA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ALPHA_REPORT="${AUKORA_ALPHA_REPORT:-$ROOT/.agents/live/reports/ALPHA.md}"
STATE="${AUKORA_STATE:-$HOME/Library/Application Support/AUKORA/state}"
# THE STATE DIRECTORY IS THE ONE PLACE THESE LIVE, and every one of the five defaults below was stale on
# the first real relaunch. The lesson is not "use different constants" — it is that a check which
# REMEMBERS a port or a path reports its own age instead of the app's state. So: read what the app
# publishes, derive what it does not, and NAME the leg when neither is possible.
SERVER_LOG="${AUKORA_SERVER_LOG:-$STATE/logs/server.log}"          # state/logs/, not state/
LAUNCH_RECORD="${AUKORA_LAUNCH_RECORD:-$STATE/launch.json}"
LANE_PORT_FILE="${AUKORA_LANE_PORT_FILE:-$STATE/lane-door/port}"   # the shell publishes this
VOICE_PORT="${AUKORA_VOICE_PORT:-7512}"                            # the overlay's voicePort default

# THE LANE DOOR'S PORT IS READ FROM THE FILE THE APP WRITES. The eye door has no port file: it is the
# SAME PROCESS'S OTHER LISTENER, so it is found from the lane door's pid rather than assumed to be
# adjacent-and-usually-59410 — which is what this check did, and 59410 was nothing after the relaunch.
lane_port() { [ -s "$LANE_PORT_FILE" ] && tr -d '\n' < "$LANE_PORT_FILE"; }
LANE_PID="$(lane_port >/dev/null 2>&1 && lsof -nP -iTCP:"$(lane_port)" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $2}')"
eye_port() {
  [ -n "$LANE_PID" ] || return 1
  lsof -nP -iTCP -sTCP:LISTEN -a -p "$LANE_PID" 2>/dev/null \
    | awk -v skip="$(lane_port)" 'NR>1 { split($9, a, ":"); if (a[2] != skip) print a[2] }' | head -1
}
LANE_DOOR="${AUKORA_LANE_DOOR:-$( [ -n "$(lane_port)" ] && echo "http://127.0.0.1:$(lane_port)" )}"
EYE_DOOR="${AUKORA_EYE_DOOR:-$( [ -n "$(eye_port)" ] && echo "http://127.0.0.1:$(eye_port)" )}"
EMPTY_STORE_ALLOWED="${AUKORA_POST_RELAUNCH_FAST:-}"

FAILED=0
LEGS=0

# THE CEILINGS PRINT ON EVERY EXIT, refusals included — the R19 rule, kept because the runs that most need
# the limits stated are the ones that could not check.
ceiling() {
  echo ""
  echo "CEILING: this check reads files and asks two ports. It cannot see the app's own view of itself,"
  echo "         it cannot tell a lane that is working quietly from one that has stopped, and a leg that"
  echo "         passes here has been checked ONCE, at this moment, not continuously."
}
trap 'ceiling' EXIT

leg() { # name, ok?, detail
  LEGS=$((LEGS + 1))
  if [ "$2" = "ok" ]; then printf '  ok    %-22s %s\n' "$1" "$3"
  else printf '  RED   %-22s %s\n' "$1" "$3"; FAILED=$((FAILED + 1)); fi
}

named_missing() { # name, path
  LEGS=$((LEGS + 1))
  printf '  NAMED %-22s %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

echo "POST-RELAUNCH CHECK — read-only, nothing started, nothing written"

# ── LEG 1: live == disk, and each staged path named ───────────────────────────────────────────
if [ -n "$EMPTY_STORE_ALLOWED" ] && [ ! -f "$ROOT/scripts/organism-live.sh" ]; then
  named_missing organism-live "scripts/organism-live.sh is not present"
else
  LIVE="$(bash "$ROOT/scripts/organism-live.sh" 2>&1)"
  # The same shape as the breath leg: `NOT LIVE_MOUNTED` contains `LIVE_MOUNTED`.
if printf '%s' "$LIVE" | grep -q 'ORGANISM-LIVE: LIVE_MOUNTED'; then
    leg organism-live ok "live == disk"
  else
    STAGED="$(printf '%s' "$LIVE" | grep -o 'STAGED-NOT-RUNNING.*' | head -1 | cut -c1-90)"
    leg organism-live red "${STAGED:-$(printf '%s' "$LIVE" | tail -1 | cut -c1-90)}"
  fi
fi

# ── LEG 2: the running release and shell match the RELAUNCH READY line ────────────────────────
# The line is READ, never remembered. A check that carries its own expected values cannot notice that the
# app moved on without it, which is the whole question a post-relaunch check exists to answer.
if [ ! -s "$ALPHA_REPORT" ]; then
  named_missing release-vs-ALPHA "$ALPHA_REPORT is absent"
else
  ALPHA_ALL="$(cat "$ALPHA_REPORT")"
  READY="$(printf '%s' "$ALPHA_ALL" | grep -o 'RELAUNCH READY (release [^)]*)' | head -1)"
  if [ -z "$READY" ]; then
    named_missing release-vs-ALPHA "no RELAUNCH READY line in $(basename "$ALPHA_REPORT")"
  else
    # THE LINE IS PARENTHESISED: `RELAUNCH READY (release bd69f9cd + shell 54eae390…)`. The first
    # parser looked for `release=` and returned '<none>' against a line that says `release ` — and it
    # matched a PROSE mention of the phrase before the real one, so it is anchored to the form itself.
    READY="$(printf '%s' "$ALPHA_ALL" | grep -o 'RELAUNCH READY (release [^)]*)' | head -1)"
    WANT_RELEASE="$(printf '%s' "$READY" | sed -n 's/.*release \([A-Za-z0-9._/-]*\).*/\1/p')"
    WANT_SHELL="$(printf '%s' "$READY" | sed -n 's/.*shell \([A-Za-z0-9._/-]*\).*/\1/p')"
    HAVE_RELEASE="$(python3 -c "
import json,sys
try: print(json.load(open(sys.argv[1])).get('release',''))
except Exception: print('')
" "$LAUNCH_RECORD" 2>/dev/null)"
    HAVE_SHELL="$(printf '%s' "$HAVE_RELEASE" | xargs -I{} sh -c '[ -n "{}" ] && find "{}" -name "index.html" -maxdepth 3 2>/dev/null | head -1' | xargs -I{} shasum -a 256 {} 2>/dev/null | cut -c1-12)"
    # A PREFIX MATCH: ALPHA writes the short commit (`bd69f9cd`) and the release directory is
    # `aukora-release-bd69f9cd`. Comparing them whole reported RED against a matching pair.
    HAVE_BASE="$(basename "${HAVE_RELEASE:-}")"
    case "$HAVE_BASE" in
      *"$WANT_RELEASE"*) RELEASE_MATCHES=1 ;;
      *) RELEASE_MATCHES=0 ;;
    esac
    if [ -n "$WANT_RELEASE" ] && [ "$RELEASE_MATCHES" = "1" ]; then
      leg release-vs-ALPHA ok "release matches ${WANT_RELEASE} (${HAVE_BASE})"
    else
      leg release-vs-ALPHA red "ALPHA says '${WANT_RELEASE:-<none>}', the launch record says '$(basename "${HAVE_RELEASE:-<none>}")'"
    fi
    # NAME IT, DO NOT GUESS IT. I could not determine what ALPHA's `shell <64-hex>` digests: it is not the
    # sha256 of the shell's main.js, of the release's index.html, or of its package.json — measured against
    # all three in `aukora-release-bd69f9cd`. A leg that compares against a source I invented would report
    # RED against a shell that is fine, which is the same defect as a leg that reports ok without asking.
    # So this leg states both values and says plainly that the comparison is not established.
    if [ -z "$WANT_SHELL" ]; then
      leg shell-vs-ALPHA ok "ALPHA names no shell digest"
    else
      named_missing shell-vs-ALPHA "ALPHA names shell ${WANT_SHELL:0:12}…; what it digests is NOT ESTABLISHED (not main.js, index.html or package.json in the release) — compare by hand"
    fi
  fi
fi

# ── LEGS 3-4: both doors answer 401 to a stranger ─────────────────────────────────────────────
# THE PROBE IS THE DOOR'S OWN PATH, NOT `/`. A bare GET to either door answers **405 Method Not Allowed**
# — measured — because these are POST endpoints, and a check that asks `/` reports RED against a door that
# is working perfectly. The paths are the ones the shipped clients use: `POST /lane/send` (lane) and
# `/eye/capture` (eye, per `plugins/aukora-eye/lib/live-check.mjs`).
ask_door() { # name, url, path
  if [ -z "$2" ]; then named_missing "$1" "no port published or derivable — not assumed"; return; fi
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -d '{}' "$2$3" 2>/dev/null)"
  case "$CODE" in
    401) leg "$1" ok "401 to a stranger" ;;
    000|"") named_missing "$1" "no answer from $2" ;;
    *) leg "$1" red "answered $CODE, not 401" ;;
  esac
}
ask_door lane-door "$LANE_DOOR" "/lane/send"
ask_door eye-door "$EYE_DOOR" "/eye/capture"

# ── LEG 5: the voice sidecar is listening ─────────────────────────────────────────────────────
if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$VOICE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    leg voice-sidecar ok "listening on $VOICE_PORT"
  else
    leg voice-sidecar red "nothing listening on $VOICE_PORT"
  fi
else
  named_missing voice-sidecar "lsof is not available to ask about port $VOICE_PORT"
fi

# ── LEG 6: the voice runtime logged itself ────────────────────────────────────────────────────
if [ ! -s "$SERVER_LOG" ]; then
  named_missing voice-lines "$SERVER_LOG is absent"
elif grep -q '\[apps\] auma-live voice:' "$SERVER_LOG"; then
  leg voice-lines ok "$(grep -c '\[apps\] auma-live voice:' "$SERVER_LOG") line(s) in server.log"
else
  leg voice-lines red "no '[apps] auma-live voice:' line in $(basename "$SERVER_LOG")"
fi

# ── LEG 7: the organism breathes ──────────────────────────────────────────────────────────────
BREATH="$(bash "$ROOT/scripts/aura/organism-breath.sh" 2>&1)"
# MEASURED, AND IT WAS MY OWN FAIL-OPEN: this grepped for `BREATHING`, which `NOT BREATHING` also
# contains — so the leg reported ok on the exact output that says the organism is NOT breathing. The
# positive verdict is matched whole.
if printf '%s' "$BREATH" | grep -q 'ORGANISM BREATH: BREATHING'; then
  leg organism-breath ok "BREATHING"
else
  leg organism-breath red "$(printf '%s' "$BREATH" | tail -1 | cut -c1-90)"
fi

# ── LEG 8: the evidence bundle verifies ───────────────────────────────────────────────────────
STORE="${AUKORA_KIRA_STORE:-$HOME/Library/Application Support/AUKORA/state/home/kira-memory}"
OUT="$(mktemp -d)"
if bash "$ROOT/scripts/aura/evidence-bundle.sh" --store "$STORE" --out "$OUT" >/dev/null 2>&1; then
  VERDICT="$(AUKORA_ROOT="$ROOT" bash "$OUT/verify.sh" 2>&1 | grep -m1 'EVIDENCE BUNDLE:')"
  rm -rf "$OUT"
  case "$VERDICT" in
    *VERIFIED*) leg evidence-bundle ok "${VERDICT#EVIDENCE BUNDLE: }" ;;
    *) leg evidence-bundle red "${VERDICT:-no verdict line}" ;;
  esac
else
  rm -rf "$OUT"
  leg evidence-bundle red "the bundle could not be built from $STORE"
fi

# ── THE NEXT RELAUNCH'S THREE, WHICH ARE EXPECTED TO REPORT "NOT YET" TODAY ──────────────────
# A LEG THAT CAN ONLY PASS IS NOT A CHECK, so each of these states WHICH THING IS ABSENT by name rather
# than failing cryptically or being omitted until the feature lands. "NOT YET" is deliberately NOT counted
# as a failure: it says a feature has not shipped, which before the relaunch is the truth, and counting it
# would make this check red for being correct. It becomes `ok` the moment the feature is there.
not_yet() { LEGS=$((LEGS + 1)); printf '  NOT YET %-20s %s\n' "$1" "$2"; }

# THE CONTACT ROUTE: a bad npub must be refused 400, not 404 and not 500. 404 means the route is absent;
# 400 means it is there and validating.
CONTACT_PATH="${AUKORA_CONTACT_PATH:-/contact}"
CONTACT_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -d '{"npub":"npub1notarealnpub"}' \
  -H 'content-type: application/json' "$LANE_DOOR$CONTACT_PATH" 2>/dev/null)"
case "$CONTACT_CODE" in
  400) leg contact-route ok "400 on a bad npub" ;;
  404|405) not_yet contact-route "the route is absent (answered $CONTACT_CODE) — expected after the relaunch" ;;
  000|"") not_yet contact-route "no answer from $LANE_DOOR$CONTACT_PATH" ;;
  *) leg contact-route red "answered $CONTACT_CODE for a bad npub; expected 400" ;;
esac

# THE ADD-CONTACT SHEET'S BUNDLE. A sheet is a built artifact; its absence before the relaunch is the
# expected state, and naming the path is what makes this leg useful the moment it appears.
SHEET="${AUKORA_ADD_CONTACT_SHEET:-$STATE/home/apps/auma-live/add-contact}"
if [ -f "$SHEET/index.js" ] || [ -f "$SHEET/bundle.js" ] || [ -f "$SHEET/index.html" ]; then
  leg add-contact-sheet ok "present at $SHEET"
else
  not_yet add-contact-sheet "no bundle at $SHEET — expected after the relaunch"
fi

# THE SAS CONFIRM OP ON THE SIGNER. `confirm-nostr-sas` must be KNOWN: an unknown op is refused by name,
# so the refusal itself is the signal that the op has not shipped.
SIGNER_SOCK="${AUKORA_SIGNER_SOCK:-$STATE/aumlok-signer.sock}"
if [ ! -S "$SIGNER_SOCK" ]; then
  not_yet sas-confirm-op "no signer socket at $SIGNER_SOCK"
elif command -v nc >/dev/null 2>&1; then
  SAS_REPLY="$(printf '{"op":"confirm-nostr-sas"}\n' | nc -U -w 3 "$SIGNER_SOCK" 2>/dev/null | head -c 300)"
  case "$SAS_REPLY" in
    *unknown*|*unsupported*|*not.?implemented*|*"no such op"*) not_yet sas-confirm-op "the signer does not know confirm-nostr-sas yet" ;;
    *sas*|*confirm*) leg sas-confirm-op ok "the signer answers confirm-nostr-sas" ;;
    "") not_yet sas-confirm-op "the signer answered nothing on $SIGNER_SOCK" ;;
    *) leg sas-confirm-op red "unexpected reply: $(printf '%s' "$SAS_REPLY" | head -c 80)" ;;
  esac
else
  not_yet sas-confirm-op "no nc available to ask the signer at $SIGNER_SOCK"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "POST-RELAUNCH: READY — ${LEGS} leg(s) checked, none failed"
  exit 0
fi
echo "POST-RELAUNCH: NOT READY — ${FAILED} of ${LEGS} leg(s) failed or could not be checked"
exit 1
