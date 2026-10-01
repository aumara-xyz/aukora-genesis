// Synthetic diagnostic URLs only; no Electron, network, installed logs or account state.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { test } from 'node:test'
import { installDesktopLog } from '../apps/aukora-desktop/desktop-log.mjs'

test('renderer failure diagnostics omit URL credentials and retain failure context', () => {
  const scratch = mkdtempSync('/tmp/aukora-desktop-log-test-')
  const app = new EventEmitter()
  const levels = ['log', 'info', 'warn', 'error']
  const consoleBefore = Object.fromEntries(levels.map(level => [level, console[level]]))
  const events = ['uncaughtExceptionMonitor', 'unhandledRejection']
  const listenersBefore = new Map(events.map(event => [event, new Set(process.listeners(event))]))
  try {
    const { path } = installDesktopLog({ app, stateRoot: scratch })
    const samples = [
      ['https://fixture-user:fixture-password@example.invalid:8443/api/tasks#access_token=fixture-fragment',
        'https://example.invalid:8443/api/tasks'],
      ['https://fixture%2Dencoded:fixture%2Dpassword@example.invalid/api/tasks?api_key=fixture-query#fixture-anchor',
        'https://example.invalid/api/tasks'],
      ['http://127.0.0.1:64281/plugins/client.js', 'http://127.0.0.1:64281/plugins/client.js'],
      ['invalid-url-fixture-secret', '(unparseable URL)'],
    ]
    for (const [url] of samples) app.emit('render-process-gone', null,
      { getURL: () => url }, { reason: 'crashed', exitCode: 7 })
    app.emit('render-process-gone', null, { getURL: () => { throw new Error('destroyed') } },
      { reason: 'killed', exitCode: 9 })
    const text = readFileSync(path, 'utf8')
    const diagnostics = text.split('\n').filter(line => line.includes('render-process-gone'))
    assert.equal(diagnostics.length, samples.length + 1, 'every failure is still logged')
    assert.ok(!text.includes('fixture'), 'no plain or encoded credential fixture reaches the log')
    samples.forEach(([, expected], i) => assert.ok(diagnostics[i].endsWith(
      `render-process-gone reason=crashed exitCode=7 ${expected}`), 'safe URL and crash details survive'))
    assert.ok(diagnostics.at(-1).endsWith('render-process-gone reason=killed exitCode=9 '))
  } finally {
    Object.assign(console, consoleBefore)
    for (const event of events) for (const listener of process.listeners(event)) {
      if (!listenersBefore.get(event).has(listener)) process.removeListener(event, listener)
    }
    app.removeAllListeners()
    rmSync(scratch, { recursive: true, force: true })
  }
})
