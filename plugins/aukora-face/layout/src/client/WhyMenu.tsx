/** The "why did she say that?" entry in the shell's right-side menu. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WHY_SURFACE } from './why-model.ts'
import css from './Why.module.css'

/** Full props for the attention launcher. */
export type WhyMenuProps =
  PropsRuntime<'shell.menu.apps'>
  & PropsLocale<'layout'>

/** Open the attention view in the centre, the same way its siblings do. */
export function WhyMenu({ activeSurface, openSurface, t }: WhyMenuProps) {
  const active = activeSurface === WHY_SURFACE
  return (
    <button
      type="button"
      data-why-launcher
      className={active ? `${css.whyMenuItem} ${css.whyMenuItemActive}` : css.whyMenuItem}
      aria-current={active ? 'page' : undefined}
      title={t('menu.why.tip')}
      onClick={() => { openSurface(WHY_SURFACE, undefined, 'contained') }}
    >
      {t('menu.why')}
    </button>
  )
}
