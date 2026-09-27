/**
 * courts/harness/kernel-hardening — red regressions for the transplanted spine.
 *
 * Written RED FIRST against the transplanted code; each row turns held only
 * when the minimal fix lands. One row per demonstrated defect:
 *
 *   K1  merkle: honest indexes verify; wrong index, wrong size, and malformed
 *       statements refuse
 *   K2  digest unification: grant.digest === receipt.requestDigest
 *   K3  receipt strictness on the production verifier: control verifies;
 *       unknown, hidden, inherited, symbolic, malformed-signature, incomplete
 *       confinement, and wrong-typed claims refuse
 *   K4  bytes are UTF-8 byte length (multibyte proven against disk)
 *   K5  a corrupt digest-named object never yields successful evidence
 *   K6  symbolic-link object and store paths refuse instead of redirecting I/O
 *
 * --mutate changes the production inclusion verifier to accept a caller's
 * pre-hashed internal node as leaf data. Detection requires that exploit and
 * every ordinary K/M row to retain its expected result.
 *
 *   node courts/harness/kernel-hardening/run.mjs
 */
import { generateKeyPairSync } from 'node:crypto'
import {
  lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, readFileSync, writeFileSync,
  readdirSync, existsSync, symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const { payloadDigest } = await import(join(HERE, '../../../aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, MEMORY_PUT, memoryPut, observe } = await import(join(HERE, '../../../aukora/broker/effect.mjs'))
const MERKLE_PATH = join(HERE, '../../../aukora/aura/merkle.mjs')
const { leafHash, nodeHash, rootFromHashes, inclusionProof, verifyInclusion } = await import(MERKLE_PATH)
const { requestDigest, mintReceipt, verifyReceipt, RECEIPT_REFUSE } = await import(join(HERE, '../../../aukora/broker/receipt.mjs'))
const { measureStateDirectory, confinementField } = await import(join(HERE, '../../../aukora/broker/confinement.mjs'))

const TMP = mkdtempSync(join(tmpdir(), 'aukora-kernel-hardening-'))

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--mutate' && arg !== '--mutate=merkle-preimage-leaf')) {
  console.error(`kernel-hardening: unknown argument ${args.find((arg) => arg !== '--mutate' && arg !== '--mutate=merkle-preimage-leaf')}`)
  process.exit(2)
}

const MUTATE = args.length === 1


const rows = []
const EXPECTED_ROWS = [
  'K6',
  'K1', 'K1-index', 'K1-size', 'K1-malformed', 'K1-vector',
  'M1', 'M2', 'M3',
  'K2',
  'K3-control', 'K3-extra', 'K3-type', 'K3-closure',
  'K4', 'K5',
]
const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}

// ── K6: state paths are entries, not routes through symbolic links ──────────
{
  const leafState = join(TMP, 'state-k6-leaf')
  mkdirSync(leafState, { mode: 0o700 })
  const args = { key: 'symlink-leaf', value: { n: 6 } }
  const first = memoryPut(leafState, args)
  const externalObject = join(TMP, 'external-object.json')
  renameSync(first.path, externalObject)
  symlinkSync(externalObject, first.path)
  let leafReason = null
  try { memoryPut(leafState, args) } catch (error) { leafReason = String(error?.message ?? error) }

  const directoryState = join(TMP, 'state-k6-directory')
  const externalMemory = join(TMP, 'external-memory')
  mkdirSync(directoryState, { mode: 0o700 })
  mkdirSync(externalMemory, { mode: 0o700 })
  symlinkSync(externalMemory, join(directoryState, 'memory'))
  let directoryReason = null
  try { memoryPut(directoryState, { key: 'symlink-dir', value: 1 }) } catch (error) { directoryReason = String(error?.message ?? error) }

  row('K6', 'symbolic-link object and store paths refuse without redirected I/O', {
    leafReason,
    leafRemainsLink: lstatSync(first.path).isSymbolicLink(),
    receiptObserverState: observe(first.path).status,
    directoryReason,
    externalMemoryEntries: readdirSync(externalMemory).sort(),
  }, {
    leafReason: 'memory.put: object path is not a regular file',
    leafRemainsLink: true,
    receiptObserverState: 'unobservable',
    directoryReason: 'memory.put: state path is not a directory',
    externalMemoryEntries: [],
  })
}

// ── K1: every index of an odd-sized tree must verify ─────────────────────────
{
  const leaves = []
  for (let i = 0; i < 3; i++) leaves.push(leafHash(Buffer.from(`leaf-${i}`, 'utf8')))
  const root = rootFromHashes(leaves)
  const perIndex = []
  let allVerify = true
  for (let i = 0; i < 3; i++) {
    const proof = inclusionProof(leaves, i)
    const ok = verifyInclusion({ root, leafData: Buffer.from(`leaf-${i}`, 'utf8'), index: i, size: 3, proof })
    perIndex.push(`${i}:${ok}`)
    if (!ok) allVerify = false
  }
  row('K1', 'every index of a 3-leaf tree verifies',
    { allVerify, perIndex },
    { allVerify: true, perIndex: ['0:true', '1:true', '2:true'] })
  const proof0 = inclusionProof(leaves, 0)
  row('K1-index', 'a valid proof cannot claim a different leaf index', {
    refused: verifyInclusion({ root, leafData: Buffer.from('leaf-0', 'utf8'), index: 1, size: 3, proof: proof0 }) === false,
  }, { refused: true })
  row('K1-size', 'a valid proof cannot claim a different tree size', {
    refused: verifyInclusion({ root, leafData: Buffer.from('leaf-0', 'utf8'), index: 0, size: 4, proof: proof0 }) === false,
  }, { refused: true })
  row('K1-malformed', 'malformed statements and prover-supplied directions refuse', {
    nullRefused: verifyInclusion(null) === false,
    sideRefused: verifyInclusion({ root, leafData: Buffer.from('leaf-0', 'utf8'), index: 0, size: 3, proof: proof0.map((step) => ({ ...step, side: 'right' })) }) === false,
    executableProofRefused: verifyInclusion({
      root: rootFromHashes([leaves[0]]),
      leafData: Buffer.from('leaf-0', 'utf8'),
      index: 0,
      size: 1,
      proof: new Proxy([], { ownKeys() { throw new Error('proof-trap') } }),
    }) === false,
  }, { nullRefused: true, sideRefused: true, executableProofRefused: true })
}

// A fixed external vector prevents root construction and verification from
// drifting together while every self-generated proof stays green.
{
  const root = rootFromHashes(['a', 'b', 'c'].map((value) => leafHash(Buffer.from(value, 'utf8'))))
  row('K1-vector', 'the v2 root domain and size encoding match the frozen vector', {
    root: root.toString('hex'),
  }, {
    root: '3bca6f6cd34d2695809918c5ea02c6538ec9e37214ee36db0cf101fa9e4cf69a',
  })
}

// ── M1-M3: leaf/node domains are enforced by the verifier ──────────────────
let merkleConfusionFixture
{
  const raw = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]
  const honestHashes = raw.map(leafHash)
  const honestRoot = rootFromHashes(honestHashes)
  const honestProof = inclusionProof(honestHashes, 0)

  // The structural root below is deliberately built with an internal node in
  // the first hash slot. An old verifier that accepted a pre-hashed `leaf`
  // authenticated that node as though it were record data. The live verifier
  // hashes the presented bytes in the leaf domain and must refuse it.
  const internal = nodeHash(honestHashes[0], honestHashes[1])
  const ambiguousHashes = [internal, honestHashes[2]]
  const ambiguousRoot = rootFromHashes(ambiguousHashes)
  const ambiguousProof = inclusionProof(ambiguousHashes, 0)
  merkleConfusionFixture = { root: ambiguousRoot, leafData: internal, index: 0, size: 2, proof: ambiguousProof }

  row('M1', 'raw leaf data at its real index verifies', {
    verified: verifyInclusion({ root: honestRoot, leafData: raw[0], index: 0, size: 3, proof: honestProof }),
  }, { verified: true })
  row('M2', 'an internal node presented as raw leaf data refuses', {
    refused: verifyInclusion(merkleConfusionFixture) === false,
  }, { refused: true })
  row('M3', 'unrelated 32-byte data refuses without making M1 vacuous', {
    refused: verifyInclusion({ ...merkleConfusionFixture, leafData: Buffer.alloc(32, 0x07) }) === false,
  }, { refused: true })
}

// ── K2: one call, one digest — grant and receipt must agree ──────────────────
{
  const args = { key: 'unify', value: { n: 1 } }
  const grantDigest = payloadDigest(MEMORY_PUT, args)
  const receiptDigest = requestDigest(MEMORY_PUT, args)
  row('K2', 'grant.digest === receipt.requestDigest for the same call',
    { equal: grantDigest === receiptDigest }, { equal: true })
}

// ── K3: receipt strictness, measured on the PRODUCTION verifier ───────────
// verifyReceipt is called here, the way courts/harness/settlement S7 calls it.
// A court-local re-implementation of the shape rules would hold whatever
// aukora/broker/receipt.mjs did, and had already drifted from it.
//
// K3-control is the anti-vacuity pin: the unmutated receipt must VERIFY, so a
// malformed verdict on either mutant can only be the mutation. Without it a
// receipt this court built wrong would refuse for its own reasons and both
// strictness rows would read held.
{
  const stateDir = join(TMP, 'state-k3')
  mkdirSync(stateDir, { mode: 0o700 })
  const args = { key: 'strictness', value: { n: 1 } }
  const evidence = memoryPut(stateDir, args)
  const measurement = measureStateDirectory({ stateDir, euid: process.geteuid() })
  const confinement = confinementField({
    confinementClass: measurement.class,
    measurement,
    peer: { tokenPath: null, brokerReadError: null },
    sealClass: measurement.class,
    peerEchoedAt: null,
  })
  const broker = generateKeyPairSync('ed25519')
  const brokerPublicKeyPem = broker.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const base = mintReceipt({
    requestDigest: requestDigest(MEMORY_PUT, args),
    definitionId: definitionDigest(),
    nonce: 'k3-nonce',
    sequence: 1,
    evidence,
    confinement,
    brokerPrivateKey: broker.privateKey,
  })
  const verify = (receipt) => verifyReceipt({ receipt, brokerPublicKeyPem, observe })
  const control = verify(base)
  const withExtra = verify({ ...base, scope: 'admin:everything' })
  const wrongType = verify({ ...base, bytes: 'ten' })
  const hidden = { ...base }
  Object.defineProperty(hidden, 'scope', { value: 'admin:everything', enumerable: false })
  const symbolic = { ...base, [Symbol('scope')]: 'admin:everything' }
  const inherited = Object.assign(Object.create({ scope: 'admin:everything' }), base)
  const nonCanonicalSignature = verify({ ...base, signature: `${base.signature}!` })
  const incompleteConfinement = verify({
    ...base,
    confinement: {
      class: confinement.class,
      euid: confinement.euid,
      sealClass: confinement.sealClass,
      platform: confinement.platform,
    },
  })
  const confinementWithHiddenRider = { ...confinement }
  Object.defineProperty(confinementWithHiddenRider, 'authority', { value: 'admin', enumerable: false })
  const hiddenConfinement = verify({ ...base, confinement: confinementWithHiddenRider })
  const inconsistentConfinement = verify({
    ...base,
    confinement: { ...confinement, stateUid: confinement.euid + 1 },
  })
  row('K3-control', 'the honest receipt these rows mutate verifies',
    { ok: control.ok === true, reason: control.reason ?? null },
    { ok: true, reason: null })
  row('K3-extra', 'an unsigned rider field refuses malformed',
    { reason: withExtra.reason ?? null }, { reason: RECEIPT_REFUSE.MALFORMED })
  row('K3-type', 'a wrong-typed field refuses malformed',
    { reason: wrongType.reason ?? null }, { reason: RECEIPT_REFUSE.MALFORMED })
  row('K3-closure', 'hidden, inherited, symbolic, non-canonical, and incomplete signed artifacts refuse malformed', {
    hidden: verify(hidden).reason ?? null,
    inherited: verify(inherited).reason ?? null,
    symbolic: verify(symbolic).reason ?? null,
    nonCanonicalSignature: nonCanonicalSignature.reason ?? null,
    incompleteConfinement: incompleteConfinement.reason ?? null,
    hiddenConfinement: hiddenConfinement.reason ?? null,
    inconsistentConfinement: inconsistentConfinement.reason ?? null,
  }, {
    hidden: RECEIPT_REFUSE.MALFORMED,
    inherited: RECEIPT_REFUSE.MALFORMED,
    symbolic: RECEIPT_REFUSE.MALFORMED,
    nonCanonicalSignature: RECEIPT_REFUSE.MALFORMED,
    incompleteConfinement: RECEIPT_REFUSE.MALFORMED,
    hiddenConfinement: RECEIPT_REFUSE.MALFORMED,
    inconsistentConfinement: RECEIPT_REFUSE.MALFORMED,
  })
}

// ── K4: bytes are UTF-8 BYTE length, proven against the disk ─────────────────
{
  const stateDir = join(TMP, 'state-k4')
  mkdirSync(stateDir, { mode: 0o700 })
  const args = { key: 'unicode', value: { text: 'naïve — 🌕 記憶' } }
  const ev = memoryPut(stateDir, args)
  const onDisk = readFileSync(ev.path)
  row('K4', 'bytes equals UTF-8 byte length on disk (multibyte)', {
    matchesDiskBytes: ev.bytes === onDisk.length,
    charLengthWouldLie: Buffer.byteLength(JSON.stringify({ key: args.key, value: args.value }) + '\n', 'utf8') !== [...(JSON.stringify({ key: args.key, value: args.value }) + '\n')].length,
  }, { matchesDiskBytes: true, charLengthWouldLie: true })
}

// ── K5: a corrupt digest-named object never yields successful evidence ──────
// The put under judgement is the ONLY statement inside the try. Setup throwing
// inside it — the first put, the directory listing, the forge — would have set
// `threw` with `secondEvidence` still null and read as the refusal this row is
// about. Two states did exactly that: a missing objects directory (ENOENT out
// of readdirSync) and an empty one (`join(objDir, undefined)` TypeError).
// `objectsBeforeForge` states the precondition in the row itself: one honest
// object existed and was overwritten before the second put ran.
{
  const stateDir = join(TMP, 'state-k5')
  mkdirSync(stateDir, { mode: 0o700 })
  const args = { key: 'victim', value: { secret: 'AKIA-EXAMPLE' } }
  memoryPut(stateDir, args) // first put: writes objects/<sha>.json honestly
  const objDir = join(stateDir, 'memory', 'objects')
  const objectsBeforeForge = existsSync(objDir) ? readdirSync(objDir) : []
  const victim = objectsBeforeForge[0]
  if (victim !== undefined) {
    // Simulate the attacker: forge the object bytes so the filename digest lies.
    writeFileSync(join(objDir, victim), `${JSON.stringify({ key: 'victim', value: 'FORGED' })}\n`, 'utf8')
  }
  let secondEvidence = null
  let threw = null
  try {
    secondEvidence = memoryPut(stateDir, args) // same call again -> hits corrupt object
  } catch (error) { threw = String(error?.message ?? error) }
  row('K5', 'a corrupt digest-named object refuses instead of admitting', {
    objectsBeforeForge: objectsBeforeForge.length,
    refused: threw !== null,
    noSuccessfulEvidence: secondEvidence === null,
  }, { objectsBeforeForge: 1, refused: true, noSuccessfulEvidence: true })
}

console.log('\n  courts/harness/kernel-hardening — red regressions for the spine\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n}  ${String(r.label).padEnd(58)} ${JSON.stringify(r.observed) === JSON.stringify(r.expected) ? 'held' : '*** BREACH ***'}  ${JSON.stringify(r.observed).slice(0, 70)}`)
}
const anyBreach = rows.some((r) => r.breach)
const ordinaryRowsHeld = () => {
  const names = new Set(rows.map(({ n }) => n))
  return rows.length === EXPECTED_ROWS.length
    && names.size === rows.length
    && EXPECTED_ROWS.every((name) => names.has(name))
    && rows.every(({ breach }) => !breach)
}

// --mutate: remove the production leaf-domain hash so an internal node can be
// passed as if it were raw leaf data. Direction is not prover-controlled in
// the canonical proof format.
if (MUTATE) {
  const source = readFileSync(MERKLE_PATH, 'utf8')
  const weakened = source.replace('let current = leafHash(leafData)', 'let current = leafData')
  if (weakened === source) {
    console.error('\n  MUTATION merkle preimage sabotage could not find its production seam\n')
    rmSync(TMP, { recursive: true, force: true })
    process.exit(1)
  }
  const mutantPath = join(TMP, 'merkle-preimage-mutant.mjs')
  writeFileSync(mutantPath, weakened, 'utf8')
  const mutant = await import(mutantPath)
  const internalNodeAdmitted = mutant.verifyInclusion(merkleConfusionFixture)
  const ordinaryRowsComplete = ordinaryRowsHeld()
  const detected = internalNodeAdmitted === true && ordinaryRowsComplete
  console.log(`\n  MUTATION verifier accepts a pre-hashed leaf  internalNodeAdmitted=${internalNodeAdmitted} ordinaryRowsHeld=${ordinaryRowsComplete}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}

const ordinaryRowsComplete = ordinaryRowsHeld()
console.log(anyBreach || !ordinaryRowsComplete ? '\n  DEFECTS CONFIRMED — fix minimally, keep this court green afterward.\n' : '\n  ALL HELD.\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach || !ordinaryRowsComplete ? 1 : 0)
