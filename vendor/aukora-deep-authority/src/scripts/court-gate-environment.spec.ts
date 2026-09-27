import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareGateBuildEnvironment, prepareGateEnvironment } from './court-gate-environment.mjs'

describe('Court Gate environment closure', () => {
  it('rejects shell, Node, and indexed Git execution inputs', () => {
    const prepared = prepareGateEnvironment({
      BASH_ENV: '/tmp/attacker.sh',
      GIT_CONFIG_KEY_0: 'core.excludesFile',
      GIT_CONFIG_VALUE_0: '/tmp/ignore',
      NODE_OPTIONS: '--import=/tmp/attacker.mjs',
      PATH: '/usr/bin',
    }, { root: '/repo', nullDevice: '/dev/null' })

    expect(prepared.rejectedNames).toEqual([
      'BASH_ENV',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'NODE_OPTIONS',
    ])
  })

  it('removes secret-bearing names and pins the Git and Harness environment', () => {
    const prepared = prepareGateEnvironment({
      AUKORA_SIGNING_KEY: 'private',
      DEEPSEEK_API_KEY: 'private',
      DEPLOY_TOKEN: 'private',
      HOME: '/ambient-home',
      PATH: '/usr/bin',
      SERVICE_PASSWORD: 'private',
      SESSION_SECRET: 'private',
    }, { root: '/repo', nullDevice: '/dev/null' })

    expect(prepared.rejectedNames).toEqual([])
    expect(prepared.env).toMatchObject({
      DSH_HOME: '/repo',
      FORCE_COLOR: '0',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: '/ambient-home',
      NO_COLOR: '1',
      PATH: '/usr/bin',
    })
    expect(prepared.env).not.toHaveProperty('AUKORA_SIGNING_KEY')
    expect(prepared.env).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(prepared.env).not.toHaveProperty('DEPLOY_TOKEN')
    expect(prepared.env).not.toHaveProperty('SERVICE_PASSWORD')
    expect(prepared.env).not.toHaveProperty('SESSION_SECRET')
  })

  it('adds one fixed memory limit only after hostile Node options are removed', () => {
    const prepared = prepareGateEnvironment({
      NODE_OPTIONS: '--import=/tmp/attacker.mjs',
      PATH: '/usr/bin',
    }, { root: '/repo', nullDevice: '/dev/null' })

    expect(prepared.rejectedNames).toEqual(['NODE_OPTIONS'])
    expect(prepareGateBuildEnvironment(prepared.env)).toMatchObject({
      NODE_OPTIONS: '--max-old-space-size=4096',
      PATH: '/usr/bin',
    })
    expect(() => prepareGateBuildEnvironment({ NODE_OPTIONS: '--inspect' }))
      .toThrow(/must not inherit NODE_OPTIONS/u)
  })

  it('prevents a caller Git configuration from hiding an untracked witness member', () => {
    const root = mkdtempSync(join(tmpdir(), 'aukora-gate-env-'))
    try {
      const home = join(root, 'home')
      const repo = join(root, 'repo')
      const excludes = join(root, 'ambient-ignore')
      mkdirSync(home)
      mkdirSync(repo)
      writeFileSync(excludes, 'hidden.txt\n')
      writeFileSync(join(home, '.gitconfig'), `[core]\n\texcludesFile = ${excludes}\n`)
      execFileSync('git', ['init', '--quiet', repo])
      writeFileSync(join(repo, 'hidden.txt'), 'witness\n')
      const ambient = { ...process.env, HOME: home }
      expect(execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], {
        encoding: 'utf8',
        env: ambient,
      })).toBe('')

      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const prepared = prepareGateEnvironment(ambient, { root: repo, nullDevice })
      expect(execFileSync('git', [
        '-c', `core.excludesFile=${nullDevice}`,
        '-C', repo, 'status', '--porcelain', '--untracked-files=all',
      ], { encoding: 'utf8', env: prepared.env })).toBe('?? hidden.txt\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
