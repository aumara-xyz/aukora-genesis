#!/usr/bin/env node
/**
 * settle-preflight.mjs — can THIS deployment settle THIS record? Answered before the attempt.
 *
 * WHY THIS EXISTS. R29 found by hand that Peter's pending record carries `aukora:1:b84d840c…` while
 * the live overlay serves `aukora:1:01e38e77…`, so the owner would refuse `RECORD_SUBJECT_MISMATCH`
 * — a hard blocker that is neither of A4's two known gates, discovered only by reading the record.
 * A measurement made once by hand is a measurement nobody repeats, so it is a leg.
 *
 * WHAT IT CHECKS, all read-only — it settles nothing and spends nothing:
 *   1. the record is present and verifies (`readPending`);
 *   2. its SUBJECT is the one this deployment serves — otherwise `RECORD_SUBJECT_MISMATCH`;
 *   3. its PRIVACY class is one the read owner permits — otherwise the write succeeds and
 *      `kira_recall` can never show it (the privacy trap, `permittedPrivacy: [local]`);
 *   4. it reports the operation digest the approval and grant must bind.
 *
 * EXIT: 0 READY · 3 BLOCKED, blocker named · 2 a refusal or bad usage. It never writes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// THE CEILING PRINTS ON EVERY EXIT, registered HERE — above the argument parsing, which can itself exit
// 2 on a bad subject. `READY — a settle of these bytes would be accepted by the owner` is the strongest
// sentence any tool in this lane prints, and it said nothing about three things a reader needs. R19 and
// R20 each learned half of this the hard way on the shell tools: a trap installed after the parsing, and
// a ceiling defined below it, print nothing on exactly the exit that matters.
//
// WHEN is the pointed one: this is a CHECK AT ONE INSTANT, not a reservation. The owner may refuse at
// settle time for something that changed in between — the plan's class 1 and class 4 meeting in one
// sentence — and nothing here holds the bytes, the nonce or the approval.
const CEILINGS = [
  'CEILING: NOT_A_RESERVATION — a check at one instant, not a hold. It reserves no bytes, no nonce and no approval, and the owner may still refuse at settle time for anything that changed in between.',
  'CEILING: ONE_SUBJECT — the verdict is about the one subject this deployment serves, not about the store and not about any other row in it.',
  'CEILING: RETAINER_SAME_OWNER — same owner, one host. Agreement here is not a second party agreeing, and the store is read where it sits rather than from a replica elsewhere.',
]
process.on('exit', () => { console.log(''); for (const line of CEILINGS) console.log(line) })

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

const state = argOf('--state')
// `let`, NOT `const`: --find assigns the discovered id here, and a `const` made the tool CRASH the
// moment it found a match — i.e. only at the one moment it exists for. It reported the blocked case
// correctly for a whole round because that branch returns before the assignment, so every test I ran
// passed. MEASURED now with a subject the live store really does hold.
let recordId = argOf('--record-id')
const expected = argOf('--subject')
const overlay = argOf('--overlay') ?? resolve(process.env.HOME ?? '', 'Library/Application Support/AUKORA/kira-deployment-overlay.patch.yml')

// `--find` DISCOVERS the record instead of being told its id. Peter's decided sequence has KIRA
// stage a FRESH record under the served subject and "tell me its recordId" — but a run that depends on
// a human relaying an id is a run that waits on a human. With --find the preflight selects the pending
// record whose OWN subject is the one this deployment serves, so the moment K8 lands A4 needs nobody.
const find = argv.includes('--find')
if (state === undefined || expected === undefined || (!find && recordId === undefined)) {
  console.error('REFUSED: usage — --state <kira store> --subject <aukora:1:hex> (--record-id <kira:…> | --find) [--overlay <patch.yml>]')
  process.exit(2)
}

const blockers = []
const { createMemoryOwner } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const { operationDigestFor } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/approval.mjs')).href)

const owner = createMemoryOwner({ stateDir: state })
if (find) {
  const listing = owner.listPending()
  const rows = listing.exists === true ? listing.entries : []
  const matches = []
  for (const row of rows) {
    if (row.state !== 'pending') continue
    let candidate
    try {
      candidate = owner.readPending(String(row.recordId))
    } catch {
      continue
    }
    if (candidate.state === 'pending' && candidate.entry.record.subject === expected) matches.push(String(row.recordId))
  }
  if (matches.length === 0) {
    console.log(`PREFLIGHT --find: no pending record carries the served subject`)
    console.log(`  serves     : ${expected}`)
    console.log(`  pending    : ${rows.filter(r => r.state === 'pending').length} record(s), none under that subject`)
    console.log(`\nPREFLIGHT: BLOCKED — nothing to settle yet: no queued record carries the subject this deployment serves (K8 re-staging has not landed)`)
    process.exit(3)
  }
  if (matches.length > 1) {
    console.log(`PREFLIGHT --find: ${matches.length} pending records carry the served subject; refusing to choose`)
    for (const m of matches) console.log(`  ${m}`)
    console.log(`\nPREFLIGHT: BLOCKED — ambiguous: name one with --record-id`)
    process.exit(3)
  }
  recordId = matches[0]
  console.log(`PREFLIGHT --find: selected the one pending record under the served subject`)
}

let found
try {
  found = owner.readPending(recordId)
} catch (error) {
  console.error(`REFUSED: ${error?.code ?? 'refused'} — ${error?.message ?? String(error)}`)
  process.exit(2)
}

// The permitted classes are the deployment's, read from the overlay it actually loads — never
// assumed, because assuming [local] here is exactly how a write-then-invisible record gets settled.
let permitted = []
let overlayNote = `no overlay at ${overlay}`
if (existsSync(overlay)) {
  const match = /permittedPrivacy:\s*\[([^\]]*)\]/.exec(readFileSync(overlay, 'utf8'))
  if (match !== null) {
    permitted = match[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    overlayNote = `${overlay} permits [${permitted.join(', ')}]`
  } else {
    overlayNote = `${overlay} names no permittedPrivacy`
  }
}

let digest
if (found.state !== 'pending') {
  blockers.push(`the record reads as ${found.state}${found.reason ? ` (${found.reason})` : ''}, so there is nothing to settle`)
} else {
  const record = found.entry.record
  if (record.subject !== expected) {
    blockers.push(`RECORD_SUBJECT_MISMATCH — the record names ${String(record.subject)} and this deployment serves ${expected}; the owner refuses this (memory-owner.mjs:704)`)
  }
  if (permitted.length > 0 && !permitted.includes(String(record.privacy))) {
    blockers.push(`PRIVACY_NOT_PERMITTED — the record is "${record.privacy}" and the deployment permits [${permitted.join(', ')}]; it would write and then be invisible to recall`)
  }
  digest = operationDigestFor(Object.freeze({ key: recordId, value: record }))
}

console.log(`PREFLIGHT for ${recordId}`)
console.log(`  record     : ${found.state}`)
console.log(`  deployment : ${overlayNote}`)
console.log(`  serves     : ${expected}`)
if (digest !== undefined) console.log(`  operation  : ${digest}`)
console.log('')

if (blockers.length > 0) {
  for (const b of blockers) console.log(`  BLOCKED ${b}`)
  console.log(`\nPREFLIGHT: BLOCKED — ${blockers.length} blocker(s); a settle would be refused by name, or would write bytes recall cannot show`)
  process.exit(3)
}
console.log('  ok  the record is present, its subject is this deployment\'s, and its privacy class is permitted')
console.log('\nPREFLIGHT: READY — a settle of these bytes would be accepted by the owner')
