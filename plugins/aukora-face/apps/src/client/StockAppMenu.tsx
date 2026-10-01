/** Triangle-menu launchers for the bundled Aukora applications. */
import type { StockAppMenuProps } from './contract.ts'
import css from './StockApps.module.css'

export type StockAppId = 'auma-language' | 'auma-live' | 'zeta-harp' | 'auma-canvas' | 'human-graph' | 'media'

type MenuCopyPrefix = 'language' | 'live' | 'harp' | 'canvas' | 'humanGraph' | 'media'

interface MenuSpec {
  id: StockAppId
  copy: MenuCopyPrefix
  presentation: 'contained' | 'full-bleed'
}

/** Stock-app registry values shared by registration and component tests. */
const AUMA_LANGUAGE_APP = { id: 'auma-language', copy: 'language', presentation: 'full-bleed' } as const
const AUMA_LIVE_APP = { id: 'auma-live', copy: 'live', presentation: 'full-bleed' } as const
const ZETA_HARP_APP = { id: 'zeta-harp', copy: 'harp', presentation: 'full-bleed' } as const
const AUMA_CANVAS_APP = { id: 'auma-canvas', copy: 'canvas', presentation: 'full-bleed' } as const
const HUMAN_GRAPH_APP = { id: 'human-graph', copy: 'humanGraph', presentation: 'full-bleed' } as const
const MEDIA_APP = { id: 'media', copy: 'media', presentation: 'contained' } as const

export const STOCK_APPS = [
  AUMA_LANGUAGE_APP,
  AUMA_LIVE_APP,
  ZETA_HARP_APP,
  AUMA_CANVAS_APP,
  HUMAN_GRAPH_APP,
  MEDIA_APP,
] as const satisfies readonly MenuSpec[]

function StockAppMenu({ spec, activeSurface, openSurface, t }: StockAppMenuProps & { spec: MenuSpec }) {
  const active = activeSurface === spec.id
  return (
    <button aria-label={t(`${spec.copy}.name`)}
      type="button"
      data-stock-app-launcher={spec.id}
      aria-current={active ? 'page' : undefined}
      onClick={() => { openSurface(spec.id, undefined, spec.presentation) }}
    >
      <span className={css.menuCopy}>
        <strong>{t(`${spec.copy}.name`)}</strong>
        {spec.copy !== 'humanGraph' && spec.copy !== 'media' && <span>{t(`${spec.copy}.menu`)}</span>}
      </span>
    </button>
  )
}

/** Render the Auma Language launcher. */
export function AumaLanguageMenu(props: StockAppMenuProps) {
  return <StockAppMenu {...props} spec={AUMA_LANGUAGE_APP} />
}

/** Render the Auma Live launcher. */
export function AumaLiveMenu(props: StockAppMenuProps) {
  return <StockAppMenu {...props} spec={AUMA_LIVE_APP} />
}

/** Render the Zeta Harp launcher. */
export function ZetaHarpMenu(props: StockAppMenuProps) {
  return <StockAppMenu {...props} spec={ZETA_HARP_APP} />
}

/** Render the Auma Canvas prototype launcher. */
export function AumaCanvasMenu(props: StockAppMenuProps) {
  return <StockAppMenu {...props} spec={AUMA_CANVAS_APP} />
}

export function HumanGraphMenu(props: StockAppMenuProps) {
  return <StockAppMenu {...props} spec={HUMAN_GRAPH_APP} />
}

export function MediaMenu(props: StockAppMenuProps) {
  return <StockAppMenu {...props} spec={MEDIA_APP} />
}
