"""Controls for consuming the REAL Aumlok approval artifact, in Diamond, offline.

    python3 -B tests/kira-artifact/test_kira_artifact.py

EVERY CONTROL RUNS A REAL PROCESS FROM AN EMPTY WORKING DIRECTORY, offline, with no Genesis code
importable and no network. The fixtures were produced by the PINNED CURRENT PRODUCER — Genesis's own
`scripts/aumlok/approve-operation`, its `signer.mjs` in the labelled `test-all` mode, and Kira's own
`createMemoryOwner` — at the commit recorded in `fixtures/PROVENANCE.json`. The script that produced
them is `make-fixtures.mjs`; it signs nothing itself and is not run by CI.

TWO LANES ARE CONTROLLED, because a defect in either one is invisible from the other:

  A. the standalone verifier, `python3 -m diamond.approval_artifact`
  B. the SAME artifact through `scripts/verify-kira-evidence.py --artifact`, where a failed required
     approval check must fail the whole run with a named reason and the printed verdict, the JSON
     report and the exit status must agree

THE CONTROLS THE BRIEF NAMES, and what each one is allowed to conclude:

    changed payload                → APPROVAL_CONTENT_MISMATCH
    missing / doubled newline      → APPROVAL_CONTENT_NOT_CANONICAL (the bytes are not the object body)
    wrong record                   → APPROVAL_RECORD_MISMATCH
    wrong anchor                   → APPROVAL_KEY_MISMATCH, and no anchor is refused too
    forged signature               → APPROVAL_SIGNATURE_INVALID
    valid approval, other content  → APPROVAL_CONTENT_MISMATCH
    mismatched receipt linkage     → APPROVAL_RECEIPT_LINKAGE_MISMATCH / _APPROVAL_ABSENT
    rewritten unsigned labels      → REPORTED and unsigned, and the three unearnable labels refused
    first receipt after write two  → still VERIFIED, linkage intact

WHAT NO CONTROL MAY CONCLUDE. That a person attended. That the approver is a REGISTERED key (that is
the composition's pin, and with no pin the verdict says so). That the artifact authorizes anything: an
approval is evidence, and evidence never authorizes.
"""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
# The SUITE may import the package in-process for the arithmetic controls (base58btc, the record
# identity rule). The CONSUMER is never run that way: every arm below is a separate process from an
# empty directory, which is the property those arms exist to measure.
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
FIXTURES = HERE / "fixtures"
LEGACY = REPO / "tests" / "kira-evidence" / "evidence"
WRAPPER_FIXTURES = REPO / "tests" / "aumlok-approval" / "fixtures"
CLI = REPO / "scripts" / "verify-kira-evidence.py"
NEUTRAL = Path(tempfile.mkdtemp(prefix="kira-artifact-neutral-")).resolve()
SCRATCH = Path(tempfile.mkdtemp(prefix="kira-artifact-scratch-")).resolve()

ENV = {"PATH": "/usr/bin:/bin", "PYTHONPATH": str(REPO), "PYTHONDONTWRITEBYTECODE": "1"}

#: The commit whose producer these fixtures are evidence about. Written here so a fixture that
#: silently came from a different producer is a FAILURE rather than a footnote.
PINNED_GENESIS_COMMIT = "20af274abd6fd70f7d44067a72965e9672dd0fdd"

RECORD_ONE = FIXTURES / "content-1.txt"
RECORD_TWO = FIXTURES / "content-2.txt"
ARTIFACT_ONE = FIXTURES / "artifact-1.json"
ARTIFACT_TWO = FIXTURES / "artifact-2.json"
ANCHOR_HEX = FIXTURES / "approver.pk"
ANCHOR_DID = FIXTURES / "approver-did.txt"
ANCHOR_PEM = FIXTURES / "approver.pem"
ISSUER_PEM = FIXTURES / "issuer.pem"


def fixture_record_file(name: str) -> Path:
    """The RECORD inside one content fixture, written out as its own file.

    The content bytes are `{key, value}` — the object the settlement stores — so the record is the
    `value`. Deriving it here rather than committing a second copy keeps one artifact to keep honest.
    """
    target = SCRATCH / f"{name}-record.json"
    if not target.exists():
        value = json.loads((FIXTURES / name).read_text())["value"]
        target.write_text(json.dumps(value, indent=2) + "\n")
    return target


def mutated_artifact(name: str, **changes) -> Path:
    """One artifact fixture with fields replaced, for the controls that must be refused."""
    document = json.loads(ARTIFACT_ONE.read_text())
    for field, value in changes.items():
        document[field] = value
    target = SCRATCH / f"{name}.json"
    target.write_text(json.dumps(document, indent=2) + "\n")
    return target


def content_variant(name: str, transform) -> Path:
    target = SCRATCH / f"{name}.txt"
    target.write_bytes(transform(RECORD_ONE.read_bytes()))
    return target


def run_module(*args: str) -> tuple[int, str]:
    proc = subprocess.run([sys.executable, "-B", "-m", "diamond.approval_artifact", *args],
                          cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def module_json(*args: str) -> dict:
    rc, out = run_module(*args, "--json")
    return {"rc": rc, **json.loads(out)}


def run_cli_for(record: str, receipt: str, *args: str) -> tuple[int, str]:
    """The combined consumer, as its own process, from the empty cwd, over ONE producer write."""
    proc = subprocess.run(
        [sys.executable, "-B", str(CLI),
         "--record", str(fixture_record_file(record)),
         "--receipt", str(FIXTURES / receipt),
         "--log", str(FIXTURES / "aura.jsonl"),
         "--anchor", str(ISSUER_PEM), *args],
        cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def run_cli(*args: str) -> tuple[int, str]:
    return run_cli_for("content-1.txt", "receipt-1.json", *args)


def cli_json_for(record: str, receipt: str, *args: str) -> dict:
    rc, out = run_cli_for(record, receipt, *args, "--json")
    block = out.split("REPORT-JSON-BEGIN")[1].split("REPORT-JSON-END")[0]
    return {"rc": rc, "report": json.loads(block), "text": out}


def cli_json(*args: str) -> dict:
    return cli_json_for("content-1.txt", "receipt-1.json", *args)


class CurrentProducerFixtureTests(unittest.TestCase):
    """The fixtures themselves: whose producer they are evidence about, and that nothing was typed."""

    def setUp(self) -> None:
        self.assertEqual(sorted(p.name for p in NEUTRAL.iterdir()), [], "neutral cwd must stay empty")
        self.provenance = json.loads((FIXTURES / "PROVENANCE.json").read_text())

    def test_the_fixtures_name_the_current_producer_and_its_own_commands(self) -> None:
        self.assertEqual(self.provenance["genesisCommit"], PINNED_GENESIS_COMMIT)
        self.assertIn("test-all", self.provenance["signer"])
        self.assertIn("not a person", self.provenance["signer"])
        self.assertEqual(len(self.provenance["records"]), 2)
        commands = " ".join(entry["command"] for entry in self.provenance["commands"])
        self.assertIn("scripts/aumlok/approve-operation", commands)
        self.assertIn("scripts/aumlok/make-disposable-identity.mjs", commands)
        # The signer is a DAEMON, so its command is recorded as a string rather than in the run log.
        self.assertIn("scripts/aumlok/signer.mjs", self.provenance["signerCommand"])
        self.assertIn("test-all", self.provenance["signerCommand"])

    def test_the_artifact_is_the_flat_record_and_not_the_retired_wrapper(self) -> None:
        artifact = json.loads(ARTIFACT_ONE.read_text())
        self.assertEqual(artifact["domain"], "aukora:approval-receipt:v1")
        self.assertEqual(artifact["verdict"], "OWNER_KEY_SIGNED")
        self.assertNotIn("request", artifact)
        self.assertNotIn("response", artifact)
        self.assertNotEqual(artifact.get("kind"), "aukora-kira-owner-approval-bundle/v1")

    def test_the_committed_digests_match_the_committed_bytes(self) -> None:
        # A fixture is only evidence if the file in the tree still hashes to what PROVENANCE records.
        for entry in self.provenance["records"]:
            with self.subTest(record=entry["index"]):
                content = (FIXTURES / entry["contentFile"]).read_bytes()
                artifact = (FIXTURES / entry["artifactFile"]).read_bytes()
                receipt = (FIXTURES / entry["receiptFile"]).read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(), entry["contentSha256"])
                self.assertEqual(hashlib.sha256(artifact).hexdigest(), entry["artifactSha256"])
                self.assertEqual(hashlib.sha256(receipt).hexdigest(), entry["receiptSha256"])
                # …and the digest in the artifact is the LITERAL rule over those bytes.
                derived = hashlib.sha256(b"aukora:operation-content:v1\x00" + content).hexdigest()
                self.assertEqual(derived, entry["operationDigest"])

    def test_the_record_identity_is_the_producers_own(self) -> None:
        value = json.loads(RECORD_ONE.read_text())
        from diamond.kira_evidence import compute_record_id
        self.assertEqual(compute_record_id(value["value"]), value["key"])
        self.assertEqual(value["value"]["recordId"], value["key"])


class ApprovalArtifactModuleTests(unittest.TestCase):
    """Lane A: `python3 -m diamond.approval_artifact`."""

    def setUp(self) -> None:
        self.anchor = str(ANCHOR_HEX)

    def test_1_the_current_artifact_verifies_against_the_real_content(self) -> None:
        result = module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor, "--record", str(fixture_record_file("content-1.txt")),
                             "--object", str(FIXTURES / "objects" / f"{json.loads((FIXTURES / 'PROVENANCE.json').read_text())['records'][0]['contentSha256']}.json"),
                             "--receipt", str(FIXTURES / "receipt-1.json"))
        self.assertEqual(result["rc"], 0)
        findings = result["findings"]
        self.assertEqual(result["summary"]["status"], "APPROVAL_ARTIFACT_VERIFIED")
        self.assertEqual(findings["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        self.assertEqual(findings["anchor"]["status"], "ANCHOR_MATCHES_ARTIFACT_KEY")
        # THE BINDING IS DERIVED HERE, from the bytes supplied to THIS verifier.
        self.assertEqual(findings["operation_binding"]["status"], "OPERATION_BINDING_VERIFIED")
        self.assertEqual(findings["operation_binding"]["derivedOperationDigest"],
                         findings["operation_binding"]["artifactOperationDigest"])
        self.assertEqual(findings["signed_bytes_digest"]["status"], "SIGNED_BYTES_DIGEST_MATCH")
        self.assertEqual(findings["record_identity"]["status"], "RECORD_IDENTITY_MATCH")
        self.assertEqual(findings["object_digest"]["status"], "OBJECT_DIGEST_MATCH")
        self.assertEqual(findings["receipt_approval_linkage"]["status"], "RECEIPT_APPROVAL_LINKED")
        self.assertEqual(findings["subject"]["status"], "SUBJECT_MATCHES_RECORD")
        # The window is NOT checked without a clock, and the labels are REPORTED, never verified.
        self.assertEqual(findings["window"]["status"], "NOT_CHECKED")
        self.assertEqual(findings["classification"]["status"], "REPORTED")
        self.assertIs(findings["classification"]["signed"], False)
        self.assertEqual(findings["authorization"]["status"], "OWNER_APPROVAL_UNCHECKED")
        self.assertEqual(findings["attendance"]["status"], "reported-not-proven")
        self.assertIs(findings["attendance"]["proven"], False)
        # The three findings the producer keeps apart are apart here too.
        self.assertNotEqual(findings["approvalId"], findings["signature"]["preimageSha256"])

    def test_2_the_anchor_may_be_hex_a_did_key_or_a_pem_and_they_are_the_same_key(self) -> None:
        arms = {"hex": str(ANCHOR_HEX), "did": str(ANCHOR_DID), "pem": str(ANCHOR_PEM)}
        sources = {}
        for name, anchor in arms.items():
            with self.subTest(anchor=name):
                result = module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                                     "--anchor", anchor)
                self.assertEqual(result["rc"], 0)
                sources[name] = result["findings"]["anchor"]["anchorKeyHex"]
        self.assertEqual(len(set(sources.values())), 1, "the three spellings must be ONE key")

    def test_3_a_changed_payload_or_a_changed_newline_is_refused(self) -> None:
        arms = {
            "changed-payload": (content_variant("payload", lambda b: b.replace(b"Cedar", b"Ced4r")),
                                "APPROVAL_CONTENT_MISMATCH"),
            "no-newline": (content_variant("no-newline", lambda b: b.rstrip(b"\n")),
                           "APPROVAL_CONTENT_NOT_CANONICAL"),
            "doubled-newline": (content_variant("double-newline", lambda b: b + b"\n"),
                                "APPROVAL_CONTENT_NOT_CANONICAL"),
            "reformatted-json": (content_variant("reformatted", lambda b: b.replace(b'{"key"', b'{ "key"')),
                                 "APPROVAL_CONTENT_NOT_CANONICAL"),
        }
        for name, (content, expected) in arms.items():
            with self.subTest(arm=name):
                rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(content),
                                     "--anchor", self.anchor)
                self.assertEqual(rc, 1)
                self.assertIn(expected, out)
                self.assertIn(f"STATUS: {expected}", out)

    def test_4_a_wrong_record_is_refused(self) -> None:
        # The record of the OTHER write, present but not the one the content addresses.
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor,
                             "--record", str(fixture_record_file("content-2.txt")))
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_RECORD_MISMATCH", out)
        # …and the record the content DOES carry still verifies, so the control discriminates.
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor,
                             "--record", str(fixture_record_file("content-1.txt")))
        self.assertEqual(rc, 0)

    def test_5_a_wrong_anchor_is_refused_and_so_is_no_anchor(self) -> None:
        # The Kira issuer's key is a real key, and it is not the approver.
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", str(ISSUER_PEM))
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_KEY_MISMATCH", out)
        # A key the artifact itself names is never promoted to an anchor: with no anchor supplied,
        # the answer is a refusal rather than a verification against the document's own claim.
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", "")
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_KEY_MISMATCH", out)
        result = module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE), "--anchor", "")
        self.assertIn("no unanchored mode", result["findings"]["refusal"]["detail"])

    def test_6_a_forged_signature_is_refused_without_reassuring_prose(self) -> None:
        forged = mutated_artifact("forged", signature="00" + json.loads(ARTIFACT_ONE.read_text())["signature"][2:])
        rc, out = run_module("--artifact", str(forged), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor)
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_SIGNATURE_INVALID", out)
        self.assertNotIn("signature valid", out.lower())
        # The rest of the artifact is untouched, so the refusal is about the SIGNATURE and nothing else.
        result = module_json("--artifact", str(forged), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor)
        self.assertEqual(result["findings"]["operation_binding"]["status"], "OPERATION_BINDING_VERIFIED")
        self.assertEqual(result["findings"]["signed_bytes_digest"]["status"],
                         "SIGNED_BYTES_DIGEST_MATCH")

    def test_7_a_valid_approval_for_a_different_operation_is_refused(self) -> None:
        # Artifact 2 is REAL: a genuine signature, over the OTHER operation, under the same key.
        for artifact, content in ((ARTIFACT_TWO, RECORD_ONE), (ARTIFACT_ONE, RECORD_TWO)):
            with self.subTest(artifact=artifact.name, content=content.name):
                rc, out = run_module("--artifact", str(artifact), "--content", str(content),
                                     "--anchor", self.anchor)
                self.assertEqual(rc, 1)
                self.assertIn("APPROVAL_CONTENT_MISMATCH", out)
        # Both verify against their OWN content, so the control is not a blanket refusal.
        self.assertEqual(module_json("--artifact", str(ARTIFACT_TWO), "--content", str(RECORD_TWO),
                                     "--anchor", self.anchor)["rc"], 0)

    def test_8_a_mismatched_receipt_approval_linkage_is_refused(self) -> None:
        # Receipt 2 is genuine and names approval TWO; artifact ONE is presented.
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor, "--receipt", str(FIXTURES / "receipt-2.json"))
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_RECEIPT_LINKAGE_MISMATCH", out)
        # A LEGACY receipt carries no approval block at all: absence is a refusal, not a pass.
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor, "--receipt", str(LEGACY / "receipt-1.json"))
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_RECEIPT_APPROVAL_ABSENT", out)
        # …and the genuine pair links, so the control discriminates.
        self.assertEqual(module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                                     "--anchor", self.anchor,
                                     "--receipt", str(FIXTURES / "receipt-1.json"))["rc"], 0)

    def test_9_rewritten_unsigned_labels_are_reported_and_never_verified(self) -> None:
        # THE MEASURED LIMIT, as a control. `approvalClass`, `keyClass`, `keyClassMeaning` and
        # `ceilings` are OUTSIDE the signed preimage, so an editor can rewrite them and the signature
        # still verifies. This consumer therefore reports them as REPORTED and refuses the labels it
        # cannot stand behind — it does not print them beside a green as if they were earned.
        relabelled = mutated_artifact("relabelled", approvalClass="delegated", keyClass="C",
                                      keyClassMeaning="operator-custodied",
                                      ceilings=["REWRITTEN BY AN EDITOR"])
        result = module_json("--artifact", str(relabelled), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor)
        self.assertEqual(result["rc"], 0, "an unsigned label is not a signature failure")
        findings = result["findings"]
        self.assertEqual(findings["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        self.assertEqual(findings["signed_bytes_digest"]["status"], "SIGNED_BYTES_DIGEST_MATCH")
        self.assertEqual(findings["classification"]["status"], "REPORTED")
        self.assertIs(findings["classification"]["signed"], False)
        self.assertEqual(findings["classification"]["fields"]["approvalClass"], "delegated")
        self.assertEqual(findings["classification"]["fields"]["ceilings"], ["REWRITTEN BY AN EDITOR"])
        # …and with its receipt, the relabelling is REFUSED as a LABEL disagreement.
        rc, out = run_module("--artifact", str(relabelled), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor, "--receipt", str(FIXTURES / "receipt-1.json"))
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_RECEIPT_LINKAGE_MISMATCH", out)
        self.assertIn("UNSIGNED LABELS", out)

    def test_10_the_three_unearnable_labels_are_refused_by_name(self) -> None:
        arms = {
            "human-ceremony": ("human-ceremony", "APPROVAL_CLASS_UNSUPPORTED"),
            "attended": ("attended", "APPROVAL_ATTENDANCE_UNSUPPORTED"),
        }
        for name, (value, expected) in arms.items():
            with self.subTest(arm=name):
                field = "approvalClass" if name == "human-ceremony" else "attendance"
                document = mutated_artifact(f"label-{name}", **{field: value})
                rc, out = run_module("--artifact", str(document), "--content", str(RECORD_ONE),
                                     "--anchor", self.anchor)
                self.assertEqual(rc, 1)
                self.assertIn(expected, out)
        bound = mutated_artifact("label-identity-bound", identityBound=True)
        rc, out = run_module("--artifact", str(bound), "--content", str(RECORD_ONE),
                             "--anchor", self.anchor)
        self.assertEqual(rc, 1)
        self.assertIn("APPROVAL_IDENTITY_BOUND_UNSUPPORTED", out)

    def test_11_the_retired_wrapper_is_refused_by_name_and_recognised(self) -> None:
        retired = SCRATCH / "retired.json"
        retired.write_text(json.dumps({
            "kind": "aukora-kira-owner-approval-bundle/v1", "source": "legacy",
            "request": {"domain": "aukora:owner-approval-request:v1"}, "response": {}, "approverDid": "did:key:z6Mk",
        }))
        result = module_json("--artifact", str(retired), "--content", str(RECORD_ONE),
                             "--anchor", str(ANCHOR_HEX))
        self.assertEqual(result["rc"], 1)
        self.assertEqual(result["findings"]["refusal"]["code"], "APPROVAL_MALFORMED")
        self.assertEqual(result["findings"]["retiredDomainRecognised"],
                         "aukora-kira-owner-approval-bundle/v1")
        self.assertIn("RETIRED", result["findings"]["refusal"]["detail"])

    def test_12_the_window_is_checked_only_when_the_caller_supplies_the_clock(self) -> None:
        open_arm = module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                               "--anchor", str(ANCHOR_HEX), "--now", "1800000000")
        self.assertEqual(open_arm["rc"], 0)
        self.assertEqual(open_arm["findings"]["window"]["status"], "OPEN")
        closed_arm = module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                                 "--anchor", str(ANCHOR_HEX), "--now", "4202444800")
        self.assertEqual(closed_arm["rc"], 1)
        self.assertEqual(closed_arm["findings"]["window"]["status"], "EXPIRED")
        self.assertIn("APPROVAL_EXPIRED", closed_arm["summary"]["status"])
        # Without a clock, a closed window is NOT inferred: an approval consumed long ago is not
        # false because time passed, and the finding says which question was not asked.
        untimed = module_json("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                              "--anchor", str(ANCHOR_HEX))
        self.assertEqual(untimed["findings"]["window"]["status"], "NOT_CHECKED")
        self.assertIn("no clock was supplied", untimed["findings"]["window"]["why"])

    def test_13_the_did_key_column_matches_the_published_specification_vector(self) -> None:
        from diamond.approval_artifact import (base58btc_decode, base58btc_encode, did_key_from_raw,
                                               raw_from_did_key)
        published_did = "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP"
        published_key = "095f9a1a595dde755d82786864ad03dfa5a4fbd68832566364e2b65e13cc9e44"
        self.assertEqual(raw_from_did_key(published_did), published_key)
        self.assertEqual(did_key_from_raw(published_key), published_did)
        self.assertEqual(base58btc_encode(bytes((0, 0, 1))), "112")
        self.assertEqual(base58btc_decode("112"), bytes((0, 0, 1)))
        self.assertEqual(did_key_from_raw(ANCHOR_HEX.read_text().strip()),
                         ANCHOR_DID.read_text().strip())

    def test_14_text_json_and_exit_status_cannot_disagree(self) -> None:
        arms = [
            (("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE)), 0,
             "APPROVAL_ARTIFACT_VERIFIED"),
            (("--artifact", str(ARTIFACT_TWO), "--content", str(RECORD_ONE)), 1,
             "APPROVAL_CONTENT_MISMATCH"),
        ]
        for args, expected_rc, expected_status in arms:
            with self.subTest(status=expected_status):
                result = module_json(*args, "--anchor", str(ANCHOR_HEX))
                rc, out = run_module(*args, "--anchor", str(ANCHOR_HEX))
                summary = result["summary"]
                self.assertEqual(result["rc"], expected_rc)
                self.assertEqual(rc, expected_rc)
                self.assertEqual(summary["status"], expected_status)
                self.assertEqual(summary["fails_verification"], expected_rc == 1)
                self.assertIn(f"STATUS: {expected_status}", out)
                if expected_rc == 1:
                    self.assertIn(expected_status, summary["reason"])
                    self.assertEqual(summary["refusal"]["code"], expected_status)

    def test_15_no_producer_code_is_importable_and_the_cwd_stayed_empty(self) -> None:
        rc, out = run_module("--artifact", str(ARTIFACT_ONE), "--content", str(RECORD_ONE),
                             "--anchor", str(ANCHOR_HEX))
        self.assertEqual(rc, 0)
        self.assertNotIn("genesis", out.lower())
        self.assertEqual(sorted(p.name for p in NEUTRAL.iterdir()), [])


class CombinedCliArtifactLaneTests(unittest.TestCase):
    """Lane B: the SAME artifact through `scripts/verify-kira-evidence.py`."""

    def setUp(self) -> None:
        self.artifact_args = ("--artifact", str(ARTIFACT_ONE), "--artifact-content", str(RECORD_ONE),
                              "--artifact-anchor", str(ANCHOR_HEX), "--store", str(FIXTURES))

    def test_16_the_combined_cli_verifies_the_real_artifact_end_to_end(self) -> None:
        result = cli_json(*self.artifact_args, "--expect", "verified")
        self.assertEqual(result["rc"], 0)
        report = result["report"]
        self.assertEqual(report["verdict"], "verified")
        self.assertIs(report["verified"], True)
        # The receipt is the CURRENT producer's, and the consumer says WHICH closed profile it read.
        self.assertEqual(report["receiptProfile"], "current-with-approval")
        self.assertEqual(report["approval"]["status"], "APPROVAL_ARTIFACT_VERIFIED")
        findings = report["approvalArtifactFindings"]
        self.assertEqual(findings["operation_binding"]["status"], "OPERATION_BINDING_VERIFIED")
        self.assertEqual(findings["receipt_approval_linkage"]["status"], "RECEIPT_APPROVAL_LINKED")
        self.assertIn("LANE                : aumlok approval ARTIFACT", result["text"])
        self.assertIn("VERDICT: VERIFIED", result["text"])

    def test_17_a_failed_artifact_check_fails_the_whole_run_with_a_named_reason(self) -> None:
        forged = mutated_artifact("cli-forged",
                                  signature="00" + json.loads(ARTIFACT_ONE.read_text())["signature"][2:])
        args = ("--artifact", str(forged), "--artifact-content", str(RECORD_ONE),
                "--artifact-anchor", str(ANCHOR_HEX))
        # The defect this control exists for: a failed approval check that still reported VERIFIED.
        rc, out = run_cli(*args, "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  APPROVAL_SIGNATURE_INVALID", out)
        result = cli_json(*args, "--expect", "APPROVAL_SIGNATURE_INVALID")
        self.assertEqual(result["rc"], 0, "the named refusal is assertable as an expectation")
        report = result["report"]
        self.assertIs(report["verified"], False)
        self.assertEqual(report["verdict"], "APPROVAL_SIGNATURE_INVALID")
        self.assertEqual(report["refusalLane"], "owner_approval_artifact")
        self.assertEqual(report["approvalRefusal"]["code"], "APPROVAL_SIGNATURE_INVALID")
        # The lane's own word, the JSON verdict and the printed line are one decision.
        self.assertEqual(report["approval"]["status"], "APPROVAL_SIGNATURE_INVALID")
        self.assertIn("VERDICT: REFUSED  APPROVAL_SIGNATURE_INVALID", result["text"])

    def test_18_a_mismatched_receipt_linkage_fails_the_run(self) -> None:
        # A SECOND GENUINE approval over the SAME content: same record, same bytes, same digest, a
        # different challenge and signature. Only the receipt's approval block can tell them apart, so
        # this arm isolates the linkage from every other check.
        args = ("--artifact", str(FIXTURES / "artifact-1b.json"),
                "--artifact-content", str(RECORD_ONE), "--artifact-anchor", str(ANCHOR_HEX))
        rc, out = run_cli(*args, "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  APPROVAL_RECEIPT_LINKAGE_MISMATCH", out)
        result = cli_json(*args, "--expect", "APPROVAL_RECEIPT_LINKAGE_MISMATCH")
        self.assertEqual(result["rc"], 0)
        report = result["report"]
        self.assertEqual(report["verdict"], "APPROVAL_RECEIPT_LINKAGE_MISMATCH")
        self.assertEqual(report["refusalLane"], "owner_approval_artifact")
        # Every OTHER check passed, so the refusal is about the linkage and nothing else.
        findings = report["approvalArtifactFindings"]
        self.assertEqual(findings["signature"]["status"], "APPROVAL_SIGNATURE_VALID")
        self.assertEqual(findings["operation_binding"]["status"], "OPERATION_BINDING_VERIFIED")
        self.assertEqual(findings["record_identity"]["status"], "RECORD_IDENTITY_MATCH")
        # …and the SAME record and content with the receipt's OWN artifact links.
        linked = cli_json("--artifact", str(ARTIFACT_ONE), "--artifact-content", str(RECORD_ONE),
                          "--artifact-anchor", str(ANCHOR_HEX), "--expect", "verified")
        self.assertEqual(linked["rc"], 0)
        self.assertEqual(linked["report"]["verdict"], "verified")

    def test_19_the_first_receipt_still_verifies_after_the_second_write(self) -> None:
        # The producer's own bundle: two settlements, and receipt #1 names entry 1 of a 2-entry log.
        pairs = (("content-1.txt", "receipt-1.json", "artifact-1.json", 1),
                 ("content-2.txt", "receipt-2.json", "artifact-2.json", 0))
        for record, receipt, artifact, entries_after in pairs:
            with self.subTest(receipt=receipt):
                result = cli_json_for(
                    record, receipt,
                    "--artifact", str(FIXTURES / artifact),
                    "--artifact-content", str(FIXTURES / record),
                    "--artifact-anchor", str(ANCHOR_HEX), "--store", str(FIXTURES),
                    "--expect", "verified")
                self.assertEqual(result["rc"], 0)
                report = result["report"]
                self.assertEqual(report["position"]["entriesAfterPosition"], entries_after)
                self.assertEqual(report["approval"]["status"], "APPROVAL_ARTIFACT_VERIFIED")
                self.assertEqual(report["approvalArtifactFindings"]["receipt_approval_linkage"]["status"],
                                 "RECEIPT_APPROVAL_LINKED")
        # THE OTHER DIRECTION, and it refuses one check EARLIER — which is the useful measurement.
        # Presenting write 1's approval with write 2's record and content is not a linkage mismatch:
        # the record the content carries is not the record the lane was given, and that is refused
        # first, by name. A cross-write pairing cannot even reach the linkage check, and a court that
        # expected `LINKAGE_MISMATCH` here would be asserting the wrong mechanism.
        crossed = cli_json_for(
            "content-2.txt", "receipt-2.json",
            "--artifact", str(FIXTURES / "artifact-1b.json"),
            "--artifact-content", str(RECORD_ONE), "--artifact-anchor", str(ANCHOR_HEX),
            "--expect", "verified")
        self.assertEqual(crossed["rc"], 1)
        self.assertEqual(crossed["report"]["verdict"], "APPROVAL_RECORD_MISMATCH")
        self.assertEqual(crossed["report"]["refusalLane"], "owner_approval_artifact")
        self.assertEqual(
            crossed["report"]["approvalArtifactFindings"]["operation_binding"]["status"],
            "OPERATION_BINDING_VERIFIED",
            "the digest still matches: the refusal is about WHICH RECORD, not about the bytes")

    def test_20_the_wrapper_lane_is_still_there_and_is_NAMED_as_the_older_document(self) -> None:
        # The controls that caught an invalid approval returning exit 0 live in this lane, and this
        # increment does not retire them: the older request/response document is still verified, and
        # the run says WHICH lane produced the verdict.
        result = cli_json("--approval", str(WRAPPER_FIXTURES / "honest.json"),
                          "--approval-anchor", str(WRAPPER_FIXTURES / "anchor-a.pk"),
                          "--expect", "verified")
        self.assertEqual(result["rc"], 0)
        self.assertEqual(result["report"]["approval"]["status"], "OWNER_APPROVAL_SIGNATURE_VALID")
        self.assertIn("owner-approval document, offline", result["report"]["approvalLane"])
        rc, _ = run_cli("--approval", str(WRAPPER_FIXTURES / "forged.json"),
                        "--approval-anchor", str(WRAPPER_FIXTURES / "anchor-a.pk"),
                        "--expect", "verified")
        self.assertEqual(rc, 1, "a forged wrapper still fails the run")

    def test_21_with_no_approval_document_the_bundle_is_unchecked_and_legacy(self) -> None:
        # The legacy bundle, unchanged: its receipt takes the LEGACY closed profile and facet 5 has no
        # approval document to check, so it stays OWNER_APPROVAL_UNCHECKED — absence is not a pass.
        proc = subprocess.run(
            [sys.executable, "-B", str(CLI),
             "--record", str(LEGACY / "fixture" / "record.json"),
             "--receipt", str(LEGACY / "receipt-1.json"),
             "--log", str(LEGACY / "aura.jsonl"),
             "--anchor", str(LEGACY / "issuer.pk"), "--expect", "verified", "--json"],
            cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV)
        self.assertEqual(proc.returncode, 0)
        report = json.loads(proc.stdout.split("REPORT-JSON-BEGIN")[1].split("REPORT-JSON-END")[0])
        self.assertEqual(report["receiptProfile"], "legacy-no-approval")
        self.assertIs(report["receiptApprovalBlock"], None)
        self.assertEqual(report["approval"]["status"], "OWNER_APPROVAL_UNCHECKED")
        self.assertIn("STATUS              : OWNER_APPROVAL_UNCHECKED", proc.stdout)

    def test_22_an_unreadable_artifact_fails_by_name(self) -> None:
        rc, out = run_cli("--artifact", str(SCRATCH / "absent-artifact.json"),
                          "--artifact-content", str(RECORD_ONE), "--artifact-anchor", str(ANCHOR_HEX),
                          "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  artifact-unreadable", out)
        # A missing --artifact-content is the same class of failure: the check was asked for and the
        # caller did not supply the bytes it needs to derive anything.
        rc, out = run_cli("--artifact", str(ARTIFACT_ONE), "--artifact-anchor", str(ANCHOR_HEX),
                          "--expect", "verified")
        self.assertEqual(rc, 1)
        self.assertIn("VERDICT: REFUSED  artifact-unreadable", out)
        self.assertIn("--artifact-content is required", out)


class AcceptanceExportAndIsolationTests(unittest.TestCase):
    """The ACCEPTANCE harness's own contract: export input, named failures, enforced isolation.

    These run the tooling directly (fast, targeted) rather than repeating the whole arm matrix, which
    has its own CI step. Each one asserts a named failure or a named success — never prose.
    """

    def setUp(self) -> None:
        self.tooling = HERE / "export_input.py"
        self.probe = HERE / "isolation_probe.py"
        self.closure = Path(tempfile.mkdtemp(prefix="kira-artifact-closure-")).resolve()
        (self.closure / "diamond").mkdir()
        for module in ("__init__.py", "kira_evidence.py", "hexutil.py", "ed25519.py", "jcs.py",
                       "approval_artifact.py", "aumlok_approval.py"):
            (self.closure / "diamond" / module).write_bytes((REPO / "diamond" / module).read_bytes())
        self.consumer = self.closure / "verify-kira-evidence.py"
        self.consumer.write_bytes(CLI.read_bytes())
        self.neutral = Path(tempfile.mkdtemp(prefix="kira-artifact-isolation-cwd-")).resolve()

    def run_tooling(self, *args: str) -> tuple[int, str]:
        proc = subprocess.run([sys.executable, str(self.tooling), *args],
                              cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")

    def run_probe(self, *args: str, extra_path: str | None = None) -> tuple[int, str]:
        env = dict(ENV)
        env["PYTHONPATH"] = str(self.closure) + (f":{extra_path}" if extra_path else "")
        proc = subprocess.run(
            [sys.executable, "-B", str(self.probe), "--closure", str(self.closure),
             "--target", str(self.neutral), "--consumer", str(self.consumer), *args],
            cwd=str(NEUTRAL), capture_output=True, text=True, env=env)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")

    def export_variant(self, name: str, mutate) -> Path:
        directory = SCRATCH / f"export-{name}"
        if directory.exists():
            return directory
        shutil.copytree(FIXTURES, directory)
        manifest = json.loads((directory / "export.json").read_text())
        mutate(manifest)
        (directory / "export.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return directory

    def test_the_committed_export_is_validated_and_labelled(self) -> None:
        rc, out = self.run_tooling("--export", str(FIXTURES), "--issuer-anchor", str(ISSUER_PEM),
                                   "--approver-anchor", str(ANCHOR_HEX))
        self.assertEqual(rc, 0)
        self.assertIn("EXPORT_CLASS         : committed-fixture", out)
        # The label is printed WITH the caveat that it proves nothing about a running service.
        self.assertIn("a label is not proof that a running service produced these bytes", out)
        provenance = json.loads((FIXTURES / "PROVENANCE.json").read_text())
        self.assertIn(provenance["records"][0]["operationDigest"], out)

    def test_input_problems_fail_by_name_and_nonzero(self) -> None:
        no_manifest = SCRATCH / "no-manifest"
        no_manifest.mkdir(parents=True, exist_ok=True)
        cases = [
            ("no-manifest", no_manifest, "EXPORT_MANIFEST_MISSING", ()),
            ("no-issuer", FIXTURES, "EXPORT_ANCHOR_MISSING", ("--approver-anchor", str(ANCHOR_HEX))),
            ("no-approver", FIXTURES, "EXPORT_ANCHOR_MISSING", ("--issuer-anchor", str(ISSUER_PEM))),
        ]
        self.neutral.mkdir(parents=True, exist_ok=True)
        for name, directory, expected, anchors in cases:
            with self.subTest(case=name):
                args = ["--export", str(directory)]
                if anchors:
                    args += list(anchors)
                else:
                    args += ["--issuer-anchor", str(ISSUER_PEM), "--approver-anchor", str(ANCHOR_HEX)]
                rc, out = self.run_tooling(*args)
                self.assertEqual(rc, 2)
                self.assertIn(expected, out)

        variants = {
            "declares-anchors": (lambda d: d.update({"anchors": {"issuer": "x"}}),
                                 "EXPORT_ANCHORS_NOT_SEPARATE"),
            "disagrees": (lambda d: d["transaction"].update({"operationDigest": "11" * 32}),
                          "EXPORT_MANIFEST_DISAGREES_WITH_FILES"),
            "missing-file": (lambda d: d["files"].update({"receipt": "absent.json"}),
                             "EXPORT_FILE_MISSING"),
            "unknown-class": (lambda d: d.update({"class": "probably-fine"}), "EXPORT_CLASS_UNKNOWN"),
            "live-claim": (lambda d: d.update({"class": "live-produced"}),
                           "EXPORT_LIVE_EVIDENCE_MISSING"),
        }
        for name, (mutate, expected) in variants.items():
            with self.subTest(case=name):
                directory = self.export_variant(name, mutate)
                rc, out = self.run_tooling("--export", str(directory), "--issuer-anchor", str(ISSUER_PEM),
                                           "--approver-anchor", str(ANCHOR_HEX))
                self.assertEqual(rc, 2)
                self.assertIn(expected, out)

        # The second approval is REQUIRED and must be a genuinely different approval over the SAME
        # bytes: an export whose "second" approval is the first one cannot isolate the linkage check.
        same = self.export_variant("alt-is-the-same",
                                   lambda d: d["files"].update({"artifactAlt": "artifact-1.json"}))
        rc, out = self.run_tooling("--export", str(same), "--issuer-anchor", str(ISSUER_PEM),
                                   "--approver-anchor", str(ANCHOR_HEX))
        self.assertEqual(rc, 2)
        self.assertIn("EXPORT_ALT_APPROVAL_INVALID", out)

    def test_the_isolation_probe_is_green_honestly_and_refuses_an_outside_import_on_a_green_run(self) -> None:
        self.neutral.mkdir(parents=True, exist_ok=True)
        consumer_args = ("--", "--record", str(FIXTURES / "record.json"),
                         "--receipt", str(FIXTURES / "receipt-1.json"),
                         "--log", str(FIXTURES / "aura.jsonl"), "--anchor", str(ISSUER_PEM),
                         "--store", str(FIXTURES), "--artifact", str(ARTIFACT_ONE),
                         "--artifact-content", str(RECORD_ONE), "--artifact-anchor", str(ANCHOR_HEX),
                         "--expect", "verified")

        rc, out = self.run_probe(*consumer_args)
        self.assertEqual(rc, 0, out)
        self.assertIn("ISOLATION RESULT: GREEN", out)
        self.assertIn("outside imports RESOLVED       : 0", out)
        self.assertIn("outside modules in the final cache: 0", out)
        self.assertIn("EXPECTATION: verified OBSERVED", out)

        # The negative control: a temporary module OUTSIDE the closure, importable because the path
        # says so and IMPORTED before the consumer runs.
        outside = Path(tempfile.mkdtemp(prefix="kira-artifact-outside-")).resolve()
        (outside / "outside_probe_module.py").write_text('MARKER = "not in the closure"\n')
        rc, out = self.run_probe("--import-outside", "outside_probe_module", *consumer_args,
                                 extra_path=str(outside))
        self.assertNotEqual(rc, 0, "an outside import must fail the isolation arm")
        self.assertIn("ISOLATION: ISOLATION_IMPORT_OUTSIDE_CLOSURE", out)
        self.assertIn("outside_probe_module", out)
        # DETECTION, NOT A CRASH: the consumer's verification succeeded on this very run, and the
        # refusal says so. An arm that passed because the run was broken would prove nothing.
        self.assertIn("EXPECTATION: verified OBSERVED", out)
        self.assertIn("the consumer's verification SUCCEEDED", out)


class HarnessDefectRegressionsTests(unittest.TestCase):
    """Focused regressions for four defects a reviewer measured in the acceptance harness.

    Each one goes through the REAL entry point the defect lived in — the shell runner for the anchor
    requirement, the probe for the import and verdict guards — and each asserts a NAMED failure rather
    than prose. They exist because the harness's own claims are code, and a claim without a control is
    a sentence.
    """

    OUTSIDE_MODULE = "outside_probe_module"

    @classmethod
    def setUpClass(cls) -> None:
        cls.closure = Path(tempfile.mkdtemp(prefix="regression-closure-")).resolve()
        (cls.closure / "diamond").mkdir()
        for module in ("__init__.py", "kira_evidence.py", "hexutil.py", "ed25519.py", "jcs.py",
                       "approval_artifact.py", "aumlok_approval.py"):
            (cls.closure / "diamond" / module).write_bytes((REPO / "diamond" / module).read_bytes())
        cls.consumer = cls.closure / "verify-kira-evidence.py"
        cls.consumer.write_bytes(CLI.read_bytes())
        cls.outside_dir = Path(tempfile.mkdtemp(prefix="regression-outside-")).resolve()
        (cls.outside_dir / f"{cls.OUTSIDE_MODULE}.py").write_text('MARKER = "not in the closure"\n')
        cls.cwd = Path(tempfile.mkdtemp(prefix="regression-cwd-")).resolve()

    def probe(self, *args: str, python: str | None = None, path: str | None = None,
              cwd: Path | None = None) -> tuple[int, str]:
        env = dict(ENV)
        env["PYTHONPATH"] = path or str(self.closure)
        interpreter = python or sys.executable
        proc = subprocess.run(
            [interpreter, "-B", str(HERE / "isolation_probe.py"), "--closure", str(self.closure),
             "--target", str(cwd or self.cwd), "--consumer", str(self.consumer), *args],
            cwd=str(NEUTRAL), capture_output=True, text=True, env=env)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")

    def consumer_args(self) -> tuple[str, ...]:
        return ("--", "--record", str(FIXTURES / "record.json"),
                "--receipt", str(FIXTURES / "receipt-1.json"),
                "--log", str(FIXTURES / "aura.jsonl"), "--anchor", str(ISSUER_PEM),
                "--store", str(FIXTURES), "--artifact", str(ARTIFACT_ONE),
                "--artifact-content", str(RECORD_ONE), "--artifact-anchor", str(ANCHOR_HEX),
                "--expect", "verified")

    def test_1_the_runner_requires_each_external_anchor_independently(self) -> None:
        # THE DEFECT: one "an anchor was supplied" flag meant `--export X --issuer-anchor Y` ran every
        # arm against the COMMITTED FIXTURE's approver key, silently.
        export = Path(tempfile.mkdtemp(prefix="regression-export-")).resolve()
        shutil.rmtree(export)
        shutil.copytree(FIXTURES, export)
        runner = HERE / "run-empty-dir-arms.sh"
        cases = [
            ("issuer-only", ["--issuer-anchor", str(ISSUER_PEM)], "--approver-anchor"),
            ("approver-only", ["--approver-anchor", str(ANCHOR_HEX)], "--issuer-anchor"),
        ]
        for name, anchors, missing in cases:
            with self.subTest(case=name):
                target = Path(tempfile.mkdtemp(prefix=f"regression-target-{name}-")).resolve()
                shutil.rmtree(target)
                proc = subprocess.run(["bash", str(runner), str(target), "--export", str(export), *anchors],
                                      cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV)
                out = (proc.stdout or "") + (proc.stderr or "")
                self.assertEqual(proc.returncode, 2, out[-800:])
                self.assertIn("EXPORT_ANCHOR_MISSING", out)
                self.assertIn(missing, out)
                # It must refuse BEFORE staging: a run that started and then failed would still have
                # executed something against the wrong key.
                self.assertFalse((target / "closure").exists(),
                                 "the runner staged a closure before refusing the missing anchor")
        # Neither anchor: both are named in one refusal.
        target = Path(tempfile.mkdtemp(prefix="regression-target-none-")).resolve()
        shutil.rmtree(target)
        proc = subprocess.run(["bash", str(runner), str(target), "--export", str(export)],
                              cwd=str(NEUTRAL), capture_output=True, text=True, env=ENV)
        out = (proc.stdout or "") + (proc.stderr or "")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--issuer-anchor and --approver-anchor", out)

    def test_2_site_packages_is_not_the_standard_library(self) -> None:
        # THE DEFECT: `purelib`/`platlib` and whole interpreter prefixes were trusted as stdlib, so an
        # unlisted dependency installed in a virtual environment's site-packages imported while the
        # real consumer verified, and the probe reported GREEN with outside=0.
        venv = Path(tempfile.mkdtemp(prefix="regression-venv-")).resolve()
        shutil.rmtree(venv)
        made = subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(venv)],
                              capture_output=True, text=True)
        # A SKIP HERE WOULD REMOVE A MANDATORY CONTROL. Measured: a controlled setup returning 9
        # produced a successful unittest result with this regression silently skipped. The venv is a
        # PREREQUISITE of the control, not an option, so a failed setup is an assertion failure and the
        # run reports one failure rather than zero failures with one skip.
        self.assertEqual(made.returncode, 0,
                         f"mandatory venv control setup failed: {made.stdout}\n{made.stderr}")
        interpreter = venv / "bin" / "python"
        self.assertTrue(interpreter.exists(), made.stderr)
        site_packages = next((venv / "lib").glob("python*/site-packages"))
        (site_packages / "unlisted_dependency.py").write_text('MARKER = "beside the interpreter"\n')

        rc, out = self.probe("--import-outside", "unlisted_dependency", "--expect-verdict", "verified",
                             *self.consumer_args(), python=str(interpreter))
        self.assertEqual(rc, 3, out[-1200:])
        self.assertIn("ISOLATION: ISOLATION_IMPORT_OUTSIDE_CLOSURE", out)
        self.assertIn("unlisted_dependency", out)
        self.assertIn("site-packages", out)
        # The control is only meaningful because the consumer's own verification SUCCEEDED.
        self.assertIn("EXPECTATION: verified OBSERVED", out)
        self.assertIn("the consumer's verification SUCCEEDED", out)

    def test_3_a_failing_consumer_is_never_isolation_evidence(self) -> None:
        # THE DEFECT: the probe printed its expected verdict and returned 0 regardless of what the
        # consumer did, so a consumer exiting 7 produced probe exit 0 / GREEN.
        failing = self.cwd / "failing_consumer.py"
        failing.write_text('import sys\nprint("a consumer that fails")\nsys.exit(7)\n')
        rc, out = self.probe_with_consumer(failing, "--expect-verdict", "verified")
        self.assertEqual(rc, 4, out[-800:])
        self.assertIn("ISOLATION: CONSUMER_EXIT_NONZERO", out)
        self.assertNotIn("ISOLATION: ISOLATION_IMPORT_OUTSIDE_CLOSURE", out)
        self.assertNotIn("ISOLATION RESULT: GREEN", out)

        # …and an outside module on a CRASHED run must not be reported as detection either.
        crashing = self.cwd / "crashing_consumer.py"
        crashing.write_text('raise RuntimeError("unrelated crash")\n')
        rc, out = self.probe_with_consumer(
            crashing, "--expect-verdict", "verified", "--import-outside", self.OUTSIDE_MODULE,
            path=f"{self.closure}:{self.outside_dir}")
        self.assertNotEqual(rc, 0)
        self.assertIn("ISOLATION: CONSUMER_EXIT_NONZERO", out)
        self.assertIn("it is NOT counted as import-control detection", out)
        self.assertNotIn("the consumer's verification SUCCEEDED", out)

        # A consumer that exits 0 without the required verdict is refused by its own name.
        silent = self.cwd / "silent_consumer.py"
        silent.write_text('print("nothing the caller required")\n')
        rc, out = self.probe_with_consumer(silent, "--expect-verdict", "verified")
        self.assertEqual(rc, 4, out[-800:])
        self.assertIn("ISOLATION: CONSUMER_VERDICT_NOT_OBSERVED", out)

    def probe_with_consumer(self, consumer: Path, *args: str, path: str | None = None) -> tuple[int, str]:
        env = dict(ENV)
        env["PYTHONPATH"] = path or str(self.closure)
        proc = subprocess.run(
            [sys.executable, "-B", str(HERE / "isolation_probe.py"), "--closure", str(self.closure),
             "--target", str(self.cwd), "--consumer", str(consumer), *args],
            cwd=str(NEUTRAL), capture_output=True, text=True, env=env)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")

    def test_4_an_outside_import_is_detected_after_its_cache_entry_is_removed(self) -> None:
        # THE DEFECT: the guard inspected `sys.modules` before a first import could exist there and the
        # final snapshot could not see an entry that had been deleted — so a wrapper that imported an
        # outside module, dropped it from the cache and then ran the real consumer was GREEN.
        wrapper = self.cwd / "wrapper_consumer.py"
        wrapper.write_text(
            "import runpy, sys\n"
            f"import {self.OUTSIDE_MODULE}\n"
            f"del sys.modules['{self.OUTSIDE_MODULE}']\n"
            f"assert '{self.OUTSIDE_MODULE}' not in sys.modules\n"
            "target = sys.argv[1]\n"
            "sys.argv = [target] + sys.argv[2:]\n"
            "runpy.run_path(target, run_name='__main__')\n")
        rc, out = self.probe_with_consumer(
            wrapper, "--expect-verdict", "verified", "--",
            str(self.consumer), "--record", str(FIXTURES / "record.json"),
            "--receipt", str(FIXTURES / "receipt-1.json"), "--log", str(FIXTURES / "aura.jsonl"),
            "--anchor", str(ISSUER_PEM), "--store", str(FIXTURES), "--artifact", str(ARTIFACT_ONE),
            "--artifact-content", str(RECORD_ONE), "--artifact-anchor", str(ANCHOR_HEX),
            "--expect", "verified",
            path=f"{self.closure}:{self.outside_dir}")
        self.assertEqual(rc, 3, out[-1200:])
        self.assertIn("ISOLATION: ISOLATION_IMPORT_OUTSIDE_CLOSURE", out)
        self.assertIn(self.OUTSIDE_MODULE, out)
        # The cache no longer holds it — which is exactly why the record is taken at resolution time.
        self.assertIn("outside modules in the final cache: 0", out)
        self.assertIn("EXPECTATION: verified OBSERVED", out)
        self.assertIn("the consumer's verification SUCCEEDED", out)


if __name__ == "__main__":
    unittest.main()
