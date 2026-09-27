import type { IssuerReviewConnection } from './launchd-issuer-review.mjs'
import type { CustodyPairPlan } from './install-launchd-custody-pair.mjs'

/** Identities whose group membership the operator must observe before publication. */
export type ReviewPrincipals = Pick<CustodyPairPlan, 'issuerUser' | 'issuerUid' | 'issuerGid'
  | 'brokerUser' | 'brokerUid' | 'brokerGid' | 'guestUser' | 'guestUid'>

/** Read-only membership check; injectable observations are scripted fixtures, not host evidence. */
export declare function readIssuerOnlyGroup(plan: ReviewPrincipals, groupName: string,
  host?: (binary: string, args: string[]) => string): number

/** Read stable operator-owned UTF-8 bytes with no symlinks, writable ancestors, or extended ACLs. */
export declare function readOperatorReviewFile(path: string, ownerUid: number, privateFile: boolean): string

/**
 * Require every ancestor of this module and the repo root to be root-owned
 * without group or world write.
 *
 * @param options Fixture-injectable invocation locations.
 * @returns Nothing; refuses `operator-review:invocation-tree-untrusted` on any untrusted ancestor.
 */
export declare function assertOperatorInvocationTree(options?: {
  modulePath?: string
  repoRoot?: string
  stat?: (path: string) => { isDirectory(): boolean, isSymbolicLink(): boolean, uid: number, mode: number }
}): void

/** Validate installed custody and attach an operator terminal; --check opens no channel. */
export declare function main(args?: string[]): Promise<IssuerReviewConnection | undefined>
