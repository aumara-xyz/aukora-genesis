#!/usr/bin/env node
// REPAIR AN AURA LOG WHOSE TAIL IS NOT A CHAIN ENTRY — by APPENDING one, and rewriting nothing.
//
// *** THE PROBLEM THIS EXISTS FOR, MEASURED ON PETER'S REAL STORE ON 2026-09-28. *** Its `aura.jsonl` holds 146 lines and only THREE are chain entries: the migration wrote 139
// with `{op, id, at, by, because}` and no `sequence`/`prev`/`hash`, housekeeping wrote the same shape, and the retention probe wrote four more. The last line is one of them.
// `memory-owner.mjs`'s `readHead()` refuses exactly that — "the aura log's last line carries no hash, so it is not a chain entry" — and `appendAura()` calls it on EVERY append,
// so **the first settle after the hooks are mounted would fail**, before any record existed. Item 1 of kira-123 is that a real presence turn produces a remembered record with a
// receipt that verifies; on that store the write fails first.
//
// *** WHAT THIS DOES, AND WHAT IT REFUSES TO DO. *** A chain can only be continued from a chained tail, so the repair appends ONE entry that names the last CHAINED hash: the
// unchained lines stay exactly as they are, in place, still readable, and the tail becomes something `readHead()` accepts. It never rewrites, never renumbers and never deletes:
// re-chaining the 143 written lines would rewrite bytes already written, and deleting them would destroy the record of 139 real migrations and four real measurements.
//
// IT IS IDEMPOTENT AND IT SAYS WHAT IT DID. If the tail is already a chain entry there is nothing to repair and it exits 0 without writing. `--dry-run` prints the entry it would
// append and writes nothing. The boundary entry carries `op: 'chain-resumed'` and a `because` that states plainly that the lines before it are not in the chain, so a reader of
// that log learns the truth from the log itself rather than from this file.
//
// *** IT NEVER GUESSES A STORE. *** `--state` has NO DEFAULT: pointing this at the wrong directory is a mistake it cannot detect, so it does not offer to. Run it on a COPY first;
// that is what was done for the store above.
//
//   node scripts/kira/repair-aura-tail.mjs --state <home> --dry-run      # print the entry, write nothing
//   node scripts/kira/repair-aura-tail.mjs --state <home>                # append it
//
// @module scripts/kira/repair-aura-tail
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AURA_RECORD_DOMAIN, auraEntryHash } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
import { STORE_PATHS } from '../../plugins/aukora-kira/lib/memory-store.mjs'
import { appendJournalLine } from '../../plugins/aukora-kira/lib/strict-read.mjs'

const argv = process.argv.slice(2)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const DRY = argv.includes('--dry-run')

const stateHome = value('--state')
if (stateHome === undefined || stateHome === '') {
  console.error('kira.repair-aura-tail: --state is required and has NO default, because this command cannot tell a store from a directory that merely looks like one.')
  console.error('  node scripts/kira/repair-aura-tail.mjs --state <state home> --dry-run')
  process.exit(2)
}

const store = join(stateHome, 'kira-memory')
const auraFile = join(store, STORE_PATHS.aura)

if (!existsSync(auraFile)) {
  console.log(`kira.repair-aura-tail: no ${STORE_PATHS.aura} under ${store} — nothing to repair.`)
  process.exit(0)
}

const text = readFileSync(auraFile, 'utf8')
if (text !== '' && !text.endsWith('\n')) {
  console.error(`kira.repair-aura-tail: REFUSED — ${auraFile} does not end at a line boundary, so its last append was interrupted. That is a torn tail, not an unchained one, and it`)
  console.error('  needs a person to decide what the last line was. Nothing was written.')
  process.exit(2)
}

const lines = text === '' ? [] : text.slice(0, -1).split('\n')
const entries = lines.map((line, index) => {
  try { return JSON.parse(line) } catch { return { __unparseableAt: index + 1 } }
})
const bad = entries.find(entry => entry.__unparseableAt !== undefined)
if (bad !== undefined) {
  console.error(`kira.repair-aura-tail: REFUSED — line ${String(bad.__unparseableAt)} of ${auraFile} is not JSON, so the log cannot be read as a sequence of entries. Nothing was written.`)
  process.exit(2)
}

const last = entries[entries.length - 1]
if (last !== undefined && typeof last.hash === 'string') {
  console.log(`kira.repair-aura-tail: nothing to repair — the last line of ${auraFile} IS a chain entry (sequence ${String(last.sequence)}, hash ${last.hash.slice(0, 12)}…).`)
  process.exit(0)
}

// THE LAST CHAINED ENTRY, WHICH IS THE ONLY PLACE A CHAIN CAN BE RESUMED FROM. Walking backwards finds it; if there is none the log resumes from the domain's genesis, which is
// what a chain with no entries at all starts from.
let chainedIndex = -1
for (let i = entries.length - 1; i >= 0; i -= 1) {
  if (typeof entries[i].hash === 'string') { chainedIndex = i; break }
}
const chainedCount = entries.filter(entry => typeof entry.hash === 'string').length
const prev = chainedIndex >= 0 ? entries[chainedIndex].hash : AURA_RECORD_DOMAIN
const body = {
  op: 'chain-resumed',
  at: new Date().toISOString(),
  by: 'kira.repair-aura-tail/v1',
  because: `the ${String(entries.length - chainedCount)} entr${entries.length - chainedCount === 1 ? 'y' : 'ies'} before this one carr${entries.length - chainedCount === 1 ? 'ies' : 'y'} no sequence, prev or hash, so the log could not be continued from them; this entry resumes the chain from the last entry that was chained (${chainedIndex >= 0 ? `position ${String(chainedIndex + 1)}` : 'genesis'}) and rewrites nothing`,
  sequence: entries.length + 1,
}
const entry = { ...body, prev, hash: auraEntryHash(prev, body) }
// NO TRAILING NEWLINE: `appendJournalLine` adds the line ending itself and REFUSES a string that already carries one — "a line carrying a newline is two entries and neither would
// verify". Measured by running this command rather than by reading it: the first version appended `\n` and threw, and the store was left exactly as it was, which is the right
// failure for a repair tool to have.
const line = JSON.stringify(entry)

console.log(`kira.repair-aura-tail: ${DRY ? 'DRY RUN — nothing is written' : 'REPAIRING — one entry is appended, nothing is rewritten'}`)
console.log(`  log              ${auraFile}`)
console.log(`  lines            ${String(entries.length)}, of which ${String(chainedCount)} are chain entries`)
console.log(`  resumes from     ${chainedIndex >= 0 ? `position ${String(chainedIndex + 1)}, hash ${prev.slice(0, 12)}…` : `genesis (${AURA_RECORD_DOMAIN})`}`)
console.log(`  appends          sequence ${String(entry.sequence)}, prev ${prev.slice(0, 12)}…, hash ${entry.hash.slice(0, 12)}…`)
console.log(`  nothing else     the ${String(entries.length - chainedCount)} unchained line(s) stay exactly where they are, unmodified`)

if (DRY) {
  console.log('')
  console.log('DRY RUN: nothing above has been written. Re-run without --dry-run to append the entry.')
  process.exit(0)
}

appendJournalLine({ file: auraFile, line })
console.log('')
console.log(`APPENDED. ${auraFile} is now continuable: its last line is a chain entry.`)
