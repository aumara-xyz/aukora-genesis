"""Narrow tests for the cold Aura consistency verifier."""

import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Sequence

import aura_consistency as verifier


ROOT_DOMAIN = b"aukora:aura-merkle-root:v2\0"
STREAM_NAMESPACE = hashlib.sha256(b"fixture stream namespace").hexdigest()


def leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def largest_power_of_two_less_than(value: int) -> int:
    return 1 << ((value - 1).bit_length() - 1)


def structural_root(leaves: Sequence[bytes]) -> bytes:
    if not leaves:
        return hashlib.sha256(b"").digest()
    if len(leaves) == 1:
        return leaves[0]
    cut = largest_power_of_two_less_than(len(leaves))
    return node_hash(structural_root(leaves[:cut]), structural_root(leaves[cut:]))


def consistency_proof(
    previous_size: int,
    leaves: Sequence[bytes],
    complete_subtree: bool = True,
) -> List[bytes]:
    if previous_size == 0:
        return []
    if previous_size == len(leaves):
        return [] if complete_subtree else [structural_root(leaves)]
    cut = largest_power_of_two_less_than(len(leaves))
    if previous_size <= cut:
        return consistency_proof(previous_size, leaves[:cut], complete_subtree) + [
            structural_root(leaves[cut:])
        ]
    return consistency_proof(previous_size - cut, leaves[cut:], False) + [
        structural_root(leaves[:cut])
    ]


def root_commitment(size: int, root: bytes) -> str:
    return hashlib.sha256(ROOT_DOMAIN + size.to_bytes(8, "big") + root).hexdigest()


def retained_document(leaves: Sequence[bytes]) -> Dict[str, Any]:
    root = structural_root(leaves)
    return {
        "domain": "aukora:aura-checkpoint:v1",
        "treeSize": len(leaves),
        "root": root.hex(),
        "commitment": root_commitment(len(leaves), root),
        "streamNamespace": STREAM_NAMESPACE,
    }


def presented_document(previous_size: int, leaves: Sequence[bytes]) -> Dict[str, Any]:
    document = retained_document(leaves)
    document["proofFromPrevious"] = [
        item.hex() for item in consistency_proof(previous_size, leaves)
    ]
    return document


class AuraConsistencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def write_json(self, name: str, value: Any) -> str:
        path = self.root / name
        path.write_text(
            json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        return str(path)

    def evaluate(self, retained: Any, presented: Any) -> Dict[str, Any]:
        retained_path = self.write_json("retained.json", retained)
        presented_path = self.write_json("presented.json", presented)
        return verifier.evaluate_paths(retained_path, presented_path)

    def test_rfc6962_prefixes_verify_across_non_power_of_two_sizes(self) -> None:
        leaves = [leaf_hash("leaf-{}".format(index).encode("ascii")) for index in range(17)]
        new_root = structural_root(leaves)
        for previous_size in range(1, 18):
            previous_root = structural_root(leaves[:previous_size])
            proof = consistency_proof(previous_size, leaves)
            self.assertEqual(
                verifier._verify_consistency(
                    previous_size,
                    len(leaves),
                    previous_root,
                    new_root,
                    proof,
                ),
                (
                    "APPEND_ONLY",
                    "consistent-checkpoint" if previous_size == len(leaves) else "consistent-extension",
                ),
                "prefix size {}".format(previous_size),
            )

    def test_valid_extension_is_append_only_with_explicit_ceilings(self) -> None:
        leaves = [leaf_hash(b"one"), leaf_hash(b"two"), leaf_hash(b"three")]
        result = self.evaluate(retained_document(leaves[:2]), presented_document(2, leaves))
        self.assertEqual(
            result,
            {
                "verdict": "APPEND_ONLY",
                "reason": "consistent-extension",
                "ceiling": {
                    "evidenceConsistencyOnly": True,
                    "latestnessProven": False,
                    "signatureProven": False,
                    "truthProven": False,
                },
            },
        )

    def test_empty_retained_checkpoint_is_undetermined_and_equal_checkpoint_is_consistent(self) -> None:
        leaves = [leaf_hash(b"one"), leaf_hash(b"two")]
        empty_result = self.evaluate(retained_document([]), presented_document(0, leaves))
        self.assertEqual(empty_result["verdict"], "UNDETERMINED")
        self.assertEqual(empty_result["reason"], "empty-retained-checkpoint")

        same = presented_document(len(leaves), leaves)
        same_result = self.evaluate(retained_document(leaves), same)
        self.assertEqual(same_result["reason"], "consistent-checkpoint")
        same["proofFromPrevious"] = [structural_root(leaves).hex()]
        self.assertEqual(self.evaluate(retained_document(leaves), same)["verdict"], "UNDETERMINED")

    def test_mutated_truncated_and_extra_proofs_are_undetermined(self) -> None:
        leaves = [leaf_hash(str(index).encode("ascii")) for index in range(7)]
        retained = retained_document(leaves[:3])
        presented = presented_document(3, leaves)

        mutated = dict(presented)
        mutated_proof = list(presented["proofFromPrevious"])
        mutated_proof[0] = hashlib.sha256(b"mutant").hexdigest()
        mutated["proofFromPrevious"] = mutated_proof
        self.assertEqual(self.evaluate(retained, mutated)["verdict"], "UNDETERMINED")

        truncated = dict(presented)
        truncated["proofFromPrevious"] = presented["proofFromPrevious"][:-1]
        self.assertEqual(self.evaluate(retained, truncated)["verdict"], "UNDETERMINED")

        extra = dict(presented)
        extra["proofFromPrevious"] = presented["proofFromPrevious"] + [hashlib.sha256(b"extra").hexdigest()]
        self.assertEqual(self.evaluate(retained, extra)["verdict"], "UNDETERMINED")

    def test_smaller_presentation_namespace_and_commitment_mismatches_are_undetermined(self) -> None:
        leaves = [leaf_hash(b"one"), leaf_hash(b"two")]
        retained = retained_document(leaves)
        smaller = presented_document(1, leaves[:1])
        smaller_result = self.evaluate(retained, smaller)
        self.assertEqual(smaller_result["verdict"], "UNDETERMINED")
        self.assertEqual(smaller_result["reason"], "presented-tree-smaller")

        signer_change = presented_document(2, leaves)
        signer_change["streamNamespace"] = hashlib.sha256(b"other stream").hexdigest()
        signer_result = self.evaluate(retained, signer_change)
        self.assertEqual(signer_result["verdict"], "UNDETERMINED")
        self.assertEqual(signer_result["reason"], "stream-namespace-mismatch")

        wrong_commitment = presented_document(2, leaves)
        wrong_commitment["commitment"] = "00" * 32
        commitment_result = self.evaluate(retained, wrong_commitment)
        self.assertEqual(commitment_result["verdict"], "UNDETERMINED")
        self.assertEqual(commitment_result["reason"], "presented-commitment-mismatch")

    def test_same_size_distinct_valid_roots_are_an_observation_conflict(self) -> None:
        retained_leaves = [leaf_hash(b"one"), leaf_hash(b"two")]
        presented_leaves = [leaf_hash(b"one"), leaf_hash(b"different")]
        result = self.evaluate(
            retained_document(retained_leaves),
            presented_document(len(retained_leaves), presented_leaves),
        )
        self.assertEqual(result["verdict"], "OBSERVATION_CONFLICT")
        self.assertEqual(result["reason"], "same-size-root-conflict")

    def test_non_power_of_two_proof_can_establish_a_conflicting_retained_prefix(self) -> None:
        presented_leaves = [leaf_hash(str(index).encode("ascii")) for index in range(7)]
        conflicting_prefix = [leaf_hash(b"zero"), leaf_hash(b"one"), leaf_hash(b"other")]
        result = self.evaluate(
            retained_document(conflicting_prefix),
            presented_document(3, presented_leaves),
        )
        self.assertEqual(result["verdict"], "OBSERVATION_CONFLICT")
        self.assertEqual(result["reason"], "retained-prefix-root-conflict")

    def test_power_of_two_prefix_mismatch_is_undetermined(self) -> None:
        presented_leaves = [leaf_hash(str(index).encode("ascii")) for index in range(7)]
        conflicting_prefix = [leaf_hash(b"zero"), leaf_hash(b"other")]
        result = self.evaluate(
            retained_document(conflicting_prefix),
            presented_document(2, presented_leaves),
        )
        self.assertEqual(result["verdict"], "UNDETERMINED")
        self.assertEqual(result["reason"], "consistency-proof-presented-root-mismatch")

    def test_retained_commitment_mismatch_is_undetermined(self) -> None:
        leaves = [leaf_hash(b"one")]
        retained = retained_document(leaves)
        retained["commitment"] = "00" * 32
        result = self.evaluate(retained, presented_document(1, leaves))
        self.assertEqual(result["verdict"], "UNDETERMINED")
        self.assertEqual(result["reason"], "retained-commitment-mismatch")

    def test_strict_json_schema_and_digest_validation_are_undetermined(self) -> None:
        leaves = [leaf_hash(b"one")]
        retained = retained_document(leaves)
        presented = presented_document(1, leaves)

        extra_field = dict(presented)
        extra_field["extra"] = False
        self.assertEqual(self.evaluate(retained, extra_field)["verdict"], "UNDETERMINED")

        uppercase = dict(presented)
        uppercase["root"] = uppercase["root"].upper()
        self.assertEqual(self.evaluate(retained, uppercase)["verdict"], "UNDETERMINED")

        retained_path = self.root / "duplicate.json"
        retained_path.write_text(
            '{"domain":"aukora:aura-checkpoint:v1","treeSize":1,"treeSize":1,'
            '"root":"%s","commitment":"%s","streamNamespace":"%s"}\n' % (
                retained["root"], retained["commitment"], STREAM_NAMESPACE
            ),
            encoding="utf-8",
        )
        presented_path = self.write_json("presented.json", presented)
        duplicate_result = verifier.evaluate_paths(str(retained_path), presented_path)
        self.assertEqual(duplicate_result["verdict"], "UNDETERMINED")

    def test_noncanonical_or_unsafe_numbers_are_undetermined(self) -> None:
        leaves = [leaf_hash(b"one")]
        retained = retained_document(leaves)
        presented_path = self.write_json("presented.json", presented_document(1, leaves))

        template = (
            '{{"domain":"aukora:aura-checkpoint:v1","treeSize":{},'
            '"root":"{}","commitment":"{}","streamNamespace":"{}"}}\n'
        )
        for index, number in enumerate(("-0", "1.0", str(1 << 53))):
            path = self.root / "number-{}.json".format(index)
            path.write_text(
                template.format(number, retained["root"], retained["commitment"], STREAM_NAMESPACE),
                encoding="utf-8",
            )
            self.assertEqual(
                verifier.evaluate_paths(str(path), presented_path)["verdict"],
                "UNDETERMINED",
            )

    def test_regular_file_and_size_limits_are_enforced(self) -> None:
        leaves = [leaf_hash(b"one")]
        presented_path = self.write_json("presented.json", presented_document(1, leaves))

        directory_result = verifier.evaluate_paths(str(self.root), presented_path)
        self.assertEqual(directory_result["verdict"], "UNDETERMINED")

        oversized = self.root / "oversized.json"
        oversized.write_bytes(b" " * (1024 * 1024 + 1))
        oversized_result = verifier.evaluate_paths(str(oversized), presented_path)
        self.assertEqual(oversized_result["verdict"], "UNDETERMINED")

        if hasattr(os, "symlink"):
            target = self.write_json("target.json", retained_document(leaves))
            link = self.root / "link.json"
            try:
                link.symlink_to(target)
            except OSError:
                pass
            else:
                self.assertEqual(
                    verifier.evaluate_paths(str(link), presented_path)["verdict"],
                    "UNDETERMINED",
                )

    def test_cli_output_and_exit_codes_are_deterministic(self) -> None:
        leaves = [leaf_hash(b"one"), leaf_hash(b"two")]
        retained_path = self.write_json("retained.json", retained_document(leaves[:1]))
        presented_path = self.write_json("presented.json", presented_document(1, leaves))

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = verifier.main((retained_path, presented_path))
        self.assertEqual(exit_code, 0)
        self.assertEqual(
            output.getvalue(),
            '{"ceiling":{"evidenceConsistencyOnly":true,"latestnessProven":false,'
            '"signatureProven":false,"truthProven":false},"reason":"consistent-extension",'
            '"verdict":"APPEND_ONLY"}\n',
        )

        conflict = presented_document(1, leaves)
        conflict["proofFromPrevious"] = []
        conflict_path = self.write_json("conflict.json", conflict)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(verifier.main((retained_path, conflict_path)), 0)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(verifier.main(()), 2)

    def test_real_cli_emits_one_ascii_record_with_lf_only(self) -> None:
        leaves = [leaf_hash(b"one"), leaf_hash(b"two")]
        retained_path = self.write_json("retained-subprocess.json", retained_document(leaves[:1]))
        presented_path = self.write_json(
            "presented-subprocess.json", presented_document(1, leaves)
        )
        completed = subprocess.run(
            [
                sys.executable,
                "-I",
                str(Path(verifier.__file__).resolve()),
                retained_path,
                presented_path,
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        self.assertEqual(completed.stdout.count(b"\n"), 1)
        self.assertNotIn(b"\r", completed.stdout)
        self.assertEqual(
            json.loads(completed.stdout),
            verifier.evaluate_paths(retained_path, presented_path),
        )

    def test_overlong_integer_returns_closed_envelope_in_real_cli(self) -> None:
        leaves = [leaf_hash(b"one")]
        retained = json.dumps(
            retained_document(leaves), sort_keys=True, separators=(",", ":")
        )
        retained = retained.replace('"treeSize":1', '"treeSize":' + ("9" * 5000))
        retained_path = self.root / "retained-overlong-integer.json"
        retained_path.write_text(retained + "\n", encoding="utf-8")
        presented_path = self.write_json(
            "presented-overlong-integer.json", presented_document(1, leaves)
        )
        completed = subprocess.run(
            [
                sys.executable,
                "-I",
                str(Path(verifier.__file__).resolve()),
                str(retained_path),
                presented_path,
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        self.assertEqual(
            json.loads(completed.stdout),
            {
                "ceiling": {
                    "evidenceConsistencyOnly": True,
                    "latestnessProven": False,
                    "signatureProven": False,
                    "truthProven": False,
                },
                "reason": "retained-input-invalid",
                "verdict": "UNDETERMINED",
            },
        )


if __name__ == "__main__":
    unittest.main()
