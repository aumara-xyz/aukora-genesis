"""Controls for offline Aumlok approval verification, beside the Kira evidence consumer.

    python3 -B tests/aumlok-approval/test_aumlok_approval.py

EVERY CONTROL RUNS A REAL PROCESS FROM AN EMPTY WORKING DIRECTORY, offline, with no Genesis code
importable. The fixtures were produced by Genesis's own contract code at a recorded commit
(`make-fixtures.mjs`, provenance in `fixtures/PROVENANCE.json`); the keys are disposable and
public.

TWO LANES ARE CONTROLLED HERE, because a defect in either one is invisible from the other:

  A. the standalone verifier, `python3 -m diamond.aumlok_approval`
  B. the SAME approval, through `scripts/verify-kira-evidence.py --approval`, where an explicitly
     requested check that FAILS must fail the whole run with a named reason

EVERY ARM ASSERTS ITS EXIT STATUS. A named refusal that still exits 0 is the defect these controls
were written for, so the failing direction is asserted in both lanes rather than eyeballed.

THE SEVEN FINDINGS, and what each one is allowed to conclude:

  1. honest signature            → signature VALID, and nothing else is claimed
  2. changed signed field        → signature INVALID
  3. forged signature            → signature INVALID
  4. wrong independent anchor    → signature INVALID under anchor B, valid under anchor A
  5. caller digest equality      → EQUALITY between two caller-supplied values, reported as that
                                   and never as a memory-operation binding, which stays UNVERIFIED
  6. absent approval             → OWNER_APPROVAL_UNCHECKED (never a pass, never a failure of
                                   something that was not checked)
  7. unsigned wrapper claiming attendance → refused BY NAME, with a failing exit status

WHAT NO CONTROL MAY CONCLUDE. That a person attended. That the approval authorizes anything. That
the approval is bound to a Kira memory operation: binding needs Diamond to DERIVE the digest from
the agreed producer operation bytes, and no such derivation exists, so nothing here invents one.
"""
from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
FIXTURES = HERE / "fixtures"
EVIDENCE = REPO / "tests" / "kira-evidence" / "evidence"
CLI = REPO / "scripts" / "verify-kira-evidence.py"
NEUTRAL = Path(tempfile.mkdtemp(prefix="aumlok-neutral-")).resolve()
SCRATCH = Path(tempfile.mkdtemp(prefix="aumlok-scratch-")).resolve()

ENV = {"PATH": "/usr/bin:/bin", "PYTHONPATH": str(REPO), "PYTHONDONTWRITEBYTECODE": "1"}


def run_module(document: Path, anchor: Path, *extra: str) -> tuple[int, str]:
    """The standalone verifier, as its own process, from an empty cwd, with no Genesis on the path."""
    proc = subprocess.run(
        [sys.executable, "-B", "-m", "diamond.aumlok_approval",
         "--document", str(document), "--anchor", str(anchor), *extra],
        cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def run_module_json(document: Path, anchor: Path, *extra: str) -> dict:
    rc, out = run_module(document, anchor, "--json", *extra)
    return {"rc": rc, **json.loads(out)}


def run_cli(*extra: str) -> tuple[int, str]:
    """The Kira evidence consumer, as its own process, from the same empty cwd."""
    proc = subprocess.run(
        [sys.executable, "-B", str(CLI),
         "--record", str(EVIDENCE / "fixture" / "record.json"),
         "--receipt", str(EVIDENCE / "receipt-1.json"),
         "--log", str(EVIDENCE / "aura.jsonl"),
         "--anchor", str(EVIDENCE / "issuer.pk"), *extra],
        cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def cli_json(*extra: str) -> dict:
    """The consumer's JSON report, plus the exit status and printed lines it must agree with."""
    rc, out = run_cli(*extra, "--json")
    block = out.split("REPORT-JSON-BEGIN")[1].split("REPORT-JSON-END")[0]
    return {"rc": rc, "report": json.loads(block), "text": out}


def mutated(name: str, **changes) -> Path:
    """A copy of a committed fixture with fields replaced, for the structural controls."""
    document = json.loads((FIXTURES / name).read_text())
    for path, value in changes.items():
        target = document
        *parents, last = path.split(".")
        for parent in parents:
            target = target[parent]
        target[last] = value
    out = SCRATCH / f"mutated-{'-'.join(changes)}.json"
    out.write_text(json.dumps(document))
    return out


class AumlokApprovalModuleTests(unittest.TestCase):
    """Lane A: `python3 -m diamond.aumlok_approval`, the standalone verifier."""

    def setUp(self) -> None:
        self.assertEqual(sorted(p.name for p in NEUTRAL.iterdir()), [], "neutral cwd must stay empty")
        self.a = FIXTURES / "anchor-a.pk"
        self.b = FIXTURES / "anchor-b.pk"
        self.provenance = json.loads((FIXTURES / "PROVENANCE.json").read_text())

    def test_fixtures_come_from_the_pinned_contract(self):
        # The fixtures name the producer commit and the preimage digest Genesis's own code produced.
        self.assertEqual(self.provenance["genesisCommit"],
                         "8df15d8c5aa2e71f4a2f1d482dc823501a68ec7a")
        self.assertEqual(len(self.provenance["preimageSha256"]), 64)
        self.assertEqual(len(self.provenance["fixtures"]), 7)

    def test_1_honest_signature_is_valid_and_claims_nothing_more(self):
        result = run_module_json(FIXTURES / "honest.json", self.a)
        findings, summary = result["findings"], result["summary"]
        self.assertEqual(result["rc"], 0)
        self.assertEqual(findings["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        # The five findings, each on its own, and none of them upgraded by the valid signature.
        self.assertEqual(findings["caller_digest_equality"]["status"], "CALLER_DIGEST_NOT_SUPPLIED")
        self.assertEqual(findings["memory_operation_binding"]["status"], "OPERATION_BINDING_UNVERIFIED")
        self.assertEqual(findings["authorization"]["status"], "OWNER_APPROVAL_UNCHECKED")
        self.assertEqual(findings["attendance"]["status"], "reported-not-proven")
        self.assertIs(findings["attendance"]["proven"], False)
        self.assertEqual(summary["status"], "OWNER_APPROVAL_SIGNATURE_VALID")
        self.assertIsNone(summary["refusal"])
        self.assertIs(summary["fails_verification"], False)
        # The prose says what was verified and no more.
        self.assertIn("authorization UNCHECKED", summary["reason"])
        self.assertIn("no signature shows a person was present", summary["reason"])

    def test_2_changed_signed_field_invalidates_the_signature(self):
        rc, out = run_module(FIXTURES / "changed-field.json", self.a)
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_SIGNATURE_INVALID", out)
        self.assertNotIn("signature verified", out)

    def test_3_forged_signature_is_invalid(self):
        rc, out = run_module(FIXTURES / "forged.json", self.a)
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_SIGNATURE_INVALID", out)
        self.assertNotIn("signature verified", out)

    def test_4_wrong_independent_anchor_is_invalid(self):
        rc, out = run_module(FIXTURES / "honest.json", self.b)
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_SIGNATURE_INVALID", out)
        rc_a, _ = run_module(FIXTURES / "honest.json", self.a)
        self.assertEqual(rc_a, 0, "the same document must verify under its own anchor")

    def test_5_a_caller_supplied_digest_is_equality_only_and_never_a_binding(self):
        honest = run_module_json(FIXTURES / "honest.json", self.a)["findings"]
        signed = honest["caller_digest_equality"]["signed_operation_digest"]

        matching = run_module_json(FIXTURES / "honest.json", self.a, "--caller-operation-digest", signed)
        self.assertEqual(matching["rc"], 0, "equality with the signed digest is not a failure")
        self.assertEqual(matching["findings"]["caller_digest_equality"]["status"], "CALLER_DIGEST_MATCH")
        # …and it is still NOT a binding: the match is between two values the caller supplied.
        self.assertEqual(matching["findings"]["memory_operation_binding"]["status"],
                         "OPERATION_BINDING_UNVERIFIED")
        self.assertIn("not evidence about any operation",
                      matching["findings"]["caller_digest_equality"]["why"])
        self.assertNotIn("OPERATION_BINDING_VERIFIED", json.dumps(matching))

        foreign = run_module_json(FIXTURES / "honest.json", self.a,
                                  "--caller-operation-digest", "33" * 32)
        self.assertEqual(foreign["rc"], 1, "a valid signature over another digest is not acceptance")
        self.assertEqual(foreign["findings"]["caller_digest_equality"]["status"], "CALLER_DIGEST_MISMATCH")
        self.assertEqual(foreign["findings"]["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        self.assertEqual(foreign["summary"]["status"], "CALLER_DIGEST_MISMATCH")

        malformed = run_module_json(FIXTURES / "honest.json", self.a,
                                    "--caller-operation-digest", "not-a-digest")
        self.assertEqual(malformed["rc"], 1, "a supplied value that is not a digest is a refusal")

    def test_5b_the_committed_mismatch_fixture_signs_a_different_operation(self):
        report = run_module_json(FIXTURES / "mismatched-operation.json", self.a,
                                 "--caller-operation-digest", "22" * 32)["findings"]
        self.assertEqual(report["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        self.assertEqual(report["caller_digest_equality"]["status"], "CALLER_DIGEST_MISMATCH")

    def test_6_absent_approval_stays_owner_approval_unchecked(self):
        # The existing Kira consumer's facet, unchanged: nothing here turns absence into a failure
        # of a check that did not run, or into a pass.
        consumer = (REPO / "diamond" / "kira_evidence.py").read_text()
        self.assertIn("OWNER_APPROVAL_UNCHECKED", consumer)
        rc, out = run_cli("--expect", "verified")
        self.assertEqual(rc, 0)
        self.assertIn("STATUS              : OWNER_APPROVAL_UNCHECKED", out)

    def test_7_unsigned_wrapper_claiming_attendance_is_refused_by_name_and_fails(self):
        rc, out = run_module(FIXTURES / "wrapper-claims-attendance.json", self.a)
        self.assertEqual(rc, 1, "the attendance-wrapper refusal must have a failing exit status")
        self.assertIn("aumlok:unsigned-wrapper-claims-attendance", out)
        result = run_module_json(FIXTURES / "wrapper-claims-attendance.json", self.a)
        self.assertEqual(result["findings"]["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        self.assertEqual(result["findings"]["attendance"]["proven"], False)
        self.assertEqual(result["findings"]["attendance_claim_in_wrapper"]["signed"], False)
        self.assertEqual(result["summary"]["status"], "aumlok:unsigned-wrapper-claims-attendance")
        self.assertIn("attendance", result["summary"]["reason"])

    def test_8_a_document_carrying_its_own_key_is_refused(self):
        # Trust never comes from a key the document chose.
        rc, out = run_module(FIXTURES / "key-from-document.json", self.a)
        self.assertEqual(rc, 1)
        self.assertIn("aumlok:anchor-from-document", out)

    def test_9_a_signer_refusal_is_a_named_outcome_not_a_signature(self):
        rc, out = run_module(FIXTURES / "refused-by-signer.json", self.a)
        self.assertEqual(rc, 1)
        self.assertIn("aumlok:approval-refused-by-signer", out)

    def test_10_the_producers_structural_validation_is_mirrored_field_by_field(self):
        # Each mutation is refused by NAME before any signature is consulted, so a caller cannot
        # get a "signature invalid" for a document the producer would never have minted.
        cases = {
            "request.operationDigest": ("44" * 20, "64 lowercase hexadecimal"),
            "request.activeControlDigest": ("ZZ" * 32, "64 lowercase hexadecimal"),
            "request.subject": ("not-an-id", "aukora:1:"),
            "request.challenge": ("ABCD" * 16, "64 lowercase hexadecimal"),
            "request.issuedAt": (True, "non-negative safe integer"),
            "request.expiresAt": (-1, "non-negative safe integer"),
        }
        for path, (value, expected) in cases.items():
            with self.subTest(field=path):
                rc, out = run_module(mutated("honest.json", **{path: value}), self.a)
                self.assertEqual(rc, 1)
                self.assertIn("aumlok:approval-malformed", out)
                self.assertIn(expected, out)
        # `expiresAt > issuedAt` is the producer's own ordering rule, not only a type check.
        rc, out = run_module(mutated("honest.json", **{"request.expiresAt": 1}), self.a)
        self.assertEqual(rc, 1)
        self.assertIn("expiresAt must be greater than issuedAt", out)
        # An extra field is refused: the record is CLOSED on the producer's side too.
        document = json.loads((FIXTURES / "honest.json").read_text())
        document["request"]["note"] = "hello"
        extra = SCRATCH / "extra-field.json"
        extra.write_text(json.dumps(document))
        rc, out = run_module(extra, self.a)
        self.assertEqual(rc, 1)
        self.assertIn("closed field set", out)

    def test_10b_the_response_rules_are_mirrored_too(self):
        """The producer reads the response with `readDigest`/`readExactAtom` BEFORE comparing."""
        honest = json.loads((FIXTURES / "honest.json").read_text())

        wrong_domain = copy.deepcopy(honest)
        wrong_domain["response"]["domain"] = "aukora:owner-approval-request:v1"
        path = SCRATCH / "response-wrong-domain.json"
        path.write_text(json.dumps(wrong_domain))
        rc, out = run_module(path, self.a)
        self.assertEqual(rc, 1)
        self.assertIn("aumlok:approval-malformed", out)

        not_a_digest = copy.deepcopy(honest)
        not_a_digest["response"]["challenge"] = "not-a-digest"
        path = SCRATCH / "response-challenge-malformed.json"
        path.write_text(json.dumps(not_a_digest))
        rc, out = run_module(path, self.a)
        self.assertEqual(rc, 1)
        # MALFORMED, not CHALLENGE_MISMATCH: the producer refuses the record before comparing it.
        self.assertIn("aumlok:approval-malformed", out)
        self.assertNotIn("aumlok:approval-challenge-mismatch", out)

        # A refusal record may echo NO challenge (null) — the producer allows it — and its domain
        # is checked there too, and its atom is bounded in BYTES.
        for name, response, expected in [
            ("refusal-null-challenge", {"domain": "aukora:owner-approval-response:v1",
                                        "challenge": None, "refusal": "signer:declined"},
             "aumlok:approval-refused-by-signer"),
            ("refusal-bad-domain", {"domain": "aukora:owner-approval-request:v1",
                                    "challenge": None, "refusal": "signer:declined"},
             "aumlok:approval-malformed"),
            ("refusal-atom-too-long", {"domain": "aukora:owner-approval-response:v1",
                                       "challenge": None, "refusal": "s" * 129},
             "aumlok:approval-malformed"),
        ]:
            with self.subTest(case=name):
                document = copy.deepcopy(honest)
                document["response"] = response
                case_path = SCRATCH / f"{name}.json"
                case_path.write_text(json.dumps(document))
                rc, out = run_module(case_path, self.a)
                self.assertEqual(rc, 1)
                self.assertIn(expected, out)

    def test_11_the_summary_the_text_and_the_exit_status_cannot_disagree(self):
        arms = [
            ("honest.json", 0), ("changed-field.json", 1), ("forged.json", 1),
            ("wrapper-claims-attendance.json", 1), ("key-from-document.json", 1),
            ("refused-by-signer.json", 1),
        ]
        for name, expected_rc in arms:
            with self.subTest(fixture=name):
                result = run_module_json(FIXTURES / name, self.a)
                summary = result["summary"]
                self.assertEqual(result["rc"], expected_rc)
                self.assertEqual(summary["fails_verification"], expected_rc == 1)
                # The status word IS the refusal name when anything failed, and the reason string
                # always carries that same name — one decision, three renderings.
                if expected_rc == 1:
                    self.assertEqual(summary["status"], summary["refusal"]["code"])
                    self.assertIn(summary["status"], summary["reason"])
                else:
                    self.assertIsNone(summary["refusal"])
                    self.assertEqual(summary["status"], "OWNER_APPROVAL_SIGNATURE_VALID")

    def test_12_no_genesis_code_is_importable_and_the_cwd_stayed_empty(self):
        rc, out = run_module(FIXTURES / "honest.json", self.a)
        self.assertEqual(rc, 0)
        self.assertNotIn("genesis", out.lower())
        self.assertEqual(sorted(p.name for p in NEUTRAL.iterdir()), [])


class KiraConsumerApprovalLaneTests(unittest.TestCase):
    """Lane B: the same approvals through `scripts/verify-kira-evidence.py --approval`."""

    def setUp(self) -> None:
        self.a = FIXTURES / "anchor-a.pk"
        self.verified = ("--receipt", str(EVIDENCE / "receipt-1.json"))

    def test_6b_absent_approval_is_unchecked_through_the_consumer_too(self):
        rc, out = run_cli("--expect", "verified")
        self.assertEqual(rc, 0)
        self.assertIn("STATUS              : OWNER_APPROVAL_UNCHECKED", out)
        self.assertIn("evidence wrapper only", out)

    def test_13_an_honest_approval_verifies_and_still_authorizes_nothing(self):
        result = cli_json("--approval", str(FIXTURES / "honest.json"),
                          "--approval-anchor", str(self.a), "--expect", "verified")
        self.assertEqual(result["rc"], 0)
        self.assertEqual(result["report"]["approval"]["status"], "OWNER_APPROVAL_SIGNATURE_VALID")
        self.assertEqual(result["report"]["verdict"], "verified")
        findings = result["report"]["approvalFindings"]
        self.assertEqual(findings["authorization"]["status"], "OWNER_APPROVAL_UNCHECKED")
        self.assertEqual(findings["memory_operation_binding"]["status"], "OPERATION_BINDING_UNVERIFIED")
        self.assertIn("VERDICT: VERIFIED", result["text"])

    def test_14_a_forged_approval_fails_the_whole_run_with_a_named_reason(self):
        # The defect this control exists for: a forged approval used to print
        # APPROVAL_SIGNATURE_INVALID and still report VERIFIED with exit status 0.
        rc, out = run_cli("--approval", str(FIXTURES / "forged.json"),
                          "--approval-anchor", str(self.a), "--expect", "verified")
        self.assertEqual(rc, 1, "an explicitly requested approval check that fails must fail the run")
        self.assertIn("VERDICT: REFUSED  APPROVAL_SIGNATURE_INVALID", out)
        result = cli_json("--approval", str(FIXTURES / "forged.json"),
                          "--approval-anchor", str(self.a), "--expect", "APPROVAL_SIGNATURE_INVALID")
        self.assertEqual(result["rc"], 0, "the named refusal is assertable as an expectation")
        report = result["report"]
        # Text, JSON and exit status agree on one decision.
        self.assertIs(report["verified"], False)
        self.assertEqual(report["verdict"], "APPROVAL_SIGNATURE_INVALID")
        # Named for the lane it came from: when the REAL artifact lane arrived, the request/response
        # document stopped being the only approval lane, and the label says WHICH one refused rather
        # than a name that was accurate while there was only one.
        self.assertEqual(report["refusalLane"], "owner_approval_wrapper")
        self.assertEqual(report["approvalRefusal"]["code"], "APPROVAL_SIGNATURE_INVALID")
        self.assertIn("VERDICT: REFUSED  APPROVAL_SIGNATURE_INVALID", result["text"])
        self.assertNotIn("signature verified", result["text"].lower().split("5. owner approval")[1])

    def test_15_a_digest_mismatch_fails_the_run_as_equality_not_as_a_binding(self):
        rc, out = run_cli("--approval", str(FIXTURES / "honest.json"),
                          "--approval-anchor", str(self.a),
                          "--approval-operation-digest", "33" * 32, "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  CALLER_DIGEST_MISMATCH", out)
        result = cli_json("--approval", str(FIXTURES / "honest.json"),
                          "--approval-anchor", str(self.a),
                          "--approval-operation-digest", "33" * 32,
                          "--expect", "CALLER_DIGEST_MISMATCH")
        self.assertEqual(result["rc"], 0)
        self.assertEqual(result["report"]["verdict"], "CALLER_DIGEST_MISMATCH")
        self.assertEqual(result["report"]["approvalFindings"]["memory_operation_binding"]["status"],
                         "OPERATION_BINDING_UNVERIFIED")

    def test_16_the_attendance_wrapper_refusal_is_real_through_the_consumer(self):
        rc, out = run_cli("--approval", str(FIXTURES / "wrapper-claims-attendance.json"),
                          "--approval-anchor", str(self.a), "--expect", "verified")
        self.assertEqual(rc, 1, "the attendance refusal must fail the run, not merely annotate it")
        self.assertIn("VERDICT: REFUSED  aumlok:unsigned-wrapper-claims-attendance", out)
        result = cli_json("--approval", str(FIXTURES / "wrapper-claims-attendance.json"),
                          "--approval-anchor", str(self.a),
                          "--expect", "aumlok:unsigned-wrapper-claims-attendance")
        self.assertEqual(result["rc"], 0, "…and it must be assertable by that exact name")
        self.assertEqual(result["report"]["verdict"], "aumlok:unsigned-wrapper-claims-attendance")
        self.assertIs(result["report"]["approval"]["attendance"]["proven"], False)

    def test_17_an_approval_without_a_separate_anchor_is_refused(self):
        rc, out = run_cli("--approval", str(FIXTURES / "honest.json"), "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  APPROVAL_ANCHOR_ABSENT", out)

    def test_18_the_consumers_own_arms_still_hold_with_the_lane_present(self):
        # No approval document: nothing about lane A can have changed the consumer's verdicts.
        rc, out = run_cli("--expect", "verified")
        self.assertEqual(rc, 0)
        self.assertIn("VERDICT: VERIFIED (the checks above hold for these bytes)", out)
        rc, out = run_cli("--anchor", str(EVIDENCE / "other-issuer.pk"), "--expect", "anchor-mismatch")
        self.assertEqual(rc, 0)

    def test_19_an_unreadable_approval_document_fails_the_run_by_name(self):
        rc, out = run_cli("--approval", str(EVIDENCE / "absent-approval.json"),
                          "--approval-anchor", str(self.a), "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  approval-unreadable", out)
        # The facet status carries the SAME name as the verdict: two lines, one decision.
        self.assertIn("STATUS              : approval-unreadable", out)
        result = cli_json("--approval", str(EVIDENCE / "absent-approval.json"),
                          "--approval-anchor", str(self.a), "--expect", "approval-unreadable")
        self.assertEqual(result["rc"], 0)
        self.assertEqual(result["report"]["verdict"], "approval-unreadable")
        self.assertEqual(result["report"]["approval"]["status"], "approval-unreadable")


if __name__ == "__main__":
    unittest.main()
