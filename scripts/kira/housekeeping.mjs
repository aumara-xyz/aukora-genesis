/**
 * NIGHTLY HOUSEKEEPING — §5.1, with the gates it names and a dry run that writes nothing.
 *
 *   node scripts/kira/housekeeping.mjs                 # DRY RUN: prints the plan, writes nothing (the default)
 *   node scripts/kira/housekeeping.mjs --apply         # writes the changes, each with its chain entry
 *   node scripts/kira/housekeeping.mjs --state <home> --now 2026-09-26 --level 62
 *
 * **FABLE'S kira-123 ITEM 2:** *"It runs only when the machine is idle and memory is at 50 or above."* Both gates are checked
 * BEFORE ANYTHING IS PLANNED, and each one FAILS CLOSED: if the memory level cannot be read, this refuses to run rather than
 * assuming the machine is fine; if the newest turn cannot be dated, it refuses rather than assuming the owner is away.
 *
 * AND THE DRY RUN IS THE DEFAULT, which is the right way round for a job that runs nightly on the owner's own memories: the flag
 * you type by accident should be the one that changes nothing.
 *
 * @module @aukora/dsh-plugin-kira/housekeeping-command
 */
import { readMemoryLevel } from './memory-pressure.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { housekeepingChanges, planHousekeeping, undoPlan } from '../../plugins/aukora-kira/lib/memory-housekeeping.mjs'
import { STORE_PATHS, objectFileName, planStoreWrite } from '../../plugins/aukora-kira/lib/memory-store.mjs'
// `chainAuraEntries` IS THE LOG'S OWN WRITER, EXPORTED FOR THIS CALLER. §5.1 requires that every change is "recorded in the Aura chain", and this command used to append
// `{op, id, at, by, because, index}` — a hand-computed INDEX rather than a sequence, with no `prev` and no `hash`. Measured on Peter's real store: 143 of 146 aura lines
// carry no sequence and no hash, and the tail is one of them, which makes `readHead()` refuse and would have failed the first settle after a cutover.
import { chainAuraEntries } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
import { buildRememberedNote, recomputeNoteId, sha256Hex } from '../../plugins/aukora-kira/lib/memory-tiers.mjs'
// `nextEntry` RATHER THAN `migratedEntry`: the latter hardcodes `op: 'add'`, which journaled a merge as an add and an expiry as an
// add — and the court's last assertion, "the merge is a `supersede`", is what caught it. A change's OP IS PART OF THE CHANGE.
import { nextEntry } from '../../plugins/aukora-kira/lib/memory-journal.mjs'
import { verifyChain } from '../../plugins/aukora-kira/lib/memory-journal.mjs'
import { appendJournalLine, durableWrite, ensureDirectory, listJsonFiles, readJsonStrict, readLinesIfPresent } from '../../plugins/aukora-kira/lib/strict-read.mjs'
// §2.1's KEPT SET IS REPLAYED FROM THE CHAIN THIS COMMAND ALREADY READS. `keep` is one of §3.6's twelve ops and §2.1 promises that a Kept note is never silently
// replaced — but the record has no `kept` field to carry it, so the answer comes from the journal, exactly as the forgotten set and the usage layer do.
import { keptIds } from '../../plugins/aukora-kira/lib/memory-forget.mjs'

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const APPLY = flag('--apply')
const stateHome = value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home')
const store = join(stateHome, 'kira-memory')
const now = value('--now') ?? new Date().toISOString().slice(0, 10)
// THE PLATFORM'S SIGNAL LIVES IN ITS OWN MODULE, so a court can drive the parser without running this script.
// *** `--level` IS THE FLOOR, NOT THE OBSERVED LEVEL — I MISREAD IT FOR ONE COMMAND AND BROKE THE UNDER-FLOOR ARM. *** It has always
// been `const floor = Number(value('--level') ?? 50)` above; treating it as the reading made a run that ASKS for a refusal proceed
// instead, which is the arm Fable said to keep. The machine's own signal is therefore read unconditionally, on whatever platform this is.
const measured = readMemoryLevel()
const level = measured.level
if (!Number.isFinite(level)) {
  console.log('  REFUSED: this machine publishes no readable pressure signal — kern.memorystatus_level on darwin, /proc/meminfo on linux — so this cannot tell whether the machine is under pressure. Nothing was planned.')
  process.exit(2)
}


const floor = Number(value('--level') ?? 50)
const idleMinutes = Number(value('--idle-minutes') ?? 20)
const stampFile = join(store, 'housekeeping-last-run.json')
// *** RELATIVE TO THIS FILE, NOT TO `homedir()`. *** The policy ships WITH the code that applies it, so it is found beside that code;
// deriving it from HOME meant a store under any other home had no policy at all and the job refused — which the housekeeping court
// caught on its first run, because its fixture sets HOME to a temp directory. A default that only works in one person's home
// directory is not a default.
const policyPath = value('--policy') ?? fileURLToPath(new URL('../../plugins/aukora-kira/retention-policy.json', import.meta.url))

console.log(`kira.housekeeping: ${APPLY ? 'APPLY — this writes, each change with its chain entry' : 'DRY RUN — nothing is written'}`)
console.log(`  store            ${store}`)
console.log(`  day              ${now}`)
console.log(`  policy           ${policyPath}`)

// ── THE GATES, BEFORE ANYTHING IS PLANNED, EACH FAILING CLOSED ────────────────────────────────────────────────────────────────
if (!Number.isFinite(floor)) { console.log('  REFUSED: the floor is not a number'); process.exit(2) }
// THE PLATFORM'S OWN SIGNAL, read through the injectable reader above rather than a macOS-only command.
console.log(`  memory level     ${String(level)} from ${String(measured.source)} (floor ${String(floor)})`)
if (level < floor) {
  console.log(`  REFUSED: memory is at ${String(level)}, below the floor of ${String(floor)}. Nothing was planned.`)
  process.exit(2)
}

/** The newest turn we can date: the newest session file, and the newest note. UNSAFE-DEFAULT: if neither can be dated, not idle. */
function idleForMinutes() {
  let newest = 0
  const sessions = join(stateHome, 'sessions')
  if (existsSync(sessions)) {
    for (const project of readdirSync(sessions)) {
      const dir = join(sessions, project)
      let names = []
      try { names = readdirSync(dir) } catch { continue }
      for (const name of names) {
        try { newest = Math.max(newest, statSync(join(dir, name)).mtimeMs) } catch { /* a file that vanished is not a turn */ }
      }
    }
  }
  for (const name of listJsonFiles(join(store, 'remembered'))) {
    try { newest = Math.max(newest, statSync(join(store, 'remembered', name)).mtimeMs) } catch { /* as above */ }
  }
  if (newest === 0) return null
  return (Date.now() - newest) / 60000
}
const idle = idleForMinutes()
if (idle === null) {
  console.log('  REFUSED: no session file and no note could be dated, so this cannot tell whether the owner is away. Nothing was planned.')
  process.exit(2)
}
console.log(`  idle for         ${idle.toFixed(1)} minutes (needs ${String(idleMinutes)})`)
if (idle < idleMinutes) {
  console.log(`  REFUSED: a turn landed ${idle.toFixed(1)} minutes ago, so the machine is not idle. Nothing was planned.`)
  process.exit(2)
}
if (APPLY && existsSync(stampFile)) {
  const last = readJsonStrict(stampFile)
  const hours = (Date.now() - Date.parse(String(last?.at ?? ''))) / 3_600_000
  if (Number.isFinite(hours) && hours < 24 && !flag('--ignore-24h')) {
    console.log(`  REFUSED: it last ran ${hours.toFixed(1)} hours ago, and §5.1 says at most once every 24. Nothing was planned.`)
    process.exit(2)
  }
}

// ── STEP 1: VERIFY BOTH STORES IN FULL, AND STOP IF EITHER IS DAMAGED ────────────────────────────────────────────────────────
const journalFile = join(store, STORE_PATHS.journal)
const chain = verifyChain(readLinesIfPresent(journalFile))
console.log(`  journal          ${String(chain.count)} entries, chain ok: ${String(chain.ok)}${chain.ok ? '' : ` (damaged at ${String(chain.damagedAt)}: ${String(chain.why)})`}`)
let damaged = []
let notes = []
for (const name of listJsonFiles(join(store, STORE_PATHS.remembered))) {
  try {
    const note = readJsonStrict(join(store, STORE_PATHS.remembered, name))
    if (recomputeNoteId(note) !== note.id) damaged.push(`${name}: its id does not recompute from its own bytes`)
    else notes.push(note)
  } catch (error) {
    damaged.push(`${name}: ${String(error?.message ?? error).slice(0, 80)}`)
  }
}
console.log(`  notes            ${String(notes.length)} readable, ${String(damaged.length)} damaged`)
if (!chain.ok || damaged.length > 0) {
  console.log('  STOPPED: §5.1 says verify both stores in full and STOP if either is damaged — so nothing was planned and nothing was written.')
  for (const one of damaged.slice(0, 5)) console.log(`    ${one}`)
  process.exit(1)
}

// ── THE PLAN ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let policy
try { policy = readJsonStrict(policyPath) } catch (error) {
  console.log(`  REFUSED: the policy could not be read (${String(error?.message ?? error).slice(0, 90)}). Nothing was planned.`)
  process.exit(2)
}
// THE CALLER THAT MAKES `keptIds` REAL RATHER THAN A COURT FIXTURE. The chain is read here anyway (`readLinesIfPresent(journalFile)` above), so replaying it for
// `keep` entries costs one pass and closes §2.1's promise end to end: `keep` op → this set → `planHousekeeping` → the `kept` rule → a note that is not expired.
const kept = keptIds(store, readLinesIfPresent)
// ── `--undo`: PUT THE LAST BATCH BACK, IF IT IS INSIDE §2.2's SEVEN DAYS ─────────────────────────────────────────────────────────────────────
// THE CALLER THAT MAKES `undoPlan` REAL RATHER THAN A COURT FIXTURE, and the producer `restore` never had. §2.1 calls a supersede "journaled and undoable", §2.2
// fixes the window at seven days, §5.1 step 2 says the merge is "with undo" — and measured before this branch existed, `restore` appeared in this tree exactly once,
// in the op list, with nothing anywhere appending one.
//
// THE REFUSAL IS THE POINT OF THE WINDOW: past seven days this prints a NAME and writes nothing, rather than quietly doing nothing, because a silent no-op is what a
// caller and a court both read as a working undo.
if (flag('--undo')) {
  const undo = undoPlan(readLinesIfPresent(journalFile), new Date().toISOString())
  if (undo.ok !== true) {
    console.log(`  REFUSED: ${String(undo.why)}${undo.at === null || undo.at === undefined ? '' : ` — the last batch was at ${String(undo.at)}`}. Nothing was written.`)
    process.exit(2)
  }
  console.log(`  undo             batch at ${String(undo.at)}, ${String(undo.restores.length)} note(s) inside the ${String(undo.windowDays)}-day window`)
  const at = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  // *** THE UNDO WRITES THE WAY THE APPLY WRITES, AND IT DID NOT BEFORE THIS. *** Measured 2026-09-29 by executing it for the first time: it handed `planStoreWrite` `notes: []`
  // against N journal lines, which the store's guard refused by name — *"0 note(s) and 1 journal line(s): a note that is not journalled is a note the store cannot account for"* —
  // AND it built its Aura appends as raw `{op, id, at, by, because, index}` objects with no `prev` and no `hash`. **That second one is the defect this file's own import comment
  // describes**: the one that left 143 unchained lines in Peter's real store and would have failed the first settle after a cutover. The apply branch was fixed; this branch kept the
  // old shape because nothing had ever run it.
  //
  // SO THE UNDO MIRRORS THE APPLY, deliberately and line for line: one record for the batch (it travels with its own journal entry through `planStoreWrite`, so it lands first and the
  // restores chain onto it), then the restores in a second phase. §2.2 calls a supersede *"journaled, undo for 7 days"*, and this is the half an owner reaches for after a bad merge.
  const undoRecord = buildRememberedNote({
    category: 'project',
    statement: `Housekeeping undone on ${now}: ${String(undo.restores.length)} restore(s) from the batch at ${String(undo.at)}`,
    attributedTo: 'dream',
    evidence: [{ log: 'housekeeping', turn: 0, turnDigest: 'a'.repeat(64), quote: 'a derived report, not something the owner said' }],
    validFrom: now, observedAt: at, confidence: 0.5, sensitivity: 'none', privacy: 'local', subject: String(undo.subject ?? 'owner'),
    source: { state: 'UNLINKED', cited: false, because: 'this record is derived from other notes rather than from a turn, so there is nothing to cite' },
    salt: sha256Hex(`kira.housekeeping-undo/v1\u0000${now}\u0000${String(undo.at)}`),
    origin: { by: 'kira.housekeeping/v1', note: 'derived and authority-free: it records what the undo did, and grants nothing' },
  })
  let previous = null
  const existingUndo = readLinesIfPresent(journalFile)
  if (existingUndo.length > 0) { try { previous = JSON.parse(existingUndo[existingUndo.length - 1]) } catch { previous = null } }
  const undoRecordEntry = nextEntry({ previous, op: 'add', id: undoRecord.id, objectDigest: String(undoRecord.id).slice(4), actor: 'kira.housekeeping/v1', reason: `the undo of the batch at ${String(undo.at)}`, at })
  previous = undoRecordEntry
  const entries = []
  for (const id of undo.restores) {
    const entry = nextEntry({ previous, op: 'restore', id, objectDigest: String(id).slice(4), actor: 'kira.housekeeping/v1', reason: `undo of the batch at ${String(undo.at)}`, at })
    entries.push(JSON.stringify(entry))
    previous = entry
  }
  // THE CHAIN ENTRIES ARE CHAINED BY THE LOG'S OWN WRITER, in the order they are written, exactly as the apply does it.
  const undoAuraEntries = chainAuraEntries(store, [
    { op: 'add', id: undoRecord.id, at, by: 'kira.housekeeping/v1', because: `the undo of the batch at ${String(undo.at)}` },
    ...undo.restores.map(id => ({ op: 'restore', id, at, by: 'kira.housekeeping/v1', because: `undo of the batch at ${String(undo.at)}` })),
  // THE UNSIGNED TIER'S OWN CHAIN (the original memory law, plugins/aukora-kira/lib/memory-law.mjs), never the approved aura.jsonl.
  ], { file: join(store, STORE_PATHS.rememberedAura) })
  const undoPlanWrite = planStoreWrite({
    stateDir: store,
    notes: [undoRecord],
    journalLines: [JSON.stringify(undoRecordEntry)],
    auraAppends: [undoAuraEntries[0]],
  })
  // `dryRun` WAS NEVER DEFINED — the flag this file defines is `APPLY`, so this guard was a ReferenceError waiting for the first run that reached it, and nothing reached it
  // until the three defects above it were fixed. **A branch nobody executes cannot be wrong out loud.**
  if (APPLY !== true) {
    console.log(`  DRY RUN: ${String(entries.length)} restore entry/entries would be appended and ${String(undoPlanWrite.auraAppends.length)} Aura line(s) written. Nothing was written.`)
    process.exit(0)
  }
  for (const dir of undoPlanWrite.dirs) ensureDirectory(dir)
  for (const write of undoPlanWrite.writes) durableWrite(write.file, write.contents, { dir: store })
  for (const append of undoPlanWrite.appends) appendJournalLine({ file: append.file, line: append.line })
  for (let i = 0; i < undo.restores.length; i += 1) {
    appendJournalLine({ file: journalFile, line: entries[i] })
    appendJournalLine({ file: join(store, STORE_PATHS.rememberedAura), line: JSON.stringify(undoAuraEntries[i + 1]) })
  }

  console.log(`  restored         ${undo.restores.map(id => id.slice(4, 12)).join(', ')}`)
  process.exit(0)
}

const plan = planHousekeeping({ notes, policy, now, kept })
console.log('')
console.log(`  duplicates       ${String(plan.counts.duplicates)} note(s) to merge into ${String(plan.duplicates.length)} kept`)
console.log(`  expiries         ${String(plan.counts.expiries)} note(s) past their rule's date`)
console.log(`  usage            ${String(plan.counts.usage)} note(s) carry a seen-again usage entry — a DERIVED layer, so no note is rewritten by it`)
console.log(`  topics           ${String(plan.counts.topics)} group(s)`)
// *** THE HALF THAT WAS MISSING: a signed record is NEVER rewritten, and where a rule WOULD have taken one, the owner is told instead of
// the note being skipped in silence. ***
console.log(`  signed proposals ${String(plan.counts.proposals)} — a signed record is never rewritten; where a rule would have acted, it is proposed here`)
for (const one of plan.proposals) console.log(`    propose ${String(one.rule).padEnd(9)} ${String(one.id).slice(0, 24)}… ${String(one.why)}`)
for (const group of plan.duplicates.slice(0, 3)) console.log(`    merge  ${group.merged.map(one => one.slice(4, 12)).join(',')} → ${group.keep.slice(4, 12)}`)
for (const one of plan.expiries.slice(0, 3)) console.log(`    expire ${one.id.slice(4, 12)} (${one.category}, rule ${one.rule}, ${one.expiresAt})`)
for (const topic of plan.topics.slice(0, 3)) console.log(`    topic  ${topic.name} (${String(topic.ids.length)} notes)`)
const changes = housekeepingChanges(plan)
console.log(`  chain entries    ${String(changes.length)} (one per change)`)

if (!APPLY) {
  console.log('')
  console.log('  DRY RUN: nothing above has been written, no chain entry appended, and no note touched.')
  process.exit(0)
}

// ── THE APPLY: ONE CHAIN ENTRY PER CHANGE, AND A DERIVED RECORD THAT CARRIES THE PLAN ────────────────────────────────────────
//
// *** §5.1's STEP 4 IS RECORDED HERE, AND THIS RECORD'S OWN `add` IS ITS CHAIN ENTRY. *** The pure lib computes the usage layer
// (`plan.usage`, from `usageCounts`) and cannot know whether it changed, because whether it changed is a question about what is already
// stored — so the job that HOLDS the store is where step 4 is applied, and the statement below is what it wrote. No separate chain entry is
// invented for it: the layer is a derived, authority-free artifact, exactly like a topic, and this is the `add` that carries it. Inventing an
// id for "the layer" would be a chain entry about nothing.
const at = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
const record = buildRememberedNote({
  category: 'project',
  statement: `Housekeeping on ${now}: ${String(plan.counts.duplicates)} duplicate(s) merged, ${String(plan.counts.expiries)} expired, ${String(plan.counts.usage)} note(s) with usage, ${String(plan.counts.topics)} topic(s).`,
  attributedTo: 'dream',
  evidence: [{ log: 'housekeeping', turn: 0, turnDigest: 'a'.repeat(64), quote: 'a derived report, not something the owner said' }],
  validFrom: now, observedAt: at, confidence: 0.5, sensitivity: 'none', privacy: 'local', subject: String(notes[0]?.subject ?? 'owner'),
  source: { state: 'UNLINKED', cited: false, because: 'this record is derived from other notes rather than from a turn, so there is nothing to cite' },
  // A SALT IS HEX64 (`kira.memory:salt-malformed` refused the raw string I first passed), and a DIGEST of the day is the honest
  // choice: deterministic, so two runs on the same day build the same record id rather than a new one each night.
  salt: sha256Hex(`kira.housekeeping/v1\u0000${now}`),
  origin: { by: 'kira.housekeeping/v1', note: 'derived and authority-free: it records what housekeeping did, and grants nothing' },
})
// *** THE CHAIN IS BUILT IN THE ORDER IT IS WRITTEN, WHICH IS THE DEFECT THIS COMMAND SHIPPED FOR ONE RUN. *** The record's own
// entry goes through `planStoreWrite` (it travels with the note), so it lands FIRST — and the change entries must therefore chain
// onto IT rather than onto the last pre-existing entry. The first version chained the changes first and then handed the record's
// line to the plan, so the file's order and the chain's order disagreed and `verifyChain` refused it. The housekeeping court's third
// arm caught exactly that: "every change has its chain entry" was true and "the chain still verifies" was false.
const journalLines = []
let previous = null
const existing = readLinesIfPresent(journalFile)
if (existing.length > 0) { try { previous = JSON.parse(existing[existing.length - 1]) } catch { previous = null } }
const recordEntry = nextEntry({ previous, op: 'add', id: record.id, objectDigest: String(record.id).slice(4), actor: 'kira.housekeeping/v1', reason: `the housekeeping record for ${now}`, at })
previous = recordEntry
for (const change of changes) {
  const entry = nextEntry({ previous, op: change.op, id: change.id, objectDigest: String(change.id).slice(4), actor: 'kira.housekeeping/v1', reason: change.because, at })
  journalLines.push(JSON.stringify(entry))
  previous = entry
}
// ONE CHAIN, CHAINED BY THE LOG'S OWN WRITER: the record's entry lands first (line 236's comment explains why it must), then one entry per change — and ALL of them are completed
// TOGETHER so that each names the one before it, including the ones inside this batch. Chaining them separately would produce two entries that both name the same head, which is a pair
// of siblings rather than a chain. A tail this command cannot chain onto REFUSES by name rather than appending an unchained line.
const auraBodies = [
  { op: 'add', id: record.id, at, by: 'kira.housekeeping/v1' },
  ...changes.map(change => ({ op: change.op, id: change.id, at, by: 'kira.housekeeping/v1', because: change.because })),
]
const auraEntries = chainAuraEntries(store, auraBodies, { file: join(store, STORE_PATHS.rememberedAura) })
const auraAppends = auraEntries.slice(1)
const storePlan = planStoreWrite({ stateDir: store, notes: [record], journalLines: [JSON.stringify(recordEntry)], auraAppends: [auraEntries[0]] })
for (const dir of storePlan.dirs) ensureDirectory(dir)
for (const write of storePlan.writes) durableWrite(write.file, write.contents, { dir: store })
for (const append of storePlan.appends) appendJournalLine({ file: append.file, line: append.line })
for (let i = 0; i < changes.length; i += 1) {
  appendJournalLine({ file: journalFile, line: journalLines[i] })
  appendJournalLine({ file: join(store, STORE_PATHS.rememberedAura), line: JSON.stringify(auraAppends[i]) })
}
durableWrite(stampFile, `${JSON.stringify({ at, day: now, changes: changes.length, record: record.id }, null, 2)}\n`, { dir: store })

// *** THE REPORT IS EARNED, NOT ASSERTED. *** A splice deleted the writes above and this command still printed "WROTE the housekeeping
// record" — a false success report, which the housekeeping court's third arm caught by counting lines that were not there. So the
// command now READS ITS OWN OUTPUT BACK and refuses to claim what it cannot see.
const wrote = listJsonFiles(join(store, STORE_PATHS.remembered)).includes(objectFileName(record.id))
const journalAfter = readLinesIfPresent(journalFile).length
if (!wrote || journalAfter < journalLines.length + 1) {
  console.log(`  FAILED: the plan said ${String(storePlan.counts.notes)} note(s) and ${String(journalLines.length + 1)} journal line(s), but the store holds ${wrote ? '' : 'no record file and '}${String(journalAfter)} line(s). Nothing above may be believed.`)
  process.exit(1)
}
console.log('')
console.log(`  WROTE the housekeeping record ${record.id.slice(0, 20)}… and ${String(changes.length)} chain entry pair(s)`)
console.log(`  note objects on disk: ${String(listJsonFiles(join(store, STORE_PATHS.remembered)).length)} — NO NOTE WAS REWRITTEN; the merges and expiries live in the chain`)
