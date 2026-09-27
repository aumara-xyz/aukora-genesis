import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'

/** Render the complete vendored Zeta Harp instrument. */
export function ZetaHarpSurface(props: StockAppSurfaceProps) {
  return (
    <EmbeddedAppSurface
      {...props}
      id="zeta-harp"
      title={props.t('harp.name')}
      src="/stock-apps/zeta-harp/index.html"
      allow="autoplay"
    />
  )
}
