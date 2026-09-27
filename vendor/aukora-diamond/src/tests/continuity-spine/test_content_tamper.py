"""The payload arm must test binding, not fail earlier on invalid JSON.

The committed producer fixture is the integration baseline. Other payload shapes
use explicitly synthetic approvals under a disposable test key; these exercise
the actual helper and verifier without claiming fresh producer evidence.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond import approval_artifact as approval
from diamond import kira_evidence as evidence
from diamond.ed25519 import public_from_seed, sign

FIXTURES = ROOT / "tests/kira-artifact/fixtures"
SPEC = importlib.util.spec_from_file_location(
    "content_tamper", ROOT / "tests/kira-artifact/content_tamper.py")
tamper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tamper)
SEED = bytes(range(32))  # Public, disposable synthetic-test key only.
ANCHOR = public_from_seed(SEED).hex()


class ContentTamper(unittest.TestCase):
    def setUp(self):
        self.content = (FIXTURES / "content-1.txt").read_bytes()
        self.artifact = json.loads((FIXTURES / "artifact-1.json").read_text())
        self.anchor = (FIXTURES / "approver.pk").read_text().strip()

    def synthetic_approval(self, payload):
        record = deepcopy(json.loads(self.content)["value"])
        record["content"] = payload
        record["recordId"] = evidence.compute_record_id(record)
        content = evidence.jcs_bytes({"key": record["recordId"], "value": record}) + b"\n"
        artifact = deepcopy(self.artifact)
        artifact["operationDigest"] = approval.operation_digest_of(content)
        artifact["approvalKeyDid"] = approval.did_key_from_raw(ANCHOR)
        signing_bytes = approval.signing_bytes(artifact)
        artifact["signature"] = sign(SEED, signing_bytes).hex()
        artifact["signedBytesDigest"] = hashlib.sha256(signing_bytes).hexdigest()
        return content, artifact, ANCHOR

    def verify(self, content, artifact, anchor, record):
        return approval.verify_artifact(artifact, anchor=anchor, content_bytes=content,
                                        record=record)

    def assert_binding_control(self, content, artifact, anchor):
        original = approval.read_content(content)
        honest = self.verify(content, artifact, anchor, original["value"])
        self.assertFalse(honest["fails_verification"], honest["refusal"])
        self.assertEqual(honest["signature"]["status"], approval.SIGNATURE_VALID)

        moved = tamper.tamper_content(content)
        findings = self.verify(moved, artifact, anchor, original["value"])
        self.assertTrue(findings["fails_verification"])
        # This is the PRIMARY refusal; finding a digest mismatch somewhere in a
        # malformed-content report would let the old invalid-JSON arm pass.
        self.assertEqual(findings["refusal"]["code"], approval.CONTENT_MISMATCH)
        self.assertEqual(approval.artifact_summary(findings)["status"], approval.CONTENT_MISMATCH)
        self.assertEqual(findings["signature"]["status"], approval.SIGNATURE_VALID)
        self.assertNotIn(approval.CONTENT_NOT_CANONICAL,
                         [item["code"] for item in findings["refusals"]])

        changed = approval.read_content(moved)
        self.assertNotEqual(moved, content)
        self.assertNotEqual(changed["value"]["content"], original["value"]["content"])
        self.assertEqual(changed["key"], original["key"])
        self.assertEqual({k: v for k, v in changed["value"].items() if k != "content"},
                         {k: v for k, v in original["value"].items() if k != "content"})
        self.assertEqual(moved, evidence.jcs_bytes(changed) + b"\n")
        self.assertEqual(tamper.tamper_content(content), moved)
        return findings

    def test_committed_producer_approval_is_valid_before_payload_change(self):
        self.assert_binding_control(self.content, self.artifact, self.anchor)

    def test_no_cedar_scalar_nested_and_unicode_payloads_refuse_for_binding(self):
        payloads = ({"note": "Oak endpoint"}, {}, [], "", "桜 🌳\n\t", 0, -7,
                    9007199254740991, True, False, None,
                    {"\ue000": [None, {"😀": "e\u0301", "é": "雪"}], "values": [1, False]})
        for payload in payloads:
            with self.subTest(payload=payload):
                inputs = self.synthetic_approval(payload)
                self.assertNotIn(b"Cedar", inputs[0])
                self.assert_binding_control(*inputs)

    def test_old_no_cedar_fallback_is_detected_as_the_wrong_refusal(self):
        inputs = self.synthetic_approval({"note": "Oak endpoint"})

        def old_mutation(content):
            return (content.replace(b"Cedar", b"Ced4r") if b"Cedar" in content
                    else content[:-2] + b"x\n")

        findings = self.verify(old_mutation(inputs[0]), inputs[1], inputs[2],
                               json.loads(inputs[0])["value"])
        self.assertEqual(findings["refusal"]["code"], approval.CONTENT_NOT_CANONICAL)
        # The old mutation still reports a later digest mismatch. Checking its
        # mere presence is insufficient; the binding assertion above must fail.
        self.assertIn(approval.CONTENT_MISMATCH, [r["code"] for r in findings["refusals"]])
        with patch.object(tamper, "tamper_content", old_mutation):
            with self.assertRaises(AssertionError):
                self.assert_binding_control(*inputs)

    def test_missing_payload_is_not_silently_repaired(self):
        document = json.loads(self.content)
        del document["value"]["content"]
        with self.assertRaisesRegex(ValueError, "must carry content"):
            tamper.tamper_content(evidence.jcs_bytes(document) + b"\n")


if __name__ == "__main__":
    unittest.main()
