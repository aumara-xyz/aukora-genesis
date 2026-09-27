"""Synthetic Alpha-wire rotation controls; no actual-producer fixture verified.

Disposable deterministic test seeds use Diamond's existing signing helper.
Fixture encoding is independently constructed here, never via the new consumer.
No operational key, Alpha runtime, subprocess, file write, or network is used.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond.ed25519 import public_from_seed, sign

spec = importlib.util.spec_from_file_location("legacy_keychain", ROOT / "profiles/alpha/legacy/keychain.py")
keychain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keychain)


def fixture_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def public_jwk(index):
    seed = bytes([index + 1]) * 32
    return {"kty": "OKP", "crv": "Ed25519", "kid": "ep" + str(index),
            "x": base64.urlsafe_b64encode(public_from_seed(seed)).decode().rstrip("=")}


def fixture_chain(count):
    keys = {"ep" + str(index): public_jwk(index) for index in range(count + 1)}
    rotations = []
    for epoch in range(1, count + 1):
        old, new = "ep" + str(epoch - 1), "ep" + str(epoch)
        body = {"type": "key-rotation", "oldKid": old, "oldPubDigest": hashlib.sha256(fixture_bytes(keys[old])).hexdigest(),
                "newKid": new, "newPubDigest": hashlib.sha256(fixture_bytes(keys[new])).hexdigest(),
                "subject": "a" * 40, "epoch": epoch, "notBefore": 1000 + epoch,
                "domain": "aukora:key-rotation:v1"}
        rotations.append(dict(body, sig=base64.b64encode(sign(bytes([epoch]) * 32, fixture_bytes(body))).decode()))
    active = {"kid": "ep" + str(count), "epoch": count, "pub": "ep" + str(count) + ".pub", "notBefore": 1000 + count}
    return keys["ep0"], active, keys, rotations


class KeychainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.one = fixture_chain(1)
        cls.twelve = fixture_chain(12)

    def setUp(self):
        self.root, self.active, self.keys, self.rotations = copy.deepcopy(self.one)
        self.root = copy.deepcopy(self.root)  # The caller's anchor is a separate input.

    def validate(self):
        return keychain.validate_keychain(self.root, self.active, self.keys, self.rotations)

    def refused(self, code):
        with self.assertRaisesRegex(ValueError, "^alpha-keychain:" + code + "$" ):
            self.validate()

    def test_single_caller_root_and_epoch_zero_pointer(self):
        for keys in ({}, {self.root["kid"]: self.root}):
            result = keychain.validate_keychain(self.root, None, keys, [])
            self.assertEqual((result["active_kid"], result["epoch"], result["mode"]), ("ep0", 0, "legacy"))
        for name in ("ep0.pub", "issuer-ed25519.pub"):
            result = keychain.validate_keychain(self.root, {"kid": "ep0", "epoch": 0, "pub": name, "notBefore": 0}, {}, [])
            self.assertEqual(result["epoch"], 0)

    def test_normal_rotation_and_detached_output(self):
        before = copy.deepcopy((self.root, self.active, self.keys, self.rotations))
        result = self.validate()
        self.assertEqual((result["active_kid"], result["epoch"]), ("ep1", 1))
        self.assertEqual(result["pubs"]["ep1"]["bytes"], public_from_seed(bytes([2]) * 32))
        self.assertEqual(set(result["limits"].values()), {"NOT_ESTABLISHED"})
        result["pubs"]["ep0"]["jwk"]["kid"] = "changed"
        self.assertEqual((self.root, self.active, self.keys, self.rotations), before)
        del self.keys["ep0"]
        self.assertEqual(self.validate()["active_kid"], "ep1")

    def test_twelve_rotations_ordered_by_signed_epoch(self):
        root, active, keys, rotations = copy.deepcopy(self.twelve)
        result = keychain.validate_keychain(root, active, keys, list(reversed(rotations)))
        self.assertEqual(result["epoch"], 12)
        self.assertEqual(len(result["pubs"]), 13)

    def test_separate_root_cannot_be_replaced_by_keyset(self):
        self.root["x"] = public_jwk(3)["x"]
        self.refused("root-key-mismatch")
        del self.keys["ep0"]
        self.refused("rotation-key-digest-mismatch")

    def test_missing_and_ambiguous_supplied_keys(self):
        del self.keys["ep1"]
        self.refused("key-unavailable")
        self.keys = copy.deepcopy(self.one[2])
        self.keys["ep3"] = public_jwk(3)
        self.refused("unused-public-key")

    def test_key_ids_and_private_fields_refuse(self):
        self.keys["ep1"]["kid"] = "ep2"
        self.refused("public-key-map-mismatch")
        self.keys = copy.deepcopy(self.one[2])
        self.keys["ep1"]["d"] = "PRIVATE_FIELD_NOT_ACCEPTED"
        self.refused("public-key-fields")

    def test_epoch_duplicates_and_gaps(self):
        self.rotations.append(copy.deepcopy(self.rotations[0]))
        self.refused("rotation-epoch")
        self.rotations = copy.deepcopy(self.one[3])
        self.rotations[0]["epoch"] = 2
        self.refused("rotation-epoch")

    def test_predecessor_and_reused_id(self):
        self.rotations[0]["oldKid"] = "other"
        self.refused("rotation-predecessor")
        self.rotations = copy.deepcopy(self.one[3])
        self.rotations[0]["newKid"] = "ep0"
        self.refused("rotation-key-reused")

    def test_digest_and_signature_integrity(self):
        self.rotations[0]["newPubDigest"] = "0" * 64
        self.refused("rotation-key-digest-mismatch")
        self.rotations = copy.deepcopy(self.one[3])
        self.rotations[0]["subject"] = "b" * 40
        self.refused("rotation-signature-invalid")

    def test_active_pointer_binding(self):
        self.active = None
        self.refused("active-missing-with-history")
        for field, value, code in (("pub", "ep0.pub", "active-pub-mismatch"),
                                   ("kid", "other", "active-pub-mismatch"),
                                   ("epoch", 0, "active-tip-mismatch"),
                                   ("notBefore", 0, "active-time-mismatch")):
            self.active = copy.deepcopy(self.one[1])
            self.active[field] = value
            self.refused(code)

    def test_exact_fields_and_domain(self):
        self.rotations[0]["extra"] = "unsupported"
        self.refused("rotation-fields")
        self.rotations = copy.deepcopy(self.one[3])
        self.rotations[0]["domain"] = "aukora:evidence:v1"
        self.refused("rotation-domain")
        self.rotations = copy.deepcopy(self.one[3])
        self.active["extra"] = "unsupported"
        self.refused("active-fields")

    def test_numbers_and_malformed_supplied_data(self):
        for field, reason in (("epoch", "rotation-epoch"), ("notBefore", "rotation-time")):
            for value in (-1, True, 1.0, 2**53, None):
                self.rotations = copy.deepcopy(self.one[3])
                self.rotations[0][field] = value
                self.refused(reason)
        for value in (None, [], "keys"):
            with self.assertRaisesRegex(ValueError, "alpha-keychain:public-keys-shape"):
                keychain.validate_keychain(self.root, None, value, [])
        for value in (None, {}, "rotations"):
            with self.assertRaisesRegex(ValueError, "alpha-keychain:rotations-shape"):
                keychain.validate_keychain(self.root, None, {}, value)
        self.rotations = copy.deepcopy(self.one[3])
        self.rotations[0]["sig"] = "bad"
        self.refused("rotation-signature-encoding")


if __name__ == "__main__":
    unittest.main()
