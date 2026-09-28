import type { AukoraId } from '../identity/genesis.mjs'
import type {
  ActivationDigest,
  ControlHistoryDigest,
  DelegationClaimDigest,
  DelegationBudgetsV1,
} from '../identity/delegation.mjs'

export declare const AUTHORITY_EVIDENCE_DOMAIN: 'aukora:aura-authority-evidence:v1'
export declare const AUTHORITY_EVIDENCE_DIRECTORY: 'authority-evidence'
export declare const AUTHORITY_EVIDENCE_KEYS: readonly string[]
export declare const AUTHORITY_EVIDENCE_REFUSE: Readonly<{
  DIRECTORY_MALFORMED: 'authority-evidence:directory-malformed'
  ENTRY_MALFORMED: 'authority-evidence:entry-malformed'
  UNKNOWN_AURA_ENTRY: 'authority-evidence:unknown-aura-entry'
  ALREADY_EXISTS: 'authority-evidence:already-exists'
  UNAVAILABLE: 'authority-evidence:unavailable'
  MISMATCH: 'authority-evidence:mismatch'
}>

export interface AuthorityEvidenceV1 {
  domain: typeof AUTHORITY_EVIDENCE_DOMAIN
  auraChainHash: string
  grantDomain: 'aukora:tool-grant:v5'
  subject: AukoraId
  parentDigest: DelegationClaimDigest
  delegationDigest: DelegationClaimDigest
  controlDigest: ControlHistoryDigest
  activationDigest: ActivationDigest
  audience: string
  resource: string
  budget: Readonly<DelegationBudgetsV1>
  authorizationDigest: string
}

export interface AuthorityProjectionV5 extends Omit<AuthorityEvidenceV1, 'domain' | 'auraChainHash'> {}

export declare function createAuthorityEvidence(params: {
  auraChainHash: string
  authority: unknown
}): Readonly<AuthorityEvidenceV1>
export declare function readAuthorityEvidence(value: unknown): Readonly<AuthorityEvidenceV1>
export declare function authorityEvidencePath(stateDir: string, auraChainHash: string): string
export declare function writeAuthorityEvidence(params: {
  stateDir: string
  auraChainHash: string
  authority: unknown
}): {path: string, record: Readonly<AuthorityEvidenceV1>}
export declare function verifyAuthorityEvidence(params: {
  stateDir: string
  auraChainHash: string
  authority: unknown
}): {ok: true} | {ok: false, reason: string}
export declare function verifyAuthorityEvidenceDirectory(params: {
  stateDir: string
  auraChainHashes: ReadonlySet<string>
}): {ok: true, count: number} | {ok: false, reason: string}
