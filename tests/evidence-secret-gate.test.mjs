#!/usr/bin/env node
/**
 * The secret-shape gate remember.mjs puts in front of the public memory evidence export.
 *
 *   node tests/evidence-secret-gate.test.mjs
 *
 * Scratch only (openScratch, removed on exit): two disposable Kira stores built with the plugin's own primitives,
 * exported with the SAME exporter CLI remember.mjs runs (scripts/kira/public-evidence.mjs export), then published
 * through `publishScannedExport`, exactly as remember.mjs does. No live store, support root, release or signer.
 *
 *   GREEN 1  a clean export is published, and its bytes equal an export written straight to its directory.
 *   GREEN 2  an export whose record carries a planted JWT and an sk- style key: the exporter's own checks pass it
 *            (exit 0), the gate refuses it by file and shape, nothing exists at the export path, the stage is gone.
 *   RED      the same planted export with the scan disabled is published, token and all.
 *
 * The fake tokens are assembled at run time, so this file carries no secret-shaped literal.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openScratch } from '../scripts/lib/run-root.mjs'
import { CATALOGUE_ID, publishScannedExport, scanExportForSecrets } from '../scripts/aukora/evidence-secret-gate.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { createMemoryOwner, AURA_RECORD_DOMAIN, auraEntryHash } = await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const { stageKiraMemoryRecord, memoryEffectBody } = await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)

const scratch = openScratch({ label: 'evidence-secret-gate' }).root
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
const PRODUCER_COMMIT = '9'.repeat(40)
const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAA\n-----END PUBLIC KEY-----\n'
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const FAKE_JWT = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: 'planted-canary', iat: 1790000000 }), 'c2lnbmF0dXJlLWZha2U']
  .join('.')
const FAKE_KEY = ['sk', 'PLANTEDcanary0123456789abcdefXYZ'].join('-')

/** One disposable store: real issuer.json and layout, chain/objects/receipts from the plugin's record contract. */
function buildStore(root, notes) {
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  createMemoryOwner({ stateDir })
  let prev = AURA_RECORD_DOMAIN
  for (const [index, note] of notes.entries()) {
    const staged = stageKiraMemoryRecord({ subject: SUBJECT, kind: 'observation', source: [], content: { note }, links: [], privacy: 'local', createdAt: '2026-09-27T00:00:00Z' })
    const body = memoryEffectBody(staged.memoryPut)
    const contentSha256 = sha256(body)
    writeFileSync(join(stateDir, 'objects', `${contentSha256}.json`), body, { mode: 0o600 })
    const sequence = index + 1
    const fields = { verdict: 'settled', key: staged.recordId, contentSha256, operation: 'memory.put', sequence }
    const hash = auraEntryHash(prev, fields)
    writeFileSync(join(stateDir, 'aura.jsonl'), `${JSON.stringify({ ...fields, prev, hash })}\n`, { flag: 'a', mode: 0o600 })
    writeFileSync(join(stateDir, `receipt-memory.put-${String(sequence).padStart(3, '0')}.json`), `${JSON.stringify({
      kind: 'aukora-kira-memory-receipt/v1', operation: 'memory.put', recordId: staged.recordId, effectDigest: contentSha256,
      nonce: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, issuedAt: 1790000000,
      aura: { entryHash: hash, seq: sequence, priorHead: index === 0 ? null : prev, head: hash }, sig: 'a'.repeat(128), issuerPk: PUBLIC_PEM,
    }, null, 2)}\n`, { mode: 0o600 })
    prev = hash
  }
  return stateDir
}

const release = join(scratch, 'release')
mkdirSync(join(release, '.dsh-build'), { recursive: true })
writeFileSync(join(release, '.dsh-build', 'genesis-artifacts.json'), `${JSON.stringify({ formatVersion: 1, kind: 'dsh-artifact-record', producer: { genesisCommit: PRODUCER_COMMIT }, host: { fileCount: 0, bytes: 0, sha256: '7'.repeat(64) }, entries: [] }, null, 2)}\n`)
mkdirSync(join(scratch, 'anchors'), { recursive: true })
writeFileSync(join(scratch, 'anchors', 'issuer.pem'), PUBLIC_PEM)
writeFileSync(join(scratch, 'anchors', 'approver.pem'), PUBLIC_PEM)

/** The exporter CLI, as remember.mjs runs it (minus --approval: these fixture receipts carry no approval block). */
function exportTo(store, out) {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/kira/public-evidence.mjs'), 'export', '--store', store, '--out', out,
    '--producer-commit', PRODUCER_COMMIT, '--release', release,
    '--anchor', `issuer=${join(scratch, 'anchors', 'issuer.pem')}`, '--anchor', `approver=${join(scratch, 'anchors', 'approver.pem')}`], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`exporter exit ${String(run.status)}: ${run.stderr}`)
  return run.status
}
const filesWith = (dir, needle) => scanExportForSecrets(dir).files.filter((file) => readFileSync(join(dir, file), 'utf8').includes(needle))

let failures = 0
const report = (ok, line) => { if (!ok) failures += 1; process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${line}\n`) }
process.stdout.write(`evidence secret gate — scratch ${scratch}\ncatalogue ${CATALOGUE_ID} (aumara-xyz/aukora@def297f packages/evidence)\n\n`)

// GREEN 1: clean.
const clean = buildStore(join(scratch, 'clean'), ['Cedar endpoint listens on port 8098', 'Rollback runbook lives in ops/rollback.md'])
exportTo(clean, join(scratch, 'clean', 'direct'))
exportTo(clean, join(scratch, 'clean', 'export.unscanned'))
const green1 = publishScannedExport(join(scratch, 'clean', 'export.unscanned'), join(scratch, 'clean', 'export'))
const direct = scanExportForSecrets(join(scratch, 'clean', 'direct')).files
const same = direct.filter((file) => readFileSync(join(scratch, 'clean', 'direct', file)).equals(readFileSync(join(scratch, 'clean', 'export', file))))
report(green1.published && green1.hits.length === 0 && same.length === direct.length && green1.files.join() === direct.join(),
  `GREEN clean export: published=${String(green1.published)}, ${String(green1.files.length)} files scanned, ${String(green1.hits.length)} secret shapes, `
  + `${String(same.length)}/${String(direct.length)} files byte-identical to a direct export`)

// GREEN 2: planted.
const planted = buildStore(join(scratch, 'planted'), ['Cedar endpoint listens on port 8098', `session ${FAKE_JWT} and key ${FAKE_KEY}`])
const exporterStatus = exportTo(planted, join(scratch, 'planted', 'export.unscanned'))
const green2 = publishScannedExport(join(scratch, 'planted', 'export.unscanned'), join(scratch, 'planted', 'export'))
report(!green2.published && green2.hits.length > 0 && !existsSync(join(scratch, 'planted', 'export')) && !existsSync(join(scratch, 'planted', 'export.unscanned')),
  `GREEN planted export: exporter exit ${String(exporterStatus)} (its own checks let it through); gate published=${String(green2.published)}, REFUSED `
  + `${green2.hits.map((hit) => `${hit.path} (${hit.shapes.join(', ')})`).join('; ')}; export path exists=${String(existsSync(join(scratch, 'planted', 'export')))}, `
  + `staged copy exists=${String(existsSync(join(scratch, 'planted', 'export.unscanned')))}`)

// RED: the scan disabled.
exportTo(planted, join(scratch, 'red', 'export.unscanned'))
const red = publishScannedExport(join(scratch, 'red', 'export.unscanned'), join(scratch, 'red', 'export'), () => ({ files: [], hits: [] }))
const leakedJwt = red.published ? filesWith(join(scratch, 'red', 'export'), FAKE_JWT) : []
const leakedKey = red.published ? filesWith(join(scratch, 'red', 'export'), FAKE_KEY) : []
report(red.published && leakedJwt.length > 0 && leakedKey.length > 0,
  `RED   scan disabled: published=${String(red.published)}; planted JWT published in [${leakedJwt.join(', ')}], sk- key in [${leakedKey.join(', ')}]`)

process.stdout.write(`\n${failures === 0 ? 'EVIDENCE SECRET GATE: clean passes, planted refused, and the red arm leaks without the scan' : `EVIDENCE SECRET GATE: ${String(failures)} FAILED`}\n`)
process.exitCode = failures === 0 ? 0 : 1
