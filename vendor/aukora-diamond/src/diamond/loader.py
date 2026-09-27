"""Composition gate: plugin load/unload at the loader seam.

Requires a MediatorProvider at construction (CompositionError if absent).
Activate refuses MEDIATOR_OFF before grant evaluation when disabled.
Nonce consume is atomic (O_EXCL). Activate is covered by a state-root lock.
Refuses activate without a one-use grant. Prints ceilings and attendance
reported-not-proven. Does not claim process isolation or an owner-key
ceremony. Evidence never authorizes; grants authorize.

Grants bind to activationDigest (epoch identity of this state root) unless
explicitly portable. GovernorPk is pinned constant-time to the loader key.
Unload requires revertOf → prior load entry + matching pluginDigest.

Strict patent-license mode (env AUKORA_STRICT_PATENT_LICENSE=1 or mediator
policy): also requires a one-use aukora-patent-license/v1 grant signed by
patentee root, matching scopeDigest to pluginDigest. Not DRM over forks —
authorization plumbing for conforming practice under a patent license.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from diamond.aura import Aura
from diamond.composition import (
    build as build_composition,
    digest as composition_digest_of,
)
from diamond.ed25519 import public_from_seed
from diamond.grant import (
    GrantError,
    NonceStore,
    RECONSTRUCTION_SUBSTITUTES,
    issue as issue_grant,
    looks_like_receipt,
    verify_grant,
)
from diamond.hexutil import read_json, require_hex, sha256_hex, to_hex, write_json, write_secret
from diamond.jcs import canonicalize_bytes
from diamond.lock import StateLock
from diamond.mediator import (
    CompositionError,
    MediatorError,
    MediatorProvider,
    require_provider,
    verify_mediator_integrity,
)
from diamond.patent_license import (
    PatentLicenseError,
    PatentNonceStore,
    issue as issue_patent_license,
    verify_patent_license,
)
from diamond.receipt import KIND_LIVE, issue as issue_receipt
from diamond.refuse_codes import (
    CEILINGS as REFUSE_CEILINGS,
    AUTHORITY_CONSUMED_EFFECT_UNKNOWN,
    DIRECT_STATE_BYPASS,
    EFFECT_UNKNOWN_ACTIVE,
    EVIDENCE_NEVER_AUTHORIZES,
    IDENTITY_BOUND_FALSE,
    INDETERMINATE,
    GRANT_SESSION_MISMATCH,
    NO_GRANT,
    PATENT_LICENSE_REQUIRED_MSG,
    SETTLEMENT_JOURNAL_UNREADABLE,
    SETTLEMENT_PENDING,
    STATE_UNBACKED_BY_AURA,
    UNOWNABLE_CORE_TARGET,
    UNLOAD_PLUGIN_MISMATCH,
    UNLOAD_REVERTOF_REQUIRED,
    UNLOAD_REVERTOF_UNKNOWN,
    reconstruction_cannot_mint,
)
from diamond.roles import GRANT_ROLE, admit
from diamond.settlement import SettlementError, SettlementJournal, classify
from diamond.subject import (
    normalize_subject,
    session_digest,
    subject_digest as subject_digest_of,
)

PLUGIN_ID = "ephemeral-echo"
CEILINGS = REFUSE_CEILINGS
DEFAULT_DOCKET = "AUKORA-TOY-PROVISIONAL-B"
# Demo grants: blast-radius issuance-duration bound in signed preimage (seconds).
DEFAULT_MAX_TTL = 3600


def print_ceilings() -> None:
    for name in CEILINGS:
        print(f"CEILING: {name}")
    # Honest doctrine labels — target, not achievement.
    print(IDENTITY_BOUND_FALSE)
    print(UNOWNABLE_CORE_TARGET)


def plugin_digest(plugin_bytes: bytes) -> str:
    return sha256_hex(plugin_bytes)


def coeffect_envelope(uid: int) -> dict:
    return {"kind": "same-uid-envelope", "uid": int(uid)}


def coeffect_digest(uid: int) -> str:
    return sha256_hex(canonicalize_bytes(coeffect_envelope(uid)))


class Loader:
    def __init__(
        self,
        out_dir: Path,
        *,
        mediator: MediatorProvider | None = None,
        subject: str | None = None,
        hooks: object | None = None,
    ):
        # Structural: cannot build without a mediator provider object.
        self.mediator = require_provider(mediator)
        # In-process gate check. Catches substitution; does not close it.
        verify_mediator_integrity(self.mediator)
        self.out = Path(out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.aura = Aura(self.out / "aura.jsonl")
        self.nonces = NonceStore(self.out)
        self.patent_nonces = PatentNonceStore(self.out)
        self.settlements = SettlementJournal(self.out, hooks=hooks)
        self.hooks = hooks
        self.state_path = self.out / "loader-state.json"
        self.activation_path = self.out / "activation.json"
        self.lock_path = self.out / "loader.lock"
        # Governed subject of this loader: the target activations act upon.
        # Capability-shaped scope, not an identity.
        self.subject = normalize_subject(subject if subject is not None else os.getcwd())
        self.subject_digest = subject_digest_of(self.subject)
        self.state = {"active": None}
        if self.state_path.exists():
            self.state = read_json(self.state_path)
        self.activation_digest = self._ensure_activation()

    def composition_for(self, *, operation: str, plugin_bytes: bytes) -> dict:
        """The exact governed composition this activation would perform."""
        return build_composition(
            operation=operation,
            plugin_digest=plugin_digest(plugin_bytes),
            subject_digest=self.subject_digest,
            coeffect_envelope_digest=coeffect_digest(os.getuid()),
        )


    def _ensure_activation(self) -> str:
        """Return activationDigest for this state root; create if absent."""
        if self.activation_path.exists():
            obj = read_json(self.activation_path)
            digest = obj.get("activationDigest")
            if not isinstance(digest, str):
                raise GrantError("activationDigest")
            require_hex(digest, 32)
            return digest
        epoch = to_hex(os.urandom(32))
        created = int(time.time())
        # Identity of this activation epoch (not a crown; binds grants).
        preimage = {"createdAt": created, "epoch": epoch, "kind": "aukora-activation/v1-toy"}
        digest = sha256_hex(canonicalize_bytes(preimage))
        write_json(
            self.activation_path,
            {
                "activationDigest": digest,
                "createdAt": created,
                "epoch": epoch,
                "kind": "aukora-activation/v1-toy",
            },
        )
        return digest

    def restart_activation(self) -> str:
        """Simulate restart into a new activation epoch (non-portable grants die)."""
        if self.activation_path.exists():
            self.activation_path.unlink()
        self.activation_digest = self._ensure_activation()
        return self.activation_digest

    def _save_state(self) -> None:
        write_json(self.state_path, self.state)

    def _reload_state(self) -> None:
        if self.state_path.exists():
            self.state = read_json(self.state_path)
        else:
            self.state = {"active": None}
        # Activation may have been restarted under another handle.
        if self.activation_path.exists():
            self.activation_digest = self._ensure_activation()

    def _keys(self) -> tuple[bytes, bytes, bytes, bytes]:
        gov_path = self.out / "governor.sk"
        iss_path = self.out / "issuer.sk"
        if not gov_path.exists():
            raise GrantError("missing governor seed — run demo/keygen")
        gov = require_hex(gov_path.read_text().strip(), 32)
        iss = require_hex(iss_path.read_text().strip(), 32)
        return gov, public_from_seed(gov), iss, public_from_seed(iss)

    def _patentee_keys(self) -> tuple[bytes, bytes]:
        sk_path = self.out / "patentee.sk"
        if not sk_path.exists():
            raise PatentLicenseError(
                "missing patentee root seed — run demo/keygen"
            )
        sk = require_hex(sk_path.read_text().strip(), 32)
        return sk, public_from_seed(sk)

    def _find_load_entry(self, entry_hash: str) -> dict | None:
        for e in self.aura.entries:
            body = e.get("body")
            if not isinstance(body, dict):
                continue
            if (
                e.get("hash") == entry_hash
                and body.get("kind") == "composition"
                and body.get("operation") == "load"
            ):
                return e
        return None

    def activate(
        self,
        *,
        operation: str,
        plugin_bytes: bytes,
        grant: dict | None,
        patent_license: dict | None = None,
        now: int | None = None,
        issued_at: int | None = None,
        nonce: str | None = None,
        revert_of: str = "",
        depth: int = 0,
        **kwargs: object,
    ) -> dict:
        print_ceilings()
        print("ATTENDANCE: reported-not-proven")
        # Mediator check BEFORE grant evaluation, plus in-process integrity.
        verify_mediator_integrity(self.mediator)
        self.mediator.require()
        # Reconstruction / advisory artifacts never mint authority.
        for name in RECONSTRUCTION_SUBSTITUTES:
            if name in kwargs and kwargs[name] is not None:
                raise GrantError(reconstruction_cannot_mint(name))
        # Role separation: only a grant may sit in the grant slot. A receipt,
        # checkpoint or patent license here is refused by role, not by crypto.
        if grant is not None and not looks_like_receipt(grant):
            admit(grant, GRANT_ROLE)
        # Receipt verify ≠ activate: a valid receipt is evidence, not a grant.
        if grant is not None and looks_like_receipt(grant):
            raise GrantError(EVIDENCE_NEVER_AUTHORIZES)
        if grant is None:
            raise GrantError(NO_GRANT)
        now = int(time.time()) if now is None else now
        digest = plugin_digest(plugin_bytes)
        # Unload must name the composition that is actually loaded.
        if operation == "unload" and self.state.get("active"):
            active_digest = self.state["active"].get("pluginDigest")
            if active_digest != digest:
                raise GrantError(UNLOAD_PLUGIN_MISMATCH)
        envelope = coeffect_digest(os.getuid())
        composition = self.composition_for(
            operation=operation, plugin_bytes=plugin_bytes
        )
        composition_digest_now = composition_digest_of(composition)
        strict = self.mediator.require_patent_license

        with StateLock(self.lock_path):
            self._reload_state()
            # Reload aura entries under lock so two processes cannot fork
            # settled history — mutate in place so callers holding loader.aura
            # do not go stale.
            self.aura.entries = []
            if self.aura.store.exists():
                self.aura._load()
            # Re-check mediator under lock (disable may have raced).
            verify_mediator_integrity(self.mediator)
            self.mediator.require()

            patent_refs: dict | None = None
            if strict:
                if patent_license is None:
                    raise PatentLicenseError(PATENT_LICENSE_REQUIRED_MSG)
                _gov_seed, gov_pk, _, _ = self._keys()
                _pat_seed, pat_pk = self._patentee_keys()
                verify_patent_license(
                    patent_license,
                    now=now,
                    want_scope=digest,
                    want_licensee=to_hex(gov_pk),
                    want_patentee=to_hex(pat_pk),
                )
                self.patent_nonces.reserve(patent_license["nonce"])
                patent_refs = {
                    "patentDocketId": patent_license["patentDocketId"],
                    "patentLicenseNonce": patent_license["nonce"],
                }

            _gov_seed, gov_pk, _, _ = self._keys()
            # Session binding: a grant that pins a session is refused unless
            # that exact session is presented. A grant that pins none stays
            # unpinned — absence of a session is not a session.
            raw_session = kwargs.get("session")
            if raw_session is not None and not isinstance(raw_session, str):
                raise GrantError(GRANT_SESSION_MISMATCH)
            want_session = session_digest(raw_session) if raw_session else None
            if want_session is None and grant.get("sessionDigest") is not None:
                raise GrantError(GRANT_SESSION_MISMATCH)
            # Verify bindings + signature without in-memory spent set;
            # atomic reserve is the one-use gate. Depth is blast-radius.
            # Pin governorPk + activationDigest (unless portable kind), and
            # pin subject + session + composition so the grant authorizes
            # exactly this activation and nothing adjacent to it.
            verify_grant(
                grant,
                now=now,
                want_operation=operation,
                want_plugin=digest,
                want_coeffect=envelope,
                want_depth=depth,
                want_governor_pk=to_hex(gov_pk),
                want_activation=self.activation_digest,
                want_subject=self.subject_digest,
                want_session=want_session,
                want_composition=composition_digest_now,
                parent=kwargs.get("parent_grant"),
                spent=None,
            )
            nonce = grant["nonce"]
            self.nonces.reserve(nonce)
            # Durable boundary BEFORE the effect: from here on the authority is
            # provably consumed, so the settlement must be accounted for.
            self.settlements.begin(
                nonce=nonce,
                operation=operation,
                intent={
                    "compositionDigest": composition_digest_now,
                    "pluginDigest": digest,
                    "subjectDigest": self.subject_digest,
                },
            )
            self._hook("after_nonce_reserved")

            if operation == "load":
                if self.state.get("active"):
                    raise GrantError("already loaded")
                (self.out / "plugin.bin").write_bytes(plugin_bytes)
                self._hook("after_effect")
                self.state["active"] = {
                    "pluginDigest": digest,
                    "pluginId": PLUGIN_ID,
                    "subjectDigest": self.subject_digest,
                }
            elif operation == "unload":
                if not self.state.get("active"):
                    raise GrantError("nothing loaded")
                if not revert_of:
                    raise GrantError(UNLOAD_REVERTOF_REQUIRED)
                prior = self._find_load_entry(revert_of)
                if prior is None:
                    raise GrantError(UNLOAD_REVERTOF_UNKNOWN)
                if prior["body"].get("pluginDigest") != digest:
                    raise GrantError(UNLOAD_PLUGIN_MISMATCH)
                plugin_path = self.out / "plugin.bin"
                if plugin_path.exists():
                    plugin_path.rename(self.out / "plugin.bin.unloaded")
                self._hook("after_effect")
                self.state["active"] = None
            else:
                raise GrantError("operation")
            self._save_state()
            self._hook("after_state_write")

            rec = self.aura.append(
                {
                    "kind": "composition",
                    "operation": operation,
                    "pluginId": PLUGIN_ID,
                    "pluginDigest": digest,
                    "settlementNonce": nonce,
                    "subjectDigest": self.subject_digest,
                }
            )
            self._hook("after_aura_append")
            _gov_seed, _gov_pk, iss_seed, iss_pk = self._keys()
            composition_body = {
                "coeffectEnvelopeDigest": envelope,
                "compositionDigest": composition_digest_now,
                "operation": operation,
                "pluginDigest": digest,
                "pluginId": PLUGIN_ID,
                "revertOf": revert_of,
                "subjectDigest": self.subject_digest,
            }
            if patent_refs is not None:
                composition_body.update(patent_refs)
            receipt = issue_receipt(
                seed=iss_seed,
                issuer_pk=iss_pk,
                kind=KIND_LIVE,
                issued_at=int(time.time()) if issued_at is None else issued_at,
                nonce=nonce or to_hex(os.urandom(32)),
                aura=self.aura.entry_view(rec["seq"]),
                composition=composition_body,
            )
            name = f"receipt-{operation}.json"
            write_json(self.out / name, receipt)
            self._hook("after_receipt_write")
            # Only now is the settlement committed. Before this line the
            # outcome is INDETERMINATE, never success.
            self.settlements.commit(nonce)
            return {"aura": rec, "receipt": receipt}

    def _hook(self, name: str) -> None:
        fn = getattr(self.hooks, name, None)
        if callable(fn):
            fn()

    def _settled_nonces(self) -> set[str]:
        """Settlement nonces that reached the Aura append."""
        found: set[str] = set()
        for entry in self.aura.entries:
            body = entry.get("body")
            if not isinstance(body, dict):
                continue
            nonce = body.get("settlementNonce")
            if isinstance(nonce, str):
                found.add(nonce)
        return found

    def reopen(self) -> dict:
        """Cold reopen: account for every settlement that never committed.

        Returns a report whose findings are INDETERMINATE or
        AUTHORITY_CONSUMED_EFFECT_UNKNOWN. Neither is success and neither is a
        clean refusal. A consumed grant never disappears from accounting.
        """
        try:
            pending = self.settlements.pending()
        except SettlementError as exc:
            return {
                "findings": [
                    {"finding": SETTLEMENT_JOURNAL_UNREADABLE, "detail": str(exc)}
                ],
                "ok": False,
            }
        findings = classify(pending, self._settled_nonces())
        return {"findings": findings, "ok": not findings}

    def cold_check(self) -> dict:
        """Detect state that did not come from the governed path.

        Direct same-UID tampering with loader-state.json is detectable here:
        an active composition with no matching Aura load entry was never
        authorized. Detecting it does not make the toy tamper-proof — same UID
        can also rewrite this check. See CEILINGS.md.
        """
        report: dict = {"findings": [], "ok": True}
        active = self.state.get("active")
        if not active:
            return report
        wanted = active.get("pluginDigest")
        backed = any(
            isinstance(e.get("body"), dict)
            and e["body"].get("kind") == "composition"
            and e["body"].get("operation") == "load"
            and e["body"].get("pluginDigest") == wanted
            for e in self.aura.entries
        )
        if not backed:
            report["findings"].append(
                {
                    "finding": DIRECT_STATE_BYPASS,
                    "pluginDigest": wanted,
                    "detail": (
                        f"{STATE_UNBACKED_BY_AURA}: active composition has no "
                        "matching Aura load entry"
                    ),
                }
            )
            report["ok"] = False
        return report

    def work_stub(self) -> dict:
        if not self.state.get("active"):
            raise GrantError("work refused: no loaded plugin")
        payload = {
            "echo": "ok",
            "pluginDigest": self.state["active"]["pluginDigest"],
        }
        write_json(self.out / "work.json", payload)
        rec = self.aura.append({"kind": "work-stub", "echo": "ok"})
        return rec


def keygen(out: Path) -> None:
    from diamond.ed25519 import keygen as _keygen

    out.mkdir(parents=True, exist_ok=True)
    gov_sk, gov_pk = _keygen()
    iss_sk, iss_pk = _keygen()
    pat_sk, pat_pk = _keygen()
    write_secret(out / "governor.sk", to_hex(gov_sk) + "\n")
    (out / "governor.pk").write_text(to_hex(gov_pk) + "\n")
    write_secret(out / "issuer.sk", to_hex(iss_sk) + "\n")
    (out / "issuer.pk").write_text(to_hex(iss_pk) + "\n")
    write_secret(out / "patentee.sk", to_hex(pat_sk) + "\n")
    (out / "patentee.pk").write_text(to_hex(pat_pk) + "\n")


def issue_demo_grant(
    loader: Loader,
    operation: str,
    plugin_bytes: bytes,
    expiry: int,
    *,
    max_ttl: int = DEFAULT_MAX_TTL,
    max_depth: int | None = None,
    issued_at: int | None = None,
    portable: bool = False,
    subject_digest: str | None = None,
    session_digest: str | None = None,
    composition_digest: str | None = None,
) -> dict:
    gov_seed, gov_pk, _, _ = loader._keys()
    nonce = to_hex(os.urandom(32))
    now = int(time.time()) if issued_at is None else int(issued_at)
    if composition_digest is None:
        composition_digest = composition_digest_of(
            loader.composition_for(operation=operation, plugin_bytes=plugin_bytes)
        )
    grant = issue_grant(
        seed=gov_seed,
        governor_pk=gov_pk,
        plugin_digest=plugin_digest(plugin_bytes),
        coeffect_digest=coeffect_digest(os.getuid()),
        operation=operation,
        nonce=nonce,
        expiry=expiry,
        max_ttl=max_ttl,
        issued_at=now,
        activation_digest=loader.activation_digest,
        subject_digest=subject_digest or loader.subject_digest,
        composition_digest=composition_digest,
        session_digest=session_digest,
        max_depth=max_depth,
        portable=portable,
    )
    write_json(loader.out / f"grant-{operation}.json", grant)
    return grant


def issue_demo_patent_license(
    loader: Loader,
    plugin_bytes: bytes,
    expiry: int,
    *,
    docket_id: str = DEFAULT_DOCKET,
) -> dict:
    """Issue a one-use patent-license grant signed by patentee root."""
    _gov_seed, gov_pk, _, _ = loader._keys()
    pat_seed, pat_pk = loader._patentee_keys()
    nonce = to_hex(os.urandom(32))
    lic = issue_patent_license(
        seed=pat_seed,
        patentee_root_pk=pat_pk,
        patent_docket_id=docket_id,
        licensee_pk=gov_pk,
        scope_digest=plugin_digest(plugin_bytes),
        nonce=nonce,
        expiry=expiry,
    )
    write_json(loader.out / "patent-license.json", lic)
    return lic


def default_mediator() -> MediatorProvider:
    return MediatorProvider()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Composition loader")
    parser.add_argument("--out", default="out")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("keygen")
    act = sub.add_parser("activate")
    act.add_argument("--operation", required=True, choices=("load", "unload"))
    act.add_argument("--plugin", required=True)
    act.add_argument("--grant")
    act.add_argument("--patent-license", dest="patent_license")
    act.add_argument("--revert-of", default="")
    args = parser.parse_args(argv)

    out = Path(args.out)
    if args.cmd == "keygen":
        keygen(out)
        print_ceilings()
        print(f"wrote keys under {out}")
        return 0

    try:
        loader = Loader(out, mediator=default_mediator())
    except CompositionError as exc:
        print(f"REFUSE: {exc}", file=sys.stderr)
        return 2
    plugin_bytes = Path(args.plugin).read_bytes()
    grant = read_json(Path(args.grant)) if args.grant else None
    patent_license = (
        read_json(Path(args.patent_license)) if args.patent_license else None
    )
    try:
        result = loader.activate(
            operation=args.operation,
            plugin_bytes=plugin_bytes,
            grant=grant,
            patent_license=patent_license,
            revert_of=args.revert_of,
        )
    except (GrantError, MediatorError, CompositionError, PatentLicenseError) as exc:
        print(f"REFUSE: {exc}", file=sys.stderr)
        return 2
    print(result["receipt"]["aura"]["entryHash"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
