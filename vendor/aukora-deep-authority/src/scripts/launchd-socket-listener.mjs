/** Private publication of an owner-managed Unix listener without replacing existing routes. */
import { randomBytes } from 'node:crypto'
import { chmodSync, chownSync, linkSync, lstatSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'

/** Conservative Unix socket address limit shared by Darwin and Linux. */
export const SUN_PATH_MAX_BYTES = 104

/**
 * Bind privately, then publish with selected permissions and optional group.
 * The caller must supply a non-replaceable parent and destroy peers before close.
 * @param {import('node:net').Server} listener - unbound listener.
 * @param {{socketPath:string, socketMode:0o600|0o660, socketGid?:number}} options - owner-provisioned route.
 * @returns {Promise<{close():Promise<void>}>} idempotent listener cleanup, removing only its own node.
 */
export async function listenPrivateSocket(listener, { socketPath, socketMode, socketGid }) {
  const fail = reason => new Error(`aukora:review-transport:${reason}`)
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || normalize(socketPath) !== socketPath
    || /[\u0000-\u001f\u007f]/u.test(socketPath)) throw fail('configuration-invalid')
  if (Buffer.byteLength(socketPath) > SUN_PATH_MAX_BYTES
    || Buffer.byteLength(dirname(socketPath)) + 15 > SUN_PATH_MAX_BYTES) throw fail('socket-path-too-long')
  if (socketMode !== 0o600 && socketMode !== 0o660) throw fail('socket-mode-invalid')
  if (socketGid !== undefined && (!Number.isInteger(socketGid) || socketGid < 0 || socketGid > 0xffff_fffe)) throw fail('socket-group-invalid')
  const staging = join(dirname(socketPath), `.p${randomBytes(6).toString('hex')}`)
  let published
  let bound
  const unlinkOwned = (path, identity) => {
    if (identity === undefined) return
    let current
    try { current = lstatSync(path) }
    catch (error) { if (error?.code === 'ENOENT') return; throw error }
    if (current.dev === identity.dev && current.ino === identity.ino) unlinkSync(path)
  }
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(staging, () => {
      try {
        const initial = lstatSync(staging)
        bound = { dev: initial.dev, ino: initial.ino }
        if (socketGid !== undefined) chownSync(staging, process.geteuid(), socketGid)
        chmodSync(staging, socketMode)
        const node = lstatSync(staging)
        linkSync(staging, socketPath)
        published = { dev: node.dev, ino: node.ino }
        unlinkSync(staging)
        resolve()
      } catch (error) {
        const errors = [error?.code === 'EEXIST' ? fail('socket-path-occupied') : error]
        for (const [path, identity] of [[socketPath, published], [staging, bound]]) {
          try { unlinkOwned(path, identity) } catch (cleanupError) { errors.push(cleanupError) }
        }
        listener.close(() => reject(errors.length === 1 ? errors[0] : new AggregateError(errors, 'socket publication cleanup failed')))
      }
    })
  })
  let closing
  return { close() {
    closing ??= new Promise(resolve => listener.close(resolve)).then(() => {
      unlinkOwned(socketPath, published)
    })
    return closing
  } }
}
