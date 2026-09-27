"""A caller-retained Kira receipt detects rollback, never history completeness."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond import kira_evidence as ke

FIXTURE = ROOT / "tests/kira-artifact/fixtures"


class RetainedReceipt(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="diamond-retained-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.record = json.loads((FIXTURE / "content-1.txt").read_text())["value"]
        self.first = json.loads((FIXTURE / "receipt-1.json").read_text())
        self.later = json.loads((FIXTURE / "receipt-2.json").read_text())
        self.anchor = ke.raw_public_key_bytes((FIXTURE / "issuer.pem").read_text())
        self.entries = ke.read_log(FIXTURE / "aura.jsonl")
        self.assertEqual(len(self.entries), 2)
        self.prefix = self.write_log("prefix.jsonl", self.entries[:1])

    def write_log(self, name, entries):
        path = self.root / name
        path.write_text("".join(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n"
                                for entry in entries))
        return path

    def verify(self, **changes):
        args = dict(record_document=self.record, receipt_document=self.first,
                    log_path=FIXTURE / "aura.jsonl", anchor_raw=self.anchor)
        args.update(changes)
        return ke.verify_evidence(**args)

    def assert_ceiling(self, report):
        self.assertEqual(report["retention"]["completeness"], "UNDETERMINED")
        self.assertEqual(report["retention"]["latestness"], "NO_LATESTNESS")
        self.assertEqual(report["execution"], ke.execution_scope())

    def assert_refused(self, report, code):
        self.assertFalse(report["verified"], report)
        self.assertEqual(report["refusal"]["code"], code, report)
        self.assert_ceiling(report)

    def test_honest_prefix_alone_cannot_establish_completeness(self):
        result = self.verify(log_path=self.prefix)
        self.assertTrue(result["verified"], result)
        self.assertTrue(result["position"]["isLogTip"])
        self.assertEqual(result["retention"]["status"], "NOT_SUPPLIED")
        self.assert_ceiling(result)

    def test_separately_retained_later_receipt_detects_truncation(self):
        result = self.verify(log_path=self.prefix, retained_receipt_document=self.later)
        self.assert_refused(result, "RETAINED_CHECKPOINT_TRUNCATED")
        self.assertTrue(result["position"]["verified"])
        self.assertEqual(result["retention"]["anchorSource"], "SUPPLIED")

    def test_retained_prefix_and_honest_extension_match_without_latestness(self):
        for retained in (self.first, self.later):
            result = self.verify(retained_receipt_document=retained)
            self.assertTrue(result["verified"], result)
            self.assertEqual(result["retention"]["status"], "SUPPLIED_PREFIX_MATCH")
            self.assertEqual(result["retention"]["verifiedPrefixThrough"], retained["aura"]["seq"])
            self.assertEqual(result["retention"]["entryHash"], retained["aura"]["entryHash"])
            self.assert_ceiling(result)

    def test_valid_rehashed_conflicting_extension_is_rejected(self):
        entries = copy.deepcopy(self.entries)
        entry = entries[1]
        entry["key"] = "kira:" + "ab" * 32
        fields = {name: entry[name] for name in ke.AURA_ENTRY_FIELDS}
        entry["hash"] = ke.aura_entry_hash(entry["prev"], fields, sequence=2)
        path = self.write_log("fork.jsonl", entries)
        self.assertTrue(self.verify(log_path=path)["verified"])
        self.assert_refused(self.verify(log_path=path, retained_receipt_document=self.later),
                            "RETAINED_CHECKPOINT_CONFLICT")

    def test_invalid_or_wrong_profile_is_not_silently_ignored(self):
        for value in (None, False, 0, [], "", {},
                      {"domain": "aukora:aura-checkpoint:v1", "treeSize": 2},
                      {"kind": "aukora-checkpoint/v1-toy"}):
            with self.subTest(value=value):
                self.assert_refused(self.verify(retained_receipt_document=value),
                                    "RETAINED_CHECKPOINT_INVALID")

    def test_bad_signature_and_wrong_key_do_not_anchor(self):
        self.assert_refused(self.verify(retained_receipt_document={**self.later, "sig": "00" * 64}),
                            "RETAINED_CHECKPOINT_SIGNATURE_INVALID")
        other_key = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA" + "A" * 43 + "=\n-----END PUBLIC KEY-----\n"
        self.assert_refused(self.verify(retained_receipt_document={**self.later, "issuerPk": other_key}),
                            "RETAINED_CHECKPOINT_INVALID")

    def test_wrapper_cannot_supply_or_erase_retained_anchor(self):
        wrapper = {"retainedReceipt": self.later, "completeness": "COMPLETE"}
        result = self.verify(log_path=self.prefix, wrapper=wrapper)
        self.assertTrue(result["verified"])
        self.assertEqual(result["retention"]["status"], "NOT_SUPPLIED")
        self.assert_refused(self.verify(log_path=self.prefix, wrapper={"retainedReceipt": self.first},
                                       retained_receipt_document=self.later),
                            "RETAINED_CHECKPOINT_TRUNCATED")

    def test_removed_guard_is_detected(self):
        matched = self.verify(retained_receipt_document=self.later)["retention"]
        with patch.object(ke, "check_retained_receipt", return_value=matched):
            broken = self.verify(log_path=self.prefix, retained_receipt_document=self.later)
        with self.assertRaises(AssertionError):
            self.assert_refused(broken, "RETAINED_CHECKPOINT_TRUNCATED")

    def test_log_sequences_reject_python_equality_aliases(self):
        for value in (True, 1.0):
            entries = copy.deepcopy(self.entries)
            entries[0]["sequence"] = value
            path = self.write_log("numeric-alias.jsonl", entries)
            self.assert_refused(self.verify(log_path=path, retained_receipt_document=self.later),
                                "chain-sequence")

    def test_actual_cli_consumes_only_explicit_anchor_and_prints_ceilings(self):
        record = self.root / "record.json"
        record.write_text(json.dumps(self.record))
        invalid_utf8 = self.root / "retained-invalid-utf8.json"
        invalid_utf8.write_bytes(b"\xff")
        base = [sys.executable, "-B", str(ROOT / "scripts/verify-kira-evidence.py"),
                "--record", str(record), "--receipt", str(FIXTURE / "receipt-1.json"),
                "--log", str(self.prefix), "--anchor", str(FIXTURE / "issuer.pem"), "--json"]
        for extra, expected, rc in (
            ([], "verified", 0),
            (["--retained-receipt", str(FIXTURE / "receipt-2.json")], "RETAINED_CHECKPOINT_TRUNCATED", 1),
            (["--retained-receipt", ""], "RETAINED_CHECKPOINT_INVALID", 1),
            (["--retained-receipt", str(invalid_utf8)], "RETAINED_CHECKPOINT_INVALID", 1),
        ):
            with self.subTest(extra=extra):
                result = subprocess.run(base + extra, cwd=self.root,
                    env={"PATH": os.defpath, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                    capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, rc, result.stdout + result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                report = json.loads(result.stdout.split("REPORT-JSON-BEGIN\n")[1].split("\nREPORT-JSON-END")[0])
                self.assertEqual(report["verdict"], expected)
                self.assertIn("COMPLETENESS: UNDETERMINED", result.stdout)
                self.assertIn("LATESTNESS: NO_LATESTNESS", result.stdout)
                self.assert_ceiling(report)


if __name__ == "__main__":
    unittest.main()
