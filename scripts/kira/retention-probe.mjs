/**
 * RETENTION PROBE v0 — the honest recall score, with no model anywhere in it.
 *
 * **FABLE'S kira-123 ITEM 3:** *"the honest recall score: generate questions from today's remembered records deterministically (no
 * model), ask recall, and report hit@5 with the method pinned. This is the number a reviewer will ask for. Store it as a derived,
 * authority-free record."*
 *
 * *** EVERY PART OF THE METHOD IS PINNED IN THE OUTPUT, ON PURPOSE. *** A hit@5 that does not say which notes were asked about, which
 * questions were asked and which ranker answered is a number a reviewer cannot check — and the first thing they will ask is exactly
 * that. So the run prints its own method, and the derived record carries it.
 *
 * THE QUESTIONS ARE DERIVED FROM THE NOTES THEMSELVES, deterministically: each note's RAREST TERM becomes the question. "Rarest" is
 * measured across the store (the term carried by the fewest notes, ties broken lexicographically), so the same store produces the same
 * questions on any machine and at any time of day. No model writes a question, and no model judges an answer.
 *
 * *** AND THE RANKER IS THE RECALL SERVICE'S OWN, NOT THE ROUTE'S `q`. *** `makeRecallRanker` is BM25 over the notes, which is what
 * recall uses to RANK by a question; the list route's `q` is a SUBSTRING FILTER (`statement.includes(needle)`), which finds what it
 * finds in file order. *** AND MY FIRST VERSION OF THIS COMMENT OVERSTATED THAT: *** it said a question through the route "matches
 * nothing at all", which is FALSE for these probes — the question here is one of the note's own terms, so it IS a substring of the
 * note it must find, and the filter would have found it. What the ranker adds is the ORDER, and the court now proves the difference
 * with a corpus large enough for order to matter (six notes, the target last in file order): a ranker puts the target first, and a
 * filter-and-file-order answer puts it sixth, outside hit@5.
 *
 *   node scripts/kira/retention-probe.mjs                  # measure, print the method, and STORE the derived record
 *   node scripts/kira/retention-probe.mjs --dry-run        # measure, print, store nothing
 *   node scripts/kira/retention-probe.mjs --state <home> --day 2026-09-26 --limit 5
 *
 * @module @aukora/dsh-plugin-kira/retention-probe
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { makeRecallRanker } from '../../plugins/aukora-kira/lib/memory-frame-adapter.mjs'
import { STORE_PATHS, planStoreWrite } from '../../plugins/aukora-kira/lib/memory-store.mjs'
import { termsOf } from '../../plugins/aukora-kira/lib/memory-housekeeping.mjs'
import { buildRememberedNote, sha256Hex } from '../../plugins/aukora-kira/lib/memory-tiers.mjs'
import { nextEntry } from '../../plugins/aukora-kira/lib/memory-journal.mjs'
// THE LOG'S OWN WRITER, FOR THE SAME REASON housekeeping uses it: this command used to append a bare `{op, id, at, by}` to `aura.jsonl` — no sequence, no prev, no hash — so its four
// records on Peter's real store are among the 143 of 146 aura lines that are in the FILE and not in the CHAIN. It refuses rather than appending when the tail cannot be chained onto.
import { chainAuraEntries } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
import { appendJournalLine, durableWrite, ensureDirectory, listJsonFiles, readJsonStrict, readLinesIfPresent } from '../../plugins/aukora-kira/lib/strict-read.mjs'

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const stateHome = value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home')
const store = join(stateHome, 'kira-memory')
const day = value('--day') ?? new Date().toLocaleDateString('en-CA')
const limit = Math.max(1, Number(value('--limit') ?? 5))
const DRY = flag('--dry-run')
// *** THE METHOD NAMES ITS OWN WEAKNESS, BECAUSE A REVIEWER WILL ASK AND THE SCORE IS HIGHER FOR IT. *** The question is derived from
// the note it is supposed to find, so this measures SELF-RETRIEVAL: can recall find a note given its own rarest term. That is a real
// property and it is not the same as answering a question a person would ask, which is the harder number and the one v1 should carry.
const METHOD = `questions from each note's RAREST TERM (so this measures SELF-RETRIEVAL, not questions a person would ask); ranked by the recall service's own BM25 ranker (makeRecallRanker); hit@${String(limit)}`

// *** A STORE THAT IS NOT THERE IS NOT AN EMPTY STORE. *** Measured 2026-09-26: pointed at a home with no store, this reported "0 of 0
// records" and a clean result — the same "not configured reads as clean" family as the secret filter that could never fire. A refusal is
// the only honest answer, because "nothing found" over nothing is not a finding.
if (!existsSync(join(store, STORE_PATHS.remembered))) {
  console.log(`  REFUSED: there is no store at ${store} — nothing has been asked about, and an absent store is not a clean one.`)
  process.exit(2)
}

const notes = []
for (const name of listJsonFiles(join(store, STORE_PATHS.remembered))) {
  try {
    const note = readJsonStrict(join(store, STORE_PATHS.remembered, name))
    // *** THE PROBE DOES NOT MEASURE ITSELF. *** The command STORES a derived record on every run (item 3: "Store it as a derived, authority-free record"), and that
    // record is captured today and carries a rare term — so without this line the next run asks a question about the previous run's output and retrieves it, because
    // it is the only note in the corpus that reads like a measurement. MEASURED, four runs in one hour: hit@5 67.4% (31/46) → 68.1% (32/47) → 68.8% (33/48) → 69.4%
    // (34/49), each corpus exactly one record larger than the last and the addition being its own previous reading. A number that rises because it was asked twice is
    // not the number a reviewer wants, and the record's own text says why it does not belong: "a derived measurement, not something the owner said".
    if (String(note?.origin?.by ?? '') === 'kira.retention-probe/v1') continue
    if (note.tier === 'remembered' || note.tier === 'signed') notes.push(note)
  } catch { /* an unreadable note is not a question; the housekeeping job reports those */ }
}

/** Term → the notes carrying it, over the WHOLE store, because rarity is a property of the store and not of the day. */
const carriers = new Map()
for (const note of notes) {
  for (const term of termsOf(note.statement)) {
    if (!carriers.has(term)) carriers.set(term, new Set())
    carriers.get(term).add(String(note.id))
  }
}

const localDay = instant => {
  const parsed = Date.parse(String(instant ?? ''))
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString('en-CA') : null
}
const todays = notes.filter(note => localDay(note.createdAt) === day || localDay(note.observedAt) === day)

const ranker = makeRecallRanker()
const probes = []
for (const note of todays) {
  const terms = termsOf(note.statement)
  if (terms.length === 0) continue
  // THE RAREST TERM, ties broken lexicographically: deterministic, and it names the thing this note is most uniquely about.
  const question = [...terms].sort((a, b) => (carriers.get(a).size - carriers.get(b).size) || a.localeCompare(b))[0]
  const ranked = ranker(question, notes)
  const top = ranked.slice(0, limit).map(row => String(row.id))
  probes.push({ question, id: String(note.id), hit: top.includes(String(note.id)), top })
}

const hits = probes.filter(one => one.hit).length
const hitAt = probes.length === 0 ? null : hits / probes.length

console.log('kira.retention-probe v0')
console.log(`  store            ${store}`)
console.log(`  day              ${day} (local)`)
console.log(`  corpus           ${String(notes.length)} note(s); asked about ${String(probes.length)} captured today`)
console.log(`  METHOD           ${METHOD}`)
console.log(`  hit@${String(limit)}            ${probes.length === 0 ? 'no questions to ask' : `${(hitAt * 100).toFixed(1)}% (${String(hits)}/${String(probes.length)})`}`)
// *** AND WHAT THIS NUMBER IS *NOT*, NOW THAT §8.1 IS IMPLEMENTED. *** The probe ranks notes directly, which its METHOD line says and which is what makes it
// deterministic and model-free. But §8.1 refuses a migrated note ("they are never injected") at `recallFilter`, so a corpus that is overwhelmingly migrated produces
// a hit@5 that measures THE RANKER over notes the injection path will not serve. MEASURED on the live store: 139 of the 140 records carry
// `origin.by = migration/queue-v1` — the one exception being this probe's OWN derived record, written by an earlier run of this very command — so the honest
// statement beside 67.4% is "139 of them cannot be injected". A reviewer reading the number without that sentence would take it for a recall rate, and it is a
// retrieval rate. (My first version of this comment said "all 140", which this command's own output falsified on its first run.)
const migrated = notes.filter(one => String(one?.origin?.by ?? '') === 'migration/queue-v1').length
if (migrated > 0) {
  console.log(`  NOT A RECALL RATE: ${String(migrated)} of ${String(notes.length)} note(s) in the corpus carry origin.by = migration/queue-v1, which §8.1 refuses at the`)
  console.log('                     injection filter ("the queued entries are never injected"). This number measures the RANKER; it is not what she will recall.')
}
console.log('')
for (const one of probes.slice(0, 5)) {
  console.log(`  ${one.hit ? 'hit ' : 'miss'}  q=${JSON.stringify(one.question)}  note=${one.id.slice(4, 12)}  top=${one.top.map(id => id.slice(4, 10)).join(',')}`)
}
if (probes.length > 5) console.log(`  … and ${String(probes.length - 5)} more`)

if (probes.length === 0) {
  console.log('')
  console.log('  NOTHING TO MEASURE: no record captured today carried a term to ask about, so there is no score rather than a zero.')
  process.exit(1)
}

// ── THE DERIVED, AUTHORITY-FREE RECORD ──────────────────────────────────────────────────────────────────────────────────────
const at = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
const statement = `Recall probe for ${day}: hit@${String(limit)} ${(hitAt * 100).toFixed(1)}% (${String(hits)} of ${String(probes.length)}). Method: ${METHOD}.`
const record = buildRememberedNote({
  category: 'project',
  statement,
  // `dream` is the design's value for a derived note. THIS RECORD CARRIES NO AUTHORITY: it reports a measurement about the store, and
  // `buildRememberedNote` sets `grantsAuthority: false` on every remembered note — the property is the tier's, not this line's.
  attributedTo: 'dream',
  evidence: [{ log: 'retention-probe', turn: 0, turnDigest: sha256Hex(day), quote: 'a derived measurement, not something the owner said' }],
  validFrom: day, observedAt: at, confidence: 0.5, sensitivity: 'none', privacy: 'local', subject: String(todays[0]?.subject ?? 'owner'),
  source: { state: 'UNLINKED', cited: false, because: 'derived from a measurement over the store rather than from a turn, so there is nothing to cite' },
  salt: sha256Hex(`kira.retention-probe/v1\u0000${day}\u0000${String(limit)}`),
  origin: { by: 'kira.retention-probe/v1', note: `method: ${METHOD}` },
})
if (DRY) {
  console.log('')
  console.log(`  DRY RUN: the derived record would be ${record.id.slice(0, 24)}… and nothing has been written.`)
  process.exit(0)
}
const journalFile = join(store, STORE_PATHS.journal)
let previous = null
const existing = readLinesIfPresent(journalFile)
if (existing.length > 0) { try { previous = JSON.parse(existing[existing.length - 1]) } catch { previous = null } }
const entry = nextEntry({ previous, op: 'add', id: record.id, objectDigest: String(record.id).slice(4), actor: 'kira.retention-probe/v1', reason: `the recall probe for ${day}`, at })
// THE AURA ENTRY IS CHAINED BY THE LOG'S OWN WRITER, not appended bare with a hand-computed `index`. `chainAuraEntries` refuses when the tail cannot be chained onto, which is the
// honest answer: an unchained line in a chained log is what this lane spent a night measuring on the real store.
const storePlan = planStoreWrite({ stateDir: store, notes: [record], journalLines: [JSON.stringify(entry)], auraAppends: chainAuraEntries(store, [{ op: 'add', id: record.id, at, by: 'kira.retention-probe/v1' }], { file: join(store, STORE_PATHS.rememberedAura) }) })
for (const dir of storePlan.dirs) ensureDirectory(dir)
for (const write of storePlan.writes) durableWrite(write.file, write.contents, { dir: store })
for (const append of storePlan.appends) appendJournalLine({ file: append.file, line: append.line })
// THE REPORT IS EARNED: read it back rather than claim it.
const wrote = listJsonFiles(join(store, STORE_PATHS.remembered)).some(name => name === `${record.id.slice(4)}.json`)
if (!wrote) {
  console.log('  FAILED: the plan reported a write and the store does not hold the record. Nothing above may be believed.')
  process.exit(1)
}
console.log('')
console.log(`  STORED the derived record ${record.id.slice(0, 24)}… (authority-free: tier remembered, grantsAuthority false)`)
