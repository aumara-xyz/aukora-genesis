/** Host-independent counterfeits preserve the topology court's real inventory and J1 requirement. */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { principalJobCountsMatch, substringJobCounterfeit } from '../courts/harness/launch-ceremony-topology/job-evidence.mjs'

const principals = ['human', 'issuer', 'broker', 'guest']
const principalLabels = ['com.aukora.supervisor', 'com.aukora.issuer', 'com.aukora.broker', 'com.aukora.guest']
const accountDefinitions = principals.map(principal => `${principal}.plist`)

describe('topology job evidence', () => {
  it.each([
    [],
    ['com.aukora.brain', 'com.aukora.voice'],
    ['com.aukora.broker', 'com.aukora.issuer'],
    principalLabels,
    [...principalLabels, 'xyz.aumara.aukora-deep-live-mirror'],
  ])('rejects an unbound staged claim without rewriting observed labels %j', (...labels: string[]) => {
    const observed = Object.freeze(labels)
    const before = [...observed]
    const counterfeit = substringJobCounterfeit('darwin', observed, principals)
    expect(counterfeit.detected).toBe(true)
    expect(counterfeit.claimedPrincipalLabels).toHaveLength(principals.length)
    expect(counterfeit.claimedLabels).toEqual(expect.arrayContaining(before))
    expect(observed).toEqual(before)
  })

  it('preserves J1 account-definition and label counts independently', () => {
    expect(principalJobCountsMatch(principals.length, principalLabels, accountDefinitions)).toBe(true)
    expect(principalJobCountsMatch(principals.length, principalLabels, [])).toBe(false)
    expect(principalJobCountsMatch(principals.length, [], accountDefinitions)).toBe(false)
    expect(principalJobCountsMatch(principals.length, principalLabels.slice(0, 3), accountDefinitions)).toBe(false)
    expect(principalJobCountsMatch(principals.length, principalLabels, accountDefinitions.slice(0, 3))).toBe(false)
  })

  it('preserves the enrolled Linux counterfactual skip even with supplied label text', () => {
    expect(substringJobCounterfeit('linux', [], principals).detected).toBe(false)
    expect(substringJobCounterfeit('linux', principalLabels, principals).detected).toBe(false)
  })

  it('fails the intended counterfeit assertion when only the account-definition guard is removed', () => {
    const source = readFileSync(new URL('../courts/harness/launch-ceremony-topology/job-evidence.mjs', import.meta.url), 'utf8')
    const guard = '    && accountDefinitions.length === principalCount\n'
    expect(source.split(guard)).toHaveLength(2)
    const mutant = `data:text/javascript,${encodeURIComponent(source.replace(guard, ''))}`
    const probe = `import assert from 'node:assert/strict';
      import { substringJobCounterfeit } from ${JSON.stringify(mutant)};
      const result=substringJobCounterfeit('darwin',${JSON.stringify(principalLabels)},${JSON.stringify(principals)});
      assert.equal(result.detected,true,'M4 must reject labels without account definitions');`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', env: {}, timeout: 10_000 })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('M4 must reject labels without account definitions')
    expect(result.stderr).toContain('false !== true')
  })
})
