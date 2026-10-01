// THE SHELL'S OWN LOG: <stateRoot>/logs/desktop.log.
//
// The installed app runs with stdout and stderr on /dev/null, so on 2026-09-27 it quit twice and left no trace.
// Every main-process console line, every uncaught error and every process-gone and quit event is appended here:
// one synchronous line each, with an ISO time, tokens redacted. The logger never throws.
//
// IT OBSERVES AND CHANGES NOTHING. `uncaughtExceptionMonitor`, not `uncaughtException`: Electron shows its
// main-process error dialog only while it holds the sole `uncaughtException` listener. Electron's main process only
// WARNS on an unhandled rejection (measured on 44.4.3: no throw, the app carries on), so a listener for it changes
// no control flow.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { redactTokens } from './backend-status.mjs'

// Renderer failure diagnostics need the host/path, never URL credentials or fragments.
function diagnosticUrl(raw) {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  } catch { return '(unparseable URL)' }
}

export function installDesktopLog({ app, stateRoot }) {
  const dir = join(stateRoot, 'logs')
  const path = join(dir, 'desktop.log')
  const write = (kind, ...args) => {
    try {
      const text = redactTokens(format(...args)).replace(/\n/gu, '\n    ')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      appendFileSync(path, `${new Date().toISOString()} ${kind} ${text}\n`, { mode: 0o600 })
    } catch { /* a log that cannot be written must never take the shell down with it */ }
  }
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console)
    console[level] = (...args) => { write(level, ...args); original(...args) }
  }
  const stack = error => (error instanceof Error ? error.stack ?? String(error) : format(error))
  process.on('uncaughtExceptionMonitor', (error, origin) => write(origin, stack(error)))
  process.on('unhandledRejection', reason => write('unhandledRejection', stack(reason)))
  app.on('render-process-gone', (_event, contents, details) => {
    let url = ''
    try { url = diagnosticUrl(contents.getURL()) } catch { /* already destroyed */ }
    write('render-process-gone', `reason=${details?.reason} exitCode=${details?.exitCode} ${url}`)
  })
  app.on('child-process-gone', (_event, details) => write('child-process-gone',
    `type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode} name=${details?.name ?? details?.serviceName ?? ''}`))
  // THE REASON FOR A QUIT, AS FAR AS THE SHELL CAN KNOW IT: the last window closing is the one quit main.mjs issues.
  // (Subscribing here changes nothing only because main.mjs already subscribes and quits; alone it would stop the quit.)
  app.on('window-all-closed', () => write('window-all-closed', 'the last window closed; main.mjs quits on this'))
  app.on('before-quit', () => write('before-quit', 'quit requested (menu, Cmd+Q, app.quit or the last window closing)'))
  app.on('will-quit', () => write('will-quit', 'windows closed; the shell is exiting'))
  app.on('quit', (_event, exitCode) => write('quit', `exitCode=${exitCode}`))
  write('start', `pid=${process.pid} electron=${process.versions.electron} log=${path}`)
  return { path, write }
}
