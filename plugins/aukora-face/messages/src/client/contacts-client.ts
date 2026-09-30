/**
 * The browser half of the Messages read and send: same-origin requests to the host's routes.
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT REFUSES TO DO. The screen on the other side of it has
 * to say which of four things is actually known about the person on the other end of an
 * npub, and it cannot work that out from the browser: the contacts file is on disk, the
 * binding is verified against a controller record the page must never be handed, and an
 * npub on its own proves nothing. So every answer here comes from the host, parsed by the
 * parsers the host itself uses (`messages-route.ts`, imported rather than re-spelled). A
 * shape this file accepts is exactly the shape the host half serves, and a shape it does
 * not accept is reported as unreadable rather than half-rendered.
 *
 * NO PATH IS SPELLED HERE. All three endpoints are the route module's own constants, and the
 * state directory is host-owned: the listing is fetched from the bare endpoint, because a
 * request that named a directory would be refused by name (see
 * `MESSAGES_HOST_OWNED_QUERY_FIELDS`) — a route that read whichever directory the caller
 * named would let the page choose which node's contacts and mail this process touches.
 *
 * A REFUSAL IS NEVER READ AS AN EMPTY RESULT. `readJson` follows `documents-loader.ts`: a
 * transport failure, a non-JSON content type, a body this screen cannot parse, a named
 * refusal, and an unnamed HTTP status are five different failures, and the surface prints
 * which one happened. `messages:reads-unavailable` — no relay answered the read — is one of
 * those names, not an empty conversation.
 *
 * A SEND IS ONLY AS DELIVERED AS ITS PARSED BODY SAYS. `parseMessagesSendBody` refuses any
 * body in which `ok` and `accepted` disagree, so this file cannot be handed a 200 that claims
 * success with no relay behind it; a body with an empty `accepted` list reaches the surface as
 * `not-accepted`.
 *
 * THE AGGREGATE IS NOT THE OUTCOME, SO BOTH ARE CARRIED. One NIP-17 send publishes a copy to
 * the recipient AND a copy to this node's own key, and either can be refused on its own: the
 * aggregate `ok` is then true while the recipient's copy never left, which is exactly the
 * sentence a bare `ok` cannot produce. So a sent answer carries the parsed `copies` array
 * beside the aggregate, and the surface reads the per-copy outcomes rather than the sum. The
 * array comes off the body {@link parseMessagesSendBody} already validated — this file adds no
 * validation of its own, so a body the host's parser would refuse still never reaches here.
 *
 * @module @aukora/face-messages/contacts-client
 */
import {
  MESSAGES_CONFIRM_CONTACT_ENDPOINT,
  MESSAGES_CONTACTS_ENDPOINT,
  MESSAGES_SEND_ENDPOINT,
  MESSAGES_THREAD_ENDPOINT,
  parseMessagesContactsAnswer,
  parseMessagesRefusalBody,
  parseMessagesSendBody,
  parseMessagesThreadBody,
  type MessagesContactsListBody,
  type MessagesCopyOutcome,
  type MessagesRefusalBody,
  type MessagesRefusalReason,
  type MessagesThreadBody,
  type MessagesWireContactEntry,
  type MessagesWireMessage,
  type MessagesWireSas,
  type MessagesWireContactState,
} from '../messages-route.ts'
import { MESSAGES_ADD_CONTACT_ENDPOINT } from '../add-contact-route.ts'
import { checkNpub } from './add-contact.ts'

/** Why a request produced no data. Each kind is a different condition on the wire. */
export type ContactsFailure =
  /** The request never reached the host route. */
  | { readonly kind: 'transport'; readonly detail: string }
  /** The host answered, with a status that carried no refusal this face defines. */
  | { readonly kind: 'http'; readonly status: number; readonly detail: string }
  /** The host refused, by name. */
  | { readonly kind: 'refused'; readonly reason: MessagesRefusalReason; readonly subject: string }
  /** The host answered with something this screen does not recognise. */
  | { readonly kind: 'malformed'; readonly detail: string }

/** The result of one read. */
export type ContactsRead<T> =
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'failed'; readonly failure: ContactsFailure }

/** The fetch these requests use; injectable so a court can drive them without a network. */
export type ContactsFetch = (input: string, init: RequestInit) => Promise<Response>

/** The page's own fetch, same-origin and uncached. */
const sameOriginFetch: ContactsFetch = (input, init) => globalThis.fetch(input, init)

/** How long any one request may take before it is reported as no answer at all. */
export const CONTACTS_REQUEST_TIMEOUT_MS = 15_000

/** One contact as the wire carries it, re-exported so the surface names one import. */
export type WireContact = MessagesWireContactEntry

/** One message as the wire carries it. */
export type WireMessage = MessagesWireMessage

/** The SAS a conversation may carry, which is the contact's own when it is there. */
/**
 * What the Confirm button gets back.
 *
 * A BUTTON THAT REPORTS SUCCESS WITHOUT A SIGNATURE IS THE ONE OUTCOME THIS MUST NEVER PRODUCE: the whole
 * point of VERIFIED is that somebody signed something, so `confirmed` is only ever returned for a row the
 * host resolved as VERIFIED after checking a signature it holds.
 */
export type ConfirmRead =
  | { readonly kind: 'confirmed', readonly npub: string }
  | { readonly kind: 'failed', readonly failure: ContactsFailure }

export type WireSas = MessagesWireSas

/** One of the four states a contact may resolve to, or the absence of any claim. */
export type WireContactState = MessagesWireContactState | 'UNKNOWN'

/** The message of an unknown thrown value, without inventing one. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A timeout signal when the runtime has `AbortSignal.timeout`, and nothing when it does not.
 * A missing timeout degrades to the runtime's own request behaviour; it never throws here.
 * @returns the signal, or undefined.
 */
function timeoutSignal(): AbortSignal | undefined {
  const factory = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal
  if (factory?.timeout === undefined) return undefined
  try {
    return factory.timeout(CONTACTS_REQUEST_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/**
 * Read one JSON body from the host, refusing to guess what a failure means.
 * @param url - the same-origin route to read.
 * @param init - the request, without the JSON accept/credential headers this adds.
 * @param fetchImpl - the fetch to use.
 * @returns the parsed body with its status, or the named failure.
 */
async function readJson(
  url: string,
  init: RequestInit,
  fetchImpl: ContactsFetch,
): Promise<ContactsRead<{ readonly status: number; readonly value: unknown }>> {
  const signal = init.signal ?? timeoutSignal()
  // `exactOptionalPropertyTypes` is on: an absent signal must be absent, not present and
  // undefined, so the request is built in two branches rather than with `signal: undefined`.
  const request: RequestInit = {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...init.headers },
    cache: 'no-store',
    credentials: 'same-origin',
  }
  if (signal !== undefined) request.signal = signal
  let response: Response
  try {
    response = await fetchImpl(url, request)
  } catch (error) {
    return { kind: 'failed', failure: { kind: 'transport', detail: messageOf(error) } }
  }
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
  if (mediaType !== 'application/json') {
    return {
      kind: 'failed',
      failure: {
        kind: 'http',
        status: response.status,
        detail: `content-type ${String(mediaType)} is not application/json`,
      },
    }
  }
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    return { kind: 'failed', failure: { kind: 'malformed', detail: `the body is not JSON: ${messageOf(error)}` } }
  }
  return { kind: 'ready', value: { status: response.status, value } }
}

/**
 * Turn a non-200 answer into the refusal it named, or an unnamed-HTTP failure.
 * @param status - the response status.
 * @param value - the parsed body.
 * @returns the failure.
 */
function refusalOf(status: number, value: unknown): ContactsFailure {
  const refusal: MessagesRefusalBody | undefined = parseMessagesRefusalBody(value)
  if (refusal !== undefined) {
    return { kind: 'refused', reason: refusal.reason, subject: refusal.subject }
  }
  return {
    kind: 'http',
    status,
    detail: 'the body was not a refusal this face defines',
  }
}

/**
 * The listing path this screen requests.
 *
 * The route module's own constant, with nothing appended: the state directory is host-owned
 * and a request that named one is refused by name.
 *
 * @returns the endpoint to fetch the listing from.
 */
/**
 * WHAT THE HOST SAID ABOUT ONE ATTEMPT TO ADD A CONTACT.
 *
 * `reason` IS A PLAIN STRING, not this file's closed refusal union, and that is deliberate: the codes come from
 * the add-contact route (`messages:add-npub-invalid`, `add-controller-invalid`, `add-name-invalid`,
 * `add-body-unreadable`, `add-already-present`, `add-contacts-unreadable`, `add-writer-absent`,
 * `add-write-failed`) and a client that re-declared them as its own union would have to be edited every time the
 * route learns a new one. The sheet shows whatever the host named.
 */
export type AddContactRead =
  | { readonly kind: 'added'; readonly contact: AddContactRow }
  | { readonly kind: 'refused'; readonly reason: string; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string }

/** The row the route answers with on success. `state` is UNBOUND until a person confirms the key in person. */
export interface AddContactRow {
  readonly npub: string
  readonly name: string
  readonly state: string
  readonly binding: unknown
  readonly path: string
  readonly total: number
}

/**
 * Add one contact. THE ONLY PLACE A CONTACT IS WRITTEN FROM THIS FACE.
 *
 * THE REQUEST AND RESPONSE SHAPE ARE THE ROUTE'S, taken from `add-contact-route.ts` itself rather than from a
 * memory of it: `POST /aukora-messages/add-contact` with `{ npub, controller, name }` answering
 * `{ status: 'ok', npub, name, state, binding, path, total }` or a refusal `{ ok: false, code }`. Keeping the
 * call in ONE function is what makes that a one-line change if the route moves.
 *
 * @param body - the three fields, already checked by `checkAddContact`.
 * @param fetchImpl - the fetch to use; defaults to the page's own, and is injected by the court.
 * @returns the added row, the route's named refusal, or a transport/malformed failure.
 */
export async function postContact(
  body: { readonly npub: string; readonly controller: string; readonly name: string },
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<AddContactRead> {
  const read = await readJson(
    MESSAGES_ADD_CONTACT_ENDPOINT,
    { method: 'POST', body: JSON.stringify(body) },
    fetchImpl,
  )
  // THE FAILURE UNION HAS NO COMMON `detail`: a refusal carries `reason` and `subject` instead, which is the
  // shape the rest of this file uses. Reading `.detail` off it was a type error the build caught, and the
  // refusal's own two fields are the more useful description anyway.
  if (read.kind === 'failed') {
    const failure = read.failure
    return {
      kind: 'failed',
      detail: failure.kind === 'refused' ? `${failure.reason} (${failure.subject})` : failure.detail,
    }
  }
  const { status, value } = read.value
  const answer = value as Record<string, unknown> | null
  if (answer === null || typeof answer !== 'object') {
    return { kind: 'failed', detail: `the route answered ${String(status)} with something that is not a body` }
  }
  // A REFUSAL IS READ BEFORE A SUCCESS, because a refusal is what a non-200 is for and a body can carry both
  // shapes' keys; `ok: false` is the route's own way of saying no.
  if (answer.ok === false || typeof answer.code === 'string') {
    const reason = typeof answer.code === 'string' ? answer.code : 'messages:add-refused'
    const detail = typeof answer.detail === 'string' ? answer.detail : reason
    return { kind: 'refused', reason, detail }
  }
  if (answer.status !== 'ok' || typeof answer.npub !== 'string' || typeof answer.name !== 'string') {
    return { kind: 'failed', detail: `the route named neither an addition nor a refusal (status ${String(status)})` }
  }
  return {
    kind: 'added',
    contact: {
      npub: answer.npub,
      name: answer.name,
      state: typeof answer.state === 'string' ? answer.state : 'UNBOUND',
      binding: answer.binding ?? null,
      path: typeof answer.path === 'string' ? answer.path : '',
      total: typeof answer.total === 'number' ? answer.total : 0,
    },
  }
}

export function contactsUrl(): string {
  return MESSAGES_CONTACTS_ENDPOINT
}

/**
 * Read this node's contacts, each resolved by the host to one of the four states.
 *
 * @param fetchImpl - the fetch to use; defaults to the page's own.
 * @returns the listing, or the named failure.
 */
export async function readContacts(
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<ContactsRead<MessagesContactsListBody>> {
  const url = contactsUrl()
  const read = await readJson(url, { method: 'GET' }, fetchImpl)
  if (read.kind === 'failed') return read
  const { status, value } = read.value
  const answer = parseMessagesContactsAnswer(value)
  if (answer === undefined) {
    return status === 200
      ? { kind: 'failed', failure: { kind: 'malformed', detail: `${url} is not a contacts listing body` } }
      : { kind: 'failed', failure: refusalOf(status, value) }
  }
  if (answer.status === 'refused') {
    // A named refusal can arrive under any status; the reason, not the code, is the contract.
    return { kind: 'failed', failure: { kind: 'refused', reason: answer.reason, subject: answer.subject } }
  }
  if (status !== 200) {
    return { kind: 'failed', failure: refusalOf(status, value) }
  }
  return { kind: 'ready', value: answer }
}

/** A thread read: the conversation with what is known about who it is with, or why not. */
export type ThreadRead =
  | { readonly kind: 'ready'; readonly thread: MessagesThreadBody }
  | { readonly kind: 'failed'; readonly failure: ContactsFailure }

/**
 * Read one conversation from the host.
 *
 * `since` is omitted when the caller has no window in mind: the route then uses the relay
 * module's own lookback, which is the only correct default for NIP-17, whose gift wraps are
 * timestamped into the two days before now.
 *
 * @param npub - the contact whose conversation to read.
 * @param since - unix seconds, or null to let the route choose its own lookback.
 * @param fetchImpl - the fetch to use; defaults to the page's own.
 * @returns the conversation, or the named failure.
 */
export async function readThread(
  npub: string,
  since: number | null,
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<ThreadRead> {
  const query = new URLSearchParams({ npub })
  if (since !== null) query.set('since', String(Math.max(1, Math.floor(since))))
  const url = `${MESSAGES_THREAD_ENDPOINT}?${query.toString()}`
  const read = await readJson(url, { method: 'GET' }, fetchImpl)
  if (read.kind === 'failed') return read
  const { status, value } = read.value
  const body = parseMessagesThreadBody(value)
  if (body === undefined) {
    return status === 200
      ? { kind: 'failed', failure: { kind: 'malformed', detail: `${url} is not a thread body` } }
      : { kind: 'failed', failure: refusalOf(status, value) }
  }
  return { kind: 'ready', thread: body }
}

/** One copy's own outcome, re-exported so the surface names one import. */
export type WireCopyOutcome = MessagesCopyOutcome

/**
 * What a send produced. `not-accepted` is NOT success: nobody took the message.
 *
 * BOTH VARIANTS CARRY THE PER-COPY OUTCOMES, because both are answers about a real attempt:
 * `accepted` is the aggregate and the copies are what actually happened to each one, so a
 * recipient copy that was refused while this node's own was kept is visible here and not only
 * in the sum. The surface reads `copies` for its sentence and keeps the aggregate for the
 * relay list, exactly as the route module intends of a caller.
 */
export type SendRead =
  | {
    readonly kind: 'accepted'
    readonly id: string
    readonly at: number
    readonly accepted: readonly string[]
    readonly verdict: string
    readonly copies: readonly MessagesCopyOutcome[]
  }
  | {
    readonly kind: 'not-accepted'
    readonly id: string
    readonly at: number
    readonly accepted: readonly string[]
    readonly verdict: string
    readonly copies: readonly MessagesCopyOutcome[]
  }
  | { readonly kind: 'failed'; readonly failure: ContactsFailure }

/**
 * Send one message.
 *
 * THE RESPONSE DECIDES, NOT THE STATUS CODE. The body is validated by
 * `parseMessagesSendBody`, which refuses any answer where `ok` and `accepted` disagree, so a
 * 200 with an empty relay list arrives here as `not-accepted` and the surface cannot render it
 * as a delivered message.
 *
 * THE COPIES COME OFF THE PARSED BODY, NEVER OFF THE RAW JSON. `copies` is an exact-key field
 * of the send body the host's parser validated, so carrying it here cannot admit a shape the
 * host would have refused — and nothing is re-validated or defaulted along the way.
 *
 * @param npub - the contact to send to.
 * @param text - the message body exactly as typed.
 * @param fetchImpl - the fetch to use; defaults to the page's own.
 * @returns what the host said happened.
 */
export async function sendMessage(
  npub: string,
  text: string,
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<SendRead> {
  const read = await readJson(
    MESSAGES_SEND_ENDPOINT,
    { method: 'POST', body: JSON.stringify({ npub, text }) },
    fetchImpl,
  )
  if (read.kind === 'failed') return read
  const { status, value } = read.value
  const answer = parseMessagesSendBody(value)
  if (answer === undefined) {
    return status === 200
      ? { kind: 'failed', failure: { kind: 'malformed', detail: `${MESSAGES_SEND_ENDPOINT} is not a send body` } }
      : { kind: 'failed', failure: refusalOf(status, value) }
  }
  // A refusal reaches a send under its own name, exactly as it does a read. Re-parsed here
  // rather than read off the union, so the named reason is taken from the parser that owns it.
  const refusal = parseMessagesRefusalBody(answer)
  if (refusal !== undefined) {
    return { kind: 'failed', failure: { kind: 'refused', reason: refusal.reason, subject: refusal.subject } }
  }
  if (answer.status !== 'sent') {
    return { kind: 'failed', failure: { kind: 'malformed', detail: `${MESSAGES_SEND_ENDPOINT} named neither a send nor a refusal` } }
  }
  if (!answer.ok || !answer.copies.some(copy => copy.copy === 'recipient' && copy.accepted)) {
    return { kind: 'not-accepted', id: answer.id, at: answer.at, accepted: answer.accepted, verdict: answer.verdict ?? '', copies: answer.copies }
  }
  return { kind: 'accepted', id: answer.id, at: answer.at, accepted: answer.accepted, verdict: answer.verdict ?? '', copies: answer.copies }
}

/**
 * Ask the host to confirm a contact's digits.
 *
 * THE HOST DOES THE SIGNING, AND THIS FUNCTION NEVER PRETENDS OTHERWISE. The backend asks the shell signer
 * over its socket — the same path the live binding travelled — and the window that opens is the signer's
 * own, showing the bytes it is about to sign. This call WAITS for the person to decide, so a confirmation
 * can take as long as a person takes.
 *
 * IT REFUSES TO READ A REFUSAL AS SUCCESS. `confirmed` is returned only for a `200` the host itself
 * resolved as VERIFIED; a named refusal, a malformed body or a transport failure all come back as
 * `failed`, because a row that says VERIFIED without a signature behind it is worse than a row that says
 * nothing.
 *
 * @param npub - the contact whose digits were compared.
 * @param fetchImpl - the fetch to use; defaults to the page's own.
 * @returns whether the host confirmed it, or why it did not.
 */
export async function confirmSas(
  npub: string,
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<ConfirmRead> {
  const read = await readJson(
    MESSAGES_CONFIRM_CONTACT_ENDPOINT,
    { method: 'POST', body: JSON.stringify({ npub }) },
    fetchImpl,
  )
  if (read.kind === 'failed') return read
  const { status, value } = read.value
  // A REFUSAL REACHES THIS UNDER ITS OWN NAME, exactly as it does a send: the signer's decline, a reply
  // that did not carry the challenge back, a signature that did not verify. None of them is a success and
  // none is paraphrased into one.
  const refusal = parseMessagesRefusalBody(value)
  if (refusal !== undefined) {
    return { kind: 'failed', failure: { kind: 'refused', reason: refusal.reason, subject: refusal.subject } }
  }
  // AN UNTRUSTED BODY IS NARROWED HERE RATHER THAN CAST: `value` came off the wire, and the only thing
  // this reads from it is the two fields the claim needs.
  const answer = (typeof value === 'object' && value !== null ? value : {}) as { state?: unknown, npub?: unknown }
  if (status === 200 && answer.state === 'VERIFIED' && typeof answer.npub === 'string') {
    return { kind: 'confirmed', npub: answer.npub }
  }
  return status === 200
    ? { kind: 'failed', failure: { kind: 'malformed', detail: `${MESSAGES_CONFIRM_CONTACT_ENDPOINT} answered 200 without naming VERIFIED` } }
    : { kind: 'failed', failure: refusalOf(status, value) }
}

/** Read only the shareable public identity; the host never returns the secret key. */
export async function readIdentity(
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<ContactsRead<{ readonly npub: string; readonly subject: string | null }>> {
  const read = await readJson('/aukora-messages/identity', { method: 'GET' }, fetchImpl)
  if (read.kind === 'failed') return read
  const { status, value } = read.value
  if (status !== 200) return { kind: 'failed', failure: refusalOf(status, value) }
  const body = value as { status?: unknown; npub?: unknown; subject?: unknown } | null
  const npub = checkNpub(body?.npub)
  if (body?.status !== 'ok' || !npub.ok || (body.subject !== null && typeof body.subject !== 'string')) {
    return { kind: 'failed', failure: { kind: 'malformed', detail: 'The host did not return a public identity' } }
  }
  return { kind: 'ready', value: { npub: npub.npub, subject: body.subject } }
}
