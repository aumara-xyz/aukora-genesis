/**
 * A local-only memory aid for a phrase that has ALREADY been drawn.
 *
 * THE STORY IS NOT THE PHRASE. The seven words are chosen by `node:crypto` from the approved
 * pools. This module runs afterwards, and only on this machine. It adds no entropy: `entropyBits`
 * is 0, `authoritative` is false, and nothing here is mixed into the key, the fingerprint or the
 * words the person types back.
 *
 * FAIL CLOSED. No provider means no story, and the words still stand. A URL, a host name of a
 * model API, or a function that returns a promise is refused: waiting on a promise is how a
 * "local" hook places a call. A filesystem path is not executed. There is no fetch in this file.
 *
 * @module @aukora/dsh-plugin-aumlok/mnemonic-story
 */

/** How long a story may be. Longer text is cut; it is a memory aid, not a document. */
export const STORY_LIMIT = 400

const REMOTE = /^(?:https?:|wss?:)|\/\//i
const MODEL_API = /\b(?:openai|anthropic|googleapis|generativelanguage|azure)\b/i

/**
 * @param {readonly string[]} words the seven tokens, anchor first. Not modified.
 * @param {unknown} [provider] omitted, a local function `(words) => string`, or a path/URL that is refused.
 * @returns {{story: string|null, entropyBits: 0, authoritative: false, local: boolean, reason: string|null}}
 */
export function mnemonicStory(words, provider) {
  const absent = (reason, local = true) => ({
    story: null,
    entropyBits: 0,
    authoritative: false,
    local,
    reason,
  })
  if (!Array.isArray(words) || words.length !== 7 || !words.every((word) => typeof word === 'string' && word.length > 0)) {
    return absent('aumlok:story-needs-seven-words')
  }
  if (provider == null) return absent('aumlok:story-absent')
  if (typeof provider === 'string') {
    if (REMOTE.test(provider) || MODEL_API.test(provider)) return absent('aumlok:story-cloud-refused', false)
    return absent('aumlok:story-path-not-invoked')
  }
  if (typeof provider !== 'function') return absent('aumlok:story-absent')
  let text
  try {
    text = provider(words)
  } catch {
    return absent('aumlok:story-failed')
  }
  if (text instanceof Promise || (text !== null && typeof text === 'object' && typeof text.then === 'function')) {
    return absent('aumlok:story-async-refused')
  }
  if (typeof text !== 'string') return absent('aumlok:story-absent')
  const story = text.trim().slice(0, STORY_LIMIT)
  if (story.length === 0) return absent('aumlok:story-absent')
  return { story, entropyBits: 0, authoritative: false, local: true, reason: null }
}
