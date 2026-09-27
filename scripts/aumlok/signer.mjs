#!/usr/bin/env node
/**
 * Run one isolated owner signer on a local Unix socket (Genesis plan D2).
 *
 *   node scripts/aumlok/signer.mjs --socket <path> --key-file <pem> \
 *        --registered-key-hex <64 hex> --approve test-all|decline-all
 *
 * TEST KEYS ONLY, AND NO DEFAULT KEY LOCATION. There is no configuration file, no
 * environment default and no well-known path: `--key-file` is required, so this
 * process cannot reach the owner's keys by being started carelessly. The key file must
 * be a regular file, not a symlink, owned by this uid, mode 0600 — the same
 * `same-uid-posix-mode-only` custody class the store reader measures, and stated as
 * the same limit: this is a mode check on one file, not isolation and not custody.
 *
 * THERE IS NO DEFAULT APPROVER. `--approve` is required and its only two values are
 * named after what they are: `test-all` approves every request it is shown, and
 * `decline-all` refuses every request. A deployment that has a real decision
 * procedure (D2's "presents the operation", D3's hardware custody) supplies it
 * through `createOwnerSigner`'s `review` option in code; it is not configured by a
 * flag here, because a flag is how an unconfigured signer silently approves.
 *
 * WHAT THE PROCESS IS NOT. A second process on the same uid is not a uid boundary.
 * The key material is one `chmod 0600` file away from everything else this user
 * runs, and `OWNER_KEY_SAME_UID: true` is printed on startup and beside every
 * reply's status. The separation this buys is architectural — the broker never
 * holds the key, and the signing step is one auditable function — not
 * cryptographic.
 *
 * Protocol: one JSON request per connection, one newline-terminated JSON response
 * back, then the connection closes. Bounded input, bounded output.
 *
 * @module scripts/aumlok/signer
 */
import { createPrivateKey } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import {
  MAX_APPROVAL_LINE_BYTES,
  createOwnerSigner,
  createTestApprover,
  approvalPopupArgv,
  approvalPopupText,
  canonicalJSON,
  popupDecision,
  createTestDecliner,
  encodeApprovalResponse,
  printSignerCeilings,
  rawEd25519PublicKeyHex,
} from '../../plugins/aukora-aumlok/lib/index.mjs'
// THE SOCKET-PATH LIMIT, FROM ITS ONE IMPLEMENTATION. `resolve` above is the only other thing done to the
// path before binding, and this runs on the resolved value so it measures what the kernel will be given.
import { assertSocketPathFits } from '../../plugins/aukora-owner-daemon/lib/listener.mjs'

/** Read one `--flag value` argument, or undefined. */
function option(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Refuse to start, with a named reason and no socket left behind. */
function refuse(reason) {
  process.stderr.write(`signer: ${reason}\n`)
  process.exit(2)
}

const socketPath = option('--socket')
const keyFile = option('--key-file')
const registeredKeyHex = option('--registered-key-hex')
const approveMode = option('--approve')

if (socketPath === undefined) refuse('--socket is required; this signer has no default socket')
if (keyFile === undefined) refuse('--key-file is required; this signer has NO default key location')
if (registeredKeyHex === undefined) refuse('--registered-key-hex is required')
if (!/^[0-9a-f]{64}$/u.test(registeredKeyHex)) refuse('--registered-key-hex must be 64 lowercase hexadecimal chars')
if (!['test-all', 'decline-all', 'popup'].includes(approveMode)) {
  refuse('--approve must be test-all, decline-all or popup; there is deliberately no default approver')
}

/**
 * Raise the NATIVE approval dialog and read the answer.
 *
 * The dialog shows the exact canonical bytes and the challenge before anything is signed, which is
 * the only defence against being asked to approve something other than what was shown. It is not a
 * security boundary — the reviewer runs in the same process and UID as the key — and it fails
 * CLOSED: a dialog that cannot be raised, is dismissed, or returns anything other than the Approve
 * button yields no signature. The Refuse button is the default precisely so that a Return keypress
 * or a window-manager close is not an approval.
 *
 * The outcome is printed so the daemon's own log distinguishes "no display here" from "a person
 * refused", even though both produce the same refusal code to the broker.
 */
function popupReview({ request }) {
  let text
  try {
    text = approvalPopupText(request)
  } catch {
    process.stdout.write('SIGNER_POPUP: unavailable (the request is not presentable)\n')
    return { approve: false }
  }
  const raised = spawnSync('osascript', approvalPopupArgv(text), { encoding: 'utf8', timeout: 300_000 })
  const decision = popupDecision({
    status: raised.status, stdout: raised.stdout, errorCode: raised.error?.code ?? null,
  })
  process.stdout.write(`SIGNER_POPUP: ${decision}${decision === 'unavailable' ? ` (${raised.error?.code ?? `exit ${String(raised.status)}`})` : ''}\n`)
  return { approve: decision === 'approved' }
}

/** Read a private key file under the same-uid-posix-mode-only custody class. */
function readPrivateKeyFile(path) {
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : undefined
  if (euid === undefined) refuse('this platform has no POSIX euid; the custody class is unmeasurable here')
  let descriptor
  try {
    const state = lstatSync(path, { bigint: true })
    if (state.isSymbolicLink()) refuse(`${path} is a symbolic link; refusing to follow it`)
    if (!state.isFile()) refuse(`${path} is not a regular file`)
    if (state.uid !== BigInt(euid)) refuse(`${path} is not owned by this uid`)
    if ((state.mode & 0o777n) !== 0o600n) refuse(`${path} must be mode 0600; it is 0${(state.mode & 0o777n).toString(8)}`)
    if (state.size <= 0n || state.size > 16n * 1024n) refuse(`${path} has an implausible size`)
    // **`O_NONBLOCK`, BECAUSE `O_NOFOLLOW` SAYS NOTHING ABOUT A FIFO (AUMLOK-92 ITEM 4).** MEASURED: this
    // refused a symlink and then opened whatever else was at the path — and `open` on a FIFO with no writer
    // BLOCKS. **The signer holds a lock while it runs, so a blocking open does not fail; it stops the signer,
    // with no name and no error**, which is the worst answer available. `O_NONBLOCK` makes the open return at
    // once for a FIFO and changes nothing for the regular file this expects.
    descriptor = openSync(path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const opened = fstatSync(descriptor, { bigint: true })
    if (opened.dev !== state.dev || opened.ino !== state.ino) refuse(`${path} changed between stat and open`)
    const chunks = []
    let total = 0
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(4096, 16 * 1024 + 1 - total))
      const count = readSync(descriptor, chunk, 0, chunk.length, null)
      if (count === 0) break
      total += count
      if (total > 16 * 1024) refuse(`${path} exceeds the key-file ceiling`)
      chunks.push(chunk.subarray(0, count))
    }
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

// A missing or unreadable key file is a NAMED refusal, not a stack trace. `readPrivateKeyFile`
// proves the file's custody, and every failure on the way there has to reach the operator as the
// same kind of message as the other startup refusals — a crash reads as a bug in the signer rather
// than as "you pointed it at nothing".
let privateKeyMaterial
try {
  privateKeyMaterial = readPrivateKeyFile(resolve(keyFile))
} catch (error) {
  if (error instanceof Error && /^bind|^signer:/.test(error.message)) throw error
  refuse(`cannot read --key-file ${resolve(keyFile)}: ${error?.code ?? error?.message ?? String(error)}`)
}
const privateKey = createPrivateKey(privateKeyMaterial)
let signer
try {
  signer = createOwnerSigner({
    privateKey,
    registeredPublicKeyHex: registeredKeyHex,
    review: approveMode === 'test-all'
      ? createTestApprover()
      : (approveMode === 'popup' ? popupReview : createTestDecliner()),
  })
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error))
}

const target = resolve(socketPath)

// ── THE PATH LENGTH, WHICH THIS SIGNER NEVER CHECKED (it is the component the defect was FOUND in) ──
//
// **MEASURED: THIS SCRIPT BOUND A ~117-BYTE PATH AND ITS OWN `lstat` OF THAT PATH RETURNED ENOENT.** At 105
// bytes and above the kernel SILENTLY TRUNCATES the path to 104 and binds there, so the signer believed it was
// listening on the path it was given while a socket file sat one truncation away.
// **AND `server.address()` CANNOT SEE IT**: it reports the path Node was ASKED to bind, not the one the kernel
// created, so the READY line would have announced a socket that was not the one accepting connections.
//
// **THE GUARD IS IMPORTED RATHER THAN COPIED.** It is `assertSocketPathFits` in the owner daemon's listener,
// where it is implemented and where its boundary is measured; as of this commit that module EXPORTS both it
// and `SUN_PATH_MAX`. A second copy here would be the version that drifts — and the signer is exactly where
// the drift would matter, because it is the component that already bit.
// **ROUTED THROUGH `refuse`, NOT LEFT TO THROW.** MEASURED: a bare call exited **1** as an uncaught exception
// while every other refusal in this script exits **2** — so the guard fired and the arm still read it as
// acceptance, because the only thing it can see is the exit code. **A refusal that reports itself as a crash is
// a refusal a caller cannot distinguish from a bug in the thing refusing.**
try {
  assertSocketPathFits(target)
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error))
}

let server

// ── the directory the socket lives in ─────────────────────────────────────────────────────────
// The socket's own 0600 mode stops another principal CONNECTING to it, but it says nothing about
// the directory that holds it. A group- or world-accessible parent lets another principal traverse
// to the leaf; if that parent is writable it also lets them REPLACE the leaf. A signer substituted
// at the same path is worse than an absent one: the impostor can proxy to the real signer and
// forward its genuine signature, so the broker's check — "the registered key signed these bytes" —
// still passes while the request is being read by someone else. The directory is therefore a
// prerequisite of the channel rather than an incidental detail of it, and it is measured BEFORE
// any socket exists.
//
// The rule is this lane's existing custody class applied one level up: owned by this euid, with NO
// group or other permission bits at all. `statSync` follows a symlinked path deliberately — the
// question is what actually holds the leaf.
//
// LIMIT, stated rather than implied: only the IMMEDIATE parent is measured. A writable grandparent
// could still swap the parent directory out beneath us, and this check would not see it.
{
  const directory = dirname(target)
  let state
  try {
    state = statSync(directory)
  } catch (error) {
    refuse(`socket directory ${directory} is not readable: ${error?.code ?? String(error)}`)
  }
  if (!state.isDirectory()) refuse(`socket directory ${directory} is not a directory`)
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : undefined
  if (euid === undefined) {
    refuse('this platform has no POSIX euid, so the socket directory custody class is unmeasurable here')
  }
  if (state.uid !== euid) refuse(`socket directory ${directory} is not owned by this uid`)
  const directoryMode = state.mode & 0o777
  if ((directoryMode & 0o077) !== 0) {
    refuse(`socket directory ${directory} is mode 0${directoryMode.toString(8)}; a group- or `
      + 'world-accessible directory lets another principal reach or replace the signing channel, '
      + 'so it may have no group or other permission bits')
  }
  process.stdout.write(`SIGNER_SOCKET_DIR_MODE: 0${directoryMode.toString(8)}\n`)
}

// ── the socket we create, and only that socket ────────────────────────────────────────────────
// A unix socket leaf is a PATH, so unlinking one is an operation on whoever currently owns that
// path. Two consequences, both measured by the suite's collision arms:
//
//   1. Bind failure is an ASYNC `error` event on a unix socket, not a throw, so the try/catch
//      around `listen` cannot see EADDRINUSE. Without a handler the process dies on an unhandled
//      error — and then an unconditional cleanup unlinks a path this process never created: a
//      live signer's socket (making a running process permanently unreachable, since it keeps the
//      listening fd but loses the name), or any regular file that happened to be there.
//   2. Even a successful bind does not entitle us to delete that path forever. If the leaf is
//      replaced while we run, the path now names someone else's object.
//
// So ownership is recorded from the bind itself — device and inode — and cleanup removes the leaf
// only when the path still resolves to that exact object. A path we did not create is left alone,
// and so is one that has since been replaced.
let bound = false
let socketIdentity = null

/** Restore the ambient umask once, whether the bind succeeded or failed. */
let savedUmask = null
function restoreUmask() {
  if (savedUmask === null) return
  const previous = savedUmask
  savedUmask = null
  process.umask(previous)
}

/** True when the path still resolves to the exact socket object this process created. */
function ownsLeafNow() {
  if (!bound || socketIdentity === null) return false
  try {
    const state = lstatSync(target, { bigint: true })
    return state.isSocket() && state.dev === socketIdentity.dev && state.ino === socketIdentity.ino
  } catch {
    return false
  }
}

/** Remove the socket leaf only if this process created it and it is still that same object. */
function removeOwnSocket() {
  if (!ownsLeafNow()) return
  try {
    unlinkSync(target)
  } catch {
    /* already gone, or unreadable: either way it is not ours to remove */
  }
}

try {
  server = createServer(socket => {
    let received = ''
    let answered = false
    const reply = response => {
      if (answered) return
      answered = true
      socket.end(encodeApprovalResponse(response))
    }
    socket.setTimeout(10_000)
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      if (Buffer.byteLength(received, 'utf8') > MAX_APPROVAL_LINE_BYTES) {
        // Over-long input is answered with a refusal rather than dropped: a caller
        // that sent something wrong should get a reason, not a hang.
        reply(signer.approve(null))
        return
      }
      const newline = received.indexOf('\n')
      if (newline === -1) return
      let request
      try {
        request = JSON.parse(received.slice(0, newline))
      } catch {
        request = null
      }
      // D2: "the signer presents the operation and returns a signature or a refusal." This is that
      // presentation, printed before the decision rather than after it, so the exact bytes about to
      // be signed are on the record whether the answer is a signature or a refusal. The request
      // carries no secret — it is the subject, the active control digest, the operation digest, the
      // challenge and the window — and the preimage the signer signs is derived from it
      // deterministically, so naming it names what is being agreed to.
      if (request !== null && typeof request === 'object') {
        try {
          process.stdout.write(`SIGNER_PRESENTS: ${canonicalJSON(request)}\n`)
        } catch {
          // A request whose fields are not canonically encodable is refused by the signer below;
          // the presentation simply has nothing to show.
        }
      }
      const response = signer.approve(request)
      process.stdout.write(`SIGNED_REQUEST: ${response.signature === undefined ? `refused ${response.refusal}` : `challenge ${response.challenge}`}\n`)
      reply(response)
    })
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => socket.destroy())
  })
  // Bind failure arrives HERE, not as a throw: an unix-socket EADDRINUSE is an async `error`
  // event. Without this handler the process dies on an unhandled error, and the exit handler then
  // removes a path it never owned. Registered before `listen`, so no window exists in which a
  // bind failure is unhandled.
  server.on('error', error => {
    restoreUmask()
    const code = error?.code ?? 'error'
    const detail = error instanceof Error ? error.message : String(error)
    if (!bound) refuse(`cannot listen on ${target}: ${code}: ${detail}`)
    // A listener error after a successful bind is not a startup failure; stop serving and clean
    // up only our own leaf.
    process.stderr.write(`signer: listener failed after bind on ${target}: ${code}\n`)
    shutdown()
  })

  // The socket is created owner-only from BIND TIME, not from the first request: a unix socket is
  // `0777 & ~umask`, so under the common group-shared `umask 002` the request channel would be
  // reachable by every process in that group — anyone who can connect can ask this key to sign an
  // arbitrary operation digest, which is the part an attacker actually needs. The key file's mode
  // is checked separately above; this is the channel, and it needs its own guarantee.
  savedUmask = process.umask(0o177)
  server.listen(target, () => {
    restoreUmask()
    // Record ownership from the object we just created, then make the mode explicit rather than
    // inherited, then assert it — all three before READY, because a signer that announces itself
    // must not be announcing a channel that is wider than the key it guards.
    try {
      const created = lstatSync(target, { bigint: true })
      if (!created.isSocket()) {
        refuse(`${target} is not a socket after bind; refusing to serve on an unexpected object`)
      }
      socketIdentity = { dev: created.dev, ino: created.ino }
      bound = true
      chmodSync(target, 0o600)
      const settled = lstatSync(target, { bigint: true })
      const mode = settled.mode & 0o777n
      if (mode !== 0o600n) {
        refuse(`socket ${target} is mode 0${mode.toString(8)}; refusing to serve a signing channel others may reach`)
      }
    } catch (error) {
      if (error?.code === undefined) throw error
      refuse(`cannot secure ${target}: ${error.code}: ${error.message}`)
    }
    process.stdout.write(`SIGNER_REGISTERED_KEY: ${rawEd25519PublicKeyHex(privateKey)}\n`)
    process.stdout.write(`SIGNER_APPROVER: ${approveMode === 'test-all'
      ? 'test-all (approves every request; NOT a human review)'
      : (approveMode === 'popup'
        ? 'popup (a native dialog shows the exact bytes; it fails CLOSED)'
        : 'decline-all (refuses every request)')}\n`)
    process.stdout.write(`SIGNER_SOCKET_MODE: 0${(lstatSync(target).mode & 0o777).toString(8)}\n`)
    printSignerCeilings()
    process.stdout.write(`SIGNER_READY ${target}\n`)
  })
} catch (error) {
  restoreUmask()
  refuse(error instanceof Error ? error.message : String(error))
}

/**
 * Stop serving and remove ONLY the socket leaf this process created and still owns.
 *
 * The guard is the whole point. An unconditional unlink here is how a crashed or collided start
 * deletes a running signer's socket — leaving that process holding its listening fd with no name
 * for any broker to reach, which presents as `channel-unavailable` forever — or deletes whatever
 * regular file an operator mistyped into `--socket`. `removeOwnSocket` compares the device and
 * inode it recorded at bind, so a path that was never ours, or that has since been replaced, is
 * left exactly as found.
 */
function shutdown() {
  restoreUmask()
  // MEASURED, AND THE REASON THIS IS NOT JUST A GUARDED unlink: Node's `server.close()` unlinks the
  // socket path ITSELF, unconditionally, regardless of what now sits there. Guarding our own
  // `unlinkSync` is therefore necessary but not sufficient — on a path that has been replaced,
  // `close()` alone deletes someone else's object. So `close()` is called only while the leaf is
  // still ours; otherwise the process exits and lets the OS close the descriptor, which leaves the
  // path untouched.
  if (ownsLeafNow()) {
    removeOwnSocket()
    try {
      server?.close()
    } catch {
      /* closing an already-closed server is not a failure worth reporting */
    }
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', () => {
  restoreUmask()
  removeOwnSocket()
})
