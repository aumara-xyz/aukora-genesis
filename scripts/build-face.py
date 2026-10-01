#!/usr/bin/env python3
"""Build the AUKORA face against the pinned harness, without touching the pinned tree.

THE FACE IS SOURCE THIS REPOSITORY OWNS. `plugins/aukora-face/<name>` holds the spatial
user interface as TypeScript: the three-lane frame, the stock app surfaces, messages and
the identity surface. Each is a harness client plugin — a package whose manifest says
`dsh.client.platform: web` and exports `./client` — and each must be compiled against the
exact harness version a release runs, or drift between harness versions shows up as a
dark screen at runtime instead of a type error at build time.

WHY AN OVERLAY. `scripts/build-dsh.py` proves every file under vendor/dsh matches the
pinned tarball before it builds, and the lockfile digest is pinned too, so face packages
cannot live inside that tree. This script clones the built tree (APFS clone, so it costs
no disk), drops the face packages into the clone's client workspace, links their
dependencies from the store the pinned install already populated, type-builds them as
projects of the harness's own client solution, bundles them with the harness's own
bundler, and copies only the outputs back. The pinned tree is never written.

Outputs land in `plugins/aukora-face/<name>/lib/{index.js,client.js}` and are what the
materializer carries into a release. A face that does not compile is reported by name
and the build exits non-zero; nothing half-built is copied back.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def resolve_pinned():
    """WHERE THE PINNED HARNESS IS: (path, label, the root it must resolve under).

    `vendor/dsh` is untracked, so a git worktree made from origin/main has none, and self-change runs from such
    worktrees. In order: AUKORA_PINNED_DSH if set; this checkout's own vendor/dsh if it exists (or is a link, so the
    guard below refuses it by name); else the MAIN worktree's vendor/dsh, found from Git's common directory. It is
    only ever read and cloned, never linked: a symlinked vendor/dsh once made this build write into the main harness.
    """
    override = os.environ.get('AUKORA_PINNED_DSH')
    if override:
        path = Path(override)
        if not path.is_absolute():
            sys.exit('pinned-tree-override-relative: AUKORA_PINNED_DSH must be an absolute path, got %s' % override)
        return path, 'AUKORA_PINNED_DSH', path.parent.resolve()
    own = ROOT / 'vendor/dsh'
    if own.exists() or own.is_symlink():
        return own, 'vendor/dsh', ROOT
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    common = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                            capture_output=True, text=True, env=env)
    if common.returncode == 0 and common.stdout.strip():
        main = Path(common.stdout.strip()).parent
        if main.resolve() != ROOT:
            return main / 'vendor/dsh', 'main worktree vendor/dsh', main.resolve()
    return own, 'vendor/dsh', ROOT


PINNED, PINNED_LABEL, PINNED_ROOT = resolve_pinned()
FACE = ROOT / 'plugins/aukora-face'
OVERLAY = ROOT / '.runtime/face-build'

# Order matters only for reporting; tsc -b resolves the real graph from references.
# Order matters only for reporting; tsc -b resolves the real graph from references.
# `memory` IS REGISTERED HERE OR IT IS NOT BUILT: this tuple is what `--only` accepts and what `place_faces` copies
# into the clone. **BUT REGISTERING HERE DOES NOT SHIP IT** — the release materializer carries its own
# `FACE_PACKAGES` tuple (`scripts/materialize-aukora-release.py:38`) and ships exactly the faces named there. This
# comment used to claim the materializer "globs `aukora-face-*` in the built client workspace"; MEASURED, IT DOES NOT,
# and `memory` was absent from that tuple for a whole goal while this one named it — built, and shipped nowhere.
# **THE TWO TUPLES MUST AGREE.** The court that required it (`tests/aukora-memory-app.test.mjs`) was archived on
# 2026-09-27 (ARCHIVE.md), so today nothing checks it: change both tuples together.
FACES = ('layout', 'sidebar', 'threads', 'messages', 'documents', 'aumlok', 'apps', 'settings', 'memory')
# Packages that are carried as source but do not yet compile against this harness.
# Each names the reason, so a reader knows this is a decision and not an oversight.
# EMPTY SINCE 2026-09-27: the two deferred packages, `runtime` (Deep's client runtime, which the faces no
# longer import) and `council` (needs @deepseek-ai/dsh-council, never carried), were never built or shipped,
# and their source was archived with the rest of the forest (ARCHIVE.md).
DEFERRED = {}
CARRY = ('src', 'assets', 'vendor', 'package.json', 'tsconfig.json', 'tsconfig.client.json',
         'tsconfig.host.json', 'tsdown.config.ts')
# ── aura-83 (gap 5): WHAT THE CLONE MUST NOT CARRY, AND WHY IT IS PRUNED RATHER THAN FILTERED. ────────
# **THESE ARE THE SAME CLASSES THE MATERIALIZER'S `COPY_IGNORE` EXCLUDES**, *stated here separately because
# this file must not import the materializer* -- *one is a build step and the other attests a release, and
# coupling them would mean a change to a release rule silently changing a build.* *The audit named
# `build-face.py:146-152` and materialize `:747-749` as two places with ONE defect*; **this is the second,
# and the two lists are deliberately the same shape so a reader can compare them.**
FACE_IGNORE_DIRS = ('__pycache__', '.venv', 'voice/models')
FACE_IGNORE_FILES = ('*.pyc', '*.pyo', '*.wav', '*.mp3', '*.m4a', '*.flac', '*.ogg', '*.aiff', '*.aif',
                     '*.opus')


def run(cmd, cwd, env=None, check=True):
    return subprocess.run(cmd, cwd=cwd, env=env, check=check, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


PIN_MARKER = '.aukora-face-overlay-pin'



def assert_not_symlinked():
    """REFUSE A SYMLINKED PINNED TREE OR OVERLAY BY NAME — the root cause of the night of 2026-09-25.

    MEASURED THAT NIGHT: `cp -Rc` copies a SYMLINK as a symlink on macOS, so when a worktree's `vendor/dsh` was
    a symlink this build wrote eight `packages/client/aukora-face-*` directories, a rewritten `pnpm-lock.yaml`
    (sha f3a36778 against the pinned ca131858), `tsconfig.client.json` and two node_modules state files INTO the
    main checkout's pinned harness — through the link, at the far end.

    Both paths are refused, and so is any shape whose RESOLVED path leaves its root, because a symlinked `vendor/`
    reaches the same place one level up. The pinned tree's root is the checkout it was found in (resolve_pinned):
    this one, the main worktree, or the parent named by AUKORA_PINNED_DSH. The overlay's root is always this one.
    """
    resolved_of = lambda path: path.resolve() if path.exists() else path.parent.resolve() / path.name
    for label, path, root in ((PINNED_LABEL, PINNED, PINNED_ROOT.resolve()), ('.runtime/face-build', OVERLAY, ROOT.resolve())):
        if path.is_symlink():
            sys.exit('pinned-tree-symlinked: %s IS A SYMBOLIC LINK to %s — `cp -Rc` copies a symlink AS a '
                     'symlink, so this build would write INSIDE that target instead of into a private overlay. '
                     'Replace the link with a real clone before building.' % (label, path.resolve()))
        resolved = resolved_of(path)
        if not str(resolved).startswith(str(root) + '/'):
            sys.exit('pinned-tree-outside-repo: %s resolves to %s, which is NOT under %s — this build compiles '
                     'against the repository\'s own pinned tree or not at all.' % (label, resolved, root))
    pinned, overlay = resolved_of(PINNED), resolved_of(OVERLAY)
    if pinned == overlay or str(overlay).startswith(str(pinned) + '/') or str(pinned).startswith(str(overlay) + '/'):
        sys.exit('pinned-tree-overlaps-overlay: %s and %s overlap; the overlay is written, the pinned tree never is.'
                 % (pinned, overlay))
    if not PINNED.is_dir():
        sys.exit('pinned-tree-missing: no pinned harness at %s (%s); run python3 scripts/build-dsh.py in %s first.'
                 % (PINNED, PINNED_LABEL, PINNED_ROOT))


def pinned_manifest(root: Path):
    """The pinned tree's SHAPE as one digest: every path with its size, symlinks by target, and the lock in full.

    A CEILING, STATED RATHER THAN IMPLIED: paths and sizes catch added, removed, renamed and resized files, and
    the lock is hashed byte for byte, but an edit that preserves a file's size escapes the shape digest. This is
    a proof that "the build did not write into the pinned tree", not a Merkle seal over every byte.
    """
    entries = []
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root).as_posix()
        try:
            if path.is_symlink():
                entries.append('%s\0->%s' % (rel, path.resolve()))
            elif path.is_file():
                entries.append('%s\0%d' % (rel, path.stat().st_size))
            else:
                entries.append('%s\0dir' % rel)
        except OSError as error:
            # A WALK THAT CANNOT READ AN ENTRY SAYS SO rather than crashing: the digest changes, which is what
            # this manifest is for.
            entries.append('%s\0unreadable:%s' % (rel, error.__class__.__name__))
    lock = root / 'pnpm-lock.yaml'
    return {'shape': hashlib.sha256('\n'.join(entries).encode()).hexdigest(),
            'lock': hashlib.sha256(lock.read_bytes()).hexdigest() if lock.is_file() else None,
            'names': set(entries)}


def assert_pinned_unchanged(before):
    """REFUSE IF THE BUILD WROTE INTO THE PINNED TREE, naming what changed."""
    after = pinned_manifest(PINNED)
    if before['shape'] == after['shape'] and before['lock'] == after['lock']:
        return
    added = sorted(after['names'] - before['names'])[:8]
    removed = sorted(before['names'] - after['names'])[:8]
    sys.exit('pinned-tree-changed: the build WROTE INTO the pinned harness at %s (shape %s -> %s, lock %s -> %s). '
             'Added: %s. Removed: %s. The pinned tree is upstream\'s; only the overlay may be written.'
             % (PINNED, before['shape'][:12], after['shape'][:12], str(before['lock'])[:12], str(after['lock'])[:12],
                added or 'nothing', removed or 'nothing'))


def clone_pinned():
    """Clone the pinned tree, and re-clone when the pin has moved.

    The overlay is reused between runs because cloning is the slow part, but a reused
    overlay is only valid while it still holds the harness the repository pins. The
    marker records the successful build receipt, so an archive/patch/artifact change re-clones
    instead of quietly compiling every face against the previous harness.
    """
    assert_not_symlinked()
    checked = subprocess.run([sys.executable, str(ROOT / 'scripts/build-dsh.py'), '--root', str(ROOT),
                              '--verify-built', '--source', str(PINNED)], capture_output=True, text=True)
    if checked.returncode:
        sys.exit((checked.stderr or checked.stdout).strip() or 'harness-build-binding-refused: verifier failed')
    pin = hashlib.sha256((PINNED / '.dsh-build/pinned-harness-build.json').read_bytes()).hexdigest()
    marker = OVERLAY / PIN_MARKER
    if OVERLAY.exists():
        if marker.is_file() and marker.read_text().strip() == pin:
            return
        shutil.rmtree(OVERLAY)
    OVERLAY.parent.mkdir(exist_ok=True)
    cloned = subprocess.run(['cp', '-Rc', str(PINNED), str(OVERLAY)], capture_output=True)
    if cloned.returncode != 0:
        shutil.copytree(PINNED, OVERLAY, symlinks=True)
    (OVERLAY / PIN_MARKER).write_text(pin + '\n')


def place_faces(names):
    client = OVERLAY / 'packages/client'
    for stale in client.glob('aukora-face-*'):
        shutil.rmtree(stale)
    for name in names:
        src = FACE / name
        dst = client / f'aukora-face-{name}'
        dst.mkdir(parents=True)
        for item in CARRY:
            if (src / item).is_dir():
                # Clone, not copy: the apps face carries ~27 MB of vendored app trees
                # and a byte copy on every build is wasted time and disk.
                cloned = subprocess.run(['cp', '-Rc', str(src / item), str(dst / item)], capture_output=True)
                if cloned.returncode != 0:
                    shutil.copytree(src / item, dst / item)
            elif (src / item).is_file():
                shutil.copy2(src / item, dst / item)
        # ── aura-83 (gap 5): THE CLONE COPIED IGNORED VOICE MODELS INTO THE FACE BUILD. ───────────────
        # **`cp -Rc` CLONES A WHOLE TREE AND CANNOT EXCLUDE ANYTHING**, *so the materializer's
        # `COPY_IGNORE` never reached this path and the audit's `build-face.py:146-152` finding was exactly
        # this line.* *Voice models and virtualenvs are gitignored, are not authored source, and have no
        # business in a build.*
        #
        # **THE PRUNE IS SEPARATE FROM THE CLONE ON PURPOSE.** *`cp -Rc` is chosen for SPEED -- "a byte copy
        # on every build is wasted time and disk" -- and filtering it would mean either walking the source to
        # build an include list, or falling back to `shutil.copytree(ignore=...)` which is the byte copy the
        # comment exists to avoid.* **So the tree is cloned fast and then the ignored paths are removed from
        # the DESTINATION**, *which costs one walk of a tree that is already on disk and keeps the speed
        # argument intact.* **And pruning the destination rather than filtering the source means a partially
        # copied tree cannot leave debris behind on failure.**
        pruned = []
        for pattern in FACE_IGNORE_DIRS:
            for hit in dst.rglob(pattern):
                if hit.is_dir():
                    shutil.rmtree(hit, ignore_errors=True)
                    pruned.append(hit.relative_to(dst).as_posix())
        for pattern in FACE_IGNORE_FILES:
            for hit in dst.rglob(pattern):
                if hit.is_file():
                    hit.unlink(missing_ok=True)
                    pruned.append(hit.relative_to(dst).as_posix())
        if pruned:
            print(f'    pruned {len(pruned)} ignored path(s) from aukora-face-{name}: '
                  + ', '.join(sorted(pruned)[:4]) + (' …' if len(pruned) > 4 else ''))
    # The client solution file lists every client project; ours join it here, in the
    # clone only, so `tsc -b` sees them as projects of the harness graph.
    solution = OVERLAY / 'tsconfig.client.json'
    text = re.sub(r'\s*\{ "path": "\./packages/client/aukora-face-[a-z]+" \},', '', solution.read_text())
    refs = ''.join(f'    {{ "path": "./packages/client/aukora-face-{n}" }},\n' for n in names)
    solution.write_text(text.replace('"references": [\n', '"references": [\n' + refs, 1))


def install():
    env = {'CI': 'true', 'LEFTHOOK': '0', 'PATH': subprocess.os.environ.get('PATH', ''),
           'HOME': subprocess.os.environ.get('HOME', '')}
    # Not frozen: the lockfile in the clone gains our packages. The pinned lockfile is untouched.
    out = run(['pnpm', 'install', '--no-frozen-lockfile', '--prefer-offline'], OVERLAY, env=env, check=False)
    if out.returncode != 0:
        sys.exit(f'face-install-failed:\n{out.stdout[-3000:]}')


def type_build(name):
    tsc = OVERLAY / 'node_modules/typescript/bin/tsc'
    pkg = OVERLAY / f'packages/client/aukora-face-{name}'
    # A face with separate client and host projects is judged by its client half; the
    # host half is reported separately so a broken host does not hide a working surface.
    targets = [pkg / 'tsconfig.client.json'] if (pkg / 'tsconfig.client.json').exists() else [pkg]
    out = run(['node', '--max-old-space-size=4096', str(tsc), '-b', *map(str, targets)], OVERLAY, check=False)
    errors = [line for line in out.stdout.splitlines() if 'error TS' in line]
    host_errors = []
    if (pkg / 'tsconfig.host.json').exists():
        host = run(['node', str(tsc), '-b', str(pkg / 'tsconfig.host.json')], OVERLAY, check=False)
        host_errors = [line for line in host.stdout.splitlines() if 'error TS' in line]
        # **THE EMIT MUST PARSE, AND tsc WILL NOT TELL YOU WHEN IT DOES NOT.** A composite project emits `.js`
        # as well as `.d.ts`, and it is possible to produce a file that is not JavaScript while printing no
        # `error TS` line at all. Measured on this repository: an unbalanced brace in `auma-live/http.ts` made
        # tsc emit `if(, isTrustedLocalRequest) { }` into `lib/types/auma-live/http.js` **while reporting
        # nothing**, and the only signal was rolldown failing with `[PARSE_ERROR] Unexpected token` — which named
        # a generated file, minutes into the build, and said nothing about the source that caused it. This names
        # the file that does not parse, before the bundler ever sees it. Exit 2 means "nothing to check", which
        # is NOT a failure; only exit 1 is.
        emitted = pkg / 'lib/types'
        if emitted.exists():
            parsed = run(['node', str(ROOT / 'scripts/face-parse-check.mjs'), str(emitted)], ROOT, check=False)
            if parsed.returncode == 1:
                host_errors.extend(
                    f'emitted-file-does-not-parse: {line.strip()}'
                    for line in parsed.stdout.splitlines()[1:] if line.strip()
                )
    return errors, host_errors


def bundle(name):
    pkg = OVERLAY / f'packages/client/aukora-face-{name}'
    out = run([str(OVERLAY / 'node_modules/.bin/tsdown')], pkg, check=False)
    built = pkg / 'lib/client.js'
    if out.returncode != 0 or not built.exists():
        return None, out.stdout[-2000:]
    return pkg / 'lib', ''


def src_digest(name):
    """The digest of the exact src inputs this face was built from.

    The canonical byte format is:

        for each input file, sorted by its path RELATIVE to the face package:
            "<relpath>\n<sha256 of the file's bytes>\n"
        srcDigest = sha256 over the concatenation, hex

    Inputs include `src/**`, shipped `vendor/**`, package.json and tsdown.config.ts. Vendored modules can
    be compiled into the bundle, so their bytes and licenses must participate in freshness too.
    A digest over a SUBSET would be worse than none: it would report fresh for a face whose real input changed.
    """
    pkg = FACE / name
    inputs = sorted(
        p.relative_to(pkg).as_posix()
        for directory in ('src', 'vendor') for p in (pkg / directory).rglob('*') if p.is_file()
        and not any(p.match(pattern) for pattern in FACE_IGNORE_FILES)
        and not any(parent.match(pattern) for parent in p.relative_to(pkg).parents for pattern in FACE_IGNORE_DIRS)
    )
    for extra in ('package.json', 'tsdown.config.ts'):
        if (pkg / extra).is_file():
            inputs.append(extra)
    if name == 'aumlok':
        # Identity reuses the Messages decoder/parser. Measure their actual source and
        # the vendored decoder's license/pin as inputs to this bundle, without copying them.
        inputs.extend(['../messages/package.json', '../messages/src/client/qr-scanner.ts',
                       '../messages/src/client/add-contact.ts'])
        inputs.extend('../messages/' + p.relative_to(FACE / 'messages').as_posix()
                      for p in (FACE / 'messages/src/vendor/jsqr').rglob('*') if p.is_file())
    outer = hashlib.sha256()
    for rel in sorted(inputs):
        inner = hashlib.sha256((pkg / rel).read_bytes()).hexdigest()
        outer.update(f'{rel}\n{inner}\n'.encode())
    return outer.hexdigest(), sorted(inputs)


def strip_home_paths(path):
    """Remove absolute build paths from one committed bundle, in place.

    **THE HARNESS'S CSS BUNDLER EMITS `//#region \\0dsh-css:<ABSOLUTE PATH>` COMMENTS**, one per CSS module, and the
    absolute path starts with a home directory — `/Users/<owner>/…/.runtime/face-build/…`. **Six of this face's
    bundles carried them, 13 lines, and they are the whole of the open-source home-path leak.**

    **THE EMITTER IS UPSTREAM'S, SO IT CANNOT BE FIXED THERE.** `AGENTS.md`: *"`vendor/dsh/` is upstream's tree…
    never edit it by hand."* And the marker is inert — it names a CSS module for a developer's editor — **so removing
    the absolute prefix costs nothing at runtime and the bundle stops carrying a path that means nothing to anyone
    else.**

    **THIS RUNS IN `copy_back`, WHICH IS THE ONE STEP THAT WRITES `lib`.** A strip applied by a separate step is a
    step somebody can forget, **and the failure mode is the leak reappearing silently on the next rebuild — which is
    exactly how six faces came to be stale and leaking at once.**

    **THE REPLACEMENT KEEPS THE MARKER AND THE TAIL**, so a developer reading the bundle still sees which CSS module a
    region came from; only the machine-specific prefix goes.

    @param path - the bundle just copied into the face.
    """
    try:
        text = path.read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        return
    # The overlay root is known here, so it goes first and exactly. A second pass removes any other absolute path
    # that points into a build tree, because the bundler's prefix is not guaranteed to be the overlay's.
    stripped = text.replace(str(OVERLAY), '')
    stripped = stripped.replace(str(ROOT), '')
    stripped = HOME_PATH.sub(r'\\0dsh-css:', stripped)
    if stripped != text:
        path.write_text(stripped, encoding='utf-8')


# `\0dsh-css:` followed by anything absolute up to the last path segment that is still a directory separator run.
# Non-greedy to the LAST `/` before a filename, and applied only to that marker so no string literal is touched.
HOME_PATH = re.compile(r'\\0dsh-css:(?:[A-Za-z]:)?/(?:[^\s"\'`]*/)+')


def copy_back(name, lib):
    """Write the outputs into the face's lib, and print `FACE WROTE <repo path>` for each file written.

    scripts/aukora/self-change.mjs reads those lines: only files this build wrote are shown in the approval as one
    `generated:` line; any other changed file under lib is shown in full.
    """
    dst = FACE / name / 'lib'
    dst.mkdir(exist_ok=True)
    for item in ('index.js', 'client.js', 'invariant.js'):
        if (lib / item).exists():
            shutil.copy2(lib / item, dst / item)
            strip_home_paths(dst / item)
            print(f'FACE WROTE {(dst / item).relative_to(ROOT).as_posix()}')
    # WHAT THIS LIB WAS BUILT FROM, WRITTEN BESIDE IT. A bundle with no record cannot be told from a bundle built
    # from month-old source: it compiles, it serves, and every court that reads `src/` passes over it. Measured
    # twice tonight — the blocked-on-Peter flag sat in src and not in lib for five rounds.
    digest, inputs = src_digest(name)
    (dst / '.build-inputs.json').write_text(json.dumps({
        'face': name,
        'srcDigest': digest,
        'files': inputs,
        'builtAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }, indent=2) + '\n')
    print(f'FACE WROTE {(dst / ".build-inputs.json").relative_to(ROOT).as_posix()}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', action='append', default=[], help='build only these faces')
    parser.add_argument('--fresh', action='store_true', help='discard the overlay clone first')
    a = parser.parse_args()
    # THE GUARD RUNS BEFORE ANY WALK OF THE PINNED TREE: MEASURED, `pinned_manifest` on a SYMLINKED
    # `vendor/dsh` crashed with FileNotFoundError before the refusal could name it, so the arm read a crash
    # instead of the refusal it measures.
    assert_not_symlinked()
    before = pinned_manifest(PINNED)
    if a.fresh and OVERLAY.exists():
        shutil.rmtree(OVERLAY)
    names = tuple(a.only) or FACES
    for n in names:
        if n in DEFERRED:
            sys.exit(f'face-deferred: {n}: {DEFERRED[n]}')
    clone_pinned()
    # Every buildable face is PLACED even when only some are BUILT: they depend on each
    # other by workspace name, and a workspace missing one of them fails the install
    # rather than the build, which reads as a tooling fault instead of a missing package.
    place_faces(tuple(n for n in FACES if n not in DEFERRED))
    install()
    report, failed = {}, []
    for n in names:
        errors, host_errors = type_build(n)
        if errors:
            failed.append(n)
            report[n] = {'client': errors, 'host': host_errors}
            continue
        lib, why = bundle(n)
        if lib is None:
            failed.append(n)
            report[n] = {'bundle': why}
            continue
        if host_errors:
            # The host half is what the loader imports. Copying a bundle built from
            # source that does not type-check would ship a row that fails at import,
            # which is exactly the silent-mount failure this build exists to prevent.
            failed.append(n)
            report[n] = {'host-only': host_errors}
            continue
        copy_back(n, lib)
        report[n] = {'built': str(FACE / n / 'lib/client.js'), 'host': host_errors}
    for n, r in report.items():
        if 'built' in r:
            print(f'FACE BUILT {n}: {r["built"]}')
            continue
        kind = 'bundle' if 'bundle' in r else 'host' if 'host-only' in r else 'client'
        print(f'FACE FAILED {n}: {kind}')
        lines = r.get('client') or r.get('host-only') or [r.get('bundle', '')]
        for line in lines[:20]:
            print('  ' + line[:220])
    for n, why in DEFERRED.items():
        print(f'FACE DEFERRED {n}: {why}')
    # A whole package is not the only thing that gets deferred. A face can carry
    # source it does not build — a surface waiting on an API this harness reshaped,
    # parked in `deferred/` beside the code that does compile. Reporting only the
    # deferred PACKAGES made those files invisible here, which is the same
    # oversight-versus-decision confusion the DEFERRED table exists to prevent.
    for n in FACES:
        parked = sorted(q.relative_to(FACE) for q in (FACE / n / 'deferred').rglob('*') if q.is_file())
        if parked:
            print(f'FACE PARKED {n}: {len(parked)} file(s) carried unbuilt: '
                  + ', '.join(str(q) for q in parked[:6]))
    assert_pinned_unchanged(before)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
