import type { AumlokContactIdentity, AumlokIdentity } from './identity.ts'

interface IdentityRoots {
  stateDir?: string
  controllerDir: string | undefined
}

interface Bootstrap {
  readMessagesIdentity(roots: IdentityRoots): Promise<AumlokIdentity>
  ensureMessagesIdentity(roots: IdentityRoots): Promise<AumlokIdentity>
}

const qrImages = new Map<string, { image: Promise<string | null>; expires: number }>()
const qrScript = `
ObjC.import('AppKit')
ObjC.import('CoreImage')
function run(argv) {
  const filter = $.CIFilter.filterWithName('CIQRCodeGenerator')
  filter.setValueForKey($(argv[0]).dataUsingEncoding($.NSUTF8StringEncoding), 'inputMessage')
  filter.setValueForKey($('M'), 'inputCorrectionLevel')
  const image = filter.outputImage
  const context = $.CIContext.contextWithOptions($.NSDictionary.dictionary)
  const bitmap = $.NSBitmapImageRep.alloc.initWithCGImage(context.createCGImageFromRect(image, image.extent))
  return ObjC.unwrap(bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).base64EncodedStringWithOptions(0))
}`

async function contactQr(payload: string): Promise<string | null> {
  const cached = qrImages.get(payload)
  if (cached && Date.now() < cached.expires) return cached.image
  // Core Image is supplied by the desktop OS; public contact data never leaves this machine.
  const image = (async () => {
    const specifier = 'node:child_process'
    const child = await import(/* @vite-ignore */ specifier) as {
      execFile(file: string, args: string[], options: { timeout: number; maxBuffer: number },
        callback: (error: unknown, stdout: string) => void): unknown
    }
    return await new Promise<string | null>(resolve => {
      child.execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', qrScript, payload],
        { timeout: 5000, maxBuffer: 256_000 }, (error, stdout) => {
          const data = stdout?.trim()
          resolve(!error && data?.startsWith('iVBORw0KGgo') && /^[A-Za-z0-9+/]+={0,2}$/u.test(data)
            ? `data:image/png;base64,${data}` : null)
        })
    })
  })().catch(() => null)
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
