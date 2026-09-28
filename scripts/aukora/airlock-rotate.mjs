#!/usr/bin/env node
// Admin ceremony, invoked as the second UID from a reviewed, root-owned install.
// Reuses the existing root succession and machine retirement; no seed is imported.
import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveRootFromPhrase } from '../../plugins/aukora-aumlok/lib/derive-v3.mjs'
import { refreshBindingV3 } from '../../plugins/aukora-aumlok/lib/refresh-v3.mjs'
import { projectRecordV3Control, recordProjection } from '../../plugins/aukora-aumlok/lib/record-v3.mjs'
import { assertPrivateDirectory, systemHost } from '../../plugins/aukora-owner-daemon/lib/boundary.mjs'

function hiddenLine(fd, prompt) {
  writeSync(fd, prompt)
  const saved = execFileSync('/bin/stty', ['-g'], { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8' }).trim()
  const chunks = []
  try {
    execFileSync('/bin/stty', ['-echo'], { stdio: [fd, 'ignore', 'ignore'] })
    const byte = Buffer.alloc(1)
    while (readSync(fd, byte, 0, 1, null) === 1) {
      if (byte[0] === 10 || byte[0] === 13) break
      if (chunks.length >= 4096) throw new Error('phrase exceeds input limit')
      chunks.push(byte[0])
    }
    return Buffer.from(chunks).toString('utf8')
  } finally {
    chunks.fill(0)
    execFileSync('/bin/stty', [saved], { stdio: [fd, 'ignore', 'ignore'] })
    writeSync(fd, '\n')
  }
}

try {
  const [directoryArg, callerArg] = process.argv.slice(2)
  const callerUid = Number(callerArg)
  if (!directoryArg || !/^\d+$/u.test(callerArg ?? '') || !Number.isSafeInteger(callerUid)
    || process.getuid() === 0 || process.getuid() === callerUid) {
    throw new Error('run as the second non-root UID: airlock-rotate.mjs OWNER_AUMLOK_DIR APP_UID')
  }
  const directory = resolve(directoryArg)
  assertPrivateDirectory(directory, 'rotation directory', systemHost)
  const before = JSON.parse(readFileSync(join(directory, 'local-control.json'), 'utf8'))
  const subject = recordProjection(before).subject
  const handle = before.publicRoot.handle
  const fd = openSync('/dev/tty', 'r+')
  let oldRoot, newRoot
  try {
    oldRoot = await deriveRootFromPhrase(hiddenLine(fd, 'Current root phrase (hidden): '), { handle })
    newRoot = await deriveRootFromPhrase(hiddenLine(fd, 'New root phrase (hidden): '), { handle })
    const confirmation = await deriveRootFromPhrase(hiddenLine(fd, 'Repeat new phrase (hidden): '), { handle })
    if (confirmation.rootId !== newRoot.rootId) throw new Error('new phrases do not match')
  } finally { closeSync(fd) }
  const next = refreshBindingV3({ directory, oldRoot, newRoot,
    refreshedAt: new Date().toISOString(), expectSubject: subject })
  for (const machine of before.publicRoot.machines ?? []) {
    if (!next.record.publicRoot.revokedMachines?.some(entry => entry.ed25519 === machine.ed25519)) {
      throw new Error('old machine retirement is missing')
    }
    let refused = false
    try { projectRecordV3Control({ record: next.record, machinePublicKeyHex: machine.ed25519 }) }
    catch (error) {
      refused = /^(aumlok:machine-revoked|aumlok:machine-signer-not-listed-by-the-record):/u.test(error.message)
    }
    if (!refused) throw new Error('old machine retirement was not verified')
  }
  process.stdout.write(`ROTATED epoch=${next.record.publicRoot.epoch}; old machines refused by refreshed record\n`)
  // No roots, phrases, seeds, or returned refresh object are printed.
} catch {
  process.stderr.write('REFUSED: rotation did not finish; inspect the protected public record before retrying\n')
  process.exitCode = 1
}
