import { checkNpub } from '@aukora/face-messages/src/client/add-contact.ts'
import type { VerifiedIdentityContact } from '../identity.ts'

/** Future vouch/invite graph hook. This records an unsigned, device-local observation only.
 * A vouch must require the scanned person's device to sign a verifier's fresh nonce live;
 * a photograph of this contact QR never authorizes a vouch.
 */
export function recordLocalInPersonVerification(verifierNpub: string, peer: VerifiedIdentityContact): void {
  if (!checkNpub(verifierNpub).ok || !checkNpub(peer.npub).ok || verifierNpub === peer.npub) {
    throw new Error('identity:invalid-verification')
  }
  if (!Number.isFinite(peer.expiresAt) || Date.now() >= peer.expiresAt) throw new Error('identity:expired-contact')
  const key = `aukora:identity:verified-in-person:v1:${verifierNpub}:${peer.npub}`
  const previous = localStorage.getItem(key)
  if (previous !== null) {
    const known = JSON.parse(previous) as Record<string, unknown>
    if (known.peerNpub !== peer.npub || known.peerControllerKey !== peer.controller || known.subject !== peer.subject) {
      throw new Error('identity:verification-conflict')
    }
  }
  const value = JSON.stringify({ kind: 'local-verified-in-person', version: 1,
    verifierNpub, peerNpub: peer.npub, peerControllerKey: peer.controller, subject: peer.subject,
    handle: peer.label, bindingState: peer.bindingState, nonce: peer.nonce, expiresAt: peer.expiresAt,
    liveChallengePerformed: false, observedAt: new Date().toISOString() })
  localStorage.setItem(key, value)
  if (localStorage.getItem(key) !== value) throw new Error('identity:verification-not-saved')
}


function avatarStorageKey(npub: string): string {
  if (!checkNpub(npub).ok) throw new Error('identity:invalid-npub')
  return `aukora:identity:avatar:v1:${npub}`
}

/** Future public/private avatar setting hook; pictures currently stay on this device only. */
export function localAvatarVisibilityForFutureSharing(): 'private' { return 'private' }

export function readLocalAvatar(npub: string): string | null {
  const value = localStorage.getItem(avatarStorageKey(npub))
  if (value !== null && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(value) || value.length > 400_000)) {
    throw new Error('identity:avatar-unreadable')
  }
  return value
}

export function removeLocalAvatar(npub: string): void {
  const key = avatarStorageKey(npub)
  localStorage.removeItem(key)
  if (localStorage.getItem(key) !== null) throw new Error('identity:avatar-not-removed')
}

export async function saveLocalAvatar(npub: string, file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error('identity:avatar-invalid')
  }
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('identity:avatar-invalid')
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('identity:avatar-unavailable')
    const edge = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 256, 256)
    const value = canvas.toDataURL('image/png')
    if (value.length > 400_000) throw new Error('identity:avatar-too-large')
    const key = avatarStorageKey(npub)
    localStorage.setItem(key, value)
    if (localStorage.getItem(key) !== value) throw new Error('identity:avatar-not-saved')
    return value
  } finally { bitmap.close() }
}
