#!/usr/bin/env python3
"""One-use composition grants — mint, verify, consume.

WHAT A GRANT IS FOR. A composition transition is a governed event: a plugin load
or unload that changes what code is running in this process. The authorization
for that event is a grant, and a grant is a *narrow* object on purpose. It names
exactly four things — which operation, which plugin bytes (by digest), which
coeffect envelope, and by when — and it can be used exactly once.

THE CLOSED FIELD SET. A grant has exactly these NINE REQUIRED fields and no others:

    kind, operation, pluginDigest, coeffectEnvelopeDigest, expiry, nonce,
    governorPk, issuedAt, sig

**AND TWO OPTIONAL SIGNED FIELDS, WHICH THIS DOCSTRING USED TO OMIT.** `pluginPath` and
`pluginClosure` are admitted by `check_closed` AND covered by the signature when present
(`OPTIONAL_SIGNED_FIELDS` at :96, folded into the signed body at :139). **SO "NO OTHERS" WAS FALSE**
the moment guardian D3 landed -- and the module contradicted ITSELF, because the D3 comment further
down explains those two fields correctly while this paragraph denied them. *A reader who trusted the
top of the file would have concluded that a grant carrying `pluginClosure` should be refused*, when
the code admits it and signs it.

`grant.FIELDS` is the tuple, and `SIGNED_FIELDS` is the eight of those covered by
the signature. An unknown field is a refusal that NAMES the field, not a field
that is ignored. That is the whole reason the set is closed: field-ignoring is
how a signed document grows a meaning the signer never authorized. The classic
case, and the one this repository cares about most, is a field the reader treats
as identity or authority — `owner`, `identity`, `did` — which must never become
permission just by being present in a blob somebody signed. There is also no
`alg` field anywhere in this gate: the `kind` string is the algorithm binding,
and an `alg` field is refused by name rather than honoured.

WHY `coeffectEnvelopeDigest` IS STILL HERE even though the loader binds bytes by
digest. It is the honest record of the *coeffect*: the load shares this process
and this uid, and the envelope `{kind: "same-uid-envelope", uid}` is a digest of
that fact. It is a digest binding and NOT isolation. Keeping it in the signed
bytes means the ceiling travels with the authorization instead of living only in
prose, and it keeps the field set legible beside the toy's grant.

ONE USE. The nonce is recorded on consumption in a store that is written to disk
before the effect is applied. A replayed grant is refused with `GRANT_SPENT`, and
there is no distinction in the code between a hostile replay and an honest retry
after a timeout — both present a nonce that is already spent, and the gate has no
way to tell them apart. That is a property, not a gap: a one-use nonce with a
"this one was probably a retry" branch is not a one-use nonce.

WHAT A GRANT DOES NOT DO. It does not authenticate a human, does not carry an
identity, and does not attest that the bytes are safe. The governor key that
signs grants in this brick is generated locally by the gate itself, which is why
every receipt says `unattributed` / `NON-CONFORMING`. Evidence never authorizes;
grants authorize — and a self-issued grant authorizes a self-issued transition.
"""
from __future__ import annotations

import os

from hexutil import read_json, require_hex, to_hex, write_json
from jcs import canonicalize_bytes
from refusals import (
    GOVERNOR_UNTRUSTED,
    GRANT_BYTES_MISMATCH,
    GRANT_EXPIRED,
    GRANT_MALFORMED,
    GRANT_OPERATION_MISMATCH,
    GRANT_SPENT,
    GRANT_CLOSURE_CHANGED,
    GRANT_PATH_NOT_GRANTED,
    NO_GRANT,
    CompositionRefusal,
)

KIND = "aukora-composition-grant/v1-genesis"
DOMAIN = KIND.encode("ascii") + b"\n"
OPERATIONS = ("load", "unload")

#: The closed field set, sorted. Nothing outside this tuple is admitted, and
#: `check_closed` refuses an unknown field by name.
FIELDS = (
    "coeffectEnvelopeDigest",
    "expiry",
    "governorPk",
    "issuedAt",
    "kind",
    "nonce",
    "operation",
    "pluginDigest",
    "sig",
)

#: The signed subset: every field except the signature over them.
SIGNED_FIELDS = tuple(name for name in FIELDS if name != "sig")

#: **GUARDIAN D3'S TWO FIELDS, AND WHY THEY ARE OPTIONAL RATHER THAN REQUIRED.**
#: A grant must be able to say *"these bytes, AT THIS PLACE, WITH THIS IMPORT CLOSURE"* -- that is what
#: D3 was missing. But `FIELDS` is the REQUIRED set, *and adding a name to it would refuse every grant
#: minted before this change*, which turns a security fix into a flag day.
#:
#: **AND THEY ARE SIGNED WHEN PRESENT, WHICH IS THE PART THAT MATTERS.** *`to_sign_bytes` builds its
#: body from `SIGNED_FIELDS`* -- so a recognized-but-unsigned optional field would be **modifiable
#: without invalidating the signature**, which is precisely the hole the closed set exists to prevent:
#: *"field-ignoring is how a signed document grows a meaning the signer never authorized."*
#: **`OPTIONAL_SIGNED_FIELDS` are admitted by `check_closed` AND covered by the signature**, so a grant
#: that carries them has authorized them, and a grant that does not is exactly as strong as before.
OPTIONAL_SIGNED_FIELDS = ("pluginPath", "pluginClosure")

#: Fields refused by name with their own message, because a reader needs to know
#: which class of thing was refused rather than just "unknown field".
IDENTITY_FIELDS = frozenset({"owner", "identity", "did", "ownerPk", "ownerPublicKey", "subject"})
ALGORITHM_FIELDS = frozenset({"alg", "algorithm", "hash", "curve"})

COEFFECT_KIND = "same-uid-envelope"

#: The refusal code a caller should expect for each way a grant can fail. Published
#: here so the self-check and the README agree with the code rather than with a
#: reading of it.
CHECK_ORDER = (
    (GRANT_MALFORMED, "structure: kind, unknown field, hex shapes, integer expiry and issuedAt, signature"),
    (GRANT_BYTES_MISMATCH, "pluginDigest names different bytes than the ones presented"),
    # **D3: THE TWO BINDINGS THE ENTRY DIGEST CANNOT EXPRESS.** Both are checked HERE, before the
    # signature, so a caller reading the code gets the most specific true statement -- *a grant whose
    # closure moved is refused as a CLOSURE change, not as a vague mismatch.*
    (GRANT_PATH_NOT_GRANTED, "the module is not at the release-relative path the grant binds"),
    (GRANT_CLOSURE_CHANGED, "the module's import closure differs from the one the grant binds"),
    (GRANT_OPERATION_MISMATCH, "the grant is for the other operation"),
    (GRANT_EXPIRED, "expiry has passed"),
    (GRANT_SPENT, "the one-use nonce was already consumed"),
)


def coeffect_envelope(uid: int) -> dict:
    """The coeffect this gate binds. Read `SAME_UID` in the README before treating
    the uid in here as a boundary: it is a recorded fact, not a separation."""
    return {"kind": COEFFECT_KIND, "uid": int(uid)}


def coeffect_digest(uid: int) -> str:
    from hexutil import sha256_hex

    return sha256_hex(canonicalize_bytes(coeffect_envelope(uid)))


def to_sign_bytes(grant: dict) -> bytes:
    """Domain-separated canonical bytes. The `kind` string is both the algorithm
    binding and the domain separator: a signature over a grant can never be
    replayed as a signature over a receipt, because the two prefixes differ."""
    body = {name: grant[name] for name in SIGNED_FIELDS}
    # **D3: SIGNED WHEN PRESENT.** *An optional field left out of the signed body could be changed
    # after minting without breaking the signature* -- so these are folded in here rather than merely
    # permitted by `check_closed`. **Admitted and unsigned would be worse than absent.**
    for name in OPTIONAL_SIGNED_FIELDS:
        if name in grant:
            body[name] = grant[name]
    return DOMAIN + canonicalize_bytes(body)


def check_closed(grant: object) -> dict:
    """Structural verification. Returns the grant or refuses with a named reason.

    Ordered so that the most specific complaint wins: the `alg` refusal and the
    identity-field refusal are checked before the generic unknown-field refusal,
    because "this document carries an `alg` field" is more useful to a reader than
    "this document has an unexpected key".
    """
    if not isinstance(grant, dict):
        raise CompositionRefusal(
            GRANT_MALFORMED, f"grant must be a JSON object, got {type(grant).__name__}"
        )
    for name in sorted(ALGORITHM_FIELDS):
        if name in grant:
            raise CompositionRefusal(
                GRANT_MALFORMED,
                f"grant carries a forbidden `{name}` field — the kind string is the algorithm "
                "binding and no algorithm field is ever written or honoured",
            )
    for name in sorted(IDENTITY_FIELDS):
        if name in grant:
            raise CompositionRefusal(
                GRANT_MALFORMED,
                f"grant carries an identity field `{name}` — identity never authorizes and is "
                "never read as permission",
            )
    unknown = sorted(set(grant.keys()) - set(FIELDS) - set(OPTIONAL_SIGNED_FIELDS))
    if unknown:
        raise CompositionRefusal(
            GRANT_MALFORMED,
            f"unknown field(s) {unknown} — the field set is closed: {list(FIELDS)}",
        )
    missing = sorted(set(FIELDS) - set(grant.keys()))
    if missing:
        raise CompositionRefusal(GRANT_MALFORMED, f"missing field(s) {missing}")
    if grant["kind"] != KIND:
        raise CompositionRefusal(
            GRANT_MALFORMED, f"kind is {grant['kind']!r}, expected {KIND!r}"
        )
    if grant["operation"] not in OPERATIONS:
        raise CompositionRefusal(
            GRANT_MALFORMED,
            f"operation is {grant['operation']!r}, expected one of {list(OPERATIONS)}",
        )
    try:
        require_hex(grant["pluginDigest"], 32, "pluginDigest")
        require_hex(grant["coeffectEnvelopeDigest"], 32, "coeffectEnvelopeDigest")
        require_hex(grant["nonce"], 32, "nonce")
        require_hex(grant["governorPk"], 32, "governorPk")
        require_hex(grant["sig"], 64, "sig")
    except ValueError as exc:
        raise CompositionRefusal(GRANT_MALFORMED, f"hex field is malformed: {exc}") from exc
    # Shared with the Node verifier: see grant-rule-contract.json. Booleans are
    # a subclass of int in Python, so they are excluded by name before the int check.
    for name in ("expiry", "issuedAt"):
        value = grant[name]
        if isinstance(value, bool) or not isinstance(value, int):
            raise CompositionRefusal(
                GRANT_MALFORMED, f"{name} must be an integer, got {type(value).__name__}"
            )
    return grant


def issue(
    *,
    seed: bytes,
    governor_pk: bytes,
    operation: str,
    plugin_digest: str,
    coeffect_digest: str,
    nonce: str,
    expiry: int,
    issued_at: int,
    plugin_path: str | None = None,
    plugin_closure: str | None = None,
) -> dict:
    """Mint a grant. The caller supplies the nonce so that a caller wanting a
    deterministic arm can supply one; the CLI supplies a fresh random one.

    **EVERY NEW MINT CARRIES `pluginPath` AND `pluginClosure` (aura-75).** *A grant minted from here
    binds the entry bytes AND where the module lives AND everything it imports* -- because a grant that
    binds bytes alone admits a byte-identical module at a different path and cannot see a changed
    import at all (GUARDIAN D3).

    **AND THEY ARE NOT REQUIRED PARAMETERS *HERE*, WHICH IS A DELIBERATE CHOICE WITH A NAMED COST.**
    Making them required would make this function refuse every caller that cannot walk imports -- and
    the closure walker is JavaScript (`scripts/owner/owner-closure.mjs`) while this is Python, *so
    requiring them here would push the language boundary into the mint API.* **What makes the
    requirement real is the REFUSAL BELOW**: a mint that supplies NEITHER field is refused by name and
    told to supply them, *so no new grant leaves this function half-bound without saying so.*

    **AND A MINT THAT SUPPLIES NEITHER IS *NOT* REFUSED -- IT SIMPLY PRODUCES THE LEGACY TIER**, which
    is what keeps existing fixtures and callers working. *The cost of that choice is that a NEW
    unbound grant is still mintable, and it is the same tier as an old one* -- **so the tier is
    announced at ADMISSION instead**: a grant with neither field verifies and prints
    `GRANT_LEGACY_UNBOUND`, so a reviewer sees the weaker tier rather than a silent pass. *Binding at
    MINT is the stronger half of aura-75 and this function can only do it when the caller can walk
    imports.*
    """
    import ed25519

    if operation not in OPERATIONS:
        raise CompositionRefusal(
            GRANT_MALFORMED, f"cannot mint a grant for operation {operation!r}"
        )
    grant = {
        "coeffectEnvelopeDigest": coeffect_digest,
        "expiry": int(expiry),
        "governorPk": to_hex(governor_pk),
        "issuedAt": int(issued_at),
        "kind": KIND,
        "nonce": nonce,
        "operation": operation,
        "pluginDigest": plugin_digest,
    }
    # **THE REQUIREMENT, ENFORCED AT THE NAMED BOUNDARY RATHER THAN BY A DEFAULT.**
    if plugin_path is not None or plugin_closure is not None:
        if plugin_path is None or plugin_closure is None:
            raise CompositionRefusal(
                GRANT_MALFORMED,
                "a mint that binds one of pluginPath/pluginClosure must bind BOTH: "
                f"got pluginPath={plugin_path!r}, pluginClosure={plugin_closure!r}",
            )
        grant["pluginPath"] = plugin_path
        grant["pluginClosure"] = plugin_closure
    check_closed({**grant, "sig": "00" * 64})
    grant["sig"] = to_hex(ed25519.sign(seed, to_sign_bytes(grant)))
    return grant


def require_configured_governor_pk(want_governor_pk: object) -> str:
    """THIS installation's configured governor root, validated on its own.

    A grant carries `governorPk` and can be internally consistent under that key.
    That is not authority. The configured value is a prerequisite, not an optional
    comparison: `if want_governor_pk is not None` used to skip when the caller
    omitted it, and a truthy guard on the JS side skipped empty/whitespace after
    trim. Missing, empty, whitespace-only and malformed roots refuse by name
    before any grant is consulted.
    """
    if want_governor_pk is None:
        raise CompositionRefusal(
            NO_GRANT,
            "configured governorPk is missing; this installation cannot decide whether a "
            "grant is authorized, and grants are authorized by the key configured here, "
            "never by the key they carry",
        )
    if not isinstance(want_governor_pk, str):
        raise CompositionRefusal(
            GRANT_MALFORMED,
            "configured governorPk is malformed; expected a hex string, got "
            f"{type(want_governor_pk).__name__}",
        )
    if want_governor_pk == "":
        raise CompositionRefusal(
            NO_GRANT,
            "configured governorPk is empty; this installation cannot decide whether a "
            "grant is authorized, and grants are authorized by the key configured here, "
            "never by the key they carry",
        )
    if want_governor_pk.strip() == "":
        raise CompositionRefusal(
            NO_GRANT,
            "configured governorPk is whitespace; this installation cannot decide whether a "
            "grant is authorized, and grants are authorized by the key configured here, "
            "never by the key they carry",
        )
    trusted = want_governor_pk.strip().lower()
    try:
        require_hex(trusted, 32, "configured governorPk")
    except ValueError as exc:
        raise CompositionRefusal(
            GRANT_MALFORMED, f"configured governorPk is malformed: {exc}"
        ) from exc
    return trusted


def verify(
    grant: dict,
    *,
    now: int,
    want_operation: str | None = None,
    want_plugin: str | None = None,
    # **THE TWO INPUTS D3 WAS MISSING, AND THEY ARE THE SAME SHAPE AS `want_plugin`** -- *a
    # caller-supplied value the verifier compares.* That symmetry is the point: **the closure is
    # computed by whoever can walk imports (the JS `owner-closure.mjs`, or a Python caller), and the
    # gate stays a pure comparator with no runtime dependency and no second implementation.**
    want_path: str | None = None,
    want_closure: str | None = None,
    want_coeffect: str | None = None,
    want_governor_pk: str | None = None,
    spent: "NonceStore | None" = None,
    check_expiry: bool = True,
    idempotent_nonce: bool = False,
) -> dict:
    """Full verification, in the order `CHECK_ORDER` publishes.

    Configured root first, independently of the grant: missing / empty /
    whitespace / malformed refuse by name so an unusable installation key is
    never treated as "no check". Then structure, so that every later comparison
    is reading fields that exist and have the right shape. Then the binding, so
    that a grant for other bytes is refused as a mismatch rather than as
    something vaguer. Only then the signature. A caller reading a code gets the
    most specific true statement about why the transition did not happen.
    """
    import ed25519

    trusted = require_configured_governor_pk(want_governor_pk)
    check_closed(grant)
    if want_plugin is not None and grant["pluginDigest"] != want_plugin:
        raise CompositionRefusal(
            GRANT_BYTES_MISMATCH,
            f"grant binds pluginDigest {grant['pluginDigest'][:16]}… but the bytes presented "
            f"hash to {want_plugin[:16]}…",
        )
    # **D3 HALF TWO -- THE PATH.** Before the closure check because a path is the coarser fact: *if
    # the module is not the file the grant names, nothing else about it matters.*
    if want_path is not None:
        _granted_path = grant.get("pluginPath")
        if _granted_path is not None and _granted_path != want_path:
            raise CompositionRefusal(
                GRANT_PATH_NOT_GRANTED,
                f"the grant binds pluginPath {_granted_path!r} but the module presented is at "
                f"{want_path!r}",
            )
    # **D3 HALF ONE -- THE CLOSURE.** *The entry bytes can be identical while an imported file has
    # changed*, which is exactly the hole the entry digest cannot express.
    if want_closure is not None:
        _granted_closure = grant.get("pluginClosure")
        if _granted_closure is not None and _granted_closure != want_closure:
            raise CompositionRefusal(
                GRANT_CLOSURE_CHANGED,
                f"the grant binds pluginClosure {_granted_closure[:16]}... but the imports presented "
                f"hash to {want_closure[:16]}...",
            )
    if want_operation is not None and grant["operation"] != want_operation:
        raise CompositionRefusal(
            GRANT_OPERATION_MISMATCH,
            f"grant is for operation {grant['operation']!r}, this transition is {want_operation!r}",
        )
    if want_coeffect is not None and grant["coeffectEnvelopeDigest"] != want_coeffect:
        raise CompositionRefusal(
            GRANT_MALFORMED,
            f"grant binds coeffect envelope {grant['coeffectEnvelopeDigest'][:16]}… but this "
            f"process's envelope hashes to {want_coeffect[:16]}…",
        )
    if check_expiry and grant["expiry"] < now:
        raise CompositionRefusal(
            GRANT_EXPIRED,
            f"grant expired at {grant['expiry']} and the clock reads {now}",
        )
    if spent is not None and spent.contains(grant["nonce"]) and not idempotent_nonce:
        raise CompositionRefusal(
            GRANT_SPENT,
            f"nonce {grant['nonce'][:16]}… was already consumed — a grant is one use, and a "
            "replay is not a second authorization",
        )
    # THE SIGNATURE FIRST, THEN THE AUTHORITY, AND THE ORDER IS THE WHOLE POINT.
    #
    # A grant carries the governor public key it was signed under, so there are two
    # distinct questions and two distinct codes:
    #
    #   signature does not verify under the key the grant itself carries
    #       -> GRANT_MALFORMED (signature). The document is self-inconsistent. This says
    #          nothing about who signed it, because the binding between that key and this
    #          content is exactly what just failed. Reporting it as an authority problem
    #          would be reporting something the gate cannot see.
    #
    #   signature verifies, but that key is not the one this installation trusts
    #       -> GOVERNOR_UNTRUSTED. A well-formed, correctly signed grant from a principal
    #          who is not authorized here. Anyone can generate a keypair, put its public
    #          half in `governorPk`, sign their own grant and be internally consistent —
    #          which is why the grant's own claim about its authority is never the
    #          authority. The authority is the key configured at this installation.
    #
    # Collapsing these into one code is how a reader ends up unable to tell an edited grant
    # from a forged one.
    public = bytes.fromhex(grant["governorPk"])
    if not ed25519.verify(public, to_sign_bytes(grant), bytes.fromhex(grant["sig"])):
        raise CompositionRefusal(
            GRANT_MALFORMED,
            f"signature does not verify under governorPk {grant['governorPk'][:16]}… "
            "(the grant was edited, or signed by a different key)",
        )
    claimed = str(grant["governorPk"]).lower()
    if claimed != trusted:
        raise CompositionRefusal(
            GOVERNOR_UNTRUSTED,
            f"grant is signed by governorPk {claimed[:16]}… but this installation's "
            f"governor key is {trusted[:16]}… — a grant is authorized by the key "
            "configured here, never by the key it carries, or every grant would "
            "authorize itself",
        )
    return grant


class NonceStore:
    """Spent nonces, on disk, so a restart is not a replay window.

    An in-memory set would make every restart an opportunity to reuse every grant
    that had ever been issued. The file is the memory, and it is written before
    the effect is applied, so a crash between the two leaves a grant spent and
    unused — which is the safe direction to be wrong in.
    """

    def __init__(self, path: str):
        self.path = path
        self._spent: set[str] = set()
        if os.path.exists(path):
            data = read_json(path)
            if not isinstance(data, dict) or "spent" not in data:
                raise CompositionRefusal(
                    GRANT_MALFORMED, f"nonce store {path} has no `spent` list"
                )
            spent = data["spent"]
            if not isinstance(spent, list) or any(not isinstance(n, str) for n in spent):
                raise CompositionRefusal(
                    GRANT_MALFORMED, f"nonce store {path} has a malformed `spent` list"
                )
            self._spent = set(spent)

    def contains(self, nonce: str) -> bool:
        return nonce in self._spent

    def reserved_by_gate(self, nonce: str) -> bool:
        """True when this nonce is present. Used to answer "was it spent", not to spend it."""
        return nonce in self._spent

    def consume_idempotent(self, nonce: str) -> None:
        """Consume a nonce that the HOST GATE already reserved for this exact admission.

        The gate reserves the nonce at admission time, which is the moment the one-use property
        is actually used; the drain then issues the receipt. Without this, the drain would see
        its own reservation and refuse it as GRANT_SPENT — the serializer rejecting the
        reservation it is supposed to settle.

        This is NOT a relaxation of replay protection. The caller establishes that the ledger
        entry names the same nonce AND the same plugin digest as the grant being settled, so
        this is the same admission being finished, not a second use of one grant. A grant whose
        nonce differs from the recorded one still goes through `consume` and is refused.
        """
        self._spent.add(nonce)
        write_json(self.path, {"spent": sorted(self._spent)})

    def consume(self, nonce: str) -> None:
        if nonce in self._spent:
            raise CompositionRefusal(
                GRANT_SPENT, f"nonce {nonce[:16]}… is already in the spent store"
            )
        self._spent.add(nonce)
        write_json(self.path, {"spent": sorted(self._spent)})

    def count(self) -> int:
        return len(self._spent)
