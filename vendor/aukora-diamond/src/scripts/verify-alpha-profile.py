#!/usr/bin/env python3
"""Run the Alpha profile: pins, the imported closure's own suite, and the compatibility checks.

    python3 scripts/verify-alpha-profile.py

ONE COMMAND, THREE THINGS, NO PREREQUISITES. No Node, no network, no model download, no Genesis
checkout, and nothing else in this repository is touched:

  1. PINS   — every imported byte is re-hashed against `profiles/alpha/PINS.json`. A moved byte
              refuses here rather than quietly changing what the profile is a copy of.
  2. IMPORT — Alpha's own suite runs, unmodified, from the profile's `src/`: 21 tests, including
              the negative ones. This is the closure being exercised as Alpha wrote it.
  3. LOCAL  — the two modules that live beside the closure: contract dispatch (three contracts,
              refused by name, exact-kind matching) and the human-approval challenge
              contradiction, reproduced rather than repaired.

EXIT STATUS. 0 when every part produced its published result, 1 otherwise.

WHAT IT DOES NOT DO. It does not modify Alpha, import its Node implementation, or push anything
back. It does not grade a Diamond or Kira receipt with Alpha's verifier: those are refused by name
in step 3, which is the point of the dispatch check.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROFILE = REPO / "profiles" / "alpha"
SRC = PROFILE / "src"
NEUTRAL = None
# Review pins are outside the imported manifest. This detects coordinated drift
# of a source file and its manifest, not malicious edits of this checker too.
PINS_SHA256 = "827a46a7580697cf06978cddd5d7e44b557677ad9de4eb746d07ef00a7e36a4b"

FAILURES = 0
RUNS: list[tuple[str, int, str]] = []


def note(label: str, passed: bool, detail: str = "") -> None:
    global FAILURES
    if not passed:
        FAILURES += 1
    print(f"  {'ok   ' if passed else 'RED  '} {label}" + (f" — {detail}" if detail else ""))


def check_pins() -> bool:
    """Every imported byte must still be the byte Alpha published."""
    try:
        manifest = (PROFILE / "PINS.json").read_bytes()
        if (PROFILE / "PINS.json").is_symlink() or hashlib.sha256(manifest).hexdigest() != PINS_SHA256:
            raise ValueError("ALPHA_PIN_MANIFEST_DRIFT")
        pins = json.loads(manifest)
    except (OSError, ValueError) as exc:
        note("pins", False, str(exc))
        return False
    drifted, checked = [], 0
    expected = {entry["path"] for entry in pins["files"] if entry["path"].startswith("src/")}
    actual = {str(path.relative_to(PROFILE)) for path in SRC.rglob("*")
              if path.is_file() and "__pycache__" not in path.parts}
    if actual != expected:
        drifted.append("ALPHA_SOURCE_INVENTORY_DRIFT")
    for entry in pins["files"]:
        path = PROFILE / entry["path"]
        parts = Path(entry["path"]).parts
        linked = PROFILE.is_symlink() or any(
            PROFILE.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts) + 1))
        if not path.is_file() or linked:
            drifted.append(f"{entry['path']} (missing)")
            continue
        data = path.read_bytes()
        got = hashlib.sha256(data).hexdigest()
        blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        checked += 1
        if got != entry["sha256"] or blob != entry["gitBlob"] or len(data) != entry["bytes"]:
            drifted.append(f"{entry['path']} {got[:12]}… != {entry['sha256'][:12]}…")
    note("pins", not drifted,
         f"{checked}/{len(pins['files'])} files verbatim at {pins['upstream']['commit'][:12]}"
         if not drifted else "; ".join(drifted))
    if not pins["transformations"]:
        note("transformations", True, "none recorded and none needed (Alpha's layout was mirrored)")
    else:
        note("transformations", False, f"{len(pins['transformations'])} recorded — inspect them")
    return not drifted and not pins["transformations"] and checked == 16


#: Run INSIDE the suite process. The empty-neutral-cwd claim is made true here and asserted here,
#: not printed by the parent: a runner that announces "empty neutral cwd" while handing a source
#: directory to `subprocess.run` is reporting a property it never checked. This checks it, from the
#: only place that can — the process whose cwd it is.
SUITE_PREAMBLE = r'''
import os, sys, unittest
want = os.path.realpath(sys.argv[1])
got = os.path.realpath(os.getcwd())
if got != want:
    print("  cwd  MISMATCH: %r is not the neutral directory %r" % (got, want))
    raise SystemExit(3)
entries = sorted(os.listdir("."))
if entries:
    print("  cwd  MISMATCH: the neutral directory is not empty: %s" % entries)
    raise SystemExit(3)
print("  cwd asserted: %s (empty, and not the profile)" % got)
print("  import path : %s" % os.environ.get("PYTHONPATH", "(none)"))
if sys.pycache_prefix != os.path.join(want, "bytecode-cache") or os.path.exists(sys.pycache_prefix):
    print("ALPHA_CACHE_NAMESPACE_REFUSED")
    raise SystemExit(3)
program = unittest.main(module=None, argv=["unittest"] + sys.argv[2:], exit=False)
result = program.result
print("ALPHA_SUITE_RESULT tests=%d skipped=%d expected_failures=%d success=%d" %
      (result.testsRun, len(result.skipped), len(result.expectedFailures), result.wasSuccessful()))
raise SystemExit(0 if result.wasSuccessful() and result.testsRun > 0
                 and not result.skipped and not result.expectedFailures else 1)
'''


def run_suite(label: str, modules: list[str], import_paths: list[Path], expected_tests: int) -> None:
    """Run one suite from the empty neutral cwd, with import paths named explicitly.

    @param label: what the reader sees.
    @param modules: dotted test modules.
    @param import_paths: the ONLY places those modules may come from, exported as PYTHONPATH.
    """
    env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPYCACHEPREFIX": str(NEUTRAL.resolve() / "bytecode-cache"),
        "PYTHONPATH": os.pathsep.join(str(path) for path in import_paths),
    }
    proc = subprocess.run(
        [sys.executable, "-B", "-c", SUITE_PREAMBLE, str(NEUTRAL), *modules],
        cwd=str(NEUTRAL), capture_output=True, text=True, env=env,
    )
    tail = [ln for ln in (proc.stdout + proc.stderr).strip().splitlines() if ln.strip()]
    ran = next((ln.strip() for ln in tail if ln.strip().startswith("Ran ")), "")
    cwd_line = next((ln.strip() for ln in tail if ln.strip().startswith("cwd asserted")), "")
    path_line = next((ln.strip() for ln in tail if ln.strip().startswith("import path")), "")
    result_line = f"ALPHA_SUITE_RESULT tests={expected_tests} skipped=0 expected_failures=0 success=1"
    passed = proc.returncode == 0 and bool(cwd_line) and tail.count(result_line) == 1
    note(label, passed, f"{ran} — {'OK' if passed else 'FAILED'}")
    if cwd_line:
        print(f"        {cwd_line}")
    if path_line:
        print(f"        {path_line}")
    if not passed:
        for line in tail[-12:]:
            print(f"        {line}")
    RUNS.append((label, proc.returncode, ran))


def neutral_is_still_empty() -> None:
    """Nothing may be written into the directory the suites ran from."""
    leftovers = sorted(entry.name for entry in NEUTRAL.iterdir())
    note("neutral directory untouched", not leftovers,
         "still empty after every suite" if not leftovers else f"contains {leftovers}")


def run_profile() -> int:
    print("\nAlpha profile — isolated, pinned, and exercised on its own terms\n")
    print(f"  profile : {PROFILE.relative_to(REPO)}")
    print("  upstream: github.com/aumara-xyz/aukora-spec-alpha (review-pinned import)")
    print(f"  every suite runs in: {NEUTRAL}")
    print("  (that cwd is asserted INSIDE each suite process, and re-checked here afterwards)\n")

    print("— 1. pins —")
    if not check_pins():
        print("ALPHA PROFILE: RED — ALPHA_PINS_REFUSED; no imported code executed")
        return 1

    print("\n— 2. the imported closure, exactly as Alpha wrote it —")
    # Explicit import paths, no ambient ones: the profile's src for `receipt_v3`, and
    # src/evidence for the ed25519 module that closure imports by bare name.
    run_suite("alpha-suite (imported, unmodified)",
              ["receipt_v3.tests.test_receipt_v3"],
              [SRC, SRC / "evidence"], 21)

    print("\n— 3. the checks that live beside it —")
    run_suite("human-ceremony contradiction (reproduced)",
              ["tests.test_alpha_human_ceremony_contradiction"],
              [PROFILE, SRC, SRC / "evidence"], 5)
    run_suite("contract dispatch (three contracts, by name)",
              ["tests.test_alpha_profile_dispatch"],
              [PROFILE, SRC, SRC / "evidence"], 8)

    neutral_is_still_empty()

    print()
    if FAILURES:
        print(f"  ALPHA PROFILE: RED — {FAILURES} part(s) failed")
        return 1
    print("  ALPHA PROFILE: GREEN")
    print(
        "\n  NOTE: this profile grades ONE contract (aukora-receipt/v3) offline. It refuses Diamond\n"
        "  composition receipts and Kira memory receipts by name rather than grading them, and\n"
        "  nothing here says a person was present: a signature is not attendance."
    )
    return 0


def main() -> int:
    global NEUTRAL, FAILURES
    FAILURES = 0
    RUNS.clear()
    with tempfile.TemporaryDirectory(prefix="alpha-profile-neutral-") as directory:
        NEUTRAL = Path(directory).resolve()
        return run_profile()


if __name__ == "__main__":
    sys.exit(main())
