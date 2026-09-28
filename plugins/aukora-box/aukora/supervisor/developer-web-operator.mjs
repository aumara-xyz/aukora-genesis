/** Opt-in native coding tools for the existing AUKORA Web preset, not additional brokered effects. */
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { isJsExpr } from '@deepseek-ai/cordis-plugin-loader'
import { load as loadYaml } from 'js-yaml'

/** Host rows required by the selected preset tools and the existing four Council providers. */
export const WEB_OPERATOR_REQUIRED_HOST_IDS = Object.freeze([
  'tools', 'system-prompt', 'sandbox', 'sandbox-policy', 'approval', 'permission',
  'shell-env', 'fs-sandbox', 'jobs', 'skill', 'goal', 'goal-round-driver', 'commands',
  'subagent', 'subprocess', 'council', 'council-codex', 'council-claude', 'council-opencode', 'council-crush',
])

const MAX_PRESET_BYTES = 128 * 1024
const CODING_ROWS = Object.freeze({
  'agent-instructions': '@deepseek-ai/dsh-agent-instructions',
  'tool-fs': '@deepseek-ai/dsh-tool-fs',
  'tool-fs-search': '@deepseek-ai/dsh-tool-fs-search',
  'tool-jobs': '@deepseek-ai/dsh-tool-jobs',
  'skill-filesystem': '@deepseek-ai/dsh-skill-filesystem',
  'tool-skill': '@deepseek-ai/dsh-tool-skill',
  'tool-goal': '@deepseek-ai/dsh-tool-goal',
  planning: 'cordis:group',
  compaction: 'cordis:group',
  'tool-ask-user': '@deepseek-ai/dsh-tool-ask-user',
  'tool-todo': '@deepseek-ai/dsh-tool-todo',
})
const SHELL_ROWS = Object.freeze({
  'tool-bash': { name: '@deepseek-ai/dsh-tool-bash', expression: "process.platform === 'win32'" },
  'tool-pwsh': { name: '@deepseek-ai/dsh-tool-pwsh', expression: "process.platform !== 'win32'" },
})
const BROKERED_ONLY_SENTENCE = 'Treat memory.put and workspace.patch as the only consequential actions and never claim a record or replacement settled unless that call reports settlement.'
const OPERATOR_INSTRUCTIONS = 'You are Auma in operator coding mode. Use the existing read, write, edit, glob, grep, bash, job controls, skills and goals for authorized coding work. Delegate bounded named file assignments through council to Codex, Claude Code, OpenCode or Crush, then inspect their actual changes and test results before integration. Native coding tools and Council workers use their configured native permissions; they are not AUKORA-brokered effects, do not mint Aura settlement receipts, and do not all request an approval popup. Follow the current sandbox and approval policy. Only memory.put and workspace.patch use the brokered approval and settlement path. Never approve your own broker or issuer request. A mounted provider or a model label does not prove authentication, availability, billing or successful execution. No new paid call is authorized merely by this mode.'

function invalid(detail) {
  throw new Error(`supervisor:web-operator-preset-invalid: ${detail}`)
}

function parsePreset(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_PRESET_BYTES) invalid('bounded preset text required')
  let parsed
  try { parsed = loadYaml(text, { schema: entryListSchema }) } catch (cause) {
    throw new Error('supervisor:web-operator-preset-invalid: preset YAML refused', { cause })
  }
  if (!Array.isArray(parsed)) invalid('preset must be an entry list')
  const ids = new Set()
  for (const row of parsed) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)
      || typeof row.id !== 'string' || typeof row.name !== 'string' || ids.has(row.id)) invalid('unique named preset rows required')
    ids.add(row.id)
  }
  return parsed
}

function assertLiteral(value) {
  if (isJsExpr(value)) invalid('unexpected executable expression')
  if (Array.isArray(value)) value.forEach(assertLiteral)
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(assertLiteral)
}

function requireRow(rows, id, name) {
  const row = rows.find(value => value.id === id)
  if (row?.name !== name || row.disabled === true) invalid(`required row ${id} (${name})`)
  return row
}

function requireRealm(row, realms, members) {
  if (row.group !== true || JSON.stringify(row.isolate) !== JSON.stringify(realms)
    || !Array.isArray(row.config) || row.config.length !== Object.keys(members).length) invalid(`isolated ${row.id} group required`)
  for (const [id, name] of Object.entries(members)) requireRow(row.config, id, name)
}

/**
 * Validate the already-composed host before enabling native operator tools; no service is mounted here.
 * @param {Iterable<string>} hostPluginIds - Enabled host row IDs observed by the staging owner.
 * @param {string} platform - Node platform selecting the existing shell executor.
 * @returns {void}
 */
export function assertWebOperatorHost(hostPluginIds, platform) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) invalid('unsupported platform')
  const observed = new Set(hostPluginIds)
  const required = [...WEB_OPERATOR_REQUIRED_HOST_IDS, platform === 'win32' ? 'pwsh-sandbox' : 'bash-sandbox']
  const missing = required.filter(id => !observed.has(id))
  if (missing.length > 0) invalid(`missing enabled host rows: ${missing.join(', ')}`)
}

/**
 * Select existing coding rows without changing the preset ID, broker tools, KIRA subject, or Canvas.
 * The disabled mode returns exact input bytes. Enabled output is literal YAML-compatible JSON;
 * the staging owner must validate the host and resolve the selected plugin dependencies before launch.
 * @param {{aukoraPreset: string, standardPreset: string, platform: string, operatorCoding: boolean}} options - Explicit operator selection and reviewed source compositions.
 * @returns {string} The unchanged restricted preset or its native operator coding composition.
 */
export function composeWebOperatorPreset({ aukoraPreset, standardPreset, platform, operatorCoding }) {
  if (operatorCoding === false) return aukoraPreset
  if (operatorCoding !== true || !['darwin', 'linux', 'win32'].includes(platform)) invalid('explicit operator mode and supported platform required')
  const aukora = parsePreset(aukoraPreset)
  const standard = parsePreset(standardPreset)
  assertLiteral(aukora)
  for (const [id, expected] of Object.entries(SHELL_ROWS)) {
    const row = standard.find(value => value.id === id)
    if (row?.name !== expected.name || !isJsExpr(row.disabled) || row.disabled.__jsExpr !== expected.expression) {
      invalid(`reviewed platform expression required for ${id}`)
    }
    row.disabled = id === 'tool-bash' ? platform === 'win32' : platform !== 'win32'
  }
  assertLiteral(standard)
  const selected = [requireRow(standard, platform === 'win32' ? 'tool-pwsh' : 'tool-bash',
    platform === 'win32' ? SHELL_ROWS['tool-pwsh'].name : SHELL_ROWS['tool-bash'].name),
  ...Object.entries(CODING_ROWS).map(([id, name]) => requireRow(standard, id, name))]
  requireRealm(selected.find(row => row.id === 'planning'), { planMode: true }, { 'plan-mode': '@deepseek-ai/dsh-plan-mode' })
  requireRealm(selected.find(row => row.id === 'compaction'), { compaction: true, toolResultPruner: true }, {
    'compaction-basic': '@deepseek-ai/dsh-compaction-basic',
    'command-compact': '@deepseek-ai/dsh-command-compact',
    'tool-result-pruner': '@deepseek-ai/dsh-compaction-tool-result-pruner',
  })
  for (const row of selected) if (aukora.some(existing => existing.id === row.id)) invalid(`operator row already present: ${row.id}`)
  const persona = requireRow(aukora, 'persona', '@deepseek-ai/dsh-persona')
  const kiraGroup = requireRow(aukora, 'kira', 'cordis:group')
  requireRealm(kiraGroup, { 'aukora.kira': true }, { 'kira-routes': '@deepseek-ai/dsh-aukora-kira' })
  const kira = kiraGroup.config[0].config
  if (kira?.restrictGlobalToolsToMemoryPut !== true || !Array.isArray(kira.additionalInheritedTools)
    || !kira.additionalInheritedTools.includes('workspace.patch')
    || kira.additionalInheritedTools.some(name => typeof name !== 'string' || name.length === 0)) invalid('restricted broker tool selection required')
  if (typeof persona.config?.text !== 'string' || persona.config.text.split(BROKERED_ONLY_SENTENCE).length !== 2) {
    invalid('reviewed AUKORA persona required')
  }
  requireRow(aukora, 'auma-canvas-tool', '@deepseek-ai/dsh-client-ui-stock-apps/auma-canvas-tool')
  kira.additionalInheritedTools = [...new Set([...kira.additionalInheritedTools, 'council'])]
  persona.config.complete = false
  persona.config.includeRuntimeContext = true
  persona.config.text = `${OPERATOR_INSTRUCTIONS}\n\n${persona.config.text.replace(BROKERED_ONLY_SENTENCE,
    'Never claim a memory.put or workspace.patch settled unless its broker result reports settlement.')}`
  const output = `${JSON.stringify([...aukora, ...selected])}\n`
  if (Buffer.byteLength(output) > MAX_PRESET_BYTES) invalid('composed preset exceeds size limit')
  return output
}
