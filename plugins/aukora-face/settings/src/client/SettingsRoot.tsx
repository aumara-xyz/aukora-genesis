/**
 * Inline settings surface. The shell keeps every surface mounted and supplies
 * its active id plus the section selected from the System menu.
 */
import { useCallback, useEffect, useId } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isEditableTarget } from './escape.ts'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

type SurfaceContentProps = {
  renderSlot: SettingsRootComponentProps['renderSlot']
  section: SettingsSectionRow | undefined
  onClose: () => void
}

/** Render the selected settings section across the complete center pane. */
function SettingsSurfaceContent({ renderSlot, section, onClose }: SurfaceContentProps) {
  const titleId = useId()

  return (
    <div className={css.panel} role="dialog" aria-labelledby={titleId}>
      <div className={css.content}>
        <div className={css.header}>
          <div className={css.title} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div className={css.actions}>{renderSlot('settings.action', {})}</div>
          <button type="button" className={css.close} onClick={onClose}>
            <IconCloseOutline16 size={14} />
            <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
          </button>
        </div>
        <div className={css.options}>
          {section !== undefined && renderSlot('settings.section', { close: onClose }, { only: section.id })}
        </div>
      </div>
    </div>
  )
}

/**
 * Render the always-mounted settings surface.
 * @param props - composed shell-surface props.
 * @returns the settings surface element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    activeSurface, surfaceTarget, closeSurface, useSections, renderSlot,
  } = props
  const active = activeSurface === 'settings'

  const close = useCallback(() => {
    closeSurface()
  }, [closeSurface])

  useEffect(() => {
    if (!active) return
    // Bubble-phase, deferring to consumed events: Modal/Menu take Escape in
    // capture and mark it defaultPrevented, and Escape inside a text-entry
    // control belongs to that control, so only an unclaimed press closes the
    // surface.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [active, close])

  const rows = useSections(snapshot => snapshot)
  // A feature can unregister the requested section during HMR. Both this
  // surface and the System menu then resolve to the first remaining entry.
  const section = rows.find(row => row.id === surfaceTarget) ?? rows[0]

  return (
    <section className={css.surface} hidden={!active} data-settings-surface>
      <SettingsSurfaceContent
        renderSlot={renderSlot}
        section={section}
        onClose={close}
      />
    </section>
  )
}
