"""Check-18 uses committed producer fixtures; no proposer is loaded or recreated.

The current receipt fixtures have a documented, regenerable Genesis producer at
tests/kira-artifact/make-fixtures.mjs. These tests never mint a receipt in Diamond.
"""
from __future__ import annotations

import json
import io
from contextlib import redirect_stderr, redirect_stdout
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
from diamond import cold_verify

FIXTURE = ROOT / "tests/kira-artifact/fixtures"
PIN = "34ce6cab618b626243e876befb49ccf8a6780dc836e757484886b34ae977a438"


class Check18(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((FIXTURE / "content-1.txt").read_text())["value"]
        self.receipt = json.loads((FIXTURE / "receipt-1.json").read_text())
        self.anchor = ke.raw_public_key_bytes((FIXTURE / "issuer.pem").read_text())

    def verify(self, **changes):
        args = dict(record_document=self.record, receipt_document=self.receipt,
                    log_path=FIXTURE / "aura.jsonl", anchor_raw=self.anchor,
                    store=FIXTURE)
        args.update(changes)
        return ke.verify_evidence(**args)

    def assert_unestablished(self, result):
        self.assertEqual(result["execution"]["status"], "NOT_ESTABLISHED")
        self.assertIsNone(result["execution"]["cellRan"])
        self.assertTrue(any(c.startswith("NO_CELL_EXECUTION_PROOF:") for c in result["ceilings"]))

    def test_green_current_receipt_does_not_establish_cell_execution(self):
        result = self.verify()
        self.assertTrue(result["verified"], result["refusal"])
        self.assertEqual(result["receiptProfile"], "current-with-approval")
        self.assert_unestablished(result)

    def test_identical_bytes_cannot_distinguish_claimed_producer(self):
        first = self.verify(wrapper={"producer": "claimed-wasm-cell", "moduleSha256": PIN})
        second = self.verify(wrapper={"producer": "claimed-direct-json", "cellRan": True})
        for result in (first, second):
            self.assertTrue(result["verified"], result["refusal"])
            self.assert_unestablished(result)
        self.assertEqual(first["receipt"], second["receipt"])
        self.assertEqual(first["execution"], second["execution"])

    def test_module_digest_does_not_expand_signed_receipt_contract(self):
        for value in (PIN, "bad", None):
            result = self.verify(receipt_document={**self.receipt, "moduleSha256": value})
            self.assertFalse(result["verified"])
            self.assertEqual(result["refusal"]["code"], "shape")
            self.assertIn("moduleSha256", result["refusal"]["detail"])
            self.assert_unestablished(result)

    def test_bad_signature_and_absent_anchor_do_not_establish_execution(self):
        for result in (self.verify(receipt_document={**self.receipt, "sig": "00" * 64}),
                       self.verify(anchor_raw=None)):
            self.assertFalse(result["verified"])
            self.assert_unestablished(result)

    def test_report_mutation_cannot_change_next_report(self):
        first = self.verify()
        first["execution"]["cellRan"] = True
        self.assert_unestablished(self.verify())

    def test_check18_assertion_rejects_false_execution_upgrade(self):
        result = self.verify()
        self.assertTrue(result["verified"])
        with patch.object(ke, "execution_scope", return_value={"status": "VERIFIED", "cellRan": True}):
            broken = self.verify()
        self.assertTrue(broken["verified"])
        with self.assertRaises(AssertionError):
            self.assert_unestablished(broken)

    def test_cold_receipt_cli_prints_non_implication(self):
        with tempfile.TemporaryDirectory(prefix="diamond-check18-") as tmp:
            p = subprocess.run([sys.executable, "-B", "-m", "diamond.cold_verify",
                str(ROOT / "tests/genesis-minted/receipt.json"), "--pub",
                str(ROOT / "tests/genesis-minted/issuer.pk")], cwd=tmp,
                env={"PATH": os.defpath, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True, text=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("SIGNATURE_VALID", p.stdout)
        self.assertIn("CELL_EXECUTION: NOT_ESTABLISHED", p.stdout)

    def assert_cold_refusal(self, rc, stdout, stderr):
        self.assertEqual(rc, 2, stderr)
        for line in ("CELL_EXECUTION: NOT_ESTABLISHED", "AUTHORITY_MODE: mode-unbound",
                     "OPERATOR_PRESENCE: NOT_ESTABLISHED", "ATTENDANCE: reported-not-proven",
                     "CONSISTENCY: CONSISTENCY_UNCHECKED"):
            self.assertEqual(stdout.splitlines().count(line), 1, stdout)
        for false_success in ("SIGNATURE_VALID", "SIGNER_KEY_MATCHED", "APPEND_ONLY",
                              "CELL_EXECUTION: VERIFIED", "OPERATOR_PRESENCE: MEASURED"):
            self.assertNotIn(false_success, stdout)

    def test_cold_receipt_cli_refusals_keep_scope(self):
        with tempfile.TemporaryDirectory(prefix="diamond-check18-refusals-") as tmp:
            root = Path(tmp)
            fixture = ROOT / "tests/genesis-minted"
            wrong = root / "wrong.pk"
            wrong.write_text("00" * 32)
            malformed = root / "malformed.json"
            malformed.write_text("{not json")
            bad_signature = root / "bad-signature.json"
            receipt = json.loads((fixture / "receipt.json").read_text())
            receipt["sig"] = "00" * 64
            bad_signature.write_text(json.dumps(receipt))
            for label, args, reason in (
                ("wrong-key", [fixture / "receipt.json", "--pub", wrong], "issuerPk mismatch"),
                ("unreadable-key", [fixture / "receipt.json", "--pub", root / "missing.pk"], "FAIL:"),
                ("malformed-receipt", [malformed, "--pub", fixture / "issuer.pk"], "FAIL:"),
                ("missing-anchor", [fixture / "receipt.json"], "require --pub or --trust-anchors"),
                ("bad-signature", [bad_signature, "--pub", fixture / "issuer.pk"], "signature"),
                ("dual-anchor", [fixture / "receipt.json", "--pub", fixture / "issuer.pk",
                                 "--trust-anchors", wrong], "ANCHOR_SOURCE_AMBIGUOUS"),
                ("cli-usage", [], "error:"),
            ):
                with self.subTest(label=label):
                    result = subprocess.run([sys.executable, "-B", "-m", "diamond.cold_verify",
                        *map(str, args)], cwd=tmp,
                        env={"PATH": os.defpath, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                        capture_output=True, text=True, timeout=30)
                    self.assert_cold_refusal(result.returncode, result.stdout, result.stderr)
                    self.assertIn(reason, result.stderr)

    def test_cold_refusal_scope_controls_detect_removed_or_false_renderer(self):
        for render in (lambda: None,
                       lambda: print("CELL_EXECUTION: VERIFIED\nOPERATOR_PRESENCE: MEASURED")):
            with self.subTest(render=render):
                output, errors = io.StringIO(), io.StringIO()
                with patch.object(cold_verify, "_print_scope", side_effect=render), \
                        redirect_stdout(output), redirect_stderr(errors):
                    rc = cold_verify.main([str(ROOT / "tests/genesis-minted/receipt.json")])
                self.assertEqual(rc, 2)
                with self.assertRaises(AssertionError):
                    self.assert_cold_refusal(rc, output.getvalue(), errors.getvalue())

    def test_kira_cli_early_refusal_keeps_execution_scope(self):
        with tempfile.TemporaryDirectory(prefix="diamond-check18-") as tmp:
            p = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/verify-kira-evidence.py"),
                "--record", str(Path(tmp) / "absent.json"), "--receipt", str(FIXTURE / "receipt-1.json"),
                "--log", str(FIXTURE / "aura.jsonl"), "--anchor", str(FIXTURE / "issuer.pem"), "--json"],
                cwd=tmp, env={"PATH": os.defpath, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True, text=True, timeout=30)
        self.assertNotEqual(p.returncode, 0)
        data = json.loads(p.stdout.split("REPORT-JSON-BEGIN\n",1)[1].split("\nREPORT-JSON-END",1)[0])
        self.assert_unestablished(data)


if __name__ == "__main__":
    unittest.main()
