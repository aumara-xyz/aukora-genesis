"""Cold receipt court: stranger + receipt JSON + anchored public key.

Fail closed without --pub or --trust-anchors. Demo escape hatch:
--allow-unanchored (prints SIGNER_IDENTITY_UNANCHORED; never a trusted claim).

With --pub / matching trust-anchor: SIGNATURE_VALID + SIGNER_KEY_MATCHED.
Always prints unattributed / NON-CONFORMING / CONSISTENCY_UNCHECKED /
ATTENDANCE: reported-not-proven. No repo, no Aura store.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from toy.hexutil import read_json
from toy.receipt import ReceiptError, verify_receipt


def _load_anchors(path: Path) -> set[str]:
    """Trust-anchors file: one lowercase hex pubkey per line (# comments ok)."""
    anchors: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        anchors.add(line.lower())
    return anchors


def verify_file(
    receipt_path: Path,
    pub_path: Path | None,
    *,
    trust_anchors: Path | None = None,
    allow_unanchored: bool = False,
) -> tuple[str, str, str]:
    """Returns (approval, conformance, signer_status)."""
    receipt = read_json(receipt_path)
    if pub_path is not None:
        expect = pub_path.read_text(encoding="utf-8").strip()
        approval, conformance = verify_receipt(receipt, expect_pk=expect)
        return approval, conformance, "SIGNER_KEY_MATCHED"
    if trust_anchors is not None:
        anchors = _load_anchors(trust_anchors)
        issuer = str(receipt.get("issuerPk", "")).lower()
        if issuer not in anchors:
            raise ReceiptError("issuerPk not in trust-anchors")
        approval, conformance = verify_receipt(receipt, expect_pk=issuer)
        return approval, conformance, "SIGNER_KEY_MATCHED"
    if allow_unanchored:
        approval, conformance = verify_receipt(receipt, expect_pk=None)
        return approval, conformance, "SIGNER_IDENTITY_UNANCHORED"
    raise ReceiptError(
        "REFUSE: cold verify fail-closed — require --pub or --trust-anchors "
        "(or explicit --allow-unanchored for demo)"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Cold-verify an aukora-receipt/v3-toy "
            "(require --pub or --trust-anchors; fail closed otherwise)"
        )
    )
    parser.add_argument("receipt")
    parser.add_argument("--pub", help="issuer public key hex file (anchors signer identity)")
    parser.add_argument(
        "--trust-anchors",
        help="file of trusted issuerPk hex lines (anchors signer identity)",
    )
    parser.add_argument(
        "--allow-unanchored",
        action="store_true",
        help="demo escape: verify against embedded issuerPk only (UNANCHORED)",
    )
    args = parser.parse_args(argv)
    try:
        approval, conformance, signer = verify_file(
            Path(args.receipt),
            Path(args.pub) if args.pub else None,
            trust_anchors=Path(args.trust_anchors) if args.trust_anchors else None,
            allow_unanchored=args.allow_unanchored,
        )
    except (ReceiptError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    print("SIGNATURE_VALID")
    print(f"SIGNER: {signer}")
    print(f"CLASS: {approval}")
    print(f"CONFORMANCE: {conformance}")
    # Cold court does not run retained-vs-presented Phase 0.
    print("CONSISTENCY: CONSISTENCY_UNCHECKED")
    print("ATTENDANCE: reported-not-proven")
    print(
        "HINT: run Phase 0 (verify-pair) for APPEND_ONLY / CONFLICT; "
        "cold verify is not that court"
    )
    print(
        "NOTE: identity/owner/did fields never authorize; grants authorize composition"
    )
    if signer == "SIGNER_IDENTITY_UNANCHORED":
        print(
            "NOTE: --allow-unanchored checks against embedded issuerPk only; "
            "signer identity is unanchored (not a trusted-signer claim)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
