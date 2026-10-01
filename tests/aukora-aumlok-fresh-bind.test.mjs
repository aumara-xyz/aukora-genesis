#!/usr/bin/env node
// One disposable first-run flow. The approval answer is synthetic, never a human click.
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installApprovalBridge } from '../apps/aukora-desktop/aumlok-bridge.mjs'
import { APPROVAL_CHANNELS, loadOrganLibrary, readBindingState, resolveAumlokDirectory }
  from '../apps/aukora-desktop/aumlok-bridge-state.mjs'
import { DRAW_REFUSE } from '../apps/aukora-desktop/aumlok-draw.mjs'
import { AUMLOK_DIRECTORY_PATCH_NAME, INSTALL_SETTINGS_NAME }
  from '../apps/aukora-desktop/install-settings.mjs'
import { resolveTarget } from '../apps/aukora-desktop/resolve.mjs'
import { startShellSigner } from '../apps/aukora-desktop/aumlok-signer.mjs'
import * as organ from '../plugins/aukora-aumlok/lib/index.mjs'
import { createAumlokControlService } from '../plugins/aukora-aumlok/lib/service.mjs'
const repo = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'fresh-bind-'))
const support = process.env.AUKORA_SUPPORT_ROOT ?? join(scratch, 'support\'s # "quoted"')
if (process.env.AUKORA_SUPPORT_ROOT !== undefined) {
  assert.ok(!realpathSync(support).startsWith(join(homedir(), 'Library/Application Support/AUKORA')))
  assert.deepEqual(readdirSync(support), [], 'AUKORA_SUPPORT_ROOT must be an empty scratch directory')
}
const stateRoot = join(support, 'state')
const release = join(scratch, 'release')
const library = await loadOrganLibrary(repo)
const mode = path => statSync(path).mode & 0o777
const verdict = result => ({ ok: result.ok, reason: result.reason, drawSpent: result.drawSpent })
const handle = 'fresh-bind-fixture'
const absentDaemon = join(scratch, 'absent-owner-daemon.json')
const socketPath = join(scratch, 'signer.sock')
const readState = (lib, dir) => readBindingState(lib, dir, { ownerDaemonConfigPath: absentDaemon })
const asked = []
let signer
let shell
let callbacks = 0
function bridge(patches, onBound = async () => {}) {
  const handlers = {}
  // Supply the shell-owned main-frame contract; all state and signing still belong to this scratch fixture.
  const applicationOrigin = 'http://127.0.0.1:3187'
  const frame = { url: `${applicationOrigin}/`, origin: applicationOrigin, processId: 7, routingId: 11,
    parent: null, detached: false, isDestroyed: () => false }
  const sender = { mainFrame: frame, isDestroyed: () => false }
  const installed = installApprovalBridge({
    here: join(repo, 'apps', 'aukora-desktop'), applicationOrigin,
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn }, removeHandler() {}, removeAllListeners() {} },
    getWindow: () => ({ webContents: sender }), getReleaseDir: () => repo, getPatchPaths: () => patches,
    getStateRoot: () => stateRoot, getSupportRoot: () => support,
    ownerDaemonStatus: async () => ({ installed: false }), readBindingState: readState, headless: true, log: () => {}, onBound,
  })
  return { ...installed, call: (name, payload) => handlers[APPROVAL_CHANNELS[name]]({ sender,
    type: 'frame', senderFrame: frame, processId: frame.processId, frameId: frame.routingId }, payload) }
}
try {
  mkdirSync(join(release, '.dsh-build'), { recursive: true })
  mkdirSync(join(support, 'checkout'), { recursive: true })
  writeFileSync(join(release, '.dsh-build/genesis-artifacts.json'),
    JSON.stringify({ producer: { genesisCommit: '1'.repeat(40) } }))
  writeFileSync(join(release, '.dsh-build/plugin-set.json'), '{}\n')
  writeFileSync(join(release, 'aukora-composition.patch.yml'), '- id: aukora-aumlok\n- id: aukora-face-aumlok\n')
  writeFileSync(join(support, 'config.json'), JSON.stringify({ release, checkout: join(support, 'checkout') }))
  const resolveArgs = { env: { AUKORA_SUPPORT_ROOT: support }, userData: support, checkoutsDir: join(scratch, 'checkouts') }
  const first = await resolveTarget(resolveArgs)
  const directory = resolveAumlokDirectory(first.patch)?.directory
  assert.equal(directory, join(stateRoot, 'aumlok'))
  assert.deepEqual(readdirSync(directory), [])
  assert.equal(mode(directory), 0o700)
  assert.equal(mode(join(support, AUMLOK_DIRECTORY_PATCH_NAME)), 0o600)
  assert.equal(readState(library, directory).bound, false)
  const backend = createAumlokControlService({ directory })
  assert.throws(() => backend.refresh(), { code: 'aumlok-local:unavailable' })
  const signerArgs = { library, directory, socketPath, ownerDaemonConfigPath: absentDaemon,
    ask: async request => { asked.push(request); return { approve: true } },
    log: () => {}, logDir: join(scratch, 'signer-logs') }
  signer = await startShellSigner(signerArgs)
  assert.equal(signer.serving, false)
  assert.equal(signer.reason, 'aumlok:no-seed')
  console.log('FIRST RUN: shell and backend unbound; same scratch key directory; signer has no seed')
  shell = bridge(first.patch, async () => { callbacks += 1; signer = await startShellSigner(signerArgs) })
  let drawn = await shell.call('DRAW', 'bind')
  assert.equal(drawn.ok, true)
  const wrong = [...drawn.words.slice(0, 6), drawn.words[6] === 'wrongword' ? 'otherword' : 'wrongword']
  const submit = words => shell.call('SUBMIT', { intent: 'bind', words, handle })
  assert.deepEqual(verdict(await submit(wrong)), { ok: false, reason: DRAW_REFUSE.PHRASE_MISMATCH, drawSpent: true })
  assert.deepEqual(verdict(await submit(drawn.words)), { ok: false, reason: DRAW_REFUSE.NO_PENDING_DRAW, drawSpent: true })
  drawn = await shell.call('DRAW', 'bind')
  assert.deepEqual(verdict(await submit(['Bad'])), { ok: false, reason: DRAW_REFUSE.PHRASE_SHAPE, drawSpent: true })
  assert.equal(existsSync(join(directory, 'local-control.json')), false)
  assert.equal(callbacks, 0)
  drawn = await shell.call('DRAW', 'bind')
  const bound = await submit(drawn.words)
  assert.deepEqual(verdict(bound), { ok: true, reason: DRAW_REFUSE.VERIFIED, drawSpent: true })
  assert.equal(callbacks, 1)
  assert.equal(signer.serving, true, signer.reason)
  const state = readState(library, directory)
  assert.equal(state.bound, true)
  assert.equal(backend.refresh().subject, bound.subject)
  const settings = join(support, INSTALL_SETTINGS_NAME)
  console.log('BIND: spent draws refused; new draw bound; backend sees same identity; signer serving before submit returns')
  const projection = organ.loadLocalAumlokPublicControl(directory).projection
  const operation = Buffer.from('synthetic fresh-bind approval operation\n')
  const operationDigest = organ.operationDigestOf(operation)
  const receiptPath = join(scratch, 'receipt.json')
  const publicPath = join(scratch, 'public-key.txt')
  const operationPath = join(scratch, 'operation.txt')
  writeFileSync(operationPath, operation)
  const produced = await promisify(execFile)(process.execPath, [join(repo, 'scripts/aumlok/approve-operation'),
    '--controller', directory, '--expect-subject', projection.subject,
    '--expect-control-digest', projection.activeControlDigest, '--operation', operationPath,
    '--operation-digest', operationDigest, '--artifact-out', receiptPath,
    '--expires-at', String(Math.floor(Date.now() / 1000) + 300), '--timeout-ms', '20000'],
  { env: { ...process.env, AUKORA_SUPPORT_ROOT: support, AUKORA_SIGNER_SOCKET: socketPath } })
  assert.match(produced.stdout, /APPROVAL: MINTED/u)
  console.log(produced.stdout.split('\n').find(line => line === 'APPROVAL: MINTED'))
  assert.equal(asked.length, 1)
  assert.equal(asked[0].operationDigest, operationDigest)
  assert.equal(JSON.parse(readFileSync(receiptPath)).approvalKeyDid, projection.approvalKeyDid)
  writeFileSync(publicPath, organ.ed25519PublicKeyFromDidKey(projection.approvalKeyDid))
  const verifyArgs = [join(repo, 'scripts/aumlok/verify-approval'), receiptPath, '--pub', publicPath,
    '--operation', operationPath, '--subject', projection.subject, '--control-digest', projection.activeControlDigest]
  const verified = spawnSync(process.execPath, verifyArgs, { encoding: 'utf8', env: { ...process.env, AUKORA_SUPPORT_ROOT: support } })
  assert.equal(verified.status, 0, verified.stdout + verified.stderr)
  assert.match(verified.stdout, /VERIFIED: the key you supplied signed exactly these bytes/u)
  console.log(verified.stdout.split('\n').find(line => line.startsWith('VERIFIED:')))
  writeFileSync(operationPath, 'different operation\n')
  const refused = spawnSync(process.execPath, verifyArgs, { encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.match(refused.stdout + refused.stderr, /aukora:verify-operation-mismatch/u)
  console.log('APPROVAL: synthetic ask answered once; new key signed; verify-approval accepted; changed operation refused')
  const recordPath = join(directory, 'local-control.json')
  const record = readFileSync(recordPath)
  const seed = readFileSync(join(directory, 'machine-seed-v3.json'))
  await signer.stop()
  shell.dispose()
  const second = await resolveTarget(resolveArgs)
  assert.equal(resolveAumlokDirectory(second.patch).directory, directory)
  assert.ok(second.patch.includes(settings))
  assert.equal(second.patch.includes(join(support, AUMLOK_DIRECTORY_PATCH_NAME)), false)
  shell = bridge(second.patch, async () => { callbacks += 1 })
  assert.equal((await shell.call('STATE')).bound, true)
  for (const intent of ['bind', 'refresh']) {
    const again = await shell.call('DRAW', intent)
    assert.equal(again.reason, 'aumlok:bind-already-bound')
    assert.equal('words' in again, false)
  }
  await assert.rejects(organ.bindV3({ handle, words: drawn.words, directory, boundAt: new Date().toISOString() }),
    { code: 'aumlok:bind-already-bound' })
  assert.deepEqual(readFileSync(recordPath), record)
  assert.deepEqual(readFileSync(join(directory, 'machine-seed-v3.json')), seed)
  assert.equal(callbacks, 1)
  signer = await startShellSigner(signerArgs)
  assert.equal(signer.serving, true, signer.reason)
  console.log('SECOND RUN: bound identity retained; no bind draw; key unchanged; signer serving')
  const guarded = join(scratch, 'guarded-seed'), victim = join(scratch, 'existing-seed')
  mkdirSync(guarded)
  writeFileSync(victim, 'existing key bytes\n')
  symlinkSync(victim, join(guarded, 'machine-seed-v3.json'))
  assert.throws(() => organ.keepMachineSeed(JSON.parse(seed), { directory: guarded, exclusive: true }), { code: 'EEXIST' })
  await assert.rejects(organ.bindV3({ handle, words: drawn.words, directory: guarded, boundAt: new Date().toISOString() }),
    { code: 'aumlok:bind-write-failed:EEXIST' })
  assert.equal(existsSync(join(guarded, 'local-control.json')), false)
  assert.equal(readFileSync(victim, 'utf8'), 'existing key bytes\n')
  console.log('SEED REFUSAL: exclusive keep refused symlink; bind rolled back its record; existing key unchanged')
  await assert.rejects(organ.bindV3({ handle, words: drawn.words, directory: guarded,
    boundAt: new Date().toISOString(), custodian: 'keychain' }), { code: 'aumlok:bind-write-failed' })
  console.log('FRESH BIND: PASS (scratch only; synthetic approval; no human attendance claimed)')
} finally {
  await signer?.stop?.()
  shell?.dispose()
  rmSync(scratch, { recursive: true, force: true })
}
