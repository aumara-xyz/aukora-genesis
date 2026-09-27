/**
 * The reader behind the Documents face: the private root, and nothing outside it.
 *
 * WHAT THIS MODULE MAY DO. It OPENS FILES READ-ONLY, and that is the whole of its
 * reach: `open(path, 'r')` cannot create, truncate, append or rename, and this file
 * imports no writer at all — there is no `writeFile`, `mkdir`, `rm`, `rename` or `copyFile`
 * anywhere in it. It never moves, copies or deletes anything, and it never caches: every
 * call re-reads the tree, so a listing cannot outlive the directory it describes.
 *
 * THE BOUNDARY IS THE FEATURE. A request is resolved before anything is opened, and a
 * request that does not land on a markdown file inside the root is REFUSED BY NAME —
 * one name per condition, never a generic not-found:
 *
 *   documents:path-escapes-root  an absolute path, a `..` that climbs out, or a symlink
 *                                whose resolved target is outside the root.
 *   documents:not-markdown       the target is not a `.md` file.
 *   documents:no-such-file       the target does not exist.
 *
 * The first check is LEXICAL and comes first: `..` is refused before any path on disk is
 * touched. The symlink check is not lexical — a symlink inside the root is followed and
 * its REAL path must still be inside the root, so a link planted in the tree cannot be
 * used to read a file it points at elsewhere. A refusal carries the requested path back
 * as its subject, so the screen can say which request it refused.
 *
 * WHAT A TITLE IS, AND WHAT IT IS NOT. The title is the document's FIRST markdown ATX
 * heading, with a heading inside a fenced code block skipped — a `# comment` in a shell
 * snippet is not the document's name. A file with no heading falls back to its filename
 * without the `.md` extension, and the answer says which of the two it used rather than
 * leaving a reader to guess.
 *
 * WHAT THIS MODULE DOES NOT PROVE. The boundary is a path check in one process, not a
 * kernel confinement: another process running as this user, between the check and the
 * read, is outside what a path check can see. The containment check narrows the window
 * by reading through the resolved path and by refusing anything that is not a regular
 * file; it does not close it. That ceiling is stated here rather than implied away.
 *
 * @module @aukora/face-documents/reader
 */
import { open, readdir, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, posix, sep } from 'node:path'
import {
  DOCUMENTS_ROOT_CATEGORY,
  type DocumentsDocumentAnswer,
  type DocumentsEntry,
  type DocumentsIndexAnswer,
  type DocumentsRefusalBody,
  type DocumentsRefusalReason,
} from './documents-route.ts'

/**
 * The one root this face reads. Every path is resolved against it and confined to it.
 *
 * **THE DEFAULT IS THE USER'S OWN, NOT ONE PERSON'S FOLDER NAME.** This was `join(homedir(), 'aukora-private')`,
 * and the comment beside it was proud of deriving the path from the home directory instead of hard-coding a machine
 * path — **which avoids one machine's name and hard-codes one PERSON's**. `aukora-private` is the name of the folder
 * the project's author keeps his own documents in, so for anybody else this face reads a directory that either does
 * not exist or, worse, happens to be theirs under that name, and presents it as the place documents live.
 *
 * The default is now the same state root the rest of the app resolves (`plugins/aukora-eye/lib/token-file.mjs`),
 * with the face's own subdirectory under it, and two overrides in the order a reader would expect: the face's own
 * variable wins, then the deployment's state root, then the standard location.
 */
export const DOCUMENTS_ROOT = process.env.AUKORA_DOCUMENTS_ROOT
  ?? join(process.env.AUKORA_STATE_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state'), 'documents')

/** The extension that decides whether a file is a document at all. */
const MARKDOWN_EXTENSION = '.md'

/** A refusal body, built in one place so every refusal names its subject. */
function refused(reason: DocumentsRefusalReason, subject: string): DocumentsRefusalBody {
  return { status: 'refused', reason, subject }
}

/** A filesystem error's stable code, or undefined when it carries none. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** Whether a path is a markdown file by its extension. Case is folded, `.MD` counts. */
export function isMarkdownPath(relativePath: string): boolean {
  return posix.extname(relativePath).toLowerCase() === MARKDOWN_EXTENSION
}

/** The category of a relative path: its first folder, or the root marker. */
export function documentsCategoryOf(relativePath: string): string {
  const at = relativePath.indexOf('/')
  return at < 0 ? DOCUMENTS_ROOT_CATEGORY : relativePath.slice(0, at)
}

/** The filename of a relative path without its markdown extension, for a title fallback. */
export function filenameTitle(relativePath: string): string {
  return posix.basename(relativePath).replace(/\.md$/iu, '')
}

/** Whether a resolved path is the root itself or sits under it. */
export function withinRoot(root: string, candidate: string): boolean {
  const boundary = root.endsWith(sep) ? root : root + sep
  return candidate === root || candidate.startsWith(boundary)
}

/** A resolved request: where it lands on disk, and how it is named. */
export type DocumentsTarget =
  | {
    readonly kind: 'resolved'
    readonly absolute: string
    readonly relative: string
    readonly category: string
  }
  | { readonly kind: 'refused'; readonly refusal: DocumentsRefusalBody }

/**
 * Resolve one requested relative path against the root, without touching disk.
 *
 * The escape check is deliberately first and purely lexical: a request for `../../x.md`
 * is refused as an escape even when the file it names happens to exist outside the root,
 * because the boundary is about where the request may point, not about what is there.
 *
 * @param root - the root the request must stay inside.
 * @param requested - the request as it arrived, `/`-separated.
 * @returns the resolved target, or the named refusal.
 */
export function resolveDocumentsTarget(root: string, requested: string): DocumentsTarget {
  if (requested === '' || requested.includes('\0') || isAbsolute(requested)) {
    return { kind: 'refused', refusal: refused('documents:path-escapes-root', requested) }
  }
  const normalized = posix.normalize(requested)
  if (posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    return { kind: 'refused', refusal: refused('documents:path-escapes-root', requested) }
  }
  if (!isMarkdownPath(normalized)) {
    return { kind: 'refused', refusal: refused('documents:not-markdown', requested) }
  }
  return {
    kind: 'resolved',
    absolute: join(root, ...normalized.split('/')),
    relative: normalized,
    category: documentsCategoryOf(normalized),
  }
}

/**
 * The title a markdown document declares: its first ATX heading, or undefined.
 *
 * A heading inside a fenced code block is skipped, because a comment in a snippet is not
 * a document title. Inline emphasis and code markers are stripped for display, and a link
 * heading contributes its label rather than its target. A heading with no text after the
 * markers does not name the document; the scan continues past it.
 *
 * @param markdown - the document's bytes.
 * @returns the heading text, or undefined when the document has no usable heading.
 */
export function titleFromMarkdown(markdown: string): string | undefined {
  let fence: string | undefined
  for (const line of markdown.split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
    if (marker !== null) {
      const character = (marker[1] ?? '`').slice(0, 1)
      if (fence === undefined) fence = character
      else if (fence === character) fence = undefined
      continue
    }
    if (fence !== undefined) continue
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/u.exec(line)
    if (heading === null) continue
    const text = headingText(heading[2] ?? '')
    if (text !== '') return text
  }
  return undefined
}

/** Strip a heading line to its display text: closing markers, links, emphasis, spacing. */
function headingText(raw: string): string {
  return raw
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replaceAll(/[*_`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The real root, or the named refusal that says why there is none. */
async function realDocumentsRoot(root: string): Promise<
  { readonly kind: 'root'; readonly real: string } | { readonly kind: 'refused'; readonly refusal: DocumentsRefusalBody }
> {
  try {
    return { kind: 'root', real: await realpath(root) }
  } catch (error) {
    const reason: DocumentsRefusalReason = errorCode(error) === 'ENOENT'
      ? 'documents:root-missing'
      : 'documents:root-unreadable'
    return { kind: 'refused', refusal: refused(reason, root) }
  }
}

/** One opened markdown file: a read-only handle plus the modification time it reported. */
export type DocumentsFileOpen =
  | { readonly kind: 'open'; readonly handle: FileHandle; readonly modifiedAt: string }
  | { readonly kind: 'refused'; readonly refusal: DocumentsRefusalBody }

/**
 * Open one file read-only and confirm it is a regular file.
 * @param absolute - the already-confined absolute path.
 * @returns the open handle with its modification time, or the named refusal.
 */
export async function openDocumentsFile(absolute: string): Promise<DocumentsFileOpen> {
  let handle: FileHandle
  try {
    // 'r' is the read-only flag: it cannot create the file, and it cannot write to it.
    handle = await open(absolute, 'r')
  } catch (error) {
    const reason: DocumentsRefusalReason = errorCode(error) === 'ENOENT'
      ? 'documents:no-such-file'
      : 'documents:unreadable'
    return { kind: 'refused', refusal: refused(reason, absolute) }
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) {
      // A directory or device named `something.md` is not a markdown file.
      void handle.close().catch(() => undefined)
      return { kind: 'refused', refusal: refused('documents:not-markdown', absolute) }
    }
    return { kind: 'open', handle, modifiedAt: info.mtime.toISOString() }
  } catch {
    void handle.close().catch(() => undefined)
    return { kind: 'refused', refusal: refused('documents:unreadable', absolute) }
  }
}

/**
 * Read an opened file's text and close it, whatever happens.
 * @param opened - the open half of {@link openDocumentsFile}.
 * @returns the text, or undefined when it could not be read.
 */
export async function readAndClose(opened: { readonly handle: FileHandle }): Promise<string | undefined> {
  try {
    return await opened.handle.readFile('utf8')
  } catch {
    return undefined
  } finally {
    void opened.handle.close().catch(() => undefined)
  }
}

/** The order the index is served in: the root's own files first, then folders, each by path. */
function compareDocuments(left: DocumentsEntry, right: DocumentsEntry): number {
  if (left.category !== right.category) {
    if (left.category === DOCUMENTS_ROOT_CATEGORY) return -1
    if (right.category === DOCUMENTS_ROOT_CATEGORY) return 1
    return left.category < right.category ? -1 : 1
  }
  if (left.path === right.path) return 0
  return left.path < right.path ? -1 : 1
}

/**
 * Walk one directory, adding every markdown file it and its real subdirectories hold.
 *
 * A SUBLINKED DIRECTORY IS NOT DESCENDED: `Dirent.isDirectory()` is false for a symlink,
 * so the walk never follows one and cannot loop or leave the root by walking. A symlinked
 * `.md` FILE is resolved and listed only when its target is inside the root.
 *
 * @param root - the real root the walk must stay inside.
 * @param directory - the real directory being listed.
 * @param prefix - the `/`-joined path from the root to `directory`.
 * @param documents - the accumulator, in walk order.
 */
async function collectMarkdown(
  root: string,
  directory: string,
  prefix: string,
  documents: DocumentsEntry[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    // An unreadable subdirectory is skipped rather than failing the whole index: one
    // locked folder must not hide every other document. The root's own absence is
    // reported by name instead, because then there is no index to serve at all.
    return
  }
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdown(root, absolute, relative, documents)
      continue
    }
    // The same resolver the single-document route uses, so the index can never list a
    // path that route would refuse.
    const target = resolveDocumentsTarget(root, relative)
    if (target.kind === 'refused') continue
    let real: string
    try {
      real = await realpath(target.absolute)
    } catch {
      // A broken link, or a file that vanished between the listing and the resolve.
      continue
    }
    if (!withinRoot(root, real)) continue
    const info = await stat(real).catch(() => undefined)
    if (info === undefined || !info.isFile()) continue
    const opened = await openDocumentsFile(real)
    const text = opened.kind === 'open' ? await readAndClose(opened) : undefined
    const heading = text === undefined ? undefined : titleFromMarkdown(text)
    documents.push({
      path: target.relative,
      title: heading ?? filenameTitle(target.relative),
      titleFrom: heading === undefined ? 'filename' : 'heading',
      category: target.category,
      modifiedAt: info.mtime.toISOString(),
    })
  }
}

/**
 * Build the index: every markdown file under the root, each with its title, category and
 * modification time, re-read on every call.
 * @param root - the root to read.
 * @returns the index, or the named refusal when the root itself cannot be read.
 */
export async function listDocuments(root: string): Promise<DocumentsIndexAnswer> {
  const resolvedRoot = await realDocumentsRoot(root)
  if (resolvedRoot.kind === 'refused') return resolvedRoot.refusal
  const documents: DocumentsEntry[] = []
  await collectMarkdown(resolvedRoot.real, resolvedRoot.real, '', documents)
  documents.sort(compareDocuments)
  return { status: 'ok', root, documents }
}

/**
 * Read one document's markdown, by its path relative to the root.
 * @param root - the root to read from.
 * @param requested - the requested relative path.
 * @returns the document, or the named refusal.
 */
export async function readDocumentsDocument(root: string, requested: string): Promise<DocumentsDocumentAnswer> {
  const target = resolveDocumentsTarget(root, requested)
  if (target.kind === 'refused') return target.refusal
  const resolvedRoot = await realDocumentsRoot(root)
  if (resolvedRoot.kind === 'refused') return resolvedRoot.refusal
  let real: string
  try {
    real = await realpath(target.absolute)
  } catch (error) {
    const reason: DocumentsRefusalReason = errorCode(error) === 'ENOENT'
      ? 'documents:no-such-file'
      : 'documents:unreadable'
    return refused(reason, requested)
  }
  // A link inside the root pointing outside it resolves outside it, and is refused as an
  // escape rather than read. The subject is the request, since that is what was refused.
  if (!withinRoot(resolvedRoot.real, real)) return refused('documents:path-escapes-root', requested)
  const opened = await openDocumentsFile(real)
  if (opened.kind === 'refused') return refused(opened.refusal.reason, requested)
  const text = await readAndClose(opened)
  if (text === undefined) return refused('documents:unreadable', requested)
  const heading = titleFromMarkdown(text)
  return {
    status: 'ok',
    path: target.relative,
    title: heading ?? filenameTitle(target.relative),
    titleFrom: heading === undefined ? 'filename' : 'heading',
    category: target.category,
    modifiedAt: opened.modifiedAt,
    markdown: text,
  }
}
