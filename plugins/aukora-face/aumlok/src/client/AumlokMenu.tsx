/** Text-only AUMLOK entry in the shell's right-side System menu. */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Aumlok.module.css'

/** Full props for the standalone AUMLOK System launcher. */
export type AumlokMenuProps =
  PropsRuntime<'shell.menu.system'>
  & PropsLocale<'aumlok'>

/**
 * Open the standalone AUMLOK preview.
 * @param props - System-menu owner share and localized copy.
 * @returns the AUMLOK launcher button.
 */
export function AumlokMenu({ activeSurface, openSurface, t }: AumlokMenuProps) {
  const active = activeSurface === 'aumlok'
  return (
    <button
      type="button"
      data-aumlok-launcher
      className={clsx(css.menuItem, active && css.menuItemActive)}
      aria-current={active ? 'page' : undefined}
      onClick={() => { openSurface('aumlok') }}
    >
      <span className={css.menuCopy}>
        <strong>{t('menu.title')}</strong>
        <span>{t('menu.description')}</span>
      </span>
    </button>
  )
}
