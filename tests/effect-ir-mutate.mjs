/**
 * One mutation of one subject, loaded in place of that file for one court run.
 * Node v22.14.0 has module.register and does not export registerHooks.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function proveMutation({ court, subject, from, to, expectArm }) {
  const before = readFileSync(subject, 'utf8')
  if (!before.includes(from)) return { caught: false, reason: 'anchor missing' }
  const dir = mkdtempSync(join(tmpdir(), 'effect-ir-mut-'))
  try {
    const file = join(dir, 'subject.mjs')
    writeFileSync(file, before.replace(from, to))
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (syntax.status !== 0) return { caught: false, reason: 'mutant does not parse' }
    const original = pathToFileURL(subject).href
    const mutantUrl = pathToFileURL(file).href
    const hook = join(dir, 'hook.mjs')
    const loader = join(dir, 'register.mjs')
    writeFileSync(hook, `export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === ${JSON.stringify(mutantUrl)} && specifier.startsWith('.')) {
    return nextResolve(specifier, { ...context, parentURL: ${JSON.stringify(original)} })
  }
  const resolved = await nextResolve(specifier, context)
  if (resolved.url === ${JSON.stringify(original)}) return { url: ${JSON.stringify(mutantUrl)}, shortCircuit: true }
  return resolved
}
`)
    writeFileSync(loader, `import { register } from 'node:module'
register(${JSON.stringify(pathToFileURL(hook).href)}, ${JSON.stringify(pathToFileURL(loader).href)})
`)
    const run = spawnSync(process.execPath, ['--import', loader, court], { encoding: 'utf8' })
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
    if (run.status === 0) return { caught: false, reason: 'mutation not caught', output }
    if (!output.includes(expectArm)) return { caught: false, reason: 'misattributed', output }
    if (readFileSync(subject, 'utf8') !== before) return { caught: false, reason: 'subject changed' }
    return { caught: true, status: run.status }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
