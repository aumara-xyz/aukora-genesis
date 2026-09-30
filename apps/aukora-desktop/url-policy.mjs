// The two URL decisions the window makes, kept where a test can reach them.
//
// WHY A SEPARATE FILE. Both decisions used to live inside main.mjs, which imports
// electron at module load, so no plain node test could call them. The tests that
// existed re-implemented the logic and then asserted against their own copy —
// which proves the reasoning and not the shipped bytes, and a re-implementation
// cannot fail when the original drifts. These are pure functions over a URL
// string; main.mjs imports them and so does the test.

/**
 * The page this shell is allowed to render: loopback over plain http, and nothing else.
 *
 * PARSE, NEVER PREFIX-MATCH. `http://127.0.0.1:1@evil.example/` begins with the
 * loopback authority as a string and resolves to evil.example, because everything
 * before the '@' is userinfo. A startsWith test would have handed that page the
 * window and the launch token with it.
 * @param {string} url - candidate URL.
 * @returns {string} the same URL, when it is loopback http.
 * @throws when it is anything else, including an unparseable string.
 */
export function loopbackOnly(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error(`refusing-non-loopback: ${parsed.protocol}//${parsed.hostname}`)
  }
  return url
}

/**
 * Whether a URL the page asked to open elsewhere may be handed to the system browser.
 *
 * Only what a browser would follow. A page-supplied `file:` or a custom scheme
 * reaches a local handler, and this window renders local content.
 * @param {string} url - candidate URL.
 * @returns {boolean} true for http, https and mailto; false for everything else.
 */
export function externalSchemeAllowed(url) {
  let scheme = null
  try { scheme = new URL(url).protocol } catch { return false }
  return scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:'
}

/**
 * Microphone, contact-scanner camera and clipboard writes, only to this app origin.
 *
 * Auma Live is a voice app: the page captures the microphone and streams it to
 * the local sidecar, so a window that denies every permission is a window where
 * the voice channel can never open. Everything else a page can ask for —
 * location, notifications, clipboard READS, MIDI, USB, screen capture —
 * stays denied, and the grants below are scoped to the exact loopback origin
 * this shell started. A page reached through some other origin gets nothing,
 * whatever it asks for.
 *
 * `clipboard-sanitized-write` IS GRANTED, AND THE REASON IS A DEAD COPY BUTTON.
 * Measured 2026-09-21: Chromium gates a page's `navigator.clipboard.writeText()`
 * behind this permission, so a blanket denial makes every copy control in the
 * interface do nothing. The vendored UI's own helper
 * (`@deepseek-ai/dsh-client-ui-primitives` `writeClipboard`) chooses the async API
 * by PRESENCE (`navigator.clipboard?.writeText`), and on a throw it **returns
 * false and does not fall back** to `execCommand` — the fallback below it is
 * reachable only when the API is absent. So the denial produced NO console error,
 * NO feedback, and no clipboard content: the button simply did nothing.
 *
 * Write is not read. `clipboard-sanitized-write` lets this page put text on the
 * clipboard; it does not let it read what is already there, which stays denied as
 * `clipboard-read`. Chromium labels the write "sanitized" because it strips
 * dangerous markup on the way in, which is the behaviour a copy button wants.
 *
 * `mediaTypes` is normalized from Electron's request array or check's singular
 * `mediaType`. Unknown, empty and combined audio/video requests are refused.
 * @param {string} permission - Electron permission name.
 * @param {string | undefined} requestingUrl - the URL of the frame asking.
 * @param {string | undefined} appUrl - the page this shell loaded.
 * @param {string[] | undefined} mediaTypes - Electron's mediaTypes for a media request.
 * @returns {boolean} true only for the harness's microphone, camera or clipboard write.
 */
export function permissionAllowed(permission, requestingUrl, appUrl, mediaTypes) {
  const grants = ['media', 'audioCapture', 'videoCapture', 'clipboard-sanitized-write']
  if (!grants.includes(permission)) return false
  if (typeof requestingUrl !== 'string' || typeof appUrl !== 'string') return false
  let asking, mine
  try { asking = new URL(requestingUrl).origin; mine = new URL(appUrl).origin } catch { return false }
  if (asking !== mine) return false
  try { loopbackOnly(appUrl) } catch { return false }
  if (permission === 'clipboard-sanitized-write') return true
  const kinds = mediaTypes ?? (permission === 'audioCapture' ? ['audio'] : permission === 'videoCapture' ? ['video'] : [])
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.some(kind => kind !== 'audio' && kind !== 'video')) return false
  if (kinds.includes('audio') && kinds.includes('video')) return false
  if (permission === 'audioCapture' && kinds.some(kind => kind !== 'audio')) return false
  if (permission === 'videoCapture' && kinds.some(kind => kind !== 'video')) return false
  return true
}
