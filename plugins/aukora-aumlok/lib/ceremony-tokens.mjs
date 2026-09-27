/**
 * The face's colour tokens, read from the FACE'S OWN FILE rather than restated here.
 *
 * WHY THIS IS NOT A COPY OF THE COLOURS. The ceremony window this replaces hardcoded its own hex and
 * forced dark, so it looked like nothing else in the application and ignored the face entirely. The
 * fix is not to paste the face's hex into the window — that is the same defect with better values, and
 * it drifts the first time the face changes. The window carries the face's VARIABLE NAMES and the
 * shell resolves them by reading the face's own stylesheet out of the release it is serving.
 *
 * ONE LEVEL OF `var()` IS RESOLVED, ON PURPOSE. The face writes `--aumlok-anchor:
 * var(--dsw-static-spatial-gold)` and the foundation defines the gold. That is the chain this follows,
 * and it stops there: a resolver that chased arbitrary depth would be a CSS engine, and this is a
 * window that needs four colours. A token whose chain does not terminate in a literal is reported as
 * unresolved rather than guessed at.
 *
 * @module @aukora/dsh-plugin-aumlok/ceremony-tokens
 */

/** The tokens the ceremony window needs, in the order the spine draws them. */
export const CEREMONY_TOKEN_NAMES = Object.freeze([
  // THE FOUR SPATIAL COLOURS, from the face bundles (the Aumlok face aliases them to the layout's static
  // tokens, and `ceremonyTokenValues` follows that one reference).
  '--aumlok-anchor', '--aumlok-root', '--aumlok-unite', '--aumlok-rise',
  // AND THE FOUNDATION'S ALIAS SET, which the window has always painted with and NOTHING EVER READ.
  // MEASURED: the window's stylesheet names these five and carries no hex of its own, so every
  // background, border and label colour in it resolved to nothing — the shell read the four above from
  // the face bundles, and the face bundles do not declare these: they come from the foundation
  // stylesheet the app loads (`packages/client/ui-theme`), which the ceremony window never did.
  '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-border-l2',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
])

/** Every custom property defined in a stylesheet, as written. Last definition wins, as in CSS. */
function declaredTokens(cssText) {
  const found = new Map()
  for (const match of String(cssText).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gu)) {
    found.set(match[1], match[2].trim())
  }
  return found
}

/**
 * Resolve the ceremony tokens across the stylesheets that define them, following `var()` one level.
 *
 * TAKES SEVERAL STYLESHEETS, AND THAT IS NOT A CONVENIENCE. The FACE writes
 * `--aumlok-anchor: var(--dsw-static-spatial-gold)` and the FOUNDATION defines the gold; neither file
 * alone resolves the chain. Passing one of them returns `{}` — which is how this was found, and it
 * would have been a window with no colours and a court that passed because "no hex" was trivially
 * true of an empty result.
 * @param {...string} cssTexts - the stylesheets, in any order; later definitions win.
 * @returns {Readonly<Record<string, string>>} token name → literal value, for the tokens that resolved.
 */
export function ceremonyTokenValues(...cssTexts) {
  const declared = new Map()
  for (const cssText of cssTexts) {
    for (const [name, value] of declaredTokens(cssText)) declared.set(name, value)
  }
  const resolved = {}
  for (const name of CEREMONY_TOKEN_NAMES) {
    const raw = declared.get(name)
    if (raw === undefined) continue
    const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(raw)
    if (reference === null) { resolved[name] = raw; continue }
    const target = declared.get(reference[1]) ?? reference[2]
    // AN UNRESOLVED TOKEN IS OMITTED, NOT INVENTED. The window then falls back to the app's own
    // surface colour rather than to a colour this module made up.
    if (target !== undefined && !target.startsWith('var(')) resolved[name] = target.trim()
  }
  return Object.freeze(resolved)
}
