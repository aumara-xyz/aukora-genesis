/**
 * INSTALLED DEPENDENCY INTEGRITY: a sorted path -> sha256 list for `node_modules/`, recorded at materialize
 * time and verified by the keyless check.
 *
 * WHY THIS EXISTS. `README.md` says the installed dependency bytes in a release are "copied unchanged" and
 * that the lockfile fixes only the installation SPECIFICATION, not the installed files. MEASURED: NOTHING
 * RECORDED A DIGEST OF A SINGLE ONE OF THEM. `scripts/lib/release-strip.mjs` skips the store by design
 * ("the installed dependency store is never scanned or counted"), `scripts/artifacts-coverage.json` lists
 * the `node_modules` glob as a scan exclusion, and the release record's ONLY mention of it is as a
 * SKIP NAME (`/strip/counts/scope/skipsAtRoot[0]`). So a byte flipped in an installed dependency was
 * invisible to every check the project has: measured by flipping one and watching `genesis-check` say
 * nothing about it.
 *
 * THE THREAT THIS CLOSES, STATED NARROWLY BECAUSE THE WIDER ONE IS NOT CLOSED: IT DETECTS TAMPERING WITH AN
 * INSTALLED DEPENDENCY FILE THAT DOES NOT ALSO REWRITE THE RELEASE RECORD.
 *
 * *** AND THE CEILING IS NAMED HERE RATHER THAN IMPLIED. *** The digest list lives INSIDE the release, in
 * `.dsh-build/aukora-release.json`. An attacker who rewrites a dependency byte AND rewrites the record's
 * entry for it leaves the record's own digest intact and this check passes — the same substitution weakness
 * `scripts/launch-dsh-test.py` describes for the plugin-hook record. CLOSING THAT IS A LATER ITEM AND NEEDS
 * THE RECORD'S OWN DIGEST PINNED OUTSIDE THE RELEASE (for example in the owner-signed deployment overlay).
 * THIS MODULE DOES NOT CLAIM TO CLOSE IT.
 *
 * COST, MEASURED ON A MATERIALIZED RELEASE: 65,640 files, 1,466 MiB, about 13 seconds to hash, and a list of
 * roughly 6.3 MiB of JSON. That is why the list is built ONCE at materialize time and only re-read by the
 * check: THE CHECK PAYS THE 13 SECONDS, THE RECORD PAYS THE 6.3 MiB, AND NEITHER PAYS BOTH.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The store this covers, relative to a release root. */
export const DEPENDENCY_ROOT = 'node_modules'

/** Where the list is recorded. */
export const DEPENDENCY_RECORD_KEY = 'dependencies'

/** sha256 of one file's bytes. */
export function sha256FileBytes(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Every file under `root/node_modules`, as sorted `[relativePath, sha256]` pairs.
 *
 * SORTED BY PATH so the list is comparable byte-for-byte between runs and between machines, and so a diff of
 * two records reads as a diff of two installations. A `Map` would preserve insertion order, which depends on
 * directory iteration — an ordering nobody promised.
 *
 * @param {string} root - release root.
 * @returns {Array<[string, string]>}
 */
export function dependencyDigests(root) {
  const store = join(root, DEPENDENCY_ROOT)
  const files = []
  const walk = directory => {
    let entries = []
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      // SYMLINKS ARE NOT FOLLOWED. A store that links out to a file outside the release is a different
      // integrity question, and hashing through the link would record the TARGET's bytes under the LINK's
      // name — a digest that stays correct while the release's own content changes.
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  walk(store)
  return files
    .map(path => [relative(root, path).split('\\').join('/'), sha256FileBytes(path)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/**
 * Compare the store on disk against a recorded list, naming every difference.
 *
 * @param {string} root - release root.
 * @param {Array<[string, string]>} recorded - what the record carries.
 * @returns {Array<{path: string, kind: string, expected?: string, actual?: string}>} empty when intact.
 */
export function dependencyDifferences(root, recorded) {
  const found = new Map(dependencyDigests(root))
  const expected = new Map(recorded)
  const differences = []
  // CHANGED AND REMOVED FIRST, IN RECORDED ORDER, so the report is stable between runs.
  for (const [path, digest] of expected) {
    if (!found.has(path)) differences.push({ path, kind: 'removed' })
    else if (found.get(path) !== digest) {
      differences.push({ path, kind: 'changed', expected: digest, actual: found.get(path) })
    }
  }
  // AND ADDED, which the loop above cannot see because it iterates what was recorded.
  for (const path of found.keys()) if (!expected.has(path)) differences.push({ path, kind: 'added' })
  return differences
}
