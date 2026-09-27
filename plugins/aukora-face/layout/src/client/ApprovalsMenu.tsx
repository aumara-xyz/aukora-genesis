/** The Approvals entry in the shell's right-side menu, beside Memory. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { APPROVALS_SURFACE } from './approvals-model.ts'
import css from './FirstRun.module.css'

/** Full props for the Approvals launcher. */
export type ApprovalsMenuProps =
  PropsRuntime<'shell.menu.apps'>
  & PropsLocale<'layout'>

/**
 * Open the Approvals history in the centre.
 *
 * ONE CLICK, ONE PLACE, the same way the Memory entry does it: `contained` in the centre, marked current while it is
 * open, so a person can see where they are.
 */
export function ApprovalsMenu({ activeSurface, openSurface, t }: ApprovalsMenuProps) {
  const active = activeSurface === APPROVALS_SURFACE
  return (
    <button
      type="button"
      data-approvals-launcher
      className={active ? `${css.firstRunMenuItem} ${css.firstRunMenuItemActive}` : css.firstRunMenuItem}
      aria-current={active ? 'page' : undefined}
      title={t('menu.approvals.tip')}
      onClick={() => { openSurface(APPROVALS_SURFACE, undefined, 'contained') }}
    >
      {t('menu.approvals')}
    </button>
  )
}
