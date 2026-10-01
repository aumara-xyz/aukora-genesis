import {
  MESSAGES_CONFIRM_CONTACT_ENDPOINT,
  MESSAGES_REISSUE_IDENTITY_ENDPOINT,
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
function timeoutSignal(timeoutMs = CONTACTS_REQUEST_TIMEOUT_MS): AbortSignal | undefined {
  const factory = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal
  if (factory?.timeout === undefined) return undefined
  try {
    return factory.timeout(timeoutMs)
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
    const detail = `the body is not JSON: ${messageOf(error)}`
    return { kind: 'failed', failure: response.status >= 200 && response.status < 300
      ? { kind: 'malformed', detail } : { kind: 'http', status: response.status, detail } }
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

export type AddContactRead =
  | { readonly kind: 'added'; readonly contact: AddContactRow }
  | { readonly kind: 'refused'; readonly reason: string; readonly detail: string }
  | { readonly kind: 'failed'; readonly reason: string; readonly detail: string }

export interface AddContactRow {
  readonly npub: string
  readonly name: string
  readonly state: MessagesWireContactState
  readonly binding: unknown
  readonly path: string
  readonly total: number
}

export async function postContact(
  body: { readonly npub: string; readonly controller?: string; readonly name: string; readonly binding?: object; readonly mode?: 'insert' | 'refresh' },
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<AddContactRead> {
  const read = await readJson(
    MESSAGES_ADD_CONTACT_ENDPOINT,
    { method: 'POST', body: JSON.stringify(body) },
    fetchImpl,
  )
  if (read.kind === 'failed') {
    const failure = read.failure
    if (failure.kind === 'refused') return { kind: 'refused', reason: failure.reason, detail: failure.subject }
    return {
      kind: 'failed',
      reason: failure.kind === 'transport' || failure.kind === 'http' ? 'messages:add-unreachable' : 'messages:add-response-unreadable',
      detail: failure.detail,
    }
  }
  const { status, value } = read.value
  const refusal = parseMessagesRefusalBody(value)
  if (refusal !== undefined) return { kind: 'refused', reason: refusal.reason, detail: refusal.subject }
  const answer = value as Record<string, unknown> | null
  const failed = (): AddContactRead => ({
    kind: 'failed',
    reason: status >= 200 && status < 300 ? 'messages:add-response-unreadable' : 'messages:add-unreachable',
    detail: `the route did not return an addition or a named refusal (status ${String(status)})`,
  })
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return failed()
  // The shared parser's whitelist may lag new add-contact refusal names.
  if (answer.status === 'refused' && typeof answer.reason === 'string' && typeof answer.subject === 'string'
    && Object.keys(answer).length === 3) {
    return { kind: 'refused', reason: answer.reason, detail: answer.subject }
  }
  if (answer.ok === false || typeof answer.code === 'string') {
    const reason = typeof answer.code === 'string' ? answer.code : 'messages:add-refused'
    return { kind: 'refused', reason, detail: typeof answer.detail === 'string' ? answer.detail : reason }
  }
  const state = answer.state
  if (status < 200 || status >= 300 || answer.status !== 'ok' || typeof answer.npub !== 'string'
    || typeof answer.name !== 'string' || !checkNpub(answer.npub).ok
    || (state !== 'BOUND' && state !== 'TEST' && state !== 'UNBOUND' && state !== 'FOREIGN' && state !== 'VERIFIED')) return failed()
  return {
    kind: 'added',
    contact: {
      npub: answer.npub,
      name: answer.name,
      state,
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
  comparison: { readonly sasDigits: string; readonly safetyVersion: 2; readonly comparisonGroups: readonly [string, string] },
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<ConfirmRead> {
  const signal = timeoutSignal(315_000) // Existing owner approval window plus its transport budget.
  const read = await readJson(
    MESSAGES_CONFIRM_CONTACT_ENDPOINT,
    { method: 'POST', body: JSON.stringify({ npub, ...comparison }), ...(signal === undefined ? {} : { signal }) },
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
  if (status === 200 && answer.state === 'VERIFIED' && answer.npub === npub) {
    return { kind: 'confirmed', npub: answer.npub }
  }
  return status === 200
    ? { kind: 'failed', failure: { kind: 'malformed', detail: `${MESSAGES_CONFIRM_CONTACT_ENDPOINT} answered 200 without naming VERIFIED` } }
    : { kind: 'failed', failure: refusalOf(status, value) }
}

export interface MessagesPublicIdentity {
  readonly npub: string
  readonly subject: string | null
  readonly bindingReady: boolean
}

/** Read only the shareable public identity; reading never requests a signature. */
export async function readIdentity(
  fetchImpl: ContactsFetch = sameOriginFetch,
): Promise<ContactsRead<MessagesPublicIdentity>> {
  const read = await readJson('/aukora-messages/identity', { method: 'GET' }, fetchImpl)
  return identityAnswer(read)
}

/** User-initiated binding issuance/migration; the body pins the identity already shown. */
export async function reissueIdentity(npub: string, subject: string, fetchImpl: ContactsFetch = sameOriginFetch): Promise<ContactsRead<MessagesPublicIdentity>> {
  const signal = timeoutSignal(315_000)
  return identityAnswer(await readJson(MESSAGES_REISSUE_IDENTITY_ENDPOINT,
    { method: 'POST', body: JSON.stringify({ npub, subject }), ...(signal === undefined ? {} : { signal }) }, fetchImpl))
}

function identityAnswer(read: ContactsRead<{ readonly status: number; readonly value: unknown }>): ContactsRead<MessagesPublicIdentity> {
  if (read.kind === 'failed') return read
  const { status, value } = read.value
  const refusal = parseMessagesRefusalBody(value)
  if (refusal !== undefined) return { kind: 'failed', failure: { kind: 'refused', reason: refusal.reason, subject: refusal.subject } }
  if (status !== 200) return { kind: 'failed', failure: refusalOf(status, value) }
  const body = value as { status?: unknown; npub?: unknown; subject?: unknown; binding?: { statement?: { safetyVersion?: unknown } } | null } | null
  const npub = checkNpub(body?.npub)
  if (body?.status !== 'ok' || !npub.ok || (body.subject !== null && typeof body.subject !== 'string')) {
    return { kind: 'failed', failure: { kind: 'malformed', detail: 'The host did not return a public identity' } }
  }
  return { kind: 'ready', value: { npub: npub.npub, subject: body.subject, bindingReady: body.binding?.statement?.safetyVersion === 2 } }
}
