/** Insert or explicitly refresh through the release's signed-binding validator and locked writer. */
import { existsSync, appendFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { messagesRefusalBody } from './messages-route.ts'
import type { MessagesRefusalReason } from './messages-route.ts'
import { resolveContactModuleSpecifier } from './contacts-store.ts'

export const MESSAGES_ADD_CONTACT_ENDPOINT = '/aukora-messages/add-contact'

export const MESSAGES_ADD_CONTACT_REFUSALS = Object.freeze({
  NPUB_INVALID: 'messages:add-npub-invalid',
  CONTROLLER_INVALID: 'messages:add-controller-invalid',
  BINDING_INVALID: 'messages:add-binding-invalid',
  NAME_INVALID: 'messages:add-name-invalid',
  BODY_UNREADABLE: 'messages:add-body-unreadable',
  ALREADY_PRESENT: 'messages:add-already-present',
  REFRESH_TARGET: 'messages:add-refresh-target',
  REFRESH_BINDING: 'messages:add-refresh-binding',
  CONTACTS_UNREADABLE: 'messages:add-contacts-unreadable',
  WRITER_ABSENT: 'messages:add-writer-absent',
  WRITE_FAILED: 'messages:add-write-failed',
})

export const MESSAGES_ADD_LEDGER = 'contacts-additions.log'

interface WrittenContact {
  readonly entry: { readonly npub: string; readonly name: string }
  readonly total: number
  readonly state: 'BOUND' | 'TEST' | 'UNBOUND'
  readonly bindingStatus: 'verified' | 'absent'
}

/** The writer imports its resolver and encoder from this same nostr tree. */
async function loadWriter(): Promise<Record<string, unknown> | undefined> {
  try {
    const specifier = resolveContactModuleSpecifier()
    const writer = resolve(dirname(specifier), '..', 'bin', 'add-contact.mjs')
    if (!existsSync(writer)) return undefined
    return (await import(pathToFileURL(writer).href)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Read the request body as text, bounded by the caller's own limit. */
async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buf.byteLength
    if (size > limit) return undefined
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Answer with a named refusal and the status that goes with it. */
function refuse(res: ServerResponse, name: MessagesRefusalReason, url: string, status = 400): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(messagesRefusalBody(name, url)))
}

/** Map writer refusals, including duplicate races decided under its lock. */
function refuseWrite(res: ServerResponse, cause: unknown, url: string): void {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  switch (code) {
    case 'nostr:add-contact-bad-npub':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.NPUB_INVALID, url); return
    case 'nostr:add-contact-bad-controller':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.CONTROLLER_INVALID, url); return
    case 'nostr:add-contact-bad-binding':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BINDING_INVALID, url); return
    case 'nostr:add-contact-already-present':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.ALREADY_PRESENT, url, 409); return
    case 'nostr:add-contact-refresh-target':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.REFRESH_TARGET, url, 409); return
    case 'nostr:add-contact-refresh-binding':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.REFRESH_BINDING, url, 409); return
    case 'nostr:add-contact-existing-unreadable':
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.CONTACTS_UNREADABLE, url, 409); return
    case 'nostr:add-contact-locked':
    case 'EEXIST':
      res.setHeader('retry-after', '1')
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITE_FAILED, url, 409); return
    default:
      refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITE_FAILED, url, 500)
  }
}

export function addContactRoute(
  admitted: (method: 'POST', req: IncomingMessage, res: ServerResponse) => boolean,
  stateDirOf: () => string,
): { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } {
  return {
    kind: 'exact',
    path: MESSAGES_ADD_CONTACT_ENDPOINT,
    handler: async (req, res) => {
      if (!admitted('POST', req, res)) return
      const url = req.url ?? MESSAGES_ADD_CONTACT_ENDPOINT

      let body: unknown
      try {
        const text = await readBody(req)
        if (text === undefined) throw new Error('body exceeds limit')
        body = JSON.parse(text)
      } catch {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      if (!isRecord(body)) {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      const fields = body
      // A closed body rejects bindingPath and every other request-selected filesystem path.
      if (Object.keys(fields).some(key => !['npub', 'controller', 'name', 'binding', 'mode'].includes(key))
        || (fields.mode !== undefined && fields.mode !== 'insert' && fields.mode !== 'refresh')) {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      const name = typeof fields.name === 'string' ? fields.name.trim() : ''
      if (name === '') { refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.NAME_INVALID, url); return }
      if (fields.binding !== undefined && fields.binding !== null && !isRecord(fields.binding)) {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BINDING_INVALID, url)
        return
      }

      const writer = await loadWriter()
      if (writer === undefined || typeof writer.addContact !== 'function') {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITER_ABSENT, url, 500)
        return
      }

      const stateDir = stateDirOf()
      let written: WrittenContact
      try {
        written = (writer.addContact as (input: Record<string, unknown>) => WrittenContact)({
          stateDir,
          npub: fields.npub,
          controller: fields.controller,
          name,
          binding: fields.binding,
          mode: fields.mode ?? 'insert',
        })
      } catch (cause) {
        refuseWrite(res, cause, url)
        return
      }

      try {
        appendFileSync(
          join(stateDir, MESSAGES_ADD_LEDGER),
          `${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')} ${fields.mode === 'refresh' ? 'refresh' : 'add'} npub=${written.entry.npub.slice(0, 12)}… name=${name.length} chars\n`,
          { mode: 0o600 },
        )
      } catch {
        // The contact was written; an unavailable ledger must not turn success into a refusal.
      }

      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        status: 'ok',
        npub: written.entry.npub,
        name: written.entry.name,
        state: written.state,
        binding: written.bindingStatus,
        total: written.total,
      }))
    },
  }
}
