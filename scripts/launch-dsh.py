import sys
#!/usr/bin/env python3
"""Launch only a new isolated loopback candidate; never stop an existing process."""
import argparse, hashlib, json, os, re, socket, subprocess, threading, time, urllib.parse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--release', required=True, type=Path)
parser.add_argument('--state-root', required=True, type=Path)
parser.add_argument('--port', default=3187, type=int)
parser.add_argument('--patch', action='append', default=[], type=Path,
                    help='extra loader patch overlay applied after the profile layer (repeatable)')
parser.add_argument('--approved-record-sha', action='append', default=[],
                    help='sha256 of an approved release artifact record; repeatable. Without it a launch '
                         'must pass --allow-unapproved, so an unapproved release cannot be activated silently')
parser.add_argument('--allow-ungated', action='store_true',
                    help='disposable previews of a release materialized before the gate existed; '
                         'the process is then UNGOVERNED and the launcher says so')
parser.add_argument('--allow-unapproved', action='store_true',
                    help='explicitly launch a release that has no approved record digest (previews and tests only)')
a=parser.parse_args()
base=a.state_root.resolve(); release=a.release.resolve()
patches=[p.resolve() for p in a.patch]
for patch in patches:
    if not patch.is_file(): parser.error(f'missing-patch-overlay: {patch}')
if a.port in (3080,5173) or not 1024 <= a.port <= 65535:
    parser.error('reserved-or-invalid-port: choose a dedicated Genesis port')
for name in ['home','agents','workspace','logs']:
    p=base/name
    if not p.is_dir() or p.is_symlink():
        parser.error('missing-private-state: create new private home/agents/workspace/logs directories first')
if base.stat().st_mode & 0o077:
    parser.error('state-permissions: set the private state root to mode 0700')
# The backend's plugins read AUKORA_SUPPORT_ROOT (memory, action gate, messages) and fall back to
# ~/Library/Application Support/AUKORA without it. Forwarded below only when it names a private directory of ours.
support_root=os.environ.get('AUKORA_SUPPORT_ROOT')
if support_root is not None:
    try: _support=os.stat(support_root) if os.path.isabs(support_root) else None
    except OSError: _support=None
    if (_support is None or not os.path.isdir(support_root) or _support.st_uid!=os.getuid()
            or _support.st_mode & 0o022):
        # Not group- or world-writable, rather than exactly 0700: Electron's userData (the shell's own support root) is 0755.
        parser.error(f'support-root-invalid: AUKORA_SUPPORT_ROOT={support_root!r} must be an absolute path to an '
                     'existing directory this user owns that no other user can write')
entry=release/'apps/cli/lib/bin.js'
if not entry.is_file(): parser.error('missing-built-entry: complete the pinned build first')
node=subprocess.check_output(['which','node'],text=True).strip()
# Preflight: the tracked checker must accept the release bytes before any process
# is created. A record digest is an attestation, so it is consumed here rather
# than trusted later, and an unapproved release needs an explicit opt-in.
release_manifest_file=release/'.dsh-build/aukora-release.json'
release_manifest=None
if release_manifest_file.is_file():
    try:
        release_manifest=json.loads(release_manifest_file.read_text())
    except ValueError:
        parser.error(f'release-manifest-unreadable: {release_manifest_file}')
else:
    parser.error(f'release-manifest-missing: {release_manifest_file}; the release was not '
                 'materialized by scripts/materialize-aukora-release.py, so the launcher cannot '
                 'know whether it carries a composition gate')
record_file=release/'.dsh-build/genesis-artifacts.json'
if not record_file.is_file():
    parser.error(f'unverified-release: {record_file} is absent; run the pinned build and verification first')


def verify_harness_provenance(release, record_path, checkout, approved):
    """Bind the approved release record to its source commit's exact built harness, before launch.

    An explicitly approved historical record predating mandatory confinement retains the existing
    byte/gate checks. A new patched release cannot impersonate that recovery case by omitting a marker.
    This is local build provenance under the approved-record/Git trust roots, not a same-UID attestation.
    """
    try:
        record = json.loads(record_path.read_text())
        commit = (record.get('producer') or {}).get('genesisCommit', '')
        if not isinstance(commit, str) or not re.fullmatch(r'[a-f0-9]{40}', commit):
            raise ValueError('record has no exact source commit')
        pinned = subprocess.run(['git', '-C', str(checkout), 'show', commit + ':upstream-dsh.json'],
                                capture_output=True, text=True)
        if pinned.returncode:
            raise ValueError('recorded source pin is unavailable locally; historical boundary unresolved')
        historical_pin = json.loads(pinned.stdout)
        patch_set = sorted([{'file': p['file'], 'sha256': p['sha256']}
                            for p in historical_pin.get('localPatches', [])], key=lambda p: p['file'])
        inputs = {'upstream': {key: historical_pin[key] for key in
                              ('commit', 'archiveSha256', 'lockfileSha256', 'packageManager')},
                  'localPatches': patch_set}
        binding = record.get('harnessBuild')
        if binding is None and not any(p['file'] == 'patches/mandatory-agent-confinement.patch.json' for p in patch_set):
            if hashlib.sha256(record_path.read_bytes()).hexdigest() not in approved:
                raise ValueError('historical recovery requires its explicitly approved record digest')
            print('launcher: approved historical harness predates mandatory confinement; existing verification applies')
            return
        if (not isinstance(binding, dict) or binding.get('formatVersion') != 1
                or binding.get('kind') != 'pinned-harness-build' or binding.get('inputs') != inputs):
            raise ValueError('missing/stale successful build binding for the recorded source patch set')
        snapshot_path = release / '.dsh-build/pinned-harness-artifacts.json'
        if hashlib.sha256(snapshot_path.read_bytes()).hexdigest() != binding.get('artifactRecordSha256'):
            raise ValueError('original built inventory differs from approved build binding')
        snapshot = json.loads(snapshot_path.read_text())
        entries = snapshot.get('entries')
        if (snapshot.get('formatVersion') != 1 or snapshot.get('kind') != 'genesis-artifact-record'
                or not isinstance(entries, list) or not entries or len(entries) != binding.get('artifactCount')
                or snapshot.get('host', {}).get('fileCount') != len(entries)):
            raise ValueError('original built inventory is incomplete')
        for key in ('commit', 'archiveSha256', 'lockfileSha256'):
            if snapshot.get('upstream', {}).get(key) != inputs['upstream'][key]:
                raise ValueError('original build inventory upstream pin differs')
        final = {entry['path']: entry for entry in record['entries']}
        paths = set()
        for entry in entries:
            path = entry['path']
            if (not isinstance(path, str) or Path(path).is_absolute() or '..' in Path(path).parts
                    or path in paths or final.get(path) != entry):
                raise ValueError(f'compiled harness inventory differs in release: {path}')
            paths.add(path)
        print(f'launcher: bound {len(entries)} compiled harness artifacts to {len(patch_set)} exact source patches')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.error(f'harness-patch-set-mismatch: {error}')


verify_harness_provenance(release, record_file, Path(__file__).resolve().parents[1], a.approved_record_sha)
verification=subprocess.run([node,str(Path(__file__).resolve().parents[1]/'scripts/genesis-check.mjs'),
                             '--brick','B1','--checkpoint','build','--source',str(release)],
                            capture_output=True,text=True)
if verification.returncode != 0:
    # THE WHOLE REASON, NOT ITS FIRST LINE. The checker prints one summary line and then every
    # failure it found; reporting only `detail[0]` told an operator that the release failed to verify
    # and hid WHICH artifact changed — the one fact needed to decide whether this is a tampered
    # release or a stale record. Measured: a governed policy rewritten from 497 to 533 bytes produced
    # the summary line alone, and the `changed-artifact: …/policy.json is 533 bytes but the record
    # attests 497` line that names the cause was discarded.
    detail='\n  '.join(part.strip() for part in (verification.stderr, verification.stdout)
                       if part and part.strip())
    parser.error('release-verification-failed: '+(detail or 'checker refused the release'))
record_sha=hashlib.sha256(record_file.read_bytes()).hexdigest()
if a.approved_record_sha:
    if record_sha not in a.approved_record_sha:
        parser.error(f'unapproved-release: record {record_sha} is not among the approved digests')
elif not a.allow_unapproved:
    parser.error('unapproved-release: pass --approved-record-sha <digest> for an approved release, '
                 'or --allow-unapproved for a disposable preview')
# A DISPOSABLE LAUNCH MUST NOT ADDRESS THE LIVE STATE ROOT. On 2026-09-17 a rehearsal started DSH
# by invoking node directly, inherited a shell's DSH_HOME naming the LIVE home, and rewrote that
# home's profiles/node_modules to point at a temporary release; when the temporary tree was removed
# every preset became unresolvable and New Session was dead until a restart. Nothing was configured
# wrongly — a whitelisted environment was simply absent. This refuses the combination by name, so
# the mistake cannot be made silently again: a preview flag plus the live root is never intended.
if a.allow_unapproved:
    for _record in sorted((Path.home()/'.aukora-genesis'/'deployments').glob('*/live-state/launch.json')):
        try:
            _live=json.loads(_record.read_text())
        except (OSError, ValueError):
            continue
        _root=_live.get('stateRoot')
        if isinstance(_root,str) and _root and Path(_root).resolve()==base:
            parser.error(
                'state-root-is-live: %s is the RECORDED LIVE state root and --allow-unapproved marks '
                'this as a disposable launch. Both at once is never intended: the last time this '
                'combination ran it rewrote the live home\'s profiles/node_modules and New Session '
                'broke until a restart. Use a disposable state root for previews, or drop '
                '--allow-unapproved if this really is the live deployment.' % base)
# Overlays must point at release-local bytes; a mutable worktree path would make
# the verified release and the running composition two different things.
# TIGHTENED (2026-09-27, red team): `../` names, names on a `- name:` line and `!!js` names all
# escaped the old one-token regex. Every `name` key is now found in any block form, and a value this
# check cannot read as one literal string (a tag such as `!!js`, an anchor or alias, a block or
# multi-line scalar, a flow mapping, an escape YAML has and JSON lacks) is refused, not skipped.
# Every path-shaped name must resolve inside the release or the support root: the directory that
# holds the state root, where the desktop app keeps its overlays (never the home directory or `/`).
support=base.parent if base.parent not in (Path.home().resolve(), Path('/')) else None
NAME_KEY=re.compile(r'''^(\s*(?:-\s+)*)(["']?)name\2\s*:(?=\s|$)(.*)$''')
def _refuse_name(patch, lineno, why):
    parser.error(f'patch-name-unreadable: {patch}:{lineno} {why}; refusing a plugin name this check cannot read as one string')
def _next_line(lines, index):
    return next((l for l in lines[index+1:] if l.strip() and not l.lstrip().startswith('#')), None)
def _indent(line):
    return len(line)-len(line.lstrip())
def _name_value(patch, lineno, value):
    """The one string a `name:` value spells, or None when it is empty; refuses anything else."""
    if value=='' or value.startswith('#'):
        return None
    if value[0] in '!&*|>{[%@`':
        _refuse_name(patch, lineno, f'the value begins with `{value[0]}` (a tag such as !!js, an anchor, alias, block scalar or flow collection)')
    if value[0]=="'":
        close=1
        while True:
            close=value.find("'", close)
            if close==-1 or value[close+1:close+2]!="'": break
            close+=2
        rest=value[close+1:].strip() if close!=-1 else ''
        if close==-1 or (rest and not rest.startswith('#')):
            _refuse_name(patch, lineno, 'the quoted name is unterminated or followed by more text')
        return value[1:close].replace("''", "'")
    if value[0]=='"':
        close=1
        while close<len(value) and value[close]!='"':
            close+=2 if value[close]=='\\' else 1
        rest=value[close+1:].strip() if close<len(value) else ''
        if close>=len(value) or (rest and not rest.startswith('#')):
            _refuse_name(patch, lineno, 'the quoted name is unterminated or followed by more text')
        try:
            return json.loads(value[:close+1], strict=False)
        except ValueError:
            _refuse_name(patch, lineno, 'the quoted name uses an escape JSON does not share with YAML')
    return re.split(r'\s#', value, maxsplit=1)[0].rstrip()
for patch in patches:
    lines=patch.read_text().split('\n')
    for index, line in enumerate(lines):
        lineno=index+1
        if line.lstrip().startswith('#'):
            continue
        if re.search(r'''[{,]\s*["']?name["']?\s*:''', line) or re.match(r'^\s*(?:-\s+)*\?(\s|$)', line) \
                or re.match(r'''^\s*(?:-\s+)*"(?:[^"\\]|\\.)*\\(?:[^"\\]|\\.)*"\s*:''', line):
            _refuse_name(patch, lineno, 'a flow mapping, a complex key or an escaped key')
        keyed=re.match(r'''^(\s*(?:-\s+)*)["']?(insert|config)["']?\s*:(.*)$''', line)
        if keyed:
            after=keyed.group(3).strip()
            below=_next_line(lines, index)
            if after.startswith('!') or (after=='' and below is not None and _indent(below)>len(keyed.group(1))
                                         and below.lstrip().lstrip('- ').startswith('!')):
                _refuse_name(patch, lineno, f'`{keyed.group(2)}` carries a tag, which can supply names at load time')
        hit=NAME_KEY.match(line)
        if not hit:
            continue
        # A MORE-INDENTED LINE AFTER A NAME CONTINUES IT: a multi-line plain scalar folds into one string, and a
        # tag or scalar on the next line is still this name. A nested mapping or list is not a string at all.
        value=hit.group(3).strip()
        below=_next_line(lines, index)
        if below is not None and _indent(below)>len(hit.group(1)):
            nested=re.match(r'''^\s*(?:-(?:\s|$)|["']?[\w$.-]+["']?\s*:(?:\s|$))''', below)
            if value!='' or not nested:
                _refuse_name(patch, lineno, 'the name continues on the next line')
        target=_name_value(patch, lineno, value)
        if target is None or target.startswith('cordis:'):
            continue
        if '\\' in target:
            _refuse_name(patch, lineno, 'the name carries a backslash')
        scheme=re.match(r'^([A-Za-z][A-Za-z0-9+.-]*):', target)
        if scheme and scheme.group(1).lower()!='file':
            _refuse_name(patch, lineno, f'the name is a `{scheme.group(1)}:` URL, which loads no release bytes')
        if target.startswith('file:'):
            parsed=urllib.parse.urlparse(target)
            if parsed.netloc not in ('', 'localhost'):
                _refuse_name(patch, lineno, 'the file URL names a host')
            resolved=Path(urllib.parse.unquote(parsed.path))
        elif target.startswith(('/', './', '../')):
            resolved=Path(target)
        elif target.startswith('.') or '..' in target.split('/'):
            _refuse_name(patch, lineno, 'a relative name that is neither ./ nor ../, or a package name carrying `..`')
        else:
            continue  # a bare package name, resolved through node_modules like any import
        if not resolved.is_absolute(): resolved=patch.parent/resolved
        resolved=resolved.resolve()
        if not any(root is not None and (resolved==root or root in resolved.parents) for root in (release, support)):
            parser.error(f'patch-not-release-local: {resolved} is outside the verified release {release}'
                         + ('' if support is None else f' and the support root {support}'))
# Refuse duplicate launches before changing any process or state.
with socket.socket() as probe:
    try: probe.bind(('127.0.0.1',a.port))
    except OSError: parser.error(f'port-unavailable: {a.port}; inspect its owner or select a free port')
root=Path(__file__).resolve().parents[1]
pin=json.loads((root/'upstream-dsh.json').read_text())
if hashlib.sha256((release/'pnpm-lock.yaml').read_bytes()).hexdigest()!=pin['lockfileSha256']:
    parser.error('release-lockfile-mismatch: inspect the pinned release before launching')
# Installed inputs are bound to the digests recorded at install time, so a
# preset, patch or plugin changed after installation stops the launch.
install_record=base/'aukora-install.json'
if install_record.is_file():
    try:
        installed=json.loads(install_record.read_text())
    except ValueError:
        parser.error(f'installed-inputs-unreadable: {install_record}')
    expected=[('preset',Path(installed['preset']['path']),installed['preset']['sha256']),
              ('patch',Path(installed['patch']['path']),installed['patch']['sha256']),
              ('plugin-client-bundle',Path(installed['plugin']['clientBundle']),installed['plugin']['clientBundleSha256'])]
    for label,path,digest in expected:
        if not path.is_file():
            parser.error(f'installed-inputs-missing: {label} {path}')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            parser.error(f'installed-inputs-changed: {label} {path} no longer matches the installed digest')
# ── the composition gate's startup hook ──────────────────────────────────────────────────
# The gate's admission policy has to be installed as a NODE BOOTSTRAP: the governed module is
# imported before any profile plugin runs (measured: 151 ms earlier), so a hook installed from
# a plugin always arrives second and enforces nothing. The hook therefore travels as an
# explicit `--import` argument, which reaches the child regardless of the environment
# whitelist below — the whitelist stays, and no variable is smuggled through it.
#
# The hook and policy are verified against the hashes the MATERIALIZER recorded, before the
# process exists. A release whose hook has gone missing or been altered refuses to launch,
# because a process that looks gated and is not is worse than one that plainly is not.
gate = release_manifest.get('gate') if isinstance(release_manifest, dict) else None
gate_argv = []
gate_env = {}
# ── THE AUTHORITY INPUTS ARE BOUND TO THE APPROVED RECORD ────────────────────────────────
# The hook installed as `--import` and the governed module the gate config binds are CHOSEN BY NAME
# from `.dsh-build/aukora-release.json`. That file is NOT covered by the artifact record — the
# coverage declaration excludes `.dsh-build/**` — so on its own it is mutable metadata inside a
# verified tree: an edit there, changing the path AND the digest together, substitutes a different
# hook (or a different governed file) while the record an operator approved stays byte-identical and
# still verifies. The `gate-artifact-changed` and `gate-demo-changed` checks above compare the
# manifest with the FILE, which is a comparison between two halves of the same mutable metadata.
#
# So each input's IDENTITY is fixed here, at the release-relative path a materialized release always
# carries, and its bytes must be the bytes the APPROVED RECORD attests for that path. The manifest
# may only AGREE with that. A mismatch is a NAMED REFUSAL raised before the gate-state directories are
# created, before the gate config is written and before this launcher spawns anything — a process that
# looks gated while installing a substituted hook is worse than one that plainly is not gated.
GATE_AUTHORITY = (
    # label, manifest path key, release-relative path
    ('hook', 'hook', 'plugins/aukora-composition-gate/src/install.js'),
    ('governed demo', 'governedDemo', 'plugins/aukora-gate-demo/hello-governed.mjs'),
    # THE POLICY DECIDES WHICH IDS ARE GOVERNED, so it is an authority input in the literal sense:
    # editing its `governed` list changes what the running process enforces without changing any code.
    # It is bound LAST here and read from the BOUND path below, so the id list in gate-config.json can
    # never come from a file the approved record does not attest. The manifest's `policy` key names a
    # different file (src/policy.js, the enforcement module); `policyConfig` is policy.json, the
    # governed-id list, and it is the one whose substitution launders a boundary change.
    ('governed policy', 'policyConfig', 'plugins/aukora-composition-gate/policy.json'),
)


def bind_gate_authority(release, record_path, gate, record_sha):
    """Refuse when the mutable gate metadata names an authority input the approved record does not.

    Returns {manifest key: absolute path} for exactly the inputs that were bound, so the caller
    installs and configures the BOUND paths rather than re-reading the manifest.

    An input the manifest does not name at all is left to the checks above, which refuse a missing
    hook by their own names (`gate-artifact-missing`) and leave `governedFiles` empty for a release
    that records no governed module — unchanged behaviour. This function decides only the case where
    the metadata NAMES something, and its whole job is that the name is the approved one.
    """
    try:
        record = json.loads(Path(record_path).read_text())
    except ValueError:
        parser.error(f'approved-record-unreadable: {record_path} is not JSON, so the authority inputs '
                     'cannot be bound to it. Nothing has been spawned or written.')
    entries = {}
    if isinstance(record, dict) and isinstance(record.get('entries'), list):
        entries = {e['path']: e for e in record['entries']
                   if isinstance(e, dict) and isinstance(e.get('path'), str)
                   and isinstance(e.get('sha256'), str)}
    bound = {}
    for label, path_key, relative in GATE_AUTHORITY:
        claimed = gate.get(path_key)
        if not isinstance(claimed, str) or not claimed:
            continue
        path = Path(claimed)
        if not path.is_absolute():
            path = release / path
        path = path.resolve()
        expected = (release / relative).resolve()
        if release != path and release not in path.parents:
            parser.error(f'gate-authority-outside-release: the release metadata names {label} {path}, '
                         f'which is outside the verified release {release}. The approved record covers '
                         f'no file there, so nothing binds what would be installed or governed. '
                         f'Nothing has been spawned or written. The release-layout path is {expected}')
        if path != expected:
            parser.error(f'gate-authority-substituted: the release metadata names {label} {path} but '
                         f'the approved record attests the release-layout path {expected}. '
                         '.dsh-build/aukora-release.json is mutable metadata the artifact record does '
                         'not cover, so a substituted path here would install (or bind) something '
                         f'other than what was approved while record {record_sha[:16]}… still '
                         'verifies. Nothing has been spawned or written')
        entry = entries.get(relative)
        if entry is None:
            if entries:
                parser.error(f'gate-authority-unattested: the approved record attests no artifact at '
                             f'{relative}, so the {label} cannot be bound to it. RE-MATERIALIZE the '
                             'release from an accepted main that carries the composition gate: '
                             'python3 scripts/materialize-aukora-release.py --to <release> --force. '
                             'Refusing to launch rather than installing an unbound authority input.')
            # A record with no artifact set at all (a fixture, or one predating coverage): the path
            # is still fixed above, and the manifest's own digest is still checked. The limit is
            # printed rather than hidden, so this run is not read as more than it measured.
            print(f'launcher: the record attests no artifact set, so {label} is bound by PATH only '
                  f'({relative})')
            bound[path_key] = str(path)
            continue
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != entry['sha256']:
            parser.error(f'gate-authority-changed-since-approval: {label} {path} is {actual} and the '
                         f'approved record attests {entry["sha256"]}; the bytes that would be installed '
                         '(or governed) are not the bytes that were approved. Nothing has been spawned '
                         'or written. Re-materialize the release rather than editing it in place')
        bound[path_key] = str(path)
    return bound


if gate is None:
    if not a.allow_ungated:
        parser.error('gate-missing-from-release: the release records no composition gate. '
                     'Pass --allow-ungated for a disposable preview, or materialize a release '
                     'built from a tree that carries plugins/aukora-composition-gate.')
    print('launcher: --allow-ungated — the release carries NO composition gate; '
          'admissions are ungoverned and any enforcement claim about this process is void')
else:
    for label, path_key, sha_key in (('hook', 'hook', 'hookSha256'),
                                     ('policy', 'policy', 'policySha256'),
                                     ('entry', 'entry', 'entrySha256')):
        path = Path(gate.get(path_key, ''))
        if not path.is_file():
            parser.error(f'gate-artifact-missing: {label} {path} — the release records it and it '
                         'is not there; the release has been changed since materialization')
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != gate.get(sha_key):
            parser.error(f'gate-artifact-changed: {label} {path} is {actual} and the release '
                         f'records {gate.get(sha_key)}; refusing to launch a process whose '
                         'enforcement differs from the bytes that were verified')
    # Mutable state lives in the private deployment state, NOT in the release: an upgrade or a
    # rollback must never reset replay protection, and a key or grant baked into an immutable
    # artifact is a key every copy of that artifact carries.
    gate_state = base / 'gate-state'
    # The governed list comes from the RELEASE, which is integrity-covered: an edit to the
    # policy changes what the running process enforces, so it has to be an edit to a verified
    # artifact and not to a file beside the worktree.
    recorded_policy = gate.get('policyConfig')
    if not recorded_policy:
        # A release materialized BEFORE the policy existed. Fail closed — the governed boundary
        # is unknown — but name the remedy instead of pointing at Path(''), which renders as '.'
        # and tells an operator nothing.
        parser.error('gate-policy-not-recorded: this release predates the governed-policy '
                     'artifact, so its governed boundary cannot be established from the release '
                     'itself. RE-MATERIALIZE it from an accepted main that carries the policy: '
                     'python3 scripts/materialize-aukora-release.py --to <release> --force. '
                     'Refusing to launch rather than silently downgrading admission policy.')
    policy_path = Path(recorded_policy)
    # THE MANIFEST-INTERNAL POLICY DIGEST IS NO LONGER THE DECIDING CHECK, ON PURPOSE. The comparison
    # that used to sit at this point (`policyConfigSha256` vs the file) compared the manifest with a
    # file the manifest itself names — two halves of the same mutable metadata — so repairing
    # `policyConfigSha256` in `.dsh-build/aukora-release.json` satisfied it while the governed id list
    # changed. The digest that decides is now the APPROVED RECORD's, for the release-relative path
    # (bind_gate_authority, below), which is the only comparison in which the metadata cannot define
    # what it is being compared against. The generic manifest-vs-file loop above still covers
    # `hook`/`policy`/`entry`; it never covered the policy CONFIG, which is why this needed its own
    # binding. The `is_file` refusal stays here, before the bind, so a policy that is GONE is named as
    # missing rather than as changed-since-approval: different operator situations, different message.
    if not policy_path.is_file():
        parser.error(f'gate-policy-missing: {policy_path} — the release records a governed '
                     f'policy and it is not there; re-materialize the release from an accepted '
                     f'main, or restore the file. Refusing to launch with an unknown boundary.')

    # The governed DEMONSTRATION module is verified too. Its digest was recorded and, until now,
    # nothing consumed it: substituted bytes were caught only by the grant's own binding at
    # admission, which is a different check and does not protect the release's own bytes.
    recorded_demo = gate.get('governedDemo')
    if recorded_demo:
        demo_path = Path(recorded_demo)
        if not demo_path.is_file():
            parser.error(f'gate-demo-missing: {demo_path} — the release records a governed '
                         'demonstration module and it is not there; re-materialize the release.')
        actual_demo = hashlib.sha256(demo_path.read_bytes()).hexdigest()
        if actual_demo != gate.get('governedDemoSha256'):
            parser.error(f'gate-demo-changed: {demo_path} is {actual_demo} and the release '
                         f'records {gate.get("governedDemoSha256")}; the bytes a grant would bind '
                         'are not the bytes that were verified. Re-materialize the release.')

    # ── THE BINDING. The mutable metadata may only AGREE with the approved record. ──────────────
    # Everything above verified the manifest against the FILES; this is the one check that ties what
    # will actually be installed and governed to the artifact record an operator approved, and it is
    # placed above every write below (the gate-state directories included) so a substituted input
    # leaves the state root untouched.
    bound_authority = bind_gate_authority(release, record_file, gate, record_sha)
    # THE GOVERNED ID LIST IS READ FROM THE BOUND PATH, NOT FROM `recorded_policy`. This is the
    # consumer of the policy binding above, and without it the binding would be decorative: the
    # digest would be checked against the approved record and the boundary would then be taken from
    # the manifest's own claim. `bind_gate_authority` returns exactly the manifest keys it bound, so
    # the boundary can only be read after the attestation has been enforced.
    governed = json.loads(Path(bound_authority['policyConfig']).read_text()).get('governed', [])
    # Bind each governed id to the RELEASE PATH, so admission cannot be satisfied by a same-named
    # file elsewhere. Without this the gate matched on basename alone and the recorded path had no
    # consumer. The path used is the BOUND one, never the manifest's own claim.
    governed_files = [bound_authority['governedDemo']] if 'governedDemo' in bound_authority else []
    # ── THE AUKORA PLUGIN SET: every shipped AUKORA plugin admitted by an owner-approved record ────────
    # The materializer writes `.dsh-build/plugin-set.json` (scripts/aukora/plugin-set.mjs record); the
    # owner's approval of exactly that record and the pinned approver live in this deployment's
    # gate-state. The GATE verifies them before anything is imported and refuses changed plugin bytes at
    # import. `--allow-unapproved` (the desktop's allowUnapproved) WAIVES it: the checks still run and are
    # printed, and nothing is refused. Decided here, before any gate-state write, so a refusal leaves the
    # state root untouched.
    plugin_set_file = release / '.dsh-build' / 'plugin-set.json'
    plugin_set_approval = gate_state / 'plugin-set-approval.json'
    plugin_set_pin = gate_state / 'plugin-set-approver.json'
    plugin_set_fields = {}
    if plugin_set_file.is_file():
        plugin_set_mode = 'waived' if a.allow_unapproved else 'enforce'
        if plugin_set_mode == 'enforce' and not (plugin_set_approval.is_file() and plugin_set_pin.is_file()):
            parser.error(f'plugin-set-unapproved: {release.name} records its AUKORA plugins in {plugin_set_file} and '
                         f'no owner approval of that set is installed in {gate_state}. Every AUKORA plugin would '
                         'be refused at import, so nothing is started. The owner approves the set in ONE Aumlok '
                         f'popup: node scripts/aukora/plugin-set.mjs approve --release {release} '
                         f'--support "{base.parent}"')
        plugin_set_fields = {
            'pluginSetPath': str(plugin_set_file),
            'pluginSetRoot': str(release),
            'pluginSetMode': plugin_set_mode,
            # The governed plugin list from the BOUND policy.json (its bytes are the approved record's).
            'pluginSetPolicy': json.loads(Path(bound_authority['policyConfig']).read_text()).get('pluginSet', []),
            'pluginSetApprovalPath': str(plugin_set_approval),
            'pluginSetPinPath': str(plugin_set_pin),
        }
        print(f'launcher: AUKORA plugin set {plugin_set_mode.upper()} ({plugin_set_file})'
              + ('' if plugin_set_mode == 'enforce' else ' — --allow-unapproved: checked and NOT enforced'))
    elif not a.allow_unapproved:
        parser.error(f'plugin-set-missing: {plugin_set_file} is absent, so the AUKORA plugins this release mounts '
                     'have no record to be admitted by. Re-materialize the release (the materializer writes it), '
                     'or pass --allow-unapproved for a disposable preview.')
    gate_state.mkdir(parents=True, exist_ok=True)
    grants = gate_state / 'grants'
    grants.mkdir(parents=True, exist_ok=True)
    config = gate_state / 'gate-config.json'
    # ── THE ADMISSION CUT, COMPOSED BY scripts/gate-config-admission.py (BETA) ─────────────────────
    # ONE CALL, DELIBERATELY. Alpha owns this file and is mid-restructure, so every decision — the pin
    # path, the grant path, when requireGrant is true, and what happens when a daemon is present with no
    # readable grant — lives in that module, where a court imports and exercises it directly rather than
    # reading this file's source and hoping. THIS IS THE ONLY LINE THIS CHANGE ADDS HERE.
    #
    # With no owner install it returns {} and the gate prints its current ceiling, so a launch on a
    # machine that has never run setup-owner.sh behaves exactly as it does today.
    sys.path.insert(0, str(release / 'scripts'))
    from importlib import import_module as _import_module
    # THE RELEASE ID IS THE RELEASE DIRECTORY'S OWN NAME, which is what the materializer wrote and what
    # every other reader of a release identifies it by. `RELEASE_ID` was my first draft and it DOES NOT
    # EXIST in this file -- `ast.parse` accepted it because a bare name is valid syntax, and it would have
    # raised NameError on the first real launch. A syntax check is not a name check.
    _admission = _import_module('gate-config-admission').admission_fields(release.name)
    config.write_text(json.dumps({
        **_admission,
        **plugin_set_fields,
        'governed': governed,
        'governedFiles': governed_files,
        # D3: a composition grant names its module relative to THIS release, and the hook compares that.
        'grantRoot': str(release),
        'stateDir': str(gate_state),
        'grantDir': str(grants),
        'governorPkFile': str(gate_state / 'governor.pk'),
        # THE RETAINER IS NAMED IN THE GATE CONFIG, and the environment is set FROM it, so there is
        # exactly one place a deployment says where its retainer lives. `serialize-admissions.py`
        # calls this hook at settlement — settling is the moment a head becomes history, and a
        # retained head only means something if it was kept before the next append could change it.
        # It is a path INSIDE THE RELEASE: a retainer named from a checkout would make the running
        # process depend on mutable bytes the artifact record never verified.
        'auraRetainer': str(release / 'scripts' / 'aura' / 'retain_on_settle.py'),
    }, indent=2) + '\n')
    os.chmod(config, 0o600)
    gate_argv = ['--import', bound_authority['hook']]
    gate_env['AUKORA_GATE_CONFIG'] = str(config)
    # Only when the release actually carries it: an env var pointing at a file that is not there
    # would turn "this release predates the retainer" into a settlement-time failure.
    retainer = release / 'scripts' / 'aura' / 'retain_on_settle.py'
    if retainer.is_file():
        gate_env['AUKORA_AURA_RETAINER'] = str(retainer)

env={k:os.environ[k] for k in ['HOME','USER','LOGNAME','PATH','TMPDIR','LANG'] if k in os.environ}
env.update(DSH_HOME=str(base/'home'),DSH_AGENTS_HOME=str(base/'agents'),DSH_TELEMETRY_MODE='DISABLED',DSH_TELEMETRY_DISABLED='1',NODE_NO_WARNINGS='1')
env.update(gate_env)
# ── THE THREE NAMES THE SHELL HANDS OVER, AND ONLY THOSE THREE ──────────────────────────────────
# The environment above is an explicit list, so an unnamed variable is DROPPED. That is what kept the
# eye and the signer dead while every court about them stayed green: `apps/aukora-desktop/main.mjs`
# installs the eye door, mints its per-launch token, resolves the signer socket, and merges all three
# into THIS process's environment — and the child then received none of them. MEASURED on the live app
# of 2026-09-22: backend pid 13685 held AUKORA_GATE_CONFIG and AUKORA_AURA_RETAINER (both set here) and
# neither AUKORA_EYE_URL nor AUKORA_EYE_TOKEN nor AUKORA_SIGNER_SOCKET, so the mounted eye tool would
# refuse `eye.not-configured` and an enrolment would answer channel-unavailable instead of
# `aumlok:locked`.
#
# FORWARDED ONLY WHEN PRESENT, and that matters: an empty default would point the child at a door or a
# socket that does not exist, turning a named refusal (`eye.not-configured`) into a wrong address. A
# launcher run outside the shell has none of them and forwards none of them, which is the honest state
# for a backend nobody is going to photograph or sign with.
#
# THE WHITELIST STAYS A WHITELIST. These three are named because the shell names them to us, not
# because any AUKORA_* belongs in a child: the court that holds this
# (tests/aukora-launch-env-forwarding.test.mjs) spawns a real child and asserts both halves — all three
# arrive, and a name the shell never sends still does not.
for _forwarded in ('AUKORA_EYE_URL', 'AUKORA_EYE_TOKEN', 'AUKORA_SIGNER_SOCKET'):
    if _forwarded in os.environ:
        env[_forwarded] = os.environ[_forwarded]
if support_root is not None:
    env['AUKORA_SUPPORT_ROOT'] = support_root
command=[node,*gate_argv,str(entry)]
for patch in patches: command += ['--patch', str(patch)]
command += ['--profile','web','--host','127.0.0.1','--port',str(a.port),'--no-open']
os.umask(0o077)
# ── A BOUNDED STARTUP WINDOW, SO A HANG IS A NAMED REFUSAL AND NOT A WAITING JOB ────────────────
# The launcher used to spawn the child and return immediately, which left the only proof of life to
# whatever ran next. A DSH that hangs before it prints its URL therefore hangs the CALLER: the court
# has a 300 s subprocess timeout per arm and CI has an overall job timeout, both of which report a
# red about the harness rather than naming what stalled. This window watches the NEW bytes of the
# private server log for the line DSH prints once it is serving (`dsh web: http://…`), and it is
# bounded. The window is the STARTUP contract only:
#
#   * DSH printed its URL        -> the launch is READY, and the URL line is quoted from the log.
#   * the child EXITED first      -> a NAMED REFUSAL, because a process that died during startup is
#                                    not a launch, and saying "spawned" about it is a false report.
#   * neither, within the window  -> the process is REPORTED AS STILL STARTING (or hung) with its pid
#                                    and the log path. It is NOT killed and NOT called ready: a slow
#                                    but honest start must not be refused, and a wedged one is left
#                                    visibly running for an operator rather than silently reaped.
#
# The window is 20 s by default and AUKORA_LAUNCH_STARTUP_TIMEOUT overrides it for a slower host or a
# tighter CI budget. 0 or a negative value disables the wait and restores the old behaviour.
try:
    startup_timeout=float(os.environ.get('AUKORA_LAUNCH_STARTUP_TIMEOUT','20'))
except ValueError:
    parser.error('startup-timeout-invalid: AUKORA_LAUNCH_STARTUP_TIMEOUT must be a number of seconds')
# ── THE LAUNCH TOKEN MUST NOT REACH DISK (SECURITY.md:169-172) ───────────────────────────────────────────────
# MEASURED: the harness prints its AUTHENTICATED url once it serves — `dsh web: http://127.0.0.1:PORT/?token=…` —
# and this launcher pointed the child's stdout straight at `logs/server.log`, so every boot wrote the token to a file
# any process running as the user can read, and the backend accepts that token until it restarts.
#
# THE OBVIOUS FIX IS WRONG: the shell NEEDS that url to open the window. So the stream is PIPED here instead of being
# handed to the child as a file: every line is kept in MEMORY (where the url is read from) and the REDACTED form is
# what reaches the log. Nothing that reaches disk carries the token, and the launch still authenticates.
TOKEN_IN_URL=re.compile(r'(token=)[^\s&\'"]+')
def redact_token(text):
    """The one place the token is removed, so a log line cannot carry it by accident."""
    return TOKEN_IN_URL.sub(r'\1<redacted>', text)

_live=[]   # the real lines, in memory only
# *** AND THE URL IS NOW WRITTEN DOWN, DELIBERATELY (aura-88). *** *This comment used to say "never written anywhere
# unredacted", and the cost of that rule was a consumer that could not authenticate: the log is redacted BY DESIGN, so
# the authenticated url existed only inside this process and died with it.* **So the launcher publishes it to ONE file it
# owns -- `<state>/launch-url.json`, mode 0600, written atomically, naming ITS OWN child pid -- and nowhere else.**
# *A reader can therefore tell a live url from a stale one by pid, which a bare url could never say.*
def _publish_url(text):
    match=re.search(r'dsh web: (http\S+)', text)
    if match is None: return
    url=match.group(1)
    tok=re.search(r'[?&]token=([^\s&"\']+)', url)
    body=json.dumps({'url':url,'token':(tok.group(1) if tok else None),'pid':child.pid,'at':time.time()})
    tmp=base/'.launch-url.json.tmp'
    fd=os.open(tmp, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)
    try:
        os.write(fd, body.encode('utf-8'))
    finally:
        os.close(fd)
    os.replace(tmp, base/'launch-url.json')

log_path=base/'logs/server.log'
log_offset=log_path.stat().st_size if log_path.is_file() else 0
log=log_path.open('ab')
if True:
    child=subprocess.Popen(command,cwd=base/'workspace',env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)

def _pump():
    try:
        for raw in iter(child.stdout.readline, b''):
            text=raw.decode('utf-8','replace')
            # THE PUMP LIVES AS LONG AS THE CHILD DOES, so a url printed AFTER the startup window is
            # published exactly like one printed inside it -- which is the whole point of the file.
            # A FAILED PUBLISH OR LOG WRITE MUST NOT STOP THE DRAIN (2026-09-27, red team): either one used to
            # end this loop, and a pipe nobody reads stalls the backend on its next write.
            try: _publish_url(text)
            except Exception: pass
            # Seen by the readiness window only after the publish, so a launch reported ready has its launch-url.json.
            _live.append(text)
            try:
                log.write(redact_token(text).encode('utf-8'))
                log.flush()
            except Exception:
                pass
    except Exception:
        pass
threading.Thread(target=_pump,daemon=True).start()

def _new_log_text():
    # FROM MEMORY, NOT FROM THE LOG: the log is redacted, so the authenticated url no longer exists on disk. The
    # window must see the real line or a launch that WORKED would be reported as unready.
    return ''.join(_live)

readiness='not-verified: startup window disabled'
url=None
deadline=time.monotonic()+startup_timeout if startup_timeout>0 else None
while deadline is not None and time.monotonic()<deadline:
    for line in _new_log_text().splitlines():
        if 'dsh web: http' in line:
            url=line.strip()
            readiness='ready: the child printed its URL inside the window'
            break
    if url is not None or child.poll() is not None:
        break
    time.sleep(0.25)
if url is None and child.poll() is not None:
    code=child.returncode
    tail='\n'.join(line for line in _new_log_text().splitlines()[-12:]).strip()
    parser.error(f'launch-failed-during-startup: pid {child.pid} exited with status {code} before it '
                 f'printed a URL, so this launch did not start. The private log tail is:\n{redact_token(tail)}\n'
                 f'Nothing is left running. Read the full log at {log_path}')
if url is None and deadline is not None:
    readiness=f'still-starting-or-hung: no URL after {startup_timeout:g}s and pid {child.pid} is still '
    readiness+=f'alive; nothing was killed, inspect {log_path}'
record={'pid':child.pid,'gate':({'hook':bound_authority['hook'],'hookSha256':gate['hookSha256'],
                                'stateDir':str(base/'gate-state'),
                                # The BOUND policy path and the governed ids actually written into the
                                # config, recorded so a reader can see WHICH boundary this process got
                                # without re-deriving it from two mutable files. Evidence about this
                                # launch, not authority for the next one.
                                'policy':bound_authority['policyConfig'],
                                'governed':governed,
                                'config':str(base/'gate-state'/'gate-config.json')}
                               if gate else None),'upstreamCommit':pin['commit'],'genesisCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'release':str(release),'stateRoot':str(base),'port':a.port,'entrySha256':hashlib.sha256(entry.read_bytes()).hexdigest(),'command':command,'patches':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in patches],'startup':{'windowSeconds':startup_timeout,'readiness':readiness,'url':redact_token(url) if url is not None else None},'status':'spawned; HTTP/browser readiness must be verified separately'}
(base/'launch.json').write_text(json.dumps(record,indent=2)+'\n')
if url:
    # NOT THE TOKEN: stdout lands in the caller's log and the journal. The authenticated url is only in launch-url.json.
    print(f'Spawned Genesis PID {child.pid}; it printed its URL inside the startup window: {redact_token(url)}; '
          f'the authenticated URL is in {base/"launch-url.json"} (mode 0600)')
else:
    print(f'Spawned Genesis PID {child.pid}; {readiness}. Readiness is NOT established: inspect {log_path}.')

# THE PUMP MUST OUTLIVE THIS PROCESS. The child's stdout is a pipe into this launcher, and the desktop shell waits for
# the launcher to exit before it reads the URL. When the launcher exited, the pipe closed and the child died on its
# next write (EPIPE), silently, a minute or two after boot. So a detached copy of this process keeps draining the pipe
# into the redacted log for as long as the child lives, and the caller still sees this process exit. The copy uses
# fresh handles: locks held by the pump thread at fork time do not exist in the child.
#
# A LOG WRITE THAT FAILS MUST NOT END THE DRAIN (2026-09-27, red team). The first version let one failed open or write
# (a full disk, a removed logs directory) end this loop, which closed the pipe and killed the backend on its next write:
# the same EPIPE death this copy exists to prevent. Every open and write is caught, a lost log is reopened at most every
# five seconds, and until then the pipe is drained without logging. Only the child closing its stdout ends this loop.
sys.stdout.flush(); sys.stderr.flush()
if os.fork()==0:
    try:
        try:
            os.setsid()
            _null=os.open(os.devnull, os.O_RDWR)
            for _fd in (0,1,2): os.dup2(_null,_fd)
        except Exception:
            pass
        _src=os.fdopen(os.dup(child.stdout.fileno()),'rb')
        _out=None
        _reopen_at=0.0
        for raw in iter(_src.readline,b''):
            text=raw.decode('utf-8','replace')
            try: _publish_url(text)
            except Exception: pass
            if _out is None and time.monotonic()>=_reopen_at:
                try: _out=log_path.open('ab')
                except Exception: _reopen_at=time.monotonic()+5
            if _out is None:
                continue
            try:
                _out.write(redact_token(text).encode('utf-8')); _out.flush()
            except Exception:
                try: _out.close()
                except Exception: pass
                _out=None
                _reopen_at=time.monotonic()+5
    finally:
        os._exit(0)
os._exit(0)
