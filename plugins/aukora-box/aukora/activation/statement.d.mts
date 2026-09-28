/** Stable names for activation-statement refusal reasons. */
export type ActivationRefuseKey =
  | 'FIELDS_NOT_EXACT'
  | 'DOMAIN_MISMATCH'
  | 'EPOCH_INVALID'
  | 'DIGEST_INVALID'
  | 'ATOM_INVALID'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_EMPTY'
  | 'MANIFEST_OVERSIZE'
  | 'FRAME_MALFORMED'
  | 'FRAME_OVERSIZE'
  | 'FRAME_NOT_CANONICAL'
  | 'DIGEST_MISMATCH'

export declare const ACTIVATION_STATEMENT_DOMAIN: 'aukora:activation-statement:v1'
export declare const ACTIVATION_DIGEST_DOMAIN: 'aukora:activation-digest:v1'
export declare const ACTIVATION_REFUSE: Readonly<Record<ActivationRefuseKey, string>>

/** A member-name-to-digest manifest. Names are exact atoms, never absolute paths. */
export type ActivationDigestManifest = Readonly<Record<string, string>>

/** Explicit executable and resolver anchors an activation fixes. */
export interface ActivationClosure {
  readonly executable: ActivationDigestManifest
  readonly resolver: ActivationDigestManifest
}

/** One closed activation statement over the selections its producer measured. */
export interface ActivationStatementV1 {
  readonly domain: 'aukora:activation-statement:v1'
  readonly epoch: number
  readonly coreManifest: ActivationDigestManifest
  readonly compositionDigest: string
  readonly closure: ActivationClosure
  readonly proposalCellSha256: string
  /** SHA-256 identity of the selected trusted renderer implementation. */
  readonly rendererId: string
  readonly modelEmissionPolicy: string
  readonly issuerId: string
  readonly brokerId: string
}

export declare class ActivationError extends Error {
  constructor(reason: string, detail: string)
  readonly reason: string
}

export declare function parseActivationStatement(value: unknown): Readonly<ActivationStatementV1>
export declare function encodeActivationStatement(statement: unknown): string
export declare function activationDigest(statement: unknown): string
export declare function parseActivationStatementFrame(text: unknown): Readonly<ActivationStatementV1>
export declare function assertActivationDigest(statement: unknown, expected: unknown): string
