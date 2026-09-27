#!/usr/bin/env node
/**
 * wire-binding.mjs — the Aura lane's bridge to Beta's record↔wire binding check.
 *
 * WHY A CLI AND NOT A PYTHON PORT. A record names `contentDigest` AND `eventId`, and only the digest was
 * ever compared to anything: `wireStatus(stateDir, digest)` re-hashes bytes and asks "is there a wire
 * whose bytes hash to this digest?", which a record RE-POINTED at another message's wire passes, because
 * every half stays individually sound while the PAIRING is false. The binding check is
 * `readRecordWire`/`recordWireStatus` in `plugins/aukora-nostr/lib/evidence.mjs`. Porting that to Python
 * would mean two implementations of one event-id derivation, and two implementations drift — this
 * repository's own rule for cryptography, and the reason the reader calls across rather than copying.
 *
 * WHAT IT PRINTS. One line of JSON on stdout and nothing else, so a caller parses rather than scrapes:
 *   {"status":"present"}
 *   {"status":"unbound","refusal":"nostr-evidence-wire-unbound","reason":"..."}
 * A refusal name is data here, never an exit code the caller has to interpret.
 *
 * EXIT CODES. 0 when the check ran and produced a status (including a non-present one — a status is not
 * an error); 3 when the check could not run at all. The caller must treat 3 as "uncheckable" and refuse,
 * never as "fine": this program's whole purpose is to stop a digest-only answer from being read as
 * "intact".
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

const stateDir = argOf('--state')
const recordPath = argOf('--record')

const emit = (payload, code) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  process.exit(code)
}

if (!stateDir) emit({ status: 'uncheckable', refusal: 'wire-binding-no-state' }, 3)
if (!recordPath) emit({ status: 'uncheckable', refusal: 'wire-binding-no-record' }, 3)

let record
try {
  record = JSON.parse(readFileSync(recordPath, 'utf8'))
} catch (error) {
  emit({ status: 'uncheckable', refusal: 'wire-binding-record-unreadable', reason: String(error.message) }, 3)
}

let evidence
try {
  evidence = await import(new URL('../../plugins/aukora-nostr/lib/evidence.mjs', import.meta.url).href)
} catch (error) {
  emit({ status: 'uncheckable', refusal: 'wire-binding-module-unavailable', reason: String(error.message) }, 3)
}

// The reporting form answers with a status and never throws for a non-present wire; the reading form
// throws BY NAME. Both are asked, because the name is what a caller refuses with, and `status` alone
// cannot distinguish `missing` from `mismatch` from the new `unbound`.
let status
try {
  status = evidence.recordWireStatus(resolve(stateDir), record)
} catch (error) {
  emit({ status: 'uncheckable', refusal: error?.code ?? 'wire-binding-status-threw', reason: String(error?.message) }, 3)
}

let refusal
let reason
try {
  evidence.readRecordWire(resolve(stateDir), record)
} catch (error) {
  refusal = error?.code
  reason = error?.message
}

emit(refusal === undefined ? { status } : { status, refusal, reason }, 0)
