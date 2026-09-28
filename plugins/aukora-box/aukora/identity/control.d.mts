import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AukoraId, IdentityGenesisV1, RootKeySetId } from './genesis.mjs'

export type RootControlDigest = Branded<'RootControlDigest'>
export type RootControlNonce = Branded<'RootControlNonce'>
export type AumlokRootControlSuite = typeof AUMLOK_ROOT_CONTROL_SUITE

export interface HybridPublicKeysV1 {
  ed25519: string
  mlDsa65: string
}

export interface HybridSignaturesV1 {
  ed25519: string
  mlDsa65: string
}

export interface InitialIdentityControlInputV1 {
  suite: AumlokRootControlSuite
  publicKeys: HybridPublicKeysV1
  /** Inclusive Unix time in seconds. */
  authorizedAt: number
}

export interface RootControlStateV1 {
  domain: typeof ROOT_CONTROL_STATE_DOMAIN
  suite: AumlokRootControlSuite
  subject: AukoraId
  epoch: number
  rootKeySetId: RootKeySetId
  publicKeys: HybridPublicKeysV1
  /** Inclusive Unix time in seconds. */
  authorizedAt: number
  revoked: boolean
  predecessorControlDigest: RootControlDigest | null
}

export interface RootControlAuthorizationInputV1 {
  suite: AumlokRootControlSuite
  subject: string
  predecessorControlDigest: string
  predecessorRootKeySetId: string
  predecessorEpoch: number
  predecessorRevoked: boolean
  nextRootKeySetId: string
  nextPublicKeys: HybridPublicKeysV1
  nextEpoch: number
  nextRevoked: boolean
  /** Inclusive Unix time in seconds. */
  authorizedAt: number
  nonce: string
}

export interface RootControlAuthorizationV1 extends RootControlAuthorizationInputV1 {
  domain: typeof ROOT_CONTROL_AUTHORIZATION_DOMAIN
  subject: AukoraId
  predecessorControlDigest: RootControlDigest
  predecessorRootKeySetId: RootKeySetId
  nextRootKeySetId: RootKeySetId
  nonce: RootControlNonce
}

export interface SignedRootControlPromotionV1 {
  domain: typeof SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN
  suite: AumlokRootControlSuite
  authorization: RootControlAuthorizationV1
  signatures: HybridSignaturesV1
}

export type RootControlRefusalReason =
  | 'control:malformed'
  | 'control:subject-mismatch'
  | 'control:predecessor-digest-mismatch'
  | 'control:predecessor-root-mismatch'
  | 'control:predecessor-epoch-mismatch'
  | 'control:predecessor-revocation-mismatch'
  | 'control:predecessor-revoked'
  | 'control:next-key-set-id-mismatch'
  | 'control:epoch-not-next'
  | 'control:authorization-time-not-increasing'
  | 'control:rotation-key-unchanged'
  | 'control:revocation-key-changed'
  | 'control:ed25519-signature-invalid'
  | 'control:ml-dsa-65-signature-invalid'

export declare const AUMLOK_ROOT_CONTROL_SUITE: 'aumlok-ed25519-ml-dsa-65-v1'
export declare const ROOT_CONTROL_STATE_DOMAIN: 'aukora:root-control-state:v1'
export declare const ROOT_CONTROL_AUTHORIZATION_DOMAIN: 'aukora:root-control-authorization:v1'
export declare const SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN: 'aukora:signed-root-control-promotion:v1'
export declare const AUMLOK_ROOT_CONTROL_CONTEXT: 'aukora-root-control-v1'

export declare function rootKeySetId(input: unknown): RootKeySetId
export declare function createInitialIdentityControl(
  genesisInput: IdentityGenesisV1,
  input: InitialIdentityControlInputV1,
): Readonly<RootControlStateV1>
export declare function parseIdentityControlState(input: unknown): Readonly<RootControlStateV1>
export declare function identityControlDigest(input: unknown): RootControlDigest
export declare function createRootControlAuthorization(
  input: RootControlAuthorizationInputV1,
): Readonly<RootControlAuthorizationV1>
export declare function parseRootControlAuthorization(input: unknown): Readonly<RootControlAuthorizationV1>
export declare function rootControlAuthorizationBytes(input: unknown): Uint8Array
export declare function createSignedRootControlPromotion(input: {
  authorization: RootControlAuthorizationV1
  signatures: HybridSignaturesV1
}): Readonly<SignedRootControlPromotionV1>
export declare function parseSignedRootControlPromotion(input: unknown): Readonly<SignedRootControlPromotionV1>
export declare function verifyAndApplyRootControlPromotion(
  currentInput: unknown,
  promotionInput: unknown,
): Readonly<
  | { ok: true, state: Readonly<RootControlStateV1>, controlDigest: RootControlDigest }
  | { ok: false, reason: RootControlRefusalReason }
>
