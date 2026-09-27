/**
 * Strict macOS ACL observations for installed custody paths.
 *
 * Every extended ACL is refused, including deny-only ACLs. POSIX ownership and
 * mode checks remain the caller's responsibility. These observations neither
 * change permissions nor establish protection against subsequent host changes.
 *
 * @module launchd-custody-acl
 */
import childProcess from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, normalize } from 'node:path'

/** Stable refusal for an ACL or an unavailable custody observation. */
export class CustodyAclError extends Error {
  /**
   * @param {string} reason - Stable refusal identifier.
   * @param {string} path - Filesystem entry that could not be admitted.
   */
  constructor(reason, path) {
    super(`${reason}: ${path}`)
    this.name = 'CustodyAclError'
    this.reason = reason
    this.path = path
  }
}

const UNOBSERVED = 'launchd-install:acl-unobserved'
const PRESENT = 'launchd-install:extended-acl-present'
const IDENTITY_FIELDS = ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'ctimeNs']
const SUMMARY = /^([0-9]+) ([dspcb-][rwxStTs-]{9})([@+]?)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+[A-Z][a-z]{2}\s+[0-9]{1,2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2}\s+[0-9]{4} (.+)$/u

/**
 * Require one existing canonical entry to have no extended ACL.
 *
 * The native listing must identify the same inode, owner, group, and mode as
 * surrounding lstat observations. Missing paths, symlinks, command diagnostics,
 * malformed output, and changes during observation all refuse admission.
 *
 * @param {string} path - Absolute normalized path without symlink components.
 * @returns {void}
 * @throws {CustodyAclError} when an ACL exists or absence cannot be observed.
 */
export function assertNoExtendedAcl(path) {
  if (process.platform !== 'darwin') throw new CustodyAclError(UNOBSERVED, path)
  assertExactPath(path)
  const before = readIdentity(path)
  let result
  try {
    result = childProcess.spawnSync('/bin/ls', ['-ldeniT', '--', path], {
      encoding: 'utf8',
      env: { LANG: 'C', LC_ALL: 'C' },
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    })
  } catch {
    throw new CustodyAclError(UNOBSERVED, path)
  }
  if (result.error !== undefined || result.status !== 0 || result.signal !== null
    || result.stderr !== '' || typeof result.stdout !== 'string'
    || !result.stdout.endsWith('\n')) {
    throw new CustodyAclError(UNOBSERVED, path)
  }
  const after = readIdentity(path)
  if (IDENTITY_FIELDS.some(field => before[field] !== after[field])) {
    throw new CustodyAclError(UNOBSERVED, path)
  }
  const [header, ...details] = result.stdout.slice(0, -1).split('\n')
  const summary = SUMMARY.exec(header)
  if (summary === null || summary[8] !== path
    || summary[1] !== String(before.ino)
    || summary[2] !== permissionText(before.mode)
    || summary[4] !== String(before.nlink)
    || summary[5] !== String(before.uid)
    || summary[6] !== String(before.gid)) {
    throw new CustodyAclError(UNOBSERVED, path)
  }
  if (summary[3] === '+' || details.some(line => /^\s+[0-9]+:\s/u.test(line))) {
    throw new CustodyAclError(PRESENT, path)
  }
  if (details.length !== 0) throw new CustodyAclError(UNOBSERVED, path)
}

/**
 * Require ACL absence on one entry and every ancestor through the filesystem root.
 *
 * This checks replacement paths but does not enumerate descendants; callers
 * must separately pass each member of a protected implementation or state tree.
 *
 * @param {string} path - Absolute normalized path without symlink components.
 * @returns {void}
 * @throws {CustodyAclError} when any component cannot be admitted.
 */
export function assertNoExtendedAclAncestors(path) {
  assertExactPath(path)
  const entries = [path]
  for (let parent = dirname(path); parent !== entries.at(-1); parent = dirname(parent)) {
    entries.push(parent)
  }
  for (const entry of entries.reverse()) assertNoExtendedAcl(entry)
}

/** Refuse ambiguous path spellings before invoking a host command. */
function assertExactPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path
    || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw new CustodyAclError(UNOBSERVED, String(path))
  }
}

/** Read exact inode identity without admitting a linked leaf or ancestor. */
function readIdentity(path) {
  try {
    const state = lstatSync(path, { bigint: true })
    if (state.isSymbolicLink() || realpathSync.native(path) !== path) {
      throw new CustodyAclError(UNOBSERVED, path)
    }
    return state
  } catch {
    throw new CustodyAclError(UNOBSERVED, path)
  }
}

/** Render the POSIX type and permission bits printed by the native long listing. */
function permissionText(mode) {
  const value = Number(mode)
  const types = { 4096: 'p', 8192: 'c', 16384: 'd', 24576: 'b', 32768: '-', 49152: 's' }
  let text = types[value & 0o170000] ?? '?'
  for (const [shift, special, lower, upper] of [
    [6, 0o4000, 's', 'S'], [3, 0o2000, 's', 'S'], [0, 0o1000, 't', 'T'],
  ]) {
    text += value & (0o4 << shift) ? 'r' : '-'
    text += value & (0o2 << shift) ? 'w' : '-'
    const executable = Boolean(value & (0o1 << shift))
    text += value & special ? (executable ? lower : upper) : (executable ? 'x' : '-')
  }
  return text
}
