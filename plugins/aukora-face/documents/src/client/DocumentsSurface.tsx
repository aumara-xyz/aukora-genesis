/**
 * The Documents center surface: the private root's markdown, listed and read full-page.
 *
 * WHAT IT READS. One same-origin fetch of the host's index when the lane first opens, and
 * one fetch per document opened. There is no sample set behind this screen any more: an
 * empty grid means the root holds no markdown, and a failed read renders the reason the
 * host or the transport gave, by name. A screen that showed an empty list for a failed
 * read would be answering a question nobody asked.
 *
 * READ-ONLY. Opening a document fetches it; nothing on this surface writes, saves, edits
 * or copies anything, and the status line says so rather than leaving a reader to assume
 * a store exists. The root is printed on the surface because a reader is entitled to know
 * which directory was read.
 *
 * The interaction is the same open/close shape as before: the grid is a categorized set of
 * portal buttons, pressing one opens that document full-page inside the lane, and the
 * top-left return closes it back to the grid, restoring focus to the row that was open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BackIcon, DocumentIcon, SearchIcon } from './DocumentsIcons.tsx'
import { MarkdownView } from './MarkdownView.tsx'
import { parseMarkdown } from './markdown.ts'
import {
  failureText,
  readDocumentsDocument,
  readDocumentsIndex,
  type DocumentsFailure,
} from './documents-loader.ts'
import {
  DOCUMENTS_ROOT_CATEGORY,
  type DocumentsEntry,
  type DocumentsIndexBody,
} from '../documents-route.ts'
import css from './Documents.module.css'

/** What the index area is showing: nothing yet, a read in flight, the index, or why not. */
type IndexView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly index: DocumentsIndexBody }
  | { readonly kind: 'failed'; readonly failure: DocumentsFailure }

/** What the reader area is showing. */
type DocumentView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entry: DocumentsEntry; readonly markdown: string }
  | { readonly kind: 'failed'; readonly failure: DocumentsFailure }

/** Props assembled for the always-mounted Documents center surface. */
export type DocumentsSurfaceProps =
  PropsRuntime<'shell.surface'>
  & PropsLocale<'documents'>

/** True when the event target is a text-entry control that owns its own keys. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/** A stable `YYYY-MM-DD HH:MM UTC` view of an ISO instant; the raw value when it is not one. */
function formatModified(instant: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(instant)
  return match === null ? instant : `${match[1] ?? ''} ${match[2] ?? ''} UTC`
}

/** The visible failure state: the named reason, and what it means for this list. */
function FailureNotice({ failure, t }: { readonly failure: DocumentsFailure; readonly t: PropsLocale<'documents'>['t'] }) {
  return (
    <div className={css.failure} data-documents-error role="alert">
      <strong className={css.failureTitle}>{t('error.title')}</strong>
      <code className={css.failureReason} data-documents-error-reason>{failureText(failure)}</code>
      <span className={css.failureHint}>{t('error.hint')}</span>
    </div>
  )
}

/**
 * Render the Documents lane: the root's markdown grouped by folder, and one document
 * full-page as rendered markdown with a top-left return.
 * @param props - shell visibility, close action, and localized copy.
 * @returns the always-mounted Documents surface.
 */
export function DocumentsSurface({ activeSurface, closeSurface, t }: DocumentsSurfaceProps) {
  const active = activeSurface === 'documents'
  const [index, setIndex] = useState<IndexView>({ kind: 'idle' })
  const [category, setCategory] = useState<string | 'all'>('all')
  const [query, setQuery] = useState('')
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [opened, setOpened] = useState<DocumentView>({ kind: 'idle' })
  const indexGeneration = useRef(0)
  const documentGeneration = useRef(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const returnButtonRef = useRef<HTMLButtonElement>(null)
  const returnToRef = useRef<string | null>(null)

  // A read that is superseded — by a refresh, or by the lane closing — must not land:
  // the generation counter is what makes a slow answer unable to overwrite a newer one.
  const loadIndex = useCallback((): void => {
    indexGeneration.current += 1
    const mine = indexGeneration.current
    setIndex({ kind: 'loading' })
    void readDocumentsIndex().then((read) => {
      if (indexGeneration.current !== mine) return
      setIndex(read.kind === 'ready'
        ? { kind: 'ready', index: read.value }
        : { kind: 'failed', failure: read.failure })
    })
  }, [])

  const loadDocument = useCallback((relativePath: string): void => {
    documentGeneration.current += 1
    const mine = documentGeneration.current
    setOpened({ kind: 'loading' })
    void readDocumentsDocument(relativePath).then((read) => {
      if (documentGeneration.current !== mine) return
      if (read.kind === 'failed') {
        setOpened({ kind: 'failed', failure: read.failure })
        return
      }
      const body = read.value
      setOpened({
        kind: 'ready',
        entry: {
          path: body.path,
          title: body.title,
          titleFrom: body.titleFrom,
          category: body.category,
          modifiedAt: body.modifiedAt,
        },
        markdown: body.markdown,
      })
    })
  }, [])

  useEffect(() => () => {
    // Unmounting invalidates both reads in flight.
    indexGeneration.current += 1
    documentGeneration.current += 1
  }, [])

  // The first activation reads the root. A later activation keeps the listing it has,
  // because the operator can refresh it deliberately rather than being re-read at.
  useEffect(() => {
    if (!active) return
    if (index.kind !== 'idle') return
    loadIndex()
  }, [active, index.kind, loadIndex])

  const documents = index.kind === 'ready' ? index.index.documents : []
  const root = index.kind === 'ready' ? index.index.root : ''

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const entry of documents) seen.add(entry.category)
    return [...seen].sort((left, right) => {
      if (left === right) return 0
      if (left === DOCUMENTS_ROOT_CATEGORY) return -1
      if (right === DOCUMENTS_ROOT_CATEGORY) return 1
      return left < right ? -1 : 1
    })
  }, [documents])

  // A category can disappear when the tree changes; the filter falls back to all rather
  // than leaving the grid showing an empty folder that no longer exists.
  useEffect(() => {
    if (category !== 'all' && !categories.includes(category)) setCategory('all')
  }, [categories, category])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return documents.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false
      if (needle === '') return true
      return `${entry.title} ${entry.path} ${entry.category}`.toLowerCase().includes(needle)
    })
  }, [documents, category, query])

  const grouped = useMemo(
    () => categories
      .map(id => ({ id, entries: visible.filter(entry => entry.category === id) }))
      .filter(group => group.entries.length > 0),
    [categories, visible],
  )

  const blocks = useMemo(
    () => (opened.kind === 'ready' ? parseMarkdown(opened.markdown) : []),
    [opened],
  )

  useEffect(() => {
    if (!active) return
    // Bubble-phase, deferring to consumed events: Modal/Menu take Escape in
    // capture and mark it defaultPrevented, and Escape inside a text-entry
    // control belongs to that control. An unclaimed press peels one layer: the
    // open document first, then the surface.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      if (openPath !== null) {
        documentGeneration.current += 1
        setOpenPath(null)
        setOpened({ kind: 'idle' })
      } else closeSurface()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [active, closeSurface, openPath])

  // Returning puts focus back on the row that was open, so the keyboard never falls to
  // the body and out of the surface.
  useEffect(() => {
    if (!active) return
    if (openPath !== null) return
    const returning = returnToRef.current
    if (returning === null) return
    returnToRef.current = null
    const portal = gridRef.current?.querySelector(`[data-document-portal="${CSS.escape(returning)}"]`)
    if (portal instanceof HTMLElement) portal.focus()
  }, [active, openPath])

  // Opening moves focus to the return control, which is the only way back with a keyboard.
  useEffect(() => {
    if (openPath === null) return
    returnButtonRef.current?.focus()
  }, [openPath])

  const openDocument = (entry: DocumentsEntry): void => {
    returnToRef.current = entry.path
    setOpenPath(entry.path)
    loadDocument(entry.path)
  }

  const closeDocument = (): void => {
    documentGeneration.current += 1
    setOpenPath(null)
    setOpened({ kind: 'idle' })
  }

  return (
    <section
      data-documents-surface
      className={css.surface}
      hidden={!active}
      aria-hidden={!active}
      aria-label={t('title')}
    >
      {openPath === null
        ? (
            <div className={css.lane}>
              <div className={css.brandRow}>
                <h2 className={css.brandName}>{t('title')}</h2>
                <button
                  type="button"
                  className={css.textButton}
                  data-documents-refresh
                  onClick={loadIndex}
                  disabled={index.kind === 'loading'}
                >
                  {t('actions.refresh')}
                </button>
              </div>

              <p className={css.posture} data-documents-posture>{t('runtime.status')}</p>
              {index.kind === 'ready'
                ? (
                    <p className={css.posture} data-documents-root>
                      {t('runtime.root')}
                      {' '}
                      <code className={css.postureCode}>{root}</code>
                      {' · '}
                      {documents.length}
                      {' '}
                      {t('count.documents')}
                    </p>
                  )
                : null}

              <div className={css.searchRow}>
                <span className={css.searchMark} aria-hidden="true">
                  <SearchIcon size={16} />
                </span>
                <label className={css.visuallyHidden} htmlFor="documents-search">{t('search.label')}</label>
                <input
                  id="documents-search"
                  className={css.searchInput}
                  type="search"
                  value={query}
                  placeholder={t('search.placeholder')}
                  onChange={(event) => { setQuery(event.target.value) }}
                />
              </div>

              {categories.length > 0
                ? (
                    <nav className={css.categoryRow} aria-label={t('nav.categories')}>
                      <button
                        type="button"
                        className={css.categoryChip}
                        aria-pressed={category === 'all'}
                        onClick={() => { setCategory('all') }}
                      >
                        {t('nav.all')}
                      </button>
                      {categories.map(id => (
                        <button
                          key={id}
                          type="button"
                          className={css.categoryChip}
                          aria-pressed={category === id}
                          onClick={() => { setCategory(id) }}
                        >
                          {id === DOCUMENTS_ROOT_CATEGORY ? t('category.root') : id}
                        </button>
                      ))}
                    </nav>
                  )
                : null}

              <div className={css.grid} ref={gridRef}>
                {index.kind === 'loading' ? <p className={css.listEmpty}>{t('state.loading')}</p> : null}
                {index.kind === 'failed'
                  ? <FailureNotice failure={index.failure} t={t} />
                  : null}
                {index.kind === 'ready' && documents.length === 0
                  ? <p className={css.listEmpty}>{t('list.empty')}</p>
                  : null}
                {index.kind === 'ready' && documents.length > 0 && grouped.length === 0
                  ? <p className={css.listEmpty}>{t('list.none')}</p>
                  : null}
                {grouped.map(group => (
                  <section
                    key={group.id}
                    className={css.group}
                    aria-label={group.id === DOCUMENTS_ROOT_CATEGORY ? t('category.root') : group.id}
                  >
                    <h3 className={css.groupHeading}>
                      {group.id === DOCUMENTS_ROOT_CATEGORY ? t('category.root') : group.id}
                      <span className={css.groupCount}>
                        {group.entries.length}
                        {' '}
                        {t('count.documents')}
                      </span>
                    </h3>
                    <div className={css.portals}>
                      {group.entries.map(entry => (
                        <button
                          key={entry.path}
                          type="button"
                          data-document-portal={entry.path}
                          className={css.portal}
                          onClick={() => { openDocument(entry) }}
                        >
                          <span className={css.portalMark} aria-hidden="true">
                            <DocumentIcon size={18} />
                          </span>
                          <span className={css.portalCopy}>
                            <strong className={css.portalTitle}>{entry.title}</strong>
                            <span className={css.portalPath}>{entry.path}</span>
                            <span className={css.portalMeta}>
                              {formatModified(entry.modifiedAt)}
                              {entry.titleFrom === 'filename' ? ` · ${t('meta.filenameTitle')}` : ''}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )
        : (
            <article
              className={css.reader}
              data-document-open={openPath}
              aria-label={opened.kind === 'ready' ? opened.entry.title : openPath}
            >
              <header className={css.readerHeader}>
                <button
                  ref={returnButtonRef}
                  type="button"
                  className={css.iconButton}
                  data-document-return
                  onClick={closeDocument}
                  aria-label={t('back')}
                >
                  <BackIcon size={16} />
                </button>
                <h2 className={css.readerTitle}>
                  {opened.kind === 'ready' ? opened.entry.title : openPath}
                </h2>
              </header>

              <div className={css.readerMeta}>
                <span>{openPath}</span>
                {opened.kind === 'ready'
                  ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatModified(opened.entry.modifiedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('meta.category')}
                          {' '}
                          {opened.entry.category === DOCUMENTS_ROOT_CATEGORY
                            ? t('category.root')
                            : opened.entry.category}
                        </span>
                      </>
                    )
                  : null}
              </div>

              <div className={css.readerBody}>
                {opened.kind === 'loading' ? <p className={css.listEmpty}>{t('reader.loading')}</p> : null}
                {opened.kind === 'failed' ? <FailureNotice failure={opened.failure} t={t} /> : null}
                {opened.kind === 'ready' ? <MarkdownView blocks={blocks} /> : null}
              </div>
            </article>
          )}
    </section>
  )
}
