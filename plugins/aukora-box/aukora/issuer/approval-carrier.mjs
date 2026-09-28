/**
 * The channel one issuer prompt is written to and its one answer read from.
 *
 * The issuer's authority step is unchanged by this file: the issuer mints the
 * challenge, renders the prompt, and accepts exactly one `yes <challenge>`
 * line. A carrier moves those bytes and nothing else. It never decides, never
 * rewrites an answer, and never signs.
 *
 * Two carriers exist because two launches exist. Under a parent-owned launch
 * the issuer's stdin and stderr are the parent's pipes and the supervisor
 * bridges them. Under launchd there is no parent: stdio is a log file, so a
 * prompt written there is unanswerable and every approval would refuse as
 * `unavailable`. The socket carrier is that missing channel.
 *
 * A carrier is a transport, NOT an authorization. Possession of the operator
 * end lets its holder answer a prompt the issuer already decided to show; it
 * does not establish that a human saw an approval artifact. The operator end is
 * responsible for having obtained the answer through the bound review path.
 * Serving this socket from anything the guest can reach or impersonate defeats
 * the confinement the issuer depends on.
 */
import { createConnection } from 'node:net'
import { execFileSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { dirname, isAbsolute, normalize } from 'node:path'

/** Environment key naming the operator-owned answer channel. Absent selects stdio. */
export const APPROVAL_SOCKET_ENV = 'AUKORA_ISSUER_APPROVAL_SOCKET'

/** Environment key naming the uid the answer channel must already belong to. */
export const APPROVAL_SOCKET_UID_ENV = 'AUKORA_ISSUER_APPROVAL_SOCKET_UID'

/**
 * Require an operator-owned socket under root/operator-owned, non-writable
 * ancestors. Root-owned sticky directories are permitted; symlinks and macOS
 * extended ACLs are not. Socket group access may admit the separate issuer UID.
 * These POSIX checks do not distinguish a human from code running as the owner.
 *
 * @param {string} socketPath - the operator-owned answer channel.
 * @param {number} expectedUid - the uid the channel must already belong to.
 * @returns {void}
 * @throws {Error} when ownership, permissions, path custody, or ACL absence cannot be established.
 */
export function assertOperatorChannel(socketPath, expectedUid) {
  readOperatorChannel(socketPath, expectedUid)
}

/** Capture the entries whose ownership prevents untrusted endpoint substitution. */
function readOperatorChannel(socketPath, expectedUid) {
  if (!Number.isInteger(expectedUid) || expectedUid < 0 || expectedUid > 0xffff_fffe) {
    throw new Error('issuer:approval-socket-uid-required')
  }
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || normalize(socketPath) !== socketPath
    || /[\u0000-\u001f\u007f]/u.test(socketPath)) {
    throw new Error('issuer:approval-socket-path-invalid')
  }
  let node
  try {
    node = lstatSync(socketPath)
  } catch (error) {
    throw new Error('issuer:approval-socket-unavailable', { cause: error })
  }
  if (!node.isSocket()) throw new Error('issuer:approval-socket-not-a-socket')
  if (node.uid !== expectedUid) throw new Error('issuer:approval-socket-owner-unexpected')
  if ((node.mode & 0o007) !== 0) throw new Error('issuer:approval-socket-world-accessible')
  const snapshot = [{ path: socketPath, node }]
  for (let path = dirname(socketPath); ; path = dirname(path)) {
    const directory = lstatSync(path)
    if (!directory.isDirectory() || (directory.uid !== 0 && directory.uid !== expectedUid)
      || ((directory.mode & 0o022) !== 0 && !(directory.uid === 0 && (directory.mode & 0o1000) !== 0))) {
      throw new Error('issuer:approval-socket-ancestor-unsafe')
    }
    snapshot.push({ path, node: directory })
    if (path === dirname(path)) break
  }
  // Linux POSIX ACL write permissions are bounded by the mode mask; Darwin
  // extended ACL grants need the separate native observation.
  if (process.platform === 'darwin') {
    for (const entry of snapshot) assertNoExtendedAcl(entry.path)
  }
  return snapshot
}

/** Refuse every Darwin ACL, including deny-only entries, and unavailable native observations. */
function assertNoExtendedAcl(path) {
  let listing
  try {
    listing = execFileSync('/bin/ls', ['-lde', '--', path], {
      encoding: 'utf8', env: { LANG: 'C', LC_ALL: 'C' }, timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error('issuer:approval-socket-acl-unobserved', { cause: error })
  }
  const [header, ...details] = listing.slice(0, -1).split('\n')
  const mode = /^[dspcb-][rwxStTs-]{9}([@+]?)\s/u.exec(header)
  if (!listing.endsWith('\n') || mode === null || !header.endsWith(` ${path}`)) {
    throw new Error('issuer:approval-socket-acl-unobserved')
  }
  if (mode[1] === '+' || details.some(line => /^\s+[0-9]+:\s/u.test(line))) {
    throw new Error('issuer:approval-socket-extended-acl-present')
  }
  if (details.length !== 0) throw new Error('issuer:approval-socket-acl-unobserved')
}

/**
 * The parent-owned carrier: prompts to stderr, answers from stdin.
 *
 * @returns {{write: (text: string) => void, onData: (handler: (text: string) => void) => void, onEnd: (handler: () => void) => void, close: () => void}} the stdio carrier.
 */
export function stdioCarrier() {
  return {
    write: text => { process.stderr.write(text) },
    onData: (handler) => { process.stdin.on('data', chunk => handler(chunk.toString('utf8'))) },
    onEnd: (handler) => {
      process.stdin.on('end', handler)
      process.stdin.on('error', handler)
    },
    close: () => {},
  }
}

/**
 * The launchd carrier: one connection to an operator-owned answer channel.
 *
 * Resolves only after connection and a second observation of the same socket
 * and ancestors. Startup failure sends no prompt bytes. A later disconnect is
 * terminal and produces unavailability, not a human denial. The owner must
 * supply an approval adapter; this raw stream does not implement the
 * authenticated broker-review protocol.
 *
 * @param {string} socketPath - the operator-owned answer channel.
 * @param {number} expectedUid - the uid the channel must already belong to.
 * @returns {Promise<import('./approval-carrier.mjs').ApprovalCarrier>} the connected socket carrier.
 * @throws {Error} when the channel fails custody checks or connection does not complete within five seconds.
 */
export async function socketCarrier(socketPath, expectedUid) {
  const before = readOperatorChannel(socketPath, expectedUid)
  const socket = createConnection(socketPath)
  socket.setEncoding('utf8')
  let ended = false
  const endHandlers = []
  const finish = () => {
    if (ended) return
    ended = true
    for (const handler of endHandlers) handler()
  }
  socket.on('close', finish)
  socket.on('end', finish)
  // A carrier error is never a decision: it ends the channel and the issuer
  // refuses, rather than being read as a denial the operator did not make.
  socket.on('error', finish)
  try {
    await new Promise((resolve, reject) => {
      const fail = () => { cleanup(); reject(new Error('issuer:approval-socket-unavailable')) }
      const ready = () => { cleanup(); resolve(undefined) }
      const timer = setTimeout(fail, 5_000)
      const cleanup = () => {
        clearTimeout(timer)
        socket.removeListener('connect', ready)
        socket.removeListener('error', fail)
        socket.removeListener('close', fail)
        socket.removeListener('end', fail)
      }
      socket.once('connect', ready)
      socket.once('error', fail)
      socket.once('close', fail)
      socket.once('end', fail)
    })
    const after = readOperatorChannel(socketPath, expectedUid)
    if (ended || before.length !== after.length || before.some((entry, index) => {
      const current = after[index]
      return entry.path !== current.path
        || ['dev', 'ino', 'uid', 'gid', 'mode'].some(key => entry.node[key] !== current.node[key])
    })) throw new Error('issuer:approval-socket-changed')
  } catch (error) {
    socket.destroy()
    throw error
  }
  return {
    write: (text) => {
      if (ended) return
      try { socket.write(text) } catch { finish() }
    },
    onData: (handler) => { socket.on('data', handler) },
    onEnd: (handler) => {
      endHandlers.push(handler)
      if (ended) handler()
    },
    close: () => { finish(); socket.destroy() },
  }
}

/**
 * Select the carrier this launch configured.
 *
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {Promise<import('./approval-carrier.mjs').ApprovalCarrier>} the selected carrier, connected when socket-backed.
 * @throws {Error} when the socket channel is named but unusable, or its uid is
 *   absent or malformed. A named-but-broken channel fails the launch instead of
 *   silently falling back to a stdio no one is reading.
 */
export async function openApprovalCarrier(env = process.env) {
  const socketPath = env[APPROVAL_SOCKET_ENV]
  const rawUid = env[APPROVAL_SOCKET_UID_ENV]
  if (socketPath === undefined && rawUid === undefined) return stdioCarrier()
  if (socketPath === undefined || socketPath === '') throw new Error('issuer:approval-socket-path-required')
  if (rawUid === undefined || !/^(0|[1-9]\d{0,9})$/.test(rawUid) || Number(rawUid) > 0xffff_fffe) {
    throw new Error(`issuer:approval-socket-uid-required (${APPROVAL_SOCKET_UID_ENV})`)
  }
  return socketCarrier(socketPath, Number(rawUid))
}
