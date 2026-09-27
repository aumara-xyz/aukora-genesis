/** Types for the issuer's approval carrier: the channel one prompt is written to and its one answer read from. */

/** Environment key naming the operator-owned answer channel. Absent selects stdio. */
export declare const APPROVAL_SOCKET_ENV: 'AUKORA_ISSUER_APPROVAL_SOCKET'

/** Environment key naming the uid the answer channel must already belong to. */
export declare const APPROVAL_SOCKET_UID_ENV: 'AUKORA_ISSUER_APPROVAL_SOCKET_UID'

/**
 * One prompt channel. A carrier moves bytes; it never decides, rewrites an
 * answer, or signs.
 */
export interface ApprovalCarrier {
  /** Write one prompt to the channel. */
  write: (text: string) => void
  /** Receive every answer chunk, in arrival order. */
  onData: (handler: (text: string) => void) => void
  /** Receive the terminal end of the channel, at most once per handler. */
  onEnd: (handler: () => void) => void
  /** Release the channel. */
  close: () => void
}

/**
 * Require an operator-owned socket with trusted ancestors, no symlinks, and no
 * macOS extended ACL. Root-owned sticky directories and socket group access
 * are allowed. Same-UID code is not distinguished from the operator.
 *
 * @param socketPath - the operator-owned answer channel.
 * @param expectedUid - the uid the channel must already belong to.
 * @throws when ownership, permissions, path custody, or ACL absence cannot be established.
 */
export declare function assertOperatorChannel(socketPath: string, expectedUid: number): void

/** The parent-owned carrier: prompts to stderr, answers from stdin. */
export declare function stdioCarrier(): ApprovalCarrier

/**
 * Connect and recheck socket/ancestor identities before releasing a carrier.
 * Raw prompt transport only; no authenticated broker-review adapter is supplied.
 *
 * @param socketPath - the operator-owned answer channel.
 * @param expectedUid - the uid the channel must already belong to.
 * @throws when custody checks fail or connection does not complete within five seconds.
 */
export declare function socketCarrier(socketPath: string, expectedUid: number): Promise<ApprovalCarrier>

/**
 * Select the carrier this launch configured.
 *
 * @param env - environment to read; defaults to the process environment.
 * @throws when the socket channel is named but unusable, or its uid is absent
 *   or malformed.
 */
export declare function openApprovalCarrier(env?: Record<string, string | undefined>): Promise<ApprovalCarrier>
