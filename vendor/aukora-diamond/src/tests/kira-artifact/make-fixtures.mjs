#!/usr/bin/env node
/**
 * Mint the CURRENT-PRODUCER approval fixtures for the Diamond consumer, ONCE, by hand.
 *
 *   node tests/kira-artifact/make-fixtures.mjs --genesis /path/to/genesis-checkout --out tests/kira-artifact/fixtures
 *
 * WHY THIS IS NOT RUN BY CI, AND WHY THAT IS THE HONEST ARRANGEMENT. The fixtures are EVIDENCE about
 * a producer that lives in another repository, and they are committed as bytes. CI has no Genesis
 * checkout and no network, so it cannot re-mint them; what CI can do — and what the suite beside this
 * file does — is verify the committed bytes offline. Re-minting on the runner would prove that two
 * machines agree on today's producer, not that the committed artifact was produced by the pinned one.
 *
 * WHAT PRODUCES THE BYTES: NOTHING IN THIS FILE. Every artifact below is written by the SHIPPED
 * producer command, `scripts/aumlok/approve-operation`, driven by the SHIPPED signer daemon
 * (`scripts/aumlok/signer.mjs`, mode `test-all`), against a disposable identity built by
 * `scripts/aumlok/make-disposable-identity.mjs`. Every receipt, Aura entry and stored object is
 * written by Kira's own `createMemoryOwner` through the same `settleTool` the composition wires. This
 * script chooses inputs and copies outputs; it signs nothing, digests nothing that the producer is
 * then asked to confirm, and hand-writes no field of any document it exports.
 *
 * THE DIGEST IT DOES COMPUTE IS DELIBERATELY A RESTATEMENT. `thirdPartyDigest` below types the domain
 * string, one 0x00 byte and a `node:crypto` hash by hand — it does not import either lane's rule — and
 * the value it produces is what `--operation-digest` hands to the producer, which recomputes and
 * refuses a mismatch. So the committed artifact's `operationDigest` is a digest a stranger derived
 * and the producer confirmed, not a digest copied out of the producer's own helper.
 *
 * FIXED CLOCK, LABELLED. `--now` is injected (the command prints `CLOCK_INJECTED` and calls it
 * TEST-ONLY) so `issuedAt`/`verifiedAt` are stable across re-mints. The challenge and the signature
 * are NOT stable — the challenge is the producer's random 32-byte nonce — so the committed bytes are
 * the fixture and a re-mint produces a DIFFERENT but equally valid artifact. `PROVENANCE.json` records
 * that, so nobody mistakes a re-mint for reproduction.
 *
 * WHAT THIS IS NOT. Not a person's approval: the signer runs its labelled `test-all` procedure, which
 * approves every request it is shown, and the artifact says `approvalClass=scripted`,
 * `attendance=reported-not-proven`, `identityBound=false`. No person attended anything, the keys are
 * disposable and TEST-ONLY, and the live store is never read, written or started.
 */
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIAMOND = resolve(HERE, '..', '..')

function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const GENESIS = option('--genesis')
const OUT = option('--out')
/** The class label the export manifest carries. A LABEL, and the tooling says so beside it. */
const EXPORT_CLASS = option('--class') ?? 'committed-fixture'
/** Where the PUBLIC ANCHORS are written. Outside the export directory for a genuine external run:
 * an export that hands over the keys it is checked against is a claim, not evidence. */
const ANCHOR_DIR = option('--anchor-dir')
/** `--manifest-only` writes `export.json` (and `record.json`) for a directory that already holds
 * producer bytes, and runs NOTHING: the bytes are not re-minted, re-signed or reformatted. */
const MANIFEST_ONLY = process.argv.includes('--manifest-only')
if (OUT === undefined || (!MANIFEST_ONLY && GENESIS === undefined)) {
  process.stderr.write('usage: make-fixtures.mjs --genesis <genesis-checkout> --out <fixture-dir> '
    + '[--class committed-fixture|materialized-candidate] [--anchor-dir <dir>]\n'
    + '       make-fixtures.mjs --manifest-only --out <export-dir> [--class ...]\n')
  process.exit(2)
}
// A Genesis checkout is required to MINT, and not to write a manifest for bytes that already exist:
// `--manifest-only` runs none of the producer's code and imports none of it.
const ROOT = MANIFEST_ONLY ? null : resolve(GENESIS)
if (ROOT !== null && !existsSync(join(ROOT, 'scripts', 'aumlok', 'approve-operation'))) {
  process.stderr.write(`REFUSING: ${ROOT} does not look like a Genesis checkout (no scripts/aumlok/approve-operation)\n`)
  process.exit(2)
}
const OUTDIR = resolve(OUT)
const ANCHORSDIR = ANCHOR_DIR === undefined ? OUTDIR : resolve(ANCHOR_DIR)

/** The export manifest: what the bytes are, where they came from, and which class they are. */
function writeExportManifest({ subject, approverDid, records, genesisCommit, genesisDescribe,
                              release, releaseRecordDigest, signerCommand, mintedAt, seed }) {
  const first = records[0]
  const manifest = {
    exportDomain: 'aukora-approval-transaction-export/v1',
    class: EXPORT_CLASS,
    classMeaning: EXPORT_CLASS === 'committed-fixture'
      ? 'bytes committed beside the acceptance suite, minted by the pinned producer command'
      : EXPORT_CLASS === 'materialized-candidate'
        ? 'bytes produced by code from a materialized candidate, on disposable state, by the '
          + "producer's own shipped commands. NOT produced by any running service"
        : "claimed as produced by a running service; the claim is the export's own and "
          + 'is not established by reading the files',
    genesis: {
      commit: genesisCommit,
      describe: genesisDescribe,
      release: release ?? null,
      releaseRecordDigest: releaseRecordDigest ?? null,
    },
    producedAt: mintedAt,
    seed,
    signer: signerCommand,
    subject,
    files: {
      record: 'record.json',
      content: first.contentFile,
      receipt: first.receiptFile,
      log: 'aura.jsonl',
      artifact: first.artifactFile,
      // A SECOND, genuine approval over the SAME content — same record, same bytes, same digest,
      // different challenge and signature. It is what isolates the receipt-linkage check: nothing
      // else can tell two approvals over one operation apart.
      artifactAlt: 'artifact-1b.json',
      // The stored object IS the content: same bytes, named by their own digest, because a consumer
      // that only compared parsed values would accept a re-serialized object nobody wrote.
      object: `objects/${first.contentSha256}.json`,
    },
    transaction: {
      recordId: first.recordId,
      operationDigest: first.operationDigest,
      approvalId: first.approvalId,
      receiptSequence: first.auraSequence,
      entriesAfterReceipt: records.length - first.auraSequence,
    },
    claims: {
      attendance: 'reported-not-proven',
      liveProduced: false,
      note: 'a candidate-release run is not proof that a running service produced these bytes',
    },
  }
  writeFileSync(join(OUTDIR, 'export.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** The record of the FIRST write as its own file, derived from the content bytes already present. */
function writeRecordFile(contentFile, recordFile) {
  const carried = JSON.parse(readFileSync(join(OUTDIR, contentFile), 'utf8'))
  writeFileSync(join(OUTDIR, recordFile), `${JSON.stringify(carried.value, null, 2)}\n`)
}

const ADAPTER_DIR = ROOT === null ? null : join(ROOT, 'plugins', 'aukora-aumlok', 'lib')
const BUILDER = ROOT === null ? null : join(ROOT, 'scripts', 'aumlok', 'make-disposable-identity.mjs')
const SIGNER = ROOT === null ? null : join(ROOT, 'scripts', 'aumlok', 'signer.mjs')
const APPROVE = ROOT === null ? null : join(ROOT, 'scripts', 'aumlok', 'approve-operation')

// Every import of the producer is behind the mint path, so `--manifest-only` cannot reach Genesis
// code even by accident.
const adapter = ROOT === null ? null : await import(pathToFileURL(join(ADAPTER_DIR, 'index.mjs')).href)
const { settleTool } = ROOT === null ? {} : await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/tools.mjs')).href)
const { createMemoryOwner } = ROOT === null
  ? {} : await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const { memoryEffectBody, stageKiraMemoryRecord } = ROOT === null
  ? {} : await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/record.mjs')).href)

// ── the pinned inputs, all of them TEST-ONLY and named ──────────────────────────────────────────
/** TEST-ONLY seed: the disposable identity's Ed25519 half. Not anyone's key. */
const SEED = 'a7'.repeat(32)
/** TEST-ONLY clock, injected into the producer so issuedAt/verifiedAt do not move between mints. */
const NOW = 1790000000
/** A window that has not closed: 2100-01-01T00:00:00Z. The consumer checks expiry against `--now`. */
const EXPIRES_AT = 4102444800
const AT = '2026-09-08T00:00:00Z'
const NOTE_ONE = 'Cedar endpoint listens on port 8098'
const NOTE_TWO = 'Rollback runbook lives in ops/rollback.md'

/** The operation-digest rule, RESTATED by hand: nothing here imports the rule it checks. */
const OPERATION_CONTENT_DOMAIN_LITERAL = 'aukora:operation-content:v1'
function thirdPartyDigest(content) {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(OPERATION_CONTENT_DOMAIN_LITERAL, 'utf8'), Buffer.from([0x00]), bytes]))
    .digest('hex')
}
const sha256Of = value => createHash('sha256').update(value).digest('hex')

// A SHORT root, deliberately: a Unix socket path is capped at ~104 bytes on macOS, and the signer's
// socket lives under this directory. `tmpdir()` there is `/var/folders/…`, which pushed the socket
// past the cap and made the signer exit 2 with `EINVAL` — measured, and the reason this line is not
// simply `join(tmpdir(), …)`.
const SHORT_TMP = existsSync('/tmp') ? '/tmp' : tmpdir()
const work = mkdtempSync(join(SHORT_TMP, 'kafx-'))
const running = []
const runs = []

/** Run one shipped command and keep its output for PROVENANCE. Nothing is simulated in-process. */
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  const entry = { command: `${script.replace(`${ROOT}/`, '')} ${args.join(' ')}`, status: result.status }
  runs.push(entry)
  if (result.status !== 0) {
    throw new Error(`${entry.command}\n  exited ${String(result.status)}\n${result.stderr ?? ''}${result.stdout ?? ''}`)
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Build one disposable controller the way the approving lane's own court does. */
function buildIdentity(name) {
  const directory = join(work, name)
  run(BUILDER, ['--directory', directory, '--ed25519-seed-hex', SEED])
  const record = JSON.parse(readFileSync(join(directory, adapter.LOCAL_AUMLOK_CONTROL_FILENAME), 'utf8'))
  const keyPath = join(directory, 'test-key.pem')
  writeFileSync(keyPath, record.ed25519PrivateKeyPem, { mode: 0o600 })
  const { projection } = adapter.loadLocalAumlokPublicControl(directory)
  return { directory, keyPath, projection, registeredEd25519: record.activeControl.publicKeys.ed25519 }
}

/** Start the signer daemon and wait for READY. */
const signerCommands = []
function startSigner(name, identity, mode) {
  const signerDir = join(work, `signer-${name}`)
  mkdirSync(signerDir, { recursive: true, mode: 0o700 })
  const socketPath = join(signerDir, 'signer.sock')
  const args = [
    SIGNER, '--socket', socketPath, '--key-file', identity.keyPath,
    '--registered-key-hex', identity.registeredEd25519, '--approve', mode,
  ]
  signerCommands.push(`scripts/aumlok/signer.mjs ${args.slice(1).join(' ')}`)
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  running.push(child)
  let out = ''
  let err = ''
  child.stdout.on('data', chunk => { out += chunk.toString('utf8') })
  child.stderr.on('data', chunk => { err += chunk.toString('utf8') })
  return new Promise((ready, reject) => {
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      if (out.includes('SIGNER_READY')) { clearInterval(poll); ready({ socketPath }) }
      else if (child.exitCode !== null) { clearInterval(poll); reject(new Error(`signer exited ${String(child.exitCode)}: ${err}`)) }
      else if (Date.now() > deadline) { clearInterval(poll); reject(new Error('signer never ready')) }
    }, 25)
  })
}

const candidate = (subject, note) => ({
  subject, kind: 'observation', source: [], content: { note }, links: [], privacy: 'local', createdAt: AT,
})

try {
  mkdirSync(OUTDIR, { recursive: true })

  if (MANIFEST_ONLY) {
    // NOTHING IS MINTED HERE. `export.json` and `record.json` are written for bytes that already
    // exist, so a directory whose fixtures were independently verified keeps EXACTLY those bytes.
    const provenance = JSON.parse(readFileSync(join(OUTDIR, 'PROVENANCE.json'), 'utf8'))
    const first = provenance.records[0]
    writeRecordFile(first.contentFile, 'record.json')
    const manifest = writeExportManifest({
      subject: provenance.subject,
      approverDid: provenance.approverDid,
      records: provenance.records,
      genesisCommit: provenance.genesisCommit,
      genesisDescribe: provenance.genesisDescribe,
      release: option('--release'),
      releaseRecordDigest: option('--record-digest'),
      signerCommand: option('--signer') ?? provenance.signerCommand,
      mintedAt: provenance.mintedAt,
      seed: provenance.seed,
    })
    process.stdout.write(`manifest written to ${join(OUTDIR, 'export.json')}\n`)
    process.stdout.write(`class            : ${manifest.class}\n`)
    process.stdout.write(`record file      : record.json (derived from ${first.contentFile})\n`)
    process.stdout.write(`bytes re-minted  : NO — the existing files are untouched\n`)
    process.exit(0)
  }

  const identity = buildIdentity('identity-a')
  const subject = identity.projection.subject
  if (!/^aukora:1:[0-9a-f]{64}$/u.test(subject)) throw new Error(`controller derived a subject outside the grammar: ${subject}`)
  const approverDid = adapter.didKeyFromEd25519PublicKey(identity.registeredEd25519)
  const signer = await startSigner('approves', identity, 'test-all')

  const stateDir = join(work, 'kira-state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  chmodSync(stateDir, 0o700)
  const grantFile = join(stateDir, 'grant.json')
  const approvalFile = join(stateDir, 'approval.json')
  const owner = createMemoryOwner({ stateDir })
  const tool = settleTool(
    owner,
    () => owner.readAuthorization(grantFile),
    () => owner.readApproval(approvalFile),
    subject,
    approverDid,
  )

  const minted = []
  // ── one operator turn per record: write content, run the SHIPPED producer, then settle ─────────
  for (const [index, note] of [[1, NOTE_ONE], [2, NOTE_TWO]]) {
    const staged = stageKiraMemoryRecord(candidate(subject, note))
    const content = memoryEffectBody(staged.memoryPut)
    const contentPath = join(work, `content-${String(index)}.txt`)
    writeFileSync(contentPath, content)
    const digest = thirdPartyDigest(content)
    const artifactOut = join(work, `artifact-${String(index)}.json`)
    run(APPROVE, [
      '--controller', identity.directory,
      '--expect-subject', subject,
      '--expect-control-digest', identity.projection.activeControlDigest,
      '--operation', contentPath,
      '--operation-digest', digest,
      '--signer-socket', signer.socketPath,
      '--artifact-out', artifactOut,
      '--expires-at', String(EXPIRES_AT),
      '--approval-class', 'scripted',
      '--now', String(NOW),
    ])
    const artifact = JSON.parse(readFileSync(artifactOut, 'utf8'))
    // The grant is the SECOND operator document; it is written by the owner's own key, as shipped.
    writeFileSync(grantFile, `${JSON.stringify({
      grant: owner.grantFor(staged.memoryPut), record: staged.record, subject,
    }, null, 2)}\n`)
    cpSync(artifactOut, approvalFile)
    const settlement = await tool.execute({ confirm: true }, {})
    if (settlement?.receipt === undefined) throw new Error(`settlement ${String(index)} produced no receipt`)
    minted.push({
      index, note, content, contentPath, digest, artifactOut, artifact, receipt: settlement.receipt,
      sequence: settlement.sequence, contentSha256: settlement.contentSha256, record: staged.record,
      recordId: staged.recordId,
    })
    rmSync(approvalFile, { force: true })
  }

  // ── a SECOND approval over content ONE, which nothing settles ────────────────────────────────
  // Two approvals over the same bytes are two different approvals: same operation digest, different
  // challenge and signature. The consumer's receipt-linkage check is the ONLY thing that can tell
  // them apart, so this document is what isolates that check from every other one. It also shows the
  // honest limit of a digest binding: a digest does not identify an approval.
  const secondArtifactOut = join(work, 'artifact-1b.json')
  run(APPROVE, [
    '--controller', identity.directory,
    '--expect-subject', subject,
    '--expect-control-digest', identity.projection.activeControlDigest,
    '--operation', minted[0].contentPath,
    '--operation-digest', minted[0].digest,
    '--signer-socket', signer.socketPath,
    '--artifact-out', secondArtifactOut,
    '--expires-at', String(EXPIRES_AT),
    '--approval-class', 'scripted',
    '--now', String(NOW + 60),
  ])
  cpSync(secondArtifactOut, join(OUTDIR, 'artifact-1b.json'))

  // ── export: the bytes as they were produced, copied rather than re-serialized ─────────────────
  for (const item of minted) {
    cpSync(item.artifactOut, join(OUTDIR, `artifact-${String(item.index)}.json`))
    cpSync(item.contentPath, join(OUTDIR, `content-${String(item.index)}.txt`))
    cpSync(join(stateDir, `receipt-memory.put-${String(item.sequence).padStart(3, '0')}.json`),
      join(OUTDIR, `receipt-${String(item.index)}.json`))
  }
  writeRecordFile(minted[0].index === 1 ? 'content-1.txt' : `content-${String(minted[0].index)}.txt`,
                  'record.json')
  cpSync(join(stateDir, 'aura.jsonl'), join(OUTDIR, 'aura.jsonl'))
  cpSync(join(stateDir, 'objects'), join(OUTDIR, 'objects'), { recursive: true })
  // The Kira owner's public key, HANDED OVER SEPARATELY. It is the same string the receipt carries in
  // `issuerPk`, written out as its own file precisely so a consumer can be given an ANCHOR rather than
  // being trusted to read one out of the document it is checking.
  mkdirSync(ANCHORSDIR, { recursive: true })
  writeFileSync(join(ANCHORSDIR, 'issuer.pem'), minted[0].receipt.issuerPk, { mode: 0o644 })

  // The anchor travels SEPARATELY from the artifact, as a public key only: raw hex, PEM, and the
  // did:key. No private key is exported — the identity directory stays in the temporary tree and is
  // deleted below. The PEM is the SAME 32 raw bytes in the SPKI envelope the consumer already reads.
  writeFileSync(join(ANCHORSDIR, 'approver.pk'), `${identity.registeredEd25519}\n`, { mode: 0o644 })
  writeFileSync(join(ANCHORSDIR, 'approver-did.txt'), `${approverDid}\n`, { mode: 0o644 })
  const { createPublicKey } = await import('node:crypto')
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(identity.registeredEd25519, 'hex'),
  ])
  writeFileSync(join(ANCHORSDIR, 'approver.pem'),
    createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }).toString())

  const provenance = {
    what: 'CURRENT-PRODUCER approval fixtures: the flat aukora:approval-receipt:v1 artifact, the exact '
      + 'content bytes it binds, the approver public key, and the Kira receipts whose approval block '
      + 'names it. Produced by the PINNED Genesis producer at the commit below, not by hand and not by '
      + 'the Diamond consumer.',
    genesisCheckout: ROOT,
    genesisCommit: spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    genesisDescribe: spawnSync('git', ['-C', ROOT, 'describe', '--always', '--dirty'], { encoding: 'utf8' }).stdout.trim(),
    mintedAt: new Date().toISOString(),
    clockInjected: NOW,
    clockNote: 'approve-operation --now <TEST-ONLY> so issuedAt/verifiedAt are stable; the challenge and '
      + 'signature are NOT stable, so a re-mint produces an equally valid but different artifact.',
    expiresAt: EXPIRES_AT,
    seed: `${SEED} (TEST-ONLY, disposable; the private half is deleted with the temporary tree)`,
    signer: 'scripts/aumlok/signer.mjs --approve test-all — a LABELLED procedure that approves every '
      + 'request it is shown. Scripted, not a person; nothing here is a human yes and no person attended.',
    subject,
    activeControlDigest: identity.projection.activeControlDigest,
    approverDid,
    approverRawPublicKeyHex: identity.registeredEd25519,
    operationContentDomain: OPERATION_CONTENT_DOMAIN_LITERAL,
    digestRule: 'sha256(utf8("aukora:operation-content:v1") || 0x00 || contentBytes), where '
      + 'contentBytes = canonicalJSON({key: recordId, value: record}) || "\\n"',
    digestDerivedBy: 'make-fixtures.mjs thirdPartyDigest (a literal restatement), confirmed by '
      + 'approve-operation, which recomputes and refuses a mismatch',
    records: minted.map(item => ({
      index: item.index,
      note: item.note,
      recordId: item.recordId,
      contentFile: `content-${String(item.index)}.txt`,
      contentSha256: sha256Of(item.content),
      contentBytes: Buffer.byteLength(item.content, 'utf8'),
      operationDigest: item.digest,
      artifactFile: `artifact-${String(item.index)}.json`,
      artifactSha256: sha256Of(readFileSync(join(OUTDIR, `artifact-${String(item.index)}.json`))),
      approvalId: createHash('sha256').update(
        `aukora:approval-receipt:v1\0${item.artifact.challenge}\0${item.artifact.signature}`, 'utf8').digest('hex'),
      signedBytesDigest: item.artifact.signedBytesDigest,
      receiptFile: `receipt-${String(item.index)}.json`,
      receiptSha256: sha256Of(readFileSync(join(OUTDIR, `receipt-${String(item.index)}.json`))),
      auraSequence: item.sequence,
    })),
    files: readdirSync(OUTDIR).sort().map(name => {
      const path = join(OUTDIR, name)
      return statSync(path).isDirectory() ? `${name}/` : `${name}:${sha256Of(readFileSync(path))}`
    }),
    commands: runs,
    signerCommand: signerCommands.join('\n'),
    secondApprovalOverContentOne: {
      artifactFile: 'artifact-1b.json',
      what: 'a SECOND genuine approval over content-1: the same operation digest, a different challenge '
        + 'and signature. Nothing settles against it. It exists so a court can isolate the receipt '
        + 'linkage check: a digest does not identify an approval.',
      artifactSha256: sha256Of(readFileSync(join(OUTDIR, 'artifact-1b.json'))),
    },
  }
  writeFileSync(join(OUTDIR, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
  const manifest = writeExportManifest({
    subject, approverDid, records: provenance.records,
    genesisCommit: provenance.genesisCommit, genesisDescribe: provenance.genesisDescribe,
    release: option('--release'), releaseRecordDigest: option('--record-digest'),
    signerCommand: signerCommands.join('\n'), mintedAt: provenance.mintedAt, seed: SEED,
  })

  process.stdout.write(`fixtures written to ${OUTDIR}\n`)
  process.stdout.write(`subject          : ${subject}\n`)
  process.stdout.write(`approver did     : ${approverDid}\n`)
  for (const item of minted) {
    process.stdout.write(`record ${String(item.index)}       : seq=${String(item.sequence)} digest=${item.digest}\n`)
  }
  process.stdout.write(`export class     : ${manifest.class}\n`)
  process.stdout.write(`anchors written  : ${ANCHORSDIR === OUTDIR ? 'inside the export directory' : ANCHORSDIR}\n`)
  process.stdout.write(`files            : ${readdirSync(OUTDIR).sort().join(', ')}\n`)
} finally {
  for (const child of running) child.kill('SIGTERM')
  rmSync(work, { recursive: true, force: true })
}
