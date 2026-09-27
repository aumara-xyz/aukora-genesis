#!/usr/bin/env python3
"""The composition gate: a governed plugin load or unload at the loader seam.

THE GOVERNED UNIT IS THE COMPOSITION TRANSITION, NOT THE TOOL CALL. This is the
sentence the whole brick exists to make true, so it is worth being precise about
what changes when you believe it. If the tool call were the governed unit, then
authority would attach to *what the running code does* — every tool invocation
would need its own permission, and the interesting question would be whether the
code's behaviour stayed inside bounds. Under this gate the governed unit is the
transition that changes *what code is running at all*: one grant authorizes one
load or one unload, and once the transition is accepted the code that results is
code the gate allowed to exist. Composition is governed; the tool calls made
afterwards by the loaded code are not this gate's subject. A reader who wants
per-call governance is asking for a different seam, and this module does not
pretend to be it.

REFUSALS ARE NAMED, STABLE AND PRINTED. Every way a transition can be refused has
a constant in `refusals.py` and a non-zero exit. There is no path in this file
that swallows a refusal, returns an empty result, or applies part of a
transition and then reports failure: the accept path applies exactly one state
change and emits exactly one receipt, and the refuse path applies nothing.

    no grant                              -> NO_GRANT
    grant malformed / unknown field / alg -> GRANT_MALFORMED
    grant names other bytes               -> GRANT_BYTES_MISMATCH
    grant already spent (one-use nonce)   -> GRANT_SPENT
    grant for the other operation         -> GRANT_OPERATION_MISMATCH
    grant expired                         -> GRANT_EXPIRED
    mediator off                          -> MEDIATOR_OFF
    load while something is loaded        -> ALREADY_LOADED
    unload with nothing loaded            -> NOTHING_LOADED

ORDER OF CHECKS, AND WHY IT IS THIS ORDER. Structure, then the byte binding, then
the operation, then expiry, then the spend check, then the mediator, then the
signature, then the state precondition, then apply. Each step is placed so that a
caller reading the code gets the most specific true statement:

  * The byte binding is checked before the spend check. A grant for other bytes
    has not been "used" in any meaningful sense, and reporting `GRANT_SPENT` for
    it would tell an operator to look for a replay that never happened. This
    ordering is a deliberate consequence: presenting a grant for different bytes
    does **not** burn its nonce.
  * The spend check is a pure read, and consumption happens only after every
    verification has passed. A failed attempt therefore leaves the nonce
    unspent, so a caller can correct the mistake and retry with the same grant.
    The alternative — burning the nonce on first presentation — turns a typo into
    a need to mint a new grant, and it buys nothing: the nonce is consumed before
    the effect is applied, so an accepted transition can never be replayed.
  * The mediator is consulted *after* verification and *before* any state change.
    Off is a fail-closed answer about whether an effect may be applied, so it must
    be asked while it can still prevent the effect. Checking it earlier would also
    work, but reporting `MEDIATOR_OFF` for a malformed grant would hide the
    malformation.
  * The state precondition comes last among the refusals, so that a grant which is
    simply wrong reports as wrong even in a state where it could not have applied.

WHAT IS NOT CLAIMED, AND MUST NOT BE. This loader records bytes, binds them by
digest, and emits a receipt. It does **not** execute the plugin: `load` stores the
bytes and marks them active, and nothing in this gate runs them. It does not
isolate anything — the plugin would share this process and this uid, which is the
`SAME_UID` ceiling and means the binding is a *digest* binding, not a boundary.
It does not prove the bytes are safe, useful, or what a person intended. It does
not authenticate a human: the governor and issuer keys are generated locally by
`ensure_keys` below, which is `BOOTSTRAP_UNGATED`, and it is why every receipt
comes out `unattributed` / `NON-CONFORMING`.

EVIDENCE NEVER AUTHORIZES. A receipt is a record that a grant was spent on a
transition. Presenting a receipt, a valid chain, or a plausible Aura head never
authorizes anything. Grants authorize, and they authorize once.
"""
from __future__ import annotations

import os
import stat

import aura
import ceilings as ceilings_mod
import ed25519
import grant as grant_mod
import mediator as mediator_mod
import receipt as receipt_mod
from hexutil import (
    read_bytes,
    require_hex,
    sha256_hex,
    to_hex,
    write_bytes,
    write_json,
)
from refusals import (
    ALREADY_LOADED,
    CONSISTENCY_UNCHECKED,
    GRANT_MALFORMED,
    NO_GRANT,
    NOTHING_LOADED,
    RECEIPT_TAMPERED,
    CompositionRefusal,
)

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))

#: The plugin id this gate records. It is derived from the bytes rather than
#: configured, so two different byte strings can never be filed under one name.
PLUGIN_ID_PREFIX = "plugin-"

AURA_STORE = os.path.join("aura", "records.jsonl")
STATE_PATH = "composition-state.json"
NONCE_STORE = "spent-nonces.json"
GOVERNOR_SEED = "governor.sk"
ISSUER_SEED = "issuer.sk"
GOVERNOR_PUBLIC = "governor.pk"
ISSUER_PUBLIC = "issuer.pk"
BLOB_PATH = "plugin.blob"


def plugin_id(plugin_bytes: bytes) -> str:
    """The id is a function of the bytes, and it is short enough to read in a
    receipt. It is NOT a substitute for the digest: the digest is the binding, the
    id is a label."""
    return PLUGIN_ID_PREFIX + sha256_hex(plugin_bytes)[:16]


def plugin_digest(plugin_bytes: bytes) -> str:
    return sha256_hex(plugin_bytes)


def ensure_keys(state_dir: str) -> tuple[bytes, bytes, bytes, bytes]:
    """(governor_seed, governor_pk, issuer_seed, issuer_pk), generating on first use.

    These keys are written to the state directory in the clear, and that is
    correct for a disposable gate and wrong for anything else. The key material
    lives and dies with the state directory the self-check creates and deletes;
    it is never meant to leave it. A real deployment needs a custody story this
    brick does not have, which is exactly what `BOOTSTRAP_UNGATED` says.
    """
    paths = {
        "governor": (os.path.join(state_dir, GOVERNOR_SEED), os.path.join(state_dir, GOVERNOR_PUBLIC)),
        "issuer": (os.path.join(state_dir, ISSUER_SEED), os.path.join(state_dir, ISSUER_PUBLIC)),
    }
    seeds: dict[str, bytes] = {}
    publics: dict[str, bytes] = {}
    for label, (seed_path, public_path) in paths.items():
        if os.path.exists(seed_path):
            seed = require_hex(read_bytes(seed_path).decode("ascii").strip(), 32, f"{label} seed")
        else:
            seed, public = ed25519.keygen()
            os.makedirs(state_dir, exist_ok=True)
            # ── THE SEED IS CREATED 0600, IN ONE ATOMIC CALL, OR NOT AT ALL ──────────────────────────
            # **MEASURED, AND THE OLD SHAPE HAD THREE DEFECTS IN FIVE LINES.**
            #
            # `open(seed_path, "w")` creates the file with the process UMASK — commonly 0644 — **so between
            # that call and the `chmod` below, the seed was readable by every account on the machine.**
            # *The window is small and it is not zero*, and a seed is the one artefact where a small window
            # is the whole problem.
            #
            # **AND THE `chmod` FAILURE WAS SWALLOWED.** *`except OSError: pass` meant a filesystem that
            # refused the mode left the seed at 0644 with no record that hygiene had failed* — the comment
            # called the mode "hygiene, not custody", **which is true of the DISPOSABLE gate and false of the
            # code path, because the same function serves both and the caller cannot tell which it got.**
            # *A check whose failure is invisible is not a weaker check, it is an absent one.*
            #
            # **AND `"w"` TRUNCATES.** *The `os.path.exists` guard above makes that a TOCTOU rather than a
            # live bug*, but there is no reason to write a mode-check and a truncate into the same line.
            #
            # `os.open(..., O_CREAT | O_EXCL | O_WRONLY, 0o600)` applies the mode **AT CREATION, ATOMICALLY**
            # — *the file is never observable in a wider mode* — and **`O_EXCL` REFUSES an existing path**, so
            # two callers racing cannot truncate each other's seed and the TOCTOU closes.
            fd = os.open(seed_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(fd, (to_hex(seed) + "\n").encode("ascii"))
            finally:
                os.close(fd)
            # **AND THE MODE IS ASSERTED, NOT ASSUMED.** *`O_CREAT`'s mode is masked by the umask on most
            # systems*, so a permissive umask still yields a wider file — **and this is the failure the old
            # `except: pass` hid.** *Failing loudly here is the point: a seed at 0644 is a defect, not a
            # hygiene note, and a caller that cannot write a private seed must be told.*
            mode = stat.S_IMODE(os.stat(seed_path).st_mode)
            if mode != 0o600:
                raise CompositionRefusal(
                    "SEED_MODE_NOT_PRIVATE",
                    f"{seed_path} was created {oct(mode)}, not 0o600; a seed readable by another account "
                    f"is not a disposable seed",
                )
            with open(public_path, "w", encoding="ascii") as fh:
                fh.write(to_hex(public) + "\n")
        derived = ed25519.public_from_seed(seed)
        seeds[label] = seed
        publics[label] = derived
    return seeds["governor"], publics["governor"], seeds["issuer"], publics["issuer"]


class Loader:
    """An in-process composition gate over one state directory.

    Every governed method prints the ceilings before it decides anything, so an
    accepted transition and a refused one are equally accompanied by the limits
    that apply to them.
    """

    def __init__(
        self,
        state_dir: str,
        *,
        mediator: mediator_mod.Mediator | None = None,
        verbose_ceilings: bool = False,
    ):
        self.state_dir = os.path.abspath(state_dir)
        os.makedirs(self.state_dir, exist_ok=True)
        self.aura = aura.Aura(os.path.join(self.state_dir, AURA_STORE))
        self.nonces = grant_mod.NonceStore(os.path.join(self.state_dir, NONCE_STORE))
        self.mediator = mediator if mediator is not None else mediator_mod.Mediator()
        self.verbose_ceilings = verbose_ceilings
        self.state_path = os.path.join(self.state_dir, STATE_PATH)
        self.state: dict = {"active": None, "transitions": 0}
        if os.path.exists(self.state_path):
            loaded = receipt_mod.read(self.state_path)
            if not isinstance(loaded, dict) or "active" not in loaded:
                raise CompositionRefusal(
                    GRANT_MALFORMED, f"composition state at {self.state_path} is malformed"
                )
            self.state = loaded
        governor_seed, governor_pk, issuer_seed, issuer_pk = ensure_keys(self.state_dir)
        # Hex, not bytes: a grant records `governorPk` as hex, and a comparison between a
        # bytes object and a hex string is never equal — it does not raise, it just silently
        # refuses every honest grant. Types are normalised here, once, at the boundary.
        self.governor_seed, self.issuer_seed = governor_seed, issuer_seed
        self.governor_pk = governor_pk if isinstance(governor_pk, str) else governor_pk.hex()
        self.issuer_pk = issuer_pk if isinstance(issuer_pk, str) else issuer_pk.hex()

    # ── presentation ──────────────────────────────────────────────────────────────────────

    def announce(self) -> None:
        """The ceilings, then the mediator's own state. Printed on every path."""
        ceilings_mod.print_ceilings(verbose=self.verbose_ceilings)
        print(self.mediator.describe())

    def blob_path(self) -> str:
        return os.path.join(self.state_dir, BLOB_PATH)

    # ── the governed transitions ──────────────────────────────────────────────────────────

    def load(self, plugin_bytes: bytes, grant: dict | None, *, now: int | None = None,
             idempotent_nonce: bool = False) -> dict:
        """Load `plugin_bytes` under `grant`. Returns the emitted receipt."""
        return self._transition("load", plugin_bytes, grant, now=now,
                                idempotent_nonce=idempotent_nonce)

    def unload(self, plugin_bytes: bytes, grant: dict | None, *, now: int | None = None,
               idempotent_nonce: bool = False) -> dict:
        """Unload the plugin whose bytes are `plugin_bytes`, under `grant`."""
        return self._transition("unload", plugin_bytes, grant, now=now,
                                idempotent_nonce=idempotent_nonce)

    def _transition(
        self, operation: str, plugin_bytes: bytes, grant: dict | None, *, now: int | None,
        idempotent_nonce: bool = False,
    ) -> dict:
        self.announce()
        if not isinstance(plugin_bytes, (bytes, bytearray)):
            raise CompositionRefusal(
                GRANT_MALFORMED, f"plugin bytes must be bytes, got {type(plugin_bytes).__name__}"
            )
        plugin_bytes = bytes(plugin_bytes)

        # 1. There must be a grant at all. An ungoverned transition is not a
        #    transition this gate performs.
        if grant is None:
            raise CompositionRefusal(
                NO_GRANT,
                f"no grant presented for {operation}; a composition transition requires a one-use "
                "grant naming the operation and the exact bytes",
            )

        # 2. The bytes, bound before anything else can be said about them.
        digest = plugin_digest(plugin_bytes)
        identifier = plugin_id(plugin_bytes)
        envelope = grant_mod.coeffect_digest(os.getuid())
        timestamp = receipt_mod.now() if now is None else int(now)

        # 3. Full verification. Refusals from here carry their own codes.
        grant_mod.verify(
            grant,
            now=timestamp,
            want_operation=operation,
            want_plugin=digest,
            want_coeffect=envelope,
            # The authority, not the document's own claim about it. `self.governor_pk` is the
            # key this installation generated (or was configured with) and is the only key a
            # grant may be signed under here.
            want_governor_pk=self.governor_pk,
            spent=self.nonces,
            idempotent_nonce=idempotent_nonce,
        )

        # 4. The mediator, asked while it can still prevent the effect.
        self.mediator.require_enabled()

        # 5. The state precondition, having established the grant is genuine.
        active = self.state.get("active")
        if operation == "load":
            if active:
                raise CompositionRefusal(
                    ALREADY_LOADED,
                    f"a plugin is already loaded ({active.get('pluginId')}, "
                    f"{str(active.get('pluginDigest'))[:16]}…); this gate does not swap — unload "
                    "first, under its own grant",
                )
        else:
            if not active:
                raise CompositionRefusal(
                    NOTHING_LOADED,
                    f"unload refused: no plugin is loaded, so there is nothing for digest "
                    f"{digest[:16]}… to unload",
                )
            if active.get("pluginDigest") != digest:
                raise CompositionRefusal(
                    NOTHING_LOADED,
                    f"unload refused: the loaded plugin's digest is "
                    f"{str(active.get('pluginDigest'))[:16]}… but the bytes presented hash to "
                    f"{digest[:16]}…; the grant binds bytes that were never loaded",
                )

        # 6. Everything verified. Consume the one-use nonce, then apply exactly one
        #    state change. The nonce is written before the effect, so a crash here
        #    leaves a grant spent and unused rather than reusable.
        if idempotent_nonce and self.nonces.reserved_by_gate(grant["nonce"]):
            self.nonces.consume_idempotent(grant["nonce"])
        else:
            self.nonces.consume(grant["nonce"])
        prior_head = self.aura.head()
        prior_transitions = int(self.state.get("transitions", 0))
        if operation == "load":
            write_bytes(self.blob_path(), plugin_bytes)
            self.state["active"] = {
                "pluginId": identifier,
                "pluginDigest": digest,
                "loadedAt": timestamp,
                "loadedAtSeq": self.aura.size() + 1,
            }
            revert_of = ""
        else:
            self.state["active"] = None
            revert_of = str(active.get("pluginDigest"))
        self.state["transitions"] = prior_transitions + 1
        self._save_state()

        # 7. The log entry, then the receipt that names its position.
        #
        # The composition block now carries Diamond's two required bindings. MEASURED against Diamond
        # tip `c96c588`: its closed set is seven fields and Genesis emitted five, so a receipt minted
        # here was refused with `composition closed fields` BEFORE any signature was checked — a
        # structural refusal that correct signing cannot close.
        #
        # `subjectDigest` binds the SUBJECT this transition acts on. Diamond's zipper
        # (`labs/contract-pin/zipper_test.py` 107 / 126-127) hashes
        # `os.path.abspath(gate.blob_path())` as
        # `{"domain": "aukora-subject/v1-toy", "subject": <abspath>}`
        # (`diamond/subject.py`, SHA `cac9f69`; the same blob at `b80ab8e`). Here that path is
        # `os.path.abspath(os.path.join(state_dir, BLOB_PATH))` — the file `load`
        # already wrote — not `plugin_id(plugin_bytes)`. Do not hash `kind`/`principal`.
        subject_path = os.path.abspath(os.path.join(self.state_dir, BLOB_PATH))
        subject_digest = receipt_mod.subject_digest_for(subject_path)
        composition_digest = receipt_mod.composition_digest_for(
            operation=operation,
            plugin_digest=digest,
            subject_digest=subject_digest,
            coeffect_envelope_digest=envelope,
        )
        composition_block = {
            "coeffectEnvelopeDigest": envelope,
            "compositionDigest": composition_digest,
            "operation": operation,
            "pluginId": identifier,
            "pluginDigest": digest,
            "revertOf": revert_of,
            "subjectDigest": subject_digest,
        }
        entry = self.aura.append(
            {
                "kind": "composition",
                "operation": operation,
                "pluginId": identifier,
                "pluginDigest": digest,
                "coeffectEnvelopeDigest": envelope,
                "compositionDigest": composition_digest,
                "subjectDigest": subject_digest,
                "revertOf": revert_of,
            }
        )
        receipt = receipt_mod.issue(
            seed=self.issuer_seed,
            issuer_pk=self.issuer_pk,
            kind=receipt_mod.KIND_LIVE,
            issued_at=timestamp,
            nonce=receipt_mod.fresh_nonce(),
            aura=self.aura.entry_view(entry["seq"]),
            composition=composition_block,
        )
        receipt_path = os.path.join(
            self.state_dir, f"receipt-{operation}-{entry['seq']:03d}.json"
        )
        receipt_mod.write(receipt_path, receipt)
        approval, conformance = receipt_mod.derive_class(receipt)
        return {
            "receipt": receipt,
            "receiptPath": receipt_path,
            "entry": entry,
            "priorHead": prior_head,
            "class": approval,
            "conformance": conformance,
            "consistency": CONSISTENCY_UNCHECKED,
        }

    def _save_state(self) -> None:
        write_json(self.state_path, self.state)

    # ── checkpoints ───────────────────────────────────────────────────────────────────────

    def checkpoint(self, path: str) -> dict:
        """Write this log's current observation to `path`.

        Retaining and presenting are the same act here — both write the head and
        root over the current prefix. They are different acts in Phase 0 because
        there the presented document must also carry a proof *from* a retained
        size; here the reader recomputes both roots from the log, so a proof would
        be carrying the same information twice in a form that can disagree with
        itself.
        """
        checkpoint = self.aura.checkpoint()
        write_json(path, checkpoint)
        return checkpoint

    # ── the receipt court ─────────────────────────────────────────────────────────────────

    def verify_receipt_against_pair(
        self, receipt: dict, retained: dict | None, presented: dict | None
    ) -> dict:
        """Check a receipt against this log, and its head against a retained pair.

        Three questions, deliberately separated in the result:

        `signature`    does the receipt verify, and does it name this installation's
                       issuer key? A receipt from another issuer is a valid document
                       about another system, not evidence about this one.
        `position`     is the Aura entry the receipt names really in this log, at
                       that sequence, with that entry hash, that prev hash and that
                       prior head? A receipt whose `aura` block describes an entry
                       this log does not contain is refused: the receipt is about
                       some other log, or the log was replaced.
        `consistency`  `APPEND_ONLY` / `OBSERVATION_CONFLICT` / `UNDETERMINED` when a
                       retained and a presented document were both supplied, and
                       `CONSISTENCY_UNCHECKED` when either is missing.

        The consistency verdict is computed from the *retained and presented
        documents*, not from the receipt, because that is the only way to answer
        it: a receipt naming a head says nothing about whether some earlier
        observation is an ancestor of it. When no pair is supplied this returns
        the unchecked word rather than a verdict derived from the single log in
        hand — a log can always agree with itself, so checking it against itself
        proves nothing and printing a verdict from it would be a false claim.
        """
        result = {
            "signature": "unknown",
            "position": "unknown",
            "consistency": CONSISTENCY_UNCHECKED,
            "class": "unattributed",
            "conformance": "NON-CONFORMING",
            "attendance": receipt_mod.ATTENDANCE,
            "notes": [],
        }
        approval, conformance, _ = receipt_mod.verify_receipt(
            receipt, expect_pk=self.issuer_pk
        )
        result["signature"] = "ok"
        result["class"] = approval
        result["conformance"] = conformance

        # Position: the named entry must exist and must be the one described.
        block = receipt["aura"]
        seq = block["seq"]
        if seq > self.aura.size():
            raise CompositionRefusal(
                RECEIPT_TAMPERED,
                f"receipt names Aura seq {seq} but this log has {self.aura.size()} entries",
            )
        record = self.aura.entries[seq - 1]
        if record["hash"] != block["entryHash"]:
            raise CompositionRefusal(
                RECEIPT_TAMPERED,
                f"receipt names entryHash {block['entryHash'][:16]}… but seq {seq} of this log "
                f"hashes to {record['hash'][:16]}…",
            )
        if record["prev"] != block["prevHash"]:
            raise CompositionRefusal(
                RECEIPT_TAMPERED,
                f"receipt names prevHash {block['prevHash'][:16]}… but seq {seq} of this log "
                f"chains from {record['prev'][:16]}…",
            )
        if self.aura.head_before(seq) != block["priorHead"]:
            raise CompositionRefusal(
                RECEIPT_TAMPERED,
                f"receipt names priorHead {block['priorHead'][:16]}… but the head before seq "
                f"{seq} was {self.aura.head_before(seq)[:16]}…",
            )
        result["position"] = "ok"
        result["notes"].append(
            f"entry seq {seq} present, position and prior head confirmed by recomputation"
        )

        if retained is None or presented is None:
            result["notes"].append(
                "no retained/presented Aura pair supplied, so the consistency question is "
                "UNANSWERED — this is not a verdict of agreement"
            )
            return result
        verdict, note = self.aura.verify_consistency(retained, presented)
        result["consistency"] = verdict
        result["notes"].append(note)
        return result
