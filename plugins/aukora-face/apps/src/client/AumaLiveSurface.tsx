import { useRef, useState } from 'react'
import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'
import { BoundSession } from './auma-live-session.ts'

/**
 * Render the actual local full-duplex Auma Live application.
 *
 * **THE SESSION IS BOUND ONCE, AT MOUNT, AND A THREAD CLICK NO LONGER RELOADS HER.** The previous version read
 * the selected thread reactively and interpolated it into the iframe's address, so every sidebar click rewrote
 * `src`, the document reloaded, and the app inside — which fixes its session at load — restarted on an empty
 * conversation. Measured at 10:02: a click moved her from AURA to KIRA with nothing in the log. The rule and
 * its own courts live in `auma-live-session.ts`; this file only wires the component to it.
 *
 * FOLLOWING IS AN EXPLICIT ACT, and it is deliberately NOT wired to the thread selection: a silent selection
 * change is not an instruction to navigate. `bindAumaLiveSession` below is the one thing that moves her, and
 * the shell binds it to a control when it has one to bind it to. **UNTIL THAT CONTROL EXISTS, NOTHING MOVES
 * HER, which is the safe direction for the defect being repaired** — the failure was that she moved on every
 * click, not that she could not be moved at all.
 */
export function AumaLiveSurface(props: StockAppSurfaceProps) {
  const selected = props.useSessions(state => state.current)
  // ONE binding for the life of the mount. The ref is created once, and `useState` exists only so that an
  // explicit follow re-renders: that is the one event that legitimately changes the address.
  const bound = useRef<BoundSession | null>(null)
  if (bound.current === null) bound.current = new BoundSession(selected)
  const [src, setSrc] = useState(() => bound.current!.src)

  // The explicit action, named and reachable. Nothing else in this component may change the address.
  bindAumaLiveSession.current = () => {
    const moved = bound.current!.followThread(selected)
    if (moved.changed) setSrc(bound.current!.src)
    return moved
  }

  return (
    <EmbeddedAppSurface
      {...props}
      id="auma-live"
      title={props.t('live.name')}
      src={src}
      allow="microphone; autoplay"
      // **THE "WHY?" LINK'S LAST HOP — auma-53 item (4).**
      //
      // The portal draws the link (keyed to the reply it sits under) and posts `{source:'auma-live', type:'why',
      // replyId}` to its parent. `EmbeddedAppSurface` already listens for exactly that, **checking both the origin and
      // the source window**, and hands the payload here. **This is the whole remaining hop: one prop, and one call.**
      //
      // **`openSurface` COMES FROM THE SHELL, NOT FROM THIS FACE.** `SettingsMenu` destructures it from its own slot
      // props and calls it across faces without importing anything — *so there is no cross-face call to build, and my
      // earlier framing of this as "how does one face reach another's service" described a problem that does not
      // exist.* The shell passes it to every `shell.surface` occupant, and `auma-live` is one (`order 20`, measured
      // through the live slot tree).
      //
      // **AND THE TARGET IS A STRING.** `openSurface(id, target?: string, presentation?)` — *not the object AK-UI's
      // note quotes* — so the reply id is passed as the target directly, which is the shape the service accepts.
      onFrameMessage={(data: unknown) => {
        const message = data as { type?: unknown; replyId?: unknown } | null
        if (message === null || message.type !== 'why') return
        if (typeof message.replyId !== 'string' || message.replyId === '') return
        props.openSurface?.('why', message.replyId, 'contained')
      }}
    />
  )
}

/**
 * THE EXPLICIT FOLLOW HANDLE. A module-level slot, not a prop: `EmbeddedAppSurface` spreads unknown props onto
 * the frame element, and inventing a prop to carry this would put a function on an iframe attribute. A shell
 * that offers "follow this thread" calls `bindAumaLiveSession.current?.()`; a shell that offers nothing leaves
 * it alone, and she stays where she was bound.
 */
export const bindAumaLiveSession: { current: null | (() => { changed: boolean; from: string; to: string }) } = {
  current: null,
}
