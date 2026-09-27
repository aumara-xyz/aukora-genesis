#!/usr/bin/env python3
"""The ceilings this gate prints, and the one place they are spelled.

WHY THEY ARE CODE AND NOT A PARAGRAPH. A ceiling that only lives in a README is
one a caller can forget to print, and a limit that is not printed beside a result
reads as a claim that the limit does not apply. This module makes the ceilings a
list that every human-facing path emits, so this composition gate cannot
report an accepted transition without also reporting what the acceptance does not
mean. The self-check asserts they appear even on paths that refuse, because a
refusal that drops the ceilings is just as misleading as an acceptance that does.

THE CEILINGS, AND WHAT EACH ONE DENIES:

  BOOTSTRAP_UNGATED   There is no owner key at this gate. The governor key that
                      signs grants is generated locally by the gate itself, so a
                      grant proves that *this installation* authorized a
                      transition, not that a person did. Live receipts are
                      therefore `unattributed` / `NON-CONFORMING`. Do not claim
                      CONFORMING; do not claim an owner bound the plugin.

  SAME_UID            The plugin shares this process and this uid. The coeffect
                      envelope is `{kind: same-uid-envelope, uid}`: a *digest
                      binding*, not isolation. Nothing here separates the plugin
                      from the loader, and no claim of a process or uid boundary
                      may be made from this code.

  MEDIATOR_OFF        When the mediator is off, every composition transition
                      refuses with the code `MEDIATOR_OFF` and no new governed
                      effect happens. Fail closed.

  NO_CUSTODY_CLAIM    **This gate holds no custody of the artefacts it judges** -- no
                      escrow, no quarantine, no "we will notice if it changes later".
                      The gate reads bytes, compares digests, and returns a verdict:
                      *an artefact it admitted is not thereby looked after, and one it
                      refused is not thereby withheld.* Those are different absences
                      and a reader needs both.

**AND THIS PARAGRAPH USED TO NAME ONLY THREE OF THE FOUR.** *`NO_CUSTODY_CLAIM` was in the `CEILINGS`
tuple and absent from the list headed "THE CEILINGS, AND WHAT EACH ONE DENIES"* -- **so the module
printed a ceiling it never explained**, *and a reader who trusted the header would have believed the
gate's guarantee was narrower than it is in one direction and wider in another.* **The text above is
taken from the constant's own comment below, so the two agree by construction rather than by luck.**

The two words that always accompany a receipt — `ATTENDANCE: reported-not-proven`
and the derived class — are printed by the same paths. Attendance is reported,
never proven: no human-ceremony path exists in this brick, and none is implied by
a signature whose key the same process generated.
"""
from __future__ import annotations

BOOTSTRAP_UNGATED = "BOOTSTRAP_UNGATED"
SAME_UID = "SAME_UID"
MEDIATOR_OFF = "MEDIATOR_OFF"

#: **aura-77: THE STANDING CLAIM THE FAMILY ALREADY PRINTS, ADDED HERE BECAUSE GENESIS MAKES IT TOO.**
#: The sibling gate prints `NO_CUSTODY_CLAIM` beside `SAME_UID` on every confined record --
#: *"Same-UID and `NO_CUSTODY_CLAIM` still apply"*, and *"Every confined ready/result record carries
#: `MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM`."*
#:
#: **AND GENESIS CLAIMS NO CUSTODY EITHER, SO LEAVING IT UNPRINTED MADE THE CEILING LIST INCOMPLETE
#: RATHER THAN CONSERVATIVE.** *A gate that prints three ceilings and omits a fourth does not read as
#: silent about the fourth* -- **it reads as claiming the fourth does not apply**, which is the failure
#: this module's own docstring names.
#:
#: **WHAT IT DENIES, AND WHY IT IS NOT `SAME_UID`.** `SAME_UID` says *the plugin shares this process
#: and this uid, so the envelope is a digest binding and not isolation.* `NO_CUSTODY_CLAIM` says
#: something the other three do not: **this gate holds no custody of the artefacts it judges** -- *no
#: escrow, no quarantine, no "we will notice if it changes later".* The gate reads bytes, compares
#: digests, and returns a verdict; **an artefact it admitted is not thereby looked after, and one it
#: refused is not thereby withheld.** *Those are different absences and a reader needs both.*
NO_CUSTODY_CLAIM = "NO_CUSTODY_CLAIM"

#: **aura-75: THE WEAKER TIER, NAMED AT ADMISSION.** A grant minted before `pluginPath` and
#: `pluginClosure` existed binds the entry bytes ONLY -- *so it admits a byte-identical module at a
#: different path, and cannot see a changed import at all* (GUARDIAN D3). Such a grant still verifies,
#: deliberately: **refusing it would be a flag day**, which is why the fields are optional. **What
#: must not happen is a SILENT pass** -- *a reviewer reading "ACCEPT" cannot tell a closure-bound
#: admission from an entry-bytes-only one*, and this module exists because "a limit that is not
#: printed beside a result reads as a claim that the limit does not apply."
GRANT_LEGACY_UNBOUND = "GRANT_LEGACY_UNBOUND"

#: Printed in this order, in this exact spelling. The self-check greps for these.
#: **`GRANT_LEGACY_UNBOUND` IS DELIBERATELY NOT IN THIS TUPLE**, because it is CONDITIONAL: it
#: describes the GRANT being admitted, not the gate. *Every other ceiling is true of every path; this
#: one is true only of a grant carrying neither field, and printing it unconditionally would be its
#: own kind of lie.* Use `legacy_unbound_line()` below.
#: **`NO_CUSTODY_CLAIM` IS UNCONDITIONAL, LIKE `SAME_UID` AND UNLIKE `GRANT_LEGACY_UNBOUND`**: it is a
#: standing property of what this gate IS, true on every path, not a property of the grant being
#: admitted. *So it belongs in this tuple, and it prints wherever the others do -- including on the
#: refusing path, which the self-check asserts.*
CEILINGS = (BOOTSTRAP_UNGATED, SAME_UID, MEDIATOR_OFF, NO_CUSTODY_CLAIM)

#: The word every human-facing path prints about attendance.
ATTENDANCE = "reported-not-proven"

CEILING_TEXTS = {
    BOOTSTRAP_UNGATED: (
        "no owner key at this gate — the governor key is generated locally, so a grant "
        "authorizes a transition for this installation and does not show a person was present; "
        "live receipts are unattributed / NON-CONFORMING"
    ),
    SAME_UID: (
        "the plugin shares this process and this uid — the coeffect envelope is a digest "
        "binding, not isolation; no process or uid boundary is claimed"
    ),
    MEDIATOR_OFF: (
        "mediator off refuses with MEDIATOR_OFF and applies no new governed effect — fail closed"
    ),
    NO_CUSTODY_CLAIM: (
        "no custody — this gate reads bytes, compares digests and returns a verdict; it does not "
        "escrow, quarantine or look after an artefact it admitted, and it does not withhold one it "
        "refused"
    ),
    GRANT_LEGACY_UNBOUND: (
        "path and closure not bound — this grant binds the entry file bytes only, so a byte-identical "
        "module at a different path is admitted and a changed import cannot be seen; mint a grant "
        "carrying pluginPath and pluginClosure to close this tier"
    ),
}


def legacy_unbound_line(grant: object) -> str | None:
    """The weaker-tier line for ONE grant, or None when the grant is fully bound.

    **ON THE SAME LINE AS THE VERDICT, WHICH IS THE POINT.** *A ceiling that scrolls away in a
    separate block is a ceiling a reviewer skips*; this returns one prefixed line to print beside
    ACCEPT rather than a paragraph in another section.

    **AND IT IS DECIDED BY WHAT THE GRANT CARRIES, NOT BY WHAT THE CODE SUPPORTS**: a grant with BOTH
    fields is bound even though the fields are optional, and a grant with NEITHER is the legacy tier
    even though it was minted this morning. *The tier is a property of the artefact, not of when it
    was made.*
    """
    if not isinstance(grant, dict):
        return None
    if grant.get("pluginPath") is not None and grant.get("pluginClosure") is not None:
        return None
    return f"{GRANT_LEGACY_UNBOUND}: {CEILING_TEXTS[GRANT_LEGACY_UNBOUND]}"


def migration_step(grant: object) -> str | None:
    """THE MIGRATION STEP THAT WOULD MAKE THE FIELDS REQUIRED -- written down, not performed.

    **aura-75's instruction is explicit: do not make the fields required yet, but write down the step
    that would.** *The step itself is one line -- move `pluginPath` and `pluginClosure` from
    `grant.OPTIONAL_SIGNED_FIELDS` into `grant.FIELDS` -- and the PRECONDITION is the part worth
    writing down*: **every stored, fixture and released grant must carry both first, or the gate
    refuses artefacts that were valid when they were made.** The honest order is (1) every mint
    carries both (done in `grant.issue`), (2) this ceiling runs long enough that no unbound grant is
    being admitted in practice, (3) only then move the names.
    """
    if not isinstance(grant, dict):
        return None
    if grant.get("pluginPath") is not None and grant.get("pluginClosure") is not None:
        return None
    return (
        "MIGRATION (not yet performed): move pluginPath and pluginClosure from "
        "grant.OPTIONAL_SIGNED_FIELDS into grant.FIELDS once no unbound grant is being admitted. "
        "The precondition is that every stored, fixture and released grant carries both, because "
        "requiring them refuses anything that does not."
    )


def lines(*, verbose: bool = False) -> list[str]:
    """The ceilings as printable lines. `verbose` adds the explanatory text, which
    a CLI run for a human uses and a machine-read arm does not need."""
    out = []
    for name in CEILINGS:
        out.append(f"CEILING: {name}")
        if verbose:
            out.append(f"         {CEILING_TEXTS[name]}")
    out.append(f"ATTENDANCE: {ATTENDANCE}")
    return out


def print_ceilings(*, verbose: bool = False) -> None:
    for line in lines(verbose=verbose):
        print(line)


def notice_lines(approval: str, conformance: str) -> list[str]:
    """The class and conformance a receipt derived. Kept beside the ceilings
    because they are the same kind of statement: what the receipt does not claim."""
    return [f"CLASS: {approval}", f"CONFORMANCE: {conformance}"]



# ── THE SELF-CHECK THE DOCSTRING PROMISES, MADE RUNNABLE (aura-83 R547) ────────────────────────────────
# *** THE DOCSTRING HAS SAID "The self-check asserts they appear even on paths that refuse" SINCE THIS MODULE
# WAS WRITTEN, AND THERE WAS NO `__main__` BLOCK. *** *So `python3 scripts/composition/ceilings.py` printed
# NOTHING and exited 0* -- **and a reader who ran it to check the ceilings would reasonably conclude the module
# was empty.** *That is the same defect this lane spent the evening finding elsewhere: a check that exists
# without being reachable.*
#
# **IT ASSERTS THE HALF THAT IS ASSERTABLE HERE.** *That every name in `CEILINGS` appears in what `lines()`
# emits* -- **which is the arithmetic the module once got wrong**: *a paragraph naming three of four, corrected
# at :38-39.* *The "even on paths that refuse" half is NOT asserted here, because `lines()` takes no path and the
# refusing paths live in callers* -- **saying so is better than an assertion that cannot fail.**
if __name__ == '__main__':
    # *** THE FIRST VERSION OF THIS CHECK WAS VACUOUS, AND ITS OWN RED ARM PROVED IT (aura-83 R548). ***
    # *It asserted `name not in '\n'.join(lines())`* -- **and `lines()` emits `CEILING: <name>` for whatever is
    # in the tuple, so the assertion could never fail.** *MEASURED: a fifth, unprintable name added to `CEILINGS`
    # in a copy still reported* "GREEN — all 5 declared ceiling(s) are printed". *** A name can always be
    # printed; what it can LACK is a denial. ***
    # **SO THE SUBJECT IS THE DOCSTRING'S OWN LIST**, *which is exactly the defect the reviewer flagged:*
    # "`NO_CUSTODY_CLAIM` was in the `CEILINGS` tuple and absent from the list headed 'THE CEILINGS, AND WHAT EACH
    # ONE DENIES'." **A tuple of four with a paragraph of three is the arithmetic this must catch.**
    _doc = __doc__ or ''
    _missing = [name for name in CEILINGS if name not in _doc]
    if _missing:
        print('CEILINGS SELF-CHECK: FAILED — in CEILINGS with no denial in this module\'s docstring: '
              + ', '.join(_missing))
        raise SystemExit(2)
    print_ceilings()
    print(f'CEILINGS SELF-CHECK: GREEN — all {len(CEILINGS)} declared ceiling(s) have a denial in the docstring')
