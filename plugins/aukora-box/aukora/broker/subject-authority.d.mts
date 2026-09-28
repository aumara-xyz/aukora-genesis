import type { AukoraId } from '../identity/genesis.mjs'
import type {
  ActivationDigest,
  ControlHistoryDigest,
  DelegationClaimDigest,
  DelegationClaimV1,
} from '../identity/delegation.mjs'

export interface SubjectAuthorityContextInput {
  subject: string
  activeControlDigest: string
  activationDigest: string
  audience: string
  parentDelegationClaim: DelegationClaimV1
  delegationClaim: DelegationClaimV1
}

export interface SubjectAuthorityExpectationInput {
  subject: string
  activeControlDigest: string
  activationDigest: string
  audience: string
}

export interface SubjectAuthorityExpectation {
  subject: AukoraId
  activeControlDigest: ControlHistoryDigest
  activationDigest: ActivationDigest
  audience: string
}

export interface SubjectAuthorityContext {
  subject: AukoraId
  activeControlDigest: ControlHistoryDigest
  activationDigest: ActivationDigest
  audience: string
  parentDigest: DelegationClaimDigest
  delegationDigest: DelegationClaimDigest
  parentDelegationClaim: DelegationClaimV1
  delegationClaim: DelegationClaimV1
}

export declare function createSubjectAuthorityContext(input: unknown): Readonly<SubjectAuthorityContext>
export declare function createSubjectAuthorityExpectation(input: unknown): Readonly<SubjectAuthorityExpectation>
export declare function encodeSubjectAuthorityContext(input: unknown): string
export declare function decodeSubjectAuthorityContext(encoded: unknown): Readonly<SubjectAuthorityContext>
export declare function encodeSubjectAuthorityExpectation(input: unknown): string
export declare function decodeSubjectAuthorityExpectation(encoded: unknown): Readonly<SubjectAuthorityExpectation>
