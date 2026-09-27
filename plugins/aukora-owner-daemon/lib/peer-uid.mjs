import { spawnSync } from 'node:child_process'

/** Node has no public getpeereid API. Inherit this connection, never reconnect. */
export function peerUid(socket, helperPath) {
  const fd = socket?._handle?.fd
  if (!Number.isInteger(fd) || fd < 0 || typeof helperPath !== 'string') {
    throw Object.assign(new Error('airlock:peer-unavailable'), { code: 'airlock:peer-unavailable' })
  }
  const result = spawnSync(helperPath, [], {
    stdio: ['ignore', 'pipe', 'ignore', fd], encoding: 'utf8',
    timeout: 2_000, maxBuffer: 128, env: {},
  })
  const text = result.stdout ?? ''
  if (result.error || result.status !== 0 || !/^(0|[1-9][0-9]*)\n$/.test(text)) {
    throw Object.assign(new Error('airlock:peer-unavailable'), { code: 'airlock:peer-unavailable' })
  }
  const uid = Number(text.trim())
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw Object.assign(new Error('airlock:peer-unavailable'), { code: 'airlock:peer-unavailable' })
  }
  return uid
}
