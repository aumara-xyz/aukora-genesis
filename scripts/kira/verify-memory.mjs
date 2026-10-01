#!/usr/bin/env node
/**
 * THE VERIFY COMMAND — re-read the local session event, re-hash it, and answer VERIFIED, CHANGED or MISSING.
 *
 * Fable's kira-121 item 3 asks for "the VERIFY route and command". The route is mounted and courted; this is the command,
 * and it answers for a WHOLE STORE rather than one note, because the question a person actually has is "are my memories
 * still backed by what they say they are backed by?" — and the answer to that is a count with the failures named.
 *
 *   node scripts/kira/verify-memory.mjs [--state <dir>] [--id <rem:…>] [--quiet]
 *
 * WHAT IT CHECKS IS THE ENGINE'S OWN THREE CHECKS, through the same code the route calls (`verifyRecord`), so the command
 * and the route cannot drift apart: the id recomputes from the record's stored fields, the source event re-hashes to the
 * recorded digest, and the Aura chain entry matches. A failure names which of the three failed.
 *
 * A FORGED RECEIPT IS NOT A CHANGED SOURCE. A note whose recorded digest is not a sha256 is REFUSED by name and counted
 * separately, because answering CHANGED would imply the bytes moved when what is actually wrong is that the receipt was
 * never a digest.
 *
 * IT WRITES NOTHING AND IT READS ONLY THE STATE DIR IT IS GIVEN. The session events come through the plugin's one audited
 * read boundary, so this command cannot become a second way into the store.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { percentiles, verifyRecord } from '../../plugins/aukora-kira/lib/memory-verify.mjs'
import { findSessionFile, readCaptureEventStreamed } from '../../plugins/aukora-kira/lib/session-read.mjs'
import { STORE_PATHS, objectFileName } from '../../plugins/aukora-kira/lib/memory-store.mjs'
import { rememberedChainEntry } from '../../plugins/aukora-kira/lib/memory-deps.mjs'

const argv = process.argv.slice(2)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const flag = name => argv.includes(name)

const stateDir = value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home')
const only = value('--id')
const quiet = flag('--quiet')

// *** `--state` MEANS THE STATE HOME, WHICH IS WHAT THE SIBLING COMMAND MEANS BY IT, AND THE STORE LIVES ONE LEVEL BELOW. ***
// Measured 2026-09-26 against Peter's real store: this command reported "no remembered store at .../state/home/remembered" — one
// level above the truth — while 138 records sat at .../state/home/kira-memory/remembered. That is cohesion item 2's shape (one
// meaning for the state directory) in a script that item did not reach: the reader and the writer disagreed about which directory
// `--state` names, so the command reported an empty store on a full one.
const storeDir = join(stateDir, 'kira-memory', STORE_PATHS.remembered)
if (!existsSync(storeDir)) {
  console.log(`kira.verify: no remembered store at ${storeDir} — nothing has been captured yet, so there is nothing to verify.`)
  console.log('(That is an answer, not a failure: an empty store verifies vacuously and this says so rather than counting 0 as OK.)')
  // *** SAID BUT NOT FAILED. *** This branch prints "no remembered store … nothing has been checked" and then exited 0, so anything
  // reading the EXIT CODE read a clean verification of a store that is not there. The sentence was right; the code contradicted it.
  process.exit(2)
}

let files = readdirSync(storeDir).filter(one => one.endsWith('.json'))
if (only !== undefined) {
  // `--id` names one note; a malformed id is refused by the same rule the store uses to name files.
  files = [objectFileName(only)]
}

const answers = []
const forged = []
/** One wall-clock sample per record, in microseconds, for the percentiles below. */
const samples = []
for (const name of files) {
  let record
  try {
    record = JSON.parse(readFileSync(join(storeDir, name), 'utf8'))
  } catch (error) {
    answers.push({ id: name, answer: 'DAMAGED', why: `the object file does not parse: ${String(error?.message ?? error).slice(0, 60)}` })
    continue
  }
  const source = record?.source ?? record?.evidence?.[0]
  const sessionId = source?.sessionId
  const seq = source?.seq
  // HOW LONG ONE RECORD'S VERIFICATION TAKES. The research pass's KIRA plan ends with *"honest records on the live store are 100% intact with
  // p50/p95 reported"*, and its own next item is about the COST of this path (replacing an O(n²) scan), so the percentiles belong beside the
  // count. Wall-clock per record INCLUDING its event read, because that is what verifying one record costs; excluding the read would report a
  // number nobody experiences.
  const startedAt = process.hrtime.bigint()
  try {
    // THE EVENT IS RESOLVED FIRST, THEN THE READER IS SYNCHRONOUS. `verifyRecord` is deliberately synchronous and refuses
    // a reader that does not hand back text — measured 2026-09-26, when this command passed it an async function and every
    // note came back UNVERIFIABLE with "the reader must return the exact canonical event line as text". The refusal was
    // right and this caller was wrong: a Promise is not the line.
    let line = null
    if (typeof sessionId === 'string' && Number.isInteger(seq)) {
      const event = await readCaptureEventStreamed({ stateRoot: stateDir, source })
      line = event === null || event === undefined ? null : event.line
    }
    // THE CHAIN, READ FROM THE CHAIN FILE — the same reader the Memory app's verify route uses. This passed the record's own
    // `aura.entryHash`, so the chain check compared the note with itself and a deleted chain still counted as intact.
    const answer = verifyRecord(record, () => line, () => rememberedChainEntry(join(stateDir, 'kira-memory'), String(record?.id ?? '')))
    // *** A RECEIPT THAT DECLARES ITSELF UNLINKED IS NOT A FAILURE, AND THIS COMMAND USED TO CALL IT ONE. *** kira-122 deliberately
    // made 139 migrated records answer MISSING — `source.state === 'UNLINKED'`: cited, not found, NEVER verified — so this command exited 1
    // on a store that was EXACTLY RIGHT, every time it ran. That is an instrument that cannot pass, which is the same defect as one that
    // cannot fail. The declaration is what separates the two cases, and it is the RECORD's own field rather than a guess from the reason:
    // a LINKED record whose event cannot be found is still a failure and still exits 1.
    const declaredUnlinked = record?.source?.state === 'UNLINKED'
    answers.push({ id: record.id ?? name, answer: answer.source === 'MISSING' && declaredUnlinked ? 'UNLINKED' : answer.source, why: answer.failed ?? null })
  } catch (error) {
    if (String(error?.code ?? '').includes('receipt-forged')) { forged.push({ id: record?.id ?? name, why: String(error.message).slice(0, 80) }); continue }
    answers.push({ id: record?.id ?? name, answer: 'UNVERIFIABLE', why: String(error?.message ?? error).slice(0, 80) })
  } finally {
    // IN A `finally`, SO A FORGED OR UNVERIFIABLE RECORD IS TIMED TOO: those are the slow paths a reader most wants in the tail, and a sample
    // set that quietly omitted them would report a p95 about the easy records only.
    samples.push(Number(process.hrtime.bigint() - startedAt) / 1000)
  }
}

  const counts = { VERIFIED: 0, CHANGED: 0, MISSING: 0, DAMAGED: 0, UNVERIFIABLE: 0, UNLINKED: 0 }
for (const one of answers) counts[one.answer] = (counts[one.answer] ?? 0) + 1

console.log(`kira.verify: ${String(files.length)} note(s) in ${storeDir}`)
  console.log(`  VERIFIED ${String(counts.VERIFIED)}   CHANGED ${String(counts.CHANGED)}   MISSING ${String(counts.MISSING)}   DAMAGED ${String(counts.DAMAGED)}   UNVERIFIABLE ${String(counts.UNVERIFIABLE)}   UNLINKED ${String(counts.UNLINKED)}`)
  if (counts.UNLINKED > 0) console.log(`  UNLINKED is a DECLARED state, not damage: ${String(counts.UNLINKED)} record(s) are cited and their source is not in this store, and kira-122 says they are never verified. They do not fail this command.`)
  // *** THE RESEARCH PASS ASKS FOR THE PERCENTILES BESIDE THE COUNT, AND ASKS FOR "100% INTACT" IN THE SAME SENTENCE. *** So both are printed,
  // and the method is on the line rather than in a document: nearest-rank over ONE wall-clock sample per record, event read included, so every
  // figure IS a measured sample. `intact` reuses the exact expression the exit code uses, so the word and the status can never disagree.
  const timing = percentiles(samples)
  const us = value => (value === null ? 'n/a' : `${value.toFixed(0)}µs`)
  const clean = counts.CHANGED + counts.MISSING + counts.DAMAGED + counts.UNVERIFIABLE + forged.length === 0
  console.log(`  intact ${clean ? 'yes' : 'NO'} — no changed byte, no moved event, no broken chain entry${clean ? '' : ', or a named failure above'}`)
  console.log(`  per record  p50 ${us(timing.p50)}   p95 ${us(timing.p95)}   min ${us(timing.min)}   max ${us(timing.max)}   n ${String(timing.count)} (nearest-rank, one wall-clock sample per record, event read included)`)
if (!quiet) {
  for (const one of answers) {
    if (one.answer === 'VERIFIED') continue
    console.log(`    ${one.answer.padEnd(12)} ${String(one.id).slice(0, 24)}… ${one.why === null ? '' : String(one.why)}`)
  }
  for (const one of forged) console.log(`    FORGED       ${String(one.id).slice(0, 24)}… ${one.why}`)
}
  // A CHANGED, MISSING, DAMAGED or UNVERIFIABLE note is a real answer about a real note, and the exit code says so. UNLINKED IS NOT: it is
  // the record declaring its own receipt state, and counting it here made this command exit 1 on a correct store.
  process.exit(counts.CHANGED + counts.MISSING + counts.DAMAGED + counts.UNVERIFIABLE + forged.length === 0 ? 0 : 1)
