#!/usr/bin/env node
// Local, reviewable install bundle. Never reads app state, identities, or keys.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closure } from '../owner/owner-closure.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
try {
  if (process.getuid?.() === 0) throw new Error('build unprivileged; review the digest before admin installation')
  if (process.argv[2] !== '--bundle' || !process.argv[3] || process.argv.length !== 4) {
    throw new Error('usage: node scripts/aukora/airlock-digests.mjs --bundle /absolute/new-directory')
  }
  const bundle = resolve(process.argv[3])
  if (existsSync(bundle)) throw new Error('bundle directory must be new')
  const entries = ['plugins/aukora-owner-daemon/bin/airlock-daemon.mjs',
    'scripts/aukora/airlock-rotate.mjs', 'scripts/aukora/airlock-probe.mjs']
  const files = closure({ repo: root, entries })
  if (files.ceilings.length) throw new Error(`unresolved runtime loading: ${files.ceilings.join('; ')}`)
  const sources = new Set([...files, 'plugins/aukora-owner-daemon/native/peer-uid.c'])
  // Carry each imported package's notices alongside its measured source.
  for (const file of [...sources]) {
    let dir = dirname(join(root, file))
    while (dir === root || dir.startsWith(`${root}/`)) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /^(LICENSE|COPYING|NOTICE|THIRD_PARTY_NOTICES)(\.|$)/u.test(entry.name)) {
          sources.add(relative(root, join(dir, entry.name)))
        }
      }
      if (dir === root) break
      dir = dirname(dir)
    }
  }
  mkdirSync(bundle, { mode: 0o700 })
  for (const file of [...sources].sort()) {
    const source = join(root, file), target = join(bundle, file)
    if (!lstatSync(source).isFile()) throw new Error(`not a regular source file: ${file}`)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    chmodSync(target, 0o644)
  }
  mkdirSync(join(bundle, 'bin'))
  copyFileSync(realpathSync(process.execPath), join(bundle, 'bin/node'))
  chmodSync(join(bundle, 'bin/node'), 0o755)
  execFileSync('/usr/bin/cc', ['-O2', '-Wall', '-Wextra', '-Werror',
    join(bundle, 'plugins/aukora-owner-daemon/native/peer-uid.c'), '-o', join(bundle, 'peer-uid')],
  { stdio: 'inherit' })
  chmodSync(join(bundle, 'peer-uid'), 0o755)
  const rows = [...sources, 'bin/node', 'peer-uid'].sort().map(file => `${sha(join(bundle, file))}  ${file}`)
  writeFileSync(join(bundle, 'MANIFEST.sha256'), `${rows.join('\n')}\n`, { mode: 0o644 })
  process.stdout.write(`BUNDLE ${bundle}\nMANIFEST_SHA256 ${sha(join(bundle, 'MANIFEST.sha256'))}\n`)
  process.stdout.write(`DIGEST_SCRIPT_SHA256 ${sha(fileURLToPath(import.meta.url))}\n`)
  process.stdout.write(`NODE_SHA256 ${sha(join(bundle, 'bin/node'))}\nPEER_HELPER_SHA256 ${sha(join(bundle, 'peer-uid'))}\n`)
  process.stdout.write('LOCAL_DIGESTS: identity of these bytes, not independent provenance or approval\n')
} catch (error) {
  process.stderr.write(`REFUSED: ${error.message}\n`)
  process.exitCode = 1
}
