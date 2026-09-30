// The approval sheet's paint, place and guards, moved whole from aumlok-bridge.mjs (2026-09-27) so that no file of
// the bridge passes the self-change loop's 64 KiB limit. Z_ORDER_INTERVAL_MS and surfaceColour are exported
// for the bridge's use. aumlok-bridge.mjs re-exports
// every name it exported before; where a comment below says "this file" or "this module", it means the bridge.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE STYLESHEETS THE APPROVAL WINDOW'S COLOURS COME FROM, IN THE ORDER THEY WIN, FOR ONE THEME.
 *
 * TWO LAYOUTS, BECAUSE THE SHELL AND A COURT READ DIFFERENT TREES. A RELEASE flattens the face
 * paths to `plugins/aukora-face-<name>/`, and the CHECKOUT keeps them nested at
 * `plugins/aukora-face/<name>/`. Reading both means a court exercises this exact code instead of
 * a variant of it, and a release is unaffected because the nested path simply is not there.
 *
 * AND THE FOUNDATION'S OWN STYLESHEET. The window names foundation tokens (`--dsw-alias-bg-layer-1/2`,
 * `--dsw-alias-border-l2`, `--dsw-alias-label-primary/secondary`) and carries no hex, and the face
 * bundles do NOT declare them — they live in Deep's `ui-theme` client, which the app loads and this
 * window does not. So those declarations resolved to nothing: an unpainted window is a bad place to
 * ask a person about a signature. Same two-layout rule as the faces.
 * @param {string} releaseDir - the release root.
 * @param {'dark'|'light'} theme - the theme whose declarations win.
 * @returns {string[]} the stylesheet texts, last one winning.
 */
function styledSources(releaseDir, theme) {
  const forTheme = cssText => theme === 'light' ? withoutDarkTheme(cssText) : cssText
  const sources = []
  for (const name of ['layout', 'aumlok']) {
    for (const candidate of [`aukora-face-${name}`, join('aukora-face', name)]) {
      try {
        sources.push(forTheme(readFileSync(join(releaseDir, 'plugins', candidate, 'lib', 'client.js'), 'utf8')))
        break
      } catch { /* not in this layout; the other may resolve the chain */ }
    }
  }
  for (const candidate of [join('packages', 'client', 'ui-theme', 'lib', 'client.js'),
    join('vendor', 'dsh', 'packages', 'client', 'ui-theme', 'lib', 'client.js')]) {
    try {
      sources.push(forTheme(readFileSync(join(releaseDir, candidate), 'utf8')))
      break
    } catch { /* not in this layout; the other may resolve it */ }
  }
  return sources
}

/**
 * THE FOUNDATION'S TOKEN SET IS DECLARED TWICE, AND ONLY ONE OF THE TWO IS EVER READ.
 *
 * MEASURED with this reader on the stylesheet the app loads: `body { --dsw-alias-bg-layer-1:
 * var(--dsw-static-neutral-bluish-00) }` is the LIGHT value, and `body[data-ds-dark-theme]`, later in
 * the same file, is the DARK one. A reader that takes the last definition — which is what this
 * function did before it knew about themes — returns the DARK values whatever the system theme is,
 * so a light window would have been painted with the dark palette. This drops the dark-theme blocks,
 * which is the whole of the difference for the light theme; `ceremonyTokenValues` follows one level
 * of `var()` and the light block is the remaining definition.
 * @param {string} cssText - one stylesheet, as written.
 * @returns {string} the same stylesheet with its dark-theme blocks removed.
 */
function withoutDarkTheme(cssText) {
  return String(cssText).replace(/[^{}]*\[data-ds-dark-theme\][^{}]*\{[^{}]*\}/gu, '')
}

/**
 * Resolve the face's colour tokens out of the face bundles the release carries.
 *
 * THE LAYOUT FACE DEFINES THE FOUNDATION TOKENS AND THE AUMLOK FACE REFERENCES THEM, so BOTH are read:
 * the aumlok bundle alone resolves to `{}` — a window with no colours, and a "no hex" court that
 * passes because the map is empty rather than because the window is honest. A bundle that cannot be
 * read is skipped rather than fatal.
 * @param {string} releaseDir - the release root.
 * @param {object} library - the organ library, for `ceremonyTokenValues`.
 * @param {'dark'|'light'} [theme] - the theme whose declarations win. DEFAULTS TO `'dark'`, which is
 *   what this reader resolved before the parameter existed: the dark block is the last definition, so
 *   a caller that names no theme gets exactly the bytes it got yesterday.
 * @returns {Readonly<Record<string, string>>} token name -> literal value.
 */
export function readFaceTokenValues(releaseDir, library, theme = 'dark') {
  const sources = styledSources(releaseDir, theme)
  if (sources.length === 0) return Object.freeze({})
  const values = { ...library.ceremonyTokenValues(...sources) }
  // The older ceremony reader resolves only its nine tokens. Read the spatial accents and type
  // from the same sources as well, using its one-reference rule; the safety filter still runs next.
  const declared = new Map()
  for (const css of sources) {
    for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gu)) declared.set(match[1], match[2].trim())
  }
  for (const name of [...Object.keys(SAFE_APPROVAL_TOKENS), '--dsw-static-spatial-night-850', '--dsw-static-spatial-night-800']) {
    const raw = declared.get(name)
    if (raw === undefined) continue
    const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(raw)
    const value = reference === null ? raw : declared.get(reference[1]) ?? reference[2]
    if (value !== undefined && !value.includes('var(')) values[name] = name.includes('font-family')
      ? value.trim().replace(/\\"/gu, '"') : value.trim()
  }
  // The approval uses the Messages/Memory night surfaces, not the foundation's neutral grey.
  return Object.freeze({ ...values,
    '--dsw-alias-bg-layer-1': values['--dsw-static-spatial-night-850'] ?? SAFE_APPROVAL_TOKENS['--dsw-alias-bg-layer-1'],
    '--dsw-alias-bg-layer-2': values['--dsw-static-spatial-night-800'] ?? SAFE_APPROVAL_TOKENS['--dsw-alias-bg-layer-2'],
  })
}

/**
 * THE ONE TOKEN THE WINDOW'S PRE-PAINT COLOUR NEEDS — AND IT IS READ SYNCHRONOUSLY, ON PURPOSE.
 *
 * `backgroundColor` is a BrowserWindow CONSTRUCTOR option, and the window is constructed in the same
 * turn a person's approval arrives. Going through `readFaceTokenValues` would mean loading the organ
 * library first, which is asynchronous: one tick between the request and the window, for a colour. So
 * the shell reads the one token it needs here.
 *
 * MEASURED BEFORE THIS EXISTED: the option was `backgroundColor: '#0B0E14'`, a hex that is the value
 * of NO token the window paints with — the dark surface token is `#232324` and the light one is
 * `#fff` — so the window pre-painted a colour the application never uses, in both themes.
 *
 * IT IS NOT A SECOND AUTHORITY: this is the same source list and the same last-definition-wins rule
 * as `ceremonyTokenValues`, restricted to one token. A release that carries no such token yields
 * `null`, and `null` means NO backgroundColor rather than a hex this module made up.
 * @param {string} releaseDir - the release root.
 * @param {'dark'|'light'} [theme] - the theme whose declarations win.
 * @returns {string|null} the CSS colour the window pre-paints with, or null when it cannot be read.
 */
/**
 * HOW OFTEN THE SHEET CHECKS THAT NOTHING IS PAINTED OVER IT.
 *
 * A quarter of a second is a compromise with a stated reason rather than a round number: a person reads the
 * digest and moves a pointer at human speed, so a foreign view that appears above the sheet is answered
 * long before a click can land through it — while the check itself is two array reads, which is nothing to
 * do four times a second for the few seconds an approval is on screen.
 */
export const Z_ORDER_INTERVAL_MS = 250

/**
 * TAKE THE KEYBOARD WHILE THE SHEET IS OPEN, AND GIVE IT BACK WHEN IT CLOSES.
 *
 * A DOCKED SHEET IS NOT A MODAL WINDOW: nothing about being docked stops a keystroke from reaching the page
 * drawn behind it, so the conversation the sheet is covering would still accept typing — and a script in
 * that page would still receive the person's keys. `before-input-event` is the shell's own hook on the main
 * renderer; preventing it is what makes the sheet modal in the only sense that matters here.
 *
 * THE GUARD IS A FUNCTION WITH A DISPOSER so the court can drive it with stubs, and so "focus came back" is
 * one call rather than an assumption about what closing does.
 * @param {{webContents?: object}} win - the application window whose renderer must go deaf.
 * @param {{webContents?: object}} view - the approval surface, which takes focus.
 * @returns {() => void} the disposer: unblocks the keyboard and returns focus.
 */
export function guardKeyboard(win, view) {
  const content = win?.webContents
  const block = (event) => {
    // BLOCKED, NOT FORWARDED AND NOT INSPECTED: this is not a place to interpret keys, it is a place to stop
    // them. A shell that decided which keys were safe would be a second input path into a covered page.
    if (typeof event?.preventDefault === 'function') event.preventDefault()
  }
  if (content === null || content === undefined) return () => {}
  if (typeof content.on === 'function') content.on('before-input-event', block)
  if (typeof view?.webContents?.focus === 'function') view.webContents.focus()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (typeof content.removeListener === 'function') content.removeListener('before-input-event', block)
    if (typeof content.focus === 'function') content.focus()
  }
}

/**
 * WHETHER THE SHEET IS NO LONGER THE TOPMOST CHILD OF ITS PARENT.
 *
 * A `View` has no z-index: the paint order is the child ORDER, and the last child is on top. Anything that
 * adds a view to the main window after the sheet — a canvas, a menu, a future overlay — is therefore drawn
 * over the sheet, and a person could be asked to approve an operation through a surface something else is
 * painting on top of. That is a click-jacking shape and a lying-display shape at once, so the sheet has to
 * be re-added LAST whenever it is not last.
 *
 * THE RULE IS A FUNCTION RATHER THAN A CONDITION INLINE, because it is the part worth testing: the guard
 * around it is a timer, and a timer that calls the wrong predicate is worse than none.
 * @param {readonly unknown[]} children - the parent's children, in paint order.
 * @param {unknown} view - the approval surface.
 * @returns {boolean} true when the surface exists in the list and is not the last entry.
 */
export function needsRaise(children, view) {
  if (!Array.isArray(children) || view === null || view === undefined) return false
  const at = children.indexOf(view)
  return at !== -1 && at !== children.length - 1
}

/**
 * THE SHELL'S OWN PALETTE, used when the site's tokens cannot be trusted.
 *
 * These are the same values the sheet falls back to in its own CSS, in the one form the sheet and the
 * grammar both agree on. They are deliberately drab: a fallback exists to be readable, not to look right.
 */
export const SAFE_APPROVAL_TOKENS = Object.freeze({
  '--dsw-alias-bg-layer-1': 'rgb(11, 13, 24)',
  '--dsw-alias-bg-layer-2': 'rgb(17, 21, 32)',
  '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.12)',
  '--dsw-alias-label-primary': 'rgb(242, 242, 242)',
  '--dsw-alias-label-secondary': 'rgb(168, 168, 168)',
  '--dsw-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  // THE TWO TOKENS THE FACES REFERENCED AND NOTHING DEFINED, kept here as well as in the layout face so the
  // sheet cannot be left with a hole if the site's set arrives incomplete.
  '--dsw-font-family-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  '--dsw-alias-label-error': 'rgb(242, 85, 90)',
  '--dsw-static-spatial-blue': 'rgb(150, 180, 255)',
  '--dsw-static-spatial-gold': 'rgb(224, 183, 106)',
  '--dsw-static-spatial-mint': 'rgb(129, 212, 180)',
  '--dsw-static-spatial-violet': 'rgb(196, 170, 255)',
  '--dsh-spatial-gap': '6px',
})

/** Text must reach this contrast against its background. The WCAG AA floor for body text. */
const MIN_CONTRAST = 4.5

/** The largest a spacing token may be, so a token cannot push content out of the card. */
const MAX_SIZE_PX = 64

/** Tokens that paint TEXT, and tokens that paint what text sits on. */
const TEXT_TOKENS = Object.freeze(['--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-label-error', '--dsw-static-spatial-blue', '--dsw-static-spatial-gold',
  '--dsw-static-spatial-mint', '--dsw-static-spatial-violet'])
const SURFACE_TOKENS = Object.freeze(['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2'])

/**
 * One CSS colour as `[r, g, b, a]`, or null when it is not one.
 * @param {string} raw - the value.
 * @returns {number[]|null} the channels, 0-255 and alpha 0-1.
 */
function parseColour(raw) {
  const text = String(raw ?? '').trim().toLowerCase()
  if (text === 'transparent' || text === 'currentcolor' || text === 'inherit') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(text)
  if (hex !== null) {
    const digits = hex[1].length === 3 ? hex[1].split('').map(part => part + part).join('') : hex[1]
    return [0, 2, 4].map(at => Number.parseInt(digits.slice(at, at + 2), 16)).concat([1])
  }
  const fn = /^rgba?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*(?:[,/]\s*([0-9.]+)\s*)?\)$/u.exec(text)
  if (fn === null) return null
  const channels = [fn[1], fn[2], fn[3]].map(Number)
  const alpha = fn[4] === undefined ? 1 : Number(fn[4])
  if (channels.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null
  return [...channels, alpha]
}

/**
 * The colour composited over black, which is what a translucent value actually paints on this surface.
 * @param {number[]} colour - `[r, g, b, a]`.
 * @returns {number[]} opaque `[r, g, b]`.
 */
function overBlack(colour) {
  const [r, g, b, a] = colour
  return [r * a, g * a, b * a]
}

/**
 * WCAG relative-luminance contrast between two colours.
 * @param {number[]} one - `[r, g, b, a]`.
 * @param {number[]} two - `[r, g, b, a]`.
 * @returns {number} the contrast ratio.
 */
function contrast(one, two) {
  const luminance = (colour) => {
    const [r, g, b] = overBlack(colour).map((channel) => {
      const part = channel / 255
      return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * PUT THE SITE'S TOKENS THROUGH A GRAMMAR BEFORE THEY REACH A STYLESHEET.
 *
 * THE TOKENS COME FROM A BUNDLE THE SHELL DOES NOT OWN. They are the site's own values, and a value that is
 * `transparent`, that matches the background, or that carries a second declaration is a way to hide or
 * displace the text a person reads before approving — the one screen where "what is on it" is the security
 * property. So each value is PARSED rather than trusted:
 *
 *   - no value may carry `;`, `{`, `}` or `url(`, because that is not a value, it is more stylesheet;
 *   - a colour must parse as a colour, must be opaque where it paints text or the sheet's own surface;
 *   - text and the surface it sits on must reach 4.5:1, RECOMPUTED ON THE FINAL VALUES after substitution,
 *     so a pair that is only unreadable once the fallbacks are mixed in is still caught;
 *   - a size must be a bounded length, so a token cannot push the card out of the pane.
 *
 * A REFUSED TOKEN IS REPLACED, NOT DROPPED: the shell's own palette fills the hole, so the sheet is painted
 * by values that were checked rather than by whatever the browser defaults to, and every refusal is named in
 * `reasons` and logged. `fellBack` says whether anything at all was refused.
 * @param {Readonly<Record<string, string>>} values - the site's resolved token values.
 * @param {{warn?: (line: string) => void}} [log] - where refusals are reported.
 * @returns {{values: Record<string, string>, reasons: string[], fellBack: boolean}} the values to inject.
 */
export function safeApprovalTokens(values, log) {
  const reasons = []
  const accepted = {}
  for (const [name, raw] of Object.entries(values ?? {})) {
    const text = String(raw ?? '').trim()
    if (!/^--(dsw|dsh)-[a-z0-9-]+$/u.test(name) || text.length === 0) continue
    if (/[;{}]/u.test(text) || /url\(/iu.test(text)) {
      reasons.push(`${name} refused: the value carries a stylesheet delimiter or a url() (${text.slice(0, 60)})`)
      continue
    }
    if (TEXT_TOKENS.includes(name) || SURFACE_TOKENS.includes(name) || /border/u.test(name)) {
      const colour = parseColour(text)
      if (colour === null) {
        reasons.push(`${name} refused: ${text === 'transparent' || text === 'currentcolor' ? `the value is ${text}` : 'the value is not a colour'}`)
        continue
      }
      // TEXT AND THE SHEET'S SURFACE MUST BE OPAQUE. A translucent label is a label a background can erase,
      // and a translucent surface is one the page behind it shows through — which is a different screen.
      if ((TEXT_TOKENS.includes(name) || SURFACE_TOKENS.includes(name)) && colour[3] < 1) {
        reasons.push(`${name} refused: alpha ${String(colour[3])} is not opaque`)
        continue
      }
      accepted[name] = text
      continue
    }
    if (/gap|radius|spacing|size/u.test(name)) {
      const size = /^(?<number>[0-9]+(?:\.[0-9]+)?)(?<unit>px|rem|em)$/u.exec(text)
      const asPixels = size === null ? Number.NaN : Number(size.groups.number) * (size.groups.unit === 'px' ? 1 : 16)
      if (size === null || !Number.isFinite(asPixels) || asPixels > MAX_SIZE_PX) {
        reasons.push(`${name} refused: ${text} is not a bounded length (0-${String(MAX_SIZE_PX)}px)`)
        continue
      }
      accepted[name] = text
      continue
    }
    accepted[name] = text
  }
  // THE PALETTE FILLS EVERY HOLE, including the holes the site simply did not fill.
  const final = { ...SAFE_APPROVAL_TOKENS, ...accepted }
  for (const name of [...TEXT_TOKENS, ...SURFACE_TOKENS]) {
    const colour = parseColour(final[name])
    if (colour === null || colour[3] < 1) {
      reasons.push(`${name} fell back: the final value is not an opaque colour`)
      final[name] = SAFE_APPROVAL_TOKENS[name]
    }
  }
  // A warning must retain its hue. If the face's accent/surface pair is unreadable, use the
  // spatial fallback palette together rather than turning a red warning into a white label.
  const accents = TEXT_TOKENS.slice(2)
  if (accents.some(name => SURFACE_TOKENS.some(surface => contrast(parseColour(final[name]), parseColour(final[surface])) < MIN_CONTRAST))) {
    reasons.push('spatial accents fell back with their night surfaces to retain readable warning colours')
    for (const name of [...accents, ...SURFACE_TOKENS]) final[name] = SAFE_APPROVAL_TOKENS[name]
  }
  // RECOMPUTED ON THE FINAL VALUES: the pairs that actually ship, after every substitution above.
  for (const text of TEXT_TOKENS) {
    for (const surface of SURFACE_TOKENS) {
      const ratio = contrast(parseColour(final[text]), parseColour(final[surface]))
      if (ratio < MIN_CONTRAST) {
        reasons.push(`${text} on ${surface} has contrast ${ratio.toFixed(2)}:1, below ${String(MIN_CONTRAST)}:1`)
        final[text] = safeLabelFor(surface, final)
      }
    }
  }
  for (const reason of reasons) log?.warn?.(`aumlok approval: ${reason}`)
  return { values: final, reasons, fellBack: reasons.length > 0 }
}

/**
 * A readable text colour for one surface, from the palette: the light label unless the surface is light.
 * @param {string} surfaceName - the surface token.
 * @param {Record<string, string>} values - the values in hand.
 * @returns {string} an opaque colour that contrasts with the surface.
 */
function safeLabelFor(surfaceName, values) {
  const surface = parseColour(values[surfaceName])
  const light = SAFE_APPROVAL_TOKENS['--dsw-alias-label-primary']
  const dark = 'rgb(16, 16, 18)'
  if (surface === null) return light
  return contrast(parseColour(light), surface) >= MIN_CONTRAST ? light : dark
}

/**
 * The `:root` block the approval sheet is painted with, from the site's resolved token values.
 *
 * ONLY THE TOKEN NAMESPACES THE SITE USES, and only values that RESOLVED: `readFaceTokenValues` follows one
 * level of `var()`, and anything still holding one is dropped. The filter is a function rather than a loop
 * inside the sheet's setup because a court can call it, and because "which tokens may be injected" is a
 * decision worth being able to test on its own.
 * @param {Readonly<Record<string, string>>} values - token name -> literal value.
 * @returns {string} the CSS to inject, or `''` when there is nothing to inject.
 */
export function approvalTokenCss(values) {
  const declarations = []
  for (const [name, value] of Object.entries(values ?? {})) {
    if (!/^--(dsw|dsh)-[a-z0-9-]+$/u.test(name)) continue
    const text = String(value ?? '').trim()
    if (text.length === 0 || text.includes('var(') || text.includes('{') || text.includes('}')) continue
    declarations.push(`${name}:${text}`)
  }
  return declarations.length === 0 ? '' : `:root{${declarations.join(';')}}`
}

export function surfaceColour(releaseDir, theme = 'dark') {
  const declared = new Map()
  for (const cssText of styledSources(releaseDir, theme)) {
    for (const match of cssText.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gu)) {
      declared.set(match[1], match[2].trim())
    }
  }
  const raw = declared.get('--dsw-alias-bg-layer-1')
  if (raw === undefined) return null
  const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(raw)
  if (reference === null) return raw
  const target = declared.get(reference[1]) ?? reference[2]
  // AN UNRESOLVED TOKEN IS NOT A COLOUR, exactly as in `ceremonyTokenValues`.
  if (target === undefined || target.startsWith('var(')) return null
  return target.trim()
}
