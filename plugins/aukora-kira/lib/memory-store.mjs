/**
 * THE STORE PLAN — WHERE A CAPTURED TURN'S BYTES GO, DECIDED BEFORE ANYTHING IS OPENED.
 *
 * `consumeTurn` produces notes, journal lines and Aura appends; this turns them into a PLAN: the exact files, the exact
 * contents, and the directories that must exist. The caller writes the plan through the plugin's one audited boundary
 * (`writeArtifact` and `appendJournalLine` in `strict-read.mjs`), which is why this module can be pure — and why a court
 * can assert the whole layout, including the guarantee Fable's list names, without touching a disk.
 *
 * THE TWO STORES ARE DIFFERENT ON PURPOSE (§2.1): a Remembered note lives in `kira-memory/remembered/`, and the Signed
 * tier keeps the settled store it always had. They are not one directory with a flag, because a flag is a thing a bug
 * can flip: a note that reaches the signed store has to have been signed, and the path it lives at says so.
 *
 * EVERY PATH IS CHECKED BEFORE IT IS RETURNED. A path outside the user's state directory is not written and not
 * silently adjusted — it is REPORTED in `outside`, so a caller cannot proceed past it by accident. That check is
 * textual (`insideStateDir`), so it holds before any file is opened rather than after a failure.
 *
 * @module @aukora/dsh-plugin-kira/memory-store
 */
import { insideStateDir } from './memory-forget.mjs'
import { qualifyUnsignedNote } from './memory-law.mjs'
import { MEMORY_STORAGE } from './memory-tiers.mjs'

/**
 * The directories, RELATIVE TO THE STORE ROOT — and `stateDir` means exactly one thing now.
 *
 * **FABLE'S ITEM (2), MEASURED BEFORE IT WAS FIXED.** The composition passes `stateDir: dshHomePath('kira-memory')`, so
 * `stateDir` on a real deployment IS the store root (`…/state/home/kira-memory`). These paths ALSO began with
 * `kira-memory/`, and the dependency builder joined the two — so a deployed Kira read
 * `…/state/home/kira-memory/kira-memory/remembered`, a directory that does not exist. `ENOENT` there produced `[]`, and `[]`
 * means "you have no memories". **A wrong path was reporting itself as an empty life.**
 *
 * So the prefix is gone and the meaning is the deployment's: `stateDir` is the STORE ROOT, and everything below is relative to
 * it. The layout on disk is unchanged — `…/state/home/kira-memory/remembered` — because that is where the real store already
 * puts things.
 */
export const STORE_PATHS = Object.freeze({
  root: '',
  remembered: MEMORY_STORAGE.remembered,
  journal: 'remembered/journal.jsonl',
  // THE APPROVED CHAIN. `memory-owner.mjs` appends every settle here (`join(stateDir, 'aura.jsonl')`), and it is the one
  // chain the public evidence export copies (`scripts/kira/public-evidence.mjs`, allowlist `aura.jsonl`).
  aura: 'aura.jsonl',
  // THE UNSIGNED TIER'S OWN CHAIN (2026-09-27, the original memory law, `memory-law.mjs`). This used to be ONE chain: a
  // remembered note's entry was appended to `aura.jsonl` beside the approved settles. MEASURED on a scratch store: one
  // captured note put an `{op:'remember', tier:'remembered', …}` line into `aura.jsonl`, and the export of the approved
  // record before it then REFUSED (`PUBLIC_EVIDENCE_NOT_CLOSED` at `aura.jsonl:2`) — the unsigned tier stayed out of the
  // export only because no export could be made at all. The law quarantines a write with no capability, so the unsigned
  // tier is chained here, under `remembered/`, which the exporter never enters. The approved chain holds only approvals.
  rememberedAura: 'remembered/aura.jsonl',
  signed: 'settled',
})

/** A named refusal: a plan with nowhere to go is refused rather than guessed at. */
export class KiraStoreError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.store: ${message}`)
    this.name = 'KiraStoreError'
    this.code = `kira.store:${code}`
  }
}

/** The object filename for a note id: the id is `rem:<hex>`, and the hex is the name. */
export function objectFileName(id) {
  const text = String(id ?? '')
  if (!/^rem:[0-9a-f]{64}$/u.test(text)) {
    throw new KiraStoreError('id-malformed', `a note id names its own file, so ${JSON.stringify(text)} cannot be stored: ids are rem:<64 hex>`)
  }
  return `${text.slice(4)}.json`
}

/**
 * Plan the writes for one consumed turn.
 *
 * @param {{notes: ReadonlyArray<Record<string, unknown>>, journalLines?: ReadonlyArray<string>, auraAppends?: ReadonlyArray<Record<string, unknown>>, stateDir: string, dirs?: ReadonlyArray<string>}} input
 * @returns {{writes: ReadonlyArray<{file: string, contents: string}>, appends: ReadonlyArray<{file: string, line: string}>, dirs: ReadonlyArray<string>, outside: ReadonlyArray<string>, counts: {notes: number, appends: number}}}
 */
/**
 * One JSON value as text, accepting an object OR an already-encoded string, so a caller that stringifies early is not silently
 * double-encoded. IT DOES NOT TERMINATE THE LINE: `appendJournalLine` in the boundary writes `${line}\n` under fsync, and the
 * reader REFUSES a line carrying a newline ("a line carrying a newline is two entries and neither would verify"). My first
 * version of this helper added the newline here and the store's own end-to-end court went red on exactly that — the contract was
 * already written down in code, and I had not read it.
 *
 * *** BOTH OF THOSE BUGS WERE MEASURED, ONE MIGRATION APART. *** `durableAppend` concatenates RAW BYTES and terminates
 * nothing, so 137 journal entries came out as ONE line with `wc -l` reading zero and `grep -c ''` reading one; and the aura
 * entry came out as `"{\"op\":…}"` because a caller had already stringified what this line stringified again. THE REPAIR
 * BELONGS HERE, where "a JSONL file is one JSON value per line" can be made true for every caller at once — the capture hook
 * and the backfill were each wrong in their own way.
 * @param {unknown} one @returns {string}
 */
function asJsonText(one) {
  return typeof one === "string" ? one : JSON.stringify(one)
}

export function planStoreWrite(input) {
  const { notes = [], journalLines = [], auraAppends = [], stateDir } = input ?? {}
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw new KiraStoreError('state-dir-missing', 'the store is inside the user\'s state directory, so a plan without one has nowhere to go')
  }
  if (notes.length !== journalLines.length) {
    throw new KiraStoreError('journal-mismatch', `${String(notes.length)} note(s) and ${String(journalLines.length)} journal line(s): a note that is not journalled is a note the store cannot account for`)
  }
  // THE DIRECTORY THE CHAIN LIVES IN IS PART OF THE PLAN. The end-to-end arm caught this the moment the aura append
  // pointed at the existing chain: ENOENT, because a plan that appends into `kira-memory/` must also create it.
  // THE ROOT IS THE STORE ROOT ITSELF, so it is not joined with a slash of its own.
  const dirs = [stateDir, `${stateDir}/${STORE_PATHS.remembered}`, `${stateDir}/${STORE_PATHS.signed}`]
  const writes = []
  const appends = []
  const outside = []
  for (const [index, note] of notes.entries()) {
    // THE LAW ADMITS THE NOTE TO THE UNSIGNED TIER OR REFUSES IT, before any path is planned for it: advisory, never
    // authority, and quarantined because no capability was presented. See `memory-law.mjs`.
    qualifyUnsignedNote(note)
    const file = `${stateDir}/${STORE_PATHS.remembered}/${objectFileName(note.id)}`
    if (!insideStateDir(file, stateDir)) { outside.push(file); continue }
    writes.push({ file, contents: `${JSON.stringify(note)}\n` })
    // THE JOURNAL LINE GOES WITH ITS NOTE, in the same plan, so a caller cannot write the note and forget the entry.
    appends.push({ file: `${stateDir}/${STORE_PATHS.journal}`, line: asJsonText(journalLines[index]) })
    if (auraAppends[index] !== undefined) {
      // THE UNSIGNED TIER'S CHAIN, NEVER THE APPROVED ONE (the guard for rule 1; `STORE_PATHS.rememberedAura`).
      appends.push({ file: `${stateDir}/${STORE_PATHS.rememberedAura}`, line: asJsonText(auraAppends[index]) })
    }
  }
  for (const one of [...writes.map(write => write.file), ...appends.map(one => one.file)]) {
    if (!insideStateDir(one, stateDir) && !outside.includes(one)) outside.push(one)
  }
  return {
    writes: Object.freeze(writes),
    appends: Object.freeze(appends),
    dirs: Object.freeze(dirs),
    outside: Object.freeze(outside),
    counts: { notes: writes.length, appends: appends.length },
  }
}

/**
 * Read back one note object's file name for a record, and refuse anything that is not the remembered store.
 * @param {Readonly<Record<string, unknown>>} note
 * @param {string} stateDir
 * @returns {string}
 */
export function objectPathFor(note, stateDir) {
  const file = `${stateDir}/${STORE_PATHS.remembered}/${objectFileName(note?.id)}`
  if (!insideStateDir(file, stateDir)) throw new KiraStoreError('outside-state-dir', `${file} is not inside the user's state directory`)
  return file
}
