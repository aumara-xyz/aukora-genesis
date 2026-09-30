import { qrcodegen } from './vendor/qrcodegen/qrcodegen.ts'
import type { AumlokIdentity, LiveContactProof } from './identity.ts'

/** Contact labels always come from the binding handle. */
export function contactPayload(identity: AumlokIdentity, live?: LiveContactProof): string {
  return JSON.stringify({ type: 'aukora-contact', version: 1, npub: identity.npub,
    peerControllerKey: identity.peerControllerKey ?? '', binding: identity.binding, label: identity.label,
    ...(live ? { live } : {}) })
}

/** A domain-separated Nostr event, reconstructed instead of duplicating the contact in the QR. */
export function liveContactEvent(contact: string, proof: Pick<LiveContactProof, 'nonce' | 'issuedAt' | 'expiresAt'>,
  pubkey: string): { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string } {
  return { pubkey, created_at: proof.issuedAt, kind: 20001,
    tags: [['d', 'aukora:contact-live:v1'], ['nonce', proof.nonce], ['expiration', String(proof.expiresAt)]],
    content: contact }
}

// The screen and exported PNG share standard dark modules and a light quiet zone.
export function contactQrDataUrl(payload: string): string {
  const qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.QUARTILE)
  const border = 4
  const size = qr.size + border * 2
  const modules: string[] = []
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) modules.push(`M${x + border},${y + border}h1v1h-1z`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#f4f3f8"/><path d="${modules.join('')}" fill="#151322"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
