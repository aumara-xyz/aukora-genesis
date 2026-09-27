#!/usr/bin/env node
/** Attach an owner terminal or browser to the existing Web approval service. */
import { spawn } from 'node:child_process'
import { lstatSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { connectWebReview, readWebReviewConfig } from '../aukora/supervisor/developer-review.mjs'
import { startOwnerReview } from '../aukora/supervisor/owner-review-server.mjs'

let connection
const stop = () => { void connection?.close() }
try {
  const { values } = parseArgs({ options: {
    config: { type: 'string' }, 'private-key': { type: 'string' },
    browser: { type: 'boolean', default: false }, 'no-open': { type: 'boolean', default: false },
    port: { type: 'string' }, 'pairing-file': { type: 'string' }, 'app-url': { type: 'string' },
  } })
  if (!values.config || !values['private-key'] || (!values.browser && (values['no-open'] || values.port || values['pairing-file'] || values['app-url']))
    || (values['no-open'] && !values['pairing-file'])
    || (values.port !== undefined && (!/^(0|[1-9][0-9]{0,4})$/u.test(values.port) || Number(values.port) > 65535))) {
    throw new Error('usage: node scripts/aukora-web-review.mjs --config ABSOLUTE_JSON --private-key ABSOLUTE_PEM [--browser [--app-url ORIGIN] [--port PORT] [--pairing-file PRIVATE_NEW_FILE] [--no-open]]')
  }
  const config = readWebReviewConfig(values.config)
  if (values.browser) {
    connection = await startOwnerReview({ config, privateKeyPath: values['private-key'], appOrigin: values['app-url'] ?? 'http://127.0.0.1:5173',
      ...(values.port === undefined ? {} : { port: Number(values.port) }) })
    if (values['pairing-file'] !== undefined) {
      const path = values['pairing-file']
      const parent = dirname(path)
      const state = lstatSync(parent)
      if (!isAbsolute(path) || resolve(path) !== path || !state.isDirectory() || state.isSymbolicLink()
        || state.uid !== process.geteuid?.() || (state.mode & 0o777) !== 0o700 || realpathSync(parent) !== parent) {
        throw new Error('aukora:owner-review:pairing-directory-not-private')
      }
      writeFileSync(path, `${connection.ownerUrl}\n`, { flag: 'wx', mode: 0o600 })
    }
    if (!values['no-open']) {
      const opener = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open'
      try {
        await new Promise((accept, reject) => {
          const child = spawn(opener, [connection.ownerUrl], { stdio: 'ignore' })
          child.once('error', reject)
          child.once('exit', code => code === 0 ? accept() : reject(new Error('aukora:owner-review:browser-open-failed')))
        })
      } catch (error) {
        if (values['pairing-file'] === undefined) throw error
        process.stderr.write('Browser opening failed. The owner service is still available through the private pairing file.\n')
      }
    }
    process.stderr.write(`Owner approval API: ${connection.url}. Approvals appear in the AUKORA chat.\n`)
    await new Promise(done => {
      const finish = () => { stop(); done() }
      process.once('SIGINT', finish)
      process.once('SIGTERM', finish)
    })
  } else {
    connection = await connectWebReview(config, values['private-key'])
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    process.stderr.write(`Owner review connected for ${config.subject}. Ctrl-C disconnects this terminal, not KIRA.\n`)
    await connection.closed
  }
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exitCode = 1
} finally {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  await connection?.close()
}
