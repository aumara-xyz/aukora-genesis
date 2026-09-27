#!/usr/bin/env python3
"""Focused disposable-tree controls for the static boundary regression policy.

Run: python3 -B tests/continuity-spine/test_boundary.py
No fixture executes imported source or starts a proposal process.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from boundary import COLD_ROOTS, ROOT, inspect_boundary


class BoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scratch = tempfile.TemporaryDirectory(prefix="diamond-boundary-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        shutil.copytree(ROOT / "diamond", self.root / "diamond",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        for name in ("SECURITY.md", "CONTINUITY-SPINE.md", "STAGE0-CONSUMER-READINESS.md",
                     "CEILINGS.md",
                     "scripts/verify-kira-evidence.py", "vendor/phase0/verify.py"):
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)

    def append(self, source: str, module: str = "diamond/cold_verify.py") -> None:
        path = self.root / module
        path.write_text(path.read_text(encoding="utf-8") + "\n" + source + "\n", encoding="utf-8")

    def rejected(self, expected: str) -> dict:
        report = inspect_boundary(self.root)
        self.assertEqual(report["status"], "FAIL", report)
        self.assertIn(expected, "\n".join(report["errors"]))
        return report

    def test_current_tree_passes_and_keeps_legacy_distinct(self):
        report = inspect_boundary(self.root)
        self.assertEqual(report["status"], "PASS", report["errors"])
        self.assertTrue(set(COLD_ROOTS).issubset(report["cold_closure"]))
        self.assertIn("diamond.ed25519", report["cold_closure"])
        self.assertIn("diamond.loader", report["existing_legacy_surface"])
        self.assertIn("diamond.grant", report["existing_legacy_surface"])
        self.assertIn("diamond.demo", report["existing_legacy_surface"])
        self.assertNotIn("diamond.loader", report["cold_closure"])
        self.assertIn("not a sandbox", report["limits"])
        self.assertIn("signing primitives", report["limits"])

    def test_cli_positive_and_negative_exit_status(self):
        command = [sys.executable, "-B", str(Path(__file__).with_name("boundary.py")),
                   "--root", str(self.root)]
        positive = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(positive.returncode, 0, positive.stdout + positive.stderr)
        self.assertIn("CONTINUITY BOUNDARY: PASS", positive.stdout)
        self.append("import broker as hidden")
        negative = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(negative.returncode, 1, negative.stdout + negative.stderr)
        self.assertIn("forbidden runtime import", negative.stdout)

    def test_forbidden_import_forms(self):
        path = self.root / "diamond/cold_verify.py"
        original = path.read_text()
        variants = (
            "import aukora_deep", "import aukora_deep as hidden",
            "from aukora_deep import cell as hidden",
            "import aukora_deep.proposal.cell as hidden",
            "from aukora_deep.proposal import cell",
            "from broker import run as ordinary", "import issuer.runtime as ordinary",
            "import seatbelt", "import electron as ui", "from diamond import broker as hidden",
            "from . import broker as hidden", "from .broker import run",
        )
        for source in variants:
            with self.subTest(source=source):
                path.write_text(original + "\n" + source + "\n")
                self.rejected("forbidden runtime import")

    def test_closed_allowlist_refuses_unknown_stdlib_dependency(self):
        self.append("import socket as transport")
        self.rejected("import outside cold allowlist: socket")

    def test_closed_allowlist_refuses_submodule_of_allowed_module(self):
        self.append("import json.tool as tool")
        self.rejected("import outside cold allowlist: json.tool")

    def test_from_import_cannot_add_submodule_of_allowed_module(self):
        for module in ("diamond/cold_verify.py", "diamond/hexutil.py"):
            path = self.root / module
            original = path.read_text()
            with self.subTest(module=module):
                self.append("from json import tool as undeclared_submodule", module)
                self.rejected("imported symbol outside cold allowlist: json.tool")
            path.write_text(original)

    def test_from_import_cannot_add_reexported_process_module(self):
        for module in ("diamond/cold_verify.py", "diamond/hexutil.py"):
            path = self.root / module
            original = path.read_text()
            with self.subTest(module=module):
                self.append("from pathlib import os as operating; operating.system('true')", module)
                self.rejected("imported symbol outside cold allowlist: pathlib.os")
            path.write_text(original)

    def test_explicitly_allowed_from_import_symbols_and_aliases_pass(self):
        self.append("from pathlib import Path as ReceiptPath")
        self.append("from hashlib import sha512 as digest", "diamond/ed25519.py")
        report = inspect_boundary(self.root)
        self.assertEqual(report["status"], "PASS", report["errors"])

    def test_from_import_permission_does_not_admit_bare_module_namespace(self):
        for module in ("diamond/cold_verify.py", "diamond/hexutil.py"):
            path = self.root / module
            original = path.read_text()
            with self.subTest(module=module):
                self.append("import pathlib; pathlib.os.system('true')", module)
                self.rejected("bare import outside cold allowlist: pathlib")
            path.write_text(original)

    def test_explicitly_allowed_bare_imports_and_aliases_pass(self):
        self.append("import sys as system_module")
        self.append("import json as documents", "diamond/hexutil.py")
        report = inspect_boundary(self.root)
        self.assertEqual(report["status"], "PASS", report["errors"])

    def test_each_named_cold_root_is_inspected(self):
        for module in COLD_ROOTS:
            path = self.root / (module.replace(".", "/") + ".py")
            original = path.read_text()
            with self.subTest(module=module):
                path.write_text(original + "\nimport broker as hidden\n")
                self.rejected("forbidden runtime import")
            path.write_text(original)

    def test_importing_existing_legacy_kernel_into_cold_closure_fails(self):
        for source in ("import diamond.loader as loader", "from diamond import grant as grant",
                       "from .demo import run_demo as harmless", "import diamond.receipt.newcell"):
            path = self.root / "diamond/cold_verify.py"
            original = path.read_text()
            with self.subTest(source=source):
                self.append(source)
                self.rejected("import outside cold allowlist")
            path.write_text(original)

    def test_relative_import_of_existing_cold_dependency_passes(self):
        self.append("from .receipt import verify_receipt as same_verifier")
        report = inspect_boundary(self.root)
        self.assertEqual(report["status"], "PASS", report["errors"])

    def test_shared_dependency_is_inspected(self):
        self.append("from issuer import mint", "diamond/ed25519.py")
        self.rejected("forbidden runtime import")

    def test_package_initializer_is_inspected(self):
        self.append("import diamond.loader", "diamond/__init__.py")
        self.rejected("import outside cold allowlist")

    def test_consumer_cli_is_inspected(self):
        self.append("import broker", "scripts/verify-kira-evidence.py")
        self.rejected("forbidden runtime import")

    def test_forbidden_executable_symbols_and_literals(self):
        path = self.root / "diamond/cold_verify.py"
        original = path.read_text()
        variants = (
            "def proposeMemoryPutInWasm(): pass",
            "proposeMemoryPutThroughCell = None",
            "result = host.spawnConfinedGuest()",
            "command = 'sandbox-exec'",
            "runtime = b'Electron'",
            "runtime = 'WasmProposalCell'",
        )
        for source in variants:
            with self.subTest(source=source):
                path.write_text(original + "\n" + source + "\n")
                self.rejected("forbidden executable boundary marker")

    def test_comments_and_docstrings_are_not_executable_markers(self):
        self.append('''# A comment about proposeMemoryPutInWasm and sandbox-exec.
def documentation_only():
    """Do not invoke spawnConfinedGuest, Electron, or wasmproposalcell."""
    return None
''')
        report = inspect_boundary(self.root)
        self.assertEqual(report["status"], "PASS", report["errors"])

    def test_forbidden_markers_in_legacy_code_still_fail(self):
        self.append("cell = 'wasmproposalcell'", "diamond/demo.py")
        self.rejected("forbidden executable boundary marker")

    def test_dynamic_import_and_evaluation_fail(self):
        path = self.root / "diamond/cold_verify.py"
        original = path.read_text()
        variants = (
            "runtime = __import__('broker')", "run = eval; run('1')",
            "exec('pass')", "program = compile('pass', '<string>', 'exec')",
            "import importlib as il; il.import_module('broker')",
            "loader.exec_module(module)", "getattr(__builtins__, 'eval')('1')",
        )
        for source in variants:
            with self.subTest(source=source):
                path.write_text(original + "\n" + source + "\n")
                self.rejected("dynamic import/evaluation is forbidden")

    def test_alpha_host_or_model_dependencies_are_refused(self):
        path = self.root / "diamond/cold_verify.py"
        original = path.read_text()
        for source in ("import aukora_spec_alpha", "import potion", "import onnxruntime",
                       "import gguf", "import llama_cpp", "from node import child_process",
                       "import torch", "import transformers", "command = ['node', 'bridge.js']",
                       "runner = 'node:child_process'", "def spawnSeatbeltGuest(): pass",
                       "model = 'small-model.gguf'"):
            with self.subTest(source=source):
                path.write_text(original + "\n" + source + "\n")
                self.rejected("forbidden")

    def test_ceiling_table_cannot_drop_or_promote_external_claim(self):
        path = self.root / "CEILINGS.md"
        original = path.read_text()
        for source in (
                original.replace("| `SAME_UID_WITNESS` | `MEASURED_ELSEWHERE` |",
                                 "| `SAME_UID_WITNESS` | `IN_DIAMOND_COLD` |"),
                original.replace("| `SEATBELT_DENYLIST` |", "| `MISSING` |"),
                *(original.replace("| `SAME_UID` |", extra + "\n| `SAME_UID` |")
                  for extra in (
                      "| `NEW-CEILING` | `IN_DIAMOND_COLD` | malformed name |",
                      "| `NEW_CEILING` | `in_diamond_cold` | malformed scope |",
                      "| `NEW_CEILING` | `IN_DIAMOND_COLD` | unknown name |",
                      "| SAME_UID | IN_DIAMOND_COLD | unquoted duplicate |"))):
            path.write_text(source)
            self.rejected("closed ceiling table names/scopes drifted")

    def test_subprocess_dependency_fails_outside_pinned_delegate(self):
        self.append("import subprocess as process")
        self.rejected("import outside cold allowlist: subprocess")

    def test_process_launch_through_allowed_os_module_fails(self):
        self.append("import os as operating; operating.system('true')", "diamond/hexutil.py")
        self.rejected("process launch is forbidden: os.system")

    def test_process_launch_alias_from_allowed_os_module_fails(self):
        self.append("from os import system as launch; launch('true')", "diamond/hexutil.py")
        self.rejected("process launch is forbidden: os.system")

    def test_subprocess_exception_caller_and_target_are_pinned(self):
        for relative in ("diamond/verify_pair.py", "vendor/phase0/verify.py"):
            path = self.root / relative
            original = path.read_text()
            with self.subTest(path=relative):
                path.write_text(original + "\n# changed pinned bytes\n")
                self.rejected("Phase 0 subprocess exception digest mismatch")
            path.write_text(original)

    def test_new_runtime_file_fails_even_when_never_imported(self):
        for relative in ("diamond/proposer.py", "diamond/nested/proposer.py", "diamond/proposer.wasm"):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            with self.subTest(path=relative):
                path.write_text("# unused proposal runtime\n")
                self.rejected("undeclared runtime file")
            path.unlink()

    def test_missing_runtime_dependency_fails(self):
        (self.root / "diamond/ed25519.py").unlink()
        self.rejected("required runtime file missing")

    def test_malformed_python_fails_without_executing_it(self):
        self.append("def broken(")
        self.rejected("malformed Python")

    def test_wildcard_import_fails(self):
        self.append("from diamond.receipt import *")
        self.rejected("wildcard import is not an explicit dependency")

    def test_missing_required_policy_files_fail(self):
        for name in ("SECURITY.md", "CONTINUITY-SPINE.md", "STAGE0-CONSUMER-READINESS.md", "CEILINGS.md"):
            path = self.root / name
            original = path.read_bytes()
            with self.subTest(path=name):
                path.unlink()
                self.rejected(name + ": required file unreadable")
            path.write_bytes(original)

    def test_proposer_prohibition_must_stay_in_forbidden_claims(self):
        path = self.root / "SECURITY.md"
        source = path.read_text()
        path.write_text(source.replace("Diamond as a proposer", "A different claim") +
                        "\n## Permitted proposals\nDiamond as a proposer\n")
        self.rejected("Forbidden claims must retain Diamond as a proposer")

    def test_stage0_must_distinguish_verifier_packaging_from_proposal_cell(self):
        path = self.root / "STAGE0-CONSUMER-READINESS.md"
        path.write_text(path.read_text().replace("DISTINCT", "IDENTICAL"))
        self.rejected("cold-verify packaging must remain distinct")

    def test_empty_continuity_document_fails(self):
        (self.root / "CONTINUITY-SPINE.md").write_text("\n")
        self.rejected("required boundary document is empty")

    def test_source_symlink_fails_closed(self):
        path = self.root / "diamond/cold_verify.py"
        source = self.root / "outside.py"
        path.rename(source)
        path.symlink_to(source)
        self.rejected("symlink outside the declared source policy")


if __name__ == "__main__":
    unittest.main(verbosity=2)
