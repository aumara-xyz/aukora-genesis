/** Creation and filter controls beside the expanded AUKORA brand. */
import clsx from 'clsx'
import { IconPlusOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ThreadListHeaderActionsProps } from './contract/slots.ts'
import { ThreadArchiveIcon, ThreadPinIcon, ThreadUnreadIcon } from './ThreadIcons.tsx'
import css from './ThreadListHeaderActions.module.css'

/**
 * Render the fixed flat-thread toolbar.
 * @param props - shared thread state, mutations, Session creation, and locale seat.
 * @returns The brand-row action cluster.
 */
export function ThreadListHeaderActions({
  useThreadView,
  threadActions,
  startSession,
  t,
}: ThreadListHeaderActionsProps) {
  const filters = useThreadView(state => state.filters)
  return (
    <span className={css.actions}>
      <Tooltip label={t('actions.newChat')} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('actions.newChat')}
          onClick={() => { startSession() }}
        >
          <IconPlusOutline16 />
        </button>
      </Tooltip>
      <Tooltip
        label={filters.pinned ? t('filters.pinned.disable') : t('filters.pinned.enable')}
        side="bottom"
        delayMs={500}
      >
        <button
          type="button"
          className={clsx(css.iconButton, css.pinAction)}
          aria-label={t('filters.pinned.aria')}
          aria-pressed={filters.pinned}
          onClick={() => { threadActions.toggleFilter('pinned') }}
        >
          <ThreadPinIcon />
        </button>
      </Tooltip>
      <Tooltip
        label={filters.unread ? t('filters.unread.disable') : t('filters.unread.enable')}
        side="bottom"
        delayMs={500}
      >
        <button
          type="button"
          className={clsx(css.iconButton, css.unreadAction)}
          aria-label={t('filters.unread.aria')}
          aria-pressed={filters.unread}
          onClick={() => { threadActions.toggleFilter('unread') }}
        >
          <ThreadUnreadIcon />
        </button>
      </Tooltip>
      <Tooltip
        label={filters.archived ? t('filters.archived.disable') : t('filters.archived.enable')}
        side="bottom"
        delayMs={500}
      >
        <button
          type="button"
          className={clsx(css.iconButton, css.archiveAction)}
          aria-label={t('filters.archived.aria')}
          aria-pressed={filters.archived}
          onClick={() => { threadActions.toggleFilter('archived') }}
        >
          <ThreadArchiveIcon />
        </button>
      </Tooltip>
    </span>
  )
}
