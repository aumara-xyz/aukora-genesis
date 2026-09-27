/**
 * WHERE THE LAST FEW CAPTURES LIVE: the plugin's own state directory, never the session log.
 *
 * A picture in the session log rides every later model request in that session, so the log keeps the
 * attachment REFERENCE and this directory keeps the bytes. The ring is per session and bounded: the
 * diff only ever needs the previous frame, and a person debugging a face needs the last few.
 *
 * THE SESSION ID IS A PATH COMPONENT, SO IT IS FENCED. A session id reaches this module from the
 * host, and a component containing `..` or a separator would write outside the directory the
 * composition named. Ids are reduced to a safe alphabet and hashed when that reduction would collide
 * or empty them, so two different sessions can never share one folder by accident.
 *
 * @module @aukora/dsh-plugin-eye/store
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** How many captures one session keeps. */
export const DEFAULT_KEEP = 5

/**
 * Reduce a session id to one safe path component.
 * @param sessionId - the id as the host spelled it.
 * @returns a component containing only `[a-z0-9._-]`, unique per input.
 */
export function safeComponent(sessionId) {
  const raw = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : 'anonymous'
  const reduced = raw.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^[.-]+/u, '').slice(0, 48)
  // The digest is appended rather than used alone, so a person reading the directory can still see
  // which session a folder belongs to while two ids that reduce identically cannot collide.
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 8)
  return `${reduced === '' ? 'session' : reduced}-${digest}`
}

/**
 * Open the capture ring for one deployment.
 *
 * @param options - the ring's location and size.
 * @param {string} options.dir - the state directory the composition named.
 * @param {number} [options.keep] - captures kept per session.
 * @param {() => number} [options.now] - clock, injected for tests.
 * @returns the ring: `record`, `list` and `prune`.
 */
export function createCaptureStore({ dir, keep = DEFAULT_KEEP, now = () => Date.now() }) {
  if (typeof dir !== 'string' || dir.length === 0) throw new Error('aukora-eye: stateDir must be a non-empty path')
  if (!Number.isInteger(keep) || keep < 1) throw new Error('aukora-eye: keep must be a positive integer')

  /** @returns the directory holding one session's captures. */
  const sessionDir = sessionId => join(dir, safeComponent(sessionId))

  /**
   * The session's index, newest last.
   * @param sessionId - the session.
   * @returns the recorded entries.
   */
  async function list(sessionId) {
    try {
      const text = await readFile(join(sessionDir(sessionId), 'index.json'), 'utf8')
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      // A missing index is an empty ring, which is the first call's normal state. Anything else is
      // reported: a corrupt index must not read as "no previous capture", which would silently drop
      // the diff a caller is about to be told about.
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  /**
   * Drop the oldest captures beyond the ring's bound.
   * @param sessionId - the session.
   * @returns the entries that remain.
   */
  async function prune(sessionId) {
    const entries = await list(sessionId)
    if (entries.length <= keep) return entries
    const dropped = entries.slice(0, entries.length - keep)
    const kept = entries.slice(entries.length - keep)
    for (const entry of dropped) {
      await rm(join(sessionDir(sessionId), entry.file), { force: true })
    }
    await writeFile(join(sessionDir(sessionId), 'index.json'), `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 })
    return kept
  }

  /**
   * Commit one capture and report what it replaced.
   * @param options - the capture.
   * @param {string} options.sessionId - the owning session.
   * @param {Uint8Array} options.png - the bytes to keep.
   * @param {object} options.meta - size, scale and timing recorded beside the bytes.
   * @returns the stored entry and the previous entry, when there was one.
   */
  async function record({ sessionId, png, meta }) {
    const folder = sessionDir(sessionId)
    await mkdir(folder, { recursive: true, mode: 0o700 })
    const entries = await list(sessionId)
    const previous = entries.at(-1)
    const stamp = new Date(now()).toISOString().replace(/[:.]/gu, '-')
    // A STAMP ALONE IS NOT A NAME. Two looks in the same millisecond would write one file, and the
    // ring would silently keep fewer captures than it says it does — measured: three records with a
    // fixed clock left two files. The suffix is what makes each capture its own.
    const file = `${stamp}-${randomBytes(3).toString('hex')}.png`
    await writeFile(join(folder, file), png, { mode: 0o600 })
    const entry = { file, capturedAt: new Date(now()).toISOString(), ...meta }
    await writeFile(join(folder, 'index.json'), `${JSON.stringify([...entries, entry], null, 2)}\n`, { mode: 0o600 })
    const kept = await prune(sessionId)
    return { entry, previous, kept: kept.length, path: join(folder, file), previousPath: previous === undefined ? null : join(folder, previous.file) }
  }

  /**
   * Read back the previous capture's bytes.
   * @param sessionId - the session.
   * @param file - the file name recorded in the index.
   * @returns the bytes, or null when they are gone.
   */
  async function read(sessionId, file) {
    try {
      return await readFile(join(sessionDir(sessionId), file))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  /** @returns every session folder under the ring, for a person looking at the disk. */
  async function sessions() {
    try {
      return await readdir(dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  return { record, list, prune, read, sessions, dir, keep }
}
