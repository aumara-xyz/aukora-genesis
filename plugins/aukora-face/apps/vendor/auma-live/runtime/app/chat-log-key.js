/**
 * THE CHAT LOG'S KEY — computed ONCE, from the session the page was LOADED for.
 *
 * THE DEFECT. `lane-bridge.js` builds its log key from `SESSION_ID`, which it reads from the iframe's own
 * address at module load. That is correct on its own. The breakage is the RELOAD: a sidebar click used to
 * rewrite the iframe address, the document reloaded on the thread that had just been selected, and the log
 * reopened under a NEW key with nothing in it — reported by Peter as "the chat log isn't working", observed at
 * 10:02:18 as the key moving `89cc7181` → `413d27a6` with an empty log.
 *
 * **THE KEY FOLLOWING THE SESSION IS RIGHT; THE SESSION CHANGING UNDER A LIVE PAGE IS THE BUG.** So this module
 * does not change what the key is made of — it makes the rule explicit and measurable: the key is a pure
 * function of the session, **it is computed once per document**, and a session change in a parent shell does
 * NOT rebuild it. Item 1 stops the iframe from ever being handed a new session; this is the log-side property
 * that item 1 protects, stated where a court can check it.
 *
 * WHY A SEPARATE FILE: `lane-bridge.js` is a browser module a court cannot import without a DOM. The key rule
 * is the part worth measuring, and it has no DOM in it.
 *
 * @module chat-log-key
 */

/** The key prefix. Bumping it abandons every stored log, so it is stated once, here. */
export const CHAT_LOG_PREFIX = 'aukora-auma-live-log-v2:'

/** The key used when the page was opened with no session at all. */
export const UNSELECTED = 'unselected'

/**
 * The log key for a session.
 *
 * @param {string | undefined | null} sessionId
 * @returns {string}
 */
export function chatLogKey(sessionId) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  return `${CHAT_LOG_PREFIX}${encodeURIComponent(id === '' ? UNSELECTED : id)}`
}

/**
 * **A KEY BOUND ONCE, FOR THE LIFE OF THE DOCUMENT.** `current()` keeps returning the key of the session the
 * page was opened for, whatever any caller says the session is now — which is what makes a thread click
 * unable to empty the log.
 */
export class BoundChatLogKey {
  #key

  /** @param {string | undefined | null} sessionIdAtLoad - read from the address ONCE, at load */
  constructor(sessionIdAtLoad) {
    this.#key = chatLogKey(sessionIdAtLoad)
  }

  /** The bound key. Stable for the life of the document. */
  get key() {
    return this.#key
  }

  /**
   * Report what a LATER session selection would imply, WITHOUT adopting it.
   *
   * The distinction is the whole point: a caller can ask "would this be a different log?" and get a truthful
   * answer, while the key it is actually using does not move. Adopting a new key is not offered here at all,
   * because a live page adopting a new key is exactly the empty-log defect.
   *
   * @param {string | undefined | null} selectedNow
   * @returns {{wouldChange: boolean, key: string}}
   */
  wouldChangeFor(selectedNow) {
    const candidate = chatLogKey(selectedNow)
    return { wouldChange: candidate !== this.#key, key: candidate }
  }
}
