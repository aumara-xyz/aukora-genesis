#!/usr/bin/env python3
"""Grant-rule court: Python half of the shared contract.

    python3 scripts/composition/grant-rule-court.py
    python3 scripts/composition/grant-rule-court.py --verify GRANT.json --now N --want-coeffect HEX
    python3 scripts/composition/grant-rule-court.py --sign-vector ID --out FILE

ACCEPTANCE (default). Exit 0 only when:
  - independently derived JCS + digest for the fixture uid match the published values
  - a different uid must not produce that digest
  - every ACCEPT vector, signed here, is accepted by grant.verify
  - every REJECT vector, signed here (so the signature would pass if the
    type or envelope check were skipped), is refused with the published code
    and names the published token
  - an honest grant whose issuedAt is then rewritten as a string without
    re-signing is still GRANT_MALFORMED (structure before signature)

`--verify` / `--sign-vector` are the cross-language seams the Node court drives.
Keyless: ephemeral seed, no network, no sibling checkout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ed25519  # noqa: E402
import grant as grant_mod  # noqa: E402
import ceilings as ceilings_mod  # noqa: E402
from hexutil import sha256_hex, to_hex  # noqa: E402
from jcs import canonicalize_bytes  # noqa: E402
from refusals import CompositionRefusal  # noqa: E402

CONTRACT_PATH = HERE / "grant-rule-contract.json"

FAILURES = 0
ARMS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILURES, ARMS
    ARMS += 1
    if ok:
        print(f"  ok    {name}")
    else:
        FAILURES += 1
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def honest_body(contract: dict, governor_pk_hex: str) -> dict:
    fixture = contract["fixture"]
    return {
        "coeffectEnvelopeDigest": fixture["expectedCoeffectEnvelopeDigest"],
        "expiry": fixture["expiry"],
        "governorPk": governor_pk_hex,
        "issuedAt": fixture["issuedAt"],
        "kind": contract["normative"]["grantKind"],
        "nonce": fixture["nonce"],
        "operation": "load",
        "pluginDigest": fixture["pluginDigest"],
    }


def sign_body(seed: bytes, body: dict) -> dict:
    grant = dict(body)
    grant["sig"] = to_hex(ed25519.sign(seed, grant_mod.to_sign_bytes(grant)))
    return grant


def apply_overrides(body: dict, overrides: dict) -> dict:
    next_body = dict(body)
    next_body.update(overrides)
    return next_body


def verdict_of(grant: dict, *, now: int, want_coeffect: str, want_governor_pk: str) -> tuple[str, str]:
    try:
        grant_mod.verify(
            grant,
            now=now,
            want_operation="load",
            want_plugin=grant.get("pluginDigest") if isinstance(grant.get("pluginDigest"), str) else None,
            want_coeffect=want_coeffect,
            want_governor_pk=want_governor_pk,
            check_expiry=True,
        )
        return "ACCEPT", ""
    except CompositionRefusal as exc:
        return exc.code, exc.reason


def cmd_sign_vector(vector_id: str, out_path: str) -> int:
    contract = load_contract()
    vectors = {item["id"]: item for item in contract["vectors"]}
    if vector_id not in vectors:
        print(f"unknown vector {vector_id!r}", file=sys.stderr)
        return 1
    seed, public = ed25519.keygen()
    body = apply_overrides(honest_body(contract, to_hex(public)), vectors[vector_id]["overrides"])
    grant = sign_body(seed, body)
    Path(out_path).write_text(json.dumps(grant, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


def cmd_verify(grant_path: str, now: int, want_coeffect: str) -> int:
    grant = json.loads(Path(grant_path).read_text(encoding="utf-8"))
    governor = grant["governorPk"] if isinstance(grant, dict) and "governorPk" in grant else ""
    code, reason = verdict_of(
        grant, now=now, want_coeffect=want_coeffect, want_governor_pk=governor
    )
    if code == "ACCEPT":
        print("ACCEPT")
        return 0
    print(f"REFUSE: {code}: {reason}")
    return 2


def cmd_selfcheck() -> int:
    contract = load_contract()
    fixture = contract["fixture"]
    print("\ngrant-rule court — Python verifier on the shared contract\n")

    derived_jcs = canonicalize_bytes(
        grant_mod.coeffect_envelope(fixture["uid"])
    ).decode("utf-8")
    derived_digest = grant_mod.coeffect_digest(fixture["uid"])
    check(
        "fixture uid JCS matches the published canonical bytes",
        derived_jcs == fixture["expectedCoeffectJcs"],
        f"got {derived_jcs}",
    )
    check(
        "fixture uid digest matches the published sha256",
        derived_digest == fixture["expectedCoeffectEnvelopeDigest"],
        f"got {derived_digest}",
    )
    check(
        "a different uid must not produce the published digest",
        grant_mod.coeffect_digest(fixture["uid"] + 1) != fixture["expectedCoeffectEnvelopeDigest"],
    )
    check(
        "sha256 of the published JCS is the published digest (independent of grant.py helper)",
        sha256_hex(fixture["expectedCoeffectJcs"].encode("utf-8"))
        == fixture["expectedCoeffectEnvelopeDigest"],
    )

    seed, public = ed25519.keygen()
    pk_hex = to_hex(public)
    now = fixture["now"]
    want_coeffect = fixture["expectedCoeffectEnvelopeDigest"]

    for vector in contract["vectors"]:
        grant = sign_body(seed, apply_overrides(honest_body(contract, pk_hex), vector["overrides"]))
        code, reason = verdict_of(
            grant, now=now, want_coeffect=want_coeffect, want_governor_pk=pk_hex
        )
        wanted = vector["verdict"]
        named = vector.get("mustName")
        ok = code == wanted
        if wanted != "ACCEPT" and named and named.lower() not in reason.lower():
            ok = False
        check(
            f"python {vector['id']} -> {wanted}",
            ok,
            f"got {code}: {reason}" if not ok else "",
        )

    honest = sign_body(seed, honest_body(contract, pk_hex))
    rewritten = dict(honest)
    rewritten["issuedAt"] = str(fixture["issuedAt"])
    code, reason = verdict_of(
        rewritten, now=now, want_coeffect=want_coeffect, want_governor_pk=pk_hex
    )
    check(
        "rewriting issuedAt to a string without re-signing is GRANT_MALFORMED naming issuedAt",
        code == "GRANT_MALFORMED" and "issuedAt" in reason,
        f"got {code}: {reason}",
    )

    # ── GUARDIAN D3, BEHAVIOURAL ────────────────────────────────────────────────────────────────
    # **THESE ARMS USED TO ASSERT THE INTERFACE -- that `want_path` and `want_closure` were in the
    # signature -- AND `--mutate` PROVED THEM INADEQUATE ON ITS FIRST RUN**: it removed the CHECK and
    # left the PARAMETER, so the interface was intact, the behaviour was gone, and all three arms
    # stayed green. *An arm that asserts a thing EXISTS has not asserted that it WORKS.*
    #
    # **SO THEY NOW MINT A GRANT, PRESENT SOMETHING ELSE, AND REQUIRE THE REFUSAL BY NAME.** The
    # fixture is re-signed through `sign_body`, *which is what makes these arms exercise the SIGNED
    # path rather than a dictionary that no verifier would accept* -- and because
    # `OPTIONAL_SIGNED_FIELDS` are folded into `to_sign_bytes`, **a grant carrying them has signed
    # them.**
    d3_grant = sign_body(
        seed,
        {
            **honest_body(contract, pk_hex),
            "pluginPath": "plugins/example/src/index.mjs",
            "pluginClosure": "c" * 64,
        },
    )

    def d3_verdict(**want):
        """Verify the D3 fixture with the given expectations, returning (code, reason)."""
        try:
            grant_mod.verify(
                d3_grant, now=now, want_operation="load",
                want_plugin=d3_grant["pluginDigest"], want_coeffect=want_coeffect,
                want_governor_pk=pk_hex, **want,
            )
            return "ACCEPT", ""
        except CompositionRefusal as exc:
            return exc.code, exc.reason

    # 1. THE HAPPY PATH, SO THE REFUSALS BELOW ARE KNOWN TO BE ABOUT THE MISMATCH AND NOT THE FIXTURE.
    _code, _reason = d3_verdict(
        want_path="plugins/example/src/index.mjs", want_closure="c" * 64
    )
    check(
        "D3 GREEN: a grant whose path and closure MATCH is accepted",
        _code == "ACCEPT",
        f"got {_code}: {_reason}",
    )

    # 2. **THE BYTE-IDENTICAL MODULE AT A DIFFERENT PATH** -- the exact case the patent survey named.
    _code, _reason = d3_verdict(
        want_path="plugins/ELSEWHERE/src/index.mjs", want_closure="c" * 64
    )
    check(
        "RED ARM (D3): a byte-identical module at a DIFFERENT PATH is refused by name",
        _code == "GRANT_PATH_NOT_GRANTED",
        f"got {_code}: {_reason} -- a grant that binds bytes and not a path admits the copy",
    )

    # 3. **THE UNBOUND IMPORT CLOSURE** -- the entry bytes are identical and an import changed.
    _code, _reason = d3_verdict(
        want_path="plugins/example/src/index.mjs", want_closure="d" * 64
    )
    check(
        "RED ARM (D3): a CHANGED IMPORT CLOSURE is refused by name, with the entry bytes untouched",
        _code == "GRANT_CLOSURE_CHANGED",
        f"got {_code}: {_reason} -- an entry digest cannot express a changed import",
    )

    # 4. AND A GRANT WHOSE PATH IS ABSENT STILL VERIFIES -- **the migration property**: a grant minted
    #    before these fields existed must not be refused merely for lacking them.
    _legacy = sign_body(seed, honest_body(contract, pk_hex))
    try:
        grant_mod.verify(
            _legacy, now=now, want_operation="load", want_plugin=_legacy["pluginDigest"],
            want_coeffect=want_coeffect, want_governor_pk=pk_hex,
            want_path="plugins/example/src/index.mjs", want_closure="c" * 64,
        )
        _code = "ACCEPT"
    except CompositionRefusal as exc:
        _code = exc.code
    check(
        "D3 GREEN: a grant minted BEFORE these fields existed still verifies",
        _code == "ACCEPT",
        f"got {_code} -- the fix must not be a flag day",
    )

    # ── aura-75 (1): THE TWO TIERS, AND THE CEILING THAT NAMES THE WEAKER ONE ────────────────────
    # **A LEGACY GRANT IS NOT REFUSED -- WHICH IS DELIBERATE, BECAUSE REQUIRING THE FIELDS WOULD BE A
    # FLAG DAY. What must not happen is a SILENT pass**, *and these arms are what makes "not silent"
    # a measured property rather than an intention.*

    # 1. A NEW MINT CAN CARRY BOTH, AND THEY SURVIVE INTO THE SIGNED BODY.
    _minted = grant_mod.issue(
        seed=seed, governor_pk=public, operation="load",
        plugin_digest="a" * 64,
        coeffect_digest=want_coeffect, nonce="ab" * 32, expiry=now + 3600, issued_at=now,
        plugin_path="plugins/example/src/index.mjs", plugin_closure="b" * 64,
    )
    check(
        "aura-75 (1): a mint given a path and a closure CARRIES both",
        _minted.get("pluginPath") == "plugins/example/src/index.mjs"
        and _minted.get("pluginClosure") == "b" * 64,
        f"got pluginPath={_minted.get('pluginPath')!r}, pluginClosure={_minted.get('pluginClosure')!r}",
    )

    # 2. A HALF-BOUND MINT IS REFUSED BY NAME rather than producing a grant that reads as bound.
    _half = "ACCEPT"
    try:
        grant_mod.issue(
            seed=seed, governor_pk=public, operation="load", plugin_digest="a" * 64,
            coeffect_digest=want_coeffect, nonce="ab" * 32, expiry=now + 3600, issued_at=now,
            plugin_path="plugins/example/src/index.mjs",
        )
    except CompositionRefusal as exc:
        _half = exc.code
    check(
        "aura-75 (1): a HALF-BOUND mint (path without closure) is refused by name",
        _half == "GRANT_MALFORMED",
        f"got {_half} -- a grant binding a path but not a closure reads as bound and is not",
    )

    # 3. **THE CEILING NAMES THE WEAKER TIER, WHICH IS THE POINT OF aura-75 (1).**
    check(
        "aura-75 (1): an UNBOUND grant prints GRANT_LEGACY_UNBOUND, so the weaker tier is visible",
        (ceilings_mod.legacy_unbound_line(_legacy) or "").startswith("GRANT_LEGACY_UNBOUND:"),
        f"got {ceilings_mod.legacy_unbound_line(_legacy)!r} -- a silent ACCEPT is the defect",
    )

    # 4. AND A BOUND GRANT PRINTS NOTHING, so the ceiling keeps its meaning.
    check(
        "aura-75 (1): a BOUND grant prints no legacy ceiling",
        ceilings_mod.legacy_unbound_line(_minted) is None,
        f"got {ceilings_mod.legacy_unbound_line(_minted)!r} -- a ceiling that always fires is noise",
    )

    # 5. AND THE MIGRATION STEP IS WRITTEN DOWN BESIDE THE TIER IT WOULD CLOSE.
    check(
        "aura-75 (1): the migration step is written down, with its precondition",
        "OPTIONAL_SIGNED_FIELDS" in (ceilings_mod.migration_step(_legacy) or "")
        and "precondition" in (ceilings_mod.migration_step(_legacy) or "").lower(),
        "the step that would make the fields required is not recorded",
    )

    print()
    if FAILURES:
        print(f"GRANT RULE COURT: RED — {FAILURES} of {ARMS} arms failed")
        return 1
    print(f"GRANT RULE COURT: GREEN — {ARMS}/{ARMS}")
    return 0


# ── THE MUTATION MODE: DOES THIS COURT GO RED WHEN THE BINDING IS REMOVED? ──────────────────────
# **THE THREE D3 ARMS ASSERT THAT `grant.verify` HAS A PATH INPUT AND A CLOSURE INPUT. A COURT THAT
# ASSERTS AN INTERFACE HAS NOT PROVED IT CAN FAIL** -- so `--mutate` removes each binding from
# `grant.py`, RE-RUNS THIS COURT AS A SUBPROCESS, and requires the run to go red. *Same mechanism as
# the JS courts' `tests/lib/mutate-subject.mjs`: a court binds its subject at MODULE LOAD, so a
# mutation made inside this process could not be observed by it -- **the mutation must happen BEFORE
# the court loads.***
#
# **AND THE SUBJECT IS RESTORED IN A `finally` WITH THE RESTORE ASSERTED**, because a mutation that
# leaves the tree changed is worse than no mutation at all.
MUTATIONS = (
    (
        "the PATH binding removed",
        "        if _granted_path is not None and _granted_path != want_path:",
        "        if False and _granted_path is not None and _granted_path != want_path:",
    ),
    (
        "the CLOSURE binding removed",
        "        if _granted_closure is not None and _granted_closure != want_closure:",
        "        if False and _granted_closure is not None and _granted_closure != want_closure:",
    ),
)


def mutate() -> int:
    """Remove each binding, require this court to go RED, and restore -- asserting the restore."""
    import subprocess

    subject = Path(__file__).resolve().parent / "grant.py"
    original = subject.read_bytes()
    failures = 0
    arms = 0

    for name, find, replace in MUTATIONS:
        arms += 1
        text = original.decode("utf-8")
        # **GUARD 1, THE SAME ONE THE JS HELPER CARRIES: A MUTATION THAT DID NOT APPLY PROVES NOTHING.**
        if find not in text:
            print(f"  REFUSED  {name} -- the literal is not in grant.py, so nothing was mutated")
            failures += 1
            continue
        # **GUARD 0: THE BASELINE RUNS FIRST**, so a red mutant run cannot be confused with a court
        # that was already failing.
        base = subprocess.run([sys.executable, str(Path(__file__).resolve())],
                              capture_output=True, text=True)
        if base.returncode != 0:
            print(f"  REFUSED  {name} -- the baseline run exited {base.returncode}, so a red mutant "
                  f"run could not be told from a court that was already failing")
            failures += 1
            continue
        try:
            subject.write_text(text.replace(find, replace, 1), encoding="utf-8")
            run = subprocess.run([sys.executable, str(Path(__file__).resolve())],
                                 capture_output=True, text=True)
        finally:
            subject.write_bytes(original)
            if subject.read_bytes() != original:            # **THE RESTORE IS ASSERTED.**
                print(f"  FAIL  {name} -- grant.py WAS NOT RESTORED")
                failures += 1
                continue
        caught = run.returncode != 0
        print(f"  {'ok    ' if caught else 'FAIL  '}{name} -- "
              f"{'CAUGHT' if caught else 'MISSED (the court stayed GREEN under the mutation)'}")
        if not caught:
            failures += 1

    print()
    if failures:
        print(f"GRANT RULE COURT MUTATION: RED -- {failures} of {arms} mutations were not caught")
        return 1
    print(f"GRANT RULE COURT MUTATION: GREEN -- {arms}/{arms} mutations CAUGHT")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mutate", action="store_true",
                        help="remove each D3 binding and require this court to go red")
    parser.add_argument("--verify", metavar="GRANT.json")
    parser.add_argument("--now", type=int)
    parser.add_argument("--want-coeffect")
    parser.add_argument("--sign-vector")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    if args.verify:
        if args.now is None or not args.want_coeffect:
            print("--verify requires --now and --want-coeffect", file=sys.stderr)
            return 1
        return cmd_verify(args.verify, args.now, args.want_coeffect)
    if args.sign_vector:
        if not args.out:
            print("--sign-vector requires --out", file=sys.stderr)
            return 1
        return cmd_sign_vector(args.sign_vector, args.out)
    if args.mutate:
        return mutate()
    return cmd_selfcheck()


if __name__ == "__main__":
    sys.exit(main())
