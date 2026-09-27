#!/usr/bin/env python3
"""Second retainer — an observation held outside this host's custody.

WHY THIS EXISTS. A retained head on the same disk as the log it checks proves
arithmetic and nothing about custody: whoever can rewrite the log can rewrite the
retained copy. Until a head is held somewhere the log's owner does not control, every
receipt over it prints FRESHNESS_LOCAL_ONLY and the court's answer is about two files
one party supplied. This module moves the retained observation across a custody
boundary.

WHAT IT DOES NOT PROVE, AND THIS IS THE PART TO READ TWICE. A retainer on the same
GitHub account (`aumara-xyz/aukora-retainer`, held by the Genesis owner) is a different
device, a different failure domain and a different administrative boundary from this
laptop — and it is still the same *principal*. It is named RETAINER_SAME_OWNER for that
reason. It can show that this host did not silently rewrite its own history; it cannot
show that an independent party agrees. Only a second principal holding a copy does that,
and until one does, the honest label travels with every verdict this module produces.

Layout inside a retainer root:
    <root>/heads/<chainKey>/size-<N>.json     the observation, as written by retain-head

A reader asks for a size and gets either that observation or a refusal. There is no
"nearest" and no "latest": a presented head is only comparable to the observation it
actually retained, and guessing which one that was is how a verifier starts inventing
agreement.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

RETAINER_LAYOUT = "aukora-retainer-v1"
SAME_OWNER_NOTE = "RETAINER_SAME_OWNER"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class RetainerError(Exception):
    """A refusal with a reason. Never a silent fallback to local bytes."""


# ── describing a retainer ───────────────────────────────────────────────────────────────────

def describe(spec: str) -> dict:
    """Classify a retainer specifier. A bare path is a directory; anything that looks like a
    git remote is fetched into a temporary clone for reading."""
    if spec.startswith(("git@", "https://", "ssh://")) or spec.endswith(".git"):
        return {"kind": "git", "spec": spec}
    return {"kind": "directory", "spec": os.path.abspath(spec)}


def _chain_dir(root: str, chain_key: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in chain_key)
    return os.path.join(root, "heads", safe)


def head_relpath(chain_key: str, size: int) -> str:
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in chain_key)
    return f"heads/{safe}/size-{size}.json"


# ── writing ────────────────────────────────────────────────────────────────────────────────

def retain_to_directory(spec: str, chain_key: str, size: int, observation: dict, source: str) -> str:
    """Write the observation into a directory retainer (which may itself be a git working
    copy). Returns the path written."""
    root = os.path.abspath(spec)
    target = os.path.join(root, head_relpath(chain_key, size))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    envelope = {
        "layout": RETAINER_LAYOUT,
        "retainedAt": observation.get("retainedAt"),
        "retainedBy": source,
        "observation": observation,
    }
    blob = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    # Refuse to overwrite a different observation for the same size: a retainer that can be
    # rewritten in place is not a retainer.
    if os.path.exists(target):
        existing = read_directory_head(spec, chain_key, size)
        if existing.get("observation", {}).get("root") != observation.get("root"):
            raise RetainerError(
                f"retainer already holds a different observation for size {size} at {target}; "
                "refusing to overwrite. A retainer you can rewrite is not a retainer.")
    with open(target, "wb") as fh:
        fh.write(blob)
    return target


def read_directory_head(spec: str, chain_key: str, size: int) -> dict:
    path = os.path.join(os.path.abspath(spec), head_relpath(chain_key, size))
    if not os.path.exists(path):
        raise RetainerError(f"no retained observation for size {size} in {spec}: {path}")
    try:
        with open(path, "rb") as fh:
            envelope = json.loads(fh.read().decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise RetainerError(f"retained observation at {path} is not admissible json: {exc}") from exc
    if envelope.get("layout") != RETAINER_LAYOUT:
        raise RetainerError(f"retained observation at {path} has layout {envelope.get('layout')!r}, not {RETAINER_LAYOUT!r}")
    if "observation" not in envelope:
        raise RetainerError(f"retained observation at {path} carries no observation")
    return envelope


# ── remote (git) access ────────────────────────────────────────────────────────────────────

def _git(args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def clone_retainer(spec: str, dest: str, ref: str | None = None) -> str:
    """A shallow clone into `dest`. Reading a retainer is a read of a remote's bytes; it is
    never a read of local disk standing in for one."""
    args = ["clone", "--depth", "1", "--quiet"]
    if ref:
        args += ["--branch", ref]
    args += [spec, dest]
    done = _git(args)
    if done.returncode != 0:
        raise RetainerError(f"could not clone retainer {spec}: {done.stderr.strip() or done.stdout.strip()}")
    return dest


def read_git_head(spec: str, chain_key: str, size: int) -> dict:
    with tempfile.TemporaryDirectory(prefix="retainer-read-") as tmp:
        root = os.path.join(tmp, "retainer")
        clone_retainer(spec, root)
        return read_directory_head(root, chain_key, size)


def list_git_sizes(spec: str, chain_key: str) -> list[int]:
    with tempfile.TemporaryDirectory(prefix="retainer-list-") as tmp:
        root = os.path.join(tmp, "retainer")
        clone_retainer(spec, root)
        directory = _chain_dir(os.path.join(root), chain_key)
        if not os.path.isdir(directory):
            return []
        sizes = []
        for name in os.listdir(directory):
            if name.startswith("size-") and name.endswith(".json"):
                try:
                    sizes.append(int(name[5:-5]))
                except ValueError:
                    continue
        return sorted(sizes)


# ── the operation the court consumes ───────────────────────────────────────────────────────

def read_observation(spec: str, chain_key: str, size: int) -> tuple[dict, dict]:
    """Return (observation_document, provenance). Raises RetainerError when the retainer does
    not hold that size. Never falls back to local bytes: a fallback would make the custody
    claim silently false, which is worse than a refusal."""
    described = describe(spec)
    if described["kind"] == "directory":
        envelope = read_directory_head(described["spec"], chain_key, size)
        provenance = {"retainer": described["spec"], "kind": "directory", "custody": SAME_OWNER_NOTE}
    else:
        envelope = read_git_head(described["spec"], chain_key, size)
        provenance = {"retainer": described["spec"], "kind": "git", "custody": SAME_OWNER_NOTE}
    observation = dict(envelope["observation"])
    observation.pop("retainedAt", None)
    provenance["retainedAt"] = envelope.get("retainedAt")
    provenance["retainedBy"] = envelope.get("retainedBy")
    return observation, provenance


def write_observation_for_court(observation: dict, directory: str) -> str:
    """Write the retainer's observation as a document the vendored court can read. The bytes
    come from the retainer, not from any local retained copy."""
    path = os.path.join(directory, "retained-from-retainer.json")
    blob = json.dumps(observation, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    with open(path, "wb") as fh:
        fh.write(blob)
    return path


def publish_directory(spec: str, message: str) -> dict | None:
    """Commit and push a directory retainer that is a git working copy. This is what makes the
    retainer a second custody boundary rather than a second folder.

    A plain directory with no `.git` is not an error: it is a weaker retainer — a second
    store on the same host — and the caller prints the custody limit either way. Returning
    None says "nothing was published", which is different from "published and it worked"."""
    root = os.path.abspath(spec)
    if not os.path.isdir(os.path.join(root, ".git")):
        return None
    _git(["add", "-A"], cwd=root)
    committed = _git(["commit", "-q", "-m", message], cwd=root)
    if committed.returncode != 0 and "nothing to commit" not in (committed.stdout + committed.stderr):
        raise RetainerError(f"commit failed in {root}: {committed.stderr.strip()}")
    pushed = _git(["push", "--quiet"], cwd=root)
    if pushed.returncode != 0:
        raise RetainerError(f"push failed from {root}: {pushed.stderr.strip()}")
    head = _git(["rev-parse", "HEAD"], cwd=root).stdout.strip()
    return {"committed": head, "root": root}


def ensure_directory_retainer(spec: str) -> str:
    """Create the layout in a directory retainer (and, if it is a git working copy, leave
    committing to publish_directory)."""
    root = os.path.abspath(spec)
    os.makedirs(os.path.join(root, "heads"), exist_ok=True)
    readme = os.path.join(root, "README.md")
    if not os.path.exists(readme):
        with open(readme, "w", encoding="utf-8") as fh:
            fh.write(RETAINER_README)
    return root


RETAINER_README = """# AUKORA retainer

Retained Aura head observations. One file per retained size, under `heads/<chainKey>/`.

This repository holds observations, not records, not logs and not identity material: for a
tree of size N it holds the Merkle tree head over the first N records of a named
append-only stream. It exists so that a copy of an earlier observation is held outside the
machine whose log is being checked.

What it does and does not establish:

- It establishes that the observation in here is not on the checked host.
- It does **not** establish that an independent party agrees. This repository belongs to
  the same account as the system it checks, so readers should expect `RETAINER_SAME_OWNER`
  beside any verdict that uses it. Independent custody requires a second principal holding
  a copy, not a second repository belonging to the first.

Files are never rewritten in place. A different root for a size already retained is an
observation conflict and the tooling refuses to overwrite it.
"""
