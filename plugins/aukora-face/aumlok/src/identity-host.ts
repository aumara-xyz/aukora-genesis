import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { checkNpub } from '@aukora/face-messages/src/client/add-contact.ts'
import { IDENTITY_CONTACT_ENDPOINT, type AumlokContactIdentity, type AumlokIdentity } from './identity.ts'
import { contactQrDataUrl, contactPayload, liveContactEvent } from './contact-qr.ts'
import { identityJsonPostRoute } from './contact-verification.ts'

interface IdentityRoots {
  stateDir?: string
  controllerDir: string | undefined
}

interface Bootstrap {
  readMessagesIdentity(roots: IdentityRoots): Promise<AumlokIdentity>
  ensureMessagesIdentity(roots: IdentityRoots): Promise<AumlokIdentity>
}

/** Host-only imports share the release's pinned Nostr implementation and configured state root. */
export async function identityRuntime(controllerDir?: string): Promise<{
  roots: IdentityRoots & { stateDir: string }; moduleBase: string; bootstrap: Bootstrap
}> {
  const processSpecifier = 'node:process'
  const { env } = await import(/* @vite-ignore */ processSpecifier) as { env: Record<string, string | undefined> }
  const pathSpecifier = 'node:path'
  const { resolve } = await import(/* @vite-ignore */ pathSpecifier) as { resolve(...parts: string[]): string }
  const stateDir = env['DSH_HOME']?.trim()
    || (env['AUKORA_SUPPORT_ROOT']?.trim() ? resolve(env['AUKORA_SUPPORT_ROOT']!, 'state', 'home') : '')
  if (!stateDir) throw new Error('identity:state-unconfigured')
  const contactModule = env['AUKORA_NOSTR_CONTACT_MODULE']?.trim()
  const moduleBase = contactModule ? contactModule.replace(/contact\.mjs$/u, '')
    : new URL('../../../aukora-nostr/lib/', import.meta.url).href
  const bootstrap = await import(/* @vite-ignore */ `${moduleBase}bootstrap.mjs`) as Bootstrap
  return { roots: { controllerDir, stateDir: resolve(stateDir) }, moduleBase, bootstrap }
}

const qrImages = new Map<string, { image: Promise<string | null>; expires: number }>()

async function contactQr(payload: string): Promise<string | null> {
  const cached = qrImages.get(payload)
  if (cached && Date.now() < cached.expires) return cached.image
  const image = Promise.resolve().then(() => {
    return contactQrDataUrl(payload)
  }).catch(() => null)
  const entry = { image, expires: Infinity }
  qrImages.set(payload, entry)
  if (qrImages.size > 4) qrImages.delete(qrImages.keys().next().value!)
  const result = await image
  if (!result) entry.expires = Date.now() + 30_000
  return result
}

export async function readIdentity(controllerDir: string | undefined): Promise<AumlokContactIdentity> {
  const { roots, bootstrap } = await identityRuntime(controllerDir)
  const identity = await bootstrap.readMessagesIdentity(roots)
  if (identity.subject && !identity.binding) {
    // Rendering never waits for the signer. Its shared lifecycle deduplicates both faces and refusals.
    void bootstrap.ensureMessagesIdentity(roots).catch(() => {})
  }
  const contact = contactPayload(identity)
  return { ...identity, contact, qrDataUrl: await contactQr(contact) }
}

/** Only the local Nostr contact key signs this short-lived contact; the Aumlok/root keys never do. */
export async function issueIdentityContact(controllerDir: string | undefined,
  input: { npub: string; subject: string | null }): Promise<AumlokContactIdentity> {
  if (!checkNpub(input.npub).ok) throw new Error('identity:invalid-contact')
  const { roots, moduleBase, bootstrap } = await identityRuntime(controllerDir)
  const identity = await bootstrap.readMessagesIdentity(roots)
  if (identity.npub !== input.npub || identity.subject !== input.subject) throw new Error('identity:identity-changed')
  const { loadOrCreateNostrKey } = await import(/* @vite-ignore */ `${moduleBase}identity.mjs`) as {
    loadOrCreateNostrKey(stateDir: string): { npub: string; xonlyHex: string; secretKeyHex: string }
  }
  const { signEvent } = await import(/* @vite-ignore */ `${moduleBase}event.mjs`) as {
    signEvent(event: ReturnType<typeof liveContactEvent>, secretKey: string): { sig: string }
  }
  const cryptoSpecifier = 'node:crypto'
  const { randomBytes } = await import(/* @vite-ignore */ cryptoSpecifier) as { randomBytes(size: number): { toString(encoding: string): string } }
  const key = loadOrCreateNostrKey(roots.stateDir)
  if (key.npub !== identity.npub) throw new Error('identity:identity-changed')
  const issuedAt = Math.floor(Date.now() / 1000)
  const proof = { nonce: randomBytes(32).toString('hex'), issuedAt, expiresAt: issuedAt + 60 }
  const event = liveContactEvent(contactPayload(identity), proof, key.xonlyHex)
  const live = { ...proof, signature: signEvent(event, key.secretKeyHex).sig }
  const contact = contactPayload(identity, live)
  return { ...identity, contact, qrDataUrl: await contactQr(contact), expiresAt: proof.expiresAt * 1000 }
}

export function identityContactIssueRoute(fence: (request: { readonly headers: unknown }) => number | undefined,
  directory: () => string | undefined): WebRoute {
  return identityJsonPostRoute(IDENTITY_CONTACT_ENDPOINT, fence, async raw => {
    let input: unknown
    try { input = JSON.parse(raw) } catch { throw new Error('identity:invalid-contact') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('identity:invalid-contact')
    const value = input as Record<string, unknown>
    if (Object.keys(value).sort().join(',') !== 'npub,subject'
      || typeof value.npub !== 'string'
      || (value.subject !== null && typeof value.subject !== 'string')) throw new Error('identity:invalid-contact')
    return issueIdentityContact(directory(), { npub: value.npub, subject: value.subject })
  })
}
