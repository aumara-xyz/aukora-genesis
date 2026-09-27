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
