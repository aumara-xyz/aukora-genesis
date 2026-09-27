import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { readJsonStrictBytes } from '../../plugins/aukora-kira/lib/strict-read.mjs'
import { assertNoWriteAcls } from '../../plugins/aukora-owner-daemon/lib/boundary.mjs'

export const OWNER_DAEMON_CONFIG = '/etc/aukora/owner-daemon.json'

// Only ENOENT means legacy custody. Malformed, unreadable or replaceable configuration
// closes the signer; none of those conditions authorizes loading Peter's local seed.
export function readOwnerDaemonConfig(path = OWNER_DAEMON_CONFIG, trustedUid = 0) {
  let info
  try { info = lstatSync(path) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!info.isFile() || info.uid !== trustedUid || (info.mode & 0o022)) {
    throw new Error('airlock:config-untrusted')
  }
  assertNoWriteAcls(path, trustedUid, 'airlock config')
  // /etc is a macOS system symlink. Check real ancestors, including its target.
  let parent = dirname(realpathSync(path))
  for (;;) {
    const stat = lstatSync(parent)
    const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000)
    if (![0, trustedUid].includes(stat.uid) || ((stat.mode & 0o022) && !stickyRoot)) {
      throw new Error('airlock:config-parent-untrusted')
    }
    assertNoWriteAcls(parent, stat.uid, 'airlock config parent')
    if (dirname(parent) === parent) break
    parent = dirname(parent)
  }
  const { value: config } = readJsonStrictBytes(path, { label: 'owner-daemon config' })
  for (const key of ['socketPath', 'peerHelperPath', 'keyPath']) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key]) || config[key].includes('\0')) {
      throw new Error('airlock:config-path')
    }
  }
  for (const key of ['ownerUid', 'callerUid']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error('airlock:config-uid')
  }
  if (config.ownerUid === config.callerUid || !/^[0-9a-f]{64}$/.test(config.ownerPublicKeyHex)) {
    throw new Error('airlock:config-custody')
  }
  return Object.freeze({ ...config })
}
