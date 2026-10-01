#!/usr/bin/env node
/**
 * AUMA BECOMES HER APPROVED CHANGE: build it into a release, have the owner approve loading it, restart into it.
 *
 *   node scripts/aukora/become.mjs --commit <sha> [--why "<one line>"] [--plan]
 *
 * It ALWAYS runs detached (its own session, parent gone), because the app restart it causes takes down the backend whose
 * tool shell the command may have been typed in; a run that stayed in that tree could die after the quit, before the
 * reopen, and leave the app down (and its log is a pipe to a process that is gone). The
 * command returns at once and names the log (the caller's log file when stdout is one, else
 * state/home/become/become-<sha>-<ms>.log). `--detach` is accepted and means the same. `--plan` runs in the foreground
 * and changes nothing live (it writes last.json only).
 *
 * self-change.mjs spawns this after an approved change reaches GitHub main. It runs from the MAIN checkout (the one that
 * holds vendor/dsh), and it survives the app restart it causes. Steps, each logged:
 *   1. one become at a time (state/home/become/lock); refuse a commit that drops what the running release carries;
 *   2. under the heavy-run lock (one heavy run on this Mac at a time; memory read after the lock is granted): park older
 *      releases the retention check names as free to move (rename, never delete), cut the release at <sha>
 *      (scripts/aukora/cut-release.sh: clean worktree, pinned harness, materialize, boot smoke), and, if the shell's
 *      sources changed since the installed one was built, build it; nothing live is touched yet;
 *   3. back up every live file this touches, then the plugin set: if the installed approval already covers the new
 *      release's plugin bytes, no popup; otherwise ONE AUKORA popup ("admit these plugins"), and a refusal stops here
 *      with everything put back;
 *   4. under the heavy-run lock: repoint the live rows that name the running release (config.json patch rows, the App
 *      Support patch files, state/gate-state/gate-config.json), then `desktop-cutover prepare` (the live check);
 *   5. record the fixture confinement probe (no live guest; its verdict does not block this restart), then quit the app,
 *      `desktop-cutover apply`, swap the shell if one was built, reopen, and wait for the desktop log to
 *      say the new release loaded. If it does not within the timeout, everything is restored from step 3's backups
 *      (and the old shell), and the app is reopened on the release it was running.
 * From the first live write on, ANY exit (a refusal, a crash, a signal) puts back what was changed and reopens the app
 * if it was quit. The result is written to state/home/become/last.json and appended to the code Aura chain
 * (operation code.become).
 *
 * WHAT THIS IS NOT: the plugin-set approval is signed by a software key on this Mac (attendance reported, not proven),
 * and this script runs as the owner's user, so it is the supported path, not an enforced one.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, copyFileSync, existsSync, fstatSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeChain } from './aura-code.mjs'
import { root, consistencyProof } from './aura-merkle.mjs'
import { acquireHeavyRun } from '../lib/heavy-run.mjs'
import { isMainModule } from '../lib/is-main.mjs'
import { probeConfinement } from './guest-start.mjs'
import { releaseBinding, sameBinding } from './release-digest.mjs'
import { readOwnerDaemonConfig } from '../../apps/aukora-desktop/aumlok-airlock-config.mjs'
import { assertOwnerDaemonProtocol } from '../../apps/aukora-desktop/aumlok-signer-airlock.mjs'
import * as ownerApproval from '../../plugins/aukora-aumlok/lib/owner-approval.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SUPPORT = process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
const STATE = join(SUPPORT, 'state')
const RELEASES = process.env.AUKORA_RELEASES_ROOT ?? join(homedir(), 'au91-root')
const SUPPORT_COPY = process.env.AUKORA_SUPPORT_COPY ?? join(homedir(), 'aukora-support-copy-a0bd')
const APP = '/Applications/AUKORA.app'
const APP_BACKUPS = join(homedir(), 'aukora-private', 'app-backups')
const DESKTOP_LOG = join(STATE, 'logs', 'desktop.log')
const HOME_DIR = join(STATE, 'home', 'become')
const CUTOVER = join(REPO, 'scripts', 'aukora', 'desktop-cutover.mjs')
const PLUGIN_SET = join(REPO, 'scripts', 'aukora', 'plugin-set.mjs')
const BOOT_TIMEOUT_MS = 180_000

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const PLAN = args.includes('--plan')
const commitArg = flag('--commit')
const why = flag('--why') ?? ''

// The live backend's own channels. The launcher forwards exactly these into any backend it starts, so a boot smoke run
// from a become started inside the app would be handed the live eye token and the live signer socket. A become is not the
// backend; they are dropped before anything is spawned.
if (isMainModule(import.meta.url)) for (const name of ['AUKORA_EYE_URL', 'AUKORA_EYE_TOKEN', 'AUKORA_SIGNER_SOCKET']) delete process.env[name]

const stamp = () => new Date().toISOString()
const say = (line) => process.stdout.write(`${stamp()} ${line}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, argv, options = {}) => {
  const out = spawnSync(cmd, argv, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })
  return { status: out.status, text: `${out.stdout ?? ''}${out.stderr ?? ''}` }
}
const git = (...argv) => run('/usr/bin/git', ['-C', REPO, ...argv])
const memoryLevel = () => Number(run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level']).text.trim()) || 0
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function shellCheckoutRefusal({ head, commit, dirty }) {
  if (head !== commit) return `checkout not at commit: ${head} versus ${commit}`
  if (dirty !== '') return `dirty shell sources (${dirty.split('\n').length} path(s))`
  return null
}
export function requiredShellRefusal({ shellChanged, newShell, reason }) {
  return shellChanged && newShell === null
    ? `required shell rebuild unavailable: ${reason ?? 'no packed shell'}; nothing live changed` : null
}

export function shellSourcePaths(git, commit) {
  const paths = ['apps/aukora-desktop']
  try {
    const shown = git('show', `${commit}:apps/aukora-desktop/package.json`)
    if (shown.status !== 0) throw new Error('shell package unavailable')
    for (const extra of JSON.parse(shown.text).build?.extraFiles ?? []) {
      const from = posix.normalize(posix.join('apps/aukora-desktop', extra.from))
      for (const name of extra.filter ?? ['']) paths.push(posix.join(from, name))
    }
  } catch { paths.push('plugins') }
  return paths
}

// Called only after target ancestry and exact Aura MATCH. No checkout writes in plan mode.
export function advanceApprovedCheckout({ git, commit, paths, plan = false }) {
  const head = () => git('rev-parse', '--verify', 'HEAD')
  const dirty = () => git('--no-optional-locks', 'status', '--porcelain', '-uall', '--', ...paths)
  const before = head(), edited = dirty()
  if (before.status !== 0 || edited.status !== 0) return { refusal: 'checkout state could not be verified', advanced: false }
  if (plan) return { refusal: shellCheckoutRefusal({ head: before.text.trim(), commit, dirty: edited.text.trim() }), advanced: false }
  if (edited.text.trim()) return { refusal: `dirty approved sources (${edited.text.trim().split('\n').length} path(s))`, advanced: false }
  if (before.text.trim() !== commit) {
    if (git('merge-base', '--is-ancestor', before.text.trim(), commit).status !== 0) {
      return { refusal: `checkout ${before.text.trim()} cannot fast-forward to approved target ${commit}`, advanced: false }
    }
    // Disable executable hooks: the only permitted checkout mutation is this verified fast-forward.
    if (git('-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', '-q', commit).status !== 0) {
      return { refusal: `fast-forward to approved target ${commit} failed`, advanced: false }
    }
  }
  const after = head(), finalDirty = dirty()
  if (after.status !== 0 || finalDirty.status !== 0) return { refusal: 'advanced checkout state could not be verified', advanced: false }
  return { refusal: shellCheckoutRefusal({ head: after.text.trim(), commit, dirty: finalDirty.text.trim() }),
    advanced: before.text.trim() !== after.text.trim() }
}
const tail = (text, n = 12) => text.trim().split('\n').slice(-n).join('\n')

let result = { commit: commitArg ?? null, why, startedAt: stamp(), outcome: 'running', steps: [] }
let confinement = { verdict: 'NOT_RUN', detail: 'become ended before the confinement probe' }
let confinementProbed = false
const step = (name, detail = {}) => { result.steps.push({ at: stamp(), name, ...detail }); say(`STEP ${name}${detail.note ? `: ${detail.note}` : ''}`) }
const writeResult = () => {
  // Also covers crashes before the probe; finishOutcome chains this same body.
  result.body = { ...result.body, confinement }
  writeFileSync(join(HOME_DIR, 'last.json'), `${JSON.stringify(result, null, 2)}\n`)
}
const observeConfinement = () => {
  confinement = probeConfinement()
  confinementProbed = true
  step('confinement', { note: `${confinement.verdict}: ${confinement.detail}` })
}
/** Set once the first live file is about to change: puts back everything, reopens the app if it was quit. */
let rescue = null
let rescuing = null
/** Runs the rescue at most once; a second caller (a signal during a rollback) waits for the same one. */
const putBack = () => { if (rescuing === null && rescue !== null) rescuing = rescue(); return rescuing ?? Promise.resolve(null) }
/** The heavy-run lock while it is held, so every exit path releases it. */
let heavyLock = null
const dropHeavy = () => { if (heavyLock !== null) { heavyLock.release(); heavyLock = null } }

/** The head (sequence, hash) of one Aura chain under state/home, or null. */
const chainHead = (rel) => {
  try {
    const entry = JSON.parse(readFileSync(join(STATE, 'home', rel), 'utf8').trim().split('\n').pop())
    return { sequence: entry.sequence ?? null, hash: entry.hash ?? null }
  } catch { return null }
}
/**
 * WHAT SHE IS, AT THE MOMENT A BECOME ENDS (the coherence record, 2026-09-27): the release that is running, the plugin set
 * it loads, and the heads of her four chains. Chained with every outcome, so each version of her
 * body is one entry, and a drift in any of them between two entries is visible.
 */
function bodyState(running) {
  let pluginSet = null
  try { pluginSet = readJson(join(running, '.dsh-build', 'plugin-set.json')).setDigest ?? null } catch { /* none */ }
  return { release: running, pluginSet,
    heads: Object.fromEntries(Object.entries(chainPaths).map(([name, path]) => [name, chainHead(path)])) }
}

export const chainPaths = Object.freeze({ code: 'aura-code/aura.jsonl', actions: 'aura-actions/aura.jsonl',
  memory: 'kira-memory/aura.jsonl', remembered: 'kira-memory/remembered/aura.jsonl' })
export const retainedPath = (support) => join(support, 'state/home/become/membrane-retained.json')
const VERIFIER = join(REPO, 'vendor/append-only/verify.py')
// Project one head only AFTER the carried verifier admits the original bytes. JSON.parse below is a proof-size hint,
// not admission: reserializing there would erase duplicate keys and noncanonical numeric tokens.
const projectHead = `
import json, runpy, sys
v = runpy.run_path(sys.argv[1])
try:
    r = json.loads(v['read_input_path'](sys.argv[2]).decode('utf-8'),
        object_pairs_hook=v['no_duplicate_keys'], parse_int=v['check_canonical_int'],
        parse_float=v['reject_float'], parse_constant=v['reject_constant'])
    if not isinstance(r, dict): raise ValueError()
    empty = {'treeSize': 0, 'root': v['hashlib'].sha256(b'').hexdigest()}
    if 'chains' in r:
        if not isinstance(r['chains'], dict): raise ValueError()
        r = r['chains'].get(sys.argv[4], empty)
    else:
        if not v['is_size'](r.get('treeSize')) or not v['is_digest'](r.get('root')): raise ValueError()
        if sys.argv[4] != 'code': r = empty
    if not isinstance(r, dict): raise ValueError()
    with open(sys.argv[2], 'w') as f: json.dump(r, f)
except Exception:
    print('VERDICT: UNDETERMINED\\nREASON : document_is_not_admissible'); sys.exit(0)
sys.argv = sys.argv[1:4]
v['main']()
`

// Only LF-terminated records are leaves. Preserve whitespace/CR; report a torn tail separately.
function readAura(path, required = false) {
  let bytes, fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (required ? constants.O_NOFOLLOW : 0))
    if (!fstatSync(fd).isFile()) throw Object.assign(new Error('chain is not a regular file'), { code: 'not_regular' })
    bytes = readFileSync(fd)
  }
  catch (error) { if (error.code === 'ENOENT' && !required) bytes = Buffer.alloc(0); else throw error }
  finally { if (fd !== undefined) closeSync(fd) }
  const leaves = []
  let start = 0
  for (let end = 0; end < bytes.length; end += 1) {
    if (bytes[end] === 10) { leaves.push(bytes.subarray(start, end)); start = end + 1 }
  }
  return { bytes, leaves, unterminatedTailBytes: bytes.length - start }
}
export const auraLeaves = (support, name) => readAura(join(support, 'state/home', chainPaths[name])).leaves

function observeHistory(history, name, retainedBytes, prior, verifier) {
  const { leaves, unterminatedTailBytes } = history
  const retainedSize = prior?.treeSize ?? 0
  const presented = { treeSize: leaves.length, root: root(leaves), proofFromPrevious: [] }
  if (Number.isSafeInteger(retainedSize) && retainedSize >= 0 && retainedSize <= leaves.length) {
    presented.proofFromPrevious = consistencyProof(leaves, retainedSize)
  }
  const dir = mkdtempSync(join(tmpdir(), 'aukora-membrane-'))
  const observation = { retainedSize, retainedRoot: prior?.root ?? root([]),
    presentedSize: leaves.length, presentedRoot: presented.root, unterminatedTailBytes }
  const unavailable = (reason) => ({ ...observation, verdict: 'UNDETERMINED', reason })
  try {
    try { if (!statSync(verifier).isFile()) return unavailable('verifier_not_regular') }
    catch (error) { return unavailable(`verifier_${error.code ?? 'unavailable'}`) }
    const previous = join(dir, 'retained.json'), current = join(dir, 'presented.json')
    writeFileSync(previous, retainedBytes, { mode: 0o600 })
    writeFileSync(current, JSON.stringify(presented), { mode: 0o600 })
    const checked = spawnSync('python3', ['-B', '-c', projectHead, verifier, previous, current, name],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 })
    if (checked.error || checked.signal || checked.status !== 0) {
      return unavailable(`verifier_${checked.error?.code ?? checked.signal ?? `exit_${checked.status}`}`)
    }
    const output = checked.stdout ?? ''
    const verdicts = [...output.matchAll(/^VERDICT:[ \t]*(APPEND_ONLY|OBSERVATION_CONFLICT|UNDETERMINED)[ \t]*$/gmu)]
    const reasons = [...output.matchAll(/^REASON[ \t]*:[ \t]*(\S+)[ \t]*$/gmu)]
    const verdict = verdicts[0]?.[1], reason = reasons[0]?.[1]
    const knownLine = (line) => /^(?:RETAINED_SHA256 :|PRESENTED_SHA256:) [0-9a-f]{64}$/u.test(line)
      || /^VERDICT:[ \t]*(APPEND_ONLY|OBSERVATION_CONFLICT|UNDETERMINED)[ \t]*$/u.test(line)
      || /^REASON[ \t]*:[ \t]*\S+[ \t]*$/u.test(line)
      || (verdict === 'OBSERVATION_CONFLICT' && line === `CLEAR: python3 verify.py ${previous}`)
      || (reason === 'POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE' && line === 'LIMIT: Retained m is 2^k; root1 is fold seed.')
    if (checked.stderr || verdicts.length !== 1 || reasons.length !== 1
      || output.trimEnd().split('\n').some((line) => !knownLine(line))
      || (output.match(/^VERDICT:/gmu) ?? []).length !== 1 || (output.match(/^REASON\b/gmu) ?? []).length !== 1
      || (verdict === 'APPEND_ONLY' && !['identical_trees_match', 'valid_append_only_extension'].includes(reason))
      || (verdict === 'OBSERVATION_CONFLICT' && !['same_size_root_mismatch', 'consistency:prefix-mismatch'].includes(reason))) {
      return unavailable('verifier_unknown_output')
    }
    return { ...observation, verdict, reason }
    // The verifier reports POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE as UNDETERMINED, never conflict.
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
function observeChain(support, name, retainedBytes, prior, verifier) {
  const path = join(support, 'state/home', chainPaths[name])
  let history
  try { history = readAura(path) }
  catch (error) { return { verdict: 'UNDETERMINED', reason: `chain_${error.code ?? 'unreadable'}`, presentedSize: null } }
  const check = (snapshot) => observeHistory(snapshot, name, retainedBytes, prior, verifier)
  const seen = new Set(['aura.jsonl'])
  const observeSegment = (snapshot) => {
    const row = check(snapshot)
    // Once a segment is retained, ordinary extension verification is sufficient. No prior is a first observation.
    if (name !== 'actions' || row.verdict === 'APPEND_ONLY' || row.reason === 'missing_prior_observation') return row
    let marker
    try { marker = JSON.parse(snapshot.leaves[0]?.toString('utf8')) } catch { return row }
    if (marker?.op !== 'segment') return row
    const safeFile = typeof marker.previousFile === 'string' && /^aura-[\w.-]+\.jsonl$/u.test(marker.previousFile)
    const rotation = { reason: marker.reason, previousFile: safeFile ? marker.previousFile : '(invalid previousFile)' }
    const refused = (reason) => ({ ...row, verdict: 'UNDETERMINED', reason,
      rotation: { ...rotation, failure: true } })
    if (!['rotated', 'previous-tail-unusable'].includes(marker.reason)) return refused('rotation_unknown_reason')
    if (!safeFile || seen.has(marker.previousFile) || seen.size >= 64) return refused('rotation_invalid_previous_file')
    // A rotation cannot excuse a verifier/input failure; only a changed or smaller presentation can be bridged.
    if (row.verdict !== 'OBSERVATION_CONFLICT'
      && !['invalid_tree_sizes', 'POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE'].includes(row.reason)) return refused(row.reason)
    seen.add(marker.previousFile)
    let previous
    try { previous = readAura(join(dirname(path), marker.previousFile), true) }
    catch (error) { return refused(`rotation_previous_${error.code ?? 'unreadable'}`) }
    if (marker.reason === 'rotated') {
      let last
      try { last = JSON.parse(previous.leaves.at(-1)?.toString('utf8')) } catch { return refused('rotation_previous_last_entry_invalid') }
      if (!Number.isSafeInteger(marker.previousSequence) || typeof marker.previousHash !== 'string'
        || marker.previousSequence !== last?.sequence || marker.previousHash !== last?.hash) return refused('rotation_previous_head_mismatch')
    } else if (marker.previousSha256 !== createHash('sha256').update(previous.bytes).digest('hex')) {
      return refused('rotation_previous_digest_mismatch')
    }
    const observed = observeSegment(previous)
    if (observed.verdict !== 'APPEND_ONLY' && !observed.rotation?.verified) {
      return refused(`rotation_previous_${observed.reason}`)
    }
    return { ...row, verdict: 'UNDETERMINED', reason: 'missing_prior_observation', rotation: { ...rotation,
      verified: true, previousVerdict: observed.verdict, previousUnterminatedTailBytes: previous.unterminatedTailBytes } }
  }
  return observeSegment(history)
}
export function membraneObservation(support = SUPPORT, { verifier = VERIFIER } = {}) {
  let raw, retained, failure
  try {
    const info = statSync(retainedPath(support))
    if (!info.isFile() || info.size > 1_048_576) throw new Error('retained_input_invalid')
    raw = readFileSync(retainedPath(support))
  } catch (error) {
    if (error.code === 'ENOENT') raw = '{"chains":{}}'
    else failure = `retained_${error.code ?? 'input_invalid'}`
  }
  try { retained = JSON.parse(raw) } catch { /* the cold parser decides */ }
  const chains = {}
  for (const name of Object.keys(chainPaths)) {
    const prior = retained?.chains ? retained.chains[name] : name === 'code' ? retained : undefined
    try {
      chains[name] = failure ? { verdict: 'UNDETERMINED', reason: failure, presentedSize: null }
        : observeChain(support, name, raw, prior, verifier)
    } catch (error) {
      chains[name] = { verdict: 'UNDETERMINED', reason: `observation_${error.code ?? 'unavailable'}`, presentedSize: null }
    }
  }
  return { chains }
}

export const membraneConflicts = ({ chains }) => Object.keys(chains).filter((name) => chains[name].verdict === 'OBSERVATION_CONFLICT')

export function retainMembrane(support, membrane, outcome) {
  if (outcome !== 'live' || membraneRefusal(membrane)) return false
  const chains = Object.fromEntries(Object.entries(membrane.chains).map(([name, row]) => [name,
    { treeSize: row.presentedSize, root: row.presentedRoot }]))
  // The caller holds the code writer lock through verification, append and retention. Other histories retain snapshots.
  const leaves = auraLeaves(support, 'code')
  chains.code = { treeSize: leaves.length, root: root(leaves) }
  const home = dirname(retainedPath(support))
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const dir = mkdtempSync(join(home, '.membrane-'))
  const syncDirectory = (path) => {
    const fd = openSync(path, constants.O_RDONLY)
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
  try {
    const path = join(dir, 'head.json')
    const fd = openSync(path, 'wx', 0o600)
    try { writeFileSync(fd, `${JSON.stringify({ chains })}\n`); fsyncSync(fd) } finally { closeSync(fd) }
    syncDirectory(dir)
    syncDirectory(home)
    renameSync(path, retainedPath(support))
    syncDirectory(home)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return true
}
export function membraneRefusal({ chains }) {
  for (const name of Object.keys(chainPaths)) {
    const row = chains[name] ?? { verdict: 'UNDETERMINED', reason: 'observation_missing' }
    if (row.rotation?.failure) return `the ${name} rotation (${row.rotation.reason}, ${row.rotation.previousFile}) could not be verified (${row.reason}). Recovery: restore the matching previous actions segment beside aura.jsonl and rerun become --plan.`
    if (row.verdict === 'OBSERVATION_CONFLICT') return `OBSERVATION_CONFLICT: the ${name} chain was rewritten since the last become (${row.reason})`
    if (row.verdict === 'UNDETERMINED' && row.reason !== 'missing_prior_observation') {
      return `the ${name} chain could not be verified (${row.reason})`
    }
    if (!['APPEND_ONLY', 'UNDETERMINED', 'OBSERVATION_CONFLICT'].includes(row.verdict)) return `the ${name} chain could not be verified (unknown_verdict)`
  }
  return null
}
function guardMembrane() {
  const membrane = membraneObservation()
  result.body = { ...result.body, membrane }
  step('membrane', { note: Object.entries(membrane.chains).map(([name, row]) =>
    `${name} size=${row.presentedSize ?? '?'} ${row.verdict} ${row.reason}${row.unterminatedTailBytes ? ` unterminated_tail_bytes=${row.unterminatedTailBytes}` : ''}`).join('; ') })
  const refusal = membraneRefusal(membrane)
  if (refusal) finish('refused', refusal)
}

// Unwind main immediately; finalization may need to await rollback before recording a refusal.
class BecomeOutcome extends Error {
  constructor(outcome, note) { super(note); this.outcome = outcome }
}
function finish(outcome, note) { throw new BecomeOutcome(outcome, note) }
async function finishOutcome(outcome, note) {
  dropHeavy()
  // A guard may have refused after the live rows were repointed. Restore before observing again:
  // a transient refusal must not be erased by a successful second observation.
  if (outcome === 'refused') await putBack()
  // Plans and outcomes without a restart still get their own fresh observation.
  if (!confinementProbed) observeConfinement()
  if (outcome === 'rolled-back' && result.booted) outcome = 'booted'
  const chain = PLAN ? null : codeChain(STATE)
  const record = () => {
    const membrane = membraneObservation()
    const refusal = membraneRefusal(membrane)
    if (refusal) {
      outcome = 'refused'; note = refusal
      if (rescue !== null && rescuing === null) return false
    }
    const running = outcome === 'live' ? result.release : result.previousRelease
    result = { ...result, outcome, note, finishedAt: stamp(),
      body: { ...(running ? bodyState(running) : {}), observed: result.observed, membrane } }
    writeResult()
    if (chain) {
      try {
        chain.append({ verdict: 'observed', operation: 'code.become', commit: result.commit, release: result.release ?? null,
          outcome, note, previousRelease: result.previousRelease ?? null, body: result.body })
        retainMembrane(SUPPORT, membrane, outcome)
      } catch (error) { say(`AURA APPEND FAILED: ${error.message}`) }
    }
    // Recorded: a signal or failure from here on must not put back a release that came up.
    rescue = null
    return true
  }
  // Verification, append and retention share Aura's reentrant writer lock. Rollback cannot hold a synchronous lock.
  if (chain) {
    if (!chain.locked(record)) { await putBack(); chain.locked(record) }
  } else {
    record()
  }
  say(`BECOME ${outcome.toUpperCase()}: ${note}`)
  releaseLock()
  process.exit(outcome === 'live' || outcome === 'planned' ? 0 : 1)
}
/** Put everything back (when anything live was touched), then finish. */
async function giveUp(outcome, note) {
  const back = await putBack()
  finish(outcome, `${note}${back ? ` The app was reopened on ${basename(result.previousRelease ?? '?')}: ${back.ok ? 'running again' : `NOT confirmed running (${back.line})`}.` : ''}`)
}

// ── 1. ONE AT A TIME ────────────────────────────────────────────────────────────────────────────────
const LOCK = join(HOME_DIR, 'lock')
let locked = false
function takeLock() {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf8').trim())
    // An empty lock (a crash between create and write) reads as 0, and kill(0, 0) signals OUR OWN process group and
    // succeeds: that lock would stop every become for ever. Only a real pid can hold it; EPERM means it exists.
    let alive = false
    if (Number.isInteger(pid) && pid > 1) { try { process.kill(pid, 0); alive = true } catch (error) { alive = error?.code === 'EPERM' } }
    if (alive) { say(`another become is running (pid ${pid}); stopping`); process.exit(1) }
    unlinkSync(LOCK)
  }
  let fd
  try { fd = openSync(LOCK, 'wx', 0o600) } catch { say('another become took the lock at the same moment; stopping'); process.exit(1) }
  writeFileSync(fd, String(process.pid)); closeSync(fd); locked = true
}
function releaseLock() { if (locked) { try { unlinkSync(LOCK) } catch { /* gone */ } locked = false } }

/** Run ONLY when the memory level reaches `floor` within ten minutes. */
async function memoryAtLeast(floor, label) {
  for (let i = 0; i < 30; i += 1) {
    const level = memoryLevel()
    if (level >= floor) return true
    if (i === 0) say(`waiting for memory before ${label}: level ${level}, needs ${floor}`)
    await sleep(20_000)
  }
  return false
}
/**
 * ONE HEAVY RUN AT A TIME (scripts/lib/heavy-run.mjs). The release build, the shell build and the live check each hold
 * the machine-wide lock; the memory level is read AFTER it is granted, as heavy-run.sh does, because a reading taken in the
 * queue says nothing about the moment the work starts. desktop-cutover's courts see that an ancestor holds the lock and
 * run directly instead of queueing behind it. Returns false (lock released) when memory never reached `floor`.
 */
async function heavily(floor, label) {
  heavyLock = await acquireHeavyRun({ onWait: (holder) => say(`waiting for the heavy-run lock before ${label}${holder ? `: pid ${holder.pid} (${holder.argv}) holds it` : ''}`) })
  if (await memoryAtLeast(floor, label)) return true
  dropHeavy()
  return false
}

async function main() {
  if (!commitArg) { process.stderr.write('usage: become.mjs --commit <sha> [--why "…"] [--plan]\n'); process.exit(2) }
  mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 })
  if (!PLAN && process.env.AUKORA_BECOME_DETACHED !== '1') {
    // THE RESTART CAN END THE TREE THIS WAS TYPED IN, so the work always happens in a detached child whose parent exits now.
    // A caller that gave us a log FILE (self-change does) keeps it; anything else (a pipe to a tool that would wait for
    // it to close) gets a file of its own.
    let out = null
    let log = null
    try { if (fstatSync(1).isFile()) out = 1 } catch { /* not a file */ }
    if (out === null) { log = join(HOME_DIR, `become-${commitArg.slice(0, 9)}-${Date.now()}.log`); out = openSync(log, 'a', 0o600) }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args.filter((a) => a !== '--detach')],
      { cwd: REPO, detached: true, stdio: ['ignore', out, out], env: { ...process.env, AUKORA_BECOME_DETACHED: '1' } })
    child.unref()
    process.stdout.write(`BECOMING (pid ${child.pid}); log ${log ?? '(this file)'}\n`)
    process.exit(0)
  }
  if (!PLAN) takeLock()
  guardMembrane()
  // Fetch stderr may contain authenticated remote URLs; report status without echoing it.
  if (!PLAN) {
    const fetched = git('fetch', '-q', 'origin', 'main')
    if (fetched.status !== 0) finish('refused', `git fetch origin main failed (exit ${fetched.status ?? 'unavailable'}); origin/main was not refreshed; nothing live changed`)
  }
  const commit = git('rev-parse', '--verify', `${commitArg}^{commit}`).text.trim()
  if (!/^[0-9a-f]{40}$/u.test(commit)) finish('refused', `${commitArg} is not a commit this checkout has`)
  if (git('merge-base', '--is-ancestor', commit, 'origin/main').status !== 0) finish('refused', `${commit.slice(0, 9)} is not on GitHub main; activation requires a target commit on main with a matching approval record`)
  // ON MAIN IS NOT APPROVED: a direct push lands on main too. The commit must carry a matching approval record in the code
  // Aura chain (witness.mjs auditCommits: record verdict, tree, base and trailers). Imported late: witness imports this file.
  let audited
  try { audited = (await import('./witness.mjs')).auditCommits({ repo: REPO, support: SUPPORT, commit }).rows[0] }
  catch (error) { finish('refused', `the code Aura chain could not be audited (${error.message}); nothing live changed`) }
  if (audited?.commit !== commit || audited.verdict !== 'MATCH') finish('refused', `${commit.slice(0, 9)} has no approval record in the code Aura chain (${audited?.reason ?? 'not audited'}); activation requires a matching approval record for this target commit. Nothing live changed`)
  result.commit = commit
  const sha9 = commit.slice(0, 9)
  const target = join(RELEASES, `aukora-release-${sha9}`)
  const configPath = join(SUPPORT, 'config.json')
  const config = readJson(configPath)
  const live = config.release
  if (typeof live !== 'string' || live === '') finish('refused', `${configPath} names no running release`)
  result.release = target
  result.previousRelease = live
  step('start', { note: `commit ${sha9}${why ? ` (${why})` : ''}; live ${basename(live)}; target ${basename(target)}` })
  // ONLY THE APPROVED MACHINERY RUNS: this checkout at <commit> (fast-forward, re-run), nothing it imports edited.
  const shellPaths = shellSourcePaths(git, commit)
  const machineryPaths = ['scripts', 'upstream-dsh.json', ...shellPaths,
    ...['aumlok', 'composition-gate', 'owner-daemon', ...'approval memory-owner queue record strict-read'.split(' ').map(n => `kira/lib/${n}.mjs`)].map(p => `plugins/aukora-${p}`)]
  const checkout = advanceApprovedCheckout({ git, commit, paths: machineryPaths, plan: PLAN })
  if (checkout.refusal) {
    const off = `NOT the approved machinery: ${checkout.refusal}`
    PLAN ? step('machinery', { note: off }) : finish('refused', `${off}; nothing live changed`)
  }
  if (checkout.advanced) {
    releaseLock(); process.exit(spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' }).status ?? 1)
  }

  // The privileged daemon is a separate installation: rebuilding this shell never upgrades its protocol.
  if (!PLAN) {
    try {
      const ownerConfig = readOwnerDaemonConfig()
      if (ownerConfig !== null) await assertOwnerDaemonProtocol(ownerConfig, ownerApproval)
    } catch (error) { finish('refused', `${error.message}; owner daemon rollout must be completed explicitly; nothing live changed`) }
  }
  const seen = live === target ? await observe(basename(live)) : null
  if (seen) { result.observed = seen; finish(seen.pid ? 'live' : 'not-running', `${basename(live)} is the configured release; ${seen.pid ? `pid ${seen.pid} answers on ${seen.port}` : seen}`) }

  // NOTHING THE RUNNING RELEASE CARRIES MAY BE DROPPED. MEASURED 2026-09-27: the live release (8c972567f) was cut from a
  // local commit GitHub main does not have, so becoming any commit on main would have silently reverted it. A file the
  // running release changed since its common ancestor with <commit>, and that <commit> leaves as it was there, is a
  // regression; a change re-applied as a patch (a different commit, the same content) is not.
  let liveTip = null
  try { liveTip = readJson(join(live, '.dsh-build', 'aukora-release.json')).tipSha ?? null } catch { liveTip = null }
  const base = liveTip === null ? '' : git('merge-base', liveTip, commit).text.trim()
  if (!/^[0-9a-f]{40}$/u.test(base)) finish('refused', `the running release's commit (${liveTip ?? 'unreadable'}) is not in this checkout, so nothing proves ${sha9} keeps what the app runs now; nothing live changed`)
  const changedSince = (tip) => git('diff', '--name-only', '--no-renames', base, tip).text.trim().split('\n').filter(Boolean)
  const keeps = new Set(changedSince(commit))
  const dropped = changedSince(liveTip).filter((path) => !keeps.has(path))
  if (dropped.length > 0) {
    finish('refused', `${sha9} does not carry ${dropped.length} file(s) the running release ${basename(live)} changed (${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? ', …' : ''}); becoming it would revert them. Land the running release's commits on GitHub main first. Nothing live changed.`)
  }

  // THE SHELL IS apps/aukora-desktop PLUS THE PLUGIN FILES ITS package.json PACKS (build.extraFiles), so a change to any of
  // them is a shell change. The base is what the installed shell was built from: the marker, else the running release.
  const shellMarker = join(HOME_DIR, 'shell-commit')
  const shellFrom = existsSync(shellMarker) ? readFileSync(shellMarker, 'utf8').trim() : liveTip
  const shellChanged = git('diff', '--quiet', shellFrom, commit, '--', ...shellPaths).status !== 0

  // Refuse an unusable source checkout before planning or doing the release build.
  if (shellChanged) {
    const refusal = shellCheckoutRefusal({ head: git('rev-parse', 'HEAD').text.trim(), commit,
      dirty: git('--no-optional-locks', 'status', '--porcelain', '--', ...shellPaths).text.trim() })
    if (refusal) {
      const note = `required shell rebuild unavailable: ${refusal}; nothing live changed`
      PLAN ? step('shell', { note }) : finish('refused', note)
    }
  }

  if (PLAN) {
    step('plan', { note: `cut ${basename(target)} (parking only what the retention check names as free); keeps everything ${basename(live)} carries; shell ${shellChanged ? `rebuild (changed since ${shellFrom.slice(0, 9)})` : 'unchanged'}; memory level ${memoryLevel()}` })
    finish('planned', 'nothing was changed')
  }

  // ── 2. BUILD: THE RELEASE AND, IF IT CHANGED, THE SHELL (heavy; nothing live is touched) ───────────
  // Which older releases may be set aside is the release builder's decision (scripts/release-retention.py: protected
  // names, launch and rollback records). When it refuses for room it lists its candidates; only those it marks
  // `unprotected` AND lists with no inbound link from a state root and no process holding them open are parked, by rename,
  // never deleted, and the build is tried once more. A renamed tree breaks every link into it and every lazy import of a
  // process running from it.
  const park = (name, as) => {
    let parked = join(RELEASES, as)
    if (existsSync(parked)) parked = `${parked}-${Date.now()}`
    renameSync(join(RELEASES, name), parked)
    step('park', { note: `${name} → ${basename(parked)}` })
  }
  const parkNamed = (text) => {
    let count = 0
    for (const name of parkable(text)) {
      const path = join(RELEASES, name)
      if (path === live || path === target || !existsSync(path)) continue
      park(name, name.replace('aukora-release-', 'parked-release-'))
      count += 1
    }
    return count
  }
  const cutNeeded = !existsSync(join(target, '.dsh-build', 'plugin-set.json'))
  if ((cutNeeded || shellChanged) && !(await heavily(50, 'the release build'))) finish('stopped', `memory stayed below 50 for 10 minutes before the release build; nothing live changed. Re-run: node scripts/aukora/become.mjs --commit ${sha9}`)
  if (cutNeeded) {
    // A target left half-built by an earlier run makes the materializer refuse `release-exists` for this commit for ever.
    if (existsSync(target)) park(basename(target), `parked-release-${sha9}-unfinished`)
    step('cut', { note: 'materialize + boot smoke (about a minute)' })
    const cutOnce = () => run('/bin/sh', [join(REPO, 'scripts', 'aukora', 'cut-release.sh'), commit, '--home-session', 'none',
      '--support', SUPPORT_COPY, '--target', target, '--retention-root', RELEASES])
    let cut = cutOnce()
    if (/retention-refused/u.test(cut.text) && parkNamed(cut.text) > 0) cut = cutOnce()
    writeFileSync(join(HOME_DIR, `cut-${sha9}.log`), cut.text)
    // The script's last step is a prepare against a COPY of the support tree, which refuses whenever a live patch row still
    // names the running release (always, before step 4). The build and the boot smoke are what count here; the live
    // prepare in step 4 is the real check.
    const built = /\(d\) materialized/u.test(cut.text) && /\(e\) boot smoke booted/u.test(cut.text)
    if (!built || !existsSync(join(target, '.dsh-build', 'plugin-set.json'))) {
      finish('failed', `the release did not build or boot in its smoke test; nothing live changed.\n${tail(cut.text)}`)
    }
  } else step('cut', { note: `${basename(target)} already built` })

  // THE SHELL IS BUILT FROM THE MAIN CHECKOUT, so only when that checkout sits EXACTLY at <commit> with the shell's files
  // clean: a checkout ahead of GitHub main (local commits) or with uncommitted edits would pack bytes nobody approved into
  // /Applications/AUKORA.app, whose signer signs every approval. A required rebuild that cannot
  // produce a complete packed shell refuses before any live effects.
  let newShell = null, shellFailure = null
  if (shellChanged) {
    const head = git('rev-parse', 'HEAD').text.trim()
    const dirty = git('status', '--porcelain', '--', ...shellPaths).text.trim()
    if (head !== commit || dirty !== '') {
      shellFailure = shellCheckoutRefusal({ head, commit, dirty })
    } else {
      const desk = join(REPO, 'apps', 'aukora-desktop')
      const npm = existsSync(join(dirname(process.execPath), 'npm')) ? join(dirname(process.execPath), 'npm') : 'npm'
      const built = run(npm, ['run', 'dist'], { cwd: desk })
      const candidate = join(desk, 'dist', 'mac-arm64', 'AUKORA.app')
      const missing = built.status === 0 ? shellImportsMissing(desk, candidate) : ['(build failed)']
      if (missing.length === 0) { newShell = candidate; step('shell', { note: 'rebuilt; every import it makes is packed' }) }
      else shellFailure = built.status !== 0 ? `shell build failed (exit ${built.status})` : `missing shell imports: ${missing.slice(0, 5).join(', ')}`
    }
  } else step('shell', { note: 'unchanged' })
  dropHeavy()
  const shellRefusal = requiredShellRefusal({ shellChanged, newShell, reason: shellFailure })
  if (shellRefusal) finish('refused', shellRefusal)

  guardMembrane()

  // ── 3. BACK UP, THEN THE PLUGIN SET ──────────────────────────────────────────────────────────────────
  // Every patch file directly in the support root (the set desktop-cutover repoints), every patch config.json lists
  // there, config.json, the gate config and the installed plugin-set approval and pin.
  const backupDir = join(HOME_DIR, `backup-${sha9}-${Date.now()}`)
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const livePatchFiles = [...new Set([
    ...readdirSync(SUPPORT, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.patch.yml')).map((e) => join(SUPPORT, e.name)),
    ...(config.patch ?? []).filter((p) => p.startsWith(`${SUPPORT}/`) && existsSync(p)),
  ])]
  const gateConfig = join(STATE, 'gate-state', 'gate-config.json')
  const backedUp = [configPath, gateConfig, ...livePatchFiles,
    join(STATE, 'gate-state', 'plugin-set-approval.json'), join(STATE, 'gate-state', 'plugin-set-approver.json')]
    .filter((p) => existsSync(p))
  const manifest = backedUp.map((path, i) => { const copy = join(backupDir, `${i}-${basename(path)}`); copyFileSync(path, copy); return { path, copy } })
  writeFileSync(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const restore = () => { for (const { path, copy } of manifest) copyFileSync(copy, path) }
  step('backup', { note: `${manifest.length} live file(s) → ${backupDir}` })

  // WHAT HAS BEEN DONE, SO THAT PUTTING IT BACK UNDOES EXACTLY THAT, in reverse, from any exit.
  const done = { quit: false, applied: false, shellBackup: null }
  rescue = async () => {
    if (done.quit) await quitApp()
    if (done.applied) run(process.execPath, [CUTOVER, 'rollback', '--support-root', SUPPORT])
    restore()
    if (done.shellBackup !== null) {
      try {
        if (existsSync(APP)) renameSync(APP, join(APP_BACKUPS, `AUKORA-failed-${sha9}-${Date.now()}.app`))
        renameSync(done.shellBackup, APP)
      } catch (error) { say(`THE OLD SHELL COULD NOT BE PUT BACK (${error.message}); it is at ${done.shellBackup}`) }
    }
    if (!done.quit) return null
    const from = existsSync(DESKTOP_LOG) ? statSync(DESKTOP_LOG).size : 0
    run('/usr/bin/open', ['-a', APP])
    return waitForBoot(from, basename(live))
  }

  // THE NEW APPROVAL IS KEPT ASIDE UNTIL THE QUIT. Installed now, it would sit beside a running app whose release it does
  // not approve, and a relaunch before the quit (the restart watchdog, a quit and reopen) would be refused by the gate
  // with "no approved plugin set". So the running app's approval goes straight back, and the new one is installed after
  // the quit, just before apply (which verifies it).
  const approvalFiles = new Set(['plugin-set-approval.json', 'plugin-set-approver.json'].map((name) => join(STATE, 'gate-state', name)))
  let approvedCopies = []
  // THE WHOLE RELEASE GOES INTO THE ONE POPUP: the release tree and the shell that will run (the rebuilt one, else the
  // installed one) are bound into the record, and the popup is skipped only when the bytes on disk match an approval of them.
  const shellToRun = newShell ?? APP
  const bound = run(process.execPath, [PLUGIN_SET, 'bind', '--release', target, '--commit', commit, '--shell', shellToRun, '--support', SUPPORT])
  if (bound.status !== 0) await giveUp('failed', `the release could not be bound for approval; the running app is unchanged.\n${tail(bound.text)}`)
  // Retain the binding the approval is about to cover. The record on disk can change during the live check.
  const boundRelease = JSON.parse(readFileSync(join(target, '.dsh-build', 'plugin-set.json'), 'utf8')).release
  const covered = run(process.execPath, [PLUGIN_SET, 'check', '--release', target, '--shell', shellToRun, '--support', SUPPORT])
  if (covered.status === 0 && /PLUGIN SET APPROVED/u.test(covered.text)) {
    step('plugin-set', { note: 'the installed approval already covers these release and shell bytes; no popup' })
  } else {
    step('plugin-set', { note: 'LOOK AT THE AUKORA APP: approve loading this release (one popup)' })
    const approved = run(process.execPath, [PLUGIN_SET, 'approve', '--release', target, '--support', SUPPORT])
    writeFileSync(join(HOME_DIR, `plugin-set-${sha9}.log`), approved.text)
    if (approved.status !== 0 || !/PLUGIN SET APPROVED AND INSTALLED/u.test(approved.text)) {
      await giveUp('not-approved', `loading ${basename(target)} was not approved; the running app is unchanged. Approve later with: node scripts/aukora/become.mjs --commit ${sha9}`)
    }
    const key = /signed by pinned (did:key:[^\s;]+)/u.exec(approved.text)?.[1]
    approvedCopies = [...approvalFiles].filter((path) => existsSync(path))
      .map((path) => { const copy = join(backupDir, `approved-${basename(path)}`); copyFileSync(path, copy); return { path, copy } })
    for (const { path, copy } of manifest) if (approvalFiles.has(path)) copyFileSync(copy, path)
    step('plugin-set', { note: `approved in the AUKORA popup; key ${key ?? '(see log)'}; installed at the restart` })
  }

  // The new shell is copied NEXT TO the backups while the app still runs, so the swap after the quit is two renames on one
  // volume: a copy that fails half-way leaves /Applications/AUKORA.app untouched.
  let staged = null
  if (newShell !== null) {
    mkdirSync(APP_BACKUPS, { recursive: true })
    staged = join(APP_BACKUPS, `AUKORA-new-${sha9}-${Date.now()}.app`)
    if (run('/usr/bin/ditto', [newShell, staged]).status !== 0) {
      await giveUp('failed', 'the approved shell could not be staged; the running app is unchanged')
    }
  }

  // ── 4. REPOINT THE LIVE ROWS, THEN THE LIVE CHECK ────────────────────────────────────────────────────
  // From here until the quit, the running app's support tree names the NEW release: a relaunch in between (the restart
  // watchdog, a quit and reopen) would not start. So the lock is taken BEFORE the rows are touched (its wait is unbounded),
  // and the window is the live check alone.
  if (!(await heavily(52, 'the live check'))) await giveUp('stopped', `memory stayed below 52 for 10 minutes before the live check; everything was put back. Re-run: node scripts/aukora/become.mjs --commit ${sha9}`)
  const next = { ...config, patch: patchesForRelease(config.patch, live, target) }
  writeFileSync(configPath, `${JSON.stringify(next, null, 1)}\n`)
  for (const path of [...livePatchFiles, gateConfig].filter((p) => existsSync(p))) {
    const before = readFileSync(path, 'utf8')
    const after = swapRelease(before, live, target)
    if (after !== before) writeFileSync(path, after)
  }
  step('repoint', { note: `rows naming ${basename(live)} now name ${basename(target)}` })
  const prepared = run(process.execPath, [CUTOVER, 'prepare', target, '--support-root', SUPPORT])
  dropHeavy()
  writeFileSync(join(HOME_DIR, `prepare-${sha9}.log`), prepared.text)
  if (prepared.status !== 0) {
    await giveUp('failed', `the live check refused ${basename(target)}; every live file was restored and the app was not restarted.\n${tail(prepared.text)}`)
  }
  step('prepare', { note: 'the live check passed' })

  // ── 5. RESTART INTO IT ─────────────────────────────────────────────────────────────────────────────
  observeConfinement()
  guardMembrane()
  writeResult() // Preserve the observation before quitting; this launches no live guest.
  step('restart', { note: 'quitting the app' })
  if (!(await quitApp())) {
    await giveUp('failed', `the app did not quit, so ${basename(target)} was not applied; every live file was restored. If the app is stuck, quit it by hand and reopen it`)
  }
  done.quit = true
  // THE APPROVED BYTES ARE THE ONES APPLIED: the release tree and the shell about to run are recomputed once more.
  let stillApproved = false
  try { stillApproved = sameBinding(boundRelease, releaseBinding({ commit, release: target, shell: staged ?? APP })) } catch { stillApproved = false }
  if (!stillApproved) await giveUp('failed', `${basename(target)} or its shell changed after approval; nothing was applied and every live file was restored`)
  for (const { path, copy } of approvedCopies) copyFileSync(copy, path)
  const applied = run(process.execPath, [CUTOVER, 'apply', target, '--support-root', SUPPORT])
  writeFileSync(join(HOME_DIR, `apply-${sha9}.log`), applied.text)
  done.applied = applied.status === 0
  if (done.applied && staged !== null) {
    const shellBackup = join(APP_BACKUPS, `AUKORA-before-${sha9}-${Date.now()}.app`)
    try {
      renameSync(APP, shellBackup)
      done.shellBackup = shellBackup
      renameSync(staged, APP)
    } catch (error) {
      say(`the shell swap failed (${error.message}); the old shell stays`)
      if (done.shellBackup !== null && !existsSync(APP)) { renameSync(done.shellBackup, APP); done.shellBackup = null }
      await giveUp('failed', 'the approved shell could not be installed; the release cutover was rolled back')
    }
  }
  if (done.applied) {
    // The offset is taken AFTER the quit: the old app's last lines are not the new one's boot.
    const from = existsSync(DESKTOP_LOG) ? statSync(DESKTOP_LOG).size : 0
    run('/usr/bin/open', ['-a', APP])
    const booted = await waitForBoot(from, basename(target))
    if (booted.ok) {
      // The marker names what the installed shell was built from: the commit when it was swapped in, and the old base when
      // a needed rebuild did not happen (so the next become still rebuilds it).
      if (done.shellBackup !== null) {
        writeFileSync(shellMarker, `${commit}\n`)
        // AND HOW MUCH ITS CARD SHOWS (scripts/aukora/shown-limit.mjs): the shell was built from this checkout at this commit.
        const limit = /WITNESS_DISPLAY_LIMIT = (\d+)/u.exec(readFileSync(join(REPO, 'apps', 'aukora-desktop', 'aumlok-signer.mjs'), 'utf8'))?.[1]
        if (limit) writeFileSync(join(HOME_DIR, 'shell-limit'), `${limit}\n`)
      }
      else if (shellChanged && !existsSync(shellMarker)) writeFileSync(shellMarker, `${shellFrom}\n`)
      finish('live', `the app restarted into ${basename(target)}${done.shellBackup ? ' with its rebuilt shell' : shellChanged ? ' (its shell sources changed; the shell was NOT rebuilt)' : ''}; ${booted.line}`)
    }
    say(`the new release did not load: ${booted.line}`)
  } else say(`apply refused:\n${tail(applied.text)}`)

  // ROLLBACK: the app goes back to exactly what it ran before.
  await giveUp('rolled-back', `${basename(target)} did not come up, so everything was restored to ${basename(live)}. Logs: ${HOME_DIR}.`)
}

/** Pids whose command line matches `pattern`, never this process (its --why is free text and could match). */
const pidsOf = (pattern) => run('/usr/bin/pgrep', ['-f', pattern]).text.split('\n').map(Number)
  .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid)
/** Quit the app; true when its shell is gone. */
async function quitApp() {
  const shell = `${APP}/Contents/MacOS/AUKORA`
  const running = () => pidsOf(shell).length > 0
  run('/usr/bin/osascript', ['-e', 'quit app "AUKORA"'])
  for (let i = 0; i < 40 && running(); i += 1) await sleep(1000)
  if (!running()) return true
  // A shell that failed to start sits on a modal error box and does not answer "quit". Stop it and what it started.
  say('the app did not quit within 40 s; stopping it')
  for (const pattern of [shell, `${RELEASES}/aukora-release-[0-9a-f]+/apps/cli/lib/bin.js`, 'scripts/launch-dsh.py --release']) {
    for (const pid of pidsOf(pattern)) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  }
  for (let i = 0; i < 20 && running(); i += 1) await sleep(1000)
  return !running()
}

/**
 * WHAT THE DESKTOP LOG SAYS ABOUT A BOOT OF `release` (a release directory name), read from text written since the reopen.
 * { ok: true } when the backend line names the release with the spatial frontend and a window loaded after it; { ok: false }
 * on a line the shell writes at level `error` or an uncaught exception, checked FIRST so the verdict does not depend on
 * when the log is polled; null while neither has happened. `load failed` (a page or frame that did not load) is logged
 * at error level and is not a failed start: the window reloads, and a boot that never loads times out instead.
 */
export function bootVerdict(text, release) {
  const lines = text.split('\n')
  const bad = lines.find((l) => /^\S+ (error|uncaughtException) /u.test(l) && !/^\S+ error aukora-desktop: load failed /u.test(l))
  if (bad) return { ok: false, line: bad.trim().slice(0, 300) }
  const at = lines.findIndex((l) => l.includes(`release ${release} `) && l.includes('spatial frontend'))
  if (at >= 0) {
    const origin = /backend (http:\/\/127\.0\.0\.1:\d+) /u.exec(lines[at])?.[1]
    const loaded = lines.findLastIndex((l) => l.endsWith(` log aukora-desktop: window loaded ${origin}`))
    if (origin && loaded > at && lines.slice(loaded + 1).some((l) => l.endsWith(` log aukora-desktop: interface ready ${origin}`))) {
      return { ok: true, line: lines[at].trim().slice(0, 200) }
    }
  }
  return null
}
/** Wait for the desktop log, reading only what was written after `from`. */
async function waitForBoot(from, release) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(3000)
    if (!existsSync(DESKTOP_LOG)) continue
    const bytes = readFileSync(DESKTOP_LOG)
    const verdict = bootVerdict(bytes.subarray(Math.min(from, bytes.length)).toString('utf8'), release)
    const seen = verdict?.ok ? await observe(release, 20_000) : null
    if (typeof seen === 'string') { result.booted ??= release === basename(result.release); return { ok: false, line: `window loaded, but ${seen}` } }
    if (seen) result.observed = seen
    if (verdict !== null) return verdict
  }
  return { ok: false, line: `no "release ${release} … spatial frontend" and "window loaded" within ${BOOT_TIMEOUT_MS / 1000} s` }
}
/** LIVE IS OBSERVED: the log's backend since the shell's start is `release`, that shell lives, its port's listener runs its bin.js and answers. */
export async function observe(release, settle = 0) {
  let seen = null
  for (const wait of [0, settle]) {
    await sleep(wait)
    const text = (existsSync(DESKTOP_LOG) ? readFileSync(DESKTOP_LOG, 'utf8') : '').split(/ start pid=/u).pop()
    const [, port, name] = [...text.matchAll(/ log aukora-desktop: backend http:\/\/127\.0\.0\.1:(\d+) .* release (\S+) /gu)].pop() ?? []
    if (name !== release) return `the log's backend is not ${release}`
    try { process.kill(parseInt(text), 0) } catch { return 'its shell is gone' }
    const pid = Number(run('/usr/sbin/lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).text.split('\n')[0])
    if (!run('/bin/ps', ['-ww', '-o', 'command=', '-p', String(pid)]).text.includes(`/${release}/apps/cli/lib/bin.js`)) return `no ${release} backend listens on ${port}`
    if (await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).then(() => false, () => true)) return `port ${port} did not answer`
    if (seen && seen.pid !== pid) return `pid ${seen.pid} did not stay up`
    seen ??= { pid, port: Number(port), answeredAt: stamp() }
  }
  return { ...seen, stableFor: Date.now() - Date.parse(seen.answeredAt) }
}

/** Every row naming the release `from` (as a directory prefix, or as a whole quoted value) names `to` instead. */
export const swapRelease = (text, from, to) => text.split(`${from}/`).join(`${to}/`).split(`"${from}"`).join(`"${to}"`)

/** Preserve deployment overlays and add the separate memory MCP client once, without mutating the input. */
export function patchesForRelease(patches, from, to) {
  // desktop-cutover owns the first (composition) slot. Repoint all other entries in their existing order.
  const next = (patches ?? []).map((path, i) => i === 0 ? path : swapRelease(path, from, to))
  const memoryPatch = join(to, 'tracked-memory.patch.yml')
  if (!next.includes(memoryPatch)) next.push(memoryPatch)
  return next
}

/**
 * The release names a materializer retention refusal lists as `unprotected` and free to move: a candidate followed by a
 * `RETAIN   N inbound symlink(s)` or `RETAIN   held open` line is not (scripts/release-retention.py enforce()).
 */
export function parkable(text) {
  const candidates = []
  let current = null
  for (const line of text.split('\n')) {
    const found = /^RETAIN candidate (aukora-release-[0-9a-f]{6,40})\s.*\s(unprotected|PROTECTED)\s*$/u.exec(line)
    if (found) { current = { name: found[1], free: found[2] === 'unprotected' }; candidates.push(current); continue }
    if (current !== null && /^RETAIN {3}/u.test(line)) { if (/inbound symlink|held open/u.test(line)) current.free = false; continue }
    current = null
  }
  return candidates.filter((c) => c.free).map((c) => c.name)
}

/** Every relative import reachable from the packed shell's main.mjs must be packed, or reachable in its extra files. */
export function shellImportsMissing(desk, appDir) {
  const asarPath = join(desk, 'node_modules', '@electron', 'asar', 'lib', 'asar.js')
  if (!existsSync(asarPath)) return ['@electron/asar not installed']
  const probe = `
    const asar = require(${JSON.stringify(asarPath)}); const path = require('path'); const fs = require('fs');
    const app = ${JSON.stringify(join(appDir, 'Contents', 'Resources', 'app.asar'))};
    const contents = ${JSON.stringify(join(appDir, 'Contents'))};
    const files = new Set(asar.listPackage(app).map(f => f.replace(/^\\//, '')));
    const seen = new Set(); const missing = [];
    const walk = (rel, outside) => {
      const key = (outside ? 'x:' : 'a:') + rel; if (seen.has(key)) return; seen.add(key);
      let src;
      if (outside) { const p = path.join(contents, rel); if (!fs.existsSync(p)) { missing.push(rel); return } src = fs.readFileSync(p, 'utf8') }
      else { if (!files.has(rel)) { missing.push(rel); return } src = asar.extractFile(app, rel).toString() }
      for (const m of src.matchAll(/(?:^|\\n)\\s*(?:import|export)\\s[^'"]*?from\\s*['"](\\.{1,2}\\/[^'"]+)['"]|(?:^|\\n)\\s*import\\s*['"](\\.{1,2}\\/[^'"]+)['"]|import\\(\\s*['"](\\.{1,2}\\/[^'"]+)['"]/g)) {
        const spec = m[1] || m[2] || m[3];
        // Paths are relative to Contents/; the packed files sit under Resources/app.asar/.
        const base = outside ? rel : 'Resources/app.asar/' + rel;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(base), spec));
        if (target.startsWith('Resources/app.asar/')) walk(target.slice('Resources/app.asar/'.length), false);
        else walk(target, true);
      }
    };
    walk('main.mjs', false);
    process.stdout.write(JSON.stringify(missing));`
  const out = run(process.execPath, ['-e', probe], { cwd: desk })
  try { return JSON.parse(out.text.trim()) } catch { return [`import probe failed: ${out.text.trim().slice(0, 200)}`] }
}

/** A crash or a signal after the first live write puts everything back and reopens the app before this process ends. */
let crashing = false
async function crashed(error) {
  if (crashing) return
  crashing = true
  say(`BECOME CRASHED: ${error?.stack ?? error}`)
  if (rescue !== null || rescuing !== null) {
    try { const back = await putBack(); say(`everything was put back${back ? `; the app ${back.ok ? 'is running again' : `is NOT confirmed running (${back.line})`}` : ''}`) } catch (again) { say(`PUTTING BACK FAILED: ${again?.stack ?? again}`) }
  }
  dropHeavy()
  result.outcome = 'crashed'; result.note = String(error); writeResult(); releaseLock(); process.exit(1)
}

if (isMainModule(import.meta.url)) {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { void crashed(new Error(`stopped by ${signal}`)) })
  main().catch((error) => error instanceof BecomeOutcome
    ? finishOutcome(error.outcome, error.message).catch(crashed) : crashed(error))
}
