import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCourtGateReport,
  courtGateReportEnabled,
  courtGateProcessResult,
  parseCourtGateRunIdentity,
  persistCourtGateReportDescriptor,
  resolveCourtGateReportDescriptor,
} from './court-gate-report.mjs'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'aukora-report-root-'))
  const output = mkdtempSync(join(tmpdir(), 'aukora-report-output-'))
  return { root, output }
}

describe('Court Gate machine report', () => {
  it('admits only inherited descriptor three for bounded report capture', () => {
    expect(resolveCourtGateReportDescriptor([])).toBeNull()
    expect(resolveCourtGateReportDescriptor(['--report-fd', '3'])).toBe(3)
    expect(() => resolveCourtGateReportDescriptor(['--report-fd', '2'])).toThrow('usage:')
    expect(() => resolveCourtGateReportDescriptor(['--report-fd', '3', 'extra'])).toThrow('usage:')
    expect(() => resolveCourtGateReportDescriptor(['--report-json', '/tmp/report.json'])).toThrow('usage:')
    expect(() => resolveCourtGateReportDescriptor(['--unknown'])).toThrow('usage:')
    expect(courtGateReportEnabled(null)).toBe(false)
    expect(courtGateReportEnabled(3)).toBe(true)
  })

  it('keeps descriptor reporting and final stream draining wired into the Gate entrypoint', () => {
    const source = readFileSync(join(import.meta.dirname, 'run-gate.mjs'), 'utf8')
    expect(source).toContain('const initialSubject = REPORT_ENABLED ? gitSubjectWitness() : null')
    expect(source).toContain('const pnpmVersion = REPORT_ENABLED ? pnpmVersionWitness() : null')
    expect(source).toContain('runParentLaunchAssembly()')
    expect(source).toContain("'vitest.aukora-parent-launch.config.ts'")
    expect(source).toContain('const finalSubject = REPORT_ENABLED ? gitSubjectWitness() : null')
    expect(source).toContain('if (REPORT_ENABLED) {')
    expect(source).not.toContain('REPORT_PATH')
    expect(source).toContain('process.exitCode = reportOutcome.exitCode')
    expect(source).not.toContain('process.exit(reportOutcome.exitCode)')
  })

  it('drains piped output beyond the operating-system pipe capacity before final exit', () => {
    const byteCount = 2 * 1024 * 1024
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
process.stdout.write(Buffer.alloc(${byteCount}, 0x61))
process.exitCode = 7
`], { maxBuffer: byteCount + 1024 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(7)
    expect(result.stdout).toHaveLength(byteCount)
  })

  it('projects every scheduled identity and keeps missing execution explicit', () => {
    const first = 'ordinary:broker:normal|courts/harness/broker/run.mjs|[]'
    const second = 'ordinary:broker:mutation|courts/harness/broker/run.mjs|["--mutate"]'
    const classifications = new Map<string, 'pass'>([[first, 'pass']])
    const runResults = new Map([[first, {
      durationMs: 50,
      process: {
        started: true,
        exitCode: 0,
        signal: null,
        timedOut: false,
        errorCode: null,
        durationMs: 42,
      },
      faultCount: 0,
    }]])
    const report = buildCourtGateReport({
      subject: {
        commit: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        headStable: true,
        checkout: {},
      },
      runtime: { platform: 'darwin', arch: 'arm64', node: 'v24.0.0', pnpm: '11.7.0' },
      scheduledRunRoster: [first, second],
      classifications,
      runResults,
      headline: {
        passed: 1,
        skipped: 0,
        inconclusive: 0,
        keptBreach: 0,
        knownBreach: 0,
        resolved: 0,
        mutationDetected: 0,
        unexpected: 0,
      },
      dispatchedCount: 2,
      classifiedCount: 1,
      accountingFaults: ['classification ledger: missing mutation'],
      finalStatus: 1,
    })

    expect(report.schemaVersion).toBe(1)
    expect(report.runs).toEqual([
      {
        identity: first,
        label: 'ordinary:broker:normal',
        path: 'courts/harness/broker/run.mjs',
        args: [],
        classification: 'pass',
        durationMs: 50,
        process: runResults.get(first)?.process,
        faultCount: 0,
      },
      {
        identity: second,
        label: 'ordinary:broker:mutation',
        path: 'courts/harness/broker/run.mjs',
        args: ['--mutate'],
        classification: 'unclassified',
        durationMs: 0,
        process: {
          started: false,
          exitCode: null,
          signal: null,
          timedOut: false,
          errorCode: null,
          durationMs: 0,
        },
        faultCount: 0,
      },
    ])
    expect(report.aggregate).toMatchObject({ scheduled: 2, dispatched: 2, classified: 1, unclassified: 1 })
    expect(report.final).toEqual({
      verdict: 'failed',
      exitCode: 1,
      systemSoundness: 'not-assessed',
      resolvedPendingOracleReview: 0,
    })
    expect(JSON.stringify(report)).not.toContain('process.env')
  })

  it('retains exit, signal, timeout, and duration without child output', () => {
    expect(courtGateProcessResult({
      status: null,
      signal: 'SIGKILL',
      error: Object.assign(new Error('timed out with a secret'), { code: 'ETIMEDOUT' }),
      stdout: 'secret output',
      stderr: 'secret error',
    }, 12.6)).toEqual({
      started: true,
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
      errorCode: 'ETIMEDOUT',
      durationMs: 13,
    })
  })

  it('parses only the fixed run-identity grammar', () => {
    expect(parseCourtGateRunIdentity('ordinary:a:normal|courts/a.mjs|["--mutate"]')).toEqual({
      identity: 'ordinary:a:normal|courts/a.mjs|["--mutate"]',
      label: 'ordinary:a:normal',
      path: 'courts/a.mjs',
      args: ['--mutate'],
    })
    expect(() => parseCourtGateRunIdentity('ordinary:a:normal|courts/a.mjs|{}'))
      .toThrow('invalid Court Gate argument vector')
  })

  it('rejects a classification outside the closed headline vocabulary', () => {
    const identity = 'ordinary:a:normal|courts/a.mjs|[]'
    expect(() => buildCourtGateReport({
      subject: {},
      runtime: {},
      scheduledRunRoster: [identity],
      classifications: new Map([[identity, 'bogus' as 'pass']]),
      runResults: new Map(),
      headline: {
        passed: 0,
        skipped: 0,
        inconclusive: 0,
        keptBreach: 0,
        knownBreach: 0,
        resolved: 0,
        mutationDetected: 0,
        unexpected: 0,
      },
      dispatchedCount: 1,
      classifiedCount: 1,
      accountingFaults: [],
      finalStatus: 1,
    })).toThrow('unknown Court Gate classification')
  })

  it('writes canonical JSON through a validated inherited descriptor', () => {
    const { root, output } = fixture()
    const target = join(output, 'court-gate.json')
    const descriptor = openSync(target, 'wx', 0o600)
    try {
      expect(persistCourtGateReportDescriptor(descriptor, { schemaVersion: 1 }, 0))
        .toEqual({ exitCode: 0, error: null })
    } finally {
      closeSync(descriptor)
    }
    expect(readFileSync(target, 'utf8')).toBe(`${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`)
    rmSync(root, { recursive: true, force: true })
    rmSync(output, { recursive: true, force: true })
  })
})
