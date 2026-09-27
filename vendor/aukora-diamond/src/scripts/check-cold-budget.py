#!/usr/bin/env python3
"""Check the reviewed cold-source inventory and raw byte/physical-line budgets.

The boundary IMPORTS dictionary is parsed as syntax, never imported or executed.
This is a source-size review gate, not confinement or a security proof. It does
not discover transitive imports, measure the interpreter, or replace the boundary
court. There is deliberately no command to refresh or relax the reviewed budget.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
BUDGET = "tests/cold-budget/budget.json"
BOUNDARY = "tests/continuity-spine/boundary.py"
ALPHA_SRC = "profiles/alpha/src"
LEGACY_SRC = "profiles/alpha/legacy"
LEGACY_MODULES = {LEGACY_SRC + "/" + name + ".py" for name in ("keychain", "witness", "receipt")}
LEGACY_CLI = "scripts/verify-alpha-legacy.py"
STANDALONE_FREEZE = "scripts/verify-alpha-freeze.py"
SCHEMA = "diamond-cold-source-budget-v1"
SCOPE = {
    "cold": BOUNDARY + ": top-level IMPORTS dictionary keys, mapped to .py paths",
    "alpha": "profiles/alpha/dispatch.py and profiles/alpha/src/**/*.py; exclude directories named tests or __pycache__",
    "standalone_freeze": STANDALONE_FREEZE + ": explicit cold consumer; diamond.ed25519 already counted in cold inventory",
    "legacy": "profiles/alpha/legacy/{keychain,witness,receipt}.py and scripts/verify-alpha-legacy.py; include additional legacy Python modules except __pycache__ for review",
    "bytes": "raw file bytes, including comments and blank lines",
    "physical_lines": "LF bytes plus one for a nonempty final unterminated line",
}
LIMITS = "Source-size review gate only; not confinement or a security proof. No transitive dependency or interpreter measurement."
METRICS = {"bytes", "physical_lines"}


class Refusal(ValueError):
    pass


def refuse(code: str, detail: str) -> None:
    raise Refusal(f"{code}: {detail}")


def checked_path(root: Path, relative: str, directory: bool = False) -> Path:
    """Reject absent, special and symlink components before reading source."""
    parts = PurePosixPath(relative).parts
    if (not parts or relative != "/".join(parts) or PurePosixPath(relative).is_absolute()
            or ".." in parts or "\\" in relative or any(ord(char) < 32 for char in relative)):
        refuse("SOURCE_PATH_MALFORMED", repr(relative))
    path = root
    for part in parts:
        path = path / part
        try:
            mode = path.lstat().st_mode
        except OSError as exc:
            refuse("SOURCE_MISSING_OR_UNREADABLE", f"{relative} ({type(exc).__name__})")
        if stat.S_ISLNK(mode):
            refuse("SOURCE_SYMLINK", path.relative_to(root).as_posix())
        final = path == root / relative
        if not (stat.S_ISDIR(mode) if directory or not final else stat.S_ISREG(mode)):
            refuse("SOURCE_TYPE", relative)
    return path


def read_source(root: Path, relative: str) -> bytes:
    try:
        return checked_path(root, relative).read_bytes()
    except OSError as exc:
        refuse("SOURCE_UNREADABLE", f"{relative} ({type(exc).__name__})")


def cold_inventory(root: Path) -> set[str]:
    try:
        tree = ast.parse(read_source(root, BOUNDARY), filename=BOUNDARY)
    except (SyntaxError, ValueError) as exc:
        if isinstance(exc, Refusal):
            raise
        refuse("INVENTORY_MALFORMED", f"{BOUNDARY} ({type(exc).__name__})")
    assignments = [node for node in ast.walk(tree) if isinstance(node, (ast.Assign, ast.AnnAssign))
                   and any(isinstance(target, ast.Name) and target.id == "IMPORTS"
                           for target in (node.targets if isinstance(node, ast.Assign) else [node.target]))]
    if len(assignments) != 1 or assignments[0] not in tree.body:
        refuse("INVENTORY_MALFORMED", "exactly one top-level IMPORTS assignment is required")
    value = assignments[0].value
    if not isinstance(value, ast.Dict) or not value.keys:
        refuse("INVENTORY_MALFORMED", "IMPORTS must be a nonempty literal dictionary")
    modules = set()
    for key, imports in zip(value.keys, value.values):
        if (not isinstance(key, ast.Constant) or not isinstance(key.value, str)
                or not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9-]*(?:\.[A-Za-z_][A-Za-z_0-9-]*)*", key.value)
                or key.value in modules):
            refuse("INVENTORY_MALFORMED", "IMPORTS keys must be unique module-name strings")
        # The existing policy uses literal sets and set() for an empty set.
        empty_set = (isinstance(imports, ast.Call) and isinstance(imports.func, ast.Name)
                     and imports.func.id == "set" and not imports.args and not imports.keywords)
        if not empty_set and (not isinstance(imports, ast.Set)
                              or any(not isinstance(item, ast.Constant) or not isinstance(item.value, str)
                                     or not item.value for item in imports.elts)):
            refuse("INVENTORY_MALFORMED", f"IMPORTS[{key.value!r}] must be a literal set of import names")
        modules.add(key.value)
    return {module.replace(".", "/") + ".py" for module in modules}


def python_inventory(root: Path, source_dir: str, exclude_tests: bool) -> set[str]:
    source = checked_path(root, source_dir, directory=True)
    result = set()
    pending = [source]
    while pending:
        try:
            with os.scandir(pending.pop()) as entries:
                children = sorted(entries, key=lambda item: item.name)
            for entry in children:
                relative = Path(entry.path).relative_to(root).as_posix()
                if entry.name == "__pycache__" or (exclude_tests and entry.name == "tests"):
                    continue
                if entry.is_symlink():
                    refuse("SOURCE_SYMLINK", relative)
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                elif entry.name.endswith(".py"):
                    checked_path(root, relative)
                    result.add(relative)
        except OSError as exc:
            refuse("INVENTORY_UNREADABLE", f"{source_dir} ({type(exc).__name__})")
    return result


def alpha_inventory(root: Path) -> set[str]:
    return {"profiles/alpha/dispatch.py"} | python_inventory(root, ALPHA_SRC, exclude_tests=True)


def legacy_inventory(root: Path) -> set[str]:
    # Required paths remain in scope even when absent from disk or the manifest.
    # The scan also exposes newly added modules, including nested ones.
    return LEGACY_MODULES | {LEGACY_CLI} | python_inventory(root, LEGACY_SRC, exclude_tests=False)


def exact_keys(value: object, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        refuse("BUDGET_MALFORMED", f"{label}: expected fields {sorted(expected)}")


def counts(value: object, expected: set[str], label: str) -> None:
    exact_keys(value, expected, label)
    if any(type(number) is not int or number < 0 for number in value.values()):
        refuse("BUDGET_MALFORMED", f"{label}: counts must be nonnegative integers")


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            refuse("BUDGET_MALFORMED", f"duplicate JSON field {key!r}")
        value[key] = item
    return value


def load_budget(root: Path, relative: str) -> dict:
    try:
        budget = json.loads(read_source(root, relative), object_pairs_hook=unique_object)
    except (UnicodeError, json.JSONDecodeError) as exc:
        refuse("BUDGET_MALFORMED", type(exc).__name__)
    exact_keys(budget, {"schema", "baseline_source_head", "scope", "files", "totals"}, "manifest")
    if (budget["schema"] != SCHEMA or budget["scope"] != SCOPE
            or not isinstance(budget["baseline_source_head"], str)
            or not re.fullmatch(r"[0-9a-f]{40}", budget["baseline_source_head"])):
        refuse("BUDGET_MALFORMED", "schema, scope or baseline source HEAD is invalid")
    files = budget["files"]
    if not isinstance(files, dict) or not files:
        refuse("BUDGET_MALFORMED", "files must be a nonempty path-to-budget dictionary")
    for path, entry in files.items():
        parts = PurePosixPath(path).parts
        if (not path.endswith(".py") or not parts or path != "/".join(parts)
                or PurePosixPath(path).is_absolute() or ".." in parts or "\\" in path
                or any(ord(char) < 32 for char in path)):
            refuse("BUDGET_MALFORMED", f"invalid source path {path!r}")
        exact_keys(entry, {"baseline", "limit"}, path)
        for field in ("baseline", "limit"):
            counts(entry[field], METRICS, path + ":" + field)
        if any(entry["baseline"][metric] > entry["limit"][metric] for metric in METRICS):
            refuse("BUDGET_MALFORMED", f"{path}: baseline exceeds limit")
    totals = budget["totals"]
    exact_keys(totals, {"baseline", "limit"}, "totals")
    for field in ("baseline", "limit"):
        counts(totals[field], METRICS | {"files"}, "totals:" + field)
    expected = {metric: sum(entry["baseline"][metric] for entry in files.values()) for metric in METRICS}
    expected["files"] = len(files)
    if totals["baseline"] != expected:
        refuse("BUDGET_MALFORMED", "baseline totals do not equal the listed file counts")
    if any(expected[metric] > totals["limit"][metric] for metric in expected):
        refuse("BUDGET_MALFORMED", "baseline totals exceed limit")
    return budget


def measure(data: bytes) -> dict[str, int]:
    return {"bytes": len(data),
            "physical_lines": data.count(b"\n") + int(bool(data) and not data.endswith(b"\n"))}


def inspect_budget(root: Path, budget_path: str = BUDGET) -> dict:
    report = {"status": "FAIL", "errors": [], "files": {}, "totals": {}, "limits": LIMITS}
    root = Path(root).absolute()
    try:
        if root.is_symlink():
            refuse("SOURCE_SYMLINK", str(root))
        budget = load_budget(root, budget_path)
        report["baseline_source_head"] = budget["baseline_source_head"]
        report["scope"] = SCOPE
        actual = cold_inventory(root) | alpha_inventory(root) | legacy_inventory(root) | {STANDALONE_FREEZE}
        expected = set(budget["files"])
        for path in sorted(actual - expected):
            report["errors"].append("SOURCE_UNLISTED: " + path)
        for path in sorted(expected - actual):
            report["errors"].append("INVENTORY_DRIFT: reviewed source no longer in scope: " + path)
        for path in sorted(actual | expected):
            data = read_source(root, path)
            size = measure(data)
            report["files"][path] = {**size, "sha256": hashlib.sha256(data).hexdigest()}
            if path in expected:
                for metric, limit in budget["files"][path]["limit"].items():
                    if size[metric] > limit:
                        report["errors"].append(f"SOURCE_BUDGET_EXCEEDED: {path}: {metric} {size[metric]} > {limit}")
        totals = {metric: sum(entry[metric] for entry in report["files"].values()) for metric in METRICS}
        totals["files"] = len(report["files"])
        report["totals"] = totals
        for metric, limit in budget["totals"]["limit"].items():
            if totals[metric] > limit:
                report["errors"].append(f"TOTAL_BUDGET_EXCEEDED: {metric} {totals[metric]} > {limit}")
    except Refusal as exc:
        report["errors"].append(str(exc))
    report["status"] = "FAIL" if report["errors"] else "PASS"
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--budget", default=BUDGET, help="reviewed manifest path relative to --root")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if PurePosixPath(args.budget).is_absolute() or ".." in PurePosixPath(args.budget).parts:
        parser.error("--budget must be a relative path inside --root")
    report = inspect_budget(args.root, args.budget)
    if args.json:
        print(json.dumps(report, sort_keys=True, indent=2))
    else:
        print("COLD SOURCE BUDGET: " + report["status"])
        print("Measured: " + json.dumps(report["totals"], sort_keys=True))
        print(report["limits"])
        for error in report["errors"]:
            print("FAIL: " + error)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
