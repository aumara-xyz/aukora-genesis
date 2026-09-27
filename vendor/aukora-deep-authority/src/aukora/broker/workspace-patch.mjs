/**
 * One bounded file create or replacement inside an operator-configured workspace.
 * The broker owns approval and settlement. Filesystem checks reject observed
 * links and stale bytes; they do not confine a hostile concurrent same-UID writer.
 * @module @aukora/broker/workspace-patch
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { captureWorkspacePatchArgs, MAX_WORKSPACE_PATCH_BYTES } from './workspace-patch-args.mjs'

export { isExactWorkspacePatchArgs, MAX_WORKSPACE_PATCH_BYTES, WORKSPACE_NAME_SHAPE, workspacePatchBody } from './workspace-patch-args.mjs'

/**
 * Validate a named root, existing parent directories, and the target preimage without writing.
 * @param {Record<string,string>} roots - operator-owned names mapped to canonical absolute directories.
 * @param {{workspace:string,path:string,beforeSha256:string|null,content:string}} args - exact proposed change.
 * @returns {{path:string,bytes:number,contentSha256:string}} target and proposed content evidence.
 * @throws {Error} when the workspace, path, or existing target cannot satisfy the proposal.
 */
export function preflightWorkspacePatch(roots, args) {
  const captured = captureWorkspacePatchArgs(args)
  if (captured === null) throw new TypeError('workspace.patch:arguments-not-exact')
  return preflightCaptured(roots, captured)
}

/**
 * Publish one owner-only, non-executable UTF-8 file and freshly read its evidence.
 * Creates never replace an existing entry. Replacements check the expected digest
 * again immediately before rename; this is not an atomic filesystem compare-and-swap.
 * Failures after publication may leave the new file in place and require the
 * broker's indeterminate outcome; callers must not infer rollback from an exception.
 * @param {Record<string,string>} roots - operator-owned names mapped to canonical absolute directories.
 * @param {{workspace:string,path:string,beforeSha256:string|null,content:string}} args - exact approved change.
 * @returns {{path:string,bytes:number,contentSha256:string,inode:number,mtimeNs:string}} freshly observed published file.
 * @throws {Error} for invalid preconditions, failed publication, or mismatched readback.
 */
export function workspacePatch(roots, args) {
  const captured = captureWorkspacePatchArgs(args)
  if (captured === null) throw new TypeError('workspace.patch:arguments-not-exact')
  const expected = preflightCaptured(roots, captured)
  const staging = join(dirname(expected.path), `.aukora-patch-${process.pid}-${randomBytes(16).toString('hex')}`)
  let descriptor
  try {
    descriptor = openSync(staging, 'wx', 0o600)
    writeFileSync(descriptor, captured.content, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    const checked = preflightCaptured(roots, captured)
    if (checked.path !== expected.path) throw new Error('workspace.patch:workspace-changed')
    if (captured.beforeSha256 === null) {
      linkSync(staging, expected.path)
      unlinkSync(staging)
    } else {
      renameSync(staging, expected.path)
    }
    syncDirectory(dirname(expected.path))
    const observed = readRegularFile(expected.path)
    if (observed === null || observed.contentSha256 !== expected.contentSha256 || observed.bytes !== expected.bytes) {
      throw new Error('workspace.patch:published-content-mismatch')
    }
    return { path: expected.path, ...observed }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    try { unlinkSync(staging) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** Validate captured primitives without another read from the caller's object. */
function preflightCaptured(roots, args) {
  const rootDescriptor = Object.getOwnPropertyDescriptor(roots, args.workspace)
  if (rootDescriptor === undefined || !Object.hasOwn(rootDescriptor, 'value')) {
    throw new Error('workspace.patch:workspace-not-configured')
  }
  const root = rootDescriptor.value
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root) {
    throw new Error('workspace.patch:workspace-not-canonical')
  }
  let canonical
  try { canonical = realpathSync(root) } catch {
    throw new Error('workspace.patch:workspace-unavailable')
  }
  if (canonical !== root) throw new Error('workspace.patch:workspace-not-canonical')
  requireDirectory(root)
  const parts = args.path.split('/')
  let parent = root
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part)
    requireDirectory(parent)
  }
  const path = join(parent, parts.at(-1))
  const before = readRegularFile(path)
  if (args.beforeSha256 === null ? before !== null : before?.contentSha256 !== args.beforeSha256) {
    throw new Error('workspace.patch:preimage-mismatch')
  }
  return {
    path,
    bytes: Buffer.byteLength(args.content, 'utf8'),
    contentSha256: createHash('sha256').update(args.content, 'utf8').digest('hex'),
  }
}

/** Require a directory entry itself, not a link to one. */
function requireDirectory(path) {
  let stat
  try { stat = lstatSync(path) } catch {
    throw new Error('workspace.patch:parent-unavailable')
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('workspace.patch:parent-not-directory')
}

/** Read at most the configured bound plus one byte from one regular-file descriptor. */
function readRegularFile(path) {
  let entry
  try { entry = lstatSync(path) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error('workspace.patch:target-unavailable')
  }
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('workspace.patch:target-not-file')
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      try { lstatSync(path) } catch (missing) {
        if (missing?.code === 'ENOENT') return null
        throw new Error('workspace.patch:target-unavailable')
      }
    }
    throw new Error('workspace.patch:target-unavailable')
  }
  try {
    const stat = fstatSync(descriptor, { bigint: true })
    if (!stat.isFile()) throw new Error('workspace.patch:target-not-file')
    if (stat.size > BigInt(MAX_WORKSPACE_PATCH_BYTES)) throw new Error('workspace.patch:existing-file-too-large')
    const body = Buffer.alloc(MAX_WORKSPACE_PATCH_BYTES + 1)
    let bytes = 0
    while (bytes < body.length) {
      const count = readSync(descriptor, body, bytes, body.length - bytes, null)
      if (count === 0) break
      bytes += count
    }
    if (bytes > MAX_WORKSPACE_PATCH_BYTES) throw new Error('workspace.patch:existing-file-too-large')
    return {
      bytes,
      contentSha256: createHash('sha256').update(body.subarray(0, bytes)).digest('hex'),
      inode: Number(stat.ino),
      mtimeNs: String(stat.mtimeNs),
    }
  } finally {
    closeSync(descriptor)
  }
}

/** Flush the containing directory after publishing or replacing an entry. */
function syncDirectory(path) {
  // Node cannot open directories for fsync on Windows; the file itself was synced.
  if (process.platform === 'win32') return
  const descriptor = openSync(path, constants.O_RDONLY)
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}
