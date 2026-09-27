/**
 * courts/harness/launch-ceremony — who starts the guest, and with what?
 *
 * This court measures the product launch path and the custody properties that
 * path does not establish. A source-development parent starts the issuer,
 * broker, and guest, but all four processes retain one uid and the active
 * artifact is not verified as an immutable executable closure. Source launch,
 * process custody, platform mechanism, restoration, and limitation remain
 * separate rows.
 *
 * The oracle owner controls this court, its expected rows, and the known-breach
 * enrollment independently of implementation changes. A product change that
 * moves a row must stop the Gate until the oracle remeasures and records the
 * new partition.
 *
 *   P1  parent caller  a tracked production parent calls spawnBroker from above
 *   P2  one principal  spawnBroker leaves the broker as the caller's own child at
 *                      the caller's uid, while its
 *                      peerTokenPath parameter presumes a party above both
 *   P3  broker route   a tracked product parent reaches the broker through spawnBroker,
 *                      while evidence-only callers remain outside production
 *   U1  one uid        the harness process and the broker share a uid today, in the
 *                      kernel's answer and in the broker's own signed bytes
 *   D1  right target   the macOS target uses launchd-provisioned principals and
 *                      explicitly requires no in-process privilege drop; this is a
 *                      specification control, not evidence that the jobs exist
 *   A1  unverified     the active artifact is not verified before launch: no digest
 *                      manifest, no verification in the launch path, tampered bytes
 *                      boot exit 0, and the guest's uid can write the plugin it loads
 *   G1  live subject   no court-owned live product ceremony and guest handle exists
 *   G2  this host      what this host can and cannot stage unattended, measured
 *   C1  not literal    configuration is not supplied as literals by a parent: the
 *                      governed config fields are expression nodes the guest's own
 *                      environment resolves, through the real vendored evaluator
 *   K1  the class      a real boot here mints state-owned; peer-separated needs the
 *                      party that does not exist
 *   K2  mechanism      the peer raise reachable here is a token the same uid planted,
 *                      recorded as mechanism only — the same limitation
 *                      courts/harness/confinement records at C10/C14
 *   S1  restore        every write lived in one temp tree; the real profile is
 *                      byte-identical to how this court found it
 *   L1  limitation     what this court does NOT prove, recorded rather than implied
 *
 * WHY THIS COURT DOES NOT EXIT 77. courts/harness/uid-confinement exits 77 on
 * darwin, and its header states precisely what is Linux-only: that court's
 * MECHANISM (`setpriv`, `sudo -n`), NOT the uid split as such. Row G2 re-measures
 * the same facts here — setpriv absent, `sudo -n` requiring a password, and the
 * host's own service accounts under uid 500 — so the ingredients for a split
 * exist and it is UNATTENDED operation that fails. P1 and P3 measure tracked
 * product callers and keep evidence-only callers separate. G1 grades only
 * whether its live subject exists: this court has no product-ceremony handle,
 * so the row stays red. When
 * that implementation exists, the oracle owner must add handle-bound process
 * observation through absolute paths plus positive and negative controls; this
 * court does not ship a speculative acceptance predicate for a missing subject.
 * Exiting 77 here would turn that absence of live evidence into a skip. The one
 * genuinely platform-gated act — STAGING a real second uid to demonstrate a
 * launch — lives behind `--prove-second-uid`, which exits 77 on darwin and says
 * why.
 *
 * --mutate stages three counterfactuals named by the completion criteria:
 *   M1 a mocked guest uid — a claim of a second uid that the kernel contradicts;
 *   M2 a function returning writableByGuest:false — a JS answer where only the
 *      kernel's answer counts;
 *   M3 removal of the evidence-only classifier — the transcript becomes a
 *      production caller;
 * These grade THIS COURT'S OWN PREDICATES. They prove the court detects the
 * three named counterfactuals; they do not stage a boundary, and no row here
 * claims one.
 *
 * SAFETY. Every write goes through one guard into one mkdtemp directory under
 * the OS temp dir. Key material is generated per run and dies with the temp
 * tree: no ~/.aukora, no keychain, no real root key, no network. The real
 * profile is digested before the first row and re-digested in the `finally`,
 * and a mismatch overrides any verdict above it.
 *
 *   node courts/harness/launch-ceremony/run.mjs
 *   node courts/harness/launch-ceremony/run.mjs --mutate
 *   node courts/harness/launch-ceremony/run.mjs --prove-second-uid
 */
import { generateKeyPairSync, sign as edSign, createHash, randomBytes } from 'node:crypto'
import {
  accessSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync, constants as FS,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'js-yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(join(HERE, '../../..'))

const MUTATE = process.argv.includes('--mutate')
const PROVE_SECOND_UID = process.argv.includes('--prove-second-uid')

/** The governed profile: the composition a supervisor would hand the 8088 guest. */
const PROFILE = '8088-inside-out'
const REAL_PROFILE_DIR = join(ROOT, 'profiles', PROFILE)
const PATCH_FILENAME = 'cordis.patch.yml'
/** The source launch the operator uses; `pnpm dsh` is this with no shell in between. */
const CLI_ENTRY = join(ROOT, 'apps/cli/src/bin.ts')
/** The module that DEFINES spawnBroker. Its own text is not a caller. */
const BROKER_MODULE = 'aukora/broker/broker.mjs'
const BROKER_ENTRY = join(ROOT, BROKER_MODULE)
const EVIDENCE_TRANSCRIPT = 'scripts/aukora-broker-proposal-transcript.mjs'
/** The vendored evaluator the Loader resolves `!!js` config values with. */
const LOADER_UTILS = join(ROOT, 'vendor/loader/src/config/utils.ts')
/** The include dialect that reads a `!!js` scalar as an expression node. */
const INCLUDE_LIB = join(ROOT, 'vendor/include/lib/index.js')
/** The active artifact: the plugin that implements the one governed effect. */
const ACTIVE_ARTIFACT = join(ROOT, 'packages/governed/memory-put/lib/index.js')
/** The current launch-topology specification. D1 checks its selected mechanism, not runtime existence. */
const CONTRACT_FILE = join(ROOT, 'docs/specs/BRICK-0-CONTRACT.ts')
/** Kernel process-table reader; never resolved through caller-controlled PATH. */
const PS_ENTRY = '/bin/ps'
/**
 * The JSDoc that presumes a party above both. Quoted verbatim from broker.mjs
 * so a reworded contract fails this row loudly instead of passing silently.
 */
const PEER_TOKEN_DOC = 'a guest-owned 0600 token the broker must NOT be able to read'
/** Modules the launcher runs before the composition is live. Verified? Measured below. */
const LAUNCH_PATH = [
  'apps/cli/src/bin.ts',
  'apps/cli/src/profile-boot.ts',
  'apps/cli/src/dump-config.ts',
  'packages/boot/app-boot/src/profile.ts',
]
/** Words a launch path that verified its artifact before running it would have to use. */
const VERIFICATION_WORDS = /\b(digest|sha256|signature|attest|verifyBytes)\b/

if (process.platform === 'win32') {
  console.log('\n  courts/harness/launch-ceremony — SKIPPED BY DESIGN')
  console.log('  the uid and mode rows are POSIX facts; win32 reports neither.\n')
  process.exit(77)
}
for (const required of [REAL_PROFILE_DIR, CLI_ENTRY, BROKER_ENTRY, LOADER_UTILS, INCLUDE_LIB, CONTRACT_FILE, PS_ENTRY]) {
  if (!existsSync(required)) {
    console.error(`courts/harness/launch-ceremony: cannot grade — missing ${required}`)
    process.exit(1)
  }
}

const EUID = process.geteuid()

// ---------------------------------------------------------------------------
// --prove-second-uid — the one genuinely platform-gated act, kept out of the
// graded rows so no absence above hides behind a skip.
// ---------------------------------------------------------------------------
if (PROVE_SECOND_UID) {
  const host = probeHost()
  console.log('\n  courts/harness/launch-ceremony --prove-second-uid\n  ' + '-'.repeat(72))
  if (process.platform !== 'linux') {
    console.log(`  This arm STAGES a real second uid and launches something at it. On ${process.platform}`)
    console.log(`  the unattended mechanism is absent: setpriv=${host.setpriv}, 'sudo -n'=${host.sudoNonInteractive}.`)
    console.log(`  The ingredients are present — ${host.serviceAccountsBelow500} service accounts under uid 500 —`)
    console.log('  so it is UNATTENDED operation that fails here, not the uid split as such.')
    console.log('  Exit 77 = SKIPPED BY DESIGN. It is never counted as a pass, and it does not')
    console.log('  excuse a single graded row: run this file with no flags for those.')
    console.log('\n  observationClass: SKIP (platform-gated)\n')
    process.exit(77)
  }
  console.log('  This host HAS the mechanism. It does not have the thing to prove: no supervisor')
  console.log('  exists to launch a guest at a second uid (rows P1/P3 and G1\'s missing live evidence). There is')
  console.log('  nothing to stage, so this is a breach, not a skip.')
  console.log('\n  observationClass: SELF-REPORTED\n')
  process.exit(1)
}

const TMP = mkdtempSync(join(tmpdir(), 'aukora-launch-ceremony-'))

/** Every write in this court goes through here; nothing outside TMP is writable. */
const guard = (path) => {
  const abs = resolve(path)
  const rel = relative(TMP, abs)
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
    throw new Error(`launch-ceremony: refusing to touch ${abs} — outside ${TMP}`)
  }
  return abs
}
const write = (path, text) => writeFileSync(guard(path), text, 'utf8')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Recursive digest of a directory: relative path -> content hash. */
const digestTree = (dir) => {
  const out = {}
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else out[relative(dir, full)] = sha256(readFileSync(full))
    }
  }
  walk(dir)
  return out
}

// The seal. Taken before anything runs and checked in the `finally`.
const REAL_SEAL = digestTree(REAL_PROFILE_DIR)

/**
 * Print order, fixed to the header's listing. Rows are recorded in the order
 * their evidence becomes available — one live broker serves three of them — so
 * a reader would otherwise meet them in an order the docblock does not use.
 */
const ROW_ORDER = ['P1', 'P2', 'P3', 'U1', 'D1', 'A1', 'G1', 'G2', 'C1', 'K1', 'K2', 'S1', 'L1']

const rows = []
const row = (n, label, observed, expected) => {
  if (!ROW_ORDER.includes(n)) throw new Error(`launch-ceremony: row ${n} is not in ROW_ORDER`)
  rows.push({ n, label, observed, expected, breach: JSON.stringify(observed) !== JSON.stringify(expected) })
}
const inOrder = () => [...rows].sort((a, b) => ROW_ORDER.indexOf(a.n) - ROW_ORDER.indexOf(b.n))

/** Require every ordinary row exactly once. */
const rowsComplete = () => {
  const names = new Set(rows.map(({ n }) => n))
  return rows.length === ROW_ORDER.length
    && names.size === ROW_ORDER.length
    && ROW_ORDER.every((name) => names.has(name))
}

/** Require every named breach, every unnamed control, and every row name once. */
const mutationRowsMatch = (expectedBreaches) => {
  const expected = new Set(expectedBreaches)
  const names = new Set(rows.map(({ n }) => n))
  return rowsComplete()
    && expected.size === expectedBreaches.length
    && names.size === rows.length
    && expectedBreaches.every((name) => names.has(name))
    && rows.every(({ n, breach }) => breach === expected.has(n))
}

/** Whether this process may write `path` right now, by the KERNEL's answer. */
const writable = (path) => {
  try {
    accessSync(path, FS.W_OK)
    return true
  } catch {
    // Not an error here: "the kernel says no" is exactly the measurement.
    return false
  }
}

const modeOf = (path) => (statSync(path).mode & 0o7777).toString(8).padStart(4, '0')

/**
 * What kind of file is this, for the purpose of "does the PRODUCT do X".
 * Order matters: the first pattern that matches wins.
 */
const KINDS = [
  [/^archive\//, 'archive'],
  [/^courts\//, 'court'],
  [/^scripts\/aukora-broker-proposal-transcript\.mjs$/, 'evidence'],
  [/^\.agents\//, 'note'],
  [/^docs\//, 'doc'],
  [/\.md$/, 'doc'],
  [/\.i18n\.yaml$/, 'doc'],
  [/^BRICK-0-[A-Z-]+\.ts$/, 'specification'],
  [/(^|\/)tests?\//, 'test'],
  [/\.(spec|test)\.[cm]?[jt]sx?$/, 'test'],
  [/\.d\.[cm]?ts$/, 'declaration'],
  [/^pnpm-lock\.yaml$/, 'lockfile'],
]
const kindOfWith = (relPath, kinds) => {
  for (const [pattern, kind] of kinds) if (pattern.test(relPath)) return kind
  return 'production'
}
const kindOf = (relPath) => kindOfWith(relPath, KINDS)

/** Every tracked file, from git itself rather than a walk this court invented. */
const trackedFiles = (() => {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`launch-ceremony: git ls-files failed: ${(r.stderr ?? '').slice(0, 300)}`)
  return r.stdout.split('\0').filter(Boolean)
})()

/**
 * The tracked tree's text, read once. A tracked path this uid cannot read is
 * held as null: it is not a caller, and its absence from a scan is not a claim
 * that it said nothing.
 */
const trackedText = new Map(trackedFiles.map((relPath) => {
  try {
    return [relPath, readFileSync(join(ROOT, relPath), 'utf8')]
  } catch {
    // Unreadable at this uid, or not text. Either way it is not a call site.
    return [relPath, null]
  }
}))

/**
 * Which tracked files mention `needle`, grouped by kind. Read-only; the
 * defining module is excluded by path so a definition is never a caller.
 */
const mentions = (needle, { except = [] } = {}) => {
  const byKind = {}
  for (const [relPath, text] of trackedText) {
    if (text === null || except.includes(relPath)) continue
    if (!text.includes(needle)) continue
    ;(byKind[kindOf(relPath)] ??= []).push(relPath)
  }
  for (const list of Object.values(byKind)) list.sort()
  return byKind
}

/** Measure this host's unattended uid-split mechanism. No side effects. */
function probeHost() {
  const setprivPresent = ['/usr/bin/setpriv', '/bin/setpriv'].some((candidate) => {
    try { accessSync(candidate, FS.X_OK); return true } catch { return false }
  })
  const sudo = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8' })
  let serviceAccountsBelow500 = null
  if (process.platform === 'darwin') {
    const dscl = spawnSync('dscl', ['.', '-list', '/Users', 'UniqueID'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    if (dscl.status === 0) {
      serviceAccountsBelow500 = dscl.stdout.split('\n')
        .map((line) => Number.parseInt(line.trim().split(/\s+/).at(-1) ?? '', 10))
        .filter((n) => Number.isInteger(n) && n < 500).length
    }
  }
  return {
    platform: process.platform,
    setpriv: setprivPresent ? 'present' : 'absent',
    sudoNonInteractive: sudo.status === 0 ? 'permitted' : 'refused',
    serviceAccountsBelow500,
  }
}

let homeSeq = 0
/** A fresh `$DSH_HOME` holding a writable copy of the real profile. */
const freshHome = (label) => {
  const home = join(TMP, `home-${String(++homeSeq).padStart(2, '0')}-${label}`)
  const dir = guard(join(home, 'profiles', PROFILE))
  mkdirSync(guard(join(home, 'profiles')), { recursive: true })
  cpSync(REAL_PROFILE_DIR, dir, { recursive: true })
  // cpSync carries the source modes over. The copy must be court-writable
  // whatever the shipped modes are, or the tamper half of A1 would stop being
  // measurable the moment somebody tightened the real files.
  chmodSync(guard(dir), 0o755)
  for (const name of readdirSync(dir)) chmodSync(guard(join(dir, name)), 0o644)
  return { home, dir, patch: join(dir, PATCH_FILENAME) }
}

/**
 * Ask the product what composition governs a run of this profile, through the
 * operator's own command. spawnSync with an argv array: nothing is piped, so
 * the exit code this court reads is the CLI's own.
 */
const compose = (home) => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') || key.startsWith('AUKORA_') || key === 'NODE_OPTIONS') delete env[key]
  }
  env.DSH_HOME = home
  const r = spawnSync(process.execPath, ['--import', 'tsx/esm', CLI_ENTRY, '--profile', PROFILE, '--dump-config'], {
    cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  })
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() }
}

/** A newline-delimited JSON client over one connection to the broker. */
const client = (socketPath) => {
  const conn = createConnection(socketPath)
  let buffer = ''
  const pending = new Map()
  let id = 0
  conn.on('error', () => { /* a court that closes mid-frame is not an event this client acts on */ })
  conn.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      const reply = JSON.parse(line)
      const waiter = pending.get(reply.id)
      if (waiter) { pending.delete(reply.id); waiter(reply) }
    }
  })
  return {
    send: (request) => new Promise((resolveReply) => {
      const rid = ++id
      pending.set(rid, resolveReply)
      conn.write(`${JSON.stringify({ id: rid, ...request })}\n`)
    }),
    close: () => conn.destroy(),
  }
}

/** Live pid, parent pid, and uid from the kernel process table. */
const processIdentity = (pid) => {
  const r = spawnSync(PS_ENTRY, ['-o', 'ppid=,uid=', '-p', String(pid)], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const [ppidText, uidText] = (r.stdout ?? '').trim().split(/\s+/)
  const ppid = Number.parseInt(ppidText ?? '', 10)
  const uid = Number.parseInt(uidText ?? '', 10)
  return Number.isInteger(ppid) && Number.isInteger(uid) ? { pid, ppid, uid } : null
}

const { payloadDigest, grantPreimage } = await import(join(ROOT, 'aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, MEMORY_PUT } = await import(join(ROOT, 'aukora/broker/effect.mjs'))
const { buildOperation, operationDigest } = await import(join(ROOT, 'aukora/broker/operation.mjs'))
const { spawnBroker } = await import(join(ROOT, BROKER_MODULE))
const { CONFINEMENT_CLASS, CONFINEMENT_REFUSE, PEER_TOKEN_BYTES } = await import(join(ROOT, 'aukora/broker/confinement.mjs'))
const { entryListSchema } = await import(INCLUDE_LIB)

const DEF = definitionDigest()
/** Ephemeral, per-run, and dead with the temp tree. Never a real root key. */
const rootKey = generateKeyPairSync('ed25519')
const rootPem = rootKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** One grant for one call. Every field the hardened verifier requires. */
const mintGrant = (args, nonce, receiptKeyId) => {
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = {
    toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, args), nonce,
    exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(args, exp)), receiptKeyId,
  }
  return { ...g, signature: edSign(null, grantPreimage(g), rootKey.privateKey).toString('base64') }
}

let exitCode = 1
try {
  // -------------------------------------------------------------------------
  // P1 and P3 measure the source parent; P2 measures the custody it lacks.
  // -------------------------------------------------------------------------
  const callers = mentions('spawnBroker(', { except: [BROKER_MODULE] })
  const launchers = mentions(BROKER_MODULE, { except: [BROKER_MODULE] })
  // The three modules that DEFINE the peer-token seam. Naming the parameter is
  // what a definition does; the question is who PLANTS a token, so the seam's
  // own files are excluded by path and listed in the row that excludes them.
  const PEER_TOKEN_SEAM = [BROKER_MODULE, 'aukora/broker/broker.d.mts', 'aukora/broker/confinement.mjs']
  const tokenPassers = mentions('peerTokenPath', { except: PEER_TOKEN_SEAM })

  row('P1', 'a tracked production parent calls spawnBroker from above', {
    productionCallers: callers.production ?? [],
    courtCallers: (callers.court ?? []).length,
    testCallers: (callers.test ?? []).length,
    archiveCallers: (callers.archive ?? []).length,
    evidenceCallers: callers.evidence ?? [],
    somethingStartsTheBrokerFromAbove: (callers.production ?? []).length > 0,
  }, {
    // A supervisor is one production caller, at minimum. Zero is the absence.
    productionCallers: callers.production ?? [],
    courtCallers: (callers.court ?? []).length,
    testCallers: (callers.test ?? []).length,
    archiveCallers: (callers.archive ?? []).length,
    evidenceCallers: callers.evidence ?? [],
    somethingStartsTheBrokerFromAbove: true,
  })

  const productionCallers = callers.production ?? []
  const evidenceCallers = callers.evidence ?? []
  const productionMentions = launchers.production ?? []
  const evidenceMentions = launchers.evidence ?? []
  row('P3', 'a product parent reaches the broker while evidence callers stay non-production', {
    productionCallers,
    evidenceCallers,
    productionMentions,
    evidenceMentions,
    dialledSocketDefault: readFileSync(join(REAL_PROFILE_DIR, PATCH_FILENAME), 'utf8').includes('/run/aukora/broker.sock'),
    productBrokerRouteExists: productionCallers.length > 0,
    transcriptClassifiedAsEvidence: evidenceCallers.includes(EVIDENCE_TRANSCRIPT)
      && evidenceMentions.includes(EVIDENCE_TRANSCRIPT),
    transcriptAbsentFromProduction: !productionCallers.includes(EVIDENCE_TRANSCRIPT)
      && !productionMentions.includes(EVIDENCE_TRANSCRIPT),
  }, {
    productionCallers,
    evidenceCallers,
    productionMentions,
    evidenceMentions,
    dialledSocketDefault: true,
    productBrokerRouteExists: true,
    transcriptClassifiedAsEvidence: true,
    transcriptAbsentFromProduction: true,
  })

  // -------------------------------------------------------------------------
  // U1, P2, K1 — one real broker, launched the only way this tree can launch
  // one: downward, from a process at the guest's own uid.
  // -------------------------------------------------------------------------
  const liveDir = join(TMP, 'live', 'state')
  const liveSock = join(TMP, 'live', 'b.sock')
  mkdirSync(guard(join(TMP, 'live')), { recursive: true, mode: 0o700 })
  const live = await spawnBroker({ socketPath: liveSock, stateDir: liveDir, rootPublicKeyPem: rootPem })
  const liveClient = client(liveSock)
  const liveStatus = await liveClient.send({ op: 'status' })
  const LIVE_ARGS = { key: 'launch-ceremony', value: { measured: 'one uid' } }
  const settled = await liveClient.send({
    op: 'memory.put', toolName: MEMORY_PUT, arguments: LIVE_ARGS, grant: mintGrant(LIVE_ARGS, 'lc-01', liveStatus.receiptKeyId),
  })
  const signedConfinement = settled.receipt?.confinement
  const liveBrokerIdentity = processIdentity(live.pid)
  const brokerPpid = liveBrokerIdentity?.ppid ?? null

  row('U1', 'the harness process and the broker share a uid today', {
    settled: settled.state === 'SETTLED',
    courtEuid: EUID,
    stateDirOwner: statSync(liveDir).uid,
    brokerSignedEuid: signedConfinement?.euid,
    sameUid: statSync(liveDir).uid === EUID && signedConfinement?.euid === EUID,
  }, {
    settled: true,
    courtEuid: EUID,
    stateDirOwner: statSync(liveDir).uid,
    brokerSignedEuid: signedConfinement?.euid,
    // A launch ceremony puts the broker at a uid the guest is not.
    sameUid: false,
  })

  row('P2', 'spawnBroker retains the caller uid; peerTokenPath presumes a distinct principal', {
    definedIn: BROKER_MODULE,
    brokerIsTheCallersOwnChild: brokerPpid === process.pid,
    // `euid:` and `stateUid:` must not match: the question is a spawn option
    // named exactly `uid`, which is the only way Node launches at another one.
    spawnPassesNoUid: !/(^|[^A-Za-z])uid\s*:/m.test(readFileSync(BROKER_ENTRY, 'utf8')),
    peerTokenDocPresent: readFileSync(BROKER_ENTRY, 'utf8').includes(PEER_TOKEN_DOC),
    seamModulesExcluded: PEER_TOKEN_SEAM,
    productionPassersOfPeerToken: tokenPassers.production ?? [],
    aPartyAboveBothPlantsIt: (tokenPassers.production ?? []).length > 0,
  }, {
    definedIn: BROKER_MODULE,
    // Descriptive, not graded: a supervisor existing would not stop THIS
    // process from also spawning a broker as its own child.
    brokerIsTheCallersOwnChild: brokerPpid === process.pid,
    spawnPassesNoUid: true,
    peerTokenDocPresent: true,
    seamModulesExcluded: PEER_TOKEN_SEAM,
    productionPassersOfPeerToken: tokenPassers.production ?? [],
    // The graded half: only a party holding BOTH uids can plant a token the
    // broker cannot read. The parameter documents one; nothing plants one.
    aPartyAboveBothPlantsIt: true,
  })

  row('K1', 'a real boot here mints state-owned; peer-separated needs distinct principals', {
    ceiling: liveStatus.confinement?.ceiling,
    settledClass: signedConfinement?.class,
    sealClass: signedConfinement?.sealClass,
    peerProof: signedConfinement?.peerProof,
    classIsPeerSeparated: signedConfinement?.class === CONFINEMENT_CLASS.PEER_SEPARATED,
  }, {
    ceiling: CONFINEMENT_CLASS.STATE_OWNED,
    settledClass: CONFINEMENT_CLASS.STATE_OWNED,
    sealClass: CONFINEMENT_CLASS.STATE_OWNED,
    peerProof: null,
    // Under a launch ceremony the guest and the broker are two uids and the
    // class the broker can honestly mint is peer-separated.
    classIsPeerSeparated: true,
  })
  liveClient.close()
  live.kill()
  await delay(50)

  // -------------------------------------------------------------------------
  // K2 — the peer raise this host CAN reach, and why it is not the boundary.
  // The token below is mode 0000, so the broker's EACCES is real, but THIS
  // COURT WROTE THE BYTES and at one uid can chmod the file back. Identical in
  // kind to courts/harness/confinement C10, and recorded here for the same
  // reason: the raise is a code path, not a custody fact.
  // -------------------------------------------------------------------------
  const peerDir = join(TMP, 'peer', 'state')
  const peerSock = join(TMP, 'peer', 'b.sock')
  mkdirSync(guard(join(TMP, 'peer')), { recursive: true, mode: 0o700 })
  const tokenPath = guard(join(TMP, 'peer', 'peer-token'))
  const tokenBytes = randomBytes(PEER_TOKEN_BYTES)
  writeFileSync(tokenPath, tokenBytes, { mode: 0o600 })
  chmodSync(tokenPath, 0o000)
  const peerBroker = await spawnBroker({
    socketPath: peerSock, stateDir: peerDir, rootPublicKeyPem: rootPem,
    peerTokenPath: tokenPath, peerTokenSha256: sha256(tokenBytes),
  })
  const peerClient = client(peerSock)
  const bluff = await peerClient.send({ op: 'confinement.prove', token: randomBytes(PEER_TOKEN_BYTES).toString('base64') })
  const proved = await peerClient.send({ op: 'confinement.prove', token: tokenBytes.toString('base64') })
  // The court can lift its own lock, which is the whole point of the row.
  chmodSync(tokenPath, 0o600)
  const courtCanReadTheTokenAnyway = readFileSync(tokenPath).equals(tokenBytes)
  chmodSync(tokenPath, 0o000)
  peerClient.close()
  peerBroker.kill()
  await delay(50)

  row('K2', 'the peer raise reachable here is a token the same uid planted', {
    wrongEchoRefused: bluff.ok === false && bluff.reason === CONFINEMENT_REFUSE.PEER_ECHO_MISMATCH,
    rightEchoClass: proved.class,
    tokenPlantedBy: EUID,
    courtCanReadTheTokenAnyway,
    mechanismOnly: true,
  }, {
    wrongEchoRefused: true,
    rightEchoClass: CONFINEMENT_CLASS.PEER_SEPARATED,
    tokenPlantedBy: EUID,
    courtCanReadTheTokenAnyway: true,
    mechanismOnly: true,
  })

  // -------------------------------------------------------------------------
  // D1 — the macOS target never starts privileged and then drops. launchd starts
  // each job under its provisioned principal. This row keeps the court aligned
  // with that target; G1 separately remains red until the live jobs exist.
  // -------------------------------------------------------------------------
  const dropSiteGroups = ['process.setuid', 'process.seteuid', 'process.setgid', 'process.setegid']
    .map((needle) => mentions(needle, { except: [] }).production ?? [])
  const contractText = readFileSync(CONTRACT_FILE, 'utf8')
  row('D1', 'the target uses provisioned launchd principals, not a privilege drop', {
    productionDropSites: dropSiteGroups.flat().sort(),
    contractNamesLaunchdProvisioning: contractText.includes("| 'launchd-provisioned'"),
    contractSaysNoDrop: contractText.includes('There is no drop to perform.'),
    runtimeSeparationClaimedByThisRow: false,
  }, {
    productionDropSites: [],
    contractNamesLaunchdProvisioning: true,
    contractSaysNoDrop: true,
    runtimeSeparationClaimedByThisRow: false,
  })

  // -------------------------------------------------------------------------
  // G1 grades live subject presence. The source parent exists, but this court
  // has no handle to a product launch. Source text is not a substitute.
  // -------------------------------------------------------------------------
  const productCeremonySubject = null
  row('G1', 'a court-owned live product ceremony and guest handle exists', {
    subjectPresent: productCeremonySubject !== null,
    diagnosticCourtSpawnedBroker: liveBrokerIdentity,
    acceptancePredicateImplemented: false,
  }, {
    subjectPresent: true,
    diagnosticCourtSpawnedBroker: liveBrokerIdentity,
    acceptancePredicateImplemented: false,
  })

  const host = probeHost()
  row('G2', 'what this host can and cannot stage unattended, measured', {
    ...host,
    ingredientsExist: (host.serviceAccountsBelow500 ?? 0) > 0,
    unattendedMechanismExists: host.setpriv === 'present' && host.sudoNonInteractive === 'permitted',
  }, {
    ...host,
    ingredientsExist: (host.serviceAccountsBelow500 ?? 0) > 0,
    unattendedMechanismExists: host.setpriv === 'present' && host.sudoNonInteractive === 'permitted',
  })

  // -------------------------------------------------------------------------
  // A1 — the active artifact is not verified before launch.
  // -------------------------------------------------------------------------
  const tampered = freshHome('tamper')
  const beforeDigest = sha256(readFileSync(tampered.patch))
  const beforeCompose = compose(tampered.home)
  write(tampered.patch, `${readFileSync(tampered.patch, 'utf8')}\n# launch-ceremony tampered ${randomBytes(8).toString('hex')}\n`)
  const afterDigest = sha256(readFileSync(tampered.patch))
  const afterCompose = compose(tampered.home)
  const launchPathVerifies = LAUNCH_PATH.filter((relPath) => {
    const full = join(ROOT, relPath)
    return existsSync(full) && VERIFICATION_WORDS.test(readFileSync(full, 'utf8'))
  })
  row('A1', 'the active artifact is not verified before launch', {
    baselineBooted: beforeCompose.exitCode === 0,
    bytesChanged: beforeDigest !== afterDigest,
    tamperedStillBoots: afterCompose.exitCode === 0,
    launchPathModulesThatVerify: launchPathVerifies,
    activeArtifact: relative(ROOT, ACTIVE_ARTIFACT),
    activeArtifactMode: existsSync(ACTIVE_ARTIFACT) ? modeOf(ACTIVE_ARTIFACT) : null,
    guestCanWriteTheArtifactItLoads: existsSync(ACTIVE_ARTIFACT) ? writable(ACTIVE_ARTIFACT) : null,
    verifiedBeforeLaunch: launchPathVerifies.length > 0 && afterCompose.exitCode !== 0,
  }, {
    baselineBooted: true,
    bytesChanged: true,
    // A verified artifact does not boot after its bytes move.
    tamperedStillBoots: false,
    launchPathModulesThatVerify: launchPathVerifies,
    activeArtifact: relative(ROOT, ACTIVE_ARTIFACT),
    activeArtifactMode: existsSync(ACTIVE_ARTIFACT) ? modeOf(ACTIVE_ARTIFACT) : null,
    guestCanWriteTheArtifactItLoads: false,
    verifiedBeforeLaunch: true,
  })

  // -------------------------------------------------------------------------
  // C1 — configuration is not supplied as literals by a parent. The governed
  // config fields are expression nodes; the value the guest runs under is
  // resolved by the guest's own environment, through the REAL vendored
  // evaluator run in a child process.
  // -------------------------------------------------------------------------
  const shipped = yaml.load(readFileSync(join(REAL_PROFILE_DIR, PATCH_FILENAME), 'utf8'), { schema: entryListSchema })
  const governedRow = shipped
    .flatMap((layer) => layer?.insert ?? [])
    .find((entry) => entry?.id === 'aukora-memory')
  const configFields = Object.entries(governedRow?.config ?? {})
  const expressionFields = configFields.filter(([, value]) => value !== null && typeof value === 'object' && '__jsExpr' in value)
  const literalFields = configFields.filter(([, value]) => value === null || typeof value !== 'object')

  const evalProbe = guard(join(TMP, 'evaluate-through-the-real-loader.mjs'))
  write(evalProbe, [
    "const { interpolate } = await import(process.argv[2])",
    "process.stdout.write(JSON.stringify({ value: interpolate({}, { __jsExpr: process.argv[3] }) }))",
    '',
  ].join('\n'))
  /** Resolve one shipped expression under an environment the GUEST chooses. */
  const resolveUnder = (expr, chosenSocket) => {
    const env = { ...process.env }
    delete env.AUKORA_BROKER_SOCKET
    if (chosenSocket !== null) env.AUKORA_BROKER_SOCKET = chosenSocket
    const r = spawnSync(process.execPath, ['--import', 'tsx/esm', evalProbe, LOADER_UTILS, expr], {
      cwd: ROOT, encoding: 'utf8', env, timeout: 120000,
    })
    if (r.status !== 0) throw new Error(`launch-ceremony: the loader evaluator failed: ${(r.stderr ?? '').slice(0, 300)}`)
    return JSON.parse(r.stdout).value
  }
  const guestChosenSocket = join(TMP, 'guest-chosen.sock')
  const brokerExpr = governedRow?.config?.brokerSocket?.__jsExpr ?? null
  const resolvedDefault = brokerExpr === null ? null : resolveUnder(brokerExpr, null)
  const resolvedGuest = brokerExpr === null ? null : resolveUnder(brokerExpr, guestChosenSocket)

  row('C1', 'configuration is not supplied as literals by a parent', {
    expressionFields: expressionFields.map(([name]) => name),
    literalFields: literalFields.map(([name]) => name),
    brokerSocketExpression: brokerExpr,
    resolvesWithNoEnvTo: resolvedDefault,
    resolvesUnderGuestEnvTo: resolvedGuest,
    guestPicksTheBrokerItDials: resolvedGuest === guestChosenSocket,
    everyGovernedConfigFieldIsALiteral: expressionFields.length === 0,
  }, {
    expressionFields: expressionFields.map(([name]) => name),
    literalFields: literalFields.map(([name]) => name),
    brokerSocketExpression: brokerExpr,
    resolvesWithNoEnvTo: resolvedDefault,
    resolvesUnderGuestEnvTo: resolvedGuest,
    // A supervisor hands down a literal path. The guest does not choose it.
    guestPicksTheBrokerItDials: false,
    everyGovernedConfigFieldIsALiteral: true,
  })

  // -------------------------------------------------------------------------
  // S1, L1 — the safety row and the limitation, both stated rather than implied.
  // -------------------------------------------------------------------------
  const sealNow = digestTree(REAL_PROFILE_DIR)
  row('S1', 'every write lived in one temp tree; the real profile is byte-identical', {
    fileCount: Object.keys(sealNow).length,
    identical: JSON.stringify(sealNow) === JSON.stringify(REAL_SEAL),
    everyWriteInsideTemp: true,
    ephemeralKeysOnly: true,
  }, {
    fileCount: Object.keys(REAL_SEAL).length,
    identical: true,
    everyWriteInsideTemp: true,
    ephemeralKeysOnly: true,
  })

  row('L1', 'what this court does not prove, recorded rather than implied', {
    platform: process.platform,
    euid: EUID,
    stagesNoSecondUid: true,
    peerRowIsMechanismOnly: true,
    p1p3RoutesAreReadFromTheProductTree: true,
    g1GradesLiveSubjectPresenceOnly: true,
  }, {
    platform: process.platform,
    euid: EUID,
    stagesNoSecondUid: true,
    peerRowIsMechanismOnly: true,
    p1p3RoutesAreReadFromTheProductTree: true,
    g1GradesLiveSubjectPresenceOnly: true,
  })

  console.log('\n  courts/harness/launch-ceremony — who starts the guest, and with what?\n  ' + '-'.repeat(72))
  for (const r of inOrder()) {
    console.log(`  ${r.n.padEnd(4)}${String(r.label).padEnd(62)} ${r.breach ? '*** BREACH ***' : 'held'}  ${JSON.stringify(r.observed).slice(0, 150)}`)
  }
  console.log(`
  READ P1/P3 EXACTLY: the source-development parent is a tracked production
  caller of spawnBroker. The keyless transcript remains evidence and cannot
  satisfy either production predicate. These rows establish a product launch
  route, not uid separation, immutable activation, or deployment custody.

  READ G1 EXACTLY: source text cannot hold this row. No court-owned product
  ceremony or guest handle exists, so subjectPresent is false and G1 is red.
  When the subject exists, the oracle owner must add handle-bound absolute-path
  process observation and a positive and negative control before this row can
  grade separation.

  READ K2 EXACTLY: the peer token there is mode 0000, so the broker's EACCES is
  real — and this court wrote the bytes and chmods the file back to prove it
  can. That row grades a CODE PATH, exactly as courts/harness/confinement C10
  does. It does not grade that a boundary existed.

  READ D1 EXACTLY: it prevents this court from demanding a Linux-shaped setuid
  ceremony from the macOS launchd design. It grades specification consistency
  only. G1 remains the live-subject row and is red; D1 proves no separation.

  THIS COURT DOES NOT EXIT 77. The uid split is not what is platform-gated here:
  courts/harness/uid-confinement's header says its LINUX-ONLY part is that
  court's MECHANISM (setpriv, sudo -n), and row G2 re-measures the same host
  facts. Missing live product-ceremony evidence is a breach, not a platform
  skip. Only --prove-second-uid, which stages a real one, is platform-gated,
  and that arm exits 77 and says why.`)

  if (MUTATE) {
    // The counterfactuals can make a custody or caller claim read green without
    // the corresponding kernel or classifier fact. The court must detect all.

    // M1 — a mocked guest uid. The claim says two uids; the kernel says one.
    const mockedLaunch = { guestUid: 65534, brokerUid: EUID }
    const kernelBrokerUid = statSync(liveDir).uid
    const kernelSignedEuid = signedConfinement?.euid
    const M1 = mockedLaunch.guestUid !== kernelBrokerUid
      && kernelBrokerUid === EUID
      && kernelSignedEuid === EUID

    // M2 — a function returning writableByGuest:false where only the kernel counts.
    const shim = () => ({ writableByGuest: false })
    const shimmed = shim().writableByGuest
    const kernelSays = writable(join(TMP, 'live'))
    const M2 = shimmed === false && kernelSays === true

    const withoutEvidenceRule = KINDS.filter(([, kind]) => kind !== 'evidence')
    const evidenceKind = kindOf(EVIDENCE_TRANSCRIPT)
    const mutatedEvidenceKind = kindOfWith(EVIDENCE_TRANSCRIPT, withoutEvidenceRule)
    const M3 = evidenceKind === 'evidence' && mutatedEvidenceKind === 'production'

    const expectedBreaches = ['P2', 'U1', 'A1', 'G1', 'K1']
    const ordinaryRowsMatched = mutationRowsMatch(expectedBreaches)
    const detected = M1 && M2 && M3 && ordinaryRowsMatched
    console.log(`\n  MUTATION mocked guest uid                claim=${mockedLaunch.guestUid}, kernel=${kernelBrokerUid}, signed=${kernelSignedEuid}   ${M1 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION writableByGuest:false shim      shim=${shimmed}, kernel=${kernelSays}   ${M2 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION evidence classifier removed     original=${evidenceKind}, mutant=${mutatedEvidenceKind}   ${M3 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION ordinary-row oracle             expectedBreaches=[${expectedBreaches.join(' ')}] matched=${ordinaryRowsMatched}\n`)
    exitCode = detected ? 0 : 1
  } else {
    const anyBreach = rows.some((r) => r.breach)
    console.log('\n  observationClass: SELF-REPORTED\n')
    exitCode = anyBreach || !rowsComplete() ? 1 : 0
  }
} finally {
  // Restore first, verify second, and let a failed restore override any verdict
  // above: a court that dirties the repository has already lost.
  const sealFinal = digestTree(REAL_PROFILE_DIR)
  const identical = JSON.stringify(sealFinal) === JSON.stringify(REAL_SEAL)
  rmSync(TMP, { recursive: true, force: true })
  if (!identical) {
    console.error('\n  *** RESTORE FAILED *** the real profile changed under this court:')
    console.error(`  before ${JSON.stringify(REAL_SEAL)}`)
    console.error(`  after  ${JSON.stringify(sealFinal)}\n`)
    exitCode = 1
  }
  process.exitCode = exitCode
}
