#!/usr/bin/env python3
"""Validate one public transaction EXPORT and print the consumer arguments that read it.

    python3 export_input.py --export <dir> --issuer-anchor <file> --approver-anchor <file> [--json]

WHAT AN EXPORT IS. A directory of PUBLIC bytes about one approved memory transaction: the record,
the exact content the approval binds, the receipt being checked, the history log it sits in, the flat
approval artifact — plus a MANIFEST describing where those bytes came from. It is not a signed
format and nothing here mints or signs anything: the manifest is a description, and every claim in it
that CAN be re-derived from the files is re-derived and compared, so a manifest that disagrees with
its own bytes is refused by name instead of being quoted.

THE ANCHORS ARE INPUTS AND ARE NEVER TAKEN FROM THE BUNDLE. `--issuer-anchor` and
`--approver-anchor` are required arguments naming files the CALLER supplies. A manifest that tries to
declare trusted anchors is refused (`EXPORT_ANCHORS_NOT_SEPARATE`): a bundle that hands over the keys
it is to be checked against is the "a document's own key is a claim" defect wearing a new directory
name. Co-location is reported rather than hidden, because for the committed fixture the anchors ship
beside the bundle and the caller still supplies them explicitly.

THE CLASS IS PRINTED, AND A LABEL IS NOT PROOF. `committed-fixture`, `materialized-candidate` and
`live-produced` are three different claims. A manifest claiming `live-produced` must carry live
evidence (a release, a serving pid and an observation time); even then, this tool prints it as the
export's own report, never as something established here. A candidate-release test is not proof that
the live service produced the bytes.

Exit 0 when the export is usable, 2 on a named refusal, 3 when the export is usable but the manifest
carries no class label at all (the run may proceed; the caller is told what is unknown).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

EXPORT_DOMAIN = "aukora-approval-transaction-export/v1"
CLASSES = ("committed-fixture", "materialized-candidate", "live-produced")
OPERATION_CONTENT_DOMAIN = "aukora:operation-content:v1"
APPROVAL_RECEIPT_DOMAIN = "aukora:approval-receipt:v1"

REQUIRED_FILES = ("record", "content", "receipt", "log", "artifact", "artifactAlt", "object")

MANIFEST_MISSING = "EXPORT_MANIFEST_MISSING"
MANIFEST_MALFORMED = "EXPORT_MANIFEST_MALFORMED"
CLASS_UNKNOWN = "EXPORT_CLASS_UNKNOWN"
FILE_MISSING = "EXPORT_FILE_MISSING"
ANCHOR_MISSING = "EXPORT_ANCHOR_MISSING"
ANCHORS_NOT_SEPARATE = "EXPORT_ANCHORS_NOT_SEPARATE"
MANIFEST_DISAGREES = "EXPORT_MANIFEST_DISAGREES_WITH_FILES"
ALT_APPROVAL_INVALID = "EXPORT_ALT_APPROVAL_INVALID"
LIVE_EVIDENCE_MISSING = "EXPORT_LIVE_EVIDENCE_MISSING"


class ExportRefusal(Exception):
    """A named refusal about the export as an input. `code` is stable."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _operation_digest(content: bytes) -> str:
    """The producer's rule, restated here rather than imported: domain ‖ 0x00 ‖ content bytes."""
    return hashlib.sha256(OPERATION_CONTENT_DOMAIN.encode("utf-8") + b"\0" + content).hexdigest()


def _approval_id(artifact: dict) -> str:
    """`sha256(domain ‖ 0x00 ‖ challenge ‖ 0x00 ‖ signature)` — the SIGNED pair and nothing else."""
    digest = hashlib.sha256()
    digest.update(APPROVAL_RECEIPT_DOMAIN.encode("utf-8"))
    digest.update(b"\0")
    digest.update(str(artifact.get("challenge", "")).encode("utf-8"))
    digest.update(b"\0")
    digest.update(str(artifact.get("signature", "")).encode("utf-8"))
    return digest.hexdigest()


def read_export(export_dir: Path, issuer_anchor: Path | None,
                approver_anchor: Path | None) -> dict:
    """Read and CHECK one export directory. Raises ExportRefusal with a stable code."""
    if not export_dir.is_dir():
        raise ExportRefusal(MANIFEST_MISSING, f"no export directory at {export_dir}")
    manifest_path = export_dir / "export.json"
    if not manifest_path.is_file():
        raise ExportRefusal(
            MANIFEST_MISSING,
            f"no export.json in {export_dir}: an export is a directory of bytes PLUS a manifest that "
            f"says where they came from, and a directory without one cannot be told apart from a "
            f"pile of files")
    try:
        manifest = json.loads(manifest_path.read_text())
    except ValueError as exc:
        raise ExportRefusal(MANIFEST_MALFORMED, f"export.json is not JSON: {exc}") from exc
    if not isinstance(manifest, dict):
        raise ExportRefusal(MANIFEST_MALFORMED, "export.json must be one object")

    domain = manifest.get("exportDomain")
    if domain != EXPORT_DOMAIN:
        raise ExportRefusal(MANIFEST_MALFORMED,
                            f"export.json exportDomain is {domain!r}, not {EXPORT_DOMAIN!r}")

    if "anchors" in manifest or "trustedAnchors" in manifest:
        raise ExportRefusal(
            ANCHORS_NOT_SEPARATE,
            "export.json declares anchors. An export must NOT supply the keys it is checked against: "
            "the caller names the issuer and approver anchors as separate arguments, and a bundle "
            "that hands over its own keys is a claim, not evidence")

    klass = manifest.get("class")
    if klass is not None and klass not in CLASSES:
        raise ExportRefusal(CLASS_UNKNOWN,
                            f"export.json class is {klass!r}; the only classes are {list(CLASSES)}")
    if klass == "live-produced":
        evidence = manifest.get("liveEvidence")
        ok = (isinstance(evidence, dict)
              and isinstance(evidence.get("release"), str) and evidence["release"] != ""
              and isinstance(evidence.get("servingPid"), int)
              and isinstance(evidence.get("observedAt"), str) and evidence["observedAt"] != "")
        if not ok:
            raise ExportRefusal(
                LIVE_EVIDENCE_MISSING,
                "export.json claims class=live-produced without liveEvidence naming the release, the "
                "serving pid and the observation time. A label is not evidence that a running service "
                "produced these bytes")

    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ExportRefusal(MANIFEST_MALFORMED, "export.json files must be an object")
    resolved = {}
    for name in REQUIRED_FILES:
        value = files.get(name)
        if not isinstance(value, str) or value == "":
            raise ExportRefusal(FILE_MISSING, f"export.json names no `{name}` file")
        path = (export_dir / value).resolve()
        if export_dir.resolve() not in path.parents and path.parent != export_dir.resolve():
            raise ExportRefusal(MANIFEST_MALFORMED,
                                f"export.json `{name}` escapes the export directory: {value}")
        if not path.is_file():
            raise ExportRefusal(FILE_MISSING, f"the `{name}` file named by export.json is missing: "
                                              f"{path}")
        resolved[name] = path

    anchors = {}
    for label, given in (("issuer", issuer_anchor), ("approver", approver_anchor)):
        if given is None:
            raise ExportRefusal(
                ANCHOR_MISSING,
                f"no {label} anchor was supplied. Both anchors are REQUIRED, separately, as "
                f"arguments: a receipt's issuerPk and an artifact's approvalKeyDid are claims made by "
                f"the documents being checked, and this acceptance has no unanchored mode")
        if not Path(given).is_file():
            raise ExportRefusal(ANCHOR_MISSING, f"the {label} anchor file does not exist: {given}")
        anchors[label] = Path(given).resolve()

    # ── the manifest is CHECKED against its own bytes, not quoted ─────────────────────────────
    translation = manifest.get("transaction") or {}
    disagreements = []
    content_bytes = resolved["content"].read_bytes()
    try:
        carrying = json.loads(content_bytes)
        carried_record_id = carrying["value"]["recordId"]
        carried_key = carrying["key"]
    except (ValueError, KeyError, TypeError) as exc:
        raise ExportRefusal(MANIFEST_MALFORMED, f"the content is not {{key, value}}: {exc}") from exc
    artifact = json.loads(resolved["artifact"].read_text())
    receipt = json.loads(resolved["receipt"].read_text())
    record = json.loads(resolved["record"].read_text())

    derived_digest = _operation_digest(content_bytes)
    derived_approval_id = _approval_id(artifact)
    checks = {
        "recordId": (translation.get("recordId"), carried_record_id),
        "recordIdMatchesRecord": (translation.get("recordId"), record.get("recordId")),
        "contentKey": (None, carried_key),
        "operationDigest": (translation.get("operationDigest"), derived_digest),
        "artifactOperationDigest": (artifact.get("operationDigest"), derived_digest),
        "approvalId": (translation.get("approvalId"), derived_approval_id),
        "receiptRecordId": (receipt.get("recordId"), carried_record_id),
        "receiptSequence": (translation.get("receiptSequence"), (receipt.get("aura") or {}).get("seq")),
        "receiptEffectDigest": (receipt.get("effectDigest"),
                                hashlib.sha256(content_bytes).hexdigest()),
    "objectBytes": (hashlib.sha256(resolved["object"].read_bytes()).hexdigest(),
                    hashlib.sha256(content_bytes).hexdigest()),
    }
    # The SECOND approval: genuine, internally consistent, over the SAME content, with a different
    # challenge and signature. It is required because the receipt-linkage check can only be isolated
    # by an approval that is valid in every other respect — an edited field would be refused earlier,
    # for a different reason, and the arm would be asserting the wrong mechanism.
    alt = json.loads(resolved["artifactAlt"].read_text())
    if alt.get("challenge") == artifact.get("challenge"):
        raise ExportRefusal(ALT_APPROVAL_INVALID,
                            "export.json artifactAlt carries the SAME challenge as the artifact: it is "
                            "not a second approval")
    if alt.get("operationDigest") != derived_digest:
        raise ExportRefusal(ALT_APPROVAL_INVALID,
                            "export.json artifactAlt binds a different operation digest than the "
                            "exported content: only a second approval over the SAME bytes isolates the "
                            "receipt-linkage check")

    for label, (claimed, actual) in checks.items():
        if claimed is None:
            continue
        if claimed != actual:
            disagreements.append(f"{label}: manifest says {claimed!r}, the bytes give {actual!r}")
    if disagreements:
        raise ExportRefusal(
            MANIFEST_DISAGREES,
            "export.json disagrees with the bytes it describes: " + "; ".join(disagreements))

    return {
        "class": klass,
        "classNote": ("the export's own label; a label is not proof that a running service produced "
                      "these bytes"),
        "domain": domain,
        "manifest": manifest,
        "files": resolved,
        "anchors": anchors,
        "anchorsCoLocated": all(any(a == f or export_dir.resolve() in a.parents for f in resolved.values())
                                for a in anchors.values()),
        "derived": {"operationDigest": derived_digest, "approvalId": derived_approval_id,
                    "secondApprovalId": _approval_id(alt),
                    "contentSha256": _sha256(resolved["content"])},
        "digests": {name: _sha256(path) for name, path in resolved.items()},
    }


def print_report(info: dict, as_json: bool) -> None:
    manifest = info["manifest"]
    genesis = manifest.get("genesis") or {}
    if as_json:
        print(json.dumps({
            "exportClass": info["class"], "classNote": info["classNote"],
            "domain": info["domain"], "genesis": genesis,
            "files": {name: str(path) for name, path in info["files"].items()},
            "anchors": {name: str(path) for name, path in info["anchors"].items()},
            "anchorsCoLocated": info["anchorsCoLocated"],
            "derived": info["derived"], "digests": info["digests"],
        }, indent=2, sort_keys=True))
        return
    print(f"EXPORT_DOMAIN        : {info['domain']}")
    print(f"EXPORT_CLASS         : {info['class'] or '(unlabelled)'}")
    print(f"EXPORT_CLASS_NOTE    : {info['classNote']}")
    print(f"EXPORT_GENESIS_COMMIT: {genesis.get('commit', '(unnamed)')}")
    print(f"EXPORT_RELEASE       : {genesis.get('release') or '(none: not a materialized release)'}")
    print(f"EXPORT_RECORD_DIGEST : {genesis.get('releaseRecordDigest') or '(unnamed)'}")
    print(f"EXPORT_ANCHORS_COLOCATED: {info['anchorsCoLocated']} "
          f"(the caller still supplied both, and neither was read from the documents)")
    print(f"EXPORT_DERIVED_DIGEST: {info['derived']['operationDigest']} "
          f"(derived HERE from the exported content bytes)")
    print(f"EXPORT_DERIVED_APPROVAL_ID: {info['derived']['approvalId']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="validate one public transaction export")
    parser.add_argument("--export", required=True, help="the export directory")
    parser.add_argument("--issuer-anchor", default=None)
    parser.add_argument("--approver-anchor", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        info = read_export(Path(args.export).resolve(),
                           Path(args.issuer_anchor) if args.issuer_anchor else None,
                           Path(args.approver_anchor) if args.approver_anchor else None)
    except ExportRefusal as refusal:
        print(f"EXPORT: {refusal.code}")
        print(f"  {refusal.detail}")
        print("EXPORT RESULT: RED")
        return 2
    print_report(info, args.json)
    print("EXPORT RESULT: GREEN")
    return 3 if info["class"] is None else 0


if __name__ == "__main__":
    sys.exit(main())
