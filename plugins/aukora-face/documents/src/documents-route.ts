/**
 * The Documents face's wire contract, written once for both ends.
 *
 * WHY ONE MODULE. The host registers these routes and the browser fetches them. If each
 * half spelled its own path, a rename on one side would leave the other fetching a route
 * nobody serves; if each half spelled its own refusal vocabulary, a refusal would reach
 * the screen as an unrecognised shape and be shown as a generic failure instead of the
 * named reason the host chose. Both halves import this file, and nothing here touches the
 * filesystem or the DOM, so the browser bundle can carry it.
 *
 * THE REFUSAL VOCABULARY IS CLOSED AND FINITE. Six names, each a different condition,
 * never a generic not-found:
 *
 *   documents:path-escapes-root  the request leaves the root: an absolute path, a `..`
 *                                segment, or a symlink whose target is outside.
 *   documents:not-markdown       the target is not a `.md` file (a directory named `.md`
 *                                is not one either).
 *   documents:no-such-file       the target does not exist.
 *   documents:unreadable         the target exists and this process cannot read it.
 *   documents:root-missing       the configured root itself is not there.
 *   documents:root-unreadable    the configured root exists and cannot be listed.
 *
 * The three named in the owner's request are the first three; the last three exist
 * because a root that is gone and a root that cannot be listed are not the same absence
 * as a missing document, and collapsing them would tell an operator nothing to do next.
 *
 * @module @aukora/face-documents/route
 */

/** The index: every `.md` under the root. One exact route. */
export const DOCUMENTS_INDEX_ENDPOINT = '/aukora-documents/index.json'

/**
 * One document's raw markdown, under a prefix route: `<endpoint>/<relative path>`.
 * The path segments are percent-encoded by {@link documentsFileRequest}.
 */
export const DOCUMENTS_FILE_ENDPOINT = '/aukora-documents/file'

/** The category reported for a file that sits directly in the root, in no folder. */
export const DOCUMENTS_ROOT_CATEGORY = 'root'

/** Where a title came from: the document's first heading, or its filename. */
export type DocumentsTitleSource = 'heading' | 'filename'

/** One document in the index. */
export interface DocumentsEntry {
  /** Path relative to the root, `/`-separated. */
  readonly path: string
  /** The document's first markdown heading, or the filename when it has none. */
  readonly title: string
  /** Which of the two produced `title`. Stated rather than guessed at by the reader. */
  readonly titleFrom: DocumentsTitleSource
  /** The first path segment under the root, or `root` for a file in the root. */
  readonly category: string
  /** File modification time, ISO 8601 UTC. */
  readonly modifiedAt: string
}

/** The index answer: the root that was read and every markdown document under it. */
export interface DocumentsIndexBody {
  readonly status: 'ok'
  /** Absolute root the index was built from, so the screen can name what it read. */
  readonly root: string
  readonly documents: readonly DocumentsEntry[]
}

/** One document's answer: its identity plus its markdown, byte for byte as stored. */
export interface DocumentsDocumentBody {
  readonly status: 'ok'
  readonly path: string
  readonly title: string
  readonly titleFrom: DocumentsTitleSource
  readonly category: string
  readonly modifiedAt: string
  readonly markdown: string
}

/** Every reason this face refuses a request. See the module header for each condition. */
export type DocumentsRefusalReason =
  | 'documents:path-escapes-root'
  | 'documents:not-markdown'
  | 'documents:no-such-file'
  | 'documents:unreadable'
  | 'documents:root-missing'
  | 'documents:root-unreadable'

/** The path-side refusals: the three the owner named, in the order they are checked. */
export const DOCUMENTS_PATH_REFUSALS: readonly DocumentsRefusalReason[] = [
  'documents:path-escapes-root',
  'documents:not-markdown',
  'documents:no-such-file',
]

/** Every refusal reason, path-side and root-side. */
export const DOCUMENTS_REFUSAL_REASONS: readonly DocumentsRefusalReason[] = [
  ...DOCUMENTS_PATH_REFUSALS,
  'documents:unreadable',
  'documents:root-missing',
  'documents:root-unreadable',
]

/** A refusal: the named reason plus the request it refused. */
export interface DocumentsRefusalBody {
  readonly status: 'refused'
  readonly reason: DocumentsRefusalReason
  /** The requested path (or root) as it arrived, so the reason names its subject. */
  readonly subject: string
}

/** What a read of one document returns: the document, or a named refusal. */
export type DocumentsDocumentAnswer = DocumentsDocumentBody | DocumentsRefusalBody

/** What a read of the index returns: the index, or a named refusal. */
export type DocumentsIndexAnswer = DocumentsIndexBody | DocumentsRefusalBody

/** The route a browser fetches one document from, one path segment per segment. */
export function documentsFileRequest(relativePath: string): string {
  return `${DOCUMENTS_FILE_ENDPOINT}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The relative path a request names, or undefined when it names none.
 * @param pathname - the request pathname, already stripped of its query.
 * @returns the decoded relative path, or undefined for the bare prefix or a bad escape.
 */
export function documentsRequestedPath(pathname: string): string | undefined {
  const prefix = `${DOCUMENTS_FILE_ENDPOINT}/`
  if (!pathname.startsWith(prefix)) return undefined
  try {
    return decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    // A malformed percent-escape names no file this face can resolve. The caller
    // refuses it by name; it must not be thrown onward as a crash.
    return undefined
  }
}

/** Whether a value is a plain JSON object, for the parsers below. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether an object carries exactly the named keys and nothing else. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

/** A non-empty string, for the parsers below. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** Whether a value is a timestamp this face produces: ISO 8601 UTC to the millisecond. */
function isInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
}

/** Whether a value is one of the two title sources. */
function isTitleSource(value: unknown): value is DocumentsTitleSource {
  return value === 'heading' || value === 'filename'
}

/** Parse one index entry, or undefined when it is not the shape this face produces. */
function parseDocumentsEntry(value: unknown): DocumentsEntry | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['path', 'title', 'titleFrom', 'category', 'modifiedAt'])) return undefined
  if (!isText(value.path) || !isText(value.title) || !isText(value.category)) return undefined
  if (!isTitleSource(value.titleFrom) || !isInstant(value.modifiedAt)) return undefined
  return {
    path: value.path,
    title: value.title,
    titleFrom: value.titleFrom,
    category: value.category,
    modifiedAt: value.modifiedAt,
  }
}

/**
 * Validate an index body off the wire.
 * @param value - the parsed JSON body.
 * @returns the body, or undefined when it is not what this face serves.
 */
export function parseDocumentsIndexBody(value: unknown): DocumentsIndexBody | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['status', 'root', 'documents'])) return undefined
  if (value.status !== 'ok' || !isText(value.root) || !Array.isArray(value.documents)) return undefined
  const documents: DocumentsEntry[] = []
  for (const raw of value.documents) {
    const entry = parseDocumentsEntry(raw)
    if (entry === undefined) return undefined
    documents.push(entry)
  }
  return { status: 'ok', root: value.root, documents }
}

/**
 * Validate one document body off the wire. An empty document is a document: `markdown`
 * may be the empty string, which is why it is not held to {@link isText}.
 * @param value - the parsed JSON body.
 * @returns the body, or undefined when it is not what this face serves.
 */
export function parseDocumentsDocumentBody(value: unknown): DocumentsDocumentBody | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['status', 'path', 'title', 'titleFrom', 'category', 'modifiedAt', 'markdown'])) {
    return undefined
  }
  if (value.status !== 'ok' || typeof value.markdown !== 'string') return undefined
  if (!isText(value.path) || !isText(value.title) || !isText(value.category)) return undefined
  if (!isTitleSource(value.titleFrom) || !isInstant(value.modifiedAt)) return undefined
  return {
    status: 'ok',
    path: value.path,
    title: value.title,
    titleFrom: value.titleFrom,
    category: value.category,
    modifiedAt: value.modifiedAt,
    markdown: value.markdown,
  }
}

/**
 * Validate a refusal body off the wire.
 * @param value - the parsed JSON body.
 * @returns the refusal, or undefined when the reason is not one this face defines.
 */
export function parseDocumentsRefusalBody(value: unknown): DocumentsRefusalBody | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['status', 'reason', 'subject'])) return undefined
  if (value.status !== 'refused' || typeof value.subject !== 'string') return undefined
  if (typeof value.reason !== 'string') return undefined
  const reason = DOCUMENTS_REFUSAL_REASONS.find(candidate => candidate === value.reason)
  if (reason === undefined) return undefined
  return { status: 'refused', reason, subject: value.subject }
}
