#!/usr/bin/env node
/**
 * The governed Web assembly under SCRIPTED approvals, for the automated flight.
 *
 * This launcher composes exactly what `aukora/supervisor/developer-web-bin.mjs`
 * composes: the same governed Web profile, the same real broker, issuer and
 * guest processes, and the same activation. Two things differ, and both exist
 * only because a test has no person and no model at the keyboard.
 *
 * The approvals are SCRIPTED. They are supplied by this file, they are labelled
 * as such in the READY record, and they are not evidence that anyone approved
 * anything. The attended path is the real bin, where a human answers a rendered
 * challenge on a terminal.
 *
 * This launcher does not write. The Web assembly refuses a direct
 * `memory.put` with `supervisor:web-browser-only`: proposals reach it through
 * its browser ToolRuntime, which needs a model turn. The write and its terminal
 * approval are therefore attended, and this flight proves what it can prove
 * without a person or a model — that the whole assembly launches, reports what
 * it mounted, terminates, and comes back over the same durable roots.
 *
 * @module scripts/aukora-web-flight-bin
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import {
  DEVELOPER_OBSERVATION_CLASS,
  WEB_RENDERER_ID,
  launchDeveloperAssembly,
} from '../aukora/supervisor/developer-launch.mjs'

/** The approval class this launcher can honestly claim. */
const APPROVAL_CLASS = 'SCRIPTED FIXTURE: no person and no model approved this'

const USAGE = 'usage: aukora-web-flight-bin --port N --control-dir PATH --data-dir PATH'

let base
let assembly
let exitCode = 0
try {
  const options = parseOptions(process.argv.slice(2))
  const control = loadOrCreateLocalAumlokControl(options.controlDir)
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
  base = mkdtempSync(join(tmpdir(), 'aukora-web-flight-'))
  const privateKeyFile = join(base, 'issuer-private.pem')
  const publicKeyFile = join(base, 'issuer-public.pem')
  writeFileSync(privateKeyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600, flag: 'wx' })
  writeFileSync(publicKeyFile, control.ed25519PublicKeyPem, { mode: 0o600, flag: 'wx' })
  chmodSync(base, 0o700)
  assembly = await launchDeveloperAssembly({
    runtimeDir: join(base, 'assembly'),
    rootPrivateKeyFile: privateKeyFile,
    rootPublicKeyFile: publicKeyFile,
    rendererId: WEB_RENDERER_ID,
    rootControlState: control.activeControl,
    dataDir: options.dataDir,
    web: { port: options.port },
    webAumlokProjection: authority.projection,
    kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
    selectSubjectAuthority: authority.selectSubjectAuthority,
    subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
    review: async () => 'approved',
    issuerApproval: async () => 'approved',
  })
  write({
    schema: 'aukora:web-flight-ready:v1',
    status: 'READY',
    approvalClass: APPROVAL_CLASS,
    url: `http://127.0.0.1:${String(options.port)}`,
    observationClass: DEVELOPER_OBSERVATION_CLASS,
    pids: { launcher: process.pid, broker: assembly.broker.pid, issuer: assembly.issuer.pid, guest: assembly.guest.pid },
    globalTools: assembly.guestGlobalTools,
    stateDir: assembly.paths.stateDir,
    subject: control.subject,
    activationDigest: assembly.activationDigest,
  })
  exitCode = await serveCommands(assembly)
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  exitCode = 1
} finally {
  if (assembly !== undefined) await assembly.close()
  if (base !== undefined) rmSync(base, { recursive: true, force: true })
}
process.exitCode = exitCode

/** Emit one JSON record on its own line. */
function write(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

/**
 * Stay live until the command channel closes or asks this launcher to stop.
 *
 * @param {Awaited<ReturnType<typeof launchDeveloperAssembly>>} live running assembly
 * @returns {Promise<number>} process exit code
 */
async function serveCommands(live) {
  void live
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === 'stop') break
  }
  return 0
}

/**
 * Parse the required port and the two required durable roots.
 *
 * Nothing defaults: a flight that fell back to a home directory would write
 * durable state where no test may put it.
 *
 * @param {readonly string[]} args argv after the script name
 * @returns {Readonly<{port: number, controlDir: string, dataDir: string}>} parsed options
 */
function parseOptions(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (typeof value !== 'string' || !['--port', '--control-dir', '--data-dir'].includes(name)) throw new Error(USAGE)
    parsed[name] = value
  }
  const port = Number(parsed['--port'])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(USAGE)
  if (parsed['--control-dir'] === undefined || parsed['--data-dir'] === undefined) throw new Error(USAGE)
  return Object.freeze({ port, controlDir: parsed['--control-dir'], dataDir: parsed['--data-dir'] })
}
