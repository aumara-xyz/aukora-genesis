/**
 * ui-workspace contracts. Four registrations share this package:
 *
 * - ThreadListHeaderActions fills `sidebar.header.actions` with the fixed
 *   flat-list creation and filter controls.
 * - WorkspaceBrowser fills the sidebar shell's `sidebar.workspaces` hole —
 *   search, grouped/flat session list, and workspace dialogs. It registers
 *   this package's viewing store and consumes the shell's two-fact owner
 *   share (wide / expandSidebar).
 * - WorkspacePicker fills the conversation empty-state hole (menu + error
 *   dialog shared with the browser).
 * - ThreadHeaderActions fills the open Session header's additive action list
 *   with shared pin/unread state, durable rename, and Host-backed archive.
 *
 * The browser and picker each declare one **directory-flow hole** (`single`
 * kind): the slot a composed picker package's client half fills with its
 * picking interaction — a renderless native-chooser driver or an in-app
 * browsing dialog. ui-workspace owns the trigger (the "Add workspace…"
 * entry, present only while the hole is occupied) and the adoption
 * semantics (`createWorkspace({ path })`, the retryable error dialog,
 * Choose again); the occupant owns everything between `open` and the picked path,
 * including creating a new directory to hand back. That occupant-owned
 * creation is why adding a workspace has a single route: an unoccupied hole
 * leaves the surface with no add affordance at all.
 * Two holes exist because the two menu surfaces are independent slot entries
 * and a hole has exactly one declaring entry — they carry the same owner
 * contract and the same occupant.
 */
// The connection no longer publishes a host-description observable; the host facts a
// thread row needs (the account home, for `~` abbreviation) ride the remote host
// record instead, so the owner carries the value rather than a source to watch.
import type { PropsRenderSlots, HostObservable as _HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable, PropsHooks, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the owner SlotMap merges into programs that resolve the
// runtime shares below.
import type {} from '@aukora/face-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { createWorkspaceViewStore } from '../stores.ts'
import type { ThreadViewActions, ThreadViewState } from '../thread-store.ts'

/**
 * Owner share of the directory-flow holes: the complete conversation between
 * the trigger surface and the picking interaction. The occupant reads `open`
 * to run/render its interaction and reports exactly one outcome per open.
 */
export interface DirectoryFlowOwnerProps {
  /** True while a picking interaction is requested; flipping back to false withdraws the request. */
  open: boolean
  /** True while the owner adopts a picked path (`createWorkspace` in flight); occupants disable their commit affordances. */
  busy: boolean
  /** The operator picked a directory (absolute host path); the owner adopts it. */
  onPicked: (path: string) => void
  /** The operator dismissed the interaction; the owner just closes the flow. */
  onCancel: () => void
  /** The interaction itself failed (chooser missing, listing denied); the owner shows its error surface. */
  onError: (message: string) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Directory-flow hole under the conversation empty-state picker (declared by the WorkspacePicker entry). */
    'conversation.hero.workspace.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
    /** Directory-flow hole under the sidebar browsing region (declared by the WorkspaceBrowser entry). */
    'sidebar.workspaces.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
  }
}

/** The two directory-flow holes; a flow package's client half registers its one component into both. */
export type DirectoryFlowSlotName =
  | 'conversation.hero.workspace.directoryFlow'
  | 'sidebar.workspaces.directoryFlow'

/**
 * Directory-picking share both trigger surfaces consume. Occupancy rides the
 * inject face's reserved `hooks` compartment: the renderer binds the source
 * into the `useDirectoryFlow` selector hook, so an empty hole hides the
 * "Add workspace…" entry reactively and the surface withdraws an open
 * flow whose occupant unloaded mid-interaction (nobody is left to cancel).
 */
export type DirectoryPickingInjected = {
  hooks: {
    /** True while this surface's directory-flow hole is occupied. */
    directoryFlow: HostObservable<boolean>
  }
}

/** Component-side view of the picking share: the bound occupancy selector hook. */
export type DirectoryPickingHooks = PropsHooks<DirectoryPickingInjected['hooks']>

/**
 * Browser-private injected share (arrives via the register inject factory).
 * Data reads use the global framework hooks; these are the Host actions the
 * browsing region drives.
 */
export type WorkspaceBrowserInjected = {
  /** Host account home, for POSIX home-rooted path abbreviation. */
  home: string | undefined
  hooks: DirectoryPickingInjected['hooks'] & {
    /** Current generation's Host description, bound by the slot renderer. */
    /** Browser-local pin, unread, and filter state shared with the Session header. */
    threadView: HostObservable<ThreadViewState>
  }
  /** Shared thread-state mutation face. */
  threadActions: ThreadViewActions
  /** Omit folder-group chrome and present the draggable cross-Workspace thread list. */
  flatThreads?: boolean
  /**
   * Start a New Session in a Workspace: reuse-or-create its blank session and
   * open it; without an explicit workspace, inherit the current Session
   * Workspace, then the recent Workspace, or clear into the New Session view.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Open a real Session. */
  open: (sessionId: SessionId) => void
  /**
   * Search current visible conversation messages. The Host fixes the result
   * bound; `hasMore` means the query needs narrowing.
   */
  searchSessions: (
    query: string,
    signal: AbortSignal,
  ) => Promise<{ items: readonly SessionSearchResultItem[]; hasMore: boolean }>
  /** Maximum number of merged rows rendered for one search. */
  searchResultLimit: number
  /** Rename a Session (explicit user title; resolves on host acceptance). */
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  /** Fork a Session at its last completed turn and open the child. */
  forkSession: (sessionId: SessionId) => void
  /** Rename a Host Workspace (rejects on name conflict; resolves on durability). */
  renameWorkspace: (workspaceId: WorkspaceId, title: string) => Promise<void>
  /** Delete only a Host Workspace registration; directory and Session logs remain. */
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  /**
   * Reorder a Workspace in the durable registry display order.
   * Omitted anchor appends to the end.
   */
  insertWorkspaceBefore: (workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId) => Promise<void>
  /**
   * Archive a Session into the registry-global set: hidden from grouping
   * surfaces, with its log, accounting slot, and selection retained.
   */
  archiveSession: (sessionId: SessionId) => Promise<void>
  /**
   * Remove a Session from the registry-global archive set: the archived view's
   * rows leave it and return to the active list at their recorded position.
   */
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  /**
   * Reorder a session inside its Workspace account (DOM-insertBefore
   * semantics: omitted anchor appends to the end). The view refreshes from
   * the Host response/changed frame; failures leave the order unchanged.
   */
  insertSessionBefore: (workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId) => Promise<void>
  /** Adopt a picked host directory as a real Workspace before targeting a Session. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
}

/** Full browser props: shell owner share + viewing store + injected actions + the locale seat. */
export type WorkspaceBrowserProps =
  PropsRuntime<'sidebar.workspaces'>
  & PropsRenderSlots<'sidebar.workspaces.directoryFlow'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>
  & Omit<WorkspaceBrowserInjected, 'hooks'>
  & PropsHooks<WorkspaceBrowserInjected['hooks']>
  & PropsLocale<'aukora-threads'>

/** Injected state and operations for the fixed flat-thread brand-row toolbar. */
export type ThreadListHeaderActionsInjected = {
  hooks: {
    /** The same browser-local filter source rendered by the flat list. */
    threadView: HostObservable<ThreadViewState>
  }
  /** Shared flat-list filter mutations. */
  threadActions: ThreadViewActions
  /** Start and open the shared blank Session. */
  startSession: () => void
}

/** Full props for the flat-thread controls beside the sidebar brand. */
export type ThreadListHeaderActionsProps =
  PropsRuntime<'sidebar.header.actions'>
  & Omit<ThreadListHeaderActionsInjected, 'hooks'>
  & PropsHooks<ThreadListHeaderActionsInjected['hooks']>
  & PropsLocale<'aukora-threads'>

/** Injected state and operations for the open Session's thread actions. */
export type ThreadHeaderActionsInjected = {
  hooks: {
    /** The same browser-local thread source rendered by the flat list. */
    threadView: HostObservable<ThreadViewState>
  }
  /** Shared pin and unread mutations. */
  threadActions: ThreadViewActions
  /** Persist a user-authored Session title. */
  renameThread: (sessionId: SessionId, title: string) => Promise<void>
  /** Archive durably, then close Conversation back to the thread list. */
  archiveThread: (sessionId: SessionId) => Promise<void>
  /** Remove a Session from the durable archive set. */
  unarchiveThread: (sessionId: SessionId) => Promise<void>
}

/**
 * Picker-private injected share. Pick semantics remain in the owner's onPick
 * callback; this callback creates only the real Host Workspace. A type alias
 * supplies the implicit index signature required by the registry.
 */
export type WorkspacePickerInjected = DirectoryPickingInjected & {
  /** Adopt a picked host directory as a real Workspace before targeting a Session. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
}

/**
 * Full picker props: the owner share plus the creation callback and the
 * locale seat. The two picker holes (blank-session hero / New-Session view)
 * share one owner currency, so one composed type serves both registrations.
 */
export type WorkspacePickerProps =
  PropsRuntime<'conversation.hero.workspace'>
  & PropsRenderSlots<'conversation.hero.workspace.directoryFlow'>
  & Omit<WorkspacePickerInjected, 'hooks'>
  & DirectoryPickingHooks
  & PropsLocale<'aukora-threads'>
