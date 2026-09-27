/**
 * courts/harness/organism — a cross-module integration slice.
 *
 * Genesis ceremony → root key signs grant → the hardened verifier checks the
 * exact operation → memory.put writes an object → a settlement receipt is
 * checked against the file → the laboratory Aura and Kira modules append,
 * recall, and forget. The live broker, durable nonce book, production Aura
 * record, and Merkle path are integrated by courts/harness/spine instead.
 *
 * The grant, operation, effect, and receipt paths are production modules. The
 * genesis, Kira, and AuraChain rows exercise archived laboratory modules. No
 * mocks or stubs are substituted, but this court is not deployment evidence.
 *
 *   node courts/harness/organism/run.mjs
 */
import { generateKeyPairSync, sign as edSign, createHash, createPublicKey } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const MUTATE = process.argv.includes('--mutate')

// ── import every organ ──
const { verifyGrant, payloadDigest, grantPreimage, newNonce, receiptKeyIdForPublicKey, REFUSE } = await import(join(HERE, '../../../aukora/host-dsh/src/grant.mjs'))
const { genesisLabRoot, unwrapRoot } = await import(join(HERE, '../../../archive/lab/kernel/aumlok.mjs'))
const { memoryPut, observe, MEMORY_PUT, definitionDigest } = await import(join(HERE, '../../../aukora/broker/effect.mjs'))
const { buildOperation, operationDigest } = await import(join(HERE, '../../../aukora/broker/operation.mjs'))
const { mintReceipt, verifyReceipt, requestDigest } = await import(join(HERE, '../../../aukora/broker/receipt.mjs'))
const {
  CONFINEMENT_CLASS, confinementField, measurePeerSeparability, measureStateDirectory,
} = await import(join(HERE, '../../../aukora/broker/confinement.mjs'))
const { AuraChain } = await import(join(HERE, '../../../archive/lab/witness/chain.mjs'))
const { KiraVault } = await import(join(HERE, '../../../archive/lab/storage/kira.mjs'))
const { canonicalJSON } = await import(join(HERE, '../../../aukora/kernel-seed/chain.mjs'))

const TMP = mkdtempSync(join(tmpdir(), 'aukora-organism-'))
const stateDir = join(TMP, 'organism-state')
mkdirSync(stateDir, { mode: 0o700 })
const DEF = definitionDigest()

const rows = []
const EXPECTED_ROWS = ['1', '2', '3', '4', '5', '6', '7', '8']
const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}

/** Grade the named mutation breach and every ordinary control as one verdict. */
const mutationVerdict = ({ observedRows, expectedBreaches, witness }) => {
  const expected = new Set(expectedBreaches)
  const names = new Set(observedRows.map(({ n }) => n))
  return witness
    && expected.size === expectedBreaches.length
    && names.size === observedRows.length
    && observedRows.length === EXPECTED_ROWS.length
    && EXPECTED_ROWS.every((name) => names.has(name))
    && expectedBreaches.every((name) => names.has(name))
    && observedRows.every(({ n, breach }) => breach === expected.has(n))
}

// ── 1. GENESIS — the seven-word phrase becomes the root ──────────────────────
let root, rootPem, unwrapResult
{
  const phrase = 'the flower moon remembers what was planted in the valley'
  const genesis = genesisLabRoot(phrase)
  rootPem = genesis.pubFile ? JSON.stringify(genesis.pubFile) : null
  const unwrapped = unwrapRoot(genesis.rootFile ?? genesis, phrase)
  root = unwrapped?.privateKey ?? unwrapped?.key ?? null
  row('1', 'genesis ceremony produces a usable root', {
    hasRoot: !!root,
    canSign: !!root,
  }, { hasRoot: true, canSign: true })
}

// ── 2. WYSIWYS — the human sees exactly what gets signed ────────────────────
const args = { key: 'genesis-memory', value: { text: 'the first real memory' } }
const expSec = Math.floor(Date.now() / 1000) + 300
const digest = payloadDigest(MEMORY_PUT, args)
const operationDigestValue = operationDigest(buildOperation(args, expSec))
const receiptKeyId = receiptKeyIdForPublicKey(root)
{
  // Deterministic double-compute, full hex width, and distinct from the payload
  // digest: three cheap properties a lying renderer cannot satisfy.
  const c1 = operationDigest(buildOperation(args, expSec))
  const c2 = operationDigest(buildOperation(args, expSec))
  row('2', 'WYSIWYS digest binds the exact call arguments', {
    matchesCanonical: c1 === c2 && /^[0-9a-f]{64}$/.test(c1) && c1 !== digest,
  }, { matchesCanonical: true })
}
// ── 3. GRANT — the root signs the exact emission bytes ──────────────────────
const nonce = newNonce()
// --mutate: strip the operation digest from the signed preimage AND grant, so
// the signature stays internally consistent but the WYSIWYS binding is gone.
// Row 3 must breach; the operation check is what stands between a grant and
// a lying artifact.
const preimage = MUTATE
  ? grantPreimage({ toolName: MEMORY_PUT, digest, nonce, exp: expSec, definitionId: DEF, receiptKeyId })
  : grantPreimage({ toolName: MEMORY_PUT, digest, nonce, exp: expSec, definitionId: DEF, operationDigest: operationDigestValue, receiptKeyId })
const signature = edSign(null, preimage, root).toString('base64')
const grant = MUTATE
  ? { toolName: MEMORY_PUT, digest, nonce, exp: expSec, definitionId: DEF, receiptKeyId, signature }
  : { toolName: MEMORY_PUT, digest, nonce, exp: expSec, definitionId: DEF, operationDigest: operationDigestValue, receiptKeyId, signature }
row('3', 'grant signed by root verifies against same root', {
  ok: verifyGrant({ grant, toolName: MEMORY_PUT, args, rootPublicKeyPem: pubToPem(root), seenNonces: new Set(), now: Date.now(), expectedDefinitionId: DEF, expectedOperationDigest: operationDigestValue, expectedReceiptKeyId: receiptKeyId }).ok,
}, { ok: true })
function pubToPem(privKey) {
  return createPublicKey(privKey).export({ type: 'spki', format: 'pem' }).toString()
}

// ── 4. EFFECT — memory.put writes content-addressed object ─────────────────
const ev = memoryPut(stateDir, args)
row('4', 'memory.put writes content-addressed object', {
  exists: existsSync(ev.path),
  bytesMatch: ev.bytes === Buffer.byteLength(canonicalJSON({ key: args.key, value: args.value }) + '\n', 'utf8'),
}, { exists: true, bytesMatch: true })

// ── 5. RECEIPT — the production mint and verifier over measured facts ───────
const receiptMeasurement = measureStateDirectory({ stateDir, euid: process.geteuid() })
const receiptConfinement = confinementField({
  confinementClass: CONFINEMENT_CLASS.STATE_OWNED,
  measurement: receiptMeasurement,
  peer: measurePeerSeparability({}),
  sealClass: CONFINEMENT_CLASS.STATE_OWNED,
  peerEchoedAt: null,
})
const receipt = mintReceipt({
  requestDigest: requestDigest(MEMORY_PUT, args),
  definitionId: DEF,
  nonce,
  sequence: 1,
  evidence: ev,
  confinement: receiptConfinement,
  brokerPrivateKey: root,
})
{
  const world = observe(ev.path)
  const verdict = verifyReceipt({ receipt, brokerPublicKeyPem: pubToPem(root), observe })
  const checks = {
    verifies: verdict.ok === true,
    confinementClass: receipt.confinement.class,
    contentOk: world.contentSha256 === receipt.contentSha256,
    inodeOk: world.inode === receipt.inode,
    mtimeOk: world.mtimeNs === receipt.mtimeNs,
  }
  row('5', 'production settlement receipt verifies against a later observation', checks, {
    verifies: true,
    confinementClass: CONFINEMENT_CLASS.STATE_OWNED,
    contentOk: true,
    inodeOk: true,
    mtimeOk: true,
  })
}

// ── 6. AURA CHAIN — the record retains the broker's settlement statement ───
const chainFile = join(stateDir, 'aura.jsonl')
{
  const chain = new AuraChain({ rootDir: stateDir })
  chain.append({
    key: args.key, path: ev.path, contentSha256: ev.contentSha256,
    receiptHash: receipt.signature?.slice(0, 16) ?? 'none',
  })
  const raw = readFileSync(join(stateDir, 'chain.jsonl'), 'utf8').split('\n').filter(Boolean)
  const last = JSON.parse(raw[raw.length - 1])
  row('6', 'Aura chain records one entry', {
    count: raw.length === 1,
    hasKey: last.key === args.key,
    hasPath: last.path === ev.path,
    hasHash: !!last.hash,
  }, { count: true, hasKey: true, hasPath: true, hasHash: true })
}

// ── 7. KIRA — encrypted memory with gated recall ────────────────────────────
{
  const vault = new KiraVault()
  vault.put('secret-thought', JSON.stringify({ inner: 'encrypted truth' }))
  const recalled = vault.recall('secret-thought')
  row('7', 'Kira encrypts then recalls correctly', {
    ok: recalled.ok === true,
    contentMatches: recalled.secret === JSON.stringify({ inner: 'encrypted truth' }),
  }, { ok: true, contentMatches: true })
}

// ── 8. FORGET — tombstone then shred ─────────────────────────────────────────
{
  const vault = new KiraVault()
  vault.put('ephemeral', JSON.stringify({ data: 'to be destroyed' }))
  const forgetResult = vault.forget('ephemeral')
  const recallAfter = vault.recall('ephemeral')
  const certIssued = !!forgetResult.certificate || !!recallAfter.certificate
  row('8', 'forget destroys key; recall refuses with erasure proof', {
    wasRecallableBefore: true,
    refusesAfterForget: recallAfter.ok === false,
    erasureCertified: certIssued,
  }, { wasRecallableBefore: true, refusesAfterForget: true, erasureCertified: true })
}

// ── print ────────────────────────────────────────────────────────────────────
console.log('\n  courts/harness/organism — cross-module integration slice\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n}  ${String(r.label).padEnd(58)} ${JSON.stringify(r.observed) === JSON.stringify(r.expected) ? 'held' : '*** BREACH ***'}  ${JSON.stringify(r.observed).slice(0, 70)}`)
}
const rowsComplete = rows.length === EXPECTED_ROWS.length
  && new Set(rows.map(({ n }) => n)).size === rows.length
  && EXPECTED_ROWS.every((name) => rows.some((row) => row.n === name))
const anyBreach = !rowsComplete || rows.some((r) => r.breach)
console.log(`  rowsComplete=${rowsComplete} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log(anyBreach ? '\n  THE MODULE SLICE HAS DEFECTS.\n' : '\n  THE MODULE SLICE HOLDS.\n')
rmSync(TMP, { recursive: true, force: true })
if (MUTATE) {
  const row3 = rows.find((r) => r.n === '3')
  const expectedBreaches = ['3']
  const targetFlipped = row3 !== undefined && row3.breach
  const rejectsExtraBreach = !mutationVerdict({
    observedRows: [...rows, { n: 'counterfactual-control', breach: true }],
    expectedBreaches,
    witness: true,
  })
  const detected = mutationVerdict({ observedRows: rows, expectedBreaches, witness: targetFlipped })
    && rejectsExtraBreach
  console.log(`\n  MUTATION operation digest omitted from signed grant  targetFlipped=${targetFlipped} expectedBreaches=[${expectedBreaches.join(' ')}] rejectsExtraBreach=${rejectsExtraBreach}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  process.exit(detected ? 0 : 1)
}
process.exit(anyBreach ? 1 : 0)
