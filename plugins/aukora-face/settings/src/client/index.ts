/**
 * Settings shell and ownerless-copy plugin, browser half. It contributes the
 * Settings and Aura Coherence surfaces, their rows in the shell's System menu, and the
 * onboarding coordinator, then registers the chrome, General section,
 * local-document action, and dictionaries that belong to no single feature.
 * Feature-owned rows and sections stay with their features.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AuraCoherenceMenu } from './AuraCoherenceMenu.tsx'
import { AuraCoherenceSurface } from './AuraCoherenceSurface.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the shell slots and ctx.layout service face into this
// program without adding a runtime import.
import type {} from '@aukora/face-layout/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  SettingsOnboardingInjected, SettingsOnboardingStep, SettingsRootInjected,
  SettingsSectionRow,
} from './shell-contract.ts'
import { SettingsRoot } from './SettingsRoot.tsx'
import { SettingsMenu } from './SettingsMenu.tsx'
import { SettingsOnboarding } from './SettingsOnboarding.tsx'
import { CloseLabel, HeaderContent } from './chrome.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { SettingsDocumentAction } from './SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from './SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from './settings-document-store.ts'
import { en, zh, type SettingsKey } from './locales.ts'

export type {
  CloseLabelProps, HeaderContentProps,
} from './chrome.tsx'
export type {
  GeneralSectionComponentProps,
} from './GeneralSection.tsx'
export type { SettingsDocumentActionInjected, SettingsDocumentActionProps } from './SettingsDocumentAction.tsx'
export type { SettingsDocumentState } from './settings-document-store.ts'
export { SettingsDocumentStore } from './settings-document-store.ts'
export type { SettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome + shell-owned General section copy. */
    settings: SettingsKey
  }
}

/** Dictionary namespace owned by this plugin (shell chrome + General copy). */
const NS = 'settings'

/**
 * Required services (Cordis fiber inject). ui-layout declares the shell slots;
 * each settings child slot is declared by this plugin's corresponding shell
 * entry. Registration order stays unconstrained through `slots.inject()`.
 */
export const inject = [
  'slots', 'locale', 'connection',
  'remote',
  'remote.settings', 'settingsScope', 'layout',
]

/**
 * Register the `settings` dictionaries, both System apps, the chrome content,
 * and the General section once their slot declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-general: dictionaries')

  // Copy freshness is framework-owned: components read the standard `t`
  // seat, and the menu label is a thunk the owner resolves per render — no
  // locale/change re-registration wiring.
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  // The action follows the shared describe mirror, whose owning plugin
  // already refreshes it on document commits and reconnects.
  const documentController = connection.isLoopback
    ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe())
    : undefined
  const documentInjected = documentController === undefined
    ? undefined
    : (): SettingsDocumentActionInjected => ({
      controller: documentController,
      hooks: { snapshot: documentController.store },
    })
  ctx.effect(() => () => { documentController?.dispose() }, 'ui-settings-general: document action directory')
  // Ledger → menu-row projection as an observable source (uSES contract:
  // getSnapshot returns the cached rows until the ledger version moves).
  // Labels may be locale-following thunks, so the cache key includes the
  // locale revision and subscribers ride both sources.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []
  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []
  const shellInjected = (): SettingsRootInjected => ({
    hooks: {
      sections: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.section')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== rowsVersion || revision !== rowsRevision) {
            rowsVersion = version
            rowsRevision = revision
            rows = ctx.slots.entries('settings.section')
              .map((entry) => {
                return {
                  /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
                  id: entry.options.id ?? '',
                  order: entry.options.order ?? 0,
                  label: resolveSlotLabel(entry.options.label) ?? '',
                }
              })
              .sort((a, b) => a.order - b.order)
          }
          return rows
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.section', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })
  const onboardingInjected = (): SettingsOnboardingInjected => ({
    openSection: (id) => { ctx.layout.openSurface('settings', id) },
    hooks: {
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
    },
  })

  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface',
    id: 'settings',
    order: 0,
    children: {
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
    inject: shellInjected,
  }, SettingsRoot))
  ctx.slots.inject('shell.menu.system', () => ctx.slots.register({
    name: 'shell.menu.system',
    id: 'settings',
    order: 0,
    inject: shellInjected,
  }, SettingsMenu))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'settings-onboarding',
    children: {
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: onboardingInjected,
  }, SettingsOnboarding))

  ctx.slots.inject('settings.header', () =>
    ctx.slots.register({ name: 'settings.header', locale: NS }, HeaderContent))
  if (documentInjected !== undefined) {
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'open-document',
      order: 0,
      locale: NS,
      inject: documentInjected,
    }, SettingsDocumentAction))
  }
  ctx.slots.inject('settings.close', () =>
    ctx.slots.register({ name: 'settings.close', locale: NS }, CloseLabel))
  // Aura Coherence: a living view of system state, as its own surface and its own
  // System-menu row.
  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface', id: 'aura-coherence', order: 60, locale: NS,
  }, AuraCoherenceSurface))
  ctx.slots.inject('shell.menu.system', () => ctx.slots.register({
    name: 'shell.menu.system', id: 'aura-coherence', order: -10, locale: NS,
  }, AuraCoherenceMenu))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => t('general.nav'),
    locale: NS,
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, GeneralSection))
}
