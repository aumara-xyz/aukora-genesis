/**
 * courts/harness/spine — the whole line, one court: root signs, broker
 * verifies with the frozen verifier, burns the nonce, executes memory.put,
 * settles a non-precomputable receipt, appends the Aura record, and folds it
 * into a Merkle root.
 *
 * Then the MUTATION CONTROL. The plan's own wording: hand the agent raw fs
 * access and the root key back — the test MUST FAIL. Here "fail" is measured
 * honestly: the raw powers must demonstrably WORK (a row that showed them
 * still refused would be carpentry), and the court must detect what each
 * power leaves behind. M1: an orphan object written straight into
 * memory/objects/ survives the index rebuild, and the record must report it.
 * M2: possession of the root key is
 * authority — the broker admits the key's signature, and the record keeps
 * the proof of what that authority did.
 *
 * DEFERRED, stated: the TCB manifest (bind every live decision to file
 * bytes) is not landed tonight; the frozen verifier digest (verifier-bytes
 * court) is the one drift anchor in place.
 *
 *   E1 pipeline   the full admit path, every stage verified
 *   E2 replay     the same grant refuses grant:replayed end to end
 *   E3 merkle     the root folds the record; an inclusion proof verifies
 *   C1 wiring     verification refuses when no live operation digest is supplied
 *   C2 artifact   a grant without an operation digest refuses by name
 *   M1 raw fs     an orphan object survives the rebuild and must be reported
 *   M2 root key   the key is real authority — the admit and its record are kept
 *
 * --mutate: a temporary source copy of the production effect bypasses its
 * `compareObjectInventory` call. M1's real orphan must then survive while the
 * mutant rebuild reports success, and every unrelated row must still hold.
 *
 *   node courts/harness/spine/run.mjs
 *   node courts/harness/spine/run.mjs --mutate
 */
import { generateKeyPairSync, sign as edSign, createHash } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { buildOperation, operationDigest } from '../../../aukora/broker/operation.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUKORA = join(HERE, '../../../aukora')
const EFFECT = join(AUKORA, 'broker/effect.mjs')
const { verifyGrant, payloadDigest, grantPreimage, newNonce, REFUSE } = await import(join(HERE, '../../../aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, observe, MEMORY_PUT } = await import(EFFECT)
const { provisionBrokerIdentity, spawnBroker } = await import(join(HERE, '../../../aukora/broker/broker.mjs'))
const { verifyReceipt } = await import(join(HERE, '../../../aukora/broker/receipt.mjs'))
const { verifyChain, readEntries } = await import(join(HERE, '../../../aukora/aura/record.mjs'))
const { leafHash, rootFromHashes, inclusionProof, verifyInclusion } = await import(join(HERE, '../../../aukora/aura/merkle.mjs'))

const MUTATE = process.argv.includes('--mutate')
const TMP = mkdtempSync(join(tmpdir(), 'aukora-spine-'))
const socketPath = join(TMP, 'broker.sock')
const stateDir = join(TMP, 'state')
const chainFile = join(stateDir, 'aura.jsonl')
const DEF = definitionDigest()
const RECEIPT_KEY_ID = provisionBrokerIdentity(stateDir).receiptKeyId

let rebuildEffect = EFFECT
let inventoryMutationApplied = false
if (MUTATE) {
  const mutantAukora = join(TMP, 'mutant-aukora')
  cpSync(AUKORA, mutantAukora, { recursive: true })
  rebuildEffect = join(mutantAukora, 'broker/effect.mjs')
  const source = readFileSync(rebuildEffect, 'utf8')
  const anchor = /^(\s*)const inventory = compareObjectInventory\(stateDir, entries\)$/gm
  const matches = source.match(anchor) ?? []
  inventoryMutationApplied = matches.length === 1
  if (inventoryMutationApplied) {
    writeFileSync(
      rebuildEffect,
      source.replace(anchor, '$1const inventory = { ok: true }'),
      'utf8',
    )
  }
}

const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const mint = (args) => {
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = { toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, args), nonce: newNonce(), exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(args, exp)), receiptKeyId: RECEIPT_KEY_ID }
  return { ...g, signature: edSign(null, grantPreimage(g), root.privateKey).toString('base64') }
}

const client = (socket) => {
  const conn = createConnection(socket)
  let buffer = ''
  const pending = new Map()
  conn.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      const reply = JSON.parse(line)
      const waiter = pending.get(reply.id)
      if (waiter) { pending.delete(reply.id); waiter(reply) }
    }
  })
  let id = 0
  return {
    send: (request) => new Promise((resolve) => {
      const rid = ++id
      pending.set(rid, resolve)
      conn.write(`${JSON.stringify({ id: rid, ...request })}\n`)
    }),
    close: () => conn.destroy(),
  }
}

const rows = []
const EXPECTED_ROWS = ['E1', 'E2', 'E3', 'C1', 'C2', 'M1', 'M2']
const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}
const rowsAreExact = (ordinaryRows) => {
  const names = ordinaryRows.map((result) => result.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

const broker = await spawnBroker({
  socketPath, stateDir, rootPublicKeyPem: rootPem,
})
const cli = client(socketPath)

// E1 — the full pipeline, every stage verified by its own instrument.
const args1 = { key: 'spine', value: { text: 'the whole line' } }
const grant1 = mint(args1)
{
  const direct = verifyGrant({ grant: grant1, toolName: MEMORY_PUT, args: args1, rootPublicKeyPem: rootPem, seenNonces: new Set(), now: Date.now(), expectedDefinitionId: DEF, expectedOperationDigest: grant1.operationDigest, expectedReceiptKeyId: RECEIPT_KEY_ID })
  const status = await cli.send({ op: 'status' })
  const put = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args1, grant: grant1 })
  const receipt = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: status.brokerPublicKeyPem, observe })
  const chain = verifyChain(chainFile)
  const entries = readEntries(chainFile)
  const rootHash = rootFromHashes(entries.map((e) => leafHash(Buffer.from(e.hash, 'hex'))))
  const proof = inclusionProof(entries.map((e) => leafHash(Buffer.from(e.hash, 'hex'))), 0)
  const inclusion = verifyInclusion({ root: rootHash, leafData: Buffer.from(entries[0].hash, 'hex'), index: 0, size: entries.length, proof })
  const nonceClaims = readdirSync(join(stateDir, 'nonces')).sort()
  row('E1', 'root -> broker -> verifier -> nonce -> put -> receipt -> record -> merkle', {
    directAdmits: direct.ok === true,
    brokerAdmits: put.ok === true,
    receiptVerifies: receipt.ok === true,
    chainVerifies: chain.ok === true && chain.count === 1 && chain.lastChainHash === put.chainHash,
    nonceBurned: nonceClaims.length === 1 && nonceClaims[0] === grant1.nonce,
    inclusionVerifies: inclusion === true,
    objectExists: existsSync(put.evidence.path),
  }, {
    directAdmits: true, brokerAdmits: true, receiptVerifies: true,
    chainVerifies: true, nonceBurned: true, inclusionVerifies: true, objectExists: true,
  })
}

// E2 — the same grant, end to end, refuses by name.
{
  const r = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args1, grant: grant1 })
  row('E2', 'the same grant refuses grant:replayed end to end', { reason: r.reason }, { reason: REFUSE.REPLAYED }, r.reason !== REFUSE.REPLAYED)
}

// E3 — the merkle fold moves with the record.
{
  const args2 = { key: 'spine2', value: { text: 'second leaf' } }
  const put2 = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: args2, grant: mint(args2) })
  const entries = readEntries(chainFile)
  const rootHash = rootFromHashes(entries.map((e) => leafHash(Buffer.from(e.hash, 'hex'))))
  const proof1 = inclusionProof(entries.map((e) => leafHash(Buffer.from(e.hash, 'hex'))), 0)
  row('E3', 'a second entry moves the root and the first leaf stays provable', {
    count: entries.length === 2,
    firstLeafProvable: verifyInclusion({ root: rootHash, leafData: Buffer.from(entries[0].hash, 'hex'), index: 0, size: 2, proof: proof1 }) === true,
    chainVerifies: verifyChain(chainFile).ok === true,
    secondRecorded: put2.ok === true,
  }, { count: true, firstLeafProvable: true, chainVerifies: true, secondRecorded: true })
}

// C1 — omission of the live operation digest refuses. Supplying a different
// digest would exercise the mismatch branch and leave this wiring gap untested.
{
  const compArgs = { key: 'spine-comp', value: { text: 'bound' } }
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = { toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, compArgs), nonce: newNonce(), exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(compArgs, exp)), receiptKeyId: RECEIPT_KEY_ID }
  const boundGrant = { ...g, signature: edSign(null, grantPreimage(g), root.privateKey).toString('base64') }
  const v = verifyGrant({ grant: boundGrant, toolName: MEMORY_PUT, args: compArgs, rootPublicKeyPem: rootPem, seenNonces: new Set(), now: Date.now(), expectedDefinitionId: DEF, expectedReceiptKeyId: RECEIPT_KEY_ID })
  row('C1', 'verification refuses when no live operation digest is supplied', { reason: v.reason }, { reason: REFUSE.NO_OPERATION_BOUND })
}

// C2 — an operationless grant refuses even when the live digest is supplied.
{
  const compArgs = { key: 'spine-comp2', value: { text: 'operationless' } }
  const g = { toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, compArgs), nonce: newNonce(), exp: Math.floor(Date.now() / 1000) + 300, definitionId: DEF, receiptKeyId: RECEIPT_KEY_ID }
  const plainGrant = { ...g, signature: edSign(null, grantPreimage(g), root.privateKey).toString('base64') }
  const v = verifyGrant({ grant: plainGrant, toolName: MEMORY_PUT, args: compArgs, rootPublicKeyPem: rootPem, seenNonces: new Set(), now: Date.now(), expectedDefinitionId: DEF, expectedOperationDigest: 'c'.repeat(64), expectedReceiptKeyId: RECEIPT_KEY_ID })
  row('C2', 'a grant without an operation digest refuses by name', { reason: v.reason }, { reason: REFUSE.NO_OPERATION_BOUND })
}

// M1 — mutation control: the agent's raw fs power works, and the record
// must REPORT what that power left behind.
//
// The plant goes in memory/objects/, not memory/keys/. rebuildIndex rmSyncs
// keys/ and rebuilds it from the chain, so anything planted there is removed
// BY THE REBUILD, and scoring that removal as detection made this row
// incapable of failing — it scored detected with no plant at all. objects/ is
// the store rebuildIndex never enumerates, so a plant there is still on disk
// afterwards and the row can measure a report rather than a deletion.
//
// The orphan is named by its own sha256, so it is internally consistent with
// the content-addressed layout. Nothing but the record can say it does not
// belong, which is the question this row asks.
{
  const objectsDir = join(stateDir, 'memory', 'objects')
  const orphanBody = `${JSON.stringify({ key: 'orphan', value: 'unrecorded' })}\n`
  const orphanSha = createHash('sha256').update(orphanBody).digest('hex')
  const orphanName = `${orphanSha}.json`
  const orphanPath = join(objectsDir, orphanName)
  writeFileSync(orphanPath, orphanBody, 'utf8')
  const rawWriteWorked = existsSync(orphanPath) && readFileSync(orphanPath, 'utf8') === orphanBody

  const entries = readEntries(chainFile)
  // Setup validation, not the finding: the plant must really be unrecorded,
  // or the row would ask the record to report something it does record.
  const plantIsUnrecorded = !entries.some((e) => e.path === orphanPath || e.contentSha256 === orphanSha)

  const { rebuildIndex } = await import(rebuildEffect)
  const rebuilt = rebuildIndex(stateDir, entries)

  // A finding may not be the rebuild's own cleanup. Were the orphan gone here
  // the row would be measuring deletion again, so its survival is what makes
  // the report term below mean anything.
  const survivedRebuild = existsSync(orphanPath)

  // Detection is the SYSTEM's report, never the court's own arithmetic: the
  // reconciliation surface must refuse and name the orphan, or hand back the
  // unrecorded objects it enumerated.
  const reported = rebuilt.ok === false
    ? String(rebuilt.reason).includes(orphanName)
    : Array.isArray(rebuilt.unrecordedObjects) && rebuilt.unrecordedObjects.includes(orphanName)

  row('M1', 'raw fs power works AND the record reports the orphan object', {
    rawWriteWorked, plantIsUnrecorded, survivedRebuild, reported,
  }, { rawWriteWorked: true, plantIsUnrecorded: true, survivedRebuild: true, reported: true })
}

// M2 — mutation control: the root key IS authority. The agent holding it can
// cause a put; the court must observe the admit (anything else is carpentry),
// and the record keeps the proof of what that authority did.
{
  const evilArgs = { key: 'm2', value: { text: 'key-holder power' } }
  const evilGrant = mint(evilArgs)
  const r = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: evilArgs, grant: evilGrant })
  const entries = readEntries(chainFile)
  const recorded = entries.some((e) => e.nonce === evilGrant.nonce && e.contentSha256 === r.evidence?.contentSha256)
  row('M2', 'the root key is real authority — the admit and its record are kept', {
    admits: r.ok === true,
    recorded,
  }, { admits: true, recorded: true }, r.ok !== true || !recorded)
}

await cli.close()
broker.kill?.()

console.log('\n  courts/harness/spine — the whole line, and the mutation control\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n}  ${String(r.label).padEnd(58)} ${JSON.stringify(r.observed) === JSON.stringify(r.expected) ? 'held' : '*** BREACH ***'}  ${JSON.stringify(r.observed).slice(0, 160)}`)
}
if (MUTATE) {
  const target = rows.find((r) => r.n === 'M1')
  const unrelatedBreaches = rows.filter((r) => r.n !== 'M1' && r.breach).map((r) => r.n)
  const targetFlipped = target?.observed.rawWriteWorked === true
    && target.observed.plantIsUnrecorded === true
    && target.observed.survivedRebuild === true
    && target.observed.reported === false
  const rowsComplete = rowsAreExact(rows)
  const detected = inventoryMutationApplied && rowsComplete && targetFlipped && unrelatedBreaches.length === 0
  console.log(`\n  MUTATION compareObjectInventory bypassed  anchorApplied=${inventoryMutationApplied} rowsComplete=${rowsComplete} expected=${EXPECTED_ROWS.length} observed=${rows.length} orphanSurvived=${String(target?.observed.survivedRebuild)} mutantReported=${String(target?.observed.reported)} unrelatedBreaches=[${unrelatedBreaches.join(' ')}]  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}
const anyBreach = !rowsAreExact(rows) || rows.some((r) => r.breach)
console.log(`  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log('\n  observationClass: SELF-REPORTED\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach ? 1 : 0)
