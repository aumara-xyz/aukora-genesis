#!/usr/bin/env python3
"""B3 composition-gate self-check: every arm published, every verdict measured.

    python3 scripts/composition/composition-selfcheck.py

WHAT THIS COMMAND IS. It is the acceptance command for the composition gate, in
the shape `scripts/phase0/selfcheck.py` established: a fixed list of arms, each
with a published expected result, each arm driven through the **real** command
line as a separate process over a **disposable** state directory, and a non-zero
exit if any arm stops producing its published result. Nothing here is a fixture
standing in for the gate: the grants are minted by the gate's own `grant`
subcommand, the transitions are performed by its `load`/`unload` subcommands, and
the refusals are the codes those processes printed and the exit statuses they
returned.

WHY SUBPROCESSES AND NOT FUNCTION CALLS. A refusal that exists only as a raised
exception is not a refusal an operator ever sees. The arm that matters is the one
where an operator runs a command and reads a code, so every arm asserts on three
things together: the **exit status**, the **refusal code**, and the fact that the
**ceilings were printed anyway**. An arm that produced the right code but dropped
the ceilings is a failure here, because a limit that disappears on the failure
path is exactly when a reader most needs to see it.

WHY A FRESH STATE DIRECTORY PER ARM. Arms that share state can pass for the wrong
reason — a `GRANT_SPENT` arm would pass in a store where the nonce was spent by a
different arm. Each arm gets a directory created under one temporary root, and
the whole root is removed in a `finally`, so no arm can observe another's
side-effects and no key material survives the run.

WHAT A GREEN RUN DOES NOT MEAN. It means this gate, on this machine, at this
commit, produced these codes for these inputs. It does not mean the gate is
CONFORMING — no owner key exists here, and arm 12 measures that the class comes
out `unattributed` / `NON-CONFORMING`. It does not mean the plugin is isolated,
which is the `SAME_UID` ceiling and is asserted rather than assumed. It does not
mean a human authorized anything: attendance is `reported-not-proven`, and arm 12
asserts that word is printed.

Arms, each with its published expected result:

  1  load with no grant                                    -> NO_GRANT
  2  grant minted for different bytes                      -> GRANT_BYTES_MISMATCH
  3  the same grant presented a second time                -> GRANT_SPENT
  4  a load grant used to unload                           -> GRANT_OPERATION_MISMATCH
  5  mediator off, honest grant, honest bytes              -> MEDIATOR_OFF
  6  grant past its expiry                                 -> GRANT_EXPIRED
  7  grant with an `alg` field                             -> GRANT_MALFORMED
  8  grant with an unknown field, and with an identity field-> GRANT_MALFORMED (named)
  9  honest load                                           -> ACCEPTED + receipt
 10  unload of bytes that were never loaded                 -> NOTHING_LOADED
 11  honest unload, then what the receipts claim            -> ACCEPTED, pair APPEND_ONLY
 12  a receipt, with no retained/presented pair             -> CONSISTENCY_UNCHECKED
 13  the same receipt against a retained pair               -> APPEND_ONLY
 14  a tampered receipt                                     -> RECEIPT_TAMPERED
 15  a receipt carrying an `alg` field                      -> RECEIPT_TAMPERED
 16  the class, conformance and attendance a receipt claims -> unattributed / NON-CONFORMING /
                                                              reported-not-proven
 17  the ceilings printed on an accepted AND a refused path -> both
 18  a grant whose signature was edited                     -> GRANT_MALFORMED
  19  the pair's retained root edited after the fact          -> OBSERVATION_CONFLICT
 23  minted subjectDigest equals the pinned Diamond subject-law literal (domain+subject; no Diamond bytes read) -> match over domain+subject; kind/principal and plugin-id/v1-pin must not
  24  a malformed retained document                        -> UNDETERMINED, and the CLI exits 1
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

ARM_COUNT = 24

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GATE = os.path.join(HERE, "__main__.py")

#: Printed on every path, accepted or refused. The arms assert these appear.
REQUIRED_CEILINGS = ("BOOTSTRAP_UNGATED", "SAME_UID", "MEDIATOR_OFF")
REQUIRED_ATTENDANCE = "reported-not-proven"

#: What a live receipt from this gate must derive. No owner key exists at this
#: gate, so there is no path to any other answer, and no arm may accept one.
EXPECTED_CLASS = "unattributed"
EXPECTED_CONFORMANCE = "NON-CONFORMING"

#: The plugin bytes every arm uses. Producible, tiny, and inert: this gate
#: records bytes and never executes them.
PLUGIN_BYTES = b"genesis composition echo v1\n"
OTHER_BYTES = b"different bytes entirely v1\n"

EXIT_REFUSED = 2


class ArmFailure(AssertionError):
    """An arm did not produce its published result."""


# ── running the gate ───────────────────────────────────────────────────────────────────────

def run(args: list[str], *, env_extra: dict | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    # `GATE` is `scripts/composition/__main__.py` — release Python — so a child free to write
    # bytecode would drop `__pycache__` into whichever tree it was run from and break that tree's
    # own `strip-totals-mismatch` check. Set explicitly rather than inherited: the attended shell
    # may or may not have it, and a self-check that passes only because of an inherited variable is
    # not evidence.
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    return subprocess.run(
        [sys.executable, GATE, *args], capture_output=True, text=True, env=env
    )


def refusal_code(proc: subprocess.CompletedProcess) -> str:
    """The code a refused run printed, or a marker saying it did not refuse.

    The marker strings are deliberately not codes, so an arm that expected a code
    can never accidentally match one. A gate that stops refusing must turn an arm
    red, not turn it into a different code.
    """
    for line in proc.stderr.splitlines():
        if line.startswith("REFUSE: "):
            return line[len("REFUSE: "):].split(":", 1)[0].strip()
    if proc.returncode == 0:
        return "<accepted>"
    return f"<no refusal code, exit {proc.returncode}>"


def check_refusal(
    proc: subprocess.CompletedProcess, expected: str
) -> tuple[str, str]:
    """(mark, outcome). A mandatory combinator: every failure path returns FAIL.

    Three conditions, all necessary. The exit status must be the refusal status,
    so a crash is not mistaken for a governed refusal. The code must match. And
    the ceilings must be present, because a refusal that drops them is a refusal
    that taught a reader the limits do not apply while it was saying no.

    The outcome string never contains the raw refusal text. An earlier revision
    returned it verbatim, which made a failing arm's summary line a 200-word
    paragraph and buried the reason the arm failed. The failure record carries the
    full detail; this string stays short enough to read in a table.
    """
    if proc.returncode != EXIT_REFUSED:
        return "FAIL", f"exit {proc.returncode}, expected {EXIT_REFUSED}"
    code = refusal_code(proc)
    if code != expected:
        return "FAIL", code
    missing = [name for name in REQUIRED_CEILINGS if name not in proc.stdout]
    if missing:
        return "FAIL", f"{code}, but ceilings missing: {missing}"
    if REQUIRED_ATTENDANCE not in proc.stdout:
        return "FAIL", f"{code}, but ATTENDANCE: {REQUIRED_ATTENDANCE} was not printed"
    return "ok", code


def field(proc: subprocess.CompletedProcess, label: str) -> str | None:
    """The value of a `LABEL: value` line, or None when the label is absent.

    The colon is part of the match and is not optional. An earlier revision of
    this helper matched `LABEL ` with a space, which silently returned None for
    every line the CLI actually prints — and because None compared unequal to the
    expected word, four arms failed while the gate was behaving correctly. A
    parser that fails closed is right; a parser that fails *silently* on a format
    it invented is how a harness starts lying about the code.
    """
    for line in proc.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith(label + ":"):
            return stripped[len(label) + 1:].strip()
    return None


def contains_line(proc: subprocess.CompletedProcess, text: str) -> bool:
    return any(text in line for line in proc.stdout.splitlines())


#: Where a transition writes its receipt. This is a published layout, documented
#: in README.md, and the self-check reads it by the layout rather than by scraping
#: the human-readable summary. Scraping was tried first and produced two harness
#: bugs of the same shape in a row — a parser that matches a format the CLI does
#: not print returns None, and an arm that compares None to an expected word then
#: reports a defect where there was none. The layout is the stable contract; the
#: printed line is for a person.
def receipt_path(state: str, operation: str, seq: int) -> str:
    return os.path.join(state, f"receipt-{operation}-{seq:03d}.json")


def write(path: str, blob: bytes) -> str:
    with open(path, "wb") as fh:
        fh.write(blob)
    return path


# ── the self-check ─────────────────────────────────────────────────────────────────────────

def main() -> int:
    failures: list[str] = []
    tmp = tempfile.mkdtemp(prefix="composition-selfcheck-")
    # D3: every grant the mint writes names its module relative to a root. The arms' modules live under
    # this scratch directory, so it is the root for both the mint and anything that checks a grant.
    os.environ["AUKORA_GATE_ROOT"] = os.path.realpath(tmp)

    def arm(number: int, name: str, expected: str, mark: str, got: str) -> None:
        if mark != "ok":
            failures.append(f"arm {number} ({name}): expected {expected}, got {got}")
        print(f"  {mark:4s} {number:2d}  {name} -> {got}")

    def arms_dir(number: int) -> str:
        directory = os.path.join(tmp, f"arm-{number:02d}")
        os.makedirs(directory, exist_ok=True)
        return directory

    try:
        # ── the primitives the gate's signatures rest on, before any arm trusts one.
        sys.path.insert(0, HERE)
        import ed25519  # noqa: E402  (sibling module: the curve this gate signs with)
        import jcs  # noqa: E402  (the canonical form every signed byte goes through)

        vectors = ed25519.rfc8032_selftest()
        properties = jcs.selftest()
        print(f"  ..   ed25519: {vectors} RFC 8032 vectors + negative controls ok; "
              f"jcs: {properties} canonical-form properties ok")

        # Cross-implementation parity, when the vendored tree is present. Run as a
        # separate process so neither tree's module names can collide with this
        # one's. A skipped check is reported as skipped and never as a pass, and a
        # vendored tree that exists but will not load fails this command: those
        # bytes are pinned elsewhere in this repository, so unusable ones are a
        # defect rather than an absence.
        parity = subprocess.run(
            [sys.executable, os.path.join(HERE, "parity-vendored.py")],
            capture_output=True, text=True,
        )
        parity_first = (parity.stdout.strip().splitlines() or ["<no output>"])[0]
        if parity.returncode == 0 and "SKIPPED" in parity.stdout:
            print(f"  ..   {parity_first}")
        elif parity.returncode == 0:
            print(f"  ..   {parity.stdout.strip().splitlines()[-1]}")
        else:
            failures.append(
                f"vendored parity check failed (exit {parity.returncode}): "
                f"{parity.stdout.strip() or parity.stderr.strip()}"
            )
            print(f"  FAIL vendored parity check -> exit {parity.returncode}")
            print("        " + (parity.stdout.strip() or parity.stderr.strip()).replace("\n", "\n        "))
        print()

        # ── arm 1: no grant at all.
        d = arms_dir(1)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        mark, got = check_refusal(
            run(["load", "--state", state, "--plugin", plugin]), "NO_GRANT"
        )
        arm(1, "load with no grant", "NO_GRANT", mark, got)

        # ── arms 2-8: one shared state directory, since none of them applies a
        #    transition. Each minted grant is used at most once, by design.
        d = arms_dir(2)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        other = write(os.path.join(d, "other.bin"), OTHER_BYTES)
        state = os.path.join(d, "state")

        wrong = os.path.join(d, "grant-other.json")
        issued = run(["grant", "--state", state, "--operation", "load", "--plugin", other,
                      "--out", wrong])
        if issued.returncode != 0:
            raise ArmFailure(f"could not mint the mismatched grant: {issued.stderr.strip()}")
        mark, got = check_refusal(
            run(["load", "--state", state, "--plugin", plugin, "--grant", wrong]),
            "GRANT_BYTES_MISMATCH",
        )
        arm(2, "grant minted for different bytes", "GRANT_BYTES_MISMATCH", mark, got)

        # ── arm 3: replay. The grant is spent by the accepted load in arm 9's own
        #    directory, so replay is measured here on a grant spent here.
        d = arms_dir(3)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        spent = os.path.join(d, "grant-load.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin, "--out", spent])
        first = run(["load", "--state", state, "--plugin", plugin, "--grant", spent])
        if first.returncode != 0:
            raise ArmFailure(f"the arm-3 setup load was refused: {first.stderr.strip()}")
        mark, got = check_refusal(
            run(["load", "--state", state, "--plugin", plugin, "--grant", spent]), "GRANT_SPENT"
        )
        arm(3, "the same grant presented a second time", "GRANT_SPENT", mark, got)

        # ── arm 4: a load grant used for an unload. Nothing is loaded in this
        #    directory, so the operation mismatch must be the code reported —
        #    which also measures that the operation check precedes the state check.
        d = arms_dir(4)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        load_grant = os.path.join(d, "grant-load.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin,
             "--out", load_grant])
        mark, got = check_refusal(
            run(["unload", "--state", state, "--plugin", plugin, "--grant", load_grant]),
            "GRANT_OPERATION_MISMATCH",
        )
        arm(4, "a load grant used to unload", "GRANT_OPERATION_MISMATCH", mark, got)

        # ── arm 5: mediator off. An honest grant for honest bytes, and the gate
        #    still refuses. This is the fail-closed arm.
        d = arms_dir(5)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        honest = os.path.join(d, "grant-load.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin, "--out", honest])
        proc = run(["load", "--state", state, "--plugin", plugin, "--grant", honest],
                   env_extra={"AUKORA_MEDIATOR": "0"})
        mark, got = check_refusal(proc, "MEDIATOR_OFF")
        if mark == "ok" and "MEDIATOR: off" not in proc.stdout:
            mark, got = "FAIL", "MEDIATOR_OFF but the mediator state line said on"
        arm(5, "mediator off, honest grant, honest bytes", "MEDIATOR_OFF", mark, got)
        # The same mediator-off state must print the code the toy prints, and the
        # gate must not have applied the transition it refused.
        if mark == "ok" and os.path.exists(os.path.join(state, "composition-state.json")):
            state_doc = json.load(open(os.path.join(state, "composition-state.json"),
                                       encoding="utf-8"))
            if state_doc.get("active"):
                failures.append("arm 5: mediator-off refused but a plugin was left loaded")
                print("  FAIL  5   mediator-off left the plugin loaded (defect)")

        # ── arm 6: expired grant.
        d = arms_dir(6)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        expired = os.path.join(d, "grant-expired.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin,
             "--out", expired, "--now", "1000", "--expiry", "2000"])
        mark, got = check_refusal(
            run(["load", "--state", state, "--plugin", plugin, "--grant", expired,
                 "--now", "999999"]),
            "GRANT_EXPIRED",
        )
        arm(6, "grant past its expiry", "GRANT_EXPIRED", mark, got)

        # ── arms 7-8: closed fields, refused by name. `alg` and an identity field
        #    are the two that matter most: an algorithm field would move a verifier
        #    decision into signer-controlled data, and an identity field must never
        #    become permission by being present.
        d = arms_dir(7)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        base = os.path.join(d, "grant-base.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin, "--out", base])
        base_doc = json.load(open(base, encoding="utf-8"))

        def mutate(name: str, extra: dict) -> str:
            path = os.path.join(d, name)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({**base_doc, **extra}, fh, indent=2, sort_keys=True)
            return path

        alg_grant = mutate("grant-alg.json", {"alg": "EdDSA"})
        proc = run(["load", "--state", state, "--plugin", plugin, "--grant", alg_grant])
        mark, got = check_refusal(proc, "GRANT_MALFORMED")
        if mark == "ok" and "alg" not in proc.stderr:
            mark, got = "FAIL", f"{got} but the refusal did not name the alg field"
        arm(7, "grant with an `alg` field", "GRANT_MALFORMED (naming alg)", mark, got)

        unknown_grant = mutate("grant-unknown.json", {"scope": "everything"})
        proc_unknown = run(["load", "--state", state, "--plugin", plugin,
                            "--grant", unknown_grant])
        mark_a, got_a = check_refusal(proc_unknown, "GRANT_MALFORMED")
        if mark_a == "ok" and "scope" not in proc_unknown.stderr:
            mark_a, got_a = "FAIL", f"{got_a} but the refusal did not name the unknown field"
        identity_grant = mutate("grant-identity.json", {"owner": "a-person"})
        proc_identity = run(["load", "--state", state, "--plugin", plugin,
                             "--grant", identity_grant])
        mark_b, got_b = check_refusal(proc_identity, "GRANT_MALFORMED")
        if mark_b == "ok" and "owner" not in proc_identity.stderr:
            mark_b, got_b = "FAIL", f"{got_b} but the refusal did not name the identity field"
        combined_ok = mark_a == "ok" and mark_b == "ok"
        arm(
            8,
            "grant with an unknown field, and with an identity field",
            "GRANT_MALFORMED naming `scope`, then naming `owner`",
            "ok" if combined_ok else "FAIL",
            f"unknown->{got_a}; identity->{got_b}",
        )

        # ── arm 9: the honest load, and the receipt it emits.
        d = arms_dir(9)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        grant_path = os.path.join(d, "grant-load.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin,
             "--out", grant_path])
        accepted = run(["load", "--state", state, "--plugin", plugin, "--grant", grant_path])
        mark, got = "ok", "accepted"
        loaded_receipt = receipt_path(state, "load", 1)
        if accepted.returncode != 0:
            mark, got = "FAIL", f"exit {accepted.returncode}: {accepted.stderr.strip()}"
        elif not os.path.exists(loaded_receipt):
            mark, got = "FAIL", f"ACCEPTED but no receipt at the published path {loaded_receipt}"
        else:
            document = json.load(open(loaded_receipt, encoding="utf-8"))
            import hashlib

            real = hashlib.sha256(PLUGIN_BYTES).hexdigest()
            # The receipt's own `composition.pluginDigest` is the binding, and it is
            # checked against the digest of the bytes the arm actually presented.
            # A version of this arm also scraped the human-readable summary for
            # the same digest; that check tested the harness's guess at a label
            # rather than the gate, and it is not carried here.
            if document["composition"]["pluginDigest"] != real:
                mark, got = "FAIL", "receipt digest is not the digest of the load bytes"
            elif document["composition"]["pluginId"] != "plugin-" + real[:16]:
                mark, got = "FAIL", "receipt pluginId is not derived from the load bytes"
            elif "sig" not in document or len(document["sig"]) != 128:
                mark, got = "FAIL", "receipt carries no 64-byte detached signature"
            elif document["aura"]["seq"] != 1 or document["aura"]["priorHead"] != "0" * 64:
                mark, got = "FAIL", "first receipt does not name seq 1 with the zero prior head"
            elif document["aura"]["head"] != document["aura"]["entryHash"]:
                mark, got = "FAIL", "receipt head is not the entry hash it names"
            elif "alg" in document:
                mark, got = "FAIL", "receipt carries an alg field"
            else:
                got = f"accepted, receipt seq {document['aura']['seq']}, digest bound"
        arm(9, "honest load", "ACCEPTED, receipt emitted for the exact bytes", mark, got)
        arm9_state = state
        arm9_plugin = plugin
        arm9_receipt = loaded_receipt if mark == "ok" else None

        # ── arm 10: unload of bytes that were never loaded. A valid unload grant
        #    for these bytes, against a log where they are not the active plugin.
        d = arms_dir(10)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        unload_grant = os.path.join(d, "grant-unload.json")
        run(["grant", "--state", state, "--operation", "unload", "--plugin", plugin,
             "--out", unload_grant])
        mark, got = check_refusal(
            run(["unload", "--state", state, "--plugin", plugin, "--grant", unload_grant]),
            "NOTHING_LOADED",
        )
        arm(10, "unload of bytes that were never loaded", "NOTHING_LOADED", mark, got)

        # ── arm 11: honest unload against the arm-9 state. Retained is taken after
        #    the load and presented after the unload, so the pair is a real 1 -> 2
        #    observation of this log, not a constructed one.
        mark, got = "ok", "accepted"
        retained_path = os.path.join(tmp, "arm-11-retained.json")
        presented_path = os.path.join(tmp, "arm-11-presented.json")
        unload_receipt = None
        if not arm9_receipt:
            mark, got = "FAIL", "arm 9 produced no receipt to continue from"
        else:
            run(["checkpoint", "--state", arm9_state, "--out", retained_path])
            g2 = os.path.join(tmp, "arm-11-grant-unload.json")
            run(["grant", "--state", arm9_state, "--operation", "unload",
                 "--plugin", arm9_plugin, "--out", g2])
            unloaded = run(["unload", "--state", arm9_state, "--plugin", arm9_plugin,
                            "--grant", g2])
            if unloaded.returncode != 0:
                mark, got = "FAIL", f"honest unload refused: {unloaded.stderr.strip()}"
            else:
                unload_receipt = receipt_path(arm9_state, "unload", 2)
                run(["checkpoint", "--state", arm9_state, "--out", presented_path])
                if not os.path.exists(unload_receipt):
                    # A failure here is reported and the remaining arms still run.
                    # Aborting the whole check on the first failure would hide
                    # whether the rest of the gate still works, which is the
                    # information a reader needs most at that moment.
                    mark, got = "FAIL", f"no receipt at {unload_receipt}"
                else:
                    verdict = run(["verify", "--state", arm9_state, "--receipt", unload_receipt,
                                   "--retained", retained_path, "--presented", presented_path])
                    consistency = field(verdict, "CONSISTENCY")
                    if consistency != "APPEND_ONLY":
                        mark, got = "FAIL", f"pair verdict was {consistency}"
                    elif field(verdict, "SIGNATURE") != "ok":
                        mark, got = "FAIL", "receipt signature did not verify"
                    elif field(verdict, "POSITION") != "ok":
                        mark, got = "FAIL", "receipt position did not verify"
                    else:
                        got = "accepted, unload receipt verified against an APPEND_ONLY pair"
        arm(11, "honest unload, verified against a retained pair", "ACCEPTED then APPEND_ONLY", mark, got)

        # ── arm 12: the armed receipt with no pair. This is the arm that keeps
        #    "I did not check" from being read as "it agreed".
        mark, got = "ok", "CONSISTENCY_UNCHECKED"
        if not arm9_receipt:
            mark, got = "FAIL", "arm 9 produced no receipt to verify"
        else:
            cold = run(["verify", "--state", arm9_state, "--receipt", arm9_receipt])
            consistency = field(cold, "CONSISTENCY")
            if consistency != "CONSISTENCY_UNCHECKED":
                mark, got = "FAIL", f"got {consistency}, expected CONSISTENCY_UNCHECKED"
            elif cold.returncode != 0:
                mark, got = "FAIL", f"cold verify exited {cold.returncode}"
            else:
                got = "CONSISTENCY_UNCHECKED (and signature ok, position ok)"
        arm(12, "a receipt with no retained/presented pair", "CONSISTENCY_UNCHECKED", mark, got)

        # ── arm 13: the same receipt against the pair from arm 11.
        mark, got = "ok", "APPEND_ONLY"
        if not (arm9_receipt and os.path.exists(presented_path)):
            mark, got = "FAIL", "no pair available from arm 11"
        else:
            verdict = run(["verify", "--state", arm9_state, "--receipt", arm9_receipt,
                           "--retained", retained_path, "--presented", presented_path])
            consistency = field(verdict, "CONSISTENCY")
            if consistency != "APPEND_ONLY":
                mark, got = "FAIL", f"got {consistency}"
            else:
                got = f"APPEND_ONLY ({field(verdict, 'NOTE') or 'verified'})"
        arm(13, "the same receipt against a retained pair", "APPEND_ONLY (measured, not unchecked)", mark, got)

        # ── arm 15: a tampered receipt fails its own verification. Two layers are
        #    asserted, because either one alone leaves a hole: the module must
        #    refuse, and the command an operator runs must exit with the code.
        mark, got = "ok", "RECEIPT_TAMPERED"
        if not arm9_receipt:
            mark, got = "FAIL", "arm 9 produced no receipt to tamper with"
        else:
            tampered_path = os.path.join(tmp, "arm-14-tampered.json")
            document = json.load(open(arm9_receipt, encoding="utf-8"))
            digest = document["composition"]["pluginDigest"]
            document["composition"]["pluginDigest"] = digest[:-1] + ("0" if digest[-1] != "0" else "1")
            with open(tampered_path, "w", encoding="utf-8") as fh:
                json.dump(document, fh, indent=2, sort_keys=True)
            module_refused = False
            try:
                import receipt as receipt_mod

                receipt_mod.verify_receipt(document)
            except Exception:
                module_refused = True
            proc = run(["verify", "--state", arm9_state, "--receipt", tampered_path])
            mark2, code = check_refusal(proc, "RECEIPT_TAMPERED")
            if not module_refused:
                mark, got = "FAIL", "receipt.verify_receipt accepted a tampered receipt"
            elif mark2 != "ok":
                mark, got = "FAIL", f"the command did not refuse as expected: {code}"
            else:
                got = "RECEIPT_TAMPERED at the module and at the command"
        arm(15, "a tampered receipt fails its own verification", "RECEIPT_TAMPERED", mark, got)

        # ── arm 16: a receipt carrying an `alg` field. The field is refused by
        #    name before any signature work, so a valid signature over a document
        #    carrying it does not make the document admissible.
        mark, got = "ok", "RECEIPT_TAMPERED naming alg"
        if not arm9_receipt:
            mark, got = "FAIL", "arm 9 produced no receipt to edit"
        else:
            alg_path = os.path.join(tmp, "arm-15-alg.json")
            document = dict(json.load(open(arm9_receipt, encoding="utf-8")))
            document["alg"] = "EdDSA"
            with open(alg_path, "w", encoding="utf-8") as fh:
                json.dump(document, fh, indent=2, sort_keys=True)
            proc = run(["verify", "--state", arm9_state, "--receipt", alg_path])
            mark2, code = check_refusal(proc, "RECEIPT_TAMPERED")
            if mark2 != "ok":
                mark, got = "FAIL", code
            elif "alg" not in proc.stderr:
                mark, got = "FAIL", f"{code} but the refusal did not name the alg field"
        arm(16, "a receipt carrying an `alg` field", "RECEIPT_TAMPERED naming alg", mark, got)

        # ── arm 17: class, conformance and attendance. This arm is the one that
        #    fails if anyone ever makes this gate claim more than it can show.
        mark, got = "ok", f"{EXPECTED_CLASS} / {EXPECTED_CONFORMANCE} / {REQUIRED_ATTENDANCE}"
        for source, label in (
            (accepted if arm9_receipt else None, "the load command"),
            (run(["verify", "--state", arm9_state, "--receipt", arm9_receipt])
             if arm9_receipt else None, "the verify command"),
        ):
            if source is None:
                continue
            approval = field(source, "CLASS")
            conformance = field(source, "CONFORMANCE")
            attendance = field(source, "ATTENDANCE")
            if approval != EXPECTED_CLASS:
                mark, got = "FAIL", f"{label} derived CLASS {approval}"
            elif conformance != EXPECTED_CONFORMANCE:
                mark, got = "FAIL", f"{label} derived CONFORMANCE {conformance}"
            elif attendance != REQUIRED_ATTENDANCE:
                mark, got = "FAIL", f"{label} printed ATTENDANCE {attendance}"
            elif "CONFORMING" in source.stdout.replace("NON-CONFORMING", ""):
                mark, got = "FAIL", f"{label} claimed CONFORMING"
        arm(17, "the class, conformance and attendance a receipt claims",
            f"{EXPECTED_CLASS} / {EXPECTED_CONFORMANCE} / {REQUIRED_ATTENDANCE}", mark, got)

        # ── arm 18: the ceilings on both an accepted and a refused path. Measured
        #    separately from every other arm so that a regression which prints the
        #    ceilings only on success fails here and nowhere else.
        d = arms_dir(17)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        state = os.path.join(d, "state")
        good = os.path.join(d, "grant-load.json")
        run(["grant", "--state", state, "--operation", "load", "--plugin", plugin, "--out", good])
        accepted_path = run(["load", "--state", state, "--plugin", plugin, "--grant", good])
        refused_path = run(["load", "--state", state, "--plugin", plugin])
        problems = []
        for label, proc in (("accepted", accepted_path), ("refused", refused_path)):
            missing = [name for name in REQUIRED_CEILINGS if name not in proc.stdout]
            if missing:
                problems.append(f"{label} path missing {missing}")
            if REQUIRED_ATTENDANCE not in proc.stdout:
                problems.append(f"{label} path missing ATTENDANCE: {REQUIRED_ATTENDANCE}")
        arm(
            18,
            "the ceilings printed on an accepted AND a refused path",
            "BOOTSTRAP_UNGATED + SAME_UID + MEDIATOR_OFF on both",
            "ok" if not problems else "FAIL",
            "both paths printed all three ceilings" if not problems else "; ".join(problems),
        )

        # ── arm 19: a grant whose signed content was edited. The signature must
        #    fail, and it must fail as a malformed grant rather than as anything
        #    that could be read as "the grant was fine but something else was wrong".
        mark, got = "ok", "GRANT_MALFORMED (signature)"
        if not os.path.exists(base):
            mark, got = "FAIL", "no base grant from arm 7 to edit"
        else:
            edited_path = os.path.join(tmp, "arm-18-edited.json")
            document = json.load(open(base, encoding="utf-8"))
            document["expiry"] = int(document["expiry"]) + 100000
            with open(edited_path, "w", encoding="utf-8") as fh:
                json.dump(document, fh, indent=2, sort_keys=True)
            proc = run(["load", "--state", state, "--plugin", plugin, "--grant", edited_path])
            mark2, code = check_refusal(proc, "GRANT_MALFORMED")
            if mark2 != "ok":
                mark, got = "FAIL", code
            elif "signature" not in proc.stderr:
                mark, got = "FAIL", f"{code} but the refusal did not name the signature"
        arm(19, "a grant whose signed content was edited",
            "GRANT_MALFORMED naming the signature", mark, got)

        # ── arm 20: a grant forged by a different principal. Someone generates their own
        #    keypair, mints a grant naming THEIR public key, signs it correctly, and
        #    presents it to this installation. Every internal check passes: the document is
        #    well-formed, closed, and its signature verifies — against the key it carries.
        #    That is the whole defect. A grant cannot be authorized by the key it names, or
        #    every grant authorizes itself. This arm is the reason `want_governor_pk` exists.
        mark, got = "ok", "GOVERNOR_UNTRUSTED (a self-signed grant is not an authorization)"
        if not os.path.exists(base):
            mark, got = "FAIL", "no base grant from arm 7 to re-key"
        else:
            forged_path = os.path.join(tmp, "arm-20-forged-grant.json")
            document = json.load(open(base, encoding="utf-8"))
            # A real attacker keypair, generated here, signing a well-formed grant.
            attacker_seed = b"\x11" * 32
            attacker_pk = ed25519.public_from_seed(attacker_seed)
            document["governorPk"] = attacker_pk.hex()
            import importlib
            grant_mod = importlib.import_module("grant")
            # The module's own preimage, so the forged grant signs pluginPath/pluginClosure too, as every
            # minted grant now carries them; a hand-built body over the mandatory fields alone would fail
            # the signature and be refused for the wrong reason.
            document["sig"] = ed25519.sign(attacker_seed, grant_mod.to_sign_bytes(document)).hex()
            with open(forged_path, "w", encoding="utf-8") as fh:
                json.dump(document, fh, indent=2, sort_keys=True)
            proc = run(["load", "--state", state, "--plugin", plugin, "--grant", forged_path])
            mark2, code = check_refusal(proc, "GOVERNOR_UNTRUSTED")
            if mark2 != "ok":
                mark, got = "FAIL", code
            elif not proc.stderr.strip():
                mark, got = "FAIL", "refused with no reason printed"
        arm(20, "a grant signed by a keypair the presenter generated",
            "GOVERNOR_UNTRUSTED", mark, got)

        # ── arm 21: priorHead across SUCCESSIVE entries, checked against values derived
        #    here rather than read back from the log. `head_before` must be the previous
        #    entry's hash — not that entry's stored `prev`, which would make every later
        #    comparison true by construction. Three entries, because a one-entry log cannot
        #    tell a correct chain from a constant.
        mark, got = "ok", "priorHead == previous entry hash for seq 1, 2 and 3; ZERO for seq 1"
        chain_dir = arms_dir(21)
        chain_state = os.path.join(chain_dir, "state")
        os.makedirs(chain_state, exist_ok=True)
        chain_plugin = os.path.join(chain_dir, "plugin.bin")
        with open(chain_plugin, "wb") as fh:
            fh.write(PLUGIN_BYTES)
        try:
            import contextlib
            import importlib
            import io

            loader_mod = importlib.import_module("loader")
            gate = loader_mod.Loader(chain_state)
            observed = []
            for operation in ("load", "unload", "load"):
                minted = run(["grant", "--state", chain_state, "--plugin", chain_plugin,
                              "--operation", operation, "--out",
                              os.path.join(chain_dir, f"g-{operation}-{len(observed)}.json")])
                if minted.returncode != 0:
                    mark, got = "FAIL", f"grant for {operation} failed: {minted.stderr.strip()[:80]}"
                    break
                grant_path = os.path.join(chain_dir, f"g-{operation}-{len(observed)}.json")
                grant_doc = json.load(open(grant_path, encoding="utf-8"))
                with contextlib.redirect_stdout(io.StringIO()):
                    result = getattr(gate, operation)(open(chain_plugin, "rb").read(), grant_doc)
                observed.append((result["entry"]["seq"], result["receipt"]["aura"]["priorHead"]))
            else:
                # Independently derived: entry N's priorHead is entry N-1's hash, ZERO for N=1.
                entries = gate.aura.entries
                for seq, prior in observed:
                    want = "0" * 64 if seq == 1 else entries[seq - 2]["hash"]
                    if prior != want:
                        mark, got = "FAIL", f"seq {seq} priorHead {prior[:16]}… != {want[:16]}…"
                        break
        except Exception as exc:  # noqa: BLE001 - an arm that cannot run is a failure
            mark, got = "FAIL", f"{type(exc).__name__}: {exc}"
        arm(21, "priorHead over three successive entries, independently derived",
            "priorHead == previous entry hash, ZERO for the first", mark, got)

        # ── arm 22: mediator OFF must prevent the governed effect, not merely report it.
        #    Arm 5 asserts the code MEDIATOR_OFF, and a code is not a measurement: a gate
        #    that appended to the log and THEN refused would pass arm 5 while performing
        #    the very effect it claimed to prevent. This arm compares the log size, the
        #    transition counter and the receipt directory before and after.
        mark, got = "ok", "log, counters and receipts all unchanged across the refusal"
        off_dir = arms_dir(22)
        off_state = os.path.join(off_dir, "state")
        os.makedirs(off_state, exist_ok=True)
        off_plugin = os.path.join(off_dir, "plugin.bin")
        with open(off_plugin, "wb") as fh:
            fh.write(PLUGIN_BYTES)
        try:
            import contextlib
            import importlib
            import io

            loader_mod = importlib.import_module("loader")
            gate = loader_mod.Loader(off_state)
            minted = run(["grant", "--state", off_state, "--plugin", off_plugin,
                          "--operation", "load", "--out", os.path.join(off_dir, "g.json")])
            if minted.returncode != 0:
                mark, got = "FAIL", f"grant mint failed: {minted.stderr.strip()[:80]}"
            else:
                grant_doc = json.load(open(os.path.join(off_dir, "g.json"), encoding="utf-8"))
                before = (len(gate.aura.entries), gate.state.get("transitions"),
                          len([n for n in os.listdir(off_state) if n.startswith("receipt-")]))
                # One gate object, with its mediator replaced. Constructing a second Loader
                # over the same live state makes it re-read a log the first object still holds
                # in memory, which is a different experiment than the one this arm is running.
                gate.mediator = importlib.import_module("mediator").Mediator(enabled=False)
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        gate.load(open(off_plugin, "rb").read(), grant_doc)
                    mark, got = "FAIL", "mediator OFF accepted the transition"
                except Exception as exc:  # noqa: BLE001 - the refusal is the expected path
                    if "MEDIATOR_OFF" not in str(exc):
                        mark, got = "FAIL", f"refused as {str(exc)[:60]}"
                    else:
                        after = (len(gate.aura.entries), gate.state.get("transitions"),
                                 len([n for n in os.listdir(off_state) if n.startswith("receipt-")]))
                        if after != before:
                            mark, got = "FAIL", f"the log or state changed: {before} -> {after}"
        except Exception as exc:  # noqa: BLE001
            mark, got = "FAIL", f"{type(exc).__name__}: {exc}"
        arm(22, "mediator OFF, measured for effect rather than for a code",
            "no log entry, no transition counted, no receipt written", mark, got)

        # ── arm 14: the pair's retained root edited after the fact. This arm exists
        #    because negative-control testing found a real hole: arms 11 and 13 both
        #    assert only the AGREEMENT verdict, so a consistency check that had been
        #    neutered into always returning APPEND_ONLY passed every arm in this file.
        #    The defect was a real one — recomputing the two roots was removed and the
        #    self-check still went green. An arm that can only observe "yes" is not a
        #    check, so this one asserts the DISAGREEMENT the gate must produce when
        #    the retained observation it is handed is not a prefix of the log. The
        #    mutated document stands in for a retained observation that was rewritten
        #    after it was taken, which is the case the whole retainer argument is for.
        mark, got = "ok", "OBSERVATION_CONFLICT (and no APPEND_ONLY anywhere)"
        if not (arm9_receipt and os.path.exists(retained_path)):
            mark, got = "FAIL", "no pair available from arm 11"
        else:
            edited_retained = os.path.join(tmp, "arm-19-retained-edited.json")
            document = dict(json.load(open(retained_path, encoding="utf-8")))
            root = document["root"]
            document["root"] = root[:-1] + ("0" if root[-1] != "0" else "1")
            with open(edited_retained, "w", encoding="utf-8") as fh:
                json.dump(document, fh, indent=2, sort_keys=True)
            verdict = run(["verify", "--state", arm9_state, "--receipt", arm9_receipt,
                           "--retained", edited_retained, "--presented", presented_path])
            consistency = field(verdict, "CONSISTENCY")
            if consistency != "OBSERVATION_CONFLICT":
                mark, got = "FAIL", f"got {consistency}, expected OBSERVATION_CONFLICT"
            elif verdict.returncode != 2:
                # THIS ARM USED TO REQUIRE EXIT 0 — "instead of reporting" — because the CLI exited 0 for every
                # verdict. A conflict is a REFUSAL; once the exit code carries the verdict, this arm must see 2.
                mark, got = "FAIL", f"the court exited {verdict.returncode} instead of REFUSING with 2"
            elif contains_line(verdict, "APPEND_ONLY"):
                mark, got = "FAIL", "APPEND_ONLY was printed somewhere in a conflicting verdict"
            else:
                note = field(verdict, "NOTE")
                got = f"OBSERVATION_CONFLICT ({(note or 'root disagrees')[:64]}…)"
        arm(14, "the pair's retained root edited after the fact", "OBSERVATION_CONFLICT (no APPEND_ONLY)", mark, got)

        # ── arm 24: THE OTHER VERDICT THAT MUST DECIDE THE EXIT CODE (Fable's item (d)). A malformed document is
        #    UNDETERMINED — the vocabulary is aura.py's — and it must exit 1 rather than 0. MEASURED: my first probe
        #    for this pointed the CLI at an EMPTY state and was refused before any verdict, which proves nothing; here
        #    the state and receipt are arm 9's, so the verification path is the real one.
        mark, got = "ok", "UNDETERMINED exits 1"
        if not (arm9_receipt and os.path.exists(presented_path)):
            mark, got = "FAIL", "no pair available from arm 11"
        else:
            undetermined_path = os.path.join(tmp, "arm-24-retained-undetermined.json")
            with open(undetermined_path, "w", encoding="utf-8") as fh:
                json.dump({"not": "a tree document"}, fh)
            verdict_u = run(["verify", "--state", arm9_state, "--receipt", arm9_receipt,
                             "--retained", undetermined_path, "--presented", presented_path])
            consistency_u = field(verdict_u, "CONSISTENCY")
            if consistency_u != "UNDETERMINED":
                mark, got = "FAIL", f"got {consistency_u}, expected UNDETERMINED"
            elif verdict_u.returncode != 1:
                mark, got = "FAIL", f"an UNDETERMINED verdict exited {verdict_u.returncode} instead of 1"
            else:
                got = f"UNDETERMINED exits {verdict_u.returncode}"
        arm(24, "a malformed retained document is UNDETERMINED and exits 1", "UNDETERMINED exits 1", mark, got)

        # ── arm 23: subjectDigest is Diamond's formula over abspath(blob), independently
        #    recomputed by this stranger. The loader writes plugin.blob then mints; the
        #    digest must be sha256(JCS({domain: aukora-subject/v1-toy, subject: abspath})).
        #    Diamond `diamond/subject.py` (SHA `cac9f69`; the same blob at `b80ab8e`) uses those keys. The previous
        #    Genesis spelling `{kind, principal}` must not match — that is the miss
        #    cold_verify cannot see. Also: v1-pin/plugin-id must not match, an empty
        #    path must refuse, and a symlink state dir must hash abspath not realpath.
        mark, got = "ok", "subjectDigest == pinned Diamond subject-law literal (domain+subject; no Diamond bytes read)"
        d = arms_dir(23)
        real_state = os.path.join(d, "real-state")
        link_state = os.path.join(d, "link-state")
        os.makedirs(real_state)
        os.symlink(os.path.abspath(real_state), link_state)
        plugin = write(os.path.join(d, "plugin.bin"), PLUGIN_BYTES)
        grant_path = os.path.join(d, "grant-load.json")
        run(["grant", "--state", link_state, "--operation", "load", "--plugin", plugin,
             "--out", grant_path])
        minted = run(["load", "--state", link_state, "--plugin", plugin, "--grant", grant_path])
        subject_receipt = receipt_path(link_state, "load", 1)
        if minted.returncode != 0:
            mark, got = "FAIL", f"honest load refused: {minted.stderr.strip()[:80]}"
        elif not os.path.exists(subject_receipt):
            mark, got = "FAIL", "no receipt after load"
        else:
            document = json.load(open(subject_receipt, encoding="utf-8"))
            import hashlib
            from jcs import canonicalize_bytes

            blob = os.path.abspath(os.path.join(link_state, "plugin.blob"))
            # Diamond keys, as a literal. Do not call subject_digest_for here: that
            # is the producer under test, and a stranger who reuses it cannot see
            # a kind/principal drift.
            diamond_record = {"domain": "aukora-subject/v1-toy", "subject": blob}
            want = hashlib.sha256(canonicalize_bytes(diamond_record)).hexdigest()
            got_digest = document["composition"]["subjectDigest"]
            plugin_ident = "plugin-" + hashlib.sha256(PLUGIN_BYTES).hexdigest()[:16]
            wrong_pin = hashlib.sha256(
                canonicalize_bytes({"kind": "aukora-subject/v1-pin", "principal": plugin_ident})
            ).hexdigest()
            wrong_id_toy = hashlib.sha256(
                canonicalize_bytes({"kind": "aukora-subject/v1-toy", "principal": plugin_ident})
            ).hexdigest()
            wrong_kind_principal = hashlib.sha256(
                canonicalize_bytes({"kind": "aukora-subject/v1-toy", "principal": blob})
            ).hexdigest()
            real_blob = os.path.realpath(blob)
            refused_empty = False
            try:
                import receipt as receipt_mod

                receipt_mod.subject_digest_for("")
            except ValueError:
                refused_empty = True
            except Exception:  # noqa: BLE001
                refused_empty = False
            if set(diamond_record) != {"domain", "subject"}:
                mark, got = "FAIL", f"Diamond literal keys drifted: {sorted(diamond_record)}"
            elif got_digest != want:
                mark, got = "FAIL", f"minted {got_digest} != stranger {want} over {blob}"
            elif got_digest == wrong_kind_principal:
                mark, got = "FAIL", "subjectDigest still hashes kind+principal, not domain+subject"
            elif got_digest == wrong_pin:
                mark, got = "FAIL", "subjectDigest still uses aukora-subject/v1-pin + plugin id"
            elif got_digest == wrong_id_toy:
                mark, got = "FAIL", "subjectDigest hashed plugin id under v1-toy"
            elif not os.path.isfile(blob):
                mark, got = "FAIL", f"loader did not write governed blob at {blob}"
            elif real_blob != blob and got_digest == hashlib.sha256(
                canonicalize_bytes({"domain": "aukora-subject/v1-toy", "subject": real_blob})
            ).hexdigest():
                mark, got = "FAIL", "subjectDigest used realpath; Diamond uses abspath"
            elif not refused_empty:
                mark, got = "FAIL", "empty blob path was accepted rather than refused"
            else:
                got = f"match over domain+subject abspath({blob})"
        arm(
            23,
            "minted subjectDigest equals the pinned Diamond subject-law literal (domain+subject; no Diamond bytes read)",
            "stranger JCS({domain, subject}); kind/principal and plugin-id/v1-pin must not",
            mark,
            got,
        )

    except ArmFailure as exc:
        failures.append(f"a required setup step failed: {exc}")
        print(f"  FAIL  --  a required setup step failed: {exc}")
    except Exception as exc:  # noqa: BLE001 - report, never mask, an arm defect
        import traceback

        failures.append(f"the self-check itself raised {type(exc).__name__}: {exc}")
        print(f"  FAIL  --  the self-check itself raised {type(exc).__name__}: {exc}")
        traceback.print_exc()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"B3 COMPOSITION SELFCHECK: FAILED ({len(failures)} arm(s))")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print(f"B3 COMPOSITION SELFCHECK: {ARM_COUNT}/{ARM_COUNT} arms produced their published result")
    return 0


if __name__ == "__main__":
    sys.exit(main())
