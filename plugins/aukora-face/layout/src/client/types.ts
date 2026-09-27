/** Owner-prop contracts supplied by the spatial root shell. */
import type { SurfacePresentation } from './stores.ts'

/** Shared navigation owner props for center-surface entries. */
export interface SurfaceOwnerProps {
  /** Surface currently selected in the center lane, or undefined for the empty app canvas. */
  activeSurface?: string
  /** Optional feature-owned target within the selected surface. */
  surfaceTarget?: string
  /** Select a surface, an optional internal target, and its focused-canvas behavior. */
  openSurface: (id: string, target?: string, presentation?: SurfacePresentation) => void
  /** Return the center lane to its empty app canvas. */
  closeSurface: () => void
}

/** Shared navigation owner props for right-menu entries. */
export interface MenuItemOwnerProps {
  /** Surface currently selected in the center lane, or undefined for the empty app canvas. */
  activeSurface?: string
  /** Optional feature-owned target within the selected surface. */
  surfaceTarget?: string
  /** Select a surface, an optional internal target, and its focused-canvas behavior. */
  openSurface: (id: string, target?: string, presentation?: SurfacePresentation) => void
  /** Return the center lane to its empty app canvas. */
  closeSurface: () => void
}

/** Sidebar owner share retained for the thread-lane occupant. */
export interface SidebarOwnerProps {
  /** True when the current pane preset hides the thread lane. */
  collapsed: boolean
  /** Current thread-lane content width in pixels. */
  width: number
}

/**
 * Right-column owner share. The shape is the harness's, member for member:
 * `rightbar` is declared by the upstream frame too, and a second declaration
 * of the same slot with a different share is a type error in any program that
 * sees both. The conversation panel takes no owner share at all.
 */
export interface RightbarOwnerProps {
  /** Resolved normal panel width in px, not the saved preference; zero if it cannot fit. */
  width: number
  /** Current frame width in px. */
  viewportWidth: number
  /**
   * Whether a normal right panel can retain 300px beside a 400px center.
   * Before a narrow opening, includes the space from collapsing the left sidebar.
   */
  canShow: boolean
}
