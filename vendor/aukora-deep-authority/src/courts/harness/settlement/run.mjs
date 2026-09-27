/**
 * courts/harness/settlement — a receipt is evidence after the fact, never
 * permission before it.
 *
 * A grant is true the moment it is signed and proves nothing about what
 * occurred. A receipt can bind a post-write observation — the inode, mtime,
 * digest, and bytes observed on disk. Verification proves that signed
 * observation matches the object at verification time. It does not prove this
 * call created the object, that an effect ran, or that burning a nonce caused
 * execution.
 *
 * The court reads the broker's key file from the state directory on purpose:
 * the same-uid attacker holds every key the broker holds. Invented or stale
 * observations still refuse because they are checked against a later path observation. A
 * forged receipt matching an existing object can verify, which is why key
 * custody and a separate call record remain necessary.
 *
 *   S1 control          the broker's receipt verifies against the file
 *   S2 durable          it still verifies after the broker process dies
 *   S3 tamper           one flipped evidence field refuses signature-invalid
 *   S4 stale            an invented observation refuses while absent and after different bytes land
 *   S4-control          matching an existing object verifies without proving this call created it
 *   S5-unobservable     an occupied non-followed path is not misreported as absent
 *   S5 gone             a receipt whose file was deleted refuses effect-absent
 *   S6 stranger key     a receipt under a foreign key refuses signature-invalid
 *   S6-rsa512           an exact-64-byte RSA signature and RSA signing key refuse
 *   S6-ec224            an EC P-224 signing or verification key refuses
 *   S7 malformed        a receipt missing a field refuses malformed
 *
 * --mutate: the sabotage is a verifier that skips the observe comparisons.
 * The pre-minted receipt then admits, and the court detects exactly that.
 *
 *   node courts/harness/settlement/run.mjs
 *   node courts/harness/settlement/run.mjs --mutate
 */
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { copyMutantAukora } from '../support/mutant-aukora.mjs'
import { buildOperation, operationDigest } from '../../../aukora/broker/operation.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const { payloadDigest, grantPreimage, newNonce } = await import(join(HERE, '../../../aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, observe, MEMORY_PUT } = await import(join(HERE, '../../../aukora/broker/effect.mjs'))
const { provisionBrokerIdentity, spawnBroker } = await import(join(HERE, '../../../aukora/broker/broker.mjs'))
const { verifyReceipt, mintReceipt, receiptPreimage, RECEIPT_FIELDS, requestDigest, RECEIPT_REFUSE } = await import(join(HERE, '../../../aukora/broker/receipt.mjs'))
const { createPrivateKey } = await import('node:crypto')

const MUTATE = process.argv.includes('--mutate')
const TMP = mkdtempSync(join(tmpdir(), 'aukora-settlement-'))
const socketPath = join(TMP, 'broker.sock')
const stateDir = join(TMP, 'state')
const DEF = definitionDigest()
const RECEIPT_KEY_ID = provisionBrokerIdentity(stateDir).receiptKeyId

const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const ARGS = { key: 'receipted', value: { text: 'settled' } }
const mintGrant = () => {
  const exp = Math.floor(Date.now() / 1000) + 300
  const g = { toolName: MEMORY_PUT, digest: payloadDigest(MEMORY_PUT, ARGS), nonce: newNonce(), exp, definitionId: DEF, operationDigest: operationDigest(buildOperation(ARGS, exp)), receiptKeyId: RECEIPT_KEY_ID }
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
    close: () => new Promise((resolve) => {
      if (conn.destroyed) { resolve(); return }
      conn.once('close', resolve)
      conn.destroy()
    }),
  }
}

const waitForExit = (child, timeoutMs = 5000) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(true); return }
  let settled = false
  const finish = (exited) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(exited)
  }
  const timer = setTimeout(() => finish(false), timeoutMs)
  child.once('exit', () => finish(true))
})

const rows = []
const EXPECTED_ROWS = ['S1', 'S2', 'S3', 'S4', 'S4-control', 'S5-unobservable', 'S5', 'S6', 'S6-rsa512', 'S6-ec224', 'S6-private', 'S7']
const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}

/** Every mode requires the complete, non-duplicated ordinary receipt table. */
const ordinaryRowsHeld = () => {
  const names = new Set(rows.map(({ n }) => n))
  return names.size === rows.length
    && EXPECTED_ROWS.length === rows.length
    && EXPECTED_ROWS.every((name) => names.has(name))
    && rows.every(({ breach }) => !breach)
}

const broker = await spawnBroker({
  socketPath, stateDir, rootPublicKeyPem: rootPem,
})
const cli = client(socketPath)
const status = await cli.send({ op: 'status' })
const brokerPub = status.brokerPublicKeyPem
const brokerKey = createPrivateKey(JSON.parse(readFileSync(join(stateDir, 'keys', 'broker.json'), 'utf8')).privatePem)

// S1 — the control: the broker's receipt verifies against the world.
const grant = mintGrant()
const put = await cli.send({ op: 'memory.put', toolName: MEMORY_PUT, arguments: ARGS, grant })
const v1 = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: brokerPub, observe })
row('S1', 'the broker receipt verifies against the file', {
  ok: v1.ok === true,
  sequenceIsOne: put.receipt.sequence === 1,
  evidenceMatches: put.evidence.contentSha256 === put.receipt.contentSha256,
}, { ok: true, sequenceIsOne: true, evidenceMatches: true }, v1.ok !== true || put.receipt.sequence !== 1)

// S2 — durable: the receipt survives the broker process.
await cli.close()
broker.kill?.('SIGTERM')
const exitedBeforeVerify = await waitForExit(broker)
if (!exitedBeforeVerify) {
  broker.kill?.('SIGKILL')
  await waitForExit(broker)
}
const v2 = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: brokerPub, observe })
row('S2', 'the receipt verifies after the broker process dies', {
  brokerExited: exitedBeforeVerify,
  ok: v2.ok === true,
}, { brokerExited: true, ok: true }, !exitedBeforeVerify || v2.ok !== true)

// S3 — the signature covers every evidence field.
{
  const tampered = { ...put.receipt, contentSha256: '0'.repeat(64) }
  const v = verifyReceipt({ receipt: tampered, brokerPublicKeyPem: brokerPub, observe })
  row('S3', 'one flipped evidence field refuses by name', { reason: v.reason }, { reason: RECEIPT_REFUSE.BAD_SIGNATURE }, v.reason !== RECEIPT_REFUSE.BAD_SIGNATURE)
}

// S4 — a stale observation cannot be authenticated into truth. Mint a receipt
// while the path is absent, then put different bytes there and check both times.
{
  const invented = { path: join(stateDir, 'memory', 'preminted.json'), bytes: 42, contentSha256: '1'.repeat(64), inode: 0, mtimeNs: '1' }
  const pre = mintReceipt({ requestDigest: requestDigest(MEMORY_PUT, ARGS), definitionId: DEF, nonce: 'premint-nonce', sequence: 99, evidence: invented, confinement: put.receipt.confinement, brokerPrivateKey: brokerKey })
  const before = verifyReceipt({ receipt: pre, brokerPublicKeyPem: brokerPub, observe })
  const { writeFileSync: wf } = await import('node:fs')
  wf(invented.path, 'the effect ran later\n', 'utf8')
  const after = verifyReceipt({ receipt: pre, brokerPublicKeyPem: brokerPub, observe })
  row('S4', 'an invented observation refuses while absent and after different bytes land', {
    beforeReason: before.reason,
    afterReason: after.reason,
  }, { beforeReason: RECEIPT_REFUSE.GONE, afterReason: RECEIPT_REFUSE.CONTENT_MISMATCH })
}

// S4-control — receipt verification is observation, not causation. A holder of
// the receipt key can describe the already-existing object exactly and obtain a
// verifying receipt without this block invoking memory.put or the broker.
{
  const before = observe(put.evidence.path)
  const matching = mintReceipt({
    requestDigest: requestDigest(MEMORY_PUT, ARGS),
    definitionId: DEF,
    nonce: 'matching-existing-object',
    sequence: 100,
    evidence: put.evidence,
    confinement: put.receipt.confinement,
    brokerPrivateKey: brokerKey,
  })
  const verified = verifyReceipt({ receipt: matching, brokerPublicKeyPem: brokerPub, observe })
  const after = observe(put.evidence.path)
  row('S4-control', 'matching an existing object verifies without proving this call created it', {
    objectAlreadyExisted: before.status === 'observed',
    verifies: verified.ok === true,
    observationUnchanged: JSON.stringify(after) === JSON.stringify(before),
  }, { objectAlreadyExisted: true, verifies: true, observationUnchanged: true })
}

// S6-rsa512/S6-ec224 — algorithm identity is a key property, not a
// consequence of signature length. Node emits an exact 64-byte RSA-512
// signature for this preimage, which would pass an Ed25519-sized buffer check.
{
  const unsignedReceipt = Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, put.receipt[field]]))
  const rsa = generateKeyPairSync('rsa', { modulusLength: 512 })
  const rsaSignature = edSign(null, receiptPreimage(unsignedReceipt), rsa.privateKey)
  const rsaReceipt = { ...unsignedReceipt, signature: rsaSignature.toString('base64') }
  let rsaMintError = null
  try {
    mintReceipt({
      requestDigest: requestDigest(MEMORY_PUT, ARGS), definitionId: DEF, nonce: 'rsa-mint', sequence: 101,
      evidence: put.evidence, confinement: put.receipt.confinement, brokerPrivateKey: rsa.privateKey,
    })
  } catch (error) {
    rsaMintError = String(error?.message ?? error)
  }
  const rsaVerify = verifyReceipt({
    receipt: rsaReceipt,
    brokerPublicKeyPem: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    observe,
  })
  row('S6-rsa512', 'an exact-64-byte RSA signature and RSA signing key refuse', {
    keyType: rsa.privateKey.asymmetricKeyType,
    signatureBytes: rsaSignature.length,
    mintError: rsaMintError,
    verifyReason: rsaVerify.reason,
  }, {
    keyType: 'rsa',
    signatureBytes: 64,
    mintError: 'mintReceipt: brokerPrivateKey must be an Ed25519 private key',
    verifyReason: RECEIPT_REFUSE.KEY_TYPE,
  })

  const ec = generateKeyPairSync('ec', { namedCurve: 'secp224r1' })
  let ecMintError = null
  try {
    mintReceipt({
      requestDigest: requestDigest(MEMORY_PUT, ARGS), definitionId: DEF, nonce: 'ec-mint', sequence: 102,
      evidence: put.evidence, confinement: put.receipt.confinement, brokerPrivateKey: ec.privateKey,
    })
  } catch (error) {
    ecMintError = String(error?.message ?? error)
  }
  const ecVerify = verifyReceipt({
    receipt: put.receipt,
    brokerPublicKeyPem: ec.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    observe,
  })
  row('S6-ec224', 'an EC P-224 signing or verification key refuses', {
    keyType: ec.privateKey.asymmetricKeyType,
    mintError: ecMintError,
    verifyReason: ecVerify.reason,
  }, {
    keyType: 'ec',
    mintError: 'mintReceipt: brokerPrivateKey must be an Ed25519 private key',
    verifyReason: RECEIPT_REFUSE.KEY_TYPE,
  })

  const privatePem = brokerKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const privateVerify = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: privatePem, observe })
  row('S6-private', 'a private Ed25519 PEM cannot stand in for the broker public key', {
    verifyReason: privateVerify.reason,
  }, {
    verifyReason: RECEIPT_REFUSE.KEY_TYPE,
  })
}

// S5-unobservable — an occupied path the observer deliberately will not follow
// is not absence. Keep the target bytes identical so only entry state decides.
{
  const displaced = `${put.evidence.path}.displaced`
  renameSync(put.evidence.path, displaced)
  symlinkSync(displaced, put.evidence.path)
  const v = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: brokerPub, observe })
  unlinkSync(put.evidence.path)
  renameSync(displaced, put.evidence.path)
  row('S5-unobservable', 'an occupied non-followed path refuses as unobservable, not absent', {
    reason: v.reason,
  }, { reason: RECEIPT_REFUSE.UNOBSERVABLE })
}

// S5 — the file is gone.
{
  rmSync(put.evidence.path, { force: true })
  const v = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: brokerPub, observe })
  row('S5', 'a receipt whose file was deleted refuses by name', { reason: v.reason }, { reason: RECEIPT_REFUSE.GONE }, v.reason !== RECEIPT_REFUSE.GONE)
}

// S6 — a stranger key cannot verify it.
{
  const stranger = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const v = verifyReceipt({ receipt: put.receipt, brokerPublicKeyPem: stranger, observe })
  row('S6', 'a foreign key refuses by name', { reason: v.reason }, { reason: RECEIPT_REFUSE.BAD_SIGNATURE }, v.reason !== RECEIPT_REFUSE.BAD_SIGNATURE)
}

// S7 — malformed.
{
  const malformed = { ...put.receipt }
  delete malformed.inode
  const v = verifyReceipt({ receipt: malformed, brokerPublicKeyPem: brokerPub, observe })
  row('S7', 'a receipt missing a field refuses malformed', { reason: v.reason }, { reason: RECEIPT_REFUSE.MALFORMED }, v.reason !== RECEIPT_REFUSE.MALFORMED)
}

console.log('\n  courts/harness/settlement — evidence after the fact, never permission before it\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n}  ${String(r.label).padEnd(58)} ${JSON.stringify(r.observed) === JSON.stringify(r.expected) ? 'held' : '*** BREACH ***'}  ${JSON.stringify(r.observed).slice(0, 80)}`)
}
if (MUTATE) {
  // Patch a temporary production source graph so the real verifier returns
  // after signature/class checks but before it re-observes the object.
  const mutantRoot = join(TMP, 'mutant-aukora')
  copyMutantAukora(mutantRoot)
  const mutantReceipt = join(mutantRoot, 'broker', 'receipt.mjs')
  const source = readFileSync(mutantReceipt, 'utf8')
  const anchor = '  let now\n  try {'
  const matches = source.split(anchor).length - 1
  const mutationApplied = matches === 1
  if (mutationApplied) {
    writeFileSync(mutantReceipt, source.replace(anchor, '  return { ok: true }\n  let now\n  try {'), 'utf8')
  }
  const invented = { path: join(stateDir, 'memory', 'preminted2.json'), bytes: 42, contentSha256: '2'.repeat(64), inode: 0, mtimeNs: '1' }
  const pre = mintReceipt({ requestDigest: requestDigest(MEMORY_PUT, ARGS), definitionId: DEF, nonce: 'premint-2', sequence: 99, evidence: invented, confinement: put.receipt.confinement, brokerPrivateKey: brokerKey })
  let admitted = false
  if (mutationApplied) {
    const { verifyReceipt: sabotagedVerifyReceipt } = await import(`${pathToFileURL(mutantReceipt).href}?mutation=skip-observe`)
    admitted = sabotagedVerifyReceipt({ receipt: pre, brokerPublicKeyPem: brokerPub, observe }).ok === true
  }
  const controlsHeld = ordinaryRowsHeld()
  const detected = mutationApplied && admitted && controlsHeld
  console.log(`\n  MUTATION production observation bypass  anchorApplied=${mutationApplied} premintedAdmitted=${admitted} ordinaryRowsHeld=${controlsHeld}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}
const anyBreach = rows.some((r) => r.breach)
const ordinaryRowsComplete = ordinaryRowsHeld()
console.log('\n  observationClass: SELF-REPORTED\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach || !ordinaryRowsComplete ? 1 : 0)
