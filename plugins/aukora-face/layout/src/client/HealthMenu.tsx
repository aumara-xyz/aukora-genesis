/** The Health entry in the shell's right-side menu, beside Memory and Approvals. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { HEALTH_SURFACE } from './health-model.ts'
import css from './Health.module.css'

/** Full props for the Health launcher. */
export type HealthMenuProps =
  PropsRuntime<'shell.menu.apps'>
  & PropsLocale<'layout'>

/** Open the Health panel in the centre, the same way its siblings do. */
export function HealthMenu({ activeSurface, openSurface, t }: HealthMenuProps) {
  const active = activeSurface === HEALTH_SURFACE
  return (
    <button
      type="button"
      data-health-launcher
      className={active ? `${css.healthMenuItem} ${css.healthMenuItemActive}` : css.healthMenuItem}
      aria-current={active ? 'page' : undefined}
      title={t('menu.health.tip')}
      onClick={() => { openSurface(HEALTH_SURFACE, undefined, 'contained') }}
    >
      {t('menu.health')}
    </button>
  )
}
