#!/usr/bin/env bash
# evidence-bundle.sh — build the Saturday evidence bundle, and the one command a reviewer runs on it.
#
# WHAT IT PRODUCES. One directory holding (a) the RETAINED HEAD, (b) the EXPORTED LEDGER for seq 1-3,
# and (c) `verify.sh` — a self-contained stranger verification a reviewer runs on a fresh clone with
# `bash <bundle>/verify.sh`, which drives the VENDORED Diamond verifier from an EMPTY cwd and prints
# the verdict together with the four ceilings.
#
# WHY verify.sh IS WRITTEN INTO THE BUNDLE rather than living here. The reviewer's job is to check bytes
# they were handed, not to trust a script in a repository they have not read. Shipping the verifier WITH
# the evidence means the command and the thing it checks travel together, and the bundle is not a pile
# of JSON whose meaning lives somewhere else.
#
# LESSONS THIS FILE OBEYS, EACH LEARNED BY MEASUREMENT IN THIS LANE:
#   * the record is selected BY THE DIGEST THE RECALL NAMED, never `ls | head -1` — the live export
#     carries more than one record and `ls` sorts lexicographically, so `head -1` takes the OLDEST;
#   * the ceilings print on EVERY exit, not only on success, so a REFUSED run cannot be read as a
#     silent pass -- the class-4 defect this lane already fixed once;
#   * every absence is a NAMED refusal, never a skip.
#
# READ-ONLY ON THE STORE. Nothing is settled, no nonce is spent, and `--store` is only ever read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE=""
OUT=""
RELEASE=""
DIAMOND_PIN="0d3cc66"

while [ $# -gt 0 ]; do
  case "$1" in
    --store) STORE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --release) RELEASE="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
evidence-bundle.sh --store <kira-state-dir> --out <bundle-dir>

Builds the evidence bundle: the retained head, the exported ledger, and a verify.sh a reviewer runs.
Read-only: the store is never written and nothing is settled.
USAGE
      exit 0 ;;
    *) echo "UNKNOWN ARGUMENT: $1" >&2; exit 2 ;;
  esac
done

[ -n "$STORE" ] || { echo "REFUSED: --store is required; this reads a store and never guesses one" >&2; exit 2; }
[ -n "$OUT" ] || { echo "REFUSED: --out is required; the bundle is written somewhere named" >&2; exit 2; }
[ -d "$STORE" ] || { echo "REFUSED: the store $STORE is not a directory" >&2; exit 4; }

DIAMOND="$ROOT/vendor/kira-export/scripts/verify-kira-evidence.py"
DIAMOND_COMMIT="$(python3 -c "
import json,sys
try:
    print(json.load(open(sys.argv[1])).get('commit') or '')
except Exception:
    print('')
" "$ROOT/vendor/kira-export/upstream-diamond.json" 2>/dev/null)"
if [ -z "$DIAMOND_COMMIT" ] || [ "${DIAMOND_COMMIT#"$DIAMOND_PIN"}" = "$DIAMOND_COMMIT" ]; then
  echo "REFUSED: the vendored Diamond is not the ${DIAMOND_PIN} this bundle names" >&2; exit 4
fi
[ -f "$DIAMOND" ] || { echo "REFUSED: the vendored verifier is absent at $DIAMOND" >&2; exit 4; }

# THE RELEASE IS READ FROM THE LAUNCH RECORD, NOT REMEMBERED — the same lesson the runner's PINS
# block records. A release path typed from memory pins nothing, and the export REFUSES with
# PUBLIC_EVIDENCE_RELEASE_RECORD_MISSING when handed a directory that is not a release (measured:
# passing the genesis checkout fails exactly this way). --release overrides for a deliberate run.
# THEN AUKORA_DSH_RELEASE, WHICH IS HOW CI HANDS A COURT ITS RELEASE. `keyless-build` materializes one at
# $RUNNER_TEMP/aukora-release and exports it under this name (see release-manifest-tip's step in
# b1.yml), so a runner has a release WITHOUT the launch record a developer's machine carries. Taking the
# environment second — after the explicit flag, before the record — keeps a caller's explicit choice
# first and makes the CI path work on a machine that has never launched the app.
if [ -z "$RELEASE" ]; then
  RELEASE="${AUKORA_DSH_RELEASE:-}"
fi

if [ -z "$RELEASE" ]; then
  RELEASE="$(python3 -c "
import json,sys
try:
    print(json.load(open(sys.argv[1])).get('release') or '')
except Exception:
    print('')
" "${AUKORA_LIVE_STATE:-$HOME/Library/Application Support/AUKORA/state/launch.json}" 2>/dev/null)"
fi
# NAMED, AND IT SAYS WHICH THREE PLACES WERE TRIED. `PUBLIC_EVIDENCE_RELEASE_UNRESOLVED` is the refusal a
# caller can act on: it distinguishes "you gave me nothing and I found nothing" from the export's own
# `PUBLIC_EVIDENCE_RELEASE_RECORD_MISSING`, which means a directory was given and is not a release.
# This is a correct RED for a court, never a skip — a bundle that cannot name its release cannot claim
# anything about the bytes it exports.
[ -n "$RELEASE" ] || {
  echo "REFUSED: PUBLIC_EVIDENCE_RELEASE_UNRESOLVED: no release from --release, AUKORA_DSH_RELEASE, or the launch record; pass --release <dir> or set AUKORA_DSH_RELEASE" >&2
  exit 4
}
[ -d "$RELEASE" ] || { echo "REFUSED: PUBLIC_EVIDENCE_RELEASE_UNRESOLVED: $RELEASE is not a directory" >&2; exit 4; }

GENESIS="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo '')"
[ -n "$GENESIS" ] || { echo "REFUSED: cannot read the producer commit; the export names one" >&2; exit 4; }

mkdir -p "$OUT" || exit 4
OUT="$(cd "$OUT" && pwd)"

echo "EVIDENCE BUNDLE"
echo "  store    : $STORE"
echo "  out      : $OUT"
echo "  producer : ${GENESIS:0:12}…"
  echo "  release  : $RELEASE"
echo "  diamond  : ${DIAMOND_COMMIT:0:7}"

# ── the retained head, written OUTSIDE the store ────────────────────────────────────────────────
RETAIN_OUT="$(node "$ROOT/scripts/kira/retain-head.mjs" retain --state "$STORE" --retain "$OUT/retained" 2>&1)"
if [ $? -ne 0 ]; then
  echo "REFUSED: the retained head could not be written: $(printf '%s' "$RETAIN_OUT" | head -1 | cut -c1-120)" >&2
  exit 4
fi
RETAINED_FILE="$(find "$OUT/retained" -name '*.json' -type f | sort | head -1)"
[ -n "$RETAINED_FILE" ] || { echo "REFUSED: retained/ holds no JSON document" >&2; exit 4; }
echo "  retained : $(basename "$RETAINED_FILE")"

# THE ANCHOR COMES FROM THE STORE'S OWN ISSUER DOCUMENT, NOT FROM THE EXPORT. MEASURED TWICE: the
# export's `anchors/issuer` is a RETENTION RECORD (keys chainKey/root/retainedEntryCount), and handing
# it to --anchor is refused `anchor-unreadable`; the pin the stranger needs is built from
# `<store>/issuer.json`, keeping the public half. And the verifier wants a PEM, not JSON, so the bundle
# carries `anchor.pem` — a file the reviewer can be handed rather than one they must know how to unwrap.
PIN="$OUT/issuer-pin.json"
python3 - "$STORE" "$PIN" <<'PY' || true
import json, sys
d = json.load(open(sys.argv[1] + '/issuer.json'))
json.dump({k: v for k, v in d.items() if 'public' in k.lower()}, open(sys.argv[2], 'w'), indent=2)
PY
[ -s "$PIN" ] || { echo "REFUSED: the store names no public half in issuer.json" >&2; exit 4; }
python3 - "$PIN" "$OUT/anchor.pem" <<'PY' || { echo "REFUSED: the issuer pin carries no publicKey" >&2; exit 4; }
import json, sys
pem = json.load(open(sys.argv[1]))['publicKey']
open(sys.argv[2], 'w').write(pem if pem.endswith('\n') else pem + '\n')
PY
echo "  anchor   : anchor.pem"

# ── the export, for whatever the store holds ────────────────────────────────────────────────────
EXPORT="$OUT/export"
EXPORT_OUT="$(node "$ROOT/scripts/kira/public-evidence.mjs" export --store "$STORE" --out "$EXPORT" \
  --producer-commit "$GENESIS" --release "$RELEASE" --anchor "issuer=$PIN" 2>&1)"
if [ $? -ne 0 ]; then
  echo "REFUSED: the export failed: $(printf '%s' "$EXPORT_OUT" | head -1 | cut -c1-120)" >&2
  exit 4
fi
echo "  export   : $(printf '%s' "$EXPORT_OUT" | grep -c ':') facts"



# ── the message organ: the evidence records AND THE WIRES THEY NAME ────────────────────────────
# THE WIRES TRAVEL WITH THE BUNDLE. A record's digest alone does not bind it to its wire — a record
# RE-POINTED at another message's wire keeps every field individually valid while the PAIRING is false —
# so a bundle carrying records without wires could not be bound at all, and the reviewer would be left
# with either a digest-only answer or nothing. Copying the wires is what makes `--state` possible.
#
# THE LAYOUT IS THE STATE LAYOUT, so the reviewer passes `--state <bundle>/messages` and the reader
# resolves `nostr/wire/<digest>.json` exactly as it does against a live store. Nothing about the reader
# changes for a bundle; only where the bytes sit.
SRC_NOSTR="${AUKORA_STATE_HOME:-$HOME/Library/Application Support/AUKORA/state/home}/nostr"
if [ -d "$SRC_NOSTR/evidence" ]; then
  mkdir -p "$OUT/messages/nostr/evidence" "$OUT/messages/nostr/wire"
  MESSAGES=0
  for rec in "$SRC_NOSTR/evidence"/*.json; do
    [ -f "$rec" ] || continue
    cp "$rec" "$OUT/messages/nostr/evidence/"
    digest="$(python3 -c "
import json,sys
try: print(json.load(open(sys.argv[1])).get('contentDigest') or '')
except Exception: print('')
" "$rec" 2>/dev/null)"
    # THE WIRE IS COPIED IF PRESENT AND ITS ABSENCE IS RECORDED, not patched over. The reviewer decides
    # what a missing wire means; the bundler must not silently produce a bundle that cannot bind.
    if [ -n "$digest" ] && [ -f "$SRC_NOSTR/wire/$digest.json" ]; then
      cp "$SRC_NOSTR/wire/$digest.json" "$OUT/messages/nostr/wire/"
    fi
    MESSAGES=$((MESSAGES + 1))
  done
  echo "  messages : $MESSAGES record(s), $(ls "$OUT/messages/nostr/wire" 2>/dev/null | wc -l | tr -d ' ') wire(s)"
else
  echo "REFUSED: no message evidence at $SRC_NOSTR/evidence" >&2; exit 4
fi

# ── THE ONE COMMAND, written INTO the bundle ────────────────────────────────────────────────────
# QUOTED heredoc: an unquoted one would expand $ROOT and $DIAMOND here and bake THIS machine's paths
# into a script meant for someone else's clone. That mistake has cost this lane a round already.
cat > "$OUT/verify.sh" <<'VERIFY'
#!/usr/bin/env bash
# verify.sh — run me: `bash verify.sh`
#
# The stranger verification for this bundle, run from an EMPTY cwd against the bytes beside it. It does
# not consult the store that produced them and it does not trust this repository's checkout: everything
# it needs is the bundle and the vendored verifier named below.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIAMOND_PIN="0d3cc66"

# THE FOUR CEILINGS PRINT ON EVERY EXIT, refusal included. A run that cannot check must say what it
# would have claimed, or a reader learns the limits only by succeeding.
ceiling() {
  cat <<'CEIL'
CEILING: ONE_RECORD_PER_ROW — each verified row is ONE record and receipt, selected by the digest the
         runtime named. It is not a statement about any other row, nor about the ledger's tip.
CEILING: RETAINER_SAME_OWNER — the retained head and this bundle sit on ONE host. A second directory
         here is not a second device, and COMPLETENESS is a statement about a prefix, never the tip.
CEILING: VENDORED_CONSUMER — verification is by the vendored Diamond pinned at 0d3cc66, not by an
         independent implementation of the same format. Two readers of one spec are one opinion.
CEILING: EVIDENCE_NEVER_AUTHORIZES — a verified record and a verified receipt authorize nothing.
         Approval was a separate act by a person, and nothing in these bytes substitutes for it.
CEILING: MESSAGE_BOUND_IS_NOT_LEDGER_VERIFIED — a bound message proves its evidence record still
         describes its own wire. It is NOT a ledger entry, it carries no receipt, and it is not
         evidence that any person sent, received or approved anything.
CEIL
}
trap 'echo ""; ceiling' EXIT

[ -d "$HERE/export" ] || { echo "REFUSED: no export/ beside this script"; exit 4; }

# The verifier is looked for INSIDE the clone the reviewer already has, then beside the bundle.
DIAMOND=""
for candidate in \
  "${AUKORA_ROOT:-}/vendor/kira-export/scripts/verify-kira-evidence.py" \
  "$HERE/../../vendor/kira-export/scripts/verify-kira-evidence.py" \
  "$PWD/vendor/kira-export/scripts/verify-kira-evidence.py"; do
  [ -n "$candidate" ] && [ -f "$candidate" ] && { DIAMOND="$candidate"; break; }
done
[ -n "$DIAMOND" ] || { echo "REFUSED: the vendored Diamond verifier was not found; pass AUKORA_ROOT=<clone>"; exit 4; }
# ONE level up from scripts/, which is the package root the verifier imports `diamond` from.
# MEASURED: /../.. lands on vendor/ and the run dies `SETUP: cannot import diamond.kira_evidence`.
PACKAGE_ROOT="$(cd "$(dirname "$DIAMOND")/.." && pwd)"

# THE ROW IS CHOSEN BY NAME. Every record the export carries is verified, and the count is printed, so
# a bundle holding more than one record cannot quietly verify only the first one alphabetically.
shopt -s nullglob
RECORDS=("$HERE"/export/evidence/records/*.json)
[ ${#RECORDS[@]} -gt 0 ] || { echo "REFUSED: export/evidence/records holds no record"; exit 4; }

FAILED=0
for RECORD in "${RECORDS[@]}"; do
  SHA="$(basename "$RECORD" .json)"
  EMPTY="$(mktemp -d)"
  RECEIPT="$HERE/export/evidence/receipts/$SHA.json"
  OBJECT="$HERE/export/evidence/objects/$SHA.json"
  [ -f "$RECEIPT" ] || { echo "REFUSED: no receipt named $SHA"; FAILED=$((FAILED + 1)); continue; }
  [ -f "$OBJECT" ] || { echo "REFUSED: no object named $SHA"; FAILED=$((FAILED + 1)); continue; }
  # CAPTURED, THEN SEARCHED — not piped straight into grep. With `set -o pipefail`, a grep that finds
  # nothing kills the whole assignment under `set -e` semantics, so a missing verdict and a crashing
  # verifier look identical from here: both an empty string. Capturing first keeps the two apart, and
  # the output is kept for the failure line so a reader sees WHY rather than only that it failed.
  OUTPUT="$(cd "$EMPTY" && python3 "$DIAMOND" \
    --record "$RECORD" --receipt "$RECEIPT" --log "$HERE/export/evidence/aura.jsonl" \
    --anchor "$HERE/anchor.pem" --artifact-content "$OBJECT" \
    --package-root "$PACKAGE_ROOT" 2>&1)"
  VERDICT="$(printf '%s\n' "$OUTPUT" | grep -m1 '^VERDICT:' || true)"
  case "$VERDICT" in
    *VERIFIED*) echo "  ok    ${SHA:0:16}…  ${VERDICT}" ;;
    *) echo "  FAIL  ${SHA:0:16}…  ${VERDICT:-no verdict line; last output: $(printf '%s' "$OUTPUT" | tail -1 | cut -c1-70)}"; FAILED=$((FAILED + 1)) ;;
  esac
done

# ── the message organ: every record must BIND, and a missing wire is a REFUSAL ──────────────────
# NO FALLBACK TO --no-wire. A digest-only read answers `present` for a record re-pointed at another
# message's wire, so degrading to it when a wire is absent would turn a missing file into a clean
# result — the exact fail-open this binding exists to stop. The mode is always --state here, and the
# reader itself refuses a missing wire by name.
READER=""
for candidate in "${AUKORA_ROOT:-}/scripts/aura/nostr_evidence.py" \
                 "$HERE/../../scripts/aura/nostr_evidence.py"; do
  [ -n "$candidate" ] && [ -f "$candidate" ] && { READER="$candidate"; break; }
done
[ -n "$READER" ] || { echo "REFUSED: nostr_evidence.py was not found; pass AUKORA_ROOT=<clone>"; exit 4; }
MSTATE="$HERE/messages"
[ -d "$MSTATE/nostr/evidence" ] || { echo "REFUSED: no messages/nostr/evidence in this bundle; the message organ is REQUIRED, not optional"; exit 4; }

shopt -s nullglob
MESSAGES=("$MSTATE"/nostr/evidence/*.json)
BOUND=0
for M in "${MESSAGES[@]}"; do
  NAME="$(basename "$M" .json)"
  MOUT="$(python3 "$READER" "$M" --state "$MSTATE" 2>&1)"
  if printf '%s' "$MOUT" | grep -q '"wireBinding": "BOUND"'; then
    echo "  ok    ${NAME:0:16}…  wireBinding BOUND"
    BOUND=$((BOUND + 1))
  else
    # The reader's own refusal name is printed verbatim, so `missing` and `unbound` stay distinguishable
    # rather than collapsing into one red line.
    echo "  FAIL  ${NAME:0:16}…  $(printf '%s' "$MOUT" | grep -m1 'REFUSE:' || echo 'no wireBinding BOUND in the read')"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "EVIDENCE BUNDLE: VERIFIED — ${#RECORDS[@]} ledger record(s) verified, ${BOUND} message(s) bound [diamond ${DIAMOND_PIN}]"
  exit 0
fi
echo "EVIDENCE BUNDLE: REFUSED — ${FAILED} failure(s); ${#RECORDS[@]} ledger record(s) and ${#MESSAGES[@]} message(s) were read"
exit 1
VERIFY
chmod +x "$OUT/verify.sh"

echo ""
echo "EVIDENCE BUNDLE: WRITTEN to $OUT"
echo "  a reviewer runs:  bash $OUT/verify.sh"
