/** Rename, reminder, and durable archive actions for the open Session header. */
import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, IconEditOutline16, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThreadHeaderActionsInjected } from './contract/slots.ts'
import { ThreadArchiveIcon, ThreadPinIcon, ThreadUnreadIcon } from './ThreadIcons.tsx'
import css from './ThreadHeaderActions.module.css'

/** Full props derived from the Session action slot and the package inject face. */
export type ThreadHeaderActionsProps =
  PropsRuntime<'conversation.session.header.actions'>
  & Omit<ThreadHeaderActionsInjected, 'hooks'>
  & PropsHooks<ThreadHeaderActionsInjected['hooks']>
  & PropsLocale<'aukora-threads'>

/**
 * Render thread actions for the open Session.
 * @param props - Session identity, state sources, durable operations, and locale seat.
 * @returns The compact action cluster.
 */
export function ThreadHeaderActions({
  sessionId, useThreadView, useSessions, useWorkspaces, threadActions,
  renameThread, archiveThread, unarchiveThread, t,
}: ThreadHeaderActionsProps) {
  const pinned = useThreadView(state => state.pinnedSessionIds.includes(sessionId))
  const unread = useThreadView(state => state.unreadSessionIds.includes(sessionId))
  const title = useSessions(state => state.byId[sessionId]?.displayTitle ?? '')
  const archived = useWorkspaces(state => state.archivedSessionIds.includes(sessionId))
  const [archiveOperation, setArchiveOperation] = useState<'archive' | 'unarchive' | null>(null)
  const archiveLabel = archiveOperation !== null
    ? t(archiveOperation === 'archive' ? 'actions.archivePending' : 'actions.unarchivePending')
    : t(archived ? 'actions.unarchive' : 'actions.archive')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const composing = useRef(false)
  const renameTrimmed = renameDraft.trim()
  const renameBlocked = renaming || renameTrimmed === ''
  const closeRename = (): void => {
    if (renaming) return
    setRenameOpen(false)
    setRenameError(null)
  }
  const confirmRename = (): void => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameThread(sessionId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameOpen(false)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <>
      <span className={css.actions}>
        <Tooltip label={t('actions.rename')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('actions.rename')}
            onClick={() => {
              setRenameDraft(title)
              setRenameError(null)
              setRenameOpen(true)
            }}
          >
            <IconEditOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={pinned ? t('actions.unpin') : t('actions.pin')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.pinAction)}
            aria-label={pinned ? t('actions.unpin') : t('actions.pin')}
            aria-pressed={pinned}
            onClick={() => { threadActions.togglePin(sessionId) }}
          >
            <ThreadPinIcon />
          </button>
        </Tooltip>
        <Tooltip label={unread ? t('actions.markRead') : t('actions.markUnread')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.unreadAction)}
            aria-label={unread ? t('actions.markRead') : t('actions.markUnread')}
            aria-pressed={unread}
            onClick={() => { threadActions.toggleUnread(sessionId) }}
          >
            <ThreadUnreadIcon />
          </button>
        </Tooltip>
        <Tooltip label={archiveLabel} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.archiveAction)}
            aria-label={archiveLabel}
            aria-pressed={archived}
            disabled={archiveOperation !== null}
            onClick={() => {
              const nextOperation = archived ? 'unarchive' : 'archive'
              setArchiveOperation(nextOperation)
              const operation = nextOperation === 'unarchive'
                ? unarchiveThread(sessionId)
                : archiveThread(sessionId)
              operation.then(() => { setArchiveOperation(null) }).catch((reason: unknown) => {
                setArchiveOperation(null)
                console.warn(nextOperation === 'unarchive'
                  ? 'session unarchive rejected:'
                  : 'session archive rejected:', reason)
              })
            }}
          >
            <ThreadArchiveIcon />
          </button>
        </Tooltip>
      </span>
      <Modal
        open={renameOpen}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={renaming}
          onFocus={(event) => { event.target.select() }}
          onChange={(event) => { setRenameDraft(event.target.value); setRenameError(null) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !composing.current) {
              event.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>
    </>
  )
}
