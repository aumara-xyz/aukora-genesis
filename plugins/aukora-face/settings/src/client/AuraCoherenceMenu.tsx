// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Text-only Aura Coherence entry in the shell's right-side System menu. */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SettingsRoot.module.css'

/** Full props for the standalone Aura Coherence System launcher. */
export type AuraCoherenceMenuProps =
  PropsRuntime<'shell.menu.system'>
  & PropsLocale<'settings'>

/**
 * Open the standalone Aura Coherence surface.
 * @param props - System-menu owner share and localized copy.
 * @returns the Aura Coherence launcher button.
 */
export function AuraCoherenceMenu({
  activeSurface,
  openSurface,
  t,
}: AuraCoherenceMenuProps) {
  const active = activeSurface === 'aura-coherence'
  return (
    <button
      type="button"
      className={clsx(css.menuItem, active && css.menuItemActive)}
      aria-current={active ? 'page' : undefined}
      onClick={() => { openSurface('aura-coherence') }}
    >
      <span className={css.systemMenuCopy}>
        <strong>{t('aura.trigger')}</strong>
        <span>{t('aura.menu')}</span>
      </span>
    </button>
  )
}
