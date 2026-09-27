/**
 * Transient spatial-layout state for the root shell. Pane geometry is a
 * closed set of fractional presets rather than mutable pixel preferences;
 * surfaces and details share the same action set so every navigation gesture
 * produces one atomic shell state.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Fractional lane arrangement: [threads, active surface, menu/details]. */
export type PanePreset =
  | 'balanced'
  | 'left-wide'
  | 'left-menu-wide'
  | 'left-focus'
  | 'center-left-wide'
  | 'center-right-wide'
  | 'center-focus'
  | 'right-wide'
  | 'right-threads-wide'
  | 'right-focus'

/** Whether a focused application owns the whole canvas or a centered content shell. */
export type SurfacePresentation = 'contained' | 'full-bleed'

/** Fractional track weights for every supported pane preset. */
export const PANE_WEIGHTS: Readonly<Record<PanePreset, readonly [number, number, number]>> = {
  balanced: [1, 1, 1],
  'left-wide': [2, 1, 0],
  'left-menu-wide': [2, 0, 1],
  'left-focus': [3, 0, 0],
  'center-left-wide': [0, 2, 1],
  'center-right-wide': [1, 2, 0],
  'center-focus': [0, 3, 0],
  'right-wide': [0, 1, 2],
  'right-threads-wide': [1, 0, 2],
  'right-focus': [0, 0, 3],
}

type PaneWeights = readonly [number, number, number]

const PRESET_BY_WEIGHTS = new Map<string, PanePreset>(
  Object.entries(PANE_WEIGHTS).map(([preset, weights]) => [weights.join(','), preset as PanePreset]),
)

/**
 * Resolve one of the ten integer compositions of three lane thirds.
 * @param weights - next [threads, surface, menu/details] weights.
 * @returns the named preset for those weights.
 */
function presetFor(weights: PaneWeights): PanePreset {
  const preset = PRESET_BY_WEIGHTS.get(weights.join(','))
  if (preset === undefined) throw new Error(`layout: unsupported pane weights ${weights.join('/')}`)
  return preset
}

/**
 * Grow an outer lane by one third, taking space from the far side first.
 * Full-screen outer lanes return one third to the adjacent center lane.
 * @param current - current pane preset.
 * @param side - outer lane whose only hot corner was activated.
 * @returns the next pane preset, or the current preset when that lane is hidden.
 */
function cycleOuterPane(current: PanePreset, side: 'left' | 'right'): PanePreset {
  const [left, center, right] = PANE_WEIGHTS[current]
  if (side === 'left') {
    if (left === 0) return current
    if (left === 3) return presetFor([2, 1, 0])
    if (right > 0) return presetFor([left + 1, center, right - 1])
    return presetFor([left + 1, center - 1, right])
  }
  if (right === 0) return current
  if (right === 3) return presetFor([0, 1, 2])
  if (left > 0) return presetFor([left - 1, center, right + 1])
  return presetFor([left, center - 1, right + 1])
}

/**
 * Transfer one third across a center-lane boundary. A boundary at the frame
 * edge pulls its adjacent outer lane in; an inset boundary expands center.
 * @param current - current pane preset.
 * @param side - center boundary whose hot corner was activated.
 * @returns the next pane preset, or the current preset when center is hidden.
 */
function cycleCenterBoundary(current: PanePreset, side: 'left' | 'right'): PanePreset {
  const [left, center, right] = PANE_WEIGHTS[current]
  if (center === 0) return current
  if (side === 'left') {
    if (left === 0) return presetFor([1, center - 1, right])
    return presetFor([left - 1, center + 1, right])
  }
  if (right === 0) return presetFor([left, center - 1, 1])
  return presetFor([left, center + 1, right - 1])
}

/** Root shell viewing state. */
export interface LayoutState {
  /** Application surface shown in the center lane; absent leaves the app canvas empty. */
  activeSurface?: string
  /** Optional feature-owned target within the active surface. */
  surfaceTarget?: string
  /** Focused-canvas behavior selected by the active application. */
  surfacePresentation?: SurfacePresentation
  /** Whether the left lane shows the resident Conversation instead of the thread browser. */
  conversationOpen: boolean
  /** Whether a real Session may replace the right menu with details. */
  detailsOpen: boolean
  /** Current fractional lane arrangement. */
  panePreset: PanePreset
}

/** Complete mutation set exposed to the root component and ctx.layout. */
type LayoutActions = {
  cycleLeft: (draft: LayoutState) => void
  cycleCenterLeft: (draft: LayoutState) => void
  cycleCenterRight: (draft: LayoutState) => void
  cycleRight: (draft: LayoutState) => void
  selectSurface: (
    draft: LayoutState,
    id: string,
    target?: string,
    presentation?: SurfacePresentation,
  ) => void
  closeSurface: (draft: LayoutState) => void
  openConversation: (draft: LayoutState) => void
  closeConversation: (draft: LayoutState) => void
  toggleSidebar: (draft: LayoutState) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
}

/**
 * Create an independent spatial-layout store. State is intentionally
 * transient: a reload returns to the balanced conversation shell.
 * @returns the store handle used by the root slot registration.
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({
      conversationOpen: false,
      detailsOpen: false,
      panePreset: 'balanced',
    }),
    actions: {
      cycleLeft: (d) => {
        d.panePreset = cycleOuterPane(d.panePreset, 'left')
      },
      cycleCenterLeft: (d) => {
        d.panePreset = cycleCenterBoundary(d.panePreset, 'left')
      },
      cycleCenterRight: (d) => {
        d.panePreset = cycleCenterBoundary(d.panePreset, 'right')
      },
      cycleRight: (d) => {
        d.panePreset = cycleOuterPane(d.panePreset, 'right')
      },
      selectSurface: (
        d,
        id: string,
        target?: string,
        presentation: SurfacePresentation = 'contained',
      ) => {
        d.activeSurface = id
        d.surfacePresentation = presentation
        if (target === undefined) delete d.surfaceTarget
        else d.surfaceTarget = target
        d.detailsOpen = false
        d.panePreset = 'center-right-wide'
      },
      closeSurface: (d) => {
        delete d.activeSurface
        delete d.surfaceTarget
        delete d.surfacePresentation
        d.detailsOpen = false
        d.panePreset = 'balanced'
      },
      openConversation: (d) => {
        d.conversationOpen = true
        d.detailsOpen = false
        if (PANE_WEIGHTS[d.panePreset][0] === 0) d.panePreset = 'balanced'
      },
      closeConversation: (d) => {
        d.conversationOpen = false
        d.detailsOpen = false
        if (PANE_WEIGHTS[d.panePreset][0] === 0) d.panePreset = 'balanced'
      },
      toggleSidebar: (d) => {
        d.panePreset = PANE_WEIGHTS[d.panePreset][0] === 0 ? 'balanced' : 'center-left-wide'
      },
      openDetails: (d) => {
        d.detailsOpen = true
        d.panePreset = 'balanced'
      },
      closeDetails: (d) => { d.detailsOpen = false },
    },
  })
}
