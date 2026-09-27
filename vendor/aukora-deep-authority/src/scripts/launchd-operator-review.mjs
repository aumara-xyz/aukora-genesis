#!/usr/bin/env node
/** Attachable operator terminal for the installed broker and issuer; never installs or restarts services. */
import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOperatorChannel } from '../aukora/issuer/approval-carrier.mjs'
import { createTerminalLines, reviewApprovalArtifact, reviewIssuerChallenge } from '../aukora/supervisor/developer-terminal.mjs'
import { parseCustodyPairJson, parseDsclRecord, parseNumericGroups, requireTerminalPublicKey, validateCustodyPairPlan } from './install-launchd-custody-pair.mjs'
import { connectIssuerReview } from './launchd-issuer-review.mjs'

const fail = reason => new Error(`aukora:operator-review:${reason}`)
const usage = 'usage: node scripts/launchd-operator-review.mjs --inputs ABSOLUTE_JSON --private-key ABSOLUTE_TERMINAL_PEM --approval-group ISSUER_ONLY_GROUP [--check]'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

/**
 * Require every ancestor of this module and the repo root to be root-owned without group or world write.
 * @param {{modulePath?: string, repoRoot?: string, stat?: (path: string) => {isDirectory(): boolean, isSymbolicLink(): boolean, uid: number, mode: number}}} [options] fixture-injectable invocation locations
 * @returns {void} nothing, refusing `operator-review:invocation-tree-untrusted` on any untrusted ancestor
 */
export function assertOperatorInvocationTree({ modulePath = fileURLToPath(import.meta.url), repoRoot = REPO_ROOT, stat = lstatSync } = {}) {
  const seen = new Set()
  const paths = []
  let current = dirname(resolve(modulePath))
  while (true) {
    const normalized = resolve(current)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      paths.push(normalized)
    }
    const parent = dirname(normalized)
    if (parent === normalized) break
    current = parent
  }
  const root = resolve(repoRoot)
  if (!seen.has(root)) paths.push(root)
  for (const path of paths) {
    let state
    try {
      state = stat(path)
    } catch {
      throw fail('invocation-tree-untrusted')
    }
    if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== 0 || (state.mode & 0o022) !== 0) {
      throw fail('invocation-tree-untrusted')
    }
  }
}

/** Require observable absence of Darwin ACLs; POSIX modes alone do not constrain them. */
function noAcl(path) {
  if (process.platform !== 'darwin') return
  const text = execFileSync('/bin/ls', ['-lde', '--', path], { encoding: 'utf8', timeout: 5_000,
    maxBuffer: 64 * 1024, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const [header, ...details] = text.slice(0, -1).split('\n')
  const mode = /^[dspcb-][rwxStTs-]{9}([@+]?)\s/u.exec(header)
  if (!text.endsWith('\n') || !header.endsWith(` ${path}`) || mode === null) throw fail('acl-unobserved')
  if (mode[1] === '+' || details.length !== 0) throw fail('extended-acl-present')
}

/** Require root/operator-owned ancestors, with only root-owned sticky temporary directories writable. */
function assertOperatorAncestors(path, ownerUid) {
  if (!Number.isInteger(ownerUid) || ownerUid < 0 || ownerUid > 0xffff_fffe) throw fail('owner-invalid')
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path) throw fail('path-invalid')
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const node = lstatSync(parent)
    if (!node.isDirectory() || (node.uid !== 0 && node.uid !== ownerUid)
      || ((node.mode & 0o022) !== 0 && !(node.uid === 0 && (node.mode & 0o1000) !== 0))) throw fail('file-parent-not-protected')
    noAcl(parent)
    if (parent === dirname(parent)) break
  }
}

/**
 * Read bounded operator-owned bytes; no symlinks, writable ancestors, or extended ACLs.
 * @param {string} path - absolute configuration or terminal-key path.
 * @param {number} ownerUid - required file owner; the installed command fixes this to root.
 * @param {boolean} privateFile - require 0600 rather than a non-writable public file.
 * @returns {string} stable UTF-8 bytes, never logged by this reader.
 */
export function readOperatorReviewFile(path, ownerUid, privateFile) {
  assertOperatorAncestors(path, ownerUid)
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.uid !== ownerUid || before.nlink !== 1
      || (privateFile ? (before.mode & 0o777) !== 0o600 : (before.mode & 0o022) !== 0)
      || before.size > 32 * 1024) throw fail('file-custody-invalid')
    noAcl(path)
    const bytes = Buffer.alloc(32 * 1024 + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    const after = fstatSync(descriptor)
    const named = lstatSync(path)
    if (length !== before.size || length > 32 * 1024 || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || named.dev !== before.dev || named.ino !== before.ino || named.isSymbolicLink()) throw fail('file-changed')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))
  } finally { closeSync(descriptor) }
}

const observeHost = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', timeout: 5_000,
    maxBuffer: 64 * 1024, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * Observe existing issuer-only membership without changing accounts or permissions.
 * @param {import('./launchd-operator-review.mjs').ReviewPrincipals} plan - expected daemon and guest identities.
 * @param {string} groupName - separately provisioned operator-channel group.
 * @param {(binary:string,args:string[])=>string} [host] - bounded read-only host observation, injectable for fixture tests.
 * @returns {number} group id, refusing other members, nested groups, or missing issuer access.
 */
export function readIssuerOnlyGroup(plan, groupName, host = observeHost) {
  if (!/^_[a-z][a-z0-9_]{0,30}$/u.test(groupName)) throw fail('approval-group-invalid')
  const group = parseDsclRecord(host('/usr/bin/dscl', ['.', '-read', `/Groups/${groupName}`,
    'PrimaryGroupID', 'GroupMembership', 'GroupMembers', 'NestedGroups']), ['PrimaryGroupID'])
  const issuer = parseDsclRecord(host('/usr/bin/dscl', ['.', '-read', `/Users/${plan.issuerUser}`,
    'UniqueID', 'GeneratedUID']), ['UniqueID', 'GeneratedUID'])
  const gidText = group.get('PrimaryGroupID')
  const gid = Number(gidText)
  if (!/^[1-9][0-9]{0,9}$/u.test(gidText) || gid > 0xffff_fffe
    || gid === plan.issuerGid || gid === plan.brokerGid || Number(issuer.get('UniqueID')) !== plan.issuerUid) throw fail('approval-group-not-isolated')
  const tokens = field => (group.get(field) ?? '').split(/\s+/u).filter(Boolean)
  if (tokens('NestedGroups').length !== 0 || tokens('GroupMembership').some(name => name !== plan.issuerUser)
    || tokens('GroupMembers').some(id => id.toUpperCase() !== issuer.get('GeneratedUID').toUpperCase())) throw fail('approval-group-not-isolated')
  // Primary membership may not appear in GroupMembership or GroupMembers.
  const primaryUsers = host('/usr/bin/dscl', ['.', '-list', '/Users', 'PrimaryGroupID']).trim().split('\n')
  for (const line of primaryUsers) {
    // Stock macOS service accounts carry PrimaryGroupID -2 (nobody); they are observations, not refusals.
    const row = /^(\S+)\s+(-?[0-9]+)$/u.exec(line)
    if (row === null) throw fail('group-membership-unobserved')
    if (Number(row[2]) === gid && row[1] !== plan.issuerUser) throw fail('approval-group-not-isolated')
  }
  for (const [name, uid, allowed] of [[plan.issuerUser, plan.issuerUid, true],
    [plan.brokerUser, plan.brokerUid, false], [plan.guestUser, plan.guestUid, false]]) {
    if (Number(host('/usr/bin/id', ['-u', name]).trim()) !== uid
      || parseNumericGroups(host('/usr/bin/id', ['-G', name])).has(gid) !== allowed) throw fail('approval-group-not-isolated')
  }
  return gid
}

/**
 * Validate installed routes and attach the real terminal, or perform read-only preflight.
 * Requires an operator-provisioned root terminal key and an issuer-only group.
 * @param {string[]} args - exact CLI arguments.
 * @returns {Promise<import('./launchd-issuer-review.mjs').IssuerReviewConnection|undefined>} attached terminal, absent for --check.
 */
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\nNeeds a root-owned terminal key, root-owned plan, and a pre-provisioned issuer-only group. No service restarts or automatic approvals.\n`)
    return
  }
  if ((args.length !== 6 && args.length !== 7) || args[0] !== '--inputs' || args[2] !== '--private-key'
    || args[4] !== '--approval-group' || (args.length === 7 && args[6] !== '--check')) throw new Error(usage)
  if (args.length !== 7) assertOperatorInvocationTree()
  if (process.platform !== 'darwin') throw fail('darwin-required')
  if (process.geteuid() !== 0) throw fail('root-required')
  const plan = validateCustodyPairPlan(parseCustodyPairJson(readOperatorReviewFile(args[1], 0, false)))
  if (plan.issuerApprovalSocket === undefined || plan.issuerApprovalSocketUid !== '0') throw fail('root-operator-route-required')
  assertOperatorAncestors(plan.issuerApprovalSocket, 0)
  try { lstatSync(plan.issuerApprovalSocket); throw fail('approval-route-occupied') }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
  const terminalPrivateKey = createPrivateKey(readOperatorReviewFile(args[3], 0, true))
  if (terminalPrivateKey.asymmetricKeyType !== 'ed25519'
    || createPublicKey(terminalPrivateKey).export({ type: 'spki', format: 'pem' }).toString() !== requireTerminalPublicKey(plan)) throw fail('terminal-key-mismatch')
  const issuerSocketGid = readIssuerOnlyGroup(plan, args[5])
  assertOperatorChannel(plan.reviewSocket, plan.brokerUid)
  if (args[6] === '--check') {
    process.stdout.write(`${JSON.stringify({ status: 'preflight-checked', reviewSocket: plan.reviewSocket,
      issuerSocketPath: plan.issuerApprovalSocket, issuerSocketGid, attendance: false, connected: false })}\n`)
    return
  }
  const lines = createTerminalLines()
  let connection
  try {
    connection = await connectIssuerReview({ socketPath: plan.reviewSocket, role: 'broker', serverId: plan.reviewServerId,
      terminalPrivateKey, issuerSocketPath: plan.issuerApprovalSocket, issuerSocketMode: 0o660, issuerSocketGid,
      review: (request, signal) => reviewApprovalArtifact(lines, request, signal),
      reviewIssuer: (request, signal) => {
        process.stderr.write(request.prompt)
        return reviewIssuerChallenge(lines, request, signal)
      } })
    void lines.closed.then(() => connection.close()).catch(() => { /* Connection records cleanup errors for its owner. */ })
    void connection.closed.then(() => lines.close())
    process.stderr.write('Operator review ready. Start the issuer only after its configured carrier matches this route. Ctrl-C closes review, not the daemons.\n')
    return connection
  } catch (error) { lines.close(); await connection?.close(); throw error }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let connection
  const stop = () => { void connection?.close().catch(() => { process.exitCode = 1 }) }
  try {
    connection = await main()
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    await connection?.closed
    if (connection?.error()) throw connection.error()
  } catch (error) { process.stderr.write(`${String(error?.message ?? error)}\n`); process.exitCode = 1 }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await connection?.close() }
}
