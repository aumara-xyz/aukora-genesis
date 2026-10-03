#!/usr/bin/env node
/**
 * THE AUKORA PLUGIN SET: record it, show it, have the owner approve it in ONE Aumlok popup, install it.
 *
 *   node scripts/aukora/plugin-set.mjs record  --release <dir>
 *   node scripts/aukora/plugin-set.mjs prepare --release <dir> --out <dir> [--support <dir>] [--commit <full sha> --shell <app>]
 *   node scripts/aukora/plugin-set.mjs approve --release <dir> [--support <dir>] [--approval-class <class>]
 *   node scripts/aukora/plugin-set.mjs check   --release <dir> [--state-root <dir>]
 *
 *   record   writes <release>/.dsh-build/plugin-set.json: one record per AUKORA plugin any patch at the
 *            release root mounts (`name: ./plugins/…`), except demo-governed. The materializer runs this
 *            after the release record.
 *   prepare  renders the exact operation content the owner will approve, writes it to <out>/operation.txt,
 *            and prints it and its digest. It raises nothing.
 *            With both --commit and --shell, previews a release binding in memory; the release stays read-only.
 *   approve  prepare, then `scripts/aumlok/approve-operation` against the app's signer socket, which raises
 *            ONE popup showing that content. Approve signs; Refuse signs nothing. A returned receipt is
 *            checked by `scripts/aumlok/verify-approval` and by the gate's own verifier, then installed in
 *            <support>/state/gate-state/ with the pinned approver (the live Kira overlay's approverDid,
 *            subject and activeControlDigest, the same pin self-change uses).
 *   check    verifies the installed approval against the release's record, as the gate will at boot.
 *   bind     (become) writes the release binding into the record: --commit <sha> --shell <AUKORA.app>.
 *            check --shell <app> then also recomputes the release tree and the shell on disk and refuses a mismatch.
 *
 * WHAT THIS IS NOT, said where it is done: the approving key is a software key on this Mac (key class B),
 * attendance is reported, not proven, and the record, the approval and the pin all live in files this uid
 * can write. The gate refuses changed plugin bytes at import; it does not stop this uid rewriting all three.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_SET_FILE, mountedPluginRows, operationDigestOf, recordPluginSet, setOperationContent, verifySetApproval,
} from '../../plugins/aukora-composition-gate/src/plugin-set.mjs'
import { operationDigestOf as aumlokOperationDigestOf } from '../../plugins/aukora-aumlok/lib/operation-approval.mjs'
import { ed25519PublicKeyFromDidKey } from '../../plugins/aukora-aumlok/lib/did-key.mjs'
import { deriveApprovalWitness } from '../../apps/aukora-desktop/aumlok-signer.mjs'
import { shownLimit } from './shown-limit.mjs'
import { releaseBinding, sameBinding } from './release-digest.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLIENT = join(REPO, 'scripts', 'aumlok', 'approve-operation')
const VERIFY = join(REPO, 'scripts', 'aumlok', 'verify-approval')
/**
 * The patches whose `./plugins/…` rows are the shipped AUKORA plugins: EVERY patch at the release root, because a
 * deployment chooses which of them to list (the live app lists aukora-composition and action-gate; seatbelt is carried
 * and listed by choice). `demo-governed.patch.yml` is left out: hello-governed is admitted by its own one-use grant.
 */
const NOT_THE_SET = new Set(['demo-governed.patch.yml'])
/** The release's own composition first, so a plugin's recorded entry is the one the app mounts. */
const FIRST = ['aukora-composition.patch.yml', 'action-gate.patch.yml']
const mountingPatches = (release) => {
  const all = readdirSync(release).filter((name) => name.endsWith('.patch.yml') && !NOT_THE_SET.has(name)).sort()
  return [...FIRST.filter((name) => all.includes(name)), ...all.filter((name) => !FIRST.includes(name))]
}
const WINDOW_SECONDS = 300
/** The approval window shows at most 1,800 characters; self-change keeps the same margin. */
// What the INSTALLED card shows (scripts/aukora/shown-limit.mjs), read from the same support root this run acts on.
const SUPPORT_FOR_LIMIT = process.argv.includes('--support') ? process.argv[process.argv.indexOf('--support') + 1]
  : (process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA'))
const MAX_SHOWN_CHARS = shownLimit(join(resolve(SUPPORT_FOR_LIMIT), 'state'))
export const APPROVAL_FILE = 'plugin-set-approval.json'
export const PIN_FILE = 'plugin-set-approver.json'

const fail = (message) => { process.stderr.write(`PLUGIN-SET REFUSED: ${message}\n`); process.exit(1) }
const option = (flag) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}
const writePrivate = (path, text) => {
  const temp = `${path}.tmp.${process.pid}`
  writeFileSync(temp, text, { mode: 0o600 })
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

function releaseOf() {
  const release = option('--release')
  if (release === undefined) fail('--release <dir> is required')
  const dir = resolve(release)
  if (!existsSync(join(dir, 'apps/cli/lib/bin.js'))) fail(`${dir} is not a materialized release (no apps/cli/lib/bin.js)`)
  return dir
}

function readRecord(release) {
  const path = join(release, PLUGIN_SET_FILE)
  if (!existsSync(path)) fail(`${path} is absent: materialize the release again, or run \`record --release ${release}\``)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** The pin self-change uses: the live Kira overlay's subject, activeControlDigest and approverDid. */
function pinFrom(support) {
  const overlayPath = join(support, 'kira-deployment-overlay.patch.yml')
  if (!existsSync(overlayPath)) fail(`${overlayPath} is absent, so no approver can be pinned`)
  const overlay = readFileSync(overlayPath, 'utf8')
  const setting = (name) => overlay.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'mu'))?.[1]
    ?? fail(`${overlayPath} names no ${name}`)
  return { approverDid: setting('approverDid'), subject: setting('subject'),
    activeControlDigest: setting('activeControlDigest'), pinnedFrom: overlayPath }
}

function prepare(release, out, binding) {
  const record = readRecord(release)
  if (binding !== undefined) record.release = releaseBinding({ ...binding, release })
  const content = setOperationContent(record)
  const digest = operationDigestOf(content)
  // ONE CONVENTION, CHECKED: the gate spells the digest itself (it runs before the hook, and importing
  // operation-approval.mjs there would load a dozen Aumlok modules ungated), so this compares it with
  // Aumlok's own function and refuses on any difference.
  if (aumlokOperationDigestOf(Buffer.from(content, 'utf8')) !== digest) {
    fail('the gate and Aumlok compute different operation digests for the same content; nothing is prepared')
  }
  const witness = deriveApprovalWitness(Buffer.from(content, 'utf8'))
  if (content.length > MAX_SHOWN_CHARS || witness.words.length > MAX_SHOWN_CHARS) {
    fail(`the approval renders as ${String(witness.words.length)} characters and the window shows ${String(MAX_SHOWN_CHARS)}`)
  }
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const operationFile = join(out, 'operation.txt')
  writePrivate(operationFile, content)
  return { record, content, digest, operationFile, shown: witness.words.length }
}

function install({ release, record, receiptPath, pin, stateRoot }) {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  // THE WINDOW IS CHECKED HERE, AT INSTALL: an approval is installed only inside the window it was minted
  // for. After that it is a standing admission of exactly these bytes, which the gate re-verifies at boot.
  if (!(Number(receipt.expiresAt) > Math.floor(Date.now() / 1000))) fail(`the approval expired at ${String(receipt.expiresAt)}`)
  const verified = verifySetApproval({ record, receipt, pin })
  // AND THE STRANGER'S VERIFIER, the one self-change runs, against the key the pin names.
  const keyFile = join(dirname(receiptPath), 'approver.key')
  writePrivate(keyFile, `${ed25519PublicKeyFromDidKey(pin.approverDid)}\n`)
  const stranger = spawnSync(process.execPath, [VERIFY, receiptPath, '--pub', keyFile], { encoding: 'utf8' })
  if (stranger.status !== 0) fail(`scripts/aumlok/verify-approval refused the receipt:\n${stranger.stdout}${stranger.stderr}`)
  const gateState = join(stateRoot, 'gate-state')
  mkdirSync(gateState, { recursive: true, mode: 0o700 })
  const pinPath = join(gateState, PIN_FILE)
  if (existsSync(pinPath)) {
    const held = JSON.parse(readFileSync(pinPath, 'utf8'))
    if (held.approverDid !== pin.approverDid || held.subject !== pin.subject
      || held.activeControlDigest !== pin.activeControlDigest) {
      if (!process.argv.includes('--replace-pin')) {
        fail(`${pinPath} pins ${String(held.approverDid)} and this approval is by ${pin.approverDid}. A pin is not `
          + 'replaced as a side effect: pass --replace-pin to replace it, and say why.')
      }
    }
  }
  writePrivate(pinPath, `${JSON.stringify({ ...pin, pinnedAt: new Date().toISOString() }, null, 2)}\n`)
  writePrivate(join(gateState, APPROVAL_FILE), `${JSON.stringify(receipt, null, 2)}\n`)
  // Optional Touch ID evidence, as the stranger's verifier reported it. Reported only; it never decides an install.
  const presence = /^PRESENCE (never-enrolled|key-missing|invalid|no-evidence|verified)$/mu.exec(stranger.stdout ?? '')?.[1] ?? 'unreported'
  return { verified, gateState, release, presence }
}

function main() {
  const command = process.argv[2]
  const support = resolve(option('--support') ?? process.env.AUKORA_SUPPORT_ROOT
    ?? join(homedir(), 'Library', 'Application Support', 'AUKORA'))

  if (command === 'record') {
    const release = releaseOf()
    const patches = mountingPatches(release)
    const rows = patches.flatMap((name) => mountedPluginRows(readFileSync(join(release, name), 'utf8')))
    if (rows.length === 0) fail(`no ./plugins/ rows in ${patches.join(', ')} under ${release}`)
    // ONE ENTRY PER ID: the same id mounted from two different plugin directories would make "which bytes are
    // aukora-x" a question with two answers. The same directory with another entry (aukora-aumlok's service.mjs
    // and index.mjs) is one plugin, and the directory walk records both files.
    const firstDir = new Map()
    for (const row of rows) {
      const dir = row.entry.split('/').slice(0, 2).join('/')
      if (firstDir.has(row.id) && firstDir.get(row.id) !== dir) {
        fail(`${row.id} is mounted from ${firstDir.get(row.id)} and from ${dir}`)
      }
      if (!firstDir.has(row.id)) firstDir.set(row.id, dir)
    }
    // THE POLICY NAMES THE SET, AND THE MOUNTED ROWS MUST AGREE WITH IT IN BOTH DIRECTIONS: a plugin mounted
    // and not listed would load under a record nobody reviewed the boundary of, and one listed and not mounted
    // is a policy describing a composition that does not exist.
    const policyPath = join(release, 'plugins', 'aukora-composition-gate', 'policy.json')
    const listed = JSON.parse(readFileSync(policyPath, 'utf8')).pluginSet
    if (!Array.isArray(listed)) fail(`${policyPath} has no pluginSet list`)
    const mounted = [...new Set(rows.map((row) => row.id))]
    const unlisted = mounted.filter((id) => !listed.includes(id))
    const unmounted = listed.filter((id) => !mounted.includes(id))
    if (unlisted.length > 0 || unmounted.length > 0) {
      fail(`the composition and ${policyPath} disagree: mounted and not listed [${unlisted.join(', ')}], listed and not `
        + `mounted [${unmounted.join(', ')}]`)
    }
    const record = recordPluginSet({ root: release, rows })
    writePrivate(join(release, PLUGIN_SET_FILE), `${JSON.stringify(record, null, 2)}\n`)
    process.stdout.write(`PLUGIN SET RECORDED ${join(release, PLUGIN_SET_FILE)}\n`)
    process.stdout.write(`  set ${record.setDigest}: ${String(record.count)} plugins, ${String(record.fileCount)} files\n`)
    for (const artifact of Object.values(record.artifacts)) {
      process.stdout.write(`  ${artifact.id.padEnd(26)} ${String(Object.keys(artifact.files).length).padStart(4)} files  ${artifact.digest}\n`)
    }
    return
  }

  if (command === 'bind') {
    const release = releaseOf()
    const commit = option('--commit') ?? fail('bind needs --commit <sha>')
    const shell = option('--shell') ?? fail('bind needs --shell <AUKORA.app>')
    const record = readRecord(release)
    record.release = releaseBinding({ commit, release, shell })
    writePrivate(join(release, PLUGIN_SET_FILE), `${JSON.stringify(record, null, 2)}\n`)
    process.stdout.write(`RELEASE BOUND commit ${commit} tree ${record.release.tree} (${String(record.release.files)} files) shell ${record.release.shell}\n`)
    return
  }

  if (command === 'check') {
    const release = releaseOf()
    const stateRoot = resolve(option('--state-root') ?? join(support, 'state'))
    const gateState = join(stateRoot, 'gate-state')
    const read = (name) => (existsSync(join(gateState, name)) ? JSON.parse(readFileSync(join(gateState, name), 'utf8')) : null)
    const record = readRecord(release)
    // THE BYTES ON DISK, NOT THE RECORD'S WORD FOR THEM: with --shell the release tree and the shell are recomputed.
    const shell = option('--shell')
    if (shell !== undefined && !record.release) fail('the record binds no release (run bind first)')
    if (shell !== undefined && !sameBinding(record.release, releaseBinding({ commit: record.release?.commit ?? '', release, shell }))) {
      fail('the release tree or the shell on disk is not the one the record binds')
    }
    const verified = verifySetApproval({ record, receipt: read(APPROVAL_FILE), pin: read(PIN_FILE) })
    process.stdout.write(`PLUGIN SET APPROVED: set ${verified.setDigest}, ${String(verified.count)} plugins, operation `
      + `${verified.operationDigest}, signed by pinned ${verified.approverDid}\n`)
    return
  }

  if (command === 'prepare' || command === 'approve') {
    const release = releaseOf()
    let binding
    if (command === 'prepare' && (process.argv.includes('--commit') || process.argv.includes('--shell'))) {
      const commit = option('--commit'), shell = option('--shell')
      if (!commit || !shell || commit.startsWith('--') || shell.startsWith('--')) {
        fail('prepare needs both --commit <full sha> and --shell <AUKORA.app>')
      }
      binding = { commit, shell }
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/gu, '')
    const out = resolve(option('--out') ?? join(support, 'state', 'home', 'code-evidence', `${stamp}-plugin-set`))
    const prepared = prepare(release, out, binding)
    process.stdout.write(`${'─'.repeat(78)}\n${prepared.content}${'─'.repeat(78)}\n`)
    process.stdout.write(`OPERATION_FILE   ${prepared.operationFile}\n`)
    process.stdout.write(`OPERATION_DIGEST ${prepared.digest}  (sha256("aukora:operation-content:v1" ‖ 0x00 ‖ content))\n`)
    process.stdout.write(`SHOWN            ${String(prepared.shown)} of ${String(MAX_SHOWN_CHARS)} characters\n`)
    if (binding !== undefined) {
      process.stdout.write('IN-MEMORY BINDING: release record unchanged; approval requires this binding in a writable release.\n')
      process.stdout.write('PREPARED ONLY: no popup was raised and nothing was signed or installed.\n')
      return
    }
    const pin = pinFrom(support)
    const controller = join(support, 'state', 'aumlok')
    const socket = join(support, 'state', 'aumlok-signer.sock')
    const artifact = join(out, 'approval.json')
    process.stdout.write(`PINNED APPROVER  ${pin.approverDid} (from ${pin.pinnedFrom})\n`)
    process.stdout.write(`THE ONE COMMAND  node scripts/aukora/plugin-set.mjs approve --release ${release}\n`)
    process.stdout.write(`  which runs     ${CLIENT} --controller ${controller} --expect-subject ${pin.subject} `
      + `--expect-control-digest ${pin.activeControlDigest} --operation ${prepared.operationFile} --operation-digest `
      + `${prepared.digest} --signer-socket ${socket} --artifact-out ${artifact} --expires-at <now+${String(WINDOW_SECONDS)}>\n`)
    if (command === 'prepare') {
      process.stdout.write('PREPARED ONLY: no popup was raised and nothing was signed or installed.\n')
      return
    }
    process.stdout.write('\n>>> LOOK AT THE AUKORA APP: it shows this exact plugin set. Approve signs it; Refuse signs nothing. <<<\n')
    const approvalClass = option('--approval-class')
    const asked = spawnSync(process.execPath, [CLIENT,
      '--controller', controller,
      '--expect-subject', pin.subject, '--expect-control-digest', pin.activeControlDigest,
      '--operation', prepared.operationFile, '--operation-digest', prepared.digest,
      '--signer-socket', socket, '--artifact-out', artifact,
      '--expires-at', String(Math.floor(Date.now() / 1000) + WINDOW_SECONDS),
      ...(approvalClass === undefined ? [] : ['--approval-class', approvalClass]),
    ], { cwd: REPO, encoding: 'utf8' })
    process.stdout.write(`${asked.stdout ?? ''}${asked.stderr ?? ''}`)
    if (asked.status !== 0 || !existsSync(artifact)) fail(`not approved (exit ${String(asked.status)}); nothing was installed`)
    const stateRoot = resolve(option('--state-root') ?? join(support, 'state'))
    const done = install({ release, record: prepared.record, receiptPath: artifact, pin, stateRoot })
    process.stdout.write(`\nPLUGIN SET APPROVED AND INSTALLED\n`)
    process.stdout.write(`  set            ${done.verified.setDigest} (${String(done.verified.count)} plugins)\n`)
    process.stdout.write(`  operation      ${done.verified.operationDigest}\n`)
    process.stdout.write(`  approval       signed by pinned ${done.verified.approverDid}; class ${done.verified.approvalClass}, `
      + `key class ${done.verified.keyClass} (a software key on this Mac; attendance reported, not proven)\n`)
    process.stdout.write(`  presence       ${done.presence} (optional Touch ID after Approve; never required)\n`)
    process.stdout.write(`  installed in   ${done.gateState}/${APPROVAL_FILE} and ${PIN_FILE}\n`)
    process.stdout.write(`  evidence       ${out}\n`)
    return
  }
  fail('usage: plugin-set.mjs record|bind|prepare|approve|check --release <dir> [--support <dir>] [--out <dir>] [--state-root <dir>]')
}

try { main() } catch (error) { fail(error.message) }
