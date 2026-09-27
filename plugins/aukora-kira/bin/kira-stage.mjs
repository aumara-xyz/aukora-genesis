#!/usr/bin/env node
/**
 * OPERATOR COMMAND — stage ONE memory record into the review queue under a NAMED subject.
 *
 * WHY THIS EXISTS, MEASURED. The staging tool takes its subject from the composition the RUNNING
 * process was launched with, and a composition is read once, at launch. On 2026-09-23 the deployment
 * overlay was repointed to the subject this deployment now serves at 17:09:23 while the running
 * process (pid 14945) had started at 16:57:29 — its overlay at launch hashed `5023e135…` and the file
 * on disk hashes `743c490c…`. So the live staging tool in that process would have queued a record
 * under the RETIRED subject: exactly the defect the re-staging exists to end. This command names the
 * subject explicitly, so staging does not depend on when a process happened to start.
 *
 * IT QUEUES; IT DOES NOT SETTLE, AND IT HOLDS NO KEY. Staging is the no-key half: it writes one
 * durable pending entry that a person may approve or ignore, spends nothing, mints no grant, and
 * produces no approval. A queued record is not stored, is not recallable, and proves nothing about a
 * write that has not happened.
 *
 * SUPERSEDING IS DONE BY NAME. A settled record cannot be edited, and a queue entry is not rewritten
 * either: this command records that the NEW record supersedes the old ones, by carrying a
 * `supersedes` link naming each of them. The named entries are left byte-identical, so the marking is
 * auditable and reversible in the only direction that means anything — a later record can supersede
 * this one in turn.
 *
 *   node plugins/aukora-kira/bin/kira-stage.mjs \
 *     --state <stateDir> --subject aukora:1:<64 hex> --note "…" \
 *     [--supersedes <kira:…>]… [--queue-dir <dir>] [--kind <kind>] [--privacy local] [--created-at <instant>]
 *
 * Exit codes: 0 staged (or already queued), 2 refused with a named code, 1 could not run.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const argv = process.argv.slice(2)
/** @param {string} name @param {string} [fallback] */
const option = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}
/** Every occurrence of a repeatable flag, in order. @param {string} name @returns {string[]} */
const options = (name) => argv.reduce((out, value, index) => (value === name && argv[index + 1] !== undefined ? [...out, argv[index + 1]] : out), [])

const stateDir = option('--state')
const subject = option('--subject')
const note = option('--note')
const queueDir = option('--queue-dir')
const kind = option('--kind', 'observation')
const privacy = option('--privacy', 'local')
const supersedes = options('--supersedes')
// A CLOCK READING IS THE HONEST DEFAULT FOR A REAL INSTANT, and `--created-at` exists so a rehearsal
// can be deterministic. Canonical: seconds precision, UTC, `Z`.
const createdAt = option('--created-at', new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'))

const usage = (why) => {
  process.stderr.write(
    `${why}\n`
    + 'usage: kira-stage.mjs --state <dir> --subject <aukora:1:64hex> --note <text>\n'
    + '         [--supersedes <kira:…>]… [--queue-dir <dir>] [--kind <kind>] [--privacy <class>] [--created-at <instant>]\n',
  )
  process.exit(1)
}

if (stateDir === undefined || subject === undefined || note === undefined || note === '') {
  usage('REFUSED: --state, --subject and --note are all required')
}
// THE SUBJECT GRAMMAR IS THE APPROVAL LANE'S. A record outside `aukora:1:<64 hex>` cannot be minted
// or parsed by that lane at all, so it could never be approved: staging one would queue a record that
// no owner can ever settle. There is deliberately no default — a default here is a placeholder
// identity that looks exactly like a real one.
if (!/^aukora:1:[0-9a-f]{64}$/u.test(String(subject))) {
  process.stderr.write(`REFUSE: subject-not-in-approval-grammar: ${String(subject)} is not aukora:1:<64 lowercase hex>\n`)
  process.exit(2)
}

const { kiraRecordContentSha256, memoryEffectBody, stageKiraMemoryRecord, verifyKiraMemoryRecord } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)
// THE SAME CELL THE IN-CHAT kira_stage TOOL USES (2026-09-27): the proposal is produced inside the pinned WASM module and
// proven against the independently computed body before anything is queued. Until today this command skipped the cell.
const { proposeMemoryPutProven } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/wasm-proposal.mjs')).href)
const { MEMORY_PUT_PROPOSAL_WASM_SHA256 } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/wasm-cell/aukora/guest/wasm-proposal-cell.mjs')).href)
const { createMemoryOwner, MEMORY_OWNER_CEILINGS } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const { operationDigestFor } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/approval.mjs')).href)

try {
  const staged = stageKiraMemoryRecord({
    subject,
    kind,
    source: [],
    content: { note },
    // BY NAME, and the id shape is checked by the record layer itself (`links-invalid`), so a typo
    // refuses the whole staging rather than silently marking nothing.
    links: supersedes.map(recordId => ({ recordId, relation: 'supersedes' })),
    privacy,
    createdAt,
  })
  // THROUGH THE CELL: a proposal the cell does not reproduce byte for byte is refused here and nothing is queued.
  proposeMemoryPutProven(staged.memoryPut, staged.memoryPut, {
    expectedBody: memoryEffectBody(staged.memoryPut),
    expectedKey: staged.recordId,
    verify: verifyKiraMemoryRecord,
  })
  process.stdout.write(`CELL proven through the pinned WASM proposal cell (module sha256 ${MEMORY_PUT_PROPOSAL_WASM_SHA256.slice(0, 16)}…)\n`)
  const owner = createMemoryOwner({ stateDir, ...(queueDir === undefined ? {} : { queueDir }) })
  const queued = owner.enqueuePending(staged)
  // THE DIGEST THE GRANT BINDS: the sha256 of the exact `{key, value}` effect body this record would
  // be stored as. Recomputed from the staged bytes by the record module — the same number the review
  // row shows a person, the same number the settled object is named by, and never assembled from
  // anything the caller typed.
  const effectDigest = kiraRecordContentSha256(staged.record)

  process.stdout.write(
    `STAGED ${staged.recordId}\n`
    + `  subject       : ${subject}\n`
    + `  privacy       : ${privacy}\n`
    + `  queued        : ${String(queued.state)}\n`
    + `  effect digest : ${effectDigest}\n`
    + `  operation     : ${operationDigestFor(staged.memoryPut)}\n`
    + `  supersedes    : ${supersedes.length === 0 ? '(nothing named)' : supersedes.join(', ')}\n`
    + '  the named records are NOT modified: a supersession is recorded by naming, never by rewriting\n'
    + '  queued is not stored: this entry is pending, not recallable, and no key was asked for anything\n',
  )
} catch (error) {
  process.stderr.write(`REFUSE: ${error?.code ?? 'UNKNOWN'}: ${error?.message ?? String(error)}\n`)
  // CEILINGS ON THE REFUSED PATH TOO (AUKORA-37 review class 4). A caller who learns what the mechanism
  // does not prove only when it works learns it exactly when it matters least.
  process.stderr.write(`  ceilings      : ${MEMORY_OWNER_CEILINGS.join(' | ')}\n`)
  process.exit(error?.code === undefined ? 1 : 2)
}
