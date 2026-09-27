/** On-disk domain for disposable recovery identities. Never `local-control.json`. */
export declare const DISPOSABLE_RECOVERY_DOMAIN: 'aukora:disposable-recovery-control:v2'

/** Honest custody label: encryption changes nothing about the executing UID. */
export declare const DISPOSABLE_RECOVERY_CUSTODY_CLASS: 'same-uid-posix-mode-only'

/** What a recovered handle permits and denies, stated as data. */
export declare const DISPOSABLE_RECOVERY_GRANT: Readonly<{
  readonly permits: readonly string[]
  readonly denies: readonly string[]
}>

/** Named disposable-recovery failures. */
export declare const DISPOSABLE_RECOVERY_REFUSE: Readonly<Record<string, string>>

/** Public enrollment facts. No phrase, secret, or private key. */
export type DisposableEnrollment = Readonly<{
  aukoraId: string
  directory: string
}>

/** Public identity view. Secrets are never returned. */
export type DisposablePublicView = Readonly<{
  aukoraId: string
  genesis: unknown
  activeControl: unknown
}>

/** Dual-suite public keys from the control head. Public by nature. */
export type DisposablePublicKeys = Readonly<{
  ed25519: string
  mlDsa65: string
}>

/**
 * Recovered handle. Carries continuity proof as public facts plus the one
 * authorized action's scope. No signing, approval, minting, or
 * issuer-contact surface exists on it.
 */
export type DisposableRecoveryHandle = Readonly<{
  aukoraId: string
  subject: string
  publicKeys: DisposablePublicKeys
  recoveryGrant: Readonly<{
    readonly permits: readonly string[]
    readonly denies: readonly string[]
  }>
}>

/**
 * Enroll one disposable identity. Returns public facts only and refuses an
 * occupied directory.
 */
export declare function enrollDisposableIdentity(params: {
  readonly directory: string
  readonly phrase: string
  readonly corpus?: unknown
}): DisposableEnrollment

/**
 * Open the public view of an enrolled identity. Secrets are never returned.
 */
export declare function openDisposableIdentity(directory: string): DisposablePublicView

/**
 * Recover the identical identity from its phrase. Wrong phrases refuse
 * without changing stored bytes.
 */
export declare function recoverDisposableIdentity(directory: string, phrase: string): DisposableRecoveryHandle

/**
 * Verify a rotation publication settled: same identity, changed envelope.
 * Anything else after the commit point is indeterminate.
 */
export declare function assertRotationSettled(params: {
  readonly beforeAukoraId: string
  readonly beforeEnvelope: string
  readonly afterView: { readonly aukoraId: string }
  readonly afterRecord: { readonly recoveryEnvelope: unknown }
}): void

/**
 * Rewrap recovery material under a new phrase. The identity is unchanged
 * and the old phrase dies.
 */
export declare function rotateRecoveryPhrase(
  directory: string,
  oldPhrase: string,
  newPhrase: string,
): DisposableEnrollment
