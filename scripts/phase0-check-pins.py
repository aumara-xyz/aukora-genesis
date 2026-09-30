#!/usr/bin/env python3
"""Check that every vendored tree still holds the exact upstream bytes.

The pin is a measurement, not a promise. Each `upstream-*.json` manifest records the
sha256 and byte length of every file vendored from one upstream location; this script
recomputes both from the bytes that would actually run and refuses when any file has
drifted, gained an undeclared sibling, or gone missing.

The Golden Boundary archive is separately pinned as authored history, while its
live paper must remain below the candidate file cap imported from proposal law.

    python3 scripts/phase0-check-pins.py            check every tree
    python3 scripts/phase0-check-pins.py --mutate   check the check: pinned files are
                                                    altered in a disposable copy and
                                                    the checker must refuse them

The trees are not hardcoded one at a time: `VENDOR_TREES` names each vendor directory
together with the manifests that pin it, and every file under every named tree is walked
and required to be declared. A vendor directory that is absent from that registry is not
checked at all, which is why adding a tree means adding a line there and nothing else.

Three rules a reader should know, because each one is a decision:

1. A directory named `target/` is build output, never vendored bytes. The vendored Rust
   replica has to be BUILT to be evidence that it works, and building fills `target/`
   with hundreds of files. Treating that as drift would mean the checker could only pass
   in a tree nobody had verified. The exclusion is named here, in the open, rather than
   left to a .gitignore the checker would otherwise ignore.
2. Files that are Genesis-authored rather than upstream bytes are declared in each
   manifest's `genesisAuthored` list. Pinning them as upstream would be a false
   provenance claim, so they are declared instead — and a declared file that goes
   missing is still a failure.
3. The manifests are not pinned inside themselves; a file cannot carry its own digest.
   Every run prints their digests instead, so a reader can cite what was measured.

Exit 0 only when every pin matches. Exit 1 on drift, on an undeclared file, on a
missing file, or - under --mutate - when an altered copy was accepted anyway.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# (vendor directory, the manifests that pin it). One line per vendored tree; a tree that
# is missing here is unpinned, and nothing else in this file needs to know about it.
VENDOR_TREES = (
    ("vendor/append-only", ("upstream-phase0.json", "upstream-replicas.json")),
    ("vendor/receipt", ("upstream-receipt-v3.json",)),
    # Diamond's cold Kira evidence consumer. Registered here so the closure that a release
    # carries is the closure these pins check: the same manifest that materialize copies is
    # the one this holds to per-file sha256 and byte count, on both sides of the copy.
    ("vendor/kira-export", ("upstream-diamond.json",)),
    # OpenViking's licence and install pins (the package itself is installed into a venv by
    # scripts/openviking-setup.sh, never vendored): the LICENSE bytes are held to the manifest here.
    ("vendor/openviking", ("upstream-openviking.json",)),
    ("plugins/aukora-face/messages/src/vendor/jsqr", ("upstream-jsqr.json",)),
)
BUILD_OUTPUT_DIRS = ("target",)
BOUNDARY_LIVE = "docs/AUKORA-GOLDEN-BOUNDARY.md"
BOUNDARY_ARCHIVE = "docs/AUKORA-GOLDEN-BOUNDARY-ARCHIVE.md"
BOUNDARY_PIN = "docs/AUKORA-GOLDEN-BOUNDARY-ARCHIVE.pin.json"


def check_boundary(root: str) -> tuple[list[str], dict]:
    """Keep the live paper below the candidate ceiling and the archive byte-pinned.

    The documents may be scratch copies; the cap always comes from this check's
    checkout. Refuse if the authority stops using the imported proposal ceiling.
    """
    problems: list[str] = []
    summary: dict = {}
    try:
        authority_path = os.path.join(ROOT, "scripts/aukora/aumlok-candidate-authority.mjs")
        with open(authority_path, encoding="utf-8") as fh:
            authority = fh.read()
        bindings = (
            "import { deriveIntentId, deriveDraftHash, LIMITS } from '../../vendor/aukora-seed-app/lib/apps/seed/src/proposal.js'",
            "const byteLimit = (path, generated) => generated?.has(path) ? GENERATED_MAX_BYTES : LIMITS.MAX_PATCH_BYTES",
            "function sourceBytes(repo, path, expectedMode, maxBytes = LIMITS.MAX_PATCH_BYTES)",
            "if (!st.isFile() || st.size > maxBytes) deny('candidate:requires-regular-text')",
        )
        if not all(binding in authority for binding in bindings):
            raise ValueError("candidate cap binding changed; review the paper ceiling check")
        cap_run = subprocess.run([
            "node", "--input-type=module", "-e",
            "import { LIMITS } from './vendor/aukora-seed-app/lib/apps/seed/src/proposal.js'; "
            "process.stdout.write(JSON.stringify(LIMITS.MAX_PATCH_BYTES))",
        ], cwd=ROOT, capture_output=True, text=True, check=True)
        cap = json.loads(cap_run.stdout)
        if type(cap) is not int or cap <= 0:
            raise ValueError("candidate cap is not a positive integer")
        live_bytes = os.path.getsize(os.path.join(root, BOUNDARY_LIVE))
        summary.update(cap=cap, liveBytes=live_bytes)
        if live_bytes >= cap:
            problems.append(f"{BOUNDARY_LIVE}: {live_bytes} bytes is not below candidate cap {cap}")
    except Exception as exc:
        problems.append(f"{BOUNDARY_LIVE}: candidate cap check failed: {exc}")
    try:
        with open(os.path.join(root, BOUNDARY_PIN), encoding="utf-8") as fh:
            pin = json.load(fh)
        digest, length = sha256_file(os.path.join(root, BOUNDARY_ARCHIVE))
        summary["archiveBytes"] = length
        if digest != pin.get("sha256"):
            problems.append(f"{BOUNDARY_ARCHIVE}: sha256 {digest} != pinned {pin.get('sha256')}")
        if length != pin.get("bytes"):
            problems.append(f"{BOUNDARY_ARCHIVE}: {length} bytes != pinned {pin.get('bytes')}")
    except Exception as exc:
        problems.append(f"{BOUNDARY_ARCHIVE}: pin check failed: {exc}")
    return problems, summary


def sha256_file(path: str) -> tuple[str, int]:
    h = hashlib.sha256()
    total = 0
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            h.update(chunk)
    return h.hexdigest(), total


def load_manifest(root: str, vendor_rel: str, name: str) -> dict:
    with open(os.path.join(root, vendor_rel, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def is_build_output(rel: str) -> bool:
    return any(part in BUILD_OUTPUT_DIRS for part in rel.split(os.sep))


def discover(root: str, vendor_rel: str) -> list[str]:
    """Every regular file under the vendor dir, relative to it, sorted. Build output is
    counted separately by the caller rather than mixed into the pin set."""
    base = os.path.join(root, vendor_rel)
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(base):
        # Python writes __pycache__ when a pinned verifier runs; it is generated, never pinned.
        dirnames[:] = sorted(d for d in dirnames if d != '__pycache__')
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, base)
            if os.path.islink(full):
                found.append(rel + " (symlink)")
                continue
            found.append(rel)
    return sorted(found)


def check(root: str) -> tuple[list[str], dict]:
    """Return (complaints, summary). Empty complaints means every pin matched."""
    problems: list[str] = []
    summary: dict = {"trees": [], "pinned": 0, "authored": 0, "buildOutput": 0}

    for vendor_rel, manifests in VENDOR_TREES:
        tree: dict = {"vendor": vendor_rel, "manifests": [], "pinned": 0, "authored": 0,
                      "buildOutput": 0}
        # Keyed by (tree, path relative to it): the same relative path in two trees is two
        # different files — both trees carry a LICENSE — so a complaint has to say which
        # tree it means.
        pinned: dict[tuple[str, str], dict] = {}
        authored: set[tuple[str, str]] = set()
        manifest_names: set[str] = set()

        for name in manifests:
            path = os.path.join(root, vendor_rel, name)
            where = f"{vendor_rel}/{name}"
            if not os.path.isfile(path):
                # A declared manifest that is absent is a failure, never a skip.
                problems.append(f"{where}: declared manifest is missing from the vendor tree")
                continue
            try:
                manifest = load_manifest(root, vendor_rel, name)
            except Exception as exc:
                problems.append(f"{where}: unreadable: {exc}")
                continue
            manifest_names.add(name)
            digest, length = sha256_file(path)
            tree["manifests"].append({
                "name": name,
                "sha256": digest,
                "bytes": length,
                "repository": manifest.get("repository"),
                "commit": manifest.get("commit"),
                "files": len(manifest.get("files", [])),
            })
            for entry in manifest.get("files", []):
                rel = entry.get("path")
                if not rel:
                    problems.append(f"{where}: manifest entry without a path")
                    continue
                key = (vendor_rel, rel)
                if key in pinned and pinned[key].get("sha256") != entry.get("sha256"):
                    problems.append(f"{where}: {rel}: pinned to two different digests across manifests")
                pinned[key] = entry
            for entry in manifest.get("genesisAuthored", []):
                rel = entry.get("path")
                if not rel:
                    problems.append(f"{where}: genesisAuthored entry without a path")
                    continue
                authored.add((vendor_rel, rel))

        if not pinned:
            problems.append(f"{vendor_rel}: no manifest pins any file")

        declared = set(pinned) | authored | {(vendor_rel, name) for name in manifest_names}
        base = os.path.join(root, vendor_rel)

        for rel in discover(root, vendor_rel):
            where = f"{vendor_rel}/{rel}"
            if rel.endswith(" (symlink)"):
                problems.append(f"{where}: symlinks are not vendored bytes")
                continue
            if is_build_output(rel):
                tree["buildOutput"] += 1
                continue
            if (vendor_rel, rel) not in declared:
                problems.append(f"{where}: present in the vendor tree but declared nowhere in a manifest")

        for (_, rel), entry in sorted(pinned.items()):
            full = os.path.join(base, rel)
            where = f"{vendor_rel}/{rel}"
            if not os.path.isfile(full):
                problems.append(f"{where}: pinned in a manifest but missing from the tree")
                continue
            digest, length = sha256_file(full)
            want_sha = entry.get("sha256")
            want_len = entry.get("bytes")
            if digest != want_sha:
                problems.append(f"{where}: sha256 {digest} != pinned {want_sha}")
            if want_len is not None and length != want_len:
                problems.append(f"{where}: {length} bytes != pinned {want_len}")

        tree["pinned"] = len(pinned)
        tree["authored"] = len(authored)
        for _, rel in sorted(authored):
            if not os.path.isfile(os.path.join(base, rel)):
                problems.append(f"{vendor_rel}/{rel}: declared as genesis-authored but missing from the tree")
        summary["trees"].append(tree)
        summary["pinned"] += tree["pinned"]
        summary["authored"] += tree["authored"]
        summary["buildOutput"] += tree["buildOutput"]

    boundary_problems, summary["boundary"] = check_boundary(root)
    problems.extend(boundary_problems)
    return problems, summary


def report(summary: dict) -> None:
    boundary = summary["boundary"]
    print(f"boundary    : live {boundary.get('liveBytes', '?')} bytes; candidate cap "
          f"{boundary.get('cap', '?')}; archive {boundary.get('archiveBytes', '?')} bytes")
    for tree in summary["trees"]:
        print(f"vendor tree : {tree['vendor']} — {tree['pinned']} file(s) pinned; "
              f"genesis-authored {tree['authored']}; build output excluded "
              f"{tree['buildOutput']} file(s)")
        for m in tree["manifests"]:
            print(f"manifest    : {m['name']} sha256 {m['sha256']} ({m['bytes']} bytes)")
            print(f"              {m['repository']} @ {m['commit']} — {m['files']} file(s) pinned")
    print(f"total       : pinned {summary['pinned']} file(s); genesis-authored "
          f"{summary['authored']}; build output excluded {summary['buildOutput']} file(s) "
          f"across {len(summary['trees'])} vendor tree(s)")


def main(argv: list[str]) -> int:
    mutate = "--mutate" in argv[1:]

    if mutate:
        with tempfile.TemporaryDirectory(prefix="phase0-pins-") as tmp:
            work = os.path.join(tmp, "genesis")
            os.makedirs(work)
            for vendor_rel, _ in VENDOR_TREES:
                shutil.copytree(os.path.join(ROOT, vendor_rel), os.path.join(work, vendor_rel))

            os.makedirs(os.path.join(work, "docs"))
            for rel in (BOUNDARY_LIVE, BOUNDARY_ARCHIVE, BOUNDARY_PIN):
                shutil.copyfile(os.path.join(ROOT, rel), os.path.join(work, rel))
            boundary_problems, boundary = check_boundary(work)
            if boundary_problems:
                print("BOUNDARY FAILED before mutation:")
                for problem in boundary_problems:
                    print(f"  {problem}")
                return 1
            for rel, mutation, expected in (
                (BOUNDARY_ARCHIVE, b"\n", "sha256"),
                (BOUNDARY_LIVE, b"x" * (boundary["cap"] + 1), "not below candidate cap"),
            ):
                target = os.path.join(work, rel)
                with open(target, "rb") as fh:
                    original = fh.read()
                with open(target, "wb") as fh:
                    fh.write(original + mutation if rel == BOUNDARY_ARCHIVE else mutation)
                broken, _ = check_boundary(work)
                matching = [p for p in broken if p.startswith(f"{rel}:") and expected in p]
                if not matching:
                    print(f"MUTATION MISSED: {rel} corruption was accepted: {broken}")
                    return 1
                for problem in broken:
                    print(f"EXPECTED FAILURE: {problem}")
                with open(target, "wb") as fh:
                    fh.write(original)
                restored, _ = check_boundary(work)
                if restored:
                    print(f"RESTORE FAILED: {restored}")
                    return 1
                print(f"RESTORED PASS: {rel}; live below candidate cap and archive pin matches")

            # Mutation 1: a file pinned by the first manifest.
            tree_rel = "vendor/append-only"
            target_rel = "verify.py"
            with open(os.path.join(work, tree_rel, target_rel), "ab") as fh:
                fh.write(b"\n# mutated by scripts/phase0-check-pins.py --mutate\n")
            problems, _ = check(work)
            if not any(p.startswith(f"{tree_rel}/{target_rel}: sha256") for p in problems):
                print("MUTATION MISSED: the checker accepted an altered pinned file.")
                for p in problems:
                    print(f"  also: {p}")
                return 1
            print(f"mutation caught: {tree_rel}/{target_rel} altered in a disposable copy -> refused")

            # Mutation 2: a file pinned by the SECOND manifest. A checker that only ever
            # proves itself against one pin set is half a checker.
            replica_rel = os.path.join("replicas", "rust-verifier", "src", "main.rs")
            replica_path = os.path.join(work, tree_rel, replica_rel)
            if os.path.isfile(replica_path):
                with open(replica_path, "ab") as fh:
                    fh.write(b"\n// mutated\n")
                replica_problems, _ = check(work)
                if not any(p.startswith(f"{tree_rel}/{replica_rel}: sha256") for p in replica_problems):
                    print(f"MUTATION MISSED: an altered {tree_rel}/{replica_rel} was accepted.")
                    return 1
                print(f"mutation caught: {tree_rel}/{replica_rel} altered in a disposable copy -> refused")
            else:
                print(f"note: {tree_rel}/{replica_rel} is not vendored, so only one pin set was mutated")

            # Mutation 3: the other direction — a pinned file DELETED must also fail.
            with open(os.path.join(work, tree_rel, replica_rel), "ab") as fh:
                pass
            if os.path.isfile(replica_path):
                os.remove(replica_path)
                missing_problems, _ = check(work)
                if not any(p.startswith(f"{tree_rel}/{replica_rel}: pinned in a manifest but missing")
                           for p in missing_problems):
                    print(f"MUTATION MISSED: deleting {tree_rel}/{replica_rel} was not reported.")
                    return 1
                print(f"mutation caught: {tree_rel}/{replica_rel} deleted in a disposable copy -> refused")

            # Mutation 4: a SECOND vendor tree's own pin set. Without this arm, a checker
            # that walked only the first tree would still pass every mutation above while
            # the receipt-v3 bytes went unpinned.
            receipt_rel = "vendor/receipt"
            receipt_target = os.path.join("toy", "receipt.py")
            receipt_path = os.path.join(work, receipt_rel, receipt_target)
            if os.path.isfile(receipt_path):
                with open(receipt_path, "ab") as fh:
                    fh.write(b"\n# mutated by scripts/phase0-check-pins.py --mutate\n")
                receipt_problems, _ = check(work)
                if not any(p.startswith(f"{receipt_rel}/{receipt_target}: sha256")
                           for p in receipt_problems):
                    print(f"MUTATION MISSED: an altered {receipt_rel}/{receipt_target} was accepted.")
                    for p in receipt_problems:
                        print(f"  also: {p}")
                    return 1
                print(f"mutation caught: {receipt_rel}/{receipt_target} altered in a disposable copy -> refused")
            else:
                print(f"note: {receipt_rel}/{receipt_target} is not vendored, so its pin set was not mutated")

            # Mutation 5: the THIRD vendor tree. Each new tree gets its own arm for the same
            # reason mutation 4 exists: a checker that walked only the first two trees would
            # pass every mutation above while Diamond's bytes went unpinned.
            diamond_rel = "vendor/kira-export"
            diamond_target = os.path.join("diamond", "kira_evidence.py")
            diamond_path = os.path.join(work, diamond_rel, diamond_target)
            if os.path.isfile(diamond_path):
                with open(diamond_path, "ab") as fh:
                    fh.write(b"\n# mutated by scripts/phase0-check-pins.py --mutate\n")
                diamond_problems, _ = check(work)
                if not any(p.startswith(f"{diamond_rel}/{diamond_target}: sha256")
                           for p in diamond_problems):
                    print(f"MUTATION MISSED: an altered {diamond_rel}/{diamond_target} was accepted.")
                    for p in diamond_problems:
                        print(f"  also: {p}")
                    return 1
                print(f"mutation caught: {diamond_rel}/{diamond_target} altered in a disposable copy -> refused")
            else:
                print(f"note: {diamond_rel}/{diamond_target} is not vendored, so its pin set was not mutated")

            # Mutation 6: THE PIN ITSELF, not the bytes under it. Editing a manifest digest is
            # the one alteration that a byte-only check cannot see, because the file it would
            # complain about is the file that was edited. This is the "its manifest pin"
            # control: a manifest that agrees with a tampered tree must still fail, because
            # the manifest is checked against the UPSTREAM commit, not against itself.
            if os.path.isfile(diamond_path):
                manifest_path = os.path.join(work, diamond_rel, "upstream-diamond.json")
                with open(manifest_path, "r", encoding="utf-8") as fh:
                    manifest_doc = json.load(fh)
                entries = manifest_doc.get("files", [])
                if entries:
                    good = entries[0].get("sha256")
                    entries[0]["sha256"] = ("0" * 64) if good != "0" * 64 else ("1" * 64)
                    with open(manifest_path, "w", encoding="utf-8") as fh:
                        json.dump(manifest_doc, fh)
                    pin_problems, _ = check(work)
                    mutated_rel = entries[0].get("path")
                    if not any(p.startswith(f"{diamond_rel}/{mutated_rel}: sha256") for p in pin_problems):
                        print("MUTATION MISSED: a manifest pin rewritten to a wrong digest was accepted.")
                        for p in pin_problems:
                            print(f"  also: {p}")
                        return 1
                    print(f"mutation caught: {diamond_rel}/upstream-diamond.json pin for {mutated_rel} "
                          "rewritten in a disposable copy -> refused")

        # The real trees must still be clean after the mutation run.
        clean, _ = check(ROOT)
        if clean:
            print("the real vendor tree is not clean:")
            for p in clean:
                print(f"  {p}")
            return 1
        print("real trees still pinned after the mutation run")
        return 0

    problems, summary = check(ROOT)
    report(summary)
    if problems:
        print(f"PINS FAILED ({len(problems)} problem(s)):")
        for p in problems:
            print(f"  {p}")
        return 1
    print("PINS OK: vendored bytes and archive match their manifests; live paper below candidate cap")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
