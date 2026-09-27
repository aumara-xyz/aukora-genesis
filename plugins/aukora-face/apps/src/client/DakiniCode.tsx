/** Dakini Code occupies the user's circle-menu app seat. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'
import css from './StockApps.module.css'

type DakiniMenuProps = PropsRuntime<'shell.menu.yours'> & PropsLocale<'stockApps'>

/** Render the independent Dakini Code app launcher. */
export function DakiniCodeMenu({ activeSurface, openSurface, t }: DakiniMenuProps) {
  return (
    <button
      type="button"
      data-user-app-launcher="dakini-code"
      aria-current={activeSurface === 'dakini-code' ? 'page' : undefined}
      onClick={() => { openSurface('dakini-code', undefined, 'full-bleed') }}
    >
      <span className={css.menuCopy}>
        <strong>{t('dakini.name')}</strong>
        <span>{t('dakini.menu')}</span>
      </span>
    </button>
  )
}

/** Render the pinned static app without requiring its development server. */
export function DakiniCodeSurface(props: StockAppSurfaceProps) {
  return (
    <EmbeddedAppSurface
      {...props}
      id="dakini-code"
      title={props.t('dakini.name')}
      src="/stock-apps/dakini-code/index.html"
      allow="autoplay"
    />
  )
}
