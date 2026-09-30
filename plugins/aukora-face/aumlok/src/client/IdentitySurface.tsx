import { useEffect } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AumlokSurfaceInjected } from './AumlokSurface.tsx'
import { IdentityCard, type ReadIdentity } from './IdentityCard.tsx'
import css from './Aumlok.module.css'

export interface IdentitySurfaceInjected {
  hooks: AumlokSurfaceInjected['hooks']
  readIdentity: ReadIdentity
  refreshControlStatus: () => void
}

export function IdentityMenu({ activeSurface, openSurface, t }:
  PropsRuntime<'shell.menu.system'> & PropsLocale<'aumlok'>) {
  const active = activeSurface === 'identity'
  return <button type="button" data-identity-launcher
    className={clsx(css.menuItem, active && css.menuItemActive)}
    aria-current={active ? 'page' : undefined} onClick={() => { openSurface('identity') }}>
    <span className={css.menuCopy}>
      <strong>{t('identity.title')}</strong><span>{t('identity.description')}</span>
    </span>
  </button>
}

export function IdentitySurface({ activeSurface, closeSurface, openSurface, useControlProjection,
  readIdentity, refreshControlStatus, t }:
  PropsRuntime<'shell.surface'> & PropsLocale<'aumlok'> & InjectFace<IdentitySurfaceInjected>) {
  const active = activeSurface === 'identity'
  const projection = useControlProjection(value => value)
  useEffect(() => {
    if (!active) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeSurface()
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape) }
  }, [active, closeSurface])
  return <section className={clsx(css.surface, css.identityPanel)} hidden={!active} data-identity-surface>
    {active ? <IdentityCard projection={projection} active readIdentity={readIdentity}
      refreshControlStatus={refreshControlStatus} openAumlok={() => { openSurface('aumlok') }} t={t} /> : null}
  </section>
}
