/**
 * ADD A CONTACT — the write half of a list that until now could only be read.
 *
 * WHY THIS FILE EXISTS. The face registered four endpoints and every one of them READS or SENDS:
 * the listing, the contacts request, the thread, the send. **Nothing in this face wrote
 * `contacts.json`**, so the only way to add a friend was the command line — whose own header says
 * so: *"the step that has no UI, made into a command instead of hand-written JSON."* A list nobody
 * can write to is a list that never grows, and the "+" button in the surface made a local
 * placeholder instead. This is the missing half.
 *
 * IT DELEGATES RATHER THAN REIMPLEMENTS. The release already carries `aukora-nostr/bin/add-contact.mjs`
 * and it already does the hard parts: it validates the npub and the 64-hex controller key, it
 * refuses to overwrite a file it cannot parse, and it writes **atomically** (`<file>.tmp` then
 * `renameSync`, mode `0600`). This route resolves that module exactly the way the face resolves
 * `contact.mjs` — from the tree beside the deployment — and calls its exported `addContact`.
 * **A second implementation of those rules is how the two copies drift.**
 *
 * WHAT IT ADDS ON TOP, AND EACH IS DELIBERATE:
 *
 *   IT REFUSES A DUPLICATE. `addContact` REPLACES an existing entry for the same npub and reports
 *   `replaced`. That is right for a repair tool run by hand and wrong for a button: an unverified
 *   write path must not be able to silently re-point a friend at a different key. So this route
 *   reads the file first and refuses.
 *
 *   IT CANNOT PRODUCE A BOUND OR VERIFIED CONTACT. There is no path through it to either. The
 *   `binding` is **always null**, and a `binding` field in the request body is **ignored** rather
 *   than stored — a caller cannot attach a claim, only a key. Trust arrives afterwards, through the
 *   friend's own binding and then a confirmation the owner signs.
 *
 *   ITS REFUSALS HAVE NAMES, and the ledger line names neither secret: the npub's PREFIX and the
 *   NAME'S LENGTH, never the controller key in full.
 */
import { existsSync, appendFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { messagesRefusalBody } from './messages-route.ts'
import type { MessagesRefusalReason } from './messages-route.ts'
import { resolveContactModuleSpecifier } from './contacts-store.ts'

/** The endpoint a sheet POSTs to in order to add a friend. */
export const MESSAGES_ADD_CONTACT_ENDPOINT = '/aukora-messages/add-contact'

/** Every way this route can refuse, by name. A caller routes on these; none is prose to parse. */
export const MESSAGES_ADD_CONTACT_REFUSALS = Object.freeze({
  NPUB_INVALID: 'messages:add-npub-invalid',
  CONTROLLER_INVALID: 'messages:add-controller-invalid',
  NAME_INVALID: 'messages:add-name-invalid',
  BODY_UNREADABLE: 'messages:add-body-unreadable',
  /** An entry for this npub is already present. THE ANTI-OVERWRITE REFUSAL. */
  ALREADY_PRESENT: 'messages:add-already-present',
  /** The contacts file exists and this face cannot parse it. Never clobber a list we do not understand. */
  CONTACTS_UNREADABLE: 'messages:add-contacts-unreadable',
  /** The nostr tree is not beside this deployment, so there is no writer to call. */
  WRITER_ABSENT: 'messages:add-writer-absent',
  WRITE_FAILED: 'messages:add-write-failed',
})

/** A 64-character lowercase hex string, which is what a controller public key is. */
const HEX64 = /^[0-9a-f]{64}$/u

/** The ledger, appended to once per accepted add. Beside the state directory, never inside the nostr tree. */
export const MESSAGES_ADD_LEDGER = 'contacts-additions.log'

/**
 * Resolve the release's `add-contact.mjs` the way the face resolves `contact.mjs`.
 *
 * IT IS DERIVED FROM THE RESOLVED CONTACT SPECIFIER RATHER THAN FROM A SECOND ENVIRONMENT VARIABLE.
 * `<nostr>/lib/contact.mjs` and `<nostr>/bin/add-contact.mjs` sit in one tree, so pointing the face
 * at another tree moves both or neither. A second knob could point them at different trees, which is
 * a deployment this route has no reason to support and one more way to be wrong.
 *
 * @returns the module's exports, or `undefined` when no writer is present.
 */
async function loadWriter(): Promise<Record<string, unknown> | undefined> {
  let specifier: string
  try {
    specifier = resolveContactModuleSpecifier()
  } catch {
    return undefined
  }
  const writer = resolve(dirname(specifier), '..', 'bin', 'add-contact.mjs')
  if (!existsSync(writer)) return undefined
  try {
    const loaded = (await import(pathToFileURL(writer).href)) as Record<string, unknown>
    // THE DECODER COMES FROM THE SAME TREE, so this route and the writer agree on what an npub IS.
    // `contact.mjs` sits in `<nostr>/lib/` beside the tree this writer lives in, and `identity.mjs`
    // beside it holds `npubDecode`. Comparing raw strings instead would let two encodings of one key
    // read as two friends.
    // RESOLVED FROM THE WRITER'S OWN TREE, not the resolver's: it is the writer that knows which
    // `identity.mjs` decodes the npubs IT will write, and a deployment can point the resolver elsewhere.
    const identity = resolve(dirname(writer), '..', 'lib', 'identity.mjs')
    let decode: unknown
    if (existsSync(identity)) {
      const lib = (await import(pathToFileURL(identity).href)) as Record<string, unknown>
      if (typeof lib.npubDecode === 'function') decode = lib.npubDecode
    }
    // A MODULE NAMESPACE OBJECT CANNOT BE EXTENDED. `loaded.npubDecode = …` THROWS in strict mode —
    // module namespaces are sealed — and the `catch` below turned that into `undefined`, so the route
    // reported `add-writer-absent` and every add failed with a 500 while the writer was sitting right
    // there. A COPY is returned instead. This cost four runs of guessing; the probe that found it was
    // loading the same modules by hand, where the assignment was never attempted.
    return { ...loaded, ...(decode === undefined ? {} : { npubDecode: decode }) }
  } catch {
    return undefined
  }
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

/**
 * Build the add-a-contact route.
 *
 * @param admitted - the gate, called before anything is read.
 * @param stateDirOf - the state directory, read per request rather than captured.
 * @returns the route the web server registers.
 */
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

      const text = await readBody(req)
      if (text === undefined) {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      const fields = body as Record<string, unknown>
      const npub = typeof fields.npub === 'string' ? fields.npub : ''
      const controller = typeof fields.controller === 'string' ? fields.controller.toLowerCase() : ''
      const name = typeof fields.name === 'string' ? fields.name : ''
      // `fields.binding` IS NEVER READ. A caller may send one; it is not an error and it is not
      // stored. The only way a binding reaches this file is the friend issuing it and the owner
      // attaching it deliberately — never a field on a request.
      if (npub === '') { refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.NPUB_INVALID, url); return }
      if (!HEX64.test(controller)) { refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.CONTROLLER_INVALID, url); return }
      if (name.trim() === '') { refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.NAME_INVALID, url); return }

      const writer = await loadWriter()
      if (writer === undefined || typeof writer.addContact !== 'function') {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITER_ABSENT, url, 500)
        return
      }

      // AN NPUB THAT DOES NOT DECODE IS A 400, NOT A 500. The writer would throw on it and this route
      // would report `add-write-failed` — telling a caller the SERVER broke when what happened is that
      // they sent a bad string. The decode also yields the CANONICAL key used for the duplicate check.
      //
      // MEASURED: `npubDecode` RETURNS A BARE HEX STRING, not an object. The first version of this
      // read `.xonlyHex ?? .hex` off the answer, got `undefined` every time, and refused every npub as
      // invalid — which broke all three add arms and was reverted rather than shipped.
      if (typeof writer.npubDecode !== 'function') {
        // WITHOUT THE DECODER THIS ROUTE CANNOT TELL ONE KEY FROM ANOTHER, and guessing from the string
        // is how two spellings of one friend become two friends. Refuse rather than compare literally.
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITER_ABSENT, url, 500)
        return
      }
      let canonicalHex: string
      try {
        const decoded = (writer.npubDecode as (value: string) => unknown)(npub)
        if (typeof decoded !== 'string' || !HEX64.test(decoded)) {
          refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.NPUB_INVALID, url)
          return
        }
        canonicalHex = decoded
      } catch {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.NPUB_INVALID, url)
        return
      }

      // THE DUPLICATE CHECK COMES BEFORE THE WRITE, because `addContact` replaces rather than
      // refuses. Read with the writer's own reader so this route and the command line agree about
      // what "the file cannot be parsed" means.
      const stateDir = stateDirOf()
      let existing: readonly { npub?: unknown }[]
      try {
        const reader = writer.readExistingContacts
        if (typeof reader !== 'function') { refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITER_ABSENT, url, 500); return }
        const path = typeof writer.contactsPath === 'function' ? (writer.contactsPath as (dir: string) => string)(stateDir) : ''
        existing = (reader as (file: string) => readonly { npub?: unknown }[])(path)
      } catch {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.CONTACTS_UNREADABLE, url, 409)
        return
      }
      // CANONICAL, NOT LITERAL: two encodings of one key are ONE FRIEND, so both sides are decoded and
      // the 32 bytes compared. A literal comparison would let the same person be added twice — once per
      // spelling — and would then let the second add re-point the first, which is the overwrite this
      // route exists to refuse.
      const keyOf = (value: unknown): string | undefined => {
        if (typeof value !== 'string' || value === '') return undefined
        if (value === npub) return canonicalHex
        try {
          const decoded = (writer.npubDecode as (v: string) => unknown)(value)
          return typeof decoded === 'string' && HEX64.test(decoded) ? decoded : undefined
        } catch {
          return undefined
        }
      }
      if (existing.some(entry => keyOf(entry?.npub) === canonicalHex)) {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.ALREADY_PRESENT, url, 409)
        return
      }

      let written: { entry?: { npub?: string; name?: string }; path?: string; total?: number }
      try {
        written = (writer.addContact as (input: Record<string, unknown>) => typeof written)({
          stateDir,
          npub,
          controller,
          name,
          // INSERT-ONLY, AND THE WRITER HOLDS THE LOCK. This route's own duplicate check above is a
          // courtesy that lets it answer 409 with its own name; the check that MATTERS is inside the
          // writer, under an exclusive lock, because a command line or a second worker can land between
          // this route's read and its write. With `insert` the writer refuses there too, so the race
          // resolves to one winner and one refusal rather than to a silent overwrite.
          mode: 'insert',
          // NO bindingPath, EVER. This is the line that makes BOUND and VERIFIED unreachable
          // through this route: `addContact` writes `binding: null` when it is not given one.
        })
      } catch {
        refuse(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITE_FAILED, url, 500)
        return
      }

      // ONE LEDGER LINE. The npub's PREFIX and the NAME'S LENGTH: enough to answer "when did this
      // row appear and roughly for whom", and never the controller key, which is the one value here
      // that a reader of this file should not be handed.
      try {
        appendFileSync(
          join(stateDir, MESSAGES_ADD_LEDGER),
          `${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')} add npub=${npub.slice(0, 12)}… name=${name.length} chars\n`,
          { mode: 0o600 },
        )
      } catch {
        // A LEDGER THAT CANNOT BE WRITTEN IS NOT A FAILED ADD. The contact is on disk and the row
        // will appear; refusing now would tell the person their friend was not added when they were.
      }

      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        status: 'ok',
        npub,
        name,
        // WHAT THE ROW WILL SHOW, SAID OUT LOUD RATHER THAN LEFT TO BE INFERRED.
        state: 'UNBOUND',
        binding: null,
        total: written.total ?? null,
      }))
    },
  }
}
