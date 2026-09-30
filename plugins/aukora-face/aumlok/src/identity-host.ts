import type { AumlokContactIdentity, AumlokIdentity } from './identity.ts'
import { qrcodegen } from './vendor/qrcodegen/qrcodegen.ts'

interface IdentityRoots {
  stateDir?: string
  controllerDir: string | undefined
}

interface Bootstrap {
  readMessagesIdentity(roots: IdentityRoots): Promise<AumlokIdentity>
  ensureMessagesIdentity(roots: IdentityRoots): Promise<AumlokIdentity>
}

const qrImages = new Map<string, { image: Promise<string | null>; expires: number }>()

async function contactQr(payload: string): Promise<string | null> {
  const cached = qrImages.get(payload)
  if (cached && Date.now() < cached.expires) return cached.image
  const image = Promise.resolve().then(() => {
    const qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.MEDIUM)
    const border = 4
    const size = qr.size + border * 2
    const modules: string[] = []
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) modules.push(`M${x + border},${y + border}h1v1h-1z`)
      }
    }
    // Only numeric module coordinates enter the SVG; contact text never becomes markup.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${modules.join('')}" fill="#000"/></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }).catch(() => null)
  const entry = { image, expires: Infinity }
  qrImages.set(payload, entry)
  if (qrImages.size > 4) qrImages.delete(qrImages.keys().next().value!)
  const result = await image
  if (!result) entry.expires = Date.now() + 30_000
  return result
}

export async function readIdentity(controllerDir: string | undefined): Promise<AumlokContactIdentity> {
  const processSpecifier = 'node:process'
  const { env } = await import(/* @vite-ignore */ processSpecifier) as { env: Record<string, string | undefined> }
  const roots: IdentityRoots = { controllerDir }
  if (env['DSH_HOME']?.trim()) roots.stateDir = env['DSH_HOME']
  const contactModule = env['AUKORA_NOSTR_CONTACT_MODULE']?.trim()
  const bootstrapModule = contactModule
    ? `${contactModule.replace(/contact\.mjs$/u, '')}bootstrap.mjs`
    : new URL('../../../aukora-nostr/lib/bootstrap.mjs', import.meta.url).href
  const bootstrap = await import(/* @vite-ignore */ bootstrapModule) as Bootstrap
  const identity = await bootstrap.readMessagesIdentity(roots)
  if (identity.subject && !identity.binding) {
    // Rendering never waits for the signer. Its shared lifecycle deduplicates both faces and refusals.
    void bootstrap.ensureMessagesIdentity(roots).catch(() => {})
  }
  const contact = identity.binding && identity.peerControllerKey
    ? JSON.stringify({ type: 'aukora-contact', version: 1, npub: identity.npub,
      peerControllerKey: identity.peerControllerKey, binding: identity.binding, label: identity.label })
    : `nostr:${identity.npub}`
  return { ...identity, contact, qrDataUrl: await contactQr(contact) }
}
