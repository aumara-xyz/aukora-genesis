import { createPrivateKey, createPublicKey } from 'node:crypto'
import { chmodSync, lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import * as boundary from './boundary.mjs'
import { serveBounded } from './listener.mjs'
import { peerUid } from './peer-uid.mjs'
import { createAirlockHandler } from './airlock-protocol.mjs'
import { assertNoDuplicateKeys } from '../../aukora-kira/lib/strict-read.mjs'

const refuse = code => { throw Object.assign(new Error(code), { code }) }
const rootHost = { ...boundary.systemHost, uid: 0 }

/** Root-owned config is public. Neither its bytes nor its ancestors may be Peter-writable. */
export function readAirlockConfig(path) {
  const absolute = join(realpathSync(dirname(path)), basename(path))
  boundary.assertTrustedAncestors(absolute, rootHost)
  const bytes = boundary.readBoundaryFile(absolute, { checkHandle(state) {
    if (state.uid !== 0 || (state.mode & 0o022) !== 0 || state.size > 8192) refuse('airlock:config-insecure')
    boundary.assertNoWriteAcls(absolute, 0, 'airlock config')
  } })
  const text = bytes.toString('utf8')
  assertNoDuplicateKeys(text, 'airlock config')
  return JSON.parse(text)
}

/** The existing owner's custody checks and bounded listener, with kernel peer admission. */
export async function startAirlockServer(config) {
  if (!Number.isSafeInteger(config?.ownerUid) || config.ownerUid <= 0
    || !Number.isSafeInteger(config.callerUid) || config.callerUid <= 0
    || config.ownerUid === config.callerUid || process.geteuid() !== config.ownerUid) {
    refuse('airlock:second-uid-required')
  }
  for (const key of ['keyPath', 'socketPath', 'peerHelperPath']) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) refuse('airlock:config-malformed')
  }
  if (typeof config.ownerPublicKeyHex !== 'string' || !/^[0-9a-f]{64}$/u.test(config.ownerPublicKeyHex)) {
    refuse('airlock:config-malformed')
  }
  const ownerDir = boundary.assertPrivateDirectory(dirname(config.keyPath), 'airlock key directory')
  const keyPath = boundary.assertKeyBoundary({ keyFile: config.keyPath, ownerDir,
    uid: config.ownerUid, aclsOf: boundary.aclEntries })
  const runDir = dirname(config.socketPath)
  const runState = lstatSync(runDir)
  if (!runState.isDirectory() || runState.isSymbolicLink() || runState.uid !== config.ownerUid) {
    refuse('airlock:run-directory-insecure')
  }
  boundary.assertRunBoundary(runDir, boundary.systemHost)
  boundary.assertTrustedAncestors(runDir, boundary.systemHost)
  const helper = lstatSync(config.peerHelperPath)
  if (!helper.isFile() || helper.isSymbolicLink() || helper.uid !== 0 || (helper.mode & 0o022) !== 0) {
    refuse('airlock:peer-helper-insecure')
  }
  boundary.assertNoWriteAcls(config.peerHelperPath, 0, 'airlock peer helper')
  boundary.assertTrustedAncestors(config.peerHelperPath, rootHost)

  // Carry forward the daemon's descriptor-bound read (also used by the deep issuer).
  // Only the second UID reaches this read. No secret is returned or logged.
  const bytes = boundary.readBoundaryFile(keyPath, { checkHandle(state) {
    if (state.size > 8192) refuse('airlock:key-malformed')
    boundary.assertPrivateHandle(state, keyPath, 'airlock machine seed')
  } })
  let privateKey
  try {
    const text = bytes.toString('utf8')
    assertNoDuplicateKeys(text, 'airlock machine seed')
    const kept = JSON.parse(text)
    if (kept.version !== 3 || typeof kept.ed25519SeedHex !== 'string'
      || !/^[0-9a-f]{64}$/u.test(kept.ed25519SeedHex)) refuse('airlock:key-malformed')
    const encoded = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(kept.ed25519SeedHex, 'hex')])
    try { privateKey = createPrivateKey({ key: encoded, format: 'der', type: 'pkcs8' }) }
    finally { encoded.fill(0) }
    const publicKeyHex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
    if (publicKeyHex !== config.ownerPublicKeyHex || kept.ed25519PublicKeyHex !== publicKeyHex) {
      refuse('airlock:key-pin-mismatch')
    }
  } finally { bytes.fill(0) }
  const handle = createAirlockHandler(privateKey)
  const server = await serveBounded({ socketPath: config.socketPath, role: 'submit',
    handle(_role, message, socket) {
      if (peerUid(socket, config.peerHelperPath) !== config.callerUid) refuse('airlock:caller-uid-mismatch')
      return handle(message)
    } })
  try { chmodSync(config.socketPath, 0o660) }
  catch (error) { server.close(); throw error }
  return server
}
