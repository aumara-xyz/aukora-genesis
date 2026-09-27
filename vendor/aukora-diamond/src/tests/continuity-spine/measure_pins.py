#!/usr/bin/env python3
"""Opt-in local source measurement; never executed by the cold consumer or CI.

Reads caller-named sibling checkouts. It decodes but NEVER executes the proposal
module or confinement code. A digest mismatch exits nonzero, preserving a report.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

CELL = "34ce6cab618b626243e876befb49ccf8a6780dc836e757484886b34ae977a438"
CELL_BYTES = 101
CELL_SOURCE = "379d1a0514dd83cc6d23880f3509aa1438d55a10977ac95edbde9bd65f975197"
CELL_WAT = "d73e8d223973e03d24a48c4ab3b035e9505375b0cc2a29e65a233af20cc807d8"
VERIFY = "039aa8999f9a1e1a8b8e01eb51598bfc546e4e574b2c9333f13e8bb303958089"
OBSERVATION = "MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM"
# Reviewed blob identities recorded in local-pins.json at Alpha ddb6a9cc.
# Keep these fixed here: a caller's checkout or report cannot supply its own pins.
ALPHA_SOURCE_PINS = (
    ("alphaGuestLauncher", "src/guest/launch.mjs",
     "edd7dae4786530dd34c6f59e30666cb6ca8357a4c9bd4e4d5aa9804fec2b6617"),
    ("alphaEvidenceVerifier", "src/evidence/verify.py",
     "8993b4cfcca1b41ee1f7fdf4d9148ccd261a7e682d35b623199c79ee6979e585"),
    ("alphaReceiptVerifier", "src/receipt_v3/verify.py",
     "4e934e26461d23cc1165d598e7256dc647d91c8a39d635dcad47a189a2d8b5a4"),
    ("alphaWitness", "src/evidence/witness.py",
     "32db6eedf9fa397043483a09ffcdb5d3ff2a383f30bda8847028903f31841a15"),
    ("alphaThreatModel", "THREAT-MODEL.md",
     "9942f8866d6530dbef79e4817672ded31373a826d91e7de6434b1bbed4f13ba3"),
    ("alphaAcceptance", "ACCEPTANCE.md",
     "1c60e2a53fd69c3aa31511627950edfe48686e4b0c28b41eb0457ae2327fde10"),
)


def measure(root, relative):
    path = root / relative
    data = path.read_bytes()
    head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    committed = subprocess.check_output(["git", "-C", str(root), "show", head + ":" + relative])
    if data != committed:
        raise ValueError("WORKTREE_DIFFERS_FROM_HEAD:" + relative)
    return data, {"commit": head, "path": relative, "bytes": len(data),
                  "sha256": hashlib.sha256(data).hexdigest(), "matchesCommittedBytes": True}


def require_blob_pin(info, expected, refusal):
    """Match blob bytes; the separately recorded commit is provenance, not a predicate."""
    info["expectedSha256"] = expected
    info["matchesBlobPin"] = info["sha256"] == expected
    if not info["matchesBlobPin"]:
        raise ValueError(refusal)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--deep", type=Path, required=True)
    p.add_argument("--genesis", type=Path, required=True)
    p.add_argument("--membrane", type=Path)
    p.add_argument("--spec-alpha", type=Path,
                   help="optional read-only source measurement; never executes Alpha")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    report = {"scope": "LOCAL_SOURCE_BYTES_ONLY_NOT_EXECUTION_OR_DEPLOYMENT",
              "matchRule": "BLOB_SHA256_NOT_COMMIT_ID", "pins": {}}
    try:
        data, info = measure(a.deep, "aukora/guest/wasm-proposal-cell.mjs")
        report["pins"]["deepCellSource"] = info
        source = data.decode()
        declarations = re.findall(r"^export const MEMORY_PUT_PROPOSAL_WASM_SHA256 = '([0-9a-f]{64})'$",
                                  source, flags=re.MULTILINE)
        encodings = re.findall(r"^const MODULE_BASE64 = '([^']+)'$", source, flags=re.MULTILINE)
        if len(declarations) != 1 or len(encodings) != 1:
            raise ValueError("WASM_SOURCE_LITERAL_INVALID")
        declared = declarations[0]
        module = base64.b64decode(encodings[0], validate=True)
        measured = hashlib.sha256(module).hexdigest()
        report["pins"]["wasmModule"] = {"bytes": len(module), "sha256": measured, "declared": declared}
        module_info = report["pins"]["wasmModule"]
        require_blob_pin(module_info, CELL, "WASM_MODULE_PIN_DRIFT")
        module_info["expectedBytes"] = CELL_BYTES
        if declared != CELL or len(module) != CELL_BYTES:
            raise ValueError("WASM_MODULE_PIN_DRIFT")
        require_blob_pin(info, CELL_SOURCE, "WASM_WRAPPER_PIN_DRIFT")
        data, info = measure(a.deep, "aukora/guest/wasm/memory-put-proposal.wat")
        report["pins"]["deepCellWatSource"] = info
        require_blob_pin(info, CELL_WAT, "WASM_WAT_PIN_DRIFT")
        data, info = measure(a.deep, "aukora/supervisor/guest-confinement.mjs")
        info["observationClass"] = OBSERVATION
        info["literalPresent"] = OBSERVATION.encode() in data
        report["pins"]["seatbeltSource"] = info
        if not info["literalPresent"]:
            raise ValueError("SEATBELT_OBSERVATION_DRIFT")
        data, info = measure(a.genesis, "vendor/phase0-consistency/verify.py")
        report["pins"]["genesisVerifier"] = info
        require_blob_pin(info, VERIFY, "GENESIS_VERIFIER_PIN_DRIFT")
        if a.membrane:
            data, info = measure(a.membrane, "minimal/verify.py")
            report["pins"]["membraneVerifier"] = info
            require_blob_pin(info, VERIFY, "MEMBRANE_VERIFIER_PIN_DRIFT")
        if a.spec_alpha is not None:
            for key, relative, expected in ALPHA_SOURCE_PINS:
                data, info = measure(a.spec_alpha, relative)
                info["observationClass"] = "SOURCE_BYTES_ONLY_NOT_EXECUTED_HERE"
                report["pins"][key] = info
                require_blob_pin(info, expected, "ALPHA_SOURCE_PIN_DRIFT:" + relative)
        report["verdict"] = "MEASURED_LOCAL_MATCH"
    except Exception as exc:
        report["verdict"] = "REFUSED"
        report["reason"] = str(exc)
    a.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(report["verdict"])
    return 0 if report["verdict"] == "MEASURED_LOCAL_MATCH" else 1


if __name__ == "__main__":
    sys.exit(main())
