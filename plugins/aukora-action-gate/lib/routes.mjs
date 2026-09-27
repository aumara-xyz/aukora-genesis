/**
 * HOW A CONTAINED AGENT CHANGES GOVERNING CODE, and the scripts it never runs itself.
 *
 * A code change goes through the trusted `aukora_self_change` tool (self-change-tool.mjs), which runs the OWNER'S
 * self-change.mjs on the host. A release, a restart into one, a main advance or a plugin-set change goes through the
 * owner. Running any of those scripts from a shell is refused here by name; reading them is not. This is a tripwire on
 * command TEXT (a copy under another name, or a script fed on stdin, passes it); in a contained session the Seatbelt
 * rows are what stop the script working: no signer socket, no Aumlok state, no code chain.
 *
 * Kept out of shell.mjs on purpose: the crossing's secret scan reads that file's keychain regex as a secret shape, so
 * self-change.mjs cannot carry any edit to it.
 *
 * @module @aukora/dsh-plugin-action-gate/routes
 */
import { basename } from 'node:path'

/** The route, as every refusal names it. */
export const SELF_CHANGE_ROUTE = 'the `aukora_self_change` tool: edit the files in a worktree under ~/aukora-worktrees (name a '
  + 'new one and the tool makes it at GitHub main), then call it with {why, worktree, paths}; it shows Peter the full diff '
  + 'in the Aumlok popup'

const ROUTED_SCRIPTS = Object.freeze(['self-change.mjs', 'become.mjs', 'advance.mjs', 'advance-main.mjs', 'plugin-set.mjs', 'desktop-cutover.mjs'])
const RUNNERS = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'npx', 'sh', 'bash', 'zsh', 'python', 'python3'])

/**
 * The routed script a command RUNS: the program itself, or an operand of an interpreter (a code string included).
 * @param {string[]} words - one effective command.
 * @returns {string|undefined} the script's name.
 */
export function routedScript(words) {
  const program = basename(words[0] ?? '')
  return ROUTED_SCRIPTS.find(script => program === script || (RUNNERS.has(program) && words.slice(1).some(word => word.includes(script))))
}

/**
 * The refusal for a command that runs a routed script, or null.
 * @param {string[]} words - one effective command.
 * @returns {{rule: string, message: string}|null}
 */
export function routedRefusal(words) {
  const routed = routedScript(words)
  if (routed === undefined) return null
  if (routed === 'self-change.mjs') {
    return { rule: 'authority:self-change-direct', message: `running ${routed} yourself is not the route (a contained shell cannot `
      + `reach the signer, and a script you can edit is not the one Peter trusts). Use ${SELF_CHANGE_ROUTE}` }
  }
  return { rule: 'authority:owner-script', message: `running \`${routed}\` changes what the live app runs, an authority action `
    + 'agents do not take on their own. Ask Peter' }
}
