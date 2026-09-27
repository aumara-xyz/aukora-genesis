#!/usr/bin/env node
/**
 * ONE LIVE TRANSACTION, ONE COMMAND: Aura, Kira and Aumlok together, on the installed app.
 *
 *   node scripts/aukora/remember.mjs "the exact text to remember"
 *
 *   1. stage   — Kira stages the text through the pinned WASM proposal cell (AUKORA-37's cell) into the
 *                live pending queue. Nothing is memory yet.
 *   2. approve — the app's Aumlok signer shows the exact bytes; a PERSON clicks Approve or Refuse.
 *   3. settle  — Kira writes the record once, Aura chains it, and a receipt is issued.
 *   4. export  — public-only evidence, with the signed approval artifact carried (it is kept, not deleted). It is
 *                written to a private staging directory, every file is scanned with the AUKORA secret-shape
 *                catalogue (vendor/aukora-evidence), and only a clean export is published; a match publishes nothing.
 *   5. verify  — the vendored Diamond cold verifier checks it from an EMPTY directory with anchors passed in.
 *
 * Refuse in the popup and nothing is written. Evidence lands in ~/aukora-live-proof/<time>-<record>/.
 * Everything here reads the live composition's own settings (kira-deployment-overlay.patch.yml, config.json).
 */
import { spawnSync } from 'node:child_process'
import { createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOGUE_ID, publishScannedExport } from './evidence-secret-gate.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SUPPORT = process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
const STATE = join(SUPPORT, 'state')
// kira-approve-queue uses this checkout's approval client, which speaks the installed shell's signer protocol.
const fail = (message) => { process.stderr.write(`REMEMBER REFUSED: ${message}\n`); process.exit(1) }
const text = process.argv.slice(2).join(' ').trim()
if (text === '') fail('usage: node scripts/aukora/remember.mjs "the exact text to remember"')

const overlay = readFileSync(join(SUPPORT, 'kira-deployment-overlay.patch.yml'), 'utf8')
const setting = (name) => overlay.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? fail(`the live Kira overlay names no ${name}`)
const store = setting('stateDir')
const subject = setting('subject')
const queueDir = setting('queueDir')
const approverDid = setting('approverDid')
const release = JSON.parse(readFileSync(join(SUPPORT, 'config.json'), 'utf8')).release ?? fail('config.json names no release')
const producerCommit = JSON.parse(readFileSync(join(release, '.dsh-build', 'aukora-release.json'), 'utf8')).tipSha

/** Run one leg with its output shown, and return what it printed. */
function leg(title, command, args, options = {}) {
  process.stdout.write(`\n── ${title} ──\n`)
  const run = spawnSync(command, args, { encoding: 'utf8', cwd: options.cwd ?? REPO, maxBuffer: 64 * 1024 * 1024 })
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  process.stdout.write(out)
  return { status: run.status, out }
}
const field = (out, name) => out.match(new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)`, 'm'))?.[1] ?? null

/** An Ed25519 did:key, as the SPKI PEM a stranger verifies against. */
function didKeyToPem(did) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const c of did.replace(/^did:key:z/, '')) n = n * 58n + BigInt(ALPHABET.indexOf(c))
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const bytes = Buffer.from(hex, 'hex')
  if (bytes[0] !== 0xed || bytes[1] !== 0x01) fail(`${did} is not an Ed25519 did:key`)
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes.subarray(2)])
  return createPublicKey({ key: der, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' })
}

// 1. STAGE
const staged = leg('1. stage (Kira, through the WASM proposal cell)', process.execPath, [
  join(REPO, 'plugins/aukora-kira/bin/kira-stage.mjs'),
  '--state', store, '--subject', subject, '--queue-dir', queueDir, '--note', text,
])
const recordId = staged.out.match(/STAGED (kira:[0-9a-f]{64})/)?.[1] ?? fail('staging did not name a record')

const evidence = join(homedir(), 'aukora-live-proof', `${new Date().toISOString().slice(0, 16).replace(/:/g, '')}-${recordId.slice(5, 13)}`)
const work = join(evidence, 'work')
mkdirSync(work, { recursive: true })

// 2 + 3. APPROVE IN THE APP, THEN SETTLE
process.stdout.write('\n>>> LOOK AT THE AUKORA APP: an approval shows the exact text. Approve writes it; Refuse writes nothing. <<<\n')
const settled = leg('2-3. approve in the app (Aumlok) and settle (Kira + Aura)', process.execPath, [
  join(REPO, 'plugins/aukora-kira/bin/kira-approve-queue.mjs'),
  '--state', store, '--record', recordId, '--queue-dir', queueDir,
  '--controller', join(STATE, 'aumlok'), '--signer-socket', join(STATE, 'aumlok-signer.sock'),
  '--expires-in', '300', '--work', work, '--approver-did', approverDid,
])
if (settled.status !== 0) fail(`not settled (exit ${String(settled.status)}); nothing further was done. Evidence dir: ${evidence}`)
const contentSha256 = field(settled.out, 'contentSha256') ?? fail('the settle printed no contentSha256')
const sequence = field(settled.out, 'sequence')
const head = field(settled.out, 'head')

// 4. EXPORT, WITH THE SIGNED APPROVAL CARRIED
const anchors = join(evidence, 'anchors')
mkdirSync(anchors, { recursive: true })
writeFileSync(join(anchors, 'issuer.pem'), `${JSON.parse(readFileSync(join(store, 'issuer.json'), 'utf8')).publicKey.trim()}\n`)
writeFileSync(join(anchors, 'approver.pem'), didKeyToPem(approverDid))
const artifact = join(work, 'artifact.json')
if (!existsSync(artifact)) fail(`the record is settled, but the signed approval was not kept, so this memory cannot be proven. Evidence: ${evidence}`)
const exportDir = join(evidence, 'export')
// The exporter writes a PRIVATE staging copy; only the secret-shape gate below publishes it to exportDir.
const stagingDir = join(evidence, 'export.unscanned')
const exported = leg('4. export (public evidence, with the signed approval)', process.execPath, [
  join(release, 'scripts/kira/public-evidence.mjs'), 'export', '--store', store, '--out', stagingDir,
  '--producer-commit', producerCommit, '--release', release,
  '--anchor', `issuer=${join(anchors, 'issuer.pem')}`, '--anchor', `approver=${join(anchors, 'approver.pem')}`,
  '--approval', `${contentSha256}=${artifact}`,
])
if (exported.status !== 0) fail('the record is settled, but its export with the approval refused, so it cannot be proven yet')
process.stdout.write(`\n── 4b. secret-shape scan (AUKORA evidence catalogue ${CATALOGUE_ID.slice(0, 12)}), before anything is published ──\n`)
let gate
try { gate = publishScannedExport(stagingDir, exportDir) } catch (error) { fail(`the record is settled, but the secret-shape gate refused the export, so nothing was published: ${error.message}`) }
process.stdout.write(`  files scanned : ${String(gate.files.length)}\n  secret shapes : ${gate.hits.length === 0 ? 'none' : String(gate.hits.length)}\n`)
if (!gate.published) {
  fail('the record is settled, but its export carries secret-shaped content, so NOTHING WAS PUBLISHED: '
    + `${gate.hits.map((hit) => `${hit.path} (${hit.shapes.join(', ')})`).join('; ')}`
    + `${gate.withdrawn ? '. The staged copy was removed.' : `. The staged copy at ${stagingDir} could not be fully removed.`}`)
}

// 5. COLD VERIFY FROM AN EMPTY DIRECTORY
const empty = mkdtempSync(join(tmpdir(), 'aukora-stranger-'))
const verified = leg('5. cold verify (vendored Diamond consumer, empty directory, anchors out of band)', 'python3', [
  join(REPO, 'scripts/kira/verify-public-evidence.py'), '--export', exportDir,
  '--package-root', join(REPO, 'vendor/kira-export'),
  '--issuer-anchor', join(anchors, 'issuer.pem'), '--approver-anchor', join(anchors, 'approver.pem'),
  '--record', contentSha256,
], { cwd: empty })
try { rmdirSync(empty) } catch { /* only ever removes an empty directory */ }
writeFileSync(join(evidence, 'cold-verify.txt'), verified.out)

const publication = verified.out.match(/^PUBLICATION: (\S+)/m)?.[1] ?? 'UNKNOWN'
const approvalFacet = verified.out.match(/^\s*approval\s*:\s*(\S+)/m)?.[1] ?? 'UNKNOWN'
const summary = [
  '',
  '════════ LIVE TRANSACTION ════════',
  `  record        ${recordId}`,
  `  settled       Aura sequence ${String(sequence)}, head ${String(head)}`,
  `  content       ${contentSha256}`,
  `  approval      signed in the AUKORA popup by ${approverDid}; the stranger check says ${approvalFacet}`,
  '                (a software key on this Mac; the click is recorded, attendance is reported, not proven)',
  `  secret scan   ${String(gate.files.length)} exported files, no secret shape (catalogue ${CATALOGUE_ID.slice(0, 12)})`,
  `  cold verify   PUBLICATION: ${publication} (exit ${String(verified.status)})`,
  `  evidence      ${evidence}`,
  '  next          ask Auma in the app to recall it; she cites the Aura sequence above.',
  '',
].join('\n')
writeFileSync(join(evidence, 'summary.txt'), `${summary}\n`)
process.stdout.write(`${summary}\n`)
process.exit(publication === 'VERIFIED' && approvalFacet === 'APPROVAL_ARTIFACT_VERIFIED' ? 0 : 1)
