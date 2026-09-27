#!/usr/bin/env python3
"""Command line for the composition gate.

    python3 scripts/composition/__main__.py load   --state DIR --plugin FILE [--grant FILE] [--now T]
    python3 scripts/composition/__main__.py unload --state DIR --plugin FILE --grant FILE
    python3 scripts/composition/__main__.py grant  --state DIR --operation load|unload \
                                                   --plugin FILE --out FILE [--expiry T] [--root DIR]
    python3 scripts/composition/__main__.py checkpoint --state DIR --out FILE
    python3 scripts/composition/__main__.py verify --state DIR --receipt FILE \
                                                   [--retained FILE] [--presented FILE]

Exit codes are part of the contract:

    0   the transition was accepted, or the verification succeeded
    2   refused, with a named code printed as `REFUSE: <CODE>: <reason>` on stderr
    1   a failure that is not a governed refusal (unreadable file, bad usage)

A refusal is not an error. It is the gate working, and it exits 2 so that a
caller can tell "the gate said no" apart from "the gate could not run".

Every path prints the ceilings and the mediator's state before deciding anything.
That is deliberate: a limit that is printed only on success teaches a reader that
the limit applies only to successes.

WHY THIS FILE INSERTS ITS OWN DIRECTORY INTO sys.path. The modules beside it
import each other by bare name (`import grant`, not `from . import grant`), so
that the directory is usable as a flat set of scripts exactly like
`scripts/phase0/`. Running `python3 scripts/composition/__main__.py` puts this
directory on the path automatically; running `python3 -m` or importing the module
from elsewhere does not, so the insert below makes both work the same way.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

# A RELEASE MUST SURVIVE BEING USED. This file imports the composition modules by bare name; an
# interpreter allowed to write bytecode caches them INSIDE the release. The release's own artifact
# checker re-measures the tree's file and byte totals against `strip-manifest.json`, which counts
# that debris, so a release that has been used once fails its own `strip-totals-mismatch` check.
# This is the switch `PYTHONDONTWRITEBYTECODE=1` / `python3 -B` sets, set from inside so it holds
# for a hand-typed command and for the subprocess a test spawns.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import ceilings as ceilings_mod  # noqa: E402
import grant as grant_mod  # noqa: E402
import loader as loader_mod  # noqa: E402
import receipt as receipt_mod  # noqa: E402
from hexutil import HexError, read_bytes, read_json  # noqa: E402
from refusals import CompositionRefusal  # noqa: E402

EXIT_ACCEPTED = 0
EXIT_REFUSED = 2
EXIT_UNRUNNABLE = 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="composition",
        description="Governed plugin composition: one-use grants, named refusals, receipts.",
    )
    parser.add_argument("--verbose-ceilings", action="store_true",
                        help="print each ceiling with its explanatory text")
    sub = parser.add_subparsers(dest="command", required=True)

    for verb in ("load", "unload"):
        act = sub.add_parser(verb, help=f"{verb} a plugin under a one-use grant")
        act.add_argument("--state", required=True, help="disposable state directory")
        act.add_argument("--plugin", required=True, help="file holding the exact plugin bytes")
        act.add_argument("--grant", help="grant JSON file (omit to see the refusal)")
        act.add_argument("--now", type=int, help="override the clock, for reproducible arms")

    gnt = sub.add_parser("grant", help="mint a one-use grant")
    gnt.add_argument("--state", required=True)
    gnt.add_argument("--operation", required=True, choices=grant_mod.OPERATIONS)
    gnt.add_argument("--plugin", required=True, help="the bytes this grant will authorize")
    gnt.add_argument("--out", required=True)
    gnt.add_argument("--expiry", type=int, help="unix seconds; defaults to now + 3600")
    gnt.add_argument("--now", type=int, help="override the clock")
    gnt.add_argument("--root", help="the release root the grant's pluginPath is relative to "
                                    "(default: AUKORA_GATE_ROOT, else the current directory)")

    chk = sub.add_parser("checkpoint", help="write this log's current observation")
    chk.add_argument("--state", required=True)
    chk.add_argument("--out", required=True)

    vfy = sub.add_parser("verify", help="verify a receipt against this log and an optional pair")
    vfy.add_argument("--state", required=True)
    vfy.add_argument("--receipt", required=True)
    vfy.add_argument("--retained", help="retained observation JSON")
    vfy.add_argument("--presented", help="presented observation JSON")

    return parser


def _verbose_ceilings(args) -> bool:
    """`--verbose-ceilings` is declared on the top-level parser, so it is only
    accepted before the subcommand. A caller who puts it after would otherwise have
    it silently ignored, so the environment is consulted as well; either way the
    choice is explicit, and neither way can turn the ceilings off."""
    if getattr(args, "verbose_ceilings", False):
        return True
    return os.environ.get("AUKORA_COMPOSITION_VERBOSE_CEILINGS", "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _load_loader(args) -> loader_mod.Loader:
    return loader_mod.Loader(args.state, verbose_ceilings=_verbose_ceilings(args))


def _cmd_transition(args, operation: str) -> int:
    gate = _load_loader(args)
    plugin_bytes = read_bytes(args.plugin)
    presented = None
    if args.grant:
        presented = read_json(args.grant)
    result = (
        gate.load(plugin_bytes, presented, now=args.now)
        if operation == "load"
        else gate.unload(plugin_bytes, presented, now=args.now)
    )
    print(f"ACCEPTED: {operation}")
    # **aura-75: THE WEAKER TIER PRINTS BESIDE THE VERDICT IT QUALIFIES.** *A grant minted before
    # `pluginPath` and `pluginClosure` existed still verifies -- deliberately, because refusing it would
    # be a flag day -- but it binds the entry file bytes ONLY*, so it admits a byte-identical module at a
    # different path and cannot see a changed import at all (GUARDIAN D3). **Without this print a
    # reviewer reads `ACCEPTED` and cannot tell which tier they got**, which is the silent pass aura-75
    # names. *The tier is decided by what the GRANT carries, not by when it was made.*
    _unbound = ceilings_mod.legacy_unbound_line(presented)
    if _unbound is not None:
        print(_unbound)
        _migration = ceilings_mod.migration_step(presented)
        if _migration is not None:
            print(f"  {_migration}")
    print(f"  pluginId        {result['receipt']['composition']['pluginId']}")
    print(f"  pluginDigest    {result['receipt']['composition']['pluginDigest']}")
    print(f"  priorHead       {result['priorHead']}")
    print(f"  head            {result['receipt']['aura']['head']}")
    print(f"  seq             {result['receipt']['aura']['seq']}")
    print(f"  issuedAt        {result['receipt']['issuedAt']}")
    print(f"  receiptNonce    {result['receipt']['nonce']}")
    print(f"  issuerPk        {result['receipt']['issuerPk']}")
    print(f"  receipt         {result['receiptPath']}")
    for line in ceilings_mod.notice_lines(result["class"], result["conformance"]):
        print(line)
    print(f"CONSISTENCY: {result['consistency']}")
    print(f"  {result['consistency']} is printed because no retained/presented pair was supplied "
          "here; run `verify --retained R --presented P` for the measured verdict")
    return EXIT_ACCEPTED


def _grant_binding(root: str, plugin: str) -> dict:
    """The pluginPath and pluginClosure the load hook will compute for this file (GUARDIAN D3).

    **EVERY GRANT THIS COMMAND MINTS IS BOUND TO A PLACE AND AN IMPORT CLOSURE.** A grant that bound the
    entry bytes alone admitted a byte-identical copy at another path (measured: declared-id arm 6,
    ADMITTED), and the runtime hook now refuses a grant that lacks either field. The two values come
    from `grant-binding.mjs`, which calls the hook's own `resolveModuleIdentity` and `artifactClosure`,
    so the mint and the hook cannot disagree about which file or which imports a grant names. No node,
    no grant: a mint that cannot compute the binding refuses rather than minting the unbound tier.
    """
    helper = os.path.join(HERE, "grant-binding.mjs")
    node = os.environ.get("AUKORA_NODE", "node")
    try:
        run = subprocess.run([node, helper, "--root", root, "--plugin", plugin],
                             capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CompositionRefusal(
            "GRANT_MALFORMED",
            f"cannot compute the grant's path and closure ({exc}); a grant without them is refused at load",
        ) from exc
    if run.returncode != 0:
        raise CompositionRefusal(
            "GRANT_MALFORMED",
            f"cannot bind {plugin} under root {root}: {(run.stderr or run.stdout).strip()}",
        )
    return json.loads(run.stdout)


def _cmd_grant(args) -> int:
    gate = _load_loader(args)
    plugin_bytes = read_bytes(args.plugin)
    now = args.now if args.now is not None else receipt_mod.now()
    expiry = args.expiry if args.expiry is not None else now + 3600
    root = args.root or os.environ.get("AUKORA_GATE_ROOT") or os.getcwd()
    binding = _grant_binding(root, args.plugin)
    minted = grant_mod.issue(
        seed=gate.governor_seed,
        governor_pk=gate.governor_pk,
        operation=args.operation,
        plugin_digest=loader_mod.plugin_digest(plugin_bytes),
        coeffect_digest=grant_mod.coeffect_digest(os.getuid()),
        nonce=receipt_mod.fresh_nonce(),
        expiry=expiry,
        issued_at=now,
        plugin_path=binding["pluginPath"],
        plugin_closure=binding["pluginClosure"],
    )
    receipt_mod.write(args.out, minted)
    print(f"GRANT: {args.operation} -> {args.out}")
    print(f"  pluginId        {loader_mod.plugin_id(plugin_bytes)}")
    print(f"  pluginDigest    {minted['pluginDigest']}")
    print(f"  pluginPath      {minted['pluginPath']}  (relative to {root})")
    print(f"  pluginClosure   {minted['pluginClosure']}")
    print(f"  nonce           {minted['nonce']}")
    print(f"  expiry          {minted['expiry']}")
    print(f"  governorPk      {minted['governorPk']}")
    print(f"  closed fields   {list(grant_mod.FIELDS)}")
    return EXIT_ACCEPTED


def _cmd_checkpoint(args) -> int:
    gate = _load_loader(args)
    document = gate.checkpoint(args.out)
    print(f"CHECKPOINT: {args.out}")
    print(f"  size            {document['size']}")
    print(f"  root            {document['root']}")
    print(f"  head            {document['head']}")
    return EXIT_ACCEPTED


def _cmd_verify(args) -> int:
    gate = _load_loader(args)
    # The ceilings are printed on this path too, and the omission was a real defect
    # caught by the self-check's arm 12: `verify_receipt_against_pair` is a court,
    # but a court is still a human-facing path, and a reader who is told a receipt
    # verifies must also be told what verifying it does not mean. Printing them here
    # rather than inside the court keeps the court free of presentation.
    gate.announce()
    document = receipt_mod.read(args.receipt)
    retained = read_json(args.retained) if args.retained else None
    presented = read_json(args.presented) if args.presented else None
    outcome = gate.verify_receipt_against_pair(document, retained, presented)
    print(f"RECEIPT: {args.receipt}")
    print(f"SIGNATURE: {outcome['signature']}")
    print(f"POSITION: {outcome['position']}")
    print(f"CLASS: {outcome['class']}")
    print(f"CONFORMANCE: {outcome['conformance']}")
    print(f"CONSISTENCY: {outcome['consistency']}")
    print(f"ATTENDANCE: {outcome['attendance']}")
    for note in outcome["notes"]:
        print(f"NOTE: {note}")
    if outcome["consistency"] == "CONSISTENCY_UNCHECKED":
        print("HINT: pass --retained and --presented for the measured verdict; a single log "
              "always agrees with itself, so checking it alone proves nothing")
    # *** A VERDICT MUST DECIDE THE EXIT CODE (Fable's item (d)). *** This returned EXIT_ACCEPTED for EVERY verdict,
    # so a caller could not tell an observation conflict from a clean verification — and the self-check's arm had to
    # require exit 0 to observe the conflict at all ("the court exited N instead of reporting"), which is the caller
    # that relied on the zero. The vocabulary is the court's own (aura.py: OBSERVATION_CONFLICT when the presented
    # tree is not an extension of the retained one; UNDETERMINED when a document is malformed or carries a convention
    # the court does not know). MEASURED: my first attempt at this mapping silently did nothing, because its anchor
    # assumed `return EXIT_ACCEPTED` sat directly under the CONSISTENCY print — six lines of HINT sit between them.
    if outcome["consistency"] == "OBSERVATION_CONFLICT":
        return EXIT_REFUSED
    if outcome["consistency"] == "UNDETERMINED":
        return EXIT_UNRUNNABLE
    return EXIT_ACCEPTED


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command in ("load", "unload"):
            return _cmd_transition(args, args.command)
        if args.command == "grant":
            return _cmd_grant(args)
        if args.command == "checkpoint":
            return _cmd_checkpoint(args)
        if args.command == "verify":
            return _cmd_verify(args)
    except CompositionRefusal as refusal:
        print(refusal.line(), file=sys.stderr)
        return EXIT_REFUSED
    except HexError as exc:
        print(f"UNRUNNABLE: {exc}", file=sys.stderr)
        return EXIT_UNRUNNABLE
    raise SystemExit(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    sys.exit(main())
