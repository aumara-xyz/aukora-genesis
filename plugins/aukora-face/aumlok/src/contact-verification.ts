import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { parseContactInput } from '@aukora/face-messages/src/client/add-contact.ts'
import { IDENTITY_VERIFY_CONTACT_ENDPOINT, type LiveContactProof, type VerifiedIdentityContact } from './identity.ts'
import { contactPayload, liveContactEvent } from './contact-qr.ts'
import { identityRuntime } from './identity-host.ts'

interface ContactResolver {
  resolveContact(input: { npub: string; peerControllerKey: string; binding: Readonly<Record<string, unknown>> }): {
    binding: string; state: string; npub: string; subject: string | null; controllerKeyHex: string | null
  }
}

interface ReplayStore {
  mkdirSync(path: string, options: { recursive: boolean; mode: number }): unknown
  readdirSync(path: string): string[]
  readFileSync(path: string, encoding: string): string
  unlinkSync(path: string): void
  writeFileSync(path: string, value: string, options: { flag: string; mode: number }): void
}

async function consumeContactNonce(stateDir: string, pubkey: string, proof: LiveContactProof): Promise<void> {
  const fsSpecifier = 'node:fs'
  const fs = await import(/* @vite-ignore */ fsSpecifier) as ReplayStore
  const directory = `${stateDir}/identity/contact-nonces`
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const now = Math.floor(Date.now() / 1000)
  if (proof.issuedAt > now || proof.expiresAt <= now) throw new Error('identity:expired-contact')
  // Expired records can be discarded: their signatures can no longer pass the freshness gate.
  // Exclusive creation makes replay refusal survive host restarts and concurrent scanner windows.
  for (const file of fs.readdirSync(directory)) {
    if (!/^[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(file)) continue
    try {
      const expiry = JSON.parse(fs.readFileSync(`${directory}/${file}`, 'utf8')) as unknown
      if (typeof expiry === 'number' && expiry <= now) fs.unlinkSync(`${directory}/${file}`)
    } catch { /* An unreadable marker stays spent rather than reopening a replay. */ }
  }
  try {
    fs.writeFileSync(`${directory}/${pubkey}-${proof.nonce}.json`, JSON.stringify(proof.expiresAt), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'EEXIST') throw new Error('identity:replayed-contact')
    throw error
  }
}

/** Authenticate the binding AND the fresh Nostr proof before releasing the contact's name. */
export async function verifyIdentityContact(raw: string): Promise<VerifiedIdentityContact> {
  const contact = parseContactInput(raw)
  if (!contact.ok || contact.source !== 'qr' || !contact.binding || !contact.controller) {
    throw new Error('identity:invalid-contact')
  }
  let proof: LiveContactProof
  try { proof = (JSON.parse(raw) as { live: LiveContactProof }).live } catch { throw new Error('identity:invalid-contact') }
  if (!proof || proof.expiresAt - proof.issuedAt !== 60) throw new Error('identity:invalid-contact')
  const now = Math.floor(Date.now() / 1000)
  if (proof.issuedAt > now || proof.expiresAt <= now) throw new Error('identity:expired-contact')
  const { roots, moduleBase } = await identityRuntime()
  const { resolveContact } = await import(/* @vite-ignore */ `${moduleBase}contact.mjs`) as ContactResolver
  const verified = resolveContact({ npub: contact.npub,
    peerControllerKey: contact.controller, binding: contact.binding })
  if (verified.binding !== 'verified'
    || (verified.state !== 'TEST' && verified.state !== 'BOUND' && verified.state !== 'VERIFIED')
    || verified.npub !== contact.npub || !verified.subject || !/^aukora:1:[0-9a-f]{64}$/u.test(verified.subject)
    || verified.controllerKeyHex !== contact.controller) {
    throw new Error('identity:invalid-contact')
  }
  const { npubDecode } = await import(/* @vite-ignore */ `${moduleBase}identity.mjs`) as { npubDecode(npub: string): string }
  const { eventId, verifyEvent } = await import(/* @vite-ignore */ `${moduleBase}event.mjs`) as {
    eventId(event: ReturnType<typeof liveContactEvent>): string
    verifyEvent(event: ReturnType<typeof liveContactEvent> & { id: string; sig: string }): true
  }
  const pubkey = npubDecode(contact.npub)
  const unsigned = contactPayload({ npub: contact.npub, peerControllerKey: contact.controller,
    subject: verified.subject, binding: contact.binding, label: contact.label })
  const event = liveContactEvent(unsigned, proof, pubkey)
  try { verifyEvent({ ...event, id: eventId(event), sig: proof.signature }) }
  catch { throw new Error('identity:invalid-contact') }
  await consumeContactNonce(roots.stateDir, pubkey, proof)
  // This is only a local observation. A future vouch MUST require the scanned person's device to
  // sign a verifier-generated fresh nonce live; a photographed QR must never authorize a vouch.
  return { npub: contact.npub, controller: contact.controller, subject: verified.subject, label: contact.label,
    bindingState: verified.state, liveChallengePerformed: false, nonce: proof.nonce, expiresAt: proof.expiresAt * 1000 }
}

export function identityContactVerificationRoute(
  fence: (request: { readonly headers: unknown }) => number | undefined,
): WebRoute {
  return identityJsonPostRoute(IDENTITY_VERIFY_CONTACT_ENDPOINT, fence, verifyIdentityContact)
}

export function identityJsonPostRoute(path: string,
  fence: (request: { readonly headers: unknown }) => number | undefined,
  action: (raw: string) => Promise<unknown>,
): WebRoute {
  return {
    kind: 'exact', path,
    handler: async (req, res) => {
      const reply = (status: number, body: unknown): void => {
        res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff' })
        res.end(JSON.stringify(body))
      }
      const rejection = fence(req)
      if (rejection !== undefined) { reply(rejection, null); return }
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); reply(405, null); return }
      // A JSON content type prevents simple cross-origin form requests; the normal auth fence runs first.
      if (!/^application\/json(?:\s*;|$)/iu.test(String(req.headers['content-type'] ?? ''))) {
        reply(415, null); return
      }
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true })
        let raw = ''
        let length = 0
        for await (const chunk of req) {
          const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk as Uint8Array
          length += bytes.byteLength
          if (length > 64 * 1024) { reply(413, null); return }
          raw += decoder.decode(bytes, { stream: true })
        }
        raw += decoder.decode()
        reply(200, await action(raw))
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        const invalid = ['identity:invalid-contact', 'identity:expired-contact', 'identity:replayed-contact'].includes(code)
        const changed = ['identity:identity-changed', 'identity:binding-unavailable'].includes(code)
        reply(invalid ? 400 : changed ? 409 : 503, { code: invalid || changed ? code : 'identity:verification-unavailable' })
      }
    },
  }
}
