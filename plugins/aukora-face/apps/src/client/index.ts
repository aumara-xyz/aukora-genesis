/** Bundled app launchers and surfaces for the spatial shell. */
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@aukora/face-layout/client'
import { AumaLanguageSurface } from './AumaLanguageSurface.tsx'
import { AumaLiveSurface } from './AumaLiveSurface.tsx'
import { ZetaHarpSurface } from './ZetaHarpSurface.tsx'
import { HumanGraphSurface } from './HumanGraphSurface.tsx'
import { MediaSurface } from './MediaSurface.tsx'
import { DakiniCodeMenu, DakiniCodeSurface } from './DakiniCode.tsx'
import {
  AumaLanguageMenu,
  AumaLiveMenu,
  STOCK_APPS,
  ZetaHarpMenu,
  HumanGraphMenu,
  MediaMenu,
} from './StockAppMenu.tsx'
import { en, zh, type StockAppsKey } from './locales.ts'

export type { StockAppMenuProps, StockAppSurfaceProps } from './contract.ts'
export type { StockAppsKey } from './locales.ts'
export type { StockAppId } from './StockAppMenu.tsx'
export type * from '../auma-canvas/types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Bundled Aukora app launchers and surfaces. */
    stockApps: StockAppsKey
  }
}

const NS = 'stockApps'

/** Services required by the stock-app browser plugin. */
export const inject = ['slots', 'locale']

/**
 * Register all launchers and always-mounted center surfaces after the
 * spatial shell declares their registries.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-stock-apps: dictionaries')

  // AUMA CANVAS IS WITHHELD ON THIS HARNESS. Its surface reads a flat conversation
  // snapshot (nodes, chat.timeline, runningCalls, partial) that this harness version
  // replaced with registered conversation views. Registering it with a stand-in would
  // put a surface on screen that cannot follow a turn, so the app is not offered at
  // all until the surface is ported to the view model. Its menu entry is withheld with
  // it: an app a person can open and that then does nothing is worse than one absent.

  ctx.slots.inject('shell.menu.yours', () => ctx.slots.register({
    name: 'shell.menu.yours', id: 'dakini-code', locale: NS,
  }, DakiniCodeMenu))
  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface', id: 'dakini-code', order: 50, locale: NS,
  }, DakiniCodeSurface))

  const registrations = [
    { app: STOCK_APPS[0], Menu: AumaLanguageMenu, Surface: AumaLanguageSurface },
    { app: STOCK_APPS[1], Menu: AumaLiveMenu, Surface: AumaLiveSurface },
    { app: STOCK_APPS[2], Menu: ZetaHarpMenu, Surface: ZetaHarpSurface },
    { app: STOCK_APPS[4], Menu: HumanGraphMenu, Surface: HumanGraphSurface },
    { app: STOCK_APPS[5], Menu: MediaMenu, Surface: MediaSurface },
  ] as const
  registrations.forEach(({ app, Menu, Surface }, index) => {
    ctx.slots.inject('shell.menu.apps', () => ctx.slots.register({
      name: 'shell.menu.apps',
      id: app.id,
      order: index * 10,
      locale: NS,
    }, Menu))
    ctx.slots.inject('shell.surface', () => ctx.slots.register({
      name: 'shell.surface',
      id: app.id,
      order: index * 10,
      locale: NS,
    }, Surface))
  })
}
