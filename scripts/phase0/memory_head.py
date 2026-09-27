#!/usr/bin/env python3
"""memory-head — the Phase 0 court, pointed at the KIRA MEMORY LOG.

WHY THIS FILE EXISTS. Genesis keeps two ledgers and only one of them was covered.

  * `<state_root>/aura/records.jsonl` — the composition / admission log. `retain-head`,
    `present-head` and `retain_on_settle.py` all speak about THIS stream, and it is the one
    `docs/INTEGRATION-STATUS.md` row 6 calls "the plugin-load log".
  * `<kira_state>/aura.jsonl` — Kira's memory ledger: one entry per governed `memory.put`,
    with its own `hash`/`prev` chain and its own `seq` marker beside it.

Nothing retained a head of the second log anywhere the second log could reach, so the newest
memory could be DROPPED and every verifier Genesis ships would still read green. That is the
defect this module closes: the same producer (`scripts/phase0/phase0log.py`), the same vendored
court (`vendor/append-only/verify.py`, never edited, never imported — run as a separate
process by `scripts/phase0/verify`), and a head kept OUTSIDE the state directory.

THE ONE MOVE THAT MAKES TRUNCATION VISIBLE. A log is self-consistent at every prefix: cut the
tail off and the remaining chain still verifies, because entry *k*'s hash depends only on its own
fields and `prev`. So a truncated log is not a broken log, and no amount of local checking can
tell it from a log that was simply never longer. What distinguishes them is a reading taken
EARLIER and kept where the log cannot rewrite it. That reading is the retained head, and its
treeSize is the fact a truncated log cannot produce.

TWO DETECTORS, AND THEY ARE NOT THE SAME DETECTOR. Named separately because collapsing them
would overstate the retained head:

  * `LOCAL_SEQ_DISAGREES_WITH_LOG_LENGTH` — the store's own `seq` marker no longer counts the
    lines present. This works with NO retained head at all, and it is exactly what an attacker
    who truncates and forgets the marker leaves behind.
  * `TRUNCATION_BELOW_RETAINED_HEAD` — the log now holds fewer entries than a head retained
    outside it says existed. This is the one that survives the marker being reset too, and it is
    the only one of the two that a careful truncation cannot avoid.

WHY THE CHAIN KEY IS NOT THE COMPOSITION ONE. `genesis-phase0:kira-memory` is a different string
from the composition log's `genesis-phase0:aura-chain`, so a head retained for one ledger can
never be presented against the other. Two logs that share a chain key are two logs whose heads
are interchangeable, which would be a silent way to check the wrong file and print a verdict.

CEILINGS, stated where a reader will meet them rather than in a document.

  * A green is a statement about the first N entries being a prefix of the M presented — never
    that M is the tip of the world. `APPEND_ONLY` says two documents agree about a prefix.
  * Leaves follow `phase0log`'s existing convention: sha256 over each record's CANONICAL JSON
    (sorted keys, no insignificant whitespace), not over the raw bytes on disk. A line
    re-serialised with different whitespace or key order therefore hashes the same. That is
    inherited from the composition producer on purpose — one convention, one arithmetic — and it
    means this commits to the RECORDS, not to the exact bytes that carried them.
  * A target on this host is `RETAINER_SAME_OWNER`: a second directory is not a second device,
    and a head this host can rewrite is evidence about a time, not custody.
  * Retaining is never allowed to block or undo a settlement. Every failure is a status.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import phase0log  # noqa: E402
import retainer as retainer_mod  # noqa: E402

#: NOT the composition chain key. See the module docstring.
MEMORY_CHAIN_KEY = "genesis-phase0:kira-memory"
KIRA_LOG_NAME = "aura.jsonl"
KIRA_SEQ_NAME = "seq"
VERIFY_DRIVER = os.path.join(HERE, "verify")

#: Where a retained memory head goes when nobody says otherwise. The owner's choice, named here so
#: the default is inspectable rather than buried in a call site.
DEFAULT_TARGET = os.path.join(os.path.expanduser("~"), "aukora-private", "retained-heads")
TARGET_ENV = "AUKORA_AURA_MEMORY_RETAINER_TARGET"
#: THE SECOND COPY, and the whole point of it is that it is not on this disk. A second directory
#: on the same filesystem is a second copy in name only: one `rm`, one failed disk, one stolen
#: laptop takes both. The owner already has an off-machine store, so the mirror defaults to it.
#: This is a PLACEMENT decision, and placement is the only thing retention ever was.
MIRROR_TARGET = os.path.join(
    os.path.expanduser("~"), "Library", "Mobile Documents", "com~apple~CloudDocs",
    "aukora-backups", "retained-heads")
MIRROR_ENV = "AUKORA_AURA_MEMORY_RETAINER_MIRROR"
#: The one directory whose ABSENCE means "iCloud Drive is not on for this account". It is named
#: so the guard below can refuse instead of creating it: `makedirs` would happily build a fake
#: `com~apple~CloudDocs` chain on this disk, and a mirror that is really a local directory is
#: worse than no mirror — it is the same disk wearing an off-machine label.
CLOUD_ROOT = os.path.join(os.path.expanduser("~"), "Library", "Mobile Documents",
                          "com~apple~CloudDocs")

STATUS_MIRROR_WRITTEN = "MIRROR_WRITTEN"
STATUS_MIRROR_UNREACHED = "MIRROR_UNREACHED"
STATUS_MIRROR_NOT_CONFIGURED = "MIRROR_NOT_CONFIGURED"
#: Per-state destination, read by the AUTOMATIC path. Beside the ledger, never inside it —
#: a head the log can rewrite is not a head.
STATE_CONFIG_NAME = "aura-memory-retainer.json"

STATUS_RETAINED = "MEMORY_HEAD_RETAINED"
STATUS_REFUSED = "MEMORY_HEAD_REFUSED"
#: Nobody asked to retain. The same deliberate no-op `retain_on_settle.py` gives as
#: RETAINER_NOT_CONFIGURED: it is not an outage and it is not a failure.
STATUS_NOT_CONFIGURED = "MEMORY_HEAD_NOT_CONFIGURED"
STATUS_UNDETERMINED = "COMPLETENESS_UNDETERMINED"
STATUS_TRUNCATED = "TRUNCATION_BELOW_RETAINED_HEAD"
STATUS_LOCAL_SEQ = "LOCAL_SEQ_DISAGREES_WITH_LOG_LENGTH"
STATUS_PREFIX_REWRITTEN = "MEMORY_PREFIX_REWRITTEN"
#: A head this document recorded for ANOTHER ledger no longer matches that ledger. This is the
#: two-trains result: two readers shown two different histories of one log. It OUTRANKS a green,
#: because APPEND_ONLY says THIS ledger extends its own past and says nothing at all about
#: whether the ledger we cross-referenced is still the one we looked at.
STATUS_CROSS_CONFLICT = "CROSS_REFERENCE_CONFLICT"
STATUS_CROSS_HELD = "CROSS_REFERENCE_HELD"
#: The referenced ledger could not be read. Named separately from CONFLICT on purpose: a train
#: that is merely away is not evidence of equivocation, and collapsing the two is how an absence
#: gets read as an accusation.
STATUS_CROSS_UNREACHABLE = "CROSS_REFERENCE_UNREACHABLE"


class MemoryHeadError(Exception):
    """A refusal with a reason. Never a silent skip."""


class MemoryHeadRefusal(Exception):
    """The log itself cannot be read. Distinct from 'the question cannot be answered'."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


# ── where the log and its marker are ───────────────────────────────────────────────────────

def memory_log_path(kira_state: str) -> str:
    return os.path.join(os.path.abspath(kira_state), KIRA_LOG_NAME)


def seq_path(kira_state: str) -> str:
    return os.path.join(os.path.abspath(kira_state), KIRA_SEQ_NAME)


def read_seq(kira_state: str) -> int | None:
    """The store's own count of entries written. Absent is a ceiling, not a fault: an older
    store may predate the marker, and the retained head still answers the question."""
    try:
        with open(seq_path(kira_state), "rb") as handle:
            raw = handle.read().decode("utf-8").strip()
    except (FileNotFoundError, UnicodeDecodeError, OSError):
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


def _expand(path: str) -> str:
    """A configured destination, with `~` resolved.

    `os.path.abspath` does NOT expand `~`, so a destination typed as
    `~/aukora-private/retained-heads` — or pointed at an iCloud Drive folder such as
    `~/Library/Mobile Documents/com~apple~CloudDocs/aukora-heads` — would otherwise create a
    directory literally named `~` beside the current working directory. The retain would then
    report success, and every later check would look in the intended place, find nothing, and
    answer `COMPLETENESS_UNDETERMINED` — a real answer to a question nobody asked, produced by
    a typo the tool declined to notice.
    """
    return os.path.abspath(os.path.expanduser(path.strip()))


def resolve_target(kira_state: str, target: str | None = None,
                   allow_default: bool = True) -> tuple[str | None, str]:
    """THE ONE PLACE the destination is decided, so `retain` and `check` cannot disagree about
    where the head lives. Order: `--target`, then the environment, then the per-state config
    file, then — only where a default is allowed — `~/aukora-private/retained-heads/`.

    This function exists because they DID disagree. `retain` used to resolve through a
    separate path that never read the per-state config at all, so on this project's own court
    a config file that could not be parsed was silently ignored and the retain fell through to
    the owner's real archive directory — a broken knob reported as a success, writing where
    nobody asked. `configured_target` raises on that file; routing both verbs through here is
    what makes the raise reach the caller instead of being stepped over.
    """
    resolved, provenance = configured_target(kira_state, target)
    if resolved is None:
        if not allow_default:
            return None, provenance
        return DEFAULT_TARGET, "default"
    return resolved, provenance


def configured_target(kira_state: str, target: str | None = None) -> tuple[str | None, str]:
    """The destination ONLY IF SOMEONE NAMED ONE, and how it was named.

    This is the difference between the two callers, and it is load-bearing. An operator who
    types `memory-head retain` has chosen to keep a head, so the documented default applies.
    A SETTLEMENT PATH runs on its own, and there the default would mean every settle — and
    every test that drives one on disposable state — silently writing into the owner's real
    archive directory. Absent is a ceiling: the automatic path retains only when a target is
    actually named, and says `MEMORY_HEAD_NOT_CONFIGURED` when it is not.
    """
    if target:
        return _expand(target), "argument"
    from_env = os.environ.get(TARGET_ENV)
    if from_env:
        return _expand(from_env), "environment"
    config = os.path.join(os.path.abspath(kira_state), STATE_CONFIG_NAME)
    if os.path.exists(config):
        try:
            with open(config, "rb") as handle:
                document = json.loads(handle.read().decode("utf-8"))
        except (UnicodeDecodeError, ValueError, OSError):
            # A file at this path declares intent. An unreadable one is a FAULT with a name,
            # never the deliberate no-op that NOT_CONFIGURED means.
            raise MemoryHeadRefusal(
                "memory-retainer-config-unreadable",
                f"{config} exists and cannot be read as a destination")
        named = document.get("target") if isinstance(document, dict) else None
        if not isinstance(named, str) or not named.strip():
            raise MemoryHeadRefusal(
                "memory-retainer-config-names-no-target",
                f"{config} exists and names no target")
        return _expand(named), "config"
    return None, "unconfigured"


# ── the observation over the memory log ────────────────────────────────────────────────────

def hashes_for(kira_state: str) -> list[bytes]:
    """Leaf hashes over Kira's memory ledger.

    `read_stream` refuses a missing or empty stream rather than reporting an empty log, and that
    refusal is preserved here: 'this store holds no memories' and 'this store has no ledger' are
    different claims and only one of them is answered by an empty list.
    """
    path = memory_log_path(kira_state)
    try:
        hashes, _records = phase0log.leaf_hashes(kira_state, log=path)
    except phase0log.Phase0Error as exc:
        raise MemoryHeadRefusal("kira-memory-log-unreadable", str(exc)) from exc
    return hashes


def observation_for(kira_state: str, chain_key: str = MEMORY_CHAIN_KEY,
                    size: int | None = None) -> dict:
    hashes = hashes_for(kira_state)
    n = len(hashes) if size is None else size
    if n < 1 or n > len(hashes):
        raise MemoryHeadRefusal(
            "kira-memory-retain-beyond-log",
            f"cannot observe size {n}; this ledger holds {len(hashes)} entries")
    return phase0log.observation(n, hashes, 1, chain_key)


# ── the retained head, outside the state directory ─────────────────────────────────────────

def retained_sizes(target: str, chain_key: str = MEMORY_CHAIN_KEY) -> list[int]:
    """Every size this target holds a head for, ascending. A directory that does not exist yet
    holds none — which is 'never retained', a real answer, not an error."""
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in chain_key)
    directory = os.path.join(os.path.abspath(target), "heads", safe)
    sizes: list[int] = []
    try:
        names = os.listdir(directory)
    except (FileNotFoundError, NotADirectoryError, OSError):
        return []
    for name in names:
        if name.startswith("size-") and name.endswith(".json"):
            try:
                sizes.append(int(name[len("size-"):-len(".json")]))
            except ValueError:
                continue
    return sorted(sizes)


def mirror_target_for(explicit: str | None = None, allow_default: bool = True) -> str | None:
    """Where the SECOND copy goes, or None when nobody asked for one.

    `allow_default=False` is the automatic (settle-path) rule from `configured_target`, applied
    to the mirror for the same reason: a settle that runs unattended must not invent an
    off-machine destination. A mirror that is merely unavailable is a named flag — never a
    rollback, and never a silent downgrade to "one copy".
    """
    if explicit:
        return _expand(explicit)
    from_env = os.environ.get(MIRROR_ENV)
    if from_env:
        return _expand(from_env)
    return MIRROR_TARGET if allow_default else None


def latest_retained(target: str, chain_key: str = MEMORY_CHAIN_KEY) -> tuple[int, dict] | None:
    """The LARGEST retained size in ONE store, because that is the strongest earlier reading
    available there. A smaller head could still be satisfied by a log that the larger one
    convicts."""
    sizes = retained_sizes(target, chain_key)
    if not sizes:
        return None
    size = sizes[-1]
    try:
        envelope = retainer_mod.read_directory_head(os.path.abspath(target), chain_key, size)
    except retainer_mod.RetainerError as exc:
        raise MemoryHeadRefusal("retained-head-unreadable", str(exc)) from exc
    return size, envelope.get("observation", {})


def latest_retained_across(targets: list[str | None],
                           chain_key: str = MEMORY_CHAIN_KEY) -> tuple[int, dict, str] | None:
    """The strongest head available across EVERY store, and WHICH store it came from.

    Searching more than one place is the entire point of a mirror. A local store that has been
    emptied cannot answer the question, and the copy that is not on this disk still can — so this
    returns the source alongside the head, and a reader can see that the reading which caught a
    truncation was the off-machine one. An unreadable store is SKIPPED rather than fatal: one
    broken mirror must not blind the check to a good local head, or the reverse.
    """
    best: tuple[int, dict, str] | None = None
    for target in targets:
        if not target:
            continue
        try:
            found = latest_retained(target, chain_key)
        except MemoryHeadRefusal:
            continue
        if found is None:
            continue
        size, document = found
        if best is None or size > best[0]:
            best = (size, document, target)
    return best


def _mirror_ready(mirror: str) -> bool:
    """Whether the SECOND copy may be written. The guard is about iCloud, and only about iCloud.

    A mirror under iCloud Drive whose `com~apple~CloudDocs` root does not exist means iCloud Drive
    is off or not signed in — and `makedirs` would create the whole chain locally without
    complaint, producing a "second copy" on this same disk that then reports as off-machine. That
    is the one outcome worse than having no mirror, so an absent CloudDocs root is REFUSED by name.

    FOR ANY OTHER PATH THE CALLER NAMED, CREATING IT IS WHAT THEY ASKED FOR. An earlier version
    of this function also refused when the mirror's PARENT did not exist, whatever the path — and
    that silently skipped a perfectly good local mirror: a freshly-configured destination reported
    `MIRROR_UNREACHED` and no second copy was written at all. Measured on this project's own
    court: the scope arms retained into a mirror that was never created, so the check found no
    head and answered UNDETERMINED where the arm expected TRUNCATION. A guard that generalises
    past the thing it guards turns a good configuration into a quiet one.
    """
    if os.path.isdir(mirror):
        return True
    if mirror == CLOUD_ROOT or mirror.startswith(CLOUD_ROOT + os.sep):
        return os.path.isdir(CLOUD_ROOT)
    return True


def retain(kira_state: str, target: str | None = None,
           chain_key: str = MEMORY_CHAIN_KEY, allow_default: bool = True,
           cross_refs: list[str] | None = None, mirror_arg: str | None = None,
           local_only: bool = False) -> dict:
    """Keep the memory ledger's head at its current size, OUTSIDE the state directory.

    `allow_default=False` is the AUTOMATIC caller's mode (see `configured_target`): a settle
    path runs with nobody watching, and inventing a destination there would mean writing into
    the owner's archive on every settle and every test that drives one.
    """
    resolved: str | None = None
    try:
        resolved, _provenance = resolve_target(kira_state, target, allow_default=allow_default)
        if resolved is None:
            return {"status": STATUS_NOT_CONFIGURED, "target": None, "chainKey": chain_key,
                    "detail": "no memory-head destination is configured; the automatic path "
                              "will not choose one for the owner"}
        document = observation_for(kira_state, chain_key)
    except MemoryHeadRefusal as exc:
        return {"status": STATUS_REFUSED, "code": exc.code, "detail": exc.detail,
                "target": resolved}
    document["retainedAt"] = phase0log.now_ms()
    document["retainedBy"] = "genesis:memory-head"
    # The other trains, as they looked at this instant. Absent-and-unreachable is recorded as
    # nothing at all rather than as an empty reference: a cross-reference we could not take is
    # not a cross-reference that says "no other train exists".
    recorded = []
    for other in cross_refs or []:
        reference = cross_reference_of(other, chain_key=chain_key)
        if reference is not None:
            recorded.append(reference)
    if recorded:
        document["crossReferences"] = recorded
    try:
        written = retainer_mod.retain_to_directory(
            resolved, chain_key, document["treeSize"], document, document["retainedBy"])
    except retainer_mod.RetainerError as exc:
        # A target that already holds a DIFFERENT root for this size is a retainer that would
        # have to be rewritten to be satisfied. That is a refusal with a name, not an outage.
        return {"status": STATUS_REFUSED, "code": "retained-head-conflicts", "detail": str(exc),
                "target": resolved}

    # ── THE SECOND COPY ────────────────────────────────────────────────────────────────────
    # Written AFTER the first and never allowed to fail the retain: the primary head exists by
    # the time this runs, so an iCloud folder that is not mounted is a flag beside a real local
    # head, not a reason to report that nothing was retained.
    mirror = None if local_only else mirror_target_for(mirror_arg, allow_default=allow_default)
    mirror_result: dict = {"status": STATUS_MIRROR_NOT_CONFIGURED, "target": mirror}
    if local_only:
        mirror_result["detail"] = "--no-mirror: one copy only, as the caller asked"
    if mirror is not None:
        if not _mirror_ready(mirror):
            mirror_result = {"status": STATUS_MIRROR_UNREACHED, "target": mirror,
                             "detail": f"iCloud Drive is not mounted at {CLOUD_ROOT}; refusing "
                                       "to create it, because a mirror built on this disk would "
                                       "be a second copy in name only"}
        else:
            try:
                mirror_written = retainer_mod.retain_to_directory(
                    mirror, chain_key, document["treeSize"], document, document["retainedBy"])
                mirror_result = {"status": STATUS_MIRROR_WRITTEN, "target": mirror,
                                 "written": mirror_written}
            except (retainer_mod.RetainerError, OSError) as exc:
                mirror_result = {"status": STATUS_MIRROR_UNREACHED, "target": mirror,
                                 "detail": str(exc)}
    return {
        "status": STATUS_RETAINED,
        "target": resolved,
        "written": written,
        "treeSize": document["treeSize"],
        "root": document["root"],
        "chainKey": chain_key,
        "localSeq": read_seq(kira_state),
        "mirror": mirror_result,
    }


# ── cross-reference: the other trains, remembered inside this head ─────────────────────────

def cross_reference_of(kira_state: str, label: str | None = None,
                       chain_key: str = MEMORY_CHAIN_KEY) -> dict | None:
    """The observation of ANOTHER ledger, as this head will remember it.

    This is the two-trains result (`lab-heart/C-two-trains.mjs`) carried into the retained
    document. A head that names only its own log can say "I grew". A head that ALSO names the
    other train's root AT A SIZE can say "and here is what the other train looked like when I
    looked" — and that is the sentence two readers cannot both be told a different version of.

    It records the portable commitment (the Merkle root at a tree size), not a chain head hash:
    the root is what a stranger can recompute from exported bytes with no Genesis code.
    """
    try:
        document = observation_for(kira_state, chain_key)
    except MemoryHeadRefusal:
        return None
    return {
        "label": label or os.path.basename(os.path.abspath(kira_state).rstrip(os.sep)),
        "state": os.path.abspath(kira_state),
        "chainKey": chain_key,
        "treeSize": document["treeSize"],
        "root": document["root"],
    }


def verify_cross_references(document: dict) -> list[dict]:
    """Re-read every ledger this head remembers and say what each one looks like NOW."""
    findings: list[dict] = []
    for reference in document.get("crossReferences") or []:
        if not isinstance(reference, dict):
            continue
        state = reference.get("state")
        size = reference.get("treeSize")
        expected = reference.get("root")
        entry: dict = {"label": reference.get("label"), "state": state,
                       "recordedSize": size, "recordedRoot": expected}
        if not isinstance(state, str) or not isinstance(size, int) or size < 1:
            entry["outcome"] = STATUS_CROSS_UNREACHABLE
            entry["detail"] = "the recorded cross-reference is malformed"
            findings.append(entry)
            continue
        present = present_line_count(state)
        if present == 0:
            entry["outcome"] = STATUS_CROSS_UNREACHABLE
            entry["detail"] = f"the referenced ledger holds nothing at {memory_log_path(state)}"
            findings.append(entry)
            continue
        if present < size:
            entry["outcome"] = STATUS_CROSS_CONFLICT
            entry["detail"] = (f"this head recorded {size} entries of the referenced ledger; "
                               f"it now holds {present}")
            findings.append(entry)
            continue
        try:
            hashes = hashes_for(state)
        except MemoryHeadRefusal as exc:
            entry["outcome"] = STATUS_CROSS_UNREACHABLE
            entry["detail"] = exc.detail
            findings.append(entry)
            continue
        now = phase0log.tree_head(hashes[:size]).hex()
        entry["presentRoot"] = now
        if now != expected:
            entry["outcome"] = STATUS_CROSS_CONFLICT
            entry["detail"] = (f"the root over the first {size} entries of the referenced "
                               f"ledger is now {now}, but this head recorded {expected}")
        else:
            entry["outcome"] = STATUS_CROSS_HELD
        findings.append(entry)
    return findings


# ── the question: is the log still the log we kept a reading of? ───────────────────────────

def present_line_count(kira_state: str) -> int:
    """How many entries the ledger holds right now, WITHOUT refusing on zero.

    `read_stream` refuses an empty or absent stream, and that is right for building an
    observation: there is no tree over no leaves. But it is the wrong first question when the
    real subject is COMPARISON. "The ledger is now empty" is not an unreadable file — it is the
    most extreme truncation there is, and it must be comparable against a retained head before
    anything is allowed to call it a refusal.
    """
    path = memory_log_path(kira_state)
    if not os.path.exists(path):
        return 0
    count = 0
    try:
        with open(path, "rb") as handle:
            for raw in handle:
                if raw.strip():
                    count += 1
    except OSError:
        return 0
    return count


def check(kira_state: str, target: str | None = None,
          chain_key: str = MEMORY_CHAIN_KEY, mirror_arg: str | None = None,
          local_only: bool = False) -> dict:
    """Answer, as precisely as the evidence allows, whether this ledger still extends the head
    retained outside it.

    Returns a dict whose `status` is one of:
      COMPLETENESS_UNDETERMINED        — no head was ever retained, so this question has no answer
      TRUNCATION_BELOW_RETAINED_HEAD   — the ledger is SHORTER than a head kept outside it
      LOCAL_SEQ_DISAGREES_...          — the store's own marker disagrees (a second signal)
      MEMORY_PREFIX_REWRITTEN          — the retained prefix no longer matches
      APPEND_ONLY / OBSERVATION_CONFLICT / UNDETERMINED — the vendored court's own words
    """
    try:
        resolved, _provenance = resolve_target(kira_state, target)
    except MemoryHeadRefusal as exc:
        # Same resolution as `retain`, so a broken knob cannot make `check` look somewhere
        # else and answer about a directory nobody configured.
        return {"target": None, "chainKey": chain_key, "status": STATUS_REFUSED,
                "code": exc.code, "detail": exc.detail}
    result: dict = {"target": resolved, "chainKey": chain_key}

    seq = read_seq(kira_state)
    # The retained head is consulted FIRST, before the ledger is asked to describe itself. The
    # order is the point: an empty ledger under a retained head is a truncation, and reading
    # the ledger first would report the strongest evidence available as an unreadable file.
    # EVERY store, not just the local one. A head that exists ONLY in the off-machine mirror
    # still answers the question — that is the entire reason for keeping a second copy, and a
    # check that read only the local directory would silently undo it.
    # `--no-mirror` NARROWS THE SEARCH TO THE NAMED STORE, and it exists because the alternative
    # was environment discipline. The negative control every court needs — "no head was kept
    # anywhere, so what does it say?" — can only be asked honestly if the caller can SAY there is
    # nowhere else to look. Without this flag the answer depended on whether the mirror
    # environment variable happened to point at an empty directory: a step that forgot produced
    # TRUNCATION_BELOW_RETAINED_HEAD, an ACCUSATION, from a head kept for a different store.
    # A no-head question answered with an accusation is the failure mode this flag removes, and
    # the caller now declares its scope instead of hoping the environment agrees.
    stores = [resolved] if local_only else [resolved, mirror_target_for(mirror_arg)]
    kept = latest_retained_across(stores, chain_key)
    # SEARCHED DESCRIBES WHAT WAS SEARCHED, NOT WHAT WAS ASKED FOR. This read `if local_only:` and
    # printed the flag straight back, so the label was a statement of INTENT: MEASURED — deleting the
    # store selection above, so that `--no-mirror` consulted the mirror anyway, left the report
    # printing `local-only` while two stores had been searched. The mutation survived, and not only the
    # courts missed it: the REPORT missed it. In today's code the two agree, which is exactly why
    # nothing had ever caught it. The label is now computed from `stores`, so a divergence between what
    # the caller asked for and what the search did shows up in the report instead of being hidden by
    # it. `mirror_target_for` can itself return None, and a None mirror is not a searched store, so this
    # counts real targets rather than list slots.
    searched = [target for target in stores if target]
    result["scope"] = "local-only" if len(searched) <= 1 else "local+mirror"
    present = present_line_count(kira_state)
    result["presentSize"] = present
    result["localSeq"] = seq
    # Reported whichever way the main question lands, because it is independent evidence.
    result["seqDisagrees"] = seq is not None and seq != present

    if present == 0:
        if kept is None:
            # ABSENT versus EMPTY, and the difference is not cosmetic. A path that holds no
            # ledger at all is usually a wrong `--state`, so it is a refusal. A ledger that
            # exists and is empty is a real store state — and there the answer to "is this
            # complete?" with no head kept is still UNDETERMINED, never a green and not a
            # file fault. Reporting it as a refusal would make the one question this command
            # exists to ask look like a bad path.
            if not os.path.exists(memory_log_path(kira_state)):
                return {**result, "status": STATUS_REFUSED, "code": "kira-memory-log-absent",
                        "detail": f"no ledger at {memory_log_path(kira_state)}, and no retained "
                                  "head to compare it against"}
            result["status"] = STATUS_UNDETERMINED
            result["reason"] = "no_retained_head"
            result["detail"] = (
                f"the ledger is empty and nothing outside the state directory holds a head for "
                f"chain {chain_key!r} at {resolved}; whether it was truncated is exactly the "
                "question no local evidence can answer")
            return result
        retained_size, retained, retained_from = kept
        result["retainedSize"] = retained_size
        result["retainedRoot"] = retained.get("root")
        result["retainedFrom"] = retained_from
        result["status"] = STATUS_TRUNCATED
        result["detail"] = (f"a head retained outside this store says {retained_size} entries "
                            f"existed; the ledger now holds none at all")
        if result["seqDisagrees"]:
            result["also"] = STATUS_LOCAL_SEQ
        return result

    try:
        hashes = hashes_for(kira_state)
    except MemoryHeadRefusal as exc:
        return {**result, "status": STATUS_REFUSED, "code": exc.code, "detail": exc.detail}

    if kept is None:
        result["status"] = STATUS_UNDETERMINED
        result["reason"] = "no_retained_head"
        result["detail"] = (
            f"nothing outside the state directory holds a head for chain {chain_key!r} at "
            f"{resolved}; a ledger truncated together with its own {KIRA_SEQ_NAME} marker is "
            "indistinguishable from one that was never longer")
        return result

    retained_size, retained, retained_from = kept
    result["retainedSize"] = retained_size
    result["retainedRoot"] = retained.get("root")
    result["retainedFrom"] = retained_from

    if retained_size > present:
        result["status"] = STATUS_TRUNCATED
        result["detail"] = (
            f"a head retained outside this store says {retained_size} entries existed; the "
            f"ledger now holds {present}")
        if result["seqDisagrees"]:
            result["also"] = STATUS_LOCAL_SEQ
        return result

    # The retained prefix must still be the prefix we retained, before any proof is built.
    prefix_now = phase0log.tree_head(hashes[:retained_size]).hex()
    if prefix_now != retained.get("root"):
        result["status"] = STATUS_PREFIX_REWRITTEN
        result["detail"] = (f"the root over the first {retained_size} entries is now "
                            f"{prefix_now}, but the retained head says {retained.get('root')}")
        return result

    verdict = run_court(hashes, retained, retained_size, chain_key)
    result.update(verdict)

    # ── the two-trains check, and it OUTRANKS the green above ──────────────────────────────
    # APPEND_ONLY says this ledger extends its own past. It says NOTHING about whether the
    # other train this head remembered is still the one it looked at. Two readers shown two
    # different histories of one log BOTH get a green from the court above, because each is
    # internally consistent — the cross-reference is the only thing in this file that can
    # separate them.
    cross = verify_cross_references(retained)
    if cross:
        result["crossReferences"] = cross
        if any(entry["outcome"] == STATUS_CROSS_CONFLICT for entry in cross):
            result["status"] = STATUS_CROSS_CONFLICT
        elif any(entry["outcome"] == STATUS_CROSS_UNREACHABLE for entry in cross):
            # Named, and deliberately NOT promoted over a green: a train that is merely away
            # is not evidence of equivocation.
            result["crossNote"] = STATUS_CROSS_UNREACHABLE
    return result


def run_court(hashes: list[bytes], retained_document: dict, retained_size: int,
              chain_key: str) -> dict:
    """Build the presented document and run the VENDORED court over the pair.

    The court is never imported and never edited: `scripts/phase0/verify` runs
    `vendor/append-only/verify.py` as a separate process against the exact bytes on disk,
    and this function reports that process's own verdict and exit status.
    """
    if retained_size == len(hashes):
        proof: list[str] = []
    else:
        try:
            proof = [x.hex() for x in phase0log.proof_from(retained_size, hashes)]
        except phase0log.Phase0Error as exc:
            return {"status": "UNDETERMINED", "reason": str(exc), "exit": 2}

    presented = phase0log.observation(len(hashes), hashes, 2, chain_key)
    presented["proofFromPrevious"] = proof
    presented["retainedTreeSize"] = retained_size

    with tempfile.TemporaryDirectory(prefix="memory-head-court-") as work:
        retained_path = os.path.join(work, "retained.json")
        presented_path = os.path.join(work, "presented.json")
        phase0log.write_document(retained_path, retained_document)
        phase0log.write_document(presented_path, presented)
        completed = subprocess.run(
            [sys.executable, VERIFY_DRIVER, retained_path, presented_path],
            capture_output=True, text=True)
        output = completed.stdout + completed.stderr
        verdict = "NO_VERDICT"
        for line in output.splitlines():
            stripped = line.strip()
            if stripped.startswith("VERDICT:"):
                verdict = stripped.split(":", 1)[1].strip()
                break
    return {"status": verdict, "exit": completed.returncode,
            "presentedRoot": presented["root"], "proofLength": len(proof)}


# ── CLI ────────────────────────────────────────────────────────────────────────────────────

def render(result: dict, stream=sys.stdout) -> None:
    """Print whatever this run actually established. TOTAL BY CONSTRUCTION: every field is
    optional, because a renderer that raises on a named refusal turns a reported fault into a
    traceback — which is the least useful of the three possible outcomes."""
    print(f"MEMORY LEDGER : {result.get('kiraState', '')}".rstrip(), file=stream)
    print(f"TARGET        : {result.get('target') or '(none configured)'}", file=stream)
    print(f"CHAIN KEY     : {result.get('chainKey', '(undecided)')}", file=stream)
    if result.get("scope"):
        print(f"SEARCHED      : {result['scope']}", file=stream)
    if "presentSize" in result:
        print(f"ENTRIES       : {result['presentSize']}", file=stream)
        print(f"LOCAL SEQ     : {result['localSeq']}", file=stream)
    if "retainedSize" in result:
        print(f"RETAINED SIZE : {result['retainedSize']}", file=stream)
        if result.get("retainedFrom"):
            print(f"RETAINED FROM : {result['retainedFrom']}", file=stream)
    if result.get("mirror"):
        mirror = result["mirror"]
        print(f"MIRROR        : {mirror['status']}  {mirror.get('target') or '(none)'}",
              file=stream)
        if mirror.get("detail"):
            print(f"                {mirror['detail']}", file=stream)
    if result.get("treeSize") is not None:
        print(f"RETAINED NOW  : {result['treeSize']}  root {str(result.get('root'))[:16]}…",
              file=stream)
    print(f"STATUS        : {result['status']}", file=stream)
    # Computed and then dropped at the boundary is the same as not computed. When the
    # store's own marker disagrees with its line count, that is a SECOND, independent
    # signal and it is printed whichever way the main question landed.
    if result.get("also"):
        print(f"ALSO          : {result['also']} — the store's own {KIRA_SEQ_NAME} marker "
              f"disagrees with its line count", file=stream)
    if result.get("detail"):
        print(f"DETAIL        : {result['detail']}", file=stream)
    for entry in result.get("crossReferences") or []:
        print(f"CROSS-REF     : {entry['outcome']}  {entry.get('label')} "
              f"(size {entry.get('recordedSize')})", file=stream)
        if entry.get("detail"):
            print(f"                {entry['detail']}", file=stream)
    if result.get("crossNote"):
        print(f"NOTE          : {result['crossNote']} — a referenced ledger that is away is "
              "not evidence of equivocation", file=stream)
    print("CEILING       : RETAINER_SAME_OWNER — a second directory on this host is not a second")
    print("                device. COMPLETENESS is a statement about a prefix, never about the tip.")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="retain or check the Kira memory ledger's head, outside the state directory")
    parser.add_argument("verb", choices=["retain", "check", "config"])
    parser.add_argument("--state", required=True,
                        help="Kira memory state directory holding aura.jsonl")
    parser.add_argument("--target", help="where the retained head lives (outside the state dir)")
    parser.add_argument("--cross-ref", action="append", default=[], metavar="STATE",
                        help="another ledger's state directory to remember in this head "
                             "(repeatable). Two trains: share proof, never share state.")
    parser.add_argument("--chain-key", default=MEMORY_CHAIN_KEY)
    parser.add_argument("--mirror", metavar="DIR",
                        help="the SECOND copy, off this disk by default "
                             f"({MIRROR_TARGET})")
    parser.add_argument("--no-mirror", action="store_true",
                        help="use ONLY the named store: consult no mirror and write none. This is "
                             "how a caller says 'there is nowhere else to look', which is the "
                             "only honest way to ask a no-head question")
    args = parser.parse_args(argv[1:])

    if args.verb == "config":
        # The knob, inspectable, for BOTH destinations: "where would this actually write, and
        # who said so" is a question an operator should be able to ask without retaining.
        named, provenance = configured_target(args.state, args.target)
        mirror = mirror_target_for(args.mirror)
        result = {
            "status": STATUS_RETAINED if named else STATUS_NOT_CONFIGURED,
            "target": named, "chainKey": args.chain_key,
            "detail": (f"destination came from the {provenance}; the standalone default is "
                       f"{DEFAULT_TARGET}" if named else
                       f"nothing named a destination (looked at --target, {TARGET_ENV}, and "
                       f"{os.path.join(os.path.abspath(args.state), STATE_CONFIG_NAME)})"),
            "mirror": {"status": STATUS_MIRROR_WRITTEN if mirror else STATUS_MIRROR_NOT_CONFIGURED,
                       "target": mirror},
        }
    elif args.verb == "retain":
        result = retain(args.state, args.target, args.chain_key, cross_refs=args.cross_ref,
                        mirror_arg=args.mirror, local_only=args.no_mirror)
    else:
        result = check(args.state, args.target, args.chain_key, mirror_arg=args.mirror,
                       local_only=args.no_mirror)
    result["kiraState"] = os.path.abspath(args.state)
    render(result)

    if result["status"] == STATUS_RETAINED:
        return 0
    if result["status"] == STATUS_NOT_CONFIGURED:
        # The deliberate no-op, exactly as RETAINER_NOT_CONFIGURED is: nobody asked, so
        # nothing is written and nothing failed.
        return 0
    if result["status"] == STATUS_UNDETERMINED:
        # NOT a failure of the command and NOT a green: the question was asked and the evidence
        # to answer it was never kept. Exit 3 is the driver's own code for exactly this.
        return 3
    if result["status"] in (STATUS_TRUNCATED, STATUS_PREFIX_REWRITTEN, STATUS_LOCAL_SEQ,
                            STATUS_CROSS_CONFLICT):
        # A cross-reference conflict is deliberately in this group rather than falling through
        # to `result["exit"]`: the court's exit for the green it just gave is 0, so an
        # equivocation would have exited GREEN. The override has to reach the exit status, or
        # it is a printed word with no consequence.
        return 1
    if result["status"] == STATUS_REFUSED:
        return 2
    return result.get("exit", 1)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
