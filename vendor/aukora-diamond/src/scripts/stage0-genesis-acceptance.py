#!/usr/bin/env python3
"""Stage 0 acceptance: Genesis MINTS under the shared contract, Diamond VERIFIES, both state it.

    python3 scripts/stage0-genesis-acceptance.py --genesis <path to a Genesis checkout>

THE COMMAND THAT IS SUPPOSED TO BE GREEN AFTER THE PIN. Today it is RED, and the RED is the
finding: the shared contract version does not exist yet, because the producer cannot carry it.
After Genesis admits the field in its closed set (and moves its pin so its vendored verifier
understands it), the same command goes green with no change here — nothing in this file, and
nothing in this repository's law, has to move for that.

THREE LEGS, all measured, none assumed:

  1. MINT      Genesis's own producer is asked for a receipt under the shared contract. What is
               asked of it is the CONTRACT, not an API: the document it produces must declare its
               composition base. Today it can do neither — no parameter, and a closed set that
               refuses the field by name.
  2. VERIFY    THIS repository's cold court judges that document, from a NEUTRAL EMPTY CWD with
               its own CLI, and must say which base it checked.
  3. SYMMETRY  Genesis's vendored verifier judges the same document. If only one side knows the
               version, the two trees are not speaking one contract, whatever each prints.

JUNK IS REFUSED IN THE SAME RUN: a byte changed after signing must fail the signature, so this
command cannot go green by loosening anything.

WHAT THIS DOES NOT DO. It does not modify Genesis, stage anything in it, or repin it: it reads a
checkout you name and runs its producer and its verifier as separate processes. It does not decide
whether Genesis SHOULD adopt the contract — it measures whether both trees can already speak it.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SEED_HEX = "5a" * 32  # public, worthless, the same throwaway key the fixture uses
NEUTRAL = Path(tempfile.mkdtemp(prefix="stage0-neutral-"))

#: The producer, run in ITS tree with ITS closure on the path and nothing of ours. Their module
#: names (`receipt`, `jcs`, `ed25519`) are generic enough to collide with ours, which is one more
#: reason the boundary is a process and not an import.
MINT = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
import receipt as gen, ed25519 as ed, jcs
from hexutil import to_hex

seed = bytes.fromhex("__SEED__")
entry = "11" * 32
aura = {"entryHash": entry, "head": entry, "prevHash": "00" * 32, "priorHead": "00" * 32,
        "root": "22" * 32, "seq": 1, "size": 1}
comp = {"coeffectEnvelopeDigest": "44" * 32, "operation": "load", "pluginDigest": "55" * 32,
        "pluginId": "stage0-plugin", "revertOf": ""}
kw = dict(seed=seed, issuer_pk=ed.public_from_seed(seed), kind=gen.KIND_LIVE,
          issued_at=1789551177, nonce="33" * 32, aura=aura, composition=comp)

# Ask for the contract first; fall back to the bare producer so the report can say WHICH happened.
declared_param = False
try:
    doc = gen.issue(composition_base="v1", **kw)
    declared_param = True
except TypeError:
    doc = gen.issue(**kw)

result = {"document": doc, "declared_param": declared_param,
          "declares": doc.get("compositionBase"),
          "closed": list(gen.FIELDS)}
# Can its own checker carry the field at all? A copy, signed the way vN would sign it.
vN = dict(doc, compositionBase="v1")
signed = {k: vN[k] for k in gen.SIGNED_FIELDS}
signed["compositionBase"] = "v1"
vN.pop("sig", None)
vN["sig"] = to_hex(ed.sign(seed, gen.domain_for(vN["kind"]) + jcs.canonicalize_bytes(signed)))
try:
    gen.check_payload(vN)
    result["vN_check"] = "ACCEPTED"
except Exception as exc:                      # their CompositionRefusal
    result["vN_check"] = f"{type(exc).__name__}: {exc}"
    codes = getattr(exc, "codes", None) or getattr(exc, "code", None)
    result["vN_codes"] = str(codes)
result["vN_document"] = vN
print(json.dumps(result))
'''.replace("__SEED__", SEED_HEX)

FAILURES = 0


def ok(label: str, detail: str = "") -> None:
    print(f"  ok    {label}" + (f" — {detail}" if detail else ""))


def bad(label: str, detail: str = "") -> None:
    global FAILURES
    FAILURES += 1
    print(f"  RED   {label}" + (f" — {detail}" if detail else ""))


def diamond_court(receipt: Path, pub: Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, "-B", "-m", "diamond.cold_verify", str(receipt), "--pub", str(pub)],
        capture_output=True, text=True, cwd=str(NEUTRAL),
        env={"PYTHONPATH": str(REPO), "PYTHONDONTWRITEBYTECODE": "1", "PATH": "/usr/bin:/bin"},
    )
    return proc.returncode, ((proc.stdout or "") + (proc.stderr or "")).strip()


def genesis_verifier(genesis: Path, receipt: Path, pub: Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(genesis / "scripts" / "receipt-verify"), str(receipt), "--pub", str(pub)],
        capture_output=True, text=True, cwd=str(NEUTRAL),
    )
    return proc.returncode, ((proc.stdout or "") + (proc.stderr or "")).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--genesis", required=True, help="path to an aukora-genesis checkout")
    args = parser.parse_args()
    genesis = Path(args.genesis).resolve()
    head = subprocess.run(["git", "-C", str(genesis), "rev-parse", "--short", "HEAD"],
                          capture_output=True, text=True).stdout.strip()

    print("\nStage 0 acceptance — Genesis mints under the shared contract, Diamond verifies\n")
    print(f"  genesis checkout : {genesis}  (HEAD {head or 'unknown'})")
    print(f"  diamond          : {REPO}  (court runs from {NEUTRAL})")
    print()

    # ── leg 1: mint ────────────────────────────────────────────────────────────────
    proc = subprocess.run([sys.executable, "-B", "-c", MINT, str(genesis / "scripts" / "composition")],
                          capture_output=True, text=True, cwd=str(NEUTRAL))
    if proc.returncode != 0:
        bad("mint", (proc.stderr or proc.stdout).strip().splitlines()[-1][:140])
        print("\n  the producer could not be run at all; nothing to verify")
        return 1
    minted = json.loads(proc.stdout)
    doc = minted["document"]
    doc_path = NEUTRAL / "stage0-minted.json"
    doc_path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    vN_path = NEUTRAL / "stage0-vN.json"
    vN_path.write_text(json.dumps(minted["vN_document"], indent=2, sort_keys=True) + "\n")
    pub_path = NEUTRAL / "stage0-issuer.pk"
    pub_path.write_text(doc["issuerPk"] + "\n")

    if minted["declares"] == "v1":
        ok("mint", "Genesis declared compositionBase v1"
                    + (" (via its own parameter)" if minted["declared_param"] else ""))
    else:
        bad("mint", "Genesis produced a receipt with no compositionBase — it cannot state the "
                    "contract version it is speaking")

    if minted["vN_check"] == "ACCEPTED":
        ok("mint-vN-carriable", "Genesis's own closed set admits compositionBase")
    else:
        bad("mint-vN-carriable",
            f"Genesis refuses the field: {minted.get('vN_codes', '?')} — {minted['vN_check'][:110]}")

    # ── leg 2: Diamond verifies ────────────────────────────────────────────────────
    rc, text = diamond_court(doc_path, pub_path)
    if rc == 0 and "COMPOSITION BASE: v1" in text:
        ok("diamond-verifies", "accepted as base v1, and the court says so")
    else:
        last = next((ln for ln in reversed(text.splitlines()) if ln.strip()), "")
        bad("diamond-verifies", f"rc={rc} {last[:120]}")

    rc, text = diamond_court(vN_path, pub_path)
    if rc == 0 and "COMPOSITION BASE: v1" in text:
        ok("diamond-verifies-declared", "the vN shape is accepted as base v1")
    else:
        last = next((ln for ln in reversed(text.splitlines()) if ln.strip()), "")
        bad("diamond-verifies-declared", f"rc={rc} {last[:120]}")

    # ── leg 3: symmetry — their vendored verifier on the declared document ─────────
    rc, text = genesis_verifier(genesis, vN_path, pub_path)
    if rc == 0:
        ok("genesis-vendored-verifies-declared", "the vendored verifier accepts the v1 declaration")
    else:
        last = next((ln for ln in reversed(text.splitlines()) if ln.strip()), "")
        bad("genesis-vendored-verifies-declared",
            f"rc={rc} {last[:120]} — the pin is older than the contract")

    # ── junk, in the same run ──────────────────────────────────────────────────────
    tampered = json.loads(doc_path.read_text())
    tampered["composition"]["pluginDigest"] = "ab" * 32
    tampered_path = NEUTRAL / "stage0-tampered.json"
    tampered_path.write_text(json.dumps(tampered, indent=2, sort_keys=True) + "\n")
    rc, text = diamond_court(tampered_path, pub_path)
    if rc != 0 and "signature" in text:
        ok("junk-refused", "a byte changed after signing still fails the signature")
    else:
        bad("junk-refused", f"rc={rc} — a tampered document was not refused on the signature")

    print()
    if FAILURES:
        print(f"  STAGE 0 ACCEPTANCE: RED — {FAILURES} leg(s) red today\n")
        print("  What has to move is on the GENESIS side, and only there:")
        print("    1. its closed set admits `compositionBase` (FIELDS) and its signature covers it")
        print("       only when present, so receipts minted before the field still verify;")
        print("    2. its producer stamps the base it composed under (its block is already v1);")
        print("    3. its pin moves to a revision whose vendored verifier knows the field.")
        print("  Nothing in this repository's law changes for any of that: run this command again")
        print("  after the pin and every leg above is expected to be green.")
        return 1
    print("  STAGE 0 ACCEPTANCE: GREEN — both trees speak the same contract version")
    return 0


if __name__ == "__main__":
    sys.exit(main())
