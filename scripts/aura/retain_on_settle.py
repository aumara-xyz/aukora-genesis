#!/usr/bin/env python3
"""retain-on-settle — the producer path retains its own head, and a retainer outage is a flag.

    python3 scripts/aura/retain_on_settle.py --state <dir> [--target <dir|git-url|http-url>]

WHY THIS IS NOT AN OPERATOR COMMAND. A retained head only says something when it was kept
before the history it checks could change. An operator who remembers to run `retain --publish`
after each settle produces a record of when they remembered, and the interval they forgot is
exactly the interval a rewrite would live in. So the settle itself retains: whoever settles,
retains, and there is no separate decision to skip.

WHAT IT CALLS. `scripts/aura/adapter.py`'s own `--publish` path, the operator command's code and
not a second implementation of it: a directory or a git working copy through
`scripts/phase0/retainer.py`'s writer, a git URL through that same writer inside a temporary
clone plus its own commit-and-push, an `http(s)` URL through the witness. The retained document
is built by the same functions the `retain` verb uses, so the producer's head and the operator's
head are the same document or neither is.

AN OUTAGE IS A FLAG, NEVER A BLOCK. A retainer that is down must not roll back an effect that
already happened: the receipt is issued, the entry is in the log, and the failure to publish
belongs to the retainer, not to the transition. This module therefore never raises for a
publish failure; it returns `RETAINER_UNREACHED` with the reason, the caller prints it beside
the receipt it applies to, and the size is written to a pending list so the next settle that
CAN reach the retainer publishes what was missed, oldest first, before its own head. Losing a
publish is recoverable; losing the effect would not be.

THE RECEIPT DOCUMENT IS NOT TOUCHED, AND THAT IS A CEILING, NOT A CHOICE. The accepted receipt
contract is a closed set (`scripts/composition/receipt.py` refuses unknown fields at both the
top level and inside `aura`), so a retainer flag written into the receipt would make every
receipt `RECEIPT_TAMPERED` — the signature would still verify and the document would still be
refused. The flag therefore rides the delivery record beside the receipt
(`<state>/receipts/<id>-<NNN>.retainer.json`, which carries neither `kind` nor `aura` and is
skipped by the adapter's receipt discovery) and the line the settle prints. That file says what
happened to that settlement's retention; the receipt says what the issuer signed, unchanged.

EVIDENCE, NOT CUSTODY. A retainer reached by this host is `RETAINER_SAME_OWNER` like every other
path in this lane, and the published document is evidence that a head existed at a time — not
that an independent party agrees, not that the transition had an effect, and not a receipt.

TWO NAMES, BECAUSE ONE NAME WAS DOING TWO JOBS. `AUKORA_AURA_RETAINER` names **the retainer
program the release carries**: the launcher derives it from the release, writes it into
`gate-state/gate-config.json` as `auraRetainer`, and exports it only when the release actually
holds the file — and the cutover and rollback paths read it back out of the running process's own
environment to refuse a successor whose retainer belongs to the superseded tree
(`upgrade-release.py`'s `retainer-names-another-release`). This module used to read that same
variable as the place to publish TO. One name, two meanings, and the collision failed in the
quietest direction available: the program path was handed to the directory writer, `makedirs`
raised a bare `NotADirectoryError`, and the outage arm reported it as `RETAINER_UNREACHED` — the
same status, and near-identical text, that a retainer which is merely down produces. A settle in a
governed launch therefore read as an outage that never cleared while nothing was ever retained,
and every such settle queued another size for a catch-up that could never run.

So the destination has its own name — `AUKORA_AURA_RETAINER_TARGET`; `--target` still wins over
everything, and `<state>/aura/retainer.json` is unchanged — and naming the PROGRAM where a
destination belongs is now a refusal with a name instead of an outage with a shrug:
`RETAINER_TARGET_NOT_A_DESTINATION`. It stays a flag and never a block, because the effect settled
before this module ran, but it can no longer be mistaken for a retainer that is down.

A BROKEN CONFIGURATION IS NOT AN ABSENT ONE. The same reading applied one level earlier: a
`<state>/aura/retainer.json` that exists and cannot be turned into a destination used to return
`RETAINER_NOT_CONFIGURED`, the status that means "nobody asked to retain" — so it printed nothing,
wrote nothing and exited 0, and a deployment whose configuration was corrupt was indistinguishable
from one that had deliberately decided not to retain. A file at that path declares intent, so it is
now `RETAINER_CONFIG_UNUSABLE` with the reason named: `aura-retainer-config-unreadable`, or
`aura-retainer-config-names-no-target`. That guard also covers a JSON document that is not an
object, which previously reached `.get` and raised `AttributeError` into the caller's blanket
handler — reported, once more, as an outage.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import time

# A RELEASE MUST SURVIVE BEING USED. This file loads `adapter.py` by path and, for a git or
# directory destination, `phase0/retainer.py`; an interpreter allowed to write bytecode caches both
# — INSIDE the release. The release's own artifact checker re-measures the tree's file and byte
# totals against `strip-manifest.json`, which counts that debris, so a release that has been used
# once fails its own `strip-totals-mismatch` check. This is the switch
# `PYTHONDONTWRITEBYTECODE=1` / `python3 -B` sets, set from inside so it holds however this command
# is invoked. It does NOT cover this file's OWN cache entry, which the loader writes before this
# line runs — so a caller that loads this file by path sets the flag first, which is exactly what
# `serialize-admissions.py` does and why the flag is in every entry point and not only in the
# modules that appear to need it.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
PHASE0_DIR = os.path.join(os.path.dirname(HERE), "phase0")

#: Where the retainer is configured. The environment wins over the file because a deployment
#: sets it per launch; the file is what a bare `serialize-admissions.py` run reads.
TARGET_ENV = "AUKORA_AURA_RETAINER_TARGET"
#: NOT a target, and deliberately still read: this is the name the launcher, the gate config and
#: the rollback checker bind to the retainer PROGRAM. It is read here only so that a deployment
#: which sets it and configures no destination gets a refusal that says so, instead of the
#: `RETAINER_UNREACHED` that a path-where-a-directory-belongs used to produce.
PROGRAM_ENV = "AUKORA_AURA_RETAINER"
CONFIG_RELPATH = os.path.join("aura", "retainer.json")
PENDING_RELPATH = os.path.join("aura", "retainer-pending.json")
DELIVERY_SUFFIX = ".retainer.json"
#: A bounded catch-up. A retainer that was down for a thousand settles is a different problem
#: from a lost minute, and an unbounded loop would turn one outage into a settle that hangs.
CATCH_UP_LIMIT = 32
CUSTODY = "RETAINER_SAME_OWNER"

STATUS_PUBLISHED = "RETAINER_PUBLISHED"
STATUS_UNREACHED = "RETAINER_UNREACHED"
STATUS_NOT_CONFIGURED = "RETAINER_NOT_CONFIGURED"
STATUS_HOOK_ABSENT = "RETAINER_HOOK_ABSENT"
#: The configured destination cannot be published to, and the reason is a NAME, not an outage.
#: Distinct from `RETAINER_UNREACHED` on purpose: an outage clears, a misnaming does not, and
#: reporting both as the same status is what made every governed settle look merely unlucky.
STATUS_TARGET_NOT_A_DESTINATION = "RETAINER_TARGET_NOT_A_DESTINATION"
#: A configuration FILE exists and cannot be turned into a destination. Distinct from
#: `RETAINER_NOT_CONFIGURED`, which is the deliberate no-op: that one means nobody asked for
#: retention, this one means somebody did and the asking is broken.
STATUS_CONFIG_UNUSABLE = "RETAINER_CONFIG_UNUSABLE"

REFUSAL_PROGRAM_IS_NOT_A_DESTINATION = "aura-retainer-program-is-not-a-destination"
REFUSAL_TARGET_IS_A_FILE = "aura-retainer-target-is-a-file"
REFUSAL_CONFIG_UNREADABLE = "aura-retainer-config-unreadable"
REFUSAL_CONFIG_NAMES_NO_TARGET = "aura-retainer-config-names-no-target"


def now_ms() -> int:
    return int(time.time() * 1000)


def load_adapter():
    """The operator command's module, by path: this lane's `--publish`, not a copy of it."""
    path = os.path.join(HERE, "adapter.py")
    spec = importlib.util.spec_from_file_location("aura_adapter_for_settle", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configured_target(state: str, target: str | None = None) -> tuple[str | None, str, dict | None]:
    """(target, where it came from, refusal). No target configured is a real answer, not a failure.

    A config FILE that exists and cannot be turned into a destination is NOT that answer, and
    reporting it as one is how a corrupt `<state>/aura/retainer.json` came to exit 0 in silence —
    indistinguishable from a producer that was never asked to retain anything. This file is a
    deliberate declaration that retention was intended, so failing to read it is a refusal with a
    name, not an absence.

    A JSON document that is not an object is refused here rather than crashing on `.get` further
    down, which is what the previous version did: a bare list or string in that file reached
    `document.get("target")`, raised `AttributeError`, and was reported as `RETAINER_UNREACHED` by
    the caller's blanket handler — an outage again, for a file that no retainer could ever fix.
    """
    if target:
        return target, "argument", None
    from_env = os.environ.get(TARGET_ENV)
    if from_env:
        return from_env.strip(), f"env {TARGET_ENV}", None
    config_path = os.path.join(os.path.abspath(state), CONFIG_RELPATH)
    if os.path.exists(config_path):
        try:
            with open(config_path, encoding="utf-8") as handle:
                document = json.load(handle)
        except (OSError, ValueError) as exc:
            return None, config_path, {
                "refusal": REFUSAL_CONFIG_UNREADABLE,
                "named": config_path,
                "reason": (
                    f"{config_path} exists and could not be read as a retainer configuration "
                    f"({type(exc).__name__}: {exc}). A corrupt configuration is not an absent one: "
                    f"this file declares that retention was intended, and reporting "
                    f"RETAINER_NOT_CONFIGURED for it — a status that exits 0 and writes nothing — "
                    f"would make a broken deployment indistinguishable from one that never asked "
                    f"to retain. Fix the file, or remove it to mean 'do not retain'."
                ),
            }
        value = document.get("target") if isinstance(document, dict) else None
        if isinstance(value, str) and value.strip():
            return value.strip(), config_path, None
        shape = "no usable \"target\" string" if isinstance(document, dict) else f"a {type(document).__name__}, not an object"
        return None, config_path, {
            "refusal": REFUSAL_CONFIG_NAMES_NO_TARGET,
            "named": config_path,
            "reason": (
                f"{config_path} exists but yields no destination: it holds {shape}. A file at this "
                f"path is a declaration that retention was intended, so it refuses rather than "
                f"reporting RETAINER_NOT_CONFIGURED, which exits 0 and writes nothing. Write "
                f'{{"target": "<directory|git-url|witness-url>"}} or remove the file to mean '
                f"'do not retain'."
            ),
        }
    return None, "no target configured", None


def program_named_as_destination() -> dict | None:
    """The collision, named. `${PROGRAM_ENV}` is set and no destination is configured.

    This is the state a governed launch is actually in: `launch-dsh.py` and `upgrade-release.py`
    both export this variable from the release, and this module used to read it as the target. It
    is not an outage and it does not clear on its own, so it is refused by name rather than
    reported as one. An empty value is not "set": a caller that blanks the variable to ask for the
    unconfigured default still gets `RETAINER_NOT_CONFIGURED`.
    """
    value = os.environ.get(PROGRAM_ENV)
    if not value or not value.strip():
        return None
    return {
        "refusal": REFUSAL_PROGRAM_IS_NOT_A_DESTINATION,
        "named": value.strip(),
        "reason": (
            f"{PROGRAM_ENV} is set to {value.strip()}, which names the retainer PROGRAM this release "
            f"carries and not a place anything can be published. Retention publishes to "
            f"${TARGET_ENV}, to --target, or to <state>/{CONFIG_RELPATH}. Nothing was published and "
            f"nothing was queued: this is a configuration that does not clear by waiting, and "
            f"reporting it as RETAINER_UNREACHED is what made it read as an outage that never ended."
        ),
    }


def destination_refusal(resolved: str) -> dict | None:
    """A destination is a directory, a path that can become one, or an http(s)/git URL.

    An EXISTING FILE is none of those, and it is the shape the collision takes when the program
    path is handed over under the destination's own name: `place_first_retention` walks into
    `os.makedirs` on `<file>/heads/...` and raises a bare `NotADirectoryError`, which reaches the
    settle as `RETAINER_UNREACHED`. Refusing here instead names the condition at the layer that
    can tell the difference. A path that does NOT exist is left alone: a git working copy that is
    about to be created is a legitimate destination, and refusing it would refuse the normal case.
    """
    if resolved.startswith(("http://", "https://", "git@", "ssh://")) or resolved.endswith(".git"):
        return None
    absolute = os.path.abspath(resolved)
    if not os.path.isfile(absolute):
        return None
    hint = ""
    if os.path.basename(absolute) in (os.path.basename(__file__), "retain_on_settle.py"):
        hint = f" That is the retainer program itself; ${PROGRAM_ENV} names it, and it is not a destination."
    return {
        "refusal": REFUSAL_TARGET_IS_A_FILE,
        "named": absolute,
        "reason": (
            f"the retainer destination {absolute} is an existing FILE, and a destination is a "
            f"directory or a URL. Publishing writes <destination>/heads/<chainKey>/size-<N>.json, "
            f"so this target could only ever fail inside makedirs with a bare NotADirectoryError "
            f"that the outage arm reports as RETAINER_UNREACHED.{hint}"
        ),
    }


def refusal_for(resolved: str | None, target: str | None = None) -> dict | None:
    """The one place a target is judged before anything is published. `--target` is judged too.

    It is not exempt: a caller who passes the program path as `--target` has made the same mistake
    through the same door, and this refusal is the only thing that tells them apart from an outage.
    """
    if target or resolved:
        return destination_refusal(target or resolved or "")
    return program_named_as_destination()


def reads_pending(state: str) -> dict:
    path = os.path.join(os.path.abspath(state), PENDING_RELPATH)
    if not os.path.exists(path):
        return {"pending": [], "lastStatus": None}
    try:
        with open(path, encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError):
        # An unreadable pending list is reported as a list that says so, never as an empty one:
        # an empty list would silently drop the sizes that were waiting to be published.
        return {"pending": [], "lastStatus": None, "unreadableAt": now_ms()}
    if not isinstance(document.get("pending"), list):
        document["pending"] = []
    return document


def write_pending(state: str, document: dict) -> None:
    directory = os.path.join(os.path.abspath(state), "aura")
    os.makedirs(directory, exist_ok=True)
    target = os.path.join(directory, "retainer-pending.json")
    handle, temp = tempfile.mkstemp(dir=directory, prefix=".pending-", suffix=".tmp")
    with os.fdopen(handle, "w", encoding="utf-8") as stream:
        json.dump(document, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(temp, target)


def publish(adapter, target: str, chain_key: str, size: int, document: dict, issuer: dict, out: str) -> dict:
    """Dispatch on the target's shape, through the adapter's own publish path.

    A git URL is a directory that is not here yet: it is cloned into a temporary working copy,
    written with the Phase 0 writer, and pushed. This is the one path that reaches a remote, and
    it is deliberately the same writer and the same layout the operator command uses.
    """
    if target.startswith(("http://", "https://")) and not target.endswith(".git"):
        return adapter.publish_observation(target, chain_key, size, document, issuer=issuer, out=out)
    if target.startswith(("git@", "ssh://")) or target.endswith(".git"):
        sys.path.insert(0, PHASE0_DIR)
        import retainer as retainer_mod  # noqa: PLC0415

        with tempfile.TemporaryDirectory(prefix="aura-retain-git-") as tmp:
            root = os.path.join(tmp, "retainer")
            retainer_mod.clone_retainer(target, root)
            published = adapter.publish_to_retainer(None, root, chain_key, size, document)
            pushed = retainer_mod.publish_directory(root, f"retain {chain_key} size {size}")
            published["url"] = target
            published["kind"] = "git"
            published["pushed"] = pushed
            return published
    return adapter.publish_observation(target, chain_key, size, document, issuer=issuer, out=out)


def observation_for(adapter, state: str, size: int) -> tuple[dict, str]:
    """The retained observation for one prefix, built exactly as the `retain` verb builds it."""
    log = adapter.read_log(state)
    phase0_hashes, _records = adapter.read_phase0_view(state)
    if size > log.size():
        raise adapter.AssociationRefusal(
            "aura-retain-beyond-log", f"cannot retain size {size}; this log has {log.size()} entries"
        )
    chain_key = adapter.chain_key_for(log.entries)
    return adapter.phase0log.observation(size, phase0_hashes, 1, chain_key), chain_key


def delivery_path(state: str, receipt_path: str | None, seq: int | None) -> str | None:
    if not receipt_path:
        return None
    base = os.path.basename(receipt_path)
    if base.endswith(".json"):
        base = base[: -len(".json")]
    return os.path.join(os.path.dirname(os.path.abspath(receipt_path)), f"{base}{DELIVERY_SUFFIX}")


def retain_head_on_settle(
    state: str,
    *,
    target: str | None = None,
    receipt_path: str | None = None,
    seq: int | None = None,
    source: str = "serialize-admissions",
) -> dict:
    """Retain this log's head, catching up anything earlier that could not be published.

    Never raises for a publish failure: the caller is a settle path, and an effect that already
    happened must not be undone or left unsettled by a retainer that is down. Every outcome is
    returned as a status, and the sizes that could not be published are durable, not forgotten.
    """
    state = os.path.abspath(state)
    result = settle_once(state, target=target, source=source)
    # An unconfigured retainer leaves no trace: a producer that was never told to retain must
    # behave exactly as it did before this hook existed, down to the files it writes.
    if result["status"] != STATUS_NOT_CONFIGURED:
        record_delivery(state, receipt_path, seq, result)
    return result


def refused(
    state: str, refusal: dict, resolved: str | None, provenance: str, source: str, status: str, note: str
) -> dict:
    """Refuse by name, keep what was waiting, and never report a status an outage could produce.

    The size is still queued when the log can be read, for the reason an outage queues it: the
    configuration will be corrected by someone, and the next settle that CAN publish should publish
    what this one could not, oldest first. What is not done is publishing anything, or returning a
    status that a retainer which is merely down would also return.
    """
    try:
        size: int | None = load_adapter().read_log(state).size()
    except Exception:  # noqa: BLE001 - the refusal stands whether or not the log can be read here
        size = None
    queued = [
        entry
        for entry in reads_pending(state)["pending"]
        if isinstance(entry, dict) and isinstance(entry.get("size"), int)
    ]
    still_pending = [entry for entry in queued if size is None or entry["size"] <= size]
    if size is not None and size not in {entry["size"] for entry in still_pending}:
        still_pending.append({"size": size, "reason": refusal["reason"], "firstUnreachedAt": now_ms()})
    still_pending.sort(key=lambda entry: entry["size"])
    write_pending(
        state,
        {
            "pending": still_pending,
            "lastStatus": status,
            "target": resolved,
            "checkedAt": now_ms(),
            "catchUpLimit": CATCH_UP_LIMIT,
            "refusal": refusal["refusal"],
            "note": note,
        },
    )
    return {
        "status": status,
        "refusal": refusal["refusal"],
        "target": resolved,
        "targetSource": provenance,
        "size": size,
        "published": [],
        "pending": still_pending,
        "reason": refusal["reason"],
        "source": source,
        "custody": CUSTODY,
        "checkedAt": now_ms(),
        "note": "a refusal is not an outage: it does not clear by waiting, and the effect settled "
                "before this hook ran",
    }


def target_refused(state: str, refusal: dict, resolved: str, provenance: str, source: str) -> dict:
    """The destination is named in a way nothing can be published to."""
    return refused(
        state, refusal, resolved, provenance, source, STATUS_TARGET_NOT_A_DESTINATION,
        "the destination is misnamed, not down: these sizes wait so a corrected destination "
        "publishes them oldest first, before its own head",
    )


def config_unusable(state: str, refusal: dict, provenance: str, source: str) -> dict:
    """A configuration file declares retention and cannot be turned into a destination.

    Deliberately not `RETAINER_NOT_CONFIGURED`. That status means nobody asked for retention, and a
    reader is entitled to treat it as a no-op; this one means somebody asked and the asking is
    broken, which is a thing to go and fix.
    """
    return refused(
        state, refusal, None, provenance, source, STATUS_CONFIG_UNUSABLE,
        "the configuration is unusable, not absent: these sizes wait so a repaired configuration "
        "publishes them oldest first, before its own head",
    )


def settle_once(state: str, *, target: str | None, source: str) -> dict:
    resolved, provenance, config_refusal = configured_target(state, target)
    if not resolved:
        # NO DESTINATION, NO PROGRAM NAMED, AND NO UNUSABLE CONFIG FILE: the producer was never told
        # to retain, and that stays the no-op it always was, down to the files it writes. The two
        # ways of being TOLD and still having no destination — a program named in a destination's
        # place, and a config file that cannot be read — are different answers, and they are refused
        # by name below rather than folded into this one.
        if config_refusal is None and program_named_as_destination() is None:
            return {"status": STATUS_NOT_CONFIGURED, "reason": provenance, "target": None, "custody": CUSTODY}
    if config_refusal is not None:
        return config_unusable(state, config_refusal, provenance, source)
    refusal = refusal_for(resolved, target)
    if refusal is not None:
        return target_refused(state, refusal, resolved, provenance, source)
    try:
        adapter = load_adapter()
    except Exception as exc:  # noqa: BLE001 - an absent hook is reported, never silently skipped
        return {
            "status": STATUS_HOOK_ABSENT,
            "reason": f"the adapter could not be loaded for retain-on-settle: {type(exc).__name__}: {exc}",
            "target": resolved,
            "custody": CUSTODY,
        }

    out = os.path.join(state, "aura", "retain-out")
    issuer = adapter.issuer_snapshot(state) if hasattr(adapter, "issuer_snapshot") else {"publicKey": None}
    pending = reads_pending(state)
    queued = [entry for entry in pending["pending"] if isinstance(entry, dict) and isinstance(entry.get("size"), int)]

    try:
        log_size = adapter.read_log(state).size()
    except Exception as exc:  # noqa: BLE001
        return {
            "status": STATUS_UNREACHED,
            "reason": f"the log could not be read, so no head could be retained: {type(exc).__name__}: {exc}",
            "target": resolved,
            "size": None,
            "custody": CUSTODY,
        }

    wanted: list[int] = []
    for entry in sorted(queued, key=lambda item: item["size"]):
        if entry["size"] not in wanted and entry["size"] <= log_size:
            wanted.append(entry["size"])
    wanted = wanted[:CATCH_UP_LIMIT]
    if log_size not in wanted:
        wanted.append(log_size)

    published_sizes: list[dict] = []
    failure: tuple[int, str] | None = None
    for size in wanted:
        try:
            document, chain_key = observation_for(adapter, state, size)
            result = publish(adapter, resolved, chain_key, size, document, issuer, out)
            published_sizes.append({"size": size, "sha256": result.get("sha256"), "path": result.get("path")})
        except Exception as exc:  # noqa: BLE001 - one more belt: the settle path must not fail here
            failure = (size, f"{type(exc).__name__}: {exc}")
            break

    still_pending = [entry for entry in queued if entry["size"] not in {item["size"] for item in published_sizes}]
    if failure is not None and failure[0] not in {entry["size"] for entry in still_pending}:
        still_pending.append({"size": failure[0], "reason": failure[1], "firstUnreachedAt": now_ms()})
    still_pending = [entry for entry in still_pending if entry["size"] <= log_size]
    write_pending(
        state,
        {
            "pending": still_pending,
            "lastStatus": STATUS_UNREACHED if failure is not None else STATUS_PUBLISHED,
            "target": resolved,
            "checkedAt": now_ms(),
            "catchUpLimit": CATCH_UP_LIMIT,
            "note": "sizes whose publication failed; the next settle that reaches the retainer "
                    "publishes them oldest first, before its own head",
        },
    )

    status = STATUS_PUBLISHED if failure is None else STATUS_UNREACHED
    return {
        "status": status,
        "target": resolved,
        "targetSource": provenance,
        "size": log_size if failure is None else failure[0],
        "published": published_sizes,
        "pending": still_pending,
        "reason": None if failure is None else failure[1],
        "source": source,
        "custody": CUSTODY,
        "checkedAt": now_ms(),
        "note": "a retainer this host reaches is RETAINER_SAME_OWNER: it shows the head existed "
                "before the next append, and not that an independent party agrees",
    }


def record_delivery(state: str, receipt_path: str | None, seq: int | None, result: dict) -> str | None:
    """What happened to this settlement's retention, beside the receipt it belongs to.

    Deliberately not inside the receipt: the accepted contract is a closed set, so a flag added
    there would make the document `RECEIPT_TAMPERED` while the signature still verified.
    """
    path = delivery_path(state, receipt_path, seq)
    if path is None:
        return None
    document = {
        "settlement": {"receipt": os.path.basename(receipt_path), "seq": seq},
        "retainer": {
            "status": result["status"],
            "target": result.get("target"),
            "size": result.get("size"),
            "published": result.get("published"),
            "pending": result.get("pending"),
            "reason": result.get("reason"),
            # The NAME of the refusal, when there is one, so a reader of this record does not have
            # to parse English out of `reason` to tell a misnaming from an outage.
            "refusal": result.get("refusal"),
            "custody": result.get("custody"),
            "checkedAt": result.get("checkedAt"),
        },
        # A flag is any status that says the head was NOT kept. It used to be UNREACHED alone, which
        # meant a misnamed destination — a state that never clears — rode along as a retainer that
        # happened to be down, and the delivery record agreed with that reading.
        "flag": result["status"]
        if result["status"] in (STATUS_UNREACHED, STATUS_TARGET_NOT_A_DESTINATION, STATUS_CONFIG_UNUSABLE)
        else None,
        "note": "a retainer status is not a receipt, not an effect and not a grant; the effect "
                "settled before this file was written, whatever it says",
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return path


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="retain this log's head after a settle")
    parser.add_argument("--state", required=True)
    parser.add_argument("--target", help=f"directory, git URL or witness URL; defaults to ${TARGET_ENV} "
                                         f"or <state>/{CONFIG_RELPATH}")
    parser.add_argument("--receipt", help="the receipt this settlement wrote, for the delivery record")
    parser.add_argument("--seq", type=int)
    args = parser.parse_args(argv[1:])
    result = retain_head_on_settle(args.state, target=args.target, receipt_path=args.receipt, seq=args.seq)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] in (STATUS_PUBLISHED, STATUS_NOT_CONFIGURED) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
