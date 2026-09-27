/** Stable names for activation filesystem-custody refusal reasons. */
export type ActivationMeasureRefuseKey =
  | 'PATH_NOT_ABSOLUTE'
  | 'PATH_SUBSTITUTED'
  | 'PATH_SYMLINK'
  | 'MEMBER_NOT_FILE'
  | 'MEMBER_MUTABLE'
  | 'MEMBER_DIGEST_MISMATCH'
  | 'MEMBER_UNREADABLE'
  | 'MEMBER_NAME_INVALID'

export declare const ACTIVATION_MEASURE_REFUSE: Readonly<Record<ActivationMeasureRefuseKey, string>>

export declare class ActivationMeasureError extends Error {
  constructor(reason: string, detail: string)
  readonly reason: string
}

/** Ancestry handling. The member itself is never resolved, whatever this says. */
export interface ActivationMeasureOptions {
  /** Canonicalize the containing directory before checking the leaf. */
  allowAncestorLinks?: boolean
}

export declare function measureClosureMember(path: unknown, options?: ActivationMeasureOptions): string
export declare function measureDigestManifest(
  members: ReadonlyArray<{ name: string; path: string }>,
  options?: ActivationMeasureOptions,
): Readonly<Record<string, string>>
export declare function measureVerifiedDigestManifest(
  members: ReadonlyArray<{ name: string; path: string; sha256: string }>,
  options?: ActivationMeasureOptions,
): Readonly<Record<string, string>>
