/** One frozen source import anchored to the module that actually consumes it. */
export interface AuthorityDependencyImport {
  specifier: string
  consumerPath: string
}

/** Exact installed bytes and their SHA-256, under a detached node_modules path. */
export interface AuthorityDependencyFile {
  path: string
  bytes: Buffer
  sha256: string
}

/**
 * Snapshot full installed Noble packages and declared runtime dependencies.
 * Reject unknown/missing dependencies, internal links, nested node_modules,
 * changing files, and conflicting copies. This is not runtime closure proof.
 * @param imports actual consumer paths and their non-builtin package imports
 * @returns sorted package files, including licenses, ready for detached staging
 */
export declare function snapshotAuthorityDependencies(imports: readonly AuthorityDependencyImport[]): AuthorityDependencyFile[]
