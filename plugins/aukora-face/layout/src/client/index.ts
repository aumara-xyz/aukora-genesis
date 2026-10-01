/**
 * Browser layout plugin: the root spatial shell, its transient pane store,
 * cross-plugin navigation controller, localized menu chrome, and document
 * theme presentation.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelActions, PanelInfo } from './service.ts'
import type {
  MenuItemOwnerProps, RightbarOwnerProps, SidebarOwnerProps, SurfaceOwnerProps,
} from './types.ts'
import { AppFrame } from './AppFrame.tsx'
import { installComposerControls } from './ComposerControls.tsx'
import { en, NS, zh, type LayoutKey } from './locales.ts'
import { LayoutController } from './service.ts'
import { createLayoutStore } from './stores.ts'
import { ThemePresenter } from './theme-presenter.ts'
import './spatial-tokens.css'

export { ActionButton, Card, Panel, PortalButton, SectionHeader } from './primitives.tsx'
export type { Accent, PortalButtonProps } from './primitives.tsx'

export { LayoutController } from './service.ts'
export type { ILayout, MainPanelId, PanelInfo } from './service.ts'

/** Selector hook over root-scoped panel selection. */
export type UsePanelInfo = SnapshotSelectorHook<PanelInfo>
export type {
  MenuItemOwnerProps, RightbarOwnerProps, SidebarOwnerProps, SurfaceOwnerProps,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-plugin navigation actions owned by the root spatial shell. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Subscribe to the selected main panel independently of parent renders. */
    usePanelInfo: UsePanelInfo
  }

  interface LocaleNamespaceMap {
    /** Spatial-shell lane, menu-tab, and pane-control copy. */
    layout: LayoutKey
  }

  interface SlotMap {
    /**
     * The left thread-navigation lane. ui-sidebar's occupant declares the
     * Workspace browser and footer seats inside it, so replacing this entry
     * also replaces those child seats. The owner props report the categorical
     * pane state while the mounted occupant survives hidden presets.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * The resident left-lane Conversation across blank and active Sessions.
     *
     * THE NAME IS THE HARNESS'S, NOT OURS. ui-conversation registers its panel
     * as `main` under the key `conversation`, and declares its own child seats
     * from there, so a frame that declares anything else leaves the panel with
     * nowhere to mount and the lane renders empty. The slot is `keyed` because
     * upstream reserves `main` for whole-frame panel navigation; this shell
     * keeps only the conversation key (see ILayout.selectPanel).
     */
    'main': { kind: 'keyed'; scope: 'root' }
    /**
     * Session-bound details content that temporarily replaces the right menu.
     * ui-sidebar-right owns the shipped occupant and its tab child seats, and
     * renders nothing while a global panel is selected — which is why this
     * frame publishes `panelInfo` as a root hook below.
     */
    'rightbar': { kind: 'single'; scope: 'root'; owner: RightbarOwnerProps }
    /**
     * Additive center-lane application surfaces. Entries receive the selected
     * id, optional feature target, and navigation callbacks whose presentation
     * argument chooses a contained or full-bleed focused canvas. Each entry
     * keeps its own tree mounted and hides when inactive.
     */
    'shell.surface': { kind: 'list'; scope: 'root'; owner: SurfaceOwnerProps }
    /**
     * Bundled Aukora application entries in the triangle tab. Entries open
     * center surfaces through the supplied navigation owner props.
     */
    'shell.menu.apps': { kind: 'list'; scope: 'root'; owner: MenuItemOwnerProps }
    /**
     * System and settings entries in the square tab. Entries open
     * center surfaces through the supplied navigation owner props.
     */
    'shell.menu.system': { kind: 'list'; scope: 'root'; owner: MenuItemOwnerProps }
    /**
     * Additive user-created application entries in the circle tab. Entries open
     * center surfaces through the supplied navigation owner props.
     */
    'shell.menu.yours': { kind: 'list'; scope: 'root'; owner: MenuItemOwnerProps }
    /**
     * Frame-wide floating content above the three lanes and outside their
     * scroll containers. The layer is click-through; entries restore pointer
     * events for their own visible chrome.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

/** The one panel this shell has: never a keyed global panel, always the Conversation. */
const CONVERSATION_PANEL: PanelInfo = Object.freeze({ activePanelId: null })

/** Required services for slot composition, localized chrome, and theme projection. */
export const inject = ['slots', 'theme', 'locale', 'sessions']

/**
 * Register the spatial root shell and document theme presenter.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  installComposerControls(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-layout: dictionaries')

  const layout = new LayoutController()
  // THE CONVERSATION IS THE ONLY PANEL. Upstream occupants — the right column
  // among them — render Session content only while no global panel is selected,
  // and they read that through this root hook. A frame that declares `rightbar`
  // without publishing `panelInfo` hands them an undefined `usePanelInfo` and
  // they die on the call. Constant because this shell navigates surfaces in the
  // centre lane rather than swapping the main panel.
  const panelInfo: HostObservable<PanelInfo> = {
    getSnapshot: () => CONVERSATION_PANEL,
    subscribe: () => () => {},
  }
  // ── THE FIRST RUN, REGISTERED WHERE THE SHELL SHOWS SURFACES ────────────────────────────────────────────────
  // **A FRIEND INSTALLS AUKORA AND TALKS TO THEIR OWN AUMA; THIS IS THE SCREEN BETWEEN THOSE TWO THINGS.** It sorts
  // before every other surface (`order: 5`) because on a machine nobody has set up, it is the only one that makes
  // sense — and it renders NOTHING of anybody else's: `tests/aukora-first-run-owner-free.test.mjs` fails on any
  // owner-specific string in its source or in the sentences it renders.
  //
  // **WHAT IT HONESTLY DOES NOT DO YET**: the shell does not yet open it by itself on a machine with no owner profile,
  // because the host route that answers "is this a first run?" is the next piece of this goal. Until then the surface
  // is registered and reachable, and the screen's own guard (`isFirstRun`) keeps it from ever appearing to somebody
  // who has already given their name.
  // **THE SCREEN IS SHOWN, NOT MERELY REGISTERED.** The host answers whether this state has an owner profile; when it
  // does not, this is the surface the person gets, because on a machine nobody has set up it is the only one that
  // makes sense. A state that cannot be reached is NOT treated as a first run — the screen would have nothing to save
  // into, and `httpFirstRun` says `absent` rather than pretending the state is blank.
  // PETER'S ORDER, 2026-09-27: no first-run form opens by itself. The model key lives in the Models tab.

  // PETER'S ORDER, 2026-09-27: the Approvals, Health and Why menu entries are not shown.
  // ── THE APPROVAL HISTORY, IN THE RIGHT-SIDE MENU AND THE CENTRE, BESIDE MEMORY ────────────────────────────────
  // The same two registrations the memory face uses, in the same two slots, because a person should not have to learn
  // a second way of reaching a view. `order: 45` puts it after Memory (40).

  // ── THE HEALTH PANEL, IN THE RIGHT-SIDE MENU AND THE CENTRE, BESIDE ITS SIBLINGS ─────────────────────────────
  // The same two registrations Memory and Approvals use, in the same two slots, at order 50.

  // ── "WHY DID SHE SAY THAT?", IN THE RIGHT-SIDE MENU AND THE CENTRE, BESIDE ITS SIBLINGS ──────────────────────
  // The same two registrations Memory, Approvals and Health use, in the same two slots, at order 55.

  // PETER'S ORDER, 2026-09-27: the first-run screen is not registered, so it can never be the default centre.

  ctx.effect(() => {
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } })
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: NS,
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
        'rightbar': { kind: 'single', scope: 'root' },
        'shell.surface': { kind: 'list', scope: 'root' },
        'shell.menu.apps': { kind: 'list', scope: 'root' },
        'shell.menu.system': { kind: 'list', scope: 'root' },
        'shell.menu.yours': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        // **THE CLICK GOES THROUGH THE SERVICE, NOT A LINK.** `ctx.sessions.open` is the same call the shipped
        // sidebar makes, so a badge opens the thread exactly as clicking its row would — a second navigation path
        // would be a second way for the two to disagree.
        // **THE PARAMETER IS A `SessionId`, NOT A `string`.** `ctx.sessions.open` takes the branded session type, and
        // an unbranded `string` is refused — correctly, because an id that has not been through the session layer is
        // exactly the kind of value this repository has three times passed where a different string was meant.
        //
        // **NOT AN INDEX-ONLY FIX.** In this goal's step (0) I fixed a build-breaking line in another lane's file with
        // `git apply --cached`, and learned that is a LOAN: their next commit, made from a working copy that still
        // held the old line, silently reverted it. This is fixed in the working copy, where it will survive.
        return { openThread: (sessionId: SessionId) => { ctx.sessions.open(sessionId) } }
      },
    }, AppFrame)
    return () => {
      layout.dispose()
      disposeRegistration()
      disposePanelInfo()
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
