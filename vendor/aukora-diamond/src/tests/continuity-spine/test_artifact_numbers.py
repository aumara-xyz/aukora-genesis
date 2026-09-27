"""Numeric-profile refusals survive both actual cold approval-artifact entry points.

Run: python3 -B tests/continuity-spine/test_artifact_numbers.py
Uses committed producer evidence and disposable input mutations only; no producer
process, live store, Node runtime, or external signing service is involved.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond import approval_artifact as aa, kira_evidence as ke

FIXTURES = ROOT / "tests/kira-artifact/fixtures"
CLI = ROOT / "scripts/verify-kira-evidence.py"


class ArtifactNumbers(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="diamond-artifact-numbers-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.neutral = self.root / "empty-cwd"
        self.neutral.mkdir()
        self.content = (FIXTURES / "content-1.txt").read_bytes()
        self.record = json.loads(self.content)["value"]
        self.receipt = json.loads((FIXTURES / "receipt-1.json").read_text())
        self.artifact = json.loads((FIXTURES / "artifact-1.json").read_text())
        self.anchor = (FIXTURES / "approver.pk").read_text().strip()

    def decimal_record(self):
        record = deepcopy(self.record)
        record["content"]["numericControl"] = 0.25
        return record

    def decimal_content(self):
        return (json.dumps({"key": self.record["recordId"], "value": self.decimal_record()},
                           sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode()

    def verify(self, record=None, content=None):
        return aa.verify_artifact(self.artifact, anchor=self.anchor,
            content_bytes=self.content if content is None else content,
            record=self.record if record is None else record, receipt=self.receipt)

    def run_cli(self, record, content, *, standalone=False, extra=()):
        record_path = self.root / "record.json"
        content_path = self.root / "content.txt"
        record_path.write_text(json.dumps(record), encoding="utf-8")
        content_path.write_bytes(content)
        if standalone:
            command = [sys.executable, "-B", "-m", "diamond.approval_artifact",
                       "--artifact", str(FIXTURES / "artifact-1.json"),
                       "--content", str(content_path), "--anchor", self.anchor,
                       "--record", str(record_path), "--receipt", str(FIXTURES / "receipt-1.json")]
        else:
            command = [sys.executable, "-B", str(CLI), "--package-root", str(ROOT),
                       "--record", str(record_path), "--receipt", str(FIXTURES / "receipt-1.json"),
                       "--log", str(FIXTURES / "aura.jsonl"), "--anchor", str(FIXTURES / "issuer.pem"),
                       "--artifact", str(FIXTURES / "artifact-1.json"),
                       "--artifact-content", str(content_path), "--artifact-anchor", self.anchor]
        result = subprocess.run(command + ["--json", *extra], cwd=self.neutral,
            capture_output=True, text=True, timeout=30,
            env={"PATH": "/usr/bin:/bin", "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertNotIn("Traceback", result.stdout + result.stderr)
        if standalone:
            report = json.loads(result.stdout)
        else:
            self.assertIn("REPORT-JSON-BEGIN", result.stdout, result.stdout + result.stderr)
            report = json.loads(result.stdout.split("REPORT-JSON-BEGIN\n", 1)[1]
                                .split("\nREPORT-JSON-END", 1)[0])
        return result, report

    def assert_unsupported(self, findings):
        self.assertTrue(findings["fails_verification"])
        self.assertEqual(findings["refusal"]["code"], "UNSUPPORTED_NUMBER")
        summary = aa.artifact_summary(findings)
        self.assertEqual(summary["status"], "UNSUPPORTED_NUMBER")
        self.assertTrue(summary["reason"].startswith("UNSUPPORTED:"))
        self.assertEqual(findings["authorization"]["status"], "OWNER_APPROVAL_UNCHECKED")
        self.assertEqual(findings["attendance"]["status"], "reported-not-proven")
        self.assertTrue(findings["ceilings"])

    def test_original_artifact_still_verifies_in_both_entry_points(self):
        self.assertFalse(self.verify()["fails_verification"])
        for standalone in (False, True):
            with self.subTest(standalone=standalone):
                result, report = self.run_cli(self.record, self.content, standalone=standalone)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                if standalone:
                    self.assertEqual(report["summary"]["status"], "APPROVAL_ARTIFACT_VERIFIED")
                else:
                    self.assertEqual(report["verdict"], "verified")

    def test_supported_numbers_and_decimal_strings_remain_canonical(self):
        value = {"key": "synthetic-control", "value": {"values": [0, 7, -1, "0.25", "1e-7"]}}
        raw = ke.jcs_bytes(value) + b"\n"
        self.assertEqual(aa.read_content(raw), value)
        with self.assertRaises(aa.ArtifactRefusal) as caught:
            aa.read_content(raw + b"\n")
        self.assertEqual(caught.exception.code, "APPROVAL_CONTENT_NOT_CANONICAL")

    def test_decimal_record_refuses_without_discarding_content_binding(self):
        findings = self.verify(record=self.decimal_record())
        self.assert_unsupported(findings)
        self.assertEqual(findings["content_canonicalization"]["status"], "CONTENT_CANONICAL")
        self.assertEqual(findings["operation_binding"]["status"], "OPERATION_BINDING_VERIFIED")
        self.assertEqual(findings["record_identity"]["status"], "UNSUPPORTED_NUMBER")
        self.assertIsNone(findings["record_identity"]["recomputedRecordId"])

    def test_decimal_content_refuses_without_guessing_canonical_bytes(self):
        with self.assertRaises(aa.ArtifactRefusal) as caught:
            aa.read_content(self.decimal_content())
        self.assertEqual(caught.exception.code, "UNSUPPORTED_NUMBER")
        findings = self.verify(content=self.decimal_content())
        self.assert_unsupported(findings)
        self.assertEqual(findings["content_canonicalization"]["status"], "UNSUPPORTED_NUMBER")
        self.assertEqual(findings["record_identity"]["status"], "NOT_CHECKED")
        self.assertIn("APPROVAL_CONTENT_MISMATCH", [entry["code"] for entry in findings["refusals"]])

    def test_both_decimal_paths_return_json_in_both_entry_points(self):
        for record, content, lane in ((self.decimal_record(), self.content, "evidence"),
                                     (self.record, self.decimal_content(), "owner_approval_artifact")):
            for standalone in (False, True):
                with self.subTest(lane=lane, standalone=standalone):
                    result, report = self.run_cli(record, content, standalone=standalone)
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    if standalone:
                        self.assert_unsupported(report["findings"])
                    else:
                        self.assertFalse(report["verified"])
                        self.assertEqual(report["status"], "UNSUPPORTED")
                        self.assertEqual(report["verdict"], "UNSUPPORTED_NUMBER")
                        self.assertEqual(report["refusalLane"], lane)
                        self.assertIn("VERDICT: UNSUPPORTED  UNSUPPORTED_NUMBER", result.stdout)
                        self.assert_unsupported(report["approvalArtifactFindings"])

    def test_primary_evidence_refusal_stays_primary(self):
        record = deepcopy(self.record)
        record["content"]["supportedMutation"] = 1
        result, report = self.run_cli(record, self.decimal_content())
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["verdict"], "record-identity-mismatch")
        self.assertEqual(report["status"], "REFUSED")
        self.assertEqual(report["refusalLane"], "evidence")
        self.assert_unsupported(report["approvalArtifactFindings"])

    def test_named_artifact_unsupported_expectation_is_assertable(self):
        result, report = self.run_cli(self.record, self.decimal_content(),
                                     extra=("--expect", "UNSUPPORTED_NUMBER"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(report["verified"])
        self.assertEqual(report["refusalLane"], "owner_approval_artifact")

    def test_unexpected_implementation_errors_are_not_hidden(self):
        with patch.object(ke, "compute_record_id", side_effect=RuntimeError("control defect")):
            with self.assertRaisesRegex(RuntimeError, "control defect"):
                self.verify()


if __name__ == "__main__":
    unittest.main(verbosity=2)
