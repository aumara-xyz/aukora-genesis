#!/usr/bin/env python3
"""Install the AUKORA foundation into a disposable DSH state root.

Three tracked inputs become private state, and nothing else:

1. ``presets/auma-builder`` metadata plus the *shipped* Standard composition,
   with only the persona row rewritten: the generic preset stays upstream
   bytes, so it cannot drift from the coding tools it inherits.
2. The private identity core, injected into that persona prefix at install
   time. It is read from the prepared-context path and never copied into Git,
   a release bundle or a build artifact.
3. A composition patch that inserts the built AUKORA client plugin.

``COVENANT-CONTEXT.md`` is deliberately not read, not written and not
referenced: it stays a file available on demand.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The identity core is supplied by the operator, never read from Git: an
# absolute private path belongs in the environment, not in a repository.
DEFAULT_IDENTITY = Path(os.environ['AUMA_IDENTITY_CORE']) if os.environ.get('AUMA_IDENTITY_CORE') else None
# THE LIVE HOME COMES FROM THE ENVIRONMENT, and its absence is a REFUSAL rather than a silent
# pass. This constant used to be one operator's absolute path, which meant the guard below was
# inert on any other machine — an absolute private path in a repository is exactly what the
# identity core's own rule forbids one line up. Reading it here instead is the same pattern, and
# the unset case must stop the run: a guard against writing live state that quietly does nothing
# is worse than no guard, because it reads as protection.
LIVE_HOME = Path(os.environ['AUMA_LIVE_HOME']).resolve() if os.environ.get('AUMA_LIVE_HOME') else None
MANIFEST_NAME = '.aukora-install-manifest.json'
PRESET_ID = 'auma-builder'
PLUGIN_PACKAGE = '@aukora/dsh-plugin-foundation'


def fail(message: str) -> 'NoReturn':  # noqa: F821 - simple exit helper
    print(f'install-aukora-failed: {message}', file=sys.stderr)
    raise SystemExit(1)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ── production preflight ────────────────────────────────────────────────────────────────────────
#
# WHAT AN "ACTIVE TURN" CAN AND CANNOT MEAN HERE. The obvious signal is wrong: the host holds a
# POSIX `flock` on each session's `session.lock` for THE WHOLE LIFE OF ITS WRITE HANDLE, so an
# idle-but-loaded session still holds one — measured on the live deployment, seven sessions held
# locks while idle. Refusing on a held lock would refuse every production install while the app runs,
# which is the opposite of useful.
#
# The signal that does distinguish them is that DSH APPENDS TO THE SESSION LOG AS EACH EVENT
# OCCURS. Measured on the same host: the session mid-turn had a log mtime equal to the current
# second, while two idle loaded sessions had not been written for 44 and 48 minutes. So "a session
# log modified within a window" separates in-flight work from a merely open session.
#
# ITS CEILING, STATED PLAINLY: a turn that stalls and stops writing for longer than the window looks
# idle. This is a LOCKOUT-AVOIDANCE AND HYGIENE CHECK, not a mutual-exclusion mechanism, and it must
# not be relied on the way a lock may be. Anything that must not interleave with a turn belongs
# behind the process being stopped, which is what a cutover does anyway.

def active_turn_window(state: Path, seconds: float) -> list:
    """Session dirs whose log was written within `seconds`; sorted, newest first."""
    now = time.time()
    hot = []
    roots = list((state / 'home' / 'sessions').glob('*/*/session.v3.jsonl.zstd')) if (state / 'home' / 'sessions').is_dir() else []
    for log in roots:
        try:
            age = now - log.stat().st_mtime
        except OSError:
            continue
        if age <= seconds:
            hot.append((age, log))
    return [log for _, log in sorted(hot, key=lambda pair: pair[0])]


def held_session_locks(state: Path) -> list:
    """Session dirs whose write lease another live process holds. Reported only, never decisive.

    POSIX-only by nature: the harness uses a named kernel semaphore rather than a file lock on
    Windows, so there is nothing here to probe and this returns an empty list. That makes the
    REPORT weaker on Windows and changes no decision, because this signal never decides anything.
    """
    try:
        import fcntl
    except ImportError:  # pragma: no cover - the Windows path
        return []
    held = []
    sessions = state / 'home' / 'sessions'
    for lock in sessions.glob('*/*/session.lock') if sessions.is_dir() else []:
        try:
            fd = os.open(lock, os.O_RDWR)
        except OSError:
            continue
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            held.append(lock)
        finally:
            os.close(fd)
    return held


def recorded_release(state: Path) -> tuple:
    """The release launch.json recorded, and the pid it recorded it for."""
    launch = state / 'launch.json'
    if not launch.is_file():
        return None, None
    try:
        record = json.loads(launch.read_text())
    except ValueError:
        fail(f'launch-record-unreadable: {launch} is not valid JSON; refusing rather than guessing '
             f'which release the running deployment is')
    return record.get('release'), record.get('pid')


def release_mismatch(state: Path, plugin_dir: Path) -> str:
    """Empty string when `plugin_dir` is inside the recorded release, else the refusal reason."""
    release, pid = recorded_release(state)
    if release is None:
        return (f'release-not-recorded: {state / "launch.json"} names no release, so the release the '
                f'running deployment serves cannot be checked. Refusing: installing a preset against '
                f'an unknown release is how a preset and a host come apart without anyone noticing.')
    release_path = Path(release).resolve()
    if release_path != plugin_dir and release_path not in plugin_dir.parents:
        running = f' is no longer running' if pid is not None and not process_alive(pid) else ''
        return (f'release-mismatch: --plugin-dir is {plugin_dir}, but launch.json records '
                f'{release_path} (pid {pid}{running}). Refusing: the preset would name a release the '
                f'running host does not load.')
    return ''


def process_alive(pid) -> bool:
    try:
        os.kill(int(pid), 0)
    except (OSError, TypeError, ValueError):
        return False
    return True


def roll_tree_digest(files: dict) -> str:
    """The one digest over a file→sha256 map. Used to BUILD a record and to CHECK one."""
    rolling = hashlib.sha256()
    for name, digest in sorted(files.items()):
        rolling.update(f'{name}\0{digest}\n'.encode())
    return rolling.hexdigest()


def tree_digest(directory: Path) -> dict:
    """A per-file digest map plus one digest over the whole set — the record a restore can verify."""
    files = {}
    for entry in sorted(directory.rglob('*')):
        if entry.is_file():
            files[str(entry.relative_to(directory))] = sha256(entry)
    return {'files': files, 'treeSha256': roll_tree_digest(files)}


# ── preset package projection ───────────────────────────────────────────────────────────────────
#
# WHY THIS IS NEEDED AT ALL. A locally authored preset lives under the user's home, where Node's
# upward `node_modules` walk NEVER reaches the harness's own dependencies — `dsh-agent-presets` says
# so in its own specifier module. So a package row resolves from the PROFILE's base, not the
# preset's, and a package is found when some ancestor directory holds
# `node_modules/<pkg>/package.json`.
#
# The consequence, measured on the live deployment: installing the preset alone leaves a row naming
# a package nothing can resolve, and the roster reports that row as broken. The fix is a link, and
# the link must point INSIDE the running release — a link into a mutable checkout would make the
# verified release and the running composition two different things, which is precisely the property
# the release layout exists to protect.

_PACKAGE_NAME = re.compile(r'^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$', re.IGNORECASE)


def package_rows(text: str) -> list:
    """Every row `name:` in a preset composition that names a PACKAGE, in first-seen order.

    Relative (`./x`), `file:`, absolute and `cordis:` specifiers are skipped: they resolve from the
    preset's own directory or are builtins, and neither belongs behind a projected link.
    """
    names = []
    for match in re.finditer(r'^\s*name:\s*["\']?([^\s"\']+)["\']?\s*$', text, re.MULTILINE):
        raw = match.group(1)
        if raw.startswith(('./', '../', 'file:', 'cordis:')) or raw.startswith('/'):
            continue
        if not _PACKAGE_NAME.match(raw):
            continue
        if raw not in names:
            names.append(raw)
    return names


def resolve_in_release(package: str, release: Path) -> 'Path | None':
    """The path inside `release` that a Node resolver would reach for `package`, or None.

    THE ORDER IS THE RESOLVER'S ORDER, and it was measured rather than assumed. On the live release
    only ONE of the preset's 25 packages sits at `release/node_modules`; the other twenty-four are
    under `apps/cli/node_modules`, because that is where the built application's tree actually holds
    them. A resolver that only consulted the release root would therefore have reported 24 packages
    missing on a release that works — which is exactly the false negative this order exists to avoid.

    Only the filesystem is walked: nothing is imported and no manifest is evaluated, so a package
    that is present but broken by content still resolves here and fails later, where it should.
    """
    parts = package.split('/')
    relative = Path(*parts)
    # 1. The release root, and any ancestor of the release — Node's own upward walk.
    for directory in (release, *release.parents):
        candidate = directory / 'node_modules' / relative
        if (candidate / 'package.json').is_file():
            return candidate
    # 2. The release's own source layout, EXACT paths first. These must precede the glob below:
    # measured, globbing `apps/*/node_modules` for the leaf name matched a *nested* copy of the
    # claude-code package sitting inside the CODEX package's own `node_modules`, because that
    # nested directory carries the same leaf name. Returning a package that belongs to another
    # package is worse than returning nothing, so the exact locations are consulted before any
    # search runs.
    leaf = parts[-1]
    for prefix in (release / 'packages' / leaf, release / 'packages' / 'subagent' / leaf):
        if (prefix / 'package.json').is_file():
            return prefix
    # 3. A workspace layout, where a built app carries its own tree.
    for app in sorted(release.glob('apps/*/node_modules')):
        candidate = app / relative
        if (candidate / 'package.json').is_file():
            return candidate
    # 4. Last resort, and it VERIFIES the package's own declared name rather than trusting the
    # directory. Trusting the directory produced a real wrong answer: searching for the leaf
    # `dsh-subagent-claude-code` matched a *nested* copy under the codex package's own
    # `node_modules`, because that copy's directory is also named `dsh-subagent-claude-code`. A
    # resolver that returns a package belonging to a different package is worse than one that
    # returns nothing, so a candidate whose `name` disagrees is skipped, and ambiguity is REFUSED
    # rather than resolved by sort order.
    found = []
    for candidate in sorted((release / 'packages').rglob(f'{leaf}/package.json')):
        try:
            declared = json.loads(candidate.read_text()).get('name')
        except (OSError, ValueError):
            continue
        if declared == package:
            found.append(candidate.parent)
    if len(found) == 1:
        return found[0]
    # CEILING: this is a search, not a resolver — it does not read `exports`, `main`, or workspace
    # manifests. Zero matches and several both return None; the caller reports them the same way.
    return None


def project_packages(home: Path, release: Path, generated: dict) -> tuple:
    """Link every package the generated preset names into the profile resolution path.

    Returns `(links, unresolved)`: link records for those projected, and the package names that
    could not be resolved inside the release. Unresolved is RETURNED rather than raised so the caller
    decides — a missing package is exactly the condition the live roster reports as a broken row, and
    an installer that quietly succeeded there would hide the failure it exists to prevent.
    """
    node_modules = home / 'profiles' / 'node_modules'
    node_modules.mkdir(parents=True, exist_ok=True)
    links, unresolved = [], []
    for package in package_rows(generated['agent.cordis.yml']):
        target = resolve_in_release(package, release)
        if target is None:
            unresolved.append(package)
            continue
        link = node_modules / Path(*package.split('/'))
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink():
            # Re-point only on disagreement. `exists()` is False for a dangling symlink, so the
            # comparison is on the resolved target and never on presence.
            if link.resolve() == target.resolve():
                links.append({'package': package, 'path': str(link), 'target': str(target)})
                continue
            link.unlink()
        elif link.exists():
            fail(f'projection-collision: {link} exists and is not a symlink. Removing it would '
                 f'destroy bytes this installer did not create; resolve it by hand and re-run.')
        link.symlink_to(target)
        links.append({'package': package, 'path': str(link), 'target': str(target)})
    return links, unresolved


def clear_profile_provider_layer(home: Path) -> list:
    """Reset every profile's patch layer to an empty list.

    An empty patch list is the honest representation of "nothing is mounted here", and it is a real
    write: leaving the previous file alone would keep a channel open that the operator just asked to
    close. The file is generated either way, so it is overwritten rather than deleted — a missing
    file and an empty one mean the same thing to the loader, and the empty one says so in place.
    """
    profiles_root = home / 'profiles'
    cleared = []
    for profile in sorted(profiles_root.glob('*')) if profiles_root.is_dir() else []:
        if not profile.is_dir() or profile.name == 'node_modules':
            continue
        patch = profile / 'cordis.patch.yml'
        patch.write_text(
            '# Generated by scripts/install-aukora-foundation.py — do not edit by hand.\n'
            '# --no-outside-agents was used: no provider is mounted here.\n'
            '[]\n')
        cleared.append(patch)
    return cleared


def write_profile_provider_layer(home: Path, release: Path) -> list:
    """Mount the outside-agent providers in the profile's OWN patch layer.

    WHY HERE AND NOT IN THE RELEASE. `profiles/<name>/cordis.patch.yml` is the profile's user layer —
    applied after every bundle on each boot, and it persists across restarts. Writing the provider
    rows there is the entire difference between this fix and the hand-added symlink it is modelled
    on: measured today, a hand-edit to the live preset was regenerated away and its disappearance was
    invisible.

    WHY THE PRESET IS NOT ENOUGH. The preset decides whether a SESSION receives the delegation tool;
    the provider bundle decides whether the Host can serve it. The shipped comment says it plainly:
    "Host availability alone grants no tool." Both halves are required, and they live on different
    planes — which is exactly the split that let this gap survive unnoticed.

    EVERY EXISTING PROFILE GETS THE LAYER, because the providers are a host-plane capability and a
    deployment may compose more than one profile. A profile is materialized by the application, not by
    this installer, so a home with no profile yet is a REFUSAL rather than a silent no-op: writing
    nothing here would produce exactly the failure this fix exists to remove — a channel that is
    absent with nothing saying so.
    """
    profiles_root = home / 'profiles'
    profiles = sorted(
        entry for entry in profiles_root.glob('*')
        if entry.is_dir() and entry.name != 'node_modules'
    ) if profiles_root.is_dir() else []
    if not profiles:
        fail(f'no-profile-to-mount-into: {profiles_root} holds no profile directory, so the outside '
             f'agent providers have nowhere to be mounted. Launch the deployment once to materialize '
             f'a profile, or pass --no-outside-agents to install without them.')

    rows = []
    for directory, package in (
        ('subagent-claude-code', '@deepseek-ai/dsh-subagent-claude-code'),
        ('subagent-codex', '@deepseek-ai/dsh-subagent-codex'),
    ):
        bundled = release / 'packages' / 'subagent' / directory
        if not (bundled / 'package.json').is_file():
            fail(f'missing-provider-bundle: {bundled} has no package.json. Mounting the row without '
                 f'the package would leave a provider the Host cannot load, which reads as a missing '
                 f'tool at delegation time rather than as an install error.')
        rows.append(f'    - id: {directory}\n      name: {package!r}\n')

    written = []
    for profile in profiles:
        patch = profile / 'cordis.patch.yml'
        patch.write_text(
            '# Generated by scripts/install-aukora-foundation.py — do not edit by hand.\n'
            '# Regenerated on every install, which is the point: a hand-edit here is a fix that\n'
            '# evaporates on the next run, and its evaporation is invisible.\n'
            '#\n'
            '# Mounts the outside-agent providers on the HOST plane. The agent preset grants the\n'
            '# matching delegation tool separately; both halves are required.\n'
            '- insert:\n'
            + ''.join(rows))
        written.append(patch)
    return written


def project_provider_packages(home: Path, release: Path) -> list:
    """Link the provider bundles into the profile resolution path.

    Same mechanism as `project_packages`, and the same reason: a package the Host mounts must be
    reachable by the profile's upward `node_modules` walk. Measured — the providers live in the
    release at `packages/subagent/<name>` and were absent from `profiles/node_modules`.
    """
    node_modules = home / 'profiles' / 'node_modules' / '@deepseek-ai'
    node_modules.mkdir(parents=True, exist_ok=True)
    links = []
    for package, directory in (
        ('@deepseek-ai/dsh-subagent-claude-code', 'subagent-claude-code'),
        ('@deepseek-ai/dsh-subagent-codex', 'subagent-codex'),
    ):
        # The path is DETERMINISTIC, so it is used directly rather than searched for. A generic
        # search was tried first and produced a wrong answer: looking for the leaf name matched a
        # nested copy of one provider inside the other's `node_modules`. An exact path cannot do
        # that, and a provider whose location is known does not need a resolver.
        target = release / 'packages' / 'subagent' / directory
        if not (target / 'package.json').is_file():
            fail(f'missing-provider-bundle: {target} has no package.json')
        link = node_modules / package.split('/')[-1]
        if link.is_symlink():
            if link.resolve() == target.resolve():
                links.append({'package': package, 'path': str(link), 'target': str(target)})
                continue
            link.unlink()
        elif link.exists():
            fail(f'projection-collision: {link} exists and is not a symlink')
        link.symlink_to(target)
        links.append({'package': package, 'path': str(link), 'target': str(target)})
    return links


def write_restored_record(state: Path, preset_dir: Path, source_backup: Path) -> None:
    """Record the digest of what a restore actually put on disk.

    A restore that leaves `aukora-install.json` describing the PREVIOUS bytes makes the record lie
    about the preset now installed, and the next reader cannot then tell a stale record from a real
    divergence. Only the fields a restore can honestly know are written.
    """
    files = {}
    for entry in sorted(source_backup.iterdir()):
        if entry.is_file() and entry.name not in ('BACKUP.json', MANIFEST_NAME):
            files[entry.name] = sha256(preset_dir / entry.name)
    record_path = state / 'aukora-install.json'
    previous = {}
    if record_path.is_file():
        try:
            previous = json.loads(record_path.read_text())
        except ValueError:
            previous = {}
    preset = dict(previous.get('preset') or {})
    preset.update({
        'id': PRESET_ID,
        'path': str(preset_dir / 'agent.cordis.yml'),
        'sha256': sha256(preset_dir / 'agent.cordis.yml'),
    })
    previous.update({
        'formatVersion': 1,
        'kind': 'aukora-foundation-install',
        'restoredFrom': str(source_backup),
        'presetFiles': files,
        'stateRoot': str(state),
        'preset': preset,
    })
    record_path.write_text(f'{json.dumps(previous, indent=2)}\n')
    os.chmod(record_path, 0o600)


def persona_row_span(lines: list[str]) -> tuple[int, int]:
    """Return the [start, end) line span of the standard preset's persona row."""
    start = next((i for i, line in enumerate(lines) if line.startswith('- id: persona')), None)
    if start is None:
        fail('standard-preset-shape: no "- id: persona" row; refusing to guess the identity seat')
    end = start + 1
    while end < len(lines) and not lines[end].startswith('- '):
        end += 1
    return start, end


def rewrite_persona(lines: list[str], span: tuple[int, int], identity: str, suffix: str) -> list[str]:
    """Replace the persona prefix/suffix values inside one row, preserving every other byte."""
    start, end = span
    row = lines[start:end]
    out: list[str] = []
    index = 0
    replaced_prefix = False
    replaced_suffix = False
    while index < len(row):
        line = row[index]
        if re.match(r'^    prefix:', line):
            body = [text for text in identity.rstrip('\n').split('\n')]
            out.append('    prefix: |-')
            out.extend(f'      {text}' if text else '' for text in body)
            replaced_prefix = True
            index += 1
            while index < len(row) and re.match(r'^ {6,}\S', row[index]):
                index += 1
            continue
        if re.match(r'^    suffix:', line):
            out.append(f'    suffix: {suffix}')
            replaced_suffix = True
            index += 1
            while index < len(row) and re.match(r'^ {6,}\S', row[index]):
                index += 1
            continue
        out.append(line)
        index += 1
    if not replaced_prefix:
        fail('standard-preset-shape: persona row has no prefix to carry the identity core')
    if not replaced_suffix:
        out.append(f'    suffix: {suffix}')
    for key, value in (('complete', 'false'), ('includeRuntimeContext', 'true')):
        if not any(re.match(rf'^    {key}:', line) for line in out):
            out.append(f'    {key}: {value}')
    return lines[:start] + out + lines[end:]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-root', type=Path,
                        help='state root containing home/, agents/, workspace/, logs/; '
                             'defaults to AUMA_LIVE_HOME, which is the only root --production accepts')
    parser.add_argument('--identity', type=Path, default=DEFAULT_IDENTITY,
                        help='private identity core markdown; or set AUMA_IDENTITY_CORE')
    parser.add_argument('--source', type=Path, default=ROOT / 'vendor/dsh',
                        help='built upstream source whose shipped Standard preset is the base')
    parser.add_argument('--plugin-dir', type=Path, default=ROOT / 'plugins/aukora-foundation',
                        help='plugin location the composition patch will load (a release-local copy for releases)')
    parser.add_argument('--no-outside-agents', action='store_true',
                        help='withhold the cross-family delegation tools (Codex, Claude Code) from '
                             'the generated preset and the profile provider layer. They are ON by '
                             'default: delegation sends repository content to a third-party model, '
                             'and a harness whose review channel is silently absent is the defect '
                             'this default exists to fix.')
    parser.add_argument('--release-root', type=Path,
                        help='release the projected package links must point inside; defaults to '
                             "--plugin-dir's grandparent, validated as a release")
    parser.add_argument('--keep-existing', action='store_true',
                        help='preserve files already present; owner-modified files still refuse')
    parser.add_argument('--force', action='store_true',
                        help='replace an owner-modified preset after taking a backup')
    parser.add_argument('--restore', type=Path,
                        help='roll back to a backup directory previously written under <state>/backups')
    parser.add_argument('--production', action='store_true',
                        help='install into the LIVE home. Requires AUMA_LIVE_HOME to name the target '
                             'exactly, refuses while any DSH turn is active, refuses unless the release '
                             'in --plugin-dir is the one launch.json recorded, and always takes a '
                             'digest-recorded backup first.')
    parser.add_argument('--active-turn-window', type=float, default=120.0,
                        help='seconds within which a session log write counts as an ACTIVE TURN '
                             '(default 120). Only consulted by --production.')
    parser.add_argument('--check-turn', type=Path, metavar='STATE_ROOT',
                        help='print whether any DSH turn is in flight in STATE_ROOT and exit; runs the '
                             'same check --production refuses on, so the refusal can be tested without '
                             'the live deployment')
    parser.add_argument('--check-release', type=Path, metavar='STATE_ROOT',
                        help='print whether --plugin-dir is the release launch.json records for '
                             'STATE_ROOT and exit; the same check --production refuses on')
    args = parser.parse_args()

    # ── PROBES, before the mode split, because they WRITE NOTHING ───────────────────────────────
    # `--check-turn` and `--check-release` run the very functions `--production` refuses on and exit.
    # They are hoisted above the live-state guard deliberately: a probe that could only be pointed at
    # a disposable root would be pointless, and a probe that could not be pointed at the live root
    # could not be rehearsed against the deployment it is about. Neither writes, so neither is the
    # thing the guard exists to prevent.
    if args.check_turn is not None:
        probe_root = args.check_turn.resolve()
        hot = active_turn_window(probe_root, args.active_turn_window)
        locks = held_session_locks(probe_root)
        if locks:
            print(f'NOTE {len(locks)} session write lease(s) held by a live process — reported only, '
                  f'never decisive. A held lease means a session is OPEN, not that a turn is in '
                  f'flight: the lease is held for the whole life of the write handle.')
        if hot:
            fail(f'active-turn: {len(hot)} session log(s) written within {args.active_turn_window:g}s: '
                 f'{", ".join(str(log.parent.name) for log in hot[:5])}')
        print(f'NO ACTIVE TURN within {args.active_turn_window:g}s in {probe_root}')
        return 0
    if args.check_release is not None:
        target = args.check_release.resolve()
        mismatched = release_mismatch(target, args.plugin_dir.resolve())
        if mismatched:
            fail(mismatched)
        release, _ = recorded_release(target)
        print(f'RELEASE MATCHES launch.json: {release}')
        return 0

    # THE LIVE HOME IS AN EXPLICIT OPT-IN, and every guard below is arranged so the dangerous
    # case fails by naming what is wrong rather than by writing or by staying silent.
    if args.production:
        if LIVE_HOME is None:
            fail('live-home-unset: --production requires AUMA_LIVE_HOME so the target can be '
                 'checked against the running deployment, not assumed.')
        state = (args.state_root or LIVE_HOME).resolve()
        home = (state / 'home').resolve()
        if state != LIVE_HOME:
            fail(f'production-target-not-live: --production was given state root {state}, but '
                 f'AUMA_LIVE_HOME names {LIVE_HOME}. Refusing: a mode that writes the running home '
                 f'must be pointed at the running home exactly, or it is a mislabelled disposable write.')
        if home != LIVE_HOME / 'home':
            fail(f'production-home-shape: {home} is not <live-home>/home')
    else:
        if args.state_root is None:
            fail('missing-state-root: pass --state-root <disposable state>, or --production with '
                 'AUMA_LIVE_HOME set to install into the live home deliberately.')
        state = args.state_root.resolve()
        home = (state / 'home').resolve()
        if LIVE_HOME is None:
            fail('live-home-unset: set AUMA_LIVE_HOME to the running deployment home so this installer '
                 'can refuse it. Without it the live-state guard cannot work, and an installer that '
                 'cannot tell the live home from a disposable one must not write.')
        # The guard is bypassable ONLY through --production, where the target is then checked to BE
        # the live home. There is no path in which this installer writes the live home by accident.
        if home == LIVE_HOME or LIVE_HOME in home.parents:
            fail(f'refusing-to-write-live-state: {home} is the running deployment home. This is the '
                 f'default and correct refusal; use --production to install into it deliberately.')
    for name in ('home', 'agents', 'workspace', 'logs'):
        if not (state / name).is_dir():
            fail(f'missing-private-state: create {state / name} first')
    if state.stat().st_mode & 0o077:
        fail(f'state-permissions: {state} must be mode 0700')

    # ── production preflight: both refusals happen BEFORE a single write ────────────────────────
    if args.production:
        mismatched = release_mismatch(state, args.plugin_dir.resolve())
        if mismatched:
            fail(mismatched)
        hot = active_turn_window(state, args.active_turn_window)
        if hot:
            listing = ', '.join(str(log.parent.name) for log in hot[:5])
            fail(f'active-turn: {len(hot)} session log(s) were written within '
                 f'{args.active_turn_window:g}s ({listing}). Refusing to install a preset while a '
                 f'turn may be in flight: the preset is read per session, so a session already '
                 f'running would keep the old tool catalog and the read path would look like it '
                 f'failed. Stop the deployment, then install.')
        locks = held_session_locks(state)
        if locks:
            print(f'NOTE {len(locks)} session write lease(s) held by a live process — reported only. '
                  f'A held lease means a session is OPEN, not that a turn is in flight: the lease is '
                  f'held for the whole life of the write handle. This does not refuse the install.')

    if args.identity is None:
        fail('missing-private-identity: pass --identity <path> or set AUMA_IDENTITY_CORE; '
             'the identity core is a mandatory input and is deliberately not in Git')
    identity_path = args.identity.resolve()
    if not identity_path.is_file():
        fail(f'missing-private-identity: {identity_path}; the identity core is a mandatory input')
    identity = identity_path.read_text()
    if not identity.strip():
        fail(f'empty-private-identity: {identity_path}')
    if '{{' in identity or '}}' in identity:
        fail('identity-template-hazard: the persona prefix interpolates {{...}} strictly; '
             'the identity core must not contain double braces')

    standard = args.source.resolve() / 'packages/preset/agent-presets/presets/standard'
    composition = standard / 'agent.cordis.yml'
    if not composition.is_file():
        fail(f'missing-standard-preset: {composition}; run scripts/build-dsh.py first')
    lines = composition.read_text().split('\n')

    plugin_dir = args.plugin_dir.resolve()
    client_bundle = plugin_dir / 'lib/client.js'
    if not client_bundle.is_file():
        fail(f'missing-plugin-build: {client_bundle}; materialize or build the plugin first')
    if not client_bundle.is_file():
        fail(f'missing-plugin-build: {client_bundle}; run scripts/build-aukora-plugin.mjs first')

    preset_dir = home / '.agent-presets' / PRESET_ID
    suffix = 'You are running as the {{model}} model in {{cwd}}.'
    rows = rewrite_persona(lines, persona_row_span(lines), identity, suffix)

    # The shipped Standard preset carries the outside-agent rows NESTED IN A GROUP and already
    # DISABLED. Appending enabled copies works only because the loader's entry map is last-wins, and
    # it leaves two rows claiming one id — a fragile arrangement whose failure mode is the channel
    # silently staying shut. So the shipped rows are dropped and the single authoritative rows are
    # the ones appended below.
    delegated = {'tool-subagent-codex', 'tool-subagent-claude-code'}
    pruned = []
    skip = False
    for line in rows:
        if line.startswith('    - id: ') or line.startswith('- id: '):
            skip = line.split('id: ', 1)[1].strip() in delegated
        if not skip:
            pruned.append(line)
    rows = pruned

    # Recall across prior sessions. The tool catalog is per-preset, so a row omitted
    # here does not exist for the agent no matter what the host mounts: without it a
    # model has a search index it cannot ask.
    #
    # The SERVICE and its index are deliberately NOT mounted here. The release patch
    # opens the index on the host plane, where the base bundle already mounts
    # `dsh-session-query-sqlite` — and that plugin injects only `sessions`, a host-plane
    # key no agent preset may publish. Splitting the two halves this way is what the
    # plane rule requires, not a stylistic choice.
    #
    # Appended rather than inserted: rowwise placement inside the shipped Standard
    # preset is not ours to guess, and ordering carries no meaning because this preset
    # resolves `ctx` lazily.
    rows += [
        '',
        '# ── session history ──────────────────────────────────────────────────',
        '',
        '# Recall across sessions in this workspace. Read-only and authorized:',
        '# cross-session reads require an exact `cwd` match with the caller, and a',
        '# caller without one sees only itself.',
        '- id: tool-session-query',
        "  name: '@deepseek-ai/dsh-tool-session-query'",
    ]

    # ── OUTSIDE AGENTS ───────────────────────────────────────────────────────────────────────────
    #
    # THE SHIPPED PRESET SHIPS THESE ROWS DISABLED, and that default is the single most expensive
    # thing in this file. Measured 2026-09-17: `claude`, `codex`, `opencode` and `crush` are all
    # installed and on PATH, and the provider bundles ship in the release, yet every row sat at
    # `disabled: true` — so a session had no way to obtain review from a different model family and
    # NO WAY TO TELL THAT IT WAS MISSING. A solo judgment and a reviewed one look identical from
    # inside; that is what made the gap survive so long, and it is why the fix belongs here rather
    # than in a prompt asking a model to be more careful.
    #
    # The preset grants the TOOL; the profile layer mounts the PROVIDER. Both are needed, and the
    # shipped comment says so: "Host availability alone grants no tool."
    #
    # DISCLOSURE, stated because it is a real one and the owner should be able to see it: delegating
    # to these CLIs sends repository content and prompts to a third-party model. It is on by default
    # because a harness whose review channel is silently absent is the defect being fixed, and an
    # opt-in flag nobody knows about would reproduce it. `--no-outside-agents` withholds them, and the
    # install prints which mode it used either way.
    if not args.no_outside_agents:
        rows += [
            '',
            '# ── outside agents ───────────────────────────────────────────────────',
            '',
            '# Delegation to a DIFFERENT model family, for review and adversarial testing. A model',
            '# cannot evaluate its own generation: agreement between two instances of one model is',
            '# not independent evidence, which is why these are cross-family and not more subagents.',
            '# Requires the matching provider rows in this profile\u2019s own patch layer.',
            '- id: tool-subagent-codex',
            "  name: '@deepseek-ai/dsh-tool-subagent'",
            '  config:',
            '    provider: codex',
            '    toolName: subagent_codex',
            '    backgroundMode: one-shot',
            '    maxDepth: provider-managed',
            '- id: tool-subagent-claude-code',
            "  name: '@deepseek-ai/dsh-tool-subagent'",
            '  config:',
            '    provider: claude-code',
            '    toolName: subagent_claude_code',
            '    backgroundMode: one-shot',
            '    maxDepth: provider-managed',
        ]
        # NO ACP ROW IS WRITTEN, and the reason is measured rather than assumed. An `acp` row was
        # drafted here and REMOVED: the shipped Standard preset registers exactly four providers —
        # `claude-code`, `codex`, `fork`, `spawn` — and `acp` is not among them. A row naming a
        # provider that does not exist would make the whole preset unresolvable, trading a missing
        # channel for a broken one. OpenCode and Crush speak ACP and would need the provider
        # registered first; that is a separate brick, not a line in this list.

    generated = {
        'agent.cordis.yml': '\n'.join(rows),
        'preset.yml': json.dumps({
            'name': 'Auma Builder',
            'description': 'Auma inside AUKORA Genesis: the full coding tool set with the Auma identity core.',
            'order': 0,
        }, ensure_ascii=False, indent=2) + '\n',
    }
    manifest_path = preset_dir / MANIFEST_NAME
    backup_dir = None

    if args.restore is not None:
        source_backup = args.restore.resolve()
        if not (source_backup / 'agent.cordis.yml').is_file():
            fail(f'invalid-backup: {source_backup} has no agent.cordis.yml')
        # A DIGEST-RECORDED BACKUP IS VERIFIED BEFORE IT IS TRUSTED. The record is only useful if
        # something checks it, so a restore from a production backup re-derives every file digest
        # and the tree digest, and refuses on any disagreement. Topping up the digest in the record
        # cannot help: it is DERIVED from the files, not compared to a stored constant.
        backup_record_path = source_backup / 'BACKUP.json'
        if backup_record_path.is_file():
            try:
                backup_record = json.loads(backup_record_path.read_text())
            except ValueError:
                fail(f'backup-record-unreadable: {backup_record_path} is not valid JSON')
            if backup_record.get('mode') == 'production' and not args.production:
                fail('production-restore-requires-production: this backup was taken by a --production '
                     'install; repeat with --production and AUMA_LIVE_HOME naming the live home, so a '
                     'live restore is as deliberate as the live write it undoes.')
            actual = tree_digest(source_backup)
            # `BACKUP.json` is EXCLUDED from the comparison, and it is the one honest exclusion
            # here: the record is written into the directory it describes, so it cannot be one of
            # the things it lists. Treating it as "extra" would make every backup fail its own
            # check — which is how this read on the first run.
            recorded = backup_record.get('files', {})
            mismatched = sorted(name for name, digest in recorded.items()
                                if actual['files'].get(name) != digest)
            missing = sorted(name for name in recorded if name not in actual['files'])
            extra = sorted(name for name in actual['files']
                           if name not in recorded and name != 'BACKUP.json')
            if mismatched or missing or extra:
                fail(f'backup-digest-mismatch: {source_backup} does not match its own BACKUP.json '
                     f'(altered={mismatched}, missing={missing}, extra={extra}). Restoring it would '
                     f'restore something other than what was recorded.')
            recorded_tree = backup_record.get('treeSha256')
            if roll_tree_digest(recorded) != recorded_tree:
                fail(f'backup-record-self-inconsistent: {backup_record_path} lists files whose '
                     f'combined digest is not the treeSha256 it records; the record was altered or '
                     f'written wrong, and a record that disagrees with itself attests nothing.')
            if roll_tree_digest(actual['files']) != actual['treeSha256']:
                fail(f'backup-tree-digest-mismatch: {source_backup} files each match but the tree '
                     f'digest does not; the record and the copy disagree about what the set is.')
            print(f'BACKUP VERIFIED {source_backup} tree sha256 {actual["treeSha256"]} '
                  f'({len(recorded)} recorded file(s))')
        preset_dir.mkdir(parents=True, exist_ok=True)
        for entry in source_backup.iterdir():
            if entry.is_file() and entry.name != 'BACKUP.json':
                shutil.copy2(entry, preset_dir / entry.name)
        write_restored_record(state, preset_dir, source_backup)
        print(f'RESTORED {preset_dir} from {source_backup}')
        return 0

    if preset_dir.exists() and any(preset_dir.iterdir()):
        # Preservation policy: an install never silently clobbers a file the
        # owner may have edited. A file is install-owned only when it matches
        # the digest recorded at the previous install.
        known = None
        if manifest_path.is_file():
            try:
                known = json.loads(manifest_path.read_text()).get('files')
            except ValueError:
                known = None
        modified = [name for name in generated
                    if (preset_dir / name).is_file()
                    and (known is None or known.get(name) != sha256(preset_dir / name))]
        foreign = [entry.name for entry in preset_dir.iterdir()
                   if entry.name not in generated and entry.name != MANIFEST_NAME]
        if (modified or foreign or known is None) and not args.force:
            detail = ', '.join(sorted(modified + foreign)) or 'unknown provenance (no install manifest)'
            fail(f'owner-modified-preset: {preset_dir} has owner-modified or unrecorded content ({detail}); '
                 f'refusing to overwrite. Inspect it, then pass --force to replace it with a backup, '
                 f'or --restore <backup> to roll back')
        (state / 'backups').mkdir(parents=True, exist_ok=True)
        # mkdtemp keeps two installs in the same second from colliding.
        backup_dir = Path(tempfile.mkdtemp(prefix='preset-', dir=state / 'backups'))
        shutil.copytree(preset_dir, backup_dir, dirs_exist_ok=True)

        # A PRODUCTION BACKUP IS DIGEST-RECORDED, so "there is a backup" is a checkable claim rather
        # than a directory that exists. The record is written after the copy and verified against the
        # copy, which is the only order in which it attests anything.
        if args.production:
            digests = tree_digest(backup_dir)
            for name, digest in digests['files'].items():
                if sha256(backup_dir / name) != digest:
                    fail(f'backup-verify-failed: {name} does not match the digest just recorded; '
                         f'the backup is not a faithful copy and must not be trusted as one')
            backup_record = {
                'formatVersion': 1,
                'kind': 'aukora-preset-backup',
                'backup': str(backup_dir),
                'sourcePreset': str(preset_dir),
                'mode': 'production',
                'liveHome': str(LIVE_HOME),
                'identitySha256': sha256(identity_path),
                'pluginDir': str(plugin_dir),
                'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                'files': digests['files'],
                'treeSha256': digests['treeSha256'],
            }
            record_path = backup_dir / 'BACKUP.json'
            record_path.write_text(f'{json.dumps(backup_record, indent=2)}\n')
            os.chmod(record_path, 0o600)
            print(f'BACKUP {backup_dir}')
            print(f'backup tree sha256 {digests["treeSha256"]} ({len(digests["files"])} file(s))')

        if not args.keep_existing:
            shutil.rmtree(preset_dir)

    preset_dir.mkdir(parents=True, exist_ok=True)
    written = {}
    for name, text in generated.items():
        target = preset_dir / name
        if args.keep_existing and target.is_file() and target.read_text() == text:
            pass  # already exactly what this install would write
        else:
            target.write_text(text)
        written[name] = sha256(target)
    manifest_path.write_text(json.dumps({
        'formatVersion': 1,
        'kind': 'aukora-preset-install-manifest',
        'files': written,
    }, indent=2) + '\n')
    os.chmod(manifest_path, 0o600)

    # Project every package the preset just written names into the profile resolution path. This runs
    # AFTER the preset is on disk because it reads what was written, not what was intended.
    #
    # `release_root` is derived from `--plugin-dir` only after being VALIDATED as a release. A name
    # derived from position is a name that lies when the layout moves, and the failure would present
    # as a pile of unresolved packages with no hint that the root was wrong.
    release_root = args.release_root.resolve() if args.release_root else plugin_dir.parent.parent
    # The check is CONSISTENCY, not a release fingerprint. Requiring a marker file here would fail
    # every fixture that is not a real release — which is most of them — and a guard that has to be
    # disabled to run a test is a guard nobody trusts. What actually has to hold is that the links
    # resolve and that they do not point somewhere other than where the plugin came from.
    if not release_root.is_dir():
        fail(f'release-root-missing: {release_root} is not a directory, so projected links would '
             f'dangle. Pass --release-root explicitly if the release layout differs.')
    # A "plugin-dir must be inside release-root" check was written here and REMOVED, because it
    # refused configurations the project actually uses: the disposable install tests legitimately
    # point `--plugin-dir` at the repo while resolving packages from a built host. A guard that fires
    # on correct usage teaches people to pass flags until it stops, which is worse than no guard.
    # What has to hold is checked instead: the root is a directory, and every link resolves to a real
    # package.json. Those are properties of the artifact, not of how the flags were spelled.
    links, unresolved = project_packages(home, release_root, generated)
    if unresolved:
        fail(f'unresolved-package-rows: {", ".join(unresolved)} — the preset names package rows that '
             f'do not exist inside the release at {release_root}. Installing anyway would leave rows '
             f'the live roster reports as broken, and the failure would surface as a missing tool '
             f'rather than as an install error.')
    print(f'PROJECTED {len(links)} package link(s) into {home / "profiles" / "node_modules"}')
    if not args.no_outside_agents:
        provider_links = project_provider_packages(home, release_root)
        provider_patch = write_profile_provider_layer(home, release_root)
        links = links + provider_links
        print(f'PROJECTED {len(provider_links)} provider bundle(s); profile layer {provider_patch}')
        print('OUTSIDE AGENTS: enabled (codex, claude-code). Delegation discloses repository content '
              'to a third-party model. Pass --no-outside-agents to withhold them.')
    else:
        # WITHHOLDING MUST ALSO CLEAR WHAT A PREVIOUS RUN LEFT. The profile layer is a generated file
        # on disk; skipping the write leaves the LAST install's mounts in place, so the operator
        # closes the hatch and the channel stays open. Measured by this suite's own arm 3 before the
        # fix: the preset rows were withheld while the providers stayed mounted.
        cleared = clear_profile_provider_layer(home)
        print(f'OUTSIDE AGENTS: WITHHELD by --no-outside-agents; cleared {len(cleared)} profile layer(s). '
              f'A session will have no way to obtain review from a different model family, and no way '
              f'to tell that it is missing.')

    patch_path = state / 'aukora-foundation.patch.yml'
    patch_path.write_text(
        '# Generated by scripts/install-aukora-foundation.py — do not edit by hand.\n'
        '# Tracked source: plugins/aukora-foundation (client plugin) and presets/auma-builder (preset).\n'
        '- insert:\n'
        '    - id: aukora-foundation\n'
        # Node ESM refuses a directory import, so the row names the built host
        # entry. The browser half is still discovered: client-modules falls back to
        # the nearest package.json for a path-like row and reads its dsh.client block.
        f'      name: {json.dumps(str(plugin_dir / "lib/index.js"))}\n'
        '      config:\n'
        f'        brandName: AUKORA\n'
        '        palette: aukora-dark\n')

    for path in (preset_dir / 'agent.cordis.yml', preset_dir / 'preset.yml', patch_path):
        os.chmod(path, 0o600)

    record = {
        'formatVersion': 1,
        'kind': 'aukora-foundation-install',
        'mode': 'production' if args.production else 'disposable',
        'backup': str(backup_dir) if backup_dir is not None else None,
        'presetFiles': written,
        'stateRoot': str(state),
        'preset': {
            'id': PRESET_ID,
            'path': str(preset_dir / 'agent.cordis.yml'),
            'sha256': sha256(preset_dir / 'agent.cordis.yml'),
            'basePreset': str(composition),
            'baseSha256': sha256(composition),
            'identitySource': str(identity_path),
            'identitySha256': sha256(identity_path),
            'complete': False,
            'includeRuntimeContext': True,
            'covenantLoaded': False,
        },
        'plugin': {
            'package': PLUGIN_PACKAGE,
            'dir': str(plugin_dir),
            'clientBundle': str(client_bundle),
            'clientBundleSha256': sha256(client_bundle),
            'rowId': 'aukora-foundation',
        },
        'patch': {'path': str(patch_path), 'sha256': sha256(patch_path)},
        # WHAT THE PROFILE RESOLVES. Each link's target is recorded so a reader can tell which
        # release a running profile is actually resolving packages from — the question the
        # hand-added link that motivated this could not answer from any record.
        'releaseRoot': str(release_root),
        'projectedLinks': links,
    }
    (state / 'aukora-install.json').write_text(f'{json.dumps(record, indent=2)}\n')
    os.chmod(state / 'aukora-install.json', 0o600)

    print(f'INSTALLED preset={PRESET_ID} rows={len(rows)} identity={record["preset"]["identitySha256"][:16]}')
    print(f'preset sha256 {record["preset"]["sha256"]}')
    print(f'plugin client bundle {record["plugin"]["clientBundleSha256"]}')
    print(f'patch {patch_path}')
    print(f'state {state}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
