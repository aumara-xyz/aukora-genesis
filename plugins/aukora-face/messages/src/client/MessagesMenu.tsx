/** Text-only Messages entry in the shell's triangle Aukora Apps menu. */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Messages.module.css'

/** Full props for the standalone Messages launcher. */
export type MessagesMenuProps =
  PropsRuntime<'shell.menu.apps'>
  & PropsLocale<'messages'>

/**
 * Open the standalone Messages preview.
 * @param props - Apps-menu owner share and localized copy.
 * @returns the Messages launcher button.
 */
export function MessagesMenu({ activeSurface, openSurface, t }: MessagesMenuProps) {
  const active = activeSurface === 'messages'
  return (
    <button
      type="button"
      data-messages-launcher
      className={clsx(css.menuItem, active && css.menuItemActive)}
      aria-current={active ? 'page' : undefined}
      onClick={() => { openSurface('messages') }}
    >
      <span className={css.menuCopy}>
        <strong>{t('menu.title')}</strong>
        <span>{t('menu.description')}</span>
      </span>
    </button>
  )
}
