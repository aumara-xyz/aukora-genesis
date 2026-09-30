export const AUMLOK_IDENTITY_ENDPOINT = '/api/aukora/aumlok-identity'
export const IDENTITY_VERIFY_CONTACT_ENDPOINT = '/api/aukora/identity/verify-contact'
export const IDENTITY_CONTACT_ENDPOINT = '/api/aukora/identity/contact'

export interface LiveContactProof {
  readonly nonce: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly signature: string
}

export interface VerifiedIdentityContact {
  readonly npub: string
  readonly controller: string
  readonly subject: string
  readonly label: string
  /** Preserve the binding resolver's ceiling; a local scan does not promote TEST or BOUND. */
  readonly bindingState: 'TEST' | 'BOUND' | 'VERIFIED'
  /** A scanned signed QR is not a verifier-initiated live device challenge. */
  readonly liveChallengePerformed: false
  readonly nonce: string
  /** Unix milliseconds, for withholding an expired confirmation in the scanner. */
  readonly expiresAt: number
}

export interface AumlokIdentity {
  readonly npub: string
  readonly subject: string | null
  readonly label: string
  readonly peerControllerKey: string | null
  readonly binding: Record<string, unknown> | null
}

export interface AumlokContactIdentity extends AumlokIdentity {
  readonly contact: string
  readonly qrDataUrl: string | null
  /** Present only on a freshly signed contact; Unix milliseconds. */
  readonly expiresAt?: number
}
