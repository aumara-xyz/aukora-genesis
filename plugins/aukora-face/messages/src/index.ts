/**
 * The Messages face's host half: three routes over this node's Nostr contacts and mail.
 *
 * WHAT THESE ROUTES ARE FOR. The screen on the other side of them lists the people this node
 * can message and says which of four things is actually known about who is on the other end; it
 * opens the conversation with one of them; and it sends a message to one. None of that can be
 * done from the browser: the contacts file is on disk, the binding signature is verified with
 * `node:crypto` against an Aumlok controller record the page must never be handed, the node's
 * Nostr secret key signs the outgoing message, and the npub alone proves nothing. So the
 * reading, the verifying, the opening and the signing happen here, in the host process.
 *
 * ALL THREE LIVE UNDER ONE PREFIX, `/aukora-messages/`, so the face has one address space:
 *
 *   GET  /aukora-messages/contacts.json   the listing, resolved through `contacts-store.ts`.
 *   GET  /aukora-messages/thread          one conversation, read out of the gift wraps this
 *                                         node already received.
 *   POST /aukora-messages/send            compose ONE NIP-17 message and publish it.
 *
 * THE STATE DIRECTORY IS HOST-OWNED, AND A REQUEST MAY NOT NAME IT. Every route resolves
 * `<stateDir>` and its controller directory from THIS PROCESS'S environment — `DSH_HOME`, the
 * single root the harness keeps user data under — exactly as `documents-reader.ts` reads one
 * fixed private root. A request that supplies `root` or `controllerDir` is refused by name
 * rather than obeyed, because a route that reads whichever directory the caller names is a
 * path-traversal hole: the page would be choosing which node's contacts, keys and mail this
 * process touches, and it has no way to know the right answer anyway. Silently ignoring the
 * field was rejected too — the caller would go on believing it had chosen.
 *
 * TWO ROUTES THAT READ, TWO THAT WRITE, AND EXACTLY ONE FILE EACH TIME.
 *
 * WHY A WRITE IS ALLOWED AT ALL, AND HOW FAR IT GOES. The listing only reads. The thread reads a
 * conversation and then writes one EVIDENCE RECORD per gift wrap it opened and attributed to the
 * requested sender. The send route composes ONE message with THIS NODE'S OWN KEY, hands it to the
 * relays, and writes ONE evidence record per copy a relay accepted — NIP-17 hands the relays a copy
 * for the recipient AND one for this node, so a fully accepted send leaves two records, each named
 * by its own wrap's id. Nothing else on this machine
 * is written: it CANNOT write `<stateDir>/nostr/contacts.json`, cannot create or modify a key —
 * `readNodeSecretKey` reads `identity.json` and refuses when it is absent rather than minting one —
 * and cannot fetch an arbitrary URL: the only addresses these routes ever open are the relays in
 * their own configured list. There is no parameter for a path or a host, and the record's path is
 * derived from the host-owned state root and the published event's own id.
 *
 * A RECORD IS ONLY EVER WRITTEN FOR A MESSAGE THAT EXISTED. The evidence obeys the same rule the
 * send accounting does, from the other side: with no relay accepting there is no published wrap, so
 * NOTHING is written and the answer says `evidence: 'not-recorded'` under
 * `messages:evidence-no-publish`. A record for a message that never left is a false claim of exactly
 * the kind this face exists to remove. It follows that a copy a relay REFUSED is owed no record
 * either, and gets none: the copy that was accepted is recorded, and the one that was not is named
 * in `copies` with the code for why it never left.
 *
 * A SEND THAT NOBODY TOOK IS NOT A SEND. `publishToRelays` reports which relays accepted, and
 * this route derives `ok` from that list rather than setting it. A send whose `accepted` is
 * empty answers `ok: false` with the relay module's own verdict, because telling a person their
 * message was sent when no relay took it is the one failure this route exists to prevent. The
 * wire parser re-asserts the same pairing, so a body that claimed otherwise could not be
 * rendered as sent even if something else produced it.
 *
 * AND ONE MESSAGE IS TWO COPIES, WHICH CAN LAND DIFFERENTLY. Because NIP-17 wraps the recipient's
 * copy and this node's own separately, the recipient's can be refused while this node's is accepted:
 * `ok` is then true — something of this message really was published — and the two are not the same
 * outcome as a full delivery. A flat `accepted` list cannot say which copy was kept, so the answer
 * carries `copies` BESIDE the aggregate: one outcome per copy, naming the copy (`recipient` or
 * `self`), that wrap's `eventId`, whether relays took it, which relays took it, and, when it was
 * refused, the relay module's own named code for why. The aggregate fields are unchanged and are
 * derived from the same per-copy outcomes, so nothing that read this answer before reads a different
 * answer now.
 *
 * WHAT THE FOUR STATES MEAN, AND WHY THEY ARE THE WHOLE POINT. VERIFIED means a binding
 * verified and is not TEST-labelled, so the controller key vouched for this npub and subject
 * and we accept that controller. TEST means it verifies and IS TEST-labelled — structurally
 * sound and not yet a claim about a person, which is every binding this machine can produce
 * until the owner enrols. UNBOUND means we hold an npub and nothing vouches for it. FOREIGN means
 * something was presented and it does NOT verify — an impersonation attempt looks like this,
 * and it is deliberately never merged with UNBOUND. The thread adds one more: UNKNOWN, for an
 * npub that is not in the contacts file at all. A conversation with an UNKNOWN npub is still
 * served, because the messages really arrived and hiding them would be a worse answer than
 * saying plainly that no claim exists about that key.
 *
 * A SAS IS SERVED ONLY FOR A BINDING THAT VERIFIED, in the listing and in the thread alike.
 * UNBOUND, FOREIGN and UNKNOWN contacts carry `sas: null`, and `contacts-store.ts` is where
 * that is enforced: it copies the resolver's answer and refuses to derive a string of its own.
 * Showing a string for an unproven contact invites two people to read it out loud and come away
 * believing they confirmed an identity that was never proven.
 *
 * WHY THE SAME FENCE AS THE DOCUMENTS AND AUMLOK ROUTES. A route that serves this node's
 * contact graph without the harness's own gate is reachable by any process on this machine, and
 * a route that publishes to relays is worse. Every request is therefore rejected by
 * `connection.requestRejection` first, then held to its method — GET for the two reads, POST
 * for the write — then to a same-origin loopback caller: the order and the shape
 * `plugins/aukora-face/documents/src/index.ts` already uses, deliberately copied rather than
 * reinvented.
 *
 * WHAT IT DOES NOT PROVE. The contact resolver and the mail modules are loaded by path (see
 * `loadContactResolver` and `loadMailModules`), so this face trusts the bytes at those paths to
 * be the modules it names; nothing here verifies a digest of them, and the evidence module is part
 * of that same load rather than a separately trusted one. The route is not a
 * confinement: another process running as this user can read and write the same files. The
 * relays are public infrastructure this node does not control, so "accepted" is a relay's
 * statement and not a delivery — the module header of `relay.mjs` says the same.
 *
 * @module @aukora/face-messages
 */
import type { Context } from '@deepseek-ai/cordis'
import { addContactRoute } from './add-contact-route.ts'
import { confirmContactRoute } from './confirm-contact-route.ts'
// TYPE-ONLY, AND LOAD-BEARING. Besides naming the route registration's type, importing this
// module is what brings in its `declare module '@deepseek-ai/cordis'` block — without it,
// `ctx.webServer` does not exist on Context and the mount cannot be written at all. The
// manifest does not yet declare the dependency; that file belongs to another writer.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  MESSAGES_CONTACTS_ENDPOINT,
  MESSAGES_CONTACTS_REQUEST_ENDPOINT,
  MESSAGES_EVIDENCE_MODULE_ABSENT,
  MESSAGES_EVIDENCE_NO_PUBLISH,
  MESSAGES_EVIDENCE_UNWRITABLE,
  MESSAGES_SEND_BUDGET_MS,
  MESSAGES_SEND_ENDPOINT,
  MESSAGES_REISSUE_IDENTITY_ENDPOINT,
  MESSAGES_TEXT_MAX_BYTES,
  MESSAGES_THREAD_BUDGET_MS,
  MESSAGES_THREAD_ENDPOINT,
  type MessagesCopyRole,
  type MessagesEvidenceFields,
  type MessagesRefusalReason,
  type MessagesSendAnswer,
  type MessagesThreadBody,
  messagesEvidenceFields,
  messagesHostOwnedQueryField,
  messagesRefusalBody,
  messagesTextBytes,
  contactFieldsAreSafe,
  parseMessagesContactsRequest,
  parseMessagesSendRequest,
  parseMessagesThreadRequest,
} from './messages-route.ts'
import {
  type MessagesContactResolver,
  type MessagesContactsAnswer,
  type MessagesContactsRoots,
  type MessagesGiftWrapDecoder,
  type MessagesOpenedWrap,
  type MessagesRelays,
  listContacts,
  loadContactResolver,
  messagesContactsRoots,
  messagesRelays,
  messagesRelayTimeoutMs,
  readContactsFile,
  readMailThread,
  readNodeSecretKey,
  resolveContactModuleSpecifier,
  resolveStoredContact,
} from './contacts-store.ts'

export {
  MESSAGES_CONTACTS_DOMAIN,
  MESSAGES_CONTACTS_REFUSAL_REASONS,
  MESSAGES_CONTACT_MODULE_ENV,
  MESSAGES_NOSTR_TREE_ABSENT,
  MESSAGES_CONTACT_MODULE_CANDIDATES,
  MESSAGES_RELAYS_ENV,
  MESSAGES_RELAY_TIMEOUT_ENV,
  MESSAGES_STATE_DIR_ENV,
  contactSas,
  defaultContactModuleSpecifier,
  listContacts,
  loadContactResolver,
  mailThread,
  messagesContactsPath,
  messagesContactsRoots,
  messagesNostrDir,
  messagesRelays,
  messagesRelayTimeoutMs,
  messagesStateDir,
  openedThreadWraps,
  parseMessagesContactsDocument,
  parseStoredContact,
  readContactsFile,
  readMailThread,
  readNodeSecretKey,
  resolveContactModuleSpecifier,
  resolveStoredContact,
} from './contacts-store.ts'
export type {
  MessagesContactBinding,
  MessagesContactDocumentEntry,
  MessagesContactEntry,
  MessagesContactResolver,
  MessagesContactSas,
  MessagesContactState,
  MessagesContactsAnswer,
  MessagesContactsDocument,
  MessagesContactsRefusal,
  MessagesContactsRefusalReason,
  MessagesContactsRoots,
  MessagesDecodedWrap,
  MessagesGiftWrapDecoder,
  MessagesOpenedWrap,
  MessagesRelays,
  MessagesThread,
  MessagesThreadContactState,
  MessagesThreadMessage,
  MessagesThreadRead,
  MessagesThreadReadSpec,
} from './contacts-store.ts'
export {
  MESSAGES_CONTACTS_ENDPOINT,
  MESSAGES_CONTACTS_REQUEST_ENDPOINT,
  MESSAGES_COPY_ROLES,
  MESSAGES_EVIDENCE_MODULE_ABSENT,
  MESSAGES_EVIDENCE_NO_PUBLISH,
  MESSAGES_EVIDENCE_NO_WRAP_OPENED,
  MESSAGES_EVIDENCE_OUTCOMES,
  MESSAGES_EVIDENCE_UNWRITABLE,
  MESSAGES_HOST_OWNED_QUERY_FIELDS,
  MESSAGES_REFUSAL_REASONS,
  MESSAGES_RELAY_REFUSALS,
  MESSAGES_SEND_BUDGET_MS,
  MESSAGES_SEND_ENDPOINT,
  MESSAGES_STORE_REFUSALS,
  MESSAGES_TEXT_MAX_BYTES,
  MESSAGES_THREAD_BUDGET_MS,
  MESSAGES_THREAD_ENDPOINT,
  MESSAGES_WIRE_CONTACT_STATES,
  MESSAGES_WIRE_REFUSALS,
  isMessagesContactBinding,
  isMessagesContactState,
  isMessagesCopyRole,
  isMessagesEvidenceOutcome,
  isMessagesRefusalReason,
  messagesContactsRequest,
  messagesEvidenceFields,
  messagesHostOwnedQueryField,
  messagesRefusalBody,
  messagesTextBytes,
  parseMessagesContactEntry,
  parseMessagesContactsAnswer,
  parseMessagesContactsBody,
  parseMessagesContactsRequest,
  parseMessagesRefusalBody,
  parseMessagesSendBody,
  parseMessagesSendRequest,
  parseMessagesThreadBody,
  parseMessagesThreadRequest,
  parseMessagesWireMessage,
} from './messages-route.ts'
export type {
  MessagesContactsListBody,
  MessagesCopyOutcome,
  MessagesCopyRole,
  MessagesEvidenceFields,
  MessagesEvidenceOutcome,
  MessagesRefusalBody,
  MessagesRefusalReason,
  MessagesSendAnswer,
  MessagesSendBody,
  MessagesSendRequest,
  MessagesThreadBody,
  MessagesThreadRequest,
  MessagesWireContactBinding,
  MessagesWireContactEntry,
  MessagesWireContactState,
  MessagesWireMessage,
  MessagesWireSas,
} from './messages-route.ts'

/**
 * The trust surface a plugin-owned route must consult before it serves anything.
 *
 * Typed here because the connection package is browser-side and its types are not importable
 * from a host entry; the documents and aumlok routes declare the same shape for the same
 * reason.
 */
interface RouteGate {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Required services: the loopback HTTP route registry, and the harness's own request gate.
 * A missing gate must fail the mount rather than serve the contact graph ungated.
 */
export const inject = ['webServer', 'connection']

/**
 * The evidence writer this face loads from the nostr tree's own `evidence.mjs`.
 *
 * Structural, for the same reason {@link MessagesContactResolver} is: `aukora-nostr` ships plain
 * JavaScript with no declaration file, so the module is loaded through {@link loadMailModules} and
 * typed by the two functions this face actually calls.
 */
export interface MessagesEvidenceWriter {
  /** `writeMessageEvidence` from `evidence.mjs`. Throws a named code; writes only the record. */
  readonly writeMessageEvidence: (spec: { readonly stateDir: string; readonly wrap: unknown }) => unknown
  /** `evidenceDir` from `evidence.mjs`: where the records for a state root live. */
  readonly evidenceDir: (stateDir: string) => string
}

/** The nostr modules this face loads by path, plus the two helpers it needs from `identity.mjs`. */
export interface MessagesMailModules {
  /** `openGiftWrap` from `giftwrap.mjs`. */
  readonly openGiftWrap: MessagesGiftWrapDecoder
  /** `composeDirectMessage` from `giftwrap.mjs`. */
  readonly composeDirectMessage: (spec: unknown) => unknown
  /** `fetchGiftWraps` from `relay.mjs`. */
  readonly fetchGiftWraps: (spec: unknown) => Promise<unknown>
  /** `publishToRelays` from `relay.mjs`. */
  readonly publishToRelays: (wrap: unknown, options?: unknown) => Promise<unknown>
  /** `DEFAULT_RELAYS` from `relay.mjs`. */
  readonly DEFAULT_RELAYS: MessagesRelays
  /** `npubDecode` from `identity.mjs`: npub to 32-byte hex, refusing a bad checksum. */
  readonly npubDecode: (npub: string) => string
  /** `publicKeyOf` from `event.mjs`: this node's own x-only hex, from its secret key. */
  readonly publicKeyOf: (secretKeyHex: string) => string
  /**
   * The evidence writer from `evidence.mjs`, loaded from the SAME directory as everything above, or
   * undefined when this deployment's tree carries no evidence module. See {@link loadMailModules}
   * for why it is loaded with the others and is nonetheless not a hard dependency.
   */
  readonly evidence: MessagesEvidenceWriter | undefined
  /** The named reason {@link evidence} is undefined, or null when it is loaded. */
  readonly evidenceAbsent: string | null
  readonly readStoredGiftWraps: (stateDir: string) => readonly unknown[]
  readonly retainGiftWrap: (stateDir: string, wrap: unknown) => void
  readonly publishDmRelays: (spec: unknown) => Promise<unknown>
  readonly fetchDmRelays: (spec: unknown) => Promise<unknown>
}

/**
 * WHY THE EVIDENCE WRITER IS NOT THERE — AND THE THREE ANSWERS ARE NOT ONE.
 *
 * The loader's own comment says it: "… evidence module" and "**the module is there and will not load**" are worth
 * being able to tell". It then wrote the SAME code for both, with the cause's message appended — so a human reading
 * the wire could tell the difference and **a caller routing on the code could not**. That is the cohesion plan's item
 * (5): a module that is absent, one that is present and throws while loading, and one that loads but exports nothing
 * usable are three facts about the world.
 *
 * **EVERY NAME STILL CARRIES `messages:evidence-module-absent`**, so a caller that already routes on the old code
 * keeps working; the specific case is appended after it.
 */
export function writerAbsenceName(kind: 'absent' | 'unloadable' | 'unusable', cause: unknown): string {
  const base = MESSAGES_EVIDENCE_MODULE_ABSENT
  if (kind === 'absent') return base
  const why = cause instanceof Error ? cause.message : cause === null ? '' : String(cause)
  const suffix = why === '' ? '' : `: ${why}`
  // `writer-unloadable` IS THE NAME THE PLAN ASKS FOR, and it covers "there and will not load". A module that loads
  // and exports nothing usable is a different fault with its own word, so the two cannot be confused in a log.
  return kind === 'unloadable' ? `${base}: writer-unloadable${suffix}` : `${base}: writer-unusable${suffix}`
}

/** The loaded modules, by directory, so two requests do not re-read the same files. */
const mailModules = new Map<string, MessagesMailModules>()

/**
 * Load the gift-wrap, relay, identity and evidence modules from the same `lib/` directory as the
 * contact resolver.
 *
 * WHY NOT STATIC IMPORTS. Same reason as `loadContactResolver`: the face build compiles each
 * face inside a clone of the pinned harness where the nostr tree is not present, so a static
 * import of those modules fails to type-check and to bundle in the only build that produces
 * `lib/index.js`. The directory is derived from the resolver's own path, so the whole nostr
 * tree is located once and `AUKORA_NOSTR_CONTACT_MODULE` moves all of it together.
 *
 * THE EVIDENCE MODULE IS LOADED HERE, FROM THAT SAME DIRECTORY, AND IS NOT A HARD DEPENDENCY.
 * There is deliberately no second path resolution anywhere in this face: one resolution names the
 * tree, and every module this face uses comes out of the one directory it named, so a deployment
 * that moves the tree moves all of it. Evidence is optional because the message is the point and the
 * record is the evidence of it: a tree that carries the mail modules and not `evidence.mjs` must
 * still send and read, and reports the missing record by name rather than failing the request. The
 * four modules above are not optional — nothing can be composed or opened without them.
 *
 * @param resolverSpecifier - the resolver path; its directory is the module directory.
 * @returns the loaded modules.
 * @throws {Error} `messages:mail-modules-unloadable` when a required module or export is missing.
 */
export async function loadMailModules(
  resolverSpecifier: string = resolveContactModuleSpecifier(),
): Promise<MessagesMailModules> {
  const cached = mailModules.get(resolverSpecifier)
  if (cached !== undefined) return cached
  const directory = resolverSpecifier.slice(0, resolverSpecifier.lastIndexOf('/') + 1)
  const unloadable = (what: string, cause: unknown): Error => Object.assign(
    new Error(`the ${what} could not be loaded from ${directory}: ${cause instanceof Error ? cause.message : String(cause)}`),
    { code: 'messages:mail-modules-unloadable' },
  )
  let giftwrap: Record<string, unknown>
  let relay: Record<string, unknown>
  let identity: Record<string, unknown>
  let event: Record<string, unknown>
  let evidence: Record<string, unknown> | undefined
  let evidenceAbsent: string | null = null
  try {
    giftwrap = await import(`${directory}giftwrap.mjs`) as Record<string, unknown>
    relay = await import(`${directory}relay.mjs`) as Record<string, unknown>
    identity = await import(`${directory}identity.mjs`) as Record<string, unknown>
    event = await import(`${directory}event.mjs`) as Record<string, unknown>
  } catch (cause) {
    throw unloadable('nostr mail modules', cause)
  }
  try {
    evidence = await import(`${directory}evidence.mjs`) as Record<string, unknown>
  } catch (cause) {
    // The absence is NAMED, with the cause after the code, because "this deployment's tree has no
    // evidence module" and "the module is there and will not load" are worth being able to tell
    // apart. The code is what a caller routes on; the detail is what an operator reads.
    evidence = undefined
    // THERE AND WILL NOT LOAD: the module exists and threw. Named as unloadable, not as absent.
    evidenceAbsent = writerAbsenceName('unloadable', cause)
  }
  if (evidence !== undefined && (typeof evidence.writeMessageEvidence !== 'function' || typeof evidence.evidenceDir !== 'function')) {
    // LOADED BUT UNUSABLE: a different fault from the one above, and it says so.
    evidenceAbsent = writerAbsenceName('unusable', new Error('it exports no writeMessageEvidence and evidenceDir'))
    evidence = undefined
  }
  const exports = {
    openGiftWrap: [giftwrap, 'openGiftWrap'],
    composeDirectMessage: [giftwrap, 'composeDirectMessage'],
    fetchGiftWraps: [relay, 'fetchGiftWraps'],
    publishToRelays: [relay, 'publishToRelays'],
    npubDecode: [identity, 'npubDecode'],
    publicKeyOf: [event, 'publicKeyOf'],
    publishDmRelays: [relay, 'publishDmRelays'],
    fetchDmRelays: [relay, 'fetchDmRelays'],
    readStoredGiftWraps: [evidence ?? {}, 'readStoredGiftWraps'],
    retainGiftWrap: [evidence ?? {}, 'retainGiftWrap'],
  } as const
  for (const [name, [module, key]] of Object.entries(exports)) {
    if (typeof module[key] !== 'function') throw unloadable(name, 'it is not a function')
  }
  if (!Array.isArray(relay.DEFAULT_RELAYS)) throw unloadable('DEFAULT_RELAYS', 'it is not an array')
  const modules: MessagesMailModules = {
    openGiftWrap: giftwrap.openGiftWrap as MessagesGiftWrapDecoder,
    composeDirectMessage: giftwrap.composeDirectMessage as MessagesMailModules['composeDirectMessage'],
    fetchGiftWraps: relay.fetchGiftWraps as MessagesMailModules['fetchGiftWraps'],
    publishToRelays: relay.publishToRelays as MessagesMailModules['publishToRelays'],
    DEFAULT_RELAYS: relay.DEFAULT_RELAYS as MessagesRelays,
    npubDecode: identity.npubDecode as MessagesMailModules['npubDecode'],
    publicKeyOf: event.publicKeyOf as MessagesMailModules['publicKeyOf'],
    evidence: evidence === undefined ? undefined : {
      writeMessageEvidence: evidence.writeMessageEvidence as MessagesEvidenceWriter['writeMessageEvidence'],
      evidenceDir: evidence.evidenceDir as MessagesEvidenceWriter['evidenceDir'],
    },
    evidenceAbsent,
    readStoredGiftWraps: evidence?.readStoredGiftWraps as MessagesMailModules['readStoredGiftWraps'],
    retainGiftWrap: evidence?.retainGiftWrap as MessagesMailModules['retainGiftWrap'],
    publishDmRelays: relay.publishDmRelays as MessagesMailModules['publishDmRelays'],
    fetchDmRelays: relay.fetchDmRelays as MessagesMailModules['fetchDmRelays'],
  }
  mailModules.set(resolverSpecifier, modules)
  return modules
}

// **A `header(req, name)` HELPER WAS DECLARED HERE AND CALLED NOWHERE.** The identical function sat in three
// faces with zero call sites between them, and `noUnusedLocals` made each one a build error — so three faces
// could not be built, shipped stale, and kept a home path in their committed bundles.
//
// **IT IS REMOVED RATHER THAN WIRED.** Wiring it would mean inventing a call site for a helper whose callers
// were never written; leaving it blocks the build. It is four lines and it is in git history if the status
// route it was written for lands later — and `IncomingMessage` is still used elsewhere in this file, so nothing
// else moves.

/** Answer with no body but the honest status code. */
function end(res: ServerResponse, status: number): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end()
}

/** Answer with one JSON body. Nothing served here is cacheable or sniffable. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/**
 * The HTTP status each refusal reason carries. The reason, not the code, is the contract.
 *
 * 422 for the three "your document is not one I read" reasons: the request was understood and
 * the file's content is what cannot be used, which 400 would misreport as a bad request.
 * 503 for a missing controller record or key because that is this node's own missing
 * prerequisite, not the caller's mistake. 502 for the relay refusals, because the failure is
 * upstream of this machine — 502 rather than 504 because none of them is only a timeout.
 *
 * @param reason - the named refusal.
 * @returns the status code.
 */
export function messagesRefusalStatus(reason: MessagesRefusalReason): number {
  switch (reason) {
    // THE ADD ROUTE'S REFUSALS. 400 for a body a sheet can fix, 409 for a list this route will not
    // overwrite, 500 for a deployment fault the person cannot act on.
    case 'messages:confirm-npub-invalid': return 400
    case 'messages:confirm-body-unreadable': return 400
    case 'messages:confirm-no-such-contact': return 404
    case 'messages:confirm-not-bound': return 409
    case 'messages:confirm-safety-version-mismatch': return 409
    case 'messages:confirm-comparison-required': return 409
    case 'messages:confirm-signer-unreachable': return 503
    case 'messages:confirm-signer-declined': return 409
    case 'messages:confirm-challenge-mismatch': return 409
    case 'messages:confirm-not-verified': return 409
    case 'messages:confirm-write-failed': return 500
    case 'messages:confirm-writer-absent': return 500
    case 'messages:confirm-writer-unloadable': return 500
    case 'messages:confirm-writer-unusable': return 500
    case 'messages:identity-reissue-failed': return 409
    case 'messages:identity-changed': return 409
    case 'messages:add-npub-invalid': return 400
    case 'messages:add-controller-invalid': return 400
    case 'messages:add-binding-invalid': return 400
    case 'messages:add-name-invalid': return 400
    case 'messages:add-body-unreadable': return 400
    case 'messages:add-already-present': return 409
    case 'messages:add-refresh-target': return 409
    case 'messages:add-refresh-binding': return 409
    case 'messages:add-contacts-unreadable': return 409
    case 'messages:add-writer-absent': return 500
    case 'messages:add-write-failed': return 500
    case 'messages:contacts-state-missing': return 404
    case 'messages:contacts-unparseable': return 422
    case 'messages:contacts-domain-unknown': return 422
    case 'messages:contact-malformed': return 422
    case 'messages:contact-peer-key-malformed': return 422
    case 'messages:no-controller-record': return 503
    case 'messages:aumlok-not-linked': return 503
    case 'messages:key-missing': return 503
    case 'messages:key-unreadable': return 503
    case 'messages:malformed-request': return 400
    case 'messages:state-directory-named': return 400
    case 'messages:request-body-unreadable': return 400
    case 'messages:text-empty': return 400
    case 'messages:text-too-long': return 413
    case 'messages:no-such-route': return 404
    case 'messages:unreadable-state': return 500
    case 'messages:relays-unreachable': return 502
    case 'messages:nobody-accepted': return 502
    case 'messages:reads-unavailable': return 502
    // A WRAP THAT PROVED NOTHING IS AN UPSTREAM FACT, not the caller's mistake: the relays were
    // reached and answered, and what they served could not be attributed. 502 says the failure is
    // outside this machine, which is exactly where it is.
    case 'messages:sender-unproven': return 502
    // 504 for the two budget refusals, because these ARE timeouts and nothing else: the relays were
    // asked and did not settle inside the route's own budget. 502 would report a refusal the relay
    // never made, and the client's abort would have reported nothing at all.
    case 'messages:send-timeout': return 504
    case 'messages:thread-timeout': return 504
  }
}

/**
 * THE FENCE, AND THE ANSWER TO THE QUESTION THIS ITEM ASKS FIRST: a route that cannot verify its caller must not
 * serve.
 *
 * Security has one home — the composition's `connection` service — and `vendor/dsh/packages/host/open-in-app/src/
 * index.ts` states what its fence does: it "defeats DNS rebinding and cross-site calls", and its browser
 * authentication "gates every caller before any resolution result, icon, or launch is reachable". This face used to
 * call that fence **and** keep a fifteen-line local Host/Origin check of its own, which is a second fence that can
 * drift from the one the rest of the organism uses. The local one is gone; this is the only one left.
 *
 * **THE FOUR CASES, AND WHY NONE OF THEM SERVES UNFENCED.** The rule on optional pins is that absent is a ceiling and
 * present-and-unusable is a fault — but a security dependency is not an optional pin, so there is no ceiling branch
 * here: without a working fence the request is refused, and the reason says which of the four it was.
 *
 * @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
 * @param request - the incoming request, which the fence reads headers from.
 * @returns the status to refuse with, and the reason; `rejection` undefined means the fence let it through.
 */
export function fenceRejectionOf(
  connection: unknown,
  request: { readonly headers: unknown },
): { readonly rejection: number | undefined; readonly reason: string | null } {
  if (connection === null || typeof connection !== 'object') {
    // 1. THE SERVICE IS NOT THERE. This face injects `connection`, so in a running composition this should be
    //    unreachable — which is exactly why it is checked rather than assumed, and refused rather than crashed.
    return { rejection: 403, reason: 'no-connection' }
  }
  const ask = (connection as { requestRejection?: unknown }).requestRejection
  if (typeof ask !== 'function') {
    // 2. PRESENT AND UNUSABLE IS A FAULT, NOT A CEILING: a service with no callable fence is the shape that reads as
    //    enforced while enforcing nothing.
    return { rejection: 500, reason: 'rejection-not-callable' }
  }
  let answer: unknown
  try {
    answer = (ask as (req: { readonly headers: unknown }) => unknown).call(connection, request)
  } catch (error) {
    // 3. A FENCE THAT THREW COULD NOT VERIFY THE CALLER, so the caller is not served — and the reason says thrown
    //    rather than refused, because those are different facts about the world.
    return { rejection: 500, reason: `rejection-threw: ${error instanceof Error ? error.message : String(error)}` }
  }
  // 4. A REJECTION IS CARRIED OUT UNCHANGED: the status is the harness's own (401 unauthenticated, 403 cross-site).
  if (answer === 401 || answer === 403) return { rejection: answer, reason: 'fence-rejected' }
  if (answer !== undefined) return { rejection: 500, reason: `rejection-unknown: ${String(answer)}` }
  return { rejection: undefined, reason: null }
}

/**
 * Run the three checks every request must pass, answering the refusal when it fails.
 * @param gate - the harness's per-route request gate.
 * @param method - the one HTTP method this route accepts.
 * @param req - the request.
 * @param res - the response, written to when the request is refused.
 * @returns true when the handler may serve.
 */
function admitted(gate: () => RouteGate, method: 'GET' | 'POST', req: IncomingMessage, res: ServerResponse): boolean {
  // Authentication first, before the method or origin checks say anything: an unauthenticated
  // caller learns only the status code the harness gives everyone.
  const fence = fenceRejectionOf(gate(), req)
  if (fence.rejection !== undefined) {
    end(res, fence.rejection)
    return false
  }
  if (req.method !== method) {
    res.setHeader('allow', method)
    end(res, 405)
    return false
  }
  // 3. THE ORIGIN CHECK THIS FUNCTION'S OWN DOCSTRING HAS ALWAYS PROMISED, AND WHICH WAS NOT HERE.
  //
  //    The docstring says "the three checks every request must pass"; the code performed TWO — the harness's fence
  //    and the method — and then served. TWO ARMS OF `aukora-messages-transport` ARE THE PROOF, and the second was
  //    already red when I arrived: a request carrying `sec-fetch-site: cross-site` was answered 200, and so was a
  //    POST carrying `origin: https://evil.example`, so a page in another tab could write to this face.
  //
  //    THE FENCE ABOVE CANNOT COVER THIS BY ITSELF. The transport is a service the composition supplies, and it can
  //    only refuse what it SEES; when it answers `undefined` the route must still apply the local rule. ORDER
  //    MATTERS: after the fence and the method, so an unauthenticated cross-site caller learns only what an
  //    unauthenticated same-site caller learns, and a POST to a GET route is still 405.
  if (!isSameOriginLoopbackRequest(req)) {
    end(res, 403)
    return false
  }
  return true
}


/** The loopback authority a `Host` header may name: `127.0.0.1`, with an optional valid port. */
function parseLoopbackAuthority(authority: string): URL | undefined {
  const match = /^127\.0\.0\.1(?::([1-9][0-9]{0,4}))?$/u.exec(authority)
  if (match === null) return undefined
  if (match[1] !== undefined && Number(match[1]) > 65535) return undefined
  return new URL(`http://${authority}`)
}

/**
 * Whether a request is a same-origin loopback request: a `Host` naming this machine's loopback, no cross-site
 * fetch metadata, and — when an `Origin` is present at all — an `http` origin that equals itself and matches the
 * `Host`.
 *
 * **THE NAME IS DELIBERATELY NOT THE ONE THE TWO COPIES USED.** The fence court requires that identifier to be
 * absent from the messages face's code, because two same-named predicates in two packages is the shape that drifts
 * silently. One shared function with one name, imported, is the same rule with one home.
 *
 * A NULL ORIGIN IS REFUSED with the rest: a sandbox without `allow-same-origin` sends exactly `Origin: null`, and
 * the embedded-app case is decided by the sandbox that produced it, not by this route accepting it.
 */
function isSameOriginLoopbackRequest(req: { readonly headers: IncomingMessage['headers'] }): boolean {
  const header = (name: string): string | undefined => {
    const value = req.headers[name]
    return Array.isArray(value) ? value[0] : value
  }
  const host = header('host')
  if (host === undefined) return false
  const hostUrl = parseLoopbackAuthority(host)
  if (hostUrl === undefined) return false
  if (header('sec-fetch-site') === 'cross-site') return false
  const origin = header('origin')
  if (origin === 'null') return false
  if (origin === undefined) return true
  try {
    const originUrl = new URL(origin)
    return originUrl.protocol === 'http:'
      && originUrl.origin === origin
      && originUrl.host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Refuse a request that tried to name the state directory or the controller record.
 *
 * @param search - the request query string.
 * @param req - the request, for its url in the refusal subject.
 * @returns the refusal to answer with, or undefined when the request named neither.
 */
function hostOwnedRefusal(search: string, req: IncomingMessage): ReturnType<typeof messagesRefusalBody> | undefined {
  const field = messagesHostOwnedQueryField(search)
  if (field === undefined) return undefined
  return messagesRefusalBody(
    'messages:state-directory-named',
    `${field} in ${req.url ?? ''} — this face reads one state directory, resolved by the host`,
  )
}

/** The largest send body this face will read, in bytes. */
const SEND_BODY_MAX_BYTES = 256 * 1024

/**
 * Read one request body, with a cap and a named refusal for every way it can fail.
 *
 * The cap is enforced on the COMPLETE body as it arrives, not on a field inside it: a caller
 * that streams a gigabyte at this route must be refused before the process holds it.
 *
 * @param req - the request.
 * @returns the text, or the named refusal.
 */
async function readRequestBody(req: IncomingMessage): Promise<
  { readonly kind: 'body'; readonly text: string } | { readonly kind: 'refused'; readonly refusal: ReturnType<typeof messagesRefusalBody> }
> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > SEND_BODY_MAX_BYTES) {
        return {
          kind: 'refused',
          refusal: messagesRefusalBody('messages:request-body-unreadable', `over ${SEND_BODY_MAX_BYTES} bytes`),
        }
      }
      chunks.push(buffer)
    }
  } catch (cause) {
    return {
      kind: 'refused',
      refusal: messagesRefusalBody('messages:request-body-unreadable', cause instanceof Error ? cause.message : String(cause)),
    }
  }
  return { kind: 'body', text: Buffer.concat(chunks).toString('utf8') }
}

/** Serve one answer under its named status. */
function answer(res: ServerResponse, body: MessagesContactsAnswer | MessagesThreadBody | MessagesSendAnswer): void {
  // Narrowed to the two fields every refusal variant carries, and rebuilt as this face's own
  // refusal body. The three answer types are deliberately NOT one union with a shared
  // discriminant: a send answer is `sent` or `refused` and carries accounting, which the other
  // two do not.
  if (body.status === 'refused') {
    const refusal = messagesRefusalBody(body.reason, body.subject)
    json(res, messagesRefusalStatus(refusal.reason), refusal)
    return
  }
  json(res, 200, body)
}

/**
 * The Cordis service the composition publishes the Aumlok controller directory under.
 *
 * THE ORGAN'S OWN NAME, SPELLED ONCE HERE. The `aukora-aumlok` row mounts
 * `plugins/aukora-aumlok/lib/service.mjs`, whose `SERVICE_NAME` is this exact string, and the sibling
 * face `plugins/aukora-face/aumlok` asks for it under the same name. A court asserts the two are the
 * same string, because a name nothing publishes would make every listing refuse for a reason nobody
 * could see from this file.
 */
export const MESSAGES_CONTROLLER_SERVICE_NAME = 'aumlokControl'

/**
 * The controller record directory, as the mounted `aumlokControl` service names it.
 *
 * ASKED OF THE CONTEXT ON EVERY REQUEST, not captured in `apply`. The sibling face reads the same
 * service the same way for the same reason: a composition can mount a row after this one, and a
 * directory captured at mount time would be a launch-pinned value a later mount could never correct.
 * `ctx.get` answers `undefined` when no row provides the service — a state this face must REPORT
 * rather than vanish in, which is why `aumlokControl` is deliberately NOT declared in `inject`:
 * declaring it would withhold the whole Messages face from any composition without a controller row.
 *
 * NOTHING HERE SUPPLIES A DEFAULT. An absent service, a service naming no `directory`, and a
 * `directory` that is not a non-empty string all answer `undefined`, and `listContacts` reports that
 * by name. A path composed here would be a guess about a deployment this file cannot see — and on the
 * live app the guess `join(stateDir, 'aumlok')` named a directory that does not exist, which turned a
 * completed enrolment into `messages:no-controller-record`.
 *
 * @param ctx - the host context.
 * @returns the directory exactly as the service named it, or `undefined` when none was named.
 */
function controllerDirectory(ctx: Context): string | undefined {
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  const service = get.call(ctx, MESSAGES_CONTROLLER_SERVICE_NAME)
  if (typeof service !== 'object' || service === null) return undefined
  const directory = (service as { directory?: unknown }).directory
  return typeof directory === 'string' && directory !== '' ? directory : undefined
}

/** The roots THIS PROCESS reads, never a directory a request named. */
function roots(ctx: Context): MessagesContactsRoots {
  return messagesContactsRoots(controllerDirectory(ctx))
}

const inboxAnnouncements = new Map<string, number>()
interface MessagesIdentityBootstrap {
  readMessagesIdentity(roots: MessagesContactsRoots): Promise<Record<string, unknown>>
  reissueMessagesIdentity(options: MessagesContactsRoots & { expectedNpub: string; expectedSubject: string }): Promise<Record<string, unknown>>
}
async function identityBootstrap(): Promise<MessagesIdentityBootstrap> {
  const directory = resolveContactModuleSpecifier().replace(/contact\.mjs$/u, '')
  return await import(`${directory}bootstrap.mjs`) as MessagesIdentityBootstrap
}
async function prepareIdentity(stateRoots: MessagesContactsRoots): Promise<Record<string, unknown>> {
  const bootstrap = await identityBootstrap()
  const identity = await bootstrap.readMessagesIdentity(stateRoots)
  if (Date.now() >= (inboxAnnouncements.get(stateRoots.stateDir) ?? 0)) {
    inboxAnnouncements.set(stateRoots.stateDir, Date.now() + 30_000)
    // Contacts and local history do not depend on a relay announcement succeeding.
    void (async () => {
      const modules = await loadMailModules()
      const key = await readNodeSecretKey(stateRoots.stateDir)
      if (key.kind !== 'key') return
      const publication = await modules.publishDmRelays({ secretKeyHex: key.secretKeyHex,
        relays: messagesRelays(modules.DEFAULT_RELAYS), timeoutMs: 2000 })
      const accepted = isRecord(publication) && Array.isArray(publication.accepted) && publication.accepted.length > 0
      inboxAnnouncements.set(stateRoots.stateDir, Date.now() + (accepted ? 15 * 60_000 : 30_000))
    })().catch(() => { inboxAnnouncements.set(stateRoots.stateDir, Date.now() + 30_000) })
  }
  return identity
}

function identityRoute(gate: () => RouteGate, rootsOf: () => MessagesContactsRoots): WebRoute {
  return { kind: 'exact', path: '/aukora-messages/identity', handler: async (req, res) => {
    if (!admitted(gate, 'GET', req, res)) return
    try { json(res, 200, { status: 'ok', ...await prepareIdentity(rootsOf()) }) }
    catch (error) { answer(res, messagesRefusalBody('messages:unreadable-state', causeMessage(error))) }
  } }
}

/** Only an explicit POST can request a Messages binding; paths and signer anchors stay host-owned. */
export function reissueIdentityRoute(gate: () => RouteGate, rootsOf: () => MessagesContactsRoots): WebRoute {
  return { kind: 'exact', path: MESSAGES_REISSUE_IDENTITY_ENDPOINT, handler: async (req, res) => {
    if (!admitted(gate, 'POST', req, res)) return
    const named = hostOwnedRefusal(new URL(req.url ?? '/', 'http://x').search, req)
    if (named !== undefined) { answer(res, named); return }
    const read = await readRequestBody(req)
    if (read.kind === 'refused') { answer(res, read.refusal); return }
    let body: unknown
    try { body = JSON.parse(read.text) } catch { /* malformed body refused below */ }
    if (!isRecord(body) || Object.keys(body).sort().join(',') !== 'npub,subject' || !contactFieldsAreSafe(body)
      || typeof body.npub !== 'string' || typeof body.subject !== 'string' || body.subject === '') {
      answer(res, messagesRefusalBody('messages:malformed-request', MESSAGES_REISSUE_IDENTITY_ENDPOINT)); return
    }
    try {
      const bootstrap = await identityBootstrap()
      const identity = await bootstrap.reissueMessagesIdentity({ ...rootsOf(), expectedNpub: body.npub, expectedSubject: body.subject })
      json(res, 200, { status: 'ok', ...identity })
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'nostr:identity-runtime-unavailable'
      json(res, code === 'nostr:identity-signer-unreachable' ? 503 : 409,
        messagesRefusalBody(code === 'nostr:identity-changed' ? 'messages:identity-changed' : 'messages:identity-reissue-failed', code))
    }
  } }
}

/** The mail modules, or the refusal when they cannot be loaded. */
async function modulesOrRefusal(): Promise<
  { readonly ok: true; readonly modules: MessagesMailModules } | { readonly ok: false; readonly refusal: ReturnType<typeof messagesRefusalBody> }
> {
  try {
    return { ok: true, modules: await loadMailModules() }
  } catch (cause) {
    return {
      ok: false,
      refusal: messagesRefusalBody('messages:unreadable-state', cause instanceof Error ? cause.message : String(cause)),
    }
  }
}

/** The contact resolver, or the refusal when it cannot be loaded. */
async function resolverOrRefusal(): Promise<
  { readonly ok: true; readonly resolver: MessagesContactResolver } | { readonly ok: false; readonly refusal: ReturnType<typeof messagesRefusalBody> }
> {
  try {
    return { ok: true, resolver: await loadContactResolver() }
  } catch (cause) {
    return {
      ok: false,
      refusal: messagesRefusalBody('messages:unreadable-state', cause instanceof Error ? cause.message : String(cause)),
    }
  }
}

/** The contact row for one npub, or undefined when it is not in the contacts file. */
async function contactFor(
  resolver: MessagesContactResolver,
  roots: MessagesContactsRoots,
  npub: string,
): Promise<
  { readonly ok: true; readonly contact: ReturnType<typeof resolveStoredContact> | undefined }
  | { readonly ok: false; readonly refusal: ReturnType<typeof messagesRefusalBody> }
> {
  const read = await readContactsFile(roots.stateDir)
  if (read.kind === 'refused') return { ok: false, refusal: read.refusal }
  const stored = read.contacts.find(entry => entry.npub === npub)
  return { ok: true, contact: stored === undefined ? undefined : resolveStoredContact(resolver, roots, stored) }
}

/**
 * Write ONE evidence record for a gift wrap that really exists, and report it as a pair of fields.
 *
 * THIS FUNCTION CANNOT FAIL A REQUEST, AND IT CANNOT FAIL SILENTLY. `writeMessageEvidence` is
 * synchronous and throws a named code; every throw is turned into `not-recorded` with that code, and
 * every success into `recorded`. The message the record is about is never touched: it was already
 * published or already opened by the time this runs, and a records directory this process cannot
 * write is a fact about the records, not about the message.
 *
 * `rewritten` IS NOT AN ERROR AND IS DELIBERATELY DISCARDED. The module names each record by the
 * event id and writes bytes that are a pure function of the event, so re-reading a message rewrites
 * identical bytes; that is idempotence, which is the property that keeps one message to one record.
 *
 * @param modules - the loaded nostr modules, including whatever this tree has for evidence.
 * @param stateDir - the state root the record belongs under.
 * @param wrap - the event AS PUBLISHED OR RECEIVED, never a recomposed copy of it.
 * @returns whether a record was written, and the named reason when it was not.
 */
async function recordEvidence(
  modules: MessagesMailModules,
  stateDir: string,
  wrap: unknown,
): Promise<MessagesEvidenceFields> {
  const writer = modules.evidence
  if (writer === undefined) {
    // The record cannot be written at all when the module that writes it is not in this
    // deployment. Named, not swallowed: the caller's answer says so and the message still stands.
    return messagesEvidenceFields('not-recorded', modules.evidenceAbsent ?? MESSAGES_EVIDENCE_MODULE_ABSENT)
  }
  try {
    writer.writeMessageEvidence({ stateDir, wrap })
    return messagesEvidenceFields('recorded', null)
  } catch (cause) {
    // The module's own named code, which is what a caller routes on. A throw that carries no code at
    // all is still a record that could not be written, and that is the only true thing left to say.
    const code = (cause as { code?: unknown } | null)?.code
    return messagesEvidenceFields(
      'not-recorded',
      typeof code === 'string' && code !== '' ? code : MESSAGES_EVIDENCE_UNWRITABLE,
    )
  }
}

/**
 * Write one record for each wrap a thread read opened and attributed, and report the aggregate.
 *
 * EVERY WRAP GETS ITS OWN ATTEMPT, so one unwritable record does not silently cost the others theirs.
 * `recorded` here means every wrap that was owed a record has one. A read that opened NOTHING is
 * `none`, never `recorded`: no wrap was read, so no record was owed, and `recorded` on an empty
 * thread is evidence claimed for a conversation nobody wrote to — the vacuous answer this outcome
 * replaced. It is not `not-recorded` either, because claiming a failure that did not happen is its
 * own kind of lie. The first refusal is the one reported, because a caller routing on one code is
 * better served by a reason than by a count.
 *
 * @param modules - the loaded nostr modules.
 * @param stateDir - the state root the records belong under.
 * @param opened - the wraps this read opened and attributed.
 * @returns whether every owed record was written, and the first named reason when one was not.
 */
async function recordOpenedWraps(
  modules: MessagesMailModules,
  stateDir: string,
  opened: readonly MessagesOpenedWrap[],
): Promise<MessagesEvidenceFields> {
  // NOTHING OPENED IS NOTHING OWED. `messagesEvidenceFields('none', …)` supplies the one code this
  // outcome carries, so the reason cannot be chosen here and cannot drift from the wire's rule.
  if (opened.length === 0) return messagesEvidenceFields('none', null)
  let outcome = messagesEvidenceFields('recorded', null)
  for (const entry of opened) {
    const one = await recordEvidence(modules, stateDir, entry.wrap)
    if (one.evidence === 'recorded') continue
    if (outcome.evidence === 'recorded') outcome = one
  }
  return outcome
}

/**
 * The listing handler: read the contacts file, resolve every contact, answer.
 * @param gate - the harness's per-route request gate.
 * @param rootsOf - the roots to read, asked per request so the controller directory is the one the
 *   service names NOW rather than the one it named when this route was mounted.
 * @returns the route.
 */
function contactsRoute(gate: () => RouteGate, rootsOf: () => MessagesContactsRoots): WebRoute {
  return {
    kind: 'exact',
    path: MESSAGES_CONTACTS_ENDPOINT,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!admitted(gate, 'GET', req, res)) return
      const url = new URL(req.url ?? '/', 'http://x')
      const named = hostOwnedRefusal(url.search, req)
      if (named !== undefined) {
        answer(res, named)
        return
      }
      if (!parseMessagesContactsRequest(url.pathname, url.search)) {
        json(res, 400, messagesRefusalBody('messages:malformed-request', req.url ?? ''))
        return
      }
      const resolver = await resolverOrRefusal()
      if (!resolver.ok) {
        answer(res, resolver.refusal)
        return
      }
      // ASKED PER REQUEST, NOT PER PROCESS: the store keeps no cache, so a listing always
      // describes the contacts file as it is now — and the controller directory as the mounted
      // service names it now.
      await prepareIdentity(rootsOf())
      answer(res, await listContacts(resolver.resolver, rootsOf()))
    },
  }
}

/**
 * The bare-prefix handler: the request named no listing, so it is refused by name rather than
 * answered with one.
 * @param gate - the harness's per-route request gate.
 * @returns the route.
 */
function requestRoute(gate: () => RouteGate): WebRoute {
  return {
    kind: 'exact',
    path: MESSAGES_CONTACTS_REQUEST_ENDPOINT,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (!admitted(gate, 'GET', req, res)) return
      const url = new URL(req.url ?? '/', 'http://x')
      const named = hostOwnedRefusal(url.search, req)
      if (named !== undefined) answer(res, named)
      else json(res, 404, messagesRefusalBody('messages:no-such-route', req.url ?? ''))
    },
  }
}

/**
 * The thread handler: read this node's gift wraps, keep the requested contact's messages.
 *
 * @param gate - the harness's per-route request gate.
 * @param rootsOf - the roots to read, asked per request; see {@link contactsRoute}.
 * @returns the route.
 */
function threadRoute(gate: () => RouteGate, rootsOf: () => MessagesContactsRoots): WebRoute {
  return {
    kind: 'exact',
    path: MESSAGES_THREAD_ENDPOINT,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!admitted(gate, 'GET', req, res)) return
      const url = new URL(req.url ?? '/', 'http://x')
      const named = hostOwnedRefusal(url.search, req)
      if (named !== undefined) {
        answer(res, named)
        return
      }
      const requested = parseMessagesThreadRequest(url.pathname, url.search)
      if (requested === undefined) {
        json(res, 400, messagesRefusalBody('messages:malformed-request', req.url ?? ''))
        return
      }
      const stateRoots = rootsOf()
      await prepareIdentity(stateRoots)
      const modules = await modulesOrRefusal()
      if (!modules.ok) {
        answer(res, modules.refusal)
        return
      }
      const resolver = await resolverOrRefusal()
      if (!resolver.ok) {
        answer(res, resolver.refusal)
        return
      }
      const key = await readNodeSecretKey(stateRoots.stateDir)
      if (key.kind === 'refused') {
        answer(res, key.refusal)
        return
      }
      const found = await contactFor(resolver.resolver, stateRoots, requested.npub)
      if (!found.ok) {
        answer(res, found.refusal)
        return
      }
      const recipientPubkey = npubHexOrRefusal(modules.modules, requested.npub)
      if (typeof recipientPubkey !== 'string') {
        answer(res, recipientPubkey)
        return
      }
      const budgetMs = MESSAGES_THREAD_BUDGET_MS
      const selfPubkey = modules.modules.publicKeyOf(key.secretKeyHex)
      const stored = modules.modules.readStoredGiftWraps(stateRoots.stateDir)
      const read = await withinBudget(budgetMs, () => fetchWraps(modules.modules, {
        recipientPubkey: selfPubkey,
        secretKeyHex: key.secretKeyHex,
        // Keep the two-day gift-wrap jitter, including when returning after weeks away.
        since: requested.since ?? 0,
        relays: messagesRelays(modules.modules.DEFAULT_RELAYS),
        timeoutMs: budgetedRelayTimeoutMs(messagesRelayTimeoutMs(4), budgetMs),
      }))
      const settled = read.kind === 'answered' ? read.value : undefined
      const threadRead = readMailThread([...stored, ...(settled?.wraps ?? [])], modules.modules.openGiftWrap, {
        recipientSecretKey: key.secretKeyHex,
        selfPubkey,
        senderPubkeyHex: recipientPubkey,
        senderNpub: requested.npub,
        contact: found.contact,
      })
      if (!settled?.answered.length && threadRead.thread.messages.length === 0) {
        const reason = read.kind === 'timeout' ? 'messages:thread-timeout'
          : read.kind === 'failed' ? 'messages:unreadable-state'
          : settled === undefined ? 'messages:reads-unavailable' : 'messages:relays-unreachable'
        answer(res, messagesRefusalBody(reason, read.kind === 'failed' ? causeMessage(read.cause) : requested.npub))
        return
      }
      // Mail for another contact (or a malformed unsolicited wrap) cannot fail this thread.
      const thread = threadRead.thread
      const evidence = await recordOpenedWraps(modules.modules, stateRoots.stateDir, threadRead.opened)
      const body: MessagesThreadBody = {
        status: 'ok',
        npub: thread.npub,
        contactState: thread.contactState,
        sas: thread.sas,
        messages: thread.messages.map(message => ({
          id: message.id,
          from: message.from,
          text: message.text,
          at: message.at,
        })),
        answered: settled?.answered ?? [],
        ...evidence,
      }
      answer(res, body)
    },
  }
}

/**
 * The send handler: compose one NIP-17 message and publish it, reporting what the relays did.
 *
 * @param gate - the harness's per-route request gate.
 * @param rootsOf - the roots to read, asked per request; see {@link contactsRoute}.
 * @returns the route.
 */
function sendRoute(gate: () => RouteGate, rootsOf: () => MessagesContactsRoots): WebRoute {
  return {
    kind: 'exact',
    path: MESSAGES_SEND_ENDPOINT,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!admitted(gate, 'POST', req, res)) return
      const url = new URL(req.url ?? '/', 'http://x')
      const named = hostOwnedRefusal(url.search, req)
      if (named !== undefined) {
        answer(res, named)
        return
      }
      const read = await readRequestBody(req)
      if (read.kind === 'refused') {
        answer(res, read.refusal)
        return
      }
      let parsedBody: unknown
      try {
        parsedBody = JSON.parse(read.text)
      } catch {
        answer(res, messagesRefusalBody('messages:request-body-unreadable', req.url ?? ''))
        return
      }
      const requested = parseMessagesSendRequest(parsedBody)
      if (requested === undefined) {
        answer(res, messagesRefusalBody('messages:malformed-request', req.url ?? ''))
        return
      }
      if (requested.text === '') {
        answer(res, messagesRefusalBody('messages:text-empty', requested.npub))
        return
      }
      if (messagesTextBytes(requested.text) > MESSAGES_TEXT_MAX_BYTES) {
        answer(res, messagesRefusalBody(
          'messages:text-too-long',
          `${messagesTextBytes(requested.text)} bytes, over ${MESSAGES_TEXT_MAX_BYTES}`,
        ))
        return
      }
      const stateRoots = rootsOf()
      const identity = await prepareIdentity(stateRoots)
      if (!identity.binding) {
        answer(res, messagesRefusalBody('messages:aumlok-not-linked', 'Approve the Messages identity binding in the Aumlok popup before sending.'))
        return
      }
      const modules = await modulesOrRefusal()
      if (!modules.ok) {
        answer(res, modules.refusal)
        return
      }
      const resolver = await resolverOrRefusal()
      if (!resolver.ok) {
        answer(res, resolver.refusal)
        return
      }
      const key = await readNodeSecretKey(stateRoots.stateDir)
      if (key.kind === 'refused') {
        answer(res, key.refusal)
        return
      }
      const found = await contactFor(resolver.resolver, stateRoots, requested.npub)
      if (!found.ok) {
        answer(res, found.refusal)
        return
      }
      if (found.contact === undefined) {
        // A send to a key this node holds no contact for is refused rather than attempted: the
        // message would be encrypted to a key nobody here can name, and the screen could not say
        // whose conversation it went into. FOREIGN is NOT refused — that state is a real contact
        // this node holds, and its four-state label travels with the thread.
        answer(res, messagesRefusalBody('messages:malformed-request', `${requested.npub} is not a contact of this node`))
        return
      }
      const recipientPubkey = npubHexOrRefusal(modules.modules, requested.npub)
      if (typeof recipientPubkey !== 'string') {
        answer(res, recipientPubkey)
        return
      }
      const relays = messagesRelays(modules.modules.DEFAULT_RELAYS)
      const discovered = await modules.modules.fetchDmRelays({ pubkey: recipientPubkey, relays,
        secretKeyHex: key.secretKeyHex, timeoutMs: 2500 })
      const inbox = isRecord(discovered) && Array.isArray(discovered.relays)
        ? discovered.relays.filter((relay): relay is string => typeof relay === 'string') : []
      if (!isRecord(discovered) || !Array.isArray(discovered.answered) || discovered.answered.length === 0) {
        answer(res, messagesRefusalBody('messages:relays-unreachable', requested.npub))
        return
      }
      if (inbox.length === 0) {
        answer(res, messagesRefusalBody('messages:reads-unavailable', 'nostr:dm-relays-missing'))
        return
      }
      const budgetMs = MESSAGES_SEND_BUDGET_MS
      // THE PUBLISH IS CLAMPED TO THE ROUTE'S BUDGET. `messagesRelayTimeoutMs(8)` is the
      // deployment's own per-relay wait (8s by default); a value larger than the budget would let one
      // relay push the answer past the client's abort, which is the failure this route now exists to
      // prevent, so the wait is reduced to fit rather than obeyed.
      const relayTimeoutMs = budgetedRelayTimeoutMs(messagesRelayTimeoutMs(8), budgetMs)
      // EVERYTHING BELOW RUNS UNDER THIS ROUTE'S OWN DEADLINE, and the deadline is the answer to
      // "what if none of it settles". It covers the composition, both publishes and the records, so
      // there is no path through this route that ends in silence: the work returns either the send
      // body or a named refusal, and the deadline returns a named refusal of its own.
      const outcome = await withinBudget(budgetMs, async (): Promise<MessagesSendAnswer> => {
        const composed = modules.modules.composeDirectMessage({
          text: requested.text,
          senderSecretKey: key.secretKeyHex,
          recipientPubkeys: [recipientPubkey],
        })
        if (!isRecord(composed) || !Array.isArray(composed.wraps) || !isRecord(composed.rumor)) {
          return messagesRefusalBody('messages:reads-unavailable', 'the composer returned no wraps')
        }
        // Publish the recipient first. A rejected send must not reappear as a sent
        // bubble later simply because its self-copy reached a different relay.
        const publishedWraps: PublishedCopy[] = []
        let recipientAccepted = false
        const ordered = [...composed.wraps].sort((a, b) =>
          Number(isRecord(b) && b.recipient === recipientPubkey) - Number(isRecord(a) && a.recipient === recipientPubkey))
        for (const entry of ordered) {
          if (!isRecord(entry) || !isRecord(entry.wrap)) continue
          const recipient = entry.recipient === recipientPubkey
          if (!recipient && recipientAccepted) modules.modules.retainGiftWrap(stateRoots.stateDir, entry.wrap)
          const one: { accepted: readonly string[]; verdict: string | null } = recipient || recipientAccepted
            ? await publishOne(modules.modules, entry.wrap, recipient ? inbox : relays, Math.min(3500, relayTimeoutMs), key.secretKeyHex)
            : { accepted: [], verdict: 'nostr:recipient-not-accepted' }
          if (recipient) recipientAccepted = one.accepted.length > 0
          publishedWraps.push({ wrap: entry.wrap, copy: recipient ? 'recipient' : 'self',
            eventId: typeof entry.wrap.id === 'string' ? entry.wrap.id : '', accepted: one.accepted, verdict: one.verdict })
        }
        const accepted = publishedWraps.flatMap(entry => entry.accepted)
        // THE RELAY MODULE'S OWN NAME FOR WHY, taken from the first copy that carried one. A copy
        // that was accepted carries none, and `verdict` is only ever surfaced when nothing was.
        const verdict = publishedWraps.find(entry => entry.verdict !== null)?.verdict ?? null
        // ONE RECORD PER ACCEPTED COPY, AND ONLY FOR A COPY THAT WAS PUBLISHED. `accepted` is the
        // aggregate `ok` below is derived from, so an empty `accepted` means no relay took any copy
        // of this message: there is nothing published for a record to be evidence OF, and a record
        // would be a claim about a message that never left. So nothing is written, and the answer
        // says exactly that under its own code — which is a different fact from a write that failed.
        //
        // EVERY ACCEPTED COPY IS RECORDED, AND A REFUSED ONE IS NOT. Each copy is a published event
        // of its own, named by its own id, so each is evidence of itself: the recipient's copy says
        // this node sent the message, and this node's own copy says what it kept. A copy no relay
        // took was never published and is owed NOTHING — a record for it would name an event that
        // does not exist, which is the false claim this whole lane exists to remove.
        //
        // EACH ACCEPTED COPY GETS ITS OWN ATTEMPT, so one unwritable record does not silently cost
        // the others theirs. `recorded` therefore means EVERY accepted copy has a record, and the
        // first refusal is the one reported, because a caller routing on one code is better served
        // by a reason than by a count.
        const acceptedCopies = publishedWraps.filter(entry => entry.accepted.length > 0)
        let evidence: MessagesEvidenceFields
        if (acceptedCopies.length === 0) {
          evidence = messagesEvidenceFields('not-recorded', MESSAGES_EVIDENCE_NO_PUBLISH)
        } else {
          evidence = messagesEvidenceFields('recorded', null)
          for (const entry of acceptedCopies) {
            const one = await recordEvidence(modules.modules, stateRoots.stateDir, entry.wrap)
            if (one.evidence === 'recorded') continue
            if (evidence.evidence === 'recorded') evidence = one
          }
        }
        const rumor = composed.rumor
        const at = typeof rumor.created_at === 'number' && Number.isFinite(rumor.created_at)
          ? rumor.created_at
          : Math.floor(Date.now() / 1000)
        return {
          status: 'sent',
          // DERIVED, NEVER ASSERTED. See the module header: a send nobody took is not a send.
          ok: accepted.length > 0,
          accepted,
          // THE PER-COPY DETAIL, BESIDE THE AGGREGATE AND NEVER INSTEAD OF IT. `ok` and `accepted`
          // above still say the same thing they always did, and this says which copy each relay took
          // — so a face can answer "kept yours, theirs refused" instead of an aggregate that cannot
          // tell that apart from a full delivery.
          copies: publishedWraps.map(entry => ({
            copy: entry.copy,
            eventId: entry.eventId,
            accepted: entry.accepted.length > 0,
            relays: entry.accepted,
            refusal: entry.accepted.length > 0 ? null : (entry.verdict ?? 'nostr:no-relay-accepted'),
          })),
          verdict: accepted.length > 0 ? null : (verdict ?? 'nostr:no-relay-accepted'),
          npub: requested.npub,
          id: typeof rumor.id === 'string' ? rumor.id : '',
          at,
          ...evidence,
        }
      })
      if (outcome.kind === 'timeout') {
        // THE ANSWER PETER NEVER GOT. Not a hang and not a bare 400 from the harness: a name, a
        // status, and a sentence that says the relays had not settled — so the screen can say what
        // happened instead of "no answer from the host route".
        answer(res, messagesRefusalBody(
          'messages:send-timeout',
          `${requested.npub} — no relay settled within ${budgetMs}ms, so this send has no accounting to report`,
        ))
        return
      }
      if (outcome.kind === 'failed') {
        // A COMPOSER THAT THREW IS STILL AN ANSWER. Without this the exception escapes the handler,
        // the harness answers a bare 400 with no body, and the screen reports a broken transport
        // rather than the one thing that is actually known.
        answer(res, messagesRefusalBody('messages:unreadable-state', causeMessage(outcome.cause)))
        return
      }
      answer(res, outcome.value)
    },
  }
}

/** Whether a value is a plain JSON object, for the module boundaries above. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The 32-byte hex a npub encodes, or the refusal when it is not a npub this face can address.
 *
 * @param modules - the loaded nostr modules.
 * @param npub - the npub from the request.
 * @returns the hex, or the refusal to answer with.
 */
function npubHexOrRefusal(
  modules: MessagesMailModules,
  npub: string,
): string | ReturnType<typeof messagesRefusalBody> {
  try {
    return modules.npubDecode(npub)
  } catch {
    // A malformed npub is the caller's input, not this node's state. Named as a malformed
    // request rather than as an unreadable key, so the person is told which thing is wrong.
    return messagesRefusalBody('messages:malformed-request', `${npub} is not a valid npub`)
  }
}

/** One relay read, or undefined when the read itself failed before it could answer. */
async function fetchWraps(
  modules: MessagesMailModules,
  spec: { readonly recipientPubkey: string; readonly secretKeyHex?: string; readonly since: number | null; readonly relays: MessagesRelays; readonly timeoutMs: number },
): Promise<{ readonly wraps: readonly unknown[]; readonly answered: readonly string[] } | undefined> {
  try {
    const result = await modules.fetchGiftWraps({
      recipientPubkey: spec.recipientPubkey,
      secretKeyHex: spec.secretKeyHex,
      ...(spec.since === null ? {} : { since: spec.since }),
      relays: spec.relays,
      timeoutMs: spec.timeoutMs,
    })
    if (!isRecord(result)) return undefined
    const wraps = Array.isArray(result.wraps) ? result.wraps : []
    const answered = Array.isArray(result.answered) ? result.answered.filter(relay => typeof relay === 'string') : []
    return { wraps, answered }
  } catch {
    // The read threw: no relay list, no transport, or a refusal from the module itself. The
    // caller names it `messages:reads-unavailable` and never answers an empty conversation.
    return undefined
  }
}

/** One publish, reduced to the accounting this face reports. */
async function publishOne(
  modules: MessagesMailModules,
  wrap: unknown,
  relays: MessagesRelays,
  timeoutMs: number,
  secretKeyHex?: string,
): Promise<{ readonly accepted: readonly string[]; readonly verdict: string | null }> {
  try {
    const result = await modules.publishToRelays(wrap, { relays, timeoutMs, secretKeyHex })
    if (!isRecord(result)) return { accepted: [], verdict: 'nostr:no-relay-accepted' }
    const accepted = Array.isArray(result.accepted) ? result.accepted.filter(relay => typeof relay === 'string') : []
    const verdict = typeof result.verdict === 'string' ? result.verdict : null
    return { accepted, verdict }
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code
    return { accepted: [], verdict: typeof code === 'string' ? code : 'nostr:no-relay-accepted' }
  }
}

/**
 * One copy of one send, as it was published: the wrap itself, which copy it is, and what the relays
 * did with it.
 *
 * The wrap travels WITH the outcome because the record written for this copy must be evidence of the
 * bytes that were published, not of a recomposed copy of them — so the thing that is accounted for
 * and the thing that is written down are one value rather than two that could drift apart.
 */
interface PublishedCopy {
  readonly wrap: Record<string, unknown>
  readonly copy: MessagesCopyRole
  readonly eventId: string
  readonly accepted: readonly string[]
  readonly verdict: string | null
}

/** The message of any thrown value, without inventing one. */
function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * How much of a route's budget is held back from the relay calls it makes.
 *
 * A relay exchange clamped to exactly the budget would settle at the same instant the deadline
 * fires, and which of the two answered would be a race. The margin makes the relay's own named
 * outcome the answer whenever it can be, and leaves the deadline for the cases it cannot.
 */
const RELAY_BUDGET_MARGIN_MS = 500

/**
 * The per-relay timeout this route may actually use: the deployment's own, reduced to fit its budget.
 *
 * @param configuredMs - what `messagesRelayTimeoutMs` read from the environment, or its default.
 * @param budgetMs - the route's own budget.
 * @returns a positive number of milliseconds strictly inside the budget.
 */
function budgetedRelayTimeoutMs(configuredMs: number, budgetMs: number): number {
  return Math.max(1, Math.min(configuredMs, budgetMs - RELAY_BUDGET_MARGIN_MS))
}

/** The three ways one route's work can end under its own deadline. */
type BudgetOutcome<T> =
  | { readonly kind: 'answered'; readonly value: T }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly cause: unknown }

/**
 * Run one request's work under the route's own budget, so a request ALWAYS ends in an answer.
 *
 * WHY A DEADLINE AND NOT ONLY TIMEOUTS ON THE CALLS. Every relay exchange has its own timeout and
 * this face clamps it, so in the ordinary case the relay module's named outcome is what the route
 * answers with — which is better than a deadline, because it says what the relays did rather than
 * only that nothing settled. But a route that is only as bounded as the calls it happens to make is
 * bounded by an assumption, and the assumption is what failed live: nothing in the send route knew
 * how long a send was allowed to take, so a slow path simply took longer than the person would wait.
 * This is the bound that does not depend on any of them.
 *
 * THE LOSER IS ABANDONED, NOT CANCELLED. Work still running when the deadline fires cannot be
 * un-run, and it must not be able to write the answer: `work` returns a value and never touches the
 * response, so an abandoned send may still finish its publishes and records behind the answered
 * refusal but can never speak for it. Its rejection is deliberately swallowed below — with the
 * deadline already answered there is nothing left to read it, and an unhandled rejection would end
 * the process instead.
 *
 * @param budgetMs - how long the work may take.
 * @param work - the work, which must return a value rather than write a response.
 * @returns the value, or that the deadline expired, or that the work threw.
 */
async function withinBudget<T>(budgetMs: number, work: () => Promise<T>): Promise<BudgetOutcome<T>> {
  let started: Promise<T>
  try {
    started = work()
  } catch (cause) {
    return { kind: 'failed', cause }
  }
  started.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      started.then(value => ({ kind: 'answered' as const, value })),
      new Promise<BudgetOutcome<T>>(resolve => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), budgetMs)
      }),
    ])
  } catch (cause) {
    return { kind: 'failed', cause }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Register the four routes on the loopback web server.
 * @param ctx - host context carrying the route registry and the request gate.
 */
export function apply(ctx: Context): void {
  if (ctx.webServer.host !== '127.0.0.1') {
    // A contact graph and a signing key served on an all-interfaces bind is a different program
    // than this one. Failing the mount says so; serving it quietly would not.
    throw new Error('ui-messages: the messages routes require a loopback web server')
  }
  const register = (route: WebRoute) => ctx.webServer.register({ ...route, handler: async (req: IncomingMessage, res: ServerResponse) => {
    try { await route.handler(req, res) }
    catch (cause) {
      if (!res.headersSent) answer(res, messagesRefusalBody('messages:unreadable-state', causeMessage(cause)))
      else if (!res.writableEnded) res.end()
    }
  } })
  const gate = (): RouteGate => Reflect.get(ctx, 'connection') as RouteGate
  // THE SERVICE IS READ THROUGH THE CLOSURE, PER REQUEST, AND NEVER CAPTURED HERE. `apply` may run
  // before the row that publishes `aumlokControl` does, so a directory resolved at mount time would
  // be pinned to whatever the composition happened to hold at that instant.
  const rootsOf = (): MessagesContactsRoots => roots(ctx)
  ctx.effect(() => register(identityRoute(gate, rootsOf)), 'ui-messages: identity route')
  ctx.effect(() => register(reissueIdentityRoute(gate, rootsOf)), 'ui-messages: explicit identity reissue route')
  ctx.effect(() => register(contactsRoute(gate, rootsOf)), 'ui-messages: contacts route')
  ctx.effect(() => register(requestRoute(gate)), 'ui-messages: contacts request route')
  ctx.effect(() => register(threadRoute(gate, rootsOf)), 'ui-messages: thread route')
  ctx.effect(() => register(sendRoute(gate, rootsOf)), 'ui-messages: send route')
  // THE WRITE HALF. Registered like the others and gated the same way: a loopback bind, the same
  // request gate, and the same host-owned refusal before anything is read.
  ctx.effect(() => register(addContactRoute(
    (method, req, res) => admitted(gate, method, req, res),
    () => rootsOf().stateDir,
  )), 'ui-messages: add-contact route')
  // THE CONFIRM BUTTON'S ROUTE. It asks the signer over the socket the binding path already uses, waits
  // for the person to click, verifies what comes back and stores it only then.
  ctx.effect(() => register(confirmContactRoute(
    (method, req, res) => admitted(gate, method, req, res),
    () => rootsOf(),
  )), 'ui-messages: confirm-contact route')
}
