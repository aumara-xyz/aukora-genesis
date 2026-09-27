"""One ephemeral plugin: grant → load → work stub → unload → dual receipts.

Retainer-B is written by a separate Python process under a separate root
(measured: separate process + separate root — not device independence).
Checkpoints (retained/presented) are signed by the issuer key.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from diamond.checkpoint import sign_checkpoint
from diamond.hexutil import require_hex, write_json
from diamond.loader import PLUGIN_ID, Loader, default_mediator, issue_demo_grant, keygen, plugin_digest

PLUGIN_BYTES = b"aukora-toy ephemeral echo\n"
ROOT = Path(__file__).resolve().parent.parent


def _retainer_b_root(out_dir: Path, override: Path | None) -> Path:
    if override is not None:
        return Path(override)
    # Prefer sibling out-b/ under the same parent when out is .../out;
    # otherwise a unique temp root so A and B never share a directory.
    if out_dir.name == "out":
        return out_dir.parent / "out-b"
    return Path(tempfile.mkdtemp(prefix="aukora-retainer-B-"))


def write_retainer_b(retained_path: Path, retainer_b_root: Path) -> Path:
    """Spawn a separate Python process to write retainer-B under its own root."""
    retainer_b_root.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT)
    r = subprocess.run(
        [
            sys.executable,
            "-m",
            "diamond.retain_handoff",
            "--from",
            str(retained_path),
            "--retainer-b-root",
            str(retainer_b_root),
        ],
        env=env,
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    if r.returncode != 0:
        raise RuntimeError(f"retain_handoff failed: {r.stderr or r.stdout}")
    dest = retainer_b_root / "retained.json"
    if not dest.is_file():
        raise RuntimeError("retainer-B retained.json missing after handoff")
    return dest


def _sign_cp(loader: Loader, checkpoint: dict) -> dict:
    _gov, _gpk, iss_seed, iss_pk = loader._keys()
    return sign_checkpoint(checkpoint, seed=iss_seed, signer_pk=iss_pk)


def run_demo(out_dir: Path, *, retainer_b_root: Path | None = None) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    keygen(out_dir)

    plugin_path = out_dir / "plugin-src.bin"
    plugin_path.write_bytes(PLUGIN_BYTES)
    loader = Loader(out_dir, mediator=default_mediator())
    aura = loader.aura

    aura.append({"kind": "session-open"})
    aura.append(
        {
            "kind": "plugin-staged",
            "pluginId": PLUGIN_ID,
            "pluginDigest": plugin_digest(PLUGIN_BYTES),
        }
    )

    expiry = int(time.time()) + 3600
    load_grant = issue_demo_grant(loader, "load", PLUGIN_BYTES, expiry)
    load = loader.activate(
        operation="load",
        plugin_bytes=PLUGIN_BYTES,
        grant=load_grant,
    )
    load_entry = load["receipt"]["aura"]["entryHash"]
    retained = _sign_cp(loader, aura.checkpoint())
    retained_path = out_dir / "retained.json"
    write_json(retained_path, retained)

    b_root = _retainer_b_root(out_dir, retainer_b_root)
    b_path = write_retainer_b(retained_path, b_root)
    # Convenience pointer inside out/ for humans (not the measured root).
    pointer = {
        "retainerBRoot": str(b_root.resolve()),
        "retained": str(b_path.resolve()),
        "measured": "separate process + separate root (not device independence)",
    }
    write_json(out_dir / "retainer-B-pointer.json", pointer)

    loader.work_stub()

    unload_grant = issue_demo_grant(loader, "unload", PLUGIN_BYTES, expiry)
    unload = loader.activate(
        operation="unload",
        plugin_bytes=PLUGIN_BYTES,
        grant=unload_grant,
        revert_of=load_entry,
    )
    presented = _sign_cp(loader, aura.checkpoint(with_proof_from=retained["size"]))
    write_json(out_dir / "presented.json", presented)

    return {
        "load": load,
        "pluginDigest": plugin_digest(PLUGIN_BYTES),
        "presented": presented,
        "retained": retained,
        "retainerB": str(b_path),
        "retainerBRoot": str(b_root),
        "unload": unload,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ephemeral plugin demo")
    parser.add_argument("--out", default="out")
    parser.add_argument(
        "--retainer-b-root",
        default=None,
        help="separate root for retainer-B (default: sibling out-b/ or temp)",
    )
    args = parser.parse_args(argv)
    b_root = Path(args.retainer_b_root) if args.retainer_b_root else None
    result = run_demo(Path(args.out), retainer_b_root=b_root)
    print(f"retained size {result['retained']['size']}")
    print(f"presented size {result['presented']['size']}")
    print("receipts: receipt-load.json receipt-unload.json")
    print(f"retainer-B root: {result['retainerBRoot']}")
    print(f"retainer-B: {result['retainerB']}")
    print("MEASURED: separate process + separate root (not device independence)")
    print("CHECKPOINTS: signed (aukora-checkpoint/v1-toy)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
