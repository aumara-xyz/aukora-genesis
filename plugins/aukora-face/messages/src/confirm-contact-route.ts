/**
 * CONFIRM A CONTACT — the route behind the Confirm button.
 *
 * WHY IT IS A BACKEND ROUTE AND NOT A RENDERER CALL. The live binding travelled a backend process to
 * the signer's socket (`aukora-nostr/bin/reissue-binding.mjs` -> `askTheSigner` -> `<state>/signer.sock`
 * -> the one-bit window). The face has NO bridge channel to the signer, and it does not need one: this
 * route runs host-side Node, so it speaks the same socket the binding did. **The button only POSTs
 * here; no preload, no IPC, no renderer change.**
 *
 * WHAT IT WILL NOT DO. It will not confirm a contact that is not BOUND — a confirmation is a statement
 * about a key that has already verified, and there is nothing to confirm about a key that has not. It
 * will not store anything the signer did not sign, or anything whose signature does not verify against
 * the digits THIS ROUTE PUT IN FRONT OF THE PERSON. And it will not change the binding: when the key
 * moves afterwards, the stored confirmation becomes stale and the row drops back to BOUND, which is the
 * property that makes the confirmation mean something.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { contactFieldsAreSafe, MESSAGES_CONFIRM_CONTACT_ENDPOINT, messagesRefusalBody } from './messages-route.ts'
import type { MessagesRefusalReason } from './messages-route.ts'
import { parseStoredContact, resolveContactModuleSpecifier } from './contacts-store.ts'

/**
 * WHERE THE SIGNER CLIENT IS, IN EITHER LAYOUT.
 *
 * `plugins/aukora-nostr/bin/reissue-binding.mjs:69-70` names both, and its comments say which is which: a release is
 * **flat** (`../../aukora-aumlok/lib/signer-client.mjs`) and this checkout is **nested**
 * (`../../plugins/aukora-aumlok/lib/signer-client.mjs`). This route resolved only the nested form, so in a release the
 * shared transport silently failed to load and the route carried on without it.
 *
 * @param specifier - the resolved contact-module specifier the writer paths are relative to.
 * @returns the client's absolute path, or null when it is in neither layout.
 */
export function signerClientIn(specifier: string): string | null {
  const here = dirname(specifier)
  const candidates = [
    resolve(here, '..', '..', 'aukora-aumlok', 'lib', 'signer-client.mjs'),            // a release: flat
    resolve(here, '..', '..', 'plugins', 'aukora-aumlok', 'lib', 'signer-client.mjs'), // this checkout: nested
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return null
}

/** Every way this route can refuse, by name. */
export const MESSAGES_CONFIRM_CONTACT_REFUSALS = Object.freeze({
  NPUB_INVALID: 'messages:confirm-npub-invalid',
  BODY_UNREADABLE: 'messages:confirm-body-unreadable',
  NO_SUCH_CONTACT: 'messages:confirm-no-such-contact',
  /** The row is not BOUND, so there is no verified key for a confirmation to be about. */
  NOT_BOUND: 'messages:confirm-not-bound',
  SAFETY_VERSION: 'messages:confirm-safety-version-mismatch',
  COMPARISON: 'messages:confirm-comparison-required',
  /** No signer is reachable, or it answered with something that is not a reply. */
  SIGNER_UNREACHABLE: 'messages:confirm-signer-unreachable',
  SIGNER_DECLINED: 'messages:confirm-signer-declined',
  /** The reply did not carry this caller's challenge back. */
  CHALLENGE_MISMATCH: 'messages:confirm-challenge-mismatch',
  /** The signature came back and does not verify against the digits that were shown. */
  NOT_VERIFIED: 'messages:confirm-not-verified',
  WRITE_FAILED: 'messages:confirm-write-failed',
  WRITER_ABSENT: 'messages:confirm-writer-absent',
  // **"THE MODULE IS THERE AND WILL NOT LOAD" IS NOT "THE MODULE IS NOT THERE."** The loader reported both as
  // `WRITER_ABSENT`, so a broken writer and a missing one were one fact to every caller — and a route that says
  // "absent" about a file that is present sends somebody looking in the wrong place. Two names, following the same
  // three-fact rule the evidence writer uses (`writerAbsenceName`).
  WRITER_UNLOADABLE: 'messages:confirm-writer-unloadable',
  WRITER_UNUSABLE: 'messages:confirm-writer-unusable',
})

/** Compare the complete pair of identity fingerprints obtained from the peer, never fixed prefixes. */
export function comparisonMatches(digits: string, groups: unknown): boolean {
  return /^[0-9]{70}$/u.test(digits) && Array.isArray(groups) && groups.length === 2
    && groups.every(group => typeof group === 'string' && /^[0-9]{35}$/u.test(group))
    && groups.join('') === digits
}

const SIGNER_TIMEOUT_MS = 310_000

/** The largest reply line this route will read. */
const MAX_REPLY_BYTES = 64 * 1024

/**
 * The writer, the resolver, and the two signer-path modules — all from the tree the face already
 * resolves, so a deployment that moves the nostr tree moves all of it together.
 *
 * `resolveSignerSocketPath` IS IMPORTED RATHER THAN RE-DERIVED: an exported `AUKORA_SIGNER_SOCKET` wins
 * and otherwise the socket sits at the root of the state directory. A second copy of that rule is how
 * two callers end up dialling different sockets, and one of them silently.
 */
/**
 * What loading the contact writer produced: three outcomes rather than `undefined` for everything.
 *
 * @param specifier - the resolved contact-module specifier, or nothing to resolve it the usual way. The parameter
 *   exists so a court can drive this against a scratch tree instead of the real one.
 */
export type ContactPartsOutcome =
  | { readonly kind: 'loaded'; readonly parts: Record<string, unknown> }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unloadable'; readonly because: string }

export async function loadContactParts(specifier?: string): Promise<ContactPartsOutcome> {
  if (specifier === undefined) {
    try {
      specifier = resolveContactModuleSpecifier()
    } catch {
      return { kind: 'absent' }
    }
  }
  const writer = resolve(dirname(specifier), '..', 'bin', 'add-contact.mjs')
  const binding = resolve(dirname(specifier), '..', 'bin', 'reissue-binding.mjs')
  if (!existsSync(writer) || !existsSync(binding)) return { kind: 'absent' }
  try {
    // A MODULE NAMESPACE OBJECT CANNOT BE EXTENDED — the assignment throws in strict mode — so the
    // parts are gathered into a plain object rather than attached to one.
    const writerModule = (await import(pathToFileURL(writer).href)) as Record<string, unknown>
    const bindingModule = (await import(pathToFileURL(binding).href)) as Record<string, unknown>
    // BOTH LAYOUTS, THROUGH THE RESOLVER ABOVE, so a release and a checkout both find the shared transport.
    const client = signerClientIn(specifier)
    const confirmation = resolve(dirname(specifier), 'confirmation.mjs')
    const contact = resolve(dirname(specifier), 'contact.mjs')
    const parts: Record<string, unknown> = { ...writerModule }
    // THE CLIENT PATH IS THE THING TESTED. The first version read
    // `existsSync(bindingModule === undefined ? '' : client)` — it tested `bindingModule`, which is
    // always defined, so the branch was taken or not for reasons that had nothing to do with the file
    // it then imported. A truthiness slip inside a guard reads exactly like a working guard.
    if (client !== null) {
      // The shared transport, so this path and the binding path cannot drift.
      Object.assign(parts, (await import(pathToFileURL(client).href)) as Record<string, unknown>)
    }
    if (existsSync(confirmation)) {
      Object.assign(parts, (await import(pathToFileURL(confirmation).href)) as Record<string, unknown>)
    }
    if (existsSync(contact)) {
      Object.assign(parts, (await import(pathToFileURL(contact).href)) as Record<string, unknown>)
    }
    parts.resolveSignerSocketPath = bindingModule.resolveSignerSocketPath
    return { kind: 'loaded', parts }
  } catch (cause) {
    // THERE AND WILL NOT LOAD: the files exist and the import threw. Named, with its cause, and never as absent.
    return { kind: 'unloadable', because: cause instanceof Error ? cause.message : String(cause) }
  }
}

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

function refuse(res: ServerResponse, name: MessagesRefusalReason, url: string, status = 400): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(messagesRefusalBody(name, url)))
}

/**
 * Build the confirm route.
 *
 * @param admitted - the gate, called before anything is read.
 * @param rootsOf - the state and controller directories, read per request.
 * @returns the route the web server registers.
 */
export function confirmContactRoute(
  admitted: (method: 'POST', req: IncomingMessage, res: ServerResponse) => boolean,
  rootsOf: () => { stateDir: string, controllerDir: string | undefined },
): { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } {
  return {
    kind: 'exact',
    path: MESSAGES_CONFIRM_CONTACT_ENDPOINT,
    handler: async (req, res) => {
      if (!admitted('POST', req, res)) return
      const url = req.url ?? MESSAGES_CONFIRM_CONTACT_ENDPOINT

      const text = await readBody(req)
      let body: unknown
      try {
        body = JSON.parse(text ?? '')
      } catch {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body) || !contactFieldsAreSafe(body)
        || Object.keys(body).sort().join(',') !== 'comparisonGroups,npub,safetyVersion,sasDigits') {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.BODY_UNREADABLE, url)
        return
      }
      const npub = typeof (body as Record<string, unknown>).npub === 'string' ? String((body as Record<string, unknown>).npub) : ''
      if (npub === '') { refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NPUB_INVALID, url); return }
      const comparison = body as Record<string, unknown>
      if (comparison.safetyVersion !== 2) { refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SAFETY_VERSION, url, 409); return }

      const roots = rootsOf()
      if (roots.controllerDir === undefined) {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_ABSENT, url, 500)
        return
      }
      // THE NAME IS `loaded` BECAUSE `outcome` IS TAKEN LATER IN THIS SCOPE for the SAS verification's own result —
      // and shadowing it was a parse error, not a subtle bug, which is the good kind.
      const loaded = await loadContactParts()
      if (loaded.kind === 'absent') { refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_ABSENT, url, 500); return }
      if (loaded.kind === 'unloadable') {
        // IT IS THERE AND IT WILL NOT LOAD. Saying "absent" here would send somebody looking for a file that exists.
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_UNLOADABLE, url, 500)
        return
      }
      const parts = loaded.parts
      const canWrite = typeof parts?.setContactConfirmation === 'function'
      const canResolve = typeof parts?.resolveContact === 'function'
      const canAsk = typeof parts?.askSignerOperation === 'function'
      const canResolveSocket = typeof parts?.resolveSignerSocketPath === 'function'
      const canVerify = typeof parts?.verifySasConfirmation === 'function'
      if (!canWrite || !canResolve || !canAsk || !canResolveSocket || !canVerify) {
        // LOADED BUT UNUSABLE: a third fact, and the last one that used to read as "absent".
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_UNUSABLE, url, 500)
        return
      }

      // WHAT THE ROW SAYS NOW. The digits are read from the CURRENT binding through the same resolver
      // the listing uses, and the submission must match that exact displayed safety number.
      const listed = (parts.readExistingContacts as (file: string) => readonly Record<string, unknown>[])(
        (parts.contactsPath as (dir: string) => string)(roots.stateDir),
      )
      const stored = listed.map(parseStoredContact).find(entry => entry?.npub === npub)
      if (stored === undefined) { refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NO_SUCH_CONTACT, url, 404); return }
      const resolved = (parts.resolveContact as (spec: Record<string, unknown>) => Record<string, unknown>)({
        npub,
        peerControllerKey: stored.peerControllerKey,
        binding: stored.binding ?? null,
        confirmation: stored.confirmation,
        ownerControllerDir: roots.controllerDir,
        ownerStateDir: roots.stateDir,
      })
      if (resolved.state !== 'BOUND') {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_BOUND, url, 409)
        return
      }
      if (resolved.code === 'contact:safety-version-mismatch') {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SAFETY_VERSION, url, 409)
        return
      }
      const sas = resolved.sas as { digits?: string; comparisonGroupIndex?: number } | null
      const digits = typeof sas?.digits === 'string' ? sas.digits : ''
      const controllerKeyHex = typeof resolved.controllerKeyHex === 'string' ? resolved.controllerKeyHex : ''
      const subject = typeof resolved.subject === 'string' ? resolved.subject : ''
      if (!/^[0-9]{70}$/u.test(digits) || controllerKeyHex === '') {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_VERIFIED, url, 409)
        return
      }
      // Re-resolve both bindings and check the complete pair. Honest clients display only their own half.
      // Public values can be computed by a malicious client; this check does not attest a human comparison.
      if (comparison.sasDigits !== digits
        || !comparisonMatches(digits, comparison.comparisonGroups)) {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.COMPARISON, url, 409)
        return
      }

      // THE CHALLENGE IS THIS CALLER'S OWN ONE-USE VALUE, and the reply must carry it back: an answer
      // that does not is an answer to some other question.
      const challenge = randomBytes(32).toString('hex')
      const confirmedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
      const { socketPath } = (parts.resolveSignerSocketPath as (env: unknown, dir: string) => { socketPath: string })(
        process.env, roots.stateDir,
      )
      let reply: Record<string, unknown>
      try {
        reply = (await (parts.askSignerOperation as (
          request: Record<string, unknown>, socket: string, names: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>)(
          { operation: 'confirm-nostr-sas', subject, npub, controllerKeyHex, sasDigits: digits, confirmedAt, safetyVersion: 2, challenge },
          socketPath,
          { unreachable: MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE, malformed: MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE, timeoutMs: SIGNER_TIMEOUT_MS, maxBytes: MAX_REPLY_BYTES },
        ))
      } catch {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE, url, 503)
        return
      }
      // A REFUSAL IS *RETURNED*, NOT THROWN. `askSignerOperation` rejects only when the TRANSPORT
      // failed; when the signer answers "no" it resolves `{domain, challenge, refusal}`. The first
      // version of this tested `reply.ok !== true`, and the reply record HAS NO `ok` FIELD — so a
      // SUCCESSFUL signature would have been read as a decline and every confirmation refused. The
      // refusal is the presence of `refusal`, and its name is passed through rather than paraphrased.
      if (typeof reply?.refusal === 'string' && reply.refusal !== '') {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_DECLINED, url, 409)
        return
      }
      if (reply.challenge !== challenge) {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.CHALLENGE_MISMATCH, url, 409)
        return
      }
      if (typeof reply.signature !== 'string' || !/^[0-9a-f]{128}$/u.test(reply.signature)) {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE, url, 502)
        return
      }

      // THE SIGNER FIELD NAMES THIS MACHINE'S OWN KEY, AND IT IS READ FROM THE RECORD rather than taken
      // from the reply. It is the same key `verifySasConfirmation` is about to check the signature
      // against, so sourcing it here removes a way for the reply to name a key that did not sign.
      const machineHex = (parts.ownerController as (dir: string) => { publicHex: string })(roots.controllerDir).publicHex
      const document = {
        // THE DOMAIN COMES FROM THE VERIFIER, not a literal here: the two must be the same string and
        // the only way to be sure is to read it from the module that will check it.
        domain: String(parts.SAS_CONFIRMATION_DOMAIN ?? ''),
        statement: { subject, npub, controllerKeyHex, sasDigits: digits, confirmedAt, safetyVersion: 2 },
        signature: reply.signature,
        approvalKeyDid: `did:key:${machineHex}`,
      }
      const checked = (parts.verifySasConfirmationDetailed as (doc: unknown, expectation: Record<string, unknown>) => { verdict: string } | undefined)
        ?? (parts.verifySasConfirmation as unknown as (doc: unknown, expectation: Record<string, unknown>) => { verdict: string })
      const outcome = typeof parts.verifySasConfirmationDetailed === 'function'
        ? (parts.verifySasConfirmationDetailed as (doc: unknown, e: Record<string, unknown>) => { verdict: string })(document, {
            npub, subject, controllerKeyHex, sasDigits: digits, safetyVersion: 2, ownerControllerDir: roots.controllerDir,
          })
        : { verdict: (parts.verifySasConfirmation as (doc: unknown, e: Record<string, unknown>) => string)(document, {
            npub, subject, controllerKeyHex, sasDigits: digits, safetyVersion: 2, ownerControllerDir: roots.controllerDir,
          }) }
      if (checked === undefined || outcome.verdict !== 'verified') {
        // THE SIGNATURE CAME BACK AND DID NOT VERIFY. Nothing is stored: a confirmation this route
        // cannot check is not a confirmation, and writing it would make the row claim something nobody
        // established.
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_VERIFIED, url, 409)
        return
      }

      try {
        ;(parts.setContactConfirmation as (input: Record<string, unknown>) => unknown)({ stateDir: roots.stateDir, npub, confirmation: document })
      } catch {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITE_FAILED, url, 500)
        return
      }

      // The signer may have taken minutes. Report VERIFIED only if the stored contact and both
      // current identity bindings still resolve to the comparison it signed.
      const current = (parts.readExistingContacts as (file: string) => readonly unknown[])(
        (parts.contactsPath as (dir: string) => string)(roots.stateDir),
      ).map(parseStoredContact).find(entry => entry?.npub === npub)
      const final = current === undefined ? null
        : (parts.resolveContact as (spec: Record<string, unknown>) => Record<string, unknown>)({
            npub, peerControllerKey: current.peerControllerKey, binding: current.binding,
            confirmation: current.confirmation, ownerControllerDir: roots.controllerDir, ownerStateDir: roots.stateDir,
          })
      if (final?.state !== 'VERIFIED') {
        refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_VERIFIED, url, 409)
        return
      }

      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ status: 'ok', npub, state: 'VERIFIED', binding: 'verified', sas: { digits } }))
    },
  }
}
