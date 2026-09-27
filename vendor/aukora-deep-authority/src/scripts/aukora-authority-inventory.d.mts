/**
 * Type declarations for aukora-authority-inventory.
 *
 * @module
 */

export declare const FROZEN_VERIFIER_SHA256: string
export declare const VERIFIER_GRAPH_FORMAT: string
export declare function computeVerifierDigest(): string
export declare function verifierGraph(): {
  readonly format: string
  readonly roots: readonly string[]
  readonly nodes: ReadonlyArray<{
    readonly path: string
    readonly byteLength: number
    readonly sha256: string
    readonly sourceBase64: string
  }>
  readonly localEdges: ReadonlyArray<{
    readonly from: string
    readonly kind: string
    readonly ordinal: number
    readonly specifier: string
    readonly to: string
  }>
  readonly externalEdges: ReadonlyArray<{
    readonly from: string
    readonly kind: string
    readonly ordinal: number
    readonly specifier: string
  }>
}

export declare const INVENTORY_DOMAIN = 'aukora:authority-source-inventory:v1'

export declare const INVENTORY_REFUSE: {
  readonly REPOSITORY_UNEXPECTED: 'authority-inventory:repository-unexpected'
  readonly REVISION_INVALID: 'authority-inventory:revision-invalid'
  readonly REVISION_UNRESOLVED: 'authority-inventory:revision-unresolved'
  readonly REVISION_MISMATCHED: 'authority-inventory:revision-mismatched'
  readonly WORKING_TREE_DIRTY: 'authority-inventory:working-tree-dirty'
  readonly SOURCE_MISSING: 'authority-inventory:source-missing'
  readonly SOURCE_UNREADABLE: 'authority-inventory:source-unreadable'
  readonly SOURCE_NOT_REGULAR: 'authority-inventory:source-not-regular'
  readonly SOURCE_CHANGED: 'authority-inventory:source-changed'
  readonly DEPENDENCY_UNRESOLVABLE: 'authority-inventory:dependency-unresolvable'
  readonly GRAPH_INCOMPLETE: 'authority-inventory:graph-incomplete'
  readonly GRAPH_DIGEST_MISMATCH: 'authority-inventory:graph-digest-mismatch'
}

export declare class AuthorityInventoryError extends Error {
  readonly reason: string
  constructor(reason: string, detail: string, options?: ErrorOptions)
}

export interface ExcludedTrustComponent {
  readonly category: string
  readonly title: string
  readonly components: readonly string[]
  readonly boundaryRationale: string
}

export declare const EXCLUDED_TRUST_COMPONENTS: readonly ExcludedTrustComponent[]

export interface AuthoritySourceFileEntry {
  readonly path: string
  readonly byteLength: number
  readonly sha256: string
}

export interface AuthorityExternalDependencyEntry {
  readonly name: string
  readonly version: string
  readonly manifestDigest: string | null
  readonly fileCount: number
  readonly totalByteLength: number
  readonly specifiers: readonly string[]
  readonly source: 'installed-node-modules-snapshot'
}

export interface InstalledDependencySnapshot {
  readonly source: 'installed-node-modules-snapshot'
  readonly description: string
  readonly packages: readonly AuthorityExternalDependencyEntry[]
}

export interface WorkingTreeStatus {
  readonly checkedOutCommit: string | null
  readonly isCurrentHead: boolean
  readonly isClean: boolean
  readonly modifiedFiles: readonly string[]
}

export interface AuthorityInventoryGraphSummary {
  readonly format: string
  readonly digest: string
  readonly frozenDigest: string
  readonly matchesFrozen: boolean
  readonly roots: readonly string[]
  readonly nodeCount: number
  readonly localEdgeCount: number
  readonly externalEdgeCount: number
}

export interface AuthorityInventoryCounts {
  readonly selectedSourceFiles: number
  readonly selectedSourceBytes: number
  readonly externalPackages: number
  readonly externalDependencyFiles: number
  readonly externalDependencyBytes: number
}

export interface AuthorityInventoryClaims {
  readonly isCompleteTCB: false
  readonly securityScore: null
  readonly scope: string
  readonly disclaimer: string
}

export interface AuthoritySourceInventoryReport {
  readonly domain: typeof INVENTORY_DOMAIN
  readonly revision: string
  readonly tree: string
  readonly authorityGraph: AuthorityInventoryGraphSummary
  readonly counts: AuthorityInventoryCounts
  readonly selectedSources: readonly AuthoritySourceFileEntry[]
  readonly externalDependencies: readonly AuthorityExternalDependencyEntry[]
  readonly installedDependencies: InstalledDependencySnapshot
  readonly workingTreeStatus: WorkingTreeStatus
  readonly excludedTrustComponents: readonly ExcludedTrustComponent[]
  readonly claims: AuthorityInventoryClaims
}

export interface AuthorityInventoryOptions {
  revision?: string
  repoDir?: string
  readGraph?: (commit: string) => {
    format?: string
    roots?: string[]
    nodes: Array<{ path: string, byteLength: number, sha256: string, sourceBase64: string }>
    localEdges?: Array<unknown>
    externalEdges: Array<{ from: string, specifier: string }>
  }
  readDependencies?: (imports: Array<{ specifier: string, consumerPath: string }>) => Array<{ path: string, bytes: Buffer, sha256: string }>
  refuseDirty?: boolean
  refuseMismatched?: boolean
}

export declare function resolveCommitTree(commit: string, repoDir?: string): string

export declare function readVerifiedSourceFile(absolutePath: string, relativePath: string): Buffer

export declare function pinnedAuthorityGraph(commit: string, repoDir?: string): {
  readonly format: string
  readonly roots: readonly string[]
  readonly nodes: ReadonlyArray<{
    readonly path: string
    readonly byteLength: number
    readonly sha256: string
    readonly sourceBase64: string
  }>
  readonly localEdges: ReadonlyArray<{
    readonly from: string
    readonly kind: string
    readonly ordinal: number
    readonly specifier: string
    readonly to: string
  }>
  readonly externalEdges: ReadonlyArray<{
    readonly from: string
    readonly kind: string
    readonly ordinal: number
    readonly specifier: string
  }>
}

export declare function readPinnedFrozenDigest(commit: string): string

export declare function authoritySourceInventory(options?: AuthorityInventoryOptions): AuthoritySourceInventoryReport

export declare function formatInventoryReport(inventory: AuthoritySourceInventoryReport): string
