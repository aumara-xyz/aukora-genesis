#!/usr/bin/env node
/**
 * THE OWNER DAEMON'S PROTOCOL COURT — end to end over REAL sockets, as one uid, today.
 *
 * WHAT IS MEASURED HERE, AND WHAT IS NOT. The kernel refuses an agent-uid connect to `approve.sock` because
 * of the directory, and THAT is measured by `tests/aukora-owner-ingress.test.mjs` and again here at the
 * daemon level. What a SECOND REAL USER is refused needs the `aukora-owner` account, which does not exist on
 * this Mac — **so those arms are WRITTEN, SKIPPED WITH A NAMED CEILING, and they run automatically the day
 * the account appears.** A court that silently skipped them would report a cut it had not tested.
 *
 *   node tests/aukora-owner-protocol.test.mjs
 *   node tests/aukora-owner-protocol.test.mjs --mutate
 */
import assert from 'node:assert/strict'
import { courtScratch, removeCourtScratch } from './helpers/court-scratch.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { guardedMutation } from './helpers/guarded-mutation.mjs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// THE CANONICAL SPELLINGS, IMPORTED RATHER THAN RE-SPELLED. An arm in `aukora-owner-dispatch` scans
// these files for a literal operation or scope, so this import is the only way to name one.
import { OPERATIONS, kiraStoreScope, gateReleaseScope } from '../plugins/aukora-owner-daemon/lib/operations.mjs'
import { crashExit } from './helpers/court-crash.mjs'

const MUTATE = process.argv.includes('--mutate')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DAEMON = join(ROOT, 'plugins', 'aukora-owner-daemon', 'bin', 'owner-daemon.mjs')

let arms = 0
let missed = 0
let skipped = 0
function arm(label, check) {
  arms += 1
  try {
    const result = check()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      throw new TypeError('this arm is async and `arm()` cannot await it: make the check synchronous')
    }
    console.log(`  ok    ${label}`)
  } catch (error) {
    missed += 1
    console.log(`  FAIL  ${label}`)
    console.log(`        ${String(error?.message ?? error).split('\n').slice(0, 7).join('\n        ')}`)
  }
}
const skip = (label, why) => { skipped += 1; console.log(`  SKIP  ${label}\n        NAMED CEILING: ${why}`) }
const say = (line) => { console.log(`       ${line}`) }

console.log('\nAUMLOK — the owner daemon, over its sockets\n')

const binding = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'binding.mjs')).href)
const daemon = await import(pathToFileURL(DAEMON).href)
const R = binding.OWNER_REFUSE

// SCRATCH THE DAEMON'S BOUNDARY ACCEPTS. `os.tmpdir()` IS `/tmp` ON UBUNTU CI, MODE 1777, AND THE
// DAEMON CORRECTLY REFUSES A RUN DIRECTORY REACHED THROUGH A WORLD-WRITABLE ANCESTOR — SO A COURT THAT BUILT
// ITS SCRATCH UNDER `tmpdir()` PASSED ON MACOS (a per-user /var/folders path) AND FAILED IN CI.
// `courtScratch` asks the boundary module's OWN `assertTrustedAncestors`, so the court and the daemon cannot
// reach different conclusions about the same directory. Cleaning up goes through `removeCourtScratch`, which
// also clears the fallback base when the ordinary `tmpdir()` case is available.
const scratch = courtScratch('ao-p-')
chmodSync(scratch, 0o700)
const ownerDir = join(scratch, 'owner-state')
const runDir = join(scratch, 'run')
const approveDir = join(runDir, 'owner')
mkdirSync(ownerDir, { mode: 0o700 })
mkdirSync(approveDir, { recursive: true, mode: 0o700 })
chmodSync(runDir, 0o750)
const config = {
  ownerDir,
  runDir,
  submitSocket: join(runDir, 'submit.sock'),
  approveSocket: join(approveDir, 'settle.sock'),
  keyFile: join(ownerDir, 'owner.key'),
}

/** One request over one socket, exactly as a client would make it. */
function ask(socketPath, request) {
  return new Promise(resolvePromise => {
    let received = ''
    let settled = false
    const socket = connect(socketPath)
    const finish = value => { if (!settled) { settled = true; socket.destroy(); resolvePromise(value) } }
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      const newline = received.indexOf('\n')
      if (newline === -1) return
      try { finish(JSON.parse(received.slice(0, newline))) } catch { finish({ ok: false, reason: 'unparseable' }) }
    })
    socket.on('error', error => finish({ ok: false, reason: `transport:${String(error?.code)}` }))
    setTimeout(() => finish({ ok: false, reason: 'TIMEOUT' }), 4000)
  })
}

// ══ EVERY CHILD THIS COURT STARTS DIES WITH IT, ON EVERY EXIT PATH ═══════════════════════════════
//
// **MEASURED BEFORE THIS CHANGE: THE SUDO'D DAEMON BELOW LEAKED ON EVERY RUN.** It is spawned with
// `detached: true` and then `unref()`d so the court can exit, and **NOTHING EVER KILLED IT** — two of them were
// found alive hours later, every one orphaned to PPID 1 and naming its `aukora-owner-court-<pid>` directory.
// **`unref()` IS ABOUT WHO WAITS, NOT ABOUT WHO CLEANS UP**, and a court that starts a daemon as ANOTHER USER
// is the one place where a leak is guaranteed rather than occasional.
//
// THE PATTERN IS KIRA'S (`968c20065`, `06fc2ce53`): one idempotent `reap()` on EVERY exit path, the signals and
// `uncaughtException` included, and **A VERIFICATION RATHER THAN AN ASSUMPTION** — `ps -eo command` is read
// back and anything still naming a watched path makes the court FAIL. **A reaper nobody checks is a reaper that
// quietly stops working**, which is how this leak survived a green court for hours.
const watched = []
let reaped = false
const reap = () => {
  if (reaped) return
  reaped = true
  // THE IN-PROCESS DAEMON FIRST: `close()` is idempotent and an already-closed daemon is not a failure.
  try { server?.close?.() } catch { /* already closed */ }
  for (const entry of watched) {
    // **AS THE USER THAT OWNS IT.** The daemon runs as `aukora-owner`, and this court runs as the agent, so a
    // plain `process.kill` is EPERM — the same reason the daemon had to be started through `sudo -n -u`.
    try { spawnSync('sudo', ['-n', '-u', 'aukora-owner', 'kill', '-9', String(entry.pid)], { encoding: 'utf8' }) }
    catch { /* already gone, or no sudo on this host */ }
  }
  const ps = spawnSync('ps', ['-eo', 'command'], { encoding: 'utf8' })
  const alive = String(ps.stdout ?? '').split('\n')
  const survivors = alive.filter(line => watched.some(entry => line.includes(entry.path))
    && !line.includes('ps -eo'))
  if (survivors.length > 0) {
    process.stdout.write(`ORPHANS REMAIN after reap: ${String(survivors.length)} process(es) name this `
      + `court's directories\n`)
    // ── AND THE LINES THEMSELVES, BECAUSE A COUNT IS NOT A DIAGNOSIS (AUMLOK-100) ──────────────────────
    //
    // **MEASURED: THIS COURT EXITS 0 ON macOS AND NON-ZERO IN THE A4 LINUX CONTAINER, WITH EVERY ARM PRINTING
    // `ok`.** The reaper is the only thing after the summary that can set the code, and it reported a NUMBER —
    // not which process, not its command line. **So the one fact that would name the cause was the one fact the
    // message withheld**, and the red survived two people looking at it.
    //
    // **A FAILURE THAT CANNOT NAME ITS SUBJECT CANNOT BE FIXED.** With these lines the next container run says
    // what is alive and why it matches, which is the difference between a diagnosis and a mystery.
    for (const line of survivors.slice(0, 6)) {
      process.stdout.write(`  survivor: ${line.slice(0, 200)}\n`)
      // **WHICH WATCHED PATH MATCHED, AND WHERE IN THE LINE.** A substring hit in an unrelated process's
      // arguments reads very differently from a real daemon, and only the offset tells them apart.
      for (const entry of watched) {
        const at = line.indexOf(entry.path)
        if (at !== -1) {
          process.stdout.write(`    matched watched path at offset ${String(at)}: ${String(entry.path)}\n`)
        }
      }
    }
    process.stdout.write(`  watched paths: ${watched.map(entry => entry.path).join(', ')}\n`)
    process.stdout.write('  NOTE: this court is RED for an ORPHAN, not for a failing arm — the arms above are '
      + 'the truth about the daemon, and this is the truth about what was left running.\n')
    process.exitCode = 1
  } else if (watched.length > 0) {
    process.stdout.write('no-orphans: ok — nothing alive names this court\'s sudo-run directories\n')
  }
}
process.on('exit', reap)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { reap(); process.exit(130) })
// **THE RETHROW GOES AND A CRASH GETS ITS OWN CODE (row 16).** It used to rethrow, so node printed the
// stack and exited 1 — the code that means AN ARM FAILED — and CI reported *"exited NON-ZERO (exit 1)
// (green arms)"*, a sentence that contradicts itself. *A verdict expressed by the runtime is a verdict
// nobody agreed on.*
process.on('uncaughtException', crashExit({ reap, court: 'the protocol court' }))

let server = null
const started = await daemon.startOwnerDaemon(config, { log: line => say(line) })
server = started
arm('the daemon starts, generates its OWN key at 0600 inside a 0700 directory', () => {
  const mode = statSync(config.keyFile).mode & 0o777
  assert.equal(mode, 0o600, `the key file is mode ${mode.toString(8)}`)
  assert.match(started.publicKeyHex, /^[0-9a-f]{64}$/u)
  say(`key file 0600, public half ${started.publicKeyHex.slice(0, 16)}…`)
})

// ── THE PROTOCOL, END TO END, OVER REAL SOCKETS ───────────────────────────────────────────────────
// **AN ADMISSION, BECAUSE THIS COURT PROVES SOCKET ROLES AND FRAMING RATHER THAN A MEMORY WRITE.**
//
// MEASURED: this court drove a MEMORY settlement against a daemon with no Kira store, and passed — because the
// daemon answered `{ ok: true, settled: true, kira: null }` and wrote nothing. **A memory write needs a store
// this daemon does not have, and the write is incidental to what every arm below measures**: the bytes are
// frozen, listed back whole and settled by nonce. **An admission freezes bytes too** — the canonical envelope —
// so the round-trip this court is about is unchanged, and nothing is asked of a store.
//
// **AND THE STORE-LESS REFUSAL GETS ITS OWN ARM BELOW**, because that is the behaviour a daemon in this
// configuration must have, and it is now measured rather than assumed.
const ARTIFACT = 'a7'.repeat(32)
const RELEASE = 'release-one'
const ENVELOPE = { version: 1, kind: 'artifact', release: RELEASE, artifacts: [ARTIFACT] }
// **THE OPERATION IS IN THE FROZEN BYTES, AND THE DAEMON PUTS IT THERE.** MEASURED: `canonicalEnvelope` on the
// envelope as SUBMITTED produced a digest that did not match and bytes the owner never saw — because the
// daemon derives `operation` from `kind` before freezing, so the canonical text carries a field the request
// did not. This is that derivation, spelled the same way, which is what makes the two comparable.
const BYTES = binding.canonicalEnvelope({ ...ENVELOPE, operation: OPERATIONS.ADMIT_ARTIFACT })
const submitted = await ask(config.submitSocket, {
  op: 'submit', envelope: ENVELOPE, operation: OPERATIONS.ADMIT_ARTIFACT,
  scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
arm('an agent submits bytes on submit.sock and gets a digest and a DAEMON-MINTED nonce', () => {
  // **A REFUSAL'S `detail` IS WHAT SAYS WHICH CHECK ANSWERED.** Printing only the reason left this court's
  // failure reading `proposal-malformed` — a name four different checks throw — with nothing to tell them
  // apart. MEASURED: adding this is what turned that name into `OPERATIONS is not defined`.
  assert.equal(submitted.ok, true,
    `submit refused: ${String(submitted.reason)} — ${String(submitted.detail ?? '(no detail)')}`)
  assert.equal(submitted.digest, binding.digestOf(Buffer.from(BYTES, 'utf8')))
  assert.match(String(submitted.nonce), /^[0-9a-f]{64}$/u)
})

const listed = await ask(config.approveSocket, { op: 'list' })
arm('THE OWNER SEES THE FROZEN BYTES on approve.sock, not a digest the submitter described', () => {
  assert.equal(listed.ok, true, `list refused: ${String(listed.reason)}`)
  assert.equal(listed.proposals.length, 1)
  // **THE FIELD IS `bytes` NOW, AND IT IS THE WHOLE TEXT RATHER THAN 400 CHARACTERS OF IT.** Codex P1: the
  // owner saw a preview while the grant was built from fields the preview did not contain. The daemon
  // truncates nothing, so this arm can assert EQUALITY with the frozen bytes rather than a prefix match —
  // which is a stronger claim than it could make when the field was a slice.
  assert.equal(listed.proposals[0].bytes, BYTES,
    'the owner is shown something other than the bytes that were frozen, so the person authorises a '
    + 'description rather than the thing itself')
  say(`the owner reads all ${String(listed.proposals[0].bytesLength)} bytes: ${listed.proposals[0].bytes}`)
})

const booleanOnSubmit = await ask(config.submitSocket, { op: 'submit', approval: true, bytes: 'x' })
// ── AND THE STORE-LESS REFUSAL, WHICH THIS DAEMON'S CONFIGURATION MAKES THE SUBJECT ───────────────
//
// **CODEX R4, NEW P1, MEASURED AT THE DOOR RATHER THAN AT THE FUNCTION.** This daemon has no `kiraStoreDir`,
// and before this arm existed a memory settlement against it answered `{ ok: true, settled: true, kira: null }`
// — **the owner was told a record existed and nothing was written, and the approval was consumed.**
//
// THE FREEZE DOOR REFUSES FIRST, so the second half of the claim is asserted the only way it can be: **NOTHING
// WAS FROZEN**, so there is no proposal for an approval to be spent on. A refusal that still left a pending
// proposal behind would be the same false success one step earlier.
const memoryAttempt = await ask(config.submitSocket, {
  op: 'submit', bytes: '{"record":"this must never freeze"}',
  operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'), ledgerId: 'entry-7',
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
const afterMemoryAttempt = await ask(config.approveSocket, { op: 'list' })
arm('A MEMORY SETTLEMENT ON A STORE-LESS DAEMON IS REFUSED BY NAME, and nothing is frozen for it', () => {
  assert.equal(memoryAttempt.ok, false, 'a memory write was accepted by a daemon with nowhere to write')
  assert.equal(memoryAttempt.reason, binding.OWNER_REFUSE.KIRA_STORE_NOT_CONFIGURED,
    `refused as ${String(memoryAttempt.reason)} rather than by the name that says why`)
  // **AND THE LISTING IS UNCHANGED.** The admission above is the only proposal this daemon holds; a frozen
  // memory proposal would make it two and would be an approval waiting to be spent on an act that cannot happen.
  assert.equal(afterMemoryAttempt.proposals.length, listed.proposals.length,
    'the refused memory write left a proposal behind, so an approval could still be spent on it')
  say(`memory write on a store-less daemon -> ${String(memoryAttempt.reason)}, and the listing is unchanged`)
})

// ── AUMLOK-92 ITEM 2: THE RAW DOOR SCANS BEFORE IT FREEZES ───────────────────────────────────────
//
// **MEASURED AT THE DOOR, BECAUSE THIS IS WHERE THE AMBIGUITY WOULD BECOME PERMANENT.** The freeze takes the
// submitted bytes VERBATIM, so an ambiguous document that gets past this point becomes the FROZEN PROPOSAL —
// and the digest, the display and the settle would each read whichever duplicate their own parse happened to
// keep. **JSON keeps the LAST one silently**, so a screen showing the first `record` and a settle reading the
// second are both correct about bytes that mean two things.
const ambiguousBytes = '{"record":"shown to the owner","record":"what actually settles"}'
const ambiguousAttempt = await ask(config.submitSocket, {
  // **AN OPERATION THIS DAEMON ACCEPTS, SO THE SUBMIT ACTUALLY REACHES THE RAW PATH.** MEASURED: my first
  // version used `KIRA_MEMORY_PUT`, which this store-less daemon refuses EARLIER and for a different reason
  // (`kira-store-not-configured`), so the arm was asserting my scanner against a door the bytes never reached.
  op: 'submit', bytes: ambiguousBytes,
  operation: OPERATIONS.ADMIT_ARTIFACT, scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
const afterAmbiguous = await ask(config.approveSocket, { op: 'list' })
arm('BYTES THAT REPEAT A KEY ARE REFUSED AT THE DOOR, and nothing is frozen for them', () => {
  assert.equal(ambiguousAttempt.ok, false,
    'the raw door accepted a document that means two things')
  assert.equal(ambiguousAttempt.reason, binding.OWNER_REFUSE.PROPOSAL_MALFORMED,
    `refused as ${String(ambiguousAttempt.reason)} rather than by the name that says why`)
  // **AND THE LISTING IS UNCHANGED, WHICH IS THE HALF THAT MATTERS.** A refusal that still froze the bytes
  // would leave an approval that can be spent on a document whose meaning depends on who reads it.
  assert.equal(afterAmbiguous.proposals.length, listed.proposals.length,
    'the refused ambiguous submit left a proposal behind, so an approval could still be spent on it')
  say(`ambiguous raw bytes -> ${String(ambiguousAttempt.reason)}, and the listing is unchanged`)
})

// ══ ITEM 5: AN ENVELOPE HAS ONE DOOR, AND ITS OPERATION MUST BE THE ONE ITS KIND IMPLIES ══════════
//
// **CODEX R4.** The RAW path freezes bytes VERBATIM — it does not canonicalise them and it does not derive the
// operation from the kind. **An admission envelope submitted there would be frozen exactly as the submitter
// typed it**, and the owner would read and approve a document that never passed the rules the envelope path
// enforces. Two doors into one freezer, with the weaker one unguarded.
const envelopeAsRawBytes = await ask(config.submitSocket, {
  op: 'submit', bytes: JSON.stringify(ENVELOPE),
  operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'), ledgerId: 'entry-7',
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
arm('AN ADMISSION ENVELOPE SENT AS RAW BYTES IS REFUSED — it has exactly one door', () => {
  assert.equal(envelopeAsRawBytes.ok, false,
    'the raw path froze an admission envelope verbatim, so the owner would approve a document that was never '
    + 'canonicalised and whose operation was never derived from its kind')
  say(`an envelope on the raw door -> ${String(envelopeAsRawBytes.reason)}`)
})

// **AND THE ENVELOPE'S OWN OPERATION IS CHECKED AGAINST ITS KIND.** MEASURED: `assertEnvelope` asked only that
// the field be a NONEMPTY STRING, so an envelope could declare `kind: artifact` and
// `operation: admit-plugin-set` — **two statements about one act, frozen together, with only the kind ever
// checked against anything.** The daemon derives the operation before freezing so its own path cannot produce
// this; an envelope is also built by callers, and a rule enforced only on the path that happens to be careful
// is not a rule.
const mismatchedEnvelope = () => binding.freezeAdmissionEnvelope({
  envelope: { ...ENVELOPE, operation: OPERATIONS.ADMIT_SET },
  scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
arm('AN ENVELOPE WHOSE OPERATION BELONGS TO ANOTHER KIND IS REFUSED', () => {
  assert.throws(mismatchedEnvelope, (error) => {
    assert.equal(error.code, binding.OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
      `refused as ${String(error.code)} rather than by the name that says the two disagree`)
    return true
  }, 'an envelope declaring kind `artifact` was frozen while naming the SET operation')
  // **AND THE MATCHING ONE STILL FREEZES**, so the rule refuses a disagreement rather than the field.
  const agreed = binding.freezeAdmissionEnvelope({
    envelope: { ...ENVELOPE, operation: OPERATIONS.ADMIT_ARTIFACT },
    scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
  })
  assert.match(String(agreed.nonce), /^[0-9a-f]{64}$/u, 'a matching envelope did not freeze')
  say('an envelope naming another kind\'s operation -> refused; a matching one still freezes')
})

// ══ ITEM D: THE OPERATION THE SUBMITTER NAMED MUST BE THE ONE ITS KIND IMPLIES ═════════════════════
//
// **THE DAEMON DERIVED THE INNER OPERATION FROM THE KIND AND OVERWROTE WHATEVER ARRIVED**, and the outer
// `request.operation` was never passed to the agreement check that exists for exactly this. **MEASURED, as the
// shape of the defect: a caller could submit `operation: 'kira.memory.put'` together with an `artifact`
// envelope, and the daemon silently replaced the inner operation and froze it** — so the proposal the owner
// read carried an outer operation naming one act and frozen bytes naming another. **A daemon that picks one of
// two disagreeing statements for the caller is not resolving an ambiguity; it is hiding one.**
const disagreeingOperation = await ask(config.submitSocket, {
  op: 'submit', envelope: ENVELOPE, operation: OPERATIONS.KIRA_MEMORY_PUT,
  scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
arm('A REQUEST WHOSE NAMED OPERATION DISAGREES WITH ITS ENVELOPE IS REFUSED', () => {
  assert.equal(disagreeingOperation.ok, false,
    'the daemon resolved the disagreement for the caller: it froze an `artifact` envelope under a request '
    + 'that named the memory operation, so the owner read a proposal whose two statements named different acts')
  assert.equal(disagreeingOperation.reason, binding.OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
    `refused as ${String(disagreeingOperation.reason)} rather than by the name that says the two disagree`)
  say(`a named operation that disagrees -> ${String(disagreeingOperation.reason)}`)
})

// **AND THE CALLER'S *INNER* OPERATION, WHICH WAS REPLACED BEFORE ANYTHING LOOKED AT IT (R6 ITEM 3).**
// MEASURED: every check downstream sees the DERIVED value, because the daemon overwrites `envelope.operation`
// first — so **a caller could put one operation in the envelope and a different one in the request, and only
// the daemon's own replacement was ever examined.** The outer check added in item D compares the REQUEST's
// operation with the KIND; this one is about the caller's two statements being compared with EACH OTHER.
const disagreeingInner = await ask(config.submitSocket, {
  op: 'submit',
  // THE OUTER OPERATION IS CORRECT FOR THE KIND; the INNER one is not.
  envelope: { ...ENVELOPE, operation: OPERATIONS.ADMIT_SET },
  operation: OPERATIONS.ADMIT_ARTIFACT,
  scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
arm('AN INNER ENVELOPE OPERATION THAT DISAGREES WITH THE OUTER ONE IS REFUSED', () => {
  assert.equal(disagreeingInner.ok, false,
    'the daemon replaced the inner operation before validating it, so the caller\'s envelope and request were '
    + 'never compared and a set operation inside an artifact envelope was frozen under an artifact request')
  assert.equal(disagreeingInner.reason, R.OPERATION_DISAGREES_WITH_ENVELOPE,
    `refused as ${String(disagreeingInner.reason)} rather than by the name that says the two disagree`)
  say(`an inner operation that disagrees -> ${String(disagreeingInner.reason)}`)
})

// **AND A MALFORMED *NON-STRING* INNER OPERATION, WHICH THE GUARD SKIPPED ENTIRELY (CODEX R7 ITEM 3).**
// MEASURED: the guard was `typeof … === 'string'`, so a number, an object or `null` went STRAIGHT PAST the
// original-envelope check and was then OVERWRITTEN by the derived value. **`assertEnvelope` already refuses it
// by name — `binding.mjs:405`, "does not name its operation" — but the guard meant that refusal was never
// reached for exactly the input it exists to catch. A rule that is present and unreachable is the same shape
// as a refusal nobody raises.**
const malformedInner = await ask(config.submitSocket, {
  op: 'submit',
  // THE OUTER OPERATION IS PERFECTLY CORRECT; ONLY THE INNER ONE IS MALFORMED.
  envelope: { ...ENVELOPE, operation: 42 },
  operation: OPERATIONS.ADMIT_ARTIFACT,
  scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
arm('A NON-STRING INNER OPERATION IS REFUSED BY NAME, not silently overwritten', () => {
  assert.equal(malformedInner.ok, false,
    'a non-string inner operation was replaced by the derived value and frozen, so the daemon chose one of two '
    + 'disagreeing statements for the caller instead of refusing')
  assert.equal(malformedInner.reason, R.PROPOSAL_MALFORMED,
    `refused as ${String(malformedInner.reason)} rather than by the name that says the envelope is malformed`)
  say(`a non-string inner operation -> ${String(malformedInner.reason)}`)
})

// **THIS ARM GOES AFTER THE SETTLE, AND MY FIRST VERSION PUT IT BEFORE.** MEASURED: anchored just above
// `booleanOnApprove`, it ran BEFORE `const settled = await ask(… 'approve' …)`, so at listing time NOTHING
// HAD SETTLED — `result <nonce>` answered `proposal-absent`, and the arm read `settledAt: null` and looked
// like the defect it was written to catch. **An arm that runs before the act it measures reports a
// failure of the thing it is standing in for.** The `count: 1` in that same reading was my cache fix
// already working, which is how I knew which half was real.
const booleanOnApprove = await ask(config.approveSocket, { op: 'approve', approval: true, nonce: submitted.nonce })
arm('A SHELL BOOLEAN IS REFUSED BY NAME ON EVERY SOCKET, submit and approve alike', () => {
  assert.equal(booleanOnSubmit.reason, R.SHELL_BOOLEAN_REFUSED, `submit said ${String(booleanOnSubmit.reason)}`)
  assert.equal(booleanOnApprove.reason, R.SHELL_BOOLEAN_REFUSED, `approve said ${String(booleanOnApprove.reason)}`)
})

const settled = await ask(config.approveSocket, { op: 'approve', nonce: submitted.nonce })

// ── AN UNREACHABLE CONSOLE IS **NOT READY**, AND IT IS NOT AN OWNER DECLINING (AUMLOK, 2026-09-26) ──────
//
// **FABLE:** *"in CI the owner console is unreachable, so every approval reads DECLINED (1 SETTLED, 9
// DECLINED). An unreachable console is NOT the owner declining: the court must name it (NOT_READY,
// console-unreachable) and not report a decline, and the CI job must either provide the console the way your
// Docker court does, or classify that step as needing it. Refuse rather than accuse."*
//
// **THE COURT WAS FAILING FOR A REASON THAT WAS TRUE AND MISREPORTED.** In the container the console is not
// reachable; every approval is correctly refused; and the arm below — which requires a SETTLEMENT — failed. **That
// is a red saying "the environment is missing something", reported as a red saying "the court's subject is
// broken".** They need different answers: one needs a console, the other needs a fix.
//
// **SO THE COURT NOW STOPS AND SAYS WHICH.** `NOT_READY` with exit 2 is this project's own word for *this did not
// run* — distinct from exit 0 (green) and exit 1 (an arm failed) — and it is the honest verdict when the thing
// under test cannot be exercised.
if (settled.ok === false && settled.reason === R.CONSOLE_UNREACHABLE) {
  console.log('')
  console.log('NOT_READY: console-unreachable — the owner console was not reachable, so NO approval could be')
  console.log('  judged. This is NOT an owner declining: nobody was asked. The approvals above are refused,')
  console.log('  not rejected, and the arm that requires a settlement CANNOT BE JUDGED HERE.')
  console.log('CEILING: the owner console must exist for this court to run. In CI, provide it the way')
  console.log('  courts/docker/owner-daemon-real-uid.mjs does — a real second uid with a reachable approve')
  console.log('  socket — or classify this step as needing one.')
  console.log('  2 means NOT RUN — not passed, not failed.')
  process.exit(2)
}

arm('the owner approves by nonce and it SETTLES', () => {
  assert.equal(settled.ok, true, `approve refused: ${String(settled.reason)}`)
  assert.equal(settled.settled, true)
  assert.equal(settled.digest, submitted.digest)
})

const replay = await ask(config.approveSocket, { op: 'approve', nonce: submitted.nonce })
arm('AND THE SECOND APPROVAL OF THE SAME PROPOSAL IS REFUSED, BY NAME', () => {
  assert.equal(replay.ok, false, 'a second approval settled the same proposal again')
  assert.ok([R.APPROVAL_SPENT, R.PROPOSAL_SETTLED].includes(replay.reason), `refused as ${String(replay.reason)}`)
  say(`replay -> ${String(replay.reason)}`)
})

// ══ ITEM E: THE OWNER RECOVERS A SETTLED RESULT, WITHOUT CHANGING WHAT A REPLAY MEANS ════════════
//
// **A GRANT SIGNED AND LOST BEFORE DELIVERY WAS UNRECOVERABLE, AND THE REPLAY REFUSAL MUST NOT CHANGE.** The
// two needs pull in opposite directions: a replay of a spent approval has to keep answering `APPROVAL_SPENT` —
// **that refusal is what stops one approval writing two memories** — and yet the owner who never received the
// grant needs to be handed it. `result <nonce>` is the separation: **it reads, it never settles, and it answers
// only on the approve socket.**
//
// **OWNER-ONLY BY THE SOCKET, NOT BY A FLAG.** It is answered on `approve.sock`, which is `0600` inside the
// owner's `0700` directory and is not the socket an agent submits on. **There is no "am I the owner" test
// because the channel already is one** — a check passable by a parameter is a check an agent could pass.
const recovered = await ask(config.approveSocket, { op: 'result', nonce: submitted.nonce })
arm('A SETTLED RESULT IS RECOVERABLE BY THE OWNER — the grant that was lost before delivery comes back', () => {
  assert.equal(recovered.ok, true, `the result op refused a settled nonce: ${String(recovered.reason)}`)
  assert.equal(recovered.digest, submitted.digest, 'the recovered result names a different proposal')
  // **THE GRANT IS THE THING THIS EXISTS FOR.** A settlement that reported success and stored nothing would
  // pass every other check here and leave the owner exactly as stuck as before.
  assert.notEqual(recovered.grant, null,
    'the settled result carries no grant, so a grant lost before delivery is still unrecoverable and this op '
    + 'is only a receipt reader')
  say(`a settled nonce returns its grant (authority ${String(recovered.authority)})`)
})

arm('AND IT DOES NOT SETTLE ANYTHING — the replay refusal still stands, unchanged', () => {
  // **THE POINT OF SEPARATING THEM.** If reading a result could spend or re-perform anything, the recovery
  // would be a second settlement wearing a read-only name.
  assert.equal(recovered.settled, undefined, 'the result op reported a settlement')
  assert.equal(replay.ok, false, 'reading a result made the replay succeed')
  assert.ok([R.APPROVAL_SPENT, R.PROPOSAL_SETTLED].includes(replay.reason),
    `the replay no longer refuses: ${String(replay.reason)}`)
  say('the replay still refuses, so recovery did not weaken idempotence')
})

// **THE SOCKET CALL IS MADE OUTSIDE THE ARM, BECAUSE `arm()` IS SYNCHRONOUS AND REFUSES A PROMISE** — it
// throws "this arm is async and `arm()` cannot await it", which is how a check that would have silently
// measured nothing becomes a named failure instead.
const unsettledResult = await ask(config.approveSocket, { op: 'result', nonce: 'e7'.repeat(32) })
// **AND A NONCE THE JOURNAL KNOWS BUT HAS NOT FINISHED (CODEX R6 ITEM 2).** MEASURED: the branch that answers
// this returned `OWNER_REFUSE.RESULT_NOT_SETTLED`, **and that constant was defined in `STORE_REFUSE` instead —
// so the reason was `undefined`.** The arm above could not see it, because it asks about an UNRECORDED nonce
// and lands on `PROPOSAL_ABSENT`. **A refusal with no name is the signature of somebody else's failure: the
// caller cannot tell it from a bug in the thing refusing.**
//
// The record is planted directly, because a daemon that reaches this state by crashing is the kill court's
// subject and this is the READER's: the journal is file-backed and read per request, so a record written here
// is the same record a restart would find.
const unfinishedNonce = 'c3'.repeat(32)
{
  const journalDir = join(config.ownerDir, 'journal')
  mkdirSync(journalDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(journalDir, `${encodeURIComponent(unfinishedNonce)}.json`),
    `${JSON.stringify({ nonce: unfinishedNonce, state: 'pending', at: 1_800_000_000 })}\n`, { mode: 0o600 })
}
const unfinishedResult = await ask(config.approveSocket, { op: 'result', nonce: unfinishedNonce })
arm('A JOURNALED-BUT-UNFINISHED NONCE IS REFUSED BY NAME, not with an undefined reason', () => {
  assert.equal(unfinishedResult.ok, false, 'the result op handed back an unfinished settlement as an outcome')
  // **THE NAMED REASON IS THE WHOLE ARM.** `undefined` passes every `ok === false` check ever written, which
  // is exactly how this survived a green court.
  assert.equal(unfinishedResult.reason, R.RESULT_NOT_SETTLED,
    `refused with reason ${String(unfinishedResult.reason)} — a name from the wrong refusal object reads as `
    + 'undefined, which a caller cannot distinguish from a defect in the daemon')
  say(`a journaled-but-unfinished nonce -> ${String(unfinishedResult.reason)}`)
})

arm('AND AN UNSETTLED NONCE HAS NO RESULT TO HAND BACK, refused by the name that says so', () => {
  assert.equal(unsettledResult.ok, false, 'the result op answered for a nonce nothing is recorded for')
  assert.equal(unsettledResult.reason, R.PROPOSAL_ABSENT, `refused as ${String(unsettledResult.reason)}`)
  say(`an unrecorded nonce -> ${String(unsettledResult.reason)}`)
})

// ── THE DIRECTORIES THE DAEMON REFUSES TO START IN ────────────────────────────────────────────────
arm('a daemon whose OWNER DIRECTORY is group- or world-accessible REFUSES TO START, by name', () => {
  const loose = join(scratch, 'loose')
  mkdirSync(loose, { mode: 0o700 })
  chmodSync(loose, 0o755)
  let code = null
  try {
    daemon.assertPrivateDirectory(loose, 'the loose directory')
  } catch (error) { code = error?.code ?? error?.name }
  assert.equal(code, R.OWNER_DIR_INSECURE,
    `a world-readable key directory was accepted (${String(code)}), so the mode check is not a boundary`)
  say(`mode 0755 -> ${R.OWNER_DIR_INSECURE}`)
})

arm('and an ANCESTOR WRITABLE BY OTHERS is refused, because it can rename the directory', () => {
  const outer = join(scratch, 'outer')
  const inner = join(outer, 'inner')
  mkdirSync(inner, { recursive: true, mode: 0o700 })
  chmodSync(inner, 0o700)
  chmodSync(outer, 0o777)
  let code = null
  try { daemon.assertPrivateDirectory(inner, 'the inner directory') } catch (error) { code = error?.code ?? error?.name }
  chmodSync(outer, 0o700)
  // **THE NAME IS NOW THE SPECIFIC ONE, AND THAT IS THE IMPROVEMENT RATHER THAN A CHANGED EXPECTATION.** The
  // daemon's own check answered `owner-dir-insecure` for everything; the boundary module says WHICH fact about
  // which directory, so an operator reading the refusal knows the ancestor is the problem and which one it is.
  // The assertion follows the more precise truth.
  assert.equal(code, 'aukora-owner:ancestor-writable',
    'a directory under a world-writable ancestor was accepted, so its own 0700 can be renamed away')
  say('world-writable ancestor -> aukora-owner:ancestor-writable (was the generic owner-dir-insecure)')
})

// ══ ITEM 1: A HARD CAP ACROSS EVERYTHING RETAINED, AND RECLAIM BEFORE INSERTING ═══════════════════
//
// **CODEX R4'S SINGLE MOST IMPORTANT CHANGE, AND IT IS MEASURED THROUGH THE REAL DOOR.** The pending bounds
// covered only PENDING entries, so terminal ones kept their bytes for the whole retention hour with nothing
// counting them: **an agent that submitted, let each proposal finish, and submitted again grew the daemon's
// heap for an hour at whatever rate the socket allowed** — and the daemon it kills is the one holding the
// owner's doors. **A RETENTION CLOCK IS NOT A BOUND, IT IS A DELAY.**
//
// THE ROUNDS BELOW ARE THE ATTACK: fill the pending queue, have every one of them DECLINED (so they become
// terminal and are RETAINED rather than pending), and do it again — with no expiry anywhere, which is the case
// the retention clock never rescues.

let retainedSeen = 0
let rounds = 0
{
  const cap = binding.STORE_LIMITS.MAX_RETAINED
  const perRound = binding.STORE_LIMITS.MAX_PENDING
  // ENOUGH ROUNDS TO PASS THE CAP SEVERAL TIMES OVER, so a store that merely happened to be under it cannot
  // pass by luck. The loop stops early once the listing is at the cap and a round adds nothing.
  for (let round = 0; round < 6 && retainedSeen < cap; round += 1) {
    const batch = []
    for (let index = 0; index < perRound; index += 1) {
      // **AN ADMISSION, FOR THE REASON THE MAIN SUBMIT GIVES**: a memory write has nowhere to go on this
      // daemon, so filler that needed a store would count rounds of REFUSALS and the cap would look enforced.
      const release = `filler-${String(round)}-${String(index)}`
      batch.push(ask(config.submitSocket, {
        op: 'submit', operation: OPERATIONS.ADMIT_ARTIFACT, scope: gateReleaseScope(release),
        ledgerId: release, expiresAt: Math.floor(Date.now() / 1000) + 3_600,
        envelope: { version: 1, kind: 'artifact', release, artifacts: [ARTIFACT] },
      }))
    }
    const submittedBatch = await Promise.all(batch)
    for (const result of submittedBatch) {
      if (result.ok === true) await ask(config.approveSocket, { op: 'decline', nonce: result.nonce })
    }
    const after = await ask(config.approveSocket, { op: 'list' })
    retainedSeen = Array.isArray(after.proposals) ? after.proposals.length : 0
    rounds += 1
  }
}

await arm('THE LISTING IS CAPPED ACROSS EVERY RETAINED PROPOSAL, terminal entries included', () => {
  const cap = binding.STORE_LIMITS.MAX_RETAINED
  // **THE NUMBER IS READ BACK FROM THE DAEMON, NOT COMPUTED FROM WHAT THE COURT SENT.** If the cap is doing
  // nothing, this is rounds x perRound — hundreds — and the daemon is holding every byte of all of them.
  assert.ok(retainedSeen <= cap,
    `the daemon retains ${String(retainedSeen)} proposals against a cap of ${String(cap)}, so its heap grows `
    + 'with how long it has been running rather than with what the owner can act on')
  // AND IT IS NOT EMPTY EITHER: a store that dropped everything would satisfy the cap while destroying the
  // owner's ability to see what was declined, which is the opposite defect and the easier one to ship.
  assert.ok(retainedSeen > 0, 'the listing is empty, so the cap was met by discarding everything')
  say(`${String(rounds)} rounds of submit-and-decline -> ${String(retainedSeen)} retained (cap ${String(cap)})`)
})

// ── THE BOUNDARY, AT THE DAEMON'S OWN SOCKET, AND THE RED ARM ─────────────────────────────────────
chmodSync(approveDir, 0o000)
const throughClosed = await ask(config.approveSocket, { op: 'list' })
chmodSync(approveDir, 0o700)
const throughOpen = await ask(config.approveSocket, { op: 'list' })
arm('A CONNECT TO approve.sock THROUGH A 0000 DIRECTORY IS REFUSED BY THE KERNEL', () => {
  assert.equal(throughClosed.ok, false,
    'the daemon served a request through a directory with no permission bits, so the owner socket is not '
    + 'behind a kernel boundary')
  assert.equal(throughClosed.reason, 'transport:EACCES', `refused as ${String(throughClosed.reason)}`)
})
arm('and with the directory restored, the SAME request is served — so it was the DIRECTORY', () => {
  assert.equal(throughOpen.ok, true,
    `the request was still refused (${String(throughOpen.reason)}) after the directory was restored, so the `
    + 'EACCES above was not the directory')
  say('0700 -> served; 0000 -> EACCES: the owner socket is behind the directory, not behind a claimed field')
})

// ── THE TWO-UID ARMS: WRITTEN, AND SKIPPED WITH A NAME UNTIL THE ACCOUNT EXISTS ───────────────────
// ── **A CRASH AFTER THE ARMS MUST NAME ITSELF, NOT VANISH INTO THE EXIT CODE (AUMLOK-115, PUSH RED)** ───────
//
// MEASURED, AND IT IS THE rc=1-AFTER-A-GREEN-SUMMARY FABLE'S REHEARSAL REPORTED. Two of these courts printed
// every arm `ok` and then died of an UNCAUGHT throw — `protocol` on an `ENOENT` writing the owner config as the
// agent, `ingress` on an unhandled socket `error` — and node exited 1 with NO traceback anyone was reading:
//
//     ... 14/14 arms green
//     STEP 3 FAILED (rc=1)
//
// **THE EXIT CODE WAS TELLING THE TRUTH ABOUT A CRASH AND THE OUTPUT SAID EVERYTHING WAS FINE.** The two are
// reconciled here rather than left for the next reader: a throw that arrives AFTER the arms is a court that
// **DID NOT RUN to completion**, which is this project's exit 2 — *not* exit 1, which means "an arm failed".
// Collapsing them is what made a green summary and a red step look like a contradiction instead of a diagnosis.
process.on('uncaughtException', cause => {
  console.log('')
  console.log('CRASHED AFTER THE ARMS: this court did not run to completion.')
  console.log(`  ${String(cause && cause.stack ? cause.stack.split('\n').slice(0, 4).join('\n  ') : cause)}`)
  console.log('CEILING: a throw outside the arms leaves the totals UNREACHED, so the arms above are not a')
  console.log('  verdict on this court. 2 means NOT RUN — not passed, and not an arm that failed.')
  process.exit(2)
})

const ownerExists = spawnSync('id', ['-u', 'aukora-owner'], { encoding: 'utf8' }).status === 0

/**
 * COURTS ①–③, AND THEY ARE THREE SEPARATE COURTS WHETHER OR NOT THEY CAN RUN.
 *
 * **THE TOTALS COUNT EVERY COURT.** A skipped arm used to vanish from the denominator, so a run could report
 * "10/10 arms green" while three courts had never executed. Every court below is either an arm or a COUNTED
 * skip, and the summary adds them up.
 */
const SKIPPED = []
const skipCourt = (label, why) => { SKIPPED.push(label); skip(label, why) }

if (!ownerExists) {
  skipCourt('court ① secrets: an agent-uid read of the owner key fails EACCES',
    'the `aukora-owner` account does not exist on this Mac, so there is no second uid to be refused. '
    + 'Peter creates it himself (sysadminctl/dscl, needs sudo) and THIS ARM RUNS AUTOMATICALLY once it does')
  skipCourt('court ② journal/witness EACCES as the owner user',
    'same reason: no second uid exists yet. The arm is written and waits for the account')
  skipCourt('court ③ ingress from a uid that is neither owner nor group member',
    'same reason. The KERNEL-side behaviour IS measured (above, and in aukora-owner-ingress.test.mjs); what '
    + 'waits is only the ACCOUNT arrangement')
} else if (spawnSync('sudo', ['-n', '-u', 'aukora-owner', 'true'], { encoding: 'utf8' }).status !== 0) {
  // **THE TERNARY WAS INVERTED, AND ALPHA MEASURED IT: the old branch SKIPPED EXACTLY WHEN SUDO WORKED.**
  // The skip belongs here — the account exists and this process cannot reach it non-interactively — and it
  // must not fire when sudo succeeds.
  for (const court of ['court ① secrets: an agent-uid read of the owner key fails EACCES',
    'court ② journal/witness EACCES as the owner user',
    'court ③ ingress as a uid that is neither owner nor group member']) {
    skipCourt(court, 'the account exists and `sudo -n -u aukora-owner` does not work from this process, so '
      + 'the owner uid cannot be entered non-interactively. Peter runs the privileged arms; the CI job runs '
      + 'them on a Linux runner where it owns the account')
  }
} else {
  // ── THE PRIVILEGED ARMS, WITH A DAEMON THAT REALLY RUNS AS THE OWNER ────────────────────────────
  //
  // **A UID SHIM PROVES THIS BRANCH AND CANNOT PROVE THIS BOUNDARY — THE THREE ARMS BELOW *MUST* FAIL
  // UNDER ONE, AND THAT IS NOT A DEFECT IN THEM.** MEASURED with `id`/`sudo` shimmed (the way Alpha first
  // exercised this branch): the daemon starts, the key is written, the log is readable, all three courts
  // RUN and the totals count them — and all three then FAIL, because a shim that cannot `setuid` runs
  // "as aukora-owner" as the agent, so the key is agent-owned, `cat` succeeds, the append succeeds and
  // `approve.sock` is reachable. **The branch is the structure; the boundary is the uid.** These arms go
  // green only where a real second uid exists — Alpha's `owner-cut-linux` job — and a shim run reporting
  // them red is the measurement working, not the court misbehaving.
  //
  // **THE KEY MUST BE OWNER-OWNED OR COURT ① PROVES NOTHING.** MEASURED: the earlier version read the key
  // THIS COURT had created as the agent, so `cat` succeeded and the arm could only pass if the daemon it
  // read from had started as `aukora-owner`. The layout below is created BY THE OWNER through `sudo -n -u`,
  // so the key is owner-owned, and the agent's read is the thing being measured.
  const asOwner = args => spawnSync('sudo', ['-n', '-u', 'aukora-owner', ...args], { encoding: 'utf8' })
  // **NOT UNDER `/tmp`, AND THE DAEMON IS THE REASON: `/tmp` has a WORLD-WRITABLE ANCESTOR, so the daemon
  // REFUSES TO START there** (`owner-dir-insecure`, MEASURED — the first shim run reported the key file
  // missing because the daemon had correctly refused the layout, not because the arm was wrong). The layout
  // goes under the owner's own home, whose ancestors are the ones the design expects.
  const ownerHome = String(asOwner(['sh', '-c', 'echo $HOME']).stdout ?? '').trim()
  const priv = join(ownerHome.length > 0 ? ownerHome : '/var/empty', `aukora-owner-court-${String(process.pid)}`)
  const ownerUid = Number(String(asOwner(['id', '-u']).stdout ?? '').trim())
  const privConfig = {
    ownerDir: join(priv, 'owner-state'), runDir: join(priv, 'run'),
    submitSocket: join(priv, 'run', 'submit.sock'), approveSocket: join(priv, 'run', 'owner', 'settle.sock'),
    keyFile: join(priv, 'owner-state', 'owner.key'),
  }
  // **THE OWNER DIRECTORY IS CREATED TOO — MEASURED, AND IT WAS MISSING.** The first version made
  // `run/owner` and chmodded `ownerState` without ever creating it, so the daemon refused with
  // `owner-dir-absent` and the court reported a MISSING KEY as though the boundary had failed. A refusal
  // hidden behind `stdio: 'ignore'` is a refusal nobody reads, so the log is captured below.
  asOwner(['mkdir', '-p', privConfig.ownerDir])
  asOwner(['mkdir', '-p', join(priv, 'run', 'owner')])
  asOwner(['chmod', '0700', privConfig.ownerDir])
  asOwner(['chmod', '0750', privConfig.runDir])
  asOwner(['chmod', '0700', join(priv, 'run', 'owner')])
  const configPath = join(priv, 'owner.json')
  // ── **THE CONFIG IS WRITTEN AS THE OWNER, BECAUSE THE AGENT CANNOT WRITE THERE (AUMLOK-115, PUSH RED)** ──
  //
  // MEASURED, AND THIS IS THE rc=1 AFTER A GREEN SUMMARY THAT FABLE'S REHEARSAL REPORTED. `priv` lives under
  // the owner's home, and this court runs as the AGENT — so an agent-side `writeFileSync` into it threw:
  //
  //     Error: ENOENT: no such file or directory, open '/home/aukora-owner/aukora-owner-court-108/owner.json'
  //         at writeFileSync (node:fs:2430:20)
  //         at file:///home/runner/.../tests/aukora-owner-protocol.test.mjs:637:3
  //
  // **AN UNCAUGHT THROW AFTER THE LAST ARM IS THE WORST SHAPE FOR THIS:** every arm had printed `ok`, the
  // summary was never reached, and node exited 1 — so the step read *"green arms"* and *"NON-ZERO"* at once and
  // reported them as one contradiction. **The exit code was telling the truth about a crash and nobody could
  // see the crash**, because it happened after the output everyone was reading.
  //
  // The write goes through the owner now, with the JSON on stdin — the same uid that will read it.
  const wrote = asOwner(['tee', configPath], JSON.stringify(privConfig))
  if (wrote.status !== 0) {
    // **A FAILURE HERE IS NAMED RATHER THAN LEFT TO BECOME AN UNCAUGHT THROW.** The privileged arms cannot run
    // without the layout, and "the layout could not be created" is a different sentence from "node crashed".
    console.log(`\nNOT_READY: the owner layout could not be written at ${configPath}`)
    console.log(`  tee exit ${String(wrote.status)}: ${String(wrote.stderr ?? '').trim().slice(0, 200)}`)
    console.log('CEILING: the privileged arms need a writable owner home. 2 means NOT RUN.')
    process.exit(2)
  }
  asOwner(['chmod', '0644', configPath])
  // THE DAEMON, AS THE OWNER, ON A SOCKET THE AGENT MAY REACH. Detached, so the court can talk to it.
  // THE DAEMON'S OWN WORDS ARE KEPT. `stdio: 'ignore'` turned a named startup refusal into an unexplained
  // missing file; a log the court can read is the difference between "the boundary failed" and "the daemon
  // said why it would not start".
  const daemonLog = join(priv, 'daemon.log')
  const sudoDaemon = spawn('sudo', ['-n', '-u', 'aukora-owner', process.execPath, DAEMON, configPath],
    { detached: true, stdio: ['ignore', openSync(daemonLog, 'a'), openSync(daemonLog, 'a')] })
  // **WATCHED FROM THE INSTANT IT EXISTS, NOT WHEN THE COURT REMEMBERS.** MEASURED: the original named this
  // `started`, SHADOWING the in-process daemon above, and `unref()`d it with no other reference kept — so by
  // the time the court could have cleaned it up there was nothing left to name it by.
  watched.push({ pid: sudoDaemon.pid, path: priv })
  sudoDaemon.unref()
  await new Promise(resolve => setTimeout(resolve, 1200))
  const daemonSaid = existsSync(daemonLog) ? readFileSync(daemonLog, 'utf8') : ''
  if (daemonSaid.trim().length > 0) say(`daemon: ${daemonSaid.trim().split('\n').slice(-1)[0].slice(0, 120)}`)

  arm('the daemon really started as aukora-owner, so the key it made is owner-owned', () => {
    assert.equal(existsSync(privConfig.keyFile), true,
      `the daemon wrote no key, so it did not start: ${String(daemonSaid).trim().slice(0, 200)}`)
    assert.equal(Number(statSync(privConfig.keyFile).uid), ownerUid,
      `the key is owned by uid ${String(statSync(privConfig.keyFile).uid)} and aukora-owner is ${String(ownerUid)} `
      + '— court ① below would be measuring the wrong thing')
  })

  arm('court ① secrets: an AGENT-UID read of the owner key fails EACCES', () => {
    const read = spawnSync('cat', [privConfig.keyFile], { encoding: 'utf8' })
    assert.notEqual(read.status, 0,
      'the agent uid READ the owner key, so the uid cut is not a boundary')
    say(`cat ${privConfig.keyFile} -> exit ${String(read.status)} (${String(read.stderr).trim().slice(0, 60)})`)
  })

  arm('court ② journal/witness: the agent cannot write in the owner directory, by EACCES', () => {
    const target = join(privConfig.ownerDir, 'journal.jsonl')
    const write = spawnSync('sh', ['-c', `echo x >> ${target}`], { encoding: 'utf8' })
    assert.notEqual(write.status, 0, 'the agent APPENDED to the owner directory')
    const remove = spawnSync('rm', ['-f', privConfig.keyFile], { encoding: 'utf8' })
    // **THE EXIT CODE ALONE IS NOT ENOUGH**: `rm -f` returns 0 for a file that is not there, so an arm
    // asserting only on the code would pass on a missing key. What matters is whether the KEY IS STILL
    // THERE, asked by the uid that owns it.
    const survived = asOwner(['test', '-f', privConfig.keyFile]).status === 0
    assert.equal(survived, true,
      `the agent removed the owner key (rm exit ${String(remove.status)}) — the directory is not a boundary`)
    assert.notEqual(remove.status, 0, 'the agent REMOVED the owner key')
    const list = spawnSync('ls', [privConfig.ownerDir], { encoding: 'utf8' })
    assert.notEqual(list.status, 0, 'the agent LISTED the owner directory')
    say('append, unlink and list in the owner directory all refused')
  })

  arm('court ③ ingress: the agent reaches submit.sock but is REFUSED approve.sock by the kernel', () => {
    const submit = spawnSync('sh', ['-c',
      `node -e "const n=require('node:net');const s=n.connect('${privConfig.submitSocket}');`
      + `s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('error',e=>console.log(e.code))"`],
    { encoding: 'utf8', timeout: 8000 })
    assert.match(String(submit.stdout), /CONNECTED/u,
      `the agent could not reach submit.sock, so court ③ is measuring the wrong socket: ${String(submit.stdout)}`)
    const approve = spawnSync('sh', ['-c',
      `node -e "const n=require('node:net');const s=n.connect('${privConfig.approveSocket}');`
      + `s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('error',e=>console.log(e.code))"`],
    { encoding: 'utf8', timeout: 8000 })
    assert.match(String(approve.stdout), /EACCES/u,
      `the agent REACHED approve.sock (${String(approve.stdout).trim()}), so the owner socket is not behind a `
      + 'kernel boundary')
    say('submit.sock reached, approve.sock refused EACCES — and the role is which socket accepted')
  })

  asOwner(['rm', '-rf', priv])
}

// ══ ITEM 4 (CODEX R7): THE OWNER LISTING IS STALE ════════════════════════════════════════════════
//
// **MEASURED, BOTH HALVES. `asked` IS A SNAPSHOT TAKEN WHEN THE PROPOSAL WAS FROZEN:** `settledAt` was `null`
// then and never updated, and **`count` was never copied into the cache at all** — so the listing reported
// `settledAt: null` for a settled proposal and `count: undefined` for EVERY proposal, settled or not. The bytes
// printed beside them were already read live from the store.
//
// **AND THE STORE IS THE RIGHT SOURCE ONLY WHILE IT STILL HOLDS THE NONCE.** Measured directly against
// `binding.mjs`: after a settle `byNonce` returns the entry with `settledAt` set and `count` present — **but a
// SETTLED proposal is TERMINAL, `reclaim` drops terminal entries, and `byNonce` then returns `null`.** So the
// reader falls back through the current entry, the cache, and finally the JOURNAL — the only one of the three
// that is durable, and the same record item E reads.
//
// **THIS ARM SUBMITS AND SETTLES ITS OWN PROPOSAL, ON PURPOSE.** My first version reused an earlier `submitted`
// and was anchored ABOVE the line that settles it — so it listed a proposal NOTHING HAD SETTLED, read
// `settledAt: null`, and looked like the defect it was written to catch. **An arm that runs before the act it
// measures reports a failure of the thing it is standing in for.** Owning the whole sequence removes the
// question of where it sits.
const ownSubmission = await ask(config.submitSocket, {
  op: 'submit', envelope: ENVELOPE, operation: OPERATIONS.ADMIT_ARTIFACT,
  scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
})
const ownSettlement = await ask(config.approveSocket, { op: 'approve', nonce: ownSubmission.nonce })
const ownListing = await ask(config.approveSocket, { op: 'list' })
const ownEntry = Array.isArray(ownListing.proposals)
  ? ownListing.proposals.find(entry => entry.nonce === ownSubmission.nonce) : undefined

arm('A LISTING AFTER A SETTLE SHOWS THE SETTLED TIME AND THE COUNT, not freeze-time values', () => {
  // THE SETTLE IS ASSERTED FIRST, SO A FAILURE HERE CANNOT MASQUERADE AS A FAILURE OF THE LISTING.
  assert.equal(ownSettlement.ok, true, `the arm's own settle refused: ${String(ownSettlement.reason)}`)
  assert.ok(ownEntry !== undefined, 'the settled proposal is missing from the listing')
  // **IT WAS `null` AT FREEZE TIME AND IS A NUMBER ONLY IF THE READER CONSULTED SOMETHING THAT KNOWS IT SETTLED.**
  assert.equal(typeof ownEntry.settledAt, 'number',
    `the listing reported settledAt=${JSON.stringify(ownEntry.settledAt)} for a SETTLED proposal, which is the `
    + 'freeze-time value')
  // **AND `count` WAS `undefined` FOR EVERY PROPOSAL, WHICH IS THE OTHER HALF.** It is the number the phone
  // event is checked against and the number the owner reads to decide.
  assert.equal(typeof ownEntry.count, 'number',
    `the listing reported count=${JSON.stringify(ownEntry.count)}, so the number printed beside the bytes is `
    + 'not the one those bytes carry')
  say(`a settled proposal relists with settledAt=${String(ownEntry.settledAt)} and count=${String(ownEntry.count)}`)
})


server.close()
await new Promise(resolve => setTimeout(resolve, 60))
removeCourtScratch(scratch)
// **EVERY COURT IS IN THE TOTALS.** A skip is a court that did not run, and it is counted as one: the
// denominator is green + red + skipped, so a run can no longer report a clean sheet while a court sat out.
// ══ THE MUTANTS ═══════════════════════════════════════════════════════════════════════════════════
//
// **AN ARM THAT CANNOT GO RED IS NOT MEASURING ANYTHING.** The envelope rule is a pure function in a pure
// module, so it is patched on disk and re-imported with a cache-busting query — **the same discipline the
// boundary court uses, and for the same reason: the module already in memory is the ORIGINAL, so a witness that
// used it would measure the protection it is meant to see removed.**
// ══ ITEM D HAS NO MUTANT HERE, AND THE REASON IS THE MODULE BOUNDARY ══════════════════════════════
//
// **MEASURED, AND IT IS A CORRECTION TO MY OWN FIRST VERSION.** I put the item D mutation in this court's
// MUTATIONS list, which patches `binding.mjs` — **but the rule lives in the DAEMON's request path.** The guard
// caught it exactly as designed (`the protection was not found, so this mutation proves nothing`) and the
// court exited 2, **which is the difference between a mutation that proves nothing and one that silently
// no-ops.**
//
// My SECOND version was worse and is worth recording: it printed `ok` when the mutated text was found on disk.
// **That proves the mutation was WRITTEN, not that removing the rule lets anything through** — a witness that
// reads the file it just wrote is measuring its own edit.
//
// So the truth, stated rather than dressed up: **the arm above is green, and the rule's removal is NOT
// measured.** Exercising it means starting a daemon built from the mutated daemon source, which is a different
// fixture from the one this court builds.
if (MUTATE) {
  process.stdout.write('  CEILING  the named-operation agreement check: the rule lives in the daemon\'s '
    + 'request path, which this court does not start from a mutated source. THE ARM IS GREEN AND THE REMOVAL '
    + 'IS NOT MEASURED\n')
  const BINDING_MODULE = join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'binding.mjs')
  const original = readFileSync(BINDING_MODULE, 'utf8')
  const MUTATIONS = [
    ['the envelope operation check',
      `  const implied = OPERATION_FOR_KIND.get(envelope.operation)
  if (implied !== undefined && implied !== envelope.kind) {`,
      `  const implied = OPERATION_FOR_KIND.get(envelope.operation)
  if (false) {`],
  ]
  let proven = 0
  for (const [label, from, to] of MUTATIONS) {
    if (!original.includes(from)) {
      process.stdout.write(`  NOT MEASURED  ${label}: the protection was not found, so this mutation proves `
        + 'nothing\n')
      process.exitCode = 2
      continue
    }
    // **THE GUARD, NOT A BARE `writeFileSync` (AUMLOK-106 (2)).** This court restored on `exit` and
    // `uncaughtException` — **neither runs on SIGTERM, and neither survives SIGKILL** — which is how a killed
    // `--mutate` left a tracked module mutated through two green measurements. The guard journals the original
    // bytes outside the repository BEFORE writing, covers all four catchable signals, and the next run
    // recovers a kill's leftovers.
    await guardedMutation(BINDING_MODULE, [[label, from, to]], async () => {
      const mutant = await import(`${pathToFileURL(BINDING_MODULE).href}?m=${String(arms)}-${label.replace(/\W/gu, '')}`)
      let accepted = false
      // EACH RULE HAS ITS OWN WITNESS, AND THE DAEMON-SIDE ONE IS READ FROM ITS SOURCE: this module is
      // `binding.mjs`, and the agreement check lives in the daemon's request path.
      if (false) {
        // **THIS IS A CEILING AND IT IS REPORTED AS ONE, WHICH IS THE WHOLE POINT OF THE DISTINCTION.**
        //
        // MEASURED, and it is a correction to my own first version: I had this print `ok` when the mutation
        // was found on disk. **That proves the mutation was WRITTEN, not that removing the rule LETS ANYTHING
        // THROUGH** — a witness that reads the file it just wrote is measuring its own edit.
        //
        // The rule lives in the DAEMON's request path, and the daemon for this court is started from the
        // fixture's own copy of the source. **Exercising the mutant would mean starting a daemon with the
        // mutated daemon source**, which is a different fixture from the one this court builds — so this
        // reports the truth instead: the arm above is green and the rule's removal is NOT measured here.
        process.stdout.write(`  CEILING  ${label}: the mutation is on disk, but this court does not start a `
          + 'daemon from it — the rule lives in the daemon\'s request path and exercising it needs a daemon '
          + 'built from the mutated source. THE ARM IS GREEN AND THE REMOVAL IS NOT MEASURED\n')
        // **`return`, NOT `continue`.** This sits in an `if (false)` block, so NEITHER runs — but `continue`
        // cannot appear inside the arrow function `guardInPlace` needs, and the module would not PARSE. **A
        // court that cannot parse does not run, and one that does not run cannot fail.** Behaviour is identical
        // because the branch is dead; the change is to what the parser accepts.
        return
      }
      try {
        mutant.freezeAdmissionEnvelope({
          envelope: { ...ENVELOPE, operation: OPERATIONS.ADMIT_SET },
          scope: gateReleaseScope(RELEASE), ledgerId: RELEASE,
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        })
        accepted = true
      } catch { accepted = false }
      if (accepted) {
        proven += 1
        process.stdout.write(`  ok    WITHOUT ${label} an envelope naming another kind's operation freezes\n`)
      } else {
        // **MEASURED, AND THE CEILING IS THE FINDING RATHER THAN A GAP.** Removing this check lets NOTHING
        // through, because **`assertOperationNamesTheEnvelopeKind` catches the same envelope first**: it maps
        // the OUTER operation to a kind and compares, and `admit-plugin-set` maps to `set` while the envelope
        // declares `artifact`. **So the invariant was already enforced on the daemon's own path, and what the
        // new check adds is coverage for a CALLER that builds an envelope directly** — which is exactly what
        // the arm above does, and it is the case the sibling check cannot see because there is no outer
        // operation to compare against.
        //
        // **A REDUNDANT CHECK WHOSE REMOVAL CANNOT BE MEASURED IS REPORTED AS A CEILING, NOT COUNTED AS
        // PROVEN** — the whole point of separating "the rule is present" from "removing it changes something".
        process.stdout.write(`  CEILING  ${label}: removing it let nothing new through, because the SIBLING `
          + 'check `assertOperationNamesTheEnvelopeKind` refuses the same envelope first — so the invariant is '
          + 'enforced on the daemon path, and what this check adds is coverage for a caller that builds an '
          + 'envelope with no outer operation to compare against\n')
      }
    })
    assert.equal(readFileSync(BINDING_MODULE, 'utf8'), original,
      'the module was NOT restored byte-identically')
  }
  process.stdout.write(`  ${String(proven)}/${String(MUTATIONS.length)} item 5 rule(s) PROVEN by mutation\n`)
}

const total = arms + SKIPPED.length
console.log(`\n  ${String(arms - missed)} of ${String(total)} courts green`
  + ` (${String(missed)} red, ${String(SKIPPED.length)} skipped with a named ceiling)\n`)
process.exit(missed === 0 ? 0 : 1)
