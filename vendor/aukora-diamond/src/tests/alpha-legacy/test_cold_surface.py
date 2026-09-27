#!/usr/bin/env python3
"""Static import policy for three supplied-data modules, not confinement.

Read source through AST only. The inspected modules are never imported here.
This regression policy does not resolve reflection, prove runtime behavior, or
inspect the interpreter or the internals of permitted dependencies. Shared
diamond.ed25519 contains signing primitives; only its verify symbol is admitted.
"""
from __future__ import annotations

import ast
from pathlib import Path
import shutil
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / "profiles/alpha/legacy"
MODULES = {"keychain.py", "witness.py", "receipt.py"}
BARE = {"base64", "hashlib", "json", "re"}
FROM = {
    "keychain.py": {("__future__", "annotations"), ("diamond.ed25519", "verify")},
    "witness.py": {("__future__", "annotations"), ("diamond.ed25519", "verify"), ("numbers", "Number")},
    "receipt.py": {("__future__", "annotations"), ("diamond.ed25519", "verify"),
                   (".witness", "verify_history")},
}
DYNAMIC_NAMES = {"__import__", "eval", "exec", "compile", "import_module", "exec_module",
                 "load_module", "SourceFileLoader", "SourcelessFileLoader"}
LIMITS = "Static source policy only; not confinement or a security proof. No reflection or dependency-internals analysis."


def inspect_surface(directory):
    errors = []
    if directory.is_symlink() or directory.parent.is_symlink():
        return ["COLD_SURFACE_SYMLINK: " + str(directory)]
    try:
        actual = set()
        for path in directory.rglob("*"):
            if "__pycache__" in path.relative_to(directory).parts:
                continue
            if path.is_symlink():
                errors.append("COLD_SURFACE_SYMLINK: " + str(path.relative_to(directory)))
            elif path.suffix == ".py":
                actual.add(path.relative_to(directory).as_posix())
        if actual != MODULES:
            errors.append("COLD_SURFACE_INVENTORY: missing=" + repr(sorted(MODULES - actual))
                          + " extra=" + repr(sorted(actual - MODULES)))
        for name in sorted(MODULES):
            path = directory / name
            if path.is_symlink():
                continue
            try:
                if not stat.S_ISREG(path.lstat().st_mode):
                    errors.append("COLD_SURFACE_FILE_TYPE: " + name)
                    continue
                tree = ast.parse(path.read_bytes(), filename=name)
            except (OSError, SyntaxError, ValueError) as exc:
                errors.append("COLD_SURFACE_UNREADABLE: " + name + ": " + type(exc).__name__)
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name not in BARE:
                            errors.append(f"COLD_SURFACE_IMPORT: {name}:{node.lineno}: {alias.name}")
                elif isinstance(node, ast.ImportFrom):
                    module = "." * node.level + (node.module or "")
                    for alias in node.names:
                        if (module, alias.name) not in FROM[name]:
                            errors.append(f"COLD_SURFACE_IMPORT: {name}:{node.lineno}: {module}.{alias.name}")
                elif isinstance(node, ast.Name) and node.id in DYNAMIC_NAMES:
                    errors.append(f"COLD_SURFACE_DYNAMIC: {name}:{node.lineno}: {node.id}")
                elif isinstance(node, ast.Attribute) and node.attr in DYNAMIC_NAMES:
                    errors.append(f"COLD_SURFACE_DYNAMIC: {name}:{node.lineno}: {node.attr}")
    except OSError as exc:
        errors.append("COLD_SURFACE_UNREADABLE: " + type(exc).__name__)
    return sorted(set(errors))


class ColdSurfaceTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="alpha-cold-surface-")
        self.addCleanup(scratch.cleanup)
        self.directory = Path(scratch.name) / "legacy"
        shutil.copytree(DIRECTORY, self.directory, ignore=shutil.ignore_patterns("__pycache__"))

    def append(self, source, name="receipt.py"):
        path = self.directory / name
        path.write_bytes(path.read_bytes() + b"\n" + source.encode("utf-8") + b"\n")

    def rejected(self, code):
        errors = inspect_surface(self.directory)
        self.assertTrue(errors)
        self.assertIn(code, "\n".join(errors))

    def test_current_three_modules_have_only_declared_imports(self):
        self.assertEqual(inspect_surface(DIRECTORY), [])
        self.assertIn("not confinement or a security proof", LIMITS)

    def test_standard_aliases_and_declared_verifier_alias_pass(self):
        self.append("import hashlib as digest\nfrom diamond.ed25519 import verify as validate_signature")
        self.assertEqual(inspect_surface(self.directory), [])

    def test_forbidden_dependencies_refuse_under_aliases(self):
        path = self.directory / "receipt.py"
        original = path.read_bytes()
        for source in ("import os as environment", "from pathlib import Path", "import subprocess",
                       "import socket", "from urllib.request import urlopen", "import requests",
                       "import node", "from authority import issue", "from diamond.grant import issue",
                       "from diamond.ed25519 import sign", "import diamond.ed25519 as primitives",
                       "from json import tool", "from .keychain import validate_keychain",
                       "from ..legacy.witness import verify_history"):
            with self.subTest(source=source):
                path.write_bytes(original)
                self.append(source)
                self.rejected("COLD_SURFACE_IMPORT")

    def test_import_all_and_dynamic_loading_names_refuse(self):
        path = self.directory / "receipt.py"
        original = path.read_bytes()
        for source in ("from diamond.ed25519 import *", "loader = __import__",
                       "loader = eval", "loader = exec", "loader = compile",
                       "loader = holder.import_module"):
            with self.subTest(source=source):
                path.write_bytes(original)
                self.append(source)
                self.rejected("COLD_SURFACE_IMPORT" if "import *" in source else "COLD_SURFACE_DYNAMIC")

    def test_missing_extra_nested_and_symlink_modules_refuse(self):
        path = self.directory / "keychain.py"
        original = path.read_bytes()
        path.unlink()
        self.rejected("COLD_SURFACE_INVENTORY")
        path.write_bytes(original)
        added = self.directory / "extra.py"
        added.write_text("# inert policy fixture\n")
        self.rejected("COLD_SURFACE_INVENTORY")
        added.unlink()
        nested = self.directory / "package"
        nested.mkdir()
        (nested / "extra.py").write_text("# inert policy fixture\n")
        self.rejected("COLD_SURFACE_INVENTORY")
        (nested / "extra.py").unlink()
        nested.rmdir()
        path.unlink()
        path.symlink_to(self.directory / "receipt.py")
        self.rejected("COLD_SURFACE_SYMLINK")

    def test_malformed_python_refuses_without_execution(self):
        (self.directory / "receipt.py").write_text("def unfinished(\n")
        self.rejected("COLD_SURFACE_UNREADABLE")

    def test_source_is_only_parsed_never_imported(self):
        self.append("raise RuntimeError('static source only')")
        self.assertEqual(inspect_surface(self.directory), [])


if __name__ == "__main__":
    unittest.main()
