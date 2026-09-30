/** Memory launcher and centre surface. Host routes combine the Kira ledger and OpenViking. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// **THE TWO SIDE-EFFECT IMPORTS THAT LOAD THE `slots` AUGMENTATION.** `aumlok/src/client/index.ts:3-4` carries both;
// `memory` carried neither, so `ctx.slots` was *"Property 'slots' does not exist on type 'Context'"* at four sites.
// **These lines do nothing at runtime — their whole job is to make the module that declares `ctx.slots` part of the
// program.** A service that exists in the running app and not in the types, because nobody imported the module that
// declares it, is the same defect as `layout`'s missing `@deepseek-ai/dsh-host-webserver` import twenty minutes ago.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@aukora/face-layout/client'
import { MemoryMenu } from './MemoryMenu.tsx'
import { MemorySurface } from './MemorySurface.tsx'
import { NS, en, zh } from './locales.ts'
import type { MemoryKey } from './locales.ts'

// **THE FACE DECLARES ITS LOCALE NAMESPACE, WHICH IS WHAT MAKES `NS` A VALID KEY.** `aumlok` does this at its
// `:26-33`; without it `ctx.locale.register('memory', …)` is refused by the type even though the constant is right.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Memory app's strings. */
    memory: MemoryKey
  }
}

/** Services required by the Memory browser plugin. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register the Memory dictionaries, its right-menu launcher and its centre surface.
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memory: dictionaries')
  // THE RIGHT-SIDE MENU, WHERE PETER ASKED FOR IT: one entry, and clicking it opens the view in the middle.
  ctx.slots.inject('shell.menu.apps', () => ctx.slots.register({
    name: 'shell.menu.apps',
    id: 'memory',
    order: 40,
    locale: NS,
  }, MemoryMenu))
  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface',
    id: 'memory',
    order: 40,
    locale: NS,
    // **THE EVIDENCE, ONE CLICK AWAY, WHICH IS THE DESIGN'S POINT ABOUT A ROW (§7.2: "a tap opens the evidence
    // turn").** The click goes through the service the shipped interface uses, not a link, and the parameter is the
    // branded `SessionId` rather than a string. **WHAT IT CANNOT DO IS NAMED RATHER THAN HIDDEN**: it opens the
    // conversation, because no API exists to jump to a particular turn — so the row says "open the conversation",
    // not "open the exact moment".
    // **NO NEW DEPENDENCY FOR A TYPE**: the sibling face imports the branded `SessionId` from
    // `@deepseek-ai/dsh-session/types`, a package NEITHER face declares — so this one takes the type the service
    // itself accepts, which is the same thing without adding an undeclared import. (This lane's own bare-import arm is
    // what would have caught it, which is why the arm exists.)
    inject: (): { readonly openSource: (sessionId: string) => void } => ({
      openSource: (sessionId: string) => {
        ctx.sessions.open(sessionId as Parameters<typeof ctx.sessions.open>[0])
      },
    }),
  }, MemorySurface))
}
