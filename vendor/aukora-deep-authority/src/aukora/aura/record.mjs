/**
 * Aura — the record. The golden receipt chain.
 *
 * Every memory.put settlement appends one entry; each entry binds the
 * authorization tuple (requestDigest, definitionId, nonce, sequence), the
 * settlement receipt's digest, and the exact post-dispatch evidence —
 * including the content-addressed object location. The broker API never
 * overwrites a valid object: a later value for the same key creates a new
 * object and entry. The record-to-object walk therefore survives ordinary API
 * use. It is not immutable against the state-owning UID, which can replace
 * both object and record coherently.
 *
 * One entry is one line: `JSON.stringify` of `{hash, prev, ...fields}`. That
 * encoding is part of the protocol, not a formatting choice. The hash commits
 * to the entry's meaning under a key-sorted preimage, so verification also
 * requires each line to be exactly that encoding of the value it parses to;
 * without it, duplicate keys, padding, and non-canonical numbers change what a
 * reader sees while the entry still rehashes.
 *
 * WHY NOT kernel-seed/chain.mjs as the spine (measured, in-tree): its
 * `buildBody` field set is closed to the fence's own verdict fields; forks
 * with the same `prev` are legal by design (no total order); an unreadable
 * tail silently re-roots at genesis and is reported as a benign FORK; and the
 * 4096-byte line fit truncates `path` INSIDE the hashed body — the exact
 * field a record->location walk depends on. Those trades are correct for a
 * fence that must never hang; they are fatal for THE record.
 *
 * WHAT THIS IS NOT. A same-uid process can rewrite this file into a
 * self-consistent forgery. Hash-linking detects partial edits, not a coherent
 * rewrite with a recomputed chain or a valid suffix deletion. The local
 * sequence witness makes shortening inconsistent with that second file, but a
 * same-uid process can rewrite both. That limit is measured and kept by the
 * aura-record court (row R8). Detecting coherent rewrites needs a head anchor
 * outside this state directory, which does not exist yet.
 * The record is the broker's retained statement about what it settled and
 * authorizes nothing.
 *
 * @module @aukora/aura/record
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, openSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'

/** Domain separation: a record entry preimage can never collide with a grant or receipt preimage. */
export const RECORD_DOMAIN = 'aukora:aura-record:v1'

/** Canonical content-addressed object identity. */
const CONTENT_DIGEST_RE = /^[0-9a-f]{64}$/

/** Named refusals for chain verification. */
export const RECORD_REFUSE = Object.freeze({
  UNPARSEABLE: 'record:unparseable',
  CHAIN_NOT_CANONICAL: 'record:chain-not-canonical',
  RESERVED_FIELD: 'record:reserved-field',
  RESERVED_FIELD_ON_WIRE: 'record:reserved-field-on-wire',
  BROKEN_LINK: 'record:broken-link',
  TAMPERED: 'record:tampered',
  TRUNCATED: 'record:truncated',
  UNAVAILABLE: 'record:unavailable',
  LOCK_TIMEOUT: 'record:lock-timeout',
  LOCK_HANDLE_INVALID: 'record:lock-handle-invalid',
})

/**
 * Names the envelope and the preimage own. A body carrying one cannot mean what
 * it says, because the line would state a value the digest does not cover. The
 * writer refuses to emit one and the reader refuses to accept one; a chain
 * written by this module never carries them, so refusing costs no genuine
 * history.
 *
 * The two refusals name different events. `record:reserved-field` is raised on
 * a body the appending process assembled before it writes bytes; the reader
 * raises `record:reserved-field-on-wire` for the same names in chain bytes.
 * Neither mark is attributable: no signature binds a body to its producer.
 */
const RESERVED_ENTRY_NAMES = Object.freeze(['hash', 'prev', 'domain'])

/**
 * The hash of one entry: sha256 over the canonical body including the
 * predecessor. One line per entry; the hash of line N is inside the bytes
 * line N+1 hashes, so a change anywhere is visible at the head.
 *
 * @param {string} prevHash - the previous entry's hash, or the domain at genesis.
 * @param {Record<string, unknown>} fields - the entry body.
 * @returns {string} hex digest.
 */
export function entryHash(prevHash, fields) {
  // The domain is written after the spread so an entry body carrying its own
  // `domain` field cannot shadow the separator and bind the preimage to a
  // chain of its choosing. canonicalJSON sorts, so placement changes no digest
  // for a body without that field: every chain written before this holds.
  return createHash('sha256').update(canonicalJSON({ prev: prevHash, ...fields, domain: RECORD_DOMAIN }), 'utf8').digest('hex')
}

/**
 * Read the head of the chain: what a consumer needs to know without reading
 * the whole record.
 *
 * @param {string} file - the chain file.
 * @returns {{exists: boolean, count: number, lastChainHash: string | null}}
 */
export function readHead(file) {
  let state
  try {
    state = lstatSync(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, count: 0, lastChainHash: null }
    throw new Error(RECORD_REFUSE.UNAVAILABLE)
  }
  if (!state.isFile() || state.isSymbolicLink()) throw new Error(RECORD_REFUSE.UNAVAILABLE)
  const verified = readVerifiedChain(file)
  if (!verified.ok) throw new Error(verified.reason)
  return { exists: true, count: verified.count, lastChainHash: verified.lastChainHash }
}

/**
 * Handles this module issued and has not yet released. Membership is the
 * authentication: a caller cannot construct an object into a WeakSet, so no
 * field on the handle has to be trusted. A released handle is removed rather
 * than flagged, so a foreign handle and a stale one collapse into one refusal.
 */
const HELD_APPEND_LOCKS = new WeakSet()

/**
 * Take the append lock for one chain file and hold it until released.
 *
 * The lock is advisory between `appendEntry` callers and excludes nothing else:
 * every reader, court harness, recovery tool and same-uid editor can read and
 * write the chain while it is held. It is a per-chain-file lock, not broker
 * mutual exclusion.
 *
 * Acquisition blocks this thread for up to `attempts * spinMs`, and the wait is
 * invisible to a holder in this same address space: a second acquisition here
 * spins the whole budget against this process's own lock and then refuses.
 *
 * @param {string} file - the chain file whose lock is taken.
 * @param {object} [options] - acquisition budget.
 * @param {number} [options.attempts] - how many times to try the exclusive create.
 * @param {number} [options.spinMs] - how long to wait between attempts.
 * @returns {{file: string, lockPath: string, fd: number}} the held lock, to be passed to
 *   `releaseAppendLock` by the acquirer.
 * @throws {Error} `record:lock-timeout` when the path is held for the whole budget.
 */
export function acquireAppendLock(file, { attempts = 10, spinMs = 50 } = {}) {
  const lockPath = `${resolve(file)}.lock`
  let fd
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { fd = openSync(lockPath, 'wx', 0o600); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const spin = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, spinMs)
      if (spin === 'timed-out') continue
    }
  }
  if (fd === undefined) throw new Error(RECORD_REFUSE.LOCK_TIMEOUT)
  const lock = { file: resolve(file), lockPath, fd }
  HELD_APPEND_LOCKS.add(lock)
  return lock
}

/**
 * Release a held append lock.
 *
 * Total: it never throws. A release runs in a `finally` on a path whose verdict
 * has already been decided, and a throw there would rewrite that verdict — a
 * settled, recorded, verified effect must not be reported indeterminate because
 * a lock file could not be unlinked. It is idempotent, and it refuses to unlink
 * a lock path whose device and inode no longer match the descriptor it holds,
 * because that path is some other writer's live lock.
 *
 * A `released: false` result means the lock file is residue an operator must
 * resolve; the next acquisition refuses by name and says where.
 *
 * @param {{file: string, lockPath: string, fd: number}} lock - a lock this module issued.
 * @returns {{released: true} | {released: false, reason: string}} what happened.
 */
export function releaseAppendLock(lock) {
  if (lock === null || typeof lock !== 'object' || !HELD_APPEND_LOCKS.has(lock)) {
    return { released: false, reason: RECORD_REFUSE.LOCK_HANDLE_INVALID }
  }
  // Deleted first so every path below is idempotent under a second call.
  HELD_APPEND_LOCKS.delete(lock)
  let ours
  try {
    const open = fstatSync(lock.fd)
    const named = lstatSync(lock.lockPath)
    ours = open.dev === named.dev && open.ino === named.ino
  } catch (error) {
    try { closeSync(lock.fd) } catch { /* the descriptor is already gone; nothing else can use it */ }
    return { released: false, reason: String(error?.message ?? error) }
  }
  if (!ours) {
    try { closeSync(lock.fd) } catch { /* the descriptor is already gone; nothing else can use it */ }
    return { released: false, reason: 'record:lock-replaced' }
  }
  try {
    rmSync(lock.lockPath, { force: true })
  } catch (error) {
    try { closeSync(lock.fd) } catch { /* the descriptor is already gone; nothing else can use it */ }
    return { released: false, reason: String(error?.message ?? error) }
  }
  try {
    closeSync(lock.fd)
  } catch (error) {
    return { released: false, reason: String(error?.message ?? error) }
  }
  return { released: true }
}

/**
 * Require a lock this module issued, still held, for this exact chain file.
 *
 * @param {unknown} lock - the caller's handle.
 * @param {string} file - the chain file the append is for.
 * @returns {void}
 * @throws {Error} `record:lock-handle-invalid` naming which of the three cases applies.
 */
function assertHeldFor(lock, file) {
  if (lock === null || typeof lock !== 'object' || !HELD_APPEND_LOCKS.has(lock)) {
    throw new Error(`${RECORD_REFUSE.LOCK_HANDLE_INVALID} — not a lock this module issued and still holds`)
  }
  if (lock.lockPath !== `${resolve(file)}.lock`) {
    throw new Error(`${RECORD_REFUSE.LOCK_HANDLE_INVALID} — the lock is held for another chain file`)
  }
}

/**
 * Append one settlement entry.
 *
 * @param {object} params
 * @param {string} params.file - the chain file.
 * @param {Record<string, unknown>} [params.fields] - the entry body.
 * @param {(head: {count: number, lastChainHash: string | null}) => Record<string, unknown>} [params.buildFields] -
 *   build the body after the append lock has been acquired and the current
 *   head has been verified. Exactly one of `fields` and `buildFields` is
 *   required.
 * @param {(entry: {hash: string, prev: string, fields: Record<string, unknown>}) => void} [params.afterAppend] -
 *   update a local head witness before releasing the append lock. A failure is
 *   propagated after the entry exists, so the caller must report an
 *   indeterminate outcome.
 * @param {{file: string, lockPath: string, fd: number}} [params.lock] - a lock
 *   `acquireAppendLock` issued for this same `file`, still held by the caller.
 *   Supplying it skips acquisition AND release: the lock stays the caller's on
 *   the returning path and the throwing path alike. A handle for another file,
 *   an already-released handle, or an object this module did not issue refuses
 *   `record:lock-handle-invalid` before any byte is written.
 * @returns {{hash: string, prev: string}} the entry's hash and predecessor.
 */
export function appendEntry({ file, fields, buildFields, afterAppend, lock }) {
  if ((fields === undefined) === (buildFields === undefined)) {
    throw new TypeError('record: exactly one of fields and buildFields is required')
  }
  if (buildFields !== undefined && typeof buildFields !== 'function') {
    throw new TypeError('record: buildFields must be a function')
  }
  if (afterAppend !== undefined && typeof afterAppend !== 'function') {
    throw new TypeError('record: afterAppend must be a function')
  }
  // Serialize concurrent appends: two processes reading the same head and
  // appending produce duplicate prev links that permanently brick the chain.
  // A caller that must not begin work it cannot record supplies its own held
  // lock; this module then neither acquires nor releases, and the critical
  // section is the caller's to close.
  if (lock !== undefined) {
    assertHeldFor(lock, file)
    return _appendEntryLocked({ file, fields, buildFields, afterAppend })
  }
  const held = acquireAppendLock(file)
  try {
    return _appendEntryLocked({ file, fields, buildFields, afterAppend })
  } finally {
    releaseAppendLock(held)
  }
}

/**
 * Flush the directory entry a newly created record depends on.
 *
 * Flushing the file's own bytes makes their content durable; it does not make
 * the name durable. Until the parent directory is flushed the record can
 * survive as unreachable-by-name, which is indistinguishable from never having
 * been written by anything that opens it by path.
 *
 * @param {string} file - the chain file whose parent directory is flushed.
 * @returns {void}
 * @throws {Error} `record:unavailable` when the directory cannot be flushed.
 */
function syncParentDirectory(file) {
  let directory
  try {
    directory = openSync(dirname(file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    fsyncSync(directory)
  } catch (error) {
    throw new Error(error?.code === 'ELOOP' ? RECORD_REFUSE.UNAVAILABLE : String(error?.message ?? error))
  } finally {
    if (directory !== undefined) closeSync(directory)
  }
}

/** The real append logic, called under the lock. */
function _appendEntryLocked({ file, fields, buildFields, afterAppend }) {
  const head = readHead(file)
  const resolvedFields = buildFields === undefined
    ? fields
    : buildFields({ count: head.count, lastChainHash: head.lastChainHash })
  // `hash`, `prev`, and `domain` are the writer's and the preimage's own names.
  // A body carrying one cannot mean what it says: the line would state a value
  // the digest does not cover. Refuse rather than emit a field that lies.
  for (const reserved of RESERVED_ENTRY_NAMES) {
    if (Object.hasOwn(resolvedFields, reserved)) {
      throw new Error(`${RECORD_REFUSE.RESERVED_FIELD} — the entry body carries the reserved name ${reserved}`)
    }
  }
  const prev = head.lastChainHash ?? RECORD_DOMAIN
  const hash = entryHash(prev, resolvedFields)
  // Whether this append creates the file decides whether its directory entry
  // also has to be made durable; observe it before the O_CREAT open.
  const created = !existsSync(file)
  let descriptor
  try {
    descriptor = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600)
    if (!fstatSync(descriptor).isFile()) throw new Error(RECORD_REFUSE.UNAVAILABLE)
    writeFileSync(descriptor, `${JSON.stringify({ hash, prev, ...resolvedFields })}\n`, 'utf8')
    // The witness callback below lets the broker advance a sequence that claims
    // this entry is recorded. A write that is only in the page cache cannot
    // support that claim, so the bytes are flushed here, before the callback,
    // and a flush failure refuses the append instead of reaching it.
    fsyncSync(descriptor)
  } catch (error) {
    if (error?.message === RECORD_REFUSE.UNAVAILABLE) throw error
    throw new Error(error?.code === 'ELOOP' ? RECORD_REFUSE.UNAVAILABLE : String(error?.message ?? error))
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  // A first entry whose file contents are durable but whose directory entry is
  // not would leave the record unreachable by name, so the parent is flushed
  // too. Only the creating append pays this cost.
  if (created) syncParentDirectory(file)
  afterAppend?.({ hash, prev, fields: resolvedFields })
  return { hash, prev }
}

/**
 * Verify the chain: every line parses, every line is the writer's encoding of
 * the entry it parses to, every prev links, every hash recomputes.
 *
 * @param {string} file - the chain file.
 * @returns {{ok: true, count: number, lastChainHash: string | null} | {ok: false, reason: string, line: number}}
 */
export function verifyChain(file) {
  const result = readVerifiedChain(file)
  if (!result.ok) return result
  const { entries: _entries, ...verdict } = result
  return verdict
}

/**
 * Read the chain once through one file descriptor and verify those bytes.
 *
 * Opening before reading prevents reconstruction from verifying one pathname
 * value and replaying another after a rename. The same returned string is
 * verified and replayed. This does not prevent concurrent in-place writes.
 * `O_NOFOLLOW` also refuses a symbolic-link leaf on platforms that provide it.
 *
 * The file has exactly one terminal newline and no empty lines. Every content
 * line must re-serialize to itself under `JSON.stringify`, the writer's own
 * encoding, or it is `record:chain-not-canonical`. The check binds the bytes a
 * reader sees to the value the hash covers; it does not pin a field order,
 * because the body is caller-supplied and the preimage sorts keys anyway.
 *
 * @param {string} file - the chain file.
 * @returns {{ok: true, count: number, lastChainHash: string | null, entries: Array<Record<string, unknown>>} | {ok: false, reason: string, line: number}}
 */
export function readVerifiedChain(file) {
  let descriptor
  let raw
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    if (!fstatSync(descriptor).isFile()) return { ok: false, reason: RECORD_REFUSE.UNAVAILABLE, line: 0 }
    raw = readFileSync(descriptor, 'utf8')
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'ENOENT' ? RECORD_REFUSE.TRUNCATED : RECORD_REFUSE.UNAVAILABLE,
      line: 0,
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (raw !== '' && !raw.endsWith('\n')) return { ok: false, reason: RECORD_REFUSE.TRUNCATED, line: 0 }
  const lines = raw === '' ? [] : raw.slice(0, -1).split('\n')
  const blankLine = lines.indexOf('')
  if (blankLine !== -1) {
    return { ok: false, reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL, line: blankLine + 1 }
  }
  let prev = RECORD_DOMAIN
  let count = 0
  let lastChainHash = null
  const entries = []
  for (let i = 0; i < lines.length; i++) {
    let entry
    try { entry = JSON.parse(lines[i]) } catch { return { ok: false, reason: RECORD_REFUSE.UNPARSEABLE, line: i + 1 } }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: RECORD_REFUSE.UNPARSEABLE, line: i + 1 }
    }
    // The hash below covers the parse result, not these bytes: `JSON.parse`
    // keeps the last of two duplicate keys, so a line reading
    // `"verdict":"refused","verdict":"settled"` rehashes clean while a human
    // or any first-wins reader sees the decoy. Re-serializing under the
    // writer's own encoding makes the bytes and the hashed value one statement.
    if (JSON.stringify(entry) !== lines[i]) return { ok: false, reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL, line: i + 1 }
    const { hash, prev: link, ...fields } = entry
    // entryHash writes `domain` AFTER the body spread, so a `domain` key on the
    // wire is discarded before hashing: the stored hash, the chain, and an
    // external head all match a record that never carried it. That makes it the
    // one edit an anchored comparison cannot see, so the reader has to name it
    // here. Ordinary extra fields stay covered by the digest and fail below.
    if (RESERVED_ENTRY_NAMES.some((reserved) => Object.hasOwn(fields, reserved))) {
      return { ok: false, reason: RECORD_REFUSE.RESERVED_FIELD_ON_WIRE, line: i + 1 }
    }
    if (link !== prev) return { ok: false, reason: RECORD_REFUSE.BROKEN_LINK, line: i + 1 }
    if (entryHash(link, fields) !== hash) return { ok: false, reason: RECORD_REFUSE.TAMPERED, line: i + 1 }
    prev = hash
    lastChainHash = hash
    count++
    entries.push(entry)
  }
  return { ok: true, count, lastChainHash, entries }
}

/**
 * Parse the chain into entries, newest last. Callers walk this, never the raw file.
 *
 * @param {string} file - the chain file.
 * @returns {Array<Record<string, unknown>>}
 */
export function readEntries(file) {
  let state
  try {
    state = lstatSync(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new Error(RECORD_REFUSE.UNAVAILABLE)
  }
  if (!state.isFile() || state.isSymbolicLink()) throw new Error(RECORD_REFUSE.UNAVAILABLE)
  const verified = readVerifiedChain(file)
  if (!verified.ok) throw new Error(verified.reason)
  return verified.entries
}

/**
 * Compare the object store with the content digests named by Aura entries.
 *
 * The object directory is flat and content-addressed: a recorded digest owns
 * exactly `<digest>.json`. The comparison is bidirectional and byte-checked:
 * a regular object without a record entry is unexplained, a record entry
 * without its regular object is missing, and a correctly named file whose
 * bytes do not hash to that name is corrupt. Interrupted staging files,
 * non-regular entries, names outside the digest alphabet, and an invalid
 * objects path are retained and reported. This function never deletes evidence.
 *
 * @param {string} stateDir - the broker state directory containing `memory/objects`.
 * @param {Array<Record<string, unknown>>} entries - verified Aura entries.
 * @returns {{ok: true} | {ok: false, reason: string}} a deterministic inventory verdict.
 */
export function compareObjectInventory(stateDir, entries) {
  const objectsDir = join(stateDir, 'memory', 'objects')
  const expected = new Set()
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)
      || typeof entry.contentSha256 !== 'string' || !CONTENT_DIGEST_RE.test(entry.contentSha256)) {
      return { ok: false, reason: `object-inventory: invalid content digest at entry ${index + 1}` }
    }
    expected.add(`${entry.contentSha256}.json`)
  }

  let objectsStat
  try {
    objectsStat = lstatSync(objectsDir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missing = [...expected].sort()
      return missing.length === 0
        ? { ok: true }
        : { ok: false, reason: `object-inventory: mismatch ${JSON.stringify({ missing, unrecorded: [] })}` }
    }
    return { ok: false, reason: `object-inventory: unavailable (${String(error?.code ?? 'unknown')})` }
  }
  if (!objectsStat.isDirectory()) {
    return { ok: false, reason: 'object-inventory: unavailable (objects path is not a directory)' }
  }

  let directoryEntries
  try {
    directoryEntries = readdirSync(objectsDir, { withFileTypes: true })
  } catch (error) {
    return { ok: false, reason: `object-inventory: unavailable (${String(error?.code ?? 'unknown')})` }
  }
  const regular = new Set(directoryEntries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const missing = [...expected].filter((name) => !regular.has(name)).sort()
  const unrecorded = directoryEntries
    .filter((entry) => !entry.isFile() || !expected.has(entry.name))
    .map((entry) => entry.name)
    .sort()
  if (missing.length !== 0 || unrecorded.length !== 0) {
    return { ok: false, reason: `object-inventory: mismatch ${JSON.stringify({ missing, unrecorded })}` }
  }

  const corrupt = []
  for (const name of [...expected].sort()) {
    let descriptor
    try {
      descriptor = openSync(join(objectsDir, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      if (!fstatSync(descriptor).isFile()) throw new Error('wrong-type')
      const actual = createHash('sha256').update(readFileSync(descriptor)).digest('hex')
      if (`${actual}.json` !== name) corrupt.push(name)
    } catch {
      corrupt.push(name)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
  return corrupt.length === 0
    ? { ok: true }
    : { ok: false, reason: `object-inventory: content mismatch ${JSON.stringify(corrupt)}` }
}
