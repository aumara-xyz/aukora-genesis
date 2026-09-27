/** The machine-readable result of one staging run. */
export interface OperatorSeatStagingReport {
  readonly ok: true
  readonly status: 'OPERATOR_SEAT_STAGED' | 'OPERATOR_SEAT_CHECKED'
  readonly apply: boolean
  readonly entry: string
  readonly sourceCommit: string
  readonly workingTreeDirty: boolean
  readonly seatRoot: string
  readonly manifestSha256: string
  readonly files: number
  readonly sourceFiles: number
  readonly dependencyFiles: number
  readonly presentBeforeRun: boolean
  readonly seatEntryPath: string
  readonly blockers: readonly string[]
  readonly verified: boolean
  readonly detail?: string
}

/** Managed parent the seat root must be one direct child of. */
export declare const SEAT_PARENT: string

/** The machine-readable result of one preparation run. */
export interface OperatorPathPreparationReport {
  readonly ok: true
  readonly status: 'OPERATOR_PATH_PREPARED'
  readonly preparedPath: string
  readonly sourceCommit: string
  readonly seatManifestSha256: string
  readonly dependencies: readonly { name: string, version: string, files: number }[]
  readonly internalSymlinks: number
  readonly privileged: false
  readonly packageInstallHooksRun: 0
  readonly blockers: readonly string[]
}

/**
 * Build one pinned, self-contained installation path, unprivileged.
 * Runs no package manager and therefore no install hook, and refuses a prepared path that cannot
 * reproduce the seat manifest digest with its own stager and dependencies.
 * @param request Pinned revision and where to build.
 */
export declare function prepareInstallationPath(request: {
  revision: string
  destination: string
  source?: string
}): Readonly<OperatorPathPreparationReport>

/**
 * Require a destination this command may create as a fresh prepared path.
 * @param destination Operator-supplied absolute path.
 */
export declare function assertPreparedDestination(destination: string): void

/**
 * Refuse a prepared path that still reaches outside itself.
 * @param destination The prepared path.
 * @returns What was observed, for the report.
 */
export declare function assertPreparedTreeSelfContained(destination: string): { symlinks: number }

/**
 * Admit this installation path to privileged publication, or refuse naming the bootstrap.
 * There is no override: a path that cannot be admitted does not publish.
 * @param admit The admission check; injectable so a test can prove ordering.
 */
export declare function admitInstallationPath(admit?: () => void): void

/**
 * Require the seat root to be one direct, content-addressed child of the managed parent.
 * @param root Operator-supplied absolute path.
 * @param manifestSha256 Digest the basename must equal.
 */
export declare function assertSeatRoot(root: string, manifestSha256: string): void

/**
 * Refuse a staged set containing a credential-shaped path.
 * @param files The staged file set.
 */
export declare function assertNoCredentialPaths(files: readonly { path: string }[]): void

/**
 * Compute the seat file set, then publish or verify it at `root`.
 * @param request Operator inputs; `platform` and `euid` are injectable for tests.
 * @returns The staging report.
 */
export declare function runOperatorSeatStaging(request: {
  revision: string
  root: string
  apply: boolean
  platform?: string
  euid?: number
  admit?: () => void
}): Readonly<OperatorSeatStagingReport>

/**
 * CLI entry.
 * @param argv Exact arguments after the script path.
 * @returns The staging report.
 */
export declare function main(argv?: string[]): Readonly<OperatorSeatStagingReport | OperatorPathPreparationReport>
