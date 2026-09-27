/**
 * The Seatbelt rules AUKORA adds to every profile the harness confines an agent command with.
 *
 * The harness's own profile (vendor/dsh packages/sandbox/sandbox-local/src/profiles.ts:51-58) is
 *
 *     (version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null"))
 *     (allow file-write* (subpath <workspace>) (subpath "/private/tmp") (subpath <TMPDIR>))
 *
 * so it denies writes outside the workspace and the temp roots and nothing else: every READ is allowed. These forms are
 * appended AFTER it. Seatbelt lets the last matching rule decide, so a deny placed last cannot be granted back by the
 * stock allows, including when a protected path sits inside the session's workspace or a temp root.
 *
 * A path rule only matches the path the kernel resolves (symlinks followed, `/tmp` is `/private/tmp`), so every path is
 * canonicalised before it is written into a rule. Measured on Darwin 25.1: with canonical paths a targeted deny after
 * `(allow default)` refuses the read, and it also refuses the same file reached by other spellings (upper case, `..`,
 * `/.vol/<dev>/<inode>`), a symlink, a hard link made inside the sandbox, and `cp -c`.
 *
 * @module @aukora/dsh-plugin-seatbelt/profile
 */
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** The Aumlok machine seed, by file name, anywhere on disk. Read-only rule: fixtures may still be written. */
export const SEED_NAME_REGEX = String.raw`/machine-seed[^/]*\.json$`

/**
 * The paths the agent's shell must not reach, from the deployment's three roots.
 * @param {{supportRoot?: string, dshHome?: string, home?: string}} roots - where this deployment keeps its state.
 * @returns {Readonly<{keys: string[], sockets: string[], receipts: string[]}>} absolute, not yet canonical.
 */
export function protectedPaths({ home = homedir(), supportRoot, dshHome } = {}) {
  const support = supportRoot ?? join(home, 'Library', 'Application Support', 'AUKORA')
  const dsh = dshHome ?? join(support, 'state', 'home')
  return Object.freeze({
    // No read and no write: the Aumlok controller state (machine seed, record), the signer's key directory, the Kira
    // store (issuer key, keys/), SSH keys and the GitHub CLI's token. Denying writes too stops a key being replaced
    // or a symlink being planted at the protected name.
    keys: [join(support, 'state', 'aumlok'), join(home, '.aukora', 'signer'), join(dsh, 'kira-memory'),
      join(home, '.ssh'), join(home, '.config', 'gh')],
    // The Aumlok signer's socket: no connect, no read, no replace.
    sockets: [join(support, 'state', 'aumlok-signer.sock')],
    // No write: the code Aura chain with the kernel's spent set (aura-code/consumed-ids.json) and the action gate's
    // receipt log. Reading them stays allowed.
    receipts: [join(dsh, 'aura-code'), join(dsh, 'aura-actions')],
  })
}

/**
 * The path the kernel will compare: the deepest existing ancestor resolved, the missing rest appended as spelled.
 * @param {string} path - an absolute path, which need not exist yet.
 * @returns {string} the canonical path.
 */
export function canonicalPath(path) {
  try {
    return realpathSync.native(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(canonicalPath(parent), basename(path))
  }
}

/**
 * The SBPL forms, in the order they must be appended.
 * @param {Readonly<{keys: string[], sockets: string[], receipts: string[]}>} paths - from {@link protectedPaths}.
 * @returns {string[]} the forms.
 */
export function aukoraDenyForms(paths) {
  const keys = paths.keys.map(canonicalPath)
  const sockets = paths.sockets.map(canonicalPath)
  const receipts = paths.receipts.map(canonicalPath)
  // A path rule follows a path, not a file. Renaming an ancestor of a protected directory moves the directory out from
  // under its rule (measured: `mv <state> <other>` then read or append succeeds), so no ancestor may be renamed,
  // removed or re-moded. Creating and writing entries INSIDE an ancestor are operations on the child's path and stay
  // allowed.
  const ancestors = new Set()
  for (const path of [...keys, ...sockets, ...receipts]) {
    for (let at = dirname(path); at !== dirname(at); at = dirname(at)) ancestors.add(at)
  }
  return [
    `(deny file-read* file-write* ${keys.map(path => `(subpath ${literal(path)})`).join(' ')})`,
    `(deny file-read* file-write* ${sockets.map(path => `(literal ${literal(path)})`).join(' ')})`,
    `(deny network-outbound ${sockets.map(path => `(remote unix-socket (path-literal ${literal(path)}))`).join(' ')})`,
    `(deny file-read* (regex #"${SEED_NAME_REGEX}"))`,
    `(deny file-write* ${receipts.map(path => `(subpath ${literal(path)})`).join(' ')})`,
    `(deny file-write* ${[...ancestors].map(path => `(literal ${literal(path)})`).join(' ')})`,
  ]
}

/**
 * Append the forms to a Seatbelt wrap the harness produced; refuse anything else.
 *
 * A wrap this function does not recognise is not passed through: the command would then run without the denies, and
 * the seam's own contract (vendor/dsh packages/sandbox/sandbox/src/index.ts:153-157) forbids silent passthrough.
 * @param {{argv: string[]}} confined - the provider's `ConfinedArgv`.
 * @param {string[]} forms - from {@link aukoraDenyForms}.
 * @returns {{argv: string[]}} the same facts with the profile extended.
 */
export function withAukoraDenies(confined, forms) {
  const argv = confined?.argv
  const isSeatbelt = Array.isArray(argv) && basename(String(argv[0])) === 'sandbox-exec' && argv[1] === '-p'
    && typeof argv[2] === 'string' && argv[2].startsWith('(version 1)') && argv[3] === '--'
  if (!isSeatbelt) {
    const error = new Error(`aukora-seatbelt: the sandbox wrap is not a sandbox-exec profile (${JSON.stringify(argv?.slice(0, 2))}); `
      + 'refusing to run the command without the AUKORA denies')
    error.code = 'aukora-seatbelt:not-seatbelt'
    throw error
  }
  return { ...confined, argv: [argv[0], '-p', [argv[2], ...forms].join('\n'), ...argv.slice(3)] }
}

/**
 * Quote one path as an SBPL string literal.
 * @param {string} path - the path.
 * @returns {string} the literal.
 */
function literal(path) {
  return `"${String(path).replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}
