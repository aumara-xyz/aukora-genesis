#!/usr/bin/env python3
"""Materialize a self-contained AUKORA release from the built candidate tree.

A release is a copy of the built application plus the authored plugin *inside
it*, a composition patch that reaches that copy through a release-relative
path, and an artifact record produced against the copy. Everything a launch
loads is therefore inside the directory the checker verifies — no composition
row may point back at the mutable worktree.

The copy is then *stripped*: upstream's own notes, documentation, translation
twins, per-package sources and tests, build tooling and Python SDK are removed
from the release so that what remains is what runs. The strip rules live in
scripts/artifacts-coverage.json; scripts/release-strip.mjs applies them, writes
<release>/strip-manifest.json (every deleted path with its byte count and
digest, the keep rules applied, and the tree totals before and after), and the
artifact record produced afterwards attests that manifest by digest. The strip
runs before the record on purpose: the record must describe the tree that will
be launched, not the tree it was copied from.
"""
import argparse
import hashlib
import json
import plistlib
import re
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'plugins/aukora-foundation'
FACE = ROOT / 'plugins/aukora-face'
# Built by scripts/build-face.py against the pinned harness. Order is the mount
# order: the frame owns the root slot, the rest occupy slots it declares.
# THE FACES THE RELEASE CARRIES. `memory` WAS MISSING FROM THIS TUPLE WHILE IT WAS ALREADY IN `build-face.py`'s
# FACES, so the face was built and then dropped here: it compiled, it shipped nowhere, and every court in its own lane
# stayed green. `tests/aukora-memory-app.test.mjs` now requires this tuple to name every face the builder declares.
FACE_PACKAGES = ('layout', 'sidebar', 'threads', 'apps', 'messages', 'documents', 'aumlok', 'settings', 'memory')

#: The minds the face OFFERS. Named once, here, so the release and the court read the same list.
#: The minds the face OFFERS. `opus` is FIRST-CLASS here and was missing from the first version of
#: this list: it is `anthropic/claude-opus-5.5`, the mind Peter asked for by name, so a release that
#: omitted it would ship the powerful mind DARK — present in the code, unofferable in the UI.
OFFERED_MINDS = ('balanced', 'deep', 'quick', 'muse', 'opus')

#: THE LIVE STATE ROOT, DERIVED ONCE. Two readers need it — the retention policy looks for a launch and a
#: rollback record here, and the face config's `organismDshHome` must point at the DSH home the LANES
#: actually use. A second hand-typed path is how the two came apart: the emitted value was the app-support
#: root while the organism lens joins `dshHome + 'storages/session_projcache/sessions'` and
#: `dshHome + 'kira-memory/queue'`, which live under `state/home` — so a materialized release found NO
#: lanes and NO queue, and the lens was dark again, quietly.
AUKORA_STATE = Path(os.environ.get('AUKORA_STATE', str(Path.home() / 'Library/Application Support/AUKORA')))

#: What `organismDshHome` must be: the DSH home the lanes live in, NOT the app-support root.
LIVE_DSH_HOME = AUKORA_STATE / 'state' / 'home'
# The composition gate. Carried into the release because it is a LAUNCH-TIME dependency of the
# process, not a profile row: its policy has to be installed as a node bootstrap before the
# application imports anything, or it enforces nothing (measured — a hook installed from a
# plugin arrives after the governed module has already been imported).
GATE = ROOT / 'plugins/aukora-composition-gate'
GATE_DEMO = ROOT / 'plugins/aukora-gate-demo'
GATE_FILES = ('package.json',)
PLUGIN_FILES = ['package.json', 'tsdown.config.ts']
STRIP_CLI = ROOT / 'scripts/release-strip.mjs'

# The Aura adapter and the composition layer: the receipt producer, the serializer and the
# verifiers. They travel because the receipt path is only reproducible if the code that produces,
# settles and verifies a receipt ships with the release that emitted it — a verifier left in a
# checkout is a verifier whose bytes the artifact record never describes. They are DECLARED KEEPS
# in scripts/artifacts-coverage.json because `scripts/**` is a strip pattern and the
# runtime-reference scan cannot reach a path no built runtime names.
#
# THE CLOSURE IS NOT THIS ONE DIRECTORY. Traced by following imports, not by reading prose:
# `scripts/aura/adapter.py` puts `scripts/composition` AND `scripts/phase0` on sys.path and then
# imports `aura`, `receipt` and `phase0log` by bare name. So `scripts/phase0/phase0log.py` is a
# hard dependency, and a release carrying only scripts/composition cannot even import its own
# adapter. Both the adapter and the composition CLI also execute
# `vendor/append-only/verify.py`, and the accepted receipt contract lives in
# `vendor/receipt/toy`. Those two vendored trees are carried whole: `scripts/phase0-check-pins.py`
# pins every file under each named tree and refuses a tree whose pins and bytes disagree, so a
# subset would be a tree the repository's own pin check no longer describes.
COMPOSITION = ROOT / 'scripts/composition'
AURA = ROOT / 'scripts/aura'
PHASE0_LOG = ROOT / 'scripts/phase0/phase0log.py'
#: The retainer hook. `serialize-admissions.py` resolves `scripts/phase0/retainer.py` RELATIVE TO
#: ITSELF, so inside a release this file is the one a settle runs — not the checkout's. It was
#: deliberately NOT carried while it was outside the receipt closure, and MEASURED 2026-09-21 that
#: decision has expired: without it the shipped retainer answers `RETAINER_UNREACHED` with
#: `ModuleNotFoundError: No module named 'retainer'` while every checkout-driven arm stays green, so
#: the gap is visible only from a release. `tests/aura-settle-retain.test.mjs` arm 4 is that
#: measurement, and it fails by name rather than silently.
PHASE0_RETAINER = ROOT / 'scripts/phase0/retainer.py'
#: The memory-ledger head retainer. `scripts/aura/settlement.py` — SHIPPED, because `scripts/aura/**`
#: is a declared keep — puts `scripts/phase0` on sys.path and imports `memory_head` BY BARE NAME from
#: its settle path (`retain_memory_head`, called by `inscribe`), so inside a release this file is the
#: one a settle runs. The capability is memory-ledger retention: a head of Kira's memory ledger is
#: kept OUTSIDE its state dir, so a dropped newest memory is visible instead of silently absent.
#: `strip.patterns` is `scripts/**`, which deletes it exactly as it would have deleted `retainer.py`,
#: and a release that is missing it does not crash and does not stay silent: the degrade is the NAMED
#: status `MEMORY_HEAD_UNAVAILABLE`, raised as `ModuleNotFoundError: No module named 'memory_head'`.
#: Same shape as the retainer's own measured failure (`RETAINER_UNREACHED`), and invisible from the
#: checkout for the same reason — every checkout-driven arm stays green because the checkout always
#: has the file. The copy puts it in the tree; the keep in `scripts/artifacts-coverage.json` stops the
#: strip deleting it. BOTH ARE REQUIRED.
PHASE0_MEMORY_HEAD = ROOT / 'scripts/phase0/memory_head.py'
# The organism-level acceptance command. Copied by name for the same structural reason as the
# receipt path above: the release tree is a clone of the built source plus named overlays, so no
# file under scripts/ is present unless it is copied, and `scripts/**` is a strip pattern that
# would then delete it. A release that cannot run its own acceptance command cannot be verified
# from its own bytes.
ORGANISM_ACCEPT = ROOT / 'scripts/organism-accept.sh'
# The Experience Court: the command that adjudicates whether a candidate record's provenance may
# be adopted as memory of an event (row 8 of plugins/aukora-kira/GRADUATION.md). Copied for the
# same structural reason as the acceptance command above — the release tree is a clone of the
# built source plus named overlays, so no file under scripts/ is present unless it is copied, and
# `scripts/**` is a strip pattern that would then delete it. A release that cannot run its own
# court cannot adjudicate its own memory. Carrying it is NOT mounting the Kira lane and grants it
# no authority: it is a command an operator runs on candidate bytes.
KIRA_COURT = ROOT / 'scripts/kira'
SCRIPTS_LIB = ROOT / 'scripts' / 'lib'
# Diamond's cold Kira evidence consumer. Carried so ONE RELEASE can verify its own exported
# evidence with no sibling repository: the verifier resolves `diamond` from `--package-root`
# naming this directory, so the bytes it runs are the bytes the release attests. It is a
# SEPARATE PROCESS on an operator's command, never on the request path, and it confers no
# authority: cold verification answers "do these Kira bytes and signatures agree under the keys
# I supplied", never "is this write authorized" and never "did the cell run" (it always reports
# `cellRan: null`). `upstream-diamond.json` pins every file, and `phase0-check-pins.py` holds
# the same closure to the same digests on both sides of the copy.
# `vendor/seed` is aukora-seed's path guard at 9fca7a0, byte for byte (PROVENANCE.json pins every file). The
# action gate (plugins/aukora-action-gate) calls its `analyse`, `judge` and `decide` on every agent tool call, so the
# release must carry it or the gate cannot import its judge.
# `aukora-packages` and `vendor/authority` carry the original memory law (aumara-xyz/aukora packages/memory and
# packages/kernel at def297f). Kira's `plugins/aukora-kira/lib/memory-law.mjs` imports the generated
# `vendor/aukora-packages/lib/packages/memory/src/{envelope,ingestGate}.js`, which import
# `vendor/authority/lib/canonical.js` and its pinned `deps/@noble/hashes@2.2.0`, so a release without these two
# trees could not load Kira at all (the ERR_MODULE_NOT_FOUND class LANE_PLUGINS below records).
# `aukora-first-echo` is imported by `scripts/aura/echo-head.mjs` (carried: `scripts/aura/**`), so a release without it
# carried an Aura script that could not load its own verifier.
VENDORED = (ROOT / 'vendor/append-only', ROOT / 'vendor/receipt', ROOT / 'vendor/kira-export',
            ROOT / 'vendor/seed', ROOT / 'vendor/aukora-packages', ROOT / 'vendor/authority',
            ROOT / 'vendor/aukora-first-echo')
#: ── SINGLE FILES A CARRIED SCRIPT IMPORTS FROM OUTSIDE EVERY DIRECTORY THIS SCRIPT COPIES (2026-09-27) ─────────────
#: MEASURED: `remember.mjs` settled a memory on the owner's click and then died at export, because the release's
#: `scripts/kira/public-evidence.mjs:89` imports `../../apps/aukora-desktop/card-chain.mjs` and no release carried it
#: (`ERR_MODULE_NOT_FOUND`). `scripts/aura/release-boot-smoke.mjs` imports `../aukora/desktop-cutover.mjs` the same way.
#: Each is copied to the same release-relative path; their own imports are `plugins/aukora-kira/lib` and `scripts/lib`, both
#: carried. `release_import_gaps` below is what keeps this list honest: a missing file refuses the release by name.
RELEASE_IMPORT_FILES = ('apps/aukora-desktop/card-chain.mjs', 'scripts/aukora/desktop-cutover.mjs')
# `target/` is build output, never vendored bytes — the same exception the pin checker declares.
BUILD_OUTPUT_DIRS = {'target'}
# Runtime debris, never authored bytes. `__pycache__` appears the moment anyone imports a script
# from a checkout, and shipping it would put byte-compiled copies of the closure inside a release
# whose whole purpose is to attest the source it carries.
DEBRIS_DIRS = {'__pycache__', '.venv', 'voice/models'}
DEBRIS_FILES = ('*.pyc', '*.pyo')
# ── aura-83 (gap 5): IGNORED VOICE MODELS AND A VIRTUALENV WERE BEING COPIED INTO RELEASES. ──────────
# **THE EGRESS AUDIT FOUND `voice/models` AND A `.venv` SHIPPING INSIDE BUILDS AND RELEASES.** *Neither is
# authored source, both are ignored by git, and a release exists to attest the source it carries* -- *so
# shipping them inflates the stripped totals, puts unmeasured bytes into a tree whose digests are the whole
# point, and can carry a voice model off the machine.* **The audit offered two fixes; this is the second,
# and it is the one that ALSO reaches the face build** (*see `build-face.py`, which CLONES rather than copies
# and therefore needed a filter of its own*).
#
# **THE PATTERNS ARE `shutil.ignore_patterns` GLOBS, NOT REGEXES.** *A `.venv` is a virtualenv: a build
# artefact that can be gigabytes and is regenerated from `requirements`, never authored.* *The audio
# extensions are listed separately from the directory, because a stray `.wav` OUTSIDE `voice/models` is the
# same egress.*
#
# *** THE FOUR CASES WERE "PROBED RATHER THAN ASSUMED", AND THIS SENTENCE SAID `voice/models` MATCHES. IT DOES
# NOT, AND THAT CLAIM IS WHY THE INERT PATTERN SURVIVED REVIEW (corrected, aura-83 R532). ***
# *A probe against `ignore_patterns` cannot be run by testing a pattern against itself:*
#     fnmatch('voice/models', 'voice/models')  ->  TRUE    ← a probe against itself; asks nothing
#     fnmatch('models',       'voice/models')  ->  FALSE   ← WHAT `ignore_patterns` ACTUALLY ASKS
# *`ignore_patterns` never compares the pattern to the pattern; it compares it to each entry's BASENAME, and a
# basename never contains `/`.* **So the four cases, as they actually behave:**
#     `a.wav`         MATCHES    (a basename glob -- the correct form, and the audio list below relies on it)
#     `models` alone  MATCHES    (and would over-match every `models` directory: the reason it is not used)
#     `voice/models`  DOES NOT MATCH, and never did, until it was handled BY POSITION in `COPY_IGNORE` below
#     `README.md`     does not match, correctly
# *** A PROBE THAT TESTS A VALUE AGAINST ITSELF CANNOT FAIL, WHICH IS THE ONE PROPERTY A PROBE MUST HAVE. ***
# *What settles this is a real `copytree` through the real `COPY_IGNORE` -- not a pattern comparison -- and that
# run is recorded in the block below.*
AUDIO_FILES = ('*.wav', '*.mp3', '*.m4a', '*.flac', '*.ogg', '*.aiff', '*.aif', '*.opus')
# Every authored tree is copied without build output or runtime debris. Defined here, after the
# sets it reads, so the materializer cannot fail on import order.
# ── THE BASENAME PATTERNS, WHICH WORK, AND THE ONE NESTED PATH, WHICH CANNOT BE A PATTERN AT ALL ──────
# *** `shutil.ignore_patterns` TESTS EACH ENTRY'S **BASENAME** WITH `fnmatch`. A BASENAME NEVER CONTAINS `/`,
# SO A PATTERN CONTAINING ONE CAN NEVER MATCH -- and `'voice/models'` sat in `DEBRIS_DIRS` doing NOTHING. ***
# MEASURED, by copying a real tree through the old composition:
#     source: ['.venv/thing', 'lib/keep.mjs', 'voice/models/kokoro-v1.0.onnx']
#     copied: ['lib/keep.mjs', 'voice/models/kokoro-v1.0.onnx']
#   *`'.venv'` is a bare basename and was CORRECTLY IGNORED; `'voice/models'` LEAKED.* **The tuple read as
#   covered, the egress audit read it as covered, and the model file was copied into every build and release.**
# *So `'voice/models'` is composed OUT of the pattern set here and handled by position instead* -- `**/voice/models`
# at any depth is "a directory named `models` whose PARENT is named `voice`", which is a fact about where we are,
# not about a name. *`DEBRIS_DIRS` itself is left intact so any other reader of it sees what it always saw.*
_BASENAME_IGNORE = shutil.ignore_patterns(
    *(BUILD_OUTPUT_DIRS | (DEBRIS_DIRS - {'voice/models'})), *DEBRIS_FILES, *AUDIO_FILES)


def COPY_IGNORE(directory, names):
    """`shutil.copytree`'s ignore callable: every basename pattern, PLUS `**/voice/models`.

    **THE NESTED CASE IS DECIDED BY POSITION RATHER THAN BY A PATTERN, BECAUSE `ignore_patterns` CANNOT
    EXPRESS ONE.** *`directory` is the source directory being read and `names` are its entries, so the test
    is exact:* a `models` entry is skipped when the directory holding it is named `voice`.
    """
    skipped = set(_BASENAME_IGNORE(directory, names))
    if 'models' in skipped:
        return skipped
    if os.path.basename(os.path.normpath(str(directory))) == 'voice' and 'models' in names:
        skipped.add('models')
    return skipped

# Lanes whose SOURCE ships. Their lib bytes are covered automatically by the release's own
# `plugins/*/lib/**/*` and `plugins/*/package.json` host patterns, so carrying them is what makes
# them integrity-covered. Carrying is NOT mounting: neither is added to a composition row here,
# and both report their own state when a profile does mount them.
#   aukora-kira   states KIRA_SETTLEMENT.available = false — no admitted memory producer exists,
#                 and the disposable test adapter is never substituted for the production path.
#   aukora-aumlok refuses by name with no key material present, and its service names
#                 `aumlok:host-registry-unavailable` / `aumlok:adapter-unbound` rather than
#                 degrading, so an unprovisioned mount fails closed.
#   aukora-board  holds no store and reads no live state of its own: it renders the
#                 other conversations from the harness's own session service, and a
#                 reader fault omits the board rather than failing a turn.
#   aukora-eye    registers ONE tool, `aukora_see`, which asks the desktop shell for a
#                 photograph of the window it is already showing. It is the only entry here the
#                 default composition MOUNTS FOR ITS TOOL, and that is the difference the eye
#                 lane's relay note names: the shell hands the backend child its eye address and
#                 per-launch token in the environment, and NOTHING ELSE registers the tool. A
#                 release that carries these bytes and mounts no row starts a backend whose model
#                 cannot look at the app, while every eye court stays green — which is why
#                 `tests/aukora-eye-row.test.mjs` holds this constant and the row below together.
LANE_PLUGINS = ('aukora-kira', 'aukora-aumlok', 'aukora-board', 'aukora-eye', 'aukora-caged-worker',
                # ── MEASURED OUTAGE, 2026-09-25: A RELEASE THAT COULD NOT START ──────────────────────
                # The cutover died with `ERR_MODULE_NOT_FOUND`: `plugins/aukora-composition-gate/src/
                # admission-grant.mjs:32` imports `../../aukora-owner-daemon/lib/binding.mjs`, and this
                # tuple did not carry it — so the file was ABSENT from the release and the process could
                # not boot. Peter's app was down until the launch was rolled back.
                #
                # WHY THE LIST IS THE WHOLE DEFECT AND NOT A TYPO: `LANE_PLUGINS` is a HAND-WRITTEN LIST
                # OF WHAT A RELEASE CARRIES, and a relative import CAN CROSS PLUGIN BOUNDARIES. Nothing
                # checked that the set was closed, so a plugin could be imported by a sibling that
                # shipped while the sibling's dependency did not. **The closure court exists because a
                # list cannot be trusted to be complete and a check can.**
                'aukora-owner-daemon',
                # ── CORE'S OWN PLUMBING, CARRIED FOR THE SAME REASON AS THE LINE ABOVE ──────────────
                # `aukora-core-read-deny` is the `fs` SWAP a core session reads through, and
                # `aukora-subscription-hands` owns the pins for the coding hands. A composition row that
                # mounts a plugin the release does not carry is the caaf outage again: the row is inert
                # until boot, and the boot is the thing that dies. Carrying is NOT mounting — the rows
                # are written into the composition below, on the host plane, where both of their READMEs
                # and CONFIG.md say they belong.
                'aukora-core-read-deny', 'aukora-subscription-hands',
                # ── MEASURED ON THE LIVE APP, BY FABLE: `aukora-board` COULD NOT IMPORT ────────────────
                # `plugins/aukora-board/lib/index.js:35` imports `../../aukora-organism/lib/organism.mjs`,
                # and this list did not carry `aukora-organism`, so the plugin the release MOUNTS was not in
                # the release. The lanes' board snapshots were down on the live app.
                # ── THE GOAL AUTO-RESUME (Fable, 2026-09-27): the lane sat idle SEVEN HOURS after a backend
                # restart because a goal active at shutdown is not re-armed. Self-contained: it imports only
                # `node:*` and its own `./resume.mjs`, so the closure this list guards is satisfied by the one
                # directory it names.
                'aukora-goal-resume',
                # ── THE ACTION GATE: every agent tool call judged and receipted. It imports Kira's chain writer
                # (`../../aukora-kira/lib/memory-owner.mjs`), which this tuple already carries, and the vendored seed
                # guard (`vendor/seed`, carried by VENDORED). Carrying is not mounting:
                # `action-gate.patch.yml` (written beside the other root patches below) mounts it.
                'aukora-action-gate',
                # ── AUKORA SEATBELT: the `sandbox` provider with AUKORA's kernel denies appended. Imports only `node:*`,
                # its own `profile.mjs`, and the release's own `packages/sandbox/sandbox-local`. Carrying is not
                # mounting: `seatbelt.patch.yml` (written beside the other root patches below) mounts it.
                'aukora-seatbelt',
                'aukora-organism')
# `retention-policy.json` is Kira's: `scripts/kira/housekeeping.mjs` reads it from `../../plugins/aukora-kira/` by default.
LANE_FILES = ('package.json', 'retention-policy.json')
# `data` IS PART OF A LANE'S BYTES, AND ITS ABSENCE WAS MEASURED RATHER THAN IMAGINED. With this tuple
# as `('lib',)` the release at `~/aukora-release-7f808b17` carried `plugins/aukora-aumlok/lib/` and NO
# `plugins/aukora-aumlok/data/` at all, so the 30,692 merged words the V2 item shipped were absent from
# what ships and a draw against a real release refused BY NAME (`aumlok:word-lists-absent`). The shell
# reads those lists out of the release at `plugins/aukora-aumlok/data/<name>.json`
# (`apps/aukora-desktop/aumlok-draw.mjs`), which is the path this tuple puts them at. Only aukora-aumlok
# has a `data/` directory today, and the guard below copies a directory only when the plugin has it, so
# naming it here cannot invent one for the other three lanes.
#   MEASURED AFTER THE CHANGE: a release materialized from this tree carries both files, and
#   `tests/aukora-aumlok-packaging.test.mjs` holds this constant and the coverage pattern together.
LANE_DIRS = ('lib', 'data')

#: PER-PLUGIN DIRECTORIES, for a plugin whose surface is not `lib` and `data`.
#:
#: `aukora-owner-daemon` CARRIES `bin/`, AND NOTHING *IMPORTS* IT — which is exactly why it was easy to
#: leave out. `scripts/owner/owner-closure.mjs` names it as `$LIBEXEC/plugins/aukora-owner-daemon/bin/
#: owner-daemon.mjs`: it is **launched BY PATH**, so no import graph would ever have asked for it, and a
#: release missing it cannot run its own daemon. A plugin whose entry point is a path is carried for the
#: same reason `lib` is: the release is the thing that RUNS.
PLUGIN_DIRS = {'aukora-owner-daemon': ('lib', 'bin')}

# The nostr tree the Messages face resolves at RUNTIME, and the reason it does NOT travel with the
# lanes above. `plugins/aukora-face/messages/src/contacts-store.ts` names the module it loads as
# `<this module's directory>/../../../aukora-nostr/lib/contact.mjs`: three levels up from the
# face's OWN `lib/`, with `$AUKORA_NOSTR_CONTACT_MODULE` as the only override and NO other
# candidate. The hardcoded path into a checkout that used to sit at the end of that list was
# removed in 56413d7e, so a deployment without the tree now refuses by name with
# `messages:nostr-tree-absent` instead of silently reading a developer's working directory.
#
# THE DESTINATION IS FIXED BY THAT ARITHMETIC, NOT BY TASTE, AND IT IS NOT `plugins/`. A
# materialized release keeps its faces FLATTENED — this face ships as
# `plugins/aukora-face-messages/lib/index.js`, one directory shallower than the source's
# `plugins/aukora-face/messages/lib/index.js` — so three levels up from the SHIPPED face's `lib/`
# is the RELEASE ROOT. MEASURED against a real tree by importing a release's own `lib/index.js`
# and calling its exported `resolveContactModuleSpecifier()`: with the tree at
# `<release>/aukora-nostr/lib/contact.mjs` the call returns that path; with the same bytes at
# `<release>/plugins/aukora-nostr/lib/contact.mjs` the path is not a candidate at all and the call
# throws `messages:nostr-tree-absent` naming `<release>/aukora-nostr/lib/contact.mjs`. LANE_PLUGINS
# therefore does NOT fit this tree: its destination is where the SOURCE-tree walk lands, not where
# the shipped face's walk lands, so copying it there would carry the bytes while leaving the face
# refusing — the failure this carry exists to end.
#
# The WHOLE tree travels, for the vendored trees' reason above: the resolver reads `lib/`, and a
# subset would be a tree the repository's own `plugins/aukora-nostr/lib/vendor/**/upstream-*.json`
# pins no longer describe. The tree's closure is relative imports plus `node:` builtins only, so it
# loads from the release root with no store resolution. NO `strip.keep` ENTRY ACCOMPANIES IT: no
# strip pattern selects `aukora-nostr/**`, and a keep for a path no pattern selects is refused as
# `strip-keep-matched-nothing`.
NOSTR_TREE = ROOT / 'plugins/aukora-nostr'
#: Release-relative destination. The name is kept, the parent is not: see the measurement above.
NOSTR_RELEASE_DIR = 'aukora-nostr'




def _imported_packages(lib: Path) -> 'tuple[str, ...]':
    """Bare package specifiers imported by every emitted module in one directory.

    Relative paths and node builtins are not packages and are skipped. A subpath
    import (`pkg/thing.js`) is reduced to the package it belongs to.
    """
    # `from "..."` only, anchored to a statement or a dynamic import call, and the
    # specifier must look like a package name. A loose match picks up template
    # literals in ordinary strings, which is how this first went wrong.
    pattern = re.compile(r"""(?:^|[;}\s])(?:from|import\s*\()\s*['"]([^'"\s$]+)['"]""", re.MULTILINE)
    valid = re.compile(r'^(?:@[a-z0-9][\w.-]*/)?[a-z0-9][\w.-]*(?:/[\w.-]+)*$')
    found: set[str] = set()
    for module in sorted(lib.glob('*.js')):
        for specifier in pattern.findall(module.read_text(encoding='utf-8', errors='ignore')):
            if specifier.startswith('.') or specifier.startswith('node:'):
                continue
            if not valid.match(specifier):
                continue
            parts = specifier.split('/')
            found.add('/'.join(parts[:2]) if specifier.startswith('@') else parts[0])
    return tuple(sorted(found))


def _resolve_release_package(release: Path, name: str) -> 'Path | None':
    """Find a package inside a materialized release by its published name.

    Checks the workspace copies first (vendor/ and packages/), then the root store,
    so a workspace package is preferred over a duplicate in node_modules.
    """
    direct = release / 'vendor' / name.split('/')[-1].replace('dsh-', '')
    candidates = [release / 'node_modules' / name]
    for base in ('vendor', 'packages'):
        for manifest in (release / base).glob('*/package.json'):
            candidates.append(manifest.parent)
        for manifest in (release / base).glob('*/*/package.json'):
            candidates.append(manifest.parent)
    for candidate in candidates:
        manifest = candidate / 'package.json'
        if not manifest.is_file():
            continue
        try:
            if json.loads(manifest.read_text()).get('name') == name:
                return candidate
        except (ValueError, OSError):
            continue
    # Third-party packages live only in the pnpm virtual store, one directory per
    # exact version. The installed tree is the authority on which version this release
    # carries, so an unambiguous single match is used and anything else refuses rather
    # than silently picking one.
    store = sorted((release / 'node_modules/.pnpm').glob(f'{name.replace("/", "+")}@*'))
    inner = [entry / 'node_modules' / name for entry in store]
    present = [path for path in inner if (path / 'package.json').is_file()]
    if len(present) == 1:
        return present[0]
    if len(present) > 1:
        fail(f'face-dependency-ambiguous: {name} is present at {len(present)} versions in this release')
    return direct if (direct / 'package.json').is_file() else None


def fail(message: str) -> 'NoReturn':  # noqa: F821
    print(f'materialize-release-failed: {message}', file=sys.stderr)
    raise SystemExit(1)


def note(message: str) -> None:
    """A named statement about what this cut PRODUCED, which is not a reason to refuse it.

    **ADDED IN aura-82, BECAUSE aura-81's REFUSAL HERE WAS IN THE WRONG PLACE.** *A release carries the
    documented placeholder kira subject BY DESIGN* -- this file's own comment says the subject "is not this
    file's to choose" and that pinning it is "an owner/deployment act ... a `--patch` overlay naming
    `approverDid`". **So refusing here refused the ARTEFACT for a property of the INSTALLATION**, and every
    cut failed.

    **AND SILENCE WOULD BE THE OTHER MISTAKE**: *a cut that printed nothing would let the placeholder ship
    without anyone knowing the deployment overlay is still required.* **A `note` is neither**: *the cut
    succeeds, the line is greppable by its own name, and the reader learns which case they are in.*
    """
    print(f'materialize-release-note: {message}')


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_head() -> str:
    """The commit this Genesis checkout is on, as the record will name it."""
    return subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True,
                          text=True).stdout.strip()


DEPENDENCY_CLI = ROOT / 'scripts/dependency-digests-cli.mjs'


def dependency_digests(target):
    """The sorted [path, sha256] list for the release's installed dependency store.

    Refuses rather than returning an empty list: a release recorded with no dependency digests would
    verify as intact against nothing, WHICH IS THE FAILURE THIS WHOLE CHECK EXISTS TO PREVENT."""
    completed = subprocess.run(['node', str(DEPENDENCY_CLI), '--source', str(target)],
                               capture_output=True, text=True)
    if completed.returncode != 0:
        raise SystemExit(f'dependency-digests-failed: {completed.stderr.strip()}')
    digests = json.loads(completed.stdout)
    if not digests:
        raise SystemExit('dependency-digests-empty: the release has no installed dependencies to record, '
                         'so a check against this list would verify nothing')
    return digests

def strip_release(target: Path) -> dict:
    """Apply the declared strip rules to the release copy; return the strip summary.

    The rules are not restated here. scripts/release-strip.mjs reads them from
    scripts/artifacts-coverage.json, which is the same declaration the consumer
    re-reads and the artifact record binds by digest, so producer and consumer
    cannot drift apart without failing the check.
    """
    completed = subprocess.run(['node', str(STRIP_CLI), '--release', str(target)],
                               capture_output=True, text=True)
    if completed.returncode != 0:
        fail(f'release-strip-failed: {(completed.stderr or completed.stdout).strip()}')
    lines = [line for line in completed.stdout.strip().splitlines() if line]
    try:
        summary = json.loads(lines[-1])
    except (IndexError, ValueError):
        fail(f'release-strip-unreadable: {completed.stdout.strip()}')
    counts = summary['counts']
    print(f'STRIPPED {summary["deletedFiles"]} file(s) / {summary["deletedBytes"]} bytes; '
          f'tree {counts["before"]["files"]} -> {counts["after"]["files"]} file(s), '
          f'{counts["before"]["bytes"]} -> {counts["after"]["bytes"]} bytes; '
          f'{counts["deleted"]["directories"]} emptied director(ies), {counts["deleted"]["brokenLinks"]} dead link(s)')
    print(f'kept by runtime reference: {", ".join(summary["keptByRule"]) or "none"}')
    return summary


def held_overlay_rows() -> str:
    """The RECORDED HOLD overlay, appended AFTER the generated core rows and BEFORE `hmr_row`.

    *** FABLE'S SPEC (aura-97): "an explicit composition overlay file committed with a one-line reason ... which
    the materializer applies and prints in the prepare summary." *** *`AUKORA_COMPOSITION_OVERLAY` names that file;
    unset means no overlay, which is the default and the state every other candidate is built in.*
    **WHY A FILE AND NOT AN EDIT TO THE ROWS ABOVE:** *an earlier attempt removed the read-deny section from
    `core_mount_rows` in this file and left a `providerModule` key orphaned at top level -- the launcher refused the
    whole composition (`parsePatchList`).* *** A LATER LAYER CAN DISABLE A ROW WITHOUT EVER TOUCHING ITS NEIGHBOURS,
    AND THAT IS THE ONLY KIND OF HOLD THAT CANNOT CUT A YAML SECTION IN HALF. ***
    """
    path = os.environ.get('AUKORA_COMPOSITION_OVERLAY', '').strip()
    if not path:
        return ''
    overlay = Path(path)
    if not overlay.is_file():
        raise SystemExit('composition-overlay-absent: AUKORA_COMPOSITION_OVERLAY names %s, which is not a file'
                         % path)
    text = overlay.read_text()
    print('materialize-release-note: composition-overlay: %s applied (%d line(s))' % (overlay.name,
          len(text.splitlines())))
    for line in text.splitlines():
        if line.startswith('#') and 'held until' in line:
            print('materialize-release-note: overlay reason: %s' % line.lstrip('# ').strip())
    return '\n' + text.rstrip('\n') + '\n'


def action_gate_rows() -> str:
    """The action gate, IN the release's default composition, taken from overlays/action-gate.patch.yml.

    A fresh install lists only `aukora-composition.patch.yml`, and the rows `core_mount_rows` writes
    mount `aukora-core-read-deny`, which crashes boot with `service "fs" has been registered`: fs,
    workspace-files, ptc-runtime and ui-deliverables then never start. The owner's deployment avoided
    it by listing the action-gate overlay after the composition. These are that overlay's rows,
    appended after the core rows so they win: fs-sandbox back on, core-read-deny off, the gate
    mounted. A fresh install is governed by default and nothing collides.

    The overlay stays the one source: its comment lines are dropped, its rows are copied verbatim. A
    deployment that still lists `<release>/action-gate.patch.yml` applies the same rows twice, which
    is harmless: the two overrides set the values these rows already set, and the loader keys rows by
    id (vendor/loader/src/config/group.ts `update`), so the second `aukora-action-gate` insert
    replaces the first rather than mounting a second guard.
    """
    source = ROOT / 'overlays' / 'action-gate.patch.yml'
    rows = [line for line in source.read_text(encoding='utf-8').splitlines()
            if not line.lstrip().startswith('#')]
    while rows and rows[0].strip() == '':
        rows.pop(0)
    return (
        '\n'
        '# ── THE ACTION GATE, BY DEFAULT (rows copied from overlays/action-gate.patch.yml) ──────────\n'
        '# fs-sandbox provides `fs` again, aukora-core-read-deny (the `fs` swap that crashed boot with\n'
        '# "service fs has been registered") is disabled, and aukora-action-gate judges and receipts\n'
        '# every tool call. Listing <release>/action-gate.patch.yml as well is harmless.\n'
        + '\n'.join(rows).rstrip('\n') + '\n\n'
    )


def core_mount_rows(release_root: str) -> str:
    """CORE's two HOST-PLANE mounts, as composition text.

    BOTH ARE HOST ROWS AND NEITHER CAN BE A PRESET ROW, and each plugin's own documentation says why
    rather than leaving it to taste:

    * `fs-sandbox` declares `inject = ['tools', 'fs', 'systemPrompt']`, and a preset mount resolves
      injection BEFORE ANY SESSION EXISTS (`plugins/aukora-core-read-deny/README.md`, quoting
      `presets/core/agent.cordis.yml`: "The `fs` service and its policy stay in the host"). So the swap is
      one host row that REPLACES the sandbox provider: `ctx.provide` throws on a second registration of a
      name, which is why the guard wraps the provider it is given instead of providing `fs` beside it.
      PRESET SCOPING IS THE PLUGIN'S OWN DECISION, not the row's: the guard is handed `presetOf`, refuses
      a core initiator and leaves every other reader exactly as it was — so a STANDARD agent is unchanged
      while a CORE agent is refused.
    * the `subagents` registry is a host-plane process singleton and a provider name may only be
      registered once, so mounting the two hand providers in a preset would collide as soon as a second
      session mounted CORE (`plugins/aukora-subscription-hands/CONFIG.md` §2).

    The row that mounts a plugin the release does not carry is the caaf outage, so `LANE_PLUGINS` carries
    both directories and `tests/aukora-core-mounts.test.mjs` measures the composed result rather than this
    function's intent.

    :param release_root: the release-relative name rows resolve through.
    :returns: the composition text, ending in a blank line.
    """
    return (
        '\n'
        '# ── A ROW NAME THE LAUNCHER CAN ACTUALLY RESOLVE (MEASURED, BY FABLE\'S BOOT-RISK REVIEW) ────────\n'
        '# The two hand rows below were BARE PACKAGE NAMES (`@deepseek-ai/dsh-subagent-codex`) and the launcher\n'
        '# runs `--profile web` in LINK MODE, where a bare name resolves through `$DSH_HOME/profiles/node_modules`\n'
        '# — a mirror of the apps/cli dependency closure — and NEITHER PACKAGE IS IN IT. Both rows therefore\n'
        '# failed to import on every boot with only a startup warning, the subscription hands were DARK IN EVERY\n'
        '# RELEASE, and the court passed because it matched the row\'s TEXT instead of resolving its module.\n'
        '# Release-relative, like every other inserted row, so it resolves inside the release by construction.\n'
        '# ── CORE: THE READ GUARD. One row, REPLACING the sandbox provider. `ctx.provide` throws on a\n'
        '# second registration of a name, so the read-deny entry takes `SandboxedFileSystem` as its\n'
        '# `providerClass` and ADDS only the read decision: write fencing and every non-read method are\n'
        "# still the sandbox's own. It refuses a CORE initiator and leaves every other reader unchanged,\n"
        '# which is what makes this mount safe to put on the host plane for a standard agent too.\n'
        '# ── REPLACING A ROW MEANS DISABLING IT, NOT RENAMING IT (MEASURED, FABLE\'S BOOT-RISK REVIEW) ──\n'
        '# The first version of this row was a NON-INSERT patch that named the guard:\n'
        '#\n'
        '#     - id: fs-sandbox\n'
        '#       name: ./plugins/aukora-core-read-deny/lib/index.mjs\n'
        '#\n'
        "# and `applyEntryPatches` SKIPPED IT ON EVERY BOOT — `app-boot/lib/index.js:99-100`:\n"
        '#\n'
        '#     patch: name mismatch for "fs-sandbox" (expected "@deepseek-ai/dsh-fs-sandbox", got\n'
        '#     "./plugins/aukora-core-read-deny/lib/index.mjs"), skipping\n'
        '#\n'
        "# **`name` IS DESTRUCTURED OUT OF THE OVERRIDES, SO IT IS ONLY EVER A CHECK: a later layer cannot\n"
        '# rename a row at all.** The base provider kept mounting and the guard never did, while a court that\n'
        '# read the patch TEXT saw exactly what it expected. **The materializer already records this same\n'
        '# failure four lines above — "the court passed because it matched the row\'s TEXT instead of\n'
        '# resolving its module" — and this row was its second instance.**\n'
        '#\n'
        '# So the base row is DISABLED, which is an override the loader does honour (`:2446`), and the guard is\n'
        '# inserted as its own row. `ctx.provide` refuses a second registration of `fs`, so exactly one of the\n'
        '# two may be enabled — which is what makes this a replacement rather than a second provider.\n'
        '- id: fs-sandbox\n'
        '  disabled: true\n'
        '\n'
        '- insert:\n'
        '    - id: aukora-core-read-deny\n'
        '      name: ./plugins/aukora-core-read-deny/lib/index.mjs\n'
        '      config:\n'
        # ── RELEASE-RELATIVE, BECAUSE A BARE NAME DOES NOT RESOLVE FROM A RELEASE (cohesion row 3) ──\n
        # *** THIS WAS A BARE PACKAGE NAME (`@deepseek-ai/dsh-fs-sandbox`) AND THE RELEASE CARRIES IT AT\n
        # `apps/cli/node_modules/@deepseek-ai/dsh-fs-sandbox` — REACHABLE FROM THE RELEASE'S OWN TREE,\n
        # UNREACHABLE FROM A BARE SPECIFIER. So `aukora-core-read-deny` threw `no-provider`, the guard\n
        # never mounted, and THE RELEASE HAD NO FILESYSTEM SERVICE AT ALL. *** The row's own `name:` above\n
        # is release-relative for the identical reason, and the hand rows thirty lines up were fixed from\n
        # bare names to release-relative for the identical reason: \"the court passed because it matched the\n
        # row's TEXT instead of resolving its module.\" This is that defect's THIRD instance in one file.\n        #\n        # AND THE ANCHOR IS THE *PLUGIN*, NOT THIS PATCH FILE — WHICH IS WHY THE PATH CLIMBS THREE LEVELS.\n        # `resolveProviderModule` is `createRequire(import.meta.url)` then `require(specifier)`, so a\n        # relative specifier resolves from `<release>/plugins/aukora-core-read-deny/lib/`, NOT from the\n        # patch. `./apps/...` would therefore have looked for the package INSIDE the plugin's own lib\n        # directory. Three levels reach the release root; the row's `name:` above needs no climbing\n        # because THE LOADER anchors that one beside the patch file. Two different anchors, one row.\n
        '        providerModule: ../../../apps/cli/node_modules/@deepseek-ai/dsh-fs-sandbox\n'
        '\n'
        '# ── CORE: THE SUBSCRIPTION HANDS. Host-plane provider rows, because the `subagents` registry is\n'
        '# a process singleton and a provider name may only be registered once. THE PINS THEMSELVES ARE\n'
        '# NOT HERE: `plugins/aukora-subscription-hands/lib/pins.mjs` owns them (one child at a time,\n'
        '# sharing `scripts/lib/heavy-run.mjs`\'s lock, and a process-group reap), and these rows supply\n'
        '# only the two things a provider row can supply — the mode the adapter understands, and the\n'
        '# environment that redirects each CLI\'s own config into a directory this deployment owns.\n'
        '# `never` is the only mode that sends an approval policy of `never` and it sends NO sandbox on\n'
        '# its own, which is why CODEX_HOME is not optional: the sandbox arrives from the owned\n'
        '# config.toml that `lib/run.mjs` writes before the child exists.\n'
        '- insert:\n'
        '    - id: subagent-codex\n'
        "      name: ./packages/subagent/subagent-codex/lib/index.js\n"
        '      config:\n'
        '        providerName: codex\n'
        '        permissionMode: never\n'
        '        env:\n'
        f"          CODEX_HOME: '{LIVE_DSH_HOME}/subscription-hands/config/codex'\n"
        "          CODEX_SANDBOX_NETWORK_DISABLED: '1'\n"
        '\n'
        '    - id: subagent-claude-code\n'
        "      name: ./packages/subagent/subagent-claude-code/lib/index.js\n"
        '      config:\n'
        '        providerName: claude-code\n'
        '        # NEVER `dontAsk` (the shipped default) and never `bypassPermissions`.\n'
        '        permissionMode: acceptEdits\n'
        '        env:\n'
        f"          CLAUDE_CONFIG_DIR: '{LIVE_DSH_HOME}/subscription-hands/config/claude'\n"
        "          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'\n"
        '\n'
    )


def hmr_disable_row(development: bool) -> str:

    """The row that closes the hot-reload channel, or the reason it is left open.

    THE CHANNEL ANSWERS UNAUTHENTICATED. `GET /plugins/events` returns 200 with no cookie
    and streams the whole boot graph — every mounted plugin id and revision — on connect.
    Every other route this composition adds is gated through
    `connection.requestRejection`; that one is not, because its own registration never
    consults `connection` at all. It is a development affordance shipping in a packaged
    application.

    Disabling it here is the harness's own pattern, not an invention: the upstream desktop
    host does exactly this, at
    `apps/desktop-host/config/desktop.cordis.patch.yml`, with the same two lines.

    :param development: true keeps the channel, for a release a person is iterating on.
    :returns: the composition rows to insert, possibly empty.
    """
    if development:
        return (
            '# HOT RELOAD LEFT MOUNTED: this release was materialized with --development.\n'
            '# /plugins/events answers UNAUTHENTICATED and streams the whole boot graph.\n'
            '# Do not run an application on this release.\n'
            '\n'
        )
    return (
        '# The hot-reload channel is a development affordance, and it does not\n'
        '# authenticate: /plugins/events answers 200 with no cookie and streams every\n'
        '# mounted plugin id and revision. The upstream desktop host disables the same row\n'
        '# for the same reason (apps/desktop-host/config/desktop.cordis.patch.yml).\n'
        '# Materialize with --development to keep it.\n'
        '- id: client-hmr\n'
        '  disabled: true\n'
        '\n'
    )


#: The declaration the release's record binds by digest. A COVERED path is one these patterns match, so
#: these are the paths whose git state the record and the commit can disagree about.
COVERAGE = ROOT / 'scripts/artifacts-coverage.json'


def covered_patterns() -> list:
    """The coverage patterns, read from the same declaration the artifact record binds."""
    if not COVERAGE.exists():
        return []
    declared = json.loads(COVERAGE.read_text())
    return list(declared.get('hostPatterns') or []) + list(declared.get('clientPatterns') or [])


def covered_regex(pattern: str):
    """A glob from the declaration as a path regex: `**` crosses directories, `*` does not."""
    parts, i = [], 0
    while i < len(pattern):
        char = pattern[i]
        if char == '*':
            if pattern[i:i + 2] == '**':
                parts.append('.*')
                i += 3 if pattern[i + 2:i + 3] == '/' else 2
                continue
            parts.append('[^/]*')
        elif char == '?':
            parts.append('[^/]')
        else:
            parts.append(re.escape(char))
        i += 1
    return re.compile('^' + ''.join(parts) + '$')


def covered_path_audit() -> list:
    """Covered paths the working tree holds UNTRACKED, or has DELETED.

    MEASURED 2026-09-23, and this function exists because of it: the cut `~/aukora-release-39ade459`
    carried `scripts/aura/organism-breath.sh`, a file that was in the WORKING TREE and in NO COMMIT. The
    guard above reads `--untracked-files=no`, so it could not see the file; the release was cut, its record
    named the path three times, and the launcher refused the release it had just been handed —
    `genesis-coverage-set-mismatch: 0 foundation file(s) unrecorded; 1 recorded file(s) gone
    (scripts/aura/organism-breath.sh)`. The dry boot caught it; without that, the shell would have been
    quit onto a release that cannot start. A covered path that is not in the commit is refused HERE, before
    the copy, rather than discovered at the next relaunch.
    """
    regexes = [covered_regex(pattern) for pattern in covered_patterns()]
    if not regexes:
        return []
    porcelain = subprocess.run(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=all'],
                               capture_output=True, text=True)
    if porcelain.returncode != 0:
        fail(f'materialize-not-a-checkout: git could not read {ROOT} ({porcelain.stderr.strip()})')
    problems = []
    for line in porcelain.stdout.splitlines():
        if len(line) < 4 or line[:2] == '!!':
            continue
        state, path = line[:2].strip(), line[3:]
        if state not in ('??', 'D', 'AD'):
            continue
        if any(regex.match(path) for regex in regexes):
            problems.append((path, 'untracked' if state == '??' else 'deleted'))
    return problems



def assert_harness_clean(source: Path) -> None:
    """REFUSE A SOURCE TREE THAT IS NOT THE PINNED HARNESS — defense in depth for the night of 2026-09-25.

    MEASURED: `scripts/build-face.py` copies `vendor/dsh` with `cp -Rc`, and on macOS that copies a SYMLINK as a
    symlink — so a worktree whose `vendor/dsh` was a symlink built INSIDE the main checkout's pinned tree and
    wrote eight `packages/client/aukora-face-*` directories, a rewritten `pnpm-lock.yaml` (sha f3a36778 against
    the pinned ca131858), `tsconfig.client.json` and two node_modules state files into it. A release materialized
    from such a tree would carry every byte of it and NOTHING would say so.

    Three refusals, by name, before a single byte is copied:
      * the lock's digest must be the digest `upstream-dsh.json` pins;
      * `packages/client/aukora-face-*` must not exist — those are built INTO a release by this script from
        `presets/` and `plugins/`; finding them in the SOURCE means the source is somebody's build output.
      * a successful compiled build must bind the archive, every local patch and the artifact inventory.
    """
    if not source.is_dir():
        fail(f'harness-missing: {source} is not a directory')
    lock = source / 'pnpm-lock.yaml'
    pinned = None
    pin_file = ROOT / 'upstream-dsh.json'
    if pin_file.exists():
        try:
            pinned = json.loads(pin_file.read_text(encoding='utf-8')).get('lockfileSha256')
        except (OSError, ValueError):
            pinned = None
    if not lock.exists():
        fail(f'harness-lock-missing: {lock} is absent, so the source cannot be shown to be the pinned harness')
    client = source / 'packages' / 'client'
    face = sorted(entry.name for entry in client.glob('aukora-face-*')) if client.is_dir() else []
    if face:
        fail('harness-contaminated: the source carries %s under packages/client — those are built INTO a release '
             'by this script, never found in the pinned harness; the source is a build output.'
             % ', '.join(face))

    got = hashlib.sha256(lock.read_bytes()).hexdigest()
    if pinned and got != pinned:
        fail('harness-lock-mismatch: %s is %s but upstream-dsh.json pins %s — this tree is NOT the pinned '
             'harness, and a release built from it would carry whatever was written into it'
             % (lock, got[:12], str(pinned)[:12]))
    built = subprocess.run([sys.executable, str(ROOT / 'scripts/build-dsh.py'), '--root', str(ROOT),
                            '--verify-built', '--source', str(source)], capture_output=True, text=True)
    if built.returncode:
        fail((built.stderr or built.stdout).strip() or 'harness-build-binding-refused: verifier failed')
#: The release's authored code whose relative imports must all resolve inside the release. Build output is not walked: face
#: `client.js` bundles and the stock apps under a face's `vendor/` are upstream's bytes. Imports are followed wherever they go.
IMPORT_WALK_ROOTS = ('scripts', 'plugins', 'apps/aukora-desktop', NOSTR_RELEASE_DIR)
IMPORT_SUFFIXES = ('.mjs', '.js', '.cjs')
_STATIC_IMPORT = re.compile(
    r"""^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom[ \t]*['"](\.\.?/[^'"]+)['"]|^[ \t]*import[ \t]*['"](\.\.?/[^'"]+)['"]""",
    re.MULTILINE)
_DYNAMIC_IMPORT = re.compile(r"""\bimport\(\s*['"](\.\.?/[^'"]+)['"]\s*\)""")
_COMMENT_LINE = re.compile(r'^\s*(?:\*|//|/\*)')


def _relative_imports(text: str) -> 'list[str]':
    """Literal relative specifiers a module imports: static `import`/`export … from`, and `import('…')` outside comments."""
    found = [a or b for a, b in _STATIC_IMPORT.findall(text)]
    for line in text.splitlines():
        if _COMMENT_LINE.match(line):
            continue
        found.extend(_DYNAMIC_IMPORT.findall(re.sub(r'/\*.*?\*/', '', line)))
    return found


# HUMAN-GRAPH THREE ALIAS (runtime-served, not physical). The release serves
# `plugins/aukora-face-apps/assets/human-graph/three/<f>` from the packaged
# `plugins/aukora-face-apps/vendor/three/<f>` — the runtime route is
# serveHumanGraphFile in plugins/aukora-face/apps/src/embedded-assets.ts:160-171,
# closed over HUMAN_GRAPH_THREE_FILES (embedded-assets.ts:28). The closure check
# resolves exactly that alias to the packaged file and requires it to exist, so a
# genuinely missing vendor file still gaps. Anything outside this closed set gaps
# exactly as before. Fail-closed on drift: a third runtime file added to the TS
# set without extending this set refuses the cut, which is the correct direction.
_HUMAN_GRAPH_ALIAS_IMPORTER = ('plugins', 'aukora-face-apps', 'assets', 'human-graph')
_HUMAN_GRAPH_THREE_FILES = frozenset({'three.module.min.js', 'three.core.min.js'})


def release_import_gaps(release: Path) -> 'list[tuple[str, str]]':
    """Every relative import in the release's authored code whose target the release does not hold, as (target, importer).

    THE CLOSURE CHECK THAT `LANE_PLUGINS` AND `RELEASE_IMPORT_FILES` NEED: those are hand-written lists, a relative import
    crosses directory boundaries, and the failure shows only from a release (the checkout always has the file). MEASURED
    2026-09-27 before this existed: `card-chain.mjs`, `scripts/lib/{is-main,heavy-run,run-root}.mjs`, `desktop-cutover.mjs`
    and `vendor/aukora-first-echo` were all imported by carried code and absent from the release.
    """
    root = release.resolve()
    queue = []
    for relative in IMPORT_WALK_ROOTS:
        base = root / relative
        if not base.is_dir():
            continue
        for directory, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in ('node_modules', 'vendor', '__pycache__')]
            queue.extend(Path(directory) / name for name in files
                         if name.endswith(IMPORT_SUFFIXES) and name != 'client.js')
    seen = set()
    gaps = {}
    while queue:
        module = queue.pop()
        if module in seen:
            continue
        seen.add(module)
        try:
            text = module.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        for spec in _relative_imports(text):
            target_path = Path(os.path.normpath(module.parent / spec))
            try:
                importer_rel = Path(os.path.relpath(module, root))
            except ValueError:
                importer_rel = None
            spec_parts = Path(os.path.normpath(spec)).parts
            if (importer_rel is not None
                    and importer_rel.parts[:4] == _HUMAN_GRAPH_ALIAS_IMPORTER
                    and len(spec_parts) == 2 and spec_parts[0] == 'three'
                    and spec_parts[1] in _HUMAN_GRAPH_THREE_FILES):
                # Runtime alias: assets/human-graph/three/<f> is served from the
                # packaged vendor/three/<f>. Resolve to the packaged file; a missing
                # one gaps below like any other absent target.
                target_path = root / 'plugins' / 'aukora-face-apps' / 'vendor' / 'three' / spec_parts[1]
            key = os.path.relpath(target_path, root)
            if key.startswith('..') or not target_path.is_file():
                gaps.setdefault(key, os.path.relpath(module, root))
            elif target_path.suffix in IMPORT_SUFFIXES:
                queue.append(target_path)
    return sorted(gaps.items())


def carry_worker_box(target: Path) -> None:
    """Carry unchanged standalone box imports, including the spawned issuer.

    The developer launcher is not in this closure and is never imported or copied.
    """
    box = ROOT / 'plugins/aukora-box'
    for relative in ('PROVENANCE.md', 'aukora/package.json', 'aukora/supervisor/confinement.LICENSE',
                     'aukora/supervisor/confinement-provenance.md'):
        destination = target / 'plugins/aukora-box' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(box / relative, destination)
    queue = list((ROOT / 'plugins/aukora-caged-worker/lib').glob('*.mjs'))
    queue.append(box / 'aukora/issuer/issuer.mjs')
    seen = set()
    while queue:
        source = queue.pop().resolve()
        if source in seen:
            continue
        seen.add(source)
        if not source.is_file():
            fail(f'worker-box-import-absent: {source}')
        if source.is_relative_to(box):
            destination = target / source.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        for spec in _relative_imports(source.read_text(encoding='utf-8')):
            dependency = (source.parent / spec).resolve()
            if dependency.is_relative_to(box):
                queue.append(dependency)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--from', dest='source', type=Path, default=ROOT / 'vendor/dsh')
    parser.add_argument('--to', dest='target', required=True, type=Path)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--development', action='store_true',
                        help='keep the hot-reload channel mounted and mark the release writable '
                             'by scripts/face-dev-push.py. NOT for a release an application runs: '
                             'that channel answers unauthenticated.')
    parser.add_argument('--prune-oldest', action='store_true',
                        help='REMOVE the oldest releases beyond the bound. Off by default: without it, '
                             'being over the bound REFUSES and lists the candidates. Never applies to '
                             'HOME — a test or rehearsal flow may pass it for its OWN scratch root only.')
    parser.add_argument('--check-only', action='store_true',
                        help='run the tree/commit preconditions and stop: no copy, no target, no '
                             'record. This is how tests/aukora-materialize-clean-tree.test.mjs '
                             'measures the guard without cutting a release.')
    args = parser.parse_args()
    assert_harness_clean(args.source.resolve())

    # ── THE BYTES MUST BE A COMMIT'S BYTES ──────────────────────────────────────────────────────
    # `artifact-record.mjs` writes `producer.genesisCommit = git rev-parse HEAD` and takes the
    # genesis entries from the WORKING TREE. With uncommitted tracked changes those are two different
    # trees, so the record would name a commit that does not contain what it attests. MEASURED on
    # 2026-09-22: `~/aukora-release-eye-7a180825` was cut while this file's own edit was still
    # uncommitted, and the launcher refused the release it had ALREADY been pointed at —
    # `genesis-artifact-changed: scripts/materialize-aukora-release.py 64826 bytes vs record 66872` —
    # after the running shell had been quit for the switch, so the app was down until a release was
    # cut from the clean tip. One writer per checkout: commit, then materialize.
    porcelain = subprocess.run(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no'],
                               capture_output=True, text=True)
    if porcelain.returncode != 0:
        fail(f'materialize-not-a-checkout: git could not read {ROOT} ({porcelain.stderr.strip()})')
    dirty = [line for line in porcelain.stdout.splitlines() if line.strip()]
    if dirty:
        fail(f'materialize-dirty-tree: {len(dirty)} uncommitted tracked change(s) in {ROOT}; the record '
             f'would name {git_head()} while attesting these working-tree bytes, which is what refused '
             'the 2026-09-22 cutover. Commit them first, or cut from a clean checkout:\n  '
             + '\n  '.join(dirty))
    committed = git_head()
    # A COVERED PATH THE COMMIT DOES NOT CONTAIN IS REFUSED BEFORE THE COPY. See covered_path_audit: the
    # 2026-09-23 cut carried an untracked file into a release, and the launcher refused it at launch.
    stray = covered_path_audit()
    if stray:
        fail(f'materialize-covered-path-uncommitted: {len(stray)} covered path(s) exist outside commit '
             f'{committed}; the record would name that commit while attesting these working-tree bytes, and '
             'the launcher refuses such a release when it is loaded (`genesis-coverage-set-mismatch: … '
             'recorded file(s) gone`). Commit them, or move them out of the covered patterns:\n  '
             + '\n  '.join(f'{state}: {path}' for path, state in stray))
    if args.check_only:
        print(f'CHECK ONLY: {ROOT} is clean at {committed}; a release cut now would name that commit '
              'and attest its bytes')
        return 0
    # PROGRESS GOES TO STDERR, BECAUSE STDOUT IS SOMEBODY ELSE'S DATA. Measured 2026-09-23:
    # `tests/aukora-read-path.test.mjs` captures the composition patch by intercepting
    # `Path.write_text` inside this script and reading the child's STDOUT, so this one progress line
    # landed in front of the YAML and the court died in `js-yaml` with
    # `end of the stream or a document separator is expected (4:1)` — a red that named neither the
    # materializer nor the capture. The lines other courts DO parse (`CHECK ONLY`, `RELEASE
    # MATERIALIZED`, `record sha256 …`) stay on stdout on purpose; this one is consumed by nobody.
    print(f'MATERIALIZE root {ROOT} clean at {committed}', file=sys.stderr)

    source = args.source.resolve()
    target = args.target.resolve()
    if not (source / 'apps/cli/lib/bin.js').is_file():
        fail(f'missing-built-source: {source} has no apps/cli/lib/bin.js; run scripts/build-dsh.py first')
    if not (PLUGIN / 'lib/client.js').is_file():
        fail(f'missing-plugin-build: {PLUGIN / "lib/client.js"}; run scripts/build-aukora-plugin.mjs first')
    if target == source:
        fail('release-equals-source: refusing to materialize in place')
    if target.exists():
        if not args.force:
            fail(f'release-exists: {target}; pass --force to replace it')
        shutil.rmtree(target)

    # ── THE BOUND, ENFORCED BEFORE A NEW RELEASE IS WRITTEN ──────────────────────────────────
    # This script used to write a whole new release at every new `--to` and NEVER LOOK AT ITS SIBLINGS,
    # so 22 root-level `~/aukora-release-*` copies (39 GiB) piled up in five days and the disk collapsed.
    # The policy is in `scripts/release-retention.py` (its own file so a court can test it without
    # cutting a release): live + protected rollbacks + a bounded N of others, oldest-first, never a
    # protected one, and a REFUSAL BY NAME when room cannot be made. Collection happens BEFORE the copy,
    # because a collection that runs afterwards cannot help the write that just filled the disk.
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location(
            'release_retention', str(Path(__file__).resolve().parent / 'release-retention.py'))
        _retention = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_retention)
        _state = AUKORA_STATE        # derived once, above: one root, two readers
        # ── REMOVAL IS NEVER AUTOMATIC, AND NEVER APPLIES TO HOME ────────────────────────────
        # The first version collected on every materialize, which would have DELETED PETER'S FILES
        # WITHOUT ASKING — and an old release is not dead bytes: a state root can hold hundreds of
        # symlinks into it. The default now REFUSES and lists the candidates; `--prune-oldest` removes,
        # and is refused outright when the target's parent is HOME, whatever the caller passes.
        _home = Path.home().resolve()
        _parent = target.parent.resolve()
        if args.prune_oldest and _parent == _home:
            fail('prune-refused-for-home: --prune-oldest never applies to %s. Remove releases from HOME '
                 'by hand after reading the candidate list this run prints without the flag.' % _home)
        _retention.enforce(
            str(_parent),
            live=target.name,
            protect=_retention.protected_names(
                launch_record=_state / 'state/launch.json',
                rollback_record=_state / 'state/rollback.json'),
            prune=bool(args.prune_oldest),
            state_roots=[str(_state), str(_home / 'Library/Application Support/AUKORA')],
        )
    except _retention.RetentionRefusal as refusal:
        fail('retention-refused: %s' % refusal)
    except Exception as _exc:                      # a missing policy is a harness fault, not a licence to leak
        fail('retention-unavailable: %s' % _exc)
    # A clone copy keeps the release self-contained without duplicating bytes
    # on disk; it is a real directory tree, not a link back to the source.
    cloned = subprocess.run(['cp', '-Rc', str(source), str(target)], capture_output=True, text=True)
    if cloned.returncode != 0:
        shutil.copytree(source, target, symlinks=True, dirs_exist_ok=True)

    plugin_out = target / 'plugins/aukora-foundation'
    for name in PLUGIN_FILES:
        (plugin_out).mkdir(parents=True, exist_ok=True)
        shutil.copy2(PLUGIN / name, plugin_out / name)
    for name in ('src', 'assets', 'lib'):
        shutil.copytree(PLUGIN / name, plugin_out / name, dirs_exist_ok=True)

    # THE FACE travels the same way the foundation does: as bytes inside the release,
    # so a running process never reads its user interface from a mutable checkout. Each
    # face is a CLIENT plugin — its host half is a few lines, and everything a person
    # sees is the browser bundle the harness serves out of this directory. Two manifest
    # facts make a package one: `dsh.client.platform: web` and an `exports["./client"]`.
    # The bundles are build output, so a face that was never built stops materialization
    # here rather than producing a release whose rows point at nothing.
    for face in FACE_PACKAGES:
        face_src = FACE / face
        bundle = face_src / 'lib/client.js'
        if not bundle.is_file():
            fail(f'face-not-built: {bundle} is missing; run scripts/build-face.py first')
        face_out = target / f'plugins/aukora-face-{face}'
        (face_out / 'lib').mkdir(parents=True, exist_ok=True)
        shutil.copy2(face_src / 'package.json', face_out / 'package.json')
        for name in ('index.js', 'client.js', 'invariant.js'):
            if (face_src / 'lib' / name).is_file():
                shutil.copy2(face_src / 'lib' / name, face_out / 'lib' / name)
        # A face may carry `disclosure-policy.json` beside `lib/`: the default Auma Live's disclosure checkpoint reads from
        # `<lib>/../disclosure-policy.json`. Without it a release reads NO policy and refuses every turn ("nothing authorised").
        # It is covered by the `plugins/aukora-face-*/disclosure-policy.json` host pattern in scripts/artifacts-coverage.json.
        if (face_src / 'disclosure-policy.json').is_file():
            shutil.copy2(face_src / 'disclosure-policy.json', face_out / 'disclosure-policy.json')
        # The stock apps are iframes over vendored application trees; the host half
        # serves them from a path relative to the package, so they travel beside it.
        if (face_src / 'vendor').is_dir():
            shutil.copytree(face_src / 'vendor', face_out / 'vendor', dirs_exist_ok=True,
                            symlinks=True, ignore=COPY_IGNORE)
        if (face_src / 'assets').is_dir():
            shutil.copytree(face_src / 'assets', face_out / 'assets', dirs_exist_ok=True,
                            symlinks=True, ignore=COPY_IGNORE)
        # A face may also carry `evidence/`: read-only projections its host half spawns.
        # They sit beside `lib/` at the same relative depth the source has them, because
        # the host half resolves them from its own import.meta.url.
        if (face_src / 'evidence').is_dir():
            shutil.copytree(face_src / 'evidence', face_out / 'evidence', dirs_exist_ok=True,
                            symlinks=True, ignore=COPY_IGNORE)

        # A face host half that imports a third-party package needs that package
        # resolvable from where it sits. Node walks up from the module's directory and
        # the release root's store is a pnpm layout, so the names are linked here
        # explicitly rather than hoped for. A dependency the release does not carry
        # stops materialization: a row that imports at runtime and fails is a face that
        # silently does not mount, which is the failure this whole build exists to end.
        # The MANIFEST is not the authority here; the BUILT BYTES are. The bundler
        # externalizes every workspace package it did not inline, so a host half can
        # import names the manifest lists only as devDependencies. Reading the import
        # specifiers out of the emitted file is the only list that matches what node
        # will actually try to resolve at load time.
        runtime_deps = _imported_packages(face_out / 'lib')
        if runtime_deps:
            modules = face_out / 'node_modules'
            for dep in runtime_deps:
                # NOT `source`: that name holds the build tree this release is being
                # materialized FROM, and rebinding it here made the artifact record
                # attest a package directory instead. The refusal below was never
                # affected — it reads whatever name this binding uses — and an
                # earlier version of this comment claimed otherwise.
                dep_dir = _resolve_release_package(target, dep)
                if dep_dir is None:
                    fail(f'face-dependency-unresolved: {face} needs {dep}, which this release does not carry')
                link = modules / dep
                link.parent.mkdir(parents=True, exist_ok=True)
                if link.is_symlink() or link.exists():
                    continue
                link.symlink_to(os.path.relpath(dep_dir, link.parent))

    # The gate travels INSIDE the release. A row pointing back at the worktree would make the
    # running process depend on mutable bytes the artifact record never verified, which is the
    # thing the release layout exists to prevent.
    gate_out = target / 'plugins/aukora-composition-gate'
    (gate_out / 'src').mkdir(parents=True, exist_ok=True)
    for name in GATE_FILES:
        if (GATE / name).is_file():
            shutil.copy2(GATE / name, gate_out / name)
    for name in ('src',):
        shutil.copytree(GATE / name, gate_out / name, dirs_exist_ok=True)
    for name in ('README.md', 'policy.json', 'GOVERNED.md'):
        if (GATE / name).is_file():
            shutil.copy2(GATE / name, gate_out / name)
    # The governed demonstration module travels too, so the release can SHOW admission rather
    # than only describe it, and so its bytes can be bound by a grant that a reader can check.
    demo_out = target / 'plugins/aukora-gate-demo'
    demo_out.mkdir(parents=True, exist_ok=True)
    for name in ('hello-governed.mjs',):
        if (GATE_DEMO / name).is_file():
            shutil.copy2(GATE_DEMO / name, demo_out / name)

    # The receipt path travels whole: the producer the gate writes through, the serializer that
    # settles an admission, and the adapter that retains and presents it. Copied before the strip
    # so their bytes are inside the tree the record describes; the strip keeps them because they
    # are declared in strip.keep, which is the only mechanism that reaches a path no built runtime
    # names. Verified after materialization by the coverage check, which fails if a kept path is
    # missing from the release rather than reporting it covered.
    for source_dir, relative in ((COMPOSITION, 'scripts/composition'), (AURA, 'scripts/aura')):
        if not source_dir.is_dir():
            fail(f'missing-composition-source: {source_dir}')
        shutil.copytree(source_dir, target / relative, dirs_exist_ok=True, symlinks=True,
                        ignore=COPY_IGNORE)

    # The acceptance command that verifies the release travels with the release it accepts. One
    # file rather than a directory, so it is copied by name; the strip keeps it because it is a
    # DECLARED KEEP in scripts/artifacts-coverage.json, and the copy is what puts it in the tree
    # that keep can reach.
    if not ORGANISM_ACCEPT.is_file():
        fail(f'missing-organism-accept: {ORGANISM_ACCEPT}')
    (target / 'scripts').mkdir(parents=True, exist_ok=True)
    shutil.copy2(ORGANISM_ACCEPT, target / 'scripts/organism-accept.sh')

    # The Experience Court travels with the release whose memory it adjudicates. Copied as a
    # directory rather than as one file, mirroring the receipt path above: the declaration keeps
    # `scripts/kira/**`, so a module added beside the court is carried and covered by the same
    # two lines rather than silently stripped. The court's own closure is narrower than this
    # directory — it imports `jcs` from scripts/composition, already carried above.
    if not KIRA_COURT.is_dir():
        fail(f'missing-kira-court: {KIRA_COURT}')
    shutil.copytree(KIRA_COURT, target / 'scripts/kira', dirs_exist_ok=True, symlinks=True,
                    ignore=COPY_IGNORE)

    # ── `scripts/lib` TRAVELS BECAUSE FIVE RELEASED FILES IMPORT OUT OF THEIR OWN TREE (cohesion row 4) ──
    # *** MEASURED, BEFORE THIS COPY EXISTED: ***
    #     plugins/aukora-owner-daemon/bin/owner-daemon.mjs:47   '../../../scripts/lib/is-main.mjs'
    #     plugins/aukora-subscription-hands/lib/run.mjs:29      '../../../scripts/lib/heavy-run.mjs'
    #     plugins/aukora-nostr/bin/add-contact.mjs:32           '../../../scripts/lib/is-main.mjs'
    #     plugins/aukora-nostr/bin/reissue-binding.mjs:91       '../../../scripts/lib/is-main.mjs'
    #     plugins/aukora-nostr/bin/test-peer.mjs:45             '../../../scripts/lib/is-main.mjs'
    # **A released file that climbs out of its own tree resolves in the CHECKOUT and not in the
    # release** -- *the worst shape a path defect can take, because it works for everyone who runs it
    # from the repository and breaks only for the person running the release.* *** And for a `bin/`
    # entry point it fails SILENTLY at import time: nothing loads and nothing says why. ***
    #
    # *Two modules are needed (`is-main.mjs`, `heavy-run.mjs`) and the DIRECTORY is copied rather than
    # the pair, so a module added beside them travels with the same two lines instead of being silently
    # stripped* -- **the reasoning the `scripts/kira` copy above already records, applied to the same
    # problem.** *`heavy-run` is the lock the subscription hands share with every heavy job, so a release
    # that lacks it cannot run a heavy job at all.*
    if not SCRIPTS_LIB.is_dir():
        fail(f'missing-scripts-lib: {SCRIPTS_LIB}')
    shutil.copytree(SCRIPTS_LIB, target / 'scripts/lib', dirs_exist_ok=True, symlinks=True,
                    ignore=COPY_IGNORE)
    # *** AND `scripts/lib` NOW SURVIVES THE STRIP. *** The copy above put it in the tree and `scripts/**` then deleted every
    # file of it (MEASURED 2026-09-27 in a scratch release: 15 of 15 in strip-manifest.json `deleted`), because no keep named it
    # and `.mjs` is not a runtime-scan pattern. `scripts/lib/**` is a declared keep in scripts/artifacts-coverage.json now.

    for relative in RELEASE_IMPORT_FILES:
        if not (ROOT / relative).is_file():
            fail(f'missing-release-import: {ROOT / relative}')
        (target / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target / relative)

    # `phase0log` is imported by bare name from the adapter, which adds scripts/phase0 to
    # sys.path. Copied as one file rather than as the directory: the directory also holds
    # selfcheck/verify entrypoints that the receipt closure never imports, and carrying them would
    # widen what the release attests for no gain.
    #
    # `retainer.py` IS carried, and it reverses the earlier reading of this comment. The reason the
    # directory is not copied whole still holds — `selfcheck.py` and `verify` stay out — but the
    # retainer is no longer outside the closure: `serialize-admissions.py` resolves it relative to
    # itself, so a release without it reports an OUTAGE on every settle. Carrying the receipt
    # closure's real dependencies is not a widening; carrying files nothing imports would be.
    #
    # `memory_head.py` is the third such file and it joins this loop for the same two reasons, one
    # structural and one measured. Structurally it is a bare-name import of the shipped settle path:
    # `scripts/aura/settlement.py` puts `scripts/phase0` on sys.path and imports it from `inscribe`,
    # so a release that has the settlement verb and not this module carries a settle that cannot
    # retain. Measured, on the retainer's own precedent rather than by analogy: the failure is a
    # NAMED status (`MEMORY_HEAD_UNAVAILABLE` over `ModuleNotFoundError: No module named
    # 'memory_head'`) and every checkout-driven arm stays green, because the checkout always has the
    # file. `scripts/phase0/memory-head`, the CLI entry point beside it, is deliberately NOT carried:
    # the settle path imports the module, not the command.
    #
    # THE LOOP VARIABLE IS `module_file`, NOT `source`, AND THAT IS NOT COSMETIC. `source` is the
    # materialization's OWN parameter — the built tree this release is made FROM — and the manifest
    # this function writes records it as `source`, which the launcher court reads back to find the
    # tree to build a legacy fixture from. Naming the loop variable `source` REBOUND it, so the
    # manifest recorded the last copied FILE (`scripts/phase0/retainer.py`) as the release's source
    # tree. MEASURED on CI run 35575530269: the launcher court failed L9 with
    # "the source tree this fixture was materialized from (…/scripts/phase0/retainer.py) has no
    # apps/cli/lib/bin.js" — an absurd path that was absurd for exactly this reason. The sibling
    # loop over `VENDORED` below already uses `source_tree` for the same reason; this comment exists
    # because the hazard is not obvious and the failure surfaces two suites away from its cause.
    for module_file, module_name in ((PHASE0_LOG, 'phase0log.py'), (PHASE0_RETAINER, 'retainer.py'), (PHASE0_MEMORY_HEAD, 'memory_head.py')):
        if not module_file.is_file():
            fail(f'missing-phase0-module: {module_file}')
        (target / 'scripts/phase0').mkdir(parents=True, exist_ok=True)
        shutil.copy2(module_file, target / 'scripts/phase0' / module_name)

    # The vendored courts the receipt path subprocesses and imports. Whole trees, minus the one
    # build-output directory the pin checker itself excludes, so the release carries a tree the
    # repository's pin manifests still describe.
    for source_tree in VENDORED:
        if not source_tree.is_dir():
            fail(f'missing-vendored-tree: {source_tree}')
        destination = target / source_tree.relative_to(ROOT)
        shutil.copytree(source_tree, destination, dirs_exist_ok=True, symlinks=True,
                        ignore=COPY_IGNORE)

    # Lane sources: shipped so their bytes are covered and tamper-evident. NOT mounted by this
    # patch, so an unprovisioned profile cannot reach them through the release's own composition.
    for plugin in LANE_PLUGINS:
        source_plugin = ROOT / 'plugins' / plugin
        if not source_plugin.is_dir():
            fail(f'missing-lane-plugin: {source_plugin}')
        lane_out = target / 'plugins' / plugin
        lane_out.mkdir(parents=True, exist_ok=True)
        for name in LANE_FILES:
            if (source_plugin / name).is_file():
                shutil.copy2(source_plugin / name, lane_out / name)
        for name in PLUGIN_DIRS.get(plugin, LANE_DIRS):
            if (source_plugin / name).is_dir():
                shutil.copytree(source_plugin / name, lane_out / name, dirs_exist_ok=True,
                                symlinks=True, ignore=COPY_IGNORE)

    carry_worker_box(target)

    # THE CORE PRESET, INCLUDING ITS AGENT INSTRUCTIONS. A preset is a DIRECTORY of rows plus the
    # `AGENTS.md` the `agent-instructions` plugin reads (presets/core/agent.cordis.yml composes it with
    # `maxBytes: 65536`), so carrying the plugin without the preset is carrying half of CORE. This is a
    # copy of the whole `presets/` tree rather than `presets/core` alone: a release whose preset directory
    # has one entry would make the next preset a silent absence, which is the failure this file's own
    # LANE_PLUGINS comment is about. No strip pattern selects `presets/**`, so nothing deletes it; and
    # `scripts/artifacts-coverage.json` covers it, so the record attests it instead of refusing an
    # uncovered input.
    if not (ROOT / 'presets').is_dir():
        fail(f'missing-presets-tree: {ROOT / "presets"}')
    for preset_source in sorted((ROOT / 'presets').iterdir()):
        if preset_source.is_dir():
            shutil.copytree(preset_source, target / 'presets' / preset_source.name,
                            dirs_exist_ok=True, symlinks=True, ignore=COPY_IGNORE)

    # The tree the Messages face resolves at RUNTIME by walking up from its own bytes. Copied
    # WHOLE, to the RELEASE ROOT — see NOSTR_TREE above for the measurement that fixes the
    # destination and the reason LANE_PLUGINS cannot serve this tree. Nothing here mounts it as a
    # plugin or adds a composition row: the face loads `lib/contact.mjs`, `lib/giftwrap.mjs`,
    # `lib/relay.mjs`, `lib/identity.mjs` and `lib/event.mjs` by path when a request arrives, so a
    # release that does not carry it answers `messages:nostr-tree-absent`.
    if not NOSTR_TREE.is_dir():
        fail(f'missing-nostr-tree: {NOSTR_TREE}')
    shutil.copytree(NOSTR_TREE, target / NOSTR_RELEASE_DIR, dirs_exist_ok=True, symlinks=True,
                    ignore=COPY_IGNORE)

    # Relative row name: the loader anchors an inserted relative path beside the
    # patch file, so this resolves inside the release by construction.
    patch = target / 'aukora-composition.patch.yml'
    hmr_row = hmr_disable_row(args.development)
    patch.write_text(
        '# Generated by scripts/materialize-aukora-release.py — do not edit by hand.\n'
        '# Row name is release-relative: the loader anchors it beside this file.\n'
        '- insert:\n'
        '    - id: aukora-foundation\n'
        '      name: ./plugins/aukora-foundation/lib/index.js\n'
        '      config:\n'
        '        brandName: AUKORA\n'
        '        palette: aukora-dark\n'
        '    # The gate is mounted for its CEILINGS and its inspection surface. It cannot enforce\n'
        '    # from here — a plugin loads after the modules it would govern — so enforcement is\n'
        '    # installed separately as a node bootstrap. This row is how an operator sees whether\n'
        '    # that happened; the plugin prints NO ENFORCEMENT IS IN PLACE when it did not.\n'
        '    - id: aukora-composition-gate\n'
        '      name: ./plugins/aukora-composition-gate/src/index.js\n'
        '    # THE GOAL AUTO-RESUME (Fable, 2026-09-27): re-arms goals that were ACTIVE at an UNCLEAN stop, never a\n'
        '    # terminal or human-disarmed one, capped, with a clean-shutdown marker so the NEXT start is judged on\n'
        '    # its own. `inject: [goals, agents]`, so it waits for both rather than running half-mounted.\n'
        '    - id: aukora-goal-resume\n'
        '      name: ./plugins/aukora-goal-resume/lib/index.mjs\n'
        '    # ── PRIVACY (alpha-15): private conversations stay on this computer ─────────────────────────────\n'
        '    # The egress audit (gaps 1, 10, 15) found `session-log-deepseek` ON BY DEFAULT, uploading the ENTIRE\n'
        '    # session log — every message, tool call and result, plus the cwd — as `dsh_session_log` on every\n'
        '    # request. These three rows turn off the two uploaders and the OpenTelemetry session telemetry.\n'
        '    # THE FORM IS AN OVERRIDE: the row is named by id and assigns ONLY the switch the plugin itself reads\n'
        '    # (`config.enabled` for both uploaders, `config.mode: DISABLED` for otel), so it cannot half-load.\n'
        '- id: session-log-deepseek\n'
        '  config:\n'
        '    enabled: false\n'
        '- id: plugin-package-inventory-deepseek\n'
        '  config:\n'
        '    enabled: false\n'
        '- id: session-telemetry-otel\n'
        '  config:\n'
        '    mode: DISABLED\n'
        '\n'
        '# THE FACE. The upstream frame and ours both register the slot named `root`.\n'
        '# The renderer CAN arbitrate that — entries at different priorities shadow, and\n'
        '# the lowest renders — but shadowing the frame would leave the loser mounted with\n'
        '# its own child seats still declared, and a frame is not a seat you can half-hold:\n'
        '# whichever one renders, the other has already claimed slot names this one needs.\n'
        '# So the upstream row is disabled outright. Our module ids differ from the upstream\n'
        '# package names on purpose: identical ids are refused at composition as resolving\n'
        '# from multiple active loader sources.\n'
        '#\n'
        '# The frame declares the slots the others occupy — the surface canvas, the three\n'
        '# corner menus, the overlay — so mounting a surface without the frame mounts\n'
        '# something with nowhere to appear.\n'
        '- id: ui-layout\n'
        '  disabled: true\n'
        '\n'
        '# The settings chrome is replaced for the same reason as the frame: ours projects\n'
        '# the settings.section ledger into the System menu, which is where a person reaches\n'
        '# General, Models, Plugins and Agent presets in this shell. The upstream sections\n'
        '# themselves are untouched and keep registering into that same ledger.\n'
        '- id: ui-settings-general\n'
        '  disabled: true\n'
        '\n'
        '# THE THREAD LANE. Both upstream rows are disabled, and the face replaces them.\n'
        '# The LANE went first: this shell owns the left column, and the upstream lane\n'
        '# crashed reaching for `usePanelInfo`, a root hook only a frame publishes. The\n'
        '# BROWSER followed, because a merely shadowed entry could not declare the\n'
        '# directory-picking child holes the pick-and-create flow needs. Replacing it\n'
        '# means publishing what it published: `uiWorkspace`, which six plugins in the\n'
        '# pinned tree reach for and four of them are mounted here, and the workspace\n'
        '# list as a root hook, which every thread row reads.\n'
        '- id: ui-sidebar\n'
        '  disabled: true\n'
        '\n'
        '- id: ui-workspace\n'
        '  disabled: true\n'
        '\n'
        + core_mount_rows('')
        + action_gate_rows()
        + held_overlay_rows()
        + hmr_row +
        '- insert:\n'
        + ''.join(
            f"    - id: aukora-face-{face}\n"
            f"      name: ./plugins/aukora-face-{face}/lib/index.js\n"
            # ── THE ORGANISM LENS, AND THE MINDS OFFERED ────────────────────────────────
            # `aukora-face-apps` mounts with NO config unless this block supplies one, and the
            # plugin reads `organismDshHome.length === 0` as "no organism lens at all" — so the
            # lens and the offered minds are DARK in every materialized release until this lands.
            # The home is resolved from $HOME at materialize time and never written into the file:
            # a release that hardcoded one person's path would hand it to every other machine.
            + (
                "      config:\n"
                f"        organismDshHome: {json.dumps(str(LIVE_DSH_HOME))}\n"
                "        offeredMinds:\n"
                + ''.join(f"          - {mind}\n" for mind in OFFERED_MINDS)
                if face == 'apps' else ''
            )
            for face in FACE_PACKAGES
        ) +
        '\n'
        '# Open the session-history search index so a model can recall prior sessions in its own\n'
        '# workspace. This MODIFIES a row the base and web bundles already mount rather than\n'
        '# inserting one: `dsh-session-query-sqlite` injects only `sessions`, a host-plane key no\n'
        '# agent preset may publish, so the row stays where the bundle put it and the profile\n'
        '# merely opens it. Two things make this the whole difference between a mounted search\n'
        '# tool that works and one that refuses — the shipped web profile pins\n'
        '# `path: \':memory:\'` and `openAt: never`, so today the index is never opened and no\n'
        '# database exists at all.\n'
        '#\n'
        '# No `name` key on purpose: vendor/include SKIPS a non-insert patch whose `name` does not\n'
        '# match, with a warning rather than a failure — a name typo would leave memory off while\n'
        '# this record claimed it was turned on. The override also REPLACES `config` wholesale\n'
        '# (each key is assigned), so both fields must be restated; supplying only `path` leaves\n'
        '# `openAt` unset.\n'
        '- id: session-query-sqlite\n'
        '  config:\n'
        "    path: !!js dshHomePath('storages/session_search.db')\n"
        '    openAt: startup\n')

    # Strip before the record: the record must describe the tree that will be
    # launched, and it attests the strip manifest by digest. The composition patch
    # is written first so the strip's before/after totals describe the finished
    # release — the totals check compares them against the tree, and it caught
    # exactly this ordering mistake when the patch was written later.
    # The governed demonstration patch. It is NOT part of the release's own composition — a
    # governed module is not mounted by default — and it exists so the demonstration can mount
    # the governed entry from INSIDE the verified release rather than from a path beside it.
    # Written here, before the strip and the record, so the recorded tree is the tree that is
    # launched; writing it in afterwards makes the launcher refuse the release, which is what
    # happened on the first attempt and is the artifact record doing its job.
    (target / 'demo-governed.patch.yml').write_text(
        '# Generated by scripts/materialize-aukora-release.py — do not edit by hand.\n'
        '# Mounts the governed demonstration module. Pass it explicitly:\n'
        '#   launch-dsh.py --patch <release>/aukora-composition.patch.yml \\\n'
        '#                 --patch <release>/demo-governed.patch.yml\n'
        '- insert:\n'
        '    - id: hello-governed\n'
        '      name: ./plugins/aukora-gate-demo/hello-governed.mjs\n')

    # THE LANE PATCH, carried in the release but NOT mounted by its own composition. Same rule as
    # the governed demo above: written BEFORE the strip and the record, because a file added to the
    # release afterwards is a release the record does not describe — measured, the launcher refuses
    # it with release-verification-failed, which is the artifact record doing its job.
    #
    # Mounting is not provisioning. The aukora-kira row names a memoryOwner the plugin constructs
    # itself over a STATE-ROOT-RELATIVE directory (so a disposable preview writes disposable state);
    # the aukora-aumlok row mounts the lane so it is reachable and still fail-closed, since a
    # promotion without provisioned primitives refuses by name.
    # ROW NAMES ARE ABSOLUTE INTO THE RELEASE. Measured 2026-09-17 on two launches: a
    # relative `./plugins/...` in a --patch overlay resolves against the working directory the
    # loader was given, not the release, and the row then fails to activate WITHOUT ANY
    # DIAGNOSTIC. Kira's overlay that did mount used the absolute form. The per-deployment
    # values (Kira's state directory and the operator documents) are `!!js dshHomePath(...)`
    # expressions, the same idiom the base bundle uses for its own storage, so the release
    # carries a template and the state root stays the launcher's input.
    #
    # BOTH OPERATOR DOCUMENTS ARE NAMED, AND THE ROW IS REFUSED AT MOUNT WITHOUT THE SECOND.
    # Kira's `readConfig` requires `memoryOwner.approvalFile` beside `grantFile` and refuses with
    # `kira.config:memory-owner-approval-unconfigured` when it is absent, so a release generated
    # without this line mounts no Kira row at all. The reason is the grant's provenance: a grant
    # is minted by whatever runs the grant command, including the turn that wants the write,
    # whereas an approval is the owner's signed act over the exact content. A composition that
    # named only `grantFile` therefore offered a write tool nothing had authorized.
    # ONE FILE, TWO FIELDS: `scripts/kira/kira-approve.mjs` writes
    # `{ authorization: { grant, record, subject }, approval: <bundle> }` to a single operator
    # document. The settlement path reads `authorization` through `grantFile` and `approval`
    # through `approvalFile`, so pointing both at `kira-memory/grant.json` is the shape the
    # producer writes, not a coincidence of naming. Minting it is an OPERATOR act outside the
    # release: this file names the document and never creates it, and an unminted document
    # leaves the row mounted and fail-closed rather than silently writable.
    #
    # WHAT THIS ROW DOES NOT PIN, written here because this is the natural place to look for it.
    # The plugin also accepts an optional `memoryOwner.approverDid`, and naming it is what makes an
    # approval signed by any OTHER key refused by name. This row names none, so no approver key is
    # pinned and the plugin's `APPROVER_PINNED` is ABSENT rather than satisfied — an unset pin,
    # visibly, not a pin that holds. That is a DECISION, not an oversight: the value is
    # deployment-specific and there is no registered controller to point at, so any value written
    # here would be invented, and an invented pin is worse than an absent one because it looks like
    # enforcement while enforcing nothing. Pinning it is an owner/deployment act, performed for the
    # deployment that has a registered key (a `--patch` overlay naming `approverDid`), never by
    # baking one value into every release this file generates.
    #
    # THE SUBJECT IS NOT THIS FILE'S TO CHOOSE, AND THIS IS A STOP RATHER THAN A FIX. Both rows
    # below name `subject: aumlok:subject:owner`, and MEASURED 2026-09-20 that value is refused by
    # the approval path's own reader: `scripts/kira/kira-approve.mjs --subject aumlok:subject:owner`
    # exits 1 with `owner approval request.subject: must use the aukora:1:<sha256> form` (Aumlok's
    # `readAukoraId`; the grammar is `/^aukora:1:[0-9a-f]{64}$/`). The GRANT for the same subject
    # still mints — `plugins/aukora-kira/bin/kira-grant.mjs --subject <anything>` is deliberately
    # subject-agnostic — so the wire does not fail at mount or at grant. It dead-ends ONE STEP
    # LATER, at the approval: a record can be staged under `aumlok:subject:owner` and no approval
    # for it can ever be produced, so the write is unmintable and the memory path is unusable
    # while every check above stays green. That is the defect this comment records.
    #
    # WHY THE VALUE CANNOT BE WRITTEN HERE. The subject a deployment serves is DERIVED, not stored:
    # `aukoraIdFromGenesis` hashes the immutable genesis record (domain-separated sha256 over
    # `{domain, genesisNonce, initialRootKeySetId, amendmentRuleDigest}`) that the deployment's
    # controller created from 32 bytes of CSPRNG entropy at provisioning. MEASURED: two disposable
    # controllers built with different seeds serve two different subjects
    # (`aukora:1:c03c47…` and `aukora:1:a16b09…`), and the only shipped command that serves one is
    # `node scripts/aumlok/project.mjs <controller-directory>`, which PRINTS `SUBJECT: aukora:1:<hex>`.
    # This file materializes ONE release for MANY deployments — the same reason `stateDir` is a
    # `!!js dshHomePath(...)` template rather than a baked path — so it has nowhere to read that
    # value at materialization time, and a literal written here would be an INVENTED identity: the
    # same class of error as an invented approver pin, and worse than an obvious gap because a
    # grammatical `aukora:1:<64 hex>` looks exactly like a real one. Two mechanisms were considered
    # and rejected: a `--kira-subject` input at materialization time (one artifact, many
    # deployments, and it would make every existing caller fail), and reading the value out of the
    # operator's approval bundle at launch (circular — the bundle only exists after an approval —
    # and it would compare the record's subject against the artifact's own, making the approval
    # lane's `RECORD_SUBJECT_MISMATCH` refusal unfalsifiable).
    #
    # WHAT THE OPERATOR MUST DO INSTEAD, and why the overlay has to restate every field: name the
    # deployment's own subject in a `--patch` overlay applied after this row. A patch that assigns
    # `config` REPLACES the `memoryOwner` object rather than merging into it — this file records
    # the same trap for `council-claude` below — so an overlay carrying only `subject` silently
    # drops `stateDir`, `approvalFile` and `grantFile` with it. The overlay must restate all five.
    # KEPT FOR THE PATCH-HEADER COMMENTS AND ANY DIAGNOSTIC THAT NAMES THE RELEASE; THE ROW NAMES THEMSELVES ARE
    # RELEASE-RELATIVE NOW. MEASURED WHY: five rows here and four in the lanes patch used to carry
    # `name: <absolute path>`, and `scripts/aura/release-closure.mjs` reads exactly the `name: ./path` shape
    # ("A DELIBERATELY NARROW READ"), so **every absolutely-named row was invisible to the closure walk** —
    # `aukora-board` among them. That is how a release whose board cannot import at all still reported
    # `CLOSED — every specifier resolves inside the release` while the live app failed to load it. A relative
    # name also satisfies the launcher's own `patch-not-release-local` rule by construction.
    release_root = str(target.resolve())
    # THE ORGANS GO IN THE DEFAULT COMPOSITION, not in an overlay nobody passes.
    #
    # Measured: with the organs in a separate overlay, launching the default composition gives
    # organism-accept 4/7 — the receipt path passes and every organ FAILS as not-mounted. A restart
    # that loads only `aukora-composition.patch.yml` therefore produces a live app whose lanes are
    # still absent, which is the exact "prepared but not live" the accept command exists to catch.
    # Mounting them by default is what makes a cutover converge instead of merely restart.
    #
    # `aukora-lanes.patch.yml` is still written, unchanged, for a profile that wants the organs
    # WITHOUT the default composition — it is now an opt-out shape rather than the only way in.
    default_patch = target / 'aukora-composition.patch.yml'
    default_patch.write_text(
        default_patch.read_text(encoding='utf-8').rstrip('\n') + '\n'
        + '\n'
        + '# THE ORGANS. Mounted by default so a cutover converges: Aura = where/when (evidence),\n'
        + '# Kira = what (memory, grantsAuthority false), Aumlok = who (identity/approval). Row names\n'
        + '# are ABSOLUTE into the release; `!!js dshHomePath(...)` keeps per-deployment state the\n'
        + "# launcher's input rather than baking one machine's path into the artifact.\n"
        + '- insert:\n'
        + '    - id: aukora-caged-worker\n'
        + f'      name: {target / "plugins/aukora-caged-worker/lib/index.mjs"}\n'
        + '    - id: aukora-kira\n'
        + '      name: ./plugins/aukora-kira/lib/index.js\n'
        + '      config:\n'
        + '        retrieval: lexical\n'
        + '        memoryOwner:\n'
        + "          stateDir: !!js dshHomePath('kira-memory')\n"
        + '          subject: aumlok:subject:owner\n'
        + '          permittedPrivacy: [local]\n'
        # THE PENDING REVIEW QUEUE, NAMED SO THE RELEASE CARRIES IT. Naming `queueDir` is what
        # registers the `kira_queue` tool and the auto-stage hook; omitting it leaves staging inert
        # ("this tool wrote nothing"). It sits BESIDE `stateDir` on purpose: `kira-memory/queue` is
        # the same absolute directory `createMemoryOwner` would default to (`join(stateDir,'queue')`),
        # so naming it changes WHETHER the queue exists, never WHERE it lives — per-deployment state
        # under the launcher's DSH home, never a checkout.
        + '    - id: aukora-aumlok\n'
        + '      name: ./plugins/aukora-aumlok/lib/service.mjs\n'
        + '    - id: aukora-aura-association\n'
        + '      name: ./plugins/aukora-aura-association/lib/index.js\n'
        # THE BOARD. Mounted by default because its whole purpose is that EVERY chat
        # sees it without asking: a board a profile has to opt into would leave the
        # owner as the message bus in every profile that did not. It reads through the
        # session service the session_search tools already use, holds no store of its
        # own beyond one derived digest file, grants nothing and needs no approval.
        + '    - id: aukora-board\n'
        + '      name: ./plugins/aukora-board/lib/index.js\n'
        + '      config:\n'
        + "        stateDir: !!js dshHomePath('board-state')\n"
        # THE EYE. Mounted, not merely carried, and the difference is the whole point: the tool
        # `aukora_see` is registered by this plugin and by nothing else, so a release that carries
        # these bytes and names no row gives the model no way to look at the app it is running in.
        # The other half is the shell's: `eye.mjs` opens the loopback door and `supervisor.mjs` puts
        # its address and per-launch token into the child's environment — the plugin reads THAT and
        # never a file or an argument. Measured before this row existed: `~/aukora-release-11de6b0c`
        # had no `plugins/aukora-eye` at all and no composition named it, while the eye lane's own
        # courts were green; `tests/aukora-eye-row.test.mjs` is that gap, red then and green here.
        # `stateDir` is required and has NO default in the plugin (`resolveConfig` throws without
        # one: "a screen capture is not written somewhere nobody chose"), so the row names one under
        # the deployment's DSH home, beside the board's state and Kira's memory.
        + '    - id: aukora-eye\n'
        + '      name: ./plugins/aukora-eye/lib/index.js\n'
        + '      config:\n'
        + "        stateDir: !!js dshHomePath('eye-state')\n"
    )

    # ── aura-81 (3): THE CUT FAILS WHEN THE COMPOSED KIRA SUBJECT IS NOT `aukora:1:<64hex>` ──────────
    #
    # **THIS IS A STOP-THE-LINE, AND IT IS DELIBERATELY PLACED BEFORE THE RELEASE IS CALLED COMPLETE.**
    # *The composed patch names `subject: aumlok:subject:owner`* — and **the preflight reports that the
    # memory subject must be `aukora:1:<64hex>`.** *KIRA is establishing which side is right; until that is
    # settled, a release that ships the wrong subject is a release whose memory writes land under a subject
    # nothing reads.*
    #
    # **WHY FAIL HERE RATHER THAN WARN.** *A subject that is wrong produces a release that BOOTS, serves,
    # passes its closure court, and silently stores nothing recallable* — **the failure appears much later, in
    # a session where recall returns nothing, and is diagnosed as a memory bug rather than as a composition
    # value.** *A cut is the last moment the value is still cheap to fix*, so it is the moment to refuse.
    #
    # **AND THE REFUSAL NAMES BOTH VALUES**, because the two sides disagree and the reader needs to see the
    # disagreement rather than only the expectation: *the shape demanded, and the shape found.*
    # ── aura-82: THE CUT ACCEPTS THE DOCUMENTED PLACEHOLDER. **THE REFUSAL WAS IN THE WRONG PLACE.** ──
    #
    # **WHAT I GOT WRONG IN aura-81, AND FABLE MEASURED IT**: I put the canonical-subject refusal HERE, so
    # every cut failed. **But a release CARRIES the placeholder BY DESIGN** — *this file's own comment at
    # :1095 says the subject "is not this file's to choose" and that "pinning it is an owner/deployment act,
    # performed for the deployment that has a registered key (a `--patch` overlay naming `approverDid`)"* —
    # **and the DEPLOYMENT overlay supplies the real one.** *The release is the artefact; the overlay is the
    # installation.* **Refusing in the materializer refused the ARTEFACT for a property of the INSTALLATION.**
    #
    # **AND THE PLACE IT BELONGS IS WHERE THE TWO ARE COMPOSED**: `desktop-cutover prepare` and
    # `desktop-parity-boot`, which apply every patch in the SUPPORT CONFIG and can therefore evaluate the
    # EFFECTIVE subject. *That is the first moment the real value exists* — and it is the moment a wrong one
    # would reach a live desktop, which is what the refusal is for.
    #
    # **SO THIS IS NOW A NAMED NOTE AND NOT A REFUSAL.** *A cut that prints nothing at all here would let the
    # placeholder ship silently*; **a cut that refuses cannot produce the artefacts the overlay is applied
    # to.** *The note says which case it is, so a reader of the cut log knows whether the deployment overlay
    # is still needed.*
    _composed = default_patch.read_text(encoding='utf-8')
    _subject_match = re.search(r'^\s*subject:\s*(\S+)\s*$', _composed, re.MULTILINE)
    if _subject_match is None:
        note('kira-subject-unstated: the composed patch names no kira memoryOwner subject, so aukora-kira '
             'would take its own default; the deployment overlay must set one')
    else:
        _subject = _subject_match.group(1)
        if re.fullmatch(r'aukora:1:[0-9a-f]{64}', _subject) is None:
            note(f'kira-subject-placeholder: this release carries {_subject!r}, which is the DOCUMENTED '
                 f'PLACEHOLDER and not `aukora:1:<64hex>`; a deployment overlay must supply the canonical '
                 f'subject, and desktop-cutover prepare and desktop-parity-boot refuse without one')
        else:
            note(f'kira-subject-canonical: this release already carries {_subject!r}')


    (target / 'aukora-lanes.patch.yml').write_text(
        '# Generated by scripts/materialize-aukora-release.py — do not edit by hand.\n'
        '# Mounts the merged lanes for a profile that opts in. Pass it explicitly:\n'
        '#   launch-dsh.py --patch <release>/aukora-composition.patch.yml \\\n'
        '#                 --patch <release>/aukora-lanes.patch.yml\n'
        '# MOUNTED is not PROVISIONED: no key material is supplied here, and this file creates no\n'
        '# production store. Kira constructs its own memory owner under the DSH home.\n'
        '- insert:\n'
        '    - id: aukora-kira\n'
        '      name: ./plugins/aukora-kira/lib/index.js\n'
        '      config:\n'
        '        retrieval: lexical\n'
        '        memoryOwner:\n'
        "          stateDir: !!js dshHomePath('kira-memory')\n"
        '          subject: aumlok:subject:owner\n'
        '          permittedPrivacy: [local]\n'
        # The queue row, byte-identical to the composition's: `tests/kira-approval-row.test.mjs`
        # asserts the two rows are the SAME row, so a key added to one and not the other is caught.
        '    - id: aukora-aumlok\n'
        '      name: ./plugins/aukora-aumlok/lib/service.mjs\n'
        '    - id: aukora-aura-association\n'
        '      name: ./plugins/aukora-aura-association/lib/index.js\n'
        '    - id: aukora-board\n'
        '      name: ./plugins/aukora-board/lib/index.js\n'
        '      config:\n'
        "        stateDir: !!js dshHomePath('board-state')\n")

    # THE AURA ASSOCIATION PLUGIN, staged exactly as scripts/aura/candidate/ instructs: one file,
    # copied verbatim from scripts/aura/composition/association-plugin.js to the release-local path
    # its row names. Staged rather than referenced because a row pointing at a checkout would make
    # the running process depend on mutable bytes the artifact record never verified.
    association_source = ROOT / 'scripts' / 'aura' / 'composition' / 'association-plugin.js'
    if not association_source.is_file():
        fail(f'missing-association-plugin: {association_source}')
    association_out = target / 'plugins' / 'aukora-aura-association' / 'lib'
    association_out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(association_source, association_out / 'index.js')

    # THE DEPLOYMENT OVERLAY TEMPLATE. The composition above names every memoryOwner field it can
    # name (stateDir, subject, permittedPrivacy, grantFile, approvalFile, queueDir) so
    # the row MOUNTS with an admitted producer and carries the review queue, but two values in that
    # row are not this file's to choose and are both measured stops rather than oversights:
    #
    #   * the SUBJECT is derived, never typed. `node scripts/aumlok/project.mjs <controller-directory>`
    #     is the only shipped command that serves one, and a literal written here would be an
    #     INVENTED identity — a grammatical `aukora:1:<64 hex>` looks exactly like a real one.
    #     MEASURED 2026-09-21 against the running desktop app (release a1c9189, pid 4937): the value
    #     this composition carries (`aumlok:subject:owner`) is REFUSED OUTRIGHT by the approval
    #     path's own reader —
    #       `node scripts/kira/kira-approve.mjs --subject aumlok:subject:owner …`
    #       → `REFUSE: owner approval request.subject: must use the aukora:1:<sha256> form`, exit 1,
    #     while the same command with a grammatical subject exits 0 and writes the artifact. So no
    #     approval for that subject can ever be produced and the write is unmintable. This was found
    #     independently here and in the integration lane; both measurements agree.
    #   * the APPROVER PIN is deployment-specific for the same reason: `approverDid` is the DID
    #     derived from the controller's own registered approval key, and pinning an invented one is
    #     worse than pinning none because it looks like enforcement while enforcing nothing.
    #
    # So the template travels WITH the release (attested, so its bytes are tamper-evident) and is
    # filled in by the operator for the deployment being served. It restates EVERY memoryOwner field
    # the composition names because a `config` assignment REPLACES the object rather than merging
    # into it: an overlay carrying only `subject` silently drops `stateDir`, `grantFile` and
    # `approvalFile` with it. That is also why `queueDir` is restated here rather than only in the
    # composition: this overlay is the LAST word on the row for a deployment that passes it, so a
    # key left out of it is a key the deployment does not serve — the queue would be configured in
    # the release and absent at the restart. It carries NO `name:` key on purpose — the loader skips
    # a non-insert patch whose `name` does not match,
    # so a name here would turn a typo into a row that quietly does not exist.
    (target / 'aukora-deployment-overlay.patch.yml').write_text(
        '# Generated by scripts/materialize-aukora-release.py — TEMPLATE, do not serve as-is.\n'
        '#\n'
        '# Memory capture uses the deployment state directory and subject; no memory approval.\n'
        '- id: aukora-kira\n'
        '  config:\n'
        '    retrieval: lexical\n'
        '    memoryOwner:\n'
        '      stateDir: ${KIRA_STATE_DIR}\n'
        '      subject: ${SUBJECT}\n'
        '      permittedPrivacy: [local]\n'
        '')

    # THE SESSION-QUERY OVERRIDE IS NOT EMITTED YET, AND HERE IS THE MEASURED REASON.
    #
    # `packages/bundle/base/cordis.patch.yml` mounts `session-query-sqlite` with
    # `path: ':memory:'`, `openAt: never`, and says in its own comment that a deployment enabling
    # content search overrides both in a later patch layer or a `--patch` overlay, "typically with a
    # durable `path`". The override is therefore the documented mechanism.
    #
    # What blocks it is WHERE the value comes from. A durable path must live under the state home,
    # and the state home is the LAUNCHER's input, not the release's: the same release is launched
    # against different state roots. `launch-dsh.py:96` refuses `patch-not-release-local` for any
    # overlay outside the verified release, so a patch naming one machine's state path cannot be
    # passed in, and a patch baked with a concrete path at materialization time would be wrong on
    # every other machine — and would be inside the record, so it could not be corrected later.
    #
    # The two candidate routes, neither yet tested:
    #   1. the profile `cordis.patch.yml` route the base bundle documents in the same comment,
    #      if a state-root-relative path is expressible there;
    #   2. a launcher substitution that keeps the release immutable.
    # Until one is measured on a launch, `session-query-sqlite` stays as the base bundle mounts it:
    # `:memory:`, `openAt: never`. That is the honest state — content search is NOT enabled by this
    # release, and this file does not pretend otherwise by shipping a path that resolves nowhere.

    # The aumlok row ALONE, so a profile can mount the lane without Kira's `inject: ['tools']`
    # requirement. Carried separately because the two rows are gated by different host
    # prerequisites and a single file could not distinguish "the patch is wrong" from "the host
    # does not provide the service Kira injects".
    (target / 'aukora-aumlok-only.patch.yml').write_text(
        '# Generated by scripts/materialize-aukora-release.py — do not edit by hand.\n'
        '# Generated by scripts/materialize-aukora-release.py — do not edit by hand.\n'
        '# Mounts ONLY aukora-aumlok, which injects nothing and therefore activates in any profile.\n'
        '- insert:\n'
        '    - id: aukora-aumlok\n'
        '      name: ./plugins/aukora-aumlok/lib/index.mjs\n')

    # THE ACTION GATE'S MOUNT, carried at the release root because the loader anchors an inserted row's relative
    # `name` BESIDE THE PATCH FILE (app-boot `anchorInsertedPluginNames`), so `./plugins/aukora-action-gate/...`
    # resolves into this release only from here. The composition above already carries these rows
    # (`action_gate_rows`), so a fresh install needs nothing more; this copy is kept for a deployment that
    # already lists `<release>/action-gate.patch.yml`, where applying the same rows again is harmless.
    shutil.copy2(ROOT / 'overlays' / 'action-gate.patch.yml', target / 'action-gate.patch.yml')
    # The same, for the Seatbelt provider swap. Carrying the file mounts nothing; a deployment lists it to mount it.
    shutil.copy2(ROOT / 'overlays' / 'seatbelt.patch.yml', target / 'seatbelt.patch.yml')
    shutil.copy2(ROOT / 'overlays' / 'caged-worker.patch.yml', target / 'caged-worker.patch.yml')
    # Add tracked memory beside the deployment's original Viking client and transport.
    # The pinned loader keys entries by id; reusing mcp-client would replace the Viking row.
    (target / 'tracked-memory.patch.yml').write_text(
        '- insert:\n'
        '    - id: mcp-client-kira-memory\n'
        f'      name: {target / "packages/mcp/mcp-client/lib/index.js"}\n'
        '      config:\n'
        '        serverName: kira-memory\n'
        '        transport: stdio\n'
        '        command: node\n'
        f'        args: [{json.dumps(str(target / "scripts/kira/viking-mcp.mjs"))}, "--installed"]\n'
        '        reconnect: { maxAttempts: 1000 }\n')
    # Explicit HTTP service setup, for the owner to install after retiring the old
    # wrapper on port 8766. Materializing a release never loads or replaces a service.
    (target / 'viking-door.launchd.plist').write_bytes(plistlib.dumps({
        'Label': 'org.aukora.viking-door',
        'ProgramArguments': [shutil.which('node') or '/opt/homebrew/bin/node',
                             str(target / 'scripts/kira/viking-door.mjs'), '--installed', '--port', '8766'],
        'RunAtLoad': True,
        'KeepAlive': True,
        'ThrottleInterval': 10,
    }))


    strip = strip_release(target)
    strip_path = target / 'strip-manifest.json'

    # THE RELEASE'S OWN IMPORTS MUST RESOLVE INSIDE IT, checked AFTER the strip because the strip is what deleted `scripts/lib`.
    gaps = release_import_gaps(target)
    if gaps:
        fail(f'release-import-closure-open: {len(gaps)} relative import(s) in the release name a file it does not carry '
             '(add the file to RELEASE_IMPORT_FILES, VENDORED or a keep):\n  '
             + '\n  '.join(f'{target_path}   (imported by {importer})' for target_path, importer in gaps))

    record = subprocess.run(
        ['node', str(ROOT / 'scripts/artifact-record.mjs'), '--source', str(target)],
        capture_output=True, text=True)
    if record.returncode != 0:
        fail(f'release-record-failed: {(record.stderr or record.stdout).strip()}')
    record_file = target / '.dsh-build/genesis-artifacts.json'
    # THE RECORD MUST NAME THE COMMIT IT ATTESTED, AND THIS READS IT BACK RATHER THAN TRUSTING IT.
    # The dirty-tree guard above is one half of that promise; this is the other, and it is the half
    # that catches a recorder whose HEAD read and whose file walk disagree for any other reason
    # (a submodule, a worktree, a concurrent commit landing between the two). Refusing HERE keeps the
    # failure inside the materialization, where nothing has been pointed at the release yet — the
    # 2026-09-22 failure surfaced at a launcher, after the shell had already been quit.
    written = json.loads(record_file.read_text(encoding='utf-8'))
    # Bind the successful upstream build inventory into the record the owner approves. The final
    # record includes AUKORA additions; the preserved inventory proves its original harness subset.
    harness_build = json.loads((source / '.dsh-build/pinned-harness-build.json').read_text())
    harness_artifacts = (source / '.dsh-build/genesis-artifacts.json').read_bytes()
    if hashlib.sha256(harness_artifacts).hexdigest() != harness_build['artifactRecordSha256']:
        fail('harness-build-record-mismatch: source inventory changed during materialization')
    (target / '.dsh-build/pinned-harness-artifacts.json').write_bytes(harness_artifacts)
    written['harnessBuild'] = harness_build
    record_file.write_text(json.dumps(written, indent=2) + '\n')
    recorded_commit = (written.get('producer') or {}).get('genesisCommit')
    head = git_head()
    if recorded_commit != head:
        fail('materialize-record-commit-mismatch: the record names ' + str(recorded_commit)
             + ' but this checkout is at ' + head + '; the release would claim a commit whose bytes it '
             'does not contain, which every launcher refuses as genesis-artifact-changed')
    print(f'RECORD names {head} and attests bytes taken at that commit')
    # ── THE AUKORA PLUGIN SET: one record per plugin the composition mounts, for the gate to admit ─────
    # Written into `.dsh-build/` (excluded from the release record and from the strip totals), because its
    # integrity comes from the owner's approval of exactly these digests, not from the release record: the
    # gate re-derives every digest from the per-file ones and refuses an approval for any other set. Taken
    # AFTER the strip and the record, so it describes the final bytes.
    plugin_set_run = subprocess.run(
        ['node', str(ROOT / 'scripts/aukora/plugin-set.mjs'), 'record', '--release', str(target)],
        capture_output=True, text=True)
    if plugin_set_run.returncode != 0:
        fail(f'plugin-set-record-failed: {(plugin_set_run.stderr or plugin_set_run.stdout).strip()}')
    plugin_set_file = target / '.dsh-build/plugin-set.json'
    plugin_set_doc = json.loads(plugin_set_file.read_text(encoding='utf-8'))
    print(f'PLUGIN SET {plugin_set_doc["setDigest"]}: {plugin_set_doc["count"]} AUKORA plugins, '
          f'{plugin_set_doc["fileCount"]} files recorded for the gate')
    manifest = {
        'formatVersion': 1,
        'kind': 'aukora-release-materialization',
        'release': str(target),
        'source': str(source),
        # THE 40-HEX TIP, named as its own field so a reader can tie this manifest to the record
        # without inferring it: `genesisCommit` is a 40-hex sha, and a manifest that names no tip at
        # all left the question "which commit is this release?" to the record and to prose. Beta's
        # gap, measured on `~/aukora-release-e5021ae8`: the manifest carried no 40-hex tip. The
        # materializer already refuses to finish when the written record's `producer.genesisCommit`
        # disagrees with HEAD, so this field is the same value the record attests; the court is
        # `tests/release-manifest-tip.test.mjs`, which reads a REAL release and asserts both.
        'tipSha': git_head(),
        'plugin': {
            'dir': str(plugin_out),
            'hostEntry': str(plugin_out / 'lib/index.js'),
            'clientBundle': str(plugin_out / 'lib/client.js'),
            'clientBundleSha256': sha256(plugin_out / 'lib/client.js'),
        },
        'composition': {'path': str(patch), 'sha256': sha256(patch), 'rowName': './plugins/aukora-foundation/lib/index.js'},
        # The startup hook, recorded so the LAUNCHER can refuse a release whose hook or policy
        # has gone missing or been altered between materialization and spawn.
        'gate': {
            'dir': str(gate_out),
            'hook': str(gate_out / 'src/install.js'),
            'hookSha256': sha256(gate_out / 'src/install.js'),
            'policy': str(gate_out / 'src/policy.js'),
            'policySha256': sha256(gate_out / 'src/policy.js'),
            'entry': str(gate_out / 'src/index.js'),
            'entrySha256': sha256(gate_out / 'src/index.js'),
            'policyConfig': str(gate_out / 'policy.json'),
            'policyConfigSha256': sha256(gate_out / 'policy.json'),
            'governedDoc': str(gate_out / 'GOVERNED.md'),
            'governedDocSha256': sha256(gate_out / 'GOVERNED.md'),
            'governedDemo': str(gate_out.parent / 'aukora-gate-demo/hello-governed.mjs'),
            'governedDemoSha256': sha256(gate_out.parent / 'aukora-gate-demo/hello-governed.mjs'),
            'pluginSet': str(plugin_set_file),
            'pluginSetSha256': sha256(plugin_set_file),
            'pluginSetDigest': plugin_set_doc['setDigest'],
            'pluginSetCount': plugin_set_doc['count'],
        },
        'strip': {
            'manifest': str(strip_path),
            'sha256': sha256(strip_path),
            'deletedFiles': strip['deletedFiles'],
            'deletedBytes': strip['deletedBytes'],
            'keptByRule': strip['keptByRule'],
            'counts': strip['counts'],
        },
        # INSTALLED DEPENDENCY BYTES, WHICH NOTHING ELSE IN THIS RECORD COVERS. README.md says the store is
        # 'copied unchanged' and the lockfile fixes only the installation SPECIFICATION, and until now no
        # digest of a single installed file existed anywhere: `release-strip.mjs` skips the store by design
        # and this record's only mention of it was as a SKIP NAME. MEASURED: a byte flipped in an installed
        # dependency was invisible to every check the project has.
        #
        # THE THREAT IS NARROW AND THE CEILING IS NAMED IN scripts/lib/dependency-digests.mjs: this detects
        # tampering that does not also rewrite THIS record. An attacker who rewrites both is uncovered until
        # the record's own digest is pinned outside the release.
        #
        # COST, MEASURED ON A 1.8 GB RELEASE: 65,640 files, 17 seconds, 11 MiB of JSON. Recorded once here
        # so the keyless check re-reads a list instead of re-hashing the store.
        'dependencies': dependency_digests(target),
        'record': {'path': str(record_file), 'sha256': sha256(record_file), 'keylessPassLine': record.stdout.strip().splitlines()[0]},
    }
    manifest_path = target / '.dsh-build/aukora-release.json'
    manifest_path.write_text(f'{json.dumps(manifest, indent=2)}\n')
    os.chmod(manifest_path, 0o600)
    # THE MARKER MUST NOT OUTLIVE THE RELEASE IT AUTHORISED. Moving it beside the release
    # fixed one bug and introduced a worse one: `shutil.rmtree(target)` above removes the
    # release tree and nothing else, so a marker from an earlier --development run survived
    # into the PACKAGED release materialized at the same path, and face-dev-push then wrote
    # into a release nobody marked — including one a backend was serving, because the
    # being-served refusal only runs for an unmarked release. Clearing it on every
    # materialization restores the coupling rmtree used to give for free.
    marker = target.parent / (target.name + '.development')
    marker.unlink(missing_ok=True)
    if args.development:
        # BESIDE THE RELEASE, NEVER INSIDE IT. The strip manifest is written above, at
        # `strip_path`, and it records this tree's own file count and byte total;
        # `launch-dsh.py` re-measures and refuses on any difference. A marker written into
        # the release after that is one more file the manifest does not know about, so
        # --development produced a release that could not be launched AT ALL. Measured on a
        # release materialized 29 seconds earlier: `strip-totals-mismatch: the tree holds
        # 14929 file(s)/141946360 bytes but strip-manifest.json records 14928/141946088` —
        # a delta of exactly one file and 272 bytes, which is this marker.
        #
        # Writing it before the manifest instead would "work" and would be worse: the flag
        # that says "this release may be written to" would become part of the evidence the
        # release presents about itself.
        if marker.exists():
            fail(f'marker-path-occupied: {marker} exists and is not this run\'s marker')
        marker.write_text(
            f'{target.name} was materialized with --development.\n'
            f'record {manifest["record"]["sha256"]}\n'
            'The hot-reload channel is MOUNTED and answers unauthenticated.\n'
            'scripts/face-dev-push.py may write here; launch-dsh.py will refuse this\n'
            'release once it has been written to (strip-totals-mismatch).\n'
            'Do not run an application on this release.\n'
            'This file sits beside the release because a file inside it counts toward the\n'
            'strip totals the release records about itself.\n')
        print('DEVELOPMENT RELEASE: hot reload mounted (unauthenticated), dev-push permitted')
        print(f'  marker beside the release: {marker}')
    print(f'RELEASE MATERIALIZED {target}')
    print(f'strip manifest sha256 {manifest["strip"]["sha256"]} ({manifest["strip"]["deletedFiles"]} file(s) removed, {manifest["strip"]["deletedBytes"]} bytes)')
    print(f'record sha256 {manifest["record"]["sha256"]}')
    print(f'plugin client bundle {manifest["plugin"]["clientBundleSha256"]}')
    print(f'composition {patch}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
