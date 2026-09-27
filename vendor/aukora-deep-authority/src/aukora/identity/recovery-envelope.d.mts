/** Envelope version this module reads and produces. */
export declare const RECOVERY_ENVELOPE_VERSION: 1

/** Named envelope failures. */
export declare const RECOVERY_ENVELOPE_REFUSE: Readonly<Record<string, string>>

/** Pinned version-1 KDF parameters. A parameter change requires a new version. */
export declare const RECOVERY_KDF_V1: RecoveryKdfV1
export type RecoveryKdfV1 = Readonly<{
  name: 'scrypt'
  N: number
  r: number
  p: number
  keyLength: number
}>

/** Versioned envelope record carrying a wrapped recovery secret. */
export type RecoveryEnvelopeV1 = Readonly<{
  version: 1
  kdf: RecoveryKdfV1
  salt: string
  nonce: string
  ciphertext: string
}>

/**
 * Wrap a separately random 32-byte recovery secret under a phrase with
 * scrypt plus AES-256-GCM. Never a signing key.
 */
export declare function wrapRecoverySecret(params: {
  readonly secret: Uint8Array
  readonly phrase: string
}): RecoveryEnvelopeV1

/**
 * Unwrap the recovery secret. Wrong phrases and tampered envelopes share
 * one content-free `recovery-envelope:unlock-failed` refusal.
 */
export declare function unwrapRecoverySecret(params: {
  readonly envelope: unknown
  readonly phrase: string
}): Buffer
