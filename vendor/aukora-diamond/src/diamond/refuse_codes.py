"""Stable refuse / ceiling / doctrine strings — single source of truth.

REDTEAM.md and SECURITY.md must quote these exact codes. Courts assert
substring presence against these constants so renames stay synchronized.
"""

from __future__ import annotations

# ── Grant / activate refuse codes ─────────────────────────────────────
EVIDENCE_NEVER_AUTHORIZES = "evidence:never-authorizes"
RECONSTRUCTION_CANNOT_MINT = "reconstruction:cannot-mint"
GRANT_TTL_UNBOUNDED = "grant:ttl-unbounded"
GRANT_DEPTH_EXCEEDED = "grant:depth-exceeded"
GRANT_REPLAYED = "grant:replayed"
GRANT_ISSUED_IN_FUTURE = "grant:issued-in-future"
GRANT_NEGATIVE_LIFETIME = "grant:negative-lifetime"
GRANT_GOVERNOR_MISMATCH = "grant:governor-mismatch"
GRANT_ACTIVATION_MISMATCH = "grant:activation-mismatch"
GRANT_SUBJECT_MISMATCH = "grant:subject-mismatch"
GRANT_SESSION_MISMATCH = "grant:session-mismatch"
GRANT_COMPOSITION_MISMATCH = "grant:composition-mismatch"
GRANT_DELEGATION_WIDENED = "grant:delegation-widened"
GRANT_PORTABLE_KIND = "grant:portable-kind-required"
UNLOAD_REVERTOF_REQUIRED = "unload:revertOf-required"
UNLOAD_REVERTOF_UNKNOWN = "unload:revertOf-unknown"
UNLOAD_PLUGIN_MISMATCH = "unload:pluginDigest-mismatch"
NO_GRANT = "REFUSE: no grant"
PATENT_LICENSE_REQUIRED = "PATENT_LICENSE_REQUIRED"
PATENT_LICENSE_REQUIRED_MSG = (
    "REFUSE: PATENT_LICENSE_REQUIRED "
    "(strict mode — aukora-patent-license/v1)"
)

# ── Receipt composition base (versioned contract) ─────────────────────
# A receipt naming a composition base that does not exist is refused by name,
# never by counting the fields of the block. The vocabulary is closed in
# diamond/receipt.py COMPOSITION_BASES; this is the string that names a miss.
COMPOSITION_BASE_UNKNOWN = "compositionBase unknown"

# ── Settlement / indeterminate outcomes (crash matrix, P3) ────────────
# A consumed grant whose settlement did not reach a committed boundary is
# neither success nor clean refusal. It must never vanish from accounting.
INDETERMINATE = "INDETERMINATE"
AUTHORITY_CONSUMED_EFFECT_UNKNOWN = "AUTHORITY_CONSUMED_EFFECT_UNKNOWN"
SETTLEMENT_PENDING = "settlement:pending"
SETTLEMENT_JOURNAL_UNREADABLE = "settlement:journal-unreadable"
EFFECT_UNKNOWN_ACTIVE = "effect:unknown-active"
DIRECT_STATE_BYPASS = "direct-state-bypass"
STATE_UNBACKED_BY_AURA = "state:unbacked-by-aura"

# ── Role separation (one algorithm, many authority roles) ─────────────
ROLE_MISMATCH = "role:mismatch"

# ── Checkpoint freshness (signature validity != latestness) ───────────
CHECKPOINT_STALE = "CHECKPOINT_STALE"

# ── B3c simulated device (a contract, not hardware) ───────────────────
# LIMIT_EXCEEDED and GEOFENCE_VIOLATION refuse one command. PHYSICAL_VARIANCE_HALT is a
# LATCHED halt: a retry is refused under the same code rather than being allowed to clear
# it, because "try again" is exactly the move a physical fault must not reward.
# GRANT_EXPIRED is the grant's own period read by the device's clock.
LIMIT_EXCEEDED = "LIMIT_EXCEEDED"
GEOFENCE_VIOLATION = "GEOFENCE_VIOLATION"
GRANT_EXPIRED = "GRANT_EXPIRED"
PHYSICAL_VARIANCE_HALT = "PHYSICAL_VARIANCE_HALT"
GRANT_REFERENCE_MISMATCH = "grant:reference-mismatch"
# An envelope names the one grant it is for, so it is not transferable to another grant —
# even one naming the same reference.
ENVELOPE_GRANT_MISMATCH = "envelope:grant-mismatch"
# The clear path out of a latched halt: a NEW grant that names the halt id. Naming a value
# that only exists after the halt is what makes it new, and `issuedAt` at or after the halt
# is checked too, because a predicted halt id could otherwise be pre-authorized.
HALT_NOT_LATCHED = "HALT_NOT_LATCHED"
GRANT_HALT_MISMATCH = "grant:halt-mismatch"
GRANT_NOT_NEW = "grant:not-new"

# ── B3c device ceilings (printed on every device verdict) ─────────────
# Not part of the mandatory CEILINGS above: those are printed by every activate on the
# control plane. These three describe what a SIMULATED device can and cannot claim, and
# the device prints them on every verdict it reaches.
CEILING_SIMULATED_DEVICE = "SIMULATED_DEVICE"
CEILING_DEVICE_KEY_CLASS_B = "DEVICE_KEY_CLASS_B"
CEILING_ATTESTATION_ABSENT = "ATTESTATION_ABSENT"
DEVICE_CEILINGS = (
    CEILING_SIMULATED_DEVICE,
    CEILING_DEVICE_KEY_CLASS_B,
    CEILING_ATTESTATION_ABSENT,
)

# ── Ceilings / doctrine labels (printed on every activate) ────────────
CEILING_BOOTSTRAP_UNGATED = "BOOTSTRAP_UNGATED"
CEILING_SAME_UID = "SAME_UID"
CEILING_SUCCESSION_UNMEASURED = "SUCCESSION_UNMEASURED"
CEILING_PYTHON_TCB = "PYTHON_RUNTIME_TCB"
CEILING_MEDIATOR_INPROCESS = "MEDIATOR_INPROCESS"
IDENTITY_BOUND_FALSE = "identityBound: false"
UNOWNABLE_CORE_TARGET = "UNOWNABLE_CORE: target-not-achievement"

# Mandatory ceilings: the claim-integrity court refuses if any of these
# stops being printed. Removing one is a RED, not a simplification.
CEILINGS = (
    CEILING_BOOTSTRAP_UNGATED,
    CEILING_SAME_UID,
    CEILING_SUCCESSION_UNMEASURED,
    CEILING_PYTHON_TCB,
    CEILING_MEDIATOR_INPROCESS,
)

# Every named refusal a court may assert. REDTEAM.md must quote these and
# must not quote codes that do not exist here (claim-integrity court).
NAMED_REFUSALS = (
    EVIDENCE_NEVER_AUTHORIZES,
    RECONSTRUCTION_CANNOT_MINT,
    GRANT_TTL_UNBOUNDED,
    GRANT_DEPTH_EXCEEDED,
    GRANT_REPLAYED,
    GRANT_ISSUED_IN_FUTURE,
    GRANT_NEGATIVE_LIFETIME,
    GRANT_GOVERNOR_MISMATCH,
    GRANT_ACTIVATION_MISMATCH,
    GRANT_SUBJECT_MISMATCH,
    GRANT_SESSION_MISMATCH,
    GRANT_COMPOSITION_MISMATCH,
    GRANT_DELEGATION_WIDENED,
    GRANT_PORTABLE_KIND,
    UNLOAD_REVERTOF_REQUIRED,
    UNLOAD_REVERTOF_UNKNOWN,
    UNLOAD_PLUGIN_MISMATCH,
    COMPOSITION_BASE_UNKNOWN,
    NO_GRANT,
    PATENT_LICENSE_REQUIRED,
    INDETERMINATE,
    AUTHORITY_CONSUMED_EFFECT_UNKNOWN,
    SETTLEMENT_PENDING,
    SETTLEMENT_JOURNAL_UNREADABLE,
    EFFECT_UNKNOWN_ACTIVE,
    DIRECT_STATE_BYPASS,
    STATE_UNBACKED_BY_AURA,
    ROLE_MISMATCH,
    CHECKPOINT_STALE,
    LIMIT_EXCEEDED,
    GEOFENCE_VIOLATION,
    GRANT_EXPIRED,
    PHYSICAL_VARIANCE_HALT,
    GRANT_REFERENCE_MISMATCH,
    ENVELOPE_GRANT_MISMATCH,
    HALT_NOT_LATCHED,
    GRANT_HALT_MISMATCH,
    GRANT_NOT_NEW,
)


def reconstruction_cannot_mint(name: str) -> str:
    """Named reconstruction substitute refuse (recommendation/evidence/…)."""
    return f"{RECONSTRUCTION_CANNOT_MINT} ({name})"
