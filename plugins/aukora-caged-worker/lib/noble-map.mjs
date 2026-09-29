// Resolve only the measured versions already shipped in vendor/authority/deps.
// Same mapping as tests/noble-map.mjs; production has no dependency on tests.
import { registerHooks } from 'node:module'
const versions = { curves: '2.2.0', hashes: '2.2.0', 'post-quantum': '0.6.1', ciphers: '2.2.0' }
const base = new URL('../../../vendor/authority/deps/@noble/', import.meta.url)
const parents = [new URL('./', import.meta.url).href, new URL('../../aukora-box/', import.meta.url).href, base.href]
registerHooks({ resolve(specifier, context, next) {
  const match = /^@noble\/([^/]+)\/([a-zA-Z0-9_./-]+)$/u.exec(specifier)
  if (!parents.some(parent => context.parentURL?.startsWith(parent)) || !match
    || !Object.hasOwn(versions, match[1]) || match[2].split('/').includes('..')) return next(specifier, context)
  return { url: new URL(`${match[1]}@${versions[match[1]]}/${match[2]}`, base).href, shortCircuit: true }
} })
