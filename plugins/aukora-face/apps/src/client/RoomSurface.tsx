import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Card, Panel } from '@aukora/face-layout/client'
import type { RoomMessage, RoomPage } from '../room-types.ts'
import type { StockAppSurfaceProps } from './contract.ts'
import { isEditableTarget } from './EmbeddedAppSurface.tsx'
import stockCss from './StockApps.module.css'
import css from './RoomSurface.module.css'

interface ScrollPosition {
  bottom: boolean
  anchor: string | undefined
  top: number
}

function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= 24
}

function timeOf(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Native, plain-text view of the private room. It polls only while its shell seat is active. */
export function RoomSurface({ activeSurface, closeSurface, t }: StockAppSurfaceProps) {
  const active = activeSurface === 'room'
  const surface = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const cursor = useRef<number | null>(null) // Next unread byte, never a physical line count.
  const current = useRef<RoomMessage[]>([])
  const following = useRef(true)
  const scroll = useRef<ScrollPosition | null>(null)
  const posting = useRef(false)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sendFailed, setSendFailed] = useState(false)

  useEffect(() => {
    if (!active) {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && surface.current?.contains(focused)) focused.blur()
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || isEditableTarget(event.target)) return
      event.preventDefault()
      closeSurface()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [active, closeSurface])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const query = cursor.current === null ? '' : `?after=${cursor.current}`
        const response = await fetch(`/api/room/recent${query}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) throw new Error('room-read-failed')
        const page = await response.json() as RoomPage
        if (controller.signal.aborted) return
        const initial = cursor.current === null
        const next = (initial || page.reset ? page.messages : [...current.current, ...page.messages]).slice(-300)
        if (initial || page.reset || page.messages.length > 0) {
          const element = list.current
          if (element) {
            const retained = new Set(next.map(message => String(message.index)))
            const top = element.getBoundingClientRect().top
            // Anchor to a surviving row before React removes the oldest rows. Browser anchoring is disabled.
            const anchor = Array.from(element.children).find(child =>
              retained.has((child as HTMLElement).dataset.roomIndex ?? '') && child.getBoundingClientRect().bottom > top)
            scroll.current = {
              bottom: initial || atBottom(element),
              anchor: (anchor as HTMLElement | undefined)?.dataset.roomIndex,
              top: anchor?.getBoundingClientRect().top ?? top,
            }
          }
          current.current = next
          setMessages(next)
        }
        cursor.current = page.cursor
      } catch {
        // Retain the last successful view; the next active poll retries without exposing host details.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 1_000)
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [active])

  useLayoutEffect(() => {
    const element = list.current
    const position = scroll.current
    if (!element || !position) return
    if (position.bottom) element.scrollTop = element.scrollHeight
    else if (position.anchor !== undefined) {
      const anchor = Array.from(element.children).find(child =>
        (child as HTMLElement).dataset.roomIndex === position.anchor)
      if (anchor) element.scrollTop += anchor.getBoundingClientRect().top - position.top
    } else element.scrollTop = 0 // Every previously visible row aged out; stay with the oldest retained row.
    following.current = position.bottom
    scroll.current = null
  }, [messages])

  useEffect(() => {
    const element = list.current
    if (!active || !element) return
    const resize = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight
    })
    resize.observe(element)
    return () => { resize.disconnect() }
  }, [active])

  const send = async (): Promise<void> => {
    if (posting.current || draft.trim().length === 0) return
    const submitted = draft
    posting.current = true
    setSendFailed(false)
    try {
      const response = await fetch('/api/room/message', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg: submitted }),
      })
      if (!response.ok) throw new Error('room-send-failed')
      setDraft(value => value === submitted ? '' : value)
    } catch { setSendFailed(true) }
    finally { posting.current = false }
  }

  const inactiveAttributes = active ? {} : { inert: '' }
  return (
    <div
      {...inactiveAttributes}
      ref={surface}
      data-stock-app="room"
      data-active={active ? '' : undefined}
      aria-hidden={!active}
      className={`${stockCss.surfaceSeat} ${css.room}`}
    >
      <div ref={list} className={css.messages} aria-label={t('room.name')}
        onScroll={() => { if (list.current) following.current = atBottom(list.current) }}>
        {messages.map(message => (
          <div key={`${message.index}:${message.id}`} className={css.message}
            data-room-index={message.index} data-speaker={message.from}>
            <div className={css.meta}>
              <span>{message.from}</span>
              <time dateTime={message.at}>{timeOf(message.at)}</time>
            </div>
            <Card className={css.bubble}>{message.msg}</Card>
          </div>
        ))}
      </div>
      <Panel className={css.composer}>
        <textarea
          rows={2}
          aria-label={t(sendFailed ? 'room.sendFailed' : 'room.message')}
          aria-invalid={sendFailed || undefined}
          value={draft}
          onChange={event => { setDraft(event.target.value); setSendFailed(false) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            void send()
          }}
        />
      </Panel>
    </div>
  )
}
