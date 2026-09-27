/** Standalone Messages browser plugin over this node's contacts (no messaging engine yet). */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@aukora/face-layout/client'
import { MessagesMenu } from './MessagesMenu.tsx'
import { MessagesSurface } from './MessagesSurface.tsx'
import { en, zh, type MessagesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Messages launcher and person-to-person preview. */
    messages: MessagesKey
  }
}

const NS = 'messages'

/**
 * The surface is exported beside the plugin that registers it, because one caller needs the component
 * rather than the slot registration: the render harness at `scripts/face/render-probe.mjs` mounts it
 * at a measured pane width and reads the boxes back. A harness that re-implemented the surface would
 * measure itself, and one that drove the whole shell would measure the shell.
 */
export { MessagesSurface }

/** Services required by the Messages browser plugin. */
export const inject = ['slots', 'locale']

/**
 * Register the Messages dictionaries, Apps launcher, and center surface.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-messages: dictionaries')
  ctx.slots.inject('shell.menu.apps', () => ctx.slots.register({
    name: 'shell.menu.apps',
    id: 'messages',
    order: 50,
    locale: NS,
  }, MessagesMenu))
  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface',
    id: 'messages',
    order: 50,
    locale: NS,
  }, MessagesSurface))
}
