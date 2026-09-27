/**
 * The browser half of the Documents read: same-origin requests to the host's two routes.
 *
 * NO FAILURE IS SILENT, AND NOTHING FALLS BACK TO SAMPLE DATA. Every read either returns
 * the host's answer or a named failure with the reason attached: a transport failure, an
 * HTTP status, a refusal the host named, or a body this screen cannot recognise. A screen
 * that showed an empty list for any of those would be telling the operator the root holds
 * no documents when what actually happened is that nobody read it.
 *
 * The response parsers live in `documents-route.ts`, shared with the host, so a shape this
 * half accepts is exactly the shape the host half serves.
 *
 * @module @aukora/face-documents/loader
 */
import {
  DOCUMENTS_INDEX_ENDPOINT,
  documentsFileRequest,
  parseDocumentsDocumentBody,
  parseDocumentsIndexBody,
  parseDocumentsRefusalBody,
  type DocumentsDocumentBody,
  type DocumentsIndexBody,
} from '../documents-route.ts'

/** Why a read produced no data. Each kind is a different condition on the wire. */
export type DocumentsFailure =
  /** The request never reached the host route. */
  | { readonly kind: 'transport'; readonly detail: string }
  /** The host answered, with a status that carried no refusal body. */
  | { readonly kind: 'http'; readonly status: number; readonly detail: string }
  /** The host refused, by name. */
  | { readonly kind: 'refused'; readonly reason: string; readonly subject: string }
  /** The host answered with something this screen does not recognise. */
  | { readonly kind: 'malformed'; readonly detail: string }

/** The result of one read. */
export type DocumentsRead<T> =
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'failed'; readonly failure: DocumentsFailure }

/** The fetch this loader uses; injectable so a court can drive it without a network. */
export type DocumentsFetch = (input: string, init: RequestInit) => Promise<Response>

/** The page's own fetch, same-origin and uncached. */
const sameOriginFetch: DocumentsFetch = (input, init) => globalThis.fetch(input, init)

/** A one-line, human-readable account of a failure. Nothing here is localized: it is a diagnostic. */
export function failureText(failure: DocumentsFailure): string {
  switch (failure.kind) {
    case 'transport':
      return `no answer from the host route: ${failure.detail}`
    case 'http':
      return `the host answered HTTP ${String(failure.status)} with no named refusal: ${failure.detail}`
    case 'refused':
      return `the host refused by name: ${failure.reason}${failure.subject === '' ? '' : ` (${failure.subject})`}`
    case 'malformed':
      return `the host's answer is not the shape this screen can render: ${failure.detail}`
  }
}

/** The message of an unknown thrown value, without inventing one. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Fetch one JSON body from the host, refusing to guess what a failure means.
 * @param url - the same-origin route to read.
 * @param fetchImpl - the fetch to use.
 * @returns the parsed body, or the named failure.
 */
async function readJson(url: string, fetchImpl: DocumentsFetch): Promise<DocumentsRead<unknown>> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
    })
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
  if (response.status === 200) return { kind: 'ready', value }
  const refusal = parseDocumentsRefusalBody(value)
  if (refusal !== undefined) {
    return {
      kind: 'failed',
      failure: { kind: 'refused', reason: refusal.reason, subject: refusal.subject },
    }
  }
  return {
    kind: 'failed',
    failure: { kind: 'http', status: response.status, detail: 'the body was not a refusal this face defines' },
  }
}

/**
 * Read the index: every markdown document under the host's root.
 * @param fetchImpl - the fetch to use; defaults to the page's own.
 * @returns the index, or the named failure.
 */
export async function readDocumentsIndex(
  fetchImpl: DocumentsFetch = sameOriginFetch,
): Promise<DocumentsRead<DocumentsIndexBody>> {
  const read = await readJson(DOCUMENTS_INDEX_ENDPOINT, fetchImpl)
  if (read.kind === 'failed') return read
  const body = parseDocumentsIndexBody(read.value)
  if (body === undefined) {
    return {
      kind: 'failed',
      failure: { kind: 'malformed', detail: `${DOCUMENTS_INDEX_ENDPOINT} is not a documents index body` },
    }
  }
  return { kind: 'ready', value: body }
}

/**
 * Read one document's markdown, by its path relative to the root.
 * @param relativePath - the path as the index reported it.
 * @param fetchImpl - the fetch to use; defaults to the page's own.
 * @returns the document, or the named failure.
 */
export async function readDocumentsDocument(
  relativePath: string,
  fetchImpl: DocumentsFetch = sameOriginFetch,
): Promise<DocumentsRead<DocumentsDocumentBody>> {
  const url = documentsFileRequest(relativePath)
  const read = await readJson(url, fetchImpl)
  if (read.kind === 'failed') return read
  const body = parseDocumentsDocumentBody(read.value)
  if (body === undefined) {
    return { kind: 'failed', failure: { kind: 'malformed', detail: `${url} is not a document body` } }
  }
  return { kind: 'ready', value: body }
}
