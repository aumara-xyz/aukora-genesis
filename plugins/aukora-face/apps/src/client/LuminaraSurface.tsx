import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'

/** Render the complete vendored Luminara portal. */
export function LuminaraSurface(props: StockAppSurfaceProps) {
  return (
    <EmbeddedAppSurface
      {...props}
      id="luminara"
      title={props.t('luminara.name')}
      src="/app/luminara-read.html"
      allow="autoplay; midi"
    />
  )
}
