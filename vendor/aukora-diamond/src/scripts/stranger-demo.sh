#!/usr/bin/env bash
# Meeting demo for a stranger / investor. Default: scenarios plus Diamond seal.
set -euo pipefail
SCENARIOS_ONLY=0
if [[ $# -eq 1 && "$1" == "--scenarios-only" ]]; then
  SCENARIOS_ONLY=1
elif [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--scenarios-only]" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"

OUT="${STRANGER_OUT:-out}"
OUT_B="${STRANGER_OUT_B:-out-b}"
VERIFY="$ROOT/vendor/phase0/verify.py"
PLUGIN="$OUT/plugin-src.bin"

banner() {
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "  $*"
  echo "════════════════════════════════════════════════════════════"
}

step() {
  echo
  echo "── $* ──"
}

die() {
  echo
  echo "STRANGER-DEMO: RED — $*"
  exit 1
}

# Phase 0 exits non-zero on CONFLICT/UNDETERMINED; capture verdict only.
phase0_verdict() {
  local out rc
  set +e
  out="$(python3 "$VERIFY" "$@" 2>/dev/null)"
  rc=$?
  set -e
  printf '%s\n' "$out" | awk 'NF {line=$0} END {print line}'
  return 0
}

banner "AUKORA-TOY — stranger / funding demo"
echo "Sealed-toy scope. No Deep. No CONFORMING claim. No Cordis fork."
echo "Measured: separate process + separate root for retainer-B (not device independence)."
echo
if [[ -f PITCH.md ]]; then
  sed -n '1,80p' PITCH.md
fi

rm -rf "$OUT" "$OUT_B"
mkdir -p "$OUT"

# ── 1. Refuse without grant ──────────────────────────────────────────
step "1/8  REFUSE without grant"
printf '%s\n' "aukora-toy ephemeral echo" > "$PLUGIN"
set +e
REFUSE_OUT="$(python3 -m diamond.loader --out "$OUT/refuse" activate \
  --operation load --plugin "$PLUGIN" 2>&1)"
REFUSE_RC=$?
set -e
echo "$REFUSE_OUT"
[[ "$REFUSE_RC" -ne 0 ]] || die "expected refuse, got success"
echo "$REFUSE_OUT" | grep -q REFUSE || die "missing REFUSE"
echo "$REFUSE_OUT" | grep -q BOOTSTRAP_UNGATED || die "missing BOOTSTRAP_UNGATED"
echo "$REFUSE_OUT" | grep -q SAME_UID || die "missing SAME_UID"
echo "OK  refuse prints ceilings"

# ── 2. Grant → load → work → unload ──────────────────────────────────
step "2/8  GRANT → LOAD → WORK → UNLOAD (dual receipts + separate-root B)"
python3 -m diamond.demo --out "$OUT" --retainer-b-root "$OUT_B"
[[ -f "$OUT/receipt-load.json" && -f "$OUT/receipt-unload.json" ]] || die "receipts missing"
[[ -f "$OUT/issuer.pk" && -f "$OUT/governor.pk" ]] || die "public keys missing next to receipts"
[[ -f "$OUT/retained.json" && -f "$OUT/presented.json" ]] || die "Phase 0 pair missing"
[[ -f "$OUT_B/retained.json" ]] || die "retainer-B missing under separate root $OUT_B"
# A and B must not share the same directory.
[[ "$(cd "$OUT" && pwd)" != "$(cd "$OUT_B" && pwd)" ]] || die "A and B share a root"
echo "OK  receipts + keys + retainer-B under $OUT_B (separate process + root)"

# ── 3. Cold-verify both receipts (require --pub; fail closed otherwise) ─
step "3/8  COLD VERIFY both receipts (require --pub; fail closed)"
for rec in receipt-load.json receipt-unload.json; do
  echo "· $rec --pub"
  COLD="$(python3 -m diamond.cold_verify "$OUT/$rec" --pub "$OUT/issuer.pk")"
  echo "$COLD"
  echo "$COLD" | grep -q 'SIGNATURE_VALID' || die "$rec SIGNATURE_VALID"
  echo "$COLD" | grep -q 'SIGNER_KEY_MATCHED' || die "$rec SIGNER_KEY_MATCHED"
  echo "$COLD" | grep -q 'CLASS: unattributed' || die "$rec class"
  echo "$COLD" | grep -q 'CONFORMANCE: NON-CONFORMING' || die "$rec conformance"
  echo "$COLD" | grep -q 'CONSISTENCY_UNCHECKED' || die "$rec consistency hint"
  echo "$COLD" | grep -q 'ATTENDANCE: reported-not-proven' || die "$rec attendance"
  if echo "$COLD" | grep -v NON-CONFORMING | grep -q CONFORMING; then
    die "$rec claimed CONFORMING"
  fi
done
echo "· receipt-load.json without --pub (must fail closed)"
set +e
COLD_U="$(python3 -m diamond.cold_verify "$OUT/receipt-load.json" 2>&1)"
COLD_U_RC=$?
set -e
echo "$COLD_U"
[[ "$COLD_U_RC" -ne 0 ]] || die "cold verify must fail closed without --pub"
echo "$COLD_U" | grep -qi 'fail-closed\|REFUSE\|require --pub' || die "missing fail-closed message"
echo "OK  cold court: KEY_MATCHED + fail-closed without --pub"

step "Cold honesty: approval labels are not measured presence"
python3 -B -m unittest discover -s "$ROOT/tests/continuity-spine" -p 'test_authority_mode.py'
echo "OK  unsupported human-ceremony refused; scripted labels stay reported; cell execution NOT_ESTABLISHED"

# ── 4. Phase 0 APPEND_ONLY (+ signed verify-pair) ────────────────────
step "4/8  PHASE 0  retained → presented  (APPEND_ONLY + checkpoint sig)"
VP="$(python3 -m diamond.verify_pair "$OUT/retained.json" "$OUT/presented.json" --pub "$OUT/issuer.pk" 2>&1)" || true
echo "$VP"
echo "$VP" | grep -q 'CHECKPOINT_SIG: OK' || die "checkpoint sig missing"
echo "$VP" | grep -q 'APPEND_ONLY' || die "verify-pair want APPEND_ONLY"
V="$(phase0_verdict --retained "$OUT/retained.json" --presented "$OUT/presented.json")"
echo "verdict: $V"
[[ "$V" == "APPEND_ONLY" ]] || die "want APPEND_ONLY got $V"
echo "OK  APPEND_ONLY + signed checkpoints"

# ── 5. Phase 0 CONFLICT mutant ───────────────────────────────────────
step "5/8  PHASE 0  mutant presented.root  (OBSERVATION_CONFLICT)"
V="$(phase0_verdict --retained "$OUT/retained.json" --presented "$OUT/presented.json" --mutate)"
echo "verdict: $V"
[[ "$V" == "OBSERVATION_CONFLICT" ]] || die "want OBSERVATION_CONFLICT got $V"
echo "OK  CONFLICT mutant"

# ── 6. Separate-root second retainer ─────────────────────────────────
step "6/8  SEPARATE-ROOT RETAINER  (A + B both APPEND_ONLY; mutate only A)"
VA="$(phase0_verdict --retained "$OUT/retained.json" --presented "$OUT/presented.json")"
VB="$(phase0_verdict --retained "$OUT_B/retained.json" --presented "$OUT/presented.json")"
echo "A: $VA"
echo "B: $VB"
[[ "$VA" == "APPEND_ONLY" && "$VB" == "APPEND_ONLY" ]] || die "both retainers must APPEND_ONLY"

python3 - <<PY
import json
from pathlib import Path
p = Path("$OUT/retained.json")
obj = json.loads(p.read_text())
root = obj["root"]
obj["root"] = root[:-1] + ("0" if root[-1] != "0" else "1")
p.write_text(json.dumps(obj, indent=2) + "\n")
print("mutated A retained.root")
PY
VA="$(phase0_verdict --retained "$OUT/retained.json" --presented "$OUT/presented.json")"
VB="$(phase0_verdict --retained "$OUT_B/retained.json" --presented "$OUT/presented.json")"
echo "A after mutate: $VA"
echo "B after mutate: $VB"
[[ "$VA" == "OBSERVATION_CONFLICT" ]] || die "mutated A want CONFLICT got $VA"
[[ "$VB" == "APPEND_ONLY" ]] || die "B want APPEND_ONLY got $VB"
echo "OK  separate-root: A CONFLICT / B APPEND_ONLY (separate process + root measured)"

# ── 7. Foreign smoke ─────────────────────────────────────────────────
step "7/8  FOREIGN second-implementation smoke (load receipt)"
FOREIGN="$(python3 -m foreign.verify_receipt "$OUT/receipt-load.json" --pub "$OUT/issuer.pk")"
echo "$FOREIGN"
echo "$FOREIGN" | grep -q 'FOREIGN: SIGNATURE_VALID' || die "foreign signature"
echo "$FOREIGN" | grep -q 'FOREIGN: SIGNER_KEY_MATCHED' || die "foreign signer"
echo "OK  foreign cold verify load receipt"

# ── 8. Diamond seal ──────────────────────────────────────────────────
if [[ "$SCENARIOS_ONLY" -eq 1 ]]; then
  step "8/8  DIAMOND SEAL: NOT RUN (--scenarios-only)"
  echo "The scenarios passed; no Diamond seal was run by this invocation."
  banner "STRANGER-SCENARIOS:GREEN"
else
  step "8/8  DIAMOND SEAL"
  # The sensitivity mutants re-run the whole court once per protection, so
  # the standalone demo opts out; ./scripts/diamond.sh and CI run them in full.
  AUKORA_COURT_SKIP_MUTANTS=1 ./scripts/diamond.sh
  banner "STRANGER-DEMO: GREEN"
fi
echo "Commands for a re-run:"
echo "  cd $ROOT"
echo "  ./scripts/stranger-demo.sh"
echo "  ./scripts/diamond.sh"
exit 0
