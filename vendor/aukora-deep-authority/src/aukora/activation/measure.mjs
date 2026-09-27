/**
 * Filesystem custody measurement for activation closure members.
 *
 * `@aukora/activation/statement` decides whether a statement is well-formed.
 * This module decides whether the bytes it names were read from an exact
 * regular-file leaf that was not writable beyond its owner at measurement
 * time. The two are separate because a statement can be validated with no
 * filesystem at all, and a member can be measured before any statement exists.
 *
 * A measured member is never a symbolic link: resolving one before hashing it
 * would record whichever bytes the link points at today. Its ancestry is
 * stricter by default — the whole path must already be canonical — because an
 * ancestor another principal can re-point substitutes the member just as well.
 * `allowAncestorLinks` relaxes only the ancestry, for a caller that created
 * the directory itself and must tolerate `/tmp` resolving to `/private/tmp`.
 * That option does not prove ancestor-directory custody, and no measurement
 * here prevents the same principal from replacing a path after measurement.
 *
 * @module @aukora/activation/measure
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'

/** Named refusals for filesystem custody. Disjoint from the statement vocabulary. */
export const ACTIVATION_MEASURE_REFUSE = Object.freeze({
  PATH_NOT_ABSOLUTE: 'activation:path-not-absolute',
  PATH_SUBSTITUTED: 'activation:path-substituted',
  PATH_SYMLINK: 'activation:path-symlink',
  MEMBER_NOT_FILE: 'activation:closure-member-not-file',
  MEMBER_MUTABLE: 'activation:closure-member-mutable',
  MEMBER_DIGEST_MISMATCH: 'activation:closure-member-digest-mismatch',
  MEMBER_UNREADABLE: 'activation:closure-member-unreadable',
  MEMBER_NAME_INVALID: 'activation:closure-member-name-invalid',
})

/** Group- and world-writable bits. A member any other principal may rewrite is not a closure member. */
const MUTABLE_MODE_BITS = 0o022

/** A named activation-measurement refusal. */
export class ActivationMeasureError extends Error {
  /**
   * @param {string} reason - Stable refusal reason from `ACTIVATION_MEASURE_REFUSE`.
   * @param {string} detail - Human-readable detail.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'ActivationMeasureError'
    this.reason = reason
  }
}

/**
 * Measure one exact closure-member leaf and return its content digest.
 *
 * The member itself may never be a symbolic link, whatever the options say:
 * resolving a member before measuring it would measure whichever bytes the
 * link currently points at, which is the substitution this exists to refuse.
 *
 * `allowAncestorLinks` governs the DIRECTORY containing the member, not the
 * member. A launcher's runtime tree routinely sits under an ancestor link —
 * on macOS `/var` and `/tmp` both resolve elsewhere — so a caller that owns
 * the directory it created may canonicalize the ancestry and still have the
 * leaf checked in full. Without it the whole path must already be canonical.
 * The caller separately establishes who may replace ancestor directories and
 * whether the measured path remains selected at use time.
 *
 * @param {unknown} path - absolute normalized path to a regular file.
 * @param {{allowAncestorLinks?: boolean}} [options] - ancestry handling.
 * @returns {string} lowercase SHA-256 of the member's exact bytes.
 */
export function measureClosureMember(path, options = {}) {
  if (typeof path !== 'string' || path === '' || !isAbsolute(path)) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_NOT_ABSOLUTE, `closure member path must be absolute: ${String(path)}`)
  }
  if (normalize(path) !== path) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, `closure member path is not normalized: ${path}`)
  }
  let subject = path
  if (options.allowAncestorLinks === true) {
    try {
      subject = join(realpathSync(dirname(path)), basename(path))
    } catch (error) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_UNREADABLE, String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error))
    }
  }
  let entry
  try {
    entry = lstatSync(subject)
  } catch (error) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_UNREADABLE, String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error))
  }
  // Checked on the leaf itself, before any resolution of it. A member that is
  // a link is refused rather than followed.
  if (entry.isSymbolicLink()) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SYMLINK, `closure member is a symbolic link: ${subject}`)
  }
  if (!entry.isFile()) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_NOT_FILE, `closure member is not a regular file: ${subject}`)
  }
  if ((entry.mode & MUTABLE_MODE_BITS) !== 0) {
    throw new ActivationMeasureError(
      ACTIVATION_MEASURE_REFUSE.MEMBER_MUTABLE,
      `closure member mode ${(entry.mode & 0o7777).toString(8).padStart(4, '0')} is writable beyond its owner: ${subject}`,
    )
  }
  let resolved
  try {
    resolved = realpathSync(subject)
  } catch (error) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_UNREADABLE, String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error))
  }
  if (resolved !== subject) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, `closure member resolves to ${resolved}`)
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_UNREADABLE, 'O_NOFOLLOW is unavailable')
  }
  let descriptor
  try {
    descriptor = openSync(subject, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
    if (code === 'ELOOP') {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SYMLINK, `closure member became a symbolic link: ${subject}`)
    }
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_UNREADABLE, String(code ?? error))
  }
  try {
    const opened = fstatSync(descriptor)
    if (!opened.isFile()) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_NOT_FILE, `opened closure member is not a regular file: ${subject}`)
    }
    if (opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, `closure member changed before it was opened: ${subject}`)
    }
    if ((opened.mode & MUTABLE_MODE_BITS) !== 0) {
      throw new ActivationMeasureError(
        ACTIVATION_MEASURE_REFUSE.MEMBER_MUTABLE,
        `opened closure member mode ${(opened.mode & 0o7777).toString(8).padStart(4, '0')} is writable beyond its owner: ${subject}`,
      )
    }
    const digest = digestDescriptorExactly(descriptor, opened.size)
    const confirmation = digestDescriptorExactly(descriptor, opened.size)
    if (digest !== confirmation) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, `closure member bytes changed while they were measured: ${subject}`)
    }
    const after = lstatSync(subject)
    if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || realpathSync(subject) !== subject) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, `closure member changed while it was measured: ${subject}`)
    }
    return digest
  } catch (error) {
    if (error instanceof ActivationMeasureError) throw error
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_UNREADABLE, String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error))
  } finally {
    closeSync(descriptor)
  }
}

/** Hash one descriptor from byte zero with bounded memory and reject a concurrent size change. */
function digestDescriptorExactly(descriptor, size) {
  const digest = createHash('sha256')
  const bytes = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, size)))
  let offset = 0
  while (offset < size) {
    const wanted = Math.min(bytes.length, size - offset)
    const count = readSync(descriptor, bytes, 0, wanted, offset)
    if (count === 0) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, 'closure member shrank while it was measured')
    }
    digest.update(bytes.subarray(0, count))
    offset += count
  }
  if (readSync(descriptor, bytes, 0, 1, size) !== 0) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.PATH_SUBSTITUTED, 'closure member grew while it was measured')
  }
  return digest.digest('hex')
}

/**
 * Measure every named member into one closed digest manifest.
 *
 * A duplicate member name refuses rather than overwriting, so a manifest can
 * never silently name fewer members than its caller listed.
 *
 * @param {ReadonlyArray<{name: string, path: string}>} members - member names and absolute paths.
 * @param {{allowAncestorLinks?: boolean}} [options] - ancestry handling, applied to every member.
 * @returns {Readonly<Record<string, string>>} frozen name-to-digest manifest.
 */
export function measureDigestManifest(members, options = {}) {
  if (!Array.isArray(members)) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_NAME_INVALID, 'members must be an array')
  }
  /** @type {Record<string, string>} */
  const manifest = {}
  for (const member of members) {
    const name = member?.name
    if (typeof name !== 'string' || name === '') {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_NAME_INVALID, 'each member requires a non-empty name')
    }
    if (Object.hasOwn(manifest, name)) {
      throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_NAME_INVALID, `duplicate closure member name: ${name}`)
    }
    manifest[name] = measureClosureMember(member?.path, options)
  }
  return Object.freeze(manifest)
}

/**
 * Measure every named member and require the filesystem bytes to match an
 * independently derived digest for that member.
 *
 * This is used when a selector already enumerated a source graph. Re-reading
 * every selected path prevents a stale graph record from standing in for the
 * bytes the launcher will actually execute.
 *
 * @param {ReadonlyArray<{name: string, path: string, sha256: string}>} members - selected members and expected digests.
 * @param {{allowAncestorLinks?: boolean}} [options] - ancestry handling, applied to every member.
 * @returns {Readonly<Record<string, string>>} frozen name-to-measured-digest manifest.
 */
export function measureVerifiedDigestManifest(members, options = {}) {
  if (!Array.isArray(members)) {
    throw new ActivationMeasureError(ACTIVATION_MEASURE_REFUSE.MEMBER_NAME_INVALID, 'members must be an array')
  }
  /** @type {Record<string, string>} */
  const manifest = {}
  for (const member of members) {
    const name = member?.name
    if (typeof name !== 'string' || name === '' || Object.hasOwn(manifest, name)) {
      throw new ActivationMeasureError(
        ACTIVATION_MEASURE_REFUSE.MEMBER_NAME_INVALID,
        typeof name === 'string' && name !== '' ? `duplicate closure member name: ${name}` : 'each member requires a non-empty name',
      )
    }
    const measured = measureClosureMember(member?.path, options)
    if (typeof member?.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(member.sha256)
      || measured !== member.sha256) {
      throw new ActivationMeasureError(
        ACTIVATION_MEASURE_REFUSE.MEMBER_DIGEST_MISMATCH,
        `closure member does not match its selected digest: ${name}`,
      )
    }
    manifest[name] = measured
  }
  return Object.freeze(manifest)
}
