import type { StockAppSurfaceProps } from './contract.ts'
import { EmbeddedAppSurface } from './EmbeddedAppSurface.tsx'

/** Render the exact Auma Lingwa application from the live spatial source. */
export function AumaLanguageSurface(props: StockAppSurfaceProps) {
  return (
    <EmbeddedAppSurface
      {...props}
      id="auma-language"
      title={props.t('language.name')}
      src="/stock-apps/auma-lingwa.html"
      allow="autoplay"
    />
  )
}
