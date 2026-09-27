"""Approval labels cannot become human-presence evidence in a cold consumer.

Positive evidence is the committed Genesis producer output. Re-signed variants
below are explicitly adversarial receipts under a disposable key, not newly
claimed producer evidence. No Node producer, live store, or sandbox is run.
"""
from __future__ import annotations

from copy import deepcopy
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
from diamond.ed25519 import public_from_seed, sign
from diamond.receipt import ReceiptError, verify_receipt

CURRENT = ROOT / "tests/kira-artifact/fixtures"
LEGACY = ROOT / "tests/kira-evidence/evidence"


class AuthorityMode(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((CURRENT / "content-1.txt").read_text())["value"]
        self.receipt = json.loads((CURRENT / "receipt-1.json").read_text())
        self.anchor = ke.raw_public_key_bytes((CURRENT / "issuer.pem").read_text())

    def verify(self, **changes):
        args = dict(record_document=self.record, receipt_document=self.receipt,
                    log_path=CURRENT / "aura.jsonl", anchor_raw=self.anchor, store=CURRENT)
        args.update(changes)
        return ke.verify_evidence(**args)

    def assert_honest(self, report, mode):
        self.assertEqual(report["authorityScope"]["mode"], mode)
        self.assertEqual(report["authorityScope"]["operatorPresence"], "NOT_ESTABLISHED")
        self.assertEqual(report["authorityScope"]["attendance"], "reported-not-proven")
        self.assertEqual(report["approval"]["status"], "OWNER_APPROVAL_UNCHECKED")

    def signed_class_variant(self, value):
        receipt = deepcopy(self.receipt)
        receipt["approval"]["approvalClass"] = value
        seed = bytes(range(32))  # public, disposable adversarial-test key only
        anchor = public_from_seed(seed)
        receipt["issuerPk"] = anchor.hex()
        body = {k: v for k, v in receipt.items() if k not in ("sig", "issuerPk")}
        message = (receipt["kind"] + "\n").encode() + ke.jcs_bytes(body)
        receipt["sig"] = sign(seed, message).hex()
        self.assertTrue(ke.ed25519_verify(anchor, message, bytes.fromhex(receipt["sig"])))
        return receipt, anchor

    def test_both_current_producer_receipts_stay_scripted_reported(self):
        for index in (1, 2):
            with self.subTest(index=index):
                receipt = json.loads((CURRENT / f"receipt-{index}.json").read_text())
                record = json.loads((CURRENT / f"content-{index}.txt").read_text())["value"]
                report = self.verify(record_document=record, receipt_document=receipt)
                self.assertTrue(report["verified"], report["refusal"])
                self.assert_honest(report, "scripted-reported")

    def test_both_legacy_producer_receipts_stay_mode_unbound(self):
        for index in (1, 2):
            with self.subTest(index=index):
                receipt = json.loads((LEGACY / f"receipt-{index}.json").read_text())
                record = json.loads((LEGACY / "objects" / (receipt["effectDigest"] + ".json")).read_text())["value"]
                report = self.verify(record_document=record, receipt_document=receipt,
                    log_path=LEGACY / "aura.jsonl", store=LEGACY,
                    anchor_raw=ke.raw_public_key_bytes((LEGACY / "issuer.pk").read_text()))
                self.assertTrue(report["verified"], report["refusal"])
                self.assert_honest(report, "mode-unbound")

    def test_supported_classes_remain_labels_even_under_a_valid_signature(self):
        for value in ("scripted", "delegated", "unattributed"):
            with self.subTest(value=value):
                receipt, anchor = self.signed_class_variant(value)
                report = self.verify(receipt_document=receipt, anchor_raw=anchor)
                self.assertTrue(report["verified"], report["refusal"])
                self.assert_honest(report, value + "-reported")

    def test_signed_human_ceremony_is_refused_without_requiring_an_artifact(self):
        receipt, anchor = self.signed_class_variant("human-ceremony")
        report = self.verify(receipt_document=receipt, anchor_raw=anchor)
        self.assertFalse(report["verified"])
        self.assertEqual(report["refusal"]["code"], "APPROVAL_CLASS_UNSUPPORTED")
        self.assert_honest(report, "mode-unbound")

    def test_removing_class_guard_exposes_the_actual_acceptance_gap(self):
        receipt, anchor = self.signed_class_variant("human-ceremony")
        with patch.object(ke, "_check_receipt_approval_class", return_value=None):
            broken = self.verify(receipt_document=receipt, anchor_raw=anchor)
        self.assertTrue(broken["verified"], broken["refusal"])
        # The same acceptance assertion is red when the invariant is removed.
        with self.assertRaises(AssertionError):
            self.assertFalse(broken["verified"])

    def test_present_invalid_class_is_refused_instead_of_treated_as_absent(self):
        for value in ("human-approved", "OPERATOR_PRESENCE_MEASURED", "future", "", 1, None, {}):
            with self.subTest(value=value):
                receipt, anchor = self.signed_class_variant(value)
                report = self.verify(receipt_document=receipt, anchor_raw=anchor)
                self.assertFalse(report["verified"])
                self.assertEqual(report["refusal"]["code"], "receipt-approval-malformed")
                self.assert_honest(report, "mode-unbound")

    def test_absent_required_class_still_refuses(self):
        receipt = deepcopy(self.receipt)
        del receipt["approval"]["approvalClass"]
        report = self.verify(receipt_document=receipt)
        self.assertFalse(report["verified"])
        self.assertEqual(report["refusal"]["code"], "shape")
        self.assert_honest(report, "mode-unbound")

    def test_unsigned_wrapper_claims_and_prose_cannot_upgrade_or_break_evidence(self):
        wrapper = {"authority": "human-approved / one-use / time-bounded",
                   "operatorPresence": "OPERATOR_PRESENCE_MEASURED",
                   "approval": {"mode": "human-approved"},
                   "note": "Human approval is discussed here, not proven here."}
        report = self.verify(wrapper=wrapper)
        self.assertTrue(report["verified"], report["refusal"])
        self.assert_honest(report, "scripted-reported")

    def test_alpha_claim_fields_do_not_expand_either_receipt_wire(self):
        genesis = ROOT / "tests/genesis-minted"
        v3 = json.loads((genesis / "receipt.json").read_text())
        anchor = (genesis / "issuer.pk").read_text().strip()
        verify_receipt(v3, expect_pk=anchor)  # positive control for this exact fixture
        for claims in ({"authority": "human-approved / one-use / time-bounded"},
                       {"operatorPresence": "OPERATOR_PRESENCE_MEASURED"},
                       {"approvalMode": "human-approved"},
                       {"approval": {"mode": "scripted"},
                        "authority": "human-approved / one-use / time-bounded"}):
            with self.subTest(claims=claims):
                report = self.verify(receipt_document={**self.receipt, **claims})
                self.assertFalse(report["verified"])
                self.assertEqual(report["authorityScope"]["operatorPresence"], "NOT_ESTABLISHED")
                with self.assertRaises(ReceiptError):
                    verify_receipt({**v3, **claims}, expect_pk=anchor)

    def test_bad_signature_absent_anchor_and_report_mutation_never_claim_presence(self):
        for report in (self.verify(receipt_document={**self.receipt, "sig": "00" * 64}),
                       self.verify(anchor_raw=None)):
            self.assertFalse(report["verified"])
            self.assert_honest(report, "scripted-reported")
        report = self.verify()
        report["authorityScope"]["operatorPresence"] = "OPERATOR_PRESENCE_MEASURED"
        self.assert_honest(self.verify(), "scripted-reported")

    def test_false_presence_report_mutation_is_detected(self):
        false_scope = {**ke.authority_scope(self.receipt),
                       "operatorPresence": "OPERATOR_PRESENCE_MEASURED"}
        with patch.object(ke, "authority_scope", return_value=false_scope):
            broken = self.verify()
        self.assertTrue(broken["verified"])
        with self.assertRaises(AssertionError):
            self.assert_honest(broken, "scripted-reported")

    def run_cli(self, receipt=None, anchor=None, missing_record=False):
        with tempfile.TemporaryDirectory(prefix="diamond-authority-") as tmp:
            path = Path(tmp)
            record_path = path / "record.json"
            if not missing_record:
                record_path.write_text(json.dumps(self.record))
            receipt_path = path / "receipt.json"
            receipt_path.write_text(json.dumps(receipt or self.receipt))
            anchor_path = path / "issuer.pk"
            anchor_path.write_text((anchor or self.anchor).hex())
            result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/verify-kira-evidence.py"),
                "--record", str(record_path), "--receipt", str(receipt_path),
                "--log", str(CURRENT / "aura.jsonl"), "--anchor", str(anchor_path), "--json"],
                cwd=tmp, env={"PATH": os.defpath, "PYTHONPATH": str(ROOT),
                              "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True, text=True, timeout=30)
        report = json.loads(result.stdout.split("REPORT-JSON-BEGIN\n", 1)[1].split("\nREPORT-JSON-END", 1)[0])
        return result, report

    def test_kira_cli_success_and_signed_mode_refusal(self):
        result, report = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("AUTHORITY_MODE: scripted-reported", result.stdout)
        self.assertIn("OPERATOR_PRESENCE: NOT_ESTABLISHED", result.stdout)
        self.assert_honest(report, "scripted-reported")
        receipt, anchor = self.signed_class_variant("human-ceremony")
        result, report = self.run_cli(receipt, anchor)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report["refusal"]["code"], "APPROVAL_CLASS_UNSUPPORTED")
        self.assertIn("AUTHORITY_MODE: mode-unbound", result.stdout)
        self.assert_honest(report, "mode-unbound")

    def test_kira_cli_unreadable_input_keeps_honest_scope(self):
        result, report = self.run_cli(missing_record=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report["authorityScope"], ke.authority_scope())
        self.assertFalse(report["verified"])
        self.assertIsNone(report["approval"])  # input was unreadable; this facet never ran

    def test_cold_cli_reports_absent_mode_without_refusing_legitimate_receipt(self):
        with tempfile.TemporaryDirectory(prefix="diamond-authority-cold-") as tmp:
            result = subprocess.run([sys.executable, "-B", "-m", "diamond.cold_verify",
                str(ROOT / "tests/genesis-minted/receipt.json"), "--pub",
                str(ROOT / "tests/genesis-minted/issuer.pk")], cwd=tmp,
                env={"PATH": os.defpath, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("AUTHORITY_MODE: mode-unbound", result.stdout)
        self.assertIn("OPERATOR_PRESENCE: NOT_ESTABLISHED", result.stdout)
        self.assertIn("ATTENDANCE: reported-not-proven", result.stdout)


if __name__ == "__main__":
    unittest.main()
