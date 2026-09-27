/**
 * Cross-plugin navigation controller for the spatial shell. Viewing state
 * remains in the root entry store; the controller forwards feature gestures
 * into that store's declared actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { createLayoutStore, SurfacePresentation } from './stores.ts'

/** Identity shared by a sidebar panel entry and its main-slot occupant. */
export type MainPanelId = Branded<'MainPanelId'>

/**
 * Root-scoped navigation state every entry can read as `usePanelInfo`.
 *
 * The shape is the harness's, member for member: upstream declares the same
 * standard prop, and any program that sees both declarations requires them to
 * be identical. This shell has one panel — the Conversation — so the value is
 * permanently null, which is exactly what upstream occupants test for before
 * rendering Session-bound content.
 */
export interface PanelInfo {
  /** Selected global panel; null displays the current Conversation. */
  readonly activePanelId: MainPanelId | null
}

/** Root layout store's framework-bound action set. */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** Cross-plugin layout actions available as `ctx.layout`. */
export interface ILayout {
  /** Select a center surface, an optional target, and its focused-canvas behavior. */
  openSurface(id: string, target?: string, presentation?: SurfacePresentation): void
  /** Return the center lane to its empty app canvas. */
  closeSurface(): void
  /**
   * Replace the left thread browser with the resident Conversation.
   *
   * A PERSON'S SELECTION CALLS THIS, EXPLICITLY. A selection change alone does not open the conversation: the
   * frame leaves the page's own load-time selection on the thread list (`conversation-opener.ts`), and choosing
   * the thread that is already current changes no selection at all. So a gesture that means "show me this
   * thread" says so here — `UiWorkspaceService` in the threads face does, for every thread gesture it owns.
   */
  openConversation(): void
  /** Return the left lane to its thread browser. */
  closeConversation(): void
  /**
   * Begin a navigation, cancelling any still in flight, and return its signal.
   *
   * The thread browser opens a session by awaiting host work and then applying the
   * result, so it needs a way to abandon a slower earlier click. This frame has no
   * panel model of its own, but the ability to cancel is not about panels: without
   * it the browser's own await never resolves and the click does nothing.
   */
  beginNavigation(): AbortSignal
  /**
   * Record the harness's main-panel selection. OPENS NOTHING.
   *
   * This frame declares the harness's keyed `main` slot but keeps exactly one key in
   * it — `conversation`, in the left lane — because the centre lane holds application
   * surfaces rather than panels. Upstream, `null` means "show the conversation"; here it
   * only names the one panel there is, and it does not open the conversation over the
   * thread list, because a caller passes it as bookkeeping and not as a person's choice.
   * A selection that should show the conversation calls {@link ILayout.openConversation}.
   * Any other id has no seat in this shell and is accepted and ignored rather than
   * throwing into a caller that cannot know which frame it is talking to.
   */
  selectPanel(panelId: string | null): void
  /** Toggle the thread lane between visible and hidden presets. */
  toggleSidebar(): void
  /** Show details for the current real Session and return to balanced panes. */
  openDetails(): void
  /** Return the right lane to its navigation menu. */
  closeDetails(): void
  /**
   * Show the right column, in the harness's own words.
   *
   * The right Sidebar asks for its panel through this name and no other. Its
   * two arguments describe an upstream geometry this frame does not have — the
   * right lane is one of three fixed lanes, never a track carved out of the
   * centre, and never a fullscreen cover — so they are accepted and ignored
   * rather than pretended to. What the caller actually wants is the panel
   * shown, and that it gets.
   * @param track - upstream column-reservation request; this frame reserves nothing.
   * @param fullscreen - upstream viewport-cover request; this frame covers nothing.
   */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** Hide the right column, in the harness's own words. */
  closeRightbar(): void
}

/** `ctx.layout` controller backed by the mounted root entry's store actions. */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined

  /** Pending navigation, aborted when a later one begins or the owner unloads. */
  #navigation = new AbortController()

  /**
   * Begin a navigation and cancel any earlier one.
   * @returns the signal for this navigation.
   */
  beginNavigation(): AbortSignal {
    this.#navigation.abort()
    this.#navigation = new AbortController()
    return this.#navigation.signal
  }

  /**
   * Record the harness's main-panel selection — and OPEN NOTHING.
   *
   * WHO CALLS THIS, MEASURED — AND THE LOAD-TIME CALLER IS THE HARNESS ITSELF. Upstream's thread browser and
   * sidebar call it with `null` to show the conversation, and both upstream rows are disabled in this composition
   * (`scripts/materialize-aukora-release.py`). That leaves the harness, and it calls this on EVERY PAGE LOAD with
   * nobody touching anything — which is why the method exists in this shape, and what the startup panel court
   * drives directly (`tests/aukora-layout-startup-panel.test.mjs`, "THE HARNESS SELECTING ITS PANEL ON LOAD OPENS
   * NOTHING"). The other callers are the threads face's own gestures in `threads/src/client/navigation.ts`, which
   * call `openConversation()` explicitly first. This call is bookkeeping about which panel is active — it carries
   * no intent — and this shell has exactly one panel, so there is nothing else it could switch to. It used to open
   * the conversation too; that was not the load-time opener (the frame's own selection watcher was — see
   * `conversation-opener.ts`), but a call that means nothing must not navigate — least of all one the harness makes
   * by itself, on every load, before a person has done anything.
   * @param panelId - upstream main-panel id, or null for the conversation.
   */
  selectPanel(panelId: string | null): void {
    // INTENTIONALLY EMPTY. Opening here would navigate on bookkeeping; anything that is not the shell's one panel
    // is ignored rather than guessed at, exactly as before.
    if (panelId !== null) return
  }

  /** Invalidate a pending navigation when the layout owner is unloaded. */
  dispose(): void {
    this.#navigation.abort()
  }

  /**
   * Attach the root entry's current action set. A replacement registration
   * overwrites actions captured from the prior entry instance.
   * @param actions - bound actions of the root spatial-layout store.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Select a center surface, an optional target, and its focused-canvas behavior. */
  openSurface(id: string, target?: string, presentation?: SurfacePresentation): void {
    if (presentation === undefined) this.#require().selectSurface(id, target)
    else this.#require().selectSurface(id, target, presentation)
  }

  /** Return the center lane to its empty app canvas. */
  closeSurface(): void {
    this.#require().closeSurface()
  }

  /** Replace the left thread browser with the resident Conversation. */
  openConversation(): void {
    this.#require().openConversation()
  }

  /** Return the left lane to its thread browser. */
  closeConversation(): void {
    this.#require().closeConversation()
  }

  /** Toggle the thread lane between visible and hidden presets. */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Show details for the current real Session and return to balanced panes. */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Return the right lane to its navigation menu. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /**
   * Show the right column for the right Sidebar.
   * @param _track - upstream column reservation; this frame's lanes are fixed.
   * @param _fullscreen - upstream viewport cover; this frame has no such mode.
   */
  openRightbar(_track: boolean, _fullscreen: boolean): void {
    this.openDetails()
  }

  /** Hide the right column for the right Sidebar. */
  closeRightbar(): void {
    this.closeDetails()
  }

  /** @returns the attached store actions, or throws when root assembly has not completed. */
  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('layout: actions not wired (root entry not mounted)')
    return this.#panels
  }
}
