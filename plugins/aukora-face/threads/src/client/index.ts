/**
 * Workspace plugin, browser half. It registers flat-thread brand actions,
 * the sidebar browser, open-Session actions, and the conversation hero
 * picker. Browser and picker read real Host Workspaces through the global
 * useWorkspaces hook, and each declares its own `single` directory-flow child
 * hole for the composed picker package's client half (see the contract module
 * doc). Export discipline: packages/client/AGENTS.md.
 */
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UiWorkspaceService } from './navigation.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the spatial shell's ctx.layout service face into this
// program so thread gestures can reveal the left-lane Conversation.
import type {} from '@aukora/face-layout/client'
import type {
  ThreadHeaderActionsInjected, ThreadListHeaderActionsInjected,
  WorkspaceBrowserInjected, WorkspacePickerInjected,
} from './contract/slots.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { createThreadViewStore } from './thread-store.ts'
import { ThreadHeaderActions } from './ThreadHeaderActions.tsx'
import { ThreadListHeaderActions } from './ThreadListHeaderActions.tsx'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'

export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
  ThreadHeaderActionsInjected, ThreadListHeaderActionsInjected, ThreadListHeaderActionsProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The thread browsing region and pick/create flow copy. */
    'aukora-threads': WorkspaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
// The upstream thread browser stays mounted for its other seats and owns the
// 'workspace' dictionary; a second registrant with a different key set collides.
const NS = 'aukora-threads'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'connection', 'layout',
  'remote', 'remote.directoryPicker',
]

/**
 * Register the browser, picker, and Session actions once their declarations
 * are on the ledger. Inject factories return plain callbacks; data reads use
 * the framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {

  // This face replaces the upstream browser, so it publishes the service that
  // browser published. Eight other mounted plugins declare `uiWorkspace` and stay
  // pending without it.
  const uiWorkspaceService = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker,
    ctx.get('workspaces') as IWorkspaces, ctx.get('sessions') as ISessions,
  )
  void uiWorkspaceService
  // The browser this face replaces also published the workspace list as a root
  // hook, which every thread row reads. Without it the lane renders empty.
  ctx.slots.provideRoot({ hooks: { workspaces: (ctx.get('workspaces') as IWorkspaces).list } })


  // Host facts arrive on the remote host record in this harness.
  const home = ctx.remote.$host.home
  const threadView = createThreadViewStore().create()
  const threadActions = threadView.actions
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await ctx.sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  // **EVERY THREAD GESTURE GOES THROUGH THE SERVICE, AND THE SERVICE OPENS THE CONVERSATION.** A selection change
  // alone does not open it — the frame leaves the page's load-time selection on the thread list — so each gesture
  // that means "show me this thread" must say so, and saying it in ONE place is what lets a court drive it:
  // tests/aukora-layout-startup-list.test.mjs runs this service's real code, and holds these closures to it.
  const startSession: WorkspaceBrowserInjected['startSession'] = (workspaceId) => {
    uiWorkspaceService.startSession(workspaceId)
  }
  const browserInjected = (): WorkspaceBrowserInjected => ({
    flatThreads: true,
    home,
    hooks: {
      directoryFlow: browserFlowSource,
      threadView,
    },
    threadActions,
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession,
    open: (sessionId) => { uiWorkspaceService.openSession(sessionId) },
    searchSessions,
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      uiWorkspaceService.forkSession(sessionId).catch(() => {
        // Fork or child-rename failure keeps the current selection.
      })
    },
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await ctx.workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await ctx.workspaces.archiveSession(sessionId) },
    // The archived view restores through the same Host verb the header uses;
    // an archived Session cannot stay the open one, so the row is the only
    // reachable restore once a thread is in the archive set.
    unarchiveSession: async (sessionId) => { await ctx.workspaces.unarchiveSession(sessionId) },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => ctx.workspaces.create(input),
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  // Each registration declares its directory-flow child in the same call;
  // slot injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('sidebar.header.actions', () => ctx.slots.register(
    {
      name: 'sidebar.header.actions',
      id: 'flat-thread-actions',
      order: 40,
      locale: NS,
      inject: (): ThreadListHeaderActionsInjected => ({
        hooks: { threadView },
        threadActions,
        startSession,
      }),
    },
    ThreadListHeaderActions,
  ))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'thread-actions',
      order: 40,
      locale: NS,
      inject: (): ThreadHeaderActionsInjected => ({
        hooks: { threadView },
        threadActions,
        renameThread: async (sessionId, title) => {
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
          const result = await session.rename(title)
          if (!result.ok) throw new Error(result.error.message)
        },
        archiveThread: async (sessionId) => {
          await ctx.workspaces.archiveSession(sessionId)
          ctx.layout.closeConversation()
        },
        unarchiveThread: async (sessionId) => {
          await ctx.workspaces.unarchiveSession(sessionId)
        },
      }),
    },
    ThreadHeaderActions,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}
