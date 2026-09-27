import type { ActivationStatementV1 } from '../aukora/activation/statement.d.mts'

/** Named refusals raised before the broker is served. */
export declare const LAUNCHD_ACTIVATION_REFUSE: Readonly<{
  STATEMENT_UNREADABLE: string
  ROOT_INVALID: string
  CLOSURE_NAME_UNRESOLVED: string
  CLOSURE_INCOMPLETE: string
}>

/** The retained statement's fixed name inside the implementation root. */
export declare const INSTALLED_ACTIVATION_STATEMENT: string

/** A named refusal from installed-activation verification. */
export declare class LaunchdActivationError extends Error {
  constructor(reason: string, detail: string)
  readonly reason: string
}

/** Root to measure, its runtime, and the digest the job carries. */
export interface InstalledActivationVerification {
  statementPath: string
  implementationRoot: string
  /** The interpreter this caller is asking about: the executing one, or the one a job will launch. */
  interpreter: string
  expectedDigest: unknown
}

/**
 * Verify the retained activation statement and return the digest to bind.
 *
 * Refuses unless the statement parses, every member it names still holds the
 * bytes it recorded, and the result digests to exactly the expected value. The
 * measurement is what makes the returned digest evidence rather than an
 * assertion the job's environment happened to carry.
 *
 * @param options Retained statement, its root, and the digest the job carries.
 * @returns The verified activation digest.
 * @throws On an unreadable statement, an unresolvable member, measured bytes that differ, or a digest that is not the expected one.
 */
export declare function verifyInstalledActivation(options: InstalledActivationVerification): string

/** Root to measure, its runtime, the core member names, and the declared selections. */
export interface InstalledActivationBuild {
  implementationRoot: string
  /** The interpreter the job this statement describes will launch. */
  interpreter: string
  coreMembers: readonly string[]
  selections: Readonly<Record<string, unknown>>
}

/**
 * Build one activation statement over an installed implementation root.
 *
 * Every digest is measured from the bytes staged in that root; the remaining
 * selections are declarations the caller owns, not measurements.
 *
 * @param options Root to measure, extra core member names, and the declared selections.
 * @returns The statement, its canonical frame, and its digest.
 * @throws When a named member cannot be measured or the selections do not form a closed statement.
 */
export declare function buildInstalledActivationStatement(options: InstalledActivationBuild): {
  statement: Readonly<ActivationStatementV1>
  frame: string
  digest: string
}
