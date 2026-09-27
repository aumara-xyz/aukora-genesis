"""Cold Kira integer-profile controls; no producer or live store is run.

Run: python3 -B tests/continuity-spine/test_kira_numbers.py

Synthetic records below use ASCII keys and an independently assembled JSON preimage.
Decimal variants are deliberately unsupported inputs, not producer fixtures or an
implementation of ECMAScript numbers. Committed producer receipts separately anchor
the existing v0 acceptance behavior. Every CLI arm runs from disposable empty cwd.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
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

CLI = ROOT / "scripts/verify-kira-evidence.py"
LEGACY = ROOT / "tests/kira-evidence/evidence"
SEED = bytes(range(32))  # Public synthetic test key; no owner identity or presence.
ANCHOR = public_from_seed(SEED)


def fixture_json(value):
    """ASCII-key fixture spelling only; never used by the consumer."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class KiraNumbers(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="diamond-kira-numbers-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.neutral = self.root / "empty-cwd"
        self.neutral.mkdir()

    def evidence(self, content):
        identity = {
            "domain": "aukora:kira-memory-record:v0", "grantsAuthority": False,
            "subject": "synthetic-number-control", "kind": "observation", "source": [],
            "content": content, "links": [], "privacy": "local",
            "createdAt": "2026-09-21T00:00:00Z",
        }
        record = {**identity, "recordId": "kira:" + digest(identity["domain"] + "\0" + fixture_json(identity))}
        content_digest = digest(fixture_json({"key": record["recordId"], "value": record}) + "\n")
        entry = {"verdict": "settled", "key": record["recordId"],
                 "contentSha256": content_digest, "operation": "memory.put", "sequence": 1,
                 "prev": "aukora:aura-record:v1"}
        entry["hash"] = digest(fixture_json({**entry, "domain": "aukora:aura-record:v1"}))
        body = {"kind": "aukora-kira-memory-receipt/v1", "operation": "memory.put",
                "recordId": record["recordId"], "effectDigest": content_digest,
                "nonce": "synthetic-number-control", "issuedAt": 1790000000,
                "aura": {"entryHash": entry["hash"], "head": entry["hash"], "seq": 1,
                         "priorHead": None}}
        receipt = {**body, "issuerPk": ANCHOR.hex(),
                   "sig": sign(SEED, (body["kind"] + "\n" + fixture_json(body)).encode()).hex()}
        wrapper = {"record": {"recordId": record["recordId"], "digest": digest(fixture_json(record)),
                              "domain": record["domain"]}}
        self.log = self.root / "aura.jsonl"
        self.log.write_text(json.dumps(entry, separators=(",", ":")) + "\n", encoding="utf-8")
        return record, receipt, wrapper

    def verify(self, record, receipt, wrapper):
        return ke.verify_evidence(record_document=record, receipt_document=receipt,
                                  log_path=self.log, anchor_raw=ANCHOR, wrapper=wrapper)

    def cli(self, record, receipt, wrapper, *args):
        for name, value in (("record", record), ("receipt", receipt), ("wrapper", wrapper)):
            (self.root / (name + ".json")).write_text(json.dumps(value), encoding="utf-8")
        (self.root / "issuer.pk").write_text(ANCHOR.hex(), encoding="utf-8")
        command = [sys.executable, "-B", str(CLI), "--package-root", str(ROOT),
                   "--record", str(self.root / "record.json"),
                   "--receipt", str(self.root / "receipt.json"), "--log", str(self.log),
                   "--anchor", str(self.root / "issuer.pk"), "--json"]
        if wrapper is not None:
            command.extend(["--wrapper", str(self.root / "wrapper.json")])
        result = subprocess.run(command + list(args), cwd=self.neutral, capture_output=True,
                                text=True, timeout=30,
                                env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertNotIn("Traceback", result.stdout + result.stderr)
        self.assertIn("REPORT-JSON-BEGIN", result.stdout, result.stdout + result.stderr)
        report = json.loads(result.stdout.split("REPORT-JSON-BEGIN\n", 1)[1]
                            .split("\nREPORT-JSON-END", 1)[0])
        return result, report

    def assert_unsupported(self, report):
        self.assertFalse(report["verified"])
        self.assertEqual(report["status"], "UNSUPPORTED")
        self.assertEqual(report["refusal"]["code"], "UNSUPPORTED_NUMBER")
        self.assertIsNone(report["record"])
        self.assertIsNone(report["receipt"])
        self.assertIsNone(report["position"])
        self.assertEqual(report["approval"]["status"], "OWNER_APPROVAL_UNCHECKED")
        self.assertEqual(report["execution"]["status"], "NOT_ESTABLISHED")
        self.assertEqual(report["authorityScope"]["mode"], "mode-unbound")
        self.assertEqual(report["authorityScope"]["operatorPresence"], "NOT_ESTABLISHED")
        self.assertEqual(report["attendance"], "reported-not-proven")
        self.assertTrue(report["ceilings"])

    def test_integer_and_string_decimal_records_still_verify(self):
        for content in ({"values": [0, 7, -3, 9007199254740991, True, None]},
                        {"values": ["0.25", "1.0", "-0.0", "1e-7"]}):
            with self.subTest(content=content):
                evidence = self.evidence(content)
                report = self.verify(*evidence)
                self.assertTrue(report["verified"], report["refusal"])
                self.assertEqual(report["status"], "VERIFIED")
                self.assertEqual(report["receiptProfile"], "legacy-no-approval")
                self.assertTrue(ke.cross_check_wrapper(evidence[2], evidence[0], evidence[1])["agrees"])
                result, report = self.cli(*evidence)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(report["verdict"], "verified")

    def test_committed_v0_receipts_remain_accepted(self):
        record = json.loads((LEGACY / "fixture/record.json").read_text())
        for number in (1, 2):
            with self.subTest(receipt=number):
                receipt = json.loads((LEGACY / f"receipt-{number}.json").read_text())
                report = ke.verify_evidence(record_document=record, receipt_document=receipt,
                    log_path=LEGACY / "aura.jsonl", store=LEGACY,
                    anchor_raw=ke.raw_public_key_bytes((LEGACY / "issuer.pk").read_text()))
                self.assertTrue(report["verified"], report["refusal"])
                self.assertEqual(report["receiptProfile"], "legacy-no-approval")

    def test_decimal_spellings_are_unsupported_with_and_without_wrapper(self):
        for token in ("0.25", "1.0", "-0.0", "1e-7", "1e300"):
            with self.subTest(token=token):
                record, receipt, wrapper = self.evidence({"value": json.loads(token)})
                self.assert_unsupported(self.verify(record, receipt, wrapper))
                for supplied_wrapper in (wrapper, None):
                    result, report = self.cli(record, receipt, supplied_wrapper)
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    self.assert_unsupported(report)
                    self.assertEqual(report["verdict"], "UNSUPPORTED_NUMBER")
                    self.assertIn("VERDICT: UNSUPPORTED  UNSUPPORTED_NUMBER", result.stdout)
                    self.assertIn("NOT REACHED", result.stdout)
                    cross = report["wrapperCrossCheck"]
                    self.assertIsNone(cross["agrees"])
                    if supplied_wrapper is not None:
                        self.assertEqual(cross["status"], "UNSUPPORTED")
                        self.assertEqual(cross["refusal"]["code"], "UNSUPPORTED_NUMBER")
                        self.assertIsNone(cross["recomputedDigest"])

    def test_named_unsupported_expectation_is_assertable(self):
        result, report = self.cli(*self.evidence({"value": 0.25}), "--expect", "UNSUPPORTED_NUMBER")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_unsupported(report)
        self.assertIn("EXPECTATION: UNSUPPORTED_NUMBER OBSERVED", result.stdout)

    def test_integers_outside_ecmascript_safe_range_are_unsupported(self):
        for value in (9007199254740992, -9007199254740992, 10 ** 50):
            with self.subTest(value=value):
                args = self.evidence({"value": value})
                result, report = self.cli(*args)
                self.assertEqual(result.returncode, 1)
                self.assert_unsupported(report)

    def test_nested_decimal_in_every_open_record_field_is_unsupported(self):
        original, receipt, wrapper = self.evidence({"value": 1})
        for field, value in (("content", {"nested": [{"value": 0.25}]}),
                             ("links", [0.25]), ("source", [{"weight": 0.25}]),
                             ("transform", {"ratio": 0.25})):
            with self.subTest(field=field):
                record = deepcopy(original)
                record[field] = value
                self.assert_unsupported(self.verify(record, receipt, wrapper))
                cross = ke.cross_check_wrapper(wrapper, record, receipt)
                self.assertIsNone(cross["agrees"])
                self.assertEqual(cross["refusal"]["code"], "UNSUPPORTED_NUMBER")

    def test_supported_record_mutations_still_fail_identity(self):
        for value, changed in ((1, 2), ("0.25", "0.26")):
            with self.subTest(value=value):
                record, receipt, wrapper = self.evidence({"value": value})
                record["content"]["value"] = changed
                result, report = self.cli(record, receipt, wrapper)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(report["refusal"]["code"], "record-identity-mismatch")
                self.assertFalse(report["wrapperCrossCheck"]["agrees"])

    def test_decimal_string_cannot_be_coerced_to_a_number(self):
        record, receipt, wrapper = self.evidence({"value": "0.25"})
        record["content"]["value"] = 0.25
        self.assert_unsupported(self.verify(record, receipt, wrapper))
        with self.assertRaises(ke.Refusal) as caught:
            ke.record_digest(record)
        self.assertEqual(caught.exception.code, "UNSUPPORTED_NUMBER")

    def test_supported_receipt_mutation_still_fails_signature(self):
        record, receipt, wrapper = self.evidence({"value": "0.25"})
        receipt["issuedAt"] += 1
        result, report = self.cli(record, receipt, wrapper)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["refusal"]["code"], "signature-invalid")

    def test_guessing_a_number_spelling_breaks_the_rejection_assertion(self):
        evidence = self.evidence({"value": 0.25})
        self.assert_unsupported(self.verify(*evidence))
        # A canonicalizer mutation that guesses Python JSON number bytes makes this
        # synthetic receipt verify. The acceptance assertion must reject that mutant.
        with patch.object(ke, "jcs", side_effect=fixture_json):
            mutant = self.verify(*evidence)
        self.assertTrue(mutant["verified"], mutant["refusal"])
        with self.assertRaises(AssertionError):
            self.assert_unsupported(mutant)


if __name__ == "__main__":
    unittest.main(verbosity=2)
