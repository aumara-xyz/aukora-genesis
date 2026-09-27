#!/usr/bin/env python3
"""release-retention.py — the bound on materialized releases, and the ONLY safe way to collect them.

WHY THIS EXISTS. `materialize-aukora-release.py` wrote a whole new release at every new `--to` path and
NEVER LOOKED AT ITS SIBLINGS, so 22 root-level `~/aukora-release-*` copies (39 GiB) accumulated in five
days and Peter's disk collapsed.

WHY IT REFUSES BY DEFAULT. The first version of this file COLLECTED automatically on the next
materialize — which would have DELETED PETER'S FILES WITHOUT ASKING. Worse, an old release is not dead
bytes: a state root can hold HUNDREDS OF SYMLINKS INTO A RELEASE TREE, and removing it silently breaks
every one of them. **The default is therefore to REFUSE, list the candidates oldest-first with their
sizes and any inbound symlinks, and REMOVE NOTHING.** Removal needs the explicit `--prune-oldest` flag,
and even then it SKIPS any release a state root links into or a running process holds open, naming each.
"""
import os
import re
import shutil

# ══ **THIS IMPORT MUST NOT DEPEND ON THE CALLER'S CWD OR LOADER (aumlok-130)** ══════════════════════════
#
# `from lib.platform_tools import …` resolves only when `scripts/` happens to be on `sys.path`. ALPHA's alpha-26
# platform-tool seam added that import, and BETA's rehearsal at 51b51312074d caught the consequence in two courts
# at once (`aukora-launchd-arms-guard`, `aukora-cutover-label-reaper`) with **`Error: No module named lib`**.
#
# **THE FAILURE IS NOT THE IMPORT — IT IS THE ASSUMPTION.** A court that loads this file with
# `spec_from_file_location`, or runs it from another working directory, never had `scripts/` on the path at all.
# AURA hit the same thing in this very file and fixed it ONE-OFF by putting `scripts/` on the path in the caller
# (`scripts/aukora/cut-release.sh`, 3d478f63) — **which fixed that caller and left every other one broken.**
#
# So the file resolves ITS OWN DIRECTORY, which is the only thing true in all three loading modes:
#   · run as a script        — `__file__` is the path, `sys.path[0]` is its directory
#   · `spec_from_file_location` — `__file__` is set by importlib
#   · imported as a module   — same
# **`sys.path[0]` IS NOT RELIED ON**: a script run through a wrapper, a symlink or `exec` has whatever the caller
# left there, and *the point of this prelude is that no caller has to be trusted.*
import os as _os
import sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)) if '__file__' in globals() else _os.getcwd()
if _HERE not in _sys.path:
    _sys.path.insert(0, _HERE)

from lib.platform_tools import platform_tool_skip, require_platform_tool

#: Releases that must survive any collection: the two Peter has run, and the two the rollback path names.
PROTECTED_ALWAYS = ('bd69f9cd', 'bd45806a', 'e1e24153', '845ea06')

#: How many UNPROTECTED releases beyond the live one may remain before the bound is reported.
KEEP_BEYOND_PROTECTED = 2

RELEASE_DIR = re.compile(r'^aukora-release-([0-9a-f]{6,40})$')


class RetentionRefusal(Exception):
    """Over the bound, or asked to remove something that must not be removed. Loud, and names what."""


def protected_names(launch_record=None, rollback_record=None, extra=()):
    """The protected set: the fixed four, plus whatever a live launch or rollback record names."""
    names = set(PROTECTED_ALWAYS)
    for record in (launch_record, rollback_record):
        if not record:
            continue
        try:
            with open(record, encoding='utf-8') as handle:
                text = handle.read()
        except OSError:
            continue
        names.update(re.findall(r'\b([0-9a-f]{6,40})\b', text))
    names.update(extra)
    return names


def siblings(release_root, protect):
    """Every `aukora-release-*` directory under `release_root`, oldest first, with its protection flag."""
    found = []
    # THE ROOT IS RESOLVED FIRST, AND THIS IS NOT COSMETIC: on macOS `/tmp` is a symlink to
    # `/private/tmp`, so `entry.path` read `/tmp/...` while `os.path.realpath(link)` read
    # `/private/tmp/...` — the prefix comparison in `inbound_symlinks` never matched, and a release that
    # a state root links into was REMOVED. The court caught it because it asserted the linked release
    # still existed rather than trusting the code that was supposed to keep it.
    release_root = os.path.realpath(release_root)
    try:
        entries = list(os.scandir(release_root))
    except OSError:
        return found
    for entry in entries:
        if not entry.is_dir(follow_symlinks=False):
            continue
        match = RELEASE_DIR.match(entry.name)
        if not match:
            continue
        digest = match.group(1)
        is_protected = any(digest.startswith(p) or p.startswith(digest) for p in protect)
        found.append({'path': entry.path, 'name': entry.name, 'digest': digest,
                      'protected': is_protected, 'mtime': entry.stat().st_mtime})
    found.sort(key=lambda item: item['mtime'])
    return found


def size_of(path):
    """Bytes under `path`, without following symlinks out of the tree."""
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                pass
    return total


def allocated_of(path):
    """Allocated bytes (`st_blocks * 512`), which `size_of` is NOT.

    *** NEITHER THIS NOR `size_of` IS UNSHARED SPACE ON APFS, AND THE DIFFERENCE MATTERS ENOUGH TO SAY HERE. ***
    *Release trees are `cp -Rc` clones: each reports a full allocation while sharing most of its extents with its
    siblings, so BOTH numbers are ceilings rather than claims about what deleting one would free.* **Measured
    2026-09-27: `39ade459` reads 1.8G by `du` and 1.6 GiB by `size_of`, while the whole nine-release pool reads 16G
    against 31Gi of real free space.** *Reported so a reader is not misled by a single authoritative-looking number.*
    """
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_blocks * 512
            except OSError:
                pass
    return total


def free_space(path):
    """Real free bytes on the volume holding `path` -- the measure a DISK-SAFETY bound actually wants."""
    try:
        st = os.statvfs(path)
        return st.f_bavail * st.f_frsize
    except OSError:
        return None


def human(n):
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if n < 1024 or unit == 'TiB':
            return '%.1f %s' % (n, unit)
        n /= 1024.0


def inbound_symlinks(release_path, state_roots=()):
    """Symlinks under any state root that point INTO `release_path`. Hundreds per state root is normal."""
    hits = []
    for state_root in state_roots:
        if not state_root or not os.path.isdir(state_root):
            continue
        for root, dirs, files in os.walk(state_root, followlinks=False):
            for name in list(dirs) + list(files):
                link = os.path.join(root, name)
                try:
                    if not os.path.islink(link):
                        continue
                    target = os.path.realpath(link)
                except OSError:
                    continue
                if target == release_path or target.startswith(release_path + os.sep):
                    hits.append(link)
    return hits


def held_open(release_path):
    """What holds `release_path` open, or None when that CANNOT BE KNOWN — and it SAYS SO.

    THE DOCSTRING USED TO CLAIM IT SAID SO, AND IT SAID NOTHING. MEASURED (alpha-26): `lsof` is a macOS instrument; on
    a host without it the call raised FileNotFoundError, `except Exception: return []` swallowed it, and the caller
    read that empty list as "nothing holds this release open" — so a RETENTION decision, about what may be deleted,
    rested on an instrument that was never run. That is the same fail-open as the run-root reaper, and silence is what
    made it dangerous.

    The tool now comes from the one shared seam (so AUKORA_LSOF_BIN can stand in for it), an absent or unrunnable tool
    returns None — because "cannot tell" and "nothing holds it" are opposite answers — and the reason is PRINTED
    before returning, so a run that could not measure does not read as a run that measured nothing.
    """
    lsof = require_platform_tool('lsof')
    if lsof is None:
        return None
    try:
        import subprocess
        out = subprocess.run([lsof, '-Fn', '+D', release_path], capture_output=True, text=True, timeout=30)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip().splitlines()[:5]
        return []
    except Exception as exc:  # a tool that said it was there and was not: name it, do not swallow it
        print(platform_tool_skip('lsof', reason=f'lsof could not be run: {exc}'))
        return None


def plan(release_root, live=None, protect=(), keep=KEEP_BEYOND_PROTECTED):
    """Return (over_bound, remove_candidates, kept). Never raises for being over the bound."""
    protect = set(protect) | set(PROTECTED_ALWAYS)
    items = siblings(release_root, protect)
    keep_names = {i['name'] for i in items if i['protected']}
    if live:
        keep_names.add(live)
    budget = keep
    for item in reversed(items):
        if item['name'] in keep_names:
            continue
        if budget > 0:
            keep_names.add(item['name'])
            budget -= 1
    remove = [i for i in items if i['name'] not in keep_names]
    kept = [i for i in items if i['name'] in keep_names]
    if keep < 0 and items:
        raise RetentionRefusal(
            'the requested bound (%d beyond protected) cannot be met: %d protected release(s) must stay — %s'
            % (keep, len([i for i in items if i['protected']]),
               ', '.join(i['name'] for i in items if i['protected'])))
    return bool(remove), remove, kept


def enforce(release_root, live=None, protect=(), keep=KEEP_BEYOND_PROTECTED,
            prune=False, state_roots=(), dry_run=False):
    """THE DEFAULT REFUSES. `prune=True` removes, skipping anything linked or held open, and names it."""
    over, remove, kept = plan(release_root, live=live, protect=protect, keep=keep)
    for item in kept:
        print('RETAIN keep   %s%s' % (item['name'], ' (protected)' if item['protected'] else ''))
    if not over:
        print('RETAIN under the bound: %d release(s), nothing to report' % len(kept))
        return []

    candidates = []
    for item in remove:
        links = inbound_symlinks(item['path'], state_roots)
        held = held_open(item['path'])
        if held is None:
            # **CANNOT TELL MEANS DO NOT DELETE.** MEASURED (alpha-26): held_open returns None when lsof is absent,
            # and [] when lsof ran and found nothing — and this loop treated those as the SAME value, so a host
            # without lsof would prune a release that might be held open. The item is therefore treated as held,
            # with the reason named in the listing below, because failing closed here costs a kept directory and
            # failing open costs somebody's running release. NOTE: with lsof present this branch is UNREACHABLE
            # (held_open returns [] or a list), so the Mac's behaviour is unchanged by construction.
            held = ['unknown: lsof is unavailable on this host, so this release is treated as held']
        candidates.append((item, links, held))

    print('RETAIN OVER THE BOUND — %d removal candidate(s), OLDEST FIRST:' % len(candidates))
    for item, links, held in candidates:
        _free = free_space(item['path'])
        # *** THE SIZE IS LABELLED BECAUSE IT IS NOT A CLAIM ABOUT FREEABLE SPACE. *** *On an APFS clone
        # tree the apparent and allocated figures both overstate what deleting this would free; the free-space
        # reading beside them is the one a disk-safety decision can act on.*
        print('RETAIN candidate %s  %s apparent / %s allocated  (disk free %s)  %s'
              % (item['name'], human(size_of(item['path'])), human(allocated_of(item['path'])),
                 human(_free) if _free is not None else 'unknown',
                                               'PROTECTED' if item['protected'] else 'unprotected'))
        if links:
            print('RETAIN   %d inbound symlink(s) from a state root, e.g. %s' % (len(links), links[0]))
        if held:
            print('RETAIN   held open by a running process: %s' % held[0])

    if not prune:
        raise RetentionRefusal(
            'over the bound at %s: %d candidate(s) listed above and NOTHING WAS REMOVED. '
            'Removal is opt-in: pass --prune-oldest, and even then a linked or in-use release is skipped.'
            % (release_root, len(candidates)))

    removed, skipped = [], []
    for item, links, held in candidates:
        if item['protected']:
            skipped.append((item['name'], 'protected')); continue
        if links:
            skipped.append((item['name'], '%d inbound symlink(s) from a state root' % len(links))); continue
        if held:
            skipped.append((item['name'], 'held open by a running process')); continue
        print('RETAIN remove %s (oldest-first; not protected, not linked, not in use)' % item['name'])
        if not dry_run:
            shutil.rmtree(item['path'], ignore_errors=True)
        removed.append(item['name'])
    for name, why in skipped:
        print('RETAIN SKIP   %s — %s' % (name, why))
    return removed


def bounded(release_root, live=None, protect=(), keep=KEEP_BEYOND_PROTECTED):
    """True when the root already satisfies the bound — what a court asserts without pruning anything."""
    try:
        over, _remove, _kept = plan(release_root, live=live, protect=protect, keep=keep)
    except RetentionRefusal:
        return False
    return not over
