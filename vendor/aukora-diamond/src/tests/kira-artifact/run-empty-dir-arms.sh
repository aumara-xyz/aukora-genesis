#!/usr/bin/env bash
#
# Empty-directory offline acceptance for the CURRENT-PRODUCER approval transaction.
#
#   tests/kira-artifact/run-empty-dir-arms.sh <target-dir>
#   tests/kira-artifact/run-empty-dir-arms.sh <target-dir> --export <dir> \
#       --issuer-anchor <file> --approver-anchor <file>
#
# WHAT THIS PROVES, and why the SHAPE of every command is the point. The consumer runs with cwd INSIDE
# a directory that was EMPTY when the run started, under a restricted PATH and a PYTHONPATH that names
# only the staged closure — and EVERY invocation does that, both the combined consumer and the
# standalone verifier. A run where one lane quietly executed from the repository would be measuring the
# repository. The directory's entire contents are printed and hashed, so the closure is auditable
# rather than asserted.
#
# THE IMPORT GUARD IS ENFORCED, NOT PRINTED (isolation_probe.py). Modules are classified by their
# RESOLVED ORIGIN — closure / stdlib+builtin+frozen / outside — and an import outside those roots is a
# NAMED non-zero failure. The arm that proves it deliberately makes an outside module importable and
# imported, and requires the failure WHILE the consumer's own verification succeeds: a green
# verification is not evidence that the closure was unreachable.
#
# INPUT IS AN EXPORT, NOT A HARD-CODED FIXTURE. The default export is the committed fixture beside this
# suite; `--export` points the SAME acceptance at an externally produced transaction. Issuer and
# approver anchors are ALWAYS required as separate arguments, and an export that tries to declare its
# own anchors is refused by name.
#
# WHAT AN EXPORT LABEL IS WORTH. The manifest's class (`committed-fixture`, `materialized-candidate`,
# `live-produced`) is PRINTED and never upgraded: a candidate-release test is not proof that a running
# service produced the bytes, and this runner says so beside the label every time.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

TARGET_ARG=""
EXPORT_DIR="$HERE/fixtures"
# The two anchors are tracked INDEPENDENTLY. A single "an anchor was supplied" flag let an external
# run pass with only one of them, the other silently falling back to the committed fixture's key —
# measured: `--export X --issuer-anchor Y` completed every arm against the fixture's approver.
ISSUER_ANCHOR=""
APPROVER_ANCHOR=""
ISSUER_GIVEN=0
APPROVER_GIVEN=0
EXPORT_GIVEN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --export) EXPORT_DIR="$2"; EXPORT_GIVEN=1; shift 2 ;;
    --issuer-anchor) ISSUER_ANCHOR="$2"; ISSUER_GIVEN=1; shift 2 ;;
    --approver-anchor) APPROVER_ANCHOR="$2"; APPROVER_GIVEN=1; shift 2 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) TARGET_ARG="$1"; shift ;;
  esac
done
if [ "$ISSUER_GIVEN" -eq 0 ]; then ISSUER_ANCHOR="$HERE/fixtures/issuer.pem"; fi
if [ "$APPROVER_GIVEN" -eq 0 ]; then APPROVER_ANCHOR="$HERE/fixtures/approver.pk"; fi
TARGET="${TARGET_ARG:?usage: run-empty-dir-arms.sh <target-dir> [--export <dir> --issuer-anchor <f> --approver-anchor <f>]}"

PYTHON="$(command -v python3 || command -v python)"

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]; then
  echo "REFUSING: $TARGET is not empty. This check is about an EMPTY directory." >&2
  exit 2
fi
if [ ! -d "$EXPORT_DIR" ]; then
  echo "EXPORT: EXPORT_MANIFEST_MISSING"
  echo "  no export directory at $EXPORT_DIR"
  echo "EXPORT RESULT: RED"
  exit 2
fi
if [ "$EXPORT_GIVEN" -eq 1 ] && [ "$EXPORT_DIR" != "$HERE/fixtures" ]; then
  # An EXTERNAL export has no committed anchors to fall back on: BOTH must be named by the caller,
  # each checked on its own, and each refusal names the one that is missing.
  ANCHOR_PROBLEM=""
  if [ "$ISSUER_GIVEN" -eq 0 ]; then ANCHOR_PROBLEM="--issuer-anchor"; fi
  if [ "$APPROVER_GIVEN" -eq 0 ]; then
    ANCHOR_PROBLEM="${ANCHOR_PROBLEM:+$ANCHOR_PROBLEM and }--approver-anchor"
  fi
  if [ -n "$ANCHOR_PROBLEM" ]; then
    echo "EXPORT: EXPORT_ANCHOR_MISSING"
    echo "  --export was given without $ANCHOR_PROBLEM."
    echo "  A receipt's issuerPk and an artifact's approvalKeyDid are claims made by the documents"
    echo "  under test. BOTH anchors are REQUIRED, independently, and an external run never falls"
    echo "  back to a committed fixture key. This acceptance has no unanchored mode."
    echo "EXPORT RESULT: RED"
    exit 2
  fi
fi
if [ -z "$ISSUER_ANCHOR" ] || [ -z "$APPROVER_ANCHOR" ]; then
  echo "EXPORT: EXPORT_ANCHOR_MISSING"
  echo "  an anchor argument was empty; a path was not supplied."
  echo "EXPORT RESULT: RED"
  exit 2
fi

mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"
WAS_EMPTY="$(ls -A "$TARGET" | tr '\n' ' ')"

# ── stage 1: the shipped consumer closure, copied OUT of the tree ─────────────────────────
mkdir -p "$TARGET/closure/diamond" "$TARGET/tooling"
for module in __init__.py kira_evidence.py hexutil.py ed25519.py jcs.py approval_artifact.py \
              aumlok_approval.py; do
  cp "$REPO/diamond/$module" "$TARGET/closure/diamond/$module"
done
cp "$REPO/scripts/verify-kira-evidence.py" "$TARGET/verify-kira-evidence.py"
# The acceptance TOOLING travels too: it is not part of the consumer, and keeping it inside the run
# directory is what lets the import guard judge the consumer by origin rather than by trust.
cp "$HERE/isolation_probe.py" "$TARGET/tooling/isolation_probe.py"
cp "$HERE/export_input.py" "$TARGET/tooling/export_input.py"
cp "$HERE/content_tamper.py" "$TARGET/tooling/content_tamper.py"

# ── stage 2: the exported transaction, copied in as data ──────────────────────────────────
cp -R "$EXPORT_DIR" "$TARGET/export"
EXPORT="$TARGET/export"

# ── stage 3: read and CHECK the export through the consumer's own argument shape ──────────
set +e
EXPORT_REPORT="$("$PYTHON" "$TARGET/tooling/export_input.py" --export "$EXPORT" \
  --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR" 2>&1)"
EXPORT_STATUS=$?
set -e
printf '%s\n' "$EXPORT_REPORT"
if [ "$EXPORT_STATUS" -ne 0 ] && [ "$EXPORT_STATUS" -ne 3 ]; then
  echo "EMPTY-DIRECTORY RESULT: RED (the export was refused before any arm ran)"
  exit 2
fi

# ── stage 4: negative controls DERIVED here from the export's own bytes ───────────────────
mkdir -p "$TARGET/arms"
# Only control generation imports tooling; consumer invocations below still name only the closure.
PYTHONPATH="$TARGET/closure:$TARGET/tooling" PYTHONDONTWRITEBYTECODE=1 \
  "$PYTHON" - "$EXPORT" "$TARGET/arms" <<'PY'
"""Derive every negative control from the EXPORT, at run time.

Nothing is committed as a second copy of a tampered document, and the generator SIGNS NOTHING: every
arm is either the producer's own bytes, a byte edit, or a field edit of a document whose signature was
never going to cover that field.
"""
import json
import pathlib
import sys

from content_tamper import tamper_content

export, arms = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
manifest = json.loads((export / "export.json").read_text())
files = manifest["files"]
content = (export / files["content"]).read_bytes()
artifact = json.loads((export / files["artifact"]).read_text())
record = json.loads((export / files["record"]).read_text())

# The OTHER write, when the export carries one: the history log's later entries come from a second
# settlement, and that record is what a "wrong record" arm needs.
other = None
objects = sorted((export / "objects").glob("*.json")) if (export / "objects").is_dir() else []
for candidate in objects:
    carried = json.loads(candidate.read_text())
    if carried["key"] != record["recordId"]:
        other = carried["value"]
        break
if other is None:
    other = dict(record, content={"note": "another write"})
(arms / "record-other.json").write_text(json.dumps(other, indent=2) + "\n")


def artifact_variant(name, **changes):
    document = dict(artifact)
    document.update(changes)
    (arms / f"{name}.json").write_text(json.dumps(document, indent=2) + "\n")


artifact_variant("forged", signature="00" + artifact["signature"][2:])
artifact_variant("relabel-class", approvalClass="human-ceremony")
artifact_variant("relabel-attendance", attendance="attended")
artifact_variant("relabel-identity", identityBound=True)
artifact_variant("relabel-delegated", approvalClass="delegated", keyClass="C",
                 keyClassMeaning="operator-custodied", ceilings=["REWRITTEN BY AN EDITOR"])
# A SECOND approval over the same bytes: same record, same content, same digest, different challenge
# and signature. Nothing settles against it, and only the receipt's approval block can tell the two
# apart — which is what isolates the linkage check from every other one.
artifact_variant("artifact-other-approval",
                 challenge="ee" * 32 if artifact["challenge"] != "ee" * 32 else "ff" * 32)

moved = tamper_content(content)
(arms / "content-changed-payload.txt").write_bytes(moved)
(arms / "content-no-newline.txt").write_bytes(content.rstrip(b"\n"))
(arms / "content-doubled-newline.txt").write_bytes(content + b"\n")
(arms / "content-reformatted.txt").write_bytes(content.replace(b'{"key"', b'{ "key"', 1))

# The retired request/response wrapper, refused BY NAME rather than read as a receipt.
(arms / "retired-wrapper.json").write_text(json.dumps({
    "kind": "aukora-kira-owner-approval-bundle/v1", "source": "the retired shape",
    "request": {"domain": "aukora:owner-approval-request:v1"}, "response": {},
    "approverDid": "did:key:z6Mk",
}) + "\n")
print("arms derived from the export")
PY

# ── the invocation layer. EVERY call runs from the target directory ───────────────────────
# A subshell per call: the consumer's cwd is the isolated directory, PATH is the restricted one, and
# PYTHONPATH names only the staged closure. Nothing below opts out of it.
FAILED=0
PASSED=0
REQUIRED=()
LAST_OUTPUT="$TARGET/.arm-output"

invoke() {
  local lane="$1"; shift
  if [ "$lane" = "combined" ]; then
    ( cd "$TARGET" && printf '   [invocation cwd: %s]\n' "$PWD" \
        && env -i PATH="/usr/bin:/bin" PYTHONPATH="$TARGET/closure" \
             PYTHONDONTWRITEBYTECODE=1 "$PYTHON" "$TARGET/verify-kira-evidence.py" "$@" )
  else
    ( cd "$TARGET" && printf '   [invocation cwd: %s]\n' "$PWD" \
        && env -i PATH="/usr/bin:/bin" PYTHONPATH="$TARGET/closure" \
             PYTHONDONTWRITEBYTECODE=1 "$PYTHON" -B -m diamond.approval_artifact "$@" )
  fi
}

# EVERY arm must show the directory it ran from, and it must be the isolated target. Without this the
# "empty directory" claim rests on the script's shape rather than on what executed.
assert_isolated_cwd() {
  grep -qF -- "[invocation cwd: $TARGET]" "$LAST_OUTPUT" || {
    echo "the consumer did not run from the isolated target directory"; return 1; }
}

check_required() {
  local verdict="pass"
  for line in ${REQUIRED[@]+"${REQUIRED[@]}"}; do
    if ! grep -qF -- "$line" "$LAST_OUTPUT"; then verdict="missing line: $line"; fi
  done
  REQUIRED=()
  echo "$verdict"
}

run() {
  local label="$1" expected="$2" lane="$3"; shift 3
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo "ARM: $label   [lane: $lane, cwd: the isolated target]"
  echo "────────────────────────────────────────────────────────────────────────────────"
  set +e
  invoke "$lane" "$@" > "$LAST_OUTPUT" 2>&1
  local status=$?
  set -e
  cat "$LAST_OUTPUT"
  local verdict
  if [ "$status" -ne 0 ]; then verdict="exit status $status"; else verdict="$(check_required)"; fi
  if [ "$verdict" = "pass" ] && ! assert_isolated_cwd; then verdict="NOT RUN FROM THE ISOLATED DIRECTORY"; fi
  echo "── arm result: $verdict"
  echo
  if [ "$verdict" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
}

# The INVERTED arm: asked for `verified`, the consumer must REFUSE with a non-zero status. An arm that
# merely prints the right refusal word would have passed the behaviour these arms exist to exclude.
must_refuse() {
  local label="$1" required_code="$2" lane="$3"; shift 3
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo "ARM (MUST REFUSE): $label   [lane: $lane, cwd: the isolated target]"
  echo "────────────────────────────────────────────────────────────────────────────────"
  set +e
  if [ "$lane" = "combined" ]; then
    invoke "$lane" "$@" --expect verified > "$LAST_OUTPUT" 2>&1
  else
    invoke "$lane" "$@" > "$LAST_OUTPUT" 2>&1
  fi
  local status=$?
  set -e
  cat "$LAST_OUTPUT"
  local verdict="pass"
  if ! assert_isolated_cwd; then
    verdict="NOT RUN FROM THE ISOLATED DIRECTORY"
  fi
  # The combined consumer prints `VERDICT: REFUSED  <code>`; the standalone verifier prints
  # `STATUS: <code>`. Neither is accepted without a non-zero exit status.
  if [ "$verdict" != "pass" ]; then
    : # already failed: the invocation itself was wrong
  elif [ "$status" -eq 0 ]; then
    verdict="exit status 0 — it did NOT refuse"
  elif ! grep -qF -- "VERDICT: REFUSED  $required_code" "$LAST_OUTPUT" \
    && ! grep -qF -- "STATUS: $required_code" "$LAST_OUTPUT"; then
    verdict="refused for the wrong reason: neither 'VERDICT: REFUSED  $required_code' nor 'STATUS: $required_code'"
  fi
  echo "── arm result: $verdict"
  echo
  if [ "$verdict" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
}

# An INPUT arm: the acceptance tooling itself must fail by name and non-zero. The export directory is
# supplied by the arm; the anchors are the caller's, exactly as the consumer's own arguments require.
must_refuse_input() {
  local label="$1" required_code="$2" export_dir="$3"; shift 3
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo "ARM (INPUT MUST REFUSE): $label"
  echo "────────────────────────────────────────────────────────────────────────────────"
  set +e
  "$PYTHON" "$TARGET/tooling/export_input.py" --export "$export_dir" "$@" > "$LAST_OUTPUT" 2>&1
  local status=$?
  set -e
  cat "$LAST_OUTPUT"
  local verdict="pass"
  if [ "$status" -eq 0 ]; then
    verdict="exit status 0 — the input problem was NOT refused"
  elif ! grep -qF -- "$required_code" "$LAST_OUTPUT"; then
    verdict="refused without the named code $required_code"
  fi
  echo "── arm result: $verdict"
  echo
  if [ "$verdict" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
}

echo "════════════════════════════════════════════════════════════════════════════════"
echo "EMPTY-DIRECTORY OFFLINE RUN — the current producer's approval transaction"
echo "════════════════════════════════════════════════════════════════════════════════"
echo "cwd at run time      : $TARGET"
echo "contents before this run began: '${WAS_EMPTY}' (empty)"
echo "export under test    : $EXPORT_DIR"
echo "export validation    : exit $EXPORT_STATUS (0 = usable and labelled; 3 = usable, unlabelled; 2 = refused)"
echo
echo "── everything in the run directory, hashed (the whole closure, nothing implied) ──"
( cd "$TARGET" && find . -type f | sort | while read -r f; do
    printf '%s  %s\n' "$("$PYTHON" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$f")" "${f#./}"
  done )
echo

FX="$EXPORT"
ARMS="$TARGET/arms"
# The export's file map, read the way the consumer's arguments are built: from the manifest, so the
# same runner works for a committed fixture and for an external export with different file names.
# `mapfile` is bash 4; the macOS system bash is 3.2, so the file map is read with a portable loop.
EXPORT_FILES=()
while IFS= read -r line; do EXPORT_FILES+=("$line"); done < <("$PYTHON" - "$EXPORT/export.json" <<'MAPEOF'
import json, sys
files = json.load(open(sys.argv[1]))["files"]
for name in ("artifact", "content", "receipt", "log", "record", "artifactAlt"):
    print(files[name])
MAPEOF
)
ARTIFACT_FILE="$FX/${EXPORT_FILES[0]}"
CONTENT_FILE="$FX/${EXPORT_FILES[1]}"
RECEIPT_FILE="$FX/${EXPORT_FILES[2]}"
LOG_FILE="$FX/${EXPORT_FILES[3]}"
RECORD_FILE="$FX/${EXPORT_FILES[4]}"

COMBINED=(--record "$RECORD_FILE" --receipt "$RECEIPT_FILE" --log "$LOG_FILE" --anchor "$ISSUER_ANCHOR" --store "$FX")
ARTIFACT_ARGS=(--artifact "$ARTIFACT_FILE" --artifact-content "$CONTENT_FILE" --artifact-anchor "$APPROVER_ANCHOR")
# The standalone verifier spells the same inputs differently (`--content`, `--anchor`). Two spellings
# of one contract is how a lane ends up being invoked with the other lane's flags and silently
# measuring argparse instead of the consumer, so each lane gets its own array.
STANDALONE_ARGS=(--artifact "$ARTIFACT_FILE" --content "$CONTENT_FILE" --anchor "$APPROVER_ANCHOR")
ALT_ARTIFACT_FILE="$FX/${EXPORT_FILES[5]}"
ARTIFACT_ARGS_WRONG_ANCHOR=(--artifact "$ARTIFACT_FILE" --artifact-content "$CONTENT_FILE" --artifact-anchor "$ISSUER_ANCHOR")

# ── arm 0: the real artifact, over the real content, from the isolated cwd ────────────────
REQUIRED=("CONSUMER          : offline Kira memory-v1 evidence consumer" \
          "   STATUS              : APPROVAL_ARTIFACT_VERIFIED" \
          "   operation binding   : OPERATION_BINDING_VERIFIED (DERIVED from the supplied content bytes)" \
          "   receipt linkage     : RECEIPT_APPROVAL_LINKED" \
          "   classification      : REPORTED (NOT signed" \
          "   authorization       : OWNER_APPROVAL_UNCHECKED" \
          "   attendance          : reported-not-proven" \
          "VERDICT: VERIFIED")
run "0 — HONEST: the exported artifact, its content and separately supplied anchors" verified combined \
  "${COMBINED[@]}" "${ARTIFACT_ARGS[@]}" --expect verified

REQUIRED=("  STATUS: APPROVAL_ARTIFACT_VERIFIED" "  operation binding   : OPERATION_BINDING_VERIFIED" \
          "  authorization       : OWNER_APPROVAL_UNCHECKED" "  attendance          : reported-not-proven" \
          "  receipt linkage     : RECEIPT_APPROVAL_LINKED")
run "0b — THE SAME EXPORT THROUGH THE STANDALONE VERIFIER, from the same isolated cwd" verified standalone \
  "${STANDALONE_ARGS[@]}" --record "$RECORD_FILE" --receipt "$RECEIPT_FILE"

# ── arm 1: the BINDING. The digest is derived here; a moved byte must move it ─────────────
must_refuse "1 — CHANGED PAYLOAD: canonical content changed, record key unchanged" APPROVAL_CONTENT_MISMATCH combined \
  "${COMBINED[@]}" --artifact "$ARTIFACT_FILE" --artifact-content "$ARMS/content-changed-payload.txt" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "1b — MISSING NEWLINE: the content without the record format's own terminator" \
  APPROVAL_CONTENT_NOT_CANONICAL combined \
  "${COMBINED[@]}" --artifact "$ARTIFACT_FILE" --artifact-content "$ARMS/content-no-newline.txt" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "1c — DOUBLED NEWLINE: one byte the producer never digested" APPROVAL_CONTENT_NOT_CANONICAL combined \
  "${COMBINED[@]}" --artifact "$ARTIFACT_FILE" --artifact-content "$ARMS/content-doubled-newline.txt" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "1d — REFORMATTED JSON: the same value, not the same bytes" APPROVAL_CONTENT_NOT_CANONICAL combined \
  "${COMBINED[@]}" --artifact "$ARTIFACT_FILE" --artifact-content "$ARMS/content-reformatted.txt" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "1e — A SECOND, GENUINE APPROVAL OVER THE SAME BYTES IS NOT THIS TRANSACTION'S LINKAGE" \
  APPROVAL_RECEIPT_LINKAGE_MISMATCH combined \
  "${COMBINED[@]}" --artifact "$ALT_ARTIFACT_FILE" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

# …and the arm that shows WHY that one isolates the check: an EDITOR's copy of the artifact is refused
# one check EARLIER, as an artifact that disagrees with itself. The two arms name two mechanisms.
must_refuse "1f — AN EDITED CHALLENGE IS REFUSED AS INTERNALLY INCONSISTENT, before any signature work" \
  APPROVAL_ARTIFACT_INCONSISTENT combined \
  "${COMBINED[@]}" --artifact "$ARMS/artifact-other-approval.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

# ── arm 2: identity. The record must BE the content the approval binds ────────────────────
must_refuse "2 — WRONG RECORD, in the APPROVAL lane: the record is not the one the content addresses" \
  APPROVAL_RECORD_MISMATCH standalone \
  "${STANDALONE_ARGS[@]}" --record "$ARMS/record-other.json"

# Through the COMBINED consumer the same input is refused by the EVIDENCE lane first (its receipt names
# write 1's record), which is its own named refusal. Asserting `APPROVAL_RECORD_MISMATCH` here would be
# asserting the wrong mechanism; the arm asserts the one that fires, and the lane that fired it.
REQUIRED=("   STATUS              : APPROVAL_RECORD_MISMATCH" "VERDICT: REFUSED  receipt-record-mismatch")
run "2b — THE SAME INPUT THROUGH THE COMBINED CONSUMER: refused by the evidence lane, and the approval lane says why" \
  receipt-record-mismatch combined \
  --record "$ARMS/record-other.json" --receipt "$RECEIPT_FILE" --log "$LOG_FILE" \
  --anchor "$ISSUER_ANCHOR" --store "$FX" --artifact "$ARTIFACT_FILE" \
  --artifact-content "$CONTENT_FILE" --artifact-anchor "$APPROVER_ANCHOR" --expect receipt-record-mismatch

# ── arm 3: the ANCHORS. Supplied, never read; and no anchor is a refusal ──────────────────
must_refuse "3 — WRONG ANCHOR: a real key that is not the approver" APPROVAL_KEY_MISMATCH combined \
  "${COMBINED[@]}" "${ARTIFACT_ARGS_WRONG_ANCHOR[@]}"

must_refuse "3b — NO ANCHOR: the document's own approvalKeyDid is never promoted to trust" \
  APPROVAL_KEY_MISMATCH standalone \
  --artifact "$ARTIFACT_FILE" --content "$CONTENT_FILE" --anchor ""

# ── arm 4: the SIGNATURE, and the retired shape ───────────────────────────────────────────
must_refuse "4 — FORGED SIGNATURE: one byte of the signature changed" APPROVAL_SIGNATURE_INVALID combined \
  "${COMBINED[@]}" --artifact "$ARMS/forged.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "4b — THE RETIRED REQUEST/RESPONSE WRAPPER IS REFUSED, so the flat record is what is consumed" \
  APPROVAL_MALFORMED combined \
  "${COMBINED[@]}" --artifact "$ARMS/retired-wrapper.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

# ── arm 5: the UNSIGNED labels ───────────────────────────────────────────────────────────
must_refuse "5 — RELABELLED human-ceremony: a class this consumer cannot earn, refused by name" \
  APPROVAL_CLASS_UNSUPPORTED combined \
  "${COMBINED[@]}" --artifact "$ARMS/relabel-class.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "5b — RELABELLED attendance=attended: a signature cannot show a person was present" \
  APPROVAL_ATTENDANCE_UNSUPPORTED combined \
  "${COMBINED[@]}" --artifact "$ARMS/relabel-attendance.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

must_refuse "5c — RELABELLED identityBound:true: no ceremony here binds an approval to an identity" \
  APPROVAL_IDENTITY_BOUND_UNSUPPORTED combined \
  "${COMBINED[@]}" --artifact "$ARMS/relabel-identity.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

REQUIRED=("  STATUS: APPROVAL_ARTIFACT_VERIFIED" "  classification      : REPORTED (NOT signed)")
run "5d — A REWRITTEN LABEL THAT IS STILL A CREDIBLE CLASS: the signature holds and the label is REPORTED" \
  verified standalone \
  --artifact "$ARMS/relabel-delegated.json" --content "$CONTENT_FILE" --anchor "$APPROVER_ANCHOR"

must_refuse "5e — …AND WITH THE RECEIPT THE RELABELLING IS REFUSED AS A LABEL DISAGREEMENT" \
  APPROVAL_RECEIPT_LINKAGE_MISMATCH combined \
  "${COMBINED[@]}" --artifact "$ARMS/relabel-delegated.json" --artifact-content "$CONTENT_FILE" \
  --artifact-anchor "$APPROVER_ANCHOR"

# ── arm 6: the FIRST receipt after its SUBSEQUENT writes ─────────────────────────────────
REQUIRED=("   VERDICT             : VERIFIED" "   receipt linkage     : RECEIPT_APPROVAL_LINKED" \
          "VERDICT: VERIFIED")
run "6 — FIRST RECEIPT AFTER SUBSEQUENT WRITES: still verifies, linkage intact" verified combined \
  "${COMBINED[@]}" "${ARTIFACT_ARGS[@]}" --expect verified

# ── arm 7: the INPUT contract. Missing evidence and missing anchors fail BY NAME ──────────
# Each variant is a COPY of the export with ONE thing changed, so the refusal names the input problem
# rather than something else about the bytes.
for name in anchors disagreeing missing-file unknown-class live-claim; do
  mkdir -p "$TARGET/arms-$name"
  cp -R "$EXPORT/." "$TARGET/arms-$name/"
done
"$PYTHON" - "$ARMS" "$TARGET" <<'PY'
import json, pathlib, shutil, sys
arms, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
base = json.loads((arms.parent / "export" / "export.json").read_text())

def variant(name, mutate):
    directory = target / f"arms-{name}"
    manifest = json.loads(json.dumps(base))
    mutate(manifest)
    (directory / "export.json").write_text(json.dumps(manifest, indent=2) + "\n")

variant("anchors", lambda d: d.update({"anchors": {"issuer": "x", "approver": "y"}}))
variant("disagreeing", lambda d: d["transaction"].update({"operationDigest": "11" * 32}))
variant("missing-file", lambda d: d["files"].update({"receipt": "no-such-receipt.json"}))
variant("unknown-class", lambda d: d.update({"class": "probably-fine"}))
variant("live-claim", lambda d: d.update({"class": "live-produced"}))
PY

must_refuse_input "7 — NO MANIFEST: a directory of files is not an export" EXPORT_MANIFEST_MISSING \
  "$ARMS" --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR"

must_refuse_input "7b — NO ISSUER ANCHOR: the receipt's own issuerPk is a claim, not an input" \
  EXPORT_ANCHOR_MISSING "$FX" --approver-anchor "$APPROVER_ANCHOR"

must_refuse_input "7c — NO APPROVER ANCHOR: the artifact's own approvalKeyDid is a claim, not an input" \
  EXPORT_ANCHOR_MISSING "$FX" --issuer-anchor "$ISSUER_ANCHOR"

must_refuse_input "7d — AN EXPORT THAT DECLARES ITS OWN ANCHORS IS REFUSED" EXPORT_ANCHORS_NOT_SEPARATE \
  "$TARGET/arms-anchors" --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR"

must_refuse_input "7e — A MANIFEST THAT DISAGREES WITH ITS OWN BYTES IS REFUSED" \
  EXPORT_MANIFEST_DISAGREES_WITH_FILES \
  "$TARGET/arms-disagreeing" --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR"

must_refuse_input "7f — A MISSING MANDATORY FILE IS REFUSED BY NAME" EXPORT_FILE_MISSING \
  "$TARGET/arms-missing-file" --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR"

must_refuse_input "7g — AN UNKNOWN CLASS IS REFUSED, not silently accepted" EXPORT_CLASS_UNKNOWN \
  "$TARGET/arms-unknown-class" --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR"

must_refuse_input "7h — A live-produced CLAIM WITHOUT LIVE EVIDENCE IS REFUSED" EXPORT_LIVE_EVIDENCE_MISSING \
  "$TARGET/arms-live-claim" --issuer-anchor "$ISSUER_ANCHOR" --approver-anchor "$APPROVER_ANCHOR"

# ── arm 7i: an EXTERNAL export must carry BOTH anchors, each independently ────────────────
# Runs the runner ITSELF (a nested invocation in a fresh target) because that is the entry point the
# requirement is about: a single "an anchor was supplied" flag previously let `--export X --issuer-
# anchor Y` complete every arm against the committed fixture's approver key.
for missing in issuer approver; do
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo "ARM (INPUT MUST REFUSE): 7i — EXTERNAL EXPORT WITHOUT THE $(echo "$missing" | tr '[:lower:]' '[:upper:]') ANCHOR"
  echo "────────────────────────────────────────────────────────────────────────────────"
  NESTED_TARGET="$TARGET/nested-$missing"
  set +e
  if [ "$missing" = "issuer" ]; then
    bash "$HERE/run-empty-dir-arms.sh" "$NESTED_TARGET" --export "$EXPORT" \
      --approver-anchor "$APPROVER_ANCHOR" > "$LAST_OUTPUT" 2>&1
  else
    bash "$HERE/run-empty-dir-arms.sh" "$NESTED_TARGET" --export "$EXPORT" \
      --issuer-anchor "$ISSUER_ANCHOR" > "$LAST_OUTPUT" 2>&1
  fi
  NESTED_STATUS=$?
  set -e
  cat "$LAST_OUTPUT"
  NESTED_VERDICT="pass"
  if [ "$NESTED_STATUS" -eq 0 ]; then
    NESTED_VERDICT="exit status 0 — the missing $missing anchor was NOT refused"
  elif ! grep -qF -- "EXPORT_ANCHOR_MISSING" "$LAST_OUTPUT"; then
    NESTED_VERDICT="refused without the named code EXPORT_ANCHOR_MISSING"
  elif ! grep -qF -- "--$missing-anchor" "$LAST_OUTPUT"; then
    NESTED_VERDICT="the refusal did not name the missing --$missing-anchor"
  elif [ -d "$NESTED_TARGET/closure" ]; then
    NESTED_VERDICT="it staged a run before refusing the missing anchor"
  fi
  echo "── arm result: $NESTED_VERDICT"
  echo
  if [ "$NESTED_VERDICT" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
done

# ── arm 8: THE ISOLATION CONTROL. An outside import must FAIL BY NAME on a GREEN verification ──
echo "────────────────────────────────────────────────────────────────────────────────"
echo "ARM: 8 — ISOLATION ENFORCED: the honest run imports nothing outside the closure"
echo "────────────────────────────────────────────────────────────────────────────────"
set +e
( cd "$TARGET" && env -i PATH="/usr/bin:/bin" PYTHONPATH="$TARGET/closure" PYTHONDONTWRITEBYTECODE=1 \
    "$PYTHON" "$TARGET/tooling/isolation_probe.py" --closure "$TARGET/closure" --target "$TARGET" \
    --consumer "$TARGET/verify-kira-evidence.py" --expect-verdict verified -- \
    "${COMBINED[@]}" "${ARTIFACT_ARGS[@]}" --expect verified ) > "$LAST_OUTPUT" 2>&1
ISOLATION_STATUS=$?
set -e
cat "$LAST_OUTPUT"
ISOLATION_VERDICT="pass"
if [ "$ISOLATION_STATUS" -ne 0 ]; then ISOLATION_VERDICT="exit status $ISOLATION_STATUS (the honest run was refused)"; fi
if ! grep -qF -- "ISOLATION RESULT: GREEN" "$LAST_OUTPUT"; then ISOLATION_VERDICT="no ISOLATION RESULT: GREEN"; fi
if grep -qF -- "OUTSIDE MODULE" "$LAST_OUTPUT"; then ISOLATION_VERDICT="an outside module was found on the honest run"; fi
echo "── arm result: $ISOLATION_VERDICT"
echo
if [ "$ISOLATION_VERDICT" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi

# The negative control: a temporary module placed OUTSIDE the closure, importable because the path
# says so, and IMPORTED before the consumer runs. The arm requires the named failure AND the
# consumer's own verification having SUCCEEDED — an unrelated crash is not detection, and a control
# that passed on a broken run would prove nothing.
mkdir -p "$TARGET/outside-module"
cat > "$TARGET/outside-module/outside_probe_module.py" <<'OUTSIDE'
"""A harmless module that lives OUTSIDE the staged closure. Importing it is the control."""
MARKER = "this module is not in the closure"
OUTSIDE
echo "────────────────────────────────────────────────────────────────────────────────"
echo "ARM (MUST REFUSE): 8b — AN OUTSIDE MODULE MUST FAIL BY NAME WHILE THE VERIFICATION SUCCEEDS"
echo "────────────────────────────────────────────────────────────────────────────────"
set +e
( cd "$TARGET" && env -i PATH="/usr/bin:/bin" \
    PYTHONPATH="$TARGET/closure:$TARGET/outside-module" PYTHONDONTWRITEBYTECODE=1 \
    "$PYTHON" "$TARGET/tooling/isolation_probe.py" --closure "$TARGET/closure" --target "$TARGET" \
    --consumer "$TARGET/verify-kira-evidence.py" --import-outside outside_probe_module \
    --expect-verdict verified -- "${COMBINED[@]}" "${ARTIFACT_ARGS[@]}" --expect verified ) \
  > "$LAST_OUTPUT" 2>&1
CONTROL_STATUS=$?
set -e
cat "$LAST_OUTPUT"
CONTROL_VERDICT="pass"
if [ "$CONTROL_STATUS" -eq 0 ]; then
  CONTROL_VERDICT="exit status 0 — the outside import was NOT refused"
elif ! grep -qF -- "ISOLATION: ISOLATION_IMPORT_OUTSIDE_CLOSURE" "$LAST_OUTPUT"; then
  CONTROL_VERDICT="refused for the wrong reason: no named ISOLATION_IMPORT_OUTSIDE_CLOSURE"
elif ! grep -qF -- "outside_probe_module" "$LAST_OUTPUT"; then
  CONTROL_VERDICT="the outside module was not named"
elif ! grep -qF -- "EXPECTATION: verified OBSERVED" "$LAST_OUTPUT"; then
  CONTROL_VERDICT="the consumer's verification did not succeed, so this arm cannot show detection on a green run"
elif ! grep -qF -- "the consumer's verification SUCCEEDED" "$LAST_OUTPUT"; then
  CONTROL_VERDICT="the refusal did not report that the verification had succeeded"
fi
echo "── arm result: $CONTROL_VERDICT"
echo
if [ "$CONTROL_VERDICT" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi

echo "════════════════════════════════════════════════════════════════════════════════"
echo "ARM SUMMARY: $PASSED arms produced their published result, $FAILED did not"
echo "════════════════════════════════════════════════════════════════════════════════"
echo
echo "CROSS-CHECK: does the consumer depend on anything outside the run directory?"
echo "  - every consumer invocation ran with cwd INSIDE $TARGET, under PATH=/usr/bin:/bin and a"
echo "    PYTHONPATH naming only the staged closure"
echo "  - the import guard classifies modules by RESOLVED ORIGIN and refuses the run by name when one"
echo "    falls outside the closure and the standard library"
echo "  - no Genesis checkout is on any path; node is not on PATH for any invocation"
echo "  - the anchors were SUPPLIED by the caller, never read from the receipt or the artifact"
echo
if [ "$FAILED" -ne 0 ]; then
  echo "EMPTY-DIRECTORY RESULT: RED ($FAILED arm(s) did not produce their published result)"
  exit 1
fi
echo "EMPTY-DIRECTORY RESULT: GREEN ($PASSED arms produced their published result)"
