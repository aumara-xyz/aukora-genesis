/**
 * THE SECRET SCAN — the records stored BEFORE the filter existed, checked with the same patterns.
 *
 * **FABLE'S kira-123 FOLLOW-UP, ITEM 4:** *"The 139 migrated records and today's 45 were stored with NO filter. Scan them with the same
 * patterns (reporting counts only, never the text), and for any credential-shaped note, PROPOSE a journaled forget (a tombstone, never a
 * rewrite) that Peter confirms in the Memory app."*
 *
 * *** IT PRINTS COUNTS AND IDENTIFIERS, AND NEVER THE TEXT. *** A scan whose output quotes what it found is a scan that leaks the thing
 * it was looking for, and this one runs over the owner's own store — so a match is identified by its record id and a SHA-256 of the
 * matched field. The statement itself appears nowhere in the output, in the proposal, or in the journal.
 *
 * *** IT PROPOSES; IT DOES NOT FORGET. *** A proposed record is written — derived, authority-free, listing the suspect ids — and a
 * chain entry records that the proposal was made. NO `forget` ENTRY IS WRITTEN: the tombstone is Peter's decision, made in the Memory
 * app, where the confirm path already exists. A scan that tombstones on its own is a script deleting the owner's memories on a
 * pattern's say-so.
 *
 *   node scripts/kira/secret-scan.mjs                 # DRY: counts and identifiers, writes nothing (the default)
 *   node scripts/kira/secret-scan.mjs --propose       # writes the authority-free proposal record + its chain entry
 *
 * @module @aukora/dsh-plugin-kira/secret-scan
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { SECRET_PATTERNS } from '../../plugins/aukora-kira/lib/compaction-export.mjs'
import { STORE_PATHS, planStoreWrite } from '../../plugins/aukora-kira/lib/memory-store.mjs'
import { buildRememberedNote } from '../../plugins/aukora-kira/lib/memory-tiers.mjs'
import { nextEntry } from '../../plugins/aukora-kira/lib/memory-journal.mjs'
import { existsSync } from 'node:fs'
import { appendJournalLine, durableWrite, ensureDirectory, listJsonFiles, readJsonStrict, readLinesIfPresent } from '../../plugins/aukora-kira/lib/strict-read.mjs'

const argv = process.argv.slice(2)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const PROPOSE = argv.includes('--propose')
const stateHome = value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home')
const store = join(stateHome, 'kira-memory')

/** The fields a note carries that could hold a secret. The STATEMENT is what a person reads; `text` is the contract's name for it. */
const FIELDS = ['statement', 'text']
const digestOf = text => createHash('sha256').update(String(text), 'utf8').digest('hex')

// *** A STORE THAT IS NOT THERE IS NOT AN EMPTY STORE. *** Measured 2026-09-26: pointed at a home with no store, this reported "0 of 0
// records" and a clean result — the same "not configured reads as clean" family as the secret filter that could never fire. A refusal is
// the only honest answer, because "nothing found" over nothing is not a finding.
if (!existsSync(join(store, STORE_PATHS.remembered))) {
  console.log(`  REFUSED: there is no store at ${store} — nothing has been scanned, and an absent store is not a clean one.`)
  process.exit(2)
}

const notes = []
let unreadable = 0
for (const name of listJsonFiles(join(store, STORE_PATHS.remembered))) {
  try { notes.push(readJsonStrict(join(store, STORE_PATHS.remembered, name))) } catch { unreadable += 1 }
}

const suspects = []
const perPattern = SECRET_PATTERNS.map(() => 0)
// *** ONE SUSPECT PER RECORD, NOT PER FIELD. *** `statement` and `text` are the SAME sentence under two names — the design's and the
// contract's — so a single note matched twice and the report read "2 of 2", which looks like every record in the store was suspect.
// A count that a reader can misread is a wrong count, even when the detection is right.
const seen = new Set()
for (const note of notes) {
  if (seen.has(String(note.id))) continue
  for (const field of FIELDS) {
    const text = note?.[field]
    if (typeof text !== 'string' || text === '') continue
    const index = SECRET_PATTERNS.findIndex(pattern => pattern.test(text))
    if (index < 0) continue
    perPattern[index] += 1
    suspects.push({ id: String(note.id), field, pattern: String(SECRET_PATTERNS[index]), statementDigest: digestOf(text) })
    seen.add(String(note.id))
    break
  }
}

console.log('kira.secret-scan')
console.log(`  store            ${store}`)
console.log(`  records scanned  ${String(notes.length)} (${String(unreadable)} unreadable, not scanned)`)
console.log(`  patterns         ${String(SECRET_PATTERNS.length)}, the same ones capture now uses`)
console.log(`  CREDENTIAL-SHAPED ${String(suspects.length)} of ${String(notes.length)} RECORDS (one count per record, not per field)`)
console.log('')
console.log('  counts per pattern (a pattern with no hits is listed as 0 and is NOT printed):')
for (const [index, pattern] of SECRET_PATTERNS.entries()) console.log(`    ${String(perPattern[index]).padStart(4)}  ${String(pattern)}`)
console.log('')
if (suspects.length > 0) {
  console.log('  identified by id and digest, NEVER by text:')
  for (const one of suspects.slice(0, 20)) console.log(`    ${one.id.slice(0, 24)}…  ${one.field} sha256 ${one.statementDigest.slice(0, 16)}…`)
  if (suspects.length > 20) console.log(`    … and ${String(suspects.length - 20)} more`)
}
if (suspects.length === 0) {
  console.log('  NOTHING CREDENTIAL-SHAPED. That is a statement about these patterns and these fields, not a promise about the store.')
  process.exit(0)
}

// ── THE PROPOSAL: a record Peter can act on, carried by the chain, and NO tombstone ─────────────────────────────────────────
const statement = `Secret scan: ${String(suspects.length)} record(s) match a credential pattern. They are proposed for forgetting, not forgotten. `
  + `Confirm in the Memory app; the tombstone is yours to write.`
if (!PROPOSE) {
  console.log('')
  console.log('  DRY: no proposal was written and NOTHING WAS FORGOTTEN. Pass --propose to record the proposal.')
  process.exit(0)
}
const at = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
const record = buildRememberedNote({
  category: 'project', statement, attributedTo: 'dream',
  evidence: [{ log: 'secret-scan', turn: 0, turnDigest: digestOf(suspects.map(one => one.id).join('\n')), quote: 'a derived proposal, not something the owner said' }],
  validFrom: at.slice(0, 10), observedAt: at, confidence: 0.5, sensitivity: 'none', privacy: 'local', subject: String(notes[0]?.subject ?? 'owner'),
  source: { state: 'UNLINKED', cited: false, because: 'derived from a scan of the store rather than from a turn, so there is nothing to cite' },
  salt: digestOf(`kira.secret-scan/v1\u0000${suspects.map(one => one.id).sort().join(',')}`),
  origin: { by: 'kira.secret-scan/v1', note: `proposed ids: ${suspects.map(one => one.id).join(' ')}` },
})
const journalFile = join(store, STORE_PATHS.journal)
let previous = null
const existing = readLinesIfPresent(journalFile)
if (existing.length > 0) { try { previous = JSON.parse(existing[existing.length - 1]) } catch { previous = null } }
// THE OP IS `add` — THE PROPOSAL IS A NEW RECORD — AND THERE IS DELIBERATELY NO `forget` ENTRY HERE.
const entry = nextEntry({ previous, op: 'add', id: record.id, objectDigest: String(record.id).slice(4), actor: 'kira.secret-scan/v1', reason: `a proposal to forget ${String(suspects.length)} credential-shaped record(s), awaiting the owner`, at })
const plan = planStoreWrite({ stateDir: store, notes: [record], journalLines: [JSON.stringify(entry)], auraAppends: [{ op: 'add', id: record.id, at, by: 'kira.secret-scan/v1', index: readLinesIfPresent(join(store, STORE_PATHS.rememberedAura)).length }] })
for (const dir of plan.dirs) ensureDirectory(dir)
for (const write of plan.writes) durableWrite(write.file, write.contents, { dir: store })
for (const append of plan.appends) appendJournalLine({ file: append.file, line: append.line })
const wrote = listJsonFiles(join(store, STORE_PATHS.remembered)).includes(`${record.id.slice(4)}.json`)
if (!wrote) { console.log('  FAILED: the plan reported a write and the store does not hold it. Nothing above may be believed.'); process.exit(1) }
const forgotten = readLinesIfPresent(journalFile).filter(line => { try { return JSON.parse(line).op === 'forget' } catch { return false } }).length
console.log('')
console.log(`  PROPOSED: the record is on disk (${record.id.slice(0, 24)}…) and the chain carries it.`)
console.log(`  TOMBSTONES IN THE STORE: ${String(forgotten)} — unchanged by this run, because forgetting is Peter's click.`)
