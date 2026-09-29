/**
 * Point the box's bare `@noble/*` imports at the copy this repository ALREADY commits.
 *
 * The sealed box imports `@noble/curves/ed25519.js` and `@noble/post-quantum/ml-dsa.js` by package
 * name. Node resolves a bare specifier by walking `node_modules` upward from the importing file, so
 * from `plugins/aukora-box/...` it reaches only the repository root - and the closure lives at
 * `vendor/authority/deps/@noble/<name>@<version>/`, which is not on that walk. Nothing was missing:
 * the bytes are committed, at exactly the versions the box pins. The import simply did not reach
 * them.
 *
 * This is a mapping, not a copy. It adds no dependency, installs nothing, and rewrites no byte of
 * the sealed box or of the vendored sources. It exists so a fresh clone - which has no
 * `node_modules` - resolves the same bytes CI does.
 *
 * It is passed to every subprocess this repository's broker court spawns, because those children
 * run with `NODE_OPTIONS` stripped on purpose and would otherwise resolve to nothing.
 */
import { registerHooks } from 'node:module'

/** The versions the box pins, and the directory names this repository commits them under. */
export const NOBLE_VENDOR_VERSIONS = Object.freeze({
  curves: '2.2.0', hashes: '2.2.0', 'post-quantum': '0.6.1', ciphers: '2.2.0',
})

const BASE = new URL('../vendor/authority/deps/@noble/', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    const match = /^@noble\/([^/]+)\/(.+)$/u.exec(specifier)
    if (match === null) return nextResolve(specifier, context)
    const [, name, rest] = match
    const version = NOBLE_VENDOR_VERSIONS[name]
    if (version === undefined) return nextResolve(specifier, context)
    return { url: new URL(`${name}@${version}/${rest}`, BASE).href, shortCircuit: true }
  },
})
