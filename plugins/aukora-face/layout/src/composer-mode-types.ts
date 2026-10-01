/** Host-reported policy state. Availability describes the required native boundary, not a permission preset. */
export type ComposerMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export interface ComposerModeView { mode: ComposerMode; available: boolean }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { aukoraComposerMode: ComposerMode | null }
  interface SessionProjectionMap { aukoraComposerMode: ComposerModeView }
}
