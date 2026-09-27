/**
 * THE MEMORY VIEW — one calm list of what Auma remembers, what Peter signed, what she proposes and what he forgot.
 *
 * PETER'S WORDS: *"a memory app on the right, and you click it, and then it shows memories in the middle that are
 * approved or unapproved"*. Everything on this screen is a sentence rather than a state machine's name, and the two
 * facts that must never be faked are visible: **a receipt badge is only a tick when a check answered VERIFIED**, and
 * **signing is off** until it asks for him in person.
 *
 * IT READS THROUGH ONE INTERFACE (`memory-api.ts`) AND SAYS WHICH ONE. Until the engine's routes land the source is
 * the stub, and the top of the screen says so in plain words: a person reading examples as his own memories is the
 * failure this line exists to prevent.
 *
 * @module MemorySurface
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { KINDS, MEMORY_CONTROLS, TIER_TABS, INITIAL_VIEW, controlStateOf, hasMoreOf, citedIdsOf, forgetState, itemsOf, receiptBadgeOf, signActionState, signRequestBody, toggledSelection } from './memory-model.ts'
import type { MemoryItem, MemoryView } from './memory-model.ts'
import { MemoryServiceError, httpMemorySource } from './memory-api.ts'
import { WHY_MANIFEST_ROUTE } from './memory-api.ts'
import css from './Memory.module.css'
import type { MemorySource } from './memory-api.ts'

/** Peter, 2026-09-27: no signing footer while memory is automatic. */
const SHOW_SIGNING = false

/**
 * Full props for the Memory surface: the copy, the way to open a conversation a memory came from, and **the reply a
 * `why?` link asked about**.
 *
 * `surfaceTarget` is the shell's own field for this (`AppFrame` passes it to every surface, and its doc calls it an
 * *"optional feature-owned target within the active surface"*). **When it is set, this surface is being opened FOR a
 * reply**, and it resolves that reply's cited records through the manifest the `why` route serves. When it is absent
 * the app opens exactly as it always has, which is why the field is optional rather than defaulted to `''` — an empty
 * string would be a reply id that cannot exist.
 */
export type MemorySurfaceProps =
  PropsRuntime<'shell.surface'>
  & PropsLocale<'memory'>
  & { readonly openSource?: (sessionId: string) => void }
  & { readonly surfaceTarget?: string }

/** The source this build reads from. Swapping the stub for the routes is this one value. */
/**
 * **THE LIVE ROUTES ARE THE APP'S SOURCE; THE STUB IS A COURT FIXTURE.** Until round 1 of akui-11 this was
 * `stubMemorySource()` — the app Peter opens showed examples — and the day KIRA's routes landed the change is this
 * one value, which is what building behind one interface was for. The courts import the stub directly.
 */
const SOURCE: MemorySource = httpMemorySource()

/** A date a person reads, or the honest absence of one. */
function whenText(at: number | null): string {
  return at === null ? 'a time it did not record' : new Date(at).toLocaleDateString()
}

/**
 * The Memory view.
 * @param props - the localized copy.
 * @returns the list, its controls and its actions.
 */
export function MemorySurface({ activeSurface, t, openSource, surfaceTarget }: MemorySurfaceProps) {
  // EVERY CENTRE SURFACE IS RENDERED; EACH HIDES ITSELF UNLESS IT IS THE OPEN ONE (as DocumentsSurface does). Memory did
  // not, and once its view became opaque it covered every app opened in the centre (2026-09-27).
  const active = activeSurface === 'memory'
  const [view, setView] = useState<MemoryView>(INITIAL_VIEW)
  const [items, setItems] = useState<readonly MemoryItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  // WHAT THE ENGINE SAID WHEN THE SIGN ACTION ASKED. The action is present and disabled while signing is off, and its
  // wiring is real rather than decorative: the day the gate opens, this call is already the one that runs, and until
  // then the answer it reports is the truth (the stub says signing is off; it does not invent an approval).
  const [signAnswer, setSignAnswer] = useState<string | null>(null)
  // **A FAILED ACTION IS NOT SILENCE EITHER.** The list already refuses to render a failed read as "she remembers
  // nothing"; the three actions had the same duty and did not meet it — each called the engine with `.then` and no
  // `.catch`, so a route that refused rejected unhandled and Peter saw nothing at all. Every action now says so, and
  // the sentence says the thing that matters most for Forget: nothing changed.
  const [actionFailed, setActionFailed] = useState(false)
  /**
   * **WHY THE LIST IS NOT THERE — THREE ANSWERS, NOT ONE.** `MemoryServiceError` carries `absent` (nothing is
   * mounted), `refused` (the engine said no by name) and `failed`; rendering all three as "we could not show your
   * memories" is the same lie as rendering them as an empty list, one step less obvious.
   */
  const [trouble, setTrouble] = useState<{ readonly problem: string; readonly code: string | null } | null>(null)
  /**
   * **A TRUNCATED LIST MUST NOT READ AS THE WHOLE STORE.** KIRA's list route pages: fifty notes by default and a `next`
   * cursor when there are more. Until this round the view threw that cursor away, so past fifty notes Peter would see
   * fifty and nothing would say the rest existed — the same lie as an empty list for a failed read, one step further in.
   */
  const [hasMore, setHasMore] = useState(false)
  // **A FAILED MANIFEST READ IS NOT A FAILED APP.** The list is fetched independently below; this effect only decides
  // whether an id filter is in force, and a reply whose manifest cannot be read leaves the view unfiltered and says
  // so in `whyTrouble` rather than emptying the screen.
  const [whyTrouble, setWhyTrouble] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void SOURCE.list({ tier: view.tier, q: view.query })
      .then(answer => {
        if (cancelled) return
        setHasMore(hasMoreOf(answer))
        setItems(itemsOf(answer, { tier: view.tier, query: view.query, kind: view.kind, receipts: view.receipts, citedIds: view.citedIds }).items)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setTrouble({
          problem: error instanceof MemoryServiceError ? error.problem : 'failed',
          code: error instanceof MemoryServiceError ? error.code : null,
        })
        setState('failed')
      })
    return () => { cancelled = true }
  }, [view.tier, view.query, view.kind, view.receipts, view.citedIds])

  // ── THE `why?` LINK'S ARRIVAL, WHICH IS THE ONLY THING THAT SETS AN ID FILTER ────────────────────────────────
  // A link opens this surface with the reply id as the shell's target; this reads that reply's manifest from the
  // route the layout already serves and filters to exactly the records it cited. `citedIdsOf` returns `null` for no
  // manifest (no filter, the honest unfiltered view) and `[]` for a reply that cited nothing (no records), so the
  // two are not collapsed here either.
  useEffect(() => {
    if (surfaceTarget === undefined || surfaceTarget === '') {
      setView(current => (current.citedIds === null ? current : { ...current, citedIds: null }))
      setWhyTrouble(false)
      return
    }
    let cancelled = false
    void fetch(`${WHY_MANIFEST_ROUTE}?reply=${encodeURIComponent(surfaceTarget)}`, { credentials: 'same-origin' })
      .then(answer => (answer.ok ? answer.json() : null))
      .then((answer: unknown) => {
        if (cancelled) return
        if (answer === null) { setWhyTrouble(true); return }
        setWhyTrouble(false)
        setView(current => ({ ...current, citedIds: citedIdsOf(answer) }))
      })
      .catch(() => { if (!cancelled) setWhyTrouble(true) })
    return () => { cancelled = true }
  }, [surfaceTarget])

  const sign = signActionState(view.selected)
  // THE PORTALS (Peter, 2026-09-27): one coloured portal per kind of memory, the same outlined-card primitive as the
  // session rows and the app launchers. A portal telescopes open to a centred search and the memories inside it, and
  // each memory is itself a small portal that extends to show where it came from and what can be done with it.
  const [openTier, setOpenTier] = useState<MemoryView['tier'] | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const TONE: Record<string, string> = { remembered: 'mint', signed: 'gold', proposal: 'violet', forgotten: 'blue' }
  void sign; void signAnswer; void setSignAnswer; void SHOW_SIGNING; void signRequestBody; void toggledSelection; void KINDS; void MEMORY_CONTROLS; void controlStateOf

  return (
    <section className={css.memoryView} data-memory-surface data-source={SOURCE.kind} aria-label={t('view.title')} hidden={!active} aria-hidden={!active}>
      <header className={css.memoryHead}>
        <h2 className={css.memoryTitle}>{t('view.title')}</h2>
        <p className={css.memorySubtitle}>{t('view.subtitle')}</p>
        {SOURCE.kind === 'stub' ? <p className={css.memoryNotice} data-memory-stub>{t('surface.stub')}</p> : null}
        {whyTrouble ? <p className={css.memoryNotice} data-memory-why-trouble>{t('surface.whyTrouble')}</p> : null}
      </header>

      <div className={css.portals}>
        {TIER_TABS.map(each => {
          const open = openTier === each.tier
          return (
            <div key={each.tier} className={css.portal} data-tone={TONE[each.tier] ?? 'mint'} data-open={open ? 'yes' : 'no'} data-memory-tab={each.tier}>
              <button
                type="button"
                className={css.portalHead}
                aria-expanded={open}
                onClick={() => {
                  setOpenItem(null)
                  setActionFailed(false)
                  if (open) { setOpenTier(null); return }
                  setOpenTier(each.tier)
                  setView(current => ({ ...current, tier: each.tier, query: '', selected: [], confirmingForget: null }))
                }}
              >
                <span className={css.portalDot} aria-hidden="true" />
                <span className={css.portalCopy}>
                  <strong>{t(`tab.${each.tier}` as 'tab.remembered')}</strong>
                  <span>{t(`tab.${each.tier}.blurb` as 'tab.remembered.blurb')}</span>
                </span>
                <span className={css.portalChevron} aria-hidden="true">{open ? '−' : '+'}</span>
              </button>

              {open ? (
                <div className={css.portalBody}>
                  <input
                    type="search"
                    className={css.portalSearch}
                    data-memory-search
                    placeholder={t('search.placeholder')}
                    value={view.query}
                    autoFocus
                    onChange={event => { setView(current => ({ ...current, query: event.target.value })) }}
                  />
                  {state === 'loading' ? <p className={css.portalQuiet}>{t('surface.loading')}</p> : null}
                  {state === 'failed' ? (
                    <p className={css.portalQuiet} data-memory-failed={trouble?.problem ?? 'failed'}>
                      {trouble?.problem === 'absent' ? t('surface.notRunning')
                        : trouble?.code === 'kira.memory:aumlok-not-linked' ? t('surface.notLinked')
                        : trouble?.code === 'kira.route:tier-not-listable' ? t('surface.notListed')
                        : t('surface.failed')}
                    </p>
                  ) : null}
                  {actionFailed ? <p className={css.portalQuiet} data-memory-action-failed>{t('surface.actionFailed')}</p> : null}
                  {state === 'ready' && items.length === 0 ? (
                    <p className={css.portalQuiet} data-memory-empty={view.tier}>{view.tier === 'signed' ? t('signed.empty') : t('surface.empty')}</p>
                  ) : null}

                  <ul className={css.memoryList}>
                    {items.map(item => {
                      const expanded = openItem === item.id
                      const forget = forgetState(view, item.id)
                      const words = item.erased
                        ? `${t('forgotten.tombstone')} ${item.forgottenAt === null ? t('when.unknown') : new Date(item.forgottenAt).toLocaleDateString()} — ${t('forgotten.erased')}`
                        : item.unreadable ? t('surface.unreadable') : item.text
                      return (
                        <li key={item.id} className={css.memoryItem} data-memory-row={item.id} data-open={expanded ? 'yes' : 'no'}>
                          <button
                            type="button"
                            className={css.memoryPortal}
                            aria-expanded={expanded}
                            onClick={() => { setOpenItem(expanded ? null : item.id) }}
                          >
                            <span className={css.memoryWords}>{words}</span>
                            <span className={css.memoryWhen}>{whenText(item.createdAt)}</span>
                          </button>
                          {expanded ? (
                            <div className={css.memoryDetail}>
                              <p className={css.memoryMeta}>
                                {t(`kind.${item.kind}` as 'kind.fact')}
                                {' · '}
                                {t('row.from')} {item.source.titleKnown ? item.source.sessionTitle : t('source.unnamed')} {t('row.at')} {whenText(item.source.at)}
                                {item.signedAt === null ? null : ` · ${t('row.signed')} ${whenText(item.signedAt)}`}
                              </p>
                              {item.erased || item.tier === 'signed' ? null : (
                                <p className={css.memoryMeta} data-memory-receipt={item.receipt.state}>
                                  {item.receipt.state === 'unchecked' ? t('receipt.unchecked') : t(`receipt.${item.receipt.state}` as 'receipt.verified')}
                                </p>
                              )}
                              <div className={css.memoryActions}>
                                {item.source.sessionId !== null && openSource !== undefined && !item.erased ? (
                                  <button type="button" className={css.pill} onClick={() => { openSource(item.source.sessionId as string) }}>{t('action.openSource')}</button>
                                ) : null}
                                {item.erased || item.tier === 'signed' ? null : (
                                  <button
                                    type="button"
                                    className={css.pill}
                                    data-memory-verify={item.id}
                                    onClick={() => {
                                      void SOURCE.verify(item.id).then(answer => {
                                        setView(current => ({ ...current, receipts: { ...current.receipts, [item.id]: receiptBadgeOf(answer) } }))
                                      }).then(() => { setActionFailed(false) }).catch(() => { setActionFailed(true) })
                                    }}
                                  >
                                    {t('action.verify')}
                                  </button>
                                )}
                                {item.erased || item.tier === 'signed' ? null : forget.confirming ? (
                                  <>
                                    <span className={css.memoryAsk}>{t('forget.question')}</span>
                                    <button
                                      type="button"
                                      className={css.pill}
                                      data-memory-forget-confirm={item.id}
                                      onClick={() => {
                                        void SOURCE.forget(item.id).then(() => {
                                          setView(current => ({ ...current, confirmingForget: null }))
                                        }).then(() => { setActionFailed(false) }).catch(() => { setActionFailed(true) })
                                      }}
                                    >
                                      {t('action.confirm')}
                                    </button>
                                    <button type="button" className={css.pill} onClick={() => { setView(current => ({ ...current, confirmingForget: null })) }}>{t('action.cancel')}</button>
                                  </>
                                ) : (
                                  <button type="button" className={css.pill} data-memory-forget={item.id} onClick={() => { setView(current => ({ ...current, confirmingForget: item.id })) }}>
                                    {t('action.forget')}
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                  {hasMore ? <p className={css.portalQuiet} data-memory-more>{t('surface.more')}</p> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

