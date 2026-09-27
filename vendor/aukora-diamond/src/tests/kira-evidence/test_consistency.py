"""Defensive input controls using producer fixtures and fixed public vectors.

Position checks exercise supplied-data relationships directly; no contradictory
receipt is signed and no producer or operational store is run.
"""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond import kira_evidence as ke

FIXTURE = ROOT / "tests/kira-artifact/fixtures"


class ContentBindingTests(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((FIXTURE / "content-1.txt").read_text())["value"]
        self.receipt = json.loads((FIXTURE / "receipt-1.json").read_text())
        self.entries = ke.read_log(FIXTURE / "aura.jsonl")

    def test_producer_receipt_log_record_match_with_and_without_store(self):
        anchor = ke.raw_public_key_bytes((FIXTURE / "issuer.pem").read_text())
        for store in (None, FIXTURE):
            with self.subTest(store=store):
                result = ke.verify_evidence(record_document=self.record,
                    receipt_document=self.receipt, log_path=FIXTURE / "aura.jsonl",
                    anchor_raw=anchor, store=store)
                self.assertTrue(result["verified"], result["refusal"])

    def test_receipt_digest_must_match_log_in_both_store_modes(self):
        receipt = {**self.receipt, "effectDigest": "0" * 64}
        for store in (None, FIXTURE):
            with self.subTest(store=store), self.assertRaisesRegex(
                    ke.Refusal, "effect-digest-mismatch"):
                ke.check_position(receipt, self.entries, store=store, record=self.record)

    def test_record_digest_must_match_before_optional_store_read(self):
        record = {**self.record, "content": {"note": "different ordinary content"}}
        for store in (None, FIXTURE):
            with self.subTest(store=store), self.assertRaisesRegex(
                    ke.Refusal, "effect-digest-mismatch"):
                ke.check_position(self.receipt, self.entries, store=store, record=record)

    def test_retained_receipt_also_binds_its_log_content_digest(self):
        receipt = {**self.receipt, "effectDigest": "0" * 64}
        with self.assertRaisesRegex(ke.Refusal, "effect-digest-mismatch"):
            ke.check_position(receipt, self.entries)


class PointValidationTests(unittest.TestCase):
    def test_official_rfc8032_empty_message_vector(self):
        public = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        signature = bytes.fromhex(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        self.assertTrue(ke.ed25519_verify(public, b"", signature))
        self.assertFalse(ke.ed25519_verify(public, b"different message", signature))

    def test_noncanonical_coordinate_and_sign_are_refused(self):
        for encoded in (ke._P.to_bytes(32, "little"),
                        (ke._P + 1).to_bytes(32, "little"),
                        (1 | (1 << 255)).to_bytes(32, "little")):
            with self.subTest(encoded=encoded.hex()), self.assertRaisesRegex(
                    ke.Refusal, "ed25519-point-encoding"):
                ke._decompress(encoded)

    def test_small_order_points_are_refused(self):
        for coordinate in (0, 1, ke._P - 1):
            with self.subTest(coordinate=coordinate), self.assertRaisesRegex(
                    ke.Refusal, "ed25519-small-order"):
                ke._decompress(coordinate.to_bytes(32, "little"))

    def test_decoder_requires_exact_bytes(self):
        for value in (None, "", b"", bytes(31), bytes(33)):
            with self.subTest(value=value), self.assertRaisesRegex(
                    ke.Refusal, "ed25519-point-encoding"):
                ke._decompress(value)


if __name__ == "__main__":
    unittest.main()
