/** Operator tools executed from a real Loader-mounted preset on disposable state, never the live app. */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { composeWebOperatorPreset } from '../aukora/supervisor/developer-web-operator.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = join(root, 'examples/headless-agent/tests/fixtures/governed/operator-coding/cordis.yml')
const driver = join(root, 'examples/headless-agent/tests/fixtures/governed/operator-coding/driver.ts')

it.skipIf(process.platform === 'win32')('executes operator reads, shell and service inspection through its effective session catalog', async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'aukora-operator-loader-')))
  const workspace = join(temporary, 'workspace')
  const presets = join(temporary, 'presets')
  const home = join(temporary, 'home')
  const body = 'Operator fixture source bytes.\nNo real provider was called.\n'
  try {
    await mkdir(workspace)
    await mkdir(home)
    await mkdir(join(presets, 'aukora'), { recursive: true })
    await writeFile(join(workspace, 'README.md'), body)
    const preset = composeWebOperatorPreset({
      aukoraPreset: await readFile(join(root, 'apps/cli/config/agent-presets/aukora/agent.cordis.yml'), 'utf8'),
      standardPreset: await readFile(join(root, 'apps/cli/config/agent-presets/standard/agent.cordis.yml'), 'utf8'),
      operatorCoding: true, platform: process.platform,
    })
    await writeFile(join(presets, 'aukora', 'preset.yml'), 'name: AUKORA operator fixture\ndescription: Scripted operator checks.\n')
    await writeFile(join(presets, 'aukora', 'agent.cordis.yml'), preset)
    const scrubbed = Object.fromEntries(Object.keys(process.env)
      .filter(name => /KEY|SECRET|TOKEN|PASSWORD/i.test(name)).map(name => [name, undefined]))
    const run = await runLoaderSmoke({
      label: 'AUKORA operator preset', tempDirPrefix: 'aukora-operator-process-',
      binScript: driver, libBinScript: driver, configPath: config, tsconfigPath: join(root, 'tsconfig.json'),
      env: { ...scrubbed, HOME: home, OPERATOR_FIXTURE_ROOT: workspace,
        OPERATOR_FIXTURE_PRESETS: presets, OPERATOR_FIXTURE_SOCKET: join(temporary, 'unused.sock') },
    })
    const line = run.stdout.split('\n').find(value => value.startsWith('{"fixture":'))
    expect(line, run.stderr).toBeDefined()
    const report = JSON.parse(line!) as {
      tools: string[]
      calls: Array<{ name: string }>
      results: unknown[]
      forbiddenEvents: number
      output: string
    }
    expect(report.tools).toEqual(expect.arrayContaining([
      'bash', 'read', 'write', 'edit', 'glob', 'grep', 'job_list', 'job_output', 'job_kill', 'skill',
      'get_goal', 'create_goal', 'update_goal', 'ask_user_question', 'council',
      'auma_canvas_read', 'auma_canvas_render', 'kira.recall', 'kira.stage', 'memory.put', 'workspace.patch',
    ]))
    expect(report.calls.map(call => call.name)).toEqual(['read', 'bash', 'get_goal', 'job_list', 'council'])
    expect(report.results).toHaveLength(5)
    expect(report.results).toMatchObject(Array.from({ length: 5 }, () => [{ type: 'tool-result', isError: false }]))
    expect(JSON.stringify(report.results[0])).toContain('Operator fixture source bytes.')
    expect(report.results[1]).toEqual([{
      type: 'tool-result', toolCallId: 'operator-fixture-1',
      content: [{ type: 'text', text: 'operator-shell-ok\n' }], isError: false,
    }])
    expect(JSON.stringify(report.results[2])).toContain('null')
    expect(JSON.stringify(report.results[3])).toContain('(no background jobs)')
    expect(JSON.stringify(report.results[4])).toContain('opencode')
    expect(report.forbiddenEvents).toBe(0)
    expect(report.output).toBe('Operator tool smoke complete; no worker, provider, approval or broker action was requested.')
    expect(await readFile(join(workspace, 'README.md'), 'utf8')).toBe(body)
    expect(JSON.parse(JSON.stringify(report).replaceAll(temporary, '<fixture>'))).toMatchSnapshot()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
