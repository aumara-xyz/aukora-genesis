#!/usr/bin/env python3
"""Synthetic, disposable source trees exercise the source-size review gate.

Run: python3 -B tests/cold-budget/test_cold_budget.py
"""
from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


CHECKER = Path(__file__).resolve().parents[2] / "scripts/check-cold-budget.py"
SPEC = importlib.util.spec_from_file_location("cold_budget", CHECKER)
budget = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(budget)


class ColdBudgetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="diamond-cold-budget-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.paths = ("diamond/cold.py", "profiles/alpha/dispatch.py", "profiles/alpha/src/core.py",
                      "scripts/verify-alpha-freeze.py", "profiles/alpha/legacy/keychain.py",
                      "profiles/alpha/legacy/witness.py", "profiles/alpha/legacy/receipt.py",
                      "scripts/verify-alpha-legacy.py")
        for number, path in enumerate(self.paths, 1):
            self.write(path, f"x = {number}\n")
        self.write(budget.BOUNDARY, "IMPORTS = {'diamond.cold': set()}\n")
        self.manifest = {
            "schema": budget.SCHEMA,
            "baseline_source_head": "0" * 40,
            "scope": copy.deepcopy(budget.SCOPE),
            "files": {path: {"baseline": {"bytes": 6, "physical_lines": 1},
                              "limit": {"bytes": 6, "physical_lines": 1}} for path in self.paths},
            "totals": {"baseline": {"files": 8, "bytes": 48, "physical_lines": 8},
                       "limit": {"files": 8, "bytes": 48, "physical_lines": 8}},
        }
        self.save_manifest()

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def save_manifest(self):
        self.write(budget.BUDGET, json.dumps(self.manifest))

    def rejected(self, code):
        report = budget.inspect_budget(self.root)
        self.assertEqual(report["status"], "FAIL", report)
        self.assertIn(code, "\n".join(report["errors"]))
        return report

    def test_exact_baseline_passes_without_changing_manifest(self):
        before = (self.root / budget.BUDGET).read_bytes()
        report = budget.inspect_budget(self.root)
        self.assertEqual(report["status"], "PASS", report)
        self.assertEqual(report["totals"], {"files": 8, "bytes": 48, "physical_lines": 8})
        self.assertEqual(set(report["files"]), set(self.paths))
        self.assertEqual(before, (self.root / budget.BUDGET).read_bytes())
        self.assertIn("not confinement or a security proof", report["limits"])

    def test_smaller_sources_pass_without_updating_baseline(self):
        self.write(self.paths[0], "x=1\n")
        self.assertEqual(budget.inspect_budget(self.root)["status"], "PASS")

    def test_physical_lines_count_blank_comments_and_unterminated_line(self):
        for data, expected in ((b"", 0), (b"\n", 1), (b"# c\n\nlast", 3),
                               (b"one\r\ntwo\r\n", 2), (b"x", 1)):
            with self.subTest(data=data):
                self.assertEqual(budget.measure(data), {"bytes": len(data), "physical_lines": expected})

    def test_each_source_group_rejects_byte_growth(self):
        for path in self.paths:
            with self.subTest(path=path):
                self.write(path, "x = 12\n")
                self.rejected("SOURCE_BUDGET_EXCEEDED: " + path + ": bytes 7 > 6")
                self.write(path, "x = 1\n")

    def test_lines_have_their_own_limit(self):
        self.write(self.paths[0], "x=1\n\n\n")
        report = self.rejected("physical_lines 3 > 1")
        self.assertFalse(any(": bytes " in error for error in report["errors"]))

    def test_per_file_gate_cannot_be_hidden_by_another_file_shrinking(self):
        self.write(self.paths[0], "x = 12\n")
        self.write(self.paths[1], "x=2\n")
        report = self.rejected("SOURCE_BUDGET_EXCEEDED")
        self.assertFalse(any("TOTAL_BUDGET_EXCEEDED" in error for error in report["errors"]))

    def test_aggregate_gate_is_independent_of_per_file_gate(self):
        self.manifest["files"][self.paths[0]]["limit"]["bytes"] = 10
        self.save_manifest()
        self.write(self.paths[0], "x = 12\n")
        report = self.rejected("TOTAL_BUDGET_EXCEEDED: bytes 49 > 48")
        self.assertFalse(any("SOURCE_BUDGET_EXCEEDED" in error for error in report["errors"]))

    def test_new_alpha_production_module_is_unlisted_even_when_empty(self):
        self.write("profiles/alpha/src/new_package/module.py", "")
        self.rejected("SOURCE_UNLISTED: profiles/alpha/src/new_package/module.py")

    def test_additional_legacy_modules_cannot_hide_outside_inventory(self):
        for path in ("profiles/alpha/legacy/extra.py", "profiles/alpha/legacy/nested/extra.py",
                     "profiles/alpha/legacy/tests/extra.py"):
            with self.subTest(path=path):
                self.write(path, "")
                self.rejected("SOURCE_UNLISTED: " + path)
                (self.root / path).unlink()

    def test_legacy_directory_symlink_refuses(self):
        directory = self.root / "profiles/alpha/legacy"
        original = self.root / "original-legacy"
        directory.rename(original)
        directory.symlink_to(original, target_is_directory=True)
        self.rejected("SOURCE_SYMLINK: profiles/alpha/legacy")

    def test_only_named_test_directories_and_bytecode_are_excluded(self):
        self.write("profiles/alpha/src/receipt_v3/tests/fixture.py", "excluded\n" * 20)
        self.write("profiles/alpha/src/__pycache__/generated.py", "excluded\n" * 20)
        self.assertEqual(budget.inspect_budget(self.root)["status"], "PASS")
        self.write("profiles/alpha/src/test_named_production.py", "")
        self.rejected("SOURCE_UNLISTED: profiles/alpha/src/test_named_production.py")

    def test_inventory_addition_and_removal_require_review(self):
        self.write("diamond/new.py", "")
        self.write(budget.BOUNDARY, "IMPORTS = {'diamond.cold': set(), 'diamond.new': {'sys'}}\n")
        self.rejected("SOURCE_UNLISTED: diamond/new.py")
        self.write(budget.BOUNDARY, "IMPORTS = {'diamond.new': set()}\n")
        self.rejected("INVENTORY_DRIFT: reviewed source no longer in scope: diamond/cold.py")

    def test_missing_source_or_inventory_or_budget_fails(self):
        for path in (*self.paths, budget.BOUNDARY, budget.BUDGET):
            with self.subTest(path=path):
                target = self.root / path
                original = target.read_bytes()
                target.unlink()
                self.rejected("SOURCE_MISSING_OR_UNREADABLE: " + path)
                target.write_bytes(original)

    def test_symlink_source_inventory_and_budget_fail(self):
        self.write("spare.py", "x = 1\n")
        for path in (*self.paths, budget.BOUNDARY, budget.BUDGET):
            with self.subTest(path=path):
                target = self.root / path
                original = target.read_bytes()
                target.unlink()
                target.symlink_to(self.root / "spare.py")
                self.rejected("SOURCE_SYMLINK: " + path)
                target.unlink()
                target.write_bytes(original)

    def test_symlink_directory_cannot_hide_new_alpha_modules(self):
        self.write("elsewhere/new.py", "")
        (self.root / "profiles/alpha/src/linked").symlink_to(self.root / "elsewhere", target_is_directory=True)
        self.rejected("SOURCE_SYMLINK: profiles/alpha/src/linked")

    def test_symlink_ancestor_of_a_declared_source_fails(self):
        package = self.root / "diamond"
        package.rename(self.root / "original-diamond")
        package.symlink_to(self.root / "original-diamond", target_is_directory=True)
        self.rejected("SOURCE_SYMLINK: diamond")

    def test_special_source_type_fails(self):
        path = self.root / self.paths[0]
        path.unlink()
        path.mkdir()
        self.rejected("SOURCE_TYPE: " + self.paths[0])

    def test_inventory_is_syntax_only_and_never_executed(self):
        self.write(budget.BOUNDARY, "raise RuntimeError('not executable inventory')\nIMPORTS = {'diamond.cold': set()}\n")
        self.assertEqual(budget.inspect_budget(self.root)["status"], "PASS")

    def test_malformed_inventory_fails(self):
        for source in ("", "IMPORTS = [\n", "IMPORTS = {}\n", "IMPORTS = make_inventory()\n",
                       "IMPORTS = {'diamond.cold': []}\n", "IMPORTS = {'diamond.cold': {2}}\n",
                       "IMPORTS = {'../cold': set()}\n", "IMPORTS = {1: set()}\n",
                       "IMPORTS = {'diamond.cold': set(), 'diamond.cold': set()}\n",
                       "IMPORTS = {'diamond.cold': set()}\nIMPORTS = {}\n",
                       "if True:\n    IMPORTS = {'diamond.cold': set()}\n"):
            with self.subTest(source=source):
                self.write(budget.BOUNDARY, source)
                self.rejected("INVENTORY_MALFORMED")

    def test_malformed_budget_counts_fail_closed(self):
        original = copy.deepcopy(self.manifest)
        for value in (None, True, -1, 6.0, "6", {}, []):
            for location in ("file", "total"):
                with self.subTest(value=value, location=location):
                    self.manifest = copy.deepcopy(original)
                    entry = self.manifest["files"][self.paths[0]] if location == "file" else self.manifest["totals"]
                    entry["limit"]["bytes"] = value
                    self.save_manifest()
                    self.rejected("BUDGET_MALFORMED")

    def test_malformed_budget_shape_and_totals_fail(self):
        original = copy.deepcopy(self.manifest)
        variants = []
        for field, value in (("schema", "wrong"), ("baseline_source_head", ""), ("files", {}), ("scope", {})):
            changed = copy.deepcopy(original)
            changed[field] = value
            variants.append(changed)
        changed = copy.deepcopy(original)
        changed["totals"]["baseline"]["bytes"] = 49
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["files"][self.paths[0]]["limit"]["bytes"] = 5
        variants.append(changed)
        for path in ("../outside.py", "/outside.py", "./outside.py", "bad\x00.py"):
            changed = copy.deepcopy(original)
            changed["files"][path] = changed["files"].pop(self.paths[0])
            variants.append(changed)
        variants.extend([None, [], {**original, "extra": 1}])
        for variant in variants:
            with self.subTest(variant=variant):
                self.manifest = variant
                self.save_manifest()
                self.rejected("BUDGET_MALFORMED")

    def test_invalid_json_and_duplicate_json_fields_fail(self):
        for content in ("{", '{"schema": "first", "schema": "second"}'):
            self.write(budget.BUDGET, content)
            self.rejected("BUDGET_MALFORMED")

    def test_cli_reports_success_and_named_failure(self):
        command = [sys.executable, "-B", str(CHECKER), "--root", str(self.root), "--json"]
        positive = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(positive.returncode, 0, positive.stdout + positive.stderr)
        self.assertEqual(json.loads(positive.stdout)["status"], "PASS")
        self.write(self.paths[0], "x = 12\n")
        negative = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(negative.returncode, 1, negative.stdout + negative.stderr)
        self.assertIn("SOURCE_BUDGET_EXCEEDED", negative.stdout)


if __name__ == "__main__":
    unittest.main()
