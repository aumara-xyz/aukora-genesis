/**
 * ROBUST DISPOSABLE TEMP ROOTS FOR THE RELEASE-COPYING COURTS.
 *
 * WHY THIS EXISTS. Several courts stage a materialized release — about 1.8 GB — into
 * `mkdtempSync(join(tmpdir(), '<prefix>-'))` and removed it only on the green path at the
 * bottom of the file. A run that was interrupted, or a sub-process that was killed, left the
 * tree behind forever. Measured in `$TMPDIR` on 2026-09-22 before cleanup: 616 leftover
 * directories holding ~46 GB. One full court run cost ~29 GB that was never reclaimed, and the
 * disk filled to 100%.
 *
 * THREE LAYERS, because no single one is enough:
 *
 *   1. {@link courtTemp} registers every root it creates on a process-wide registry and removes
 *      the whole registry from `process.on('exit')` and from `SIGINT`/`SIGTERM`. The signal
 *      handler cleans, then re-raises the signal so the exit status stays honest (`130`/`143`
 *      rather than a laundered `0`).
 *   2. The court keeps its own end-of-run removal for the green path — unchanged.
 *   3. {@link sweepStaleCourtTemps} runs when the court STARTS, before it creates its own root,
 *      and reaps siblings of an EARLIER run that was `SIGKILL`ed — the one case a handler can
 *      never catch. This is what actually saves the disk.
 *
 * WHAT THE SWEEP WILL NOT DO. It is deliberately narrow, because a cleanup helper that can
 * delete the wrong directory is worse than the leak:
 *
 *   - it only looks at names that START WITH THE CALLER'S OWN family prefix;
 *   - the remainder must be the exact shape `mkdtempSync` produces — an optional `label-` then
 *     exactly six alphanumerics (`<prefix>-XXXXXX` or `<family>-<label>-XXXXXX`);
 *   - the entry must be a real directory (`lstatSync`, so a symlink never counts), not one of
 *     THIS process's live roots, and owned by this uid;
 *   - its mtime must be older than {@link STALE_AFTER_MS} (30 minutes), so a court running
 *     concurrently under the same prefix is never disturbed.
 *
 * A caller must therefore pass its OWN narrowest family. `'aura-'` or `'board-'` is too broad
 * and would reach into a sibling court's roots; `'aura-association-row-'` is the right
 * granularity. The sweep always prints exactly one line naming what it removed — or that it
 * removed nothing — so a green run cannot hide a sweep that silently did not happen.
 *
 * `AUKORA_COURT_STALE_MS` overrides the threshold for an operator who needs the disk back now.
 *
 * @module tests/release-temp
 */
import { chmodSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A root younger than this is presumed live. 30 minutes is far longer than any court's copy. */
export const STALE_AFTER_MS = 30 * 60 * 1000

/** The live roots of THIS process, canonicalised where possible. */
const live = new Set()
/** Families already swept in this process, so the sweep runs once per prefix, at court start. */
const sweptFamilies = new Set()
let handlersInstalled = false

/** The effective staleness threshold: the documented default, or the operator's override. */
function staleAfterMs() {
  const override = Number(process.env.AUKORA_COURT_STALE_MS)
  return Number.isFinite(override) && override >= 0 ? override : STALE_AFTER_MS
}

/** @param {string} path @returns {string} the canonical spelling, or the input if it is gone. */
function canonical(path) {
  try { return realpathSync(path) } catch { return path }
}

/**
 * `rmSync` retried after making the tree writable. The staged copies are `chmod -R u+w`ed by the
 * courts that stage them, but an interrupted `cp -R` can leave a directory at the source's mode,
 * and a recursive remove that cannot enter a directory cannot empty it either.
 * @param {string} path @returns {boolean} whether the tree is gone.
 */
function removeTree(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    return true
  } catch {
    try {
      makeWritable(path, 0)
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      return true
    } catch { return false }
  }
}

/** @param {string} path @param {number} depth bounded, so a pathological tree cannot spin. */
function makeWritable(path, depth) {
  if (depth > 24) return
  try { chmodSync(path, 0o700) } catch { /* gone, or not ours */ }
  let entries
  try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    makeWritable(join(path, entry.name), depth + 1)
  }
}

/** Remove every live root now. Idempotent, and safe to call from an exit handler. */
export function disposeCourtTemps() {
  for (const path of live) removeTree(path)
  live.clear()
}

/**
 * Stop tracking one root WITHOUT removing it — for the two courts that deliberately keep a FAILED
 * run's work directory for inspection. The exit handler and the signals no longer take it, so the
 * evidence survives the process; the NEXT run's stale sweep reaps it once it is past the
 * threshold. The diagnostic is preserved and the disk is still bounded.
 * @param {string} path @returns {boolean} whether it was a tracked root.
 */
export function keepCourtTemp(path) {
  for (const tracked of live) {
    if (tracked === path || canonical(tracked) === canonical(path)) return live.delete(tracked)
  }
  return false
}

/** Install the exit and signal handlers once per process. */
function installHandlers() {
  if (handlersInstalled) return
  handlersInstalled = true
  process.on('exit', disposeCourtTemps)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    // `once`, and the listener removes itself before re-raising, so the re-raised signal reaches
    // the DEFAULT action instead of this handler again — the process must still die by that
    // signal, with the status a shell reports for it, rather than being turned into a clean exit.
    process.once(signal, function onSignal() {
      process.removeListener(signal, onSignal)
      disposeCourtTemps()
      process.kill(process.pid, signal)
      // If something else swallowed the re-raise, leave anyway with the honest status.
      setTimeout(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)), 2000)
    })
  }
}

/**
 * Create a tracked, disposable temp root, sweeping this family's orphans first.
 *
 * @param {string} prefix - the `mkdtempSync` prefix, ending in `-`.
 * @param {{realpath?: boolean, sweep?: string|null, staleAfterMs?: number}} [options] -
 *   `realpath` canonicalises the returned path at creation (some courts compare paths with
 *   `realpathSync` elsewhere and need like-for-like). `sweep` overrides the family to reap, for
 *   courts whose prefix carries a per-arm label; pass the label-free family. `null` skips the
 *   sweep — used only by the courts that do not copy a release.
 * @returns {string} the created root.
 */
export function courtTemp(prefix, options = {}) {
  const { realpath = false, sweep = prefix } = options
  if (sweep !== null) sweepStaleCourtTemps(sweep, options)
  const created = mkdtempSync(join(tmpdir(), prefix))
  const path = realpath ? realpathSync(created) : created
  live.add(path)
  installHandlers()
  return path
}
/**
 * Reap this family's leftovers from an earlier, `SIGKILL`ed run. Runs once per family per
 * process, so calling it from every `courtTemp` is free.
 *
 * @param {string} family - this court's own narrowest prefix, ending in `-`.
 * @param {{labeled?: boolean, staleAfterMs?: number, dir?: string, quiet?: boolean}} [options] -
 *   `labeled` widens the accepted shape from `<family>-XXXXXX` (the default, and the only shape a
 *   plain `mkdtempSync(join(tmpdir(), family))` leaves) to also accept `<family>-<label>-XXXXXX`,
 *   for courts whose prefix carries a per-arm label. It is opt-in so that a court sitting next to
 *   siblings with longer names — `kira-approval-` next to `kira-approval-wire-` — cannot reach
 *   into them by accident.
 * @returns {string[]} the names removed.
 */
export function sweepStaleCourtTemps(family, options = {}) {
  const { dir = tmpdir(), quiet = false, labeled = false } = options
  const threshold = options.staleAfterMs ?? staleAfterMs()
  if (sweptFamilies.has(family)) return []
  sweptFamilies.add(family)

  const report = message => { if (!quiet) console.log(`court-temp sweep[${family}]: ${message}`) }
  if (typeof family !== 'string' || family.length < 4 || !family.endsWith('-')) {
    // Fail closed: a mistyped family is how a cleaner deletes a stranger's directory.
    report(`REFUSED — "${String(family)}" is not a narrow prefix ending in "-"; swept nothing`)
    return []
  }
  if (typeof process.getuid !== 'function') {
    report('REFUSED — this platform has no uid, so ownership cannot be checked; swept nothing')
    return []
  }

  let entries
  try { entries = readdirSync(dir) } catch { entries = [] }

  // The EXACT shape mkdtempSync leaves. Nothing loosely "similar" is ever a candidate.
  const shape = labeled
    ? /^[A-Za-z0-9_.]{1,48}-[A-Za-z0-9]{6}$/
    : /^[A-Za-z0-9]{6}$/
  const cutoff = Date.now() - threshold
  const removed = []
  const mine = new Set([...live].map(canonical))
  for (const name of entries) {
    if (!name.startsWith(family)) continue
    if (!shape.test(name.slice(family.length))) continue
    const full = join(dir, name)
    if (mine.has(canonical(full))) continue
    let stats
    try { stats = lstatSync(full) } catch { continue }
    if (!stats.isDirectory()) continue
    if (stats.uid !== process.getuid()) continue
    if (stats.mtimeMs > cutoff) continue
    if (!removeTree(full)) { report(`FAILED to remove ${name} (still present)`); continue }
    removed.push(name)
  }

  const age = Math.round(threshold / 60000)
  report(removed.length === 0
    ? `nothing stale (>${String(age)} min) in ${dir}`
    : `removed ${String(removed.length)} orphaned root(s) older than ${String(age)} min: ${removed.join(', ')}`)
  return removed
}
