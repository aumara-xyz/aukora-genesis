#!/usr/bin/env node
/**
 * MEASURE THE BOUNDARY ON THE ACTUAL INSTALLATION — run by PETER, as his normal user, AFTER the install.
 *
 * Codex round 4 asked for dated measurements taken on the real installation rather than on a fixture, and
 * this is that instrument. **IT RUNS AS THE AGENT UID — the ordinary user Peter is already logged in as —
 * and it ATTEMPTS the things the cut forbids, one at a time, recording the KERNEL'S OWN ANSWER with its
 * errno and a timestamp.** Nothing here is a claim about what should happen: every line is an attempt that
 * either failed with a named error or succeeded, and a success on a refusal is a FAILURE OF THE CUT.
 *
 *   node scripts/owner/measure-boundary.mjs                       # the real install paths
 *   node scripts/owner/measure-boundary.mjs --fixture <dir>       # a layout, for the court
 *   node scripts/owner/measure-boundary.mjs --positive-control    # PETER's explicit step
 *
 * **IT NEVER SUDO'S ANYTHING EXCEPT THE POSITIVE CONTROL, AND ONLY WHEN THAT FLAG IS GIVEN.** The flag is
 * not a default and not a fallback: the whole point of the refusals above is that the agent uid needs no
 * privilege to be refused, and a script that escalated to check would be measuring the wrong uid.
 *
 * THE POSITIVE CONTROL IS THE HALF PEOPLE SKIP. A boundary that refuses everything is indistinguishable
 * from a daemon that is simply broken, so the run ends by showing that a settle WORKS: the script (as the
 * agent) freezes a proposal over `submit.sock`, then invokes the OWNER CONSOLE through `sudo -u aukora-owner`
 * — **where Peter types his own password** — and reads back the settle. Refusals plus a working control are
 * evidence; refusals alone are not.
 *
 * OUTPUT: one dated JSON record under `scripts/owner/records/`, and a one-line verdict to stdout, so a
 * README row can cite the record file rather than repeat a number.
 */
import { existsSync, constants as FS, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { hostname, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const { OWNER_INSTALL } = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'detect.mjs')).href)
const { submitProposal, settleBytesFor } = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'client.mjs')).href)

const argv = process.argv.slice(2)
const optionOf = name => { const at = argv.indexOf(name); return at === -1 ? undefined : argv[at + 1] }
const FIXTURE = optionOf('--fixture')
const POSITIVE_CONTROL = argv.includes('--positive-control')
const AS_OWNER = optionOf('--owner') ?? 'aukora-owner'

/** THE REAL LAYOUT, or the fixture's, in exactly the shape the installer uses. */
function layoutFor(fixture) {
  if (fixture === undefined) {
    return {
      ownerDir: dirname(OWNER_INSTALL.pubkey),
      keyFile: join(dirname(OWNER_INSTALL.pubkey), 'owner.key'),
      journal: join(dirname(OWNER_INSTALL.pubkey), 'journal.jsonl'),
      witness: join(dirname(OWNER_INSTALL.pubkey), 'witness.json'),
      submitSocket: '/private/var/run/aukora/submit.sock',
      approveSocket: '/private/var/run/aukora/owner/settle.sock',
      codeDir: OWNER_INSTALL.code,
      node: '/usr/local/libexec/aukora-owner/bin/owner-daemon.mjs',
      plist: OWNER_INSTALL.launchDaemon,
      config: OWNER_INSTALL.config,
    }
  }
  return JSON.parse(readFileSync(join(fixture, 'layout.json'), 'utf8'))
}

/** ONE ATTEMPT, AND THE KERNEL'S OWN ANSWER. Never a prediction. */
function attempt(what, expect, run) {
  let errno = null
  let detail = ''
  try {
    const value = run()
    detail = typeof value === 'string' ? value : 'the call returned normally'
  } catch (error) {
    errno = error?.code ?? error?.name ?? 'UNKNOWN'
    detail = String(error?.message ?? error).slice(0, 160)
  }
  // A REFUSAL IS A FAILURE OF THE ATTEMPT. For `expect: 'refuse'` a named error is the pass; for
  // `expect: 'allow'` a clean return is. Anything else is recorded as what it was.
  const refused = errno !== null
  return Object.freeze({
    what, expect, errno, refused, ok: expect === 'refuse' ? refused : !refused, detail,
    at: new Date().toISOString(),
  })
}

/** Connecting is asynchronous, so it is wrapped to look like the synchronous attempts above. */
function connectAttempt(what, expect, socketPath) {
  return new Promise(resolvePromise => {
    let settled = false
    const finish = (errno, detail) => {
      if (settled) return
      settled = true
      socket.destroy()
      const refused = errno !== null
      resolvePromise(Object.freeze({
        what, expect, errno, refused, ok: expect === 'refuse' ? refused : !refused, detail,
        at: new Date().toISOString(),
      }))
    }
    const socket = connect(socketPath)
    socket.on('connect', () => finish(null, 'connected'))
    socket.on('error', error => finish(error?.code ?? 'UNKNOWN', String(error?.message ?? error).slice(0, 160)))
    setTimeout(() => finish('TIMEOUT', `no answer within 4000 ms`), 4000)
  })
}

const layout = layoutFor(FIXTURE)
const attempts = []

// ── READING: the key, the journal, the witness ────────────────────────────────────────────────────
for (const [what, path] of [['read the owner key', layout.keyFile],
  ['read the journal', layout.journal], ['read the witness', layout.witness]]) {
  attempts.push(attempt(what, 'refuse', () => readFileSync(path, 'utf8').slice(0, 24)))
}

// ── WRITING: append, truncate and REPLACE each of them ────────────────────────────────────────────
// REPLACE IS THE ONE A MODE CHECK MISSES. A file you cannot write can still be UNLINKED and recreated if
// its DIRECTORY lets you, and an owner directory that allows it is a boundary in name only — so the
// replacement is attempted as a rename INTO place, which is how it would really be done.
for (const [what, path] of [['append to the owner key', layout.keyFile],
  ['append to the journal', layout.journal], ['append to the witness', layout.witness]]) {
  attempts.push(attempt(what, 'refuse', () => { writeFileSync(path, 'x', { flag: 'a' }); return 'appended' }))
}
for (const [what, path] of [['truncate the owner key', layout.keyFile],
  ['truncate the journal', layout.journal], ['truncate the witness', layout.witness]]) {
  attempts.push(attempt(what, 'refuse', () => { writeFileSync(path, ''); return 'truncated' }))
}
// **A FRESH REPLACEMENT FILE FOR EVERY ATTEMPT.** MEASURED: one temp file was written once and used for
// every rename, and the FIRST successful rename CONSUMED it — so on an open fixture the later attempts failed
// with ENOENT and were recorded as refusals they had not earned. A refusal must be recorded for the reason it
// claims, or the measurement counts the wrong thing.
const freshReplacement = () => {
  const path = join(tmpdir(), `aukora-replacement-${String(process.pid)}-${String(attempts.length)}`)
  writeFileSync(path, 'replacement\n')
  return path
}
for (const [what, path] of [['replace the owner key', layout.keyFile],
  ['replace the journal', layout.journal], ['replace the witness', layout.witness]]) {
  attempts.push(attempt(what, 'refuse', () => { renameSync(freshReplacement(), path); return 'replaced' }))
}
// ...and the removal itself, which is the act the directory check exists for.
for (const [what, path] of [['unlink the owner key', layout.keyFile], ['unlink the journal', layout.journal]]) {
  attempts.push(attempt(what, 'refuse', () => { unlinkSync(path); return 'unlinked' }))
}

// ── THE SOCKETS: the owner's refused, the agent's allowed ─────────────────────────────────────────
attempts.push(await connectAttempt('connect to approve.sock', 'refuse', layout.approveSocket))
attempts.push(await connectAttempt('connect to submit.sock', 'allow', layout.submitSocket))

// ── THE CODE AND THE PLIST ────────────────────────────────────────────────────────────────────────
// THE CODE IS ROOT-OWNED SO THE AGENT CANNOT REWRITE THE THING THAT DECIDES. A daemon that loaded its code
// from a directory the agent can write is a daemon the agent can replace.
attempts.push(attempt('write into the installed code directory', 'refuse',
  () => { writeFileSync(join(layout.codeDir, 'agent-written.mjs'), 'x'); return 'wrote' }))
attempts.push(attempt('replace the installed daemon entry point', 'refuse',
  () => { renameSync(freshReplacement(), layout.node); return 'replaced' }))
attempts.push(attempt('edit the LaunchDaemon plist', 'refuse',
  () => { writeFileSync(layout.plist, 'x', { flag: 'a' }); return 'appended' }))

// ── THE POSITIVE CONTROL: ONE SETTLE THAT REALLY WORKS ────────────────────────────────────────────
let positive = Object.freeze({ ran: false, reason: 'not requested (pass --positive-control)' })
if (POSITIVE_CONTROL) {
  positive = await runPositiveControl()
}

async function runPositiveControl() {
  const { spawnSync } = await import('node:child_process')
  try {
    const bytes = settleBytesFor({ intent: 'boundary-measurement', words: ['positive', 'control'] })
    const frozen = await submitProposal({
      socketPath: layout.submitSocket, bytes, operation: 'aumlok.boundary-control',
      scope: 'aukora-aumlok.ceremony', ledgerId: 'boundary-control',
    })
    // **THE ONE SUDO, AND PETER TYPES THE PASSWORD.** `-n` is deliberately ABSENT so a terminal prompts; a
    // run with no terminal fails loudly rather than silently measuring nothing.
    const reply = spawnSync('sudo', ['-u', AS_OWNER, process.execPath,
      join(layout.codeDir, 'bin', 'owner-console.mjs'), '--config', layout.config, 'approve', frozen.nonce],
    { encoding: 'utf8' })
    const out = `${String(reply.stdout ?? '')}${String(reply.stderr ?? '')}`.trim()
    return Object.freeze({
      ran: true, ok: reply.status === 0 && /SETTLED/u.test(out),
      status: reply.status, nonce: frozen.nonce, digest: frozen.digest,
      console: out.split('\n').slice(-1)[0].slice(0, 200), at: new Date().toISOString(),
    })
  } catch (error) {
    return Object.freeze({ ran: true, ok: false, reason: String(error?.code ?? error?.message ?? error).slice(0, 200), at: new Date().toISOString() })
  }
}

// ── THE RECORD AND THE VERDICT ────────────────────────────────────────────────────────────────────
const refusals = attempts.filter(entry => entry.expect === 'refuse')
const refusalsOk = refusals.filter(entry => entry.ok).length
const allows = attempts.filter(entry => entry.expect === 'allow')
const allowsOk = allows.filter(entry => entry.ok).length
const measuredAt = new Date().toISOString()
const record = Object.freeze({
  measuredAt,
  host: hostname(),
  uid: typeof process.getuid === 'function' ? process.getuid() : null,
  user: userInfo().username,
  fixture: FIXTURE === undefined ? null : resolve(FIXTURE),
  layout,
  attempts,
  refusals: { ok: refusalsOk, total: refusals.length },
  allows: { ok: allowsOk, total: allows.length },
  positiveControl: positive,
  // THE VERDICT NAMES THE UID CUT ONLY WHEN THE REFUSALS HELD **AND** THE CONTROL WORKED. A run with every
  // refusal and a dead daemon proves the boundary and not the installation.
  verdict: refusalsOk === refusals.length && allowsOk === allows.length && (positive.ran !== true || positive.ok === true)
    ? 'SEPARATE_UID' : 'NOT_PROVEN',
})

const recordsDir = join(HERE, 'records')
mkdirSync(recordsDir, { recursive: true })
const recordPath = join(recordsDir, `boundary-${measuredAt.replace(/[:.]/gu, '-')}.json`)
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
process.stdout.write(`${record.verdict} measured on ${record.host} at ${measuredAt}: `
  + `${String(refusalsOk)}/${String(refusals.length)} refusals, `
  + `${String(allowsOk)}/${String(allows.length)} allowed, `
  + `positive control ${positive.ran === true ? (positive.ok === true ? 'ok' : 'FAILED') : 'not run'}\n`)
process.stdout.write(`record: ${recordPath}\n`)
process.exit(record.verdict === 'SEPARATE_UID' ? 0 : 1)
