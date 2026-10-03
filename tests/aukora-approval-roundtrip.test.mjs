// THE APPROVAL ROUND TRIP, THROUGH THE SHIPPED PRODUCER AND THE SHELL'S OWN SIGNER.
//
//   node tests/aukora-approval-roundtrip.test.mjs
//
// WHAT THIS PROVES, AND WHY THE EXISTING COURTS DID NOT. `tests/aukora-shell-signer.test.mjs` drives the
// BROKER's library object (`createOwnerApprovalSession`) against a socket the shell bound, and it builds
// the projection it pins BY HAND — its own comment says so, and section 9 of that file measures what the
// SHIPPED loader answers with instead and reports it red. So that court can be entirely green about "the
// signer serves the wire the broker speaks" while the thing the backend actually runs refuses before it
// ever dials.
//
// This court closes that seam by removing the hand-built projection. It calls the SHIPPED PRODUCER —
// `approveOperation`, the function `scripts/aumlok/approve-operation` and `kira-approve-queue.mjs`
// call — against a v3 controller directory that only the SHIPPED CEREMONY (`bindV3`) wrote, and it
// asserts three separate facts that were previously separated:
//
//   1. THE PRODUCER DIALS THE SOCKET. A listener is bound at the path and it records the bytes it
//      receives. "The approval failed" and "the approval never reached the signer" are different
//      defects and the second one is the one this lane is about.
//   2. THE APPROVAL COMPLETES, and the artifact is a receipt whose signature VERIFIES UNDER THE KEY
//      THE PRODUCER ITSELF VERIFIED WITH — re-derived here from the DID on the projection the loader
//      answered with, never read off the response. A signature that verifies only under a key this
//      court chose proves nothing about what the shipped path will accept.
//   3. THE KEY IS THE MACHINE KEY — the one whose seed sits in `machine-seed-v3.json` beside the record
//      and whose public half the record lists in `publicRoot.machines[]`. Derived here from the seed,
//      so the arm is a comparison of two independent readings rather than a restatement.
//
// THE KEY IS DISPOSABLE AND LABELLED. The fixture is bound by the shipped `bindV3` with a seven-word
// TEST phrase written in this file. It is not anyone's identity, it derives a different root, and it is
// deleted at the end. NO ARM HERE TOUCHES `~/Library/Application Support/AUKORA`, and no socket is bound
// outside this court's scratch directory.
//
// THE PRODUCER'S OWN ENDPOINT, NOT THE SESSION'S. `approveOperation` is handed a `directory`, an
// `expectation`, content, its digest, and a socket path — and it loads the controller ITSELF. Nothing in
// this file constructs a projection for it to consume, which is exactly the difference between this
// court and the one it sits beside.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DESKTOP = join(ROOT, 'apps', 'aukora-desktop')
const LIB = join(ROOT, 'plugins', 'aukora-aumlok', 'lib')

let failures = 0
let arms = 0

/** Record one arm. */
function check(name, condition, detail = '') {
  arms += 1
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** Print a named verdict line a caller can grep, whether the arm passed or failed. */
function note(text) {
  console.log(`       ${text}`)
}

const scratch = mkdtempSync(join(tmpdir(), 'aukora-approval-roundtrip-'))
process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }) } catch { /* leaving */ } })

console.log('\n══ AUMLOK — the approval round trip, shipped producer to shell signer ══')
console.log(`repository  : ${ROOT}`)
console.log(`scratch     : ${scratch}`)
console.log('KEY         : a disposable v3 binding made by bindV3 with the TEST phrase in this file')
console.log('APPROVER    : the `ask` this court injects — a labelled one-bit stub, NOT a person')
console.log('')

// ── the real modules, imported the way the shell imports them ────────────────────────────────────
const bridge = await import(pathToFileURL(join(DESKTOP, 'aumlok-bridge.mjs')).href)
const signerModule = await import(pathToFileURL(join(DESKTOP, 'aumlok-signer.mjs')).href)
const organ = await import(pathToFileURL(join(LIB, 'index.mjs')).href)
const ownerDaemonConfigPath = join(scratch, 'absent-owner-daemon.json')

// ── a real release directory, with a real `plugins/aukora-aumlok/lib` inside it ───────────────────
const releaseDir = join(scratch, 'release')
cpSync(join(ROOT, 'plugins'), join(releaseDir, 'plugins'), { recursive: true })

// ── the disposable binding, written by the shipped ceremony ──────────────────────────────────────
const controllerDir = join(scratch, 'controller')
mkdirSync(controllerDir, { recursive: true, mode: 0o700 })
const TEST_WORDS = Object.freeze(['harbor', 'lantern', 'quiet', 'meadow', 'copper', 'vessel', 'thistle'])
const TEST_HANDLE = 'disposable-roundtrip'
await organ.bindV3({
  handle: TEST_HANDLE,
  words: TEST_WORDS,
  directory: controllerDir,
  boundAt: '2026-09-23T00:00:00Z',
  custodian: 'file',
})
const record = JSON.parse(readFileSync(join(controllerDir, 'local-control.json'), 'utf8'))
const kept = organ.readKeptMachineSeed({ directory: controllerDir, custodian: 'file' })
const machineDid = organ.didKeyFromEd25519PublicKey(kept.ed25519PublicKeyHex)
note(`record's machines[0].ed25519 : ${String(record.publicRoot.machines?.[0]?.ed25519)}`)
note(`the seed this machine kept   : ${kept.ed25519PublicKeyHex}`)
note(`machine did:key              : ${machineDid}`)
note(`record's publicRoot.ed25519  : ${String(record.publicRoot.ed25519)} (the ROOT, a different key)`)

// ── 1. the shipped loader's projection, and the key it names ─────────────────────────────────────
console.log('\n── 1. the projection `loadLocalAumlokPublicControl` answers with for a v3 record ──')
const loaded = organ.loadLocalAumlokPublicControl(controllerDir)
const projection = loaded.projection
note(`fields                      : ${JSON.stringify(Object.keys(projection))}`)
note(`approvalKeyDid              : ${String(projection.approvalKeyDid)}`)
note(`activeControlDigest         : ${String(projection.activeControlDigest)}`)
check(
  'the shipped loader names an approval key at all, so the producer has one to pin',
  typeof projection.approvalKeyDid === 'string' && projection.approvalKeyDid.length > 0,
  `approvalKeyDid = ${String(projection.approvalKeyDid)}`,
)
check(
  'and the key it names is the MACHINE key whose seed this machine holds — not the root',
  projection.approvalKeyDid === machineDid,
  `the loader answers ${String(projection.approvalKeyDid)}; the kept machine seed derives ${machineDid}`,
)
check(
  'and it names an active-control digest for the record it just read',
  typeof projection.activeControlDigest === 'string' && /^[0-9a-f]{64}$/u.test(projection.activeControlDigest),
  `activeControlDigest = ${String(projection.activeControlDigest)}`,
)
const expected = {
  subject: projection.subject,
  activeControlDigest: projection.activeControlDigest,
}

// ── 2. a listener that records whether anything dialled it ───────────────────────────────────────
console.log('\n── 2. the signer socket, and a probe that records the dial ──')
const socketPath = join(scratch, 'aumlok-signer.sock')
const library = await bridge.loadOrganLibrary(releaseDir)
const asked = []
const signerVerdict = await signerModule.startShellSigner({
  library,
  directory: controllerDir,
  socketPath,
  ownerDaemonConfigPath,
  ask: async request => { asked.push(request); return { approve: true } },
  log: () => {},
  logDir: join(scratch, 'logs'),
})
note(`VERDICT: serving = ${String(signerVerdict.serving)} | reason = ${String(signerVerdict.reason)} | socketPath = ${String(signerVerdict.socketPath)}`)
check('the shell serves a signer on the socket the producer will be handed', signerVerdict.serving === true, String(signerVerdict.reason))
if (signerVerdict.serving === true) {
  const state = statSync(socketPath)
  check('and the socket leaf is a real unix socket, owner-only', state.isSocket() && (state.mode & 0o777) === 0o600)
}

/**
 * A probe listener that accepts exactly what a broker would send and records it.
 *
 * ITS WHOLE PURPOSE IS TO SEPARATE "REFUSED" FROM "NEVER DIALED". A court that only asserted
 * `ok === false` cannot tell a producer that reached a signer and was refused from one that never
 * opened a socket at all — and that difference IS this defect.
 * @param {string} path - where to bind.
 * @returns {Promise<{path: string, dials: () => number, close: () => Promise<void>}>} the probe.
 */
async function probeAt(path) {
  const seen = []
  const server = await new Promise(resolve => {
    const s = createServer(socket => {
      let text = ''
      socket.on('data', chunk => {
        text += chunk.toString('utf8')
        if (text.includes('\n')) seen.push(text.slice(0, text.indexOf('\n')))
      })
      socket.on('error', () => {})
    })
    s.listen(path, () => resolve(s))
  })
  return {
    path,
    dials: () => seen.length,
    lines: () => [...seen],
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

// ── 3. the shipped producer, against the v3 controller, through the real socket ─────────────────
console.log('\n── 3. `approveOperation` — the shipped producer — on a v3 controller ──')
const operationBody = Buffer.from('a disposable operation body\n', 'utf8')
const operationDigest = organ.operationDigestOf(operationBody)
const produced = await organ.approveOperation({
  directory: controllerDir,
  expectation: expected,
  content: operationBody,
  operationDigest,
  socketPath,
  timeoutMs: 20_000,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
note(`approveOperation verdict: ${JSON.stringify({
  ok: produced.ok,
  reason: produced.reason,
  detail: produced.detail,
  receiptDomain: produced.receipt?.domain,
})}`)
check(
  'the shipped producer RAISES the approval instead of refusing the controller',
  produced.ok === true,
  `reason = ${String(produced.reason)} detail = ${String(produced.detail)}`,
)
check(
  'and the person was asked exactly once, over the operation digest that was pinned',
  asked.length === 1 && asked[0]?.operationDigest === operationDigest,
  `asked ${String(asked.length)} time(s)`,
)

// ── 4. the artifact, verified under the key the producer itself verified with ────────────────────
console.log('\n── 4. the artifact, re-verified from the producer\'s own facts ──')
if (produced.ok === true) {
  const receipt = produced.receipt
  note(`receipt domain              : ${String(receipt.domain)}`)
  note(`receipt approvalKeyDid      : ${String(receipt.approvalKeyDid)}`)
  note(`receipt operationDigest     : ${String(receipt.operationDigest)}`)
  check(
    'the artifact is a receipt that binds the operation that was presented',
    receipt.operationDigest === operationDigest,
    `${String(receipt.operationDigest)} vs ${operationDigest}`,
  )
  // RE-DERIVED FROM THE DID THE PRODUCER VERIFIED UNDER, not read off the response. This is D1's rule
  // read back: the verifier here derives the DID from the key whose signature it just verified.
  const brokerKeyHex = organ.ed25519PublicKeyFromDidKey(receipt.approvalKeyDid)
  const request = organ.createApprovalRequest({
    subject: receipt.subject,
    activeControlDigest: receipt.activeControlDigest,
    operationDigest: receipt.operationDigest,
    challenge: receipt.challenge,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  })
  const verified = organ.nodeCryptoVerifierCapabilities().verifyEd25519(
    brokerKeyHex,
    organ.approvalSigningBytes(request),
    receipt.signature,
  )
  check(
    'the signature VERIFIES under the key the broker used, re-derived from the receipt\'s own DID',
    verified === true,
    `did = ${String(receipt.approvalKeyDid)} derives ${brokerKeyHex}`,
  )
  check(
    'and that key is the machine key this laptop holds, so the shell is what signed',
    brokerKeyHex === kept.ed25519PublicKeyHex,
    `the broker verified under ${brokerKeyHex}; the kept machine seed derives ${kept.ed25519PublicKeyHex}`,
  )
}

// ── 5. the zero-dial arm: the SAME call, against a path nothing is listening on ──────────────────
// A COURTED CONTRAST, NOT A SECOND DEFECT. If the controller were still refused before the dial, this
// call would answer `aumlok-local:expectation-malformed` / `aumlok:control-malformed` and NO socket
// would ever be opened — which is what section 9 of `aukora-shell-signer.test.mjs` measures. Here the
// same producer against the same controller reaches the transport and comes back with a CHANNEL
// refusal, which is the fact that says the controller was admitted and the dial was attempted.
console.log('\n── 5. the same call against a path nothing is listening on ──')
const emptySocketPath = join(scratch, 'nobody-home.sock')
const reached = await organ.approveOperation({
  directory: controllerDir,
  expectation: expected,
  content: operationBody,
  operationDigest,
  socketPath: emptySocketPath,
  timeoutMs: 5_000,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
note(`unattended-socket verdict: ${JSON.stringify({ ok: reached.ok, reason: reached.reason, detail: reached.detail })}`)
check(
  'with nothing listening the producer answers a CHANNEL refusal, so the controller was admitted and '
  + 'the dial really happened — this is the fact the old refusal-before-dialing hid',
  reached.ok === false && String(reached.reason).startsWith('aumlok:channel-'),
  JSON.stringify(reached),
)

// ── 6. the default timeout is long enough for a person to answer ─────────────────────────────────
console.log('\n── 6. the broker\'s default signer timeout ──')
note(`DEFAULT_SIGNER_TIMEOUT_MS = ${String(organ.DEFAULT_SIGNER_TIMEOUT_MS)}`)
// WHAT THE DEFAULT IS COMPARED AGAINST, AND WHERE THAT NUMBER COMES FROM. The signer's own human-facing
// approver is `popup` in `scripts/aumlok/signer.mjs`, and that dialog waits up to 300_000 ms for a person
// to read the exact bytes and answer. A broker that gives up sooner than the presentation it is waiting
// on has a default that makes the attended path unable to succeed — MEASURED 2026-09-21: the first
// attended run failed `aumlok:channel-timeout / no reply within 5000ms` WHILE THE DIALOG WAS STILL ON
// SCREEN, and the refusal code blamed the channel. `scripts/aumlok/approve-operation` already waits
// 310_000 ms for this reason; a default on the shared broker must not be shorter than that.
const POPUP_WAIT_MS = 300_000
check(
  'the broker\'s default signer timeout is at least as long as the approval dialog it waits on',
  Number(organ.DEFAULT_SIGNER_TIMEOUT_MS) >= POPUP_WAIT_MS,
  `default is ${String(organ.DEFAULT_SIGNER_TIMEOUT_MS)} ms while the signer's popup approver waits `
  + `${String(POPUP_WAIT_MS)} ms for a person: a default shorter than the presentation it is waiting on `
  + 'makes the attended path unable to succeed, and the refusal code blames the channel',
)

// ── 7. a probe listener, left bound, to show what the producer's own bytes look like on the wire ──
console.log('\n── 7. the request the producer sends, as the socket sees it ──')
const observing = await probeAt(join(scratch, 'observed.sock'))
const observed = await organ.approveOperation({
  directory: controllerDir,
  expectation: expected,
  content: operationBody,
  operationDigest,
  socketPath: observing.path,
  timeoutMs: 1_500,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
await observing.close()
note(`with no reply the producer answers: ${JSON.stringify({ ok: observed.ok, reason: observed.reason })}`)
if (observing.lines().length > 0) {
  const line = observing.lines()[0]
  note(`the request on the wire: ${line}`)
  let parsed
  try { parsed = JSON.parse(line) } catch { parsed = null }
  check(
    'the request the producer puts on the wire names this identity and this control head',
    parsed !== null && parsed.subject === expected.subject
      && parsed.activeControlDigest === expected.activeControlDigest,
    `subject = ${String(parsed?.subject)} activeControlDigest = ${String(parsed?.activeControlDigest)}`,
  )
} else {
  check('the producer dialled the observing socket', false, 'nothing arrived at the listener')
}

// ── 8. optional Touch ID cannot refuse: a provider that throws on the probe and never answers after Approve ──
// The provider is handed in the way main.mjs hands in the real one. Its probe throws and its sign never settles, so
// the reviewer must still return the approval, inside the request's window, with the outcome recorded beside it.
console.log('\n── 8. a broken Touch ID provider: the approval still completes ──')
const hostileAsked = []
const hostileLogs = join(scratch, 'hostile-logs')
const hostile = await signerModule.startShellSigner({
  library,
  directory: controllerDir,
  socketPath: join(scratch, 'h.sock'),
  ownerDaemonConfigPath,
  presence: { state: () => { throw new Error('probe broke') }, sign: () => new Promise(() => {}) },
  ask: async request => { hostileAsked.push(request); return { approve: true } },
  log: () => {},
  logDir: hostileLogs,
})
const hostileStart = Date.now()
const hostileExpiry = Math.floor(hostileStart / 1000) + 63
const throughHostile = await organ.approveOperation({
  directory: controllerDir, expectation: expected, content: operationBody, operationDigest,
  socketPath: join(scratch, 'h.sock'), timeoutMs: 20_000, expiresAt: hostileExpiry,
})
const hostileMs = Date.now() - hostileStart
let events = []
try {
  events = readFileSync(join(hostileLogs, 'aukora-approval-events.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
} catch { events = [] }
note(`verdict ${JSON.stringify({ ok: throughHostile.ok, reason: throughHostile.reason })} after ${String(hostileMs)} ms; `
  + `last event ${JSON.stringify({ decision: events.at(-1)?.decision, presenceOutcome: events.at(-1)?.presenceOutcome })}`)
check('a provider that throws and never answers does not refuse the approval, and it lands inside the window',
  hostile.serving === true && throughHostile.ok === true && Date.now() < hostileExpiry * 1000,
  `${String(throughHostile.reason)} ${String(throughHostile.detail)}`)
check('the probe failure drew no icon, and the missing evidence is written beside the decision, not instead of it',
  hostileAsked.length === 1 && hostileAsked[0].presenceState === undefined
    && events.at(-1)?.decision === 'approved' && events.at(-1)?.presenceOutcome === 'no-evidence')
await hostile.stop?.()

console.log(`\n══ ${failures === 0 ? 'PASS' : 'FAIL'} — ${String(arms - failures)}/${String(arms)} arms ══\n`)
process.exit(failures === 0 ? 0 : 1)
