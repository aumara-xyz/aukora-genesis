#!/usr/bin/env node
/** Interactive command line entry for the same-UID parent-owned source launch. */
import { randomBytes } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  DEVELOPER_LAUNCH_SCHEMA,
  SOURCE_RENDERER_ID,
  launchDeveloperAssembly,
  parseDeveloperLaunchConfig,
  parseDeveloperMemoryPut,
  sourceOutcomeExitCode,
} from './developer-launch.mjs'
import { approvalArtifactDigest, parseApprovalArtifact } from '../approval/artifact.mjs'
import { renderApprovalArtifact } from '../approval/render.mjs'

const confined = process.argv[2] === '--confined'
const args = process.argv.slice(confined ? 3 : 2)
const [configPath, operationPath] = args
if ((args.length !== 1 && args.length !== 2)
  || typeof configPath !== 'string'
  || configPath.startsWith('-')
  || (operationPath !== undefined && operationPath.startsWith('-'))) {
  process.stderr.write('usage: node aukora/supervisor/developer-launch-bin.mjs [--confined] <launch.json> [memory-put.json]\n')
  process.exitCode = 1
} else {
  await main(configPath, operationPath)
}

async function main(path, oneShotPath) {
  const terminal = createTerminalLines()
  let assembly
  let exitCode = 0
  try {
    const config = parseDeveloperLaunchConfig(readExactFile(path, 64 * 1024, 'launch config'))
    const oneShot = oneShotPath === undefined
      ? undefined
      : parseDeveloperMemoryPut(readExactFile(oneShotPath, 8192, 'memory.put operation'))
    assembly = await launchDeveloperAssembly({
      runtimeDir: config.runtimeDir,
      rootPrivateKeyFile: config.rootPrivateKeyFile,
      rootPublicKeyFile: config.rootPublicKeyFile,
      ...(confined ? { guestConfinement: 'macos-seatbelt' } : {}),
      ...(config.kiraSubject === undefined ? {} : {
        kiraRecallPolicy: { subject: config.kiraSubject, privacy: config.kiraPrivacy },
      }),
      rendererId: SOURCE_RENDERER_ID,
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
      artifact: assembly.artifact,
    })}\n`)
    if (oneShot !== undefined) {
      const execution = await Promise.race([
        assembly.executeMemoryPut(oneShot),
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
    } else {
      const stop = waitForStop()
      try {
        exitCode = await Promise.race([
          stop.result,
          assembly.failure.then(
            () => 1,
            (error) => {
              process.stderr.write(`${String(error?.message ?? error)}\n`)
              return 1
            },
          ),
        ])
      } finally {
        stop.dispose()
        await assembly.close()
      }
    }
  } catch (error) {
    exitCode = 1
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    if (assembly !== undefined) await assembly.close()
  } finally {
    terminal.close()
  }
  process.exitCode = exitCode
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

/** Resolve on one operator stop signal and preserve its conventional exit code. */
function waitForStop() {
  let resolveResult
  const result = new Promise((resolve) => { resolveResult = resolve })
  const dispose = () => {
    process.removeListener('SIGTERM', onTerm)
    process.removeListener('SIGINT', onInt)
  }
  const finish = (code) => {
    dispose()
    resolveResult(code)
  }
  const onTerm = () => finish(0)
  const onInt = () => finish(130)
  process.once('SIGTERM', onTerm)
  process.once('SIGINT', onInt)
  return { result, dispose }
}
