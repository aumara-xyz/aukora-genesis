#!/usr/bin/env python3
"""Static regression policy for Diamond's cold-verifier dependency boundary.

This is not a sandbox or a proof against malicious Python. It checks source ASTs,
declared imports, a closed Diamond package inventory, and required policy text.
It does not execute imports, resolve arbitrary reflection/computed strings, inspect
the installed interpreter or dependencies, or prove what runs in another process.
Comments and actual docstrings are excluded from executable-marker checks.

The existing loader/grant/demo kernel remains a separate surface. Shared receipt,
checkpoint and Ed25519 modules include signing helpers; this court does not claim
that Diamond has no signing primitives or contains only a verifier.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SOURCE_PIN = "6021f65cac17b962bbb1b0736eea0290566ae85c"
COLD_ROOTS = (
    "diamond.cold_verify", "diamond.kira_evidence",
    "diamond.approval_artifact", "diamond.aumlok_approval",
)
# Every import target is exact, including submodules. Aliases do not change it.
# A new dependency requires a policy change and review, even if it is stdlib.
IMPORTS = {
    "diamond.__init__": set(),
    "diamond.cold_verify": {
        "__future__", "argparse", "sys", "pathlib", "diamond.hexutil", "diamond.receipt"},
    "diamond.kira_evidence": {
        "__future__", "binascii", "hashlib", "json", "re", "pathlib"},
    "diamond.approval_artifact": {
        "__future__", "hashlib", "json", "re", "typing", "argparse", "sys", "pathlib",
        "diamond.kira_evidence", "diamond.ed25519"},
    "diamond.aumlok_approval": {
        "__future__", "hashlib", "json", "re", "typing", "argparse", "sys", "pathlib",
        "diamond.jcs", "diamond.ed25519", "diamond.hexutil"},
    "diamond.receipt": {
        "__future__", "argparse", "sys", "pathlib", "diamond.ed25519",
        "diamond.hexutil", "diamond.jcs", "diamond.refuse_codes"},
    "diamond.ed25519": {"__future__", "hashlib", "secrets"},
    "diamond.hexutil": {"__future__", "hashlib", "json", "os", "pathlib", "typing"},
    "diamond.jcs": {"__future__", "typing"},
    "diamond.refuse_codes": {"__future__"},
    "diamond.checkpoint": {
        "__future__", "typing", "diamond.ed25519", "diamond.hexutil", "diamond.jcs"},
    "diamond.verify_pair": {
        "__future__", "argparse", "json", "subprocess", "sys", "tempfile", "pathlib",
        "diamond.checkpoint", "diamond.hexutil"},
    "scripts.verify-kira-evidence": {
        "__future__", "argparse", "json", "sys", "pathlib", "hashlib",
        "diamond.kira_evidence", "diamond.approval_artifact", "diamond.aumlok_approval"},
    "vendor.phase0.verify": {
        "__future__", "argparse", "hashlib", "json", "sys", "pathlib", "typing"},
}
# Importing one symbol does not admit a bare module namespace, whose other
# exports could widen the boundary (e.g. pathlib.os). These are the actual bare
# imports in the inspected source; aliases preserve the canonical module name.
BARE_IMPORTS = {
    "diamond.__init__": set(),
    "diamond.cold_verify": {"argparse", "sys"},
    "diamond.kira_evidence": {"binascii", "hashlib", "json", "re"},
    "diamond.approval_artifact": {"argparse", "hashlib", "json", "re", "sys"},
    "diamond.aumlok_approval": {"argparse", "hashlib", "json", "re", "sys"},
    "diamond.receipt": {"argparse", "sys"},
    "diamond.ed25519": set(),
    "diamond.hexutil": {"hashlib", "json", "os"},
    "diamond.jcs": set(),
    "diamond.refuse_codes": set(),
    "diamond.checkpoint": set(),
    "diamond.verify_pair": {"argparse", "json", "subprocess", "sys", "tempfile"},
    "scripts.verify-kira-evidence": {"argparse", "hashlib", "json", "sys"},
    "vendor.phase0.verify": {"argparse", "hashlib", "json", "sys"},
}
# A permitted module does not permit every member or re-export it contains.
# Keep the imported symbols closed as well: e.g. pathlib.Path never admits
# pathlib.os, and permitting json does not admit `from json import tool`.
FROM_IMPORTS = {
    "diamond.__init__": set(),
    "diamond.cold_verify": {
        "__future__.annotations", "pathlib.Path", "diamond.hexutil.read_json",
        "diamond.receipt.ReceiptError", "diamond.receipt.composition_base_for",
        "diamond.receipt.verify_receipt"},
    "diamond.kira_evidence": {"__future__.annotations", "pathlib.Path"},
    "diamond.approval_artifact": {
        "__future__.annotations", "pathlib.Path", "typing.Any", "typing.Optional",
        "diamond.ed25519.verify", "diamond.kira_evidence.Refusal",
        "diamond.kira_evidence.compute_record_id", "diamond.kira_evidence.jcs_bytes",
        "diamond.kira_evidence.public_key_hex", "diamond.kira_evidence.raw_public_key_bytes"},
    "diamond.aumlok_approval": {
        "__future__.annotations", "pathlib.Path", "typing.Any", "typing.Optional",
        "diamond.ed25519.verify", "diamond.hexutil.from_hex", "diamond.jcs.canonicalize_bytes"},
    "diamond.receipt": {
        "__future__.annotations", "pathlib.Path", "diamond.ed25519.sign", "diamond.ed25519.verify",
        "diamond.hexutil.from_hex", "diamond.hexutil.read_json", "diamond.hexutil.require_hex",
        "diamond.hexutil.to_hex", "diamond.hexutil.write_json", "diamond.jcs.canonicalize_bytes",
        "diamond.refuse_codes.COMPOSITION_BASE_UNKNOWN"},
    "diamond.ed25519": {"__future__.annotations", "hashlib.sha512", "secrets.token_bytes"},
    "diamond.hexutil": {"__future__.annotations", "pathlib.Path", "typing.Any"},
    "diamond.jcs": {"__future__.annotations", "typing.Any"},
    "diamond.refuse_codes": {"__future__.annotations"},
    "diamond.checkpoint": {
        "__future__.annotations", "typing.Any", "diamond.ed25519.sign", "diamond.ed25519.verify",
        "diamond.hexutil.from_hex", "diamond.hexutil.require_hex", "diamond.hexutil.to_hex",
        "diamond.jcs.canonicalize_bytes"},
    "diamond.verify_pair": {
        "__future__.annotations", "pathlib.Path", "diamond.checkpoint.CheckpointError",
        "diamond.checkpoint.verify_checkpoint", "diamond.hexutil.read_json"},
    "scripts.verify-kira-evidence": {
        "__future__.annotations", "pathlib.Path", "diamond.kira_evidence",
        "diamond.approval_artifact.artifact_summary", "diamond.approval_artifact.verify_artifact",
        "diamond.aumlok_approval.approval_summary", "diamond.aumlok_approval.verify_approval"},
    "vendor.phase0.verify": {"__future__.annotations", "pathlib.Path", "typing.Iterable"},
}
DIAMOND_MODULES = frozenset({
    "__init__", "__main__", "approval_artifact", "aumlok_approval", "aura",
    "checkpoint", "cold_verify", "composition", "court", "demo", "ed25519",
    "grant", "hexutil", "jcs", "kira_evidence", "loader", "lock", "mediator",
    "patent_license", "receipt", "refuse_codes", "retain_handoff", "roles",
    "settlement", "simulated_device", "subject", "verify_pair",
})
EXPECTED_FILES = frozenset("diamond/" + name + ".py" for name in DIAMOND_MODULES)
LEGACY_SURFACE = tuple(sorted(
    "diamond." + name for name in DIAMOND_MODULES
    if "diamond." + name not in IMPORTS
))
# The only process-launch exception in the inspected verifier closure. Both the
# caller and its target are pinned, so widening the delegation fails the court.
DELEGATE_PINS = {
    "diamond/verify_pair.py": "38197bb5db5882e9b8a8d2b4b2142fcd81c6ce415e0242625ddf131e6326b45e",
    "vendor/phase0/verify.py": "aa4357ebffa10a7dc550fd11824e4edd54197c8292748f16145f7b5510a01136",
}
FORBIDDEN_MARKERS = (
    "proposememoryputinwasm", "proposememoryputthroughcell", "spawnconfinedguest",
    "sandboxexec", "electron", "wasmproposalcell",
    "spawnseatbeltguest", "seatbeltprofile", "childprocess", "potion",
    "onnx", "gguf", "llamacpp",
)
FORBIDDEN_IMPORT_PARTS = {
    "deep", "aukoradeep", "seatbelt", "broker", "issuer", "electron", "wasmproposalcell",
    "aukoraspecalpha", "potion", "onnx", "onnxruntime", "gguf", "llamacpp",
    "node", "childprocess", "transformers", "torch",
}
CEILING_SCOPES = {
    "SAME_UID": "IN_DIAMOND_COLD", "SAME_UID_HOST": "IN_DIAMOND_COLD",
    "PYTHON_RUNTIME_TCB": "IN_DIAMOND_COLD", "KERNEL_TRUSTED": "IN_DIAMOND_COLD",
    "OPERATOR_IDENTITY_NOT_STRONGLY_AUTHENTICATED": "IN_DIAMOND_COLD",
    "POWER_LOSS_DURABILITY_UNMEASURED": "IN_DIAMOND_COLD",
    "HOST_CLOCK_TRUSTED_FOR_EXPIRY": "IN_DIAMOND_COLD", "CELL_EXECUTION": "IN_DIAMOND_COLD",
    "SAME_UID_WITNESS": "MEASURED_ELSEWHERE", "SEATBELT_DENYLIST": "MEASURED_ELSEWHERE",
    "SINGLE_HOST_SIGNING_AUTHORITY": "MEASURED_ELSEWHERE",
    "RESTART_PERSISTENT_NOT_ANTI_ROLLBACK": "NOT_CLAIMED",
}
DYNAMIC_SYMBOLS = {
    "__import__", "eval", "exec", "compile", "import_module", "exec_module",
    "load_module", "SourceFileLoader", "SourcelessFileLoader",
}
PROCESS_MEMBERS = {"system", "popen", "fork", "forkpty", "posix_spawn", "posix_spawnp"}


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def module_path(module: str) -> str:
    return module.replace(".", "/") + ".py"


def import_base(node: ast.ImportFrom, module: str) -> str:
    """Resolve a from-import's absolute base without importing inspected code."""
    base = node.module or ""
    if node.level:
        parents = module.split(".")[:-1]
        if node.level > len(parents):
            return "<invalid-relative-import>"
        base = ".".join(parents[:len(parents) - node.level + 1] + ([base] if base else []))
    return base


def import_targets(node: ast.AST, module: str) -> list[str]:
    """Resolve import syntax without importing or executing the inspected tree."""
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]
    if not isinstance(node, ast.ImportFrom):
        return []
    base = import_base(node, module)
    if base == "diamond":
        return [base + "." + alias.name for alias in node.names]
    return [base]


def executable_nodes(tree: ast.AST) -> list[ast.AST]:
    """Exclude only actual docstrings; assigned/runtime strings remain code."""
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.body and isinstance(node.body[0], ast.Expr):
                value = node.body[0].value
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    docstrings.add(id(value))
    return [node for node in ast.walk(tree) if id(node) not in docstrings]


def inspect_boundary(root: Path) -> dict[str, Any]:
    """Return a fail-closed report; inspected source is never executed."""
    root = Path(root)
    errors = []
    trees = {}
    file_hashes = {}

    def refuse(path: str, reason: str, node: Any = None) -> None:
        line = getattr(node, "lineno", None)
        errors.append(f"{path}{':' + str(line) if line else ''}: {reason}")

    def read(path: str) -> Any:
        target = root / path
        if target.is_symlink():
            refuse(path, "symlink outside the declared source policy")
            return None
        try:
            data = target.read_bytes()
            file_hashes[path] = hashlib.sha256(data).hexdigest()
            return data.decode("utf-8")
        except (OSError, UnicodeError) as exc:
            refuse(path, f"required file unreadable ({type(exc).__name__})")
            return None

    # The whole Diamond package is inventoried, including non-Python runtime
    # additions. Generated bytecode and Finder metadata are not source modules.
    package = root / "diamond"
    actual = set()
    if package.is_symlink():
        refuse("diamond", "package directory must not be a symlink")
    try:
        for path in package.rglob("*"):
            relative = path.relative_to(root)
            if "__pycache__" in relative.parts or path.name == ".DS_Store":
                continue
            if path.is_file() or path.is_symlink():
                actual.add(relative.as_posix())
    except OSError as exc:
        refuse("diamond", f"runtime inventory unreadable ({type(exc).__name__})")
    for path in sorted(actual - EXPECTED_FILES):
        refuse(path, "undeclared runtime file")
    for path in sorted(EXPECTED_FILES - actual):
        refuse(path, "required runtime file missing")

    paths = EXPECTED_FILES | {module_path(name) for name in IMPORTS}
    for path in sorted(paths):
        source = read(path)
        if source is None:
            continue
        try:
            trees[path] = ast.parse(source, filename=path)
        except (SyntaxError, ValueError) as exc:
            refuse(path, f"malformed Python ({type(exc).__name__})")

    for path, expected in DELEGATE_PINS.items():
        if file_hashes.get(path) != expected:
            refuse(path, "Phase 0 subprocess exception digest mismatch")

    dependencies = {}
    for path, tree in trees.items():
        module = path[:-3].replace("/", ".")
        strict = module in IMPORTS
        targets = set()
        aliases = {}
        nodes = executable_nodes(tree)
        for node in nodes:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                imported = import_targets(node, module)
                targets.update(imported)
                if isinstance(node, ast.ImportFrom) and any(a.name == "*" for a in node.names):
                    refuse(path, "wildcard import is not an explicit dependency", node)
                for target in imported:
                    if strict and target not in IMPORTS[module]:
                        refuse(path, f"import outside cold allowlist: {target}", node)
                    if any(normalized(part) in FORBIDDEN_IMPORT_PARTS for part in target.split(".")):
                        refuse(path, f"forbidden runtime import: {target}", node)
                for alias in node.names:
                    if isinstance(node, ast.Import):
                        aliases[alias.asname or alias.name.split(".")[0]] = alias.name
                        if strict and alias.name not in BARE_IMPORTS.get(module, set()):
                            refuse(path, f"bare import outside cold allowlist: {alias.name}", node)
                    else:
                        base = import_base(node, module)
                        qualified = base + "." + alias.name
                        aliases[alias.asname or alias.name] = qualified
                        if strict and qualified not in FROM_IMPORTS.get(module, set()):
                            refuse(path, f"imported symbol outside cold allowlist: {qualified}", node)
                        if strict and base == "os" and (
                                alias.name in PROCESS_MEMBERS or alias.name.startswith(("spawn", "exec"))):
                            refuse(path, f"process launch is forbidden: os.{alias.name}", node)

        for node in nodes:
            values = []
            if isinstance(node, ast.Name):
                values.append(node.id)
            elif isinstance(node, ast.Attribute):
                values.append(node.attr)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                values.append(node.name)
            elif isinstance(node, ast.arg):
                values.append(node.arg)
            elif isinstance(node, ast.alias):
                values.extend([node.name, node.asname or ""])
            elif isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)):
                values.append(node.value.decode("utf-8", "replace") if isinstance(node.value, bytes) else node.value)
                if values[-1] in ("node", "nodejs", "sandbox-exec"):
                    refuse(path, "forbidden runtime command literal", node)
            for value in values:
                if any(marker in normalized(value) for marker in FORBIDDEN_MARKERS):
                    refuse(path, "forbidden executable boundary marker", node)
                # Regex compilation is existing verifier data validation, not
                # Python bytecode evaluation. No generic '.compile' exception.
                regex_compile = (isinstance(node, ast.Attribute) and node.attr == "compile"
                                 and isinstance(node.value, ast.Name)
                                 and aliases.get(node.value.id) == "re")
                if strict and value in DYNAMIC_SYMBOLS and not regex_compile:
                    refuse(path, f"dynamic import/evaluation is forbidden: {value}", node)
            if strict:
                qualified = None
                if isinstance(node, ast.Name):
                    qualified = aliases.get(node.id, node.id)
                elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                    qualified = aliases.get(node.value.id, node.value.id) + "." + node.attr
                if qualified:
                    base, _, member = qualified.rpartition(".")
                    if base == "os" and (member in PROCESS_MEMBERS or member.startswith(("spawn", "exec"))):
                        refuse(path, f"process launch is forbidden: {qualified}", node)
        dependencies[module] = sorted(targets)

    # Follow observed local imports from the named entry points. Each reachable
    # module must be listed and parsed; no missing source can silently disappear.
    closure = set()
    pending = list(COLD_ROOTS) + ["diamond.__init__", "diamond.verify_pair",
                                 "scripts.verify-kira-evidence", "vendor.phase0.verify"]
    while pending:
        module = pending.pop()
        if module in closure:
            continue
        closure.add(module)
        if module not in IMPORTS or module_path(module) not in trees:
            refuse(module_path(module), "unresolved or undeclared cold dependency")
            continue
        pending.extend(target for target in dependencies.get(module, []) if target.startswith("diamond."))

    documents = {name: read(name) for name in (
        "SECURITY.md", "CONTINUITY-SPINE.md", "STAGE0-CONSUMER-READINESS.md", "CEILINGS.md")}
    ceilings = documents["CEILINGS.md"]
    if ceilings is not None:
        section = re.search(r"^## Cold honesty contract absorbed from Spec Alpha\s*$(.*?)(?=^## |\Z)",
                            ceilings, re.M | re.S)
        table = re.search(r"^\| Ceiling \| Scope \| Meaning / evidence \|\n"
                          r"\| --- \| --- \| --- \|\n([^\n]+(?:\n[^\n]+)*)",
                          section.group(1), re.M) if section else None
        rows = []
        malformed = table is None
        if table:
            # Parse every row, rather than selecting only already-valid names.
            # A malformed extra row must fail just like an unknown valid row.
            for line in table.group(1).splitlines():
                row = re.fullmatch(r"\| `([A-Z_]+)` \| `([A-Z_]+)` \| [^|]+ \|", line)
                if row is None:
                    malformed = True
                else:
                    rows.append(row.groups())
        if malformed or len(rows) != len(CEILING_SCOPES) or dict(rows) != CEILING_SCOPES:
            refuse("CEILINGS.md", "closed ceiling table names/scopes drifted")
    security = documents["SECURITY.md"]
    if security is not None:
        forbidden = re.search(r"^## Forbidden claims\s*$(.*?)(?=^## |\Z)", security, re.M | re.S)
        if not forbidden or not re.search(r"Diamond as a proposer", forbidden.group(1), re.I):
            refuse("SECURITY.md", "Forbidden claims must retain Diamond as a proposer")
    stage0 = documents["STAGE0-CONSUMER-READINESS.md"]
    if stage0 is not None:
        compact = " ".join(stage0.lower().replace("*", "").split())
        required = ("cold-verify closure", "distinct from aukora-deep", "proposal cell", "copy of a verifier")
        if not all(phrase in compact for phrase in required):
            refuse("STAGE0-CONSUMER-READINESS.md", "cold-verify packaging must remain distinct from the proposal cell")
    continuity = documents["CONTINUITY-SPINE.md"]
    if continuity is not None and not continuity.strip():
        refuse("CONTINUITY-SPINE.md", "required boundary document is empty")

    return {
        "status": "FAIL" if errors else "PASS",
        "errors": sorted(set(errors)),
        "policy_source_pin": SOURCE_PIN,
        "cold_closure": sorted(closure),
        "existing_legacy_surface": list(LEGACY_SURFACE),
        "measured_file_sha256": dict(sorted(file_hashes.items())),
        "limits": "Static regression policy, not a sandbox or malicious-code proof; shared signing primitives and the legacy demo/kernel remain.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = inspect_boundary(args.root)
    if args.json:
        print(json.dumps(report, sort_keys=True, indent=2))
    else:
        print("CONTINUITY BOUNDARY: " + report["status"])
        print("Cold closure: " + ", ".join(report["cold_closure"]))
        print("Existing legacy surface: " + ", ".join(report["existing_legacy_surface"]))
        print(report["limits"])
        for error in report["errors"]:
            print("FAIL: " + error)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
