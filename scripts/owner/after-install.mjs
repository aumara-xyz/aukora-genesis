#!/usr/bin/env node
/**
 * THE ONE COMMAND PETER RUNS AFTER THE INSTALLER, AS HIS NORMAL USER, WITH NO `sudo`.
 *
 * `scripts/owner/setup-owner.sh` creates the `aukora-owner` account and installs the daemon; it needs sudo and
 * it is the last privileged thing in the cut. **AFTER IT, PROVING THE BOUNDARY MUST NOT NEED PRIVILEGE** —
 * a command that escalated to check would be measuring a different uid than the one the cut is about, and the
 * whole point is that the agent's own uid is refused with no help from anyone.
 *
 * WHAT IT RUNS, IN ORDER, AND ALL THREE PARTS ARE REQUIRED:
 *
 *   1. `scripts/owner/measure-boundary.mjs` — the existing instrument, which ATTEMPTS the forbidden things and
 *      records the kernel's own answer with its errno. Not reimplemented here: a second implementation of the
 *      same measurement is the drift this repository keeps finding.
 *   2. `tests/aukora-owner-protocol.test.mjs` — three of its arms are WRITTEN AND SKIPPED with a named ceiling
 *      because there is no second uid to be refused (`ownerExists`, line 394). They run automatically once the
 *      account exists, so this step is what turns three counted skips into three measured arms.
 *   3. a short LIVE CHECKLIST, below, aimed at the real installation paths.
 *
 * IT EXITS 0 ONLY IF EVERY ARM PASSED. Anything else is 1 (an arm ran and failed) or 2 (nothing was measured).
 * A record is written ONLY on a fully green run: a record of a failed cut would be a document that says the
 * boundary holds when it does not.
 *
 *   node scripts/owner/after-install.mjs                  # the real installation
 *   node scripts/owner/after-install.mjs --fixture <dir> --simulate   # SIMULATED, for the court
 *   node scripts/owner/after-install.mjs --print          # emit the record to stdout, write nothing
 *   node scripts/owner/after-install.mjs --evidence-dir <dir>   # write elsewhere (the court uses this)
 *
 * IDENTIFIERS. The record carries the account names and nothing else — no user name, no home directory, no
 * serial, no hostname. `host` is the OS family and version (`macOS 15.3`), which is a platform fact rather than
 * an identifier. `commit` is the checkout's own HEAD, which the reader needs to know WHICH code was measured.
 *
 * @module scripts/owner/after-install
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants as FS, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { release as osRelease, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')

/** The account the cut creates. NAMED, because the whole cut is about this second principal existing. */
export const OWNER_ACCOUNT = 'aukora-owner'

/**
 * The host string: OS family and version, and NOTHING ELSE.
 *
 * **`os.release()` IS THE DARWIN KERNEL, NOT THE macOS VERSION, AND THE SCHEMA ASKS FOR THE LATTER.** Measured
 * on this Mac: `os.release()` answers `25.1.0` while `sw_vers` answers `26.1`. A record reading `macOS 25.1.0`
 * would name a version that does not exist, and a reader comparing installs would be comparing kernel numbers
 * without knowing it. `sw_vers` is asked first; the kernel is the fallback for a platform without it.
 *
 * `os.hostname()` is deliberately NEVER used, even though `measure-boundary.mjs` records it — a machine name is
 * an identifier, this record is meant to travel, and the reader needs the platform (because `sun_path` is 104
 * bytes on macOS and the socket arithmetic is platform-specific), not the machine.
 */
export const hostString = () => {
  const family = platform() === 'darwin' ? 'macOS' : platform()
  const sw = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' })
  return `${family} ${sw.status === 0 ? String(sw.stdout).trim() : osRelease()}`
}


/** The checkout's HEAD, or null where this is not a repository. */
function commitOf() {
  const out = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return out.status === 0 ? String(out.stdout).trim() : null
}

/** Does the account exist? `id -u` is the same probe the protocol court uses, so the two cannot disagree. */
export const ownerAccountExists = () => spawnSync('id', ['-u', OWNER_ACCOUNT], { encoding: 'utf8' }).status === 0

// ── THE ARMS ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * One arm's result. `result` is one of exactly three words so a consumer can filter without parsing prose:
 *
 *   `pass` — the thing was attempted and the kernel answered as the cut requires
 *   `fail` — it was attempted and the answer was wrong; the cut does NOT hold
 *   `skip` — it could not be attempted here, and `detail` names why. **A SKIP IS NOT A PASS.**
 *
 * @param {string} name
 * @param {'pass'|'fail'|'skip'} result
 * @param {string} detail
 */
const arm = (name, result, detail) => ({ name, result, detail })

/**
 * Run a child and turn it into an arm. **THE EXIT CODE IS THE VERDICT AND THE TAIL IS THE EVIDENCE** — a child
 * that printed a success line and exited non-zero is a failure, which is a mistake this session already made
 * once in the other direction (a stamp was taken from a run that printed its token and exited 1).
 */
function runChild(name, command, args, options = {}) {
  const out = spawnSync(command, args, { encoding: 'utf8', cwd: ROOT, timeout: options.timeoutMs ?? 900000 })
  const combined = `${String(out.stdout ?? '')}${String(out.stderr ?? '')}`.trim()
  const tail = combined.split('\n').filter(line => line.trim() !== '').slice(-3).join(' | ').slice(0, 300)
  if (out.error !== undefined && out.error !== null) {
    return arm(name, 'fail', `the command did not run: ${String(out.error.message).slice(0, 200)}`)
  }
  return arm(name, out.status === 0 ? 'pass' : 'fail', `exit ${String(out.status)}${tail === '' ? '' : `: ${tail}`}`)
}

/**
 * THE LIVE CHECKLIST, AND EVERY ARM IS AN ATTEMPT RATHER THAN AN INSPECTION.
 *
 * A mode bit read from `stat` would tell us what the installer INTENDED. These read the kernel's answer to the
 * thing the cut forbids: `EACCES` when the agent uid reaches for the owner's bytes, and the owner's uid on the
 * process that is running. Both are what a person would actually experience.
 *
 * @param {Readonly<{ownerRoot: string, runDir: string, journal: string, approveSocket: string}>} paths
 */
async function checklist(paths) {
  const arms = []

  // ── ① the owner key is NOT readable by this uid ──────────────────────────────────────────────────────
  try {
    accessSync(paths.keyFile, FS.R_OK)
    arms.push(arm('agent-uid read of the owner key is refused (EACCES)', 'fail',
      'the key WAS readable by this uid, so the cut does not separate the principal from the agent'))
  } catch (error) {
    const code = error?.code ?? 'UNKNOWN'
    arms.push(code === 'EACCES'
      ? arm('agent-uid read of the owner key is refused (EACCES)', 'pass', `EACCES on ${paths.keyFile}`)
      : arm('agent-uid read of the owner key is refused (EACCES)', 'fail',
        `refused with ${code}, which is not EACCES — a missing file is not a boundary`))
  }

  // ── ② connecting to approve.sock is refused ──────────────────────────────────────────────────────────
  // **AWAITED, BECAUSE THE CONNECT IS ASYNCHRONOUS AND THE FIRST VERSION WAS NOT.** It pushed the PROMISE into
  // the arms array, and the record then carried an entry with no `result` — measured: the run died with
  // `Cannot read properties of undefined (reading 'toUpperCase')` while printing its own verdict. A promise is
  // not an arm, and the schema check below is what makes that impossible to ship quietly.
  arms.push(await connectRefused('agent-uid connect to approve.sock is refused (EACCES)', paths.approveSocket))

  // ── ③ the journal is NOT writable by this uid ────────────────────────────────────────────────────────
  try {
    accessSync(paths.journal, FS.W_OK)
    arms.push(arm('agent-uid write to the journal is refused', 'fail',
      'the journal WAS writable by this uid, so the agent can rewrite the record of what was approved'))
  } catch (error) {
    const code = error?.code ?? 'UNKNOWN'
    // ENOENT is checked by `accessSync` only when the file is absent; `W_OK` failing otherwise is EACCES.
    arms.push(code === 'EACCES'
      ? arm('agent-uid write to the journal is refused', 'pass', `EACCES on ${paths.journal}`)
      : arm('agent-uid write to the journal is refused', 'fail', `refused with ${code}, which is not EACCES`))
  }

  // ── ④ the daemon runs as aukora-owner ───────────────────────────────────────────────────────────────
  arms.push(daemonUidArm())
  return arms
}

/**
 * *** `existsSync` ANSWERS "CAN I SEE IT", NOT "IS IT THERE" (Codex r6 finding 7). ***
 * It returns FALSE for a path whose STAT is refused -- a socket inside a 0700 root-owned directory, which is
 * EXACTLY THE CONFIGURATION THIS FILE EXISTS TO MEASURE. So a correctly inaccessible socket was reported as
 * `no socket at …, so nothing was refused — install first`: THE BOUNDARY WAS WORKING PERFECTLY AND THE ARM SAID
 * THE INSTALL WAS MISSING. An EACCES read as an absence, in the tool whose whole purpose is to measure EACCES.
 *
 * @returns {'present'|'absent'|'unreadable'}
 */
function pathState(p) {
  try {
    statSync(p)
    return 'present'
  } catch (error) {
    // *** ENOENT IS ABSENCE; EACCES IS THE BOUNDARY DOING ITS JOB; ANYTHING ELSE IS UNKNOWN AND IS NOT ABSENCE. ***
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'absent'
    return 'unreadable'
  }
}

/** Attempt a unix-socket connect and require EACCES. Never throws: every outcome becomes an arm. */
function connectRefused(name, socketPath) {
  return new Promise((resolve) => {
    const socketState = pathState(socketPath)
    if (socketState === 'absent') {
      resolve(arm(name, 'fail', `no socket at ${socketPath}, so nothing was refused — install first`))
      return
    }
    if (socketState === 'unreadable') {
      // THE SOCKET IS THERE AND THIS UID CANNOT EVEN STAT IT. THAT IS THE BOUNDARY HOLDING, so the arm PASSES --
      // and saying so is the difference between "the protection works" and "I could not find the thing".
      resolve(arm(name, 'pass', `${socketPath} is present and not even stat-able by this uid — refused before any connect`))
      return
    }
    const socket = connect(socketPath)
    const done = (result) => { socket.destroy(); resolve(result) }
    socket.once('connect', () => done(arm(name, 'fail',
      'this uid CONNECTED to approve.sock, so the approval door is open to the agent')))
    socket.once('error', (error) => {
      const code = error?.code ?? 'UNKNOWN'
      done(code === 'EACCES'
        ? arm(name, 'pass', `EACCES on ${socketPath}`)
        : arm(name, 'fail', `refused with ${code}, which is not EACCES`))
    })
  })
}

/**
 * The daemon's own uid, read from `ps`. `ps -o uid=` prints a NUMBER, and the number is resolved to a name with
 * `id -un <uid>` — the same way an operator would read it, rather than trusting the process's own argv.
 */
function daemonUidArm() {
  const found = spawnSync('pgrep', ['-f', 'owner-daemon.mjs'], { encoding: 'utf8' })
  const pids = String(found.stdout ?? '').split('\n').map(line => line.trim()).filter(line => /^\d+$/.test(line))
  if (pids.length === 0) {
    return arm('the owner daemon process runs as aukora-owner', 'fail',
      'no owner-daemon.mjs process is running, so there is no second principal holding the key')
  }
  const uid = spawnSync('ps', ['-o', 'uid=', '-p', pids[0]], { encoding: 'utf8' })
  const numeric = String(uid.stdout ?? '').trim()
  const named = spawnSync('id', ['-un', numeric], { encoding: 'utf8' })
  const name = String(named.stdout ?? '').trim()
  const owners = [...new Set(pids.map((pid) => {
    const one = spawnSync('ps', ['-o', 'uid=', '-p', pid], { encoding: 'utf8' })
    const who = spawnSync('id', ['-un', String(one.stdout ?? '').trim()], { encoding: 'utf8' })
    return String(who.stdout ?? '').trim()
  }))]
  if (owners.length === 1 && owners[0] === OWNER_ACCOUNT) {
    return arm('the owner daemon process runs as aukora-owner', 'pass',
      `${String(pids.length)} process(es), all running as ${OWNER_ACCOUNT}`)
  }
  return arm('the owner daemon process runs as aukora-owner', 'fail',
    `the daemon is running as ${owners.join(', ') || name || numeric}, not ${OWNER_ACCOUNT}`)
}

// ── THE RECORD ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE RECORD SHAPE, FIXED BY KIRA'S STAMP TOOL — which is what will consume it, and which refuses to move the
 * claims page without `rows["16"].ok === true`.
 *
 *   { measuredAt, commit, host, arms: [{ name, result, detail }],
 *     rows: { "16": { measuredAt, commit, ok, detail } } }
 *
 * THE FIELDS, AND WHY EACH IS THE SHAPE IT IS:
 *   · **`measuredAt` IS A DATE (`YYYY-MM-DD`), NOT AN INSTANT.** `promotePending` matches
 *     `/^\d{4}-\d{2}-\d{2}$/` and refuses anything else, so the instant this run measured at is kept OUT of the
 *     record and only the day travels. The filename and `rows["16"].measuredAt` are the same day by construction.
 *   · **`result` IS `pass` OR `fail` — THERE IS NO `skip` HERE.** An arm that could not run is a FAILURE of this
 *     record: `ok` is true only if every arm passed, and a skipped arm did not pass. It stays `fail` rather than
 *     being dropped, because dropping it would leave the record looking complete while an arm never ran.
 *   · **`rows["16"]` IS MANDATORY**, and `ok` is `true` only when EVERY arm passed. It is the single field the
 *     stamp tool reads to decide whether the owner-cut claim may move onto the claims page.
 *
 * `mode` is carried as well, and it is ADDITIVE: `promotePending` ignores it, and it is what stops a simulated
 * run's record from being read as an installation by a person.
 *
 * THE FILENAME CARRIES THE DATE, so a reader can list installs without opening any file:
 * `docs/evidence/owner-cut-<YYYY-MM-DD>.json`. One per day; a second run the same day replaces it, because two
 * records for one day would make "which one is the measurement" a question.
 *
 * @param {readonly object[]} arms
 * @param {Readonly<{measuredAt: string, commit: string|null, host: string, mode?: string}>} meta
 */
export const buildRecord = (arms, meta) => {
  const day = String(meta.measuredAt).slice(0, 10)
  const commit = meta.commit ?? ''
  const failed = arms.filter(one => one.result !== 'pass')
  const ok = arms.length > 0 && failed.length === 0
  return Object.freeze({
    measuredAt: day,
    commit,
    host: meta.host,
    mode: meta.mode ?? 'measured',
    // THE CLAIM ROWS THIS RUN CAN STAMP. The stamp tool refuses a LIVE row unless the record NAMES it and marks it
    // passed, so a record that reports arms but no `rows` cannot stamp anything — measured: the install-day row
    // stayed un-stampable while every arm it ran was green. `meta.claims` is optional and absent means "measured no
    // claim row", which is the honest default.
    rows: Object.freeze(Object.fromEntries(Object.entries(meta.claims ?? {}).map(([id, one]) => [String(id), Object.freeze({
      measuredAt: day, commit, ok: one.ok === true, detail: one.detail ?? '',
    })]))),
    // THE STOCK SET IS A SECOND QUESTION, asked the same way: has the owner approved the stock plugins, and did a
    // REAL launch admit exactly that set? Until the approval exists this says so, rather than being omitted.
    stockSet: Object.freeze(meta.stockSet ?? {
      measured: false, detail: 'the owner has not approved the stock set yet, so no launch has been measured',
    }),
    arms: Object.freeze(arms.map(one => Object.freeze({
      name: one.name,
      // NO `skip` IN THIS RECORD: an arm that did not pass is a failure of the claim it stands for.
      result: one.result === 'pass' ? 'pass' : 'fail',
      detail: one.detail,
    }))),
    rows: Object.freeze({
      '16': Object.freeze({
        measuredAt: day,
        commit,
        ok,
        detail: ok
          ? `every arm passed on ${meta.host} — ${String(arms.length)} of ${String(arms.length)}`
          : `${String(failed.length)} of ${String(arms.length)} arm(s) did not pass: `
            + failed.map(one => one.name).slice(0, 3).join('; '),
      }),
    }),
  })
}

/** Where the record goes for a given instant. Exported so the court asserts the same rule the tool uses. */
export const recordPathFor = (measuredAt, dir = join(ROOT, 'docs', 'evidence')) =>
  join(dir, `owner-cut-${measuredAt.slice(0, 10)}.json`)

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const at = argv.indexOf(`--${name}`)
    if (at !== -1 && at + 1 < argv.length) return argv[at + 1]
    const joined = argv.find(value => value.startsWith(`--${name}=`))
    return joined === undefined ? undefined : joined.slice(name.length + 3)
  }
  const FIXTURE = flag('fixture')
  const PRINT = argv.includes('--print')
  const SIMULATE = argv.includes('--simulate')
  const EVIDENCE_DIR = flag('evidence-dir')

  process.stdout.write('\nTHE OWNER CUT, MEASURED ON THIS INSTALLATION — as the agent uid, no sudo\n\n')

  // ── THE PRECONDITION, AND IT IS THE ONE THING THAT MAKES THIS "NOT RUN" RATHER THAN "FAILED" ─────────
  if (FIXTURE === undefined && !ownerAccountExists()) {
    process.stdout.write(`NOT RUN: the ${OWNER_ACCOUNT} account does not exist, so there is no second uid to\n`)
    process.stdout.write('         be refused and nothing here can be measured. Peter creates it with\n')
    // *** NOT `sudo bash scripts/owner/setup-owner.sh` -- THAT IS ROOT CODE OUT OF A CHECKOUT THE AGENT CAN
    // WRITE, WHICH IS THE ONE THING THIS INSTALLER REFUSES ELSEWHERE. *** The supported path is INSTALL.md 1b:
    // stage a root-owned 0700 copy, compare both digests THERE, and execute only the staged file.
    process.stdout.write('         a STAGED root-owned copy of setup-owner.sh (INSTALL.md 1b -- stage it, compare\n')
    process.stdout.write('         both digests there, execute only the staged file), then runs this again.\n')
    process.stdout.write('Exit 2 means NOT RUN. It does not mean passed, and it does not mean failed.\n')
    process.exit(2)
  }

  const arms = []

  if (FIXTURE === undefined) {
    // 1. and 2. the existing instrument and the court whose three arms wake up now the account exists.
    arms.push(runChild('measure-boundary.mjs — the boundary instrument', process.execPath,
      [join(HERE, 'measure-boundary.mjs')]))
    arms.push(runChild('aukora-owner-protocol — the two-uid arms, no longer skipped', process.execPath,
      [join(ROOT, 'tests', 'aukora-owner-protocol.test.mjs')]))
  } else if (SIMULATE) {
    // SIMULATED TOO, SO THAT THE WHOLE RECORD IS SIMULATED AND THE EXIT-0 PATH IS REACHABLE. Marking these two
    // `skip` while simulating the checklist would make a simulated run exit 1 for ever, and the court could
    // never observe the shape of a GREEN record — which is the one a reader will actually be shown.
    arms.push(arm('measure-boundary.mjs — the boundary instrument', 'pass',
      'SIMULATED — the court exercises the record schema, not the boundary'))
    arms.push(arm('aukora-owner-protocol — the two-uid arms, no longer skipped', 'pass',
      'SIMULATED — the court exercises the record schema, not the boundary'))
  } else {
    // A FIXTURE CANNOT SPEAK FOR PARTS 1 AND 2. Both measure the REAL installation — the instrument reads
    // `/Library/Application Support/AUKORA-Owner` and `ps` — so running them against a layout would produce a
    // verdict about a directory that is not installed. They are recorded as skips, which is what they are.
    arms.push(arm('measure-boundary.mjs — the boundary instrument', 'skip',
      'fixture mode: the instrument measures the real install paths, which a fixture is not'))
    arms.push(arm('aukora-owner-protocol — the two-uid arms, no longer skipped', 'skip',
      'fixture mode: those arms need the real account, which a fixture does not create'))
  }

  // 3a. SIMULATED MODE, AND IT IS LABELLED RATHER THAN MISTAKEN FOR A MEASUREMENT.
  //
  // **THE COURT NEEDS A VALID RECORD AND THIS MACHINE CANNOT PRODUCE A REAL ONE.** The refusals below are
  // `EACCES` produced by the KERNEL because the file belongs to `aukora-owner`; a fixture is created BY the
  // running user, so an ordinary `chmod 600` file is still theirs to read and every arm would fail on a
  // perfectly good layout. Producing a real refusal needs `chown`, which needs root — the one thing this
  // command is defined by NOT having.
  //
  // So the schema is exercised by DECLARING the arms instead of attempting them, and the record carries
  // `"mode": "simulated"` so a consumer can never read one as an installation. **A SIMULATED RECORD IS NOT
  // WRITTEN TO docs/evidence/**: that directory is for measurements on real installations, and a simulated
  // file sitting beside them is exactly the artefact someone would later quote as evidence.
  if (SIMULATE) {
    for (const name of [
      'agent-uid read of the owner key is refused (EACCES)',
      'agent-uid connect to approve.sock is refused (EACCES)',
      'agent-uid write to the journal is refused',
      'the owner daemon process runs as aukora-owner',
    ]) arms.push(arm(name, 'pass', 'SIMULATED — the court exercises the record schema, not the boundary'))
  } else {
  // 3. the live checklist, against the real paths or a layout.
  const configPath = join(FIXTURE ?? '/usr/local/etc', 'aukora-owner.json')
  let config = {}
  const cfgState = pathState(configPath)
  if (cfgState === 'unreadable') {
    // *** AN ANCESTOR THAT DENIES ACCESS MUST NOT FALL BACK TO DEFAULT PATHS (Codex r6 finding 7). ***
    // `existsSync` returned FALSE here, so the whole block below was SKIPPED and the checklist ran against the
    // DEFAULT layout -- reporting on an install that is not the one on disk, while looking like a normal run.
    process.stdout.write(`NOT RUN: ${configPath} cannot be examined by this uid (an ancestor denies access).\n`)
    process.stdout.write('         THAT IS THE BOUNDARY WORKING, AND IT IS NOT AN ABSENT CONFIG: falling back to\n')
    process.stdout.write('         the default layout here would describe an install that is not on disk.\n')
    process.stdout.write('Exit 2 means NOT RUN. It does not mean passed, and it does not mean failed.\n')
    process.exit(2)
  }
  if (cfgState === 'present') {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (error) {
      // *** AN UNREADABLE CONFIG IS NOT AN ABSENT ONE (Codex r5 item 7). *** This was `catch { config = {} }`,
      // SO AN `EACCES` ON THE CONFIG -- the ordinary case for the agent uid, and the very boundary this file
      // exists to measure -- BECAME AN EMPTY OBJECT. The checklist then fell back to default paths and reported
      // on a layout that is not the installed one, WHILE LOOKING EXACTLY LIKE A SUCCESSFUL RUN.
      // `ENOENT` IS GENUINELY "NO CONFIG" and the caller handles it; anything else is a refusal.
      if (error?.code !== 'ENOENT') {
        process.stdout.write(`NOT RUN: ${configPath} exists but cannot be read (${String(error?.code ?? error)}).\n`)
        process.stdout.write('         A FILE THAT CANNOT BE READ IS NOT A FILE THAT IS ABSENT: reporting the\n')
        process.stdout.write('         default layout here would describe an install that is not the one on disk.\n')
        process.stdout.write('Exit 2 means NOT RUN. It does not mean passed, and it does not mean failed.\n')
        process.exit(2)
      }
      config = {}
    }
  }
  const runDir = FIXTURE !== undefined
    ? FIXTURE
    : (typeof config.runDir === 'string' && config.runDir.length > 0
      ? config.runDir
      : '/Library/Application Support/AUKORA-Owner')
  // *** THE KEY AND THE JOURNAL LIVE IN ownerDir, NOT runDir, AND THE CONFIG SAYS SO. *** Setup writes
  // `"keyFile": "$OWNER_T/owner.key"` (`:894`) and the record — key, journal, witness — is `$OWNER_T`, the
  // 0700 root-owned directory teardown refuses to touch without a ledger row. THIS FILE BUILT BOTH PATHS FROM
  // `runDir`, WHICH IS THE SOCKETS-AND-LOGS DIRECTORY, SO THE TWO ARMS THAT MATTER MOST -- agent-uid read of the
  // key, agent-uid write to the journal -- WERE POINTED AT PATHS THE INSTALL NEVER CREATES. A BOUNDARY MEASURED
  // AT THE WRONG PATH IS NOT A BOUNDARY: it can pass on ENOENT while the real key sits readable somewhere else.
  // THE CONFIG IS THE AUTHORITY, and the fallback is `ownerDir`, which is where setup puts them.
  const ownerDir = FIXTURE !== undefined
    ? FIXTURE
    : (typeof config.ownerDir === 'string' && config.ownerDir.length > 0
      ? config.ownerDir
      : runDir)
  arms.push(...await checklist({
    keyFile: typeof config.keyFile === 'string' && config.keyFile.length > 0
      ? config.keyFile
      : join(ownerDir, 'owner.key'),
    journal: typeof config.journal === 'string' && config.journal.length > 0
      ? config.journal
      : join(ownerDir, 'journal.jsonl'),
    approveSocket: typeof config.approveSocket === 'string' && config.approveSocket.length > 0
      ? config.approveSocket
      : join(runDir, 'approve.sock'),
  }))
  }

  const measuredAt = new Date().toISOString()
  const record = buildRecord(arms, {
    measuredAt, commit: commitOf(), host: hostString(), mode: SIMULATE ? 'simulated' : 'measured',
  })

  for (const one of record.arms) {
    process.stdout.write(`  ${one.result.toUpperCase().padEnd(4)}  ${one.name}\n`)
    process.stdout.write(`        ${one.detail}\n`)
  }

  const failed = record.arms.filter(one => one.result === 'fail')
  const skipped = record.arms.filter(one => one.result === 'skip')
  const passed = record.arms.filter(one => one.result === 'pass')
  process.stdout.write(`\n${String(passed.length)} passed, ${String(failed.length)} failed, `
    + `${String(skipped.length)} skipped\n`)

  if (PRINT) process.stdout.write(`\n${JSON.stringify(record, null, 2)}\n`)

  // ── THE RECORD IS WRITTEN ONLY ON A FULLY GREEN RUN ──────────────────────────────────────────────────
  if (failed.length > 0 || skipped.length > 0) {
    if (!PRINT) process.stdout.write('NO RECORD WRITTEN: a record is a statement that the cut holds, and this '
      + 'run cannot make it.\n')
    process.exit(1)
  }
  if (PRINT) process.exit(0)
  // A SIMULATED RUN WRITES ONLY WHERE THE CALLER REDIRECTED IT. `docs/evidence/` holds measurements on real
  // installations, so a simulated file there is exactly the artefact a later reader would quote as evidence —
  // but a caller that passed `--evidence-dir` has named a destination of its own, and refusing to write is what
  // left the write path itself unexercised. **THE DEFAULT IS THE PROTECTED ONE**; the redirect is explicit.
  if (record.mode === 'simulated' && EVIDENCE_DIR === undefined) {
    process.stdout.write('NO RECORD WRITTEN: this run was SIMULATED, and docs/evidence/ holds measurements on '
      + 'real installations only.\n')
    process.exit(0)
  }

  // THE DESTINATION IS OVERRIDABLE ONLY SO THE COURT CAN EXERCISE THIS WRITE. A fixture written into
  // `docs/evidence/` would be a file nobody measured sitting where measurements live, so the court sends it to
  // its own temporary directory and reads back what a real run would have produced.
  const path = recordPathFor(measuredAt, EVIDENCE_DIR ?? join(ROOT, 'docs', 'evidence'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  process.stdout.write(`record written: ${path}\n`)
  process.exit(0)
}

if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  await main()
}
