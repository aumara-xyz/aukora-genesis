import type { Server } from 'node:net'

/** Conservative Unix socket address limit shared by Darwin and Linux. */
export declare const SUN_PATH_MAX_BYTES: number

/** Caller owns the protected parent and must destroy peers before closing. */
export declare function listenPrivateSocket(listener: Server, options: {
  socketPath: string
  socketMode: 0o600 | 0o660
  socketGid?: number
}): Promise<{ close(): Promise<void> }>
