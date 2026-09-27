import type { ActivationStatementV1 } from './statement.mjs'

export interface WebActivationUpgrade {
  readonly domain: typeof WEB_UPGRADE_DOMAIN
  readonly previousActivation: string
  readonly previousBindingSha256: string
  readonly nextStatement: Readonly<ActivationStatementV1>
  readonly subject: string
  readonly controlDigest: string
  readonly receiptKeyId: string
  readonly storeDigest: string
  readonly nonce: string
  readonly issuedAt: number
  readonly expiresAt: number
}

export interface SignedWebActivationUpgrade {
  readonly domain: typeof UPGRADED_BINDING_DOMAIN
  readonly operation: WebActivationUpgrade
  readonly signatures: Readonly<{ ed25519: string; mlDsa65: string }>
}

export declare const WEB_UPGRADE_DOMAIN: 'aukora:web-activation-upgrade:v1'
export declare const WEB_UPGRADE_SIGNATURE_DOMAIN: 'aukora:web-activation-upgrade-signature:v1'
export declare const UPGRADED_BINDING_DOMAIN: 'aukora:activation-binding:upgraded-web:v1'
export declare function parseWebUpgrade(value: unknown): Readonly<WebActivationUpgrade>
export declare function webUpgradeBytes(operation: unknown): Buffer
export declare function verifyWebUpgradeRecord(value: unknown, controlInput: unknown): Readonly<WebActivationUpgrade>
export declare function parseSignedWebUpgrade(value: unknown): Readonly<SignedWebActivationUpgrade>
