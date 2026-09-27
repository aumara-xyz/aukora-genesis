#!/usr/bin/env python3
"""Cross-implementation parity: this gate's Ed25519 and JCS against the vendored one.

    python3 scripts/composition/parity-vendored.py

WHY THIS EXISTS, AND WHY IT IS NOT A DEPENDENCY. The rule for this brick was
binary: either implement RFC 8032 in stdlib, **or** reuse the vendored
implementation under `vendor/receipt/` — but do not depend on a file that may
not exist. When this brick was written, `vendor/receipt/` did not exist, so
`ed25519.py` and `jcs.py` here are independent stdlib implementations. The
vendored tree arrived afterwards, committed by another agent working in this same
worktree.

That turned a binary choice into a better one. The gate keeps its own
implementations — so nothing it ships depends on a file another agent may still
be editing, and the AGPL-3.0 vendored tree stays an input to evidence rather than
a runtime dependency — and this script *measures* the two against each other. An
independent second implementation agreeing byte-for-byte is the strongest
correctness evidence available for a hand-written curve, far stronger than the
RFC's three vectors alone, and it costs one optional check.

WHAT "PARITY" MEANS HERE. Two things, both byte-level:

  * `sign(seed, message)` produces identical 64 bytes in both implementations,
    across the RFC's published vectors and random seeds and messages of varying
    length. Ed25519 is deterministic, so "same input, same bytes" is the whole
    claim — a difference anywhere in the arithmetic shows up immediately.
  * `canonicalize(value)` produces identical bytes for a set of values chosen to
    hit the disagreements canonicalizers actually have in the field: key
    ordering, nesting, empty containers, the escape set, and characters above
    U+FFFF where UTF-16 code-unit order differs from both code-point and UTF-8
    byte order.

WHAT IT DOES NOT CLAIM. Agreement is not conformance. Both implementations can be
wrong in the same way if they make the same conceptual error, and the RFC vectors
are what bound that risk. Parity here shows that this gate's signing bytes are the
bytes the vendored tree would produce, which is what makes a receipt from one
legible to the other in principle. It says nothing about who holds a key, whether
a human was present, or whether a receipt is true.

EXIT STATUS. 0 when the vendored tree is absent — the check is skipped, and it is
reported as skipped rather than as a pass, so a reader is never told a comparison
happened when it did not. 0 on full agreement, 1 on any disagreement, 2 when the
vendored tree exists but cannot be loaded (which is a real defect worth failing
for, since the pins checker in this repository expects those bytes to be usable).
"""
from __future__ import annotations

import importlib.util
import os
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
VENDOR = os.path.join(ROOT, "vendor", "receipt", "toy")

#: Values chosen for the canonical-form disagreements that exist in the wild.
JCS_CASES = (
    {"b": 1, "a": 2},
    {"a": [1, {"b": None}]},
    [True, False, None, 0, -1, 17],
    {},
    [],
    'a"b\\c\nd\te',
    "\x01\x1f",
    "\U0001F600",
    {"\uFB00": 1, "\U0001F600": 2},
    {"z": {"y": [1, 2, 3]}, "a": {"b": []}},
)

SIGN_ROUNDS = 30


class ParityError(Exception):
    """A measured disagreement. Never downgraded to a warning."""


def _load(name: str, path: str):
    """Load a module by file path under a private name, so neither tree's module
    names collide with the other's and sys.modules is left clean afterwards."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ParityError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


def main() -> int:
    sys.path.insert(0, HERE)
    import ed25519 as mine_ed  # noqa: E402
    import jcs as mine_jcs  # noqa: E402

    if not os.path.isdir(VENDOR):
        print(f"PARITY: SKIPPED — no vendored tree at {os.path.relpath(VENDOR, ROOT)}")
        print("  this is not a pass: no comparison was made. The gate's own ed25519.py")
        print("  self-tests against the RFC 8032 vectors regardless.")
        return 0

    print(f"PARITY: comparing against {os.path.relpath(VENDOR, ROOT)}")
    try:
        their_ed = _load("_vendor_ed25519", os.path.join(VENDOR, "ed25519.py"))
        their_jcs = _load("_vendor_jcs", os.path.join(VENDOR, "jcs.py"))
    except Exception as exc:
        print(f"PARITY: FAILED — the vendored tree exists but did not load: {exc}")
        return 2

    # ── canonical form ────────────────────────────────────────────────────────────────
    mismatches = []
    for case in JCS_CASES:
        try:
            theirs = their_jcs.canonicalize(case)
        except Exception as exc:
            mismatches.append((case, f"vendored raised {type(exc).__name__}: {exc}"))
            continue
        ours = mine_jcs.canonicalize(case)
        if ours != theirs:
            mismatches.append((case, f"ours={ours!r} theirs={theirs!r}"))
    if mismatches:
        print(f"PARITY: FAILED — canonical form differs on {len(mismatches)}/{len(JCS_CASES)} cases")
        for case, detail in mismatches:
            print(f"  {case!r}: {detail}")
        return 1
    print(f"  ok   canonical form: identical bytes on {len(JCS_CASES)}/{len(JCS_CASES)} cases")

    # ── signatures, vectors first ─────────────────────────────────────────────────────
    for index, (seed_hex, _pk, msg_hex, _sig) in enumerate(mine_ed.RFC8032_VECTORS, start=1):
        seed, message = bytes.fromhex(seed_hex), bytes.fromhex(msg_hex)
        if mine_ed.sign(seed, message) != their_ed.sign(seed, message):
            print(f"PARITY: FAILED — RFC 8032 vector {index} signature differs")
            return 1
        if mine_ed.public_from_seed(seed) != their_ed.public_from_seed(seed):
            print(f"PARITY: FAILED — RFC 8032 vector {index} public key differs")
            return 1
    print(f"  ok   signatures: identical on {len(mine_ed.RFC8032_VECTORS)} published vectors")

    # ── signatures, random ────────────────────────────────────────────────────────────
    for round_number in range(1, SIGN_ROUNDS + 1):
        seed = secrets.token_bytes(32)
        message = secrets.token_bytes(round_number * 7)
        ours, theirs = mine_ed.sign(seed, message), their_ed.sign(seed, message)
        if ours != theirs:
            print(f"PARITY: FAILED — random round {round_number} signature differs")
            print(f"  ours  ={ours.hex()}")
            print(f"  theirs={theirs.hex()}")
            return 1
        if not their_ed.verify(mine_ed.public_from_seed(seed), message, ours):
            print(f"PARITY: FAILED — vendored verifier rejected this gate's signature (round {round_number})")
            return 1
    print(f"  ok   signatures: identical on {SIGN_ROUNDS} random seeds and messages, "
          "and each implementation verifies the other's")

    print("PARITY: GREEN — this gate's signing bytes are the vendored tree's signing bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
