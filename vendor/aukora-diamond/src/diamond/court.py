"""Diamond court: both strangers, mutants, grant refuse, dual receipts,
separate-root retainer, structural mediator, atomic nonce race, signer
distinction, truncated aura, foreign smoke, patent-license strict gate,
evidence-never-authorizes, grant blast-radius (issuedAt/maxTTL issuance-
duration), activation binding, governor pin, signed checkpoints, cold
fail-closed, unload link, reconstruction-cannot-mint, Cordis ceilings.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout
from pathlib import Path

from diamond.demo import PLUGIN_BYTES, run_demo
from diamond.checkpoint import CheckpointError, sign_checkpoint, verify_checkpoint
from diamond.ed25519 import public_from_seed, rfc8032_selftest
from diamond.grant import GrantError, looks_like_receipt
from diamond.hexutil import sha256_hex, to_hex, write_json
from diamond.jcs import JCSError, canonicalize
from diamond.loader import (
    Loader,
    PLUGIN_ID,
    default_mediator,
    issue_demo_grant,
    issue_demo_patent_license,
    keygen,
    print_ceilings,
)
from diamond.mediator import CompositionError, MediatorError, MediatorProvider
from diamond.patent_license import PatentLicenseError
from diamond.receipt import (
    KIND_FIXTURE,
    KIND_LIVE,
    ReceiptError,
    issue as issue_receipt,
    verify_receipt,
)
from diamond.refuse_codes import (
    AUTHORITY_CONSUMED_EFFECT_UNKNOWN,
    CEILINGS,
    CHECKPOINT_STALE,
    DIRECT_STATE_BYPASS,
    EVIDENCE_NEVER_AUTHORIZES,
    GRANT_ACTIVATION_MISMATCH,
    GRANT_COMPOSITION_MISMATCH,
    GRANT_DELEGATION_WIDENED,
    GRANT_DEPTH_EXCEEDED,
    GRANT_GOVERNOR_MISMATCH,
    GRANT_ISSUED_IN_FUTURE,
    GRANT_NEGATIVE_LIFETIME,
    GRANT_PORTABLE_KIND,
    GRANT_REPLAYED,
    GRANT_SESSION_MISMATCH,
    GRANT_SUBJECT_MISMATCH,
    GRANT_TTL_UNBOUNDED,
    IDENTITY_BOUND_FALSE,
    INDETERMINATE,
    NAMED_REFUSALS,
    PATENT_LICENSE_REQUIRED,
    RECONSTRUCTION_CANNOT_MINT,
    ROLE_MISMATCH,
    CEILING_SUCCESSION_UNMEASURED,
    SETTLEMENT_JOURNAL_UNREADABLE,
    UNLOAD_PLUGIN_MISMATCH,
    UNLOAD_REVERTOF_REQUIRED,
    UNLOAD_REVERTOF_UNKNOWN,
    UNOWNABLE_CORE_TARGET,
)

ROOT = Path(__file__).resolve().parent.parent
VERIFY = ROOT / "vendor" / "phase0" / "verify.py"
PHASE0_COURT = ROOT / "vendor" / "phase0" / "court.py"
RFC_SEED = bytes.fromhex(
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
)


def _run(
    args: list[str],
    *,
    cwd: Path | None = None,
    env_extra: dict | None = None,
    env_override: dict | None = None,
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT)
    if env_extra:
        env.update(env_extra)
    if env_override:
        # Mutant runs must be able to point PYTHONPATH at a throwaway copy;
        # merging would silently keep importing the original repo.
        env.update(env_override)
    return subprocess.run(args, cwd=cwd or ROOT, env=env, text=True, capture_output=True)


def _fail(arm: str, detail: str) -> None:
    print(f"[court] {arm} FAIL: {detail}", file=sys.stderr)
    print("DIAMOND: RED")
    raise SystemExit(1)


def _ok(arm: str, detail: str = "ok") -> None:
    print(f"[court] {arm} ... {detail}")


def _require_rewrite_both_refusal(verdict: str, rc: int) -> None:
    if verdict != "CHECKPOINT_SIG_FAIL" or rc != 2:
        _fail("rewrite-both-unsigned", f"want sig fail got {verdict!r} rc={rc}")


def _verdict(stdout: str) -> str:
    lines = [ln.strip() for ln in stdout.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def _phase0_pair(retained: Path, presented: Path, *, mutate: bool = False):
    args = [
        sys.executable,
        str(VERIFY),
        "--retained",
        str(retained),
        "--presented",
        str(presented),
    ]
    if mutate:
        args.append("--mutate")
    r = _run(args)
    return _verdict(r.stdout), r




def _grant_parts(loader, operation: str, plugin_bytes: bytes) -> dict:
    """The two bindings every raw grant now needs: subject + composition."""
    from diamond.composition import digest as _cdigest

    return {
        "subject_digest": loader.subject_digest,
        "composition_digest": _cdigest(
            loader.composition_for(operation=operation, plugin_bytes=plugin_bytes)
        ),
    }


def _aura_head_at(aura, size: int) -> dict:
    """Observation of the log as it stood at `size` entries."""
    from diamond.aura import mth_from_entry_hashes

    if size < 1 or size > aura.size():
        raise ValueError("size out of range")
    hashes = [bytes.fromhex(rec["hash"]) for rec in aura.entries[:size]]
    return {
        "head": aura.entries[size - 1]["hash"],
        "root": to_hex(mth_from_entry_hashes(hashes)),
        "seq": size,
        "size": size,
    }


def check_checkpoint_freshness(checkpoint: dict, aura, *, expect_pk: str | None = None) -> None:
    """Signature validity, consistency and freshness are three separate things.

    A checkpoint that verifies cryptographically may still be an OLDER head.
    Valid-old state is not latest state, and reporting it as latest is the lie
    this refuses. `CHECKPOINT_STALE` is a freshness verdict, not a signature
    one.

    Scope note: this compares the observation against the CURRENT head and size
    only. It does not re-verify the Merkle consistency path — that arithmetic
    belongs to the vendored Phase 0 membrane (`vendor/phase0/verify.py`), which
    this repo already wires through `scripts/verify-pair`. Re-deriving RFC 6962
    proof inversion here would be a second implementation with no second
    witness, so it is deliberately not attempted.
    """
    verify_checkpoint(checkpoint, expect_pk=expect_pk)
    size = int(checkpoint["size"])
    current = aura.size()
    if size > current:
        raise CheckpointError(
            f"{CHECKPOINT_STALE}: checkpoint size {size} is beyond the log ({current})"
        )
    if size < current:
        raise CheckpointError(
            f"{CHECKPOINT_STALE}: size {size} is behind the log ({current})"
        )
    if checkpoint["head"] != aura.head():
        raise CheckpointError(f"{CHECKPOINT_STALE}: head is not the current head")
    if checkpoint["root"] != aura.root():
        raise CheckpointError(f"{CHECKPOINT_STALE}: root is not the current root")


def _redteam_codes(root: Path) -> set[str]:
    # Codes carry camelCase segments (`revertOf-required`), so the class must
    # include uppercase or the checker silently truncates them.
    text = (root / "REDTEAM.md").read_text()
    return set(re.findall(r"[A-Za-z][A-Za-z0-9-]*:[A-Za-z0-9-]+", text))


#: The forbidden claim, assembled so this file never contains the phrase as a
#: literal. A scanner that matches its own source reports itself, which is a
#: false positive that trains people to ignore the check.
FORBIDDEN_OBSERVER_CLAIM = "SURVIVES" + " observer"
#: The text form the code would have to emit to make that claim.
FORBIDDEN_EMIT = "SURVIV" + "ES observer"


def _is_prohibition(text: str) -> bool:
    lowered = text.lower()
    return any(
        word in lowered
        for word in ("never", "not ", "no ", "must", "claim", "prohibit", "forbid")
    )


def check_claim_integrity(root: Path) -> None:
    """Docs cannot quote nonexistent codes, or assert the forbidden claim.

    A named refusal in REDTEAM.md must exist in refuse_codes.py, or the doc is
    describing a protection the code does not have. And no executable path may
    emit the observer-survival claim.
    """
    codes = _redteam_codes(root)
    for code in sorted(codes):
        if code not in NAMED_REFUSALS:
            raise SystemExit(
                f"claim-integrity: REDTEAM.md quotes {code!r} which is not in "
                f"diamond/refuse_codes.py NAMED_REFUSALS"
            )
    for path in sorted(root.glob("diamond/*.py")) + sorted(root.glob("scripts/*.sh")):
        body = path.read_text()
        for lineno, line in enumerate(body.splitlines(), start=1):
            if FORBIDDEN_OBSERVER_CLAIM not in line:
                continue
            if _is_prohibition(line) or "join" in line:
                continue
            raise SystemExit(
                f"claim-integrity: {path.name}:{lineno} emits the survival claim"
            )
    for path in sorted(root.glob("*.md")):
        for lineno, line in enumerate(path.read_text().splitlines(), start=1):
            if FORBIDDEN_OBSERVER_CLAIM not in line:
                continue
            if _is_prohibition(line):
                continue
            raise SystemExit(
                f"claim-integrity: {path.name}:{lineno} asserts the survival claim"
            )


def check_ceiling_presence(root: Path) -> None:
    """Mandatory ceilings cannot silently disappear from the printed set."""
    from diamond.refuse_codes import CEILINGS as CODES

    if tuple(CODES) != tuple(CEILINGS):
        raise SystemExit("ceiling-presence: CEILINGS tuple drifted from import")
    for ceiling in CEILINGS:
        if not ceiling:
            raise SystemExit("ceiling-presence: empty ceiling name")
    text = (root / "CEILINGS.md").read_text()
    for ceiling in CEILINGS:
        if ceiling not in text:
            raise SystemExit(f"ceiling-presence: {ceiling} missing from CEILINGS.md")
    for label in (IDENTITY_BOUND_FALSE, UNOWNABLE_CORE_TARGET):
        if label not in text:
            raise SystemExit(f"ceiling-presence: {label} missing from CEILINGS.md")


# ── Sensitivity mutants ───────────────────────────────────────────────
# A test that stays green when its protection is removed is decoration.
# Each mutant surgically removes ONE protection in a throwaway copy of the
# repo, then re-runs the court witness. The mutant MUST go RED.
COURT_WITNESS = "diamond.court"
MUTANTS: tuple[tuple[str, str, str, str], ...] = (
    (
        "subject-binding",
        "diamond/grant.py",
        "        if not hmac.compare_digest(str(grant[\"subjectDigest\"]), str(want_subject)):\n"
        "            raise GrantError(GRANT_SUBJECT_MISMATCH)\n",
        "        pass\n",
    ),
    (
        "composition-binding",
        "diamond/grant.py",
        "        if not hmac.compare_digest(\n"
        "            str(grant[\"compositionDigest\"]), str(want_composition)\n"
        "        ):\n"
        "            raise GrantError(GRANT_COMPOSITION_MISMATCH)\n",
        "        pass\n",
    ),
    (
        "delegation-monotonic",
        "diamond/grant.py",
        "    if widened is not None:\n"
        "        raise GrantError(f\"{GRANT_DELEGATION_WIDENED}: {widened}\")\n",
        "    pass\n",
    ),
    (
        "portable-kind",
        "diamond/grant.py",
        "        if \"portable\" in extra:\n"
        "            raise GrantError(GRANT_PORTABLE_KIND)\n",
        "        pass\n",
    ),
    (
        # Attack the protection itself, not one of its call sites: neutering
        # the function is what "the protection is gone" actually means.
        "mediator-integrity",
        "diamond/mediator.py",
        "def verify_mediator_integrity(mediator: object) -> None:",
        "def verify_mediator_integrity(mediator: object) -> None:\n"
        "    return None  # MUTANT: protection removed",
    ),
)


def run_sensitivity_mutants(root: Path) -> dict:
    """Return {mutant: went_red}. Every value must be True.

    A mutant runs the court on a throwaway copy. That inner run must NOT
    recurse into mutation testing, so it is marked by AUKORA_MUTANT and the
    mutant block is skipped there (see main).
    """
    if os.environ.get("AUKORA_MUTANT"):
        return {}
    if os.environ.get("AUKORA_COURT_SKIP_MUTANTS"):
        # Explicit opt-out used by stranger-demo.sh, which re-runs this court
        # after the seal. CI and ./scripts/diamond.sh do NOT set this.
        return {}
    results: dict = {}
    for name, rel, old, new in MUTANTS:
        work = Path(tempfile.mkdtemp(prefix=f"aukora-mutant-{name}-"))
        try:
            shutil.copytree(
                root,
                work / "repo",
                ignore=shutil.ignore_patterns(".venv", ".git", "out", "__pycache__"),
            )
            target = work / "repo" / rel
            body = target.read_text()
            if old not in body:
                raise SystemExit(
                    f"sensitivity-mutants: {name} anchor not found in {rel} "
                    "(a protection was renamed without updating its mutant)"
                )
            target.write_text(body.replace(old, new, 1))
            r = _run(
                [sys.executable, "-m", COURT_WITNESS],
                cwd=work / "repo",
                env_override={
                    "PYTHONPATH": str(work / "repo"),
                    "AUKORA_MUTANT": name,
                },
            )
            results[name] = r.returncode != 0
            if r.returncode == 0:
                print(
                    f"[court]   mutant {name}: court stayed GREEN",
                    file=sys.stderr,
                )
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return results


def main() -> int:
    rfc8032_selftest()
    _ok("ed25519 RFC 8032")

    r = _run([sys.executable, str(VERIFY), "--selftest"])
    if r.returncode != 0:
        _fail("phase0 --selftest", r.stderr or r.stdout)
    if "selftest: ok" not in r.stdout:
        _fail("phase0 --selftest", "missing selftest: ok")
    _ok("phase0 --selftest")

    if PHASE0_COURT.is_file():
        tour = _run([sys.executable, str(PHASE0_COURT)])
        if tour.returncode != 0 or "PHASE0: GREEN" not in tour.stdout:
            _fail("phase0 court", tour.stderr or tour.stdout)
        _ok("phase0 court", "GREEN")
    else:
        _fail("phase0 court", "court.py absent")

    if canonicalize({"b": 1, "a": 2}) != '{"a":2,"b":1}':
        _fail("jcs", "key order")
    try:
        canonicalize({"x": 1.5})
        _fail("jcs float refuse", "float accepted")
    except JCSError:
        pass
    _ok("jcs integer-only", "floats refused")

    # Structural mediator: construct without provider must fail.
    try:
        Loader(Path(tempfile.mkdtemp(prefix="aukora-nomed-")), mediator=None)
        _fail("mediator-required", "Loader accepted mediator=None")
    except CompositionError as exc:
        if "MEDIATOR_REQUIRED" not in str(exc):
            _fail("mediator-required", str(exc))
    _ok("mediator-required", "CompositionError")

    tmp = Path(tempfile.mkdtemp(prefix="aukora-toy-"))
    b_root = Path(tempfile.mkdtemp(prefix="aukora-retainer-B-"))
    try:
        with redirect_stdout(io.StringIO()):
            demo = run_demo(tmp, retainer_b_root=b_root)
        retained = tmp / "retained.json"
        presented = tmp / "presented.json"
        retainer_b = Path(demo["retainerB"])

        if not (tmp / "issuer.pk").is_file() or not (tmp / "governor.pk").is_file():
            _fail("public keys", "issuer.pk / governor.pk missing next to receipts")
        _ok("public keys", "issuer.pk + governor.pk")

        if not retainer_b.is_file():
            _fail("separate-root retainer write", f"missing {retainer_b}")
        # Must be a different root than A's out dir.
        if retainer_b.resolve().parent == retained.resolve().parent:
            _fail("separate-root retainer", "A and B share the same directory")
        if b_root.resolve() != retainer_b.resolve().parent:
            _fail("separate-root retainer", "B not under requested retainer-b-root")
        _ok("separate-root retainer write", f"B under {b_root.name}")

        verdict, r = _phase0_pair(retained, presented)
        if verdict != "APPEND_ONLY":
            _fail("APPEND_ONLY", f"got {verdict!r} rc={r.returncode} {r.stderr}")
        _ok("APPEND_ONLY 3→5", "APPEND_ONLY")

        verdict, r = _phase0_pair(retained, presented, mutate=True)
        if verdict != "OBSERVATION_CONFLICT":
            _fail("CONFLICT mutant", f"got {verdict!r} rc={r.returncode} {r.stderr}")
        _ok("CONFLICT mutant", "OBSERVATION_CONFLICT")

        for label, path in (("A", retained), ("B", retainer_b)):
            verdict, r = _phase0_pair(path, presented)
            if verdict != "APPEND_ONLY":
                _fail(f"separate-root {label}", f"got {verdict!r} rc={r.returncode}")
        _ok("separate-root both", "A+B APPEND_ONLY (different roots)")

        a_obj = json.loads(retained.read_text(encoding="utf-8"))
        root = a_obj.get("root")
        if not isinstance(root, str) or len(root) < 1:
            _fail("separate-root mutate-A", "retained.root missing")
        flipped = "0" if root[-1] != "0" else "1"
        a_obj["root"] = root[:-1] + flipped
        write_json(retained, a_obj)

        verdict_a, r_a = _phase0_pair(retained, presented)
        if verdict_a != "OBSERVATION_CONFLICT":
            _fail(
                "separate-root mutate-A",
                f"A want OBSERVATION_CONFLICT got {verdict_a!r} rc={r_a.returncode}",
            )
        verdict_b, r_b = _phase0_pair(retainer_b, presented)
        if verdict_b != "APPEND_ONLY":
            _fail(
                "separate-root mutate-A",
                f"B want APPEND_ONLY got {verdict_b!r} rc={r_b.returncode}",
            )
        _ok("separate-root mutate-A", "A CONFLICT / B APPEND_ONLY")

        plugin = tmp / "plugin-src.bin"
        plugin.write_bytes(PLUGIN_BYTES)
        refuse = _run(
            [
                sys.executable,
                "-m",
                "diamond.loader",
                "--out",
                str(tmp / "refuse"),
                "activate",
                "--operation",
                "load",
                "--plugin",
                str(plugin),
            ]
        )
        if refuse.returncode == 0 or "REFUSE" not in (refuse.stderr + refuse.stdout):
            _fail("refuse-without-grant", refuse.stderr or refuse.stdout)
        if "BOOTSTRAP_UNGATED" not in refuse.stdout or "SAME_UID" not in refuse.stdout:
            _fail("refuse-without-grant", "ceilings missing")
        _ok("refuse-without-grant", "REFUSE")

        # Replay of the spent load grant must refuse (atomic store).
        replay = Loader(tmp, mediator=default_mediator())
        try:
            with redirect_stdout(io.StringIO()):
                replay.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=json.loads((tmp / "grant-load.json").read_text()),
                )
            _fail("grant one-use", "replay accepted")
        except GrantError as exc:
            msg = str(exc).lower()
            if "replay" not in msg and "grant:replayed" not in msg:
                _fail("grant one-use", str(exc))
        _ok("grant one-use", "replay refused")

        fixture = issue_receipt(
            seed=RFC_SEED,
            issuer_pk=public_from_seed(RFC_SEED),
            kind=KIND_FIXTURE,
            issued_at=1,
            nonce="11" * 32,
            aura={
                "entryHash": "22" * 32,
                "head": "22" * 32,
                "prevHash": "00" * 32,
                "root": "33" * 32,
                "seq": 1,
                "size": 1,
            },
            composition={
                "coeffectEnvelopeDigest": "44" * 32,
                "compositionDigest": "66" * 32,
                "operation": "load",
                "pluginDigest": "55" * 32,
                "pluginId": "fixture-echo",
                "revertOf": "",
                "subjectDigest": "77" * 32,
            },
        )
        fixture_path = tmp / "receipt-fixture.json"
        write_json(fixture_path, fixture)
        approval, conformance = verify_receipt(fixture)
        if (approval, conformance) != ("fixture", "FIXTURE"):
            _fail("fixture kind", f"{approval} {conformance}")
        _ok("fixture kind", "FIXTURE")

        mutated = json.loads((tmp / "receipt-load.json").read_text())
        mutated["alg"] = "Ed25519"
        try:
            verify_receipt(mutated)
            _fail("no-alg", "alg field accepted")
        except ReceiptError as exc:
            if "alg" not in str(exc).lower():
                _fail("no-alg", str(exc))
            _ok("no-alg", "refused")

        base = json.loads((tmp / "receipt-load.json").read_text())
        for field in ("owner", "identity", "did"):
            forged = dict(base)
            forged[field] = "did:example:forged"
            try:
                verify_receipt(forged)
                _fail(f"identity-refuse-{field}", f"{field} accepted as authority")
            except ReceiptError as exc:
                msg = str(exc).lower()
                if field not in msg and "closed" not in msg and "identity" not in msg:
                    _fail(f"identity-refuse-{field}", str(exc))
            _ok(f"identity-refuse-{field}", "refused")

        # Mediator disable then activate → MEDIATOR_OFF before grant path.
        med = MediatorProvider(enabled=True)
        off_dir = tmp / "mediator-off"
        keygen(off_dir)
        off = Loader(off_dir, mediator=med)
        med.disable()
        fresh = issue_demo_grant(off, "load", PLUGIN_BYTES, int(time.time()) + 3600)
        try:
            with redirect_stdout(io.StringIO()):
                off.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=fresh,
                )
            _fail("mediator-off", "activate accepted with mediator disabled")
        except MediatorError as exc:
            if "MEDIATOR_OFF" not in str(exc):
                _fail("mediator-off", str(exc))
        except GrantError as exc:
            _fail("mediator-off", f"reached grant path: {exc}")
        _ok("mediator-off", "MEDIATOR_OFF before grant")

        # Remove sole provider → same refusal.
        med2 = MediatorProvider(enabled=True)
        rem_dir = tmp / "mediator-removed"
        keygen(rem_dir)
        rem = Loader(rem_dir, mediator=med2)
        med2.remove()
        fresh2 = issue_demo_grant(rem, "load", PLUGIN_BYTES, int(time.time()) + 3600)
        # issue_demo_grant doesn't need mediator; activate must refuse.
        try:
            with redirect_stdout(io.StringIO()):
                rem.activate(operation="load", plugin_bytes=PLUGIN_BYTES, grant=fresh2)
            _fail("mediator-removed", "activate accepted after remove()")
        except MediatorError as exc:
            if "MEDIATOR_OFF" not in str(exc):
                _fail("mediator-removed", str(exc))
        _ok("mediator-removed", "MEDIATOR_OFF")

        bad_grant = json.loads((tmp / "grant-unload.json").read_text())
        bad_grant["extra"] = "nope"
        unk_dir = tmp / "unknown-field"
        keygen(unk_dir)
        try:
            with redirect_stdout(io.StringIO()):
                Loader(unk_dir, mediator=default_mediator()).activate(
                    operation="unload",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=bad_grant,
                )
            _fail("grant-unknown-field", "accepted")
        except GrantError as exc:
            if "closed" not in str(exc).lower():
                _fail("grant-unknown-field", str(exc))
        _ok("grant-unknown-field", "refused")

        bare_dir = tmp / "unload-bare"
        keygen(bare_dir)
        bare = Loader(bare_dir, mediator=default_mediator())
        ug = issue_demo_grant(bare, "unload", PLUGIN_BYTES, int(time.time()) + 3600)
        try:
            with redirect_stdout(io.StringIO()):
                bare.activate(operation="unload", plugin_bytes=PLUGIN_BYTES, grant=ug)
            _fail("unload-without-load", "accepted")
        except GrantError as exc:
            if "nothing loaded" not in str(exc).lower():
                _fail("unload-without-load", str(exc))
        _ok("unload-without-load", "refused")

        # ── Evidence never authorizes: valid receipt ≠ grant ──────────
        receipt_as_grant = json.loads((tmp / "receipt-load.json").read_text())
        if not looks_like_receipt(receipt_as_grant):
            _fail("evidence-never-authorizes", "fixture receipt not receipt-shaped")
        ev_dir = tmp / "evidence-auth"
        keygen(ev_dir)
        ev = Loader(ev_dir, mediator=default_mediator())
        try:
            with redirect_stdout(io.StringIO()):
                ev.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=receipt_as_grant,
                )
            _fail("evidence-never-authorizes", "receipt accepted as grant")
        except GrantError as exc:
            if EVIDENCE_NEVER_AUTHORIZES not in str(exc):
                _fail("evidence-never-authorizes", str(exc))
        # Same receipt still cold-verifies (verify ≠ activate).
        cv = _run(
            [
                sys.executable,
                "-m",
                "diamond.cold_verify",
                str(tmp / "receipt-load.json"),
                "--pub",
                str(tmp / "issuer.pk"),
            ]
        )
        if cv.returncode != 0 or "SIGNATURE_VALID" not in cv.stdout:
            _fail("evidence-never-authorizes", "receipt verify should still pass")
        _ok("evidence-never-authorizes", "receipt≠grant; verify≠activate")

        # ── Grant blast-radius: issuance-duration (issuedAt/maxTTL) ───
        ttl_dir = tmp / "grant-ttl"
        keygen(ttl_dir)
        ttl_loader = Loader(ttl_dir, mediator=default_mediator())
        now_ttl = int(time.time())
        # expiry - issuedAt > maxTTL → grant:ttl-unbounded
        unbounded = issue_demo_grant(
            ttl_loader,
            "load",
            PLUGIN_BYTES,
            now_ttl + 7200,
            max_ttl=60,
            issued_at=now_ttl,
        )
        try:
            with redirect_stdout(io.StringIO()):
                ttl_loader.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=unbounded,
                    now=now_ttl,
                )
            _fail("grant-ttl-unbounded", "far expiry accepted")
        except GrantError as exc:
            if GRANT_TTL_UNBOUNDED not in str(exc):
                _fail("grant-ttl-unbounded", str(exc))
        _ok("grant-ttl-unbounded", "refused")

        # ── Grant blast-radius: maxDepth (default 1) ──────────────────
        depth_dir = tmp / "grant-depth"
        keygen(depth_dir)
        depth_loader = Loader(depth_dir, mediator=default_mediator())
        depth_grant = issue_demo_grant(
            depth_loader,
            "load",
            PLUGIN_BYTES,
            now_ttl + 600,
            max_ttl=3600,
            max_depth=1,
        )
        try:
            with redirect_stdout(io.StringIO()):
                depth_loader.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=depth_grant,
                    depth=2,  # child-style beyond maxDepth
                )
            _fail("grant-depth-exceeded", "depth>maxDepth accepted")
        except GrantError as exc:
            if GRANT_DEPTH_EXCEEDED not in str(exc):
                _fail("grant-depth-exceeded", str(exc))
        _ok("grant-depth-exceeded", "child-style refused")

        # ── Reconstruction cannot mint authority ─────────────────────
        recon_dir = tmp / "recon-mint"
        keygen(recon_dir)
        recon = Loader(recon_dir, mediator=default_mediator())
        good = issue_demo_grant(recon, "load", PLUGIN_BYTES, now_ttl + 600)
        for field in ("recommendation", "evidence", "receipt", "confidence", "majority"):
            try:
                with redirect_stdout(io.StringIO()):
                    recon.activate(
                        operation="load",
                        plugin_bytes=PLUGIN_BYTES,
                        grant=good,
                        **{field: {"advisory": True}},
                    )
                _fail(f"reconstruction-{field}", f"{field} accepted as authority")
            except GrantError as exc:
                msg = str(exc)
                if RECONSTRUCTION_CANNOT_MINT not in msg or field not in msg:
                    _fail(f"reconstruction-{field}", str(exc))
            _ok(f"reconstruction-{field}", "refused")
        # Closed-schema: field stuffed onto grant object
        stuffed = dict(good)
        stuffed["recommendation"] = {"score": 1}
        try:
            with redirect_stdout(io.StringIO()):
                recon.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=stuffed,
                )
            _fail("reconstruction-grant-field", "recommendation on grant accepted")
        except GrantError as exc:
            if RECONSTRUCTION_CANNOT_MINT not in str(exc):
                _fail("reconstruction-grant-field", str(exc))
        _ok("reconstruction-grant-field", "refused")

        # ── Honest ceilings / doctrine labels on activate ─────────────
        ceil_dir = tmp / "ceilings-print"
        keygen(ceil_dir)
        ceil_out = io.StringIO()
        with redirect_stdout(ceil_out):
            try:
                Loader(ceil_dir, mediator=default_mediator()).activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=None,
                )
            except GrantError:
                pass
        printed = ceil_out.getvalue()
        for needle in (
            "CEILING: BOOTSTRAP_UNGATED",
            "CEILING: SAME_UID",
            f"CEILING: {CEILING_SUCCESSION_UNMEASURED}",
            IDENTITY_BOUND_FALSE,
            UNOWNABLE_CORE_TARGET,
        ):
            if needle not in printed:
                _fail("ceilings-doctrine", f"missing {needle}")
        if "SURVIVES" in printed:
            _fail("ceilings-doctrine", "must not claim SURVIVES observer")
        _ok("ceilings-doctrine", "SUCCESSION_UNMEASURED + identityBound:false")

        # Cold verify WITH --pub → SIGNER_KEY_MATCHED
        for name in ("receipt-load.json", "receipt-unload.json"):
            r = _run(
                [
                    sys.executable,
                    "-m",
                    "diamond.cold_verify",
                    str(tmp / name),
                    "--pub",
                    str(tmp / "issuer.pk"),
                ]
            )
            if r.returncode != 0:
                _fail(f"cold {name}", r.stderr or r.stdout)
            out = r.stdout
            if "SIGNATURE_VALID" not in out:
                _fail(f"cold {name}", "missing SIGNATURE_VALID")
            if "SIGNER_KEY_MATCHED" not in out:
                _fail(f"cold {name}", "missing SIGNER_KEY_MATCHED")
            if "CLASS: unattributed" not in out:
                _fail(f"cold {name}", out)
            if "CONFORMANCE: NON-CONFORMING" not in out:
                _fail(f"cold {name}", out)
            if "CONFORMING" in out.replace("NON-CONFORMING", ""):
                _fail(f"cold {name}", "claimed CONFORMING")
            if "CONSISTENCY_UNCHECKED" not in out:
                _fail(f"cold {name}", "missing CONSISTENCY_UNCHECKED")
            if "ATTENDANCE: reported-not-proven" not in out:
                _fail(f"cold {name}", "missing ATTENDANCE reported-not-proven")
            _ok(f"cold {name}", "KEY_MATCHED unattributed NON-CONFORMING")

        # Cold verify WITHOUT --pub → fail closed (unless --allow-unanchored)
        r = _run(
            [
                sys.executable,
                "-m",
                "diamond.cold_verify",
                str(tmp / "receipt-load.json"),
            ]
        )
        if r.returncode == 0:
            _fail("cold fail-closed", "accepted without --pub/--trust-anchors")
        if "fail-closed" not in (r.stderr or "").lower() and "REFUSE" not in (r.stderr or ""):
            # still ok if any refuse message
            if r.returncode == 0:
                _fail("cold fail-closed", r.stderr or r.stdout)
        _ok("cold fail-closed", "refused without anchor")
        r = _run(
            [
                sys.executable,
                "-m",
                "diamond.cold_verify",
                str(tmp / "receipt-load.json"),
                "--allow-unanchored",
            ]
        )
        if r.returncode != 0:
            _fail("cold allow-unanchored", r.stderr or r.stdout)
        if "SIGNER_IDENTITY_UNANCHORED" not in r.stdout:
            _fail("cold allow-unanchored", r.stdout)
        if "SIGNER_KEY_MATCHED" in r.stdout:
            _fail("cold allow-unanchored", "implied trusted signer")
        _ok("cold allow-unanchored", "SIGNER_IDENTITY_UNANCHORED")

        # Truncated / corrupt aura JSONL → refuse (never silent fake history).
        from diamond.aura import Aura

        trunc_dir = tmp / "aura-trunc"
        trunc_dir.mkdir(parents=True, exist_ok=True)
        aura_path = trunc_dir / "aura.jsonl"
        # Write one good line then a truncated partial line (no trailing newline).
        good = Aura(aura_path)
        good.append({"kind": "session-open"})
        # Corrupt: append truncated bytes without newline.
        with aura_path.open("ab") as fh:
            fh.write(b'{"seq":2,"prev":"aa","body":{"k":')
        try:
            Aura(aura_path)
            _fail("aura-truncated", "loaded truncated jsonl silently")
        except ValueError as exc:
            msg = str(exc).lower()
            if "undetermined" not in msg and "truncat" not in msg and "corrupt" not in msg:
                _fail("aura-truncated", str(exc))
        _ok("aura-truncated", "refused UNDETERMINED")

        # Mid-file corrupt (valid newline but bad JSON).
        corrupt_path = trunc_dir / "aura-corrupt.jsonl"
        corrupt_path.write_text(
            aura_path.read_bytes().split(b"\n")[0].decode("utf-8")
            + "\n"
            + "{not-json\n",
            encoding="utf-8",
        )
        # First line alone would be ok but second is corrupt — rewrite properly:
        first_line = good.entries[0]
        # Re-read from a fresh good aura file then corrupt mid-file.
        good2_path = trunc_dir / "aura-good2.jsonl"
        g2 = Aura(good2_path)
        g2.append({"kind": "a"})
        g2.append({"kind": "b"})
        lines = good2_path.read_text(encoding="utf-8").splitlines()
        lines[1] = "{broken"
        good2_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            Aura(good2_path)
            _fail("aura-corrupt", "loaded corrupt jsonl silently")
        except ValueError as exc:
            if "corrupt" not in str(exc).lower() and "undetermined" not in str(exc).lower():
                _fail("aura-corrupt", str(exc))
        _ok("aura-corrupt", "refused")

        # Cross-process atomic nonce race: two processes, one grant → 1 ok + 1 replayed.
        race_dir = tmp / "nonce-race"
        keygen(race_dir)
        race_loader = Loader(race_dir, mediator=default_mediator())
        race_grant = issue_demo_grant(
            race_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        grant_path = race_dir / "grant-load.json"
        plugin_path = race_dir / "plugin-src.bin"
        plugin_path.write_bytes(PLUGIN_BYTES)
        # Use subprocess workers (true separate processes).
        results = []
        procs = []
        for i in range(2):
            p = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    (
                        "import json,sys,io\n"
                        "from contextlib import redirect_stdout\n"
                        "from pathlib import Path\n"
                        f"sys.path.insert(0, {str(ROOT)!r})\n"
                        "from diamond.loader import Loader, default_mediator\n"
                        "from diamond.grant import GrantError\n"
                        f"out=Path({str(race_dir)!r})\n"
                        f"grant=json.loads(Path({str(grant_path)!r}).read_text())\n"
                        f"plugin=Path({str(plugin_path)!r}).read_bytes()\n"
                        "try:\n"
                        "  loader=Loader(out, mediator=default_mediator())\n"
                        "  with redirect_stdout(io.StringIO()):\n"
                        "    loader.activate(operation='load', plugin_bytes=plugin, grant=grant)\n"
                        "  print('ok')\n"
                        "except GrantError as e:\n"
                        "  s=str(e)\n"
                        "  print('grant:replayed' if 'replay' in s.lower() else 'grant:'+s)\n"
                    ),
                ],
                cwd=str(ROOT),
                env={**os.environ, "PYTHONPATH": str(ROOT)},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            procs.append(p)
        for p in procs:
            out, err = p.communicate(timeout=30)
            line = (out or "").strip().splitlines()
            results.append(line[-1] if line else f"empty rc={p.returncode} err={err}")
        oks = sum(1 for x in results if x == "ok")
        replays = sum(1 for x in results if x == "grant:replayed")
        if oks != 1 or replays != 1:
            _fail("nonce-race", f"want 1 ok + 1 grant:replayed, got {results}")
        _ok("nonce-race", "1 ok / 1 grant:replayed")

        # Cold-reopen state root (REDTEAM row 25): load-only race → exactly one
        # composition settlement, one active plugin, one spent nonce, valid head,
        # zero second effect from the losing process.
        from diamond.aura import Aura
        from diamond.loader import plugin_digest as _plugin_digest

        cold_aura = Aura(race_dir / "aura.jsonl")
        _ = cold_aura.head()
        _ = cold_aura.root()
        compositions = [
            e
            for e in cold_aura.entries
            if isinstance(e.get("body"), dict) and e["body"].get("kind") == "composition"
        ]
        load_effects = [e for e in compositions if e["body"].get("operation") == "load"]
        if len(compositions) != 1 or len(load_effects) != 1:
            _fail(
                "nonce-race-settle",
                f"want 1 composition/load settlement, got compositions={len(compositions)} loads={len(load_effects)} size={cold_aura.size()}",
            )
        if cold_aura.size() != 1:
            _fail(
                "nonce-race-settle",
                f"second effect / forked settled state: aura size={cold_aura.size()} (want 1)",
            )
        cold = Loader(race_dir, mediator=default_mediator())
        active = cold.state.get("active")
        if not active:
            _fail("nonce-race-settle", "no active plugin after load-only race")
        want_digest = _plugin_digest(PLUGIN_BYTES)
        if active.get("pluginDigest") != want_digest:
            _fail("nonce-race-settle", f"active digest mismatch: {active}")
        if not (race_dir / "plugin.bin").exists():
            _fail("nonce-race-settle", "plugin.bin missing after winner load")
        spent_dir = race_dir / "spent-nonces"
        spent_files = sorted(spent_dir.glob("*.spent")) if spent_dir.exists() else []
        if len(spent_files) != 1:
            _fail(
                "nonce-race-settle",
                f"want exactly 1 spent nonce, got {len(spent_files)}: {[p.name for p in spent_files]}",
            )
        if spent_files[0].name != f"{race_grant['nonce']}.spent":
            _fail(
                "nonce-race-settle",
                f"spent nonce file {spent_files[0].name} != grant nonce",
            )
        if not (race_dir / "receipt-load.json").exists():
            _fail("nonce-race-settle", "receipt-load.json missing from winner")
        # Loser must not have left a divergent second receipt artifact under another name.
        load_receipts = list(race_dir.glob("receipt-load*.json"))
        if len(load_receipts) != 1:
            _fail(
                "nonce-race-settle",
                f"want 1 load receipt file, got {[p.name for p in load_receipts]}",
            )
        # Re-open aura via a second Loader to confirm chain still verifies.
        reopen = Loader(race_dir, mediator=default_mediator())
        if reopen.aura.size() != 1 or reopen.aura.head() != cold_aura.head():
            _fail("nonce-race-settle", "cold reopen aura head diverged")
        _ok(
            "nonce-race-settle",
            "1 composition / 1 active / 1 spent / valid head / no loser effect",
        )

        # Foreign cold verify load receipt (second implementation smoke).
        fr = _run(
            [
                sys.executable,
                "-m",
                "foreign.verify_receipt",
                str(tmp / "receipt-load.json"),
                "--pub",
                str(tmp / "issuer.pk"),
            ]
        )
        if fr.returncode != 0:
            _fail("foreign cold verify load receipt", fr.stderr or fr.stdout)
        if "FOREIGN: SIGNATURE_VALID" not in fr.stdout:
            _fail("foreign cold verify load receipt", fr.stdout)
        if "FOREIGN: SIGNER_KEY_MATCHED" not in fr.stdout:
            _fail("foreign cold verify load receipt", fr.stdout)
        if "unattributed" not in fr.stdout:
            _fail("foreign cold verify load receipt", fr.stdout)
        _ok("foreign cold verify load receipt", "second implementation smoke")

        # Optional foreign Phase 0 equal-size smoke on A after we mutated root —
        # use presented vs a fresh equal-size check on B's retained size match.
        # Restore: B retained vs presented is growth; foreign returns UNDETERMINED
        # for growth. Equal-size smoke: same file twice → APPEND_ONLY.
        fp = _run(
            [
                sys.executable,
                "-m",
                "foreign.verify_phase0",
                "--retained",
                str(retainer_b),
                "--presented",
                str(retainer_b),
            ]
        )
        if "APPEND_ONLY" not in fp.stdout:
            _fail("foreign phase0 equal-size", fp.stdout or fp.stderr)
        _ok("foreign phase0 equal-size", "APPEND_ONLY smoke")


        # ── issuedAt courts: future / negative / skew ─────────────────
        from diamond.grant import issue as issue_grant_raw, verify_grant as verify_grant_raw
        from diamond.ed25519 import keygen as _kg
        from diamond.hexutil import to_hex as _to_hex
        from diamond.loader import plugin_digest as _pd, coeffect_digest as _cd
        import os as _os

        skew_dir = tmp / "issued-at"
        keygen(skew_dir)
        skew_loader = Loader(skew_dir, mediator=default_mediator())
        gov_seed, gov_pk, _, _ = skew_loader._keys()
        now_i = int(time.time())
        # Future issuedAt beyond skew
        fut = issue_grant_raw(
            seed=gov_seed,
            governor_pk=gov_pk,
            plugin_digest=_pd(PLUGIN_BYTES),
            coeffect_digest=_cd(_os.getuid()),
            operation="load",
            nonce=_to_hex(_os.urandom(32)),
            expiry=now_i + 7200,
            max_ttl=7200,
            issued_at=now_i + 3600,
            activation_digest=skew_loader.activation_digest,
            **_grant_parts(skew_loader, "load", PLUGIN_BYTES),
        )
        try:
            with redirect_stdout(io.StringIO()):
                skew_loader.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=fut,
                    now=now_i,
                )
            _fail("grant-issued-in-future", "future issuedAt accepted")
        except GrantError as exc:
            if GRANT_ISSUED_IN_FUTURE not in str(exc):
                _fail("grant-issued-in-future", str(exc))
        _ok("grant-issued-in-future", "refused")

        # Negative lifetime (expiry < issuedAt) — sign manually
        neg = issue_grant_raw(
            seed=gov_seed,
            governor_pk=gov_pk,
            plugin_digest=_pd(PLUGIN_BYTES),
            coeffect_digest=_cd(_os.getuid()),
            operation="load",
            nonce=_to_hex(_os.urandom(32)),
            expiry=now_i - 10,
            max_ttl=3600,
            issued_at=now_i,
            activation_digest=skew_loader.activation_digest,
            **_grant_parts(skew_loader, "load", PLUGIN_BYTES),
        )
        try:
            verify_grant_raw(neg, now=now_i)
            _fail("grant-negative-lifetime", "accepted")
        except GrantError as exc:
            if GRANT_NEGATIVE_LIFETIME not in str(exc) and "expired" not in str(exc):
                # expiry < issuedAt should hit negative-lifetime first
                _fail("grant-negative-lifetime", str(exc))
            if GRANT_NEGATIVE_LIFETIME not in str(exc):
                _fail("grant-negative-lifetime", f"want negative-lifetime got {exc}")
        _ok("grant-negative-lifetime", "refused")

        # Small clock skew OK (issuedAt slightly ahead)
        skew_ok = issue_demo_grant(
            skew_loader,
            "load",
            PLUGIN_BYTES,
            now_i + 3600,
            max_ttl=3600,
            issued_at=now_i + 30,
        )
        with redirect_stdout(io.StringIO()):
            skew_loader.activate(
                operation="load",
                plugin_bytes=PLUGIN_BYTES,
                grant=skew_ok,
                now=now_i,
            )
        _ok("grant-clock-skew", "issuedAt+30s accepted")

        # ── Activation binding ────────────────────────────────────────
        act_dir = tmp / "activation-bind"
        keygen(act_dir)
        act_loader = Loader(act_dir, mediator=default_mediator())
        act_grant = issue_demo_grant(
            act_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        old_act = act_loader.activation_digest
        act_loader.restart_activation()
        if act_loader.activation_digest == old_act:
            _fail("grant-activation-mismatch", "restart did not change digest")
        try:
            with redirect_stdout(io.StringIO()):
                act_loader.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=act_grant,
                )
            _fail("grant-activation-mismatch", "old grant accepted after restart")
        except GrantError as exc:
            if GRANT_ACTIVATION_MISMATCH not in str(exc):
                _fail("grant-activation-mismatch", str(exc))
        _ok("grant-activation-mismatch", "refused after restart")

        # ── Evil governor refused (pin governorPk) ────────────────────
        evil_dir = tmp / "evil-gov"
        keygen(evil_dir)
        evil_loader = Loader(evil_dir, mediator=default_mediator())
        evil_seed, evil_pk = _kg()
        # Sign with evil key but claim... actually sign as evil with evil pk in body
        evil_grant = issue_grant_raw(
            seed=evil_seed,
            governor_pk=evil_pk,
            plugin_digest=_pd(PLUGIN_BYTES),
            coeffect_digest=_cd(_os.getuid()),
            operation="load",
            nonce=_to_hex(_os.urandom(32)),
            expiry=int(time.time()) + 3600,
            max_ttl=3600,
            issued_at=int(time.time()),
            activation_digest=evil_loader.activation_digest,
            **_grant_parts(evil_loader, "load", PLUGIN_BYTES),
        )
        try:
            with redirect_stdout(io.StringIO()):
                evil_loader.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=evil_grant,
                )
            _fail("evil-governor-refused", "evil self-declared governor accepted")
        except GrantError as exc:
            if GRANT_GOVERNOR_MISMATCH not in str(exc):
                _fail("evil-governor-refused", str(exc))
        _ok("evil-governor-refused", "governor pin held")

        # ── Signed checkpoints / verify-pair ──────────────────────────
        from diamond.verify_pair import verify_pair as _vp
        from diamond.checkpoint import sign_checkpoint as _scp

        # Honest signed pair from demo tmp (rewritten earlier for mutate-A —
        # re-run a fresh mini pair)
        cp_dir = tmp / "signed-cp"
        keygen(cp_dir)
        with redirect_stdout(io.StringIO()):
            from diamond.demo import run_demo as _rd
            cp_b = tmp / "signed-cp-b"
            cp_demo = _rd(cp_dir, retainer_b_root=cp_b)
        v, rc = _vp(cp_dir / "retained.json", cp_dir / "presented.json",
                    expect_pk=(cp_dir / "issuer.pk").read_text().strip())
        if v != "APPEND_ONLY":
            _fail("signed-checkpoint-ok", f"got {v!r} rc={rc}")
        _ok("signed-checkpoint-ok", "CHECKPOINT_SIG + APPEND_ONLY")

        # rewrite-both without valid sig FAILS
        bad_r = json.loads((cp_dir / "retained.json").read_text())
        bad_p = json.loads((cp_dir / "presented.json").read_text())
        bad_r["root"] = ("0" if bad_r["root"][-1] != "0" else "1") + bad_r["root"][1:]
        # flip presented to match forged consistent-looking pair (same forged root)
        bad_p["root"] = bad_r["root"]
        # strip / break signatures
        bad_r["sig"] = "00" * 64
        bad_p["sig"] = "00" * 64
        write_json(cp_dir / "forged-retained.json", bad_r)
        write_json(cp_dir / "forged-presented.json", bad_p)
        with redirect_stdout(io.StringIO()):
            v, rc = _vp(cp_dir / "forged-retained.json", cp_dir / "forged-presented.json",
                        expect_pk=(cp_dir / "issuer.pk").read_text().strip())
        _require_rewrite_both_refusal(v, rc)
        _ok("rewrite-both-unsigned", "CHECKPOINT_SIG_FAIL")

        # Alternate valid Merkle fork still CONFLICT vs signed retained
        # (use vendor phase0 on merkle fields: mutate presented root, sigs still
        # on retained — verify-pair will fail sig on presented after mutate of
        # root without re-sign; so: re-sign a forked presented with same issuer
        # and expect CONFLICT from phase0 after sigs verify)
        honest_r = json.loads((cp_dir / "retained.json").read_text())
        fork_p = json.loads((cp_dir / "presented.json").read_text())
        root = fork_p["root"]
        fork_p["root"] = root[:-1] + ("0" if root[-1] != "0" else "1")
        # re-sign fork so sig check passes, then Phase 0 CONFLICT
        _gs, _gp, iss_seed, iss_pk = Loader(cp_dir, mediator=default_mediator())._keys()
        # drop old sig/kind fields for re-sign helper
        fork_body = {
            "head": fork_p["head"],
            "root": fork_p["root"],
            "seq": fork_p["seq"],
            "size": fork_p["size"],
            "consistency_path": fork_p.get("consistency_path", []),
        }
        fork_signed = _scp(fork_body, seed=iss_seed, signer_pk=iss_pk)
        write_json(cp_dir / "fork-presented.json", fork_signed)
        v, rc = _vp(cp_dir / "retained.json", cp_dir / "fork-presented.json",
                    expect_pk=(cp_dir / "issuer.pk").read_text().strip())
        if v != "OBSERVATION_CONFLICT":
            _fail("signed-fork-conflict", f"want CONFLICT got {v!r} rc={rc}")
        _ok("signed-fork-conflict", "OBSERVATION_CONFLICT vs signed retained")

        # ── Key hygiene: secrets 0o600 + gitignore *.sk ────────────────
        sk = cp_dir / "governor.sk"
        mode = sk.stat().st_mode & 0o777
        if mode != 0o600:
            _fail("key-hygiene-mode", f"governor.sk mode {oct(mode)} want 0o600")
        gi = (ROOT / ".gitignore").read_text()
        if "*.sk" not in gi:
            _fail("key-hygiene-gitignore", "*.sk missing from .gitignore")
        _ok("key-hygiene", "0o600 + gitignore *.sk")

        # ── Unload link: revertOf must reference prior load ───────────
        ul_dir = tmp / "unload-link"
        keygen(ul_dir)
        ul = Loader(ul_dir, mediator=default_mediator())
        now_u = int(time.time())
        lg = issue_demo_grant(ul, "load", PLUGIN_BYTES, now_u + 3600)
        with redirect_stdout(io.StringIO()):
            loaded = ul.activate(operation="load", plugin_bytes=PLUGIN_BYTES, grant=lg)
        load_hash = loaded["receipt"]["aura"]["entryHash"]
        ug = issue_demo_grant(ul, "unload", PLUGIN_BYTES, now_u + 3600)
        try:
            with redirect_stdout(io.StringIO()):
                ul.activate(
                    operation="unload",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=ug,
                    revert_of="",
                )
            _fail("unload-revertOf-required", "empty revertOf accepted")
        except GrantError as exc:
            if UNLOAD_REVERTOF_REQUIRED not in str(exc):
                _fail("unload-revertOf-required", str(exc))
        _ok("unload-revertOf-required", "refused")
        # unknown hash
        ug2 = issue_demo_grant(ul, "unload", PLUGIN_BYTES, now_u + 3600)
        try:
            with redirect_stdout(io.StringIO()):
                ul.activate(
                    operation="unload",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=ug2,
                    revert_of="ab" * 32,
                )
            _fail("unload-revertOf-unknown", "unknown hash accepted")
        except GrantError as exc:
            if UNLOAD_REVERTOF_UNKNOWN not in str(exc):
                _fail("unload-revertOf-unknown", str(exc))
        _ok("unload-revertOf-unknown", "refused")
        # honest unload still works
        ug3 = issue_demo_grant(ul, "unload", PLUGIN_BYTES, now_u + 3600)
        with redirect_stdout(io.StringIO()):
            ul.activate(
                operation="unload",
                plugin_bytes=PLUGIN_BYTES,
                grant=ug3,
                revert_of=load_hash,
            )
        _ok("unload-link-ok", "revertOf+pluginDigest matched")


        # ── Patent-license strict gate (Provisional B) ──────────────────
        # 1) Strict mode refuse without license grant.
        strict_dir = tmp / "patent-strict"
        keygen(strict_dir)
        strict_med = MediatorProvider(enabled=True, require_patent_license=True)
        strict = Loader(strict_dir, mediator=strict_med)
        cg = issue_demo_grant(strict, "load", PLUGIN_BYTES, int(time.time()) + 3600)
        try:
            with redirect_stdout(io.StringIO()):
                strict.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=cg,
                    patent_license=None,
                )
            _fail("patent-strict-refuse", "activate accepted without patent license")
        except PatentLicenseError as exc:
            if PATENT_LICENSE_REQUIRED not in str(exc):
                _fail("patent-strict-refuse", str(exc))
        except GrantError as exc:
            _fail("patent-strict-refuse", f"wrong refuse path: {exc}")
        _ok("patent-strict-refuse", PATENT_LICENSE_REQUIRED)

        # 2) With license grant → succeeds; receipt references nonce/docket.
        lic = issue_demo_patent_license(
            strict, PLUGIN_BYTES, int(time.time()) + 3600
        )
        with redirect_stdout(io.StringIO()):
            result = strict.activate(
                operation="load",
                plugin_bytes=PLUGIN_BYTES,
                grant=cg,
                patent_license=lic,
            )
        comp = result["receipt"]["composition"]
        if comp.get("patentLicenseNonce") != lic["nonce"]:
            _fail("patent-strict-ok", "receipt missing patentLicenseNonce")
        if comp.get("patentDocketId") != lic["patentDocketId"]:
            _fail("patent-strict-ok", "receipt missing patentDocketId")
        approval, conformance = verify_receipt(result["receipt"])
        if (approval, conformance) != ("unattributed", "NON-CONFORMING"):
            _fail("patent-strict-ok", f"{approval} {conformance}")
        _ok("patent-strict-ok", "licensed activate + receipt refs")

        # 3) Replay license nonce fails.
        strict2_dir = tmp / "patent-replay"
        keygen(strict2_dir)
        # Copy spent patent nonce store is per-root; reuse same license against
        # a fresh root that shares... actually issue once, activate twice on
        # SAME root after unload path — simpler: second activate on strict_dir
        # with a NEW composition grant but SAME patent license nonce.
        strict_med2 = MediatorProvider(enabled=True, require_patent_license=True)
        # unload first so load can be attempted again
        ug = issue_demo_grant(strict, "unload", PLUGIN_BYTES, int(time.time()) + 3600)
        lic_unload = issue_demo_patent_license(
            strict, PLUGIN_BYTES, int(time.time()) + 3600
        )
        with redirect_stdout(io.StringIO()):
            strict.activate(
                operation="unload",
                plugin_bytes=PLUGIN_BYTES,
                grant=ug,
                patent_license=lic_unload,
                revert_of=result["receipt"]["aura"]["entryHash"],
            )
        cg2 = issue_demo_grant(strict, "load", PLUGIN_BYTES, int(time.time()) + 3600)
        try:
            with redirect_stdout(io.StringIO()):
                strict.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=cg2,
                    patent_license=lic,  # spent nonce
                )
            _fail("patent-license-replay", "replayed patent license accepted")
        except (PatentLicenseError, GrantError) as exc:
            msg = str(exc).lower()
            if "replay" not in msg and "grant:replayed" not in msg:
                _fail("patent-license-replay", str(exc))
        _ok("patent-license-replay", "replay refused")

        # 4) Identity fields on patent-license grant still refused.
        bad_lic = dict(lic_unload)  # already consumed; just for field check
        # Fresh license then forge identity
        fresh_dir = tmp / "patent-identity"
        keygen(fresh_dir)
        fresh_med = MediatorProvider(enabled=True, require_patent_license=True)
        fresh = Loader(fresh_dir, mediator=fresh_med)
        fg = issue_demo_grant(fresh, "load", PLUGIN_BYTES, int(time.time()) + 3600)
        fl = issue_demo_patent_license(fresh, PLUGIN_BYTES, int(time.time()) + 3600)
        for field in ("owner", "identity", "did"):
            forged = dict(fl)
            forged[field] = "did:example:forged"
            try:
                with redirect_stdout(io.StringIO()):
                    fresh.activate(
                        operation="load",
                        plugin_bytes=PLUGIN_BYTES,
                        grant=fg,
                        patent_license=forged,
                    )
                _fail(f"patent-identity-refuse-{field}", f"{field} accepted")
            except PatentLicenseError as exc:
                msg = str(exc).lower()
                if field not in msg and "closed" not in msg and "identity" not in msg:
                    _fail(f"patent-identity-refuse-{field}", str(exc))
            _ok(f"patent-identity-refuse-{field}", "refused")

        # Env-based strict mode also refuses without license.
        env_dir = tmp / "patent-env"
        keygen(env_dir)
        env_refuse = _run(
            [
                sys.executable,
                "-c",
                (
                    "import json,sys,io,os\n"
                    "from contextlib import redirect_stdout\n"
                    "from pathlib import Path\n"
                    f"sys.path.insert(0, {str(ROOT)!r})\n"
                    "os.environ['AUKORA_STRICT_PATENT_LICENSE']='1'\n"
                    "from diamond.loader import Loader, default_mediator, issue_demo_grant\n"
                    "from diamond.patent_license import PatentLicenseError\n"
                    f"out=Path({str(env_dir)!r})\n"
                    "loader=Loader(out, mediator=default_mediator())\n"
                    f"plugin=Path({str(plugin)!r}).read_bytes()\n"
                    "g=issue_demo_grant(loader,'load',plugin,int(__import__('time').time())+3600)\n"
                    "try:\n"
                    "  with redirect_stdout(io.StringIO()):\n"
                    "    loader.activate(operation='load',plugin_bytes=plugin,grant=g)\n"
                    "  print('accepted')\n"
                    "except PatentLicenseError as e:\n"
                    "  print('PATENT_LICENSE_REQUIRED' if 'PATENT_LICENSE_REQUIRED' in str(e) else str(e))\n"
                ),
            ],
            env_extra={"AUKORA_STRICT_PATENT_LICENSE": "1"},
        )
        # Note: subprocess env from _run merges env_extra; also set in -c.
        line = (env_refuse.stdout or "").strip().splitlines()
        got = line[-1] if line else ""
        if got != PATENT_LICENSE_REQUIRED:
            _fail("patent-env-strict", f"got {got!r} stderr={env_refuse.stderr}")
        _ok("patent-env-strict", "AUKORA_STRICT_PATENT_LICENSE=1")

        # ═══════════════════════════════════════════════════════════════
        #  P0 — SUBJECT / SESSION BINDING
        #  A valid grant for subject A must refuse as subject B even when
        #  pluginDigest, activationDigest, governorPk, TTL and depth match.
        # ═══════════════════════════════════════════════════════════════
        from diamond.subject import session_digest as _sess, subject_digest as _subj

        sub_dir = tmp / "subject-bind"
        keygen(sub_dir)
        same_act_med = MediatorProvider(enabled=True)
        sub_b = Loader(sub_dir, mediator=same_act_med, subject=str(tmp / "subject-B"))
        grant_b = issue_demo_grant(
            sub_b, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        if grant_b["subjectDigest"] != sub_b.subject_digest:
            _fail("subject-mismatch", "grant did not bind the minting subject")
        # Same state root, same activationDigest, same governor, same plugin.
        sub_a = Loader(sub_dir, mediator=same_act_med, subject=str(tmp / "subject-A"))
        if sub_a.subject_digest == sub_b.subject_digest:
            _fail("subject-mismatch", "subjects collapsed to one digest")
        try:
            with redirect_stdout(io.StringIO()):
                sub_a.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=grant_b
                )
            _fail("subject-mismatch", "grant for subject B exercised as subject A")
        except GrantError as exc:
            if GRANT_SUBJECT_MISMATCH not in str(exc):
                _fail("subject-mismatch", f"want {GRANT_SUBJECT_MISMATCH} got {exc}")
        _ok("subject-mismatch", f"{GRANT_SUBJECT_MISMATCH} (same activation+governor)")

        # Positive control: the binding must not over-refuse.
        with redirect_stdout(io.StringIO()):
            sub_b.activate(operation="load", plugin_bytes=PLUGIN_BYTES, grant=grant_b)
        _ok("subject-bind-ok", "correct subject accepted")

        # Hostile mutation: editing subjectDigest must not survive the signature.
        # Verified with every *other* binding supplied as matching, so the only
        # thing left that can refuse is the signature over the signed body.
        from diamond.grant import verify_grant as _verify_raw

        swapped = dict(grant_b)
        swapped["subjectDigest"] = sub_a.subject_digest
        try:
            _verify_raw(
                swapped,
                now=int(time.time()),
                want_operation="load",
                want_plugin=swapped["pluginDigest"],
                want_coeffect=swapped["coeffectEnvelopeDigest"],
                want_governor_pk=swapped["governorPk"],
                want_subject=sub_a.subject_digest,
                want_composition=swapped["compositionDigest"],
            )
            _fail("subject-swap-resign", "edited subjectDigest accepted")
        except GrantError as exc:
            if "signature" not in str(exc):
                _fail("subject-swap-resign", f"want signature got {exc}")
        _ok("subject-swap-resign", "signature refuses edited subjectDigest")

        # And the same edit against the live seam is refused (no re-sign).
        try:
            with redirect_stdout(io.StringIO()):
                sub_a.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=swapped
                )
            _fail("subject-swap-seam", "edited grant accepted at activate")
        except GrantError:
            pass
        _ok("subject-swap-seam", "edited grant refused at activate seam")

        # Receipt must name the subject it attests.
        sub_receipt = json.loads((sub_dir / "receipt-load.json").read_text())
        if sub_receipt["composition"]["subjectDigest"] != sub_b.subject_digest:
            _fail("subject-receipt", "receipt does not name its subject")
        _ok("subject-receipt", "receipt binds subjectDigest")

        # Session binding (only when a session actually exists).
        sess_dir = tmp / "session-bind"
        keygen(sess_dir)
        sess_loader = Loader(sess_dir, mediator=MediatorProvider(enabled=True))
        sg = issue_demo_grant(
            sess_loader,
            "load",
            PLUGIN_BYTES,
            int(time.time()) + 3600,
            session_digest=_sess("session-A"),
        )
        try:
            with redirect_stdout(io.StringIO()):
                sess_loader.activate(
                    operation="load",
                    plugin_bytes=PLUGIN_BYTES,
                    grant=sg,
                    session="session-B",
                )
            _fail("session-mismatch", "session A grant exercised as session B")
        except GrantError as exc:
            if GRANT_SESSION_MISMATCH not in str(exc):
                _fail("session-mismatch", f"want {GRANT_SESSION_MISMATCH} got {exc}")
        _ok("session-mismatch", GRANT_SESSION_MISMATCH)
        with redirect_stdout(io.StringIO()):
            sess_loader.activate(
                operation="load",
                plugin_bytes=PLUGIN_BYTES,
                grant=sg,
                session="session-A",
            )
        _ok("session-bind-ok", "correct session accepted")

        # ═══════════════════════════════════════════════════════════════
        #  P2 — COMPOSITION DIGEST
        #  Approval for composition A must not authorize composition B just
        #  because one plugin digest matches.
        # ═══════════════════════════════════════════════════════════════
        from diamond.composition import digest as _comp_digest

        comp_dir = tmp / "composition-bind"
        keygen(comp_dir)
        comp_loader = Loader(
            comp_dir, mediator=MediatorProvider(enabled=True), subject=str(tmp / "comp-A")
        )
        good_comp = issue_demo_grant(
            comp_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        # Same plugin bytes, different subject → different composition.
        other_composition = _comp_digest(
            comp_loader.composition_for(
                operation="load", plugin_bytes=PLUGIN_BYTES
            )
        )
        if good_comp["compositionDigest"] != other_composition:
            _fail("composition-mismatch", "composition digest not bound")
        comp_loader_b = Loader(
            comp_dir, mediator=MediatorProvider(enabled=True), subject=str(tmp / "comp-B")
        )
        try:
            with redirect_stdout(io.StringIO()):
                comp_loader_b.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=good_comp
                )
            _fail("composition-mismatch", "grant for composition A used as B")
        except GrantError as exc:
            if (
                GRANT_COMPOSITION_MISMATCH not in str(exc)
                and GRANT_SUBJECT_MISMATCH not in str(exc)
            ):
                _fail("composition-mismatch", str(exc))
        _ok("composition-mismatch", "one plugin digest does not authorize two comps")
        # Positive control: the composition the grant names is accepted.
        with redirect_stdout(io.StringIO()):
            comp_loader.activate(
                operation="load", plugin_bytes=PLUGIN_BYTES, grant=good_comp
            )
        _ok("composition-bind-ok", "matching composition accepted")

        # Only the composition binding can refuse this one: the subject
        # matches, the plugin matches, the governor matches, the signature is
        # valid — so if composition is not checked, this grant activates.
        forged = issue_demo_grant(
            comp_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        forged["compositionDigest"] = "5a" * 32
        from diamond.ed25519 import sign as _re_sign
        from diamond.grant import to_sign_bytes as _rsb

        _dseed, _dpk, _, _ = comp_loader._keys()
        forged.pop("sig", None)
        forged["sig"] = to_hex(_re_sign(_dseed, _rsb(forged)))
        try:
            with redirect_stdout(io.StringIO()):
                comp_loader.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=forged
                )
            _fail(
                "composition-digest-refuse",
                "grant bound to a different composition activated",
            )
        except GrantError as exc:
            if GRANT_COMPOSITION_MISMATCH not in str(exc):
                _fail("composition-digest-refuse", f"want composition got {exc}")
        _ok(
            "composition-digest-refuse",
            "valid signature, matching subject, wrong composition refused",
        )

        # Composition digest tracks the operation, not just the bytes.
        load_comp = _comp_digest(
            comp_loader.composition_for(operation="load", plugin_bytes=PLUGIN_BYTES)
        )
        unload_comp = _comp_digest(
            comp_loader.composition_for(operation="unload", plugin_bytes=PLUGIN_BYTES)
        )
        if load_comp == unload_comp:
            _fail("composition-op-separated", "load and unload share a composition")
        _ok("composition-op-separated", "load != unload composition")

        # ═══════════════════════════════════════════════════════════════
        #  P1 — MONOTONIC DELEGATION
        #  Child authority must be a subset of parent authority. One
        #  positive narrowed child, then one attack per widened dimension.
        # ═══════════════════════════════════════════════════════════════
        from diamond.grant import (
            check_delegation as _check_del,
            delegate as _delegate,
            grant_fingerprint as _fp,
        )

        del_dir = tmp / "delegation"
        keygen(del_dir)
        del_loader = Loader(del_dir, mediator=MediatorProvider(enabled=True))
        dseed, dpk, _, _ = del_loader._keys()
        now_d = int(time.time())
        parent = issue_demo_grant(
            del_loader, "load", PLUGIN_BYTES, now_d + 3600, max_depth=3, max_ttl=3600
        )
        child = _delegate(
            parent,
            seed=dseed,
            nonce=to_hex(os.urandom(32)),
            expiry=now_d + 600,
            max_ttl=600,
            issued_at=now_d,
            max_depth=2,
        )
        _check_del(child, parent)
        if child["parentDigest"] != _fp(parent):
            _fail("delegation-narrowed-ok", "child did not bind its parent")
        with redirect_stdout(io.StringIO()):
            del_loader.activate(operation="load", plugin_bytes=PLUGIN_BYTES, grant=child)
        _ok("delegation-narrowed-ok", "narrowed child accepted")

        # Fresh parent for the widening attacks (the child above is spent).
        def _fresh_parent():
            d2 = tmp / f"delegation-{to_hex(os.urandom(8))}"
            keygen(d2)
            ldr = Loader(d2, mediator=MediatorProvider(enabled=True))
            s, pk, _, _ = ldr._keys()
            p = issue_demo_grant(ldr, "load", PLUGIN_BYTES, now_d + 3600, max_ttl=3600)
            return ldr, s, p

        widen_attacks = (
            ("operation", {"operation": "unload"}),
            ("plugin", {"pluginDigest": "ab" * 32}),
            ("activation", {"activationDigest": "cd" * 32}),
            ("subject", {"subjectDigest": "ef" * 32}),
            ("expiry", {"expiry": now_d + 99999}),
            ("maxTTL", {"maxTTL": 99999}),
            ("maxDepth", {"maxDepth": 99}),
        )
        for dim, mutate in widen_attacks:
            ldr, s, p = _fresh_parent()
            bad = _delegate(
                p,
                seed=s,
                nonce=to_hex(os.urandom(32)),
                expiry=now_d + 600,
                max_ttl=600,
                issued_at=now_d,
                max_depth=2,
            )
            bad.update(mutate)
            # Re-sign so the ONLY difference is the widened width, not a bad sig.
            from diamond.ed25519 import sign as _sign
            from diamond.grant import to_sign_bytes as _tsb

            bad.pop("sig", None)
            bad["sig"] = to_hex(_sign(s, _tsb(bad)))
            try:
                _check_del(bad, p)
                _fail(f"delegation-widened-{dim}", f"{dim} widened and accepted")
            except GrantError as exc:
                if GRANT_DELEGATION_WIDENED not in str(exc) or dim not in str(exc):
                    _fail(f"delegation-widened-{dim}", f"want {dim} got {exc}")
            _ok(f"delegation-widened-{dim}", f"{GRANT_DELEGATION_WIDENED}: {dim}")

        # Re-parenting: a child cannot be moved onto a wider parent later.
        ldr, s, p = _fresh_parent()
        ldr2, s2, p2 = _fresh_parent()
        widest = _delegate(
            p2,
            seed=s2,
            nonce=to_hex(os.urandom(32)),
            expiry=now_d + 3000,
            max_ttl=3000,
            issued_at=now_d,
            max_depth=3,
        )
        try:
            _check_del(widest, p)
            _fail("delegation-reparent", "child accepted under a different parent")
        except GrantError as exc:
            if GRANT_DELEGATION_WIDENED not in str(exc):
                _fail("delegation-reparent", str(exc))
        _ok("delegation-reparent", "parentDigest binds the chain")

        # Identity substitution on a child: a wider subject cannot be grafted.
        ldr, s, p = _fresh_parent()
        kid = _delegate(
            p,
            seed=s,
            nonce=to_hex(os.urandom(32)),
            expiry=now_d + 600,
            max_ttl=600,
            issued_at=now_d,
            max_depth=1,
        )
        try:
            _check_del(kid, p2)
            _fail("delegation-cross-chain", "child accepted under unrelated parent")
        except GrantError as exc:
            if GRANT_DELEGATION_WIDENED not in str(exc):
                _fail("delegation-cross-chain", str(exc))
        _ok("delegation-cross-chain", "unrelated parent refused")

        # ═══════════════════════════════════════════════════════════════
        #  PORTABLE GRANT AUDIT
        #  Portability is the one escape from epoch/restart revocation. It is
        #  a distinct kind with its own signed domain — not a casual boolean.
        # ═══════════════════════════════════════════════════════════════
        from diamond.grant import KIND as _NK, PORTABLE_KIND as _PK

        # A normal grant cannot simply flip `portable: true`.
        flipped = dict(parent)
        flipped["portable"] = True
        try:
            _check_del(flipped, parent)
            _fail("portable-flag-on-normal", "portable flag accepted on normal kind")
        except GrantError as exc:
            if GRANT_PORTABLE_KIND not in str(exc):
                _fail("portable-flag-on-normal", f"want {GRANT_PORTABLE_KIND} got {exc}")
        _ok("portable-flag-on-normal", f"{GRANT_PORTABLE_KIND} on a normal kind")

        port_dir = tmp / "portable"
        keygen(port_dir)
        port_loader = Loader(port_dir, mediator=MediatorProvider(enabled=True))
        port_grant = issue_demo_grant(
            port_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600, portable=True
        )
        if port_grant["kind"] != _PK or _NK == _PK:
            _fail("portable-kind", f"portable grant kind is {port_grant['kind']}")
        port_loader.restart_activation()
        with redirect_stdout(io.StringIO()):
            port_loader.activate(
                operation="load", plugin_bytes=PLUGIN_BYTES, grant=port_grant
            )
        _ok(
            "portable-survives-restart",
            "portable kind crosses activation restart (documented escape)",
        )

        # ═══════════════════════════════════════════════════════════════
        #  P6 — MEDIATOR INTEGRITY (in-process substitution)
        # ═══════════════════════════════════════════════════════════════
        from diamond.mediator import verify_mediator_integrity as _vmi

        _vmi(MediatorProvider())
        _ok("mediator-integrity-ok", "unmodified provider accepted")

        class PermissiveMediator(MediatorProvider):
            def require(self) -> None:  # type: ignore[override]
                return None

        try:
            _vmi(PermissiveMediator())
            _fail("mediator-subclass", "permissive subclass accepted")
        except MediatorError as exc:
            if "MEDIATOR_INTEGRITY" not in str(exc):
                _fail("mediator-subclass", str(exc))
        _ok("mediator-subclass", "permissive subclass refused")

        patched = MediatorProvider()
        patched.require = lambda: None  # type: ignore[method-assign]
        try:
            _vmi(patched)
            _fail("mediator-monkeypatch", "patched require() accepted")
        except MediatorError as exc:
            if "MEDIATOR_INTEGRITY" not in str(exc):
                _fail("mediator-monkeypatch", str(exc))
        _ok("mediator-monkeypatch", "instance require() replacement refused")

        try:
            _vmi("not a mediator")
            _fail("mediator-replacement", "non-mediator accepted")
        except MediatorError as exc:
            if "MEDIATOR_INTEGRITY" not in str(exc):
                _fail("mediator-replacement", str(exc))
        _ok("mediator-replacement", "implementation replacement refused")

        # And the same substitution must be refused at the LOADER seam, not
        # only by the standalone check: the loader is what gates real effects.
        seam_dir = tmp / "mediator-seam"
        keygen(seam_dir)
        # The refusal may land at construction or at activate; both are the
        # loader seam, and the assertion is strict either way.
        try:
            seam_loader = Loader(seam_dir, mediator=PermissiveMediator())
            seam_grant = issue_demo_grant(
                seam_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
            )
            with redirect_stdout(io.StringIO()):
                seam_loader.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=seam_grant
                )
            _fail("mediator-subclass-seam", "permissive mediator activated")
        except (MediatorError, CompositionError) as exc:
            if "MEDIATOR" not in str(exc):
                _fail("mediator-subclass-seam", str(exc))
        _ok("mediator-subclass-seam", "loader seam refuses a permissive mediator")

        # The honest half: this is checked, and it is NOT closed in-process.
        with redirect_stdout(io.StringIO()) as med_buf:
            print_ceilings()
        if "PYTHON_RUNTIME_TCB" not in med_buf.getvalue():
            _fail("mediator-tcb-ceiling", "PYTHON_RUNTIME_TCB not printed")
        _ok(
            "mediator-tcb-ceiling",
            "MEDIATOR_INPROCESS + PYTHON_RUNTIME_TCB printed (not claimed closed)",
        )

        # ═══════════════════════════════════════════════════════════════
        #  P7 — DIRECT SAME-UID BYPASS
        #  Same UID can bypass local file ownership. The result must not
        #  become valid authority, and the ceiling must stay printed.
        # ═══════════════════════════════════════════════════════════════
        byp_dir = tmp / "same-uid-bypass"
        keygen(byp_dir)
        byp_med = MediatorProvider(enabled=True)
        byp_loader = Loader(byp_dir, mediator=byp_med)
        # Positive control first: a governed load is backed by the Aura.
        with redirect_stdout(io.StringIO()):
            byp_grant = issue_demo_grant(
                byp_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
            )
            byp_loader.activate(
                operation="load", plugin_bytes=PLUGIN_BYTES, grant=byp_grant
            )
        if not byp_loader.cold_check()["ok"]:
            _fail("same-uid-governed-ok", "governed load flagged as bypass")
        _ok("same-uid-governed-ok", "governed load is Aura-backed")

        # Now bypass the Loader entirely, as the same UID.
        forged_digest = sha256_hex(b"forged-plugin-never-loaded")
        forged_state = {
            "active": {"pluginDigest": forged_digest, "pluginId": PLUGIN_ID}
        }
        (byp_dir / "loader-state.json").write_text(
            json.dumps(forged_state, sort_keys=True)
        )
        byp_loader._reload_state()
        bypass = byp_loader.cold_check()
        if bypass["ok"]:
            _fail("same-uid-bypass", "direct state write not detected")
        findings = {f["finding"] for f in bypass["findings"]}
        if DIRECT_STATE_BYPASS not in findings:
            _fail("same-uid-bypass", f"findings={findings}")
        _ok("same-uid-bypass", f"{DIRECT_STATE_BYPASS} (written as same UID)")
        # It is detected, not prevented — and it mints no authority.
        if not (byp_dir / "receipt-load.json").is_file():
            _fail("same-uid-bypass", "no governed receipt to compare against")
        forged_receipt = json.loads((byp_dir / "receipt-load.json").read_text())
        if forged_receipt["composition"]["pluginDigest"] == forged_digest:
            _fail("same-uid-bypass", "forgery appeared in governed evidence")
        _ok("same-uid-bypass-no-authority", "no receipt or grant reflects the forgery")

        # Same UID can also write the plugin file itself, and `work_stub()`
        # trusts the state file, so it will happily run against the forged
        # digest. That is the ceiling stated plainly: the *load gate* is
        # bypassable at same uid, and what survives is that the bypass carries
        # no grant, no receipt and no authority.
        (byp_dir / "plugin.bin").write_bytes(b"forged-plugin-body")
        work = byp_loader.work_stub()
        if work.get("body", {}).get("echo") != "ok":
            _fail("same-uid-work-bypass", "work stub did not run")
        _ok(
            "same-uid-work-bypass",
            "work runs on forged state (gate bypassed at same uid)",
        )

        # A fully valid, correctly signed receipt is still not a grant.
        _gs, _gp, iss_seed, iss_pk = byp_loader._keys()
        import time as _t

        signed_evidence = issue_receipt(
            seed=iss_seed,
            issuer_pk=iss_pk,
            kind=KIND_LIVE,
            issued_at=int(_t.time()),
            nonce=to_hex(os.urandom(32)),
            aura={
                "entryHash": "aa" * 32,
                "head": "aa" * 32,
                "prevHash": "00" * 32,
                "root": "bb" * 32,
                "seq": 1,
                "size": 1,
            },
            composition={
                "coeffectEnvelopeDigest": "44" * 32,
                "compositionDigest": "66" * 32,
                "operation": "load",
                "pluginDigest": forged_digest,
                "pluginId": PLUGIN_ID,
                "revertOf": "",
                "subjectDigest": "77" * 32,
            },
        )
        approval, conformance = verify_receipt(signed_evidence)
        if (approval, conformance) != ("unattributed", "NON-CONFORMING"):
            _fail("same-uid-receipt-evidence", f"{approval} {conformance}")
        try:
            with redirect_stdout(io.StringIO()):
                Loader(byp_dir, mediator=MediatorProvider(enabled=True)).activate(
                    operation="load",
                    plugin_bytes=b"other-bytes",
                    grant=signed_evidence,
                )
            _fail("same-uid-receipt-evidence", "receipt accepted as a grant")
        except GrantError as exc:
            if EVIDENCE_NEVER_AUTHORIZES not in str(exc):
                _fail("same-uid-receipt-evidence", str(exc))
        _ok(
            "same-uid-receipt-evidence",
            "same-UID-forged, validly signed receipt is evidence only",
        )

        # ═══════════════════════════════════════════════════════════════
        #  P3 — CRASH / INDETERMINATE MATRIX
        #  Fail at each durable boundary, then cold reopen. Ambiguous state
        #  must never be reported as success or as a clean refusal.
        # ═══════════════════════════════════════════════════════════════

        class CrashHooks:
            def __init__(self, where: str, payload):
                self.where, self.payload = where, payload

            def __getattr__(self, name: str):
                def _fire():
                    if name == self.where:
                        raise self.payload

                return _fire

        crash_matrix = (
            ("after_nonce_reserved", AUTHORITY_CONSUMED_EFFECT_UNKNOWN),
            ("after_effect", AUTHORITY_CONSUMED_EFFECT_UNKNOWN),
            ("after_state_write", AUTHORITY_CONSUMED_EFFECT_UNKNOWN),
            ("after_aura_append", INDETERMINATE),
            ("after_receipt_write", INDETERMINATE),
        )
        for where, expected in crash_matrix:
            c_dir = tmp / f"crash-{where}"
            keygen(c_dir)
            crash_loader = Loader(
                c_dir,
                mediator=MediatorProvider(enabled=True),
                hooks=CrashHooks(where, KeyboardInterrupt("injected crash")),
            )
            c_grant = issue_demo_grant(
                crash_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
            )
            try:
                with redirect_stdout(io.StringIO()):
                    crash_loader.activate(
                        operation="load", plugin_bytes=PLUGIN_BYTES, grant=c_grant
                    )
                _fail(f"crash-{where}", "injected failure did not fire")
            except KeyboardInterrupt:
                pass
            # Cold reopen with a fresh handle.
            cold = Loader(c_dir, mediator=MediatorProvider(enabled=True))
            report = cold.reopen()
            got = {f["finding"] for f in report["findings"]}
            if got != {expected}:
                _fail(f"crash-{where}", f"want {expected} got {got}")
            if cold.settlements.read(c_grant["nonce"]) is None:
                _fail(f"crash-{where}", "settlement vanished from accounting")
            if not cold.nonces.contains(c_grant["nonce"]):
                _fail(f"crash-{where}", "consumed nonce not accounted as spent")
            _ok(f"crash-{where}", f"{expected} (not success, not clean refusal)")

        # Negative control: a clean settlement reports nothing.
        clean_dir = tmp / "crash-clean"
        keygen(clean_dir)
        clean_loader = Loader(clean_dir, mediator=MediatorProvider(enabled=True))
        cg = issue_demo_grant(
            clean_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        with redirect_stdout(io.StringIO()):
            clean_loader.activate(
                operation="load", plugin_bytes=PLUGIN_BYTES, grant=cg
            )
        cold_clean = Loader(clean_dir, mediator=MediatorProvider(enabled=True))
        if not cold_clean.reopen()["ok"]:
            _fail("crash-clean-settles", "committed settlement reported as pending")
        _ok("crash-clean-settles", "committed settlement reports nothing")

        # A consumed grant stays consumed across crash and reopen.
        rep_dir = tmp / "crash-replay"
        keygen(rep_dir)
        rep_loader = Loader(
            rep_dir,
            mediator=MediatorProvider(enabled=True),
            hooks=CrashHooks("after_aura_append", KeyboardInterrupt("injected crash")),
        )
        rep_grant = issue_demo_grant(
            rep_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        try:
            with redirect_stdout(io.StringIO()):
                rep_loader.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=rep_grant
                )
        except KeyboardInterrupt:
            pass
        reopened = Loader(rep_dir, mediator=MediatorProvider(enabled=True))
        if not reopened.state.get("active"):
            _fail("crash-authority-consumed", "effect was not applied before crash")
        try:
            with redirect_stdout(io.StringIO()):
                reopened.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=rep_grant
                )
            _fail("crash-authority-consumed", "consumed grant replayed after crash")
        except GrantError as exc:
            if GRANT_REPLAYED not in str(exc):
                _fail("crash-authority-consumed", str(exc))
        _ok(
            "crash-authority-consumed",
            "consumed grant refused after crash (no silent success)",
        )

        # Journal tampering: an unreadable journal is loud, never "clean".
        bad_dir = tmp / "crash-badjournal"
        keygen(bad_dir)
        bad_loader = Loader(bad_dir, mediator=MediatorProvider(enabled=True))
        bg = issue_demo_grant(
            bad_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        bad_loader.settlements.begin(
            nonce=bg["nonce"], operation="load", intent={}
        )
        (bad_dir / "settlement" / f"{bg['nonce']}.settlement.json").write_text("{not json")
        bad_report = Loader(
            bad_dir, mediator=MediatorProvider(enabled=True)
        ).reopen()
        if bad_report["ok"]:
            _fail("crash-journal-unreadable", "corrupt journal reported as clean")
        bad_findings = {f["finding"] for f in bad_report["findings"]}
        if SETTLEMENT_JOURNAL_UNREADABLE not in bad_findings:
            _fail("crash-journal-unreadable", f"findings={bad_findings}")
        _ok("crash-journal-unreadable", SETTLEMENT_JOURNAL_UNREADABLE)

        # ═══════════════════════════════════════════════════════════════
        #  P5 — OBJECT-ROLE / KEY-ROLE SUBSTITUTION
        #  One Ed25519 algorithm must not collapse authority roles.
        # ═══════════════════════════════════════════════════════════════
        from diamond.roles import RoleError, admit as _admit, GRANT_ROLE as _GR

        role_dir = tmp / "roles"
        keygen(role_dir)
        role_loader = Loader(role_dir, mediator=MediatorProvider(enabled=True))
        role_grant = issue_demo_grant(
            role_loader, "load", PLUGIN_BYTES, int(time.time()) + 3600
        )
        real_receipt = json.loads((comp_dir / "receipt-load.json").read_text())
        # Receipt / checkpoint / patent license must not occupy the grant slot.
        role_attacks = (
            ("receipt", real_receipt),
            (
                "checkpoint",
                sign_checkpoint(
                    {"head": "aa" * 32, "root": "bb" * 32, "seq": 1, "size": 1},
                    seed=b"\x01" * 32,
                    signer_pk=public_from_seed(b"\x01" * 32),
                ),
            ),
        )
        for name, artifact in role_attacks:
            try:
                _admit(artifact, _GR)
                _fail(f"role-{name}-as-grant", f"{name} admitted as grant")
            except RoleError as exc:
                if ROLE_MISMATCH not in str(exc):
                    _fail(f"role-{name}-as-grant", str(exc))
            _ok(f"role-{name}-as-grant", f"{ROLE_MISMATCH}: {name} != grant")
        # A grant must not be admitted as a checkpoint.
        try:
            _admit(role_grant, "checkpoint")
            _fail("role-grant-as-checkpoint", "grant admitted as checkpoint")
        except RoleError as exc:
            if ROLE_MISMATCH not in str(exc):
                _fail("role-grant-as-checkpoint", str(exc))
        _ok("role-grant-as-checkpoint", f"{ROLE_MISMATCH}: grant != checkpoint")
        # A patent license must not be admitted as a grant.
        try:
            _admit(lic, _GR)
            _fail("role-patent-as-grant", "patent license admitted as grant")
        except RoleError as exc:
            if ROLE_MISMATCH not in str(exc):
                _fail("role-patent-as-grant", str(exc))
        _ok("role-patent-as-grant", f"{ROLE_MISMATCH}: patent license != grant")
        # And the live seam refuses a checkpoint in the grant slot.
        ckpt_in_grant = sign_checkpoint(
            {"head": "aa" * 32, "root": "bb" * 32, "seq": 1, "size": 1},
            seed=b"\x02" * 32,
            signer_pk=public_from_seed(b"\x02" * 32),
        )
        try:
            with redirect_stdout(io.StringIO()):
                role_loader.activate(
                    operation="load", plugin_bytes=PLUGIN_BYTES, grant=ckpt_in_grant
                )
            _fail("role-seam-checkpoint", "checkpoint accepted at activate seam")
        except (RoleError, GrantError) as exc:
            if ROLE_MISMATCH not in str(exc) and "closed" not in str(exc):
                _fail("role-seam-checkpoint", str(exc))
        _ok("role-seam-checkpoint", "activate seam refuses a checkpoint")

        # ═══════════════════════════════════════════════════════════════
        #  P4 — STALE BUT VALIDLY SIGNED CHECKPOINT
        #  An older, correctly signed checkpoint is not latest. Signature
        #  validity, consistency and freshness are three separate things.
        # ═══════════════════════════════════════════════════════════════
        from diamond.aura import Aura as _Aura
        from diamond.checkpoint import (
            CheckpointError,
            sign_checkpoint as _sign_cp,
            verify_checkpoint as _verify_cp,
        )

        stale_dir = tmp / "stale-checkpoint"
        stale_dir.mkdir(parents=True, exist_ok=True)
        aura_log = _Aura(stale_dir / "aura.jsonl")
        for i in range(4):
            aura_log.append({"kind": "work-stub", "echo": "ok", "i": i})
        cp_seed = b"\x07" * 32
        cp_pk = public_from_seed(cp_seed)
        # A genuinely OLDER observation: the log as it stood at size 1, plus
        # the consistency proof that it is a prefix of the current log.
        old_obs = _aura_head_at(aura_log, 1)
        # Note: the observation is deliberately the raw older head. Its Merkle
        # consistency path is not re-verified here (see the scope note on
        # check_checkpoint_freshness); freshness is judged on head/size only.
        old_cp = _sign_cp(old_obs, seed=cp_seed, signer_pk=cp_pk)
        # Signature is genuinely valid...
        _verify_cp(old_cp, expect_pk=to_hex(cp_pk))
        # ...and genuinely stale.
        try:
            check_checkpoint_freshness(old_cp, aura_log, expect_pk=to_hex(cp_pk))
            _fail("stale-checkpoint", "older signed checkpoint accepted as latest")
        except CheckpointError as exc:
            if CHECKPOINT_STALE not in str(exc):
                _fail("stale-checkpoint", f"want {CHECKPOINT_STALE} got {exc}")
        _ok("stale-checkpoint", f"{CHECKPOINT_STALE}: valid signature, not latest")
        # Positive control: the current head is fresh.
        fresh_cp = _sign_cp(aura_log.checkpoint(), seed=cp_seed, signer_pk=cp_pk)
        check_checkpoint_freshness(fresh_cp, aura_log, expect_pk=to_hex(cp_pk))
        _ok("stale-checkpoint-fresh-ok", "current signed head accepted as fresh")
        # A checkpoint claiming a size beyond the log is not "fresher".
        ahead_cp = _sign_cp(
            {
                "head": "aa" * 32,
                "root": aura_log.root(),
                "seq": aura_log.size() + 5,
                "size": aura_log.size() + 5,
            },
            seed=cp_seed,
            signer_pk=cp_pk,
        )
        try:
            check_checkpoint_freshness(ahead_cp, aura_log, expect_pk=to_hex(cp_pk))
            _fail("stale-checkpoint-future", "checkpoint beyond the log accepted")
        except CheckpointError as exc:
            if CHECKPOINT_STALE not in str(exc):
                _fail("stale-checkpoint-future", str(exc))
        _ok("stale-checkpoint-future", "checkpoint beyond the log refused")

        # ═══════════════════════════════════════════════════════════════
        #  P8 — CLAIM / CEILING INTEGRITY
        # ═══════════════════════════════════════════════════════════════
        check_claim_integrity(ROOT)
        _ok("claim-integrity", "REDTEAM codes exist; ceilings present; no SURVIVES")
        check_ceiling_presence(ROOT)
        _ok("ceiling-presence", "mandatory ceilings cannot silently disappear")

        # Sensitivity mutants: remove one protection, the court must go RED.
        # Skipped inside a mutant run, which is a court witness, not a recursor.
        mutant_results = run_sensitivity_mutants(ROOT)
        for name, went_red in sorted(mutant_results.items()):
            if not went_red:
                _fail(
                    f"sensitivity-{name}",
                    "court stayed GREEN with the protection removed (decoration)",
                )
            _ok(f"sensitivity-{name}", "protection removed -> court RED")
        if mutant_results:
            _ok(
                "sensitivity-mutants",
                f"{len(mutant_results)}/{len(MUTANTS)} protections are load-bearing",
            )

    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(b_root, ignore_errors=True)

    print("DIAMOND: GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
