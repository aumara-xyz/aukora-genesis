"""Cold-stranger controls over disposable, regenerable legacy toy fixtures.

The mint subprocess uses existing toy signing helpers, then deletes its own key
files and exits. Cold CLI subprocesses receive only public evidence and a copied
verifier, from an empty working directory without site packages. This is a
same-machine regression court, not custody, a sandbox, or a Genesis producer run.
Both receipt and signed-pair courts require an external expected key. The
explicit unsigned pair demo has separate, visibly unanchored controls.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Copy only the existing cold verifier dependency closure, not a producer/runtime.
PUBLIC_VERIFIER_FILES = (
    "diamond/__init__.py", "diamond/cold_verify.py", "diamond/receipt.py",
    "diamond/ed25519.py", "diamond/hexutil.py", "diamond/jcs.py",
    "diamond/refuse_codes.py", "diamond/checkpoint.py", "diamond/verify_pair.py",
    "vendor/phase0/verify.py",
)
PUBLIC_EVIDENCE_FILES = {
    "aura.jsonl", "issuer.pk", "receipt.json", "retained.json", "presented.json",
}


def mint_test_universes(destination: Path) -> None:
    """Test-only mint in a separate process; no private material reaches its caller."""
    from diamond.aura import Aura
    from diamond.checkpoint import sign_checkpoint
    from diamond.ed25519 import keygen
    from diamond.hexutil import sha256_hex, write_json, write_secret
    from diamond.receipt import KIND_FIXTURE, issue

    for label in ("honest", "attacker"):
        out = destination / label
        out.mkdir()
        private = out / "issuer.sk"
        seed, public = keygen()
        write_secret(private, seed.hex() + "\n")
        try:
            seed = bytes.fromhex(private.read_text().strip())
            (out / "issuer.pk").write_text(public.hex() + "\n", encoding="utf-8")
            plugin_digest = sha256_hex((label + " toy fixture plugin\n").encode())
            nonce = sha256_hex((label + " toy fixture nonce").encode())
            subject_digest = sha256_hex((label + " toy fixture subject").encode())
            aura = Aura(out / "aura.jsonl")
            aura.append({"kind": "session-open"})
            aura.append({"kind": "plugin-staged", "pluginId": "stranger-fixture",
                         "pluginDigest": plugin_digest})
            aura.append({"kind": "work-stub", "echo": "ok"})
            # A 3 -> 4 proof is supported by the existing minimal Phase 0 court.
            retained = sign_checkpoint(aura.checkpoint(), seed=seed, signer_pk=public)
            write_json(out / "retained.json", retained)
            entry = aura.append({
                "kind": "composition", "operation": "load",
                "pluginId": "stranger-fixture", "pluginDigest": plugin_digest,
                "settlementNonce": nonce, "subjectDigest": subject_digest,
            })
            receipt = issue(
                seed=seed, issuer_pk=public, kind=KIND_FIXTURE,
                issued_at=1_789_551_177, nonce=nonce, aura=aura.entry_view(entry["seq"]),
                composition={
                    "coeffectEnvelopeDigest": sha256_hex(b"toy fixture envelope"),
                    "operation": "load", "pluginDigest": plugin_digest,
                    "pluginId": "stranger-fixture", "revertOf": "",
                },
            )
            write_json(out / "receipt.json", receipt)
            write_json(out / "presented.json", sign_checkpoint(
                aura.checkpoint(with_proof_from=retained["size"]),
                seed=seed, signer_pk=public,
            ))
        finally:
            # Only the private file this subprocess created is deleted.
            private.unlink()


def cli_environment(verifier: Path) -> dict[str, str]:
    return {"PATH": os.defpath, "PYTHONPATH": str(verifier),
            "PYTHONDONTWRITEBYTECODE": "1"}


class StrangerKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.scratch = tempfile.TemporaryDirectory(prefix="diamond-stranger-keys-")
        cls.addClassCleanup(cls.scratch.cleanup)
        cls.work = Path(cls.scratch.name)
        cls.evidence = cls.work / "public-evidence"
        cls.evidence.mkdir()
        cls.empty_cwd = cls.work / "empty-cwd"
        cls.empty_cwd.mkdir()
        cls.verifier = cls.work / "public-verifier"
        for relative in PUBLIC_VERIFIER_FILES:
            target = cls.verifier / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        minted = subprocess.run(
            [sys.executable, "-B", "-S", str(Path(__file__).resolve()),
             "--mint-test-universes", str(cls.evidence)],
            cwd=cls.empty_cwd, env=cli_environment(ROOT),
            capture_output=True, text=True, timeout=30,
        )
        if minted.returncode != 0:
            raise AssertionError(minted.stdout + minted.stderr)
        cls.cli_exits: list[tuple[str, int]] = []

    @classmethod
    def tearDownClass(cls) -> None:
        # Mutation arms deliberately accept; every normal refusal is 2.
        accepted = sum(code == 0 for _, code in cls.cli_exits)
        refused = sum(code == 2 for _, code in cls.cli_exits)
        mutants = sum("mutant" in label for label, _ in cls.cli_exits)
        print(f"STRANGER CLI ARMS: {len(cls.cli_exits)} "
              f"(exit 0: {accepted}; exit 2: {refused}; "
              f"includes {mutants} deliberately weakened verifier arms)")

    def setUp(self) -> None:
        self.assertEqual(list(self.empty_cwd.iterdir()), [])
        self.assertEqual(list(self.work.rglob("*.sk")), [])
        for label in ("honest", "attacker"):
            files = {p.name for p in (self.evidence / label).iterdir()}
            self.assertEqual(files, PUBLIC_EVIDENCE_FILES)
            for path in (self.evidence / label).iterdir():
                self.assertNotIn(b"PRIVATE KEY", path.read_bytes())
        copied = {str(p.relative_to(self.verifier)) for p in self.verifier.rglob("*")
                  if p.is_file()}
        self.assertEqual(copied, set(PUBLIC_VERIFIER_FILES))

    def cli(self, label: str, module: str, *arguments: object,
            verifier: Path | None = None) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, "-B", "-S", "-m", module, *map(str, arguments)],
            cwd=self.empty_cwd, env=cli_environment(verifier or self.verifier),
            capture_output=True, text=True, timeout=30,
        )
        self.cli_exits.append((label, result.returncode))
        self.assertEqual(list(self.empty_cwd.iterdir()), [])
        self.assertEqual(list(self.work.rglob("*.sk")), [])
        return result

    def cold(self, universe: str, *options: object,
             verifier: Path | None = None) -> subprocess.CompletedProcess[str]:
        label = f"cold-{universe}" + (f"-{verifier.name}" if verifier else "")
        return self.cli(label, "diamond.cold_verify",
                        self.evidence / universe / "receipt.json", *options,
                        verifier=verifier)

    def pair(self, universe: str, expected: str) -> subprocess.CompletedProcess[str]:
        evidence = self.evidence / universe
        return self.cli(f"pair-{universe}-anchor-{expected}", "diamond.verify_pair",
                        evidence / "retained.json", evidence / "presented.json",
                        "--pub", self.evidence / expected / "issuer.pk")

    def assert_accepted_receipt(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("SIGNATURE_VALID", result.stdout)
        self.assertIn("SIGNER: SIGNER_KEY_MATCHED", result.stdout)
        self.assertIn("CLASS: fixture", result.stdout)
        self.assertIn("CONFORMANCE: FIXTURE", result.stdout)
        self.assertIn("CONSISTENCY: CONSISTENCY_UNCHECKED", result.stdout)
        self.assertIn("CELL_EXECUTION: NOT_ESTABLISHED", result.stdout)
        self.assertIn("ATTENDANCE: reported-not-proven", result.stdout)

    def assert_refused(self, result: subprocess.CompletedProcess[str], reason: str) -> None:
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn(reason, result.stdout + result.stderr)
        self.assertNotIn("SIGNATURE_VALID", result.stdout)
        self.assertNotIn("SIGNER_KEY_MATCHED", result.stdout)
        self.assertNotIn("APPEND_ONLY", result.stdout)

    def assert_coherent_universe(self, label: str) -> None:
        # Read-only reload checks every real hash link; bind both signed heads and
        # the receipt to that chain rather than assuming arbitrary digests fit.
        from diamond.aura import Aura, mth_from_entry_hashes

        public = self.evidence / label
        aura = Aura(public / "aura.jsonl")
        retained = json.loads((public / "retained.json").read_text())
        presented = json.loads((public / "presented.json").read_text())
        receipt = json.loads((public / "receipt.json").read_text())
        self.assertEqual(aura.size(), 4)
        self.assertEqual(receipt["aura"], aura.entry_view(4))
        self.assertEqual(retained["size"], 3)
        self.assertEqual(retained["seq"], 3)
        self.assertEqual(retained["head"], aura.entries[2]["hash"])
        self.assertEqual(retained["root"], mth_from_entry_hashes(
            [bytes.fromhex(entry["hash"]) for entry in aura.entries[:3]]).hex())
        for key, value in aura.checkpoint(with_proof_from=3).items():
            self.assertEqual(presented[key], value)
        for key in ("pluginId", "pluginDigest", "operation"):
            self.assertEqual(receipt["composition"][key], aura.entries[-1]["body"][key])
        self.assertEqual(receipt["nonce"], aura.entries[-1]["body"]["settlementNonce"])
        self.assert_accepted_receipt(self.cold(label, "--pub", public / "issuer.pk"))
        pair = self.pair(label, label)
        self.assertEqual(pair.returncode, 0, pair.stdout + pair.stderr)
        self.assertIn("CHECKPOINT_SIG: OK", pair.stdout)
        self.assertIn("APPEND_ONLY", pair.stdout)

    def test_honest_cold_cli_works_after_test_key_file_deletion(self) -> None:
        self.assert_coherent_universe("honest")

    def test_coherent_attacker_universe_refuses_external_honest_key(self) -> None:
        self.assert_coherent_universe("attacker")
        honest = self.evidence / "honest" / "issuer.pk"
        attacker = self.evidence / "attacker" / "issuer.pk"
        self.assertNotEqual(honest.read_bytes(), attacker.read_bytes())
        self.assert_refused(self.cold("attacker", "--pub", honest), "issuerPk mismatch")
        self.assert_refused(self.pair("attacker", "honest"), "signerPk mismatch")

    def test_missing_expected_key_refuses(self) -> None:
        for universe in ("honest", "attacker"):
            with self.subTest(universe=universe):
                self.assert_refused(self.cold(universe), "require --pub or --trust-anchors")
        empty_key = self.work / "empty-public-key.pk"
        empty_key.write_text("", encoding="utf-8")
        self.assert_refused(self.cold("honest", "--pub", empty_key), "issuerPk mismatch")

    def test_wrong_signer_refuses(self) -> None:
        wrong = self.evidence / "attacker" / "issuer.pk"
        self.assert_refused(self.cold("honest", "--pub", wrong), "issuerPk mismatch")
        self.assert_refused(self.pair("honest", "attacker"), "signerPk mismatch")

    def test_cold_unanchored_demo_cannot_drop_explicit_empty_anchor_paths(self) -> None:
        for option in ("--pub", "--trust-anchors"):
            with self.subTest(option=option):
                result = self.cold("honest", option, "", "--allow-unanchored")
                self.assert_refused(result, "FAIL:")
                self.assertNotIn("SIGNER_IDENTITY_UNANCHORED", result.stdout)

    def dual_anchor_sources(self) -> tuple[tuple[str, object, object], ...]:
        honest = self.evidence / "honest" / "issuer.pk"
        attacker = self.evidence / "attacker" / "issuer.pk"
        malformed = self.work / "dual-source-malformed.pk"
        malformed.write_text("not a public key\n", encoding="utf-8")
        unreadable = self.work / "dual-source-missing.pk"
        return (
            ("matching", honest, honest),
            ("contradictory", honest, attacker),
            ("malformed-public-key", malformed, honest),
            ("malformed-trust-list", honest, malformed),
            ("unreadable-public-key", unreadable, honest),
            ("unreadable-trust-list", honest, unreadable),
            ("empty-public-key-path", "", honest),
            ("empty-trust-list-path", honest, ""),
        )

    def test_dual_anchor_sources_refuse_library_before_reading_receipt(self) -> None:
        from diamond.cold_verify import verify_file
        from diamond.receipt import ReceiptError

        for name, public, anchors in self.dual_anchor_sources():
            for allow_unanchored in (False, True):
                with self.subTest(source=name, allow_unanchored=allow_unanchored):
                    # Missing receipt proves ambiguity is refused before any
                    # receipt read can conceal it behind an unrelated IO error.
                    with self.assertRaisesRegex(ReceiptError, "ANCHOR_SOURCE_AMBIGUOUS"):
                        verify_file(self.work / "receipt-not-created.json", Path(public),
                                    trust_anchors=Path(anchors), allow_unanchored=allow_unanchored)

    def test_dual_anchor_sources_refuse_cli_without_demo_rescue(self) -> None:
        for name, public, anchors in self.dual_anchor_sources():
            for escape in ((), ("--allow-unanchored",)):
                with self.subTest(source=name, escape=escape):
                    result = self.cold("honest", "--pub", public, "--trust-anchors", anchors,
                                       *escape)
                    self.assert_refused(result, "ANCHOR_SOURCE_AMBIGUOUS")
                    self.assertNotIn("SIGNER_IDENTITY_UNANCHORED", result.stdout)

    def library_pair(self, universe: str, **options: object) -> tuple[tuple[str, int], str]:
        from diamond.verify_pair import verify_pair

        evidence = self.evidence / universe
        output = io.StringIO()
        with redirect_stdout(output):
            result = verify_pair(evidence / "retained.json", evidence / "presented.json",
                                 **options)
        return result, output.getvalue()

    def test_pair_missing_anchor_refuses_library_and_cli_for_both_universes(self) -> None:
        for universe in ("honest", "attacker"):
            with self.subTest(universe=universe):
                result, output = self.library_pair(universe)
                self.assertEqual(result, ("CHECKPOINT_ANCHOR_REQUIRED", 2), output)
                self.assertNotIn("SIGNER_KEY_MATCHED", output)
                evidence = self.evidence / universe
                self.assert_refused(self.cli(
                    f"missing-pair-anchor-{universe}", "diamond.verify_pair",
                    evidence / "retained.json", evidence / "presented.json"),
                    "CHECKPOINT_ANCHOR_REQUIRED")

    def test_pair_invalid_anchor_refuses_library_before_reading_evidence(self) -> None:
        # A malformed caller pin must not disappear into the weaker embedded-key
        # path, including non-string values that CLI argument parsing cannot emit.
        for key in ("", 42, False, {}, [], b"00" * 32, "00" * 31, "00" * 33,
                    "AA" * 32, "zz" * 32, "0 " * 32):
            with self.subTest(key=repr(key)):
                result, output = self.library_pair("no-such-evidence", expect_pk=key)
                self.assertEqual(result, ("CHECKPOINT_ANCHOR_INVALID", 2), output)
                self.assertNotIn("SIGNER_KEY_MATCHED", output)

    def test_pair_invalid_anchor_refuses_cli(self) -> None:
        evidence = self.evidence / "honest"
        malformed = self.work / "malformed-public-key.pk"
        for data in (b"", b"00" * 31, b"00" * 33, b"AA" * 32, b"zz" * 32, b"\xff"):
            with self.subTest(data=repr(data)):
                malformed.write_bytes(data)
                self.assert_refused(self.cli(
                    "invalid-pair-anchor", "diamond.verify_pair",
                    evidence / "retained.json", evidence / "presented.json", "--pub", malformed),
                    "CHECKPOINT_ANCHOR_INVALID")
        self.assert_refused(self.cli(
            "unreadable-pair-anchor", "diamond.verify_pair",
            evidence / "retained.json", evidence / "presented.json", "--pub",
            self.work / "missing-public-key.pk"), "CHECKPOINT_ANCHOR_INVALID")
        self.assert_refused(self.cli(
            "empty-anchor-path", "diamond.verify_pair", evidence / "retained.json",
            evidence / "presented.json", "--pub", ""), "CHECKPOINT_ANCHOR_INVALID")

    def test_unsigned_pair_demo_names_unchecked_signature_and_identity(self) -> None:
        # Strip signatures completely: the explicit escape hatch must describe
        # exactly the weaker check it performed even on a consistent pair.
        paths = []
        for name in ("retained", "presented"):
            checkpoint = json.loads((self.evidence / "honest" / f"{name}.json").read_text())
            for key in ("sig", "signerPk", "kind"):
                del checkpoint[key]
            path = self.work / f"unsigned-{name}.json"
            path.write_text(json.dumps(checkpoint), encoding="utf-8")
            paths.append(path)
        result = self.cli("unsigned-demo", "diamond.verify_pair", *paths, "--allow-unsigned")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("APPEND_ONLY", result.stdout)
        self.assertIn("CHECKPOINT_SIG: SIGNATURE_UNCHECKED", result.stdout)
        self.assertIn("SIGNER: SIGNER_IDENTITY_UNANCHORED", result.stdout)
        self.assertNotIn("SIGNER_KEY_MATCHED", result.stdout)
        self.assert_refused(self.cli(
            "unsigned-without-escape", "diamond.verify_pair", *paths, "--pub",
            self.evidence / "honest" / "issuer.pk"), "CHECKPOINT_SIG: FAIL")

    def test_unsigned_pair_cannot_silently_ignore_supplied_anchor(self) -> None:
        expected = self.evidence / "honest" / "issuer.pk"
        result, output = self.library_pair("honest", expect_pk=expected.read_text().strip(),
                                           require_sig=False)
        self.assertEqual(result, ("CHECKPOINT_ANCHOR_INVALID", 2), output)
        self.assertNotIn("APPEND_ONLY", output)
        evidence = self.evidence / "honest"
        self.assert_refused(self.cli(
            "unsigned-with-anchor", "diamond.verify_pair", evidence / "retained.json",
            evidence / "presented.json", "--allow-unsigned", "--pub", expected),
            "CHECKPOINT_ANCHOR_INVALID")
        self.assert_refused(self.cli(
            "unsigned-with-empty-anchor-path", "diamond.verify_pair", evidence / "retained.json",
            evidence / "presented.json", "--allow-unsigned", "--pub", ""),
            "CHECKPOINT_ANCHOR_INVALID")

    def test_trust_anchor_list_refuses_attacker_and_empty_list(self) -> None:
        anchors = self.work / "trust-anchors.txt"
        anchors.write_text("# externally supplied honest issuer\n" +
                           (self.evidence / "honest" / "issuer.pk").read_text(),
                           encoding="utf-8")
        self.assert_accepted_receipt(self.cold("honest", "--trust-anchors", anchors))
        self.assert_refused(self.cold("attacker", "--trust-anchors", anchors),
                            "issuerPk not in trust-anchors")
        anchors.write_text("# no expected keys\n", encoding="utf-8")
        self.assert_refused(self.cold("honest", "--trust-anchors", anchors),
                            "issuerPk not in trust-anchors")

    def tampered_receipt(self) -> Path:
        receipt = json.loads((self.evidence / "honest" / "receipt.json").read_text())
        receipt["composition"]["pluginId"] = "changed-after-signing"
        path = self.work / "tampered-receipt.json"
        path.write_text(json.dumps(receipt), encoding="utf-8")
        return path

    def test_receipt_byte_tamper_refuses(self) -> None:
        result = self.cli("tampered-receipt", "diamond.cold_verify", self.tampered_receipt(),
                          "--pub", self.evidence / "honest" / "issuer.pk")
        self.assert_refused(result, "signature")

    def test_checkpoint_byte_tamper_refuses_before_merkle_court(self) -> None:
        evidence = self.evidence / "honest"
        checkpoint = json.loads((evidence / "presented.json").read_text())
        root = checkpoint["root"]
        checkpoint["root"] = ("0" if root[0] != "0" else "1") + root[1:]
        tampered = self.work / "tampered-presented.json"
        tampered.write_text(json.dumps(checkpoint), encoding="utf-8")
        self.assert_refused(self.cli(
            "tampered-checkpoint", "diamond.verify_pair", evidence / "retained.json",
            tampered, "--pub", evidence / "issuer.pk"), "CHECKPOINT_SIG: FAIL (signature)")

    def mutant(self, name: str, module: str, before: str, after: str) -> Path:
        copied = self.work / name
        shutil.copytree(self.verifier, copied)
        path = copied / module
        source = path.read_text(encoding="utf-8")
        self.assertEqual(source.count(before), 1, "mutation target changed; repair this control")
        path.write_text(source.replace(before, after), encoding="utf-8")
        return copied

    def test_missing_anchor_guard_is_load_bearing(self) -> None:
        mutant = self.mutant("missing-anchor-mutant", "diamond/cold_verify.py",
                             "    if allow_unanchored:\n", "    if True:\n")
        result = self.cold("honest", verifier=mutant)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("SIGNER_IDENTITY_UNANCHORED", result.stdout)
        with self.assertRaises(AssertionError):
            self.assert_refused(result, "require --pub or --trust-anchors")

    def test_expected_signer_guard_is_load_bearing(self) -> None:
        mutant = self.mutant(
            "expected-signer-mutant", "diamond/receipt.py",
            '    if expect_pk is not None and receipt["issuerPk"] != expect_pk:\n',
            "    if False:\n",
        )
        result = self.cold("attacker", "--pub", self.evidence / "honest" / "issuer.pk",
                           verifier=mutant)
        self.assert_accepted_receipt(result)
        with self.assertRaises(AssertionError):
            self.assert_refused(result, "issuerPk mismatch")

    def test_signature_guard_is_load_bearing(self) -> None:
        mutant = self.mutant(
            "signature-mutant", "diamond/receipt.py",
            '    if not verify(pk, to_sign_bytes(receipt), from_hex(receipt["sig"])):\n',
            "    if False:\n",
        )
        result = self.cli("signature-mutant", "diamond.cold_verify", self.tampered_receipt(),
                          "--pub", self.evidence / "honest" / "issuer.pk", verifier=mutant)
        self.assert_accepted_receipt(result)
        with self.assertRaises(AssertionError):
            self.assert_refused(result, "signature")

    def test_pair_external_anchor_guard_is_load_bearing(self) -> None:
        mutant = self.mutant(
            "pair-anchor-mutant", "diamond/verify_pair.py",
            "    if require_sig and expect_pk is None:\n", "    if False:\n",
        )
        evidence = self.evidence / "attacker"
        result = self.cli("pair-anchor-mutant", "diamond.verify_pair",
                          evidence / "retained.json", evidence / "presented.json",
                          verifier=mutant)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("CHECKPOINT_SIG: OK", result.stdout)
        self.assertIn("APPEND_ONLY", result.stdout)
        with self.assertRaises(AssertionError):
            self.assert_refused(result, "CHECKPOINT_ANCHOR_REQUIRED")

    def test_dual_anchor_source_guard_is_load_bearing(self) -> None:
        mutant = self.mutant(
            "dual-anchor-mutant", "diamond/cold_verify.py",
            "    if pub_path is not None and trust_anchors is not None:\n", "    if False:\n",
        )
        # Without the guard, the valid public key silently wins over a supplied
        # contradictory trust list and the CLI makes an anchored success claim.
        result = self.cold("honest", "--pub", self.evidence / "honest" / "issuer.pk",
                           "--trust-anchors", self.evidence / "attacker" / "issuer.pk",
                           "--allow-unanchored", verifier=mutant)
        self.assert_accepted_receipt(result)
        with self.assertRaises(AssertionError):
            self.assert_refused(result, "ANCHOR_SOURCE_AMBIGUOUS")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--mint-test-universes":
        mint_test_universes(Path(sys.argv[2]))
    else:
        unittest.main()
