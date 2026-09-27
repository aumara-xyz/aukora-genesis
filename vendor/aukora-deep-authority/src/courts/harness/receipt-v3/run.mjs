/**
 * courts/harness/receipt-v3 — the repo-free v3 verifier and its named refusals.
 *
 * This court is the red-but-correct starting state the crew reconciliation named
 * (`CREW-RECONCILIATION.md` §B16, `RECEIPT-STANDARD.proposal.md` §8): before the
 * verifier and the fixture exist, every row here fails, because there is no v3
 * document to grade and no field-reading verifier to grade it with.
 *
 * WHAT THIS ARM MEASURES
 *   ordinary  the verifier's static import graph is exactly `node:crypto`; the
 *             checked-in fixture verifies structurally and is reported
 *             `SCRIPTED — NOT EVIDENCE`; the class-versus-kind pair refuses both
 *             ways; a `human-ceremony` document refuses by name because no owner
 *             key is registered; the inline JCS agrees with an RFC 8785 reference
 *             and the Python arm is measured rather than assumed; and the whole
 *             verifier runs from a directory with no repository in it.
 *   --mutate  each declared fixture field is sabotaged in turn and must produce
 *             its own named refusal, then one expectation is made deliberately
 *             wrong and the verdict must go false.
 *
 * CEILINGS. This is builder-owned, self-reported evidence. A writer able to
 * change the verifier, the fixture and this court can produce a coherent false
 * result. The Python arm is skipped with a named line when `python3` is absent,
 * and the skip is printed rather than counted as agreement.
 *
 *   node courts/harness/receipt-v3/run.mjs
 *   node courts/harness/receipt-v3/run.mjs --mutate
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  RECEIPT_V3_FIXTURE_KIND,
  RECEIPT_V3_KIND,
  canonicalJSONV3,
  verifyReceiptV3,
} from '../../../aukora/receipt-v3/verify.mjs'
import {
  fixtureIssuerKeyPair,
  fixtureKeyPair,
  mintFixtureEvidence,
  mintHumanCeremonyDocument,
  signDocument,
} from './mint-fixture.mjs'
// The exporter is imported dynamically. It reaches the authority graph
// (aura/record.mjs, broker/receipt.mjs), and a static import here would make the
// cold row's copy of this court's module graph carry that dependency.
const exportModule = await import('../../../aukora/receipt-v3/export.mjs')
const exporter = exportModule

const HERE = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = join(HERE, '../../..')
const FIXTURE_PATH = join(HERE, 'fixtures/v3-fixture.json')
const VERIFIER_PATH = join(REPOSITORY_ROOT, 'aukora/receipt-v3/verify.mjs')
const VERIFIER_BIN_PATH = join(REPOSITORY_ROOT, 'aukora/receipt-v3/verify-bin.mjs')

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/receipt-v3/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'

const EXPECTED_ROWS = [
  'V3.import-purity',
  'V3.fixture',
  'V3.class-kind',
  'V3.human-refused',
  'V3.canonical-parity',
  'V3.cold',
  'V3.export-roundtrip',
  'V3.original-untouched',
  'V3.settlement-refused',
  'V3.live-settlement-export',
  'V3.second-settlement',
  'V3.export-failure-handling',
]

/**
 * Every fixture field the mutation arm sabotages, as
 * `[path, sabotageKind, logicRefusal]`.
 *
 * `logicRefusal` is the refusal the verifier must name for THAT field once the
 * mutant has been re-signed. `null` means no field-level check reads the value,
 * so the mutant is NOT re-signed and the document signature is the only thing
 * that can catch it — the arm demands `receipt:signature` and thereby proves the
 * field is signature-covered rather than unchecked.
 *
 * This two-case shape exists because the document signature covers every field
 * this arm walks. Re-signing everything would make genuinely unchecked fields
 * look verified, and re-signing nothing would let an earlier signature refusal
 * mask every field-reading check. Reporting the split is the measurement.
 *
 * `resource` is deliberately absent from BOTH lists: step 1 does not bind it to
 * the grant payload and its value is read by no check, so it is a real gap. It is
 * reported as an open finding rather than given an expectation that would pass
 * for the wrong reason.
 */
const MUTATIONS = Object.freeze([
  ['action.canonical', 'text', 'action:digest'],
  ['action.digest', 'text', 'action:digest'],
  ['approval.at', 'integer', 'receipt:inconsistent'],
  ['aura.entry.nonce', 'text', 'aura:entry-binds-receipt'],
  ['aura.entry.receiptSha256', 'text', 'aura:hash'],
  ['aura.entry.verdict', 'text', 'aura:hash'],
  ['aura.hash', 'text', 'aura:hash'],
  ['aura.prev', 'text', 'aura:hash'],
  ['aura.seq', 'integer', 'aura:hash'],
  ['authorization.keyId', 'text', null],
  ['authorization.payload.digest', 'text', 'grant:signature'],
  ['authorization.payload.nonce', 'text', 'grant:signature'],
  ['authorization.payload.tool', 'text', 'grant:signature'],
  ['authorization.signature', 'signature', 'grant:signature'],
  ['ceilings', 'array', null],
  ['definitionId', 'text', 'grant:binding'],
  ['domain', 'text', 'receipt:field-set'],
  ['effect.observedAt', 'integer', null],
  ['effect.observedDigest', 'text', null],
  ['head.at', 'integer', 'head:signature'],
  ['head.hash', 'text', 'head:signature'],
  ['head.keyId', 'text', 'head:signature'],
  ['head.seq', 'integer', 'head:signature'],
  ['head.signature', 'signature', 'head:signature'],
  ['issuerKeyId', 'text', null],
  ['kind', 'text', 'receipt:field-set'],
  ['nonce', 'text', 'grant:binding'],
  ['operation', 'text', 'grant:binding'],
  ['publication', 'text', 'receipt:field-set'],
  ['signature', 'signature', 'receipt:signature'],
  ['times.approvedAt', 'integer', 'receipt:inconsistent'],
  ['times.expiresAt', 'integer', null],
  ['times.issuedAt', 'integer', null],
  ['times.settledAt', 'integer', null],
])

const rowsAreExact = (rows) => {
  const names = rows.map((row) => row.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const clone = (value) => JSON.parse(JSON.stringify(value))

/** Walk one dotted path in a document, returning its parent and final key. */
function locate(document, path) {
  const parts = path.split('.')
  let cursor = document
  for (const part of parts.slice(0, -1)) {
    if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, part)) return null
    cursor = cursor[part]
  }
  const last = parts.at(-1)
  if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, last)) return null
  return { parent: cursor, key: last }
}

/** Sabotage one field in place, by kind, without touching anything else. */
function sabotage(document, path, kind) {
  const site = locate(document, path)
  if (site === null) throw new Error(`mutation field is absent from the fixture: ${path}`)
  const current = site.parent[site.key]
  if (kind === 'text') {
    if (typeof current !== 'string' || current.length === 0) {
      throw new Error(`mutation field is not a non-empty string: ${path}`)
    }
    // Flip one character, keeping the length, so a closed-set check cannot
    // refuse for a reason other than the content it reads.
    const flipped = current[0] === 'a' ? 'b' : 'a'
    site.parent[site.key] = flipped + current.slice(1)
    return
  }
  if (kind === 'integer') {
    if (!Number.isSafeInteger(current)) throw new Error(`mutation field is not an integer: ${path}`)
    site.parent[site.key] = current - 1
    return
  }
  if (kind === 'signature') {
    if (typeof current !== 'string' || current.length !== 88) {
      throw new Error(`mutation field is not a 64-byte base64 signature: ${path}`)
    }
    // Stay shape-valid: an 88-character re-encode of 64 zero bytes passes the
    // length and re-encoding checks and can only be caught by the actual
    // cryptographic verification, which is the check under test here.
    const forged = Buffer.alloc(64).toString('base64')
    site.parent[site.key] = current === forged ? Buffer.alloc(64, 1).toString('base64') : forged
    return
  }
  if (kind === 'array') {
    if (!Array.isArray(current)) throw new Error(`mutation field is not an array: ${path}`)
    // Replace a ceiling with a different well-formed name, so the array stays
    // valid and only the signed content moves.
    site.parent[site.key] = [...current.slice(0, -1), 'MUTATED_CEILING']
    return
  }
  throw new Error(`unknown mutation kind: ${kind}`)
}

const fixtureDocument = readJson(FIXTURE_PATH)
/**
 * BOTH FIXTURE KEYS ARE DERIVED, NEVER READ FROM DISK.
 *
 * `.gitignore` ignores `*.pem` globally, so a committed PEM cannot exist and a
 * fresh checkout has none. Reading one made this court pass locally and fail in
 * CI with `ENOENT: ... v3-fixture-executor.pem`. The fixture keys come from the
 * fixed non-secret seeds in `mint-fixture.mjs`, which makes them reproducible on
 * any machine while leaving the secret-ignore rule untouched.
 */
const FIXTURE_EXECUTOR_KEYS = fixtureKeyPair()
const FIXTURE_ISSUER_KEYS = fixtureIssuerKeyPair()
const fixtureKey = FIXTURE_EXECUTOR_KEYS.publicKeyPem
// The checked-in fixture's keypair, re-derived rather than read from a key file.
// The mutation arm re-signs with it so no mutation is masked by a stale
// document signature.
const FIXTURE_DOCUMENT = fixtureDocument
const FIXTURE_PRIVATE_KEY = FIXTURE_EXECUTOR_KEYS.privateKey
const FIXTURE_KEY = fixtureKey
const FIXTURE_ISSUER_KEY = FIXTURE_ISSUER_KEYS.publicKeyPem

/** Fields the fixture actually carries, so a declared mutation cannot silently no-op. */
const SABOTAGEABLE = MUTATIONS.filter(([path]) => locate(FIXTURE_DOCUMENT, path) !== null)

const rows = []

// V3.import-purity — the verifier's static import graph, parsed from code with
// comments stripped, so prose in the module cannot satisfy or break the rule.
const verifierSource = readFileSync(VERIFIER_PATH, 'utf8')
const verifierCode = verifierSource
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/(^|[^:])\/\/.*$/gmu, '$1')
const importSpecifiers = [...verifierCode.matchAll(/\bimport\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/gu)]
  .map((match) => match[1])
  .concat([...verifierCode.matchAll(/\bexport\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]))
const dynamicImports = [...verifierCode.matchAll(/\bimport\s*\(/gu)].length
const repositoryReferences = [...verifierCode.matchAll(/['"][^'"]*aukora\/[^'"]*['"]/gu)].length
rows.push({
  n: 'V3.import-purity',
  ok: importSpecifiers.length === 1
    && importSpecifiers[0] === 'node:crypto'
    && dynamicImports === 0
    && repositoryReferences === 0,
  d: `imports=[${importSpecifiers.join(',')}] dynamic=${dynamicImports} repoSpecifiers=${repositoryReferences}`,
})

// V3.fixture — TWO PAIRS, TWO VERDICTS, and the difference is the point.
//
// The checked-in document is SYNTHETIC EVIDENCE: it carries the evidence kind
// with an `unattributed` approval, because no approval signature exists for it.
// That pair must refuse `receipt:class-kind-mismatch` — a document that cannot
// say who approved it cannot present itself as evidence of an approval.
//
// The scripted pair takes the SAME document, declares the fixture kind and a
// `scripted` class, re-signs (the kind and approval block are covered by the
// signature), and reaches CONFORMING as a fixture that is explicitly not
// evidence. So the refusal is a property of the claim, not of the bytes.
const syntheticEvidence = verifyReceiptV3({
  document: fixtureDocument,
  executorPublicKeys: [fixtureKey],
  issuerPublicKeys: [FIXTURE_ISSUER_KEY],
})
const scriptedFixture = {
  ...clone(fixtureDocument),
  kind: RECEIPT_V3_FIXTURE_KIND,
  approval: { class: 'scripted', at: fixtureDocument.approval.at },
}
signDocument(scriptedFixture, FIXTURE_PRIVATE_KEY)
const scriptedResult = verifyReceiptV3({
  document: scriptedFixture,
  executorPublicKeys: [fixtureKey],
  issuerPublicKeys: [FIXTURE_ISSUER_KEY],
})
const fixtureHeld = syntheticEvidence.verdict === 'NON-CONFORMING'
  && syntheticEvidence.reasons.length === 1
  && syntheticEvidence.reasons[0] === 'receipt:class-kind-mismatch'
  && syntheticEvidence.approvalClass === 'unattributed'
  && syntheticEvidence.lines.some((line) => line.includes('NO APPROVAL EVIDENCE'))
  && scriptedResult.verdict === 'CONFORMING'
  && scriptedResult.reasons.length === 0
  && scriptedResult.lines.some((line) => line.includes('SCRIPTED — NOT EVIDENCE'))
rows.push({
  n: 'V3.fixture',
  ok: fixtureHeld,
  d: `synthetic=${syntheticEvidence.verdict}/${String(syntheticEvidence.approvalClass)}`
    + ` scripted=${scriptedResult.verdict}/${String(scriptedResult.approvalClass)}`,
})

// V3.class-kind — the pair refuses in both directions.
const evidenceKindFixture = { ...clone(fixtureDocument), kind: RECEIPT_V3_KIND }
const evidenceKindResult = verifyReceiptV3({ document: evidenceKindFixture, executorPublicKeys: [fixtureKey], issuerPublicKeys: [FIXTURE_ISSUER_KEY] })
const scriptedKind = { ...clone(fixtureDocument), kind: RECEIPT_V3_FIXTURE_KIND, approval: { class: 'human-ceremony', at: fixtureDocument.approval.at } }
const scriptedKindResult = verifyReceiptV3({ document: scriptedKind, executorPublicKeys: [fixtureKey], issuerPublicKeys: [FIXTURE_ISSUER_KEY], ownerPublicKeys: [fixtureKey] })
const classKindHeld = evidenceKindResult.reasons.includes('receipt:class-kind-mismatch')
  && scriptedKindResult.reasons.includes('receipt:class-kind-mismatch')
rows.push({
  n: 'V3.class-kind',
  ok: classKindHeld,
  d: `scriptedUnderEvidenceKind=${evidenceKindResult.reasons.includes('receipt:class-kind-mismatch')} humanUnderFixtureKind=${scriptedKindResult.reasons.includes('receipt:class-kind-mismatch')}`,
})

// V3.human-refused — a human-ceremony document refuses while no owner key exists.
// The document is minted and signed HERE rather than adapted from the checked-in
// fixture, because the document signature covers the approval block: a document
// edited after signing would refuse `receipt:signature` first and mask the row.
//
// TWO refusals are correct, not one. `approval:owner-key-unregistered` is the
// row under test. `approval:challenge-unbound` is a measured gap: this grant
// family's payload carries no challenge field, so an approval challenge binds to
// nothing. Supplying the owner key leaves exactly that second refusal standing,
// which is the assertion that keeps the gap visible instead of hidden behind the
// first refusal.
const humanMint = mintHumanCeremonyDocument()
const humanNoKeys = verifyReceiptV3({ document: humanMint.document, executorPublicKeys: [humanMint.publicKeyPem], issuerPublicKeys: [humanMint.issuerPublicKeyPem] })
const humanWithKey = verifyReceiptV3({
  document: humanMint.document,
  executorPublicKeys: [humanMint.publicKeyPem],
  issuerPublicKeys: [humanMint.issuerPublicKeyPem],
  ownerPublicKeys: [humanMint.publicKeyPem],
})
// The CLASS line states what the document CLAIMS and prints under either
// verdict; `VERDICT NON-CONFORMING` carries the actual status. A reader who needs
// to know whether the claim was checked reads the verdict, and a reader who reads
// only the class line still learns that the document says a person signed it and
// that attendance is reported rather than proven. The row therefore asserts the
// class line is present AND that the verdict is NON-CONFORMING, rather than
// asserting the class line is hidden — hiding it would suppress the honest
// sentence exactly when the document is most suspect.
const humanHeld = humanNoKeys.reasons.includes('approval:owner-key-unregistered')
  && humanNoKeys.verdict === 'NON-CONFORMING'
  && humanNoKeys.lines.some((line) => line === 'VERDICT NON-CONFORMING')
  && humanNoKeys.lines.some((line) => line.includes('OWNER_KEY_SIGNED / ATTENDANCE_REPORTED_NOT_PROVEN'))
  && humanWithKey.reasons.length === 1
  && humanWithKey.reasons[0] === 'approval:challenge-unbound'
  && humanWithKey.lines.some((line) => line.includes('OWNER_KEY_SIGNED / ATTENDANCE_REPORTED_NOT_PROVEN'))
rows.push({
  n: 'V3.human-refused',
  ok: humanHeld,
  d: `noOwnerKey=${humanNoKeys.reasons.join('|') || 'none'} withOwnerKey=${humanWithKey.reasons.join('|') || 'none'}`,
})

// V3.canonical-parity — the inline JCS against an independent RFC 8785
// reference, then against Python. The Python arm MEASURES whether it agrees on
// an astral key instead of asserting that it diverges: the two orderings agree
// for an astral key against ASCII and disagree only against a BMP key in
// U+E000..U+FFFF, which is what the second corpus entry carries.
const PARITY_CORPUS = Object.freeze({
  'astral-versus-ascii': { '\u{1D518}': 1, 'z': 2 },
  'astral-versus-bmp-high': { '\u{1D518}': 1, '\uFFFD': 2 },
  'nested-astral': { outer: { '\u{1D518}': 'a', 'z': 'b' }, empty: [] },
  'safe-boundary': { max: 9007199254740991, min: -9007199254740991 },
  'empty-containers': { array: [], object: {} },
  'escapes': { quote: 'a"b', newline: 'a\nb', backslash: 'a\\b', tab: 'a\tb' },
})

/** An inline RFC 8785 reference, written independently of the verifier's encoder. */
function referenceJcs(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('reference:number-not-integer')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(referenceJcs).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${referenceJcs(value[key])}`).join(',')}}`
}

const jcsAgreesWithReference = Object.entries(PARITY_CORPUS).every(([, value]) => {
  try {
    return canonicalJSONV3(value) === referenceJcs(value)
  } catch {
    return false
  }
})

const pythonProgram = 'import json,sys;print(json.dumps(json.loads(sys.stdin.read()),sort_keys=True,separators=(",",":"),ensure_ascii=False))'
const pythonDump = (value) => {
  const result = spawnSync('python3', ['-c', pythonProgram], { input: JSON.stringify(value), encoding: 'utf8' })
  return result.status === 0 ? result.stdout.replace(/\n$/u, '') : null
}
const pythonAstral = pythonDump(PARITY_CORPUS['astral-versus-ascii'])
const pythonBmpHigh = pythonDump(PARITY_CORPUS['astral-versus-bmp-high'])
const pythonPresent = pythonAstral !== null && pythonBmpHigh !== null
const pythonAgreesOnAstral = pythonAstral === canonicalJSONV3(PARITY_CORPUS['astral-versus-ascii'])
const pythonDivergesOnBmpHigh = pythonBmpHigh !== canonicalJSONV3(PARITY_CORPUS['astral-versus-bmp-high'])
const nonIntegerRefused = (() => {
  try {
    canonicalJSONV3({ float: 1.5 })
    return false
  } catch (error) {
    return error?.message === 'receipt:number-not-integer'
  }
})()
const parityHeld = jcsAgreesWithReference && nonIntegerRefused
  && (!pythonPresent || (pythonAgreesOnAstral && pythonDivergesOnBmpHigh))
rows.push({
  n: 'V3.canonical-parity',
  ok: parityHeld,
  d: `referenceAgrees=${jcsAgreesWithReference} floatRefused=${nonIntegerRefused} python=${pythonPresent ? 'present' : 'absent'} pythonAstralAgrees=${pythonPresent ? pythonAgreesOnAstral : 'skipped'} pythonBmpDiverges=${pythonPresent ? pythonDivergesOnBmpHigh : 'skipped'}`,
})

// V3.cold — the verifier and the fixture alone, in a directory with no repository.
const coldDirectory = mkdtempSync(join(tmpdir(), 'aukora-receipt-v3-cold-'))
let coldHeld = false
let coldDetail = 'not run'
try {
  copyFileSync(VERIFIER_PATH, join(coldDirectory, 'verify.mjs'))
  copyFileSync(VERIFIER_BIN_PATH, join(coldDirectory, 'verify-bin.mjs'))
  // The document graded here is the fixture-KIND pair, derived by taking the
  // checked-in synthetic document and declaring it a fixture. That is the one
  // pair whose `kind` and approval class are both `scripted`, so it is the pair
  // a cold recipient can bring to CONFORMING. Its signature is recomputed
  // because the approval block and kind are covered by it.
  const scriptedFixture = {
    ...clone(FIXTURE_DOCUMENT),
    kind: RECEIPT_V3_FIXTURE_KIND,
    approval: { class: 'scripted', at: FIXTURE_DOCUMENT.approval.at },
  }
  signDocument(scriptedFixture, FIXTURE_PRIVATE_KEY)
  writeFileSync(join(coldDirectory, 'receipt.json'), `${canonicalJSONV3(scriptedFixture)}\n`, 'utf8')
  writeFileSync(join(coldDirectory, 'executor.pem'), FIXTURE_KEY, 'utf8')
  writeFileSync(join(coldDirectory, 'issuer.pem'), FIXTURE_ISSUER_KEY, 'utf8')
  const cold = spawnSync(process.execPath, ['verify-bin.mjs', 'receipt.json', '--executor-key', 'executor.pem', '--issuer-key', 'issuer.pem'], {
    cwd: coldDirectory,
    encoding: 'utf8',
  })
  coldHeld = cold.status === 0
    && cold.stdout.includes('VERDICT CONFORMING')
    && cold.stdout.includes('CLASS SCRIPTED — NOT EVIDENCE')
  coldDetail = `status=${cold.status} conforming=${cold.stdout.includes('VERDICT CONFORMING')}`
  if (!coldHeld) {
    process.stdout.write(`\n  cold stderr: ${cold.stderr.trim()}\n  cold stdout: ${cold.stdout.trim()}\n`)
  }
} finally {
  rmSync(coldDirectory, { recursive: true, force: true })
}
rows.push({ n: 'V3.cold', ok: coldHeld, d: coldDetail })

// V3.export-roundtrip — export a fixture-state settlement through the real
// exporter and the real Aura chain, then grade the result in a directory that
// holds only the verifier, the document and one key.
//
// The export is built from evidence a settlement actually produces: a signed v1
// receipt and an Aura entry naming its digest. It carries NO approval signature,
// because none reaches a real settlement in this tree (measured: the only caller
// of `approve-artifact` anywhere is a test). So the class the exporter derives is
// `scripted`, and a `scripted` class under the evidence `kind` refuses
// `receipt:class-kind-mismatch`. That refusal IS the row: the document honestly
// reports that it carries no owner signature and cannot be graded as one.
const exportDirectory = mkdtempSync(join(tmpdir(), 'aukora-receipt-v3-export-'))
let exportHeld = false
let exportDetail = 'not run'
let originalBytesHeld = false
let originalDetail = 'not run'
let settlementRefusedHeld = false
let settlementDetail = 'not run'
try {
  const evidence = mintFixtureEvidence()
  const stateDir = join(exportDirectory, 'state')
  const receiptsDir = join(stateDir, 'receipts')
  mkdirSync(receiptsDir, { recursive: true, mode: 0o700 })
  const v1Bytes = Buffer.from(`${canonicalJSONV3(evidence.settlement)}\n`, 'utf8')
  const v1Path = join(receiptsDir, `${evidence.settlementSha256}.json`)
  writeFileSync(v1Path, v1Bytes, { mode: 0o600 })
  // The chain is written by the PRODUCT's own writer, so the entry hash and
  // predecessor the exporter reads are real rather than a court's imitation.
  const record = await import('../../../aukora/aura/record.mjs')
  record.appendEntry({ file: join(stateDir, 'aura.jsonl'), fields: evidence.entryBody })

  const document = exporter.buildReceiptV3({
    stateDir,
    receipt: evidence.settlement,
    operation: 'workspace.patch',
    resource: 'fixture://receipt-v3/step-1',
    approvedCanonical: evidence.canonicalAction,
    actionDigest: evidence.actionDigest,
    authorization: evidence.authorization,
    executorPrivateKey: evidence.privateKey,
    at: evidence.document.times.settledAt,
    origin: 'fixture',
  })
  const written = exporter.writeReceiptV3({ stateDir, document })

  // Grade it in a directory containing no repository at all.
  const cold = mkdtempSync(join(tmpdir(), 'aukora-receipt-v3-export-cold-'))
  try {
    copyFileSync(VERIFIER_PATH, join(cold, 'verify.mjs'))
    copyFileSync(VERIFIER_BIN_PATH, join(cold, 'verify-bin.mjs'))
    writeFileSync(join(cold, 'receipt.json'), readFileSync(written.path), 'utf8')
    writeFileSync(join(cold, 'executor.pem'), FIXTURE_KEY, 'utf8')
    writeFileSync(join(cold, 'issuer.pem'), FIXTURE_ISSUER_KEY, 'utf8')
    const graded = spawnSync(process.execPath, ['verify-bin.mjs', 'receipt.json', '--executor-key', 'executor.pem', '--issuer-key', 'issuer.pem'], {
      cwd: cold,
      encoding: 'utf8',
    })
    // THE ONLY REFUSAL MAY BE THE HONEST ONE.
    //
    // This document is exported from evidence that carries no approval
    // signature, so its class is `unattributed` under the evidence kind and it
    // refuses `receipt:class-kind-mismatch`. Everything else must hold with only
    // the document and two keys present: the document signature, the head
    // statement, the Aura hash, the settlement-to-entry digest binding, AND the
    // embedded v1 receipt's own signature. Exactly one reason means no other
    // check failed quietly alongside it.
    const refusesOnlyClassKind = graded.stdout.includes('REASON receipt:class-kind-mismatch')
      && graded.stdout.split('REASON ').length === 2
    exportHeld = graded.status === 1
      && graded.stdout.includes('VERDICT NON-CONFORMING')
      && refusesOnlyClassKind
      && graded.stdout.includes('CLASS NO APPROVAL EVIDENCE — NOT EVIDENCE')
    exportDetail = `status=${graded.status} classKindOnly=${refusesOnlyClassKind}`
      + ` noApprovalEvidenceClaimed=${graded.stdout.includes('NO APPROVAL EVIDENCE')}`
    if (!exportHeld) {
      process.stdout.write(`\n  export stderr: ${graded.stderr.trim()}\n  export stdout: ${graded.stdout.trim()}\n`)
    }
  } finally {
    rmSync(cold, { recursive: true, force: true })
  }

  // V3.original-untouched — the v1 receipt's bytes on disk are identical before
  // and after the export, and no export overwrote them.
  const after = readFileSync(v1Path)
  originalBytesHeld = after.equals(v1Bytes) && existsSync(written.path)
  originalDetail = `identical=${after.equals(v1Bytes)} exportWritten=${existsSync(written.path)}`

  // V3.settlement-refused — the SAME evidence exported as a real settlement
  // rather than a fixture. The class derived from a settlement with no owner
  // signature is `scripted`, and a scripted class under the evidence kind
  // refuses. That refusal is the document correctly reporting that no owner key
  // signed it: this is why a real export cannot be graded CONFORMING today, and
  // the row exists so the gap cannot quietly disappear.
  const settlementDocument = exporter.buildReceiptV3({
    stateDir,
    receipt: evidence.settlement,
    operation: 'workspace.patch',
    resource: 'fixture://receipt-v3/step-1',
    approvedCanonical: evidence.canonicalAction,
    actionDigest: evidence.actionDigest,
    authorization: evidence.authorization,
    executorPrivateKey: evidence.privateKey,
    at: evidence.document.times.settledAt,
  })
  const settlementResult = verifyReceiptV3({
    document: settlementDocument,
    executorPublicKeys: [evidence.publicKeyPem],
    issuerPublicKeys: [evidence.issuerPublicKeyPem],
    ownerPublicKeys: [evidence.publicKeyPem],
  })
  settlementRefusedHeld = settlementDocument.kind === RECEIPT_V3_KIND
    && settlementResult.verdict === 'NON-CONFORMING'
    && settlementResult.reasons.includes('receipt:class-kind-mismatch')
  settlementDetail = `kind=${String(settlementDocument.kind)} verdict=${settlementResult.verdict} reasons=${settlementResult.reasons.join('|') || 'none'}`
} catch (error) {
  exportDetail = `threw ${String(error?.message ?? error)}`
  originalDetail = `threw ${String(error?.message ?? error)}`
  settlementDetail = `threw ${String(error?.message ?? error)}`
} finally {
  rmSync(exportDirectory, { recursive: true, force: true })
}
rows.push({ n: 'V3.export-roundtrip', ok: exportHeld, d: exportDetail })
rows.push({ n: 'V3.original-untouched', ok: originalBytesHeld, d: originalDetail })
rows.push({ n: 'V3.settlement-refused', ok: settlementRefusedHeld, d: settlementDetail })

// V3.live-settlement-export and V3.second-settlement — a REAL broker, driven
// twice. These are the rows that make the first two bugs found on this branch
// impossible to reintroduce:
//
//   1. The exporter required a 32-hex nonce while `newNonce()` mints 24, so
//      EVERY live export refused `export:malformed — entry nonce` and no
//      `.v3.json` was ever written. The hook was dead code and every court row
//      stayed green, because the fixture carried a nonce the broker cannot mint.
//   2. The export wrote `.v3.json` into `receipts/`, which
//      `verifyReceiptDirectory` requires to contain only canonical v1 receipts,
//      so the FIRST settlement poisoned the SECOND with
//      `INDETERMINATE — broker:aura-preflight (receipt:entry-malformed)`.
//
// Both were invisible to any single-settlement, fixture-only court. A row that
// settles TWICE against a live broker catches both.
const liveDirectory = mkdtempSync(join(tmpdir(), 'aukora-receipt-v3-live-'))
let liveHeld = false
let liveDetail = 'not run'
let secondHeld = false
let secondDetail = 'not run'
try {
  const { createConnection } = await import('node:net')
  const crypto = await import('node:crypto')
  const brokerModule = await import('../../../aukora/broker/broker.mjs')
  const grantModule = await import('../../../aukora/host-dsh/src/grant.mjs')
  const definitionModule = await import('../../../aukora/broker/effect-definition.mjs')
  const operationModule = await import('../../../aukora/broker/operation.mjs')

  const socketPath = join(liveDirectory, 'broker.sock')
  const stateDir = join(liveDirectory, 'state')
  const definitionId = definitionModule.definitionDigest()
  const receiptKeyId = brokerModule.provisionBrokerIdentity(stateDir).receiptKeyId
  const root = crypto.generateKeyPairSync('ed25519')
  const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const connect = (socket) => {
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

  const broker = await brokerModule.spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
  const cli = connect(socketPath)
  const status = await cli.send({ op: 'status' })
  const settle = async (key) => {
    const arguments_ = { key, value: { text: `live ${key}` } }
    const exp = Math.floor(Date.now() / 1000) + 300
    const claims = {
      toolName: definitionModule.MEMORY_PUT,
      digest: grantModule.payloadDigest(definitionModule.MEMORY_PUT, arguments_),
      nonce: grantModule.newNonce(),
      exp,
      definitionId,
      operationDigest: operationModule.operationDigest(operationModule.buildOperation(arguments_, exp)),
      receiptKeyId,
    }
    const grant = { ...claims, signature: crypto.sign(null, grantModule.grantPreimage(claims), root.privateKey).toString('base64') }
    return cli.send({ op: 'memory.put', toolName: definitionModule.MEMORY_PUT, arguments: arguments_, grant })
  }

  const first = await settle('live-one')
  const second = await settle('live-two')
  await cli.close()
  broker.kill?.('SIGTERM')

  const v1Directory = join(stateDir, 'receipts')
  const v3Directory = join(stateDir, 'receipts-v3')
  const v1Names = readdirSync(v1Directory).sort()
  const v3Names = readdirSync(v3Directory).sort()

  // The live export must exist, must be named for a v1 receipt that exists, and
  // must be readable with mode 0444.
  let graded = null
  // The first settlement's own export, found by its own v1 digest rather than by
  // position, because this fixture settles twice.
  const firstStem = first.ok === true ? exportModule.receiptV1Sha256(first.receipt) : null
  const firstV3Name = firstStem === null ? undefined : `${firstStem}.v3.json`
  if (firstV3Name !== undefined && v3Names.includes(firstV3Name)) {
    const document = JSON.parse(readFileSync(join(v3Directory, firstV3Name), 'utf8'))
    graded = verifyReceiptV3({
      document,
      executorPublicKeys: [status.brokerPublicKeyPem],
      issuerPublicKeys: [rootPem],
    })
  }
  liveHeld = first.ok === true
    && first.receiptV3Refusal === null
    && firstV3Name !== undefined
    && v3Names.includes(firstV3Name)
    && v1Names.includes(`${firstStem}.json`)
    && graded !== null
    // The ONLY refusal a real export may carry is the honest one: a settlement
    // with no owner signature cannot be graded as owner-signed evidence.
    && graded.verdict === 'NON-CONFORMING'
    && graded.reasons.length === 1
    && graded.reasons[0] === 'receipt:class-kind-mismatch'
  liveDetail = `settled=${first.ok === true} refusal=${JSON.stringify(first.receiptV3Refusal)}`
    + ` ownExport=${firstV3Name !== undefined && v3Names.includes(firstV3Name)}`
    + (graded === null ? ' verdict=none' : ` verdict=${graded.verdict} reasons=${graded.reasons.join('|') || 'none'}`)

  // The second settlement is the regression for the receipts-directory poison.
  // It must settle on its own merits, and its export must land too.
  secondHeld = second.ok === true
    && second.receiptV3Refusal === null
    && v1Names.length === 2
    && v3Names.length === 2
    && v1Names.every((name) => /^[0-9a-f]{64}\.json$/u.test(name))
  secondDetail = `settled=${second.ok === true} refusal=${JSON.stringify(second.receiptV3Refusal)}`
    + `${second.ok === true ? '' : ` reason=${String(second.reason)} detail=${String(second.detail)}`}`
    + ` v1=${v1Names.length} v3=${v3Names.length}`
} catch (error) {
  liveDetail = `threw ${String(error?.message ?? error)}`
  secondDetail = `threw ${String(error?.message ?? error)}`
} finally {
  rmSync(liveDirectory, { recursive: true, force: true })
}
rows.push({ n: 'V3.live-settlement-export', ok: liveHeld, d: liveDetail })
rows.push({ n: 'V3.second-settlement', ok: secondHeld, d: secondDetail })

// V3.export-failure-handling — an export that CANNOT be written must be reported
// and must not touch the settlement. Disposable state: a fresh broker whose
// exports directory is a regular file, so the exporter's create-if-absent fails
// with ENOTDIR. The settlement itself must still be SETTLED, the original v1
// receipt must still be on disk and verifiable, and the refusal must be visible
// on the result rather than swallowed.
const failureDirectory = mkdtempSync(join(tmpdir(), 'aukora-receipt-v3-failure-'))
let failureHeld = false
let failureDetail = 'not run'
try {
  const { createConnection } = await import('node:net')
  const crypto = await import('node:crypto')
  const { writeFileSync: write } = await import('node:fs')
  const brokerModule = await import('../../../aukora/broker/broker.mjs')
  const grantModule = await import('../../../aukora/host-dsh/src/grant.mjs')
  const definitionModule = await import('../../../aukora/broker/effect-definition.mjs')
  const operationModule = await import('../../../aukora/broker/operation.mjs')

  const socketPath = join(failureDirectory, 'broker.sock')
  const stateDir = join(failureDirectory, 'state')
  const definitionId = definitionModule.definitionDigest()
  const receiptKeyId = brokerModule.provisionBrokerIdentity(stateDir).receiptKeyId
  const root = crypto.generateKeyPairSync('ed25519')
  const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  // The export directory name is occupied by a FILE, so mkdir cannot produce it.
  write(join(stateDir, 'receipts-v3'), 'occupied by a regular file\n', 'utf8')

  const broker = await brokerModule.spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
  const connection = createConnection(socketPath)
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
      if (waiter !== undefined) { pending.delete(reply.id); waiter(reply) }
    }
  })
  await new Promise((resolve) => connection.once('connect', resolve))
  let next = 1
  const send = (frame) => new Promise((resolve) => {
    const id = next++
    pending.set(id, resolve)
    connection.write(`${JSON.stringify({ id, ...frame })}\n`)
  })

  const arguments_ = { key: 'failure-path', value: { text: 'x' } }
  const exp = Math.floor(Date.now() / 1000) + 300
  const claims = {
    toolName: definitionModule.MEMORY_PUT,
    digest: grantModule.payloadDigest(definitionModule.MEMORY_PUT, arguments_),
    nonce: grantModule.newNonce(),
    exp,
    definitionId,
    operationDigest: operationModule.operationDigest(operationModule.buildOperation(arguments_, exp)),
    receiptKeyId,
  }
  const grant = { ...claims, signature: crypto.sign(null, grantModule.grantPreimage(claims), root.privateKey).toString('base64') }
  const settled = await send({ op: 'memory.put', toolName: definitionModule.MEMORY_PUT, arguments: arguments_, grant })
  connection.end()
  broker.kill?.('SIGTERM')

  const refusal = typeof settled.receiptV3Refusal === 'string' ? settled.receiptV3Refusal : null
  const v1Names = readdirSync(join(stateDir, 'receipts')).sort()
  // The settlement stands, the refusal is named, and nothing was published.
  failureHeld = settled.ok === true
    && settled.state === 'SETTLED'
    && refusal !== null
    && refusal.startsWith('export:')
    && v1Names.length === 1
    && /^[0-9a-f]{64}\.json$/u.test(v1Names[0])
  failureDetail = `settled=${settled.ok === true}/${String(settled.state)} refusal=${JSON.stringify(refusal)} v1=${v1Names.length}`
} catch (error) {
  failureDetail = `threw ${String(error?.message ?? error)}`
} finally {
  rmSync(failureDirectory, { recursive: true, force: true })
}
rows.push({ n: 'V3.export-failure-handling', ok: failureHeld, d: failureDetail })

console.log('\n  courts/harness/receipt-v3 — repo-free verifier, named refusals, portable cold run\n  ' + '-'.repeat(72))
for (const row of rows) {
  console.log(`  ${row.n}  ${row.ok ? 'held' : '*** BREACH ***'}  ${row.d}`)
}
console.log(`\n  fixture mutation fields declared=${MUTATIONS.length} sabotageable=${SABOTAGEABLE.length}`)
if (pythonPresent) {
  console.log('  python arm: sort_keys agrees with JCS on an astral key and diverges on a BMP key in U+E000..U+FFFF')
} else {
  console.log('  python arm: SKIPPED — python3 absent or failed; no agreement is claimed for it')
}

/** Run every declared field mutation and demand the refusal it names. */
function runMutations(expectations) {
  let fields = 0
  let isolated = 0
  let signatureCovered = 0
  let refusedByName = 0
  /** @type {string[]} */
  const misses = []
  for (const [path, kind, logicRefusal] of expectations) {
    const candidate = clone(FIXTURE_DOCUMENT)
    sabotage(candidate, path, kind)
    const expected = logicRefusal ?? 'receipt:signature'
    // Re-sign only when a field-level check exists, so the signature cannot mask
    // it. Where no check exists the mutant is left unsigned and the signature is
    // the only layer that can catch it. The `signature` field is the one
    // exception: its sabotage IS a fresh signature, so re-signing would undo the
    // mutation and the row would grade the original document.
    const reSign = logicRefusal !== null && path !== 'signature'
    if (reSign) signDocument(candidate, FIXTURE_PRIVATE_KEY)
    fields += 1
    if (logicRefusal === null || path === 'signature') signatureCovered += 1
    else isolated += 1
    const result = verifyReceiptV3({ document: candidate, executorPublicKeys: [FIXTURE_KEY], issuerPublicKeys: [FIXTURE_ISSUER_KEY] })
    if (result.reasons.includes(expected) && result.verdict === 'NON-CONFORMING') refusedByName += 1
    else misses.push(`${path}→${result.reasons.join('|') || 'CONFORMING'} (wanted ${expected})`)
  }
  return { fields, isolated, signatureCovered, refusedByName, misses }
}

const mutationVerdict = ({ fields, refusedByName, sabotagedRejected }) => fields === SABOTAGEABLE.length
  && refusedByName === SABOTAGEABLE.length
  && sabotagedRejected

if (MUTATE) {
  const clean = runMutations(SABOTAGEABLE)
  // Sabotage arm: one expectation is made deliberately wrong, so a court that
  // accepts everything must report detection=false.
  const sabotaged = SABOTAGEABLE.map(([path, kind, logicRefusal], index) => index === 0
    ? [path, kind, 'receipt:not-a-real-refusal']
    : [path, kind, logicRefusal])
  const sabotagedRun = runMutations(sabotaged)
  const sabotagedRejected = sabotagedRun.refusedByName !== sabotagedRun.fields
  const detected = mutationVerdict({
    fields: clean.fields,
    refusedByName: clean.refusedByName,
    sabotagedRejected,
  })
  for (const miss of clean.misses) console.log(`  MISS ${miss}`)
  console.log(`\n  measured isolated=${clean.isolated} signatureCovered=${clean.signatureCovered}`)
  console.log(`  MUTATION field-flip  fields=${clean.fields}/${SABOTAGEABLE.length}`
    + ` refusedByName=${clean.refusedByName}/${SABOTAGEABLE.length}`
    + ` sabotagedRejected=${sabotagedRejected}`
    + ` detected=${detected}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  process.exit(detected ? 0 : 1)
}

const ordinaryHeld = rowsAreExact(rows) && rows.every((row) => row.ok)
console.log(`\n  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log('  observationClass: SELF-REPORTED\n')
process.exit(ordinaryHeld ? 0 : 1)
