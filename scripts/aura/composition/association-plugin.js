/**
 * AUKORA Aura association — the observation adapter's association verb, mounted in the
 * composition as one read-only tool.
 *
 * WHAT THIS MOUNTS. `scripts/aura/adapter.py associate` answers one question: do these two
 * documents describe this log? It prints the pinned court's verdict, the composition's own
 * verdict over the same prefixes, and either an association or a named refusal. This plugin puts
 * that answer inside the running composition, so the app can ask it without an operator shelling
 * out — and so the answer arrives with the ceilings attached instead of as a bare verdict.
 *
 * WHAT IT IS NOT. It is not an authority: the tool carries no grant, no nonce, no key and no
 * receipt, it writes nothing, and it cannot retain, publish or settle anything. It runs one
 * subprocess and returns what that subprocess said. The verdict is the vendored court's over the
 * bytes on disk; `evidence, not truth` and `evidence, not authorization` are returned with it.
 *
 * CONFIGURATION, AND WHY THE ROW CAN BE SHORT. `gateRoot` defaults to the release root this file
 * is installed in (three levels up from `plugins/<id>/lib/index.js`), so a row that names a
 * release-relative `name:` needs to say nothing else. `stateDir` is resolved in this order:
 * the row's `stateDir`, then `stateDir` inside the JSON named by `AUKORA_GATE_CONFIG` — the file
 * the launcher already writes for the gate — and last `<gateRoot>/gate-state`. One source of
 * truth for where the log lives, instead of a second copy that can disagree with it.
 *
 * The tool is pinned to that state directory. `allowOtherStates: true` in the row is the explicit
 * opt-in for naming another, because a tool the model can point at any path is a tool that reads
 * whatever it is told to; the default refuses by name.
 *
 * @module @aukora/dsh-plugin-aura-association
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'aukora-aura-association'
export const inject = ['tools']

/** Model-facing tool name. DeepSeek/OpenAI reject dots in `tools[i].name`. */
export const ASSOCIATION_TOOL = 'aura_association'
export const ADAPTER_RELPATH = join('scripts', 'aura', 'adapter.py')

/** What an association answer does NOT establish, returned with every result. */
export const CEILINGS = Object.freeze([
  'evidence, not truth: the court compares two documents; it says nothing about whether a transition happened or whether a record is true',
  'evidence, not authorization: no grant, nonce, key or receipt is carried by this tool, and a verdict authorizes no effect',
  'evidence, not latestness: the presented head is the log head as of this read, and another log may exist that this plugin cannot see',
  'evidence, not custody: a retained copy this host can reach is RETAINER_SAME_OWNER, which is not an independent party agreeing',
  'a refusal is a result, not an error: `refusal` names why the association was refused while the court verdict, if any, is still reported',
])

/** Declared parameter schema for the `aura_association` tool. */
export const ASSOCIATION_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    retained: {
      type: 'string',
      description: 'Path to the retained observation to check. Relative paths resolve against the configured state directory.',
    },
    presented: {
      type: 'string',
      description: 'Path to the presented observation to check. Relative paths resolve against the configured state directory.',
    },
    state: {
      type: 'string',
      description: 'The state directory holding aura/records.jsonl. Defaults to the configured one; another is refused unless the row allows it.',
    },
  },
  required: ['retained', 'presented'],
}

/** The release root this file was installed under, from its own location. */
export function releaseRootOf(moduleUrl = import.meta.url) {
  // plugins/<id>/lib/index.js -> up three levels
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..')
}

/** Resolve where the log lives, from the row, from the gate's own config, then by convention. */
export function resolveStateDir(config = {}, env = process.env) {
  if (typeof config.stateDir === 'string' && config.stateDir !== '') return resolve(config.stateDir)
  const gateRoot = typeof config.gateRoot === 'string' && config.gateRoot !== ''
    ? resolve(config.gateRoot)
    : releaseRootOf()
  const configured = env['AUKORA_GATE_CONFIG']
  if (typeof configured === 'string' && configured !== '' && existsSync(configured)) {
    try {
      const parsed = JSON.parse(readFileSync(configured, 'utf8'))
      if (typeof parsed.stateDir === 'string' && parsed.stateDir !== '') return resolve(parsed.stateDir)
    } catch {
      // An unreadable gate config is reported by the mount line below, not swallowed silently:
      // the tool still mounts and refuses by name when a call cannot resolve a state.
    }
  }
  return resolve(gateRoot, 'gate-state')
}

/** Run the adapter's `associate` verb and read its structured report out of its output. */
export async function runAssociation({ gateRoot, python = 'python3', state, retained, presented, timeoutMs = 60000, env = process.env }) {
  const adapter = join(gateRoot, ADAPTER_RELPATH)
  if (!existsSync(adapter)) {
    return { ok: false, refusal: 'aura-adapter-absent', reason: `${adapter} is not installed in this release` }
  }
  const args = [adapter, 'associate', '--state', state, '--retained', retained, '--presented', presented]
  const completed = await new Promise(settle => {
    const child = spawn(python, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', error => {
      clearTimeout(timer)
      settle({ code: null, stdout, stderr: `${stderr}${String(error.message)}`, spawnError: true })
    })
    child.on('close', code => {
      clearTimeout(timer)
      settle({ code, stdout, stderr })
    })
  })
  const text = `${completed.stdout}\n${completed.stderr}`
  const field = label => new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1]
  const refusal = /REFUSE: ([a-z0-9-]+):/.exec(text)
  const verdict = /^VERDICT:\s*(\S+)/m.exec(text)?.[1]
  return {
    ok: completed.code === 0,
    exit: completed.code,
    spawnError: completed.spawnError === true,
    court: /^COURT\s*:\s*(\S+)/m.exec(text)?.[1] ?? verdict ?? null,
    composition: /^COMPOSITION\s*:\s*(\S+)/m.exec(text)?.[1] ?? null,
    refusal: refusal?.[1] ?? null,
    reason: refusal === null ? null : (field('REFUSE') ?? text.split('\n').find(line => line.includes('REFUSE')) ?? null),
    custody: /RETAINER_SAME_OWNER/.test(text) ? 'RETAINER_SAME_OWNER' : null,
    command: `${python} ${args.join(' ')}`,
    ceilings: CEILINGS,
  }
}

export function associationTool(options) {
  const { gateRoot, python, stateDir, allowOtherStates } = options
  return Object.freeze({
    name: ASSOCIATION_TOOL,
    description:
      'Ask whether two observation documents describe this composition log. Runs the pinned Phase 0 court over the '
      + 'pair and reports the court verdict, this log\'s own prefix comparison, and either the association or a named '
      + 'refusal. Read-only: it writes nothing, carries no authority, and its verdict is evidence about two documents, '
      + 'not about whether anything happened.',
    parameters: ASSOCIATION_PARAMETERS,
    output: {
      // The live registry requires both halves: a schema the runtime validates the result
      // against, and a render that turns it into what the caller reads. Omitting either makes
      // the tool fail to register — measured, not assumed: mounting this row without `render`
      // refused the whole entry with "must declare output { schema, render,
      // presentationMeta? }" on a real composition.
      // `oneOf` rather than `type: [...]` for the fields that can be empty: this build's tool
      // registry rejects union type arrays outright ("type arrays are not supported"), and a
      // verdict that did not exist must be null rather than an empty string pretending to be one.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          exit: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          court: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          composition: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          refusal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          custody: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          command: { type: 'string' },
          ceilings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    presentCall(args) {
      const presented = typeof args?.presented === 'string' && args.presented !== '' ? args.presented : 'a presented document'
      const title = `Association: ${presented.split('/').pop()}`
      return { card: 'generic', title, kind: 'read', rawInput: title }
    },
    async execute(args) {
      const state = typeof args?.state === 'string' && args.state !== '' ? resolve(stateDir, args.state) : stateDir
      if (!allowOtherStates && state !== stateDir) {
        return {
          ok: false,
          exit: null,
          court: null,
          composition: null,
          refusal: 'aura-state-not-permitted',
          custody: null,
          command: '',
          ceilings: [...CEILINGS, `this row is pinned to ${stateDir}; naming another state needs allowOtherStates: true`],
        }
      }
      const asPath = value => (typeof value === 'string' && value !== '' ? resolve(stateDir, value) : stateDir)
      return runAssociation({ gateRoot, python, state, retained: asPath(args?.retained), presented: asPath(args?.presented) })
    },
  })
}

export function apply(ctx, config = {}) {
  const resolved = {
    gateRoot: typeof config.gateRoot === 'string' && config.gateRoot !== '' ? resolve(config.gateRoot) : releaseRootOf(),
    python: typeof config.python === 'string' && config.python !== '' ? config.python : 'python3',
    stateDir: resolveStateDir(config),
    allowOtherStates: config.allowOtherStates === true,
  }
  const adapter = join(resolved.gateRoot, ADAPTER_RELPATH)
  if (!existsSync(adapter)) {
    // Fail at mount, not at first call: a row pointing at a release without the adapter is a
    // configuration fault, and an operator has to see it on load rather than in a tool result.
    throw new Error(`aura-adapter-absent: no adapter at ${adapter}; the row's gateRoot does not hold this lane`)
  }
  const registry = ctx?.['tools']
  if (registry === undefined || typeof registry.register !== 'function') {
    throw new Error('tool-registry-missing: the injected tools service does not provide register()')
  }
  registry.register(associationTool(resolved))
  // The mount line is the evidence an operator has that the row took effect; it names what was
  // resolved rather than what was asked for, so a fallback cannot look like a configured path.
  console.log(`[aura-association] MOUNTED tool=${ASSOCIATION_TOOL} gateRoot=${resolved.gateRoot} stateDir=${resolved.stateDir}`
    + ` allowOtherStates=${resolved.allowOtherStates}`)
  if (!existsSync(resolved.stateDir)) {
    console.log(`[aura-association] CEILING: ${resolved.stateDir} does not exist; the tool will refuse calls until the state does`)
  }
}
