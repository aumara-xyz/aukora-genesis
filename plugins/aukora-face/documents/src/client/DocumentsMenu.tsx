/** Text-only Documents entry in the shell's triangle Aukora Apps menu. */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FolderMarkIcon } from './DocumentsIcons.tsx'
import css from './Documents.module.css'

/** Full props for the standalone Documents launcher. */
export type DocumentsMenuProps =
  PropsRuntime<'shell.menu.apps'>
  & PropsLocale<'documents'>

/**
 * Open the Documents portal grid.
 * @param props - Apps-menu owner share and localized copy.
 * @returns the Documents launcher button.
 */
export function DocumentsMenu({ activeSurface, openSurface, t }: DocumentsMenuProps) {
  const active = activeSurface === 'documents'
  return (
    <button
      type="button"
      data-documents-launcher
      className={clsx(css.menuItem, active && css.menuItemActive)}
      aria-current={active ? 'page' : undefined}
      onClick={() => { openSurface('documents') }}
    >
      <span className={css.menuMark} aria-hidden="true">
        <FolderMarkIcon size={16} />
      </span>
      <span className={css.menuCopy}>
        <strong>{t('menu.title')}</strong>
        <span>{t('menu.description')}</span>
      </span>
    </button>
  )
}
