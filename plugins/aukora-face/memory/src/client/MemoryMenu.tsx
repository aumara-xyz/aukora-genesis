/** The Memory entry in the shell's right-side menu. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Memory.module.css'

/** Full props for the Memory launcher. */
export type MemoryMenuProps =
  PropsRuntime<'shell.menu.apps'>
  & PropsLocale<'memory'>

/**
 * Open the Memory view in the centre.
 *
 * ONE CLICK, ONE PLACE: the launcher opens the surface the way the design's §7.1 asks (`contained` in the centre),
 * and it marks itself current while that surface is open so a person can see where they are.
 *
 * @param props - the right-menu owner share and the localized copy.
 * @returns the Memory launcher button.
 */
export function MemoryMenu({ activeSurface, openSurface, t }: MemoryMenuProps) {
  const active = activeSurface === 'memory'
  return (
    <button
      type="button"
      data-memory-launcher
      className={css.memoryMenuItem}
      aria-current={active ? 'page' : undefined}
      title={t('menu.memory.tip')}
      onClick={() => { openSurface('memory', undefined, 'contained') }}
    >
      {t('menu.memory')}
    </button>
  )
}
