/**
 * CLI entry for the KIRA memory artifact verifier.
 *
 *     node aukora/verifier/kira-memory-artifact-verifier-bin.mjs <artifact.json> [--head <hex>]
 *
 * Prints one line of JSON — the verdict as {@link verifyKiraMemoryArtifact} returns
 * it — and exits 0 when the artifact verifies, 1 for every refusal, including
 * an unreadable file, unparseable JSON, and a missing or malformed head. The
 * head is an out-of-band input: it comes from whoever retained it at settlement
 * time, never from the artifact.
 *
 * @module @aukora/verifier/kira-memory-artifact-verifier-bin
 */
import { readFileSync } from 'node:fs'
import { KIRA_MEMORY_ARTIFACT_CEILING, KIRA_MEMORY_ARTIFACT_REFUSE, verifyKiraMemoryArtifact } from './kira-memory-artifact-verifier.mjs'

/**
 * @param {string} failed - the named refusal.
 * @param {string} detail - what went wrong before the artifact could be judged.
 * @returns {{ok: false, failed: string, checks: Array<{check: string, ok: false, detail: string, reason: string}>, ceiling: readonly string[]}}
 *   one closed verdict in the same encoding as a verifier refusal.
 */
function refusal(failed, detail) {
  return { ok: false, failed, checks: [{ check: 'inputs', ok: false, detail, reason: failed }], ceiling: KIRA_MEMORY_ARTIFACT_CEILING }
}

/**
 * Read `<artifact.json>` and an optional `--head <hex>` from the argument list.
 * @param {readonly string[]} argv - arguments after the script path.
 * @returns {{ok: true, path: string, head: string | undefined} | {ok: false, detail: string}} the parsed invocation, or why it is unusable.
 */
function readArgv(argv) {
  let path
  let head
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--head') {
      index += 1
      if (index >= argv.length) return { ok: false, detail: '--head requires a value' }
      if (head !== undefined) return { ok: false, detail: '--head was supplied more than once' }
      head = argv[index]
      continue
    }
    if (argument.startsWith('--')) return { ok: false, detail: `unknown option ${JSON.stringify(argument)}` }
    if (path !== undefined) return { ok: false, detail: 'exactly one artifact path is accepted' }
    path = argument
  }
  return path === undefined
    ? { ok: false, detail: 'usage: kira-memory-artifact-verifier-bin.mjs <artifact.json> [--head <hex>]' }
    : { ok: true, path, head }
}

/**
 * Produce the verdict for one invocation without letting any failure escape.
 * @param {readonly string[]} argv - arguments after the script path.
 * @returns {import('./kira-memory-artifact-verifier.d.mts').KiraMemoryArtifactResult} the closed verdict to print.
 */
function run(argv) {
  const invocation = readArgv(argv)
  if (!invocation.ok) return refusal(KIRA_MEMORY_ARTIFACT_REFUSE.USAGE, invocation.detail)
  let text
  try {
    text = readFileSync(invocation.path, 'utf8')
  } catch (error) {
    return refusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_UNREADABLE, `cannot read the artifact (${String(error?.code ?? error?.message ?? error)})`)
  }
  let artifact
  try {
    artifact = JSON.parse(text)
  } catch {
    // JSON.parse throws only SyntaxError here; the file is not one JSON value.
    return refusal(KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_NOT_JSON, 'the artifact file is not one JSON value')
  }
  return verifyKiraMemoryArtifact(artifact, invocation.head === undefined ? {} : { trustedHead: invocation.head })
}

const verdict = run(process.argv.slice(2))
process.stdout.write(`${JSON.stringify(verdict)}\n`)
process.exitCode = verdict.ok ? 0 : 1
