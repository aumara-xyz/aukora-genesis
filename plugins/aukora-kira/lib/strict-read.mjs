/**
 * THE STRICT READ AND DURABLE WRITE BOUNDARY — LIFTED, NOT REINVENTED.
 *
 * WHY THIS FILE EXISTS. Kimi's AUKORA-37 R8/R9 review found that this repository's JSON reads and writes can
 * disagree with themselves: `JSON.parse` keeps the LAST of two identical keys, so a document that SHOWS one
 * value to a reader can SETTLE another; a read that follows a symlink reads bytes the check did not see; a FIFO
 * in a slot hangs the reader; a write that is not fsynced or not atomic leaves a file that is empty, torn, or
 * truncated after a kill — and a torn tail then throws a raw `SyntaxError` that names nothing. Each of those is
 * a hole with a name here.
 *
 * EVERY FUNCTION IS LIFTED FROM CODE THAT ALREADY EXISTS IN THIS REPOSITORY, DELIBERATELY:
 *   · `readJsonStrict` — the pattern from `public-evidence.mjs`'s parse path, including its depth-aware
 *     DUPLICATE-KEY SCANNER (`assertNoDuplicateKeys`), which walks the text with a stack rather than trusting
 *     `JSON.parse`.
 *   · `durableWrite` — `journal.mjs`'s write-temp-then-rename pattern.
 *   · `exclusiveCreate` — `journal.mjs`'s create-if-absent pattern (temp, fsync, LINK, and the loser reads what
 *     the winner wrote).
 *   · `writeAllSync` and `syncDirectory` — lifted from `boundary.mjs`, because the daemon imports FROM Kira and
 *     Kira must not import from the daemon: the dependency runs one way, so the primitives come with them.
 *
 * `writeAllSync` CARRIES ITS OWN HARD-WON RULE, kept verbatim in spirit: it REFUSES anything that is not a
 * string, Buffer or Uint8Array rather than coercing it. The version that did `Buffer.from(String(contents))`
 * turned a wrong argument into fifteen bytes of `"[object Object]"` — a silent garbage write where `writeSync`
 * would have raised. A durability helper that accepts anything is a durability helper that writes anything.
 *
 * THE REFUSALS ARE NAMED, AND THAT IS THE POINT: `json:duplicate-key`, `json:malformed` (including a `RangeError`
 * from nesting too deep) and `artifact:nonregular-file`. **ENOENT PASSES THROUGH UNTOUCHED**, because a missing
 * file is an ordinary answer that callers already handle; turning it into a refusal here would break every
 * caller's first-run path.
 *
 * @module @aukora/dsh-plugin-kira/strict-read
 */
import { chmodSync, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createZstdDecompress, zstdDecompressSync } from 'node:zlib'
import { constants as FS } from 'node:fs'

/**
 * APPEND ONE JOURNAL LINE, FSYNCED BEFORE THE CALLER IS TOLD IT LANDED. (Design §3.6: the journal is "append-only,
 * hash-chained and fsynced on every append".)
 *
 * WHY THE APPEND LIVES HERE rather than in the journal module: this file is the plugin's ONE audited I/O boundary
 * (Fable's ruling A), and a second module that could open the store for writing would be a second door onto it. The
 * journal module keeps what is pure — the entry shape, the chain, the reading of a damaged tail — and this keeps the
 * file descriptor.
 *
 * ONE LINE AT A TIME, AND NO NEWLINE IN THE LINE: a caller that could pass two lines could write an entry no reader
 * would verify, and a torn append is a state the design names rather than a state this function may create.
 *
 * @param {{file: string, line: string}} input
 * @returns {true} after fsync has returned — the promise is that a line reported appended survives a kill.
 */
/**
 * List the `.json` files in a directory INSIDE the boundary — the one place allowed to reach the filesystem.
 *
 * **ADDED BECAUSE A MODULE OF MINE BROKE THE RULE.** `kira-recall` (the boundary court) refused `memory-deps.mjs` by name:
 * *"the plugin reached outside its boundary: memory-deps.mjs: imports node:fs; memory-deps.mjs: imports node:path"*. The
 * dependency builder needed a directory listing and reached for `node:fs` itself, which is exactly the widening the boundary
 * exists to refuse — and it was refused by a court rather than by a reviewer, which is the point of having one.
 *
 * ABSENT IS NOT AN ERROR: a store that was never created has no files, and the caller distinguishes that from unreadable
 * itself, because "no memories" and "cannot read your memories" must never look the same to a client.
 * @param {string} dir - an absolute directory path.
 * @returns {string[]} the `.json` file names, sorted; `[]` when the directory does not exist.
 * @throws {StrictReadRefusal} when the directory exists and cannot be read.
 */
/**
 * Does this path exist? — asked INSIDE the boundary, so a module that may not import `node:fs` can still ask.
 *
 * Added for `memory-deps.mjs`, which must distinguish "the store was never created" (a true empty memory) from "the state
 * home does not exist" (a misconfiguration that must refuse). The distinction is the whole point of Fable's item (2).
 * @param {string} path - an absolute path.
 * @returns {boolean}
 */
/**
 * The non-empty lines of a file INSIDE the boundary, or `[]` when it does not exist.
 *
 * Added for the remembered tier: a receipt is the sha256 of the exact canonical event LINE, and the Aura chain is a file of
 * lines, so both need lines rather than parsed objects. `readJsonStrict` cannot serve either — one line of `aura.jsonl` is not
 * a document to parse, it is a line to hash and to append after.
 * @param {string} file - an absolute path inside the user's state directory.
 * @returns {string[]}
 */
/**
 * Create a directory INSIDE the boundary, with its parents.
 *
 * The store's first write needs `remembered/` to exist, and `durableWrite` deliberately does not create parents — a writer that
 * silently makes whatever path it is handed is a writer nobody can bound. So the creation is its own named act, here, where
 * the filesystem already lives.
 * @param {string} dir - an absolute path.
 * @returns {void}
 */
export function ensureDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

export function readLinesIfPresent(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new StrictReadRefusal(String(error?.code ?? 'unreadable'), `the file ${file} could not be read`)
  }
  return text.split('\n').filter(one => one.trim() !== '')
}

export function stateExists(path) {
  return existsSync(path)
}

export function listJsonFiles(dir) {
  try {
    return readdirSync(dir).filter(one => one.endsWith('.json')).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new StrictReadRefusal(String(error?.code ?? 'unreadable'), `the directory ${dir} could not be listed`)
  }
}

export function appendJournalLine({ file, line }) {
  if (typeof file !== 'string' || file === '') throw new Error('kira.read: a journal file is required')
  if (typeof line !== 'string' || line === '') throw new Error('kira.read: a journal line is required')
  if (line.includes('\n')) throw new Error('kira.read: one journal line at a time; a line carrying a newline is two entries and neither would verify')
  const fd = openSync(file, FS.O_APPEND | FS.O_CREAT | FS.O_WRONLY, 0o600)
  try {
    writeAllSync(fd, `${line}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return true
}

/** How long a writer waits for another process's lock before it refuses, and when a lock counts as abandoned. */
export const FILE_LOCK_WAIT_MS = 2000
export const FILE_LOCK_STALE_MS = 30000
export const FILE_LOCK_BUSY = 'lock:busy'
export const FILE_LOCK_UNAVAILABLE = 'lock:unavailable'

/** The locks this process holds now, with their depth, so a nested acquire runs inside the held lock instead of waiting on itself. */
const heldFileLocks = new Map()

/** Sleep this thread without spinning. Every locked region is synchronous, so there is no event loop work to yield to. */
function pauseMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms))
}

/**
 * ONE WRITER AT A TIME ON A SHARED LOG, ACROSS PROCESSES (2026-09-27, red team).
 *
 * Capture (the conversation hooks, `O_APPEND`) and settle (`appendAura`, copy-then-rename) both write `aura.jsonl` from
 * different processes. Each reads the head, then appends an entry that names it. Two of them interleaved write two entries
 * naming the same head, and a rename can drop a line another process appended to the replaced file. This lock serializes them.
 *
 * The lock is a file created `O_EXCL` beside the log (`<file>.lock`). A writer waits for it up to `FILE_LOCK_WAIT_MS`, then
 * refuses by name. A lock older than `FILE_LOCK_STALE_MS` (by mtime) is treated as abandoned by a killed process and taken
 * over. The inode is checked again just before the takeover so a fresh lock is not removed. Release happens in `finally`, and
 * only removes the lock this call created.
 *
 * The caller's region must be synchronous: the lock is released when the function returns.
 *
 * @param {string} file - the log being written; the lock is `${file}.lock`, and its directory must already exist.
 * @param {() => T} fn - the synchronous read-head-then-append region.
 * @param {{waitMs?: number, staleMs?: number}} [options]
 * @returns {T}
 * @template T
 */
export function withFileLock(file, fn, options = {}) {
  if (typeof file !== 'string' || file === '') throw new Error('kira.read: a file to lock is required')
  if (typeof fn !== 'function' || fn.constructor?.name === 'AsyncFunction') {
    throw new Error('kira.read: withFileLock runs a synchronous function; an async one would outlive its lock')
  }
  const lockPath = `${file}.lock`
  // RE-ENTRANT IN THIS PROCESS: settle holds the lock from its preflight to its append, and `appendAura` inside it takes the
  // same lock. The region is synchronous, so nothing else in this process can run inside it while it is held.
  const depth = heldFileLocks.get(lockPath)
  if (depth !== undefined) {
    heldFileLocks.set(lockPath, depth + 1)
    try {
      return fn()
    } finally {
      heldFileLocks.set(lockPath, heldFileLocks.get(lockPath) - 1)
    }
  }
  const waitMs = Number.isFinite(options.waitMs) ? Number(options.waitMs) : FILE_LOCK_WAIT_MS
  const staleMs = Number.isFinite(options.staleMs) ? Number(options.staleMs) : FILE_LOCK_STALE_MS
  const deadline = Date.now() + waitMs
  let ours = null
  for (let attempt = 0; ours === null; attempt += 1) {
    let handle
    try {
      handle = openSync(lockPath, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new StrictReadRefusal(FILE_LOCK_UNAVAILABLE, `the lock ${lockPath} could not be created (${String(error?.code ?? 'unknown')})`)
      }
      let seen
      try {
        seen = lstatSync(lockPath)
      } catch (gone) {
        if (gone?.code === 'ENOENT') continue
        throw new StrictReadRefusal(FILE_LOCK_UNAVAILABLE, `the lock ${lockPath} could not be read (${String(gone?.code ?? 'unknown')})`)
      }
      if (Math.abs(Date.now() - seen.mtimeMs) > staleMs) {
        // ABANDONED: its holder was killed before its `finally` ran. Removed only if it is still the same file we judged stale.
        try {
          const again = lstatSync(lockPath)
          if (again.ino === seen.ino && again.mtimeMs === seen.mtimeMs) unlinkSync(lockPath)
        } catch (gone) {
          if (gone?.code !== 'ENOENT') {
            throw new StrictReadRefusal(FILE_LOCK_UNAVAILABLE, `the stale lock ${lockPath} could not be removed (${String(gone?.code ?? 'unknown')})`)
          }
        }
        continue
      }
      const left = deadline - Date.now()
      if (left <= 0) {
        throw new StrictReadRefusal(FILE_LOCK_BUSY, `${file} is being written by another process (its lock is held); refusing rather than writing beside it`)
      }
      pauseMs(Math.min(left, 10 + 5 * Math.min(attempt, 8)))
      continue
    }
    try {
      writeAllSync(handle, `${String(process.pid)}\n`)
      ours = fstatSync(handle).ino
    } catch (error) {
      try { unlinkSync(lockPath) } catch { /* nothing of ours left to remove */ }
      throw error
    } finally {
      closeSync(handle)
    }
  }
  heldFileLocks.set(lockPath, 1)
  try {
    return fn()
  } finally {
    heldFileLocks.delete(lockPath)
    try {
      if (lstatSync(lockPath).ino === ours) unlinkSync(lockPath)
    } catch { /* already gone, or taken over as stale: nothing of ours to release */ }
  }
}

/**
 * A NOTE OBJECT, WRITTEN DURABLY: temp file, fsync, rename. (The pattern this file already carries from `journal.mjs`.)
 *
 * WHY NOT A PLAIN `writeFileSync`: a note that is half-written when a process is killed is a note whose digest does not
 * match its own bytes, and the read path would call it DAMAGED — correctly, which is the problem: the store would be
 * reporting damage it inflicted. Rename is atomic within a directory, so a reader sees either the old note or the whole
 * new one, and the fsync is what makes that true across a crash rather than only across a signal.
 *
 * @param {{file: string, contents: string, mode?: number}} input
 * @returns {true} after the rename has returned.
 */
export function writeArtifact({ file, contents, mode = 0o600 }) {
  if (typeof file !== 'string' || file === '') throw new Error('kira.read: a file path is required')
  if (typeof contents !== 'string') throw new Error('kira.read: contents must be a string; a coerced argument writes garbage rather than raising')
  const temporary = `${file}.tmp-${randomBytes(6).toString('hex')}`
  const fd = openSync(temporary, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, mode)
  try {
    writeAllSync(fd, contents)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, file)
  return true
}

/** The three refusal names, exported so a caller and a court both spell them the same way. */
/** The largest artifact this reader will parse in one piece. */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024

export const DUPLICATE_KEY = 'json:duplicate-key'
export const MALFORMED = 'json:malformed'
// ── **TWO VALUES `JSON.parse` ACCEPTS AND THIS READER REFUSES (A37 distill)** ──────────────────────────────
//
// `JSON.parse` is not a safe reader for a value that will be COMPARED, SIGNED OR PINNED. Two of its outputs
// survive parsing and then mean something different to whoever reads them back:
//
//   * **AN UNSAFE INTEGER.** `JSON.parse('{"n":9007199254740993}')` gives `9007199254740992` — **the number is
//     silently changed**, so a ceiling, a count or a sequence number read here is not the number that was
//     written, and two different documents can compare equal.
//   * **A LONE SURROGATE.** `"\ud800"` is legal JSON and produces a string that is not valid UTF-8. It survives
//     hashing on some paths and is replaced on others, so **the same document has two digests** — which is
//     fatal for a reader whose whole purpose is that bytes and meaning stay tied together.
//
// *A parser that accepts what its callers cannot safely compare is a parser that moves the failure somewhere
// nobody is looking.* Both are refused BY NAME so a caller can tell them from malformed JSON.
export const UNSAFE_INTEGER = 'json:unsafe-integer'
export const LONE_SURROGATE = 'json:lone-surrogate'
export const NONREGULAR_FILE = 'artifact:nonregular-file'
export const ARTIFACT_TOO_LARGE = 'artifact:too-large'

/**
 * THE DEEPEST DOCUMENT THIS READER WILL PARSE.
 *
 * MEASURED, AND IT IS WHY THIS CONSTANT EXISTS: a document of 10 000 nested arrays does not produce a catchable
 * `RangeError` from `JSON.parse` in this runtime — it takes the process down, so no refusal is ever thrown and
 * the caller sees no answer at all. Catching the engine's overflow was never a protection; BOUNDING THE DEPTH
 * BEFORE PARSING IS. 512 is far past any document this store writes and far short of what overflows a stack.
 */
export const MAX_JSON_DEPTH = 512

/** A refusal that names itself. Never a raw SyntaxError, never a silent last-wins parse. */
export class StrictReadRefusal extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'StrictReadRefusal'
    this.code = code
  }
}

/**
 * WRITE EVERY BYTE, OR REFUSE. Lifted from `boundary.mjs:676`.
 *
 * It refuses rather than coercing, for the reason recorded there: coercing turns a wrong argument into a silent
 * garbage write, and the failure then looks like a successful write of the wrong thing.
 * @param {number} handle @param {string|Buffer|Uint8Array} contents
 */
export function writeAllSync(handle, contents) {
  const buffer = Buffer.isBuffer(contents)
    ? contents
    : (typeof contents === 'string' || contents instanceof Uint8Array
      ? Buffer.from(contents)
      : (() => {
          throw new TypeError('writeAllSync: contents must be a string, Buffer or Uint8Array, and this is '
            + `${contents === null ? 'null' : typeof contents}. Refusing rather than coercing it into bytes`)
        })())
  let written = 0
  while (written < buffer.length) {
    const step = writeSync(handle, buffer, written, buffer.length - written)
    if (step <= 0) throw new Error('writeAllSync: writeSync made no progress, so the file is incomplete')
    written += step
  }
}

/**
 * FSYNC A DIRECTORY, so a rename or a link inside it survives a kill. Lifted from `boundary.mjs:827`.
 * @param {string} path
 */
export function syncDirectory(path) {
  const handle = openSync(path, FS.O_RDONLY)
  try { fsyncSync(handle) } finally { closeSync(handle) }
}

/** The flags every strict read uses: no symlink, no blocking on a FIFO, read only. */
const READ_FLAGS = FS.O_RDONLY | FS.O_NONBLOCK | FS.O_NOFOLLOW

/**
 * The deepest nesting in a text, counted over the bytes rather than by parsing them. Quotes and escapes are
 * skipped so a brace inside a string is not counted — the same walk the duplicate scanner does, for the same
 * reason: it must see what the bytes contain.
 * @param {string} text @returns {number}
 */
export function deepestNesting(text) {
  let depth = 0
  let deepest = 0
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      index += 1
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue }
        if (text[index] === '"') break
        index += 1
      }
      index += 1
      continue
    }
    if (character === '{' || character === '[') { depth += 1; if (depth > deepest) deepest = depth; index += 1; continue }
    if (character === '}' || character === ']') { depth -= 1; index += 1; continue }
    index += 1
  }
  return deepest
}

/**
 * THE DEPTH-AWARE DUPLICATE-KEY SCANNER, LIFTED FROM public-evidence.mjs.
 *
 * `JSON.parse` keeps the last duplicate silently, so two readers of the same bytes can disagree while both
 * report success — the display/digest split Kimi measured. This walks the document once, tracking a stack of
 * objects/arrays, and refuses the FIRST repeated key inside one object. It reads the text as characters rather
 * than tree shapes on purpose: it must see what the bytes literally contain, including keys that a later parse
 * would discard.
 * @param {string} text @param {string} label
 */
export function assertNoDuplicateKeys(text, label) {
  const stack = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      const start = index
      index += 1
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue }
        if (text[index] === '"') break
        index += 1
      }
      const raw = text.slice(start + 1, index)
      index += 1
      let probe = index
      while (probe < text.length && /\s/u.test(text[probe])) probe += 1
      const frame = stack[stack.length - 1]
      if (text[probe] === ':' && frame !== undefined) {
        const key = /** @type {string} */ (JSON.parse(`"${raw}"`))
        if (frame.keys.has(key)) {
          throw new StrictReadRefusal(DUPLICATE_KEY,
            `${label} repeats the key \`${key}\` inside one object; JSON.parse keeps the last silently, `
            + 'so two readers of these bytes can disagree while both reporting success')
        }
        frame.keys.add(key)
      }
      continue
    }
    if (character === '{' || character === '[') { stack.push({ keys: new Set() }); index += 1; continue }
    if (character === '}' || character === ']') { stack.pop(); index += 1; continue }
    index += 1
  }
}

/**
 * READ ONE FILE STRICTLY AND RETURN ITS BYTES AND TEXT. The single open every other reader here is built on, so
 * there is ONE strict path rather than three that can drift apart.
 *
 * The checks are the protection, in this order: `O_NOFOLLOW` (a symlink is refused by the kernel), `O_NONBLOCK`
 * (a FIFO cannot hang the open), `fstat` THE DESCRIPTOR (so the check and the read are about the same file), read
 * from that same fd, and a FATAL UTF-8 decode (a lossy decode reads different bytes as one document).
 *
 * @param {string} path @param {{label?: string, maxBytes?: number, validateStat?: (stat: import('node:fs').Stats) => void}} [options]
 * @returns {{bytes: Buffer, text: string}}
 */
export function readBytesStrict(path, options = {}) {
  const label = options.label ?? path
  let handle
  try {
    handle = openSync(path, READ_FLAGS)
  } catch (error) {
    if (error?.code === 'ENOENT') throw error
    if (error?.code === 'ELOOP') {
      throw new StrictReadRefusal(NONREGULAR_FILE, `${label} is a symbolic link; a strict read refuses to follow it`)
    }
    throw new StrictReadRefusal(NONREGULAR_FILE, `${label} could not be opened strictly (${error?.code ?? 'unknown'})`)
  }
  try {
    const stat = fstatSync(handle)
    options.validateStat?.(stat)
    if (stat.isFile() !== true) {
      throw new StrictReadRefusal(NONREGULAR_FILE,
        `${label} is not a regular file (${stat.isDirectory() ? 'directory' : stat.isFIFO() ? 'fifo' : 'other'}); `
        + 'reading it would read something the check did not see')
    }
    // THE BOUND, TWICE, ON PURPOSE. `stat.size` catches an already-large file BEFORE a byte is read or allocated;
    // the running total below catches a file that GROWS while it is being read, which a size check alone cannot
    // see. Either way the refusal is a name, not an out-of-memory kill.
    const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_ARTIFACT_BYTES
    if (Number(stat.size) > maxBytes) {
      throw new StrictReadRefusal(ARTIFACT_TOO_LARGE,
        `${label} is ${String(stat.size)} bytes, past the ${String(maxBytes)} this reader will accumulate`)
    }
    const chunks = []
    let total = 0
    const buffer = Buffer.allocUnsafe(Math.max(4096, Math.min(Number(stat.size) + 1, 1 << 20)))
    for (;;) {
      const read = readSync(handle, buffer, 0, buffer.length, null)
      if (read <= 0) break
      total += read
      if (total > maxBytes) {
        throw new StrictReadRefusal(ARTIFACT_TOO_LARGE,
          `${label} grew past the ${String(maxBytes)} this reader will accumulate while it was being read`)
      }
      chunks.push(Buffer.from(buffer.subarray(0, read)))
    }
    const bytes = Buffer.concat(chunks)
    try {
      return { bytes, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    } catch {
      throw new StrictReadRefusal(MALFORMED, `${label} is not valid UTF-8; a lossy decode would read different bytes as one document`)
    }
  } finally {
    closeSync(handle)
  }
}

/**
 * THE TEXT OF A FILE, READ STRICTLY. For the NDJSON files — the aura chain and the queue — where each LINE is
 * parsed separately and the whole file is not one JSON document.
 * @param {string} path @param {{label?: string}} [options] @returns {string}
 */
export function readTextStrict(path, options = {}) {
  return readBytesStrict(path, options).text
}

/**
 * BOTH THE BYTES AND THE PARSED VALUE, from ONE strict read. The digest of a record is over its bytes while the
 * decision is about what they parse to, and taking those from two reads is exactly how a display and a digest
 * come apart.
 * @param {string} path @param {{label?: string}} [options] @returns {{bytes: Buffer, text: string, value: unknown}}
 */
export function readJsonStrictBytes(path, options = {}) {
  const label = options.label ?? path
  const { bytes, text } = readBytesStrict(path, options)
  return { bytes, text, value: parseStrictText(text, label) }
}

/** The parse half, shared: depth bound, JSON.parse with RangeError folded in, then the duplicate scan. */
/**
 * **AN INTEGER THIS READER CANNOT COMPARE SAFELY IS REFUSED, AT ANY DEPTH (A37 distill).**
 *
 * `JSON.parse('{"n":9007199254740993}')` yields `9007199254740992` — **the value is silently changed by the
 * parse**, so a ceiling, a count or a sequence number read here is not the number that was written, and two
 * different documents can compare equal. **FRACTIONAL NUMBERS ARE NOT REFUSED:** `1.5` is exactly representable
 * and round-trips, so the test is *an integer that is not a SAFE integer* rather than *a large number* — *a rule
 * that refuses more than the hazard is a rule that gets relaxed later.*
 *
 * THE WALK IS ITERATIVE AND BOUNDED BY THE SAME DEPTH THE PARSER ALREADY ENFORCED, so it cannot become the
 * unbounded recursion the depth bound exists to prevent.
 */
function refuseUnsafeIntegers(value, label) {
  const stack = [value]
  const seen = new Set()
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node === 'number') {
      if (Number.isInteger(node) && !Number.isSafeInteger(node)) {
        throw new StrictReadRefusal(UNSAFE_INTEGER,
          `${label} carries the integer ${String(node)}, which JSON.parse has already rounded past what can be `
          + 'compared exactly — two different documents could read as equal')
      }
      continue
    }
    if (typeof node === 'string') {
      // ── **THE SURROGATE THE TEXT SCAN CANNOT SEE (MEASURED)** ────────────────────────────────────────────
      //
      // The pre-parse scan above looks for REAL unpaired surrogates in the bytes, which is what a file written by
      // a broken encoder carries. **BUT THE COMMON CASE ARRIVES AS AN ESCAPE:** the text contains the six
      // characters `\ud800`, which are all perfectly valid UTF-8, and `JSON.parse` turns them into the lone
      // surrogate. MEASURED: `{"s":"\\ud800"}` was ACCEPTED by the text scan and is a lone surrogate in the
      // parsed value. *A check on the text cannot see a value the parser has not made yet* — so the parsed
      // strings are checked too, and the two checks cover different halves of one hazard.
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(node)) {
        throw new StrictReadRefusal(LONE_SURROGATE,
          `${label} carries an unpaired surrogate after parsing, which is legal JSON and not valid UTF-8 — the `
          + 'same document would hash two ways depending on who reads it')
      }
      continue
    }
    if (node === null || typeof node !== 'object') continue
    // A CYCLE IS IMPOSSIBLE FROM `JSON.parse`, BUT A SET KEEPS THE WALK TOTAL IF THIS IS EVER CALLED ON A VALUE
    // THAT DID NOT COME FROM ONE — the depth bound could not save a walk that revisited a node forever.
    if (seen.has(node)) continue
    seen.add(node)
    for (const child of Array.isArray(node) ? node : Object.values(node)) stack.push(child)
  }
}

export function parseStrictText(text, label) {
  // **THE LONE SURROGATE IS A PROPERTY OF THE TEXT, SO IT IS CHECKED BEFORE THE PARSE.** A high surrogate not
  // followed by a low one, or a low one not preceded by a high one, is `\uD800`-shaped damage that JSON accepts.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new StrictReadRefusal(LONE_SURROGATE,
      `${label} carries an unpaired surrogate, which is legal JSON and not valid UTF-8 — the same document would `
      + 'hash two ways depending on who reads it')
  }
  const depth = deepestNesting(text)
  if (depth > MAX_JSON_DEPTH) {
    throw new StrictReadRefusal(MALFORMED, `${label} nests ${String(depth)} deep, past the ${String(MAX_JSON_DEPTH)} this reader will parse`)
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    const kind = error instanceof RangeError ? 'nesting is too deep' : String(error?.message ?? error)
    throw new StrictReadRefusal(MALFORMED, `${label} is not JSON: ${kind}`)
  }
  assertNoDuplicateKeys(text, label)
  refuseUnsafeIntegers(value, label)
  return value
}

/**
 * READ ONE JSON DOCUMENT, STRICTLY, FROM ONE OPEN FILE DESCRIPTOR.
 *
 * THE ORDER IS THE PROTECTION, and every step earns its place:
 *   1. OPEN with `O_NOFOLLOW` — a symlink in the slot is refused by the kernel rather than followed.
 *   2. `O_NONBLOCK` — a FIFO in the slot cannot hang the reader while it opens.
 *   3. `fstat` THE DESCRIPTOR, not the path: the check and the read are then about the SAME file, so a swap
 *      between a check and a read cannot happen. A directory or a FIFO refuses by name.
 *   4. READ FROM THAT SAME DESCRIPTOR to EOF, so no second open can be pointed elsewhere.
 *   5. DECODE WITH `TextDecoder(fatal: true)` — invalid UTF-8 refuses instead of becoming U+FFFD, which is a
 *      lossy decode that makes two different byte strings read as one.
 *   6. `JSON.parse`, with `RangeError` folded into `json:malformed` — 10k-deep nesting is a malformed document,
 *      not a raw engine error.
 *   7. THEN the duplicate scan, on the same text that was parsed.
 *
 * @param {string} path @param {{label?: string}} [options]
 * @returns {unknown}
 */
export function readJsonStrict(path, options = {}) {
  const label = options.label ?? path
  // ── **THE OPTIONS TRAVEL, AND THEY DID NOT BEFORE (A37 distill)** ─────────────────────────────────────────
  //
  // MEASURED: this forwarded `{ label }` — an object built here — so **`maxBytes` was silently dropped** and a
  // caller asking for a 64 KiB cap got the 64 MiB default instead. `readJsonStrictBytes` above passes `options`
  // through and honours it, so the two siblings disagreed about the same argument: *one of them documented a
  // limit it did not apply.* A cap that is accepted and ignored is worse than no cap, because the caller stops
  // looking for another one.
  return parseStrictText(readBytesStrict(path, options).text, label)
}

/**
 * WRITE A FILE DURABLY, BY REPLACEMENT. Lifted from `journal.mjs:125-143`.
 *
 * A temporary created `O_EXCL|O_NOFOLLOW`, written, FSYNCED, then renamed over the target, then the DIRECTORY
 * is fsynced. The fsync before the rename is the one that matters: without it a crash can publish an EMPTY file
 * under the right name, which is worse than no file because every reader believes it.
 *
 * @param {string} target @param {string|Buffer|Uint8Array} contents
 * @param {{dir: string, mode?: number}} options
 */
export function durableWrite(target, contents, options) {
  const mode = options?.mode ?? 0o600
  const temporary = `${target}.tmp-${String(process.pid)}-${randomBytes(6).toString('hex')}`
  const handle = openSync(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, mode)
  try {
    writeAllSync(handle, contents)
    // THE BYTES ARE ON THE HANDLE, NOT IN THE FILE, UNTIL THIS LINE RUNS.
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  renameSync(temporary, target)
  // *** THE DIRECTORY DEFAULTS TO THE TARGET'S OWN. *** Every one of these read `options.dir` and threw inside itself when a
  // caller passed no options — a durability detail leaking into every call site as a crash whose message names a property
  // rather than an argument. The parent of the file being written is the directory that must be synced, so it is derived
  // here and a caller may still override it.
  syncDirectory(options?.dir ?? target.replace(/\/[^/]+$/u, ''))
}

/**
 * CREATE A FILE ONLY IF IT DOES NOT EXIST, DURABLY. Lifted from `journal.mjs:177-191`.
 *
 * `link` is the create that cannot clobber: the loser of a race gets `EEXIST` and reads what the winner wrote,
 * which is why this returns `{created}` rather than throwing. A plain `rename` here would have let two writers
 * both believe they had created the file while one of them silently replaced the other's bytes.
 *
 * @param {string} target @param {string|Buffer|Uint8Array} contents @param {{dir: string, mode?: number}} options
 * @returns {{created: boolean}}
 */
export function exclusiveCreate(target, contents, options) {
  const mode = options?.mode ?? 0o600
  const temporary = `${target}.tmp-${String(process.pid)}-${randomBytes(6).toString('hex')}`
  const handle = openSync(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, mode)
  try {
    writeAllSync(handle, contents)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  try {
    linkSync(temporary, target)
    unlinkSync(temporary)
  } catch (cause) {
    try { unlinkSync(temporary) } catch { /* already gone */ }
    if (cause?.code === 'EEXIST') {
      // THE RACE THIS FUNCTION IS NAMED FOR: the loser does not clobber and does not fail; it reports that the
      // file already existed, and the caller reads the winner's bytes.
      // *** THE DIRECTORY DEFAULTS TO THE TARGET'S OWN. *** Every one of these read `options.dir` and threw inside itself when a
  // caller passed no options — a durability detail leaking into every call site as a crash whose message names a property
  // rather than an argument. The parent of the file being written is the directory that must be synced, so it is derived
  // here and a caller may still override it.
  syncDirectory(options?.dir ?? target.replace(/\/[^/]+$/u, ''))
      return { created: false }
    }
    throw cause
  }
  // *** THE DIRECTORY DEFAULTS TO THE TARGET'S OWN. *** Every one of these read `options.dir` and threw inside itself when a
  // caller passed no options — a durability detail leaking into every call site as a crash whose message names a property
  // rather than an argument. The parent of the file being written is the directory that must be synced, so it is derived
  // here and a caller may still override it.
  syncDirectory(options?.dir ?? target.replace(/\/[^/]+$/u, ''))
  return { created: true }
}

/**
 * APPEND TO A FILE DURABLY: COPY, APPEND, FSYNC, REPLACE, DIRECTORY FSYNC.
 *
 * An append cannot be made atomic in place, so it is not attempted in place: the existing bytes are copied, the
 * addition is appended to the COPY, the copy is fsynced, and only then does it replace the original. A kill at
 * any point leaves either the old file or the new one — never a half-written line, which is the torn tail that
 * makes every later read throw.
 *
 * @param {string} target @param {string|Buffer|Uint8Array} addition
 * @param {{dir: string, mode?: number, readExisting?: (path: string) => Buffer}} options
 */
export function durableAppend(target, addition, options) {
  let existing = Buffer.alloc(0)
  try {
    existing = options.readExisting === undefined ? Buffer.from(readFileSync(target)) : options.readExisting(target)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const additionBuffer = Buffer.isBuffer(addition) ? addition : Buffer.from(addition)
  durableWrite(target, Buffer.concat([existing, additionBuffer]), options)
}
