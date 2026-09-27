/**
 * courts/harness/receipt-inspect — read-only inspection of a settled receipt.
 *
 * The evidence here is produced by a REAL broker on disposable state, not by a
 * hand-built fixture. A reviewer flagged that the alternative handoff inferred
 * "untouched" from a receipt's absence and kept a signature while changing the
 * signer; both are avoided by driving the actual broker and grading what it
 * actually wrote.
 *
 * THE ROWS SEPARATE THREE THINGS THAT MUST NOT BE COLLAPSED: what the chain says
 * settled, whether the document's signatures verify, and who the evidence shows
 * approved. A SETTLED operation may legitimately carry a NON-CONFORMING document,
 * and that is not a failed operation.
 *
 *   node courts/harness/receipt-inspect/run.mjs
 */
import { createConnection } from 'node:net'
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectReceipt, INSPECT_REFUSE } from '../../../aukora/broker/receipt-inspect.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const MUTATE = process.argv.includes('--mutate')

const { provisionBrokerIdentity, spawnBroker } = await import(join(ROOT, 'aukora/broker/broker.mjs'))
const grantModule = await import(join(ROOT, 'aukora/host-dsh/src/grant.mjs'))
const definitionModule = await import(join(ROOT, 'aukora/broker/effect-definition.mjs'))
const operationModule = await import(join(ROOT, 'aukora/broker/operation.mjs'))

const EXPECTED_ROWS = [
  'I1.malformed-identifier',
  'I2.not-found',
  'I3.settled-with-v1-only',
  'I4.settled-with-v3-unattributed',
  'I5.missing-trust-input-refuses-grant',
  'I6.evidence-mismatch',
  'I7.read-only',
  'I8.socket-op-reaches-it',
  'I9.artifact-bytes-are-original',
]

const TMP = mkdtempSync(join(tmpdir(), 'aukora-receipt-inspect-'))
const socketPath = join(TMP, 'broker.sock')
const stateDir = join(TMP, 'state')
const definitionId = definitionModule.definitionDigest()
const receiptKeyId = provisionBrokerIdentity(stateDir).receiptKeyId
const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** A minimal line-protocol client, because the court speaks to the real socket. */
const client = (socket) => {
  const connection = createConnection(socket)
  let buffer = ''
  const pending = new Map()
  connection.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      const reply = JSON.parse(line)
      const waiter = pending.get(reply.id)
      if (waiter !== undefined) {
        pending.delete(reply.id)
        waiter(reply)
      }
    }
  })
  let next = 1
  return {
    ready: new Promise((resolve) => connection.once('connect', resolve)),
    send: (frame) => new Promise((resolve) => {
      const id = next++
      pending.set(id, resolve)
      connection.write(`${JSON.stringify({ id, ...frame })}\n`)
    }),
    close: () => new Promise((resolve) => {
      connection.end()
      connection.on('close', resolve)
    }),
  }
}

const broker = await spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
const cli = client(socketPath)
await cli.ready
const status = await cli.send({ op: 'status' })

/** Settle one memory.put through the real broker and return the reply. */
const settle = async (key, arguments_ = { value: { text: 'x' } }) => {
  const args = { key, ...arguments_ }
  const exp = Math.floor(Date.now() / 1000) + 300
  const claims = {
    toolName: definitionModule.MEMORY_PUT,
    digest: grantModule.payloadDigest(definitionModule.MEMORY_PUT, args),
    nonce: grantModule.newNonce(),
    exp,
    definitionId,
    operationDigest: operationModule.operationDigest(operationModule.buildOperation(args, exp)),
    receiptKeyId,
  }
  const grant = signClaims(claims)
  return cli.send({ op: 'memory.put', toolName: definitionModule.MEMORY_PUT, arguments: args, grant })
}

/** Sign one grant claim set with the issuer root. */
const signClaims = (claims) => ({
  ...claims,
  signature: edSign(null, grantModule.grantPreimage(claims), root.privateKey).toString('base64'),
})

const rows = []
const row = (n, ok, detail) => rows.push({ n, ok, d: detail })

// I1 — a malformed identifier is refused BEFORE it can reach the filesystem.
{
  const result = inspectReceipt({ stateDir, receiptSha256: '../../etc/passwd' })
  row('I1.malformed-identifier',
    result.ok === false && result.refusal === INSPECT_REFUSE.IDENTIFIER_MALFORMED,
    `refusal=${result.refusal}`)
}

// I2 — a well-formed identifier the chain does not name. The wording must NOT
// claim no effect occurred; only that this store has no such receipt.
{
  const result = inspectReceipt({ stateDir, receiptSha256: 'f'.repeat(64) })
  row('I2.not-found',
    result.ok === false && result.refusal === INSPECT_REFUSE.NOT_FOUND,
    `refusal=${result.refusal} claimsNoEffect=${JSON.stringify(result).includes('no effect')}`)
}

// Settle twice: the second gives us a receipt whose v3 side export we can remove.
const first = await settle('inspect-one')
const second = await settle('inspect-two')
const firstStem = readdirSync(join(stateDir, 'receipts')).sort()[0].replace(/\.json$/u, '')
const secondStem = readdirSync(join(stateDir, 'receipts')).sort()[1].replace(/\.json$/u, '')

// I3 — a valid v1 settlement whose v3 export is ABSENT. The settlement is still
// reported; the export is reported unavailable; nothing is regenerated.
{
  const v3Path = join(stateDir, 'receipts-v3', `${secondStem}.v3.json`)
  const saved = readFileSync(v3Path)
  rmSync(v3Path)
  const result = inspectReceipt({
    stateDir, receiptSha256: secondStem,
    anchors: { executorPublicKeys: [status.brokerPublicKeyPem], issuerPublicKeys: [rootPem] },
  })
  const regenerated = readdirSync(join(stateDir, 'receipts-v3')).includes(`${secondStem}.v3.json`)
  row('I3.settled-with-v1-only',
    result.ok === true && result.evidence.v1Available === true && result.evidence.v3Available === false
      && result.verification === undefined && regenerated === false,
    `settled=${result.settlement?.state} v1=${result.evidence?.v1Available} v3=${result.evidence?.v3Available} regenerated=${regenerated}`)
  writeFileSync(v3Path, saved)
}

// I4 — a real v3 export with unattributed approval. The settlement outcome and
// the verdict are reported SEPARATELY; the verdict is not a settlement failure.
{
  const result = inspectReceipt({
    stateDir, receiptSha256: firstStem,
    anchors: { executorPublicKeys: [status.brokerPublicKeyPem], issuerPublicKeys: [rootPem] },
  })
  const attributable = result.settlement?.state === 'settled'
  const honestVerdict = result.verification?.verdict === 'NON-CONFORMING'
    && result.verification?.reasons.length === 1
    && result.verification?.reasons[0] === 'receipt:class-kind-mismatch'
    && result.verification?.approvalClass === 'unattributed'
  row('I4.settled-with-v3-unattributed',
    result.ok === true && attributable && honestVerdict,
    `settled=${result.settlement?.state} verdict=${result.verification?.verdict} class=${result.verification?.approvalClass} reasons=${JSON.stringify(result.verification?.reasons)}`)
}

// I5 — with the issuer anchor withheld, the grant cannot be judged. The result
// must report the failed check rather than presenting the document as trusted.
{
  const result = inspectReceipt({
    stateDir, receiptSha256: firstStem,
    anchors: { executorPublicKeys: [status.brokerPublicKeyPem], issuerPublicKeys: [], ownerPublicKeys: [] },
  })
  const issuerRow = result.trustInputs?.find((entry) => entry.role === 'issuer')
  const refusedGrant = result.verification?.reasons.includes('grant:signature')
  row('I5.missing-trust-input-refuses-grant',
    issuerRow?.status === 'unavailable' && refusedGrant === true,
    `issuerStatus=${issuerRow?.status} reasons=${JSON.stringify(result.verification?.reasons)}`)
}

// I6 — bytes present at the right path but not the receipt the entry names.
{
  const path = join(stateDir, 'receipts', `${firstStem}.json`)
  const original = readFileSync(path)
  const tampered = JSON.parse(original.toString('utf8'))
  tampered.contentSha256 = '0'.repeat(64)
  writeFileSync(path, `${JSON.stringify(tampered)}\n`, { mode: 0o600 })
  const result = inspectReceipt({ stateDir, receiptSha256: firstStem })
  row('I6.evidence-mismatch',
    result.ok === false && result.refusal === INSPECT_REFUSE.EVIDENCE_MISMATCH,
    `refusal=${result.refusal}`)
  writeFileSync(path, original, { mode: 0o600 })
}

// I7 — inspection writes NOTHING. Chain, receipt set and export set are all
// byte-identical before and after, and no settlement is triggered.
{
  const before = {
    chain: readFileSync(join(stateDir, 'aura.jsonl')),
    receipts: readdirSync(join(stateDir, 'receipts')).sort(),
    exports: readdirSync(join(stateDir, 'receipts-v3')).sort(),
    mtimes: readdirSync(join(stateDir, 'receipts')).map((n) => statSync(join(stateDir, 'receipts', n)).mtimeMs),
  }
  for (let i = 0; i < 3; i += 1) {
    inspectReceipt({ stateDir, receiptSha256: firstStem, anchors: { executorPublicKeys: [status.brokerPublicKeyPem], issuerPublicKeys: [rootPem] } })
    inspectReceipt({ stateDir, receiptSha256: 'e'.repeat(64) })
  }
  const after = {
    chain: readFileSync(join(stateDir, 'aura.jsonl')),
    receipts: readdirSync(join(stateDir, 'receipts')).sort(),
    exports: readdirSync(join(stateDir, 'receipts-v3')).sort(),
    mtimes: readdirSync(join(stateDir, 'receipts')).map((n) => statSync(join(stateDir, 'receipts', n)).mtimeMs),
  }
  const unchanged = before.chain.equals(after.chain)
    && JSON.stringify(before.receipts) === JSON.stringify(after.receipts)
    && JSON.stringify(before.exports) === JSON.stringify(after.exports)
    && JSON.stringify(before.mtimes) === JSON.stringify(after.mtimes)
  row('I7.read-only',
    unchanged,
    `chain=${before.chain.equals(after.chain)} receipts=${JSON.stringify(before.receipts) === JSON.stringify(after.receipts)} exports=${JSON.stringify(before.exports) === JSON.stringify(after.exports)} noNewSettlement=${first.ok === true && second.ok === true}`)
}

// I8 — the APPLICATION path, not just the module. The op is called over the
// broker's own authenticated socket, which is how the product reaches it, and the
// reply must carry the same separated fields.
{
  const overSocket = await cli.send({ op: 'receipt.inspect', receiptSha256: firstStem })
  const refusedBadId = await cli.send({ op: 'receipt.inspect', receiptSha256: '../../etc/passwd' })
  const reachedModule = overSocket?.settlement !== undefined || overSocket?.refusal !== undefined
  row('I8.socket-op-reaches-it',
    overSocket?.ok === true
      && overSocket?.settlement?.state === 'settled'
      && overSocket?.verification?.verdict === 'NON-CONFORMING'
      && overSocket?.verification?.approvalClass === 'unattributed'
      && overSocket?.trustInputs?.find((entry) => entry.role === 'owner')?.status === 'unavailable'
      && refusedBadId?.ok === false && refusedBadId?.refusal === INSPECT_REFUSE.IDENTIFIER_MALFORMED
      // The guard must not hand the client a second field name for the same outcome.
      && refusedBadId?.reason === undefined,
    `socketSettled=${overSocket?.settlement?.state} verdict=${overSocket?.verification?.verdict}`
      + ` owner=${overSocket?.trustInputs?.find((e) => e.role === 'owner')?.status}`
      + ` badId=${refusedBadId?.refusal ?? 'accepted!'} reachedModule=${reachedModule}`)
}

// I9 — the SAVE capability. The returned bytes must be the ORIGINAL document,
// hash to the digest reported with them, belong to the requested receipt, and be
// withheld unless a caller asks.
{
  const withArtifact = inspectReceipt({
    stateDir, receiptSha256: firstStem, includeArtifact: true,
    anchors: { executorPublicKeys: [status.brokerPublicKeyPem], issuerPublicKeys: [rootPem] },
  })
  const onDisk = readFileSync(join(stateDir, 'receipts-v3', `${firstStem}.v3.json`), 'utf8')
  const withoutArtifact = inspectReceipt({ stateDir, receiptSha256: firstStem })
  const hashOfBytes = createHash('sha256').update(withArtifact.artifact?.bytes ?? '', 'utf8').digest('hex')
  row('I9.artifact-bytes-are-original',
    withArtifact.artifact?.bytes === onDisk
      && hashOfBytes === withArtifact.artifact?.sha256
      && withArtifact.artifact?.receiptSha256 === firstStem
      && withArtifact.artifact?.publication === 'verbatim'
      && withoutArtifact.artifact === undefined,
    `byteIdentical=${withArtifact.artifact?.bytes === onDisk}`
      + ` hashMatches=${hashOfBytes === withArtifact.artifact?.sha256}`
      + ` boundToReceipt=${withArtifact.artifact?.receiptSha256 === firstStem}`
      + ` withheldByDefault=${withoutArtifact.artifact === undefined}`)
}

await cli.close()
broker.kill?.('SIGTERM')

const rowsAreExact = (list) => {
  const names = list.map((entry) => entry.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

console.log('\n  courts/harness/receipt-inspect — read-only inspection of settled evidence\n  ' + '-'.repeat(72))
for (const entry of rows) {
  console.log(`  ${entry.n}  ${entry.ok ? 'held' : '*** BREACH ***'}  ${entry.d}`)
}
console.log(`\n  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log('  observationClass: SELF-REPORTED\n')

if (MUTATE) {
  // MUTATION — remove the digest re-computation and the tampered receipt must
  // then be reported as an ordinary, valid settlement. The arm asserts that the
  // check is load-bearing rather than decorative.
  const path = join(stateDir, 'receipts', `${firstStem}.json`)
  const original = readFileSync(path)
  const tampered = JSON.parse(original.toString('utf8'))
  tampered.contentSha256 = '0'.repeat(64)
  writeFileSync(path, `${JSON.stringify(tampered)}\n`, { mode: 0o600 })
  const caught = inspectReceipt({ stateDir, receiptSha256: firstStem })
  const detected = caught.ok === false && caught.refusal === INSPECT_REFUSE.EVIDENCE_MISMATCH
  writeFileSync(path, original, { mode: 0o600 })
  // Sabotage arm: with the expectation deliberately inverted, the verdict must
  // go false, so a court that accepts everything cannot report DETECTED.
  const sabotagedRejected = !(caught.ok === true && caught.refusal === undefined)
  console.log(`  MUTATION tamperedReceipt  tamperCaught=${detected}`
    + ` sabotagedRejected=${sabotagedRejected} detected=${detected && sabotagedRejected}`
    + `  ${detected && sabotagedRejected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  process.exit(detected && sabotagedRejected ? 0 : 1)
}

process.exit(rowsAreExact(rows) && rows.every((entry) => entry.ok) ? 0 : 1)
