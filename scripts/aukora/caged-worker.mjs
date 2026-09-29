#!/usr/bin/env node
/**
 * THE CAGED WORKER: the smallest real driver for the box's confinement.
 *
 * WHY THIS FILE EXISTS. The box ships a real deny-default Seatbelt cage
 * (`aukora/supervisor/guest-confinement.mjs`), it is exercised by
 * `box-confinement-check.mjs`, and NOTHING IN THE RUNNING APP CALLS IT. The cage is proven and
 * unused; the worker it was built to hold has never started. This is the missing half: a worker
 * that runs UNDER the cage, and that does not start at all when the cage is unavailable.
 *
 * WHAT IT DOES NOT DO, said here rather than discovered later.
 *   - It does not dispatch a `workspace.patch` through the broker. The broker's refusal of an
 *     unauthorized effect is proven by `tests/broker-grant.test.mjs` (arms 1-6, each with a
 *     removal probe), but it is NOT yet proven THROUGH this cage. That arm is the next increment.
 *   - It is not the delegation path. It launches no coding CLI, holds no key, takes no approval
 *     and applies no change.
 *   - It is not called by the running app. Nothing in the release imports it; it is a standalone
 *     command, and a standalone command nobody calls is explicitly not the deliverable. The
 *     adapter that gives `launchDeveloperAssembly` its `review` and `issuerApproval` callbacks
 *     from the installed app's owner card is the remaining work.
 *   - The three-service topology (`issuer`/`broker`/`guest` accounts, nine protected paths, three
 *     socket routes) that a full developer turn requires is NOT built here; this cage is prepared
 *     over a disposable fixture.
 *
 * FOUR FACTS, EACH MEASURED RATHER THAN ASSERTED:
 *   1. the cage is verified before anything is spawned, and a failure to verify refuses to start;
 *   2. the worker runs and can make and run a harmless change in its own scratch;
 *   3. an unauthorized write at a protected path fails, INCLUDING from a child Node process;
 *   4. with the cage's policy replaced by `(allow default)`, the same worker ESCAPES - which is
 *      what makes (3) evidence instead of a coincidence.
 *
 * The last one is the point. A denial nobody tried to defeat is not evidence of a boundary.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { prepareGuestConfinement, verifyGuestConfinement } from '../../plugins/aukora-box/aukora/supervisor/guest-confinement.mjs'

const unrestricted = '(version 1)\n(allow default)\n'
const oneLine = error => String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 400)

/** The worker the cage exists to hold. Plain Node, no tsx, no build step, no network. */
const WORKER = `
import { writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const [scratch, protectedPath, childFlag] = process.argv.slice(2)
const saw = { wrote: false, readProtected: null, wroteProtected: null, childWroteProtected: null }
try { writeFileSync(scratch + '/harmless', 'worker-was-here\\n'); saw.wrote = readFileSync(scratch + '/harmless', 'utf8').trim() } catch (e) { saw.wrote = 'ERR ' + e.code }
try { readFileSync(protectedPath, 'utf8'); saw.readProtected = 'ALLOWED' } catch (e) { saw.readProtected = e.code }
try { writeFileSync(protectedPath, 'escaped\\n'); saw.wroteProtected = 'ALLOWED' } catch (e) { saw.wroteProtected = e.code }
if (childFlag === 'child') {
  const r = spawnSync(process.execPath, ['-e',
    'try{require("node:fs").writeFileSync(process.argv[1],"child escaped\\\\n");console.log("ALLOWED")}catch(e){console.log(e.code)}',
    protectedPath], { encoding: 'utf8' })
  saw.childWroteProtected = (r.stdout || '').trim() || ('spawn ' + (r.error?.code ?? r.status))
}
process.stdout.write('WORKER ' + JSON.stringify(saw) + '\\n')
`

async function main() {
  if (process.platform !== 'darwin') { console.log('CAGED WORKER: NOT RUN (not macOS)'); return }
  const arms = []
  let temp
  let servers = []
  let open = new Set()
  try {
    // Nesting check first: an outer sandbox would make every denial below a false positive.
    const admission = spawnSync('/usr/bin/sandbox-exec', ['-p', unrestricted, '--', '/usr/bin/true'],
      { env: { LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    if (!admission.error && admission.status !== 0
      && admission.stderr.trim() === 'sandbox-exec: sandbox_apply: Operation not permitted') {
      console.log('CAGED WORKER: NOT RUN (nested sandbox - denials here would prove nothing)'); return
    }
    assert.equal(admission.status, 0, `sandbox admission failed: ${admission.stderr}`)

    temp = realpathSync.native(mkdtempSync('/private/tmp/aukora-caged-worker-'))
    const root = join(temp, 'code')
    const paths = {
      guestHome: join(temp, 'guest-home'), activationHome: join(temp, 'activation'),
      stateDir: join(temp, 'state'), brokerSocket: join(temp, 'b.sock'), issuerSocket: join(temp, 'i.sock'),
    }
    const issuerKey = join(temp, 'issuer-private-canary')
    for (const suffix of ['aukora', 'apps/cli/lib', 'apps/cli/node_modules', 'node_modules', 'packages', 'vendor']) {
      mkdirSync(join(root, suffix), { recursive: true, mode: 0o700 })
    }
    for (const p of [paths.guestHome, paths.stateDir,
      join(paths.activationHome, 'profiles/8088-inside-out'), join(paths.activationHome, 'profiles/node_modules')]) {
      mkdirSync(p, { recursive: true, mode: 0o700 })
    }
    writeFileSync(join(root, 'package.json'), '{}\n', { mode: 0o600, flag: 'wx' })
    // A HARMLESS CANARY. It is not a secret and no real key is read anywhere in this file.
    writeFileSync(issuerKey, 'public-test-marker-not-a-key\n', { mode: 0o600, flag: 'wx' })
    // THE GUEST'S SCRIPT LIVES IN THE READ TREE. A script in a sibling temp dir is refused by
    // the cage - which is correct, and was the first thing this driver got wrong.
    // READ ROOTS ARE SUBDIRECTORIES, not the code root itself: `aukora/`, `packages/`,
    // `vendor/`, `node_modules/` and the CLI's `lib/`. A file at the root level is NOT
    // readable, which is the second thing this driver got wrong and the cage got right.
    const workerScript = join(root, 'aukora', 'caged-worker-entry.mjs')
    writeFileSync(workerScript, WORKER, { mode: 0o600 })

    // THE PROBE MUST BE ABLE TO REACH A LIVE BROKER. Without these two sockets the verification
    // observes `broker: ENOENT` and correctly REFUSES - a cage whose own preflight cannot run is
    // not a cage. They are disposable fixtures on a short canonical path, never a real socket.
    const listen = async socketPath => {
      const server = createServer(socket => {
        open.add(socket)
        socket.once('close', () => open.delete(socket))
        socket.on('error', () => {})
        socket.end()
      })
      servers.push(server)
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, resolve)
      })
    }
    await listen(paths.brokerSocket)
    await listen(paths.issuerSocket)

    const policy = prepareGuestConfinement({ root, paths, issuerKey })
    const env = {
      DSH_HOME: paths.activationHome, DSH_TELEMETRY_DISABLED: '1',
      HOME: policy.scratch, TMPDIR: policy.scratch, LANG: 'C', LC_ALL: 'C',
      __CF_USER_TEXT_ENCODING: `0x${process.geteuid().toString(16)}:0:0`,
    }

    // FACT 1. The cage is verified BEFORE any worker is spawned. A cage that cannot be verified
    // must not be followed by a guest; that is the difference between a cage and a decoration.
    let cageVerified = false
    try { await verifyGuestConfinement(policy, env); cageVerified = true }
    catch (error) { arms.push(['cage verified before spawn', `REFUSED ${oneLine(error)}`]) }
    if (cageVerified) arms.push(['cage verified before spawn', 'PASS'])
    assert.ok(cageVerified, 'the cage did not verify; refusing to start a worker under an unverified cage')

    const runWorker = (text, label) => {
      const wrapped = spawnSync('/usr/bin/sandbox-exec', ['-p', text, '--', process.execPath,
        workerScript, policy.scratch, issuerKey, 'child'],
        { env, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] })
      const line = (wrapped.stdout || '').split('\n').find(l => l.startsWith('WORKER '))
      assert.ok(line, `${label}: worker produced no record (status ${wrapped.status} ${wrapped.stderr?.slice(0, 200)})`)
      return JSON.parse(line.slice('WORKER '.length))
    }

    // FACTS 2, 3. Under the real cage: the harmless change lands, and the protected path refuses.
    const caged = runWorker(policy.text, 'caged')
    assert.equal(caged.wrote, 'worker-was-here', 'the worker could not make its harmless change')
    assert.equal(readFileSync(join(policy.scratch, 'harmless'), 'utf8').trim(), 'worker-was-here')
    assert.notEqual(caged.readProtected, 'ALLOWED', 'the caged worker READ the protected canary')
    assert.notEqual(caged.wroteProtected, 'ALLOWED', 'the caged worker WROTE the protected canary')
    assert.notEqual(caged.childWroteProtected, 'ALLOWED', 'a CHILD of the caged worker wrote the protected canary')
    assert.equal(readFileSync(issuerKey, 'utf8'), 'public-test-marker-not-a-key\n', 'the canary bytes changed')
    arms.push(['worker ran and made a harmless change', 'PASS'])
    arms.push(['protected read denied', caged.readProtected])
    arms.push(['protected write denied', caged.wroteProtected])
    arms.push(['child process also denied', caged.childWroteProtected])

    // FACT 4. THE CONTROL THAT MAKES THE DENIALS MEAN SOMETHING: the same worker, the same paths,
    // the cage's policy replaced by `(allow default)`. It must ESCAPE. If it does not, the denials
    // above were produced by something other than the policy and prove nothing about it.
    const loose = runWorker(unrestricted, 'unrestricted control')
    assert.equal(loose.wroteProtected, 'ALLOWED', 'the unrestricted control did NOT escape; the denials above are not attributable to the policy')
    // THE CONTROL ESCAPES TWICE, and the second write is the one that survives: the worker writes
    // `escaped`, then its CHILD writes `child escaped` over it. Asserting the exact string was the
    // third thing this driver got wrong. The content is the child's write, and that is strictly
    // more evidence than the original assertion asked for - it shows fork escaped too.
    const canaryAfter = readFileSync(issuerKey, 'utf8')
    assert.notEqual(canaryAfter, 'public-test-marker-not-a-key\n', 'the control did not change the canary at all')
    assert.equal(loose.childWroteProtected, 'ALLOWED', 'the control child did not escape; fork was denied in the control')
    assert.equal(canaryAfter, 'child escaped\n', `the surviving canary write is not the child's: ${JSON.stringify(canaryAfter)}`)
    arms.push(['unrestricted control ESCAPES', 'PASS (denials attributable to the policy)'])
  } catch (error) {
    arms.push(['FAILED', oneLine(error)])
    process.exitCode = 1
  } finally {
    for (const socket of open ?? []) { try { socket.destroy() } catch { /* already gone */ } }
    for (const server of servers ?? []) { try { server.close() } catch { /* already closed */ } }
    if (temp) rmSync(temp, { recursive: true, force: true })
  }
  for (const [name, result] of arms) console.log(`CAGED WORKER: ${result}  (${name})`)
  process.exitCode = process.exitCode ?? (arms.length ? 0 : 1)
}

await main()
