#!/usr/bin/env node
/**
 * THE ORIGINAL MEMORY LAW ON KIRA'S LIVE PATH — one check.
 *
 *   node tests/kira-memory-law.test.mjs          # the arms, green
 *   node tests/kira-memory-law.test.mjs --red    # each guard removed in turn: its arm must go red
 *
 * The law is aumara-xyz/aukora packages/memory @ def297f (vendor/aukora-packages), called through
 * plugins/aukora-kira/lib/memory-law.mjs. Two rules:
 *
 *   1. TIERS. An auto-captured remembered note is the unsigned tier: advisory, never authority, and never in the approved
 *      chain or the public evidence export.
 *   2. FORGETTING. A forget leaves the law's content-free tombstone `{kind: 'tombstone', recordId, at}`, never the words.
 *
 * WHAT RUNS. The capture is the live hook (`registerRememberedCapture`, mounted at plugins/aukora-kira/lib/index.js:434)
 * driven with a stand-in context and a real zstd session file; the export is `scripts/kira/public-evidence.mjs`; the forget
 * is `routeRequest` (the Memory app's POST /api/kira/memories/forget) over `buildRouteDeps`, as index.js:640 composes them.
 *
 * CEILINGS. The approved record is settled with a disposable software key from the daemon-free approval test double.
 * The owner checks its signature; this proves no popup interaction or live deployment. Disposable state under the OS temp directory only; the live support
 * folder is never opened. `--red` never writes a mutant to disk: each child applies ONE guard removal in memory through a
 * module load hook, and the mutation must match its guard text exactly once or the child refuses to run.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

const HERE = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(HERE), '..')

// ── the guards, and the one-line removal of each ─────────────────────────────────────────────────────────────────────
const MUTANTS = Object.freeze({
  'one-chain': {
    file: 'plugins/aukora-kira/lib/memory-store.mjs',
    from: "rememberedAura: 'remembered/aura.jsonl'",
    to: "rememberedAura: 'aura.jsonl'",
    arm: 'tiers: the export carries the approved record and nothing of the remembered note',
  },
  'law-call-removed': {
    file: 'plugins/aukora-kira/lib/memory-store.mjs',
    from: '    qualifyUnsignedNote(note)\n',
    to: '',
    arm: 'tiers: the law refuses a note that claims authority',
  },
  'reason-kept': {
    file: 'plugins/aukora-kira/lib/memory-deps.mjs',
    from: "reason: '', objectDigest: tombstoneHash,",
    to: "reason: String(reason ?? '').slice(0, 200), objectDigest: tombstoneHash,",
    arm: 'forgetting (live forget route): the tombstone is the law\'s and carries no words',
  },
  'record-spread': {
    file: 'plugins/aukora-kira/lib/memory-tiers.mjs',
    from: "  return Object.freeze({\n    id: record.id,\n    tier: 'forgotten',",
    to: "  return Object.freeze({\n    ...record,\n    id: record.id,\n    tier: 'forgotten',",
    arm: 'forgetting (forgetRecord): the tombstone is the law\'s and carries no words',
  },
})

const argv = process.argv.slice(2)

// ── --red: plain must pass, then every mutant must fail on its own arm ───────────────────────────────────────────────
if (argv[0] === '--red') {
  const run = (extra) => {
    const child = spawnSync(process.execPath, [HERE, ...extra], { encoding: 'utf8', timeout: 120_000 })
    return { status: child.status, out: `${child.stdout ?? ''}${child.stderr ?? ''}` }
  }
  const indent = text => text.trimEnd().split('\n').map(line => `    ${line}`).join('\n')
  const plain = run([])
  process.stdout.write(`plain (no mutation): exit ${String(plain.status)}\n${indent(plain.out)}\n\n`)
  let caught = 0
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const child = run(['--mutant', name])
    const red = child.status !== 0 && child.out.includes(`FAIL  ${mutant.arm}`)
    if (red) caught += 1
    process.stdout.write(`mutant ${name} (${mutant.file}): exit ${String(child.status)} — ${red ? 'CAUGHT' : 'NOT CAUGHT'}: "${mutant.arm}"\n${indent(child.out)}\n\n`)
  }
  const total = Object.keys(MUTANTS).length
  const ok = plain.status === 0 && caught === total
  process.stdout.write(`KIRA MEMORY LAW RED ARM: plain ${plain.status === 0 ? 'passed' : 'FAILED'}; ${String(caught)}/${String(total)} guards removed turned their arm red — ${ok ? 'OK' : 'NOT OK'}\n`)
  process.exit(ok ? 0 : 1)
}

// ── --mutant <name>: remove ONE guard in memory, before any subject module loads ─────────────────────────────────────
let mutation = null
if (argv[0] === '--mutant') {
  const mutant = MUTANTS[argv[1]]
  if (mutant === undefined) { process.stderr.write(`unknown mutant ${String(argv[1])}\n`); process.exit(2) }
  const target = pathToFileURL(join(ROOT, mutant.file)).href
  mutation = { name: argv[1], ...mutant, applied: 0 }
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context)
      if (url !== target) return result
      const source = Buffer.from(result.source).toString('utf8')
      const count = source.split(mutant.from).length - 1
      if (count !== 1) throw new Error(`mutant ${argv[1]}: the guard text occurs ${String(count)} times in ${mutant.file}, not once; nothing was removed`)
      mutation.applied += 1
      return { ...result, source: source.replace(mutant.from, mutant.to) }
    },
  })
}

const load = path => import(pathToFileURL(join(ROOT, path)).href)
const { createMemoryOwner } = await load('plugins/aukora-kira/lib/memory-owner.mjs')
const { stageKiraMemoryRecord } = await load('plugins/aukora-kira/lib/record.mjs')
const { createApprover, writeApproval } = await load('tests/kira-approval-standin.mjs')
const { registerRememberedCapture } = await load('plugins/aukora-kira/lib/memory-remembered-hook.mjs')
const { buildRouteDeps } = await load('plugins/aukora-kira/lib/memory-deps.mjs')
const { routeRequest, KIRA_ROUTES } = await load('plugins/aukora-kira/lib/memory-routes.mjs')
const { planStoreWrite } = await load('plugins/aukora-kira/lib/memory-store.mjs')
const { forgetRecord } = await load('plugins/aukora-kira/lib/memory-tiers.mjs')
const { exportPublicEvidence } = await load('scripts/kira/public-evidence.mjs')
// THE LAW ITSELF, imported directly rather than through Kira's adapter, so a tombstone is compared with the law's own.
const { tombstoneCommitment } = await load('vendor/aukora-packages/lib/packages/memory/src/envelope.js')
const { canonicalHash } = await load('vendor/authority/lib/canonical.js')
if (mutation !== null) {
  assert.equal(mutation.applied, 1, `mutant ${mutation.name} did not load its subject, so it removed nothing`)
  process.stdout.write(`MUTANT ${mutation.name}: removed the guard in ${mutation.file} (in memory only)\n`)
}

// ── the arms ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let failures = 0
let passed = 0
async function arm(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}\n`)
  }
}

/** Every file's text under a directory (lock files skipped), so a scan cannot miss a member it did not think of. */
function allText(dir) {
  let out = ''
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out += allText(path)
    else if (!name.endsWith('.lock')) out += `\n${readFileSync(path, 'utf8')}`
  }
  return out
}

const WORDS = ['quokka', 'figurine', 'beneath', 'turquoise', 'teapot']
const STATEMENT = 'I prefer the quokka figurine hidden beneath the turquoise teapot'
const APPROVED_TEXT = 'Cedar endpoint listens on port 8098'
const wordsIn = text => WORDS.filter(word => text.toLowerCase().includes(word))

const work = mkdtempSync(join(tmpdir(), 'kira-memory-law-'))
assert.ok(!work.includes('Application Support'), `refusing: ${work} is not a scratch directory`)
try {
  // A scratch home laid out like the deployment's: <home>/kira-memory is the store, <home>/sessions holds the events.
  const home = join(work, 'home')
  const stateDir = join(home, 'kira-memory')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
  const owner = createMemoryOwner({ stateDir })
  const approver = createApprover({ subject: SUBJECT })

  // ONE REAL SETTLEMENT, using a disposable test approver and the owner's own writer.
  const staged = stageKiraMemoryRecord({ subject: SUBJECT, kind: 'observation', source: [], content: { note: APPROVED_TEXT }, links: [], privacy: 'local', createdAt: '2026-09-08T00:00:00Z' })
  const approval = approver.approve(staged.memoryPut)
  const approvalPath = join(work, 'approval-artifact.json')
  writeApproval(approvalPath, approval)
  const settled = owner.settleAuthorized({
    authorization: { grant: owner.grantFor(staged.memoryPut), record: staged.record, subject: SUBJECT },
    approval, subject: SUBJECT, approverDid: approver.did,
    activeControlDigest: approver.projection.activeControlDigest,
  })
  assert.equal(settled.sequence, 1)
  const approvedChain = readFileSync(join(stateDir, 'aura.jsonl'), 'utf8')

  // ONE OWNER TURN, as the harness stores it: a zstd session file holding the event line the receipt covers.
  const sessionId = 'session-memory-law'
  const event = { type: 'user/message', seq: 7, time: 1790000000000, data: { id: 'msg-1', content: STATEMENT, source: { kind: 'user' } } }
  mkdirSync(join(home, 'sessions', 'project', sessionId), { recursive: true })
  writeFileSync(join(home, 'sessions', 'project', sessionId, 'session.jsonl.zstd'), zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`)))

  // THE LIVE CAPTURE HOOK, registered exactly as index.js registers it, on a stand-in context.
  let onTurn = null
  const warnings = []
  const ctx = {
    sessions: { flush: async () => true },
    on: (name, handler) => { if (name === 'agent/turn-stopping') onTurn = handler; return () => {} },
    reflect: { get: () => ({ readSurface: async () => ({ events: [event] }) }) },
    logger: { warn: line => warnings.push(line), info: () => {} },
  }
  registerRememberedCapture(ctx, { stateDir, sessionsRoot: home, policyOf: async () => ({ subject: SUBJECT, privacy: 'local' }), logger: ctx.logger })
  assert.equal(typeof onTurn, 'function', 'the capture hook did not subscribe to agent/turn-stopping')
  await onTurn({ agent: { session: { id: sessionId } }, turn: 1 })

  const deps = buildRouteDeps({
    stateDir, sessionsRoot: home, now: () => '2026-09-27T12:00:00Z', approverDid: approver.did,
    readOwner: owner.createReadOwner({ subject: SUBJECT, permittedPrivacy: ['local'] }),
  })
  let note = null

  await arm('capture: the live hook writes one remembered note, advisory and unreviewed', async () => {
    const listed = await deps.listNotes({})
    const remembered = listed.filter(one => one.tier === 'remembered')
    assert.equal(remembered.length, 1, `expected one remembered note, got ${String(remembered.length)} (hook warnings: ${warnings.join(' | ')})`)
    note = remembered[0]
    assert.equal(note.text, STATEMENT)
    assert.equal(note.grantsAuthority, false, 'a remembered note must carry grantsAuthority: false')
    assert.equal(note.label, 'unreviewed')
    const signed = await deps.listNotes({ tiers: ['signed'] })
    assert.equal(signed.length, 0, 'historical signed records enter ordinary memory through backfill, not a second active tier')
    assert.ok(!signed.some(one => one.id === note.id), 'the remembered note is listed as signed')
  })

  await arm('tiers: the approved chain is untouched by the capture', () => {
    assert.equal(readFileSync(join(stateDir, 'aura.jsonl'), 'utf8'), approvedChain, 'the capture appended to the approved chain aura.jsonl')
    const unsigned = readFileSync(join(stateDir, 'remembered', 'aura.jsonl'), 'utf8')
    assert.ok(unsigned.includes(String(note?.id)), 'the remembered note has no entry in the unsigned chain remembered/aura.jsonl')
  })

  await arm('tiers: the export carries the approved record and nothing of the remembered note', () => {
    const release = join(work, 'release')
    mkdirSync(join(release, '.dsh-build'), { recursive: true })
    writeFileSync(join(release, '.dsh-build', 'genesis-artifacts.json'), `${JSON.stringify({ producer: { genesisCommit: '9'.repeat(40) } })}\n`)
    const issuerAnchor = join(work, 'anchors', 'issuer.pem')
    const approverAnchor = join(work, 'anchors', 'approver.pk')
    mkdirSync(dirname(issuerAnchor), { recursive: true })
    writeFileSync(issuerAnchor, settled.receipt.issuerPk)
    writeFileSync(approverAnchor, `${approver.rawPublicKeyHex}\n`)
    const outDir = join(work, 'export')
    // VACUITY: the store really holds the note's words, so their absence from the export means something.
    assert.deepEqual(wordsIn(allText(stateDir)), WORDS, 'the store does not hold the note, so the export scan would prove nothing')
    let manifest
    try {
      manifest = exportPublicEvidence({
        storeDir: stateDir, outDir, producerCommit: '9'.repeat(40), releaseDir: release,
        anchors: new Map([['issuer', issuerAnchor], ['approver', approverAnchor]]),
        approvals: new Map([[settled.contentSha256, approvalPath]]),
      })
    } catch (error) {
      throw new Error(`the export of the approved record refused: ${String(error?.code ?? '')} ${String(error?.detail ?? error?.message ?? '').slice(0, 200)}`)
    }
    assert.deepEqual(manifest.records.map(one => one.recordId), [staged.recordId], 'the export should carry exactly the approved record')
    const exported = allText(outDir)
    assert.ok(exported.includes(APPROVED_TEXT), 'the export does not carry the approved words (vacuity)')
    assert.deepEqual(wordsIn(exported), [], 'the remembered note\'s words are in the export')
    assert.ok(!exported.includes(String(note?.id).slice(4)), 'the remembered note\'s id is in the export')
    assert.ok(!exported.includes('"tier":"remembered"'), 'a remembered-tier entry is in the export')
  })

  await arm('tiers: the law refuses a note that claims authority', () => {
    const forged = { ...note, grantsAuthority: true }
    assert.throws(() => planStoreWrite({ stateDir, notes: [forged], journalLines: ['{}'] }),
      error => error?.code === 'kira.law:note-claims-authority', 'planStoreWrite accepted a remembered note that claims authority')
  })

  await arm('forgetting (live forget route): the tombstone is the law\'s and carries no words', async () => {
    const reason = `forget "${STATEMENT}"`
    const answer = await routeRequest({ method: 'POST', path: KIRA_ROUTES.forget, body: { id: note.id, reason } }, deps)
    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    assert.equal(answer.body.forgotten, true)
    assert.equal(existsSync(join(stateDir, 'remembered', `${String(note.id).slice(4)}.json`)), false, 'the note object is still on disk')
    const journal = readFileSync(join(stateDir, 'remembered', 'journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const forgets = journal.filter(entry => entry.op === 'forget' && entry.id === note.id)
    assert.equal(forgets.length, 1, 'no forget entry was written (vacuity)')
    const law = tombstoneCommitment({ recordId: note.id, at: forgets[0].at })
    assert.equal(forgets[0].objectDigest, canonicalHash(law), 'the journal entry is not the law\'s tombstone')
    assert.deepEqual({ ...answer.body.tombstone, hash: undefined }, { ...law, hash: undefined }, 'the route answered a tombstone that is not the law\'s')
    assert.deepEqual(wordsIn(JSON.stringify(forgets[0])), [], 'the tombstone carries the note\'s words')
    assert.deepEqual(wordsIn(allText(stateDir)), [], 'the note\'s words are still somewhere in the store after the forget')
    assert.ok(!(await deps.listNotes({})).some(one => one.id === note.id), 'the forgotten note still lists')
  })

  await arm('forgetting (forgetRecord): the tombstone is the law\'s and carries no words', () => {
    const at = '2026-09-27T12:00:00Z'
    const tombstone = forgetRecord({ ...note, statement: STATEMENT, text: STATEMENT }, { at, reason: STATEMENT })
    const law = tombstoneCommitment({ recordId: note.id, at })
    assert.deepEqual({ ...tombstone.tombstone }, law, 'forgetRecord did not produce the law\'s tombstone')
    assert.equal(tombstone.forgotten.tombstoneHash, canonicalHash(law))
    assert.equal(tombstone.tier, 'forgotten')
    assert.equal(tombstone.grantsAuthority, false)
    assert.deepEqual(wordsIn(JSON.stringify(tombstone)), [], 'the tombstone carries the note\'s words')
  })
} finally {
  // ONLY THE DIRECTORY THIS RUN CREATED: a mkdtemp child of the temp directory with this check's own prefix.
  if (dirname(work) === resolve(tmpdir()) && basename(work).startsWith('kira-memory-law-')) rmSync(work, { recursive: true, force: true })
}

const total = passed + failures
process.stdout.write(`KIRA MEMORY LAW: ${failures === 0 ? 'GREEN' : 'RED'} — ${String(passed)}/${String(total)} arms\n`)
process.exit(failures === 0 && total === 6 ? 0 : 1)
