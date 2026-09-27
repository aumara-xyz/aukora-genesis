/** Stable refusal for an ACL or an unavailable custody observation. */
export declare class CustodyAclError extends Error {
  readonly reason: string
  readonly path: string
  constructor(reason: string, path: string)
}

/**
 * Require one existing canonical entry to have no extended ACL.
 * @param path - Absolute normalized path without symlink components.
 * @returns nothing; failed observations and extended ACLs throw CustodyAclError.
 */
export declare function assertNoExtendedAcl(path: string): void

/**
 * Require ACL absence on one entry and every ancestor through the filesystem root.
 * @param path - Absolute normalized path without symlink components.
 * @returns nothing; failed observations and extended ACLs throw CustodyAclError.
 */
export declare function assertNoExtendedAclAncestors(path: string): void
