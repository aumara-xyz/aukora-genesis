import type { Branded } from '@deepseek-ai/dsh-brand'

export type AukoraId = Branded<'AukoraId'>
export type IdentityGenesisNonce = Branded<'IdentityGenesisNonce'>
export type RootKeySetId = Branded<'RootKeySetId'>
export type AmendmentRuleDigest = Branded<'AmendmentRuleDigest'>

export interface IdentityGenesisInputV1 {
  genesisNonce: string
  initialRootKeySetId: string
  amendmentRuleDigest: string
}

export interface IdentityGenesisV1 extends IdentityGenesisInputV1 {
  domain: typeof IDENTITY_GENESIS_DOMAIN
  genesisNonce: IdentityGenesisNonce
  initialRootKeySetId: RootKeySetId
  amendmentRuleDigest: AmendmentRuleDigest
}

export declare const IDENTITY_GENESIS_DOMAIN: 'aukora:identity-genesis:v1'
export declare const AUKORA_ID_PREFIX: 'aukora:1:'

export declare function createIdentityGenesis(input: unknown): Readonly<IdentityGenesisV1>
export declare function parseIdentityGenesis(input: unknown): Readonly<IdentityGenesisV1>
export declare function aukoraIdFromGenesis(input: unknown): AukoraId
