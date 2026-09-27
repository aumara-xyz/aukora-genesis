"""verify-pair: signed checkpoint check then Phase 0 retained-vs-presented.

Requires an externally supplied expected key and valid aukora-checkpoint/v1-toy
signatures, then delegates Merkle consistency to vendor/phase0/verify.py.
The explicit unsigned demo mode names both unchecked signature and identity.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from diamond.checkpoint import CheckpointError, verify_checkpoint
from diamond.hexutil import read_json

ROOT = Path(__file__).resolve().parent.parent
VERIFY = ROOT / "vendor" / "phase0" / "verify.py"


def _strip_for_phase0(cp: dict) -> dict:
    """Phase 0 only needs size/root/(consistency_path); pass those through."""
    out = {"size": cp["size"], "root": cp["root"]}
    if "consistency_path" in cp:
        out["consistency_path"] = cp["consistency_path"]
    if "head" in cp:
        out["head"] = cp["head"]
    if "seq" in cp:
        out["seq"] = cp["seq"]
    return out


def verify_pair(
    retained_path: Path,
    presented_path: Path,
    *,
    mutate: bool = False,
    expect_pk: str | None = None,
    require_sig: bool = True,
) -> tuple[str, int]:
    # Embedded signer keys establish internal coherence, not expected identity.
    # Refuse before reading evidence, so missing inputs cannot bypass this gate.
    if require_sig and expect_pk is None:
        print("CHECKPOINT_ANCHOR_REQUIRED: supply an expected signer key (--pub)")
        return "CHECKPOINT_ANCHOR_REQUIRED", 2
    if expect_pk is not None:
        if (not isinstance(expect_pk, str) or len(expect_pk) != 64
                or any(char not in "0123456789abcdef" for char in expect_pk)):
            print("CHECKPOINT_ANCHOR_INVALID: expected 32-byte lowercase hex public key")
            return "CHECKPOINT_ANCHOR_INVALID", 2
        if not require_sig:
            print("CHECKPOINT_ANCHOR_INVALID: expected key requires signature verification")
            return "CHECKPOINT_ANCHOR_INVALID", 2
    retained = read_json(retained_path)
    presented = read_json(presented_path)
    if require_sig:
        try:
            verify_checkpoint(retained, expect_pk=expect_pk)
            verify_checkpoint(presented, expect_pk=expect_pk)
        except CheckpointError as exc:
            print(f"CHECKPOINT_SIG: FAIL ({exc})")
            return "CHECKPOINT_SIG_FAIL", 2
        print("CHECKPOINT_SIG: OK")
        print("SIGNER: SIGNER_KEY_MATCHED")
    else:
        print("CHECKPOINT_SIG: SIGNATURE_UNCHECKED")
        print("SIGNER: SIGNER_IDENTITY_UNANCHORED")
    # Hand Merkle fields to vendor phase0 (extra sig fields ignored by decide,
    # but we strip to a temp pair so --mutate still works cleanly).
    with tempfile.TemporaryDirectory(prefix="aukora-vp-") as td:
        td_path = Path(td)
        r_path = td_path / "retained.json"
        p_path = td_path / "presented.json"
        r_path.write_text(json.dumps(_strip_for_phase0(retained), indent=2) + "\n")
        p_path.write_text(json.dumps(_strip_for_phase0(presented), indent=2) + "\n")
        args = [
            sys.executable,
            str(VERIFY),
            "--retained",
            str(r_path),
            "--presented",
            str(p_path),
        ]
        if mutate:
            args.append("--mutate")
        proc = subprocess.run(args, capture_output=True, text=True)
        lines = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
        verdict = lines[-1] if lines else ""
        if proc.stdout:
            sys.stdout.write(proc.stdout)
        if proc.stderr and proc.returncode != 0:
            sys.stderr.write(proc.stderr)
        return verdict, proc.returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Signed checkpoint check + Phase 0 retained-vs-presented"
    )
    parser.add_argument("retained", nargs="?", default="out/retained.json")
    parser.add_argument("presented", nargs="?", default="out/presented.json")
    parser.add_argument("--mutate", action="store_true")
    parser.add_argument("--pub", help="required expected checkpoint signerPk hex file")
    parser.add_argument(
        "--allow-unsigned",
        action="store_true",
        help="demo escape: skip signatures and signer identity (cannot combine with --pub)",
    )
    args = parser.parse_args(argv)
    expect = None
    if args.pub is not None:
        try:
            expect = Path(args.pub).read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError) as exc:
            print(f"CHECKPOINT_ANCHOR_INVALID: cannot read expected key ({exc})")
            return 2
    verdict, rc = verify_pair(
        Path(args.retained),
        Path(args.presented),
        mutate=args.mutate,
        expect_pk=expect,
        require_sig=not args.allow_unsigned,
    )
    if verdict == "CHECKPOINT_SIG_FAIL":
        return 2
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
