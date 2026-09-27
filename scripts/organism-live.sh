#!/usr/bin/env bash
# organism-live — "is it live?", as ONE command anybody can run.
#
#   bash scripts/organism-live.sh          # no arguments, no state of its own
#
# WHY THIS EXISTS. Every claim about the running app used to arrive as a sentence from a lane, and a
# lane's sentence is a fact about a lane. This prints the facts about the PROCESS: which release its
# own argv names, what the release's OWN LOADER says that release mounts, whether every mounted
# artifact's bytes are the bytes in the checkout, whether the shell handed the backend the three names
# only it can know, and whether the eye door refuses a stranger. Aura runs it every morning; nobody
# takes a lane's word again, mine included.
#
# WHAT "LIVE" MEANS HERE, EXACTLY. Exit 0 only when EVERY mounted artifact is SAME (its bytes equal the
# checkout's) and LOADED (its id is in the effective entry list the release's own loader produces from
# the pid's own patch list). Anything else is a non-zero exit naming the row. The three environment
# names and the door's 401 are PRINTED as their own lines and are NOT part of that exit: they say
# whether the shell's eye and signer are wired to this backend, which is a different question from
# whether the release is mounted, and a reader must see both rather than one verdict for two facts.
#
# EXIT: 0 every row SAME + LOADED · 1 a row is DIFF, ABSENT, or NOT LOADED · 2 no running app, or its
# record names no release this script can read.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${AUKORA_LIVE_STATE:-$HOME/Library/Application Support/AUKORA/state/launch.json}"

if [ ! -f "$STATE" ]; then
  echo "organism-live: NO RUNNING APP — $STATE is absent" >&2
  echo "               (the app writes it at launch; start the app, or point AUKORA_LIVE_STATE at one)" >&2
  exit 2
fi

PY="${PYTHON:-python3}"
"$PY" - "$STATE" "$REPO" <<'PY'
import hashlib, json, os, subprocess, sys, tempfile, re

state_path, repo = sys.argv[1], sys.argv[2]
problem = 0
causes = []
try:
    state = json.load(open(state_path, encoding='utf-8'))
except (OSError, ValueError) as error:
    print(f'organism-live: the launch record cannot be read ({error})', file=sys.stderr)
    raise SystemExit(2)

pid, release, port = state.get('pid'), state.get('release'), state.get('port')
print(f"PORT            {port}")
print(f"PID             {pid}")
print(f"RELEASE         {release}")
print(f"STATE RECORD    {state_path}")

# ── the process is the thing, so ask the process ────────────────────────────────────────────────
argv = subprocess.run(['ps', '-o', 'command=', '-p', str(pid)], capture_output=True, text=True).stdout
argv_release = next((tok for tok in argv.split() if 'aukora-release-' in tok), None)
if argv_release is None:
    print(f"ARGV RELEASE    ABSENT — pid {pid} is not running a release this script can see")
    causes.append("the pid's argv names no release")
    problem += 1
else:
    named = re.search(r'/Users/[^/]*/aukora-release-[A-Za-z0-9._-]+', argv_release).group(0)
    inside = named == release
    print(f"ARGV RELEASE    {named}{'' if inside else '  (DIFFERENT from the state record!)'}")
    if not inside:
        causes.append("the pid's argv names a different release than the state record")
        problem += 1
print(f"PATCHES         {len(state.get('patches', []))}")

record_path = os.path.join(release, '.dsh-build', 'genesis-artifacts.json')
record_sha = hashlib.sha256(open(record_path, 'rb').read()).hexdigest()
print(f"RECORD SHA256   {record_sha}")
print(f"GENESIS COMMIT  {state.get('genesisCommit')}")
head = subprocess.run(['git', '-C', repo, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
print(f"CHECKOUT HEAD   {head}")

# ── HAS THE TREE MOVED PAST THE LIVE RELEASE, AND DOES THAT MATTER? ─────────────────────────────
# "The tree is ahead" is true every time anyone commits a report line, and it says nothing about the
# app. The question that matters is whether any path THE RELEASE CARRIES (attested in its record) or
# the launcher pins (the record's genesis entries) has moved since the commit the release records.
# Measured 2026-09-22 with 8 paths changed and NONE of them carried: the live release was still the
# tree it was cut from, for every loaded row, and calling that STAGED-NOT-RUNNING would have been
# wrong. So the verdict is printed as one of the two facts, never as an impression.
release_commit = state.get('genesisCommit') or ''
if release_commit:
    # BOTH MOVEMENTS COUNT: commits since the release's commit AND uncommitted tracked changes. The
    # first version of this section compared only `git diff <commit>..HEAD`, so it reported
    # LIVE_MOUNTED while the working tree held edited bytes of carried files — measured on 2026-09-22
    # during the identity cleanup, which changed two carried nostr modules and stayed invisible until
    # they were committed. An uncommitted edit is still a byte the release does not carry.
    diff = subprocess.run(['git', '-C', repo, 'diff', '--name-only', f'{release_commit}..HEAD'],
                          capture_output=True, text=True).stdout.split()
    dirty = [line[3:].strip() for line in
             subprocess.run(['git', '-C', repo, 'status', '--porcelain', '--untracked-files=no'],
                            capture_output=True, text=True).stdout.splitlines() if len(line) > 3]
    moved_paths = sorted(set(diff) | set(dirty))
    # Loaded here rather than reused from the rows loop below: this section runs first, and a name
    # that is defined later would make the command die exactly when the tree HAS moved — the case it
    # exists for.
    try:
        release_record = json.load(open(record_path, encoding='utf-8'))
    except (OSError, ValueError):
        release_record = {}
    carried_paths = {entry.get('path') for entry in release_record.get('entries', [])}
    genesis_paths = {entry.get('path') for entry in (release_record.get('genesis') or {}).get('entries', [])}

    # A REPO PATH AND A RELEASE PATH ARE NOT THE SAME STRING, and the carry that moves a tree proves
    # it: the release keeps its faces FLATTENED (`plugins/aukora-face-messages/...`) and its nostr tree
    # at the ROOT (`aukora-nostr/...`), while the checkout holds `plugins/aukora-face/messages/...` and
    # `plugins/aukora-nostr/...`. Comparing raw strings therefore labelled the two moved nostr modules
    # as genesis-covered only, when they are BOTH carried and covered. Measured on 2026-09-22.
    def release_twin(repo_path):
        if repo_path.startswith('plugins/aukora-face/'):
            rest = repo_path[len('plugins/aukora-face/'):]
            name, _, tail = rest.partition('/')
            return f'plugins/aukora-face-{name}/{tail}'
        if repo_path.startswith('aukora-nostr/'):
            return repo_path
        if repo_path.startswith('plugins/aukora-nostr/'):
            return repo_path[len('plugins/'):]
        if repo_path.startswith('vendor/dsh/'):
            return repo_path[len('vendor/dsh/'):]
        return repo_path

    moved_carried = sorted(p for p in moved_paths if release_twin(p) in carried_paths)
    moved_genesis = sorted(p for p in moved_paths if p in genesis_paths)
    print(f"TREE AHEAD      {len(moved_paths)} path(s) since {release_commit[:8]} "
          f"({len(diff)} committed, {len(dirty)} uncommitted): "
          f"{len(moved_carried)} carried by the release, {len(moved_genesis)} genesis-covered")
    for path in (moved_carried + moved_genesis)[:5]:
        print(f"                moved: {path}")
    if moved_carried or moved_genesis:
        print("                STAGED-NOT-RUNNING: a path this release carries or the launcher pins has")
        print("                moved in the tree; the running app still serves the older bytes.")
        causes.append("STAGED-NOT-RUNNING: the tree is ahead of the release for "
                      + ", ".join((moved_carried + moved_genesis)[:3]))
        problem += 1
    else:
        print("                no carried or covered path moved: the live release is still the tree it")
        print("                was cut from for every row above (report/script/test commits do not count)")
else:
    print("TREE AHEAD      no — the checkout is at the commit this release records")

# ── what the release's OWN loader says it mounts, from the pid's own patch list ─────────────────
patches = [p['path'] if isinstance(p, dict) else p for p in state.get('patches', [])]
eff_text, eff_note = '', ''
home = tempfile.mkdtemp(prefix='organism-live-')
try:
    os.makedirs(os.path.join(home, 'home'), exist_ok=True)
    os.makedirs(os.path.join(home, 'agents'), exist_ok=True)
    args = ['node', os.path.join(release, 'apps/cli/lib/bin.js'), '--dump-config']
    for p in patches:
        args += ['--patch', p]
    args += ['--profile', 'web']
    env = dict(os.environ, DSH_HOME=os.path.join(home, 'home'), DSH_AGENTS_HOME=os.path.join(home, 'agents'),
               DSH_TELEMETRY_MODE='DISABLED')
    dump = subprocess.run(args, capture_output=True, text=True, cwd=home, env=env)
    if dump.returncode != 0:
        eff_note = (dump.stderr or dump.stdout).strip().splitlines()[-1:]
        eff_note = eff_note[0] if eff_note else 'loader refused'
    else:
        eff_text = dump.stdout
finally:
    subprocess.run(['rm', '-rf', home])

if eff_text == '':
    print(f"EFFECTIVE LIST  NOT MEASURED — the release's own loader refused: {eff_note}")
    loadable = False
else:
    loadable = True
    loaded_ids = set(re.findall(r'^- id: ([a-z0-9-]+)', eff_text, re.M))
    print(f"EFFECTIVE LIST  {len(loaded_ids)} rows, built from the pid's own {len(patches)} patch(es)")

# ── every mounted artifact: bytes release vs tree, and whether it is LOADED ─────────────────────
def sha(path):
    data = open(path, 'rb').read()
    return len(data), hashlib.sha256(data).hexdigest()[:10]

def twin(path, release_root, checkout):
    relative = os.path.relpath(path, release_root)
    if relative.startswith('plugins/aukora-face-'):
        rest = relative[len('plugins/aukora-face-'):]
        name, _, tail = rest.partition('/')
        cand = os.path.join(checkout, 'plugins/aukora-face', name, tail)
    elif relative.startswith('packages/'):
        cand = os.path.join(checkout, 'vendor/dsh', relative)
    elif relative.startswith('aukora-nostr/'):
        cand = os.path.join(checkout, 'plugins', relative)
    else:
        cand = os.path.join(checkout, relative)
    return cand if os.path.isfile(cand) else None

rows = {}
for patch in patches:
    if not os.path.isfile(patch):
        print(f"PATCH           ABSENT — {patch}")
        problem += 1
        continue
    for line in open(patch, encoding='utf-8'):
        match = re.match(r"\s*-?\s*name:\s*(\S+)\s*$", line)
        if not match:
            continue
        name = match.group(1)
        if name.startswith('./'):
            path = os.path.join(os.path.dirname(patch), name[2:])
        elif name.startswith('/'):
            path = name
        else:
            continue
        if not os.path.isfile(path):
            continue
        row_id = os.path.basename(os.path.dirname(os.path.dirname(path)))
        rows[row_id] = path

# A ROW WITH NO CHECKOUT TWIN IS NOT A FAILURE — IT IS A DIFFERENT PROOF. `aukora-aura-association` is
# carried into the release from the aura adapter candidate, so there is no file of that name in this
# checkout to compare against; measured 2026-09-22, the first version of this script counted that as a
# failing row while the release's own record attested it exactly. The tree-independent attestation is
# the record itself — the artifact record the launcher verifies — so that is what such a row is
# matched against, and printing `record` says which of the two proofs the row carries.
record_entries = {}
try:
    for entry in json.load(open(record_path, encoding='utf-8')).get('entries', []):
        record_entries[entry.get('path')] = (entry.get('bytes'), entry.get('sha256'))
except (OSError, ValueError):
    record_entries = {}

print()
print(f"  {'ROW':<26}{'BYTES':>9}  {'SHA256-10':<11}{'TREE':<18}{'MATCH':<6}LOADED")
for row_id in sorted(rows):
    path = rows[row_id]
    size, digest = sha(path)
    mate = twin(path, release, repo)
    if mate is None:
        # No checkout twin: match the release's own record instead (see the note above the loop).
        recorded = record_entries.get(os.path.relpath(path, release))
        if recorded is None:
            tree, match = '—', 'no-attestation'
        else:
            # THE RECORD HOLDS THE FULL DIGEST and the line prints a ten-character prefix, so the
            # comparison re-hashes: comparing a prefix against a full digest reads as DIFF for every
            # honest file. Measured on the first run of this branch, which reported the aura row red
            # while the record and the disk agreed byte for byte.
            full = hashlib.sha256(open(path, 'rb').read()).hexdigest()
            tree, match = f"record/{recorded[0]}", 'SAME' if recorded[1] == full else 'DIFF'
    else:
        mate_size, mate_digest = sha(mate)
        tree = f"{mate_size}/{mate_digest}"
        match = 'SAME' if mate_digest == digest else 'DIFF'
    if not loadable:
        loaded = 'NOT MEASURED'
    else:
        loaded = 'yes' if row_id in loaded_ids else 'NO'
    if match != 'SAME' or loaded != 'yes':
        causes.append(f"{row_id} is {match} and LOADED={loaded}")
        problem += 1
    print(f"  {row_id:<26}{size:>9}  {digest:<11}{tree:<18}{match:<6}{loaded}")

# the two halves of a face are separate artifacts, and a carried tree is a third
for name in ('layout', 'sidebar', 'threads', 'apps', 'messages', 'documents', 'aumlok', 'settings'):
    path = os.path.join(release, 'plugins', f'aukora-face-{name}', 'lib', 'client.js')
    mate = os.path.join(repo, 'plugins/aukora-face', name, 'lib/client.js')
    if os.path.isfile(path):
        size, digest = sha(path)
        mate_size, mate_digest = sha(mate) if os.path.isfile(mate) else (0, '—')
        match = 'SAME' if mate_digest == digest else 'DIFF'
        if match != 'SAME':
            causes.append(f"face-{name} page is {match}")
            problem += 1
        print(f"  {'face-' + name + ' (page)':<26}{size:>9}  {digest:<11}{f'{mate_size}/{mate_digest}':<18}{match:<6}yes")

# ── the two facts a release cannot carry: what the shell handed over, and the door's fence ──────
env_text = subprocess.run(['ps', '-E', '-p', str(pid)], capture_output=True, text=True).stdout
env = {}
for token in env_text.split():
    if '=' in token:
        key, _, value = token.partition('=')
        if re.fullmatch(r'[A-Z][A-Z0-9_]*', key):
            env[key] = value
print()
for name in ('AUKORA_EYE_URL', 'AUKORA_EYE_TOKEN', 'AUKORA_SIGNER_SOCKET'):
    print(f"  {'present' if name in env else 'ABSENT '}  {name}")
if not all(n in env for n in ('AUKORA_EYE_URL', 'AUKORA_EYE_TOKEN', 'AUKORA_SIGNER_SOCKET')):
    print("  WARN     the shell's eye/signer wiring is not in this backend's environment: the release is")
    print("           mounted, and `aukora_see` would refuse `eye.not-configured` — a different fact from")
    print("           whether the rows above are live, which is why it is printed rather than folded in")

door = env.get('AUKORA_EYE_URL')
if door:
    # A stranger's request: no token. A fence that answers anything but 401 is not a fence.
    probe = subprocess.run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST',
                            f'{door}/eye/capture', '-H', 'content-type: application/json', '-d', '{}'],
                           capture_output=True, text=True)
    code = probe.stdout.strip()
    print(f"  {'ok     ' if code == '401' else 'REFUSED'}  door answers {code or 'nothing'} to a stranger "
          f"({door}){' — expected 401' if code != '401' else ''}")

print()
if problem == 0:
    print("ORGANISM-LIVE: LIVE_MOUNTED — every mounted artifact is SAME and LOADED")
    raise SystemExit(0)
# THE SUMMARY NAMES THE CAUSE, not a category it might not be in. Aura's finding: with the tree ahead of
# the release the sentence said "DIFF, ABSENT or NOT LOADED" about artifacts that are none of the three —
# they are SAME and LOADED, and the release is simply behind the checkout. Each problem now appends the
# sentence that describes IT, and the tree-ahead one says STAGED-NOT-RUNNING by name.
print(f"ORGANISM-LIVE: NOT LIVE_MOUNTED — {problem} problem(s): " + "; ".join(causes[:6]))
raise SystemExit(1)
PY
