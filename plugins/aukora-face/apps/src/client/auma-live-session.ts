/**
 * WHICH SESSION THE LIVE SURFACE IS BOUND TO — and the one rule that keeps a thread click from reloading her.
 *
 * THE DEFECT THIS EXISTS FOR, measured at 10:02. The surface read the selected thread REACTIVELY and put it in
 * the iframe's address. Clicking a thread therefore rewrote `src`, the browser reloaded the document, and the
 * app inside fixed its session at load — so a sidebar click moved Auma from AURA to KIRA **with an empty
 * conversation**, because the new document started from nothing. The click was never meant to be a navigation;
 * it was meant to be a selection.
 *
 * THE RULE, IN ONE SENTENCE: **the session is bound ONCE, when the surface mounts, and only an EXPLICIT
 * follow action moves it.** A silent selection change is not a follow action. That is the whole fix, and it is
 * split out here rather than left inside the component because a React file cannot be imported by a court —
 * this module can, so the rule is measured rather than described.
 *
 * @module auma-live-session
 */

/** The bare app address, used when no session is selected at all. */
export const LIVE_APP_PATH = '/stock-apps/auma-live.html'

/**
 * The iframe address for a session.
 *
 * @param {string | undefined | null} sessionId
 * @returns {string}
 */
export function liveAppSrc(sessionId: string | undefined | null): string {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  return id === '' ? LIVE_APP_PATH : `${LIVE_APP_PATH}?session=${encodeURIComponent(id)}`
}

/**
 * The session a surface should use for the whole life of its mount.
 *
 * **A BOUND SESSION IS NEVER RE-READ.** Once bound, later calls return the FIRST selection even if the store's
 * current thread has changed — which is exactly what makes a thread click safe. Following is a separate,
 * explicit act (`followThread`), so a caller cannot follow by accident.
 */
export class BoundSession {
  #bound: string
  #followed = false

  /**
   * @param {string | undefined | null} initial - the selection at mount
   */
  constructor(initial: string | undefined | null) {
    this.#bound = typeof initial === 'string' ? initial : ''
  }

  /** The bound session id, or '' when nothing was selected at mount. */
  get sessionId() {
    return this.#bound
  }

  /** Whether an explicit follow has moved the binding away from its mount-time selection. */
  get followed() {
    return this.#followed
  }

  /** The iframe address this binding implies. Changes ONLY when `followThread` is called. */
  get src() {
    return liveAppSrc(this.#bound)
  }

  /**
   * Bind the mount-time selection. **A second call is a no-op and says so**, rather than silently rebinding:
   * a rebind is the reload this module exists to prevent, so it must be an explicit act with its own name.
   *
   * @param {string | undefined | null} selected - the store's current thread, read again on a later render
   * @returns {{changed: boolean, ignored: boolean}} what happened, so a caller can report it
   */
  bindOnce(selected: string | undefined | null): { changed: boolean; ignored: boolean } {
    const next = typeof selected === 'string' ? selected : ''
    if (this.#bound !== '' && next !== this.#bound) return { changed: false, ignored: true }
    if (this.#bound === '' && next !== '') {
      this.#bound = next
      return { changed: true, ignored: false }
    }
    return { changed: false, ignored: false }
  }

  /**
   * **THE EXPLICIT ACTION.** Only this moves the binding, and it is the only thing that may change the iframe
   * address. A person who wants her to follow the thread they just clicked says so.
   *
   * @param {string | undefined | null} selected
   * @returns {{changed: boolean, from: string, to: string}}
   */
  followThread(selected: string | undefined | null): { changed: boolean; from: string; to: string } {
    const next = typeof selected === 'string' ? selected : ''
    const from = this.#bound
    if (next === from) return { changed: false, from, to: next }
    this.#bound = next
    this.#followed = true
    return { changed: true, from, to: next }
  }
}
