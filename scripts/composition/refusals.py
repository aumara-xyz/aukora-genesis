#!/usr/bin/env python3
"""Named refusal codes for the composition gate — the stable vocabulary.

WHY A SEPARATE MODULE. A refusal that a caller cannot match on is not a
refusal, it is a string. Every way this gate can say no has a constant here, and
those constants are the gate's public contract: the self-check asserts against
them, the README documents them, and nothing else in the tree is allowed to
spell one as a literal. If a code needs to change, it changes in exactly one
place and every arm that asserted the old one fails immediately.

STABILITY. These strings are append-only in practice. Renaming one silently
breaks every operator runbook and log query that greps for it, so a rename is a
breaking change and must be treated as one. Adding is cheap; removing is not.

WHAT A CODE IS NOT. A code names *why the transition was refused*. It is not a
severity, not a category for a UI, and not a claim about intent. `GRANT_SPENT`
means a nonce that was already consumed was presented again; it does not mean
the presenter is hostile — a retry after a timeout produces the same code, and
the gate cannot tell the two apart. That indistinguishability is a property of
the design (one-use nonces have no "was this a retry" branch), and the honest
reading of the code is the narrow one.
"""
from __future__ import annotations

# ── the grant seam ─────────────────────────────────────────────────────────────────────────

#: No grant was presented at all. The transition is ungoverned, so it does not happen.
NO_GRANT = "NO_GRANT"
#: A seed file was created with a mode wider than 0600. **ADDED IN aura-81**, because the loader
#: used to write the seed under the process umask and SWALLOW a failed chmod: *a seed readable
#: by another account is not a disposable seed, and the failure had no way to be reported.*
SEED_MODE_NOT_PRIVATE = "SEED_MODE_NOT_PRIVATE"

#: A grant was signed by a key that is not this installation's governor key.
#:
#: Distinct from GRANT_MALFORMED on purpose. A grant carries its own `governorPk`, so a
#: signature that verifies against that key proves only that the document is internally
#: consistent — anyone can generate a keypair and sign their own grant. This code says the
#: grant is well-formed and correctly signed and still not authorized *here*, which is a
#: different fact from "these bytes were edited", and a reader who cannot tell the two
#: apart cannot tell a forgery from a typo.
GOVERNOR_UNTRUSTED = "GOVERNOR_UNTRUSTED"

#: A grant was presented but is not a well-formed grant: wrong `kind`, unknown
#: fields (including any identity field, and always `alg`), missing fields,
#: wrong-length hex, non-integer expiry or issuedAt (booleans excluded), a
#: coeffect envelope that does not match this process, or a signature that does
#: not verify under the key the grant itself names.
GRANT_MALFORMED = "GRANT_MALFORMED"

#: The grant is well-formed but binds a different plugin digest than the bytes
#: being loaded. This is the binding the whole gate exists for: a grant for
#: bytes A cannot move bytes B.
GRANT_BYTES_MISMATCH = "GRANT_BYTES_MISMATCH"

#: The grant's one-use nonce has already been consumed. A replayed grant is not
#: a second authorization.
GRANT_SPENT = "GRANT_SPENT"

#: The grant is for the other operation: a load grant cannot unload, and an
#: unload grant cannot load.
GRANT_OPERATION_MISMATCH = "GRANT_OPERATION_MISMATCH"

#: The grant's expiry is in the past.
GRANT_EXPIRED = "GRANT_EXPIRED"

#: **GUARDIAN D3, HALF ONE.** The grant is well-formed and binds the right entry bytes, but the
#: module's IMPORT CLOSURE has moved -- *a file it imports differs from the one the grant was minted
#: against.* **`GRANT_BYTES_MISMATCH` CANNOT SEE THIS**: the governed module's own bytes are
#: untouched, so the entry digest does not move. *Bound separately, named separately, because a
#: reader needs to know WHICH of the two things changed.*
GRANT_CLOSURE_CHANGED = "GRANT_CLOSURE_CHANGED"

#: **GUARDIAN D3, HALF TWO.** The bytes are right and the closure is right, but they are NOT AT THE
#: GRANTED PATH. *A byte-identical module copied elsewhere produced the same digest and was admitted*,
#: because the binding compared bytes and never a path. **A grant says "these bytes at this place",
#: and until this code existed it only said the first half.**
GRANT_PATH_NOT_GRANTED = "GRANT_PATH_NOT_GRANTED"

# ── the mediator seam ──────────────────────────────────────────────────────────────────────

#: The mediator is off. No new governed effects. The string is the toy's own
#: code, deliberately: an operator reading logs from both systems should see the
#: same word for the same state.
MEDIATOR_OFF = "MEDIATOR_OFF"

# ── the composition state seam ─────────────────────────────────────────────────────────────

#: A load was requested while a plugin is already loaded. This gate does not
#: swap: unloading is its own governed transition with its own grant.
ALREADY_LOADED = "ALREADY_LOADED"

#: An unload was requested but nothing is loaded, or an unload names bytes that
#: are not the bytes currently loaded. There is no active composition to remove.
NOTHING_LOADED = "NOTHING_LOADED"

# ── the receipt seam ───────────────────────────────────────────────────────────────────────

#: A receipt did not verify: tampered field, wrong key, non-canonical encoding,
#: forbidden `alg` or identity field, or a signature that does not check out.
RECEIPT_TAMPERED = "RECEIPT_TAMPERED"

#: A receipt could not be checked against a retained/presented Aura pair,
#: because no such pair was supplied. The consistency question is UNANSWERED —
#: this is not a verdict of agreement and not a verdict of conflict.
CONSISTENCY_UNCHECKED = "CONSISTENCY_UNCHECKED"

#: Every code this module defines, so a caller can assert it saw one of ours.
ALL_CODES = (
    NO_GRANT,
    SEED_MODE_NOT_PRIVATE,
    GRANT_MALFORMED,
    GOVERNOR_UNTRUSTED,
    GRANT_BYTES_MISMATCH,
    GRANT_SPENT,
    GRANT_OPERATION_MISMATCH,
    GRANT_EXPIRED,
    GRANT_CLOSURE_CHANGED,
    GRANT_PATH_NOT_GRANTED,
    MEDIATOR_OFF,
    ALREADY_LOADED,
    NOTHING_LOADED,
    RECEIPT_TAMPERED,
    CONSISTENCY_UNCHECKED,
)


class CompositionRefusal(Exception):
    """A refused composition transition, carrying its stable code.

    `code` is the machine-readable half and is drawn from the constants above.
    `reason` is the human-readable half, free to change, and always says which
    field or which comparison decided the outcome.
    """

    def __init__(self, code: str, reason: str):
        if code not in ALL_CODES:
            raise ValueError(f"refusal code {code!r} is not a published code")
        self.code = code
        self.reason = reason
        super().__init__(f"{code}: {reason}")

    def line(self) -> str:
        """One line, in the spelling the CLI prints and the self-check greps."""
        return f"REFUSE: {self.code}: {self.reason}"
