// One focused custody-switch check. Keys exist only in memory; no installed state.
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import * as organ from '../plugins/aukora-aumlok/lib/index.mjs'
import * as wire from '../plugins/aukora-aumlok/lib/owner-approval.mjs'
import { createAirlockHandler } from '../plugins/aukora-owner-daemon/lib/airlock-protocol.mjs'
import { startShellSigner } from '../apps/aukora-desktop/aumlok-signer.mjs'
import { requestOwnerSignature } from '../apps/aukora-desktop/aumlok-signer-airlock.mjs'
import { readOwnerDaemonConfig } from '../apps/aukora-desktop/aumlok-airlock-config.mjs'
import { readBindingState } from '../apps/aukora-desktop/aumlok-bridge-state.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'airlock-'))
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const ownerPublicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
const uid = process.getuid()
const configPath = join(scratch, 'owner-daemon.json')
const config = { socketPath: join(scratch, 'owner.sock'), ownerUid: uid, callerUid: uid + 1,
  ownerPublicKeyHex, peerHelperPath: join(scratch, 'peer-uid'), keyPath: join(scratch, 'never-opened') }
writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 })
writeFileSync(join(scratch, 'local-control.json'), JSON.stringify({ publicRoot: { machines: [{ ed25519: ownerPublicKeyHex }] } }))
let seedReads = 0, shell, server
const library = { ...organ, library: wire,
  readKeptMachineSeed() { seedReads++; throw new Error('LOCAL_SEED_REFUSED') } }
const shellInput = { library, directory: scratch, socketPath: join(scratch, 'shell.sock'),
  logDir: join(scratch, 'logs'), ownerDaemonConfigPath: configPath, ownerDaemonConfigUid: uid,
  ask: async () => ({ approve: true }) }
try {
  assert.equal(readOwnerDaemonConfig(configPath, uid).ownerPublicKeyHex, ownerPublicKeyHex)
  const binding = readBindingState({ ...library, loadLocalAumlokPublicControl(_directory, _expect, key) {
    assert.equal(key, ownerPublicKeyHex)
    return { projection: { subject: 'fixture' } }
  } }, scratch, { ownerDaemonConfigPath: configPath, ownerDaemonConfigUid: uid })
  assert.equal(binding.bound, true)
  assert.equal(seedReads, 0, 'binding startup must use public pin without local seed')
  shell = await startShellSigner(shellInput)
  assert.equal(seedReads, 0, 'config present: local seed reader MUST NOT be reached')
  assert.notEqual(shell.reason, 'aumlok:no-seed', 'daemon mode must not depend on a local seed')
  assert.equal(shell.serving, false, 'configured but unreachable daemon must close the signer')
  assert.equal(shell.reason, 'airlock:protocol-unverified')
  console.log('VERIFIED config present: local seed reader refused')

  const absent = await startShellSigner({ ...shellInput, ownerDaemonConfigPath: join(scratch, 'absent.json') })
  assert.equal(absent.reason, 'aumlok:no-seed')
  assert.equal(seedReads, 1, 'no config: legacy local reader unchanged')
  writeFileSync(configPath, '{bad json')
  const invalid = await startShellSigner(shellInput)
  assert.equal(invalid.reason, 'airlock:config-refused')
  assert.equal(seedReads, 1, 'invalid config must not fall back to local custody')
  writeFileSync(configPath, JSON.stringify(config))
  chmodSync(configPath, 0o666)
  assert.throws(() => readOwnerDaemonConfig(configPath, uid), /config-untrusted/)
  chmodSync(configPath, 0o600)
  console.log('VERIFIED absent config keeps legacy path; broken config refuses fallback')
  if (!process.argv.includes('--seed-only')) {
    execFileSync('/usr/bin/cc', ['-O2', '-Wall', '-Wextra', '-Werror',
      new URL('../plugins/aukora-owner-daemon/native/peer-uid.c', import.meta.url).pathname,
      '-o', config.peerHelperPath])
    let received = [], badSignature = false
    const daemon = createAirlockHandler(privateKey)
    server = createServer(socket => {
      let bytes = ''
      socket.on('error', () => {})
      socket.on('data', data => {
        bytes += data.toString('utf8')
        if (!bytes.includes('\n')) return
        const message = JSON.parse(bytes.slice(0, bytes.indexOf('\n')))
        received.push(message)
        const response = daemon(message)
        socket.end(wire.serializeApprovalResponse(badSignature
          ? wire.createSignedApprovalResponse({ challenge: message.request.challenge, signature: '00'.repeat(64) })
          : response))
      })
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.socketPath, resolve) })
    shell = await startShellSigner(shellInput)
    assert.equal(shell.serving, true, `shell socket unavailable: ${shell.reason} (${shell.detail ?? ''})`)
    assert.equal(received[0].kind, 'protocol', 'compatibility proved before shell serves')
    received = []
    const now = Math.floor(Date.now() / 1000)
    const request = { domain: wire.APPROVAL_REQUEST_DOMAIN, subject: `aukora:1:${'11'.repeat(32)}`,
      activeControlDigest: '22'.repeat(32), operationDigest: '33'.repeat(32),
      challenge: randomBytes(32).toString('hex'), issuedAt: now, expiresAt: now + 60 }
    // Use the production parser's own subject constructor vocabulary from a disposable digest.
    wire.parseApprovalRequest(request)
    const response = await new Promise((resolve, reject) => {
      const socket = connect(shellInput.socketPath)
      const deadline = setTimeout(() => { socket.destroy(); reject(new Error('shell timeout')) }, 7000)
      let bytes = ''
      socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
      socket.on('data', data => { bytes += data; if (bytes.includes('\n')) {
        clearTimeout(deadline); socket.destroy(); resolve(JSON.parse(bytes.split('\n')[0]))
      } })
      socket.once('error', error => { clearTimeout(deadline); reject(error) })
    })
    assert.equal(wire.parseApprovalResponse(response).kind, 'signed')
    assert.deepEqual(received[0], { kind: 'approval', request })
    assert(verify(null, wire.approvalSigningBytes(request), publicKey, Buffer.from(response.signature, 'hex')))
    assert.equal(seedReads, 1)
    console.log('VERIFIED shell forwarded exact operation digest; pinned signature accepted on stand-in Unix socket')
    const fresh = () => ({ ...request, challenge: randomBytes(32).toString('hex') })
    const send = (cfg, req) => requestOwnerSignature(cfg, { kind: 'approval', request: req },
      wire.approvalSigningBytes(req), req.challenge, wire)
    const count = received.length
    await assert.rejects(send({ ...config, ownerUid: uid + 1 }, fresh()), /airlock:peer-uid/)
    assert.equal(received.length, count, 'wrong kernel UID refused before any digest is sent')
    badSignature = true
    await assert.rejects(send(config, fresh()), /airlock:signature/)
    badSignature = false
    await assert.rejects(send({ ...config, ownerPublicKeyHex: '00'.repeat(32) }, fresh()), /airlock:signature/)
    console.log('VERIFIED wrong kernel peer UID, bad signature, and wrong public-key pin refused')
    console.log('NOT VERIFIED: stand-in shares test UID; separate-user installation and EACCES require admin probe')
  }
} finally {
  if (shell?.stop) await shell.stop()
  if (server) await new Promise(resolve => server.close(resolve))
  rmSync(scratch, { recursive: true, force: true })
}
