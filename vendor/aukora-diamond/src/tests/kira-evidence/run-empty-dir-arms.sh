#!/usr/bin/env bash
#
# Empty-directory offline acceptance for the Kira memory-v1 evidence consumer.
#
#   tests/kira-evidence/run-empty-dir-arms.sh <target-dir>
#
# WHAT THIS PROVES, and why the SHAPE of the command is the point. The verifier runs with cwd
# INSIDE a directory that was EMPTY when the run started. Its entire contents at the moment of
# the run are printed and hashed below, so the closure is auditable rather than asserted. The
# directory holds exactly two things: the exported public evidence bundle, and the shipped
# verifier closure copied out of the working tree. The sibling Genesis checkout the producer
# lives in is NOT on the path; `node` is removed from PATH for the run, so no producer code
# could run even if something tried; and no network is used or needed.
#
# THE VERIFIER CLOSURE, stated plainly: the run directory contains the verifier
# (`verify-kira-evidence.py`), the four `diamond` package modules it imports (`__init__`,
# `kira_evidence`, `hexutil`, and `aumlok_approval` for the owner-approval arms), and the
# repository's own shipped Ed25519 and JCS modules (`ed25519.py`, `jcs.py`). That is the whole
# closure. Nothing from Genesis is needed at run time: the record identity, the canonical bytes
# and the Aura chain are recomputed by `kira_evidence.py` from the documents themselves, and the
# approval arms verify an owner approval that Genesis MINTED at a recorded commit whose code is
# not present here. The producer's JavaScript sources are vendored under `evidence/vendor/` for
# an informational parity check, and the run DELETES them before the first arm, which is how "the
# verdict does not depend on them" is measured rather than promised.
#
# NEGATIVE CONTROLS ARE GENERATED HERE, NOT COMMITTED AS A SECOND COPY. `make-arms.py` derives
# every tampered document from the committed bundle, and the arms that must carry a real
# signature re-sign with the published test seed. That seed is a fixed constant in the bundle
# beside the public key it derives; it proves a signature was made with a public test key and
# never that a person was present.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TARGET="${1:?usage: run-empty-dir-arms.sh <target-dir>}"

# The interpreter. Any Python 3 that runs the suite will do; named once so the closure probe and
# the arms cannot silently use two different ones.
PYTHON="$(command -v python3 || command -v python)"

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]; then
  echo "REFUSING: $TARGET is not empty. This check is about an EMPTY directory." >&2
  exit 2
fi

mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"
WAS_EMPTY="$(ls -A "$TARGET" | tr '\n' ' ')"

# ── stage 1: the shipped verifier closure, copied OUT of the tree ────────────────────────
mkdir -p "$TARGET/closure/diamond"
for module in __init__.py kira_evidence.py ed25519.py jcs.py hexutil.py aumlok_approval.py; do
  cp "$REPO/diamond/$module" "$TARGET/closure/diamond/$module"
done
cp "$REPO/scripts/verify-kira-evidence.py" "$TARGET/verify-kira-evidence.py"

# ── stage 2: the exported public evidence bundle ─────────────────────────────────────────
cp -R "$HERE/evidence" "$TARGET/evidence"

# ── stage 2b: the owner-approval fixtures, minted by the producer's own contract code ────
# These are documents Genesis produced at a recorded commit (`PROVENANCE.json` names the commit
# and the preimage digest). They are copied here as DATA: no Genesis source is present in this
# directory, so every approval arm below measures the consumer against bytes its producer is not
# here to defend.
cp -R "$HERE/../aumlok-approval/fixtures" "$TARGET/approval"

# ── stage 3: the negative controls, derived from the bundle's own bytes ──────────────────
"$PYTHON" "$HERE/make-arms.py" "$TARGET/arms" > "$TARGET/arms-manifest.txt"

VERIFIER=("$PYTHON" "$TARGET/verify-kira-evidence.py" --package-root "$TARGET/closure")
EV="$TARGET/evidence"
ARMS="$TARGET/arms"
FAILED=0
PASSED=0

# Every arm runs the verifier and then asserts its published result TWICE: the process exit
# status, and the presence of lines the verdict must have printed. Exit status alone would let a
# verifier that says the right word for the wrong reason pass, and would let a "signature
# verified" claim go unmeasured in the arms that depend on it being real.
REQUIRED=()
run() {
  local label="$1" expected="$2"; shift 2
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo "ARM: $label"
  echo "────────────────────────────────────────────────────────────────────────────────"
  set +e
  "${VERIFIER[@]}" "$@" 2>&1 | tee "$TARGET/.arm-output"
  local status=${PIPESTATUS[0]}
  set -e
  local verdict="pass"
  if [ "$status" -ne 0 ]; then verdict="exit status $status"; fi
  # `${REQUIRED[@]}` under `set -u` is an unbound-variable error on bash 3.2 (the macOS
  # system bash) when the array is empty, so the guarded expansion is deliberate.
  for line in ${REQUIRED[@]+"${REQUIRED[@]}"}; do
    if ! grep -qF -- "$line" "$TARGET/.arm-output"; then
      verdict="missing line: $line"
    fi
  done
  REQUIRED=()
  echo "── arm result: $verdict"
  echo
  if [ "$verdict" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
}

# The INVERTED arm. An arm that must REFUSE cannot be written as `--expect <code>` alone, because
# that expectation is satisfied by PRINTING the code while still exiting 0 — which is exactly the
# defect these arms exist for: an explicitly requested approval check that failed, printed its
# refusal, and left the verdict at VERIFIED with exit status 0. So the expectation here is
# `verified`, and the arm passes only when the verifier both refuses and exits non-zero.
must_refuse() {
  local label="$1" required_code="$2"; shift 2
  echo "────────────────────────────────────────────────────────────────────────────────"
  echo "ARM (MUST REFUSE): $label"
  echo "────────────────────────────────────────────────────────────────────────────────"
  set +e
  "${VERIFIER[@]}" "$@" --expect verified 2>&1 | tee "$TARGET/.arm-output"
  local status=${PIPESTATUS[0]}
  set -e
  local verdict="pass"
  if [ "$status" -eq 0 ]; then
    verdict="exit status 0 — it did NOT refuse"
  elif ! grep -qF -- "VERDICT: REFUSED  $required_code" "$TARGET/.arm-output"; then
    verdict="refused for the wrong reason: no 'VERDICT: REFUSED  $required_code'"
  fi
  echo "── arm result: $verdict"
  echo
  if [ "$verdict" = "pass" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
}

echo "════════════════════════════════════════════════════════════════════════════════"
echo "EMPTY-DIRECTORY OFFLINE RUN"
echo "════════════════════════════════════════════════════════════════════════════════"
echo "cwd at run time      : $TARGET"
echo "contents before this run began: '${WAS_EMPTY}' (empty)"
echo
echo "── everything in the run directory, hashed (the whole closure, nothing implied) ──"
( cd "$TARGET" && find . -type f | sort | while read -r f; do
    printf '%s  %s\n' "$("$PYTHON" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$f")" "${f#./}"
  done )
echo
echo "── the runtime sees the standard library and the closure, nothing else ──"
( cd "$TARGET" && PATH="/usr/bin:/bin" "$PYTHON" - <<'PY'
import sys
import sysconfig
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / "closure"))
import diamond.kira_evidence as ke
stdlib = getattr(sys, "stdlib_module_names", None)
if stdlib is None:  # Python < 3.10 has no sys.stdlib_module_names
    stdlib = {p.stem for p in __import__("pathlib").Path(sysconfig.get_paths()["stdlib"]).glob("*.py")}
    stdlib |= {p.name for p in __import__("pathlib").Path(sysconfig.get_paths()["stdlib"]).iterdir()
               if p.is_dir()}
# `sysconfig` IS USED HERE ON EVERY INTERPRETER, so it is imported at the top rather than inside the
# <3.10 branch above. MEASURED in CI: this line raised `NameError: name 'sysconfig' is not defined`
# on Python 3.12 — where `sys.stdlib_module_names` exists, so the branch above never ran — while the
# same script passed locally on 3.9, where it did. A diagnostic that reports what the runtime sees
# must not itself depend on the runtime's version.
compiled = {p.stem for p in __import__("pathlib").Path(sysconfig.get_paths()["stdlib"]).glob("lib-dynload/*.so")}
mods = sorted({m.split(".")[0] for m in sys.modules})
builtin = set(sys.builtin_module_names) | compiled
outside = [m for m in mods
           if m not in stdlib and m not in builtin and m != "diamond" and not m.startswith("_")]
print(f"   python                        : {sys.version.split()[0]}")
print(f"   cwd                           : {Path.cwd()}")
print(f"   modules outside stdlib+closure: {outside or '(none)'}")
print(f"   network used by the verifier  : no socket is opened by kira_evidence.py")
print(f"   ceilings attached to a verdict: {len(ke.CEILINGS)}")
PY
)
echo

# ── the independence measurement, before any arm ─────────────────────────────────────────
# The producer's vendored sources are MOVED ASIDE and two arms run without them. If any verdict
# depended on the producer's code, this is where the run would change. It does not, and the
# sources are restored before the rest of the arms so the hashed file list above stays true.
echo "── independence: moving the vendored producer sources aside for two arms ──"
mv "$EV/vendor" "$TARGET/vendor-aside"
echo "   moved: evidence/vendor -> vendor-aside (the closure and the evidence are untouched)"
run "0d — HONEST with the producer's sources ABSENT: receipt #1 must still verify" verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --store "$EV" --expect verified
run "6f — POSITION with the producer's sources ABSENT: the target must still hold" verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --store "$EV" --expect verified
run "6g — POSITION with the producer's sources ABSENT: the overclaim must still be REFUSED" \
  position-mismatch \
  --record "$EV/fixture/record.json" --receipt "$ARMS/head-claiming.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect position-mismatch
mv "$TARGET/vendor-aside" "$EV/vendor"
echo "   restored: evidence/vendor"
echo

# ── arm 0: the honest evidence MUST pass ─────────────────────────────────────────────────
REQUIRED=("   VERDICT             : VERIFIED" "   signed body digest  : " "   VERDICT             : MATCHED")
run "0 — HONEST: record + receipt #2 (the write at the log's tip)" verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-2.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --wrapper "$EV/fixture/operation.json" --store "$EV" \
  --expect verified

run "0b — HONEST: record + receipt #1 (an EARLIER write, one entry before the tip)" verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --wrapper "$EV/fixture/operation.json" --store "$EV" \
  --expect verified

run "0c — HONEST anchor, PEM spelling instead of hex (the same key, named twice)" verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$ARMS/declared-issuer.pem" --expect verified

# ── arm 1: tampered evidence ─────────────────────────────────────────────────────────────
run "1 — TAMPERED RECORD: one content byte changed, the claimed recordId left in place" \
  record-identity-mismatch \
  --record "$ARMS/tampered-record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --expect record-identity-mismatch

run "2 — TAMPERED RECEIPT: one signed field moved after signing" signature-invalid \
  --record "$EV/fixture/record.json" --receipt "$ARMS/tampered-receipt.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect signature-invalid

run "2b — TAMPERED LOG: a byte moved inside a chained entry" chain-tampered \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" \
  --log "$ARMS/log-entry-tampered.jsonl" --anchor "$EV/issuer.pk" --expect chain-tampered

run "2c — TRUNCATED LOG: the log cut mid-entry, which must refuse rather than read short" \
  log-truncated \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" \
  --log "$ARMS/truncated-log.jsonl" --anchor "$EV/issuer.pk" --expect log-truncated

run "2b2 — DECOY SPELLING: valid JSON on disk that is not the bytes that were hashed" \
  log-not-roundtrip \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" \
  --log "$ARMS/log-respelled.jsonl" --anchor "$EV/issuer.pk" --expect log-not-roundtrip

run "2d — TAMPERED OBJECT: the store's bytes no longer hash to the named digest" object-tampered \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --store "$ARMS/object-store" --expect object-tampered

# ── arm 3: the anchor ────────────────────────────────────────────────────────────────────
REQUIRED=("UNVERIFIED — no signature work was done" "VERDICT: REFUSED  anchor-mismatch")
run "3 — WRONG ANCHOR: a different, well-formed key named by the caller" anchor-mismatch \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/other-issuer.pk" --expect anchor-mismatch

run "3b — NO ANCHOR FILE: the consumer has no unanchored mode to fall back to" \
  anchor-absent \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$ARMS/absent-anchor.pk" --expect anchor-absent

run "3c — MALFORMED ANCHOR: a file that is not a key at all" anchor-unreadable \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/fixture/DIGESTS.txt" --expect anchor-unreadable

# ── arm 4: missing evidence ──────────────────────────────────────────────────────────────
run "4 — MISSING LOG: the receipt names a position in a log that is not here" log-missing \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" \
  --log "$ARMS/absent.jsonl" --anchor "$EV/issuer.pk" --expect log-missing

run "4b — MISSING OBJECT BYTES: a store root with no object for the receipt" object-missing \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --store "$ARMS" --expect object-missing

run "4c — MISSING RECEIPT FILE" evidence-unreadable \
  --record "$EV/fixture/record.json" --receipt "$ARMS/absent-receipt.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect evidence-unreadable

run "4d — MISSING RECORD FILE" evidence-unreadable \
  --record "$ARMS/absent-record.json" --receipt "$EV/receipt-1.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect evidence-unreadable

# ── arm 5: unknown profile ───────────────────────────────────────────────────────────────
run "5 — UNKNOWN RECEIPT KIND: a profile this consumer does not implement" receipt-kind \
  --record "$EV/fixture/record.json" --receipt "$ARMS/unknown-kind.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --expect receipt-kind

run "5b — UNKNOWN RECORD DOMAIN: a record profile this consumer does not implement" \
  record-domain-mismatch \
  --record "$ARMS/unknown-record-domain.json" --receipt "$EV/receipt-1.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect record-domain-mismatch

run "5c — FORBIDDEN alg FIELD: a document advertising its own algorithm" \
  receipt-forbidden-field \
  --record "$EV/fixture/record.json" --receipt "$ARMS/alg-field.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --expect receipt-forbidden-field

# ── arm 6: HISTORICAL POSITION, the acceptance target ────────────────────────────────────
run "6 — POSITION (the target): receipt #1 STILL VERIFIES after the second write" verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --store "$EV" --expect verified

run "6b — POSITION: receipt #1 STILL VERIFIES against a LONGER log (a third chained write)" \
  verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" \
  --log "$ARMS/longer-log.jsonl" --anchor "$EV/issuer.pk" --store "$EV" --expect verified

REQUIRED=("   VERDICT             : VERIFIED" "VERDICT: REFUSED  position-mismatch")
run "6c — OVERCLAIM REFUSED: a REAL signature claiming entry 2's hash at position 1" \
  position-mismatch \
  --record "$EV/fixture/record.json" --receipt "$ARMS/head-claiming.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect position-mismatch

REQUIRED=("   VERDICT             : VERIFIED" "VERDICT: REFUSED  position-prior-head-mismatch")
run "6d — OVERCLAIM REFUSED: a REAL signature stating a prior head the log does not link" \
  position-prior-head-mismatch \
  --record "$EV/fixture/record.json" --receipt "$ARMS/prior-rewritten.json" \
  --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk" --expect position-prior-head-mismatch

run "6e — POSITION BEYOND THE LOG: a receipt naming a position the log does not hold" \
  position-absent \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-2.json" \
  --log "$ARMS/truncated-one-entry.jsonl" --anchor "$EV/issuer.pk" --expect position-absent

# ── arm 7: owner approval is UNCHECKED and stays that way ────────────────────────────────
REQUIRED=("   STATUS              : OWNER_APPROVAL_UNCHECKED")
run "7 — LEGACY WRAPPER WITHOUT APPROVAL MUST REPORT OWNER_APPROVAL_UNCHECKED" \
  verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --wrapper "$EV/fixture/operation.json" --expect verified

REQUIRED=("   STATUS              : OWNER_APPROVAL_UNCHECKED" "authority.grants = True" "confirm = True")
run "7b — FORGED APPROVAL REFUSED: a wrapper asserting grants/confirm/approvedBy, unsigned" \
  verified \
  --record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json" --log "$EV/aura.jsonl" \
  --anchor "$EV/issuer.pk" --wrapper "$ARMS/forged-approval-wrapper.json" --expect verified

# ── arm 7c: the Aumlok owner-approval LANE, through THIS verifier ────────────────────────
# The fixtures were minted by Genesis's own contract code at the commit named in
# `approval/PROVENANCE.json`; the anchor is supplied SEPARATELY and never read from the document.
# A valid signature is not an authorization and not a person, and the arms assert the words that
# say so rather than trusting the reader to remember.
AP="$TARGET/approval"
APPROVAL_ARGS=(--record "$EV/fixture/record.json" --receipt "$EV/receipt-1.json"
               --log "$EV/aura.jsonl" --anchor "$EV/issuer.pk")

REQUIRED=("   STATUS              : OWNER_APPROVAL_SIGNATURE_VALID" "   LANE                : aumlok owner-approval document, offline" \
          "   D authorization           : OWNER_APPROVAL_UNCHECKED" \
          "   C memory-operation binding: OPERATION_BINDING_UNVERIFIED" \
          "   E attendance              : reported-not-proven" "VERDICT: VERIFIED")
run "7c — HONEST APPROVAL: separately anchored, verified offline — and it still authorizes nothing" \
  verified "${APPROVAL_ARGS[@]}" \
  --approval "$AP/honest.json" --approval-anchor "$AP/anchor-a.pk" --expect verified

must_refuse "7d — FORGED APPROVAL FAILS THE RUN: the evidence verifies, the approval does not" \
  APPROVAL_SIGNATURE_INVALID \
  "${APPROVAL_ARGS[@]}" --approval "$AP/forged.json" --approval-anchor "$AP/anchor-a.pk"

must_refuse "7e — CHANGED SIGNED FIELD FAILS THE RUN" APPROVAL_SIGNATURE_INVALID \
  "${APPROVAL_ARGS[@]}" --approval "$AP/changed-field.json" --approval-anchor "$AP/anchor-a.pk"

must_refuse "7f — WRONG ANCHOR FAILS THE RUN: the same bytes under another public key" \
  APPROVAL_SIGNATURE_INVALID \
  "${APPROVAL_ARGS[@]}" --approval "$AP/honest.json" --approval-anchor "$AP/anchor-b.pk"

must_refuse "7g — UNSIGNED WRAPPER CLAIMING ATTENDANCE IS REFUSED BY NAME, AND FAILS THE RUN" \
  aumlok:unsigned-wrapper-claims-attendance \
  "${APPROVAL_ARGS[@]}" --approval "$AP/wrapper-claims-attendance.json" --approval-anchor "$AP/anchor-a.pk"

must_refuse "7h — A DOCUMENT CARRYING ITS OWN KEY IS REFUSED: trust never comes from the document" \
  aumlok:anchor-from-document \
  "${APPROVAL_ARGS[@]}" --approval "$AP/key-from-document.json" --approval-anchor "$AP/anchor-a.pk"

must_refuse "7i — AN APPROVAL WITHOUT A SEPARATE ANCHOR IS REFUSED" APPROVAL_ANCHOR_ABSENT \
  "${APPROVAL_ARGS[@]}" --approval "$AP/honest.json"

REQUIRED=("   STATUS              : CALLER_DIGEST_MISMATCH" "VERDICT: REFUSED  CALLER_DIGEST_MISMATCH")
run "7j — CALLER DIGEST EQUALITY, mismatch: the same run refuses it by name" \
  CALLER_DIGEST_MISMATCH "${APPROVAL_ARGS[@]}" \
  --approval "$AP/honest.json" --approval-anchor "$AP/anchor-a.pk" \
  --approval-operation-digest "3333333333333333333333333333333333333333333333333333333333333333" \
  --expect CALLER_DIGEST_MISMATCH

REQUIRED=("   STATUS              : OWNER_APPROVAL_SIGNATURE_VALID" \
          "   C memory-operation binding: OPERATION_BINDING_UNVERIFIED" "VERDICT: VERIFIED")
run "7k — CALLER DIGEST EQUALITY, match: EQUALITY ONLY, and the binding stays UNVERIFIED" \
  verified "${APPROVAL_ARGS[@]}" \
  --approval "$AP/honest.json" --approval-anchor "$AP/anchor-a.pk" \
  --approval-operation-digest "2222222222222222222222222222222222222222222222222222222222222222" \
  --expect verified

echo "════════════════════════════════════════════════════════════════════════════════"
echo "ARM SUMMARY: $PASSED arms produced their published result, $FAILED did not"
echo "════════════════════════════════════════════════════════════════════════════════"

# ── arm 8: what the PRODUCER's own verifier says about the same bytes ────────────────────
echo
echo "── arm 8: the producer's own receipt verification, recorded beside the consumer's ──"
"$PYTHON" - "$EV/producer-summary.json" "$EV/receipt-1.json" "$EV/aura.jsonl" <<'PY'
import json, sys
summary = json.loads(open(sys.argv[1], encoding="utf-8").read())
receipt = json.loads(open(sys.argv[2], encoding="utf-8").read())
head = [json.loads(line) for line in open(sys.argv[3], encoding="utf-8").read().splitlines()][-1]
verdict = summary["producerVerdictReceipt1AfterSecondWrite"]
print(f"   producer's rule, restated: the receipt must name the log's CURRENT head")
print(f"     receipt #1 aura.head : {receipt['aura']['head']}")
print(f"     log head after write 2: {head['hash']}")
print(f"   producer verdict on receipt #1 after the second write: "
      f"{'ACCEPTED' if verdict['ok'] else 'REFUSED ' + verdict['code']}")
print(f"     — {verdict['message'] if not verdict['ok'] else verdict['result']}")
print()
print("   THIS IS THE FINDING, AND IT IS THE REASON THIS CONSUMER EXISTS. The producer's own")
print("   verifier requires chain.head == receipt.aura.head, so a receipt is valid only while it")
print("   is the tip. After a second valid write the FIRST receipt is REFUSED by the producer's")
print("   verifier with MEMORY_TAMPERED, although nothing about it was tampered with and the log")
print("   still contains exactly the entry and prior head it names. The consumer below checks the")
print("   receipt's OWN POSITION instead, so the same first receipt VERIFIES (arm 6), while a")
print("   re-signed receipt claiming a later entry hash at an earlier position is REFUSED by")
print("   position (arm 6c). Tip-equality and position-equality are different questions.")
PY
echo
echo "CROSS-CHECK: does the consumer depend on anything outside the run directory?"
echo "  - no Genesis path is on sys.path: only \$TARGET/closure is inserted"
echo "  - node is not on PATH for the run, so the vendored producer could not run"
echo "  - the vendored producer sources were MOVED ASIDE for arms 0d/6f/6g and every one of"
echo "    them still produced its published result: the verdicts do not read producer code"
echo
if [ "$FAILED" -ne 0 ]; then
  echo "EMPTY-DIRECTORY RESULT: RED ($FAILED arm(s) did not produce their published result)"
  exit 1
fi
echo "EMPTY-DIRECTORY RESULT: GREEN ($PASSED arms produced their published result)"
