#!/usr/bin/env node
/**
 * settle-approved.mjs — the live settlement leg of `scripts/aura/live-transaction.sh`.
 *
 * WHY THIS IS A NODE DRIVER AND NOT A SHELL VERB. Settlement has no shell entry point:
 * `plugins/aukora-kira/bin/` holds only `kira-approve-queue.mjs` (`--list`, `--next`, `--decline`,
 * `--prepare` — it PREPARES the two documents and stops) and `kira-grant.mjs`. `kira_settle` is an
 * MCP tool, and the same path is reachable in-process through `lib/memory-owner.mjs`, which is what
 * `scripts/kira/memory-accept.mjs` drives. So the one write Peter approved can only be performed
 * from inside node, and this is that call, isolated and guarded.
 *
 * THE DUTY THIS DRIVER CARRIES. It is the single artifact in this lane permitted to write the live
 * store, so it is DRY BY DEFAULT and every missing input is a NAMED REFUSAL, never a default:
 *
 *   node scripts/aura/settle-approved.mjs \
 *     --state <store> --subject aukora:1:<64hex> --note "<text>" \
 *     --grant <grant.json> --approval <approval.json> [--commit]
 *
 *   --grant is the OPERATOR'S document, produced by `bin/kira-grant.mjs`. This driver does NOT call
 *   `owner.grantFor(...)`, because a grant minted by the same turn that wants the write would make
 *   "authorization" and "effect" the same act — the exact collapse the ritual's two documents exist
 *   to prevent. Passing a grant this driver could have minted itself is refused by name.
 *
 *   Without --commit nothing is written and the plan is printed (exit 3). With --commit the settle
 *   runs. There is no third mode.
 *
 * EXIT: 0 settled · 3 dry run, nothing written · 2 a named refusal or bad usage · 4 the live-store fence.
 */
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// THE CEILING PRINTS ON EVERY EXIT, registered above the parsing, which can exit on a bad argument.
// This is the tool that PERFORMS THE WRITE, so its verdict is not a report about the store — it is the
// store changing, and the three things a reader needs are the ones nothing else in the lane can state.
const CEILINGS = [
  'CEILING: THIS_IS_THE_WRITE — a committed run does not describe the store, it changes it. Every earlier leg read; this one does not, and re-running it is not a repeat of a measurement.',
  'CEILING: SINGLE_SHOT — the fence permits ONE settlement. The approval and the nonce are spent by a successful run, so a second attempt is a replay rather than a confirmation.',
  'CEILING: RETAINER_SAME_OWNER — same owner, one host. The store is written where it sits; nothing here is a claim about a replica, a backup, or a second device.',
]
process.on('exit', () => { console.log(''); for (const line of CEILINGS) console.log(line) })

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
// THROWS. The house pattern is `throw refuse(...)`, and a version of this file that only RETURNED
// the error made every guard below a no-op: a bad --subject fell through to a dry run and a missing
// --grant died in a stack trace. MEASURED by courting it, not by reading it.
const refuse = (code, message) => { throw Object.assign(new Error(message), { code }) }

function flags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) refuse('usage', `unexpected argument: ${token}`)
    const name = token.slice(2)
    if (name === 'commit') { out.commit = true; continue }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) refuse('usage', `--${name} needs a value`)
    out[name] = value
    i += 1
  }
  return out
}

const main = async () => {
const args = flags(process.argv.slice(2))

for (const required of ['state', 'subject', 'grant', 'approval']) {
  if (args[required] === undefined || args[required] === '') {
    refuse('missing-input', `--${required} is required; a settlement with an omitted document is not a settlement`)
  }
}

// THE BYTES COME FROM THE QUEUED RECORD, NOT FROM A NOTE. `--record-id` loads the entry the operator
// actually reviewed through `owner.readPending`, so what is settled is what was approved. `--note`
// remains for the side-store rehearsal, where the record is constructed rather than queued, and it is
// refused in preference to a supplied record id rather than silently winning.
if (args['record-id'] === undefined && args.note === undefined) {
  refuse('missing-input', '--record-id <kira:…> is required (or --note for a side-store rehearsal): the bytes to settle must be named, not guessed')
}
if (args['record-id'] !== undefined && args.note !== undefined) {
  refuse('ambiguous-input', 'pass --record-id OR --note, not both: one of them is the source of the bytes and this driver will not choose')
}

if (!/^aukora:1:[0-9a-f]{64}$/.test(args.subject)) {
  refuse('subject-grammar', `--subject must be aukora:1:<64 lowercase hex>, got ${args.subject}`)
}

// THE FENCE, ENFORCED HERE TOO. The bash runner refuses the live root unless the operator asked for
// it explicitly; this driver refuses it unless the same two documents are present, so neither entry
// point can write the live store on a half-formed request.
const LIVE_ROOT = resolve(process.env.HOME ?? '', 'Library/Application Support/AUKORA/state')
const stateDir = resolve(args.state)
if (stateDir === LIVE_ROOT || stateDir.startsWith(LIVE_ROOT + sep)) {
  if (!args.commit) {
    console.error(`REFUSED: --state is inside the live store (${LIVE_ROOT}) and --commit was not given.`)
    process.exit(4)
  }
}

const readDoc = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    refuse(`${what}-unreadable`, `could not read the ${what} document at ${path}: ${cause.message}`)
  }
}

// THE OPERATOR'S GRANT FILE IS THE AUTHORIZATION ENVELOPE, not a bare grant: `kira-grant.mjs`
// writes `{ grant, record, subject }` — MEASURED, and a first version of this driver looked for a
// top-level `effectDigest`, refused every honest grant with `grant-unbound`, and would have looked
// like a working guard. Accept the envelope or a bare grant; refuse anything else by name.
const grantDoc = readDoc(args.grant, 'grant')
const grant = grantDoc?.grant ?? grantDoc
if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) {
  refuse('grant-malformed', 'the grant document is neither an authorization envelope nor a grant object')
}
const approvalDoc = readDoc(args.approval, 'approval')
// The approval file is likewise the receipt (or an envelope carrying one).
const approval = approvalDoc?.approval ?? approvalDoc

// A grant with no effect digest binds nothing, and one naming a different subject is for another owner.
if (grant.effectDigest === undefined) {
  refuse('grant-unbound', 'the grant document carries no effectDigest, so it binds no effect')
}

const memoryOwner = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const owner = memoryOwner.createMemoryOwner({ stateDir })

let staged
let memoryPut
if (args['record-id'] !== undefined) {
  // THE APPROVED RECORD'S OWN BYTES. The named refusals mirror the operator command's, because the
  // ways a queued entry can fail to be settleable are the same ways here.
  const found = owner.readPending(args['record-id'])
  if (found.state === 'absent') refuse('queue-entry-absent', `no queue entry names ${args['record-id']}`)
  if (found.state === 'unreadable') {
    refuse('queue-entry-unreadable',
      `the queue entry for ${args['record-id']} does not verify (${String(found.reason)}); its bytes differ from what was staged`)
  }
  if (found.settled === true) refuse('already-settled', `${args['record-id']} is already in the store`)
  const record = found.entry.record
  memoryPut = Object.freeze({ key: args['record-id'], value: record })
  staged = { recordId: args['record-id'], memoryPut, subject: args.subject }
} else {
  const record = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)
  staged = record.stageKiraMemoryRecord({
    subject: args.subject,
    kind: 'observation',
    source: [],
    content: { note: args.note },
    links: [],
    privacy: 'local',
    createdAt: args['created-at'] ?? '2026-09-18T00:00:00Z',
  })
  memoryPut = staged.memoryPut
}

// WHAT THE GRANT MUST BIND, checked BEFORE any write: the grant's effect digest against the effect
// this record would have. A grant for other bytes is refused by name rather than spent and refused
// later by the store.
const bound = owner.grantFor(memoryPut, {})
if (grant.effectDigest !== bound.effectDigest) {
  refuse('grant-binds-other-bytes',
    `the operator's grant binds ${grant.effectDigest}, but this record's effect is ${bound.effectDigest}; ` +
    'a grant that names other bytes cannot spend on these')
}

if (args.commit !== true) {
  console.log('SETTLE-APPROVED: DRY RUN, nothing written')
  console.log(`  record   : ${staged.recordId}`)
  console.log(`  effect   : ${bound.effectDigest}`)
  console.log(`  grant    : ${args.grant} (binds these bytes)`)
  console.log(`  approval : ${args.approval}`)
  console.log(`  subject  : ${args.subject}`)
  console.log(`  store    : ${stateDir}`)
  console.log('  pass --commit to perform the one settlement.')
  process.exit(3)
}

// THE ONE WRITE. The operator's grant is passed through; the owner refuses a settle with no approval.
const settled = owner.settle(staged, grant, approval, { subject: args.subject })
console.log('SETTLE-APPROVED: SETTLED')
console.log(`  record     : ${settled.recordId ?? staged.recordId}`)
console.log(`  seq        : ${settled.seq ?? settled.history?.seq ?? 'unnamed'}`)
console.log(`  head       : ${settled.head ?? settled.verifiedHead ?? 'unnamed'}`)
process.exit(0)
}

try {
  await main()
} catch (error) {
  if (error?.code === undefined || typeof error.code !== 'string') throw error
  console.error(`REFUSED: ${error.code} — ${error.message}`)
  process.exit(2)
}
