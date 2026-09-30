/**
 * Spatial root shell: a persistent left thread/conversation stack, center app
 * canvas, and right menu/details. Every occupant remains mounted across lane
 * navigation; hot corners select one of the store's closed presets.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useId, useLayoutEffect, useRef, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { MenuItemOwnerProps, SurfaceOwnerProps } from './types.ts'
import { NS } from './locales.ts'
import { PANE_WEIGHTS, type PanePreset, type createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'
import { aumaThreadOf } from './auma-thread.ts'
import { AUMA_LIVE_SURFACE, AUMA_MINDS_PATH, AUMA_STATUS_PATH, aumaStatusOf, lanesRunningOf } from './auma-status.ts'
import { waitingAgeText, waitingOf } from './waiting.ts'
import { ConversationOpener } from './conversation-opener.ts'

/** Full composed props of the root shell. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<
    | 'sidebar'
    | 'main'
    | 'rightbar'
    | 'shell.surface'
    | 'shell.menu.apps'
    | 'shell.menu.system'
    | 'shell.menu.yours'
    | 'shell.overlay'
  >
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<typeof NS>
  /** Opens a thread, injected by this plugin's registration from the client `sessions` service. */
  // **THE PARAMETER MUST BE THE BRANDED `SessionId`, AND `string` HERE IS WHAT FAILED THE WHOLE REGISTRATION.**
  // `index.ts` supplies `openThread: (sessionId: SessionId) => …` and this declares `(sessionId: string) => …`.
  // **A branded string is assignable TO `string`, but a FUNCTION taking the branded type is not assignable to one
  // taking the plain type** — parameters are contravariant, so the mismatch surfaced as `TS2769: No overload matches
  // this call` at the `register(...)` site rather than as an error here. **The message pointed at the callee; the
  // defect was in the contract.**
  & { readonly openThread?: (sessionId: SessionId) => void }

type Lane = 'left' | 'center' | 'right'
type MenuTab = 'apps' | 'system' | 'yours'

/**
 * The lanes the host reported, with each one's waiting fact — or NULL when it did not report them at all.
 *
 * **NULL AND AN EMPTY LIST ARE DIFFERENT ANSWERS.** Null means the payload carried no `waiting` field, so nobody
 * knows; an empty list would mean every lane was read and none is waiting. The render keeps them apart for the same
 * reason the fact module does.
 */
function waitingLanesOf(
  answer: unknown,
  now: number,
): readonly { readonly lane: string; readonly sessionId: string; readonly fact: ReturnType<typeof waitingOf> }[] | null {
  if (answer === null || typeof answer !== 'object') return null
  const waiting = (answer as { waiting?: unknown }).waiting
  if (!Array.isArray(waiting)) return null
  return waiting.flatMap(entry => {
    if (entry === null || typeof entry !== 'object') return []
    const { lane, sessionId, events } = entry as { lane?: unknown; sessionId?: unknown; events?: unknown }
    if (typeof lane !== 'string' || lane === '' || typeof sessionId !== 'string' || sessionId === '') return []
    if (!Array.isArray(events)) return []
    return [{ lane, sessionId, fact: waitingOf({ lane, now, events: events as Parameters<typeof waitingOf>[0]['events'] }) }]
  })
}

/** Frame padding plus the two fixed inter-lane gaps. */
const FRAME_FIXED_INLINE_SPACE = 32

const MENU_TABS = ['apps', 'system', 'yours'] as const
const MENU_SLOTS = {
  apps: 'shell.menu.apps',
  system: 'shell.menu.system',
  yours: 'shell.menu.yours',
} as const

/**
 * Identify the single visible lane of a focused preset.
 * @param preset - current pane preset.
 * @returns the focused lane, or undefined for multi-lane presets.
 */
function focusedLane(preset: PanePreset): Lane | undefined {
  if (preset === 'left-focus') return 'left'
  if (preset === 'center-focus') return 'center'
  if (preset === 'right-focus') return 'right'
  return undefined
}

/** Inner measure used while one lane owns the complete frame rail. */
function singleMeasure(preset: PanePreset): 'two-thirds' | undefined {
  if (preset.endsWith('-focus')) return 'two-thirds'
  return undefined
}

/** One accessible pane-cycle control positioned on a lane corner. */
function CornerControl(props: {
  corner: 'conversation-close' | 'left' | 'center-left' | 'center-right' | 'right'
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={css.cornerControl}
      data-corner={props.corner}
      aria-label={props.label}
      onClick={props.onClick}
    />
  )
}

/** Compact geometric mark for one right-menu category. */
function MenuTabIcon({ tab }: { tab: MenuTab }) {
  return (
    <svg className={css.menuTabIcon} viewBox="0 0 16 16" aria-hidden="true">
      {tab === 'apps' && <path d="M8 2.25 13.5 13H2.5L8 2.25Z" />}
      {tab === 'system' && <rect x="3" y="3" width="10" height="10" rx="1.5" />}
      {tab === 'yours' && <circle cx="8" cy="8" r="5.25" />}
    </svg>
  )
}

/** Rounded lane wrapper shared by threads, center, and right-side content. */
function LaneShell(props: {
  lane: Lane
  label: string
  active: boolean
  controls: ReactNode
  children: ReactNode
}) {
  const laneClass = props.lane === 'left'
    ? css.laneLeft
    : props.lane === 'center' ? `${css.laneCenter} ${css.centerCol}` : css.laneRight
  return (
    <section
      className={`${css.lane} ${laneClass}`}
      data-lane={props.lane}
      data-pane-active={props.active || undefined}
      aria-label={props.label}
      aria-hidden={!props.active || undefined}
      ref={(element) => { element?.toggleAttribute('inert', !props.active) }}
    >
      <div className={css.laneShell}>
        {props.controls}
        <div className={css.laneBody}>{props.children}</div>
      </div>
    </section>
  )
}

/**
 * Convert the left track weight into the pixel owner value expected by the
 * existing sidebar occupant. Single-pane modes follow their centered measure.
 * @param frameWidth - measured spatial-frame width.
 * @param leftWeight - left track's fractional weight.
 * @param measure - centered measure when the left lane owns the frame.
 * @returns rendered sidebar content width in pixels.
 */
function laneWidth(
  frameWidth: number,
  weight: number,
  measure: 'two-thirds' | undefined,
): number {
  if (weight === 0) return 0
  if (measure === 'two-thirds') return Math.round(frameWidth * 2 / 3)
  const available = Math.max(0, frameWidth - FRAME_FIXED_INLINE_SPACE)
  return Math.round(available * weight / 3)
}

/** Three-lane application frame. */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  t,
  openThread,
}: AppFrameProps) {
  const state = useStore(value => value)
  const currentSession = useSessions(sessions => sessions.current)
  // THE NAME OF THE THREAD THE CORNER NAMES, LIVE: `displayTitle` is the session's human-facing label (durable
  // title, project basename, then id), so a thread the host has not titled yet is still named rather than blank.
  const currentThreadTitle = useSessions((sessions) => {
    const current = sessions.current
    return current === undefined ? undefined : sessions.byId[current]?.displayTitle
  })
  // HOW MANY LANES ARE RUNNING, from the live session store — the same fact the board reads, counted here by the
  // rule `lanesRunningOf` documents. `null` when the store cannot answer, which the strip shows as unknown.
  const lanesRunning = useSessions(sessions => lanesRunningOf(sessions))
  // THE HOST'S ANSWER FOR THE FACTS ONLY IT KNOWS (CORE, hands, today's spend against the cap), read from the
  // route the panel already asks for at mount. READ-ONLY: one GET, no body, nothing written anywhere. A failed
  // or refused read leaves `null`, which the strip renders as unknown — never as a zero.
  const aumaLiveOpen = state.activeSurface === AUMA_LIVE_SURFACE
  const [aumaAnswer, setAumaAnswer] = useState<unknown>(null)
  useEffect(() => {
    if (!aumaLiveOpen) return undefined
    let cancelled = false
    const read = (): void => {
      void fetch(AUMA_STATUS_PATH, { credentials: 'same-origin' })
        .then(response => (response.ok ? response.json() : null))
        .then(body => { if (!cancelled) setAumaAnswer(body) })
        .catch(() => { if (!cancelled) setAumaAnswer(null) })
    }
    read()
    // REFRESHED WHILE THE PANEL IS OPEN: spend and the CORE session move during a session, and a strip that shows
    // what she could do an hour ago is the guess this exists to remove.
    const timer = setInterval(read, 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [aumaLiveOpen])
  // **WHO IS WAITING ON PETER.** The minds route carries the per-lane approval log; this panel turns it into the
  // badge and its age with the same courted module the strip's facts use. A payload WITHOUT a `waiting` field means
  // the host could not read the lanes, and that renders as unknown — never as "nobody is waiting", which is the one
  // reading that would send a person back to sleep on a lane that has been stopped for sixteen hours.
  const [lanesAnswer, setLanesAnswer] = useState<unknown>(null)
  useEffect(() => {
    if (!aumaLiveOpen) return undefined
    let cancelled = false
    const read = (): void => {
      void fetch(AUMA_MINDS_PATH, { credentials: 'same-origin' })
        .then(response => (response.ok ? response.json() : null))
        .then(body => { if (!cancelled) setLanesAnswer(body) })
        .catch(() => { if (!cancelled) setLanesAnswer(null) })
    }
    read()
    const timer = setInterval(read, 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [aumaLiveOpen])

  // WHETHER THE CURRENT SESSION IS BLANK: a blank session is what the page opens for itself, so the conversation
  // opener below does not treat a switch to one as a person choosing a thread.
  const currentBlank = useSessions((sessions) => {
    const current = sessions.current
    return current === undefined ? undefined : sessions.byId[current]?.blank
  })
  const detailsSession = useSessions((sessions) => {
    const current = sessions.current
    return current !== undefined && sessions.byId[current]?.blank === false ? current : undefined
  })
  const [menuTab, setMenuTab] = useState<MenuTab>('system')
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(() => window.innerWidth)
  const menuId = useId()

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const measureFrame = (): void => {
      const width = frame.getBoundingClientRect().width
      setFrameWidth(width > 0 ? width : window.innerWidth)
    }
    measureFrame()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureFrame)
      return () => { window.removeEventListener('resize', measureFrame) }
    }
    const observer = new ResizeObserver(measureFrame)
    observer.observe(frame)
    return () => { observer.disconnect() }
  }, [])

  const lastDetailsSession = useRef(detailsSession)
  // **A FRESH LOAD LANDS ON THE THREAD LIST.** This effect used to open the conversation whenever the current
  // session changed, and the first session a page sees is the load's — the persisted one restored, or the latest
  // workspace's blank session — so every app start opened the empty composer over the list with nobody touching
  // anything. The decision now lives in `conversation-opener.ts`, where a court drives it with the real load
  // sequence; a person's own selection opens the conversation explicitly, in the threads face.
  const [conversationOpener] = useState(() => new ConversationOpener())
  useLayoutEffect(() => {
    if (conversationOpener.observe({ session: currentSession, blank: currentBlank })) actions.openConversation()
  }, [actions, conversationOpener, currentSession, currentBlank])

  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastDetailsSession.current !== undefined && lastDetailsSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastDetailsSession.current = detailsSession
  }, [actions, detailsSession])

  const weights = PANE_WEIGHTS[state.panePreset]
  const focused = focusedLane(state.panePreset)
  const measure = singleMeasure(state.panePreset)
  const rightWidth = laneWidth(frameWidth, weights[2], focused === 'right' ? measure : undefined)
  const owner: SurfaceOwnerProps & MenuItemOwnerProps = {
    ...(state.activeSurface === undefined ? {} : { activeSurface: state.activeSurface }),
    ...(state.surfaceTarget === undefined ? {} : { surfaceTarget: state.surfaceTarget }),
    openSurface: actions.selectSurface,
    closeSurface: actions.closeSurface,
  }
  const showDetails = state.detailsOpen && detailsSession !== undefined
  const activeMenuSlot = MENU_SLOTS[menuTab]
  // WHAT THE APPS CORNER WILL SAY ABOUT AUMA LIVE'S THREAD — one decision per render, from the live selection.
  const aumaThread = aumaThreadOf({ sessionId: currentSession, title: currentThreadTitle })
  // EVERY FACT, EACH ONE MARKED KNOWN OR UNKNOWN. The strip never substitutes a number for a lookup that failed.
  const waitingLanes = waitingLanesOf(lanesAnswer, Date.now())
  // THE HOST SENDS THE SESSION ID AND THE PAGE KNOWS THE NAME. A row labelled `sess-9f3c…` is a row nobody can read,
  // so the label comes from the session store the frame already subscribes to, falling back to whatever the payload
  // called the lane when the store has not seen that thread.
  const laneTitles = useSessions(sessions => sessions.byId)
  const aumaStatus = aumaStatusOf({
    sessionId: currentSession, title: currentThreadTitle, lanesRunning, answer: aumaAnswer as never,
  })

  const chooseMenuTab = (tab: MenuTab, focus = false, tabList?: HTMLElement | null): void => {
    setMenuTab(tab)
    if (!focus) return
    const index = MENU_TABS.indexOf(tab)
    tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
  }

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % MENU_TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + MENU_TABS.length) % MENU_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = MENU_TABS.length - 1
    if (next === undefined) return
    const tab = MENU_TABS[next]
    if (tab === undefined) return
    event.preventDefault()
    chooseMenuTab(tab, true, event.currentTarget.parentElement)
  }

  return (
    <div
      ref={frameRef}
      className={css.frame}
      data-pane-preset={state.panePreset}
      data-focused-lane={focused}
      data-single-measure={measure}
      data-surface-presentation={state.surfacePresentation ?? 'contained'}
      data-conversation-open={state.conversationOpen || undefined}
      data-details-open={showDetails || undefined}
      data-details-collapsed={!showDetails || undefined}
      data-sidebar-collapsed={weights[0] === 0 || undefined}
    >
      <LaneShell
        lane="left"
        label={t('lane.threads')}
        active={weights[0] !== 0}
        controls={(
          <>
            {state.conversationOpen && (
              <CornerControl
                corner="conversation-close"
                label={t('thread.close')}
                onClick={actions.closeConversation}
              />
            )}
            <CornerControl
              corner="left"
              label={t('corner.left')}
              onClick={actions.cycleLeft}
            />
          </>
        )}
      >
        <div className={css.threadStack} data-thread-view={state.conversationOpen ? 'conversation' : 'list'}>
          <div className={css.threadLayer} data-thread-layer="list" hidden={state.conversationOpen}>
            {renderSlot('sidebar', {
              collapsed: weights[0] === 0,
              width: laneWidth(frameWidth, weights[0], focused === 'left' ? measure : undefined),
            })}
          </div>
          <div className={css.threadLayer} data-thread-layer="conversation" hidden={!state.conversationOpen}>
            <div className={css.threadConversationBody}>
              {renderSlot('main', {}, { entryKey: 'conversation' })}
            </div>
          </div>
        </div>
      </LaneShell>

      <LaneShell
        lane="center"
        label={t('lane.surface')}
        active={weights[1] !== 0}
        controls={(
          <>
            <CornerControl
              corner="center-left"
              label={t('corner.centerLeft')}
              onClick={actions.cycleCenterLeft}
            />
            <CornerControl
              corner="center-right"
              label={t('corner.centerRight')}
              onClick={actions.cycleCenterRight}
            />
          </>
        )}
      >
        {/* ── WHAT SHE CAN DO RIGHT NOW ─────────────────────────────────────────────────────────────
            A read-only strip for the Auma Live panel: her thread, the lanes running, whether the CORE session
            exists, whether the subscription hands resolve, and today's spend against the cap. Every value is a
            host fact, and a fact the host did not answer is rendered as UNKNOWN rather than as a zero — a green
            0 would say she is idle and broke when the truth is that nobody asked. The strip writes nothing. */}
        {state.activeSurface === AUMA_LIVE_SURFACE ? (
          <p className={css.aumaStatus} data-auma-status={aumaStatus.anyUnknown ? 'unknown' : 'known'}>
            {([
              ['thread', t('status.thread'), aumaStatus.thread],
              ['lanes', t('status.lanes'), aumaStatus.lanes],
              ['waiting', t('status.waiting'), aumaStatus.waiting],
              ['core', t('status.core'), aumaStatus.core],
              ['hands', t('status.hands'), aumaStatus.hands],
              ['spend', t('status.spend'), aumaStatus.spend],
              ['wake', t('status.wake'), aumaStatus.wake],
            ] as const).map(([id, label, fact]) => (
              <span key={id} className={fact.known ? css.aumaStatusKnown : css.aumaStatusUnknown} data-auma-status-item={id} data-known={fact.known}>
                {label}: {fact.text}
              </span>
            ))}
          </p>
        ) : null}
        {/* ── EACH LANE THAT NEEDS HIM, WITH HOW LONG IT HAS BEEN WAITING ─────────────────────────────
            A lane that is waiting looks idle from the outside, which is how AK-UI sat sixteen hours on four
            unanswered approvals. Every lane the host reported gets a row: one that is waiting gets a badge with
            the age of its OLDEST open approval and opens that thread when clicked, one with nothing open says so,
            and a lane whose log could not be read says unknown — the three are never spelled the same way. */}
        {state.activeSurface === AUMA_LIVE_SURFACE ? (
          <div className={css.aumaWaiting} data-auma-waiting={waitingLanes === null ? 'unknown' : 'known'}>
            <span className={css.aumaWaitingTitle}>{t('waiting.title')}</span>
            {waitingLanes === null ? (
              <span className={css.aumaStatusUnknown} data-auma-waiting-item="unread">
                {t('waiting.unread')}
              </span>
            ) : waitingLanes.map(row => (
              <span
                key={row.lane}
                className={row.fact.text === 'none' ? css.aumaWaitingClear : css.aumaWaitingBadge}
                data-auma-waiting-item={row.lane}
                data-waiting={row.fact.known ? (row.fact.text === 'none' ? 'clear' : 'waiting') : 'unknown'}
                data-session={row.sessionId}
              >
                {row.fact.known
                  ? (row.fact.text === 'none'
                    ? `${laneTitles[row.sessionId as SessionId]?.displayTitle ?? row.lane}: ${t('waiting.clear')}`
                    : (
                      <button
                        type="button"
                        className={css.aumaWaitingOpen}
                        onClick={() => { openThread?.(row.sessionId as SessionId) }}
                      >
                        {`${laneTitles[row.sessionId as SessionId]?.displayTitle ?? row.lane}: ${t('waiting.badge')} ${row.fact.oldestMs === null ? '' : waitingAgeText(row.fact.oldestMs)}`.trim()}
                      </button>
                    ))
                  : `${laneTitles[row.sessionId as SessionId]?.displayTitle ?? row.lane}: ${t('waiting.unknown')}`}
              </span>
            ))}
          </div>
        ) : null}
        <div className={css.surfaceStack} data-surface-active={state.activeSurface}>
          <div className={css.surfaceEmpty} data-surface-empty hidden={state.activeSurface !== undefined}>
            <span>{t('surface.empty')}</span>
          </div>
          <div className={css.surfaceLayer} data-surface-layer="extension">
            {renderSlot('shell.surface', owner)}
          </div>
        </div>
      </LaneShell>

      <LaneShell
        lane="right"
        label={t('lane.menu')}
        active={weights[2] !== 0}
        controls={(
          <CornerControl
            corner="right"
            label={t('corner.right')}
            onClick={actions.cycleRight}
          />
        )}
      >
        <div className={css.rightStack} data-menu-tab={menuTab}>
          <div className={css.rightLayer} data-right-layer="menu" hidden={showDetails}>
            <div className={css.menuHeader}>
              <span className={css.menuHeading} data-menu-heading>{t(`menu.${menuTab}`)}</span>
              <div className={css.menuTabs} role="tablist" aria-label={t('menu.tabs')}>
                {MENU_TABS.map((tab, index) => (
                  <button
                    key={tab}
                    id={`${menuId}-${tab}`}
                    type="button"
                    role="tab"
                    className={css.menuTab}
                    data-menu-tab={tab}
                    aria-selected={menuTab === tab}
                    aria-controls={`${menuId}-panel`}
                    tabIndex={menuTab === tab ? 0 : -1}
                    onClick={() => { chooseMenuTab(tab) }}
                    onKeyDown={(event) => { onTabKeyDown(event, index) }}
                  >
                    <MenuTabIcon tab={tab} />
                    <span className={css.visuallyHidden}>{t(`menu.${tab}`)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              id={`${menuId}-panel`}
              className={css.menuPanel}
              role="tabpanel"
              aria-labelledby={`${menuId}-${menuTab}`}
            >
              {/* ── WHICH THREAD AUMA LIVE IS SPEAKING THROUGH ─────────────────────────────────────────
                  Auma Live's panel binds a thread and used to say nothing about which one, so Peter had to
                  guess — and a wrong guess sends a message into the wrong conversation. This corner is where
                  he opens her from, so it is where the answer belongs: the selected thread's own name, and
                  HER HOME THREAD named as home rather than repeated as a title. It is derived from the live
                  session subscription above on every render, so choosing a thread changes these words without
                  a reload. The decision itself is in `auma-thread.ts` so that it can be measured. */}
              {menuTab === 'apps' ? (
                <p className={css.aumaThread} data-auma-thread={aumaThread.kind}>
                  <span className={css.aumaThreadWhat}>{t('menu.aumaThread')}</span>
                  {' '}
                  <span className={css.aumaThreadWho}>
                    {aumaThread.kind === 'home'
                      ? t('menu.aumaThread.home')
                      : aumaThread.kind === 'none'
                        ? t('menu.aumaThread.none')
                        : aumaThread.text}
                  </span>
                </p>
              ) : null}
              {renderSlot(activeMenuSlot, owner, {
                fallback: menuTab === 'yours'
                  ? <p className={css.menuEmpty}>{t('menu.yours.empty')}</p>
                  : null,
              })}
            </div>
          </div>
          <div className={css.rightLayer} data-right-layer="details" hidden={!showDetails}>
            {renderSlot('rightbar', {
              width: rightWidth,
              viewportWidth: frameWidth,
              canShow: showDetails,
            })}
          </div>
        </div>
      </LaneShell>

      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
    </div>
  )
}
