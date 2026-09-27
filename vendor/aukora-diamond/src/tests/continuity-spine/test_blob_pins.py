"""Source-only pin controls on disposable Git trees; no sibling or WASM execution."""
from __future__ import annotations

import base64
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import measure_pins as pins


WRAPPER = "aukora/guest/wasm-proposal-cell.mjs"
WAT = "aukora/guest/wasm/memory-put-proposal.wat"
CONFINEMENT = "aukora/supervisor/guest-confinement.mjs"
VERIFIER = "vendor/phase0-consistency/verify.py"
REVIEWED_ALPHA_PINS = pins.ALPHA_SOURCE_PINS


def digest(data):
    return hashlib.sha256(data).hexdigest()


class BlobPins(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="diamond-blob-pins-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name) / "sources"
        self.root.mkdir()
        self.out = Path(self.scratch.name) / "report.json"
        # Deliberately NOT a WebAssembly module. The reader only hashes and decodes bytes.
        self.module = b"inert fixture, never execute".ljust(101, b".")
        self.wat = b"(module ;; inert WAT fixture, never compile\n)\n"
        self.verifier = b"# inert verifier fixture, never import\n"
        self.wrapper = self.source(self.module)
        self.alpha_sources = {
            relative: ("# inert Alpha source fixture, never execute: " + relative + "\n").encode()
            for _, relative, _ in REVIEWED_ALPHA_PINS
        }
        for path, data in ((WRAPPER, self.wrapper), (WAT, self.wat),
                           (VERIFIER, self.verifier),
                           (CONFINEMENT, pins.OBSERVATION.encode())):
            self.write(path, data)
        self.git("-c", "init.templateDir=", "init", "-q")
        self.commit("initial fixture")
        for name, value in (("CELL", digest(self.module)), ("CELL_SOURCE", digest(self.wrapper)),
                            ("CELL_WAT", digest(self.wat)), ("VERIFY", digest(self.verifier)),
                            ("ALPHA_SOURCE_PINS", tuple(
                                (key, relative, digest(self.alpha_sources[relative]))
                                for key, relative, _ in REVIEWED_ALPHA_PINS))):
            patcher = patch.object(pins, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def source(self, module, declared=None):
        return ("// Read as text only.\n"
                f"const MODULE_BASE64 = '{base64.b64encode(module).decode()}'\n"
                f"export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '{declared or digest(module)}'\n").encode()

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.root), "-c", "core.hooksPath=/dev/null",
             "-c", "commit.gpgSign=false", "-c", "core.fsmonitor=false",
             "-c", "user.name=Diamond fixture", "-c", "user.email=fixture@example.invalid", *args],
            stderr=subprocess.STDOUT, text=True).strip()

    def write(self, relative, data):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def commit(self, message):
        self.git("add", "--all")
        self.git("commit", "-qm", message, "--allow-empty")

    def measure(self, *extra):
        with redirect_stdout(io.StringIO()):
            status = pins.main(["--deep", str(self.root), "--genesis", str(self.root),
                                "--out", str(self.out), *extra])
        return status, json.loads(self.out.read_text())

    def refused(self, reason, *extra):
        status, report = self.measure(*extra)
        self.assertEqual(status, 1, report)
        self.assertEqual(report["verdict"], "REFUSED")
        self.assertEqual(report["reason"], reason)
        return report

    def test_three_distinct_blobs_are_accepted_without_execution(self):
        status, report = self.measure()
        self.assertEqual(status, 0, report)
        self.assertEqual(report["verdict"], "MEASURED_LOCAL_MATCH")
        self.assertEqual(report["scope"], "LOCAL_SOURCE_BYTES_ONLY_NOT_EXECUTION_OR_DEPLOYMENT")
        actual = report["pins"]
        self.assertEqual(actual["deepCellSource"]["sha256"], digest(self.wrapper))
        self.assertEqual(actual["wasmModule"]["sha256"], digest(self.module))
        self.assertEqual(actual["deepCellWatSource"]["sha256"], digest(self.wat))
        self.assertEqual(actual["wasmModule"]["bytes"], 101)

    def test_wrapper_only_drift_refuses_even_when_module_is_unchanged(self):
        self.write(WRAPPER, self.wrapper + b"// changed host callback\n")
        self.commit("wrapper drift")
        report = self.refused("WASM_WRAPPER_PIN_DRIFT")
        self.assertTrue(report["pins"]["wasmModule"]["matchesBlobPin"])

    def test_changed_module_refuses_even_if_its_declaration_is_updated(self):
        self.write(WRAPPER, self.source(b"X" + self.module[1:]))
        self.commit("module drift")
        self.refused("WASM_MODULE_PIN_DRIFT")

    def test_changed_declared_module_pin_refuses(self):
        self.write(WRAPPER, self.source(self.module, "0" * 64))
        self.commit("declaration drift")
        self.refused("WASM_MODULE_PIN_DRIFT")

    def test_module_length_is_checked_even_when_hash_pin_matches(self):
        module = self.module + b"X"
        self.write(WRAPPER, self.source(module))
        self.commit("wrong module length")
        with patch.object(pins, "CELL", digest(module)):
            self.refused("WASM_MODULE_PIN_DRIFT")

    def test_wat_only_drift_refuses(self):
        self.write(WAT, self.wat + b";; changed source\n")
        self.commit("WAT drift")
        report = self.refused("WASM_WAT_PIN_DRIFT")
        self.assertTrue(report["pins"]["deepCellSource"]["matchesBlobPin"])
        self.assertTrue(report["pins"]["wasmModule"]["matchesBlobPin"])

    def test_module_bytes_cannot_substitute_for_wat_source(self):
        self.write(WAT, self.module)
        self.commit("conflated module and WAT")
        self.refused("WASM_WAT_PIN_DRIFT")

    def test_wat_hash_cannot_substitute_for_module_pin(self):
        with patch.object(pins, "CELL", digest(self.wat)):
            self.refused("WASM_MODULE_PIN_DRIFT")

    def test_new_provenance_commit_accepts_identical_blob_bytes(self):
        first_status, first = self.measure()
        self.write("unrelated.txt", b"another commit, identical measured blobs\n")
        self.commit("unrelated change")
        second_status, second = self.measure()
        self.assertEqual((first_status, second_status), (0, 0))
        for name in ("deepCellSource", "deepCellWatSource", "genesisVerifier", "seatbeltSource"):
            self.assertNotEqual(first["pins"][name]["commit"], second["pins"][name]["commit"])
            self.assertEqual(first["pins"][name]["sha256"], second["pins"][name]["sha256"])

    def test_pinned_working_bytes_cannot_hide_different_committed_bytes(self):
        self.write(WRAPPER, self.wrapper + b"// drift in HEAD\n")
        self.commit("different committed wrapper")
        self.write(WRAPPER, self.wrapper)
        self.refused("WORKTREE_DIFFERS_FROM_HEAD:" + WRAPPER)

    def test_missing_wat_refuses_instead_of_skipping(self):
        (self.root / WAT).unlink()
        self.commit("missing WAT")
        status, report = self.measure()
        self.assertEqual(status, 1)
        self.assertEqual(report["verdict"], "REFUSED")
        self.assertIn(WAT, report["reason"])

    def test_ambiguous_module_literal_refuses(self):
        self.write(WRAPPER, self.wrapper + self.wrapper)
        self.commit("ambiguous literals")
        self.refused("WASM_SOURCE_LITERAL_INVALID")

    def add_alpha_sources(self):
        for relative, data in self.alpha_sources.items():
            self.write(relative, data)
        self.commit("inert Alpha source fixtures")

    def test_fixed_alpha_pins_match_reviewed_local_record(self):
        recorded = json.loads(Path(__file__).with_name("local-pins.json").read_text())["pins"]
        expected = {
            key: (info["path"], info["sha256"])
            for key, info in recorded.items() if key.startswith("alpha")
        }
        self.assertEqual(len(expected), 6)
        self.assertEqual({key: (relative, sha) for key, relative, sha in REVIEWED_ALPHA_PINS}, expected)

    def test_alpha_sources_are_optional_when_argument_is_absent(self):
        self.assertTrue(all(not (self.root / relative).exists() for relative in self.alpha_sources))
        status, report = self.measure()
        self.assertEqual(status, 0, report)
        self.assertFalse(any(key.startswith("alpha") for key in report["pins"]))

    def test_all_six_alpha_source_pins_are_accepted_without_execution(self):
        self.add_alpha_sources()
        status, report = self.measure("--spec-alpha", str(self.root))
        self.assertEqual(status, 0, report)
        for key, relative, _ in REVIEWED_ALPHA_PINS:
            with self.subTest(path=relative):
                info = report["pins"][key]
                self.assertEqual(info["expectedSha256"], digest(self.alpha_sources[relative]))
                self.assertTrue(info["matchesBlobPin"])
                self.assertEqual(info["observationClass"], "SOURCE_BYTES_ONLY_NOT_EXECUTED_HERE")

    def test_each_changed_committed_alpha_source_refuses_by_name(self):
        self.add_alpha_sources()
        for key, relative, _ in REVIEWED_ALPHA_PINS:
            with self.subTest(path=relative):
                for path, data in self.alpha_sources.items():
                    self.write(path, data)
                self.write(relative, self.alpha_sources[relative] + b"# changed source\n")
                self.commit("source drift: " + relative)
                report = self.refused("ALPHA_SOURCE_PIN_DRIFT:" + relative,
                                      "--spec-alpha", str(self.root))
                info = report["pins"][key]
                self.assertEqual(info["expectedSha256"], digest(self.alpha_sources[relative]))
                self.assertTrue(info["matchesCommittedBytes"])
                self.assertFalse(info["matchesBlobPin"])

    def test_new_alpha_provenance_commit_accepts_identical_source_bytes(self):
        self.add_alpha_sources()
        first_status, first = self.measure("--spec-alpha", str(self.root))
        self.write("unrelated.txt", b"new commit, identical Alpha source blobs\n")
        self.commit("unrelated Alpha provenance change")
        second_status, second = self.measure("--spec-alpha", str(self.root))
        self.assertEqual((first_status, second_status), (0, 0))
        for key, _, _ in REVIEWED_ALPHA_PINS:
            self.assertNotEqual(first["pins"][key]["commit"], second["pins"][key]["commit"])
            self.assertEqual(first["pins"][key]["sha256"], second["pins"][key]["sha256"])
            self.assertTrue(second["pins"][key]["matchesBlobPin"])

    def test_missing_requested_alpha_source_refuses_instead_of_skipping(self):
        self.add_alpha_sources()
        for _, relative, _ in REVIEWED_ALPHA_PINS:
            with self.subTest(path=relative):
                for path, data in self.alpha_sources.items():
                    self.write(path, data)
                (self.root / relative).unlink()
                self.commit("missing Alpha source: " + relative)
                status, report = self.measure("--spec-alpha", str(self.root))
                self.assertEqual(status, 1, report)
                self.assertEqual(report["verdict"], "REFUSED")
                self.assertIn(relative, report["reason"])


if __name__ == "__main__":
    unittest.main()
