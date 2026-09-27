/** One staged file: its root-relative path, exact bytes, and digest. */
export interface SeatFile {
  readonly path: string
  readonly bytes: Buffer
  readonly sha256: string
}

/** The checkout this module runs from. Source bytes never come from here; dependency bytes do. */
export declare const REPO_DIR: string

/** Repository-relative entry whose closure is staged. */
export declare const OPERATOR_SEAT_ENTRY: string

/** Manifest domain for a staged seat, distinct from the installed authority manifest's. */
export declare const OPERATOR_SEAT_MANIFEST_DOMAIN: string

/** Machine-readable refusal reasons. */
export declare const SEAT_FILES_REFUSE: Readonly<Record<string, string>>

/** A named, machine-readable seat-staging refusal. */
export declare class SeatFilesError extends Error {
  readonly reason: string
  constructor(reason: string, detail: string)
}

/**
 * The only environment a pinned Git read runs under: an allowlist, so no repository, object,
 * index or work-tree pointer can arrive from the ambient environment.
 * @param home Value for `HOME`; only pinned local reads use the default.
 */
export declare function pinnedGitEnv(home?: string): Record<string, string>

/**
 * Require the repository these reads reach to be this module's own checkout.
 * @param options Fixture-injectable resolution, so the refusal can be exercised without a hostile environment.
 */
export declare function assertPinnedRepository(options?: { readToplevel?: () => string }): void

/**
 * Resolve one caller-supplied revision to the exact commit it names.
 * @param revision Any revision this checkout can resolve.
 * @returns The 40-character lowercase commit id.
 */
export declare function resolvePinnedRevision(revision: string): string

/**
 * Read several repository paths' exact bytes at one resolved commit.
 * @param commit A 40-hex commit id.
 * @param paths Repository-relative POSIX paths.
 * @returns Each path's exact bytes.
 */
export declare function readPinnedBlobs(commit: string, paths: readonly string[]): Map<string, Buffer>

/**
 * Read one repository path's exact bytes at a resolved commit.
 * @param commit A 40-hex commit id.
 * @param path Repository-relative POSIX path.
 * @returns The blob's exact bytes.
 */
export declare function readPinnedBlob(commit: string, path: string): Buffer

/**
 * Every module specifier one source file imports or re-exports.
 * @param source Module text.
 * @param path Repository-relative path, for refusal messages.
 * @returns Specifiers in source order.
 */
export declare function moduleSpecifiers(source: string, path: string): string[]

/**
 * Walk the seat entry's transitive relative-import closure at one commit.
 * @param commit A 40-hex commit id.
 * @returns Staged source files sorted by path, and the non-relative specifiers they reach.
 */
export declare function operatorSeatClosure(commit: string): {
  nodes: SeatFile[]
  externalEdges: { from: string, specifier: string }[]
}

/**
 * The complete staged seat: pinned sources, complete dependency packages, and a manifest.
 * @param revision Any revision this checkout resolves; recorded as its exact commit.
 * @returns The file set excluding `manifest.json`, plus the canonical manifest and its digest.
 */
export declare function operatorSeatFiles(revision: string): {
  commit: string
  files: readonly SeatFile[]
  manifest: string
  manifestSha256: string
}
