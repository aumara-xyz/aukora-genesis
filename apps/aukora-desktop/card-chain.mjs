/**
 * card-chain.mjs — THE RECORD OF AN APPROVAL, IN A FORM THAT CANNOT BE EDITED QUIETLY.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────────
 *
 * The tap-to-send card makes Peter's approval A SNAPSHOT: a nonce, a digest of the exact text, a press.
 * What proves it afterwards is a record. So every CONFIRMED or DECLINED card becomes ONE ENTRY IN A HASH
 * CHAIN, the same doctrine as the Aura chain — each entry carries the hash of the one before it.
 *
 * ── WHAT IT CHANGES, AND WHY EACH IS A DEFECT AND NOT A FEATURE ──────────────────────────────────
 *
 * * **A FLIPPED BYTE IS A BREAK, NOT A DIFFERENT VALUE.** Without the chain, editing `action` from
 *   `declined` to `confirmed` leaves a perfectly readable ledger line.
 * * **A REMOVED ENTRY IS INCOMPLETE, NOT A SHORTER LEDGER.** A reader that reports only what it managed
 *   to read **describes a ledger it cannot see the hole in** — the same fault as the Python verifier
 *   skipping a record it could not parse.
 * * **A TORN TAIL IS REFUSED BY NAME.** A write cut off mid-line is not a gap: nothing is missing from the
 *   middle, the LAST thing written simply did not finish, and the two get different names because they
 *   mean different things about the file.
 *
 * ── AND THE TEXT IS NEVER WRITTEN ────────────────────────────────────────────────────────────────
 *
 * The register holds the bound text for the card's own lifetime. This file holds **only its digest**.
 * "What was shown" and "what was recorded" are different stores on purpose, and a ledger carrying the
 * message would be A SECOND COPY OF PETER'S WORDS ON DISK.
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { durableAppend } from '../../plugins/aukora-kira/lib/strict-read.mjs'

/** The hash the first entry chains to: no predecessor, said as sixty-four zeros. */
export const GENESIS = '0'.repeat(64)

/**
 * The ledger's mode. **ESTABLISHED, NOT REQUESTED** — a `mode` on a write is masked by the umask and
 * ignored for a file that already exists, which this lane has already been bitten by once.
 */
export const LEDGER_MODE = 0o600

/** The named refusals. A caller must be able to tell these three apart. */
export const CHAIN_GAP = 'card-chain/gap'
export const CHAIN_BROKEN = 'card-chain/broken'
export const CHAIN_TORN = 'card-chain/torn-tail'
/**
 * ── COMPLETENESS IS A CLAIM THE LEDGER CANNOT MAKE ABOUT ITSELF ─────────────────────────────────
 *
 * **A PREFIX OF A VALID CHAIN IS A VALID CHAIN — that is what a hash chain is FOR.** So a ledger that has
 * lost its tail verifies perfectly: every link real, every hash correct, every sequence in order. The file
 * can never notice that it is short. **The count has to come from OUTSIDE the thing being counted.**
 */
export const CHAIN_INCOMPLETE = 'card-chain/incomplete'
export const CHAIN_UNEXPECTED_HEAD = 'card-chain/unexpected-head'

/**
 * The fields an entry carries, IN THIS ORDER.
 *
 * FIXED AND ORDERED, because the hash is over them: a canonical form that depended on insertion order
 * would let two writers produce the same entry under two hashes, **and a chain that cannot agree with
 * itself is not a chain.**
 */
export const ENTRY_FIELDS = Object.freeze([
  'seq', 'prevHash', 'lane', 'kind', 'digest', 'action', 'time', 'sender', 'nonceHash',
])

/** The canonical bytes an entry's hash is taken over — the fields, in order, and NOT the hash itself. */
function canonicalBytes(entry) {
  const ordered = {}
  for (const field of ENTRY_FIELDS) ordered[field] = entry[field] ?? null
  return Buffer.from(JSON.stringify(ordered), 'utf8')
}

/**
 * The hash of one entry.
 *
 * Over the FIELDS and not over the serialized line, so a reordered key or a different separator cannot
 * change the hash; and NOT over `hash` itself, which would be circular.
 */
export function entryHash(entry) {
  return createHash('sha256').update(canonicalBytes(entry)).digest('hex')
}

/** The hash a successor must carry, which is the whole entry's hash. */
export function headHash(entries) {
  return entries.length === 0 ? GENESIS : entries[entries.length - 1].hash
}

/**
 * Append one card, durably.
 *
 * `durableAppend` is Kira's: same-directory temp, fsync, rename, fsync the directory. **The mode is 0600
 * and it is ESTABLISHED rather than requested** — a `mode` on a write is masked by the umask and ignored
 * for a file that already exists, which this lane has already been bitten by once.
 *
 * @returns {{seq: number, hash: string}} the entry's own facts, so a caller can chain the next one.
 */
export function appendCard(path, entry) {
  const hash = entryHash(entry)
  const line = `${JSON.stringify({ ...pick(entry), hash })}\n`
  // `dir` IS REQUIRED BY `durableAppend` AND IS THE WHOLE POINT OF IT: the temp file is written INTO THE
  // SAME DIRECTORY as the target, so the rename that publishes it is atomic on that filesystem. Omitting it
  // is not a smaller write, it is a broken one — measured as `The "path" argument must be of type string`.
  durableAppend(path, line, { dir: dirname(path), mode: LEDGER_MODE })
  return { seq: entry.seq, hash }
}

function pick(entry) {
  const out = {}
  for (const field of ENTRY_FIELDS) out[field] = entry[field] ?? null
  return out
}

/**
 * Read the chain, refusing a torn tail BY NAME.
 *
 * **THE LAST LINE IS THE ONE THAT CAN BE TORN**, because appends only ever add at the end: a write cut off
 * mid-line leaves a partial final line and every line before it is intact. That is why a torn tail is not
 * a gap — nothing is missing from the middle, the last thing written did not finish.
 */
export function readChain(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, entries: [], empty: true }
    return { ok: false, code: CHAIN_TORN, reason: `${path} could not be read (${error?.code ?? error})` }
  }
  if (raw.length === 0) return { ok: true, entries: [], empty: true }
  const lines = raw.split('\n')
  // A TRAILING NEWLINE IS NORMAL — every append ends with one — so an empty last element is the file being
  // well-formed, not a torn line.
  if (lines[lines.length - 1] === '') lines.pop()
  const entries = []
  for (let index = 0; index < lines.length; index += 1) {
    try {
      entries.push(JSON.parse(lines[index]))
    } catch {
      const isLast = index === lines.length - 1
      return {
        ok: false,
        code: CHAIN_TORN,
        reason: isLast
          ? `the last line of ${path} is torn: it was cut off mid-write and cannot be parsed`
          : `line ${index + 1} of ${path} is not JSON; only the LAST line can be torn, so this is damage`,
        line: index + 1,
        torn: isLast,
      }
    }
  }
  return { ok: true, entries }
}

/**
 * Verify the chain: every seq in order from 1, and every entry chaining to its predecessor's hash.
 *
 * **THE ORDER OF THE TWO CHECKS IS THE ORDER OF THE TWO DEFECTS.** A missing entry shows up as a SEQ that
 * skipped, and an edited entry shows up as a HASH that does not match. Reporting a gap as "broken" would
 * send a reader looking for tampering when a line is simply gone.
 */
export function verifyChain(entries, expected = null) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const expectedSeq = index + 1
    if (entry.seq !== expectedSeq) {
      // ── A GAP AND A REORDER ARE DIFFERENT DEFECTS AND GET DIFFERENT NAMES ────────────────────────
      // A SEQ OUT OF PLACE HAS TWO CAUSES AND THEY CALL FOR DIFFERENT RESPONSES. **If the seq that
      // SHOULD be here appears LATER IN THE FILE, nothing is missing — the entries are DISORDERED, and
      // somebody has been editing.** If it appears NOWHERE, an entry is GONE and the answer is to go and
      // find it. **A reader told "an entry is missing" would go looking for a lost line that is sitting
      // right there, in the wrong place** — a refusal that describes the wrong defect.
      //
      // MEASURED: swapping entries 2 and 3 was reported as `card-chain/gap`, which is exactly that fault.
      const appearsLater = entries.slice(index + 1).some(other => other.seq === expectedSeq)
      if (appearsLater) {
        return { ok: false, code: CHAIN_BROKEN, seq: entry.seq ?? null, index, expected: expectedSeq,
          reason: `entry ${index + 1} is seq ${JSON.stringify(entry.seq)} where the chain expects `
            + `${expectedSeq}, and seq ${expectedSeq} appears LATER — the entries are OUT OF ORDER, `
            + 'not missing' }
      }
      return { ok: false, code: CHAIN_GAP, expected: expectedSeq, found: entry.seq ?? null, index,
        reason: `entry ${index + 1} is seq ${JSON.stringify(entry.seq)}; the chain expects ${expectedSeq}, `
          + 'which appears nowhere, so an entry is MISSING' }
    }
    const expectedPrev = index === 0 ? GENESIS : entries[index - 1].hash
    if (entry.prevHash !== expectedPrev) {
      return { ok: false, code: CHAIN_BROKEN, seq: entry.seq, index,
        reason: `entry ${entry.seq} chains to ${String(entry.prevHash).slice(0, 12)}… but its predecessor `
          + `hashes to ${String(expectedPrev).slice(0, 12)}…` }
    }
    if (entryHash(entry) !== entry.hash) {
      return { ok: false, code: CHAIN_BROKEN, seq: entry.seq, index,
        reason: `entry ${entry.seq} does not hash to the value it carries; its bytes were changed` }
    }
  }
  const head = headHash(entries)
  // ── AND THEN AGAINST THE TRUSTED EXPECTATION, IF ONE WAS SUPPLIED ──────────────────────────────
  // The chain checks above can only ever say "what is here is consistent". **THIS is the only check that
  // can say "what is here is ALL of it", because the number it compares against did not come from this
  // file.** With no expectation the behaviour is exactly as before, so no existing caller changes.
  if (expected !== null && typeof expected === 'object') {
    if (typeof expected.count === 'number' && entries.length !== expected.count) {
      return { ok: false, code: CHAIN_INCOMPLETE, expected: expected.count, found: entries.length,
        reason: `the ledger holds ${entries.length} of ${expected.count} entr(ies) the trusted record `
          + 'names: the entries present are correctly chained, WHICH IS NOT THE SAME AS THE LEDGER BEING '
          + 'COMPLETE' }
    }
    if (typeof expected.head === 'string' && head !== expected.head) {
      // **A WRONG HEAD IS NOT A SHORT LEDGER.** One is missing entries; the other is a DIFFERENT ledger —
      // and they send a reader to different repairs, so they get different names.
      return { ok: false, code: CHAIN_UNEXPECTED_HEAD, expected: expected.head, found: head,
        reason: `the ledger's head is ${head} and the trusted record names ${expected.head}: this is not `
          + 'a shortened version of that ledger, it is a different one' }
    }
  }
  return { ok: true, length: entries.length, head }
}

/**
 * Where a digest appears, and what was decided about it.
 *
 * THIS IS THE STRANGER'S QUESTION: someone holding ONE goal text can compute its digest and ask whether
 * this record shows it confirmed, without being given anything else.
 *
 * @returns {{ok: true, seq: number, action: string, time: string}}
 *   or `{ok: false, code: 'card-chain/absent'}` — **ABSENT, WHICH IS NOT THE SAME AS DELETED.** This
 *   function can only say the digest is not in the entries it was handed; whether the ledger is COMPLETE
 *   is `verifyChain`'s answer, and a caller must ask both.
 */
export function findConfirmed(entries, digest) {
  for (const entry of entries) {
    if (entry.digest === digest) return { ok: true, seq: entry.seq, action: entry.action, time: entry.time }
  }
  return { ok: false, code: 'card-chain/absent', digest }
}

/** The ledger's mode on disk, or null when it does not exist. */
export function ledgerMode(path) {
  try {
    return statSync(path).mode & 0o777
  } catch {
    return null
  }
}
