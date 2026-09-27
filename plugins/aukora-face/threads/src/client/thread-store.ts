/** Shared thread-list reminders and filters used by the list and Session header. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Thread filters mirror the three compact controls in the flat list header. */
export interface ThreadFilters {
  pinned: boolean
  unread: boolean
  archived: boolean
}

/** Browser-local thread state shared across root- and Session-scope entries. */
export interface ThreadViewState {
  /** Pinned Sessions lead the active or archived list before filters apply. */
  pinnedSessionIds: string[]
  /** Explicit reminders independent from runtime activity and completion. */
  unreadSessionIds: string[]
  filters: ThreadFilters
}

type ThreadViewMutators = {
  retainSessionIds: (draft: ThreadViewState, sessionIds: readonly string[]) => void
  togglePin: (draft: ThreadViewState, sessionId: string) => void
  toggleUnread: (draft: ThreadViewState, sessionId: string) => void
  markRead: (draft: ThreadViewState, sessionId: string) => void
  toggleFilter: (draft: ThreadViewState, filter: keyof ThreadFilters) => void
}

/**
 * Create the shared browser-local thread store handle.
 * @returns The handle instantiated once inside the plugin apply function.
 */
export function createThreadViewStore(): EngineStoreHandle<ThreadViewState, ThreadViewMutators> {
  return defineStore({
    init: (): ThreadViewState => ({
      pinnedSessionIds: [],
      unreadSessionIds: [],
      filters: { pinned: false, unread: false, archived: false },
    }),
    persist: 'dsh.workspace.threads.v1',
    actions: {
      retainSessionIds: (draft, sessionIds) => {
        const retained = new Set(sessionIds)
        draft.pinnedSessionIds = draft.pinnedSessionIds.filter(id => retained.has(id))
        draft.unreadSessionIds = draft.unreadSessionIds.filter(id => retained.has(id))
      },
      togglePin: (draft, sessionId) => {
        draft.pinnedSessionIds = draft.pinnedSessionIds.includes(sessionId)
          ? draft.pinnedSessionIds.filter(id => id !== sessionId)
          : [...draft.pinnedSessionIds, sessionId]
      },
      toggleUnread: (draft, sessionId) => {
        draft.unreadSessionIds = draft.unreadSessionIds.includes(sessionId)
          ? draft.unreadSessionIds.filter(id => id !== sessionId)
          : [...draft.unreadSessionIds, sessionId]
      },
      markRead: (draft, sessionId) => {
        draft.unreadSessionIds = draft.unreadSessionIds.filter(id => id !== sessionId)
      },
      toggleFilter: (draft, filter) => {
        draft.filters[filter] = !draft.filters[filter]
      },
    },
  })
}

/** Live store instance shared through each registration's injected hook source. */
export type ThreadViewStoreInstance = ReturnType<ReturnType<typeof createThreadViewStore>['create']>

/** Plain callback face shared by the browser and Session-header entries. */
export type ThreadViewActions = ThreadViewStoreInstance['actions']
