import { createHash } from 'node:crypto'

// What the window says about the backend it is showing.
//
// THE WINDOW MUST ANSWER THREE QUESTIONS WITHOUT BEING ASKED. Which backend is this?
// Which release is it serving? And does closing this window stop it? A person who
// cannot answer the third one from the screen will eventually close a window on a
// deployment somebody else depends on, or leave a process running they believed they
// had quit.
//
// AND IT MUST ANSWER THEM WITHOUT THE TOKEN. The authenticated URL carries a launch
// token in its query string; that token is the credential for the whole backend. So
// this module never formats from the URL — it formats from `new URL(url).origin`,
// which is scheme, host and port and structurally cannot contain a query. Everything
// displayed, logged, or put in a dialog by the shell comes through here.

/**
 * The backend identity a window may display.
 * @param {object} o
 * @param {'own'|'attach'} o.mode - whether this shell started the backend.
 * @param {string} o.url - the authenticated URL (its query is dropped here, never shown).
 * @param {string} [o.release] - the release directory, when this shell chose it.
 * @param {string} [o.commit] - the Genesis commit that release records about itself.
 * @param {'spatial'|'stock'} [o.frontend] - which interface the page turned out to load, once known.
 * @returns {{origin: string, owned: boolean, release: string, frontend: string, text: string, title: string}}
 */
export function backendStatus({ mode, url, release, commit, frontend }) {
  const origin = new URL(url).origin // query (and therefore the token) is not part of it
  const owned = mode === 'own'
  // "not owned" is stated, never implied by omission: the absence of a word is not a
  // thing a person notices, and this is the fact that decides whether quitting is safe.
  const ownership = owned ? 'owned by this window' : 'attached · not owned by this window'
  // A release is only known when this shell chose it. An attached backend serves
  // whatever it serves, and this window does not get to guess — least of all by reading
  // a launch record out of a state root that belongs to another deployment.
  const releaseText = release === undefined || release === null || release === ''
    ? 'release unknown to this window'
    : `release ${basename(release)}${typeof commit === 'string' && commit.length >= 12 ? ` @ ${commit.slice(0, 12)}` : ''}`
  // WHICH INTERFACE, SAID OUT LOUD. The frontend is served by the backend, so an
  // attached window shows whatever that deployment serves — an older deployment shows
  // its older, three-column stock interface, and nothing about "attached" says so.
  // The page asks its backend for one combined plugin bundle whose URL names every
  // plugin id in it; the shell watches for that request and reports whether the
  // spatial face is among them. Until the page has asked, the answer is not known,
  // and not-known is what gets displayed.
  const frontendText = frontend === 'spatial'
    ? 'spatial frontend'
    : frontend === 'stock'
      ? 'NOT the spatial frontend (stock interface)'
      : 'frontend not yet known'
  const text = `${origin} · ${ownership} · ${releaseText} · ${frontendText}`
  return {
    origin, owned, release: releaseText, frontend: frontendText, text, title: `AUKORA — ${text}`,
    // The raw inputs, so a later refinement (the frontend, once the page has loaded)
    // can be formatted from the same facts without holding the token anywhere.
    releasePath: release, commitHash: commit,
  }
}

/**
 * The last path segment, without importing node:path into a module the tests load bare.
 * @param {string} value - a filesystem path.
 * @returns {string} its last non-empty segment, or the value itself.
 */
function basename(value) {
  const parts = String(value).split('/').filter(Boolean)
  return parts.length === 0 ? String(value) : parts[parts.length - 1]
}

/**
 * An origin fit to put in an error message about a URL that failed.
 *
 * The rejection a person sees when a backend will not load must name the backend, and
 * the URL it was handed carries the token. A URL too malformed to parse is reported as
 * unparseable rather than echoed — echoing it would print whatever it did contain.
 * @param {string} url - the URL that failed.
 * @returns {string} its origin, or a fixed marker.
 */
export function safeOrigin(url) {
  try { return new URL(url).origin } catch { return '(unparseable URL)' }
}

/**
 * Classify the interface a page loaded from the plugin-bundle URL it requested.
 *
 * The harness serves the client plugins as one combined bundle whose URL lists every
 * plugin id, in order. `@aukora/face-layout` is the spatial frame; a bundle without it
 * is the stock interface no matter what else it carries. Any other URL is not the
 * bundle and says nothing.
 * @param {string} requestUrl - a URL the page requested.
 * @returns {'spatial'|'stock'|undefined} the interface, or undefined when the URL is not the bundle.
 */
export function frontendFromBundleUrl(requestUrl) {
  let full
  try {
    const parsed = new URL(requestUrl)
    // The bundle URL is `/plugins/??<id>/client.js,<id>/client.js,...&rev=<hash>`. The
    // `??` opens a query string, so the plugin list lives in `search`, not `pathname`;
    // classifying on the pathname alone would call every bundle "stock".
    full = decodeURIComponent(parsed.pathname + parsed.search)
  } catch { return undefined }
  // Only the COMBINED bundle answers. A single-plugin request (`/plugins/<id>/client.js`)
  // names one plugin and says nothing about the rest, so it must not be read as "no
  // spatial frame here".
  if (!full.startsWith('/plugins/??')) return undefined
  return full.includes('@aukora/face-layout/client.js') ? 'spatial' : 'stock'
}

/**
 * Remove launch tokens from text this shell did not write.
 *
 * The launcher is a separate program and prints what it likes — since the integrated
 * core landed, that includes the whole authenticated URL. The shell forwards those
 * lines to its own log, so without this the credential appears in the one place this
 * module exists to keep it out of. Redaction happens at the boundary, on every line,
 * rather than trusting the launcher's current output to stay the way it is today.
 * @param {string} text - a line from a program this shell started.
 * @returns {string} the same line with any token value replaced.
 */
export function redactTokens(text) {
  return String(text)
    .replace(/([?&#]token=)[^\s&#"']+/gi, '$1<redacted>')
    // The key may be quoted (`"token": "..."` in JSON), so the closing quote of the
    // key has to be allowed between the name and the separator.
    .replace(/\btoken["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/gi, 'token=<redacted>')
}

// Cookies are host-scoped, not port-scoped. Old owned backends must not inflate
// the next plugin request past Node's header limit. Attach sessions stay untouched.
export async function pruneOwnedAuthCookies(cookies, url) {
  const target = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('non-loopback cookie cleanup refused')
  const keep = 'dsh-auth-' + createHash('sha256').update(target.host).digest('base64url')
  let removed = 0
  for (const cookie of await cookies.get({ url: target.origin })) {
    if (cookie.domain !== target.hostname || cookie.path !== '/' ||
        !/^dsh-auth-[A-Za-z0-9_-]{43}$/.test(cookie.name) || cookie.name === keep) continue
    await cookies.remove(target.origin + '/', cookie.name)
    removed++
  }
  await cookies.flushStore()
  return removed
}

// Observed rendering only, never an attestation. No chat text leaves the renderer.
export const INTERFACE_STATE_SCRIPT = `(() => {
  const boot = document.querySelector('[data-dsh-boot]');
  if (boot) return boot.textContent.includes('Failed to load plugins') ? 'failed' : 'loading';
  return document.querySelector('button, [role="button"], input, textarea') ? 'ready' : 'loading';
})()`
