import type { SignedWebActivationUpgrade } from './web-upgrade-record.mjs'

export interface WebActivationRollback {
  readonly domain: typeof WEB_ROLLBACK_DOMAIN
  readonly upgradeOperationSha256: string
  readonly previousBindingSha256: string
  readonly previousActivation: string
  readonly subject: string
  readonly controlDigest: string
  readonly receiptKeyId: string
  readonly storeDigest: string
  readonly nonce: string
  readonly issuedAt: number
  readonly expiresAt: number
}

export interface WebActivationRollbackBundle {
  readonly domain: typeof WEB_ROLLBACK_BUNDLE_DOMAIN
  readonly previousBinding: string
  readonly upgrade: SignedWebActivationUpgrade
  readonly rollback: Readonly<{
    domain: typeof SIGNED_WEB_ROLLBACK_DOMAIN
    operation: WebActivationRollback
    signatures: Readonly<{ ed25519: string; mlDsa65: string }>
  }>
}

export declare const WEB_ROLLBACK_DOMAIN: 'aukora:web-activation-rollback:v1'
export declare const WEB_ROLLBACK_SIGNATURE_DOMAIN: 'aukora:web-activation-rollback-signature:v1'
export declare const SIGNED_WEB_ROLLBACK_DOMAIN: 'aukora:signed-web-activation-rollback:v1'
export declare const WEB_ROLLBACK_BUNDLE_DOMAIN: 'aukora:web-activation-rollback-bundle:v1'
export declare const MAX_WEB_ROLLBACK_BUNDLE_BYTES: number
export declare function parseWebRollback(value: unknown): Readonly<WebActivationRollback>
export declare function createWebActivationRollback(upgradeInput: unknown, previousBinding: string): Readonly<WebActivationRollback>
export declare function webRollbackBytes(operation: unknown): Buffer
export declare function verifyWebRollbackBundle(value: unknown, controlInput: unknown): Readonly<WebActivationRollbackBundle>
