#!/usr/bin/env node
// Deep's unchanged verifier, disposable fixture only; no application launch.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { prepareGuestConfinement, verifyGuestConfinement } from '../../plugins/aukora-box/aukora/supervisor/guest-confinement.mjs'

const unrestrictedText = '(version 1)\n(allow default)\n'
const detail = error => String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 600)

async function main() {
  if (process.platform !== 'darwin') {
    console.log('BOX CONFINEMENT CHECK: SKIPPED (not macOS)')
    return
  }
  const arms = [
    { name: 'generated policy', passed: false, result: null },
    { name: 'unrestricted policy', passed: false, result: null },
  ]
  const run = async (arm, check, success) => {
    try {
      await check()
      arm.passed = true
      arm.result = success
    } catch (error) { arm.result = `FAIL ${detail(error)}` }
  }
  let temp
  const servers = []
  const connections = new Set()
  const listen = async path => {
    const server = createServer(socket => {
      connections.add(socket)
      socket.once('close', () => connections.delete(socket))
      socket.on('error', () => {})
      socket.end()
    })
    servers.push(server)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, resolve)
    })
  }

  try {
    // Check sandbox admission before sockets: outer sandboxes may deny both.
    // Only this exact sandbox_apply refusal is NOT RUN; other failures are RED.
    const admission = spawnSync('/usr/bin/sandbox-exec',
      ['-p', unrestrictedText, '--', '/usr/bin/true'], {
        env: { LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    if (!admission.error && admission.signal === null && admission.status !== 0
      && admission.stdout === ''
      && admission.stderr.trim() === 'sandbox-exec: sandbox_apply: Operation not permitted') {
      console.log('BOX CONFINEMENT CHECK: NOT RUN (nested sandbox)')
      return
    }
    if (admission.error) throw admission.error
    assert.equal(admission.signal, null, 'sandbox admission was signalled')
    assert.equal(admission.status, 0, `sandbox admission failed: ${admission.stderr}`)
    assert.equal(admission.stdout, '', 'unexpected sandbox admission output')
    assert.equal(admission.stderr, '', 'unexpected sandbox admission diagnostic')

    // Short, canonical paths keep fixture Unix sockets within macOS's limit.
    temp = mkdtempSync('/private/tmp/aukora-box-check-')
    temp = realpathSync.native(temp)
    const root = join(temp, 'code')
    const paths = {
      guestHome: join(temp, 'guest-home'),
      activationHome: join(temp, 'activation'),
      stateDir: join(temp, 'state'),
      brokerSocket: join(temp, 'b.sock'),
      issuerSocket: join(temp, 'i.sock'),
    }
    const issuerKey = join(temp, 'issuer-private-canary')
    for (const suffix of ['aukora', 'apps/cli/lib', 'apps/cli/node_modules', 'node_modules', 'packages', 'vendor']) {
      mkdirSync(join(root, suffix), { recursive: true, mode: 0o700 })
    }
    for (const path of [paths.guestHome, paths.stateDir,
      join(paths.activationHome, 'profiles/8088-inside-out'),
      join(paths.activationHome, 'profiles/node_modules')]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    writeFileSync(join(root, 'package.json'), '{}\n', { mode: 0o600, flag: 'wx' })
    writeFileSync(issuerKey, 'public-test-marker-not-a-key\n', { mode: 0o600, flag: 'wx' })
    await listen(paths.brokerSocket)
    await listen(paths.issuerSocket)
    const policy = prepareGuestConfinement({ root, paths, issuerKey })
    // Match the original probe's closed guest environment: no inherited hooks.
    const env = {
      DSH_HOME: paths.activationHome,
      DSH_TELEMETRY_DISABLED: '1',
      HOME: policy.scratch,
      TMPDIR: policy.scratch,
      LANG: 'C',
      LC_ALL: 'C',
      __CF_USER_TEXT_ENCODING: `0x${process.geteuid().toString(16)}:0:0`,
    }

    await run(arms[0], async () => {
      await verifyGuestConfinement(policy, env)
      assert.equal(readFileSync(join(policy.scratch, 'enforcement-positive'), 'utf8'), 'allowed')
    }, 'PASS')
    await run(arms[1], async () => {
      // Change only this test input; never edit the copied module or policy.
      let refusal
      try { await verifyGuestConfinement({ ...policy, text: unrestrictedText }, env) }
      catch (error) { refusal = error }
      assert.equal(refusal?.reason, 'confined:enforcement-unavailable', 'unrestricted probe was not refused')
      // A spawn failure alone cannot masquerade as the expected refusal.
      const match = /observed=(\{.*\}) stderr=/.exec(refusal.message)
      assert.ok(match, 'missing actual unrestricted probe observations')
      const observed = JSON.parse(match[1])
      for (const name of ['read', 'state', 'write', 'startup', 'fork']) {
        assert.equal(observed[name], false, `unrestricted ${name} did not actually succeed`)
      }
      assert.equal(observed.broker, 'allowed')
      assert.equal(observed.issuer, 'allowed')
      assert.equal(typeof observed.network, 'string', 'missing loopback observation')
      assert.ok(!['EPERM', 'EACCES', 'timeout'].includes(observed.network), 'loopback was unexpectedly restricted')
      assert.equal(readFileSync(join(policy.profileDir, 'forbidden-startup'), 'utf8'), 'escaped')
    }, 'REFUSE confined:enforcement-unavailable')
  } catch (error) {
    for (const arm of arms) {
      if (arm.result === null) arm.result = `FAIL ${detail(error)}`
    }
  } finally {
    try {
      try {
        for (const socket of connections) socket.destroy()
        await Promise.all(servers.map(server => new Promise((resolve, reject) => {
          if (!server.listening) return resolve()
          server.close(error => error ? reject(error) : resolve())
        })))
      } finally {
        if (temp) rmSync(temp, { recursive: true, force: true })
      }
    } catch (error) {
      arms[0].passed = false
      arms[0].result = `FAIL cleanup: ${detail(error)}`
    }
  }
  for (const arm of arms) console.log(`BOX CONFINEMENT: ${arm.result} (${arm.name})`)
  const green = arms.every(arm => arm.passed)
  console.log(`BOX CONFINEMENT CHECK: ${green ? 'GREEN' : 'RED'}`)
  if (!green) process.exitCode = 1
}

await main()
