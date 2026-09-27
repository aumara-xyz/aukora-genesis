#!/usr/bin/env python3
"""Offline verdict on Kira memory-v1 evidence: record, receipt, position, approval.

    python3 verify-kira-evidence.py --record R --receipt T --log L --anchor A [--wrapper W]
                                    [--store S] [--expect VERDICT] [--json]

WHAT THIS IS. The one-entry-point consumer for a Kira memory-v1 record and its receipt. It
reads four public files — the record, the receipt, the Aura log, and a NAMED issuer anchor —
and reports FIVE SEPARATE results, never one word:

    RECORD IDENTITY      : recordId and the content digest, recomputed from the record's fields
    SIGNATURE + CANON     : Ed25519 over kind + "\\n" + RFC 8785 JCS canonical body
    ANCHOR                : the signature was checked under the anchor the caller NAMED
    HISTORICAL POSITION   : the receipt's OWN entry in the log, not the log's current tip
    OWNER APPROVAL        : UNCHECKED, unless the caller names an approval document AND a
                            separate approval anchor. TWO approval lanes exist and are named:
                            `--artifact` is the REAL current-producer record
                            (`aukora:approval-receipt:v1`), whose operation digest is DERIVED from
                            `--artifact-content`; `--approval` is the older request/response
                            wrapper, kept so its controls keep running. A named refusal in either
                            lane FAILS THE RUN.

WHAT THE APPROVAL LANE CANNOT SHOW, stated here because the status word is short:

    a valid signature      is not a memory-operation binding. The binding requires Diamond to
                           DERIVE the operation digest from the agreed producer operation bytes,
                           and no such derivation exists; `--approval-operation-digest` only
                           COMPARES a digest the caller supplied with the signed one, and is
                           reported as caller-supplied equality for exactly that reason.
    a valid signature      is not an authorization: facet 5 never authorizes anything, and
                           `OWNER_APPROVAL_UNCHECKED` is what authorization stays.
    a valid signature      is not a person. Attendance stays `reported-not-proven`, and a wrapper
                           field claiming attendance is REFUSED by name — it is unsigned, so no
                           signature could have made it true.

THE ANCHOR IS AN INPUT, NOT A DISCOVERY. The receipt carries `issuerPk`, and that field is a
claim: a verifier that reads the key out of the document it is checking has checked nothing.
There is no unanchored mode and no policy flag that creates one. A missing `--anchor` is a
named refusal, and so is a receipt naming a key the anchor does not name.

OFFLINE BY CONSTRUCTION. This script imports the Python standard library and the `diamond`
package's evidence modules and nothing else. It reads no environment variable, opens no socket,
runs no subprocess, and never describes a path outside the files it was given. The producer that
made the evidence is NOT needed here: this file recomputes the record identity, the canonical
bytes and the chain from the documents themselves.

EXIT STATUS. 0 when the named expectation holds, 1 when it does not, 2 on a usage error.
`--expect verified` demands a passing verification; `--expect <refusal-code>` demands that
exact refusal, so a negative control can be asserted rather than eyeballed. WHEN APPROVAL
VERIFICATION IS REQUESTED AND A REQUIRED APPROVAL CHECK FAILS, THE RUN FAILS: the printed
verdict, the JSON report and the exit status all carry the approval's own refusal name.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The consumer must run from an EMPTY directory. Its own package may be reached by an
# explicit --package-root, by PYTHONPATH, or by living beside this file; nothing else is
# consulted, and no sibling checkout of any other repository is on the search path.
HERE = Path(__file__).resolve().parent


def _import_consumer(package_root: str | None):
    if package_root:
        sys.path.insert(0, str(Path(package_root).resolve()))
    try:
        from diamond import kira_evidence  # noqa: PLC0415 - deliberately late, after sys.path
    except ImportError as exc:  # pragma: no cover - a setup failure, reported as such
        print(f"SETUP: cannot import diamond.kira_evidence ({exc}). Pass --package-root or set "
              f"PYTHONPATH to the directory CONTAINING the diamond package.", file=sys.stderr)
        raise SystemExit(2) from exc
    return kira_evidence


#: Refusals raised by facets 1-3, i.e. before the position check is reached. Named as a set so
#: the report can distinguish "never ran" from "ran and refused", which are different findings.
EARLIER_FACET_REFUSALS = frozenset({
    "shape", "record-domain-mismatch", "record-identity-mismatch", "signature-invalid",
    "anchor-absent", "anchor-unreadable", "anchor-mismatch", "receipt-kind",
    "receipt-forbidden-field", "receipt-issuerPk-unreadable", "json-unparseable",
    "json-duplicate-key", "evidence-unreadable", "receipt-record-mismatch",
    "APPROVAL_CLASS_UNSUPPORTED", "receipt-approval-malformed", "UNSUPPORTED_NUMBER",
})


#: Refusals raised AFTER the chain walk and the entry comparison succeeded, i.e. the claimed
#: position DOES hold and the object bytes behind it could not be confirmed. Reported separately
#: so a missing object is never read as a false position claim.
POSITION_INCOMPLETE_REFUSALS = frozenset({"object-missing", "object-tampered",
                                           "object-record-mismatch"})


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Offline verdict on Kira memory-v1 evidence (record, receipt, position, "
                    "approval).",
        epilog="Every verdict prints the ceiling it cannot cross. Evidence never authorizes.")
    parser.add_argument("--record", required=True, help="the Kira memory-v1 record JSON")
    parser.add_argument("--receipt", required=True, help="the Kira memory receipt JSON")
    parser.add_argument("--log", required=True, help="the Aura log (JSONL) the receipt names")
    parser.add_argument("--anchor", required=True,
                        help="the NAMED issuer anchor: SPKI PEM or 64 lowercase hex")
    parser.add_argument("--wrapper", default=None,
                        help="optional envelope that PROPOSES the record (never approval)")
    parser.add_argument("--retained-receipt", default=None,
                        help="a separately retained Kira receipt checkpoint, checked under --anchor; "
                             "detects truncation relative to that prefix, never completeness. "
                             "Not an Aura Merkle or Diamond toy checkpoint.")
    parser.add_argument("--store", default=None,
                        help="optional store root holding objects/<digest>.json")
    parser.add_argument("--package-root", default=None,
                        help="directory containing the `diamond` package (if not on PYTHONPATH)")
    parser.add_argument("--expect", default="verified",
                        help="'verified', or a refusal code such as position-mismatch")
    parser.add_argument("--json", action="store_true", help="emit the full report as JSON")
    parser.add_argument("--approval", default=None,
                        help="an Aumlok owner-approval document (request+response) to verify offline")
    parser.add_argument("--approval-anchor", default=None,
                        help="the owner public key for that approval, supplied SEPARATELY: a key "
                             "carried by the document is refused, never trusted")
    parser.add_argument("--approval-operation-digest", default=None,
                        help="COMPARE the approval's signed operationDigest with this digest. "
                             "Equality only: the caller supplies both sides, so a match is not "
                             "evidence about any operation and the memory-operation binding stays "
                             "UNVERIFIED. A difference is a named failure of this run.")
    parser.add_argument("--artifact", default=None,
                        help="the REAL artifact: an aukora:approval-receipt:v1 record as "
                             "`scripts/aumlok/approve-operation --artifact-out` writes it. Its "
                             "operation digest is DERIVED from --artifact-content, never read")
    parser.add_argument("--artifact-content", default=None,
                        help="the EXACT content bytes the artifact must bind: "
                             "canonicalJSON({key, value}) plus one newline. Digested as bytes")
    parser.add_argument("--artifact-anchor", default=None,
                        help="the approver public key for that artifact, supplied SEPARATELY from "
                             "the document: 64 lowercase hex, a did:key, or an SPKI PEM (or a file "
                             "holding one). Never read out of the artifact")
    parser.add_argument("--artifact-subject", default=None,
                        help="the subject this owner serves, when the caller knows it. Without it "
                             "the artifact's subject is checked against the record's own subject")
    parser.add_argument("--approver-pin", default=None,
                        help="the REGISTERED approver did:key this composition accepts. Without it, "
                             "the verdict says a key the artifact NAMES signed these bytes")
    parser.add_argument("--artifact-now", type=int, default=None,
                        help="unix seconds, to ask whether the approval window is still open. "
                             "Without it the window is NOT checked: a genuine approval consumed "
                             "long ago is not false because time passed")
    args = parser.parse_args(argv)

    ke = _import_consumer(args.package_root)

    record_path = Path(args.record)
    receipt_path = Path(args.receipt)
    log_path = Path(args.log)
    anchor_path = Path(args.anchor)

    print(f"CONSUMER          : offline Kira memory-v1 evidence consumer (diamond.kira_evidence)")
    print(f"RECORD FILE       : {record_path.name}")
    print(f"RECEIPT FILE      : {receipt_path.name}")
    print(f"LOG FILE          : {log_path.name}")
    print(f"ANCHOR FILE       : {anchor_path.name}  (named by the caller, never read from the "
          "receipt)")
    print(f"WRAPPER FILE      : {Path(args.wrapper).name if args.wrapper else '(none)'}")
    print()

    def refusal_report(code: str, detail: str) -> dict:
        """The same report SHAPE on every refusal path, so `--json` is never silently absent."""
        return {
            "verified": False, "verdict": code, "refusalLane": "evidence",
            "status": "UNSUPPORTED" if code == "UNSUPPORTED_NUMBER" else "REFUSED",
            "refusal": {"code": code, "detail": detail},
            "record": None, "receipt": None, "position": None, "approval": None,
            "execution": ke.execution_scope(),
            "authorityScope": ke.authority_scope(),
            "retention": ke.retention_scope(supplied=args.retained_receipt is not None),
            "approvalRefusal": None, "attendance": ke.ATTENDANCE, "ceilings": list(ke.CEILINGS),
        }

    def refuse_early(code: str, detail: str) -> int:
        """Report a refusal reached before any facet ran, in the same vocabulary as the rest.

        The expectation line is printed HERE too, not only on the full path: an arm that exits
        early is still an arm, and a reader grepping for `EXPECTATION` must not have to notice
        which ones quietly skipped it. The JSON block is emitted here too, for the same reason:
        text, JSON and exit status agree on every path or the agreement is not worth claiming.
        """
        early_report = refusal_report(code, detail)
        print(f"VERDICT: {early_report['status']}  {code}")
        print(f"  {detail}")
        print()
        print(f"ATTENDANCE: {ke.ATTENDANCE}")
        print("CELL_EXECUTION: NOT_ESTABLISHED")
        print("AUTHORITY_MODE: mode-unbound")
        print("OPERATOR_PRESENCE: NOT_ESTABLISHED")
        print("COMPLETENESS: UNDETERMINED")
        print("LATESTNESS: NO_LATESTNESS")
        print("CEILINGS — what this verdict CANNOT establish:")
        for ceiling in ke.CEILINGS:
            print(f"  - {ceiling}")
        print()
        if args.json:
            print("REPORT-JSON-BEGIN")
            print(json.dumps(early_report, indent=2, sort_keys=True))
            print("REPORT-JSON-END")
            print()
        if code == args.expect:
            print(f"EXPECTATION: {args.expect} OBSERVED")
            return 0
        print(f"EXPECTATION: {args.expect} NOT OBSERVED (observed {code})")
        return 1

    try:
        record = ke.read_json_strict(record_path)
        receipt = ke.read_json_strict(receipt_path)
        wrapper = ke.read_json_strict(Path(args.wrapper)) if args.wrapper else None
        try:
            anchor_text = anchor_path.read_text(encoding="utf-8")
        except OSError as exc:
            # A missing anchor is a refusal about the ANCHOR, not about the record. The
            # distinction matters: "I was given no key to check against" is a different
            # finding from "I was given no record", and neither is a traceback.
            raise ke.Refusal("anchor-absent",
                             f"no anchor could be read at {anchor_path.name}: {exc.strerror or exc}")
        try:
            anchor_raw = ke.raw_public_key_bytes(anchor_text)
            anchor_error = None
        except ke.Refusal as refusal:
            anchor_raw, anchor_error = None, refusal
    except ke.Refusal as refusal:
        return refuse_early(refusal.code, refusal.detail)
    except OSError as exc:
        # A missing mandatory input FAILS. It never silently skips, and it never reads as a
        # refusal about something else: an unreadable file is named by the file that is missing.
        return refuse_early("evidence-unreadable", str(exc))

    retention_args = {}
    if args.retained_receipt is not None:
        try:
            retention_args["retained_receipt_document"] = ke.read_json_strict(Path(args.retained_receipt))
        except (ke.Refusal, OSError, UnicodeError) as exc:
            return refuse_early("RETAINED_CHECKPOINT_INVALID", str(exc))

    report = ke.verify_evidence(
        record_document=record,
        receipt_document=receipt,
        log_path=log_path,
        anchor_raw=anchor_raw,
        wrapper=wrapper,
        store=Path(args.store) if args.store else None,
        anchor_detail=anchor_error.detail if anchor_error is not None else None,
        **retention_args,
    )
    if report["refusal"] is not None:
        report["verified"] = False
    report["wrapperCrossCheck"] = ke.cross_check_wrapper(wrapper, record, receipt)

    # ── the five facets, reported SEPARATELY ────────────────────────────────────────────────
    record_facet = report["record"]
    print("1. RECORD IDENTITY AND CONTENT DIGEST")
    if record_facet is None:
        print("   UNVERIFIED — the record was not read")
    else:
        print(f"   recordId claimed    : {record_facet['claimedRecordId']}")
        print(f"   recordId recomputed : {record_facet['recomputedRecordId']}")
        print(f"   record digest       : {record_facet['recordDigest']}")
        print(f"   content digest      : {record_facet['contentDigest']}")
        print(f"   VERDICT             : {'VERIFIED' if record_facet['verified'] else 'UNVERIFIED'}")
    print()

    receipt_facet = report["receipt"]
    print("2. SIGNATURE AND CANONICALIZATION (RFC 8785 JCS)")
    if receipt_facet is None:
        print("   UNVERIFIED — no signature work was done (see the anchor result below)")
    else:
        print(f"   signed body digest  : {receipt_facet['signedBodyDigest']}")
        print(f"   VERDICT             : {'VERIFIED' if receipt_facet['verified'] else 'UNVERIFIED'}")
    print()

    print("3. ISSUER ANCHOR")
    if receipt_facet is None:
        code = report["refusal"]["code"] if report["refusal"] else "anchor-absent"
        print(f"   anchor              : {ke.public_key_hex(anchor_raw) if anchor_raw else '(none)'}")
        print(f"   VERDICT             : REFUSED {code}")
    else:
        print(f"   anchor              : {receipt_facet['anchor']}")
        print(f"   source              : {receipt_facet['anchorSource']}")
        print(f"   VERDICT             : MATCHED")
    print()

    position = report["position"]
    print("4. HISTORICAL POSITION (the receipt's own entry, not the log's tip)")
    if position is None:
        # A bare refusal code here would read as "the LOG was checked and found wanting", which
        # is a stronger claim than "the check never ran". The two cases are named separately:
        # an earlier facet refusing (the position check is never reached, because a position
        # claim is only meaningful once the signature verifies under the named anchor), and the
        # position check itself refusing the receipt's claim.
        code = report["refusal"]["code"] if report["refusal"] else "position-unchecked"
        if code in EARLIER_FACET_REFUSALS:
            print(f"   NOT REACHED         : {code} — the position check runs only after the "
                  "record and the signature verify under the named anchor")
        elif code in POSITION_INCOMPLETE_REFUSALS:
            print(f"   POSITION HOLDS, OBJECT UNVERIFIED : {code} — the log contains the entry "
                  "and prior head the receipt names, and the stored bytes it points at were not "
                  "confirmed")
        else:
            print(f"   UNVERIFIED          : {code} — the receipt's claimed position does not "
                  "hold in this log")
    else:
        print(f"   position            : entry {position['position']} of {position['logLength']} "
              f"({position['entriesAfterPosition']} entry(ies) after it)")
        print(f"   entry hash          : {position['positionEntryHash']}")
        print(f"   prior head          : {position['positionPriorHead']}")
        print(f"   log head in hand    : {position['logHead']}")
        print(f"   is tip OF THIS LOG  : {position['isLogTip']} (never a claim about other logs)")
        if "objectBytes" in position:
            print(f"   object bytes        : {position['objectBytes']} "
                  f"(sha256 == {position['objectDigest'][:16]}…)")
        print(f"   VERDICT             : VERIFIED")
    print()

    # ── facet 5: owner approval, in THREE lanes that are never merged ────────────────────────
    # WRAPPER LANE (always runs): the evidence bundle's own unsigned wrapper, checked by
    #   `kira_evidence.check_approval`, which reports OWNER_APPROVAL_UNCHECKED and lists the
    #   claims that are not approval. Absence of an approval document stays "not checked": it is
    #   never turned into a pass and never into a failure of a check that did not run.
    # ARTIFACT LANE (only when `--artifact` names one): the REAL `aukora:approval-receipt:v1` record
    #   the current producer writes, verified offline by `diamond.approval_artifact`. The operation
    #   digest is DERIVED from `--artifact-content`, the anchor is supplied separately, and the
    #   receipt's own approval block is cross-checked. A named refusal here FAILS THE WHOLE RUN.
    # WRAPPER-DOCUMENT LANE (only when `--approval` names one): the request/response pair this
    #   consumer verified BEFORE the real artifact existed. Kept, and named as the older shape: the
    #   controls and fixtures that caught an invalid approval returning exit 0 are still run against
    #   it, and a reader must be able to tell which of the two documents they handed over.
    evidence_approval = report["approval"] or {
        "status": "OWNER_APPROVAL_UNCHECKED", "checked": False, "reason": "not evaluated",
        "observedClaimsNotApproval": [],
    }
    approval = evidence_approval
    approval_refusal = None
    artifact_refusal = None
    if getattr(args, "artifact", None):
        from diamond.approval_artifact import artifact_summary, verify_artifact
        artifact_document, content_bytes = None, None
        try:
            artifact_document = json.loads(Path(args.artifact).read_text(encoding="utf-8"))
            if not args.artifact_content:
                raise ValueError("--artifact-content is required with --artifact: an approval over a "
                                 "digest nobody can re-derive binds nothing")
            content_bytes = Path(args.artifact_content).read_bytes()
        except (OSError, ValueError) as exc:
            artifact_refusal = {"code": "artifact-unreadable",
                                "detail": f"the approval artifact could not be read: {exc}"}
            approval = {
                "status": artifact_refusal["code"], "reason": artifact_refusal["detail"],
                "refusal": artifact_refusal, "fails_verification": True,
                "observedClaimsNotApproval": evidence_approval.get("observedClaimsNotApproval", []),
            }
        else:
            raw_anchor = args.artifact_anchor or ""
            anchor_candidate = Path(raw_anchor)
            anchor_text = (anchor_candidate.read_text().strip()
                           if raw_anchor and anchor_candidate.is_file() else raw_anchor.strip())
            # The stored object, when the caller named a store: the file the producer's own
            # settlement would have written is `objects/<sha256(content)>.json`, so the check is
            # "the bytes under that name ARE the content the approval binds".
            object_bytes = None
            object_detail = "no store was named, so no stored object was read"
            if args.store:
                import hashlib as _hashlib
                object_path = (Path(args.store) / "objects"
                               / f"{_hashlib.sha256(content_bytes).hexdigest()}.json")
                if object_path.is_file():
                    object_bytes = object_path.read_bytes()
                else:
                    object_detail = f"no object at objects/{object_path.name} in the named store"
            artifact_findings = verify_artifact(
                artifact_document,
                anchor=anchor_text or None,
                content_bytes=content_bytes,
                expected_subject=args.artifact_subject,
                approver_pin=args.approver_pin,
                record=record,
                object_bytes=object_bytes,
                receipt=receipt,
                now=args.artifact_now,
            )
            artifact_findings["objectSource"] = object_detail
            approval = dict(artifact_summary(artifact_findings))
            approval["observedClaimsNotApproval"] = evidence_approval.get(
                "observedClaimsNotApproval", [])
            artifact_refusal = approval["refusal"]
            report["approvalArtifactFindings"] = artifact_findings
        report["approval"] = approval
        report["approvalLane"] = "aumlok approval ARTIFACT (aukora:approval-receipt:v1), offline"
    elif getattr(args, "approval", None):
        from diamond.aumlok_approval import approval_summary, verify_approval
        try:
            document = json.loads(Path(args.approval).read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            # An unreadable or unparseable approval document is a refusal about the APPROVAL, and
            # it fails the run for the same reason a wrong signature does: the check was asked
            # for and did not establish what it was asked to establish. The facet status carries
            # the SAME name as the verdict, so the two lines cannot read as a contradiction.
            approval_refusal = {"code": "approval-unreadable",
                                "detail": f"no approval document could be read at "
                                          f"{Path(args.approval).name}: {exc}"}
            approval = {
                "status": approval_refusal["code"], "reason": approval_refusal["detail"],
                "refusal": approval_refusal, "fails_verification": True,
                "observedClaimsNotApproval": evidence_approval.get("observedClaimsNotApproval", []),
                "signature_validity": None, "caller_digest_equality": None,
                "memory_operation_binding": None, "authorization": None,
                "attendance": evidence_approval.get("attendance"),
            }
        else:
            raw = args.approval_anchor or ""
            anchor_path = Path(raw)
            anchor_key = (anchor_path.read_text().strip()
                          if raw and anchor_path.is_file() else raw.strip())
            findings = verify_approval(document, anchor_pk_hex=anchor_key or None,
                                       caller_operation_digest=args.approval_operation_digest)
            # ONE summary decides the word, the reason and the status, so the text below, the JSON
            # report and the exit status are three renderings of the same decision.
            approval = dict(approval_summary(findings))
            approval["observedClaimsNotApproval"] = evidence_approval.get(
                "observedClaimsNotApproval", [])
            approval_refusal = approval["refusal"]
            report["approvalFindings"] = findings
        report["approval"] = approval
        report["approvalLane"] = "aumlok owner-approval document, offline"
    else:
        report["approvalLane"] = "evidence wrapper only (no approval document supplied)"

    print("5. OWNER APPROVAL")
    print(f"   STATUS              : {approval['status']}")
    print(f"   LANE                : {report['approvalLane']}")
    print(f"   {approval['reason']}")
    findings = report.get("approvalFindings")
    if findings:
        # The five findings stay separate HERE too: a signature is not a binding, not an
        # authorization, and not a person.
        print(f"   A signature validity      : {findings['signature']['status']}")
        print(f"   B caller digest equality  : {findings['caller_digest_equality']['status']}")
        print(f"   C memory-operation binding: {findings['memory_operation_binding']['status']}")
        print(f"   D authorization           : {findings['authorization']['status']}")
        print(f"   E attendance              : {findings['attendance']['status']}")
    artifact_findings = report.get("approvalArtifactFindings")
    if artifact_findings:
        # The artifact lane's findings, each on its own line, with the SIGNED/UNSIGNED split stated
        # where a reader meets the labels rather than in a comment above them.
        print(f"   artifact domain     : {artifact_findings['artifact'].get('domain')}")
        print(f"   approvalId          : {artifact_findings.get('approvalId')}")
        print(f"   signature           : {artifact_findings['signature']['status']} "
              f"(anchor: {artifact_findings['anchor']['source']})")
        print(f"   content canonicalization: {artifact_findings['content_canonicalization']['status']}")
        print(f"   operation binding   : {artifact_findings['operation_binding']['status']} "
              f"(DERIVED from the supplied content bytes)")
        print(f"   signed bytes digest : {artifact_findings['signed_bytes_digest']['status']}")
        print(f"   record identity     : {artifact_findings['record_identity']['status']}")
        print(f"   object digest       : {artifact_findings['object_digest']['status']}")
        print(f"   receipt linkage     : {artifact_findings['receipt_approval_linkage']['status']}")
        print(f"   window              : {artifact_findings['window']['status']}")
        print(f"   classification      : {artifact_findings['classification']['status']} "
              f"(NOT signed: {', '.join(sorted(artifact_findings['classification']['fields']))})")
        print(f"   authorization       : {artifact_findings['authorization']['status']}")
        print(f"   attendance          : {artifact_findings['attendance']['status']}")
        for ceiling in artifact_findings["ceilings"]:
            print(f"   ceiling: {ceiling.split(':')[0]}")
    for claim in approval.get("observedClaimsNotApproval", []):
        print(f"   claim not approval  : {claim['field']} = {claim['value']!r}")
    print()

    cross = report["wrapperCrossCheck"]
    if cross["present"]:
        print("WRAPPER CROSS-CHECK (claims vs the record's own bytes)")
        print(f"   {cross.get('reason', 'claims agree with the record')}")
        for problem in cross.get("problems", []):
            print(f"   note: {problem}")
        print()

    # ── one verdict, computed once, rendered identically three ways ─────────────────────────
    # The evidence verdict is the four facets above. An explicitly requested approval check that
    # FAILS is an additional, named failure of THIS RUN: the code is the approval's own refusal
    # name, so a caller can assert `--expect aumlok:unsigned-wrapper-claims-attendance` as a
    # negative control rather than read a reassuring word and hope.
    # Lane order, stated rather than implied: the EVIDENCE is the primary object, then the REAL
    # artifact, then the older wrapper document. A caller that supplies two approvals is entitled to
    # know which one refused this run, and `refusalLane` says so in both renderings.
    if report["refusal"] is not None:
        observed = report["refusal"]["code"]
        refusal_detail = report["refusal"]["detail"]
        report["refusalLane"] = "evidence"
    elif artifact_refusal is not None:
        observed = artifact_refusal["code"]
        refusal_detail = artifact_refusal["detail"]
        report["verified"] = False
        report["refusalLane"] = "owner_approval_artifact"
        report["approvalRefusal"] = artifact_refusal
    elif approval_refusal is not None:
        observed = approval_refusal["code"]
        refusal_detail = approval_refusal["detail"]
        report["verified"] = False
        report["refusalLane"] = "owner_approval_wrapper"
        report["approvalRefusal"] = approval_refusal
    else:
        observed = "verified"
        refusal_detail = None
        report["refusalLane"] = None
    # One machine-readable verdict word, equal to the printed line and to the exit status.
    report["verdict"] = observed
    report["status"] = ("VERIFIED" if observed == "verified" else
                        "UNSUPPORTED" if observed == "UNSUPPORTED_NUMBER" else "REFUSED")
    report.setdefault("approvalRefusal", None)

    if observed == "verified":
        print("VERDICT: VERIFIED (the checks above hold for these bytes)")
    else:
        print(f"VERDICT: {report['status']}  {observed}")
        print(f"  {refusal_detail}")
    if getattr(args, "artifact", None) or getattr(args, "approval", None):
        # The bundle's ceiling list ends by saying owner approval is UNCHECKED, which was true of the
        # BUNDLE and is not true of THIS RUN. Leaving it as printed would be the exact defect the
        # agreement requirement exists for, so the line is replaced by what actually happened.
        report["ceilings"] = [
            ceiling for ceiling in report["ceilings"]
            if not ceiling.startswith("EVIDENCE_NEVER_AUTHORIZES")
        ] + [
            "EVIDENCE_NEVER_AUTHORIZES: a verified record and a verified receipt authorize nothing. "
            "Owner approval was checked SEPARATELY from the bundle by "
            f"{report['approvalLane']}, whose own ceilings are printed with its findings above; the "
            "bundle's own wrapper still carries no approval, and this run's verdict never "
            "authorizes a write."
        ]
    print(f"ATTENDANCE: {report['attendance']}")
    print(f"CELL_EXECUTION: {report['execution']['status']}")
    print(f"AUTHORITY_MODE: {report['authorityScope']['mode']}")
    print(f"OPERATOR_PRESENCE: {report['authorityScope']['operatorPresence']}")
    print(f"RETAINED_CHECKPOINT: {report['retention']['status']}")
    print(f"COMPLETENESS: {report['retention']['completeness']}")
    print(f"LATESTNESS: {report['retention']['latestness']}")
    print("CEILINGS — what this verdict CANNOT establish:")
    for ceiling in report["ceilings"]:
        print(f"  - {ceiling}")
    print()
    print("EVIDENCE NEVER AUTHORIZES: a verified record and receipt authorize nothing.")

    if args.json:
        print()
        print("REPORT-JSON-BEGIN")
        print(json.dumps(report, indent=2, sort_keys=True))
        print("REPORT-JSON-END")

    if observed == args.expect:
        print(f"EXPECTATION: {args.expect} OBSERVED")
        return 0
    print(f"EXPECTATION: {args.expect} NOT OBSERVED (observed {observed})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
