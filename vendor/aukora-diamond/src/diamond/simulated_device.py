#!/usr/bin/env python3
"""B3c — a simulated device, its reference file, and the grant bound that names it.

    python3 -m diamond.simulated_device
    python3 -m diamond.simulated_device --reference out-b3c/reference.json

SPEC. A device is three things here and nothing more: a REFERENCE FILE that states the
bounds it will act within, a KEY with which it signs a record of what it did, and a
REFUSAL VOCABULARY for the ways a physical action must not happen. Authority over it is a
grant whose signed preimage carries `referenceDigest` — the digest of that reference file —
so a grant for one reference cannot be exercised against another. Editing the reference
file changes its digest and the authority stops applying; that is the whole binding.

THIS IS A SIMULATION AND THE CODE SAYS SO ON EVERY VERDICT. It prints three ceilings:

  SIMULATED_DEVICE      the thing under test is this model, not hardware. Nothing here
                        measures a real device, and no physical claim survives the model.
  DEVICE_KEY_CLASS_B    the device's key is a software key in this process. It is class B:
                        good enough to sign a record, not a secure element, and possession
                        of the file is possession of the device's voice.
  ATTESTATION_ABSENT    nothing here proves the device is the device it says it is. The
                        reference file names a deviceId; no attestation backs that name.

SIX FAULT ARMS, BY NAME, each failing loudly if its property stops holding:

  LIMIT_EXCEEDED            a reading past the reference's limit refuses the command
  GEOFENCE_VIOLATION        a position outside the reference's fence refuses the command
  GRANT_EXPIRED             the grant's own period has passed, read by the device clock
  PHYSICAL_VARIANCE_HALT    a reading beyond the reference's tolerance HALTS the device
  PHYSICAL_VARIANCE_HALT-retry-refused
                            the halt is LATCHED: presenting valid authority again does not
                            clear it and does not act. "Try again" is the move a physical
                            fault must not reward. There is no clear path in this brick.
  envelope-edited-signature an envelope edited after signing is refused on the signature,
                            before any authority is exercised

and three arms that are not faults but are the reason the brick exists: a CONTROL that must
be accepted, REFERENCE BINDING (a grant bound to one reference is refused against another),
and DELEGATION (a child grant may pin the reference but never exchange or drop it).

TWO MORE ARMS CLOSE THE HOLES THIS BRICK ADMITTED:

  envelope-grant-mismatch   an envelope names the grant it is for, so a reused envelope plus
                            ANY OTHER grant — including one naming the same reference — is
                            refused. The envelope is no longer transferable between grants.
  halt-clearance            a latched halt has a measured way out: a NEW grant that names the
                            halt id. Naming a value that only exists after the halt is what
                            makes it new; `issuedAt` at or after the halt is checked as well,
                            because a halt id over a simulated device is predictable and a
                            grant minted in advance for a predicted halt must not clear it.
                            Clearing is itself an act: it writes a signed record naming the
                            halt it cleared, and the device has to work afterwards.

WHAT IT DOES NOT CLAIM. It does not measure a device, a sensor, a clock, or a geofence; the
telemetry is an argument, not a measurement. It does not attest anything about the device's
identity. It does not decide whether authority SHOULD be exercised — evidence never
authorizes, and grants authorize composition.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from diamond.ed25519 import keygen, public_from_seed, sign, verify
from diamond.grant import (
    GrantError,
    SIGNED_REQUIRED as GRANT_SIGNED_REQUIRED,
    check_delegation,
    delegate,
    grant_fingerprint,
    issue as issue_grant,
    to_sign_bytes as grant_sign_bytes,
)
from diamond.hexutil import from_hex, read_json, require_hex, sha256_hex, to_hex, write_json
from diamond.jcs import canonicalize_bytes
from diamond.refuse_codes import (
    DEVICE_CEILINGS,
    ENVELOPE_GRANT_MISMATCH,
    GEOFENCE_VIOLATION,
    GRANT_EXPIRED,
    GRANT_HALT_MISMATCH,
    GRANT_NOT_NEW,
    GRANT_REFERENCE_MISMATCH,
    HALT_NOT_LATCHED,
    LIMIT_EXCEEDED,
    PHYSICAL_VARIANCE_HALT,
)

REFERENCE_DOMAIN = "aukora-device-reference/v1-b3c"
ENVELOPE_KIND = "aukora-device-envelope/v1-b3c"
RECORD_KIND = "aukora-device-record/v1-b3c"
HALT_DOMAIN = "aukora-device-halt/v1-b3c"

REFERENCE_FIELDS = (
    "deviceId",
    "domain",
    "geofence",
    "maxPressure",
    "maxVariance",
    "referenceValue",
)
GEOSPACE = ("maxX", "maxY", "minX", "minY")
TELEMETRY_FIELDS = ("pressure", "value", "x", "y")
#: `grantFingerprint` is what makes an envelope ONE grant's command. It is required, not
#: optional: this envelope has no producer outside this file and no persisted instances, so
#: an envelope that does not name its grant has nothing to keep verifying. Compare the receipt
#: contract, where the closed set is shared with a frozen third party and had to stay readable
#: in both shapes — here the only two implementations are the sealer and the device below.
ENVELOPE_SIGNED = (
    "deviceId",
    "grantFingerprint",
    "issuedAt",
    "kind",
    "nonce",
    "operation",
    "referenceDigest",
    "sequence",
)
ENVELOPE_CLOSED = ENVELOPE_SIGNED + ("sig",)
#: `clear` is an operation, not a side channel: clearing a latched halt goes through the same
#: envelope, signature and binding checks as any other command, and leaves its own record.
OPS = ("actuate", "clear", "observe")
RECORD_FIELDS = (
    "code",
    "deviceId",
    "detail",
    "envelopeDigest",
    "grantFingerprint",
    "haltId",
    "issuedAt",
    "kind",
    "seq",
    "telemetryDigest",
    "verdict",
)


class DeviceError(ValueError):
    """A refusal, not a crash. `halt` marks the ones that latch the device."""

    def __init__(self, code: str, detail: str = "", *, halt: bool = False) -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
        self.halt = halt


# ── the reference file ────────────────────────────────────────────────


def make_reference(
    *,
    device_id: str,
    min_x: int = -10,
    min_y: int = -10,
    max_x: int = 10,
    max_y: int = 10,
    max_pressure: int = 100,
    reference_value: int = 50,
    max_variance: int = 5,
) -> dict:
    """The bounds the device will act within, as a closed document."""
    return {
        "deviceId": device_id,
        "domain": REFERENCE_DOMAIN,
        "geofence": {
            "maxX": int(max_x),
            "maxY": int(max_y),
            "minX": int(min_x),
            "minY": int(min_y),
        },
        "maxPressure": int(max_pressure),
        "maxVariance": int(max_variance),
        "referenceValue": int(reference_value),
    }


def check_reference(reference: dict) -> None:
    if not isinstance(reference, dict):
        raise DeviceError("reference")
    if set(reference) != set(REFERENCE_FIELDS):
        raise DeviceError("reference closed fields")
    if reference["domain"] != REFERENCE_DOMAIN:
        raise DeviceError("reference domain")
    if not isinstance(reference["deviceId"], str) or not reference["deviceId"]:
        raise DeviceError("reference deviceId")
    fence = reference["geofence"]
    if not isinstance(fence, dict) or set(fence) != set(GEOSPACE):
        raise DeviceError("reference geofence closed fields")
    for name in GEOSPACE:
        value = fence[name]
        if type(value) is bool or not isinstance(value, int):
            raise DeviceError(f"reference geofence {name}")
    if fence["minX"] >= fence["maxX"] or fence["minY"] >= fence["maxY"]:
        raise DeviceError("reference geofence is empty")
    for name in ("maxPressure", "maxVariance", "referenceValue"):
        value = reference[name]
        if type(value) is bool or not isinstance(value, int):
            raise DeviceError(f"reference {name}")
    if reference["maxVariance"] < 0:
        raise DeviceError("reference maxVariance")


def reference_digest(reference: dict) -> str:
    """The digest a grant binds. Domain included, so a bare number is not a reference."""
    check_reference(reference)
    return sha256_hex(canonicalize_bytes(reference))


def write_reference(path: Path, reference: dict) -> str:
    write_json(path, reference)
    return reference_digest(reference)


def read_reference(path: Path) -> tuple[dict, str]:
    reference = read_json(path)
    return reference, reference_digest(reference)


# ── the envelope (one command, signed by the authority) ───────────────


def envelope_sign_bytes(envelope: dict) -> bytes:
    body = {k: envelope[k] for k in ENVELOPE_SIGNED}
    return (envelope["kind"] + "\n").encode("ascii") + canonicalize_bytes(body)


def check_envelope(envelope: dict) -> None:
    if not isinstance(envelope, dict):
        raise DeviceError("envelope")
    if set(envelope) - set(ENVELOPE_CLOSED) or set(ENVELOPE_SIGNED) - set(envelope):
        raise DeviceError("envelope closed fields")
    if envelope["kind"] != ENVELOPE_KIND:
        raise DeviceError("envelope kind")
    if envelope["operation"] not in OPS:
        raise DeviceError("envelope operation")
    sequence = envelope["sequence"]
    if type(sequence) is bool or not isinstance(sequence, int) or sequence < 1:
        raise DeviceError("envelope sequence")
    issued_at = envelope["issuedAt"]
    if type(issued_at) is bool or not isinstance(issued_at, int):
        raise DeviceError("envelope issuedAt")
    require_hex(envelope["nonce"], 32)
    require_hex(envelope["referenceDigest"], 32)
    require_hex(envelope["grantFingerprint"], 32)
    require_hex(envelope["sig"], 64)
    if not isinstance(envelope["deviceId"], str) or not envelope["deviceId"]:
        raise DeviceError("envelope deviceId")


def seal_envelope(
    *,
    seed: bytes,
    device_id: str,
    operation: str,
    sequence: int,
    issued_at: int,
    nonce: str,
    reference_digest_hex: str,
    grant_fingerprint_hex: str,
) -> dict:
    """Mint one command FOR ONE GRANT. Signed with the authority's key — the grant's."""
    envelope = {
        "deviceId": device_id,
        "grantFingerprint": grant_fingerprint_hex,
        "issuedAt": int(issued_at),
        "kind": ENVELOPE_KIND,
        "nonce": nonce,
        "operation": operation,
        "referenceDigest": reference_digest_hex,
        "sequence": int(sequence),
    }
    check_envelope({**envelope, "sig": "00" * 64})
    envelope["sig"] = to_hex(sign(seed, envelope_sign_bytes(envelope)))
    return envelope


def record_sign_bytes(record: dict) -> bytes:
    body = {k: record[k] for k in RECORD_FIELDS}
    return (record["kind"] + "\n").encode("ascii") + canonicalize_bytes(body)


# ── the device ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Outcome:
    verdict: str
    code: str
    detail: str
    ceilings: tuple[str, ...]
    record: dict
    halted: bool

    def line(self) -> str:
        if self.verdict == "ACCEPT":
            return "ACCEPT"
        return f"{self.verdict} {self.code}" + (f" ({self.detail})" if self.detail else "")


class SimulatedDevice:
    """A model of a device with a reference file. Not hardware; see the ceilings."""

    def __init__(self, *, reference: dict, seed: bytes) -> None:
        self.reference = reference
        self.reference_digest = reference_digest(reference)
        self.seed = seed
        self.device_pk = public_from_seed(seed)
        self.halted = False
        #: The latched halt, and when it happened. The id is what a clearance grant names;
        #: the time is what stops an id predicted in advance from being pre-authorized.
        self.halt_id = ""
        self.halted_at = 0
        self.records: list[dict] = []

    # -- public surface -------------------------------------------------

    def execute(self, *, envelope: dict, grant: dict, telemetry: dict, now: int) -> Outcome:
        """Judge one command. Every path returns an Outcome; none of them raises."""
        try:
            verdict, code, detail = self._judge(
                envelope=envelope, grant=grant, telemetry=telemetry, now=now
            )
        except DeviceError as exc:
            outcome = "HALT" if exc.halt else "REFUSE"
            record = self._record(
                verdict=outcome, code=exc.code, detail=exc.detail, envelope=envelope,
                grant=grant, telemetry=telemetry, now=now, halt_id=self.halt_id,
            )
            if exc.halt:
                # The latch is set from the record just written, so the id an operator reads
                # out of that record is exactly the id a clearance grant has to name.
                self.halted = True
                self.halt_id = record["haltId"]
                self.halted_at = int(now)
            return Outcome(outcome, exc.code, exc.detail, DEVICE_CEILINGS, record, self.halted)
        record = self._record(
            verdict=verdict, code=code, detail=detail, envelope=envelope, grant=grant,
            telemetry=telemetry, now=now, halt_id=self.halt_id,
        )
        if verdict == "CLEARED":
            self.halted = False
            self.halt_id = ""
            self.halted_at = 0
        return Outcome(verdict, code, detail, DEVICE_CEILINGS, record, self.halted)

    # -- the checks, in the order they must happen -----------------------

    def _judge(
        self, *, envelope: dict, grant: dict, telemetry: dict, now: int
    ) -> tuple[str, str, str]:
        """Returns (verdict, code, detail); raises DeviceError for anything refused."""
        check_envelope(envelope)
        check_telemetry(telemetry)
        check_grant_for_device(grant)
        # A latched halt stops every command EXCEPT the clearance path, and which path this
        # is comes from a structurally valid envelope, before anything is decided by state.
        if envelope["operation"] == "clear":
            return self._clear(envelope=envelope, grant=grant, now=now)
        if self.halted:
            raise DeviceError(
                PHYSICAL_VARIANCE_HALT, "latched: a retry does not clear a physical halt"
            )
        self._bind(envelope=envelope, grant=grant)
        if now > int(grant["expiry"]):
            raise DeviceError(
                GRANT_EXPIRED, f"grant expired at {int(grant['expiry'])}, device clock {int(now)}"
            )
        fence = self.reference["geofence"]
        if not (fence["minX"] <= telemetry["x"] <= fence["maxX"]) or not (
            fence["minY"] <= telemetry["y"] <= fence["maxY"]
        ):
            raise DeviceError(
                GEOFENCE_VIOLATION,
                f"({telemetry['x']}, {telemetry['y']}) outside the reference fence",
            )
        if telemetry["pressure"] > self.reference["maxPressure"]:
            raise DeviceError(
                LIMIT_EXCEEDED,
                f"pressure {telemetry['pressure']} over reference max {self.reference['maxPressure']}",
            )
        variance = abs(telemetry["value"] - self.reference["referenceValue"])
        if variance > self.reference["maxVariance"]:
            raise DeviceError(
                PHYSICAL_VARIANCE_HALT,
                f"variance {variance} over reference tolerance "
                f"{self.reference['maxVariance']}",
                halt=True,
            )
        return "ACCEPT", "", ""

    def _bind(self, *, envelope: dict, grant: dict) -> None:
        """Everything that makes this envelope THIS grant's command for THIS device.

        The signature says an authority signed it; `grantFingerprint` says WHICH grant it was
        signed for. Without that field the envelope is transferable to any grant naming the
        same reference, which is a hole this brick used to have and now refuses by name.
        """
        if envelope["deviceId"] != self.reference["deviceId"]:
            raise DeviceError(
                GRANT_REFERENCE_MISMATCH,
                f"envelope names {envelope['deviceId']!r}, this device holds "
                f"{self.reference['deviceId']!r}",
            )
        governor = str(grant.get("governorPk", ""))
        if not verify(
            from_hex(governor), envelope_sign_bytes(envelope), from_hex(envelope["sig"])
        ):
            raise DeviceError("signature", "envelope does not verify under the grant's governor")
        fingerprint = grant_fingerprint(grant)
        if envelope["grantFingerprint"] != fingerprint:
            raise DeviceError(
                ENVELOPE_GRANT_MISMATCH,
                f"envelope names grant {envelope['grantFingerprint'][:16]}…, presented "
                f"{fingerprint[:16]}…",
            )
        # The reference binding: one digest, three places. The envelope claims it, the grant
        # bounds it, and the file on disk hashes to it. Any disagreement refuses the command.
        want = self.reference_digest
        bound = str(grant.get("referenceDigest", ""))
        if bound != want:
            raise DeviceError(
                GRANT_REFERENCE_MISMATCH,
                "grant bound "
                + (f"{bound[:16]}…" if bound else "no referenceDigest at all")
                + f", device holds {want[:16]}…",
            )
        if envelope["referenceDigest"] != want:
            raise DeviceError(
                GRANT_REFERENCE_MISMATCH,
                f"envelope claims {envelope['referenceDigest'][:16]}…, device holds {want[:16]}…",
            )

    def _clear(self, *, envelope: dict, grant: dict, now: int) -> tuple[str, str, str]:
        """The measured way out of a latched halt: a NEW grant that names the halt id.

        Naming it is already most of the work, because the id is derived from the halt event
        and does not exist before it. `issuedAt` is checked as well: over a simulated device
        the id is computable in advance, so a grant minted for a PREDICTED halt must not be
        the thing that clears it. Clearing is an act, and it goes through the same envelope,
        signature and binding checks as any other.
        """
        if not self.halted:
            raise DeviceError(HALT_NOT_LATCHED, "nothing is latched on this device")
        self._bind(envelope=envelope, grant=grant)
        named = str(grant.get("haltDigest", ""))
        if named != self.halt_id:
            raise DeviceError(
                GRANT_HALT_MISMATCH,
                "grant names "
                + (f"halt {named[:16]}…" if named else "no halt at all")
                + f", this device is latched on {self.halt_id[:16]}…",
            )
        if int(grant["issuedAt"]) < self.halted_at:
            raise DeviceError(
                GRANT_NOT_NEW,
                f"grant issued at {int(grant['issuedAt'])}, before the halt at "
                f"{self.halted_at}: a halt id is predictable and cannot be pre-authorized",
            )
        if now > int(grant["expiry"]):
            raise DeviceError(
                GRANT_EXPIRED, f"grant expired at {int(grant['expiry'])}, device clock {int(now)}"
            )
        return "CLEARED", "", f"cleared halt {self.halt_id[:16]}…"

    # -- what the device leaves behind -----------------------------------

    def _record(
        self, *, verdict: str, code: str, detail: str, envelope: dict, grant: dict,
        telemetry: dict, now: int, halt_id: str = "",
    ) -> dict:
        """A signed record of what happened. Signed with the class-B device key."""
        signed_body = {k: envelope[k] for k in ENVELOPE_SIGNED if k in envelope}
        envelope_digest = sha256_hex(canonicalize_bytes(signed_body))
        telemetry_digest = sha256_hex(canonicalize_bytes(telemetry))
        seq = len(self.records) + 1
        if verdict == "HALT":
            # The id an operator will name to clear this halt. Derived from the halt event,
            # so it does not exist before the halt — and computable in advance by anyone who
            # controls the telemetry, which is why `issuedAt` is checked at clearance too.
            halt_id = halt_id_for(
                device_id=self.reference["deviceId"],
                envelope_digest=envelope_digest,
                grant_fingerprint_hex=grant_fingerprint(grant),
                telemetry_digest=telemetry_digest,
                seq=seq,
                issued_at=int(now),
            )
        record = {
            "code": code,
            "deviceId": self.reference["deviceId"],
            "detail": detail,
            "envelopeDigest": envelope_digest,
            "grantFingerprint": grant_fingerprint(grant),
            "haltId": halt_id,
            "issuedAt": int(now),
            "kind": RECORD_KIND,
            "seq": seq,
            "telemetryDigest": telemetry_digest,
            "verdict": verdict,
        }
        record["sig"] = to_hex(sign(self.seed, record_sign_bytes(record)))
        self.records.append(record)
        return record


def halt_id_for(
    *, device_id: str, envelope_digest: str, grant_fingerprint_hex: str,
    telemetry_digest: str, seq: int, issued_at: int,
) -> str:
    """The name of one halt. Stable, and derived only from the event that produced it."""
    return sha256_hex(canonicalize_bytes({
        "deviceId": device_id,
        "domain": HALT_DOMAIN,
        "envelopeDigest": envelope_digest,
        "grantFingerprint": grant_fingerprint_hex,
        "issuedAt": int(issued_at),
        "seq": int(seq),
        "telemetryDigest": telemetry_digest,
    }))


def check_telemetry(telemetry: dict) -> None:
    if not isinstance(telemetry, dict) or set(telemetry) != set(TELEMETRY_FIELDS):
        raise DeviceError("telemetry closed fields")
    for name in TELEMETRY_FIELDS:
        value = telemetry[name]
        if type(value) is bool or not isinstance(value, int):
            raise DeviceError(f"telemetry {name}")


def check_grant_for_device(grant: dict) -> None:
    """The device reads a few things from a grant. A malformed one refuses; it never crashes.

    The device is not the grant court: it does not re-verify the grant's signature or its
    closed set, and saying so is the point. But it does need the signed fields to be present,
    because the fingerprint it binds an envelope to is taken over them.
    """
    if not isinstance(grant, dict):
        raise DeviceError("grant")
    missing = [name for name in GRANT_SIGNED_REQUIRED if name not in grant]
    if missing:
        raise DeviceError("grant", "missing " + ", ".join(missing))
    try:
        require_hex(grant["governorPk"], 32)
    except (TypeError, ValueError) as exc:
        raise DeviceError("grant", f"governorPk: {exc}") from exc
    for name in ("expiry", "issuedAt"):
        value = grant[name]
        if type(value) is bool or not isinstance(value, int):
            raise DeviceError("grant", name)


# ── the arms ──────────────────────────────────────────────────────────

FAILURES = 0
ARMS = 0

#: A test that stays green when its protection is removed is decoration. Each entry
#: surgically disables ONE protection in a throwaway copy of THIS file, runs its arms
#: again, and requires that run to go RED. The replacements are deliberately minimal —
#: `if False:` in front of a guard, or a condition replaced wholesale — so the mutant
#: stays parseable and the only difference is the missing protection.
MUTATIONS = (
    (
        "geofence-removed",
        '        if not (fence["minX"] <= telemetry["x"] <= fence["maxX"]) or not (\n'
        '            fence["minY"] <= telemetry["y"] <= fence["maxY"]\n'
        "        ):\n",
        "        if False:\n",
    ),
    (
        "latch-removed",
        "        if self.halted:\n",
        "        if False and self.halted:\n",
    ),
    (
        "variance-removed",
        '        if variance > self.reference["maxVariance"]:\n',
        '        if False and variance > self.reference["maxVariance"]:\n',
    ),
    (
        "reference-binding-removed",
        "        if bound != want:\n",
        "        if False and bound != want:\n",
    ),
    (
        "grant-binding-removed",
        '        if envelope["grantFingerprint"] != fingerprint:\n',
        '        if False and envelope["grantFingerprint"] != fingerprint:\n',
    ),
    (
        "halt-naming-removed",
        "        if named != self.halt_id:\n",
        "        if False and named != self.halt_id:\n",
    ),
    (
        "not-new-removed",
        '        if int(grant["issuedAt"]) < self.halted_at:\n',
        '        if False and int(grant["issuedAt"]) < self.halted_at:\n',
    ),
)


def ok(label: str, detail: str = "") -> None:
    global ARMS
    ARMS += 1
    print(f"  ok    {label}" + (f" — {detail}" if detail else ""))


def bad(label: str, detail: str = "") -> None:
    global ARMS, FAILURES
    ARMS += 1
    FAILURES += 1
    print(f"  FAIL  {label}" + (f" — {detail}" if detail else ""))


def expect(
    label: str, outcome: Outcome, *, verdict: str, code: str, ceilings: bool = True
) -> None:
    if outcome.verdict != verdict or outcome.code != code:
        bad(label, f"got {outcome.line()}, wanted {verdict} {code}".strip())
        return
    if ceilings and tuple(outcome.ceilings) != tuple(DEVICE_CEILINGS):
        bad(label, f"ceilings {outcome.ceilings}")
        return
    ok(label, outcome.line())


def run_sensitivity(tmp: Path) -> None:
    """Every fault arm must go red when its protection is deleted from a copy of this file.

    The mutant runs as a SCRIPT with this repository on PYTHONPATH, so it imports the real
    `diamond.grant` and the real refuse codes while using its own mutated device — the same
    throwaway-copy technique the court uses for its own protections. `--no-sensitivity` stops
    the mutant from mutating itself again.
    """
    source = Path(__file__).resolve().read_text()
    repo_root = str(Path(__file__).resolve().parents[1])
    for name, old, new in MUTATIONS:
        if old not in source:
            bad(f"sensitivity-{name}", "mutation target not found in this file")
            continue
        mutant = tmp / f"mutant-{name}.py"
        mutant.write_text(source.replace(old, new, 1))
        proc = subprocess.run(
            [sys.executable, str(mutant), "--out", str(tmp / f"mutant-{name}-out"),
             "--no-sensitivity"],
            capture_output=True, text=True, env={**os.environ, "PYTHONPATH": repo_root},
        )
        if proc.returncode == 0:
            bad(f"sensitivity-{name}", "protection removed and the arms stayed GREEN")
        else:
            first = next(
                (ln.strip() for ln in proc.stdout.splitlines() if ln.strip().startswith("FAIL")),
                "arms went RED",
            )
            ok(f"sensitivity-{name}", first)


def run_arms(tmp: Path, *, sensitivity: bool = True) -> int:
    print("\n— B3c: simulated device, reference file, grant bound —\n")
    now = 1_789_551_177
    device_seed, _ = keygen()
    governor_seed, governor_pk = keygen()

    reference = make_reference(device_id="sim-device-0001")
    reference_path = tmp / "reference.json"
    want_digest = write_reference(reference_path, reference)
    loaded, loaded_digest = read_reference(reference_path)
    print(f"  reference file : {reference_path}")
    print(f"  referenceDigest: {loaded_digest}")

    grant = issue_grant(
        seed=governor_seed,
        governor_pk=governor_pk,
        plugin_digest="55" * 32,
        coeffect_digest="44" * 32,
        composition_digest="66" * 32,
        subject_digest="77" * 32,
        activation_digest="88" * 32,
        operation="load",
        nonce="33" * 32,
        expiry=now + 3600,
        max_ttl=3600,
        issued_at=now,
        reference_digest=loaded_digest,
    )
    print(f"  grant          : referenceDigest {grant['referenceDigest'][:16]}… "
          f"expiry {grant['expiry']}\n")

    def envelope(**over) -> dict:
        base = dict(
            seed=governor_seed,
            device_id=loaded["deviceId"],
            operation="actuate",
            sequence=1,
            issued_at=now,
            nonce="99" * 32,
            reference_digest_hex=loaded_digest,
            grant_fingerprint_hex=grant_fingerprint(grant),
        )
        base.update(over)
        return seal_envelope(**base)

    def device() -> SimulatedDevice:
        return SimulatedDevice(reference=loaded, seed=device_seed)

    good_telemetry = {"pressure": 10, "value": 50, "x": 1, "y": 1}
    good_envelope = envelope()

    # control: the brick is not a thing that only says no.
    d = device()
    outcome = d.execute(envelope=good_envelope, grant=grant, telemetry=good_telemetry, now=now)
    expect("control", outcome, verdict="ACCEPT", code="")
    if len(d.records) == 1 and verify(
        public_from_seed(device_seed), record_sign_bytes(d.records[0]), from_hex(d.records[0]["sig"])
    ):
        ok("control-record-signed", "record verifies under the class-B device key")
    else:
        bad("control-record-signed", "record missing or does not verify")

    # LIMIT_EXCEEDED
    expect(
        "LIMIT_EXCEEDED",
        device().execute(
            envelope=good_envelope, grant=grant,
            telemetry=dict(good_telemetry, pressure=101), now=now,
        ),
        verdict="REFUSE", code=LIMIT_EXCEEDED,
    )

    # GEOFENCE_VIOLATION
    expect(
        "GEOFENCE_VIOLATION",
        device().execute(
            envelope=good_envelope, grant=grant,
            telemetry=dict(good_telemetry, x=99), now=now,
        ),
        verdict="REFUSE", code=GEOFENCE_VIOLATION,
    )

    # GRANT_EXPIRED
    expect(
        "GRANT_EXPIRED",
        device().execute(
            envelope=good_envelope, grant=grant, telemetry=good_telemetry, now=now + 3601,
        ),
        verdict="REFUSE", code=GRANT_EXPIRED,
    )

    # PHYSICAL_VARIANCE_HALT, and the same device refusing the retry.
    halted = device()
    expect(
        "PHYSICAL_VARIANCE_HALT",
        halted.execute(
            envelope=good_envelope, grant=grant,
            telemetry=dict(good_telemetry, value=90), now=now,
        ),
        verdict="HALT", code=PHYSICAL_VARIANCE_HALT,
    )
    retry = halted.execute(
        envelope=good_envelope, grant=grant, telemetry=good_telemetry, now=now,
    )
    if retry.verdict != "REFUSE" or retry.code != PHYSICAL_VARIANCE_HALT:
        bad("PHYSICAL_VARIANCE_HALT-retry-refused", f"got {retry.line()}")
    elif not halted.halted:
        bad("PHYSICAL_VARIANCE_HALT-retry-refused", "the latch cleared on retry")
    elif len(halted.records) != 2:
        bad("PHYSICAL_VARIANCE_HALT-retry-refused", "the retry left no record")
    else:
        ok("PHYSICAL_VARIANCE_HALT-retry-refused",
           "valid authority again: retry refused and the latch holds")

    # envelope edited after signing
    edited = dict(good_envelope, sequence=2)
    expect(
        "envelope-edited-signature",
        device().execute(envelope=edited, grant=grant, telemetry=good_telemetry, now=now),
        verdict="REFUSE", code="signature",
    )

    # reference binding: the file the device holds no longer hashes to the bound
    edited_reference = dict(loaded, maxVariance=99)
    edited_path = tmp / "reference-edited.json"
    write_reference(edited_path, edited_reference)
    other, other_digest = read_reference(edited_path)
    expect(
        "reference-binding",
        SimulatedDevice(reference=other, seed=device_seed).execute(
            envelope=good_envelope, grant=grant, telemetry=good_telemetry, now=now,
        ),
        verdict="REFUSE", code=GRANT_REFERENCE_MISMATCH,
    )
    if other_digest == want_digest:
        bad("reference-binding-changed-digest", "editing the reference did not change its digest")
    else:
        ok("reference-binding-changed-digest",
           f"{want_digest[:12]}… → {other_digest[:12]}…")

    # delegation: a child may pin the reference, never exchange or drop it. Exchanging is
    # refused when the child is MINTED, which is stronger than refusing it later.
    try:
        delegate(
            grant, seed=governor_seed, nonce="aa" * 32, expiry=now + 60, max_ttl=60,
            issued_at=now, reference_digest="bb" * 32,
        )
        bad("delegation-reference", "a child exchanged the bound and was minted")
    except GrantError as exc:
        if "reference" not in str(exc):
            bad("delegation-reference", str(exc))
        else:
            ok("delegation-reference", f"child cannot exchange the bound: {exc}")

    # Dropping it is not mintable either, so the child is hand-built and re-signed: the
    # only difference from a valid child is the missing bound.
    dropped = dict(delegate(
        grant, seed=governor_seed, nonce="ab" * 32, expiry=now + 60, max_ttl=60, issued_at=now,
    ))
    dropped.pop("referenceDigest", None)
    dropped["sig"] = to_hex(sign(governor_seed, grant_sign_bytes(dropped)))
    try:
        check_delegation(dropped, grant)
        bad("delegation-reference-dropped", "a child dropped the bound and was accepted")
    except GrantError as exc:
        if "reference" not in str(exc):
            bad("delegation-reference-dropped", str(exc))
        else:
            ok("delegation-reference-dropped", f"child cannot drop the bound: {exc}")

    # A grant with no reference bound at all: the device refuses rather than acting unbound.
    # The envelope is sealed FOR this grant, so the refusal is about the missing bound and
    # not about the pairing — an envelope bound to a different grant is a separate arm.
    unbound = issue_grant(
        seed=governor_seed, governor_pk=governor_pk, plugin_digest="55" * 32,
        coeffect_digest="44" * 32, composition_digest="66" * 32, subject_digest="77" * 32,
        activation_digest="88" * 32, operation="load", nonce="cc" * 32,
        expiry=now + 3600, max_ttl=3600, issued_at=now,
    )
    expect(
        "reference-unbound-refused",
        device().execute(
            envelope=seal_envelope(
                seed=governor_seed, device_id=loaded["deviceId"], operation="actuate",
                sequence=1, issued_at=now, nonce="cd" * 32,
                reference_digest_hex=loaded_digest,
                grant_fingerprint_hex=grant_fingerprint(unbound),
            ),
            grant=unbound, telemetry=good_telemetry, now=now,
        ),
        verdict="REFUSE", code=GRANT_REFERENCE_MISMATCH,
    )

    # --- the envelope belongs to ONE grant --------------------------------------------
    # A second grant naming the SAME reference. Without the pairing this envelope would be
    # transferable to it, which is the hole this arm closes.
    other_grant = issue_grant(
        seed=governor_seed, governor_pk=governor_pk, plugin_digest="55" * 32,
        coeffect_digest="44" * 32, composition_digest="66" * 32, subject_digest="77" * 32,
        activation_digest="88" * 32, operation="load", nonce="dd" * 32,
        expiry=now + 3600, max_ttl=3600, issued_at=now, reference_digest=loaded_digest,
    )
    expect(
        "envelope-grant-mismatch",
        device().execute(
            envelope=good_envelope, grant=other_grant, telemetry=good_telemetry, now=now
        ),
        verdict="REFUSE", code=ENVELOPE_GRANT_MISMATCH,
    )

    # --- the clear path out of a latched halt ------------------------------------------

    def clearance_grant(*, names_halt: str, issued_at: int, nonce: str, expiry: int) -> dict:
        return issue_grant(
            seed=governor_seed, governor_pk=governor_pk, plugin_digest="55" * 32,
            coeffect_digest="44" * 32, composition_digest="66" * 32, subject_digest="77" * 32,
            activation_digest="88" * 32, operation="load", nonce=nonce, expiry=expiry,
            max_ttl=expiry - issued_at, issued_at=issued_at,
            reference_digest=loaded_digest, halt_digest=names_halt,
        )

    def clear_envelope(g: dict, *, issued_at: int, nonce: str) -> dict:
        return seal_envelope(
            seed=governor_seed, device_id=loaded["deviceId"], operation="clear", sequence=2,
            issued_at=issued_at, nonce=nonce, reference_digest_hex=loaded_digest,
            grant_fingerprint_hex=grant_fingerprint(g),
        )

    # `halted` is the device the retry arm above left latched, so its halt is the one to clear.
    halt_id = halted.halt_id
    if halted.halted and len(halt_id) == 64 and halted.records[0]["haltId"] == halt_id:
        ok("halt-id-recorded", f"halt {halt_id[:16]}… is in the signed record")
    else:
        bad("halt-id-recorded", f"halted={halted.halted} haltId={halt_id!r}")

    clear_grant = clearance_grant(
        names_halt=halt_id or "00" * 32, issued_at=now + 1, nonce="ee" * 32, expiry=now + 3600
    )
    clear_envelope_ok = clear_envelope(clear_grant, issued_at=now + 1, nonce="ef" * 32)

    # Nothing is latched on a healthy device, so there is nothing to clear.
    expect(
        "halt-not-latched",
        device().execute(
            envelope=clear_envelope_ok, grant=clear_grant, telemetry=good_telemetry, now=now + 1
        ),
        verdict="REFUSE", code=HALT_NOT_LATCHED,
    )

    # A grant that names a different halt.
    wrong_halt_grant = clearance_grant(
        names_halt="bb" * 32, issued_at=now + 1, nonce="f0" * 32, expiry=now + 3600
    )
    expect(
        "halt-clear-grant-mismatch",
        halted.execute(
            envelope=clear_envelope(wrong_halt_grant, issued_at=now + 1, nonce="f1" * 32),
            grant=wrong_halt_grant, telemetry=good_telemetry, now=now + 1,
        ),
        verdict="REFUSE", code=GRANT_HALT_MISMATCH,
    )

    # The prediction. Over a simulated device the halt id is computable in advance, so this
    # arm computes it BEFORE the halt and mints a grant for it: naming the halt is not enough
    # on its own, and the grant has to be newer than the halt it clears.
    predicted = halt_id_for(
        device_id=loaded["deviceId"],
        envelope_digest=sha256_hex(
            canonicalize_bytes({k: good_envelope[k] for k in ENVELOPE_SIGNED})
        ),
        grant_fingerprint_hex=grant_fingerprint(grant),
        telemetry_digest=sha256_hex(canonicalize_bytes(dict(good_telemetry, value=90))),
        seq=1,
        issued_at=now,
    )
    if predicted == halt_id:
        ok("halt-id-predictable",
           "the halt id is computable in advance — which is why the next arm exists")
    else:
        bad("halt-id-predictable", f"predicted {predicted[:16]}… but the halt was {halt_id[:16]}…")
    premature = clearance_grant(
        names_halt=predicted, issued_at=now - 10, nonce="f2" * 32, expiry=now + 3600
    )
    expect(
        "halt-clear-not-new",
        halted.execute(
            envelope=clear_envelope(premature, issued_at=now + 1, nonce="f3" * 32),
            grant=premature, telemetry=good_telemetry, now=now + 1,
        ),
        verdict="REFUSE", code=GRANT_NOT_NEW,
    )

    # A new grant, issued after the halt, naming it: the halt is cleared, and the device has
    # to work afterwards or the clearance was theatre.
    cleared = halted.execute(
        envelope=clear_envelope_ok, grant=clear_grant, telemetry=good_telemetry, now=now + 1
    )
    if cleared.verdict != "CLEARED" or halted.halted or cleared.record["haltId"] != halt_id:
        bad("halt-clear-accepted",
            f"got {cleared.line()}, halted={halted.halted}, record halt "
            f"{cleared.record['haltId'][:16]}…")
    else:
        ok("halt-clear-accepted", f"{cleared.line()}; latch released and the record names it")
    expect(
        "halt-clear-device-works-after",
        halted.execute(envelope=good_envelope, grant=grant, telemetry=good_telemetry, now=now + 2),
        verdict="ACCEPT", code="",
    )

    if sensitivity:
        print("\n  — are these arms load-bearing? one protection removed at a time —")
        run_sensitivity(tmp)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="B3c simulated device — reference file, grant bound, fault arms"
    )
    parser.add_argument("--reference", help="check an existing reference file and print its digest")
    parser.add_argument("--out", help="directory for the reference file and records")
    parser.add_argument(
        "--no-sensitivity",
        action="store_true",
        help="skip the mutation check (used by the mutants themselves)",
    )
    args = parser.parse_args(argv)

    print("B3c — simulated device (see the ceilings below; this is not hardware)")
    for ceiling in DEVICE_CEILINGS:
        print(f"  CEILING: {ceiling}")

    if args.reference:
        reference, digest = read_reference(Path(args.reference))
        print(f"\n  reference deviceId: {reference['deviceId']}")
        print(f"  referenceDigest   : {digest}")
        print("\n  a grant for this device must carry exactly that referenceDigest")
        return 0

    tmp = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="b3c-"))
    tmp.mkdir(parents=True, exist_ok=True)
    run_arms(tmp, sensitivity=not args.no_sensitivity)

    print()
    if FAILURES:
        print(f"  {FAILURES} of {ARMS} arms FAILED\n\n  B3C: RED")
        return 1
    print(f"  {ARMS}/{ARMS} arms produced their published result\n\n  B3C: GREEN")
    print(
        "\n  NOTE: simulated device. The reference file, the telemetry and the clock are\n"
        "  arguments to this process, not measurements of anything. No attestation exists,\n"
        "  and the device key is class B — a file, not a secure element."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
