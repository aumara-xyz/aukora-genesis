/**
 * THE DECISION: one tool call in, one verdict out — `{decision, rule, message}`.
 *
 * A THIN ADAPTER OVER THE VENDORED SEED GUARD. Every question about a PATH is answered by aukora-seed's guard at
 * 9fca7a0, vendored byte for byte in `vendor/seed/` (PROVENANCE.json): `analyse` resolves a path in both
 * its lexical and its real form and folds it (paths.mjs), `compileAll`/`judge` match the folded keys against a law's
 * patterns (law.mjs), and `decide` gives the full write verdict — repository root, the guard's own code, outside the
 * root, protected, hard links (guard.mjs). This file only decides WHICH law to ask about WHICH path for WHICH tool,
 * and maps the guard's verdict to this deployment's rule names. It does not resolve, fold or match a path itself.
 *
 * The laws it asks (patterns in the seed's own glob language):
 *   key material and credentials   refused for READ and WRITE (root `/`, so a copy of the support folder is still keys)
 *   governing code                 refused for WRITE in the repository and the running release: an AUTHORITY action,
 *                                  with the aukora_self_change tool named as the route
 *   governing config and receipts  refused for WRITE (the live patches, the harness profiles, both Aura logs)
 *   .git internals                 refused for WRITE anywhere (refs, hooks and config move through git itself)
 *   write roots                    a write must land inside the session workspace, the repository or a configured root
 *   CORE rows                      refused for READ by a CORE session (the rows aukora-core-read-deny carried)
 *
 * What a shell or code string SAYS (git to main, the keychain, publishing, spending, hosts) is read by shell.mjs; the
 * seed guard does not inspect shell text (it records Bash as unguarded), so that part is this gate's own.
 *
 * @module @aukora/dsh-plugin-action-gate/policy
 */
import { basename, isAbsolute, join, resolve } from 'node:path'

import { REASON, decide } from '../../../vendor/seed/src/guard.mjs'
import { compileAll, judge } from '../../../vendor/seed/src/law.mjs'
import { analyse, realpathish } from '../../../vendor/seed/src/paths.mjs'
import { SELF_CHANGE_ROUTE, routedRefusal } from './routes.mjs'
import { authorityRefusal, credentialRefusal, effectiveShellCommands, gitMainRefusal, hostsNamed, literalPath, literalWriteTargets, shellCommands } from './shell.mjs'
import { decidePartialFailure } from '../../aukora-kira/lib/partial-failure.mjs'

/** Key material and credentials, as seed-guard patterns rooted at `/`: `**` + `/` finds them at any depth. */
export const KEY_PATTERNS = Object.freeze([
  ['**/state/aumlok', 'aumlok-state', "the Aumlok controller state, whose machine seed signs the owner's approvals"],
  ['**/machine-seed*.json', 'machine-seed', 'an Aumlok machine seed'],
  ['**/aumlok-signer.sock', 'signer-socket', "the Aumlok signer's socket"],
  ['**/.aukora/signer', 'aumlok-signer', "the Aumlok signer's key directory"],
  ['**/kira-memory/issuer.json', 'kira-issuer', "the Kira memory issuer's key"],
  ['**/kira-memory/keys', 'kira-keys', 'the Kira keys'],
  ['**/kira-memory/key', 'kira-key', 'the Kira key'],
  ['**/openviking/root.key', 'openviking-root-key', "OpenViking's root API key, which opens every account's memory"],
  ['**/.config/gh', 'gh-config', "the GitHub CLI's stored token"],
  ['**/.git-credentials', 'git-credentials', "git's stored credentials"],
  ['**/.netrc', 'netrc', 'stored network credentials'],
  ['**/.ssh', 'ssh', "the owner's SSH keys"],
  ['**/.gnupg', 'gnupg', "the owner's GPG keys"],
  ['**/.aws', 'aws', 'cloud credentials'],
  ['**/library/keychains', 'keychains', 'the macOS keychains'],
])

/** The same material spelled in command text. Folded to lowercase; a tripwire on the plain spelling, nothing more. */
export const KEY_MENTIONS = Object.freeze([
  'state/aumlok', 'machine-seed', '.aukora/signer', 'kira-memory/issuer', 'kira-memory/key', 'openviking/root.key', '.config/gh',
  '.git-credentials', '.ssh/id_', 'library/keychains', 'aumlok-signer.sock', '.netrc',
])

/** The rows `aukora-core-read-deny` refused to a CORE session, carried so this gate supersedes that `fs` swap. */
export const CORE_PATTERNS = Object.freeze([
  '**/state/launch.json', '**/state/lane-door', '**/state/eye', '**/gate-state', '**/kira-approve-queue',
  '**/owner-console', '**/*.sock',
])
const CORE_MENTIONS = Object.freeze(['state/launch.json', 'state/lane-door', 'state/eye', 'gate-state', 'kira-approve-queue', 'owner-console', '.sock'])

/** Governing code, relative to a governing root (the repository, the running release). Writing it is self-modification. */
export const GOVERNING_PATTERNS = Object.freeze([
  'plugins/**', 'apps/**', 'packages/**', 'vendor/**', 'presets/**', 'overlays/**',
  'scripts/aukora/**', 'scripts/aumlok/**', 'scripts/materialize-aukora-release.py', 'scripts/launch-dsh.py',
  'scripts/build-dsh.py', 'docs/owner-pin.json', 'AGENTS.md', 'CLAUDE.md', 'upstream-dsh.json', '.github/**',
  '*.patch.yml', '.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/**',
])

/** Default hosts a call may name. `.example.com` also admits subdomains. */
export const DEFAULT_NETWORK_ALLOW = Object.freeze([
  'github.com', '.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'codeload.github.com',
  'registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org', 'api.deepseek.com',
])
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/** Tool names that spend or publish, for tools this gate has no specific model of (an MCP bridge, say). */
const SPEND_NAME = /(^|[_-])(buy|purchase|pay|payment|checkout|transfer|withdraw|deposit|trade|spend|top_?up)([_-]|$)/iu
const PUBLISH_NAME = /(^|[_-])(publish|deploy|merge)([_-]|$)/iu
const WRITE_NAME = /(^|[^a-z0-9])(write|edit|create|delete|move|put|save|patch|append|replace)([^a-z0-9]|$)/iu

/** Effects whose execution is unsafe when the latest memory picture is partial or unverified. */
export const CONSEQUENTIAL_TOOL_NAMES = Object.freeze([
  'workspace.patch', 'kira_settle', 'commit', 'raise', 'door_send', 'become',
])

/** Apply the shared Phase 9 policy at the last gate before a consequential tool body. */
export function consequentialPartialFailureDecision(tool, state) {
  if (!CONSEQUENTIAL_TOOL_NAMES.includes(String(tool))) return null
  return decidePartialFailure(state ?? {})
}

// Compile these existing allow outcomes for the kernel. New classes/outcomes need explicit rules.
export const KERNEL_ALLOWS = Object.freeze([
  ['read', 'observe', ['allow:ok']],
  ['write', 'local-write', ['allow:ok', 'allow:approved', 'allow:approved-checked', 'allow:workspace-proposal']],
  ['exec', 'external', ['allow:ok']],
  ['network', 'external', ['allow:ok', 'allow:non-network-uri', 'allow:search-provider']],
  // `allow:workspace-proposal` IS RETURNED BY THIS FILE AND WAS NOT COMPILED HERE. `judge` below returns it
  // for `aukora_workspace_patch` (see the closed-path branch), the kernel compiled only the two outcomes
  // above for a tool call, so the kernel's own `decide` answered `policy_no_match` and every call to the
  // confined worker was refused with "no kernel permission for this call" — while the tool was built,
  // mounted, and named in the deployment's `allowTools`. Two halves of one gate disagreed on a label.
  // Measured 2026-09-30 on the live release: `aukora_workspace_patch` refused `kernel:policy_no_match`.
  // The rule stays narrow: it permits the workspace-proposal class and nothing else.
  // The name lives on both the write and tool rows because `aukora_workspace_patch` classifies as a write.
  // Putting it only on the tool row caused the refusal.
  ['tool', 'external', ['allow:approved', 'allow:approved-checked', 'allow:workspace-proposal']],
])

function actionClass(tool, args) {
  if (['cordis_define', 'cordis_run'].includes(tool)) return 'live-code'
  if (tool === 'str_replace_editor') return args?.command === 'view' ? 'read' : 'write'
  if (['read', 'read_image', 'present', 'grep', 'glob'].includes(tool)) return 'read'
  if (['bash', 'run_code', 'terminal_open', 'terminal_send'].includes(tool)) return 'exec'
  if (['web_fetch', 'web_search'].includes(tool)) return 'network'
  return WRITE_NAME.test(tool.replace(/([a-z0-9])([A-Z])/gu, '$1_$2')) ? 'write' : 'tool'
}

/** Argument keys read as paths, and as network destinations, on tools the gate has no specific model of. */
const PATH_KEYS = /^(file_?paths?|paths?|target|source|destination|src|dest|dst|from|to|cwd|workdir|dir|directory|file|filename|notebook_path|(?:source|destination|target|src|dest|dst)[_-]?(?:path|file|dir))$/iu
const URL_KEYS = /^(url|uri|href|endpoint)$/iu

/** One law: a root and the seed-compiled rules for it. */
const law = (root, patterns) => ({ root, rules: compileAll(patterns) })

/**
 * Whether `law` protects the absolute path `abs`: the seed guard's `analyse` then `judge`, exactly the sequence its
 * `decide` runs for a path inside the root, without the write-only checks (root, own code, hard links) that a READ
 * must not trip on.
 * @returns {{rule: string}|{unresolvable: string}|null}
 */
function protectedBy({ root, rules }, abs) {
  const a = analyse(root, abs)
  if (!a.ok) return { unresolvable: a.reason }
  if (a.outside) return null
  const v = judge(rules, a.keys)
  return v.protected ? { rule: v.rule } : null
}

/** The seed guard's full WRITE verdict for `abs` against one root and law. */
function writeVerdict(root, abs, patterns, writesOutsideRepo) {
  return decide({
    repoRoot: root, toolName: 'Write', toolInput: { file_path: abs },
    law: { writesOutsideRepo }, rules: compileAll(patterns),
  })[0]
}

/** String literals in a piece of code, so `execSync('git push origin main')` is read as the command it carries. */
function stringLiterals(code) {
  const out = []
  for (const m of String(code).matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gu)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/** Walk an argument object for path-like and URL-like strings (depth-limited). */
/** Schemes that name no host on a network. Every other scheme (http:, postgres:, tcp:, one never seen…) is judged by its host. */
const NON_NETWORK_SCHEMES = new Set(['viking:', 'data:', 'urn:'])

function looseTargets(args) {
  const paths = []
  const urls = []
  const walk = (value, key, depth) => {
    if (depth > 4 || value === null || value === undefined) return
    if (typeof value === 'string') {
      if (PATH_KEYS.test(key)) paths.push(value)
      if (URL_KEYS.test(key)) urls.push(value)
      return
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, key, depth + 1); return }
    if (typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1)
  }
  walk(args, '', 0)
  return { paths, urls }
}

/**
 * THE TOOLS THIS DEPLOYMENT APPROVES (issue #26). A name in the switch below is known to the harness itself; every
 * OTHER name must appear here, exactly or by a trailing-`*` family, or the call is refused with
 * `authority:tool-not-approved` and the self-change route named. Written from the live action chain
 * (`state/home/aura-actions/aura.jsonl`) plus the families: what the agent is observed to use, not what it might.
 */
export const DEFAULT_ALLOW_TOOLS = Object.freeze([
  'present', 'read_image', 'str_replace_editor', 'glob', 'skill', 'todo_write', 'ask_user_question', 'workflow',
  'aura_association', 'send_message', 'interrupt_agent', 'list_agents', 'exit_plan_mode',
  'get_goal', 'create_goal', 'update_goal', 'read_mcp_resource',
  'memory.put', 'kira_*', 'mcp__viking__*', 'mcp__kira-memory__*', 'cordis_inspect_*', 'subagent*', 'session_*', 'job_*', 'list_*',
  // The trusted host tool this plugin registers (self-change-tool.mjs): the one route a contained agent has to its own code.
  'aukora_self_change',
  'aukora_workspace_patch',
])

/**
 * Build the policy for one deployment.
 * @param {object} settings - validated settings (see `index.mjs`).
 * @returns {{judge: (call: object) => {decision: 'allow'|'deny', rule: string, message: string|null}}}
 */
export function createPolicy(settings, { definitionOf = null, partialFailureOf = () => undefined } = {}) {
  const { home, supportRoot, dshHome, auraDir, repoRoots, releaseRoots, extraWritableRoots, networkAllow, allowLoopback, mainBranch } = settings
  const governingRoots = [...new Set([...repoRoots, ...releaseRoots])]
  const keyLaw = { root: '/', rules: compileAll(KEY_PATTERNS.map(([pattern]) => pattern)) }
  const keyById = new Map(KEY_PATTERNS.map(([pattern, id, why]) => [pattern, { id, why }]))
  const anchoredKeyLaws = [
    { law: law(supportRoot, ['**/*.sock']), id: 'support-socket', why: "a live door into one of the owner's processes" },
    { law: law(home, ['.npmrc', '.pypirc']), id: 'registry-token', why: 'a stored registry token' },
  ]
  const coreLaw = law('/', CORE_PATTERNS)
  const gitLaw = law('/', ['**/.git'])
  const configLaws = [
    { law: law(supportRoot, ['*.patch.yml', 'config.json', 'state/launch.json']), id: 'live-config' },
    { law: law(dshHome, ['profiles', 'aura-code']), id: 'harness-profiles-or-code-receipts' },
    { law: law(auraDir, ['**']), id: 'action-receipts' },
  ]
  // Where a recursive CONTENT search must not reach, anchored where this deployment keeps it.
  const anchoredKeys = [
    join(supportRoot, 'state', 'aumlok'), join(home, '.aukora', 'signer'), join(dshHome, 'kira-memory'), join(dshHome, 'openviking', 'root.key'),
    join(home, '.config', 'gh'), join(home, '.git-credentials'), join(home, '.ssh'), join(home, '.gnupg'),
    join(home, '.aws'), join(home, 'Library', 'Keychains'), join(home, '.netrc'),
  ]

  const deny = (rule, message) => ({ decision: 'deny', rule, message: `AUKORA action gate refused this call [${rule}]: ${message}` })
  const allow = (rule = 'allow:ok') => ({ decision: 'allow', rule, message: null })

  // ── THE APPROVED TOOLS, AND THE DEFINITION EACH NAME IS PINNED TO (#26). ────────────────────────────────────────
  // The declared list is the only source of names for tools the switch does not know. A name ending in `*` is a
  // family. ON THE FIRST ALLOWED CALL the tool's registered definition is pinned; a later call whose definition is
  // NOT that same object is refused, so a package that re-registers an approved name after startup cannot inherit
  // its approval. `definitionOf` is the harness runtime's own lookup (`ctx.tools.get(name, agent)`); when a
  // deployment cannot supply it, the name check still applies and pinning is skipped rather than faked.
  const declared = Array.isArray(settings.allowTools) && settings.allowTools.length > 0
    ? settings.allowTools
    : DEFAULT_ALLOW_TOOLS
  const allowExact = new Set([...declared.filter(n => !n.endsWith('*')), 'memory.put'])
  const allowFamily = declared.filter(n => n.endsWith('*')).map(n => n.slice(0, -1))
  const pinned = new Map()
  const approvedName = tool => allowExact.has(tool) || allowFamily.some(prefix => tool.startsWith(prefix))
  function pinnedVerdict(tool, call) {
    if (definitionOf === null) return null
    let definition
    try { definition = definitionOf(tool, call.agent) } catch { return null }
    if (definition === undefined || definition === null) return null
    const held = pinned.get(tool)
    if (held === undefined) { pinned.set(tool, definition); return null }
    if (held === definition) return null
    return deny('authority:tool-redefined', `the tool ${tool} is not the definition this deployment approved: its ` +
      'registered definition changed after startup, so the approval does not carry. Propose it with ' +
      'the aukora_self_change tool')
  }

  /** Whether the reading session is (or may be) CORE. Asked only when a CORE row matched. */
  function isCore(call) {
    let preset
    try { preset = call.presetOf?.() } catch { preset = { reader: 'unknown' } }
    if (preset === undefined || preset === null) return false
    return typeof preset === 'string' ? preset === 'core' : true
  }

  /** The absolute spellings of one declared path: against the workspace, `~`-expanded, and symlink-resolved. */
  function candidates(raw, call) {
    if (typeof raw !== 'string' || raw === '' || raw.includes('\0')) return null
    const base = call.workspace ?? settings.defaultWorkspace
    const out = new Set([isAbsolute(raw) ? resolve(raw) : resolve(base, raw)])
    if (raw === '~' || raw.startsWith('~/')) out.add(resolve(home, raw.slice(2)))
    for (const form of [...out]) out.add(realpathish(form))
    return [...out]
  }

  /** Judge one declared path for an operation kind: read, list, search, dir or write. */
  function judgePath(raw, kind, call) {
    // The shell's conventional discard sink is a device, not a filesystem write root.
    if (kind === 'write' && raw === '/dev/null') { call.targets?.add(raw); return allow('allow:null-device') }
    const forms = candidates(raw, call)
    if (forms === null) return deny('path:unresolvable', 'the path is not a usable string; a path the gate cannot reason about is a path it does not allow')
    for (const form of forms) call.targets?.add(form)
    for (const abs of forms) {
      const key = protectedBy(keyLaw, abs)
      if (key?.unresolvable) return deny('path:unresolvable', `${key.unresolvable} (seed guard)`)
      if (key !== null) {
        const { id, why } = keyById.get(key.rule)
        return deny(`key-material:${id}`, `${raw} is ${why} (seed guard rule "${key.rule}"). Agents never read or write key material or credentials; if a task needs it, ask Peter`)
      }
      for (const anchored of anchoredKeyLaws) {
        if (protectedBy(anchored.law, abs)?.rule !== undefined) return deny(`key-material:${anchored.id}`, `${raw} is ${anchored.why}. Agents never read or write it`)
      }
      if (kind !== 'write' && protectedBy(coreLaw, abs)?.rule !== undefined && isCore(call)) {
        return deny('core-read', `${raw} is withheld from a CORE session (the rows aukora-core-read-deny carried)`)
      }
    }
    if (kind === 'search') {
      // A recursive CONTENT search rooted above key material reaches it: asked as "is the key inside this root?".
      const reached = anchoredKeys.find(keyPath => forms.some(root => { const a = analyse(root, keyPath); return a.ok && !a.outside }))
      if (reached !== undefined) return deny('key-material:search-root', `a content search rooted at ${raw} reaches ${reached}. Pass a narrower path that does not contain key material`)
    }
    if (kind !== 'write') return allow()

    for (const abs of forms) {
      if (protectedBy(gitLaw, abs)?.rule !== undefined) {
        return deny('git:internals', `${raw} is inside a .git directory (refs, hooks and config). Change git state with git commands; refs/heads/${mainBranch} moves only through scripts/aukora/self-change.mjs`)
      }
      for (const root of governingRoots) {
        const v = writeVerdict(root, abs, GOVERNING_PATTERNS, 'receipt')
        if (v.verdict !== 'refused') continue
        if (v.reasonClass === REASON.PROTECTED || v.reasonClass === REASON.SELF) {
          const where = v.reasonClass === REASON.SELF ? 'the gate\'s own judge (vendor/seed)' : `governing code in ${root}`
          return deny('authority:governing-code', `${raw} is ${where} (seed guard: ${v.reasonClass}${v.rule ? `, rule "${v.rule}"` : ''}). `
            + `Changing it is self-modification, an authority action. Use ${SELF_CHANGE_ROUTE}; it lands only if he approves`)
        }
        return deny(`write:${v.reasonClass}`, `${v.message} (seed guard)`)
      }
      for (const config of configLaws) {
        if (protectedBy(config.law, abs)?.rule !== undefined) {
          return deny('authority:governing-config', `${raw} is governing configuration or receipts (${config.id}); agents do not change it. Ask Peter`)
        }
      }
    }
    // WRITE ROOTS: the seed guard's `decide` with `writesOutsideRepo: 'refuse'` for each root. Every resolved spelling
    // of the path (a `~` the backend may expand included) must land inside some root.
    const workspace = typeof call.workspace === 'string' && call.workspace !== '' ? [call.workspace] : []
    const roots = [...workspace, ...repoRoots, ...extraWritableRoots]
    for (const landing of new Set(forms.map(form => realpathish(form)))) {
      const verdicts = roots.map(root => writeVerdict(root, landing, [], 'refuse'))
      if (verdicts.some(v => v.verdict === 'allowed')) continue
      const inside = verdicts.find(v => v.reasonClass !== REASON.OUTSIDE)
      if (inside !== undefined) return deny(`write:${inside.reasonClass}`, `${inside.message} (seed guard)`)
      return deny('write:outside-workspace', `${raw} resolves outside the session workspace${call.workspace ? ` (${call.workspace})` : ''} and the repository `
        + `(seed guard: ${REASON.OUTSIDE}). Agents write only inside those`)
    }
    return allow()
  }

  /** Judge one host a call names. */
  function judgeHost(host, call) {
    const h = String(host).toLowerCase().replace(/\.$/u, '')
    call.targets?.add(h)
    if (allowLoopback && LOOPBACK.has(h)) return null
    const ok = networkAllow.some(entry => {
      const e = entry.toLowerCase()
      return e.startsWith('.') ? h === e.slice(1) || h.endsWith(e) : h === e
    })
    return ok ? null : deny('network:host-not-allowed', `${h} is not on this deployment's network allowlist`)
  }
  function judgeUrl(url, call) {
    let parsed
    try { parsed = new URL(String(url)) } catch {
      return deny('network:unparseable-url', 'the URL could not be parsed, so its host could not be checked')
    }
    // AN ADDRESS IN A SCHEME THAT IS NOT A NETWORK IS NOT A HOST (2026-09-27): OpenViking's `viking://user/owner/…` URIs were
    // read as the host `user` and every memory write and forget was refused. Only the named local schemes pass: an unknown
    // scheme (postgres://host, tcp://host) is still judged by its host, as before.
    if (NON_NETWORK_SCHEMES.has(parsed.protocol)) return allow('allow:non-network-uri')
    return judgeHost(parsed.hostname.replace(/^\[|\]$/gu, ''), call)
  }

  /** Judge a shell or code string: what it names, command by command. */
  function judgeText(text, workdir, call, { code = false } = {}) {
    const folded = String(text).normalize('NFC').toLowerCase()
    const mention = KEY_MENTIONS.find(m => folded.includes(m))
    if (mention !== undefined) return deny('key-material:mentioned', `the command names ${mention}, which is key material or a credential. Agents never read or write it`)
    if (CORE_MENTIONS.some(m => folded.includes(m)) && isCore(call)) return deny('core-read:mentioned', 'the command names a location withheld from a CORE session')
    const texts = code ? [text, ...stringLiterals(text)] : [text]
    for (const source of texts) {
      let dir = workdir
      for (const command of shellCommands(source).flatMap(effectiveShellCommands)) {
        const { words } = command
        const program = basename(words[0] ?? '')
        for (const target of literalWriteTargets(command, dir, home)) {
          const verdict = judgePath(target, 'write', call)
          if (verdict.decision === 'deny') return verdict
        }
        if (program === 'cd' || program === 'pushd') {
          // `cd` changes the directory the next git in this text runs in, so it is followed; an unknown one stays unknown.
          const target = words.find((w, i) => i > 0 && !w.startsWith('-'))
          if (target === undefined) dir = home
          else dir = literalPath(target, dir, home) ?? undefined
          continue
        }
        const refusal = routedRefusal(words) ?? credentialRefusal(words) ?? authorityRefusal(words) ?? (program === 'git' ? gitMainRefusal(words, dir, mainBranch, home) : null)
        if (refusal !== null) return deny(refusal.rule, refusal.message)
      }
    }
    for (const host of hostsNamed(text)) {
      const refused = judgeHost(host, call)
      if (refused !== null) return refused
    }
    return null
  }

  /**
   * THE VERDICT for one tool call.
   * @param {{tool: string, args: unknown, workspace?: string, presetOf?: () => unknown}} call
   * @returns {{decision: 'allow'|'deny', rule: string, message: string|null}}
   */
  function judgeCall(call) {
    const args = call.args !== null && typeof call.args === 'object' ? call.args : {}
    const tool = String(call.tool)
    const first = (...verdicts) => verdicts.find(v => v !== null && v !== undefined && v.decision === 'deny') ?? null
    // The state comes from Kira's in-process ledger, never from model-written effect arguments. A missing
    // or malformed handoff becomes outer=undetermined and therefore STOPs by the shared policy.
    if (CONSEQUENTIAL_TOOL_NAMES.includes(tool)) {
      let state
      try { state = partialFailureOf(call) } catch { state = undefined }
      const partial = consequentialPartialFailureDecision(tool, state)
      if (partial.action !== 'proceed') {
        const duty = partial.action === 'ask' ? 'ASK the owner before this effect' : 'STOP: memory must be verified before this effect'
        return deny(`memory:partial-failure:${partial.action}`, `${duty}; ${partial.reason}`)
      }
    }
    const paths = (list, kind) => first(...list.filter(p => p !== undefined).map(p => judgePath(p, kind, call)))

    const switched = (() => {
    switch (tool) {
      // ── LIVE CODE LOADS WITH NO APPROVAL, SO IT IS REFUSED BY NAME (#26, live tier). ──────────────────────────
      case 'cordis_define':
      case 'cordis_run':
        return deny('authority:live-code', `the tool ${tool} loads code into the running harness with no approval; ` +
          'propose it with the aukora_self_change tool')
      case 'read':
      case 'read_image':
        return paths([args.file_path], 'read') ?? allow()
      case 'present':
        return paths((Array.isArray(args.files) ? args.files : []).map(f => f?.path), 'read') ?? allow()
      case 'write':
      case 'edit':
        return paths([args.file_path], 'write') ?? allow()
      case 'str_replace_editor':
        return paths([args.path], args.command === 'view' ? 'read' : 'write') ?? allow()
      case 'grep':
        return paths([args.path ?? call.workspace ?? settings.defaultWorkspace], 'search') ?? allow()
      case 'glob':
        return paths([args.path ?? call.workspace ?? settings.defaultWorkspace], 'list') ?? allow()
      case 'bash': {
        const workdir = typeof args.workdir === 'string'
          ? (isAbsolute(args.workdir) ? args.workdir : resolve(call.workspace ?? settings.defaultWorkspace, args.workdir))
          : call.workspace ?? settings.defaultWorkspace
        return paths([args.workdir], 'dir') ?? judgeText(args.command ?? '', workdir, call) ?? allow()
      }
      case 'terminal_open':
        return paths([args.cwd], 'dir') ?? allow()
      case 'terminal_send':
        // The terminal's current directory is not in the call, so a `git push` without a refspec is unresolved here.
        return judgeText(args.text ?? '', undefined, call) ?? allow()
      case 'run_code':
        return judgeText(args.code ?? '', call.workspace, call, { code: true }) ?? allow()
      case 'web_fetch':
        return judgeUrl(args.url, call) ?? allow()
      case 'web_search':
        return allow('allow:search-provider')
      default: {
        if (SPEND_NAME.test(tool)) return deny('authority:spend', `the tool ${tool} spends or moves money, an authority action. Ask Peter`)
        if (PUBLISH_NAME.test(tool)) return deny('authority:publish', `the tool ${tool} publishes, an authority action. Ask Peter`)
        // AN UNKNOWN NAME IS NOT AN APPROVED ONE. Before this, every name the switch did not know was allowed
        // outright (`allow:unclassified`), which is how a dynamically registered package's tool ran unchecked.
        if (!approvedName(tool)) {
          return deny('authority:tool-not-approved', `the tool ${tool} is not one this deployment approved. A tool ` +
            'registered by a dynamic package is refused here; propose it with the aukora_self_change tool, ' +
            'approved in the AUKORA popup')
        }
        const stale = pinnedVerdict(tool, call)
        if (stale !== null) return stale
        // This tool's closed path is relative to its owner-configured broker root,
        // not the agent's cwd. Its signed review names the full absolute target.
        if (tool === 'aukora_workspace_patch') return allow('allow:workspace-proposal')
        const loose = looseTargets(args)
        const kind = WRITE_NAME.test(tool.replace(/([a-z0-9])([A-Z])/gu, '$1_$2')) ? 'write' : 'read'
        const refused = first(...loose.paths.map(p => judgePath(p, kind, call)), ...loose.urls.map(url => judgeUrl(url, call)))
        if (refused !== null) return refused
        return allow(loose.paths.length + loose.urls.length > 0 ? 'allow:approved-checked' : 'allow:approved')
      }
    }
    })()
    // ── THE PIN COVERS THE SWITCH-KNOWN NAMES TOO (#26, follow-up). ──────────────────────────────────────────────
    // `read`, `write`, `bash` and the rest were judged and returned BEFORE the allowlist branch ever ran, so a
    // package that re-registered one of those names was never pinned and kept the approval its name carried. Now
    // every allow verdict passes the pin, whichever branch produced it.
    if (switched.decision === 'allow') {
      const redefined = pinnedVerdict(tool, call)
      if (redefined !== null) return redefined
    }
    return switched
  }

  function classify(call) {
    const targets = new Set()
    const { rule, message } = judgeCall({ ...call, targets })
    return { kind: actionClass(String(call.tool), call.args), rule, message,
      targets: targets.size === 0 ? [`tool:${String(call.tool)}`] : [...targets].sort() }
  }

  return Object.freeze({ judge: judgeCall, classify })
}
