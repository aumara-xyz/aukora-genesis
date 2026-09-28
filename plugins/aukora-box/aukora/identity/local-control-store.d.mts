import type { KeyObject } from 'node:crypto'
import type { RootControlDigest, RootControlStateV1 } from './control.mjs'
import type { AmendmentRuleDigest, AukoraId, IdentityGenesisV1 } from './genesis.mjs'

export interface LocalAumlokAmendmentPolicyV1 {
  domain: typeof LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN
  rootControl: 'active-hybrid-root-dual-signature'
  recovery: 'disabled'
}

export interface LocalAumlokControlRecordV1 {
  domain: typeof LOCAL_AUMLOK_CONTROL_DOMAIN
  custodyClass: typeof LOCAL_AUMLOK_CUSTODY_CLASS
  amendmentPolicy: Readonly<LocalAumlokAmendmentPolicyV1>
  genesis: IdentityGenesisV1
  activeControl: RootControlStateV1
  ed25519PrivateKeyPem: string
  mlDsa65SecretKeyHex: string
}

export interface LocalAumlokControl {
  record: Readonly<LocalAumlokControlRecordV1>
  subject: AukoraId
  activeControl: Readonly<RootControlStateV1>
  activeControlDigest: RootControlDigest
  ed25519PrivateKey: KeyObject
  ed25519PublicKeyPem: string
  mlDsa65SecretKey: Uint8Array
  path: string
  created: boolean
}

export interface LocalAumlokControlExpectation {
  subject: AukoraId
  activeControlDigest: RootControlDigest
}

export declare const LOCAL_AUMLOK_CONTROL_DOMAIN: 'aukora:local-aumlok-control:v1'
export declare const LOCAL_AUMLOK_CUSTODY_CLASS: 'same-uid-posix-mode-only'
export declare const LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN: 'aukora:local-aumlok-amendment-policy:v1'
export declare const LOCAL_AUMLOK_AMENDMENT_POLICY: Readonly<LocalAumlokAmendmentPolicyV1>
export declare const LOCAL_AUMLOK_CONTROL_FILENAME: 'local-control.json'
export declare const LOCAL_AUMLOK_CONTROL_REFUSE: Readonly<{
  DIRECTORY_MALFORMED: 'aumlok-local:directory-malformed'
  ENTRY_MALFORMED: 'aumlok-local:entry-malformed'
  EXPECTATION_MALFORMED: 'aumlok-local:expectation-malformed'
  IDENTITY_CHANGED: 'aumlok-local:identity-changed'
  POSIX_REQUIRED: 'aumlok-local:posix-required'
  UNAVAILABLE: 'aumlok-local:unavailable'
}>

export declare class LocalAumlokControlError extends Error {
  readonly code: string
}

export declare function localAumlokAmendmentRuleDigest(
  policyInput: unknown,
): AmendmentRuleDigest
export declare function localAumlokControlPath(directoryInput: string): string
export declare function loadLocalAumlokControl(
  directoryInput: string,
  expectationInput?: LocalAumlokControlExpectation,
): Readonly<LocalAumlokControl>
export declare function loadOrCreateLocalAumlokControl(
  directoryInput: string,
  expectationInput?: LocalAumlokControlExpectation,
): Readonly<LocalAumlokControl>
