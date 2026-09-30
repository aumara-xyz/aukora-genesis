/** A paged memory view inside the existing centre lane. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TIER_TABS, INITIAL_VIEW, citedIdsOf, itemsOf, receiptBadgeOf } from './memory-model.ts'
import type { MemoryView } from './memory-model.ts'
import { MemoryServiceError, httpMemorySource, WHY_MANIFEST_ROUTE } from './memory-api.ts'
import type { MemoryRecord } from './memory-api.ts'
import { ActionButton, PortalButton, SectionHeader, type Accent } from '@aukora/face-layout/client'
import css from './Memory.module.css'

export type MemorySurfaceProps = PropsRuntime<'shell.surface'> & PropsLocale<'memory'>
  & { readonly openSource?: (sessionId: string) => void; readonly surfaceTarget?: string }
const SOURCE = httpMemorySource()
const TONE: Record<MemoryView['tier'], Accent> = { remembered: 'green', signed: 'gold', proposal: 'purple', forgotten: 'blue' }
const dateText = (at: number | null): string => at === null ? '—' : new Date(at).toLocaleDateString()
const errorCode = (error: unknown): string => error instanceof MemoryServiceError ? error.code : 'memory:request-failed'

function WarningIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 22 21H2Z" />
  </svg>
}

export function MemorySurface({ activeSurface, t, openSource, surfaceTarget }: MemorySurfaceProps) {
  const active = activeSurface === 'memory'
  const [view, setView] = useState<MemoryView>(INITIAL_VIEW)
  const [records, setRecords] = useState<readonly MemoryRecord[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [issues, setIssues] = useState<readonly string[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [paging, setPaging] = useState(false)
  const [revision, setRevision] = useState(0)
  const [openTier, setOpenTier] = useState<MemoryView['tier'] | null>('remembered')
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ id: string; code: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [whyTrouble, setWhyTrouble] = useState(false)
  const generation = useRef(0)
  const pageInFlight = useRef(false)
  const scroller = useRef<HTMLElement>(null)
  const more = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!active || openTier === null) return
    const current = ++generation.current
    const abort = new AbortController()
    pageInFlight.current = false
    setPaging(false)
    setState('loading')
    setRecords([])
    setNext(null)
    setIssues([])
    const timer = window.setTimeout(() => {
      void SOURCE.list({ tier: view.tier, q: view.query, signal: abort.signal }).then(answer => {
        if (current !== generation.current || abort.signal.aborted) return
        setRecords(answer.items)
        setNext(answer.next)
        setIssues(answer.issues ?? [])
        setState('ready')
      }).catch((error: unknown) => {
        if (current !== generation.current || abort.signal.aborted) return
        setIssues([errorCode(error)])
        setState('failed')
      })
    }, view.query ? 250 : 0)
    return () => { window.clearTimeout(timer); abort.abort(); ++generation.current }
  }, [active, openTier, view.tier, view.query, revision])

  const loadMore = useCallback(() => {
    if (!next || pageInFlight.current || state !== 'ready') return
    pageInFlight.current = true
    setPaging(true)
    const current = generation.current
    void SOURCE.list({ tier: view.tier, q: view.query, before: next }).then(answer => {
      if (current !== generation.current) return
      setRecords(previous => {
        const merged = new Map(previous.map(record => [record.id, record]))
        for (const record of answer.items) merged.set(record.id, record)
        return [...merged.values()]
      })
      setNext(answer.next)
      if (answer.issues?.length) setIssues(previous => [...new Set([...previous, ...answer.issues!])])
    }).catch((error: unknown) => {
      if (current !== generation.current) return
      setIssues(previous => [...previous, errorCode(error)])
      setNext(null)
    }).finally(() => {
      if (current !== generation.current) return
      pageInFlight.current = false
      setPaging(false)
    })
  }, [next, state, view.tier, view.query])

  useEffect(() => {
    if (!active || !next || !more.current || paging) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore()
    }, { root: scroller.current, rootMargin: '0px 0px 180px 0px' })
    observer.observe(more.current)
    return () => { observer.disconnect() }
  }, [active, next, paging, loadMore])

  useEffect(() => {
    if (!surfaceTarget) {
      setView(current => ({ ...current, citedIds: null }))
      setWhyTrouble(false)
      return
    }
    const abort = new AbortController()
    void fetch(`${WHY_MANIFEST_ROUTE}?reply=${encodeURIComponent(surfaceTarget)}`, { credentials: 'same-origin', signal: abort.signal })
      .then(answer => answer.ok ? answer.json() : null).then((answer: unknown) => {
        if (abort.signal.aborted) return
        setWhyTrouble(answer === null)
        setView(current => ({ ...current, citedIds: citedIdsOf(answer) }))
      }).catch(() => { if (!abort.signal.aborted) setWhyTrouble(true) })
    return () => { abort.abort() }
  }, [surfaceTarget])

  // Search was already ranked by the server. A substring filter would discard semantic paraphrases.
  const items = itemsOf({ items: records }, { ...view, query: '', ranked: view.query.trim() !== '' }).items
  const forget = (id: string) => {
    if (busy) return
    setBusy(id)
    setActionError(null)
    void SOURCE.forget(id).then(() => {
      ++generation.current
      setRecords(previous => previous.filter(record => record.id !== id))
      setView(current => ({ ...current, confirmingForget: null }))
      setOpenItem(null)
      setRevision(value => value + 1)
    }).catch((error: unknown) => { setActionError({ id, code: errorCode(error) }) })
      .finally(() => { setBusy(null) })
  }

  return (
    <section ref={scroller} className={css.memoryView} data-memory-surface data-source="live"
      aria-label={t('view.title')} hidden={!active} aria-hidden={!active}>
      <SectionHeader className={css.memoryHead}>
        <h2 className={css.memoryTitle}>{t('view.title')}</h2>
        {whyTrouble ? <span className={css.memoryProblem} role="img" aria-label={t('surface.whyTrouble')} title={t('surface.whyTrouble')}><WarningIcon /></span> : null}
      </SectionHeader>
      <div className={css.portals}>
        {TIER_TABS.map(each => {
          const open = openTier === each.tier
          return (
            <PortalButton key={each.tier} variant={TONE[each.tier]} expanded={open}
              containerProps={{ 'data-memory-tab': each.tier }}
              title={t(`tab.${each.tier}` as 'tab.remembered')}
              subtitle={t(`tab.${each.tier}.blurb` as 'tab.remembered.blurb')}
              icon={<span className={css.portalDot} aria-hidden="true" />}
              buttonClassName={css.portalHead} contentClassName={css.portalBody}
              contentProps={{ 'aria-busy': state === 'loading' || paging }} onExpandedChange={nextOpen => {
                setOpenItem(null)
                setActionError(null)
                setOpenTier(nextOpen ? each.tier : null)
                if (nextOpen) setView(current => ({ ...current, tier: each.tier, query: '', confirmingForget: null }))
              }}>
                <input type="search" className={css.portalSearch} data-memory-search placeholder={t('search.placeholder')}
                  aria-label={t('search.placeholder')} value={view.query} onChange={event => {
                    setOpenItem(null)
                    setView(current => ({ ...current, query: event.target.value, confirmingForget: null }))
                  }} />
                {state === 'loading' ? <span className={css.portalQuiet} role="img" aria-label={t('surface.loading')}>⋯</span> : null}
                {issues.length ? <ActionButton type="button" variant="red-warning" className={css.retry} data-memory-failed={state === 'failed' ? 'failed' : 'partial'}
                  data-memory-error={issues.join(',')} title={issues.join('\n')} aria-label={t('surface.failed')}
                  onClick={() => { setRevision(value => value + 1) }}>↻</ActionButton> : null}
                {state === 'ready' && !issues.length && !next && items.length === 0 ? <p className={css.portalQuiet} data-memory-empty={view.tier}>{t('surface.empty')}</p> : null}
                <ul className={css.memoryList}>
                  {items.map(item => {
                    const expanded = openItem === item.id
                    const confirming = view.confirmingForget === item.id
                    const mutable = !item.erased && item.tier !== 'signed'
                    return <li key={item.id} className={css.memoryItem} data-memory-row={item.id}
                      data-memory-backend={item.backend} data-memory-author={item.author ?? 'unknown'} data-open={expanded ? 'yes' : 'no'}>
                      <PortalButton variant={TONE[each.tier]} expanded={expanded} showIndicator={false}
                        buttonClassName={css.memoryPortal} contentClassName={css.memoryDetail}
                        title={<span className={css.memoryWords}>{item.text}</span>}
                        onExpandedChange={nextOpen => { setOpenItem(nextOpen ? item.id : null) }}
                        trailing={<span className={css.memoryWhen}>
                          {item.author === 'Peter' || item.author === 'agent' ? <svg width="14" height="14" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={item.author}>
                            {item.author === 'Peter' ? <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>
                              : <><rect x="4" y="7" width="16" height="14" rx="3" /><path d="M12 3v4M8 12v2m8-2v2M9 17h6" /></>}
                          </svg> : null}
                          <time dateTime={item.createdAt === null ? undefined : new Date(item.createdAt).toISOString()}>
                            {dateText(item.createdAt)}
                          </time>
                        </span>}>
                        <div className={css.memoryActions}>
                          {item.source.sessionId && openSource ? <ActionButton type="button" className={css.pill}
                            onClick={() => { openSource(item.source.sessionId!) }}>{t('action.openSource')}</ActionButton> : null}
                          {mutable && item.backend === 'kira' ? <ActionButton type="button" className={css.pill} variant="green" data-memory-verify={item.id}
                            disabled={busy !== null} title={item.receipt.label} onClick={() => {
                              setBusy(item.id)
                              void SOURCE.verify(item.id).then(answer => {
                                setView(current => ({ ...current, receipts: { ...current.receipts, [item.id]: receiptBadgeOf(answer) } }))
                                setActionError(null)
                              }).catch((error: unknown) => { setActionError({ id: item.id, code: errorCode(error) }) })
                                .finally(() => { setBusy(null) })
                            }}>{view.receipts[item.id] ? item.receipt.glyph : t('action.verify')}</ActionButton> : null}
                          {mutable ? confirming ? <>
                            <ActionButton type="button" className={css.pill} variant="red-warning" data-memory-forget-confirm={item.id} disabled={busy !== null}
                              onClick={() => { forget(item.id) }}>{t('action.confirm')}</ActionButton>
                            <ActionButton type="button" className={css.pill} data-memory-keep={item.id} disabled={busy !== null}
                              onClick={() => { setView(current => ({ ...current, confirmingForget: null })); setActionError(null) }}>{t('action.cancel')}</ActionButton>
                          </> : <ActionButton type="button" className={css.pill} variant="red-warning" data-memory-forget={item.id} disabled={busy !== null}
                            onClick={() => { setActionError(null); setView(current => ({ ...current, confirmingForget: item.id })) }}>{t('action.forget')}</ActionButton> : null}
                          {actionError?.id === item.id ? <span className={css.memoryProblem} data-memory-action-failed={actionError.code}
                            role="img" aria-label={t('surface.actionFailed')} title={actionError.code}><WarningIcon /></span> : null}
                        </div>
                      </PortalButton>
                    </li>
                  })}
                </ul>
                {next ? <ActionButton ref={more} type="button" className={css.more} variant={TONE[each.tier]} data-memory-more disabled={paging}
                  aria-label={t('action.more')} onClick={loadMore}>{paging ? '⋯' : '↓'}</ActionButton> : null}
            </PortalButton>
          )
        })}
      </div>
    </section>
  )
}
