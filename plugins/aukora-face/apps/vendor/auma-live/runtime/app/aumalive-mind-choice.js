/**
 * THE MIND SHE CHOSE, REMEMBERED ACROSS A RELOAD.
 *
 * THE DEFECT: `let chosenMind = 'balanced'` — a literal, re-evaluated on every document load. So a reload put
 * her back on the everyday voice mind no matter which one had been chosen, and the choice looked like it had
 * never been made. The selection is a preference about how she sounds; it is not session state, and losing it
 * on refresh is the kind of small betrayal that makes a person stop bothering to choose.
 *
 * WHY THIS FILE HAS NO `import`. `aumalive.js` is served as a CLASSIC browser script, not a module, so it
 * cannot import anything. This file is therefore dual-mode: in a browser it hangs one function on
 * `globalThis.AumaMindChoice`, and in Node it is an ES module the court imports directly. **The logic is
 * written once and both callers get the same bytes** — a second copy inside the app is the drift this
 * repository keeps finding.
 *
 * **AN UNREADABLE OR HOSTILE STORE IS NOT AN ERROR HERE.** Private browsing, a disabled store and a truncated
 * value all mean the same thing to her: no restored preference. The default is returned and the app is
 * unaffected, because a voice selector is not worth failing a page load over.
 *
 * @module auma-mind-choice
 */

/** The key the choice lives under. Namespaced, because localStorage is shared with the whole shell. */
export const MIND_CHOICE_KEY = 'aukora.auma-live.mind'

/**
 * The mind to start on: the remembered one when it is still offered, otherwise the app's default.
 *
 * **A REMEMBERED MIND THAT IS NO LONGER OFFERED IS NOT RESTORED.** The Host decides which minds exist, and a
 * stored id for a mind that has since been withdrawn would select a button that is not on the screen — so the
 * restore is filtered through the offered list rather than trusted.
 *
 * @param {Readonly<{storage?: {getItem: (k: string) => string | null, setItem?: Function} | null, offered?: readonly string[], fallback?: string}>} input
 * @returns {string} the mind to start on
 */
export function initialMindChoice(input = {}) {
  const fallback = typeof input.fallback === 'string' && input.fallback.length > 0 ? input.fallback : 'balanced'
  const offered = Array.isArray(input.offered) ? input.offered : null
  let stored = null
  try {
    stored = input.storage?.getItem?.(MIND_CHOICE_KEY) ?? null
  } catch {
    // A store that throws on read is a store we do not have.
    return fallback
  }
  if (typeof stored !== 'string') return fallback
  const id = stored.trim()
  if (id.length === 0 || id.length > 256) return fallback
  // An empty offered list means the roster has not arrived yet; the stored id is still the best answer.
  if (offered !== null && offered.length > 0 && !offered.includes(id)) return fallback
  return id
}

/**
 * Remember a choice. Called when a person selects a mind, and at no other time.
 *
 * @param {Readonly<{storage?: {setItem: (k: string, v: string) => void} | null, mind: string}>} input
 * @returns {boolean} whether it was stored — reported rather than assumed, so a caller can say so if it matters
 */
export function rememberMindChoice(input = {}) {
  const mind = typeof input.mind === 'string' ? input.mind.trim() : ''
  if (mind.length === 0 || mind.length > 256) return false
  try {
    input.storage?.setItem?.(MIND_CHOICE_KEY, mind)
    return true
  } catch {
    // A full or forbidden store costs the preference and nothing else.
    return false
  }
}

/**
 * Install the browser half. Idempotent, and safe to call in Node, where it does nothing.
 *
 * @param {object} [scope] - the global to install on (injected by the court)
 */
export function installMindChoice(scope = globalThis) {
  if (scope === null || typeof scope !== 'object') return
  scope.AumaMindChoice = Object.freeze({
    key: MIND_CHOICE_KEY,
    initial: (options = {}) => initialMindChoice({
      storage: options.storage ?? safeLocalStorage(scope),
      offered: options.offered,
      fallback: options.fallback,
    }),
    remember: (mind, storage) => rememberMindChoice({ storage: storage ?? safeLocalStorage(scope), mind }),
  })
}

/** `localStorage`, or null where touching it throws (private browsing, a hostile embedder). */
function safeLocalStorage(scope) {
  try {
    return scope.localStorage ?? null
  } catch {
    return null
  }
}

// THE BROWSER HALF, INSTALLED ON LOAD. In Node this attaches to `globalThis` harmlessly and changes nothing.
installMindChoice()
