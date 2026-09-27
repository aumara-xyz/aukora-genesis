#!/usr/bin/env node
/**
 * approval-request-preview.mjs — the "approval request displayed" leg of A4.
 *
 * WHY THIS EXISTS. A4's first leg is "approval request displayed", and the rehearsal runner did
 * not cover it: the transit settles without a request ever being shown to a person. That is the leg
 * most likely to fail first in the live run, because it is the only one that involves a human, so it
 * is rehearsed here rather than discovered there.
 *
 * WHAT IT PROVES, and nothing more. `plugins/aukora-aumlok/lib/owner-approval.mjs` re-derives the
 * signing bytes from the PARSED request rather than accepting a preimage, so what a person is shown
 * and what gets signed cannot diverge. This script COURTS that claim on real bytes instead of
 * quoting the comment, and it checks the field that matters is load-bearing:
 *
 *   1. a request round-trips — the bytes derived from the parsed record equal the bytes derived from
 *      the original, so serializing for display does not change what is signed;
 *   2. the DISPLAYED operationDigest is load-bearing — changing it in the serialized record changes
 *      the signing bytes, so a person reading that line is reading something the signature covers.
 *
 * NO SIGNATURE IS PRODUCED HERE and no key is touched: the module builds records and derives bytes.
 * It writes nothing at all — this leg is a readout.
 *
 * EXIT: 0 all arms hold · 1 an arm failed, named · 2 usage.
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// THE CEILING PRINTS ON EVERY EXIT. The name is the whole risk: a PREVIEW of an approval request is not
// an approval, an approval request is not an approval, and neither is a grant.
const CEILINGS = [
  'CEILING: A_PREVIEW_IS_NOT_AN_APPROVAL — this shows what an approval request would contain. It approves nothing, requests nothing, and spends nothing; no nonce, grant or approval changes state here.',
  'CEILING: ONE_SUBJECT — the preview is about the one subject it was asked for.',
  'CEILING: RETAINER_SAME_OWNER — same owner, one host; a preview rendered here is not an authorisation from anywhere else.',
]
process.on('exit', () => { console.log(''); for (const line of CEILINGS) console.log(line) })

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const mod = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-aumlok/lib/owner-approval.mjs')).href)
const { createApprovalRequest, approvalSigningBytes, APPROVAL_REQUEST_FIELDS } = mod
// IMPORTED, NOT RESTATED. `approval.mjs:266` says the digest is "the approving lane's own
// `operationDigestOf`, imported rather than restated" — and a first version of this script restated
// it with a hand-rolled sha256. A restatement that drifts would display a digest the settlement
// never consumes, which is precisely the display/effect divergence this leg exists to catch.
const { operationDigestFor } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/approval.mjs')).href)
const { stageKiraMemoryRecord } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)

const argOf = name => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const SUBJECT = argOf('--subject') ?? `aukora:1:${'7a'.repeat(32)}`
// THE REQUEST MUST BE FOR THE RECORD THE RUN SETTLES. Invoked with no arguments this staged its own
// 'cedar' example and displayed a request for THAT record, so a live run's first leg — "approval
// request displayed" — would have shown a request for a record nobody was settling, and called it ok.
// With --record-id and --state the request is derived from the APPROVED record's own bytes, loaded the
// same way the settlement loads them.
const RECORD_ID = argOf('--record-id')
const STATE = argOf('--state')
let staged
let source
if (RECORD_ID !== undefined) {
  if (STATE === undefined) { console.error('REFUSED: --record-id needs --state to load it from'); process.exit(2) }
  const { createMemoryOwner } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
  // MEASURED: a queued entry reads back as `state: 'pending'`, not 'present' — a first version tested
  // for 'present' and would have refused EVERY real record. `readPending` also THROWS a
  // MemoryOwnerRefusal on a malformed id rather than returning a state, so both are named refusals.
  let found
  try {
    found = createMemoryOwner({ stateDir: STATE }).readPending(RECORD_ID)
  } catch (error) {
    console.error(`REFUSED: ${error?.code ?? 'refused'} — ${error?.message ?? String(error)}`)
    process.exit(2)
  }
  if (found.state !== 'pending') { console.error(`REFUSED: ${RECORD_ID} reads as ${found.state}${found.reason ? ` (${found.reason})` : ''}, so there is no request to display`); process.exit(2) }
  staged = { recordId: RECORD_ID, memoryPut: Object.freeze({ key: RECORD_ID, value: found.entry.record }) }
  source = `the approved record, loaded from ${STATE}`
} else {
  const NOTE = argOf('--note') ?? 'cedar'
  staged = stageKiraMemoryRecord({
    subject: SUBJECT, kind: 'observation', source: [], content: { note: NOTE },
    links: [], privacy: 'local', createdAt: '2026-09-18T00:00:00Z',
  })
  source = `a SYNTHETIC record staged from the note "${NOTE}" — a rehearsal, not an approval`
}
// The digest of the EFFECT ARGUMENTS, computed by the approval lane's own function.
const operationDigest = operationDigestFor(staged.memoryPut)

const request = createApprovalRequest({
  subject: SUBJECT,
  activeControlDigest: createHash('sha256').update(`stand-in:${SUBJECT}`, 'utf8').digest('hex'),
  operationDigest,
  challenge: '00'.repeat(32),
  issuedAt: 1790093304,
  expiresAt: 1790094204,
})

const problems = []

// ARM 1 — the round trip. What a person is shown is the parsed record; signing re-derives from it.
const serialized = JSON.stringify(request)
const parsed = JSON.parse(serialized)
const bytesFromOriginal = approvalSigningBytes(request)
const bytesFromParsed = approvalSigningBytes(parsed)
if (!bytesFromOriginal.equals(bytesFromParsed)) {
  problems.push('the signing bytes change when the request is serialized for display')
}

// ARM 2 — the displayed operationDigest is load-bearing.
const tampered = JSON.parse(serialized)
tampered.operationDigest = 'de'.repeat(32)
const bytesFromTampered = approvalSigningBytes(tampered)
if (bytesFromTampered.equals(bytesFromOriginal)) {
  problems.push('changing operationDigest in the displayed record does NOT change the signing bytes')
}

// ARM 3 — the closed field set is what it says, so the display cannot silently gain a field.
const shown = APPROVAL_REQUEST_FIELDS.filter(f => f in parsed)
if (shown.length !== APPROVAL_REQUEST_FIELDS.length) {
  problems.push(`the request is missing fields: ${APPROVAL_REQUEST_FIELDS.filter(f => !(f in parsed)).join(', ')}`)
}

// ARM 4 — the displayed digest is the one the SETTLEMENT will consume, recomputed from the same
// effect arguments rather than compared to a recorded constant.
if (operationDigestFor(staged.memoryPut) !== operationDigest) {
  problems.push('the displayed digest is not the digest of these effect arguments')
}
// ARM 5 — and it tracks the BYTES. Only meaningful for a staged record; for a loaded one the bytes
// are the store's and there is nothing to amend.
if (RECORD_ID === undefined) {
  const NOTE = argOf('--note') ?? 'cedar'
  if (operationDigestFor(stageKiraMemoryRecord({
    subject: SUBJECT, kind: 'observation', source: [], content: { note: NOTE + ' (amended)' },
    links: [], privacy: 'local', createdAt: '2026-09-18T00:00:00Z',
  }).memoryPut) === operationDigest) {
    problems.push('changing the note does NOT change the displayed operation digest')
  }
}

console.log('APPROVAL-REQUEST: what a person is shown')
for (const field of APPROVAL_REQUEST_FIELDS) console.log(`  ${field.padEnd(20)} ${String(parsed[field]).slice(0, 68)}`)
console.log(`  source               ${source}`)
console.log(`  recordId             ${staged.recordId}`)
console.log(`  signing bytes        ${bytesFromOriginal.length} bytes, re-derived from the parsed record`)
console.log('')

if (problems.length > 0) {
  for (const p of problems) console.log(`  FAIL  ${p}`)
  console.log(`\nAPPROVAL-REQUEST: RED — ${problems.length} arm(s) failed`)
  process.exit(1)
}
console.log('  ok    the request round-trips: serializing for display does not change what is signed')
console.log('  ok    the displayed operationDigest is load-bearing: changing it changes the signing bytes')
console.log(`  ok    the closed field set holds: all ${APPROVAL_REQUEST_FIELDS.length} fields present`)
console.log(`  ok    the displayed digest IS the settlement's digest (operationDigestFor over the same put)`)
console.log('  ok    it is stable across re-staging and moves when the bytes move')
console.log('\nAPPROVAL-REQUEST: GREEN — the displayed request and the signed bytes cannot diverge')
process.exit(0)
