#!/usr/bin/env node
/**
 * APPROVE ONE QUEUED RECORD THROUGH THE WITNESS — the operator half of the review queue.
 *
 * WHERE THIS SITS. `kira_stage` leaves a record in the pending queue and `kira_queue` lists what is
 * waiting, but a queued record is only *listed*: turning one into memory still needs a one-use grant and
 * an owner approval, and both are operator acts the model is forbidden to perform. The shipped approval
 * producer re-stages a record from `--note`, which is right for a note-shaped record and wrong for a
 * queue entry whose content is arbitrary JSON — so nothing could address a queue entry's EXACT bytes.
 * This command is that missing address: it reads one entry, mints the grant for the bytes that entry
 * actually carries, drives the signer through the shipped producer, and performs the governed
 * transition.
 *
 * THE WITNESS IS THE POINT. The signer is shown the exact content bytes and signs the digest over them;
 * the human-facing guarantee is the approving lane's ("what is displayed is what is digested, or
 * nothing is signed"), and this command neither re-implements nor restates it — it hands the producer
 * the same bytes it computed the digest from, and `settleAuthorized` recomputes the digest from the
 * bytes about to be written. A mismatch refuses.
 *
 * WHAT IT CANNOT DO, and these are printed on every run rather than only written here: it holds no key,
 * it makes no decision, and it cannot enrol. Until an owner enrols, the approval is a LABELLED TEST
 * artifact — `approvalClass` scripted or delegated, `keyClass` B — and `attendance` stays
 * `reported-not-proven`. A dialog result does not identify the clicker, so this command never reports
 * that a person approved anything.
 *
 * IT IS AN OPERATOR COMMAND, NOT A TOOL. There is deliberately no model-facing `kira_approve`: a model
 * that could approve its own staged records would be a model that could write memory without a person,
 * which is the one thing this whole path exists to prevent.
 *
 * USAGE
 *   node plugins/aukora-kira/bin/kira-approve-queue.mjs --state <store> --list
 *   node plugins/aukora-kira/bin/kira-approve-queue.mjs --state <store> --record <kira:…> \
 *     --controller <aumlok controller dir> --signer-socket <path> [--expires-in 600] \
 *     [--queue-dir <dir>] [--documents <file>] [--work <dir>] [--approve-operation <path>]
 *
 * EXIT  0 settled · 1 a named refusal · 2 a usage error
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
// THE PREPARED GRANT AND THE APPROVAL ARTIFACT ARE READ STRICTLY: these are the two files whose contents decide
// whether a settlement proceeds, so a symlink, a FIFO or a repeated key must refuse rather than be followed.
import { readJsonStrict } from '../lib/strict-read.mjs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const { createMemoryOwner, MEMORY_OWNER_CEILINGS } = await import(
  pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href
)
const { memoryEffectBody } = await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)
const { operationDigestFor } = await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/approval.mjs')).href)

/** Stable machine-readable refusal codes for this command's own route. */
const ROUTE = 'kira.approve'

/**
 * @param {string} code @param {string} message @returns {never}
 */
function refuse(code, message) {
  process.stderr.write(`REFUSE: ${ROUTE}:${code}: ${message}\n`)
  // THE CEILINGS, ON THE REFUSED PATH TOO (AUKORA-37 classes 4 and 5), read from the module that owns
  // them so this line cannot drift from the list the success path prints.
  process.stderr.write(`  ceilings      : ${MEMORY_OWNER_CEILINGS.join(' | ')}\n`)
  process.exit(1)
}

/** @param {string} message @returns {never} */
function usage(message) {
  process.stderr.write(`${message}\n`
    + `usage: kira-approve-queue.mjs --state <store> --list\n`
    + `       kira-approve-queue.mjs --state <store> (--record <kira:…> | --next)\n`
    + `         --controller <dir> --signer-socket <path> [--expires-in <seconds>]\n`
    + `         [--queue-dir <dir>] [--documents <file>] [--work <dir>] [--approve-operation <path>]\n`
    + `         [--approval-class scripted|delegated|unattributed] [--key-class A|B|C]\n`)
  process.exit(2)
}

/**
 * @param {string} flag @returns {string|undefined}
 */
function option(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) usage(`${flag} needs a value`)
  return value
}

const LIST = process.argv.includes('--list')
const NEXT = process.argv.includes('--next')
// `--decline <id>` AND `--prepare <id>` BOTH SPELL THE RECORD AS THE FLAG'S VALUE, and both also work
// as bare modes beside `--record <id>`. The value form is the owner's spelling; the bare form keeps the one
// existing way of naming a record usable, so a mode never forces a second vocabulary on the operator.
const DECLINE_TARGET = option('--decline')
const PREPARE_TARGET = option('--prepare')
const DECLINE = DECLINE_TARGET !== undefined || process.argv.includes('--decline')
const PREPARE = PREPARE_TARGET !== undefined || process.argv.includes('--prepare')
const stateDir = option('--state')
if (stateDir === undefined) usage('--state is required (the memory store the composition serves)')

const owner = createMemoryOwner({
  stateDir,
  ...(option('--queue-dir') === undefined ? {} : { queueDir: option('--queue-dir') }),
})

// ── `--list`: the same queue the tool shows, so an operator never has to open the app to see it ────
if (LIST) {
  const listing = owner.listPending()
  if (listing.exists !== true) { process.stdout.write('PENDING: none — nothing has ever been queued for this store\n'); process.exit(0) }
  process.stdout.write(`PENDING: ${String(listing.pending)} of ${String(listing.total)} entr(ies) awaiting a decision\n`)
  for (const row of listing.entries) {
    const where = row.state === 'unreadable' ? `UNREADABLE (${String(row.reason)})` : String(row.state)
    process.stdout.write(`  ${where.padEnd(22)} ${String(row.recordId ?? row.name)}  ${String(row.kind ?? '')} ${String(row.createdAt ?? '')}\n`)
    if (typeof row.text === 'string') process.stdout.write(`      ${row.text.slice(0, 160)}${row.truncated === true ? '…' : ''}\n`)
  }
  process.exit(0)
}

// ── resolve ONE entry, and refuse by name on every way it can fail ────────────────────────────────
let recordId = option('--record') ?? DECLINE_TARGET ?? PREPARE_TARGET
if (NEXT) {
  const listing = owner.listPending()
  const first = listing.exists === true ? listing.entries.find(row => row.state === 'pending') : undefined
  if (first === undefined) refuse('nothing-pending', 'no queued entry is awaiting a decision; nothing was approved and nothing was written')
  recordId = String(first.recordId)
}
if (recordId === undefined || recordId === '') usage('--record <kira:…> or --next is required (or use --list)')

// THE SETTLEMENT AUTHORITY IS PRINTED, NOT IMPLIED: SAME_UID is a mode with no boundary between the
// approver and the agent, and a reader must not have to infer it from the absence of a warning.
process.stdout.write(`  settle authority       ${String(owner.settleAuthority().mode)}\n`)
const found = owner.readPending(recordId)
if (found.state === 'absent') {
  refuse('queue-entry-absent', `no queue entry names ${recordId}; nothing was approved and nothing was written`)
}
if (found.state === 'unreadable') {
  // THE ENTRY'S BYTES CHANGED SINCE IT WAS QUEUED. This is the refusal that matters most: an approval
  // binds exact bytes, so approving a damaged entry would mean approving something nobody reviewed.
  refuse('queue-entry-unreadable',
    `the queue entry for ${recordId} does not verify (${String(found.reason)}); its bytes differ from what was `
    + 'staged, so nothing was approved and nothing was written')
}
if (found.settled === true) {
  refuse('already-settled', `${recordId} is already in the store; a second approval would be a second authorization, not a correction`)
}

const record = found.entry.record
const memoryPut = Object.freeze({ key: recordId, value: record })

const controller = option('--controller')
const socketPath = option('--signer-socket')
const expiresInRaw = option('--expires-in') ?? '600'
if (controller === undefined) usage('--controller is required: the approval must be pinned to a control')
if (socketPath === undefined) usage('--signer-socket is required; there is no default signer')
if (!/^[0-9]+$/u.test(expiresInRaw)) usage('--expires-in must be whole seconds')
// THE APPROVER PIN IS CHECKED BEFORE ANYONE IS ASKED, so a missing pin never wastes the owner's click.
if (!DECLINE && !(typeof option('--approver-did') === 'string' && option('--approver-did').startsWith('did:key:'))) {
  usage('--approver-did <did:key:…> is required to settle: the approval key this store trusts')
}

const producer = option('--approve-operation') ?? join(ROOT, 'scripts', 'aumlok', 'approve-operation')
if (!existsSync(producer)) refuse('producer-absent', `the approval producer is not present at ${producer}`)

// The controller's own identity, read rather than typed: the subject a deployment serves is DERIVED,
// and a literal here would be an invented identity that looks exactly like a real one.
const { loadLocalAumlokPublicControl } = await import(
  pathToFileURL(join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'index.mjs')).href
)
let projection
try {
  ({ projection } = loadLocalAumlokPublicControl(controller))
} catch (error) {
  refuse('controller-unreadable', `the controller could not be read: ${error?.code ?? String(error?.message ?? error)}`)
}
// THE RECORD MUST BE THIS CONTROLLER'S. An approval binds a subject, and a record staged for another
// subject would settle into a memory this deployment's read owner can never show.
if (record.subject !== projection.subject) {
  refuse('subject-mismatch',
    `the queued record names subject ${String(record.subject)} and this controller serves ${String(projection.subject)}; `
    + 'nothing was approved and nothing was written')
}

const KEEP = process.argv.includes('--keep')
const explicitWork = option('--work')
const work = explicitWork ?? mkdtempSync(join(tmpdir(), 'kaq-'))
mkdirSync(work, { recursive: true })

// **THE DIRECTORY IS OURS UNLESS THE CALLER NAMED IT OR ASKED TO KEEP IT — AND IT GOES AWAY ON EVERY EXIT PATH.**
// Measured on Peter's Mac: 3,005 stale directories, 5.7 GB, of which 1,794 were `kira-approve-queue-*` — one for
// EVERY run of this command, because the directory was created here and never removed. Success, a refusal, a
// thrown error and a signal all leave this handler to run: `process.on('exit')` fires for `process.exit(n)` and
// for an uncaught throw, and the two signal handlers funnel into it. A caller that passed `--work` owns its
// directory and this command must not delete it; `--keep` says the same thing explicitly.
if (explicitWork === undefined && !KEEP) {
  process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* best effort */ } })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { process.exit(130) })
}

// ── the grant, for the EXACT bytes the entry carries ──────────────────────────────────────────────
// Minted from the queued record rather than re-staged from a note, which is the whole reason this
// command exists: a queue entry's content is arbitrary, and re-staging it from prose would bind
// different bytes and be refused later with the grant unspent.
const expiresAt = Math.floor(Date.now() / 1000) + Number(expiresInRaw)
let grant = owner.grantFor(memoryPut, { expiry: expiresAt })

/**
 * THE GRANT A DECISION BINDS IS THE ONE ALREADY PREPARED, when there is one.
 *
 * Minting a second grant in the `--decline` run would bind a fingerprint that no prepared bundle
 * carries, so the decline would be STALE against the very approval it exists to supersede — the refusal
 * would never fire and the settle would succeed. MEASURED: the arm `prepare -> decline -> settle` is the
 * only ordering in which that bug is visible, because it is the only one where a decision and the
 * documents it is about are produced by DIFFERENT runs. The prepared grant is therefore stored, and a
 * decline reads it back rather than minting its own.
 */
const preparedGrantPath = join(owner.queueDir, 'settlement', 'grant.json')
// ONLY A PREPARED GRANT FOR *THESE* BYTES MAY BE REUSED. A stored grant belongs to the record it was
// prepared for; reusing it for another record produced the live defect above. Its `effectDigest` is
// the same number the declined document carries, so the test is exact.
const storedGrantMatches = DECLINE && existsSync(preparedGrantPath)
  && readJsonStrict(preparedGrantPath).effectDigest === grant.effectDigest
if (storedGrantMatches) {
  try {
    grant = readJsonStrict(preparedGrantPath)
  } catch (error) {
    refuse('prepared-grant-unreadable',
      `the prepared grant could not be read (${error?.code ?? 'unreadable'}); a decline that cannot name the grant it supersedes is not a decline`)
  }
}

const operationPath = join(work, 'operation-content.txt')
const contentBytes = memoryEffectBody(memoryPut)
writeFileSync(operationPath, contentBytes, { mode: 0o600 })
// Computed from the bytes about to be written, by the approving lane's own rule imported rather than
// restated, and handed to the producer so the artifact binds what this command will settle.
const operationDigest = operationDigestFor(memoryPut)

const artifactPath = join(work, 'artifact.json')
const produced = spawnSync(process.execPath, [
  producer,
  '--controller', controller,
  '--expect-subject', projection.subject,
  '--expect-control-digest', projection.activeControlDigest,
  '--operation', operationPath,
  '--operation-digest', operationDigest,
  '--signer-socket', socketPath,
  '--artifact-out', artifactPath,
  '--expires-at', String(expiresAt),
  // THE APPROVAL CLASS IS THE OPERATOR'S STATEMENT, passed through rather than invented here. A signer
  // running its labelled test procedure deserves `scripted`; a genuine delegated key deserves
  // `delegated`. `approval.mjs` refuses `human-ceremony` outright and treats this field as a LABEL
  // outside the signed preimage, so the honest thing is for the person who knows which procedure ran to
  // say so — never for this command to pick the flattering word.
  ...(option('--approval-class') === undefined ? [] : ['--approval-class', option('--approval-class')]),
  ...(option('--key-class') === undefined ? [] : ['--key-class', option('--key-class')]),
], { encoding: 'utf8' })
if (produced.status !== 0) {
  // The producer's own refusal name travels through, because "the signer declined" and "the artifact
  // could not be written" call for different actions.
  refuse('producer-refused',
    `the approval producer exited ${String(produced.status)}: ${producerRefusal(produced)}`)
}
if (!existsSync(artifactPath)) refuse('artifact-absent', 'the producer reported success and wrote no artifact; nothing was settled')
const approval = readJsonStrict(artifactPath)

/**
 * THE PRODUCER'S OWN REFUSAL, NOT WHICHEVER LINE IT PRINTED LAST.
 *
 * The producer's stderr ENDS with its ceilings — `CEILING: …` lines and then
 * `ATTENDANCE: not-claimed-by-this-lane`, which is a statement about what this lane can prove and never
 * a reason for anything to fail (plugins/aukora-aumlok/lib/ceilings.mjs). Composing this message with
 * `.split('\n').slice(-1)[0]` therefore reported a CEILING as the cause of every producer failure, and
 * the refusal itself — which the comment above says must travel through, because "the signer declined"
 * and "the artifact could not be written" call for different actions — was discarded. That is how a
 * signer refusal reached a reader as "ATTENDANCE: not-claimed-by-this-lane".
 *
 * PREFER THE NAMED LINES the producer prints for exactly this purpose (`REFUSED:` and `DETAIL:`), so the
 * caller is sent to the fact. Fall back to the last few lines, and say when there was nothing at all.
 */
function producerRefusal(produced) {
  const text = (produced.stderr || produced.stdout || '').trim()
  if (text.length === 0) return 'the producer printed nothing'
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const named = lines.filter(line => /^(REFUSED|DETAIL):/.test(line))
  if (named.length > 0) return named.join(' ')
  return lines.slice(-4).join(' | ').slice(0, 600)
}

/** Write the two operator documents to the one file a composition may name twice. */
function writeDocuments(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    authorization: { grant, record, subject: projection.subject },
    approval,
  }, null, 2)}\n`, { mode: 0o600 })
}

// ── R4 (1): `--prepare` MINTS AND STOPS ───────────────────────────────────────────────────────────
// WITHOUT IT THERE IS NO WINDOW IN WHICH A DECLINE COULD SUPERSEDE ANYTHING: the default path mints the
// grant, obtains the approval and settles in one run, so the approval is never outstanding. `--prepare`
// writes the two documents and the `approved` decision and stops, leaving the grant UNSPENT — which is
// what makes "the later decision wins" a fact about two markers rather than about one being absent.
if (PREPARE) {
  // PER RECORD, like the decline below: the gate reads the decision about THESE BYTES, so an approval
  // that recorded only the single latest-decision marker would leave a decline of the same record in
  // force — R4 says the later decision wins, and it can only win if it is written where the gate looks.
  // THE CONTENT DIGEST, WHICH IS THE NUMBER THE GATE LOOKS UP — not `operationDigestFor`, which is
  // domain-separated for the approval preimage and is a DIFFERENT number. Filed under that one, this
  // approval was invisible to the gate and a decline of the same record stayed in force, which is how
  // `kira-decline`'s decline-then-prepare-then-settle arm caught it.
  owner.writeDecision(grant, 'approved', Math.floor(Date.now() / 1000), createHash('sha256').update(memoryEffectBody(memoryPut), 'utf8').digest('hex'))
  // THE GRANT IS STORED, not merely used: it is what a later `--decline` must bind, and a decision that
  // cannot name the grant it is about is a decision about nothing.
  mkdirSync(join(owner.queueDir, 'settlement'), { recursive: true, mode: 0o700 })
  writeFileSync(join(owner.queueDir, 'settlement', 'grant.json'), `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600 })
  if (option('--documents') !== undefined) writeDocuments(/** @type {string} */ (option('--documents')))
  process.stdout.write(
    `PREPARED ${recordId}\n`
    + `  grantDigest : ${owner.grantFingerprint(grant)}\n`
    + '  the grant is UNSPENT, the decision marker reads `approved`, and nothing was settled.\n',
  )
  process.exit(0)
}

// ── R4 (1): `--decline` SUPERSEDES THE APPROVAL THIS VERY RUN JUST MINTED ─────────────────────────
// THE DECLINE HAPPENS HERE, AFTER THE SIGNER HAS APPROVED, and that placement is the point: a valid
// signed approval now exists on disk and the marker still outweighs it. Earlier in the run there would
// be nothing to supersede. NOTHING IS CONSUMED — no nonce, no approval marker, no object, no Aura
// entry — and the approval file is left BYTE-UNCHANGED as audit, because a decline is a later fact
// about an operation, not an erasure of an earlier one.
if (DECLINE) {
  const document = owner.writeDeclined(memoryPut)
  // THE DECISION NAMES THE BYTES, NOT ONLY THE GRANT (MEASURED 2026-09-24 ON THE LIVE STORE):
  // declining two never-prepared entries wrote a marker binding a stored grant that belonged to
  // neither, so neither decline could refuse a settle of the record it named. The digest here is the
  // one the declined document already carries — the sha256 of the exact effect body.
  const marker = owner.writeDecision(grant, 'declined', Math.floor(Date.now() / 1000), document.proposalDigest)
  if (option('--documents') !== undefined) writeDocuments(/** @type {string} */ (option('--documents')))
  process.stdout.write(
    `DECLINED ${recordId}\n`
    + `  grantDigest   : ${String(marker.grantDigest)}\n`
    + `  proposalDigest: ${String(document.proposalDigest)}\n`
    + `  decidedAt     : ${String(marker.decidedAt)}\n`
    + '  the marker binds THIS grant and supersedes the signed approval above;\n'
    + '  nothing was consumed — the grant is unspent and the approval file is untouched.\n',
  )
  process.exit(1)
}

// ── the governed transition ───────────────────────────────────────────────────────────────────────
let settled
// PINNED (2026-09-27, red team): without these two the settle accepted an approval signed by ANY Ed25519 key under ANY control
// head — the pins were applied only when supplied, and this command never supplied them.
const pinnedApprover = option('--approver-did')
try {
  settled = owner.settleAuthorized({
    authorization: { grant, record, subject: projection.subject },
    approval,
    subject: projection.subject,
    approverDid: pinnedApprover,
    activeControlDigest: projection.activeControlDigest,
  })
} catch (error) {
  refuse('settle-refused', `${String(error?.code ?? 'unavailable')}: ${String(error?.message ?? error)}`)
}

if (option('--documents') !== undefined) {
  // Written only AFTER the transition, so the file can never be present while the write it describes
  // has not happened — a bundle that outlives its spend would be replayed.
  writeDocuments(/** @type {string} */ (option('--documents')))
}

process.stdout.write(
  `SETTLED ${recordId}\n`
  + `  sequence      : ${String(settled.sequence)}\n`
  + `  head          : ${String(settled.head)}\n`
  + `  contentSha256 : ${String(settled.contentSha256)}\n`
  + `  approvalId    : ${String(settled.approvalId)}\n`
  + `  operationDigest: ${operationDigest}\n`
  + `  approvalClass : ${String(approval.approvalClass)} keyClass ${String(approval.keyClass)} attendance ${String(approval.attendance)}\n`
  + `  source        : the signer on ${socketPath} — a separate process holding the key, which made the decision\n`
  + 'SCRIPTED_APPROVAL_IS_NOT_A_HUMAN_YES: the artifact records an approval CLASS and an attendance FIELD;\n'
  + '  neither is a person, and a dialog result does not identify the clicker. LABELLED TEST until an owner enrols.\n'
  + `  ceilings      : ${MEMORY_OWNER_CEILINGS.join(' | ')}\n`,
)
