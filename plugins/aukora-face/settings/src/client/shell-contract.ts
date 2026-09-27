/**
 * Settings shell component contracts. They live beside the shell because
 * they compose ui-layout's presentation slots; ui-settings remains the
 * presentation-independent home of the settings slots registrants fill.
 */
import type { HostObservable, InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the shell surface/menu SlotMap entries and ctx.layout merge
// into every program that sees this contract.
import type {} from '@aukora/face-layout/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** One System-menu row projected from a settings.section registration. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): the ledger's menu-row projection as a hooks-compartment source —
 * the shell reads no locale state and subscribes through the bound hook.
 */
export type SettingsRootInjected = {
  hooks: {
    /** settings.section ledger projected into ordered System-menu rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
  }
}

/** Injected onboarding coordination owned by the settings shell plugin. */
export type SettingsOnboardingInjected = {
  /** Open the settings surface at one section through ctx.layout. */
  openSection: (id: string) => void
  hooks: {
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
  }
}

/**
 * Full component props of the inline settings surface. Shell visibility and
 * the selected section target come from ui-layout's owner share.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'shell.surface'>
  & PropsRenderSlots<
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
  >
  & InjectFace<SettingsRootInjected>

/** Full component props of the Settings row in the shell's system menu. */
export type SettingsMenuComponentProps =
  PropsRuntime<'shell.menu.system'>
  & InjectFace<SettingsRootInjected>

/** Full component props of the always-mounted onboarding coordinator. */
export type SettingsOnboardingComponentProps =
  PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'settings.onboarding'>
  & InjectFace<SettingsOnboardingInjected>
