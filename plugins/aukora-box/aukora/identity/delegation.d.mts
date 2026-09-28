import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AukoraId } from './genesis.mjs'

export type DelegationKind = 'root' | 'device' | 'session' | 'agent'
export type DelegationClaimDigest = Branded<'DelegationClaimDigest'>
export type ControlHistoryDigest = Branded<'ControlHistoryDigest'>
export type DelegationKeyId = Branded<'DelegationKeyId'>
export type ActivationDigest = Branded<'ActivationDigest'>
export type DelegationRevocationId = Branded<'DelegationRevocationId'>
export type DelegationNonce = Branded<'DelegationNonce'>
export type DelegationRefusalReason =
  | 'delegation:malformed'
  | 'delegation:subject-mismatch'
  | 'delegation:control-mismatch'
  | 'delegation:parent-mismatch'
  | 'delegation:role-transition-invalid'
  | 'delegation:operation-widened'
  | 'delegation:resource-widened'
  | 'delegation:audience-widened'
  | 'delegation:activation-widened'
  | 'delegation:budget-calls-widened'
  | 'delegation:budget-bytes-widened'
  | 'delegation:budget-computeMs-widened'
  | 'delegation:budget-costMicrounits-widened'
  | 'delegation:time-widened'
  | 'delegation:not-attenuated'

export interface DelegationBudgetsV1 {
  calls: number
  bytes: number
  computeMs: number
  costMicrounits: number
}

export interface DelegationClaimInputV1 {
  subject: string
  kind: DelegationKind
  parentDigest: string | null
  controlDigest: string
  childKeyId: string
  operations: readonly string[]
  resources: readonly string[]
  audiences: readonly string[]
  activationDigests: readonly string[]
  budgets: Readonly<DelegationBudgetsV1>
  /** Inclusive Unix time in seconds. */
  notBefore: number
  /** Exclusive Unix time in seconds. */
  expiresAt: number
  revocationId: string
  nonce: string
}

export interface DelegationClaimV1 extends DelegationClaimInputV1 {
  domain: typeof DELEGATION_CLAIM_DOMAIN
  subject: AukoraId
  parentDigest: DelegationClaimDigest | null
  controlDigest: ControlHistoryDigest
  childKeyId: DelegationKeyId
  operations: readonly string[]
  resources: readonly string[]
  audiences: readonly string[]
  activationDigests: readonly ActivationDigest[]
  budgets: Readonly<DelegationBudgetsV1>
  revocationId: DelegationRevocationId
  nonce: DelegationNonce
}

export declare const DELEGATION_CLAIM_DOMAIN: 'aukora:delegation-claim:v1'

export declare function createDelegationClaim(input: unknown): Readonly<DelegationClaimV1>
export declare function parseDelegationClaim(input: unknown): Readonly<DelegationClaimV1>
export declare function delegationClaimDigest(input: unknown): DelegationClaimDigest
export declare function verifyDelegationAttenuation(
  parent: unknown,
  child: unknown,
  expected: unknown,
): Readonly<
  { ok: true, childDigest: DelegationClaimDigest }
  | { ok: false, reason: DelegationRefusalReason }
>
