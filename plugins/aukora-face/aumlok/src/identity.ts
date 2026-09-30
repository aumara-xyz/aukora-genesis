export const AUMLOK_IDENTITY_ENDPOINT = '/api/aukora/aumlok-identity'

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
}
