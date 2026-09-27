#!/usr/bin/env bash
# declared-id-regression.sh — a declared governed id with no mapped path must not run.
#
#   bash plugins/aukora-composition-gate/test/declared-id-regression.sh [parent-dir]
#
# Restored 2026-09-27 from the pre-cut tree (4d603f8dd^) as the ONE check for closing D3: arm 6 is
# flipped, as its own header asked, from asserting the defect to requiring the refusal.
#
# THE REGRESSION. `policy.js` used to choose between its two bindings instead of honouring both:
#
#     governedFiles.length ? governedFiles.includes(filePath)
#                         : governed.has(governedIdFor(filePath))
#
# launch-dsh.py maps exactly one path (the release's `governedDemo`), so `governedFiles` is
# nonempty in every materialized release, the id branch was dead, and any SECOND declared id
# without a mapped path imported its module body with no admission and no refusal.
#
# WORK DIRECTORY CONTRACT. This suite REMOVES a directory, so it must never remove one it was
# handed. The argument is a PARENT: the suite creates a unique `mktemp -d` child under it and
# removes only that child. A sentinel file is written into the parent first and re-checked at the
# end, so "the parent survived" is asserted rather than assumed. An earlier version ran
# `rm -rf "$WORK"` on the caller's argument before any validation, which would have deleted an
# arbitrary supplied directory.
#
# WHAT IS ASSERTED
#
#   1 control-declared-mapped      declared + mapped, no grant        -> REFUSED NO_GRANT
#   2 regression-unmapped-id       declared, NO mapped path           -> REFUSED NO_GRANT
#         THE BYPASS. Before the fix this imported and its body ran.
#   3 wrong-path-no-grant          declared id, DIFFERENT path, no grant -> REFUSED NO_GRANT
#   4 control-undeclared           id declared nowhere                -> RUNS
#   5 admitted-declared-mapped     declared + mapped, REAL grant      -> ADMITTED
#   6 relocated-identical-bytes    that grant, presented at ANOTHER path whose bytes are
#                                  IDENTICAL                           -> REFUSED GRANT_PATH_NOT_GRANTED
#         D3, CLOSED. Until 2026-09-27 this arm ASSERTED the defect (ADMITTED): the mint carried no
#         pluginPath/pluginClosure and the hook compared a path only when the grant carried one. The
#         mint now binds both (release-relative, canonical, via grant-binding.mjs) and the hook refuses
#         a grant without them, so the relocated copy is refused by the place it names.
#   7 relocated-changed-bytes      same grant, another path, DIFFERENT bytes -> REFUSED
#         GRANT_BYTES_MISMATCH. The byte binding is real and is the part that holds.
#   8 control-sentinel-preserved   the caller's parent directory and its sentinel still exist
#   9 unbound-grant-refused        a grant minted WITHOUT pluginPath/pluginClosure, presented for the
#                                  mapped file with the right bytes  -> REFUSED GRANT_PATH_NOT_GRANTED
#         The red arm for the hook half of D3: the bytes are right, and only the missing binding refuses.
#
# Every arm gets its own state dir, effect log and result file. Disposable state only:
# AUKORA_GATE_CONFIG is cleared for every probe — install.js gives it precedence over
# AUKORA_GATE_*, and an inherited one pointing at live state would silently govern this suite
# with live policy — and the mediator is set explicitly so an inherited AUKORA_MEDIATOR inside
# the off-set cannot turn every arm into a MEDIATOR_OFF refusal.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE_ROOT="$(cd "$HERE/../../.." && pwd)"
POLICY_DIR="$GATE_ROOT/plugins/aukora-composition-gate"
PY="${AUKORA_PYTHON:-python3}"
NODE_BIN="${AUKORA_NODE:-node}"

FAILURES=0
ARMS=0
ok()  { ARMS=$((ARMS+1)); printf '  ok    %s\n' "$*"; }
bad() { ARMS=$((ARMS+1)); FAILURES=$((FAILURES+1)); printf '  FAIL  %s\n' "$*"; }

# ── work directory: create an owned child; never remove the caller's argument ─────────────
PARENT="${1:-${TMPDIR:-/tmp}/b3-declared-id-tests}"
mkdir -p "$PARENT" || { printf '  FAIL  cannot create parent %s\n' "$PARENT" >&2; exit 1; }
PARENT="$(cd "$PARENT" && pwd -P)"
SENTINEL="$PARENT/.b3-declared-id-sentinel"
"$PY" -c "import sys;open(sys.argv[1],'w').write('sentinel: do not remove\n')" "$SENTINEL"

WORK="$(mktemp -d "$PARENT/run.XXXXXX")" || {
  printf '  FAIL  mktemp -d failed under %s\n' "$PARENT" >&2; exit 1; }
# macOS: /tmp is a symlink to /private/tmp, while policy.js resolve()s governedFiles entries and
# fileURLToPath() returns the real path — so a /tmp/... mapping can never match and the gate
# would silently govern nothing, giving a suite of false greens. Canonicalise before building.
WORK="$(cd "$WORK" && pwd -P)"

cleanup() { rm -rf "$WORK"; }   # the owned child only; $PARENT is never removed
trap cleanup EXIT

MODS="$WORK/mods"
DECOY="$WORK/decoy"
mkdir -p "$MODS" "$DECOY"

write_module() { # write_module <path> <id> [extra-line]
  local path="$1" id="$2" extra="${3:-}"
  cat > "$path" <<EOF
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.AUKORA_REGRESSION_EFFECT_LOG, 'BODY-RAN $id\n');
export const id = '$id';
$extra
EOF
}

write_module "$MODS/hello-governed.mjs"  hello-governed
write_module "$MODS/second-declared.mjs" second-declared
write_module "$MODS/undeclared.mjs"      undeclared
# Same basename as the mapped entry, so the SAME governed id, at a DIFFERENT path. Written from
# the same bytes deliberately: arm 6 measures that case rather than assuming it away.
mkdir -p "$DECOY/hello-governed"
write_module "$DECOY/hello-governed/hello-governed.mjs" hello-governed
# Arm 7 needs the SAME BASENAME whose bytes DIFFER: governedIdFor derives the id from the
# basename, so a file called twin-changed.mjs is id `twin-changed`, which is declared nowhere and
# therefore legitimately ungoverned. Written as hello-governed.mjs under a different directory, so
# it claims the declared id while presenting different bytes.
mkdir -p "$DECOY/changed-bytes"
write_module "$DECOY/changed-bytes/hello-governed.mjs" hello-governed "// deliberately different bytes"

read_field() { "$PY" -I - "$1" "$2" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
print(eval(sys.argv[2], {"d": d}))
PYEOF
}

sha() { "$PY" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()[:16])" "$1"; }

MAPPED_FILES="$MODS/hello-governed.mjs"
GOVERNED_IDS="hello-governed,second-declared"

# run_probe <arm> <module> <grant-json-or-empty>
# `env -u AUKORA_GATE_CONFIG` is the isolation: the AUKORA_GATE_* variables must decide.
run_probe() {
  local arm="$1" module="$2" grant="$3"
  local dir="$WORK/runs/$arm"
  rm -rf "$dir"; mkdir -p "$dir/state"
  : > "$dir/effects.log"
  if [ -n "$grant" ]; then
    mkdir -p "$dir/state/grants"
    cp "$grant" "$dir/state/grants/hello-governed.json"
    # The governor key must travel WITH the grant: policy.js reads governor.pk from stateDir and
    # refuses with NO_GRANT when it is absent, because a grant is authorized by the key configured
    # here and never by the key it carries. Omitting it made every grant arm report NO_GRANT,
    # which looks exactly like a path-binding refusal — the mistake this comment exists to stop
    # someone repeating.
    cp "$MINT_DIR/governor.pk" "$dir/state/governor.pk"
  fi
  (
    cd "$dir" &&
    env -u AUKORA_GATE_CONFIG \
        AUKORA_MEDIATOR=1 \
        AUKORA_GATE_GOVERNED="$GOVERNED_IDS" \
        AUKORA_GATE_FILES="$MAPPED_FILES" \
        AUKORA_GATE_STATE="$dir/state" \
        AUKORA_GATE_ROOT="$WORK" \
        AUKORA_REGRESSION_EFFECT_LOG="$dir/effects.log" \
        "$NODE_BIN" --import "$POLICY_DIR/src/install.js" \
        "$POLICY_DIR/test/declared-id-regression.mjs" \
        "$module" "$dir/result.json" > "$dir/gate.log" 2>&1
  )
  printf '%s' "$dir"
}

# Mint ONE grant for the mapped entry's exact bytes. Every grant-using arm copies it, so the arms
# differ only in WHICH PATH and WHICH BYTES are presented.
MINT_DIR="$WORK/mint"
mkdir -p "$MINT_DIR/grants"
MINTED=""
if "$PY" "$GATE_ROOT/scripts/composition/__main__.py" grant --state "$MINT_DIR" \
     --plugin "$MAPPED_FILES" --operation load --root "$WORK" \
     --out "$MINT_DIR/grants/hello-governed.json" > "$MINT_DIR/mint.log" 2>&1 && \
   [ -f "$MINT_DIR/grants/hello-governed.json" ]; then
  MINTED="$MINT_DIR/grants/hello-governed.json"
fi

printf '\n── declared-id regression: a declaration without a mapped path ──\n'
printf '  policy : %s\n' "$POLICY_DIR/src/policy.js"
printf '  work   : %s  (owned child of %s)\n' "$WORK" "$PARENT"
printf '  digests: mapped=%s relocated-same=%s relocated-changed=%s\n' \
  "$(sha "$MAPPED_FILES")" "$(sha "$DECOY/hello-governed/hello-governed.mjs")" "$(sha "$DECOY/changed-bytes/hello-governed.mjs")"

# ── arm 1: control — declared AND mapped, no grant ────────────────────────────────────────
d="$(run_probe control-declared-mapped "$MAPPED_FILES" "")"
ran="$(read_field "$d/result.json" "d['bodyRan']")"
codes="$(read_field "$d/result.json" "','.join(d['refusalCodes'])")"
if [ "$ran" = "False" ] && [ "$codes" = "NO_GRANT" ]; then
  ok "arm 1 control-declared-mapped: mapped entry REFUSED NO_GRANT, body did not run"
else
  bad "arm 1 control-declared-mapped: bodyRan=$ran codes='$codes'"
fi

# ── arm 2: THE REGRESSION — declared id with NO mapped path ───────────────────────────────
d="$(run_probe regression-unmapped-id "$MODS/second-declared.mjs" "")"
ran="$(read_field "$d/result.json" "d['bodyRan']")"
codes="$(read_field "$d/result.json" "','.join(d['refusalCodes'])")"
if [ "$ran" = "False" ] && [ "$codes" = "NO_GRANT" ]; then
  ok "arm 2 regression-unmapped-id: declared id with no mapped path REFUSED NO_GRANT, body did not run"
else
  bad "arm 2 regression-unmapped-id: a declared governed id RAN UNGOVERNED (bodyRan=$ran codes='$codes') — this is the bypass"
  grep -E 'REFUSE|ACCEPT' "$d/gate.log" 2>/dev/null | tail -2 | sed 's/^/        /'
fi

# ── arm 3: declared id, different path, NO grant ──────────────────────────────────────────
d="$(run_probe wrong-path-no-grant "$DECOY/hello-governed/hello-governed.mjs" "")"
ran="$(read_field "$d/result.json" "d['bodyRan']")"
codes="$(read_field "$d/result.json" "','.join(d['refusalCodes'])")"
if [ "$ran" = "False" ] && [ "$codes" = "NO_GRANT" ]; then
  ok "arm 3 wrong-path-no-grant: same-named file at another path REFUSED NO_GRANT with no grant"
else
  bad "arm 3 wrong-path-no-grant: bodyRan=$ran codes='$codes'"
fi

# ── arm 4: control — genuinely undeclared ─────────────────────────────────────────────────
d="$(run_probe control-undeclared "$MODS/undeclared.mjs" "")"
ran="$(read_field "$d/result.json" "d['bodyRan']")"
adm="$(read_field "$d/result.json" "d['admitted']")"
if [ "$ran" = "True" ] && [ "$adm" = "0" ]; then
  ok "arm 4 control-undeclared: an id declared nowhere still runs (not a blanket denial)"
else
  bad "arm 4 control-undeclared: bodyRan=$ran admitted=$adm — the gate may be refusing everything"
fi

# ── arm 5: control — declared AND mapped, REAL grant ──────────────────────────────────────
if [ -n "$MINTED" ]; then
  d="$(run_probe admitted-declared-mapped "$MAPPED_FILES" "$MINTED")"
  ran="$(read_field "$d/result.json" "d['bodyRan']")"
  adm="$(read_field "$d/result.json" "d['admitted']")"
  if [ "$ran" = "True" ] && [ "$adm" = "1" ]; then
    ok "arm 5 admitted-declared-mapped: a real grant still ADMITS the mapped entry (body ran, 1 admission)"
  else
    bad "arm 5 admitted-declared-mapped: bodyRan=$ran admitted=$adm — honest admission broke"
    grep -E 'REFUSE|ACCEPT' "$d/gate.log" 2>/dev/null | tail -2 | sed 's/^/        /'
  fi
else
  bad "arm 5 admitted-declared-mapped: could not mint a grant for the exact bytes"
  tail -3 "$MINT_DIR/mint.log" 2>/dev/null | sed 's/^/        /'
fi

# ── arm 6: the grant presented at ANOTHER path with IDENTICAL bytes ───────────────────────
# The contract question, measured rather than asserted.
if [ -n "$MINTED" ]; then
  d="$(run_probe relocated-identical-bytes "$DECOY/hello-governed/hello-governed.mjs" "$MINTED")"
  ran="$(read_field "$d/result.json" "d['bodyRan']")"
  adm="$(read_field "$d/result.json" "d['admitted']")"
  codes="$(read_field "$d/result.json" "','.join(d['refusalCodes'])")"
  # **D3 CLOSED: THIS ARM REQUIRES THE REFUSAL.** It used to assert the defect (ADMITTED), because the grant
  # contract bound id + bytes only. The grant now carries its release-relative path and closure, and the hook
  # refuses a copy at any other place, so ADMITTED here is the regression.
  if [ "$ran" = "False" ] && [ "$codes" = "GRANT_PATH_NOT_GRANTED" ]; then
    ok "arm 6 relocated-identical-bytes: REFUSED GRANT_PATH_NOT_GRANTED, body did not run — D3 is CLOSED"
    grep -E 'REFUSE' "$d/gate.log" 2>/dev/null | tail -1 | sed 's/^/        /'
  elif [ "$ran" = "True" ]; then
    bad "arm 6 relocated-identical-bytes: ADMITTED (bodyRan=$ran admitted=$adm) — D3 IS BACK: a byte-identical copy at another path was admitted"
  else
    bad "arm 6 relocated-identical-bytes: unmeasured (bodyRan=$ran admitted=$adm codes='$codes')"
  fi
else
  bad "arm 6 relocated-identical-bytes: no grant to relocate"
fi

# ── arm 7: same grant, another path, DIFFERENT bytes ──────────────────────────────────────
if [ -n "$MINTED" ]; then
  d="$(run_probe relocated-changed-bytes "$DECOY/changed-bytes/hello-governed.mjs" "$MINTED")"
  ran="$(read_field "$d/result.json" "d['bodyRan']")"
  codes="$(read_field "$d/result.json" "','.join(d['refusalCodes'])")"
  if [ "$ran" = "False" ] && [ "$codes" = "GRANT_BYTES_MISMATCH" ]; then
    ok "arm 7 relocated-changed-bytes: REFUSED GRANT_BYTES_MISMATCH — the byte binding holds"
  else
    bad "arm 7 relocated-changed-bytes: bodyRan=$ran codes='$codes' (want GRANT_BYTES_MISMATCH)"
  fi
else
  bad "arm 7 relocated-changed-bytes: no grant to present"
fi

# ── arm 9: a grant with the right bytes and NO path/closure binding ───────────────────────
# Minted through grant.issue directly, because the CLI no longer mints the unbound tier.
UNBOUND="$MINT_DIR/unbound.json"
if "$PY" -I - "$GATE_ROOT/scripts/composition" "$MINT_DIR" "$MAPPED_FILES" "$UNBOUND" <<'PYEOF' > "$MINT_DIR/unbound.log" 2>&1
import os, sys, time
sys.path.insert(0, sys.argv[1]); sys.dont_write_bytecode = True
import grant, loader, receipt
gate = loader.Loader(sys.argv[2])
data = open(sys.argv[3], 'rb').read()
now = int(time.time())
doc = grant.issue(seed=gate.governor_seed, governor_pk=gate.governor_pk, operation='load',
                  plugin_digest=loader.plugin_digest(data), coeffect_digest=grant.coeffect_digest(os.getuid()),
                  nonce=receipt.fresh_nonce(), expiry=now + 3600, issued_at=now)
assert 'pluginPath' not in doc and 'pluginClosure' not in doc
receipt.write(sys.argv[4], doc)
PYEOF
then
  d="$(run_probe unbound-grant "$MAPPED_FILES" "$UNBOUND")"
  ran="$(read_field "$d/result.json" "d['bodyRan']")"
  codes="$(read_field "$d/result.json" "','.join(d['refusalCodes'])")"
  if [ "$ran" = "False" ] && [ "$codes" = "GRANT_PATH_NOT_GRANTED" ]; then
    ok "arm 9 unbound-grant-refused: right bytes, no pluginPath/pluginClosure -> REFUSED GRANT_PATH_NOT_GRANTED"
  else
    bad "arm 9 unbound-grant-refused: bodyRan=$ran codes='$codes' — a grant that names no place was accepted"
  fi
else
  bad "arm 9 unbound-grant-refused: could not mint the unbound grant"
  tail -3 "$MINT_DIR/unbound.log" 2>/dev/null | sed 's/^/        /'
fi

# ── arm 8: the caller's directory survived ────────────────────────────────────────────────
if [ -f "$SENTINEL" ] && [ -d "$PARENT" ]; then
  ok "arm 8 control-sentinel-preserved: caller's parent and sentinel intact (only the owned child removed)"
else
  bad "arm 8 control-sentinel-preserved: the caller's parent or its sentinel was removed"
fi

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '  %d/%d declared-id arms as expected\n' "$ARMS" "$ARMS"
  exit 0
fi
printf '  %d of %d declared-id arms FAILED\n' "$FAILURES" "$ARMS"
exit 1
