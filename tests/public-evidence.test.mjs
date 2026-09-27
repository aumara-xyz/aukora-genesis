#!/usr/bin/env node
/**
 * The public evidence handoff: an allowlisted export, and the refusals that keep it allowlisted.
 *
 *   node tests/public-evidence.test.mjs            # every control
 *
 * WHAT THIS SUITE IS, AND WHAT IT IS NOT. Every control here runs OFFLINE, in one process, against
 * disposable state. It measures the EXPORTER's own properties: the fixed layout, determinism, the
 * allowlist, the closed field sets, the symlink rule, the anchor rule, and the verifier's refusal of
 * a tampered or unlisted byte.
 *
 * IT IS NOT THE PRODUCER→CONSUMER EVIDENCE. `scripts/kira/public-evidence-acceptance.mjs` is, and it
 * needs a Diamond checkout, `python3` and a live signer daemon, so CI cannot run it. The receipts
 * this suite writes are written by the TEST ADAPTER below, out of the plugin's own exported
 * primitives, and are therefore PRODUCIBLE BY SHAPE but NOT signatures checked by anyone. No control
 * in this file claims a signature verified, and none claims Diamond consumed anything.
 *
 * THE STORE THIS SUITE EXPORTS REALLY DOES CONTAIN A PRIVATE KEY, because every store does:
 * `plugins/aukora-kira/lib/memory-owner.mjs:194-200` writes the issuer's PKCS#8 private half into
 * `<stateDir>/issuer.json`. That is the canary. Control 3 asserts the private bytes are NOT in the
 * export and that the member is NAMED as excluded, so a regression that widens the allowlist fails
 * here rather than in a reviewer's reproduction.
 *
 * Disposable state only: one temporary root per run, removed afterwards. No release, profile, live
 * state or running process is touched, and nothing outside the temporary root is written.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sawSomething } from './helpers/vacuity.mjs'

import {
  MANIFEST_KIND, PublicEvidenceRefusal, exportPublicEvidence, operationDigestOf, sha256,
  verifyPublicEvidence,
} from '../scripts/kira/public-evidence.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { createMemoryOwner, AURA_RECORD_DOMAIN, auraEntryHash } = await import(
  pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const { stageKiraMemoryRecord, memoryEffectBody, canonicalJSON } = await import(
  pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)

const work = mkdtempSync(join(tmpdir(), 'kira-pubev-test-'))
const AT = '2026-09-08T00:00:00Z'
const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
const PRODUCER_COMMIT = '9'.repeat(40)

let failures = 0
/** Run one named control; a thrown error is a failure and never stops the suite. */
function control(name, body) {
  try {
    body()
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${error.message.split('\n').join('\n        ')}\n`)
  }
}

/** Assert that a call refuses with one EXACT code, and return the refusal. */
function refuses(code, body) {
  try {
    body()
  } catch (error) {
    assert.ok(error instanceof PublicEvidenceRefusal, `expected a PublicEvidenceRefusal, got ${String(error)}`)
    assert.equal(error.code, code, `expected refusal ${code}, got ${error.code}: ${error.detail}`)
    return error
  }
  throw new Error(`expected refusal ${code} and nothing was refused`)
}

/**
 * Build one disposable store with the plugin's own primitives.
 *
 * `createMemoryOwner` writes the real `issuer.json` (public AND private halves), the real directory
 * layout and the real `grant.json` shape. The chain, the object bodies and the receipts are written
 * here, out of the plugin's own exported record contract, because the real settle path needs a
 * running signer that this offline suite deliberately does not start.
 *
 * @param {string} root - the directory to build the store under.
 * @param {{notes?: string[]}} [options] - the notes to settle, in order.
 * @returns {{stateDir: string, entries: Record<string, unknown>[]}} the store and what was written.
 */
function buildStore(root, options = {}) {
  const notes = options.notes ?? ['Cedar endpoint listens on port 8098', 'Rollback runbook lives in ops/rollback.md']
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const owner = createMemoryOwner({ stateDir })
  /** @type {Record<string, unknown>[]} */
  const entries = []
  let prev = AURA_RECORD_DOMAIN
  const chain = []
  for (const [index, note] of notes.entries()) {
    const staged = stageKiraMemoryRecord({
      subject: SUBJECT, kind: 'observation', source: [], content: { note }, links: [], privacy: 'local', createdAt: AT,
    })
    const body = memoryEffectBody(staged.memoryPut)
    const contentSha256 = sha256(body)
    writeFileSync(join(stateDir, 'objects', `${contentSha256}.json`), body, { mode: 0o600 })
    const sequence = index + 1
    const fields = { verdict: 'settled', key: staged.recordId, contentSha256, operation: 'memory.put', sequence }
    const hash = auraEntryHash(prev, fields)
    chain.push({ ...fields, prev, hash })
    prev = hash
    const receipt = {
      kind: 'aukora-kira-memory-receipt/v1',
      operation: 'memory.put',
      recordId: staged.recordId,
      effectDigest: contentSha256,
      nonce: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      issuedAt: 1790000000,
      aura: { entryHash: hash, seq: sequence, priorHead: chain.length === 1 ? null : chain[chain.length - 2].hash, head: hash },
      sig: 'a'.repeat(128),
      // A SHAPE only: this suite starts no signer, so no consumer could verify this receipt. The
      // producer→consumer evidence is scripts/kira/public-evidence-acceptance.mjs, which does.
      issuerPk: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAA\n-----END PUBLIC KEY-----\n',
      approval: {
        approvalId: sha256(`aukora:approval-receipt:v1\0${'4'.repeat(64)}\0${'b'.repeat(128)}`),
        artifactDomain: 'aukora:approval-receipt:v1',
        challenge: '4'.repeat(64),
        subject: SUBJECT,
        approverDid: `did:key:z6Mk${'A'.repeat(40)}`,
        operationDigest: operationDigestOf(Buffer.from(body, 'utf8')),
        signature: 'b'.repeat(128),
        approvalClass: 'scripted',
        keyClass: 'B',
      },
    }
    writeFileSync(join(stateDir, `receipt-memory.put-${String(sequence).padStart(3, '0')}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    entries.push({ recordId: staged.recordId, contentSha256, body, sequence, receipt })
  }
  writeFileSync(join(stateDir, 'aura.jsonl'), `${chain.map(row => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 })
  writeFileSync(join(stateDir, 'keys', `${entries[0].recordId}.json`),
    `${JSON.stringify({ key: entries[0].recordId, contentSha256: entries[0].contentSha256 })}\n`, { mode: 0o600 })
  // The owner's own sequence counter, written by the same code path that appends an Aura entry.
  writeFileSync(join(stateDir, 'seq'), String(entries.length), { mode: 0o600 })
  // The owner's own key pair, PRIVATE HALF INCLUDED. Written by createMemoryOwner; the canary.
  assert.ok(existsSync(join(stateDir, 'issuer.json')), 'the store must carry issuer.json for the canary to mean anything')
  assert.match(readFileSync(join(stateDir, 'issuer.json'), 'utf8'), /BEGIN PRIVATE KEY/u)
  return { stateDir, entries }
}

/** Write one external anchor file and return its path. */
function writeAnchor(root, name, text) {
  const dir = join(root, 'anchors')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, text, { mode: 0o644 })
  return path
}

/**
 * Write one flat `aukora:approval-receipt:v1` artifact with the CLOSED twenty-field set.
 *
 * This is a SHAPE, not a signed approval: the signature is filler and this suite never claims a
 * consumer verified it. What the exporter checks about it is the DERIVED operation digest and the
 * derived approvalId, both of which are real arithmetic over these bytes.
 *
 * @param {string} path - where to write it.
 * @param {string} operationDigest - the digest the artifact should name.
 * @returns {{path: string, challenge: string, signature: string}} what was written.
 */
function writeArtifact(path, operationDigest) {
  const challenge = '4'.repeat(64)
  const signature = 'b'.repeat(128)
  writeFileSync(path, `${JSON.stringify({
    domain: 'aukora:approval-receipt:v1',
    verdict: 'OWNER_KEY_SIGNED',
    keyClass: 'B',
    keyClassMeaning: 'software-held',
    approvalClass: 'scripted',
    subject: SUBJECT,
    activeControlDigest: '5'.repeat(64),
    approvalKeyDid: `did:key:z6Mk${'A'.repeat(40)}`,
    operationDigest,
    challenge,
    issuedAt: 1790000000,
    expiresAt: 4102444800,
    signature,
    signedBytesDigest: '6'.repeat(64),
    verifiedAt: 1790000000,
    attendance: 'reported-not-proven',
    signerDeviceTrusted: 'software-key-file',
    succession: 'unmeasured',
    identityBound: false,
    ceilings: ['SIGNATURE_IS_NOT_ATTENDANCE'],
  }, null, 2)}\n`, { mode: 0o644 })
  return { path, challenge, signature }
}

// ── the fixtures ───────────────────────────────────────────────────────────────────────────────

const fixtureRoot = join(work, 'fixture')
mkdirSync(fixtureRoot, { recursive: true })
const { stateDir, entries } = buildStore(fixtureRoot)
const first = entries[0]
const issuerAnchor = writeAnchor(fixtureRoot, 'issuer', '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAA\n-----END PUBLIC KEY-----\n')
const approverAnchor = writeAnchor(fixtureRoot, 'approver.pk', `${'c'.repeat(64)}\n`)

// A release whose record is small and real: a directory with the release's own record file in it.
const releaseDir = join(work, 'release')
mkdirSync(join(releaseDir, '.dsh-build'), { recursive: true })
const RELEASE_RECORD = {
  formatVersion: 1,
  kind: 'dsh-artifact-record',
  producer: { node: 'v22.23.0', platform: 'darwin-arm64', genesisCommit: PRODUCER_COMMIT },
  host: { fileCount: 3, bytes: 12, sha256: '7'.repeat(64) },
  entries: [{ path: 'aukora-composition.patch.yml', bytes: 4, sha256: '8'.repeat(64) }],
}
writeFileSync(join(releaseDir, '.dsh-build', 'genesis-artifacts.json'), `${JSON.stringify(RELEASE_RECORD, null, 2)}\n`)

/** Export the fixture store into a fresh directory. */
function exportInto(name, overrides = {}) {
  const outDir = join(work, name)
  const manifest = exportPublicEvidence({
    storeDir: stateDir,
    outDir,
    producerCommit: PRODUCER_COMMIT,
    releaseDir,
    anchors: new Map([['issuer', issuerAnchor], ['approver', approverAnchor]]),
    approvals: new Map(),
    ...overrides,
  })
  return { outDir, manifest }
}

process.stdout.write('public evidence — allowlisted handoff export\n\n')

// ── 1. the fixed layout ────────────────────────────────────────────────────────────────────────

let good = /** @type {{outDir: string, manifest: Record<string, unknown>}} */ (null)
control('the export has the fixed layout, and every declared file is present', () => {
  good = exportInto('export-good')
  for (const relative of [
    'manifest.json', 'producer-commit.txt', 'release-record.json',
    'release-record/genesis-artifacts.json', 'evidence/aura.jsonl',
    `evidence/objects/${first.contentSha256}.json`,
    `evidence/records/${first.contentSha256}.json`,
    `evidence/receipts/${first.contentSha256}.json`,
    'anchors/issuer', 'anchors/approver',
  ]) {
    assert.ok(existsSync(join(good.outDir, relative)), `${relative} is missing from the export`)
  }
  assert.equal(good.manifest.kind, MANIFEST_KIND)
  assert.equal(good.manifest.schemaVersion, 1)
  assert.equal(good.manifest.producer.commit, PRODUCER_COMMIT)
  const releaseRecord = good.manifest.releaseRecord
  assert.equal(releaseRecord.releasePath, releaseDir, 'the release path must be recorded beside the digest')
  assert.equal(releaseRecord.recordDigest.value, sha256(readFileSync(join(releaseDir, '.dsh-build', 'genesis-artifacts.json'))))
  assert.equal(releaseRecord.pathDependent, true)
  assert.ok(releaseRecord.producerCommitAgrees)
})

control('producer-commit.txt carries the commit and nothing else', () => {
  assert.equal(readFileSync(join(good.outDir, 'producer-commit.txt'), 'utf8'), `${PRODUCER_COMMIT}\n`)
})

control('the manifest is itself the handoff: every file with its digest and size', () => {
  const files = good.manifest.files
  assert.ok(Array.isArray(files) && files.length > 0)
  for (const entry of files) {
    const bytes = readFileSync(join(good.outDir, entry.path))
    assert.equal(bytes.byteLength, entry.bytes, `${entry.path} size disagrees with the manifest`)
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} digest disagrees with the manifest`)
  }
  const onDisk = []
  const walk = (prefix) => {
    for (const name of readdirSync(join(good.outDir, prefix)).sort()) {
      const relative = prefix === '' ? name : `${prefix}/${name}`
      if (lstatSync(join(good.outDir, relative)).isDirectory()) walk(relative)
      else onDisk.push(relative)
    }
  }
  walk('')
  assert.deepEqual(onDisk.sort(), [...files.map(entry => entry.path), 'manifest.json'].sort(),
    'the manifest lists exactly the files present')
})

// ── 2. determinism ─────────────────────────────────────────────────────────────────────────────

control('two runs over identical inputs are byte-identical, clock and all', () => {
  const second = exportInto('export-second', { storeDir: stateDir })
  const read = root => {
    /** @type {Record<string, string>} */
    const out = {}
    const walk = (prefix) => {
      for (const name of readdirSync(join(root, prefix)).sort()) {
        const relative = prefix === '' ? name : `${prefix}/${name}`
        if (lstatSync(join(root, relative)).isDirectory()) walk(relative)
        else out[relative] = sha256(readFileSync(join(root, relative)))
      }
    }
    walk('')
    return out
  }
  const left = read(good.outDir)
  const right = read(second.outDir)
  assert.deepEqual(Object.keys(left), Object.keys(right), 'the two exports carry different file sets')
  for (const path of Object.keys(left)) {
    assert.equal(left[path], right[path], `${path} differs between two runs over identical inputs`)
  }
  // The manifest must carry no CLOCK FIELD. Checked against the parsed keys rather than the text,
  // because the manifest's own `limits` prose explains why it carries no generatedAt, and a text
  // search would fail on the explanation instead of on the thing.
  const manifestObject = JSON.parse(readFileSync(join(good.outDir, 'manifest.json'), 'utf8'))
  const KEY_NAMES = new Set()
  const collect = value => {
    if (Array.isArray(value)) { value.forEach(collect); return }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) { KEY_NAMES.add(key); collect(child) }
  }
  collect(manifestObject)
  for (const clock of ['generatedAt', 'createdAt', 'timestamp', 'now', 'exportedAt', 'mintedAt']) {
    assert.ok(!KEY_NAMES.has(clock),
      `the manifest carries the field name \`${clock}\`; a clock makes every run disagree with every other`)
  }
})

// ── 3. the allowlist, and the private key that must not travel ─────────────────────────────────

control('the store really does carry a private key, and the export does not', () => {
  const issuer = readFileSync(join(stateDir, 'issuer.json'), 'utf8')
  const privateMaterial = JSON.parse(issuer).privateKey
  assert.match(privateMaterial, /BEGIN PRIVATE KEY/u, 'the fixture must contain a real PKCS#8 private key')
  const exported = []
  const walk = (prefix) => {
    for (const name of readdirSync(join(good.outDir, prefix)).sort()) {
      const relative = prefix === '' ? name : `${prefix}/${name}`
      if (lstatSync(join(good.outDir, relative)).isDirectory()) walk(relative)
      else exported.push(relative)
    }
  }
  walk('')
  for (const relative of exported) {
    const text = readFileSync(join(good.outDir, relative), 'utf8')
    // **GUARDED: A NEGATION OVER AN EMPTY SUBJECT IS TRUE BY CONSTRUCTION.**
    sawSomething(text, "the exported file")
    assert.ok(!text.includes(privateMaterial), `${relative} carries the issuer PRIVATE KEY`)
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/u.test(text), `${relative} carries a private-key PEM header`)
  }
  // And the exporter NAMES what it left behind, rather than dropping it silently.
  const excluded = /** @type {{path: string, reason: string}[]} */ (good.manifest.excluded)
  const issuerRow = excluded.find(row => row.path === 'issuer.json')
  assert.ok(issuerRow !== undefined, 'issuer.json must be named in manifest.excluded')
  assert.match(issuerRow.reason, /PRIVATE KEY/u)
  assert.ok(excluded.some(row => row.path.startsWith('spent/')), 'the nonce registry must be named as excluded')
  assert.ok(excluded.some(row => row.path.startsWith('approvals/')), 'the approval registry must be named as excluded')
  assert.ok(excluded.some(row => row.path === 'keys/'), 'keys/ must be named as excluded')
  assert.ok(excluded.some(row => row.path === 'seq'), 'seq must be named as excluded')
})

control('a caller that ASKS for a private member is refused by name', () => {
  for (const member of ['issuer.json', 'grant.json', 'approval.json', 'seq']) {
    const outDir = join(work, `include-${member.replaceAll('.', '-')}`)
    const error = refuses('PUBLIC_EVIDENCE_PRIVATE_MEMBER_REQUESTED', () => {
      exportPublicEvidence({
        storeDir: stateDir, outDir, producerCommit: PRODUCER_COMMIT, releaseDir,
        anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(), include: [member],
      })
    })
    assert.match(error.detail, new RegExp(member.replaceAll('.', '\\.'), 'u'), 'the refusal must name the member')
    assert.ok(!existsSync(outDir), 'a refused export writes no directory')
  }
})

control('a caller that ASKS for an unallowlisted member is refused by name', () => {
  const error = refuses('PUBLIC_EVIDENCE_MEMBER_NOT_ALLOWED', () => {
    exportPublicEvidence({
      storeDir: stateDir, outDir: join(work, 'include-keys'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(), include: ['keys/anything.json'],
    })
  })
  assert.match(error.detail, /allowlist/u)
})

// ── 4. symlinks are refused by name ───────────────────────────────────────────────────────────

control('a symlink in the store is refused by name', () => {
  const root = join(work, 'symlink-store')
  mkdirSync(root, { recursive: true })
  const { stateDir: linked } = buildStore(root, { notes: ['Cedar endpoint listens on port 8098'] })
  const target = join(linked, 'objects')
  const victim = join(work, 'elsewhere-object.json')
  writeFileSync(victim, '{"key":"kira:' + '0'.repeat(64) + '","value":{}}\n')
  const firstObject = readdirSync(target)[0]
  rmSync(join(target, firstObject))
  symlinkSync(victim, join(target, firstObject))
  const error = refuses('PUBLIC_EVIDENCE_SYMLINK_REFUSED', () => {
    exportPublicEvidence({
      storeDir: linked, outDir: join(work, 'symlink-out'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(),
    })
  })
  assert.match(error.detail, /objects\//u, 'the refusal must name the link')
})

// ── 5. anchors come from outside the store ────────────────────────────────────────────────────

control('an anchor inside the store is refused by name', () => {
  const error = refuses('PUBLIC_EVIDENCE_ANCHOR_INSIDE_STORE', () => {
    exportPublicEvidence({
      storeDir: stateDir, outDir: join(work, 'anchor-inside'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['issuer', join(stateDir, 'issuer.json')]]), approvals: new Map(),
    })
  })
  assert.match(error.detail, /issuer\.json/u)
})

control('an export with no named issuer anchor is refused by name', () => {
  refuses('PUBLIC_EVIDENCE_ANCHOR_UNDECLARED', () => {
    exportPublicEvidence({
      storeDir: stateDir, outDir: join(work, 'anchor-absent'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['approver', approverAnchor]]), approvals: new Map(),
    })
  })
})

// ── 6. closed field sets, default-deny ────────────────────────────────────────────────────────

control('a private field name in an object body is refused by name, before anything is written', () => {
  const root = join(work, 'private-field-store')
  mkdirSync(root, { recursive: true })
  const { stateDir: dirty, entries: dirtyEntries } = buildStore(root, { notes: ['Cedar endpoint listens on port 8098'] })
  const objectPath = join(dirty, 'objects', `${dirtyEntries[0].contentSha256}.json`)
  const body = JSON.parse(readFileSync(objectPath, 'utf8'))
  body.value.privateKey = 'redacted-for-the-control'
  writeFileSync(objectPath, `${canonicalJSON(body)}\n`)
  const error = refuses('PUBLIC_EVIDENCE_PRIVATE_FIELD', () => {
    exportPublicEvidence({
      storeDir: dirty, outDir: join(work, 'private-field-out'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(),
    })
  })
  assert.match(error.detail, /privateKey/u, 'the refusal must name the field')
  assert.ok(!existsSync(join(work, 'private-field-out')), 'a refused export writes no directory')
})

control('an unknown field in a receipt is refused by name', () => {
  const root = join(work, 'extra-field-store')
  mkdirSync(root, { recursive: true })
  const { stateDir: dirty } = buildStore(root, { notes: ['Cedar endpoint listens on port 8098'] })
  const receiptPath = join(dirty, 'receipt-memory.put-001.json')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  receipt.bonusClaim = true
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  const error = refuses('PUBLIC_EVIDENCE_NOT_CLOSED', () => {
    exportPublicEvidence({
      storeDir: dirty, outDir: join(work, 'extra-field-out'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(),
    })
  })
  assert.match(error.detail, /bonusClaim/u, 'the refusal must name the extra field')
})

control('a broken Aura chain is refused by name', () => {
  const root = join(work, 'broken-chain-store')
  mkdirSync(root, { recursive: true })
  const { stateDir: dirty } = buildStore(root, { notes: ['Cedar endpoint listens on port 8098', 'second note'] })
  const auraPath = join(dirty, 'aura.jsonl')
  const lines = readFileSync(auraPath, 'utf8').trimEnd().split('\n')
  const second = JSON.parse(lines[1])
  second.key = `kira:${'f'.repeat(64)}`
  lines[1] = JSON.stringify(second)
  writeFileSync(auraPath, `${lines.join('\n')}\n`)
  refuses('PUBLIC_EVIDENCE_AURA_CHAIN_BROKEN', () => {
    exportPublicEvidence({
      storeDir: dirty, outDir: join(work, 'broken-chain-out'), producerCommit: PRODUCER_COMMIT, releaseDir,
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(),
    })
  })
})

control('a bad producer commit is refused by name', () => {
  refuses('PUBLIC_EVIDENCE_PRODUCER_COMMIT_INVALID', () => {
    exportPublicEvidence({
      storeDir: stateDir, outDir: join(work, 'bad-commit'), producerCommit: 'HEAD', releaseDir,
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(),
    })
  })
})

control('a missing release record is refused by name', () => {
  refuses('PUBLIC_EVIDENCE_RELEASE_RECORD_MISSING', () => {
    exportPublicEvidence({
      storeDir: stateDir, outDir: join(work, 'bad-release'), producerCommit: PRODUCER_COMMIT,
      releaseDir: join(work, 'no-such-release'),
      anchors: new Map([['issuer', issuerAnchor]]), approvals: new Map(),
    })
  })
})

// ── 7. the approval lane: the digest is DERIVED, never read ───────────────────────────────────

control('an approval binding the right bytes is exported, with its approvalId derived', () => {
  const artifact = writeArtifact(join(work, 'artifact-1.json'), operationDigestOf(Buffer.from(first.body, 'utf8')))
  const { outDir, manifest } = exportInto('export-approval', {
    approvals: new Map([[first.contentSha256, artifact.path]]),
  })
  assert.ok(existsSync(join(outDir, 'evidence/approvals', `${first.contentSha256}.json`)))
  const approvals = manifest.approvals
  const carried = approvals.filter(entry => entry.artifactPath !== null && entry.artifactPath !== undefined)
  assert.equal(carried.length, 1, 'exactly one approval was supplied and exactly one is carried')
  assert.equal(carried[0].approvalId,
    sha256(`aukora:approval-receipt:v1\0${artifact.challenge}\0${artifact.signature}`),
    'the approvalId must be the signed pair, and nothing else')
  // The receipt for record 2 also names an approval and this export does not carry it. That gap is
  // NAMED rather than absent, so a consumer asking for the approval lane knows which side dropped it.
  const gap = approvals.filter(entry => entry.artifactPath === null)
  assert.equal(gap.length, 1, 'the approval this export does not carry must still be accounted for')
  assert.match(gap[0].reason, /--approval/u)
  assert.equal(verifyPublicEvidence(outDir).ok, true)
})

control('an approval binding OTHER bytes is refused by name', () => {
  const artifact = writeArtifact(join(work, 'artifact-wrong.json'), 'f'.repeat(64))
  const error = refuses('PUBLIC_EVIDENCE_APPROVAL_DIGEST_MISMATCH', () => {
    exportInto('export-approval-wrong', { approvals: new Map([[first.contentSha256, artifact.path]]) })
  })
  assert.match(error.detail, /binds the bytes it was issued for/u)
})

// ── 8. the verifier: the handoff checked against its own bytes ────────────────────────────────

control('verify accepts the good export', () => {
  const verdict = verifyPublicEvidence(good.outDir)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.producerCommit, PRODUCER_COMMIT)
  assert.equal(verdict.releaseRecordDigest, good.manifest.releaseRecord.recordDigest.value)
})

control('verify REFUSES a manifest entry that resolves outside the export', () => {
  // MEASURED DEFECT, found by reading `public-evidence.mjs` after three rounds of the same class
  // elsewhere in the tree: a manifest naming `../outside.txt`, carrying that file's CORRECT byte count
  // and digest, was accepted and `verifyPublicEvidence` returned `{ok: true, files: 1}`. `join(root,
  // entry.path)` resolved the traversal, so a verifier asked to check ONE DIRECTORY read, hashed and
  // private-material-scanned a file outside it and then called the result verified. The unlisted-file
  // check could not catch it — the escapee IS listed, by its escaping name — and `listExportFiles`
  // never consults the manifest, so nothing had constrained what the manifest may name.
  //
  // The mutation is the whole test: WITHOUT the guard this arm reads a file outside the export and
  // returns ok. It is kept here rather than in a runner because the verifier is the shipped surface.
  const outside = join(work, 'outside-the-export.txt')
  writeFileSync(outside, 'a file the export does not carry\n')
  const copy = join(work, 'escaping-manifest')
  copyTree(good.outDir, copy)
  const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'))
  const bytes = readFileSync(outside)
  // REPOINT ONE EXISTING ENTRY rather than replacing the list: replacing it leaves the genuine
  // members named by no entry, and `PUBLIC_EVIDENCE_UNLISTED_FILE` fires first — which is a correct
  // refusal about a DIFFERENT thing, so the arm would be measuring the wrong check. Repointing keeps
  // the file set exactly what the export carries and makes the escaping PATH the only defect.
  const entry = manifest.files[0]
  entry.path = '../outside-the-export.txt'
  entry.bytes = bytes.byteLength
  entry.sha256 = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(copy, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const error = refuses('PUBLIC_EVIDENCE_PATH_ESCAPES_EXPORT', () => verifyPublicEvidence(copy))
  assert.match(error.detail, /outside-the-export/u, 'the refusal must name the escaping path')
})

control('verify refuses a tampered file by name', () => {
  const copy = join(work, 'tampered')
  copyTree(good.outDir, copy)
  const target = join(copy, 'evidence/receipts', `${first.contentSha256}.json`)
  writeFileSync(target, readFileSync(target, 'utf8').replace('memory.put', 'memory.put '))
  const error = refuses('PUBLIC_EVIDENCE_FILE_TAMPERED', () => verifyPublicEvidence(copy))
  assert.match(error.detail, /receipts\//u, 'the refusal must name the file')
})

control('verify refuses an extra private field even when the manifest agrees with the bytes', () => {
  const copy = join(work, 'private-field')
  copyTree(good.outDir, copy)
  const relative = `evidence/records/${first.contentSha256}.json`
  const target = join(copy, relative)
  const document = JSON.parse(readFileSync(target, 'utf8'))
  document.privateKey = 'redacted-for-the-control'
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)
  // Rewrite the manifest entry so the DIGEST check passes: the field policy must refuse on its own.
  const manifestPath = join(copy, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = manifest.files.find(candidate => candidate.path === relative)
  const bytes = readFileSync(target)
  entry.bytes = bytes.byteLength
  entry.sha256 = sha256(bytes)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  refuses('PUBLIC_EVIDENCE_PRIVATE_FIELD', () => verifyPublicEvidence(copy))
})

control('verify refuses a private-key PEM header even when the manifest agrees with the bytes', () => {
  const copy = join(work, 'private-pem')
  copyTree(good.outDir, copy)
  const relative = `evidence/records/${first.contentSha256}.json`
  const target = join(copy, relative)
  const document = JSON.parse(readFileSync(target, 'utf8'))
  document.extra = '-----BEGIN PRIVATE KEY-----\nredacted\n-----END PRIVATE KEY-----\n'
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)
  const manifestPath = join(copy, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = manifest.files.find(candidate => candidate.path === relative)
  const bytes = readFileSync(target)
  entry.bytes = bytes.byteLength
  entry.sha256 = sha256(bytes)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  refuses('PUBLIC_EVIDENCE_PRIVATE_MATERIAL', () => verifyPublicEvidence(copy))
})

control('verify refuses a file nobody listed', () => {
  const copy = join(work, 'unlisted')
  copyTree(good.outDir, copy)
  writeFileSync(join(copy, 'evidence/carried-by-nobody.json'), '{"carried":true}\n')
  refuses('PUBLIC_EVIDENCE_UNLISTED_FILE', () => verifyPublicEvidence(copy))
})

control('verify refuses a record that no longer projects from its object', () => {
  const copy = join(work, 'projection')
  copyTree(good.outDir, copy)
  const relative = `evidence/records/${first.contentSha256}.json`
  const target = join(copy, relative)
  writeFileSync(target, `${JSON.stringify({ ...JSON.parse(readFileSync(target, 'utf8')), kind: 'claim' }, null, 2)}\n`)
  const manifestPath = join(copy, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = manifest.files.find(candidate => candidate.path === relative)
  const bytes = readFileSync(target)
  entry.bytes = bytes.byteLength
  entry.sha256 = sha256(bytes)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  refuses('PUBLIC_EVIDENCE_RECORD_PROJECTION_MISMATCH', () => verifyPublicEvidence(copy))
})

control('verify refuses a directory that is not a handoff at all', () => {
  const empty = join(work, 'empty-dir')
  mkdirSync(empty, { recursive: true })
  refuses('PUBLIC_EVIDENCE_MANIFEST_MISSING', () => verifyPublicEvidence(empty))
})

control('verify refuses a manifest of the wrong kind', () => {
  const copy = join(work, 'wrong-kind')
  copyTree(good.outDir, copy)
  const manifestPath = join(copy, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.kind = 'something-else/v1'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  refuses('PUBLIC_EVIDENCE_MANIFEST_KIND', () => verifyPublicEvidence(copy))
})

/** Copy one export tree, so a control never mutates the fixture the other controls read. */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const source = join(from, name)
    const target = join(to, name)
    if (lstatSync(source).isDirectory()) copyTree(source, target)
    else copyFileSync(source, target)
  }
}

process.stdout.write(`\n${failures === 0 ? 'ALL CONTROLS PASSED' : `${String(failures)} CONTROL(S) FAILED`}\n`)
rmSync(work, { recursive: true, force: true })
process.exitCode = failures === 0 ? 0 : 1
