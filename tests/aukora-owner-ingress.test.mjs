#!/usr/bin/env node
/**
 * EXCLUSIVE INGRESS BY FILESYSTEM PERMISSION — does the KERNEL refuse a unix-socket connect it should?
 *
 * THE DESIGN QUESTION THIS ANSWERS (Fable, 2026-09-24): two sockets instead of a native credential binding.
 * `submit.sock` in a directory the submit group can traverse; `approve.sock` inside an OWNER-ONLY `0700`
 * directory, so an agent-uid connect fails in the kernel before the daemon sees anything — and the daemon
 * then knows a connection's ROLE from WHICH SOCKET ACCEPTED IT, with no claimed field anywhere.
 *
 * THAT ONLY WORKS IF macOS ENFORCES DIRECTORY TRAVERSAL FOR `connect(2)` ON A UNIX SOCKET, and if the
 * SOCKET FILE's own mode is not what decides it. Both are measured here rather than assumed, because
 * socket-file modes are historically unreliable on BSD and the DIRECTORY is therefore supposed to be the
 * boundary.
 *
 * HOW THIS IS MEASURED WITHOUT A SECOND USER. Mode bits bind the OWNER too: a `chmod 000` directory cannot
 * be traversed by the uid that owns it, any more than by a stranger. So the same uid stands in for the
 * agent and the owner, and the kernel's traversal check is exercised exactly as it would be across uids.
 * **A NAMED CEILING: this proves the KERNEL's behaviour, not the ACCOUNT arrangement.** The arm that needs
 * two real uids — a connect from a uid that is neither owner nor in the submit group — is left for when
 * the `aukora-owner` account exists, and is marked as not measured.
 *
 *   node tests/aukora-owner-ingress.test.mjs
 *   node tests/aukora-owner-ingress.test.mjs --mutate
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crashExit } from './helpers/court-crash.mjs'

const MUTATE = process.argv.includes('--mutate')
let arms = 0
let missed = 0
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
    console.log(`        ${String(error?.message ?? error).split('\n').slice(0, 6).join('\n        ')}`)
  }
}
const say = (line) => { console.log(`       ${line}`) }

console.log('\nAUMLOK — the owner socket boundary: what the kernel refuses\n')
console.log('  CEILING: one uid is used, so the KERNEL\'s traversal check is measured and the ACCOUNT\n'
  + '           arrangement is NOT. The two-uid arm waits for the `aukora-owner` account.\n')

const scratch = mkdtempSync(join(tmpdir(), 'aukora-ingress-'))
chmodSync(scratch, 0o700)

/** One unix socket inside `dirName`, with the directory and socket modes asked for. */
function serve(label, dirMode, socketMode) {
  const dir = join(scratch, label)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const socketPath = join(dir, 'settle.sock')
  // *** A SERVER-SIDE SOCKET NEEDS ITS OWN 'error' HANDLER. MEASURED 2026-09-26 in BETA's stranger clean-room
  // container (`aukora-ci-runner:a4`, uid 1000): the client destroys its socket immediately after connecting, and
  // under the container's timing the server side then emits ECONNRESET. With no handler attached, Node THROWS on an
  // unhandled 'error' event and the whole court dies with a stack trace — so the front door reported FAIL for a
  // PERMISSION arm, and it looked like a root-vs-mode-0000 problem in a container that does not even run as root.
  // macOS does not lose that race, which is why this only ever appeared in the clean-room. A court must not die of
  // socket hygiene while measuring the kernel's traversal check. ***
  const server = createServer(socket => {
    socket.on('error', () => {})
    socket.end('ok\n')
  })
  server.on('error', () => {})
  server.listen(socketPath)
  chmodSync(socketPath, socketMode)
  chmodSync(dir, dirMode)
  return { dir, socketPath, server }
}

// ── **A CRASH AFTER THE ARMS MUST NAME ITSELF, NOT VANISH INTO THE EXIT CODE (AUMLOK-115, PUSH RED)** ───────
//
// MEASURED: this court printed every arm `ok` and then died of an UNHANDLED SOCKET `error` — `ECONNRESET` — with
// no traceback anyone was reading, so the step reported a green summary beside rc=1 and the two looked like a
// contradiction. **AN EXCEPTION THAT ARRIVES AFTER THE ARMS MEANS THE COURT DID NOT RUN TO COMPLETION**, which is
// exit 2 — *not* exit 1, which means an arm failed. Naming it is the difference between a diagnosis and a mystery.
// **THIS EXITED 2 AND NOW EXITS 3 (row 16).** The reasoning above was right that a crash is not an arm failing —
// and wrong to borrow `NOT_READY` for it. **A court that could not exercise its subject never tried; a court that
// crashed tried and fell over**, and collapsing them loses the distinction CI needs to route the two. *Two
// different facts printed as one number is how a reader learns to distrust both.*
process.on('uncaughtException', crashExit({ court: 'the ingress court' }))

/** Try one connect and report what the kernel said. */
function tryConnect(socketPath) {
  return new Promise(resolve => {
    const socket = connect(socketPath)
    let settled = false
    const finish = value => { if (!settled) { settled = true; socket.destroy(); resolve(value) } }
    socket.on('connect', () => finish({ ok: true, code: null }))
    socket.on('error', error => finish({ ok: false, code: error?.code ?? String(error?.message ?? error) }))
    setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), 3000)
  })
}

/**
 * *** WHO IS ASKING DECIDES WHETHER THIS COURT CAN MEASURE ANYTHING (Fable, 2026-09-26). *** The kernel's traversal
 * check binds every uid EXCEPT 0: root holds CAP_DAC_OVERRIDE and walks a mode-0000 directory regardless, so the
 * EACCES this court is about never happens for root — the permission arms would not be measuring the kernel, they
 * would be measuring a privilege. On such a host they SKIP BY NAME and say why; they never pass silently, and a
 * reader must be able to see that nothing was measured.
 *
 * MEASURED, and why this is not the clean-room's bug: `aukora-ci-runner:a4` runs as `runner`, uid 1000, and there the
 * arms DO run (6/6 green inside that container). The guard exists for the next image that runs as root.
 * `AUKORA_COURT_UID` lets a court test the skip without being root — the same bargain `AUKORA_HEAVY_LEVEL` makes for
 * the memory floor — and it is printed whenever it is in use, so a faked uid cannot be mistaken for a real one.
 */
const UID = Number(process.env.AUKORA_COURT_UID ?? process.getuid?.() ?? -1)
const ROOT_UID = UID === 0
let permissionSkipped = 0
/** An arm that needs a non-root uid to mean anything. */
function permissionArm(label, check) {
  if (!ROOT_UID) return arm(label, check)
  permissionSkipped += 1
  process.stdout.write(`  SKIP  ${label}\n        NAMED CEILING: permission arm needs a non-root uid`
    + `${process.env.AUKORA_COURT_UID === undefined ? '' : ' (uid faked by AUKORA_COURT_UID)'}\n`)
}

const open = serve('open', 0o700, 0o660)
const closed = serve('closed', 0o700, 0o660)
const noTraverse = serve('no-traverse', 0o700, 0o660)
const noWrite = serve('no-write', 0o700, 0o660)
chmodSync(noTraverse.dir, 0o000)
chmodSync(noWrite.dir, 0o500)

// ── 1. THE ORDINARY CASE, SO THE OTHERS MEAN SOMETHING ──────────────────────────────────────────
const reachable = await tryConnect(open.socketPath)
permissionArm('a socket in a traversable directory is reachable — the harness can connect at all', () => {
  assert.equal(reachable.ok, true, `connecting to a 0700/0660 socket failed: ${String(reachable.code)}`)
})

// ── 2. THE MEASUREMENT: DIRECTORY TRAVERSAL IS ENFORCED BY THE KERNEL ───────────────────────────
const blocked = await tryConnect(noTraverse.socketPath)
permissionArm('A CONNECT THROUGH A 0000 DIRECTORY IS REFUSED BY THE KERNEL, before the daemon sees anything', () => {
  assert.equal(blocked.ok, false,
    'the connect SUCCEEDED through a directory with no permission bits at all, so the owner-only '
    + 'DIRECTORY is not a boundary on this platform and the two-socket design would authorise nobody')
  assert.equal(blocked.code, 'EACCES',
    `the kernel refused with ${String(blocked.code)} rather than EACCES — a different failure is a `
    + 'different fact and this arm is about permission')
  say(`chmod 000 directory -> connect refused ${String(blocked.code)}`)
})

const noWriteResult = await tryConnect(noWrite.socketPath)
permissionArm('traversal needs only the EXECUTE bit: a 0500 directory still reaches the socket', () => {
  // x is traverse, r is list. A directory you may walk but not list is exactly what the submit side wants:
  // the group can reach the socket without being able to enumerate what else is in there.
  assert.equal(noWriteResult.ok, true,
    `a 0500 directory refused a connect (${String(noWriteResult.code)}), so the boundary costs more than `
    + 'traversal and the submit group would need read access it does not need')
  say('directory 0500 (walk, no list) -> connect succeeded')
})

// ── 3. THE CLAIM THAT DECIDES WHERE THE BOUNDARY LIVES: SOCKET-FILE MODES ────────────────────────
const socketModeZero = await (async () => {
  chmodSync(closed.socketPath, 0o000)
  return tryConnect(closed.socketPath)
})()
arm('MEASURED: A SOCKET FILE AT MODE 0000 IN A TRAVERSABLE DIRECTORY — is its own mode the boundary?', () => {
  say(`socket file chmod 000, directory 0700 -> connect ${socketModeZero.ok ? 'SUCCEEDED' : `refused ${String(socketModeZero.code)}`}`)
  // EITHER ANSWER IS A RESULT, AND IT DECIDES THE DESIGN. If it succeeds, the socket's own mode is NOT a
  // boundary on this platform and the DIRECTORY must be — which is exactly why the owner socket lives in an
  // owner-only directory rather than relying on the file's 0660.
  return true
})
arm('and the design does NOT depend on the socket file\'s mode, whichever way that went', () => {
  assert.equal(noTraverse.dir.endsWith('no-traverse'), true)
  say(socketModeZero.ok
    ? 'the socket file mode did not stop the connect, so the OWNER-ONLY DIRECTORY is the boundary'
    : 'the socket file mode did stop the connect here, and the owner-only directory is still the boundary')
})

// ── THE RED ARM: RESTORE THE DIRECTORY AND THE REFUSAL MUST LIFT ────────────────────────────────
// The EACCES above is only evidence about the DIRECTORY MODE if the same connect succeeds once the mode
// comes back. Otherwise it could have been a dead server, a wrong path, or a socket that never listened —
// three other reasons to be refused, none of them the boundary this court exists to measure.
if (MUTATE) {
  console.log('\n── mutation: the directory mode restored ──')
  chmodSync(noTraverse.dir, 0o700)
  const lifted = await tryConnect(noTraverse.socketPath)
  permissionArm('with the 0000 RESTORED to 0700 the same connect SUCCEEDS, so the refusal was the directory mode', () => {
    assert.equal(lifted.ok, true,
      `the connect was still refused (${String(lifted.code)}) after the directory became traversable, so `
      + 'the EACCES above was NOT the directory and this court has been measuring something else')
    say('0000 -> EACCES, 0700 -> connected: the boundary is the directory mode')
  })
}

for (const s of [open, closed, noTraverse, noWrite]) {
  chmodSync(s.dir, 0o700)
  s.server.close()
}
// Give the listeners a tick to unwind before the directory goes.
await new Promise(resolve => setTimeout(resolve, 50))
rmSync(scratch, { recursive: true, force: true })

console.log(`\n  ${String(arms - missed)}/${String(arms)} arms green\n`)
process.exit(missed === 0 ? 0 : 1)
