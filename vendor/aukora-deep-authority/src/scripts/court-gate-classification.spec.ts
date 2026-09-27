import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  EXPECTED_GATE_RUNS,
  amendmentChannelMutationFaults,
  classifiedRunCount,
  gateRosterFaults,
  keptBreachFaults,
  liveDispatchMutationFaults,
  liveDispatchNormalFaults,
  mutationResultFaults,
  ordinaryResultFaults,
  parseCourtRows,
  resolvePathExecutables,
} from './court-gate-classification.mjs'

const EXPECTED = [
  { marker: 'control: hardened closure', verdict: 'HELD' as const },
  { marker: 'one member re-widened', verdict: 'DETECTED' as const },
]

const output = (first = 'HELD', second = 'DETECTED') => `
  MUTATION control: hardened closure  detail  ${first}
  MUTATION one member re-widened      detail  ${second}
  MUTATION ordinary-row oracle        expectedBreaches=[D1] matched=true
`

const amendmentOutput = `  MUTATION watcher neutralized      ordinary live under real=true, under mutant=false, watched=[]   DETECTED
  MUTATION disabled row composed    live entries moved=true, model-visible tools moved=false   DETECTED
  MUTATION refusal removed          both guest defense controls=[true,true]   DETECTED
  MUTATION parent disposition removed  both guest live amendments=[true,true]   DETECTED
  MUTATION ordinary-row oracle       expectedBreaches=[] matched=true
`

describe('Court Gate classification', () => {
  it('reads only committed observer samples and refuses corruption or a truncated stopped writer', () => {
    const court = readFileSync(new URL('../courts/harness/amendment-channel/run.mjs', import.meta.url), 'utf8')
    const reader = /const samplesOf = [\s\S]*?\n\}\n/u.exec(court)?.[0]
    expect(reader).toBeDefined()
    let bytes = '{"t":1}\n{"t":'
    const samples = runInNewContext(`${reader}; samplesOf`, {
      existsSync: () => true,
      readFileSync: () => bytes,
    }) as (log: string, closed?: boolean) => unknown[]
    expect(samples('fixture')).toEqual([{ t: 1 }])
    expect(() => samples('fixture', true)).toThrow('incomplete sample')
    bytes += '2}\n'
    expect(samples('fixture', true)).toEqual([{ t: 1 }, { t: 2 }])
    bytes = '{"t":1}\n{"broken":}\n'
    expect(() => samples('fixture')).toThrow()
    bytes = '{"t":1}'
    expect(samples('fixture')).toEqual([])
    expect(() => samples('fixture', true)).toThrow('incomplete sample')
    bytes = ''
    expect(samples('fixture', true)).toEqual([])
    expect(court).toContain('samplesOf(log, true)')
  })

  it('matches the enrolled verifier mutation terminal against the executed court', () => {
    const gate = readFileSync(new URL('./run-gate.mjs', import.meta.url), 'utf8')
    const enrolled = /\['verifier-bytes --mutate',[\s\S]*?terminal: \{ exact: '([^']+)'/u.exec(gate)?.[1]
    expect(enrolled).toBeDefined()
    const result = spawnSync(process.execPath,
      [fileURLToPath(new URL('../courts/harness/verifier-bytes/run.mjs', import.meta.url)), '--mutate'],
      { encoding: 'utf8', timeout: 10_000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.signal).toBeNull()
    const terminal = result.stdout.trim().split('\n').at(-1)?.trim()
    expect(terminal).toBe(enrolled)
    expect(terminal?.replace('detected=true', 'detected=false')).not.toBe(enrolled)
  })

  it('requires four amendment controls with the observed two-guest results', () => {
    expect(amendmentChannelMutationFaults(amendmentOutput)).toEqual([])
    for (const marker of ['watcher neutralized', 'disabled row composed', 'refusal removed', 'parent disposition removed']) {
      const omitted = amendmentOutput.split('\n').filter(line => !line.startsWith(`  MUTATION ${marker} `)).join('\n')
      expect(amendmentChannelMutationFaults(omitted)).toContain(`missing mutation marker ${JSON.stringify(marker)}`)
      const renamed = amendmentOutput.replace(`MUTATION ${marker} `, `MUTATION counterfeit ${marker} `)
      expect(amendmentChannelMutationFaults(renamed)).toContain(`missing mutation marker ${JSON.stringify(marker)}`)
    }
  })

  it('rejects forged amendment observations and duplicated controls', () => {
    for (const [original, forged] of [
      ['under mutant=false', 'under mutant=true'],
      ['model-visible tools moved=false', 'model-visible tools moved=true'],
      ['both guest defense controls=[true,true]', 'both guest defense controls=[true,false]'],
      ['both guest live amendments=[true,true]', 'both guest live amendments=[true]'],
      ['both guest live amendments=[true,true]', 'both guest live amendments=[true,true]  both guest live amendments=[false,false]'],
      ['under mutant=false, watched=[]', 'under mutant=false, watched=[]  extra=ignored'],
    ]) {
      expect(amendmentChannelMutationFaults(amendmentOutput.replace(original!, forged!)))
        .toEqual(expect.arrayContaining([expect.stringContaining('observations differ')]))
    }
    const duplicate = amendmentOutput.replace('  MUTATION ordinary-row oracle',
      '  MUTATION parent disposition removed  both guest live amendments=[true,true]   DETECTED\n  MUTATION ordinary-row oracle')
    expect(amendmentChannelMutationFaults(duplicate)).toContain('duplicate mutation markers: parent disposition removed')
    expect(amendmentChannelMutationFaults(amendmentOutput.replace('   DETECTED', '   NOT DETECTED')))
      .toContain('mutation "watcher neutralized" reported NOT DETECTED, expected DETECTED')
  })

  it('rejects a changed amendment oracle and non-column mutation evidence', () => {
    expect(amendmentChannelMutationFaults(amendmentOutput.replace('matched=true', 'matched=false')))
      .toContain('ordinary-row oracle reported matched=false')
    expect(amendmentChannelMutationFaults(amendmentOutput.replace('expectedBreaches=[]', 'expectedBreaches=[A2]')))
      .toContain('ordinary-row oracle added breach rows: A2')
    expect(amendmentChannelMutationFaults(amendmentOutput.replace('parent disposition removed  both', 'parent disposition removed both')))
      .toContain('missing mutation marker "parent disposition removed"')
  })

  it('keeps the amendment classifier and scoped timeout connected to the top-level gate', () => {
    const gate = readFileSync(new URL('./run-gate.mjs', import.meta.url), 'utf8')
    expect(gate).toContain("if (label === 'amendment-channel --mutate') faults.push(...amendmentChannelMutationFaults(stdout))")
    expect(gate).toContain('const AMENDMENT_ROWS = Array.from({ length: 10 }, (_, index) => `A${index + 1}`)')
    expect(gate).toContain("const ordinaryTimeoutMs = court => court === 'amendment-channel' ? 900000 : ORDINARY_TIMEOUT_MS")
    expect(gate).toContain('timeout: ordinaryTimeoutMs(court),')
    const enrollment = JSON.parse(readFileSync(new URL('../courts/known-breaches.json', import.meta.url), 'utf8')) as {
      knownBreaches: Array<{ court: string }>
    }
    expect(enrollment.knownBreaches.map(({ court }) => court)).not.toContain('amendment-channel')
  })

  it('detects an earlier PATH executable shadowing a court observer', () => {
    const root = mkdtempSync(join(tmpdir(), 'aukora-gate-path-'))
    try {
      const trusted = join(root, 'trusted')
      const shadow = join(root, 'shadow')
      mkdirSync(trusted)
      mkdirSync(shadow)
      const trustedExecutable = join(trusted, 'lsof')
      writeFileSync(trustedExecutable, '#!/bin/sh\necho trusted\n')
      chmodSync(trustedExecutable, 0o755)
      expect(resolvePathExecutables([shadow, trusted], ['lsof'])).toEqual([
        { name: 'lsof', path: join(trusted, 'lsof') },
      ])
      mkdirSync(join(shadow, 'lsof'))
      expect(resolvePathExecutables([shadow, trusted], ['lsof'])).toEqual([
        { name: 'lsof', path: join(trusted, 'lsof') },
      ])
      rmSync(join(shadow, 'lsof'), { recursive: true })
      const shadowExecutable = join(shadow, 'lsof')
      writeFileSync(shadowExecutable, '#!/bin/sh\necho shadow\n')
      chmodSync(shadowExecutable, 0o755)
      expect(resolvePathExecutables([shadow, trusted], ['lsof'])).toEqual([
        { name: 'lsof', path: join(shadow, 'lsof') },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts the exact declared counterfactual results and row oracle', () => {
    expect(mutationResultFaults(output(), EXPECTED, ['D1'])).toEqual([])
  })

  it('accepts an exact unavailable platform result only when declared', () => {
    expect(mutationResultFaults(output('HELD', 'NOT DETECTED'), [
      EXPECTED[0]!,
      { marker: 'one member re-widened', verdict: 'NOT DETECTED' },
    ], ['D1'])).toEqual([])
  })

  it('rejects a weakened counterfactual result', () => {
    expect(mutationResultFaults(output('HELD', 'NOT DETECTED'), EXPECTED, ['D1'])).toContain(
      'mutation "one member re-widened" reported NOT DETECTED, expected DETECTED',
    )
  })

  it('rejects contradictory mutation verdict tokens before the terminal verdict', () => {
    const text = `  MUTATION one member re-widened  observed NOT DETECTED  DETECTED
  MUTATION ordinary-row oracle  expectedBreaches=[D1] matched=true
`
    expect(mutationResultFaults(text, [EXPECTED[1]!], ['D1']))
      .toContain('unparseable mutation output at lines: 1')
  })

  it('rejects missing, duplicate, and undeclared mutation markers', () => {
    const text = `
  MUTATION control: hardened closure  detail  HELD
  MUTATION control: hardened closure  detail  HELD
  MUTATION undeclared                 detail  DETECTED
  MUTATION ordinary-row oracle        expectedBreaches=[D1] matched=true
`
    const faults = mutationResultFaults(text, EXPECTED, ['D1'])
    expect(faults).toContain('duplicate mutation markers: control: hardened closure')
    expect(faults).toContain('missing mutation marker "one member re-widened"')
    expect(faults).toContain('undeclared mutation marker "undeclared"')
  })

  it('requires one successful ordinary-row oracle sentinel', () => {
    expect(mutationResultFaults(output().replace('matched=true', 'matched=false'), EXPECTED, ['D1'])).toContain(
      'ordinary-row oracle reported matched=false',
    )
    expect(mutationResultFaults(output().replace(/.*ordinary-row oracle.*\n/, ''), EXPECTED, ['D1'])).toContain(
      'ordinary-row oracle appeared 0 times, expected exactly once',
    )
  })

  it('matches a declared marker with exact observation detail', () => {
    const text = `
  MUTATION published command flipped declined under shipped doc=false, under staged doc=true   DETECTED
  MUTATION ordinary-row oracle        expectedBreaches=[A10] matched=true
`
    expect(mutationResultFaults(text, [
      {
        marker: 'published command flipped',
        detailExact: 'declined under shipped doc=false, under staged doc=true',
        verdict: 'DETECTED',
      },
    ], ['A10'])).toEqual([])
  })

  it('rejects inexact or contradictory detail output', () => {
    const text = `  MUTATION published command flipped declined under shipped doc=false  DETECTED  MUTATION undeclared attack  DETECTED
  MUTATION ordinary-row oracle  expectedBreaches=[A10] matched=true
`
    expect(mutationResultFaults(text, [{
      marker: 'published command flipped',
      detailExact: 'declined under shipped doc=false, under staged doc=true',
      verdict: 'DETECTED',
    }], ['A10'])).toEqual(expect.arrayContaining([
      'missing mutation marker "published command flipped"',
      'unparseable mutation output at lines: 1',
    ]))
    const nonsense = text.replace('declined under shipped doc=false  DETECTED  MUTATION undeclared attack', 'declined under shipped doc=banana')
    expect(mutationResultFaults(nonsense, [{
      marker: 'published command flipped',
      detailExact: 'declined under shipped doc=false, under staged doc=true',
      verdict: 'DETECTED',
    }], ['A10'])).toContain('missing mutation marker "published command flipped"')
  })

  it('rejects an undeclared suffix on an otherwise declared marker', () => {
    const text = `
  MUTATION control: hardened closure  detail  HELD
  MUTATION one member re-widened extra  detail  DETECTED
  MUTATION ordinary-row oracle        expectedBreaches=[D1] matched=true
`
    const faults = mutationResultFaults(text, EXPECTED, ['D1'])
    expect(faults).toContain('missing mutation marker "one member re-widened"')
    expect(faults).toContain('undeclared mutation marker "one member re-widened extra"')
  })

  it('rejects a mutation line that does not use the declared column grammar', () => {
    const text = `${output()}   MUTATION undeclared detail DETECTED\n`
    expect(mutationResultFaults(text, EXPECTED, ['D1'])).toContain('unparseable mutation output at lines: 5')
  })

  it('rejects prefixed and control-coded mutation evidence', () => {
    for (const hidden of [
      'prefix MUTATION undeclared  detail  DETECTED',
      '\u001b[32m  MUTATION undeclared  detail  DETECTED\u001b[0m',
    ]) {
      const text = `${output()}${hidden}\n`
      expect(mutationResultFaults(text, EXPECTED, ['D1']))
        .toContain('unparseable mutation output at lines: 5')
    }
  })

  it('requires one physical output line per declaration', () => {
    const text = `  MUTATION a b x   DETECTED
  MUTATION ordinary-row oracle        expectedBreaches=[] matched=true
`
    expect(mutationResultFaults(text, [
      { marker: 'a', detailExact: 'b x', verdict: 'DETECTED' },
      { marker: 'a b', detailExact: 'x', verdict: 'DETECTED' },
    ], [])).toContain('mutation output line 1 matched multiple declarations: "a", "a b"')
  })

  it('requires the successful ordinary-row oracle to terminate output', () => {
    const text = `${output()}trailing output\n`
    expect(mutationResultFaults(text, EXPECTED, ['D1'])).toContain(
      'ordinary-row oracle was at line 4, but output terminated at line 5',
    )
  })

  it('requires one exact expected-breach list in the terminal oracle', () => {
    const contradictory = output().replace('matched=true', 'matched=false matched=true')
    expect(mutationResultFaults(contradictory, EXPECTED, ['D1'])).toContain('unparseable mutation output at lines: 4')
    const fabricated = output().replace('expectedBreaches=[D1] matched=true', 'expectedBreaches=[matched=true]')
    expect(mutationResultFaults(fabricated, EXPECTED, ['D1'])).toContain('unparseable mutation output at lines: 4')
    expect(mutationResultFaults(output(), EXPECTED, ['D2'])).toEqual(expect.arrayContaining([
      'ordinary-row oracle omitted breach rows: D2',
      'ordinary-row oracle added breach rows: D1',
    ]))
  })

  it('keeps a coherent forgery distinct from both held and breach rows', () => {
    const rows = parseCourtRows('  R8  coherent forgery  *** KEPT BREACH ***  {"verifies":true}\n')
    expect(rows.keptBreach).toEqual(new Set(['R8']))
    expect(rows.held).toEqual(new Set())
    expect(rows.breach).toEqual(new Set())
    expect(keptBreachFaults(['R8'], rows.keptBreach)).toEqual([])
  })

  it('parses a row whose format has no description column', () => {
    expect(parseCourtRows('  V1.live  held  {"ok":true}\n').held).toEqual(new Set(['V1.live']))
    expect(parseCourtRows('  C10 one-space id column held  {"ok":true}\n').held).toEqual(new Set(['C10']))
  })

  it('rejects missing and undeclared kept-breach rows', () => {
    expect(keptBreachFaults(['R8'], new Set(['R9']))).toEqual([
      'kept-breach row R8 was not emitted',
      'undeclared kept-breach row R9 was emitted',
    ])
  })

  it('rejects an Aura transcript containing only its declared kept breach', () => {
    const rows = parseCourtRows('  R8  coherent forgery  *** KEPT BREACH ***  {"verifies":true}\n')
    expect(ordinaryResultFaults({
      held: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R9', 'R10'],
      breach: [],
      kept: ['R8'],
    }, rows)).toContain('held rows missing: R1, R2, R3, R4, R5, R6, R7, R9, R10')
  })

  it('rejects a malformed row-looking line instead of hiding its verdict', () => {
    const rows = parseCourtRows('  R1  visible  held  {}\n A1.foo.bar  hidden  *** BREACH ***  {}\n')
    expect(ordinaryResultFaults({ held: ['R1'], breach: [], kept: [] }, rows))
      .toContain('unparseable court rows at lines: 2')
  })

  it('rejects zero-indent, invalid-id, and control-coded row evidence', () => {
    for (const hidden of [
      'R2  hidden  *** BREACH ***  {}',
      'row2  hidden  *** BREACH ***  {}',
      '\u001b[31m  R2  hidden  *** BREACH ***  {}\u001b[0m',
    ]) {
      const rows = parseCourtRows(`  R1  visible  held  {}\n${hidden}\n`)
      expect(ordinaryResultFaults({ held: ['R1'], breach: [], kept: [] }, rows))
        .toContain('unparseable court rows at lines: 2')
    }
  })

  it('does not reinterpret an identifier-prefixed limitation as a verdict row', () => {
    const rows = parseCourtRows('  L9  limitation  this mechanism needs Linux — skipped honestly, not faked\n')
    expect(rows.unparsedLines).toEqual([])
  })

  it('does not reinterpret explanatory prose containing verdict vocabulary', () => {
    const rows = parseCourtRows('  a supervisor would print held on every row while the guest still writes them\n')
    expect(rows.unparsedLines).toEqual([])
  })

  it('rejects contradictory verdict language inside a row description', () => {
    for (const text of [
      '  R1  control not held            held  {}\n',
      '  R1  control *** BREACH ***      held  {}\n',
    ]) {
      const rows = parseCourtRows(text)
      expect(ordinaryResultFaults({ held: ['R1'], breach: [], kept: [] }, rows))
        .toContain('unparseable court rows at lines: 1')
    }
  })

  it('rejects contradictory verdict language after the parsed verdict', () => {
    for (const text of [
      '  R1  control  held  *** BREACH ***  {}\n',
      '  R1  control  held  *** INCONCLUSIVE ***  {}\n',
      '  R1  control  held  *** KEPT BREACH ***  {}\n',
    ]) {
      const rows = parseCourtRows(text)
      expect(ordinaryResultFaults({ held: ['R1'], breach: [], kept: [] }, rows))
        .toContain('unparseable court rows at lines: 1')
    }
  })

  it('requires exact live-dispatch normal collection records', () => {
    const root = '/repo'
    const records = [
      { spec: 'packages/governed/memory-put/tests/live-dispatch.spec.ts', total: 38, passed: 33, failed: 0, pending: 5 },
      { spec: 'packages/governed/memory-put/tests/loader-profile.spec.ts', total: 6, passed: 6, failed: 0, pending: 0 },
    ].map(({ spec, total, passed, failed, pending }) => `  NORMAL ${JSON.stringify({
      spec,
      runnerStatus: 0,
      runnerSignal: null,
      reportSuccess: true,
      tests: { total, passed, failed, pending },
      assertionCounts: { passed, failed, pending },
      collectedEntry: `${root}/${spec}`,
      exact: true,
    })}`)
    const text = `${records.join('\n')}\n`
    expect(liveDispatchNormalFaults(text, root)).toEqual([])
    expect(liveDispatchNormalFaults(text.replace('"exact":true', '"exact":false'), root))
      .toContain('live-dispatch normal evidence 1 was not exact')
    expect(liveDispatchNormalFaults(`${text}${records[0]}\n`, root))
      .toContain('live-dispatch normal evidence appeared 3 times, expected 2')
  })

  it('requires one canonical and internally consistent live-dispatch mutation record', () => {
    const value = {
      mutant: 'broker-copy-with-verifyGrant-patched-to-ok',
      controlRow: 'control-valid-settles',
      controlPassed: true,
      securityRowsExpected: ['L4-forged', 'L6-replayed', 'L8-argument-mutation'],
      stillRefusedRows: ['m-expired'],
      breachedRows: ['L4-forged', 'L6-replayed', 'L8-argument-mutation'],
      observations: {
        control: { isError: false },
        'm-forged': { isError: false },
        'm-expired': { isError: true, error: 'memory.put: authorization does not bind to these arguments' },
        'm-replayed': { isError: false },
        'm-mutated': { isError: false },
      },
      testsCollected: 5,
      mutationDetected: true,
      mutantApplied: true,
      missingSecurityRows: [],
      runnerPassed: true,
      observationsExact: true,
      securityRowsExact: true,
      defenseHeld: true,
      countExact: true,
      subjectExact: true,
    }
    const text = `  MUTATION ${JSON.stringify(value, null, 2)}\n`
    expect(liveDispatchMutationFaults(text)).toEqual([])
    expect(liveDispatchMutationFaults(text.replace('"mutationDetected": true', '"mutationDetected": false')))
      .toContain('live-dispatch mutation evidence was not exact')
    expect(liveDispatchMutationFaults(text.replace('"testsCollected": 5', '"testsCollected": 5,\n  "testsCollected": 5')))
      .toContain('live-dispatch mutation evidence was not canonical JSON')
    expect(liveDispatchMutationFaults(`  MUTATION hidden  DETECTED\n${text}`))
      .toContain('live-dispatch mutation evidence appeared 2 times, expected exactly once')
  })

  it('reconciles every primary subprocess classification', () => {
    expect(classifiedRunCount({
      passed: 13,
      skipped: 3,
      inconclusive: 0,
      keptBreach: 4,
      knownBreach: 6,
      resolved: 0,
      mutationDetected: 22,
      unexpected: 0,
    })).toBe(48)
  })

  it('pins the complete 48-run production roster', () => {
    expect(EXPECTED_GATE_RUNS).toHaveLength(48)
    expect(gateRosterFaults(EXPECTED_GATE_RUNS)).toEqual([])
    const brokerMutation = 'ordinary:broker:mutation|courts/harness/broker/run.mjs|["--mutate"]'
    expect(gateRosterFaults(EXPECTED_GATE_RUNS.filter(identity => identity !== brokerMutation)))
      .toContain(`missing scheduled runs: ${brokerMutation}`)
    const auraReservedFieldArm = 'ordinary:aura-record:revert-reserved-field|courts/harness/aura-record/run.mjs|["--arm=revert-reserved-field"]'
    expect(gateRosterFaults(EXPECTED_GATE_RUNS.filter(identity => identity !== auraReservedFieldArm)))
      .toContain(`missing scheduled runs: ${auraReservedFieldArm}`)
    for (const amendment of [
      'ordinary:amendment-channel:normal|courts/harness/amendment-channel/run.mjs|[]',
      'ordinary:amendment-channel:mutation|courts/harness/amendment-channel/run.mjs|["--mutate"]',
    ]) {
      expect(EXPECTED_GATE_RUNS).toContain(amendment)
      expect(gateRosterFaults(EXPECTED_GATE_RUNS.filter(identity => identity !== amendment)))
        .toContain(`missing scheduled runs: ${amendment}`)
    }
    expect(EXPECTED_GATE_RUNS.some(identity => identity.startsWith('enrolled:amendment-channel:'))).toBe(false)
  })
})
