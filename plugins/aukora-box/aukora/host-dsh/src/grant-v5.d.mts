import type { AukoraId } from '../../identity/genesis.mjs'
import type {
  ActivationDigest,
  ControlHistoryDigest,
  DelegationClaimDigest,
  DelegationClaimV1,
} from '../../identity/delegation.mjs'

export interface ActionBudgetV5 {
  calls: number
  bytes: number
  computeMs: number
  costMicrounits: number
}

export interface AuthorizationClaimsV5 {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
  subject: AukoraId
  parentDigest: DelegationClaimDigest
  delegationDigest: DelegationClaimDigest
  controlDigest: ControlHistoryDigest
  delegationKind: 'agent'
  activationDigest: ActivationDigest
  audience: string
  resource: string
  budget: Readonly<ActionBudgetV5>
}

export interface GrantV5 extends AuthorizationClaimsV5 {
  signature: string
}

export interface GrantV5Expectation {
  grant?: unknown
  claims?: unknown
  toolName: string
  args: unknown
  rootPublicKeyPem?: string
  now: number
  expectedDefinitionId: string
  expectedOperationDigest: string
  expectedReceiptKeyId: string
  parentDelegationClaim: DelegationClaimV1
  delegationClaim: DelegationClaimV1
  expectedSubject: string
  expectedControlDigest: string
  expectedParentDigest: string
  expectedActivationDigest: string
  expectedAudience: string
  expectedResource: string
  expectedBudget: ActionBudgetV5
  seenNonces?: Set<string>
  claimNonce?: (nonce: string, exp: number) => true | false | 'malformed' | 'uncertain'
}

export declare const GRANT_DOMAIN_V5: 'aukora:tool-grant:v5'
export declare const MAX_TTL_SECONDS_V5: 3600
export declare const AUTHORIZATION_V5_CLAIM_KEYS: readonly string[]
export declare const GRANT_V5_KEYS: readonly string[]
export declare const REFUSE_V5: Readonly<Record<string, string>>
export declare function authorizationPreimageV5(claims: unknown): Buffer
export declare function authorizationDigestV5(claims: unknown): string
export declare function authorizationSignedMessageV5FromHex(digest: string): Buffer
export declare function inspectAuthorizationClaimsV5(params: GrantV5Expectation): Readonly<
  { ok: true; claims: Readonly<AuthorizationClaimsV5>; authority: Readonly<Record<string, unknown>> }
  | { ok: false; reason: string }
>
export declare function verifyIssuedGrantV5(params: GrantV5Expectation): Readonly<Record<string, unknown>>
export declare function verifyGrantV5(params: GrantV5Expectation): Readonly<Record<string, unknown>>
