#!/usr/bin/env python3
"""Read-only byte checks and disposable packaging controls; no source execution."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "profiles/alpha/contracts"
SOURCE_COMMIT = "ddb6a9cc9860fce840283b0010e24e7d627fa9db"
# Fixed review expectations live outside the preservation manifest.
SOURCE_PINS = {
    "RECEIPT-STANDARD.proposal.md": (
        "research/RECEIPT-STANDARD.proposal.md", 41110,
        "e2ad0672a5214b0d7a4772b4d9fe2c9a17a7bb9465dda56c9962bd94de35c46c",
        "eef5db8f390c6102fe41cf8295bb39e78cbba7bf"),
    "workspace-patch.source.txt": (
        "src/effects/workspace-patch/index.mjs", 8701,
        "5accc81cdf6d0fa1ea70bf565da046b9101db839c47232eab0c83c7ed75dc6d0",
        "8d3b892149b71998cf649d4e033d5057cda8957e"),
}
LICENSE_PINS = {
    "../LICENSE": (
        "LICENSE", 1178,
        "40f45228b4d89729161e33f637af41bf6a40c3addbf0d40ce123150797711554",
        "464a29a4b410c459ae28a00fbce4f918231f5548"),
    "../LICENSING.md": (
        "LICENSING.md", 363,
        "e35594b86c797cc371c8a8c0bc650fa513fd5990f404b954b47450e2a42b3032",
        "b141a2a172a3a7a00a450f5edf619d84bfa585c0"),
}
EXPECTED_FILES = set(SOURCE_PINS) | {"MANIFEST.json", "README.md"}
DEFINITION_PREFIX = b"aukora:workspace-definition:v1\n"
DEFINITION_ID = "07e7465248814d0cdbe29dbcde2b715720a9ce7e594e905fee974a809605f4f6"


def refuse(code, detail):
    raise ValueError(code + ": " + detail)


def read_regular(path):
    try:
        mode = path.lstat().st_mode
    except OSError:
        refuse("CONTRACT_FILE_MISSING", path.name)
    if stat.S_ISLNK(mode):
        refuse("CONTRACT_SYMLINK", path.name)
    if not stat.S_ISREG(mode):
        refuse("CONTRACT_FILE_TYPE", path.name)
    if mode & 0o111:
        refuse("CONTRACT_EXECUTABLE_MODE", path.name)
    return path.read_bytes()


def entry(path, pin, source=False):
    source_path, size, digest, blob = pin
    result = {"path": path, "sourcePath": source_path, "bytes": size,
              "sha256": digest, "gitBlob": blob}
    if source:
        result["verbatim"] = True
    return result


def validate_contracts(directory):
    if directory.is_symlink() or directory.parent.is_symlink():
        refuse("CONTRACT_SYMLINK", str(directory))
    try:
        names = {path.name for path in directory.iterdir()}
    except OSError:
        refuse("CONTRACT_DIRECTORY_MISSING", str(directory))
    if names != EXPECTED_FILES:
        refuse("CONTRACT_INVENTORY", "missing=" + repr(sorted(EXPECTED_FILES - names))
               + " extra=" + repr(sorted(names - EXPECTED_FILES)))
    # A closed flat inventory refuses executable suffixes, import hooks,
    # package metadata and nested module directories without importing any.
    content = {name: read_regular(directory / name) for name in sorted(names)}
    for name, pin in {**SOURCE_PINS, **LICENSE_PINS}.items():
        data = content[name] if name in content else read_regular(directory / name)
        _, size, digest, blob = pin
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            refuse("CONTRACT_BYTE_PIN_DRIFT", name)
        if hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest() != blob:
            refuse("CONTRACT_BLOB_PIN_DRIFT", name)
    try:
        manifest = json.loads(content["MANIFEST.json"])
    except (ValueError, UnicodeError):
        refuse("CONTRACT_MANIFEST_MALFORMED", "MANIFEST.json")
    expected = {
        "schema": "aukora-alpha-contract-sources/v1",
        "upstream": {"repository": "https://github.com/aumara-xyz/aukora-spec-alpha", "commit": SOURCE_COMMIT},
        "scope": "Inert historical contract and definition-source bytes; no executable producer import or runtime evidence.",
        "files": [entry(path, pin, source=True) for path, pin in SOURCE_PINS.items()],
        "licenseNotices": [entry(path, pin) for path, pin in LICENSE_PINS.items()],
        "definitionBinding": {"path": "workspace-patch.source.txt", "algorithm": "sha256",
                              "prefixUtf8": DEFINITION_PREFIX.decode("ascii"), "definitionId": DEFINITION_ID},
    }
    if manifest != expected:
        refuse("CONTRACT_MANIFEST_DRIFT", "manifest differs from fixed review expectations")
    if hashlib.sha256(DEFINITION_PREFIX + content["workspace-patch.source.txt"]).hexdigest() != DEFINITION_ID:
        refuse("CONTRACT_DEFINITION_ID_DRIFT", "workspace-patch.source.txt")
    return manifest


class ContractPinsTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="alpha-contract-pins-")
        self.addCleanup(scratch.cleanup)
        self.directory = Path(scratch.name) / "alpha/contracts"
        shutil.copytree(CONTRACTS, self.directory)
        for path in LICENSE_PINS:
            shutil.copyfile(CONTRACTS / path, self.directory / path)

    def rejected(self, code):
        with self.assertRaisesRegex(ValueError, "^" + code + ":"):
            validate_contracts(self.directory)

    def test_committed_contract_bytes_not_source_execution(self):
        manifest = validate_contracts(CONTRACTS)
        self.assertEqual(manifest["upstream"]["commit"], SOURCE_COMMIT)
        self.assertEqual(len(manifest["files"]), 2)
        self.assertEqual(manifest["definitionBinding"]["definitionId"], DEFINITION_ID)

    def test_each_preserved_source_byte_drift_refuses(self):
        for name in SOURCE_PINS:
            with self.subTest(path=name):
                path = self.directory / name
                original = path.read_bytes()
                path.write_bytes(original + b"\n")
                self.rejected("CONTRACT_BYTE_PIN_DRIFT")
                path.write_bytes(original)

    def test_source_and_manifest_cannot_repin_themselves(self):
        name = "workspace-patch.source.txt"
        path = self.directory / name
        changed = path.read_bytes() + b"\n"
        path.write_bytes(changed)
        manifest_path = self.directory / "MANIFEST.json"
        manifest = json.loads(manifest_path.read_text())
        row = next(row for row in manifest["files"] if row["path"] == name)
        row.update(bytes=len(changed), sha256=hashlib.sha256(changed).hexdigest())
        manifest_path.write_text(json.dumps(manifest))
        self.rejected("CONTRACT_BYTE_PIN_DRIFT")

    def test_missing_required_files_refuse(self):
        for name in sorted(EXPECTED_FILES):
            with self.subTest(path=name):
                path = self.directory / name
                original = path.read_bytes()
                path.unlink()
                self.rejected("CONTRACT_INVENTORY")
                path.write_bytes(original)

    def test_executable_suffixes_and_import_surfaces_refuse(self):
        for name in ("effect.py", "effect.mjs", "effect.js", "effect.sh", "__init__.py",
                     "package.json", "pyproject.toml", "autoload.pth", "extra.source.txt"):
            with self.subTest(path=name):
                path = self.directory / name
                path.write_text("inert test placeholder\n")
                self.rejected("CONTRACT_INVENTORY")
                path.unlink()
        (self.directory / "package").mkdir()
        self.rejected("CONTRACT_INVENTORY")

    def test_symlink_and_executable_mode_refuse(self):
        path = self.directory / "workspace-patch.source.txt"
        original = path.read_bytes()
        spare = self.directory.parent / "spare.txt"
        spare.write_bytes(original)
        path.unlink()
        path.symlink_to(spare)
        self.rejected("CONTRACT_SYMLINK")
        path.unlink()
        path.write_bytes(original)
        path.chmod(0o755)
        self.rejected("CONTRACT_EXECUTABLE_MODE")

    def test_license_notice_drift_or_omission_refuses(self):
        for name in LICENSE_PINS:
            with self.subTest(path=name):
                path = self.directory / name
                original = path.read_bytes()
                path.write_bytes(original + b"\n")
                self.rejected("CONTRACT_BYTE_PIN_DRIFT")
                path.unlink()
                self.rejected("CONTRACT_FILE_MISSING")
                path.write_bytes(original)

    def test_malformed_or_changed_manifest_refuses(self):
        path = self.directory / "MANIFEST.json"
        path.write_text("{")
        self.rejected("CONTRACT_MANIFEST_MALFORMED")
        path.write_text("{}")
        self.rejected("CONTRACT_MANIFEST_DRIFT")


if __name__ == "__main__":
    unittest.main()
