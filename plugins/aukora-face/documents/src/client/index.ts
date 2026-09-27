/**
 * Standalone Documents browser plugin: the private root's markdown, read-only.
 *
 * The host half registers two read-only routes over `~/aukora-private` and this half
 * fetches them same-origin. Nothing here carries document bytes of its own: with the
 * host routes absent or refusing, the surface shows the reason rather than a list.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@aukora/face-layout/client'
import { DocumentsMenu } from './DocumentsMenu.tsx'
import { DocumentsSurface } from './DocumentsSurface.tsx'
import { en, zh, type DocumentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Documents launcher and categorized portal grid. */
    documents: DocumentsKey
  }
}

const NS = 'documents'

/** Services required by the Documents browser plugin. */
export const inject = ['slots', 'locale']

/**
 * Register the Documents dictionaries, Apps launcher, and center surface.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-documents: dictionaries')
  ctx.slots.inject('shell.menu.apps', () => ctx.slots.register({
    name: 'shell.menu.apps',
    id: 'documents',
    order: 60,
    locale: NS,
  }, DocumentsMenu))
  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface',
    id: 'documents',
    order: 60,
    locale: NS,
  }, DocumentsSurface))
}
