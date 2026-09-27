#!/usr/bin/env python3
"""serialize-admissions — turn accepted admissions into receipts, through the one issuer.

    python3 scripts/composition/serialize-admissions.py --state <dir> [--json]

WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE GATE.

The host gate's admission decision is made inside a SYNCHRONOUS module load hook: node's
`load` hook cannot await, so the gate cannot spawn the receipt issuer while it is deciding.
Two ways out were available and this is the honest one:

  * issue receipts from the gate itself, in JavaScript — which would mean a SECOND issuer and
    a second signing path for the same wire format. Two implementations of one receipt is
    exactly the divergence the rest of this work has been removing.
  * record the accepted transition, and have the ONE accepted issuer turn it into a receipt
    afterwards. That is this script.

So the gate's log is an ADMISSION LEDGER, not a receipt. A transition in that ledger is an
admission that has NOT yet been recorded as a receipt, and the two are deliberately distinct:
`receipt: PENDING_SERIALIZATION` in the ledger means exactly that, and nothing in this system
reports it as a receipt until this script has run and the issuer has signed.

SERIALIZATION AND RECOVERY. Entries are appended one per line. This script takes a lock so two
drains cannot interleave, processes entries in order, and rewrites the ledger to contain only
what it could NOT settle, each with a reason. A crash mid-drain therefore leaves the unsettled
entries in place and they are retried on the next run — the failure direction is "recorded but
not yet receipted", never "receipted twice" and never "silently dropped".

WHAT IS NOT CLAIMED. This does not establish that the plugin was safe, that a human attended,
or that the transition had any effect beyond the admission. It records that an admission
happened and binds it to the entry log's own seq and head.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile

# A RELEASE MUST SURVIVE BEING USED. Running this file imports its neighbours, and an interpreter
# allowed to write bytecode drops `__pycache__` directories beside them — INSIDE the release. The
# release's own artifact checker re-measures the tree's file and byte totals against
# `strip-manifest.json`, which counts that debris, so a release that has been used once fails its
# own `strip-totals-mismatch` check and a correct settlement reads as a broken release. Measured
# before this line existed: settling through a release's own copy of this file left 9 `.pyc` files
# in three `__pycache__` directories, and the release then failed `genesis-check`.
#
# This is the switch `PYTHONDONTWRITEBYTECODE=1` / `python3 -B` sets, set from inside rather than
# required of the caller, so it holds for a hand-typed command and for the attended run that no
# test harness wraps. It is repeated in each entry point on purpose: a shared helper would itself
# have to be imported — and byte-cached — before it could run, which is the thing being prevented.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aura as aura_mod  # noqa: E402
import loader as loader_mod  # noqa: E402
from refusals import CompositionRefusal  # noqa: E402

LEDGER = "admissions.jsonl"
LOCK = "admissions.lock"
RECEIPT_ROOT = "receipts"
#: The producer path retains its own head: settling IS the moment a head becomes history, and a
#: retained head only says something if it was kept before the next append could change it. The
#: hook is this lane's `retain --publish` code by path, not a second implementation of it.
RETAIN_ON_SETTLE = os.path.join(os.path.dirname(HERE), "aura", "retain_on_settle.py")


def retain_on_settle(state: str, receipt_path: str, seq: int) -> dict:
    """Retain through the hook, and never let a retainer failure touch the settlement.

    The hook returns statuses instead of raising. This wrapper is a second belt on purpose: if a
    retainer bug surfaced here as an exception, the loop below would mark an admission that the
    issuer already receipted as UNSETTLED, and a retainer outage would have reached back and
    undone an effect that had already happened. Nothing about the retainer may do that.
    """
    try:
        if not os.path.exists(RETAIN_ON_SETTLE):
            return {"status": "RETAINER_HOOK_ABSENT", "reason": f"no hook at {RETAIN_ON_SETTLE}"}
        import importlib.util
        spec = importlib.util.spec_from_file_location("aura_retain_on_settle", RETAIN_ON_SETTLE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.retain_head_on_settle(state, receipt_path=receipt_path, seq=seq, source="serialize-admissions")
    except Exception as exc:  # noqa: BLE001 - see above: the settle does not fail because of a retainer
        return {"status": "RETAINER_UNREACHED", "reason": f"{type(exc).__name__}: {exc}", "target": None}


def read_ledger(path: str) -> list[dict]:
    entries: list[dict] = []
    if not os.path.exists(path):
        return entries
    with open(path, "r", encoding="utf-8") as fh:
        for number, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except ValueError as exc:
                # A malformed line is not skipped: skipping it would drop an admission
                # silently, and the whole point of the ledger is that admissions are not lost.
                entries.append({"unreadable": True, "line": number, "why": str(exc)})
    return entries


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="serialize accepted admissions into receipts")
    parser.add_argument("--state", required=True, help="the gate's state directory")
    parser.add_argument("--json", action="store_true", help="emit one JSON object per settled entry")
    args = parser.parse_args(argv[1:])

    state = os.path.abspath(args.state)
    ledger_path = os.path.join(state, LEDGER)
    lock_path = os.path.join(state, LOCK)
    receipt_dir = os.path.join(state, RECEIPT_ROOT)
    os.makedirs(receipt_dir, exist_ok=True)

    entries = read_ledger(ledger_path)
    if not entries:
        print("no admissions to serialize")
        return 0

    # An exclusive lock, held for the drain. O_EXCL rather than flock: the lock is a file whose
    # existence IS the claim, so a crash leaves it behind and the next run reports it instead
    # of silently proceeding on a ledger another process may be mid-way through.
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        print(f"SERIALIZATION REFUSED: {lock_path} exists, so a drain is in progress or was "
              "interrupted. Inspect it, then remove it deliberately — this script will not "
              "guess whether the other run finished.", file=sys.stderr)
        return 1

    settled: list[dict] = []
    unsettled: list[dict] = []
    try:
        os.write(lock_fd, str(os.getpid()).encode("ascii"))
        os.close(lock_fd)

        for entry in entries:
            if entry.get("unreadable"):
                unsettled.append(entry)
                continue
            plugin_id = entry.get("id")
            digest = entry.get("digest")
            nonce = entry.get("nonce")
            try:
                if not all((plugin_id, digest, nonce)):
                    raise CompositionRefusal(
                        "ADMISSION_INCOMPLETE",
                        f"ledger entry names id={plugin_id!r} digest={digest!r} nonce={nonce!r}",
                    )
                grant_path = os.path.join(state, "grants", f"{plugin_id}.json")
                if not os.path.exists(grant_path):
                    raise CompositionRefusal(
                        "ADMISSION_GRANT_ABSENT",
                        f"the grant the admission used is no longer at {grant_path}, so the "
                        "receipt cannot be bound to the exact bytes it authorized",
                    )
                gate = loader_mod.Loader(state)
                grant_doc = json.load(open(grant_path, encoding="utf-8"))

                # IDEMPOTENT FOR EXACTLY THIS ADMISSION, AND NOTHING ELSE.
                #
                # The host gate reserved the nonce when it admitted the transition, because that
                # is when the one-use property is used. Settling that reservation must not read
                # as a replay of it. It is the same admission only if the ledger entry names the
                # SAME nonce and the SAME plugin digest as the grant being settled; anything else
                # goes through the ordinary path and is refused as GRANT_SPENT.
                settle_idempotent = (
                    grant_doc.get("nonce") == nonce
                    and grant_doc.get("pluginDigest") == digest
                    and grant_doc.get("operation") == entry.get("operation", "load")
                )
                if not settle_idempotent:
                    # Loud rather than silent: a ledger entry whose grant no longer matches is a
                    # changed admission, and it must not be settled under cover of idempotency.
                    print(f"NOTE {plugin_id}: the ledger entry and the grant differ "
                          f"(nonce/digest/operation); settling it as an ordinary transition, "
                          f"which will refuse a spent nonce.", file=sys.stderr)

                # WHICH BYTES ARE CONSUMED, AND WHY BOTH LOCATIONS ARE CHECKED.
                #
                # The ledger records the path and the digest the gate admitted. An earlier version
                # preferred `entry.file` and fell back to the staged copy without ever checking
                # the consumed bytes against that recorded digest — so tampering with the path it
                # happened to read past was not detected at all. That silently weakened the
                # property this settlement exists to preserve: a receipt must be bound to the
                # bytes that were admitted, not to whatever is on disk when the drain runs.
                #
                # Whatever is read, it must hash to the digest the ledger recorded, or the
                # admission is left unsettled with a reason. The grant's own binding is a second,
                # independent check on the same bytes; neither replaces the other.
                recorded = entry.get("file") or os.path.join(state, f"governed-{plugin_id}.bin")
                staged = os.path.join(state, f"governed-{plugin_id}.bin")
                plugin_path = recorded if os.path.exists(recorded) else staged
                plugin_bytes = open(plugin_path, "rb").read()
                consumed = hashlib.sha256(plugin_bytes).hexdigest()
                if consumed != digest:
                    raise CompositionRefusal(
                        "ADMISSION_BYTES_CHANGED",
                        f"the bytes at {plugin_path} hash to {consumed[:16]}… and the admission "
                        f"recorded {str(digest)[:16]}… for {plugin_id}. Settling would issue a "
                        "receipt bound to bytes that were never admitted, so this admission is "
                        "left unsettled rather than receipted.",
                    )
                result = gate.load(plugin_bytes, grant_doc, idempotent_nonce=settle_idempotent)
                receipt = result["receipt"]
                receipt_path = os.path.join(receipt_dir, f"{plugin_id}-{receipt['aura']['seq']:03d}.json")
                with open(receipt_path, "w", encoding="utf-8") as fh:
                    json.dump(receipt, fh, indent=2, sort_keys=True)
                settled.append({
                    "id": plugin_id, "seq": receipt["aura"]["seq"], "receipt": receipt_path,
                    "entryHash": receipt["aura"]["entryHash"], "root": receipt["aura"]["root"],
                })
                # RETAIN ON SETTLE, AFTER THE RECEIPT EXISTS.
                #
                # The effect has already happened at this point: the record is in the log and
                # the issuer has signed. Retention is attempted now and reported, never as a
                # condition of the effect. `RETAINER_UNREACHED` says the head was not kept
                # anywhere else this time; the size is queued and the next settle that reaches
                # the retainer publishes it before its own head. The receipt document itself is
                # NOT touched: the accepted contract is a closed set, so a flag written into it
                # would make the receipt RECEIPT_TAMPERED while its signature still verified.
                retained = retain_on_settle(state, receipt_path, receipt["aura"]["seq"])
                status = retained.get("status")
                settled[-1]["retainer"] = status
                if status != "RETAINER_NOT_CONFIGURED":
                    settled[-1]["retainerDetail"] = {
                        "target": retained.get("target"), "size": retained.get("size"),
                        "reason": retained.get("reason"), "pending": len(retained.get("pending") or []),
                    }
                if args.json:
                    print(json.dumps(settled[-1]))
                else:
                    print(f"SETTLED  {plugin_id}: receipt seq {receipt['aura']['seq']} "
                          f"entry {receipt['aura']['entryHash'][:16]}… -> {receipt_path}")
                    if status == "RETAINER_UNREACHED":
                        print(f"  RETAINER_UNREACHED size {retained.get('size')}: {retained.get('reason')} "
                              f"(the effect settled; {len(retained.get('pending') or [])} size(s) waiting)")
                    elif status == "RETAINER_PUBLISHED":
                        print(f"  RETAINER_PUBLISHED size {retained.get('size')} -> {retained.get('target')}")
                    elif status == "RETAINER_HOOK_ABSENT":
                        print(f"  RETAINER_HOOK_ABSENT: {retained.get('reason')}")
                    elif status == "RETAINER_TARGET_NOT_A_DESTINATION":
                        # Not folded into the RETAINER_UNREACHED arm on purpose. An outage clears and
                        # a misnamed destination does not, and printing them the same way is what let
                        # every governed settle read as a retainer that was merely unlucky.
                        print(f"  RETAINER_TARGET_NOT_A_DESTINATION ({retained.get('refusal')}) target "
                              f"{retained.get('target')}: {retained.get('reason')} "
                              f"({len(retained.get('pending') or [])} size(s) waiting)")
                    elif status == "RETAINER_CONFIG_UNUSABLE":
                        # Same reason as the arm above, one level earlier: a configuration FILE that
                        # exists and cannot be read is a declaration that retention was intended, so
                        # it must not print as RETAINER_NOT_CONFIGURED, which reads as a deliberate
                        # no-op and exits 0.
                        print(f"  RETAINER_CONFIG_UNUSABLE ({retained.get('refusal')}): "
                              f"{retained.get('reason')} "
                              f"({len(retained.get('pending') or [])} size(s) waiting)")
            except (CompositionRefusal, OSError, ValueError, KeyError) as exc:
                # The entry stays in the ledger with its reason. An admission that could not be
                # receipted is reported as unsettled, never as a success and never dropped.
                unsettled.append({**entry, "settleError": f"{type(exc).__name__}: {exc}"})
                print(f"UNSETTLED {entry.get('id')}: {type(exc).__name__}: {exc}", file=sys.stderr)

        # Rewrite the ledger with exactly what remains, atomically.
        handle, temp = tempfile.mkstemp(dir=state, prefix=".admissions-", suffix=".tmp")
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            for entry in unsettled:
                fh.write(json.dumps(entry, sort_keys=True) + "\n")
        os.replace(temp, ledger_path)
    finally:
        if os.path.exists(lock_path):
            os.unlink(lock_path)

    print(f"\n{len(settled)} settled, {len(unsettled)} unsettled (kept in {ledger_path})")
    return 0 if not unsettled else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
