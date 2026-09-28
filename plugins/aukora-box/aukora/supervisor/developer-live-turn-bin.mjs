#!/usr/bin/env node
/** One parent-staged user turn; the PR 52 stdin frame remains the only write door. */
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { loadOrCreateLocalAumlokControl } from '../identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from './developer-aumlok.mjs'
import {
  DEVELOPER_LAUNCH_SCHEMA,
  launchDeveloperAssembly,
  parseDeveloperLaunchConfig,
  parseDeveloperLiveTurn,
  sourceOutcomeExitCode,
} from './developer-launch.mjs'
import { approvalArtifactDigest, parseApprovalArtifact } from '../approval/artifact.mjs'
import { renderApprovalArtifact } from '../approval/render.mjs'

const LIVE_TURN_RENDERER_ID = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
let command
try {
  command = parseArguments(process.argv.slice(2))
} catch {
  process.stderr.write('usage: node aukora/supervisor/developer-live-turn-bin.mjs <launch.json> <turn.json> [--control-dir PATH]\n')
  process.exitCode = 1
}
if (command !== undefined) await main(command)

async function main(commandInput) {
  const terminal = createTerminalLines()
  let keyDirectory
  let assembly
  let exitCode = 0
  try {
    const config = parseDeveloperLaunchConfig(readExactFile(commandInput.configPath, 64 * 1024, 'launch config'))
    const oneShot = parseDeveloperLiveTurn(readExactFile(commandInput.turnPath, 8192, 'live turn'))
    const control = loadOrCreateLocalAumlokControl(commandInput.controlDir)
    if (config.kiraSubject !== undefined && config.kiraSubject !== control.subject) {
      throw new Error('supervisor:live-turn-aumlok-subject-mismatch')
    }
    const authority = createDeveloperAumlokAuthority(control, {
      audience: 'broker:source-launch',
    })
    keyDirectory = mkdtempSync(join(tmpdir(), 'aukora-live-turn-'))
    chmodSync(keyDirectory, 0o700)
    const privateKeyFile = join(keyDirectory, 'issuer-private.pem')
    const publicKeyFile = join(keyDirectory, 'issuer-public.pem')
    writeFileSync(privateKeyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600, flag: 'wx' })
    writeFileSync(publicKeyFile, control.ed25519PublicKeyPem, { mode: 0o600, flag: 'wx' })
    assembly = await launchDeveloperAssembly({
      runtimeDir: config.runtimeDir,
      rootPrivateKeyFile: privateKeyFile,
      rootPublicKeyFile: publicKeyFile,
      rootControlState: control.activeControl,
      kiraRecallPolicy: {
        subject: control.subject,
        privacy: config.kiraPrivacy ?? ['private'],
      },
      selectSubjectAuthority: authority.selectSubjectAuthority,
      subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
      rendererId: LIVE_TURN_RENDERER_ID,
      liveTurn: { fixture: process.env.AUKORA_LIVE_TURN_FIXTURE === '1' },
      review: async (request, signal) => {
        let artifact
        try {
          artifact = parseApprovalArtifact(request?.artifact)
        } catch {
          // parseApprovalArtifact refused a non-artifact review payload.
          return 'denied'
        }
        if (approvalArtifactDigest(artifact) !== request?.artifactDigest) return 'denied'
        const challenge = randomBytes(8).toString('hex')
        process.stderr.write(`${renderApprovalArtifact(artifact, challenge)}`)
        const line = await terminal.read(signal)
        return line === `yes ${challenge}` ? 'approved' : 'denied'
      },
      issuerApproval: async ({ challenge }, signal) => {
        const line = await terminal.read(signal)
        return line === `yes ${challenge}` ? 'approved' : 'denied'
      },
    })
    process.stdout.write(`${JSON.stringify({
      schema: DEVELOPER_LAUNCH_SCHEMA,
      status: 'READY',
      observationClass: assembly.observationClass,
      pids: {
        broker: assembly.broker.pid,
        issuer: assembly.issuer.pid,
        guest: assembly.guest.pid,
      },
      routes: {
        broker: assembly.paths.brokerSocket,
        issuer: assembly.paths.issuerSocket,
      },
      aumlok: authority.projection,
      artifact: assembly.artifact,
    })}\n`)
    const execution = await Promise.race([
      assembly.executeUserTurn(oneShot.prompt),
      assembly.failure,
    ])
    process.stdout.write(`${JSON.stringify({
      schema: 'aukora:source-launch-result:v1',
      observationClass: assembly.observationClass,
      outcome: execution.outcome,
      result: execution.result,
    })}\n`)
    exitCode = sourceOutcomeExitCode(execution.outcome)
    await assembly.close()
  } catch (error) {
    exitCode = 1
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    if (assembly !== undefined) await assembly.close()
  } finally {
    terminal.close()
    if (keyDirectory !== undefined) rmSync(keyDirectory, { recursive: true, force: true })
  }
  process.exitCode = exitCode
}

/** Preserve both positional files and accept one optional persistent controller directory. */
function parseArguments(args) {
  const positional = []
  let controlDir = join(homedir(), '.aukora', 'local-control-v1')
  let sawControlDir = false
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--control-dir') {
      const directory = args[index + 1]
      if (sawControlDir || directory === undefined || directory.length === 0) throw new Error('usage')
      controlDir = resolve(directory)
      sawControlDir = true
      index += 1
      continue
    }
    if (value.startsWith('-')) throw new Error('usage')
    positional.push(value)
  }
  if (positional.length !== 2) throw new Error('usage')
  return Object.freeze({
    configPath: positional[0],
    turnPath: positional[1],
    controlDir,
  })
}

/** Read one bounded exact regular file before parsing any bytes. */
function readExactFile(path, maxBytes, label) {
  const entry = lstatSync(path)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be an exact regular file`)
  if (entry.size > maxBytes) throw new Error(`${label} exceeds ${String(maxBytes)} bytes`)
  return readFileSync(path)
}

/** One input reader shared by the parent renderer and issuer artifact prompt. */
function createTerminalLines() {
  const lines = []
  const waiters = []
  let closedError
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: process.stdin.isTTY })
  input.on('line', (line) => {
    const waiter = waiters.shift()
    if (waiter === undefined) lines.push(line)
    else waiter.resolve(line)
  })
  input.once('close', () => {
    closedError = new Error('supervisor: approval input closed')
    for (const waiter of waiters.splice(0)) waiter.reject(closedError)
  })
  return {
    read(signal) {
      if (signal.aborted) return Promise.reject(new Error('supervisor: approval cancelled'))
      const line = lines.shift()
      if (line !== undefined) return Promise.resolve(line)
      if (closedError !== undefined) return Promise.reject(closedError)
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject }
        const onAbort = () => {
          const index = waiters.indexOf(waiter)
          if (index !== -1) waiters.splice(index, 1)
          reject(new Error('supervisor: approval cancelled'))
        }
        waiter.resolve = (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        }
        waiter.reject = (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        waiters.push(waiter)
      })
    },
    close() {
      input.close()
    },
  }
}
