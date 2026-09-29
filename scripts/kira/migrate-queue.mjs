#!/usr/bin/env node
/** Queue migration maintenance. Revert defaults to writing only after a proved inverse and fresh recovery backup.
 *   --revert --backup <dir> --dry-run     validate and measure, without writes
 *   --revert --backup <dir>               restore the pre-migration store
 *   --undo-revert --backup <recovery-dir> restore the fresh pre-repair image (also accepts --dry-run)
 */
import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync, mkdtempSync, chmodSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'

import { migrationSummary, planMigration } from '../../plugins/aukora-kira/lib/memory-migrate.mjs'
// THE SESSION READERS MOVED (Fable's row 21): they live in `session-read.mjs` now, and this import follows them. My
// searches for callers covered the plugin and the courts and NOT `scripts/`, so this broke silently until the command
// itself was run — which is the whole argument for running a thing rather than grepping for it.
import { readSessionEventsStreamed } from '../../plugins/aukora-kira/lib/session-read.mjs'
// THE STORE'S OWN WRITE PATH, NOT A NEW ONE: `planStoreWrite` refuses a note without its journal line, refuses when the counts
// disagree, and refuses any path outside the state directory — which is the guarantee Fable's item 5 courted, reused here rather
// than re-argued. The writers are the boundary's own durable append/write, so a migrated note is as durable as a captured one.
import { STORE_PATHS } from '../../plugins/aukora-kira/lib/memory-store.mjs'
import { planBackfillRevert } from '../../plugins/aukora-kira/lib/memory-backfill.mjs'
import { durableWrite, readTextStrict, readJsonStrict, parseStrictText, syncDirectory, withFileLock } from '../../plugins/aukora-kira/lib/strict-read.mjs'
import { indexTurns, resolveCitedTurn } from '../../plugins/aukora-kira/lib/memory-turn-index.mjs'

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const APPLY = flag('--apply')

const stateRoot = resolve(value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home'))
const queueDir = join(stateRoot, 'kira-memory', 'queue')

// Revert is planned without I/O in memory-backfill; this command owns its guarded transaction.
const REVERT = flag('--revert')
const UNDO = flag('--undo-revert')
const DRY = flag('--dry-run')
const fail = (code, message) => { const error = new Error(message); error.code = `kira.migrate:${code}`; throw error }
for (let i = 0; i < argv.length; i += 1) {
  const option = argv[i]
  if (['--state', '--backup'].includes(option)) {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('invalid-option', `${option} requires a path`)
    i += 1
  } else if (!['--apply', '--revert', '--undo-revert', '--dry-run'].includes(option)) {
    fail('invalid-option', `unknown option ${option}`)
  }
}
const hash = text => createHash('sha256').update(text).digest('hex')
const textAt = file => { try { return readTextStrict(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
function directory(path) {
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) fail('unsafe-path', `not a real, unaliased directory: ${path}`)
}
function filesIn(dir, pattern) {
  directory(dir)
  return readdirSync(dir).sort().filter(name => {
    if (pattern.test(name)) {
      if (!lstatSync(join(dir, name)).isFile() || lstatSync(join(dir, name)).isSymbolicLink()) fail('unsafe-path', 'a store file is not regular')
      return true
    }
    // Settlement receipts predate migration and are outside its queue-file inverse.
    if (dir === queueDir && name === 'settlement' && lstatSync(join(dir, name)).isDirectory() && !lstatSync(join(dir, name)).isSymbolicLink()) return false
    if (dir === queueDir) fail('queue-moved-on', 'unexpected queue entry')
    if (name.endsWith('.json')) fail('unrecognized-note-file', 'an unrecognized note filename prevents a complete inventory')
    return false
  })
}
function snapshot() {
  directory(stateRoot); directory(store); directory(join(store, 'remembered'))
  const queue = new Map(filesIn(queueDir, /^kira:[a-f0-9]{64}\.json$/u).map(name => [name, readTextStrict(join(queueDir, name))]))
  const notes = new Map(filesIn(join(store, 'remembered'), /^[a-f0-9]{64}\.json$/u).map(name => [name, readTextStrict(join(store, 'remembered', name))]))
  return { queue, notes, journal: readTextStrict(journalFile), aura: readTextStrict(auraFile) }
}
function signature(snap) {
  return hash(JSON.stringify({ queue: [...snap.queue], notes: [...snap.notes], journal: snap.journal, aura: snap.aura }))
}
function counts(snap) {
  return { notes: snap.notes.size, queue: snap.queue.size, journal: snap.journal.split('\n').filter(Boolean).length, aura: snap.aura.split('\n').filter(Boolean).length }
}
function printCounts(label, snap) { console.log(`${label} ${JSON.stringify(counts(snap))}`) }
function inverse(snap, backup) {
  directory(backup)
  let manifest
  try { manifest = readJsonStrict(join(backup, 'backup-manifest.json')) }
  catch { fail('backup-missing-or-malformed', 'a readable, strict backup-manifest.json is required') }
  const names = readdirSync(backup).sort()
  if (names.some(name => name !== 'backup-manifest.json' && !/^kira:[a-f0-9]{64}\.json$/u.test(name))) fail('backup-malformed', 'unexpected backup entry')
  const backupEntries = names.filter(name => name !== 'backup-manifest.json').map(name => {
    const raw = readTextStrict(join(backup, name)), parsed = parseStrictText(raw, name)
    return { key: name.slice(0, -5), raw, record: parsed?.record ?? parsed?.value ?? parsed }
  })
  const notes = new Map([...snap.notes].map(([name, raw]) => [`rem:${name.slice(0, -5)}`, parseStrictText(raw, name)]))
  return planBackfillRevert({ stateRoot, manifest, backupEntries, notes, queue: snap.queue, journal: snap.journal, aura: snap.aura })
}
function reverted(snap, plan) {
  const notes = new Map(snap.notes)
  for (const entry of plan.removed) notes.delete(`${entry.id.slice(4)}.json`)
  return { notes, queue: plan.queue, journal: plan.journal, aura: plan.aura }
}
function fileMap(snap) {
  return new Map([['remembered/journal.jsonl', snap.journal], ['remembered/aura.jsonl', snap.aura],
    ...[...snap.queue].map(([name, raw]) => [`queue/${name}`, raw]), ...[...snap.notes].map(([name, raw]) => [`remembered/${name}`, raw])])
}
function assertQuiescent() {
  // The installed launcher records the writer PID beside state/home. An offline copy has no launcher.
  const launchFile = join(dirname(stateRoot), 'launch-url.json')
  if (!existsSync(launchFile)) return
  const launch = readJsonStrict(launchFile)
  if (!Number.isSafeInteger(launch.pid) || launch.pid <= 1) fail('writer-unknown', 'the launcher does not identify its backend')
  const status = spawnSync('ps', ['-p', String(launch.pid), '-o', 'stat='], { encoding: 'utf8' })
  if (status.error || (status.status !== 0 && status.status !== 1)) fail('writer-unknown', 'the backend state could not be inspected')
  if (status.status === 0 && !status.stdout.includes('T')) fail('writer-not-quiesced', 'pause the installed backend before changing memory; resume it after readback')
}
function writeValue(path, value) {
  assertQuiescent()
  const file = join(store, path)
  if (value === null) { unlinkSync(file); syncDirectory(dirname(file)) }
  else durableWrite(file, value)
}
// Both images are durable before the first store mutation. Recovery also works after a partial write.
function transact(before, after, purpose) {
  const a = fileMap(before), b = fileMap(after)
  const names = [...new Set([...a.keys(), ...b.keys()])].sort()
  const changes = names.filter(path => a.get(path) !== b.get(path))
  if (!changes.length) fail('nothing-to-write', 'there is no state change')
  const safety = mkdtempSync(join(store, 'revert-recovery-'))
  chmodSync(safety, 0o700)
  const entries = names.map((path, i) => {
    const beforeText = a.get(path) ?? null, afterText = b.get(path) ?? null
    // Retained notes need a digest, not another plaintext copy. Queue originals and every changed byte are backed up.
    const retained = beforeText === afterText && path.startsWith('remembered/') && !path.endsWith('.jsonl')
    if (!retained && beforeText !== null) durableWrite(join(safety, `${i}.before`), beforeText)
    if (!retained && afterText !== null && afterText !== beforeText) durableWrite(join(safety, `${i}.after`), afterText)
    return { path, retained, before: beforeText === null ? null : hash(beforeText), after: afterText === null ? null : hash(afterText) }
  })
  const manifest = { format: 'kira-revert-recovery/v1', stateRoot, purpose, before: counts(before), after: counts(after), entries }
  durableWrite(join(safety, 'recovery-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  // Read the durable backup back before trusting it, not just the buffers we passed to write().
  readRecovery(safety)
  console.log(`FRESH BACKUP ${safety}`)
  console.log(`RECOVER node scripts/kira/migrate-queue.mjs --undo-revert --backup ${JSON.stringify(safety)} --state ${JSON.stringify(stateRoot)}`)
  if (signature(snapshot()) !== signature(before)) fail('store-moved-on', 'the store changed while backing it up; no store files were written')
  try {
    // Queue first, notes next, chains last. Every file is rechecked immediately before mutation.
    const ordered = [...changes.filter(path => path.startsWith('queue/')), ...changes.filter(path => /^remembered\/[a-f0-9]{64}\.json$/u.test(path)), ...changes.filter(path => path.endsWith('.jsonl'))]
    for (const path of ordered) {
      if (textAt(join(store, path)) !== (a.get(path) ?? null)) fail('store-moved-on', 'a target changed before writing; use the recovery backup')
      // A journal advance is never overwritten, even if it arrived while notes were being removed.
      for (const log of ['remembered/journal.jsonl', 'remembered/aura.jsonl']) {
        const current = textAt(join(store, log))
        if (current !== (a.get(log) ?? null) && current !== (b.get(log) ?? null)) fail('journal-moved-on', 'a chain moved during the transaction; recovery retained')
      }
      writeValue(path, b.get(path) ?? null)
    }
    const measured = snapshot()
    printCounts('AFTER (read back)', measured)
    if (signature(measured) !== signature(after)) fail('readback-mismatch', 'the full store does not match the planned inverse; recovery retained')
    console.log('VERIFIED: exact queue JSON bytes, inventoried note bytes, removed IDs and both raw chain prefixes read back.')
    return safety
  } catch (error) {
    console.error(`WRITE INCOMPLETE: ${error.code ?? error.message}; recovery snapshot retained at ${safety}`)
    throw error
  }
}
function readRecovery(backup) {
  directory(backup)
  const manifest = readJsonStrict(join(backup, 'recovery-manifest.json'))
  if (manifest?.format !== 'kira-revert-recovery/v1' || manifest.stateRoot !== stateRoot || !Array.isArray(manifest.entries)) fail('recovery-malformed', 'recovery manifest format or state root does not match')
  const paths = new Set()
  const entries = manifest.entries.map((entry, i) => {
    if (!/^(?:queue\/kira:[a-f0-9]{64}\.json|remembered\/(?:[a-f0-9]{64}\.json|journal\.jsonl|aura\.jsonl))$/u.test(entry.path) || paths.has(entry.path)) fail('recovery-malformed', 'duplicate or out-of-store recovery path')
    paths.add(entry.path)
    const read = side => {
      if (entry[side] === null) return null
      if (!/^[a-f0-9]{64}$/u.test(entry[side] ?? '')) fail('recovery-malformed', 'missing recovery digest')
      if (entry.retained === true && (entry.before !== entry.after || entry.before === null)) fail('recovery-malformed', 'retained files must have identical nonempty digests')
      const image = side === 'after' && entry.after === entry.before ? 'before' : side
      const raw = readTextStrict(entry.retained === true ? join(store, entry.path) : join(backup, `${i}.${image}`))
      if (hash(raw) !== entry[side]) fail('recovery-corrupt', 'recovery bytes do not match the recorded digest')
      return raw
    }
    return { path: entry.path, before: read('before'), after: read('after') }
  })
  if (!paths.has('remembered/journal.jsonl') || !paths.has('remembered/aura.jsonl')) fail('recovery-malformed', 'recovery must contain both chains')
  return entries
}
function undoPlan(before, backup) {
  const entries = readRecovery(backup), current = fileMap(before), known = new Set(entries.map(entry => entry.path))
  if ([...current.keys()].some(path => !known.has(path))) fail('store-moved-on', 'a new file appeared after this recovery snapshot')
  const after = { queue: new Map(), notes: new Map(), journal: '', aura: '' }
  for (const entry of entries) {
    const now = current.get(entry.path) ?? null
    if (now !== entry.before && now !== entry.after) fail('store-moved-on', 'a recovery target has moved beyond both recorded images')
    if (entry.path === 'remembered/journal.jsonl') after.journal = entry.before
    else if (entry.path === 'remembered/aura.jsonl') after.aura = entry.before
    else if (entry.before !== null) (entry.path.startsWith('queue/') ? after.queue : after.notes).set(entry.path.split('/')[1], entry.before)
  }
  return after
}
const store = join(stateRoot, 'kira-memory')
const journalFile = join(store, STORE_PATHS.journal)
const auraFile = join(store, STORE_PATHS.rememberedAura)
if (REVERT || UNDO) {
  try {
    if (APPLY || (REVERT && UNDO)) fail('flags-conflict', 'choose apply, revert, or undo-revert')
    const backupArg = value('--backup')
    if (!backupArg || backupArg.startsWith('--')) fail('backup-required', '--revert/--undo-revert requires --backup <dir>')
    const backup = resolve(backupArg)
    const run = () => {
      const before = snapshot()
      const after = UNDO ? undoPlan(before, backup) : reverted(before, inverse(before, backup))
      printCounts('BEFORE (read)', before)
      printCounts('PLANNED AFTER (not yet written)', after)
      if (DRY) { console.log('DRY RUN: inverse verified; no writes.'); return }
      assertQuiescent()
      transact(before, after, UNDO ? 'undo-revert' : 'revert')
    }
    // Dry run does not even create lock files. Real writes use the capture lock and a second journal lock.
    if (DRY) run()
    else withFileLock(auraFile, () => withFileLock(journalFile, run))
    process.exit(0)
  } catch (error) {
    console.error(`${error.code ?? 'kira.migrate:revert-refused'} — ${error.message}`)
    process.exit(1)
  }
}


// A completed-tail inverse is not proof that this legacy writer can recover a partial apply.
// Keep its unsafe write path closed by name until that pre-write proof exists.
if (APPLY) {
  console.error('kira.migrate:revert-unproven — --apply refused: the legacy migration writer has no proven partial-apply recovery path. No store writes performed.')
  process.exit(1)
}

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

console.log('kira.migrate: DRY RUN — nothing is written.')
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
console.log('  This is a plan only; nothing above has been written.')
