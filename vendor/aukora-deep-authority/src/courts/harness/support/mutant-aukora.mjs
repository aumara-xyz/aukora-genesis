/**
 * Copy the AUKORA source tree for a court arm with explicit dependency
 * resolution.
 *
 * A court arm executes copied AUKORA bytes from a private temporary tree. Node
 * resolves a bare specifier by walking up from the importing file, and nothing
 * above that temporary tree declares the packages `aukora/identity/control.mjs`
 * imports, so the copy needs its own resolution.
 *
 * Copying the workspace `node_modules` alongside the source supplies it only as
 * a side effect: the copy inherits whatever layout the installer left, which
 * differs by platform, and the arm reports `ERR_MODULE_NOT_FOUND` wherever that
 * layout does not survive the copy.
 *
 * The declared packages are copied with their dependency closure rather than
 * linked. `uid-confinement` hands its tree to a second uid that need not be
 * able to traverse the checkout, and an unreadable link target is reported by
 * the resolver as a missing package rather than as a permission error. A tree
 * that carries its own bytes is readable by whichever principal the court runs.
 *
 * Copying installed dependency bytes is not an authority import: the tree
 * carries the court's own AUKORA source, and every AUKORA module reaches its
 * neighbours through relative specifiers that cannot leave the copy. This
 * fixture asserts both halves — every declared module resolves inside the copy,
 * and the AUKORA source a copied module imports is the copy's own.
 */
import { cpSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The repository's honest AUKORA source, the donor for every court copy. */
export const HONEST_AUKORA = resolve(HERE, '../../../aukora')

/**
 * External modules the copied authority graph imports, frozen so a new bare
 * specifier fails this fixture by name instead of resolving through whatever
 * directory the copy destination happens to sit beneath.
 */
const DECLARED_MODULES = ['@noble/curves/ed25519.js', '@noble/post-quantum/ml-dsa.js']

/** @param {string} source @returns {boolean} whether the copy keeps this path. */
const isSourcePath = (source) => !source.split(sep).includes('node_modules')

/**
 * Locate the installed package directory that owns one specifier.
 * @param {string} from - absolute file the specifier is resolved against.
 * @param {string} specifier - module or package specifier.
 * @returns {string} the directory holding that package's `package.json`.
 */
function packageRoot(from, specifier) {
  let directory = dirname(createRequire(from).resolve(specifier))
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`mutant fixture found no package root for ${specifier}`)
    directory = parent
  }
  return directory
}

/**
 * Collect the declared modules and every package they depend on.
 * @returns {Map<string, string>} package name to its installed directory.
 */
function declaredClosure() {
  const anchor = join(HONEST_AUKORA, 'identity/control.mjs')
  const found = new Map()
  const visit = (from, specifier) => {
    const root = packageRoot(from, specifier)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (found.has(manifest.name)) return
    found.set(manifest.name, root)
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(join(root, 'package.json'), dependency)
    }
  }
  for (const specifier of DECLARED_MODULES) visit(anchor, specifier)
  return found
}

/**
 * Copy the honest AUKORA source into a court's temporary tree and give it a
 * self-contained dependency set.
 *
 * @param {string} destination - absolute path the court owns for this arm.
 * @returns {string} the destination, so a caller can copy and use in one step.
 * @throws when the copy omits the authority graph, cannot resolve a declared
 *   module, or reaches a module outside itself.
 */
export function copyMutantAukora(destination) {
  cpSync(HONEST_AUKORA, destination, { recursive: true, filter: isSourcePath })
  const anchor = join(destination, 'identity/control.mjs')
  if (!existsSync(anchor)) throw new Error(`court copy is missing ${anchor}`)

  const modules = join(destination, 'node_modules')
  for (const [name, root] of declaredClosure()) {
    const target = join(modules, name)
    if (existsSync(target)) continue
    cpSync(root, target, { recursive: true, dereference: true })
  }

  const copied = createRequire(anchor)
  const inside = realpathSync(destination) + sep
  for (const specifier of DECLARED_MODULES) {
    let resolved
    try {
      resolved = copied.resolve(specifier)
    } catch (cause) {
      throw new Error(`court copy at ${destination} cannot resolve ${specifier}`, { cause })
    }
    if (!realpathSync(resolved).startsWith(inside)) {
      throw new Error(`court copy at ${destination} resolved ${specifier} outside itself: ${resolved}`)
    }
  }
  if (!realpathSync(copied.resolve('./genesis.mjs')).startsWith(inside)) {
    throw new Error(`court copy at ${destination} reached AUKORA source outside itself`)
  }
  return destination
}
