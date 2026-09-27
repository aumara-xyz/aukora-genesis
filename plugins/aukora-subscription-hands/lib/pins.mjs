/**
 * SUBSCRIPTION HANDS: THE PINS, IN ONE PLACE.
 *
 * The orchestrator runs on a cheap model. For real coding it calls Claude Code and Codex, which run on Peter's
 * SUBSCRIPTIONS rather than OpenRouter — Opus over OpenRouter cost about a dollar a minute, and a subscription
 * hand is the difference between delegating work and buying it by the minute.
 *
 * **THE HARNESS SHIPS BOTH ADAPTERS AND BOTH ARE UNSAFE BY DEFAULT, MEASURED IN THE VENDORED SOURCE:**
 *
 *   · `vendor/dsh/packages/subagent/subagent-codex/src/wire.ts:32-46` — `THREAD_PERMISSION_PARAMS.never` is
 *     `{ approvalPolicy: 'never' }` and carries **NO SANDBOX AT ALL**. A run in that mode therefore inherits
 *     whatever `~/.codex/config.toml` trusts, which is Peter's own machine-wide setting and not a decision this
 *     deployment made. The only mode that names `workspace-write` is `approve-for-me`, which also turns
 *     approvals ON (`on-request`); the only mode that names `never` alongside a sandbox names
 *     `danger-full-access`. **No single mode is "never + workspace-write", so the mode alone cannot express the
 *     pin** — it comes from an owned `CODEX_HOME` instead, below.
 *   · `vendor/dsh/packages/subagent/subagent-claude-code/src/run.ts:56` — `DEFAULT_CLAUDE_CODE_PERMISSION_MODE`
 *     is `'dontAsk'`.
 *
 * **THE ADAPTERS CANNOT CARRY EVERY PIN, AND SAYING SO IS PART OF THE DESIGN.** The adapters take `cwd` from
 * the PARENT SESSION (`resolveChildCwd(…, parentCwd)`), expose no tool allowlist and no added directory, and have
 * no lock and no wall-clock timeout. So the pins live here, in AUKORA-owned data, and a caller cannot override
 * them because a caller never supplies them: this module builds the argv and the environment, and the model only
 * ever supplies a TASK STRING.
 *
 * **WHAT NO CLI CAN ENFORCE IS PRINTED, NOT PROMISED.** See {@link CEILING}.
 *
 * @module pins
 */

import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** Where every hand runs. Under the checkout's `.runtime/`, which is already gitignored and already used. */
export const HANDS_ROOT = '.runtime/subscription-hands'

/** Each task gets its OWN fresh worktree here, named for the task. */
export const WORKTREES_ROOT = `${HANDS_ROOT}/worktrees`

/** Longer than any honest task, shorter than a person's patience. Enforced by the runner, not by the CLI. */
export const WALL_CLOCK_MS = 20 * 60_000

/**
 * PATHS NO HAND MAY READ, AND THE HONEST LIMIT OF THAT.
 *
 * `~/Library/Application Support/AUKORA` holds Peter's memory store, the launch record and the signer socket;
 * `~/aukora-private` holds what its name says. **Neither CLI has a flag that fences a directory off**, so this
 * is enforced by (a) never placing a hand inside them, (b) refusing a cwd beneath them, and (c) passing
 * `HOME`-relative config so the tools' own state does not land there. A determined child could still read them,
 * and {@link CEILING} says so in the words a person reads.
 */
export const FORBIDDEN_ROOTS = Object.freeze([
  join(homedir(), 'Library', 'Application Support', 'AUKORA'),
  join(homedir(), 'aukora-private'),
])

/**
 * The tool allowlist for Claude Code. Read/Edit/Write/Grep/Glob, plus Bash fenced to three commands.
 *
 * ── aura-83 (gap 6): `Bash(git:*)` AND `Bash(npx:*)` ARE GONE, AND THE COMMENT ABOVE IS NOW TRUE. ─────
 * **THE LINE ABOVE SAID "fenced to three commands" WHILE THE LIST CARRIED FIVE** *(`git`, `node`, `npm`,
 * `pnpm`, `npx`)* -- *so the comment described an intention the list did not implement, which is the same
 * shape as every false docstring in this goal.* **Dropping the two the egress audit names leaves EXACTLY
 * THREE, and the sentence becomes a description rather than an aspiration.**
 *
 * **WHY `git` GOES: a hand that can run arbitrary git can REWRITE THE HISTORY OF THE TREE IT IS EDITING** --
 * *`git checkout`, `git reset --hard`, `git stash`, `git clean` are all one command away*, *and this lane
 * has a standing rule against exactly those operations for precisely this reason.* **A coding hand needs to
 * EDIT FILES, not to move the repository underneath its own work.**
 *
 * **WHY `npx` GOES: IT FETCHES AND RUNS A PACKAGE FROM THE NETWORK**, *which is arbitrary code execution
 * that the owned `config.toml`'s `network_access = false` cannot stop* -- *because the fetch happens in the
 * CHILD process the allowlist is protecting, not in a sandboxed tool call.* *The file's own comment at the
 * deny list below already says "each of them can read any file the user can"; `npx` is worse than that, and
 * it is the one entry that also reaches OUT.*
 *
 * **`node`, `npm` AND `pnpm` STAY, DELIBERATELY.** *A hand asked to build or test a JavaScript tree needs
 * them to do the work at all*, **and gap 6's decision is to PIN the subagents rather than to turn them off**
 * -- *so the allowlist must remain sufficient for the job it exists to do.*
 */
export const CLAUDE_ALLOWED_TOOLS = Object.freeze([
  'Read', 'Edit', 'Write', 'Grep', 'Glob',
  'Bash(node:*)', 'Bash(npm:*)', 'Bash(pnpm:*)',
])

/**
 * The tools that can return file CONTENTS, and therefore have to be denied by path.
 *
 * `Read` alone was denied for two years' worth of this pin's life and it was never enough: **Grep returns matching
 * LINES and Glob can be asked to return file bodies**, so a deny that names only `Read` protects one of three.
 */
export const READ_TOOLS = Object.freeze(['Read', 'Grep', 'Glob'])

/**
 * The shell commands that read, named for a Bash deny rule.
 *
 * **THIS IS A PIN, NOT A FENCE.** Bash permission rules match the COMMAND, never its arguments, so no rule here can
 * say "not this path" — it can only say "not this program". `Bash(node:*)`, `Bash(git:*)` and `Bash(npx:*)` are
 * allowed for the hand to work at all, and each of them can read any file the user can. The list below closes the
 * obvious doors; the ceiling says plainly that the wall has none.
 */
export const BASH_READ_COMMANDS = Object.freeze([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'awk', 'sed', 'find', 'ls', 'cp', 'base64', 'xxd', 'od',
])

/** Claude Code's mode. `acceptEdits` — never `dontAsk` (the shipped default) and never `bypassPermissions`. */
export const CLAUDE_PERMISSION_MODE = 'acceptEdits'

/** The Claude Code modes this deployment refuses outright, so a config edit cannot quietly select one. */
export const CLAUDE_REFUSED_MODES = Object.freeze(['dontAsk', 'bypassPermissions', 'default'])

/** Codex's approval policy. Paired with a sandbox in the owned config, never sent alone. */
export const CODEX_APPROVAL_POLICY = 'never'

/** Codex's sandbox mode. `workspace-write` rooted at the worktree; nothing wider is ever sent. */
export const CODEX_SANDBOX_MODE = 'workspace-write'

/** Codex's network access inside the sandbox. Off, because a coding hand does not need the internet. */
export const CODEX_NETWORK_ACCESS = false
// ── aura-83 (gap 6): THE THREE OTHER CHANNELS, PINNED BESIDE THE NETWORK ONE. ─────────────────────────
// **`CODEX_NETWORK_ACCESS = false` ABOVE CLOSES THE SANDBOX'S OWN NETWORK.** *These three close the channels
// that do not go through the sandbox at all* -- **and each defaults to ON in a stock install**, *so "we do not
// set them" would have left three doors open beside the one this file locked.*
//
//   * `false` for analytics: *a hand that is supposed to be offline should not be reporting usage.*
//   * `'none'` for the OTEL exporter: **this is the channel that can carry the CONTENT of what a hand read**,
//     *not merely a count of calls*, which is why it is named rather than left to the environment.
//   * `false` for the update check: *a launch-time network request made BEFORE any policy the session sets*,
//     so no later pin can prevent it.
//
// **EACH IS A CONSTANT RATHER THAN A LITERAL IN THE TOML SO THE PIN IS FINDABLE** -- *a reader asking "what
// does this deployment forbid" reads four names here instead of parsing config bytes.*
export const CODEX_ANALYTICS_ENABLED = false
export const CODEX_OTEL_EXPORTER = 'none'
export const CODEX_UPDATE_CHECK = false

/** Whether a path is inside a forbidden root. Used to refuse a task before anything is spawned. */
export function isForbidden(candidate) {
  const full = resolve(candidate)
  return FORBIDDEN_ROOTS.some(root => full === resolve(root) || full.startsWith(resolve(root) + sep))
}

/** Refuse a working directory that is a forbidden root, or the shared checkout itself. */
export function assertHandCwd(cwd, sharedCheckout) {
  if (isForbidden(cwd)) {
    throw new Error(`subscription-hands: refusing to run a hand inside ${cwd} — that path is not a hand's to read`)
  }
  if (resolve(cwd) === resolve(sharedCheckout)) {
    throw new Error(
      'subscription-hands: refusing to run a hand in the SHARED CHECKOUT. Every task runs in its own fresh '
      + 'worktree, so that a hand cannot commit into, reset or dirty the tree this session is working in.',
    )
  }
}

/**
 * The owned `CODEX_HOME/config.toml`.
 *
 * **THIS IS THE FILE THAT MAKES "never + workspace-write" EXIST**, because no `permissionMode` in the adapter
 * expresses it. Codex reads this instead of `~/.codex/config.toml`, so the trust decision is this deployment's
 * rather than whatever Peter's machine-wide file happens to say.
 *
 * @returns the config bytes.
 */
export function codexConfigToml() {
  return [
    '# AUKORA subscription hands — OWNED, DO NOT EDIT BY HAND.',
    '# Codex reads THIS file instead of ~/.codex/config.toml because the adapter is launched with',
    '# CODEX_HOME pointing here. The point is that "never approve, and write only inside the worktree"',
    '# is expressible here and is NOT expressible as a single adapter permissionMode.',
    `approval_policy = "${CODEX_APPROVAL_POLICY}"`,
    `sandbox_mode = "${CODEX_SANDBOX_MODE}"`,
    '',
    '[sandbox_workspace_write]',
    `network_access = ${String(CODEX_NETWORK_ACCESS)}`,
    // ── aura-83 (gap 6): THE THREE KEYS THE EGRESS AUDIT NAMES, AND WHY EACH IS AN EGRESS PIN. ────────
    // **THE AUDIT ASKED FOR "analytics off, otel off, no update check" IN THE OWNED `config.toml`, AND THE
    // REASON THEY BELONG IN A PIN FILE IS THAT EACH ONE IS A CHANNEL OUT OF THE MACHINE:**
    //   * an ANALYTICS toggle that defaults to on sends usage from a hand that is supposed to be offline;
    //   * an OTEL exporter that defaults to on ships traces to whatever endpoint the machine's environment
    //     names -- *and it is the channel that can carry the CONTENT of what a hand read;*
    //   * an UPDATE CHECK is a network request on every launch, made before any policy the session sets.
    // **ALL THREE DEFAULT TO ON IN A STOCK INSTALL**, *which is why "we do not set them" is not the same as
    // "they are off"* -- *and why leaving them out of an OWNED config would make this file's other pins
    // weaker than they read.*
    //
    // **THE TOML IS WRITTEN AS SEPARATE TABLES RATHER THAN ONE, BECAUSE THAT IS HOW CODEX READS THEM**, *and
    // each value comes from a named constant so a reader finds the PIN rather than hunting a literal.*
    '[analytics]',
    `enabled = ${String(CODEX_ANALYTICS_ENABLED)}`,
    '',
    '[otel]',
    `exporter = "${CODEX_OTEL_EXPORTER}"`,
    '',
    `check_for_update_on_startup = ${String(CODEX_UPDATE_CHECK)}`,
    '',
  ].join('\n')
}

/**
 * The owned Claude Code `settings.json`.
 *
 * The adapter sets `disallowedTools` on its own and never sets an allowlist, so the allowlist is expressed here
 * instead — as the CLI's own permission rules, which is where a person would look for them.
 *
 * @param worktree - the one directory this hand may touch beyond its own cwd.
 * @returns the settings bytes.
 */
export function claudeSettingsJson(worktree) {
  return JSON.stringify({
    $comment: 'AUKORA subscription hands — OWNED. The adapter never sets allowedTools; this file does.',
    permissions: {
      allow: [...CLAUDE_ALLOWED_TOOLS],
      additionalDirectories: [worktree],
      // **ALL FOUR DOORS, NOT JUST `Read`.** The deny listed `Read` alone, so Grep and Glob — which return file
      // CONTENTS, not just names — and Bash, which is a general read capability, were all still open on the two
      // roots this pin exists to protect. A deny that names one door reads as a boundary while three stand open.
      deny: [
        ...READ_TOOLS.flatMap(tool => FORBIDDEN_ROOTS.map(root => `${tool}(${root}/**)`)),
        // **BASH CANNOT BE FENCED BY PATH, SO THE READ COMMANDS ARE NAMED.** A permission rule for Bash matches the
        // COMMAND, not its arguments, so there is no `Bash(<path>)` that would mean anything; naming the commands
        // that read is the closest a string rule gets. `Bash(node:*)` remains allowed and a hand can read anything
        // `node` can — **which is why this is a pin and not an isolation, and why the ceiling says so.**
        ...BASH_READ_COMMANDS.map(command => `Bash(${command}:*)`),
        'Read(./.env)',
      ],
    },
  }, null, 2) + '\n'
}

/**
 * WHAT THIS DOES NOT DO.
 *
 * Printed wherever a person reads about these hands, because a ceiling that is only in a comment is a ceiling
 * nobody hits until it matters.
 */
export const CEILING = Object.freeze([
  'A hand is NOT a sandbox and this is NOT isolation.',
  'Neither CLI can be fenced off from a directory it can read, so ~/Library/Application Support/AUKORA and',
  '~/aukora-private are protected by never running a hand inside them, by refusing such a cwd, and by the',
  "tools' own config living elsewhere — NOT by a kernel boundary. A determined child could still read them.",
  'Both hands run as this user, with this user\'s subscription credentials.',
  'The worktree keeps a hand out of the SHARED CHECKOUT; it does not keep it out of the machine.',
  // **THE CLAUDE BASH TAIL, SAID WHERE A PERSON READS IT.**
  'Claude Code denies Read, Grep and Glob on both protected roots by path. Its BASH deny can only name COMMANDS,',
  'never arguments or paths: the obvious read commands are denied, while `Bash(node:*)`, `Bash(git:*)`,',
  '`Bash(npm:*)`, `Bash(pnpm:*)` and `Bash(npx:*)` stay allowed so a hand can work at all — and every one of them',
  'can read any file this user can. The deny raises the cost of an accidental read; it does not prevent a deliberate one.',
  // **THE TOOL-RESTRICTION GAP, NAMED WHERE THE NEXT READER WILL HIT IT (Codex sweep, finding 10), AND IT IS
  // CODEX-ONLY.** The paragraph above about denied paths applies to CLAUDE CODE; a reader must not carry it over.
  'THE TWO HANDS DO NOT HAVE THE SAME KIND OF TOOL PIN, AND CODEX HAS NO TOOL ALLOWLIST AT ALL.',
  'Codex is NOT covered by the Read/Grep/Glob deny above. That pin is Claude Code settings; Codex reads its own',
  'config.toml, which has no per-path read deny, and this runner does not add one.',
  'Claude Code is confined by `--allowedTools`, which names the tools it may use.',
  'Codex has no equivalent: its argv pins approval, sandbox and network, and its tool surface is governed by the',
  'SANDBOX plus a handful of tools.* config keys. So the file and shell reach of a Codex hand is limited by',
  '`sandbox_mode = "workspace-write"` and its network by `network_access = false` — NOT by a list of permitted',
  'tools, and there is no list to add. A `tools.web_search` key is plausible and is DELIBERATELY NOT SET: it could',
  'not be verified without running the real subscription CLI, and a pin nobody has confirmed takes effect is worse',
  'than a gap somebody has named.',
])
