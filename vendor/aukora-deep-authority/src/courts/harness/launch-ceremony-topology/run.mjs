/**
 * courts/harness/launch-ceremony-topology — how many principals, and who can
 * reach what?
 *
 * THE SIXTH INDEPENDENT COURT, AND THE SECOND THAT MEASURES AN ABSENCE.
 * courts/harness/launch-ceremony asks whether anything starts the guest from
 * above. This one asks a narrower and harder question: WHO IS RUNNING. The
 * design the launch ceremony is meant to produce has FOUR OS principals —
 * the human/supervisor session, the ISSUER that holds the root private key,
 * the BROKER that mints receipts and keeps the nonce book, and the GUEST that
 * submits hostile bytes — each at its own uid, each started by launchd AS its
 * own account, with per-peer unix sockets whose owner, group and mode are the
 * whole reachability policy. Nothing in this tree has that topology. There is
 * one uid. D2 separately grades the grant's receipt-key binding; it can hold
 * without pretending that the topology exists.
 *
 * WRITTEN BEFORE THE CEREMONY EXISTS, ON PURPOSE, AND BLIND. No provisioning
 * has happened, no account has been created, no launchd job has been installed
 * and no plist has been written. The builder may edit implementations,
 * implementation tests, and docs describing implementations, and may NOT edit
 * the courts, their expected rows, the known-breach enrollment, or the frozen
 * baseline. If a row here looks wrong, the build stops and the oracle owner
 * investigates.
 *
 * THE SPECIFICATION IS THE EXPECTED COLUMN, NEVER A GRADED ROW.
 * BRICK-0-CONTRACT.ts supplies what a finished topology answers; this court
 * measures what the RUNNING SYSTEM answers. No row grades the contract's own
 * prose, because that document is live and under a different owner, and a
 * court that graded it would report an author's edit as a topology change.
 * Measured 2026-08-25 while writing this file: the contract had already been
 * rewritten from two principal uids to four — `IssuerSockets`,
 * `GuestReachesNoIssuerSocket`, and a PHASE 3 reading "The issuer and the
 * broker are running, EACH AT ITS OWN ACCOUNT". The specification moved; the
 * code did not, and that gap is exactly what every row below reports.
 *
 *   N1  one principal  how many distinct OS principals the running system actually
 *                      uses, from the kernel's answer for four live parties — this
 *                      court, a real spawned issuer, a real spawned broker, and a
 *                      real guest-side client — plus the owner uid of every
 *                      artifact each of them holds
 *   K1  root key       the issuer's 0600 root key is READ by a process at the broker
 *                      principal's uid, through a real open(2) that returns bytes.
 *                      A mode is not a denial and this row refuses to read one as one
 *   R1  direct route   the guest reaches the issuer socket DIRECTLY: the shipped
 *                      guest-side bridge dials it by configuration, and a live
 *                      connect(2) from a separate guest process gets the issuer's own
 *                      reply — while the contract says that socket is reachable from
 *                      the broker only
 *   R2  channel policy the reachability policy is not filesystem ACLs on per-peer
 *                      sockets: there is ONE issuer socket, at 0600, in the owner's
 *                      primary group, with no second socket and no dedicated group
 *   D1  digest only    what actually crosses the one hop that exists, recorded off the
 *                      wire from the REAL shipped bridge: the full preimage, no digest
 *                      field at all, re-canonicalised at the far end. The live
 *                      approval path has no broker hop, so "digest forwarded
 *                      opaquely" cannot hold here —
 *                      not weakly, not partially, not at all
 *   D2  receipt key    the signed grant names one receipt-signing key identity.
 *                      A distinct receipt key refuses, but copying the identical
 *                      key with a separate nonce book remains outside this claim
 *   J1  launchd        launchd jobs for the four principals, asked of launchctl
 *                      read-only. Absent is the answer, and absent is a breach
 *   S1  restore        every write lived in one temp tree; the repository subjects this
 *                      court reads are byte-identical to how it found them
 *   L1  limitation     what a single-principal run of this court CANNOT observe,
 *                      recorded rather than implied, in the style of
 *                      courts/harness/uid-confinement L9 and
 *                      courts/harness/composition-closure N1
 *
 * S1 AND L1 HOLD BY CONSTRUCTION AND GRADE NO TOPOLOGY. D2 holds only for
 * distinct receipt-signing keys. It does not identify a broker process and it
 * does not establish global one-use. The other six topology rows breach today.
 *
 * WHY THIS COURT DOES NOT EXIT 77 ON DARWIN. Every question above is answerable
 * at one uid, on this host, today: counting principals, reading a key, dialling
 * a socket, recording a frame and asking launchctl what is loaded all work at
 * uid 501. What is NOT answerable here is whether a real four-uid deployment
 * would DENY any of it — and no row claims that. Row L1 says so in its own
 * graded fields. Exiting 77 would be faking a skip to avoid a red row that is
 * honestly red. Only win32 skips, because uid and mode are POSIX facts.
 *
 * --mutate stages the five counterfeits this subject invites, and the court
 * must refuse all five:
 *   M1 a MODE READ AS A DENIAL — 0600 announced as "the broker cannot read it"
 *      while the court's own open(2) returned bytes at that very mode;
 *   M2 a MOCKED FOUR-PRINCIPAL TABLE — four asserted uids where the kernel
 *      reported one for every live pid;
 *   M3 AN ASSERTED DIGEST HOP — `crossesAsDigestOnly: true` claimed beside a
 *      frame recorded off the wire that carries the whole preimage;
 *   M4 A SUBSTRING SWEEP READ AS A JOB — an explicitly staged claim names
 *      every principal but supplies no account definitions. Real loaded labels
 *      are reported separately; relevant installed names cannot establish the
 *      staged claim's missing account evidence.
 *   M5 A DISTINCT RECEIPT KEY READ AS ACCEPTED — a fabricated verifier result
 *      says a grant bound to key A was accepted under key B while the real verifier
 *      refuses that exact pair by name.
 * These grade THIS COURT'S OWN PREDICATES. They prove it refuses five named
 * counterfeits; they stage no boundary, and no row here claims one.
 *
 * SAFETY: READ-ONLY MEASUREMENT. Every write goes through one guard into one
 * mkdtemp directory under the OS temp dir. The root key this court hands the
 * issuer is generated per run and dies with the temp tree: no ~/.aukora, no
 * keychain, no real root key, no network. NOTHING IS PROVISIONED — no account
 * is created, no dscl runs, no launchd job is installed or loaded, no system
 * setting is touched. launchctl is asked to PRINT, and nothing else. The
 * repository subjects are digested before the first row and re-digested in the
 * `finally`, and a mismatch overrides any verdict above it.
 *
 *   node courts/harness/launch-ceremony-topology/run.mjs
 *   node courts/harness/launch-ceremony-topology/run.mjs --mutate
 */
import { generateKeyPairSync, createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { principalJobCountsMatch, substringJobCounterfeit } from './job-evidence.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(join(HERE, '../../..'))

const MUTATE = process.argv.includes('--mutate')

/** The four principals the finished topology has. The court's whole subject. */
const PRINCIPALS = Object.freeze(['human', 'issuer', 'broker', 'guest'])
/** The daemon that holds the root private key. */
const ISSUER_ENTRY = join(ROOT, 'aukora/issuer/issuer.mjs')
/** The daemon that mints receipts and owns the nonce book. */
const BROKER_MODULE = 'aukora/broker/broker.mjs'
const BROKER_ENTRY = join(ROOT, BROKER_MODULE)
/** The guest-side plugin that dials the issuer. The source plane, so the dial is readable. */
const BRIDGE_SRC = 'packages/governed/memory-put/src/bridge.ts'
const BRIDGE_SOURCE = join(ROOT, BRIDGE_SRC)
/** The same bridge as the composition loads it: bundled into the shipped artifact. */
const BRIDGE_ARTIFACT = join(ROOT, 'packages/governed/memory-put/lib/index.js')
/** The specification the topology is graded against. */
const CONTRACT_REL = 'docs/specs/BRICK-0-CONTRACT.ts'
const CONTRACT = join(ROOT, CONTRACT_REL)
/**
 * The property the specification states about the guest-to-issuer route, as a
 * pattern rather than a sentence. Reported beside row R1 and NEVER graded: the
 * contract is another owner's live document, and the row's verdict comes from
 * a live connect(2), not from whether a phrase survived an edit.
 */
const ISSUER_ROUTE_CLAUSE = /reachable from the broker only|GuestReachesNoIssuerSocket/i
/** Where a launchd job definition for a principal would have to live. Swept on disk. */
const JOB_DEFINITION_DIR_REL = 'ops/launchd'
const JOB_DEFINITION_DIR = join(ROOT, JOB_DEFINITION_DIR_REL)

/**
 * Repository paths this court reads and could conceivably write. Digested
 * before the first row and after the last.
 *
 * BRICK-0-CONTRACT.ts is deliberately NOT sealed. Row R1 reports what it says,
 * but the specification is a live document under a different owner, and sealing
 * a file this court only reads would report another author's edit as this court
 * dirtying the tree. The gate's runner-owned witness observes its declared
 * tracked and selected ignored entries around enrolled runs; it is not a
 * whole-tree seal.
 */
const SEALED = [
  'aukora/issuer',
  'aukora/broker',
  'aukora/host-dsh/src',
  'packages/governed/memory-put/src',
  'ops/launchd',
]

if (process.platform === 'win32') {
  console.log('\n  courts/harness/launch-ceremony-topology — SKIPPED BY DESIGN')
  console.log('  uid, group and mode are POSIX facts; win32 reports none of them.\n')
  process.exit(77)
}
for (const required of [ISSUER_ENTRY, BROKER_ENTRY, BRIDGE_SOURCE, BRIDGE_ARTIFACT, CONTRACT]) {
  if (!existsSync(required)) {
    console.error(`courts/harness/launch-ceremony-topology: cannot grade — missing ${required}`)
    process.exit(1)
  }
}

const EUID = process.geteuid()
const TMP = mkdtempSync(join(tmpdir(), 'aukora-topology-'))

/** Every write in this court goes through here; nothing outside TMP is writable. */
const guard = (path) => {
  const abs = resolve(path)
  const rel = relative(TMP, abs)
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
    throw new Error(`launch-ceremony-topology: refusing to touch ${abs} — outside ${TMP}`)
  }
  return abs
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Recursive digest of a path: relative name -> content hash. A file digests as itself. */
const digestPath = (base) => {
  const out = {}
  const walk = (current) => {
    const st = statSync(current)
    if (!st.isDirectory()) { out[relative(dirname(base), current)] = sha256(readFileSync(current)); return }
    for (const name of readdirSync(current).sort()) walk(join(current, name))
  }
  walk(base)
  return out
}
const digestSubjects = () => Object.assign({}, ...SEALED.map((rel) => digestPath(join(ROOT, rel))))

// The seal. Taken before anything runs and checked in the `finally`.
const REAL_SEAL = digestSubjects()

/**
 * Print order, fixed to the header's listing. Rows are recorded in the order
 * their evidence becomes available — one live issuer serves four of them — so a
 * reader would otherwise meet them in an order the docblock does not use.
 */
const ROW_ORDER = ['N1', 'K1', 'R1', 'R2', 'D1', 'D2', 'J1', 'S1', 'L1']

const rows = []
const row = (n, label, observed, expected) => {
  if (!ROW_ORDER.includes(n)) throw new Error(`launch-ceremony-topology: row ${n} is not in ROW_ORDER`)
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

/** Require the six topology breaches and every ordinary control exactly. */
const mutationRowsMatch = (expectedBreaches) => {
  const expected = new Set(expectedBreaches)
  const names = new Set(rows.map(({ n }) => n))
  return rowsComplete()
    && expected.size === expectedBreaches.length
    && names.size === rows.length
    && expectedBreaches.every((name) => names.has(name))
    && rows.every(({ n, breach }) => breach === expected.has(n))
}

const modeOf = (path) => (statSync(path).mode & 0o7777).toString(8).padStart(4, '0')

/** The KERNEL's answer for a live pid's uid, asked of ps rather than claimed. */
const uidOf = (pid) => {
  const r = spawnSync('ps', ['-o', 'uid=', '-p', String(pid)], { encoding: 'utf8' })
  const parsed = Number.parseInt((r.stdout ?? '').trim(), 10)
  return Number.isInteger(parsed) ? parsed : null
}

/** Line numbers in `text` whose content matches `pattern`. Never hardcoded: line numbers move. */
const linesMatching = (text, pattern) => text
  .split('\n')
  .map((line, index) => (pattern.test(line) ? index + 1 : null))
  .filter((n) => n !== null)

/** One newline-delimited JSON round trip over one fresh connection. */
const askOverSocket = (socketPath, request, timeoutMs = 8000) => new Promise((settle) => {
  const conn = createConnection(socketPath)
  let buffer = ''
  const timer = setTimeout(() => { conn.destroy(); settle({ error: 'timeout' }) }, timeoutMs)
  const done = (answer) => { clearTimeout(timer); conn.destroy(); settle(answer) }
  conn.on('error', (error) => done({ error: String(error?.code ?? error?.message ?? error) }))
  conn.on('connect', () => { conn.write(`${JSON.stringify(request)}\n`) })
  conn.on('data', (chunk) => {
    buffer += chunk
    const cut = buffer.indexOf('\n')
    if (cut === -1) return
    try { done(JSON.parse(buffer.slice(0, cut))) }
    catch { done({ error: 'unparseable' }) }
  })
})

/** Run a short child to completion and collect its stdout. Its stderr never becomes this court's. */
const runChild = (args, { env = process.env } = {}) => {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const {
  GRANT_KEYS, REFUSE, grantPreimage, receiptKeyIdForPublicKey, verifyGrant,
} = await import(join(ROOT, 'aukora/host-dsh/src/grant.mjs'))
const { definitionDigest } = await import(join(ROOT, 'aukora/broker/effect.mjs'))
const { BROKER_REFUSE, spawnBroker } = await import(join(ROOT, BROKER_MODULE))

let exitCode = 1
const children = []
try {
  // -------------------------------------------------------------------------
  // Stand up the parties that DO exist, each as its own real process, and ask
  // the kernel who is running them. Nothing here is provisioned: these are
  // ordinary child processes of this court, which is precisely the finding.
  // -------------------------------------------------------------------------
  const issuerKeyFile = guard(join(TMP, 'issuer-state', 'root.pem'))
  mkdirSync(guard(join(TMP, 'issuer-state')), { recursive: true, mode: 0o700 })
  // Ephemeral, per-run, dead with the temp tree. Never a real root key.
  const ephemeralRoot = generateKeyPairSync('ed25519')
  writeFileSync(issuerKeyFile, ephemeralRoot.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const rootPem = ephemeralRoot.publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const brokerStateDir = guard(join(TMP, 'broker-state'))
  const brokerSocket = guard(join(TMP, 'broker-run', 'broker.sock'))
  mkdirSync(guard(join(TMP, 'broker-run')), { recursive: true, mode: 0o700 })
  const broker = await spawnBroker({
    socketPath: brokerSocket, stateDir: brokerStateDir, rootPublicKeyPem: rootPem,
  })
  children.push(broker)
  const brokerStatusAtLaunch = await askOverSocket(brokerSocket, { id: 'topology-broker-status', op: 'status' })

  const issuerSocket = guard(join(TMP, 'issuer-run', 'issuer.sock'))
  const issuer = spawn(process.execPath, [ISSUER_ENTRY], {
    env: {
      ...process.env,
      AUKORA_ISSUER_SOCKET: issuerSocket,
      AUKORA_ISSUER_KEY_FILE: issuerKeyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: brokerStatusAtLaunch.receiptKeyId,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(issuer)
  let issuerStderr = ''
  issuer.stderr.on('data', (chunk) => { issuerStderr += chunk })
  for (let waited = 0; waited < 100 && !existsSync(issuerSocket); waited++) await delay(50)
  if (!existsSync(issuerSocket)) throw new Error(`the issuer never listened: ${issuerStderr.slice(0, 300)}`)

  // The guest: a separate live process that dials the issuer and holds the
  // connection open long enough for the kernel to be asked who it is. It sends
  // an operation the issuer does not implement, so the reply proves reach
  // without touching the key, minting anything, or raising a human prompt.
  const guestProbe = guard(join(TMP, 'guest-probe.mjs'))
  writeFileSync(guestProbe, [
    "import { createConnection } from 'node:net'",
    'const conn = createConnection(process.argv[2])',
    "let buffer = ''",
    "conn.on('error', (error) => { console.log(JSON.stringify({ reached: false, code: String(error?.code ?? error?.message) })); process.exit(0) })",
    "conn.on('connect', () => conn.write(JSON.stringify({ op: 'topology-probe' }) + '\\n'))",
    "conn.on('data', (chunk) => {",
    '  buffer += chunk',
    "  const cut = buffer.indexOf('\\n')",
    '  if (cut === -1) return',
    '  console.log(JSON.stringify({ reached: true, uid: process.getuid(), reply: JSON.parse(buffer.slice(0, cut)) }))',
    '})',
    // Stay alive so the parent can ask ps who this process is.
    'setTimeout(() => process.exit(0), 20000)',
  ].join('\n'), 'utf8')
  const guest = spawn(process.execPath, [guestProbe, issuerSocket], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(guest)
  let guestStdout = ''
  guest.stdout.on('data', (chunk) => { guestStdout += chunk })
  for (let waited = 0; waited < 100 && guestStdout === ''; waited++) await delay(50)
  const guestAnswer = guestStdout.trim() === '' ? { reached: null } : JSON.parse(guestStdout.trim().split('\n')[0])
  const guestUid = uidOf(guest.pid)

  // -------------------------------------------------------------------------
  // N1 — how many distinct OS principals the running system actually uses.
  // -------------------------------------------------------------------------
  const liveUids = {
    human: EUID,
    issuer: uidOf(issuer.pid),
    broker: uidOf(broker.pid),
    guest: guestUid,
  }
  const artifactOwners = {
    issuerRootKey: statSync(issuerKeyFile).uid,
    issuerSocket: statSync(issuerSocket).uid,
    brokerStateDir: statSync(brokerStateDir).uid,
    brokerSocket: statSync(brokerSocket).uid,
  }
  const distinctPrincipals = new Set([...Object.values(liveUids), ...Object.values(artifactOwners)])
  row('N1', 'how many distinct OS principals the running system actually uses', {
    principals: PRINCIPALS,
    liveUidsFromTheKernel: liveUids,
    artifactOwnerUids: artifactOwners,
    distinctPrincipalCount: distinctPrincipals.size,
    everyPrincipalHasItsOwnUid: distinctPrincipals.size === PRINCIPALS.length,
  }, {
    principals: PRINCIPALS,
    liveUidsFromTheKernel: liveUids,
    artifactOwnerUids: artifactOwners,
    // Four parties, four accounts. One shared uid is one principal wearing four hats.
    distinctPrincipalCount: PRINCIPALS.length,
    everyPrincipalHasItsOwnUid: true,
  })

  // The specification, read once. It is NOT graded here: BRICK-0-CONTRACT.ts is
  // a live document under another owner, and a court that graded its prose
  // would report an author's edit as a topology change. The contract supplies
  // the EXPECTED column below; the running system supplies the observed one.
  const contractText = readFileSync(CONTRACT, 'utf8')

  // -------------------------------------------------------------------------
  // K1 — the root key, opened for real by a process at the broker principal's
  // uid. A MODE IS NOT A DENIAL: 0600 denies nobody when the reader is the
  // owner, and the only way to know is to call open(2) and see what comes back.
  // -------------------------------------------------------------------------
  const brokerPrincipalUid = liveUids.broker
  const openAttempt = runChild(['-e', [
    // getBuiltinModule keeps this snippet free of both `require` and `import`,
    // so it runs identically however Node classifies a `-e` script.
    "const { openSync, readSync, closeSync } = process.getBuiltinModule('node:fs')",
    'const target = process.argv[1]',
    'try {',
    "  const fd = openSync(target, 'r')",
    '  const buffer = Buffer.alloc(64)',
    '  const bytes = readSync(fd, buffer, 0, 64, 0)',
    '  closeSync(fd)',
    "  console.log(JSON.stringify({ opened: true, bytesRead: bytes, readerUid: process.getuid(), looksLikeAPrivateKey: buffer.subarray(0, bytes).toString('utf8').includes('PRIVATE KEY') }))",
    '} catch (error) {',
    '  console.log(JSON.stringify({ opened: false, errno: String(error?.code ?? error), readerUid: process.getuid() }))',
    '}',
  ].join('\n'), issuerKeyFile])
  const opened = JSON.parse(openAttempt.stdout.trim() || '{}')
  row('K1', 'the issuer root key is read by a process at the broker principal uid', {
    rootKeyMode: modeOf(issuerKeyFile),
    rootKeyOwnerUid: statSync(issuerKeyFile).uid,
    brokerPrincipalUid,
    readerUid: opened.readerUid ?? null,
    readerIsTheBrokerPrincipal: opened.readerUid === brokerPrincipalUid,
    open2Succeeded: opened.opened === true,
    bytesRead: opened.bytesRead ?? 0,
    readTheKeyMaterial: opened.looksLikeAPrivateKey === true,
    errno: opened.errno ?? null,
    // The graded claim. A mode this court can read through is not a denial.
    theBrokerPrincipalIsDeniedTheRootKey: opened.opened === false && typeof opened.errno === 'string',
  }, {
    rootKeyMode: modeOf(issuerKeyFile),
    rootKeyOwnerUid: statSync(issuerKeyFile).uid,
    brokerPrincipalUid,
    readerUid: opened.readerUid ?? null,
    readerIsTheBrokerPrincipal: opened.readerUid === brokerPrincipalUid,
    // Under four principals the open fails and returns no bytes.
    open2Succeeded: false,
    bytesRead: 0,
    readTheKeyMaterial: false,
    errno: 'EACCES',
    theBrokerPrincipalIsDeniedTheRootKey: true,
  })

  // -------------------------------------------------------------------------
  // R1 — the guest reaches the issuer directly. Cited from the shipped bridge
  // by line, and measured with a live connect(2) from a separate process.
  // -------------------------------------------------------------------------
  const bridgeText = readFileSync(BRIDGE_SOURCE, 'utf8')
  const dialLines = linesMatching(bridgeText, /createConnection\(/)
  const callLines = linesMatching(bridgeText, /issuerRequest\(\s*config\.issuerSocket/)
  const configLines = linesMatching(bridgeText, /issuerSocket\s*:\s*string/)
  const artifactDials = readFileSync(BRIDGE_ARTIFACT, 'utf8').includes('issuerRequest(config.issuerSocket')
  row('R1', 'the guest reaches the issuer socket directly, by configuration and in fact', {
    bridge: BRIDGE_SRC,
    guestConfigFieldLines: configLines,
    guestDialLines: dialLines,
    guestCallsTheIssuerAtLines: callLines,
    theSameDialIsInTheShippedArtifact: artifactDials,
    theSpecificationForbidsThisRoute: ISSUER_ROUTE_CLAUSE.test(contractText),
    guestProcessUid: guestAnswer.uid ?? guestUid,
    guestReachedTheIssuer: guestAnswer.reached === true,
    theIssuersOwnReply: guestAnswer.reply ?? null,
    intermediariesBetweenGuestAndIssuer: 0,
    // Under the specified route the guest talks to the broker and the broker
    // talks to the issuer, so a direct dial is refused by the kernel.
    theIssuerIsReachableFromTheBrokerOnly: guestAnswer.reached === false,
  }, {
    bridge: BRIDGE_SRC,
    guestConfigFieldLines: configLines,
    guestDialLines: dialLines,
    // A guest-side module that dials the issuer at all is the defect; the
    // finished topology has no such call site.
    guestCallsTheIssuerAtLines: [],
    theSameDialIsInTheShippedArtifact: false,
    theSpecificationForbidsThisRoute: ISSUER_ROUTE_CLAUSE.test(contractText),
    guestProcessUid: guestAnswer.uid ?? guestUid,
    guestReachedTheIssuer: false,
    theIssuersOwnReply: null,
    intermediariesBetweenGuestAndIssuer: 1,
    theIssuerIsReachableFromTheBrokerOnly: true,
  })

  // -------------------------------------------------------------------------
  // R2 — the channel policy. Under four principals the filesystem IS the
  // policy: two per-peer sockets, each 0660, each in a group holding exactly
  // one neighbour. Measure what this host actually has instead.
  // -------------------------------------------------------------------------
  const issuerSocketStat = statSync(issuerSocket)
  const brokerSocketStat = statSync(brokerSocket)
  /** Every socket the issuer actually created, counted rather than assumed. */
  const issuerSockets = readdirSync(dirname(issuerSocket))
    .filter((name) => statSync(join(dirname(issuerSocket), name)).isSocket())
    .sort()
  const ownPrimaryGid = process.getgid()
  // A group the human session is already in grants nothing extra, and the owner
  // never consults the group bits at all: the owner bits are checked first.
  const issuerSocketGroupIsDedicated = issuerSocketStat.gid !== ownPrimaryGid
    && issuerSocketStat.uid !== EUID
  row('R2', 'reachability is not enforced by per-peer socket ownership, group and mode', {
    issuerSocketMode: modeOf(issuerSocket),
    issuerSocketOwnerUid: issuerSocketStat.uid,
    issuerSocketGid: issuerSocketStat.gid,
    thisProcessPrimaryGid: ownPrimaryGid,
    brokerSocketMode: modeOf(brokerSocket),
    brokerSocketOwnerUid: brokerSocketStat.uid,
    brokerSocketGid: brokerSocketStat.gid,
    issuerSocketsCreated: issuerSockets,
    issuerSocketGroupIsDedicated,
    // The dialler is the owner, so no mode on this socket could have stopped it.
    theKernelRefusedTheGuestDial: guestAnswer.reached === false,
    perPeerSocketsEnforceTheRoute: issuerSockets.length === 2 && issuerSocketGroupIsDedicated,
  }, {
    // 0660 with a dedicated group is what makes the route kernel-enforced;
    // 0600 at the owner's own uid declares it and enforces nothing.
    issuerSocketMode: '0660',
    issuerSocketOwnerUid: issuerSocketStat.uid,
    issuerSocketGid: issuerSocketStat.gid,
    thisProcessPrimaryGid: ownPrimaryGid,
    brokerSocketMode: modeOf(brokerSocket),
    brokerSocketOwnerUid: brokerSocketStat.uid,
    brokerSocketGid: brokerSocketStat.gid,
    // One socket for the broker, one for the human's approvals.
    issuerSocketsCreated: ['approvals.sock', 'broker.sock'],
    issuerSocketGroupIsDedicated: true,
    theKernelRefusedTheGuestDial: true,
    perPeerSocketsEnforceTheRoute: true,
  })

  // -------------------------------------------------------------------------
  // D1 — what actually crosses. Recorded OFF THE WIRE from the real shipped
  // bridge: the court stands up a listener, drives `registerIssuerBridge` with
  // a real `allowed-once`, and reads the frame the product wrote. Nothing here
  // re-implements the frame and grades the re-implementation.
  // -------------------------------------------------------------------------
  const recorder = guard(join(TMP, 'record-the-hop.mjs'))
  writeFileSync(recorder, [
    "import { createServer } from 'node:net'",
    'const [, , bridgeModule, socketPath] = process.argv',
    'const { registerIssuerBridge } = await import(bridgeModule)',
    'let recorded = null',
    'const server = createServer((conn) => {',
    "  let buffer = ''",
    "  conn.on('data', (chunk) => {",
    '    buffer += chunk',
    "    const cut = buffer.indexOf('\\n')",
    '    if (cut === -1) return',
    '    recorded = buffer.slice(0, cut)',
    "    conn.write(JSON.stringify({ ok: true, grant: { toolName: 'memory.put', digest: '0'.repeat(64), nonce: 'topology-probe', exp: 4102444800, definitionId: '0'.repeat(64), operationDigest: '0'.repeat(64), receiptKeyId: '0'.repeat(64), signature: Buffer.alloc(64).toString('base64') } }) + '\\n')",
    '  })',
    '})',
    'await new Promise((ready) => server.listen(socketPath, ready))',
    'let listener = null',
    'let ticket = null',
    'const ctx = {',
    "  on: (name, fn) => { if (name === 'approval/request') listener = fn },",
    '}',
    'const authority = {',
    "    getPending: () => ({ args: { key: 'topology-probe', value: { crossing: 'this hop' } }, operation: { exp: 4102444800 } }),",
    "    agentKeyOf: () => 'court-agent-key',",
    '    issueTicket: (t) => { ticket = t },',
    '}',
    'registerIssuerBridge(ctx, { issuerSocket: socketPath }, authority, new AbortController().signal)',
    "const outcome = await listener({ toolName: 'memory.put', callId: 'topology-1', agent: {} }, async () => 'allowed-once')",
    'server.close()',
    'console.log(JSON.stringify({ outcome, frame: JSON.parse(recorded), ticketFields: Object.keys(ticket ?? {}).sort() }))',
    '',
  ].join('\n'), 'utf8')
  const recordSocket = guard(join(TMP, 'record.sock'))
  const recording = runChild(['--import', 'tsx/esm', recorder, BRIDGE_SOURCE, recordSocket])
  if (recording.status !== 0) {
    throw new Error(`the hop recorder failed (exit ${recording.status}): ${recording.stderr.slice(0, 400)}`)
  }
  const hop = JSON.parse(recording.stdout.trim().split('\n').pop())
  const frameKeys = Object.keys(hop.frame).sort()
  const digestFieldsOnTheWire = frameKeys.filter((k) => /digest|sha256/i.test(k))
  const preimageFieldsOnTheWire = frameKeys.filter((k) => /arguments|value|payload/i.test(k))
  // The far end has no digest to compare against, so it must build one itself.
  const issuerText = readFileSync(ISSUER_ENTRY, 'utf8')
  const recanonicaliseLines = linesMatching(issuerText, /buildOperation\(args, expiry\)|operationDigest\(operation\)/)
  // Live protocol evidence, from the real issuer over its real socket: a
  // digest-only frame is refused by name, and a full-preimage frame gets past
  // the very gate that refused it.
  const digestOnlyFrame = await askOverSocket(issuerSocket, {
    op: 'issue', toolName: 'memory.put', digest: sha256('topology'), expiry: Math.floor(Date.now() / 1000) + 300,
  })
  const preimageFrame = await askOverSocket(issuerSocket, {
    op: 'issue', toolName: 'memory.put', arguments: { key: 'topology-probe', value: 1 }, expiry: 1,
  })
  const brokerDigestApproval = await askOverSocket(brokerSocket, {
    op: 'issue', toolName: 'memory.put', digest: sha256('topology'), expiry: Math.floor(Date.now() / 1000) + 300,
  })
  row('D1', 'the live approval path has no broker digest hop', {
    hopsBetweenGuestAndIssuer: 1,
    brokerDigestApprovalRefusedBy: brokerDigestApproval.reason ?? null,
    brokerAcceptedDigestApprovalForForwarding: brokerDigestApproval.ok === true,
    frameFieldsOnTheWire: frameKeys,
    digestFieldsOnTheWire,
    preimageFieldsOnTheWire,
    digestOnlyFrameRefusedBy: digestOnlyFrame.reason ?? null,
    fullPreimageFramePassesTheArgumentsGate: preimageFrame.reason === 'issuer:invalid-expiry',
    farEndRecanonicalisesAtLines: recanonicaliseLines,
    crossesAsDigestOnly: digestFieldsOnTheWire.length > 0 && preimageFieldsOnTheWire.length === 0,
    forwardedOpaquelyWithNoRecanonicalisation: false,
  }, {
    // guest -> broker -> issuer. Two hops, one intermediary.
    hopsBetweenGuestAndIssuer: 2,
    brokerDigestApprovalRefusedBy: null,
    brokerAcceptedDigestApprovalForForwarding: true,
    frameFieldsOnTheWire: frameKeys,
    digestFieldsOnTheWire,
    preimageFieldsOnTheWire: [],
    // A digest-only protocol accepts a digest-only frame.
    digestOnlyFrameRefusedBy: null,
    fullPreimageFramePassesTheArgumentsGate: false,
    farEndRecanonicalisesAtLines: [],
    crossesAsDigestOnly: true,
    forwardedOpaquelyWithNoRecanonicalisation: true,
  })

  // -------------------------------------------------------------------------
  // D2 — the signed grant names one receipt-signing key identity. This is a
  // key binding, not a process identity: two state directories carrying the
  // same copied key and separate nonce books remain indistinguishable here.
  // -------------------------------------------------------------------------
  const receiptKeyId = brokerStatusAtLaunch.receiptKeyId

  // A second real broker with the IDENTICAL copied receipt key and its own
  // state directory. This stages the limit rather than merely describing it.
  const copiedBrokerStateDir = guard(join(TMP, 'copied-broker-state'))
  const copiedBrokerKeyDir = guard(join(copiedBrokerStateDir, 'keys'))
  mkdirSync(copiedBrokerKeyDir, { recursive: true, mode: 0o700 })
  writeFileSync(
    guard(join(copiedBrokerKeyDir, 'broker.json')),
    readFileSync(join(brokerStateDir, 'keys', 'broker.json')),
    { mode: 0o600 },
  )
  const copiedBrokerSocket = guard(join(TMP, 'copied-broker-run', 'broker.sock'))
  mkdirSync(guard(join(TMP, 'copied-broker-run')), { recursive: true, mode: 0o700 })
  const copiedBroker = await spawnBroker({
    socketPath: copiedBrokerSocket,
    stateDir: copiedBrokerStateDir,
    rootPublicKeyPem: rootPem,
  })
  children.push(copiedBroker)
  const copiedBrokerStatus = await askOverSocket(copiedBrokerSocket, { id: 'topology-copied-status', op: 'status' })

  // A third real broker with a freshly generated, distinct receipt key.
  const foreignBrokerStateDir = guard(join(TMP, 'foreign-broker-state'))
  const foreignBrokerSocket = guard(join(TMP, 'foreign-broker-run', 'broker.sock'))
  mkdirSync(guard(join(TMP, 'foreign-broker-run')), { recursive: true, mode: 0o700 })
  const foreignBroker = await spawnBroker({
    socketPath: foreignBrokerSocket,
    stateDir: foreignBrokerStateDir,
    rootPublicKeyPem: rootPem,
  })
  children.push(foreignBroker)
  const foreignBrokerStatus = await askOverSocket(foreignBrokerSocket, { id: 'topology-foreign-status', op: 'status' })
  const foreignReceiptKeyId = foreignBrokerStatus.receiptKeyId

  // Drive the live issuer and answer its fresh challenge on the issuer-owned
  // input channel. The returned grant is the production daemon's artifact.
  const d2Args = { key: 'topology-d2', value: { binding: 'receipt-key' } }
  const d2Expiry = Math.floor(Date.now() / 1000) + 300
  const promptStart = issuerStderr.length
  const issuedPromise = askOverSocket(issuerSocket, {
    op: 'issue', toolName: 'memory.put', arguments: d2Args, expiry: d2Expiry,
  }, 12000)
  let approvalChallenge = null
  for (let waited = 0; waited < 100 && approvalChallenge === null; waited++) {
    const match = issuerStderr.slice(promptStart).match(/approve\? type "yes ([0-9a-f]{16})"/)
    if (match) approvalChallenge = match[1]
    else await delay(50)
  }
  if (approvalChallenge === null) throw new Error(`issuer did not present its D2 approval challenge: ${issuerStderr.slice(promptStart, promptStart + 500)}`)
  issuer.stdin.write(`yes ${approvalChallenge}\n`)
  const issued = await issuedPromise
  if (issued.ok !== true) throw new Error(`issuer refused the D2 grant: ${JSON.stringify(issued)}`)
  const d2Grant = issued.grant
  const d2OperationDigest = issued.operationDigest
  const issuerPrompt = issuerStderr.slice(promptStart)

  const foreignBrokerResult = await askOverSocket(foreignBrokerSocket, {
    id: 'topology-d2-foreign', op: 'memory.put', toolName: 'memory.put', arguments: d2Args, grant: d2Grant,
  })
  const copiedBrokerResult = await askOverSocket(copiedBrokerSocket, {
    id: 'topology-d2-copied', op: 'memory.put', toolName: 'memory.put', arguments: d2Args, grant: d2Grant,
  })
  const namedBrokerResult = await askOverSocket(brokerSocket, {
    id: 'topology-d2-named', op: 'memory.put', toolName: 'memory.put', arguments: d2Args, grant: d2Grant,
  })
  const commonVerification = {
    grant: d2Grant,
    toolName: 'memory.put',
    args: d2Args,
    rootPublicKeyPem: rootPem,
    now: Date.now(),
    expectedOperationDigest: d2OperationDigest,
    expectedDefinitionId: definitionDigest(),
  }
  const namedKeyResult = verifyGrant({
    ...commonVerification, expectedReceiptKeyId: receiptKeyId, seenNonces: new Set(),
  })
  const tamperedKeyResult = verifyGrant({
    ...commonVerification,
    grant: { ...d2Grant, receiptKeyId: foreignReceiptKeyId },
    expectedReceiptKeyId: foreignReceiptKeyId,
    seenNonces: new Set(),
  })
  const namedPreimage = grantPreimage(d2Grant)
  const foreignPreimage = grantPreimage({ ...d2Grant, receiptKeyId: foreignReceiptKeyId })
  const brokerReportedItsPublicKeyId = receiptKeyIdForPublicKey(brokerStatusAtLaunch.brokerPublicKeyPem) === receiptKeyId
  const distinctReceiptKeyRefused = foreignBrokerResult.ok === false
    && foreignBrokerResult.reason === REFUSE.RECEIPT_KEY_MISMATCH
  const signedReceiptKeyCannotBeRewritten = tamperedKeyResult.ok === false
    && tamperedKeyResult.reason === REFUSE.BAD_SIGNATURE
  const copiedKeyWithSeparateBrokersSettledTwice = copiedBrokerResult.state === 'SETTLED'
    && namedBrokerResult.state === 'SETTLED'
  const copiedBrokerIsASeparateProcess = copiedBroker.pid !== broker.pid
  const copiedBrokerHasTheSameReceiptKeyId = copiedBrokerStatus.receiptKeyId === receiptKeyId
  const boundToOneBrokerInstance = !(copiedBrokerIsASeparateProcess
    && copiedBrokerHasTheSameReceiptKeyId && copiedKeyWithSeparateBrokersSettledTwice)
  const globalOneUseHoldsAcrossCopiedKeys = !copiedKeyWithSeparateBrokersSettledTwice
  row('D2', 'the grant is bound to one receipt-signing key identity', {
    grantKeys: [...GRANT_KEYS],
    receiptKeyIdIsSigned: GRANT_KEYS.includes('receiptKeyId'),
    brokerReportedItsPublicKeyId,
    distinctReceiptKeysHaveDistinctIds: receiptKeyId !== foreignReceiptKeyId,
    preimageChangesAcrossDistinctReceiptKeys: !namedPreimage.equals(foreignPreimage),
    issuerPromptNamedReceiptKey: issuerPrompt.includes(`receiptKeyId: ${receiptKeyId}`),
    issuerSignedNamedReceiptKey: d2Grant.receiptKeyId === receiptKeyId,
    namedReceiptKeyAccepted: namedKeyResult.ok === true,
    distinctReceiptKeyRefused,
    distinctReceiptKeyRefusal: foreignBrokerResult.reason ?? null,
    signedReceiptKeyCannotBeRewritten,
    rewrittenReceiptKeyRefusal: tamperedKeyResult.reason ?? null,
    // The explicit limit: this field names key bytes, not a unique process.
    boundToOneBrokerInstance,
    copiedBrokerIsASeparateProcess,
    copiedBrokerHasTheSameReceiptKeyId,
    copiedBrokerSettlement: copiedBrokerResult.state ?? null,
    namedBrokerSettlement: namedBrokerResult.state ?? null,
    copiedKeyWithSeparateBrokersSettledTwice,
    globalOneUseHoldsAcrossCopiedKeys,
  }, {
    grantKeys: [...GRANT_KEYS],
    receiptKeyIdIsSigned: true,
    brokerReportedItsPublicKeyId: true,
    distinctReceiptKeysHaveDistinctIds: true,
    preimageChangesAcrossDistinctReceiptKeys: true,
    issuerPromptNamedReceiptKey: true,
    issuerSignedNamedReceiptKey: true,
    namedReceiptKeyAccepted: true,
    distinctReceiptKeyRefused: true,
    distinctReceiptKeyRefusal: REFUSE.RECEIPT_KEY_MISMATCH,
    signedReceiptKeyCannotBeRewritten: true,
    rewrittenReceiptKeyRefusal: REFUSE.BAD_SIGNATURE,
    boundToOneBrokerInstance: false,
    copiedBrokerIsASeparateProcess: true,
    copiedBrokerHasTheSameReceiptKeyId: true,
    copiedBrokerSettlement: 'SETTLED',
    namedBrokerSettlement: 'SETTLED',
    copiedKeyWithSeparateBrokersSettledTwice: true,
    globalOneUseHoldsAcrossCopiedKeys: false,
  })

  // -------------------------------------------------------------------------
  // J1 — launchd. READ-ONLY: launchctl is asked to PRINT and nothing else. No
  // job is written, installed, loaded, bootstrapped or enabled by this court.
  // -------------------------------------------------------------------------
  const launchctlPrint = (target) => {
    const r = spawnSync('launchctl', ['print', target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    return r.status === 0 ? (r.stdout ?? '') : null
  }
  const loadedText = process.platform === 'darwin'
    ? `${launchctlPrint(`gui/${EUID}`) ?? ''}\n${launchctlPrint('system') ?? ''}`
    : null
  const labelsMentioningAukora = loadedText === null
    ? []
    : [...new Set((loadedText.match(/[A-Za-z0-9_.-]*aukora[A-Za-z0-9_.-]*/gi) ?? []))].sort()
  // A matching label is inventory, not evidence of a job's principal account.
  const labelsNamingAPrincipal = labelsMentioningAukora
    .filter((label) => /issuer|broker|guest|supervisor/i.test(label))
  const trackedJobDefinitions = (() => {
    const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`launch-ceremony-topology: git ls-files failed: ${(r.stderr ?? '').slice(0, 300)}`)
    return r.stdout.split('\0').filter((p) => p !== '' && p.endsWith('.plist')).sort()
  })()
  // ON DISK, not merely tracked. An installed job definition that nobody
  // committed is still an installed job definition, and `git ls-files` cannot
  // see one. This directory is where a job definition for a principal would
  // have to live, so it is swept and every entry found is printed by name.
  const jobDefinitionFilesOnDisk = existsSync(JOB_DEFINITION_DIR)
    ? readdirSync(JOB_DEFINITION_DIR).sort()
    : []
  const jobsDeclaringAnAccount = jobDefinitionFilesOnDisk
    .filter((name) => name.endsWith('.plist'))
    .filter((name) => readFileSync(join(JOB_DEFINITION_DIR, name), 'utf8').includes('UserName'))
  row('J1', 'no launchd job exists for any of the four principals', {
    queriedReadOnly: process.platform === 'darwin' ? [`launchctl print gui/${EUID}`, 'launchctl print system'] : [],
    jobManager: loadedText === null ? 'absent' : 'launchd',
    jobDefinitionDirectory: JOB_DEFINITION_DIR_REL,
    jobDefinitionFilesOnDisk,
    trackedJobDefinitions,
    jobDefinitionsSettingUserName: jobsDeclaringAnAccount,
    loadedLabelsMentioningAukora: labelsMentioningAukora,
    loadedLabelsNamingAPrincipal: labelsNamingAPrincipal,
    principalsWithAJob: labelsNamingAPrincipal.length,
    everyPrincipalIsStartedByLaunchdAsItsOwnAccount: principalJobCountsMatch(PRINCIPALS.length,
      labelsNamingAPrincipal, jobsDeclaringAnAccount),
  }, {
    queriedReadOnly: process.platform === 'darwin' ? [`launchctl print gui/${EUID}`, 'launchctl print system'] : [],
    jobManager: 'launchd',
    jobDefinitionDirectory: JOB_DEFINITION_DIR_REL,
    jobDefinitionFilesOnDisk,
    trackedJobDefinitions,
    // Four plists, each pinning its principal's account with UserName.
    jobDefinitionsSettingUserName: PRINCIPALS.map((p) => `${p}.plist`),
    loadedLabelsMentioningAukora: labelsMentioningAukora,
    loadedLabelsNamingAPrincipal: labelsNamingAPrincipal,
    principalsWithAJob: PRINCIPALS.length,
    everyPrincipalIsStartedByLaunchdAsItsOwnAccount: true,
  })

  // -------------------------------------------------------------------------
  // S1, L1 — the safety row and the limitation, both stated rather than implied.
  // -------------------------------------------------------------------------
  const sealNow = digestSubjects()
  row('S1', 'every write lived in one temp tree; the repository subjects are byte-identical', {
    sealedSubjects: SEALED,
    fileCount: Object.keys(sealNow).length,
    identical: JSON.stringify(sealNow) === JSON.stringify(REAL_SEAL),
    everyWriteInsideTemp: true,
    ephemeralKeysOnly: true,
    nothingProvisioned: true,
  }, {
    sealedSubjects: SEALED,
    fileCount: Object.keys(REAL_SEAL).length,
    identical: true,
    everyWriteInsideTemp: true,
    ephemeralKeysOnly: true,
    nothingProvisioned: true,
  })

  row('L1', 'what a single-principal run of this court cannot observe, recorded rather than implied', {
    platform: process.platform,
    euid: EUID,
    // Every "reachable" and "readable" above is the answer of the ONE principal
    // that exists. This court cannot ask a uid that was never created.
    everyAnswerIsTheAnswerOfOnePrincipal: true,
    // The successes are facts about co-location, not predictions about a split.
    successesAreCoLocationNotAPrediction: true,
    // launchd could host the four jobs. This court measures that it does not,
    // and never that it could not.
    measuresAbsenceOfJobsNotIncapacityOfLaunchd: true,
    // Nothing here was provisioned, and provisioning is the human act.
    createsNoAccountInstallsNoJob: true,
    // The hop recording drives the real bridge through the source plane,
    // because the shipped entry does not export `registerIssuerBridge`.
    hopRecordedThroughTheSourcePlane: BRIDGE_SRC,
  }, {
    platform: process.platform,
    euid: EUID,
    everyAnswerIsTheAnswerOfOnePrincipal: true,
    successesAreCoLocationNotAPrediction: true,
    measuresAbsenceOfJobsNotIncapacityOfLaunchd: true,
    createsNoAccountInstallsNoJob: true,
    hopRecordedThroughTheSourcePlane: BRIDGE_SRC,
  })

  console.log('\n  courts/harness/launch-ceremony-topology — how many principals, and who can reach what?\n  ' + '-'.repeat(72))
  for (const r of inOrder()) {
    console.log(`  ${r.n.padEnd(4)}${String(r.label).padEnd(70)} ${r.breach ? '*** BREACH ***' : 'held'}  ${JSON.stringify(r.observed).slice(0, 150)}`)
  }
  console.log(`
  READ N1 EXACTLY. Four real processes ran: this court, the issuer daemon, the
  broker, and a guest client that dialled the issuer. The kernel was asked who
  each one is, and every artifact was stat'ed for its owner. The answer is uid
  ${EUID}, ${distinctPrincipals.size} distinct principal. That is not four principals with weak
  separation; it is one principal wearing four hats, and every reachability
  answer below follows from it rather than from any policy.

  READ K1 EXACTLY. The root key is mode ${modeOf(issuerKeyFile)} and a process at the broker
  principal's uid opened it and read ${opened.bytesRead ?? 0} bytes of private key material.
  The mode is correct and it denies nobody, because the reader IS the owner.
  This row refuses to accept a mode comparison as evidence of a denial: only an
  open(2) that comes back with an errno is one, and this one came back with
  bytes. Mutation M1 is exactly that counterfeit.

  READ D1 EXACTLY. The specified route is guest -> broker -> issuer, carrying
  the preimage DIGEST forwarded opaquely with no re-canonicalisation. NONE OF
  THAT HOLDS ON THE LIVE PATH: the guest bridge dialled the issuer directly,
  and the issuer's concrete digest approval frame sent to ${BROKER_MODULE} was refused
  ${JSON.stringify(brokerDigestApproval.reason ?? null)} (the broker's named unknown-operation result is
  ${JSON.stringify(BROKER_REFUSE.UNKNOWN_OP)}). The one hop that exists is the guest
  dialling the issuer, and the frame the real shipped bridge put on that wire
  carries ${JSON.stringify(preimageFieldsOnTheWire)} and ${digestFieldsOnTheWire.length} digest fields. The far end must
  therefore build the digest itself, which the live issuer confirms by name:
  a digest-only frame is refused ${JSON.stringify(digestOnlyFrame.reason ?? null)} while the
  full-preimage frame gets past that same gate.

  READ D2 EXACTLY. The grant names the sha256 identity of one receipt-signing
  public key in the bytes the root signs. The live issuer showed and signed
  that identity; the named broker settled the grant, while a real broker with
  a distinct receipt key refused it as ${JSON.stringify(foreignBrokerResult.reason ?? null)}. Rewriting the
  signed field refused as ${JSON.stringify(tamperedKeyResult.reason ?? null)}. This is not a broker-instance
  identity: a second real broker carrying the copied identical key and its own
  nonce book also returned ${JSON.stringify(copiedBrokerResult.state ?? null)} for the exact same grant. D2 closes
  distinct-key admission and deliberately leaves copied-key global replay open.

  READ J1 EXACTLY. launchctl was asked to PRINT and nothing else. This host
  really does run ${labelsMentioningAukora.length} loaded jobs whose labels contain "aukora"
  (${labelsMentioningAukora.join(', ') || 'none'}) and ${labelsNamingAPrincipal.length} of
  them contains a principal name. These names do not establish deployment or
  principal-account binding. J1 also requires the account definitions below;
  loaded names alone cannot satisfy it. This court installs none — provisioning
  is the human act.

  J1 SWEPT ${JOB_DEFINITION_DIR_REL} ON DISK, not merely git's index, because an
  installed job definition nobody committed is still an installed job
  definition. Every entry the sweep found, in full and by name:
${jobDefinitionFilesOnDisk.map((name) => `      ${name}`).join('\n') || '      (the directory is empty)'}
  Of those, ${jobsDeclaringAnAccount.length} set a UserName, which is the key that pins a job to a
  principal's account. Four are needed; ${jobsDeclaringAnAccount.length} exist.

  READ L1 WITH EVERY ROW ABOVE, in the same way courts/harness/uid-confinement
  reads L9 and courts/harness/composition-closure reads N1. Every open and
  every connect above succeeded because there is one principal to ask. That is
  evidence of CO-LOCATION. It is not evidence that a real four-uid deployment
  would deny the same calls, and no row here claims it is. This court must be
  re-run after provisioning, at each principal's own uid, before any row here
  may be read as a boundary.`)

  if (MUTATE) {
    // The five counterfeits this subject invites. Each is a way to make this
    // court read green without the measured property, and it must refuse all five.

    // M1 — a mode read as a denial.
    const modeSaysDenied = (statSync(issuerKeyFile).mode & 0o077) === 0
    const M1 = modeSaysDenied === true && opened.opened === true && (opened.bytesRead ?? 0) > 0

    // M2 — a mocked four-principal table.
    const mockedTopology = { human: 501, issuer: 60001, broker: 60002, guest: 60003 }
    const kernelSaid = Object.values(liveUids)
    const M2 = new Set(Object.values(mockedTopology)).size === PRINCIPALS.length
      && new Set(kernelSaid).size === 1
      && !kernelSaid.includes(mockedTopology.issuer)

    // M3 — an asserted digest hop beside a frame that carries the whole preimage.
    const assertedHop = { crossesAsDigestOnly: true, forwardedOpaquelyWithNoRecanonicalisation: true }
    const M3 = assertedHop.crossesAsDigestOnly === true
      && preimageFieldsOnTheWire.length > 0
      && digestFieldsOnTheWire.length === 0

    // M4 — a substring sweep read as a job.
    const substringCount = labelsMentioningAukora.length
    const substringCounterfeit = substringJobCounterfeit(process.platform, labelsMentioningAukora, PRINCIPALS)
    const M4 = substringCounterfeit.detected

    // M5 — a fabricated acceptance under a distinct receipt-signing key.
    const assertedForeignKeyResult = { ok: true }
    const M5 = assertedForeignKeyResult.ok === true && distinctReceiptKeyRefused

    const expectedBreaches = ['N1', 'K1', 'R1', 'R2', 'D1', 'J1']
    const ordinaryRowsMatched = mutationRowsMatch(expectedBreaches)
    const detected = M1 && M2 && M3 && M4 && M5 && ordinaryRowsMatched
    console.log(`\n  MUTATION mode read as a denial          mode=${modeOf(issuerKeyFile)}, open(2) returned ${opened.bytesRead ?? 0} bytes   ${M1 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION mocked four-principal table    claim=${JSON.stringify(Object.values(mockedTopology))}, kernel=${JSON.stringify(kernelSaid)}   ${M2 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION asserted digest-only hop       claim=true, wire=${JSON.stringify(preimageFieldsOnTheWire)}, digests=${digestFieldsOnTheWire.length}   ${M3 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION substring sweep read as a job  labels=${substringCount}, principals=${labelsNamingAPrincipal.length}, stagedPrincipalLabels=${JSON.stringify(substringCounterfeit.claimedPrincipalLabels)}, stagedAccountDefinitions=0   ${M4 ? 'DETECTED' : 'NOT DETECTED'}`)
    console.log(`  MUTATION distinct receipt key accepted  claim=true, broker=${JSON.stringify(foreignBrokerResult)}   ${M5 ? 'DETECTED' : 'NOT DETECTED'}\n`)
    console.log(`  MUTATION ordinary-row oracle            expectedBreaches=[${expectedBreaches.join(' ')}] matched=${ordinaryRowsMatched}\n`)
    exitCode = detected ? 0 : 1
  } else {
    const anyBreach = rows.some((r) => r.breach)
    console.log('\n  observationClass: SELF-REPORTED\n')
    exitCode = anyBreach || !rowsComplete() ? 1 : 0
  }
} finally {
  for (const child of children) child.kill('SIGTERM')
  await delay(100)
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  // Restore first, verify second, and let a failed restore override any verdict
  // above: a court that dirties the repository has already lost.
  const sealFinal = digestSubjects()
  const identical = JSON.stringify(sealFinal) === JSON.stringify(REAL_SEAL)
  rmSync(TMP, { recursive: true, force: true })
  if (!identical) {
    console.error('\n  *** RESTORE FAILED *** a repository subject changed under this court:')
    console.error(`  before ${JSON.stringify(REAL_SEAL)}`)
    console.error(`  after  ${JSON.stringify(sealFinal)}\n`)
    exitCode = 1
  }
  process.exitCode = exitCode
}
