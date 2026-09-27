/** Settings-section entries in the shell's right-side System menu. */
import clsx from 'clsx'
import type { SettingsMenuComponentProps } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

/**
 * Render every registered settings section as a direct System-menu row.
 * @param props - composed system-menu props.
 * @returns the settings section menu buttons.
 */
export function SettingsMenu({
  activeSurface,
  surfaceTarget,
  openSurface,
  useSections,
}: SettingsMenuComponentProps) {
  const rows = useSections(snapshot => snapshot)
  const selected = rows.find(row => row.id === surfaceTarget) ?? rows[0]
  return (
    <>
      {rows.map((row) => {
        const active = activeSurface === 'settings' && row.id === selected?.id
        return (
          <button
            key={row.id}
            type="button"
            className={clsx(css.menuItem, active && css.menuItemActive)}
            aria-current={active ? 'page' : undefined}
            aria-label={row.label}
            onClick={() => { openSurface('settings', row.id) }}
          >
            <span className={css.systemMenuCopy}>
              <strong>{row.label}</strong>
            </span>
          </button>
        )
      })}
    </>
  )
}
