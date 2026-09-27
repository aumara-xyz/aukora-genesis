#!/usr/bin/env python3
"""Run the finite cold-distillation contract; never infer human/model/product levels.

This ledger records checks this process actually runs, not supplied PASS labels.
Its trusted scripts are regression tooling, not an adversarial execution sandbox.
All inputs are committed synthetic/historical public fixtures; no live operation.
"""
from __future__ import annotations
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
JOBS = (
    ("alpha_profile", ("scripts/verify-alpha-profile.py",), "ALPHA PROFILE: GREEN", None),
    ("source_budget", ("scripts/check-cold-budget.py",), "COLD SOURCE BUDGET: PASS", None),
    ("runner_controls", ("-m", "unittest", "discover", "-s", "tests/alpha-runner", "-p", "test_*.py"), None, 17),
    ("budget_controls", ("-m", "unittest", "discover", "-s", "tests/cold-budget", "-p", "test_*.py"), None, 23),
    ("freeze_controls", ("-m", "unittest", "discover", "-s", "tests/alpha-freeze", "-p", "test_*.py"), None, 13),
    ("alpha_legacy", ("-m", "unittest", "discover", "-s", "tests/alpha-legacy", "-p", "test_*.py"), None, 65),
)


def accepted(returncode, output, marker=None, count=None):
    if returncode != 0:
        return False
    if marker is not None:
        return sum(line.strip() == marker for line in output.splitlines()) == 1
    matches = re.findall(r"^Ran (\d+) tests? in .*s$", output, re.M)
    return (len(matches) == 1 and int(matches[0]) > 0
            and (count is None or int(matches[0]) == count)
            and re.search(r"^OK$", output, re.M) is not None
            and not re.search(r"skipped|expected failures|unexpected successes", output))


def ledger(results):
    expected = {name for name, *_ in JOBS}
    complete = set(results) == expected and all(results.values())
    return {
        "status": "PASS" if complete else "FAIL",
        "checks": results,
        "claimLevels": {
            "fixture": "MEASURED" if complete else "NOT_ESTABLISHED",
            "human": "NOT_ESTABLISHED", "model": "NOT_ESTABLISHED",
            "product_bridge": "NOT_ESTABLISHED",
        },
        "limits": ["Receipt profiles stay distinct", "Signed counts are statements, not rerun courts",
                   "No confinement, custody, cell execution or repository-deletion approval"],
    }


def main():
    results = {}
    for name, args, marker, count in JOBS:
        try:
            run = subprocess.run([sys.executable, "-B", *args], cwd=ROOT,
                                 capture_output=True, text=True, timeout=240)
            output = run.stdout + run.stderr
            # unittest writes its own summary to stderr. Diagnostic stdout may
            # quote deliberately failing nested cases; it is not suite evidence.
            results[name] = accepted(run.returncode, output if marker else run.stderr, marker, count)
            print(f"{name}: {'PASS' if results[name] else 'FAIL'} exit={run.returncode}")
            if not results[name]:
                print(output)
        except (OSError, subprocess.TimeoutExpired) as exc:
            results[name] = False
            print(f"{name}: FAIL {type(exc).__name__}")
    report = ledger(results)
    print(json.dumps(report, sort_keys=True, indent=2))
    print("COLD DISTILLATION: " + report["status"])
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
