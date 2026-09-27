/**
 * THE WRITE-AHEAD JOURNAL — ONE FILE PER NONCE, AND THE ORDER OF WRITES IS THE WHOLE DESIGN.
 *
 * **CODEX P1 #5: CONSUMPTION HAPPENED BEFORE THE EFFECT.** MEASURED: `authoriseSettlement` spent the approval
 * and then the Kira write ran. A crash in between burned the approval with no effect, and nothing on disk could
 * tell anyone — so after a restart the approval was gone, the memory was never written, and the person had
 * authorised something that did not happen. The reverse order is no better: an effect that runs before the
 * approval is spent can be run TWICE by a restart.
 *
 * **SO THE STATE IS WRITTEN BEFORE EACH STEP, NOT AFTER IT**, and the file records which step was reached:
 *
 *     pending ──▶ effect-started ──▶ effect-done ──▶ receipt-written ──▶ spent
 *
 * A crash leaves the file at the last state that was made DURABLE, and the state names what is not known:
 *
 *   · `effect-started` and nothing further — **THE EFFECT IS UNCERTAIN.** It may or may not have landed. This
 *     daemon does not re-run it and does not pretend it did not happen: it reports the uncertain effect BY NAME
 *     and leaves the decision to a person. **Blindly re-running is how one approval writes two memories.**
 *   · `effect-done` without a receipt — the effect landed and the receipt was not finished, so the receipt is
 *     written on recovery. That step is idempotent, which is why it is a step of its own.
 *   · `spent` — stays spent across a restart, because it is on disk rather than in a `Set` in the heap.
 *
 * **EVERY WRITE IS `fsync`ED, AND SO IS THE DIRECTORY.** A rename that is not followed by a directory fsync can
 * be lost while the file it points at survives, which is exactly the state that makes recovery guess.
 */
import { readBoundaryFile } from './boundary.mjs'
import { assertNoDuplicateKeys } from '../../aukora-kira/lib/strict-read.mjs'

import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, opendirSync, openSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeSync, constants as FS } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
// **THE SHORT-WRITE LOOP COMES FROM ITS ONE IMPLEMENTATION** — for the same reason `syncDirectory` does.
import { writeAllSync } from './boundary.mjs'

/** The steps, in the order they may be written. A state only moves FORWARD. */
export const JOURNAL_STATE = Object.freeze({
  PENDING: 'pending',
  /**
   * **THE CONSUMPTION IS RECORDED OUTSIDE, AND THE EFFECT HAS NOT STARTED (aumlok-122).**
   *
   * It sits between `pending` and `effect-started` because that is the order the protocol requires, and the order
   * is the whole of the guarantee: **the witness is written BEFORE the effect.** Written after, a crash between
   * the effect and the record would leave an effect that happened and no witness of it — the same gap in a new
   * place. Writing it first means the failure mode is the safe one: a crash here leaves an id recorded that was
   * never spent, which refuses a retry that would have been legitimate. *Refusing a legitimate retry is
   * recoverable by a person; re-running an effect is not.*
   *
   * **IT IS ALSO THE MARKER THAT SAYS THE WITNESS WAS CONSULTED AT ALL** — so a journal stopped at `pending`
   * after a restart is a settlement that never reached the witness, and one stopped here is a settlement whose
   * consumption is already recorded and whose effect never ran.
   */
  WITNESS_RECORDED: 'witness-recorded',
  EFFECT_STARTED: 'effect-started',
  EFFECT_DONE: 'effect-done',
  RECEIPT_WRITTEN: 'receipt-written',
  SPENT: 'spent',
})

const ORDER = Object.freeze(Object.values(JOURNAL_STATE))

/** Every way the journal refuses or reports, by name. */
export const JOURNAL_REFUSE = Object.freeze({
  /** The effect may or may not have landed. NOT an error to retry. */
  EFFECT_UNCERTAIN: 'aukora-owner:effect-uncertain',
  /** The state file is not a state this journal wrote. */
  JOURNAL_CORRUPT: 'aukora-owner:journal-corrupt',
  /** A state was asked to move backwards. */
  JOURNAL_BACKWARDS: 'aukora-owner:journal-backwards',
  /** The crash hook was configured outside a court. */
  CRASH_HOOK_REFUSED: 'aukora-owner:crash-hook-refused',
  NONCE_NOT_RECORDED: 'aukora-owner:nonce-not-recorded',
})

const refuse = (code, message) => {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

/** fsync a directory, which is what makes a rename inside it durable. */
function syncDirectory(path) {
  const handle = openSync(path, FS.O_RDONLY)
  try { fsyncSync(handle) } finally { closeSync(handle) }
}

/**
 * THE CRASH HOOK, AND IT IS REFUSED UNLESS A COURT ASKED FOR IT.
 *
 * A hook that stops the process at a chosen step is the only way to test a recovery path honestly. **It is also
 * a way to stop a real daemon at a chosen step**, so it is read ONLY when `AUKORA_OWNER_COURTS=1` is also set:
 * one environment variable cannot arm it, and a production configuration carrying the hook refuses to start
 * rather than ignoring it. **A hook that is silently ignored is worse than one that is refused** — the operator
 * believes the daemon is normal and the court believes it is measuring.
 *
 * @param {Readonly<Record<string, string|undefined>>} env
 * @returns {(state: string) => void} called AFTER the state is durable.
 * @throws {Error} `aukora-owner:crash-hook-refused`.
 */
export function crashHook(env) {
  const at = env.AUKORA_OWNER_CRASH_AT
  if (at === undefined || at === '') return () => {}
  if (env.AUKORA_OWNER_COURTS !== '1') {
    throw refuse(JOURNAL_REFUSE.CRASH_HOOK_REFUSED,
      'AUKORA_OWNER_CRASH_AT is set and AUKORA_OWNER_COURTS is not, so this process would stop itself at a '
      + `chosen step (${at}) in a configuration nobody declared as a court. Refusing to start rather than `
      + 'ignoring it: a hook that is silently dropped leaves the operator believing the daemon is normal')
  }
  if (!ORDER.includes(at)) {
    throw refuse(JOURNAL_REFUSE.CRASH_HOOK_REFUSED,
      `AUKORA_OWNER_CRASH_AT is ${JSON.stringify(at)}, which is not one of ${ORDER.join(', ')}`)
  }
  return state => {
    if (state === at) {
      // A HARD STOP, IMMEDIATELY AFTER THE STATE IS DURABLE — no unwinding, no cleanup. A graceful exit would
      // run `finally` blocks and flush what a crash does not, and the recovery path would never be exercised.
      process.kill(process.pid, 'SIGKILL')
    }
  }
}

/**
 * The journal. One JSON file per nonce, each write atomic and durable.
 *
 * @param {Readonly<{ownerDir: string, crashAt?: (state: string) => void, log?: Function}>} input
 */
export function createJournal(input) {
  const dir = join(input.ownerDir, 'journal')
  const log = input.log ?? (() => {})
  const crashAt = input.crashAt ?? (() => {})
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700 })
    // THE DIRECTORY ITSELF IS MADE DURABLE, or a crash can lose the whole journal while the key survives.
    syncDirectory(input.ownerDir)
  }
  const pathFor = nonce => join(dir, `${encodeURIComponent(String(nonce))}.json`)

  /**
   * Write one state, atomically: a temporary file that is fsynced, a rename over the target, and a DIRECTORY
   * fsync. **The rename is what makes the file either wholly the old state or wholly the new one**, and the
   * directory fsync is what makes the rename itself survive.
   */
  const writeState = (nonce, state, extra) => {
    const record = Object.freeze({
      nonce: String(nonce), state, at: Math.floor(Date.now() / 1000), ...(extra ?? {}),
    })
    const target = pathFor(nonce)
    const temporary = `${target}.tmp-${String(process.pid)}`
    // O_EXCL ON THE TEMPORARY: a leftover temporary from a crashed run must never be appended to.
    const handle = openSync(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600)
    try {
      writeAllSync(handle, `${JSON.stringify(record)}\n`)
      // THE FILE IS DURABLE BEFORE THE RENAME, or the rename can publish an empty file after a crash.
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, target)
    syncDirectory(dir)
    // AND ONLY NOW may a court stop the process: the state is on disk, so recovery sees it.
    crashAt(state)
    log(`journal ${String(nonce).slice(0, 12)}… ${state}`)
    return record
  }

  return Object.freeze({
    dir: () => dir,
    /**
     * Record that a nonce's approval was accepted, BEFORE any effect runs.
     *
     * **`O_EXCL` HERE IS THE IDEMPOTENCE.** Two settlements racing on one nonce cannot both create the entry;
     * the loser gets `EEXIST` and is refused, so a nonce is recorded exactly once however many callers try.
     */
    begin(nonce, extra) {
      const target = pathFor(nonce)
      if (existsSync(target)) {
        // ALREADY RECORDED. The caller must read it rather than start again — that is what makes settlement
        // idempotent by nonce across a restart.
        return this.read(nonce)
      }
      const record = Object.freeze({
        nonce: String(nonce), state: JOURNAL_STATE.PENDING, at: Math.floor(Date.now() / 1000), ...(extra ?? {}),
      })
      // ── THE RECORD IS BUILT SOMEWHERE ELSE AND MOVED INTO PLACE (CODEX R4 ITEM 4) ───────────────
      //
      // **`O_EXCL` MADE THE NAME, AND THE NAME WAS EMPTY UNTIL `writeSync` RAN.** A crash in that window left a
      // ZERO-LENGTH journal file at a nonce's path. `read` parses it as JSON and throws, so the next start
      // **cannot finish a settlement the effect had already landed** — the one case the journal exists to make
      // recoverable, turned into a file that blocks restart. `advance` below already writes this way; `begin`,
      // the FIRST write of every settlement, did not.
      //
      // **`linkSync` KEEPS THE EXCLUSIVITY THAT `O_EXCL` PROVIDED AND THAT `renameSync` WOULD DESTROY.**
      // `rename` replaces silently, so a racer would overwrite the winner's record; `link` fails with `EEXIST`,
      // in the kernel, atomically — and only once the contents are durable.
      const temporary = `${target}.tmp-${String(process.pid)}-${randomBytes(6).toString('hex')}`
      const handle = openSync(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600)
      try {
        writeAllSync(handle, `${JSON.stringify(record)}\n`)
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
      try {
        linkSync(temporary, target)
        unlinkSync(temporary)
      } catch (cause) {
        try { unlinkSync(temporary) } catch { /* already gone */ }
        // **THE RACE THIS FUNCTION IS NAMED FOR.** Two settlements on one nonce cannot both create the entry;
        // the loser reads what the winner wrote, which is the same answer the pre-check above returns.
        if (cause?.code === 'EEXIST') return this.read(nonce)
        throw cause
      }
      syncDirectory(dir)
      crashAt(JOURNAL_STATE.PENDING)
      return record
    },
    /**
     * Move one nonce FORWARD. A backwards or repeated move is refused rather than ignored: a state that can go
     * back is a state that cannot be trusted after a crash.
     */
    advance(nonce, state, extra) {
      const current = this.read(nonce)
      if (current === null) {
        throw refuse(JOURNAL_REFUSE.NONCE_NOT_RECORDED,
          `nonce ${String(nonce).slice(0, 12)}… has no journal entry, so there is nothing to advance`)
      }
      if (ORDER.indexOf(state) <= ORDER.indexOf(current.state)) {
        throw refuse(JOURNAL_REFUSE.JOURNAL_BACKWARDS,
          `${String(nonce).slice(0, 12)}… is at ${current.state} and ${state} is not after it`)
      }
      const merged = { ...current, ...(extra ?? {}), state }
      // ── **THE CONVERSATION BYTES ARE DROPPED WHEN THEY STOP BEING NEEDED (AUMLOK-114)** ────────────────
      //
      // THE GAP (egress audit, gap 13): `journal.begin` stores `bytes: proposal.bytes.toString('utf8')` —
      // **the frozen text the owner was shown**, kept FOREVER, one file per nonce, in a directory that outlives
      // the settlement. So the owner's journal accumulates conversation content indefinitely.
      //
      // **WHY DIGESTS AND NOT BOUNDED RETENTION.** The obvious alternative is to prune old records, and it is
      // WRONG HERE: `isSpent` is how a REPLAYED approval is refused (`:309` says so in capitals), so a pruned
      // `spent` record is a replay that succeeds. **The retention cannot be shortened, so the CONTENT must be.**
      //
      // **AND THE BYTES ARE ONLY NEEDED UNTIL THE EFFECT LANDS.** Between `pending` and `effect-done` the
      // record IS the restorable proposal — a digest cannot hand a grant back, which is why `bytes` exists at
      // all. **From `spent` onward the effect is durable, the proposal has been performed, and nothing reads
      // the text again**: what the record still owes is proof that this nonce was used, and a digest proves
      // that as well as the text does.
      //
      // SO THE TEXT IS REPLACED BY ITS DIGEST AND LENGTH AT THE ONE TRANSITION WHERE IT STOPS MATTERING, and
      // the replacement is RECORDED RATHER THAN SILENT: `bytesDropped` says a reader is looking at a summary
      // and `bytesLength` says how much is not there.
      if (merged.state === JOURNAL_STATE.SPENT && typeof merged.bytes === 'string') {
        merged.bytesDigest = createHash('sha256').update(merged.bytes, 'utf8').digest('hex')
        merged.bytesLength = merged.bytes.length
        merged.bytesDropped = 'the effect landed, so the text is no longer needed to restore the proposal; '
          + 'the digest above still proves which bytes this nonce spent'
        delete merged.bytes
      }
      return writeState(nonce, state, merged)
    },
    read(nonce) {
      const target = pathFor(nonce)
      // **ONE LOOKUP (AUMLOK-92 ITEM 3).** MEASURED: this did `existsSync(target)` and then
      // `readFileSync(target, 'utf8')` — **two lookups of one name**, so the existence check and the bytes
      // could describe different files. `readBoundaryFile` opens ONCE and reads from that descriptor, and it
      // also refuses a symlink, a directory and a FIFO by name — none of which the old pair did.
      let bytes
      try {
        bytes = readBoundaryFile(target)
      } catch (cause) {
        // A journal entry that is not there is not an error; the caller is told there is none. Everything
        // else — a directory, a FIFO, a symlink, an unreadable file — is real and is refused by its own name.
        if (cause?.code === 'ENOENT') return null
        throw cause
      }
      let parsed = null
      try {
        // **AND THE BYTES ARE SCANNED BEFORE THEY ARE PARSED.** `JSON.parse` keeps the last duplicate key
        // silently, so an entry carrying `state` twice means two things and the reader that decides is
        // whichever parsed last.
        const text = bytes.toString('utf8')
        assertNoDuplicateKeys(text, target)
        parsed = JSON.parse(text)
      } catch (cause) {
        throw refuse(JOURNAL_REFUSE.JOURNAL_CORRUPT,
          `${target} is not readable JSON: ${String(cause?.message ?? cause)}`)
      }
      if (parsed === null || typeof parsed !== 'object' || !ORDER.includes(parsed.state)) {
        throw refuse(JOURNAL_REFUSE.JOURNAL_CORRUPT, `${target} carries no state this journal writes`)
      }
      return Object.freeze(parsed)
    },
    /**
     * Every record, ONE AT A TIME, for callers that only need to look at each in turn.
     *
     * **WHY THIS IS A GENERATOR AND NOT `entries()`.** `entries()` builds and SORTS the complete history —
     * correct for a listing, wrong for recovery, which was doing exactly that to count records it will never
     * read again. A generator holds one record at a time, so **the array of everything never exists.**
     *
     * **THE ORDER IS THE SAME ORDER `entries()` SORTS TO** — oldest first — because `plan()`'s contract must
     * not change with this fix, and a recovery that visited records in directory order would be a different
     * recovery. The names are sorted rather than the parsed records, which is cheaper and, for records written
     * one per nonce with a timestamp inside, gives the same sequence a caller can rely on.
     */
    * eachRecord() {
      const handle = opendirSync(dir)
      try {
        for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
          if (!entry.name.endsWith('.json')) continue
          const nonce = decodeURIComponent(entry.name.slice(0, -'.json'.length))
          yield this.read(nonce)
        }
      } finally {
        handle.closeSync()
      }
    },
    /** Every entry, oldest first. A corrupt one is NAMED rather than skipped. */
    entries() {
      const out = []
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue
        const nonce = decodeURIComponent(name.slice(0, -'.json'.length))
        out.push(this.read(nonce))
      }
      return Object.freeze(out.sort((left, right) => left.at - right.at))
    },
    isSpent(nonce) {
      const entry = this.read(nonce)
      return entry !== null && entry.state === JOURNAL_STATE.SPENT
    },
    /**
     * WHAT A RESTART MUST DO, DECIDED FROM WHAT IS ON DISK AND FROM NOTHING ELSE.
     *
     * @returns {Readonly<{uncertain: readonly object[], receiptsOwed: readonly object[], complete: number}>}
     */
    plan() {
      const uncertain = []
      const receiptsOwed = []
      let complete = 0
      // ── RECOVERY DOES NOT BUILD THE WHOLE HISTORY (CODEX R11, FINDING 4) ──────────────────────────────
      //
      // **MEASURED: THIS ITERATED `this.entries()`, WHICH READS EVERY RECORD AND SORTS THE LOT.** One
      // permanent record is written per nonce and NOTHING ever removes a SPENT one — `sweepTemporaries()`
      // touches only `.tmp-` names — so the array this built grew with every settlement the owner ever made,
      // **and the whole of it had to exist in memory before recovery could decide anything.** That is the
      // startup heap the finding names.
      //
      // **AND RECOVERY DOES NOT NEED THOSE BODIES.** It needs the UNCERTAIN entries, the RECEIPTS OWED, and a
      // COUNT of everything else — **a spent record's contents are never read again, only its number of them.**
      // So this walks the directory and reads ONE RECORD AT A TIME, keeping only the two lists it owes.
      //
      // **THE SPENT SET IS NOT PRUNED AND MUST NOT BE.** `isSpent` is how a replayed approval is refused, and
      // a spent nonce has to be remembered for as long as its approval could be replayed — which is forever.
      // Deleting old records would close this finding by removing a protection and the failure would be
      // silent. **What is bounded here is what STARTUP RETAINS, not what the journal KEEPS.**
      for (const entry of this.eachRecord()) {
        if (entry.state === JOURNAL_STATE.SPENT) { complete += 1; continue }
        // **AN EFFECT THAT STARTED AND DID NOT FINISH IS UNCERTAIN, AND UNCERTAIN IS NOT "RETRY".** Returning
        // it as work to do would re-run an effect that may already have landed; returning it as nothing would
        // hide a memory that may never have been written. It is REPORTED.
        if (entry.state === JOURNAL_STATE.EFFECT_STARTED) { uncertain.push(entry); continue }
        // The effect is known to have landed; only the record of it is missing. Writing a receipt is idempotent,
        // which is exactly why it is a separate step from the effect.
        if (entry.state === JOURNAL_STATE.EFFECT_DONE) { receiptsOwed.push(entry); continue }
        // `pending` and `receipt-written` need no action here: nothing ran, or everything did. **`plan()`
        // NAMES WHAT IS OWED, NOT WHAT IS UNFINISHED** — a `receipt-written` entry owes no receipt, and the
        // daemon finishes its last step on recovery rather than this function reporting it as work.
        if (entry.state === JOURNAL_STATE.RECEIPT_WRITTEN) complete += 1
        if (entry.state === JOURNAL_STATE.PENDING) complete += 1
      }
      return Object.freeze({ uncertain: Object.freeze(uncertain), receiptsOwed: Object.freeze(receiptsOwed), complete })
    },
    /** Remove a temporary a crashed run left behind. Only ever called on recovery. */
    sweepTemporaries() {
      let removed = 0
      const handle = opendirSync(dir)
      try {
        for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
          if (!entry.name.includes('.tmp-')) continue
          unlinkSync(join(dir, entry.name))
          removed += 1
        }
      } finally {
        handle.closeSync()
      }
      return removed
    },
  })
}
