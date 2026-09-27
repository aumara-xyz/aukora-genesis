#!/usr/bin/env python3
"""Stage 0 consumer readiness: a GENESIS-minted receipt, verified by THIS repository's court.

    python3 scripts/verify-genesis-minted-acceptance.py

WHY THIS EXISTS. Genesis produces receipts; Diamond consumes them. That sentence was true in the
design and unproven in the tree: the committed fixture here was minted by Genesis's own producer
(`scripts/composition/receipt.py` in that checkout) and nothing in this repository ran it through
this repository's court. This check does, from a NEUTRAL EMPTY CWD with the court's own CLI, so
the verdict is the one a stranger gets rather than one assembled in this process.

WHAT IT PROVES, and each arm fails if its property stops holding:

  * the Genesis-minted receipt is ACCEPTED, as the named base `v1`. Genesis does not emit
    `compositionBase`; this repository accepts the document by the closed legacy rule, and the
    court SAYS which base it checked.
  * the same document re-signed WITH `compositionBase: "v1"` is also accepted — the shape Genesis
    will have after it adopts the shared contract, so consumer readiness for vN is measured
    before vN exists rather than assumed.
  * an unknown base name is refused BY NAME, and a base that contradicts its own block is refused
    naming the base it checked. Nothing here accepts a document because it is old.
  * JUNK IS STILL REFUSED: a byte changed after signing fails the signature, and the same
    document under the wrong public key fails on the key. A check that only ever says yes would
    be decoration.

WHAT IT DOES NOT DO. It does not modify Genesis, import it, or pin it. It does not verify that the
receipt is TRUE, that anything happened, or that anyone was present: class and conformance are
derived, live is `unattributed` / `NON-CONFORMING`, attendance is reported-not-proven. Evidence
never authorizes.

THE FIXTURE'S ISSUER IS PUBLIC. The signing seed is the fixed constant 0x5a repeated, written in
the pins file and in this script. Every arm that needs a different shape re-signs a copy at run
time, which is why no re-signed document is committed.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
FIXTURES = REPO / "tests" / "genesis-minted"

#: Public, worthless, fixed. The fixture's issuer key is derived from it, and every arm that
#: needs a different document signs a copy with it so the ONLY variable is the shape.
THROWAWAY_SEED = bytes.fromhex("5a" * 32)

FAILURES = 0
ARMS = 0
NEUTRAL = Path(tempfile.mkdtemp(prefix="genesis-minted-neutral-"))


def ok(label: str, detail: str = "") -> None:
    global ARMS
    ARMS += 1
    print(f"  ok    {label}" + (f" — {detail}" if detail else ""))


def bad(label: str, detail: str = "") -> None:
    global ARMS, FAILURES
    ARMS += 1
    FAILURES += 1
    print(f"  FAIL  {label}" + (f" — {detail}" if detail else ""))


def verify_pins() -> dict[str, str]:
    """The bytes must be the bytes before anything is judged."""
    pins = json.loads((FIXTURES / "pins.json").read_text())
    digests = {}
    for entry in pins["files"]:
        path = FIXTURES / entry["path"]
        got = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "missing"
        if got != entry["sha256"]:
            raise SystemExit(f"PIN DRIFT: {entry['path']} {got} != {entry['sha256']}")
        digests[entry["path"]] = got
    return digests


def court(receipt: Path, pub: Path) -> tuple[int, str]:
    """Run THIS repository's cold court as its own CLI, from a neutral empty cwd."""
    proc = subprocess.run(
        [sys.executable, "-B", "-m", "diamond.cold_verify", str(receipt), "--pub", str(pub)],
        capture_output=True, text=True, cwd=str(NEUTRAL),
        env={"PYTHONPATH": str(REPO), "PYTHONDONTWRITEBYTECODE": "1", "PATH": "/usr/bin:/bin"},
    )
    return proc.returncode, ((proc.stdout or "") + (proc.stderr or "")).strip()


def resign(document: dict, **over) -> dict:
    """Re-sign a copy the way this repository signs: required fields + a declaration if present."""
    sys.path.insert(0, str(REPO))
    from diamond.ed25519 import public_from_seed, sign
    from diamond.hexutil import to_hex
    from diamond.receipt import to_sign_bytes

    out = dict(document, **over)
    signed = {k: out[k] for k in ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce")}
    if "compositionBase" in out:
        signed["compositionBase"] = out["compositionBase"]
    signed["issuerPk"] = to_hex(public_from_seed(THROWAWAY_SEED))
    out.pop("sig", None)
    out["issuerPk"] = signed["issuerPk"]
    out["sig"] = to_hex(sign(THROWAWAY_SEED, to_sign_bytes(signed)))
    return out


def expect(label: str, rc: int, text: str, *, code: int, needle: str) -> None:
    last = next((ln for ln in reversed(text.splitlines()) if ln.strip()), "")
    if rc != code:
        bad(label, f"rc={rc} (wanted {code}): {last[:110]}")
    elif needle not in text:
        bad(label, f"rc correct but {needle!r} absent: {last[:110]}")
    else:
        ok(label, f"rc={rc}: {last[:110]}")


def main() -> int:
    digests = verify_pins()
    receipt = FIXTURES / "receipt.json"
    pub = FIXTURES / "issuer.pk"
    print("\nStage 0 — a Genesis-minted receipt, judged by this repository's court\n")
    print(f"  fixture        : {receipt.relative_to(REPO)}  sha256 {digests['receipt.json'][:16]}…")
    print(f"  minted by      : Genesis scripts/composition/receipt.py at 704ae19 (its own producer)")
    print(f"  court runs in  : {NEUTRAL} (empty, neutral — not this repository's cwd)")
    print()

    document = json.loads(receipt.read_text())

    rc, text = court(receipt, pub)
    expect("genesis-minted-accepted", rc, text, code=0, needle="COMPOSITION BASE: v1")

    declared = Path(NEUTRAL / "declared-v1.json")
    declared.write_text(json.dumps(resign(document, compositionBase="v1"), indent=2,
                                  sort_keys=True) + "\n")
    rc, text = court(declared, pub)
    expect("declared-v1-accepted", rc, text, code=0, needle="COMPOSITION BASE: v1")

    unknown = Path(NEUTRAL / "declared-v9.json")
    unknown.write_text(json.dumps(resign(document, compositionBase="v9"), indent=2,
                                  sort_keys=True) + "\n")
    rc, text = court(unknown, pub)
    expect("unknown-base-refused-by-name", rc, text, code=2, needle="compositionBase unknown: 'v9'")

    contradiction = Path(NEUTRAL / "contradiction.json")
    contradiction.write_text(json.dumps(resign(document, compositionBase="v2"), indent=2,
                                        sort_keys=True) + "\n")
    rc, text = court(contradiction, pub)
    expect("contradiction-refused-naming-the-base", rc, text, code=2,
           needle="composition closed fields (base v2)")

    tampered = Path(NEUTRAL / "tampered.json")
    mutilated = json.loads(receipt.read_text())
    mutilated["composition"]["pluginDigest"] = "ab" * 32
    tampered.write_text(json.dumps(mutilated, indent=2, sort_keys=True) + "\n")
    rc, text = court(tampered, pub)
    expect("tampered-after-signing-refused", rc, text, code=2, needle="signature")

    other_pub = Path(NEUTRAL / "other.pk")
    other_pub.write_text("00" * 32 + "\n")
    rc, text = court(receipt, other_pub)
    expect("wrong-public-key-refused", rc, text, code=2, needle="issuerPk mismatch")

    print()
    if FAILURES:
        print(f"  {FAILURES} of {ARMS} arms FAILED\n\n  GENESIS-MINTED ACCEPTANCE: RED")
        return 1
    print(f"  {ARMS}/{ARMS} arms produced their published result\n\n"
          "  GENESIS-MINTED ACCEPTANCE: GREEN")
    print(
        "\n  NOTE: accepted means the signature verifies under the named key, the closed sets\n"
        "  hold, and the base checked is stated. It does not mean the receipt is true, that a\n"
        "  transition happened, or that anyone was present. Attendance: reported-not-proven."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
