import { useEffect, useRef, useState } from 'react'
import type { StockAppSurfaceProps } from './contract.ts'
import type { StockAppId } from './StockAppMenu.tsx'
import css from './StockApps.module.css'

// Escape inside a text-entry control edits that control, never the surface.
// Duck-typed so targets from the same-origin iframe document (a different
// realm, where instanceof HTMLElement fails) classify identically.
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null
  const tag = typeof el?.tagName === 'string' ? el.tagName : ''
  return el?.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

interface EmbeddedAppSurfaceProps extends StockAppSurfaceProps {
  id: StockAppId | 'dakini-code'
  title: string
  src: string
  allow?: string
  onFrameMessage?: (message: unknown) => void
  onFrameWindow?: (frameWindow: Window | null) => void
}

/** Mount one complete same-origin application without translating its UI. */
export function EmbeddedAppSurface({
  id,
  title,
  src,
  allow,
  onFrameMessage,
  onFrameWindow,
  activeSurface,
  closeSurface,
}: EmbeddedAppSurfaceProps) {
  const active = activeSurface === id
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameLoad, setFrameLoad] = useState(0)

  useEffect(() => {
    if (!active) return
    // Bubble-phase, deferring to consumed events: Modal/Menu take Escape in
    // capture and mark it defaultPrevented, an Escape the embedded app itself
    // consumed stays with the app, and Escape inside a text-entry control (in
    // either document) belongs to that control.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      closeSurface()
    }
    const frameDocument = frameRef.current?.contentDocument
    document.addEventListener('keydown', onKeyDown)
    frameDocument?.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      frameDocument?.removeEventListener('keydown', onKeyDown)
    }
  }, [active, closeSurface, frameLoad])

  useEffect(() => {
    if (active) return
    const frame = frameRef.current
    const focusedElement = frame?.contentDocument?.activeElement as HTMLElement | null
    focusedElement?.blur()
    frame?.blur()
  }, [active, frameLoad])

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    if (frameWindow === null || frameWindow === undefined) return
    frameWindow.postMessage({
      source: 'aukora-shell',
      type: 'surface-active',
      app: id,
      active,
    }, window.location.origin)
  }, [active, frameLoad, id])

  useEffect(() => {
    if (onFrameMessage === undefined) return
    const receive = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin
        || event.source !== frameRef.current?.contentWindow) return
      onFrameMessage(event.data)
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [onFrameMessage])

  useEffect(() => () => { onFrameWindow?.(null) }, [onFrameWindow])

  const inactiveAttributes = active ? {} : { inert: '' }

  return (
    <div
      {...inactiveAttributes}
      data-stock-app={id}
      data-active={active ? '' : undefined}
      aria-hidden={!active}
      className={css.surfaceSeat}
    >
      <iframe
        ref={frameRef}
        className={css.embeddedFrame}
        src={src}
        title={title}
        allow={allow}
        // A VENDORED APP MUST NOT INHERIT THE DESKTOP'S ORIGIN (Fable's finding). `allow-scripts` keeps the app
        // working; the ABSENCE of `allow-same-origin` is what refuses it the origin, and it is what makes a request
        // from inside the frame carry `Origin: null` for the route gate to refuse.
        // 2026-09-27: the apps need their origin back. Without allow-same-origin the frame is `null`, so the shell's messages
        // (addressed to its own origin) were dropped in a loop, the shell discarded the apps' replies, and their requests
        // were refused: every app opened blank. Restored for the demo; the null-origin design needs the message plumbing
        // and the route gate done together before it can return.
        sandbox="allow-scripts allow-same-origin"
        data-stock-app-frame={id}
        onLoad={() => {
          setFrameLoad(load => load + 1)
          onFrameWindow?.(frameRef.current?.contentWindow ?? null)
        }}
      />
    </div>
  )
}
