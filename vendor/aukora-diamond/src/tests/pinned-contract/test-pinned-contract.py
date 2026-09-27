#!/usr/bin/env python3
"""Pinned-contract regression check: pinned c512d0c vs this revision.

    python3 tests/pinned-contract/test-pinned-contract.py

WHY THIS EXISTS. `aumara-xyz/aukora-genesis` vendors this repository's cold
receipt court as `vendor/receipt-v3`, pinned upstream at `c512d0c`. It has since
moved to a schema in which the receipt `composition` block requires two more
fields (`compositionDigest`, `subjectDigest`). That changed which receipts were
accepted while the `kind` strings stayed identical.

WHAT IT PROVES NOW, and every row fails loudly if it stops holding. The current
revision named its composition bases and stopped deciding by field count, so the
rows that used to record a refusal record an acceptance:

  * the committed Genesis fixture (a real `aukora-receipt/v3-genesis` receipt,
    5-field composition block) is ACCEPTED by BOTH revisions. The pinned one
    accepts it under its only field set; this one accepts it as base `v1`, the
    named base an undeclared five-field block resolves to;
  * a receipt carrying the 7-field block is REFUSED by the pinned revision and
    ACCEPTED by the current one, as base `v2`;
  * a document DECLARING its base is accepted by this revision and refused by the
    pinned one, which has no `compositionBase` in its closed set at all — the
    frozen side cannot be taught a vocabulary, which is why adopting it there is a
    separate change;
  * `aura` behaviour is identical at both revisions, so the sibling-kind work is
    untouched: the 7-field genesis aura is required, and a v3-toy receipt
    carrying `priorHead` is refused by both;
  * a tampered document is refused by BOTH, which is what stops this from being
    a check that only ever says yes.

THE PINNED COLUMN IS NOT OURS TO EDIT. Every pinned-side verdict below is
re-measured from frozen bytes on every run and none of them moved when this
revision's contract changed: the three changed rows changed on the CURRENT side
only. That is the property that makes this comparison worth having.

HOW IT COMPARES WITHOUT A SIBLING CHECKOUT. The pinned revision's transitive
import closure is snapshotted byte-for-byte under `pinned/` (AGPL-3.0-or-later,
from diamond `c512d0c`) and the current revision is imported from this working tree.
The two are run in SEPARATE processes with different PYTHONPATHs, because both
are a package named `diamond` and loading them in one interpreter would silently
compare one against itself. Digests for every compared byte are in `pins.json`
and are re-verified before any comparison runs.

WHAT IT DOES NOT PROVE. It does not decide the release question: which schema
the release should use is a versioning decision for the owner of Genesis
integration, not something this script can settle. It does not test signatures
against Genesis's own emitter — Genesis is not modified, imported, or repinned
here. It says nothing about whether any receipt is TRUE, whether a human was
present, or whether a receipt authorizes anything: evidence never authorizes,
and grants authorize composition.

EXIT STATUS. 0 when every row matches its recorded expectation, 1 on any
mismatch or digest drift.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXIT_OK = 0
EXIT_MISMATCH = 1

#: AGPL-3.0-or-later bytes from diamond c512d0c, run as an isolated package.
PINNED_PATH = HERE / "pinned"
#: This working tree — the current revision. Not on the child path when the
#: pinned backend runs, so the pinned bytes cannot be shadowed by current ones.
CURRENT_PATH = HERE.parent.parent

#: A fixed, public, worthless seed. It exists so the comparison bytes carry a
#: real Ed25519 signature this check can regenerate, and so no secret is stored.
THROWAWAY_SEED = bytes.fromhex(
    "5a" * 32
)

PROBE_SOURCE = r"""
import json, sys
from pathlib import Path
from diamond.receipt import ReceiptError, verify_receipt
receipt = json.loads(Path(sys.argv[1]).read_text())
pub = Path(sys.argv[2]).read_text().strip()
try:
    approval, conformance = verify_receipt(receipt, expect_pk=pub)
except ReceiptError as exc:
    print("REFUSE\t" + str(exc))
    sys.exit(0)
except Exception as exc:                      # noqa: BLE001 - reported, not swallowed
    print("ERROR\t" + type(exc).__name__ + ": " + str(exc))
    sys.exit(0)
print("ACCEPT\t" + approval + "\t" + conformance)
"""

#: A neutral home for the probe script: not this tree, not the caller's cwd.
PROBE_HOME = Path(tempfile.mkdtemp(prefix="pinned-contract-probe-"))
PROBE_SCRIPT = PROBE_HOME / "verify_one.py"
PROBE_SCRIPT.write_text(PROBE_SOURCE)

GENESIS_RECEIPT = HERE / "fixtures" / "genesis-receipt.json"
GENESIS_PUB = HERE / "fixtures" / "genesis-issuer.pk"

PINNED_BACKEND = "pinned c512d0c"


def _short_head() -> str:
    """The revision of the tree being compared, READ rather than remembered.

    This label used to be a hardcoded SHA, and it drifted three merges behind the tree it
    described — so a green run could name a revision the check had not exercised. The
    workflow's rule is the same one: print the commit you ran against. `--dirty` marks
    tracked-file modifications, so a run over a working tree that is not the clean commit
    says so instead of borrowing the commit's name.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(CURRENT_PATH), "describe", "--always", "--dirty"],
            capture_output=True, text=True,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except OSError:
        pass
    return "unknown"


CURRENT_BACKEND = f"current {_short_head()}"

#: The frozen matrix. `reason` is matched as a substring of the refusal.
#: `accept` means the verifier returns a class/conformance pair.
MATRIX: tuple[dict, ...] = (
    {
        "name": "genesis-5field",
        "what": "the committed Genesis fixture, byte-identical, 5-field composition: "
                "accepted by both, as the named base v1",
        "pinned": {"accept": ("unattributed", "NON-CONFORMING")},
        "current": {"accept": ("unattributed", "NON-CONFORMING")},
    },
    {
        "name": "genesis-5field-resigned",
        "what": "same document re-signed by a throwaway key: isolates the field set "
                "from the committed signature",
        "pinned": {"accept": ("unattributed", "NON-CONFORMING")},
        "current": {"accept": ("unattributed", "NON-CONFORMING")},
    },
    {
        "name": "genesis-5field-declared-v1",
        "what": "the same 5-field block DECLARING compositionBase v1: this revision checks "
                "the stated base, the pinned one has no such field in its closed set",
        "pinned": {"refuse": "closed fields"},
        "current": {"accept": ("unattributed", "NON-CONFORMING")},
    },
    {
        "name": "genesis-7field",
        "what": "the newer shape: composition block plus compositionDigest and subjectDigest",
        "pinned": {"refuse": "composition closed fields"},
        "current": {"accept": ("unattributed", "NON-CONFORMING")},
    },
    {
        "name": "genesis-7field-fixture-kind",
        "what": "the 7-field block under aukora-receipt/v3-genesis-fixture",
        "pinned": {"refuse": "composition closed fields"},
        "current": {"accept": ("fixture", "FIXTURE")},
    },
    {
        "name": "genesis-7field-patentrefs",
        "what": "7-field block plus the optional patent-license reference pair",
        "pinned": {"refuse": "composition closed fields"},
        "current": {"accept": ("unattributed", "NON-CONFORMING")},
    },
    {
        "name": "genesis-5field-toy-kind",
        "what": "5-field block under aukora-receipt/v3-toy: the base, not the kind, is "
                "what decides, and both revisions accept it",
        "pinned": {"accept": ("unattributed", "NON-CONFORMING")},
        "current": {"accept": ("unattributed", "NON-CONFORMING")},
    },
    {
        "name": "genesis-missing-priorhead",
        "what": "v3-genesis with priorHead removed: pinned behaviour must be unchanged",
        "pinned": {"refuse": "aura closed"},
        "current": {"refuse": "aura closed"},
    },
    {
        "name": "toy-with-priorhead",
        "what": "v3-toy carrying priorHead: refused by both, so the sibling-kind rule "
                "did not drift",
        "pinned": {"refuse": "aura closed"},
        "current": {"refuse": "aura closed"},
    },
    {
        "name": "tampered-after-signing",
        "what": "a signed 7-field document with pluginDigest changed afterwards — the "
                "negative control",
        "pinned": {"refuse": "composition closed fields"},
        "current": {"refuse": "signature"},
    },
)

#: The tampered row's pinned refusal reason is a fixture-shape artefact (the pinned
#: verifier rejects its 7-field composition before ever reaching the signature).
#: Named here rather than left for a reader to wonder about.
TAMPER_NOTE = (
    "the tampered row is refused by the pinned revision on the closed set and by the "
    "current revision on the signature; neither accepts it, which is the property"
)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_pins() -> int:
    """Refuse to compare anything if a pinned byte is not the pinned byte."""
    pins = json.loads((HERE / "pins.json").read_text())
    problems: list[str] = []
    print("— pin verification —")
    for section, entries in (
        ("pinnedContract", pins["pinnedContract"]["files"]),
        ("fixture", pins["fixture"]["files"]),
    ):
        for entry in entries:
            path = HERE / entry["path"]
            if not path.is_file():
                problems.append(f"missing: {entry['path']}")
                continue
            got = sha256_of(path)
            if got != entry["sha256"]:
                problems.append(
                    f"{entry['path']}: sha256 {got} != pinned {entry['sha256']}"
                )
                continue
            print(f"  ok  {entry['path']}  {got[:16]}…  ({section})")
    for problem in problems:
        print(f"  FAIL {problem}", file=sys.stderr)
    if problems:
        print(f"\nPIN DRIFT: {len(problems)} byte(s) do not match pins.json", file=sys.stderr)
        return EXIT_MISMATCH
    print(
        f"  pinned: {pins['pinnedContract']['commitShort']} "
        f"({pins['pinnedContract']['licence']})   "
        f"fixture: Genesis {pins['fixture']['commitShort']}"
    )
    return EXIT_OK


def load_pinned_signer():
    """Import only the pinned receipt module, from its isolated path."""
    sys.path.insert(0, str(PINNED_PATH))
    try:
        for name in list(sys.modules):
            if name == "diamond" or name.startswith("diamond."):
                del sys.modules[name]
        from diamond.receipt import to_sign_bytes  # type: ignore
        from diamond.ed25519 import public_from_seed, sign  # type: ignore
        from diamond.hexutil import to_hex  # type: ignore
    finally:
        sys.path.remove(str(PINNED_PATH))
    pk = to_hex(public_from_seed(THROWAWAY_SEED))

    def resign(document: dict) -> dict:
        out = dict(document)
        out["issuerPk"] = pk
        out.pop("sig", None)
        out["sig"] = to_hex(sign(THROWAWAY_SEED, to_sign_bytes(out)))
        return out

    return resign, pk


def load_current_signer():
    """Import only the CURRENT receipt module, from this working tree.

    The pinned signer cannot sign a document that declares a base: the pinned `to_sign_bytes`
    does not cover `compositionBase`, and a declaration the signature does not cover is
    refused by the current verifier — correctly, because that is the whole point of signing
    it. So the one row carrying a declaration is signed the way the revision under test signs.
    Both modules are named `diamond`, so the same clearing dance is used and only the
    captured functions are kept; the pinned closures above stay valid because they hold their
    own module objects.
    """
    sys.path.insert(0, str(CURRENT_PATH))
    try:
        for name in list(sys.modules):
            if name == "diamond" or name.startswith("diamond."):
                del sys.modules[name]
        from diamond.receipt import to_sign_bytes as current_to_sign_bytes  # type: ignore
        from diamond.ed25519 import (  # type: ignore
            public_from_seed as current_public_from_seed,
            sign as current_sign,
        )
        from diamond.hexutil import to_hex as current_to_hex  # type: ignore
    finally:
        sys.path.remove(str(CURRENT_PATH))
    pk = current_to_hex(current_public_from_seed(THROWAWAY_SEED))

    def resign(document: dict) -> dict:
        out = dict(document)
        out["issuerPk"] = pk
        out.pop("sig", None)
        out["sig"] = current_to_hex(current_sign(THROWAWAY_SEED, current_to_sign_bytes(out)))
        return out

    return resign, pk


FIVE_FIELDS = (
    "coeffectEnvelopeDigest",
    "operation",
    "pluginId",
    "pluginDigest",
    "revertOf",
)


def build_variants(resign, throwaway_pk: str, current_resign) -> dict[str, dict]:
    """Every comparison document, derived from the one committed Genesis fixture."""
    base = json.loads(GENESIS_RECEIPT.read_text())
    out_dir = Path(tempfile.mkdtemp(prefix="pinned-contract-"))
    variants: dict[str, dict] = {}

    def emit(name: str, document: dict, pub: str) -> None:
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        pk_path = out_dir / f"{name}.pk"
        pk_path.write_text(pub + "\n")
        variants[name] = {"receipt": path, "pub": pk_path}

    seven = dict(base["composition"])
    seven["compositionDigest"] = "66" * 32
    seven["subjectDigest"] = "77" * 32

    toy_aura = {k: v for k, v in base["aura"].items() if k != "priorHead"}
    status_quo = {
        "aura": base["aura"],
        "composition": base["composition"],
        "issuedAt": base["issuedAt"],
        "kind": base["kind"],
        "nonce": base["nonce"],
    }

    def with_kind(kind: str, aura: dict, comp: dict) -> dict:
        return {
            "aura": aura,
            "composition": comp,
            "issuedAt": base["issuedAt"],
            "kind": kind,
            "nonce": base["nonce"],
        }

    # The committed fixture is used exactly as committed, with its own public key.
    variants["genesis-5field"] = {
        "receipt": GENESIS_RECEIPT,
        "pub": GENESIS_PUB,
    }

    pk5 = throwaway_pk
    emit("genesis-5field-resigned", resign(status_quo), pk5)
    emit(
        "genesis-5field-declared-v1",
        current_resign({**status_quo, "compositionBase": "v1"}),
        pk5,
    )
    emit("genesis-7field", resign(with_kind(base["kind"], base["aura"], seven)), pk5)

    patentrefs = dict(seven)
    patentrefs["patentDocketId"] = "AUKORA-TOY-PROVISIONAL-B"
    patentrefs["patentLicenseNonce"] = "88" * 32
    emit(
        "genesis-7field-patentrefs",
        resign(with_kind(base["kind"], base["aura"], patentrefs)),
        pk5,
    )
    emit(
        "genesis-7field-fixture-kind",
        resign(with_kind("aukora-receipt/v3-genesis-fixture", base["aura"], seven)),
        pk5,
    )
    emit(
        "genesis-5field-toy-kind",
        resign(with_kind("aukora-receipt/v3-toy", toy_aura, base["composition"])),
        pk5,
    )

    no_prior = {k: v for k, v in base["aura"].items() if k != "priorHead"}
    emit(
        "genesis-missing-priorhead",
        resign(with_kind(base["kind"], no_prior, seven)),
        pk5,
    )
    emit(
        "toy-with-priorhead",
        resign(with_kind("aukora-receipt/v3-toy", base["aura"], seven)),
        pk5,
    )

    tampered = resign(with_kind(base["kind"], base["aura"], seven))
    tampered["composition"] = dict(seven)
    tampered["composition"]["pluginDigest"] = "ab" * 32
    emit("tampered-after-signing", tampered, pk5)

    return variants





def run_backend(name: str, path: str, receipt: Path, pub: Path) -> dict:
    """Run one verifier in its own process with its own PYTHONPATH.

    The probe is written to a NEUTRAL directory and run as a script, never with
    `-c`. Two reasons, both learned by getting it wrong: python -c puts the
    current working directory at sys.path[0], so a repo cwd lets this tree's own
    `diamond` package shadow the pinned one and the check silently compares the
    current revision against itself; and a script's own directory is what lands
    on sys.path, so running from a neutral home keeps the shadow out entirely.
    Now that this is explicit, the env is passed through so `python3` resolves.
    """
    env = dict(os.environ)
    env["PYTHONPATH"] = path
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    proc = subprocess.run(
        [sys.executable, "-B", str(PROBE_SCRIPT), str(receipt), str(pub)],
        capture_output=True,
        text=True,
        cwd=str(PROBE_HOME),
        env=env,
    )
    if proc.returncode != 0:
        return {"verdict": "ERROR", "detail": (proc.stderr or "").strip()[-200:]}
    line = (proc.stdout or "").strip().splitlines()
    if not line:
        return {"verdict": "ERROR", "detail": "no output"}
    parts = line[-1].split("\t")
    if parts[0] == "ACCEPT":
        return {"verdict": "ACCEPT", "approval": parts[1], "conformance": parts[2]}
    if parts[0] == "REFUSE":
        return {"verdict": "REFUSE", "reason": parts[1]}
    return {"verdict": "ERROR", "detail": parts[-1]}


def format_result(result: dict) -> str:
    if result["verdict"] == "ACCEPT":
        return f"ACCEPT {result['approval']}/{result['conformance']}"
    if result["verdict"] == "REFUSE":
        return f"REFUSE {result['reason']}"
    return f"ERROR {result.get('detail', '')}"


def matches(result: dict, expected: dict) -> bool:
    if "accept" in expected:
        if result["verdict"] != "ACCEPT":
            return False
        return (result["approval"], result["conformance"]) == expected["accept"]
    return (
        result["verdict"] == "REFUSE"
        and expected["refuse"] in (result.get("reason") or "")
    )


def main() -> int:
    if verify_pins() != EXIT_OK:
        return EXIT_MISMATCH
    if not GENESIS_RECEIPT.is_file():
        print("fixture missing", file=sys.stderr)
        return EXIT_MISMATCH

    resign, throwaway_pk = load_pinned_signer()
    current_resign, _current_pk = load_current_signer()
    variants = build_variants(resign, throwaway_pk, current_resign)

    print("\n— frozen matrix —")
    print(
        f"  pinned backend   : {PINNED_BACKEND}   PYTHONPATH={PINNED_PATH}\n"
        f"  current backend  : {CURRENT_BACKEND}  PYTHONPATH={CURRENT_PATH}\n"
        f"  throwaway issuer : {throwaway_pk[:16]}… (public; seed is fixed in this file)"
    )
    header = (f"{'VARIANT':<28} | {PINNED_BACKEND:<36} | {CURRENT_BACKEND:<36} | VERDICT")
    print("\n" + header)
    print("-" * len(header))

    matrix_digest = hashlib.sha256()
    failures: list[str] = []
    for row in MATRIX:
        variant = variants[row["name"]]
        pinned = run_backend(PINNED_BACKEND, str(PINNED_PATH), variant["receipt"], variant["pub"])
        current = run_backend(CURRENT_BACKEND, str(CURRENT_PATH), variant["receipt"], variant["pub"])
        ok = matches(pinned, row["pinned"]) and matches(current, row["current"])
        if not ok:
            failures.append(row["name"])
        print(
            f"{row['name']:<28} | {format_result(pinned):<36} | "
            f"{format_result(current):<36} | {'ok' if ok else 'MISMATCH'}"
        )
        matrix_digest.update(
            f"{row['name']}|{format_result(pinned)}|{format_result(current)}\n".encode()
        )

    print("\n— what the rows mean —")
    print(
        "  The committed Genesis fixture is ACCEPTED by BOTH revisions: the pinned one under\n"
        "  its only field set, this one as the named base v1. A five-field block is no longer\n"
        "  refused here, so the refusal a reader used to see — an anonymous closed-set\n"
        "  failure decided by counting fields — is gone. A seven-field block is still refused\n"
        "  by the pinned revision and accepted here as base v2, and a document that DECLARES\n"
        "  its base is refused by the pinned revision because its closed set has no\n"
        "  compositionBase in it at all.\n"
        f"  {TAMPER_NOTE[0].upper()}{TAMPER_NOTE[1:]}."
    )
    print(f"\nMATRIX_SHA256: {matrix_digest.hexdigest()}")

    if failures:
        print(
            f"\nPINNED-CONTRACT REGRESSION: RED — {len(failures)} row(s) did not match: "
            f"{', '.join(failures)}",
            file=sys.stderr,
        )
        return EXIT_MISMATCH
    print(f"\nPINNED-CONTRACT REGRESSION: GREEN — {len(MATRIX)}/{len(MATRIX)} rows as recorded")
    print(
        "VERSIONING NOTE: this check records that the composition closed set changed while\n"
        "the kind strings did not, and that this revision then named its bases so acceptance\n"
        "no longer depends on counting fields. The pinned column above is re-measured from\n"
        "frozen bytes every run and NONE of it moved — that is the property worth keeping.\n"
        "Whether Genesis emits a compositionBase is a separate change in Genesis."
    )
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
