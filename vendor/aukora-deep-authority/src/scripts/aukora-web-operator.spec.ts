/** Pure composition checks; native workers, model routes and live state are never invoked. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { assertWebOperatorHost, composeWebOperatorPreset, WEB_OPERATOR_REQUIRED_HOST_IDS } from '../aukora/supervisor/developer-web-operator.mjs'

const root = new URL('../', import.meta.url)
const aukoraPreset = readFileSync(new URL('apps/cli/config/agent-presets/aukora/agent.cordis.yml', root), 'utf8')
const standardPreset = readFileSync(new URL('apps/cli/config/agent-presets/standard/agent.cordis.yml', root), 'utf8')
const options = { aukoraPreset, standardPreset, platform: 'darwin', operatorCoding: true }
interface PresetRow {
  id: string
  name: string
  config?: unknown
  group?: boolean
  isolate?: Record<string, boolean>
  disabled?: boolean
}
const literal = (text: string): PresetRow[] => loadYaml(text) as PresetRow[]
const source = literal(aukoraPreset)

describe('AUKORA Web operator coding selection', () => {
  it('keeps restricted mode byte-identical without reading the coding preset', () => {
    expect(composeWebOperatorPreset({ ...options, standardPreset: 'not a preset', operatorCoding: false })).toBe(aukoraPreset)
    expect(literal(aukoraPreset).map(row => row.id)).toEqual(['persona', 'kira', 'auma-canvas-tool'])
    expect(aukoraPreset).toContain('restrictGlobalToolsToMemoryPut: true')
  })

  it.each(['darwin', 'linux', 'win32'])('selects literal %s coding tools while preserving memory and Canvas', (platform) => {
    const text = composeWebOperatorPreset({ ...options, platform })
    const rows = literal(text)
    const shell = platform === 'win32' ? 'tool-pwsh' : 'tool-bash'
    expect(text).not.toContain('__jsExpr')
    expect(text).not.toContain('!!js')
    expect(rows.map(row => row.id)).toEqual([
      'persona', 'kira', 'auma-canvas-tool', shell, 'agent-instructions', 'tool-fs', 'tool-fs-search',
      'tool-jobs', 'skill-filesystem', 'tool-skill', 'tool-goal', 'planning', 'compaction', 'tool-ask-user', 'tool-todo',
    ])
    expect(rows.find(row => row.id === shell)?.disabled).toBe(false)
    expect(rows.find(row => row.id === 'auma-canvas-tool')).toEqual(source.find(row => row.id === 'auma-canvas-tool'))
    const kira = rows.find(row => row.id === 'kira')
    expect(kira).toMatchObject({ group: true, isolate: { 'aukora.kira': true }, config: [{
      id: 'kira-routes', name: '@deepseek-ai/dsh-aukora-kira',
      config: { restrictGlobalToolsToMemoryPut: true, additionalInheritedTools: ['workspace.patch', 'council'] },
    }] })
    const persona = rows.find(row => row.id === 'persona')?.config as {
      text: string
      complete: boolean
      includeRuntimeContext: boolean
    }
    expect(persona).toMatchObject({ complete: false, includeRuntimeContext: true })
    expect(persona.text).toContain('aumlok:subject:local-web')
    expect(persona.text).toContain('not AUKORA-brokered effects')
    expect(persona.text).toContain('do not all request an approval popup')
    expect(persona.text).toContain('Never approve your own broker or issuer request')
    expect(persona.text).not.toContain('only consequential actions')
    expect(rows.some(row => row.id === 'delegation' || row.id === 'tool-web')).toBe(false)
  })

  it('retains the standard private realms and exact service membership', () => {
    const standard = loadYaml(standardPreset, { schema: entryListSchema }) as Array<Record<string, unknown>>
    const composed = literal(composeWebOperatorPreset(options))
    for (const id of ['planning', 'compaction']) {
      expect(composed.find(row => row.id === id)).toEqual(standard.find(row => row.id === id))
      expect(composed.find(row => row.id === id)?.group).toBe(true)
    }
    expect(composed.filter(row => row.name === 'cordis:group').every(row => row.isolate !== undefined)).toBe(true)
  })

  it('requires every declared selected plugin from the shipped resolver manifest', () => {
    const pkg = JSON.parse(readFileSync(new URL('apps/cli/package.json', root), 'utf8')) as { dependencies: Record<string, string> }
    const dependencies = new Set(Object.keys(pkg.dependencies))
    const rows = literal(composeWebOperatorPreset(options))
    const visit = (entries: PresetRow[]) => {
      for (const row of entries) {
        if (row.name === 'cordis:group') visit(row.config as PresetRow[])
        else {
          const packageName = row.name.split('/').slice(0, 2).join('/')
          expect(dependencies.has(packageName), `${packageName} absent from ${fileURLToPath(new URL('apps/cli/package.json', root))}`).toBe(true)
        }
      }
    }
    visit(rows)
  })

  it('requires the active shell backend and each enabled host prerequisite', () => {
    const ids = [...WEB_OPERATOR_REQUIRED_HOST_IDS, 'bash-sandbox']
    expect(() => { assertWebOperatorHost(ids, 'darwin') }).not.toThrow()
    expect(() => { assertWebOperatorHost(ids, 'win32') }).toThrow('pwsh-sandbox')
    for (const id of WEB_OPERATOR_REQUIRED_HOST_IDS) {
      expect(() => { assertWebOperatorHost(ids.filter(value => value !== id), 'darwin') }).toThrow(id)
    }
    expect(() => { assertWebOperatorHost([...WEB_OPERATOR_REQUIRED_HOST_IDS, 'pwsh-sandbox'], 'win32') }).not.toThrow()
  })

  it.each([
    ['unknown executable expression', standardPreset.replace('maxBytes: 65536', 'maxBytes: !!js process.env.PRESET_BYTES')],
    ['changed platform expression', standardPreset.replace("process.platform === 'win32'", 'process.env.DISABLE_SHELL')],
    ['missing coding row', standardPreset.replace('id: tool-fs\n', 'id: unknown-tool-fs\n')],
    ['wrong plugin name', standardPreset.replace("name: '@deepseek-ai/dsh-tool-jobs'", "name: '@deepseek-ai/dsh-other-jobs'")],
    ['missing realm', standardPreset.replace('    planMode: true', '    planMode: false')],
    ['missing group member', standardPreset.replace('id: command-compact\n', 'id: different-command\n')],
  ])('refuses %s rather than silently selecting a different composition', (_label, altered) => {
    expect(() => composeWebOperatorPreset({ ...options, standardPreset: altered })).toThrow('supervisor:web-operator-preset-invalid')
  })

  it.each([
    aukoraPreset.replace('restrictGlobalToolsToMemoryPut: true', 'restrictGlobalToolsToMemoryPut: false'),
    aukoraPreset.replace('          - workspace.patch', '          - other.tool'),
    aukoraPreset.replace('only consequential actions', 'all brokered actions'),
    `${aukoraPreset}\n- id: tool-jobs\n  name: '@deepseek-ai/dsh-tool-jobs'\n`,
    `${aukoraPreset}\n- id: kira\n  name: cordis:group\n`,
  ])('refuses unreviewed AUKORA rows', (altered) => {
    expect(() => composeWebOperatorPreset({ ...options, aukoraPreset: altered })).toThrow('supervisor:web-operator-preset-invalid')
  })

  it('refuses unsupported platforms and malformed or oversized preset data', () => {
    expect(() => composeWebOperatorPreset({ ...options, platform: 'freebsd' })).toThrow('supported platform')
    expect(() => composeWebOperatorPreset({ ...options, standardPreset: 'x'.repeat(131073) })).toThrow('bounded preset')
    expect(() => composeWebOperatorPreset({ ...options, standardPreset: '[' })).toThrow('preset YAML refused')
    expect(() => composeWebOperatorPreset({ ...options, aukoraPreset: '{}' })).toThrow('entry list')
  })
})
