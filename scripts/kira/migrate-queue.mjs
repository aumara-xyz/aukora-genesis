#!/usr/bin/env node
/**
 * THE MIGRATION DRY RUN: how many of the queued records can be linked to a source event, and how many cannot.
 *
 * Fable's kira-121 item 6 asks for the migration AND for the count of what could not be linked. This prints the count
 * against the REAL store, and writes nothing: the design's journal (hash-chained, fsynced per append) is what makes a
 * migration reversible, and until it exists an apply would leave the store unable to say what happened to it.
 *
 *   node scripts/kira/migrate-queue.mjs                 # the dry run, on the canonical state root
 *   node scripts/kira/migrate-queue.mjs --state <dir>   # another state root
 *   node scripts/kira/migrate-queue.mjs --apply         # REFUSED, by name, until the journal exists
 *
 * WHY IT READS THE SESSION FILES ITSELF. The plugin's own reads go through `strict-read.mjs` (Fable's ruling A), and
 * this is not the plugin: it is a one-off maintenance script whose whole job is to find out whether a receipt is
 * possible. It reads, and it prints. It has no write path at all — not a disabled one, an absent one.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { migrationSummary, planMigration } from '../../plugins/aukora-kira/lib/memory-migrate.mjs'
// THE SESSION READERS MOVED (Fable's row 21): they live in `session-read.mjs` now, and this import follows them. My
// searches for callers covered the plugin and the courts and NOT `scripts/`, so this broke silently until the command
// itself was run — which is the whole argument for running a thing rather than grepping for it.
import { readSessionEventsStreamed } from '../../plugins/aukora-kira/lib/session-read.mjs'
// THE STORE'S OWN WRITE PATH, NOT A NEW ONE: `planStoreWrite` refuses a note without its journal line, refuses when the counts
// disagree, and refuses any path outside the state directory — which is the guarantee Fable's item 5 courted, reused here rather
// than re-argued. The writers are the boundary's own durable append/write, so a migrated note is as durable as a captured one.
import { STORE_PATHS, planStoreWrite } from '../../plugins/aukora-kira/lib/memory-store.mjs'
import { migratedEntry } from '../../plugins/aukora-kira/lib/memory-journal.mjs'
import { backfillLines, migrateNotesFromPlan, proveMigrated, storedNoteIds } from '../../plugins/aukora-kira/lib/memory-backfill.mjs'
import { appendJournalLine, durableWrite, ensureDirectory, readLinesIfPresent } from '../../plugins/aukora-kira/lib/strict-read.mjs'
import { buildRouteDeps } from '../../plugins/aukora-kira/lib/memory-deps.mjs'
import { indexTurns, resolveCitedTurn } from '../../plugins/aukora-kira/lib/memory-turn-index.mjs'

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

// *** THE APPLY IS ALLOWED NOW, AND THE OBJECTION IT USED TO RAISE IS ANSWERED RATHER THAN OVERRULED. *** The old refusal was not
// policy but measurement: linking would have minted receipts from a `.broken-single-frame` sibling the store does not call current,
// "a receipt for bytes nobody can re-read". Fable's kira-122 decision 1 dissolves that by NOT minting one — the 137 records migrate
// as REMEMBERED notes with receipt state UNLINKED: the source is cited, it is not found, and it is never verified. The refusal text
// is kept in the git history of this line rather than in the file, because the plan below is the honest successor to it.
const APPLY = flag('--apply')

const stateRoot = value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home')
const queueDir = join(stateRoot, 'kira-memory', 'queue')

if (!existsSync(queueDir)) {
  console.log(`kira.migrate:no-queue — ${queueDir} does not exist, so there is nothing to plan against.`)
  process.exit(1)
}

/** Every queue entry: its key (the file's digest name) and the record it holds. */
const entries = []
for (const name of readdirSync(queueDir).sort()) {
  if (!name.endsWith('.json')) continue
  try {
    const raw = readFileSync(join(queueDir, name), 'utf8')
    const parsed = JSON.parse(raw)
    // A queue file is written by the old staging path; the record is either the file itself or under `record`/`value`.
    const record = parsed?.record ?? parsed?.value ?? parsed
    entries.push({ key: name.replace(/\.json$/u, ''), record })
  } catch (error) {
    entries.push({ key: name.replace(/\.json$/u, ''), record: null, unreadable: String(error?.message ?? error) })
  }
}

/**
 * The cited sessions, read through the plugin's ONE audited read boundary — which knows the REAL layout:
 * `sessions/<project-slug>/session-<id>/session.jsonl.zstd`, zstd-compressed JSONL. A `*.jsonl` scan under `sessions/`
 * finds nothing at all, and the first dry run reported every record unlinkable for exactly that reason.
 */
const byTurnCache = new Map()
/** The turn index for a session, or null. THE STREAMING READER: the synchronous one decodes a single zstd FRAME and
 * these files are multi-frame, so it returns 214 bytes of session header and no events at all. */
const readFailure = new Map()
const turnsFor = async sessionId => {
  if (!byTurnCache.has(sessionId)) {
    try {
      const events = await readSessionEventsStreamed({ stateRoot, sessionId })
      byTurnCache.set(sessionId, events === null ? null : indexTurns(events))
      if (events !== null && events.length <= 1) {
        // *** A SESSION THAT DECOMPRESSES TO ONE LINE IS NOT A SESSION WITH NO TURNS IN IT, AND SAYING SO IS THE WHOLE POINT OF
        // THE REPORT. *** MEASURED 2026-09-26: every cited session in this store decompresses to a single header line, so the
        // index is empty and the plan said `turn-not-found` — a sentence about the RECORD, when the fact is about the FILE. The
        // counts are the same either way; what changes is whether a reader can act on them.
        readFailure.set(sessionId, `the session file holds ${String(events.length)} line(s) and no events, so no turn can be found in it`)
      }
    } catch (error) {
      // A BARE `catch` HERE TURNED EVERY READ FAILURE INTO `null`, which the report then read as `turn-not-found`. The reason is
      // kept and reported so a refused read cannot wear the clothes of a record that cites the wrong turn.
      readFailure.set(sessionId, `the session could not be read (${String(error?.code ?? error?.name ?? 'unknown')})`)
      byTurnCache.set(sessionId, null)
    }
  }
  return byTurnCache.get(sessionId)
}

/** The record's own words, by the citation it carries: the second step of the two-step rule needs them. */
const texts = new Map()
for (const entry of entries) {
  const t = entry.record?.content?.turn
  if (typeof t?.sessionId === 'string' && Number.isInteger(t?.turn)) {
    texts.set(`${t.sessionId}\u0000${String(t.turn)}`, String(entry.record?.content?.note ?? entry.record?.content?.statement ?? ''))
  }
}

// EVERY CITED SESSION IS LOADED BEFORE THE PLAN, because `planMigration` asks its lookup synchronously.
for (const sessionId of new Set(entries.map(entry => entry.record?.content?.turn?.sessionId).filter(one => typeof one === 'string'))) {
  await turnsFor(sessionId)
}
// WHAT THE STORE SAID, PER SESSION, so "cannot be linked" comes with the reason rather than only a count.
for (const [sessionId, because] of readFailure) console.log(`    session ${sessionId.slice(0, 26)}… — ${because}`)

const plan = planMigration(entries, {
  // *** A TURN IS NOT A SEQ. *** This used to be `events.find(one => one.seq === turn)`, under a comment that correctly
  // described why that was dangerous — "a wrong line would make a receipt that verifies against the wrong event" — and
  // then did it anyway. MEASURED: a record citing turn 294 resolves, by seq, to a `step/end` inside turn 2. A comment is
  // not a check. The rule now: the cited turn → that turn's events → the one carrying the record's text.
  findEvent: ({ sessionId, turn }) => {
    const byTurn = byTurnCache.get(sessionId)
    if (byTurn === null || byTurn === undefined) return null
    const resolved = resolveCitedTurn({ sessionId, turn, text: texts.get(`${sessionId}\u0000${String(turn)}`) ?? '', byTurn })
    return resolved.ok ? resolved.event : null
  },
})
const sessionsFound = [...byTurnCache.values()].filter(one => one !== null && one !== undefined).length
const sessionsCited = byTurnCache.size

console.log(APPLY ? 'kira.migrate: APPLY — THIS WRITES, under the state dir, after backing the queue up.' : 'kira.migrate: DRY RUN — nothing is written.')
console.log(`  state root        ${stateRoot}`)
console.log(`  queue entries     ${String(entries.length)} (${String(entries.filter(one => one.unreadable !== undefined).length)} unreadable)`)
console.log(`  cited sessions    ${String(sessionsCited)} cited, ${String(sessionsFound)} found under this state root`)
// *** A ZERO HERE IS ABOUT THIS STATE ROOT, NOT ABOUT THE RECORDS. *** Measured 2026-09-26: the layout is
// `sessions/<project-slug>/session-<id>/session.jsonl.zstd`, and a store that holds only the aukora-ui project makes
// every LANE-cited entry report turn-not-found — which reads like a fact about Peter's memories and is actually a fact
// about which store this ran against. The warning exists so that nobody, including me, reads it as the migration's answer.
if (sessionsFound === 0) {
  console.log('  !! WARNING: not one of the cited sessions was found in this state root, so EVERY entry below reports')
  console.log('     turn-not-found. THAT IS A FACT ABOUT THIS SEARCH, NOT ABOUT THE RECORDS: the events live in')
  console.log('     sessions/<project-slug>/session-<id>/session.jsonl.zstd, and the lane sessions cited here are in a')
  console.log('     project store this root does not hold. Pass --state <dir> for the root that does before believing a zero.')
}
console.log(`  ${migrationSummary(plan)}`)
for (const name of Object.keys(plan.counts)) {
  if (plan.counts[name] === 0) continue
  console.log(`    ${name.padEnd(20)} ${String(plan.counts[name])}`)
}
const examples = plan.unlinkable.slice(0, 3)
for (const one of examples) console.log(`    e.g. ${one.key.slice(0, 16)}… ${one.outcome}: ${one.why.slice(0, 90)}`)
console.log('  and this plan is NOT a migration: no journal exists yet, so nothing above has been written.')

// ── THE APPLY ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ORDER IS THE GUARANTEE: back the queue up FIRST, build every note, let `planStoreWrite` check that each note travels with
// its journal line and that no path leaves the state directory, write, and then READ THE STORE BACK and prove what was written.
// A migration that reports success without reading its own output is a migration nobody can trust.
if (APPLY) {
  const store = join(stateRoot, 'kira-memory')
  const at = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  const backup = join(store, `queue-backup-${at.replace(/[:]/gu, '-')}`)
  ensureDirectory(backup)
  let copied = 0
  for (const name of readdirSync(queueDir)) {
    if (!name.endsWith('.json')) continue
    durableWrite(join(backup, name), readFileSync(join(queueDir, name), 'utf8'), { dir: store })
    copied += 1
  }
  const auraFile = join(store, STORE_PATHS.rememberedAura)
  const journalFile = join(store, STORE_PATHS.journal)
  const auraBefore = readLinesIfPresent(auraFile).length
  const journalBefore = readLinesIfPresent(journalFile).length
  durableWrite(join(backup, 'backup-manifest.json'), `${JSON.stringify({
    at, stateRoot, queueDir, copiedFromQueue: copied, auraLinesBefore: auraBefore, journalLinesBefore: journalBefore,
    why: 'the queue as it stood before the migration, so a record can be re-derived rather than reconstructed from memory',
  }, null, 2)}\n`, { dir: store })
  console.log('')
  console.log(`  BACKED UP ${String(copied)} queue file(s) and the chain lengths to ${backup}`)

  const linkable = new Map(plan.linkable.map(one => [one.key, one]))
  const becauseByKey = new Map(plan.unlinkable.map(one => [one.key, one.why]))
  const built = migrateNotesFromPlan({ entries, linkable, becauseByKey, alreadyStored: storedNoteIds(store), observedAt: at, auraIndex: auraBefore })
  // THE CHAIN CONTINUES RATHER THAN RESTARTING: the last journal entry, if there is one, is what the next entry hashes onto.
  let previous = null
  try {
    const journalLines = readLinesIfPresent(journalFile)
    if (journalLines.length > 0) previous = JSON.parse(journalLines[journalLines.length - 1])
  } catch (error) {
    console.log(`kira.migrate:journal-unreadable — ${String(error?.message ?? error)}`)
    process.exit(1)
  }
  const lines = backfillLines(built.notes, { previous, at, auraIndex: auraBefore })
  const storePlan = planStoreWrite({ stateDir: store, notes: built.notes, journalLines: lines.journalLines, auraAppends: lines.auraAppends })
  for (const dir of storePlan.dirs) ensureDirectory(dir)
  for (const write of storePlan.writes) durableWrite(write.file, write.contents, { dir: store })
  // `appendJournalLine` IS THE SANCTIONED APPENDER: O_APPEND, `${line}\n`, fsync, and it REFUSES a line that already carries a
  // newline — so a chain cannot be written as one long line by accident. `durableAppend` was the wrong tool: it concatenates raw
  // bytes and terminates nothing, which is how 137 entries became one line.
  for (const append of storePlan.appends) appendJournalLine({ file: append.file, line: append.line })
  console.log(`  WROTE ${String(storePlan.counts.notes)} note(s) and ${String(storePlan.counts.appends)} journal/aura line(s)`)
  console.log(`  migrated ${String(built.counts.migrated)} (linked ${String(built.counts.linked)}, unlinked ${String(built.counts.unlinked)}), already stored ${String(built.counts['already-stored'])}, no statement ${String(built.counts['statement-empty'])}`)

  // THE PROOF, READ BACK FROM THE STORE RATHER THAN FROM WHAT WAS BUILT.
  const deps = buildRouteDeps({ stateDir: store, sessionsRoot: stateRoot })
  const proof = await proveMigrated({ stateDir: store, notes: built.notes, listNotes: deps.listNotes })
  console.log(`  PROOF: ${String(proof.checked)} record(s) read back — every one answers MISSING/source-not-found: ${proof.allMissing ? 'yes' : 'NO'}; every one is in recall labelled 'remembered, source not found': ${proof.allLabelled ? 'yes' : 'NO'}`)
  for (const failure of proof.failures.slice(0, 5)) console.log(`    ${failure}`)
  console.log(proof.failures.length === 0
    ? '  kira.migrate: the records are remembered, cited, and honest about not being verifiable.'
    : `  kira.migrate: ${String(proof.failures.length)} FAILURE(S) — the store does not agree with the plan.`)
  process.exit(proof.failures.length === 0 ? 0 : 1)
}
