/** Component contracts for bundled app menu rows and center surfaces. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@aukora/face-layout/client'
import type { StockAppsKey } from './locales.ts'

/** Full props for one bundled-app launcher in the triangle menu. */
export type StockAppMenuProps = PropsRuntime<'shell.menu.apps'> & PropsLocale<'stockApps'>

/** Full props for one bundled center-app surface. */
export type StockAppSurfaceProps = PropsRuntime<'shell.surface'> & PropsLocale<'stockApps'>

/** Locale table marker used by the composed props above. */
export type StockAppsLocaleKey = StockAppsKey
