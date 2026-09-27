/**
 * ── THIS FILE IS A COPY, AND IT IS A COPY ON PURPOSE (cohesion row 4, aura-84) ────────────────────────
 * *`scripts/lib/is-main.mjs` was imported by this plugin's `bin/` scripts as `../../../scripts/lib/…`,*
 * *** WHICH IS A PATH THAT CLIMBS OUT OF THE PLUGIN'S OWN TREE. *** **A release is copied tree-by-tree, so
 * that import resolves in the checkout and NOT in the release** -- *the worst shape a path defect can take:
 * it works for everyone who runs it from the repository and breaks only for the person running the release.*
 *
 * **THE MODULE IS NOT A CONVENIENCE AND THAT IS WHY IT WAS COPIED RATHER THAN DELETED.** *Its own docstring
 * records a MEASURED bug: the naive `file://${process.argv[1]}` guard never matches through a symlink, so
 * `verify-launch-staging.mjs` exited 0 with ZERO lines of output* -- **a relaunch safety check that did
 * nothing reported SUCCESS.** *Thirty-five lines that prevent a silent-success guard are worth keeping in
 * every plugin that guards a main block.*
 *
 * *The original lives at `scripts/lib/is-main.mjs` and is unchanged.* **If the guard is ever fixed, fix it
 * there first and copy again** -- *the four copies are per-plugin because the four plugins are released
 * independently, which is the correct granularity rather than a smell.*
 */
/**
 * `isMainModule(import.meta.url)` — THE MAIN GUARD THAT DOES NOT FAIL OPEN THROUGH A SYMLINK.
 *
 * The naive guard compares `import.meta.url` to `file://${process.argv[1]}`. Node resolves the FIRST through
 * the real path and leaves the SECOND as the operating system spelled it, so on any symlinked invocation —
 * `/tmp` is `/private/tmp` on macOS, and a symlinked checkout does it everywhere — the two never match. The
 * main block does not run, the script exits 0, and a tool that did NOTHING reports SUCCESS.
 *
 * MEASURED ON THE PRE-FIX CODE, through a symlink to scripts/aukora/verify-launch-staging.mjs — a relaunch
 * safety check: exit 0 and ZERO lines of output. A guard whose failure mode is "silently does nothing" is
 * worse than no guard, because a caller reads the exit code as a verdict.
 *
 * Both sides are canonicalised here: `realpathSync` and `fileURLToPath` on the module URL, `realpathSync`
 * and `pathToFileURL` on `argv[1]`. A path that cannot be resolved falls back to its literal form rather than
 * throwing, and an absent `argv[1]` (an imported module) is simply NOT the main module.
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** @param {string} path @returns {string} the real path when it exists, the literal path otherwise */
const realOrLiteral = (path) => {
  try { return realpathSync(path) } catch { return path }
}

/**
 * @param {string} moduleUrl the caller's `import.meta.url`
 * @param {string|undefined} [argv1] defaults to `process.argv[1]`
 * @returns {boolean} true only when this module is the one Node was asked to run
 */
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== 'string' || argv1 === '') return false
  let modulePath = null
  try { modulePath = fileURLToPath(moduleUrl) } catch { return false }
  return pathToFileURL(realOrLiteral(modulePath)).href === pathToFileURL(realOrLiteral(argv1)).href
}
