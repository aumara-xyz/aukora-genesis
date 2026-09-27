#!/usr/bin/env node
/**
 * The path and closure a composition grant binds, computed by the gate's own rule.
 *
 *   node scripts/composition/grant-binding.mjs --root <release root> --plugin <file>
 *
 * Prints one JSON object: {"pluginPath": "<root-relative key>", "pluginClosure": "<64 hex>"}.
 *
 * WHY A NODE HELPER FOR A PYTHON MINT. The load hook decides admission with `resolveModuleIdentity` and
 * `artifactClosure` (plugins/aukora-composition-gate/src/artifact.mjs): realpath, case-normalised on a
 * case-insensitive volume, root-relative with forward slashes, and the relative import closure resolved
 * by Node's own resolver. A Python copy of that rule would be a second rule, and two rules are how a mint
 * and a hook come to disagree about the same file. So the mint asks this helper, and the helper calls the
 * functions the hook calls.
 *
 * Exit 0 with the JSON, 1 with a named refusal on stderr, 2 on usage.
 */
import { resolve } from 'node:path'
import { artifactClosure, artifactDigest, resolveModuleIdentity } from '../../plugins/aukora-composition-gate/src/artifact.mjs'

const option = (flag) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}
const root = option('--root')
const plugin = option('--plugin')
if (root === undefined || plugin === undefined) {
  process.stderr.write('usage: grant-binding.mjs --root <release root> --plugin <file>\n')
  process.exit(2)
}
try {
  const { key } = resolveModuleIdentity(resolve(plugin), root)
  const closure = artifactClosure(resolve(plugin), root)
  process.stdout.write(`${JSON.stringify({ pluginPath: key, pluginClosure: artifactDigest(closure) })}\n`)
} catch (error) {
  process.stderr.write(`grant-binding: ${error?.code ?? 'refused'}: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
