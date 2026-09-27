#!/usr/bin/env python3
"""Historical producer fixture and ordinary cold-consumer integrity controls."""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SCRIPT = ROOT / "scripts/verify-alpha-freeze.py"
spec = importlib.util.spec_from_file_location("alpha_freeze", SCRIPT)
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)
MANIFEST = (FIXTURES / "freeze.json").read_bytes()
PUBLIC = (FIXTURES / "issuer-public.jwk").read_bytes()
PROVENANCE = json.loads((FIXTURES / "PROVENANCE.json").read_text())
SUBJECT = "eff6deb1f07b69526e20d980482c5611b126ca9a"
TREE = "cf98537df6ba0a5f9ff12c63011870d5f3b0298d"
CEILINGS = ("HUMAN_ATTENDANCE", "MODEL_EXECUTION", "CONFINEMENT", "SOURCE_EXECUTION",
            "COURTS_RERUN", "SOURCE_TREE_CONTENT", "KEY_ROTATION_CONTINUITY")


class FreezeTests(unittest.TestCase):
    def verify(self, manifest=MANIFEST, public=PUBLIC, subject=SUBJECT, tree=TREE):
        return consumer.verify_statement(manifest, public, subject=subject, tree=tree)

    def changed(self, **values):
        document = json.loads(MANIFEST)
        document.update(values)
        return json.dumps(document).encode()

    def refused(self, code, **arguments):
        with self.assertRaisesRegex(consumer.Refusal, "^" + code + "$", msg=arguments.keys()):
            self.verify(**arguments)

    def test_verbatim_fixture_pins_and_public_only_key(self):
        self.assertEqual(PROVENANCE["commit"], "ddb6a9cc9860fce840283b0010e24e7d627fa9db")
        self.assertEqual((PROVENANCE["subject"], PROVENANCE["tree"]), (SUBJECT, TREE))
        self.assertEqual(len(PROVENANCE["files"]), 2)
        for entry in PROVENANCE["files"]:
            raw = (FIXTURES / entry["path"]).read_bytes()
            self.assertEqual(len(raw), entry["bytes"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), entry["sha256"])
            self.assertEqual(hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest(), entry["gitBlob"])
        self.assertEqual(set(json.loads(PUBLIC)), {"kty", "crv", "kid", "x"})

    def test_actual_historical_producer_signature(self):
        body = self.verify()
        self.assertEqual(body["courtCount"], 47)
        self.assertEqual(body["testCount"], 202)
        self.assertEqual(body["attended"], "UNRUN")

    def test_manifest_layout_is_not_signed_but_key_file_bytes_are(self):
        document = dict(reversed(list(json.loads(MANIFEST).items())))
        self.verify(json.dumps(document, indent=4).encode())
        self.refused("PUBLIC_KEY_FILE_DIGEST_MISMATCH", public=PUBLIC + b"\n")

    def test_signed_count_change_refuses(self):
        self.refused("FREEZE_SIGNATURE_INVALID", manifest=self.changed(testCount=203))

    def test_signature_byte_change_refuses(self):
        signature = bytearray(base64.b64decode(json.loads(MANIFEST)["signature"]))
        signature[0] ^= 1
        self.refused("FREEZE_SIGNATURE_INVALID", manifest=self.changed(signature=base64.b64encode(signature).decode()))

    def test_separate_expected_subject_and_tree_are_required(self):
        self.refused("FREEZE_SUBJECT_MISMATCH", subject="0" * 40)
        self.refused("FREEZE_TREE_MISMATCH", tree="0" * 40)
        for value in (None, "", "bad", 42):
            self.refused("EXPECTED_SUBJECT_REQUIRED", subject=value)
            self.refused("EXPECTED_TREE_REQUIRED", tree=value)

    def test_public_key_identity_and_shape(self):
        for updates, code in (({"x": "A" * 43}, "PUBLIC_KEY_FILE_DIGEST_MISMATCH"),
                              ({"kid": "ep2"}, "PUBLIC_KEY_KID_MISMATCH"),
                              ({"crv": "Other"}, "PUBLIC_KEY_TYPE"),
                              ({"d": "not-accepted"}, "PUBLIC_KEY_FIELDS"),
                              ({"x": "=" * 43}, "PUBLIC_KEY_ENCODING")):
            with self.subTest(updates=updates):
                self.refused(code, public=json.dumps(dict(json.loads(PUBLIC), **updates)).encode())

    def test_closed_manifest_and_nested_fields(self):
        self.refused("FREEZE_FIELDS", manifest=self.changed(extra="unrecognized"))
        document = json.loads(MANIFEST)
        del document["signature"]
        self.refused("FREEZE_FIELDS", manifest=json.dumps(document).encode())
        for raw in (b"null", b"[]", b"true"):
            self.refused("FREEZE_FIELDS", manifest=raw)
        self.refused("FREEZE_PLATFORM_CLAIMS", manifest=self.changed(platformClaims={"seatbelt": "DARWIN_ONLY", "extra": 1}))

    def test_kind_domain_and_label_refusals(self):
        for field, value, code in (("kind", "other", "FREEZE_KIND"),
                                  ("domain", "other", "FREEZE_DOMAIN"),
                                  ("attended", "YES", "FREEZE_ATTENDED_LABEL"),
                                  ("liveModel", "PASS", "FREEZE_MODEL_LABEL"),
                                  ("kid", "é", "FREEZE_KID_UNSUPPORTED"),
                                  ("unexpected", 1, "FREEZE_UNEXPECTED_NONZERO")):
            self.refused(code, manifest=self.changed(**{field: value}))

    def test_nonnegative_safe_integer_subset(self):
        for field in ("courtCount", "testCount", "unexpected", "createdAt"):
            for value in (True, -1, 2**53, None, "47"):
                with self.subTest(field=field, value=value):
                    self.refused("FREEZE_NUMBER_RANGE", manifest=self.changed(**{field: value}))
        for value in (47.0, float("nan"), float("inf")):
            self.refused("JSON_UNSUPPORTED_NUMBER", manifest=self.changed(courtCount=value))

    def test_duplicate_and_malformed_json(self):
        self.refused("JSON_DUPLICATE_KEY", manifest=MANIFEST.replace(b'"kind":', b'"kind": "other", "kind":', 1))
        self.refused("JSON_DUPLICATE_KEY", public=PUBLIC.replace(b'"kid":', b'"kid":"other","kid":', 1))
        self.refused("JSON_DUPLICATE_KEY", manifest=self.changed(platformClaims={"seatbelt": "DARWIN_ONLY"}).replace(b'"seatbelt":', b'"seatbelt":"other","seatbelt":', 1))
        for raw in (b"{", b"\xff", b"{} trailing"):
            self.refused("JSON_MALFORMED", manifest=raw)
        self.refused("FREEZE_SIGNATURE_ENCODING", manifest=self.changed(signature="bad"))

    def run_cli(self, arguments):
        with tempfile.TemporaryDirectory(prefix="alpha-freeze-cold-") as directory:
            result = subprocess.run([sys.executable, "-B", str(SCRIPT), *arguments], cwd=directory,
                                    env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
                                    capture_output=True, text=True)
            self.assertEqual(list(Path(directory).iterdir()), [])
        for ceiling in CEILINGS:
            self.assertIn(ceiling + ": NOT_ESTABLISHED", result.stdout)
        return result

    def test_real_cli_from_empty_cwd(self):
        result = self.run_cli([str(FIXTURES / "freeze.json"), "--pub", str(FIXTURES / "issuer-public.jwk"),
                               "--subject", SUBJECT, "--tree", TREE])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SIGNED_SOURCE_STATEMENT_VALID", result.stdout)

    def test_cli_refusals_and_help_keep_nonclaims(self):
        complete = [str(FIXTURES / "freeze.json"), "--pub", str(FIXTURES / "issuer-public.jwk"),
                    "--subject", SUBJECT, "--tree", TREE]
        for arguments in ([], complete[:-2], complete[:3], complete[:-1] + ["0" * 40],
                          [str(FIXTURES / "missing.json"), *complete[1:]]):
            result = self.run_cli(arguments)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("REFUSED:", result.stderr)
            self.assertNotIn("SIGNED_SOURCE_STATEMENT_VALID", result.stdout)
        self.assertEqual(self.run_cli(["--help"]).returncode, 0)


if __name__ == "__main__":
    unittest.main()
