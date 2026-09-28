import type { RootControlDigest, RootControlStateV1 } from './control.mjs'

export type IdentityControlStateRefuseKey = 'MALFORMED' | 'CONFLICT'
export type IdentityControlAdmitRefuseKey =
  | 'UNBOUND'
  | 'SUBJECT_MISMATCH'
  | 'DIGEST_MISMATCH'
  | 'REVOKED'
  | 'SIGNER_MISMATCH'

export declare const IDENTITY_CONTROL_STATE_REFUSE: Readonly<
  Record<IdentityControlStateRefuseKey, string>
>
export declare const IDENTITY_CONTROL_ADMIT_REFUSE: Readonly<
  Record<IdentityControlAdmitRefuseKey, string>
>

export declare class IdentityControlStateError extends Error {
  constructor(reason: string, detail: string)
  readonly reason: string
}

export declare function identityControlStatePath(stateDir: string): string
export declare function readIdentityControlState(
  stateDir: string,
): Readonly<RootControlStateV1> | null
export declare function bindIdentityControlState(
  stateDir: string,
  stateInput: unknown,
): Readonly<RootControlStateV1>
export declare function admitIdentityControl(facts: {
  state: unknown
  expectedSubject: unknown
  expectedControlDigest: unknown
  rootPublicKeyPem: unknown
}): Readonly<
  | { ok: true; state: Readonly<RootControlStateV1>; controlDigest: RootControlDigest }
  | { ok: false; reason: string; detail: string }
>
