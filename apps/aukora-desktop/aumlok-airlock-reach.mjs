import { connect } from 'node:net'
import { peerUid } from '../../plugins/aukora-owner-daemon/lib/peer-uid.mjs'

/**
 * Whether the Airlock daemon is the peer on this socket.
 * A missing socket, a timeout, or a peer that is not the configured owner uid is not reachable.
 * Unreachable fails closed: the approval window is not opened and nothing is signed.
 */
export function airlockOwnerReachable(config, timeoutMs = 1500) {
  return new Promise(resolve => {
    let settled = false
    const socket = connect(config.socketPath)
    const finish = ok => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ok === true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('connect', () => {
      try {
        finish(peerUid(socket, config.peerHelperPath) === config.ownerUid)
      } catch {
        finish(false)
      }
    })
    socket.once('error', () => finish(false))
  })
}
