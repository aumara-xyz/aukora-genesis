/**
 * Live amendment refusal on both production parent-controlled guest entries.
 * A2–A5 observe tools, entries, and memory configuration across writes to
 * scratch copies of the shipped profile. A6 requires ordinary CLI HMR to
 * keep working. A8/A9 exercise executable-config refusal with ordinary
 * publication controls; A10 starts the documented parent with scratch keys,
 * observes its real guest, and submits no effect.
 *
 * --mutate neutralizes an ordinary watcher, inserts a disabled tool, removes
 * each executable-config defense separately and together, and removes the
 * parent's HMR disposition on both guests. Missing mutation anchors fail.
 * Only scratch copies change. The same-UID result does not establish custody,
 * installed guest confinement, or immutable activation.
 *
 * Requires pnpm build:lib:host; an unavailable source closure exits 77.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, watch as fsWatch, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const MUTATE = process.argv.includes('--mutate')

/** The repository's governed profile — the subject's source of bytes. */
const GOVERNED_PROFILE_NAME = '8088-inside-out'
const GOVERNED_DIR = join(ROOT, 'profiles', GOVERNED_PROFILE_NAME)
/** The real launcher entry, exactly as `pnpm dsh` invokes it. */
const CLI_ENTRY = join(ROOT, 'apps', 'cli', 'src', 'bin.ts')
const GUEST_ENTRIES = ['developer-guest.mjs', 'developer-guest-turn.mjs']
  .map(name => join(ROOT, 'aukora', 'supervisor', name))
/** That entry as an argv prefix: the source launch runs under tsx's ESM hook. */
const SOURCE_LAUNCHER = ['--import', 'tsx/esm', CLI_ENTRY]
/** The bundled artifact `apps/cli/package.json` publishes as the `dsh` binary. */
const SHIPPED_BIN = join(ROOT, 'apps', 'cli', 'lib', 'bin.js')
/** The launcher module whose watcher the --mutate arm neutralizes in a copy. */
const PROFILE_BOOT = join(ROOT, 'apps', 'cli', 'src', 'profile-boot.ts')
/** The document that publishes the 8088 launch command row A10 runs. */
const READINESS_DOC = join(ROOT, 'docs', '8088-READINESS.md')
/** The launcher's diagnostic when its parent declines amendment machinery. */
const DECLINE_DIAGNOSTIC = 'HMR declined at launch for governed composition'
/** The loader's refusal, thrown at config load while `refuseJsExpressions()` is active. */
const REFUSAL_TOKEN = 'loader:governed-composition-refuses-executable-config'
const PREFLIGHT_REFUSAL = 'profile-boot:governed-composition-refuses-executable-config'

/** Observer sampling period; every reported latency is quantized to it. */
const POLL_MS = 25
/** Quiet time after the first sample before a baseline is taken. */
const SETTLE_MS = 1500
/**
 * How long a write is given to reach the running tree. Measured arrival on
 * this host is tens of milliseconds, so this window is ~25x the observed
 * latency — it is not a guess at "N seconds", it is a bound far above what
 * was measured. The printed latency is the number that matters.
 */
const AMEND_WINDOW_MS = 5000
/** Ceiling on one launcher boot reaching its first observer sample. */
const BOOT_TIMEOUT_MS = 120000

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * Compare paths the way the watcher stores them. The system temp directory is
 * reached through a symlink on darwin (`/var` -> `/private/var`), and the HMR
 * service keys its registrations by the resolved file, so a plain string or
 * `path.resolve` comparison would report "not watched" about a file that is.
 * The home-level patch file need not exist to be watched, so a missing leaf
 * resolves through its directory rather than falling back to a lexical path.
 * @param path - any path, existing or not.
 * @returns the fully resolved path.
 */
const realPath = (path) => {
  try { return realpathSync(path) } catch { /* the leaf need not exist; resolve its directory below */ }
  try { return join(realpathSync(dirname(path)), basename(path)) } catch { return resolvePath(path) }
}

/** The court's whole writable surface; `null` until it exists, so an early skip has nothing to remove. */
let TEMP_ROOT = null

const EXPECTED_ROWS = Object.freeze(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'])
const rows = []
const row = (n, label, observed, expected) => {
  rows.push({ n, label, observed, expected, breach: JSON.stringify(observed) !== JSON.stringify(expected) })
}

/** Require every ordinary row exactly once. */
const rowsComplete = () => {
  const names = new Set(rows.map(({ n }) => n))
  return rows.length === EXPECTED_ROWS.length
    && names.size === EXPECTED_ROWS.length
    && EXPECTED_ROWS.every((name) => names.has(name))
}

/** Require the current amendment breaches and every other row to hold. */
const mutationRowsMatch = (expectedBreaches) => {
  const expected = new Set(expectedBreaches)
  const names = new Set(rows.map(({ n }) => n))
  return rowsComplete()
    && expected.size === expectedBreaches.length
    && names.size === rows.length
    && expectedBreaches.every((name) => names.has(name))
    && rows.every(({ n, breach }) => breach === expected.has(n))
}

/** Files whose bytes this court must leave exactly as it found them. */
const REPOSITORY_WITNESS = [
  join(GOVERNED_DIR, 'package.json'),
  join(GOVERNED_DIR, 'cordis.patch.yml'),
  PROFILE_BOOT,
  ...GUEST_ENTRIES,
].map(file => [file, sha256(file)])

/**
 * Verify the repository is byte-identical to the way this court found it,
 * drop the temp tree, and leave. `process.exit` skips `finally`, so this is
 * the only exit door: every path out of the court goes through it, and a
 * repository that drifted overrides the verdict with a red exit.
 * @param code - the verdict's exit code, honoured only over an unchanged repository.
 */
const finish = (code) => {
  const drifted = REPOSITORY_WITNESS.filter(([file, digest]) => sha256(file) !== digest).map(([file]) => file)
  if (drifted.length > 0) console.error(`\n  *** REPOSITORY MODIFIED BY THIS COURT: ${drifted.join(', ')} ***\n`)
  if (TEMP_ROOT !== null) rmSync(TEMP_ROOT, { recursive: true, force: true })
  process.exit(drifted.length > 0 ? 1 : code)
}

/** Print the verdict table and the note a reader needs to weigh an `inert` row. */
const printTable = () => {
  console.log('\n  courts/harness/amendment-channel — a governed run may not amend itself\n  ' + '-'.repeat(72))
  for (const r of rows) {
    console.log(`  ${r.n.padEnd(4)}${String(r.label).padEnd(62)} ${r.breach ? '*** BREACH ***' : 'held'}  ${JSON.stringify(r.observed)}`)
  }
  console.log('\n  Both production IPC guests are observed before and after the same profile amendments.\n  Ordinary CLI HMR and executable-config publication are positive controls.\n  The documented parent uses scratch keys and submits no effect.\n  SAME_UID_PARENT_LAUNCH / NO_CUSTODY_CLAIM; no installed guest or confinement claim.')
  console.log('\n  observationClass: SELF-REPORTED')
}

/** Print the verdict table and leave through {@link finish}. */
const report = (code) => {
  printTable()
  if (!rowsComplete()) console.error(`\n  *** INCOMPLETE ROW SET: expected ${EXPECTED_ROWS.join(' ')}, observed ${rows.map(({ n }) => n).join(' ')} ***`)
  console.log('')
  finish(rowsComplete() ? code : 1)
}

/** Leave by the platform-skip-by-design door, naming the missing precondition. */
const skip = (reason, detail) => {
  console.log('\n  courts/harness/amendment-channel — SKIPPED BY DESIGN\n  ' + '-'.repeat(72))
  console.log(`  ${reason}: ${detail}`)
  console.log('\n  observationClass: NOT OBSERVED\n')
  finish(77)
}

// ---------------------------------------------------------------------------
// Preconditions. Each one is a reason the measurement cannot exist on this
// host, never a reason to call the property satisfied.
// ---------------------------------------------------------------------------
if (!existsSync(CLI_ENTRY)) skip('launcher-absent', CLI_ENTRY)
if (!existsSync(join(GOVERNED_DIR, 'cordis.patch.yml'))) skip('governed-profile-absent', GOVERNED_DIR)
if (!existsSync(join(ROOT, 'node_modules', 'tsx'))) skip('tsx-absent', 'the source launcher runs under node --import tsx/esm')
{
  // The governed composition resolves through package `exports` to `lib/`, so
  // an unbuilt tree cannot boot the subject at all (`pnpm build:lib:host`).
  // Two anchors, because the launcher itself has two: the workspace root
  // (where the governed plugin is linked) and the app package (where the
  // profile module fallback takes the bundled plugins from).
  const anchors = [join(ROOT, 'package.json'), join(ROOT, 'apps', 'cli', 'package.json')].map(createRequire)
  for (const pkg of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-aukora-memory', '@deepseek-ai/dsh-tool-todo']) {
    let failure = null
    const resolved = anchors.some((requireFrom) => {
      try {
        requireFrom.resolve(pkg)
        return true
      } catch (error) {
        failure = error
        return false
      }
    })
    if (!resolved) skip('plugin-closure-unbuilt', `${pkg}: ${String(failure?.message ?? failure).split('\n')[0]} — run pnpm build:lib:host`)
  }
}

const TMP = mkdtempSync(join(tmpdir(), 'aukora-amendment-'))
TEMP_ROOT = TMP
{
  // A kernel that delivers no change events would make every liveness row read
  // 'inert' for a reason that has nothing to do with the property.
  const probeDir = join(TMP, 'watch-probe')
  mkdirSync(probeDir, { recursive: true })
  const probeFile = join(probeDir, 'probe.txt')
  writeFileSync(probeFile, 'a')
  let saw = false
  const watcher = fsWatch(probeDir, () => { saw = true })
  await delay(200)
  appendFileSync(probeFile, 'b')
  for (let i = 0; i < 50 && !saw; i++) await delay(100)
  watcher.close()
  if (!saw) {
    skip('no-file-change-events', `${process.platform}: the kernel delivered no change event for a write this process made`)
  }
}

// ---------------------------------------------------------------------------
// The subject: a throwaway $DSH_HOME holding the repository's governed bytes
// and one ordinary control profile. Nothing here is inside the repository.
// ---------------------------------------------------------------------------
const HOME = join(TMP, 'home')
mkdirSync(join(HOME, 'profiles', 'node_modules', '@deepseek-ai'), { recursive: true })
// The repository profile resolves `@deepseek-ai/dsh-aukora-memory` by Node's
// parent walk to the repository root. Outside the repository the launcher's own
// flat module fallback carries only the app's dependency closure, which this
// workspace-only package is not in, so the court restores the same resolution
// with one link to the read-only package directory.
symlinkSync(join(ROOT, 'packages', 'governed', 'memory-put'), join(HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-aukora-memory'))

/**
 * The court's instrument, mounted as a plain patch-overlay row beside the
 * composition under test. It reports what a model would be shown — the tool
 * registry's own schema projection — plus the live loader entry list, the
 * governed row's live config, and the HMR service's registered config
 * watchers. It registers no service the launcher looks for, so its presence
 * cannot change whether an HMR row is mounted. Its interval is deliberately
 * NOT unref'd: a run whose only other timers are the watchers under test
 * would otherwise exit the moment those watchers are absent, and a court
 * cannot observe a process that left.
 */
const OBSERVER_SOURCE = `import { appendFileSync } from 'node:fs'

const LOG = process.env.COURT_OBSERVER_LOG

export default function courtObserver(ctx) {
  const sample = (reason) => {
    let tools
    try { tools = (ctx.get('tools')?.schemas() ?? []).map(schema => schema.name).sort() } catch (error) { tools = ['<unreadable>'] }
    const entries = []
    let governedConfig = null
    try {
      for (const entry of ctx.get('loader')?.entries() ?? []) {
        entries.push(String(entry.options?.name ?? entry.options?.id ?? '?'))
        if (entry.options?.id === 'aukora-memory') governedConfig = entry.options?.config ?? null
      }
    } catch (error) { entries.push('<unreadable>') }
    let watched
    try {
      const hmr = ctx.get('hmr')
      watched = hmr === undefined ? null : [...hmr.configs.keys()]
    } catch (error) { watched = ['<unreadable>'] }
    // Sorted: the loader's own iteration order is not part of the property,
    // and an incidental reordering must not read as a live composition change.
    entries.sort()
    appendFileSync(LOG, JSON.stringify({
      t: Date.now(), reason, tools, entries, governedConfig, watched,
      hmrService: ctx.get('hmr') !== undefined,
      hmrEntry: entries.some(name => name.includes('cordis-plugin-hmr')),
      euid: typeof process.geteuid === 'function' ? process.geteuid() : null,
    }) + '\\n')
  }
  sample('mount')
  const ticker = setInterval(() => sample('poll'), ${POLL_MS})
  ctx.on('dispose', () => clearInterval(ticker))
}
`

const OVERLAY = join(TMP, 'court-observer.patch.yml')
writeFileSync(OVERLAY, "- insert:\n    - id: court-observer\n      name: './court-observer.mjs'\n")

const governedPatchBytes = readFileSync(join(GOVERNED_DIR, 'cordis.patch.yml'), 'utf8')
const governedPackageBytes = readFileSync(join(GOVERNED_DIR, 'package.json'), 'utf8')

/**
 * The ordinary control: the same launcher, the same bare-profile shape, no
 * aukora row, a different name. This is what "ordinary use" means for the
 * documented hot-reload contract — a repair that classifies THIS as governed
 * has killed HMR broadly, which A6 is here to report.
 */
const ORDINARY_PACKAGE = `${JSON.stringify({
  name: 'dsh-profile-court-ordinary',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: [] } },
}, null, 2)}\n`
const ORDINARY_PATCH = `- insert:
    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

    - id: tools
      name: '@deepseek-ai/dsh-tools'
`

const makeProfile = (name, packageBytes, patchBytes) => {
  const dir = join(HOME, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), packageBytes)
  writeFileSync(join(dir, 'cordis.patch.yml'), patchBytes)
  writeFileSync(join(dir, 'court-observer.mjs'), OBSERVER_SOURCE)
  return dir
}
const governedDir = makeProfile('court-governed', governedPackageBytes, governedPatchBytes)
const ordinaryDir = makeProfile('court-ordinary', ORDINARY_PACKAGE, ORDINARY_PATCH)

/** Stage the fixed profile name required by the production IPC guests. */
const guestEnvironment = (profile, observe = true) => {
  const guestHome = mkdtempSync(join(TMP, 'guest-home-'))
  mkdirSync(join(guestHome, 'profiles'))
  symlinkSync(join(HOME, 'profiles', profile), join(guestHome, 'profiles', GOVERNED_PROFILE_NAME))
  const liveOverlay = join(guestHome, 'live.patch.yml')
  writeFileSync(liveOverlay, '[]\n')
  if (observe) writeFileSync(join(guestHome, 'cordis.patch.yml'), `- insert:\n    - id: court-observer\n      name: ${JSON.stringify(join(HOME, 'profiles', profile, 'court-observer.mjs'))}\n`)
  return {
    DSH_HOME: guestHome,
    AUKORA_LIVE_TURN_MODE: 'live',
    AUKORA_LIVE_TURN_OVERLAY: liveOverlay,
  }
}

/** Scratch subjects inherit no model credentials. */
const courtEnvironment = () => Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(name)))

/** Await the owned child after termination rather than leaving observers alive. */
const stopChild = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise(resolveExit => { child.once('close', resolveExit) })
  child.kill('SIGTERM')
  const timer = setTimeout(() => { child.kill('SIGKILL') }, 1000)
  try { await done } finally { clearTimeout(timer) }
}

/**
 * The amendment: one insert that adds a real, model-visible tool the governed
 * composition deliberately omits. `dsh-tool-todo` injects only the tool
 * registry, so it mounts on a composition with no shell, no filesystem, and no
 * model — nothing about the write depends on the rest of the tree.
 */
const AMEND_TOOL = `
- insert:
    - id: court-amend-tool
      name: '@deepseek-ai/dsh-tool-todo'
      config:
        allowParallelInProgress: false
`
/** The same tool, composed but disabled — the --mutate arm's second sabotage. */
const AMEND_TOOL_DISABLED = `
- insert:
    - id: court-amend-tool
      name: '@deepseek-ai/dsh-tool-todo'
      disabled: true
      config:
        allowParallelInProgress: false
`
/** Reinterpretation, not addition: the governed row's own config, widened. */
const AMEND_WIDEN = `
- id: aukora-memory
  config:
    brokerSocket: '/run/aukora/broker.sock'
    reviewLimitBytes: 999999
`
/** The value AMEND_WIDEN installs, and the one the profile ships. */
const WIDENED_LIMIT = 999999
const SHIPPED_LIMIT = 8192

/** Newline commits an observer sample; a stopped writer must leave no fragment. */
const samplesOf = (log, closed = false) => {
  if (!existsSync(log)) return []
  const text = readFileSync(log, 'utf8')
  const end = text.lastIndexOf('\n') + 1
  if (closed && end !== text.length) throw new Error('amendment observer left an incomplete sample')
  return text.slice(0, end).split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
}

/**
 * Boot one profile under one launcher entry, take a settled baseline, then
 * apply each write in turn and watch the live tree for AMEND_WINDOW_MS.
 * @param options - launcher entry, profile name and directory, the ordered writes, and any extra launcher flags.
 * @returns the baseline sample, one observation per write, and the child's output.
 */
const observeRun = async ({ entry, profile, dir, writes, launcherArgs = [], parentGuest = false }) => {
  const log = join(TMP, `observer-${profile}-${rows.length}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
  writeFileSync(log, '')
  const patchPath = join(dir, 'cordis.patch.yml')
  const guestEnv = parentGuest ? guestEnvironment(profile) : {}
  const env = { ...courtEnvironment(), DSH_HOME: HOME, COURT_OBSERVER_LOG: log, DSH_TELEMETRY_DISABLED: '1', ...guestEnv }
  // The governed row's sockets stay at their unreachable defaults: a court
  // must not dial a real broker or issuer, and the plugin connects lazily.
  delete env.AUKORA_BROKER_SOCKET
  delete env.AUKORA_ISSUER_SOCKET
  const child = spawn(process.execPath, ['--import', 'tsx/esm', entry, ...(parentGuest ? [] : ['--profile', profile, '--patch', OVERLAY, ...launcherArgs])], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', ...(parentGuest ? ['ipc'] : [])],
  })
  let ready = !parentGuest
  child.on('message', message => {
    if (message?.type === 'aukora:guest-ready:v2' && message.governed === true && message.pid === child.pid) ready = true
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  let exited = false
  child.on('exit', () => { exited = true })

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while ((!ready || samplesOf(log).length === 0) && Date.now() < deadline && !exited) await delay(100)
    if (!ready || samplesOf(log).length === 0) {
      return { booted: false, output: output.slice(0, 1200) }
    }
    await delay(SETTLE_MS)
    const baseline = samplesOf(log).at(-1)

    const observations = []
    for (const write of writes) {
      const before = samplesOf(log).at(-1)
      const t0 = Date.now()
      appendFileSync(patchPath, write)
      await delay(AMEND_WINDOW_MS)
      const after = samplesOf(log).filter(sample => sample.t >= t0)
      if (exited || after.length === 0) {
        throw new Error(`amendment observer stopped during live write: ${output}`)
      }
      const firstWhere = (predicate) => after.find(predicate)?.t ?? null
      const moved = (key) => firstWhere(sample => JSON.stringify(sample[key]) !== JSON.stringify(before[key]))
      observations.push({
        toolsBefore: before.tools,
        toolsAfter: samplesOf(log).at(-1).tools,
        toolLatencyMs: moved('tools') === null ? null : moved('tools') - t0,
        entryLatencyMs: moved('entries') === null ? null : moved('entries') - t0,
        governedConfigBefore: before.governedConfig,
        governedConfigAfter: samplesOf(log).at(-1).governedConfig,
        governedLatencyMs: moved('governedConfig') === null ? null : moved('governedConfig') - t0,
      })
    }
    await stopChild(child)
    samplesOf(log, true)
    return { booted: true, baseline, observations, homePatch: join(env.DSH_HOME, 'cordis.patch.yml'), output: output.slice(0, 1200) }
  } finally {
    await stopChild(child)
  }
}

/**
 * Compose one profile in a separate launcher process, with no boot: the
 * control that says a write really is an amendment the launcher would apply.
 * @param profile - the profile name under the throwaway home.
 * @returns the dumped tree and the launcher's exit code.
 */
const dumpConfig = (profile) => new Promise((resolveDump) => {
  const env = { ...courtEnvironment(), DSH_HOME: HOME, DSH_TELEMETRY_DISABLED: '1' }
  delete env.AUKORA_BROKER_SOCKET
  delete env.AUKORA_ISSUER_SOCKET
  const child = spawn(process.execPath, ['--import', 'tsx/esm', CLI_ENTRY, '--profile', profile, '--dump-config'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.on('exit', code => resolveDump({ code, dump: out }))
})

// ---------------------------------------------------------------------------
// Executable configuration refusal and the ordinary publication control.
// ---------------------------------------------------------------------------

/**
 * A `!!js` scalar for a governed config field, written as the include dialect's
 * own text so this court needs no YAML writer. Its whole act is to create one
 * file inside the court's temp tree and return the literal the shipped field
 * carries, so a boot that does NOT refuse still mounts the row and idles.
 * @param markerPath - the temp file the expression writes when it runs.
 * @returns a patch-layer fragment appended to a staged governed patch file.
 */
const executableConfigPatch = (markerPath) => {
  const source = `(function () { process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed'); return '/run/aukora/broker.sock'; })()`
  return `\n- id: aukora-memory\n  config:\n    brokerSocket: !!js "${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`
}

/**
 * Boot one profile and wait for whichever comes first: the expression's marker
 * file, or the launcher's own exit. No observer is mounted — the question is
 * whether config load ran code, and a run that refuses never reaches a tree an
 * observer could sit in.
 * @param options - the argv prefix that runs a launcher, profile name, marker path, and extra launcher flags.
 * @returns whether the expression ran, the launcher's exit code, and its stderr.
 */
const bootForExecution = ({ argv, profile, markerPath, launcherArgs = [], parentGuest = false }) => new Promise((resolveBoot) => {
  const env = { ...courtEnvironment(), DSH_HOME: HOME, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', ...(parentGuest ? guestEnvironment(profile, false) : {}) }
  delete env.AUKORA_BROKER_SOCKET
  delete env.AUKORA_ISSUER_SOCKET
  const child = spawn(process.execPath, [...argv, ...(parentGuest ? [] : ['--profile', profile, ...launcherArgs])], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', ...(parentGuest ? ['ipc'] : [])],
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const deadline = setTimeout(() => child.kill('SIGKILL'), BOOT_TIMEOUT_MS)
  // A boot that executes the expression then idles must still be killed, and a
  // boot that refuses exits on its own first — so the marker is polled and the
  // kill is delayed, never awaited.
  const poll = setInterval(() => {
    if (!existsSync(markerPath)) return
    clearInterval(poll)
    setTimeout(() => child.kill('SIGKILL'), 750)
  }, 20)
  child.on('close', (code) => {
    clearTimeout(deadline)
    clearInterval(poll)
    resolveBoot({ executed: existsSync(markerPath), code, stderr })
  })
})

/**
 * Stage one more copy of the repository's governed bytes and append a patch
 * fragment to it. Used for the boots A8 needs beside the observed one.
 * @param name - the profile name under the throwaway home.
 * @param fragment - patch-layer text appended to the staged file.
 * @returns the staged profile directory.
 */
const stageGovernedWith = (name, fragment) => {
  const dir = makeProfile(name, governedPackageBytes, governedPatchBytes)
  appendFileSync(join(dir, 'cordis.patch.yml'), fragment)
  return dir
}

// ---------------------------------------------------------------------------
// A10's instrument: the launch command the documentation publishes, run as
// published, and asked from the outside whether it is governed.
// ---------------------------------------------------------------------------


/**
 * Does this pid hold an open descriptor on the named file? The kernel's answer
 * about the running process, not the process's answer about itself.
 * @param pid - the process to inspect.
 * @param file - the file to look for.
 * @returns true, false, or `'unobserved-no-lsof'` when the tool is unavailable.
 */
const holdsDescriptorOn = (pid, file) => {
  // `lsof` exits 1 when it lists nothing, so only a failure to RUN it is a
  // failure to observe; an empty listing is a real answer.
  const listing = spawnSync('lsof', ['-p', String(pid)], { encoding: 'utf8' })
  if (listing.error !== undefined || listing.signal !== null
    || (listing.status !== 0 && listing.status !== 1)
    || typeof listing.stdout !== 'string' || (listing.stderr ?? '').trim() !== '') return 'unobserved-no-lsof'
  return listing.stdout.includes(file)
}


/** The working tree's own answer about what a run left behind. */
const treeWitness = () => {
  const status = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
  return status.status === 0 ? status.stdout : `git-unavailable:${String(status.error?.message ?? status.status)}`
}


/** Run the documented parent command with scratch keys and no submitted effect. */
const runDocumentedParent = async () => {
  const doc = readFileSync(READINESS_DOC, 'utf8')
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['aukora:source-launch']
  if (!doc.includes('pnpm aukora:source-launch <launch.json> [memory-put.json]')
    || script !== 'node aukora/supervisor/developer-launch-bin.mjs') {
    throw new Error('documented parent command no longer matches the measured entry')
  }
  const keys = generateKeyPairSync('ed25519')
  const privateFile = join(TMP, 'parent-private.pem')
  const publicFile = join(TMP, 'parent-public.pem')
  writeFileSync(privateFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(publicFile, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 })
  const runtimeDir = join(TMP, 'parent-runtime')
  const configFile = join(TMP, 'parent-launch.json')
  writeFileSync(configFile, JSON.stringify({ schema: 'aukora:developer-launch:v1', runtimeDir, rootPrivateKeyFile: privateFile, rootPublicKeyFile: publicFile }))
  const child = spawn(process.execPath, [join(ROOT, 'aukora/supervisor/developer-launch-bin.mjs'), configFile], {
    cwd: ROOT, env: { ...courtEnvironment(), DSH_HOME: HOME, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let ready
  let closed = false
  child.on('close', () => { closed = true })
  child.stdout.on('data', chunk => {
    output += chunk
    for (const line of output.split('\n')) {
      if (!line.startsWith('{') || !line.endsWith('}')) continue
      const value = JSON.parse(line)
      if (value.schema === 'aukora:developer-launch:v1' && value.status === 'READY') ready = value
    }
  })
  child.stderr.on('data', chunk => { output += chunk })
  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (ready === undefined && !closed && Date.now() < deadline) await delay(100)
    if (ready === undefined) throw new Error(`documented parent did not reach READY: ${output}`)
    const guestCommand = spawnSync('ps', ['-o', 'command=', '-p', String(ready.pids.guest)], { encoding: 'utf8' })
    const patch = join(runtimeDir, 'activation/profiles', GOVERNED_PROFILE_NAME, 'cordis.patch.yml')
    return {
      launched: guestCommand.status === 0 && guestCommand.stdout.includes('aukora/supervisor/developer-guest.mjs'),
      distinctChildren: new Set(Object.values(ready.pids)).size === 3,
      declined: output.includes(DECLINE_DIAGNOSTIC),
      watchDescriptor: holdsDescriptorOn(ready.pids.guest, patch),
      stagedPatch: existsSync(patch),
    }
  } finally { await stopChild(child) }
}

/** Mutate only the two current executable-config guards or the parent's HMR disposition. */
const stageParentMutant = ({ entry, label, removeDisposition = false, removeRefusal = false, removePreflight = false }) => {
  const root = join(TMP, label)
  const cli = join(root, 'apps/cli')
  const supervisor = join(root, 'aukora/supervisor')
  mkdirSync(cli, { recursive: true })
  mkdirSync(supervisor, { recursive: true })
  cpSync(join(ROOT, 'apps/cli/src'), join(cli, 'src'), { recursive: true })
  cpSync(join(ROOT, 'apps/cli/package.json'), join(cli, 'package.json'))
  symlinkSync(join(ROOT, 'apps/cli/node_modules'), join(cli, 'node_modules'))
  symlinkSync(join(ROOT, 'apps/cli/config'), join(cli, 'config'))
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'))
  symlinkSync(join(ROOT, 'aukora/broker'), join(root, 'aukora/broker'))
  cpSync(join(ROOT, 'aukora/supervisor/developer-protocol.mjs'), join(supervisor, 'developer-protocol.mjs'))
  let guest = readFileSync(entry, 'utf8')
  const disposition = "  hmrDisposition: 'declined-at-launch',\n"
  const refusal = '\nrefuseExecutableConfig()\n'
  if (guest.split(disposition).length !== 2 || guest.split(refusal).length !== 2) throw new Error(`guest mutation anchor missing or repeated: ${entry}`)
  if (removeDisposition) guest = guest.replace(disposition, '')
  if (removeRefusal) guest = guest.replace(refusal, '\nvoid refuseExecutableConfig\n')
  const mutantEntry = join(supervisor, basename(entry))
  writeFileSync(mutantEntry, guest)
  const bootPath = join(cli, 'src/profile-boot.ts')
  let boot = readFileSync(bootPath, 'utf8')
  const preflight = `    const executable = findExecutableConfigEntry(composed.entries)
    if (executable !== undefined) {
      throw new Error(
        \`profile-boot:governed-composition-refuses-executable-config (entry \${JSON.stringify(executable.id)})\`,
      )
    }
`
  if (boot.split(preflight).length !== 2) throw new Error('profile executable-preflight mutation anchor missing or repeated')
  if (removePreflight) boot = boot.replace(preflight, '')
  writeFileSync(bootPath, boot)
  return mutantEntry
}

// ---------------------------------------------------------------------------
// A1 — the subject is the repository's governed profile, and the repository
// keeps its own bytes. Recorded before anything runs; re-checked at exit.
// ---------------------------------------------------------------------------
row('A1', 'the subject carries the repository\'s governed bytes, verbatim', {
  packageIdentical: sha256(join(governedDir, 'package.json')) === sha256(join(GOVERNED_DIR, 'package.json')),
  patchIdentical: sha256(join(governedDir, 'cordis.patch.yml')) === sha256(join(GOVERNED_DIR, 'cordis.patch.yml')),
  subjectOutsideRepository: !resolvePath(governedDir).startsWith(resolvePath(ROOT)),
}, { packageIdentical: true, patchIdentical: true, subjectOutsideRepository: true })

try {
  // -------------------------------------------------------------------------
  // A2, A3, A4, A5 — one governed run, two writes, measured live.
  // -------------------------------------------------------------------------
  const governed = await observeRun({
    entry: GUEST_ENTRIES[0], profile: 'court-governed', dir: governedDir,
    writes: [AMEND_TOOL, AMEND_WIDEN], parentGuest: true,
  })
  if (!governed.booted) {
    const detail = { booted: false, launcherOutput: governed.output }
    row('A2', 'the governed run mounts no HMR and watches no patch file', detail, { booted: true })
    row('A3', 'a write to the running patch file adds no tool to the same run', detail, { booted: true })
    row('A4', 'the governed row\'s own config is not rewritten mid-run', detail, { booted: true })
    row('A5', 'the amendment composes on a fresh launch and reaches nothing live', detail, { booted: true })
    row('A6', 'a non-governed profile still hot-reloads', { skipped: 'governed run did not boot' }, { skipped: null })
    row('A7', 'limitation', { platform: process.platform, governedRunObserved: false }, { platform: process.platform, governedRunObserved: true })
    row('A8', 'source IPC guest refuses executable config', { skipped: 'governed run did not boot' }, { skipped: null })
    row('A9', 'live-turn IPC guest refuses executable config', { skipped: 'governed run did not boot' }, { skipped: null })
    row('A10', 'the documented launch command is a governed launch', { skipped: 'governed run did not boot' }, { skipped: null })
    report(1)
  }

  const [added, widened] = governed.observations
  const turnDir = makeProfile('court-turn', governedPackageBytes, governedPatchBytes)
  const turnGoverned = await observeRun({
    entry: GUEST_ENTRIES[1], profile: 'court-turn', dir: turnDir,
    writes: [AMEND_TOOL, AMEND_WIDEN], parentGuest: true,
  })
  if (!turnGoverned.booted) throw new Error(`live-turn guest did not boot: ${turnGoverned.output}`)
  const [turnAdded, turnWidened] = turnGoverned.observations
  const watched = Array.isArray(governed.baseline.watched)
    ? governed.baseline.watched.map(realPath)
    : governed.baseline.watched
  const ownPatch = realPath(join(governedDir, 'cordis.patch.yml'))
  const homePatch = realPath(governed.homePatch)

  row('A2', 'the governed run mounts no HMR and watches no patch file', {
    hmrService: governed.baseline.hmrService,
    hmrEntry: governed.baseline.hmrEntry,
    watchesOwnPatch: Array.isArray(watched) && watched.includes(ownPatch),
    watchesHomePatch: Array.isArray(watched) && watched.includes(homePatch),
    turnHmrService: turnGoverned.baseline.hmrService,
    turnHmrEntry: turnGoverned.baseline.hmrEntry,
    turnWatches: turnGoverned.baseline.watched,
  }, { hmrService: false, hmrEntry: false, watchesOwnPatch: false, watchesHomePatch: false, turnHmrService: false, turnHmrEntry: false, turnWatches: null })

  row('A3', 'a write to the running patch file adds no tool to the same run', {
    toolsBefore: added.toolsBefore,
    toolsAfter: added.toolsAfter,
    toolArrived: added.toolLatencyMs !== null,
    latencyMs: added.toolLatencyMs,
    pollMs: POLL_MS,
    windowMs: AMEND_WINDOW_MS,
    turnToolsBefore: turnAdded.toolsBefore,
    turnToolsAfter: turnAdded.toolsAfter,
    turnLatencyMs: turnAdded.toolLatencyMs,
  }, {
    toolsBefore: added.toolsBefore,
    toolsAfter: added.toolsBefore,
    toolArrived: false,
    latencyMs: null,
    pollMs: POLL_MS,
    windowMs: AMEND_WINDOW_MS,
    turnToolsBefore: ['memory.put'],
    turnToolsAfter: ['memory.put'],
    turnLatencyMs: null,
  })

  row('A4', 'the governed row\'s own config is not rewritten mid-run', {
    brokerSocketBefore: widened.governedConfigBefore?.brokerSocket,
    brokerSocketAfter: widened.governedConfigAfter?.brokerSocket,
    shippedLimit: widened.governedConfigBefore?.reviewLimitBytes,
    liveLimit: widened.governedConfigAfter?.reviewLimitBytes,
    reinterpreted: widened.governedLatencyMs !== null,
    latencyMs: widened.governedLatencyMs,
    turnConfigBefore: turnWidened.governedConfigBefore,
    turnConfigAfter: turnWidened.governedConfigAfter,
    turnLatencyMs: turnWidened.governedLatencyMs,
  }, {
    brokerSocketBefore: '/run/aukora/broker.sock',
    brokerSocketAfter: '/run/aukora/broker.sock',
    shippedLimit: SHIPPED_LIMIT,
    liveLimit: SHIPPED_LIMIT,
    reinterpreted: false,
    latencyMs: null,
    turnConfigBefore: { brokerSocket: '/run/aukora/broker.sock', reviewLimitBytes: SHIPPED_LIMIT },
    turnConfigAfter: { brokerSocket: '/run/aukora/broker.sock', reviewLimitBytes: SHIPPED_LIMIT },
    turnLatencyMs: null,
  })

  const dumped = await dumpConfig('court-governed')
  const turnDumped = await dumpConfig('court-turn')
  row('A5', 'the amendment composes on a fresh launch and reaches nothing live', {
    composesStatically: dumped.code === 0
      && dumped.dump.includes('court-amend-tool')
      && dumped.dump.includes(String(WIDENED_LIMIT)),
    liveToolsMoved: added.toolLatencyMs !== null,
    liveEntriesMoved: added.entryLatencyMs !== null || widened.entryLatencyMs !== null,
    liveGovernedConfigMoved: widened.governedLatencyMs !== null,
    turnComposesStatically: turnDumped.code === 0 && turnDumped.dump.includes('court-amend-tool') && turnDumped.dump.includes(String(WIDENED_LIMIT)),
    turnLiveToolsMoved: turnAdded.toolLatencyMs !== null,
    turnLiveEntriesMoved: turnAdded.entryLatencyMs !== null || turnWidened.entryLatencyMs !== null,
    turnLiveConfigMoved: turnWidened.governedLatencyMs !== null,
  }, {
    composesStatically: true,
    liveToolsMoved: false,
    liveEntriesMoved: false,
    liveGovernedConfigMoved: false,
    turnComposesStatically: true,
    turnLiveToolsMoved: false,
    turnLiveEntriesMoved: false,
    turnLiveConfigMoved: false,
  })

  // -------------------------------------------------------------------------
  // A6 — the control that makes a repair a repair. The identical write, the
  // identical launcher, an ordinary profile: the documented hot-reload
  // contract must survive.
  // -------------------------------------------------------------------------
  const ordinary = await observeRun({
    entry: CLI_ENTRY, profile: 'court-ordinary', dir: ordinaryDir,
    writes: [AMEND_TOOL],
  })
  const ordinaryAdded = ordinary.booted ? ordinary.observations[0] : null
  row('A6', 'a non-governed profile still hot-reloads the identical write', {
    booted: ordinary.booted,
    hmrService: ordinary.booted ? ordinary.baseline.hmrService : null,
    toolsBefore: ordinaryAdded?.toolsBefore ?? null,
    toolsAfter: ordinaryAdded?.toolsAfter ?? null,
    toolArrived: ordinaryAdded !== null && ordinaryAdded.toolLatencyMs !== null,
    latencyMs: ordinaryAdded?.toolLatencyMs ?? null,
  }, {
    booted: true,
    hmrService: true,
    toolsBefore: ordinaryAdded?.toolsBefore ?? null,
    toolsAfter: ['todo_write'],
    toolArrived: true,
    latencyMs: ordinaryAdded?.toolLatencyMs ?? null,
  })

  // -------------------------------------------------------------------------
  // A7 — the limitation, recorded rather than implied.
  // -------------------------------------------------------------------------
  row('A7', 'both guest observations retain the same-UID custody limitation', {
    platform: process.platform,
    guestEuid: governed.baseline.euid,
    turnGuestEuid: turnGoverned.baseline.euid,
    osCustodyMeasured: false,
  }, {
    platform: process.platform,
    guestEuid: typeof process.geteuid === 'function' ? process.geteuid() : null,
    turnGuestEuid: typeof process.geteuid === 'function' ? process.geteuid() : null,
    osCustodyMeasured: false,
  })

  // -------------------------------------------------------------------------
  // A8 requires refusal by the source IPC guest and publication of the same
  // executable bytes by the ordinary CLI.
  // -------------------------------------------------------------------------
  const armed = await observeRun({
    entry: GUEST_ENTRIES[0], profile: 'court-governed-armed', dir: makeProfile('court-governed-armed', governedPackageBytes, governedPatchBytes),
    writes: [AMEND_TOOL, AMEND_WIDEN], parentGuest: true,
  })
  const [armedAdded, armedWidened] = armed.booted ? armed.observations : [null, null]
  const armedWatched = armed.booted && Array.isArray(armed.baseline.watched) ? armed.baseline.watched.length : 0

  // The executable-config half, and its own control. The staged bytes are
  // identical except for the scratch marker path; only the entry path differs.
  const refusedMarker = join(TMP, 'marker-armed-refusal')
  stageGovernedWith('court-governed-jsexpr', executableConfigPatch(refusedMarker))
  const refused = await bootForExecution({
    argv: ['--import', 'tsx/esm', GUEST_ENTRIES[0]],
    profile: 'court-governed-jsexpr',
    markerPath: refusedMarker,
    parentGuest: true,
  })
  const openMarker = join(TMP, 'marker-unflagged-control')
  stageGovernedWith('court-governed-jsexpr-control', executableConfigPatch(openMarker))
  const unflagged = await bootForExecution({
    argv: SOURCE_LAUNCHER,
    profile: 'court-governed-jsexpr-control',
    markerPath: openMarker,
  })

  row('A8', 'source IPC guest declines HMR and refuses executable config', {
    booted: armed.booted,
    hmrService: armed.booted ? armed.baseline.hmrService : null,
    watchedPatchFiles: armedWatched,
    liveToolArrived: armedAdded !== null && armedAdded.toolLatencyMs !== null,
    liveGovernedConfigMoved: armedWidened !== null && armedWidened.governedLatencyMs !== null,
    declineDiagnostic: armed.booted && armed.output.includes(DECLINE_DIAGNOSTIC),
    executableConfigExecuted: refused.executed,
    refusedByName: refused.stderr.includes(PREFLIGHT_REFUSAL),
    theSameBytesExecuteOnOrdinaryCli: unflagged.executed,
  }, {
    booted: true,
    hmrService: false,
    watchedPatchFiles: 0,
    liveToolArrived: false,
    liveGovernedConfigMoved: false,
    declineDiagnostic: true,
    executableConfigExecuted: false,
    refusedByName: true,
    theSameBytesExecuteOnOrdinaryCli: true,
  })

  // -------------------------------------------------------------------------
  // A9 applies the same executable-config attack to the production live-turn
  // guest, retaining a built ordinary-CLI publication control.
  // -------------------------------------------------------------------------
  const shippedBuilt = existsSync(GUEST_ENTRIES[1])
  const shippedMarker = join(TMP, 'marker-shipped-bin')
  const shippedControlMarker = join(TMP, 'marker-shipped-bin-control')
  if (shippedBuilt) {
    stageGovernedWith('court-governed-jsexpr-shipped', executableConfigPatch(shippedMarker))
    stageGovernedWith('court-governed-jsexpr-shipped-control', executableConfigPatch(shippedControlMarker))
  }
  const shipped = shippedBuilt
    ? await bootForExecution({ argv: ['--import', 'tsx/esm', GUEST_ENTRIES[1]], profile: 'court-governed-jsexpr-shipped', markerPath: shippedMarker, parentGuest: true })
    : null
  const shippedControl = shippedBuilt
    ? await bootForExecution({ argv: [SHIPPED_BIN], profile: 'court-governed-jsexpr-shipped-control', markerPath: shippedControlMarker })
    : null

  row('A9', 'live-turn IPC guest refuses executable config', {
    bin: 'aukora/supervisor/developer-guest-turn.mjs',
    sourcePresent: shippedBuilt,
    preflightDiagnostic: shipped === null ? 'unobserved-unbuilt' : shipped.stderr.includes(PREFLIGHT_REFUSAL),
    executableConfigExecuted: shipped === null ? 'unobserved-unbuilt' : shipped.executed,
    refusedByName: shipped === null ? 'unobserved-unbuilt' : shipped.stderr.includes(PREFLIGHT_REFUSAL),
    theSameBytesExecuteOnOrdinaryCli: shippedControl === null ? 'unobserved-unbuilt' : shippedControl.executed,
  }, {
    bin: 'aukora/supervisor/developer-guest-turn.mjs',
    sourcePresent: true,
    preflightDiagnostic: true,
    executableConfigExecuted: false,
    refusedByName: true,
    theSameBytesExecuteOnOrdinaryCli: true,
  })

  // -------------------------------------------------------------------------
  // A10 observes the documented parent command, not a bare profile launch.
  // -------------------------------------------------------------------------
  const witnessBefore = treeWitness()
  const documented = await runDocumentedParent()
  const witnessAfter = treeWitness()

  row('A10', 'the documented launch command is a governed launch', {
    publishedIn: 'docs/8088-READINESS.md',
    documentedParentScript: 'aukora:source-launch',
    launcherProcessObserved: documented.launched,
    hmrDeclinedAtLaunch: documented.declined,
    openWatchFdOnItsOwnComposition: documented.watchDescriptor,
    distinctChildren: documented.distinctChildren,
    stagedPatchExists: documented.stagedPatch,
    trackedRepositoryRestoredAfterThisRun: witnessAfter === witnessBefore,
  }, {
    publishedIn: 'docs/8088-READINESS.md',
    documentedParentScript: 'aukora:source-launch',
    launcherProcessObserved: true,
    hmrDeclinedAtLaunch: true,
    openWatchFdOnItsOwnComposition: false,
    distinctChildren: true,
    stagedPatchExists: true,
    trackedRepositoryRestoredAfterThisRun: true,
  })

  if (MUTATE) {
    printTable()
    // -----------------------------------------------------------------------
    // M1 — the watcher is load bearing. A COPY of the launcher outside the
    // repository loses its patch-file watcher; the ordinary profile, live
    // above, goes inert. Detection compares the two runs of the SAME profile,
    // so this arm keeps working after the governed hole is closed.
    // -----------------------------------------------------------------------
    const mutantCli = join(TMP, 'mutant', 'apps', 'cli')
    mkdirSync(mutantCli, { recursive: true })
    cpSync(join(ROOT, 'apps', 'cli', 'src'), join(mutantCli, 'src'), { recursive: true })
    cpSync(join(ROOT, 'apps', 'cli', 'package.json'), join(mutantCli, 'package.json'))
    symlinkSync(join(ROOT, 'apps', 'cli', 'node_modules'), join(mutantCli, 'node_modules'))
    symlinkSync(join(ROOT, 'apps', 'cli', 'config'), join(mutantCli, 'config'))
    const mutantBoot = join(mutantCli, 'src', 'profile-boot.ts')
    const source = readFileSync(mutantBoot, 'utf8')
    const ANCHOR = /^(\s*)watchUserPatches,$/m
    const anchored = ANCHOR.test(source)
    if (anchored) {
      writeFileSync(mutantBoot, `${source.replace(ANCHOR, '$1watchUserPatches as courtRealWatchUserPatches,')}
// mutation: the launcher still mounts HMR and still asks for the watch; the
// watch itself does nothing, so no patch file is registered.
const watchUserPatches = async () => async () => {}
void courtRealWatchUserPatches
`, 'utf8')
    }
    writeFileSync(join(ordinaryDir, 'cordis.patch.yml'), ORDINARY_PATCH)
    const mutantRun = anchored
      ? await observeRun({
        entry: join(mutantCli, 'src', 'bin.ts'), profile: 'court-ordinary', dir: ordinaryDir,
        writes: [AMEND_TOOL],
      })
      : { booted: false, output: 'mutation anchor not found in apps/cli/src/profile-boot.ts' }
    const mutantAdded = mutantRun.booted ? mutantRun.observations[0] : null
    const m1 = anchored
      && (ordinaryAdded?.toolLatencyMs ?? null) !== null
      && mutantRun.booted
      && (mutantAdded?.toolLatencyMs ?? null) === null
      && (Array.isArray(mutantRun.baseline?.watched) ? mutantRun.baseline.watched.length === 0 : true)

    // -----------------------------------------------------------------------
    // M2 — the instrument reads the MODEL-VISIBLE list, not the config file
    // and not the entry list. A disabled row composes and reaches the live
    // loader; no tool may appear. Without this, a post-repair `inert` could be
    // a court that simply never looked at the model's view.
    // -----------------------------------------------------------------------
    writeFileSync(join(ordinaryDir, 'cordis.patch.yml'), ORDINARY_PATCH)
    const disabledRun = await observeRun({
      entry: CLI_ENTRY, profile: 'court-ordinary', dir: ordinaryDir,
      writes: [AMEND_TOOL_DISABLED],
    })
    const disabledAdded = disabledRun.booted ? disabledRun.observations[0] : null
    const m2 = disabledRun.booted
      && (disabledAdded?.entryLatencyMs ?? null) !== null
      && (disabledAdded?.toolLatencyMs ?? null) === null

    // -----------------------------------------------------------------------
    // M3 removes each executable-config defense separately, then both.
    // M4 removes the HMR disposition from each production guest entry.
    // -----------------------------------------------------------------------
    const executableResults = []
    const dispositionResults = []
    for (const [index, entry] of GUEST_ENTRIES.entries()) {
      const checks = []
      for (const [label, removePreflight, removeRefusal] of [['static-only', true, false], ['loader-only', false, true], ['both', true, true]]) {
        const mutantEntry = stageParentMutant({ entry, label: `mutant-${index}-${label}`, removePreflight, removeRefusal })
        const marker = join(TMP, `marker-${index}-${label}`)
        const profile = `court-exec-${index}-${label}`
        stageGovernedWith(profile, executableConfigPatch(marker))
        const result = await bootForExecution({
          argv: ['--import', 'tsx/esm', mutantEntry], profile, markerPath: marker, parentGuest: true,
        })
        checks.push(label === 'both'
          ? result.executed
          : !result.executed && result.code !== 0
            && result.stderr.includes(label === 'static-only' ? REFUSAL_TOKEN : PREFLIGHT_REFUSAL))
        if (!checks.at(-1)) console.log(`  MUTATION refusal evidence guest=${basename(entry)} arm=${label} ${JSON.stringify(result)}`)
      }
      executableResults.push(checks.every(Boolean))
      const disarmed = stageParentMutant({ entry, label: `mutant-disposition-${index}`, removeDisposition: true })
      const profile = `court-disposition-${index}`
      const result = await observeRun({
        entry: disarmed, profile, dir: makeProfile(profile, governedPackageBytes, governedPatchBytes),
        writes: [AMEND_TOOL, AMEND_WIDEN], parentGuest: true,
      })
      dispositionResults.push(result.booted && result.baseline.hmrService
        && result.observations[0].toolLatencyMs !== null
        && result.observations[1].governedLatencyMs !== null)
    }
    const m3 = refused.executed === false && shipped.executed === false && executableResults.every(Boolean)
    const m4 = documented.declined && governed.baseline.hmrService === false
      && turnGoverned.baseline.hmrService === false && dispositionResults.every(Boolean)
    const expectedBreaches = []
    const ordinaryRowsMatched = mutationRowsMatch(expectedBreaches)
    console.log(`\n  MUTATION watcher neutralized      ordinary live under real=${(ordinaryAdded?.toolLatencyMs ?? null) !== null}, under mutant=${(mutantAdded?.toolLatencyMs ?? null) !== null}, watched=${JSON.stringify(mutantRun.baseline?.watched ?? null)}   ${m1 ? 'DETECTED' : 'NOT DETECTED'}`)
    if (!anchored) console.log('  mutation anchor `watchUserPatches,` not found in apps/cli/src/profile-boot.ts — the sabotage did not run')
    console.log(`  MUTATION disabled row composed    live entries moved=${(disabledAdded?.entryLatencyMs ?? null) !== null}, model-visible tools moved=${(disabledAdded?.toolLatencyMs ?? null) !== null}   ${m2 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION refusal removed          both guest defense controls=${JSON.stringify(executableResults)}   ${m3 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION parent disposition removed  both guest live amendments=${JSON.stringify(dispositionResults)}   ${m4 ? 'DETECTED' : 'NOT DETECTED'}\n`)
    console.log(`  MUTATION ordinary-row oracle       expectedBreaches=[${expectedBreaches.join(' ')}] matched=${ordinaryRowsMatched}\n`)
    finish(m1 && m2 && m3 && m4 && ordinaryRowsMatched ? 0 : 1)
  }

  report(rows.some(r => r.breach) ? 1 : 0)
} catch (error) {
  // A court that crashed observed nothing; it reports that, it does not
  // inherit the verdict of the rows it managed to fill in first.
  console.error(`\n  courts/harness/amendment-channel — the court itself failed: ${String(error?.stack ?? error)}\n`)
  finish(1)
}
